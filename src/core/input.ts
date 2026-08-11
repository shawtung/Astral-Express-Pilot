import type { Page } from 'playwright';
import { playerRect } from './browser.ts';
import { randomBetween, sleep, vary } from './util.ts';

export type ClickOptions = {
  /** Max pixel offset (in game space) applied to the target point. */
  jitter?: number;
};

/** Maps a point in 1920x1080 game space to CSS pixels in the page. */
export async function toPagePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const rect = await playerRect(page);
  return {
    x: rect.left + (x / rect.backingWidth) * rect.width,
    y: rect.top + (y / rect.backingHeight) * rect.height,
  };
}

/** Clicks a point given in 1920x1080 game space. Uses CDP input, so events are trusted. */
export async function clickGame(page: Page, x: number, y: number, options: ClickOptions = {}): Promise<void> {
  const jitter = options.jitter ?? 4;
  const target = await toPagePoint(
    page,
    x + randomBetween(-jitter, jitter),
    y + randomBetween(-jitter, jitter),
  );
  await page.mouse.move(target.x, target.y);
  await sleep(randomBetween(30, 80));
  await page.mouse.down();
  await sleep(randomBetween(40, 90));
  await page.mouse.up();
}

/** The game ignores a key whose press and release land in the same frame, so hold it. */
export async function holdKey(page: Page, key: string, holdMs = 220): Promise<void> {
  await page.keyboard.down(key);
  await sleep(vary(holdMs, 0.15));
  await page.keyboard.up(key);
}

export type Point = { x: number; y: number };

export type DragOptions = {
  /** Number of intermediate move events. Too few and the stream never sees a drag. */
  steps?: number;
  /** Roughly how long the pointer travels, in ms. Varied by +/-20% per call. */
  travelMs?: number;
  /** Pause after pressing down, before moving. Lets the game register the pick-up. */
  grabHoldMs?: number;
  /** Pause at the destination before releasing, so the drop target highlights first. */
  dropHoldMs?: number;
  /** Max pixel offset (in game space) applied to both endpoints. */
  jitter?: number;
};

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Drags between two points in 1920x1080 game space, e.g. moving a character from the
 * bench into a front row slot. The moves are spread over real time because the cloud
 * client samples pointer position per frame and would drop a single jump to the target.
 * The path bows sideways and every wait is randomised so two drags never look alike.
 */
export async function dragGame(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const steps = Math.max(4, Math.round(vary(options.steps ?? 24, 0.15)));
  const travelMs = vary(options.travelMs ?? 500, 0.2);
  const jitter = options.jitter ?? 5;
  const offset = () => randomBetween(-jitter, jitter);
  const start = await toPagePoint(page, from.x + offset(), from.y + offset());
  const end = await toPagePoint(page, to.x + offset(), to.y + offset());

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  // Humans never drag in a straight line, so bow the path perpendicular to it.
  const bow = randomBetween(0.02, 0.06) * distance * (Math.random() < 0.5 ? -1 : 1);
  const normalX = distance === 0 ? 0 : -dy / distance;
  const normalY = distance === 0 ? 0 : dx / distance;

  await page.mouse.move(start.x, start.y);
  await sleep(randomBetween(60, 120));
  await page.mouse.down();
  await sleep(options.grabHoldMs ?? randomBetween(140, 220));

  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    const t = easeInOut(progress);
    const arc = Math.sin(progress * Math.PI) * bow;
    await page.mouse.move(
      start.x + dx * t + normalX * arc + randomBetween(-1, 1),
      start.y + dy * t + normalY * arc + randomBetween(-1, 1),
    );
    await sleep(vary(travelMs / steps, 0.45));
  }

  await page.mouse.move(end.x, end.y);
  await sleep(options.dropHoldMs ?? randomBetween(160, 260));
  await page.mouse.up();
  await sleep(randomBetween(80, 140));
}
