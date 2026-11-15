// The asset worker: fetches parts of asset files by range, inflates those stored deflated, checks each against its
// hash, and keeps them as stored, in memory and on disk, off the page's thread. What to fetch and when is decided in
// client/core/assets. This file joins those decisions to the browser.

import { FAIL_HASH, FAIL_NET, FAIL_RANGE, type AssetPart } from "../core/assets/port.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

/** One request: parts of one file, which follow one another in it, to be answered as one run of bytes. */
export interface Ask {
  slot: number;
  url: string;
  parts: AssetPart[];
  fresh: boolean;
}

/** A fetch that has not answered in this long is given up. */
const TIMEOUT_MS = 20000;
/** Parts kept in memory as stored, newest last, so that what the card let go and wants back is not fetched again. */
const KEEP_BYTES = 64 * 1024 * 1024;
const kept = new Map<string, Uint8Array>();
let keptBytes = 0;
const under = new Map<number, AbortController>();

// The disk cache is a folder in the browser's private file system for this site: one file for each part, as stored, named by its hash.
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
/** Done when the disk has been looked at. A part that arrives sooner waits for it, and is not lost to the cache. */
let opened: Promise<void> = Promise.resolve();
/** Parts asked for only to be kept, and how many of them are being fetched. */
const toFill: { url: string; part: AssetPart }[] = [];
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

async function dropFromDisk(hash: string): Promise<void> {
  if (!disk || !onDisk.has(hash)) return;
  await disk.removeEntry(hash).catch(() => {});
  diskBytes -= onDisk.get(hash) ?? 0;
  onDisk.delete(hash);
}

/** A part as stored, from the disk, or null. Whether it is good is found when it is opened. */
async function fromDisk(hash: string): Promise<Uint8Array | null> {
  await opened;
  if (!disk || !onDisk.has(hash)) return null;
  try {
    const h = await (await disk.getFileHandle(hash)).createSyncAccessHandle();
    const data = new Uint8Array(h.getSize());
    h.read(data, { at: 0 });
    h.close();
    onDisk.delete(hash);
    onDisk.set(hash, data.length);
    return data;
  } catch {
    // Another request has the file open. This one goes to the network.
    return null;
  }
}

async function toDisk(hash: string, data: Uint8Array, again = true): Promise<void> {
  await opened;
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
  await opened;
  if (filling >= 2) return;
  const a = toFill.shift();
  if (!a) return;
  filling++;
  if (disk && !onDisk.has(a.part.hash)) {
    const got = await fetchRun(a.url, [a.part], new AbortController().signal).catch(() => null);
    const stored = got?.data?.[0];
    if (stored && (await open(stored, a.part))) await toDisk(a.part.hash, stored);
  }
  filling--;
  report();
  void fill();
}
/** A made-up link for trying things by hand: milliseconds of delay, kilobytes a second, and failures in a hundred. */
let net: number[] = [];

function keep(hash: string, data: Uint8Array): void {
  if (kept.has(hash)) return;
  kept.set(hash, data);
  keptBytes += data.length;
  for (const old of kept.keys()) {
    if (keptBytes <= KEEP_BYTES) break;
    unkeep(old);
  }
}

function unkeep(hash: string): void {
  keptBytes -= kept.get(hash)?.length ?? 0;
  kept.delete(hash);
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const hashOf = async (data: Uint8Array<ArrayBuffer>): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)).subarray(0, 8));
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * A part's bytes from what is stored, inflated and its filter undone where it is stored deflated, and checked against
 * its hash. Null where they do not come back to it. Bytes as long as the part once inflated are taken as they are: an
 * older build stored every part so.
 */
async function open(stored: Uint8Array, part: AssetPart): Promise<Uint8Array<ArrayBuffer> | null> {
  let data: Uint8Array<ArrayBuffer> | null = stored.slice();
  if (part.inflated !== undefined && stored.length !== part.inflated) {
    try {
      const stream = new Blob([stored.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = unfilterPart(new Uint8Array(await new Response(stream).arrayBuffer()), part.inflated) as Uint8Array<ArrayBuffer> | null;
    } catch {
      data = null;
    }
  }
  if (!data || data.length !== (part.inflated ?? part.length)) return null;
  return part.hash !== "" && (await hashOf(data)) !== part.hash ? null : data;
}

/** Fetches parts that follow one another in a file with one range, past the browser's cache if `fresh`. Each comes back as stored. */
async function fetchRun(url: string, parts: readonly AssetPart[], signal: AbortSignal, fresh = false): Promise<{ data: Uint8Array[] | null; fail: number; fetched: number; status: number }> {
  const [delay = 0, rate = 0, loss = 0] = net;
  if (delay > 0) await wait(delay);
  if (Math.random() * 100 < loss) return { data: null, fail: FAIL_NET, fetched: 0, status: 0 };
  const from = parts[0]!.offset;
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const res = await fetch(url, { headers: { range: `bytes=${from}-${from + length - 1}` }, signal, cache: fresh ? "reload" : "default" });
  if (res.status === 416) return { data: null, fail: FAIL_RANGE, fetched: 0, status: 416 };
  if (!res.ok) return { data: null, fail: FAIL_NET, fetched: 0, status: res.status };
  let data = new Uint8Array(await res.arrayBuffer());
  // A server that does not do ranges sends the whole file.
  if (res.status === 200) data = data.slice(from, from + length);
  if (rate > 0) await wait(data.length / rate);
  if (data.length !== length) return { data: null, fail: FAIL_NET, fetched: data.length, status: res.status };
  return { data: parts.map((p) => data.slice(p.offset - from, p.offset - from + p.length)), fail: 0, fetched: data.length, status: res.status };
}

/**
 * Answers a request: each part from memory, else from the disk, else from the network, the parts still wanted that
 * follow one another fetched with one range. Every part is opened and checked before any is handed over.
 */
async function answer(a: Ask): Promise<void> {
  const stop = new AbortController();
  under.set(a.slot, stop);
  const out: (Uint8Array | null)[] = a.parts.map(() => null);
  let cached = 0;
  let fetched = 0;
  let fail = 0;
  let status = 0;
  if (!a.fresh) {
    for (let k = 0; k < a.parts.length; k++) {
      const p = a.parts[k]!;
      const memory = kept.get(p.hash);
      const stored = memory ?? (await fromDisk(p.hash));
      if (!stored) continue;
      out[k] = await open(stored, p);
      if (out[k]) {
        cached += stored.length;
        if (!memory) keep(p.hash, stored);
      } else {
        // Bytes kept that do not come back are no use, and are fetched afresh.
        unkeep(p.hash);
        await dropFromDisk(p.hash);
      }
    }
  }
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    for (let k = 0; k < a.parts.length && fail === 0; ) {
      if (out[k]) {
        k++;
        continue;
      }
      let end = k + 1;
      while (end < a.parts.length && !out[end] && a.parts[end]!.offset === a.parts[end - 1]!.offset + a.parts[end - 1]!.length) end++;
      const run = a.parts.slice(k, end);
      const got = await fetchRun(a.url, run, stop.signal, a.fresh).catch(() => ({ data: null, fail: FAIL_NET, fetched: 0, status: 0 }));
      fetched += got.fetched;
      fail = got.fail;
      status = got.status;
      for (let j = 0; got.data && j < run.length; j++) {
        const stored = got.data[j]!;
        out[k + j] = await open(stored, run[j]!);
        if (!out[k + j]) fail = FAIL_HASH;
        else {
          keep(run[j]!.hash, stored);
          void toDisk(run[j]!.hash, stored);
        }
      }
      k = end;
    }
  } catch {
    fail = FAIL_NET;
  }
  clearTimeout(timer);
  // Cancelled: the page no longer wants it and must not be told of it.
  if (under.get(a.slot) !== stop) return;
  under.delete(a.slot);
  if (fail !== 0) {
    scope.postMessage({ slot: a.slot, data: null, fail, fetched, cached, status });
    return;
  }
  const data = new Uint8Array(out.reduce((sum, d) => sum + d!.length, 0));
  for (let k = 0, at = 0; k < out.length; at += out[k]!.length, k++) data.set(out[k]!, at);
  scope.postMessage({ slot: a.slot, data, fail: 0, fetched, cached }, [data.buffer]);
}

scope.onmessage = (e) => {
  const m = e.data as { ask?: Ask; cancel?: number; net?: number[]; open?: number; fill?: { url: string; part: AssetPart }[] };
  if (m.net) net = m.net;
  if (m.open !== undefined) opened = openDisk(m.open);
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
