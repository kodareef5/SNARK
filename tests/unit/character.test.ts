import { expect, test } from "bun:test";
import { TICK_DT } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { WORLD_MAX_Y } from "../../shared/coords.ts";
import { BTN_BRAKE, BTN_CROUCH, BTN_JUMP, BTN_PRONE, BTN_ROLL, BTN_SPRINT, Body, MF_NO_JUMP, MF_NO_SPRINT, MF_OUT, MF_ROOTED, MF_WINDED, MODE_FLY, MODE_FLYER, MODE_GHOST, MODE_SWIM, MODE_WALK, STAMINA_UNITS, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND, stanceEye, stanceHeight, stepBody, stepOut, type MoveParams } from "../../shared/sim/character.ts";
import { SKIN, capsuleFree } from "../../shared/world/collide.ts";
import { SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0 } from "../../shared/world/proving.ts";
import { slopeKind } from "../../content/slopes.ts";
import { flatWorld, provingWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
const NORTH = 0; // yaw 0 faces +Z

function survivor(w: TestWorld): MoveParams {
  return w.reg.move[w.kind("core:survivor")]!;
}

function bodyAt(w: TestWorld, x: number, z: number): Body {
  const b = new Body();
  b.x = x;
  b.z = z;
  b.y = w.hf.heightAt(x, z);
  b.grounded = true;
  return b;
}

function run(w: TestWorld, b: Body, ticks: number, moveX: number, moveZ: number, yaw: number, buttons = 0): void {
  const p = survivor(w);
  for (let i = 0; i < ticks; i++) stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
}

test("walks forward at walk speed and strafes to its right", () => {
  const w = flatWorld();
  const b = bodyAt(w, 64, 20);
  run(w, b, 60, 0, FWD, NORTH);
  expect(b.z - 20).toBeGreaterThan(8.5);
  expect(b.z - 20).toBeLessThan(9.01);
  expect(b.x).toBe(64);
  expect(b.y).toBe(0);
  expect(b.grounded).toBe(true);
  run(w, b, 30, FWD, 0, NORTH);
  expect(b.x).toBeLessThan(62); // facing +Z, right is -X
});

test("stops at a wall and rests against it", () => {
  const w = flatWorld();
  w.structs.add(w.kind("core:wall"), 64, 1.5, 30, 0, 0, 1);
  const b = bodyAt(w, 64, 20);
  run(w, b, 200, 0, FWD, NORTH, BTN_SPRINT);
  const face = 30 - 0.1 - 0.4;
  expect(b.z).toBeLessThanOrEqual(face + SKIN);
  expect(b.z).toBeGreaterThan(face - 0.01);
});

test("jump reaches the expected height and lands", () => {
  const w = flatWorld();
  const b = bodyAt(w, 64, 64);
  let apex = 0;
  const p = survivor(w);
  for (let i = 0; i < 60; i++) {
    stepBody(w, b, 0, 0, 0, 0, i === 0 ? BTN_JUMP : 0, p, TICK_DT);
    apex = Math.max(apex, b.y);
  }
  expect(apex).toBeGreaterThan(1.05); // v^2 / 2g = 1.225 m, less the discrete step
  expect(apex).toBeLessThan(1.23);
  expect(b.y).toBeCloseTo(0, 5);
  expect(b.grounded).toBe(true);
});

test("jumps onto a 1 m ledge and stands on it steadily", () => {
  const w = flatWorld();
  w.structs.add(w.kind("core:slab"), 64, 0.75, 27, 0, 0, 1); // top at 1 m, near face at z = 23
  const b = bodyAt(w, 64, 20);
  const p = survivor(w);
  run(w, b, 22, 0, FWD, NORTH);
  expect(b.z).toBeLessThan(22.61); // too tall to step onto
  for (let i = 0; i < 30; i++) stepBody(w, b, 0, FWD, NORTH, 0, i === 0 ? BTN_JUMP : 0, p, TICK_DT);
  let groundedTicks = 0;
  for (let i = 0; i < 90; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, 0, p, TICK_DT);
    if (b.grounded) groundedTicks++;
    expect(Math.abs(b.y - 1)).toBeLessThan(0.021);
  }
  expect(groundedTicks).toBe(90);
  stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect(b.vy).toBeGreaterThan(5); // can jump again from the ledge
});

test("climbs walkable slopes and is stopped by steep ones", () => {
  const w = provingWorld();
  const climb = (strip: number): Body => {
    const b = bodyAt(w, SLOPE_X0 + SLOPE_WIDTH * strip + 4, SLOPE_Z0 - 3);
    run(w, b, 150, 0, FWD, NORTH, BTN_SPRINT);
    return b;
  };
  for (const strip of [0, 1, 2, 3]) {
    // Strips 0 to 3 are 10 to 40 degrees.
    const b = climb(strip);
    expect(b.z).toBeGreaterThan(SLOPE_Z0 + 20);
    expect(b.y).toBeGreaterThan(3);
    expect(Math.abs(b.y - w.hf.heightAt(b.x, b.z))).toBeLessThan(0.03);
  }
  // Strip 4 is 50 degrees, past a survivor's 44.765, and strip 5 is 60.
  for (const strip of [4, 5]) {
    const steep = climb(strip);
    expect(steep.z).toBeLessThan(SLOPE_Z0 + 1);
    expect(steep.y).toBeLessThan(1.5);
  }
  // A tame stands on up to 53.13 degrees, so it climbs strip 4, which stops it wild.
  const raptor = w.kind("core:raptor");
  for (const [p, climbs] of [[w.reg.tamedMove[raptor]!, true], [w.reg.move[raptor]!, false]] as const) {
    const b = bodyAt(w, SLOPE_X0 + SLOPE_WIDTH * 4 + 4, SLOPE_Z0 - 3);
    for (let i = 0; i < 150; i++) stepBody(w, b, 0, FWD, NORTH, 0, BTN_SPRINT, p, TICK_DT);
    expect(b.z > SLOPE_Z0 + 10).toBe(climbs);
  }
});

test("walks up the staircase onto the slab", () => {
  const w = provingWorld();
  const b = bodyAt(w, 263, 273);
  run(w, b, 150, 0, FWD, NORTH);
  expect(b.y).toBeGreaterThan(3.55);
  expect(b.y).toBeLessThan(3.65);
  expect(b.grounded).toBe(true);
});

test("fuzz: no input sequence leaves a sealed room or enters solid space", () => {
  const w = flatWorld();
  const room = sealedRoom(w, 64, 64);
  const p = survivor(w);
  const rng = new Rng(2026);
  const b = bodyAt(w, 64, 64);
  let moveX = 0;
  let moveZ = 0;
  let yaw = 0;
  let buttons = 0;
  for (let i = 0; i < 30000; i++) {
    if (rng.int(12) === 0) {
      // Out of range on purpose. A hostile client is not limited to the UI.
      moveX = rng.int(513) - 256;
      moveZ = rng.int(513) - 256;
      yaw = rng.int(65536);
      // Every button, the stance ones included. Getting up and down must not open a way out.
      buttons = rng.int(1024);
    }
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    const height = stanceHeight(p, b.stance);
    const inside = b.x > room.minX && b.x < room.maxX && b.z > room.minZ && b.z < room.maxZ && b.y >= -SKIN && b.y + height < room.maxY + SKIN;
    if (!inside || !capsuleFree(w, b.x, b.y, b.z, p.radius, height)) {
      throw new Error(`escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
    }
  }
});

test("fuzz: among sloped pieces in a closed room no body of any species leaves it or enters a piece", () => {
  const w = flatWorld();
  const add = (id: string, x: number, base: number, z: number, yaw = 0): number => w.structs.add(w.kind(id), x, base + w.reg.halfY[w.kind(id)]!, z, yaw, 0, 1);
  // Walls two high round an 18 m square from (55, 55), and a roof over it.
  for (let i = 0; i < 6; i++) {
    for (const y of [0, 3]) {
      add("core:wall", 56.5 + 3 * i, y, 55);
      add("core:wall", 56.5 + 3 * i, y, 73);
      add("core:wall", 55, y, 56.5 + 3 * i, 16384);
      add("core:wall", 73, y, 56.5 + 3 * i, 16384);
    }
  }
  for (const x of [59, 67, 69]) for (const z of [59, 67, 69]) add("core:slab", x, 6, z);
  // The thin edge of a wedge on the ground; the same with a crack of 3 cm under its foot, turned; a flight open below; a
  // solid flight at an odd turn; and a slab at 60 degrees leaning against the north wall.
  add(slopeKind("rubble"), 60, 0, 60);
  add(slopeKind("rubble"), 68, 0.03, 60, 16384);
  add(slopeKind("stairs"), 59.5, 0, 67.5, 32768);
  add(slopeKind("stairs_solid"), 65, 0, 66, 5000);
  add(slopeKind("slab60"), 69, 0, 72.9 - w.reg.halfZ[w.kind(slopeKind("slab60"))]!);
  const walkers = w.reg.defs.flatMap((d) => (d?.type === "species" && !d.still ? [d.id] : []));
  for (const seed of [5, 6, 7, 8, 9, 10, 11, 12]) {
    const rng = new Rng(seed);
    for (const id of walkers) {
      const p = w.reg.move[w.kind(id)]!;
      const b = new Body();
      do {
        b.x = rng.range(56, 72);
        b.z = rng.range(56, 72);
      } while (!capsuleFree(w, b.x, 0, b.z, p.radius, p.height));
      b.grounded = true;
      let [moveX, moveZ, yaw, buttons] = [0, 127, rng.int(65536), 0];
      for (let i = 0; i < 5000; i++) {
        if (rng.int(15) === 0) [moveX, moveZ, yaw, buttons] = [rng.int(255) - 127, rng.int(255) - 127, rng.int(65536), rng.int(4) | (rng.int(6) === 0 ? BTN_CROUCH : 0) | (rng.int(9) === 0 ? BTN_PRONE : 0)];
        stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
        const height = stanceHeight(p, b.stance);
        if (!capsuleFree(w, b.x, b.y, b.z, p.radius, height)) throw new Error(`${id} in solid at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
        if (b.x < 55.1 || b.x > 72.9 || b.z < 55.1 || b.z > 72.9 || b.y < -SKIN || b.y + height > 6 + SKIN) throw new Error(`${id} out of the room at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
      }
    }
  }
});

test("fuzz: bodies roaming the proving ground are always in free space", () => {
  const w = provingWorld();
  const p = survivor(w);
  const spawns: [number, number][] = [[256, 240], [239, 268], [285, 280], [263, 274], [252, 305], [248, 260], [220, 286], [300, 258]];
  // Several seeds, because one found a body a micrometre past the tolerance on a 40 degree slope.
  for (const seed of [77, 78, 79, 80]) {
  const rng = new Rng(seed);
  for (const [sx, sz] of spawns) {
    const b = bodyAt(w, sx, sz);
    expect(capsuleFree(w, b.x, b.y, b.z, p.radius, p.height)).toBe(true);
    let moveX = 0;
    let moveZ = FWD;
    let yaw = rng.int(65536);
    let buttons = 0;
    for (let i = 0; i < 4000; i++) {
      if (rng.int(20) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = rng.int(4) | (rng.int(5) === 0 ? BTN_CROUCH : 0) | (rng.int(9) === 0 ? BTN_PRONE : 0);
      }
      const px = b.x;
      const pz = b.z;
      stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) throw new Error(`in solid at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
      // Sprint speed is 7.2 m/s, 0.24 m per tick. Nothing may move a body faster horizontally.
      expect(Math.hypot(b.x - px, b.z - pz)).toBeLessThan(0.3);
    }
  }
  }
});

test("the 0.2 m wall cannot be crossed from any angle", () => {
  const w = provingWorld();
  const p = survivor(w);
  const rng = new Rng(404);
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = bodyAt(w, rng.range(279, 298), rng.range(256, 260));
    const yaw = (rng.int(12000) - 6000) & 0xffff; // roughly northward
    for (let i = 0; i < 120; i++) {
      stepBody(w, b, rng.int(255) - 127, FWD, yaw, 0, BTN_SPRINT | (rng.int(3) === 0 ? BTN_JUMP : 0), p, TICK_DT);
      // The wall spans x 276 to 300. Going round either end is legal. Being level with it between them is not.
      if (b.x > 276 && b.x < 300) expect(b.z).toBeLessThan(261.5 + SKIN);
    }
  }
});

test("crouching and lying prone shorten the body and slow it; it rises only where there is room", () => {
  const w = flatWorld();
  const p = survivor(w);
  expect([stanceHeight(p, STANCE_STAND), stanceHeight(p, STANCE_CROUCH), stanceHeight(p, STANCE_PRONE)].map((v) => +v.toFixed(3))).toEqual([1.8, 1.2, 0.8]);
  expect(stanceEye(p, STANCE_STAND)).toBe(1.62);
  expect(stanceEye(p, STANCE_CROUCH)).toBeCloseTo(1.08, 5);
  expect(stanceEye(p, STANCE_PRONE)).toBeCloseTo(0.36, 5);

  // The ceiling's underside is 1.4 m up, too low to stand under and high enough to crouch.
  const ceiling = w.kind("core:ceiling");
  w.structs.add(ceiling, 64, 1.5, 30, 0, 0, 1);
  const b = bodyAt(w, 64, 24);
  run(w, b, 120, 0, FWD, NORTH);
  expect(b.z).toBeLessThan(28.2); // standing, it is stopped at the edge
  const z0 = b.z;
  run(w, b, 30, 0, FWD, NORTH, BTN_CROUCH);
  expect(b.stance).toBe(STANCE_CROUCH);
  // Half the walking speed, 2.25 m in a second, give or take the step it was held short by.
  expect(b.z - z0).toBeGreaterThan(2.0);
  expect(b.z - z0).toBeLessThan(2.4);
  // Under the ceiling it stays crouched with the key released, and jumping and sprinting do nothing more.
  run(w, b, 10, 0, 0, NORTH, BTN_CROUCH);
  expect(b.z).toBeGreaterThan(28.6);
  expect(b.z).toBeLessThan(31.4);
  run(w, b, 20, 0, 0, NORTH);
  expect(b.stance).toBe(STANCE_CROUCH);
  run(w, b, 5, 0, 0, NORTH, BTN_JUMP | BTN_CROUCH);
  expect(b.y).toBe(0);
  const z1 = b.z;
  run(w, b, 10, 0, FWD, NORTH, BTN_CROUCH | BTN_SPRINT);
  expect(b.z - z1).toBeLessThan(0.76);
  run(w, b, 200, 0, FWD, NORTH);
  expect(b.z).toBeGreaterThan(32);
  expect(b.stance).toBe(STANCE_STAND);

  // The first ceiling is 1.0 m up, so only prone fits. The second is 1.4 m up.
  w.structs.add(ceiling, 80, 1.1, 30, 0, 0, 1);
  w.structs.add(ceiling, 80, 1.5, 33, 0, 0, 1);
  const c = bodyAt(w, 80, 27.5);
  run(w, c, 60, 0, FWD, NORTH, BTN_CROUCH);
  expect(c.z).toBeLessThan(28.2);
  const z2 = c.z;
  run(w, c, 60, 0, FWD, NORTH, BTN_PRONE);
  expect(c.stance).toBe(STANCE_PRONE);
  // A fifth of the walking speed is 0.9 m/s, so 1.8 m in two seconds.
  expect(c.z - z2).toBeGreaterThan(1.6);
  expect(c.z - z2).toBeLessThan(1.95);
  run(w, c, 30, 0, 0, NORTH);
  expect(c.stance).toBe(STANCE_PRONE);
  run(w, c, 110, 0, FWD, NORTH, BTN_PRONE);
  expect(c.z).toBeGreaterThan(32.2);
  expect(c.z).toBeLessThan(33.8);
  run(w, c, 2, 0, 0, NORTH);
  expect(c.stance).toBe(STANCE_CROUCH);
  run(w, c, 200, 0, FWD, NORTH);
  expect(c.stance).toBe(STANCE_STAND);

  // Going down is immediate, even in the air. A swimmer has no stance.
  const d = bodyAt(w, 100, 100);
  stepBody(w, d, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  stepBody(w, d, 0, 0, NORTH, 0, BTN_PRONE, p, TICK_DT);
  expect(d.stance).toBe(STANCE_PRONE);
  expect(d.y).toBeGreaterThan(0.2);
  const pool = provingWorld();
  const e = bodyAt(pool, 178, 256);
  e.y = -4;
  e.mode = MODE_SWIM;
  e.grounded = false;
  e.stance = STANCE_CROUCH;
  stepBody(pool, e, 0, 0, NORTH, 0, BTN_PRONE, survivor(pool), TICK_DT);
  expect(e.mode).toBe(MODE_SWIM);
  expect(e.stance).toBe(STANCE_STAND);
});

test("a body with a turn rate comes round to where it is asked to look at that rate, by the short way, and goes where it faces", () => {
  const w = flatWorld();
  // 90 degrees a second, rounded to whole yaw units per tick as the registry does.
  const rate = Math.round(65536 / 4 / 30);
  const p: MoveParams = { ...survivor(w), turnRate: rate, strafe: false };
  const b = bodyAt(w, 64, 64);
  const step = (ticks: number, moveX: number, moveZ: number, yaw: number): void => {
    for (let i = 0; i < ticks; i++) stepBody(w, b, moveX, moveZ, yaw, 0, 0, p, TICK_DT);
  };
  step(1, 0, 0, 16384);
  expect(b.yaw).toBe(rate);
  step(14, 0, 0, 16384);
  expect(b.yaw).toBe(rate * 15);
  step(30, 0, 0, 16384);
  expect(b.yaw).toBe(16384);
  step(3, 0, 0, 65536 - 10000);
  expect(b.yaw).toBe(16384 - rate * 3);
  b.yaw = 100;
  step(1, 0, 0, 65436);
  expect(b.yaw).toBe(65436);
  b.yaw = 0;
  step(30, 127, 0, 0);
  expect([b.x, b.z]).toEqual([64, 64]);
  step(1, 0, FWD, 30000);
  expect(b.vz).toBeGreaterThan(0);
  expect(b.yaw).toBe(rate);
  // A survivor has no turn rate and faces where it looks at once. So does any body in ghost mode.
  const s = bodyAt(w, 64, 64);
  stepBody(w, s, 0, 0, 40000, 0, 0, survivor(w), TICK_DT);
  expect(s.yaw).toBe(40000);
  expect(survivor(w).turnRate).toBe(0);
  expect(survivor(w).strafe).toBe(true);
  b.mode = MODE_GHOST;
  step(1, 0, 0, 50000);
  expect(b.yaw).toBe(50000);
});

test("a ghost or a flyer holding sprint starts at five times its speed, gains 150 m/s a second to 600 and no more, and lets go back to 12 at once", () => {
  const w = flatWorld(16);
  const p = survivor(w);
  for (const mode of [MODE_GHOST, MODE_FLY]) {
    const b = bodyAt(w, 512, 512);
    b.y = 40;
    b.mode = mode;
    const speed = (): number => Math.hypot(b.vx, b.vy, b.vz);
    const speeds: number[] = [];
    // Round and round, level, with nothing in the way: turning keeps the speed.
    for (let t = 0; t < 150; t++) {
      stepBody(w, b, 0, FWD, (t * 512) & 0xffff, 0, BTN_SPRINT, p, TICK_DT);
      speeds.push(speed());
    }
    expect(speeds[0]).toBeCloseTo(60, 3);
    expect(speeds[30]).toBeCloseTo(60 + 150, 2);
    expect(speeds.findIndex((v) => v > 599.99)).toBe(108);
    expect(Math.max(...speeds)).toBeLessThan(600.001);
    // Rising as it goes is no faster.
    stepBody(w, b, 0, FWD, 0, 0, BTN_SPRINT | BTN_JUMP, p, TICK_DT);
    expect(speed()).toBeLessThan(600.001);
    stepBody(w, b, 0, FWD, 0, 0, 0, p, TICK_DT);
    expect(speed()).toBeCloseTo(12, 4);
    // Stopping, it starts again from five times its speed.
    stepBody(w, b, 0, 0, 0, 0, BTN_SPRINT, p, TICK_DT);
    stepBody(w, b, 0, FWD, 0, 0, BTN_SPRINT, p, TICK_DT);
    expect([mode, speed()]).toEqual([mode, expect.closeTo(60, 3)]);
  }
});

// A creature's own flight (planning/reference/flyers-plan.md, FL1) at ARK's 1x numbers for the pteranodon
// (assets/source/core/creatures/pteranodon/ref/FUNCTIONS.md, sections 3 and 4).

const PTERA = "core:pteranodon";
/** A pitch straight up. */
const UP = 16384;

function ptera(w: TestWorld, tamed = false): MoveParams {
  return (tamed ? w.reg.tamedMove : w.reg.move)[w.kind(PTERA)]!;
}

/** A pteranodon of level 1 standing at (x, z), its stamina full. */
function flyerAt(w: TestWorld, x: number, z: number): Body {
  const b = bodyAt(w, x, z);
  b.kind = w.kind(PTERA);
  b.staminaMax = 150;
  b.stamina = 150 * STAMINA_UNITS;
  return b;
}

/** One already hovering `up` metres over the ground at (x, z). */
function hovering(w: TestWorld, x: number, z: number, up: number): Body {
  const b = flyerAt(w, x, z);
  b.y += up;
  b.grounded = false;
  b.mode = MODE_FLYER;
  return b;
}

const speedOf = (b: Body): number => Math.hypot(b.vx, b.vy, b.vz);

test("a pteranodon takes off on its jump held and hovers a few feet up; winded, too heavy, rooted or out it does not, and it never hops", () => {
  const w = flatWorld();
  const p = ptera(w);
  const b = flyerAt(w, 64, 64);
  let took = 0;
  let top = 0;
  for (let i = 0; i < 90; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
    if (stepOut.tookOff) took++;
    top = Math.max(top, b.y);
  }
  expect([took, b.mode, b.grounded]).toEqual([1, MODE_FLYER, false]);
  // It rises about 1.5 m and hangs there still: "launch and hover a few feet above ground".
  expect([top > 1.2, top < 1.6, b.y, speedOf(b)]).toEqual([true, true, top, 0]);
  for (const flags of [MF_WINDED, MF_NO_JUMP | MF_ROOTED | MF_NO_SPRINT, MF_ROOTED | MF_NO_SPRINT, MF_OUT]) {
    const g = flyerAt(w, 64, 64);
    g.mflags = flags;
    // Set down spent, it waits for any stamina.
    if (flags === MF_WINDED) [g.stamina, g.regenWait] = [0, 300];
    let high = 0;
    for (let i = 0; i < 60; i++) {
      stepBody(w, g, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
      high = Math.max(high, g.y);
    }
    expect([flags, g.mode, high]).toEqual([flags, MODE_WALK, 0]);
  }
  // Falling, as when a bola lets go of it in the air, it flies on from its fall, slowing it at its acceleration.
  const f = flyerAt(w, 64, 64);
  [f.y, f.vy, f.grounded] = [40, -20, false];
  stepBody(w, f, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect([stepOut.tookOff, f.mode, f.vy]).toEqual([true, MODE_FLYER, expect.closeTo(-20 + 12 / 30, 5)]);
});

test("it flies where it looks at 6 m/s, sprints at 16.5 wild and 18.975 tamed, climbs and dives by the look alone, and with no way forward slows to a hover", () => {
  const w = flatWorld(16);
  for (const [tamed, sprint] of [[false, 16.5], [true, 18.975]] as const) {
    const p = ptera(w, tamed);
    const b = hovering(w, 512, 100, 40);
    for (let i = 0; i < 60; i++) stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP, p, TICK_DT);
    expect([speedOf(b), b.vx, b.vy]).toEqual([expect.closeTo(6, 4), 0, 0]);
    for (let i = 0; i < 60; i++) stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    expect(speedOf(b)).toBeCloseTo(sprint, 3);
    // Looking 30 degrees up it climbs at 30 degrees, and looking 30 degrees down it dives so: there is no climb key.
    for (const pitch of [UP / 3, -UP / 3]) {
      for (let i = 0; i < 60; i++) stepBody(w, b, 0, FWD, NORTH, pitch, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
      expect([Math.asin(b.vy / speedOf(b)) * (180 / Math.PI), speedOf(b)]).toEqual([expect.closeTo((pitch / UP) * 90, 3), expect.closeTo(sprint, 3)]);
    }
    // Let go of forward, it comes to a halt in the air at its acceleration, 12 m/s a second, and stays where it stopped.
    let still = -1;
    for (let i = 0; i < 90; i++) {
      stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
      if (still < 0 && speedOf(b) === 0) still = i + 1;
    }
    const y = b.y;
    for (let i = 0; i < 90; i++) stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
    expect([still, b.y, b.mode]).toEqual([Math.ceil((sprint / 12) * 30), y, MODE_FLYER]);
  }
});

test("in the air it turns at 120 degrees a second, its way lagging its facing so that it banks, and the brake stops it in a third of a second", () => {
  const w = flatWorld(16);
  const p = ptera(w);
  const b = hovering(w, 512, 100, 40);
  for (let i = 0; i < 90; i++) stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
  // 120 degrees a second is 728 of 65,536 a tick.
  expect(p.flyTurnRate).toBe(728);
  const st = new AnimState();
  st.mode = MODE_FLYER;
  const bank = (): number => {
    st.setMotion(b.vx, b.vz, (b.yaw * 2 * Math.PI) / 65536, 0, b.vy);
    return st.bank;
  };
  expect(bank()).toBe(0);
  let most = 0;
  for (let i = 0; i < 15; i++) {
    stepBody(w, b, 0, FWD, UP, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    most = Math.max(most, bank());
  }
  expect(b.yaw).toBe(15 * 728);
  // Turning left, it faces left of where it goes, and so banks left.
  expect(most).toBeGreaterThan(2);
  for (let i = 0; i < 60; i++) stepBody(w, b, 0, FWD, UP, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
  let stopped = -1;
  for (let i = 0; i < 30 && stopped < 0; i++) {
    stepBody(w, b, 0, FWD, UP, 0, BTN_JUMP | BTN_SPRINT | BTN_BRAKE, p, TICK_DT);
    if (speedOf(b) === 0) stopped = i + 1;
  }
  expect([stopped > 0, stopped <= 10, b.mode]).toEqual([true, true, MODE_FLYER]);
});

test("flying costs 0.33 a second and sprinting 6, so 150 is gone in 25 s of sprinting; none comes back in the air, and on the ground none for 10 s after it sets down", () => {
  const w = flatWorld(16);
  const p = ptera(w);
  const b = hovering(w, 512, 100, 3);
  const full = 150 * STAMINA_UNITS;
  for (let i = 0; i < 300; i++) stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect(full - b.stamina).toBe(300 * 11);
  b.stamina = full;
  let ticks = 0;
  while (b.stamina > 0 && ticks < 2000) {
    stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    ticks++;
  }
  expect([ticks, ticks / 30, b.mflags & MF_WINDED]).toEqual([750, 25, MF_WINDED]);
  // At none it is put down, sprint and jump held, and lands under it unhurt.
  let set = -1;
  for (let i = 0; i < 300 && b.mode === MODE_FLYER; i++) {
    stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    expect(stepOut.landSpeed).toBe(0);
    if (stepOut.setDown) set = i;
  }
  expect([set >= 0, b.mode, b.grounded, b.y, b.regenWait]).toEqual([true, MODE_WALK, true, 0, 300]);
  // Standing, it gets nothing back for 300 ticks, then its regeneration, 8 a second.
  const back: number[] = [];
  for (let i = 0; i < 302; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, 0, p, TICK_DT);
    back.push(b.stamina);
  }
  expect([back[299], back[300], back[301], p.staminaRegen]).toEqual([0, 267, 534, 267]);
  // Winded, it may not take off again until a quarter is back.
  for (let i = 0; i < 30; i++) stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect([b.mode, b.mflags & MF_WINDED]).toEqual([MODE_WALK, MF_WINDED]);
});

test("let go of its jump, spent or too heavy, it goes down to the ground under it and sets down unhurt; knocked out or caught by a bola, it falls and lands hard", () => {
  const w = flatWorld(16);
  const p = ptera(w);
  const cases = [
    ["let go of its jump", 0, 0],
    ["spent", MF_WINDED, BTN_JUMP],
    ["too heavy", MF_ROOTED | MF_NO_SPRINT | MF_NO_JUMP, BTN_JUMP],
    ["knocked out", MF_OUT, BTN_JUMP],
    ["caught by a bola", MF_ROOTED | MF_NO_SPRINT, BTN_JUMP],
  ] as const;
  const seen = cases.map(([name, flags, buttons]) => {
    const b = hovering(w, 512, 512, 30);
    for (let i = 0; i < 30; i++) stepBody(w, b, 0, FWD, NORTH, 0, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    b.mflags = flags;
    if (flags === MF_WINDED) b.stamina = 0;
    let hard = 0;
    let soft = 0;
    let t = 0;
    for (; t < 600 && !b.grounded; t++) {
      stepBody(w, b, 0, FWD, NORTH, 0, buttons, p, TICK_DT);
      hard = Math.max(hard, stepOut.landSpeed);
      if (stepOut.setDown) soft++;
    }
    return [name, b.mode, b.grounded, b.y, soft, Math.round(hard), t < 150];
  });
  // Falling 30 m at our gravity of 20 lands at 34.6 m/s, well past the 16 a creature takes unhurt (D385).
  expect(seen).toEqual([
    ["let go of its jump", MODE_WALK, true, 0, 1, 0, true],
    ["spent", MODE_WALK, true, 0, 1, 0, true],
    ["too heavy", MODE_WALK, true, 0, 1, 0, true],
    ["knocked out", MODE_WALK, true, 0, 0, 35, true],
    ["caught by a bola", MODE_WALK, true, 0, 0, 35, true],
  ]);
});

test("it never goes under water: it skims the surface, sets down on it to float, does not dive there, and takes off from it", () => {
  const w = flatWorld(16);
  w.hf.seaLevel = 6;
  const p = ptera(w);
  const b = hovering(w, 512, 100, 20);
  let low = Infinity;
  for (let i = 0; i < 120; i++) {
    stepBody(w, b, 0, FWD, NORTH, -UP, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
    low = Math.min(low, b.y);
  }
  expect([low, b.mode]).toEqual([6, MODE_FLYER]);
  // Going down, it settles into the water to its float line, three quarters under, and floats there.
  const float = Math.fround(6 - p.height * 0.75);
  let set = 0;
  for (let i = 0; i < 30; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, 0, p, TICK_DT);
    if (stepOut.setDown) set++;
  }
  expect([set, b.mode, b.y]).toEqual([1, MODE_SWIM, float]);
  // Afloat, looking down and swimming forward, it does not dive.
  low = Infinity;
  for (let i = 0; i < 240; i++) {
    stepBody(w, b, 0, FWD, NORTH, -UP, 0, p, TICK_DT);
    low = Math.min(low, b.y);
  }
  expect([b.mode, low, b.y]).toEqual([MODE_SWIM, float, float]);
  let took = 0;
  for (let i = 0; i < 60; i++) {
    stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
    if (stepOut.tookOff) took++;
  }
  expect([took, b.mode, b.y > 6.5]).toEqual([1, MODE_FLYER, true]);
});

test("the barrel roll: crouch in the air bursts 10 m/s along its look for 90 stamina, 7 s apart, not encumbered and not on the ground", () => {
  const w = flatWorld(16);
  const p = ptera(w);
  const b = hovering(w, 512, 100, 20);
  const rolls: number[] = [];
  for (let i = 0; i < 421; i++) {
    // Full each tick, since 150 pays for one roll.
    const before = (b.stamina = 150 * STAMINA_UNITS);
    stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP | BTN_ROLL, p, TICK_DT);
    if (stepOut.rolled) {
      rolls.push(i);
      expect([before - b.stamina, b.rollWait, speedOf(b), b.vz]).toEqual([90 * STAMINA_UNITS + 11, 210, expect.closeTo(10, 5), expect.closeTo(10, 5)]);
    }
  }
  expect(rolls).toEqual([0, 210, 420]);
  // The burst is spent at its acceleration and it hovers again.
  for (let i = 0; i < 30; i++) stepBody(w, b, 0, 0, NORTH, 0, BTN_JUMP, p, TICK_DT);
  expect(speedOf(b)).toBe(0);
  // Encumbered (MF_NO_SPRINT from 85% of its weight), short of 90, or on the ground, it does not roll.
  for (const [flags, stamina, up] of [[MF_NO_SPRINT, 150, 20], [0, 89, 20], [0, 150, 0]] as const) {
    const c = up > 0 ? hovering(w, 512, 100, up) : flyerAt(w, 512, 100);
    c.mflags = flags;
    c.stamina = stamina * STAMINA_UNITS;
    let rolled = false;
    for (let i = 0; i < 30; i++) {
      stepBody(w, c, 0, 0, NORTH, 0, (up > 0 ? BTN_JUMP : 0) | BTN_ROLL, p, TICK_DT);
      rolled ||= stepOut.rolled;
    }
    expect([flags, stamina, up, rolled, c.stance]).toEqual([flags, stamina, up, false, STANCE_STAND]);
  }
});

test("at the world's top it climbs no higher", () => {
  const w = flatWorld(16);
  const p = ptera(w);
  const b = hovering(w, 512, 100, WORLD_MAX_Y - 10);
  for (let i = 0; i < 120; i++) stepBody(w, b, 0, FWD, NORTH, UP, BTN_JUMP | BTN_SPRINT, p, TICK_DT);
  expect([b.y, b.vy, b.mode]).toEqual([WORLD_MAX_Y, 0, MODE_FLYER]);
});

test("fuzz: pteranodons flying, landing, rolling and falling over the proving ground and its pool are always in free space and never under water while they fly", () => {
  const w = provingWorld();
  const sea = w.hf.seaLevel;
  const afloat = sea - ptera(w).height * 0.75;
  const did = { aloft: 0, tookOff: 0, setDown: 0, rolled: 0, fell: 0 };
  for (const [tamed, seed] of [[false, 31], [true, 32], [false, 33], [true, 34]] as const) {
    const p = ptera(w, tamed);
    const rng = new Rng(seed);
    for (const [sx, sz] of [[256, 240], [285, 280], [172, 256], [300, 258], [220, 286], [252, 305]] as const) {
      const b = flyerAt(w, sx, sz);
      let [moveZ, yaw, pitch, buttons] = [FWD, rng.int(65536), 0, BTN_JUMP];
      for (let i = 0; i < 3000; i++) {
        if (rng.int(20) === 0) {
          moveZ = rng.int(255) - 127;
          yaw = rng.int(65536);
          pitch = rng.int(2 * UP + 1) - UP;
          // Mostly held up; now and then let down, sprinting, braking or rolling.
          buttons = (rng.int(5) === 0 ? 0 : BTN_JUMP) | (rng.int(2) === 0 ? BTN_SPRINT : 0) | (rng.int(8) === 0 ? BTN_BRAKE : 0) | (rng.int(8) === 0 ? BTN_ROLL : 0);
          // Now and then out cold, caught or too heavy for a while, as the server sets them.
          const r = rng.int(40);
          b.mflags = (b.mflags & MF_WINDED) | (r === 0 ? MF_OUT : r === 1 ? MF_ROOTED | MF_NO_SPRINT : r === 2 ? MF_ROOTED | MF_NO_SPRINT | MF_NO_JUMP : 0);
          if (rng.int(30) === 0) b.stamina = 150 * STAMINA_UNITS;
        }
        const [px, py, pz] = [b.x, b.y, b.z];
        stepBody(w, b, 0, moveZ, yaw, pitch, buttons, p, TICK_DT);
        if (!capsuleFree(w, b.x, b.y, b.z, p.radius, stanceHeight(p, b.stance))) throw new Error(`in solid at tick ${i}, seed ${seed}: ${b.x}, ${b.y}, ${b.z}`);
        // Flying, it may come no lower over deep water than the float line it settles to.
        if (b.mode === MODE_FLYER && py >= afloat && b.y < afloat - 1e-4 && sea - w.hf.heightAt(b.x, b.z) > p.height) throw new Error(`under water at tick ${i}, seed ${seed}`);
        // Sprinting at 19 m/s with a 10 m/s burst is under a metre a tick; falling at 60 is two.
        if (Math.hypot(b.x - px, b.z - pz) > 1.05 || Math.abs(b.y - py) > 2.05) throw new Error(`too far in a tick at ${i}, seed ${seed}`);
        if (b.mode === MODE_FLYER) did.aloft++;
        if (stepOut.tookOff) did.tookOff++;
        if (stepOut.setDown) did.setDown++;
        if (stepOut.rolled) did.rolled++;
        if (stepOut.landSpeed > 16) did.fell++;
      }
    }
  }
  // Most of 72,000 ticks aloft, with hundreds of take-offs and landings, a hundred rolls and some falls.
  expect([did.aloft > 50000, did.tookOff > 300, did.setDown > 200, did.rolled > 50, did.fell > 0]).toEqual([true, true, true, true, true]);
});
