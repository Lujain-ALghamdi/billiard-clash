/**
 * Physical constants for the table and balls.
 * Units are arbitrary "table units" (tu); the renderer maps tu -> pixels.
 * Proportions mirror a regulation 9-foot table (100" x 50" playing surface, 2.25" ball).
 */

export const TABLE = {
  /** Playing surface (inside the rail cushions), width x height, in table units. */
  WIDTH: 1000,
  HEIGHT: 500,
  /** Rail (cushion) thickness, in table units. */
  RAIL_THICKNESS: 30,
  /** Wooden frame border outside the rail, purely visual. */
  FRAME_THICKNESS: 40,
  /** Pocket mouth radius, in table units. Corner pockets play slightly larger than side pockets. */
  CORNER_POCKET_RADIUS: 32,
  SIDE_POCKET_RADIUS: 28,
  /** Head string is 1/4 of the way up the table from the foot rail (break line). */
  HEAD_STRING_RATIO: 0.75,
  FOOT_SPOT_RATIO: 0.25,
} as const;

export const BALL = {
  RADIUS: 12.5,
  MASS: 1,
} as const;

export const PHYSICS = {
  /** Fixed timestep, in seconds, for stable simulation independent of render FPS. */
  FIXED_DT: 1 / 120,
  /** Rolling friction deceleration, table units / s^2. */
  FRICTION_ROLLING: 260,
  /** Speed (tu/s) below which a ball is considered stopped. */
  STOP_THRESHOLD: 4,
  /** Coefficient of restitution for ball-to-ball collisions (0-1). */
  BALL_RESTITUTION: 0.96,
  /** Coefficient of restitution for ball-to-rail collisions (0-1). */
  RAIL_RESTITUTION: 0.75,
  /** Maximum cue speed applied at 100% shot power, tu/s. */
  MAX_SHOT_SPEED: 1550,
  /** Minimum cue speed applied at the minimum allowed shot power, tu/s. */
  MIN_SHOT_SPEED: 220,
  /** Safety cap on substeps per frame to avoid spiral-of-death on slow devices. */
  MAX_SUBSTEPS: 8,
} as const;

export const SHOT_POWER = {
  MIN: 10,
  MAX: 100,
  DEFAULT: 50,
  STEP_PER_SECOND: 60,
} as const;

export type BallGroup = 'solids' | 'stripes';
export type BallId =
  | 0 // cue ball
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 // solids
  | 8 // eight ball
  | 9 | 10 | 11 | 12 | 13 | 14 | 15; // stripes

export interface BallDefinition {
  id: BallId;
  color: string;
  secondaryColor?: string; // for stripe rendering
  group: BallGroup | 'eight' | 'cue';
}

/** Canonical ball colors, matching real-world WPA-regulation ball sets. */
export const BALL_DEFINITIONS: BallDefinition[] = [
  { id: 0, color: '#f5f3ee', group: 'cue' },
  { id: 1, color: '#f4c430', group: 'solids' },
  { id: 2, color: '#1e4fd8', group: 'solids' },
  { id: 3, color: '#d1272c', group: 'solids' },
  { id: 4, color: '#6a2c91', group: 'solids' },
  { id: 5, color: '#e6772e', group: 'solids' },
  { id: 6, color: '#1c7a4d', group: 'solids' },
  { id: 7, color: '#7a1f1f', group: 'solids' },
  { id: 8, color: '#1a1a1a', group: 'eight' },
  { id: 9, color: '#f5f3ee', secondaryColor: '#f4c430', group: 'stripes' },
  { id: 10, color: '#f5f3ee', secondaryColor: '#1e4fd8', group: 'stripes' },
  { id: 11, color: '#f5f3ee', secondaryColor: '#d1272c', group: 'stripes' },
  { id: 12, color: '#f5f3ee', secondaryColor: '#6a2c91', group: 'stripes' },
  { id: 13, color: '#f5f3ee', secondaryColor: '#e6772e', group: 'stripes' },
  { id: 14, color: '#f5f3ee', secondaryColor: '#1c7a4d', group: 'stripes' },
  { id: 15, color: '#f5f3ee', secondaryColor: '#7a1f1f', group: 'stripes' },
];
