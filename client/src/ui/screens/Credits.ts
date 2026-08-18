export function renderCredits(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="menu-screen screen-enter">
      <button class="back-link" id="back">&larr; Main Menu</button>
      <div class="panel menu-panel menu-panel--wide">
        <h2>CREDITS</h2>
        <div class="credits-content">
          <h3 class="credits-game-name">Billiard Clash</h3>
          <p>A classic 8-ball pool experience built for competitive and casual play.</p>
          <p>Built with <strong>TypeScript, HTML5 Canvas, Node.js, Express, and Socket.IO</strong>, with real-time multiplayer gameplay and physics-based ball movement.</p>
          <p>Game rules are based on the <strong>WPA (World Pool-Billiard Association) 8-Ball ruleset</strong>.</p>
          <p>Sound effects are generated at runtime using the <strong>Web Audio API</strong>, with no third-party audio assets required.</p>

          <div class="credits-divider"></div>

          <p class="credits-signature">designed and developed by <span class="credits-author">Lujain Alghamdi</span> © 2026</p>
          <p class="credits-tagline">Aim. Break. Compete.</p>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#back')!.addEventListener('click', onBack);
}
