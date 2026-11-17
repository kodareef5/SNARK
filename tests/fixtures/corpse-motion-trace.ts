// Ongoing full ragdoll state, including a late checkpoint, long fall, deep sink and map-boundary impact.
import { createHash } from "node:crypto";
import { CORE_CONTENT } from "../../content/core.ts";
import { Fall, layCorpse, wireX, wireY } from "../../shared/anim/corpse.ts";
import type { CreatureAnim } from "../../shared/anim/creature.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { birdAnim } from "./bird.ts";

export function corpseMotionTrace(anim: CreatureAnim = birdAnim()): string {
  const hash = createHash("sha256"), reg = compileContent(CORE_CONTENT).registry!, dims = { chunksX: 2, chunksZ: 2 };
  for (const [x, y, water, vx, ticks] of [[63.25, 80, -Infinity, 11, 1100], [3, 2, -Infinity, -30, 360], [40, 24, 40, 0, 2100]]) {
    const hf = new Heightfield(dims, 2, -32, 1 / 256); hf.heights.fill(32 * 256); hf.seaLevel = water!;
    const world = { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
    const doll = (px: number, py: number, pz: number) => new Fall(layCorpse(anim, false, false, px, py, pz, 1.1, .73, new Solved(anim.rig.bones), true)!);
    const a = doll(x!, y!, 40.125), p = new Float64Array(3); let b: Fall | null = null;
    a.ragdoll.launch(vx!, 2, 3, .8, 1.5, -.4);
    for (let tick = 0; tick < ticks!; tick++) {
      a.tick(world); b?.tick(world);
      const state = a.ragdoll.checkpoint();
      if (b) {
        const restored = b.ragdoll.checkpoint();
        if (a.ticks !== b.ticks || a.still !== b.still || state.some((n, i) => n !== restored[i])) throw new Error("corpse trace diverged after checkpoint restore");
      }
      hash.update(new Uint8Array(state.buffer, state.byteOffset, state.byteLength));
      hash.update(`${tick},${a.ticks},${a.still},${a.ragdoll.awake};`);
      if (tick === 20) {
        a.ragdoll.rootPosition(p); b = doll(wireX(p[0]!), wireY(p[1]!), wireX(p[2]!));
        if (!b.ragdoll.restore(state, a.ragdoll.awake)) throw new Error("corpse trace checkpoint unreadable");
        b.ticks = a.ticks;
      }
    }
    if (!a.still) throw new Error("corpse trace did not reach supported rest");
  }
  return hash.digest("hex");
}
if (import.meta.main) console.log(corpseMotionTrace());
