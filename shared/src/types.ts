import type { Vec2 } from './vector2';
import type { BallGroup, BallId } from './constants';

export type GamePhase = 'break' | 'open_table' | 'in_progress' | 'game_over';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'insane';

export type GameMode = 'online' | 'vs_computer';

export interface BallState {
  id: BallId;
  position: Vec2;
  velocity: Vec2;
  pocketed: boolean;
  /** Angular spin is simplified: only used for AI planning and visual roll, not full 3D physics. */
  onTable: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  group: BallGroup | null;
  connected: boolean;
}

export type FoulReason =
  | 'scratch'
  | 'no_ball_contacted'
  | 'wrong_ball_first'
  | 'no_rail_after_contact'
  | 'illegal_eight_ball_pocket'
  | 'early_eight_ball'
  | 'cue_ball_off_table';

export interface ShotResult {
  foul: FoulReason | null;
  pocketedBalls: BallId[];
  firstBallContacted: BallId | null;
  isBreakShot: boolean;
  groupsAssigned: boolean;
  gameWinnerId: string | null;
  gameLoserId: string | null;
}

export interface MatchState {
  phase: GamePhase;
  players: [PlayerInfo, PlayerInfo];
  currentTurnPlayerId: string;
  balls: BallState[];
  ballInHand: boolean;
  lastShot: ShotResult | null;
  winnerId: string | null;
}

export interface ShotRequest {
  /** Direction is a unit vector; power is 0-100 mapped to MIN/MAX_SHOT_SPEED. */
  direction: Vec2;
  power: number;
  /** Cue ball placement, only sent/valid when ballInHand is true. */
  cueBallPlacement?: Vec2;
}
