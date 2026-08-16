import type { Difficulty } from '@pool/shared';

export interface ComputerMenuCallbacks {
  onStart: (playerName: string, difficulty: Difficulty) => void;
  onBack: () => void;
}

const DIFFICULTIES: { id: Difficulty; label: string; desc: string }[] = [
  { id: 'easy', label: 'EASY', desc: 'Loose aim, generous mistakes.' },
  { id: 'medium', label: 'MEDIUM', desc: 'Solid fundamentals, occasional misses.' },
  { id: 'hard', label: 'HARD', desc: 'Sharp angles, smart ball selection.' },
  { id: 'insane', label: 'INSANE', desc: 'Near-perfect aim and positioning.' },
];

export function renderComputerMenu(root: HTMLElement, defaultName: string, cb: ComputerMenuCallbacks): void {
  root.innerHTML = `
    <div class="menu-screen screen-enter">
      <button class="back-link" id="back">&larr; Main Menu</button>
      <div class="panel menu-panel">
        <h2>CHOOSE DIFFICULTY</h2>
        <div>
          <label class="field-label eyebrow" for="player-name">Player Name</label>
          <input class="field" type="text" id="player-name" maxlength="24" value="${escapeAttr(defaultName || 'Player')}" />
        </div>
        <div class="option-grid" id="difficulty-grid">
          ${DIFFICULTIES.map(
            (d) => `
            <button class="option-card" data-id="${d.id}">
              <div class="option-card-title">${d.label}</div>
              <div class="option-card-desc">${d.desc}</div>
            </button>`
          ).join('')}
        </div>
      </div>
    </div>
  `;

  root.querySelector('#back')!.addEventListener('click', cb.onBack);
  root.querySelectorAll<HTMLButtonElement>('.option-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nameInput = root.querySelector<HTMLInputElement>('#player-name')!;
      const name = nameInput.value.trim() || 'Player';
      cb.onStart(name, btn.dataset.id as Difficulty);
    });
  });
}

function escapeAttr(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
