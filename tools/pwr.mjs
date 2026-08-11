// Shared plumbing for the pwr-driven dev tools.
import { execFileSync } from 'node:child_process';

export const SESSION = 'Astral-Express-Pilot';

export function pwr(args, options = {}) {
  return execFileSync('playwright-cli', [`-s=${SESSION}`, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

/**
 * Points pwr at the cloud game tab. The index shifts whenever a tab is opened or closed,
 * so it has to be looked up by URL every time rather than assumed to be 0.
 */
export function selectGameTab() {
  const list = pwr(['tab-list']);
  const line = list.split('\n').find((l) => l.includes('sr.mihoyo.com/cloud'));
  if (!line) throw new Error(`no cloud game tab open:\n${list}`);
  const index = line.match(/^-\s*(\d+):/)?.[1];
  if (index === undefined) throw new Error(`cannot parse tab index from: ${line}`);
  pwr(['tab-select', index], { stdio: 'ignore' });
  return Number(index);
}
