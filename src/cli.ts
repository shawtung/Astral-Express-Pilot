import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { envHeadless as headless, openGame, playerRect, waitForStream } from './core/browser.ts';
import { grabToFile, type Region } from './core/capture.ts';
import { DEBUG_PORT } from './core/config.ts';
import { clickGame, dragGame } from './core/input.ts';
import { enterCloudGame, MAX_OFFLINE_RESTARTS, restartGame } from './core/launch.ts';
import { joinText, readBuffer, readRegion, type OcrLine } from './core/ocr.ts';
import { ENVIRONMENTS, STRATEGIES } from './modules/currency-war/data/codex.ts';
import { findModule, MODULES } from './modules/index.ts';

/** Axis-aligned bounds of an OCR polygon, in the coordinate space of the image passed in. */
function bounds(line: OcrLine): { x: number; y: number; width: number; height: number } | null {
  if (!line.box?.length) return null;
  const xs = line.box.map((p: number[]) => p[0]!);
  const ys = line.box.map((p: number[]) => p[1]!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.max(...xs) - x), height: Math.round(Math.max(...ys) - y) };
}

function printLines(lines: OcrLine[], scale = 1): void {
  for (const line of lines) {
    const b = bounds(line);
    const where = b
      ? `x=${Math.round(b.x / scale)} y=${Math.round(b.y / scale)} w=${Math.round(b.width / scale)} h=${Math.round(b.height / scale)} center=(${Math.round((b.x + b.width / 2) / scale)}, ${Math.round((b.y + b.height / 2) / scale)})`
      : '';
    console.log(`${line.mean.toFixed(3)}  ${line.text.padEnd(20)} ${where}`);
  }
}

function parseRegion(args: string[]): Region | undefined {
  if (args.length < 4) return undefined;
  const [x, y, width, height] = args.slice(0, 4).map(Number);
  if ([x, y, width, height].some((n) => n === undefined || Number.isNaN(n))) {
    throw new Error('region must be: <x> <y> <width> <height> in 1920x1080 game space');
  }
  return { x: x!, y: y!, width: width!, height: height! };
}

async function loadTargets(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
}

async function withGame<T>(fn: (session: Awaited<ReturnType<typeof openGame>>) => Promise<T>): Promise<T> {
  const session = await openGame();
  try {
    console.log('waiting for the game stream...');
    await waitForStream(session.page);
    return await fn(session);
  } finally {
    // Never close a browser we merely attached to; it belongs to whoever launched it.
    if (session.owned && process.env.KEEP_BROWSER !== '1') await session.context.close();
  }
}

async function main(): Promise<void> {
  const [command = 'probe', ...args] = process.argv.slice(2);

  switch (command) {
    case 'codex': {
      const keyword = args[0];
      const rows = [
        ...ENVIRONMENTS.map((e) => ({
          kind: 'environment',
          name: e.name,
          note: e.standardOnly ? '标准博弈限定' : '',
        })),
        ...STRATEGIES.map((s) => ({
          kind: 'strategy',
          name: s.name,
          note: `${s.rarity} 位面${s.planes.join('')}${s.standardOnly ? ' 标准博弈限定' : ''}`,
        })),
      ].filter((r) => !keyword || r.name.includes(keyword));
      for (const row of rows) console.log(`${row.kind.padEnd(12)}${row.name.padEnd(18)}${row.note}`);
      console.log(`${rows.length} entries`);
      return;
    }
    case 'modules': {
      for (const module of MODULES) console.log(`${module.id.padEnd(16)}${module.title}`);
      return;
    }
    case 'validate': {
      const id = args[0] ?? 'currency-war';
      const module = findModule(id);
      if (!module) throw new Error(`unknown module: ${id}`);

      const config = module.loadConfig(await loadTargets(args[1] ?? 'targets.json'));
      for (const line of module.describe(config)) console.log(line);

      const problems = module.validate(config);
      if (problems.length) {
        for (const problem of problems) console.error(`! [${problem.field}] ${problem.message}`);
        process.exitCode = 1;
      } else {
        console.log('targets ok');
      }
      return;
    }
    case 'run': {
      const id = args[0] ?? 'currency-war';
      const module = findModule(id);
      if (!module) throw new Error(`unknown module: ${id}`);

      const config = module.loadConfig(await loadTargets(args[1] ?? 'targets.json'));
      for (const line of module.describe(config)) console.log(line);

      const problems = module.validate(config);
      if (problems.length) {
        for (const problem of problems) console.error(`! [${problem.field}] ${problem.message}`);
        process.exitCode = 1;
        return;
      }

      let session = await openGame();
      try {
        if (headless) {
          console.log('\n浏览器已在无头模式启动，自行冷启动进入活动页。');
          await enterCloudGame(session.page);
          await module.reachStart?.(session.page);
        } else {
          console.log('\n浏览器已打开。请自行登录云游戏，并把游戏停在「货币战争」初始界面。');
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          await rl.question('已进入初始界面后按回车开始刷取... ');
          rl.close();
        }

        await waitForStream(session.page);
        let restarts = 0;
        for (;;) {
          const reason = await module.run(session.page, config);
          console.log(`stopped: ${reason}`);
          // A kick is recoverable: the login persists, so a fresh browser goes right back in.
          if (reason === 'offline' && restarts < MAX_OFFLINE_RESTARTS) {
            restarts++;
            console.log(`掉线重进（第 ${restarts}/${MAX_OFFLINE_RESTARTS} 次）`);
            session = await restartGame(session, headless, module.reachStart);
            continue;
          }

          if (reason !== 'target-found') {
            const wait = createInterface({ input: process.stdin, output: process.stdout });
            await wait.question(
              headless
                ? `浏览器已保留供排查（无头，CDP 端口 ${DEBUG_PORT}），处理完后按回车关闭并退出... `
                : '浏览器已保留供排查，处理完后按回车关闭并退出... ',
            );
            wait.close();
          }
          break;
        }
      } finally {
        // Leaving a browser we launched alive would keep the profile locked and block the next run.
        if (session.owned && !process.env.KEEP_BROWSER) await session.context.close();
      }
      return;
    }
    case 'probe': {
      await withGame(async ({ page }) => console.log(await playerRect(page)));
      return;
    }
    case 'grab': {
      await withGame(async ({ page }) => {
        const name = args[0] && Number.isNaN(Number(args[0])) ? args.shift()! : `frame-${Date.now()}`;
        console.log(`saved ${await grabToFile(page, name, parseRegion(args))}`);
      });
      return;
    }
    case 'ocr': {
      const region = parseRegion(args);
      if (!region) throw new Error('usage: pnpm ocr <x> <y> <width> <height>');
      await withGame(async ({ page }) => {
        const lines = await readRegion(page, region);
        printLines(lines, 2);
        console.log('---');
        console.log(joinText(lines));
      });
      return;
    }
    case 'ocr-file': {
      const path = args[0];
      if (!path) throw new Error('usage: pnpm ocr-file <png>');
      const lines = await readBuffer(await readFile(resolve(path)));
      printLines(lines);
      return;
    }
    case 'click': {
      const [x, y] = args.map(Number);
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
        throw new Error('usage: pnpm click <x> <y>');
      }
      await withGame(({ page }) => clickGame(page, x, y));
      return;
    }
    case 'drag': {
      const [x1, y1, x2, y2] = args.map(Number);
      if ([x1, y1, x2, y2].some((n) => n === undefined || Number.isNaN(n))) {
        throw new Error('usage: pnpm drag <fromX> <fromY> <toX> <toY>');
      }
      await withGame(({ page }) => dragGame(page, { x: x1!, y: y1! }, { x: x2!, y: y2! }));
      return;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
