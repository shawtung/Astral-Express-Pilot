// Replays screen detection against a saved frame, so a stuck capture can be diagnosed offline.
// Usage: pnpm tsx tools/screen-report.ts <png path> [x y width height]
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { containsFuzzy } from '../src/core/match.ts';
import { joinText, readBuffer } from '../src/core/ocr.ts';
import { SCREENS, type Region } from '../src/modules/currency-war/screens.ts';

const [path, ...rest] = process.argv.slice(2);
if (!path) throw new Error('usage: pnpm tsx tools/screen-report.ts <png path> [x y width height]');
const bounds = rest.slice(0, 4).map(Number);

const dataUrl = `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<canvas></canvas>');
await page.evaluate(async (url) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  Object.assign(window, { frame: img });
}, dataUrl);

async function crop(region: Region, scale = 2): Promise<Buffer> {
  const url = await page.evaluate(
    ({ x, y, width, height, scale }) => {
      const img = (window as unknown as { frame: HTMLImageElement }).frame;
      const canvas = document.querySelector('canvas')!;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    },
    { ...region, scale },
  );
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

if (bounds.length === 4 && bounds.every((value) => Number.isFinite(value))) {
  const [x, y, width, height] = bounds as [number, number, number, number];
  for (const scale of [2, 4]) {
    const lines = await readBuffer(await crop({ x, y, width, height }, scale));
    console.log(`scale=${scale} "${joinText(lines)}"`);
    for (const line of lines) {
      const xs = (line.box ?? []).map((point) => point[0] ?? 0);
      const ys = (line.box ?? []).map((point) => point[1] ?? 0);
      if (!xs.length) {
        console.log(`  ${line.mean.toFixed(3)} ${line.text}`);
        continue;
      }
      const cx = Math.round(x + (Math.min(...xs) + Math.max(...xs)) / 2 / scale);
      const cy = Math.round(y + (Math.min(...ys) + Math.max(...ys)) / 2 / scale);
      console.log(`  ${line.mean.toFixed(3)} ${line.text}  center=(${cx}, ${cy})`);
    }
  }
} else {
  for (const screen of Object.values(SCREENS)) {
    const text = joinText(await readBuffer(await crop(screen.probe)));
    const anchors = typeof screen.anchor === 'string' ? [screen.anchor] : screen.anchor;
    const hit = anchors.find((anchor) => containsFuzzy(text, anchor, 0.6));
    console.log(`${hit ? 'HIT ' : '    '} ${screen.id.padEnd(14)} anchor=${hit ?? '-'}  ocr="${text}"`);
  }
}

await browser.close();
