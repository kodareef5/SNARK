import type { CreatureAnim } from "../shared/anim/creature.ts";
import type { Rig } from "../shared/anim/rigs.ts";
import { NO_CLIPS } from "../shared/anim/clip.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import type { MapDef, MapZone } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import type { MapDims } from "../shared/coords.ts";
import { ENTITY_LIMIT, EntityStore } from "../shared/sim/entities.ts";
import { offsetForHour } from "../shared/sim/clock.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { mapHeightfield, mapNodes, parseMap, placeStatics, writeMap, type MapFile, type MapStatic } from "../shared/world/mapfile.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_POOL, PROVING_SEA_LEVEL, PROVING_SPAWNS, buildProvingHeightfield, populateProving, provingNodeLayers } from "../shared/world/proving.ts";
import { NodeField, type NodeSource } from "../shared/world/nodes.ts";
import { StructureStore } from "../shared/world/structures.ts";
import { History } from "./history.ts";
import { UnloadedNodes } from "./place.ts";

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
  /** The spawn zones of the map's definition, in its order, then the spawn regions of its file. */
  readonly zones: readonly MapZone[];
  /** `nodes` (from CollisionWorld) is this field's store. */
  readonly nodeField: NodeField | null;
  /** The field's nodes in chunks nobody has loaded, which placements test too (server/place.ts). */
  readonly unloaded: UnloadedNodes | null;
  /** These clips place hit zones, so they must be the ones clients draw with. With none, bodies rest in a T-pose. */
  anim: HumanAnim;
  /** Creature skeletons by rig id, from the same pack as the clips. Empty without one. */
  rigs: Map<string, Rig>;
  /** What each species drawn on a rig of its own plays on it, by content index. */
  anims: (CreatureAnim | null)[];
  /** Where moving entities were over the last few ticks. Code that starts or stops stepping an entity must tell it. */
  readonly history: History;
  /** Persisted. Never reset and never set by hand. */
  tick: number;
  /** Added to the tick to get the time of day (shared/sim/clock.ts). This is what `settime` changes. */
  dayOffset: number;
}

/** Slots an entity store starts with. It doubles as it fills (shared/sim/entities.ts). */
export const ENTITY_START = 4096;

export interface WorldOptions {
  /** The most entities the world may hold: the MaxEntities setting on a server. Without one, as many as a handle can name. */
  entityMax?: number;
  /** In place of ENTITY_START, for a test that wants the store to grow early. */
  entityStart?: number;
  /** False when a save will supply the map's static pieces. */
  populate?: boolean;
}

/** `entityMax` is the most entities the world may hold. Its store starts at `entityStart`, or at the limit if that is less. */
export function createWorld(reg: Registry, dims: MapDims, hf: Heightfield, mapId: string, mapHash: number, spawn: ServerWorld["spawn"], entityMax: number, spawns?: ServerWorld["spawns"], nodeSource?: NodeSource, zones: ServerWorld["zones"] = [], entityStart = ENTITY_START): ServerWorld {
  const nodeField = nodeSource ? new NodeField(dims, reg, nodeSource) : null;
  const ents = new EntityStore(dims, Math.min(entityStart, entityMax), entityMax);
  return {
    reg,
    clock: { cycle: 1, day: 1, night: 1 },
    dims,
    hf,
    nodeField,
    unloaded: nodeField ? new UnloadedNodes(dims, nodeField) : null,
    ...(nodeField ? { nodes: nodeField.store } : {}),
    structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts),
    ents,
    history: new History(ents),
    anim: new HumanAnim(NO_CLIPS),
    rigs: new Map(),
    anims: [],
    mapId,
    mapHash,
    spawn,
    spawns: spawns ?? [{ name: "Spawn", ...spawn }],
    zones,
    tick: 0,
    dayOffset: offsetForHour(0, 9),
  };
}

/**
 * The herd lives north of the spawn point, and the hunters at the far edge of that ground, too far to see a new arrival.
 * Dodos and a few parasaurs live round the pool to the west, twelve of them as most of The Island's beach regions hold.
 * A test's starting creatures are put in the first zone and its hunters in the last.
 */
const PROVING_DEF: MapDef = {
  type: "map",
  id: PROVING_ID,
  chunks: [PROVING_DIMS.chunksX, PROVING_DIMS.chunksZ],
  seaLevel: PROVING_SEA_LEVEL,
  zones: [
    { kind: "spawn", at: [256, 272], half: [30, 28], spawns: "core:spawns_proving_herd", count: 24 },
    { kind: "spawn", at: [PROVING_POOL.x, PROVING_POOL.z], radius: 50, spawns: "core:spawns_beach", count: 12 },
    { kind: "spawn", at: [256, 294], half: [30, 6], spawns: "core:spawns_proving_hunters", count: 4 },
  ],
};

/** The content's definition of the map a file holds, found by the file's id. The proving ground's is here, since it is no pack's. */
function defOf(reg: Registry, map: MapFile): MapDef | null {
  const def = map.id === PROVING_ID ? PROVING_DEF : reg.defs[reg.index.get(map.id) ?? -1];
  if (def?.type !== "map") return null;
  if (def.chunks[0] !== map.dims.chunksX || def.chunks[1] !== map.dims.chunksZ || (def.seaLevel !== undefined && def.seaLevel !== map.seaLevel)) {
    throw new Error(`map "${map.id}": its file is ${map.dims.chunksX} by ${map.dims.chunksZ} chunks with the sea at ${map.seaLevel}, and its definition says ${def.chunks[0]} by ${def.chunks[1]}${def.seaLevel === undefined ? "" : ` with the sea at ${def.seaLevel}`}`);
  }
  return def;
}

/** A world on the ground a map file holds (shared/world/mapfile.ts), with what the map's definition says lives there. */
export function createMapWorld(reg: Registry, map: MapFile, opts: WorldOptions = {}): ServerWorld {
  const hf = mapHeightfield(map);
  const zones = [...(defOf(reg, map)?.zones ?? []).filter((z) => z.kind === "spawn"), ...(map.regions ?? [])];
  const world = createWorld(reg, map.dims, hf, map.id, map.hash, map.spawns[0]!, opts.entityMax ?? ENTITY_LIMIT, map.spawns, mapNodes(map, hf, reg) ?? undefined, zones, opts.entityStart);
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
  return (proving = writeMap({
    id: PROVING_ID,
    dims: PROVING_DIMS,
    minY: hf.minY,
    stepY: hf.stepY,
    seaLevel: PROVING_SEA_LEVEL,
    heights: hf.heights,
    tint: hf.tint,
    statics,
    nodes: provingNodeLayers(hf),
    spawns: PROVING_SPAWNS,
  }));
}

export function createProvingWorld(reg: Registry, opts: WorldOptions = {}): ServerWorld {
  return createMapWorld(reg, parseMap(provingFile(reg)), opts);
}
