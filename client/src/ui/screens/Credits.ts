export function renderCredits(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="menu-screen screen-enter">
      <button class="back-link" id="back">&larr; Main Menu</button>
      <div class="panel menu-panel">
        <h2>CREDITS</h2>
        <div class="credits-content">
          <p><strong>Classic 8-Ball Pool</strong> — an original TypeScript pool game.</p>
          <p>Built with TypeScript, HTML5 Canvas, Node.js, Express, and Socket.IO.</p>
          <p>All sound effects are synthesized at runtime with the Web Audio API — no third-party audio assets are used.</p>
          <p>Rules based on the WPA (World Pool-Billiard Association) 8-Ball ruleset.</p>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#back')!.addEventListener('click', onBack);
}
