import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { CAPTURE_DIR, GAME_HEIGHT, GAME_WIDTH, PLAYER_SELECTOR } from './config.ts';

/** A rectangle in 1920x1080 game space. */
export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const FULL_FRAME: Region = { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT };

export type GrabOptions = {
  /** Upscales while copying; small in-game text is detected much better at 2-3x. */
  scale?: number;
};

/**
 * Reads pixels straight out of the stream, so the result is always at native
 * 1920x1080 scale no matter how large the browser window is.
 */
export async function grab(page: Page, region: Region = FULL_FRAME, options: GrabOptions = {}): Promise<Buffer> {
  const scale = options.scale ?? 1;
  const dataUrl = await page.evaluate(
    ({ sel, roi, scale }) => {
      const source = document.querySelector(sel) as HTMLCanvasElement | HTMLVideoElement | null;
      if (!source) throw new Error(`game player not found: ${sel}`);
      const off = document.createElement('canvas');
      off.width = Math.round(roi.width * scale);
      off.height = Math.round(roi.height * scale);
      const ctx = off.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, roi.x, roi.y, roi.width, roi.height, 0, 0, off.width, off.height);
      return off.toDataURL('image/png');
    },
    { sel: PLAYER_SELECTOR, roi: region, scale },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

export async function grabToFile(page: Page, name: string, region?: Region): Promise<string> {
  const png = await grab(page, region);
  await mkdir(CAPTURE_DIR, { recursive: true });
  const path = join(CAPTURE_DIR, `${name}.png`);
  await writeFile(path, png);
  return path;
}
