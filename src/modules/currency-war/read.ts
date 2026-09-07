import type { Page } from 'playwright';
import { ENVIRONMENTS, STRATEGIES } from './data/codex.ts';
import { throwIfCancelled } from '../../core/context.ts';
import { bestMatch, containsFuzzy, normalize } from '../../core/match.ts';
import { joinText, readRegion } from '../../core/ocr.ts';
import {
  BENCH_SLOT_CARDS,
  BENCH_SLOT_LABELS,
  ENVIRONMENT_CARDS,
  ENVIRONMENT_ROW,
  FRONT_ROW_COUNTER,
  RUN_MODE,
  RUN_PROGRESS,
  SCREENS,
  STRATEGY_CARDS,
  STRATEGY_REFRESH_ROW,
  type Screen,
} from './screens.ts';
import { MODE_LABELS, type Mode } from './target.ts';
import { sleepAbout } from '../../core/util.ts';
import { fingerprint, fingerprintDistance, regionStats } from '../../core/vision.ts';

const ENVIRONMENT_NAMES = ENVIRONMENTS.map((e) => e.name);
const STRATEGY_NAMES = STRATEGIES.map((s) => s.name);

/** Mean absolute deviation below which a bench card is flat enough to be an empty slot. */
// Measured live: empty slots sit at 0.8, occupied ones at 42-56.
const EMPTY_SLOT_SPREAD = 12;

/** OCR merges the three environment names into one line, so match token by token. */
export function extractEnvironments(text: string): string[] {
  const found = new Set<string>();

  for (const token of text.split(/\s+/).filter(Boolean)) {
    const hit = bestMatch(token, ENVIRONMENT_NAMES);
    if (hit) found.add(hit.value);
  }

  if (found.size < 3) {
    const haystack = normalize(text);
    for (const name of ENVIRONMENT_NAMES) {
      if (haystack.includes(normalize(name))) found.add(name);
    }
  }
  return [...found];
}

export async function readEnvironments(page: Page): Promise<string[]> {
  const lines = await readRegion(page, ENVIRONMENT_ROW);
  return extractEnvironments(joinText(lines));
}

const MODE_BY_LABEL = new Map(
  (Object.entries(MODE_LABELS) as [Mode, string][]).map(([mode, label]) => [label, mode]),
);

export async function readRunMode(page: Page): Promise<Mode | null> {
  const lines = await readRegion(page, RUN_MODE);
  const hit = bestMatch(joinText(lines), [...MODE_BY_LABEL.keys()]);
  return hit ? (MODE_BY_LABEL.get(hit.value) ?? null) : null;
}

export type RunProgress = { layer: number; battle: number };

/** The difficulty label carries digits too, but the only hyphenated pair is the progress. */
export function extractProgress(text: string): RunProgress | null {
  const hit = text.match(/(\d+)\s*-\s*(\d+)/);
  if (!hit) return null;
  return { layer: Number(hit[1]), battle: Number(hit[2]) };
}

export async function readRunProgress(page: Page): Promise<RunProgress | null> {
  const lines = await readRegion(page, RUN_PROGRESS);
  return extractProgress(joinText(lines));
}

/** Reads the three environment cards left to right, so the wanted one can be clicked. */
export async function readEnvironmentCards(page: Page): Promise<(string | null)[]> {
  const names: (string | null)[] = [];
  for (const slot of ENVIRONMENT_CARDS) {
    const lines = await readRegion(page, slot.name);
    names.push(bestMatch(joinText(lines), ENVIRONMENT_NAMES)?.value ?? null);
  }
  return names;
}

/** Reads the three strategy cards left to right. A slot is null when OCR finds no known name. */
export async function readStrategies(page: Page): Promise<(string | null)[]> {
  const names: (string | null)[] = [];
  for (const slot of STRATEGY_CARDS) {
    const lines = await readRegion(page, slot.name);
    names.push(bestMatch(joinText(lines), STRATEGY_NAMES)?.value ?? null);
  }
  return names;
}

/** Parses the "1/3" front row counter. Returns null when OCR finds no usable pair. */
export function extractFrontRowCount(text: string): { filled: number; cap: number } | null {
  const hit = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!hit) return null;
  const filled = Number(hit[1]);
  const cap = Number(hit[2]);
  // A stray glyph glued to the front turns "2/3" into "12/3"; an impossible count is not usable.
  return filled > cap ? null : { filled, cap };
}

/**
 * The only trustworthy answer to "is a character actually deployed". Bench slots can hold
 * equipment as well as characters, so a drag is only confirmed once this number moves.
 */
export async function readFrontRowCount(page: Page): Promise<{ filled: number; cap: number } | null> {
  const lines = await readRegion(page, FRONT_ROW_COUNTER);
  return extractFrontRowCount(joinText(lines));
}

export type BenchSlotKind = 'character' | 'item' | 'empty';

export type BenchSlot = {
  index: number;
  kind: BenchSlotKind;
  /** Only set for characters. Copies of the same character share it. */
  signature?: number[];
};

/**
 * Classifies one bench slot without opening anything: 开启 marks an item, a near flat card
 * area marks an empty slot, and whatever is left is treated as a character. Only a drag that
 * moves the front row counter proves the last case, so callers must still verify.
 */
export async function readBenchSlot(page: Page, index: number): Promise<BenchSlot> {
  const label = BENCH_SLOT_LABELS[index];
  const card = BENCH_SLOT_CARDS[index];
  if (!label || !card) throw new Error(`bench slot out of range: ${index}`);

  const lines = await readRegion(page, label, { scale: 4 });
  if (bestMatch(joinText(lines), ['开启'], 0.75)) return { index, kind: 'item' };

  const { spread } = await regionStats(page, card);
  if (spread < EMPTY_SLOT_SPREAD) return { index, kind: 'empty' };

  return { index, kind: 'character', signature: await fingerprint(page, card) };
}

export async function readBench(page: Page): Promise<BenchSlot[]> {
  const slots: BenchSlot[] = [];
  for (let i = 0; i < BENCH_SLOT_LABELS.length; i++) slots.push(await readBenchSlot(page, i));
  return slots;
}

/**
 * Duplicates of the same character cannot be on the field together, so only one copy of each
 * is worth dragging. Anything below this many grey levels apart is the same card.
 */
// Measured live: identical content scores 0.0, unrelated content around 39.
const DUPLICATE_DISTANCE = 6;

/** One representative per distinct character, left to right. */
export function distinctCharacters(slots: BenchSlot[]): BenchSlot[] {
  const picked: BenchSlot[] = [];
  for (const slot of slots) {
    if (slot.kind !== 'character' || !slot.signature) continue;
    const duplicate = picked.some(
      (other) => fingerprintDistance(other.signature!, slot.signature!) < DUPLICATE_DISTANCE,
    );
    if (!duplicate) picked.push(slot);
  }
  return picked;
}

/**
 * Pulls the per-card refresh charges out of "刷新次数1 刷新次数1 刷新次数1".
 * The count is normally 1 but the 银·金·彩 environment raises it to 3, so it must be read
 * rather than assumed.
 */
export function extractRefreshCharges(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

export async function readRefreshCharges(page: Page): Promise<number[]> {
  const lines = await readRegion(page, STRATEGY_REFRESH_ROW);
  return extractRefreshCharges(joinText(lines));
}

/** True when the given screen's anchor text is currently visible. */
export async function isOnScreen(page: Page, screen: Screen): Promise<boolean> {
  const text = joinText(await readRegion(page, screen.probe));
  const anchors = typeof screen.anchor === 'string' ? [screen.anchor] : screen.anchor;
  if (screen.reject && containsFuzzy(text, screen.reject, 0.6)) return false;
  return anchors.some((anchor) => containsFuzzy(text, anchor, 0.6));
}

/** Overlays sit on top of a stage rather than replacing it, so several ids can be true at once. */
export async function detectScreens(page: Page): Promise<Screen[]> {
  const found: Screen[] = [];
  for (const screen of Object.values(SCREENS)) {
    if (await isOnScreen(page, screen)) found.push(screen);
  }
  return found;
}

/** Gap between two screen scans. */
export const SCAN_INTERVAL_MS = 10_000;

/** Scans without a recognised screen before the run is considered stuck. Combat no longer relies
 * on this budget: it is recognised on sight and waited out separately. */
export const MAX_SCAN_ROUNDS = 6;

/**
 * Polls until one of `expected` is on screen, returning the one that matched.
 * Returns null once `rounds` scans have all missed, which means the game is stuck (stream frozen,
 * disconnected, or on a screen we do not know about) and the caller should bail out.
 */
export async function waitForScreen(
  page: Page,
  expected: Screen | readonly Screen[],
  options: { intervalMs?: number; rounds?: number } = {},
): Promise<Screen | null> {
  const candidates = Array.isArray(expected) ? expected : [expected as Screen];
  const intervalMs = options.intervalMs ?? SCAN_INTERVAL_MS;
  const rounds = options.rounds ?? MAX_SCAN_ROUNDS;

  for (let round = 0; round < rounds; round++) {
    throwIfCancelled();
    if (round > 0) await sleepAbout(intervalMs, 0.1);
    for (const screen of candidates) {
      if (await isOnScreen(page, screen)) return screen;
    }
  }
  return null;
}
