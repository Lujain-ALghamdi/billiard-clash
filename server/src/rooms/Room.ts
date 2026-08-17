import {
  applyShotToBalls,
  buildRack,
  defaultCueBallPlacement,
  evaluateShot,
  isBallInHandPlacementRestricted,
  nextShooter,
  shouldGrantBallInHand,
  stepSimulation,
  Vec2,
  type BallState,
  type MatchState,
  type PlayerInfo,
  type ShotRequest,
  type ShotResult,
} from '@pool/shared';
import { randomUUID } from 'crypto';

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
   * True if the currently-active ball-in-hand must be restricted to
   * behind the head string (WPA break-foul rule) rather than anywhere on
   * the table (standard foul rule). Based on the shot that most recently
   * granted ball-in-hand — see shared/src/physics/placement.ts.
   */
  isBallInHandRestrictedToHeadString(): boolean {
    return isBallInHandPlacementRestricted(this.state.lastShot?.isBreakShot ?? false, this.state.lastShot?.foul ?? null);
  }

  /**
   * Phase 1 of shot resolution: validates nothing itself (caller already
   * did), but applies ball-in-hand placement, snapshots the at-rest ball
   * positions (for the shot_started broadcast so both clients can replay
   * the shot locally), and sets the cue ball's initial velocity. Does NOT
   * run the physics simulation — call resolveShot() next to do that.
   */
  beginShot(playerId: string, shot: ShotRequest): { shotId: string; preShotBalls: BallState[]; isBreakShot: boolean } {
    const isBreakShot = this.state.phase === 'break';

    // Snapshot at-rest positions BEFORE the cue ball's placement/velocity
    // are applied, matching what a fresh replay needs to start from.
    // Ball-in-hand placement (if any) happens first so the snapshot
    // reflects the actual starting position of this shot.
    if (this.state.ballInHand && shot.cueBallPlacement) {
      const cue = this.state.balls.find((b) => b.id === 0);
      if (cue) {
        cue.position = Vec2.clone(shot.cueBallPlacement);
        cue.velocity = Vec2.zero();
        cue.onTable = true;
        cue.pocketed = false;
      }
    }

    const preShotBalls = this.state.balls.map((b) => ({ ...b, position: { ...b.position }, velocity: { ...b.velocity } }));

    // Now apply the actual shot velocity (preShotBalls above is intentionally
    // captured with zero cue velocity — it's the replay's starting frame).
    applyShotToBalls(this.state.balls, shot);

    const shotId = randomUUID();
    this.pendingShot = { shotId, playerId, preShotBalls, isBreakShot };
    return { shotId, preShotBalls, isBreakShot };
  }

  private pendingShot: { shotId: string; playerId: string; preShotBalls: BallState[]; isBreakShot: boolean } | null = null;

  /**
   * Phase 2: runs the physics simulation to completion and evaluates WPA
   * rules against the snapshot captured in beginShot(). Must be called
   * after beginShot() in the same request. Returns the authoritative
   * result plus the shotId it corresponds to, for the shot_applied broadcast.
   */
  resolveShot(): { shotId: string; result: ShotResult } {
    const pending = this.pendingShot;
    if (!pending) throw new Error('Room.resolveShot() called without a preceding beginShot()');
    this.pendingShot = null;

    const { shotId, playerId, preShotBalls, isBreakShot } = pending;
    const opponent = this.players.find((p) => p.info.id !== playerId)!.info;

    const allEvents: ReturnType<typeof stepSimulation>['events'] = [];
    let allStopped = false;
    let iterations = 0;
    const pocketedBefore = new Set(preShotBalls.filter((b) => b.pocketed).map((b) => b.id));

    while (!allStopped && iterations < 2000) {
      const stepResult = stepSimulation(this.state.balls, 1 / 60);
      allEvents.push(...stepResult.events);
      allStopped = stepResult.allStopped;
      iterations++;
    }

    const pocketedThisShot = this.state.balls
      .filter((b) => b.pocketed && !pocketedBefore.has(b.id) && b.id !== 0)
      .map((b) => b.id);
    const cueBallPocketed = this.state.balls.find((b) => b.id === 0)?.pocketed ?? false;

    const shooterGroup = this.getPlayerSlot(playerId)?.info.group ?? null;
    const groupsAlreadyAssigned = this.players.every((p) => p.info.group !== null);

    const result = evaluateShot({
      preShotBalls,
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
    // This is only a provisional starting point for the incoming player's
    // interactive ball-in-hand placement — never their forced final
    // location (see shared/src/physics/placement.ts).
    if (cueBallPocketed) {
      const cueBall = this.state.balls.find((b) => b.id === 0)!;
      cueBall.pocketed = false;
      cueBall.onTable = true;
      cueBall.position = defaultCueBallPlacement();
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
    return { shotId, result };
  }

  resetForRematch(): void {
    this.state = this.freshMatchState([this.players[0].info, this.players[1].info]);
    this.players[0].info.group = null;
    this.players[1].info.group = null;
    this.rematchVotes.clear();
  }
}
