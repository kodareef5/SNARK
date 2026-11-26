// Laying out a craft's path (planning/workstreams/map-events.md): what any kind may ask of the map, a point on its
// edge, and the pass that raises a path where it dips too near what stands below. Pure, so the server plans with it
// and the events page's preview is the same path.

import { buildTrack, newCraftPose, quantise, trackPose, type CraftTrack, type PathPoint } from "../sim/craft.ts";

/** What planning may ask of the map. */
export interface PlanWorld {
  readonly sizeX: number;
  readonly sizeZ: number;
  /** The highest thing standing within `radius` metres of (x, z): ground, roof or water. */
  top(x: number, z: number, radius: number): number;
}

/** Metres along a path between the places it is checked against what stands below. */
const CHECK_EVERY = 25;
/** Metres round each place checked. */
const CHECK_RADIUS = 30;

/**
 * The point on the map's edge, `inset` metres in, a share `turn` of the way round it: 0 is the corner nearest the
 * origin, and it goes along +x first. No trigonometry: a point on the square's edge.
 */
export function edgePoint(world: Pick<PlanWorld, "sizeX" | "sizeZ">, turn: number, inset: number): { x: number; z: number } {
  const t = ((turn % 1) + 1) % 1;
  const side = Math.floor(t * 4);
  const f = t * 4 - side;
  const lo = inset;
  const hiX = world.sizeX - inset;
  const hiZ = world.sizeZ - inset;
  if (side === 0) return { x: lo + (hiX - lo) * f, z: lo };
  if (side === 1) return { x: hiX, z: lo + (hiZ - lo) * f };
  if (side === 2) return { x: hiX - (hiX - lo) * f, z: hiZ };
  return { x: lo, z: hiZ - (hiZ - lo) * f };
}

/**
 * Raises `points` where the curve between them comes within `clearance` metres of what stands below, then makes the
 * path again, up to `rounds` times. Each point is raised once a round, by the most any dip near it asked. Heights are
 * kept as the wire carries them. Returns the path as it then is.
 */
export function clearPath(points: PathPoint[], world: PlanWorld, clearance: number, rounds = 6): CraftTrack {
  let track = buildTrack(points);
  const pose = newCraftPose();
  const needs = new Float64Array(points.length);
  for (let round = 0; round < rounds; round++) {
    let raised = false;
    needs.fill(0);
    // Checked every CHECK_EVERY metres of the path at its slowest speed, so no stretch is skipped.
    let slowest = Infinity;
    for (const p of points) if (p.speed < slowest) slowest = p.speed;
    const step = CHECK_EVERY / Math.max(1, slowest);
    for (let t = 0; t <= track.seconds; t += step) {
      trackPose(track, t, pose);
      const under = world.top(pose.x, pose.z, CHECK_RADIUS) + clearance;
      if (pose.y >= under) continue;
      // The point nearest it along the ground, and its neighbours either side.
      const need = under - pose.y + 10;
      let nearest = 0;
      let best = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dx = points[i]!.x - pose.x;
        const dz = points[i]!.z - pose.z;
        if (dx * dx + dz * dz < best) {
          best = dx * dx + dz * dz;
          nearest = i;
        }
      }
      for (let i = nearest - 1; i <= nearest + 1; i++) if (i >= 0 && i < points.length && needs[i]! < need) needs[i] = need;
      raised = true;
    }
    if (!raised) break;
    for (let i = 0; i < points.length; i++) if (needs[i]! > 0) points[i]!.y = quantise(points[i]!.y + needs[i]!);
    track = buildTrack(points);
  }
  return track;
}
