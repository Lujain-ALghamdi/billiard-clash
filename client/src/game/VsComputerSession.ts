import type { MatchState, ShotRequest, Difficulty } from '@pool/shared';
import { PHYSICS } from '@pool/shared';
import { LocalMatchEngine } from './LocalMatchEngine';
import { planAIShot, planAIBallInHandPlacement } from '../ai/AIOpponent';
import type { GameSession } from './GameSession';

export class VsComputerSession implements GameSession {
  mode: 'vs_computer' = 'vs_computer';
  myPlayerId: string;
  private engine: LocalMatchEngine;
  private difficulty: Difficulty;
  private stateListeners: ((state: MatchState) => void)[] = [];
  private tickListeners: ((state: MatchState) => void)[] = [];
  private simulating = false;
  private aiThinking = false;
  private aiThinkTimer: ReturnType<typeof setTimeout> | null = null;
  onAIThinkingChange?: (thinking: boolean) => void;

  constructor(humanName: string, difficulty: Difficulty) {
    this.engine = new LocalMatchEngine({ humanName, computerName: `Computer (${difficulty})` });
    this.myPlayerId = this.engine.humanId;
    this.difficulty = difficulty;
  }

  getState(): MatchState {
    return this.engine.state;
  }

  isMyTurn(): boolean {
    return !this.simulating && this.engine.isHumanTurn();
  }

  /** True while ANY shot (human's or the AI's) is actively resolving. */
  isShotInProgress(): boolean {
    return this.simulating;
  }

  submitShot(shot: ShotRequest): void {
    if (this.simulating || !this.isMyTurn()) return;
    this.runShot(shot);
  }

  private runShot(shot: ShotRequest): void {
    this.simulating = true;
    this.engine.beginShot(shot);
    this.simulatePhysics(() => {
      this.engine.resolveShot();
      this.simulating = false;
      this.emitState();
      this.maybeTriggerAI();
    });
  }

  private simulatePhysics(onComplete: () => void): void {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const stopped = this.engine.advance(dt || PHYSICS.FIXED_DT);
      this.tickListeners.forEach((cb) => cb(this.engine.state));
      if (stopped) {
        onComplete();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private maybeTriggerAI(): void {
    // Terminal state: never schedule another AI turn once the match has ended,
    // regardless of whose turn currentTurnPlayerId happens to still say —
    // see LocalMatchEngine.resolveShot(), which intentionally leaves turn
    // ownership untouched on a game-ending shot.
    if (this.engine.state.phase === 'game_over') return;
    if (this.engine.state.currentTurnPlayerId !== this.engine.computerId) return;

    this.aiThinking = true;
    this.onAIThinkingChange?.(true);

    const thinkDelay = 500 + Math.random() * 700;
    this.aiThinkTimer = setTimeout(() => {
      this.aiThinkTimer = null;
      // Guard against a stale timer firing after the match ended or a
      // rematch reset the engine out from under it while we were "thinking".
      if (this.engine.state.phase === 'game_over' || this.engine.state.currentTurnPlayerId !== this.engine.computerId) {
        this.aiThinking = false;
        this.onAIThinkingChange?.(false);
        return;
      }

      const aiGroup = this.engine.getShooterGroup(this.engine.computerId);
      const shot = planAIShot(this.engine.state.balls, aiGroup, this.difficulty);
      this.aiThinking = false;
      this.onAIThinkingChange?.(false);

      let cueBallPlacement: ShotRequest['cueBallPlacement'];
      if (this.engine.state.ballInHand) {
        cueBallPlacement = planAIBallInHandPlacement(
          this.engine.state.balls,
          aiGroup,
          this.difficulty,
          this.engine.isBallInHandRestrictedToHeadString()
        );
      }

      this.runShot({ direction: shot.direction, power: shot.power, cueBallPlacement });
    }, thinkDelay);
  }

  isAIThinking(): boolean {
    return this.aiThinking;
  }

  onStateChange(cb: (state: MatchState) => void): void {
    this.stateListeners.push(cb);
  }

  onTick(cb: (state: MatchState) => void): void {
    this.tickListeners.push(cb);
  }

  private emitState(): void {
    this.stateListeners.forEach((cb) => cb(this.engine.state));
  }

  connectionStatus(): 'connected' {
    return 'connected';
  }

  requestRematch(): void {
    if (this.aiThinkTimer) {
      clearTimeout(this.aiThinkTimer);
      this.aiThinkTimer = null;
    }
    this.aiThinking = false;
    this.simulating = false;
    const p1 = this.engine.state.players[0].name;
    this.engine = new LocalMatchEngine({ humanName: p1, computerName: `Computer (${this.difficulty})` });
    this.emitState();
  }

  onRematchStarted(cb: (state: MatchState) => void): void {
    // For vs-computer, rematch is instant and already covered by onStateChange after requestRematch().
    this.stateListeners.push(cb);
  }

  leave(): void {
    if (this.aiThinkTimer) {
      clearTimeout(this.aiThinkTimer);
      this.aiThinkTimer = null;
    }
    this.stateListeners = [];
    this.tickListeners = [];
  }
}
