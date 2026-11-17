// Run unchanged in Bun/JSC and Node/V8. Hash every future-controlling car Body field each tick, including full attitude and water.
import { createHash } from 'node:crypto';
import { COMPACT_VEHICLE } from '../../content/vehicles/compact.ts';
import { Body, BTN_JUMP } from '../../shared/sim/character.ts';
import { stepVehicleBody, vehicleStep } from '../../shared/sim/vehicle-body.ts';
import { detAtan2, detCos, detSin } from '../../shared/math/scalar.ts';
import { Heightfield } from '../../shared/world/heightfield.ts';
import { StructureStore } from '../../shared/world/structures.ts';

export function carChassisTrace(): { hash: string; frames: number; inverted: boolean; flooding: number; stalled: boolean } {
  const hash = createHash('sha256'); let frames = 0, inverted = false, flooding = 0, stalled = false;
  for (const mode of ['drive', 'rollover', 'water', 'wall', 'decks', 'parking']) {
    const dims = { chunksX: 4, chunksZ: 4 }, hf = new Heightfield(dims, 2, -64, 1 / 256);
    hf.heights.fill((mode === 'water' ? 34 : 64) * 256); hf.seaLevel = mode === 'water' ? 0 : -Infinity;
    const structs = new StructureStore(dims, new Float32Array([0, 5, 4]), new Float32Array([0, 2, .5]), new Float32Array([0, .5, 1.25]));
    if (mode === 'wall') structs.add(1, 64, 2, 78, 0, 0, 100);
    if (mode === 'decks') {
      for (let i = 0; i < 14; i++) structs.add(2, 64, i * .25 - .5, 68 + i * 2.5, 0, 0, 100);
    }
    if (mode === 'parking') {
      for (let iz = 0; iz < hf.nz; iz++) for (let ix = 0; ix < hf.nx; ix++) hf.setSample(ix, iz, (ix * hf.cell - 64) * .28);
    }
    const world = { hf, structs };
    const b = new Body(); b.vehicle = true; b.x = b.z = 64; b.y = mode === 'water' ? -.75 : mode === 'rollover' ? 3 : 0; b.fuel = 40;
    if (mode === 'rollover') b.vehicleRollRate = 7;
    if (mode === 'decks') b.vz = 22;
    if (mode === 'parking') {
      b.vehicleRoll = detAtan2(.28, 1); b.vehicleQz = detSin(b.vehicleRoll / 2); b.vehicleQw = detCos(b.vehicleRoll / 2);
      b.vx = -1;
    }
    let hitWall = false;
    for (let tick = 0; tick < (mode === 'water' ? 1000 : 240); tick++) {
      const throttle = mode === 'wall' ? tick < 135 ? 127 : -90 : mode === 'decks' || mode === 'drive' && tick < 180 ? 80 : 0;
      stepVehicleBody(world, b, mode === 'drive' && tick > 70 && tick < 150 ? 40 : 0, throttle, mode === 'parking' ? BTN_JUMP : 0, COMPACT_VEHICLE, undefined, undefined, mode !== 'parking');
      hitWall ||= mode === 'wall' && vehicleStep.blocked !== null;
      inverted ||= 1 - 2 * (b.vehicleQx * b.vehicleQx + b.vehicleQz * b.vehicleQz) < -.5;
      flooding = Math.max(flooding, b.vehicleFlooding); stalled ||= b.vehicleEngineCondition === 0;
      hash.update(JSON.stringify([mode, tick, ...Object.keys(b).filter(key => key === 'x' || key === 'y' || key === 'z' || key === 'vx' || key === 'vy' || key === 'vz' || key === 'fuel' || key === 'steering' || key === 'wheelAngle' || key === 'grounded' || key.startsWith('vehicle')).sort().map(key => [key, b[key as keyof Body]]), vehicleStep]));
      frames++;
    }
    if (mode === 'wall' && (!hitWall || b.z > 71)) throw new Error('cross-engine course missed wall pressure or reverse escape');
    if (mode === 'decks' && b.z < 96) throw new Error('cross-engine course did not reach the upper bridge');
    if (mode === 'parking' && (Math.abs(b.x - 64) > .7 || Math.abs(b.vx) > .001)) throw new Error('cross-engine course did not regain the parking brake');
  }
  return { hash: hash.digest('hex'), frames, inverted, flooding, stalled };
}
if (import.meta.main) console.log(JSON.stringify(carChassisTrace()));
