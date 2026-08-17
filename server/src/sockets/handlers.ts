import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@pool/shared';
import { isLegalCueBallPlacement } from '@pool/shared';
import { RoomManager } from '../rooms/RoomManager';
import { validatePlayerName, validateRoomCodeInput, validateShotRequest } from '../validation/validators';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Maps socket.id -> { roomCode, playerId } for quick lookup on disconnect.
const socketSessions = new Map<string, { roomCode: string; playerId: string }>();

export function registerSocketHandlers(io: TypedServer, roomManager: RoomManager): void {
  io.on('connection', (socket: TypedSocket) => {
    socket.on('create_room', (payload, ack) => {
      const nameCheck = validatePlayerName(payload?.playerName);
      if (!nameCheck.valid) {
        return ack({ ok: false, error: { code: 'INVALID_ROOM_CODE', message: nameCheck.reason! } });
      }

      const { room, playerId } = roomManager.createRoom(payload.playerName, socket.id);
      socket.join(room.code);
      socketSessions.set(socket.id, { roomCode: room.code, playerId });

      ack({ ok: true, roomCode: room.code, playerId });
      io.to(room.code).emit('room_state', { ...room.state, roomCode: room.code });
    });

    socket.on('join_room', (payload, ack) => {
      const codeCheck = validateRoomCodeInput(payload?.roomCode);
      const nameCheck = validatePlayerName(payload?.playerName);
      if (!codeCheck.valid) {
        return ack({ ok: false, error: { code: 'INVALID_ROOM_CODE', message: codeCheck.reason! } });
      }
      if (!nameCheck.valid) {
        return ack({ ok: false, error: { code: 'INVALID_ROOM_CODE', message: nameCheck.reason! } });
      }

      const result = roomManager.joinRoom(payload.roomCode, payload.playerName, socket.id);
      if ('error' in result) {
        const message = result.error === 'ROOM_NOT_FOUND' ? 'That room code does not exist.' : 'That room is already full.';
        return ack({ ok: false, error: { code: result.error, message } });
      }

      const { room, playerId } = result;
      socket.join(room.code);
      socketSessions.set(socket.id, { roomCode: room.code, playerId });

      ack({ ok: true, playerId, state: room.state });
      io.to(room.code).emit('room_state', { ...room.state, roomCode: room.code });
      socket.to(room.code).emit('opponent_status', { connected: true, reconnecting: false });
    });

    socket.on('rejoin_room', (payload, ack) => {
      const room = roomManager.getRoom(payload?.roomCode ?? '');
      if (!room) {
        return ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'That room no longer exists.' } });
      }
      const slot = room.getPlayerSlot(payload.playerId);
      if (!slot) {
        return ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'You are not part of that room.' } });
      }

      room.markReconnected(payload.playerId, socket.id);
      socket.join(room.code);
      socketSessions.set(socket.id, { roomCode: room.code, playerId: payload.playerId });

      ack({ ok: true, playerId: payload.playerId, state: room.state });
      socket.to(room.code).emit('opponent_status', { connected: true, reconnecting: false });
      io.to(room.code).emit('room_state', { ...room.state, roomCode: room.code });
    });

    socket.on('take_shot', (payload, ack) => {
      const session = socketSessions.get(socket.id);
      if (!session || session.roomCode !== payload?.roomCode) {
        return ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'You are not in that room.' } });
      }
      const room = roomManager.getRoom(session.roomCode);
      if (!room) {
        return ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'Room no longer exists.' } });
      }
      if (!room.isFull() || room.state.phase === 'game_over') {
        return ack({ ok: false, error: { code: 'MATCH_NOT_ACTIVE', message: 'Match is not active.' } });
      }
      if (!room.isPlayersTurn(session.playerId)) {
        return ack({ ok: false, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn.' } });
      }
      const shotCheck = validateShotRequest(payload.shot);
      if (!shotCheck.valid) {
        return ack({ ok: false, error: { code: 'INVALID_SHOT', message: shotCheck.reason! } });
      }

      // Ball-in-hand: never trust a client-supplied position. Validate it
      // server-side against the actual current ball positions (and the
      // WPA break-foul head-string restriction, when applicable) before
      // accepting the shot at all.
      if (room.state.ballInHand) {
        if (!payload.shot.cueBallPlacement) {
          return ack({ ok: false, error: { code: 'INVALID_PLACEMENT', message: 'Ball-in-hand requires a cue ball placement.' } });
        }
        const restricted = room.isBallInHandRestrictedToHeadString();
        const legal = isLegalCueBallPlacement(payload.shot.cueBallPlacement, room.state.balls, {
          restrictToHeadStringArea: restricted,
        });
        if (!legal) {
          return ack({
            ok: false,
            error: {
              code: 'INVALID_PLACEMENT',
              message: restricted
                ? 'Illegal placement: must be behind the head string after a break foul.'
                : 'Illegal placement: must be on the table and not overlap another ball.',
            },
          });
        }
      }

      // Phase 1: apply placement/velocity and broadcast shot_started so both
      // clients can begin an identical local physics replay immediately —
      // well before the server's own simulation (run synchronously below)
      // finishes and produces the authoritative result.
      const { shotId, preShotBalls, isBreakShot } = room.beginShot(session.playerId, payload.shot);
      ack({ ok: true });
      io.to(room.code).emit('shot_started', {
        roomCode: room.code,
        shotId,
        preShotBalls,
        shot: payload.shot,
        shooterId: session.playerId,
        isBreakShot,
      });

      // Phase 2: resolve authoritatively and broadcast the final result.
      room.resolveShot();
      io.to(room.code).emit('shot_applied', { ...room.state, roomCode: room.code, shotId });
    });

    socket.on('request_rematch', (payload) => {
      const session = socketSessions.get(socket.id);
      if (!session || session.roomCode !== payload?.roomCode) return;
      const room = roomManager.getRoom(session.roomCode);
      if (!room) return;

      room.rematchVotes.add(session.playerId);
      io.to(room.code).emit('rematch_requested', { byPlayerId: session.playerId });

      const bothIds = room.players.map((p) => p.info.id).filter(Boolean);
      if (bothIds.every((id) => room.rematchVotes.has(id))) {
        room.resetForRematch();
        io.to(room.code).emit('rematch_started', room.state);
      }
    });

    socket.on('leave_room', (payload) => {
      const room = roomManager.getRoom(payload?.roomCode ?? '');
      const session = socketSessions.get(socket.id);
      if (room && session) {
        handleDeparture(io, roomManager, room.code, session.playerId, socket.id);
      }
      socketSessions.delete(socket.id);
    });

    socket.on('disconnect', () => {
      const session = socketSessions.get(socket.id);
      if (!session) return;
      handleDeparture(io, roomManager, session.roomCode, session.playerId, socket.id);
      socketSessions.delete(socket.id);
    });
  });
}

function handleDeparture(
  io: TypedServer,
  roomManager: RoomManager,
  roomCode: string,
  playerId: string,
  socketId: string
): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  io.to(room.code).emit('opponent_status', { connected: false, reconnecting: true });

  room.markDisconnected(playerId, () => {
    // Grace period expired with no reconnect: tear the room down.
    io.to(room.code).emit('error_message', {
      code: 'MATCH_NOT_ACTIVE',
      message: 'Opponent did not reconnect in time. The match has ended.',
    });
    roomManager.removeRoom(room.code);
  });

  void socketId;
}
