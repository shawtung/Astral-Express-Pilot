import type { Page } from 'playwright';
import { grabToFile } from '../../core/capture.ts';
import { Cancelled, currentContext, throwIfCancelled } from '../../core/context.ts';
import { clickGame, dragGame, holdKey } from '../../core/input.ts';
import { containsFuzzy } from '../../core/match.ts';
import { joinText, locateText, readRegion } from '../../core/ocr.ts';
import { sleepAbout } from '../../core/util.ts';
import { isBlackFrame } from '../../core/vision.ts';
import { stop, type StopReason } from '../../notify.ts';
import {
  detectScreens,
  isOnScreen,
  isSparkleOnField,
  readBench,
  readEnvironmentCards,
  readFrontRowCount,
  readRefreshCharges,
  readRunMode,
  readRunProgress,
  readStrategies,
  waitForScreen,
  type BenchSlot,
} from './read.ts';
import {
  BENCH_SLOTS,
  BUTTONS,
  ENTRANCE_LABEL,
  ENTRANCE_PROMPT,
  ENVIRONMENT_CARDS,
  FRONT_ROW_SLOTS,
  MODE_BUTTON_LABEL,
  MODE_CARDS,
  NOTICE_DIALOG,
  SCREENS,
  STRATEGY_CARDS,
  type Screen,
} from './screens.ts';
import {
  evaluateTarget,
  isAvoided,
  MODE_LABELS,
  smartEnvironmentOrder,
  type Mode,
  type TargetConfig,
} from './target.ts';

/** Thrown when the game stops showing anything we recognise. Always ends the session. */
class Stalled extends Error {}

/**
 * Thrown when the run is worth restarting rather than playing out. The outer loop abandons
 * the run and moves on to a fresh deal.
 */
class GiveUpRun extends Error {}

/** Guard against a mis-detected screen turning a loop into an endless one. */
const MAX_STEPS_PER_RUN = 16;

/** The operator confirms the screen before we start, so this is a sanity check, not a wait. */
const LANDING_ROUNDS = 2;

/** Character slots open at every battle before the strategy pick, whatever the counter shows. */
const DEPLOY_ROOM = 3;

/** Retries allowed for the deploy counter, which is unreadable while the board animates in. */
const COUNTER_READ_TRIES = 5;

/** A weak team drags a winnable fight out — a lone stall character can keep one going for close
 * to ten minutes — so combat gets its own budget rather than sharing the default one, which also
 * decides when the game counts as stuck. The scan runs coarser than the default to keep such a
 * long window cheap. */
const BATTLE_SCAN_MS = 15_000;
const BATTLE_ROUNDS = 40;

/** 黄金投资 and its kin hand out a fresh pick on the spot, and that pick can do it again. */
const STRATEGY_PICK_CHAIN = 7;

/** Scans allowed for the bonus environment, which only 蓝海 hands out. */
const BONUS_ENV_ROUNDS = 3;

/** Battles preceding the first strategy pick. The counter only moves on a won battle, so a run
 * parked one battle further may still owe that pick. */
const BATTLES_BEFORE_STRATEGY: Record<Mode, number> = {
  standard: 2,
  overclock: 1,
};

/** Budget for the open world entrance: press F and watch, a few times over. */
const REACH_TRIES = 4;
const REACH_SCAN_MS = 3000;
const REACH_SCAN_ROUNDS = 4;

/** The exit arrow is dead while a stage animates, so the prompt is worth asking for more than once. */
const EXIT_TRIES = 3;
const EXIT_SCAN_MS = 1500;
const EXIT_SCAN_ROUNDS = 3;

/** A confirmed strategy animates through 备战 before any follow-up pick slides in, so the first
 * screen that matches says nothing about whether the chain is actually over. */
const FOLLOW_UP_SCAN_MS = 1500;
const FOLLOW_UP_ROUNDS = 4;

/** A follow-up pick can deal a single centred card, leaving the outer slots empty. The centre
 * slot carries a card in both layouts, which makes it the only safe guess when OCR reads nothing. */
const CENTRE_CARD = 1;

/** Loading after the title card runs long on a cold start, so the entrance gets its own budget. */
const ENTRANCE_ROUNDS = 30;
const ENTRANCE_ROUND_MS = 3000;

/** Cloud streaming adds latency both ways, so the key is held far longer than a local one. */
const REACH_HOLD_MS = 600;

const startedAt = Date.now();

function log(message: string): void {
  const context = currentContext();
  if (context) {
    context.log(message);
    return;
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[${String(elapsed).padStart(4)}s] ${message}`);
}

async function waitFor(page: Page, expected: Screen | readonly Screen[]): Promise<Screen> {
  const hit = await waitForScreen(page, expected);
  if (hit) return hit;
  const wanted = (Array.isArray(expected) ? expected : [expected as Screen]).map((s) => s.id);
  // A modal notice dims the whole board, so every probe goes blank at once; only quote it when
  // nothing else matched, since the dialog region reads ordinary page text on other screens.
  const actual = await detectScreens(page);
  const where = actual.length
    ? `实际停在 ${actual.map((s) => s.id).join(' + ')}`
    : '全屏扫描也认不出当前界面';
  if (actual.length) {
    throw new Stalled(`等待 ${wanted.join(' / ')} 超时（${where}）`);
  }
  const notice = joinText(await readRegion(page, NOTICE_DIALOG));
  throw new Stalled(
    notice
      ? `弹窗挡住流程「${notice}」，等待 ${wanted.join(' / ')} 超时（${where}）`
      : `等待 ${wanted.join(' / ')} 超时（${where}）`,
  );
}

async function click(page: Page, point: { x: number; y: number }, settleMs = 1200): Promise<void> {
  await clickGame(page, point.x, point.y);
  await sleepAbout(settleMs);
}

/** The toast swallows input for about three seconds, so wait it out instead of clicking into it. */
async function waitForToast(page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (!(await isOnScreen(page, SCREENS.moveBlocked))) return;
    await sleepAbout(800);
  }
}

/**
 * Opens the activity from the open world. The entrance shows an `F 货币战争` prompt, which is a
 * key hint rather than a button, so there is nothing to click here.
 */
export async function reachStart(page: Page): Promise<void> {
  // The entrance prompt is the one mark that proves the world is loaded and we are standing at it.
  log('等待主世界载入');
  let seen = false;
  for (let round = 0; round < ENTRANCE_ROUNDS && !seen; round++) {
    throwIfCancelled();
    if (round) await sleepAbout(ENTRANCE_ROUND_MS, 0.1);
    seen = Boolean(await locateText(page, ENTRANCE_PROMPT, ENTRANCE_LABEL));
  }

  if (!seen) {
    const shot = await grabToFile(page, 'no-entrance');
    throw new Stalled(`没等到「F 货币战争」入口提示，截图: ${shot}`);
  }
  log('看到「F 货币战争」入口提示');

  for (let attempt = 1; attempt <= REACH_TRIES; attempt++) {
    log(`按 F 打开「货币战争」（第 ${attempt} 次）`);
    await holdKey(page, 'f', REACH_HOLD_MS);

    let hit = await waitForScreen(
      page,
      [SCREENS.start, SCREENS.runInProgress, SCREENS.expansionNotice],
      { intervalMs: REACH_SCAN_MS, rounds: REACH_SCAN_ROUNDS },
    );
    // A version update pops the season changelog over the activity page; close it and look again.
    if (hit?.id === SCREENS.expansionNotice.id) {
      log('弹出赛季扩充说明，点 × 关闭');
      await click(page, BUTTONS.closeNotice);
      hit = await waitForScreen(page, [SCREENS.start, SCREENS.runInProgress], {
        intervalMs: REACH_SCAN_MS,
        rounds: REACH_SCAN_ROUNDS,
      });
    }
    if (hit) {
      log('已到达「货币战争」活动页');
      return;
    }

    // Tells apart a key the game ignored from a character that wandered off the entrance.
    const prompt = await locateText(page, ENTRANCE_PROMPT, ENTRANCE_LABEL);
    log(prompt ? '入口提示还在，按键没被收到' : '入口提示不见了，画面已经变了');
  }

  const shot = await grabToFile(page, 'reach-start-failed');
  throw new Stalled(`按 F 进不了「货币战争」，截图: ${shot}`);
}

/** Returns false when the activity page bounced us back to an unsettled run. */
async function openRun(page: Page, config: TargetConfig): Promise<boolean> {
  log(`开新一局 (${MODE_LABELS[config.mode]})`);
  await click(page, BUTTONS.startWar);

  const opened = await waitFor(page, [SCREENS.modeSelect, SCREENS.runInProgress]);
  if (opened.id === SCREENS.runInProgress.id) return false;
  await click(page, MODE_CARDS[config.mode]);

  const label = joinText(await readRegion(page, MODE_BUTTON_LABEL));
  if (!containsFuzzy(label, MODE_LABELS[config.mode], 0.6)) {
    throw new Stalled(`模式没有切到${MODE_LABELS[config.mode]}，按钮读到的是「${label}」`);
  }
  await click(page, BUTTONS.enterMode);

  await waitFor(page, SCREENS.gradeSelect);
  // The click can land while the page is still settling and be swallowed, same as 出战.
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, BUTTONS.startMatch);
    const moved = await waitForScreen(page, SCREENS.factionIntro, { intervalMs: 2000, rounds: 3 });
    if (moved) break;
    if (attempt === 2) throw new Stalled('连点开始对局无效，仍停在难度选择页');
    log('开始对局没生效，再点一次');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, BUTTONS.next);
    const moved = await waitForScreen(page, SCREENS.planeIntro, { intervalMs: 2000, rounds: 3 });
    if (moved) break;
    if (attempt === 2) throw new Stalled('连点下一步无效，仍停在敌方介绍页');
    log('下一步没生效，再点一次');
  }

  await waitFor(page, SCREENS.planeIntro);
  await click(page, BUTTONS.blank);

  await waitFor(page, SCREENS.environment);
  log('进入投资环境选择');
  return true;
}

/**
 * 蓝海 hands out one more environment, offered on the same screen as a single centred card.
 * Nothing in the title tells the two apart, so the card count is the only usable signal.
 */
async function pickBonusEnvironment(page: Page): Promise<string[]> {
  for (let round = 0; round < BONUS_ENV_ROUNDS; round++) {
    if (!(await isOnScreen(page, SCREENS.environment))) return [];

    const cards = await readEnvironmentCards(page);
    const index = cards.findIndex((name) => name !== null);
    if (cards.filter((name) => name !== null).length === 1) {
      const card = ENVIRONMENT_CARDS[index];
      const name = cards[index];
      if (!card || !name) throw new Stalled(`额外环境卡位异常: ${index}`);
      await click(page, card.card);
      await click(page, BUTTONS.confirmBonusEnvironment, 1800);
      log(`额外投资环境: ${name}`);
      return [name];
    }
    // Three cards still showing means the pick just confirmed has not faded out yet.
    await sleepAbout(1200);
  }
  throw new Stalled('投资环境界面没退出，卡片也不是单张，可能图鉴过期或画面异常');
}

/** Index of the card standing highest in the wish list, or -1 when none of them is offered. */
function bestCard(cards: (string | null)[], wishlist: string[]): number {
  for (const name of wishlist) {
    const index = cards.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Picks an environment, preferring one the config asks for. The single reroll is only spent
 * when environments are actually being hunted and none of the three match.
 */
async function pickEnvironment(page: Page, config: TargetConfig): Promise<string[]> {
  // Smart mode derives the wish list from the rarities of the wanted strategies.
  const wishlist = config.smartEnvironment ? smartEnvironmentOrder(config) : config.environments;
  if (config.smartEnvironment) log(`环境优先级: ${wishlist.join(' > ') || '(无)'}`);

  let cards = await readEnvironmentCards(page);
  let wanted = bestCard(cards, wishlist);
  log(`投资环境: ${cards.map((c) => c ?? '?').join(' / ')}`);

  if (wanted === -1 && wishlist.length) {
    log('无命中，使用刷新');
    await click(page, BUTTONS.resetEnvironment, 1800);
    cards = await readEnvironmentCards(page);
    wanted = bestCard(cards, wishlist);
    log(`刷新后: ${cards.map((c) => c ?? '?').join(' / ')}`);
  }

  const index = wanted === -1 ? 0 : wanted;
  const card = ENVIRONMENT_CARDS[index];
  if (!card) throw new Stalled(`投资环境卡位越界: ${index}`);

  await click(page, card.card);
  await click(page, BUTTONS.confirmEnvironment, 1800);

  const kept = cards[index];
  log(`选定环境: ${kept ?? '(未读出)'}`);
  const bonus = await pickBonusEnvironment(page);
  return kept ? [kept, ...bonus] : bonus;
}

/** Reports whether it had to act, so the caller can re-read immediately instead of waiting. */
async function collapseShop(page: Page): Promise<boolean> {
  if (!(await isOnScreen(page, SCREENS.shop))) return false;
  log('收起商店');
  await click(page, BUTTONS.shop, 1200);
  return true;
}

/**
 * Checks the bond column for Sparkle's tell. She is the only character who lights 战技点,
 * 盛会之星 and 量子同频 all at once, and her auto-battle logic is broken in this mode - she
 * never attacks - so a fight she is in cannot be won. The bonded set may drift as the game
 * updates, which would surface as this check going quiet rather than as a wrong restart.
 */
async function refuseSparkle(page: Page): Promise<void> {
  // The column animates in behind the counter, so one re-read covers a board that is still
  // settling; a clean miss on both reads means a different character.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await isSparkleOnField(page)) throw new GiveUpRun('上阵的是花火，她的自动战斗不会攻击');
    if (attempt === 0) await sleepAbout(1500);
  }
}

/**
 * Sends exactly one unit into battle. The opening fight is a giveaway, and a real team keeps
 * forming synergies whose popups cover the board and poison every reading taken from it.
 */
async function deployTeam(page: Page): Promise<void> {
  // The strategy screen pops up right after combat; its 返回备战界面 button carries the same
  // characters the prepare anchor looks for, so an early wait can land here by mistake.
  if (await isOnScreen(page, SCREENS.strategy)) return;
  // Standard mode always arrives here with the shop open: it pops up by itself after battle one.
  await collapseShop(page);
  let count = await readFrontRowCount(page);
  // The board slides in after a phase change, so an early read catches the counter mid-animation.
  for (let attempt = 0; !count && attempt < COUNTER_READ_TRIES; attempt++) {
    if (!(await collapseShop(page))) await sleepAbout(1500);
    count = await readFrontRowCount(page);
  }
  if (!count) throw new Stalled('读不到上阵人数，界面可能被弹窗遮挡');
  // Some environments grant a non-character unit that inflates both numbers, so only the gap is stable.
  const room = count.cap - count.filled;
  if (room < DEPLOY_ROOM) {
    log(`备战: 场上已有角色 ${count.filled}/${count.cap}，直接开战`);
    await refuseSparkle(page);
    return;
  }

  const characters = await readBenchCharacters(page);
  log(`备战: ${count.filled}/${count.cap}，可用角色 ${characters.length}`);

  const target = FRONT_ROW_SLOTS[0];
  if (!target) throw new Stalled('前排槽位未配置');

  for (const slot of characters) {
    const from = BENCH_SLOTS[slot.index];
    if (!from) continue;

    await dragGame(page, from, target);
    await sleepAbout(1000);

    const after = await readFrontRowCount(page);
    if (after && after.cap - after.filled < room) {
      log(`上阵完成: ${after.filled}/${after.cap}`);
      await refuseSparkle(page);
      return;
    }
    log(`槽位 ${slot.index} 上阵失败，等待提示消失`);
    await waitForToast(page);
  }
  // A drag that fails on the strategy screen reads as zero characters up top; the counter and
  // bench come from that screen's chrome, so check where the run actually is before reporting it.
  if (!(await isOnScreen(page, SCREENS.prepare))) {
    throw new Stalled('不在备战界面，可能误入了策略或结算画面');
  }
  throw new Stalled('没有角色能上场');
}

/**
 * Reads the bench, retrying while it comes back empty: the opening deal animates the cards in,
 * so an early read sees placeholders rather than nobody to play.
 */
async function readBenchCharacters(page: Page): Promise<BenchSlot[]> {
  for (let attempt = 0; attempt < COUNTER_READ_TRIES; attempt++) {
    const characters = (await readBench(page)).filter((slot) => slot.kind === 'character');
    if (characters.length) return characters;
    await sleepAbout(1500);
  }
  return [];
}

/** Clicks 出战 and clears the confirmation. The shop popup can eat the first click. */
async function startBattle(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // The shop folds away with the first click otherwise, which spends a whole attempt on nothing.
    await collapseShop(page);
    await click(page, BUTTONS.deploy, 2000);

    if (await isOnScreen(page, SCREENS.deployPrompt)) {
      await click(page, BUTTONS.promptConfirm, 1500);
    }
    // Leaving 备战 is the only proof the fight started; confirming the prompt does not guarantee it.
    if (!(await isOnScreen(page, SCREENS.prepare))) return;
  }
  // The entry animation outlasts the per-click settle on a slow stream, so one last look keeps
  // a fight that actually started from being reported as a stuck button.
  if (!(await waitForScreen(page, SCREENS.prepare, { intervalMs: 1500, rounds: 4 }))) return;
  throw new Stalled('连点出战无效，可能被未知弹窗挡住');
}

/** Plays battles until the strategy pick shows up. Standard runs two, overclocked one. */
async function reachStrategyScreen(page: Page, config: TargetConfig): Promise<string[]> {
  // Stays empty unless the run was saved before its first battle, leaving environments unpicked.
  let picked: string[] = [];
  for (let round = 0; round < MAX_STEPS_PER_RUN; round++) {
    const screen = await waitFor(page, [
      SCREENS.strategy,
      SCREENS.starPick,
      SCREENS.environment,
      SCREENS.factionIntro,
      SCREENS.planeIntro,
      SCREENS.prepare,
      SCREENS.battleResult,
      SCREENS.battle,
    ]);

    if (screen.id === SCREENS.strategy.id) return picked;
    if (screen.id === SCREENS.starPick.id) {
      log('处理巨星选择弹窗');
      await click(page, BUTTONS.starPickCard);
      await click(page, BUTTONS.starPickConfirm, 1800);
      continue;
    }
    if (screen.id === SCREENS.environment.id) {
      picked = await pickEnvironment(page, config);
      continue;
    }
    // A resumed run replays both intro screens that openRun would have clicked through already.
    if (screen.id === SCREENS.factionIntro.id) {
      log('跳过敌方介绍界面');
      await click(page, BUTTONS.next, 1200);
      continue;
    }
    if (screen.id === SCREENS.planeIntro.id) {
      log('跳过位面进度界面');
      await click(page, BUTTONS.blank, 1200);
      continue;
    }
    if (screen.id === SCREENS.battle.id) {
      log('战斗进行中，等待结束');
      const done = await waitForScreen(
        page,
        [SCREENS.battleResult, SCREENS.starPick, SCREENS.strategy, SCREENS.prepare],
        { intervalMs: BATTLE_SCAN_MS, rounds: BATTLE_ROUNDS },
      );
      if (!done) throw new Stalled('战斗过久未结束，可能打不过或画面卡住');
      continue;
    }
    if (screen.id === SCREENS.battleResult.id) {
      log('战斗结束，继续');
      // While the animation runs this click lands on the hint and only skips it, so press twice.
      await click(page, BUTTONS.continueChallenge, 1200);
      if (await isOnScreen(page, SCREENS.battleResult)) {
        await click(page, BUTTONS.continueChallenge, 1800);
      }
      continue;
    }
    await deployTeam(page);
    await startBattle(page);
  }
  throw new Stalled('打了太多轮仍未到投资策略界面');
}

/** Reads the three cards, spending refresh charges until one matches or the charges run out. */
async function huntStrategies(
  page: Page,
  config: TargetConfig,
  environments: string[],
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_STEPS_PER_RUN; attempt++) {
    const names = (await readStrategies(page)).filter((n): n is string => n !== null);
    const result = evaluateTarget(config, { environments, strategies: names }, 'strategy');
    log(`投资策略: ${names.join(' / ') || '(未读出)'}`);
    if (result.state === 'satisfied') return true;

    const charges = await readRefreshCharges(page);
    const slot = charges.findIndex((c) => c > 0);
    // A follow-up pick drops the refresh row entirely, so an empty read means none rather than unknown.
    log(`刷新次数: ${charges.length ? charges.join('/') : '无'}`);
    if (slot === -1) return false;

    const card = STRATEGY_CARDS[slot];
    if (!card) return false;
    await click(page, card.refresh, 1500);
  }
  return false;
}

/**
 * Confirms a card nobody asked for, which is what moves a doomed run along. Blacklisted
 * strategies are skipped, and a board made of nothing else ends the session: taking one is
 * worse than stopping.
 */
async function takeThrowawayStrategy(page: Page, config: TargetConfig): Promise<void> {
  const names = await readStrategies(page);
  const safe = names.findIndex((name) => name !== null && !isAvoided(config, name));
  // An unreadable card is the second choice: it cannot be cleared, but neither is it known bad.
  const index = safe !== -1 ? safe : names[CENTRE_CARD] === null ? CENTRE_CARD : -1;
  if (index === -1) {
    const shot = await grabToFile(page, 'all-strategies-avoided');
    throw new Stalled(
      `可选的投资策略都在避免名单内（${names.map((n) => n ?? '?').join(' / ')}），已停下避免误选，截图: ${shot}`,
    );
  }

  const card = STRATEGY_CARDS[index];
  if (!card) throw new Stalled(`投资策略卡位越界: ${index}`);
  log(`随手选掉第 ${index + 1} 张: ${names[index] ?? '(未读出)'}`);
  await click(page, card.card);
  await click(page, BUTTONS.confirmStrategy, 1800);
}

/**
 * Works through a chain of strategy picks. Strategies like 黄金投资 grant another pick the moment
 * they are confirmed, so every confirmation has to be checked for one more screen behind it, and
 * each new screen is worth hunting through: it deals its own cards and its own refresh charges.
 * Returns only once the chain is spent and the board is back on 备战, so callers never have to
 * deal with a pick still hanging over the run.
 */
async function huntStrategyChain(
  page: Page,
  config: TargetConfig,
  environments: string[],
): Promise<boolean> {
  for (let pick = 0; pick < STRATEGY_PICK_CHAIN; pick++) {
    if (await huntStrategies(page, config, environments)) return true;

    await takeThrowawayStrategy(page, config);

    // 备战 shows through during the transition whether or not a pick is queued behind it, so only
    // the absence of a strategy screen over the whole window proves the chain is done.
    const again = await waitForScreen(page, SCREENS.strategy, {
      intervalMs: FOLLOW_UP_SCAN_MS,
      rounds: FOLLOW_UP_ROUNDS,
    });
    if (!again) {
      await waitFor(page, SCREENS.prepare);
      return false;
    }
    log('该策略又给了一次投资策略选择');
  }
  throw new Stalled('投资策略反复弹出，已停下避免无休止选择');
}

/**
 * Abandons the run and clicks through the settle pages until the activity page is back. Callers
 * bring the run to a stage the exit arrow actually exists on; there is no pending pick to clear here.
 */
async function abandon(page: Page): Promise<void> {
  log('放弃本局并结算');
  await click(page, BUTTONS.exitRun);
  for (let attempt = 1; !(await waitForScreen(page, SCREENS.exitPrompt, { intervalMs: EXIT_SCAN_MS, rounds: EXIT_SCAN_ROUNDS })); attempt++) {
    if (attempt >= EXIT_TRIES) throw new Stalled('点了退出但没弹出「是否中断挑战」');
    log(`退出确认框没出现，再点一次（第 ${attempt + 1} 次）`);
    await click(page, BUTTONS.exitRun);
  }
  await click(page, BUTTONS.abandonAndSettle, 2000);

  for (let step = 0; step < MAX_STEPS_PER_RUN; step++) {
    if (await isOnScreen(page, SCREENS.start)) return;
    // Blind clicking is what turns one missed button into a whole new run, so bail at the first
    // sign of being back inside one rather than keep poking a coordinate that means nothing here.
    if (await isOnScreen(page, SCREENS.prepare)) {
      throw new Stalled('结算途中又回到了备战页，已停下避免继续乱点');
    }
    log(`结算中（第 ${step + 1} 步）`);
    await click(page, BUTTONS.settleNext, 1500);
  }
  throw new Stalled('结算页没有回到活动首页');
}

type RunOutcome =
  | { kind: 'target-found' }
  | { kind: 'run-in-progress'; why?: string }
  | { kind: 'restart' };

/**
 * Picks a saved run back up when it has not reached its first strategy pick yet. Past that point
 * the bot cannot tell what the run already committed to, so it hands the seat back to the user.
 * The counter alone cannot place that pick, so the borderline case is settled from inside the run.
 * Returns null once resumed, otherwise the reason it declined.
 */
async function resumeSavedRun(page: Page, config: TargetConfig): Promise<string | null> {
  const mode = await readRunMode(page);
  const progress = await readRunProgress(page);
  const where = progress ? `${progress.layer}-${progress.battle}` : '(未读出)';
  log(`未结算对局: ${mode ? MODE_LABELS[mode] : '(模式未读出)'}，进度 ${where}`);

  if (!mode || !progress) return '读不出对局模式或进度';
  if (mode !== config.mode) {
    return `对局是${MODE_LABELS[mode]}，配置要的是${MODE_LABELS[config.mode]}`;
  }
  // Environments can only be read while they are being offered, so a resumed run plays on
  // as if none had been picked. An OR target can still land on a strategy, and an AND one
  // can never settle here, so it washes out at the strategy stage and restarts fresh.
  if (!config.smartEnvironment && config.environments.length) {
    log('续上的对局读不回投资环境，本局按无环境筛选继续');
  }
  if (progress.layer !== 1 || progress.battle > BATTLES_BEFORE_STRATEGY[mode] + 1) {
    return `进度 ${where} 已越过第一次投资策略选择`;
  }

  log('续上未结算的对局');
  await click(page, BUTTONS.resumeRun, 2500);

  // The counter reads the same whether the strategy pick is still owed or already spent; only the
  // screen behind the replayed intros tells them apart.
  if (progress.battle > BATTLES_BEFORE_STRATEGY[mode]) {
    for (let step = 0; step < MAX_STEPS_PER_RUN; step++) {
      const screen = await waitFor(page, [
        SCREENS.strategy,
        SCREENS.prepare,
        SCREENS.factionIntro,
        SCREENS.planeIntro,
      ]);
      if (screen.id === SCREENS.strategy.id) return null;
      if (screen.id === SCREENS.prepare.id) return `进度 ${where} 的投资策略已经选过了`;
      const button = screen.id === SCREENS.factionIntro.id ? BUTTONS.next : BUTTONS.blank;
      await click(page, button, 1200);
    }
    throw new Stalled('续局后一直停在过场界面');
  }
  return null;
}

async function playOnce(page: Page, config: TargetConfig): Promise<RunOutcome> {
  // Both screens share the same button strip, so the busier state has to be ruled out first.
  const landing = await waitFor(page, [SCREENS.runInProgress, SCREENS.start]);
  let environments: string[] = [];

  // A saved run only shows up on the mode page behind the start button, so openRun is the first
  // step that can see one; landing is the mode page itself only when the bot starts up there.
  if (landing.id === SCREENS.runInProgress.id || !(await openRun(page, config))) {
    const why = await resumeSavedRun(page, config);
    if (why) return { kind: 'run-in-progress', why };
  } else {
    environments = await pickEnvironment(page, config);
    const early = evaluateTarget(config, { environments, strategies: [] }, 'environment');
    if (early.state === 'satisfied') return { kind: 'target-found' };
    if (early.state === 'failed') {
      await abandon(page);
      return { kind: 'restart' };
    }
  }

  environments = environments.concat(await reachStrategyScreen(page, config));
  if (await huntStrategyChain(page, config, environments)) return { kind: 'target-found' };

  await abandon(page);
  return { kind: 'restart' };
}

/** Runs one attempt from the activity page, swallowing GiveUpRun into a restart. */
async function playRound(page: Page, config: TargetConfig): Promise<RunOutcome> {
  try {
    return await playOnce(page, config);
  } catch (error) {
    if (!(error instanceof GiveUpRun)) throw error;
    // A hopeless deal is exactly what restarting is for: drop the run and deal again.
    log(`重开: ${error.message}`);
    await abandon(page);
    return { kind: 'restart' };
  }
}

export async function run(page: Page, config: TargetConfig): Promise<StopReason> {
  try {
    log('校验是否处于「货币战争」初始界面');
    const landing = await waitForScreen(page, [SCREENS.runInProgress, SCREENS.start], {
      rounds: LANDING_ROUNDS,
    });
    if (!landing) throw new Stalled('没识别到「货币战争」初始界面，请确认游戏画面后重试');
    log(`已就位: ${landing.id}`);

    for (let round = 1; ; round++) {
      log(`===== 第 ${round} 轮 =====`);
      const outcome = await playRound(page, config);
      if (outcome.kind === 'target-found') {
        await stop(page, 'target-found');
        return 'target-found';
      }
      if (outcome.kind === 'run-in-progress') {
        await stop(page, 'run-in-progress', outcome.why);
        return 'run-in-progress';
      }
    }
  } catch (error) {
    if (error instanceof Cancelled) {
      await stop(page, 'cancelled');
      return 'cancelled';
    }
    if (!(error instanceof Stalled)) throw error;
    // A session kicked for idling goes black, and the way back is a fresh browser, so the
    // caller restarts instead of parking a dead tab for the operator.
    if (await isBlackFrame(page)) {
      await stop(page, 'offline', error.message);
      return 'offline';
    }
    await stop(page, 'stuck', error.message);
    return 'stuck';
  }
}
