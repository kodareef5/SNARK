// Cars in a city's streets: which way a street runs at a point, from the centrelines of base/roads.geojson; which of the
// fleet's street cars a car is, by its district, what stands near and a hash of where it stands; and where drivable ones
// of the road fleet are parked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STREET_KINDS, STREET_LOOKS, wreckLook } from "../../content/vehicles/wrecks.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { S } from "./ground.ts";
import { binKey, hash3, textSeed } from "./raster.ts";
import { byText, lineId } from "./street-graph.ts";
import { readRoads } from "./streets/yield.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { meets, obstacleIndex, type Box } from "./ruin-obstacles.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** Metres a side of a sector of the lattice, by which parked cars and trailers are counted. */
export const SECTOR = CHUNK_SIZE * SECTOR_CHUNKS;

/**
 * A centreline's stretch between two of its points, in engine metres, with its class (TIGER MTFCC) and half width; its
 * line's row in the data, its line's id and 32 bits of that id, and the metres along its line before it starts.
 */
interface Segment { ax: number; az: number; bx: number; bz: number; half: number; mtfcc: string; line: number; id: string; seed: number; from: number; }
/** The nearest stretch to a point: its unit direction, the foot of the point on it, and how far off and to which side. */
export interface Near { segment: Segment; dx: number; dz: number; fx: number; fz: number; distance: number; right: boolean; }
/** Weights by a vehicle's content id, or by a body's name. */
type Mix = Record<string, number>;
/** Weights by family that hold within `within` metres of a public place of the kinds listed (labels.ts). */
export interface NearRule<T> { places: string[]; within: number; weights: T }
export interface Cars {
  spacing: number; cell: number; fires: number; burnt: number; slewed: number;
  /** A family's bodies by their weights, changed by the district's style and then near places (README, "Cars"). */
  bodies: Record<string, Mix>; styles: Record<string, Record<string, Mix>>; near: NearRule<Record<string, Mix>>[];
  looks: Record<string, [string, number][]>; paints: Record<string, number>; bodyPaints: Record<string, Mix>;
  /** Metres within which no two cars are one kind where another will do, and the most meshes of cars a chunk holds. */
  apart: number; perChunk: number;
  parked: {
    perKm: number; least: number; most: number; apart: number; junction: number; clear: number; fromSpawn: number; classes: string[];
    lots: { classes: string[]; least: number; most: number; apart: number; perSector: number };
    trailers?: { styles: string[]; perSector: number };
    kinds: Mix; styles: Record<string, Mix>; districts: Record<string, Mix>; near: NearRule<Mix>[];
    hurt: { share: number; condition: [number, number] };
    /** Bands of a tank's fraction as [from, to, weight]. */
    fuel: [number, number, number][];
  };
}

/** The row of `rows` a hash `h` of 32 bits lands on, by their weights. */
const pick = <T,>(rows: readonly (readonly [T, number])[], h: number): T => {
  const total = rows.reduce((n, r) => n + r[1], 0); let at = (h / 4294967296) * total;
  for (const [value, weight] of rows) { if (at < weight) return value; at -= weight; }
  return rows.at(-1)![0];
};

export function roadIndex(site: Site): { near: (x: number, z: number, reach: number) => Near | null; segments: Segment[]; junction: (x: number, z: number, reach: number) => boolean } {
  const file = join(site.source, "base/roads.geojson"); const segments: Segment[] = [];
  const bins = new Map<number, Segment[]>(); const ends = new Map<number, Set<number>>();
  const key = (x: number, z: number): number => binKey(Math.floor(x / 32), Math.floor(z / 32));
  if (existsSync(file)) {
    const lines = readRoads<{ geometry: { type: string; coordinates: number[][] | number[][][] }; properties: { mtfcc?: string; width_m?: number; from_m?: number; runs_from_m?: number[] } }>(site.source);
    lines.forEach((f, line) => {
      const runs = f.geometry.type === "MultiLineString" ? f.geometry.coordinates as number[][][] : [f.geometry.coordinates as number[][]];
      // Metres from the whole piece's start, where the frame cut it (tools/mapdata/streets.py from_m), and where each run
      // of one that leaves the frame and comes back starts (runs_from_m).
    const id = lineId(f, line); const seed = textSeed(id); let from = typeof f.properties.from_m === "number" ? f.properties.from_m : 0;
      const starts = f.properties.runs_from_m?.length === runs.length ? f.properties.runs_from_m : null;
      for (const [r, run] of runs.entries()) {
        if (starts) from = starts[r]!;
        const points = run.map(([e, n]) => site.toLattice(e!, n!));
        // A junction is a point two lines share, or a line's end (README, "Cars"). Keyed by its half metres, kept
        // positive, so that a point of a line past the map's edge keeps a key of its own.
        for (const [i, [x, z]] of points.entries()) {
          const k = (Math.round(x * 2) + 65536) * 131072 + Math.round(z * 2) + 65536;
          if (!ends.has(k)) ends.set(k, new Set()); ends.get(k)!.add(i === 0 || i === points.length - 1 ? -1 - line : line);
        }
        for (let i = 1; i < points.length; i++) {
          const [ax, az] = points[i - 1]!; const [bx, bz] = points[i]!;
          const length = Math.hypot(bx - ax, bz - az);
          if (length < .01) continue;
          segments.push({ ax, az, bx, bz, half: (f.properties.width_m ?? 8) / 2, mtfcc: f.properties.mtfcc ?? "", line, id, seed, from });
          from += length;
        }
      }
    });
  }
  // In the order of their pieces' ids and then along each, which another order of the rows does not change.
  segments.sort((a, b) => byText(a.id, b.id) || a.from - b.from);
  for (const s of segments) {
    const length = Math.hypot(s.bx - s.ax, s.bz - s.az);
    for (let d = 0; d <= length + 32; d += 16) {
      const t = Math.min(1, d / length); const k = key(s.ax + (s.bx - s.ax) * t, s.az + (s.bz - s.az) * t);
      if (!bins.has(k)) bins.set(k, []); const bin = bins.get(k)!; if (bin.at(-1) !== s) bin.push(s);
    }
  }
  const junctions: [number, number][] = [];
  for (const [k, lines] of ends) if (lines.size > 1 || [...lines].some((l) => l < 0)) junctions.push([(Math.floor(k / 131072) - 65536) / 2, ((k % 131072) - 65536) / 2]);
  const junctionBins = new Map<number, [number, number][]>();
  for (const j of junctions) { const k = key(j[0], j[1]); if (!junctionBins.has(k)) junctionBins.set(k, []); junctionBins.get(k)!.push(j); }
  const near = (x: number, z: number, reach: number): Near | null => {
    let best: Near | null = null;
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) for (const s of bins.get(binKey(bx, bz)) ?? []) {
      const ex = s.bx - s.ax; const ez = s.bz - s.az; const length = Math.hypot(ex, ez);
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (length * length)));
      const fx = s.ax + ex * t; const fz = s.az + ez * t; const distance = Math.hypot(x - fx, z - fz);
      // Engine x runs west, so the right of travel along (dx, dz) is (-dz, dx).
      if (distance <= reach && (!best || distance < best.distance)) best = { segment: s, dx: ex / length, dz: ez / length, fx, fz, distance, right: (x - fx) * -ez + (z - fz) * ex >= 0 };
    }
    return best;
  };
  const junction = (x: number, z: number, reach: number): boolean => {
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) for (const [jx, jz] of junctionBins.get(binKey(bx, bz)) ?? []) if (Math.hypot(jx - x, jz - z) < reach) return true;
    return false;
  };
  return { near, segments, junction };
}

/** The yaw in degrees of a frame whose u runs along (dx, dz) (ruin-geometry.ts worldPoint). */
export const frameYaw = (dx: number, dz: number): number => ((Math.atan2(-dz, dx) * 180 / Math.PI) % 360 + 360) % 360;

/** What the street pass knows of where a car stands: its district's style, and whether a place of the kinds is near. */
export interface CarGround { styleAt(x: number, z: number): string | undefined; near(x: number, z: number, places: readonly string[], within: number): boolean }
/** A car's kind where it stands; `begin` before an assembly's cars are picked, `placed` with its pieces once it is set down. */
export interface CarPicker { (x: number, z: number, family: string): string; begin(): void; placed(pieces: readonly StaticPiece[]): void }
interface Car { x: number; z: number; kind: string; mesh: string }

/**
 * Which kind of street car a car of `family` is where it stands (README, "Cars"): a body by the family's weights, changed
 * by the district's style and near places; a look of that body by the family's looks; and a paint by the paints'. In a
 * cell where a fire went through, a share `burnt` of the cars take the looks of "fire" in place of their family's, but
 * for a big vehicle's. A chunk holds the meshes of at most
 * `perChunk` looks: a car whose look would be one more takes one of those it holds that its family may be. A car is not
 * the kind of one within `apart` metres where another paint, or another look its family may be, will do.
 */
export function carPicker(cars: Cars, seed: number, ground: CarGround): CarPicker {
  const bodyOf = new Map(STREET_LOOKS.map((l) => [l.mesh, l.body]));
  for (const [family, rows] of Object.entries(cars.looks)) for (const [mesh] of rows) if (!STREET_KINDS[mesh]) throw new Error(`street.cars.looks.${family} names ${mesh}, which is no street car's look`);
  const placed = new Map<number, Car[]>(); const pending: Car[] = []; const chunks = new Map<number, Set<string>>();
  const bin = (x: number, z: number): number => binKey(Math.floor(x / 16), Math.floor(z / 16));
  const chunkOf = (x: number, z: number): number => binKey(Math.floor(x / 64), Math.floor(z / 64));
  const near = (x: number, z: number): Car[] => {
    const out = pending.filter((c) => Math.hypot(c.x - x, c.z - z) < cars.apart);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const c of placed.get(binKey(Math.floor(x / 16) + dx, Math.floor(z / 16) + dz)) ?? []) if (Math.hypot(c.x - x, c.z - z) < cars.apart) out.push(c);
    return out;
  };
  const held = (x: number, z: number): Set<string> => new Set([...(chunks.get(chunkOf(x, z)) ?? []), ...pending.filter((c) => chunkOf(c.x, c.z) === chunkOf(x, z)).map((c) => c.mesh)]);
  /** The looks a car of `family` may be at (x, z), each with its weight: its body's times its look's. */
  const choices = (x: number, z: number, family: string, burnt: boolean): [string, number][] => {
    const rows = cars.looks[burnt ? "fire" : family] ?? (family.startsWith("core:") ? [[family, 1] as [string, number]] : undefined);
    if (!rows) throw new Error(`no cars of the family "${family}" in street.cars.looks`);
    const weights = cars.bodies[family];
    if (burnt || !weights) return rows;
    const style = ground.styleAt(x, z);
    let mix: Mix = { ...weights, ...(style ? cars.styles[style]?.[family] : undefined) };
    for (const rule of cars.near) if (rule.weights[family] && ground.near(x, z, rule.places, rule.within)) mix = { ...mix, ...rule.weights[family] };
    // Each body's looks share its weight by their own.
    const share = new Map<string, number>();
    for (const [mesh, w] of rows) share.set(bodyOf.get(mesh)!, (share.get(bodyOf.get(mesh)!) ?? 0) + w);
    return rows.flatMap(([mesh, w]): [string, number][] => { const body = bodyOf.get(mesh)!; const b = mix[body] ?? 0; return b > 0 ? [[mesh, (b * w) / share.get(body)!]] : []; });
  };
  const paintsOf = (mesh: string): [string, number][] => {
    const weights = cars.bodyPaints[bodyOf.get(mesh)!] ?? cars.paints;
    const out = STREET_KINDS[mesh]!.map((k): [string, number] => [k.id, weights[k.paint!] ?? (cars.bodyPaints[bodyOf.get(mesh)!] ? 0 : 1)]).filter(([, w]) => w > 0);
    return out.length > 0 ? out : STREET_KINDS[mesh]!.map((k): [string, number] => [k.id, 1]);
  };
  const picker = ((x: number, z: number, family: string): string => {
    // In a cell a fire went through, a share `burnt` of the cars burnt out; the rest left as they stood.
    const burnt = family !== "big" && hash3(Math.floor(x / cars.cell), Math.floor(z / cars.cell), seed + 991) / 4294967296 < cars.fires
      && hash3(Math.round(x * 4), Math.round(z * 4), seed + 997) / 4294967296 < cars.burnt;
    let rows = choices(x, z, family, burnt);
    if (rows.length === 0) throw new Error(`no car of the family "${family}" may stand at ${x.toFixed(0)}, ${z.toFixed(0)}`);
    // A full chunk's car is one of the looks it holds, where its family may be one.
    const meshes = held(x, z);
    const kept = rows.filter(([mesh]) => meshes.has(mesh));
    if (meshes.size >= cars.perChunk && kept.length > 0) rows = kept;
    const others = near(x, z);
    const taken = new Set(others.map((c) => c.kind));
    let mesh = pick(rows, hash3(Math.round(x * 4), Math.round(z * 4), seed + 977));
    const kindOf = (look: string): string => {
      const kinds = STREET_KINDS[look]!;
      if (kinds.length === 1) return kinds[0]!.id;
      const paints = paintsOf(look);
      const first = pick(paints, hash3(Math.round(z * 4), Math.round(x * 4), seed + 983));
      if (!taken.has(first)) return first;
      // The next paint along by weight, from where the hash fell, that none near has.
      const order = [...paints].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      const from = order.findIndex(([id]) => id === first);
      for (let k = 1; k < order.length; k++) { const id = order[(from + k) % order.length]![0]; if (!taken.has(id)) return id; }
      return first;
    };
    let kind = kindOf(mesh);
    if (taken.has(kind)) {
      // An unpainted look, or every paint near: another look the car may be, that none near is.
      const free = rows.filter(([m]) => m !== mesh && !others.some((c) => c.mesh === m));
      if (free.length > 0) { mesh = pick(free, hash3(Math.round(x * 4), Math.round(z * 4), seed + 979)); kind = kindOf(mesh); }
    }
    pending.push({ x, z, kind, mesh });
    return kind;
  }) as CarPicker;
  picker.begin = () => { pending.length = 0; };
  picker.placed = (pieces) => {
    pending.length = 0;
    for (const p of pieces) {
      const look = wreckLook(p.kind); if (!look) continue;
      const k = bin(p.x, p.z); if (!placed.has(k)) placed.set(k, []); placed.get(k)!.push({ x: p.x, z: p.z, kind: p.kind, mesh: look.mesh });
      const c = chunkOf(p.x, p.z); if (!chunks.has(c)) chunks.set(c, new Set()); chunks.get(c)!.add(look.mesh);
    }
  };
  return picker;
}

/** A parked vehicle where it stands, with the ranges its condition (none for a whole one) and its fuel are rolled in. */
export interface Parked { kind: string; x: number; z: number; yaw: number; district: string; lot: boolean; condition?: [number, number]; fuel: [number, number]; }
/** A kind a city may park: its content id and its definition. */
export interface Fleet { id: string; def: WheelVehicleDefinition; }

/**
 * Drivable cars a new world parks, owned by nobody (README, "Cars"): at the right kerb of a street or a car park's road
 * of the listed classes, turned along it, away from junctions, on dry street ground level enough for the kind to drive
 * off, its envelope, door room and a margin clear of every piece, every reserved route and every other parked car. Each
 * place's kind is drawn by the weights of its district and the places near it. Each sector of the lattice takes a few
 * car parks first, each holding several, then so many a kilometre of its street, within its least and most, chosen by a
 * hash and spread apart; intact streets, with fewest pieces near, first. A share of them are hurt, and each one's fuel is
 * drawn from a band. A sector's cars are chosen among its own places, so what a map parks in a sector it holds whole is
 * the same however far the map runs.
 */
export function parkCars(site: Site, pieces: readonly StaticPiece[], roads: ReturnType<typeof roadIndex>, cars: Cars, seed: number, fleet: readonly Fleet[], near: CarGround["near"] = () => false): Parked[] {
  const rules = cars.parked; const { ground } = site; const { nx, nz, x0, z0, x1, z1 } = ground.grid;
  const at = (x: number, z: number): number => Math.max(0, Math.min(nz - 1, Math.round((z1 - z) / 2))) * nx + Math.max(0, Math.min(nx - 1, Math.round((x1 - x) / 2)));
  const named = new Map(fleet.map((v) => [v.id, v]));
  for (const id of new Set([rules.kinds, ...Object.values(rules.styles), ...Object.values(rules.districts), ...rules.near.map((r) => r.weights)].flatMap(Object.keys))) if (!named.has(id)) throw new Error(`street.cars.parked weighs ${id}, which is not a car of the fleet`);
  if (rules.fuel.length === 0) throw new Error("street.cars.parked.fuel has no bands");
  // A district's weights are the defaults changed by its style's, then by its own, then by the places near (x, z).
  const mixes = new Map<string, [Fleet, number][]>();
  const mixOf = (index: number, x: number, z: number): [Fleet, number][] => {
    const district = site.world.districts[index - 1]!;
    const close = rules.near.map((r) => near(x, z, r.places, r.within));
    const key = `${index}|${close.map(Number).join("")}`;
    const weights: Mix = { ...rules.kinds, ...rules.styles[district.style], ...rules.districts[district.name] };
    for (const [i, r] of rules.near.entries()) if (close[i]) Object.assign(weights, r.weights);
    if (!mixes.has(key)) mixes.set(key, Object.entries(weights).filter(([, w]) => w > 0).map(([id, w]) => [named.get(id)!, w]));
    return mixes.get(key)!;
  };
  // Each kind's envelope with the door room its seats' entries need, and the margin round both.
  const rooms = new Map(fleet.map(({ id, def }) => {
    const spec = def.spec; const door = Math.max(spec.halfWidth, ...def.seats.map((s) => Math.abs(s.entry[0])));
    const side = door + rules.clear; const end = spec.halfLength + rules.clear;
    return [id, { spec, side, end, reach: Math.hypot(side, end) }];
  }));
  type Room = NonNullable<ReturnType<typeof rooms.get>>;
  const obstacles = obstacleIndex(pieces);
  const routes = site.growthRoutes.flatMap((r) => r.points.slice(1).map((b, i) => ({ a: r.points[i]!, b, width: r.width })));
  const routeBins = new Map<number, typeof routes>();
  for (const r of routes) for (let z = Math.floor((Math.min(r.a.z, r.b.z) - r.width) / 64); z <= Math.floor((Math.max(r.a.z, r.b.z) + r.width) / 64); z++) for (let x = Math.floor((Math.min(r.a.x, r.b.x) - r.width) / 64); x <= Math.floor((Math.max(r.a.x, r.b.x) + r.width) / 64); x++) {
    const k = binKey(x, z); if (!routeBins.has(k)) routeBins.set(k, []); routeBins.get(k)!.push(r);
  }
  const crossesRoute = (x: number, z: number, c: number, s: number, y: number, room: Room): boolean => {
    const near = new Set<(typeof routes)[number]>(); const { reach } = room;
    for (let bz = Math.floor((z - reach) / 64); bz <= Math.floor((z + reach) / 64); bz++) for (let bx = Math.floor((x - reach) / 64); bx <= Math.floor((x + reach) / 64); bx++) for (const r of routeBins.get(binKey(bx, bz)) ?? []) near.add(r);
    for (const r of near) {
      if (Math.min(r.a.y, r.b.y) - .5 > y + room.spec.height + 1 || Math.max(r.a.y, r.b.y) + 2.5 < y) continue;
      // The route's stretch in the car's frame, grown by its half width: does it cross the car's room?
      const local = (p: { x: number; z: number }): [number, number] => [(p.x - x) * c - (p.z - z) * s, (p.x - x) * s + (p.z - z) * c];
      const a = local(r.a); const b = local(r.b); const half = [room.side + r.width / 2, room.end + r.width / 2];
      let enter = 0; let leave = 1; let misses = false;
      for (let axis = 0; axis < 2 && !misses; axis++) {
        const delta = b[axis]! - a[axis]!;
        if (Math.abs(delta) < 1e-8) misses = Math.abs(a[axis]!) >= half[axis]!;
        else { const t0 = (-half[axis]! - a[axis]!) / delta; const t1 = (half[axis]! - a[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
      }
      if (!misses && enter <= leave) return true;
    }
    return false;
  };
  // A candidate's car park (a lot's or its road's id, hashed) and its sector of the lattice.
  type Candidate = Omit<Parked, "condition" | "fuel"> & { rank: number; clutter: number; group: number; sector: number; room: Room };
  const candidates: Candidate[] = []; const length = new Map<number, number>();
  const sectorOf = (x: number, z: number): number => binKey(Math.floor(x / SECTOR), Math.floor(z / SECTOR));
  const STREETS = new Set<number>([S.STREET, S.HIGHWAY]);
  // A lot's car stands in its stall, on the lot's ground or its aisle's.
  const LOT_GROUND = new Set<number>([S.LOT, S.STREET]);
  /** A car of a kind drawn for its district at (x, z), nose along (dx, dz), if every test passes there. */
  const tryPlace = (x: number, z: number, dx: number, dz: number, lot: boolean, group: number, under: ReadonlySet<number>, chosen?: string, stallHalfLength = Infinity): void => {
    const index = ground.district[at(x, z)]!; const district = site.world.districts[index - 1]?.name ?? "";
    if (!district) return;
    const districtMix = mixOf(index, x, z);
    // The bumper can overhang the painted end by half a metre if the whole body and door room are clear.
    const mix = Number.isFinite(stallHalfLength) ? districtMix.filter(([kind]) => kind.def.spec.halfLength <= stallHalfLength + .5) : districtMix;
    if (mix.length === 0) return;
    const id = chosen ?? pick(mix, hash3(Math.round(z), Math.round(x), seed + 1207)).id; const room = rooms.get(id)!; const { spec } = room;
    if (Math.min(x - x0, z - z0, x1 - x, z1 - z) < room.reach) return;
    const yaw = Math.atan2(dx, dz); const c = Math.cos(yaw); const sn = Math.sin(yaw);
    const corner = (u: number, v: number): [number, number] => [x + u * c + v * sn, z - u * sn + v * c];
    const axles = spec.axles ?? [{ z: spec.wheelbase / 2, track: spec.track }, { z: -spec.wheelbase / 2, track: spec.track }];
    const body = [[-spec.halfWidth, -spec.halfLength], [spec.halfWidth, -spec.halfLength], [spec.halfWidth, spec.halfLength], [-spec.halfWidth, spec.halfLength], [0, 0]].map(([u, v]) => corner(u!, v!));
    const wheels = axles.flatMap(a => [corner(a.track / 2, a.z), corner(-a.track / 2, a.z)]);
    const dry = ([px, pz]: [number, number]) => under.has(ground.surface[at(px, pz)]!) && site.groundAt(px, pz) >= site.waterAt(px, pz) + .3;
    if (!body.every(dry) || !wheels.every(dry)) return;
    const h = wheels.map(([px, pz]) => site.groundAt(px, pz));
    const y = site.groundAt(x, z), last = h.length - 2;
    const along = (h[0]! + h[1]! - h[last]! - h[last + 1]!) / (2 * (axles[0]!.z - axles.at(-1)!.z));
    const across = Math.max(...axles.map((a, i) => Math.abs(h[2 * i]! - h[2 * i + 1]!) / a.track));
    if (1 / Math.hypot(1, along, across) < spec.minGroundNormal + .1 || Math.max(...h) - Math.min(...h) > spec.maxRise) return;
    const degrees = yaw * 180 / Math.PI;
    if (obstacles.hits({ x, y: y + (spec.height + 1) / 2, z, yaw: degrees, size: [room.side * 2, spec.height + 1, room.end * 2] }) || crossesRoute(x, z, c, sn, y, room)) return;
    candidates.push({ kind: id, x, z, yaw: degrees, district, lot, rank: hash3(Math.round(x), Math.round(z), seed + 1213), clutter: obstacles.count(x, z, 12), group, sector: sectorOf(x, z), room });
  };
  // A lot's stalls where the streets stage drew them (tools/mapdata/streets.py), in the map's projection metres: a car
  // in a stall, nose to the aisle it drives out by. Where there are none, a lot's cars stand along its road's kerb.
  const stallsFile = join(site.source, "base", "stalls.json");
  const stalls = existsSync(stallsFile) ? JSON.parse(readFileSync(stallsFile, "utf8")) as { lot: string; e: number; n: number; fe: number; fn: number }[] : [];
  const { west, north } = ground.grid;
  for (const st of stalls) {
    const x = x1 - (st.e - west); const z = z1 - (north - st.n);
    const fx = x1 - (st.fe - west); const fz = z1 - (north - st.fn);
    const span = Math.hypot(fx - x, fz - z) || 1;
    tryPlace(x, z, (fx - x) / span, (fz - z) / span, true, textSeed(st.lot), LOT_GROUND, undefined, span);
  }
  for (const s of roads.segments) {
    const lot = rules.lots.classes.includes(s.mtfcc);
    if (lot ? stalls.length > 0 : !rules.classes.includes(s.mtfcc)) continue;
    const ex = s.bx - s.ax; const ez = s.bz - s.az; const span = Math.hypot(ex, ez); const dx = ex / span; const dz = ez / span;
    for (let d = 0; d < span; d += 4) {
      const cx = s.ax + dx * d; const cz = s.az + dz * d;
      const index = ground.district[at(cx, cz)]!; const district = site.world.districts[index - 1]?.name ?? "";
      if (!district) continue;
      if (!lot) length.set(sectorOf(cx, cz), (length.get(sectorOf(cx, cz)) ?? 0) + 4);
      // A car park's road may take a car at every step, a street one step in six.
      if ((!lot && hash3(Math.round(cx), Math.round(cz), seed + 1201) % 6 !== 0) || roads.junction(cx, cz, rules.junction)) continue;
      // At the right kerb of the way it was drawn, nose along it: the kind's half width in from the kerb.
      const mix = mixOf(index, cx, cz); if (mix.length === 0) continue;
      const { id } = pick(mix, hash3(Math.round(cz), Math.round(cx), seed + 1207)); const { spec } = rooms.get(id)!;
      const off = s.half - spec.halfWidth - .3;
      tryPlace(cx - dz * off, cz + dx * off, dx, dz, lot, s.seed, STREETS, id);
    }
  }
  // Neither one's room meets the other's body: each may open its doors, and they stand clear of each other.
  const flat = (p: Candidate, side: number, end: number): Box => ({ x: p.x, y: 0, z: p.z, yaw: p.yaw, size: [side * 2, 1, end * 2] });
  const clash = (p: Candidate, q: Candidate): boolean => meets(flat(p, p.room.side, p.room.end), flat(q, q.room.spec.halfWidth, q.room.spec.halfLength)) || meets(flat(q, q.room.side, q.room.end), flat(p, p.room.spec.halfWidth, p.room.spec.halfLength));
  const free = (p: Candidate, others: readonly Candidate[], apart: number): boolean => !others.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < apart || clash(p, q));
  const out: Candidate[] = []; const { lots } = rules;
  const bySector = new Map<number, Candidate[]>();
  for (const p of candidates) { const list = bySector.get(p.sector); if (list) list.push(p); else bySector.set(p.sector, [p]); }
  for (const sector of [...new Set([...length.keys(), ...bySector.keys()])].sort((a, b) => a - b)) {
    const mine = (bySector.get(sector) ?? []).sort((a, b) => a.clutter - b.clutter || a.rank - b.rank);
    // Kept `apart` from the sector's other cars, and clear of every car's room: one beyond its edge decides only a clash.
    const here: Candidate[] = [];
    const fits = (p: Candidate): boolean => free(p, here, rules.apart) && !out.some((q) => q.sector !== sector && clash(p, q));
    // Its car parks first, each a car park's road holding several nose to tail.
    const roadsOf = new Map<number, Candidate[]>();
    for (const p of mine) if (p.lot) { if (!roadsOf.has(p.group)) roadsOf.set(p.group, []); roadsOf.get(p.group)!.push(p); }
    let held = 0;
    for (const group of [...roadsOf.keys()].sort((a, b) => hash3(a, 0, seed + 1229) - hash3(b, 0, seed + 1229) || a - b)) {
      if (held >= lots.perSector) break;
      const want = lots.least + hash3(group, 1, seed + 1229) % Math.max(1, lots.most - lots.least + 1);
      const road = roadsOf.get(group)!; const first = road.find(fits);
      if (!first) continue;
      // The rest nearest the first, so the car park's cars stand together.
      const chosen = [first];
      for (const p of [...road].sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z))) if (chosen.length < want && free(p, chosen, lots.apart) && fits(p)) chosen.push(p);
      if (chosen.length >= lots.least) { out.push(...chosen); here.push(...chosen); held++; }
    }
    const want = Math.max(rules.least, Math.min(rules.most, Math.round((length.get(sector) ?? 0) / 1000 * rules.perKm)));
    let streets = 0;
    for (const p of mine) {
      if (streets >= want) break;
      if (!p.lot && fits(p)) { out.push(p); here.push(p); streets++; }
    }
  }
  const bands = rules.fuel.map((b) => [b, b[2]] as const);
  return out.map((p) => {
    const hurt = hash3(Math.round(p.x * 4), Math.round(p.z * 4), seed + 1231) / 4294967296 < rules.hurt.share;
    const [from, to] = pick(bands, hash3(Math.round(p.z * 4), Math.round(p.x * 4), seed + 1237));
    return { kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, district: p.district, lot: p.lot, ...(hurt ? { condition: [rules.hurt.condition[0], rules.hurt.condition[1]] as [number, number] } : {}), fuel: [from, to] };
  });
}
