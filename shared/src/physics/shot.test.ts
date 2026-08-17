import { describe, it, expect } from 'vitest';
import { computeShotVelocity, applyShotToBalls } from './shot';
import { Vec2 } from '../vector2';
import { PHYSICS, SHOT_POWER } from '../constants';
import type { BallState } from '../types';

function makeCue(x = 100, y = 100): BallState {
  return { id: 0, position: { x, y }, velocity: { x: 0, y: 0 }, pocketed: false, onTable: true };
}

describe('computeShotVelocity', () => {
  it('produces MIN_SHOT_SPEED at SHOT_POWER.MIN', () => {
    const v = computeShotVelocity({ direction: { x: 1, y: 0 }, power: SHOT_POWER.MIN });
    expect(Vec2.length(v)).toBeCloseTo(PHYSICS.MIN_SHOT_SPEED, 5);
  });

  it('produces MAX_SHOT_SPEED at SHOT_POWER.MAX', () => {
    const v = computeShotVelocity({ direction: { x: 1, y: 0 }, power: SHOT_POWER.MAX });
    expect(Vec2.length(v)).toBeCloseTo(PHYSICS.MAX_SHOT_SPEED, 5);
  });

  it('clamps power above MAX to MAX_SHOT_SPEED', () => {
    const v = computeShotVelocity({ direction: { x: 1, y: 0 }, power: 9999 });
    expect(Vec2.length(v)).toBeCloseTo(PHYSICS.MAX_SHOT_SPEED, 5);
  });

  it('clamps power below MIN to MIN_SHOT_SPEED', () => {
    const v = computeShotVelocity({ direction: { x: 1, y: 0 }, power: -50 });
    expect(Vec2.length(v)).toBeCloseTo(PHYSICS.MIN_SHOT_SPEED, 5);
  });

  it('normalizes a non-unit direction vector', () => {
    const v = computeShotVelocity({ direction: { x: 5, y: 0 }, power: SHOT_POWER.MAX });
    expect(Vec2.length(v)).toBeCloseTo(PHYSICS.MAX_SHOT_SPEED, 5);
    expect(v.y).toBeCloseTo(0, 5);
  });

  it('is deterministic: identical inputs always produce identical outputs', () => {
    const shot = { direction: { x: 0.6, y: 0.8 }, power: 73 };
    const v1 = computeShotVelocity(shot);
    const v2 = computeShotVelocity(shot);
    expect(v1).toEqual(v2);
  });
});

describe('applyShotToBalls', () => {
  it('sets the cue ball velocity matching computeShotVelocity', () => {
    const balls = [makeCue()];
    const shot = { direction: { x: 1, y: 0 }, power: 60 };
    applyShotToBalls(balls, shot);
    expect(balls[0].velocity).toEqual(computeShotVelocity(shot));
  });

  it('relocates the cue ball when a ball-in-hand placement is supplied', () => {
    const balls = [makeCue(100, 100)];
    applyShotToBalls(balls, { direction: { x: 1, y: 0 }, power: 50, cueBallPlacement: { x: 400, y: 200 } });
    expect(balls[0].position).toEqual({ x: 400, y: 200 });
  });

  it('un-pockets and re-tables the cue ball when placed (post-scratch respot path)', () => {
    const balls: BallState[] = [{ id: 0, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, pocketed: true, onTable: false }];
    applyShotToBalls(balls, { direction: { x: 1, y: 0 }, power: 50, cueBallPlacement: { x: 300, y: 250 } });
    expect(balls[0].pocketed).toBe(false);
    expect(balls[0].onTable).toBe(true);
  });

  it('leaves cue ball position untouched when no placement is supplied', () => {
    const balls = [makeCue(222, 111)];
    applyShotToBalls(balls, { direction: { x: 0, y: 1 }, power: 40 });
    expect(balls[0].position).toEqual({ x: 222, y: 111 });
  });

  it('throws if no cue ball is present', () => {
    expect(() => applyShotToBalls([], { direction: { x: 1, y: 0 }, power: 50 })).toThrow();
  });
});
