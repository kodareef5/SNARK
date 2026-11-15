import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPACT } from "../../content/urban/compact.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { OFFROAD } from "../../shared/world/vehicle-surface.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { seedUrbanRoads } from "../../tools/urban/fixtures.ts";

const hostOptions = { dev: true, clips: NO_CLIPS, rigs: [] };
const kindAt = (h: Harness, ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 65535]!;

test("the native development road strips are continuous and normal restarts do not regenerate removed paving", () => {
  const h = new Harness({}, 1, 60, hostOptions);
  try {
    expect(seedUrbanRoads(h.host)).toBe(72);
    const world = new StaticVehicleWorld(h.world);
    for (const [lane, surface] of ["asphalt", "gravel", "mud"].entries()) {
      for (let z = h.world.spawn.z - 5; z >= h.world.spawn.z - 40; z--) {
        expect(world.support(h.world.spawn.x + 12 + lane * 9, 0, z, COMPACT)!.surface.id).toBe(`urban:${surface}`);
      }
    }
    let removed = false;
    for (const [chunk, row] of h.world.structs.chunks.entries()) if (row) {
      for (let slot = 0; slot < row.high && !removed; slot++) if (h.reg.parts.vehicleSurface?.[row.kind[slot]!]) {
        h.world.structs.remove(chunk * 65536 + slot); removed = true;
      }
    }
    expect(removed).toBe(true); expect(seedUrbanRoads(h.host)).toBe(0);
  } finally { h.host.shutdown(); }
});

test("native road kinds replicate, update existing wheel adapters and persist through SQLite", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-road-replication-")), dbPath = join(dir, "world.db");
  let active: Harness | null = null;
  try {
    const h = new Harness({}, 1, 60, { ...hostOptions, dbPath }); active = h;
    const reader = h.join("road-reader"); h.run(400);
    const ground = flatGround(h, 16, 16), x = ground.x + 8, z = ground.z + 8;
    h.say(reader, "enablecheats"); h.say(reader, `tp ${x + 4} ${z}`);
    const local = new StaticVehicleWorld(h.world), remote = new StaticVehicleWorld(reader.world!);
    const sample = (adapter: StaticVehicleWorld) => adapter.support(x, ground.y, z, COMPACT)!.surface;
    const seen = (ref: number) => reader.world!.structs.chunks[Math.floor(ref / 65536)]?.kind[ref & 65535] ?? 0;
    const asphalt = h.reg.index.get("urban:road_asphalt")!, gravel = h.reg.index.get("urban:road_gravel")!;
    expect([sample(local), sample(remote)]).toEqual([OFFROAD, OFFROAD]);
    const before = h.server.stats.chunkBytes;
    const first = h.world.structs.add(asphalt, x, ground.y + 1 / 32, z, 0, 0, 1500);
    expect(first).toBeGreaterThanOrEqual(0); h.run(400);
    const authoredAsphalt = h.reg.parts.vehicleSurface![asphalt]!;
    expect(h.server.stats.chunkBytes).toBeGreaterThan(before);
    expect(seen(first)).toBe(asphalt);
    expect([sample(local), sample(remote)]).toEqual([authoredAsphalt, authoredAsphalt]);
    expect(remote.support(x, ground.y, z, COMPACT)!.y).toBeCloseTo(ground.y + 1 / 16, 5);

    h.world.structs.remove(first); h.run(400);
    expect(seen(first)).toBe(0);
    // Reuse the same adapters: neither support nor the surface facet may cache a removed road.
    expect([sample(local), sample(remote)]).toEqual([OFFROAD, OFFROAD]);
    const second = h.world.structs.add(gravel, x, ground.y + 1 / 32, z, 0, 0, 1500);
    h.run(400);
    const authoredGravel = h.reg.parts.vehicleSurface![gravel]!;
    expect(seen(second)).toBe(gravel);
    expect([sample(local), sample(remote)]).toEqual([authoredGravel, authoredGravel]);
    h.host.shutdown(); active = null;

    const restored = new Harness({}, 1, 60, { ...hostOptions, dbPath }); active = restored;
    const joined = restored.join("road-reader"); restored.run(500);
    expect(kindAt(restored, second)).toBe(gravel);
    expect(joined.world!.structs.chunks[Math.floor(second / 65536)]!.kind[second & 65535]).toBe(gravel);
    const authority = new StaticVehicleWorld(restored.world), predicted = new StaticVehicleWorld(joined.world!);
    expect([authority.support(x, ground.y, z, COMPACT)!.surface, predicted.support(x, ground.y, z, COMPACT)!.surface]).toEqual([authoredGravel, authoredGravel]);
  } finally { active?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("a v3 moving vehicle component migrates to v4 without losing its existing physical state", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-vehicle-v3-")), dbPath = join(dir, "world.db");
  let active: Harness | null = null;
  try {
    const h = new Harness({}, 1, 60, { ...hostOptions, dbPath }); active = h;
    const ground = flatGround(h, 12, 12), car = h.host.spawnVehicle("urban:compact", ground.x + 6, ground.z + 6);
    expect(car).toBeGreaterThanOrEqual(0);
    const pid = h.world.ents.pid[car]!, record = h.host.records.byPid.get(pid)!;
    // Exact pre-drivetrain v3 layout: sixteen f32 values followed by the grounded byte.
    const fields = ["vehicleYaw", "vehiclePitch", "vehicleRoll", "steering", "wheelAngle", "fuel", "vehicleYawRate", "vehiclePitchRate", "vehicleRollRate", "vehicleGroundPitch", "vehicleGroundRoll", "vehicleRideOffset", "vehicleRideVelocity", "vx", "vy", "vz"] as const;
    const values = [.3, .04, -.02, .1, 1.25, 17.5, .12, .08, -.03, .02, -.01, .02, -.2, 3, -4, 6];
    const bytes = new Uint8Array(66), view = new DataView(bytes.buffer); bytes[0] = 3;
    values.forEach((value, index) => view.setFloat32(1 + index * 4, value, true)); bytes[65] = 0;
    record.extra.set(0x757262, bytes); h.host.records.dirty.add(pid);
    h.host.shutdown(); active = null;

    const restored = new Harness({}, 1, 60, { ...hostOptions, dbPath }); active = restored;
    const e = restored.host.records.entOf.get(pid)!, ents = restored.world.ents;
    expect(e).toBeGreaterThanOrEqual(0);
    expect(fields.map(field => ents[field][e])).toEqual(values.map(Math.fround));
    expect(ents.flags[e]! & F_GROUNDED).toBe(0);
    expect([ents.vehicleGear[e], ents.vehicleShiftTime[e], ents.vehiclePayloadMass[e]]).toEqual([0, 0, 0]);
    expect(ents.vehicleRpm[e]).toBe(COMPACT.drivetrain!.idleRpm);
    const upgraded = restored.host.records.byPid.get(pid)!.extra.get(0x757262)!;
    expect(upgraded[0]).toBe(4); expect(upgraded.length).toBe(82);
  } finally { active?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
