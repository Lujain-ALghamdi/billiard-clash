import { isValidRoomCode, SHOT_POWER, type ShotRequest } from '@pool/shared';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateRoomCodeInput(code: unknown): ValidationResult {
  if (typeof code !== 'string' || !isValidRoomCode(code)) {
    return { valid: false, reason: 'Room code must look like 8B-XXXX.' };
  }
  return { valid: true };
}

export function validatePlayerName(name: unknown): ValidationResult {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, reason: 'Player name is required.' };
  }
  if (name.length > 24) {
    return { valid: false, reason: 'Player name must be 24 characters or fewer.' };
  }
  return { valid: true };
}

/** Validates the shape and numeric bounds of a shot request from an untrusted client. */
export function validateShotRequest(shot: unknown): ValidationResult {
  if (typeof shot !== 'object' || shot === null) {
    return { valid: false, reason: 'Malformed shot payload.' };
  }
  const s = shot as Partial<ShotRequest>;

  if (
    !s.direction ||
    typeof s.direction.x !== 'number' ||
    typeof s.direction.y !== 'number' ||
    !Number.isFinite(s.direction.x) ||
    !Number.isFinite(s.direction.y) ||
    (s.direction.x === 0 && s.direction.y === 0)
  ) {
    return { valid: false, reason: 'Shot direction must be a non-zero finite vector.' };
  }

  if (typeof s.power !== 'number' || !Number.isFinite(s.power) || s.power < SHOT_POWER.MIN || s.power > SHOT_POWER.MAX) {
    return { valid: false, reason: `Shot power must be between ${SHOT_POWER.MIN} and ${SHOT_POWER.MAX}.` };
  }

  if (s.cueBallPlacement) {
    const { x, y } = s.cueBallPlacement;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { valid: false, reason: 'Cue ball placement must be a finite point.' };
    }
  }

  return { valid: true };
}
