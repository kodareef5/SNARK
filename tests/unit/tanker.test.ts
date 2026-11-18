import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TANKER_VEHICLE } from "../../content/vehicles/tanker.ts";
import { ASPHALT } from "../../content/vehicles/compact.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { createVehicle, stepVehicle, type VehicleWorld } from "../../shared/sim/vehicle.ts";
import { vehiclePlane } from "../fixtures/vehicle-plane.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

test("the tandem bears load at the three actual axle stations and drives, corners, stops and reverses", () => {
  const p = TANKER_VEHICLE.spec,
    state = createVehicle(p, 0, 0, 0),
    plane = vehiclePlane(ASPHALT);
  const probes = new Set<string>();
  const road: VehicleWorld = {
    ...plane,
    wheelRay(...args) {
      probes.add(`${args[0].toFixed(2)}/${args[2].toFixed(2)}`);
      return plane.wheelRay(...args);
    },
  };
  const drive = (n: number, throttle: number, steer = 0, brake = 0, world = plane) => {
    for (let i = 0; i < n; i++) stepVehicle(state, { throttle, steer, brake, handbrake: false }, p, world);
  };
  drive(1, 0, 0, 1, road);
  for (const axle of p.axles!)
    for (const side of [-1, 1])
      expect(probes.has(`${((side * axle.track) / 2).toFixed(2)}/${axle.z.toFixed(2)}`)).toBe(true);
  drive(90, 0, 0, 1);
  expect(Math.abs(state.pitch)).toBeLessThan(0.002);
  drive(180, 1);
  expect(state.z).toBeGreaterThan(30);
  expect(state.gear).toBeGreaterThan(1);
  drive(45, 0.5, 0.7);
  expect(state.yaw).toBeGreaterThan(0.3);
  expect(Math.abs(state.roll)).toBeLessThan(0.28);
  drive(150, 0, 0, 1);
  expect(Math.hypot(state.vx, state.vz)).toBeLessThan(0.02);
  const stopped = state.z;
  drive(100, -1);
  expect(state.gear).toBe(-1);
  expect(state.z).toBeLessThan(stopped - 3);
});

artTest("both hand-built road silhouettes keep the six tyre contact patches on the road", () => {
  const pack = parsePack(
    readFileSync(new URL("../../assets/source/core/vehicles/tanker/tanker.snpk", import.meta.url)),
  );
  const mesh = unpackMeshes(pack)[0]!,
    rig = pack.header.rigs[0]!;
  for (const level of mesh.lods.slice(-2))
    for (const wheel of TANKER_VEHICLE.wheels) {
      const bone = rig.names!.indexOf(wheel.bone),
        z = rig.rest[bone * 3 + 2]!;
      let ground = Infinity,
        top = -Infinity,
        nose = -Infinity,
        tail = Infinity;
      for (let i = 0; i < level.bones!.length; i++)
        if (level.bones![i] === bone) {
          ground = Math.min(ground, level.positions[i * 3 + 1]!);
          top = Math.max(top, level.positions[i * 3 + 1]!);
          tail = Math.min(tail, level.positions[i * 3 + 2]!);
          nose = Math.max(nose, level.positions[i * 3 + 2]!);
        }
      expect(ground).toBeCloseTo(0, 3);
      expect(top).toBeCloseTo(1.04, 3);
      expect(nose - z).toBeCloseTo(0.52, 3);
      expect(z - tail).toBeCloseTo(0.52, 3);
    }
});

artTest("all eight scenery pieces have grounded meshes, collision and a cheaper fourth level", async () => {
  const { TANKER_WRECKS } = await import("../../content/vehicles/tanker-wrecks.ts");
  const pack = parsePack(
    readFileSync(new URL("../../assets/source/core/vehicles/tanker_wrecks/tanker_wrecks.snpk", import.meta.url)),
  );
  const meshes = unpackMeshes(pack);
  expect(meshes).toHaveLength(8);
  for (const mesh of meshes) {
    const prop = TANKER_WRECKS.find((d) => d.id === mesh.id);
    if (prop?.type !== "structure") throw new Error(`Missing scenery definition for ${mesh.id}`);
    const shape = TANKER_WRECKS.find((d) => d.id === prop.shape);
    if (shape?.type !== "shape") throw new Error(`Missing collision for ${mesh.id}`);
    const boxes = shape.boxes!;
    expect(boxes.length).toBeGreaterThan(0);
    for (const lod of mesh.lods) {
      let floor = Infinity;
      for (let i = 1; i < lod.positions.length; i += 3) floor = Math.min(floor, lod.positions[i]!);
      expect(floor).toBeCloseTo(0, 2);
    }
    expect(mesh.lods).toHaveLength(4);
    expect(mesh.lods[3]!.indices.length / 3).toBeLessThan(880);
    if (mesh.id === "core:tanker_separated")
      expect(boxes.some((box) => Math.abs(2.3 - box.at[0]) < box.half[0])).toBe(false);
  }
});
