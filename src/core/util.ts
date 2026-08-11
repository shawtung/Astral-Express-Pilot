import { Cancelled, currentContext } from './context.ts';

/** Rejects instead of resolving when the run is stopped, so every wait doubles as a cancel point. */
export function sleep(ms: number): Promise<void> {
  const signal = currentContext()?.signal;
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new Cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Scales a value by a random factor within +/- ratio, e.g. vary(500, 0.2) -> 400..600. */
export function vary(value: number, ratio: number): number {
  return value * randomBetween(1 - ratio, 1 + ratio);
}

/** Sleeps for a duration varied by +/- ratio so repeated waits are never identical. */
export function sleepAbout(ms: number, ratio = 0.25): Promise<void> {
  return sleep(vary(ms, ratio));
}
