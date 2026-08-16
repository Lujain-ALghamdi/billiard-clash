import type { MatchState, ShotRequest } from '@pool/shared';
import { getSocket, saveSession, type GameSocket } from '../multiplayer/SocketClient';
import type { GameSession } from './GameSession';

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

  constructor(roomCode: string, playerId: string, initialState: MatchState) {
    this.socket = getSocket();
    this.roomCode = roomCode;
    this.myPlayerId = playerId;
    this.state = initialState;
    saveSession({ roomCode, playerId });
    this.wireEvents();
  }

  private wireEvents(): void {
    this.socket.on('shot_applied', (state) => {
      this.state = state;
      this.stateListeners.forEach((cb) => cb(this.state));
    });
    this.socket.on('room_state', (state) => {
      this.state = state;
      this.stateListeners.forEach((cb) => cb(this.state));
    });
    this.socket.on('opponent_status', ({ connected, reconnecting }) => {
      this.status = connected ? 'connected' : reconnecting ? 'reconnecting' : 'opponent_disconnected';
      this.onStatusChange?.(this.status);
    });
    this.socket.on('rematch_started', (state) => {
      this.state = state;
      this.rematchListeners.forEach((cb) => cb(this.state));
    });
    this.socket.on('error_message', ({ message }) => {
      this.onErrorMessage?.(message);
    });
  }

  getState(): MatchState {
    return this.state;
  }

  isMyTurn(): boolean {
    return this.state.currentTurnPlayerId === this.myPlayerId && this.state.phase !== 'game_over';
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
    // Online play does not simulate physics locally for the receiving client;
    // the renderer interpolates between the last two authoritative states instead.
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
    this.socket.emit('leave_room', { roomCode: this.roomCode });
    this.socket.removeAllListeners('shot_applied');
    this.socket.removeAllListeners('room_state');
    this.socket.removeAllListeners('opponent_status');
    this.socket.removeAllListeners('rematch_started');
    this.socket.removeAllListeners('error_message');
    this.stateListeners = [];
    this.tickListeners = [];
    this.rematchListeners = [];
  }
}
