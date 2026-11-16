// The map's landmarks (shared/world/landmark.ts, content/landmarks/): the ground each needs laid under it, then its statics,
// its vehicles and the content it brings, as the map file carries them.

import { LANDMARKS } from "../../content/landmarks/index.ts";
import type { Def } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import type { MapContent, MapStatic, MapVehicle } from "../../shared/world/mapfile.ts";
import { S, type Ground } from "./ground.ts";

/** Where world.json sets a landmark down: its origin's x and z, its height (the sea's where not given), and its yaw in degrees. */
export interface LandmarkSite {
  readonly name: string;
  readonly at: readonly [number, number];
  readonly y?: number;
  readonly yaw: number;
}

/** Metres over which ground laid to a height eases back into the ground round it. */
const EASE = 16;

const yawUnits = (degrees: number): number => Math.round((degrees * 65536) / 360) & 65535;

export function landmarksOf(sites: readonly LandmarkSite[]): { site: LandmarkSite; landmark: Landmark }[] {
  return sites.map((site) => {
    const landmark = LANDMARKS.find((l) => l.name === site.name);
    if (!landmark) throw new Error(`world.json places a landmark "${site.name}", and content/landmarks/index.ts has none of that name`);
    return { site, landmark };
  });
}

/** Every definition the map's landmarks bring. */
export const landmarkDefs = (placed: readonly { landmark: Landmark }[]): Def[] => placed.flatMap((p) => p.landmark.defs);

/**
 * The ground each landmark asks for, laid on the map's samples (x is size less twice the column, z size less twice the
 * row): dug rectangles lowered to their depth and made deep water, the rest set to their height and paved, easing into the
 * ground round them.
 */
export function layLandmarkGround(ground: Ground, placed: readonly { site: LandmarkSite; landmark: Landmark }[], size: number, sea: number): void {
  const n = ground.n;
  for (const { site, landmark } of placed) {
    const a = (yawUnits(site.yaw) / 65536) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    for (const g of landmark.ground) {
      const [x0, z0] = [Math.min(g.from[0], g.to[0]), Math.min(g.from[1], g.to[1])], [x1, z1] = [Math.max(g.from[0], g.to[0]), Math.max(g.from[1], g.to[1])];
      const reach = Math.hypot(x1 - x0, z1 - z0) / 2 + EASE + Math.hypot((x0 + x1) / 2, (z0 + z1) / 2);
      const cols = [Math.floor((size - site.at[0] - reach) / 2), Math.ceil((size - site.at[0] + reach) / 2)];
      const rows = [Math.floor((size - site.at[1] - reach) / 2), Math.ceil((size - site.at[1] + reach) / 2)];
      for (let row = Math.max(0, rows[0]!); row <= Math.min(n - 1, rows[1]!); row++) {
        for (let col = Math.max(0, cols[0]!); col <= Math.min(n - 1, cols[1]!); col++) {
          // The sample in the landmark's metres: its yaw undone.
          const dx = size - col * 2 - site.at[0], dz = size - row * 2 - site.at[1];
          const lx = c * dx - s * dz, lz = s * dx + c * dz;
          const out = Math.hypot(Math.max(x0 - lx, 0, lx - x1), Math.max(z0 - lz, 0, lz - z1));
          const i = row * n + col, y = (site.y ?? sea) + g.y;
          if (g.dig) {
            if (out > 0 || ground.height[i]! <= y) continue;
            ground.height[i] = y;
            ground.surface[i] = S.DEEP;
            ground.water[i] = 1;
            continue;
          }
          if (out >= EASE) continue;
          const w = out === 0 ? 1 : 1 - out / EASE;
          ground.height[i] = ground.height[i]! + (y - ground.height[i]!) * w * w * (3 - 2 * w);
          if (out === 0) {
            ground.surface[i] = S.DECK;
            ground.water[i] = 0;
          }
        }
      }
    }
  }
}

/** The landmarks' statics, vehicles and content as the map file has them. A boat floats at the sea under it. */
export function placeLandmarks(placed: readonly { site: LandmarkSite; landmark: Landmark }[], reg: Registry, sea: number): { statics: MapStatic[]; vehicles: MapVehicle[]; content: MapContent } {
  const statics: MapStatic[] = [], vehicles: MapVehicle[] = [];
  for (const { site, landmark } of placed) {
    const made = placeLandmark(landmark, site.at[0], site.y ?? sea, site.at[1], yawUnits(site.yaw));
    statics.push(...made.statics);
    for (const v of made.vehicles) {
      const def = reg.vehicle[reg.index.get(v.kind) ?? 0];
      vehicles.push(def && isBoatVehicle(def) ? { ...v, y: boatRestY(def.spec, sea) } : v);
    }
  }
  return { statics, vehicles, content: { landmarks: placed.map((p) => p.landmark.name), defs: landmarkDefs(placed) } };
}
