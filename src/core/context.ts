import { AsyncLocalStorage } from 'node:async_hooks';

/** Ambient state for one run: where its log lines go and how the operator stops it. */
export type RunContext = {
  signal: AbortSignal;
  log(message: string): void;
};

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

/** Absent outside a run, so one-shot CLI helpers keep working without a context. */
export function currentContext(): RunContext | undefined {
  return storage.getStore();
}

/** Sends a line to the current run's log, or to stdout when there is no run around it. */
export function report(message: string): void {
  const context = currentContext();
  if (context) context.log(message);
  else console.log(message);
}

export class Cancelled extends Error {
  constructor() {
    super('已手动停止');
  }
}

export function isCancelled(): boolean {
  return storage.getStore()?.signal.aborted ?? false;
}

export function throwIfCancelled(): void {
  if (isCancelled()) throw new Cancelled();
}
