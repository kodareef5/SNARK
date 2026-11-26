// Whether the generator is local, on rectangles cut from a city at several places:
//
//   bun tools/maps/local-gate.ts <city> [folder] [--places N] [--only name,name] [--work folder]
//
// The city's work folder must stand (tools/maps/city.ts, or a kit; --work names one elsewhere). At each place it cuts an
// inner rectangle of 48 by 48 chunks and an outer of 80 by 80 round it (tools/mapworld/cut.ts), copies the outer with
// one mid-size footprint and one pool taken out, builds the three and compares them:
//
//   nested   nothing that differs between inner and outer stands 600 m or more inside the inner's edge
//   edited   taking the footprint and the pool out changes nothing 600 m or more from both
//
// "Nothing" is a part (diff.ts), and below the parts a static piece, a row the head lists by place (a vehicle, a spawn
// point or region, a landmark) and a street stretch as the build reported it (unlike.ts): a part may differ within the
// reach and still hold pieces that differ past it. Found aircraft are told and not failed (gated). The places are the city's middle, one at the shore, one inland and the
// rest of a three by three spread (placements); --places takes the first N, three where it is not given, which is about
// ten minutes a build at a time, and --only takes them by name. Each build waits for 15 GB of free memory and runs under
// 6 GB where systemd-run is there to hold it.
//
// It exits 1 where either rule fails anywhere. Run it after a change to the generator: a list compacted under kept
// places, a count over the whole map or a distance with no bound passes every test and still moves pieces kilometres
// from an edit.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import { readGrey, writeGrey } from "../map/png.ts";
import { cutSource } from "../mapworld/cut.ts";
import { diffMaps, headOf, report, type PartDiff } from "./diff.ts";
import { shared, unlikePlaces, unlikeStretches, type Unlike } from "./unlike.ts";
import { workFolder } from "./work.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** Metres from an edit, or in from a cut's edge, past which nothing may change (the plan's rule for the generator). */
export const REACH = 600;
/** Chunks a side of the inner rectangle; the outer is a sector wider on every side. */
const INNER = 48;
/** Gigabytes of memory that must be free before a build starts, and the most a build may hold. */
const FREE_GB = 15, BUILD_GB = 6;

interface Outline { geometry: { type: string; coordinates: number[][][] | number[][][][] }; properties: { id: number | string; kind?: string } }
interface CutMap { bounds: number[]; frame: number[] }
/** Something taken out of a cut: what, its middle in lattice metres and how far its corners reach from it. */
export interface Edit { readonly what: string; readonly x: number; readonly z: number; readonly radius: number }

const rings = (f: Outline): number[][][] => (f.geometry.type === "Polygon" ? (f.geometry.coordinates as number[][][]) : (f.geometry.coordinates as number[][][][]).flat());
/** An outline's area, the middle of its first ring's corners and how far they reach from it, in base metres. */
function measure(f: Outline): { area: number; e: number; n: number; radius: number } {
  const ring = rings(f)[0]!;
  let a = 0, e = 0, n = 0, radius = 0;
  for (let k = 0; k + 1 < ring.length; k++) {
    a += ring[k]![0]! * ring[k + 1]![1]! - ring[k + 1]![0]! * ring[k]![1]!;
    e += ring[k]![0]!;
    n += ring[k]![1]!;
  }
  [a, e, n] = [Math.abs(a / 2), e / (ring.length - 1), n / (ring.length - 1)];
  for (const p of ring) radius = Math.max(radius, Math.hypot(p[0]! - e, p[1]! - n));
  return { area: a, e, n, radius };
}
const readMap = (folder: string): CutMap => JSON.parse(readFileSync(join(folder, "map.json"), "utf8")) as CutMap;
const lattice = (map: CutMap, e: number, n: number): [number, number] => [map.frame[0]! * CHUNK_SIZE + (map.bounds[2]! - e), map.frame[1]! * CHUNK_SIZE + (n - map.bounds[1]!)];

/** The footprint of 300 to 1,500 m² nearest the middle of the cut in `folder`: its id and its place in lattice metres. */
export function midFootprint(folder: string): { id: number; x: number; z: number; area: number } {
  const map = readMap(folder);
  const doc = JSON.parse(readFileSync(join(folder, "base/buildings.geojson"), "utf8")) as { features: Outline[] };
  const [e0, n0] = [(map.bounds[0]! + map.bounds[2]!) / 2, (map.bounds[1]! + map.bounds[3]!) / 2];
  let best: { id: number; x: number; z: number; area: number; d: number } | null = null;
  for (const f of doc.features) {
    const { area, e, n } = measure(f), d = Math.hypot(e - e0, n - n0), id = Number(f.properties.id);
    // Ties go to the lower id, so the same footprint is taken whatever order the file has them in.
    if (area > 300 && area < 1500 && (!best || d < best.d || (d === best.d && id < best.id))) best = { id, x: lattice(map, e, n)[0], z: lattice(map, e, n)[1], area, d };
  }
  if (!best) throw new Error(`${folder} has no footprint of 300 to 1,500 m² to take out`);
  return best;
}

/** Whether base point (e, n) is in an outline: in an odd number of its rings. */
function holds(f: Outline, e: number, n: number): boolean {
  let hit = false;
  for (const ring of rings(f)) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ei, ni, ej, nj] = [ring[i]![0]!, ring[i]![1]!, ring[j]![0]!, ring[j]![1]!];
    if (ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei) hit = !hit;
  }
  return hit;
}

/**
 * Takes footprint `id` out of the cut in `folder` as the data stages would have left it out: of base/buildings.geojson,
 * of the 2 m mask the streets and the ground read (base/buildings.png, whose sample is in a footprint when its point
 * is: the samples this footprint alone covers go to 0) and of the labels that name it (blocks/labels.json).
 */
export function takeFootprint(folder: string, id: number): Edit {
  const map = readMap(folder), path = join(folder, "base/buildings.geojson");
  const doc = JSON.parse(readFileSync(path, "utf8")) as { features: Outline[] };
  const gone = doc.features.find((f) => Number(f.properties.id) === id);
  if (!gone) throw new Error(`${folder} has no footprint ${id}`);
  const kept = doc.features.filter((f) => f !== gone);
  writeFileSync(path, JSON.stringify({ ...doc, features: kept }));
  const { area, e, n, radius } = measure(gone), [west, , , north] = map.bounds as [number, number, number, number];
  const file = join(folder, "base/buildings.png"), mask = readGrey(new Uint8Array(readFileSync(file)), file);
  // Its neighbours whose corners could reach into its box, which keep the samples they share with it.
  const near = kept.filter((f) => { const m = measure(f); return Math.hypot(m.e - e, m.n - n) <= m.radius + radius; });
  let cleared = 0;
  for (let r = Math.max(0, Math.floor((north - n - radius) / 2)); r <= Math.min(mask.height - 1, Math.ceil((north - n + radius) / 2)); r++) {
    for (let c = Math.max(0, Math.floor((e - radius - west) / 2)); c <= Math.min(mask.width - 1, Math.ceil((e + radius - west) / 2)); c++) {
      const [pe, pn] = [west + c * 2, north - r * 2];
      if (mask.data[r * mask.width + c] === 0 || !holds(gone, pe, pn) || near.some((f) => holds(f, pe, pn))) continue;
      mask.data[r * mask.width + c] = 0;
      cleared++;
    }
  }
  writeFileSync(file, writeGrey(mask.width, mask.height, mask.data));
  const labels = join(folder, "blocks/labels.json");
  if (existsSync(labels)) {
    const named = JSON.parse(readFileSync(labels, "utf8")) as Record<string, unknown>;
    if (String(id) in named) {
      delete named[String(id)];
      writeFileSync(labels, JSON.stringify(named));
    }
  }
  const [x, z] = lattice(map, e, n);
  return { what: `footprint ${id} (${Math.round(area)} m², ${cleared} samples of the mask)`, x, z, radius };
}

/**
 * Takes one pool out of the cut in `folder` (base/perched_water.geojson): the one nearest the cut's middle that stands
 * `apart` metres or more from (x, z), so what each edit changes can be told apart, or the farthest from it where none
 * does. Null where the cut has no pool.
 */
export function takePool(folder: string, x: number, z: number, apart = 2 * REACH + 100): Edit | null {
  const map = readMap(folder), path = join(folder, "base/perched_water.geojson");
  if (!existsSync(path)) return null;
  const doc = JSON.parse(readFileSync(path, "utf8")) as { features: Outline[] };
  const [mx, mz] = lattice(map, (map.bounds[0]! + map.bounds[2]!) / 2, (map.bounds[1]! + map.bounds[3]!) / 2);
  const pools = doc.features.filter((f) => f.properties.kind === "pool").map((f) => {
    const m = measure(f), [px, pz] = lattice(map, m.e, m.n);
    return { f, m, px, pz, from: Math.hypot(px - x, pz - z), mid: Math.hypot(px - mx, pz - mz), id: String(f.properties.id) };
  });
  // By id where two are as far, so the same pool is taken whatever the file's order.
  const clear = pools.filter((p) => p.from >= apart);
  if (clear.length > 0) clear.sort((a, b) => a.mid - b.mid || a.id.localeCompare(b.id));
  else pools.sort((a, b) => b.from - a.from || a.id.localeCompare(b.id));
  const pool = clear[0] ?? pools[0];
  if (!pool) return null;
  writeFileSync(path, JSON.stringify({ ...doc, features: doc.features.filter((f) => f !== pool.f) }));
  return { what: `pool ${pool.f.properties.id} (${Math.round(pool.m.area)} m²)`, x: pool.px, z: pool.pz, radius: pool.m.radius };
}

/** A place the gate cuts at: its name and its inner rectangle's corner in lattice chunks. */
export interface Placement { readonly name: string; readonly col: number; readonly row: number }

/**
 * Where the gate cuts a city of `chunks` at `frame`, in the order it takes them: the middle; of a three by three spread
 * at a quarter, a half and three quarters of each side, on whole sectors, the one most like a shore (`wet` of its inner
 * rectangle nearest a quarter, and over a fiftieth), then the one farthest inland (the least `wet` in its outer); then
 * the rest, east to west and south to north, each named by its side ("en" the north-east). `wet` is the share of a rectangle of chunks that is water, 0 where it is
 * not known. A place whose outer rectangle the city does not hold is left out.
 */
export function placements(frame: readonly [number, number], chunks: readonly [number, number], wet: (col: number, row: number, side: number) => number = () => 0): Placement[] {
  const on = (v: number): number => Math.round(v / SECTOR_CHUNKS) * SECTOR_CHUNKS, outer = INNER + 2 * SECTOR_CHUNKS;
  const spread: Placement[] = [];
  for (const [k, fz] of [0.25, 0.5, 0.75].entries()) for (const [j, fx] of [0.25, 0.5, 0.75].entries()) {
    const [col, row] = [on(frame[0] + chunks[0] * fx - INNER / 2), on(frame[1] + chunks[1] * fz - INNER / 2)];
    if (col - SECTOR_CHUNKS < frame[0] || row - SECTOR_CHUNKS < frame[1] || col - SECTOR_CHUNKS + outer > frame[0] + chunks[0] || row - SECTOR_CHUNKS + outer > frame[1] + chunks[1]) continue;
    if (!spread.some((p) => p.col === col && p.row === row)) spread.push({ name: j === 1 && k === 1 ? "middle" : `${"emw"[j]}${"smn"[k]}`, col, row });
  }
  const out = spread.filter((p) => p.name === "middle"), rest = spread.filter((p) => p.name !== "middle");
  const take = (score: (p: Placement) => number, name: string): void => {
    let best = -1;
    rest.forEach((p, k) => { if (Number.isFinite(score(p)) && (best < 0 || score(p) < score(rest[best]!))) best = k; });
    if (best >= 0) out.push({ ...rest.splice(best, 1)[0]!, name });
  };
  take((p) => { const w = wet(p.col, p.row, INNER); return w > 0.02 ? Math.abs(w - 0.25) : Infinity; }, "shore");
  take((p) => wet(p.col - SECTOR_CHUNKS, p.row - SECTOR_CHUNKS, outer), "inland");
  return [...out, ...rest];
}

/** The parts of `rows` that differ and should not: `far` says how far a part is from what may change it. */
export function tooFar(rows: readonly PartDiff[], far: (r: PartDiff) => number): PartDiff[] {
  return rows.filter((r) => r.kind !== "head" && r.state !== "same" && !r.clipped && far(r) >= REACH);
}

/**
 * Lines that tell what differs below the parts, by kind: how many, how far the farthest is from what may have changed
 * it (`far`, less the thing's own reach), and how many stand past the reach, the first few of those named. `bad` takes
 * a line for each kind with some.
 */
export function below(rows: readonly Unlike[], far: (x: number, z: number) => number, label: string, bad: string[]): string[] {
  const lines: string[] = [];
  for (const kind of [...new Set(rows.map((r) => r.kind))]) {
    const of = rows.filter((r) => r.kind === kind).map((r) => ({ r, d: far(r.x, r.z) - r.reach })).sort((p, q) => q.d - p.d);
    const past = of.filter((o) => o.d >= REACH);
    lines.push(`${kind}: ${of.length} differ, the farthest ${Math.round(of[0]!.d)} m; ${past.length} at ${REACH} m or more`);
    for (const o of past.slice(0, 4)) lines.push(`  ${Math.round(o.d)} m  ${o.r.x.toFixed(1)}, ${o.r.z.toFixed(1)}  ${o.r.what.slice(0, 150)}`);
    // The pieces past the reach by family (a ruin's pier, a bent kerb, a street's lamp), which names the cause.
    const families = new Map<string, number>();
    if (kind === "piece") for (const o of past) { const f = /: core:z*([a-y][a-z]*_[a-z]+)/.exec(o.r.what)?.[1] ?? "other"; families.set(f, (families.get(f) ?? 0) + 1); }
    if (families.size > 0) lines.push(`  of them ${[...families].sort((p, q) => q[1] - p[1]).slice(0, 10).map(([f, n]) => `${f} ${n}`).join(", ")}`);
    if (past.length > 0) bad.push(`${label}: ${past.length} ${kind}s differ ${REACH} m or more away, the farthest ${Math.round(past[0]!.d)} m`);
  }
  return lines;
}

/**
 * `rows` less the found aircraft past the reach, which are told and not failed: they are picked over the whole map, twelve
 * at most and four of a service (tools/helicopter/sites.ts), so any cut picks others. Take this out when they are local.
 */
function gated(rows: readonly Unlike[], far: (x: number, z: number) => number): Unlike[] {
  const known = rows.filter((r) => r.kind === "vehicle" && r.what.includes('"id":"helicopter/') && far(r.x, r.z) >= REACH);
  if (known.length > 0) console.log(`not failed: ${known.length} found aircraft differ ${REACH} m or more away, the farthest ${Math.round(Math.max(...known.map((r) => far(r.x, r.z))))} m (picked over the whole map)`);
  return rows.filter((r) => !known.includes(r));
}

/** Waits until FREE_GB of memory is available (Linux's /proc/meminfo; elsewhere it does not wait), saying so once. */
function waitForMemory(log: (line: string) => void): void {
  const free = (): number => (existsSync("/proc/meminfo") ? Number(/MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? Infinity) / 1048576 : Infinity);
  if (free() >= FREE_GB) return;
  log(`waiting for ${FREE_GB} GB of free memory (${free().toFixed(1)} GB now)`);
  while (free() < FREE_GB) Bun.sleepSync(30000);
  log(`${free().toFixed(1)} GB free, going on`);
}

if (import.meta.main) {
  const args = process.argv.slice(2), valued = ["--places", "--only", "--work"];
  const opt = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const [city, given] = args.filter((a, k) => !a.startsWith("--") && !valued.includes(args[k - 1] ?? ""));
  if (!city) throw new Error("bun tools/maps/local-gate.ts <city> [folder] [--places N] [--only name,name] [--work folder]");
  const out = resolve(given ?? join(ROOT, "var/maps-gate", city));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const work = opt("--work") ? resolve(opt("--work")!) : workFolder(city), began = performance.now();
  const whole = JSON.parse(readFileSync(join(work, "map.json"), "utf8")) as { frame: [number, number]; chunks: [number, number] };
  // The share of a rectangle of chunks that is water, from the city's own 2 m layer (a sample's column counts east).
  const water = readGrey(new Uint8Array(readFileSync(join(work, "base/water.png"))), "water.png");
  const wet = (col: number, row: number, side: number): number => {
    const [c1, r1] = [water.width - 1 - (col - whole.frame[0]) * 32, water.height - 1 - (row - whole.frame[1]) * 32];
    let n = 0;
    for (let r = r1 - side * 32; r < r1; r += 4) for (let c = c1 - side * 32; c < c1; c += 4) if (water.data[r * water.width + c]) n++;
    return n / (side * 8) ** 2;
  };
  const all = placements(whole.frame, whole.chunks, wet), only = opt("--only")?.split(",");
  const places = only ? all.filter((p) => only.includes(p.name)) : all.slice(0, Number(opt("--places") ?? 3));
  console.log(`${city}: ${places.map((p) => `${p.name} at ${p.col}, ${p.row}`).join("; ")} (of ${all.map((p) => p.name).join(", ")})`);
  const capped = Bun.which("systemd-run") !== null, bad: string[] = [];
  for (const place of places) {
    const dir = join(out, place.name), at = (name: string): string => join(dir, name);
    mkdirSync(dir);
    console.log(`\n== ${place.name}: inner ${INNER} by ${INNER} chunks at ${place.col}, ${place.row}`);
    cutSource(city, work, at("inner"), place.col, place.row, INNER, INNER);
    cutSource(city, work, at("outer"), place.col - SECTOR_CHUNKS, place.row - SECTOR_CHUNKS, INNER + 2 * SECTOR_CHUNKS, INNER + 2 * SECTOR_CHUNKS);
    cpSync(at("outer"), at("edited"), { recursive: true });
    const footprint = takeFootprint(at("edited"), midFootprint(at("outer")).id), pool = takePool(at("edited"), footprint.x, footprint.z);
    const edits = pool ? [footprint, pool] : [footprint];
    for (const e of edits) console.log(`taken out: ${e.what} at lattice ${e.x.toFixed(0)}, ${e.z.toFixed(0)}`);
    if (!pool) console.log("the cut has no pool to take out");
    const built = (name: string): string => {
      waitForMemory(console.log);
      const to = at(`${name}-map`), build = ["bun", join(ROOT, "tools/mapworld/build.ts"), at(name), "--out", to];
      const run = Bun.spawnSync(capped ? ["systemd-run", "--user", "--scope", "-q", "-p", `MemoryMax=${BUILD_GB}G`, "--", ...build] : build, { stdout: Bun.file(at(`${name}.log`)), stderr: "inherit" });
      if (run.exitCode !== 0) throw new Error(`${name} did not build: ${at(`${name}.log`)}`);
      return join(to, `${name}.snmap`);
    };
    const [inner, outer, edited] = [built("inner"), built("outer"), built("edited")];
    const read = (file: string) => parseMap(new Uint8Array(readFileSync(file)), false);
    const [a, b, c] = [read(inner), read(outer), read(edited)];

    const nested = diffMaps(headOf(inner), headOf(outer)), [x0, z0, x1, z1] = shared(a, b);
    // A cut with none of the city's spawn points gives itself one at its middle (cut.ts): what differs round it is the cut's doing.
    const own = [a, b].flatMap((m) => m.spawns.filter((s) => s.name === "Cut").map((s) => [s.x + m.dims.frameX * CHUNK_SIZE, s.z + m.dims.frameZ * CHUNK_SIZE] as const));
    const inside = (x: number, z: number): number => Math.min(x - x0, z - z0, x1 - x, z1 - z, ...own.map(([sx, sz]) => Math.hypot(x - sx, z - sz)));
    console.log(["-- inner against outer, by metres inside the inner's edge", ...report(nested, false), ...below(gated([...unlikePlaces(a, b), ...unlikeStretches(at("inner"), at("outer"))], inside), inside, `${place.name} nested`, bad)].join("\n"));
    bad.push(...tooFar(nested, (r) => r.inside).map((r) => `${place.name} nested: ${r.kind} ${r.col}-${r.row} differs ${r.inside} m inside the inner's edge`));

    // A part's distance from the nearer edit, and a thing's from the nearer edit's outline.
    const each = edits.map((e) => diffMaps(headOf(outer), headOf(edited), e));
    const changed = each[0]!.map((r, k) => ({ ...r, from: Math.min(...each.map((rows) => rows[k]!.from ?? 0)) }));
    const from = (x: number, z: number): number => Math.min(...edits.map((e) => Math.hypot(x - e.x, z - e.z) - e.radius));
    const rows = [...unlikePlaces(b, c), ...unlikeStretches(at("outer"), at("edited"))];
    console.log(["-- outer against the outer edited, by metres from the nearer edit", ...report(changed, false), ...below(gated(rows, from), from, `${place.name} edited`, bad)].join("\n"));
    bad.push(...tooFar(changed, (r) => r.from ?? 0).map((r) => `${place.name} edited: ${r.kind} ${r.col}-${r.row} differs ${Math.round(r.from ?? 0)} m from the nearer edit`));
    // What each edit changed, by which it is nearer: the pool's reach is told apart from the footprint's.
    for (const e of edits) {
      const mine = rows.filter((r) => edits.every((o) => Math.hypot(r.x - e.x, r.z - e.z) - e.radius <= Math.hypot(r.x - o.x, r.z - o.z) - o.radius));
      console.log(`nearer ${e.what.split(" (")[0]}: ${mine.length} things differ${mine.length ? `, the farthest ${Math.round(Math.max(...mine.map((r) => Math.hypot(r.x - e.x, r.z - e.z) - e.radius - r.reach)))} m from it` : ""}`);
    }
  }
  console.log(`\n${bad.length ? bad.join("\n") : `ok: nothing differs ${REACH} m or more from an edge or an edit at ${places.map((p) => p.name).join(", ")}`}`);
  console.log(`${((performance.now() - began) / 60000).toFixed(1)} minutes`);
  if (existsSync(out) && !given) rmSync(out, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
}
