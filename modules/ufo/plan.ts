// Where a UFO goes (planning/workstreams/map-events.md): a path drawn from its event's draws across the map, from one
// edge to another, high and fast, with passes low and slow over where survivors are, its beam on. Pure, so the server
// plans it and the events page's preview draws the same path from the same seed.

import type { EventMap } from "../../server/api/event.ts";
import { clearPath, edgePoint } from "../../shared/mapevent/plan.ts";
import type { Rng } from "../../shared/rng.ts";
import { CRAFT_MOST_POINTS, quantise, type PathPoint } from "../../shared/sim/craft.ts";

/** Metres in from the map's edge its path begins and ends. */
export const EDGE_INSET = 150;
/** Metres a low pass runs over, [least, most]. */
const LOW_LENGTH: readonly [number, number] = [600, 1000];
/** Metres it keeps over what stands under any pose of it. */
export const CLEARANCE = 60;

/** What of the UFO's tuning its path is drawn from. */
export interface CrossingTuning {
  readonly cruiseSpeed: number;
  readonly cruiseHeight: readonly [number, number];
  readonly scanSpeed: number;
  readonly scanHeight: readonly [number, number];
  readonly points: readonly [number, number];
  readonly scans: readonly [number, number];
  readonly scanNear: number;
}

/** A path across the map. `near` are places its low passes are put over; with none, they are over the middle of the map. */
export function planCrossing(rng: Rng, t: CrossingTuning, map: EventMap, near: readonly { x: number; z: number }[]): PathPoint[] {
  const { sizeX, sizeZ } = map;
  const cx = sizeX / 2;
  const cz = sizeZ / 2;
  const half = Math.min(sizeX, sizeZ) / 2;
  const enterTurn = rng.float();
  // It leaves across the map: from a third to two thirds of the way round from where it came in.
  const exitTurn = enterTurn + 0.33 + rng.float() * 0.34;
  const enter = edgePoint(map, enterTurn, EDGE_INSET);
  const exit = edgePoint(map, exitTurn, EDGE_INSET);

  const total = Math.min(CRAFT_MOST_POINTS, rng.int(t.points[1] - t.points[0] + 1) + t.points[0]);
  const scans = Math.min(Math.floor((total - 2) / 2), rng.int(t.scans[1] - t.scans[0] + 1) + t.scans[0]);
  // Groups of points between the ends, each with its place along the way from entry to exit, by which they are flown.
  const groups: { along: number; points: { x: number; z: number; low: boolean }[] }[] = [];
  const ax = exit.x - enter.x;
  const az = exit.z - enter.z;
  const axis2 = ax * ax + az * az || 1;
  const alongOf = (x: number, z: number): number => ((x - enter.x) * ax + (z - enter.z) * az) / axis2;
  const clampX = (x: number): number => Math.max(EDGE_INSET, Math.min(sizeX - EDGE_INSET, x));
  const clampZ = (z: number): number => Math.max(EDGE_INSET, Math.min(sizeZ - EDGE_INSET, z));
  for (let s = 0; s < scans; s++) {
    // Over a survivor, a little off: or anywhere in the middle of the map where nobody is.
    const who = near.length > 0 ? near[rng.int(near.length)]! : { x: cx + rng.range(-0.6, 0.6) * half, z: cz + rng.range(-0.6, 0.6) * half };
    let dx = 0;
    let dz = 0;
    do {
      dx = rng.range(-1, 1);
      dz = rng.range(-1, 1);
    } while (dx * dx + dz * dz > 1);
    const mx = clampX(who.x + dx * t.scanNear * 0.5);
    const mz = clampZ(who.z + dz * t.scanNear * 0.5);
    // A heading drawn as a point on a circle, and the pass laid along it, flown the way the path goes.
    let hx = 0;
    let hz = 0;
    do {
      hx = rng.range(-1, 1);
      hz = rng.range(-1, 1);
    } while (hx * hx + hz * hz > 1 || hx * hx + hz * hz < 0.04);
    const hl = Math.sqrt(hx * hx + hz * hz);
    hx /= hl;
    hz /= hl;
    if (hx * ax + hz * az < 0) {
      hx = -hx;
      hz = -hz;
    }
    const length = rng.range(LOW_LENGTH[0], LOW_LENGTH[1]);
    const a = { x: clampX(mx - (hx * length) / 2), z: clampZ(mz - (hz * length) / 2), low: true };
    const b = { x: clampX(mx + (hx * length) / 2), z: clampZ(mz + (hz * length) / 2), low: true };
    groups.push({ along: alongOf(mx, mz), points: [a, b] });
  }
  // The rest wander either side of the way across, so the path sweeps and turns rather than runs straight.
  const wander = total - 2 - scans * 2;
  const across = Math.sqrt(axis2);
  for (let i = 0; i < wander; i++) {
    const along = (i + 0.5 + rng.range(-0.35, 0.35)) / wander;
    const side = rng.range(-0.45, 0.45) * Math.max(across, half);
    groups.push({ along, points: [{ x: clampX(enter.x + ax * along - (az / across) * side), z: clampZ(enter.z + az * along + (ax / across) * side), low: false }] });
  }
  groups.sort((g, h) => g.along - h.along);

  const flat: { x: number; z: number; low: boolean }[] = [{ ...enter, low: false }];
  for (const g of groups) flat.push(...g.points);
  flat.push({ ...exit, low: false });
  const points: PathPoint[] = flat.map((p) => {
    const lift = p.low ? rng.range(t.scanHeight[0], t.scanHeight[1]) : rng.range(t.cruiseHeight[0], t.cruiseHeight[1]);
    const top = map.top(p.x, p.z, p.low ? 120 : 400);
    return { x: quantise(p.x), y: quantise(top + lift), z: quantise(p.z), speed: p.low ? t.scanSpeed : t.cruiseSpeed, low: p.low };
  });
  // Where the curve between points dips toward what stands below, the points either side are raised.
  clearPath(points, map, CLEARANCE);
  return points;
}
