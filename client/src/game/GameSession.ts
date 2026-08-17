import type { MatchState, ShotRequest } from '@pool/shared';

export interface GameSession {
  mode: 'vs_computer' | 'online';
  myPlayerId: string;
  getState(): MatchState;
  isMyTurn(): boolean;
  /**
   * True while a shot's physics is actively resolving (ball(s) moving),
   * whether it's the local player's own shot, the opponent's/AI's, or —
   * for online play — a shot still being locally replayed via shot_started.
   * The UI (cue stick, aim line, shoot/placement controls) must gate on
   * this explicitly rather than inferring it from isMyTurn() alone: during
   * the *shooter's own* shot, isMyTurn()-style turn ownership doesn't
   * change until the shot resolves, so relying on isMyTurn() alone lets
   * the cue stick keep rendering (and appear glued to the moving ball)
   * for the whole animation.
   */
  isShotInProgress(): boolean;
  /** Submits a shot. For vs-computer this runs physics locally; for online it round-trips to the server. */
  submitShot(shot: ShotRequest): void;
  /** Registers a callback fired whenever authoritative state changes (after a shot resolves). */
  onStateChange(cb: (state: MatchState) => void): void;
  /** Registers a callback fired with live ball positions during in-flight physics (for smooth rendering). */
  onTick(cb: (state: MatchState) => void): void;
  connectionStatus?(): 'connected' | 'connecting' | 'opponent_disconnected' | 'reconnecting';
  requestRematch(): void;
  onRematchStarted(cb: (state: MatchState) => void): void;
  leave(): void;
}
