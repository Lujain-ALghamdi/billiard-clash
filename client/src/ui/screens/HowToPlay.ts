export function renderHowToPlay(root: HTMLElement, onBack: () => void): void {
  root.innerHTML = `
    <div class="menu-screen screen-enter">
      <button class="back-link" id="back">&larr; Main Menu</button>
      <div class="panel menu-panel menu-panel--wide">
        <h2>HOW TO PLAY</h2>
        <div class="how-to-content">
          <h3>Controls</h3>
          <div class="control-list">
            <span class="keycap">Mouse Move</span><span class="control-desc">Aim</span>
            <span class="keycap">Left Click</span><span class="control-desc">Shoot</span>
            <span class="keycap">W</span><span class="control-desc">Increase shot power</span>
            <span class="keycap">S</span><span class="control-desc">Decrease shot power</span>
            <span class="keycap">Mouse Wheel</span><span class="control-desc">Adjust shot power</span>
            <span class="keycap">ESC</span><span class="control-desc">Pause menu</span>
          </div>

          <h3>Objective</h3>
          <p>Pocket all of your assigned group (solids 1–7 or stripes 9–15), then legally pocket the 8-ball to win.</p>

          <h3>Break &amp; open table</h3>
          <p>The table is "open" until a player legally pockets a ball after the break — whichever group they pot first becomes their group for the rest of the game.</p>

          <h3>Fouls</h3>
          <p>Scratching the cue ball, hitting the wrong group first, failing to contact any ball, or failing to send a ball to a rail after contact all result in a foul. Fouls grant your opponent ball-in-hand — they may place the cue ball anywhere before their next shot.</p>

          <h3>The 8-ball</h3>
          <p>Pocketing the 8-ball before clearing your group is an immediate loss. Pocketing it legally while also scratching the cue ball is also a loss. Pocket it cleanly after clearing your group to win.</p>

          <h3>Rules reference</h3>
          <p>This game follows the WPA (World Pool-Billiard Association) 8-Ball rules as its primary ruleset.</p>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#back')!.addEventListener('click', onBack);
}
