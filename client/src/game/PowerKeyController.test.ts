import { describe, it, expect, beforeEach } from 'vitest';
import { SHOT_POWER } from '@pool/shared';
import { PowerKeyController } from './PowerKeyController';

describe('PowerKeyController — layout-independent power keys', () => {
  let controller: PowerKeyController;

  beforeEach(() => {
    controller = new PowerKeyController();
  });

  it('increases power while the physical W key (KeyW) is held, regardless of a non-English .key value', () => {
    // Simulates an Arabic keyboard layout: the physical W-position key
    // reports code:'KeyW' but key:'ش' (an Arabic letter), not 'w'.
    const handled = controller.handleKeyDown('KeyW');
    expect(handled).toBe(true);

    let power = SHOT_POWER.DEFAULT as number;
    power = controller.tick(power, 1); // 1 second held
    expect(power).toBeGreaterThan(SHOT_POWER.DEFAULT as number);
  });

  it('decreases power while the physical S key (KeyS) is held, regardless of a non-English .key value', () => {
    // Simulates the physical S-position key on a non-English layout reporting a non-'s' key value.
    controller.handleKeyDown('KeyS');

    let power = SHOT_POWER.DEFAULT as number;
    power = controller.tick(power, 1);
    expect(power).toBeLessThan(SHOT_POWER.DEFAULT as number);
  });

  it('stops adjusting power immediately once the key is released', () => {
    controller.handleKeyDown('KeyW');
    const powerAfterHold = controller.tick(50, 1);
    controller.handleKeyUp('KeyW');
    const powerAfterRelease = controller.tick(powerAfterHold, 1);
    expect(powerAfterRelease).toBe(powerAfterHold);
  });

  it('clamps to SHOT_POWER.MAX and never exceeds it', () => {
    controller.handleKeyDown('KeyW');
    let power = SHOT_POWER.DEFAULT as number;
    for (let i = 0; i < 50; i++) power = controller.tick(power, 1); // way more than enough to hit the ceiling
    expect(power).toBe(SHOT_POWER.MAX);
  });

  it('clamps to SHOT_POWER.MIN and never goes below it', () => {
    controller.handleKeyDown('KeyS');
    let power = SHOT_POWER.DEFAULT as number;
    for (let i = 0; i < 50; i++) power = controller.tick(power, 1);
    expect(power).toBe(SHOT_POWER.MIN);
  });

  it('ignores unrelated key codes', () => {
    expect(controller.handleKeyDown('KeyA')).toBe(false);
    expect(controller.hasAny()).toBe(false);
  });

  it('clear() drops all held keys (used on window blur / tab hidden)', () => {
    controller.handleKeyDown('KeyW');
    controller.handleKeyDown('KeyS');
    expect(controller.hasAny()).toBe(true);
    controller.clear();
    expect(controller.hasAny()).toBe(false);
    // Ticking after clear should not move power at all.
    expect(controller.tick(50, 1)).toBe(50);
  });
});
