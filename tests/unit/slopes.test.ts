// Bodies on sloped pieces, the proof kinds of content/slopes.ts: up and down them at every speed, standing on them, across the
// seams where they meet floors, boxes and each other, and on faces too steep to stand on, where a body slides as one that
// falls and is held where it has no way down, but banks no speed to land with.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { slopeKind } from "../../content/slopes.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { leaning, slopeShape, staticOf, wedge } from "../../shared/content/slopes.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { BTN_JUMP, BTN_SPRINT, Body, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TestWorld } from "../fixtures/world.ts";

// A slab 16 m long leaning at 60 degrees, for a long ride down a face too steep to stand on, and a heap of 47 degrees, steeper
// than a survivor or a wild creature stands on and not than a tame does.
const LONG = slopeShape("test:shape_long60", "thing", [leaning([2, 0.25, 8], 60)]);
const STEEP = slopeShape("test:shape_heap47", "thing", [wedge(4, 3, 3.2)]);
const compiled = compileContent([...CORE_CONTENT, LONG, STEEP, staticOf("test:long60", LONG, { color: 1, hp: 1000 }), staticOf("test:heap47", STEEP, { color: 1, hp: 1000 })]);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const reg: Registry = compiled.registry;
const kind = (id: string): number => reg.index.get(id)!;
const move = (id: string): MoveParams => reg.move[kind(id)]!;
const WALKERS = reg.defs.flatMap((d) => (d?.type === "species" && !d.still ? [d.id] : []));
const G = move("core:survivor").gravity;

/** Flat ground at y = 0. */
function world(): TestWorld {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  return { dims, hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), reg, kind };
}

/** A proof piece by its short name, its middle over (x, z) and its foot on `base`. It rises toward +Z. */
function piece(w: TestWorld, name: string, x = 64, z = 64, base = 0, yaw = 0): number {
  const k = kind(name.includes(":") ? name : slopeKind(name));
  return w.structs.add(k, x, base + reg.halfY[k]!, z, yaw, 0, 1);
}

/** The lowest a body may stand over (x, z) coming down from `from`: on top of what is there, not in the room beneath it. */
function rest(w: TestWorld, p: MoveParams, x: number, z: number, from = 12): number {
  const ground = groundUnder(w.hf, x, z, p.radius);
  let hi = from;
  while (hi > ground && capsuleFree(w, x, hi - 0.01, z, p.radius, p.height)) hi -= 0.01;
  if (hi <= ground) return ground;
  let lo = hi - 0.01;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (capsuleFree(w, x, mid, z, p.radius, p.height)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A body of `p` at rest over (x, z), facing `deg` degrees from +Z toward +X. */
function bodyAt(w: TestWorld, p: MoveParams, x: number, z: number, deg: number): Body {
  const b = new Body();
  b.x = x;
  b.z = z;
  b.y = rest(w, p, x, z);
  b.grounded = true;
  b.yaw = Math.round((deg / 360) * 65536) & 0xffff;
  return b;
}

const SPEEDS = [
  { move: 20, buttons: 0, said: "at 20/127" },
  { move: 60, buttons: 0, said: "at 60/127" },
  { move: 127, buttons: 0, said: "walking" },
  { move: 127, buttons: BTN_SPRINT, said: "sprinting" },
] as const;

/**
 * Ground creatures spend their authored speed along the surface, so their horizontal pace can fall to slopeCos times
 * that speed on a walkable face. Survivors and flyers keep their horizontal pace. Allow the original three seconds for
 * acceleration and seams, and use walking pace even for a sprint so exhaustion does not change the course deadline.
 */
function courseTicks(p: MoveParams, speed: { move: number }, horizontalDistance: number): number {
  const horizontalFraction = !p.lowStance && !p.flies ? p.slopeCos : 1;
  const pace = p.walkSpeed * (speed.move / 127) * horizontalFraction * TICK_DT;
  return Math.ceil(horizontalDistance / pace) + 90;
}

interface Walked {
  /** Ticks it was off its feet, it was higher than the surface by more than a hover, and it went less than half its pace. */
  air: number;
  high: number;
  slow: number;
  /** Fastest it landed, and the most it was above the surface. */
  land: number;
  gap: number;
  b: Body;
}

/**
 * Walks `b` facing `deg` until `done` or `ticks`, checking every tick that it is in free space. A tick counts as slow when it
 * went less than half as far as its speed takes it, once it has had a second to get going.
 */
function walk(w: TestWorld, p: MoveParams, b: Body, deg: number, speed: { move: number; buttons: number }, done: (b: Body) => boolean, ticks = 900): Walked {
  const yaw = Math.round((deg / 360) * 65536) & 0xffff;
  const pace = p.walkSpeed * (b.speedQ / 1000) * (speed.move / 127) * TICK_DT;
  const out: Walked = { air: 0, high: 0, slow: 0, land: 0, gap: 0, b };
  for (let t = 0; t < ticks && !done(b); t++) {
    const [x0, z0] = [b.x, b.z];
    stepBody(w, b, 0, speed.move, yaw, 0, speed.buttons, p, TICK_DT);
    if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) throw new Error(`in a piece at ${b.x}, ${b.y}, ${b.z}`);
    if (!b.grounded) out.air++;
    // Down a slope a body may hover by as much as it does over the ground, GROUND_PROBE, and rest() finds it sunk by SKIN.
    const gap = b.y - rest(w, p, b.x, b.z, b.y + 0.05);
    if (gap > 0.02 + 2 * SKIN) out.high++;
    out.gap = Math.max(out.gap, gap);
    if (t >= 30 && Math.hypot(b.x - x0, b.z - z0) < pace * 0.5) out.slow++;
    out.land = Math.max(out.land, stepOut.landSpeed);
  }
  if (!done(b)) out.slow += 1000;
  return out;
}

const WALKED = ["ramp", "rubble", "stairs", "stairs_solid", "slab30", "roof"];

test("every species walks up and down every sloped piece it can stand on at every speed up to a sprint: on its feet and on the surface every tick, and never slowed", () => {
  const wrong: string[] = [];
  for (const name of WALKED) {
    const w = world();
    const k = kind(slopeKind(name));
    piece(w, name);
    const half = reg.halfZ[k]!;
    for (const id of WALKERS) {
      const p = move(id);
      for (const speed of SPEEDS) {
        // A dodo at a crawl takes too long to be worth the wait.
        if (p.walkSpeed * (speed.move / 127) < 0.3) continue;
        // From the ground before the foot to near the top, then from there back down to the ground.
        const ticks = courseTicks(p, speed, 2 * half - 0.1);
        const up = walk(w, p, bodyAt(w, p, 64, 64 - half - p.radius - 0.3, 0), 0, speed, (b) => b.z > 64 + half - p.radius - 0.4, ticks);
        const down = walk(w, p, bodyAt(w, p, 64, 64 + half - p.radius - 0.5, 180), 180, speed, (b) => b.z < 64 - half - p.radius - 0.4, ticks);
        for (const [way, r] of [["up", up], ["down", down]] as const) {
          if (r.air || r.high || r.slow) wrong.push(`${id} ${way} ${name} ${speed.said}: ${r.air} ticks off its feet, ${r.high} above the surface (most ${r.gap.toFixed(4)}), ${r.slow} slowed`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("ground creatures keep authored surface speed on actual ramp faces in both directions", () => {
  for (const [name, gradient] of [["rubble", 1.5 / 4], ["stairs_solid", 3 / 3.6], ["slab30", Math.tan(Math.PI / 6)]] as const) {
    const w = world();
    piece(w, name);
    const horizontalFraction = 1 / Math.hypot(1, gradient);
    for (const id of WALKERS) {
      const p = move(id);
      if (p.lowStance || p.flies) continue;
      for (const speed of SPEEDS) for (const deg of [0, 180]) {
        const b = bodyAt(w, p, 64, 64, deg);
        const pace = p.walkSpeed * (speed.move / 127) * (speed.buttons & BTN_SPRINT ? p.sprintMul : 1);
        for (let tick = 0; tick < 3; tick++) stepBody(w, b, 0, 0, b.yaw, 0, 0, p, TICK_DT);
        // Start at steady speed, well inside the real face. Geometry supplies the vertical displacement: this does not
        // ask the footing helper for its normal or use its result to calculate the expected speed.
        b.vz = (deg === 0 ? 1 : -1) * pace * horizontalFraction;
        b.stamina = b.staminaMax * 1000;
        for (let tick = 0; tick < 3; tick++) {
          const { x, y, z } = b;
          stepBody(w, b, 0, speed.move, b.yaw, 0, speed.buttons, p, TICK_DT);
          expect(b.grounded).toBe(true);
          expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
          const horizontal = Math.hypot(b.x - x, b.z - z);
          expect(horizontal / horizontalFraction / TICK_DT).toBeCloseTo(pace, 3);
          // Following down can retain GROUND_PROBE of clearance before the capsule settles. Account for that existing
          // geometric band separately; it must not mask a slower horizontal advance or an incorrect surface pace.
          expect(Math.abs((b.y - y) - (b.z - z) * gradient)).toBeLessThan(0.02 + 2 * SKIN);
        }
      }
    }
  }
});

test("a body standing still on a sloped piece, or turning on the spot there, does not creep", () => {
  const wrong: string[] = [];
  for (const name of WALKED) {
    const w = world();
    piece(w, name);
    for (const id of WALKERS) {
      const p = move(id);
      // Halfway up, and on the roof's far side, where it falls away toward -Z.
      for (const z of [63.5, 65.2]) {
        // Set down a little sunk, as rest() finds it, it comes to rest in a tick or two and then stays.
        const b = bodyAt(w, p, 64.3, z, 0);
        for (let t = 0; t < 5; t++) stepBody(w, b, 0, 0, b.yaw, 0, 0, p, TICK_DT);
        const at = [b.x, b.y, b.z];
        for (let t = 0; t < 300; t++) stepBody(w, b, 0, 0, (t * 977) & 0xffff, 0, 0, p, TICK_DT);
        if (!b.grounded || b.x !== at[0] || b.y !== at[1] || b.z !== at[2]) wrong.push(`${id} on ${name} at z ${z}: moved from ${at.join(", ")} to ${b.x}, ${b.y}, ${b.z}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

/**
 * Walks every species at every speed along X = 64 from z0 to past z1, and back, each way also at the headings given off it,
 * crossing X = 64 halfway, and lists each time it left its feet, rose off the surface or was slowed on the way.
 */
function across(w: TestWorld, what: string, z0: number, z1: number, headings: readonly number[], wrong: string[] = []): string[] {
  for (const id of WALKERS) {
    const p = move(id);
    for (const speed of SPEEDS) {
      const pace = p.walkSpeed * (speed.move / 127) * TICK_DT;
      if (pace < 0.3 * TICK_DT) continue;
      for (const turn of [0, ...headings]) {
        const slant = Math.tan((turn * Math.PI) / 180);
        const ticks = courseTicks(p, speed, (z1 - z0) / Math.cos((turn * Math.PI) / 180));
        const there = walk(w, p, bodyAt(w, p, 64 - (slant * (z1 - z0)) / 2, z0, turn), turn, speed, (b) => b.z > z1, ticks);
        const back = walk(w, p, bodyAt(w, p, there.b.x, there.b.z, 180 + turn), 180 + turn, speed, (b) => b.z < z0, ticks);
        for (const [way, r] of [["there", there], ["back", back]] as const) {
          if (r.air || r.high || r.slow) wrong.push(`${what}, ${id} ${way} at ${turn} degrees ${speed.said}: ${r.air} ticks off its feet, ${r.high} above the surface (most ${r.gap.toFixed(4)}), ${r.slow} slowed`);
        }
      }
    }
  }
  return wrong;
}

test("from a floor onto a ramp and off its top onto a deck, and back, straight and slantwise, at every speed: never caught on the seams", () => {
  const w = world();
  // A floor half a metre up, the rubble's foot on it, and a deck level with its top.
  w.structs.add(kind("core:slab"), 64, 0.25, 60, 0, 0, 1);
  piece(w, "rubble", 64, 64, 0.5);
  w.structs.add(kind("core:slab"), 64, 1.75, 70, 0, 0, 1);
  expect(across(w, "floor, ramp and deck", 59, 68.5, [15, -15])).toEqual([]);
});

test("from the ground onto a ramp and up a steeper ramp from its top, and two ramps of one slope end to end: never caught on the seams", () => {
  const wrong: string[] = [];
  // Rubble rising 1.5 m over 4 m, then a solid flight rising 3 m over 3.6 m from its top edge, then a deck.
  const steeper = world();
  piece(steeper, "rubble", 64, 64);
  piece(steeper, "stairs_solid", 64, 66 + 1.8, 1.5);
  steeper.structs.add(kind("core:slab"), 64, 4.25, 73.6, 0, 0, 1);
  across(steeper, "rubble then a flight", 60, 71, [12], wrong);
  // Two heaps of rubble, the second's foot on the first's top edge.
  const twice = world();
  piece(twice, "rubble", 64, 64);
  piece(twice, "rubble", 64, 68, 1.5);
  twice.structs.add(kind("core:slab"), 64, 2.75, 74, 0, 0, 1);
  across(twice, "rubble then rubble", 60, 71, [12], wrong);
  expect(wrong).toEqual([]);
});

test("up and down a ramp along the wall beside it, pressed into the wall and across the seam between two of its boxes: never caught", () => {
  const w = world();
  piece(w, "ramp");
  // Two walls end to end along the ramp's +X side, their join at z = 64.
  for (const z of [62.5, 65.5]) w.structs.add(kind("core:wall"), 66.1, 1.5, z, 16384, 0, 1);
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = move(id);
    const x = 66 - p.radius - 0.01;
    for (const speed of SPEEDS) {
      if (p.walkSpeed * (speed.move / 127) < 0.3) continue;
      // Straight up beside the wall from just past the ramp's foot, and into it at 20 degrees, and back down. The step at the
      // foot is a box's step, and tests/unit/step.test.ts walks those.
      for (const turn of [0, 20]) {
        const up = walk(w, p, bodyAt(w, p, x, 61.3, turn), turn, speed, (b) => b.z > 66.4 - p.radius);
        const down = walk(w, p, bodyAt(w, p, up.b.x, up.b.z, 180 - turn), 180 - turn, speed, (b) => b.z < 61.3);
        for (const [way, r] of [["up", up], ["down", down]] as const) {
          if (r.air || r.high || r.slow) wrong.push(`${id} ${way} at ${turn} degrees ${speed.said}: ${r.air} ticks off its feet, ${r.high} above the surface (most ${r.gap.toFixed(4)}), ${r.slow} slowed`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("a face too steep to stand on is a wall to every species at every speed and heading: it is not pushed up it nor steps onto it", () => {
  const wrong: string[] = [];
  const w = world();
  piece(w, "slab60");
  for (const id of WALKERS) {
    const p = move(id);
    for (const speed of SPEEDS) {
      for (const turn of [-30, 0, 30]) {
        const a = (turn * Math.PI) / 180;
        const from = 3 + p.radius;
        const b = bodyAt(w, p, 64 - Math.sin(a) * from, 64 - Math.cos(a) * from, turn);
        let high = 0;
        walk(w, p, b, turn, speed, (body) => ((high = Math.max(high, body.y)), false), 120);
        if (high > p.stepUp) wrong.push(`${id} at ${turn} degrees ${speed.said}: up ${high.toFixed(3)} m`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("a body on a face too steep to stand on slides down it as one that falls: never on its feet there, and it cannot jump up it", () => {
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = move(id);
    const w = world();
    const k = kind("test:long60");
    w.structs.add(k, 64, reg.halfY[k]!, 64, 0, 0, 1);
    // Set on the face's middle, pressing up it with jump held all the way down. A flyer's jump takes it off, so it walks.
    const b = new Body();
    [b.x, b.z] = [64, 64];
    b.y = rest(w, p, 64, 64) + 0.01;
    let ticks = 0;
    for (let t = 0; t < 300 && b.y > 0.05; t++, ticks++) {
      const was = b.y;
      stepBody(w, b, 0, 127, 0, 0, p.flies ? 0 : BTN_JUMP, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the slab at tick ${t}`);
      if (b.grounded && b.y > 0.05) wrong.push(`${id} on its feet ${b.y.toFixed(3)} m up the face at tick ${t}`);
      if (b.y > was || b.vy > 0) wrong.push(`${id} went up the face at tick ${t}`);
    }
    if (!(b.y <= 0.05) || ticks < 10) wrong.push(`${id} did not slide to the ground: ${b.y} after ${ticks} ticks`);
  }
  expect(wrong).toEqual([]);
});

/** Two slabs at 60 degrees leaning toward each other `up` metres off the ground, their faces making a notch along X. */
function notch(up: number): { w: TestWorld; z: number } {
  const w = world();
  const k = kind(slopeKind("slab60"));
  const gap = 0.3;
  piece(w, "slab60", 64, 64, up);
  piece(w, "slab60", 64, 64 - 2 * reg.halfZ[k]! + gap, up, 32768);
  return { w, z: 64 - reg.halfZ[k]! + gap / 2 };
}

test("a body dropped into a notch between two faces too steep to stand on is held there: it banks no speed, stands, jumps, and walks out along it", () => {
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = move(id);
    const { w, z } = notch(3);
    const b = new Body();
    [b.x, b.z, b.y] = [64, z, 6];
    // Held there for twenty seconds, nothing it lands with at any tick is more than a tick's gravity.
    let land = 0;
    for (let t = 0; t < 600; t++) {
      stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
      if (t > 60) land = Math.max(land, stepOut.landSpeed);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in a slab at tick ${t}`);
    }
    const held = b.y;
    if (!b.grounded || b.vy !== 0 || land > G * TICK_DT + 1e-6 || !(held > 3)) wrong.push(`${id} in the notch: grounded ${b.grounded}, vy ${b.vy}, landed at ${land}, ${held} up`);
    // It may jump, and comes back down into the notch no faster than the jump took it up.
    stepBody(w, b, 0, 0, 0, 0, BTN_JUMP, p, TICK_DT);
    if (!(b.vy > 0)) wrong.push(`${id} could not jump from the notch`);
    land = 0;
    for (let t = 0; t < 90; t++) {
      stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
      land = Math.max(land, stepOut.landSpeed);
    }
    if (!b.grounded || Math.abs(b.y - held) > 0.01 || land > p.jumpSpeed) wrong.push(`${id} back in the notch: ${b.y} against ${held}, landed at ${land}`);
    // Out along the notch and off its end, it lands as fast as that drop makes it, and no faster.
    const out = walk(w, p, b, 90, SPEEDS[2], (body) => body.x > 70 && body.grounded, 600);
    const drop = held - out.b.y;
    if (out.land > Math.sqrt(2 * G * drop) + G * TICK_DT) wrong.push(`${id} out of the notch landed at ${out.land.toFixed(2)} m/s from ${drop.toFixed(2)} m`);
  }
  expect(wrong).toEqual([]);
});

test("a body riding a long slab too steep to stand on down to its foot lands no faster than the drop would land it", () => {
  const wrong: string[] = [];
  for (const id of WALKERS) {
    const p = move(id);
    const w = world();
    const k = kind("test:long60");
    w.structs.add(k, 64, reg.halfY[k]!, 64, 0, 0, 1);
    // Set on the face near its top, and let go.
    const b = new Body();
    [b.x, b.z] = [64, 64 + reg.halfZ[k]! - 1.5];
    b.y = rest(w, p, b.x, b.z) + 0.01;
    const from = b.y;
    let land = 0;
    for (let t = 0; t < 300; t++) {
      stepBody(w, b, 0, 0, 0, 0, 0, p, TICK_DT);
      land = Math.max(land, stepOut.landSpeed);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)) wrong.push(`${id} in the slab at tick ${t}`);
    }
    const drop = from - b.y;
    if (!(drop > 10) || !b.grounded || land > Math.sqrt(2 * G * drop)) wrong.push(`${id} rode ${drop.toFixed(2)} m down and landed at ${land.toFixed(2)} m/s, where the drop lands at ${Math.sqrt(2 * G * drop).toFixed(2)}`);
  }
  expect(wrong).toEqual([]);
});

test("a body too fast for its step down follows a ramp down onto a walkable sloped part, and still drops off a ledge", () => {
  const p = move("core:survivor");
  const w = world();
  piece(w, "stairs");
  // At two and a half times a survivor's speed, sprinting, it goes 0.6 m a tick and the flight falls 0.44 m under that.
  const b = bodyAt(w, p, 64, 64 + 2.75 - 0.6, 180);
  b.speedQ = 2500;
  const down = walk(w, p, b, 180, SPEEDS[3], (body) => body.z < 64 - 2.75 + 0.6);
  expect([down.air, down.high, down.slow]).toEqual([0, 0, 0]);
  expect(0.6 * Math.tan((36 * Math.PI) / 180)).toBeGreaterThan(p.stepDown);
  // Off the end of a block 0.6 m high, it leaves its feet.
  const ledge = world();
  ledge.structs.add(kind("core:block"), 64, -0.4, 64, 0, 0, 1);
  const c = bodyAt(ledge, p, 64, 64.5, 0);
  c.speedQ = 2500;
  const off = walk(ledge, p, c, 0, SPEEDS[3], (body) => body.z > 67);
  expect(off.air).toBeGreaterThan(0);
});

test("a tame walks up a heap of 47 degrees that stops a survivor and a wild creature of its species, as ARK's tamed and wild slopes differ", () => {
  const w = world();
  const k = kind("test:heap47");
  w.structs.add(k, 64, reg.halfY[k]!, 64, 0, 0, 1);
  const wrong: string[] = [];
  for (const id of WALKERS) {
    for (const tamed of [false, true]) {
      const p = (tamed ? reg.tamedMove : reg.move)[kind(id)]!;
      if (tamed && p === reg.move[kind(id)]) continue;
      for (const speed of SPEEDS) {
        if (p.walkSpeed * (speed.move / 127) < 0.3) continue;
        let high = 0;
        const b = bodyAt(w, p, 64, 62.5 - p.radius - 0.3, 0);
        walk(w, p, b, 0, speed, (body) => ((high = Math.max(high, body.y)), body.z > 64.5), 600);
        if (tamed ? high < 2 : high > p.stepUp) wrong.push(`${tamed ? "tamed" : "wild"} ${id} ${speed.said}: up ${high.toFixed(3)} m`);
      }
    }
  }
  expect(wrong).toEqual([]);
  expect([reg.move[kind("core:survivor")]!.slopeCos, reg.tamedMove[kind("core:survivor")]!.slopeCos, reg.move[kind("core:raptor")]!.slopeCos, reg.tamedMove[kind("core:raptor")]!.slopeCos]).toEqual([0.71, 0.71, 0.71, 0.6]);
});
