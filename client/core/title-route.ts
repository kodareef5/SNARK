import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";

/** Reproducible Miami camera and animation timeline. Coordinates are engine metres, west and north. */
export interface TitleFlight {
  map: string;
  mount: string;
  saddle: string;
  rider: string;
  hour: number;
  seconds: number;
  poster: number;
  splash: number;
  points: readonly (readonly number[])[];
  camera: { angle: number; distance: number; height: number; yawLimit: number; pitchLimit: number };
}
export const MIAMI_FLIGHT = {
  map: "core:miami",
  mount: "core:pteranodon",
  saddle: "core:saddle_pteranodon",
  rider: "core:survivor",
  hour: 7.4,
  seconds: 132,
  poster: 18,
  splash: 22,
  camera: { angle: -0.48, distance: 8.1, height: 2.05, yawLimit: 0.8, pitchLimit: 0.35 },
  // The route passes Watson Island, the bay side of downtown, Brickell Key and the turning basin.
  points: [
    [4850, 84, 4600],
    [5330, 110, 4230],
    [5780, 129, 3640],
    [5630, 102, 2930],
    [5040, 90, 2510],
    [4450, 102, 3050],
    [4320, 89, 3800],
    [4470, 74, 4370],
  ],
} as const satisfies TitleFlight;

export function flightPosition(seconds: number, route: TitleFlight = MIAMI_FLIGHT): number[] {
  const points = route.points,
    n = points.length;
  const u = ((((seconds % route.seconds) + route.seconds) % route.seconds) / route.seconds) * n;
  const i = Math.floor(u),
    t = u - i;
  return [0, 1, 2].map((axis) => {
    const a = points[(i + n - 1) % n]![axis]!,
      b = points[i]![axis]!;
    const c = points[(i + 1) % n]![axis]!,
      d = points[(i + 2) % n]![axis]!;
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * b - 3 * c + d - a)));
  });
}

/** Chunks a side of the portrait's beach, and metres to the left of its middle, as the portrait faces, of the water's edge. */
export const STUDIO_CHUNKS = 4;
export const STUDIO_SHORE = 40;
/**
 * Sand colours of the palette for dry sand, wet sand and the shallows' bed. Drawn flat, with no finishes, the dry one is
 * two steps darker than the beach's commonest (tools/mapworld/tint.ts), so that it reads as the still's textured sand.
 */
export const STUDIO_TINTS = { sand: 123, wet: 121, bed: 122 } as const;

/**
 * The ground the menu's portrait stands the survivor on where it loads no map (client/entry/flight.ts): a beach in the
 * beach's own colours, as the still it fades in over has, with the sea along its left, -x, since the portrait faces -z.
 * The sand rises 2 m in 100 from the water to 0.6 m, and the bed falls 1 m in 15 to 4 m deep.
 */
export function studioGround(): Heightfield {
  const dims = { chunksX: STUDIO_CHUNKS, chunksZ: STUDIO_CHUNKS };
  const hf = new Heightfield(dims, TERRAIN_CELL, -8, 1 / 64);
  const shore = hf.sizeX / 2 - STUDIO_SHORE;
  for (let j = 0; j < hf.nz; j++) {
    for (let i = 0; i < hf.nx; i++) {
      const off = i * hf.cell - shore;
      const y = off >= 0 ? Math.min(0.6, 0.02 * off) : Math.max(-4, off / 15);
      hf.heights[j * hf.nx + i] = Math.round((y - hf.minY) / hf.stepY);
      hf.tint[j * hf.nx + i] = y > 0.25 ? STUDIO_TINTS.sand : y > -0.4 ? STUDIO_TINTS.wet : STUDIO_TINTS.bed;
    }
  }
  hf.seaLevel = 0;
  return hf;
}
