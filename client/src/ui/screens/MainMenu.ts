export interface MainMenuCallbacks {
  onPlayOnline: () => void;
  onPlayComputer: () => void;
  onHowToPlay: () => void;
  onSettings: () => void;
  onCredits: () => void;
}

export function renderMainMenu(root: HTMLElement, cb: MainMenuCallbacks): void {
  root.innerHTML = `
    <div class="menu-screen screen-enter">
      <div>
        <h1 class="menu-title">CLASSIC <span class="accent">8-BALL</span> POOL</h1>
        <div class="menu-subtitle">Online &amp; vs Computer</div>
      </div>
      <div class="menu-actions">
        <button class="btn btn-primary" id="play-online">Play Online</button>
        <button class="btn btn-primary" id="play-computer">Play vs Computer</button>
        <button class="btn btn-secondary" id="how-to-play">How to Play</button>
        <button class="btn btn-secondary" id="settings">Settings</button>
        <button class="btn btn-ghost" id="credits">Credits</button>
      </div>
    </div>
  `;
  root.querySelector('#play-online')!.addEventListener('click', cb.onPlayOnline);
  root.querySelector('#play-computer')!.addEventListener('click', cb.onPlayComputer);
  root.querySelector('#how-to-play')!.addEventListener('click', cb.onHowToPlay);
  root.querySelector('#settings')!.addEventListener('click', cb.onSettings);
  root.querySelector('#credits')!.addEventListener('click', cb.onCredits);
}
