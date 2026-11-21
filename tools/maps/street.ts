// One street as a city's build fitted and typed it (planning/workstreams/streets.md), for a person or an agent to look
// at, write an overlay entry for, build again and look at again:
//
//   bun tools/maps/street.ts <city> <way | name | lon,lat> [--size 60] [--scale 10] [--out picture.png]
//   bun tools/maps/street.ts <city> --types          the street types by length, and the rules that named them
//   bun tools/maps/street.ts <city> --unsure [n]     the n stretches (20) the rules were least sure of
//   bun tools/maps/street.ts <city> --sort           sorts the city's overlay files, one entry a line, as the build wants
//
// <city> is a city (its work folder var/mapdata/<city>/current and its map var/maps/<city>.snmap) or a work folder of a
// cut (tools/mapworld/cut.ts) with --map <its .snmap>. A way is an OpenStreetMap way's number; a name is matched in part,
// in any case; a point is the stretch whose middle is nearest. It prints each stretch's record from the build's report
// (reports/<ruins>/streets.json: its data, its fit, the rule that named its type, the overlay entries over it, its section)
// and draws a plan of the first, north up, west on the left:
//
// - left, the ground's 2 m samples as a phone draws them, stepped (each pixel the tint of the four samples round it with
//   most weight);
// - right, as a desktop draws it from the streets' lines (client/core/render/streets.ts StreetPlanes, world-surfaces.ts
//   streetCover), the stretch's centre line in yellow and the kerbs of every stretch in view in red.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { surfaceIndex } from "../../content/surfaces.ts";
import { StreetPlanes } from "../../client/core/render/streets.ts";
import { groundCover, streetCover } from "../../client/core/render/world-surfaces.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { kerbLines } from "../../shared/world/streets.ts";
import { Base } from "../mapworld/base.ts";
import { sortedKey, type OverlayEntry } from "../mapworld/streets/overlay.ts";
import { encodePng } from "../snap/png.ts";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const VALUED = new Set(["--size", "--scale", "--out", "--map", "--unsure"]);
const [place, query] = args.filter((a, k) => !a.startsWith("--") && !(k > 0 && VALUED.has(args[k - 1]!)));
if (!place) throw new Error("bun tools/maps/street.ts <city or work folder> <way | name | lon,lat> | --types | --unsure [n] | --sort");

const city = existsSync(join(ROOT, "var/mapdata", place, "current")) ? place : null;
const work = city ? join(ROOT, "var/mapdata", city, "current") : resolve(place);

if (flag("sort")) {
  // Each overlay file, its entries in the order the build wants them (overlay.ts sortedKey), blank lines kept out.
  const dir = city ? join(ROOT, "assets/source/maps", city, "streets") : join(work, "streets");
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : []) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n").filter((l) => l.trim());
    const keyed = lines.map((text) => {
      const e = JSON.parse(text) as Record<string, unknown>;
      const key = (["area", "way", "line", "at"] as const).find((k) => e[k] !== undefined) ?? "way";
      return { text, key: sortedKey({ ...(e as object), key, text, path: (e.line ?? e.area) as [number, number][] } as unknown as OverlayEntry) };
    });
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    writeFileSync(join(dir, file), `${keyed.map((k) => k.text).join("\n")}\n`);
    console.log(`${file}: ${keyed.length} entries sorted`);
  }
  process.exit(0);
}

const world = JSON.parse(readFileSync(join(work, "world/world.json"), "utf8")) as { ruins?: { report?: string } };
const reportFile = join(work, "reports", world.ruins?.report ?? "ruins", "streets.json");
if (!existsSync(reportFile)) throw new Error(`${reportFile} is not there: build the map first`);
type Rec = Record<string, unknown> & { id: string; way: number | null; name: string | null; type: string; rule: string; sure: number; mid: [number, number]; from: [number, number]; to: [number, number]; length: number };
const report = JSON.parse(readFileSync(reportFile, "utf8")) as { summary: Record<string, unknown>; stretches: Rec[] };

if (flag("types")) {
  console.log(JSON.stringify(report.summary, null, 1));
  process.exit(0);
}
if (flag("unsure")) {
  const n = Number(option("unsure") ?? 20) || 20;
  for (const r of [...report.stretches].sort((a, b) => a.sure - b.sure || b.length - a.length).slice(0, n)) {
    console.log(`${r.sure.toFixed(2)}  ${r.type.padEnd(18)} ${r.rule.padEnd(22)} ${(r.name || "(no name)").padEnd(32)} ${r.length.toFixed(0).padStart(5)} m  way ${r.way}  at ${r.mid.join(",")}`);
  }
  process.exit(0);
}
if (!query) throw new Error("name a way, a name or a lon,lat");

// The stretches asked for.
const base = new Base(work);
const { grid } = base;
const toMap = (lon: number, lat: number): [number, number] => {
  const [e, n] = base.tm.forward(lon, lat);
  return [grid.east - e, n - grid.south];
};
let found: Rec[];
const point = /^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/.exec(query);
if (/^\d+$/.test(query)) found = report.stretches.filter((r) => r.way === Number(query));
else if (point) {
  const [x, z] = toMap(Number(point[1]), Number(point[3]));
  const dist = (r: Rec): number => { const [mx, mz] = toMap(...r.mid); return Math.hypot(mx - x, mz - z); };
  found = [...report.stretches].sort((a, b) => dist(a) - dist(b)).slice(0, 1);
} else found = report.stretches.filter((r) => (r.name ?? "").toLowerCase().includes(query.toLowerCase()));
if (found.length === 0) throw new Error(`no stretch of ${query} in ${reportFile}`);
for (const r of found.slice(0, 12)) console.log(JSON.stringify(r, null, 1));
if (found.length > 12) console.log(`... and ${found.length - 12} more stretches`);

// Its plan.
const mapFile = option("map") ?? (city ? join(ROOT, "var/maps", `${city}.snmap`) : null);
if (!mapFile || !existsSync(mapFile)) throw new Error("no map to draw from: give --map <file.snmap>");
const map = parseMap(new Uint8Array(readFileSync(mapFile)), false, false);
const hf = mapHeightfield(map);
if (!hf.streets) throw new Error(`${mapFile} has no streets part: build it again`);
const planes = new StreetPlanes(hf.streets);
const SIZE = Number(option("size") ?? 60), SCALE = Number(option("scale") ?? 10), PX = Math.round(SIZE * SCALE);
const first = found[0]!;
const [cx, cz] = point ? toMap(Number(point[1]), Number(point[3])) : toMap(...first.mid);
const nx = hf.nx, nz = hf.nz;
const tintAt = (i: number, j: number): number => map.tint[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
const finish = (t: number): number => surfaceIndex(t, true);
// Colours by finish, a verge's kinds apart by their tints.
const FINISH: Record<number, readonly number[]> = { 6: [58, 58, 62], 16: [214, 210, 198], 0: [92, 138, 70], 2: [128, 98, 70], 5: [150, 140, 122], 7: [176, 172, 160], 1: [196, 180, 140] };
const TINT: Record<number, readonly number[]> = { 197: [70, 150, 60], 196: [70, 150, 60], 150: [118, 132, 70], 151: [118, 132, 70] };
const colourOf = (t: number): readonly number[] => TINT[t] ?? FINISH[finish(t)] ?? [140, 115, 95];
const W = PX * 2 + 8, px = new Uint8Array(W * PX * 4).fill(255);
const put = (u: number, v: number, rgb: readonly number[]): void => { const k = (v * W + u) * 4; px[k] = rgb[0]!; px[k + 1] = rgb[1]!; px[k + 2] = rgb[2]!; px[k + 3] = 255; };
const e = new Float64Array(3), k = new Uint8Array(4), out = new Float64Array(5);
for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) {
  const x = cx + SIZE / 2 - (u + 0.5) / SCALE, z = cz + SIZE / 2 - (v + 0.5) / SCALE;
  const fi = x / 2, fj = z / 2, i = Math.floor(fi), j = Math.floor(fj);
  const a = tintAt(i, j), b = tintAt(i + 1, j), c = tintAt(i, j + 1), d = tintAt(i + 1, j + 1);
  const stepped = groundCover(a, b, c, d, fi - i, fj - j);
  put(u, v, colourOf(stepped));
  let drawn = stepped;
  if (planes.at(x, z, e, k) && streetCover(a, b, c, d, fi - i, fj - j, e, k[0]!, 1 / SCALE, finish, out, x, z)) drawn = out[4]! >= 0.5 ? out[3]! : out[1]!;
  put(u + PX + 8, v, colourOf(drawn));
}
// The kerbs of every stretch in view, and the stretch's centre line.
const view = (x: number, z: number): [number, number] => [Math.floor((cx + SIZE / 2 - x) * SCALE), Math.floor((cz + SIZE / 2 - z) * SCALE)];
const dot = (x: number, z: number, rgb: readonly number[]): void => { const [u, v] = view(x, z); if (u >= 0 && v >= 0 && u < PX && v < PX) put(u + PX + 8, v, rgb); };
for (const part of hf.streets.parts()) {
  for (const line of kerbLines(hf.streets, part)) {
    for (let q = 2; q < line.xz.length; q += 2) {
      const ax = line.xz[q - 2]!, az = line.xz[q - 1]!, bx = line.xz[q]!, bz = line.xz[q + 1]!, l = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= l; t += 0.5 / SCALE) dot(ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l, [220, 40, 40]);
    }
  }
}
const [fx, fz] = toMap(...first.from), [tx, tz] = toMap(...first.to), l = Math.hypot(tx - fx, tz - fz);
for (let t = 0; t <= l; t += 1 / SCALE) if (Math.floor(t * 2) % 2 === 0) dot(fx + ((tx - fx) * t) / l, fz + ((tz - fz) * t) / l, [240, 210, 40]);
const file = option("out") ?? join(ROOT, "var/research/2026-11-22-roads/streets", `street-${(first.name || first.id).replace(/[^A-Za-z0-9]+/g, "-")}.png`);
writeFileSync(file, encodePng(W, PX, px));
console.log(`plan: ${file} (${SIZE} m a side, left the samples as a phone draws them, right as a desktop draws the streets)`);
