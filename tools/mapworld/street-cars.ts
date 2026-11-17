// Cars in a city's streets: which way a street runs at a point, from the centrelines of base/roads.geojson; which wreck
// of the compact a car is, by a hash of where it stands; and where drivable ones of the road fleet are parked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WRECK_KINDS, WRECK_PAINTS } from "../../content/vehicles/wrecks.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { S } from "./ground.ts";
import { hash3 } from "./raster.ts";
import { meets, obstacleIndex, type Box } from "./ruin-obstacles.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** A centreline's stretch between two of its points, in engine metres, with its class (TIGER MTFCC) and half width. */
interface Segment { ax: number; az: number; bx: number; bz: number; half: number; mtfcc: string; line: number; }
/** The nearest stretch to a point: its unit direction, the foot of the point on it, and how far off and to which side. */
export interface Near { segment: Segment; dx: number; dz: number; fx: number; fz: number; distance: number; right: boolean; }
/** Weights by a vehicle's content id. */
type Mix = Record<string, number>;
export interface Cars {
  spacing: number; cell: number; fires: number; slewed: number;
  looks: Record<string, [string, number][]>; paints: Record<string, number>;
  parked: {
    perKm: number; least: number; most: number; apart: number; junction: number; clear: number; fromSpawn: number; classes: string[];
    lots: { classes: string[]; least: number; most: number; apart: number; perDistrict: number };
    kinds: Mix; styles: Record<string, Mix>; districts: Record<string, Mix>;
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
  const key = (x: number, z: number): number => Math.floor(x / 32) + Math.floor(z / 32) * 4096;
  if (existsSync(file)) {
    const lines = (JSON.parse(readFileSync(file, "utf8")) as { features: { geometry: { type: string; coordinates: number[][] | number[][][] }; properties: { mtfcc?: string; width_m?: number } }[] }).features;
    lines.forEach((f, line) => {
      const runs = f.geometry.type === "MultiLineString" ? f.geometry.coordinates as number[][][] : [f.geometry.coordinates as number[][]];
      for (const run of runs) {
        const points = run.map(([e, n]) => site.toEngine(e!, n!));
        // A junction is a point two lines share, or a line's end (README, "Cars").
        for (const [i, [x, z]] of points.entries()) {
          const k = Math.round(x * 2) * 65536 + Math.round(z * 2);
          if (!ends.has(k)) ends.set(k, new Set()); ends.get(k)!.add(i === 0 || i === points.length - 1 ? -1 - line : line);
        }
        for (let i = 1; i < points.length; i++) {
          const [ax, az] = points[i - 1]!; const [bx, bz] = points[i]!;
          if (Math.hypot(bx - ax, bz - az) < .01) continue;
          const s: Segment = { ax, az, bx, bz, half: (f.properties.width_m ?? 8) / 2, mtfcc: f.properties.mtfcc ?? "", line };
          segments.push(s);
          const length = Math.hypot(bx - ax, bz - az);
          for (let d = 0; d <= length + 32; d += 16) {
            const t = Math.min(1, d / length); const k = key(ax + (bx - ax) * t, az + (bz - az) * t);
            if (!bins.has(k)) bins.set(k, []); const bin = bins.get(k)!; if (bin.at(-1) !== s) bin.push(s);
          }
        }
      }
    });
  }
  const junctions: [number, number][] = [];
  for (const [k, lines] of ends) if (lines.size > 1 || [...lines].some((l) => l < 0)) junctions.push([Math.floor(k / 65536) / 2, (k % 65536) / 2]);
  const junctionBins = new Map<number, [number, number][]>();
  for (const j of junctions) { const k = key(j[0], j[1]); if (!junctionBins.has(k)) junctionBins.set(k, []); junctionBins.get(k)!.push(j); }
  const near = (x: number, z: number, reach: number): Near | null => {
    let best: Near | null = null;
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) for (const s of bins.get(bx + bz * 4096) ?? []) {
      const ex = s.bx - s.ax; const ez = s.bz - s.az; const length = Math.hypot(ex, ez);
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (length * length)));
      const fx = s.ax + ex * t; const fz = s.az + ez * t; const distance = Math.hypot(x - fx, z - fz);
      // Engine x runs west, so the right of travel along (dx, dz) is (-dz, dx).
      if (distance <= reach && (!best || distance < best.distance)) best = { segment: s, dx: ex / length, dz: ez / length, fx, fz, distance, right: (x - fx) * -ez + (z - fz) * ex >= 0 };
    }
    return best;
  };
  const junction = (x: number, z: number, reach: number): boolean => {
    for (let bz = Math.floor((z - reach) / 32); bz <= Math.floor((z + reach) / 32); bz++) for (let bx = Math.floor((x - reach) / 32); bx <= Math.floor((x + reach) / 32); bx++) for (const [jx, jz] of junctionBins.get(bx + bz * 4096) ?? []) if (Math.hypot(jx - x, jz - z) < reach) return true;
    return false;
  };
  return { near, segments, junction };
}

/** The yaw in degrees of a frame whose u runs along (dx, dz) (ruin-geometry.ts worldPoint). */
export const frameYaw = (dx: number, dz: number): number => ((Math.atan2(-dz, dx) * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Which kind of wreck a car of `family` is where it stands: a look by the family's weights, and a paint by the paints'.
 * A cell where a fire went through takes the family "fire" in place of any.
 */
export function carPicker(cars: Cars, seed: number): (x: number, z: number, family: string) => string {
  const paints = WRECK_PAINTS.map((p, i) => [i, cars.paints[p.name] ?? 1] as [number, number]);
  return (x, z, family) => {
    const burnt = hash3(Math.floor(x / cars.cell), Math.floor(z / cars.cell), seed + 991) / 4294967296 < cars.fires;
    const rows = cars.looks[burnt ? "fire" : family] ?? (family.startsWith("core:") ? [[family, 1] as [string, number]] : undefined);
    if (!rows) throw new Error(`no cars of the family "${family}" in street.cars.looks`);
    const look = pick(rows, hash3(Math.round(x * 4), Math.round(z * 4), seed + 977));
    const kinds = WRECK_KINDS[look]; if (!kinds) throw new Error(`no wreck look "${look}"`);
    return kinds.length === 1 ? kinds[0]! : kinds[pick(paints, hash3(Math.round(z * 4), Math.round(x * 4), seed + 983))]!;
  };
}

export interface Parked { kind: string; x: number; z: number; yaw: number; district: string; lot: boolean; }
/** A kind a city may park: its content id and its definition. */
export interface Fleet { id: string; def: WheelVehicleDefinition; }

/**
 * Drivable cars a new world parks, owned by nobody (README, "Cars"): at the right kerb of a street or a car park's road
 * of the listed classes, turned along it, away from junctions, on dry street ground level enough for the kind to drive
 * off, its envelope, door room and a margin clear of every piece, every reserved route and every other parked car. Each
 * place's kind is drawn by the weights of its district. A district takes a few car parks first, each holding several,
 * then so many a kilometre of street, within its least and most, chosen by a hash and spread apart; intact streets, with
 * fewest pieces near, first.
 */
export function parkCars(site: Site, pieces: readonly StaticPiece[], roads: ReturnType<typeof roadIndex>, cars: Cars, seed: number, fleet: readonly Fleet[]): Parked[] {
  const rules = cars.parked; const { ground } = site; const size = (ground.n - 1) * 2;
  const at = (x: number, z: number): number => Math.max(0, Math.min(ground.n - 1, Math.round((size - z) / 2))) * ground.n + Math.max(0, Math.min(ground.n - 1, Math.round((size - x) / 2)));
  const named = new Map(fleet.map((v) => [v.id, v]));
  for (const id of new Set([rules.kinds, ...Object.values(rules.styles), ...Object.values(rules.districts)].flatMap(Object.keys))) if (!named.has(id)) throw new Error(`street.cars.parked weighs ${id}, which is not a car of the fleet`);
  // A district's weights are the defaults changed by its style's, then by its own.
  const mixes = new Map<number, [Fleet, number][]>();
  const mixOf = (index: number): [Fleet, number][] => {
    const district = site.world.districts[index - 1]!;
    if (!mixes.has(index)) mixes.set(index, Object.entries({ ...rules.kinds, ...rules.styles[district.style], ...rules.districts[district.name] }).filter(([, w]) => w > 0).map(([id, w]) => [named.get(id)!, w]));
    return mixes.get(index)!;
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
    const k = x + z * 1024; if (!routeBins.has(k)) routeBins.set(k, []); routeBins.get(k)!.push(r);
  }
  const crossesRoute = (x: number, z: number, c: number, s: number, y: number, room: Room): boolean => {
    const near = new Set<(typeof routes)[number]>(); const { reach } = room;
    for (let bz = Math.floor((z - reach) / 64); bz <= Math.floor((z + reach) / 64); bz++) for (let bx = Math.floor((x - reach) / 64); bx <= Math.floor((x + reach) / 64); bx++) for (const r of routeBins.get(bx + bz * 1024) ?? []) near.add(r);
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
  type Candidate = Parked & { rank: number; clutter: number; line: number; room: Room };
  const candidates: Candidate[] = []; const length: Record<string, number> = {};
  for (const s of roads.segments) {
    const lot = rules.lots.classes.includes(s.mtfcc);
    if (!lot && !rules.classes.includes(s.mtfcc)) continue;
    const ex = s.bx - s.ax; const ez = s.bz - s.az; const span = Math.hypot(ex, ez); const dx = ex / span; const dz = ez / span;
    for (let d = 0; d < span; d += 4) {
      const cx = s.ax + dx * d; const cz = s.az + dz * d;
      const index = ground.district[at(cx, cz)]!; const district = site.world.districts[index - 1]?.name ?? "";
      if (!district) continue;
      if (!lot) length[district] = (length[district] ?? 0) + 4;
      // A car park's road may take a car at every step, a street one step in six.
      if ((!lot && hash3(Math.round(cx), Math.round(cz), seed + 1201) % 6 !== 0) || roads.junction(cx, cz, rules.junction)) continue;
      const mix = mixOf(index); if (mix.length === 0) continue;
      const { id } = pick(mix, hash3(Math.round(cz), Math.round(cx), seed + 1207)); const room = rooms.get(id)!; const { spec } = room;
      // At the right kerb of the way it was drawn, nose along it.
      const off = s.half - spec.halfWidth - .3; const x = cx - dz * off; const z = cz + dx * off;
      if (Math.min(x, z, size - x, size - z) < room.reach) continue;
      const yaw = Math.atan2(dx, dz); const c = Math.cos(yaw); const sn = Math.sin(yaw);
      const corner = (u: number, v: number): [number, number] => [x + u * c + v * sn, z - u * sn + v * c];
      const wheels = [[spec.track / 2, spec.wheelbase / 2], [-spec.track / 2, spec.wheelbase / 2], [spec.track / 2, -spec.wheelbase / 2], [-spec.track / 2, -spec.wheelbase / 2]].map(([u, v]) => corner(u!, v!));
      const under = [[-spec.halfWidth, -spec.halfLength], [spec.halfWidth, -spec.halfLength], [spec.halfWidth, spec.halfLength], [-spec.halfWidth, spec.halfLength], [0, 0]].map(([u, v]) => corner(u!, v!));
      if (under.some(([px, pz]) => (ground.surface[at(px, pz)] !== S.STREET && ground.surface[at(px, pz)] !== S.HIGHWAY) || site.groundAt(px, pz) < .3)) continue;
      const h = wheels.map(([px, pz]) => site.groundAt(px, pz)); const y = site.groundAt(x, z);
      // The ground's normal under the four wheels, from its slope along and across.
      const along = ((h[0]! + h[1]!) - (h[2]! + h[3]!)) / 2 / spec.wheelbase; const across = ((h[0]! + h[2]!) - (h[1]! + h[3]!)) / 2 / spec.track;
      if (1 / Math.hypot(1, along, across) < spec.minGroundNormal + .1 || Math.max(...h) - Math.min(...h) > spec.maxRise) continue;
      const degrees = yaw * 180 / Math.PI;
      if (obstacles.hits({ x, y: y + (spec.height + 1) / 2, z, yaw: degrees, size: [room.side * 2, spec.height + 1, room.end * 2] }) || crossesRoute(x, z, c, sn, y, room)) continue;
      candidates.push({ kind: id, x, z, yaw: degrees, district, lot, rank: hash3(Math.round(x), Math.round(z), seed + 1213), clutter: obstacles.count(x, z, 12), line: s.line, room });
    }
  }
  // Neither one's room meets the other's body: each may open its doors, and they stand clear of each other.
  const flat = (p: Candidate, side: number, end: number): Box => ({ x: p.x, y: 0, z: p.z, yaw: p.yaw, size: [side * 2, 1, end * 2] });
  const clash = (p: Candidate, q: Candidate): boolean => meets(flat(p, p.room.side, p.room.end), flat(q, q.room.spec.halfWidth, q.room.spec.halfLength)) || meets(flat(q, q.room.side, q.room.end), flat(p, p.room.spec.halfWidth, p.room.spec.halfLength));
  const free = (p: Candidate, others: readonly Candidate[], apart: number): boolean => !others.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < apart || clash(p, q));
  const out: Candidate[] = []; const { lots } = rules;
  for (const district of [...new Set([...Object.keys(length), ...candidates.map((p) => p.district)])].sort()) {
    const mine = candidates.filter((p) => p.district === district).sort((a, b) => a.clutter - b.clutter || a.rank - b.rank);
    // Its car parks first, each a car park's road holding several nose to tail, each kept `apart` from every other car.
    const roadsOf = new Map<number, Candidate[]>();
    for (const p of mine) if (p.lot) { if (!roadsOf.has(p.line)) roadsOf.set(p.line, []); roadsOf.get(p.line)!.push(p); }
    let held = 0;
    for (const line of [...roadsOf.keys()].sort((a, b) => hash3(a, 0, seed + 1229) - hash3(b, 0, seed + 1229) || a - b)) {
      if (held >= lots.perDistrict) break;
      const want = lots.least + hash3(line, 1, seed + 1229) % Math.max(1, lots.most - lots.least + 1);
      const chosen: Candidate[] = [];
      for (const p of roadsOf.get(line)!) if (chosen.length < want && free(p, chosen, lots.apart) && free(p, out, rules.apart)) chosen.push(p);
      if (chosen.length >= lots.least) { out.push(...chosen); held++; }
    }
    const want = Math.max(rules.least, Math.min(rules.most, Math.round((length[district] ?? 0) / 1000 * rules.perKm)));
    let streets = 0;
    for (const p of mine) {
      if (streets >= want) break;
      if (!p.lot && free(p, out, rules.apart)) { out.push(p); streets++; }
    }
  }
  return out.map((p) => ({ kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, district: p.district, lot: p.lot }));
}
