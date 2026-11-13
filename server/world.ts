// The authoritative world: static map, structures, entities and the tick clock.

import type { Rig } from "../shared/anim/rigs.ts";
import { NO_CLIPS } from "../shared/anim/clip.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import type { Registry } from "../shared/content/registry.ts";
import type { MapDims } from "../shared/coords.ts";
import { EntityStore } from "../shared/sim/entities.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_SPAWN, PROVING_SPAWNS, provingNodes, buildProvingHeightfield, populateProving, provingMapHash } from "../shared/world/proving.ts";
import { NodeField, type NodeSource } from "../shared/world/nodes.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { History } from "./history.ts";

export interface ServerWorld extends CollisionWorld {
  readonly reg: Registry;
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  readonly ents: EntityStore;
  readonly mapId: string;
  readonly mapHash: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
  /** Places a dead survivor may choose to return at. The first is `spawn`. */
  readonly spawns: readonly { readonly name: string; readonly x: number; readonly z: number; readonly yaw: number }[];
  /** The map's resource nodes, if it has any. `nodes` (from CollisionWorld) is this field's store. */
  readonly nodeField: NodeField | null;
  /**
   * The clips bodies are posed with, which decide where their hit zones are.
   * They must be the ones the clients draw with; without any, bodies rest in a T-pose.
   */
  anim: HumanAnim;
  /** The skeletons that are data (creatures'), by rig id, out of the same pack: empty without one. */
  rigs: Map<string, Rig>;
  /** Where moving entities were over the last few ticks. Whoever starts or stops stepping one tells it. */
  readonly history: History;
  /** World clock in fixed steps. Persisted; never reset and never set by hand. */
  tick: number;
  /** Added to the tick to get the time of day (shared/sim/clock.ts). This is what `settime` changes. */
  dayOffset: number;
}

export interface WorldOptions {
  entityCap?: number;
  /** Place the proving ground's structures. False when a save will supply them. */
  populate?: boolean;
  /** False for a proving ground with no trees, rocks or bushes. */
  nodes?: boolean;
}

export function createWorld(reg: Registry, dims: MapDims, hf: Heightfield, mapId: string, mapHash: number, spawn: ServerWorld["spawn"], entityCap: number, spawns?: ServerWorld["spawns"], nodeSource?: NodeSource): ServerWorld {
  const nodeField = nodeSource ? new NodeField(dims, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, nodeSource) : null;
  const ents = new EntityStore(dims, entityCap);
  return {
    reg,
    dims,
    hf,
    nodeField,
    ...(nodeField ? { nodes: nodeField.store } : {}),
    structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts),
    ents,
    history: new History(ents),
    anim: new HumanAnim(NO_CLIPS),
    rigs: new Map(),
    mapId,
    mapHash,
    spawn,
    spawns: spawns ?? [{ name: "Spawn", ...spawn }],
    tick: 0,
    // A new world begins at nine in the morning.
    dayOffset: 9 * GAME_HOUR_TICKS,
  };
}

export function createProvingWorld(reg: Registry, opts: WorldOptions = {}): ServerWorld {
  const hf = buildProvingHeightfield();
  const world = createWorld(reg, PROVING_DIMS, hf, PROVING_ID, provingMapHash(hf), PROVING_SPAWN, opts.entityCap ?? 4096, PROVING_SPAWNS, opts.nodes === false ? undefined : provingNodes(hf, reg));
  if (opts.populate !== false) populateProving(world.structs, hf, reg);
  return world;
}
