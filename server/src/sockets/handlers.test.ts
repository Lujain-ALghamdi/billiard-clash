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
