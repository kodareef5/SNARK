// A map's head and parts as files of their own beside it (shared/world/mapfile.ts), each with its copies for the wire,
// written once so the server compresses nothing: Brotli, and gzip for a browser that takes no Brotli (on plain http).
// What one player waits for is held to budgets here: each part's size, and the heaviest first frame on the map, by the rule
// the page asks by (client/core/mapload.ts).

import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { firstFrameParts, handOverParts } from "../../client/core/mapload.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { partsFolder, partsOf, readHead, type MapHead, type MapPart, type PartKind } from "../../shared/world/mapfile.ts";

/**
 * Brotli quality and gzip level of the copies. An everyday build's take a few seconds a city; a release build's are the
 * tightest a map ships with and take about 25 s on Miami, made side by side, its landmarks' definitions the longest.
 */
export const LEVELS = { everyday: { brotli: 9, gzip: 6 }, release: { brotli: 11, gzip: 9 } } as const;
/** Parts compressed at once: each lane's encoders hold their state while it works, and no more lanes than cores help. */
export const PACK_LANES = Math.max(2, Math.min(8, availableParallelism()));

/**
 * Brotli bytes a part may be, by its kind: there to catch a mistake, with room over the most the cities measure (release
 * builds of 2026-11-17 at version 8: a head 22 KB and Miami's landmarks' definitions 1.29 MB; an overview 0.59 MB, a
 * sector's ground 220 KB and its statics 220 KB, and an overview's tops 393 KB, Los Angeles's). The budgets hold a release
 * build's copies. An everyday build's are 16 to 20% larger and are held to the same, so a map that passes one passes as a
 * release. The tops are not waited for and count in no first frame.
 */
export const PART_BUDGETS: Readonly<Record<PartKind | "head", number>> = { head: 1 << 20, land: 4 << 20, overview: 2 << 20, ground: 1 << 20, statics: 1 << 20, tops: 1 << 20, road: 256 << 10, streets: 256 << 10, buildings: 512 << 10 };
/**
 * Brotli bytes of the heaviest first frame on a map: its head and the parts the page's first frame waits for where it
 * waits longest (client/core/mapload.ts firstFrameParts): the landmarks' definitions, the ground of the sectors within
 * reach of the body, four where they meet, and the overviews within FIRST_REACH of it, four where they meet. While the
 * first frame waited for every overview, a 16 km map waited for 8.00 MB (San Francisco) to 11.33 (Los Angeles), and this
 * was 12 MiB (D812). Since the head holds the whole map coarse (map version 10), an everyday build of Miami waits for
 * 4.5 MB at most and 3.3 on average over its places (1.8 and 1.3 s at 20 Mbit/s, the phone link the asset bench takes).
 */
export const FIRST_FRAME_BUDGET = 6 << 20;

/** A part, or the head, as written beside the map, and its copies. */
export interface PackedPart {
  readonly name: string;
  readonly kind: PartKind | "head";
  /** Its square's column and row on the lattice; 0 for the head and the land. */
  readonly col: number;
  readonly row: number;
  readonly bytes: Uint8Array;
  readonly br: Buffer;
  readonly gz: Buffer;
}

/**
 * What a player waits for before the first frame where it waits longest, in Brotli and gzip bytes, and where that is: a
 * place in metres and the sectors whose ground it waits for there; and what it waits for there until the map's statics are
 * all in hand (client/core/mapload.ts handOverParts), which the far city waits for.
 */
export interface FirstFrame {
  readonly br: number;
  readonly gz: number;
  readonly at: readonly [number, number];
  readonly sectors: readonly string[];
  readonly city: { readonly br: number; readonly gz: number };
}

export interface Packed {
  readonly parts: readonly PackedPart[];
  readonly first: FirstFrame;
  readonly release: boolean;
}

/** Bytes of every part's copy in `encoding`. */
export const wireBytes = (packed: Packed, encoding: "br" | "gz"): number => packed.parts.reduce((n, p) => n + p[encoding].length, 0);

/** The copies of every part of a map's file, the Brotli and the gzip made side by side on threads of their own. */
export async function packMap(file: Uint8Array, release = false): Promise<Packed> {
  const level = release ? LEVELS.release : LEVELS.everyday;
  const [br, gz] = [promisify(brotliCompress), promisify(gzip)];
  const pack = async ({ name, part, bytes }: ReturnType<typeof partsOf>[number]): Promise<PackedPart> => {
    const params = { [constants.BROTLI_PARAM_QUALITY]: level.brotli, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length };
    const [b, z] = await Promise.all([br(bytes, { params }), gz(bytes, { level: level.gzip })]);
    return { name, kind: part?.kind ?? "head", col: part?.col ?? 0, row: part?.row ?? 0, bytes, br: b, gz: z };
  };
  // A few parts at a time, each its own encoders' memory: asked for all at once, a big map's 500 to 630 parts each
  // held a Brotli encoder's state together. The parts keep the map's order, so the copies are the same bytes.
  const list = partsOf(file);
  const parts: PackedPart[] = new Array(list.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (let k = next++; k < list.length; k = next++) parts[k] = await pack(list[k]!);
  };
  await Promise.all(Array.from({ length: Math.min(PACK_LANES, list.length) }, lane));
  return { parts, first: firstFrame(parts, readHead(file, false)), release };
}

/**
 * The heaviest first frame of a map's parts, by the rule the page asks by: over every place a body can stand, the head and
 * the parts firstFrameParts names there. Every square that rule reaches has its edges on the chunks' lattice, and a place
 * in a chunk reaches no square that one of the chunk's corners does not: those corners are the places weighed.
 */
export function firstFrame(parts: readonly PackedPart[], head: MapHead): FirstFrame {
  const by = new Map(parts.map((p) => [p.name, p]));
  const sum = (of: readonly MapPart[], encoding: "br" | "gz"): number => of.reduce((n, p) => n + by.get(p.name)![encoding].length, by.get(head.name)![encoding].length);
  const { chunksX, chunksZ } = head.dims;
  let best = { br: -1, at: [0, 0] as readonly [number, number], of: [] as MapPart[] };
  for (let z = 0; z <= chunksZ * CHUNK_SIZE; z += CHUNK_SIZE) {
    for (let x = 0; x <= chunksX * CHUNK_SIZE; x += CHUNK_SIZE) {
      const of = firstFrameParts(head, x, z);
      const br = sum(of, "br");
      if (br > best.br) best = { br, at: [x, z], of };
    }
  }
  const city = handOverParts(head);
  return { br: best.br, gz: sum(best.of, "gz"), at: best.at, sectors: best.of.filter((p) => p.kind === "ground").map((p) => `${p.col}-${p.row}`), city: { br: sum(city, "br"), gz: sum(city, "gz") } };
}

const mb = (bytes: number): string => (bytes / 1e6).toFixed(2);
const kb = (bytes: number): string => (bytes / 1e3).toFixed(0);

/** What a client fetches of a map, in lines: its parts by kind (how many, the median and the most, all of them) and its heaviest first frame. */
export function partsTable(packed: Packed): string[] {
  const lines = [`on the wire, Brotli and gzip${packed.release ? "" : " (an everyday build's)"}: kind, count, median and most KB, all MB`];
  for (const kind of ["head", "land", "overview", "ground", "statics", "tops", "road", "streets", "buildings"] as const) {
    const of = packed.parts.filter((p) => p.kind === kind);
    if (of.length === 0) continue;
    const cell = (encoding: "br" | "gz"): string => {
      const sizes = of.map((p) => p[encoding].length).sort((a, b) => a - b);
      return `${kb(sizes[(sizes.length - 1) >> 1]!)} ${kb(sizes.at(-1)!)} ${mb(sizes.reduce((n, s) => n + s, 0))}`;
    };
    lines.push(`  ${kind} ${of.length}: ${cell("br")} | ${cell("gz")}`);
  }
  const f = packed.first;
  lines.push(`  all ${packed.parts.length}: ${mb(wireBytes(packed, "br"))} | ${mb(wireBytes(packed, "gz"))}`);
  lines.push(`the heaviest first frame: ${mb(f.br)} MB of Brotli, ${mb(f.gz)} of gzip, at ${f.at[0]}, ${f.at[1]} m, with the ground of sectors ${f.sectors.join(" ")}`);
  lines.push(`  there, until the map's statics are all in hand: ${mb(f.city.br)} MB of Brotli, ${mb(f.city.gz)} of gzip`);
  return lines;
}

/** Throws, saying which, if a part or the heaviest first frame of `packed` is over its budget. */
export function checkBudgets(packed: Packed): void {
  const which = packed.release ? "" : " (an everyday build's copies, which are larger than the release build's the budget holds: --release writes those)";
  for (const p of packed.parts) {
    if (p.br.length > PART_BUDGETS[p.kind]) throw new Error(`map: its part ${p.name} is ${mb(p.br.length)} MB on the wire, over the ${mb(PART_BUDGETS[p.kind])} MB a part of its kind may be in tools/map/pack.ts${which}`);
  }
  const f = packed.first;
  if (f.br > FIRST_FRAME_BUDGET) throw new Error(`map: a client at ${f.at[0]}, ${f.at[1]} m waits for ${mb(f.br)} MB of it before it draws, over the ${mb(FIRST_FRAME_BUDGET)} MB of tools/map/pack.ts${which}`);
}

/** Writes `bytes` to `path` whole: a reader has the file as it was or as it is, never half of it. */
function writeWhole(path: string, bytes: Uint8Array): void {
  writeFileSync(`${path}.tmp`, bytes);
  renameSync(`${path}.tmp`, path);
}

/**
 * Writes the map at `path`, and beside it the folder of its head's and parts' files with their copies, a release build's if
 * `release`. Takes away any file of that folder that is not one of them. Throws over a budget, before writing anything.
 * Each file is replaced whole, the map last, so a server still running on the map before (server/main.ts mapRoutes) holds
 * that file open and cuts from it the parts that were taken away.
 */
export async function writeMapFile(path: string, file: Uint8Array, release = false): Promise<Packed> {
  const packed = await packMap(file, release);
  checkBudgets(packed);
  const folder = partsFolder(path);
  mkdirSync(folder, { recursive: true });
  const names = new Set(packed.parts.flatMap((p) => [p.name, `${p.name}.br`, `${p.name}.gz`]));
  for (const name of readdirSync(folder)) if (!names.has(name)) rmSync(join(folder, name), { recursive: true });
  for (const p of packed.parts) {
    writeWhole(join(folder, `${p.name}.br`), p.br);
    writeWhole(join(folder, `${p.name}.gz`), p.gz);
    writeWhole(join(folder, p.name), p.bytes);
  }
  // The whole map's copies of the version before parts.
  const whole = new RegExp(`^${basename(path).replace(/\./g, "\\.")}\\.[0-9a-f]{8}\\.(br|gz)$`);
  for (const name of readdirSync(dirname(path))) if (whole.test(name)) rmSync(join(dirname(path), name));
  writeWhole(path, file);
  return packed;
}
