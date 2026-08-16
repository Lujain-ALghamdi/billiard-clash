export interface GameSettings {
  masterVolume: number; // 0-1
  sfxVolume: number; // 0-1
  musicVolume: number; // 0-1
  aimLineEnabled: boolean;
  fullscreen: boolean;
  graphicsQuality: 'low' | 'medium' | 'high';
  playerName: string;
}

const STORAGE_KEY = 'pool.settings.v1';

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  aimLineEnabled: true,
  fullscreen: false,
  graphicsQuality: 'high',
  playerName: '',
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // LocalStorage unavailable (private mode, quota, etc). Fail silently — settings are non-critical.
  }
}
