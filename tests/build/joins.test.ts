// Joined pieces meet. Wherever the first piece of a house was turned, no ray passes between two of its pieces, and a body
// sliding along its wall or walking over its floor does not catch where they join.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK, WALL_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import { frameAxes, poseAt, type Pose } from "../../shared/world/snap.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;
const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const axes = new Int32Array(4);

/** Builds a piece in socket `k` of `target`, as the server does. Returns its ref. */
function join(w: TestWorld, target: number, piece: string, k: number): number {
  const kind = w.kind(`core:${piece}`);
  if (!poseAt(w.structs, w.reg, target, kind, k, 0, pose)) throw new Error(`no socket ${k} for ${piece}`);
  return w.structs.add(kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, 7, 1);
}

function at(w: TestWorld, ref: number): [number, number, number] {
  const t = w.structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  return [t.x[s]!, t.y[s]!, t.z[s]!];
}

/** Every facing a first piece can be given. */
function eachYaw(visit: (yaw: number) => void): void {
  for (let yaw = 0; yaw < 4 * Q; yaw++) visit(yaw);
}

test("no ray passes between two joined pieces, wherever the first was turned: not a look, and not a line from one point to another", () => {
  const w = flatWorld(4);
  const d = [0, 0, 0];
  let cast = 0;
  const leaks: string[] = [];
  /** A ray from (ox, oy, oz) toward (tx, ty, tz), as a blast and a creature's sight cast it. It must end on one of `on`. */
  const line = (yaw: number, what: string, on: readonly number[], ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): void => {
    const far = Math.hypot(tx - ox, ty - oy, tz - oz);
    cast++;
    if (castWorld(w, ox, oy, oz, (tx - ox) / far, (ty - oy) / far, (tz - oz) / far, far) === HIT_STRUCTURE && on.includes(rayHit.ref)) return;
    if (leaks.length < 8) leaks.push(`${what} at yaw ${yaw}`);
  };
  /** A ray along a look from an eye, as a shot, the use key and a gathering hand cast it. */
  const look = (yaw: number, what: string, on: readonly number[], ox: number, oy: number, oz: number, lookYaw: number, pitch: number): void => {
    lookDirection(lookYaw & 0xffff, pitch, d);
    cast++;
    if (castWorld(w, ox, oy, oz, d[0]!, d[1]!, d[2]!, 6) === HIT_STRUCTURE && on.includes(rayHit.ref)) return;
    if (leaks.length < 8) leaks.push(`${what} at yaw ${yaw}`);
  };
  eachYaw((yaw) => {
    // Two foundations side by side, a wall two pieces high along the same edge of each, and a ceiling off each wall.
    const f1 = w.structs.add(w.kind("core:foundation_stone"), 128, FOUNDATION_THICK / 2, 128, yaw, 7, 1);
    const f2 = join(w, f1, "foundation_stone", 1);
    const w1 = join(w, f1, "wall_stone", 0);
    const w2 = join(w, f2, "wall_stone", 0);
    const u1 = join(w, w1, "wall_stone", 0);
    const u2 = join(w, w2, "wall_stone", 0);
    const c1 = join(w, u1, "ceiling_stone", 1);
    const c2 = join(w, u2, "ceiling_stone", 1);
    const walls = [w1, w2, u1, u2];
    // Unit vectors along the wall and out through it.
    frameAxes(yaw, axes);
    const length = Math.hypot(axes[0]!, axes[1]!);
    const ax = axes[0]! / length;
    const az = axes[1]! / length;
    const nx = axes[2]! / length;
    const nz = axes[3]! / length;
    const [ax1, low, az1] = at(w, w1);
    const [ax2, , az2] = at(w, w2);
    const high = at(w, u1)[1];
    // Where the two walls meet.
    const mx = (ax1 + ax2) / 2;
    const mz = (az1 + az2) / 2;
    // Straight through the join from outside and from inside, on it and to either side of it. The first is at the height where
    // the upper walls stand on the lower, so it meets the one point all four share.
    for (const off of [0, 0.0006, -0.0006, 0.0013, -0.0013]) {
      const px = mx + ax * off;
      const pz = mz + az * off;
      const y = off === 0 ? (low + high) / 2 : off > 0 ? low : high;
      line(yaw, "a line through the wall", walls, px + nx * 2, y, pz + nz * 2, px - nx * 2, y, pz - nz * 2);
      line(yaw, "a line out through the wall", walls, px - nx * 2, y, pz - nz * 2, px + nx * 2, y, pz + nz * 2);
    }
    // Across the join at a slant, and steeply down through it.
    line(yaw, "a slanted line through the wall", walls, mx + nx * 2 + ax * 0.9, low, mz + nz * 2 + az * 0.9, mx - nx * 2 - ax * 0.9, low + 0.3, mz - nz * 2 - az * 0.9);
    line(yaw, "a steep line through the wall", walls, mx + nx * 0.4, high + 1.4, mz + nz * 0.4, mx - nx * 0.4, low - 1.4, mz - nz * 0.4);
    // A look from an eye three metres out, straight at the join and one step of the look to either side of it.
    const aim = Math.round((Math.atan2(-nx, -nz) / (2 * Math.PI)) * 65536);
    for (let step = -1; step <= 1; step++) look(yaw, "a look through the wall", walls, mx + nx * 3, low + 0.1, mz + nz * 3, aim + step, step * 400);
    // Down through the floor where the foundations meet, and up through the roof where the ceilings do.
    const [fx1, , fz1] = at(w, f1);
    const [fx2, , fz2] = at(w, f2);
    const [cx1, top, cz1] = at(w, c1);
    const [cx2, , cz2] = at(w, c2);
    for (const off of [0, 0.0008, -0.0008]) {
      const along = off * 600;
      const fx = (fx1 + fx2) / 2 + ax * off + nx * along;
      const fz = (fz1 + fz2) / 2 + az * off + nz * along;
      line(yaw, "a line down through the floor", [f1, f2], fx, 2, fz, fx, -1, fz);
      const cx = (cx1 + cx2) / 2 + ax * off + nx * along;
      const cz = (cz1 + cz2) / 2 + az * off + nz * along;
      line(yaw, "a line up through the roof", [c1, c2], cx - nx * 0.2, top - 2, cz - nz * 0.2, cx + nx * 0.2, top + 2, cz + nz * 0.2);
    }
    look(yaw, "a look down through the floor", [f1, f2], (fx1 + fx2) / 2, 1.6, (fz1 + fz2) / 2, yaw, -Q);
    for (const ref of [c2, c1, u2, u1, w2, w1, f2, f1]) w.structs.remove(ref);
  });
  expect(leaks).toEqual([]);
  expect(cast).toBe(4 * Q * 22);
});

test("a door meets its frame: a look straight at either edge of a shut door ends on the door or the frame", () => {
  const w = flatWorld(4);
  const misses: number[] = [];
  const d = [0, 0, 0];
  // A look at yaw 0 runs exactly along +Z, so the eye's x is the ray's x all the way.
  lookDirection(0, 0, d);
  expect([d[0], d[1]]).toEqual([0, 0]);
  for (let quarter = 0; quarter < 4; quarter++) {
    const f = w.structs.add(w.kind("core:foundation_stone"), 100, FOUNDATION_THICK / 2, 100, quarter * Q, 7, 1);
    // The edge of the foundation that faces -Z, whichever way the foundation is turned.
    const frame = join(w, f, "doorframe_stone", (2 - quarter) & 3);
    const door = join(w, frame, "door_stone", 0);
    const [x, y, z] = at(w, door);
    // The door is 1.4 m wide. Its edges are numbers a float cannot hold exactly, so the eye is tried at every float near them.
    for (const edge of [-0.7, 0.7]) {
      for (let step = -64; step <= 64; step++) {
        if (castWorld(w, x + edge + step * 2 ** -30, y, z - 2, d[0]!, d[1]!, d[2]!, 6) !== HIT_STRUCTURE || (rayHit.ref !== door && rayHit.ref !== frame)) misses.push(quarter);
      }
    }
    for (const ref of [door, frame, f]) w.structs.remove(ref);
  }
  expect(misses).toEqual([]);
});

/** A row of `n` foundations along the first one's X, each with a wall on the same edge. Returns the first wall and the first foundation. */
function row(w: TestWorld, yaw: number, n: number): { wall: number; floor: number; all: number[] } {
  const first = w.structs.add(w.kind("core:foundation_stone"), 128, FOUNDATION_THICK / 2, 128, yaw, 7, 1);
  const all = [first];
  let f = first;
  let wall = -1;
  for (let k = 0; k < n; k++) {
    if (k > 0) all.push((f = join(w, f, "foundation_stone", 1)));
    const made = join(w, f, "wall_stone", 0);
    all.push(made);
    if (wall < 0) wall = made;
  }
  return { wall, floor: first, all };
}

test("a body pressed along a wall of joined pieces keeps one distance from it over every join and never loses a sixth of a tick's way at one, and it walks a floor of them level", () => {
  const w = flatWorld(4);
  const p = w.reg.move[w.kind("core:survivor")]!;
  // Turns spread over the quarter, and the two whose frames are furthest from true.
  const yaws: number[] = [];
  for (let within = 0; within < Q; within += 257) yaws.push((within & 3) * Q + within);
  let short = 0;
  let long = 0;
  for (let within = 0; within < Q; within++) {
    frameAxes(within, axes);
    const length = Math.hypot(axes[0]!, axes[1]!);
    frameAxes(short, axes);
    if (length < Math.hypot(axes[0]!, axes[1]!)) short = within;
    frameAxes(long, axes);
    if (length > Math.hypot(axes[0]!, axes[1]!)) long = within;
  }
  yaws.push(short, long);
  // It heads two parts along the wall to one part into it.
  const slide = (p.walkSpeed * TICK_DT * 2) / Math.sqrt(5);
  for (const yaw of yaws) {
    const { wall, floor, all } = row(w, yaw, 5);
    frameAxes(yaw, axes);
    const length = Math.hypot(axes[0]!, axes[1]!);
    const ax = axes[0]! / length;
    const az = axes[1]! / length;
    const nx = axes[2]! / length;
    const nz = axes[3]! / length;
    const [wx, , wz] = at(w, wall);
    const [fx, fy, fz] = at(w, floor);
    const top = fy + FOUNDATION_THICK / 2;

    // On the floor, half a metre inside the wall, walking along it and into it.
    const b = new Body();
    b.x = wx - ax * 1 - nx * (WALL_THICK / 2 + p.radius + 0.1);
    b.z = wz - az * 1 - nz * (WALL_THICK / 2 + p.radius + 0.1);
    b.y = top;
    b.grounded = true;
    const heading = Math.round((Math.atan2(ax * 2 + nx, az * 2 + nz) / (2 * Math.PI)) * 65536) & 0xffff;
    let nearest = Infinity;
    let furthest = -Infinity;
    let slowest = Infinity;
    for (let tick = 0; tick < 90; tick++) {
      const before = (b.x - wx) * ax + (b.z - wz) * az;
      stepBody(w, b, 0, 127, heading, 0, 0, p, TICK_DT);
      if (tick < 12) continue;
      const off = (wx - b.x) * nx + (wz - b.z) * nz;
      nearest = Math.min(nearest, off);
      furthest = Math.max(furthest, off);
      slowest = Math.min(slowest, (b.x - wx) * ax + (b.z - wz) * az - before);
      expect(b.y).toBe(Math.fround(top));
      expect(b.grounded).toBe(true);
    }
    const reached = (b.x - wx) * ax + (b.z - wz) * az;
    // It crossed four joins. The wall's face is one plane, to the precision a position is kept at. Pushes are made one piece at
    // a time, so the corner of the next piece may take a little of one tick's way, as it does along a wall built square.
    expect(reached).toBeGreaterThan(10.5);
    expect([yaw, furthest - nearest < 0.00005]).toEqual([yaw, true]);
    expect([yaw, slowest > (slide * 5) / 6]).toEqual([yaw, true]);

    // Straight along the middle of the floor, over every join between foundations.
    b.x = fx - ax * 1;
    b.z = fz - az * 1;
    b.y = top;
    b.vx = b.vy = b.vz = 0;
    const ahead = Math.round((Math.atan2(ax, az) / (2 * Math.PI)) * 65536) & 0xffff;
    slowest = Infinity;
    for (let tick = 0; tick < 80; tick++) {
      const before = (b.x - fx) * ax + (b.z - fz) * az;
      stepBody(w, b, 0, 127, ahead, 0, 0, p, TICK_DT);
      if (tick >= 12) slowest = Math.min(slowest, (b.x - fx) * ax + (b.z - fz) * az - before);
      expect(b.y).toBe(Math.fround(top));
      expect(b.grounded).toBe(true);
    }
    expect([yaw, slowest > p.walkSpeed * TICK_DT * 0.999]).toEqual([yaw, true]);
    for (const ref of all.reverse()) w.structs.remove(ref);
  }
});
