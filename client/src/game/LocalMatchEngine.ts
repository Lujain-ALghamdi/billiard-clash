import {
  buildRack,
  evaluateShot,
  nextShooter,
  shouldGrantBallInHand,
  stepSimulation,
  PHYSICS,
  SHOT_POWER,
  Vec2,
  type BallGroup,
  type MatchState,
  type ShotRequest,
  type ShotResult,
} from '@pool/shared';

export type LocalPlayerRole = 'human' | 'ai';

export interface LocalMatchConfig {
  humanName: string;
  computerName: string;
}

/**
 * Mirrors the server's Room.applyShot logic for fully offline vs-computer
 * play. Kept intentionally close to server/src/rooms/Room.ts so the two
 * codepaths produce identical rules outcomes from the same shared engine.
 */
export class LocalMatchEngine {
  state: MatchState;
  readonly humanId = 'human';
  readonly computerId = 'computer';

  constructor(config: LocalMatchConfig) {
    this.state = {
      phase: 'break',
      players: [
        { id: this.humanId, name: config.humanName, group: null, connected: true },
        { id: this.computerId, name: config.computerName, group: null, connected: true },
      ],
      currentTurnPlayerId: this.humanId,
      balls: buildRack(),
      ballInHand: false,
      lastShot: null,
      winnerId: null,
    };
  }

  isHumanTurn(): boolean {
    return this.state.currentTurnPlayerId === this.humanId && this.state.phase !== 'game_over';
  }

  getShooterGroup(playerId: string): BallGroup | null {
    return this.state.players.find((p) => p.id === playerId)?.group ?? null;
  }

  /** Applies the shot's initial velocity; caller drives stepSimulation each frame via `advance`. */
  beginShot(shot: ShotRequest): void {
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
      ((power - SHOT_POWER.MIN) / (SHOT_POWER.MAX - SHOT_POWER.MIN)) * (PHYSICS.MAX_SHOT_SPEED - PHYSICS.MIN_SHOT_SPEED);
    cue.velocity = Vec2.scale(Vec2.normalize(shot.direction), speed);
    this.pendingPreShotSnapshot = this.state.balls.map((b) => ({ ...b, position: { ...b.position } }));
    this.pendingEvents = [];
    this.pendingShooterId = this.state.currentTurnPlayerId;
    this.pendingIsBreak = this.state.phase === 'break';
  }

  private pendingPreShotSnapshot: MatchState['balls'] = [];
  private pendingEvents: ReturnType<typeof stepSimulation>['events'] = [];
  private pendingShooterId = '';
  private pendingIsBreak = false;

  /** Steps physics forward by dtSeconds. Returns true once all balls have come to rest. */
  advance(dtSeconds: number): boolean {
    const result = stepSimulation(this.state.balls, dtSeconds);
    this.pendingEvents.push(...result.events);
    return result.allStopped;
  }

  /** Finalizes the shot: runs rules evaluation and updates turn/phase/group state. Returns the result. */
  resolveShot(): ShotResult {
    const shooterId = this.pendingShooterId;
    const opponent = this.state.players.find((p) => p.id !== shooterId)!;
    const pocketedBefore = new Set(this.pendingPreShotSnapshot.filter((b) => b.pocketed).map((b) => b.id));

    const pocketedThisShot = this.state.balls
      .filter((b) => b.pocketed && !pocketedBefore.has(b.id) && b.id !== 0)
      .map((b) => b.id);
    const cueBallPocketed = this.state.balls.find((b) => b.id === 0)?.pocketed ?? false;
    const shooterGroup = this.getShooterGroup(shooterId);
    const groupsAlreadyAssigned = this.state.players.every((p) => p.group !== null);

    const result = evaluateShot({
      preShotBalls: this.pendingPreShotSnapshot,
      events: this.pendingEvents,
      pocketedThisShot,
      cueBallPocketed,
      cueBallLeftTable: false,
      shooterId,
      shooterGroup,
      opponentId: opponent.id,
      isBreakShot: this.pendingIsBreak,
      groupsAlreadyAssigned,
    });

    if (cueBallPocketed) {
      const cueBall = this.state.balls.find((b) => b.id === 0)!;
      cueBall.pocketed = false;
      cueBall.onTable = true;
      cueBall.position = { x: 750, y: 250 };
      cueBall.velocity = Vec2.zero();
    }

    if (result.groupsAssigned) {
      const shooter = this.state.players.find((p) => p.id === shooterId)!;
      const assignedGroup = shooterGroup ?? (result.pocketedBalls.some((id) => id >= 1 && id <= 7) ? 'solids' : 'stripes');
      shooter.group = assignedGroup;
      opponent.group = assignedGroup === 'solids' ? 'stripes' : 'solids';
    }

    if (result.gameWinnerId) {
      this.state.phase = 'game_over';
      this.state.winnerId = result.gameWinnerId;
    } else {
      this.state.phase = this.state.players.every((p) => p.group !== null) ? 'in_progress' : 'open_table';
      this.state.currentTurnPlayerId = nextShooter(result, shooterId, opponent.id);
      this.state.ballInHand = shouldGrantBallInHand(result);
    }

    this.state.lastShot = result;
    return result;
  }

  getPendingEvents() {
    return this.pendingEvents;
  }
}
