import { SHOT_POWER, Vec2, type MatchState } from '@pool/shared';
import { TableRenderer } from './TableRenderer';
import type { GameSession } from './GameSession';
import type { SoundManager } from '../audio/SoundManager';
import type { GameSettings } from '../utils/settings';

export interface GameScreenCallbacks {
  onExitToMenu: () => void;
}

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
  private keysDown = new Set<string>();
  private paused = false;
  private placingCueBall = false;
  private rafId = 0;
  private lastFrameTime = 0;
  private destroyed = false;

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
    this.session.onRematchStarted(() => {
      this.overlayEl.innerHTML = '';
      this.updateHUD();
    });
    this.placingCueBall = this.session.getState().ballInHand;
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
  }

  private onResize = () => this.renderer.resize();

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.mouseTablePos = this.renderer.toTable(screenPt);
    if (!this.placingCueBall) {
      const cue = this.session.getState().balls.find((b) => b.id === 0);
      if (cue) this.aimDirection = Vec2.normalize(Vec2.sub(this.mouseTablePos, cue.position));
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = this.canvas.getBoundingClientRect();
    this.mouseTablePos = this.renderer.toTable({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    if (!this.placingCueBall) {
      const cue = this.session.getState().balls.find((b) => b.id === 0);
      if (cue) this.aimDirection = Vec2.normalize(Vec2.sub(this.mouseTablePos, cue.position));
    }
  };

  private onTouchEnd = () => {
    if (this.placingCueBall) this.confirmCueBallPlacement();
    else this.shoot();
  };

  private onCanvasClick = () => {
    if (this.paused) return;
    if (this.placingCueBall) {
      this.confirmCueBallPlacement();
      return;
    }
    this.shoot();
  };

  private confirmCueBallPlacement(): void {
    if (!this.session.isMyTurn()) return;
    this.placingCueBall = false;
    // Placement is sent along with the next shot request (ballInHand path).
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.power = clamp(this.power - Math.sign(e.deltaY) * 3, SHOT_POWER.MIN, SHOT_POWER.MAX);
    this.updateHUD();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.togglePause();
      return;
    }
    this.keysDown.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.key.toLowerCase());
  };

  private shoot(): void {
    if (this.paused || !this.session.isMyTurn()) return;
    const state = this.session.getState();
    if (state.ballInHand && this.placingCueBall) return; // must confirm placement first

    this.sound.cueStrike(this.power);
    this.session.submitShot({
      direction: this.aimDirection,
      power: this.power,
      cueBallPlacement: state.ballInHand ? Vec2.clone(this.mouseTablePos) : undefined,
    });
    this.power = SHOT_POWER.DEFAULT;
  }

  private togglePause(): void {
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

  private handleStateChange(state: MatchState): void {
    const lastEvents = state.lastShot;
    if (lastEvents) {
      if (lastEvents.foul) this.sound.foul();
      else if (lastEvents.pocketedBalls.length > 0) this.sound.pocket();
    }
    this.placingCueBall = state.ballInHand && this.session.isMyTurn();
    this.updateHUD();
    if (state.phase === 'game_over') {
      this.renderWinLoseScreen(state);
    }
  }

  private renderWinLoseScreen(state: MatchState): void {
    const iWon = state.winnerId === this.session.myPlayerId;
    if (iWon) this.sound.win();
    else this.sound.lose();

    this.overlayEl.innerHTML = `
      <div class="modal panel screen-enter">
        <h2 class="result-title">${iWon ? '🏆 YOU WIN' : 'YOU LOSE'}</h2>
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
  }

  private updateHUD(): void {
    const state = this.session.getState();
    const me = state.players.find((p) => p.id === this.session.myPlayerId)!;
    const opponent = state.players.find((p) => p.id !== this.session.myPlayerId)!;
    const myTurn = this.session.isMyTurn();
    const status = this.session.connectionStatus?.() ?? 'connected';

    const statusLabel: Record<string, string> = {
      connected: 'CONNECTED',
      connecting: 'CONNECTING…',
      opponent_disconnected: 'OPPONENT DISCONNECTED',
      reconnecting: 'RECONNECTING…',
    };

    this.hudEl.innerHTML = `
      <div class="hud-row">
        <div class="hud-player ${myTurn ? 'hud-player--active' : ''}">
          <span class="hud-name">${escapeHtml(me.name)}</span>
          ${me.group ? `<span class="hud-group">${me.group.toUpperCase()}</span>` : ''}
        </div>
        <div class="hud-turn-indicator">${myTurn ? (this.session.mode === 'vs_computer' ? 'YOUR TURN' : 'YOUR TURN') : this.session.mode === 'vs_computer' ? 'COMPUTER THINKING…' : 'OPPONENT TURN'}</div>
        <div class="hud-player ${!myTurn ? 'hud-player--active' : ''}">
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
          <button class="btn btn-ghost btn-small" id="pause-btn" aria-label="Pause">⏸</button>
        </div>
      </div>
      ${state.ballInHand && myTurn ? '<div class="hud-banner">BALL IN HAND — click the table to place the cue ball</div>' : ''}
    `;
    this.hudEl.querySelector('#pause-btn')?.addEventListener('click', () => this.togglePause());
  }

  private loop = (now: number) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    if (!this.paused && this.keysDown.size > 0) {
      if (this.keysDown.has('w')) this.power = clamp(this.power + SHOT_POWER.STEP_PER_SECOND * dt, SHOT_POWER.MIN, SHOT_POWER.MAX);
      if (this.keysDown.has('s')) this.power = clamp(this.power - SHOT_POWER.STEP_PER_SECOND * dt, SHOT_POWER.MIN, SHOT_POWER.MAX);
      this.updateHUD();
    }

    this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private renderFrame(): void {
    const state = this.session.getState();
    this.renderer.clear();
    this.renderer.drawTable();
    this.renderer.drawBalls(state.balls);

    const cue = state.balls.find((b) => b.id === 0 && b.onTable && !b.pocketed);
    if (cue && this.session.isMyTurn() && !this.paused) {
      this.renderer.drawAimLine(cue.position, this.aimDirection, this.settings.aimLineEnabled);
      this.renderer.drawCueStick(cue.position, this.aimDirection, (this.power / 100) * 40);
    }
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
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
