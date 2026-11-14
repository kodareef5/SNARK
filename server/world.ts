import type { Rig } from "../shared/anim/rigs.ts";
import { NO_CLIPS } from "../shared/anim/clip.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import type { Registry } from "../shared/content/registry.ts";
import { CHUNK_SIZE, type MapDims } from "../shared/coords.ts";
import { EntityStore } from "../shared/sim/entities.ts";
import { offsetForHour } from "../shared/sim/clock.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { mapHeightfield, mapNodes, placeStatics, writeMap, type MapFile, type MapStatic } from "../shared/world/mapfile.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_NODES_PER_CHUNK, PROVING_SEA_LEVEL, PROVING_SPAWN, PROVING_SPAWNS, buildProvingHeightfield, populateProving, provingMapHash, provingNodes } from "../shared/world/proving.ts";
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
  /** False when a save will supply the map's static pieces. */
  populate?: boolean;
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

/** A world on the ground a map file holds (shared/world/mapfile.ts). */
export function createMapWorld(reg: Registry, map: MapFile, opts: WorldOptions = {}): ServerWorld {
  const hf = mapHeightfield(map);
  const world = createWorld(reg, map.dims, hf, map.id, map.hash, map.spawns[0]!, opts.entityCap ?? 4096, map.spawns, mapNodes(map, hf, reg) ?? undefined);
  if (opts.populate !== false) placeStatics(map, world.structs, reg);
  return world;
}

let proving: Uint8Array<ArrayBuffer> | null = null;

/**
 * The proving ground as a map file, written once from the functions that build it (shared/world/proving.ts). It names content
 * by id, so the same bytes serve every registry.
 */
export function provingFile(reg: Registry): Uint8Array<ArrayBuffer> {
  if (proving) return proving;
  const hf = buildProvingHeightfield();
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
  // Chunk by chunk and slot by slot: set down again in this order, each piece gets the slot it had.
  const statics: MapStatic[] = [];
  for (const t of structs.chunks) for (let s = 0; t && s < t.high; s++) statics.push({ kind: reg.defs[t.kind[s]!]!.id, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]! });
  // Nodes stand more than 99 m from the middle along either axis, as provingNodes has it. A bit is a square metre.
  const side = PROVING_DIMS.chunksX * CHUNK_SIZE;
  const allow = new Uint8Array((side * side) / 8);
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) if (Math.max(Math.abs(x + 0.5 - side / 2), Math.abs(z + 0.5 - side / 2)) > 99) allow[(z * side + x) >> 3]! |= 1 << (x & 7);
  }
  return (proving = writeMap({
    id: PROVING_ID,
    dims: PROVING_DIMS,
    minY: hf.minY,
    stepY: hf.stepY,
    seaLevel: PROVING_SEA_LEVEL,
    heights: hf.heights,
    tint: hf.tint,
    statics,
    nodes: [{ seed: 0x51ab, perChunk: PROVING_NODES_PER_CHUNK, kinds: [["core:tree", 5], ["core:rock", 3], ["core:bush", 3]], allowCell: 1, allow }],
    spawns: PROVING_SPAWNS,
  }));
}

export function createProvingWorld(reg: Registry, opts: WorldOptions = {}): ServerWorld {
  const hf = buildProvingHeightfield();
  const world = createWorld(reg, PROVING_DIMS, hf, PROVING_ID, provingMapHash(hf), PROVING_SPAWN, opts.entityCap ?? 4096, PROVING_SPAWNS, provingNodes(hf, reg));
  if (opts.populate !== false) populateProving(world.structs, hf, reg);
  return world;
}
