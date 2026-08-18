import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildRack, type MatchState, type ShotRequest } from '@pool/shared';
import type { GameSession } from './GameSession';
import { GameScreen } from './GameScreen';
import { TableRenderer } from './TableRenderer';
import { SoundManager } from '../audio/SoundManager';
import { DEFAULT_SETTINGS } from '../utils/settings';

function installFakeAudioContext(): void {
  const fakeNode: any = {};
  fakeNode.connect = () => fakeNode;
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    state = 'running';
    sampleRate = 44100;
    createOscillator() {
      return { type: '', frequency: { setValueAtTime: () => {} }, connect: () => fakeNode, start: () => {}, stop: () => {} };
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => fakeNode,
      };
    }
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, connect: () => fakeNode };
    }
    createBuffer(_channels: number, length: number, sampleRate: number) {
      return { getChannelData: () => new Float32Array(length), length, sampleRate };
    }
    createBufferSource() {
      return { buffer: null, connect: () => fakeNode, start: () => {} };
    }
    resume() {
      return Promise.resolve();
    }
  }
  // @ts-expect-error - test stub, not a real AudioContext
  window.AudioContext = FakeAudioContext;
}

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
    setTimeout(() => cb(performance.now()), 4);
    return id;
  };
  window.cancelAnimationFrame = (timerId: number) => clearTimeout(timerId);
}

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeSession implements GameSession {
  mode: 'vs_computer' | 'online' = 'vs_computer';
  myPlayerId = 'p1';
  submittedShots: ShotRequest[] = [];
  rematchCalled = false;
  leaveCalled = false;
  private state: MatchState;
  private myTurn = true;
  private shotInProgress = false;
  private stateListeners: ((s: MatchState) => void)[] = [];
  private tickListeners: ((s: MatchState) => void)[] = [];

  constructor(overrides: Partial<MatchState> = {}) {
    this.state = {
      phase: 'in_progress',
      players: [
        { id: 'p1', name: 'Me', group: null, connected: true },
        { id: 'p2', name: 'Them', group: null, connected: true },
      ],
      currentTurnPlayerId: 'p1',
      balls: buildRack(),
      ballInHand: false,
      lastShot: null,
      winnerId: null,
      ...overrides,
    };
  }

  getState(): MatchState {
    return this.state;
  }
  setMyTurn(v: boolean): void {
    this.myTurn = v;
  }
  isMyTurn(): boolean {
    return this.myTurn;
  }
  setShotInProgress(v: boolean): void {
    this.shotInProgress = v;
  }
  isShotInProgress(): boolean {
    return this.shotInProgress;
  }
  submitShot(shot: ShotRequest): void {
    this.submittedShots.push(shot);
  }
  onStateChange(cb: (s: MatchState) => void): void {
    this.stateListeners.push(cb);
  }
  onTick(cb: (s: MatchState) => void): void {
    this.tickListeners.push(cb);
  }
  onRematchStarted(): void {}
  requestRematch(): void {
    this.rematchCalled = true;
  }
  leave(): void {
    this.leaveCalled = true;
  }
  /** Test helper: simulates an authoritative state update (as onStateChange would deliver). */
  triggerStateChange(patch: Partial<MatchState>): void {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((cb) => cb(this.state));
  }
}

describe('GameScreen — cue visibility is gated on isShotInProgress, not just isMyTurn', () => {
  let root: HTMLElement;
  let session: FakeSession;
  let screen: GameScreen;
  let drawCueSpy: ReturnType<typeof vi.spyOn>;
  let drawAimSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    installFakeCanvasContext();
    installFakeAudioContext();
    installRafPolyfill();
    root = document.createElement('div');
    document.body.appendChild(root);
    drawCueSpy = vi.spyOn(TableRenderer.prototype, 'drawCueStick');
    drawAimSpy = vi.spyOn(TableRenderer.prototype, 'drawAimLine');
    session = new FakeSession();
    screen = new GameScreen(root, session, new SoundManager(DEFAULT_SETTINGS), { ...DEFAULT_SETTINGS }, { onExitToMenu: vi.fn() });
  });

  afterEach(() => {
    screen.destroy();
    root.remove();
    vi.restoreAllMocks();
  });

  it('draws the cue and aim line while at rest and it is the player\'s turn', async () => {
    await tick(40);
    expect(drawCueSpy).toHaveBeenCalled();
    expect(drawAimSpy).toHaveBeenCalled();
  });

  it('hides the cue once a shot is in progress, even though isMyTurn transiently stays true', async () => {
    await tick(20);
    session.setMyTurn(true); // exactly the buggy condition: turn ownership hasn't changed yet
    session.setShotInProgress(true);
    drawCueSpy.mockClear();
    drawAimSpy.mockClear();
    await tick(40);
    expect(drawCueSpy).not.toHaveBeenCalled();
    expect(drawAimSpy).not.toHaveBeenCalled();
  });

  it('does not drag the cue with the moving ball — no cue drawing calls at all while in progress, regardless of ball position', async () => {
    session.setShotInProgress(true);
    drawCueSpy.mockClear();
    for (let i = 0; i < 5; i++) {
      session.getState().balls[0].position.x += 10;
      await tick(15);
    }
    expect(drawCueSpy).not.toHaveBeenCalled();
  });

  it('shows the cue again once the shot ends and it is still the player\'s turn', async () => {
    session.setShotInProgress(true);
    await tick(20);
    session.setShotInProgress(false);
    drawCueSpy.mockClear();
    await tick(40);
    expect(drawCueSpy).toHaveBeenCalled();
  });

  it('keeps the cue hidden after a shot ends if it is now the opponent\'s turn', async () => {
    session.setShotInProgress(true);
    session.setMyTurn(false);
    await tick(20);
    session.setShotInProgress(false);
    drawCueSpy.mockClear();
    await tick(40);
    expect(drawCueSpy).not.toHaveBeenCalled();
  });
});

describe('GameScreen — end-of-game result modal', () => {
  let root: HTMLElement;
  let session: FakeSession;
  let screen: GameScreen;
  let onExitToMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installFakeCanvasContext();
    installFakeAudioContext();
    installRafPolyfill();
    root = document.createElement('div');
    document.body.appendChild(root);
    onExitToMenu = vi.fn();
    session = new FakeSession();
    screen = new GameScreen(root, session, new SoundManager(DEFAULT_SETTINGS), { ...DEFAULT_SETTINGS }, { onExitToMenu });
  });

  afterEach(() => {
    screen.destroy();
    root.remove();
  });

  it('shows a victory modal with winner/opponent names when winnerId is the local player', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p1' });
    const title = root.querySelector('.result-title');
    expect(title?.textContent).toContain('YOU WIN');
    expect(root.querySelector('.modal-result-detail')?.textContent).toContain('Me');
    expect(root.querySelector('.modal-result-detail')?.textContent).toContain('Them');
  });

  it('shows a loss modal when winnerId is the opponent', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p2' });
    expect(root.querySelector('.result-title')?.textContent).toContain('YOU LOSE');
  });

  it('renders a confetti layer only on a win, not a loss', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p1' });
    expect(root.querySelector('#confetti')).not.toBeNull();

    session.triggerStateChange({ phase: 'game_over', winnerId: 'p2' });
    expect(root.querySelector('#confetti')).toBeNull();
  });

  it('the turn indicator shows GAME OVER, not COMPUTER THINKING, once the match has ended', () => {
    session.setMyTurn(false);
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p2' });
    expect(root.querySelector('.hud-turn-indicator')?.textContent).toBe('GAME OVER');
  });

  it('Play Again calls requestRematch() for vs-computer mode', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p1' });
    root.querySelector<HTMLButtonElement>('#rematch-btn')!.click();
    expect(session.rematchCalled).toBe(true);
  });

  it('Main Menu leaves the session and returns to the menu', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p1' });
    root.querySelector<HTMLButtonElement>('#mainmenu-btn')!.click();
    expect(session.leaveCalled).toBe(true);
    expect(onExitToMenu).toHaveBeenCalledTimes(1);
  });

  it('the pause button is disabled once the game has ended', () => {
    session.triggerStateChange({ phase: 'game_over', winnerId: 'p1' });
    const pauseBtn = root.querySelector<HTMLButtonElement>('#pause-btn');
    expect(pauseBtn?.disabled).toBe(true);
  });
});

describe('GameScreen — interactive ball-in-hand placement', () => {
  let root: HTMLElement;
  let session: FakeSession;
  let screen: GameScreen;

  beforeEach(() => {
    installFakeCanvasContext();
    installFakeAudioContext();
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

  it('enters placement mode and shows the BALL IN HAND banner when it becomes the player\'s turn with ballInHand active', () => {
    session.triggerStateChange({ ballInHand: true });
    expect((screen as any).ballInHandStage).toBe('placing');
    expect(root.querySelector('.hud-banner')?.textContent).toContain('BALL IN HAND');
  });

  it('does not enter placement mode if ballInHand is active but it is not the player\'s turn', () => {
    session.setMyTurn(false);
    session.triggerStateChange({ ballInHand: true });
    expect((screen as any).ballInHandStage).toBeNull();
  });

  it('a legal preview position is accepted: click commits it and transitions to the aiming stage', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: 500, y: 250 });
    expect((screen as any).placementValid).toBe(true);

    (screen as any).handlePointerConfirm();

    expect((screen as any).ballInHandStage).toBe('aiming');
    expect((screen as any).committedCueBallPlacement).toEqual({ x: 500, y: 250 });
  });

  it('an illegal preview position (out of bounds) is rejected: click does not commit it', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: -50, y: 250 });
    expect((screen as any).placementValid).toBe(false);

    (screen as any).handlePointerConfirm();

    expect((screen as any).ballInHandStage).toBe('placing');
    expect((screen as any).committedCueBallPlacement).toBeNull();
  });

  it('an illegal preview position overlapping another ball is rejected', () => {
    session.triggerStateChange({ ballInHand: true });
    const someBall = session.getState().balls.find((b) => b.id !== 0)!;
    (screen as any).updatePlacementPreview({ x: someBall.position.x, y: someBall.position.y });
    expect((screen as any).placementValid).toBe(false);
  });

  it('the cue ball visibly stays at the chosen position once committed (not a fixed magic coordinate)', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: 600, y: 300 });
    (screen as any).handlePointerConfirm();
    expect((screen as any).getEffectiveCuePosition(session.getState())).toEqual({ x: 600, y: 300 });
  });

  it('shooting from a committed placement includes that exact position in the submitted shot', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: 620, y: 180 });
    (screen as any).handlePointerConfirm();

    (screen as any).aimDirection = { x: -1, y: 0 };
    (screen as any).shoot();

    expect(session.submittedShots).toHaveLength(1);
    expect(session.submittedShots[0].cueBallPlacement).toEqual({ x: 620, y: 180 });
  });

  it('cannot shoot while still in the placing stage (must confirm first)', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).shoot();
    expect(session.submittedShots).toHaveLength(0);
  });

  it('the Reposition control returns to placement mode without losing the ability to choose a new spot', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: 500, y: 250 });
    (screen as any).handlePointerConfirm();
    expect((screen as any).ballInHandStage).toBe('aiming');

    root.querySelector<HTMLButtonElement>('#reposition-btn')!.click();

    expect((screen as any).ballInHandStage).toBe('placing');
    expect((screen as any).committedCueBallPlacement).toBeNull();

    (screen as any).updatePlacementPreview({ x: 700, y: 300 });
    (screen as any).handlePointerConfirm();
    expect((screen as any).committedCueBallPlacement).toEqual({ x: 700, y: 300 });
  });

  it('does not use the old fixed {750,250} coordinate as a forced placement — a different legal spot is honored exactly', () => {
    session.triggerStateChange({ ballInHand: true });
    (screen as any).updatePlacementPreview({ x: 300, y: 400 });
    (screen as any).handlePointerConfirm();
    expect((screen as any).committedCueBallPlacement).toEqual({ x: 300, y: 400 });
    expect((screen as any).committedCueBallPlacement).not.toEqual({ x: 750, y: 250 });
  });
});
