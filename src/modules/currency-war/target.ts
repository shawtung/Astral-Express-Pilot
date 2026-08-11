import { ENVIRONMENTS, STRATEGIES, type Rarity } from './data/codex.ts';
import { normalize } from '../../core/match.ts';

/** Never remembered by the game, so it has to be picked on every run. */
export type Mode = 'standard' | 'overclock';

export const MODE_LABELS: Record<Mode, string> = {
  standard: '标准博弈',
  overclock: '超频博弈',
};

/**
 * Names inside a group are ORed: any one of them counts as a hit. `combine` decides how the
 * two groups relate, which covers the four cases: strategies only, environments only,
 * both required (and), either one (or).
 */
export type TargetConfig = {
  mode: Mode;
  combine: 'or' | 'and';
  /** Derive the environment from the wanted rarities instead of `environments` and `combine`. */
  smartEnvironment: boolean;
  environments: string[];
  strategies: string[];
  /** Plane whose strategies are inspected. Only 1 is supported for now. */
  plane?: number;
};

export type ItemKind = 'environment' | 'strategy';

/** What the bot has confirmed so far. Environments are the ones kept, not merely offered. */
export type Observation = {
  environments: string[];
  strategies: string[];
};

export type Stage = 'environment' | 'strategy';

const ENV_BY_NAME = new Map(ENVIRONMENTS.map((e) => [normalize(e.name), e]));
const STRATEGY_BY_NAME = new Map(STRATEGIES.map((s) => [normalize(s.name), s]));

export function classify(name: string): ItemKind | null {
  const key = normalize(name);
  if (ENV_BY_NAME.has(key)) return 'environment';
  if (STRATEGY_BY_NAME.has(key)) return 'strategy';
  return null;
}

/** Strategies that wreck a run when taken by accident, so they are never the throwaway pick. */
export const AVOIDED_STRATEGIES = ['轮回不止'];

const AVOIDED_KEYS = new Set(AVOIDED_STRATEGIES.map(normalize));

/** Blacklisted, unless the config names it: asking for it is the way to opt back in. */
export function isAvoided(config: TargetConfig, name: string): boolean {
  const key = normalize(name);
  if (!AVOIDED_KEYS.has(key)) return false;
  return !config.strategies.some((wanted) => normalize(wanted) === key);
}

/** Environments that narrow the pool to one rarity, best first. */
const RARITY_ENVIRONMENTS: Record<Rarity, [string, ...string[]]> = {
  棱彩: ['彩虹时代', '头彩'],
  黄金: ['黄金时代'],
  白银: ['白银时代'],
};

/** The only environment offering all three rarities at once. */
const MIXED_ENVIRONMENT = '银·金·彩';

/** Ranking used once more than one rarity is wanted, before filtering by those rarities. */
const MIXED_ORDER = ['彩虹时代', '头彩', '黄金时代', '白银时代'];

function targetRarities(strategies: string[]): Rarity[] {
  const seen = new Set<Rarity>();
  for (const name of strategies) {
    const entry = STRATEGY_BY_NAME.get(normalize(name));
    if (entry) seen.add(entry.rarity);
  }
  return [...seen];
}

/**
 * Environment wish list for smart mode, best first. A single wanted rarity puts its own age
 * ahead of the mixed environment; several rarities can only be served by the mixed one, so it
 * leads and the single-rarity ages follow in a fixed ranking.
 */
export function smartEnvironmentOrder(config: TargetConfig): string[] {
  const rarities = targetRarities(config.strategies);
  const only = rarities.length === 1 ? rarities[0] : undefined;
  if (only) {
    const [age, ...rest] = RARITY_ENVIRONMENTS[only];
    return [age, MIXED_ENVIRONMENT, ...rest];
  }
  if (!rarities.length) return [];
  const reachable = new Set(rarities.flatMap((rarity) => RARITY_ENVIRONMENTS[rarity]));
  return [MIXED_ENVIRONMENT, ...MIXED_ORDER.filter((name) => reachable.has(name))];
}

export type Problem = {
  field: 'mode' | 'environments' | 'strategies' | 'combine';
  message: string;
  /** The offending name, so the UI can highlight just that chip. */
  name?: string;
};

export function validateTarget(config: TargetConfig): Problem[] {
  const problems: Problem[] = [];
  const plane = config.plane ?? 1;
  const overclock = config.mode === 'overclock';
  // Smart mode picks the environment itself, so a stale environment list must not be judged.
  const environments = config.smartEnvironment ? [] : config.environments;

  if (config.smartEnvironment) {
    if (!config.strategies.length) {
      problems.push({ field: 'strategies', message: '智能选择环境需要至少一个投资策略' });
    }
  } else if (config.combine === 'and') {
    if (!config.environments.length) {
      problems.push({ field: 'environments', message: 'AND 条件下投资环境不能为空' });
    }
    if (!config.strategies.length) {
      problems.push({ field: 'strategies', message: 'AND 条件下投资策略不能为空' });
    }
  } else if (!config.environments.length && !config.strategies.length) {
    problems.push({ field: 'combine', message: '投资环境和投资策略不能同时为空' });
  }

  for (const name of environments) {
    const entry = ENV_BY_NAME.get(normalize(name));
    if (!entry) {
      problems.push({ field: 'environments', name, message: `“${name}” 不是已知的投资环境` });
    } else if (overclock && entry.standardOnly) {
      problems.push({
        field: 'environments',
        name,
        message: `“${name}” 仅在标准博弈出现，与当前模式冲突`,
      });
    }
  }

  for (const name of config.strategies) {
    const entry = STRATEGY_BY_NAME.get(normalize(name));
    if (!entry) {
      problems.push({ field: 'strategies', name, message: `“${name}” 不是已知的投资策略` });
      continue;
    }
    if (overclock && entry.standardOnly) {
      problems.push({
        field: 'strategies',
        name,
        message: `“${name}” 仅在标准博弈出现，与当前模式冲突`,
      });
    }
    if (!entry.planes.includes(plane)) {
      problems.push({
        field: 'strategies',
        name,
        message: `“${name}” 不会在第 ${plane} 位面出现（仅 ${entry.planes.join('/')}）`,
      });
    }
  }

  return problems;
}

export type TargetResult = {
  /** failed means the run can be abandoned right away. */
  state: 'satisfied' | 'pending' | 'failed';
  environmentHit?: string;
  strategyHit?: string;
};

function firstHit(wanted: string[], seen: string[]): string | undefined {
  const pool = new Set(seen.map(normalize));
  return wanted.find((name) => pool.has(normalize(name)));
}

/**
 * Decides whether to keep going, stop, or bail out. Bailing at the environment stage only
 * happens when environments alone can already settle the outcome, i.e. AND, or OR with no
 * strategies listed. Smart mode never settles there: the environment is only a means.
 */
export function evaluateTarget(
  config: TargetConfig,
  observed: Observation,
  stage: Stage,
): TargetResult {
  const combine = config.smartEnvironment ? 'or' : config.combine;
  const environmentHit = config.smartEnvironment
    ? undefined
    : firstHit(config.environments, observed.environments);

  if (stage === 'environment') {
    if (combine === 'and') {
      return environmentHit ? { state: 'pending', environmentHit } : { state: 'failed' };
    }
    if (environmentHit) return { state: 'satisfied', environmentHit };
    return config.strategies.length ? { state: 'pending' } : { state: 'failed' };
  }

  const strategyHit = firstHit(config.strategies, observed.strategies);
  const satisfied =
    combine === 'and'
      ? Boolean(environmentHit && strategyHit)
      : Boolean(environmentHit || strategyHit);

  return { state: satisfied ? 'satisfied' : 'failed', environmentHit, strategyHit };
}
