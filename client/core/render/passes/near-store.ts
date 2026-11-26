// The near store: the structures and the resource nodes of the chunks the client holds whole, drawn per chunk and per mesh
// as instanced batches. A chunk's instance buffer is rebuilt only when a piece is added, removed or replaced, and uploaded
// once. Damage lays nothing out again: a built piece's stage goes up as its instance's bytes (../piece-state.ts). Resource nodes are drawn the same way, each as the mesh of its form
// (shared/world/nodes.ts) at its size. The map's statics drawn flat as their form are a mesh a chunk (../nearcity.ts),
// drawn by a second row of the frame's list (`meshes`), once the frame knows what hides what.

import type { Registry } from "../../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../../../shared/pack/pack.ts";
import { KERB_BACK } from "../../../../shared/world/bends.ts";
import { bendOf } from "../../../../shared/world/mapfile.ts";
import { SIZE_UNITS } from "../../../../shared/world/nodes.ts";
import type { ChunkTable, StructureStore } from "../../../../shared/world/structures.ts";
import type { Assets } from "../../assets/assets.ts";
import { BasePlates, PLATE_NONE } from "../base-occluders.ts";
import { coverScale, crownScale, leavesAt, thinning, type FrameBudget } from "../budget.ts";
import type { Camera } from "../camera.ts";
import type { Casting } from "../casting.ts";
import { CrownCover, coverDistance, type CoverLooks, type CoverRule } from "../cover.ts";
import type { Draws } from "../draws.ts";
import type { FarBlocks } from "../far.ts";
import type { FarCity } from "../farcity.ts";
import type { FarLandmarks } from "../farlandmarks.ts";
import { formPaint } from "../form-paint.ts";
import { HAND_NEAR } from "../hand.ts";
import type { Hiding } from "../hide.ts";
import { LAMP_BIT } from "../lamp.ts";
import { MESH_SLOT, NearCity, type NearMesh } from "../nearcity.ts";
import { BEND_BUFFERS, DRAW_PIECE, DRAW_RANGED, DRAW_SIZED, InstanceWriter, MAX_CASCADES, MAX_DRAWS, PASS_FAR, PASS_NEAR, type FramePacket } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { FIT_YIELD, FrameTable, PIECE_FIT_AT, PIECE_FRAMED, PIECE_FRAMES, PIECE_STATE_AT, pieceWord, plainYaw, writePiece } from "../piece-fit.ts";
import { PieceLooks, followStages, stageUploads } from "../piece-state.ts";
import { TekWallView } from "../tek-wall-view.ts";
import { Trims, borderBit, type TrimLayout } from "../trims.ts";
import { DOOR_FRONTIER, DOOR_OPEN, RoomFinder, Rooms } from "../rooms.ts";
import type { RenderWorld } from "../scene.ts";
import type { StreetReflections } from "../street-reflections.ts";

const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
/** Instance buffers of the node store are numbered from here, clear of chunk indices. */
export const NODE_BUFFERS = 1 << 20;
/**
 * A chunk of pieces, statics or nodes is cut into this many cells a side, 16 m across. A mesh's instances in it are drawn
 * by cell: a cell out of view is left out, one in view is drawn at the level its own distance asks for, and each casts
 * only into the cascades it reaches, so what stands behind the camera or across the chunk a player stands in is not
 * drawn, shadowed or levelled as what is at his feet. Neighbouring cells of one level are one draw, so a chunk off in the
 * distance is still one draw for each mesh. Chosen on a wood with every slot filled (tools/bench/nodes.ts): by the
 * chunk, 4.2 M triangles and 96 draws a frame; by these cells, 3.5 M and 141 (3.4 M and 203 were cells never joined at
 * the cost of a draw); by cells of 8 m, 3.4 M and 154. Measured to the nodes' trunks and not their crowns, these cells
 * give 3.3 M and 135, and 8 m ones 3.3 M and 147.
 */
export const CHUNK_CELLS = 4;
/** Metres up and down a chunk's column is taken to reach, to ask whether a sight's window sees it. */
const CHUNK_COLUMN = 1000;
/** A draw costs about what drawing this many more triangles does. Neighbouring cells share a draw when that saves more. */
const RUN_TRIANGLES = 4096;
/** A cell of trees drawn this long ago or less is still on screen, so a change of its level is swapped, not taken at once. */
const SEEN_MS = 250;
/** How far a cell's count of crowns in the way must move from the one taken before it is taken again (coverCells). */
const COVER_MARGIN = 0.75;
/** How far, in metres, the eye moves before a cell's crowns in the way are counted again: the count is the eye's alone. */
const COVER_MOVE = 1;
/** What the card holds for the chunks' instance buffers is reserved under this name. */
const INSTANCES = "chunk instances";
/** Milliseconds a chunk's doors stand other than its rooms were found with before they are found again. */
const SETTLE = 2000;
/** Milliseconds at most that a chunk whose pieces keep leaving its mesh goes with its rooms as they were found before. */
const FLOOD_MOST = 10000;
/** A node form with nothing to draw: what is left of a used-up node whose mesh no pack has. */
export const HIDDEN = 0xffff;
/** The bits of a yaw that are not its quarter turns: pieces alike in them stand in one basis. The most a chunk's are told apart, past which the rest are drawn by yaw. */
const TURN = 16383;
const TURNS_MOST = 64;
/** In `blockAt`, a slot with no instance: no block is this. */
const UNDRAWN = 255;
/** Metres past its pieces' middles a chunk never laid out is taken to reach, for what its trims stand out beyond them. */
const UNLAID_PAD = 8;
/** A chunk never laid out that nothing of could be seen or cast waits, and is laid out ahead within this many metres, nearest first, up to this many pieces a frame. */
const AHEAD_M = 384;
const AHEAD_PIECES = 2048;
/** Numbers a run of cells takes in `runs` (ranges), and in `castRuns` (castChunk). */
const RUN = 13;
const CAST_RUN = 5;

/** What is known of a chunk never laid out: the table and its `shape` when its box was found round its pieces. */
interface Unlaid {
  table: ChunkTable;
  shape: number;
  box: Float64Array;
}

export interface ChunkBatch {
  /** The table's `shape` and `placed` when the instances were built. */
  shape: number;
  placed: number;
  /** Its meshes whose pages had not come when it was built, held as points: it is built again when one comes. */
  unknown: number[];
  /** A chunk of nodes, drawn sized, handed to the far store over the tier's band, its trees' crowns giving to the budget. */
  sized: boolean;
  data: Uint8Array;
  slots: Uint16Array;
  /** Per instance, the kind it was built as. */
  kinds: Uint16Array;
  /** Triples: mesh, first instance, instance count. */
  ranges: number[];
  /** The level each range was last drawn at whole, or -1. */
  level: Int8Array;
  /**
   * Cells the chunk is cut into, `chunkCells` squared, one row and then the next back the other way, so that neighbouring
   * cells follow one another. A range's instances are sorted shell first (rooms.ts), then by cell, and in a cell by slot.
   */
  cells: number;
  /** `cells`, or twice that where the chunk has pieces inside its rooms: a range's shell by cell, then its interior by cell. */
  blocks: number;
  /** Per range, the first instance of each block and the end of the last. */
  cellFirst: Uint32Array;
  /** A chunk of pieces' rooms, kept to be brought up to date at its next rebuild. Null for nodes. */
  rooms: Rooms | null;
  /** Per door slot, its DOOR_ flags when the rooms were found; frontier doors shut then and open now; doors not as then, and the frame they last changed at (Scene.now). */
  doors: Map<number, number> | null;
  exposing: number;
  differ: number;
  since: number;
  /** Per range and cell: the box its level is chosen by, x, y, z least then most, in metres: its nodes' trunks, or its pieces whole. */
  cellBox: Float32Array;
  /** Per range, the box round all its cells as `boxRun` finds it, made when first asked for; NaN for one not yet asked. Null until then. */
  whole: Float64Array | null;
  /** Per cell: the box round all it draws, as `cellBox` lays them out, tested against the view and the cascades. */
  zone: Float32Array;
  /** Per range and cell, the level it was last drawn at, or -1. */
  cellLevel: Int8Array;
  /**
   * For a tree's crown, per range and per range and cell as `level` and `cellLevel`: the level it was last drawn at, or
   * -1, and the thinning of its leaves (budget.ts), or 255.
   */
  crown: Int8Array;
  thin: Uint8Array;
  cellCrown: Int8Array;
  cellThin: Uint8Array;
  /** For trees that swap levels (swapOf): the crown and trunk levels a cell was last drawn at and when, and the levels it is changing from and since when; -1 for none. */
  cellShown: Int8Array;
  cellShownTrunk: Int8Array;
  cellWas: Int8Array;
  cellWasTrunk: Int8Array;
  cellSince: Float64Array;
  cellSeenAt: Float64Array;
  /** For trees behind other crowns (cover.ts): per range and cell, the crowns counted in the way last taken, -1 for none yet, and how many times as far its levels are chosen. */
  cellCount: Float32Array;
  cellCover: Float32Array;
  /** Where the eye was when each count was taken: a cell is counted again once it has moved COVER_MOVE. */
  cellEye: Float32Array;
  /** Which making of the crowns' grid each count was taken from (CrownCover.made): a cell is counted again on a new one. */
  cellMade: Uint32Array;
  /**
   * Per range, and per range and cell, the largest size of the kinds of its nodes, as a multiple of the modelled size, and
   * 1 for pieces. Two kinds may grow as one mesh at different sizes (the young live oak and the elder), and each is drawn
   * by its own.
   */
  reach: Float32Array;
  cellReach: Float32Array;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  uploaded: boolean;
  /** Bytes the card holds of the buffer by this chunk's id, until this or the next batch of it goes up in their place. */
  onCard: number;
  /** The mesh its statics of kinds drawn flat as their form are drawn with in place of their instances (nearcity.ts), or null; and its one instance, after the pieces', which is every instance's count. */
  mesh: NearMesh | null;
  meshAt: number;
  /** Per cell, what of its mesh is in view this frame (meshCells): 1 for faces it shows, 2 for faces it kept and now draws. */
  inView: Uint8Array;
  /** Per slot of the table when it was built, its instance, or -1; and the instances' places as floats, five an instance. */
  at: Int32Array;
  places: Float32Array;
  /** `zone` and the box round it all before its mesh's cells were added, and the mesh's count of cells opened that they were added at. */
  ownZone: Float32Array;
  ownBox: Float64Array;
  opens: number;
  /** When the first and the last piece left its mesh since its rooms were found, in the scene's milliseconds; -1 for none. */
  holed: number;
  holedLast: number;
  /**
   * Per instance, its bend where its kind is bent (bend.ts), eight numbers each, which go up as the buffer BEND_BUFFERS past
   * the instances'; null where none is. `unbent`: built before its chunk's bends were to hand (before its sector's statics
   * came), so built again once they are.
   */
  bends: Int16Array | null;
  unbent: boolean;
  /** The bases its built pieces stand in (piece-fit.ts), which its draws of them are given; null where it has none. */
  frames: FrameTable | null;
  /** The table's version its pieces' stages were last read at, and the instances changed since the card was given the buffer (piece-state.ts). */
  seen: number;
  dirty: number[];
  /** Its trims (trims.ts): per instance 1 for one; per slot the first of its piece's in `trimAt`, their instances. Null where it has none. */
  trimmed: Uint8Array | null;
  trimFirst: Uint32Array | null;
  trimAt: Uint32Array | null;
  /** The chunks round it whose pieces its trims turn on, a bit each, and the sum of their tables' `placed` when it was built. */
  borders: number;
  borderSum: number;
  /** The chunks `borders` names that are on the map, by index. */
  bordered: Int32Array;
  /** What its built pieces hide, as these instances draw them (base-occluders.ts): hide.ts OCCLUDER numbers a plate. */
  plates: Float64Array;
}

/** What the near store reads of the registry and the pack, each made once by the scene (Scene's fields of the same names). */
export interface NearLooks {
  readonly meshOfKind: Uint16Array;
  readonly colorOfKind: Uint8Array;
  readonly meshOfForm: Uint16Array;
  readonly colorOfForm: Uint8Array;
  readonly sizeOfForm: Uint8Array;
  readonly mostOfForm: Uint8Array;
  readonly reachOfMesh: Float32Array;
  readonly reachOfStatic: Float32Array;
  readonly groundFlags: Uint16Array;
  readonly bentKind: Uint8Array;
  readonly regionsOfKind: Uint8Array;
  readonly treeOf: Uint8Array;
  readonly trisOfMesh: readonly (readonly number[])[];
  readonly radiusOfMesh: Float32Array;
  readonly trunkTris: number[][];
  readonly leafTris: number[][];
  readonly landmarkKinds: Uint8Array;
  /** The mesh that stands for a kind whose own no pack has. */
  readonly missing: number;
}

export class NearStore implements Pass {
  readonly tekWalls: TekWallView;
  readonly hiddenNodes = new Set<number>();
  private readonly hiddenChanged = new Set<number>();
  /** How many crowns stand in the way of a cell of trees (cover.ts), made from the near node field on tiers that ask. */
  readonly cover: CrownCover;
  private readonly coverLooks: CoverLooks;
  structureDistance = Infinity;
  /** The chunks whose bends' buffers the card holds (BEND_BUFFERS). */
  private readonly bendsOnCard = new Set<number>();
  readonly batches = new Map<number, ChunkBatch>();
  /** Scratch for the runs of cells a mesh of a chunk is drawn in, and cast in, and the instances a run takes (spansOf). */
  private readonly runs: number[] = [];
  private readonly castRuns: number[] = [];
  private readonly spans = new Uint32Array(4);
  /** Cells a chunk is cut into along each side. CHUNK_CELLS, or 1 to draw, level and cast by the chunk. */
  chunkCells = CHUNK_CELLS;
  /** Per mesh and block, as `counts` and `cursor` are per mesh, for a chunk being laid out. */
  private cellCounts = new Uint32Array(0);
  private cellCursor = new Uint32Array(0);
  /** Finds the pieces of a chunk seen only from inside its rooms (rooms.ts). */
  readonly finder: RoomFinder;
  /** Per slot of a chunk being laid out, the block it goes in. */
  private blockAt = new Uint8Array(0);
  /** Per mesh, the mesh its kinds turn into in place (a door's open form, a fire lit), or -1; and turned round, the meshes whose twin a mesh is. */
  private readonly twinOf: Int32Array;
  private readonly twinsOf = new Map<number, number[]>();
  /** The meshes a chunk being laid out has instances of, each marked; `cellCounts` is zero for every other. */
  private readonly used: number[] = [];
  private readonly usedMark: Uint8Array;
  /** For the chunk being drawn, per cell: 2 where all of it is in view, 1 where some is, and the cascades it casts into; and whether all the chunk is in view. */
  private cellSeen = new Uint8Array(0);
  private cellCasts = new Uint8Array(0);
  private wholeView = false;
  /** Bytes of the chunks' instance buffers on the card, and as reserved under INSTANCES. */
  private instanceBytes = 0;
  private instancesReserved = 0;
  /** The chunks whose built pieces in view were every one drawn this frame, and have plates: what they hide may be left out. */
  readonly plated: number[] = [];
  /** Finds a chunk's plates. `plating` false leaves `plated` empty, for a before and after. */
  readonly plates: BasePlates;
  plating = true;
  private readonly platable: (kind: number) => boolean;
  /** Chunks of the near store whose mesh has a draw this frame; per chunk that casts, its casters from and to and its shadow's box. */
  readonly meshDrawn = new Set<number>();
  readonly chunkCasts: number[] = [];
  /** The chunks whose meshes are drawn once the frame knows what hides what: each its id, corner from the camera and depth ranges. */
  readonly later: number[] = [];
  /** The shadow's reach `zones` found for the chunk it was last given. */
  private zoneStretch = 0;
  /** With the far city, the near store's chunks' statics drawn flat as their form as a mesh a chunk (nearcity.ts). */
  readonly near: NearCity | null;
  /** Whether a chunk the near store holds whole draws such statics from its mesh; false draws them as instances, for pictures held to them. */
  nearMesh = true;
  /** Who draws a chunk the store does not hold whole, which it then leaves to them: the scene sets each as it is made. */
  far: FarBlocks | null = null;
  city: FarCity | null = null;
  landmarks: FarLandmarks | null = null;
  /** The frame's time, the end of its view and its hand-over band's scale, set as it starts to draw. */
  private now = 0;
  private view = 0;
  private handScale = 1;
  private readonly world: RenderWorld;
  private readonly assets: Assets;
  private readonly packet: FramePacket;
  private readonly put: Draws;
  private readonly casting: Casting;
  private readonly budget: FrameBudget;
  private readonly hiding: Hiding;
  private readonly street: StreetReflections;
  private readonly meshOfKind: Uint16Array;
  private readonly colorOfKind: Uint8Array;
  private readonly meshOfForm: Uint16Array;
  private readonly colorOfForm: Uint8Array;
  private readonly sizeOfForm: Uint8Array;
  private readonly mostOfForm: Uint8Array;
  private readonly reachOfMesh: Float32Array;
  private readonly reachOfStatic: Float32Array;
  private readonly groundFlags: Uint16Array;
  private readonly bentKind: Uint8Array;
  private readonly regionsOfKind: Uint8Array;
  private readonly treeOf: Uint8Array;
  private readonly trisOfMesh: readonly (readonly number[])[];
  private readonly radiusOfMesh: Float32Array;
  private readonly trunkTris: number[][];
  private readonly leafTris: number[][];
  private readonly landmarkKinds: Uint8Array;
  /** Per kind, its break set and its form in it (shared/content/breaks.ts), by which a slot's form of its map piece is known. */
  private readonly breakSet: Uint16Array;
  private readonly breakForm: Uint8Array;
  /** How many meshes the pack has, and scratch a mesh for a chunk being laid out. */
  private readonly meshCount: number;
  private readonly cursor: Uint32Array;
  /** The chunks' meshes, drawn once the frame knows what hides what: a row of the frame's list after the pass that finds it. */
  readonly meshes: Pass = { draw: () => this.drawMeshes() };
  /** How built pieces are drawn, and what is drawn where they meet. */
  readonly pieces: PieceLooks;
  readonly trims: Trims;
  /**
   * Whether a chunk of built pieces never laid out waits until something of it could be seen or cast. By chunk, what is
   * known of each such, and how many; and the chunks waiting this frame.
   */
  lazy = true;
  private readonly unlaid: (Unlaid | undefined)[] = [];
  private unlaidCount = 0;
  private readonly waiting: number[] = [];
  /** Scratch for a chunk being laid out: the yaws its pieces stand at, less their quarter turns, and how many at each. */
  private readonly turns: number[] = [];
  private readonly turnCounts: number[] = [];

  /** `meshes` is the manifest's, `farMesh` the far mesh or -1, and `street` is told of each chunk drawn where the tier reflects. */
  constructor(world: RenderWorld, reg: Registry, assets: Assets, packet: FramePacket, put: Draws, casting: Casting, budget: FrameBudget, hiding: Hiding, street: StreetReflections, meshes: ConstructorParameters<typeof RoomFinder>[2], farMesh: number, looks: NearLooks) {
    this.world = world;
    this.assets = assets;
    this.packet = packet;
    this.put = put;
    this.casting = casting;
    this.budget = budget;
    this.hiding = hiding;
    this.street = street;
    this.meshOfKind = looks.meshOfKind;
    this.colorOfKind = looks.colorOfKind;
    this.meshOfForm = looks.meshOfForm;
    this.colorOfForm = looks.colorOfForm;
    this.sizeOfForm = looks.sizeOfForm;
    this.mostOfForm = looks.mostOfForm;
    this.reachOfMesh = looks.reachOfMesh;
    this.reachOfStatic = looks.reachOfStatic;
    this.groundFlags = looks.groundFlags;
    this.bentKind = looks.bentKind;
    this.regionsOfKind = looks.regionsOfKind;
    this.treeOf = looks.treeOf;
    this.trisOfMesh = looks.trisOfMesh;
    this.radiusOfMesh = looks.radiusOfMesh;
    this.trunkTris = looks.trunkTris;
    this.leafTris = looks.leafTris;
    this.landmarkKinds = looks.landmarkKinds;
    this.breakSet = reg.breakSet;
    this.breakForm = reg.breakForm;
    const table = assets.table;
    this.meshCount = table.count;
    this.cursor = new Uint32Array(table.count);
    this.finder = new RoomFinder(reg, this.meshOfKind, meshes, table.error);
    this.twinOf = new Int32Array(table.count).fill(-1);
    for (let k = 1; k < reg.defs.length; k++) {
      const other = reg.opens[k] || reg.lights[k]!;
      if (other !== 0 && this.meshOfKind[k] !== this.meshOfKind[other]) this.twinOf[this.meshOfKind[k]!] = this.meshOfKind[other]!;
    }
    for (let m = 0; m < table.count; m++) if (this.twinOf[m]! >= 0) (this.twinsOf.get(this.twinOf[m]!) ?? this.twinsOf.set(this.twinOf[m]!, []).get(this.twinOf[m]!)!).push(m);
    this.usedMark = new Uint8Array(table.count);
    this.pieces = new PieceLooks(reg, this.meshOfKind, this.regionsOfKind, table.count, looks.missing);
    this.tekWalls = new TekWallView(world.structs, reg.index, id => table.find(id));
    this.tekWalls.markMeshes(this.pieces.flag, DRAW_PIECE);
    this.plates = new BasePlates(reg);
    this.platable = (kind) => this.meshOfKind[kind] !== looks.missing && this.meshOfKind[kind] !== HIDDEN && this.assets.known(this.meshOfKind[kind]!);
    this.trims = new Trims(reg, (id) => table.find(id), this.pieces);
    this.cover = new CrownCover(world.dims);
    this.coverLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, treeOf: this.treeOf, side: table.side, low: table.low, high: table.high, hidden: (ref) => this.hiddenNodes.has(ref) };
    const flat = (k: number): boolean => this.meshOfKind[k] !== looks.missing && this.meshOfKind[k] !== HIDDEN && table.sections[this.meshOfKind[k]!]!.every((runs) => runs.length === 0);
    this.near = farMesh >= 0 ? new NearCity(reg, farMesh, this.landmarkKinds, flat, packet) : null;
    if (this.near) this.near.paint = formPaint(reg);
  }

  /** Before a frame: a chunk of nodes one of which was hidden or shown is laid out again, and nothing is yet drawn or cast. */
  begin(): void {
    for (const chunk of this.hiddenChanged) {
      const batch = this.batches.get(NODE_BUFFERS + chunk);
      if (batch) batch.shape = -1;
    }
    if (this.hiddenChanged.size > 0) this.cover.stale = true;
    this.hiddenChanged.clear();
    this.meshDrawn.clear();
    this.plated.length = 0;
    this.chunkCasts.length = 0;
    this.later.length = 0;
  }

  /** After a lost graphics context: every chunk's buffer goes up again. */
  reset(): void {
    for (const b of this.batches.values()) {
      b.uploaded = false;
      b.onCard = 0;
    }
    this.instanceBytes = 0;
  }

  /** The structures, then the nodes, and what the card holds of both. */
  draw(f: Frame): void {
    this.now = f.now;
    this.tekWalls.update(f.now, f.tick);
    this.view = f.view;
    this.handScale = f.handScale;
    const world = this.world;
    this.structures(f.cam, world.structs, 0, this.meshOfKind, this.colorOfKind, null);
    if (world.nodes) this.structures(f.cam, world.nodes, NODE_BUFFERS, this.meshOfForm, this.colorOfForm, this.sizeOfForm);
    if (this.instanceBytes !== this.instancesReserved) this.assets.residency.reserve(INSTANCES, (this.instancesReserved = this.instanceBytes));
  }

  private drawMeshes(): void {
    for (let k = 0; k < this.later.length; k += 5) {
      const id = this.later[k]!;
      this.meshRuns(this.batches.get(id)!, id, this.later[k + 1]!, this.later[k + 2]!, this.later[k + 3]!, this.later[k + 4]!);
    }
  }

  hideNode(ref: number, hide: boolean): void {
    if (this.hiddenNodes.has(ref) === hide) return;
    if (hide) this.hiddenNodes.add(ref); else this.hiddenNodes.delete(ref);
    const chunk = Math.floor(ref / 65536); this.hiddenChanged.add(chunk);
    this.world.farNodes?.changes.touch(chunk);
  }

  /**
   * Chunk `c` of the store uses instance buffer `base + c`. A slot's kind is drawn as `meshOf` and `colorOf` say, and at the
   * size `sizeOf` says if it is given: a store of nodes.
   */
  private structures(cam: Camera, store: StructureStore, base: number, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null): void {
    const p = this.packet;
    const world = this.world;
    const chunks = store.chunks;
    const band = this.assets.tier.nodes.band[1] * this.handScale;
    // The node field's crowns, for how many stand in the way of each cell of trees.
    if (sizeOf && this.assets.tier.nodes.cover) this.cover.update(store, this.coverLooks);
    // How far the near plane's corners are from the camera: a room that near may be cut into and seen.
    const slope = Math.tan(cam.fovY / 2);
    const reach = cam.near * Math.sqrt(1 + slope * slope * (1 + cam.aspect * cam.aspect));
    // The map's statics drawn flat as their form are a mesh a chunk where the far city follows what of them stands.
    const statics = world.city?.statics;
    const near = base === 0 && this.nearMesh && this.city && statics ? this.near : null;
    if (base === 0 && !near) this.near?.clear(this.assets.residency);
    near?.begin(this.now);
    // Instances laid out this frame, which take of what the near city may make in it.
    let laid = 0;
    const waiting = this.waiting;
    waiting.length = 0;

    // Chunks that no longer exist on this client free their buffers.
    for (const id of this.batches.keys()) if (id >= base && id < base + NODE_BUFFERS && !chunks[id - base]) this.drop(id);
    // What was found of chunks since laid out or gone is let go once it outnumbers the chunks held.
    if (base === 0 && this.unlaidCount > store.held.length) {
      for (let chunk = 0; chunk < this.unlaid.length; chunk++) if (this.unlaid[chunk] && (!chunks[chunk] || this.batches.has(chunk))) this.forgetUnlaid(chunk);
    }

    const held = store.held;
    // Each chunk's pieces are found before any chunk is drawn, so that one that left shows what it hid in the chunks
    // round its own in this frame, whichever of them comes first. Its near mesh is made nearest first, a chunk in a
    // sight's window as if its zoom times nearer (D1087).
    for (let h = 0; near && h < held.length; h++) {
      const chunk = held[h]!;
      // A chunk emptied of the map's pieces is followed still: the last of them to go held faces too.
      if ((chunks[chunk]!.live === 0 && statics!.in(chunk) === 0) || this.far?.isFar(chunk) || this.city?.isFar(chunk) || this.landmarks?.isFar(chunk)) continue;
      const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
      const across = Math.hypot(x0 + CHUNK_SIZE / 2 - cam.x, z0 + CHUNK_SIZE / 2 - cam.z);
      const sooner = cam.zoom > 1 && cam.boxVisible(x0 - cam.x, -CHUNK_COLUMN - cam.y, z0 - cam.z, x0 + CHUNK_SIZE - cam.x, CHUNK_COLUMN - cam.y, z0 + CHUNK_SIZE - cam.z) ? cam.zoom : 1;
      near.of(chunk, chunks[chunk]!, statics!, this.chunkCells, across / sooner);
    }
    for (let h = 0; h < held.length; h++) {
      const chunk = held[h]!;
      const t = chunks[chunk]!;
      const id = base + chunk;
      if (t.live === 0) {
        this.drop(id);
        continue;
      }
      // Until the near store holds it whole, a chunk the far feed has cells of is drawn as blocks.
      if (base === 0 && (this.far?.isFar(chunk) || this.city?.isFar(chunk) || this.landmarks?.isFar(chunk))) continue;
      const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
      const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
      if (base === 0 && p.tier.reflectionHz) this.street.indexChunk(t,x0,z0,cam);
      const own = near?.chunk(chunk) ?? null;
      const mesh = own?.mesh ?? null;
      let batch = this.batches.get(id);
      if (!batch && base === 0 && !mesh && this.lazy && !this.mayShow(cam, t, chunk, meshOf)) {
        waiting.push(chunk);
        continue;
      }
      // A piece that took another kind in place is moved in place; a chunk whose doors have stood a while other than its
      // rooms were found with has them found again. A mesh not yet known has its page asked for while it is near. A chunk
      // whose mesh came, or whose instances are no longer what its table and its mesh ask for, is laid out again the same
      // frame. One whose pieces only left its mesh, or whose mesh was made again of the same pieces, keeps its instances.
      let learnt = false;
      if (batch) for (const m of batch.unknown) learnt = this.assets.known(m) || learnt;
      if (batch && own && mesh && batch.mesh && (batch.shape !== t.shape || batch.mesh !== mesh) && this.keeps(batch, t, meshOf, own.drawn, x0, z0)) {
        if (batch.shape !== t.shape && batch.blocks !== batch.cells) {
          if (batch.holed < 0) batch.holed = this.now;
          batch.holedLast = this.now;
        }
        batch.shape = t.shape;
        batch.placed = t.placed;
        if (batch.mesh !== mesh) {
          batch.mesh = mesh;
          this.meshIn(batch, x0, z0);
        }
      }
      const turned = batch !== undefined && batch.shape !== t.shape && !batch.sized && batch.placed === t.placed;
      const flood = batch !== undefined && ((batch.differ > 0 && this.now - batch.since >= SETTLE) || (batch.holed >= 0 && (this.now - batch.holedLast >= SETTLE || this.now - batch.holed >= FLOOD_MOST)));
      // A chunk whose trims turn on the pieces of the chunks round it is laid out again when one of those gains or loses a piece.
      const met = batch !== undefined && batch.borders !== 0 && this.bordering(store, batch.bordered) !== batch.borderSum;
      if (!batch || (!sizeOf && this.tekWalls.layouts.has(chunk)) || learnt || met || batch.mesh !== mesh || (batch.unbent && statics?.squareOf(chunk)?.map.bends.has(chunk)) || (batch.shape !== t.shape && !(turned && this.reform(batch, t, chunk, meshOf, colorOf) && (!own || !batch.mesh || this.keeps(batch, t, meshOf, own.drawn, x0, z0)))) || flood) {
        batch = this.rebuild(store, chunk, id, batch, meshOf, colorOf, sizeOf, mesh, own?.drawn ?? null);
        if (!sizeOf) this.tekWalls.layouts.delete(chunk);
        laid += t.high;
      }
      // A cell of its mesh opened since draws what the mesh kept there, which may reach past what it showed.
      if (batch.mesh && batch.mesh.opens !== batch.opens) this.meshIn(batch, x0, z0);
      // A piece whose health crossed a stage is drawn at it: its instance's one byte, and no layout.
      if (batch.frames && batch.seen !== t.version) followStages(batch, t, this.pieces, meshOf);
      if (!sizeOf) this.tekWalls.follow(batch, chunk);
      const ax = batch.minX - cam.x;
      const ay = batch.minY - cam.y;
      const az = batch.minZ - cam.z;
      const bx = batch.maxX - cam.x;
      const by = batch.maxY - cam.y;
      const bz = batch.maxZ - cam.z;
      const dx = ax > 0 ? ax : bx < 0 ? -bx : 0;
      const dy = ay > 0 ? ay : by < 0 ? -by : 0;
      const dz = az > 0 ? az : bz < 0 ? -bz : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Nodes past the tier's hand-over band are the far store's to draw (farnodes.ts).
      const seen = cam.boxVisible(ax, ay, az, bx, by, bz) && dist <= this.view && dist <= this.structureDistance && (sizeOf === null || dist < band);
      // A chunk out of view may still cast into it.
      const casts = this.casting.on ? this.casting.castBox(ax, ay, az, bx, by, bz) : 0;
      if (!seen && casts === 0) continue;
      if (!batch.uploaded) {
        p.uploads.push({ buffer: id, data: batch.data, slots: batch.slots });
        const bends = batch.bends ? new Uint8Array(batch.bends.buffer, batch.bends.byteOffset, batch.bends.byteLength) : null;
        if (bends) {
          p.uploads.push({ buffer: id + BEND_BUFFERS, data: bends, slots: batch.slots });
          this.bendsOnCard.add(id);
        }
        const bytes = batch.data.length + (bends?.length ?? 0);
        batch.uploaded = true;
        batch.dirty.length = 0;
        this.assets.residency.spend(bytes);
        this.instanceBytes += bytes - batch.onCard;
        batch.onCard = bytes;
      } else if (batch.dirty.length > 0) this.assets.residency.spend(stageUploads(batch, id, p.uploads));
      this.zones(cam, batch, seen, casts);
      // From outside air a chunk's interior is neither seen nor seen to cast: only its shell is drawn and cast.
      const phasing = !sizeOf && this.tekWalls.exposing.has(chunk);
      const all = batch.blocks === batch.cells || phasing || batch.exposing > 0 || batch.holed >= 0 || batch.rooms!.near(cam.x, cam.y, cam.z, reach);
      const ox = x0 - cam.x, oy = -cam.y, oz = z0 - cam.z;
      const left = p.skipped + p.dropped;
      if (seen) this.ranges(cam, batch, id, dist, ox, oy, oz, cam.passes(ax, ay, az, bx, by, bz), all);
      // Its plates hide only while every piece of it in view is drawn: a level not yet on the card leaves a wall out.
      if (seen && !phasing && this.plating && batch.plates.length > 0 && p.skipped + p.dropped === left) this.plated.push(id);
      // A chunk's mesh is drawn once the frame knows what hides what, by its cells in view that are not hidden.
      if (seen && batch.mesh && this.meshCells(cam, batch, ox, oy, oz) > 0) {
        this.meshDrawn.add(id);
        this.later.push(id, ox, oy, oz, cam.passes(ax, ay, az, bx, by, bz));
      }
      const castFrom = p.casterCount;
      if (casts !== 0) this.castChunk(batch, id, ox, oy, oz, casts, all);
      if (casts !== 0 && batch.mesh) this.castMesh(batch, id, ox, oy, oz);
      // What casts into the lamp's map is not left out for where its shadow from the sun would fall.
      if (p.casterCount === castFrom || (casts & LAMP_BIT) !== 0) continue;
      // What the chunk's casters shade lies in its box swept from the sun as far as its shadow reaches.
      const sx = -this.casting.sunAt[0]! * this.zoneStretch, sy = -this.casting.sunAt[1]! * this.zoneStretch, sz = -this.casting.sunAt[2]! * this.zoneStretch;
      this.chunkCasts.push(castFrom, p.casterCount, Math.min(ax, ax + sx), Math.min(ay, ay + sy), Math.min(az, az + sz), Math.max(bx, bx + sx), Math.max(by, by + sy), Math.max(bz, bz + sz));
    }
    if (waiting.length > 0) laid = this.ahead(cam, store, waiting, laid, meshOf, colorOf);
    near?.end(this.assets.residency, statics!, this.city!, world.hf, this.chunkCells, laid);
  }

  /**
   * Whether anything of chunk `chunk`, never laid out, could be seen or cast this frame: the box round its pieces' middles,
   * each as far round as its mesh reaches and UNLAID_PAD more, tested as a laid chunk's box is. A chunk with a bent piece
   * is always laid out.
   */
  private mayShow(cam: Camera, t: ChunkTable, chunk: number, meshOf: Uint16Array): boolean {
    let u = this.unlaid[chunk];
    if (!u) {
      this.unlaid[chunk] = u = { table: t, shape: t.shape - 1, box: new Float64Array(6) };
      this.unlaidCount++;
    }
    const box = u.box;
    if (u.table !== t || u.shape !== t.shape) {
      u.table = t;
      u.shape = t.shape;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let s = 0; s < t.high; s++) {
        const kind = t.kind[s]!, mesh = meshOf[kind]!;
        if (kind === 0 || mesh === HIDDEN) continue;
        if (this.bentKind[kind] === 1) {
          minX = -Infinity;
          break;
        }
        const r = this.radiusOfMesh[mesh]!, x = t.x[s]!, y = t.y[s]!, z = t.z[s]!;
        if (x - r < minX) minX = x - r;
        if (y - r < minY) minY = y - r;
        if (z - r < minZ) minZ = z - r;
        if (x + r > maxX) maxX = x + r;
        if (y + r > maxY) maxY = y + r;
        if (z + r > maxZ) maxZ = z + r;
      }
      box[0] = minX - UNLAID_PAD;
      box[1] = minY - UNLAID_PAD;
      box[2] = minZ - UNLAID_PAD;
      box[3] = maxX + UNLAID_PAD;
      box[4] = maxY + UNLAID_PAD;
      box[5] = maxZ + UNLAID_PAD;
    }
    if (box[0] === -Infinity) return true;
    const ax = box[0]! - cam.x, ay = box[1]! - cam.y, az = box[2]! - cam.z, bx = box[3]! - cam.x, by = box[4]! - cam.y, bz = box[5]! - cam.z;
    const dx = ax > 0 ? ax : bx < 0 ? -bx : 0, dy = ay > 0 ? ay : by < 0 ? -by : 0, dz = az > 0 ? az : bz < 0 ? -bz : 0;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= this.view && dist <= this.structureDistance && cam.boxVisible(ax, ay, az, bx, by, bz)) return true;
    return this.casting.on && this.casting.castBox(ax, ay, az, bx, by, bz) !== 0;
  }

  private forgetUnlaid(chunk: number): void {
    if (!this.unlaid[chunk]) return;
    this.unlaid[chunk] = undefined;
    this.unlaidCount--;
  }

  /**
   * Lays out ahead the chunks `waiting` within AHEAD_M of the camera, nearest first, while fewer than AHEAD_PIECES slots
   * have been laid out this frame, so that turning round finds them ready. Returns the slots laid out, `laid` first.
   */
  private ahead(cam: Camera, store: StructureStore, waiting: number[], laid: number, meshOf: Uint16Array, colorOf: Uint8Array): number {
    const dims = this.world.dims;
    while (laid < AHEAD_PIECES) {
      let best = -1, near = AHEAD_M;
      for (let k = 0; k < waiting.length; k++) {
        const chunk = waiting[k]!;
        if (chunk < 0) continue;
        const d = Math.hypot((chunkCx(dims, chunk) + 0.5) * CHUNK_SIZE - cam.x, (chunkCz(dims, chunk) + 0.5) * CHUNK_SIZE - cam.z);
        if (d < near) {
          near = d;
          best = k;
        }
      }
      if (best < 0) break;
      const chunk = waiting[best]!;
      waiting[best] = -1;
      this.rebuild(store, chunk, chunk, undefined, meshOf, colorOf, null, null, null);
      laid += store.chunks[chunk]!.high;
    }
    return laid;
  }

  /**
   * The kind whose colour and regions the piece of `kind` in slot `s` of `chunk`, owned by `owner`, is drawn in: the kind
   * the map placed there where the slot holds a broken form of it, which has no finish of its own; else its own.
   */
  private dye(chunk: number, s: number, kind: number, owner: number): number {
    if (this.breakForm[kind] === 0 || owner !== 0) return kind;
    const city = this.world.city?.statics;
    if (!city || s >= city.in(chunk)) return kind;
    const t = city.rows(chunk)!, placed = t.kind[t.from(chunk) + s]!;
    return this.breakSet[placed] === this.breakSet[kind] ? placed : kind;
  }

  /** Lets go of a chunk's instances, and the card of its buffer. */
  private drop(id: number): void {
    const b = this.batches.get(id);
    if (id < NODE_BUFFERS) this.forgetUnlaid(id);
    if (!b) return;
    if (b.uploaded || b.onCard > 0) this.packet.drops.push(id);
    if (this.bendsOnCard.delete(id)) this.packet.drops.push(id + BEND_BUFFERS);
    if (b.frames) this.packet.frameTables.delete(id);
    this.instanceBytes -= b.onCard;
    this.batches.delete(id);
    if (id < NODE_BUFFERS) this.trims.forget(id);
  }

  /** The chunks round `chunk` that `borders` names (trims.ts borderBit) and the map has. */
  private bordersOf(chunk: number, borders: number): Int32Array {
    const dims = this.world.dims, cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk), out: number[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dz === 0) || (borders & borderBit(dx, dz)) === 0 || cx + dx < 0 || cz + dz < 0 || cx + dx >= dims.chunksX || cz + dz >= dims.chunksZ) continue;
        out.push((cz + dz) * dims.chunksX + cx + dx);
      }
    }
    return out.length === 0 ? NO_CHUNKS : Int32Array.from(out);
  }

  /** The sum of `placed` of the tables of `chunks`. */
  private bordering(store: StructureStore, chunks: Int32Array): number {
    let sum = 0;
    for (let k = 0; k < chunks.length; k++) sum += store.chunks[chunks[k]!]?.placed ?? 0;
    return sum;
  }

  /** Writes instance `i` of `data` as the built piece in `slot` of `t`, of `kind`, coloured as `dye`: its regions, basis, state and fit, of which `yields` gives way. */
  private setPiece(data: Uint8Array, frames: FrameTable, i: number, t: ChunkTable, slot: number, kind: number, dye: number, yields: number): void {
    const yaw = t.yaw[slot]!, tw = t.twAt(slot), at = frames.slotOf(yaw);
    data.set(this.regionsOfKind.subarray(dye * 5, dye * 5 + 2), i * INSTANCE_BYTES + 15);
    writePiece(data, i, at < 0 ? plainYaw(yaw, tw) : pieceWord(at, yaw, tw), this.pieces.made[dye]!, (at < 0 ? 0 : PIECE_FRAMED) | this.pieces.stage(t, slot), this.pieces.fit[kind]! | yields);
  }

  /**
   * Finds which cells of a chunk are in view, if it is, and which wholly; and which of `casts` each casts into, its
   * shadow reaching as far as the chunk's can, which is at least as far as its own.
   */
  private zones(cam: Camera, b: ChunkBatch, seen: boolean, casts: number): void {
    const z = b.zone;
    this.wholeView = seen && cam.boxInside(b.minX - cam.x, b.minY - cam.y, b.minZ - cam.z, b.maxX - cam.x, b.maxY - cam.y, b.maxZ - cam.z);
    const stretch = (this.zoneStretch = casts !== 0 ? this.casting.stretch(b.minX - cam.x, b.minZ - cam.z, b.maxX - cam.x, b.maxZ - cam.z, b.maxY - cam.y) : 0);
    for (let c = 0, k = 0; c < b.cells; c++, k += 6) {
      const ax = z[k]! - cam.x, ay = z[k + 1]! - cam.y, az = z[k + 2]! - cam.z;
      const bx = z[k + 3]! - cam.x, by = z[k + 4]! - cam.y, bz = z[k + 5]! - cam.z;
      const held = ax <= bx;
      this.cellSeen[c] = !seen || !held ? 0 : this.wholeView || cam.boxInside(ax, ay, az, bx, by, bz) ? 2 : cam.boxVisible(ax, ay, az, bx, by, bz) ? 1 : 0;
      this.cellCasts[c] = casts !== 0 && held ? casts & this.casting.castsBy(ax, ay, az, bx, by, bz, stretch) : 0;
    }
  }

  /**
   * Draws a chunk `dist` metres off by its cells (`zones`), every draw in the depth ranges `passes`. A cell out of view is
   * not drawn, and one in view takes the level the nearest of its instances asks for, a piece's whole and a node's trunk.
   * Where a mesh's nearest and farthest instances ask for the same level, it is one draw while the chunk is wholly in view.
   * A node's level is chosen as if it were its kind's largest, and a cell holding nodes of two kinds of a mesh as if all
   * were the larger kind's largest. A node cell all past the tier's hand-over band is left to the far store, and one that
   * reaches into it fades out over it as the far store's draw fades in (hand.ts). A tree's crown is chosen at the
   * budget's squeeze, as if it stood farther off, and its leaves thinned by it; its trunk, and any other node, at the
   * squeeze's later scale for cover (budget.ts). Pieces give nothing to the squeeze.
   */
  private ranges(cam: Camera, b: ChunkBatch, id: number, dist: number, ox: number, oy: number, oz: number, passes: number, all: boolean): void {
    const sized = b.sized;
    const band = this.assets.tier.nodes.band;
    const from = sized ? band[0] * this.handScale : Infinity, to = sized ? band[1] * this.handScale : Infinity;
    const cells = b.cells;
    const spans = this.spans;
    const box = b.cellBox;
    const levels = b.cellLevel, crowns = b.cellCrown, thins = b.cellThin;
    const fx = Math.max(Math.abs(b.minX - cam.x), Math.abs(b.maxX - cam.x));
    const fy = Math.max(Math.abs(b.minY - cam.y), Math.abs(b.maxY - cam.y));
    const fz = Math.max(Math.abs(b.minZ - cam.z), Math.abs(b.maxZ - cam.z));
    const far = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const squeeze = sized ? this.budget.squeeze : 0;
    const scale = crownScale(squeeze), cover = coverScale(squeeze);
    const swapMs = sized ? (this.assets.tier.nodes.levels ?? 0) : 0;
    const rule = sized ? this.assets.tier.nodes.cover : undefined;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0) continue;
      const flags = sized ? DRAW_SIZED : this.pieces.flag[mesh]!;
      const at0 = q * (b.blocks + 1);
      const errors = this.assets.table.error[mesh]!;
      const reach = b.reach[q]!;
      const tree = sized && this.treeOf[mesh] === 1;
      // Trees whose cells change level by a swap (swapOf).
      const swaps = tree && swapMs > 0;
      const near = this.assets.choose(errors, (dist * cover) / reach, b.level[q]!);
      const crown = tree ? this.assets.choose(errors, (dist * scale) / reach, b.crown[q]!) : near;
      // A mesh whose instances here weigh less than a draw at the level the nearest asks for is drawn whole at it.
      const light = far <= from && !tree && b.ranges[r + 2]! * this.trisOfMesh[mesh]![near]! <= RUN_TRIANGLES;
      const alike = far <= from && near === this.assets.choose(errors, (far * cover) / reach, b.level[q]!) && (!tree || crown === this.assets.choose(errors, (far * scale) / reach, b.crown[q]!));
      // Trees that swap are drawn whole only while no cell of them is changing level, or would start to.
      // Trees behind other crowns (cover.ts) take levels by cell, as only some cells are.
      const behind = tree && rule ? this.coverCells(cam, b, id - NODE_BUFFERS, q, at0, mesh, rule) : false;
      const one = light || (alike && !behind && (!swaps || this.steady(b, q, at0, near, crown, swapMs)));
      // A range drawn whole but for cells behind other crowns keeps, in the rest, the levels it would be drawn whole at.
      const whole = alike && behind, wholeLevel = whole ? near : -1, wholeCrown = whole ? crown : -1;
      if (one) {
        if (swaps) this.shownAll(b, q, at0, near, crown);
        b.level[q] = near;
        b.crown[q] = crown;
        b.thin[q] = tree ? thinning(squeeze, dist, to, b.thin[q]!) : 0;
        levels.fill(near, q * cells, (q + 1) * cells);
        // Only a tree's cells read their crown and thinning back.
        if (tree) {
          crowns.fill(crown, q * cells, (q + 1) * cells);
          thins.fill(b.thin[q]!, q * cells, (q + 1) * cells);
        }
        let whole = this.wholeView;
        for (let c = 0; light && !whole && c < cells; c++) whole = this.firstOf(b, at0, c + 1) !== this.firstOf(b, at0, c) && this.cellShows(cam, b, q, c, mesh);
        if (whole) {
          this.assets.wantTextured(mesh, near, dist / reach);
          if (crown !== near) this.assets.wantTextured(mesh, crown, dist / reach);
          const d0 = this.packet.drawCount;
          for (let s = 0, n = this.spansOf(b, at0, 0, cells, all); s < n; s++) this.put.draw(mesh, near, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, passes, 0, 0, crown, leavesAt(b.thin[q]!));
          this.boxRun(d0, b, q, mesh, 0, cells, cam);
        }
        if (whole || light) continue;
      } else {
        b.level[q] = -1;
        b.crown[q] = -1;
        b.thin[q] = 255;
      }
      // Runs of neighbouring cells in view, each drawn at the finest level any of its cells asks for, and its crown and
      // leaves at the finest and fullest. A cell joins the run before it when they ask for the same levels, or for levels
      // one apart, and drawing the coarser at the finer, with any cells out of view between them, costs fewer triangles
      // than a draw does. So no node is drawn more than one level finer than its own cell asks. A run fades over the band
      // where a cell of it reaches into it, which keeps every pixel of a node short of it.
      const runs = this.runs;
      runs.length = 0;
      // The instance the last run may go on from, past cells out of view, which hold `gap`; -1 where it cannot. Runs are
      // made as if each cell's shell and interior lay together, and drawn as their shell's and, given `all`, interior's.
      let next = -1, gap = 0;
      for (let c = 0; c < cells; c++) {
        const v0 = this.firstOf(b, at0, c), v1 = this.firstOf(b, at0, c + 1);
        const n = v1 - v0;
        if (n === 0) continue;
        const qc = q * cells + c, k = qc * 6;
        const dx = Math.max(box[k]! - cam.x, cam.x - box[k + 3]!, 0);
        const dy = Math.max(box[k + 1]! - cam.y, cam.y - box[k + 4]!, 0);
        const dz = Math.max(box[k + 2]! - cam.z, cam.z - box[k + 5]!, 0);
        const d = one ? 0 : Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= to) {
          next = -1;
          continue;
        }
        if (!this.cellShows(cam, b, q, c, mesh)) {
          if (next === v0) {
            next = v1;
            gap += n;
          }
          continue;
        }
        let seen = dist / reach, hand = 0, level = near, crown = b.crown[q]!, thin = b.thin[q]!, swap = 0;
        if (!one) {
          if (sized) {
            const most = Math.hypot(Math.max(Math.abs(box[k]! - cam.x), Math.abs(box[k + 3]! - cam.x)), Math.max(Math.abs(box[k + 1]! - cam.y), Math.abs(box[k + 4]! - cam.y)), Math.max(Math.abs(box[k + 2]! - cam.z), Math.abs(box[k + 5]! - cam.z)));
            hand = most > from ? HAND_NEAR : 0;
          }
          seen = d / b.cellReach[qc]!;
          const m = tree && rule ? b.cellCover[qc]! : 1;
          if (m === 1 && wholeLevel >= 0) {
            level = wholeLevel;
            crown = wholeCrown;
          } else {
            level = this.assets.choose(errors, seen * cover * m, levels[qc]!);
            crown = tree ? this.assets.choose(errors, seen * scale * m, crowns[qc]!) : level;
            if (m > 1) {
              // Cover takes a cell to no coarser a level than its coarsest drawn with materials, past which only
              // distance does; and never finer than the range drawn whole would be.
              const top = this.texturedTop(mesh);
              level = Math.max(wholeLevel, Math.min(level, Math.max(top, this.assets.choose(errors, seen * cover, -1))));
              crown = Math.max(wholeCrown, Math.min(crown, Math.max(top, this.assets.choose(errors, seen * scale, -1))));
            }
          }
          levels[qc] = level;
          crowns[qc] = crown;
          thin = thins[qc] = tree ? thinning(squeeze, d, to, thins[qc]!) : 0;
          if (swaps) swap = this.swapOf(b, qc, level, crown, swapMs);
        }
        // A run is its first and end instance, its level and the coarsest a cell of it asked for, its nearest distance,
        // its hand-over, its crown's level and the coarsest a cell asked for, its least thinning, its first and end cell,
        // and, for a cell changing level, how far it has come and the cell, which is a run of its own.
        const last = runs.length - RUN;
        if (last >= 0 && next === v0 && swap === 0 && runs[last + 11] === 0) {
          const finer = Math.min(runs[last + 2]!, level), coarser = Math.max(runs[last + 3]!, level);
          const crownFiner = Math.min(runs[last + 6]!, crown), crownCoarser = Math.max(runs[last + 7]!, crown);
          const fuller = Math.min(runs[last + 8]!, thin);
          const had = runs[last + 1]! - runs[last]!;
          const cost = this.cost(mesh, finer, crownFiner, fuller);
          const more = had * (cost - this.cost(mesh, runs[last + 2]!, runs[last + 6]!, runs[last + 8]!)) + n * (cost - this.cost(mesh, level, crown, thin)) + gap * cost;
          // Cells of trees that swap join only at the same levels, so each is drawn at the levels it changes from.
          const joinable = swaps ? coarser === finer && crownCoarser === crownFiner : coarser - finer <= 1 && crownCoarser - crownFiner <= 1;
          if (joinable && more <= RUN_TRIANGLES) {
            runs[last + 1] = next = v1;
            runs[last + 2] = finer;
            runs[last + 3] = coarser;
            runs[last + 4] = Math.min(runs[last + 4]!, seen);
            runs[last + 5] = runs[last + 5]! | hand;
            runs[last + 6] = crownFiner;
            runs[last + 7] = crownCoarser;
            runs[last + 8] = fuller;
            runs[last + 10] = c + 1;
            gap = 0;
            continue;
          }
        }
        runs.push(v0, v1, level, level, seen, hand, crown, crown, thin, c, c + 1, swap, qc);
        next = v1;
        gap = 0;
      }
      for (let k = 0; k < runs.length; k += RUN) {
        this.assets.wantTextured(mesh, runs[k + 2]!, runs[k + 4]!);
        if (runs[k + 6] !== runs[k + 2]) this.assets.wantTextured(mesh, runs[k + 6]!, runs[k + 4]!);
        const d0 = this.packet.drawCount;
        // A cell changing level is drawn at its new levels keeping a share of the pattern, then at its old keeping the rest.
        // A flat draw's program has no swap: a change of level to or from one drawn flat is taken at once.
        const qc = runs[k + 12]!;
        const swap = runs[k + 11] !== 0 && this.put.texturedAt(mesh, runs[k + 6]!, flags) && this.put.texturedAt(mesh, b.cellWas[qc]!, flags) ? runs[k + 11]! : 0;
        this.put.swap = swap;
        for (let s = 0, n = this.spansOf(b, at0, runs[k + 9]!, runs[k + 10]!, all); s < n; s++) this.put.draw(mesh, runs[k + 2]!, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, passes, runs[k + 5]!, 0, runs[k + 6]!, leavesAt(runs[k + 8]!));
        if (swap !== 0) {
          this.put.swap = -swap;
          for (let s = 0, n = this.spansOf(b, at0, runs[k + 9]!, runs[k + 10]!, all); s < n; s++) this.put.draw(mesh, b.cellWasTrunk[qc]!, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, passes, runs[k + 5]!, 0, b.cellWas[qc]!, leavesAt(runs[k + 8]!));
        }
        this.put.swap = 0;
        this.boxRun(d0, b, q, mesh, runs[k + 9]!, runs[k + 10]!, cam);
      }
    }
  }

  /** Marks in `b.inView` the cells of a chunk's mesh with faces in view (`zones`), its corner (ox, oy, oz) from the camera; how many. */
  private meshCells(cam: Camera, b: ChunkBatch, ox: number, oy: number, oz: number): number {
    const m = b.mesh!, first = m.cellFirst, box = m.cellBox, kept = m.keptFirst, more = m.keptBox;
    if (m.slot < 0) return 0;
    let n = 0;
    for (let c = 0; c < b.cells; c++) {
      const k = c * 6, seen = this.cellSeen[c]!;
      let v = first[c + 1]! > first[c]! && (seen === 2 || (seen === 1 && cam.boxVisible(box[k]! + ox, box[k + 1]! + oy, box[k + 2]! + oz, box[k + 3]! + ox, box[k + 4]! + oy, box[k + 5]! + oz))) ? 1 : 0;
      if (m.open[c] === 1 && kept[c + 1]! > kept[c]! && (seen === 2 || (seen === 1 && cam.boxVisible(more[k]! + ox, more[k + 1]! + oy, more[k + 2]! + oz, more[k + 3]! + ox, more[k + 4]! + oy, more[k + 5]! + oz)))) v |= 2;
      b.inView[c] = v;
      n += v === 0 ? 0 : 1;
    }
    return n;
  }

  /**
   * Draws a chunk's mesh by its cells `meshCells` marked, less those the picture of what hides what hides, each run of
   * neighbouring cells one draw in the depth ranges `passes`, a run going on over cells left out between where they weigh
   * less than a draw.
   */
  private meshRuns(b: ChunkBatch, id: number, ox: number, oy: number, oz: number, passes: number): void {
    const m = b.mesh!;
    // The faces it shows, then where a cell is opened the faces it kept, which lie after them.
    for (let bit = 1; bit <= (m.opened > 0 ? 2 : 1); bit++) {
      const first = bit === 1 ? m.cellFirst : m.keptFirst, box = bit === 1 ? m.cellBox : m.keptBox;
      let from = -1, to = 0, gap = 0, c0 = 0, c1 = 0;
      for (let c = 0; c < b.cells; c++) {
        const n = first[c + 1]! - first[c]!;
        if (n === 0) continue;
        const k = c * 6;
        if ((b.inView[c]! & bit) === 0 || this.hiding.hidesOver(box[k]! + ox, box[k + 1]! + oy, box[k + 2]! + oz, box[k + 3]! + ox, box[k + 4]! + oy, box[k + 5]! + oz)) {
          gap += n;
          continue;
        }
        if (from >= 0 && gap * 2 > RUN_TRIANGLES) {
          this.drawMesh(b, id, from, to, ox, oy, oz, passes, box, c0, c1);
          from = -1;
        }
        if (from < 0) {
          from = first[c]!;
          c0 = c;
        }
        to = first[c + 1]!;
        c1 = c + 1;
        gap = 0;
      }
      if (from >= 0) this.drawMesh(b, id, from, to, ox, oy, oz, passes, box, c0, c1);
    }
  }

  /** Faces `from` up to `to` of a chunk's mesh, which lie in cells `c0` up to `c1` of the boxes `box`: one instance of its level, at the chunk's corner. */
  private drawMesh(b: ChunkBatch, id: number, from: number, to: number, ox: number, oy: number, oz: number, passes: number, box: Float32Array, c0: number, c1: number): void {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.boxCells(d, d + 1, box, c0, c1, ox, oy, oz);
    p.drawMesh[d] = this.near!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = b.mesh!.slot;
    p.drawBuffer[d] = id;
    p.drawFirst[d] = b.meshAt;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = DRAW_RANGED;
    p.drawFirstIndex[d] = from * 6;
    p.drawIndexCount[d] = (to - from) * 6;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (to - from) * 2 * copies;
  }

  /**
   * Puts a chunk's mesh in the caster list: into each cascade the runs of its cells that cast into it (`cellCasts`), a
   * cell between that does not going in when it weighs less than a draw. Runs alike but for their cascades are one caster.
   */
  private castMesh(b: ChunkBatch, id: number, ox: number, oy: number, oz: number): void {
    const m = b.mesh!;
    if (m.slot < 0) return;
    const runs = this.castRuns;
    runs.length = 0;
    // The faces it shows, then where a cell is opened the faces it kept.
    for (let part = 0; part < (m.opened > 0 ? 2 : 1); part++) {
      const first = part === 0 ? m.cellFirst : m.keptFirst;
      for (let i = 0; i <= MAX_CASCADES; i++) {
        const bit = 1 << i;
        let open = -1, gap = 0;
        for (let c = 0; c < b.cells; c++) {
          const n = first[c + 1]! - first[c]!;
          if (n === 0) continue;
          if ((this.cellCasts[c]! & bit) === 0 || (part === 1 && m.open[c] === 0)) {
            gap += n;
            continue;
          }
          if (open >= 0 && gap * 2 <= RUN_TRIANGLES) runs[open + 1] = first[c + 1]!;
          else {
            open = runs.length;
            runs.push(first[c]!, first[c + 1]!, bit);
          }
          gap = 0;
        }
      }
    }
    for (let k = 0; k < runs.length; k += 3) {
      if (runs[k + 2] === 0) continue;
      for (let j = k + 3; j < runs.length; j += 3) {
        if (runs[j] !== runs[k] || runs[j + 1] !== runs[k + 1]) continue;
        runs[k + 2]! |= runs[j + 2]!;
        runs[j + 2] = 0;
      }
      this.casting.caster(this.near!.mesh, 0, m.slot, id, b.meshAt, 1, ox, oy, oz, DRAW_RANGED, 0, runs[k]! * 6, (runs[k + 1]! - runs[k]!) * 6, runs[k + 2]!);
    }
  }

  /**
   * Puts the meshes of a chunk in the caster list, each at the level `Cascades.entries` gives a cascade, and into each
   * cascade only the cells that cast into it (`cellCasts`): a run of neighbouring cells a caster, with a cell between
   * that does not when it weighs less than a draw. Runs alike in every way but their cascades are one caster, and a mesh
   * whose instances here weigh less than a draw is cast whole.
   */
  private castChunk(b: ChunkBatch, id: number, ox: number, oy: number, oz: number, casts: number, all: boolean): void {
    const c = this.casting.cascades;
    const out = this.casting.pairs;
    const cells = b.cells;
    const sized = b.sized;
    const runs = this.castRuns;
    const spans = this.spans;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0 || this.groundFlags[mesh] !== 0) continue;
      const flags = sized ? DRAW_SIZED : this.pieces.flag[mesh]!;
      const at0 = q * (b.blocks + 1);
      // A node is drawn up to its kind's largest size, which scales its radius and errors.
      const scale = sized ? this.reachOfMesh[mesh]! : 1;
      let mask = casts & c.fits(this.radiusOfMesh[mesh]! * scale);
      if (mask === 0) continue;
      let some = 0, every = mask;
      for (let k = 0; k < cells; k++) {
        if (this.firstOf(b, at0, k + 1) === this.firstOf(b, at0, k)) continue;
        some |= this.cellCasts[k]!;
        every &= this.cellCasts[k]!;
      }
      mask &= some;
      if (mask === 0) continue;
      const tris = this.trisOfMesh[mesh]!;
      const n = c.entries(mask, this.assets.table.error[mesh]!, this.assets.held(mesh), out, scale, this.casting.leafy(mesh));
      for (let e = 0; e < n; e++) {
        const level = out[e * 2]!, bits = out[e * 2 + 1]!;
        if ((every & bits) === bits || b.ranges[r + 2]! * tris[level]! <= RUN_TRIANGLES) {
          for (let s = 0, m = this.spansOf(b, at0, 0, cells, all); s < m; s++) this.casting.cast(mesh, level, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, bits);
          continue;
        }
        // Each cascade's runs, five numbers each: first and end instance as if each cell's shell and interior lay
        // together, the cascades that take it, and its first and end cell.
        runs.length = 0;
        for (let i = 0; i <= MAX_CASCADES; i++) {
          const bit = 1 << i;
          if ((bits & bit) === 0) continue;
          let open = -1, gap = 0;
          for (let k = 0; k < cells; k++) {
            const v0 = this.firstOf(b, at0, k), v1 = this.firstOf(b, at0, k + 1);
            if (v1 === v0) continue;
            if ((this.cellCasts[k]! & bit) === 0) {
              gap += v1 - v0;
              continue;
            }
            if (open >= 0 && gap * tris[level]! <= RUN_TRIANGLES) {
              runs[open + 1] = v1;
              runs[open + 4] = k + 1;
            } else {
              open = runs.length;
              runs.push(v0, v1, bit, k, k + 1);
            }
            gap = 0;
          }
        }
        for (let k = 0; k < runs.length; k += CAST_RUN) {
          if (runs[k + 2] === 0) continue;
          for (let j = k + CAST_RUN; j < runs.length; j += CAST_RUN) {
            if (runs[j] !== runs[k] || runs[j + 1] !== runs[k + 1]) continue;
            runs[k + 2]! |= runs[j + 2]!;
            runs[j + 2] = 0;
          }
          for (let s = 0, m = this.spansOf(b, at0, runs[k + 3]!, runs[k + 4]!, all); s < m; s++) this.casting.cast(mesh, level, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, runs[k + 2]!);
        }
      }
    }
  }

  /**
   * Gives the draws from `from` on the box round range `q`'s instances in cells `c0` up to `c1` of a chunk: a piece's
   * whole, a node's to its mesh's reach sideways from its trunk at the largest size in the cell.
   */
  private boxRun(from: number, b: ChunkBatch, q: number, mesh: number, c0: number, c1: number, cam: Camera): void {
    const box = b.cellBox, cells = b.cells;
    // A range drawn whole is boxed as it was the last time.
    const whole = c0 === 0 && c1 === cells ? (b.whole ??= new Float64Array((b.ranges.length / 3) * 6).fill(NaN)) : null;
    if (whole && !Number.isNaN(whole[q * 6]!)) {
      const k = q * 6;
      if (whole[k]! <= whole[k + 3]!) this.put.boxRows(from, this.packet.drawCount, whole[k]! - cam.x, whole[k + 1]! - cam.y, whole[k + 2]! - cam.z, whole[k + 3]! - cam.x, whole[k + 4]! - cam.y, whole[k + 5]! - cam.z);
      return;
    }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let c = c0; c < c1; c++) {
      const k = (q * cells + c) * 6;
      if (box[k]! > box[k + 3]!) continue;
      const spread = b.sized ? this.assets.table.reach[mesh]! * b.cellReach[q * cells + c]! : 0;
      x0 = Math.min(x0, box[k]! - spread);
      y0 = Math.min(y0, box[k + 1]!);
      z0 = Math.min(z0, box[k + 2]! - spread);
      x1 = Math.max(x1, box[k + 3]! + spread);
      y1 = Math.max(y1, box[k + 4]!);
      z1 = Math.max(z1, box[k + 5]! + spread);
    }
    if (whole) {
      const k = q * 6;
      whole[k] = x0;
      whole[k + 1] = y0;
      whole[k + 2] = z0;
      whole[k + 3] = x1;
      whole[k + 4] = y1;
      whole[k + 5] = z1;
    }
    if (x0 <= x1) this.put.boxRows(from, this.packet.drawCount, x0 - cam.x, y0 - cam.y, z0 - cam.z, x1 - cam.x, y1 - cam.y, z1 - cam.z);
  }

  /** The first instance of cell `c` of the range whose blocks begin at `at0` in `cellFirst`, as if each cell's shell and interior lay together. */
  private firstOf(b: ChunkBatch, at0: number, c: number): number {
    const first = b.cellFirst;
    return b.blocks === b.cells ? first[at0 + c]! : first[at0 + c]! + first[at0 + b.cells + c]! - first[at0 + b.cells]!;
  }

  /**
   * Writes to `spans` the first instance and count of each run that draws cells `c0` up to `c1` of the range whose blocks
   * begin at `at0`: their shell, and given `all` their interior, one run where the two meet. Returns how many.
   */
  private spansOf(b: ChunkBatch, at0: number, c0: number, c1: number, all: boolean): number {
    const first = b.cellFirst, cells = b.cells, spans = this.spans;
    const s0 = first[at0 + c0]!, s1 = first[at0 + c1]!;
    let n = 0;
    if (s1 > s0) {
      spans[0] = s0;
      spans[1] = s1 - s0;
      n = 1;
    }
    if (!all || b.blocks === cells) return n;
    const i0 = first[at0 + cells + c0]!, i1 = first[at0 + cells + c1]!;
    if (i1 === i0) return n;
    if (n === 1 && s1 === i0) {
      spans[1] = i1 - s0;
      return 1;
    }
    spans[n * 2] = i0;
    spans[n * 2 + 1] = i1 - i0;
    return n + 1;
  }

  /** Whether range `q`'s instances in cell `c` of a chunk may be in view: a node's reach sideways from its trunk, a piece whole. */
  private cellShows(cam: Camera, b: ChunkBatch, q: number, c: number, mesh: number): boolean {
    const shown = this.cellSeen[c]!;
    if (shown !== 1) return shown === 2;
    const k = (q * b.cells + c) * 6, box = b.cellBox;
    const spread = b.sized ? this.assets.table.reach[mesh]! * b.cellReach[q * b.cells + c]! : 0;
    return cam.boxVisible(box[k]! - spread - cam.x, box[k + 1]! - cam.y, box[k + 2]! - spread - cam.z, box[k + 3]! + spread - cam.x, box[k + 4]! - cam.y, box[k + 5]! + spread - cam.z);
  }

  /** The triangles of one node of `mesh` drawn at `level`, its crown at `crown` and its leaves at a thinning (budget.ts). */
  private cost(mesh: number, level: number, crown: number, thin: number): number {
    const tris = this.trisOfMesh[mesh]!;
    if (crown === level && thin === 0) return tris[level] ?? 0;
    const trunk = this.trunkTris[mesh]![crown] ?? 0, leaf = this.leafTris[mesh]![crown] ?? 0;
    return (this.trunkTris[mesh]![level] ?? 0) + (tris[crown] ?? 0) - trunk - leaf * (1 - leavesAt(thin));
  }

  /**
   * Follows the pieces of a chunk that took another kind in place (a door opening or shutting, a fire lit) without laying
   * the chunk out again: each is moved into the same block of its new mesh's range, which `rebuild` set beside the old.
   * Counts the doors that now stand other than when the rooms were found, and those of them that open an inside room
   * onto outside air. False where a piece took a kind whose mesh has no range here.
   */
  private reform(b: ChunkBatch, t: ChunkTable, chunk: number, meshOf: Uint16Array, colorOf: Uint8Array): boolean {
    // Moved in place, the bends would no longer stand by their instances.
    if (b.bends) return false;
    const { slots, kinds, data, ranges, cellFirst } = b;
    const blocks = b.blocks;
    for (let moves = 0; ; moves++) {
      let i = 0;
      while (i < b.meshAt && t.kind[slots[i]!] === kinds[i]) i++;
      if (i === b.meshAt) break;
      const slot = slots[i]!, kind = t.kind[slot]!, was = kinds[i]!;
      // A trim is its piece's: one whose piece changed is laid out again. So is a piece that is, or was, a plate.
      if (moves === 16 || kind === 0 || meshOf[kind] === HIDDEN || (b.trimmed !== null && b.trimmed[i] === 1) || this.plates.plate[kind] !== PLATE_NONE || this.plates.plate[was] !== PLATE_NONE) return false;
      let q = 0, to = -1;
      while (ranges[q * 3 + 1]! + ranges[q * 3 + 2]! <= i) q++;
      for (let r = 0; r < ranges.length; r += 3) if (ranges[r] === meshOf[kind]) to = r / 3;
      if (to < 0) return false;
      let block = 0;
      while (cellFirst[q * (blocks + 1) + block + 1]! <= i) block++;
      let at = i;
      if (to !== q) {
        // Its place among the slots of the same block of the new range, the slots of the old range moving up or down one.
        let d = cellFirst[to * (blocks + 1) + block]!;
        while (d < cellFirst[to * (blocks + 1) + block + 1]! && slots[d]! < slot) d++;
        const bytes = data.slice(i * INSTANCE_BYTES, (i + 1) * INSTANCE_BYTES);
        const step = to > q ? -1 : 1;
        at = to > q ? d - 1 : d;
        if (to > q) {
          data.copyWithin(i * INSTANCE_BYTES, (i + 1) * INSTANCE_BYTES, d * INSTANCE_BYTES);
          slots.copyWithin(i, i + 1, d);
          kinds.copyWithin(i, i + 1, d);
          b.trimmed?.copyWithin(i, i + 1, d);
        } else {
          data.copyWithin((d + 1) * INSTANCE_BYTES, d * INSTANCE_BYTES, i * INSTANCE_BYTES);
          slots.copyWithin(d + 1, d, i);
          kinds.copyWithin(d + 1, d, i);
          b.trimmed?.copyWithin(d + 1, d, i);
        }
        if (b.trimmed) b.trimmed[at] = 0;
        data.set(bytes, at * INSTANCE_BYTES);
        slots[at] = slot;
        ranges[q * 3 + 2]!--;
        ranges[to * 3 + 2]!++;
        const lo = Math.min(q, to), hi = Math.max(q, to);
        for (let r = lo + 1; r <= hi; r++) ranges[r * 3 + 1]! += step;
        // Block starts between the two places move with the instances.
        for (let r = lo; r <= hi; r++) {
          for (let k = 0; k <= blocks; k++) {
            const moved = r === q ? (to > q ? k > block : k <= block) : r === to ? (to > q ? k <= block : k > block) : true;
            if (moved) cellFirst[r * (blocks + 1) + k]! += step;
          }
        }
        const mesh = meshOf[kind]!, rad = this.radiusOfMesh[mesh]!, cell = block % b.cells;
        const x = t.x[slot]!, y = t.y[slot]!, z = t.z[slot]!;
        grow(b.cellBox, (to * b.cells + cell) * 6, x - rad, y - rad, z - rad, x + rad, y + rad, z + rad);
        b.whole = null;
        grow(b.zone, cell * 6, x - rad, y - rad, z - rad, x + rad, y + rad, z + rad);
        b.minX = Math.min(b.minX, x - rad);
        b.minY = Math.min(b.minY, y - rad);
        b.minZ = Math.min(b.minZ, z - rad);
        b.maxX = Math.max(b.maxX, x + rad);
        b.maxY = Math.max(b.maxY, y + rad);
        b.maxZ = Math.max(b.maxZ, z + rad);
      }
      const dye = colorOf === this.colorOfKind ? this.dye(chunk, slot, kind, t.owner[slot]!) : kind;
      data[at * INSTANCE_BYTES + 14] = colorOf[dye]!;
      // A built piece keeps its basis and takes its new kind's fit; what yielded does so still where its class is the same.
      if (b.frames && this.pieces.flag[meshOf[kind]!] !== 0) {
        const fit = data[at * INSTANCE_BYTES + PIECE_FIT_AT]!, same = (fit ^ this.pieces.fit[kind]!) >> 4 === 0;
        data.set(this.regionsOfKind.subarray(dye * 5, dye * 5 + 2), at * INSTANCE_BYTES + 15);
        data[at * INSTANCE_BYTES + 17] = this.pieces.made[dye]!;
        data[at * INSTANCE_BYTES + PIECE_STATE_AT] = (data[at * INSTANCE_BYTES + PIECE_STATE_AT]! & PIECE_FRAMED) | this.pieces.stage(t, slot);
        data[at * INSTANCE_BYTES + PIECE_FIT_AT] = this.pieces.fit[kind]! | (same ? fit & FIT_YIELD : 0);
      } else if (colorOf === this.colorOfKind) data.set(this.regionsOfKind.subarray(dye * 5, dye * 5 + 5), at * INSTANCE_BYTES + 15);
      kinds[at] = kind;
      const open = this.finder.door(kind), opened = this.finder.door(was);
      if (open < 0 || opened < 0) continue;
      const doors = (b.doors ??= new Map());
      // A door the rooms were found without stood as it did before this, and opens nothing inside.
      if (!doors.has(slot)) doors.set(slot, opened === 1 ? DOOR_OPEN : 0);
      const flags = doors.get(slot)!, then = flags & DOOR_OPEN ? 1 : 0;
      b.differ += (open !== then ? 1 : 0) - (opened !== then ? 1 : 0);
      if ((flags & DOOR_FRONTIER) !== 0 && then === 0) b.exposing += open - opened;
      b.since = this.now;
    }
    b.shape = t.shape;
    b.uploaded = false;
    for (let i = 0; i < b.meshAt; i++) if (b.trimmed === null || b.trimmed[i] === 0) b.at[slots[i]!] = i;
    if (b.trimAt) this.trimsIn(b);
    return true;
  }

  /**
   * Whether every instance of `b` is still what its chunk's table `t` and its mesh ask for, the mesh drawing the slots
   * `drawn` marks: each standing piece not the mesh's has its instance of its kind where it stands, and nothing else has one.
   */
  private keeps(b: ChunkBatch, t: ChunkTable, meshOf: Uint16Array, drawn: Uint8Array, x0: number, z0: number): boolean {
    const at = b.at, kinds = b.kinds, places = b.places, data = b.data;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!, i = s < at.length ? at[s]! : -1;
      if (kind === 0 || meshOf[kind] === HIDDEN || (s < drawn.length && drawn[s] === 1)) {
        if (i >= 0) return false;
        continue;
      }
      if (i < 0 || kinds[i] !== kind || places[i * 5] !== Math.fround(t.x[s]! - x0) || places[i * 5 + 1] !== t.y[s] || places[i * 5 + 2] !== Math.fround(t.z[s]! - z0)) return false;
      // A built piece holds its basis and direction where another holds its yaw.
      const yaw = t.yaw[s]!, framed = b.frames !== null && this.pieces.flag[meshOf[kind]!] !== 0, slot = framed ? b.frames!.slotOf(yaw) : -1;
      if ((data[i * INSTANCE_BYTES + 12]! | (data[i * INSTANCE_BYTES + 13]! << 8)) !== (!framed ? yaw : slot < 0 ? plainYaw(yaw, t.twAt(s)) : pieceWord(slot, yaw, t.twAt(s)))) return false;
    }
    for (let s = t.high; s < at.length; s++) if (at[s]! >= 0) return false;
    return true;
  }

  /**
   * Sets what `b` draws and casts by to its instances' boxes and its mesh's cells, x and z from the chunk's corner
   * (x0, z0): the faces a cell shows, and where it is opened those it kept.
   */
  private meshIn(b: ChunkBatch, x0: number, z0: number): void {
    const m = b.mesh!, zone = b.zone, own = b.ownBox;
    zone.set(b.ownZone);
    b.minX = own[0]!;
    b.minY = own[1]!;
    b.minZ = own[2]!;
    b.maxX = own[3]!;
    b.maxY = own[4]!;
    b.maxZ = own[5]!;
    b.opens = m.opens;
    for (let part = 0; part < 2; part++) {
      const mb = part === 0 ? m.cellBox : m.keptBox;
      for (let c = 0; c < b.cells; c++) {
        const k = c * 6;
        if (mb[k]! > mb[k + 3]! || (part === 1 && m.open[c] === 0)) continue;
        grow(zone, k, mb[k]! + x0, mb[k + 1]!, mb[k + 2]! + z0, mb[k + 3]! + x0, mb[k + 4]!, mb[k + 5]! + z0);
        b.minX = Math.min(b.minX, mb[k]! + x0);
        b.minY = Math.min(b.minY, mb[k + 1]!);
        b.minZ = Math.min(b.minZ, mb[k + 2]! + z0);
        b.maxX = Math.max(b.maxX, mb[k + 3]! + x0);
        b.maxY = Math.max(b.maxY, mb[k + 4]!);
        b.maxZ = Math.max(b.maxZ, mb[k + 5]! + z0);
      }
    }
  }

  /**
   * The instances of a chunk of the store, each mesh's together, shell before interior (rooms.ts), then by cell
   * (ChunkBatch.cells), and in a cell by slot. A mesh whose kinds turn into another's in place (a door and its open form)
   * has that mesh's range beside it, empty or not, so the turn can be made in place (`reform`). Given the chunk's `mesh`,
   * the pieces `drawn` marks by slot are its and have no instance, and one instance at the chunk's corner draws it.
   */
  private rebuild(store: StructureStore, chunk: number, id: number, old: ChunkBatch | undefined, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null, mesh: NearMesh | null, drawn: Uint8Array | null): ChunkBatch {
    const world = this.world;
    const t = store.chunks[chunk]!;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const side = this.chunkCells;
    const cells = side * side;
    if (this.cellCounts.length < this.meshCount * cells * 2) {
      this.cellCounts = new Uint32Array(this.meshCount * cells * 2);
      this.cellCursor = new Uint32Array(this.meshCount * cells * 2);
    }
    if (this.cellSeen.length < cells) {
      this.cellSeen = new Uint8Array(cells);
      this.cellCasts = new Uint8Array(cells);
    }
    if (this.blockAt.length < t.high) this.blockAt = new Uint8Array(Math.max(t.high, this.blockAt.length * 2));
    const rooms = sizeOf === null ? (old?.rooms ?? new Rooms()) : null;
    const inside = rooms !== null && this.finder.find(t, x0, z0, rooms, store.frames);
    const blocks = inside ? cells * 2 : cells;
    const shell = rooms?.shell, blockAt = this.blockAt;
    const counts = this.cellCounts, used = this.used, usedMark = this.usedMark;
    const skip = mesh ? drawn! : null;
    let bent = 0;
    // The yaws its built pieces stand at, less their quarter turns, and how many at each: the most used get the table's slots.
    const turns = this.turns, turnCounts = this.turnCounts, flag = this.pieces.flag;
    const tek = !sizeOf && this.tekWalls.cells.has(chunk) ? this.tekWalls : null;
    turns.length = turnCounts.length = 0;
    let turnAt = -1;
    // A trim is drawn with its piece's cell, and not at all where its piece has no instance.
    const trimming = !sizeOf && this.trims.any && t.fr !== null;
    if (trimming) blockAt.fill(UNDRAWN, 0, t.high);
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      const choice = tek ? tek.mesh(chunk, s, meshOf[kind]!) : meshOf[kind]!;
      if (kind === 0 || choice === HIDDEN || (skip && skip[s] === 1) || (sizeOf && this.hiddenNodes.has(chunk * 65536 + s))) continue;
      if (!sizeOf) bent += this.bentKind[kind]!;
      const i = Math.min(side - 1, Math.max(0, Math.floor(((t.x[s]! - x0) * side) / CHUNK_SIZE)));
      const j = Math.min(side - 1, Math.max(0, Math.floor(((t.z[s]! - z0) * side) / CHUNK_SIZE)));
      const block = (inside && shell![s] === 0 ? cells : 0) + j * side + (j & 1 ? side - 1 - i : i);
      blockAt[s] = block;
      this.use(choice);
      counts[choice * blocks + block]!++;
      if (sizeOf || flag[choice] === 0) continue;
      const turn = t.yaw[s]! & TURN;
      if (turnAt < 0 || turns[turnAt] !== turn) {
        turnAt = turns.indexOf(turn);
        if (turnAt < 0) turnAt = turns.length < TURNS_MOST ? turns.push(turn) - 1 : -1;
        if (turnAt >= 0 && turnCounts.length < turns.length) turnCounts.push(0);
      }
      if (turnAt >= 0) turnCounts[turnAt]!++;
    }
    const frames = turns.length > 0 ? (old?.frames ?? new FrameTable()) : null;
    if (frames) {
      frames.clear();
      // The most used first; among equals, the first met.
      for (let k = 0; k < Math.min(turns.length, PIECE_FRAMES); k++) {
        let best = 0;
        for (let j = 1; j < turns.length; j++) if (turnCounts[j]! > turnCounts[best]!) best = j;
        frames.add(turns[best]!);
        turnCounts[best] = -1;
      }
      this.packet.frameTables.set(id, frames);
    } else if (old?.frames) this.packet.frameTables.delete(id);
    const trims = trimming ? this.trims.lay(store, chunk, t, x0, z0) : null;
    const trimFirst = trims && trims.count > 0 ? new Uint32Array(t.high + 1) : null;
    let trimCount = 0;
    for (let k = 0; trims && k < trims.count; k++) {
      const owner = trims.owner[k]!;
      if (blockAt[owner] === UNDRAWN) continue;
      this.use(trims.mesh[k]!);
      counts[trims.mesh[k]! * blocks + blockAt[owner]!]!++;
      trimFirst![owner + 1]!++;
      trimCount++;
    }
    for (let k = 0; trimFirst && k < t.high; k++) trimFirst[k + 1]! += trimFirst[k]!;
    // Only the meshes it has instances of, and those whose twin it has, can have a range: the rest are passed over in mesh order.
    for (let k = 0, n = used.length; !sizeOf && k < n; k++) for (const m of this.twinsOf.get(used[k]!) ?? []) this.use(m);
    used.sort((x, y) => x - y);
    const ranges: number[] = [];
    let total = 0;
    for (const m of used) {
      const from = total;
      for (let c = 0; c < blocks; c++) {
        this.cellCursor[m * blocks + c] = total;
        total += counts[m * blocks + c]!;
      }
      const twin = sizeOf ? -1 : this.twinOf[m]!;
      let paired = false;
      for (let c = 0; twin >= 0 && !paired && c < blocks; c++) paired = counts[twin * blocks + c]! > 0;
      if (total > from || paired) ranges.push(m, from, total - from);
    }
    for (const m of used) {
      counts.fill(0, m * blocks, (m + 1) * blocks);
      usedMark[m] = 0;
    }
    used.length = 0;
    const n = ranges.length / 3;
    const count = total + (mesh ? 1 : 0);
    const data = old && old.data.length === count * INSTANCE_BYTES ? old.data : new Uint8Array(count * INSTANCE_BYTES);
    const slots = old && old.slots.length === count ? old.slots : new Uint16Array(count);
    const kinds = old && old.kinds.length === count ? old.kinds : new Uint16Array(count);
    const w = new InstanceWriter(data);
    // A bent piece's bend is the map's for its slot while the slot holds the piece the map set there, of the map's statics
    // as they come, so a sector's are drawn once it has (city.ts CitySquare.map).
    const city = bent > 0 ? this.world.city?.statics : undefined, square = city?.squareOf(chunk), map = square?.map, from = square ? square.mapFrom(chunk) : 0, rows = square ? square.mapTo(chunk) - from : 0;
    const bends = bent > 0 ? new Int16Array(count * 8) : null, chunkBends = map?.bends.get(chunk);
    const bordered = trims && trims.borders !== 0 ? this.bordersOf(chunk, trims.borders) : NO_CHUNKS;
    const b: ChunkBatch = {
      bends,
      unbent: bent > 0 && !chunkBends,
      frames,
      seen: t.version,
      dirty: [],
      trimmed: trimCount > 0 ? new Uint8Array(count) : null,
      trimFirst: trimCount > 0 ? trimFirst : null,
      trimAt: trimCount > 0 ? new Uint32Array(trimCount) : null,
      borders: trims?.borders ?? 0,
      bordered,
      borderSum: this.bordering(store, bordered),
      plates: NO_PLATES,
      shape: t.shape,
      placed: t.placed,
      unknown: ranges.filter((m, k) => k % 3 === 0 && !this.assets.known(m)),
      sized: sizeOf !== null,
      data,
      slots,
      kinds,
      ranges,
      level: new Int8Array(n).fill(-1),
      cells,
      blocks,
      rooms,
      doors: inside && rooms.doors.size > 0 ? new Map(rooms.doors) : null,
      exposing: 0,
      differ: 0,
      since: this.now,
      cellFirst: new Uint32Array(n * (blocks + 1)),
      cellBox: new Float32Array(n * cells * 6),
      whole: null,
      zone: new Float32Array(cells * 6),
      cellLevel: new Int8Array(n * cells).fill(-1),
      crown: new Int8Array(n).fill(-1),
      thin: new Uint8Array(n).fill(255),
      cellCrown: new Int8Array(n * cells).fill(-1),
      cellThin: new Uint8Array(n * cells).fill(255),
      cellShown: new Int8Array(n * cells).fill(-1),
      cellShownTrunk: new Int8Array(n * cells).fill(-1),
      cellWas: new Int8Array(n * cells).fill(-1),
      cellWasTrunk: new Int8Array(n * cells).fill(-1),
      cellSince: new Float64Array(n * cells),
      cellSeenAt: new Float64Array(n * cells).fill(-Infinity),
      cellCount: new Float32Array(n * cells).fill(-1),
      cellCover: new Float32Array(n * cells).fill(1),
      cellEye: new Float32Array(n * cells * 3),
      cellMade: new Uint32Array(n * cells),
      reach: new Float32Array(n).fill(sizeOf ? 0 : 1),
      cellReach: new Float32Array(n * cells).fill(sizeOf ? 0 : 1),
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      uploaded: false,
      onCard: old?.onCard ?? 0,
      mesh,
      meshAt: total,
      inView: new Uint8Array(cells),
      at: new Int32Array(t.high).fill(-1),
      places: new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2),
      ownZone: new Float32Array(cells * 6),
      ownBox: new Float64Array(6),
      opens: 0,
      holed: -1,
      holedLast: 0,
    };
    emptyBoxes(b.cellBox);
    emptyBoxes(b.zone);
    for (let q = 0; q < n; q++) {
      const m = ranges[q * 3]!;
      for (let c = 0; c < blocks; c++) b.cellFirst[q * (blocks + 1) + c] = this.cellCursor[m * blocks + c]!;
      b.cellFirst[q * (blocks + 1) + blocks] = ranges[q * 3 + 1]! + ranges[q * 3 + 2]!;
      this.cursor[m] = q;
      if (!sizeOf && this.reachOfStatic[m] !== 1) { b.reach[q] = this.reachOfStatic[m]!; b.cellReach.fill(this.reachOfStatic[m]!, q * cells, (q + 1) * cells); }
    }
    const box = b.cellBox, zone = b.zone;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      const choice = tek ? tek.mesh(chunk, s, meshOf[kind]!) : meshOf[kind]!;
      if (kind === 0 || choice === HIDDEN || (skip && skip[s] === 1) || (sizeOf && this.hiddenNodes.has(chunk * 65536 + s))) continue;
      const mesh = choice;
      const x = t.x[s]!;
      const y = t.y[s]!;
      const z = t.z[s]!;
      const block = blockAt[s]!;
      const cell = block % cells;
      const i = this.cellCursor[mesh * blocks + block]!++;
      const dye = sizeOf ? kind : this.dye(chunk, s, kind, t.owner[s]!);
      w.set(i, x - x0, y, z - z0, t.yaw[s]!, colorOf[dye]!);
      if (sizeOf) w.size(i, sizeOf[kind]!);
      else if (frames && flag[mesh] !== 0) this.setPiece(data, frames, i, t, s, kind, dye, trims ? trims.yields[s]! : 0);
      else w.bytes.set(this.regionsOfKind.subarray(dye * 5, dye * 5 + 5), i * INSTANCE_BYTES + 15);
      tek?.write(data, i, chunk, s);
      slots[i] = s;
      kinds[i] = kind;
      b.at[s] = i;
      // A node is held by its mesh's own bounds at its size, which for a tall tree are far tighter sideways than a sphere;
      // a bent piece by half its chord and its walk.
      const k = sizeOf ? sizeOf[kind]! / SIZE_UNITS : 1;
      let r = sizeOf ? this.assets.table.reach[mesh]! * k : this.radiusOfMesh[mesh]!;
      if (bends && this.bentKind[kind] === 1) {
        const bend = map && s < rows && city!.bentKind[map.kind[from + s]!] === kind && map.x[from + s] === x && map.z[from + s] === z ? bendOf(chunkBends, s) : null;
        if (bend) bends.set(bend, i * 8);
        // Its walk in the low 14 bits of its seventh number, a sinking walk's flags over it (bends.ts packBend).
        r = bend ? bend[0]! / 1000 + Math.max(KERB_BACK, (bend[6]! & 0x3fff) / 1000) + 0.5 : r;
      }
      const lo = sizeOf ? y + this.assets.table.low[mesh]! * k : y - r;
      const hi = sizeOf ? y + this.assets.table.high[mesh]! * k : y + r;
      if (x - r < b.minX) b.minX = x - r;
      if (lo < b.minY) b.minY = lo;
      if (z - r < b.minZ) b.minZ = z - r;
      if (x + r > b.maxX) b.maxX = x + r;
      if (hi > b.maxY) b.maxY = hi;
      if (z + r > b.maxZ) b.maxZ = z + r;
      const c = cell * 6;
      zone[c] = Math.min(zone[c]!, x - r);
      zone[c + 1] = Math.min(zone[c + 1]!, lo);
      zone[c + 2] = Math.min(zone[c + 2]!, z - r);
      zone[c + 3] = Math.max(zone[c + 3]!, x + r);
      zone[c + 4] = Math.max(zone[c + 4]!, hi);
      zone[c + 5] = Math.max(zone[c + 5]!, z + r);
      // A cell's level is chosen by how far its nodes stand, at their trunks. Measured to their crowns, a live oak's 15 m
      // of limbs drew every oak of the cell as finely as one by the camera.
      const at = (this.cursor[mesh]! * cells + cell) * 6;
      const spread = sizeOf ? 0 : r;
      box[at] = Math.min(box[at]!, x - spread);
      box[at + 1] = Math.min(box[at + 1]!, lo);
      box[at + 2] = Math.min(box[at + 2]!, z - spread);
      box[at + 3] = Math.max(box[at + 3]!, x + spread);
      box[at + 4] = Math.max(box[at + 4]!, hi);
      box[at + 5] = Math.max(box[at + 5]!, z + spread);
      if (!sizeOf) continue;
      const most = this.mostOfForm[kind]! / SIZE_UNITS;
      b.reach[this.cursor[mesh]!] = Math.max(b.reach[this.cursor[mesh]!]!, most);
      b.cellReach[this.cursor[mesh]! * cells + cell] = Math.max(b.cellReach[this.cursor[mesh]! * cells + cell]!, most);
    }
    if (b.trimAt) this.layTrims(b, trims!, t, chunk, colorOf, x0, z0, blocks);
    if (frames) b.plates = this.plates.of(t, store.frames, b.at, data, inside ? shell! : null, this.platable);
    b.ownZone.set(zone);
    b.ownBox[0] = b.minX;
    b.ownBox[1] = b.minY;
    b.ownBox[2] = b.minZ;
    b.ownBox[3] = b.maxX;
    b.ownBox[4] = b.maxY;
    b.ownBox[5] = b.maxZ;
    if (mesh) {
      // The mesh's cells, x and z from the chunk's corner, in the chunk's.
      w.set(total, 0, 0, 0, 0, 0);
      slots[total] = MESH_SLOT;
      kinds[total] = 0;
      this.meshIn(b, x0, z0);
    }
    this.batches.set(id, b);
    return b;
  }

  /** Notes that the chunk being laid out may have a range of `mesh`. */
  private use(mesh: number): void {
    if (this.usedMark[mesh] === 1) return;
    this.usedMark[mesh] = 1;
    this.used.push(mesh);
  }

  /** Writes a chunk's trims after its pieces: each an instance of its mesh in its piece's block, coloured and staged as its piece, held in its cell's boxes. */
  private layTrims(b: ChunkBatch, trims: TrimLayout, t: ChunkTable, chunk: number, colorOf: Uint8Array, x0: number, z0: number, blocks: number): void {
    const w = new InstanceWriter(b.data), blockAt = this.blockAt, cells = b.cells, frames = b.frames!, data = b.data, regions = this.regionsOfKind;
    for (let k = 0; k < trims.count; k++) {
      const s = trims.owner[k]!, block = blockAt[s]!;
      if (block === UNDRAWN) continue;
      const mesh = trims.mesh[k]!, kind = t.kind[s]!, dye = this.dye(chunk, s, kind, t.owner[s]!);
      const i = this.cellCursor[mesh * blocks + block]!++;
      const x = trims.x[k]!, y = trims.y[k]!, z = trims.z[k]!, yaw = trims.yaw[k]!, tw = trims.tw[k]!, at = frames.slotOf(yaw);
      w.set(i, x - x0, y, z - z0, 0, colorOf[dye]!);
      data[i * INSTANCE_BYTES + 15] = regions[dye * 5]!;
      data[i * INSTANCE_BYTES + 16] = regions[dye * 5 + 1]!;
      writePiece(data, i, at < 0 ? plainYaw(yaw, tw) : pieceWord(at, yaw, tw), this.trims.finish[mesh]!, (at < 0 ? 0 : PIECE_FRAMED) | this.pieces.stage(t, s) | trims.ends[k]!, trims.cut[k]!);
      this.tekWalls.write(data, i, chunk, s, true);
      b.slots[i] = s;
      b.kinds[i] = kind;
      b.trimmed![i] = 1;
      const r = this.radiusOfMesh[mesh]!;
      grow(b.zone, (block % cells) * 6, x - r, y - r, z - r, x + r, y + r, z + r);
      grow(b.cellBox, (this.cursor[mesh]! * cells + (block % cells)) * 6, x - r, y - r, z - r, x + r, y + r, z + r);
      b.minX = Math.min(b.minX, x - r);
      b.minY = Math.min(b.minY, y - r);
      b.minZ = Math.min(b.minZ, z - r);
      b.maxX = Math.max(b.maxX, x + r);
      b.maxY = Math.max(b.maxY, y + r);
      b.maxZ = Math.max(b.maxZ, z + r);
    }
    this.trimsIn(b);
  }

  /** Lists a batch's trims' instances by their pieces' slots: as they are laid, and again after its instances moved (`reform`). */
  private trimsIn(b: ChunkBatch): void {
    const next = b.trimFirst!.slice(), at = b.trimAt!;
    for (let i = 0; i < b.meshAt; i++) if (b.trimmed![i] === 1) at[next[b.slots[i]!]!++] = i;
  }

  /**
   * How far cell `qc` of a range of trees has come in changing level, now that it is drawn with its trunk at `level`
   * and its crown at `crown`: 0 where it has not changed in the last `ms`, else from just over 0 to 1. A cell first drawn,
   * or drawn again after it was out of view, takes its level at once, as nothing of it was on screen to change.
   */
  private swapOf(b: ChunkBatch, qc: number, level: number, crown: number, ms: number): number {
    const now = this.now;
    if (b.cellShown[qc]! >= 0 && now - b.cellSeenAt[qc]! < SEEN_MS && (b.cellShown[qc] !== crown || b.cellShownTrunk[qc] !== level)) {
      b.cellWas[qc] = b.cellShown[qc]!;
      b.cellWasTrunk[qc] = b.cellShownTrunk[qc]!;
      b.cellSince[qc] = now;
    }
    b.cellShown[qc] = crown;
    b.cellShownTrunk[qc] = level;
    b.cellSeenAt[qc] = now;
    const t = (now - b.cellSince[qc]!) / ms;
    if (b.cellWas[qc]! < 0 || t >= 1) {
      b.cellWas[qc] = -1;
      return 0;
    }
    return Math.max(t, 1 / 32);
  }

  /**
   * Counts, for each cell of range `q` of trees in view and short of the hand-over's end, the crowns between the eye and
   * each of its trees' crowns (cover.ts), leaving out the tree's own, and takes the least: a cell is as hidden as its
   * most open tree. It sets how many times as far the cell's levels are chosen. A count is the eye's alone, so a cell is
   * counted again only once the eye has moved a metre or the crowns' grid has been made again (a tree felled or grown
   * back), and a new count is taken only a margin from the last, so a cell walked past does not change level back and
   * forth. True if any cell is drawn as if farther.
   */
  private coverCells(cam: Camera, b: ChunkBatch, chunk: number, q: number, at0: number, mesh: number, rule: CoverRule): boolean {
    const t = this.world.nodes?.chunks[chunk];
    if (!t) return false;
    const box = b.cellBox, to = this.assets.tier.nodes.band[1], table = this.assets.table;
    // At its modelled size: its crown's radius, its height, and its top; a crown starts a third of the way up (cover.ts).
    const side = table.side[mesh]! / Math.SQRT2, height = table.high[mesh]! - Math.max(0, table.low[mesh]!), top = table.high[mesh]!;
    // A count this far under the rule's start leaves the cell as it stands, so its trees need not all be counted.
    const open = rule.from - COVER_MARGIN;
    let any = false;
    for (let c = 0; c < b.cells; c++) {
      const v0 = this.firstOf(b, at0, c), v1 = this.firstOf(b, at0, c + 1);
      if (v1 === v0) continue;
      const qc = q * b.cells + c, k = qc * 6, e = qc * 3;
      const tx = Math.min(Math.max(cam.x, box[k]!), box[k + 3]!), tz = Math.min(Math.max(cam.z, box[k + 2]!), box[k + 5]!);
      if (Math.hypot(tx - cam.x, tz - cam.z) >= to || !this.cellShows(cam, b, q, c, mesh)) continue;
      const eye = b.cellEye;
      if (b.cellCount[qc]! < 0 || b.cellMade[qc] !== this.cover.made || Math.hypot(cam.x - eye[e]!, cam.y - eye[e + 1]!, cam.z - eye[e + 2]!) > COVER_MOVE) {
        let least = Infinity;
        for (let i = v0; i < v1 && least >= open; i++) {
          const s = b.slots[i]!, k = this.sizeOfForm[b.kinds[i]!]! / SIZE_UNITS;
          const middle = t.y[s]! + ((height / 3 + top) * k) / 2;
          least = Math.min(least, this.cover.count(cam.x, cam.y, cam.z, t.x[s]!, middle, t.z[s]!, side * k));
        }
        if (b.cellCount[qc]! < 0 || Math.abs(least - b.cellCount[qc]!) > COVER_MARGIN) b.cellCount[qc] = least;
        eye[e] = cam.x;
        eye[e + 1] = cam.y;
        eye[e + 2] = cam.z;
        b.cellMade[qc] = this.cover.made;
      }
      const m = coverDistance(b.cellCount[qc]!, rule);
      // A cell now less hidden chooses its levels afresh: the margin `choose` keeps would hold it at the coarser level
      // it took while hidden, which a cell come to from nearer would never be drawn at.
      if (m < b.cellCover[qc]!) b.cellLevel[qc] = b.cellCrown[qc] = -1;
      if ((b.cellCover[qc] = m) > 1) any = true;
    }
    return any;
  }

  /** A mesh's coarsest level drawn with materials: its last with sections, else its last. */
  private texturedTop(mesh: number): number {
    const sections = this.assets.table.sections[mesh]!;
    let level = sections.length - 1;
    while (level > 0 && sections[level]!.length === 0) level--;
    return level;
  }

  /** Whether no cell of range `q` that holds trees is changing level, nor would start to if drawn at `level` and `crown`. */
  private steady(b: ChunkBatch, q: number, at0: number, level: number, crown: number, ms: number): boolean {
    const now = this.now;
    for (let c = 0; c < b.cells; c++) {
      if (this.firstOf(b, at0, c + 1) === this.firstOf(b, at0, c)) continue;
      const qc = q * b.cells + c;
      if (b.cellWas[qc]! >= 0 && now - b.cellSince[qc]! < ms) return false;
      if (b.cellShown[qc]! >= 0 && now - b.cellSeenAt[qc]! < SEEN_MS && (b.cellShown[qc] !== crown || b.cellShownTrunk[qc] !== level)) return false;
    }
    return true;
  }

  /** Every cell of range `q` that holds trees, drawn whole at `level` and `crown`, as swapOf would mark it. */
  private shownAll(b: ChunkBatch, q: number, at0: number, level: number, crown: number): void {
    for (let c = 0; c < b.cells; c++) {
      if (this.firstOf(b, at0, c + 1) === this.firstOf(b, at0, c)) continue;
      const qc = q * b.cells + c;
      b.cellShown[qc] = crown;
      b.cellShownTrunk[qc] = level;
      b.cellSeenAt[qc] = this.now;
      b.cellWas[qc] = -1;
    }
  }
}

const NO_PLATES = new Float64Array(0);
const NO_CHUNKS = new Int32Array(0);

/** Sets boxes of six, least then most, to hold nothing. */

function emptyBoxes(box: Float32Array): void {
  for (let k = 0; k < box.length; k += 6) {
    box.fill(Infinity, k, k + 3);
    box.fill(-Infinity, k + 3, k + 6);
  }
}

/** Grows the box at `at` in `box` round another, laid out as `emptyBoxes` lays them. */
function grow(box: Float32Array, at: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  box[at] = Math.min(box[at]!, x0);
  box[at + 1] = Math.min(box[at + 1]!, y0);
  box[at + 2] = Math.min(box[at + 2]!, z0);
  box[at + 3] = Math.max(box[at + 3]!, x1);
  box[at + 4] = Math.max(box[at + 4]!, y1);
  box[at + 5] = Math.max(box[at + 5]!, z1);
}
