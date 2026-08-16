import type { GameSettings } from '../../utils/settings';
import { saveSettings } from '../../utils/settings';

export function renderSettings(root: HTMLElement, settings: GameSettings, onChange: (s: GameSettings) => void, onBack: () => void): void {
  function draw(): void {
    root.innerHTML = `
      <div class="menu-screen screen-enter">
        <button class="back-link" id="back">&larr; Main Menu</button>
        <div class="panel menu-panel">
          <h2>SETTINGS</h2>

          <div class="settings-row">
            <label for="master-volume">Master Volume</label>
            <input class="slider" type="range" id="master-volume" min="0" max="100" value="${Math.round(settings.masterVolume * 100)}" />
          </div>
          <div class="settings-row">
            <label for="sfx-volume">Sound Effects Volume</label>
            <input class="slider" type="range" id="sfx-volume" min="0" max="100" value="${Math.round(settings.sfxVolume * 100)}" />
          </div>
          <div class="settings-row">
            <label for="music-volume">Music Volume</label>
            <input class="slider" type="range" id="music-volume" min="0" max="100" value="${Math.round(settings.musicVolume * 100)}" />
          </div>
          <div class="settings-row">
            <label>Aim Line</label>
            <div class="toggle ${settings.aimLineEnabled ? 'on' : ''}" id="aim-toggle" role="switch" aria-checked="${settings.aimLineEnabled}" tabindex="0"></div>
          </div>
          <div class="settings-row">
            <label>Fullscreen</label>
            <div class="toggle ${settings.fullscreen ? 'on' : ''}" id="fullscreen-toggle" role="switch" aria-checked="${settings.fullscreen}" tabindex="0"></div>
          </div>
          <div class="settings-row">
            <label for="graphics-quality">Graphics Quality</label>
            <select id="graphics-quality" class="field" style="width:auto">
              <option value="low" ${settings.graphicsQuality === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${settings.graphicsQuality === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="high" ${settings.graphicsQuality === 'high' ? 'selected' : ''}>High</option>
            </select>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#back')!.addEventListener('click', onBack);

    const bindSlider = (id: string, key: keyof GameSettings) => {
      root.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('input', (e) => {
        (settings as any)[key] = Number((e.target as HTMLInputElement).value) / 100;
        persist();
      });
    };
    bindSlider('master-volume', 'masterVolume');
    bindSlider('sfx-volume', 'sfxVolume');
    bindSlider('music-volume', 'musicVolume');

    root.querySelector('#aim-toggle')!.addEventListener('click', () => {
      settings.aimLineEnabled = !settings.aimLineEnabled;
      persist();
      draw();
    });
    root.querySelector('#fullscreen-toggle')!.addEventListener('click', () => {
      settings.fullscreen = !settings.fullscreen;
      if (settings.fullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
      persist();
      draw();
    });
    root.querySelector('#graphics-quality')!.addEventListener('change', (e) => {
      settings.graphicsQuality = (e.target as HTMLSelectElement).value as GameSettings['graphicsQuality'];
      persist();
    });
  }

  function persist(): void {
    saveSettings(settings);
    onChange(settings);
  }

  draw();
}
