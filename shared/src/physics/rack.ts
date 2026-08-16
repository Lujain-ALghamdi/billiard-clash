import { Vec2 } from '../vector2';
import { BALL, TABLE } from '../constants';
import type { BallState } from '../types';
import type { BallId } from '../constants';

/**
 * Builds a legal starting rack.
 *
 * WPA placement rules honored:
 * - 8-ball is in the exact center of the triangle (3rd row).
 * - One solid and one stripe occupy the two rear corners of the triangle.
 * - All other solids/stripes are placed randomly among the remaining slots.
 * - Cue ball is spotted on the head spot for the break.
 */
export function buildRack(): BallState[] {
  const r = BALL.RADIUS;
  const footSpot: Vec2 = { x: TABLE.WIDTH * TABLE.FOOT_SPOT_RATIO, y: TABLE.HEIGHT / 2 };
  const headSpot: Vec2 = { x: TABLE.WIDTH * TABLE.HEAD_STRING_RATIO, y: TABLE.HEIGHT / 2 };

  // Triangle apex points toward the foot spot; rows extend toward the rail behind it.
  const spacing = r * 2 + 0.4; // tiny gap so balls don't spawn overlapping due to float error
  const rowDir = { x: 1, y: 0 }; // rows extend away from center table, toward the rack rail
  const colDir = { x: 0, y: 1 };

  // Row index 0 = apex ball (closest to head), row 4 = back row (5 balls).
  const slots: Vec2[] = [];
  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    const rowCenterOffset = -((count - 1) / 2) * spacing;
    for (let k = 0; k < count; k++) {
      const along = row * spacing * Math.sin(Math.PI / 3); // tight triangular packing
      const across = rowCenterOffset + k * spacing;
      slots.push({
        x: footSpot.x - along * rowDir.x + across * colDir.x,
        y: footSpot.y - along * rowDir.y + across * colDir.y,
      });
    }
  }

  // Slot indices per row: [0], [1,2], [3,4,5], [6,7,8,9], [10,11,12,13,14]
  const apex = 0;
  const centerOf3rdRow = 4; // middle of row index 2 (3rd row), slots 3,4,5
  const backRow = [10, 11, 12, 13, 14];
  const rearCorners = [10, 14];

  const solids: BallId[] = [1, 2, 3, 4, 5, 6, 7];
  const stripes: BallId[] = [9, 10, 11, 12, 13, 14, 15];
  shuffle(solids);
  shuffle(stripes);

  const assignment = new Array<BallId>(15).fill(0 as BallId);
  assignment[centerOf3rdRow] = 8;

  // One solid, one stripe in the two rear corners (WPA requirement).
  assignment[rearCorners[0]] = solids.pop()!;
  assignment[rearCorners[1]] = stripes.pop()!;

  const remainingSlots = Array.from({ length: 15 }, (_, i) => i).filter(
    (i) => i !== centerOf3rdRow && i !== rearCorners[0] && i !== rearCorners[1]
  );
  const remainingBalls: BallId[] = shuffle([...solids, ...stripes]);
  remainingSlots.forEach((slotIndex, i) => {
    assignment[slotIndex] = remainingBalls[i];
  });

  const balls: BallState[] = assignment.map((id, i) => ({
    id,
    position: Vec2.clone(slots[i]),
    velocity: Vec2.zero(),
    pocketed: false,
    onTable: true,
  }));

  // Cue ball on the head spot.
  balls.unshift({
    id: 0 as BallId,
    position: Vec2.clone(headSpot),
    velocity: Vec2.zero(),
    pocketed: false,
    onTable: true,
  });

  void apex; // apex documented for clarity of slot 0 = tip of the triangle
  return balls;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
