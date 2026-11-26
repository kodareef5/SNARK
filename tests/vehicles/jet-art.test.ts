// The jet's pack and its simulation agree (content/vehicles/jet-art.ts): its rig is the one its measures were written
// for, its wheels are where the simulation stands it, and its parts fill the boxes shots and contacts meet.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import rig from "../../content/vehicles/jet-rig.json" with { type: "json" };
import { JET_ART as A } from "../../content/vehicles/jet-art.ts";
import { JET, JET_VEHICLE } from "../../content/vehicles/jet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { measureSurface } from "../../tools/art/check.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";

const art = fromArt(() => {
  const pack = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/vehicles/jet/jet.snpk", import.meta.url))));
  return { pack, mesh: unpackMeshes(pack)[0]!, rig: pack.header.rigs[0]! };
});

test("the pack's rig is the jet's: its bones, their parents and pivots, and its anchors", () => {
  const names = Object.keys(rig.pivots);
  expect([art.rig.id, art.rig.skeleton, art.rig.names]).toEqual(["core:jet", "core:jet", names]);
  expect(art.rig.parent).toEqual(names.map((n, i) => i === 0 ? -1 : names.indexOf((rig.parents as Record<string, string>)[n] ?? "chassis")));
  art.rig.rest.forEach((value, i) => expect(value).toBeCloseTo(A.pivots[names[Math.floor(i / 3)]!]![i % 3]!, 3));
  expect(art.rig.sockets!.map((s) => s.name)).toEqual(Object.keys(rig.anchors));
});

test("the simulation stands the jet on the model's wheels and seats its pilot in its cockpit", () => {
  expect([JET.noseGear, JET.mainGear, JET.gearTrack]).toEqual([A.noseGear, A.mainGear, A.gearTrack]);
  const seat = JET_VEHICLE.seats[0]!;
  expect(seat.anchor).toEqual(A.seat);
  expect(JET_VEHICLE.weapons!.cannon!.muzzle).toEqual(A.muzzle);
  expect(JET_VEHICLE.weapons!.missiles!.rail).toEqual(A.rail);
  // Each wheel's lowest point is on the ground the simulation stands it on, under the belly's clearance.
  const fine = art.mesh.lods[0]!, wheels = ["wheel_nose", "wheel_main_left", "wheel_main_right"].map((n) => art.rig.names!.indexOf(n));
  for (const w of wheels) {
    let low = Infinity;
    for (let v = 0; v < fine.positions.length / 3; v++) if (fine.bones![v] === w) low = Math.min(low, fine.positions[v * 3 + 1]!);
    expect(low).toBeCloseTo(0, 1);
  }
  expect(A.belly).toBeGreaterThanOrEqual(JET.clearance);
});

test("the finest mesh lies within the jet's half sizes, and its body boxes within the mesh", () => {
  const fine = art.mesh.lods[0]!, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < fine.positions.length / 3; v++) for (let k = 0; k < 3; k++) {
    low[k] = Math.min(low[k]!, fine.positions[v * 3 + k]!); high[k] = Math.max(high[k]!, fine.positions[v * 3 + k]!);
  }
  expect(Math.max(-low[0]!, high[0]!)).toBeLessThanOrEqual(JET.halfWidth + .01);
  expect(Math.max(-low[2]!, high[2]!)).toBeLessThanOrEqual(JET.halfLength + .01);
  expect(high[1]!).toBeLessThanOrEqual(JET.height + .01);
  for (const b of JET.bodyBoxes) for (let k = 0; k < 3; k++) {
    expect(b.at[k]! - b.half[k]!).toBeGreaterThanOrEqual(low[k]! - .3);
    expect(b.at[k]! + b.half[k]!).toBeLessThanOrEqual(high[k]! + .3);
  }
});

test("every built level is closed and outward, within budget, and keeps the moving bones", () => {
  const budgets = [18000, 9000, 2600, 1000, 480];
  expect(art.mesh.lods.length).toBe(budgets.length);
  art.mesh.lods.forEach((lod, level) => {
    expect(lod.indices.length / 3).toBeLessThanOrEqual(budgets[level]!);
    const facts = measureSurface(lod);
    expect([facts.holes, facts.flipped, facts.insideOut]).toEqual([0, 0, 0]);
  });
  const fine = art.mesh.lods[0]!, used = new Set(fine.bones!);
  for (const name of ["gear_nose", "gear_main_left", "nozzle", "aileron_left", "stabilator_right", "rudder_left", "burner"]) expect(used.has(art.rig.names!.indexOf(name)), name).toBe(true);
});
