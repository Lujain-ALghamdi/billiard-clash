import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'net';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateRoomResponse,
  JoinRoomResponse,
  ActionAck,
  ShotStartedPayload,
  MatchState,
} from '@pool/shared';
import { RoomManager } from '../rooms/RoomManager';
import { registerSocketHandlers } from '../sockets/handlers';

let httpServer: ReturnType<typeof createServer>;
let port: number;

beforeAll(async () => {
  httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: '*' } });
  registerSocketHandlers(io, new RoomManager());
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(() => {
  httpServer.close();
});

function connect(): ClientSocket<ServerToClientEvents, ClientToServerEvents> {
  return ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
}

describe('room creation and joining', () => {
  it('creates a room and returns a well-formed room code', async () => {
    const client = connect();
    await new Promise((resolve) => client.on('connect', () => resolve()));

    const res = await new Promise<CreateRoomResponse>((resolve) => {
      client.emit('create_room', { playerName: 'Alice' }, resolve);
    });

    expect(res.ok).toBe(true);
    expect(res.roomCode).toMatch(/^8B-[A-Z0-9]{4}$/);
    client.disconnect();
  });

  it('allows a second player to join with the room code', async () => {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );

    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    const joinRes = await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );

    expect(joinRes.ok).toBe(true);
    expect(joinRes.state?.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    host.disconnect();
    guest.disconnect();
  });

  it('rejects joining a room that does not exist', async () => {
    const client = connect();
    await new Promise((resolve) => client.on('connect', () => resolve()));

    const res = await new Promise<JoinRoomResponse>((resolve) =>
      client.emit('join_room', { roomCode: '8B-ZZZZ', playerName: 'Bob' }, resolve)
    );

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('ROOM_NOT_FOUND');
    client.disconnect();
  });

  it('rejects a malformed room code', async () => {
    const client = connect();
    await new Promise((resolve) => client.on('connect', () => resolve()));

    const res = await new Promise<JoinRoomResponse>((resolve) =>
      client.emit('join_room', { roomCode: 'not-a-code', playerName: 'Bob' }, resolve)
    );

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_ROOM_CODE');
    client.disconnect();
  });

  it('rejects joining a room that is already full', async () => {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );

    const guest1 = connect();
    await new Promise((resolve) => guest1.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest1.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );

    const guest2 = connect();
    await new Promise((resolve) => guest2.on('connect', () => resolve()));
    const res = await new Promise<JoinRoomResponse>((resolve) =>
      guest2.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Carol' }, resolve)
    );

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('ROOM_FULL');
    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });
});

describe('turn-based shot validation', () => {
  it('rejects a shot from the player whose turn it is not', async () => {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );

    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );

    // Alice (host) breaks first; Bob attempts to shoot out of turn.
    const res = await new Promise<ActionAck>((resolve) => {
      guest.emit(
        'take_shot',
        { roomCode: createRes.roomCode!, shot: { direction: { x: 1, y: 0 }, power: 50 } },
        resolve
      );
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NOT_YOUR_TURN');
    host.disconnect();
    guest.disconnect();
  });

  it('accepts a legal shot from the current shooter and broadcasts updated state', async () => {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );

    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );

    const shotApplied = new Promise((resolve) => guest.on('shot_applied', resolve));
    const res = await new Promise<ActionAck>((resolve) => {
      host.emit(
        'take_shot',
        { roomCode: createRes.roomCode!, shot: { direction: { x: -1, y: 0 }, power: 80 } },
        resolve
      );
    });

    expect(res.ok).toBe(true);
    await shotApplied;
    host.disconnect();
    guest.disconnect();
  });

  it('rejects a malformed shot payload (invalid power)', async () => {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );
    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );

    const res = await new Promise<ActionAck>((resolve) => {
      host.emit(
        'take_shot',
        { roomCode: createRes.roomCode!, shot: { direction: { x: 1, y: 0 }, power: 9999 } },
        resolve
      );
    });

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_SHOT');
    host.disconnect();
    guest.disconnect();
  });
});

describe('shot_started / shot_applied broadcast sequence (online animation)', () => {
  async function setupRoom() {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );
    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );
    return { host, guest, roomCode: createRes.roomCode! };
  }

  it('broadcasts shot_started (with a pre-shot snapshot) before shot_applied, to BOTH host and guest', async () => {
    const { host, guest, roomCode } = await setupRoom();

    const order: string[] = [];
    const hostStarted = new Promise<ShotStartedPayload>((resolve) =>
      host.once('shot_started', (p) => {
        order.push('host:shot_started');
        resolve(p);
      })
    );
    const guestStarted = new Promise<ShotStartedPayload>((resolve) =>
      guest.once('shot_started', (p) => {
        order.push('guest:shot_started');
        resolve(p);
      })
    );
    const hostApplied = new Promise<MatchState & { shotId: string }>((resolve) =>
      host.once('shot_applied', (s) => {
        order.push('host:shot_applied');
        resolve(s as MatchState & { shotId: string });
      })
    );
    const guestApplied = new Promise<MatchState & { shotId: string }>((resolve) =>
      guest.once('shot_applied', (s) => {
        order.push('guest:shot_applied');
        resolve(s as MatchState & { shotId: string });
      })
    );

    host.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0.02 }, power: 90 } }, () => {});

    const [started, appliedHost, appliedGuest] = await Promise.all([hostStarted, hostApplied, guestApplied]);
    await guestStarted;

    // Both clients received both events.
    expect(order.filter((e) => e.endsWith('shot_started'))).toHaveLength(2);
    expect(order.filter((e) => e.endsWith('shot_applied'))).toHaveLength(2);

    // shot_started carries a non-empty pre-shot snapshot (16 balls) and the validated shot.
    expect(started.preShotBalls).toHaveLength(16);
    expect(started.shot.power).toBe(90);
    expect(started.roomCode).toBe(roomCode);
    expect(typeof started.shotId).toBe('string');
    expect(started.shotId.length).toBeGreaterThan(0);

    // shot_applied correlates via the same shotId, and is the authoritative final state.
    expect(appliedHost.shotId).toBe(started.shotId);
    expect(appliedGuest.shotId).toBe(started.shotId);

    host.disconnect();
    guest.disconnect();
  });

  it('the pre-shot snapshot has the cue ball at rest (zero velocity) — the client applies the shot itself', async () => {
    const { host, guest, roomCode } = await setupRoom();

    const startedPromise = new Promise<ShotStartedPayload>((resolve) => host.once('shot_started', resolve));
    host.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 75 } }, () => {});
    const started = await startedPromise;

    const cueBall = started.preShotBalls.find((b) => b.id === 0);
    expect(cueBall).toBeDefined();
    expect(cueBall!.velocity).toEqual({ x: 0, y: 0 });

    host.disconnect();
    guest.disconnect();
  });

  it('marks isBreakShot correctly on the very first shot of a match', async () => {
    const { host, guest, roomCode } = await setupRoom();
    const startedPromise = new Promise<ShotStartedPayload>((resolve) => host.once('shot_started', resolve));
    host.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 75 } }, () => {});
    const started = await startedPromise;
    expect(started.isBreakShot).toBe(true);
    host.disconnect();
    guest.disconnect();
  });
});

describe('ball-in-hand placement validation (server-authoritative)', () => {
  async function setupRoomAndScratch() {
    const host = connect();
    await new Promise((resolve) => host.on('connect', () => resolve()));
    const createRes = await new Promise<CreateRoomResponse>((resolve) =>
      host.emit('create_room', { playerName: 'Alice' }, resolve)
    );
    const guest = connect();
    await new Promise((resolve) => guest.on('connect', () => resolve()));
    await new Promise<JoinRoomResponse>((resolve) =>
      guest.emit('join_room', { roomCode: createRes.roomCode!, playerName: 'Bob' }, resolve)
    );
    const roomCode = createRes.roomCode!;

    // Aiming the break shot at a corner pocket reliably scratches the cue
    // ball (verified empirically): the head spot at (750, 250) has a clear
    // line to the (1000, 500) corner pocket with nothing in the way.
    const appliedPromise = new Promise<MatchState & { shotId: string }>((resolve) =>
      host.once('shot_applied', (s) => resolve(s as MatchState & { shotId: string }))
    );
    host.emit('take_shot', { roomCode, shot: { direction: { x: 0.707, y: 0.707 }, power: 100 } }, () => {});
    const applied = await appliedPromise;
    expect(applied.ballInHand).toBe(true);
    expect(applied.lastShot?.foul).toBe('scratch');

    return { host, guest, roomCode, afterScratchState: applied };
  }

  it('grants ball-in-hand to the incoming player after a scratch', async () => {
    const { host, guest, afterScratchState } = await setupRoomAndScratch();
    // Turn passed to the guest (the non-shooter) after the host's foul.
    expect(afterScratchState.currentTurnPlayerId).toBe(afterScratchState.players[1].id);
    host.disconnect();
    guest.disconnect();
  });

  it('accepts a legal placement behind the head string (break-foul restriction applies)', async () => {
    const { host, guest, roomCode } = await setupRoomAndScratch();
    // The scratch happened ON the break, so placement is WPA-restricted to
    // behind the head string (x >= 750). This spot is clear of the rack.
    const res = await new Promise<ActionAck>((resolve) =>
      guest.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 30, cueBallPlacement: { x: 900, y: 250 } } }, resolve)
    );
    expect(res.ok).toBe(true);
    host.disconnect();
    guest.disconnect();
  });

  it('rejects a placement in front of the head string when break-restricted', async () => {
    const { host, guest, roomCode } = await setupRoomAndScratch();
    // x < 750 is in front of the head string — illegal for a break-foul ball-in-hand.
    const res = await new Promise<ActionAck>((resolve) =>
      guest.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 30, cueBallPlacement: { x: 400, y: 250 } } }, resolve)
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PLACEMENT');
    host.disconnect();
    guest.disconnect();
  });

  it('rejects a placement outside the table bounds', async () => {
    const { host, guest, roomCode } = await setupRoomAndScratch();
    const res = await new Promise<ActionAck>((resolve) =>
      guest.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 30, cueBallPlacement: { x: 5000, y: 250 } } }, resolve)
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PLACEMENT');
    host.disconnect();
    guest.disconnect();
  });

  it('rejects a placement overlapping an object ball', async () => {
    const { host, guest, roomCode, afterScratchState } = await setupRoomAndScratch();
    const someRackBall = afterScratchState.balls.find((b) => b.id !== 0 && !b.pocketed)!;
    const res = await new Promise<ActionAck>((resolve) =>
      guest.emit(
        'take_shot',
        { roomCode, shot: { direction: { x: -1, y: 0 }, power: 30, cueBallPlacement: { x: someRackBall.position.x, y: someRackBall.position.y } } },
        resolve
      )
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PLACEMENT');
    host.disconnect();
    guest.disconnect();
  });

  it('rejects a take_shot with ballInHand active but no placement supplied', async () => {
    const { host, guest, roomCode } = await setupRoomAndScratch();
    const res = await new Promise<ActionAck>((resolve) =>
      guest.emit('take_shot', { roomCode, shot: { direction: { x: -1, y: 0 }, power: 30 } }, resolve)
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INVALID_PLACEMENT');
    host.disconnect();
    guest.disconnect();
  });

  it('does not restrict placement to the head string for a standard (non-break) foul', async () => {
    const { host, guest, roomCode } = await setupRoomAndScratch();

    // Guest's ball-in-hand shot: place legally behind the head string, then
    // deliberately scratch again (aiming at the top-right corner) so this
    // is now a NON-break foul — restriction should no longer apply.
    const secondAppliedPromise = new Promise<MatchState & { shotId: string }>((resolve) =>
      guest.once('shot_applied', (s) => resolve(s as MatchState & { shotId: string }))
    );
    const shot2Ack = await new Promise<ActionAck>((resolve) =>
      guest.emit(
        'take_shot',
        { roomCode, shot: { direction: { x: 0.35, y: -0.94 }, power: 100, cueBallPlacement: { x: 900, y: 250 } } },
        resolve
      )
    );
    expect(shot2Ack.ok).toBe(true);
    const secondApplied = await secondAppliedPromise;
    expect(secondApplied.lastShot?.foul).toBe('scratch');
    expect(secondApplied.ballInHand).toBe(true);

    // Now it's the host's ball-in-hand, from a NON-break foul — a placement
    // in front of the head string (x < 750) should be accepted this time.
    const res = await new Promise<ActionAck>((resolve) =>
      host.emit('take_shot', { roomCode, shot: { direction: { x: 1, y: 0 }, power: 15, cueBallPlacement: { x: 400, y: 250 } } }, resolve)
    );
    expect(res.ok).toBe(true);

    host.disconnect();
    guest.disconnect();
  });
});
