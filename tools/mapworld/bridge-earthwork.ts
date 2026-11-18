import { STRUCT_UNITS } from "../../shared/coords.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import type { DeckPoint } from "./bridges.ts";
import type { Site, StaticPiece } from "./statics.ts";

/** An emitted road end close enough to dry ground to have an earth approach. Coordinates are in the source lattice. */
export interface RoadEntrance {
  x: number; y: number; z: number; dx: number; dz: number; width: number;
  /** Actual emitted slabs in the first twelve metres, ending before any authored gap. */
  slabs: StaticPiece[];
}

export function roadEntrances(site: Site, deck: readonly DeckPoint[], rows: readonly StaticPiece[][], width: number): RoadEntrance[] {
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
      entrance.slabs.push(...rows[i]!);
    }
    if (entrance.slabs.length) result.push(entrance);
  }
  return result;
}

function sample(site: Site, x: number, z: number): number {
  const g = site.ground.grid, col = Math.round((g.x1 - x) / g.cell), row = Math.round((g.z1 - z) / g.cell);
  return row < 0 || col < 0 || row >= g.nz || col >= g.nx ? -1 : row * g.nx + col;
}
function dry(site: Site, x: number, z: number): boolean {
  const i = sample(site, x, z);
  return i >= 0 && !site.ground.water[i] && !site.ground.lakes?.body[i] && !site.ground.gaps[i];
}

/** Restore shallow dry earth below the real road surface, across its width and small seams. Never fill a water/gap
 * sample or a usable underpass: at most 1.25 m of fill is permitted. A four-metre shoulder blends into untouched soil. */
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
      if (rise <= 0 || rise > 1.25) continue;
      site.ground.height[index] = old + rise * fade;
      changed++;
    }
  }
  return changed;
}
