// Sloped and three-sided pieces meet the pieces they join. Wherever the first piece was turned, no ray passes between a ramp and
// the floor, wall and ceiling around it, between six triangles in a ring, or between two roof slabs at their ridge; and a body
// walks up the ramp, across the ring and over the ridge without sinking into any of them or dropping through a join.

import { expect, test } from "bun:test";
import { FLOOR_THICK, FOUNDATION_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Body, stanceHeight, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { frameAxes, turn60 } from "../../shared/world/frame.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { ROOF_RISE, ROOF_THICK, TRIANGLE_HALF, hullWorld } from "../fixtures/hulls.ts";
import type { TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;
const HALF = 32768;
const axes = new Int32Array(4);

/** The frame's whole-number vectors for a first piece turned `yaw`: its X, its Z and its X turned 60 degrees, in lattice units. */
function vectors(yaw: number): { ex: number[]; ez: number[]; e60: number[] } {
  frameAxes(yaw, axes);
  const ex = [axes[0]!, axes[1]!];
  const ez = [axes[2]!, axes[3]!];
  turn60(ex[0]!, ex[1]!, axes, 2);
  return { ex, ez, e60: [axes[2]!, axes[3]!] };
}

/** A unit vector from whole-number (x, z). */
function unit(v: number[]): [number, number] {
  const l = Math.hypot(v[0]!, v[1]!);
  return [v[0]! / l, v[1]! / l];
}

/** Turns of the first piece: a spread over the quarter, and the two whose frames are furthest from true. */
function someTurns(): number[] {
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
  return [...yaws, short, long];
}

/** Casts from a to b. True if the ray ends on one of `on`. */
function lineEnds(w: TestWorld, on: readonly number[], a: number[], b: number[]): boolean {
  const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const far = Math.hypot(d[0]!, d[1]!, d[2]!);
  return castWorld(w, a[0]!, a[1]!, a[2]!, d[0]! / far, d[1]! / far, d[2]! / far, far) === HIT_STRUCTURE && on.includes(rayHit.ref);
}

/**
 * A ramp on a foundation, rising from the edge of a second foundation to a ceiling a storey up, with a wall along its side.
 * Positions are whole lattice units from (128, 128), so they are where the game would place them.
 */
function rampSet(w: TestWorld, yaw: number): { f1: number; f2: number; ramp: number; ceiling: number; wall: number; all: number[] } {
  const { ex, ez } = vectors(yaw);
  const o = [128 * U, 128 * U];
  const at = (i: number, j: number): [number, number] => [(o[0]! + i * ex[0]! + j * ez[0]!) / U, (o[1]! + i * ex[1]! + j * ez[1]!) / U];
  const add = (id: string, [x, z]: [number, number], y: number, turn: number): number => w.structs.add(w.kind(id), x, y, z, (yaw + turn) & 0xffff, 7, 1);
  const f1 = add("core:foundation_stone", at(0, 0), FOUNDATION_THICK / 2, 0);
  const f2 = add("core:foundation_stone", at(0, 2), FOUNDATION_THICK / 2, 0);
  const ramp = add("test:ramp", at(0, 2), FOUNDATION_THICK + 1.5, 0);
  const ceiling = add("core:ceiling_stone", at(0, 4), FOUNDATION_THICK + 3 - FLOOR_THICK / 2, 0);
  const wall = add("core:wall_stone", at(1, 2), FOUNDATION_THICK + 1.5, Q);
  return { f1, f2, ramp, ceiling, wall, all: [f1, f2, ramp, ceiling, wall] };
}

test("no ray passes between a ramp and the floor, wall and ceiling it joins, wherever the first piece was turned", () => {
  const w = hullWorld();
  const leaks: string[] = [];
  let cast = 0;
  for (let yaw = 0; yaw < 4 * Q; yaw++) {
    const { ramp, ceiling, wall, f1, f2, all } = rampSet(w, yaw);
    const { ex, ez } = vectors(yaw);
    const [ax, az] = unit(ex);
    const [nx, nz] = unit(ez);
    const t = w.structs.chunks[Math.floor(ramp / 65536)]!;
    const s = ramp & 0xffff;
    const rx = t.x[s]!;
    const ry = t.y[s]!;
    const rz = t.z[s]!;
    // A point on the ramp at `along` its width from its middle and `up` its run from its foot, both from -1.5 to 1.5.
    const on = (along: number, up: number, lift: number): number[] => [rx + ax * along + nx * up, ry + up + lift, rz + az * along + nz * up];
    const off = ((yaw * 7) % 13) * 0.0001;
    const check = (what: string, set: readonly number[], a: number[], b: number[]): void => {
      cast++;
      if (!lineEnds(w, set, a, b) && leaks.length < 8) leaks.push(`${what} at yaw ${yaw}`);
    };
    // Down onto the slope where it meets the wall, either side of the join.
    for (const along of [1.4 + off, 1.5 - off]) check("down the wall's join", [ramp, wall], on(along, 0.3, 2), on(along, 0.3, -2));
    // Grazing down along the slope into its foot, where it meets the floor, and steeply across the foot.
    check("along the slope into its foot", [ramp, f1, f2], on(off, 1, 0.01), on(off, -2.5, -0.02));
    check("across the foot", [ramp, f1, f2], on(-off, -1.6, 1), on(-off, -1.4, -1));
    // Down through the top edge, where it meets the ceiling, and up out from under the ceiling into the ramp's back.
    check("down the top's join", [ramp, ceiling], on(off, 1.5 - off, 2), on(off, 1.5 - off, -2));
    check("slanting through the top's join", [ramp, ceiling], on(0.3, 2.5, 1), on(0.3, 0.5, -1));
    check("under the ceiling into the back", [ramp, ceiling], on(off, 3, -0.3), on(off, 0.5, -0.3));
    for (const ref of all) w.structs.remove(ref);
  }
  expect(leaks).toEqual([]);
  expect(cast).toBe(4 * Q * 7);
});

test("no ray passes between six triangles on 60 degree frames in a ring, nor between two roof slabs at their ridge, at every seventh facing", () => {
  const w = hullWorld();
  const leaks: string[] = [];
  for (let yaw = 0; yaw < 4 * Q; yaw += 7) {
    const { ex, ez, e60 } = vectors(yaw);
    // Corners of the ring, in lattice units from its middle: twice each of U, W, W - U, -U, -W, U - W.
    const u = [2 * ex[0]!, 2 * ex[1]!];
    const v = [2 * e60[0]!, 2 * e60[1]!];
    const p = [100 * U, 100 * U];
    const put = (i: number, j: number, turn: number): number => w.structs.add(w.kind("test:triangle"), (p[0]! + (i * u[0]! + j * v[0]!) / 2) / U, TRIANGLE_HALF, (p[1]! + (i * u[1]! + j * v[1]!) / 2) / U, (yaw + turn) & 0xffff, 7, 1);
    // A triangle's origin is a corner. Pointing one way at P, P - 2U and P - 2W; the other way, turned half round, at P + 2W,
    // P and P + 2U.
    const tris = [put(0, 0, 0), put(-2, 0, 0), put(0, -2, 0), put(0, 2, HALF), put(0, 0, HALF), put(2, 0, HALF)];
    const spokes = [u, v, [v[0]! - u[0]!, v[1]! - u[1]!], [-u[0]!, -u[1]!], [-v[0]!, -v[1]!], [u[0]! - v[0]!, u[1]! - v[1]!]];
    const off = ((yaw * 5) % 11) * 0.0001;
    for (const [k, s] of spokes.entries()) {
      // Down through the join along each spoke, on it and to either side, and slanting across it.
      const [sx, sz] = unit(s);
      for (const along of [0.2, 0.5, 0.9]) {
        for (const side of [0, off, -off]) {
          const x = (p[0]! + s[0]! * along) / U - sz * side;
          const z = (p[1]! + s[1]! * along) / U + sx * side;
          if (!lineEnds(w, tris, [x, 1, z], [x, -0.5, z]) && leaks.length < 8) leaks.push(`down spoke ${k} at yaw ${yaw}`);
        }
        const x = (p[0]! + s[0]! * along) / U;
        const z = (p[1]! + s[1]! * along) / U;
        if (!lineEnds(w, tris, [x - sz * 0.4, 0.8, z + sx * 0.4], [x + sz * 0.4, -0.2, z - sx * 0.4]) && leaks.length < 8) leaks.push(`across spoke ${k} at yaw ${yaw}`);
      }
    }
    if (!lineEnds(w, tris, [p[0]! / U, 1, p[1]! / U], [p[0]! / U, -0.5, p[1]! / U]) && leaks.length < 8) leaks.push(`down the middle at yaw ${yaw}`);
    for (const ref of tris) w.structs.remove(ref);

    // Two slabs rising to a ridge between them, one turned half round, and a third beside the first.
    const q = [150 * U, 150 * U];
    const slab = (i: number, j: number, turn: number): number => w.structs.add(w.kind("test:roof"), (q[0]! + i * ex[0]! + j * ez[0]!) / U, 6, (q[1]! + i * ex[1]! + j * ez[1]!) / U, (yaw + turn) & 0xffff, 7, 1);
    const roofs = [slab(0, 0, 0), slab(0, 2, HALF), slab(2, 0, 0)];
    const [ax, az] = unit(ex);
    const [nx, nz] = unit(ez);
    const rx = q[0]! / U;
    const rz = q[1]! / U;
    for (const along of [-1, 0.2, 1.4]) {
      for (const side of [0, off, -off]) {
        // The ridge is a side's half from the first slab's middle, ROOF_RISE / 2 up.
        const x = rx + ax * along + nx * (1.5 + side);
        const z = rz + az * along + nz * (1.5 + side);
        if (!lineEnds(w, roofs, [x, 9, z], [x, 4, z]) && leaks.length < 8) leaks.push(`down the ridge at yaw ${yaw}`);
        if (!lineEnds(w, roofs, [x - nx * 0.5, 9, z - nz * 0.5], [x + nx * 0.5, 4, z + nz * 0.5]) && leaks.length < 8) leaks.push(`across the ridge at yaw ${yaw}`);
      }
      // Down the seam between the first slab and the one beside it.
      const x = rx + ax * (1.5 + off) + nx * along;
      const z = rz + az * (1.5 + off) + nz * along;
      if (!lineEnds(w, roofs, [x, 9, z], [x, 4, z]) && leaks.length < 8) leaks.push(`down the seam at yaw ${yaw}`);
    }
    for (const ref of roofs) w.structs.remove(ref);
  }
  expect(leaks).toEqual([]);
  // The slab is as thick as asked, upright.
  expect(ROOF_THICK).toBe(0.2);
  expect(ROOF_RISE).toBe(1.5);
});

test("a body walks up a ramp onto the ceiling at its top and back down, at a full stride, never in any piece and never through a join", () => {
  const w = hullWorld();
  const p = w.reg.move[w.kind("core:survivor")]!;
  const wrong: string[] = [];
  for (const yaw of someTurns()) {
    const { ceiling, f1, all } = rampSet(w, yaw);
    const { ex, ez } = vectors(yaw);
    const [ax, az] = unit(ex);
    const [nx, nz] = unit(ez);
    const at = (ref: number): number[] => {
      const t = w.structs.chunks[Math.floor(ref / 65536)]!;
      return [t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!];
    };
    const [fx, fy, fz] = at(f1);
    const top = at(ceiling)[1]! + FLOOR_THICK / 2;
    const b = new Body();
    // On the first foundation, half a metre left of the ramp's middle, a metre back from its foot.
    b.x = fx - ax * 0.5 + nx * 0.5;
    b.z = fz - az * 0.5 + nz * 0.5;
    b.y = fy + FOUNDATION_THICK / 2;
    b.grounded = true;
    const up = Math.round((Math.atan2(nx, nz) / (2 * Math.PI)) * 65536) & 0xffff;
    let reached = -1;
    for (let tick = 0; tick < 36; tick++) {
      stepBody(w, b, 0, 127, up, 0, 0, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) wrong.push(`yaw ${yaw}: in a piece at tick ${tick}`);
      const along = (b.x - fx) * nx + (b.z - fz) * nz;
      if (reached < 0 && along > 5 && Math.abs(b.y - top) < 0.01) reached = tick;
    }
    // From a metre before the foot to a metre over the top is 5 m of the ramp's 3 m run and 1 m either side: at a walk of
    // 4.5 m/s, little more than a second.
    if (reached < 0 || reached > 32) wrong.push(`yaw ${yaw}: on the ceiling at tick ${reached}`);
    if (!(Math.abs(b.y - top) < 0.01) || !b.grounded) wrong.push(`yaw ${yaw}: ended at ${b.y}, the ceiling's top is ${top}`);
    // And back down to the floor.
    for (let tick = 0; tick < 36; tick++) {
      stepBody(w, b, 0, 127, (up + HALF) & 0xffff, 0, 0, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) wrong.push(`yaw ${yaw}: in a piece going down at tick ${tick}`);
    }
    if (!(Math.abs(b.y - (fy + FOUNDATION_THICK / 2)) < 0.01) || !b.grounded) wrong.push(`yaw ${yaw}: back down at ${b.y}`);
    for (const ref of all) w.structs.remove(ref);
    if (wrong.length > 8) break;
  }
  expect(wrong).toEqual([]);
});

test("a body walks across a ring of triangles and over a roof's ridge without sinking into a piece or catching on a join", () => {
  const w = hullWorld();
  const p = w.reg.move[w.kind("core:survivor")]!;
  const wrong: string[] = [];
  for (const yaw of someTurns()) {
    const { ex, ez, e60 } = vectors(yaw);
    const u = [2 * ex[0]!, 2 * ex[1]!];
    const v = [2 * e60[0]!, 2 * e60[1]!];
    const c = [100 * U, 100 * U];
    const put = (i: number, j: number, turn: number): number => w.structs.add(w.kind("test:triangle"), (c[0]! + (i * u[0]! + j * v[0]!) / 2) / U, TRIANGLE_HALF, (c[1]! + (i * u[1]! + j * v[1]!) / 2) / U, (yaw + turn) & 0xffff, 7, 1);
    const tris = [put(0, 0, 0), put(-2, 0, 0), put(0, -2, 0), put(0, 2, HALF), put(0, 0, HALF), put(2, 0, HALF)];
    const top = 2 * TRIANGLE_HALF;
    // Straight across the ring through its middle, along each of three spokes, crossing every join on the way.
    for (const s of [u, v, [v[0]! - u[0]!, v[1]! - u[1]!]]) {
      const [sx, sz] = unit(s);
      const b = new Body();
      b.x = c[0]! / U - sx * 2.4;
      b.z = c[1]! / U - sz * 2.4;
      b.y = top;
      b.grounded = true;
      const heading = Math.round((Math.atan2(sx, sz) / (2 * Math.PI)) * 65536) & 0xffff;
      for (let tick = 0; tick < 30; tick++) {
        stepBody(w, b, 0, 127, heading, 0, 0, p, TICK_DT);
        if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`yaw ${yaw}: in a triangle at tick ${tick}`);
        if (b.y !== Math.fround(top) || !b.grounded) wrong.push(`yaw ${yaw}: at ${b.y} on a ring whose top is ${top}`);
      }
      if (!(((b.x - c[0]! / U) * sx + (b.z - c[1]! / U) * sz) > 1.5)) wrong.push(`yaw ${yaw}: did not cross the ring`);
    }
    for (const ref of tris) w.structs.remove(ref);

    // Up one slab, over the ridge and down the other, which is turned half round.
    const q = [150 * U, 150 * U];
    const slab = (j: number, turn: number): number => w.structs.add(w.kind("test:roof"), (q[0]! + j * ez[0]!) / U, 6, (q[1]! + j * ez[1]!) / U, (yaw + turn) & 0xffff, 7, 1);
    const roofs = [slab(0, 0), slab(2, HALF)];
    const [nx, nz] = unit(ez);
    const b = new Body();
    b.x = q[0]! / U + nx * -1;
    b.z = q[1]! / U + nz * -1;
    b.y = 9;
    const heading = Math.round((Math.atan2(nx, nz) / (2 * Math.PI)) * 65536) & 0xffff;
    let highest = -Infinity;
    for (let tick = 0; tick < 60; tick++) {
      stepBody(w, b, 0, tick < 10 ? 0 : 127, heading, 0, 0, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`yaw ${yaw}: in a slab at tick ${tick}`);
      highest = Math.max(highest, b.y);
    }
    // It went over the top of the ridge, ROOF_RISE / 2 + ROOF_THICK / 2 over the slabs' middles, and is on the far slab.
    const ridge = 6 + ROOF_RISE / 2 + ROOF_THICK / 2;
    if (!(highest >= ridge - 0.01) || !((b.x - q[0]! / U) * nx + (b.z - q[1]! / U) * nz > 2.5)) wrong.push(`yaw ${yaw}: did not cross the ridge, highest ${highest}`);
    for (const ref of roofs) w.structs.remove(ref);
    if (wrong.length > 8) break;
  }
  expect(wrong).toEqual([]);
});
