import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchState } from '@pool/shared';

/**
 * A minimal fake of the socket.io-client Socket surface used by OnlineMenu.ts.
 * Lets the test simulate the exact sequence the real server produces:
 * an ack callback for create_room, followed by TWO separate room_state
 * broadcasts (one right after creation with 1 player, one after the
 * second player joins with 2 players) — without needing a live server.
 */
class FakeSocket {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  emitCalls: { event: string; payload: any }[] = [];

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

  once(event: string, cb: (...args: any[]) => void): void {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped);
      cb(...args);
    };
    this.on(event, wrapped);
  }

  emit(event: string, payload: any, ack?: (...args: any[]) => void): void {
    this.emitCalls.push({ event, payload });
    if (event === 'create_room' && ack) {
      ack({ ok: true, roomCode: '8B-TEST', playerId: 'host-id' });
    }
  }

  /** Test helper: simulates the server pushing an event to this client. */
  trigger(event: string, ...args: any[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

let fakeSocket: FakeSocket;

vi.mock('../../multiplayer/SocketClient', () => ({
  getSocket: () => fakeSocket,
  saveSession: vi.fn(),
}));

// Imported after the mock is registered so OnlineMenu picks up the fake socket.
const { renderOnlineMenu } = await import('./OnlineMenu');

function makeState(playerIds: [string, string]): MatchState & { roomCode: string } {
  return {
    roomCode: '8B-TEST',
    phase: 'break',
    players: [
      { id: playerIds[0], name: 'Host', group: null, connected: true },
      { id: playerIds[1], name: playerIds[1] ? 'Guest' : '', group: null, connected: !!playerIds[1] },
    ],
    currentTurnPlayerId: playerIds[0],
    balls: [],
    ballInHand: false,
    lastShot: null,
    winnerId: null,
  };
}

describe('OnlineMenu — host create-room flow', () => {
  beforeEach(() => {
    fakeSocket = new FakeSocket();
  });

  it('calls onMatchReady when the second room_state broadcast (2 players) arrives, not just the first (1 player)', () => {
    const root = document.createElement('div');
    const onMatchReady = vi.fn();

    renderOnlineMenu(root, 'Host', { onMatchReady, onBack: vi.fn() });
    root.querySelector<HTMLButtonElement>('#create-room')!.click();

    // Server's immediate post-creation broadcast: only the host has joined so far.
    fakeSocket.trigger('room_state', makeState(['host-id', '']));
    expect(onMatchReady).not.toHaveBeenCalled();

    // Server's post-join broadcast: the second player has now joined.
    fakeSocket.trigger('room_state', makeState(['host-id', 'guest-id']));

    expect(onMatchReady).toHaveBeenCalledTimes(1);
    expect(onMatchReady).toHaveBeenCalledWith('8B-TEST', 'host-id', expect.objectContaining({ roomCode: '8B-TEST' }));
  });

  it('removes the room_state listener once the match is ready (no leak, no duplicate trigger)', () => {
    const root = document.createElement('div');
    const onMatchReady = vi.fn();

    renderOnlineMenu(root, 'Host', { onMatchReady, onBack: vi.fn() });
    root.querySelector<HTMLButtonElement>('#create-room')!.click();

    fakeSocket.trigger('room_state', makeState(['host-id', '']));
    fakeSocket.trigger('room_state', makeState(['host-id', 'guest-id']));
    expect(fakeSocket.listenerCount('room_state')).toBe(0);

    // A further broadcast (e.g. a later shot) must not re-trigger onMatchReady.
    fakeSocket.trigger('room_state', makeState(['host-id', 'guest-id']));
    expect(onMatchReady).toHaveBeenCalledTimes(1);
  });

  it('cleans up listeners when the host backs out of the waiting screen', () => {
    const root = document.createElement('div');
    const onMatchReady = vi.fn();

    renderOnlineMenu(root, 'Host', { onMatchReady, onBack: vi.fn() });
    root.querySelector<HTMLButtonElement>('#create-room')!.click();
    expect(fakeSocket.listenerCount('room_state')).toBe(1);

    root.querySelector<HTMLButtonElement>('#back')!.click();
    expect(fakeSocket.listenerCount('room_state')).toBe(0);
    expect(fakeSocket.listenerCount('connect_error')).toBe(0);

    // Even if a stale broadcast arrives after backing out, nothing should fire.
    fakeSocket.trigger('room_state', makeState(['host-id', 'guest-id']));
    expect(onMatchReady).not.toHaveBeenCalled();
  });
});
