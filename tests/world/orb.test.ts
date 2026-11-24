// An orb (shared/world/orb.ts): its programme clock, its shell of flat facets, its site in a map's head and the build's op.
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
import { landmarkKinds } from "../../shared/world/city.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { MAX_CORNERS, hullFault } from "../../shared/world/convex.ts";
import { parseMap, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { ROUTE_MARGIN } from "../../shared/world/path.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { ORB_HOLD, ORB_SCENES, ORB_SIZES, ORB_WIPE, orbCollider, orbCollision, orbShapes, orbShell, orbShow, type OrbShow, type OrbSite } from "../../shared/world/orb.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { pieceShapes } from "../../shared/world/tactical.ts";
import { CAST_PHASE, eyePhase, nextCast } from "../../shared/world/tide-eye.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { Mason, type Frame } from "../../tools/mapworld/ruin-geometry.ts";
import { layout } from "../../tools/mapworld/ruin-layouts.ts";
import type { Composition, Rule } from "../../tools/mapworld/ruin-vocabulary.ts";
import { ORB_SHELLS, type Site } from "../../tools/mapworld/statics.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const { radius: R, centre: UP, round: ROUND } = ORB_SIZES[0];
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

let made: TestWorld | null = null;
/** Flat ground of four chunks with the shell's pieces on it. */
function shellWorld(): TestWorld {
  if (made) return made;
  const w = flatWorld(4);
  for (const p of orbCollision(SITE)) expect(w.structs.add(w.kind(p.kind), p.x, p.y, p.z, p.yaw, 0, 1)).toBeGreaterThanOrEqual(0);
  return (made = w);
}

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

test("every shape of a shell is inside a shape's limits and a route's margin", () => {
  const spread = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).spread;
  for (const size of ORB_SIZES) {
    for (const c of orbShell(size.radius, size.centre)) {
      expect(c.hulls.length >= 1 && c.hulls.length <= MAX_SHAPE_BOXES).toBe(true);
      for (const h of c.hulls) {
        expect(h.corners.length).toBeLessThanOrEqual(MAX_CORNERS);
        expect(hullFault(h)).toBe("");
      }
      const half = shapeHalf([], c.hulls);
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
  expect(pieces.length).toBeLessThan(847 / 8);
  expect(pieces.length).toBe(orbShell(R, UP).reduce((n, c) => n + c.at.length, 0));
  for (const p of pieces) {
    for (const v of [p.x, p.y, p.z]) expect(Number.isInteger(v * STRUCT_UNITS)).toBe(true);
    expect(Number.isInteger(p.yaw) && p.yaw >= 0 && p.yaw < 65536).toBe(true);
    expect(reg.index.has(p.kind)).toBe(true);
  }
  // A site's heading turns its picture, not its shell.
  expect(orbCollision({ ...SITE, yaw: 0 })).toEqual(pieces);
  expect(() => orbCollision({ ...SITE, radius: 40 })).toThrow("no shell of radius 40");
});

test("no other count of facets round the equator cuts the shell into fewer pieces", () => {
  const pieces = (round: number): number => orbShapes(R, UP, round).reduce((n, c) => n + c.at.length, 0);
  expect(pieces(ROUND)).toBe(orbCollision(SITE).length);
  // From facets a little over 8 m across down to 5 m.
  for (let round = 60; round <= 96; round += 4) expect(pieces(round)).toBeGreaterThanOrEqual(pieces(ROUND));
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

test("the far city, the blocks and the far feed leave the shell out", () => {
  const [landmark, feed] = [landmarkKinds(reg), pieceShapes(reg).far];
  for (const c of orbShell(R, UP)) expect([landmark[reg.index.get(c.kind)!], feed[reg.index.get(c.kind)!]]).toEqual([1, 0]);
  // A block of the city is in both.
  const block = reg.index.get("core:zruin_zmass8_steel")!;
  expect([landmark[block], feed[block]]).toEqual([0, 1]);
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
  expect(shell.map((p) => ({ ...p, yaw: (p.yaw * 65536) / 360 }))).toEqual(orbCollision({ ...orb, y: orb.y!, yaw: 0 }));
  expect(shell.every((p) => orbCollider(p.kind) && reg.index.has(p.kind))).toBe(true);
  // A layout with no orb asks for none, and the layer lays nothing.
  const other = new Mason(frame, 610);
  layout(other, { ...rule, recipe: "tower", compositions: {} }, { seed: 1, playable: 8, detail: 0 });
  expect([other.orbs.length, other.pieces.length > 0]).toEqual([0, true]);
  expect(ORB_SHELLS.make({ orbs: [] } as unknown as Site, [])).toEqual([]);
});
