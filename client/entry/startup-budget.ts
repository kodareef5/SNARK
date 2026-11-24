import { StartupQueue, type ConnectionHint } from "../core/startup-budget.ts";

type BrowserConnection = ConnectionHint & { addEventListener?(event: "change", changed: () => void): void };
type SpeculativeFetch = RequestInit & { priority: "low" };

export function connectionHint(): BrowserConnection | undefined {
  return (navigator as Navigator & { connection?: BrowserConnection }).connection;
}

export function startupQueue(bytes: number): StartupQueue<AbortSignal> {
  return new StartupQueue({
    fetch(url, stop) {
      const signal = AbortSignal.any([stop, AbortSignal.timeout(8000)]);
      const opts: SpeculativeFetch = { signal, priority: "low", redirect: "error" };
      return fetch(url, opts);
    },
    stop: () => new AbortController(),
  }, bytes);
}
