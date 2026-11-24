// A survivor knocked off its feet into a wall on stepped ground, standing or lying, laid and placed each tick as
// server/falls.ts does: every tick's checkpoint and pose hashed, and a copy restored from a checkpoint kept in step.
import { createHash } from "node:crypto";
import { CORE_CONTENT } from "../../content/core.ts";
import { Fall, wireX, wireY, yawOf16 } from "../../shared/anim/corpse.ts";
import { brace, layHuman } from "../../shared/anim/human-fall.ts";
import { HUMAN } from "../../shared/anim/human.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

/** Ticks each fall is stepped: five seconds, past where it comes to rest against the wall. */
export const HUMAN_FALL_TICKS = 150;

/** The hash of a survivor's fall into a wall: standing, or `down` already lying. */
export function humanFallTrace(down: boolean): string {
  const hash = createHash("sha256"), reg = compileContent(CORE_CONTENT).registry!, dims = { chunksX: 2, chunksZ: 2 };
  // Ground rising toward +X and stepping 5 cm every 14 m along Z, and a stone wall across the way at x = 42.
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 10 + i * TERRAIN_CELL * 0.08 + Math.floor(j / 7) * 0.05);
  const world = { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const wall = reg.index.get("core:wall_stone")!;
  world.structs.add(wall, 42, hf.heightAt(42, 40) + reg.halfY[wall]!, 40, 16384, 1, 10000);
  // As a car strikes it from the side: thrown toward the wall, lifted, and turning.
  const [x, z, yaw16, vx, vy, vz, wx, wy, wz] = down ? [40.9, 39.6, 23000, 10, 1.5, -0.6, 0.5, 3, -2.5] : [39.2, 40.3, 4100, 9, 2.5, 1.2, 1.5, -0.8, -6];
  // Bracing as a living survivor does (server/falls.ts).
  const lay = (px: number, py: number, pz: number) => {
    const fall = new Fall(layHuman(wireX(px), wireY(py), wireX(pz), yawOf16(yaw16), down));
    fall.reflex = brace;
    return fall;
  };
  const a = lay(x, hf.heightAt(x, z), z), root = new Float64Array(3), pose = new Solved(HUMAN.bones);
  a.ragdoll.launch(vx, vy, vz, wx, wy, wz);
  let b: Fall | null = null;
  for (let tick = 0; tick < HUMAN_FALL_TICKS; tick++) {
    a.tick(world);
    b?.tick(world);
    const state = a.ragdoll.checkpoint();
    if (b) {
      const restored = b.ragdoll.checkpoint();
      if (a.ticks !== b.ticks || a.still !== b.still || state.some((n, i) => n !== restored[i])) throw new Error("human fall diverged after checkpoint restore");
    }
    // Placed as the server places it: its entity at the hips, rounded as the wire has it, and posed about that.
    a.ragdoll.rootPosition(root);
    a.ragdoll.rebase(wireX(root[0]!), wireY(root[1]!), wireX(root[2]!));
    a.ragdoll.pose(pose);
    hash.update(new Uint8Array(state.buffer, state.byteOffset, state.byteLength));
    hash.update(new Uint8Array(pose.rot.buffer, pose.rot.byteOffset, pose.rot.byteLength));
    hash.update(new Uint8Array(pose.pos.buffer, pose.pos.byteOffset, pose.pos.byteLength));
    hash.update(`${tick},${a.ticks},${a.still},${a.ragdoll.awake};`);
    if (tick === 20) {
      b = lay(wireX(root[0]!), wireY(root[1]!), wireX(root[2]!));
      if (!b.ragdoll.restore(state, a.ragdoll.awake)) throw new Error("human fall checkpoint unreadable");
      b.ticks = a.ticks;
    }
  }
  if (!a.still) throw new Error("human fall did not come to rest");
  return hash.digest("hex");
}

if (import.meta.main) console.log(humanFallTrace(false), humanFallTrace(true));
