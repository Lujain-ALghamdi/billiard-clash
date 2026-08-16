import { describe, it, expect } from 'vitest';
import { evaluateShot, nextShooter, shouldGrantBallInHand, type ShotInput } from './eightBallRules';
import type { BallState } from '../types';
import type { CollisionEvent } from '../physics/engine';

function fullRackBalls(pocketedIds: number[] = []): BallState[] {
  const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  return ids.map((id) => ({
    id: id as BallState['id'],
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    pocketed: pocketedIds.includes(id),
    onTable: !pocketedIds.includes(id),
  }));
}

function baseInput(overrides: Partial<ShotInput>): ShotInput {
  return {
    preShotBalls: fullRackBalls(),
    events: [],
    pocketedThisShot: [],
    cueBallPocketed: false,
    cueBallLeftTable: false,
    shooterId: 'p1',
    shooterGroup: null,
    opponentId: 'p2',
    isBreakShot: false,
    groupsAlreadyAssigned: false,
    ...overrides,
  };
}

describe('evaluateShot - fouls', () => {
  it('flags a scratch when the cue ball is pocketed', () => {
    const result = evaluateShot(
      baseInput({
        events: [{ type: 'ball_ball', ballA: 0, ballB: 1 }],
        cueBallPocketed: true,
      })
    );
    expect(result.foul).toBe('scratch');
  });

  it('flags no_ball_contacted when the cue ball hits nothing', () => {
    const result = evaluateShot(baseInput({ events: [] }));
    expect(result.foul).toBe('no_ball_contacted');
  });

  it('does not restrict the break shot to any particular group on first contact', () => {
    // On the break, hitting any ball first is legal regardless of group (no groups assigned yet).
    const result = evaluateShot(
      baseInput({
        isBreakShot: true,
        events: [
          { type: 'ball_ball', ballA: 0, ballB: 9 },
          { type: 'ball_rail', ballA: 9 },
        ],
      })
    );
    expect(result.foul).toBeNull();
  });

  it('still fouls a break with contact but no pocket and no rail contact afterward', () => {
    const result = evaluateShot(
      baseInput({
        isBreakShot: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 1 }],
      })
    );
    expect(result.foul).toBe('no_rail_after_contact');
  });

  it('flags wrong_ball_first when hitting the opponent group first', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 9 }],
      })
    );
    expect(result.foul).toBe('wrong_ball_first');
  });

  it('flags no_rail_after_contact when legal contact is made but nothing pockets or rails', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 1 }],
      })
    );
    expect(result.foul).toBe('no_rail_after_contact');
  });

  it('does not foul when a rail is contacted after legal ball contact', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [
          { type: 'ball_ball', ballA: 0, ballB: 1 },
          { type: 'ball_rail', ballA: 1 },
        ],
      })
    );
    expect(result.foul).toBeNull();
  });
});

describe('evaluateShot - group assignment', () => {
  it('assigns solids to the shooter after potting only a solid post-break', () => {
    const result = evaluateShot(
      baseInput({
        events: [
          { type: 'ball_ball', ballA: 0, ballB: 3 },
          { type: 'ball_rail', ballA: 0 },
        ],
        pocketedThisShot: [3 as BallState['id']],
      })
    );
    expect(result.groupsAssigned).toBe(true);
  });

  it('does not assign a group when both a solid and stripe are pocketed on the same shot', () => {
    const result = evaluateShot(
      baseInput({
        events: [{ type: 'ball_ball', ballA: 0, ballB: 3 }],
        pocketedThisShot: [3, 9] as BallState['id'][],
      })
    );
    expect(result.groupsAssigned).toBe(false);
  });
});

describe('evaluateShot - 8-ball win/loss', () => {
  it('is a legal win when the 8-ball is pocketed after the group is fully cleared', () => {
    const preShot = fullRackBalls([1, 2, 3, 4, 5, 6, 7]); // all solids already gone
    const result = evaluateShot(
      baseInput({
        preShotBalls: preShot,
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [
          { type: 'ball_ball', ballA: 0, ballB: 8 },
          { type: 'ball_rail', ballA: 8 },
        ],
        pocketedThisShot: [8 as BallState['id']],
      })
    );
    expect(result.gameWinnerId).toBe('p1');
    expect(result.foul).toBeNull();
  });

  it('is a loss when the 8-ball is pocketed before the group is cleared (early 8-ball)', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 8 }],
        pocketedThisShot: [8 as BallState['id']],
      })
    );
    expect(result.gameLoserId).toBe('p1');
    expect(result.gameWinnerId).toBe('p2');
    expect(result.foul).toBe('early_eight_ball');
  });

  it('is a loss when the 8-ball is legally pocketed but the cue ball also scratches', () => {
    const preShot = fullRackBalls([1, 2, 3, 4, 5, 6, 7]);
    const result = evaluateShot(
      baseInput({
        preShotBalls: preShot,
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        cueBallPocketed: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 8 }],
        pocketedThisShot: [8 as BallState['id']],
      })
    );
    expect(result.gameLoserId).toBe('p1');
    expect(result.foul).toBe('illegal_eight_ball_pocket');
  });
});

describe('turn management', () => {
  it('passes the turn to the opponent on a foul', () => {
    const result = evaluateShot(baseInput({ events: [] }));
    expect(nextShooter(result, 'p1', 'p2')).toBe('p2');
    expect(shouldGrantBallInHand(result)).toBe(true);
  });

  it('passes the turn to the opponent when nothing is pocketed (no foul)', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [
          { type: 'ball_ball', ballA: 0, ballB: 1 },
          { type: 'ball_rail', ballA: 1 },
        ],
      })
    );
    expect(nextShooter(result, 'p1', 'p2')).toBe('p2');
  });

  it('keeps the turn with the shooter after a legal pot', () => {
    const result = evaluateShot(
      baseInput({
        shooterGroup: 'solids',
        groupsAlreadyAssigned: true,
        events: [{ type: 'ball_ball', ballA: 0, ballB: 1 }],
        pocketedThisShot: [1 as BallState['id']],
      })
    );
    expect(nextShooter(result, 'p1', 'p2')).toBe('p1');
    expect(shouldGrantBallInHand(result)).toBe(false);
  });
});
