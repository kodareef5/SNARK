// Vehicles are heard from the state their snapshots carry: a helicopter and a boat by their own families, a car by the shared car's.
import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { VEHICLE_LOOPS, VehicleSounds, engineLayers } from "../../client/core/sound/vehicles.ts";
import { BOATS } from "../../content/vehicles/boat.ts";
import { HELICOPTERS } from "../../content/vehicles/helicopter.ts";
import { KEYS, cueKey, vehicleFamilies } from "../../shared/sound/cues.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { flatWorld } from "../fixtures/world.ts";

test("every livery and wreck is heard by its vehicle's family before the shared car's", () => {
  for (const d of HELICOPTERS) expect(vehicleFamilies(d.id, d.aliases)).toEqual(["core:helicopter"]);
  for (const d of BOATS) expect(vehicleFamilies(d.id, d.aliases)).toEqual(["core:boat"]);
  expect(vehicleFamilies("core:boat_wreck")).toEqual(["core:boat"]);
  expect(vehicleFamilies("core:helicopter_wreck")).toEqual(["core:helicopter"]);
  expect(vehicleFamilies("core:compact_abandoned")).toEqual([]);
  const r = new Resolver(new Map([["core:helicopter/sound/engine/idle", 3], ["core:boat/sound/engine/idle", 4], ["core:vehicle/sound/engine/idle", 9]]), (id) => vehicleFamilies(id));
  expect(r.find(r.owner("core:helicopter_police"), cueKey("engine/idle"))).toBe(3);
  expect(r.find(r.owner("core:boat_rescue"), cueKey("engine/idle"))).toBe(4);
  expect(r.find(r.owner("core:compact"), cueKey("engine/idle"))).toBe(9);
});

/** One vehicle in a sample, and what a frame of `VehicleSounds` asks for it: one-shots, and the loops it keeps on. */
function hearing(id: string, hf = flatWorld().hf) {
  const w = flatWorld(), r = new RemoteSample(), v = new VehicleSounds(w.reg, (o) => (o === id ? 5 : -1));
  r.count = 1; r.id[0] = 7; r.kind[0] = w.kind(id); r.x[0] = 30; r.y[0] = 4; r.z[0] = 30;
  const heard: string[] = [], looped: string[] = [], wanted: string[] = [];
  const frame = (ez = 40): void => {
    looped.length = 0;
    wanted.length = 0;
    v.update(r, hf, 30, 2, ez, -1, (owner, key) => heard.push(`${owner} ${KEYS[key]!.key}`), (slot, owner, key, _x, _y, _z, _level, on) => { if (on) looped.push(`${slot - VEHICLE_LOOPS - 7 * 8} ${owner} ${KEYS[key]!.key}`); }, (owner, key) => wanted.push(`${owner} ${KEYS[key]!.key}`));
  };
  return { r, heard, looped, wanted, frame };
}

test("a rotorcraft's engine layers follow its rotor, its start is heard once and held before while it is near, and its wash only near what is under it", () => {
  const layers = (share: number): number[] => engineLayers(share).map((l) => Math.round(l * 100) / 100);
  expect(layers(0)).toEqual([0, 0, 0, 0]);
  expect(layers(0.4)).toEqual([0.07, 1, 0, 0]);
  expect(layers(1)).toEqual([0, 0, 0, 1]);
  const { r, heard, looped, wanted, frame } = hearing("core:helicopter_police");
  frame(100);
  expect(wanted).toEqual([]);
  frame();
  expect([heard, looped, wanted]).toEqual([[], [], ["5 engine/start", "5 engine/stop"]]);
  r.vehicleEngineOn[0] = 1; r.vehicleRotorRpm[0] = 410;
  frame(); frame();
  expect(heard).toEqual(["5 engine/start"]);
  expect(looped).toEqual(["3 5 engine/high", "5 5 vehicle/wash"]);
  r.y[0] = 40;
  frame();
  expect(looped).toEqual(["3 5 engine/high"]);
});

test("a car's engine runs while its driver's seat is taken and it has fuel: started as the driver sits, its layers by rpm, stopped as they leave", () => {
  const { r, heard, looped, frame } = hearing("core:compact");
  r.vehicleFuel[0] = 1; r.vehicleRpm[0] = 850;
  frame();
  expect([heard, looped]).toEqual([[], []]);
  r.count = 2; r.id[1] = 9; r.seat[1] = 8; r.seatSlot[1] = 2;
  frame();
  expect([heard, looped]).toEqual([[], []]);
  r.seatSlot[1] = 1;
  frame();
  expect(heard).toEqual(["5 engine/start"]);
  expect(looped).toEqual(["0 5 engine/idle", "1 5 engine/low"]);
  r.vehicleRpm[0] = 6800;
  frame();
  expect(looped).toEqual(["3 5 engine/high"]);
  r.seat[1] = 0;
  frame();
  expect([heard, looped]).toEqual([["5 engine/start", "5 engine/stop"], []]);
  r.seat[1] = 8; r.vehicleFuel[0] = 0;
  frame();
  expect(heard.length).toBe(2);
});

test("a boat's engine follows its rpm, and the water at its hull runs fast at speed", () => {
  const sea = new Heightfield({ chunksX: 2, chunksZ: 2 }, 2, -32, 1 / 256);
  sea.heights.fill(4096);
  sea.seaLevel = 0;
  const { r, heard, looped, frame } = hearing("core:boat_police", sea);
  r.y[0] = -0.35;
  frame();
  expect(looped).toEqual(["5 5 vehicle/hull/slow"]);
  r.vehicleEngineOn[0] = 1; r.vehicleRpm[0] = 5600;
  frame();
  expect(heard).toEqual(["5 engine/start"]);
  expect(looped).toEqual(["3 5 engine/high", "6 5 vehicle/hull/fast"]);
});
