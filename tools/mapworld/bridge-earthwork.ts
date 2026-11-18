import { STRUCT_UNITS } from "../../shared/coords.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import type { DeckPoint } from "./bridges.ts";
import type { Site, StaticPiece } from "./statics.ts";
import { S } from "./ground.ts";
import type { roadIndex } from "./street-cars.ts";

/** An emitted road end close enough to dry ground to have an earth approach. Coordinates are in the source lattice. */
export interface RoadEntrance {
  x: number; y: number; z: number; dx: number; dz: number; width: number;
  /** Actual emitted slabs in the first twelve metres, ending before any authored gap. */
  slabs: StaticPiece[];
  /** The continuing source road, sampled before buildings alter its dry soil. No extrapolation past its end. */
  runout?: { x: number; y: number; z: number }[];
}

/** Follow one aligned source polyline away from a real abutment, including its bends. The bridge/source offset
 * blends out over twelve metres. Stop at water, a mapped gap, an abrupt natural grade, or the source line's end. */
export function roadRunout(site: Site, e: RoadEntrance, roads: ReturnType<typeof roadIndex>): number | undefined {
  let best: typeof roads.segments[number] | undefined, distance = Infinity, foot = 0, direction = 1;
  for (const s of roads.segments) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, length = Math.hypot(dx, dz);
    if (Math.abs((dx * e.dx + dz * e.dz) / length) < .9) continue;
    const t = Math.max(0, Math.min(1, ((e.x - s.ax) * dx + (e.z - s.az) * dz) / length ** 2));
    const d = Math.hypot(e.x - s.ax - dx * t, e.z - s.az - dz * t);
    if (d >= distance || d > Math.min(6, e.width / 2)) continue;
    best = s; distance = d; foot = t; direction = dx * e.dx + dz * e.dz < 0 ? 1 : -1;
  }
  if (!best) return;
  const line = roads.segments.filter(s => s.line === best.line), start = line.indexOf(best);
  const fx = best.ax + (best.bx - best.ax) * foot, fz = best.az + (best.bz - best.az) * foot;
  const vertices = [{ x: fx, z: fz }];
  for (let i = start; i >= 0 && i < line.length; i += direction) {
    const s = line[i]!, previous = vertices.at(-1)!;
    if (i !== start && Math.hypot(previous.x - (direction > 0 ? s.ax : s.bx), previous.z - (direction > 0 ? s.az : s.bz)) > .1) break;
    vertices.push({ x: direction > 0 ? s.bx : s.ax, z: direction > 0 ? s.bz : s.az });
    if (Math.hypot(vertices.at(-1)!.x - fx, vertices.at(-1)!.z - fz) > 30) break;
  }
  const points = [{ x: e.x, y: site.groundAt(e.x, e.z), z: e.z }];
  let travelled = 0, next = 2;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < .01) continue;
    while (next <= travelled + length && next <= 24) {
      const t = (next - travelled) / length, blend = Math.max(0, 1 - next / 12);
      const x = a.x + (b.x - a.x) * t + (e.x - fx) * blend, z = a.z + (b.z - a.z) * t + (e.z - fz) * blend;
      const y = site.groundAt(x, z), dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
      // Preserve ordinary hillside roads too: this guard rejects a cliff, not a twenty-degree natural grade.
      if (Math.abs(y - points.at(-1)!.y) > 1 || [-e.width / 2, 0, e.width / 2].some(side => !dry(site, x - dz * side, z + dx * side))) {
        e.runout = points; return best.line;
      }
      points.push({ x, y, z }); next += 2;
    }
    travelled += length;
  }
  e.runout = points;
  return best.line;
}

/** Soil already supporting a dry road must not be excavated later by a nearby room/door. This mask preserves
 * original soil; it creates no fill, and stops at wet samples, authored gaps and the measured runout boundary. */
export function roadGroundSamples(site: Site, entrances: readonly RoadEntrance[]): Set<number> {
  const g = site.ground.grid, kept = new Set<number>();
  for (const e of entrances) for (let k = 1; k < (e.runout?.length ?? 0); k++) {
    const a = e.runout![k - 1]!, b = e.runout![k]!, dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
    const radius = e.width / 2;
    for (let row = Math.max(0, Math.floor((g.z1 - Math.max(a.z, b.z) - radius) / g.cell)); row <= Math.min(g.nz - 1, Math.ceil((g.z1 - Math.min(a.z, b.z) + radius) / g.cell)); row++) {
      for (let col = Math.max(0, Math.floor((g.x1 - Math.max(a.x, b.x) - radius) / g.cell)); col <= Math.min(g.nx - 1, Math.ceil((g.x1 - Math.min(a.x, b.x) + radius) / g.cell)); col++) {
        const x = g.x1 - col * g.cell, z = g.z1 - row * g.cell;
        if ((x - e.x) * e.dx + (z - e.z) * e.dz > 2) continue;
        const raw = ((x - a.x) * dx + (z - a.z) * dz) / length2;
        if (k === e.runout!.length - 1 && raw > 1) continue;
        const t = Math.max(0, Math.min(1, raw));
        if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) <= radius && dry(site, x, z)) kept.add(row * g.nx + col);
      }
    }
  }
  return kept;
}

export function roadEntrances(site: Site, deck: readonly DeckPoint[], rows: readonly StaticPiece[][] | undefined, width: number): RoadEntrance[] {
  const result: RoadEntrance[] = [];
  for (const end of [0, deck.length - 1]) {
    const direction = end === 0 ? 1 : -1, d = deck[end], next = deck[end + direction];
    if (!d || !next || d.gap || next.gap) continue;
    const length = Math.hypot(next.x - d.x, next.z - d.z);
    if (length < .01 || Math.abs(d.y - site.groundAt(d.x, d.z)) > .6 || !dry(site, d.x, d.z)) continue;
    const entrance: RoadEntrance = { x: d.x, y: d.y, z: d.z, dx: (next.x - d.x) / length, dz: (next.z - d.z) / length, width, slabs: [] };
    for (let i = end; i >= 0 && i < deck.length; i += direction) {
      const row = deck[i]!;
      if (row.gap || Math.hypot(row.x - d.x, row.z - d.z) > 12) break;
      if (rows) entrance.slabs.push(...rows[i]!);
    }
    if (!rows || entrance.slabs.length) result.push(entrance);
  }
  return result;
}

/** A station ramp can cross the road at ground level or above vehicle clearance, but cannot hang in the driving
 * volume. Plan another complete station connection rather than removing one of its ramp modules afterward. */
export function roadRunoutClearance(entrances: readonly RoadEntrance[]): (x: number, y: number, z: number) => boolean {
  type Point = { x: number; y: number; z: number };
  const bins = new Map<string, { a: Point; b: Point; radius: number }[]>();
  for (const e of entrances) for (let i = 1; i < (e.runout?.length ?? 0); i++) {
    const a = e.runout![i - 1]!, b = e.runout![i]!, radius = e.width / 2 + 2.5;
    const segment = { a, b, radius };
    for (let x = Math.floor((Math.min(a.x, b.x) - radius) / 32); x <= Math.floor((Math.max(a.x, b.x) + radius) / 32); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - radius) / 32); z <= Math.floor((Math.max(a.z, b.z) + radius) / 32); z++) {
        const key = `${x},${z}`, bin = bins.get(key);
        if (bin) bin.push(segment); else bins.set(key, [segment]);
      }
    }
  }
  return (x, y, z) => {
    for (const { a, b, radius } of bins.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) >= radius) continue;
      const ground = a.y + (b.y - a.y) * t;
      if (y > ground + .35 && y < ground + 3.8) return true;
    }
    return false;
  };
}

function sample(site: Site, x: number, z: number): number {
  const g = site.ground.grid, col = Math.round((g.x1 - x) / g.cell), row = Math.round((g.z1 - z) / g.cell);
  return row < 0 || col < 0 || row >= g.nz || col >= g.nx ? -1 : row * g.nx + col;
}
function dry(site: Site, x: number, z: number): boolean {
  const i = sample(site, x, z);
  return i >= 0 && !site.ground.water[i] && !site.ground.lakes?.body[i] && !site.ground.gaps[i];
}

// Transient planning data. Keep original road heights so later cuts for a lower passage remain intact.
const shoulderHeights = new WeakMap<RoadEntrance, Map<number, number>>();

export function surveyRoadShoulder(site: Site, e: RoadEntrance, roads: ReturnType<typeof roadIndex>, line: number): void {
  const g = site.ground.grid, radius = e.width / 2 + 16, heights = new Map<number, number>();
  for (let row = Math.max(0, Math.floor((g.z1 - e.z - radius) / g.cell)); row <= Math.min(g.nz - 1, Math.ceil((g.z1 - e.z + radius) / g.cell)); row++) {
    for (let col = Math.max(0, Math.floor((g.x1 - e.x - radius) / g.cell)); col <= Math.min(g.nx - 1, Math.ceil((g.x1 - e.x + radius) / g.cell)); col++) {
      const x = g.x1 - col * g.cell, z = g.z1 - row * g.cell, i = row * g.nx + col;
      const along = (x - e.x) * e.dx + (z - e.z) * e.dz, side = Math.abs((z - e.z) * e.dx - (x - e.x) * e.dz);
      if (along < -6 || along > 14 || side > e.width / 2 + g.cell || !dry(site, x, z)) continue;
      const surface = site.ground.surface?.[i];
      if (surface !== S.HIGHWAY && surface !== S.STREET && surface !== S.DECK) continue;
      const road = roads.near(x, z, e.width / 2 + 2 * g.cell);
      if (road?.segment.line === line && road.distance <= road.segment.half + g.cell &&
        Math.abs(road.dx * e.dx + road.dz * e.dz) >= .9) heights.set(i, site.ground.height[i]!);
    }
  }
  shoulderHeights.set(e, heights);
}

/** Restore shallow dry ground below the actual slabs. A deeper shoulder needs a surveyed matching street
 * at its original elevation. The four-metre feather blends the approach into adjacent soil. */
export function gradeRoadEntrances(site: Site, entrances: readonly RoadEntrance[]): number {
  const g = site.ground.grid;
  let changed = 0;
  for (const e of entrances) {
    const slabs = e.slabs.map(p => {
      frameOf(Math.round(p.yaw * 65536 / 360) & 65535);
      return { x: Math.round(p.x * STRUCT_UNITS) / STRUCT_UNITS, y: Math.round(p.y * STRUCT_UNITS) / STRUCT_UNITS,
        z: Math.round(p.z * STRUCT_UNITS) / STRUCT_UNITS, c: frame.cos, s: frame.sin, stretch: frame.stretch,
        grade: Number(p.kind.match(/floorroad([1-4])_/)?.[1] ?? 0) / 32 };
    });
    const radius = e.width / 2 + 20;
    const col0 = Math.max(0, Math.floor((g.x1 - e.x - radius) / g.cell)), col1 = Math.min(g.nx - 1, Math.ceil((g.x1 - e.x + radius) / g.cell));
    const row0 = Math.max(0, Math.floor((g.z1 - e.z - radius) / g.cell)), row1 = Math.min(g.nz - 1, Math.ceil((g.z1 - e.z + radius) / g.cell));
    for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) {
      const x = g.x1 - col * g.cell, z = g.z1 - row * g.cell, index = row * g.nx + col;
      if (!dry(site, x, z)) continue;
      const along = (x - e.x) * e.dx + (z - e.z) * e.dz, side = Math.abs((z - e.z) * e.dx - (x - e.x) * e.dz);
      const fade = Math.min(1, (along + 8) / 4, (16 - along) / 4, (e.width / 2 + 6 - side) / 4);
      if (fade <= 0) continue;
      let nearest = Infinity, top = -Infinity, nearTop = -Infinity;
      for (const p of slabs) {
        const u = ((x - p.x) * p.c - (z - p.z) * p.s) / p.stretch;
        const v = ((x - p.x) * p.s + (z - p.z) * p.c) / p.stretch;
        const distance = Math.max(0, Math.abs(u) - 2) ** 2 + Math.max(0, Math.abs(v) - 2) ** 2;
        const y = p.y + .2 + v * p.grade;
        // Any slab meeting this sample's adjacent cells can define their upper road surface. This avoids
        // interpolating a low first slab under the vertical edge of the next quantised grade.
        if (distance <= 2 * g.cell * g.cell) nearTop = Math.max(nearTop, y);
        if (distance < nearest - 1e-6) { nearest = distance; top = y; }
        else if (distance <= nearest + 1e-6) top = Math.max(top, y);
      }
      top = Math.max(top, nearTop);
      const old = site.ground.height[index]!, rise = top - .02 - old;
      if (rise <= 0) continue;
      if (rise > 1.25) {
        const surveyed = shoulderHeights.get(e)?.get(index);
        if (rise > 3.25 || surveyed === undefined || old < surveyed - .05) continue;
      }
      site.ground.height[index] = old + rise * fade;
      changed++;
    }
  }
  return changed;
}
