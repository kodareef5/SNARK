// A map's head and parts as files of their own beside it (shared/world/mapfile.ts), each with its copies for the wire,
// written once so the server compresses nothing: Brotli, and gzip for a browser that takes no Brotli (on plain http).
// What one player waits for is held to budgets here: each part's size, and the heaviest first frame on the map.

import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { partsFolder, partsOf, type PartKind } from "../../shared/world/mapfile.ts";

/**
 * Brotli quality and gzip level of the copies. An everyday build's take a few seconds a city; a release build's are the
 * tightest a map ships with and take about 25 s on Miami, made side by side, its landmarks' definitions the longest.
 */
export const LEVELS = { everyday: { brotli: 9, gzip: 6 }, release: { brotli: 11, gzip: 9 } } as const;

/**
 * Brotli bytes a part may be, by its kind: there to catch a mistake, with room over the most the cities measure (an everyday
 * build's, 2026-11-17: Miami's head 14 KB, its landmarks' definitions 1.5 MB, an overview 0.41 MB, a sector's ground 176 KB
 * and its statics 169 KB). The budgets hold a release build's copies. An everyday build's are larger and are held to the
 * same, so a map that passes one passes as a release.
 */
export const PART_BUDGETS: Readonly<Record<PartKind | "head", number>> = { head: 1 << 20, land: 4 << 20, overview: 2 << 20, ground: 1 << 20, statics: 1 << 20 };
/**
 * Brotli bytes of the heaviest first frame on a map: its head, its landmarks' definitions, its heaviest overview, and the
 * ground and statics of the four sectors meeting at the heaviest corner. A player waits for no more wherever it stands:
 * 3.1 MB on Miami (1.3 s at 20 Mbit/s, the phone link the asset bench takes).
 */
export const FIRST_FRAME_BUDGET = 8 << 20;

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

/** What a player waits for before the first frame where it waits longest: the parts', in Brotli and gzip bytes. */
export interface FirstFrame {
  readonly br: number;
  readonly gz: number;
  /** The heaviest overview's square, and the column and row of the north-west sector of the heaviest four. */
  readonly overview: readonly [number, number];
  readonly corner: readonly [number, number];
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
  const parts = await Promise.all(
    partsOf(file).map(async ({ name, part, bytes }): Promise<PackedPart> => {
      const params = { [constants.BROTLI_PARAM_QUALITY]: level.brotli, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length };
      const [b, z] = await Promise.all([br(bytes, { params }), gz(bytes, { level: level.gzip })]);
      return { name, kind: part?.kind ?? "head", col: part?.col ?? 0, row: part?.row ?? 0, bytes, br: b, gz: z };
    }),
  );
  return { parts, first: firstFrame(parts), release };
}

/** The heaviest first frame of a map's parts: the head, the land, the heaviest overview, and the heaviest four sectors at a corner. */
export function firstFrame(parts: readonly PackedPart[]): FirstFrame {
  const heaviest = (kind: PackedPart["kind"]): PackedPart | null => parts.filter((p) => p.kind === kind).reduce<PackedPart | null>((a, p) => (!a || p.br.length > a.br.length ? p : a), null);
  const [head, land, overview] = [heaviest("head"), heaviest("land"), heaviest("overview")];
  const sector = new Map<string, [number, number]>();
  for (const p of parts) {
    if (p.kind !== "ground" && p.kind !== "statics") continue;
    const [br, gz] = sector.get(`${p.col} ${p.row}`) ?? [0, 0];
    sector.set(`${p.col} ${p.row}`, [br + p.br.length, gz + p.gz.length]);
  }
  const cols = parts.filter((p) => p.kind === "ground").map((p) => p.col);
  const rows = parts.filter((p) => p.kind === "ground").map((p) => p.row);
  let best = { br: 0, gz: 0, corner: [0, 0] as readonly [number, number] };
  for (let col = Math.min(...cols) - 1; col <= Math.max(...cols); col++) {
    for (let row = Math.min(...rows) - 1; row <= Math.max(...rows); row++) {
      const four = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([c, r]) => sector.get(`${col + c!} ${row + r!}`) ?? [0, 0]);
      const br = four.reduce((n, s) => n + s[0], 0);
      if (br > best.br) best = { br, gz: four.reduce((n, s) => n + s[1], 0), corner: [col, row] };
    }
  }
  const sum = (encoding: "br" | "gz"): number => [head, land, overview].reduce((n, p) => n + (p?.[encoding].length ?? 0), best[encoding]);
  return { br: sum("br"), gz: sum("gz"), overview: [overview?.col ?? 0, overview?.row ?? 0], corner: best.corner };
}

const mb = (bytes: number): string => (bytes / 1e6).toFixed(2);
const kb = (bytes: number): string => (bytes / 1e3).toFixed(0);

/** What a client fetches of a map, in lines: its parts by kind (how many, the median and the most, all of them) and its heaviest first frame. */
export function partsTable(packed: Packed): string[] {
  const lines = [`on the wire, Brotli and gzip${packed.release ? "" : " (an everyday build's)"}: kind, count, median and most KB, all MB`];
  for (const kind of ["head", "land", "overview", "ground", "statics"] as const) {
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
  lines.push(`the heaviest first frame: ${mb(f.br)} MB of Brotli, ${mb(f.gz)} of gzip, at overview ${f.overview[0]}-${f.overview[1]} and sectors ${f.corner[0]}-${f.corner[1]} to ${f.corner[0] + 1}-${f.corner[1] + 1}`);
  return lines;
}

/** Throws, saying which, if a part or the heaviest first frame of `packed` is over its budget. */
export function checkBudgets(packed: Packed): void {
  const which = packed.release ? "" : " (an everyday build's copies, which are larger than the release build's the budget holds: --release writes those)";
  for (const p of packed.parts) {
    if (p.br.length > PART_BUDGETS[p.kind]) throw new Error(`map: its part ${p.name} is ${mb(p.br.length)} MB on the wire, over the ${mb(PART_BUDGETS[p.kind])} MB a part of its kind may be in tools/map/pack.ts${which}`);
  }
  const f = packed.first;
  if (f.br > FIRST_FRAME_BUDGET) throw new Error(`map: a client where sectors ${f.corner[0]}-${f.corner[1]} to ${f.corner[0] + 1}-${f.corner[1] + 1} meet waits for ${mb(f.br)} MB of it before it draws, over the ${mb(FIRST_FRAME_BUDGET)} MB of tools/map/pack.ts${which}`);
}

/**
 * Writes the map at `path`, and beside it the folder of its head's and parts' files with their copies, a release build's if
 * `release`. Takes away any file of that folder that is not one of them. Throws over a budget, before writing anything.
 */
export async function writeMapFile(path: string, file: Uint8Array, release = false): Promise<Packed> {
  const packed = await packMap(file, release);
  checkBudgets(packed);
  const folder = partsFolder(path);
  mkdirSync(folder, { recursive: true });
  const names = new Set(packed.parts.flatMap((p) => [p.name, `${p.name}.br`, `${p.name}.gz`]));
  for (const name of readdirSync(folder)) if (!names.has(name)) rmSync(join(folder, name), { recursive: true });
  for (const p of packed.parts) {
    writeFileSync(join(folder, `${p.name}.br`), p.br);
    writeFileSync(join(folder, `${p.name}.gz`), p.gz);
    writeFileSync(join(folder, p.name), p.bytes);
  }
  // The whole map's copies of the version before parts.
  const whole = new RegExp(`^${basename(path).replace(/\./g, "\\.")}\\.[0-9a-f]{8}\\.(br|gz)$`);
  for (const name of readdirSync(dirname(path))) if (whole.test(name)) rmSync(join(dirname(path), name));
  writeFileSync(`${path}.tmp`, file);
  renameSync(`${path}.tmp`, path);
  return packed;
}
