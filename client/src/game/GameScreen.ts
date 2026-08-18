import {
  SHOT_POWER,
  Vec2,
  isLegalCueBallPlacement,
  isBallInHandPlacementRestricted,
  type MatchState,
} from '@pool/shared';
import { TableRenderer } from './TableRenderer';
import { PowerKeyController } from './PowerKeyController';
import type { GameSession } from './GameSession';
import type { SoundManager } from '../audio/SoundManager';
import type { GameSettings } from '../utils/settings';

export interface GameScreenCallbacks {
  onExitToMenu: () => void;
}

/** Two-stage ball-in-hand interaction: preview-and-click to place, then aim/shoot from the committed spot. */
type BallInHandStage = 'placing' | 'aiming' | null;

const STRIKE_DURATION_MS = 110;
const CONFETTI_CLEANUP_MS = 2600;

export class GameScreen {
  private root: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private renderer!: TableRenderer;
  private session: GameSession;
  private sound: SoundManager;
  private settings: GameSettings;
  private callbacks: GameScreenCallbacks;

  private power = SHOT_POWER.DEFAULT as number;
  private aimDirection: Vec2 = { x: -1, y: 0 };
  private mouseTablePos: Vec2 = { x: 0, y: 0 };
  private powerKeys = new PowerKeyController();
  private paused = false;
  private rafId = 0;
  private lastFrameTime = 0;
  private destroyed = false;

  // Ball-in-hand interactive placement state.
  private ballInHandStage: BallInHandStage = null;
  private placementPreviewPos: Vec2 = { x: 0, y: 0 };
  private placementValid = false;
  private committedCueBallPlacement: Vec2 | null = null;

  // Cue-strike animation: a short, physics-independent forward jab played
  // at the exact pre-shot cue position/direction, never re-anchored to the
  // (possibly already-moving) cue ball afterward.
  private strikeAnim: { startTime: number; fromPos: Vec2; direction: Vec2; fromPullback: number } | null = null;

  private hudEl!: HTMLElement;
  private overlayEl!: HTMLElement;

  constructor(root: HTMLElement, session: GameSession, sound: SoundManager, settings: GameSettings, callbacks: GameScreenCallbacks) {
    this.root = root;
    this.session = session;
    this.sound = sound;
    this.settings = settings;
    this.callbacks = callbacks;
    this.build();
    this.bindEvents();
    this.session.onStateChange((state) => this.handleStateChange(state));
    this.session.onTick(() => this.renderFrame());
    this.session.onRematchStarted((state) => {
      this.overlayEl.innerHTML = '';
      this.syncBallInHandStage(state);
      this.updateHUD();
    });
    this.syncBallInHandStage(this.session.getState());
    this.loop(performance.now());
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="game-screen">
        <div class="game-hud" id="hud"></div>
        <div class="game-canvas-wrap"><canvas id="table-canvas"></canvas></div>
        <div class="game-overlay" id="overlay"></div>
      </div>
    `;
    this.canvas = this.root.querySelector('#table-canvas')!;
    this.hudEl = this.root.querySelector('#hud')!;
    this.overlayEl = this.root.querySelector('#overlay')!;
    this.renderer = new TableRenderer(this.canvas);
    this.renderer.resize();
    this.updateHUD();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onResize = () => this.renderer.resize();

  /** Whether the table currently accepts aim/placement pointer input at all. */
  private canInteractWithTable(): boolean {
    return !this.paused && this.session.isMyTurn() && !this.session.isShotInProgress();
  }

  private isPlacementRestricted(state: MatchState): boolean {
    return isBallInHandPlacementRestricted(state.lastShot?.isBreakShot ?? false, state.lastShot?.foul ?? null);
  }

  private updatePlacementPreview(pos: Vec2): void {
    this.placementPreviewPos = pos;
    const state = this.session.getState();
    this.placementValid = isLegalCueBallPlacement(pos, state.balls, { restrictToHeadStringArea: this.isPlacementRestricted(state) });
  }

  /** The cue ball position aiming should currently be measured from, or null if there isn't one yet (e.g. still placing). */
  private getEffectiveCuePosition(state: MatchState): Vec2 | null {
    if (this.ballInHandStage === 'aiming' && this.committedCueBallPlacement) return this.committedCueBallPlacement;
    if (this.ballInHandStage === 'placing') return null;
    const cue = state.balls.find((b) => b.id === 0 && b.onTable && !b.pocketed);
    return cue ? cue.position : null;
  }

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.mouseTablePos = this.renderer.toTable(screenPt);
    this.handlePointerMove();
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseTablePos = this.renderer.toTable({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    this.handlePointerMove();
  };

  private handlePointerMove(): void {
    if (!this.canInteractWithTable()) return;
    if (this.ballInHandStage === 'placing') {
      this.updatePlacementPreview(this.mouseTablePos);
      return;
    }
    const cuePos = this.getEffectiveCuePosition(this.session.getState());
    if (cuePos) this.aimDirection = Vec2.normalize(Vec2.sub(this.mouseTablePos, cuePos));
  }

  private onTouchEnd = () => {
    this.handlePointerConfirm();
  };

  private onCanvasClick = () => {
    this.handlePointerConfirm();
  };

  private handlePointerConfirm(): void {
    if (!this.canInteractWithTable()) return;
    if (this.ballInHandStage === 'placing') {
      if (this.placementValid) {
        this.committedCueBallPlacement = Vec2.clone(this.placementPreviewPos);
        this.ballInHandStage = 'aiming';
        const cuePos = this.getEffectiveCuePosition(this.session.getState());
        if (cuePos) this.aimDirection = Vec2.normalize(Vec2.sub(this.mouseTablePos, cuePos));
        this.updateHUD();
      }
      return;
    }
    this.shoot();
  }

  private enterRepositionMode = () => {
    if (!this.canInteractWithTable() || this.ballInHandStage !== 'aiming') return;
    this.ballInHandStage = 'placing';
    if (this.committedCueBallPlacement) this.updatePlacementPreview(this.committedCueBallPlacement);
    this.committedCueBallPlacement = null;
    this.updateHUD();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.paused || this.session.getState().phase === 'game_over') return;
    this.power = clamp(this.power - Math.sign(e.deltaY) * 3, SHOT_POWER.MIN, SHOT_POWER.MAX);
    this.updateHUD();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.togglePause();
      return;
    }
    if (this.powerKeys.handleKeyDown(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.powerKeys.handleKeyUp(e.code);
  };

  private onWindowBlur = () => {
    this.powerKeys.clear();
  };

  private onVisibilityChange = () => {
    if (document.hidden) this.powerKeys.clear();
  };

  private shoot(): void {
    if (this.paused || !this.session.isMyTurn() || this.session.isShotInProgress()) return;
    const state = this.session.getState();
    if (state.ballInHand && (this.ballInHandStage !== 'aiming' || !this.committedCueBallPlacement)) return; // must confirm placement first

    const cuePos = this.getEffectiveCuePosition(state);
    if (!cuePos) return;

    this.beginStrikeAnimation(cuePos, this.aimDirection, (this.power / 100) * 40);
    this.sound.cueStrike(this.power);
    this.session.submitShot({
      direction: this.aimDirection,
      power: this.power,
      cueBallPlacement: state.ballInHand ? Vec2.clone(this.committedCueBallPlacement!) : undefined,
    });
    this.power = SHOT_POWER.DEFAULT;
    this.ballInHandStage = null;
    this.committedCueBallPlacement = null;
    this.updateHUD();
  }

  private beginStrikeAnimation(fromPos: Vec2, direction: Vec2, fromPullback: number): void {
    this.strikeAnim = { startTime: performance.now(), fromPos: Vec2.clone(fromPos), direction: Vec2.clone(direction), fromPullback };
  }

  private togglePause(): void {
    if (this.session.getState().phase === 'game_over') return; // nothing to pause once the match has ended
    this.paused = !this.paused;
    if (this.paused) {
      this.renderPauseMenu();
    } else {
      this.overlayEl.innerHTML = '';
    }
  }

  private renderPauseMenu(): void {
    this.overlayEl.innerHTML = `
      <div class="modal panel screen-enter">
        <div class="eyebrow">Paused</div>
        <h2>PAUSED</h2>
        <div class="modal-actions">
          <button class="btn btn-primary" id="resume-btn">Resume</button>
          <button class="btn btn-secondary" id="mainmenu-btn">Main Menu</button>
        </div>
        <p class="modal-note">${this.session.mode === 'online' ? 'One player cannot restart an online match unilaterally.' : ''}</p>
      </div>
    `;
    this.overlayEl.querySelector('#resume-btn')!.addEventListener('click', () => this.togglePause());
    this.overlayEl.querySelector('#mainmenu-btn')!.addEventListener('click', () => this.exitToMenu());
  }

  private exitToMenu(): void {
    this.session.leave();
    this.callbacks.onExitToMenu();
  }

  /** Enters/exits ball-in-hand placement mode to match the given state, e.g. after a state change or rematch reset. */
  private syncBallInHandStage(state: MatchState): void {
    if (state.ballInHand && this.session.isMyTurn()) {
      this.ballInHandStage = 'placing';
      this.committedCueBallPlacement = null;
      this.updatePlacementPreview(this.mouseTablePos);
    } else {
      this.ballInHandStage = null;
      this.committedCueBallPlacement = null;
    }
  }

  private handleStateChange(state: MatchState): void {
    const lastEvents = state.lastShot;
    if (lastEvents) {
      if (lastEvents.foul) this.sound.foul();
      else if (lastEvents.pocketedBalls.length > 0) this.sound.pocket();
    }
    this.syncBallInHandStage(state);
    this.updateHUD();
    if (state.phase === 'game_over') {
      this.renderWinLoseScreen(state);
    }
  }

  private renderWinLoseScreen(state: MatchState): void {
    const iWon = state.winnerId === this.session.myPlayerId;
    const winner = state.players.find((p) => p.id === state.winnerId);
    const loser = state.players.find((p) => p.id !== state.winnerId);
    if (iWon) this.sound.win();
    else this.sound.lose();

    this.overlayEl.innerHTML = `
      <div class="modal panel screen-enter result-modal">
        ${iWon ? '<div class="confetti-layer" id="confetti"></div>' : ''}
        <h2 class="result-title">${iWon ? '🏆 YOU WIN' : 'YOU LOSE'}</h2>
        ${winner && loser ? `<p class="modal-result-detail">${escapeHtml(winner.name)} defeated ${escapeHtml(loser.name)}</p>` : ''}
        <div class="modal-actions">
          <button class="btn btn-primary" id="rematch-btn">${this.session.mode === 'online' ? 'Request Rematch' : 'Play Again'}</button>
          <button class="btn btn-secondary" id="mainmenu-btn">Main Menu</button>
        </div>
        <p class="modal-note" id="rematch-note"></p>
      </div>
    `;
    this.overlayEl.querySelector('#rematch-btn')!.addEventListener('click', () => {
      this.session.requestRematch();
      const note = this.overlayEl.querySelector('#rematch-note');
      if (note && this.session.mode === 'online') note.textContent = 'Waiting for opponent to agree…';
    });
    this.overlayEl.querySelector('#mainmenu-btn')!.addEventListener('click', () => this.exitToMenu());

    if (iWon) {
      const confettiLayer = this.overlayEl.querySelector<HTMLElement>('#confetti');
      if (confettiLayer) this.spawnConfetti(confettiLayer);
    }
  }

  /** Lightweight, self-cleaning CSS-driven confetti — no canvas, no RAF loop, no dependency. Skips entirely under prefers-reduced-motion. */
  private spawnConfetti(container: HTMLElement): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const colors = ['#c9a24b', '#e3c273', '#8c1f28', '#4a9d6f', '#f3ede0'];
    const count = 40;
    const frag = document.createDocumentFragment();
    const pieces: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = `${Math.random() * 100}%`;
      el.style.backgroundColor = colors[i % colors.length];
      el.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
      el.style.animationDuration = `${(1.6 + Math.random() * 0.8).toFixed(2)}s`;
      el.style.setProperty('--rot', `${Math.round(Math.random() * 360)}deg`);
      frag.appendChild(el);
      pieces.push(el);
    }
    container.appendChild(frag);
    // Bounded, one-shot cleanup — never an ongoing timer/RAF loop.
    setTimeout(() => {
      pieces.forEach((p) => p.remove());
    }, CONFETTI_CLEANUP_MS);
  }

  private updateHUD(): void {
    const state = this.session.getState();
    const me = state.players.find((p) => p.id === this.session.myPlayerId)!;
    const opponent = state.players.find((p) => p.id !== this.session.myPlayerId)!;
    const myTurn = this.session.isMyTurn();
    const status = this.session.connectionStatus?.() ?? 'connected';
    const gameOver = state.phase === 'game_over';

    const statusLabel: Record<string, string> = {
      connected: 'CONNECTED',
      connecting: 'CONNECTING…',
      opponent_disconnected: 'OPPONENT DISCONNECTED',
      reconnecting: 'RECONNECTING…',
    };

    const turnLabel = gameOver
      ? 'GAME OVER'
      : myTurn
        ? 'YOUR TURN'
        : this.session.mode === 'vs_computer'
          ? 'COMPUTER THINKING…'
          : 'OPPONENT TURN';

    let placementBanner = '';
    if (!gameOver && state.ballInHand && myTurn) {
      if (this.ballInHandStage === 'placing') {
        placementBanner = `<div class="hud-banner">BALL IN HAND — move the mouse and click to place the cue ball${this.isPlacementRestricted(state) ? ' (behind the head string)' : ''}</div>`;
      } else if (this.ballInHandStage === 'aiming') {
        placementBanner = `<div class="hud-banner hud-banner--neutral">BALL IN HAND — positioned. <button class="btn btn-ghost btn-small" id="reposition-btn">Reposition</button></div>`;
      }
    }

    this.hudEl.innerHTML = `
      <div class="hud-row">
        <div class="hud-player ${myTurn && !gameOver ? 'hud-player--active' : ''}">
          <span class="hud-name">${escapeHtml(me.name)}</span>
          ${me.group ? `<span class="hud-group">${me.group.toUpperCase()}</span>` : ''}
        </div>
        <div class="hud-turn-indicator">${turnLabel}</div>
        <div class="hud-player ${!myTurn && !gameOver ? 'hud-player--active' : ''}">
          <span class="hud-name">${escapeHtml(opponent.name)}</span>
          ${opponent.group ? `<span class="hud-group">${opponent.group.toUpperCase()}</span>` : ''}
        </div>
      </div>
      <div class="hud-row hud-row--secondary">
        ${this.session.mode === 'online' ? `<div class="hud-status">${statusLabel[status]}</div>` : ''}
        <div class="hud-power">
          <span class="eyebrow">Shot Power</span>
          <div class="power-bar"><div class="power-bar-fill" style="width:${this.power}%"></div></div>
          <span class="power-value">${Math.round(this.power)}%</span>
        </div>
        <div class="hud-buttons">
          <button class="btn btn-ghost btn-small" id="pause-btn" aria-label="Pause" ${gameOver ? 'disabled' : ''}>⏸</button>
        </div>
      </div>
      ${placementBanner}
    `;
    this.hudEl.querySelector('#pause-btn')?.addEventListener('click', () => this.togglePause());
    this.hudEl.querySelector('#reposition-btn')?.addEventListener('click', this.enterRepositionMode);
  }

  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.paused && this.powerKeys.hasAny() && this.session.getState().phase !== 'game_over') {
      this.power = this.powerKeys.tick(this.power, dt);
      this.updateHUD();
    }

    this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private renderFrame(): void {
    const state = this.session.getState();
    this.renderer.clear();
    this.renderer.drawTable();

    // While placement/aiming is overriding the cue ball's visual position,
    // draw every OTHER ball normally and render the cue ball separately
    // below, rather than at its stale authoritative position.
    const overridingCuePosition = this.ballInHandStage !== null;
    this.renderer.drawBalls(state.balls, overridingCuePosition);

    if (this.ballInHandStage === 'placing') {
      this.renderer.drawPlacementPreview(this.placementPreviewPos, this.placementValid);
    } else if (this.ballInHandStage === 'aiming' && this.committedCueBallPlacement) {
      this.renderer.drawBalls([{ id: 0, position: this.committedCueBallPlacement, velocity: Vec2.zero(), pocketed: false, onTable: true }]);
    }

    const now = performance.now();
    const strikeActive = this.strikeAnim !== null && now - this.strikeAnim.startTime < STRIKE_DURATION_MS;

    if (strikeActive) {
      // Fixed-duration forward jab, anchored to where the cue ball WAS at
      // the moment of the shot — never re-read from the (possibly already
      // moving) live cue ball, so it can never appear glued to it.
      const t = (now - this.strikeAnim!.startTime) / STRIKE_DURATION_MS;
      const pullback = this.strikeAnim!.fromPullback * (1 - t);
      this.renderer.drawCueStick(this.strikeAnim!.fromPos, this.strikeAnim!.direction, pullback);
    } else {
      if (this.strikeAnim) this.strikeAnim = null; // one-shot animation, self-cleaning once played

      const cuePos = this.getEffectiveCuePosition(state);
      const showAimingCue =
        cuePos &&
        this.ballInHandStage !== 'placing' &&
        this.session.isMyTurn() &&
        !this.session.isShotInProgress() &&
        !this.paused;

      if (showAimingCue && cuePos) {
        this.renderer.drawAimLine(cuePos, this.aimDirection, this.settings.aimLineEnabled);
        this.renderer.drawCueStick(cuePos, this.aimDirection, (this.power / 100) * 40);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.powerKeys.clear();
    this.strikeAnim = null;
    this.session.leave();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
