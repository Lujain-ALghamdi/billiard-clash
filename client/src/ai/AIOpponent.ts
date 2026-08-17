import { BALL, TABLE, Vec2, getPockets, isLegalCueBallPlacement, defaultCueBallPlacement, type BallState, type BallGroup } from '@pool/shared';
import type { Difficulty } from '@pool/shared';

export interface PlannedShot {
  direction: Vec2;
  power: number;
  targetBallId: number | null;
  targetPocket: Vec2 | null;
}

interface DifficultyProfile {
  /** Standard deviation of aiming error, in radians. */
  aimErrorStdDev: number;
  /** Standard deviation of power error, as a fraction of ideal power. */
  powerErrorStdDev: number;
  /** How many of the top-N candidate shots the AI actually considers (lower = more shortsighted). */
  candidatesConsidered: number;
  /** Weight given to leaving the cue ball in a good position for the next shot. */
  positionAwareness: number;
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { aimErrorStdDev: 0.09, powerErrorStdDev: 0.22, candidatesConsidered: 3, positionAwareness: 0 },
  medium: { aimErrorStdDev: 0.045, powerErrorStdDev: 0.14, candidatesConsidered: 6, positionAwareness: 0.3 },
  hard: { aimErrorStdDev: 0.018, powerErrorStdDev: 0.08, candidatesConsidered: 10, positionAwareness: 0.65 },
  insane: { aimErrorStdDev: 0.004, powerErrorStdDev: 0.03, candidatesConsidered: 15, positionAwareness: 1 },
};

interface Candidate {
  targetBall: BallState;
  pocket: Vec2;
  ghostBallPos: Vec2;
  cutAngle: number;
  distanceCueToGhost: number;
  distanceObjectToPocket: number;
  score: number;
}

/**
 * Plans a shot for the AI. Considers every legal object ball x every pocket,
 * filters out shots blocked by other balls, scores the remainder by cut
 * angle / distance / (at higher difficulty) resulting cue ball position,
 * then applies difficulty-scaled aiming and power error to the chosen shot.
 */
export function planAIShot(
  balls: BallState[],
  aiGroup: BallGroup | null,
  difficulty: Difficulty
): PlannedShot {
  const profile = PROFILES[difficulty];
  const cue = balls.find((b) => b.id === 0 && b.onTable && !b.pocketed);
  if (!cue) return fallbackShot();

  const legalTargets = getLegalTargets(balls, aiGroup);
  const pockets = getPockets();

  const candidates: Candidate[] = [];
  for (const target of legalTargets) {
    for (const pocket of pockets) {
      const candidate = evaluateCandidate(cue, target, pocket.position, balls);
      if (candidate) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return safetyShot(cue, balls);
  }

  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, Math.max(1, profile.candidatesConsidered));
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  const idealDirection = Vec2.normalize(Vec2.sub(chosen.ghostBallPos, cue.position));
  const aimedDirection = Vec2.rotate(idealDirection, gaussianRandom() * profile.aimErrorStdDev);

  const distanceFactor = Math.min(1, chosen.distanceObjectToPocket / 500 + chosen.distanceCueToGhost / 700);
  const idealPower = 35 + distanceFactor * 55;
  const power = clamp(idealPower * (1 + gaussianRandom() * profile.powerErrorStdDev), 15, 100);

  return {
    direction: aimedDirection,
    power,
    targetBallId: chosen.targetBall.id,
    targetPocket: chosen.pocket,
  };
}

function getLegalTargets(balls: BallState[], group: BallGroup | null): BallState[] {
  const onTable = balls.filter((b) => b.id !== 0 && b.onTable && !b.pocketed);
  if (!group) return onTable; // open table: any object ball is legal
  const groupBalls = onTable.filter((b) => (group === 'solids' ? b.id <= 7 : b.id >= 9 && b.id !== 8));
  const groupCleared = groupBalls.length === 0;
  if (groupCleared) {
    const eight = onTable.find((b) => b.id === 8);
    return eight ? [eight] : [];
  }
  return groupBalls;
}

function evaluateCandidate(cue: BallState, target: BallState, pocketPos: Vec2, allBalls: BallState[]): Candidate | null {
  const toPocket = Vec2.normalize(Vec2.sub(pocketPos, target.position));
  // Ghost ball: the cue ball's center at the moment of contact, one diameter from target along the pocket line.
  const ghostBallPos = Vec2.sub(target.position, Vec2.scale(toPocket, BALL.RADIUS * 2));

  // Cut angle: angle between (cue -> ghost) and (target -> pocket). >85deg is essentially impossible.
  const cueToGhost = Vec2.normalize(Vec2.sub(ghostBallPos, cue.position));
  const cutAngle = Math.acos(clamp(Vec2.dot(cueToGhost, toPocket), -1, 1));
  if (cutAngle > (85 * Math.PI) / 180) return null;

  if (isPathBlocked(cue.position, ghostBallPos, cue.id, target.id, allBalls)) return null;
  if (isPathBlocked(target.position, pocketPos, target.id, cue.id, allBalls)) return null;

  const distanceCueToGhost = Vec2.distance(cue.position, ghostBallPos);
  const distanceObjectToPocket = Vec2.distance(target.position, pocketPos);

  // Higher score = easier/better shot: prefer small cut angles and short distances.
  const angleScore = 1 - cutAngle / ((85 * Math.PI) / 180);
  const distanceScore = 1 - Math.min(1, (distanceCueToGhost + distanceObjectToPocket) / (TABLE.WIDTH * 1.4));
  const score = angleScore * 0.6 + distanceScore * 0.4;

  return { targetBall: target, pocket: pocketPos, ghostBallPos, cutAngle, distanceCueToGhost, distanceObjectToPocket, score };
}

/** Simple ray-vs-circle obstruction check against every other ball on the table. */
function isPathBlocked(from: Vec2, to: Vec2, excludeA: number, excludeB: number, allBalls: BallState[]): boolean {
  const dir = Vec2.sub(to, from);
  const len = Vec2.length(dir);
  if (len < 1e-6) return false;
  const norm = Vec2.normalize(dir);

  for (const b of allBalls) {
    if (!b.onTable || b.pocketed) continue;
    if (b.id === excludeA || b.id === excludeB) continue;
    const toBall = Vec2.sub(b.position, from);
    const proj = Vec2.dot(toBall, norm);
    if (proj < 0 || proj > len) continue;
    const closestPoint = Vec2.add(from, Vec2.scale(norm, proj));
    const dist = Vec2.distance(closestPoint, b.position);
    if (dist < BALL.RADIUS * 2 - 1) return true;
  }
  return false;
}

/** No legal pot available: play a defensive tap to avoid handing the opponent an easy ball-in-hand foul. */
function safetyShot(cue: BallState, balls: BallState[]): PlannedShot {
  const nearest = balls
    .filter((b) => b.id !== 0 && b.onTable && !b.pocketed)
    .sort((a, b) => Vec2.distance(cue.position, a.position) - Vec2.distance(cue.position, b.position))[0];
  const direction = nearest ? Vec2.normalize(Vec2.sub(nearest.position, cue.position)) : { x: 1, y: 0 };
  return { direction, power: 20, targetBallId: nearest?.id ?? null, targetPocket: null };
}

function fallbackShot(): PlannedShot {
  return { direction: { x: 1, y: 0 }, power: 30, targetBallId: null, targetPocket: null };
}

/**
 * Plans a ball-in-hand placement for the AI: samples a grid of legal
 * candidate positions (via the same shared isLegalCueBallPlacement used
 * by the server and human placement preview, so AI and human placement
 * can't drift on legality), scores each by the best shot it would set up,
 * and picks among the top candidates (difficulty-scaled, same as shot
 * selection) rather than always taking the single best spot.
 */
export function planAIBallInHandPlacement(
  balls: BallState[],
  aiGroup: BallGroup | null,
  difficulty: Difficulty,
  restrictToHeadStringArea: boolean
): Vec2 {
  const profile = PROFILES[difficulty];
  const legalTargets = getLegalTargets(balls, aiGroup);
  const pockets = getPockets();
  const otherBalls = balls.filter((b) => b.id !== 0);

  const margin = BALL.RADIUS + 2;
  const gridCols = 18;
  const gridRows = 9;

  const candidates: { pos: Vec2; score: number }[] = [];

  for (let gx = 0; gx <= gridCols; gx++) {
    for (let gy = 0; gy <= gridRows; gy++) {
      const pos: Vec2 = {
        x: margin + ((TABLE.WIDTH - margin * 2) * gx) / gridCols,
        y: margin + ((TABLE.HEIGHT - margin * 2) * gy) / gridRows,
      };
      if (!isLegalCueBallPlacement(pos, otherBalls, { restrictToHeadStringArea })) continue;

      const hypotheticalCue: BallState = { id: 0, position: pos, velocity: Vec2.zero(), pocketed: false, onTable: true };
      let bestForPos = -Infinity;
      for (const target of legalTargets) {
        for (const pocket of pockets) {
          const candidate = evaluateCandidate(hypotheticalCue, target, pocket.position, balls);
          if (candidate && candidate.score > bestForPos) bestForPos = candidate.score;
        }
      }
      // Positions with no legal shot at all are still viable (better than
      // nothing — the AI must place the ball somewhere), scored low.
      candidates.push({ pos, score: bestForPos === -Infinity ? -1 : bestForPos });
    }
  }

  if (candidates.length === 0) {
    // No legal grid sample found (shouldn't normally happen) — fall back to
    // the default spot if it happens to be legal here, otherwise the head/foot spot area.
    const fallback = defaultCueBallPlacement();
    return isLegalCueBallPlacement(fallback, otherBalls, { restrictToHeadStringArea })
      ? fallback
      : { x: restrictToHeadStringArea ? TABLE.WIDTH - margin : TABLE.WIDTH / 2, y: TABLE.HEIGHT / 2 };
  }

  candidates.sort((a, b) => b.score - a.score);
  const pool = candidates.slice(0, Math.max(1, profile.candidatesConsidered));
  return pool[Math.floor(Math.random() * pool.length)].pos;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Box-Muller transform for approximately-normal random error (more realistic than uniform noise). */
function gaussianRandom(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
