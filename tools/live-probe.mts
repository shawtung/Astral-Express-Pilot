// Replays isSparkleOnField's exact logic (BOND_COLUMN ROI + OCR + containsFuzzy 0.6) against a
// saved 1920x1080 frame, so the reader can be verified offline on the real stream.
// Usage: pnpm tsx tools/live-probe.mts <png path>
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { containsFuzzy } from '../src/core/match.ts';
import { joinText, readBuffer } from '../src/core/ocr.ts';
import { BOND_COLUMN } from '../src/modules/currency-war/screens.ts';

const path = process.argv[2] ?? 'captures/prep2.png';
const bonds = ['战技点', '盛会之星', '量子同频'] as const;

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

// Same crop-plus-scale that readRegion performs against the live player element.
const url = await page.evaluate(({ x, y, width, height }) => {
  const img = (window as unknown as { frame: HTMLImageElement }).frame;
  const canvas = document.querySelector('canvas')!;
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}, BOND_COLUMN);

const text = joinText(await readBuffer(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')));
console.log(`ocr "${text}"`);
for (const bond of bonds) {
  console.log(`  ${bond}: ${containsFuzzy(text, bond, 0.6)}`);
}
await browser.close();
