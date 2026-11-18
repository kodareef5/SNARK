import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASPHALT } from "../../content/vehicles/compact.ts";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { createVehicle, isWheelVehicle, stepVehicle, type VehicleSpec, type WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Stage } from "../fixtures/stage.ts";
import { vehiclePlane } from "../fixtures/vehicle-plane.ts";

const defs = ROAD_FLEET.map(model => {
  if (!model.vehicle || !isWheelVehicle(model.vehicle)) throw new Error(`missing wheel chassis for ${model.id}`);
  return model.vehicle;
});

function drive(spec: VehicleSpec, seconds: number, throttle = 1, initialSpeed = 0) {
  const state = createVehicle(spec, 0, 0, 0), road = vehiclePlane(ASPHALT);
  state.vz = initialSpeed;
  for (let tick = 0; tick < seconds * TICK_RATE; tick++)
    stepVehicle(state, { throttle, steer: 0, brake: 0, handbrake: false }, spec, road);
  return state;
}

test("the sports frame loads its tyres with speed and both bodies outrun the compact and vans", () => {
  expect(defs.map(d => d.frame)).toEqual(["car", "car", "sports_car", "sports_car", "van", "van", "car", "off_road", "van", "van", "van"]);
  const speeds = defs.map(d => drive(d.spec, 4).vz);
  expect(speeds[0]).toBe(speeds[1]!);
  for (const i of [2, 3]) {
    expect(speeds[i]!).toBeGreaterThan(speeds[0]! * 1.2);
    const spec = defs[i]!.spec;
    expect(drive(spec, 1, 0, 40).rideOffset).toBeLessThan(drive({ ...spec, downforce: 0 }, 1, 0, 40).rideOffset - .005);
  }
  for (const i of [4, 5]) expect(speeds[i]!).toBeLessThan(speeds[0]!);
});

test("the patrol 4×4 compresses and rebounds on landing while the lower cruiser settles sooner", () => {
  const road = vehiclePlane(ASPHALT);
  function land(id: string) {
    const spec = defs.find(d => d.id === id)!.spec, state = createVehicle(spec, 0, .25, 0);
    let lowest = 0, rebound = 0;
    for (let tick = 0; tick < 3 * TICK_RATE; tick++) {
      stepVehicle(state, { throttle: 0, steer: 0, brake: 0, handbrake: false }, spec, road);
      lowest = Math.min(lowest, state.y);
      if (lowest < -.001) rebound = Math.max(rebound, state.y);
    }
    expect(state.grounded).toBe(true);
    expect(Math.abs(state.y)).toBeLessThan(.004);
    return { lowest, rebound };
  }
  const jeep = land("core:patrol_jeep"), sedan = land("core:patrol_sedan");
  expect(jeep.lowest).toBeLessThan(sedan.lowest - .045);
  expect(jeep.rebound).toBeGreaterThan(sedan.rebound + .014);
});

artTest("every selectable body ships its own native geometry, rigid moving parts, seat sockets and distance levels", () => {
  for (const def of defs) {
    const name = def.id.split(":")[1]!;
    const file = join(import.meta.dir, "../../assets/source/core/vehicles", name, name + ".snpk");
    const pack = parsePack(readFileSync(file)), mesh = unpackMeshes(pack).find(m => m.id === def.id)!;
    const rig = pack.header.rigs.find(r => r.id === def.id)!;
    expect(mesh.lods.length).toBe(6);
    expect(mesh.lods.at(-1)!.indices.length).toBeLessThan(mesh.lods[0]!.indices.length);
    const fine = mesh.lods[0]!, bound = new Set(fine.bones);
    for (const level of mesh.lods) {
      const moving = new Set(level.bones);
      for (const part of [...def.doors, ...def.wheels]) expect(moving.has(rig.names!.indexOf(part.bone))).toBe(true);
    }
    for (const part of [...def.doors, ...def.wheels, def.steeringWheel!]) {
      const bone = rig.names!.indexOf(part.bone);
      expect(bone).toBeGreaterThanOrEqual(0);
      expect(bound.has(bone)).toBe(true);
    }
    const joint = (i: number) => rig.rest.slice(i * 3, i * 3 + 3);
    for (const [i, w] of def.wheels.entries()) {
      const [x, y, z] = joint(rig.names!.indexOf(w.bone));
      const axle=def.spec.axles?.[i >> 1];
      expect(x).toBeCloseTo((i % 2 ? -1 : 1) * (axle?.track ?? def.spec.track) / 2, 4);
      expect(y).toBeCloseTo(def.spec.wheelRadius, 4);
      expect(z).toBeCloseTo(axle?.z ?? (i < 2 ? 1 : -1) * def.spec.wheelbase / 2, 4);
    }
    checkSeats(def, rig.sockets ?? []);
    const p = fine.positions, limits = [def.spec.halfWidth, def.spec.height, def.spec.halfLength];
    const extent = [0, 0, 0]; let ground = Infinity;
    for (let v = 0; v < p.length; v += 3) {
      ground = Math.min(ground, p[v + 1]!);
      for (let k = 0; k < 3; k++) extent[k] = Math.max(extent[k]!, Math.abs(p[v + k]!));
    }
    expect(ground).toBeCloseTo(0, 2);
    for (let k = 0; k < 3; k++) {
      expect(extent[k]!).toBeLessThanOrEqual(limits[k]! + .006);
      expect(extent[k]!).toBeGreaterThan(limits[k]! * .89);
    }
  }
});

function checkSeats(def: WheelVehicleDefinition, sockets: readonly { name: string; x: number; y: number; z: number }[]) {
  for (const seat of def.seats) {
    const s = sockets.find(s => s.name === `seat_${seat.id === "passenger" ? "front_passenger" : seat.id}`)!;
    expect([s.x, s.y, s.z]).toEqual([...seat.anchor]);
  }
}

artTest("all road cockpits retain a forward sightline when glass textures are unavailable", () => {
  for (const def of defs) {
    const name = def.id.split(":")[1]!;
    const file = join(import.meta.dir, "../../assets/source/core/vehicles", name, name + ".snpk");
    const pack = parsePack(readFileSync(file)), record = pack.header.rigs.find(r => r.id === def.id)!;
    const rig = buildRig(record, pack.clips)!, eye = record.sockets!.find(s => s.name === "camera_driver")!;
    const stage = new Stage(pack, 240, 135);
    Object.assign(stage.cam, { x: eye.x, y: eye.y, z: eye.z, pitch: -.07, yaw: 0, fovY: 1.2 });
    const ahead = { x: 0, y: 0, z: 8 }, origin = { x: 0, y: 0, z: 0 };
    function visible(level?: number): number {
      stage.begin();
      if (level !== undefined) stage.add(def.id, level, { ...origin, bone: stage.pose(rig, origin), flat: true });
      stage.add(def.id, 0, { ...ahead, bone: stage.pose(rig, ahead), flat: true });
      stage.render();
      const lead = level === undefined ? 1 : 2;
      return stage.raster.pickId.reduce((count, id) => count + Number(id === lead), 0);
    }
    const unobstructed = visible();
    expect(unobstructed).toBeGreaterThan(0);
    for (const level of [0, 1, 2]) expect(visible(level)).toBeGreaterThan(unobstructed * .35);
  }
});
