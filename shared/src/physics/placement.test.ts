import { describe, it, expect } from 'vitest';
import { isLegalCueBallPlacement, isBehindHeadString, isBallInHandPlacementRestricted, defaultCueBallPlacement } from './placement';
import { BALL, TABLE, getPockets } from '../index';
import type { BallState } from '../types';

function makeBall(id: number, x: number, y: number): BallState {
  return { id: id as BallState['id'], position: { x, y }, velocity: { x: 0, y: 0 }, pocketed: false, onTable: true };
}

describe('isLegalCueBallPlacement', () => {
  it('accepts a clear, in-bounds, unrestricted position', () => {
    expect(isLegalCueBallPlacement({ x: 500, y: 250 }, [])).toBe(true);
  });

  it('rejects a position outside the table on the left', () => {
    expect(isLegalCueBallPlacement({ x: -5, y: 250 }, [])).toBe(false);
  });

  it('rejects a position outside the table on the right', () => {
    expect(isLegalCueBallPlacement({ x: TABLE.WIDTH + 5, y: 250 }, [])).toBe(false);
  });

  it('rejects a position outside the table vertically', () => {
    expect(isLegalCueBallPlacement({ x: 500, y: -5 }, [])).toBe(false);
    expect(isLegalCueBallPlacement({ x: 500, y: TABLE.HEIGHT + 5 }, [])).toBe(false);
  });

  it('rejects a position that overlaps another ball', () => {
    const other = [makeBall(1, 500, 250)];
    expect(isLegalCueBallPlacement({ x: 505, y: 250 }, other)).toBe(false);
  });

  it('accepts a position that clears another ball by at least two radii', () => {
    const other = [makeBall(1, 500, 250)];
    expect(isLegalCueBallPlacement({ x: 500 + BALL.RADIUS * 2 + 1, y: 250 }, other)).toBe(true);
  });

  it('ignores the cue ball itself (id 0) and pocketed/off-table balls when checking overlap', () => {
    const other = [
      { ...makeBall(0, 500, 250) },
      { ...makeBall(2, 500, 250), pocketed: true, onTable: false },
    ];
    expect(isLegalCueBallPlacement({ x: 500, y: 250 }, other)).toBe(true);
  });

  it('rejects a position inside a pocket mouth', () => {
    const pocket = getPockets()[0]; // a corner pocket
    expect(isLegalCueBallPlacement(pocket.position, [])).toBe(false);
  });

  it('rejects a position behind the head string when restricted', () => {
    const headStringX = TABLE.WIDTH * TABLE.HEAD_STRING_RATIO;
    // Just on the foot-rail side (not behind the head string) — should fail when restricted.
    expect(isLegalCueBallPlacement({ x: headStringX - 10, y: 250 }, [], { restrictToHeadStringArea: true })).toBe(false);
  });

  it('accepts a position behind the head string when restricted', () => {
    const headStringX = TABLE.WIDTH * TABLE.HEAD_STRING_RATIO;
    expect(isLegalCueBallPlacement({ x: headStringX + 10, y: 250 }, [], { restrictToHeadStringArea: true })).toBe(true);
  });

  it('does not apply the head-string restriction when not requested', () => {
    const headStringX = TABLE.WIDTH * TABLE.HEAD_STRING_RATIO;
    expect(isLegalCueBallPlacement({ x: headStringX - 10, y: 250 }, [])).toBe(true);
  });

  it('rejects non-finite coordinates', () => {
    expect(isLegalCueBallPlacement({ x: NaN, y: 250 }, [])).toBe(false);
    expect(isLegalCueBallPlacement({ x: Infinity, y: 250 }, [])).toBe(false);
  });
});

describe('isBehindHeadString', () => {
  it('is true exactly at and beyond the head string line', () => {
    const headStringX = TABLE.WIDTH * TABLE.HEAD_STRING_RATIO;
    expect(isBehindHeadString({ x: headStringX, y: 100 })).toBe(true);
    expect(isBehindHeadString({ x: headStringX + 1, y: 100 })).toBe(true);
    expect(isBehindHeadString({ x: headStringX - 1, y: 100 })).toBe(false);
  });
});

describe('isBallInHandPlacementRestricted', () => {
  it('restricts only when the foul was on the break shot', () => {
    expect(isBallInHandPlacementRestricted(true, 'no_ball_contacted')).toBe(true);
    expect(isBallInHandPlacementRestricted(false, 'no_ball_contacted')).toBe(false);
  });

  it('does not restrict when there was no foul', () => {
    expect(isBallInHandPlacementRestricted(true, null)).toBe(false);
  });
});

describe('defaultCueBallPlacement', () => {
  it('returns a position that is itself legal on an empty table', () => {
    expect(isLegalCueBallPlacement(defaultCueBallPlacement(), [])).toBe(true);
  });
});
