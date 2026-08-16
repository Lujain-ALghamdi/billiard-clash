import { Vec2 } from '../vector2';
import { BALL, PHYSICS, TABLE } from '../constants';
import type { BallState } from '../types';

export interface PocketDef {
  position: Vec2;
  radius: number;
}

/** The six pockets in table-local coordinates, origin at the top-left of the playing surface. */
export function getPockets(): PocketDef[] {
  const { WIDTH, HEIGHT, CORNER_POCKET_RADIUS, SIDE_POCKET_RADIUS } = TABLE;
  return [
    { position: { x: 0, y: 0 }, radius: CORNER_POCKET_RADIUS },
    { position: { x: WIDTH / 2, y: -4 }, radius: SIDE_POCKET_RADIUS },
    { position: { x: WIDTH, y: 0 }, radius: CORNER_POCKET_RADIUS },
    { position: { x: 0, y: HEIGHT }, radius: CORNER_POCKET_RADIUS },
    { position: { x: WIDTH / 2, y: HEIGHT + 4 }, radius: SIDE_POCKET_RADIUS },
    { position: { x: WIDTH, y: HEIGHT }, radius: CORNER_POCKET_RADIUS },
  ];
}

export interface CollisionEvent {
  type: 'ball_ball' | 'ball_rail' | 'pocket';
  ballA: number;
  ballB?: number;
}

export interface StepResult {
  events: CollisionEvent[];
  allStopped: boolean;
}

/**
 * Advances the simulation by `dtSeconds`, internally subdividing into fixed
 * substeps so behavior is identical regardless of caller frame rate.
 * Mutates the provided ball array in place and returns collision events
 * generated during the step (used for sound effects, rule evaluation, etc).
 */
export function stepSimulation(balls: BallState[], dtSeconds: number): StepResult {
  const events: CollisionEvent[] = [];
  let remaining = dtSeconds;
  let substeps = 0;

  while (remaining > 0 && substeps < PHYSICS.MAX_SUBSTEPS * 4) {
    const dt = Math.min(PHYSICS.FIXED_DT, remaining);
    substepOnce(balls, dt, events);
    remaining -= dt;
    substeps++;
  }

  const allStopped = balls.every(
    (b) => !b.onTable || b.pocketed || Vec2.length(b.velocity) < PHYSICS.STOP_THRESHOLD
  );

  if (allStopped) {
    for (const b of balls) {
      if (b.onTable && !b.pocketed) b.velocity = Vec2.zero();
    }
  }

  return { events, allStopped };
}

function substepOnce(balls: BallState[], dt: number, events: CollisionEvent[]): void {
  // 1. Integrate positions & apply rolling friction.
  for (const b of balls) {
    if (!b.onTable || b.pocketed) continue;
    const speed = Vec2.length(b.velocity);
    if (speed < PHYSICS.STOP_THRESHOLD) {
      b.velocity = Vec2.zero();
      continue;
    }
    b.position = Vec2.add(b.position, Vec2.scale(b.velocity, dt));

    const decel = PHYSICS.FRICTION_ROLLING * dt;
    const newSpeed = Math.max(0, speed - decel);
    b.velocity = Vec2.scale(Vec2.normalize(b.velocity), newSpeed);
  }

  // 2. Ball-to-ball collisions (elastic, mass-equal spheres in 2D).
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.onTable || a.pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b.onTable || b.pocketed) continue;
      resolveBallCollision(a, b, events);
    }
  }

  // 3. Rail collisions.
  for (const b of balls) {
    if (!b.onTable || b.pocketed) continue;
    resolveRailCollision(b, events);
  }

  // 4. Pocket detection.
  const pockets = getPockets();
  for (const b of balls) {
    if (!b.onTable || b.pocketed) continue;
    for (const p of pockets) {
      if (Vec2.distance(b.position, p.position) <= p.radius) {
        b.pocketed = true;
        b.onTable = false;
        b.velocity = Vec2.zero();
        events.push({ type: 'pocket', ballA: b.id });
        break;
      }
    }
  }
}

function resolveBallCollision(a: BallState, b: BallState, events: CollisionEvent[]): void {
  const delta = Vec2.sub(b.position, a.position);
  const dist = Vec2.length(delta);
  const minDist = BALL.RADIUS * 2;
  if (dist >= minDist || dist === 0) return;

  const normal = Vec2.normalize(delta);

  // Positional correction: push balls apart so they never visually overlap.
  const overlap = minDist - dist;
  const correction = Vec2.scale(normal, overlap / 2);
  a.position = Vec2.sub(a.position, correction);
  b.position = Vec2.add(b.position, correction);

  // Relative velocity along the collision normal.
  const relVel = Vec2.sub(b.velocity, a.velocity);
  const velAlongNormal = Vec2.dot(relVel, normal);

  // Balls already separating; no impulse needed.
  if (velAlongNormal > 0) return;

  const restitution = PHYSICS.BALL_RESTITUTION;
  const impulseMag = -(1 + restitution) * velAlongNormal / (1 / BALL.MASS + 1 / BALL.MASS);
  const impulse = Vec2.scale(normal, impulseMag);

  a.velocity = Vec2.sub(a.velocity, Vec2.scale(impulse, 1 / BALL.MASS));
  b.velocity = Vec2.add(b.velocity, Vec2.scale(impulse, 1 / BALL.MASS));

  events.push({ type: 'ball_ball', ballA: a.id, ballB: b.id });
}

function resolveRailCollision(b: BallState, events: CollisionEvent[]): void {
  const { WIDTH, HEIGHT } = TABLE;
  const r = BALL.RADIUS;
  let bounced = false;

  if (b.position.x - r < 0) {
    b.position.x = r;
    b.velocity.x = Math.abs(b.velocity.x) * PHYSICS.RAIL_RESTITUTION;
    bounced = true;
  } else if (b.position.x + r > WIDTH) {
    b.position.x = WIDTH - r;
    b.velocity.x = -Math.abs(b.velocity.x) * PHYSICS.RAIL_RESTITUTION;
    bounced = true;
  }

  if (b.position.y - r < 0) {
    b.position.y = r;
    b.velocity.y = Math.abs(b.velocity.y) * PHYSICS.RAIL_RESTITUTION;
    bounced = true;
  } else if (b.position.y + r > HEIGHT) {
    b.position.y = HEIGHT - r;
    b.velocity.y = -Math.abs(b.velocity.y) * PHYSICS.RAIL_RESTITUTION;
    bounced = true;
  }

  if (bounced) events.push({ type: 'ball_rail', ballA: b.id });
}
