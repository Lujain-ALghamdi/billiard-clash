import { generateRoomCode, type PlayerInfo } from '@pool/shared';
import { randomUUID } from 'crypto';
import { Room } from './Room';

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string, hostSocketId: string): { room: Room; playerId: string } {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();

    const playerId = randomUUID();
    const hostPlayer: PlayerInfo = { id: playerId, name: hostName.slice(0, 24), group: null, connected: true };
    const room = new Room(code, hostPlayer, hostSocketId);
    this.rooms.set(code, room);
    return { room, playerId };
  }

  joinRoom(
    code: string,
    guestName: string,
    guestSocketId: string
  ): { room: Room; playerId: string } | { error: 'ROOM_NOT_FOUND' | 'ROOM_FULL' } {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return { error: 'ROOM_NOT_FOUND' };
    if (room.isFull()) return { error: 'ROOM_FULL' };

    const playerId = randomUUID();
    const guestPlayer: PlayerInfo = { id: playerId, name: guestName.slice(0, 24), group: null, connected: true };
    room.addSecondPlayer(guestPlayer, guestSocketId);
    return { room, playerId };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  removeRoom(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  findRoomBySocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.socketId === socketId)) return room;
    }
    return undefined;
  }
}
