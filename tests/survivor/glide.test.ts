// The glider in the step (planning/workstreams/glider.md): its keys, how it flies, what it costs, and that it opens no way
// through a wall and gives no height.

import { expect, test } from "bun:test";
import { AnimState } from "../../shared/anim/pose.ts";
import { TICK_DT, TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import {
  BTN_CROUCH, BTN_JUMP, BTN_PRONE, BTN_SPRINT, Body, GLIDE_DIVE, GLIDE_DIVE_SINK, GLIDE_DIVE_STAMINA, GLIDE_DIVING, GLIDE_FLARED, GLIDE_FLARE_SINK, GLIDE_KEY_CROUCH, GLIDE_REGEN_WAIT,
  GLIDE_SIDE, GLIDE_SINK, GLIDE_SPEED, GLIDE_STAMINA, GLIDE_TRIM, JET_CUIRASS, MF_OUT, MF_ROOTED, MF_WINDED, MODE_SWIM, MODE_WALK, STAMINA_UNITS, STANCE_STAND, glidePhase, stanceHeight, stepBody, stepOut,
  type MoveParams,
} from "../../shared/sim/character.ts";
import { SKIN, capsuleFree } from "../../shared/world/collide.ts";
import { flatWorld, sealedRoom, type TestWorld } from "../fixtures/world.ts";

const FWD = 127;
/** The safe landing of server/survival.ts, in metres per second. */
const SAFE_LANDING = 12;

function survivor(w: TestWorld): MoveParams {
  return w.reg.move[w.kind("core:survivor")]!;
}

/** A survivor in the air over the middle of `w`, carrying a glider, falling at `vy`. */
function aloft(w: TestWorld, y: number, vy = 0, z = (w.dims.chunksZ * 64) / 2): Body {
  const b = new Body();
  b.x = (w.dims.chunksX * 64) / 2;
  b.z = z;
  b.y = y;
  b.vy = vy;
  b.grounded = false;
  b.glideGear = 1;
  return b;
}

function run(w: TestWorld, b: Body, ticks: number, buttons = 0, moveZ = 0, moveX = 0, yaw = 0): void {
  const p = survivor(w);
  for (let i = 0; i < ticks; i++) stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
}

/** One tick with the key down, then let go: a press. */
function press(w: TestWorld, b: Body, key: number, moveZ = 0): void {
  run(w, b, 1, key, moveZ);
  run(w, b, 1, 0, moveZ);
}

/** Open, and flown long enough to be at what the stick asks. */
function flown(w: TestWorld, buttons: number, moveZ: number, moveX = 0, y = 400): Body {
  const b = aloft(w, y);
  press(w, b, BTN_CROUCH);
  expect(b.glide).toBe(1);
  run(w, b, 4 * TICK_RATE, buttons, moveZ, moveX);
  return b;
}

test("a press of Jump or Crouch in the air opens it and the next folds it; a held key does neither", () => {
  const w = flatWorld();
  for (const key of [BTN_JUMP, BTN_CROUCH]) {
    const b = aloft(w, 300);
    // Held from before it left the ground, as the jump that threw it up is.
    b.glideKeys = key === BTN_JUMP ? 1 : GLIDE_KEY_CROUCH;
    run(w, b, 10, key);
    expect(b.glide).toBe(0);
    run(w, b, 1, 0);
    run(w, b, 1, key);
    expect([b.glide, stepOut.glideOpened, stepOut.glideFolded]).toEqual([1, true, false]);
    run(w, b, 20, key);
    expect([b.glide, stepOut.glideOpened]).toEqual([1, false]);
    run(w, b, 1, 0);
    run(w, b, 1, key);
    expect([b.glide, stepOut.glideFolded]).toEqual([0, true]);
    // Either key folds what the other opened.
    run(w, b, 1, 0);
    press(w, b, key);
    expect(b.glide).toBe(1);
    press(w, b, key === BTN_JUMP ? BTN_CROUCH : BTN_JUMP);
    expect(b.glide).toBe(0);
  }
});

test("a jump from the ground does not open it, and a second press at its top does", () => {
  const w = flatWorld();
  const b = aloft(w, 0);
  b.grounded = true;
  run(w, b, 8, BTN_JUMP);
  expect([b.grounded, b.glide]).toEqual([false, 0]);
  run(w, b, 1, 0);
  run(w, b, 1, BTN_JUMP);
  expect(b.glide).toBe(1);
  // It comes down under it and folds as it lands, slower than any landing that hurts.
  let landed = 0;
  for (let i = 0; i < 4 * TICK_RATE && !b.grounded; i++) {
    run(w, b, 1, 0);
    if (stepOut.landSpeed > 0) landed = stepOut.landSpeed;
  }
  expect([b.grounded, b.glide]).toEqual([true, 0]);
  expect(landed).toBeGreaterThan(0);
  expect(landed).toBeLessThanOrEqual(GLIDE_SINK + 0.01);
});

test("it does not open without one carried, nor out cold, laden past moving, winded or seated", () => {
  const w = flatWorld();
  const tried = (set: (b: Body) => void): number => {
    const b = aloft(w, 300);
    set(b);
    press(w, b, BTN_CROUCH);
    if (!b.glide) press(w, b, BTN_JUMP);
    return b.glide;
  };
  expect(tried(() => {})).toBe(1);
  expect(tried((b) => (b.glideGear = 0))).toBe(0);
  expect(tried((b) => (b.mflags = MF_OUT))).toBe(0);
  expect(tried((b) => (b.mflags = MF_ROOTED))).toBe(0);
  // Winded until a quarter of its stamina has come back.
  expect(tried((b) => { b.mflags = MF_WINDED; b.stamina = 10 * STAMINA_UNITS; })).toBe(0);
  expect(tried((b) => (b.seat = 1))).toBe(0);
  // Knocked out under it, it folds.
  const b = aloft(w, 300);
  press(w, b, BTN_CROUCH);
  b.mflags = MF_OUT;
  run(w, b, 1);
  expect([b.glide, stepOut.glideFolded]).toEqual([0, true]);
});

test("in the cuirass Jump is the jet's: Crouch opens the glider, and Jump folds it and thrusts", () => {
  const w = flatWorld();
  const b = aloft(w, 300, -10);
  b.jetGear = JET_CUIRASS;
  press(w, b, BTN_JUMP);
  expect(b.glide).toBe(0);
  run(w, b, 5, BTN_JUMP);
  expect(b.jetThrust).not.toBe(0);
  // Thrust held, and the glider thrown open: the jet goes quiet, and its reserve is not spent under the glider.
  run(w, b, 1, BTN_JUMP | BTN_CROUCH);
  expect([b.glide, b.jetThrust]).toEqual([1, 0]);
  const spent = b.jetSpent;
  run(w, b, TICK_RATE, BTN_JUMP);
  expect([b.glide, b.jetThrust, b.jetSpent]).toEqual([1, 0, spent]);
  run(w, b, 1, 0);
  run(w, b, 1, BTN_JUMP);
  expect(b.glide).toBe(0);
  run(w, b, 3, BTN_JUMP);
  expect(b.jetThrust).not.toBe(0);
});

test("in the air a body that carries one does not crouch or lie down", () => {
  const w = flatWorld();
  const b = aloft(w, 300);
  run(w, b, 10, BTN_CROUCH | BTN_PRONE);
  expect(b.stance).toBe(STANCE_STAND);
  const bare = aloft(w, 300);
  bare.glideGear = 0;
  run(w, bare, 10, BTN_CROUCH);
  expect(bare.stance).not.toBe(STANCE_STAND);
});

test("it brakes the fastest fall in a second and some 30 m", () => {
  const w = flatWorld();
  const b = aloft(w, 400, -60);
  const from = b.y;
  run(w, b, 1, BTN_CROUCH);
  let ticks = 1;
  while (b.vy < -GLIDE_SINK - 1e-6 && ticks < 200) {
    run(w, b, 1, 0);
    ticks++;
  }
  expect(ticks).toBeLessThanOrEqual(TICK_RATE + 3);
  expect(from - b.y).toBeGreaterThan(25);
  expect(from - b.y).toBeLessThan(33);
  expect(b.vy).toBeCloseTo(-GLIDE_SINK, 5);
});

test("forward it flies 10 m/s and sinks 2.2; with no stick it comes straight down", () => {
  const w = flatWorld(16);
  const b = flown(w, 0, FWD);
  const z = b.z, y = b.y;
  run(w, b, 3 * TICK_RATE, 0, FWD);
  expect(b.z - z).toBeCloseTo(3 * GLIDE_SPEED, 1);
  expect(y - b.y).toBeCloseTo(3 * GLIDE_SINK, 1);
  expect(glidePhase(b.vx, b.vy, b.vz)).toBe(GLIDE_TRIM);
  const still = flown(w, 0, 0);
  expect(Math.hypot(still.vx, still.vz)).toBeLessThan(1e-6);
  expect(still.vy).toBeCloseTo(-GLIDE_SINK, 5);
});

test("it slips sideways, flares to a stop with the stick back, and dives with sprint", () => {
  const w = flatWorld(16);
  const side = flown(w, 0, 0, FWD);
  // Yaw 0 faces +Z, and its right is -X.
  expect(Math.abs(side.vx)).toBeCloseTo(GLIDE_SIDE, 3);
  expect(Math.abs(side.vz)).toBeLessThan(1e-6);
  const flare = flown(w, 0, FWD);
  run(w, flare, TICK_RATE, 0, -FWD);
  expect(Math.hypot(flare.vx, flare.vz)).toBeLessThan(1e-6);
  expect(flare.vy).toBeCloseTo(-GLIDE_FLARE_SINK, 5);
  expect(glidePhase(flare.vx, flare.vy, flare.vz)).toBe(GLIDE_FLARED);
  const dive = flown(w, BTN_SPRINT, FWD);
  expect(dive.vz).toBeCloseTo(GLIDE_DIVE, 3);
  expect(dive.vy).toBeCloseTo(-GLIDE_DIVE_SINK, 5);
  expect(glidePhase(dive.vx, dive.vy, dive.vz)).toBe(GLIDE_DIVING);
});

test("a quarter turn is flown round in about a second at full speed", () => {
  const w = flatWorld(16);
  const b = flown(w, 0, FWD);
  const p = survivor(w);
  let slowest = Infinity;
  // Yaw rises to the left, and a quarter turn from +Z faces +X.
  for (let i = 0; i < TICK_RATE + 2; i++) {
    stepBody(w, b, 0, FWD, 16384, 0, 0, p, TICK_DT);
    slowest = Math.min(slowest, Math.hypot(b.vx, b.vz));
  }
  expect(slowest).toBeGreaterThan(GLIDE_SPEED - 0.01);
  expect(b.vx).toBeCloseTo(GLIDE_SPEED, 2);
  expect(Math.abs(b.vz)).toBeLessThan(0.05);
  // Half way round it is half turned, not yet there.
  const c = flown(w, 0, FWD);
  for (let i = 0; i < TICK_RATE / 2; i++) stepBody(w, c, 0, FWD, 16384, 0, 0, p, TICK_DT);
  expect(c.vx).toBeGreaterThan(5);
  expect(c.vz).toBeGreaterThan(2);
});

test("pulling out of a dive floats it for a moment, and never lifts it", () => {
  const w = flatWorld(16);
  const b = flown(w, BTN_SPRINT, FWD);
  let floated = 0;
  let y = b.y;
  for (let i = 0; i < 2 * TICK_RATE; i++) {
    run(w, b, 1, 0, FWD);
    expect(b.y).toBeLessThanOrEqual(y);
    expect(b.vy).toBeLessThanOrEqual(0);
    if (b.vy > -GLIDE_SINK / 2) floated++;
    y = b.y;
  }
  expect(floated).toBeGreaterThan(TICK_RATE / 3);
  expect(b.vy).toBeCloseTo(-GLIDE_SINK, 5);
  expect(b.vz).toBeCloseTo(GLIDE_SPEED, 3);
});

test("opened on the way up it adds nothing to a jump", () => {
  const w = flatWorld();
  const top = (open: boolean): number => {
    const b = aloft(w, 0);
    b.grounded = true;
    run(w, b, 2, BTN_JUMP);
    let highest = b.y;
    for (let i = 0; i < TICK_RATE; i++) {
      run(w, b, 1, open && i === 1 ? BTN_CROUCH : 0);
      if (b.y > highest) highest = b.y;
    }
    if (open) expect(b.glide + (b.grounded ? 1 : 0)).toBeGreaterThan(0);
    return highest;
  };
  expect(top(true)).toBeLessThanOrEqual(top(false));
});

test("fuzz: a falling body with a glider never ends a tick higher than it began it", () => {
  const w = flatWorld(8);
  const p = survivor(w);
  for (let seed = 1; seed <= 12; seed++) {
    const rng = new Rng(seed);
    const b = aloft(w, 250);
    let moveX = 0, moveZ = 0, yaw = 0, buttons = 0;
    for (let i = 0; i < 40 * TICK_RATE && !b.grounded; i++) {
      if (rng.int(10) === 0) {
        moveX = rng.int(255) - 127;
        moveZ = rng.int(255) - 127;
        yaw = rng.int(65536);
        buttons = (rng.int(2) ? BTN_JUMP : 0) | (rng.int(2) ? BTN_CROUCH : 0) | (rng.int(2) ? BTN_SPRINT : 0);
      }
      const y = b.y;
      // Kept on its feet: this is what a glider may do, not what a spent body does.
      b.stamina = 100 * STAMINA_UNITS;
      b.mflags = 0;
      stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
      if (b.y > y) throw new Error(`seed ${seed}, tick ${i}: rose from ${y} to ${b.y} with glide ${b.glide}`);
    }
  }
});

test("it costs 1.6 stamina a second and twice that diving, folds when it is spent, and none comes back in the air", () => {
  const w = flatWorld(16);
  const b = aloft(w, 600);
  press(w, b, BTN_CROUCH);
  const before = b.stamina;
  run(w, b, TICK_RATE, 0, FWD);
  expect(before - b.stamina).toBe(TICK_RATE * GLIDE_STAMINA);
  run(w, b, TICK_RATE, BTN_SPRINT, FWD);
  expect(before - b.stamina).toBe(TICK_RATE * (GLIDE_STAMINA + GLIDE_DIVE_STAMINA));
  // Five points last three seconds, and then it is a fall.
  b.stamina = 5 * STAMINA_UNITS;
  let ticks = 0;
  while (b.glide && ticks < 1000) {
    run(w, b, 1, 0, FWD);
    ticks++;
  }
  expect(ticks).toBe(Math.ceil((5 * STAMINA_UNITS) / GLIDE_STAMINA));
  expect([b.stamina, b.mflags & MF_WINDED, stepOut.glideFolded]).toEqual([0, MF_WINDED, true]);
  // Folded by choice with stamina left, it gets none back either while it falls.
  const c = aloft(w, 600);
  press(w, c, BTN_CROUCH);
  run(w, c, TICK_RATE, 0);
  press(w, c, BTN_CROUCH);
  const left = c.stamina;
  run(w, c, 2 * TICK_RATE, 0);
  expect([c.glide, c.grounded, c.stamina]).toEqual([0, false, left]);
  // Winded, it cannot be opened again, and the fall goes on.
  press(w, b, BTN_CROUCH);
  expect(b.glide).toBe(0);
  run(w, b, TICK_RATE, 0);
  expect(b.stamina).toBe(0);
  expect(b.vy).toBeLessThan(-GLIDE_DIVE_SINK);
});

test("stamina comes back on the ground a moment after it lands", () => {
  const w = flatWorld();
  const b = aloft(w, 3);
  press(w, b, BTN_CROUCH);
  while (!b.grounded) run(w, b, 1, 0);
  const landed = b.stamina;
  expect(landed).toBeLessThan(100 * STAMINA_UNITS);
  run(w, b, GLIDE_REGEN_WAIT, 0);
  expect(b.stamina).toBe(landed);
  run(w, b, 5, 0);
  expect(b.stamina).toBeGreaterThan(landed);
});

test("a glide from 60 m lands softly far from where it began, and water folds it", () => {
  const w = flatWorld(8);
  const b = aloft(w, 60, 0, 20);
  const z = b.z;
  press(w, b, BTN_CROUCH);
  let landed = 0;
  for (let i = 0; i < 60 * TICK_RATE && !b.grounded; i++) {
    run(w, b, 1, 0, FWD);
    if (stepOut.landSpeed > 0) landed = stepOut.landSpeed;
  }
  expect([b.grounded, b.glide, b.mode]).toEqual([true, 0, MODE_WALK]);
  expect(landed).toBeLessThan(SAFE_LANDING / 4);
  expect(b.z - z).toBeGreaterThan(60 * (GLIDE_SPEED / GLIDE_SINK) * 0.95);
  // Over deep water it swims where it comes down, folded and unhurt.
  const sea = flatWorld(8);
  sea.hf.seaLevel = 4;
  const s = aloft(sea, 30);
  press(sea, s, BTN_CROUCH);
  let hurt = 0;
  for (let i = 0; i < 30 * TICK_RATE && s.mode === MODE_WALK; i++) {
    run(sea, s, 1, 0, FWD);
    hurt = Math.max(hurt, stepOut.landSpeed);
  }
  expect([s.mode, s.glide, hurt]).toEqual([MODE_SWIM, 0, 0]);
});

test("fuzz: no input with a glider leaves a sealed room or enters solid space", () => {
  const w = flatWorld();
  const room = sealedRoom(w, 64, 64);
  const p = survivor(w);
  const rng = new Rng(2027);
  const b = aloft(w, 0);
  b.grounded = true;
  let moveX = 0, moveZ = 0, yaw = 0, buttons = 0, opened = 0;
  for (let i = 0; i < 30000; i++) {
    if (rng.int(6) === 0) {
      moveX = rng.int(513) - 256;
      moveZ = rng.int(513) - 256;
      yaw = rng.int(65536);
      buttons = rng.int(1024);
    }
    b.stamina = 100 * STAMINA_UNITS;
    b.mflags = 0;
    stepBody(w, b, moveX, moveZ, yaw, 0, buttons, p, TICK_DT);
    if (stepOut.glideOpened) opened++;
    const height = stanceHeight(p, b.stance);
    const inside = b.x > room.minX && b.x < room.maxX && b.z > room.minZ && b.z < room.maxZ && b.y >= -SKIN && b.y + height < room.maxY + SKIN;
    if (!inside || !capsuleFree(w, b.x, b.y, b.z, p.radius, height)) throw new Error(`escaped at tick ${i}: ${b.x}, ${b.y}, ${b.z}`);
  }
  // The room is 3 m high, and a jump in it is long enough to throw the glider open.
  expect(opened).toBeGreaterThan(50);
});

test("the glider travels with the owner's body, and a body that carries none pays one bit", () => {
  const bits = (b: Body): number => {
    const w = new BitWriter(256);
    writeBody(w, b);
    return w.pos;
  };
  const b = new Body();
  const bare = bits(b);
  b.glideGear = 1;
  b.glide = 1;
  b.glideKeys = GLIDE_KEY_CROUCH;
  expect(bits(b) - bare).toBe(5);
  const w = new BitWriter(256);
  writeBody(w, b);
  const back = new Body();
  readBody(new BitReader(w.bytes()), back);
  expect(back.equals(b)).toBe(true);
  expect([back.glideGear, back.glide, back.glideKeys]).toEqual([1, 1, GLIDE_KEY_CROUCH]);
});

test("an observer is told of an open glider and how it flies, and not of a jet", () => {
  for (const phase of [GLIDE_TRIM, GLIDE_DIVING, GLIDE_FLARED]) {
    const st = new AnimState();
    st.grounded = false;
    st.setMotion(0, 6, 0, 0);
    st.setJet(0, 0);
    st.setGlide(true, phase);
    const back = new AnimState();
    back.unpack(st.pack(), st.packCue());
    expect([back.glide, back.glidePhase, back.jet, back.grounded, back.mode, back.speed]).toEqual([true, phase, false, false, MODE_WALK, st.speed]);
  }
  // Folded, the word is a faller's again.
  const st = new AnimState();
  st.grounded = false;
  st.setGlide(false, GLIDE_DIVING);
  const back = new AnimState();
  back.unpack(st.pack(), st.packCue());
  expect([back.glide, back.jet, back.grounded]).toEqual([false, false, false]);
});
