// How each city's streets lie against the map's axes, read only (planning/workstreams/roads-straight.md): the street
// length by its angle off the nearest axis (0 to 45 degrees), how much of it is not one straight line between junctions,
// the streets that lie furthest off the axes, and the one turn of the map that would put most of it on them; with
// --walks, how much walk the built map laid along each angle against the walked streets' kerbs there, and how much of
// those kerbs has painted sidewalk beside it; with --edges, how far the edge the terrain draws today lies from a
// straight kerb at each angle.
//
//   bun tools/mapworld/road-angles.ts [city ...] [--walks] [--edges] [--json FILE]
//
// The streets are a city's built layers (var/mapdata/<city>/current/base/roads.geojson), whose metres are east and north
// of the frame's own transverse Mercator, so its axes are the map's (x west, z north). A tunnel is left out, as the
// ground has none of it. The walks are the walk kit's statics in var/maps/<city>.snmap (zwalk8, zwalk8g, 8 m each), a
// piece's yaw the street's turn. Nothing is written but the --json file.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMap } from "../../shared/world/mapfile.ts";
import { surfaceIndex } from "../../content/surfaces.ts";

const CITIES = ["miami", "tampa", "san-francisco", "los-angeles", "las-vegas"];
const args = process.argv.slice(2);
const cities = args.filter((a) => CITIES.includes(a));
const walks = args.includes("--walks");
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;

/** The groups of classes (TIGER MTFCC): the walk kit's streets, highways and ramps, service roads and alleys, the rest. */
const GROUP: Record<string, string> = { S1200: "walked", S1400: "walked", S1100: "highway", S1630: "highway", S1640: "service", S1730: "service", S1740: "service", S1780: "service" };
const BIN = 2.5;
const BINS = 45 / BIN;

/** Degrees a direction lies off the nearest of the map's axes, 0 to 45. */
const offAxis = (dx: number, dz: number): number => {
  const a = (((Math.atan2(dz, dx) * 180) / Math.PI) % 90 + 90) % 90;
  return Math.min(a, 90 - a);
};

interface Feature { geometry: { type: string; coordinates: number[][] | number[][][] }; properties: { mtfcc?: string; name?: string | null; width_m?: number; tunnel?: boolean; bridge?: boolean } }

interface CityAngles {
  city: string;
  /** Kilometres of street on the ground by group, and by group and 2.5 degree bin of its angle off the nearest axis. */
  km: Record<string, number>;
  bins: Record<string, number[]>;
  /** Kilometres of walked street by half a degree off the nearest axis, up to 5 degrees. */
  fine: number[];
  /** Kilometres in stretches between junctions that are not one straight line (streets.py keeps them as drawn). */
  curvedKm: Record<string, number>;
  /** Kilometres of walked street in straight pieces shorter than a walk (8 m), where no walk can be laid. */
  shortKm: number;
  /** Steps a kerb takes on the 2 m samples, a km of kerb: each kerb of a stretch at angle a crosses a row every 2 / sin(a) m. */
  stepsPerKm: Record<string, number>;
  /** The named streets with most length 5 degrees or more off the axes. */
  worst: { name: string; km: number; angle: number }[];
  /** The one turn of the whole map, in degrees, that puts most walked street within a degree of an axis, and the
   * walked street's shares within 1 and 2.5 degrees and its kerb steps a km, as the map lies and turned so. */
  turn: { degrees: number; within1: [number, number]; within25: [number, number]; steps: [number, number] };
  /** With --walks: km of walk laid, by bin, and the walked kerbs' km by bin (two a street). */
  walkKm?: number[];
  /** With --walks: km of walked kerb with painted sidewalk (the ground's sidewalk finish) 1 to 3 m behind it, by bin. */
  paintedKm?: number[];
  kerbKm?: number[];
}

function measure(city: string): CityAngles {
  const folder = join("var/mapdata", city, "current");
  const features = (JSON.parse(readFileSync(join(folder, "base/roads.geojson"), "utf8")) as { features: Feature[] }).features;
  const km: Record<string, number> = {}, bins: Record<string, number[]> = {}, curvedKm: Record<string, number> = {}, steps: Record<string, number> = {};
  let shortKm = 0;
  const fine = new Array(10).fill(0);
  const named = new Map<string, { km: number; weighted: number }>();
  /** Each walked straight piece: its direction in degrees from 0 to 90, and its km. */
  const walked: [number, number][] = [];
  /** And its ends in the map's east and north metres and its half width. */
  const kerbs: [number, number, number, number, number][] = [];
  for (const f of features) {
    const p = f.properties;
    if (p.tunnel) continue;
    const group = GROUP[p.mtfcc ?? ""] ?? "other";
    const runs = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]];
    for (const run of runs) {
      const curved = run.length > 2;
      for (let i = 1; i < run.length; i++) {
        const [ax, az] = run[i - 1]!, [bx, bz] = run[i]!;
        const length = Math.hypot(bx! - ax!, bz! - az!) / 1000;
        if (length <= 0) continue;
        const a = offAxis(bx! - ax!, bz! - az!);
        for (const g of [group, "all"]) {
          km[g] = (km[g] ?? 0) + length;
          (bins[g] ??= new Array(BINS).fill(0))[Math.min(BINS - 1, Math.floor(a / BIN))] += length;
          if (curved) curvedKm[g] = (curvedKm[g] ?? 0) + length;
          // Two kerbs, each a step every 2 / sin(a) metres.
          steps[g] = (steps[g] ?? 0) + 2 * length * 1000 * Math.sin((a * Math.PI) / 180) / 2;
        }
        if (group === "walked" && length < 0.008) shortKm += length;
        if (group === "walked" && a < 5) fine[Math.floor(a / 0.5)] += length;
        if (group === "walked") kerbs.push([ax!, az!, bx!, bz!, (p.width_m ?? 8) / 2]);
        if (group === "walked") walked.push([(((Math.atan2(bz! - az!, bx! - ax!) * 180) / Math.PI) % 90 + 90) % 90, length]);
        if (p.name && a >= 5) {
          const n = named.get(p.name) ?? { km: 0, weighted: 0 };
          n.km += length; n.weighted += length * a;
          named.set(p.name, n);
        }
      }
    }
  }
  const stepsPerKm: Record<string, number> = {};
  for (const g of Object.keys(km)) stepsPerKm[g] = steps[g]! / (2 * km[g]!);
  const worst = [...named.entries()].sort((a, b) => b[1].km - a[1].km).slice(0, 10).map(([name, n]) => ({ name, km: n.km, angle: n.weighted / n.km }));
  // Turned by r, a piece at direction d lies min(|d + r| mod 90, 90 - that) off the axes.
  const under = (r: number, most: number): number => walked.reduce((sum, [d, l]) => { const a = ((d + r) % 90 + 90) % 90; return Math.min(a, 90 - a) <= most ? sum + l : sum; }, 0);
  const stepsAt = (r: number): number => walked.reduce((sum, [d, l]) => { const a = ((d + r) % 90 + 90) % 90; return sum + l * 1000 * Math.sin((Math.min(a, 90 - a) * Math.PI) / 180) / 2; }, 0) / (km.walked! * 1000) * 1000;
  let best = 0;
  for (let r = -45; r < 45; r += 0.1) if (under(r, 1) > under(best, 1)) best = Math.round(r * 10) / 10;
  const turn = { degrees: best, within1: [under(0, 1) / km.walked!, under(best, 1) / km.walked!] as [number, number], within25: [under(0, 2.5) / km.walked!, under(best, 2.5) / km.walked!] as [number, number], steps: [stepsAt(0), stepsAt(best)] as [number, number] };
  const out: CityAngles = { city, km, bins, fine, curvedKm, shortKm, stepsPerKm, worst, turn };
  if (walks) {
    const file = join("var/maps", `${city}.snmap`);
    if (existsSync(file)) {
      const map = parseMap(Bun.mmap(file), false, false);
      const t = map.statics;
      const kinds = new Set(t.kinds.flatMap((k, i) => (/^core:zruin_zwalk8g?_concrete$/.test(k) ? [i] : [])));
      const walkKm = new Array(BINS).fill(0);
      for (let i = 0; i < t.kind.length; i++) {
        if (!kinds.has(t.kind[i]!)) continue;
        // A piece's z looks away from its street, so the street runs along its x; the angle off the axes is the same.
        const yaw = (t.yaw[i]! / 65536) * 2 * Math.PI;
        walkKm[Math.min(BINS - 1, Math.floor(offAxis(Math.cos(yaw), Math.sin(yaw)) / BIN))] += 0.008;
      }
      out.walkKm = walkKm;
      // Painted sidewalk beside each walked kerb: every 2 m along it, the samples 1, 2 and 3 m behind the kerb.
      const info = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as { bounds: [number, number, number, number] };
      const [, south, east] = info.bounds, nx = map.dims.chunksX * 32 + 1, nz = map.dims.chunksZ * 32 + 1;
      const walkAt = (e: number, n: number): boolean => {
        const i = Math.round((east - e) / 2), j = Math.round((n - south) / 2);
        return i >= 0 && j >= 0 && i < nx && j < nz && surfaceIndex(map.tint[j * nx + i]!, true) === 16;
      };
      const paintedKm = new Array(BINS).fill(0);
      for (const [ax, az, bx, bz, half] of kerbs) {
        const l = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / l, uz = (bz - az) / l;
        const bin = Math.min(BINS - 1, Math.floor(offAxis(ux, uz) / BIN));
        for (let d = 1; d < l; d += 2) for (const side of [1, -1]) {
          if ([1, 2, 3].some((o) => walkAt(ax + ux * d - uz * (half + o) * side, az + uz * d + ux * (half + o) * side))) paintedKm[bin] += 0.002;
        }
      }
      out.paintedKm = paintedKm;
      out.kerbKm = bins.walked!.map((k) => 2 * k);
    }
  }
  return out;
}

const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(1)}%`;
const results: CityAngles[] = [];
for (const city of cities.length > 0 ? cities : CITIES) {
  const r = measure(city);
  results.push(r);
  const b = r.bins.all!, w = r.bins.walked!;
  const share = (bins: number[], lo: number, hi: number): number => bins.slice(lo / BIN, hi / BIN).reduce((s, v) => s + v, 0);
  console.log(`\n${city}: ${r.km.all!.toFixed(0)} km of road on the ground, ${r.km.walked!.toFixed(0)} km of it walked streets (S1200, S1400)`);
  for (const [label, bins, total] of [["all", b, r.km.all!], ["walked", w, r.km.walked!]] as const) {
    console.log(`  ${label.padEnd(7)} within 2.5: ${pct(share(bins, 0, 2.5), total)}, 2.5-10: ${pct(share(bins, 2.5, 10), total)}, 10-20: ${pct(share(bins, 10, 20), total)}, 20-30: ${pct(share(bins, 20, 30), total)}, 30-45: ${pct(share(bins, 30, 45), total)}; curved stretches ${pct(r.curvedKm[label] ?? 0, total)}; kerb steps ${r.stepsPerKm[label]!.toFixed(0)} a km of kerb`);
  }
  console.log(`  bins of 2.5 degrees, all roads, km: ${b.map((v) => v.toFixed(0)).join(" ")}`);
  console.log(`  walked streets by half a degree up to 5, km: ${r.fine.map((v) => v.toFixed(0)).join(" ")}`);
  const tn = r.turn;
  console.log(`  turned ${tn.degrees} degrees: walked street within 1 degree of an axis ${pct(tn.within1[0], 1)} to ${pct(tn.within1[1], 1)}, within 2.5 ${pct(tn.within25[0], 1)} to ${pct(tn.within25[1], 1)}, kerb steps a km ${tn.steps[0].toFixed(0)} to ${tn.steps[1].toFixed(0)}`);
  console.log(`  walked streets in straight pieces under 8 m: ${r.shortKm.toFixed(1)} km`);
  console.log(`  furthest off the axes: ${r.worst.map((s) => `${s.name} ${s.km.toFixed(1)} km at ${s.angle.toFixed(0)}`).join("; ")}`);
  if (r.walkKm && r.kerbKm) {
    const groups: [number, number][] = [[0, 2.5], [2.5, 10], [10, 20], [20, 30], [30, 45]];
    if (r.paintedKm) console.log(`  painted sidewalk beside walked kerb: ${groups.map(([lo, hi]) => `${lo}-${hi}: ${pct(share(r.paintedKm!, lo, hi), share(r.kerbKm!, lo, hi))}`).join(", ")}`);
    console.log(`  walk laid against walked kerb: ${groups.map(([lo, hi]) => `${lo}-${hi}: ${share(r.walkKm!, lo, hi).toFixed(0)} of ${share(r.kerbKm!, lo, hi).toFixed(0)} km (${pct(share(r.walkKm!, lo, hi), share(r.kerbKm!, lo, hi))})`).join(", ")}`);
  }
}
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(results, null, 1)}\n`);

// With --edges: how far the edge the terrain draws today lies from a straight kerb at each angle. A kerb at angle a off
// the x axis, at many offsets against the 2 m samples; a sample is street where its point is inside (prepare.py's burn);
// a pixel is street where the street's samples hold most of the bilinear weight (groundCover, no wander, as beside a
// walk). Along the kerb, the drawn edge's distance from the true line: its most and its mean, in metres, and how far
// apart its jogs of a whole sample are.
if (args.includes("--edges")) {
  console.log("\nangle  most off  mean off  a jog every");
  for (const a of [0, 0.5, 1, 2, 3.5, 5, 10, 15, 20, 25, 30, 35, 40, 45]) {
    const r = (a * Math.PI) / 180, ux = Math.cos(r), uz = Math.sin(r);
    let most = 0, sum = 0, n = 0;
    for (let o = 0; o < 1; o += 0.0625) {
      // The street is where (z - o) cos a - x sin a < 0, in samples of 2 m; the drawn edge found across the line by halving.
      const side = (x: number, z: number): number => ((z - o) * ux - x * uz < 0 ? 1 : 0);
      const weight = (x: number, z: number): number => {
        const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
        return (side(i, j) * (1 - fx) + side(i + 1, j) * fx) * (1 - fz) + (side(i, j + 1) * (1 - fx) + side(i + 1, j + 1) * fx) * fz;
      };
      for (let s = 0; s < 60; s += 0.05) {
        const px = s * ux, pz = o + s * uz;
        let lo = -2, hi = 2;
        for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (weight(px - uz * m, pz + ux * m) > 0.5) lo = m; else hi = m; }
        const off = Math.abs((lo + hi) / 2) * 2;
        most = Math.max(most, off); sum += off; n++;
      }
    }
    console.log(`${String(a).padStart(5)}  ${most.toFixed(2).padStart(8)}  ${(sum / n).toFixed(2).padStart(8)}  ${a === 0 ? "never" : `${(2 / Math.sin(r)).toFixed(1)} m`}`);
  }
}
