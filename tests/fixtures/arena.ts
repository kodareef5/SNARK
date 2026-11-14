import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld } from "../../shared/world/ray.ts";
import type { Harness } from "./net.ts";

/** The south-west corner of a level, dry, empty rectangle `wide` metres along X and `deep` along Z, nearest the first spawn point. */
export function flatGround(h: Harness, wide: number, deep: number): { x: number; z: number; y: number } {
  const w = h.world;
  const p = w.reg.move[w.reg.index.get("core:survivor")!]!;
  const spawn = w.spawns[0]!;
  for (let r = 0; r < 200; r += 4) {
    for (let k = 0; k < (r === 0 ? 1 : 16); k++) {
      const x = spawn.x + Math.sin((k * Math.PI) / 8) * r - wide / 2;
      const z = spawn.z + Math.cos((k * Math.PI) / 8) * r - deep / 2;
      if (x < 2 || z < 2 || x + wide > w.hf.sizeX - 2 || z + deep > w.hf.sizeZ - 2) continue;
      const y = w.hf.heightAt(x, z);
      if (y < w.hf.seaLevel + 0.5) continue;
      let ok = true;
      for (let dz = 0; dz <= deep && ok; dz += 1) for (let dx = 0; dx <= wide && ok; dx += 1) ok = Math.abs(w.hf.heightAt(x + dx, z + dz) - y) < 0.02;
      // Rays at two heights, every two metres, and a capsule at the middle and one corner check that nothing stands in it.
      for (let dx = 0; dx <= wide && ok; dx += 2) for (const up of [0.3, 1.5]) ok = ok && castWorld(w, x + dx, y + up, z, 0, 0, 1, deep) === HIT_NONE;
      for (let dz = 0; dz <= deep && ok; dz += 2) for (const up of [0.3, 1.5]) ok = ok && castWorld(w, x, y + up, z + dz, 1, 0, 0, wide) === HIT_NONE;
      ok = ok && capsuleFree(w, x + wide / 2, y, z + deep / 2, p.radius, p.height) && capsuleFree(w, x + 1, y, z + 1, p.radius, p.height);
      if (ok) return { x, z, y };
    }
  }
  throw new Error(`no level ground ${wide} by ${deep} near the spawn point`);
}
