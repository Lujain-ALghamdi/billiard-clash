import type { MatchState, ShotRequest, Difficulty } from '@pool/shared';
import { PHYSICS } from '@pool/shared';
import { LocalMatchEngine } from './LocalMatchEngine';
import { planAIShot } from '../ai/AIOpponent';
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
    return this.engine.isHumanTurn();
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
    if (this.engine.state.phase === 'game_over') return;
    if (this.engine.state.currentTurnPlayerId !== this.engine.computerId) return;

    this.aiThinking = true;
    this.onAIThinkingChange?.(true);

    const thinkDelay = 500 + Math.random() * 700;
    setTimeout(() => {
      const aiGroup = this.engine.getShooterGroup(this.engine.computerId);
      const shot = planAIShot(this.engine.state.balls, aiGroup, this.difficulty);
      this.aiThinking = false;
      this.onAIThinkingChange?.(false);

      // Ball-in-hand for the AI: place cue ball at a safe default spot if needed.
      if (this.engine.state.ballInHand) {
        shot.direction = shot.direction; // placement handled inside beginShot via default position if unset
      }
      this.runShot({ direction: shot.direction, power: shot.power });
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
    const p1 = this.engine.state.players[0].name;
    this.engine = new LocalMatchEngine({ humanName: p1, computerName: `Computer (${this.difficulty})` });
    this.emitState();
  }

  onRematchStarted(cb: (state: MatchState) => void): void {
    // For vs-computer, rematch is instant and already covered by onStateChange after requestRematch().
    this.stateListeners.push(cb);
  }

  leave(): void {
    this.stateListeners = [];
    this.tickListeners = [];
  }
}
