import { cruisePolygonSide, type CruiseDeck, type CruiseFootprint, type CruiseRoom } from "../../content/landmarks/cruise-layout.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { castWorld, HIT_STRUCTURE, rayHit } from "../../shared/world/ray.ts";

export interface RoomFloorReport {
  readonly id: string; samples: number; declaredVoids: number; missing: number;
  readonly witnesses: number[][];
}

/** Full occupied plan, sampled at <=0.5 m plus each polygon boundary. A reachable target alone cannot pass this audit.
 * `world.structs` must contain only actual floor parts, so furniture, hull sides and walls cannot stand in for a floor.
 * The small wall inset keeps authored wall centre lines and native lattice rounding out of the occupied interior. */
export function cruiseRoomFloors(world: CollisionWorld, rooms: readonly CruiseRoom[], decks: readonly CruiseDeck[],
  point: (local: readonly number[]) => readonly number[]): RoomFloorReport[] {
  const report: RoomFloorReport[] = [];
  for (const room of rooms) {
    const deck = decks.find(d => d.id === room.deck)!;
    const x0 = room.bounds.min[0]! + .15, x1 = room.bounds.max[0]! - .15;
    const z0 = room.bounds.min[2]! + .15, z1 = room.bounds.max[2]! - .15;
    const footprint: CruiseFootprint = room.footprint ?? { polygons: [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]], holes: [] };
    const row: RoomFloorReport = { id: room.id, samples: 0, declaredVoids: 0, missing: 0, witnesses: [] };
    const sample = (x: number, z: number) => {
      if (!footprint.polygons.some(p => cruisePolygonSide(x, z, p) >= 0)) return;
      if (footprint.holes.some(p => cruisePolygonSide(x, z, p) > 0) || deck.voids.some(v => cruisePolygonSide(x, z, v.polygon) >= 0)) { row.declaredVoids++; return; }
      row.samples++;
      const p = point([x, deck.floorY, z]), hit = castWorld(world, p[0]!, p[1]! + .04, p[2]!, 0, -1, 0, .08, true);
      if (hit !== HIT_STRUCTURE || rayHit.ny < .99) {
        row.missing++;
        if (row.witnesses.length < 6) row.witnesses.push([x, deck.floorY, z]);
      }
    };
    const nx = Math.max(1, Math.ceil((x1 - x0) / .5)), nz = Math.max(1, Math.ceil((z1 - z0) / .5));
    for (let x = 0; x <= nx; x++) for (let z = 0; z <= nz; z++) sample(x0 + (x1 - x0) * x / nx, z0 + (z1 - z0) * z / nz);
    // Narrow/curved pieces may fall between grid lines. Check every outer and hole edge just inside the usable side.
    for (const polygon of [...footprint.polygons, ...footprint.holes]) for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, length = Math.hypot(dx, dz);
      if (!length) continue;
      const steps = Math.max(1, Math.ceil(length / .5));
      for (let n = 0; n < steps; n++) {
        const x = a[0]! + dx * (n + .5) / steps, z = a[1]! + dz * (n + .5) / steps;
        for (const sign of [-1, 1]) sample(x + sign * dz / length * .02, z - sign * dx / length * .02);
      }
    }
    report.push(row);
  }
  return report;
}
