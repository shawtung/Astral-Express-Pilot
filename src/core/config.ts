import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Must match the name app/main/index.ts passes to app.setPath, or the two stop sharing a login. */
const APP_NAME = 'astral-express-pilot';

/** Electron's own rule for `appData`, restated so the CLI lands in the same place the app does. */
function sharedDataDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', APP_NAME);
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_NAME);
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), APP_NAME);
}

export const GAME_URL = 'https://sr.mihoyo.com/cloud/';

/** The SDK swaps between a 2D canvas and a <video> between stages, so both must be matched. */
export const PLAYER_SELECTOR = '#canvas-player, video.game-player__video';

/** Stream frame size, constant regardless of window size. All ROIs are authored in this space. */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** Set by the Electron main process from its real userData; the CLI derives the same path itself. */
const appDir = process.env.APP_DIR ?? sharedDataDir();

/** Deliberately not a temp dir: the cloud-game login and in-game settings must survive restarts. */
export const PROFILE_DIR = resolve(appDir, 'ChromeProfile');
// Stays in the project for CLI runs, where captures are opened by hand right after grabbing.
export const CAPTURE_DIR = process.env.APP_DIR
  ? resolve(process.env.APP_DIR, 'Screenshots')
  : resolve(root, 'captures');
export const TMP_DIR = resolve(CAPTURE_DIR, '.tmp');

/** Only set by packaged builds, where the models ship beside the asar instead of inside it. */
export const MODELS_DIR = process.env.MODELS_DIR || null;

/** Exposed so pwr / DevTools can attach to the bot's browser while it runs. */
export const DEBUG_PORT = 9222;
