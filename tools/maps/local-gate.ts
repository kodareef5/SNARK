// Whether an edit stays local, on two rectangles of a city and one of them with a footprint taken out:
//
//   bun tools/maps/local-gate.ts <city> [folder]
//
// The city's work folder must stand (tools/maps/city.ts, or a kit). It cuts an inner rectangle of 48 by 48 chunks at the
// map's middle and an outer of 80 by 80 round it (tools/mapworld/cut.ts), copies the outer without one mid-size
// footprint near its middle, builds the three (about two minutes, 2.5 GB) and compares them part by part (diff.ts):
//
//   nested   no part that differs between inner and outer stands 600 m or more inside the inner's edge
//   removed  taking the footprint out changes no part 600 m or more from it
//
// It exits 1 where either fails. Run it after a change to the generator: a list compacted under kept places, or a count
// taken over the whole map, passes every test and still moves pieces kilometres from an edit.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { cutSource } from "../mapworld/cut.ts";
import { diffMaps, headOf, report, type PartDiff } from "./diff.ts";
import { workFolder } from "./work.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** Metres from an edit, or in from a cut's edge, past which nothing may change (the plan's rule for the generator). */
export const REACH = 600;

interface Footprint { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties: { id: number } }

/** The footprint of 300 to 1,500 m² nearest the middle of the cut in `folder`: its id and its place in lattice metres. */
export function midFootprint(folder: string): { id: number; x: number; z: number; area: number } {
  const map = JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as { bounds: number[]; frame: number[] };
  const doc = JSON.parse(readFileSync(join(folder, "base/buildings.geojson"), "utf8")) as { features: Footprint[] };
  const [e0, n0] = [(map.bounds[0]! + map.bounds[2]!) / 2, (map.bounds[1]! + map.bounds[3]!) / 2];
  let best: { id: number; x: number; z: number; area: number; d: number } | null = null;
  for (const f of doc.features) {
    const ring = (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : (f.geometry.coordinates as number[][][][])[0]![0]) as number[][];
    let a = 0, e = 0, n = 0;
    for (let k = 0; k + 1 < ring.length; k++) {
      a += ring[k]![0]! * ring[k + 1]![1]! - ring[k + 1]![0]! * ring[k]![1]!;
      e += ring[k]![0]!;
      n += ring[k]![1]!;
    }
    [a, e, n] = [Math.abs(a / 2), e / (ring.length - 1), n / (ring.length - 1)];
    const d = Math.hypot(e - e0, n - n0);
    // Ties go to the lower id, so the same footprint is taken whatever order the file has them in.
    if (a > 300 && a < 1500 && (!best || d < best.d || (d === best.d && f.properties.id < best.id))) {
      best = { id: f.properties.id, x: map.frame[0]! * CHUNK_SIZE + (map.bounds[2]! - e), z: map.frame[1]! * CHUNK_SIZE + (n - map.bounds[1]!), area: a, d };
    }
  }
  if (!best) throw new Error(`${folder} has no footprint of 300 to 1,500 m² to take out`);
  return best;
}

/** The parts of `rows` that differ and should not: `far` says how far a part is from what may change it. */
export function tooFar(rows: readonly PartDiff[], far: (r: PartDiff) => number): PartDiff[] {
  return rows.filter((r) => r.kind !== "head" && r.state !== "same" && !r.clipped && far(r) >= REACH);
}

if (import.meta.main) {
  const [city, given] = process.argv.slice(2);
  if (!city) throw new Error("bun tools/maps/local-gate.ts <city> [folder]");
  const out = resolve(given ?? join(ROOT, "var/maps-gate", city));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const work = workFolder(city);
  const whole = JSON.parse(readFileSync(join(work, "map.json"), "utf8")) as { frame: [number, number]; chunks: [number, number] };
  // The inner rectangle on whole sectors at the map's middle, the outer a sector wider on every side.
  const on = (v: number): number => Math.round(v / SECTOR_CHUNKS) * SECTOR_CHUNKS;
  const [col, row] = [on(whole.frame[0] + whole.chunks[0] / 2 - 24), on(whole.frame[1] + whole.chunks[1] / 2 - 24)];
  console.log(cutSource(city, work, join(out, "inner"), col, row, 48, 48));
  console.log(cutSource(city, work, join(out, "outer"), col - SECTOR_CHUNKS, row - SECTOR_CHUNKS, 80, 80));
  const gone = midFootprint(join(out, "outer"));
  cpSync(join(out, "outer"), join(out, "removed"), { recursive: true });
  const path = join(out, "removed/base/buildings.geojson");
  const doc = JSON.parse(readFileSync(path, "utf8")) as { features: Footprint[] };
  writeFileSync(path, JSON.stringify({ ...doc, features: doc.features.filter((f) => f.properties.id !== gone.id) }));
  console.log(`removed: footprint ${gone.id}, ${Math.round(gone.area)} m² at lattice ${gone.x.toFixed(0)}, ${gone.z.toFixed(0)}`);
  const built = (name: string): string => {
    const to = join(out, `${name}-map`);
    const run = Bun.spawnSync(["bun", join(ROOT, "tools/mapworld/build.ts"), join(out, name), "--out", to], { stdout: Bun.file(join(out, `${name}.log`)), stderr: "inherit" });
    if (run.exitCode !== 0) throw new Error(`${name} did not build: ${join(out, `${name}.log`)}`);
    return join(to, `${name}.snmap`);
  };
  const [inner, outer, removed] = [built("inner"), built("outer"), built("removed")];
  const nested = diffMaps(headOf(inner), headOf(outer));
  const edited = diffMaps(headOf(outer), headOf(removed), { x: gone.x, z: gone.z });
  const bad = [...tooFar(nested, (r) => r.inside).map((r) => `nested: ${r.kind} ${r.col}-${r.row} differs ${r.inside} m inside the inner's edge`),
    ...tooFar(edited, (r) => r.from ?? 0).map((r) => `removed: ${r.kind} ${r.col}-${r.row} differs ${Math.round(r.from ?? 0)} m from the footprint`)];
  console.log(["== inner against outer", ...report(nested, false), "== outer against the outer with the footprint removed", ...report(edited, false)].join("\n"));
  console.log(bad.length ? bad.join("\n") : `ok: nothing differs ${REACH} m or more from an edge or the edit`);
  if (existsSync(out) && !given) rmSync(out, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
}
