import { SHOT_POWER } from '@pool/shared';

export type PowerKeyCode = 'KeyW' | 'KeyS';

const POWER_KEY_CODES: ReadonlySet<string> = new Set(['KeyW', 'KeyS']);

/**
 * Tracks held shot-power keys by physical KeyboardEvent.code rather than
 * .key. .key reflects the character the active OS keyboard layout produces
 * (e.g. an Arabic layout's physical W-position key reports a Arabic letter
 * as .key), so a .key === 'w' check silently stops matching on non-English
 * layouts. .code always reports the physical key position ('KeyW') and is
 * unaffected by layout, IME, or Shift/AltGr state.
 */
export class PowerKeyController {
  private held = new Set<PowerKeyCode>();

  /** Returns true if this was a handled power key (so the caller can preventDefault its default browser behavior). */
  handleKeyDown(code: string): boolean {
    if (!POWER_KEY_CODES.has(code)) return false;
    this.held.add(code as PowerKeyCode);
    return true;
  }

  handleKeyUp(code: string): boolean {
    if (!POWER_KEY_CODES.has(code)) return false;
    this.held.delete(code as PowerKeyCode);
    return true;
  }

  /** Drops all held keys — call on window blur/visibility loss so power can't stay stuck ramping after the tab loses focus. */
  clear(): void {
    this.held.clear();
  }

  isHeld(code: PowerKeyCode): boolean {
    return this.held.has(code);
  }

  hasAny(): boolean {
    return this.held.size > 0;
  }

  /** Advances `currentPower` by dtSeconds worth of held-key input, clamped to SHOT_POWER.MIN/MAX. */
  tick(currentPower: number, dtSeconds: number): number {
    let power = currentPower;
    if (this.held.has('KeyW')) power += SHOT_POWER.STEP_PER_SECOND * dtSeconds;
    if (this.held.has('KeyS')) power -= SHOT_POWER.STEP_PER_SECOND * dtSeconds;
    return Math.max(SHOT_POWER.MIN, Math.min(SHOT_POWER.MAX, power));
  }
}
