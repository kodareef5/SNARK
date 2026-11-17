// What the page fetches whole as it starts. A request that fails says which it was and what the server answered, not
// a parser's complaint about the answer.

import type { Def } from "../../shared/content/defs.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { soundFault, type ManifestSound } from "../../shared/pack/sound.ts";
import { joinParts, joinStatics, partSteps, readHead, readPart, type MapContent, type MapFile, type MapHead, type MapPart, type MapStatics, type StaticsPiece } from "../../shared/world/mapfile.ts";

export interface Answer {
  ok: boolean;
  status: number;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Get = (url: string) => Promise<Answer>;

/** An answer the server gave with a success status, or an error naming the request and how it failed. */
async function answer(get: Get, url: string): Promise<Answer> {
  let res: Answer;
  try {
    res = await get(url);
  } catch (e) {
    throw new Error(`${url}: no answer (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new Error(`${url}: the server answered ${res.status}: ${JSON.stringify((await res.text().catch(() => "")).slice(0, 60))}`);
  return res;
}

export async function fetchText(get: Get, url: string): Promise<string> {
  return (await answer(get, url)).text();
}

export async function fetchBytes(get: Get, url: string): Promise<ArrayBuffer> {
  return (await answer(get, url)).arrayBuffer();
}

/** Map parts fetched at once: a few, so that the page's other files are not queued behind them on a link of six connections. */
const PARTS_AT_ONCE = 4;

/** `work` on each of `items`, at most `n` at once, taken in their order; its results in that order. */
async function inTurn<T, R>(items: readonly T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let k = next++; k < items.length; k = next++) out[k] = await work(items[k]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

/** A map's head (shared/world/mapfile.ts) from its url, and the url each of its parts is fetched by, beside it. */
async function fetchHead(get: Get, url: string): Promise<{ head: MapHead; bytes: Uint8Array; at: (part: MapPart) => string }> {
  const bytes = new Uint8Array(await fetchBytes(get, url));
  const head = within(url, () => readHead(bytes));
  return { head, bytes, at: (part) => url.slice(0, url.lastIndexOf("/") + 1) + part.name };
}

/** `read`, its error named for the request whose answer it read. */
function within<T>(url: string, read: () => T): T {
  try {
    return read();
  } catch (e) {
    throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A map's sectors' statics as fetched, for `readStatics`. */
export interface FetchedStatics {
  readonly head: MapHead;
  readonly parts: readonly { readonly part: MapPart; readonly bytes: Uint8Array }[];
}

/**
 * A map as a page fetches it (shared/world/mapfile.ts): its head, then its landmarks' definitions, overviews and sectors'
 * ground, a few at once and each read as it comes, which make the map with no statics: all a client needs to draw. Then its
 * sectors' statics, which `rest` brings once they are all in. Each part is checked against the hash its head names.
 */
export async function fetchMap(get: Get, url: string): Promise<{ ground: MapFile; rest: Promise<FetchedStatics> }> {
  const { head, at } = await fetchHead(get, url);
  const fetched = async (part: MapPart): Promise<Uint8Array> => new Uint8Array(await fetchBytes(get, at(part)));
  const pieces = await inTurn(head.parts.filter((p) => p.kind !== "statics"), PARTS_AT_ONCE, async (p) => readPart(head, p, await fetched(p)));
  const ground = joinParts(head, pieces, false);
  const rest = inTurn(head.parts.filter((p) => p.kind === "statics"), PARTS_AT_ONCE, async (part) => ({ part, bytes: await fetched(part) }));
  return { ground, rest: rest.then((parts) => ({ head, parts })) };
}

/**
 * The statics of a fetched map, each sector's read and then set in its chunks' rows a step at a time with `pause` between,
 * so frames go on.
 */
export async function readStatics(rest: Promise<FetchedStatics>, pause: () => Promise<void>): Promise<MapStatics> {
  const { head, parts } = await rest;
  const pieces: StaticsPiece[] = [];
  for (const { part, bytes } of parts) {
    const steps = partSteps(head, part, bytes);
    let step = steps.next();
    for (; !step.done; step = steps.next()) await pause();
    pieces.push(step.value as StaticsPiece);
  }
  const steps = joinStatics(head, pieces, false);
  let step = steps.next();
  for (; !step.done; step = steps.next()) await pause();
  return step.value;
}

/** A map's whole file, as a program that reads one fetches it: its head and every part, put back together in their order. */
export async function fetchMapFile(get: Get, url: string): Promise<Uint8Array> {
  const { head, bytes, at } = await fetchHead(get, url);
  const file = new Uint8Array(head.parts.reduce((n, p) => n + p.length, head.bytes));
  file.set(bytes.subarray(0, head.bytes));
  await inTurn(head.parts, PARTS_AT_ONCE, async (p) => {
    const part = new Uint8Array(await fetchBytes(get, at(p)));
    if (part.length !== p.length) throw new Error(`${at(p)}: the part is ${part.length} bytes, and its head says ${p.length}`);
    file.set(part, p.at);
  });
  return file;
}

/** The two ends of a page's MessageChannel, as nextTask uses them. */
export interface TaskChannel {
  port1: { onmessage: ((event: never) => void) | null };
  port2: { postMessage(message: null): void };
}

/**
 * A pause until the page's next task, by a message to itself. A timer set from a timer waits at least 4 ms once five are
 * nested, which a map's hundred or more steps would add up to.
 */
export function nextTask(channel: TaskChannel): () => Promise<void> {
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  return () =>
    new Promise((go) => {
      waiting.push(go);
      channel.port2.postMessage(null);
    });
}

/** The content, a file of its own beside the script, compiled. */
export async function fetchContent(get: Get, url: string): Promise<Registry> {
  const { registry, errors } = compileContent((await fetchJson(get, url)) as Def[]);
  if (!registry) throw new Error(`${url}: ${errors.join("; ")}`);
  return registry;
}

/** The sounds' rows into the manifest once they come, where it names a file of them that holds what its files can. Resolves to why it holds none, or "". */
export function fetchSounds(get: Get, manifest: Manifest): Promise<string> {
  if (!manifest.soundRows) return Promise.resolve("");
  return fetchJson(get, `assets/${manifest.soundRows}`).then(
    (rows) => {
      const fault = soundFault(rows as ManifestSound[], manifest.files);
      if (fault === "") manifest.sounds = rows as ManifestSound[];
      return fault;
    },
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
}

export async function fetchJson(get: Get, url: string): Promise<unknown> {
  const res = await answer(get, url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url}: the server answered ${res.status} with what is not JSON: ${JSON.stringify(text.slice(0, 60))}`);
  }
}

/**
 * The core's files with those of the map's landmarks after them, each fetched as the core's are (shared/pack/join.ts), and
 * the content with their definitions.
 */
export async function withLandmarks(get: Get, land: MapContent | undefined, core: Registry, manifest: Manifest, boot: Pack): Promise<{ reg: Registry; manifest: Manifest; pack: Pack }> {
  let joined = { manifest, boot };
  for (const { name } of land?.landmarks ?? []) {
    const m = parseManifest(await fetchText(get, `assets/landmarks/${name}.json`));
    joined = joinLandmark(joined, { manifest: m, boot: parsePack(new Uint8Array(await fetchBytes(get, `assets/landmarks/${m.files[m.boot]!.name}`))) }, "landmarks");
  }
  return { reg: withContent(core, land?.defs ?? []), manifest: joined.manifest, pack: joined.boot };
}
