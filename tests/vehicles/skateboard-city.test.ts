import { expect, test } from "bun:test";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { createMapWorld } from "../../server/world.ts";
import { withContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Body, BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";
import { BAIL, GRIND, OLLIE, ROLL, SLIDE } from "../../shared/sim/skate-state.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { MIAMI_CUT, miamiSlice } from "../fixtures/cityslice.ts";
import { coreRegistry, wrap } from "../fixtures/world.ts";

// Set SKATE_MIAMI_MAP to var/maps/miami.snmap to repeat these approaches on the complete city.
async function miami(): Promise<{ world: CollisionWorld; dx: number; dz: number }> {
  const { map } = miamiSlice();
  const path = process.env.SKATE_MIAMI_MAP;
  const full = path ? parseMap(await Bun.file(path).bytes()) : null;
  const world = full
    ? createMapWorld(withContent(coreRegistry(), full.content?.defs ?? []), full, { entityMax: 64 })
    : wrap(map.dims, mapHeightfield(map));
  if (!full) placeStatics(map, world.structs, coreRegistry());
  return { world, dx: full ? MIAMI_CUT.cx * CHUNK_SIZE : 0, dz: full ? MIAMI_CUT.cz * CHUNK_SIZE : 0 };
}

/** A board standing on whatever is under (x, z), facing yaw. */
function board(world: CollisionWorld, x: number, z: number, yaw: number): Body {
  const b = new Body();
  b.x = x; b.z = z; b.vehicleYaw = yaw;
  const above = world.hf.heightAt(b.x, b.z) + 1;
  expect(castWorld(world, b.x, above, b.z, 0, -1, 0, 2, true)).not.toBe(HIT_NONE);
  b.y = above - rayHit.t + .002; b.grounded = true;
  return b;
}

test("downtown Miami's kerbs carry two ollies over sidewalk seams", async () => {
  const { world, dx, dz } = await miami();
  for (const route of [
    { x: 354.207, z: 258.870, yaw: 1.502368 },
    { x: 328.992, z: 206.860, yaw: .142667 },
  ]) {
    const b = board(world, dx + route.x, dz + route.z, route.yaw);
    for (let t = 0; t < 38; t++) {
      stepVehicleBody(world, b, 0, 127, BTN_SPRINT, BOARD);
      expect(b.skate!.move).not.toBe(GRIND);
    }
    expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(3);
    const street = b.y;
    for (let t = 0; t < 4; t++) stepVehicleBody(world, b, 0, 0, BTN_JUMP | BTN_SPRINT, BOARD);
    stepVehicleBody(world, b, 0, 0, BTN_SPRINT, BOARD);
    expect(b.skate!.move).toBe(OLLIE);
    let caught = false, distance = 0;
    for (let t = 1; t < 100; t++) {
      const x = b.x, z = b.z, balance = b.skate!.balance;
      const steer = balance > 90 ? -60 : balance < -90 ? 60 : 0;
      stepVehicleBody(world, b, steer, 0, BTN_SPRINT, BOARD);
      if (caught) {
        expect(b.skate!.move).toBe(GRIND);
        distance += Math.hypot(b.x - x, b.z - z);
      } else if (b.skate!.move === GRIND) {
        caught = true;
        expect(b.y - street).toBeGreaterThan(.09);
      }
    }
    expect(distance).toBeGreaterThan(9);
    for (let t = 0; t < 32; t++) stepVehicleBody(world, b, 0, 0, 0, BOARD);
    expect(b.skate!.move).toBe(ROLL);
    expect(b.skate!.bank).toBeGreaterThan(100);
  }
});

test("a fallen lamp post, a wreck's roof and a step in downtown Miami are ground from the street", async () => {
  const { world, dx, dz } = await miami();
  // Each start is 4.5 m short of the piece's edge and 0.3 m to its side.
  for (const route of [
    { x: 115.547, z: 161.611, yaw: -1.539556, least: 5 },
    { x: 19.380, z: 88.516, yaw: 1.364976, least: 1.5 },
    { x: 547.880, z: 230.059, yaw: -1.536955, least: 1.5 },
  ]) {
    const b = board(world, dx + route.x, dz + route.z, route.yaw);
    b.vx = Math.sin(route.yaw) * 6.5; b.vz = Math.cos(route.yaw) * 6.5;
    for (let t = 0; t < 7; t++) stepVehicleBody(world, b, 0, 0, BTN_JUMP, BOARD);
    let distance = 0;
    for (let t = 0; t < 45; t++) {
      const x = b.x, z = b.z, balance = b.skate!.balance;
      stepVehicleBody(world, b, balance > 90 ? -60 : balance < -90 ? 60 : 0, 0, BTN_SPRINT, BOARD);
      expect(b.skate!.move).not.toBe(BAIL);
      if (b.skate!.move === GRIND || b.skate!.move === SLIDE) distance += Math.hypot(b.x - x, b.z - z);
    }
    expect(distance).toBeGreaterThan(route.least);
    for (let t = 0; t < 40; t++) stepVehicleBody(world, b, 0, 0, 0, BOARD);
    expect(b.skate!.move).not.toBe(BAIL);
    expect(b.skate!.bank).toBeGreaterThan(0);
  }
});
