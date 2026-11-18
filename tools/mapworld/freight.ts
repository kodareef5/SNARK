// Park a detached freight trailer on hardstanding beside a road, parallel to the kerb.
// It goes through the same prop, route and chunk checks as the rest of the yard.
import { S } from "./ground.ts";
import { boxOf, extentOf, type Box } from "./ruin-obstacles.ts";
import { Mason, worldPoint, type Frame } from "./ruin-geometry.ts";
import type { Site } from "./statics.ts";
import type { Cars, roadIndex } from "./street-cars.ts";

const HARDSTANDING = new Set<number>([S.LOT, S.YARD]);
const KIND = "core:box_trailer";

export function parkFreightTrailers(site: Site, roads: ReturnType<typeof roadIndex>, rules: Cars["parked"]["trailers"],
  blocked: (box: Box) => boolean, accept: (m: Mason) => boolean): void {
  if (!rules || rules.perDistrict <= 0) return;
  const { ground } = site, { nx, x0, x1, z0, z1 } = ground.grid;
  const [width, , length] = extentOf(KIND).size;
  const cell = (x: number, z: number) => Math.round((z1 - z) / 2) * nx + Math.round((x1 - x) / 2);
  const kept = new Map<string, number>();
  const districts = new Set(site.world.districts.filter(d => rules.styles.includes(d.style)).map(d => d.name));
  if (!districts.size) return;
  for (const road of roads.segments) {
    if (kept.size === districts.size && [...kept.values()].every(n => n >= rules.perDistrict)) break;
    const span = Math.hypot(road.bx - road.ax, road.bz - road.az);
    const dx = (road.bx - road.ax) / span, dz = (road.bz - road.az) / span;
    for (let d = 8; d <= span - 8; d += 32) for (const side of [-1, 1]) {
      const offset = side * (road.half + 12);
      const x = road.ax + dx * d - dz * offset, z = road.az + dz * d + dx * offset;
      if (Math.min(x - x0, z - z0, x1 - x, z1 - z) < length / 2 + width / 2) continue;
      const index = cell(x, z), district = site.world.districts[ground.district[index]! - 1]?.name;
      if (!district || !districts.has(district) || (kept.get(district) ?? 0) >= rules.perDistrict || !HARDSTANDING.has(ground.surface[index]!)) continue;
      const yaw = Math.atan2(dx, dz) * 180 / Math.PI, y = site.groundAt(x, z);
      const frame: Frame = { x, z, yaw, c: dz, s: dx, width, depth: length, rings: [] };
      let fits = true;
      for (let col = -1; col <= 1 && fits; col++) for (let row = -4; row <= 4; row++) {
        const [px, pz] = worldPoint(frame, col * (width / 2 + .5), row * (length / 2 + .5) / 4);
        const h = site.groundAt(px, pz);
        if (!HARDSTANDING.has(ground.surface[cell(px, pz)]!) || Math.abs(h - y) > .15 || h <= site.waterAt(px, pz) + .15) { fits = false; break; }
      }
      if (!fits) continue;
      const trailer = { kind: KIND, x, y, z, yaw };
      if (blocked(boxOf(trailer))) continue;
      const m = new Mason(frame, y);
      m.pieces.push(trailer);
      if (accept(m)) {
        kept.set(district, (kept.get(district) ?? 0) + 1);
        site.growthRoutes.push({ points: [-1, 1].map(sign => ({ x: x + sign * dx * length / 2, y, z: z + sign * dz * length / 2 })), width: width + 1 });
      }
    }
  }
}
