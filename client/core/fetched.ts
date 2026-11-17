// What the page fetches whole as it starts. A request that fails says which it was and what the server answered, not
// a parser's complaint about the answer.

import type { Def } from "../../shared/content/defs.ts";
import { compileContent, withContent, type Registry } from "../../shared/content/registry.ts";
import type { MapDims } from "../../shared/coords.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { soundFault, type ManifestSound } from "../../shared/pack/sound.ts";
import { groundBytes, staticsSteps, type MapContent, type MapStatics } from "../../shared/world/mapfile.ts";

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

/**
 * A map file as it arrives (shared/world/mapfile.ts): its ground once every byte before the statics is in, which is all a
 * client needs to draw, and the rest once the answer ends.
 */
export async function fetchMap(get: Get, url: string): Promise<{ ground: Uint8Array; rest: Promise<Uint8Array> }> {
  const reader = (await answer(get, url)).body!.getReader();
  let held: Uint8Array = new Uint8Array(0);
  /** Fills `out` from `at` with what comes next, and says how far it got before the answer ended. */
  const fill = async (out: Uint8Array, at = 0): Promise<number> => {
    for (let part = held; ; ) {
      const k = Math.min(out.length - at, part.length);
      out.set(part.subarray(0, k), at);
      held = part.subarray(k);
      at += k;
      if (at === out.length) return at;
      const next = await reader.read();
      if (next.done || !next.value) return at;
      part = next.value;
    }
  };
  const cut = (): Error => new Error(`${url}: the answer ended before the map did`);
  const head = new Uint8Array(16);
  if ((await fill(head)) < head.length) throw cut();
  const ground = new Uint8Array(Math.max(head.length, groundBytes(head)));
  ground.set(head);
  if ((await fill(ground, head.length)) < ground.length) throw cut();
  const rest = (async (): Promise<Uint8Array> => {
    const tag = new Uint8Array(8);
    const got = await fill(tag);
    if (got === 0) return tag.subarray(0, 0);
    const all = new Uint8Array(8 + (got === 8 ? new DataView(tag.buffer).getUint32(4, true) : 0));
    all.set(tag);
    if (got < 8 || (await fill(all, 8)) < all.length) throw cut();
    return all;
  })();
  return { ground, rest };
}

/** The statics of a map of `dims` from the rest of its file, read a step at a time with `pause` between, so frames go on. */
export async function readStatics(rest: Promise<Uint8Array>, dims: MapDims, pause: () => Promise<void>): Promise<MapStatics> {
  const steps = staticsSteps(await rest, dims, false);
  let step = steps.next();
  for (; !step.done; step = steps.next()) await pause();
  return step.value;
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
