import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { VEHICLE_LOOPS, VehicleSounds, engineLayers } from "../../client/core/sound/vehicles.ts";
import { HELICOPTERS } from "../../content/vehicles/helicopter.ts";
import { KEYS, cueKey, vehicleFamilies } from "../../shared/sound/cues.ts";
import { flatWorld } from "../fixtures/world.ts";

test("every helicopter livery is heard by the helicopter's family before the shared car's", () => {
  for (const d of HELICOPTERS) expect(vehicleFamilies(d.id, d.aliases)).toEqual(["core:helicopter"]);
  expect(vehicleFamilies("core:compact_abandoned")).toEqual([]);
  const r = new Resolver(new Map([["core:helicopter/sound/engine/idle", 3], ["core:vehicle/sound/engine/idle", 9]]), (id) => vehicleFamilies(id));
  expect(r.find(r.owner("core:helicopter_police"), cueKey("engine/idle"))).toBe(3);
  expect(r.find(r.owner("core:compact"), cueKey("engine/idle"))).toBe(9);
});

test("a rotorcraft's engine layers follow its rotor, its start is heard once, and its wash only near what is under it", () => {
  const w = flatWorld(), police = w.kind("core:helicopter_police");
  const layers = (share: number): number[] => engineLayers(share).map((l) => Math.round(l * 100) / 100);
  expect(layers(0)).toEqual([0, 0, 0, 0]);
  expect(layers(0.4)).toEqual([0.07, 1, 0, 0]);
  expect(layers(1)).toEqual([0, 0, 0, 1]);
  const r = new RemoteSample();
  r.count = 1; r.id[0] = 7; r.kind[0] = police; r.x[0] = 30; r.y[0] = 4; r.z[0] = 30; r.vehicleRotorRpm[0] = 0;
  const v = new VehicleSounds(w.reg, (id) => (id === "core:helicopter_police" ? 5 : -1));
  const heard: string[] = [], looped = new Map<number, string>();
  const frame = (): void => {
    looped.clear();
    v.update(r, w.hf, 30, 2, 40, -1, (owner, key) => heard.push(`${owner} ${KEYS[key]!.key}`), (id, owner, key, _x, _y, _z, _level, on) => { if (on) looped.set(id - VEHICLE_LOOPS - 7 * 8, `${owner} ${KEYS[key]!.key}`); });
  };
  frame();
  expect(heard).toEqual([]);
  expect(looped.size).toBe(0);
  r.vehicleEngineOn[0] = 1; r.vehicleRotorRpm[0] = 410;
  frame(); frame();
  expect(heard).toEqual(["5 engine/start"]);
  expect([...looped.values()]).toEqual(["5 engine/high", "5 vehicle/wash"]);
  r.y[0] = 40;
  frame();
  expect([...looped.values()]).toEqual(["5 engine/high"]);
});
