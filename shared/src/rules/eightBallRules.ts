import type { BallGroup, BallId } from '../constants';
import type { BallState, FoulReason, MatchState, PlayerInfo, ShotResult } from '../types';
import type { CollisionEvent } from '../physics/engine';

/**
 * Authentic WPA 8-Ball rules evaluator.
 *
 * This module is pure and deterministic: given the pre-shot state, the
 * player's assigned group, and the physics events/pocketed balls produced
 * by a single shot, it returns the legal outcome (foul, group assignment,
 * turn switch, win/loss). It has no knowledge of rendering or networking,
 * so the exact same logic runs on the server (authoritative) and the
 * client (for instant local feedback in vs-computer mode).
 */

export interface ShotInput {
  /** Ball state snapshot BEFORE the shot was taken (to know who was on the table, groups, etc). */
  preShotBalls: BallState[];
  /** Physics collision events generated while resolving the shot. */
  events: CollisionEvent[];
  /** Balls pocketed during this shot (ids). */
  pocketedThisShot: BallId[];
  /** Whether the cue ball itself was pocketed (scratch). */
  cueBallPocketed: boolean;
  /** Whether the cue ball left the table bounds entirely (jumped off). */
  cueBallLeftTable: boolean;
  shooterId: string;
  shooterGroup: BallGroup | null;
  opponentId: string;
  isBreakShot: boolean;
  groupsAlreadyAssigned: boolean;
}

/** Returns the id of the first object ball the cue ball made contact with, or null if none. */
export function getFirstBallContacted(events: CollisionEvent[], cueBallId: BallId = 0): BallId | null {
  for (const e of events) {
    if (e.type !== 'ball_ball') continue;
    if (e.ballA === cueBallId) return e.ballB as BallId;
    if (e.ballB === cueBallId) return e.ballA as BallId;
  }
  return null;
}

/** Returns true if any ball contacted a rail during the shot. */
function anyRailContact(events: CollisionEvent[]): boolean {
  return events.some((e) => e.type === 'ball_rail');
}

function isSolid(id: BallId): boolean {
  return id >= 1 && id <= 7;
}
function isStripe(id: BallId): boolean {
  return id >= 9 && id <= 15;
}

/**
 * Evaluates a completed shot against WPA rules and returns the result.
 * Does not mutate input; callers apply the result to their MatchState.
 */
export function evaluateShot(input: ShotInput): ShotResult {
  const {
    events,
    pocketedThisShot,
    cueBallPocketed,
    cueBallLeftTable,
    shooterGroup,
    isBreakShot,
    groupsAlreadyAssigned,
  } = input;

  const firstContact = getFirstBallContacted(events);
  const pocketedSolids = pocketedThisShot.filter(isSolid);
  const pocketedStripes = pocketedThisShot.filter(isStripe);
  const eightPocketed = pocketedThisShot.includes(8 as BallId);

  let foul: FoulReason | null = null;
  let groupsAssigned = false;
  let newGroupForShooter: BallGroup | null = shooterGroup;
  let gameWinnerId: string | null = null;
  let gameLoserId: string | null = null;

  // --- Early / illegal 8-ball handling (checked first: it can end the game outright) ---
  if (eightPocketed && !isBreakShot) {
    const groupFullyCleared =
      shooterGroup != null && groupsAlreadyAssigned && isGroupCleared(input.preShotBalls, shooterGroup, pocketedThisShot);

    if (!groupsAlreadyAssigned || !groupFullyCleared) {
      // 8-ball pocketed before the shooter's group was cleared (or before groups even assigned) = loss.
      foul = 'early_eight_ball';
      gameLoserId = input.shooterId;
      gameWinnerId = input.opponentId;
    } else if (cueBallPocketed) {
      // Legally reached the 8-ball but scratched while pocketing it = loss.
      foul = 'illegal_eight_ball_pocket';
      gameLoserId = input.shooterId;
      gameWinnerId = input.opponentId;
    } else {
      // Legal win.
      gameWinnerId = input.shooterId;
      gameLoserId = input.opponentId;
    }
  }

  // --- Standard fouls (only relevant if the game hasn't already ended above) ---
  if (!gameWinnerId) {
    if (cueBallPocketed || cueBallLeftTable) {
      foul = 'scratch';
    } else if (firstContact === null && !isBreakShot) {
      foul = 'no_ball_contacted';
    } else if (
      !isBreakShot &&
      groupsAlreadyAssigned &&
      shooterGroup &&
      firstContact !== null &&
      !isSameGroup(firstContact, shooterGroup)
    ) {
      // Contacted opponent's ball (or the 8-ball early) first.
      if (firstContact === 8 && !isGroupCleared(input.preShotBalls, shooterGroup, [])) {
        foul = 'wrong_ball_first';
      } else if (firstContact !== 8) {
        foul = 'wrong_ball_first';
      }
    } else if (
      firstContact !== null &&
      pocketedThisShot.length === 0 &&
      !anyRailContact(events)
    ) {
      // Legal contact made but no ball pocketed and no rail touched afterward = foul.
      foul = 'no_rail_after_contact';
    }
  }

  // --- Group assignment (only on the shot that first legally pockets a ball post-break) ---
  if (!groupsAlreadyAssigned && !gameWinnerId) {
    const soloGroup =
      (pocketedSolids.length > 0) !== (pocketedStripes.length > 0) // exactly one group pocketed, not both/neither
        ? pocketedSolids.length > 0
          ? 'solids'
          : 'stripes'
        : null;

    if (soloGroup && !foul) {
      groupsAssigned = true;
      newGroupForShooter = soloGroup;
    }
  }

  return {
    foul,
    pocketedBalls: pocketedThisShot,
    firstBallContacted: firstContact,
    isBreakShot,
    groupsAssigned,
    gameWinnerId,
    gameLoserId,
  };
}

function isSameGroup(ballId: BallId, group: BallGroup): boolean {
  return group === 'solids' ? isSolid(ballId) : isStripe(ballId);
}

/** True if every ball in the given group has already been pocketed (accounting for this shot's pockets too). */
function isGroupCleared(preShotBalls: BallState[], group: BallGroup, extraPocketed: BallId[]): boolean {
  const groupIds = preShotBalls
    .map((b) => b.id)
    .filter((id) => (group === 'solids' ? isSolid(id) : isStripe(id)));

  return groupIds.every((id) => {
    const ball = preShotBalls.find((b) => b.id === id);
    return ball?.pocketed || extraPocketed.includes(id);
  });
}

/** Determines the next player to shoot given the shot result and current turn owner. */
export function nextShooter(result: ShotResult, currentShooterId: string, opponentId: string): string {
  if (result.foul) return opponentId;
  if (result.pocketedBalls.length === 0) return opponentId;
  // A legal pot (of the shooter's own group, or any ball on an open table) keeps the turn.
  return currentShooterId;
}

/** True if ball-in-hand should be granted to the incoming shooter. */
export function shouldGrantBallInHand(result: ShotResult): boolean {
  return result.foul !== null;
}

export function buildInitialPlayers(p1Name: string, p2Name: string, ids: [string, string]): [PlayerInfo, PlayerInfo] {
  return [
    { id: ids[0], name: p1Name, group: null, connected: true },
    { id: ids[1], name: p2Name, group: null, connected: true },
  ];
}

export function isGameOver(state: MatchState): boolean {
  return state.phase === 'game_over';
}
