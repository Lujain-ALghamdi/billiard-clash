/**
 * Minimal, allocation-conscious 2D vector utilities.
 * Used by the physics engine, AI shot planner, and rendering layer.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const Vec2 = {
  zero(): Vec2 {
    return { x: 0, y: 0 };
  },

  add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  },

  sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  },

  scale(a: Vec2, s: number): Vec2 {
    return { x: a.x * s, y: a.y * s };
  },

  dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  },

  lengthSq(a: Vec2): number {
    return a.x * a.x + a.y * a.y;
  },

  length(a: Vec2): number {
    return Math.sqrt(Vec2.lengthSq(a));
  },

  distance(a: Vec2, b: Vec2): number {
    return Vec2.length(Vec2.sub(a, b));
  },

  normalize(a: Vec2): Vec2 {
    const len = Vec2.length(a);
    if (len < 1e-9) return { x: 0, y: 0 };
    return { x: a.x / len, y: a.y / len };
  },

  fromAngle(radians: number): Vec2 {
    return { x: Math.cos(radians), y: Math.sin(radians) };
  },

  angle(a: Vec2): number {
    return Math.atan2(a.y, a.x);
  },

  rotate(a: Vec2, radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos };
  },

  clone(a: Vec2): Vec2 {
    return { x: a.x, y: a.y };
  },
};
