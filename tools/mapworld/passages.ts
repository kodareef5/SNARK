// Streets that run through a building at the street's own level: those the data says do (tools/mapdata/streets.py
// `passage`: a building passage, a covered or an indoor way), and those that keep their line through a footprint
// (streets/yield.ts `passage_runs`: a through street the building yields to). The street stays a ground street; the
// ruins clear their ground storey along it (ruin-clearance.ts), as they clear a bridge's runout, and the storeys above
// stand over it.

import type { Site } from "./statics.ts";
import { readRoads } from "./streets/yield.ts";

/** A passage's line at the ground, in lattice metres, and the street's width. */
export interface Passage {
  readonly points: { x: number; y: number; z: number }[];
  readonly width: number;
}

/** Metres between a passage's points: its height follows the ground, a floor's inside a building. */
const STEP = 4;

/** The site's passages, from its road pieces; none where the layer is absent or older than the tag. */
export function readPassages(site: Pick<Site, "source" | "toLattice" | "groundAt">): Passage[] {
  const lines = readRoads<{ geometry: { type: string; coordinates: number[][] | number[][][] }; properties: { passage?: boolean; passage_runs?: number[][][]; bridge?: boolean; tunnel?: boolean; width_m?: number } }>(site.source);
  const out: Passage[] = [];
  for (const f of lines) {
    // A bridge or a tunnel is not on the ground, whatever else its way is tagged.
    if (f.properties.bridge === true || f.properties.tunnel === true) continue;
    // A tagged passage is its whole line; a street that keeps its line through a footprint, the runs of it inside.
    const whole = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as number[][][]) : [f.geometry.coordinates as number[][]];
    for (const run of f.properties.passage === true ? whole : f.properties.passage_runs ?? []) {
      const ends = run.map(([e, n]) => site.toLattice(e!, n!));
      const points: Passage["points"] = [];
      for (let i = 1; i < ends.length; i++) {
        const [ax, az] = ends[i - 1]!, [bx, bz] = ends[i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
        for (let k = i === 1 ? 0 : 1; k <= steps; k++) points.push({ x: ax + ((bx - ax) * k) / steps, y: 0, z: az + ((bz - az) * k) / steps });
      }
      if (points.length > 1) out.push({ points, width: f.properties.width_m ?? 8 });
    }
  }
  return out;
}

/** The passages with each point's height set to the ground there, as it stands when called. */
export function onGround(passages: readonly Passage[], groundAt: (x: number, z: number) => number): Passage[] {
  return passages.map((p) => ({ width: p.width, points: p.points.map((q) => ({ x: q.x, y: groundAt(q.x, q.z), z: q.z })) }));
}
