// Sends real mouse input to the browser pwr controls, using 1920x1080 game coordinates.
// Usage: node tools/pwr-input.mjs click <x> <y>
//        node tools/pwr-input.mjs drag <fromX> <fromY> <toX> <toY> [steps] [travelMs]
import { pwr as run, selectGameTab } from './pwr.mjs';

function pwr(...args) {
  return run(args);
}

selectGameTab();

const rectProbe = `() => {
  const c = document.querySelector('#canvas-player');
  const r = c.getBoundingClientRect();
  return JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height, bw: c.width, bh: c.height });
}`;

const out = pwr('eval', rectProbe);
// pwr echoes the evaluated source after the result, so only read the `### Result` section.
const section = out.slice(out.indexOf('### Result'));
const body = section.slice(section.indexOf('\n') + 1);
const endOfBody = body.indexOf('\n### ');
const literal = (endOfBody === -1 ? body : body.slice(0, endOfBody)).trim();
const rect = JSON.parse(JSON.parse(literal));

const toPage = (x, y) => [
  Math.round(rect.left + (x / rect.bw) * rect.width),
  Math.round(rect.top + (y / rect.bh) * rect.height),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const rand = (min, max) => min + Math.random() * (max - min);
const vary = (value, ratio) => value * rand(1 - ratio, 1 + ratio);

const [command, ...rest] = process.argv.slice(2);
const n = rest.map(Number);

if (command === 'click') {
  const jitter = 4;
  const [px, py] = toPage(n[0] + rand(-jitter, jitter), n[1] + rand(-jitter, jitter));
  pwr('mousemove', String(px), String(py));
  await sleep(rand(30, 80));
  pwr('mousedown');
  await sleep(rand(40, 90));
  pwr('mouseup');
  console.log(`clicked game(${n[0]}, ${n[1]}) -> page(${px}, ${py})`);
} else if (command === 'drag') {
  const steps = Math.round(vary(n[4] ?? 24, 0.15));
  const travelMs = vary(n[5] ?? 500, 0.2);
  const jitter = 5;
  const [sx, sy] = toPage(n[0] + rand(-jitter, jitter), n[1] + rand(-jitter, jitter));
  const [ex, ey] = toPage(n[2] + rand(-jitter, jitter), n[3] + rand(-jitter, jitter));
  const dx = ex - sx;
  const dy = ey - sy;
  const distance = Math.hypot(dx, dy) || 1;
  // Humans never drag in a straight line, so bow the path perpendicular to it.
  const bow = rand(0.02, 0.06) * distance * (Math.random() < 0.5 ? -1 : 1);
  const normalX = -dy / distance;
  const normalY = dx / distance;

  pwr('mousemove', String(sx), String(sy));
  await sleep(rand(60, 120));
  pwr('mousedown');
  await sleep(rand(140, 220));
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const t = easeInOut(progress);
    const arc = Math.sin(progress * Math.PI) * bow;
    pwr(
      'mousemove',
      String(Math.round(sx + dx * t + normalX * arc + rand(-1, 1))),
      String(Math.round(sy + dy * t + normalY * arc + rand(-1, 1))),
    );
    await sleep(vary(travelMs / steps, 0.45));
  }
  pwr('mousemove', String(ex), String(ey));
  await sleep(rand(160, 260));
  pwr('mouseup');
  console.log(`dragged game(${n[0]}, ${n[1]}) -> game(${n[2]}, ${n[3]})`);
} else {
  throw new Error(`unknown command: ${command}`);
}

// Give the UI transition time to finish so a chained grab does not catch the animation.
await sleep(vary(Number(process.env.SETTLE_MS ?? 1800), 0.2));
