// A second kind of vehicle is content: its seats, doors, wheels and steering wheel are data, checked when it compiles,
// carried on the wire part by part and drawn from its definition. Nothing here names the compact.
import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, readViewDelta, writeViewDelta } from "../../shared/net/view.ts";
import { compilePacks, type DefPatch } from "../../shared/content/packs.ts";
import { CORE_PACK } from "../../content/core.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { MAX_VEHICLE_DOORS, validateVehicleDefinition, type VehicleDefinition } from "../../shared/sim/vehicle.ts";
import { packVehiclePose, vehicleDoor, withVehicleDoor } from "../../shared/sim/vehicle-body.ts";
import { COMPACT, COMPACT_SPECIES } from "../../content/vehicles/compact.ts";

/** A pickup with a bench of three and a tailgate: four doors, three seats, a wheel bone named its own way. */
export const PICKUP: VehicleDefinition = {
  id: "t:pickup",
  spec: { ...COMPACT, halfWidth: 1, halfLength: 2.7, height: 1.9, wheelbase: 3.4, track: 1.7, wheelRadius: 0.38, mass: 1900 },
  seats: [
    { id: "driver", driver: true, anchor: [0.45, 0.8, 0.4], entry: [1.4, 0, 0.4], door: 0 },
    { id: "passenger", anchor: [-0.45, 0.8, 0.4], entry: [-1.4, 0, 0.4], door: 1 },
    { id: "bed", anchor: [0, 0.9, -1.6], entry: [0, 0, -3.2], door: 3 },
  ],
  doors: [
    { bone: "door_fl", axis: [0, 1, 0], open: -1.2, openTicks: 8, closeTicks: 12 },
    { bone: "door_fr", axis: [0, 1, 0], open: 1.2, openTicks: 8, closeTicks: 12 },
    { bone: "hood", axis: [1, 0, 0], open: -0.9, openTicks: 20, closeTicks: 20 },
    { bone: "tailgate", axis: [1, 0, 0], open: 1.5, openTicks: 10, closeTicks: 10 },
  ],
  wheels: [{ bone: "hub_fl", steers: true }, { bone: "hub_fr", steers: true }, { bone: "hub_rl" }, { bone: "hub_rr" }],
  steeringWheel: { bone: "wheel", axis: [0, 0, 1], ratio: -6 },
  actionTicks: 24,
};

test("a second kind compiles beside the compact as content, with its own seats, doors and wheels", () => {
  const species: SpeciesDef = { ...COMPACT_SPECIES, id: "t:pickup", mesh: "t:pickup", skeleton: "t:pickup", aliases: ["pickup"], radius: 1, height: 1.9, mass: 1900, vehicle: PICKUP };
  const out = compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs: [species as unknown as DefPatch] }]);
  expect(out.errors).toEqual([]);
  const reg = out.registry!, kind = reg.index.get("t:pickup")!;
  expect(reg.vehicle[kind]!.seats.map((s) => s.id)).toEqual(["driver", "passenger", "bed"]);
  expect(reg.vehicle[kind]!.doors.length).toBe(4);
  expect(reg.vehicle[reg.index.get("core:compact")!]!.doors.length).toBe(2);
});

test("a vehicle that would not register or draw is refused when it compiles, with what is wrong", () => {
  const bad = (change: Partial<VehicleDefinition>): string => {
    try { validateVehicleDefinition({ ...PICKUP, ...change }); return ""; } catch (e) { return (e as Error).message; }
  };
  expect(bad({})).toBe("");
  expect(bad({ seats: [...PICKUP.seats, { ...PICKUP.seats[1]!, id: "other", driver: true }] })).toBe("a vehicle must have one driver seat");
  expect(bad({ seats: [{ ...PICKUP.seats[0]!, door: 4 }] })).toBe("invalid vehicle seat");
  expect(bad({ seats: [{ ...PICKUP.seats[0]!, id: "Driver" }] })).toBe("invalid vehicle seat");
  expect(bad({ doors: [...PICKUP.doors, PICKUP.doors[0]!] })).toBe("a vehicle has at most 4 doors");
  expect(bad({ doors: [{ ...PICKUP.doors[0]!, openTicks: 0 }, ...PICKUP.doors.slice(1)] })).toBe("invalid vehicle door");
  expect(bad({ actionTicks: 0 })).toBe("invalid vehicle action ticks");
  expect(bad({ steeringWheel: { bone: "", axis: [0, 0, 1], ratio: 1 } })).toBe("invalid steering wheel");
  const species: SpeciesDef = { ...COMPACT_SPECIES, id: "t:broken", aliases: [], radius: 1, height: 1.9, vehicle: { ...PICKUP, id: "t:broken", doors: [] } };
  const wide: SpeciesDef = { ...COMPACT_SPECIES, id: "t:wide", aliases: [], vehicle: { ...PICKUP, id: "t:wide" } };
  const out = compilePacks([CORE_PACK, { name: "t", requires: ["core"], defs: [species, wide] as unknown as DefPatch[] }]);
  expect(out.errors).toEqual(["t:broken: invalid vehicle seat", "t:wide: its radius and height must be its chassis half width and height"]);
});

test("four doors travel in one word, each on its own, and a door alone costs an update one part", () => {
  let packed = 0;
  for (let d = 0; d < MAX_VEHICLE_DOORS; d++) packed = withVehicleDoor(packed, d, d / 3);
  for (let d = 0; d < MAX_VEHICLE_DOORS; d++) expect(vehicleDoor(packed, d)).toBeCloseTo(d / 3, 2);
  expect(vehicleDoor(withVehicleDoor(packed, 2, 1), 1)).toBe(vehicleDoor(packed, 1));

  const store = new EntityStore({ chunksX: 2, chunksZ: 2 }, 2, 4);
  const car = store.create(1, 10, 0, 10, 0);
  const cur = new SentView(), sent = new SentView(), seen = new EntityView();
  cur.push(car, store.gen[car]!, 1, 100, 100, 100, 0, 0, 0, 0, 0, packVehiclePose(0, 0, 0), 7, 0, 0, 3);
  const w = new BitWriter(4096), r = new BitReader();
  writeViewDelta(w, null, cur, sent, 8192, 0, store);
  r.reset(w.bytes());
  expect(readViewDelta(r, null, seen)).toBe(true);
  // The tailgate alone opens: the update carries the door word and five part bits, and leaves the rest as they were.
  const opened = new SentView();
  opened.push(car, store.gen[car]!, 1, 100, 100, 100, 0, 0, 0, 0, 0, packVehiclePose(0, 0, 0), 7, 0, withVehicleDoor(0, 3, 1), 3);
  const next = new SentView(), shown = new EntityView();
  w.reset();
  writeViewDelta(w, sent, opened, next, 8192, 0, store);
  const doorOnly = w.pos;
  r.reset(w.bytes());
  expect(readViewDelta(r, seen, shown)).toBe(true);
  expect([vehicleDoor(shown.vehicleDoors[0]!, 3), shown.vehicleWheel[0], shown.vehicleDrive[0]]).toEqual([1, 7, 3]);
  // The same update with the wheel turned too is the door's bits and the wheel's 16 more.
  const rolled = new SentView();
  rolled.push(car, store.gen[car]!, 1, 100, 100, 100, 0, 0, 0, 0, 0, packVehiclePose(0, 0, 0), 9, 0, withVehicleDoor(0, 3, 1), 3);
  w.reset();
  writeViewDelta(w, sent, rolled, new SentView(), 8192, 0, store);
  expect(w.pos - doorOnly).toBe(16);
});
