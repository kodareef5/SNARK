// The authoritative world: static map, structures, entities and the tick clock.

import type { Registry } from "../shared/content/registry.ts";
import type { MapDims } from "../shared/coords.ts";
import { EntityStore } from "../shared/sim/entities.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_SPAWN, buildProvingHeightfield, populateProving, provingMapHash } from "../shared/world/proving.ts";
import { StructureStore } from "../shared/world/structures.ts";

export interface ServerWorld extends CollisionWorld {
  readonly reg: Registry;
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  readonly ents: EntityStore;
  readonly mapId: string;
  readonly mapHash: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
  /** World clock in fixed steps. Persisted; never reset and never set by hand. */
  tick: number;
  /** Added to the tick to get the time of day (shared/sim/clock.ts). This is what `settime` changes. */
  dayOffset: number;
}

export interface WorldOptions {
  entityCap?: number;
  /** Place the proving ground's structures. False when a save will supply them. */
  populate?: boolean;
}

export function createWorld(reg: Registry, dims: MapDims, hf: Heightfield, mapId: string, mapHash: number, spawn: ServerWorld["spawn"], entityCap: number): ServerWorld {
  return {
    reg,
    dims,
    hf,
    structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ),
    ents: new EntityStore(dims, entityCap),
    mapId,
    mapHash,
    spawn,
    tick: 0,
    dayOffset: 0,
  };
}

export function createProvingWorld(reg: Registry, opts: WorldOptions = {}): ServerWorld {
  const hf = buildProvingHeightfield();
  const world = createWorld(reg, PROVING_DIMS, hf, PROVING_ID, provingMapHash(hf), PROVING_SPAWN, opts.entityCap ?? 4096);
  if (opts.populate !== false) populateProving(world.structs, hf, reg);
  return world;
}
