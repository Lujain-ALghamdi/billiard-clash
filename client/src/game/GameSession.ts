import type { MatchState, ShotRequest } from '@pool/shared';

export interface GameSession {
  mode: 'vs_computer' | 'online';
  myPlayerId: string;
  getState(): MatchState;
  isMyTurn(): boolean;
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
