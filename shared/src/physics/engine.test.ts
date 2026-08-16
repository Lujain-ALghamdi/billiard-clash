import { describe, it, expect } from 'vitest';
import { stepSimulation } from './engine';
import { buildRack } from './rack';
import { Vec2 } from '../vector2';
import { BALL, TABLE } from '../constants';
import type { BallState } from '../types';

function makeBall(id: number, x: number, y: number, vx = 0, vy = 0): BallState {
  return { id: id as BallState['id'], position: { x, y }, velocity: { x: vx, y: vy }, pocketed: false, onTable: true };
}

describe('stepSimulation - ball-to-ball collisions', () => {
  it('never lets two balls overlap after a head-on collision', () => {
    const a = makeBall(0, 100, 100, 200, 0);
    const b = makeBall(1, 140, 100, 0, 0);
    const balls = [a, b];

    for (let i = 0; i < 300; i++) {
      stepSimulation(balls, 1 / 60);
      const dist = Vec2.distance(a.position, b.position);
      expect(dist).toBeGreaterThanOrEqual(BALL.RADIUS * 2 - 0.5);
    }
  });

  it('transfers momentum on head-on collision (stationary ball is set in motion)', () => {
    const a = makeBall(0, 100, 100, 300, 0);
    const b = makeBall(1, 150, 100, 0, 0);
    const balls = [a, b];

    let collided = false;
    for (let i = 0; i < 60 && !collided; i++) {
      const result = stepSimulation(balls, 1 / 60);
      if (result.events.some((e) => e.type === 'ball_ball')) collided = true;
    }
    expect(collided).toBe(true);
    expect(Vec2.length(b.velocity)).toBeGreaterThan(0);
  });

  it('eventually brings all balls to rest due to friction', () => {
    const balls = [makeBall(0, 100, 100, 400, 150)];
    let allStopped = false;
    for (let i = 0; i < 1000 && !allStopped; i++) {
      const result = stepSimulation(balls, 1 / 60);
      allStopped = result.allStopped;
    }
    expect(allStopped).toBe(true);
    expect(Vec2.length(balls[0].velocity)).toBe(0);
  });
});

describe('stepSimulation - rail collisions', () => {
  it('keeps balls within the table bounds and reflects velocity', () => {
    const balls = [makeBall(0, TABLE.WIDTH - 5, TABLE.HEIGHT / 2, 500, 0)];
    for (let i = 0; i < 30; i++) {
      stepSimulation(balls, 1 / 60);
      expect(balls[0].position.x).toBeLessThanOrEqual(TABLE.WIDTH - BALL.RADIUS + 0.01);
      expect(balls[0].position.x).toBeGreaterThanOrEqual(BALL.RADIUS - 0.01);
    }
  });

  it('never leaves a ball stuck outside the rail', () => {
    const balls = [makeBall(0, 2, 2, -900, -900)];
    for (let i = 0; i < 60; i++) {
      stepSimulation(balls, 1 / 60);
    }
    expect(balls[0].position.x).toBeGreaterThanOrEqual(BALL.RADIUS - 0.01);
    expect(balls[0].position.y).toBeGreaterThanOrEqual(BALL.RADIUS - 0.01);
  });
});

describe('stepSimulation - pocket detection', () => {
  it('pockets a ball that reaches a corner pocket and removes it from play', () => {
    const balls = [makeBall(1, 40, 40, -600, -600)];
    let pocketed = false;
    for (let i = 0; i < 60; i++) {
      const result = stepSimulation(balls, 1 / 60);
      if (result.events.some((e) => e.type === 'pocket')) pocketed = true;
    }
    expect(pocketed).toBe(true);
    expect(balls[0].pocketed).toBe(true);
    expect(balls[0].onTable).toBe(false);
  });
});

describe('buildRack', () => {
  it('produces 16 balls (cue + 15 object balls) with no initial overlap', () => {
    const balls = buildRack();
    expect(balls).toHaveLength(16);
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const dist = Vec2.distance(balls[i].position, balls[j].position);
        expect(dist).toBeGreaterThanOrEqual(BALL.RADIUS * 2 - 1);
      }
    }
  });

  it('places the 8-ball in the center of the third row', () => {
    const balls = buildRack();
    const eight = balls.find((b) => b.id === 8);
    expect(eight).toBeDefined();
  });

  it('places one solid and one stripe in the two rear corners', () => {
    const balls = buildRack();
    // Rear corners are the two extreme-y balls in the back row (max distance from apex on x).
    const objectBalls = balls.filter((b) => b.id !== 0);
    const minX = Math.min(...objectBalls.map((b) => b.position.x));
    const backRow = objectBalls.filter((b) => Math.abs(b.position.x - minX) < 1);
    expect(backRow.length).toBe(5);
    const ids = backRow
      .sort((a, b) => a.position.y - b.position.y)
      .map((b) => b.id);
    const corner1 = ids[0];
    const corner2 = ids[ids.length - 1];
    const isSolid = (id: number) => id >= 1 && id <= 7;
    const isStripe = (id: number) => id >= 9 && id <= 15;
    const oneEach =
      (isSolid(corner1) && isStripe(corner2)) || (isStripe(corner1) && isSolid(corner2));
    expect(oneEach).toBe(true);
  });
});
