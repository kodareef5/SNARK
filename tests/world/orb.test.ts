// An orb (shared/world/orb.ts): its programme clock, its shell of flat facets and its plinth, its site in a map's head
// and the build's op.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { createMapWorld } from "../../server/world.ts";
import { MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF, shapeHalf } from "../../shared/content/kinds/shapes.ts";
import { STRUCT_UNITS, TICK_DT, TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_SPRINT, Body, stepBody } from "../../shared/sim/character.ts";
import { BAIL } from "../../shared/sim/skate-state.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { floatingKinds, landmarkKinds } from "../../shared/world/city.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { MAX_CORNERS, hullFault } from "../../shared/world/convex.ts";
import { parseMap, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { ROUTE_MARGIN } from "../../shared/world/path.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { ORB_HOLD, ORB_SCENES, ORB_SIZES, ORB_WIPE, orbCollider, orbCollision, orbShell, orbShow, type OrbShow, type OrbSite } from "../../shared/world/orb.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { pieceShapes } from "../../shared/world/tactical.ts";
import { CAST_PHASE, eyePhase, nextCast } from "../../shared/world/tide-eye.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { KEY_PROMPT } from "../../client/core/hud/prompt.ts";
import { buildingWord } from "../../client/core/prompts.ts";
import { mapBuildings, orderPieces, type SiteBuilding } from "../../tools/mapworld/buildings.ts";
import { Mason, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { fitCourses, pieces as piecesOf } from "../../tools/orb/shell.ts";
import { camp, look, put, screen, shown, until } from "../kit/kit.ts";
import { layout } from "../../tools/mapworld/ruin-layouts.ts";
import type { Composition, Rule } from "../../tools/mapworld/ruin-vocabulary.ts";
import { ORB_SHELLS, type Site } from "../../tools/mapworld/statics.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const { radius: R, centre: UP, round: ROUND, courses: COURSES } = ORB_SIZES[0];
/** The Vegas orb on flat ground at 0, off the lattice's round numbers, with its picture turned. */
const SITE: OrbSite = { name: "Sphere", x: 126.3125, y: 0, z: 130.6875, yaw: 9000, radius: R, centre: UP };
const [CX, CY, CZ] = [SITE.x, SITE.y + UP, SITE.z];
/** The most the shell may stand off the true sphere. */
const OFF = 0.15;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The point of the true sphere `deg` from its top, `lon` degrees round from +X, raised `over` metres off it. */
const on = (deg: number, lon: number, over = 0): [number, number, number] => {
  const r = R + over;
  return [CX + r * Math.sin(rad(deg)) * Math.cos(rad(lon)), CY + r * Math.cos(rad(deg)), CZ + r * Math.sin(rad(deg)) * Math.sin(rad(lon))];
};
const fromCentre = (x: number, y: number, z: number): number => Math.hypot(x - CX, y - CY, z - CZ);

/** The kinds of the plinth, whose pieces turn with a site's heading; the rest are the shell's. */
const PLINTH = new Set(orbShell(R, UP).filter((s) => s.turns).map((s) => s.kind));
const made: (TestWorld | null)[] = [null, null];
/** Flat ground of four chunks with the site's pieces on it: the shell alone, or with `plinth` the plinth too. */
function orbWorld(plinth: boolean): TestWorld {
  const w = made[+plinth] ?? flatWorld(4);
  if (!made[+plinth]) for (const p of orbCollision(SITE)) if (plinth || !PLINTH.has(p.kind)) expect(w.structs.add(w.kind(p.kind), p.x, p.y, p.z, p.yaw, 0, 1)).toBeGreaterThanOrEqual(0);
  return (made[+plinth] = w);
}
const shellWorld = (): TestWorld => orbWorld(false);

const show = (seconds: number, only = -1): OrbShow => orbShow(seconds, { scene: -1, before: -1, wipe: -1 }, only);

test("the programme shows the same scene to everyone at the same second", () => {
  const rng = new Rng(7);
  const kept: OrbShow = { scene: 0, before: 0, wipe: 0 };
  for (let i = 0; i < 500; i++) {
    const seconds = rng.range(-5000, 50000);
    const first = show(seconds);
    // Whatever was asked before, and into whatever was there.
    orbShow(rng.range(0, 9999), kept);
    expect(orbShow(seconds, kept)).toEqual(first);
    expect(ORB_SCENES[first.scene]).toBeDefined();
    expect(first.wipe >= 0 && first.wipe <= 1).toBe(true);
  }
});

test("a scene changes on the second the blue Tide Eye casts, and wipes in", () => {
  for (let k = -2; k < 9; k++) {
    const cast = CAST_PHASE + k * ORB_HOLD;
    expect(eyePhase(cast, { color: "blue" })).toBe(CAST_PHASE);
    if (k >= 0) expect(nextCast(cast * TICK_RATE, "blue", TICK_RATE)).toBe(cast * TICK_RATE);
    const [before, at] = [show(cast - 1 / TICK_RATE), show(cast)];
    expect(before.wipe).toBe(1);
    expect(at.scene).not.toBe(before.scene);
    expect([at.before, at.wipe]).toEqual([before.scene, 0]);
    expect(show(cast + ORB_WIPE / 2)).toEqual({ ...at, wipe: 0.5 });
    // It then holds until the next change.
    for (const later of [ORB_WIPE, 60, ORB_HOLD - 1 / TICK_RATE]) expect(show(cast + later)).toEqual({ ...at, wipe: 1 });
  }
});

test("the programme shows each scene in turn and wraps to the first", () => {
  const turn = Array.from({ length: ORB_SCENES.length * 2 }, (_, k) => show(CAST_PHASE + k * ORB_HOLD + 10).scene);
  expect(turn.slice(0, ORB_SCENES.length)).toEqual(ORB_SCENES.map((_, k) => k));
  expect(turn.slice(ORB_SCENES.length)).toEqual(turn.slice(0, ORB_SCENES.length));
  const lap = ORB_SCENES.length * ORB_HOLD;
  for (const seconds of [0, 15.9, 16, 500.25, 1199]) expect(show(seconds + 7 * lap)).toEqual(show(seconds));
  // One scene held by an admin never changes or wipes.
  for (const seconds of [0, CAST_PHASE, CAST_PHASE + 1, 9999]) expect(show(seconds, 3)).toEqual({ scene: 3, before: 3, wipe: 1 });
});

test("every shape of a shell and its plinth is inside a shape's limits and a route's margin", () => {
  const spread = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).spread;
  for (const size of ORB_SIZES) {
    for (const c of orbShell(size.radius, size.centre)) {
      const parts = c.hulls.length + c.boxes.length;
      expect(parts >= 1 && parts <= MAX_SHAPE_BOXES).toBe(true);
      for (const h of c.hulls) {
        expect(h.corners.length).toBeLessThanOrEqual(MAX_CORNERS);
        expect(hullFault(h)).toBe("");
      }
      const half = shapeHalf(c.boxes, c.hulls);
      expect(Math.max(...half)).toBeLessThanOrEqual(MAX_STRUCTURE_HALF);
      // Sideways it reaches no further than a route's margin allows the widest walker (shared/world/path.ts).
      const walkers = reg.bodyRadius.filter((_, kind) => !reg.vehicle[kind]);
      expect(spread[reg.index.get(c.kind)!]! + Math.max(...walkers)).toBeLessThanOrEqual(ROUTE_MARGIN);
      // The content has its kind, drawn as nothing, as big as the shell says.
      const def = reg.defs[reg.index.get(c.kind)!]!;
      expect(def.type === "structure" && [def.mesh, def.class, def.hp, def.material]).toEqual(["none", "static", 1000000, undefined]);
      expect(def.type === "structure" && def.half).toEqual(half);
      expect(orbCollider(c.kind)).toBe(true);
    }
  }
});

test("a shell is far fewer pieces than a dome of blocks, each on the map's lattice", () => {
  const pieces = orbCollision(SITE);
  // The dome it stands in for was 847 blocks.
  expect(pieces.filter((p) => !PLINTH.has(p.kind)).length).toBeLessThan(847 / 8);
  expect(pieces.length).toBe(orbShell(R, UP).reduce((n, c) => n + c.at.length, 0));
  for (const p of pieces) {
    for (const v of [p.x, p.y, p.z]) expect(Number.isInteger(v * STRUCT_UNITS)).toBe(true);
    expect(Number.isInteger(p.yaw) && p.yaw >= 0 && p.yaw < 65536).toBe(true);
    expect(reg.index.has(p.kind)).toBe(true);
  }
  // A site's heading turns its picture and its plinth, not its shell.
  const unturned = orbCollision({ ...SITE, yaw: 0 });
  expect(unturned.filter((p) => !PLINTH.has(p.kind))).toEqual(pieces.filter((p) => !PLINTH.has(p.kind)));
  expect(unturned.filter((p) => PLINTH.has(p.kind)).some((p, k) => p.yaw === pieces.filter((q) => PLINTH.has(q.kind))[k]!.yaw)).toBe(false);
  expect(() => orbCollision({ ...SITE, radius: 40 })).toThrow("no shell of radius 40");
});

test("the size's courses are what the fitting tool gives, and no other count round the equator fits fewer pieces", () => {
  expect(fitCourses(R, UP, ROUND)).toEqual(COURSES.map((c) => [...c]));
  expect(piecesOf(COURSES)).toBe(orbCollision(SITE).filter((p) => !PLINTH.has(p.kind)).length);
  // From facets a little over 8 m across down to 5 m.
  for (let round = 60; round <= 96; round += 4) expect(piecesOf(fitCourses(R, UP, round)!)).toBeGreaterThanOrEqual(piecesOf(COURSES));
});

/**
 * A ray at the point of the true sphere at (deg, lon), from 25 m off along a line `tilt` degrees from straight out,
 * leaning toward `round` degrees: how far from the true sphere it stops, or NaN where it meets no piece in time.
 */
function stops(w: TestWorld, deg: number, lon: number, tilt = 0, round = 0): number {
  const [px, py, pz] = on(deg, lon);
  const out = [(px - CX) / R, (py - CY) / R, (pz - CZ) / R] as const;
  // Two directions across the surface there: down a meridian, and round the axis.
  const down = [Math.cos(rad(deg)) * Math.cos(rad(lon)), -Math.sin(rad(deg)), Math.cos(rad(deg)) * Math.sin(rad(lon))] as const;
  const side = [-Math.sin(rad(lon)), 0, Math.cos(rad(lon))] as const;
  const [c, s, cr, sr] = [Math.cos(rad(tilt)), Math.sin(rad(tilt)), Math.cos(rad(round)), Math.sin(rad(round))];
  const d = [0, 1, 2].map((k) => out[k]! * c + (down[k]! * cr + side[k]! * sr) * s);
  const far = 25;
  const [ox, oy, oz] = [px + d[0]! * far, py + d[1]! * far, pz + d[2]! * far];
  // Only rays that start over the ground are cast.
  if (oy < 0.5) return 0;
  if (castWorld(w, ox, oy, oz, -d[0]!, -d[1]!, -d[2]!, far + 2 * OFF + 0.01) !== HIT_STRUCTURE) return NaN;
  return fromCentre(ox - d[0]! * rayHit.t, oy - d[1]! * rayHit.t, oz - d[2]! * rayHit.t) - R;
}

test("rays from every side stop within 0.15 m of the true sphere", () => {
  const w = shellWorld();
  const rng = new Rng(11);
  let most = 0;
  for (let i = 0; i < 30000; i++) {
    // Evenly over the sphere down to half a metre over the ground, from straight on to 60 degrees off.
    const deg = (Math.acos(rng.range((0.6 - CY) / R, 1)) * 180) / Math.PI;
    const off = stops(w, deg, rng.range(0, 360), rng.range(0, 60), rng.range(0, 360));
    expect(Math.abs(off)).toBeLessThanOrEqual(OFF);
    most = Math.max(most, Math.abs(off));
  }
  // The facets are no finer than they need be: some of it is a few centimetres off.
  expect(most).toBeGreaterThan(0.05);
});

test("rays at facet joins, at piece seams and at the top stop on the shell", () => {
  const w = shellWorld();
  // Rows and meridians are a facet apart at their closest: every corner, every join's middle and every facet's.
  const step = 360 / ROUND / 2;
  for (let i = 0; i * step < 115; i++) {
    for (let j = 0; j < (i === 0 ? 1 : ROUND * 2); j++) {
      expect(Math.abs(stops(w, i * step, j * step))).toBeLessThanOrEqual(OFF);
      // And aslant, along the join and across it.
      for (const round of [0, 90, 225]) expect(Math.abs(stops(w, i * step, j * step, 55, round))).toBeLessThanOrEqual(OFF);
    }
  }
  // A hair either side of a join.
  for (const deg of [5, 10, 20, 35, 55, 75, 95]) {
    for (const lon of [0, 20, 30, 60, 100, 190]) for (const d of [-1e-4, 1e-4]) expect(Math.abs(stops(w, deg + d, lon + d))).toBeLessThanOrEqual(OFF);
  }
});

const SURVIVOR = reg.move[reg.index.get("core:survivor")!]!;

/** A survivor let go half a metre over the shell at (deg, lon), after `ticks` with nothing pressed. */
function dropped(w: TestWorld, deg: number, lon: number, ticks: number, each: (b: Body) => void = () => {}): Body {
  const b = new Body();
  [b.x, b.y, b.z] = on(deg, lon, 0.5);
  for (let t = 0; t < ticks; t++) {
    stepBody(w, b, 0, 0, 0, 0, 0, SURVIVOR, TICK_DT);
    expect(capsuleFree(w, b.x, b.y, b.z, SURVIVOR.radius, SURVIVOR.height)).toBe(true);
    each(b);
  }
  return b;
}
/** How far the sphere at a survivor's feet is off the true sphere's surface: it rests on the shell at 0. */
const feetOff = (b: Body): number => fromCentre(b.x, b.y + SURVIVOR.radius, b.z) - SURVIVOR.radius - R;

test("a survivor stands anywhere on the cap, on a join or off it", () => {
  const w = shellWorld();
  // The walkable angle is 44.8 degrees; the rows there are at 40 and 45.
  for (const deg of [0, 3, 5, 10, 14, 15, 20, 25, 30, 35, 40, 43]) {
    for (const lon of [0, 20, 30, 77, 180, 290]) {
      const b = dropped(w, deg, lon, 90);
      const [x, y, z] = [b.x, b.y, b.z];
      for (let t = 0; t < 120; t++) stepBody(w, b, 0, 0, 0, 0, 0, SURVIVOR, TICK_DT);
      expect([b.grounded, b.x, b.y, b.z]).toEqual([true, x, y, z]);
      // Under where it was let go: it did not slip as it landed.
      expect(Math.hypot(x - on(deg, lon, 0.5)[0], z - on(deg, lon, 0.5)[2])).toBeLessThan(0.02);
      expect(Math.abs(feetOff(b))).toBeLessThanOrEqual(OFF);
    }
  }
});

test("a survivor runs across the cap, over every join, at one pace", () => {
  const w = shellWorld();
  for (const heading of [0, 17, 45, 90, 201, 310]) {
    const [sx, sz] = [Math.sin(rad(heading)), Math.cos(rad(heading))];
    // From 50 m one side of the top to 50 m the other.
    const b = new Body();
    [b.x, b.z] = [CX - 50 * sx, CZ - 50 * sz];
    b.y = CY + Math.sqrt((R + 0.3) ** 2 - 2500);
    const yaw = Math.round((heading / 360) * 65536) & 65535;
    let ticks = 0;
    for (let px = b.x, pz = b.z; (b.x - CX) * sx + (b.z - CZ) * sz < 50; ticks++, px = b.x, pz = b.z) {
      stepBody(w, b, 0, 127, yaw, 0, BTN_SPRINT, SURVIVOR, TICK_DT);
      if (ticks < 30) continue;
      expect(b.grounded).toBe(true);
      expect(Math.hypot(b.x - px, b.z - pz) / TICK_DT).toBeCloseTo(SURVIVOR.walkSpeed * SURVIVOR.sprintMul, 3);
      expect(Math.abs(feetOff(b))).toBeLessThanOrEqual(OFF);
      expect(ticks).toBeLessThan(2000);
    }
  }
});

test("a survivor on the flank slides to the ground and never sinks in", () => {
  const w = shellWorld();
  for (const deg of [47, 55, 70, 88]) {
    for (const lon of [0, 30, 135, 260]) {
      let least = Infinity;
      const b = dropped(w, deg, lon, 900, (b) => (least = Math.min(least, feetOff(b))));
      // On the ground, out from under the widest of the sphere.
      expect(b.grounded && b.y < 0.05).toBe(true);
      expect(Math.hypot(b.x - CX, b.z - CZ)).toBeGreaterThan(R);
      expect(least).toBeGreaterThanOrEqual(-OFF);
    }
  }
});

test("a skateboard rolls across the cap's joins and never leaves the surface", () => {
  const w = shellWorld();
  // A line by its heading, metres to one side of the top, and metres before the top it starts.
  for (const [heading, aside, before] of [[0, 0, 0], [17, 0, 0], [90, 0, 0], [133, 2, 20], [201, 3.4, 28], [270, 6.8, 28], [20, 0, 28], [10, 11, 25]] as const) {
    const a = rad(heading), [sx, sz] = [Math.sin(a), Math.cos(a)];
    const b = Object.assign(new Body(), { x: CX - before * sx + aside * sz, z: CZ - before * sz - aside * sx, grounded: true, vehicleYaw: a });
    b.y = CY + Math.sqrt((R + 0.12) ** 2 - (b.x - CX) ** 2 - (b.z - CZ) ** 2);
    let ticks = 0;
    for (let was = 0; (b.x - CX) * sx + (b.z - CZ) * sz < 28; ticks++) {
      stepVehicleBody(w, b, 0, 127, 0, BOARD);
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      expect([b.grounded, vehicleStep.blocked, vehicleStep.skateHurt, b.skate?.move === BAIL]).toEqual([true, null, 0, false]);
      // It slows only as the climb to the top slows it: under 3 m/s a second.
      expect(was - speed).toBeLessThan(3 * TICK_DT);
      expect(Math.abs(fromCentre(b.x, b.y, b.z) - R)).toBeLessThanOrEqual(OFF);
      expect(ticks).toBeLessThan(900);
      was = speed;
    }
    expect(ticks).toBeGreaterThan(100);
  }
});

test("a car drives over the cap's joins with no knock", () => {
  const w = shellWorld();
  const road = new StaticVehicleWorld(w, () => ASPHALT);
  for (const [heading, aside] of [[0, 0], [0, 3.4], [45, 0], [90, 2], [200, 1], [10, 5]] as const) {
    const a = rad(heading), [sx, sz] = [Math.sin(a), Math.cos(a)];
    // From 25 m before the top to 30 m past it, held near 10 m/s.
    const [x, z] = [CX - 25 * sx + aside * sz, CZ - 25 * sz - aside * sx];
    const car = createVehicle(COMPACT, x, CY + Math.sqrt((R + 0.1) ** 2 - (x - CX) ** 2 - (z - CZ) ** 2) + 0.3, z, a);
    for (let t = 0; t < 60; t++) stepVehicle(car, { throttle: 0, steer: 0, brake: 1, handbrake: true }, COMPACT, road);
    let ticks = 0, fastest = 0;
    for (let was = 0, fell = car.vy; (car.x - CX) * sx + (car.z - CZ) * sz < 30; ticks++) {
      const hit = stepVehicle(car, { throttle: was < 10 ? 1 : 0, steer: 0, brake: was > 11 ? 0.3 : 0, handbrake: false }, COMPACT, road);
      const speed = Math.hypot(car.vx, car.vy, car.vz);
      expect([car.grounded, hit.blocked, hit.impactSpeed]).toEqual([true, null, 0]);
      // No tick takes a quarter of a metre a second off it, or turns its fall by more than its springs do at a crease.
      expect(was - speed).toBeLessThan(0.25);
      expect(Math.abs(car.vy - fell)).toBeLessThan(0.6);
      expect(Math.abs(fromCentre(car.x, car.y, car.z) - R)).toBeLessThanOrEqual(OFF);
      expect(ticks).toBeLessThan(900);
      [was, fell, fastest] = [speed, car.vy, Math.max(fastest, speed)];
    }
    expect(fastest).toBeGreaterThan(10);
  }
});

// ---- The plinth: a ring of 32 flat sides with a canopy over a doorway on every eighth, turned with the site's heading.

const TURN = (SITE.yaw * Math.PI) / 32768;
/** A place by the plinth: `out` from the axis along the middle of side `k` of 32, `aside` to its left, `up` over the ground. */
const beside = (k: number, out: number, up: number, aside = 0): [number, number, number] => {
  const a = TURN + (k * Math.PI) / 16, [c, n] = [Math.cos(a), -Math.sin(a)];
  return [CX + c * out - n * aside, SITE.y + up, CZ + n * out + c * aside];
};
/** Where a ray from (x, y, z) along (dx, dy, dz) stops on a piece of the plinth, or null where it meets none within 60 m. */
function onPlinth(x: number, y: number, z: number, dx: number, dy: number, dz: number): [number, number, number] | null {
  const w = orbWorld(true);
  if (castWorld(w, x, y, z, dx, dy, dz, 60) !== HIT_STRUCTURE) return null;
  const t = w.structs.chunks[Math.floor(rayHit.ref / 65536)]!;
  return PLINTH.has(reg.ids[t.kind[rayHit.ref & 0xffff]!]!) ? [x + dx * rayHit.t, y + dy * rayHit.t, z + dz * rayHit.t] : null;
}

test("a ray at eye height from the street stops at the plinth's wall, all the way round", () => {
  // The wall's foot is 76.4 m out at a side's middle and leans in to 75.7 at its head; a corner is 0.4 m further out.
  for (let deg = 0; deg < 360; deg += 0.25) {
    const [dx, dz] = [Math.cos(rad(deg)), Math.sin(rad(deg))];
    for (const eye of [0.4, 1.6, 2.8]) {
      const hit = onPlinth(CX + dx * 110, SITE.y + eye, CZ + dz * 110, -dx, 0, -dz);
      expect(hit).not.toBeNull();
      const out = Math.hypot(hit![0] - CX, hit![2] - CZ);
      expect(out > 75.4 && out < 76.9).toBe(true);
    }
  }
  // Square on to a plain side it stops where the model's wall is, and at a doorway on the door, a little proud of it.
  for (const k of [1, 5, 11, 20, 31]) expect(Math.hypot(onPlinth(...beside(k, 110, 1.6), ...toAxis(k))![0] - CX, onPlinth(...beside(k, 110, 1.6), ...toAxis(k))![2] - CZ)).toBeCloseTo(76.4 * 0.9976 - (0.7 * 3.6) / 5.2, 1);
  for (const k of [0, 8, 16, 24]) expect(Math.hypot(onPlinth(...beside(k, 110, 1.6), ...toAxis(k))![0] - CX, onPlinth(...beside(k, 110, 1.6), ...toAxis(k))![2] - CZ)).toBeCloseTo(76.25, 2);
});
/** The way from the middle of side `k` to the axis. */
function toAxis(k: number): [number, number, number] {
  const [x, , z] = beside(k, 1, 0);
  return [CX - x, 0, CZ - z];
}

test("a ray down onto the plinth's roof stops at the roof, and one onto a canopy at the canopy", () => {
  // The roof is 5.6 m up, from the eave 75.85 m out in under the screen. From under the screen's overhang, all round.
  for (let k = 0; k < 32; k++) {
    for (const [out, aside] of [[73.5, 0], [74.6, 3], [75.6, -6.5], [75.2, 7.2]] as const) {
      const hit = onPlinth(...beside(k, out, 7, aside), 0, -1, 0);
      expect(hit![1]).toBeCloseTo(SITE.y + 5.6, 4);
    }
    // Past the eave there is no roof.
    if (k % 8 !== 0) expect(onPlinth(...beside(k, 76.6, 7), 0, -1, 0)).toBeNull();
  }
  // A canopy is a slab 11 m wide from the wall to 80.5 m out, its top 3.5 m up; beside it and past it is the ground.
  // From 10 m up, under the screen's overhang.
  for (const k of [0, 8, 16, 24]) {
    for (const [out, aside] of [[77, 0], [80.3, 5.3], [80.3, -5.3], [78.5, 2]] as const) expect(onPlinth(...beside(k, out, 10, aside), 0, -1, 0)![1]).toBeCloseTo(SITE.y + 3.5, 4);
    for (const [out, aside] of [[80.8, 0], [78.5, 5.8], [78.5, -5.8]] as const) expect(onPlinth(...beside(k, out, 10, aside), 0, -1, 0)).toBeNull();
    // Under it a survivor's head is clear: up from the ground the slab's underside is 3.2 m up.
    expect(onPlinth(...beside(k, 78.5, 0.1), 0, 1, 0)![1]).toBeCloseTo(SITE.y + 3.2, 4);
  }
});

test("a survivor cannot walk through the plinth's wall or its doorways", () => {
  const w = orbWorld(true);
  for (const [k, aside] of [[0, 0], [0, 4.6], [3, 0], [8, -2], [13, 7.3], [22, -7.4], [29, 3]] as const) {
    // From 9 m outside the wall toward the axis, for ten seconds.
    const b = new Body();
    [b.x, b.y, b.z] = beside(k, 85, 0, aside);
    b.grounded = true;
    const [tx, , tz] = toAxis(k);
    const yaw = Math.round((Math.atan2(tx, tz) / (2 * Math.PI)) * 65536) & 65535;
    for (let t = 0; t < 300; t++) {
      stepBody(w, b, 0, 127, yaw, 0, BTN_SPRINT, SURVIVOR, TICK_DT);
      expect(capsuleFree(w, b.x, b.y, b.z, SURVIVOR.radius, SURVIVOR.height)).toBe(true);
    }
    // It got to the wall and no further: its middle a body's radius outside the leaning wall, or the door's face.
    const out = Math.hypot(b.x - CX, b.z - CZ);
    expect(out > 75.8 + SURVIVOR.radius && out < 77.5).toBe(true);
    expect(b.y).toBeLessThan(0.05);
  }
});

test("a survivor stands on the plinth's roof and on a canopy", () => {
  const w = orbWorld(true);
  for (const [k, out, aside, top] of [[2, 74.8, 0, 5.6], [8, 75.3, 6, 5.6], [15, 74.2, -7.3, 5.6], [27, 75.5, 7.45, 5.6], [0, 78.5, 0, 3.5], [16, 80, -5, 3.5]] as const) {
    const b = new Body();
    [b.x, b.y, b.z] = beside(k, out, top + 0.4, aside);
    for (let t = 0; t < 120; t++) stepBody(w, b, 0, 0, 0, 0, 0, SURVIVOR, TICK_DT);
    expect([b.grounded, Math.abs(b.y - (SITE.y + top)) < 0.01]).toEqual([true, true]);
    expect(Math.hypot(b.x - beside(k, out, 0, aside)[0], b.z - beside(k, out, 0, aside)[2])).toBeLessThan(0.01);
    expect(capsuleFree(w, b.x, b.y, b.z, SURVIVOR.radius, SURVIVOR.height)).toBe(true);
  }
  // It walks the roof round a corner of the ring, from one side onto the next, without a step.
  const b = new Body();
  [b.x, b.y, b.z] = beside(4, 74.8, 5.6, -5);
  b.grounded = true;
  const [nx, , nz] = beside(5, 74.8, 5.6, 5);
  const yaw = Math.round((Math.atan2(nx - b.x, nz - b.z) / (2 * Math.PI)) * 65536) & 65535;
  for (let t = 0; t < 300 && Math.hypot(b.x - nx, b.z - nz) > 0.5; t++) {
    stepBody(w, b, 0, 127, yaw, 0, 0, SURVIVOR, TICK_DT);
    expect([b.grounded, Math.abs(b.y - (SITE.y + 5.6)) < 0.01]).toEqual([true, true]);
  }
  expect(Math.hypot(b.x - nx, b.z - nz)).toBeLessThan(0.6);
});

test("an orb's site goes through a map's head and back, and a map without one reads", () => {
  const pieces = orbCollision(SITE);
  const bytes = writeMap(flatMap(4, { orbs: [SITE], statics: pieces }));
  expect(readHead(bytes).orbs).toEqual([SITE]);
  const map = parseMap(bytes);
  expect(map.orbs).toEqual([SITE]);
  expect([...map.statics].map((s) => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw }))).toEqual(pieces);
  // The same bytes again from what was read.
  expect(writeMap({ ...flatMap(4), orbs: map.orbs!, statics: map.statics })).toEqual(bytes);
  const plain = writeMap(flatMap(4));
  expect([readHead(plain).orbs, parseMap(plain).orbs]).toEqual([undefined, undefined]);
  expect(new TextDecoder("latin1").decode(plain)).not.toContain("ORBS");
  expect(new TextDecoder("latin1").decode(writeMap(flatMap(4, { orbs: [] })))).not.toContain("ORBS");
});

test("a map refuses an orb off it, unnamed, off the ground or turned by a fraction", () => {
  for (const wrong of [{ x: -1 }, { z: 257 }, { name: "" }, { y: NaN }, { radius: 0 }, { centre: R }, { centre: -R }, { yaw: 0.5 }, { yaw: 65536 }]) {
    expect(() => writeMap(flatMap(4, { orbs: [{ ...SITE, ...wrong }] }))).toThrow("invalid orb site");
  }
  expect(() => writeMap(flatMap(4, { orbs: [{ ...SITE, centre: 0 }, { ...SITE, name: "Other", yaw: 65535 }] }))).not.toThrow();
});

test("the far city, the blocks, the far shadow and the far feed leave the shell out", () => {
  const [landmark, floating, feed] = [landmarkKinds(reg), floatingKinds(reg), pieceShapes(reg).far];
  for (const c of orbShell(R, UP)) {
    const k = reg.index.get(c.kind)!;
    expect([landmark[k], floating[k], feed[k]]).toEqual([1, 1, 0]);
  }
  // A Tide Eye's collider is left out the same way, and a block of the city is in them all.
  const [spar, block] = [reg.index.get("core:zztide_eye_spar")!, reg.index.get("core:zruin_zmass8_steel")!];
  expect([landmark[spar], floating[spar], feed[spar]]).toEqual([1, 1, 0]);
  expect([landmark[block], floating[block], feed[block]]).toEqual([0, 0, 1]);
});

test("a server and its clients hold their map's orbs", () => {
  const bytes = writeMap(flatMap(4, { orbs: [SITE], statics: orbCollision(SITE) }));
  expect(createMapWorld(reg, parseMap(bytes)).orbs).toEqual([SITE]);
  expect(createMapWorld(reg, parseMap(writeMap(flatMap(4)))).orbs).toEqual([]);
  const h = new Harness({}, 1, 30, { dev: true, map: bytes });
  const s = h.join("ada");
  h.run(500);
  expect(h.world.orbs).toEqual([SITE]);
  expect(s.world!.orbs).toEqual([SITE]);
  // The server's world is the shell's: a ray down the axis stops on its top.
  expect(castWorld(h.world, CX, 200, CZ, 0, -1, 0, 300)).toBe(HIT_STRUCTURE);
  expect(Math.abs(200 - rayHit.t - (CY + R))).toBeLessThanOrEqual(OFF);
});

test("a look at the orb's shell or its plinth names its place", () => {
  // As the build lays them (tools/mapworld/statics.ts): the place's building among the site's, and the layer's pieces its.
  const place: SiteBuilding = {
    id: 976405284, kind: "theatre", recipe: "theatre", form: "theatre", district: "Paradise", collapse: "shear", storeys: 28, playable: 0, roof: false,
    named: true, name: "Sphere", address: null, x: SITE.x, z: SITE.z, yaw: 0, bay: 8, cols: 19, rows: 19, width: 157, depth: 157, base: 0, stairs: [],
  };
  const site = { orbs: [{ name: "Sphere", x: SITE.x, z: SITE.z, yaw: (SITE.yaw * 360) / 65536, radius: R, centre: UP, building: 1 }], groundAt: () => 0 } as unknown as Site;
  const ordered = orderPieces([{ kind: "core:crate", x: 20, y: 0, z: 20, yaw: 0 }, ...ORB_SHELLS.make(site, [])], [{ ...place, id: 5, named: false, name: "Other" }, place]);
  const statics = ordered.pieces.map((p) => ({ ...p, yaw: Math.round((p.yaw * 65536) / 360) & 65535 }));
  expect(statics.slice(1)).toEqual(expect.arrayContaining(orbCollision(SITE)));
  const file = writeMap(flatMap(4, { orbs: [SITE], statics, buildings: mapBuildings({ chunksX: 4, chunksZ: 4 }, [{ ...place, id: 5, named: false, name: "Other" }, place], ordered, 0, 0) }));
  // Every piece of the shell and the plinth, by the chunk and slot the file gave it; the crate is no building's.
  const map = parseMap(file);
  const words = new Map<string, number>();
  for (let chunk = 0; chunk < 16; chunk++) {
    for (let r = map.statics.first[chunk]!; r < map.statics.first[chunk + 1]!; r++) {
      const word = `${orbCollider(map.statics.kinds[map.statics.kind[r]!]!) ? "orb" : "other"}: ${buildingWord(map.buildings!, chunk, r - map.statics.first[chunk]!)}`;
      words.set(word, (words.get(word) ?? 0) + 1);
    }
  }
  expect([...words]).toEqual([["other: ", 1], ["orb: Sphere", orbCollision(SITE).length]]);
  // On a server, stood at the wall on the street and looking at it, the prompt says so.
  const k = 5, [x, , z] = beside(k, 78, 0), [wx, , wz] = beside(k, 76, 0);
  const { h, ada } = camp({ place: { map: file, at: () => ({ x, z }) }, screen: true, god: true });
  put(h, ada, { x, z });
  look(h, ada, { x: wx, y: 1.5, z: wz });
  const view = screen(h, ada);
  expect(until(h, () => shown(view, KEY_PROMPT) !== null, 5)).toBe(true);
  expect(shown(view, KEY_PROMPT)).toBe("Sphere");
  // And the shell, as the page finds what is looked at: a ray to it in the client's world, and the piece's building.
  expect(castWorld(ada.world!, CX + 3, 200, CZ + 2, 0, -1, 0, 300)).toBe(HIT_STRUCTURE);
  const hit = rayHit.ref, t = ada.world!.structs.chunks[Math.floor(hit / 65536)]!;
  expect([PLINTH.has(reg.ids[t.kind[hit & 0xffff]!]!), buildingWord(ada.buildings, Math.floor(hit / 65536), hit & 0xffff)]).toEqual([false, "Sphere"]);
});

const VEGAS = JSON.parse(readFileSync(join(import.meta.dir, "../../assets/source/maps/las-vegas/compositions.json"), "utf8")) as Record<string, Composition>;

test("Las Vegas's sphere is laid as an orb: no blocks, a site, and its shell", () => {
  // A footprint 160 m square turned 30 degrees, its base 610 m up, as the ruins give a layout.
  const [c, s] = [Math.cos(rad(30)), Math.sin(rad(30))];
  const frame: Frame = { x: 700, z: 900, yaw: 30, c, s, width: 160, depth: 160, rings: [[[-80, -80], [80, -80], [80, 80], [-80, 80], [-80, -80]]] };
  const rule: Rule = { recipe: "theatre", height: 112, finish: "steel", feature: "frame", holes: 0.35, wall: 0.35, bay: 8, matched: [], provisional: true, compositions: VEGAS };
  const m = new Mason(frame, 610);
  layout(m, rule, { seed: 1, playable: 8, detail: 0 }, "sphere");
  expect(m.pieces).toEqual([]);
  expect(m.orbs).toEqual([{ x: 700 - 2.9 * c + 0.6 * s, z: 900 + 2.9 * s + 0.6 * c, yaw: 30, radius: 78, centre: 34 }]);
  // The build's layer for it: the shell on the ground under its axis, and the height the head will give the site.
  const site = { orbs: m.orbs.map((o) => ({ name: "Sphere", ...o })), groundAt: (x: number, z: number) => 610.2 + (x - 700) * 0.001 + (z - 900) * 0.002 } as unknown as Site;
  const shell = ORB_SHELLS.make(site, []);
  const orb = site.orbs[0]!;
  expect(orb.y).toBeCloseTo(610.2 + (orb.x - 700) * 0.001 + (orb.z - 900) * 0.002, 2);
  for (const v of [orb.x, orb.y!, orb.z]) expect(Number.isInteger(v * STRUCT_UNITS)).toBe(true);
  // Its plinth is turned as the head will say the site is: 30 degrees.
  expect(shell.map((p) => ({ ...p, yaw: Math.round((p.yaw * 65536) / 360) }))).toEqual(orbCollision({ ...orb, y: orb.y!, yaw: Math.round((30 * 65536) / 360) }));
  expect(shell.every((p) => orbCollider(p.kind) && reg.index.has(p.kind))).toBe(true);
  // A layout with no orb asks for none, and the layer lays nothing.
  const other = new Mason(frame, 610);
  layout(other, { ...rule, recipe: "tower", compositions: {} }, { seed: 1, playable: 8, detail: 0 });
  expect([other.orbs.length, other.pieces.length > 0]).toEqual([0, true]);
  expect(ORB_SHELLS.make({ orbs: [] } as unknown as Site, [])).toEqual([]);
});
