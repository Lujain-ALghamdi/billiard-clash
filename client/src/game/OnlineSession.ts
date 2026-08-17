import { applyShotToBalls, stepSimulation, type BallState, type MatchState, type ShotRequest, type ShotStartedPayload } from '@pool/shared';
import { getSocket, saveSession, type GameSocket } from '../multiplayer/SocketClient';
import type { GameSession } from './GameSession';

type AuthoritativeShotApplied = MatchState & { roomCode: string; shotId: string };

/**
 * Server stays authoritative for validation, rules, and the final result —
 * see server/src/rooms/Room.ts. What changes here is purely visual: instead
 * of jumping straight from the pre-shot table to the final post-shot
 * positions, both clients replay the shot locally using the exact same
 * shared physics engine the server used, so the ball motion is genuinely
 * simulated (not tweened/faked) and identical on both screens.
 *
 * Sequence per shot:
 *  1. shot_started arrives (pre-shot ball snapshot + the validated shot).
 *  2. This client runs its own stepSimulation loop via requestAnimationFrame,
 *     calling onTick listeners every frame so GameScreen renders live motion.
 *  3. shot_applied (the authoritative final state) may arrive before local
 *     playback finishes — if so it's buffered, not applied immediately.
 *  4. When local playback settles (allStopped), the buffered authoritative
 *     state (or the one that arrives shortly after) is applied, replacing
 *     the locally-simulated state entirely — this is the reconciliation
 *     point, and it's the only place authoritative state can diverge
 *     visibly from the local replay.
 */
export class OnlineSession implements GameSession {
  mode: 'online' = 'online';
  myPlayerId: string;
  private socket: GameSocket;
  private roomCode: string;
  private state: MatchState;
  private stateListeners: ((state: MatchState) => void)[] = [];
  private tickListeners: ((state: MatchState) => void)[] = [];
  private rematchListeners: ((state: MatchState) => void)[] = [];
  private status: 'connected' | 'connecting' | 'opponent_disconnected' | 'reconnecting' = 'connected';
  onStatusChange?: (status: typeof this.status) => void;
  onErrorMessage?: (message: string) => void;

  private animating = false;
  private currentShotId: string | null = null;
  private bufferedAuthoritative: AuthoritativeShotApplied | null = null;
  private animRafId = 0;
  private lastFrameTime = 0;

  constructor(roomCode: string, playerId: string, initialState: MatchState) {
    this.socket = getSocket();
    this.roomCode = roomCode;
    this.myPlayerId = playerId;
    this.state = initialState;
    saveSession({ roomCode, playerId });
    this.wireEvents();
  }

  private wireEvents(): void {
    this.socket.on('shot_started', this.onShotStarted);
    this.socket.on('shot_applied', this.onShotApplied);
    this.socket.on('room_state', this.onRoomState);
    this.socket.on('opponent_status', this.onOpponentStatus);
    this.socket.on('rematch_started', this.onRematchStartedEvt);
    this.socket.on('error_message', this.onErrorMessageEvt);
  }

  private onShotStarted = (payload: ShotStartedPayload): void => {
    if (payload.roomCode !== this.roomCode) return;

    // Shots can't overlap (server enforces turn order, and submitShot()
    // refuses while animating), but guard defensively: if we're somehow
    // still animating a previous shot, finish it instantly before starting
    // the new one rather than running two rAF loops concurrently.
    if (this.animating) this.finishAnimationImmediately();

    this.animating = true;
    this.currentShotId = payload.shotId;
    this.bufferedAuthoritative = null;

    // Deep-clone the server's pre-shot snapshot as our local working copy —
    // we mutate this via the shared physics engine, never the original.
    const localBalls: BallState[] = payload.preShotBalls.map((b) => ({
      ...b,
      position: { ...b.position },
      velocity: { ...b.velocity },
    }));
    applyShotToBalls(localBalls, payload.shot);
    this.state = { ...this.state, balls: localBalls };

    this.lastFrameTime = performance.now();
    this.animRafId = requestAnimationFrame(this.animationStep);
  };

  private animationStep = (now: number): void => {
    if (!this.animating) return;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    const result = stepSimulation(this.state.balls, dt || 1 / 60);
    this.tickListeners.forEach((cb) => cb(this.state));

    if (result.allStopped) {
      this.finishAnimationImmediately();
    } else {
      this.animRafId = requestAnimationFrame(this.animationStep);
    }
  };

  /** Ends local playback now: reconciles the buffered authoritative state if we have it, otherwise waits for it (shot_applied handler applies directly once !animating). */
  private finishAnimationImmediately(): void {
    cancelAnimationFrame(this.animRafId);
    this.animating = false;

    if (this.bufferedAuthoritative) {
      this.applyAuthoritative(this.bufferedAuthoritative);
      this.bufferedAuthoritative = null;
    }
    this.currentShotId = null;
  }

  private applyAuthoritative(state: AuthoritativeShotApplied): void {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(this.state));
  }

  private onShotApplied = (state: AuthoritativeShotApplied): void => {
    if (this.animating && state.shotId === this.currentShotId) {
      // Authoritative result arrived before our local animation finished —
      // buffer it. Reconciliation happens in finishAnimationImmediately().
      this.bufferedAuthoritative = state;
      return;
    }
    if (this.animating) {
      // A shotId mismatch while animating means a stale/out-of-order event
      // (shouldn't happen over a single ordered socket, but ignore defensively
      // rather than corrupting the in-flight animation).
      return;
    }
    // Not animating — either this shot never got a local playback (e.g. we
    // reconnected mid-shot) or playback already finished. Apply directly.
    this.applyAuthoritative(state);
  };

  private onRoomState = (state: MatchState & { roomCode: string }): void => {
    this.state = state;
    this.stateListeners.forEach((cb) => cb(this.state));
  };

  private onOpponentStatus = ({ connected, reconnecting }: { connected: boolean; reconnecting: boolean }): void => {
    this.status = connected ? 'connected' : reconnecting ? 'reconnecting' : 'opponent_disconnected';
    this.onStatusChange?.(this.status);
  };

  private onRematchStartedEvt = (state: MatchState): void => {
    // A rematch always starts a fresh match — any in-flight animation from
    // the prior match is no longer meaningful.
    if (this.animating) {
      cancelAnimationFrame(this.animRafId);
      this.animating = false;
      this.bufferedAuthoritative = null;
      this.currentShotId = null;
    }
    this.state = state;
    this.rematchListeners.forEach((cb) => cb(this.state));
  };

  private onErrorMessageEvt = ({ message }: { message: string }): void => {
    this.onErrorMessage?.(message);
  };

  getState(): MatchState {
    return this.state;
  }

  isMyTurn(): boolean {
    return !this.animating && this.state.currentTurnPlayerId === this.myPlayerId && this.state.phase !== 'game_over';
  }

  submitShot(shot: ShotRequest): void {
    if (!this.isMyTurn()) return;
    this.socket.emit('take_shot', { roomCode: this.roomCode, shot }, (ack) => {
      if (!ack.ok && ack.error) {
        this.onErrorMessage?.(ack.error.message);
      }
    });
  }

  onStateChange(cb: (state: MatchState) => void): void {
    this.stateListeners.push(cb);
  }

  onTick(cb: (state: MatchState) => void): void {
    this.tickListeners.push(cb);
  }

  connectionStatus() {
    return this.status;
  }

  requestRematch(): void {
    this.socket.emit('request_rematch', { roomCode: this.roomCode });
  }

  onRematchStarted(cb: (state: MatchState) => void): void {
    this.rematchListeners.push(cb);
  }

  leave(): void {
    cancelAnimationFrame(this.animRafId);
    this.animating = false;
    this.bufferedAuthoritative = null;
    this.currentShotId = null;

    this.socket.emit('leave_room', { roomCode: this.roomCode });
    this.socket.off('shot_started', this.onShotStarted);
    this.socket.off('shot_applied', this.onShotApplied);
    this.socket.off('room_state', this.onRoomState);
    this.socket.off('opponent_status', this.onOpponentStatus);
    this.socket.off('rematch_started', this.onRematchStartedEvt);
    this.socket.off('error_message', this.onErrorMessageEvt);
    this.stateListeners = [];
    this.tickListeners = [];
    this.rematchListeners = [];
  }
}
