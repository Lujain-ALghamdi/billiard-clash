import { Vec2 } from '../vector2';
import { PHYSICS, SHOT_POWER } from '../constants';
import type { ShotRequest, BallState } from '../types';

/**
 * Maps a shot's 0-100 power value to an initial cue-ball speed, clamped to
 * the configured min/max. This is the single source of truth for the
 * power -> speed curve — the server (authoritative resolution) and both
 * online clients (local shot playback/animation) all call this exact
 * function so a shot's visual trajectory is bit-for-bit reproducible
 * across all three, rather than three hand-maintained copies of the
 * same formula silently drifting apart.
 */
export function computeShotVelocity(shot: ShotRequest): Vec2 {
  const power = Math.max(SHOT_POWER.MIN, Math.min(SHOT_POWER.MAX, shot.power));
  const speed =
    PHYSICS.MIN_SHOT_SPEED +
    ((power - SHOT_POWER.MIN) / (SHOT_POWER.MAX - SHOT_POWER.MIN)) * (PHYSICS.MAX_SHOT_SPEED - PHYSICS.MIN_SHOT_SPEED);
  return Vec2.scale(Vec2.normalize(shot.direction), speed);
}

/**
 * Applies a shot to a ball array in place: places the cue ball if a
 * ball-in-hand placement was supplied, then sets its initial velocity.
 * Returns the mutated cue ball for convenience. Balls must already
 * contain a ball with id 0 (the cue ball).
 */
export function applyShotToBalls(balls: BallState[], shot: ShotRequest): BallState {
  const cue = balls.find((b) => b.id === 0);
  if (!cue) throw new Error('applyShotToBalls: no cue ball (id 0) found in balls array');

  if (shot.cueBallPlacement) {
    cue.position = Vec2.clone(shot.cueBallPlacement);
    cue.velocity = Vec2.zero();
    cue.onTable = true;
    cue.pocketed = false;
  }

  cue.velocity = computeShotVelocity(shot);
  return cue;
}
