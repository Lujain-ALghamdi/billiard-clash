import {
  buildRack,
  evaluateShot,
  nextShooter,
  shouldGrantBallInHand,
  stepSimulation,
  PHYSICS,
  SHOT_POWER,
  Vec2,
  type MatchState,
  type PlayerInfo,
  type ShotRequest,
  type ShotResult,
} from '@pool/shared';

const RECONNECT_GRACE_MS = 60_000;

export interface RoomPlayerSlot {
  info: PlayerInfo;
  socketId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
}

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  players: [RoomPlayerSlot, RoomPlayerSlot];
  state: MatchState;
  rematchVotes = new Set<string>();

  constructor(code: string, hostPlayer: PlayerInfo, hostSocketId: string) {
    this.code = code;
    this.players = [
      { info: hostPlayer, socketId: hostSocketId, disconnectTimer: null },
      { info: { id: '', name: '', group: null, connected: false }, socketId: null, disconnectTimer: null },
    ];
    this.state = this.freshMatchState([hostPlayer, { id: '', name: '', group: null, connected: false }]);
  }

  private freshMatchState(players: [PlayerInfo, PlayerInfo]): MatchState {
    return {
      phase: 'break',
      players,
      currentTurnPlayerId: players[0].id,
      balls: buildRack(),
      ballInHand: false,
      lastShot: null,
      winnerId: null,
    };
  }

  isFull(): boolean {
    return Boolean(this.players[0].info.id && this.players[1].info.id);
  }

  addSecondPlayer(player: PlayerInfo, socketId: string): void {
    this.players[1] = { info: player, socketId, disconnectTimer: null };
    this.state.players = [this.players[0].info, this.players[1].info];
    this.state.phase = 'break';
  }

  getPlayerSlot(playerId: string): RoomPlayerSlot | undefined {
    return this.players.find((p) => p.info.id === playerId);
  }

  markDisconnected(playerId: string, onExpire: () => void): void {
    const slot = this.getPlayerSlot(playerId);
    if (!slot) return;
    slot.socketId = null;
    slot.info.connected = false;
    if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
    slot.disconnectTimer = setTimeout(onExpire, RECONNECT_GRACE_MS);
  }

  markReconnected(playerId: string, socketId: string): void {
    const slot = this.getPlayerSlot(playerId);
    if (!slot) return;
    slot.socketId = socketId;
    slot.info.connected = true;
    if (slot.disconnectTimer) {
      clearTimeout(slot.disconnectTimer);
      slot.disconnectTimer = null;
    }
  }

  isPlayersTurn(playerId: string): boolean {
    return this.state.currentTurnPlayerId === playerId && this.state.phase !== 'game_over';
  }

  /**
   * Applies a validated shot request: runs the physics simulation to
   * completion, evaluates WPA rules, and mutates authoritative state.
   * Returns the resulting ShotResult for broadcast.
   */
  applyShot(playerId: string, shot: ShotRequest): ShotResult {
    const opponent = this.players.find((p) => p.info.id !== playerId)!.info;
    const isBreakShot = this.state.phase === 'break';

    if (this.state.ballInHand && shot.cueBallPlacement) {
      const cue = this.state.balls.find((b) => b.id === 0);
      if (cue) {
        cue.position = Vec2.clone(shot.cueBallPlacement);
        cue.velocity = Vec2.zero();
        cue.onTable = true;
        cue.pocketed = false;
      }
    }

    const cue = this.state.balls.find((b) => b.id === 0)!;
    const power = Math.max(SHOT_POWER.MIN, Math.min(SHOT_POWER.MAX, shot.power));
    const speed =
      PHYSICS.MIN_SHOT_SPEED +
      ((power - SHOT_POWER.MIN) / (SHOT_POWER.MAX - SHOT_POWER.MIN)) *
        (PHYSICS.MAX_SHOT_SPEED - PHYSICS.MIN_SHOT_SPEED);
    cue.velocity = Vec2.scale(Vec2.normalize(shot.direction), speed);

    const preShotSnapshot = this.state.balls.map((b) => ({ ...b, position: { ...b.position } }));

    const allEvents: ReturnType<typeof stepSimulation>['events'] = [];
    let allStopped = false;
    let iterations = 0;
    const pocketedBefore = new Set(preShotSnapshot.filter((b) => b.pocketed).map((b) => b.id));

    while (!allStopped && iterations < 2000) {
      const result = stepSimulation(this.state.balls, 1 / 60);
      allEvents.push(...result.events);
      allStopped = result.allStopped;
      iterations++;
    }

    const pocketedThisShot = this.state.balls
      .filter((b) => b.pocketed && !pocketedBefore.has(b.id) && b.id !== 0)
      .map((b) => b.id);
    const cueBallPocketed = this.state.balls.find((b) => b.id === 0)?.pocketed ?? false;

    const shooterGroup = this.getPlayerSlot(playerId)?.info.group ?? null;
    const groupsAlreadyAssigned = this.players.every((p) => p.info.group !== null);

    const result = evaluateShot({
      preShotBalls: preShotSnapshot,
      events: allEvents,
      pocketedThisShot,
      cueBallPocketed,
      cueBallLeftTable: false,
      shooterId: playerId,
      shooterGroup,
      opponentId: opponent.id,
      isBreakShot,
      groupsAlreadyAssigned,
    });

    // Re-spot a scratched cue ball at the head spot for the next shooter.
    if (cueBallPocketed) {
      const cueBall = this.state.balls.find((b) => b.id === 0)!;
      cueBall.pocketed = false;
      cueBall.onTable = true;
      cueBall.position = { x: 750, y: 250 };
      cueBall.velocity = Vec2.zero();
    }

    if (result.groupsAssigned) {
      const shooterSlot = this.getPlayerSlot(playerId)!;
      const opponentSlot = this.players.find((p) => p.info.id !== playerId)!;
      const assignedGroup = shooterGroup ?? (result.pocketedBalls.some((id) => id >= 1 && id <= 7) ? 'solids' : 'stripes');
      shooterSlot.info.group = assignedGroup;
      opponentSlot.info.group = assignedGroup === 'solids' ? 'stripes' : 'solids';
      this.state.players = [this.players[0].info, this.players[1].info];
    }

    if (result.gameWinnerId) {
      this.state.phase = 'game_over';
      this.state.winnerId = result.gameWinnerId;
    } else {
      this.state.phase = this.state.players.every((p) => p.group !== null) ? 'in_progress' : 'open_table';
      this.state.currentTurnPlayerId = nextShooter(result, playerId, opponent.id);
      this.state.ballInHand = shouldGrantBallInHand(result);
    }

    this.state.lastShot = result;
    return result;
  }

  resetForRematch(): void {
    this.state = this.freshMatchState([this.players[0].info, this.players[1].info]);
    this.players[0].info.group = null;
    this.players[1].info.group = null;
    this.rematchVotes.clear();
  }
}
