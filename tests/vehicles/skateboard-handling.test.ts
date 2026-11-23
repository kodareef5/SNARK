import { expect, test } from "bun:test";
import { curbReturnKind, returnMiddle } from "../../content/curbs.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { hitKind } from "../../shared/world/bends.ts";
import { Body, BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_PRONE, BTN_RELOAD, BTN_SPRINT } from "../../shared/sim/character.ts";
import { BAIL, FLIP, GRIND, MANUAL, OLLIE, ROLL } from "../../shared/sim/skate-state.ts";
import { T_KICKFLIP, T_MANUAL, T_REVERT, entryTrick } from "../../shared/sim/skate-tricks.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

const step = (w: TestWorld, b: Body, x: number, z: number, keys: number) => stepVehicleBody(w, b, x, z, keys, BOARD);
const rolling = (speed: number) => Object.assign(new Body(), { x: 34, z: 20, grounded: true, vz: speed });
/** Holds the pop for `hold` ticks, then lets go. */
function pop(w: TestWorld, b: Body, hold = 1, keys = 0) {
  for (let i = 0; i < hold; i++) step(w, b, 0, 0, BTN_JUMP | keys);
  step(w, b, 0, 0, keys);
}
function land(w: TestWorld, b: Body, keys = 0) {
  for (let i = 0; i < 60 && !b.grounded; i++) step(w, b, 0, 0, keys);
}
const lineOf = (b: Body) => Array.from(b.skate!.line.subarray(0, b.skate!.count), entryTrick);

test("a descending rider catches either direction and grinds across the kerb seam", () => {
  const w = flatWorld();
  const kind = w.kind(hitKind(false, 2, 8));
  for (const x of [32, 40]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  for (const dir of [-1, 1]) {
    const b = new Body();
    Object.assign(b, { vehicle: true, grounded: false, vy: -1, x: 36 - dir*2, y: .25, z: 38.77, vx: dir*6, vehicleYaw: dir*Math.PI/2 });
    for (let t = 0; t < 20; t++) {
      step(w, b, 0, 0, BTN_SPRINT);
      expect(b.skate!.move).toBe(GRIND);
      expect(b.z).toBeCloseTo(39, 3);
    }
    expect((b.x - 36)*dir).toBeGreaterThan(0);
    expect(b.skate!.chain).toBe(1);
    const edgeScore = b.skate!.points;
    for (let t = 0; t < 90; t++) step(w, b, 0, 0, BTN_SPRINT);
    expect(b.skate!.move).not.toBe(GRIND);
    expect((b.x-36)*dir).toBeGreaterThan(8);
    expect(b.skate!.bank).toBeGreaterThan(edgeScore);
  }
});

test("holding the pop longer jumps higher, and a tap still pops", () => {
  const heights = [1, 6, 12].map((hold) => {
    const w = flatWorld(), b = rolling(5);
    step(w, b, 0, 0, 0);
    const floor = b.y;
    let top = 0;
    for (let i = 0; i < hold; i++) step(w, b, 0, 0, BTN_JUMP);
    expect(b.grounded).toBe(true);
    step(w, b, 0, 0, 0);
    expect(b.skate!.move).toBe(OLLIE);
    for (let i = 0; i < 60 && !b.grounded; i++) { step(w, b, 0, 0, 0); top = Math.max(top, b.y - floor); }
    expect(b.skate!.move).toBe(ROLL);
    return top;
  });
  expect(heights[0]).toBeGreaterThan(.45); expect(heights[0]).toBeLessThan(.6);
  expect(heights[1]).toBeGreaterThan(heights[0]! + .15);
  expect(heights[2]).toBeGreaterThan(1); expect(heights[2]).toBeLessThan(1.2);
});

test("a kickflip lands, banks once rolling, and a plain ollie scores nothing", () => {
  const w = flatWorld(), b = rolling(5);
  pop(w, b, 4);
  land(w, b);
  for (let i = 0; i < 30; i++) step(w, b, 0, 0, 0);
  expect(b.skate!.bank).toBe(0);
  pop(w, b, 4);
  step(w, b, 0, 0, BTN_RELOAD);
  expect(b.skate!.move).toBe(FLIP);
  expect(b.skate!.trick).toBe(T_KICKFLIP);
  land(w, b);
  expect(lineOf(b)).toEqual([T_KICKFLIP]);
  for (let i = 0; i < 30; i++) step(w, b, 0, 0, 0);
  expect(b.skate!.bank).toBe(100);
  expect(b.skate!.count).toBe(0);
});

test("a rider can pop off a grind, flip, catch the kerb again and bank the linked line", () => {
  const w = flatWorld(), b = new Body(), kind = w.kind(hitKind(false, 2, 8));
  for (const x of [32, 40, 48, 56]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  Object.assign(b, { x: 32, y: .25, z: 38.8, grounded: false, vy: -1, vx: 6.5, vehicleYaw: Math.PI/2 });
  step(w, b, 0, 0, BTN_SPRINT);
  expect(b.skate!.move).toBe(GRIND);
  pop(w, b, 3, BTN_SPRINT);
  step(w, b, 0, 0, BTN_RELOAD | BTN_SPRINT);
  expect(b.skate!.move).toBe(FLIP);
  let caught = false;
  for (let i = 0; i < 40 && !caught; i++) { step(w, b, 0, 0, BTN_SPRINT); caught = b.skate!.move === GRIND; }
  expect(caught).toBe(true);
  expect(b.skate!.chain).toBe(2);
  for (let i = 0; i < 40; i++) step(w, b, 0, 0, 0);
  expect(b.skate!.bank).toBeGreaterThan(400);
});

test("the grind follows the curved corner through its lowered pedestrian crossing", () => {
  const w = flatWorld(), b = new Body(), [mx, my, mz] = returnMiddle(6);
  w.structs.add(w.kind(curbReturnKind(6)), 40+mx, my, 40+mz, 0, 0, 16000);
  Object.assign(b, { x: 45.8, y: .25, z: 39.96, grounded: false, vy: -1, vx: -5, vehicleYaw: -Math.PI/2 });
  let low = 1;
  for (let i = 0; i < 50; i++) {
    step(w, b, 0, 0, BTN_SPRINT);
    expect(b.skate!.move).toBe(GRIND);
    low = Math.min(low, b.y);
  }
  expect(low).toBeLessThan(.06);
  expect(b.vz).toBeGreaterThan(3);
  expect(b.skate!.chain).toBe(1);
});

test("a rider can pivot away from a wall from a dead stop", () => {
  const w = flatWorld(), b = new Body();
  w.structs.add(w.kind("core:wall"), 40, 1.5, 40, 0, 0, 1000);
  Object.assign(b, { x: 40, z: 39.45, y: .002, grounded: true });
  for (let tick = 0; tick < 150; tick++) step(w, b, 127, 127, 0);
  expect(Math.hypot(b.x - 40, b.z - 39.45)).toBeGreaterThan(2);
  expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(3);
});

test("flat ollies score nothing and a repeated flip pays less each time without raising the multiplier", () => {
  const w = flatWorld(), b = rolling(5);
  for (let i = 0; i < 6; i++) { pop(w, b, 2); land(w, b); }
  expect(b.skate!.points).toBe(0);
  expect(b.skate!.chain).toBe(0);
  for (let i = 0; i < 5; i++) { pop(w, b, 4); step(w, b, 0, 0, BTN_RELOAD); land(w, b); }
  expect(b.skate!.points).toBe(100 + 75 + 50 + 25 + 10);
  expect(b.skate!.chain).toBe(1);
});

test("a kerb needs an aerial catch and pays by distance while balanced", () => {
  const w = flatWorld(), kind = w.kind(hitKind(false, 2, 8));
  for (let x = 28; x <= 84; x += 8) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  function rider(speed: number, ground: boolean) {
    return Object.assign(new Body(), { x: 30, z: 38.72, y: ground ? .002 : .25,
      grounded: ground, vx: speed, vy: ground ? 0 : -1, vehicleYaw: Math.PI / 2 });
  }
  const ground = rider(5, true);
  for (let i = 0; i < 30; i++) {
    step(w, ground, 0, 0, BTN_SPRINT);
    expect(ground.skate!.move).not.toBe(GRIND);
  }
  function ride(speed: number, correct: boolean) {
    const b = rider(speed, false);
    for (let i = 0; i < 112; i++) {
      const balance = b.skate?.balance ?? 0;
      const steer = correct && Math.abs(balance) > 25 ? -Math.sign(balance) * 127 : 0;
      step(w, b, steer, 0, BTN_SPRINT);
      if (b.skate!.move === BAIL) break;
    }
    return b;
  }
  const slow = ride(4, true), fast = ride(7, true), fall = ride(7, false);
  expect(slow.skate!.move).toBe(GRIND);
  expect(fast.skate!.move).toBe(GRIND);
  expect(fast.skate!.points - slow.skate!.points).toBeGreaterThan(45);
  expect(fall.skate!.move).toBe(BAIL);
  expect(fall.skate!.points).toBe(0);
});

test("a tapped turn in the air lands a 180 switch with its speed, and a revert and manual link it", () => {
  const w = flatWorld(), b = rolling(5);
  pop(w, b, 6);
  for (let i = 0; i < 4; i++) step(w, b, -127, 0, 0);
  land(w, b);
  expect(b.skate!.switched).toBe(true);
  expect(b.vz).toBeGreaterThan(4);
  expect(Math.cos(b.vehicleYaw)).toBeLessThan(-.99);
  expect(b.skate!.chain).toBe(1);
  step(w, b, 0, 0, BTN_MOD);
  for (let i = 0; i < 8; i++) step(w, b, 0, 0, 0);
  expect(b.skate!.switched).toBe(false);
  expect(Math.cos(b.vehicleYaw)).toBeGreaterThan(.99);
  expect(b.skate!.chain).toBe(2);
  expect(lineOf(b)).toContain(T_REVERT);
  for (let i = 0; i < 6; i++) step(w, b, 0, 0, BTN_PRONE);
  expect(b.skate!.move).toBe(MANUAL);
  for (let i = 0; i < 8; i++) step(w, b, 0, 0, BTN_PRONE);
  expect(lineOf(b)).toContain(T_MANUAL);
  expect(b.skate!.chain).toBe(3);
  expect(b.vz).toBeGreaterThan(3);
});

test("a released grab lands and a held grab or a late flip is a light fall", () => {
  const w = flatWorld();
  function jump(grab: boolean, release: boolean) {
    const b = rolling(4);
    pop(w, b, 4);
    for (let i = 0; i < 30 && !b.grounded; i++) {
      const late = b.vy < 0 && b.y < .27;
      const keys = grab ? (release && i >= 10 ? 0 : BTN_CROUCH) : late ? BTN_RELOAD : 0;
      step(w, b, 0, 0, keys);
    }
    return { hurt: vehicleStep.skateHurt, points: b.skate!.points };
  }
  expect(jump(true, true)).toEqual({ hurt: 0, points: 150 });
  expect(jump(true, false)).toEqual({ hurt: 1, points: 0 });
  expect(jump(false, false)).toEqual({ hurt: 2, points: 0 });
});

test("a gap narrower than the rider blocks a mounted board", () => {
  const w = flatWorld(), wall = w.kind("core:wall"), half = w.structs.halfXOf(wall);
  for (const sign of [-1, 1]) w.structs.add(wall, 32 + sign * (half + .31), 1.5, 40, 0, 0, 1000);
  const b = Object.assign(new Body(), { x: 32, z: 38, grounded: true });
  for (let i = 0; i < 60; i++) step(w, b, 0, 127, 0);
  expect(b.z).toBeGreaterThan(39);
  expect(b.z).toBeLessThan(40);
});

test("braking holds the stop and pressing back again steps away from the wall", () => {
  const w = flatWorld(), b = Object.assign(new Body(), { x: 40, z: 36, vz: 4, grounded: true });
  w.structs.add(w.kind("core:wall"), 40, 1.5, 40, 0, 0, 1000);
  for (let i = 0; i < 45; i++) step(w, b, 0, -127, 0);
  expect(b.vz).toBe(0);
  const stopped = b.z;
  step(w, b, 0, 0, 0);
  for (let i = 0; i < 45; i++) step(w, b, 0, -127, 0);
  expect(b.z).toBeLessThan(stopped - 1);
  expect(b.vz).toBeGreaterThanOrEqual(-1.2);
  step(w, b, 0, 127, 0);
  expect(b.vz).toBeGreaterThan(0);
});
