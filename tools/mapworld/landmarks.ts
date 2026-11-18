// The map's landmarks (shared/world/landmark.ts, content/landmarks/): the ground each needs laid under it, then its statics,
// its vehicles and the content it brings, as the map file carries them.

import { LANDMARKS } from "../../content/landmarks/index.ts";
import type { Def } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { isBoatVehicle } from "../../shared/sim/vehicle.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { GROUND_EASE, landmarkGround, placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import type { MapContent, MapLandmark, MapStatic, MapVehicle } from "../../shared/world/mapfile.ts";
import type { Grid } from "./base.ts";
import { S, type Ground } from "./ground.ts";

/**
 * Where world.json sets a landmark down: its origin's longitude and latitude, its height (the sea's where not given), and
 * its yaw in degrees, 0 with its +z to the map's north.
 */
export interface LandmarkSite {
  readonly name: string;
  readonly at: readonly [number, number];
  readonly y?: number;
  readonly yaw: number;
}

/** A site with its origin in the map's metres, as `toSample` (the map build's) puts a longitude and latitude on its samples. */
type Sited = { site: LandmarkSite & { readonly x: number; readonly z: number }; landmark: Landmark };

const yawUnits = (degrees: number): number => Math.round((degrees * 65536) / 360) & 65535;

export function landmarksOf(sites: readonly LandmarkSite[], toSample: (lon: number, lat: number) => [number, number], grid: Pick<Grid, "sizeX" | "sizeZ">): Sited[] {
  return sites.map((site) => {
    const landmark = LANDMARKS.find((l) => l.name === site.name);
    if (!landmark) throw new Error(`world.json places a landmark "${site.name}", and content/landmarks/index.ts has none of that name`);
    const [col, row] = toSample(site.at[0], site.at[1]);
    return { site: { ...site, x: grid.sizeX - col * 2, z: grid.sizeZ - row * 2 }, landmark };
  });
}

/** Every definition the map's landmarks bring. */
export const landmarkDefs = (placed: readonly { landmark: Landmark }[]): Def[] => placed.flatMap((p) => p.landmark.defs);

/**
 * The ground each landmark asks for, laid on the map's samples (x is sizeX less twice the column, z sizeZ less twice the
 * row): dug ground made deep water, paved ground deck. The samples it laid, 1 each, where nothing is to grow.
 */
export function layLandmarkGround(ground: Ground, placed: readonly Sited[], sea: number): Uint8Array {
  const { nx, nz, sizeX, sizeZ } = ground.grid, laid = new Uint8Array(1), kept = new Uint8Array(nx * nz);
  for (const { site, landmark } of placed) {
    const reach = Math.max(...landmark.ground.flatMap((g) => [...g.from, ...g.to].map(Math.abs))) * Math.SQRT2 + GROUND_EASE;
    const [c0, c1] = [Math.floor((sizeX - site.x - reach) / 2), Math.ceil((sizeX - site.x + reach) / 2)];
    const [r0, r1] = [Math.floor((sizeZ - site.z - reach) / 2), Math.ceil((sizeZ - site.z + reach) / 2)];
    for (let row = Math.max(0, r0); row <= Math.min(nz - 1, r1); row++) {
      for (let col = Math.max(0, c0); col <= Math.min(nx - 1, c1); col++) {
        const i = row * nx + col;
        ground.height[i] = landmarkGround(landmark, site.x, site.y ?? sea, site.z, yawUnits(site.yaw), sizeX - col * 2, sizeZ - row * 2, ground.height[i]!, laid);
        if (laid[0] === 1) [ground.surface[i], ground.water[i]] = [S.DEEP, 1];
        else if (laid[0] === 2) [ground.surface[i], ground.water[i]] = [S.DECK, 0];
        kept[i] = laid[0] === 0 ? 0 : 1;
      }
    }
  }
  return kept;
}

/** The landmarks' statics, vehicles and content as the map file has them. A boat floats at the sea under it. */
export function placeLandmarks(placed: readonly Sited[], reg: Registry, sea: number): { statics: MapStatic[]; vehicles: MapVehicle[]; content: MapContent } {
  const statics: MapStatic[] = [], vehicles: MapVehicle[] = [], landmarks: MapLandmark[] = [];
  for (const { site, landmark } of placed) {
    const made = placeLandmark(landmark, site.x, site.y ?? sea, site.z, yawUnits(site.yaw));
    statics.push(...made.statics);
    landmarks.push(made.placed);
    for (const v of made.vehicles) {
      const def = reg.vehicle[reg.index.get(v.kind) ?? 0];
      vehicles.push(def && isBoatVehicle(def) ? { ...v, y: boatRestY(def.spec, sea) } : v);
    }
  }
  return { statics, vehicles, content: { landmarks, defs: landmarkDefs(placed) } };
}
