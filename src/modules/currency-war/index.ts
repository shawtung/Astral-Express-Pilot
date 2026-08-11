import type { GameModule } from '../../module.ts';
import { reachStart, run } from './flow.ts';
import { MODE_LABELS, validateTarget, type TargetConfig } from './target.ts';

export const currencyWar: GameModule<TargetConfig> = {
  id: 'currency-war',
  title: '货币战争 · 刷投资环境/策略',

  loadConfig(raw) {
    if (typeof raw !== 'object' || raw === null) throw new Error('配置必须是一个对象');
    const config = raw as Partial<TargetConfig>;
    return {
      mode: config.mode ?? 'standard',
      combine: config.combine ?? 'or',
      smartEnvironment: config.smartEnvironment ?? true,
      environments: config.environments ?? [],
      strategies: config.strategies ?? [],
      plane: config.plane ?? 1,
    };
  },

  validate: validateTarget,

  describe(config) {
    if (config.smartEnvironment) {
      return [
        `模式: ${MODE_LABELS[config.mode]}`,
        '投资环境: 智能选择',
        `投资策略: ${config.strategies.join(' / ') || '(不限)'}`,
      ];
    }
    return [
      `模式: ${MODE_LABELS[config.mode]}`,
      `投资环境: ${config.environments.join(' / ') || '(不限)'}`,
      `  ${config.combine === 'and' ? '并且' : '或者'}`,
      `投资策略: ${config.strategies.join(' / ') || '(不限)'}`,
    ];
  },

  reachStart,
  run,
};