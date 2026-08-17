import { describe, it, expect } from 'vitest';
import { buildRack, isLegalCueBallPlacement, TABLE } from '@pool/shared';
import { planAIBallInHandPlacement } from './AIOpponent';

describe('planAIBallInHandPlacement', () => {
  it('always returns a legal, unrestricted placement given a normal rack', () => {
    const balls = buildRack();
    const pos = planAIBallInHandPlacement(balls, null, 'medium', false);
    const otherBalls = balls.filter((b) => b.id !== 0);
    expect(isLegalCueBallPlacement(pos, otherBalls, { restrictToHeadStringArea: false })).toBe(true);
  });

  it('respects the head-string restriction when requested', () => {
    const balls = buildRack();
    const pos = planAIBallInHandPlacement(balls, null, 'medium', true);
    expect(pos.x).toBeGreaterThanOrEqual(TABLE.WIDTH * TABLE.HEAD_STRING_RATIO - 0.01);
  });

  it('never overlaps any on-table object ball', () => {
    const balls = buildRack();
    const pos = planAIBallInHandPlacement(balls, 'solids', 'insane', false);
    const otherBalls = balls.filter((b) => b.id !== 0);
    expect(isLegalCueBallPlacement(pos, otherBalls, {})).toBe(true);
  });

  it('produces a placement even when the AI has an assigned group with few balls left', () => {
    const balls = buildRack();
    // Pocket everything except one solid and the 8-ball, to simulate a near-cleared group.
    for (const b of balls) {
      if (b.id !== 0 && b.id !== 8 && b.id !== 1) {
        b.pocketed = true;
        b.onTable = false;
      }
    }
    const pos = planAIBallInHandPlacement(balls, 'solids', 'hard', false);
    const otherBalls = balls.filter((b) => b.id !== 0);
    expect(isLegalCueBallPlacement(pos, otherBalls, {})).toBe(true);
  });
});
