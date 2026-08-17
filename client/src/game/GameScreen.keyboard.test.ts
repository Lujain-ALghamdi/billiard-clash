import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRack, SHOT_POWER, type MatchState, type ShotRequest } from '@pool/shared';
import type { GameSession } from './GameSession';
import { GameScreen } from './GameScreen';
import { SoundManager } from '../audio/SoundManager';
import { DEFAULT_SETTINGS } from '../utils/settings';

/**
 * jsdom does not implement canvas 2D rendering, so we stub getContext('2d')
 * with a Proxy that no-ops every draw call. This is a rendering stub only —
 * it does not affect the input/state logic under test.
 */
function installFakeCanvasContext(): void {
  const gradient = { addColorStop: () => {} };
  const fakeCtx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => {};
      },
      set() {
        return true;
      },
    }
  );
  // @ts-expect-error - test stub, not a real CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = () => fakeCtx;
}

function installRafPolyfill(): void {
  let id = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    id += 1;
    setTimeout(() => cb(performance.now()), 16);
    return id;
  };
  window.cancelAnimationFrame = () => {};
}

class FakeSession implements GameSession {
  mode: 'vs_computer' = 'vs_computer';
  myPlayerId = 'p1';
  submittedShots: ShotRequest[] = [];
  private state: MatchState;

  constructor() {
    this.state = {
      phase: 'break',
      players: [
        { id: 'p1', name: 'Me', group: null, connected: true },
        { id: 'p2', name: 'Them', group: null, connected: true },
      ],
      currentTurnPlayerId: 'p1',
      balls: buildRack(),
      ballInHand: false,
      lastShot: null,
      winnerId: null,
    };
  }

  getState(): MatchState {
    return this.state;
  }
  isMyTurn(): boolean {
    return this.state.currentTurnPlayerId === this.myPlayerId;
  }
  submitShot(shot: ShotRequest): void {
    this.submittedShots.push(shot);
  }
  onStateChange(): void {}
  onTick(): void {}
  onRematchStarted(): void {}
  requestRematch(): void {}
  leave(): void {}
}

describe('GameScreen — layout-independent shot power keys (end-to-end)', () => {
  let root: HTMLElement;
  let session: FakeSession;
  let screen: GameScreen;

  beforeEach(() => {
    installFakeCanvasContext();
    installRafPolyfill();
    root = document.createElement('div');
    document.body.appendChild(root);
    session = new FakeSession();
    screen = new GameScreen(root, session, new SoundManager(DEFAULT_SETTINGS), { ...DEFAULT_SETTINGS }, { onExitToMenu: vi.fn() });
  });

  afterEach(() => {
    screen.destroy();
    root.remove();
  });

  function powerPercentText(): string {
    return root.querySelector('.power-value')?.textContent ?? '';
  }

  it('increases power when the physical W key fires with an Arabic .key value (code=KeyW, key="ش")', async () => {
    const before = powerPercentText();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ش' }));

    // Let a handful of rAF-driven frames run so the held-key tick accumulates.
    await new Promise((resolve) => setTimeout(resolve, 200));

    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'ش' }));
    expect(powerPercentText()).not.toBe(before);
  });

  it('ignores a Latin .key value on the wrong physical key (code mismatch)', () => {
    const initialPower = SHOT_POWER.DEFAULT as number;
    // key:'w' but the physical key is NOT the W position — must not register.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'w' }));
    expect(powerPercentText()).toBe(`${Math.round(initialPower)}%`);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ', key: 'w' }));
  });

  it('Escape still pauses regardless of held power keys', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ش' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    expect(root.querySelector('.modal h2')?.textContent).toContain('PAUSED');
  });
});
