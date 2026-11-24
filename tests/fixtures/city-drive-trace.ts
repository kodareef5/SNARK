// A Zephyr driven flat out through downtown Miami (cityslice.ts) from several starts until each has met a building and
// pressed on it: every future-controlling field of its body hashed each tick, and what each step cost. The hash holds
// the vehicle step's results still while its cost is cut. `bun tests/fixtures/city-drive-trace.ts` prints both.

import { createHash } from "node:crypto";
import { Body, BTN_SPRINT } from "../../shared/sim/character.ts";
import { stepVehicleBody, vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { detCos, detSin } from "../../shared/math/scalar.ts";
import { mapHeightfield, placeStatics } from "../../shared/world/mapfile.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { miamiSlice } from "./cityslice.ts";
import { coreRegistry, wrap } from "./world.ts";

/** Where each drive starts, in the slice's metres, and the way it faces. */
const STARTS: readonly (readonly [x: number, z: number, yaw: number])[] = [
  [40, 458, Math.PI / 2], [100, 60, 0], [300, 60, 0], [200, 60, 0], [40, 173, Math.PI / 2],
];
const TICKS = 240;

export interface CityDriveTrace {
  hash: string;
  steps: number;
  /** Steps with the hull against something, and the fastest the car went. */
  blocked: number;
  fastest: number;
  /** Milliseconds a step: the mean, and the longest after each drive's first second. */
  mean: number;
  worst: number;
}

export function cityDriveTrace(): CityDriveTrace {
  const reg = coreRegistry(), { map } = miamiSlice();
  const world = wrap(map.dims, mapHeightfield(map), reg);
  placeStatics(map, world.structs, reg);
  const def = reg.vehicle[reg.index.get("core:zephyr")!]!;
  const hash = createHash("sha256");
  let steps = 0, blocked = 0, fastest = 0, total = 0, worst = 0;
  for (const [x, z, yaw] of STARTS) {
    const b = new Body();
    b.vehicle = true; b.x = x; b.z = z; b.fuel = 40;
    b.vehicleYaw = yaw; b.vehicleQy = detSin(yaw / 2); b.vehicleQw = detCos(yaw / 2);
    const above = world.hf.heightAt(x, z) + 30;
    b.y = castWorld(world, x, above, z, 0, -1, 0, 60, true) === HIT_NONE ? world.hf.heightAt(x, z) : above - rayHit.t;
    for (let tick = 0; tick < TICKS; tick++) {
      const began = performance.now();
      stepVehicleBody(world, b, tick > 150 ? 50 : 0, tick > 200 ? -127 : 127, BTN_SPRINT, def);
      const took = performance.now() - began;
      total += took;
      if (tick >= 30) worst = Math.max(worst, took);
      steps++;
      if (vehicleStep.blocked !== null) blocked++;
      fastest = Math.max(fastest, Math.hypot(b.vx, b.vz));
      hash.update(JSON.stringify([x, tick, ...Object.keys(b).filter((key) => key === "x" || key === "y" || key === "z" || key === "vx" || key === "vy" || key === "vz" || key === "fuel" || key === "steering" || key === "wheelAngle" || key === "grounded" || key.startsWith("vehicle")).sort().map((key) => [key, b[key as keyof Body]]), vehicleStep]));
    }
  }
  return { hash: hash.digest("hex"), steps, blocked, fastest, mean: total / steps, worst };
}

if (import.meta.main) {
  // The first run warms the engine's compiler. Of the next five, the quickest is the one least disturbed by the machine.
  cityDriveTrace();
  const runs = Array.from({ length: 5 }, cityDriveTrace);
  console.log(JSON.stringify({ ...runs[0]!, mean: Math.min(...runs.map((r) => r.mean)), worst: Math.min(...runs.map((r) => r.worst)) }));
}
