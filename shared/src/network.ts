import type { BallState, MatchState, ShotRequest } from './types';

/** Events sent from client to server. */
export interface ClientToServerEvents {
  create_room: (payload: { playerName: string }, ack: (res: CreateRoomResponse) => void) => void;
  join_room: (payload: { roomCode: string; playerName: string }, ack: (res: JoinRoomResponse) => void) => void;
  rejoin_room: (payload: { roomCode: string; playerId: string }, ack: (res: JoinRoomResponse) => void) => void;
  leave_room: (payload: { roomCode: string }) => void;
  take_shot: (payload: { roomCode: string; shot: ShotRequest }, ack: (res: ActionAck) => void) => void;
  request_rematch: (payload: { roomCode: string }) => void;
  chat_message?: (payload: { roomCode: string; text: string }) => void;
}

/**
 * Broadcast the instant a shot is validated, before the server resolves it.
 * Both clients replay this shot locally (via the shared physics engine)
 * for a smooth ~60fps animation, rather than jumping straight to the
 * final post-shot positions. See shot_applied for the authoritative result.
 */
export interface ShotStartedPayload {
  roomCode: string;
  /** Correlates this playback with the shot_applied broadcast that finalizes it. */
  shotId: string;
  /** Ball positions at rest, immediately before this shot's velocity is applied. */
  preShotBalls: BallState[];
  /** The validated shot (server-clamped power, resolved cueBallPlacement if any). */
  shot: ShotRequest;
  shooterId: string;
  isBreakShot: boolean;
}

/** Events sent from server to client. */
export interface ServerToClientEvents {
  room_state: (state: MatchState & { roomCode: string }) => void;
  opponent_status: (status: { connected: boolean; reconnecting: boolean }) => void;
  shot_started: (payload: ShotStartedPayload) => void;
  /** Authoritative final state. shotId correlates it with the shot_started that preceded it. */
  shot_applied: (state: MatchState & { roomCode: string; shotId: string }) => void;
  rematch_requested: (payload: { byPlayerId: string }) => void;
  rematch_started: (state: MatchState) => void;
  error_message: (payload: { code: ErrorCode; message: string }) => void;
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_ROOM_CODE'
  | 'NOT_YOUR_TURN'
  | 'INVALID_SHOT'
  | 'MATCH_NOT_ACTIVE'
  | 'SERVER_ERROR';

export interface ActionAck {
  ok: boolean;
  error?: { code: ErrorCode; message: string };
}

export interface CreateRoomResponse extends ActionAck {
  roomCode?: string;
  playerId?: string;
}

export interface JoinRoomResponse extends ActionAck {
  playerId?: string;
  state?: MatchState;
}

/** Generates a room code in the form "8B-X7K2". Excludes ambiguous chars (0/O, 1/I). */
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `8B-${code}`;
}

export function isValidRoomCode(code: string): boolean {
  return /^8B-[A-Z0-9]{4}$/.test(code.trim().toUpperCase());
}
