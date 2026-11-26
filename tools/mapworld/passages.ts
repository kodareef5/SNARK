// Streets that run through a building at the street's own level: those the data says do (tools/mapdata/streets.py
// `passage`: a building passage, a covered or an indoor way), and those that keep their line through a footprint
// (streets/yield.ts `passage_runs`: a through street the building yields to). The street stays a ground street; the
// ruins clear their ground storey along it (ruin-clearance.ts), as they clear a bridge's runout, and what stands over
// it is carried on piers or taken away (ruin-openings.ts).

import type { Site } from "./statics.ts";
import { binKey } from "./raster.ts";
import { NOT_DRIVEN, readRoads } from "./streets/yield.ts";

/** A passage's line at the ground, in lattice metres, and the street's width. */
export interface Passage {
  readonly points: { x: number; y: number; z: number }[];
  readonly width: number;
  /** Whether a street's carriageway, any street's, comes within `within` metres of a place: no pier stands there. */
  readonly onStreet?: (x: number, z: number, within: number) => boolean;
}

/** Metres between a passage's points: its height follows the ground, a floor's inside a building. */
const STEP = 4;
/** The side of the squares the streets near a passage are listed by. */
const NEAR = 32;

type Road = { geometry: { type: string; coordinates: number[][] | number[][][] }; properties: { passage?: boolean; passage_runs?: number[][][]; bridge?: boolean; tunnel?: boolean; width_m?: number; mtfcc?: string; highway?: string | null } };
const runsOf = (f: Road): number[][][] => (f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]]);

/**
 * The site's passages, from its road pieces; none where the layer is absent or older than the tag. Each is kept clear
 * as a way is (`growthRoutes`, where the site has them): under a building the ground is the footprint's, no street's
 * sample, so nothing else tells a prop, a parked car or a tree that a street runs there.
 */
export function readPassages(site: Pick<Site, "source" | "toLattice" | "groundAt"> & { growthRoutes?: Site["growthRoutes"] }): Passage[] {
  const lines = readRoads<Road>(site.source);
  const found: { points: Passage["points"]; width: number }[] = [];
  for (const f of lines) {
    // A bridge or a tunnel is not on the ground, whatever else its way is tagged.
    if (f.properties.bridge === true || f.properties.tunnel === true) continue;
    // A tagged passage is its whole line; a street that keeps its line through a footprint, the runs of it inside.
    for (const run of f.properties.passage === true ? runsOf(f) : f.properties.passage_runs ?? []) {
      const ends = run.map(([e, n]) => site.toLattice(e!, n!));
      const points: Passage["points"] = [];
      for (let i = 1; i < ends.length; i++) {
        const [ax, az] = ends[i - 1]!, [bx, bz] = ends[i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
        for (let k = i === 1 ? 0 : 1; k <= steps; k++) points.push({ x: ax + ((bx - ax) * k) / steps, y: 0, z: az + ((bz - az) * k) / steps });
      }
      if (points.length > 1) found.push({ points, width: f.properties.width_m ?? 8 });
    }
  }
  if (found.length === 0) return [];
  // The streets on the ground that come by a passage, by the squares their steps lie in.
  const by = new Set<number>(), near = new Map<number, number[]>();
  for (const p of found) for (const q of p.points) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) by.add(binKey(Math.floor(q.x / NEAR) + dx, Math.floor(q.z / NEAR) + dz));
  for (const f of lines) {
    if (NOT_DRIVEN.has(f.properties.mtfcc ?? "") || NOT_DRIVEN.has(f.properties.highway ?? "") || f.properties.bridge === true || f.properties.tunnel === true) continue;
    const half = (f.properties.width_m ?? 8) / 2;
    for (const run of runsOf(f)) {
      let from: [number, number] | null = null;
      for (const [e, n] of run) {
        const to = site.toLattice(e!, n!);
        if (from) {
          // A long step is listed a part at a time, so each part lies in the squares its ends do.
          const parts = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / NEAR));
          for (let k = 0; k < parts; k++) {
            const [ax, az, bx, bz] = [from[0] + ((to[0] - from[0]) * k) / parts, from[1] + ((to[1] - from[1]) * k) / parts, from[0] + ((to[0] - from[0]) * (k + 1)) / parts, from[1] + ((to[1] - from[1]) * (k + 1)) / parts];
            for (const key of new Set([binKey(Math.floor(ax / NEAR), Math.floor(az / NEAR)), binKey(Math.floor(bx / NEAR), Math.floor(bz / NEAR))])) {
              if (by.has(key)) (near.get(key) ?? near.set(key, []).get(key)!).push(ax, az, bx, bz, half);
            }
          }
        }
        from = to;
      }
    }
  }
  const onStreet = (x: number, z: number, within: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = near.get(binKey(Math.floor(x / NEAR) + dx, Math.floor(z / NEAR) + dz));
      for (let k = 0; list && k < list.length; k += 5) {
        const ax = list[k]!, az = list[k + 1]!, ex = list[k + 2]! - ax, ez = list[k + 3]! - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(x - ax - ex * t, z - az - ez * t) < list[k + 4]! + within) return true;
      }
    }
    return false;
  };
  for (const p of found) site.growthRoutes?.push({ points: p.points.map((q) => ({ x: q.x, y: site.groundAt(q.x, q.z), z: q.z })), width: p.width });
  return found.map((p) => ({ ...p, onStreet }));
}

/** The passages with each point's height set to the ground there, as it stands when called. */
export function onGround(passages: readonly Passage[], groundAt: (x: number, z: number) => number): Passage[] {
  return passages.map((p) => ({ ...p, points: p.points.map((q) => ({ x: q.x, y: groundAt(q.x, q.z), z: q.z })) }));
}
