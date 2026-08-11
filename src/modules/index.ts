import type { AnyModule } from '../module.ts';
import { currencyWar } from './currency-war/index.ts';

export const MODULES: AnyModule[] = [currencyWar];

export function findModule(id: string): AnyModule | undefined {
  return MODULES.find((m) => m.id === id);
}
