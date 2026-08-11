import type { Page } from 'playwright';
import { waitForStream } from './browser.ts';
import type { Region } from './capture.ts';
import { GAME_HEIGHT, GAME_WIDTH, PLAYER_SELECTOR } from './config.ts';
import { report, throwIfCancelled } from './context.ts';
import { clickGame } from './input.ts';
import { joinText, readRegion } from './ocr.ts';
import { sleepAbout } from './util.ts';

/** The cloud client title card asks for a click anywhere; its prompt sits near the bottom. */
const TITLE_PROMPT: Region = { x: 560, y: 985, width: 800, height: 60 };

/** The prompt pulses, so it takes a few clean rounds in a row before calling it gone. */
const CLEAR_ROUNDS = 3;

/** Seconds to give the homepage SPA before deciding its button will never show up. */
const HOMEPAGE_ROUNDS = 30;

/** Cold start measured at ~50s, a warm reconnect at ~5s. Rounds are generous for a queue. */
const ROUNDS = 60;
const ROUND_MS = 3000;

async function readAt(page: Page, region: Region): Promise<string> {
  return joinText(await readRegion(page, region));
}

async function failureNotice(page: Page): Promise<string | null> {
  const dialog = page.locator('.van-dialog__message').first();
  if (!(await dialog.count())) return null;
  const text = (await dialog.textContent())?.trim();
  return text || null;
}

/**
 * Drives the cloud client from its homepage past the title card. Headless has no window to
 * click in, so every step here has to be automated rather than left to the operator. Deciding
 * that the world has finished loading is left to the module, which knows what to look for.
 */
export async function enterCloudGame(page: Page): Promise<void> {
  const known = page.getByText('我知道了', { exact: true }).first();
  const enter = page.getByText('进入游戏', { exact: true }).first();
  // An expired session swaps the homepage for a login form, whose only submit button is the tell.
  const login = page.locator('button[type=submit]').first();
  const player = page.locator(PLAYER_SELECTOR).first();

  // The homepage is a SPA, so nothing is on it for a second or two after navigation.
  let state: 'entered' | 'already' | null = null;
  for (let round = 0; round < HOMEPAGE_ROUNDS && !state; round++) {
    throwIfCancelled();
    if (await player.count()) {
      state = 'already';
      break;
    }
    if (await login.isVisible().catch(() => false)) {
      throw new Error('登录已过期，请先取消无头模式打开浏览器重新登录');
    }
    if (await known.isVisible().catch(() => false)) {
      await known.click();
      report('关掉「我知道了」弹窗');
    }
    if (await enter.isVisible().catch(() => false)) {
      await enter.click();
      state = 'entered';
      break;
    }
    await sleepAbout(1000, 0.1);
  }

  if (!state) throw new Error('首页上没出现「进入游戏」，页面可能没加载出来或掉登录了');
  report(state === 'entered' ? '点了「进入游戏」，等待云端实例' : '页面里已经有画面，跳过首页');

  await waitForStream(page);
  report('画面已就绪，星穹列车等待发车');

  let clicked = false;
  let clear = 0;
  for (let round = 0; round < ROUNDS; round++) {
    throwIfCancelled();

    const notice = await failureNotice(page);
    if (notice) throw new Error(`云游戏报错「${notice}」`);

    // The prompt breathes in and out, so these two characters are all OCR reliably agrees on.
    if ((await readAt(page, TITLE_PROMPT)).includes('点击')) {
      await clickGame(page, GAME_WIDTH / 2, GAME_HEIGHT / 2);
      clicked = true;
      clear = 0;
      report('点击发车');
    } else if (clicked && ++clear >= CLEAR_ROUNDS) {
      report('已发车，游戏正在载入');
      return;
    }

    await sleepAbout(ROUND_MS, 0.1);
  }

  throw new Error(clicked ? '点了「点击进入」但画面没往下走' : '没等到「点击进入」，云游戏可能没启动起来');
}
