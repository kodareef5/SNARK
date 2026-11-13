// Runs a fixed, seeded movement scenario and prints a hash of every body state
// along the way. The same file runs under Bun (JavaScriptCore) and Node (V8);
// equal hashes mean the simulation is bit-identical across the two engines,
// which is what client prediction relies on.
//
// A second hash covers poses: every kind of motion at whole and fractional
// ticks, solved to bone positions, and what a set of rays hits. Equal pose
// hashes mean the server and a browser agree on where every bone is.
//
//   bun tools/simhash.ts
//   node tools/simhash.ts

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../content/core.ts";
import { Pose } from "../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../shared/anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../shared/anim/pose.ts";
import { Solved, rayZones, solve, zoneHit } from "../shared/anim/skeleton.ts";
import { parsePack } from "../shared/pack/pack.ts";
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

/** The clips the art conversion wrote, as both engines can read them. */
export function sourceClips(): HumanAnim {
  return new HumanAnim(parsePack(new Uint8Array(readFileSync(new URL("../assets/source/core/human-clips.snpk", import.meta.url)))).clips);
}

export function poseHash(): string {
  const anim = sourceClips();
  const st = new AnimState();
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  const rot = new Uint8Array(solved.rot.buffer);
  const pos = new Uint8Array(solved.pos.buffer);
  const f = new Float32Array(1);
  const fb = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mix = (bytes: Uint8Array): void => {
    for (let k = 0; k < bytes.length; k++) {
      h1 = Math.imul(h1 ^ bytes[k]!, 0x01000193);
      h2 = Math.imul(h2 + bytes[k]!, 0x85ebca6b) ^ (h2 >>> 13);
    }
  };
  let n = 0;
  // Standing, crouched, in the air, in water; every third speed, direction and pitch.
  for (const [mode, grounded, stance] of [[1, 1, 0], [1, 1, 1], [1, 0, 0], [2, 0, 0]] as const) {
    for (let speed = 0; speed <= 15; speed += 3) {
      for (let dir = 0; dir < 16; dir += 3) {
        for (let pitch = -31; pitch <= 31; pitch += 13) {
          st.mode = mode;
          st.grounded = grounded === 1;
          st.stance = stance;
          st.speed = speed;
          st.dir = dir;
          st.pitch = pitch;
          st.seed = (n * 37) % 1024;
          const tick = n * 7.25;
          n++;
          humanPose(anim, st, tick, pose);
          solve(HUMAN, pose, solved);
          mix(rot);
          mix(pos);
          // A ray at chest height from the front and one down through the head.
          for (const [ox, oy, oz, dx, dy, dz] of [[0.05, 1.3, 3, 0, 0, -1], [0.02, 3, 0.03, 0, -1, 0], [2, 0.4, 0.1, -1, 0, 0]] as const) {
            h1 = Math.imul(h1 ^ rayZones(HUMAN, solved, ox, oy, oz, dx, dy, dz, 10), 0x01000193);
            f[0] = zoneHit.t;
            mix(fb);
          }
        }
      }
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

if (import.meta.main) console.log(simHash() + " " + poseHash());
