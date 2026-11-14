import type { Rig } from "../shared/anim/rigs.ts";
import { NO_CLIPS } from "../shared/anim/clip.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import type { Registry } from "../shared/content/registry.ts";
import type { MapDims } from "../shared/coords.ts";
import { EntityStore } from "../shared/sim/entities.ts";
import { offsetForHour } from "../shared/sim/clock.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_SPAWN, PROVING_SPAWNS, provingNodes, buildProvingHeightfield, populateProving, provingMapHash } from "../shared/world/proving.ts";
import { NodeField, type NodeSource } from "../shared/world/nodes.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { History } from "./history.ts";

export interface ServerWorld extends CollisionWorld {
  /** Content after this server's settings are applied (shared/content/tuning.ts). */
  readonly reg: Registry;
  /** The server's three clock-speed rules (shared/sim/clock.ts). */
  readonly clock: { cycle: number; day: number; night: number };
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  readonly ents: EntityStore;
  readonly mapId: string;
  readonly mapHash: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
  /** Respawn choices for a dead survivor. The first is `spawn`. */
  readonly spawns: readonly { readonly name: string; readonly x: number; readonly z: number; readonly yaw: number }[];
  /** `nodes` (from CollisionWorld) is this field's store. */
  readonly nodeField: NodeField | null;
  /** These clips place hit zones, so they must be the ones clients draw with. With none, bodies rest in a T-pose. */
  anim: HumanAnim;
  /** Creature skeletons by rig id, from the same pack as the clips. Empty without one. */
  rigs: Map<string, Rig>;
  /** Where moving entities were over the last few ticks. Code that starts or stops stepping an entity must tell it. */
  readonly history: History;
  /** Persisted. Never reset and never set by hand. */
  tick: number;
  /** Added to the tick to get the time of day (shared/sim/clock.ts). This is what `settime` changes. */
  dayOffset: number;
}

export interface WorldOptions {
  entityCap?: number;
  /** False when a save will supply the proving ground's structures. */
  populate?: boolean;
  /** False for a proving ground with no trees, rocks or bushes. */
  nodes?: boolean;
}

export function createWorld(reg: Registry, dims: MapDims, hf: Heightfield, mapId: string, mapHash: number, spawn: ServerWorld["spawn"], entityCap: number, spawns?: ServerWorld["spawns"], nodeSource?: NodeSource): ServerWorld {
  const nodeField = nodeSource ? new NodeField(dims, reg.halfX, reg.halfY, reg.halfZ, reg.soft, reg.nodeHits, nodeSource) : null;
  const ents = new EntityStore(dims, entityCap);
  return {
    reg,
    clock: { cycle: 1, day: 1, night: 1 },
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
    dayOffset: offsetForHour(0, 9),
  };
}

export function createProvingWorld(reg: Registry, opts: WorldOptions = {}): ServerWorld {
  const hf = buildProvingHeightfield();
  const world = createWorld(reg, PROVING_DIMS, hf, PROVING_ID, provingMapHash(hf), PROVING_SPAWN, opts.entityCap ?? 4096, PROVING_SPAWNS, opts.nodes === false ? undefined : provingNodes(hf, reg));
  if (opts.populate !== false) populateProving(world.structs, hf, reg);
  return world;
}
