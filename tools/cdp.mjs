// Attaches to the running bot's browser over CDP so we can watch and nudge it while it plays.
// The bot owns the profile lock, so pwr cannot be used at the same time.
// Usage: node tools/cdp.mjs grab <name>
//        node tools/cdp.mjs shot <name>
//        node tools/cdp.mjs click <x> <y>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ENDPOINT = 'http://127.0.0.1:9222';
const OUT_DIR = 'captures';

const [command, ...rest] = process.argv.slice(2);

const browser = await chromium.connectOverCDP(ENDPOINT);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().includes('sr.mihoyo.com/cloud'));
if (!page) throw new Error(`game tab not found; open tabs: ${pages.map((p) => p.url()).join(', ') || '(none)'}`);

// The SDK swaps between a 2D canvas and a <video> between stages, so both must be matched.
const PLAYER = '#canvas-player, video.game-player__video';

if (command === 'grab') {
  const name = rest[0] ?? `cdp-${Date.now()}`;
  const url = await page.evaluate((sel) => {
    const source = document.querySelector(sel);
    if (!source) throw new Error('player not found');
    const off = document.createElement('canvas');
    off.width = source.videoWidth ?? source.width;
    off.height = source.videoHeight ?? source.height;
    off.getContext('2d').drawImage(source, 0, 0);
    return off.toDataURL('image/png');
  }, PLAYER);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.png`);
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path);
} else if (command === 'shot') {
  const name = rest[0] ?? `shot-${Date.now()}`;
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  console.log(`${path}  url=${page.url()}`);
} else if (command === 'text') {
  const info = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      canvas: el ? el.tagName.toLowerCase() : 'none',
      text: document.body.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, 800),
    };
  }, PLAYER);
  console.log(`player=${info.canvas}\n---\n${info.text}`);
} else if (command === 'click') {
  const [x, y] = rest.map(Number);
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const box = el.getBoundingClientRect();
    const w = el.videoWidth ?? el.width;
    const h = el.videoHeight ?? el.height;
    const fit = getComputedStyle(el).objectFit;
    if (fit !== 'contain' && fit !== 'scale-down') {
      return { left: box.left, top: box.top, width: box.width, height: box.height, w, h };
    }
    const scale = Math.min(box.width / w, box.height / h);
    return {
      left: box.left + (box.width - w * scale) / 2,
      top: box.top + (box.height - h * scale) / 2,
      width: w * scale,
      height: h * scale,
      w,
      h,
    };
  }, PLAYER);
  await page.mouse.click(rect.left + (x / rect.w) * rect.width, rect.top + (y / rect.h) * rect.height);
  console.log(`clicked ${x},${y}`);
} else {
  throw new Error(`unknown command: ${command}`);
}

await browser.close();
