// Grabs a native 1920x1080 frame (or a region of it) from the browser that pwr already
// controls, so we can author ROIs while the bot's own launcher is blocked by the profile lock.
// Usage: node tools/pwr-grab.mjs <name> [x y width height] [scale]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pwr, selectGameTab } from './pwr.mjs';

const OUT_DIR = 'captures';
const PREFIX = 'data:image/png;base64,';

const [name = `frame-${Date.now()}`, ...rest] = process.argv.slice(2);
const numbers = rest.map(Number);
const region =
  numbers.length >= 4
    ? { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] }
    : { x: 0, y: 0, width: 1920, height: 1080 };
const scale = numbers.length >= 5 ? numbers[4] : 1;

const grab = `() => {
  const c = document.querySelector('#canvas-player');
  if (!c) throw new Error('canvas not found');
  const roi = ${JSON.stringify(region)};
  const off = document.createElement('canvas');
  off.width = Math.round(roi.width * ${scale});
  off.height = Math.round(roi.height * ${scale});
  const ctx = off.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, roi.x, roi.y, roi.width, roi.height, 0, 0, off.width, off.height);
  return off.toDataURL('image/png');
}`;

selectGameTab();
const stdout = pwr(['eval', grab], { maxBuffer: 64 * 1024 * 1024 });

const start = stdout.indexOf(PREFIX);
if (start === -1) throw new Error(`no image in pwr output:\n${stdout.slice(0, 400)}`);
const base64 = stdout.slice(start + PREFIX.length, stdout.indexOf('"', start));

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, `${name}.png`);
writeFileSync(path, Buffer.from(base64, 'base64'));
console.log(`${path} region=${region.x},${region.y} ${region.width}x${region.height} scale=${scale}`);
