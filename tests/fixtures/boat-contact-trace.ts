// Run unchanged in Bun/JSC and Node/V8 to replay the native wall response, flotation recovery and reverse escape.
import { createHash } from 'node:crypto';
import { BOAT as spec } from '../../content/vehicles/boat-spec.ts';
import { boatRestY, createBoat, stepBoat } from '../../shared/sim/boat.ts';
import type { BoatVehicleDefinition } from '../../shared/sim/vehicle.ts';
import { StaticBoatWorld } from '../../shared/world/boat.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
const def: BoatVehicleDefinition = { id: 'test:boat', movement: 'boat', spec, seats: [], doors: [], wheels: [], actionTicks: 1, beltline: 1.36 };
export function boatContactTrace() {
  const hash = createHash('sha256'), outcomes: { yaw: number; impact: number; restError: number; reversed: number }[] = [];
  let frames = 0;
  for (const yaw of [0, .5934119456780721]) {
    const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -32, 1 / 256); hf.heights.fill(4096); hf.seaLevel = 0;
    const structs = new StructureStore(dims, new Float32Array([0, 50]), new Float32Array([0, 4]), new Float32Array([0, .05])); structs.add(1, 100, 0, 116, 0, 0, 100);
    const world = new StaticBoatWorld({ hf, structs }), s = createBoat(spec, 96, boatRestY(spec, 0), yaw === 0 ? 112.5 : 104, yaw);
    s.vx = yaw === 0 ? 0 : 6.710314841648963; s.vz = yaw === 0 ? 21 : 9.948450870660499;
    let hit = -1, impact = 0, restError = 0, x = 0, z = 0;
    for (let tick = 0; tick < 360; tick++) {
      const elapsed = hit < 0 ? -1 : tick - hit, throttle = elapsed < 0 ? .5 : elapsed <= 90 ? 0 : -1;
      const result = stepBoat(s, { throttle, steer: 0, neutral: throttle === 0, pilot: true }, def, world);
      if (result.blocked && hit < 0) hit = tick;
      impact = Math.max(impact, result.impactSpeed);
      hash.update(JSON.stringify([s, result])); frames++;
      if (elapsed === 90) { restError = Math.abs(s.y - boatRestY(spec, 0)); x = s.x; z = s.z; }
      if (elapsed === 240) { outcomes.push({ yaw, impact, restError, reversed: Math.sqrt((s.x - x) ** 2 + (s.z - z) ** 2) }); break; }
    }
  }
  return { hash: hash.digest('hex'), frames, outcomes };
}
if (import.meta.main) console.log(JSON.stringify(boatContactTrace()));
