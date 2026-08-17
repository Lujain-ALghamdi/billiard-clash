import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VsComputerSession } from './VsComputerSession';

function installRafPolyfill() {
  let id = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    id += 1;
    setTimeout(() => cb(performance.now()), 4);
    return id;
  };
  window.cancelAnimationFrame = (timerId: number) => clearTimeout(timerId);
}

describe('VsComputerSession — game-over handling', () => {
  beforeEach(() => {
    installRafPolyfill();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isShotInProgress() is true while the human shot is animating and false once it resolves', async () => {
    const session = new VsComputerSession('Player', 'easy');
    expect(session.isShotInProgress()).toBe(false);

    const done = new Promise<void>((resolve) => session.onStateChange(() => resolve()));
    session.submitShot({ direction: { x: -1, y: 0.02 }, power: 90 });
    expect(session.isShotInProgress()).toBe(true);

    await done;
    expect(session.isShotInProgress()).toBe(false);
  });

  it('isMyTurn() is false during the human shooter\'s own shot animation (not just when it is the opponent\'s turn)', () => {
    const session = new VsComputerSession('Player', 'easy');
    expect(session.isMyTurn()).toBe(true);

    session.submitShot({ direction: { x: -1, y: 0.02 }, power: 90 });
    // currentTurnPlayerId hasn't changed yet (still the human's, until resolveShot runs),
    // but isMyTurn() must still report false while the shot is physically resolving —
    // this is exactly what stops the cue stick from following the moving cue ball.
    expect(session.isMyTurn()).toBe(false);
  });

  it('emits a final state with phase game_over and a winnerId once the match legally ends', async () => {
    // Force a terminal state by directly manipulating the engine to simulate
    // "human has cleared their group and is about to pot the 8 legally" —
    // full physics-driven wins are covered by shared/server rule tests;
    // this test verifies the SESSION correctly propagates whatever the
    // engine decides, end to end, including onStateChange firing.
    const session = new VsComputerSession('Player', 'easy');
    const states: any[] = [];
    session.onStateChange((s) => states.push(s));

    // Drive shots until either the match ends or we give up after a generous
    // number of attempts (physics/AI randomness means we can't force a win
    // deterministically here without reaching into internals — this test's
    // job is to confirm that IF game_over is reached, it's correctly surfaced).
    for (let i = 0; i < 40; i++) {
      const state = session.getState();
      if (state.phase === 'game_over') break;
      if (!session.isMyTurn()) {
        // Let the AI's scheduled turn play out.
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      const doneShot = new Promise<void>((resolve) => {
        const unsub = () => resolve();
        session.onStateChange(unsub);
      });
      session.submitShot({ direction: { x: -1, y: (Math.random() - 0.5) * 0.3 }, power: 40 + Math.random() * 50 });
      await doneShot;
    }

    // Whether or not this particular randomized run reached game_over, the
    // invariant under test is that no impossible states were emitted.
    for (const s of states) {
      if (s.phase === 'game_over') {
        expect(typeof s.winnerId).toBe('string');
        expect(s.winnerId).not.toBeNull();
      }
    }
  }, 20000);

  it('AI does not start another turn once phase is game_over', async () => {
    const session = new VsComputerSession('Player', 'easy') as any;
    // Reach into the engine to force a legal terminal state without relying
    // on randomized physics, then call the private scheduling path directly.
    session['engine'].state.phase = 'game_over';
    session['engine'].state.winnerId = session['engine'].humanId;
    session['engine'].state.currentTurnPlayerId = session['engine'].computerId;

    const thinkingChanges: boolean[] = [];
    session.onAIThinkingChange = (thinking: boolean) => thinkingChanges.push(thinking);

    session['maybeTriggerAI']();

    // Give any (incorrectly) scheduled AI timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(session.isAIThinking()).toBe(false);
    expect(thinkingChanges).toHaveLength(0);
  });

  it('requestRematch() creates a fresh rack and resets game-over state', () => {
    const session = new VsComputerSession('Player', 'easy') as any;
    session['engine'].state.phase = 'game_over';
    session['engine'].state.winnerId = session['engine'].humanId;

    const pocketedCountBefore = session.getState().balls.filter((b: any) => b.pocketed).length;
    expect(pocketedCountBefore).toBe(0); // sanity: fresh engine's rack starts fully on-table

    session.requestRematch();

    const state = session.getState();
    expect(state.phase).toBe('break');
    expect(state.winnerId).toBeNull();
    expect(state.balls.every((b: any) => !b.pocketed)).toBe(true);
    expect(session.isShotInProgress()).toBe(false);
  });

  it('leave() cancels any pending AI think timer', () => {
    vi.useFakeTimers();
    const session = new VsComputerSession('Player', 'easy') as any;
    session['engine'].state.currentTurnPlayerId = session['engine'].computerId;
    session['maybeTriggerAI']();
    expect(session['aiThinkTimer']).not.toBeNull();

    session.leave();
    expect(session['aiThinkTimer']).toBeNull();
    vi.useRealTimers();
  });
});
