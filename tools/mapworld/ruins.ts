import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { BREAK_AT, pieceMiddle, RUIN_SHAPES, type RuinFinish, type RuinShape } from "../../content/ruins.ts";
import { readLabels, resolveLabels, type Facts, type PublicPlace } from "./labels.ts";
import { bridgeHoles, corridorIndex, makeBridges } from "./bridges.ts";
import { gradeRoadEntrances, roadGroundSamples } from "./bridge-earthwork.ts";
import { accessPlanner, gradeApproaches, type Approach } from "./ruin-access.ts";
import { clearCirculation, reconcileRubble } from "./ruin-clearance.ts";
import { contextualize } from "./ruin-context.ts";
import { joinFrontages } from "./ruin-frontage.ts";
import { boxOf, extentOf, middleOf, obstacleIndex, obstructs, type Box } from "./ruin-obstacles.ts";
import { parkFreightTrailers } from "./freight.ts";
import { carPicker, frameYaw, parkCars, roadIndex } from "./street-cars.ts";
import { junctionAt, streetGraph } from "./street-graph.ts";
import { cornersOf, type Corner } from "./corners.ts";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { wreckLook } from "../../content/vehicles/wrecks.ts";
import { S } from "./ground.ts";
import { compactWalls, reserveRoutes, frameOf, inRing, Mason, tilesOf, worldPoint, type Frame } from "./ruin-geometry.ts";
import { assembly, layout } from "./ruin-layouts.ts";
import { ruleFor, vocabulary, type Rule, type Vocabulary, type Walks } from "./ruin-vocabulary.ts";
import { binKey, hash3 } from "./raster.ts";
import { readSurvey, surveyInventory } from "./survey.ts";
import { makeSigns, nearSign } from "./signs.ts";
import type { Footprint, Site, StaticLayer, StaticPiece } from "./statics.ts";

interface NamedPlace { id: string; name: string; footprint: number; layout: string; recipe: string; retain: number; finish: RuinFinish; note: string; source: string; }
interface Planned { f: Footprint; frame: Frame; rule: Rule; named?: NamedPlace; square: string; facts: Facts; }
export interface RuinRecord {
  exposure?: number; shelter?: number; party?: number[];
  firstPiece: number;
  footprint: number; part: number; name: string | null; district: string; square: string; recipe: string; special: string | null;
  x: number; y: number; z: number; yaw: number; width: number; depth: number; height: number; blocks: number; detail: number;
  form: string; collapse: string; rooms: Mason["rooms"]; falls: Mason["falls"];
  approaches: Approach[]; entries: Mason["entries"]; escapes: Mason["escapes"]; wings: Mason["wings"];
  kind: string; sourceHeight: number; heightFrom: string; kindFrom: string; researchFrom: string | null; routes: Mason["routes"]; provisional: boolean; modifiers: string[]; lore: string | null;
}
const digest = (pieces: readonly StaticPiece[]): string => {
  const h = new Bun.CryptoHasher("sha256");
  for (const p of pieces) h.update(`${p.kind},${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)},${p.yaw.toFixed(4)}\n`);
  return h.digest("hex");
};

export function makeRuins(site: Site): StaticPiece[] {
  if (site.world.heaps !== false) return [];
  const v = vocabulary(site.source);
  const data = readLabels(site.source);
  const named = JSON.parse(readFileSync(join(site.source, "ruins/places.json"), "utf8")) as NamedPlace[];
  const grid = site.ground.grid; const { nx, nz, x0, z0, x1, z1 } = grid; const chunksX = grid.sizeX / 64;
  const frames = new Map(site.footprints.map((f) => [f.building.id, frameOf(f, site)]));
  const ownerIndex = new Map(site.footprints.map((f, i) => [f.building.id, i]));
  const primary = new Map<number, Footprint>();
  for (const f of site.footprints) {
    const id = Math.floor(f.building.id / 4);
    if ((primary.get(id)?.building.area ?? 0) < f.building.area) primary.set(id, f);
  }
  // A named place is the city's own: one that stands on no footprint of this map is a broken anchor, never a quiet loss.
  const unplaced = named.filter((p) => !primary.has(p.footprint));
  if (unplaced.length > 0) throw new Error(`named places on no footprint of this map (ruins/places.json): ${unplaced.map((p) => p.name).join(", ")}`);
  const facts = resolveLabels(primary, data, v);
  const neighbours = new Map<string, Footprint[]>();
  for (const f of site.footprints) { const k = `${Math.floor(f.building.e / 64)},${Math.floor(f.building.n / 64)}`; if (!neighbours.has(k)) neighbours.set(k, []); neighbours.get(k)!.push(f); }

  const planned: Planned[] = site.footprints.map((f) => {
    const id = Math.floor(f.building.id / 4); const b = f.building;
    const square = `r${String(Math.min(31, Math.max(0, Math.floor((grid.north - b.n) / 254)))).padStart(2, "0")}c${String(Math.min(31, Math.max(0, Math.floor((b.e - grid.west) / 254)))).padStart(2, "0")}`;
    const n = primary.get(id) === f ? named.find((p) => p.footprint === id) : undefined;
    const resolved = facts.get(id)!;
    const cx = Math.floor(b.e / 64); const cz = Math.floor(b.n / 64); let count = 0;
    const nearby: { frame: Frame; height: number }[] = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (const other of neighbours.get(`${cx + dx},${cz + dz}`) ?? []) if (other !== f) {
      const distance = Math.hypot(other.building.e - b.e, other.building.n - b.n);
      if (distance < 64) count++;
      if (distance < 140) nearby.push({ frame: frames.get(other.building.id)!, height: facts.get(Math.floor(other.building.id / 4))!.height });
    }
    const [x, z] = site.toLattice(b.e, b.n); const index = Math.max(0, Math.min(site.ground.shore.length - 1, Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2)));
    let rule = ruleFor(f, v, resolved, { water: site.ground.shore[index]!, neighbours: count });
    if (n) rule = { ...rule, recipe: n.recipe, height: Math.min(v.budgets.maxHeight, Math.max(4, Math.floor(resolved.height * n.retain / 4) * 4)), finish: n.finish, bay: 8 };
    rule = contextualize(rule, frames.get(b.id)!, nearby, site.ground.shore[index]!, resolved.research?.built, v);
    return { f, frame: frames.get(b.id)!, rule, named: n, square, facts: resolved };
  }).sort((a, b) => Number(!!b.named) - Number(!!a.named) || Number(!!b.facts.label.name) - Number(!!a.facts.label.name) || b.rule.height - a.rule.height || a.f.building.id - b.f.building.id);
  const pieces: StaticPiece[] = [];
  const counts = new Uint32Array(chunksX * (grid.sizeZ / 64));
  const records: RuinRecord[] = [];
  const assemblies: StaticPiece[][] = [];
  const rejected: { part: number; reason: string }[] = [];
  const usedKinds: Record<string, number> = {};
  const ckey = (p: StaticPiece): number => Math.floor((p.z - z0) / 64) * chunksX + Math.floor((p.x - x0) / 64);
  const accept = (m: Mason): boolean => {
    if (pieces.length + m.pieces.length > v.budgets.maxCity) return false;
    const local = new Map<number, number>();
    for (const p of m.pieces) {
      if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite) || p.x < x0 || p.x >= x1 || p.z < z0 || p.z >= z1 || p.y < -64 || p.y > 2047) return false;
      const c = ckey(p); const num = (local.get(c) ?? 0) + 1; local.set(c, num);
      if (counts[c]! + num > v.budgets.maxChunk) return false;
    }
    for (const [c, num] of local) counts[c] = counts[c]! + num;
    for (const p of m.pieces) { pieces.push(p); usedKinds[p.kind] = (usedKinds[p.kind] ?? 0) + 1; }
    return true;
  };
  const bridges = makeBridges(site, accept);
  const infrastructureCount = pieces.length;
  const corridors = corridorIndex(bridges.corridors);
  const planAccess = accessPlanner(site, pieces);
  const entrances = bridges.records.flatMap(r => r.entrances);
  const roadGround = roadGroundSamples(site, entrances);
  // Reserve the real dry road, including its width, before choosing pedestrian door approaches. Unlike the
  // bridge deck this is solid earth: a route several metres below it must be replanned, not cut through it.
  for (const e of entrances) for (let k = 1; k < (e.runout?.length ?? 0); k++) {
    const a = e.runout![k - 1]!, b = e.runout![k]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    for (let side = -e.width / 2; side <= e.width / 2; side += 4) {
      const x = -(b.z - a.z) / length * side, z = (b.x - a.x) / length * side;
      const street = { x: a.x + x, y: site.groundAt(a.x + x, a.z + z), z: a.z + z };
      const door = { x: b.x + x, y: site.groundAt(b.x + x, b.z + z), z: b.z + z };
      planAccess.reserve([{ street, door, core: door, ramp: 1 }]);
    }
  }
  const keptAsGround: { part: number; name: string }[] = [];
  for (const p of planned) {
    const { f, rule } = p;
    // A named place whose footprint is its ground, as a hillside's seats are, is neither built on nor levelled.
    if (p.named?.layout === "ground") {
      keptAsGround.push({ part: f.building.id, name: p.named.name });
      // Only low growth on it, as on the ground round a low building.
      const across = (nx - 1) / 2; const fr = p.frame;
      for (let row = 0; row < (nz - 1) / 2; row++) for (let col = 0; col < across; col++) {
        const dx = x1 - col * 4 - fr.x; const dz = z1 - row * 4 - fr.z;
        if (Math.abs(dx * fr.c - dz * fr.s) <= fr.width / 2 && Math.abs(dx * fr.s + dz * fr.c) <= fr.depth / 2) site.lowPlants[row * across + col] = 1;
      }
      continue;
    }
    const original = p.frame;
    const samples = tilesOf(original, 4).map((t) => { const [x, z] = worldPoint(original, t.u, t.v); return site.groundAt(x, z); }).sort((a, b) => a - b);
    const base = Math.max(.5, Math.round((samples[Math.floor(samples.length / 2)] ?? site.groundAt(original.x, original.z)) * 16) / 16);
    const frame = bridgeHoles(original, corridors(original), base, rule.height);
    let built: Mason | null = null; let detail = 0; let approaches: Approach[] = [];
    const target = rule.recipe === "tower" && rule.height >= v.circulation.tallAbove ? v.circulation.tall : rule.recipe === "tower" && rule.height >= v.circulation.towerAbove ? v.circulation.tower : v.circulation.ordinary;
    const levels = [...new Set([Math.min(target, v.budgets.maxPlayableFloors), ...[12, 8].filter((n) => n < target && n <= v.budgets.maxPlayableFloors)])];
    const attempts = [...levels.map((playable) => ({ detail: 0, playable })), ...[1, 2, 3].map((detail) => ({ detail, playable: Math.max(1, Math.floor(v.circulation.ordinary / 2 ** detail)) }))];
    for (const attempt of attempts) {
      detail = attempt.detail;
      const m = new Mason(frame, base);
      const playable = attempt.playable;
      const r = detail === 3 ? { ...rule, height: Math.min(rule.height, 8), holes: .4, wall: 0 } : rule;
      layout(m, r, { seed: f.building.id ^ v.seed, playable, detail }, detail === 3 ? undefined : p.named?.layout);
      reserveRoutes(m); compactWalls(m);
      approaches = planAccess(m, ownerIndex.get(f.building.id)!);
      if (!approaches.length && m.alternatives.length) {
        const originalPieces = m.pieces.slice(); const entryCount = m.entries.length; const roomCount = m.rooms.length; const clearCount = m.clear.length;
        const supports = new Set<string>();
        for (const a of m.alternatives) {
          m.entries.push(a.entry);
          const key = a.support.join(","); if (!supports.has(key)) { supports.add(key); m.floor(a.support, 0, 8); m.rooms.push({ kind: "lobby", points: a.path }); }
          m.clear.push({ x: a.entry.x, z: a.entry.z, radius: 16 });
        }
        reserveRoutes(m); compactWalls(m); approaches = planAccess(m, ownerIndex.get(f.building.id)!);
        if (!approaches.length) {
          m.pieces.length = 0; m.pieces.push(...originalPieces); m.entries.length = entryCount; m.rooms.length = roomCount; m.clear.length = clearCount;
        }
      }
      if (m.pieces.length > 0 && accept(m)) { built = m; break; }
      if (m.pieces.length === 0) break;
    }
    if (!built) { rejected.push({ part: f.building.id, reason: samples.length === 0 ? "no 4 m tile fits" : "budget or bounds" }); continue; }
    assemblies.push(...built.assemblies);
    planAccess.reserve(approaches);
    levelFloor(site, frame, ownerIndex.get(f.building.id)!, base, roadGround);
    gradeApproaches(site, approaches, ownerIndex.get(f.building.id)!, roadGround);
    records.push({ firstPiece: pieces.length - built.pieces.length, footprint: Math.floor(f.building.id / 4), part: f.building.id, name: p.named?.name ?? p.facts.label.name ?? null,
      district: f.district?.name ?? "Unzoned", square: p.square, recipe: rule.recipe, special: p.named?.layout ?? null,
      x: frame.x, y: base, z: frame.z, yaw: frame.yaw, width: frame.width, depth: frame.depth,
      height: Math.max(...built.pieces.map((s) => { const name = s.kind.split("_")[1] as RuinShape; return pieceMiddle(name, s.y) + RUIN_SHAPES[name][1] / 2; })) - base,
      form: rule.formName ?? rule.recipe, collapse: rule.collapse ?? "shear", rooms: built.rooms, falls: built.falls, exposure: rule.event?.exposure, shelter: rule.event?.shelter, party: rule.party,
      blocks: built.pieces.length, detail, approaches, entries: built.entries, escapes: built.escapes, wings: built.wings, routes: built.routes, provisional: rule.provisional, modifiers: rule.matched, lore: p.facts.research?.lore ?? null, kind: p.facts.kind, sourceHeight: p.facts.height, heightFrom: p.facts.heightFrom, kindFrom: p.facts.kindFrom, researchFrom: p.facts.researchFrom ?? null });
  }
  const clearance = clearCirculation(pieces, records, infrastructureCount, assemblies, bridges.records);
  if (reconcileRubble(pieces, records)) {
    const more = clearCirculation(pieces, records, records[0]?.firstPiece ?? pieces.length, assemblies, bridges.records);
    for (const [kind, n] of Object.entries(more)) clearance[kind] = (clearance[kind] ?? 0) + n;
  }
  // Ground at a sample lowered to `y`, or -1 for a sample past the map's edge, which is none: not its row's neighbour.
  const lower = (row: number, col: number, y: number): number => {
    if (row < 0 || col < 0 || row >= nz || col >= nx) return -1;
    const i = row * nx + col;
    if (!roadGround.has(i)) site.ground.height[i] = Math.min(y, site.ground.height[i]!);
    return i;
  };
  for (const r of records) gradeApproaches(site, r.approaches, -1, roadGround);
  for (const r of records) gradeApproaches(site, r.approaches.map((a) => ({ street: a.door, door: a.core, core: a.core, ramp: 1 })), -1, roadGround);
  for (const r of records) for (const a of r.approaches) {
    const length = Math.hypot(a.core.x - a.door.x, a.core.z - a.door.z);
    for (let d = 0; d <= Math.ceil(length); d++) {
      const t = d / Math.max(1, Math.ceil(length)); const x = a.door.x + (a.core.x - a.door.x) * t; const z = a.door.z + (a.core.z - a.door.z) * t;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) lower(Math.round((z1 - z) / 2) + dz, Math.round((x1 - x) / 2) + dx, a.core.y);
    }
  }
  for (const r of records) for (const room of r.rooms) if (room.kind !== "rubble" && room.points[0]!.y === r.y) {
    for (const p of room.points) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) lower(Math.round((z1 - p.z) / 2) + dz, Math.round((x1 - p.x) / 2) + dx, r.y);
  }
  for (const r of records) for (const stair of r.routes) {
    const a = stair.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    const x = stair.x - 1.5 * c - 3.25 * s; const z = stair.z + 1.5 * s - 3.25 * c;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) lower(Math.round((z1 - z) / 2) + dz, Math.round((x1 - x) / 2) + dx, stair.y);
  }
  // A lower neighbour's rooms can cut the ground under a door and its corridor after both were planned: floor it again,
  // unless the floor would stand in the neighbour's rooms.
  const roomsNear = (x: number, z: number, self: RuinRecord): RuinRecord["rooms"] => records.filter((o) => o !== self && Math.abs(o.x - x) < 80 && Math.abs(o.z - z) < 80).flatMap((o) => o.rooms.filter((room) => room.kind !== "rubble"));
  for (const r of records) for (const a of r.approaches) {
    const length = Math.hypot(a.core.x - a.door.x, a.core.z - a.door.z); const yaw = Math.atan2(a.core.x - a.door.x, a.core.z - a.door.z) * 180 / Math.PI;
    for (let d = 0; d <= length; d += 2) {
      const t = length ? d / length : 0; const x = a.door.x + (a.core.x - a.door.x) * t; const z = a.door.z + (a.core.z - a.door.z) * t;
      const p = { kind: "core:zruin_floor4_concrete", x, y: a.core.y - .2, z, yaw };
      if (site.groundAt(x, z) >= a.core.y - .4 || counts[ckey(p)]! >= v.budgets.maxChunk) continue;
      if (pieces.slice(r.firstPiece, r.firstPiece + r.blocks).some((q) => q.kind === p.kind && Math.abs(q.x - x) < .5 && Math.abs(q.z - z) < .5)) continue;
      if (roomsNear(x, z, r).some((room) => obstructs(p, room.points))) continue;
      pieces.push(p); counts[ckey(p)]!++;
    }
  }
  counts.fill(0); for (const key of Object.keys(usedKinds)) delete usedKinds[key];
  for (const p of pieces) { counts[ckey(p)]!++; usedKinds[p.kind] = (usedKinds[p.kind] ?? 0) + 1; }
  for (const r of bridges.records) for (const d of r.deck) if (!d.gap) {
    // The road approach was already fitted to the ground. Cutting a slab thickness out of its
    // earthwork here would excavate a kerb after placement, including just outside the first slab.
    const ceiling = d.y - (r.kind === "road_bridge" ? .02 : .4);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) lower(Math.round((z1 - d.z) / 2) + dz, Math.round((x1 - d.x) / 2) + dx, ceiling);
  }
  for (const r of bridges.records) for (const d of r.swim) {
    for (let s = -d.distance - 2; s <= d.distance + 2; s++) for (let side = -3; side <= 3; side++) {
      const x = d.x + d.dx * s - d.dz * side; const z = d.z + d.dz * s + d.dx * side;
      const i = lower(Math.round((z1 - z) / 2), Math.round((x1 - x) / 2), -3);
      if (i >= 0) site.ground.water[i] = 1;
    }
  }
  // Run after room cuts and bridge excavation, using only accepted road terminals and their actual slabs.
  gradeRoadEntrances(site, bridges.records.flatMap(r => r.entrances));
  for (const r of records) {
    for (const a of r.approaches) site.growthRoutes.push({ points: [a.street, a.door, a.core], width: 2 });
    for (const route of [...r.rooms, ...r.escapes]) site.growthRoutes.push({ points: route.points, width: 2 });
    for (const stair of r.routes) site.growthRoutes.push({ points: [{ x: stair.x, z: stair.z, y: stair.y }, { x: stair.x, z: stair.z, y: stair.y + stair.floors * 4 }], width: 12 });
  }
  const sightlines = [];
  for (const line of v.sightlines ?? []) {
    const place = named.find((n) => n.id === line.place); const r = records.find((r) => r.footprint === place?.footprint);
    if (!r) continue;
    const length = Math.hypot(...line.from); const from = { x: r.x + line.from[0] / length * line.length, z: r.z + line.from[1] / length * line.length, y: r.y + 3 };
    const to = { x: r.x, z: r.z, y: r.y + Math.min(12, r.height * .5) };
    site.growthRoutes.push({ points: [from, to], width: line.width }); sightlines.push({ place: line.place, from, to, width: line.width });
  }
  const propCorridors = corridorIndex([...bridges.corridors, ...site.growthRoutes.flatMap((r) => r.points.slice(1).map((end, i) => ({ a: [r.points[i]!.x, r.points[i]!.z] as const, b: [end.x, end.z] as const, width: r.width, low: Math.min(r.points[i]!.y, end.y) - .5, high: Math.max(r.points[i]!.y, end.y) + 2.5 })))]);
  for (const bridge of bridges.records) for (const route of bridge.access) site.growthRoutes.push({ points: route.points, width: 3 });
  const obstacles = obstacleIndex(pieces);
  const acceptProp = (m: Mason): boolean => {
    for (const room of m.rooms) if (room.kind === "street-gap") for (let segment = 1; segment < room.points.length; segment++) {
      const from = room.points[segment - 1]!; const to = room.points[segment]!; const length = Math.hypot(to.x - from.x, to.z - from.z);
      for (let d = 0; d <= Math.ceil(length); d++) {
        const t = d / Math.max(1, Math.ceil(length)); const p = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t, y: from.y + (to.y - from.y) * t };
        const near = propCorridors({ ...m.frame, x: p.x, z: p.z, width: 16, depth: 16 });
        if (near.some((r) => {
          if (p.y < r.low - 2 || p.y > r.high + 2 || Math.abs(p.y - r.low - .5) < .12) return false;
          const dx = r.b[0] - r.a[0]; const dz = r.b[1] - r.a[1];
          const t = Math.max(0, Math.min(1, ((p.x - r.a[0]) * dx + (p.z - r.a[1]) * dz) / (dx * dx + dz * dz || 1)));
          return Math.hypot(p.x - r.a[0] - dx * t, p.z - r.a[1] - dz * t) < 5 + r.width / 2;
        })) return false;
      }
    }
    if (m.rooms.some((r) => obstacles.blocked(r.points) || m.pieces.some((p) => obstructs(p, r.points)))) return false;
    for (const p of m.pieces) {
      const [w, h, d] = extentOf(p.kind).size; const mid = middleOf(p);
      const nearby = propCorridors({ ...m.frame, x: mid.x, z: mid.z, width: w, depth: d });
      if (nearby.some((c) => {
        if (mid.y + h / 2 < c.low || mid.y - h / 2 > c.high) return false;
        const angle = p.yaw * Math.PI / 180; const co = Math.cos(angle); const si = Math.sin(angle);
        const local = (q: readonly number[]): number[] => [(q[0]! - mid.x) * co - (q[1]! - mid.z) * si, (q[0]! - mid.x) * si + (q[1]! - mid.z) * co];
        const a = local(c.a); const b = local(c.b); const half = [w / 2 + c.width / 2, d / 2 + c.width / 2];
        let enter = 0; let leave = 1;
        for (let axis = 0; axis < 2; axis++) {
          const delta = b[axis]! - a[axis]!;
          if (Math.abs(delta) < 1e-8) { if (Math.abs(a[axis]!) >= half[axis]!) return false; }
          else { const t0 = (-half[axis]! - a[axis]!) / delta; const t1 = (half[axis]! - a[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
        }
        return enter <= leave;
      })) return false;
    }
    if (!accept(m)) return false;
    for (const p of m.pieces) obstacles.add(p);
    for (const r of m.rooms) {
      site.growthRoutes.push({ points: r.points, width: 2 });
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]!; const b = r.points[i]!;
        propCorridors.add({ a: [a.x, a.z], b: [b.x, b.z], low: Math.min(a.y, b.y) - .5, high: Math.max(a.y, b.y) + 2.5, width: 2 });
      }
    }
    return true;
  };
  const infrastructure = makeInfrastructure(site, acceptProp);
  const joinedFrontages = joinFrontages(records, v, acceptProp);
  const roads = roadIndex(site);
  // The walks first, so the street's wrecks and furniture stand clear of them.
  // A walk is cut where a way in to a building crosses it, and nowhere else for the routes inside buildings.
  const ways = corridorIndex(records.flatMap((r) => r.approaches.map((a) => ({ a: [a.street.x, a.street.z] as const, b: [a.door.x, a.door.z] as const, width: 3, low: a.door.y - .5, high: a.door.y + 2.5 }))));
  const walks = makeWalks(site, v, (m) => { if (!accept(m)) return false; for (const p of m.pieces) obstacles.add(p); return true; }, (box) => crosses(box, ways), obstacles, roads, roadGround, entrances);
  const streets = makeStreetPieces(site, v, acceptProp, obstacles, roads, roadGround);
  // Lettered signs come after the passes that read every piece as a box of the ruin kit.
  const signs = makeSigns(site, accept);
  const publicPlaces = makePublicPlaces(site, data.places, acceptProp, nearSign(site, 60));
  parkFreightTrailers(site, roads, v.street.cars.parked.trailers, obstacles.hits, acceptProp);
  const fleet = ROAD_FLEET.map((s) => ({ id: s.id, def: s.vehicle as WheelVehicleDefinition }));
  const parked = parkCars(site, pieces, roads, v.street.cars, v.seed, fleet);
  for (const p of parked) {
    // Nothing grows on it or where its doors open.
    const a = p.yaw * Math.PI / 180; const y = site.groundAt(p.x, p.z); const reach = fleet.find((f) => f.id === p.kind)!.def.spec.halfLength + 1;
    site.growthRoutes.push({ points: [{ x: p.x - Math.sin(a) * reach, y, z: p.z - Math.cos(a) * reach }, { x: p.x + Math.sin(a) * reach, y, z: p.z + Math.cos(a) * reach }], width: 5 });
    site.vehicles.push({ kind: p.kind, x: p.x, z: p.z, yaw: p.yaw, ...(p.condition ? { condition: p.condition } : {}), fuel: p.fuel });
  }
  const across = (nx - 1) / 2; const down = (nz - 1) / 2;
  for (const p of data.places) {
    const radius = v.growth.lowAroundPlace[p.kind]; if (!radius) continue;
    const [x, z] = site.toLattice(p.e, p.n);
    for (let row = Math.max(0, Math.floor((z1 - z - radius) / 4)); row <= Math.min(down - 1, Math.ceil((z1 - z + radius) / 4)); row++) for (let col = Math.max(0, Math.floor((x1 - x - radius) / 4)); col <= Math.min(across - 1, Math.ceil((x1 - x + radius) / 4)); col++) if ((x1 - col * 4 - x) ** 2 + (z1 - row * 4 - z) ** 2 <= radius * radius) site.lowPlants[row * across + col] = 1;
  }
  const folder = join(site.source, "reports", site.world.ruins?.report ?? "ruins"); mkdirSync(folder, { recursive: true });
  const put = (name: string, value: unknown): void => writeFileSync(join(folder, name), `${JSON.stringify(value, null, 2)}\n`);
  // A long list written a row at a time, the same bytes as put's: as one string a big city's buildings were 0.3 to 0.55 GB.
  const putRows = (name: string, rows: readonly unknown[]): void => {
    if (rows.length === 0) return put(name, rows);
    const fd = openSync(join(folder, name), "w");
    let chunk = "[\n  ";
    rows.forEach((row, i) => {
      chunk += `${i > 0 ? ",\n  " : ""}${JSON.stringify(row, null, 2).replace(/\n/g, "\n  ")}`;
      if (chunk.length > 1 << 20) { writeSync(fd, chunk); chunk = ""; }
    });
    writeSync(fd, `${chunk}\n]\n`);
    closeSync(fd);
  };
  put("bridges.json", bridges.records);
  put("bridge-summary.json", { roadApproaches: bridges.records.reduce((n, r) => n + r.approaches, 0), railAccess: bridges.records.reduce((n, r) => n + r.access.length, 0), byKind: tally(bridges.records.map((r) => r.kind)), brokenWays: bridges.records.filter((r) => r.deck.some((d) => d.gap)).map((r) => ({ id: r.id, name: r.name, skippedDecks: r.deck.filter((d) => d.gap).length })), ways: bridges.records.length, built: bridges.records.filter((r) => r.status === "built").length, blocks: bridges.records.filter((r) => r.status === "built").reduce((n, r) => n + r.blocks, 0), outlines: bridges.outlines });
  const topChunks = [...counts.keys()].filter((i) => counts[i]! > 0).sort((a, b) => counts[b]! - counts[a]! || a - b).slice(0, 30).map((i) => ({ x: i % chunksX, z: Math.floor(i / chunksX), blocks: counts[i] }));
  const survey = readSurvey(join(site.source, "blocks"));
  const inventory = surveyInventory(survey);
  const categoriesByDistrict: Record<string, Record<string, number>> = {};
  for (const [id, f] of primary) {
    const row = categoriesByDistrict[f.district?.name ?? "Unzoned"] ??= {};
    const kind = facts.get(id)!.kind; row[kind] = (row[kind] ?? 0) + 1;
  }
  const all = [...facts];
  const supplied = Object.values(data.labels);
  put("labels.json", { fingerprint: data.fingerprint, footprints: primary.size, labels: supplied.length,
    named: supplied.filter((l) => l.name || l.also.length).length,
    suppliedKinds: tally(supplied.map((l) => l.kind ?? "missing")), suppliedHeights: tally(supplied.map((l) => l.height_from ?? "missing")),
    neither: supplied.filter((l) => !l.kind && !(l.height_m && l.height_m > 0)).length,
    resolvedKinds: tally(all.map(([, f]) => f.kindFrom)), resolvedHeights: tally(all.map(([, f]) => f.heightFrom)),
    categoriesByDistrict, places: tally(data.places.map((p) => p.kind)), enrichment: data.enrichment,
    inferred: all.filter(([, f]) => f.kindFrom !== "label" || !["osm", "usa_structures", "reviewed_source"].includes(f.heightFrom)).map(([id, f]) => ({ id, name: f.label.name, kind: f.kind, height: f.height, kindFrom: f.kindFrom, heightFrom: f.heightFrom, neighbours: f.neighbours })),
    famous: all.filter(([id, f]) => ["world", "city"].includes(f.research?.fame ?? "") || named.some((p) => p.footprint === id)).map(([id, f]) => ({ id, name: f.label.name, fame: f.research?.fame ?? "hand rule", research: f.researchFrom ?? null })),
    namedPlaces: all.filter(([, f]) => f.label.name).map(([id, f]) => ({ id, name: f.label.name, also: f.label.also, kind: f.kind, height: f.height, research: f.researchFrom ?? null, fame: f.research?.fame ?? null })),
    heightLevelConflicts: all.filter(([, f]) => f.label.levels && f.label.height_m && (f.label.height_m / f.label.levels < 2 || f.label.height_m / f.label.levels > 6)).map(([id, f]) => ({ id, height: f.label.height_m, levels: f.label.levels, kept: "height_m" })) });
  put("survey.json", { ...inventory, status: "stopped; enrichment by unambiguous name only", pending: [], unavailable: inventory.pending, enrichmentMatches: data.research.size });
  put("places.json", publicPlaces);
  put("signs.json", signs);
  put("parked.json", parked);
  const wrecks = pieces.filter((p) => wreckLook(p.kind));
  put("sightlines.json", sightlines);
  putRows("buildings.json", records);
  put("roof-gardens.json", records.flatMap((r) => {
    const p = pieces.slice(r.firstPiece, r.firstPiece + r.blocks).find((p) => p.kind.includes("_zshrub_"));
    return p ? [{ part: r.part, x: p.x, y: p.y, z: p.z, yaw: r.yaw, name: r.name }] : [];
  }));
  put("generation.json", { version: v.version, seed: v.seed, labelsFingerprint: data.fingerprint, staticFingerprint: digest(pieces),
    blocks: pieces.length, buildings: records.length, footprints: site.footprints.length, rejected, keptAsGround, kinds: usedKinds, topChunks,
    clearance, streets, walks, cars: { pieces: wrecks.length, byLook: tally(wrecks.map((p) => wreckLook(p.kind)!.mesh)), byKind: tally(wrecks.map((p) => p.kind)), parked: parked.length }, event: { ...v.event, sheltered: records.filter((r) => (r.shelter ?? 0) > .1).length, exposure: tally(records.map((r) => (Math.floor((r.exposure ?? 0) * 10) / 10).toFixed(1))) }, frontage: { joined: joinedFrontages, buildings: records.filter((r) => r.party?.length).length, partyEdges: records.reduce((n, r) => n + (r.party?.length ?? 0), 0) }, byForm: tally(records.map((r) => r.form)), byCollapse: tally(records.map((r) => r.collapse)), roomRoutes: records.reduce((n, r) => n + r.rooms.length, 0),
    piecesByKind: Object.fromEntries([...new Set(records.map((r) => r.kind))].sort().map((kind) => { const rows = records.filter((r) => r.kind === kind); return [kind, { buildings: rows.length, pieces: rows.reduce((n, r) => n + r.blocks, 0), max: Math.max(...rows.map((r) => r.blocks)) }]; })),
    byRecipe: tally(records.map((r) => r.recipe)), byDistrict: tally(records.map((r) => r.district)),
    reduced: records.filter((r) => r.detail > 0).map((r) => ({ part: r.part, name: r.name, detail: r.detail })),
    compounds: records.filter((r) => r.wings.length).map((r) => ({ part: r.part, name: r.name, wings: r.wings.length, cores: r.routes.length, entrances: r.entries.length })), approaches: records.reduce((n, r) => n + r.approaches.length, 0), escapes: records.reduce((n, r) => n + r.escapes.length, 0),
    routes: records.reduce((a, r) => a + r.routes.length, 0), infrastructure, publicPlaces: tally(publicPlaces.map((p) => p.status)), signs: tally(signs.map((s) => s.status)), budgets: v.budgets });
  console.log(`ruins: ${records.length} buildings, ${pieces.length} blocks, peak chunk ${topChunks[0]?.blocks ?? 0}; ${supplied.length} direct labels, ${data.research.size} research matches`);
  return pieces;
}
/** The first place of a lattice grid, `from` plus whole steps of `step`, at or past `from` in from a map's edge at `edge`. */
const onLattice = (edge: number, from: number, step: number): number => Math.ceil(edge / step) * step + from;
const tally = (xs: string[]): Record<string, number> => {
  const out: Record<string, number> = {}; for (const x of xs) out[x] = (out[x] ?? 0) + 1; return out;
};

function makeInfrastructure(site: Site, accept: (m: Mason) => boolean): Record<string, number> {
  const { ground } = site; const { nx, nz, x0, z0, x1, z1 } = ground.grid;
  const at = (x: number, z: number): number => Math.max(0, Math.min(nz - 1, Math.round((z1 - z) / 2))) * nx + Math.max(0, Math.min(nx - 1, Math.round((x1 - x) / 2)));
  const f: Frame = { x: 0, z: 0, yaw: 0, c: 1, s: 0, rings: [], width: ground.grid.sizeX, depth: ground.grid.sizeZ };
  let containers = 0; let parapets = 0;
  const port = site.world.districts.findIndex((d) => site.world.ruins?.yardDistricts.includes(d.name)) + 1;
  for (let z = onLattice(z0, 16, 16); z < z1 - 16; z += 16) for (let x = onLattice(x0, 16, 16); x < x1 - 16; x += 16) {
    const i = at(x, z); const h = hash3(x, z, 7731);
    if (ground.surface[i] === S.DECK && h % 3 === 0) {
      for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        if (ground.surface[at(x + dx!, z + dz!)] === S.DECK) continue;
        const m = new Mason(f, site.groundAt(x, z));
        m.put("sill8", x, .45, z, "concrete", dx === 0 ? 0 : 90);
        if (accept(m)) parapets++;
        break;
      }
    }
    if (ground.district[i] !== port || ground.surface[i] !== S.YARD || h % 5 > 2 || ground.shore[i]! < 16) continue;
    if (![-7, 0, 7].every((dx) => [-3, 0, 3].every((dz) => ground.surface[at(x + dx, z + dz)] === S.YARD))) continue;
    const m = new Mason(f, site.groundAt(x, z));
    const finish: RuinFinish = h % 3 === 0 ? "blue" : h % 3 === 1 ? "rust" : "mint";
    m.put("container", x, 1.3, z, finish); m.cover(x, z, 8);
    if (h % 4 === 0) m.put("container", x, 3.9, z, finish);
    if (accept(m)) containers++;
  }
  return { containerStacks: containers, causewayParapets: parapets };
}

export const RUINS: StaticLayer = { name: "ruins", make: makeRuins };

function levelFloor(site: Site, frame: Frame, owner: number, base: number, protectedGround: ReadonlySet<number>): void {
  const { height, heaps } = site.ground; const { nx, nz, x1, z1 } = site.ground.grid;
  const pts = frame.rings[0]!.map(([u, v]) => worldPoint(frame, u, v));
  const minX = Math.min(...pts.map((p) => p[0])); const maxX = Math.max(...pts.map((p) => p[0]));
  const minZ = Math.min(...pts.map((p) => p[1])); const maxZ = Math.max(...pts.map((p) => p[1]));
  for (let row = Math.max(0, Math.floor((z1 - maxZ) / 2)); row <= Math.min(nz - 1, Math.ceil((z1 - minZ) / 2)); row++) {
    for (let col = Math.max(0, Math.floor((x1 - maxX) / 2)); col <= Math.min(nx - 1, Math.ceil((x1 - minX) / 2)); col++) {
      const i = row * nx + col;
      if (protectedGround.has(i) || heaps.owner[i] !== owner || site.ground.surface[i] !== S.FLOOR) continue;
      const dx = x1 - col * 2 - frame.x; const dz = z1 - row * 2 - frame.z;
      const u = dx * frame.c - dz * frame.s; const v = dx * frame.s + dz * frame.c;
      if (frame.rings.slice(1).some((r) => inRing(u, v, r))) continue;
      height[i] = base;
    }
  }
}

function makePublicPlaces(site: Site, places: PublicPlace[], accept: (m: Mason) => boolean, signed: (x: number, z: number) => boolean): (PublicPlace & { status: string; blocks: number })[] {
  const { nx, x0, z0, x1, z1 } = site.ground.grid;
  const out: (PublicPlace & { status: string; blocks: number })[] = [];
  for (const p of places) {
    const [x, z] = site.toLattice(p.e, p.n); const y = site.groundAt(x, z);
    const record = { ...p, status: "context only", blocks: 0 }; out.push(record);
    if (x < x0 + 20 || z < z0 + 20 || x >= x1 - 20 || z >= z1 - 20) { record.status = "outside usable map"; continue; }
    if (signed(x, z)) { record.status = "lettered sign built by the sign layer"; continue; }
    const i = Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
    if (p.in_footprint !== null || site.ground.surface[i] === S.FLOOR) { record.status = "building already represented"; continue; }
    if (p.kind === "bridge") { record.status = "full way geometry built by bridge layer"; continue; }
    if (p.kind === "pier") { record.status = "full way geometry built by bridge layer"; continue; }
    if (y < 0) { record.status = "submerged context"; continue; }
    // A board stands on its posts in a median or a verge, as it is mapped; anything else keeps the road clear.
    if (p.kind !== "board" && [S.STREET, S.HIGHWAY, S.CROSSWALK, S.DECK].includes(site.ground.surface[i]! as typeof S.STREET)) { record.status = "road kept clear"; continue; }
    const frame: Frame = { x, z, c: 1, s: 0, yaw: 0, width: 24, depth: 24, rings: [[[-12, -12], [12, -12], [12, 12], [-12, 12], [-12, -12]]] };
    if (p.kind === "board") {
      // Its face toward the compass bearing it is mapped facing: the frame's u runs along the board.
      const yaw = -(p.facing ?? 0); frame.yaw = yaw; frame.c = Math.cos((yaw * Math.PI) / 180); frame.s = Math.sin((yaw * Math.PI) / 180);
    }
    if (p.kind === "crane") {
      const directions = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
      const angle = directions.sort((a, b) => site.groundAt(x + Math.cos(a) * 48, z - Math.sin(a) * 48) - site.groundAt(x + Math.cos(b) * 48, z - Math.sin(b) * 48) || a - b)[0]!;
      frame.c = Math.cos(angle); frame.s = Math.sin(angle); frame.yaw = angle * 180 / Math.PI;
    }
    const m = new Mason(frame, y);
    if (["monument", "artwork", "fountain", "viewpoint"].includes(p.kind)) {
      m.put("plinth", 0, .5, 0); m.put("crown", 0, 3, 0, "limestone");
    } else if (p.kind === "board") {
      for (const side of [-1, 1]) m.put("zpole", side * 2.6, 3, 0, "steel");
      m.put("zpanel8", 0, 5.2, 0, "limestone"); m.put("zsign", 0, 7.7, 0, "rose");
    } else if (["park", "garden", "dog_park", "marina", "beach"].includes(p.kind)) {
      for (const side of [-1, 1]) { m.put("seat", 0, .4, side * 8); m.put("rubble", side * 10, .35, 0); }
    } else if (p.kind === "station") {
      for (const side of [-1, 1]) { m.put("floor8", side * 4, .2, 0); m.put("seat", side * 4, .8, 0); m.post(side * 8, 0, 0, 4); m.put("beam8", side * 4, 4, 0); }
    } else if (p.kind === "crane") {
      for (const du of [-6, 6]) for (const dv of [-4, 4]) { m.put("fin16", du, 8, dv, "rust"); m.put("fin8", du, 20, dv, "rust"); }
      for (let u = -8; u <= 24; u += 8) m.put("wall8", u, 24, 0, "rust");
      m.put("fin16", 26, 16, 0, "rust");
    } else continue;
    m.cover(0, 0, 6);
    if (accept(m)) { record.status = "built"; record.blocks = m.pieces.length; }
    else record.status = "budget or bounds";
  }
  return out;
}

/** Whether a box, seen from above, meets a corridor of `index` widened by its width. */
function crosses(box: Box, index: ReturnType<typeof corridorIndex>): boolean {
  const [w, , d] = box.size; const mid = box;
  const a = box.yaw * Math.PI / 180; const co = Math.cos(a); const si = Math.sin(a);
  return index({ x: mid.x, z: mid.z, yaw: box.yaw, c: co, s: si, width: w, depth: d, rings: [] }).some((c) => {
    const local = (q: readonly number[]): number[] => [(q[0]! - mid.x) * co - (q[1]! - mid.z) * si, (q[0]! - mid.x) * si + (q[1]! - mid.z) * co];
    const [qa, qb] = [local(c.a), local(c.b)]; const half = [w / 2 + c.width / 2, d / 2 + c.width / 2];
    let enter = 0; let leave = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = qb[axis]! - qa[axis]!;
      if (Math.abs(delta) < 1e-8) { if (Math.abs(qa[axis]!) >= half[axis]!) return false; }
      else { const t0 = (-half[axis]! - qa[axis]!) / delta; const t1 = (half[axis]! - qa[axis]!) / delta; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
    }
    return enter <= leave;
  });
}

/** A curb ramp's length along the curb (content/ruins.ts street()). */
const RAMP = 1.8;

/**
 * A street's edges: along each road of the listed classes, on each side, an 8 m walk with its curb on the road's edge every
 * 8 m, where the ground beside the road is open and level and nothing of the city stands, clear of junctions; a gutter on
 * a run of them here and there. Where a way in to a building (a box meeting it, `way`) or a crossing meets it the curb is
 * cut, and a run ends in a curb ramp there and at a junction; elsewhere its curb stays full height. Where a corner turns
 * on a curb return (corners.ts), the runs on its two kerbs begin at its ends, and a run between two returns leaves the
 * metres it does not fill in a break of its own. No walk, ramp or drain stands on the road ground graded to a bridge's
 * way on (`graded`), which is driven.
 */
function makeWalks(site: Site, v: Vocabulary, accept: (m: Mason) => boolean, way: (box: Box) => boolean, obstacles: ReturnType<typeof obstacleIndex>, roads: ReturnType<typeof roadIndex>, graded: ReadonlySet<number>, entrances: readonly { x: number; z: number; dx: number; dz: number; width: number }[]): Record<string, number> {
  const rules = v.street.walks; const out: Record<string, number> = { placed: 0, cut: 0, blocked: 0, gutters: 0, ramps: 0, drains: 0, boxes: 0 };
  if (!rules) return out;
  const { nx, x0, z0, x1, z1 } = site.ground.grid;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  // A city's sidewalks are where its walk network says (tools/mapdata/streets.py, painted SIDEWALK, 0.5 to 3 m from the
  // road's edge) and look like these slabs: left out, a walk was refused on nearly every painted sidewalk.
  const open = new Set<number>([S.OPEN, S.GREEN, S.CANOPY, S.YARD, S.DESERT, S.SIDEWALK]);
  const rubble = (p: StaticPiece): boolean => /_z(skirt1|skirt2|wedge)_/.test(p.kind);
  /** Whether (x, z) is on a bridge's way on: its lanes and a metre beside them, 24 m out onto the approach and 12 m onto the deck. */
  const onWay = (x: number, z: number): boolean => entrances.some((e) => {
    const along = (x - e.x) * e.dx + (z - e.z) * e.dz;
    return along > -24 && along < 12 && Math.abs((z - e.z) * e.dx - (x - e.x) * e.dz) < e.width / 2 + 1;
  });
  const graph = streetGraph(site);
  // The curb returns first (corners.ts), each where its corner's ground is level and open and nothing stands on its arc;
  // where one stands, the straight walks on both its kerbs begin at its ends, by the way out of the junction each runs
  // along and which side of that way the corner is on (the way it turns from, or the way it turns to).
  const begins = new Map<string, { along: number; y: number }>();
  const beginKey = (node: number, line: number, sense: number, from: boolean): string => `${node}|${line}|${sense}|${from ? "a" : "b"}`;
  const senseOf = (n: { ways: readonly { line: number; dx: number; dz: number; sense: number }[] } | undefined, arm: { line: number; dx: number; dz: number }): number =>
    n?.ways.find((w) => w.line === arm.line && w.dx * arm.dx + w.dz * arm.dz > 0.999)?.sense ?? 0;
  const returnRules = rules.returns;
  for (const corner of returnRules ? cornersOf(site, returnRules) : []) {
    const p = corner.piece; if (!p || p.x < x0 || p.x >= x1 || p.z < z0 || p.z >= z1) continue;
    const y = setReturn(site, corner, rules, open, (x, z) => graded.has(at(x, z)) || onWay(x, z), (box) => obstacles.hits(box, -0.1, rubble) || way(box), accept);
    if (typeof y === "string") { out[`returnRefused_${y}`] = (out[`returnRefused_${y}`] ?? 0) + 1; continue; }
    out.returns = (out.returns ?? 0) + 1;
    const n = graph.nodeAt(corner.x, corner.z);
    begins.set(beginKey(n?.key ?? 0, corner.a.line, senseOf(n, corner.a), true), { along: corner.alongA, y });
    begins.set(beginKey(n?.key ?? 0, corner.b.line, senseOf(n, corner.b), false), { along: corner.alongB, y });
  }
  for (const [index, s] of roads.segments.entries()) {
    if (!rules.classes.includes(s.mtfcc)) continue;
    const ex = s.bx - s.ax; const ez = s.bz - s.az; const length = Math.hypot(ex, ez);
    const [ux, uz] = [ex / length, ez / length];
    for (const side of [1, -1]) {
      // Away from the road on this side, the piece's turn that points its z there, and where its curb's face runs.
      const [nxw, nzw] = [-uz * side, ux * side];
      const yaw = Math.atan2(nxw, nzw) * 180 / Math.PI; const c = Math.cos(yaw * Math.PI / 180); const sn = Math.sin(yaw * Math.PI / 180);
      const curb = (d: number, out: number): [number, number] => [s.ax + ux * d + nxw * (s.half + out), s.az + uz * d + nzw * (s.half + out)];
      // A piece of the kit with its middle `d` along the road and `out` from the curb's face.
      const make = (shape: RuinShape, d: number, out: number, y: number): Mason => {
        const mid = BREAK_AT[shape]!; const [x, z] = curb(d, out);
        // Its middle stands that far along its x, which runs with the road one way or the other, from where it is put.
        const m = new Mason({ x: x + c * mid[0]!, z: z - sn * mid[0]!, yaw, c, s: sn, width: 8, depth: 3, rings: [] }, y);
        m.put(shape, 0, mid[1]!, 0, "concrete");
        return m;
      };
      // A walk meets its neighbours end to end, so it is tested against the city's pieces a little smaller, and not against
      // the rubble along a wall's foot, which spills onto it; a ramp is not tested against the ways in it leads to, nor what
      // stands on a walk just laid against anything.
      const put = (shape: RuinShape, d: number, out: number, y: number, test: "all" | "pieces" | "none" = "all"): boolean | "way" => {
        const m = make(shape, d, out, y);
        if (test === "all" && way(boxOf(m.pieces[0]!))) return "way";
        return !(test !== "none" && obstacles.hits(boxOf(m.pieces[0]!), -0.1, rubble)) && accept(m);
      };
      // Where a return stands at either end on this side, the run begins at its end there: along the road from its first
      // point, or back from its last.
      const nodeA = graph.nodeAt(s.ax, s.az), nodeB = graph.nodeAt(s.bx, s.bz);
      const towardFirst = nxw * -uz + nzw * ux > 0;
      const first = nodeA ? begins.get(beginKey(nodeA.key, s.line, 1, towardFirst)) : undefined;
      const last = nodeB ? begins.get(beginKey(nodeB.key, s.line, -1, !towardFirst)) : undefined;
      const from = first?.along, to = last === undefined ? undefined : length - last.along;
      // Each slot of 8 m, by where it starts: walked, kept clear for a junction, a way in, a crossing or the run's seam, or
      // left bare. A slot is judged before anything is laid in it; one that meets a return stands at the return's height
      // where its ground is within the walks' `flat` of it, so the two meet flush.
      type Slot = { start: number; y: number; gutter: boolean; state: "walk" | "junction" | "way" | "bare" | "blocked" | "seam" };
      const judge = (start: number): Slot => {
        const d = start + 4;
        const [fx, fz] = [s.ax + ux * d, s.az + uz * d];
        const below = site.groundAt(...curb(d, 0.3));
        const meets = Math.abs(start - (from ?? -99)) < 0.01 ? first : Math.abs(start + 8 - (to ?? -99)) < 0.01 ? last : undefined;
        const y = meets && Math.abs(meets.y - below) <= rules.flat ? meets.y : below;
        const gutter = hash3(index, Math.floor(d / 32), v.seed + side) % rules.gutterEvery === 0;
        const slot: Slot = { start, y, gutter, state: "walk" };
        // A junction a return turns is not kept clear: the run begins at the return.
        if ((from === undefined || d > length / 2) && (to === undefined || d < length / 2) && junctionAt(site, fx, fz, s.half + rules.fromJunction)) return { ...slot, state: "junction" };
        // The road's raster runs a sample or so past its edge, so the curb's corners may stand on street.
        const corners = [-4, 4].flatMap((a) => [0.3, rules.width].map((b) => [...curb(d + a, b), b] as const));
        if (y < 0.1 || corners.some(([x, z, b]) => !(open.has(site.ground.surface[at(x, z)]!) || b < 1 && site.ground.surface[at(x, z)] === S.STREET) || site.ground.water[at(x, z)] || Math.abs(site.groundAt(x, z) - y) > rules.flat)) return { ...slot, state: "bare" };
        // Nor within a sample of the road ground graded to a bridge.
        if ([-4, 0, 4].some((a) => [-1.5, 0.3, 1.5, rules.width + 1.5].some((b) => { const [x, z] = curb(d + a, b); return graded.has(at(x, z)) || onWay(x, z); }))) return { ...slot, state: "bare" };
        // A crossing over this road meets its curb here: the curb is cut for it, as for a way in.
        for (let a = -4; a <= 4; a++) if (graph.onCrossing(...curb(d + a, 0.3), 0)) return { ...slot, state: "way" };
        const m = make(gutter ? "zwalk8g" : "zwalk8", d, BREAK_AT[gutter ? "zwalk8g" : "zwalk8"]![2]!, y);
        if (way(boxOf(m.pieces[0]!))) return { ...slot, state: "way" };
        return obstacles.hits(boxOf(m.pieces[0]!), -0.1, rubble) ? { ...slot, state: "blocked" } : slot;
      };
      const slots: Slot[] = [];
      if (from === undefined && to === undefined) for (let start = 0; start + 8 <= length; start += 8) slots.push(judge(start));
      else if (to === undefined) for (let start = from!; start + 8 <= length; start += 8) slots.push(judge(start));
      else if (from === undefined) for (let start = to - 8; start >= 0; start -= 8) slots.unshift(judge(start));
      else {
        // Between two returns the run meets both: laid on from the first, the metres short of eight it does not fill are
        // left where its first break is (a slot not walked), the slots past it laid on from there. With no break they are
        // a driveway at its middle, a ramp down each side, where they hold two ramps; where they do not, the middle slot
        // is cut with them.
        const count = Math.floor((to - from) / 8); const left = to - from - 8 * count;
        for (let k = 0; k < count; k++) slots.push(judge(from + 8 * k));
        if (left > 0.01 && count > 0) {
          const broken = slots.findIndex((q) => q.state !== "walk");
          const apart = broken < 0 && count > 1 && left >= 2 * RAMP + 0.2;
          const seam = broken >= 0 ? broken : Math.floor(count / 2) - (apart ? 1 : 0);
          if (broken < 0 && !apart) slots[seam]!.state = "seam";
          for (let k = seam + 1; k < count; k++) slots[k] = judge(from + 8 * k + left);
          if (apart) slots.splice(seam + 1, 0, { start: from + 8 * (seam + 1), y: slots[seam]!.y, gutter: false, state: "seam" });
        }
      }
      for (const [k, slot] of slots.entries()) {
        if (slot.state !== "walk") { if (slot.state === "way") out.cut!++; if (slot.state === "blocked") out.blocked!++; continue; }
        const d = slot.start + 4; const y = slot.y;
        const laid = put(slot.gutter ? "zwalk8g" : "zwalk8", d, BREAK_AT[slot.gutter ? "zwalk8g" : "zwalk8"]![2]!, y, "none");
        if (!laid) { slot.state = "bare"; out.blocked!++; continue; }
        out.placed!++; if (slot.gutter) out.gutters!++;
        // A storm drain where the gutter runs lowest, and now and then a utility box at the walk's back.
        const before = slots[k - 1]?.y ?? Infinity;
        const after = d + 12 <= length ? site.groundAt(...curb(d + 8, 0.3)) : Infinity;
        if (slot.gutter && y <= before && y <= after && put("zdrain", d, BREAK_AT.zdrain![2]!, y, "none")) out.drains!++;
        if (hash3(index, Math.round(d), v.seed + 7 * side) % rules.boxEvery === 0 && put("zutility", d + 2, rules.width - 0.4, y, "none")) out.boxes!++;
      }
      // A walk's run ends in a curb ramp down to the road at a junction, a way in, a crossing or a seam.
      const ends = (slot: Slot | undefined): boolean => slot !== undefined && (slot.state === "junction" || slot.state === "way" || slot.state === "seam");
      for (let k = 0; k < slots.length; k++) {
        if (slots[k]!.state !== "walk") continue;
        const d = slots[k]!.start + 4; const y = slots[k]!.y;
        // The ramp rises toward the walk it leads onto; a piece's +x runs with the road on one side and against it on the other.
        const rising = (toward: number): RuinShape => (toward * side > 0 ? "zcurbramp" : "zcurbrampl");
        // A ramp stands on no graded way onto a bridge, nor out on the road it meets.
        const clear = (along: number): boolean => [-0.9, 0.9].every((a) => [0, 0.8, 2.4].every((b) => { const i = at(...curb(along + a, b)); return !graded.has(i) && !onWay(...curb(along + a, b)) && (b < 0.5 || (site.ground.surface[i] !== S.STREET && site.ground.surface[i] !== S.HIGHWAY)); }));
        if (ends(slots[k - 1]) && clear(d - 4.9) && put(rising(1), d - 4 - 0.9, 1.2, y, "pieces") === true) out.ramps!++;
        if (ends(slots[k + 1]) && clear(d + 4.9) && put(rising(-1), d + 4 + 0.9, 1.2, y, "pieces") === true) out.ramps!++;
      }
    }
  }
  return out;
}

/**
 * Sets a corner's planned return down (corners.ts), or says why not: its arc and ends on ground open or painted road
 * (within a metre of its face), level within the walks' `flat` of the height it stands at, halfway between the highest
 * and the lowest ground just behind its face, on no way onto a bridge (`onWay`), each stretch of its arc clear of the
 * city's pieces and the ways in to doors (`blocked`), and the chunk's budget taking it. Set down, the road's height
 * under it.
 */
function setReturn(site: Site, corner: Corner, rules: Walks, open: ReadonlySet<number>, onWay: (x: number, z: number) => boolean, blocked: (box: Box) => boolean, accept: (m: Mason) => boolean): string | number {
  const p = corner.piece!; const radius = corner.radius;
  const { nx, x1, z1 } = site.ground.grid;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  // A point of the arc, `back` metres behind its face, at angle phi from its end on a's kerb toward b's.
  const turn = corner.ax * corner.bz - corner.az * corner.bx > 0 ? 1 : -1;
  const arc = (phi: number, back: number): [number, number] => {
    const c = Math.cos(phi), s = Math.sin(phi), r = radius - back;
    return [corner.cx + r * (corner.ax * c - turn * corner.az * s), corner.cz + r * (corner.az * c + turn * corner.ax * s)];
  };
  const face = Array.from({ length: 7 }, (_, k) => site.groundAt(...arc((Math.PI / 2) * k / 6, 0.3)));
  const y = (Math.min(...face) + Math.max(...face)) / 2;
  if (y < 0.1) return "low";
  const road = new Set<number>([S.STREET, S.HIGHWAY, S.CROSSWALK]);
  for (let k = 0; k <= 6; k++) for (const back of [0.3, rules.width]) {
    const [x, z] = arc((Math.PI / 2) * k / 6, back); const i = at(x, z);
    const surface = site.ground.surface[i]!;
    if (site.ground.water[i] || !(open.has(surface) || (back < 1 && road.has(surface)))) return "ground";
    if (Math.abs(site.groundAt(x, z) - y) > rules.flat) return "slope";
    if (onWay(x, z)) return "bridge";
  }
  // Six boxes, each round a fifteen degree stretch of the walk.
  for (let k = 0; k < 6; k++) {
    const phi = (Math.PI / 2) * (k + 0.5) / 6;
    const [x, z] = arc(phi, rules.width / 2); const [x0, z0] = arc(phi - Math.PI / 24, 0); const [xb, zb] = arc(phi + Math.PI / 24, 0);
    const along = Math.atan2(xb - x0, zb - z0) * 180 / Math.PI - 90;
    if (blocked({ x, y: y + 0.075, z, yaw: along, size: [Math.hypot(xb - x0, zb - z0), 0.15, rules.width] })) return "piece";
  }
  const m = new Mason({ x: p.x, z: p.z, yaw: p.yaw, c: 1, s: 0, width: 0, depth: 0, rings: [] }, y);
  m.pieces.push({ kind: p.kind, x: p.x, y: y + 0.075, z: p.z, yaw: p.yaw });
  return accept(m) ? y : "budget";
}

/**
 * The street's wrecks and furniture. Pile-ups and the like stand across a street at points of a grid, turned along it
 * with a gap left through them; single assemblies stand at a street's edge, on a verge or in a yard. Along a street, an
 * assembly faces the way traffic on its side runs, and one with `kerb` is set in from the kerb; a car may be slewed out
 * of line. On a verge a car has run off the road; in a yard it is parked in a row or left at any angle. Each car's kind is
 * chosen where it stands (street-cars.ts); every piece stands clear of the pieces already set down.
 */
function makeStreetPieces(site: Site, v: Vocabulary, accept: (m: Mason) => boolean, obstacles: ReturnType<typeof obstacleIndex>, roads: ReturnType<typeof roadIndex>, protectedGround: ReadonlySet<number>): Record<string, number> {
  const out: Record<string, number> = {}; const { nx, x0, z0, x1, z1 } = site.ground.grid; const spacing = v.street.spacing;
  const at = (x: number, z: number): number => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  // A crossing is the street under its paint: the lane runs on across it.
  const road = (surface: number | undefined): boolean => surface === S.STREET || surface === S.HIGHWAY || surface === S.CROSSWALK;
  const cars = v.street.cars; const pick = carPicker(cars, v.seed);
  const rule: Rule = { recipe: "street", height: 0, finish: "rust", feature: "", holes: 0, wall: 0, bay: 8, matched: [], provisional: false, assemblies: v.assemblies };
  const frameAt = (x: number, z: number, yaw: number, width: number, depth: number): Frame => { const a = yaw * Math.PI / 180; return { x, z, yaw, c: Math.cos(a), s: Math.sin(a), width, depth, rings: [] }; };
  const turn = (h: number, from: number, to: number): number => (h & 1 ? 1 : -1) * (from + (to - from) * ((h >>> 1) % 1000) / 1000);
  // A car stands on its own ground, every corner of it within `rise` of that, none on a building's floor or in water.
  const settle = (m: Mason, rise: number): boolean => {
    for (let i = 0; i < m.pieces.length; i++) {
      const p = m.pieces[i]!; if (!wreckLook(p.kind)) continue;
      const y = site.groundAt(p.x, p.z); m.pieces[i] = { ...p, y };
      const { size: [w, , d], at: [ox, , oz] } = extentOf(p.kind); const a = p.yaw * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
      for (const [u, q] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) {
        const x = p.x + (ox + u!) * c + (oz + q!) * s; const z = p.z - (ox + u!) * s + (oz + q!) * c;
        if (site.ground.surface[at(x, z)] === S.FLOOR || site.groundAt(x, z) < .1 || Math.abs(site.groundAt(x, z) - y) > rise) return false;
      }
    }
    return true;
  };
  const clear = (m: Mason): boolean => !m.pieces.some((p) => obstacles.hits(boxOf(p), .2));
  const clusters: { id: string; x: number; y: number; z: number; yaw: number; name: string; points: { x: number; y: number; z: number }[] }[] = [];
  const remnants: { id: string; assembly: string; origin: [number, number, number]; facing: number }[] = [];
  const clusterBins = new Map<number, { x: number; z: number }[]>();
  for (let z = onLattice(z0, 40, v.street.clusterSpacing); z < z1 - 40; z += v.street.clusterSpacing) for (let x = onLattice(x0, 40, v.street.clusterSpacing); x < x1 - 40; x += v.street.clusterSpacing) {
    const surface = site.ground.surface[at(x, z)]; const h = hash3(x, z, v.seed + 141);
    if (h / 4294967296 > v.street.clusterChance || site.groundAt(x, z) < .3 || !road(surface) && surface !== S.YARD) continue;
    const vertical = road(site.ground.surface[at(x, z - 12)]) && road(site.ground.surface[at(x, z + 12)]);
    const horizontal = road(site.ground.surface[at(x - 12, z)]) && road(site.ground.surface[at(x + 12, z)]);
    const names = surface === S.YARD ? v.street.yardClusters : vertical && horizontal ? v.street.junctionAssemblies : v.street.edgeAssemblies;
    const name = names[h % names.length]!; const near = roads.near(x, z, 12);
    const yaw = near ? (frameYaw(near.dx, near.dz) + (h >>> 16 & 1) * 180) % 360 : vertical ? 90 : 0;
    const m = new Mason(frameAt(x, z, yaw, 36, 20), site.groundAt(x, z)); m.pick = pick;
    assembly(m, rule, name, 0, 0, 0);
    const points = (v.assemblies[name]!.passage ?? []).map(([u, v]) => { const [x, z] = m.point(u, v); return { x, y: m.base, z }; });
    if (points.some((p) => Math.abs(site.groundAt(p.x, p.z) - m.base) > .25 || site.ground.surface[at(p.x, p.z)] === S.FLOOR)) continue;
    m.rooms.push({ kind: "street-gap", points });
    if (m.pieces.some((p) => site.ground.surface[at(p.x, p.z)] === S.FLOOR || site.groundAt(p.x, p.z) < .1 || Math.abs(site.groundAt(p.x, p.z) - m.base) > 1)) continue;
    if (!settle(m, .4) || !clear(m)) continue;
    if (accept(m)) {
      out[name] = (out[name] ?? 0) + 1; clusters.push({ id: `cluster:${x}:${z}`, x, y: m.base, z, yaw, name, points });
      gradeApproaches(site, points.slice(1).map((p, i) => ({ street: points[i]!, door: p, core: p, ramp: 1 })), -1, protectedGround);
      remnants.push({ id: `cluster:${x}:${z}`, assembly: name, origin: [x, m.base, z], facing: yaw });
      const k = binKey(Math.floor(x / 32), Math.floor(z / 32));
      if (!clusterBins.has(k)) clusterBins.set(k, []); clusterBins.get(k)!.push({ x, z });
    }
  }
  for (let z = onLattice(z0, 24, spacing); z < z1 - 24; z += spacing) for (let x = onLattice(x0, 24, spacing); x < x1 - 24; x += spacing) {
    const i = at(x, z); const surface = site.ground.surface[i]; const h = hash3(x, z, v.seed + 8);
    if (h / 4294967296 > v.street.chance || site.groundAt(x, z) < .3) continue;
    let occupied = false;
    for (let dz = -1; dz <= 1 && !occupied; dz++) for (let dx = -1; dx <= 1 && !occupied; dx++) occupied = (clusterBins.get(binKey(Math.floor(x / 32) + dx, Math.floor(z / 32) + dz)) ?? []).some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 18 * 18);
    if (occupied) continue;
    const yard = surface === S.YARD;
    const verge = (surface === S.OPEN || surface === S.GREEN || surface === S.DESERT) && [[-4, 0], [4, 0], [0, -4], [0, 4]].some(([dx, dz]) => road(site.ground.surface[at(x + dx!, z + dz!)]));
    if (!yard && !road(surface) && !verge) continue;
    // The middle of the street remains a continuous lane; wrecks occupy its edge.
    const vertical = site.ground.surface[at(x, z - 6)] === surface && site.ground.surface[at(x, z + 6)] === surface;
    const edge = vertical ? site.ground.surface[at(x + 4, z)] !== surface || site.ground.surface[at(x - 4, z)] !== surface : site.ground.surface[at(x, z + 4)] !== surface || site.ground.surface[at(x, z - 4)] !== surface;
    if (!yard && !edge) continue;
    const names = yard ? v.street.yardAssemblies : v.street.assemblies; const name = names[h % names.length]!;
    const kerb = v.assemblies[name]!.kerb; const isCar = v.assemblies[name]!.parts.some(([shape]) => shape === "car");
    const swing = hash3(z, x, v.seed + 911); const near = roads.near(x, z, yard ? 40 : 16);
    let [px, pz, yaw] = [x, z, vertical ? 90 : 0];
    if (near && yard) yaw = frameYaw(near.dx, near.dz) + (swing & 2 ? 90 : 0) + turn(swing >>> 2, 0, 6);
    else if (!near && yard && isCar) yaw = (swing >>> 2) % 360;
    else if (near) {
      // Facing the way traffic on its side runs: along the line where it is on the line's right, against it on its left.
      const f = near.right ? 1 : -1; const hx = near.dx * f; const hz = near.dz * f;
      yaw = frameYaw(hx, hz);
      if (verge && isCar) yaw += turn(swing, 8, 35);
      else if (kerb !== undefined) {
        // In from the kerb on the right of its heading, where the line's foot is the street's middle.
        const slewed = isCar && (swing >>> 8) / 16777216 < cars.slewed;
        const inset = near.segment.half - kerb - (slewed ? .6 : 0);
        px = near.fx - hz * inset; pz = near.fz + hx * inset;
        if (isCar) yaw += slewed ? turn(swing, 12, 30) : turn(swing, 0, 2.5);
      }
    }
    yaw = (yaw % 360 + 360) % 360;
    const m = new Mason(frameAt(px, pz, yaw, 16, 8), site.groundAt(px, pz)); m.pick = pick;
    assembly(m, rule, name, 0, 0, 0);
    if (m.pieces.some((p) => { const j = at(p.x, p.z); return site.ground.surface[j] === S.FLOOR || site.groundAt(p.x, p.z) < .1; })) continue;
    if (!settle(m, .35) || !clear(m)) continue;
    m.cover(0, 0, 9); if (accept(m)) { out[name] = (out[name] ?? 0) + 1; remnants.push({ id: `edge:${x}:${z}`, assembly: name, origin: [px, m.base, pz], facing: yaw }); }
  }
  const folder = join(site.source, "reports", site.world.ruins?.report ?? "ruins"); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "street-clusters.json"), JSON.stringify(clusters) + "\n");
  writeFileSync(join(folder, "remnants.json"), JSON.stringify(remnants) + "\n");
  return out;
}
