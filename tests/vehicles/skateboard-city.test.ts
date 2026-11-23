import { expect, test } from "bun:test";
import { BOARD } from "../../content/vehicles/skateboard.ts";
import { createMapWorld } from "../../server/world.ts";
import { withContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Body, BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";
import { GRIND, OLLIE, ROLL } from "../../shared/sim/skate-state.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { MIAMI_CUT, miamiSlice } from "../fixtures/cityslice.ts";
import { coreRegistry, wrap } from "../fixtures/world.ts";

// Set SKATE_MIAMI_MAP to var/maps/miami.snmap to repeat these approaches on the complete city.
test("downtown Miami's kerbs carry two ollies over sidewalk seams", async () => {
  const { map } = miamiSlice();
  const path = process.env.SKATE_MIAMI_MAP;
  const full = path ? parseMap(await Bun.file(path).bytes()) : null;
  const world = full
    ? createMapWorld(withContent(coreRegistry(), full.content?.defs ?? []), full, { entityMax: 64 })
    : wrap(map.dims, mapHeightfield(map));
  if (!full) placeStatics(map, world.structs, coreRegistry());
  const dx = full ? MIAMI_CUT.cx * CHUNK_SIZE : 0, dz = full ? MIAMI_CUT.cz * CHUNK_SIZE : 0;
  for (const route of [
    { x: 354.207, z: 258.870, yaw: 1.502368 },
    { x: 328.992, z: 206.860, yaw: .142667 },
  ]) {
    const b = new Body();
    b.x = dx + route.x; b.z = dz + route.z; b.vehicleYaw = route.yaw;
    const above = world.hf.heightAt(b.x, b.z) + 1;
    expect(castWorld(world, b.x, above, b.z, 0, -1, 0, 2, true)).not.toBe(HIT_NONE);
    b.y = above - rayHit.t + .002; b.grounded = true;
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
