import { expect, test } from "bun:test";
import { curbReturnKind, returnMiddle } from "../../content/curbs.ts";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { hitKind } from "../../shared/world/bends.ts";
import { Body, BTN_JUMP, BTN_RELOAD, BTN_SPRINT } from "../../shared/sim/character.ts";
import { GRIND, KICKFLIP, OLLIE } from "../../shared/sim/skate-state.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { flatWorld } from "../fixtures/world.ts";

test("two raised city kerbs carry a grind across their seam in either direction, then release at the end", () => {
  const w = flatWorld();
  const kind = w.kind(hitKind(false, 2, 8));
  for (const x of [32, 40]) w.structs.add(kind, x, .075, 40, 0, 0, 16000);
  for (const dir of [-1, 1]) {
    const b = new Body();
    Object.assign(b, { vehicle: true, grounded: true, x: 36 - dir*2, y: .002, z: 38.77, vx: dir*6, vehicleYaw: dir*Math.PI/2 });
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

test("a push coasts, a held ollie fires once, an early kickflip catches and banks on a clean landing", () => {
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
  Object.assign(b, { x: 32, y: .002, z: 38.8, grounded: true, vx: 6, vehicleYaw: Math.PI/2 });
  stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(GRIND);
  stepVehicleBody(w, b, 0, 0, BTN_JUMP | BTN_RELOAD | BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(KICKFLIP);
  for (let i = 0; i < 26; i++) stepVehicleBody(w, b, 0, 0, BTN_SPRINT, BOARD);
  expect(b.skate!.move).toBe(GRIND);
  expect(b.skate!.chain).toBe(3);
  for (let i = 0; i < 40; i++) stepVehicleBody(w, b, 0, 0, 0, BOARD);
  expect(b.skate!.bank).toBeGreaterThan(350);
});

test("the grind follows the curved corner through its lowered pedestrian crossing", () => {
  const w = flatWorld(), b = new Body(), [mx, my, mz] = returnMiddle(6);
  w.structs.add(w.kind(curbReturnKind(6)), 40+mx, my, 40+mz, 0, 0, 16000);
  Object.assign(b, { x: 45.8, y: .152, z: 39.96, grounded: true, vx: -5, vehicleYaw: -Math.PI/2 });
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
