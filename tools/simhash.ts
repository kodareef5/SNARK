// Runs a fixed, seeded movement scenario and prints a hash of every body state
// along the way. The same file runs under Bun (JavaScriptCore) and Node (V8);
// equal hashes mean the simulation is bit-identical across the two engines,
// which is what client prediction relies on.
//
//   bun tools/simhash.ts
//   node tools/simhash.ts

import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { TICK_DT } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { Body, MODE_GHOST, stepBody } from "../shared/sim/character.ts";
import { buildProvingHeightfield, populateProving, PROVING_DIMS } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";

export function simHash(ticks = 3000): string {
  const reg = compileContent(CORE_CONTENT).registry!;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ);
  populateProving(structs, hf, reg);
  const world = { hf, structs };
  const p = reg.move[reg.index.get("core:survivor")!]!;
  const rng = new Rng(20261112);
  // On the plaza, on the slopes, in and around the pool.
  const spawns = [[256, 240], [239, 268], [285, 280], [263, 274], [252, 305], [248, 260], [220, 286], [300, 258], [172, 256], [180, 262], [160, 250], [196, 256]];
  const bodies = spawns.map(([x, z], i) => {
    const b = new Body();
    b.x = x!;
    b.z = z!;
    b.y = hf.heightAt(b.x, b.z);
    b.grounded = true;
    // Different modifiers per body; one tires quickly, one is a ghost.
    b.speedQ = 700 + i * 90;
    b.swimQ = 1600 - i * 70;
    if (i === 3) b.staminaMax = 12;
    if (i === 5) b.mode = MODE_GHOST;
    return b;
  });
  const input = bodies.map(() => [0, 0, 0, 0, 0]);
  const f = new Float32Array(6);
  const bytes = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let t = 0; t < ticks; t++) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const inp = input[i]!;
      if (rng.int(15) === 0) {
        inp[0] = rng.int(255) - 127;
        inp[1] = rng.int(255) - 127;
        inp[2] = rng.int(65536);
        inp[3] = rng.int(4);
        inp[4] = rng.int(32769) - 16384;
      }
      stepBody(world, b, inp[0]!, inp[1]!, inp[2]!, inp[4]!, inp[3]!, p, TICK_DT);
      f[0] = b.x;
      f[1] = b.y;
      f[2] = b.z;
      f[3] = b.vx;
      f[4] = b.vy;
      f[5] = b.vz;
      for (let k = 0; k < 24; k++) {
        h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
        h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
      }
      h1 = Math.imul(h1 ^ ((b.grounded ? 1 : 0) | (b.mode << 1) | (b.mflags << 4)), 0x01000193);
      h2 = Math.imul(h2 + b.stamina, 0x85ebca6b) ^ (h2 >>> 13);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

if (import.meta.main) console.log(simHash());
