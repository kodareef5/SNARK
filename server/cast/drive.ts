// How Cast's people drive: a route over the ground in 4 m cells (roads first, kept to their middle; paving, gravel and
// open ground dearer; water and buildings never), then a driver's keys each tick to follow it (pure pursuit: steer at a
// point ahead along the route, slow for turns, for what is in the way and for the end, stop on the handbrake there).
// The keys go to the vehicle as a player's would (Urban.drive), so the car's own physics carries it. Good enough where
// players watch; out of sight a trip is timed (server/cast/stage.ts). The roads team's lane data replaces the route's
// guess at the road's middle when it ships.

import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";
import type { CastWorld } from "./world.ts";

const CELL = 4;
/** The room a car needs about a route's cell: half a compact's width and a little. */
const CAR_R = 1.4;
/** Cells a route may search: a few hundred metres of city. */
const MOST_CELLS = 40_000;
/** What a cell costs to drive over, by ground class; missing classes are open ground. */
const COST: Record<number, number> = { [GROUND_CLASS.ASPHALT]: 1, [GROUND_CLASS.GRAVEL]: 2.5, [GROUND_CLASS.PAVING]: 4, [GROUND_CLASS.GROUND]: 5, [GROUND_CLASS.SAND]: 8, [GROUND_CLASS.MUD]: 10 };

export interface Route {
  x: number[];
  z: number[];
}

/** A route from (x0, z0) to (x1, z1), waypoints about every 8 m; null if none is found within the search. */
export function route(w: CastWorld, x0: number, z0: number, x1: number, z1: number): Route | null {
  const pad = 96;
  const minX = Math.max(0, Math.min(x0, x1) - pad), minZ = Math.max(0, Math.min(z0, z1) - pad);
  const cols = Math.ceil((Math.min(w.sizeX, Math.max(x0, x1) + pad) - minX) / CELL), rows = Math.ceil((Math.min(w.sizeZ, Math.max(z0, z1) + pad) - minZ) / CELL);
  if (cols * rows > MOST_CELLS * 4) return null;
  const at = (c: number, r: number) => ({ x: minX + (c + 0.5) * CELL, z: minZ + (r + 0.5) * CELL });
  const costs = new Float32Array(cols * rows).fill(-1);
  const cost = (i: number): number => {
    if (costs[i] !== -1) return costs[i]!;
    const p = at(i % cols, Math.floor(i / cols));
    const g = w.ground(p.x, p.z);
    let k = g < 0 || w.water(p.x, p.z) > 0.3 || w.blocked(p.x, p.z, CAR_R) ? Infinity : COST[g] ?? COST[GROUND_CLASS.GROUND]!;
    // A road's edge costs more than its middle, so a route keeps off the kerb.
    if (k === 1 && [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]].some(([dx, dz]) => w.ground(p.x + dx!, p.z + dz!) !== GROUND_CLASS.ASPHALT)) k = 1.6;
    costs[i] = k;
    return k;
  };
  const cell = (x: number, z: number) => Math.min(rows - 1, Math.max(0, Math.floor((z - minZ) / CELL))) * cols + Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / CELL)));
  const start = cell(x0, z0), goal = cell(x1, z1);
  const g = new Float32Array(cols * rows).fill(Infinity), from = new Int32Array(cols * rows).fill(-1);
  const open: number[] = [start];
  const f = new Float32Array(cols * rows).fill(Infinity);
  const gc = goal % cols, gr = Math.floor(goal / cols);
  const h = (i: number) => Math.hypot((i % cols) - gc, Math.floor(i / cols) - gr);
  g[start] = 0;
  f[start] = h(start);
  let expanded = 0;
  while (open.length && expanded < MOST_CELLS) {
    // The open cell of least f; a plain scan is enough for a few hundred metres.
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]!]! < f[open[bi]!]!) bi = k;
    const cur = open[bi]!;
    open[bi] = open[open.length - 1]!;
    open.pop();
    if (cur === goal) break;
    expanded++;
    const c = cur % cols, r = Math.floor(cur / cols);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nc = c + dx, nr = r + dz;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc, k = cost(n);
      if (k === Infinity) continue;
      const step = (dx && dz ? Math.SQRT2 : 1) * k;
      if (g[cur]! + step >= g[n]!) continue;
      if (g[n] === Infinity) open.push(n);
      g[n] = g[cur]! + step;
      f[n] = g[n]! + h(n);
      from[n] = cur;
    }
  }
  if (from[goal] === -1 && goal !== start) return null;
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = from[i]!) cells.push(i);
  cells.reverse();
  const out: Route = { x: [], z: [] };
  for (let k = 0; k < cells.length; k += 2) {
    const p = at(cells[k]! % cols, Math.floor(cells[k]! / cols));
    out.x.push(p.x);
    out.z.push(p.z);
  }
  out.x.push(x1);
  out.z.push(z1);
  return out;
}

/** A car as the driver sees it: where it is, its heading (radians, along (sin, cos)), its speed in metres a second. */
export interface CarState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

/** A driver's keys for one tick: steer and throttle, -127 to 127, the handbrake, where on the route it is, and whether
 * it has arrived (stopped at the end). */
export interface Keys {
  moveX: number;
  moveZ: number;
  handbrake: boolean;
  next: number;
  done: boolean;
}

/** Metres a second a driver keeps to in town, and slows to in a turn. */
export const CRUISE = 9, TURNING = 3.5;
/** The vehicle's steer is the negative of moveX (shared/sim/vehicle-body.ts): turning toward a point to the right wants
 * this sign. */
const STEER_SIGN = -1;

export function keys(car: CarState, r: Route, next: number, blocked: boolean, cruise = CRUISE): Keys {
  const last = r.x.length - 1;
  const look = Math.max(5, Math.min(14, car.speed + 5));
  while (next < last && Math.hypot(r.x[next]! - car.x, r.z[next]! - car.z) < look) next++;
  const tx = r.x[next]!, tz = r.z[next]!;
  const toEnd = Math.hypot(r.x[last]! - car.x, r.z[last]! - car.z);
  if (next >= last && toEnd < 3 && car.speed < 0.8) return { moveX: 0, moveZ: 0, handbrake: true, next, done: true };
  const err = wrap(Math.atan2(tx - car.x, tz - car.z) - car.yaw);
  const steer = Math.max(-1, Math.min(1, err * 1.8));
  let want = cruise * (1 - Math.min(0.75, Math.abs(err) * 0.9));
  want = Math.max(want, Math.min(TURNING, cruise));
  if (next >= last) want = Math.min(want, Math.max(0, toEnd - 1) * 0.6);
  if (blocked) want = 0;
  // Behind it, it backs round rather than circling.
  const reverse = Math.abs(err) > 2.2 && toEnd < 25;
  const throttle = reverse ? -0.5 : Math.max(-1, Math.min(1, (want - car.speed) * 0.35));
  return { moveX: Math.round(STEER_SIGN * (reverse ? -steer : steer) * 127), moveZ: Math.round(throttle * 127), handbrake: want === 0 && car.speed < 0.5, next, done: false };
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
