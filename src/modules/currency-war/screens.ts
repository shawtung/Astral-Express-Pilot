import type { Region } from '../../core/capture.ts';

/**
 * Every coordinate here is in 1920x1080 game space, which is the canvas backing store size
 * and therefore independent of window size and DPI.
 */
export type Screen = {
  id: string;
  /** Region OCR'd to decide whether we are on this screen. */
  probe: Region;
  /** Text expected inside `probe`; fuzzy-matched against OCR output. Any one match is enough. */
  anchor: string | readonly string[];
  /** Text that disqualifies a match, e.g. 返回备战界面 contains 备战 but is not the prepare phase. */
  reject?: string;
};

export const SCREENS = {
  /** Activity landing page, before a run starts. */
  start: {
    id: 'start',
    probe: { x: 1280, y: 900, width: 640, height: 140 },
    anchor: '开始「货币战争」',
  },
  /** Standard vs overclocked mode picker. The mode is never remembered between runs. */
  modeSelect: {
    id: 'modeSelect',
    probe: { x: 1200, y: 910, width: 720, height: 120 },
    // The button spells out whichever mode is currently highlighted.
    anchor: ['进入标准博弈', '进入超频博弈'],
  },
  /** A1-A8 difficulty picker. */
  gradeSelect: {
    id: 'gradeSelect',
    probe: { x: 1600, y: 930, width: 320, height: 90 },
    anchor: '开始对局',
  },
  /** Pre-run briefing listing the factions and the boss of this run. */
  factionIntro: {
    id: 'factionIntro',
    probe: { x: 1330, y: 950, width: 300, height: 75 },
    anchor: '下一步',
  },
  /** Plane overview, dismissed by clicking anywhere. */
  planeIntro: {
    id: 'planeIntro',
    probe: { x: 840, y: 940, width: 260, height: 55 },
    anchor: '点击空白处继续',
  },
  /** The three investment environments rolled for this run. */
  environment: {
    id: 'environment',
    probe: { x: 880, y: 78, width: 220, height: 50 },
    anchor: '投资环境',
  },
  /** Board layout phase between combats. */
  prepare: {
    id: 'prepare',
    // Wide enough to cover both layouts: the title shifts when the run shows an environment badge.
    probe: { x: 250, y: 20, width: 400, height: 95 },
    anchor: '备战阶段',
    // The strategy screen's 返回备战界面 button carries the same characters.
    reject: '返回备战',
  },
  /** 盛会之星 popup. It covers the front row and the counter, so it must be cleared first. */
  starPick: {
    id: 'starPick',
    probe: { x: 900, y: 118, width: 300, height: 45 },
    anchor: '请选择1名角色成为巨星',
  },
  /** Warns that the front row is not full. Appears on deploy until suppressed. */
  deployPrompt: {
    id: 'deployPrompt',
    probe: { x: 700, y: 485, width: 520, height: 60 },
    anchor: '可出战角色人数未达上限',
  },
  /** Shop cards sit right on top of the counter. The toggle reads 商店 when closed, so 收起 means open. */
  shop: {
    id: 'shop',
    probe: { x: 1570, y: 958, width: 110, height: 55 },
    anchor: '收起',
  },
  /**
   * In combat. The top bar carries the node and a completion percentage for the whole fight,
   * unlike the 伤害 panel on the right, which the player can collapse away.
   */
  battle: {
    id: 'battle',
    probe: { x: 608, y: 4, width: 200, height: 52 },
    // Both the node and the percentage change as the run goes on, so the sign is the only constant.
    anchor: '%',
  },
  /** Post-combat summary. Standard mode runs two of these before the strategy pick. */
  battleResult: {
    id: 'battleResult',
    probe: { x: 760, y: 180, width: 400, height: 110 },
    // Same layout either way; the title reads 挑战成功 on a win and 挑战结束 on a loss.
    anchor: ['挑战成功', '挑战结束'],
  },
  /** Pick one of three investment strategies. */
  strategy: {
    id: 'strategy',
    probe: { x: 830, y: 82, width: 270, height: 46 },
    anchor: '请选择投资策略',
  },
  /** Confirms leaving a run, reached from the exit arrow in the top left corner. */
  exitPrompt: {
    id: 'exitPrompt',
    probe: { x: 740, y: 395, width: 550, height: 40 },
    anchor: '是否中断挑战并保存当前进度',
  },
  /**
   * The activity page when a run is already saved. Closing the tab mid-run lands here on the
   * next launch: the run survives, but the start button is replaced by 继续进度 / 结束并结算.
   */
  runInProgress: {
    id: 'runInProgress',
    probe: { x: 1560, y: 940, width: 300, height: 50 },
    anchor: '继续进度',
  },
  /**
   * Season changelog shown over the activity page on the first entry after a version update.
   * It blocks everything else until its X is clicked.
   */
  expansionNotice: {
    id: 'expansionNotice',
    probe: { x: 440, y: 252, width: 620, height: 48 },
    anchor: '赛季扩充说明',
  },
  /**
   * Toast shown when a non-character card is dragged onto the board. It swallows input for
   * roughly three seconds, so seeing it means waiting before the next action.
   */
  moveBlocked: {
    id: 'moveBlocked',
    probe: { x: 560, y: 505, width: 800, height: 80 },
    anchor: '无法移动该目标至场上',
  },
} as const satisfies Record<string, Screen>;

/** Row holding the environment names. Kept for a cheap "what was offered" read. */
export const ENVIRONMENT_ROW: Region = { x: 340, y: 365, width: 1240, height: 55 };

/** Mode of the saved run, from the detail panel header. The left column keeps a fixed card order
 * and only changes which card is greyed out, so it cannot tell the two modes apart. */
export const RUN_MODE: Region = { x: 580, y: 135, width: 220, height: 45 };

/** Strip reading "对局难度 紫金1 当前进度 1-2 奖励"; only the layer-battle pair is used. */
export const RUN_PROGRESS: Region = { x: 1350, y: 858, width: 490, height: 40 };

/** Card centres are shared with the strategy screen; only one reset exists for all three. */
export const CARD_CENTRES_X = [461, 960, 1459] as const;

export const ENVIRONMENT_CARDS = CARD_CENTRES_X.map((x) => ({
  card: { x, y: 500 },
  name: { x: x - 180, y: 372, width: 360, height: 45 } satisfies Region,
}));

/** Reads as one line, "剩余次数：1 确认". The reset button itself is icon only. */
export const ENVIRONMENT_RESET_LABEL: Region = { x: 560, y: 960, width: 900, height: 80 };

/** Shows "n/3". Starts right of the little person icon, which OCRs as a 1 and corrupts the count. */
export const FRONT_ROW_COUNTER: Region = { x: 895, y: 200, width: 150, height: 100 };

/** Title, body and single confirm button of a modal notice. Only read when everything else went blank. */
export const NOTICE_DIALOG: Region = { x: 600, y: 380, width: 760, height: 400 };

/** Where the open world draws the `F 货币战争` prompt. Clicking it works the same as the key. */
export const ENTRANCE_PROMPT: Region = { x: 480, y: 440, width: 1280, height: 300 };
export const ENTRANCE_LABEL = '货币战争';

/**
 * The three strategy cards. Each one carries its own refresh charge, unlike the
 * environment screen where a single reset rerolls all three at once.
 */
export const STRATEGY_CARDS = CARD_CENTRES_X.map((x) => ({
  card: { x, y: 500 },
  refresh: { x: x - 72, y: 856 },
  name: { x: x - 180, y: 472, width: 360, height: 42 } satisfies Region,
}));

/** OCRs as one merged line, e.g. "刷新次数1 刷新次数1 刷新次数0" - digits map to the cards left to right. */
export const STRATEGY_REFRESH_ROW: Region = { x: 280, y: 825, width: 1360, height: 70 };

/** Clicking a card only highlights it; the enter button below reflects the current choice. */
export const MODE_CARDS = {
  standard: { x: 153, y: 232 },
  overclock: { x: 153, y: 423 },
} as const;

/** Reads "进入标准博弈" or "进入超频博弈", so the picked mode can be confirmed before starting. */
export const MODE_BUTTON_LABEL: Region = { x: 1400, y: 940, width: 520, height: 55 };

const row = (y: number, firstX: number, count: number, pitch: number) =>
  Array.from({ length: count }, (_, i) => ({ x: firstX + i * pitch, y }));

/** Bench slots along the bottom, left to right. */
export const BENCH_SLOTS = row(911, 437, 8, 125);
export const FRONT_ROW_SLOTS = row(397, 740, 4, 145);
export const BACK_ROW_SLOTS = row(668, 600, 6, 144);

/**
 * Strip just below each bench card. Equipment and other non-character cards print 开启 here;
 * character cards leave it blank, which makes it a cheap way to skip them before dragging.
 */
export const BENCH_SLOT_LABELS = BENCH_SLOTS.map(
  (slot) => ({ x: slot.x - 55, y: 948, width: 110, height: 46 }) satisfies Region,
);

/** Whole bench card, used for the flat-colour test that spots an empty slot. */
export const BENCH_SLOT_CARDS = BENCH_SLOTS.map(
  (slot) => ({ x: slot.x - 50, y: 861, width: 100, height: 100 }) satisfies Region,
);

export const BUTTONS = {
  startWar: { x: 1585, y: 974 },
  /** Same spot for both modes; only the label changes. */
  enterMode: { x: 1639, y: 965 },
  startMatch: { x: 1692, y: 969 },
  next: { x: 1519, y: 989 },
  blank: { x: 960, y: 750 },
  /** Rerolls all three environments at once, and there is only one charge per run. */
  resetEnvironment: { x: 660, y: 983 },
  confirmEnvironment: { x: 1086, y: 983 },
  /** The bonus environment screen drops the reroll, so its confirm sits centred instead. */
  confirmBonusEnvironment: { x: 960, y: 987 },
  deploy: { x: 1818, y: 750 },
  shop: { x: 1623, y: 986 },
  /** Either card will do; the popup only blocks the board until one is confirmed. */
  starPickCard: { x: 926, y: 265 },
  starPickConfirm: { x: 1490, y: 564 },
  /** Ticking this once per run stops the deploy prompt from reappearing. */
  suppressPromptForRun: { x: 901, y: 607 },
  promptCancel: { x: 751, y: 675 },
  promptConfirm: { x: 1168, y: 675 },
  /** The 点击空白加速 hint sits right on top of this, so the first click there only skips the animation. */
  continueChallenge: { x: 961, y: 898 },
  confirmStrategy: { x: 959, y: 984 },
  backToPrepare: { x: 1789, y: 58 },
  exitRun: { x: 54, y: 63 },
  /** Restarting needs this one; 暂时离开 keeps the run and would resume it next time. */
  abandonAndSettle: { x: 773, y: 745 },
  leaveTemporarily: { x: 1195, y: 745 },
  /** 下一步 / 下一页 on the post-run report pages. Click until the start screen is back. */
  settleNext: { x: 961, y: 902 },
  /** Both only exist on the activity page while a run is saved. */
  resumeRun: { x: 1695, y: 962 },
  endAndSettle: { x: 1399, y: 965 },
  /** X in the top right corner of the season changelog popup. */
  closeNotice: { x: 1472, y: 276 },
} as const;
