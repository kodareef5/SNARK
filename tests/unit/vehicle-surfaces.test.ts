import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Body } from "../../shared/sim/character.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";

const { registry: reg, errors } = compileContent(CORE_CONTENT);
if (!reg || errors.length) throw new Error(errors.join("\n"));
function roadWorld() {
  const dims = { chunksX: 2, chunksZ: 2 }, hf = new Heightfield(dims, 1, 0, 1 / 256);
  return { hf, structs: new StructureStore(dims, reg!.halfX, reg!.halfY, reg!.halfZ, null, reg!.parts) };
}

test("only the wheel's actual supporting structure supplies its physical road surface", () => {
  const world = roadWorld(), adapter = new StaticVehicleWorld(world), spec = COMPACT_VEHICLE.spec;
  const asphalt = reg!.index.get("core:road_asphalt")!, gravel = reg!.index.get("core:road_gravel")!;
  world.structs.add(asphalt, 36, 1 / 32, 32, 0, 0, 1500);
  world.structs.add(asphalt, 32, 2 + 1 / 32, 32, 0, 0, 1500);
  expect(adapter.support(32, 0, 32, spec)!.surface.id).toBe("ground");
  const ref = world.structs.add(asphalt, 32, 1 / 32, 32, 0, 0, 1500);
  expect(adapter.support(32, 0, 32, spec)!.surface.id).toBe("asphalt");
  expect(adapter.support(32, 0, 32, spec)!.y).toBeCloseTo(1 / 16, 5);
  world.structs.remove(ref);
  expect(adapter.support(32, 0, 32, spec)!.surface.id).toBe("ground");
  world.structs.add(gravel, 32, 1 / 32, 32, 0, 0, 1500);
  expect(adapter.support(32, 0, 32, spec)!.surface.id).toBe("gravel");
});

test("native paving changes acceleration through the same fixed-tick Body adapter used by driving", () => {
  const speeds: number[] = [];
  for (const surface of ["asphalt", "gravel", "mud"]) {
    const world = roadWorld(), kind = reg!.index.get(`core:road_${surface}`)!;
    for (let z = 10; z <= 76; z += 3) for (const x of [30.5, 33.5]) world.structs.add(kind, x, 1 / 32, z, 0, 0, 1500);
    const body = new Body(); body.vehicle = true; body.fuel = 40; body.x = 32; body.y = 1 / 16; body.z = 14;
    for (let tick = 0; tick < 90; tick++) stepVehicleBody(world, body, 0, 127, 0, COMPACT_VEHICLE);
    speeds.push(body.vz);
    expect(body.y).toBeCloseTo(1 / 16, 3);
    expect(body.z).toBeGreaterThan(18);
  }
  expect(speeds[0]!).toBeGreaterThan(speeds[1]! * 1.2);
  expect(speeds[1]!).toBeGreaterThan(speeds[2]! * 1.2);
});

test("malformed road physics is rejected by content compilation before joining a world", () => {
  for (const value of [null, { id: "bad", grip: NaN, rolling: .1, drag: .01 }, { id: "bad", grip: 5, rolling: -1, drag: .01 }]) {
    const defs = CORE_CONTENT.map(d => d.id === "core:road_asphalt" ? { ...d, vehicleSurface: value } : d);
    const result = compileContent(defs as typeof CORE_CONTENT);
    expect(result.registry).toBeNull(); expect(result.errors.some(e => e.includes("vehicleSurface"))).toBe(true);
  }
});
