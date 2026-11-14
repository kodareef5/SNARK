// The asset worker: fetches parts of asset files by range, checks each against its hash, and keeps the latest in
// memory, off the page's thread. What to fetch and when is decided in client/core/assets. This file joins those
// decisions to the browser.

import { FAIL_HASH, FAIL_NET, FAIL_RANGE } from "../core/assets/port.ts";

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

export interface Ask {
  slot: number;
  url: string;
  offset: number;
  length: number;
  hash: string;
  fresh: boolean;
}

/** A fetch that has not answered in this long is given up. */
const TIMEOUT_MS = 20000;
/** Parts kept in memory, newest last, so that what the card let go and wants back is not fetched again. */
const KEEP_BYTES = 64 * 1024 * 1024;
const kept = new Map<string, Uint8Array>();
let keptBytes = 0;
const under = new Map<number, AbortController>();
/** A made-up link for trying things by hand: milliseconds of delay, kilobytes a second, and failures in a hundred. */
let net: number[] = [];

function keep(hash: string, data: Uint8Array): void {
  kept.set(hash, data);
  keptBytes += data.length;
  for (const [old, bytes] of kept) {
    if (keptBytes <= KEEP_BYTES) break;
    kept.delete(old);
    keptBytes -= bytes.length;
  }
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function fetchPart(a: Ask, signal: AbortSignal): Promise<{ data: Uint8Array | null; fail: number; fetched: number }> {
  const [delay = 0, rate = 0, loss = 0] = net;
  if (delay > 0) await wait(delay);
  if (Math.random() * 100 < loss) return { data: null, fail: FAIL_NET, fetched: 0 };
  const res = await fetch(a.url, { headers: { range: `bytes=${a.offset}-${a.offset + a.length - 1}` }, signal, cache: a.fresh ? "reload" : "default" });
  if (res.status === 416) return { data: null, fail: FAIL_RANGE, fetched: 0 };
  if (!res.ok) return { data: null, fail: FAIL_NET, fetched: 0 };
  let data = new Uint8Array(await res.arrayBuffer());
  // A server that does not do ranges sends the whole file.
  if (res.status === 200) data = data.slice(a.offset, a.offset + a.length);
  if (rate > 0) await wait(data.length / rate);
  if (data.length !== a.length) return { data: null, fail: FAIL_NET, fetched: data.length };
  const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)).subarray(0, 8));
  return a.hash !== "" && hash !== a.hash ? { data: null, fail: FAIL_HASH, fetched: data.length } : { data, fail: 0, fetched: data.length };
}

async function answer(a: Ask): Promise<void> {
  const had = a.fresh ? undefined : kept.get(a.hash);
  if (had) {
    const copy = had.slice();
    scope.postMessage({ slot: a.slot, data: copy, fail: 0, fetched: 0, cached: copy.length }, [copy.buffer]);
    return;
  }
  const stop = new AbortController();
  under.set(a.slot, stop);
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  let out: { data: Uint8Array | null; fail: number; fetched: number };
  try {
    out = await fetchPart(a, stop.signal);
  } catch {
    out = { data: null, fail: FAIL_NET, fetched: 0 };
  }
  clearTimeout(timer);
  // Cancelled: the page no longer wants it and must not be told of it.
  if (under.get(a.slot) !== stop) return;
  under.delete(a.slot);
  if (out.data) keep(a.hash, out.data.slice());
  scope.postMessage({ slot: a.slot, data: out.data, fail: out.fail, fetched: out.fetched, cached: 0 }, out.data ? [out.data.buffer] : []);
}

scope.onmessage = (e) => {
  const m = e.data as { ask?: Ask; cancel?: number; net?: number[] };
  if (m.net) net = m.net;
  if (m.cancel !== undefined) {
    under.get(m.cancel)?.abort();
    under.delete(m.cancel);
  }
  if (m.ask) void answer(m.ask);
};
