import { Vec2 } from '../vector2';
import { BALL, TABLE } from '../constants';
import type { BallState, FoulReason } from '../types';
import { getPockets } from './engine';

export interface PlacementCheckOptions {
  /**
   * True when this placement must obey the WPA break-foul restriction
   * (ball-in-hand behind the head string only), rather than the standard
   * foul rule (anywhere on the playing surface).
   */
  restrictToHeadStringArea?: boolean;
}

/**
 * The head string is a line at TABLE.WIDTH * HEAD_STRING_RATIO. The head
 * spot (where the cue ball sits for the break — see physics/rack.ts) is on
 * the head-rail side of that line, i.e. at x >= headStringX. WPA restricts
 * a break-foul's ball-in-hand to that same head-rail side of the table.
 */
export function isBehindHeadString(position: Vec2): boolean {
  return position.x >= TABLE.WIDTH * TABLE.HEAD_STRING_RATIO;
}

/**
 * WPA restricts ball-in-hand to behind the head string only when the foul
 * that granted it was committed on the break shot itself. Any other foul
 * (mid-rack) grants unrestricted ball-in-hand anywhere on the table.
 */
export function isBallInHandPlacementRestricted(isBreakShot: boolean, foul: FoulReason | null): boolean {
  return isBreakShot && foul !== null;
}

/**
 * Returns true if `position` is a legal cue-ball-in-hand placement:
 * within the playing surface (inset by the ball radius), not overlapping
 * any other on-table ball, not sitting inside a pocket mouth, and — when
 * restricted — behind the head string.
 *
 * `otherBalls` should be the full ball array; the cue ball itself (id 0)
 * and any already-pocketed/off-table ball are ignored automatically.
 */
export function isLegalCueBallPlacement(position: Vec2, otherBalls: BallState[], options: PlacementCheckOptions = {}): boolean {
  const r = BALL.RADIUS;

  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;

  if (position.x - r < 0 || position.x + r > TABLE.WIDTH) return false;
  if (position.y - r < 0 || position.y + r > TABLE.HEIGHT) return false;

  for (const b of otherBalls) {
    if (b.id === 0 || b.pocketed || !b.onTable) continue;
    if (Vec2.distance(position, b.position) < r * 2) return false;
  }

  for (const pocket of getPockets()) {
    if (Vec2.distance(position, pocket.position) < pocket.radius + r * 0.5) return false;
  }

  if (options.restrictToHeadStringArea && !isBehindHeadString(position)) return false;

  return true;
}

/** A reasonable starting placement (head spot) to re-table a scratched cue ball at before the player/AI chooses its real position. Never the final location — see isLegalCueBallPlacement. */
export function defaultCueBallPlacement(): Vec2 {
  return { x: TABLE.WIDTH * TABLE.HEAD_STRING_RATIO, y: TABLE.HEIGHT / 2 };
}
