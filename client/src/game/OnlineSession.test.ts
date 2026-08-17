import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRack, type MatchState } from '@pool/shared';

/**
 * A minimal fake of the socket.io-client Socket surface, extended from the
 * one used in OnlineMenu.test.ts to also support take_shot's ack callback.
 */
class FakeSocket {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  emitCalls: { event: string; payload: any }[] = [];
  /** Override per-test to control what take_shot's ack receives. */
  takeShotAckResponse: { ok: boolean } = { ok: true };

  on(event: string, cb: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: string, cb?: (...args: any[]) => void): void {
    if (!cb) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.get(event)?.delete(cb);
  }

  emit(event: string, payload: any, ack?: (...args: any[]) => void): void {
    this.emitCalls.push({ event, payload });
    if (event === 'take_shot' && ack) ack(this.takeShotAckResponse);
  }

  trigger(event: string, ...args: any[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  totalListenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

/** A controllable requestAnimationFrame so tests can step frames deterministically. */
function installControllableRaf() {
  let queue: { id: number; cb: FrameRequestCallback }[] = [];
  let nextId = 1;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue = queue.filter((q) => q.id !== id);
  };
  return {
    /** Runs whatever is currently queued (callbacks may enqueue more for the next flush). */
    flush(time: number): number {
      const ran = queue;
      queue = [];
      ran.forEach(({ cb }) => cb(time));
      return ran.length;
    },
    pendingCount(): number {
      return queue.length;
    },
  };
}

let fakeSocket: FakeSocket;

vi.mock('../multiplayer/SocketClient', () => ({
  getSocket: () => fakeSocket,
  saveSession: vi.fn(),
}));

const { OnlineSession } = await import('./OnlineSession');

function makeInitialState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    phase: 'break',
    players: [
      { id: 'host-id', name: 'Host', group: null, connected: true },
      { id: 'guest-id', name: 'Guest', group: null, connected: true },
    ],
    currentTurnPlayerId: 'host-id',
    balls: buildRack(),
    ballInHand: false,
    lastShot: null,
    winnerId: null,
    ...overrides,
  };
}

function shotStartedPayload(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: '8B-TEST',
    shotId: 'shot-1',
    preShotBalls: buildRack(),
    shot: { direction: { x: -1, y: 0.02 }, power: 90 },
    shooterId: 'host-id',
    isBreakShot: true,
    ...overrides,
  };
}

describe('OnlineSession — local shot playback (animation)', () => {
  let raf: ReturnType<typeof installControllableRaf>;

  beforeEach(() => {
    fakeSocket = new FakeSocket();
    raf = installControllableRaf();
  });

  it('shot_started begins a local playback simulation and calls onTick multiple times', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    const ticks: MatchState[] = [];
    session.onTick((state) => ticks.push(state));

    fakeSocket.trigger('shot_started', shotStartedPayload());
    expect(raf.pendingCount()).toBe(1); // the first animation frame was scheduled

    let time = performance.now();
    for (let i = 0; i < 5; i++) {
      time += 16;
      raf.flush(time);
    }

    expect(ticks.length).toBeGreaterThanOrEqual(5);
  });

  it('ball positions change progressively across ticks rather than jumping straight to a final position', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    const cuePositions: { x: number; y: number }[] = [];
    session.onTick((state) => {
      const cue = state.balls.find((b) => b.id === 0)!;
      cuePositions.push({ ...cue.position });
    });

    fakeSocket.trigger('shot_started', shotStartedPayload());
    let time = performance.now();
    for (let i = 0; i < 8; i++) {
      time += 16;
      raf.flush(time);
    }

    expect(cuePositions.length).toBeGreaterThanOrEqual(8);
    const distinctPositions = new Set(cuePositions.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(distinctPositions.size).toBeGreaterThan(1);
    for (let i = 1; i < cuePositions.length; i++) {
      const dx = cuePositions[i].x - cuePositions[i - 1].x;
      const dy = cuePositions[i].y - cuePositions[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThan(60); // generous per-frame cap; a "jump to final" would be hundreds of units
    }
  });

  it('buffers an early-arriving authoritative shot_applied instead of skipping the animation', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    const stateChanges: MatchState[] = [];
    session.onStateChange((state) => stateChanges.push(state));

    fakeSocket.trigger('shot_started', shotStartedPayload());

    const authoritative = { ...makeInitialState({ phase: 'open_table', currentTurnPlayerId: 'guest-id' }), roomCode: '8B-TEST', shotId: 'shot-1' };
    fakeSocket.trigger('shot_applied', authoritative);

    expect(stateChanges).toHaveLength(0);
    expect(session.getState().phase).toBe('break');
  });

  it('applies the authoritative final state once local animation completes', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    const stateChanges: MatchState[] = [];
    session.onStateChange((state) => stateChanges.push(state));

    fakeSocket.trigger('shot_started', shotStartedPayload({ shot: { direction: { x: -1, y: 0 }, power: 11 } }));

    const authoritative = { ...makeInitialState({ phase: 'open_table', currentTurnPlayerId: 'guest-id' }), roomCode: '8B-TEST', shotId: 'shot-1' };
    fakeSocket.trigger('shot_applied', authoritative);
    expect(stateChanges).toHaveLength(0);

    let time = performance.now();
    for (let i = 0; i < 300 && raf.pendingCount() > 0; i++) {
      time += 16;
      raf.flush(time);
    }

    expect(stateChanges).toHaveLength(1);
    expect(session.getState().phase).toBe('open_table');
    expect(session.getState().currentTurnPlayerId).toBe('guest-id');
  });

  it('two independently-driven sessions given the same shot_started payload and the same frame-timing produce identical local playback (host and guest see the same animation)', () => {
    const hostSocket = new FakeSocket();
    const guestSocket = new FakeSocket();
    const payload = shotStartedPayload();

    // Drive both sessions off one shared synthetic clock and one shared
    // RAF queue so each receives byte-identical dt values per frame —
    // isolating the assertion to "does the same shared physics engine
    // given the same inputs produce the same output" rather than being
    // confounded by incidental real-wall-clock timing differences between
    // two separately-constructed test objects (which two real devices
    // wouldn't have identical timing either — that's exactly why the
    // architecture reconciles to the authoritative server state at the
    // end of every shot, rather than relying on perfect client parity).
    let clock = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const sharedRaf = installControllableRaf();

    fakeSocket = hostSocket;
    const hostSession = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    fakeSocket = guestSocket;
    const guestSession = new OnlineSession('8B-TEST', 'guest-id', makeInitialState());

    hostSocket.trigger('shot_started', payload);
    guestSocket.trigger('shot_started', payload);

    for (let i = 0; i < 400 && sharedRaf.pendingCount() > 0; i++) {
      clock += 16;
      sharedRaf.flush(clock);
    }

    const hostFinalBalls = hostSession.getState().balls;
    const guestFinalBalls = guestSession.getState().balls;

    expect(hostFinalBalls.map((b) => b.position)).toEqual(guestFinalBalls.map((b) => b.position));
    expect(hostFinalBalls.map((b) => b.pocketed)).toEqual(guestFinalBalls.map((b) => b.pocketed));

    nowSpy.mockRestore();
  });

  it('shots cannot overlap: submitShot is a no-op while a shot is still animating', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    fakeSocket.trigger('shot_started', shotStartedPayload());

    fakeSocket.emitCalls = [];
    session.submitShot({ direction: { x: 1, y: 0 }, power: 50 });

    expect(fakeSocket.emitCalls.filter((c) => c.event === 'take_shot')).toHaveLength(0);
    expect(session.isMyTurn()).toBe(false);
  });

  it('cleans up listeners and cancels the animation frame loop on leave()', () => {
    const session = new OnlineSession('8B-TEST', 'host-id', makeInitialState());
    fakeSocket.trigger('shot_started', shotStartedPayload());
    expect(raf.pendingCount()).toBe(1);
    expect(fakeSocket.totalListenerCount()).toBeGreaterThan(0);

    session.leave();

    expect(fakeSocket.totalListenerCount()).toBe(0);
    const stateChanges: MatchState[] = [];
    session.onStateChange((s) => stateChanges.push(s));
    fakeSocket.trigger('shot_applied', { ...makeInitialState(), roomCode: '8B-TEST', shotId: 'shot-1' });
    expect(stateChanges).toHaveLength(0);
  });
});
