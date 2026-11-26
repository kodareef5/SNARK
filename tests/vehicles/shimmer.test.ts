// Which vehicles are worth walking to (client/core/vehicle-ready.ts) and when each shimmers (client/core/shimmer.ts).

import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { SHIMMER_GAP_MS, SHIMMER_MOST, SHIMMER_MS, Shimmer } from "../../client/core/shimmer.ts";
import { usableVehicle } from "../../client/core/vehicle-ready.ts";
import { CUE_DEAD } from "../../shared/anim/pose.ts";
import { isSkateboard } from "../../shared/sim/vehicle.ts";
import { vehicleWouldRun } from "../../shared/sim/vehicle-presentation.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const kind = (id: string): number => reg.index.get(id)!;
/** A sample of vehicles of `kinds` in a row along x from 10 m, each sound, fuelled and empty. */
function parked(kinds: string[]): RemoteSample {
  const r = new RemoteSample();
  r.count = kinds.length;
  kinds.forEach((id, i) => {
    r.id[i] = 100 + i; r.gen[i] = 1; r.kind[i] = kind(id);
    r.x[i] = 10 + i * 4; r.y[i] = 0; r.z[i] = 0;
    r.vehicleFuel[i] = 0.1; r.vehicleEngineCondition[i] = 0.6; r.vehicleHullCondition[i] = 1; r.vehicleFlooding[i] = 0;
    r.vehicleBoat[i] = reg.vehicle[kind(id)]!.movement === "boat" ? 1 : 0;
  });
  return r;
}

test("the engines' own test says what would run: fuel, an engine and a hull past use, and a boat flooded", () => {
  expect([vehicleWouldRun(0.01, 0.09, 0.01, 0.74), vehicleWouldRun(0, 1, 1, 0), vehicleWouldRun(1, 0.08, 1, 0), vehicleWouldRun(1, 1, 0, 0), vehicleWouldRun(1, 1, 1, 0.75)]).toEqual([true, false, false, false, false]);
});

test("a vehicle is worth walking to while it would run, has a seat, is no wreck and is nobody's or the viewer's", () => {
  const r = parked(["core:compact", "core:needle"]);
  expect([usableVehicle(reg, r, 0, 0), usableVehicle(reg, r, 1, 7)]).toEqual([true, true]);
  const not = (set: (r: RemoteSample) => void, i = 0, team = 0): boolean => { const s = parked(["core:compact", "core:needle"]); set(s); return usableVehicle(reg, s, i, team); };
  expect(not((s) => { s.vehicleFuel[0] = 0; })).toBe(false);
  expect(not((s) => { s.vehicleEngineCondition[0] = 0.05; })).toBe(false);
  expect(not((s) => { s.flags[0] = 8; })).toBe(false);
  expect(not((s) => { s.cue[0] = CUE_DEAD; })).toBe(false);
  // A boat's hull and flooding count; a car's are not read.
  expect([not((s) => { s.vehicleFlooding[1] = 0.8; }, 1), not((s) => { s.vehicleHullCondition[1] = 0; }, 1), not((s) => { s.vehicleFlooding[0] = 0.8; s.vehicleHullCondition[0] = 0; })]).toEqual([false, false, true]);
  // Another tribe's is never marked; the viewer's own tribe's is.
  expect([not((s) => { s.team[0] = 5; }, 0, 0), not((s) => { s.team[0] = 5; }, 0, 6), not((s) => { s.team[0] = 5; }, 0, 5)]).toEqual([false, false, true]);
  // Every seat taken.
  const full = parked(["core:compact"]);
  const seats = reg.vehicle[kind("core:compact")]!.seats.length;
  for (let k = 0; k < seats; k++) { const j = full.count++; full.id[j] = 300 + k; full.seat[j] = full.id[0]! + 1; full.seatGen[j] = 1; full.seatSlot[j] = k + 1; full.kind[j] = kind("core:survivor"); }
  expect(usableVehicle(reg, full, 0, 0)).toBe(false);
  // A skateboard is not one.
  expect(usableVehicle(reg, parked([reg.ids[reg.vehicle.findIndex((v) => isSkateboard(v))]!]), 0, 0)).toBe(false);
});

test("a usable vehicle shimmers once as it comes near in view, again when aimed at, six seconds apart at least", () => {
  const r = parked(["core:compact"]), s = new Shimmer(), seen = (): boolean => true;
  const at = (now: number, x: number, aimed = -1, visible = seen): number => { s.update(now, reg, r, 0, x, 0, 0, visible, aimed); return s.count; };
  // Sixty metres off it does nothing; out of view it waits; in view within forty it begins.
  expect([at(0, -60), at(16, -20, -1, () => false), at(32, -20)]).toEqual([0, 0, 1]);
  expect([s.ids[0], s.phase[0]]).toEqual([100, 0]);
  // It runs its moment and ends, and standing there does not begin it again.
  expect(at(32 + SHIMMER_MS / 2, -20)).toBe(1);
  expect(s.phase[0]).toBeCloseTo(0.5, 5);
  expect([at(32 + SHIMMER_MS, -20), at(4000, -20)]).toEqual([0, 0]);
  // The aim on it begins another, but not within the gap; nor past thirty metres.
  expect([at(4100, -15, 100), at(31 + SHIMMER_GAP_MS, -15, 100), at(40 + SHIMMER_GAP_MS, -25, 100), at(56 + SHIMMER_GAP_MS, -15, 100)]).toEqual([0, 0, 0, 1]);
  expect(at(30000, 0, 100)).toBe(1);
  // Left and come back, it shimmers again for coming near.
  expect([at(40000, -80), at(50000, -20)]).toEqual([0, 1]);
  // One that would not start never does.
  r.vehicleFuel[0] = 0;
  expect([at(70000, -80), at(80000, -20), at(80016, -20, 100)]).toEqual([0, 0, 0]);
});

test("four shimmer at once at most, the nearest first, and the rest when there is room", () => {
  const r = parked(Array.from({ length: 7 }, () => "core:compact")), s = new Shimmer();
  s.update(0, reg, r, 0, 0, 0, 0, () => true, -1);
  expect(s.count).toBe(SHIMMER_MOST);
  expect(Array.from(s.ids).sort()).toEqual([100, 101, 102, 103]);
  // The three left out came near all the same, so they do not begin later for it.
  s.update(SHIMMER_MS + 1, reg, r, 0, 0, 0, 0, () => true, -1);
  expect(s.count).toBe(0);
});
