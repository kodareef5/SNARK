// Builds the pack of small details (core:details): every asset's detail pictures in one atlas, every effect, and every
// creature's cue sheet. A creature's sheet is `cues.json` in its folder; the shared library is core/details/effects.json.
// The layout of both is planning/reference/round9-details-design.md's and assets/source/DETAILS.md's.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { ATLAS_MOST, CELL, FLAT_SHAPES, GROUNDS, OCCASIONS, atlasBytes, effectOf, knownFrom, type DetailEffect, type DetailEntry, type DetailPicture, type DetailSheet, type Occasion, type PackDetails, type SheetSource } from "../../shared/pack/details.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ART, SOURCE, filesUnder } from "../art/source.ts";
import { halvings, readPicture, square, unpack, type Picture } from "./image.ts";
import { readRegions } from "./mask.ts";
import type { SourceDetails } from "./write.ts";

/** Changes when what the build makes of the same files changes, so the pack is made again. */
const VERSION = "details-2";
/** Where the shared library is, under the source tree. */
export const LIBRARY = "core/details";
/** A region with less than this share of a picture's dyed cover is not one of its two. */
const SMALLEST_REGION = 0.01;

const toLinear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

export interface FoundSheet {
  owner: string;
  dir: string;
  file: string;
  sheet: SheetSource;
}

/** The library's sheet first, then every creature's `cues.json`, in path order. */
export function findSheets(source: string = SOURCE): FoundSheet[] {
  if (source === SOURCE && !ART) return [];
  const read = (file: string, owner: string): FoundSheet => {
    try {
      return { owner, dir: dirname(file), file, sheet: JSON.parse(readFileSync(file, "utf8")) as SheetSource };
    } catch (e) {
      throw new Error(`${relative(source, file)}: ${(e as Error).message}`);
    }
  };
  const out: FoundSheet[] = [];
  const library = join(source, LIBRARY, "effects.json");
  if (existsSync(library)) out.push(read(library, LIBRARY.replace("/", ":")));
  for (const file of filesUnder(source, "cues.json")) {
    const dir = dirname(file);
    out.push(read(file, `${relative(source, dir).split(sep)[0]}:${basename(dir)}`));
  }
  return out;
}

/** Every file a build of the details reads, in the order it reads them. */
function inputFiles(sheets: readonly FoundSheet[]): string[] {
  const files: string[] = [];
  for (const s of sheets) {
    files.push(s.file);
    for (const p of Object.values(s.sheet.pictures ?? {})) files.push(join(s.dir, p.file), ...(p.regions ? [join(s.dir, p.regions)] : []));
  }
  return files;
}

/** A hash of every file the details are made from. A pack whose `inputs` differ is older than its sources. */
export function detailInputs(source: string = SOURCE): string {
  const hash = createHash("sha256").update(VERSION);
  for (const file of inputFiles(findSheets(source))) hash.update(relative(source, file)).update(existsSync(file) ? readFileSync(file) : "missing");
  return hash.digest("hex").slice(0, 16);
}

/** A picture as one cell: the shade, the second region's share, the undyed share and alpha, and which regions and grey. */
function cellOf(base: Picture, regions: Picture | null, name: string): { texels: Float32Array; regions: [number, number]; grey: number } {
  const rgba = unpack(base, toLinear);
  const n = base.width * base.height;
  const weights = regions ? readRegions(regions).weights : null;
  if (regions && (regions.width !== base.width || regions.height !== base.height)) throw new Error(`${name}: its regions picture is not the size of its picture`);
  // Which two regions, by cover.
  const cover = new Float64Array(6);
  for (let i = 0; weights && i < n; i++) for (let k = 0; k < 6; k++) cover[k] += weights[i * 6 + k]! * rgba[i * 4 + 3]!;
  const total = cover.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2, 3, 4, 5].filter((k) => cover[k]! > total * SMALLEST_REGION).sort((a, b) => cover[b]! - cover[a]!);
  if (order.length > 2) throw new Error(`${name}: it takes regions ${order.join(", ")}, and a picture may take two`);
  const first = order[0] ?? -1;
  const second = order[1] ?? -1;
  // Premultiplied by alpha, so the mips average what shows.
  const texels = new Float32Array(n * 4);
  let lit = 0;
  let dyed = 0;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]!;
    const shade = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
    const b = second >= 0 ? weights![i * 6 + second]! : 0;
    const undyed = weights ? 1 - [0, 1, 2, 3, 4, 5].reduce((sum, k) => sum + weights[i * 6 + k]!, 0) : 0;
    texels[i * 4] = shade * a;
    texels[i * 4 + 1] = b * a;
    texels[i * 4 + 2] = undyed * a;
    texels[i * 4 + 3] = a;
    lit += shade * a * (1 - undyed);
    dyed += a * (1 - undyed);
  }
  return { texels, regions: [first, second], grey: dyed > 0 && lit > 0 ? Math.round((lit / dyed) * 1e4) / 1e4 : 1 };
}

/** The cell `size` across from a picture's texels, taken down by halvings, back from premultiplied, the shade in sRGB. */
function shrink(texels: Float32Array, side: number, name: string): Float32Array {
  const { data, size } = square(texels, { width: side, height: side }, 4);
  if (size < CELL) throw new Error(`${name}: it is ${side} pixels across, and a detail picture is ${CELL} at least`);
  const levels = halvings(data, size, 4);
  return levels[levels.length - 1 - Math.log2(size / CELL)]!;
}

export interface BuiltDetails {
  details: SourceDetails;
  lines: string[];
}

/** The details of every sheet under `source`, made into what a pack carries. Throws, naming the sheet, on anything wrong. */
export function buildDetails(source: string = SOURCE, packs: ReadonlyMap<string, readonly string[]> = socketsByOwner(source)): BuiltDetails {
  const sheets = findSheets(source);
  const pictures: DetailPicture[] = [];
  const cells: Float32Array[] = [];
  const effects: DetailEffect[] = [];
  const out: DetailSheet[] = [];
  const lines: string[] = [];
  const pictureIndex = new Map<string, number>();
  const effectIndex = new Map<string, number>();
  const library = LIBRARY.replace("/", ":");
  for (const s of sheets) {
    const where = relative(source, s.file);
    for (const [name, p] of Object.entries(s.sheet.pictures ?? {})) {
      const id = `${s.owner}/${name}`;
      const flat = FLAT_SHAPES.indexOf(p.flat as (typeof FLAT_SHAPES)[number]);
      if (flat < 0) throw new Error(`${where}: picture ${name} has flat "${p.flat}", which is one of ${FLAT_SHAPES.join(", ")}`);
      const base = readPicture(join(s.dir, p.file));
      if (base.width !== base.height) throw new Error(`${where}: picture ${name} is ${base.width} by ${base.height}, and a picture is square`);
      const made = cellOf(base, p.regions ? readPicture(join(s.dir, p.regions)) : null, `${where}: picture ${name}`);
      cells.push(shrink(made.texels, base.width, `${where}: picture ${name}`));
      pictureIndex.set(id, pictures.length);
      pictures.push({ id, cell: pictures.length, regions: made.regions, grey: made.grey, flat });
      lines.push(`${id.padEnd(30)} ${base.width} px, regions ${made.regions.filter((r) => r >= 0).join(" and ") || "none"}, grey ${made.grey}`);
    }
    for (const [name, raw] of Object.entries(s.sheet.effects ?? {})) {
      const id = `${s.owner}/${name}`;
      const pictureOf = (n: string): number => pictureIndex.get(`${s.owner}/${n}`) ?? pictureIndex.get(n) ?? pictureIndex.get(`${library}/${n}`) ?? -1;
      effectIndex.set(id, effects.length);
      effects.push(effectOf(id, raw, pictureOf));
    }
  }
  for (const s of sheets) {
    if (!s.sheet.cues) continue;
    const where = relative(source, s.file);
    const sockets = packs.get(s.owner) ?? null;
    const named = soundsOf(s.dir);
    const cues: DetailSheet["cues"] = {};
    for (const [occasion, cue] of Object.entries(s.sheet.cues)) {
      if (!OCCASIONS.includes(occasion as Occasion)) throw new Error(`${where}: there is no occasion "${occasion}"; there are ${OCCASIONS.join(", ")}`);
      for (const s of cue.sounds ?? []) {
        const sound = typeof s === "string" ? s : s.sound;
        if (typeof sound !== "string") throw new Error(`${where}: ${occasion}'s sounds are names, or { "sound": name, "at": ... }`);
        if (named && !named.includes(sound)) throw new Error(`${where}: ${occasion} names the sound "${sound}", which sound/sounds.json does not have`);
      }
      const entries = (cue.effects ?? []).map((e): DetailEntry => {
        const effect = effectIndex.get(`${s.owner}/${e.effect}`) ?? effectIndex.get(e.effect) ?? effectIndex.get(`${library}/${e.effect}`) ?? -1;
        if (effect < 0) throw new Error(`${where}: ${occasion} names the effect "${e.effect}", which neither it nor the library has`);
        const from = e.from ?? "body";
        if (!knownFrom(from)) throw new Error(`${where}: ${occasion} starts an effect from "${from}"`);
        if (sockets && from !== "body" && from !== "hit" && from !== "ground" && from !== "foot" && !sockets.includes(from)) throw new Error(`${where}: ${occasion} starts an effect from the socket "${from}", which the rig does not have (it has ${sockets.join(", ")})`);
        const at = e.at ?? "now";
        if (at !== "now" && at !== "down" && !(typeof at === "number" && at >= 0)) throw new Error(`${where}: ${occasion}'s "at" is now, down or seconds`);
        const entry: DetailEntry = { effect, from, at };
        if (e.count) entry.count = e.count;
        if (e.on) {
          const on = e.on.map((g) => GROUNDS.indexOf(g as (typeof GROUNDS)[number]));
          if (on.some((g) => g < 0)) throw new Error(`${where}: ${occasion}'s "on" names grounds of ${GROUNDS.join(", ")}`);
          entry.on = on;
        }
        return entry;
      });
      cues[occasion as Occasion] = cue.sounds ? { sounds: cue.sounds, effects: entries } : { effects: entries };
    }
    out.push({ owner: s.owner, cues });
    lines.push(`${s.owner.padEnd(30)} answers ${Object.keys(cues).join(", ")}`);
  }
  let side = CELL;
  while ((side / CELL) ** 2 < cells.length) side *= 2;
  if (side > ATLAS_MOST) throw new Error(`the details have ${cells.length} pictures, and the atlas holds ${(ATLAS_MOST / CELL) ** 2}; it is time it moved to the streamed textures`);
  const atlas = atlasOf(cells, side);
  const header: PackDetails = { atlas: { offset: 0, side }, pictures, effects, sheets: out, inputs: detailInputs(source) };
  lines.push(`atlas ${side} px, ${cells.length} of ${(side / CELL) ** 2} cells, ${atlas.length} bytes with its mips`);
  return { details: { header, atlas }, lines };
}

/** The cells laid out row by row, and every mip under them, largest first: shade in sRGB, the shares and alpha as they are. */
function atlasOf(cells: readonly Float32Array[], side: number): Uint8Array {
  const top = new Float32Array(side * side * 4);
  const across = side / CELL;
  cells.forEach((cell, k) => {
    const [cx, cy] = [(k % across) * CELL, Math.floor(k / across) * CELL];
    for (let y = 0; y < CELL; y++) top.set(cell.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((cy + y) * side + cx) * 4);
  });
  const levels = halvings(top, side, 4).reverse();
  const out = new Uint8Array(atlasBytes(side));
  let at = 0;
  for (const level of levels) {
    for (let i = 0; i < level.length; i += 4) {
      const a = level[i + 3]!;
      const un = (v: number): number => (a > 0 ? Math.min(1, v / a) : 0);
      out[at + i] = Math.round(toSrgb(un(level[i]!)) * 255);
      out[at + i + 1] = Math.round(un(level[i + 1]!) * 255);
      out[at + i + 2] = Math.round(un(level[i + 2]!) * 255);
      out[at + i + 3] = Math.round(a * 255);
    }
    at += level.length;
  }
  return out;
}

/** The names of the sounds in `<dir>/sound/sounds.json`, or null where there is none. */
function soundsOf(dir: string): string[] | null {
  const file = join(dir, "sound", "sounds.json");
  if (!existsSync(file)) return null;
  return Object.keys((JSON.parse(readFileSync(file, "utf8")) as { sounds?: Record<string, unknown> }).sounds ?? {});
}

/** Each creature's socket names, from its built pack, by its id. */
function socketsByOwner(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of findSheets(source)) {
    const file = join(s.dir, `${basename(s.dir)}.snpk`);
    if (!existsSync(file)) continue;
    const pack = parsePack(new Uint8Array(readFileSync(file)));
    const rig = pack.header.rigs.find((r) => r.id === s.owner);
    if (rig) out.set(s.owner, (rig.sockets ?? []).map((k) => k.name));
  }
  return out;
}
