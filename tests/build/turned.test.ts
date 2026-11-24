// Pieces 30 and 60 degrees from their base. A triangle with a square on each side, a ring of six triangles and a dodecagon
// are set down by key at every turn of the base within a quarter. Their colliders share corners as whole lattice units, no ray
// passes between them, and a body walks their floors and slides along their walls as it does a base built square.

import { expect, test } from "bun:test";
import { WALL_HEIGHT, WALL_THICK } from "../../content/building.ts";
import { STRUCT_UNITS, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { Solid, partSolid } from "../../shared/world/convex.ts";
import { HALF_SIDE, STRETCH_MOST, classAxis, classAxis60, frame, frameAxes, frameOf } from "../../shared/world/frame.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { Found } from "../../shared/world/structures.ts";
import { Base, STOREY, cornersOf, dodecagon, mixedHouse, ring, row, turnedWorld, type Built, type Cell } from "../fixtures/turned.ts";
import type { TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;
const axes = new Int32Array(4);
const found = new Found();
const solid = new Solid();

/** frameOf as it was before rows had a turn class. */
function oldFrameOf(yaw: number): { cos: number; sin: number; stretch: number } {
  frameAxes(yaw, axes);
  const c = axes[0]!;
  const s = axes[2]!;
  const length = Math.sqrt(c * c + s * s);
  return { cos: c / length, sin: s / length, stretch: length / HALF_SIDE };
}

test("a frame of turn class 0 is the frame a yaw alone gave, at every yaw", () => {
  const differ: number[] = [];
  for (let yaw = 0; yaw < 4 * Q; yaw++) {
    const was = oldFrameOf(yaw);
    // Another class asked between must not be what is kept.
    frameOf(yaw, 1 + (yaw & 1));
    frameOf(yaw, 0);
    if (!Object.is(frame.cos, was.cos) || !Object.is(frame.sin, was.sin) || !Object.is(frame.stretch, was.stretch)) differ.push(yaw);
  }
  expect(differ).toEqual([]);
});

test("a frame of class 1 or 2 lies along its class's lattice vector, and no class stretches a box past STRETCH_MOST", () => {
  const wrong: number[] = [];
  let most = 0;
  for (let yaw = 0; yaw < 4 * Q; yaw++) {
    for (let tw = 1; tw < 3; tw++) {
      classAxis(yaw, tw, axes, 0);
      const length = Math.hypot(axes[0]!, axes[1]!);
      frameOf(yaw, tw);
      most = Math.max(most, frame.stretch);
      if (Math.abs(frame.cos * length - axes[0]!) > 1e-9 || Math.abs(frame.sin * length + axes[1]!) > 1e-9 || Math.abs(frame.stretch * HALF_SIDE - length) > 1e-9) wrong.push(yaw);
    }
  }
  expect(wrong).toEqual([]);
  expect(most).toBeLessThan(STRETCH_MOST);
  expect(most).toBeGreaterThan(1);
});

/** A base's turns: every one within a quarter, each in one of the four quarters. */
function eachYaw(visit: (yaw: number) => void, stride = 1): number {
  let n = 0;
  for (let within = 0; within < Q; within += stride, n++) visit((within & 3) * Q + within);
  return n;
}

/** Turns spread over the quarter, and the two whose frames are furthest from true. */
function someYaws(): number[] {
  const yaws: number[] = [];
  for (let within = 0; within < Q; within += 257) yaws.push((within & 3) * Q + within);
  let short = 0;
  let long = 0;
  const length = (yaw: number): number => (frameAxes(yaw, axes), Math.hypot(axes[0]!, axes[1]!));
  for (let within = 0; within < Q; within++) {
    if (length(within) < length(short)) short = within;
    if (length(within) > length(long)) long = within;
  }
  return [...yaws, short, long];
}

function rowOf(w: TestWorld, ref: number): { kind: number; x: number; y: number; z: number; yaw: number; tw: number } {
  const t = w.structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  return { kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s) };
}

/** Where a piece's collider has its corners, as the game places them: each (x, z) in lattice units, not rounded. A wall gives the two ends of its middle line. */
function colliderCorners(w: TestWorld, ref: number, ends = false): [number, number][] {
  const r = rowOf(w, ref);
  const parts = w.reg.parts;
  const out: [number, number][] = [];
  frameOf(r.yaw, r.tw);
  const { cos, sin, stretch } = frame;
  for (let p = parts.start[r.kind]! * 6, end = parts.start[r.kind + 1]! * 6; p < end; p += 6) {
    for (let k = 0; k < (ends ? 2 : 4); k++) {
      const lx = parts.box[p]! + (k & 1 ? 1 : -1) * parts.box[p + 3]!;
      const lz = ends ? parts.box[p + 2]! : parts.box[p + 2]! + (k & 2 ? 1 : -1) * parts.box[p + 5]!;
      out.push([(r.x + (cos * lx + sin * lz) * stretch) * U, (r.z + (-sin * lx + cos * lz) * stretch) * U]);
    }
  }
  const hulls = parts.hulls!;
  for (let p = hulls.start[r.kind]!; p < hulls.start[r.kind + 1]!; p++) {
    partSolid(hulls, p, r.yaw, r.tw, r.x, r.y, r.z, solid);
    for (let c = 0; c < solid.corners; c++) out.push([solid.at[c * 3]! * U, solid.at[c * 3 + 2]! * U]);
  }
  return out;
}

/** The first fault in how a piece's collider corners sit on its cell's lattice corners, or "". */
function cornerFault(w: TestWorld, b: Base, ref: number, cell: Cell, ends = false): string {
  const got = colliderCorners(w, ref, ends);
  if (got.some(([x, z]) => Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(z - Math.round(z)) > 1e-6)) return "a corner is off the lattice";
  const whole = (points: number[][]): string => [...new Set(points.map(([x, z]) => `${Math.round(x!)},${Math.round(z!)}`))].sort().join(" ");
  const want = cornersOf(cell).map((a) => b.units(a));
  return whole(got) === whole(want) ? "" : `corners ${whole(got)}, the lattice's ${whole(want)}`;
}

/** The sides two floor pieces share, each as its two ends in metres, and the corners every side at which is shared. */
function seams(b: Base, built: Built): { sides: [number, number][][]; inner: [number, number][] } {
  const count = new Map<string, number>();
  const ends = new Map<string, number[][]>();
  for (const [, cell] of built.floors) {
    const c = cornersOf(cell);
    for (let i = 0; i < c.length; i++) {
      const pair = [c[i]!, c[(i + 1) % c.length]!];
      const name = pair.map((a) => a.join()).sort().join(" ");
      count.set(name, (count.get(name) ?? 0) + 1);
      ends.set(name, pair);
    }
  }
  const open = new Set<string>();
  const all = new Map<string, number[]>();
  for (const [name, pair] of ends) for (const a of pair) (all.set(a.join(), a), count.get(name) === 1 && open.add(a.join()));
  const sides = [...ends].filter(([name]) => count.get(name) === 2).map(([, pair]) => pair.map((a) => b.at(a)));
  return { sides, inner: [...all].filter(([name]) => !open.has(name)).map(([, a]) => b.at(a)) };
}

/** Casts from a to b. True if the ray ends on one of `on`. */
function lineEnds(w: TestWorld, on: readonly number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const far = Math.hypot(bx - ax, by - ay, bz - az);
  return castWorld(w, ax, ay, az, (bx - ax) / far, (by - ay) / far, (bz - az) / far, far) === HIT_STRUCTURE && on.includes(rayHit.ref);
}

/**
 * How many of the lines straight down through a level of slabs, at and beside every seam and round every inner corner, pass
 * between them. A seam is tried at its middle and `end` of its length from each end. Adds the lines cast to `cast.n`.
 */
function slabLeaks(w: TestWorld, b: Base, built: Built, on: readonly number[], y: number, cast: { n: number }, end = 0.003): number {
  const { sides, inner } = seams(b, built);
  let leaks = 0;
  const down = (x: number, z: number): void => {
    cast.n++;
    if (!lineEnds(w, on, x, y + 2, z, x, y - 2, z)) leaks++;
  };
  for (const [[ax, az], [bx, bz]] of sides as [[number, number], [number, number]][]) {
    const length = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / length;
    const nz = (bx - ax) / length;
    for (const t of [end, 0.37, 0.5, 1 - end]) for (const off of [0, 0.0008, -0.0008]) down(ax + (bx - ax) * t + nx * off, az + (bz - az) * t + nz * off);
  }
  for (const [x, z] of inner) {
    down(x, z);
    for (let k = 0; k < 12; k++) down(x + 0.0005 * Math.cos((k * Math.PI) / 6 + 0.1), z + 0.0005 * Math.sin((k * Math.PI) / 6 + 0.1));
  }
  return leaks;
}

/** Whether every piece is listed in the grid cell under each corner of its collider, pulled a millimetre toward its middle. */
function gridHolds(w: TestWorld, refs: readonly number[]): boolean {
  for (const ref of refs) {
    const r = rowOf(w, ref);
    for (const [ux, uz] of colliderCorners(w, ref)) {
      const x = ux / U + Math.sign(r.x - ux / U) * 0.001;
      const z = uz / U + Math.sign(r.z - uz / U) * 0.001;
      const n = w.structs.query(x, z, x, z, found);
      if (!found.refs.subarray(0, n).includes(ref)) return false;
    }
  }
  return true;
}

/** Takes a base's pieces up again. False if the grid still lists something there. */
function clear(w: TestWorld, built: Built): boolean {
  for (const ref of [...built.refs].reverse()) w.structs.remove(ref);
  return w.structs.query(64, 64, 192, 192, found) === 0 && w.structs.frames.count === 0;
}

/** The unit vector from one point to another, and the one to its left: toward +Z when it runs along +X. */
function along(a: readonly number[], b: readonly number[]): { ux: number; uz: number; lx: number; lz: number } {
  const length = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  const ux = (b[0]! - a[0]!) / length;
  const uz = (b[1]! - a[1]!) / length;
  return { ux, uz, lx: -uz, lz: ux };
}

test("neighbours in a mixed house share corners as whole lattice units, and no ray passes between them, at every turn of the base", () => {
  const w = turnedWorld(4);
  const faults: string[] = [];
  const cast = { n: 0 };
  let leaks = 0;
  const classes = new Set<number>();
  const fail = (yaw: number, what: string): void => void (faults.length < 8 && faults.push(`${what} at yaw ${yaw}`));
  const yaws = eachYaw((yaw) => {
    const b = new Base(w, 128, 128, yaw);
    const house = mixedHouse(b);
    for (const [ref, cell] of [...house.floors, ...house.ceilings]) {
      classes.add(rowOf(w, ref).tw);
      const fault = cornerFault(w, b, ref, cell);
      if (fault) fail(yaw, fault);
    }
    for (const [ref, cell] of house.walls) {
      const fault = cornerFault(w, b, ref, cell, true);
      if (fault) fail(yaw, fault);
    }
    if (!gridHolds(w, house.refs)) fail(yaw, "a piece is missing from a grid cell it reaches");
    // Down through the floor and up through the roof where the triangle meets each square.
    const before = leaks;
    // A wall stands over each end of a floor's seam, so the floor is tried clear of it.
    leaks += slabLeaks(w, b, house, house.floors.map(([ref]) => ref), b.top, cast, 0.06);
    leaks += slabLeaks(w, b, house, house.ceilings.map(([ref]) => ref), b.top + WALL_HEIGHT, cast);
    // Through each corner of the outline, where two walls meet at a right angle or at 120 degrees.
    const low = b.top + 0.75;
    const high = b.top + 2.25;
    const n = house.outline.length;
    const line = (on: readonly number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      cast.n++;
      if (!lineEnds(w, on, ax, ay, az, bx, by, bz)) leaks++;
    };
    for (let i = 0; i < n; i++) {
      const v = b.at(house.outline[i]!);
      const into = along(b.at(house.outline[(i + n - 1) % n]!), v);
      const out = along(v, b.at(house.outline[(i + 1) % n]!));
      // Out of the house between the two walls, and across that way.
      const length = Math.hypot(into.lx + out.lx, into.lz + out.lz);
      const nx = -(into.lx + out.lx) / length;
      const nz = -(into.lz + out.lz) / length;
      const [tx, tz] = [-nz, nx];
      const walls = [house.walls[(i + n - 1) % n]![0], house.walls[i]![0]];
      for (const off of [0, 0.0006, -0.0006, 0.0013, -0.0013]) {
        const px = v[0] + tx * off;
        const pz = v[1] + tz * off;
        const y = off === 0 ? (low + high) / 2 : off > 0 ? low : high;
        line(walls, px + nx * 2, y, pz + nz * 2, px - nx * 2, y, pz - nz * 2);
        line(walls, px - nx * 2, y, pz - nz * 2, px + nx * 2, y, pz + nz * 2);
      }
      line(walls, v[0] + nx * 2 + tx * 0.9, low, v[1] + nz * 2 + tz * 0.9, v[0] - nx * 2 - tx * 0.9, low + 0.3, v[1] - nz * 2 - tz * 0.9);
      line(walls, v[0] + nx * 0.4, high + 0.5, v[1] + nz * 0.4, v[0] - nx * 0.4, low - 0.5, v[1] - nz * 0.4);
    }
    if (leaks > before) fail(yaw, "a ray passes between joined pieces");
    if (!clear(w, house)) fail(yaw, "the grid lists a piece taken up");
  });
  expect(faults).toEqual([]);
  expect(leaks).toBe(0);
  expect([...classes].sort()).toEqual([0, 1, 2]);
  // Three seams of twelve lines on each of two levels, and twelve lines at each of nine corners.
  expect([yaws, cast.n]).toEqual([Q, Q * (2 * 3 * 12 + 9 * 12)]);
});

test("six triangles round a corner and a dodecagon close with no leak, at every turn of the base and turned 30 degrees in it", () => {
  const w = turnedWorld(4);
  const faults: string[] = [];
  const cast = { n: 0 };
  let leaks = 0;
  const classes = new Set<number>();
  const fail = (yaw: number, what: string): void => void (faults.length < 8 && faults.push(`${what} at yaw ${yaw}`));
  const yaws = eachYaw((yaw) => {
    for (const [name, make] of [["ring", ring], ["dodecagon", dodecagon]] as const) {
      for (let d = 0; d < 2; d++) {
        const b = new Base(w, 128, 128, yaw);
        const built = make(b, d);
        for (const [ref, cell] of built.floors) {
          classes.add(rowOf(w, ref).tw);
          const fault = cornerFault(w, b, ref, cell);
          if (fault) fail(yaw, `${name} ${d}: ${fault}`);
        }
        if (!gridHolds(w, built.refs)) fail(yaw, `${name} ${d}: a piece is missing from a grid cell it reaches`);
        const now = slabLeaks(w, b, built, built.refs, b.top, cast);
        if (now > 0) fail(yaw, `${name} ${d}: a ray passes between joined pieces`);
        leaks += now;
        if (!clear(w, built)) fail(yaw, `${name} ${d}: the grid lists a piece taken up`);
      }
    }
  });
  expect(faults).toEqual([]);
  expect(leaks).toBe(0);
  expect([...classes].sort()).toEqual([0, 1, 2]);
  // A ring has six seams and one inner corner, a dodecagon 24 and seven. Each is built twice.
  expect([yaws, cast.n]).toEqual([Q, Q * 2 * (6 * 12 + 13 + 24 * 12 + 7 * 13)]);
});

test("a convex part of class 1 or 2 is placed by its class's two lattice vectors", () => {
  const w = turnedWorld(4);
  const kind = w.kind("test:triangle_foundation");
  const hulls = w.reg.parts.hulls!;
  const p = hulls.start[kind]!;
  const b = new Int32Array(4);
  const wrong: string[] = [];
  for (let yaw = 0; yaw < 4 * Q; yaw += 7) {
    for (let tw = 0; tw < 3; tw++) {
      classAxis(yaw, tw, b, 0);
      classAxis60(yaw, tw, b, 2);
      partSolid(hulls, p, yaw, tw, 0, 0, 0, solid);
      for (let c = 0; c < solid.corners; c++) {
        const [u, v] = [hulls.at[(hulls.corner[p]! + c) * 3]!, hulls.at[(hulls.corner[p]! + c) * 3 + 2]!];
        if (Math.abs(solid.at[c * 3]! - (u * b[0]! + v * b[2]!) / HALF_SIDE) > 1e-12 || Math.abs(solid.at[c * 3 + 2]! - (u * b[1]! + v * b[3]!) / HALF_SIDE) > 1e-12) wrong.push(`yaw ${yaw} class ${tw}`);
      }
    }
  }
  expect(wrong.slice(0, 8)).toEqual([]);
});

test("a body pressed along a wall of squares 30 and 60 degrees from the base keeps one distance from it, and walks their floor level", () => {
  const w = turnedWorld(4);
  const p = w.reg.move[w.kind("core:survivor")]!;
  const slide = (p.walkSpeed * TICK_DT * 2) / Math.sqrt(5);
  for (const yaw of someYaws()) {
    for (const d of [1, 2, 4, 5]) {
      const b = new Base(w, 128, 128, yaw);
      const built = row(b, d, 5);
      expect(rowOf(w, built.walls[2]![0]).tw).toBe(d % 3);
      const a = along(b.at(built.outline[0]!), b.at(built.outline[5]!));
      // The wall is on the right of the way along the row, and the floor on its left.
      const [ax, az, nx, nz] = [a.ux, a.uz, -a.lx, -a.lz];
      const first = rowOf(w, built.walls[0]![0]);
      const floor = rowOf(w, built.floors[0]![0]);
      const body = new Body();
      body.x = first.x - ax * 1 - nx * (WALL_THICK / 2 + p.radius + 0.1);
      body.z = first.z - az * 1 - nz * (WALL_THICK / 2 + p.radius + 0.1);
      body.y = b.top;
      body.grounded = true;
      // It heads two parts along the wall to one part into it.
      const heading = Math.round((Math.atan2(ax * 2 + nx, az * 2 + nz) / (2 * Math.PI)) * 65536) & 0xffff;
      let nearest = Infinity;
      let furthest = -Infinity;
      let slowest = Infinity;
      for (let tick = 0; tick < 90; tick++) {
        const before = (body.x - first.x) * ax + (body.z - first.z) * az;
        stepBody(w, body, 0, 127, heading, 0, 0, p, TICK_DT);
        if (tick < 12) continue;
        const off = (first.x - body.x) * nx + (first.z - body.z) * nz;
        nearest = Math.min(nearest, off);
        furthest = Math.max(furthest, off);
        slowest = Math.min(slowest, (body.x - first.x) * ax + (body.z - first.z) * az - before);
        expect([yaw, d, body.y, body.grounded]).toEqual([yaw, d, Math.fround(b.top), true]);
      }
      // Four joins crossed, on one plane, with no more lost at a join than along a wall built square.
      expect((body.x - first.x) * ax + (body.z - first.z) * az).toBeGreaterThan(10.5);
      expect([yaw, d, furthest - nearest < 0.00005, (slide * 5) / 6 < slowest]).toEqual([yaw, d, true, true]);

      // Straight along the middle of the floor, over every join between foundations.
      body.x = floor.x - ax * 1;
      body.z = floor.z - az * 1;
      body.y = b.top;
      body.vx = body.vy = body.vz = 0;
      const ahead = Math.round((Math.atan2(ax, az) / (2 * Math.PI)) * 65536) & 0xffff;
      slowest = Infinity;
      for (let tick = 0; tick < 80; tick++) {
        const before = (body.x - floor.x) * ax + (body.z - floor.z) * az;
        stepBody(w, body, 0, 127, ahead, 0, 0, p, TICK_DT);
        if (tick >= 12) slowest = Math.min(slowest, (body.x - floor.x) * ax + (body.z - floor.z) * az - before);
        expect([yaw, d, body.y, body.grounded]).toEqual([yaw, d, Math.fround(b.top), true]);
      }
      expect([yaw, d, slowest > p.walkSpeed * TICK_DT * 0.999]).toEqual([yaw, d, true]);
      expect(clear(w, built)).toBe(true);
    }
  }
});

/** Whether (x, z) is inside the outline. */
function inside(outline: readonly (readonly number[])[], x: number, z: number): boolean {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi, xj, zj] = [outline[i]![0]!, outline[i]![1]!, outline[j]![0]!, outline[j]![1]!];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

/** How near (x, z) is to the outline's sides. */
function reach(outline: readonly (readonly number[])[], x: number, z: number): number {
  let least = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az, bx, bz] = [outline[j]![0]!, outline[j]![1]!, outline[i]![0]!, outline[i]![1]!];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    least = Math.min(least, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
  }
  return least;
}

test("a body in a mixed house walks its floor level and cannot get out, and one outside cannot get in", () => {
  const w = turnedWorld(4);
  const p = w.reg.move[w.kind("core:survivor")]!;
  const pace = p.walkSpeed * TICK_DT;
  for (const yaw of someYaws()) {
    const b = new Base(w, 128, 128, yaw);
    const house = mixedHouse(b);
    const outline = house.outline.map((a) => b.at(a));
    const middle = [0, 3, 6].reduce((s, i) => [s[0]! + outline[i]![0] / 3, s[1]! + outline[i]![1] / 3], [0, 0]);
    const centres = house.floors.slice(1).map(([ref]) => rowOf(w, ref));
    const body = new Body();
    const start = (x: number, y: number, z: number): void => {
      [body.x, body.y, body.z, body.vx, body.vy, body.vz, body.grounded] = [x, y, z, 0, 0, 0, true];
    };
    // From each square to each other, over the triangle between them.
    for (const from of centres) {
      for (const to of centres) {
        if (from === to) continue;
        const a = along([from.x, from.z], [to.x, to.z]);
        const far = Math.hypot(to.x - from.x, to.z - from.z);
        start(from.x - a.ux, b.top, from.z - a.uz);
        const heading = Math.round((Math.atan2(a.ux, a.uz) / (2 * Math.PI)) * 65536) & 0xffff;
        let slowest = Infinity;
        for (let tick = 0; tick < Math.floor((far + 0.5) / pace); tick++) {
          const before = (body.x - from.x) * a.ux + (body.z - from.z) * a.uz;
          stepBody(w, body, 0, 127, heading, 0, 0, p, TICK_DT);
          if (tick >= 12) slowest = Math.min(slowest, (body.x - from.x) * a.ux + (body.z - from.z) * a.uz - before);
          expect([yaw, body.y, body.grounded]).toEqual([yaw, Math.fround(b.top), true]);
        }
        expect([yaw, slowest > pace * 0.999]).toEqual([yaw, true]);
      }
    }
    // Out from the middle and in from all round, each way for long enough to reach a wall and press on it.
    for (let k = 0; k < 24; k++) {
      const turn = (k * Math.PI) / 12 + 0.05;
      const [dx, dz] = [Math.sin(turn), Math.cos(turn)];
      const heading = Math.round((turn / (2 * Math.PI)) * 65536) & 0xffff;
      start(middle[0]!, b.top, middle[1]!);
      for (let tick = 0; tick < 120; tick++) {
        stepBody(w, body, 0, 127, heading, 0, 0, p, TICK_DT);
        expect([yaw, k, inside(outline, body.x, body.z), reach(outline, body.x, body.z) > p.radius - 0.01, body.y]).toEqual([yaw, k, true, true, Math.fround(b.top)]);
      }
      start(middle[0]! - dx * 9, 0, middle[1]! - dz * 9);
      let nearest = Infinity;
      for (let tick = 0; tick < 150; tick++) {
        stepBody(w, body, 0, 127, heading, 0, 0, p, TICK_DT);
        nearest = Math.min(nearest, reach(outline, body.x, body.z));
        expect([yaw, k, inside(outline, body.x, body.z), nearest > p.radius - 0.01]).toEqual([yaw, k, false, true]);
      }
      // It got to the house, and was stopped at it or slid off it.
      expect(nearest).toBeLessThan(p.radius + WALL_THICK / 2 + 0.05);
    }
    expect(clear(w, house)).toBe(true);
  }
});

test("a ceiling of each class is a storey over its floor, and the storey between is closed by walls of the square's class", () => {
  const w = turnedWorld(4);
  const b = new Base(w, 128, 128, 4321);
  const house = mixedHouse(b);
  house.floors.forEach(([ref], i) => {
    const [floor, over] = [rowOf(w, ref), rowOf(w, house.ceilings[i]![0])];
    expect([over.x, over.z, over.yaw, over.tw]).toEqual([floor.x, floor.z, floor.yaw, floor.tw]);
  });
  // A square's three walls are of its class.
  expect(house.walls.map(([ref]) => rowOf(w, ref).tw)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  expect(house.floors.map(([ref]) => rowOf(w, ref).tw)).toEqual([0, 0, 1, 2]);
  expect(STOREY * 0.75).toBe(WALL_HEIGHT);
  expect(clear(w, house)).toBe(true);
});
