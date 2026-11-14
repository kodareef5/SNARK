// The asset worker: fetches parts of asset files by range, checks each against its hash, and keeps them, in memory and
// on disk, off the page's thread. What to fetch and when is decided in client/core/assets. This file joins those
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

// The disk cache is a folder in the browser's private file system for this site: one file for each part, named by its hash.
interface PartHandle {
  getSize(): number;
  read(into: Uint8Array, at: { at: number }): number;
  write(from: Uint8Array, at: { at: number }): number;
  flush(): void;
  close(): void;
}
interface Folder {
  getFileHandle(name: string, o?: { create: boolean }): Promise<{ createSyncAccessHandle(): Promise<PartHandle> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}
let disk: Folder | null = null;
/** Bytes of each part on disk by hash, least lately used first. */
const onDisk = new Map<string, number>();
let diskBytes = 0;
let diskLimit = 0;
/** Parts asked for only to be kept, and how many of them are being fetched. */
const toFill: Ask[] = [];
let filling = 0;

const report = (): void => scope.postMessage({ cache: { used: diskBytes, limit: diskLimit, mode: disk ? "disk" : "memory", filling: toFill.length + filling } });

/** Finds what earlier visits left. In a private window, or a browser without the file system, parts are kept in memory alone. */
async function openDisk(limit: number): Promise<void> {
  diskLimit = limit;
  try {
    const root = await (navigator.storage as unknown as { getDirectory(): Promise<{ getDirectoryHandle(name: string, o: { create: boolean }): Promise<Folder> }> }).getDirectory();
    const folder = await root.getDirectoryHandle("parts", { create: true });
    for await (const name of folder.keys()) {
      const h = await (await folder.getFileHandle(name)).createSyncAccessHandle();
      onDisk.set(name, h.getSize());
      diskBytes += h.getSize();
      h.close();
    }
    disk = folder;
  } catch {
    disk = null;
  }
  report();
}

async function forget(downTo: number): Promise<void> {
  for (const [old, bytes] of onDisk) {
    if (diskBytes <= downTo || !disk) break;
    await disk.removeEntry(old).catch(() => {});
    onDisk.delete(old);
    diskBytes -= bytes;
  }
}

async function fromDisk(a: Ask): Promise<Uint8Array | null> {
  if (!disk || !onDisk.has(a.hash)) return null;
  try {
    const h = await (await disk.getFileHandle(a.hash)).createSyncAccessHandle();
    const data = new Uint8Array(h.getSize());
    h.read(data, { at: 0 });
    h.close();
    if (data.length === a.length && (await hashOf(data)) === a.hash) {
      onDisk.delete(a.hash);
      onDisk.set(a.hash, data.length);
      return data;
    }
    // A file cut short or gone bad is no use and is fetched afresh.
    await disk.removeEntry(a.hash).catch(() => {});
    diskBytes -= onDisk.get(a.hash) ?? 0;
    onDisk.delete(a.hash);
  } catch {
    // Another request has the file open. This one goes to the network.
  }
  return null;
}

async function toDisk(hash: string, data: Uint8Array, again = true): Promise<void> {
  if (!disk || onDisk.has(hash) || data.length > diskLimit) return;
  await forget(diskLimit - data.length);
  try {
    const h = await (await disk.getFileHandle(hash, { create: true })).createSyncAccessHandle();
    h.write(data, { at: 0 });
    h.flush();
    h.close();
    onDisk.set(hash, data.length);
    diskBytes += data.length;
  } catch {
    // The browser has less room than was hoped. A quarter of what is kept goes and it is tried once more, and then memory must do.
    if (again) {
      await forget(diskBytes * 0.75);
      await toDisk(hash, data, false);
    } else disk = null;
  }
  report();
}

/** Fetches what was asked for only to be kept, two at a time, behind what the scene is waiting for. */
async function fill(): Promise<void> {
  if (filling >= 2) return;
  const a = toFill.shift();
  if (!a) return;
  filling++;
  if (disk && !onDisk.has(a.hash)) {
    const out = await fetchPart(a, new AbortController().signal).catch(() => null);
    if (out?.data) await toDisk(a.hash, out.data);
  }
  filling--;
  report();
  void fill();
}
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
const hashOf = async (data: Uint8Array<ArrayBuffer>): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)).subarray(0, 8));
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
  return a.hash !== "" && (await hashOf(data)) !== a.hash ? { data: null, fail: FAIL_HASH, fetched: data.length } : { data, fail: 0, fetched: data.length };
}

async function answer(a: Ask): Promise<void> {
  const stop = new AbortController();
  under.set(a.slot, stop);
  const had = a.fresh ? null : (kept.get(a.hash)?.slice() ?? (await fromDisk(a)));
  if (had) {
    if (under.get(a.slot) !== stop) return;
    under.delete(a.slot);
    if (!kept.has(a.hash)) keep(a.hash, had.slice());
    scope.postMessage({ slot: a.slot, data: had, fail: 0, fetched: 0, cached: had.length }, [had.buffer]);
    return;
  }
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
  if (out.data) {
    keep(a.hash, out.data.slice());
    void toDisk(a.hash, out.data.slice());
  }
  scope.postMessage({ slot: a.slot, data: out.data, fail: out.fail, fetched: out.fetched, cached: 0 }, out.data ? [out.data.buffer] : []);
}

scope.onmessage = (e) => {
  const m = e.data as { ask?: Ask; cancel?: number; net?: number[]; open?: number; fill?: Ask[] };
  if (m.net) net = m.net;
  if (m.open !== undefined) void openDisk(m.open);
  if (m.fill) {
    toFill.push(...m.fill);
    void fill();
    void fill();
  }
  if (m.cancel !== undefined) {
    under.get(m.cancel)?.abort();
    under.delete(m.cancel);
  }
  if (m.ask) void answer(m.ask);
};
