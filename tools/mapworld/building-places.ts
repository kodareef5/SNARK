// Whether a piece's tile and storey, worked out from its place alone, are the ones its layout placed it at:
//
//   bun tools/mapworld/building-places.ts <map.snmap> [known.bin] [--json out.json]
//
// The map's buildings section gives a piece's building by its chunk and slot, and the building's frame; the piece's tile
// and storey then follow from where it stands (shared/world/buildings.ts placeOf, tileOf, storeyAt). The build keeps
// beside the map what its layouts had in hand when they placed each piece (var/maps/<name>/known.bin). This holds the
// two against each other, by the part a piece plays, and prints ten of those that disagree.
//
// A tile agrees three ways, each looser than the one before: the piece's own tile (tileOf); its tile's middle, edge or
// corner (placeOf), as a wall on an edge and a pier on a corner stand; or anywhere under the piece's own box, as a slab
// over four tiles lies. A storey agrees by the piece's origin (storeyAt), or by its foot, as a pier 16 m tall stands on
// the storey its foot is in.

import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { familyOf } from "../../content/breaks/families.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import { STOREY, blankFrame, place, placeOf, storeyAt, tileOf, type Buildings } from "../../shared/world/buildings.ts";
import { parseMap, staticKinds, type MapStatics } from "../../shared/world/mapfile.ts";
import { YAW_UNITS } from "../../shared/coords.ts";
import { decodeKnown, type KnownPlaces } from "./buildings.ts";

/** The parts a piece may play in a building, the kit's families (content/breaks/families.ts) gathered. */
export const PARTS = ["slab", "pier", "wall", "facade module", "shell", "roof", "stairs", "dressing"] as const;
export type Part = (typeof PARTS)[number];

/** The part a piece of content id `kind` plays: a stair by its shape, the rest by its family, and what breaks as nothing is dressing. */
export function partOf(kind: string): Part {
  const shape = kind.split("_")[1] ?? "";
  if (/^(flight|landing|step|ramp\d*)$/.test(shape)) return "stairs";
  const family = familyOf(shape);
  if (family === "slab" || family === "pier" || family === "shell" || family === "roof") return family;
  if (family === "wall" || family === "beam" || family === "bar" || family === "panel") return "wall";
  return family === "none" || family === "interior" ? "dressing" : "facade module";
}

/** A part's count of pieces, and of them those that agree each way. */
export interface PartCount {
  pieces: number;
  /** Pieces a layout placed by a tile; of them, those whose tile agrees by tileOf, by placeOf, and under the piece's box. */
  tiled: number;
  tile: number;
  touch: number;
  under: number;
  /** Pieces whose storey agrees by their origin, and by their foot. */
  storey: number;
  foot: number;
}

export interface Disagreement {
  readonly part: Part;
  readonly building: number;
  readonly name: string;
  readonly kind: string;
  readonly at: readonly [number, number, number];
  /** What the layout knew, and what the place gives: a tile (i, j), in half tiles for the place, and a storey. */
  readonly known: readonly [number, number, number];
  readonly placed: readonly [number, number, number];
  readonly why: string;
}

export interface PlacesReport {
  readonly buildings: number;
  readonly pieces: number;
  /** Pieces whose slot the section gives to no building, though the build knew one. */
  readonly lost: number;
  readonly parts: Record<Part, PartCount>;
  readonly examples: Disagreement[];
}

/**
 * Holds every building's pieces of a map's `statics` to `known`. `examples` of each kind of disagreement are kept, the
 * first met.
 */
export function comparePlaces(statics: MapStatics, buildings: Buildings, known: KnownPlaces, reg: Registry, examples = 10): PlacesReport {
  const parts = Object.fromEntries(PARTS.map((p) => [p, { pieces: 0, tiled: 0, tile: 0, touch: 0, under: 0, storey: 0, foot: 0 }])) as Record<Part, PartCount>;
  const kinds = staticKinds(statics, reg);
  const part = statics.kinds.map(partOf);
  const frame = blankFrame();
  const out: Disagreement[] = [];
  const shown = new Map<string, number>();
  let framed = -1, pieces = 0, lost = 0;
  for (let chunk = 0, row = 0; chunk < known.counts.length; chunk++) {
    for (let slot = 0; slot < known.counts[chunk]!; slot++, row++) {
      const b = buildings.buildingOf(chunk, slot);
      if (b < 0) {
        if (known.i[row]! >= 0) lost++;
        continue;
      }
      if (b !== framed) buildings.frame((framed = b), frame);
      const r = statics.first[chunk]! + slot;
      const [x, y, z] = [statics.x[r]!, statics.y[r]!, statics.z[r]!];
      const c = parts[part[statics.kind[r]!]!];
      c.pieces++;
      pieces++;
      const kind = kinds[statics.kind[r]!]!;
      // Its storey by its origin, and by its foot: the origin of nearly every piece is its box's middle.
      const storey = known.storey[row]!, origin = storeyAt(frame, y), foot = storeyAt(frame, y - reg.halfY[kind]!);
      if (origin === storey) c.storey++;
      if (origin === storey || foot === storey) c.foot++;
      const [i, j] = [known.i[row]!, known.j[row]!];
      let tile = true, why = "";
      if (i >= 0) {
        c.tiled++;
        placeOf(frame, x, z);
        const [hi, hj] = [place.hi, place.hj];
        const own = tileOf(frame, x, z) === j * Math.max(1, frame.cols) + i;
        const touch = Math.abs(hi - (2 * i + 1)) <= 1 && Math.abs(hj - (2 * j + 1)) <= 1;
        // Under its box: the piece's half size along the frame, a quarter turn at a time, reaches the tile.
        const a = (((statics.yaw[r]! - frame.yaw) & (YAW_UNITS - 1)) / YAW_UNITS) * TAU, [ca, sa] = [Math.abs(detCos(a)), Math.abs(detSin(a))];
        const [hu, hv] = [reg.halfX[kind]! * ca + reg.halfZ[kind]! * sa, reg.halfX[kind]! * sa + reg.halfZ[kind]! * ca];
        const [dx, dz] = [x - frame.x, z - frame.z];
        const [u, v] = [dx * frame.c - dz * frame.s, dx * frame.s + dz * frame.c];
        const [tu, tv] = [(i - (frame.cols - 1) / 2) * frame.bay, (j - (frame.rows - 1) / 2) * frame.bay];
        const under = Math.abs(u - tu) <= hu + frame.bay / 2 + 0.5 && Math.abs(v - tv) <= hv + frame.bay / 2 + 0.5;
        if (own) c.tile++;
        if (own || touch) c.touch++;
        if (own || touch || under) c.under++;
        tile = own || touch || under;
        if (!tile) why = `${Math.max(Math.abs(u - tu) - hu, Math.abs(v - tv) - hv).toFixed(1)} m from its tile's middle`;
        if (examples > 0 && (!tile || (origin !== storey && foot !== storey))) {
          const key = `${part[statics.kind[r]!]} ${tile ? "storey" : "tile"}`;
          if ((shown.get(key) ?? 0) < examples) {
            shown.set(key, (shown.get(key) ?? 0) + 1);
            out.push({ part: part[statics.kind[r]!]!, building: buildings.id(b), name: buildings.name(b) ?? buildings.address(b) ?? buildings.kind(b), kind: statics.kinds[statics.kind[r]!]!, at: [x, y, z], known: [i, j, storey], placed: [hi, hj, origin], why: tile ? `its origin is ${((y - frame.base) / STOREY).toFixed(2)} storeys up, its foot ${((y - reg.halfY[kind]! - frame.base) / STOREY).toFixed(2)}` : why });
          }
        }
      }
    }
  }
  return { buildings: buildings.count, pieces, lost, parts, examples: out };
}

const share = (n: number, of: number): string => (of === 0 ? "     -" : `${((100 * n) / of).toFixed(2).padStart(6)}`);

/** The report as lines: a row a part with the shares that disagree, then the examples. */
export function placesLines(r: PlacesReport): string[] {
  const lines = [
    `${r.pieces} pieces of ${r.buildings} buildings; ${r.lost} the build knew a building for and the map does not`,
    "percent that DISAGREE, by part: tile by its own tile, by its middle, edge or corner, and under its box; storey by its origin, and by origin or foot",
    `${"part".padEnd(14)} ${"pieces".padStart(9)} ${"by a tile".padStart(9)}  ${"own".padStart(6)} ${"touch".padStart(6)} ${"under".padStart(6)}  ${"origin".padStart(6)} ${"foot".padStart(6)}`,
  ];
  const sum = { pieces: 0, tiled: 0, tile: 0, touch: 0, under: 0, storey: 0, foot: 0 };
  const row = (name: string, c: PartCount): string => `${name.padEnd(14)} ${String(c.pieces).padStart(9)} ${String(c.tiled).padStart(9)}  ${share(c.tiled - c.tile, c.tiled)} ${share(c.tiled - c.touch, c.tiled)} ${share(c.tiled - c.under, c.tiled)}  ${share(c.pieces - c.storey, c.pieces)} ${share(c.pieces - c.foot, c.pieces)}`;
  for (const p of PARTS) {
    lines.push(row(p, r.parts[p]));
    for (const k of Object.keys(sum) as (keyof PartCount)[]) sum[k] += r.parts[p][k];
  }
  lines.push(row("all", sum));
  for (const kind of ["tile", "storey"]) {
    const of = r.examples.filter((e) => (kind === "tile") === e.why.includes("from its tile"));
    if (of.length === 0) continue;
    lines.push("", `${kind}s that disagree, the first met of each part:`);
    for (const e of of) lines.push(`  ${e.part.padEnd(13)} ${e.kind.replace("core:zruin_", "")} at ${e.at.map((v) => v.toFixed(1)).join(", ")} of ${e.name} (${e.building}): placed at tile ${e.known[0]}, ${e.known[1]} storey ${e.known[2]}; stands at half tiles ${e.placed[0]}, ${e.placed[1]} storey ${e.placed[2]}; ${e.why}`);
  }
  return lines;
}

if (import.meta.main) {
  const words = process.argv.slice(2), json = words.indexOf("--json");
  const [file, beside] = words.filter((w, k) => !w.startsWith("--") && (json < 0 || k !== json + 1));
  if (!file) throw new Error("bun tools/mapworld/building-places.ts <map.snmap> [known.bin] [--json out.json]");
  const map = parseMap(new Uint8Array(readFileSync(file)), false);
  if (!map.buildings) throw new Error(`${file} holds no buildings`);
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error(errors.join("\n"));
  const known = decodeKnown(new Uint8Array(readFileSync(beside ?? `${file.replace(/\.snmap$/, "")}/known.bin`)));
  const report = comparePlaces(map.statics, map.buildings, known, registry, 10);
  for (const line of placesLines(report)) console.log(line);
  if (json >= 0) writeFileSync(words[json + 1]!, `${JSON.stringify(report, null, 1)}\n`);
}
