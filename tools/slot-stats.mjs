// Measures bench slot statistics from a saved frame, so thresholds can be calibrated offline.
// Usage: node tools/slot-stats.mjs <png path>
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const path = process.argv[2];
if (!path) throw new Error('usage: node tools/slot-stats.mjs <png path>');

const dataUrl = `data:image/png;base64,${(await readFile(path)).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

const rows = await page.evaluate(async (url) => {
  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.querySelector('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const out = [];
  for (let i = 0; i < 8; i++) {
    const data = ctx.getImageData(437 + i * 125 - 50, 861, 100, 100).data;
    const count = data.length / 4;
    const luma = [];
    let sum = [0, 0, 0];
    for (let j = 0; j < data.length; j += 4) {
      sum[0] += data[j];
      sum[1] += data[j + 1];
      sum[2] += data[j + 2];
      luma.push((data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000);
    }
    const mean = sum.map((v) => v / count);
    let dev = 0;
    for (let j = 0; j < data.length; j += 4) {
      dev += Math.abs(data[j] - mean[0]) + Math.abs(data[j + 1] - mean[1]) + Math.abs(data[j + 2] - mean[2]);
    }
    luma.sort((a, b) => a - b);
    out.push({
      slot: i,
      mean: mean.map((v) => Math.round(v)).join(','),
      spread: +(dev / (count * 3)).toFixed(1),
      maxLuma: Math.round(luma[luma.length - 1]),
      p99: Math.round(luma[Math.floor(count * 0.99)]),
      p90: Math.round(luma[Math.floor(count * 0.9)]),
    });
  }
  return out;
}, dataUrl);

for (const row of rows) {
  console.log(
    `slot ${row.slot}  mean=${row.mean.padEnd(12)} spread=${String(row.spread).padStart(5)}  maxLuma=${String(row.maxLuma).padStart(3)}  p99=${String(row.p99).padStart(3)}  p90=${String(row.p90).padStart(3)}`,
  );
}

await browser.close();
