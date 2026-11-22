// Whether a supply drop may land at a place (planning/workstreams/supply.md): dry, level, open to the sky, with nothing
// growing there, off the obelisks' decks and away from what tribes have built. The circuits ask it of every site before
// they call a drop there, the tool that writes a city's starter sites asks it of every candidate, and the admin page
// asks it to say why a site is passed over. What an admin calls by hand is not asked: it lands where it is called.

import { CHUNK_SIZE } from "../../shared/coords.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { Found } from "../../shared/world/structures.ts";
import type { ServerWorld } from "../world.ts";

/** Metres from the place its feet stand at: the ground under them must be level, and the sky over them open. */
export const FOOT = 1.5;
/** Metres the ground under its feet may differ by. */
export const LEVEL = 0.6;
/** Metres of water it may stand in. */
export const WADE = 0.3;
/** Metres from an obelisk's centre no drop lands within: its transfer deck, and the room its storm's bolt needs. */
export const DECK_CLEAR = 110;
/** Metres from the map's edge. */
const EDGE = 16;
/** Metres up the sky must be open for: the shaft's height. */
const SKY = 600;
/** Metres round it and up from the ground that nothing may grow in. */
const GROWTH = 2.5;
const CANOPY = 30;

const found = new Found();
const FEET = [[0, 0], [FOOT, 0], [-FOOT, 0], [0, FOOT], [0, -FOOT]] as const;

export interface FitOptions {
  /** A floor a tribe built counts as ground: AllowCrateSpawnsOnTopOfStructures. */
  readonly onBuilt: boolean;
  /** Metres from anything a tribe built within which nothing lands, 0 for no such rule. */
  readonly baseExclusion: number;
}

/** Whether anything a tribe built stands within `range` metres of (x, z). */
export function basedNear(world: ServerWorld, x: number, z: number, range: number): boolean {
  const { dims, structs } = world;
  for (let cz = Math.max(0, Math.floor((z - range) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + range) / CHUNK_SIZE)); cz++) {
    for (let cx = Math.max(0, Math.floor((x - range) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + range) / CHUNK_SIZE)); cx++) {
      const t = structs.chunks[cz * dims.chunksX + cx];
      if (!t || t.live === 0) continue;
      for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.owner[s] !== 0 && Math.hypot(t.x[s]! - x, t.z[s]! - z) < range) return true;
    }
  }
  return false;
}

/**
 * Why no drop may land at (x, z), or "": "edge", "deck", "water", "slope", "roofed" (something of the map's stands over
 * it), "built" (something a tribe built does, and that is not allowed), "growth" (a tree or a rock), "base".
 */
export function siteFault(world: ServerWorld, x: number, z: number, o: FitOptions): string {
  const hf = world.hf;
  if (!(x >= EDGE && z >= EDGE && x <= hf.sizeX - EDGE && z <= hf.sizeZ - EDGE)) return "edge";
  for (const ob of world.obelisks) if (Math.hypot(ob.x - x, ob.z - z) < DECK_CLEAR) return "deck";
  const ground = hf.heightAt(x, z);
  if (hf.waterAt(x, z) > ground + WADE) return "water";
  for (const [dx, dz] of FEET) if (Math.abs(hf.heightAt(x + dx, z + dz) - ground) > LEVEL) return "slope";
  // Open to the sky over each foot: the ground is the first thing a ray from the shaft's height meets.
  const bare = { hf, structs: world.structs };
  for (const [dx, dz] of FEET) {
    if (castWorld(bare, x + dx, ground + SKY, z + dz, 0, -1, 0, SKY + 50, true) !== HIT_STRUCTURE) continue;
    const t = world.structs.chunks[Math.floor(rayHit.ref / 65536)];
    if (!t || t.owner[rayHit.ref & 0xffff] === 0) return "roofed";
    if (!o.onBuilt) return "built";
  }
  if (world.nodes && world.nodes.query(x - GROWTH, z - GROWTH, x + GROWTH, z + GROWTH, found, ground - 1, ground + CANOPY) > 0) return "growth";
  if (world.unloaded?.meets(x, ground, z, GROWTH, CANOPY)) return "growth";
  if (o.baseExclusion > 0 && !o.onBuilt && basedNear(world, x, z, o.baseExclusion)) return "base";
  return "";
}
