import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, nativeImage, Notification, protocol, shell } from 'electron';
import type { GameSession } from '../../src/core/browser.ts';
import { Cancelled, withRunContext } from '../../src/core/context.ts';
import { ENVIRONMENTS, STRATEGIES } from '../../src/modules/currency-war/data/codex.ts';
import type { TargetConfig } from '../../src/modules/currency-war/target.ts';
import type { StopReason } from '../../src/notify.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The cloud client's own favicon, which ships as a .ico but is really a PNG. */
const ICON_PATH = join(here, '../../app/resources/icon.png');

/** Windows toasts are filed under this id, and show up as nothing recognisable without it. */
const APP_ID = 'com.shawn.astral-express-pilot';

/** Serves the screenshots dir to the renderer, which cannot reach file:// from a dev server. */
const CAPTURE_SCHEME = 'capture';
protocol.registerSchemesAsPrivileged([
  { scheme: CAPTURE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Must run before ready. Left alone, userData would follow the app name and split dev from
// packaged builds into two dirs, so the login would not carry over between them.
const DATA_DIR = join(app.getPath('appData'), 'astral-express-pilot');
app.setPath('userData', DATA_DIR);

// Electron otherwise drops its own cookies and caches straight into the data dir root, where they
// bury the bot's own dirs under two dozen entries. setPath rejects a directory that is not there yet.
const SESSION_DIR = join(DATA_DIR, 'AppSession');
mkdirSync(SESSION_DIR, { recursive: true });
app.setPath('sessionData', SESSION_DIR);

let window: BrowserWindow | null = null;
let session: GameSession | null = null;
/** How the current browser was opened, so a drop-out restart matches it. */
let sessionHeadless = false;
let running: AbortController | null = null;

function send(channel: string, payload: unknown): void {
  window?.webContents.send(channel, payload);
}

function log(message: string): void {
  send('bot:log', { at: Date.now(), message });
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 600,
    height: 480,
    // app.getVersion reads package.json in dev (via ELECTRON_RENDERER_URL's project root) and
    // the bundle version when packaged, so one expression covers both.
    title: `Astral Express Pilot v${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
    icon: ICON_PATH,
    webPreferences: { preload: join(here, '../preload/index.cjs') },
  });

  // Anything the page tries to open goes to the real browser, never a second Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Renderer errors are otherwise only visible in DevTools, which hides white-screen bugs.
  window.webContents.on('console-message', (details) => {
    console.log(`[renderer] ${details.message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] 崩溃: ${details.reason}`);
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(here, '../renderer/index.html'));

  window.on('closed', () => {
    window = null;
  });
}

ipcMain.handle('codex:load', () => ({
  environments: ENVIRONMENTS.map((item) => ({ name: item.name, standardOnly: item.standardOnly })),
  strategies: STRATEGIES.map((item) => ({
    name: item.name,
    rarity: item.rarity,
    planes: item.planes,
    standardOnly: item.standardOnly,
  })),
}));

ipcMain.handle('browser:open', async (_event, headless = false) => {
  try {
    return await openBrowser(headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`出错: ${message}`);
    notify('打开浏览器失败', message);
    throw error;
  }
});

async function openBrowser(headless: boolean): Promise<{ ok: boolean }> {
  const { openGame, waitForStream } = await import('../../src/core/browser.ts');
  // A browser left behind by an earlier attempt still holds the profile lock and the debug port.
  await closeSession();
  log(headless ? '正在以无头模式打开浏览器...' : '正在打开浏览器...');
  session = await openGame({ headless });
  sessionHeadless = headless;

  if (!headless) {
    log('等待云游戏画面就绪...');
    await waitForStream(session.page);
    log('画面已就绪。请登录并把游戏停在「货币战争」初始界面。');
    return { ok: true };
  }

  // Nobody can click in a headless window, so the whole cold start is driven from here.
  const { enterCloudGame } = await import('../../src/core/launch.ts');
  const { currencyWar } = await import('../../src/modules/currency-war/index.ts');
  const controller = new AbortController();
  running = controller;
  try {
    await withRunContext({ signal: controller.signal, log }, async () => {
      await enterCloudGame(session!.page);
      await currencyWar.reachStart?.(session!.page);
    });
  } catch (error) {
    // A browser left half way through still holds the profile lock and blocks the next open.
    if (session.owned) await session.context.close();
    session = null;
    if (!(error instanceof Cancelled)) throw error;
    log('已停止');
    return { ok: false };
  } finally {
    running = null;
  }
  log('已到达活动页，可以点「开始刷取」。');
  return { ok: true };
}

ipcMain.handle('bot:validate', async (_event, config: TargetConfig) => {
  const { currencyWar } = await import('../../src/modules/currency-war/index.ts');
  return currencyWar.validate(config);
});

ipcMain.handle('bot:start', async (_event, config: TargetConfig): Promise<StopReason | 'error'> => {
  if (!session) throw new Error('浏览器还没打开');
  if (running) throw new Error('已经在跑了');

  const { currencyWar } = await import('../../src/modules/currency-war/index.ts');
  const problems = currencyWar.validate(config);
  if (problems.length) throw new Error(problems.map((p) => p.message).join('；'));

  const controller = new AbortController();
  running = controller;
  const startedAt = Date.now();
  try {
    const { restartGame, MAX_OFFLINE_RESTARTS } = await import('../../src/core/launch.ts');
    let restarts = 0;
    for (;;) {
      const reason = await withRunContext({ signal: controller.signal, log }, () =>
        currencyWar.run(session!.page, config),
      );
      if (reason !== 'offline') {
        notify(STOP_TITLES[reason], `耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);
        return reason;
      }
      if (++restarts > MAX_OFFLINE_RESTARTS) {
        notify(STOP_TITLES.stuck, '重进多次仍被踢下线，请手动确认');
        return 'stuck';
      }
      log(`掉线重进（第 ${restarts}/${MAX_OFFLINE_RESTARTS} 次）`);
      session = await restartGame(session!, sessionHeadless, currencyWar.reachStart);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`出错: ${message}`);
    notify('刷取出错了', message);
    return 'error';
  } finally {
    running = null;
    // target-found closes the tab, so the next start has to open a fresh one.
    if (session?.page.isClosed()) session = null;
  }
});

ipcMain.handle('bot:stop', () => {
  running?.abort();
  return { ok: true };
});

// Whatever APP_DIR points at is where the profile and the screenshots land.
ipcMain.handle('app:data-dir', () => process.env.APP_DIR ?? '');
ipcMain.handle('app:open-data-dir', async () => {
  const dir = process.env.APP_DIR;
  if (!dir) return { ok: false };
  return { ok: !(await shell.openPath(dir)) };
});

ipcMain.handle('app:open-capture', async (_event, path: unknown) => {
  if (typeof path !== 'string') return { ok: false };
  const { CAPTURE_DIR } = await import('../../src/core/config.ts');
  // The path comes from the renderer, so nothing outside our own screenshots may be opened.
  const full = resolve(path);
  if (!full.startsWith(CAPTURE_DIR + sep)) return { ok: false };
  return { ok: !(await shell.openPath(full)) };
});

ipcMain.handle('app:capture-url', async (_event, path: unknown) => {
  if (typeof path !== 'string') return '';
  const { CAPTURE_DIR } = await import('../../src/core/config.ts');
  const full = resolve(path);
  if (!full.startsWith(CAPTURE_DIR + sep)) return '';
  if (!process.env.ELECTRON_RENDERER_URL) return `${CAPTURE_SCHEME}://${full}`;
  const relative = full.slice(CAPTURE_DIR.length + 1);
  return `/capture/${relative.split(sep).map(encodeURIComponent).join('/')}`;
});

const STOP_TITLES: Record<StopReason, string> = {
  'target-found': '刷到目标了',
  'run-in-progress': '有未结算的对局',
  stuck: '卡住了',
  offline: '掉线了，正在重进',
  cancelled: '已停止',
};

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const toast = new Notification({ title, body, icon: ICON_PATH });
  // The point of the toast is that nobody is watching the app, so it has to lead back to it.
  toast.on('click', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
  });
  toast.show();
}

/** Never let a wedged browser hold the app hostage; a leaked process beats an unquittable app. */
const CLOSE_TIMEOUT_MS = 3000;

/**
 * A headless browser has no window to close and keeps both the profile lock and the debug port,
 * which the next launch would then attach to instead of starting fresh.
 */
async function closeSession(): Promise<void> {
  running?.abort();
  const current = session;
  session = null;
  if (!current?.owned) return;
  await Promise.race([
    current.context.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
}

app.whenReady().then(async () => {
  // Must be set before any notification, and Windows only groups toasts correctly with it.
  app.setAppUserModelId(APP_ID);
  // The bot resolves its browser profile from APP_DIR.
  process.env.APP_DIR = app.getPath('userData');
  // Native ORT cannot read inside the asar, so packaged models ship as an extra resource.
  if (app.isPackaged) process.env.MODELS_DIR = join(process.resourcesPath, 'models');
  // capture://<absolute path> previews a screenshot, scoped to the screenshots dir so an
  // arbitrary page path cannot ride the scheme out of it. fs.read rather than net.fetch,
  // which refuses file:// URLs outright.
  const { CAPTURE_DIR } = await import('../../src/core/config.ts');
  protocol.handle(CAPTURE_SCHEME, async (request) => {
    const target = decodeURIComponent(request.url.slice(`${CAPTURE_SCHEME}://`.length));
    const full = resolve(target);
    if (!full.startsWith(CAPTURE_DIR + sep)) return new Response(null, { status: 403 });
    try {
      const data = await readFile(full);
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(data.length) },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  // macOS ignores BrowserWindow.icon and takes the dock icon from the bundle, which dev has none of.
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(ICON_PATH));
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

let quitting = false;

// Quitting from the dock or the menu skips window-all-closed entirely.
app.on('before-quit', (event) => {
  if (quitting || !session?.owned) return;
  event.preventDefault();
  quitting = true;
  void closeSession().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive here, so the browser has to go even though we are not quitting.
  void closeSession().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
