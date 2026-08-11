import type { Page } from 'playwright';
import type { StopReason } from './notify.ts';

/** A config problem, tied to a field and optionally to the single entry that caused it. */
export type Problem = {
  field: string;
  message: string;
  name?: string;
};

/**
 * One farmable activity. Everything game-specific sits behind this contract so the CLI and
 * the future Electron UI only ever talk to modules, never to screen coordinates.
 */
export type GameModule<Config> = {
  id: string;
  title: string;
  /** Turns raw JSON into the module's own config shape. Throws when the shape is wrong. */
  loadConfig(raw: unknown): Config;
  validate(config: Config): Problem[];
  /** Human readable echo of the config, shown before a run starts. */
  describe(config: Config): string[];
  /** Walks from the open world to the screen `run` expects. Needed when nobody can click. */
  reachStart?(page: Page): Promise<void>;
  run(page: Page, config: Config): Promise<StopReason>;
};

/**
 * Registry view. Each module keeps its own config type, so the only way to hold them in one
 * list is to erase it here; loadConfig and run are always called as a pair on the same module.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyModule = GameModule<any>;
