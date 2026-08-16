import './ui/styles.css';
import type { Difficulty, MatchState } from '@pool/shared';
import { loadSettings, type GameSettings } from './utils/settings';
import { SoundManager } from './audio/SoundManager';
import { renderMainMenu } from './ui/screens/MainMenu';
import { renderComputerMenu } from './ui/screens/ComputerMenu';
import { renderOnlineMenu } from './ui/screens/OnlineMenu';
import { renderHowToPlay } from './ui/screens/HowToPlay';
import { renderSettings } from './ui/screens/Settings';
import { renderCredits } from './ui/screens/Credits';
import { GameScreen } from './game/GameScreen';
import { VsComputerSession } from './game/VsComputerSession';
import { OnlineSession } from './game/OnlineSession';

const app = document.getElementById('app')!;
let settings: GameSettings = loadSettings();
const sound = new SoundManager(settings);
let activeGameScreen: GameScreen | null = null;

function teardownGame(): void {
  if (activeGameScreen) {
    activeGameScreen.destroy();
    activeGameScreen = null;
  }
}

function showMainMenu(): void {
  teardownGame();
  renderMainMenu(app, {
    onPlayOnline: showOnlineMenu,
    onPlayComputer: showComputerMenu,
    onHowToPlay: showHowToPlay,
    onSettings: showSettings,
    onCredits: showCredits,
  });
}

function showComputerMenu(): void {
  renderComputerMenu(app, settings.playerName, {
    onBack: showMainMenu,
    onStart: (playerName: string, difficulty: Difficulty) => {
      settings.playerName = playerName;
      const session = new VsComputerSession(playerName, difficulty);
      launchGame(session);
    },
  });
}

function showOnlineMenu(): void {
  renderOnlineMenu(app, settings.playerName, {
    onBack: showMainMenu,
    onMatchReady: (roomCode: string, playerId: string, state: MatchState) => {
      const session = new OnlineSession(roomCode, playerId, state);
      launchGame(session);
    },
  });
}

function showHowToPlay(): void {
  renderHowToPlay(app, showMainMenu);
}

function showSettings(): void {
  renderSettings(
    app,
    settings,
    (updated) => {
      settings = updated;
      sound.updateSettings(settings);
    },
    showMainMenu
  );
}

function showCredits(): void {
  renderCredits(app, showMainMenu);
}

function launchGame(session: VsComputerSession | OnlineSession): void {
  teardownGame();
  activeGameScreen = new GameScreen(app, session, sound, settings, {
    onExitToMenu: showMainMenu,
  });
}

showMainMenu();
