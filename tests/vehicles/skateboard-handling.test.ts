import { expect, test } from "bun:test";
import { curbReturnKind, returnMiddle } from "../../content/curbs.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { hitKind } from "../../shared/world/bends.ts";
import { Body, BTN_CROUCH, BTN_JUMP, BTN_MOD, BTN_PRONE, BTN_RELOAD, BTN_SPRINT } from "../../shared/sim/character.ts";
import { BAIL, GRIND, KICKFLIP, MANUAL, OLLIE } from "../../shared/sim/skate-state.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { flatWorld } from "../fixtures/world.ts";

test("a descending rider catches either direction and grinds across the kerb seam", () => {
  const w = flatWorld();
  const kind = w.kind(hitKind(false, 2, 8));
  for (const x of [32, 40]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  for (const dir of [-1, 1]) {
    const b = new Body();
    Object.assign(b, { vehicle: true, grounded: false, vy: -1, x: 36 - dir*2, y: .25, z: 38.77, vx: dir*6, vehicleYaw: dir*Math.PI/2 });
    for (let t = 0; t < 20; t++) {
      stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
      expect(b.skate!.move).toBe(GRIND);
      expect(b.z).toBeCloseTo(39, 3);
    }
    expect((b.x - 36)*dir).toBeGreaterThan(0);
    expect(b.skate!.chain).toBe(1);
    const edgeScore = b.skate!.score;
    for (let t = 0; t < 90; t++) stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
    expect(b.skate!.move).not.toBe(GRIND);
    expect((b.x-36)*dir).toBeGreaterThan(8);
    expect(b.skate!.bank).toBeGreaterThan(edgeScore);
  }
});

test("a held ollie fires once and an early kickflip banks after landing", () => {
  const w = flatWorld(), b = new Body();
  Object.assign(b, { x: 34, z: 20, grounded: true });
  for (let i=0; i<60; i++) stepVehicleBody(w, b, 0, 127, 0, BOARD);
  const speed = b.vz;
  expect(speed).toBeGreaterThan(5);
  stepVehicleBody(w,b,0,0,BTN_JUMP,BOARD);
  expect(b.skate!.move).toBe(OLLIE);
  stepVehicleBody(w,b,0,0,BTN_JUMP|BTN_RELOAD,BOARD);
  expect(b.skate!.move).toBe(KICKFLIP);
  let top = 0, impact = 0;
  for (let i=0; i<55; i++) {
    stepVehicleBody(w,b,0,0,BTN_JUMP,BOARD);
    top = Math.max(top, b.y); impact = Math.max(impact, vehicleStep.landSpeed);
  }
  expect(top).toBeGreaterThan(.7); expect(top).toBeLessThan(1);
  expect(impact).toBeLessThan(6);
  expect(b.grounded).toBe(true);
  expect(b.skate!.bank).toBe(120);
  expect(b.vz).toBeLessThan(speed);
  for (let i=0; i<40; i++) stepVehicleBody(w,b,0,-127,0,BOARD);
  expect(b.vz).toBe(0);
});

test("a rider can pop off a grind, flip, catch the kerb again and bank the linked line", () => {
  const w = flatWorld(), b = new Body(), kind = w.kind(hitKind(false, 2, 8));
  for (const x of [32, 40, 48]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  Object.assign(b, { x: 32, y: .25, z: 38.8, grounded: false, vy: -1, vx: 6, vehicleYaw: Math.PI/2 });
  stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(GRIND);
  stepVehicleBody(w, b, 0, 0, BTN_JUMP | BTN_RELOAD | BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(KICKFLIP);
  for (let i = 0; i < 26; i++) stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(GRIND);
  expect(b.skate!.chain).toBe(2);
  for (let i = 0; i < 40; i++) stepVehicleBody(w, b, 0, 0, 0, BOARD);
  expect(b.skate!.bank).toBeGreaterThan(300);
});

test("the grind follows the curved corner through its lowered pedestrian crossing", () => {
  const w = flatWorld(), b = new Body(), [mx, my, mz] = returnMiddle(6);
  w.structs.add(w.kind(curbReturnKind(6)), 40+mx, my, 40+mz, 0, 0, 16000);
  Object.assign(b, { x: 45.8, y: .25, z: 39.96, grounded: false, vy: -1, vx: -5, vehicleYaw: -Math.PI/2 });
  let low = 1;
  for (let i = 0; i < 50; i++) {
    stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
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
  for (let tick = 0; tick < 150; tick++) stepVehicleBody(w, b, 127, 127, 0, BOARD);
  expect(Math.hypot(b.x - 40, b.z - 39.45)).toBeGreaterThan(2);
  expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(3);
});

test("flat ollies and repeated flips cannot increase the multiplier", () => {
  const w = flatWorld(), b = new Body();
  Object.assign(b, { x: 30, z: 30, grounded: true });
  function hop(keys: number) {
    stepVehicleBody(w, b, 0, 0, BTN_JUMP | keys, BOARD);
    for (let i = 0; i < 36 && !b.grounded; i++) stepVehicleBody(w, b, 0, 0, 0, BOARD);
    expect(b.grounded).toBe(true);
  }
  for (let i = 0; i < 14; i++) hop(0);
  expect(b.skate!.score).toBe(0);
  expect(b.skate!.chain).toBe(0);
  for (let i = 0; i < 6; i++) hop(BTN_RELOAD);
  expect(b.skate!.score).toBe(120);
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
    stepVehicleBody(w, ground, 0, 0, BTN_SPRINT, BOARD);
    expect(ground.skate!.move).not.toBe(GRIND);
  }
  function ride(speed: number, correct: boolean) {
    const b = rider(speed, false);
    for (let i = 0; i < 112; i++) {
      const balance = b.skate?.balance ?? 0;
      const steer = correct && Math.abs(balance) > 25 ? -Math.sign(balance) * 127 : 0;
      stepVehicleBody(w, b, steer, 0, BTN_SPRINT, BOARD);
      if (b.skate!.move === BAIL) break;
    }
    return b;
  }
  const slow = ride(4, true), fast = ride(7, true), fall = ride(7, false);
  expect(slow.skate!.move).toBe(GRIND);
  expect(fast.skate!.move).toBe(GRIND);
  expect(fast.skate!.score - slow.skate!.score).toBeGreaterThan(45);
  expect(fall.skate!.move).toBe(BAIL);
  expect(fall.skate!.score).toBe(0);
});

test("a 180 lands switch with forward momentum and links into a manual", () => {
  const w = flatWorld(), b = new Body();
  Object.assign(b, { x: 30, z: 30, grounded: true, vz: 5 });
  stepVehicleBody(w, b, 0, 0, BTN_JUMP | BTN_MOD, BOARD);
  for (let i = 0; i < 28 && !b.grounded; i++) stepVehicleBody(w, b, 0, 0, 0, BOARD);
  expect(b.skate!.switched).toBe(true);
  expect(b.vz).toBeGreaterThan(4);
  expect(Math.cos(b.vehicleYaw)).toBeLessThan(-.99);
  stepVehicleBody(w, b, 0, 0, BTN_PRONE, BOARD);
  expect(b.skate!.move).toBe(MANUAL);
  expect(b.skate!.chain).toBe(1);
  for (let i = 0; i < 6; i++) stepVehicleBody(w, b, 0, 0, BTN_PRONE, BOARD);
  expect(b.skate!.chain).toBe(2);
  for (let i = 0; i < 4; i++) stepVehicleBody(w, b, 0, 0, 0, BOARD, undefined, undefined, false);
  expect(b.vz).toBeGreaterThan(3);
});

test("a released grab lands and a held grab or last-second flip causes a light fall", () => {
  const w = flatWorld();
  function jump(grab: boolean, release: boolean) {
    const b = Object.assign(new Body(), { x: 36, z: 32, grounded: true, vz: 4 });
    stepVehicleBody(w, b, 0, 0, BTN_JUMP | (grab ? BTN_CROUCH : 0), BOARD);
    for (let i = 0; i < 30 && !b.grounded; i++) {
      const late = b.vy < 0 && b.y < .27;
      const keys = grab ? (release && i >= 8 ? 0 : BTN_CROUCH) : late ? BTN_RELOAD : 0;
      stepVehicleBody(w, b, 0, 0, keys, BOARD);
    }
    return { hurt: vehicleStep.skateHurt, score: b.skate!.score };
  }
  expect(jump(true, true)).toEqual({ hurt: 0, score: 75 });
  expect(jump(true, false)).toEqual({ hurt: 1, score: 0 });
  expect(jump(false, false)).toEqual({ hurt: 2, score: 0 });
});

test("a gap narrower than the rider blocks a mounted board", () => {
  const w = flatWorld(), wall = w.kind("core:wall"), half = w.structs.halfXOf(wall);
  for (const sign of [-1, 1]) w.structs.add(wall, 32 + sign * (half + .31), 1.5, 40, 0, 0, 1000);
  const b = Object.assign(new Body(), { x: 32, z: 38, grounded: true });
  for (let i = 0; i < 60; i++) stepVehicleBody(w, b, 0, 127, 0, BOARD);
  expect(b.z).toBeGreaterThan(39);
  expect(b.z).toBeLessThan(40);
});

test("braking holds the stop and pressing back again steps away from the wall", () => {
  const w = flatWorld(), b = Object.assign(new Body(), { x: 40, z: 36, vz: 4, grounded: true });
  w.structs.add(w.kind("core:wall"), 40, 1.5, 40, 0, 0, 1000);
  for (let i = 0; i < 45; i++) stepVehicleBody(w, b, 0, -127, 0, BOARD);
  expect(b.vz).toBe(0);
  const stopped = b.z;
  stepVehicleBody(w, b, 0, 0, 0, BOARD);
  for (let i = 0; i < 45; i++) stepVehicleBody(w, b, 0, -127, 0, BOARD);
  expect(b.z).toBeLessThan(stopped - 1);
  expect(b.vz).toBeGreaterThanOrEqual(-1.2);
  stepVehicleBody(w, b, 0, 127, 0, BOARD);
  expect(b.vz).toBeGreaterThan(0);
});
