import { readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { DEBUG_PORT, GAME_URL, GAME_WIDTH, PLAYER_SELECTOR, PROFILE_DIR } from './config.ts';
import { report, throwIfCancelled } from './context.ts';
import { sleep } from './util.ts';

/** How often the stream wait checks in, which is also how fast a stop is noticed. */
const POLL_MS = 1000;
const PROGRESS_MS = 15_000;

export type GameSession = {
  context: BrowserContext;
  page: Page;
  /** False when we attached to a browser we did not start, so shutting it down is not ours to do. */
  owned: boolean;
};

const CLOUD_PREFIX = 'https://sr.mihoyo.com/cloud/';

/** Default when the caller does not pick, which is how the CLI is driven. */
export const envHeadless = process.env.HEADLESS === '1';

export async function openGame(options: { headless?: boolean } = {}): Promise<GameSession> {
  const headless = options.headless ?? envHeadless;
  // Attaching in headless mode could land on a visible browser, which would prove nothing.
  const session = (headless ? null : await attachToRunning()) ?? (await launchOwn(headless));
  if (!session.page.url().startsWith(CLOUD_PREFIX)) {
    await session.page.goto(GAME_URL);
  }
  return session;
}

/** Reuses a browser left open by an earlier run, which also avoids a slow cloud-game cold start. */
async function attachToRunning(): Promise<GameSession | null> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  } catch {
    return null;
  }
  const context = browser.contexts()[0];
  const page = context?.pages().find((candidate) => candidate.url().startsWith(CLOUD_PREFIX));
  if (!context || !page) {
    await browser.close();
    return null;
  }
  console.log('已接管正在运行的浏览器');
  return { context, page, owned: false };
}

async function launchOwn(headless: boolean): Promise<GameSession> {
  let context;
  try {
    context = await launchContext(headless);
  } catch (error) {
    if (!String(error).includes('ProcessSingleton')) throw error;
    if (!(await clearDeadProfileLock())) {
      throw new Error('浏览器配置目录正被另一个 Chrome 占用，先关掉它再重试');
    }
    context = await launchContext(headless);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, owned: true };
}

async function launchContext(headless: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless,
    viewport: headless ? { width: 1600, height: 980 } : null,
    args: [`--remote-debugging-port=${DEBUG_PORT}`, '--window-size=1600,980'],
  });
}

/** A killed Chrome leaves its lock behind and every later launch aborts on it. */
async function clearDeadProfileLock(): Promise<boolean> {
  const lock = join(PROFILE_DIR, 'SingletonLock');
  // The symlink points at `hostname-pid`, and that pid says whether a browser still owns the profile.
  const target = await readlink(lock).catch(() => null);
  if (target === null) return false;
  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (pid > 0 && isAlive(pid)) return false;
  await rm(lock, { force: true });
  return true;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True once the player element exists and carries real frames. */
export async function hasFrames(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ sel, width }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return (el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLCanvasElement).width) === width;
    },
    { sel: PLAYER_SELECTOR, width: GAME_WIDTH },
  );
}

/**
 * Polls instead of using `waitForFunction`, which parks inside Playwright for the whole
 * timeout and would swallow a stop for minutes.
 */
export async function waitForStream(page: Page, timeoutMs = 180_000): Promise<void> {
  const startedAt = Date.now();
  let reportedAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    throwIfCancelled();
    if (await hasFrames(page)) return;

    const waited = Date.now() - startedAt;
    if (waited - reportedAt >= PROGRESS_MS) {
      reportedAt = waited;
      report(`还在等云端画面（${Math.round(waited / 1000)}s）`);
    }
    await sleep(POLL_MS);
  }

  throw new Error(`等待云游戏画面超时（${Math.round(timeoutMs / 1000)}s）`);
}

export type PlayerRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  backingWidth: number;
  backingHeight: number;
};

/** Rect of the drawn frame, excluding letterbox bars an object-fit video may add. */
export async function playerRect(page: Page): Promise<PlayerRect> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`game player not found: ${sel}`);
    const video = el instanceof HTMLVideoElement;
    const backingWidth = video ? el.videoWidth : (el as HTMLCanvasElement).width;
    const backingHeight = video ? el.videoHeight : (el as HTMLCanvasElement).height;
    if (!backingWidth || !backingHeight) throw new Error('game player has no frame yet');

    const box = el.getBoundingClientRect();
    const fit = getComputedStyle(el).objectFit;
    if (fit !== 'contain' && fit !== 'scale-down') {
      return { left: box.left, top: box.top, width: box.width, height: box.height, backingWidth, backingHeight };
    }
    const scale = Math.min(box.width / backingWidth, box.height / backingHeight);
    const width = backingWidth * scale;
    const height = backingHeight * scale;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width,
      height,
      backingWidth,
      backingHeight,
    };
  }, PLAYER_SELECTOR);
}
