// The asset worker: fetches parts of asset files by range, inflates those stored deflated, checks each against its
// hash, and keeps them as stored, in memory and on disk, off the page's thread. What to fetch and when is decided in
// client/core/assets. This file joins those decisions to the browser.

import { FAIL_HASH, FAIL_NET, FAIL_RANGE, type AssetPart } from "../core/assets/port.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
}
const scope = globalThis as unknown as Scope;

/** One request: parts of one file, which follow one another in it, to be answered as one run of bytes. */
export interface Ask {
  slot: number;
  generation?: number;
  url: string;
  parts: AssetPart[];
  fresh: boolean;
}

type Bytes = Uint8Array<ArrayBuffer>;

/** A fetch that has not answered in this long is given up. */
const TIMEOUT_MS = 20000;
const MB = 1024 * 1024;
/**
 * Bytes of parts kept in memory as stored, least lately used first: with a disk, the last few, which a texture's climb
 * asks for again; without one, all that is kept between what the card lets go and wants back, less on a phone.
 */
const KEEP_DISK = 8 * MB;
const KEEP_MEMORY = 64 * MB;
const KEEP_MEMORY_TOUCH = 16 * MB;
let keepMemory = KEEP_MEMORY;
const kept = new Map<string, Bytes>();
let keptBytes = 0;
const under = new Map<number, AbortController>();
/** Parts asked for only to be kept are fetched in runs of those that follow one another in a file, up to this many bytes. */
const FILL_RUN = 8 * MB;

// The disk cache is a folder in the browser's private file system for this site: one file for each part, as stored, named by its hash.
interface PartHandle {
  getSize(): number;
  read(into: Uint8Array, at: { at: number }): number;
  write(from: Uint8Array, at: { at: number }): number;
  flush(): void;
  close(): void;
}
interface FileEntry {
  kind: "file" | "directory";
  name: string;
  getFile(): Promise<File>;
  createSyncAccessHandle(): Promise<PartHandle>;
}
interface Folder {
  getFileHandle(name: string, o?: { create: boolean }): Promise<FileEntry>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<FileEntry>;
}
let disk: Folder | null = null;
/** Bytes of each part on disk by hash, least lately used first. Whoever adds a part counts its bytes. */
const onDisk = new Map<string, number>();
let diskBytes = 0;
let diskLimit = 0;
/** The folder once it is open, null for none; and done when every file in it has been counted. Until then a part is looked for by its name, and nothing is written. */
let found: Promise<Folder | null> = Promise.resolve(null);
let opened: Promise<void> = Promise.resolve();
let counted = false;
/** Parts asked for only to be kept, and how many runs of them are being fetched. */
const toFill: { url: string; part: AssetPart }[] = [];
let filling = 0;
/** How the files come, as the browser names it (http/1.1, h2, h3), from the first fetch that says. */
let protocol = "";

const report = (): void => scope.postMessage({ cache: { used: diskBytes, limit: diskLimit, mode: disk ? "disk" : "memory", filling: toFill.length + filling, protocol } });

new PerformanceObserver((list, watch) => {
  for (const e of list.getEntries() as PerformanceResourceTiming[]) {
    if (!e.nextHopProtocol) continue;
    protocol = e.nextHopProtocol;
    watch.disconnect();
    report();
    return;
  }
}).observe({ type: "resource", buffered: true });

/** Finds what earlier visits left. In a private window, or a browser without the file system, parts are kept in memory alone. */
function openDisk(limit: number, touch: boolean): void {
  diskLimit = limit;
  keepMemory = touch ? KEEP_MEMORY_TOUCH : KEEP_MEMORY;
  const storage = (navigator as unknown as { storage: { getDirectory(): Promise<{ getDirectoryHandle(name: string, o: { create: boolean }): Promise<Folder> }> } }).storage;
  found = Promise.resolve()
    .then(() => storage.getDirectory())
    .then((root) => root.getDirectoryHandle("parts", { create: true }))
    .catch(() => null);
  opened = found.then(count);
}

/** Counts what is on disk, behind the requests. */
async function count(folder: Folder | null): Promise<void> {
  disk = folder;
  if (folder) {
    trim();
    try {
      for await (const entry of folder.values()) {
        if (entry.kind !== "file" || onDisk.has(entry.name)) continue;
        const size = await entry.getFile().then((f) => f.size, () => -1);
        if (size < 0 || onDisk.has(entry.name)) continue;
        onDisk.set(entry.name, size);
        diskBytes += size;
      }
    } catch {
      // The folder went while it was read. Each part read or written finds out for itself.
    }
  }
  counted = true;
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
  if (!disk) return;
  await disk.removeEntry(hash).catch(() => {});
  diskBytes -= onDisk.get(hash) ?? 0;
  onDisk.delete(hash);
}

/** A part as stored, from the disk, or null. Whether it is good is found when it is opened. */
async function fromDisk(hash: string): Promise<Bytes | null> {
  await found;
  if (!disk || (counted && !onDisk.has(hash))) return null;
  let entry: FileEntry;
  try {
    entry = await disk.getFileHandle(hash);
  } catch {
    // Not there, though it was: the browser or the player cleared the disk, and it is written again when it comes.
    diskBytes -= onDisk.get(hash) ?? 0;
    onDisk.delete(hash);
    return null;
  }
  try {
    const h = await entry.createSyncAccessHandle();
    const data = new Uint8Array(h.getSize());
    h.read(data, { at: 0 });
    h.close();
    const size = onDisk.get(hash);
    onDisk.delete(hash);
    onDisk.set(hash, data.length);
    if (size === undefined) diskBytes += data.length;
    return data;
  } catch {
    // Another request has the file open. This one goes to the network.
    return null;
  }
}

async function toDisk(hash: string, data: Bytes, again = true): Promise<void> {
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

/** Fetches what was asked for only to be kept, behind what the scene is waiting for: two runs at a time, each of parts that follow one another in a file. */
async function fill(): Promise<void> {
  await opened;
  if (filling >= 2) return;
  while (toFill.length > 0 && onDisk.has(toFill[0]!.part.hash)) toFill.shift();
  const first = toFill.shift();
  if (!first) return;
  const run = [first.part];
  for (let bytes = first.part.length, next = toFill[0]; next; next = toFill[0]) {
    const last = run[run.length - 1]!;
    if (next.url !== first.url || next.part.offset !== last.offset + last.length || onDisk.has(next.part.hash) || bytes + next.part.length > FILL_RUN) break;
    run.push(toFill.shift()!.part);
    bytes += next.part.length;
  }
  filling++;
  if (disk) {
    const got = await fetchRun(first.url, run, new AbortController().signal).catch(() => null);
    for (let k = 0; got?.data && k < run.length; k++) {
      const p = run[k]!;
      if (await open(got.data[k]!, p, new Uint8Array(p.inflated ?? p.length))) await toDisk(p.hash, got.data[k]!);
    }
  }
  filling--;
  report();
  void fill();
}
/** A made-up link for trying things by hand: milliseconds of delay, kilobytes a second, and failures in a hundred. */
let net: number[] = [];

function keep(hash: string, data: Bytes): void {
  if (kept.has(hash)) return;
  kept.set(hash, data);
  keptBytes += data.length;
  trim();
}

function trim(): void {
  for (const old of kept.keys()) {
    if (keptBytes <= (disk ? KEEP_DISK : keepMemory)) break;
    unkeep(old);
  }
}

function unkeep(hash: string): void {
  keptBytes -= kept.get(hash)?.length ?? 0;
  kept.delete(hash);
}

/** A part kept in memory, which is then the latest used, or undefined. */
function fromMemory(hash: string): Bytes | undefined {
  const data = kept.get(hash);
  if (data) {
    kept.delete(hash);
    kept.set(hash, data);
  }
  return data;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const hashOf = async (data: Bytes): Promise<string> => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)).subarray(0, 8));
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Writes a part's bytes into `into` from what is stored, inflated and its filter undone where it is stored deflated. False where they do not come back to its hash. */
async function open(stored: Bytes, part: AssetPart, into: Bytes): Promise<boolean> {
  if (part.inflated === undefined) {
    if (stored.length !== part.length) return false;
    into.set(stored);
  } else {
    try {
      const inflate = new DecompressionStream("deflate-raw");
      const writer = inflate.writable.getWriter();
      writer.write(stored).catch(() => {});
      writer.close().catch(() => {});
      if (!unfilterPart(new Uint8Array(await new Response(inflate.readable).arrayBuffer()), part.inflated, into)) return false;
    } catch {
      return false;
    }
  }
  return part.hash === "" || (await hashOf(into)) === part.hash;
}

type Run = { data: Bytes[] | null; fail: number; fetched: number; status: number };

/**
 * Fetches parts that follow one another in a file with one range. Each comes back as stored, a view of the one answer.
 * Never through the browser's cache: Chrome sends the ranges of one file that go through it one at a time, and the
 * worker keeps its own copy.
 */
async function fetchRun(url: string, parts: readonly AssetPart[], signal: AbortSignal): Promise<Run> {
  const [delay = 0, rate = 0, loss = 0] = net;
  if (delay > 0) await wait(delay);
  if (Math.random() * 100 < loss) return { data: null, fail: FAIL_NET, fetched: 0, status: 0 };
  const from = parts[0]!.offset;
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const res = await fetch(url, { headers: { range: `bytes=${from}-${from + length - 1}` }, signal, cache: "no-store" });
  // A server that does not do ranges would send the whole file for each part.
  if (res.status === 416 || res.status === 200) {
    void res.body?.cancel().catch(() => {});
    return { data: null, fail: FAIL_RANGE, fetched: 0, status: res.status };
  }
  if (!res.ok) return { data: null, fail: FAIL_NET, fetched: 0, status: res.status };
  const data = new Uint8Array(await res.arrayBuffer());
  if (rate > 0) await wait(data.length / rate);
  if (data.length !== length) return { data: null, fail: FAIL_NET, fetched: data.length, status: res.status };
  return { data: parts.map((p) => data.subarray(p.offset - from, p.offset - from + p.length)), fail: 0, fetched: data.length, status: res.status };
}

/**
 * Answers a request: each part from memory, else from the disk, else from the network, the parts still wanted that
 * follow one another fetched with one range. The network is asked before what was kept is opened, and every part is
 * opened and checked into the one answer before it is handed over.
 */
async function answer(a: Ask): Promise<void> {
  const stop = new AbortController();
  under.set(a.slot, stop);
  const n = a.parts.length;
  const at = new Array<number>(n + 1);
  at[0] = 0;
  for (let k = 0; k < n; k++) at[k + 1] = at[k]! + (a.parts[k]!.inflated ?? a.parts[k]!.length);
  const data = new Uint8Array(at[n]!);
  const into = (k: number): Bytes => data.subarray(at[k]!, at[k + 1]!);
  const memory = a.fresh ? [] : a.parts.map((p) => fromMemory(p.hash));
  const stored = a.fresh ? new Array<Bytes | null>(n).fill(null) : await Promise.all(a.parts.map((p, k) => memory[k] ?? fromDisk(p.hash)));
  let cached = 0;
  let fetched = 0;
  let fail = 0;
  let status = 0;
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  /** Fetches the parts not yet had, each run of them with one range, and opens each into the answer. */
  const network = async (have: readonly boolean[]): Promise<void> => {
    const runs: { k: number; got: Promise<Run> }[] = [];
    for (let k = 0; k < n; ) {
      if (have[k]) {
        k++;
        continue;
      }
      let end = k + 1;
      while (end < n && !have[end] && a.parts[end]!.offset === a.parts[end - 1]!.offset + a.parts[end - 1]!.length) end++;
      runs.push({ k, got: fetchRun(a.url, a.parts.slice(k, end), stop.signal).catch(() => ({ data: null, fail: FAIL_NET, fetched: 0, status: 0 })) });
      k = end;
    }
    for (const run of runs) {
      const got = await run.got;
      fetched += got.fetched;
      if (fail !== 0) continue;
      fail = got.fail;
      status = got.status;
      for (let j = 0; got.data && j < got.data.length && fail === 0; j++) {
        const k = run.k + j;
        if (!(await open(got.data[j]!, a.parts[k]!, into(k)))) fail = FAIL_HASH;
        else {
          keep(a.parts[k]!.hash, got.data[j]!);
          void toDisk(a.parts[k]!.hash, got.data[j]!);
        }
      }
    }
  };
  try {
    const first = network(stored.map((s) => s !== null));
    const good = stored.map((s) => s === null);
    for (let k = 0; k < n; k++) {
      const s = stored[k];
      if (!s) continue;
      good[k] = await open(s, a.parts[k]!, into(k));
      if (good[k]) {
        cached += s.length;
        if (!memory[k]) keep(a.parts[k]!.hash, s);
      } else {
        // Bytes kept that do not come back are no use, and are fetched afresh.
        unkeep(a.parts[k]!.hash);
        void dropFromDisk(a.parts[k]!.hash);
      }
    }
    await first;
    if (fail === 0 && good.some((g) => !g)) await network(good);
  } catch {
    fail = FAIL_NET;
  }
  clearTimeout(timer);
  // Cancelled: the page no longer wants it and must not be told of it.
  if (under.get(a.slot) !== stop) return;
  under.delete(a.slot);
  if (fail !== 0) scope.postMessage({ slot: a.slot, generation: a.generation, data: null, fail, fetched, cached, status });
  else scope.postMessage({ slot: a.slot, generation: a.generation, data, fail: 0, fetched, cached }, [data.buffer]);
}

scope.onmessage = (e) => {
  const m = e.data as { ask?: Ask; cancel?: number; net?: number[]; open?: { keep: number; touch: boolean }; fill?: { url: string; part: AssetPart }[] };
  if (m.net) net = m.net;
  if (m.open) openDisk(m.open.keep, m.open.touch);
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
