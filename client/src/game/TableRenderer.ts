import { BALL, BALL_DEFINITIONS, TABLE, type BallState, Vec2 } from '@pool/shared';
import { getPockets } from '@pool/shared';

export interface RenderOptions {
  aimLineEnabled: boolean;
}

export class TableRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  /** table-units -> pixels scale, recomputed on resize */
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parent = this.canvas.parentElement!;
    const cssWidth = parent.clientWidth;
    const cssHeight = parent.clientHeight;
    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const margin = 60;
    const availW = cssWidth - margin * 2;
    const availH = cssHeight - margin * 2;
    const tableTotalW = TABLE.WIDTH + TABLE.RAIL_THICKNESS * 2 + TABLE.FRAME_THICKNESS * 2;
    const tableTotalH = TABLE.HEIGHT + TABLE.RAIL_THICKNESS * 2 + TABLE.FRAME_THICKNESS * 2;
    this.scale = Math.min(availW / tableTotalW, availH / tableTotalH);

    const renderedW = tableTotalW * this.scale;
    const renderedH = tableTotalH * this.scale;
    this.offsetX = (cssWidth - renderedW) / 2 + (TABLE.RAIL_THICKNESS + TABLE.FRAME_THICKNESS) * this.scale;
    this.offsetY = (cssHeight - renderedH) / 2 + (TABLE.RAIL_THICKNESS + TABLE.FRAME_THICKNESS) * this.scale;
  }

  /** Converts table-space coordinates to canvas pixel coordinates. */
  toScreen(p: Vec2): Vec2 {
    return { x: this.offsetX + p.x * this.scale, y: this.offsetY + p.y * this.scale };
  }

  /** Converts a canvas pixel point back to table-space coordinates. */
  toTable(p: Vec2): Vec2 {
    return { x: (p.x - this.offsetX) / this.scale, y: (p.y - this.offsetY) / this.scale };
  }

  getScale(): number {
    return this.scale;
  }

  clear(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, width, height);
  }

  drawTable(): void {
    const ctx = this.ctx;
    const tl = this.toScreen({ x: 0, y: 0 });
    const br = this.toScreen({ x: TABLE.WIDTH, y: TABLE.HEIGHT });
    const rail = TABLE.RAIL_THICKNESS * this.scale;
    const frame = TABLE.FRAME_THICKNESS * this.scale;

    // Wooden outer frame
    const frameGrad = ctx.createLinearGradient(tl.x - rail - frame, 0, br.x + rail + frame, 0);
    frameGrad.addColorStop(0, '#3a2113');
    frameGrad.addColorStop(0.5, '#5a3520');
    frameGrad.addColorStop(1, '#3a2113');
    ctx.fillStyle = frameGrad;
    roundRect(ctx, tl.x - rail - frame, tl.y - rail - frame, br.x - tl.x + (rail + frame) * 2, br.y - tl.y + (rail + frame) * 2, 22 * this.scale);
    ctx.fill();

    // Cushion rail
    ctx.fillStyle = '#0a3320';
    roundRect(ctx, tl.x - rail, tl.y - rail, br.x - tl.x + rail * 2, br.y - tl.y + rail * 2, 10 * this.scale);
    ctx.fill();

    // Felt
    const feltGrad = ctx.createRadialGradient(
      (tl.x + br.x) / 2,
      (tl.y + br.y) / 2,
      10,
      (tl.x + br.x) / 2,
      (tl.y + br.y) / 2,
      (br.x - tl.x) * 0.8
    );
    feltGrad.addColorStop(0, '#146245');
    feltGrad.addColorStop(1, '#0c4530');
    ctx.fillStyle = feltGrad;
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    // Head string (break line) — subtle guide
    const headX = this.toScreen({ x: TABLE.WIDTH * TABLE.HEAD_STRING_RATIO, y: 0 }).x;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(headX, tl.y);
    ctx.lineTo(headX, br.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pockets
    for (const pocket of getPockets()) {
      const p = this.toScreen(pocket.position);
      ctx.fillStyle = '#050505';
      ctx.beginPath();
      ctx.arc(p.x, p.y, pocket.radius * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /** Draws every on-table ball. Pass excludeCue=true to skip the cue ball (id 0) — used while ball-in-hand placement/aiming is overriding its visual position. */
  drawBalls(balls: BallState[], excludeCue = false): void {
    for (const ball of balls) {
      if (ball.pocketed || !ball.onTable) continue;
      if (excludeCue && ball.id === 0) continue;
      this.drawBall(ball);
    }
  }

  /** Ghost preview of a ball-in-hand candidate placement: green tint if legal, red if not. Never a real ball — purely a UI affordance. */
  drawPlacementPreview(position: Vec2, valid: boolean): void {
    const ctx = this.ctx;
    const p = this.toScreen(position);
    const r = BALL.RADIUS * this.scale;
    const tint = valid ? 'rgba(74, 157, 111, 0.55)' : 'rgba(184, 50, 61, 0.55)';
    const ringColor = valid ? '#4a9d6f' : '#b8323d';

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawBall(ball: BallState): void {
    const ctx = this.ctx;
    const def = BALL_DEFINITIONS.find((d) => d.id === ball.id)!;
    const p = this.toScreen(ball.position);
    const r = BALL.RADIUS * this.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = def.color;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);

    if (def.secondaryColor) {
      ctx.fillStyle = def.secondaryColor;
      ctx.fillRect(p.x - r, p.y - r * 0.55, r * 2, r * 1.1);
    }

    // Glossy highlight
    const gloss = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, 0, p.x - r * 0.35, p.y - r * 0.4, r * 1.3);
    gloss.addColorStop(0, 'rgba(255,255,255,0.55)');
    gloss.addColorStop(0.4, 'rgba(255,255,255,0.05)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = gloss;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.restore();

    // Number circle (solids and stripes only)
    if (ball.id !== 0) {
      ctx.beginPath();
      ctx.fillStyle = '#f3ede0';
      ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141414';
      ctx.font = `${Math.max(9, r * 0.55)}px ${getMonoFont()}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ball.id), p.x, p.y + 0.5);
    }

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawAimLine(cuePos: Vec2, direction: Vec2, enabled: boolean): void {
    if (!enabled) return;
    const ctx = this.ctx;
    const from = this.toScreen(cuePos);
    const to = this.toScreen(Vec2.add(cuePos, Vec2.scale(direction, 900)));
    ctx.save();
    ctx.strokeStyle = 'rgba(227, 194, 115, 0.55)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  drawCueStick(cuePos: Vec2, direction: Vec2, pullback: number): void {
    const ctx = this.ctx;
    const tip = this.toScreen(Vec2.sub(cuePos, Vec2.scale(direction, BALL.RADIUS + 6 + pullback)));
    const butt = this.toScreen(Vec2.sub(cuePos, Vec2.scale(direction, 260 + pullback)));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#caa06a';
    ctx.lineWidth = 5 * this.scale;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.strokeStyle = '#efe3d0';
    ctx.lineWidth = 2 * this.scale;
    const tipShaft = this.toScreen(Vec2.sub(cuePos, Vec2.scale(direction, BALL.RADIUS + 6 + pullback + 30)));
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tipShaft.x, tipShaft.y);
    ctx.stroke();
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getMonoFont(): string {
  return "'IBM Plex Mono', monospace";
}
