import { ROLE_FOUNDATION, ROLE_PILLAR } from "../../shared/world/snap.ts";
import type { StructureStore } from "../../shared/world/structures.ts";

/**
 * The enemy range as server/build.ts answered it before the claims grid (server/claims.ts): every slot of the chunks within
 * `foundation` metres, the map's pieces among them. `role` is the registry's, by kind. The grid is proved against this.
 */
export function scanNear(structs: StructureStore, role: ArrayLike<number>, team: number, x: number, z: number, foundation: number, pillar: number): boolean {
  const dims = structs.dims;
  const cx0 = Math.max(0, Math.floor((x - foundation) / 64));
  const cx1 = Math.min(dims.chunksX - 1, Math.floor((x + foundation) / 64));
  const cz0 = Math.max(0, Math.floor((z - foundation) / 64));
  const cz1 = Math.min(dims.chunksZ - 1, Math.floor((z + foundation) / 64));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const t = structs.chunks[cz * dims.chunksX + cx];
      if (!t) continue;
      for (let s = 0; s < t.high; s++) {
        const owner = t.owner[s]!;
        if (owner === 0 || owner === team) continue;
        const r = role[t.kind[s]!]!;
        if (r !== ROLE_FOUNDATION && r !== ROLE_PILLAR) continue;
        const reach = r === ROLE_FOUNDATION ? foundation : pillar;
        const dx = t.x[s]! - x;
        const dz = t.z[s]! - z;
        if (dx * dx + dz * dz < reach * reach) return true;
      }
    }
  }
  return false;
}
