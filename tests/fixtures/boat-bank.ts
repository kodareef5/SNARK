import { BOAT_VEHICLE } from '../../content/vehicles/boat.ts';
import { boatRestY, createBoat, stepBoat } from '../../shared/sim/boat.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';
import { StaticBoatWorld } from '../../shared/world/boat.ts';
export const bankBoat = BOAT_VEHICLE;
export function steepBank(above = 2, angle?: number) {
  const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -32, 1 / 256); hf.seaLevel = 0;
  for (let z = 0; z < hf.nz; z++) for (let x = 0; x < hf.nx; x++) {
    const lane = x * 2 >= 140 && x * 2 <= 250;
    const height = angle === undefined ? z * 2 > 120 ? -4 : above : Math.max(-4, Math.min(above, above - (z * 2 - 120) * Math.tan(angle)));
    hf.setSample(x, z, lane ? height : above);
  }
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  return new StaticBoatWorld({ hf, structs });
}
export function strikeBank(world: StaticBoatWorld, throttle: number, angle: number) {
  const rest = boatRestY(bankBoat.spec, 0, 90), state = createBoat(bankBoat.spec, 196, rest, 236, Math.PI + angle); state.payloadMass = 90;
  let first = -1, capsized = false, maxY = state.y, propWet = 0;
  const step = (throttle: number) => {
    const result = stepBoat(state, { throttle, steer: 0, neutral: throttle === 0, pilot: true }, bankBoat, world);
    capsized ||= result.capsized; maxY = Math.max(maxY, state.y); propWet = result.propellerImmersion;
    return result.blocked;
  };
  for (let tick = 0; tick < 600 && first < 0; tick++) if (step(throttle)) first = tick;
  for (let tick = 0; tick < 15; tick++) step(throttle);
  for (let tick = 0; tick < 90; tick++) step(0);
  const neutralY = state.y, x = state.x, z = state.z; let path = 0, stalled = 0, maxStalled = 0;
  for (let tick = 0; tick < 150; tick++) {
    const x = state.x, z = state.z; step(-1); const distance = Math.hypot(state.x - x, state.z - z); path += distance;
    stalled = distance < .001 && Math.hypot(state.vx, state.vz) > 1 ? stalled + 1 : 0; maxStalled = Math.max(maxStalled, stalled);
  }
  return { state, first, capsized, maxY, propWet, neutralY, rest, path, maxStalled, net: Math.hypot(state.x - x, state.z - z),
    reverse: -(state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw)), penetration: world.penetration(state, bankBoat)?.depth ?? 0 };
}
