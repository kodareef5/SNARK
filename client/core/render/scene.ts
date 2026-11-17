import { remoteVehiclePose } from "../vehicle-view.ts";
// Structures are drawn per chunk and per mesh as instanced batches. A chunk's instance buffer is rebuilt only when a
// piece is added, removed or replaced, and uploaded once. Damage changes nothing that is drawn. Resource nodes are drawn
// the same way, each as the mesh of its form (shared/world/nodes.ts) at its size.

import { MAX_MOVING_REACH, type Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { Assets } from "../assets/assets.ts";
import type { AssetPort } from "../assets/port.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, type Pack } from "../../../shared/pack/pack.ts";
import { atlasBytes } from "../../../shared/pack/details.ts";
import { SKY_COLOR, WATER_COLOR } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import { SIZE_UNITS, nodeForms } from "../../../shared/world/nodes.ts";
import { LOOK_BYTES } from "../../../shared/anim/look.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { AnimState, CUE_DEAD, CUE_HELD, PITCH_STEPS, bodySeed } from "../../../shared/anim/pose.ts";
import { SEAT_FLOATS } from "../../../shared/anim/seat.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { sortF64, sortU32 } from "../../../shared/sort.ts";
import { Details } from "../details/details.ts";
import type { Falling } from "../rubble.ts";
import type { ShotEnd } from "../occasions.ts";
import type { Shots } from "../shots.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { Characters, seatScratch, showMaterials, type BodyShadows, type CastFn, type VehicleRenderPose, type VehicleSeatPose } from "./characters.ts";
import { Clouds } from "./clouds.ts";
import { Dropped } from "./dropped.ts";
import { FAR_BUFFER, FAR_MESH, FarBlocks, farColours, type FarSource } from "./far.ts";
import { FrameBudget, coverScale, crownScale, leavesAt, thinning } from "./budget.ts";
import { CITY_BUFFER, FarCity, type CitySource } from "./farcity.ts";
import { FarLandmarks, LANDMARK_BUFFER } from "./farlandmarks.ts";
import { FarNodes, familyOf, type FarNodeSource, type NodeLooks } from "./farnodes.ts";
import { HAND_NEAR } from "./hand.ts";
import { PROGRAM, drawProgram } from "./programs.ts";
import { LAKE_BUFFER, Lakes } from "./lakes.ts";
import { MESH_SLOT, NearCity, type NearMesh } from "./nearcity.ts";
import { DOOR_FRONTIER, DOOR_OPEN, RoomFinder, Rooms } from "./rooms.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_CUTOUT, DRAW_DETAILS, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_PULLED, DRAW_RANGED, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, DRAW_WATER, FRAME, FramePacket, InstanceWriter, MAX_BONES, MAX_CASCADES, MAX_CASTERS, MAX_DRAWS, MAX_TILES, MAX_WATER_TILES, PASS_FAR, PASS_NEAR, STEP_BODY, STEP_FAR, STEP_FAR_SEE, STEP_NEAR_SEE, TILE_CASTS, TILE_QUADS, TRANSIENT_BUFFER, quadIndexCount } from "./packet.ts";
import { SURFACE_MATERIAL } from "../../../content/surfaces.ts";
import { citySurface, WORLD_ASKED } from "./world-surfaces.ts";
import { UNDERWATER_DIM, UNDERWATER_VIEW, WATER_TILE } from "./shading.ts";
import { SKY_ASKED, SKY_MATERIAL, airFrame } from "./atmosphere.ts";
import { Cascades, MAX_REACH, reach } from "./shadow.ts";
import { shadowBytes } from "./shadowtext.ts";
import { SKY_SIZE, SKY_SLICES, flatLight, skyFrame, theSky, trueSun } from "./sky.ts";
import { TerrainLod, type CastTest } from "./terrain.ts";
import { WATER_ASKED, WATER_MATERIAL, seaFrame } from "./water.ts";
import type { MapLandmark, MapStatics } from "../../../shared/world/mapfile.ts";
import { landmarkFars } from "../../../shared/pack/far.ts";
import { PART_FLOATS, movingOf, poseMoving, type MotionSource, type Moving } from "./motion.ts";

export interface RenderWorld {
  /** Chooses the data-defined city surface palette; no terrain or geometry changes. */
  readonly mapId?: string;
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes, drawn as structures are. */
  readonly nodes?: StructureStore;
  /** Other bases past the near rows, drawn as blocks (far.ts). */
  readonly far?: FarSource;
  /** Trees, rocks and bushes past the near node field (farnodes.ts). */
  readonly farNodes?: FarNodeSource;
  /** The map's own buildings past the near rows (farcity.ts). It may come after the first frame, and is drawn from then on. */
  readonly city?: CitySource;
  /** The map's statics that move when used, where it has any (motion.ts). */
  readonly motion?: MotionSource;
  /** The map's landmarks, drawn far from their far meshes with the far city (farlandmarks.ts). */
  readonly landmarks?: readonly MapLandmark[];
}

/** The viewer's own body, which is not among the remote entities. */
export interface OwnBody {
  kind: number;
  /** World position of its origin. */
  x: number;
  y: number;
  z: number;
  /** Radians. */
  yaw: number;
  readonly state: AnimState;
  /** The moment to pose it at, in ticks. */
  tick: number;
  /** Drawn over everything, without its head. */
  firstPerson: boolean;
  /** Six colour regions. Zero leaves the species' own. Used when it has no look. */
  readonly colors: Uint8Array;
  look: Uint8Array | null;
  /** Laid out as EntityStore.gear. */
  readonly gear: Uint16Array;
  id: number;
  generation?: number;
  vehicle?: VehicleRenderPose;
  /** The seated local pilot remains a remote body; hide only its head in cockpit view. */
  cockpitActor?: number;
  attachment?: { host: number; slot: number; generation: number };
}

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

const MISSING_MESH = "core:missing";
const WATER_MESH = "core:water";
const BEAM_MESH = "core:beam";
/** Palette colour of the beam over a place of death. */
const BEAM_COLOR = 8;
/** A draw costs about what drawing this many more triangles does. Neighbouring cells share a draw when that saves more. */
const RUN_TRIANGLES = 4096;
/** What the card holds for the chunks' instance buffers is reserved under this name. */
const INSTANCES = "chunk instances";
const QUAD_INDICES = "quad indices";
/** Numbers a run of cells takes in `runs` (Scene.ranges), and in `castRuns` (Scene.castChunk). */
const RUN = 11;
const CAST_RUN = 5;
/** Milliseconds a chunk's doors stand other than its rooms were found with before they are found again. */
const SETTLE = 2000;
/** A node form with nothing to draw: what is left of a used-up node whose mesh no pack has. */
const HIDDEN = 0xffff;
/** The one run of a level drawn flat: no material, and all its indices. */
const FLAT: readonly number[] = [-1, 0, 0];
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
const NO_SHOTS: readonly ShotEnd[] = [];
/** What of a draw's flags a caster keeps: how its vertices are placed. */
const CAST_FLAGS = DRAW_SKINNED | DRAW_ONE_BONE | DRAW_SIZED;
/** A body in the viewer's own body's seat or arms (Scene.mountOf). */
const MOUNT_OWN = -2;

/** The index among the remote entities, which are sorted by id, of the one with this id, or -1. */
function indexOfId(remote: RemoteSample, id: number): number {
  let lo = 0;
  let hi = remote.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const at = remote.id[mid]!;
    if (at === id) return mid;
    if (at < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * A draw's place in the order in `range`, as stepOf will find it, two to an opaque step for its cut-outs (`cutAt`) and
 * the rest (`restAt`), and -1 where it is not drawn there.
 */
function placeOf(flags: number, range: number, cutAt: number, restAt: number): number {
  let s = (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - range : range;
  if ((flags & DRAW_NEAR) !== 0) s = range === PASS_NEAR ? STEP_BODY : -1;
  const at = s <= STEP_FAR && (flags & DRAW_CUTOUT) !== 0 ? cutAt : restAt;
  return s < 0 || at < 0 ? -1 : s <= STEP_FAR ? s * 2 + at : s + 2;
}

/** A draw's key for `sortRuns`, whole in a double: its program, its material, the low 16 bits of its level's slot, and its place as made. */
function stateKey(program: number, material: number, slot: number, made: number): number {
  return ((program * 65536 + material) * 65536 + (slot & 0xffff)) * MAX_DRAWS + made;
}

/**
 * Sorts keys `from` to `to`, turns every other run of one program and material round, counting on from `turns`, and
 * puts each one's place as made in `out`. The runs counted so far.
 */
function sortRuns(keys: Float64Array, from: number, to: number, turns: number, out: Uint16Array): number {
  sortF64(keys, from, to);
  for (let k = from; k < to; turns++) {
    const run = Math.floor(keys[k]! / (65536 * MAX_DRAWS));
    let end = k + 1;
    while (end < to && Math.floor(keys[end]! / (65536 * MAX_DRAWS)) === run) end++;
    for (let a = k, b = end - 1; turns % 2 === 1 && a < b; a++, b--) {
      const t = keys[a]!;
      keys[a] = keys[b]!;
      keys[b] = t;
    }
    k = end;
  }
  for (let k = from; k < to; k++) out[k] = keys[k]! - Math.floor(keys[k]! / MAX_DRAWS) * MAX_DRAWS;
  return turns;
}

/** A column of rows as its bits, an element of one, two or four bytes. */
type Bits = Uint8Array | Uint16Array | Uint32Array;

function bitsOf(a: Uint8Array | Int8Array | Uint16Array | Uint32Array | Float32Array): Bits {
  const n = a.length;
  return a.BYTES_PER_ELEMENT === 1 ? new Uint8Array(a.buffer, a.byteOffset, n) : a.BYTES_PER_ELEMENT === 2 ? new Uint16Array(a.buffer, a.byteOffset, n) : new Uint32Array(a.buffer, a.byteOffset, n);
}

/**
 * Puts the first `count` rows of each column (a row as many elements as its length is `capacity`) in the order `order`
 * names them from the first `rows` as they were, by way of `copy`. A loop for each width of element, since
 * JavaScriptCore is many times slower at one loop over arrays of several kinds.
 */
function reorder(columns: readonly Bits[], capacity: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let c = 0; c < columns.length; c++) {
    const a = columns[c]!;
    const w = a.length / capacity;
    if (a instanceof Uint8Array) reorder8(a, w, rows, count, order, copy);
    else if (a instanceof Uint16Array) reorder16(a, w, rows, count, order, copy);
    else reorder32(a, w, rows, count, order, copy);
  }
}

function reorder8(a: Uint8Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

function reorder16(a: Uint16Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

function reorder32(a: Uint32Array, w: number, rows: number, count: number, order: Uint16Array, copy: Float64Array): void {
  for (let k = 0; k < rows * w; k++) copy[k] = a[k]!;
  for (let k = 0; k < count; k++) for (let j = 0; j < w; j++) a[k * w + j] = copy[order[k]! * w + j]!;
}

/** Where an opaque step's cut-out draws go among its others (Scene.cutouts). */
export type Cutouts = "last" | "made" | "first" | "none";
export const CUTOUTS: readonly Cutouts[] = ["last", "made", "first", "none"];

/** A mesh stood somewhere by itself, with no entity or structure behind it. `level` is the level it was last drawn at, or -1. */
export interface Thing {
  mesh: number;
  x: number;
  y: number;
  z: number;
  level: number;
}

interface ChunkBatch {
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
}

export class Scene {
  readonly packet = new FramePacket();
  /** The registry where it has moving statics, else null, and those of the map once its statics have come. */
  private readonly motionReg: Registry | null;
  private movingFrom: MapStatics | null = null;
  private moving: Moving[] = [];
  readonly terrain: TerrainLod;
  /** Metres. Terrain beyond this is not drawn and fog reaches full strength here. */
  viewDistance = 4000;
  structureDistance = Infinity;
  /** Hour of the day, 0..24. It sets the sun's position and the brightness. */
  hour = 12;
  /** The height of the view in pixels. With the field of view, it says how large a level's error is on screen. */
  viewHeight = 720;
  /** The time of this frame, in milliseconds, for what the asset library waits on and how far the clouds have blown. */
  now = 0;
  /** On a lit tier, the dome is drawn as the table alone and nothing is hazed, as the rasterizer draws: for checks that hold a GPU to it. */
  plainSky = false;
  /** Loose meshes to draw: the stress scene's. */
  things: Thing[] = [];
  /**
   * Where an opaque step's cut-out draws go among its other draws: "last", after them all, so that a tiled GPU can
   * reject the cut-out pixels an opaque surface hides before it shades them; "made", as they were made; "first", before
   * them all, where it can reject none but those the ground hides; "none", left out. The device page sets them side by
   * side, and prices the cut-outs by the last two.
   */
  cutouts: Cutouts = "last";

  /** Pack mesh index per content index. */
  readonly meshOfKind: Uint16Array;
  /** Region 0 colour per content index. */
  readonly colorOfKind: Uint8Array;
  /** Per node form, its pack mesh or HIDDEN, its region 0 colour, and its size in SIZE_UNITS. */
  private readonly meshOfForm: Uint16Array;
  private readonly colorOfForm: Uint8Array;
  private readonly sizeOfForm: Uint8Array;
  /** Per node form, the largest size of its kind, in SIZE_UNITS. */
  private readonly mostOfForm: Uint8Array;
  /**
   * Per mesh, the largest size a node draws it at, as a multiple of its modelled size, or 1. Its shadows' levels and its far
   * textures are chosen for its distance divided by this, as if every node of it were that size.
   */
  private readonly reachOfMesh: Float32Array;
  /** 1 for kinds drawn with their pitch as well as their yaw. */
  private readonly pitched: Uint8Array;
  /** Per species. The size a newborn is drawn at, as a share of a grown one. */
  private readonly birthScale: Float32Array;
  /** Shots in the air, and the moment to draw them at, in ticks. The app sets both. */
  shots: Shots | null = null;
  shotTick = 0;
  /** Structures falling after a removal. The app sets it. */
  falling: Falling | null = null;
  /** What assets there are and which are loaded. */
  readonly assets: Assets;
  private readonly trisOfMesh: readonly (readonly number[])[];
  private readonly radiusOfMesh: Float32Array;
  /** Per material, the flags of a draw with it, and 1 for bark: a tree's trunk and limbs. */
  private readonly materialFlags: Uint8Array;
  private readonly barkOf: Uint8Array;
  /** What a frame may spend, what it has, and the squeeze crowns near are drawn at (budget.ts). */
  readonly budget = new FrameBudget();
  /** Per mesh, 1 for a standing tree's, whose crown gives to the budget and whose trunk does not. */
  private readonly treeOf: Uint8Array;
  /**
   * Per mesh, the flags a draw of it in palette colours carries besides its own: DRAW_PLAIN for a landmark's, whose flat
   * levels are its art's own colours and take neither the world finish nor the checker.
   */
  readonly flatFlags: Uint16Array;
  /** Per mesh and level, the triangles of its sections drawn with bark and of its cut-out ones. */
  private readonly trunkTris: number[][];
  private readonly leafTris: number[][];
  private readonly world: RenderWorld;
  private readonly batches = new Map<number, ChunkBatch>();
  /** Rigid species keep palette lighting; the static fallback finish belongs to world geometry. */
  private readonly speciesKind: Uint8Array;
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
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
  private readonly finder: RoomFinder;
  /** Per slot of a chunk being laid out, the block it goes in. */
  private blockAt = new Uint8Array(0);
  /** Per mesh, the mesh its kinds turn into in place (a door's open form, a fire lit), or -1. */
  private readonly twinOf: Int32Array;
  /** For the chunk being drawn, per cell: 2 where all of it is in view, 1 where some is, and the cascades it casts into; and whether all the chunk is in view. */
  private cellSeen = new Uint8Array(0);
  private cellCasts = new Uint8Array(0);
  private wholeView = false;
  /** Bytes of the chunks' instance buffers on the card, and as reserved under INSTANCES. */
  private instanceBytes = 0;
  private instancesReserved = 0;
  /** The most indices of quads the card has been sent levels for, 16-bit and 32-bit, as the shell holds them once for all. */
  private readonly quadIndices = [0, 0];
  private quadsReserved = 0;
  /** Per mesh, the level its falling pieces were last drawn at, or -1. */
  private readonly fallLevel: Int8Array;
  /** Per mesh counted in `counts`, the square of how far off the nearest instance is, and how far along the view they all lie. */
  private readonly nearest: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  /** The depth ranges of each draw made so far, a bit each by PASS_, and how many draws are in both. */
  private readonly passOf = new Uint8Array(MAX_DRAWS);
  private doubled = 0;
  /**
   * For putting the draws in order: the packet's columns of draws as their bits, room for one of them as made, each
   * draw's place in each range (its step, an opaque step's cut-outs a place after its other draws), where each place
   * begins, the draw and range each place in the order takes, and the keys an opaque place is sorted by (`stateKey`).
   */
  private readonly columns: Bits[];
  private readonly copy = new Float64Array(MAX_DRAWS * 3);
  private readonly steps = new Int8Array(MAX_DRAWS * 2);
  private readonly starts = new Int32Array(STEP_BODY + 4);
  private readonly source = new Uint16Array(MAX_DRAWS);
  private readonly sourcePass = new Uint8Array(MAX_DRAWS);
  private readonly keys = new Float64Array(MAX_DRAWS);
  /** The farthest any body's posed vertex gets from where its first bone puts its origin, short of its own mesh and offset. */
  private readonly bodySlack: number;
  private readonly transient: InstanceWriter;
  private readonly transientF32: Float32Array;
  private readonly transientU16: Uint16Array;
  private readonly waterMesh: number;
  /** The materials whose pictures the dome and the sea draw, or -1 where the pack has none. */
  private readonly skyMaterial: number;
  private readonly worldMaterial: number;
  private readonly waterMaterial: number;
  private readonly beamMesh: number;
  /** Places to mark with a beam, x, y, z each. The app sets them before build(). */
  readonly beams: number[] = [];
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  readonly characters: Characters;
  private readonly vehicleSeats: (VehicleSeatPose | undefined)[] = new Array(MAX_VIEW);
  /** What vehicleSeats points into, a pose a slot, and the own body's seat. */
  private readonly seatPoses: VehicleSeatPose[] = [];
  private readonly ownSeat = seatScratch();
  /** Scratch for a remote vehicle's pose, which Characters keeps none of. */
  private readonly vehiclePose: VehicleRenderPose = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0 };
  /** Small details: feathers knocked loose, dust thrown up. */
  readonly details: Details;
  /** Smoke and gas: each prop/cloud drawn as puffs over its reach, with the details (clouds.ts). */
  readonly clouds: Clouds;
  /** A bag of one stack, drawn as its item lying (dropped.ts). */
  private readonly dropped: Dropped;
  /** Null draws no body for the viewer. The app sets it before build(). */
  own: OwnBody | null = null;
  /** Index of an entity to leave out of the remote bodies, because `own` is that body as the viewer predicts it (a mount). -1 for none. */
  skip = -1;
  private readonly seatAt = new Float64Array(SEAT_FLOATS);
  /** By remote entity this frame: whether it rides in a seat, and the rows of that seat's turn (Characters.seat). */
  /** Per body this frame: 1 for one astride the seat that steers its creature, 2 for a passenger astride, else 0. */
  private readonly seated = new Uint8Array(MAX_VIEW);
  private readonly saddleSeats: Registry["saddleSeats"];
  private readonly seatTurn = new Float64Array(MAX_VIEW * 9);
  /**
   * The bodies in view this frame: which remote entity each is, its place (x, y, z, yaw), whether it gets only one bone,
   * the remote entity whose seat or arms it is in (-1 for none, MOUNT_OWN for the viewer's own body), and whether it
   * sits astride a saddle there. A body in a seat stands at its mount's place until the seat is found.
   */
  private readonly bodyFrom = new Uint16Array(MAX_VIEW);
  private readonly bodyAt = new Float64Array(MAX_VIEW * 4);
  private readonly bodyRigid = new Uint8Array(MAX_VIEW);
  private readonly bodyMount = new Int16Array(MAX_VIEW);
  private readonly bodyRides = new Uint8Array(MAX_VIEW);
  /** By remote entity: its number among the bodies in view, or -1. */
  private readonly viewed = new Int16Array(MAX_VIEW);
  /** Scratch for sorting them: survivors and the viewer's mount before the rest, then by distance, with the body's number in the low bits. */
  private readonly bodyOrder = new Uint32Array(MAX_VIEW);
  private readonly mountState = new AnimState();
  private readonly state = new AnimState();
  /** The characters' draws, given their depth ranges once their instances are written (bodyPasses). A one-bone draw's offset holds its stand-in's first bone. */
  private readonly drawBody = (mesh: number, lod: number, first: number, count: number, flags: number, layer: number, standIn: number): void => this.draw(mesh, lod, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, NEAR, 0, layer);
  /** Bases drawn as blocks where the near store does not hold their chunks whole, given a far source and the far mesh. */
  private readonly far: FarBlocks | null;
  /** Nodes past the near node field, given a source of them. */
  readonly nodesFar: FarNodes | null;
  /** The map's own buildings where the near store does not hold their chunks whole, given a source of them. */
  city: FarCity | null = null;
  /** With the far city, the near store's chunks' statics drawn flat as their form as a mesh a chunk (nearcity.ts). */
  readonly near: NearCity | null;
  /** Whether a chunk the near store holds whole draws such statics from its mesh; false draws them as instances, for pictures held to them. */
  nearMesh = true;
  /** The map's landmarks where the near store does not hold their pieces' chunks whole, with the far city. */
  landmarks: FarLandmarks | null = null;
  /** Per content index, 1 for a kind a landmark brings, which the far city leaves to the landmark's far mesh. */
  private readonly landmarkKinds: Uint8Array;
  private readonly farMesh: number;
  private readonly farBounds: { center: readonly number[]; half: readonly number[] } | undefined;
  /** Water on its own surfaces apart from the sea, and the sea round those whose beds go under it (lakes.ts), given the far mesh. */
  private readonly lakes: Lakes | null;
  /** Sun shadows: the cascades fitted this frame. */
  readonly cascades = new Cascades();
  /** Whether anything casts this frame, how far the true sun climbs (its unit vector's y), and frames fitted, for a cascade drawn every other frame. */
  private casting = false;
  private sunY = 1;
  private fitted = 0;
  /** The lowest a receiver in any cascade's sphere can be. A caster's shadow reaches as far as its top stands over this. */
  private floor = 0;
  /** Metres from the camera past which nothing casts into a cascade: as far as a cascade's cube reaches, and MAX_REACH on. */
  private castRange = 0;
  private readonly sunAt = new Float64Array(3);
  private readonly pairs = new Uint8Array(MAX_CASCADES * 2);
  /** Bodies out of view whose shadows may fall in it: which remote entity each is, and its place (x, y, z, yaw). */
  private readonly unseenFrom = new Uint16Array(MAX_VIEW);
  private readonly unseenAt = new Float64Array(MAX_VIEW * 4);
  private readonly unseenMount = new Int16Array(MAX_VIEW);
  /** The camera of the frame being built. */
  private camera: Camera | null = null;
  /**
   * The cascades something in a camera-relative box casts into: those it can shade, its shadow reaching as far along the
   * light as its top stands over the floor, while that shadow can fall in view.
   */
  private readonly castBox: CastTest = (minX, minY, minZ, maxX, maxY, maxZ) => this.castsBy(minX, minY, minZ, maxX, maxY, maxZ, -1);
  private readonly bodyShadows: BodyShadows = {
    body: (x, y, z, r) => {
      if (Math.hypot(x, y, z) - r > this.castRange) return 0;
      const stretch = this.stretch(x - r, z - r, x + r, z + r, y + r);
      return this.inView(x - r, y - r, z - r, x + r, y + r, z + r, stretch) ? this.cascades.sphereMask(x, y, z, r, stretch) : 0;
    },
    mesh: (mesh) => this.cascades.fits(this.radiusOfMesh[mesh]!),
  };
  /**
   * The characters' casters: in each cascade the coarsest held level within what its filter blurs, but none finer than
   * the held level nearest the one the view draws.
   */
  private readonly castBody: CastFn = (mesh, lod, first, count, flags, cascades, standIn) => {
    const view = this.assets.heldLevel(mesh, lod);
    if (view < 0) return;
    const out = this.pairs;
    const n = this.cascades.entries(cascades, this.assets.table.error[mesh]!, this.assets.held(mesh), out);
    let left = cascades;
    for (let e = 0; e < n; e++) {
      if (out[e * 2]! <= view) continue;
      this.cast(mesh, out[e * 2]!, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, out[e * 2 + 1]!);
      left &= ~out[e * 2 + 1]!;
    }
    if (left !== 0) this.cast(mesh, view, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, left);
  };
  /** Linear RGB of the open sky and of deep water. */
  private readonly skyColor = new Float32Array(3);
  private readonly deepColor = new Float32Array(3);
  /** The nearest and farthest depth the clouds' puffs reach this frame. */
  private readonly cloudRange = [0, 0];

  /** With `stream`, `pack` is the boot pack and other levels are asked of the port as they are wanted. */
  constructor(world: RenderWorld, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort; pages?: readonly Uint8Array[] }) {
    this.world = world;
    this.terrain = new TerrainLod(world.hf);
    this.assets = new Assets(reg, pack, stream?.manifest, stream?.port, stream?.pages);
    // The renderer holds the sky table on every tier.
    this.assets.residency.reserve("sky table", SKY_SIZE * SKY_SIZE * SKY_SLICES * 4);
    const { table, bind } = this.assets;
    this.motionReg = reg.motion.some((t) => t !== null) ? reg : null;
    const missing = Math.max(0, table.find(MISSING_MESH));
    this.meshOfKind = new Uint16Array(reg.defs.length).fill(missing);
    this.colorOfKind = new Uint8Array(reg.defs.length);
    this.speciesKind = Uint8Array.from(reg.defs, (d) => d?.type === "species" ? 1 : 0);
    this.pitched = Uint8Array.from(reg.defs, (d) => (d?.type === "prop" && d.pitched ? 1 : 0));
    this.birthScale = reg.birthScale;
    this.saddleSeats = reg.saddleSeats;
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!;
      if (!("mesh" in d)) continue;
      // A landmark's collision is drawn by its cells, and is nothing itself.
      if (d.type === "structure" && d.mesh === "none") {
        this.meshOfKind[k] = HIDDEN;
        continue;
      }
      // A body drawn in parts has no one mesh. The characters draw it.
      const mesh = bind.mesh(d.id, d.type === "species" ? "body" : "mesh");
      this.meshOfKind[k] = mesh >= 0 ? mesh : missing;
      this.colorOfKind[k] = d.color;
    }
    this.finder = new RoomFinder(reg, this.meshOfKind, (stream?.manifest ?? pack.header).meshes, table.error);
    this.twinOf = new Int32Array(table.count).fill(-1);
    for (let k = 1; k < reg.defs.length; k++) {
      const other = reg.opens[k] || reg.lights[k]!;
      if (other !== 0 && this.meshOfKind[k] !== this.meshOfKind[other]) this.twinOf[this.meshOfKind[k]!] = this.meshOfKind[other]!;
    }
    const forms = nodeForms(reg);
    this.meshOfForm = new Uint16Array(forms.count).fill(HIDDEN);
    this.colorOfForm = new Uint8Array(forms.count);
    this.sizeOfForm = forms.size;
    this.mostOfForm = forms.most;
    this.reachOfMesh = new Float32Array(table.count).fill(1);
    this.treeOf = new Uint8Array(table.count);
    for (let f = 1; f < forms.count; f++) {
      const kind = forms.kind[f]!;
      // A variant whose mesh no pack has yet stands as its kind's own mesh. What is left of a used-up node is not drawn.
      const own = forms.mesh[f] === "" ? -1 : table.find(forms.mesh[f]!);
      const mesh = own >= 0 ? own : forms.depleted[f] === 1 ? HIDDEN : this.meshOfKind[kind]!;
      this.meshOfForm[f] = mesh;
      this.colorOfForm[f] = this.colorOfKind[kind]!;
      if (mesh === HIDDEN) continue;
      this.reachOfMesh[mesh] = Math.max(this.reachOfMesh[mesh]!, forms.most[f]! / SIZE_UNITS);
      const def = reg.defs[kind];
      if (def?.type === "node" && familyOf(def) === 0 && forms.depleted[f] === 0) this.treeOf[mesh] = 1;
    }
    // A landmark's definitions and meshes are in its namespace, and its definitions are the map's own (withContent).
    const landmarks = new Set([...reg.own].map((k) => reg.defs[k]!.id.split(":")[0]));
    this.landmarkKinds = Uint8Array.from(reg.defs, (_, k) => (reg.own.has(k) ? 1 : 0));
    this.flatFlags = Uint16Array.from(this.assets.manifest.meshes, (m) => (landmarks.has(m.id.split(":")[0]) ? DRAW_PLAIN : 0));
    this.trisOfMesh = table.tris;
    this.radiusOfMesh = table.radius;
    this.materialFlags = new Uint8Array(table.materials.length);
    this.barkOf = new Uint8Array(table.materials.length);
    this.trunkTris = table.sections.map(() => []);
    this.leafTris = table.sections.map(() => []);
    this.learn(table.sections.map((_, mesh) => mesh));
    this.counts = new Uint32Array(table.count);
    this.cursor = new Uint32Array(table.count);
    this.fallLevel = new Int8Array(table.count).fill(-1);
    this.nearest = new Float32Array(table.count);
    this.from = new Float32Array(table.count);
    this.to = new Float32Array(table.count);
    this.transient = new InstanceWriter(this.packet.transient);
    const t = this.packet.transient;
    this.transientF32 = new Float32Array(t.buffer, t.byteOffset, t.byteLength >> 2);
    this.transientU16 = new Uint16Array(t.buffer, t.byteOffset, t.byteLength >> 1);
    this.characters = new Characters(reg, pack, this.assets);
    this.details = new Details(reg, pack.header.details, pack.palette, (kind) => this.characters.creature(kind));
    if (pack.header.details) this.assets.residency.reserve("details atlas", atlasBytes(pack.header.details.atlas.side));
    this.clouds = new Clouds(reg, pack.header.details, pack.palette);
    this.dropped = new Dropped(reg, bind);
    const p = this.packet as unknown as Record<string, unknown>;
    this.columns = Object.keys(p).filter((k) => k.startsWith("draw") && k !== "drawPass" && ArrayBuffer.isView(p[k])).map((k) => bitsOf(p[k] as Uint8Array));
    let reach = 0;
    for (let k = 1; k < reg.defs.length; k++) if (this.characters.has(k)) reach = Math.max(reach, this.characters.reach(k));
    this.bodySlack = reach * 2;

    const far = (this.farMesh = table.find(FAR_MESH));
    this.farBounds = far >= 0 ? this.assets.manifest.meshes[far] : undefined;
    // A build works the colours out from every piece. Without them, they are worked out from the pieces the pack holds.
    const shown = (k: number): number => (this.meshOfKind[k] === missing || this.meshOfKind[k] === HIDDEN ? -1 : (pack.meshIndex.get(this.assets.manifest.meshes[this.meshOfKind[k]!]!.id) ?? -1));
    const colours = this.assets.manifest.farColours;
    this.far = world.far && this.farBounds ? new FarBlocks(world.far, world.dims, world.hf, far, this.farBounds, colours ? Uint8Array.from(colours) : farColours(reg, pack, shown)) : null;
    const flat = (k: number): boolean => this.meshOfKind[k] !== missing && this.meshOfKind[k] !== HIDDEN && table.sections[this.meshOfKind[k]!]!.every((runs) => runs.length === 0);
    this.near = this.farBounds ? new NearCity(reg, far, this.landmarkKinds, flat) : null;
    this.startCity();
    const last = (mesh: number): ReturnType<NodeLooks["last"]> => this.assets.residency.heldGeometry(mesh, table.tris[mesh]!.length - 1);
    const looks: NodeLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, colorOfForm: this.colorOfForm, side: table.side, low: table.low, high: table.high, tris: table.tris, last, known: (mesh) => this.assets.known(mesh) };
    this.nodesFar = world.farNodes ? new FarNodes(world.farNodes, world.far?.cells ?? null, world.dims, reg, looks) : null;
    this.lakes = world.hf.water && far >= 0 ? new Lakes(world.hf, world.hf.water, far) : null;
    this.waterMesh = table.find(WATER_MESH);
    this.beamMesh = table.find(BEAM_MESH);
    this.worldMaterial = table.materials.findIndex((m) => m.id === SURFACE_MATERIAL);
    citySurface(this.packet.surfaceCity, world.mapId ?? "default");
    this.skyMaterial = table.materials.findIndex((m) => m.id === SKY_MATERIAL);
    this.waterMaterial = table.materials.findIndex((m) => m.id === WATER_MATERIAL);
    for (let k = 0; k < 3; k++) {
      this.skyColor[k] = pack.palette[SKY_COLOR * 4 + k]! / 255;
      this.deepColor[k] = (pack.palette[WATER_COLOR * 4 + k]! / 255) * UNDERWATER_DIM;
    }
  }

  /** Works out what the scene keeps of the materials, and of each mesh given, whose row is here. */
  private learn(meshes: readonly number[]): void {
    const table = this.assets.table;
    table.materials.forEach((m, k) => {
      this.materialFlags[k] = DRAW_TEXTURED | ((m.flags & MATERIAL_TWO_SIDED) !== 0 ? DRAW_TWO_SIDED : 0) | ((m.flags & MATERIAL_CUTOUT) !== 0 ? DRAW_CUTOUT : 0);
      this.barkOf[k] = m.id.endsWith("bark") ? 1 : 0;
    });
    const part = (mesh: number, keep: (material: number) => boolean): number[] => table.sections[mesh]!.map((runs) => runs.reduce((n, _, k) => (k % 3 === 0 && keep(runs[k]!) ? n + runs[k + 2]! / 3 : n), 0));
    for (const mesh of meshes) {
      this.trunkTris[mesh] = part(mesh, (m) => this.barkOf[m] === 1);
      this.leafTris[mesh] = part(mesh, (m) => (this.materialFlags[m]! & DRAW_CUTOUT) !== 0);
    }
    this.nodesFar?.learn();
  }

  /** Counts on the card the indices the shell holds for this frame's levels of quads and every one before. */
  private quadsOnCard(): void {
    const ups = this.packet.assetUploads, most = this.quadIndices;
    for (let k = 0; k < ups.length; k++) {
      const u = ups[k]!;
      if (u.quads) most[u.indexBytes === 2 ? 0 : 1] = Math.max(most[u.indexBytes === 2 ? 0 : 1]!, u.indexCount);
    }
    const bytes = (most[0]! > 0 ? quadIndexCount(most[0]!, 2) * 2 : 0) + (most[1]! > 0 ? quadIndexCount(most[1]!, 4) * 4 : 0);
    if (bytes !== this.quadsReserved) this.assets.residency.reserve(QUAD_INDICES, (this.quadsReserved = bytes));
  }

  /** Call after a lost graphics context. Every buffer and every level is uploaded again. */
  resetUploads(): void {
    for (const b of this.batches.values()) {
      b.uploaded = false;
      b.onCard = 0;
    }
    this.instanceBytes = 0;
    this.quadIndices[0] = this.quadIndices[1] = 0;
    this.assets.residency.reset();
    this.terrain.reset();
    this.far?.reset();
    this.nodesFar?.reset();
    this.city?.reset();
    this.near?.reset();
    this.landmarks?.reset();
    this.lakes?.reset();
    this.cascades.clear();
  }

  build(cam: Camera, remote: RemoteSample | null): FramePacket {
    const p = this.packet;
    p.beginFrame();
    this.doubled = 0;
    cam.split = p.split = this.assets.tier.split;
    cam.update();
    this.assets.begin(this.now, this.viewHeight, cam.fovY);
    if (this.assets.residency.learned.length > 0) this.learn(this.assets.residency.learned);
    this.budget.begin(this.assets.tier);
    p.tier = this.assets.tier;
    p.lit = p.tier.lit;
    p.viewProj.set(cam.split > 0 ? cam.ranges[PASS_NEAR] : cam.viewProj);
    p.farViewProj.set(cam.ranges[PASS_FAR]);
    p.nearViewProj.set(cam.nearViewProj);
    p.camX = cam.x;
    p.camY = cam.y;
    p.camZ = cam.z;
    // The sun rises at six, peaks at noon and sets at eighteen. At night the light comes from a fixed moon and is dimmer.
    p.light = flatLight(this.hour, p.sun);
    [p.frame[FRAME.handFrom], p.frame[FRAME.handTo]] = this.assets.tier.nodes.band;
    // Lit tiers take their light from the sky table, and the air and the dome's pictures from atmosphere.ts.
    if (p.tier.lit) {
      if (this.worldMaterial >= 0) this.assets.residency.material(this.worldMaterial, WORLD_ASKED, 1);
      skyFrame(this.hour, theSky(), p.frame);
      airFrame(p.frame, theSky(), this.hour, cam.x, cam.z, this.now / 1000, this.viewDistance, this.plainSky ? 0 : p.tier.clouds, this.plainSky);
      if (!this.plainSky && this.skyMaterial >= 0) this.assets.residency.material(this.skyMaterial, SKY_ASKED.pixels, SKY_ASKED.distance);
    }
    this.fit(cam);

    // Under water, the sea's or a lake's where the camera is, the view is short and the fog is the water's colour, dimmed.
    // Out of it the air is measured from the sea, or from 0 over a map with none.
    const sea = this.world.hf.seaLevel;
    const water = this.world.hf.waterAt(cam.x, cam.z);
    const under = cam.y < water;
    p.frame[FRAME.eyeHeight] = under ? cam.y - water : Math.max(cam.y - (sea > -Infinity ? sea : 0), 0);
    if (under) {
      for (let k = 0; k < 3; k++) p.sky[k] = this.deepColor[k]! * p.light;
      p.fogStart = 0;
      p.fogEnd = UNDERWATER_VIEW;
    } else {
      for (let k = 0; k < 3; k++) p.sky[k] = this.skyColor[k]! * p.light;
      p.fogStart = this.viewDistance * 0.45;
      p.fogEnd = this.viewDistance;
    }

    this.terrain.select(cam, p, this.viewDistance, this.assets.residency, this.casting ? this.castBox : undefined);
    // The selection stops at a full list, so a full list has left tiles out.
    if (p.tileCount === MAX_TILES) p.dropped++;
    if (this.city ?? this.startCity()) this.farCity(cam);
    if (this.far) this.farBlocks(cam);
    if (this.nodesFar) this.farNodes(cam);
    if (this.casting) {
      if (!this.terrain.casters(cam, p, this.viewDistance, this.castBox)) p.casterDropped++;
      this.groundCast();
    }
    // Before the statics, so a full frame leaves out pieces of a chunk rather than a yacht's sails.
    if (this.world.motion && this.motionReg) this.showMotion(cam, this.world.motion);
    this.structures(cam, this.world.structs, 0, this.meshOfKind, this.colorOfKind, null);
    if (this.world.nodes) this.structures(cam, this.world.nodes, NODE_BUFFERS, this.meshOfForm, this.colorOfForm, this.sizeOfForm);
    if (this.instanceBytes !== this.instancesReserved) this.assets.residency.reserve(INSTANCES, (this.instancesReserved = this.instanceBytes));
    if (remote) this.entities(cam, remote);
    this.bodies(cam, remote);
    if (this.beams.length > 0 && this.beamMesh >= 0) this.markBeams(cam);
    if (this.falling && this.falling.count > 0) this.showFalling(cam, this.falling);
    if (this.ghost.kind !== 0) this.showGhost(cam);
    if (this.things.length > 0) this.showThings(cam);
    // Water seen from above on a lit tier is drawn with its waves and its depth (water.ts), from the frame block's sea part.
    const lit = p.lit && !this.plainSky && !under;
    let waves = sea > -Infinity && this.waterMesh >= 0 && this.water(cam, sea, lit);
    if (this.lakes) waves = this.showLakes(cam, lit) || waves;
    if (waves) {
      seaFrame(p.frame, this.world.hf, this.terrain.size, p.groundWindow, cam.x, cam.z, this.now / 1000, cam.y);
      if (this.waterMaterial >= 0) this.assets.residency.material(this.waterMaterial, WATER_ASKED.pixels, WATER_ASKED.distance);
    }
    this.showDetails(cam, remote);
    this.quadsOnCard();
    // The viewer's own body goes over everything else, water included.
    this.characters.flush(p, this.transient, true, this.drawBody, this.casting ? this.castBody : null);
    this.order();
    // The frame's count, from which the next frame's crowns near take their squeeze.
    this.budget.end(this.now, p.triangles, p.drawCount);
    this.assets.end(p, this.now);
    return p;
  }

  /**
   * Fits the shadow cascades to the view, for the sun where it is (sky.ts `trueSun`) while it casts at all, and finds
   * the floor: the ground under each cascade's sphere, but no lower than the sphere reaches.
   */
  private fit(cam: Camera): void {
    const p = this.packet;
    const c = this.cascades;
    const setup = p.tier.shadows;
    this.assets.residency.reserve("shadow maps", p.lit ? shadowBytes(setup) : 0);
    this.casting = false;
    this.characters.shadows = null;
    if (!p.lit || setup.cascades <= 0 || p.frame[FRAME.casting]! <= 0) {
      c.clear();
      return;
    }
    trueSun(p.frame, this.sunAt);
    this.camera = cam;
    c.fit(cam, this.sunAt[0]!, this.sunAt[1]!, this.sunAt[2]!, setup, this.fitted++);
    p.cascadeCount = c.count;
    p.cascadesDrawn = c.drawn;
    c.write(p.cascades, p.spheres);
    if (c.drawn === 0) return;
    let floor = Infinity;
    let range = 0;
    for (let i = 0; i < c.count; i++) {
      const x = c.sphere[i * 4]!, y = c.sphere[i * 4 + 1]!, z = c.sphere[i * 4 + 2]!, r = c.sphere[i * 4 + 3]!;
      floor = Math.min(floor, Math.max(cam.y + y - r, this.terrain.lowest(cam.x + x - r, cam.z + z - r, cam.x + x + r, cam.z + z + r)));
      // The cube is snapped less than a texel from the sphere's middle.
      range = Math.max(range, Math.hypot(x, y, z) + (c.half[i]! + c.texel[i]!) * Math.sqrt(3));
    }
    this.floor = floor;
    this.castRange = range + MAX_REACH;
    this.sunY = this.sunAt[1]!;
    this.casting = true;
    this.characters.shadows = this.bodyShadows;
  }

  /**
   * How far along the light the shadow of a camera-relative box whose top is `top` can reach: as far as the top stands
   * over the floor, or over the lowest ground where a shadow that long could fall, whichever is the shorter.
   */
  private stretch(minX: number, minZ: number, maxX: number, maxZ: number, top: number): number {
    const p = this.packet;
    const most = reach(top + p.camY - this.floor, this.sunY);
    const sx = -this.sunAt[0]! * most, sz = -this.sunAt[2]! * most;
    const low = this.terrain.lowest(p.camX + Math.min(minX, minX + sx), p.camZ + Math.min(minZ, minZ + sz), p.camX + Math.max(maxX, maxX + sx), p.camZ + Math.max(maxZ, maxZ + sz));
    return low > this.floor ? reach(top + p.camY - low, this.sunY) : most;
  }

  /** As `castBox`, the box's shadow reaching `stretch` metres along the light, or as far as `stretch()` finds where that is under 0. */
  private castsBy(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, stretch: number): number {
    const dx = Math.max(minX, -maxX, 0), dy = Math.max(minY, -maxY, 0), dz = Math.max(minZ, -maxZ, 0);
    if (dx * dx + dy * dy + dz * dz > this.castRange * this.castRange) return 0;
    if (stretch < 0) stretch = this.stretch(minX, minZ, maxX, maxZ, maxY);
    return this.inView(minX, minY, minZ, maxX, maxY, maxZ, stretch) ? this.cascades.mask(minX, minY, minZ, maxX, maxY, maxZ, Infinity, stretch) : 0;
  }

  /** Whether the shadow of a camera-relative box, swept `stretch` metres away from the sun, can fall in view. */
  private inView(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, stretch: number): boolean {
    const sx = -this.sunAt[0]! * stretch, sy = -this.sunAt[1]! * stretch, sz = -this.sunAt[2]! * stretch;
    return this.camera!.boxVisible(Math.min(minX, minX + sx), Math.min(minY, minY + sy), Math.min(minZ, minZ + sz), Math.max(maxX, maxX + sx), Math.max(maxY, maxY + sy), Math.max(maxZ, maxZ + sz));
  }

  /**
   * Puts the meshes of a chunk in the caster list, each at the level `Cascades.entries` gives a cascade, and into each
   * cascade only the cells that cast into it (`cellCasts`): a run of neighbouring cells a caster, with a cell between
   * that does not when it weighs less than a draw. Runs alike in every way but their cascades are one caster, and a mesh
   * whose instances here weigh less than a draw is cast whole.
   */
  private castChunk(b: ChunkBatch, id: number, ox: number, oy: number, oz: number, casts: number, all: boolean): void {
    const c = this.cascades;
    const out = this.pairs;
    const cells = b.cells;
    const sized = b.sized;
    const flags = sized ? DRAW_SIZED : 0;
    const runs = this.castRuns;
    const spans = this.spans;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0) continue;
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
      const n = c.entries(mask, this.assets.table.error[mesh]!, this.assets.held(mesh), out, scale);
      for (let e = 0; e < n; e++) {
        const level = out[e * 2]!, bits = out[e * 2 + 1]!;
        if ((every & bits) === bits || b.ranges[r + 2]! * tris[level]! <= RUN_TRIANGLES) {
          for (let s = 0, m = this.spansOf(b, at0, 0, cells, all); s < m; s++) this.cast(mesh, level, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, bits);
          continue;
        }
        // Each cascade's runs, five numbers each: first and end instance as if each cell's shell and interior lay
        // together, the cascades that take it, and its first and end cell.
        runs.length = 0;
        for (let i = 0; i < c.count; i++) {
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
          for (let s = 0, m = this.spansOf(b, at0, runs[k + 3]!, runs[k + 4]!, all); s < m; s++) this.cast(mesh, level, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, runs[k + 2]!);
        }
      }
    }
  }

  /**
   * Puts `count` instances of a held level into the caster list for `cascades`. A level with cut-out or two-sided
   * sections is a caster for each section, cut out where the card holds what that reads; any other is its whole level.
   */
  private cast(mesh: number, level: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, cascades: number): void {
    if (level < 0) return;
    const runs = this.assets.table.sections[mesh]![level] ?? FLAT;
    let split = false;
    for (let k = 0; k < runs.length; k += 3) split ||= runs[k]! >= 0 && (this.materialFlags[runs[k]!]! & (DRAW_CUTOUT | DRAW_TWO_SIDED)) !== 0;
    const cutouts = split && this.assets.heldCutouts(mesh, level);
    this.assets.keep(mesh, level, cutouts);
    const slot = this.assets.residency.slot(mesh, level);
    flags &= CAST_FLAGS;
    if (!split) return this.caster(mesh, level, slot, buffer, first, count, ox, oy, oz, flags, 0, 0, 0, cascades);
    for (let k = 0; k < runs.length; k += 3) {
      const m = this.materialFlags[runs[k]!]! & (cutouts ? DRAW_TEXTURED | DRAW_TWO_SIDED | DRAW_CUTOUT : DRAW_TEXTURED | DRAW_TWO_SIDED);
      this.caster(mesh, level, slot, buffer, first, count, ox, oy, oz, flags | m, runs[k]!, runs[k + 1]!, runs[k + 2]!, cascades);
    }
  }

  private caster(mesh: number, level: number, slot: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, material: number, firstIndex: number, indexCount: number, cascades: number): void {
    const p = this.packet;
    const n = p.casterCount;
    if (n === MAX_CASTERS) {
      p.casterDropped++;
      return;
    }
    p.casterMesh[n] = mesh;
    p.casterLod[n] = level;
    p.casterSlot[n] = slot;
    p.casterBuffer[n] = buffer;
    p.casterFirst[n] = first;
    p.casterInstances[n] = count;
    p.casterOffset[n * 3] = ox;
    p.casterOffset[n * 3 + 1] = oy;
    p.casterOffset[n * 3 + 2] = oz;
    p.casterFlags[n] = flags;
    p.casterMaterial[n] = material;
    p.casterFirstIndex[n] = firstIndex;
    p.casterIndexCount[n] = indexCount;
    p.casterCascades[n] = cascades;
    p.casterCount = n + 1;
    const maps = (cascades & 1) + ((cascades >> 1) & 1) + ((cascades >> 2) & 1) + ((cascades >> 3) & 1);
    p.castDraws += maps;
    p.castTriangles += ((flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? indexCount / 3 : this.trisOfMesh[mesh]![level]!) * count * maps;
  }

  /** Counts what the ground casts: its tiles into each cascade, a draw for each pair of tiles it reads from a cascade casts from. */
  private groundCast(): void {
    const p = this.packet;
    let draws = 0;
    for (let t = 0; t < p.tileCount; t++) {
      const casts = (p.tilePass[t]! / TILE_CASTS) & 15;
      if (casts === 0) continue;
      p.castTriangles += ((casts & 1) + ((casts >> 1) & 1) + ((casts >> 2) & 1) + (casts >> 3)) * TILE_QUADS * TILE_QUADS * 2;
      draws |= casts << (p.tileSource[t * 4 + 3]! * 4);
    }
    for (; draws !== 0; draws &= draws - 1) p.castDraws++;
  }

  /**
   * Puts the draws in the order of the steps they are drawn in (packet.ts), each in the ranges `passOf` gives it, so a
   * draw in both is listed twice, and an opaque step's cut-out draws where `cutouts` says, each part of it by what its
   * draws bind (`byState`) unless they are to stay as made. With one range they are all in the near range, and stay as
   * they were made unless a cut-out is to move: drawn flat, as low poly draws, sorting would save less than it costs.
   * A see-through draw made ahead of an opaque one still goes after it, the rest staying as made.
   */
  private order(): void {
    const p = this.packet;
    const n = p.drawCount;
    const one = p.split <= 0;
    const made = this.cutouts === "made";
    // A cut-out's place and the rest's within the step, -1 for left out.
    const cutAt = this.cutouts === "last" ? 1 : this.cutouts === "none" ? -1 : 0;
    const restAt = this.cutouts === "first" ? 1 : 0;
    let sort = !made;
    if (one) {
      p.drawPass.fill(PASS_NEAR, 0, n);
      p.skyAt = n;
      let cut = false, late = false;
      for (let d = 0, last = 0; d < n && !cut; d++) {
        const flags = p.drawFlags[d]!, place = placeOf(flags, PASS_NEAR, cutAt, restAt);
        cut = cutAt !== restAt && (flags & (DRAW_CUTOUT | DRAW_BLEND | DRAW_NEAR)) === DRAW_CUTOUT;
        late ||= place < last;
        if (place > last) last = place;
      }
      if (!cut && !late) return;
      sort &&= cut;
    }
    // Each draw's place in each range, -1 where it is not drawn in that range.
    const steps = this.steps;
    const starts = this.starts.fill(0);
    for (let d = 0; d < n; d++) {
      const flags = p.drawFlags[d]!;
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        const drawn = one ? range === PASS_NEAR : (this.passOf[d]! & (1 << range)) !== 0;
        const place = drawn ? placeOf(flags, range, cutAt, restAt) : -1;
        steps[d * 2 + range] = place;
        if (place >= 0) starts[place + 1]!++;
      }
    }
    for (let s = 1; s < starts.length; s++) starts[s]! += starts[s - 1]!;
    const total = starts[STEP_BODY + 3]!;
    p.skyAt = one ? total : starts[STEP_FAR_SEE + 2]!;
    const source = this.source;
    const pass = this.sourcePass;
    let moved = total !== n;
    for (let d = 0; d < n; d++) {
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        const s = steps[d * 2 + range]!;
        if (s < 0) continue;
        const at = starts[s]!++;
        source[at] = d;
        pass[at] = range;
        moved ||= at !== d;
      }
    }
    // The opaque steps' places, near then far, two a step.
    if (sort) for (let s = 0, turns = 0; s < STEP_FAR * 2 + 2; s++) turns = this.byState(s === 0 ? 0 : starts[s - 1]!, starts[s]!, s % 2 === 0 ? 0 : turns);
    if (moved || sort) reorder(this.columns, MAX_DRAWS, n, total, source, this.copy);
    for (let k = 0; k < total; k++) p.drawPass[k] = pass[k]!;
    p.drawCount = total;
  }

  /**
   * Sorts places `from` to `to` of the order by what their draws bind, so that each changes as little as it can of what
   * the one before it bound: by program, material and level, and then as made, which keeps a level's instances in the
   * same order in each of its runs. Every other run of a program and material, counted on from `turns`, is turned
   * round, so that a level ends a run on the instances it begins the next with. The runs counted so far.
   */
  private byState(from: number, to: number, turns: number): number {
    const p = this.packet;
    const keys = this.keys, source = this.source;
    const materials = this.assets.table.materials;
    for (let k = from; k < to; k++) {
      const d = source[k]!;
      const flags = p.drawFlags[d]!;
      const program = (flags & DRAW_DETAILS) !== 0 ? PROGRAM.details : drawProgram(p, d, materials[p.drawMaterial[d]!]);
      keys[k] = stateKey(program, (flags & DRAW_TEXTURED) !== 0 ? p.drawMaterial[d]! : 0, p.drawSlot[d]!, d);
    }
    return sortRuns(keys, from, to, turns, source);
  }

  /** Small details (client/core/details/): the cut-out ones with the near opaque, the see-through ones after the sea. */
  private showDetails(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const cut = this.details.frame(p, cam, remote, this.characters.fallen, this.shots?.ends ?? NO_SHOTS, this.own, this.world.hf, this.assets.tier, this.now, this.world, this.characters.rotorBlur.count);
    const particles = p.detailCount;
    this.characters.rotorBlur.write(p);
    const rotorPasses = this.characters.rotorBlur.passes(cam);
    // The clouds' puffs after them, in the depth ranges they reach, as they may be seen from far off (clouds.ts).
    const seen = p.detailCount;
    const solid = this.clouds.write(p, cam, remote, this.cloudRange);
    const far = seen < p.detailCount ? cam.passesOf(this.cloudRange[0]!, this.cloudRange[1]!) : NEAR;
    this.drawDetails(0, cut, DRAW_CUTOUT, NEAR);
    this.drawDetails(cut, particles - cut, DRAW_BLEND, NEAR);
    this.drawDetails(particles, seen - particles, DRAW_BLEND, rotorPasses);
    this.drawDetails(seen, solid, DRAW_CUTOUT, far);
    this.drawDetails(seen + solid, p.detailCount - seen - solid, DRAW_BLEND, far);
  }

  /** `count` of the packet's details from `first`, one draw in the depth ranges `passes`. */
  private drawDetails(first: number, count: number, flags: number, passes: number): void {
    const p = this.packet;
    const d = p.drawCount;
    if (count === 0) return;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = 0;
    p.drawLod[d] = 0;
    p.drawSlot[d] = 0;
    p.drawBuffer[d] = 0;
    p.drawFirst[d] = first;
    p.drawInstances[d] = count;
    p.drawFlags[d] = DRAW_DETAILS | flags;
    p.drawOffset.fill(0, d * 3, d * 3 + 3);
    this.passOf[d] = passes;
    this.doubled += copies - 1;
    p.drawCount = d + 1;
    p.triangles += count * 2 * copies;
  }

  /** Bases as blocks to the tier's reach, faded over the last of it, in place of chunks the near store does not hold whole. */
  private farBlocks(cam: Camera): void {
    const p = this.packet;
    const tier = this.assets.tier;
    p.frame[FRAME.fade] = tier.fade;
    this.far!.update(p, this.assets.residency, cam.x, cam.z, tier.reach.bases);
    this.far!.draw(cam, tier.reach.bases, tier.fade, this.drawFar);
  }

  /** A tile of far blocks: one instance of its own level, gone at the tier's reach where it reaches into the fade (far.ts). */
  private readonly drawFar = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number, fade: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = this.far!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = FAR_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = 0;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawFade[d] = fade;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += triangles * copies;
  };

  /** The far city once the world has the map's statics, which the far blocks then leave their cells to. */
  private startCity(): FarCity | null {
    const source = this.world.city;
    if (!source || !this.farBounds) return null;
    this.city = new FarCity(source, this.world.dims, this.world.hf, this.farMesh, this.farBounds, this.landmarkKinds);
    this.far?.leaveTo(this.city);
    const placed = this.world.landmarks ?? [];
    if (placed.length > 0) this.landmarks = new FarLandmarks(source, this.world.dims, placed, landmarkFars(this.assets.manifest));
    return this.city;
  }

  /** The map's buildings to the tier's reach, in place of chunks the near store does not hold whole, faded over the last of it. */
  private farCity(cam: Camera): void {
    const p = this.packet;
    const tier = this.assets.tier;
    p.frame[FRAME.fade] = tier.fade;
    this.city!.update(p, this.assets.residency, cam, tier.city.levels, tier.reach.city, tier.fade, this.world.structs, this.world.far?.cells ?? null);
    this.city!.draw(cam, tier.reach.city, this.drawCity);
    this.landmarks?.draw(p, cam, this.assets, tier.reach.city, tier.fade, this.drawLandmark);
  }

  /** A run of a far city tile's chunks at one of its levels: one instance, gone or come at `fade` (farcity.ts). */
  private readonly drawCity = (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = this.city!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = CITY_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = DRAW_RANGED;
    p.drawFirstIndex[d] = firstIndex;
    p.drawIndexCount[d] = indexCount;
    p.drawFade[d] = fade;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** A run of a landmark's far mesh: its one instance, gone at `fade` (farlandmarks.ts), in its own colours as its flat draws are. */
  private readonly drawLandmark = (mesh: number, level: number, instance: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = mesh;
    p.drawLod[d] = level;
    p.drawSlot[d] = this.assets.residency.slot(mesh, level);
    p.drawBuffer[d] = LANDMARK_BUFFER;
    p.drawFirst[d] = instance;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = DRAW_RANGED | this.flatFlags[mesh]!;
    p.drawFirstIndex[d] = firstIndex;
    p.drawIndexCount[d] = indexCount;
    p.drawFade[d] = fade;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** Trees, rocks and bushes past the near node field, each kind to its reach at its last level, faded over the last of it. */
  private farNodes(cam: Camera): void {
    const p = this.packet;
    p.frame[FRAME.fade] = this.assets.tier.fade;
    this.nodesFar!.update(p, this.assets.residency, cam.x, cam.z, this.assets.tier);
    this.nodesFar!.draw(cam, this.drawFarNodes);
  }

  /** A run of far nodes of every mesh, each its mesh's row of the atlas (farnodes.ts), gone at its row's reach. */
  private readonly drawFarNodes = (slot: number, mesh: number, indices: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, hand: number, reach: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = buffer;
    p.drawFirst[d] = first;
    p.drawInstances[d] = count;
    p.drawFlags[d] = DRAW_PULLED;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawFade[d] = reach;
    p.drawHand[d] = hand;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += (indices / 3) * count * copies;
  };

  private bodies(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const ch = this.characters;
    const st = this.state;
    const own = this.own;
    ch.begin(p);
    let unseen = 0;
    if (remote) {
      // Loose things and the dead first: they keep their bones, and the living share what is left.
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        if (this.pitched[kind] === 0) continue;
        const x = remote.x[i]! - cam.x;
        const y = remote.y[i]! - cam.y;
        const z = remote.z[i]! - cam.z;
        if (!cam.boxVisible(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1)) continue;
        st.unpack(remote.anim[i]!);
        const pitch = (st.pitch / PITCH_STEPS) * (Math.PI / 2);
        const level = Math.cos(pitch);
        ch.loose(p, this.meshOfKind[kind]!, x, y, z, Math.sin(remote.yaw[i]!) * level, Math.sin(pitch), Math.cos(remote.yaw[i]!) * level, 1);
      }
      ch.corpses(p, cam, remote, this.world);
    }
    // Then the shots in the air.
    this.shots?.draw(ch, p, cam, this.shotTick);
    if (remote) {
      this.vehicleSeats.fill(undefined, 0, remote.count);
      this.seated.fill(0, 0, remote.count);
      this.viewed.fill(-1, 0, remote.count);
      // First which bodies are in view and where, then which of them the frame has the bones to pose, then where those in
      // a seat or in arms are, as their mounts are drawn.
      const from = this.bodyFrom;
      const place = this.bodyAt;
      let n = 0;
      let wanted = 0;
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        // A dead creature's body is drawn where it lies, by ch.corpses.
        if (!ch.has(kind) || remote.id[i] === this.skip || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
        let x = remote.x[i]! - cam.x;
        let y = remote.y[i]! - cam.y;
        let z = remote.z[i]! - cam.z;
        let r = ch.reach(kind);
        // A rider is drawn on its mount's seat, and a creature held in someone's arms in them, so it is culled about its mount.
        const mount = this.mountOf(remote, i);
        if (mount !== -1) {
          x = (mount === MOUNT_OWN ? own!.x : remote.x[mount]!) - cam.x;
          y = (mount === MOUNT_OWN ? own!.y : remote.y[mount]!) - cam.y;
          z = (mount === MOUNT_OWN ? own!.z : remote.z[mount]!) - cam.z;
          r += ch.reach(mount === MOUNT_OWN ? own!.kind : remote.kind[mount]!);
        }
        if (!cam.boxVisible(x - r, y - 0.3, z - r, x + r, y + (r > 2.2 ? r : 2.2), z + r)) {
          // Out of view, a body whose shadow may fall in it is posed after those in view, while bones are left.
          if (this.casting && this.bodyShadows.body(x, y, z, r) !== 0) {
            this.unseenFrom[unseen] = i;
            this.unseenMount[unseen] = mount;
            this.unseenAt[unseen * 4] = x;
            this.unseenAt[unseen * 4 + 1] = y;
            this.unseenAt[unseen * 4 + 2] = z;
            this.unseenAt[unseen * 4 + 3] = remote.yaw[i]!;
            unseen++;
          }
          continue;
        }
        from[n] = i;
        place[n * 4] = x;
        place[n * 4 + 1] = y;
        place[n * 4 + 2] = z;
        place[n * 4 + 3] = remote.yaw[i]!;
        this.bodyMount[n] = mount;
        this.bodyRides[n] = mount !== -1 && (remote.cue[i]! & CUE_HELD) === 0 && !ch.vehicle(mount === MOUNT_OWN ? own!.kind : remote.kind[mount]!) ? 1 : 0;
        this.viewed[i] = n;
        wanted += ch.bones(kind);
        n++;
      }
      // The tier's bones less those taken, and those of the viewer's own body, which comes last.
      const budget = Math.min(p.tier.bones, MAX_BONES) - p.boneCount - (own && ch.has(own.kind) ? ch.bones(own.kind) : 0);
      this.bodyRigid.fill(0, 0, n);
      if (wanted > budget) this.thin(remote, n, wanted, budget);
      for (let k = 0; k < n; k++) if (this.bodyMount[k] !== -1) this.seatIn(remote, from[k]!, this.bodyMount[k]!, place, k);
      for (let k = 0; k < n; k++) this.addRemote(remote, from[k]!, place, k, this.bodyRigid[k] !== 0, false);
    }
    if (own && ch.has(own.kind)) {
      let seat: VehicleSeatPose | undefined;
      let saddled = false;
      const at = this.seatAt;
      const j = own.attachment && remote ? indexOfId(remote, own.attachment.host) : -1;
      if (j >= 0 && remote!.gen[j] === own.attachment!.generation) {
        const vehicle = ch.vehicle(remote!.kind[j]!) ? remoteVehiclePose(remote!, j, this.vehiclePose) : undefined, ms = this.mountState;
        ms.unpack(remote!.anim[j]!, remote!.cue[j]!);
        ms.seed = bodySeed(remote!.id[j]!);
        const v = this.viewed[j]!;
        if (ch.seat(remote!.kind[j]!, remote!.x[j]! - cam.x, remote!.y[j]! - cam.y, remote!.z[j]! - cam.z, remote!.yaw[j]!, ms, remote!.tick, at, own.attachment!.slot, vehicle, remote!.gear[j * GEAR_COUNT + GEAR_WORN]!, remote!.id[j]!, v >= 0 && this.bodyRigid[v] !== 0)) {
          // A passenger in a car is posed in the car's frame; on a creature, astride in its seat's.
          if (vehicle) seat = ch.seatPose(remote!.kind[j]!, own.attachment!.slot, vehicle, at, remote!.yaw[j]!, own.yaw, this.ownSeat);
          else saddled = true;
        }
      }
      if (saddled) ch.add(p, own.kind, at[0]!, at[1]!, at[2]!, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, at, 3, undefined, undefined, false);
      else ch.add(p, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, null, 0, own.vehicle, seat);
    }
    if (remote && unseen > 0) this.poseUnseen(remote, unseen);
    const from = p.drawCount;
    ch.flush(p, this.transient, false, this.drawBody, this.casting ? this.castBody : null);
    if (cam.split > 0) this.bodyPasses(cam, from);
  }

  /** The remote entity in whose seat or arms entity `i` is, MOUNT_OWN for the viewer's own body, or -1. */
  private mountOf(remote: RemoteSample, i: number): number {
    const on = remote.seat[i]! - 1;
    if (on < 0) return -1;
    const own = this.own;
    if (own && own.id === on && (remote.seatSlot[i] === 0 || own.generation === remote.seatGen[i])) return MOUNT_OWN;
    const j = indexOfId(remote, on);
    return j >= 0 && (remote.seatSlot[i] === 0 || remote.seatGen[i] === remote.gen[j]) ? j : -1;
  }

  /**
   * Leaves on one bone those of the `n` bodies in view, which want `wanted` bones, that `budget` has no room to pose:
   * survivors and the viewer's mount are posed first, then the nearest, and those left take a bone each and the bones of
   * the poses they stand in (Characters.standInBones).
   */
  private thin(remote: RemoteSample, n: number, wanted: number, budget: number): void {
    const ch = this.characters;
    const st = this.state;
    const place = this.bodyAt;
    const from = this.bodyFrom;
    const order = this.bodyOrder;
    const host = this.own?.attachment?.host ?? -1;
    for (let k = 0; k < n; k++) {
      const far = Math.sqrt(place[k * 4]! * place[k * 4]! + place[k * 4 + 1]! * place[k * 4 + 1]! + place[k * 4 + 2]! * place[k * 4 + 2]!);
      const first = ch.human(remote.kind[from[k]!]!) || remote.id[from[k]!] === host;
      order[k] = (first ? 0 : 0x80000000) + Math.min(Math.floor(far * 256), 0xfffff) * MAX_VIEW + k;
    }
    sortU32(order, n);
    let need = wanted;
    for (let o = n - 1; o >= 0 && need > budget; o--) {
      const k = order[o]! % MAX_VIEW;
      const i = from[k]!;
      st.unpack(remote.anim[i]!, remote.cue[i]!);
      need -= ch.bones(remote.kind[i]!) - 1 - ch.standInBones(remote.kind[i]!, remote.hasLook[i] !== 0 ? remote.look : null, i * LOOK_BYTES, st, this.bodyRides[k] !== 0);
      this.bodyRigid[k] = 1;
    }
  }

  /**
   * Puts body `i`, in the seat or arms of `mount` (mountOf), at `k` of `place`, where its mount holds it as that is drawn
   * this frame; or where it is, facing its mount's way, if there is no such seat.
   */
  private seatIn(remote: RemoteSample, i: number, mount: number, place: Float64Array, k: number): void {
    const ch = this.characters;
    const p = this.packet;
    const at = this.seatAt;
    const held = (remote.cue[i]! & CUE_HELD) !== 0;
    let found: boolean;
    let saddle: number;
    let yaw: number;
    if (mount === MOUNT_OWN) {
      const own = this.own!;
      const x = own.x - p.camX, y = own.y - p.camY, z = own.z - p.camZ;
      saddle = own.gear[GEAR_WORN]!;
      found = held ? ch.heldAt(remote.id[i]!, remote.kind[i]!, own.id, own.kind, x, y, z, own.yaw, own.state, at) : ch.seat(own.kind, x, y, z, own.yaw, own.state, own.tick, at, remote.seatSlot[i]!, own.vehicle, saddle, own.id);
      yaw = own.yaw;
      if (found && !held && ch.vehicle(own.kind)) this.vehicleSeats[i] = ch.seatPose(own.kind, remote.seatSlot[i]!, own.vehicle!, at, yaw, remote.yaw[i]!, (this.seatPoses[i] ??= seatScratch()));
    } else {
      const j = mount;
      const x = remote.x[j]! - p.camX, y = remote.y[j]! - p.camY, z = remote.z[j]! - p.camZ;
      const ms = this.mountState;
      ms.unpack(remote.anim[j]!, remote.cue[j]!);
      ms.seed = bodySeed(remote.id[j]!);
      const vehicle = ch.vehicle(remote.kind[j]!) ? remoteVehiclePose(remote, j, this.vehiclePose) : undefined;
      saddle = remote.gear[j * GEAR_COUNT + GEAR_WORN]!;
      const v = this.viewed[j]!;
      found = held ? ch.heldAt(remote.id[i]!, remote.kind[i]!, remote.id[j]!, remote.kind[j]!, x, y, z, remote.yaw[j]!, ms, at) : ch.seat(remote.kind[j]!, x, y, z, remote.yaw[j]!, ms, remote.tick, at, remote.seatSlot[i]!, vehicle, saddle, remote.id[j]!, v >= 0 && this.bodyRigid[v] !== 0);
      yaw = remote.yaw[j]!;
      if (found && !held && vehicle) this.vehicleSeats[i] = ch.seatPose(remote.kind[j]!, remote.seatSlot[i]!, vehicle, at, yaw, remote.yaw[i]!, (this.seatPoses[i] ??= seatScratch()));
    }
    place[k * 4] = found ? at[0]! : remote.x[i]! - p.camX;
    place[k * 4 + 1] = found ? at[1]! : remote.y[i]! - p.camY;
    place[k * 4 + 2] = found ? at[2]! : remote.z[i]! - p.camZ;
    place[k * 4 + 3] = yaw;
    // A rider sits in its seat's whole frame; one in a vehicle's seat is posed in the vehicle's (vehicleSeats).
    if (!found || held || this.vehicleSeats[i]) return;
    const steers = remote.seatSlot[i] === 0 || this.saddleSeats[saddle]?.[remote.seatSlot[i]! - 1]?.driver === true;
    this.seated[i] = steers ? 1 : 2;
    for (let q = 0; q < 9; q++) this.seatTurn[i * 9 + q] = at[3 + q]!;
    // A passenger looks and aims as it will: its own facing turns it within the seat.
    if (!steers) place[k * 4 + 3] = remote.yaw[i]!;
  }

  /** Poses remote entity `i` at the place `at` holds at `k` (x, y, z camera-relative, and yaw), for the view or, `unseen`, for its shadow alone. */
  private addRemote(remote: RemoteSample, i: number, at: Float64Array, k: number, rigid: boolean, unseen: boolean): void {
    const st = this.state;
    const kind = remote.kind[i]!;
    st.unpack(remote.anim[i]!, remote.cue[i]!);
    st.seed = bodySeed(remote.id[i]!);
    const look = remote.hasLook[i] !== 0 ? remote.look : null;
    const size = remote.grown[i] !== 0 ? youngScale(this.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    this.characters.add(this.packet, kind, at[k * 4]!, at[k * 4 + 1]!, at[k * 4 + 2]!, at[k * 4 + 3]!, st, remote.tick, look, i * LOOK_BYTES, remote.colors, i * 6, remote.gear, i * GEAR_COUNT, remote.id[i]!, false, this.own?.cockpitActor === remote.id[i]!, size, rigid, unseen, this.seated[i] !== 0 ? this.seatTurn : null, i * 9, this.characters.vehicle(kind) ? remoteVehiclePose(remote, i, this.vehiclePose) : undefined, this.vehicleSeats[i], this.seated[i] !== 2);
  }

  /**
   * Poses the bodies out of view whose shadows may fall in it, nearest first, by the same call as a body in view, so a
   * shadow matches its body when it walks in. They take the tier's bones those in view leave, and stand in a pose on one
   * bone when there are too few for theirs.
   */
  private poseUnseen(remote: RemoteSample, count: number): void {
    const p = this.packet;
    const place = this.unseenAt;
    const order = this.bodyOrder;
    for (let k = 0; k < count; k++) order[k] = Math.min(Math.floor(Math.hypot(place[k * 4]!, place[k * 4 + 1]!, place[k * 4 + 2]!) * 256), 0xfffff) * MAX_VIEW + k;
    sortU32(order, count);
    const limit = Math.min(p.tier.bones, MAX_BONES);
    for (let o = 0; o < count; o++) {
      const k = order[o]! % MAX_VIEW;
      const i = this.unseenFrom[k]!;
      const rigid = p.boneCount + this.characters.bones(remote.kind[i]!) > limit;
      if (rigid && p.boneCount >= limit) break;
      if (this.unseenMount[k] !== -1) this.seatIn(remote, i, this.unseenMount[k]!, place, k);
      this.addRemote(remote, i, place, k, rigid, true);
    }
  }

  private showFalling(cam: Camera, f: Falling): void {
    const p = this.packet;
    this.counts.fill(0);
    for (let i = 0; i < f.count; i++) this.tally(cam, this.meshOfKind[f.kind[i]!]!, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z);
    const total = this.drawTallied(cam, p.transientCount, 0, this.fallLevel);
    for (let i = 0; i < f.count; i++) {
      const kind = f.kind[i]!;
      const at = this.cursor[this.meshOfKind[kind]!]!++;
      this.transient.set(at, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z, f.yaw[i]!, this.colorOfKind[kind]!);
      p.transientIds[at] = 0;
    }
    p.transientCount = total;
  }

  private showGhost(cam: Camera): void {
    const p = this.packet;
    const g = this.ghost;
    const first = p.transientCount;
    const x = g.x - cam.x, y = g.y - cam.y, z = g.z - cam.z;
    this.transient.set(first, x, y, z, g.yaw, g.color);
    p.transientIds[first] = 0;
    const mesh = this.meshOfKind[g.kind]!;
    const r = this.radiusOfMesh[mesh]!;
    this.draw(mesh, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_BLEND, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
    p.transientCount = first + 1;
  }

  private showThings(cam: Camera): void {
    const p = this.packet;
    const errors = this.assets.table.error;
    let wanted = -1;
    for (const t of this.things) {
      const r = this.radiusOfMesh[t.mesh]!;
      const x = t.x - cam.x, y = t.y - cam.y, z = t.z - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      if (p.transientCount === p.transientIds.length) {
        p.dropped++;
        continue;
      }
      const far = Math.sqrt(x * x + y * y + z * z);
      wanted = this.assets.choose(errors[t.mesh]!, far, wanted < 0 ? t.level : wanted);
      this.assets.wantTextured(t.mesh, wanted, far);
      const first = p.transientCount;
      this.transient.set(first, x, y, z, 0, 0);
      p.transientIds[first] = 0;
      const d = p.drawCount;
      this.draw(t.mesh, wanted, TRANSIENT_BUFFER, first, 1, 0, 0, 0, 0, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
      // What was drawn, which is coarser than what was wanted until that has come.
      t.level = p.drawCount > d ? p.drawLod[d]! : -1;
      wanted = -1;
      p.transientCount = first + 1;
    }
  }

  /**
   * The map's moving statics' parts, to their own reach: posed while they move, and as they were while they rest. A
   * landmark's are drawn as far as its far mesh, the far city's reach, so its sails do not end before its hull.
   */
  private showMotion(cam: Camera, source: MotionSource): void {
    const p = this.packet, tier = this.assets.tier, table = this.assets.table;
    const statics = source.statics();
    if (statics !== this.movingFrom) {
      this.movingFrom = statics;
      this.moving = statics ? movingOf(this.motionReg!, statics) : [];
    }
    const own = Math.min(this.viewDistance, tier.reach.parts), landmark = Math.min(this.viewDistance, Math.max(tier.reach.parts, tier.reach.city));
    const states = source.states(), tick = source.tick();
    const bones = Math.min(tier.bones, MAX_BONES), draws = Math.min(MAX_DRAWS, tier.budget.draws);
    for (const t of this.moving) {
      const reach = this.landmarkKinds[t.kind] === 1 ? landmark : own;
      const x = t.x - cam.x, y = t.y - cam.y, z = t.z - cam.z;
      if (Math.sqrt(x * x + y * y + z * z) > reach + MAX_MOVING_REACH) continue;
      poseMoving(t, states.get(t.ref), tick);
      const parts = t.facet.parts, pose = t.pose;
      for (let i = 0; i < parts.length; i++) {
        const mesh = table.find(parts[i]!.mesh);
        if (mesh < 0) {
          p.skipped++;
          continue;
        }
        const at = i * PART_FLOATS, r = this.radiusOfMesh[mesh]! * pose[at + 12]!;
        const cx = x + pose[at + 3]!, cy = y + pose[at + 7]!, cz = z + pose[at + 11]!;
        const far = Math.max(0, Math.sqrt(cx * cx + cy * cy + cz * cz) - r);
        if (far > reach) continue;
        const seen = cam.boxVisible(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
        const casts = this.casting ? this.castBox(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r) & this.cascades.fits(r) : 0;
        if (!seen && casts === 0) continue;
        if (p.boneCount >= bones || p.transientCount === p.transientIds.length || (seen && p.drawCount + this.doubled >= draws)) {
          p.dropped++;
          continue;
        }
        const bone = p.boneCount++, b = bone * BONE_FLOATS;
        for (let k = 0; k < BONE_FLOATS; k++) p.bones[b + k] = pose[at + k]!;
        p.bones[b + 3] = cx;
        p.bones[b + 7] = cy;
        p.bones[b + 11] = cz;
        const first = p.transientCount++;
        this.transient.setSkinned(first, bone, t.color);
        p.transientIds[first] = 0;
        const level = this.assets.choose(table.error[mesh]!, far, t.level[i]!);
        t.level[i] = level;
        this.assets.wantTextured(mesh, level, far);
        if (seen) {
          const d = p.drawCount;
          this.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_SKINNED, cam.passes(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r));
          for (let k = d; k < p.drawCount; k++) p.drawFade[k] = reach;
          p.frame[FRAME.fade] = tier.fade;
        }
        if (casts !== 0) this.castBody(mesh, level, first, 1, DRAW_SKINNED, casts, 0);
      }
    }
  }

  private markBeams(cam: Camera): void {
    const p = this.packet;
    const first = p.transientCount;
    let n = 0;
    let from = Infinity;
    let to = -Infinity;
    const r = this.radiusOfMesh[this.beamMesh]!;
    for (let i = 0; i + 2 < this.beams.length && n < 16; i += 3) {
      const x = this.beams[i]! - cam.x, y = this.beams[i + 1]! - cam.y, z = this.beams[i + 2]! - cam.z;
      this.transient.set(first + n, x, y, z, 0, BEAM_COLOR);
      p.transientIds[first + n] = 0;
      from = Math.min(from, cam.depth(x, y, z) - r);
      to = Math.max(to, cam.depth(x, y, z) + r);
      n++;
    }
    p.dropped += Math.floor(this.beams.length / 3) - n;
    this.draw(this.beamMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, 0, cam.passesOf(from, to));
    p.transientCount = first + n;
  }

  /**
   * Tiles of one flat mesh over the map, drawn last because they are see-through, but for those the lakes draw. With
   * `lit` the sea runs on past the map to the end of the view, and is drawn with its waves and its depth (water.ts);
   * seen from under water, or in a plain sky, it is as it always was. Whether it drew with its waves.
   */
  private water(cam: Camera, sea: number, lit: boolean): boolean {
    const p = this.packet;
    const hf = this.world.hf;
    const first = p.transientCount;
    let n = 0;
    const half = WATER_TILE / 2;
    const r = Math.ceil(this.viewDistance / WATER_TILE);
    const cx = Math.floor(cam.x / WATER_TILE), cz = Math.floor(cam.z / WATER_TILE);
    const ix0 = lit ? cx - r : 0, iz0 = lit ? cz - r : 0;
    const ix1 = lit ? cx + r : Math.ceil(hf.sizeX / WATER_TILE) - 1, iz1 = lit ? cz + r : Math.ceil(hf.sizeZ / WATER_TILE) - 1;
    // The box round every tile drawn, for its depth ranges.
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let tz = iz0; tz <= iz1; tz++) {
      for (let tx = ix0; tx <= ix1; tx++) {
        const x = tx * WATER_TILE + half - cam.x;
        const z = tz * WATER_TILE + half - cam.z;
        const y = sea - cam.y;
        if (this.lakes?.holed(tx, tz) || !cam.boxVisible(x - half, y - 0.1, z - half, x + half, y + 0.1, z + half)) continue;
        if (n === MAX_WATER_TILES) {
          p.dropped++;
          continue;
        }
        this.transient.set(first + n, x, y, z, 0, WATER_COLOR);
        p.transientIds[first + n] = 0;
        n++;
        x0 = Math.min(x0, x - half);
        z0 = Math.min(z0, z - half);
        x1 = Math.max(x1, x + half);
        z1 = Math.max(z1, z + half);
      }
    }
    if (n === 0) return false;
    const d = p.drawCount;
    this.draw(this.waterMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, lit ? DRAW_BLEND | DRAW_WATER : DRAW_BLEND, cam.passes(x0, sea - cam.y - 0.1, z0, x1, sea - cam.y + 0.1, z1));
    p.transientCount = first + n;
    if (!lit || p.drawCount === d) return false;
    p.drawMaterial[d] = this.waterMaterial;
    return true;
  }

  /** The lakes' tiles to the end of the view, each a draw as the sea's is. Whether any drew with its waves. */
  private showLakes(cam: Camera, lit: boolean): boolean {
    this.lakes!.update(this.packet, this.assets.residency, cam.x, cam.z, this.viewDistance);
    this.lakesLit = lit;
    this.lakesWaved = false;
    this.lakes!.draw(cam, this.viewDistance, this.drawLake);
    return this.lakesWaved;
  }

  /** Whether the lakes are drawn with their waves this frame, and whether any was. */
  private lakesLit = false;
  private lakesWaved = false;

  /** A lake tile, a draw as the sea's is. */
  private readonly drawLake = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    p.drawMesh[d] = this.lakes!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = LAKE_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = this.lakesLit ? DRAW_BLEND | DRAW_WATER : DRAW_BLEND;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawMaterial[d] = this.waterMaterial;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += triangles * copies;
    this.lakesWaved ||= this.lakesLit;
  };

  /**
   * Chunk `c` of the store uses instance buffer `base + c`. A slot's kind is drawn as `meshOf` and `colorOf` say, and at the
   * size `sizeOf` says if it is given: a store of nodes.
   */
  private structures(cam: Camera, store: StructureStore, base: number, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null): void {
    const p = this.packet;
    const world = this.world;
    const chunks = store.chunks;
    const band = this.assets.tier.nodes.band[1];
    // How far the near plane's corners are from the camera: a room that near may be cut into and seen.
    const slope = Math.tan(cam.fovY / 2);
    const reach = cam.near * Math.sqrt(1 + slope * slope * (1 + cam.aspect * cam.aspect));
    // The map's statics drawn flat as their form are a mesh a chunk where the far city follows what of them stands.
    const statics = world.city?.statics;
    const near = base === 0 && this.nearMesh && this.city && statics ? this.near : null;
    if (base === 0 && !near) this.near?.clear(p, this.assets.residency);
    near?.begin();
    // Instances laid out this frame, which take of what the near city may make in it.
    let laid = 0;

    // Chunks that no longer exist on this client free their buffers.
    for (const id of this.batches.keys()) if (id >= base && id < base + NODE_BUFFERS && !chunks[id - base]) this.drop(id);

    const held = store.held;
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
      const own = near ? near.of(chunk, t, statics!, this.city!, this.chunkCells, Math.hypot(x0 + CHUNK_SIZE / 2 - cam.x, z0 + CHUNK_SIZE / 2 - cam.z), p) : null;
      const mesh = own?.mesh ?? null;
      let batch = this.batches.get(id);
      // A piece that took another kind in place is moved in place; a chunk whose doors have stood a while other than its
      // rooms were found with has them found again. A mesh not yet known has its page asked for while it is near. A chunk
      // whose mesh came, or went with a change to what stands, is laid out again the same frame.
      let learnt = false;
      if (batch) for (const m of batch.unknown) learnt = this.assets.known(m) || learnt;
      const turned = batch !== undefined && batch.shape !== t.shape && !batch.sized && batch.placed === t.placed;
      if (!batch || learnt || batch.mesh !== mesh || (batch.shape !== t.shape && !(turned && this.reform(batch, t, meshOf, colorOf))) || (batch.differ > 0 && this.now - batch.since >= SETTLE)) {
        batch = this.rebuild(store, chunk, id, batch, meshOf, colorOf, sizeOf, mesh, own?.mine ?? null);
        laid += t.high;
      }
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
      const seen = cam.boxVisible(ax, ay, az, bx, by, bz) && dist <= this.viewDistance && dist <= this.structureDistance && (sizeOf === null || dist < band);
      // A chunk out of view may still cast into it.
      const casts = this.casting ? this.castBox(ax, ay, az, bx, by, bz) : 0;
      if (!seen && casts === 0) continue;
      if (!batch.uploaded) {
        p.uploads.push({ buffer: id, data: batch.data, slots: batch.slots });
        batch.uploaded = true;
        this.assets.residency.spend(batch.data.length);
        this.instanceBytes += batch.data.length - batch.onCard;
        batch.onCard = batch.data.length;
      }
      this.zones(cam, batch, seen, casts);
      // From outside air a chunk's interior is neither seen nor seen to cast: only its shell is drawn and cast.
      const all = batch.blocks === batch.cells || batch.exposing > 0 || batch.rooms!.near(cam.x, cam.y, cam.z, reach);
      const ox = x0 - cam.x, oy = -cam.y, oz = z0 - cam.z;
      if (seen) this.ranges(cam, batch, id, dist, ox, oy, oz, cam.passes(ax, ay, az, bx, by, bz), all);
      if (seen && batch.mesh) this.meshRuns(cam, batch, id, ox, oy, oz, cam.passes(ax, ay, az, bx, by, bz));
      if (casts !== 0) this.castChunk(batch, id, ox, oy, oz, casts, all);
      if (casts !== 0 && batch.mesh) this.castMesh(batch, id, ox, oy, oz);
    }
    near?.end(p, this.assets.residency, statics!, this.city!, world.hf, this.chunkCells, laid);
  }

  /** Lets go of a chunk's instances, and the card of its buffer. */
  private drop(id: number): void {
    const b = this.batches.get(id);
    if (!b) return;
    if (b.uploaded || b.onCard > 0) this.packet.drops.push(id);
    this.instanceBytes -= b.onCard;
    this.batches.delete(id);
  }

  /**
   * Finds which cells of a chunk are in view, if it is, and which wholly; and which of `casts` each casts into, its
   * shadow reaching as far as the chunk's can, which is at least as far as its own.
   */
  private zones(cam: Camera, b: ChunkBatch, seen: boolean, casts: number): void {
    const z = b.zone;
    this.wholeView = seen && cam.boxInside(b.minX - cam.x, b.minY - cam.y, b.minZ - cam.z, b.maxX - cam.x, b.maxY - cam.y, b.maxZ - cam.z);
    const stretch = casts !== 0 ? this.stretch(b.minX - cam.x, b.minZ - cam.z, b.maxX - cam.x, b.maxZ - cam.z, b.maxY - cam.y) : 0;
    for (let c = 0, k = 0; c < b.cells; c++, k += 6) {
      const ax = z[k]! - cam.x, ay = z[k + 1]! - cam.y, az = z[k + 2]! - cam.z;
      const bx = z[k + 3]! - cam.x, by = z[k + 4]! - cam.y, bz = z[k + 5]! - cam.z;
      const held = ax <= bx;
      this.cellSeen[c] = !seen || !held ? 0 : this.wholeView || cam.boxInside(ax, ay, az, bx, by, bz) ? 2 : cam.boxVisible(ax, ay, az, bx, by, bz) ? 1 : 0;
      this.cellCasts[c] = casts !== 0 && held ? casts & this.castsBy(ax, ay, az, bx, by, bz, stretch) : 0;
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
    const from = sized ? band[0] : Infinity, to = sized ? band[1] : Infinity;
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
    const flags = sized ? DRAW_SIZED : 0;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0) continue;
      const at0 = q * (b.blocks + 1);
      const errors = this.assets.table.error[mesh]!;
      const reach = b.reach[q]!;
      const tree = sized && this.treeOf[mesh] === 1;
      const near = this.assets.choose(errors, (dist * cover) / reach, b.level[q]!);
      const crown = tree ? this.assets.choose(errors, (dist * scale) / reach, b.crown[q]!) : near;
      // A mesh whose instances here weigh less than a draw at the level the nearest asks for is drawn whole at it.
      const light = far <= from && !tree && b.ranges[r + 2]! * this.trisOfMesh[mesh]![near]! <= RUN_TRIANGLES;
      const one = light || (far <= from && near === this.assets.choose(errors, (far * cover) / reach, b.level[q]!) && (!tree || crown === this.assets.choose(errors, (far * scale) / reach, b.crown[q]!)));
      if (one) {
        b.level[q] = near;
        b.crown[q] = crown;
        b.thin[q] = tree ? thinning(squeeze, dist, to, b.thin[q]!) : 0;
        levels.fill(near, q * cells, (q + 1) * cells);
        crowns.fill(crown, q * cells, (q + 1) * cells);
        thins.fill(b.thin[q]!, q * cells, (q + 1) * cells);
        let whole = this.wholeView;
        for (let c = 0; light && !whole && c < cells; c++) whole = this.firstOf(b, at0, c + 1) !== this.firstOf(b, at0, c) && this.cellShows(cam, b, q, c, mesh);
        if (whole) {
          this.assets.wantTextured(mesh, near, dist / reach);
          if (crown !== near) this.assets.wantTextured(mesh, crown, dist / reach);
          for (let s = 0, n = this.spansOf(b, at0, 0, cells, all); s < n; s++) this.draw(mesh, near, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, passes, 0, 0, crown, leavesAt(b.thin[q]!));
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
        let seen = dist / reach, hand = 0, level = near, crown = b.crown[q]!, thin = b.thin[q]!;
        if (!one) {
          if (sized) {
            const most = Math.hypot(Math.max(Math.abs(box[k]! - cam.x), Math.abs(box[k + 3]! - cam.x)), Math.max(Math.abs(box[k + 1]! - cam.y), Math.abs(box[k + 4]! - cam.y)), Math.max(Math.abs(box[k + 2]! - cam.z), Math.abs(box[k + 5]! - cam.z)));
            hand = most > from ? HAND_NEAR : 0;
          }
          seen = d / b.cellReach[qc]!;
          level = levels[qc] = this.assets.choose(errors, seen * cover, levels[qc]!);
          crown = crowns[qc] = tree ? this.assets.choose(errors, seen * scale, crowns[qc]!) : level;
          thin = thins[qc] = tree ? thinning(squeeze, d, to, thins[qc]!) : 0;
        }
        // A run is its first and end instance, its level and the coarsest a cell of it asked for, its nearest distance,
        // its hand-over, its crown's level and the coarsest a cell asked for, its least thinning, and its first and end cell.
        const last = runs.length - RUN;
        if (last >= 0 && next === v0) {
          const finer = Math.min(runs[last + 2]!, level), coarser = Math.max(runs[last + 3]!, level);
          const crownFiner = Math.min(runs[last + 6]!, crown), crownCoarser = Math.max(runs[last + 7]!, crown);
          const fuller = Math.min(runs[last + 8]!, thin);
          const had = runs[last + 1]! - runs[last]!;
          const cost = this.cost(mesh, finer, crownFiner, fuller);
          const more = had * (cost - this.cost(mesh, runs[last + 2]!, runs[last + 6]!, runs[last + 8]!)) + n * (cost - this.cost(mesh, level, crown, thin)) + gap * cost;
          if (coarser - finer <= 1 && crownCoarser - crownFiner <= 1 && more <= RUN_TRIANGLES) {
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
        runs.push(v0, v1, level, level, seen, hand, crown, crown, thin, c, c + 1);
        next = v1;
        gap = 0;
      }
      for (let k = 0; k < runs.length; k += RUN) {
        this.assets.wantTextured(mesh, runs[k + 2]!, runs[k + 4]!);
        if (runs[k + 6] !== runs[k + 2]) this.assets.wantTextured(mesh, runs[k + 6]!, runs[k + 4]!);
        for (let s = 0, n = this.spansOf(b, at0, runs[k + 9]!, runs[k + 10]!, all); s < n; s++) this.draw(mesh, runs[k + 2]!, id, spans[s * 2]!, spans[s * 2 + 1]!, ox, oy, oz, flags, passes, runs[k + 5]!, 0, runs[k + 6]!, leavesAt(runs[k + 8]!));
      }
    }
  }

  /**
   * Draws a chunk's mesh by its cells in view (`zones`), each run of neighbouring cells one draw in the depth ranges
   * `passes`, a run going on over cells out of view between where they weigh less than a draw.
   */
  private meshRuns(cam: Camera, b: ChunkBatch, id: number, ox: number, oy: number, oz: number, passes: number): void {
    const m = b.mesh!, first = m.cellFirst, box = m.cellBox;
    if (m.slot < 0) return;
    let from = -1, to = 0, gap = 0;
    for (let c = 0; c < b.cells; c++) {
      const n = first[c + 1]! - first[c]!;
      if (n === 0) continue;
      const k = c * 6, seen = this.cellSeen[c]!;
      if (seen === 0 || (seen === 1 && !cam.boxVisible(box[k]! + ox, box[k + 1]! + oy, box[k + 2]! + oz, box[k + 3]! + ox, box[k + 4]! + oy, box[k + 5]! + oz))) {
        gap += n;
        continue;
      }
      if (from >= 0 && gap * 2 > RUN_TRIANGLES) {
        this.drawMesh(b, id, from, to, ox, oy, oz, passes);
        from = -1;
      }
      if (from < 0) from = first[c]!;
      to = first[c + 1]!;
      gap = 0;
    }
    if (from >= 0) this.drawMesh(b, id, from, to, ox, oy, oz, passes);
  }

  /** Faces `from` up to `to` of a chunk's mesh: one instance of its level, at the chunk's corner. */
  private drawMesh(b: ChunkBatch, id: number, from: number, to: number, ox: number, oy: number, oz: number, passes: number): void {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
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
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += (to - from) * 2 * copies;
  }

  /**
   * Puts a chunk's mesh in the caster list: into each cascade the runs of its cells that cast into it (`cellCasts`), a
   * cell between that does not going in when it weighs less than a draw. Runs alike but for their cascades are one caster.
   */
  private castMesh(b: ChunkBatch, id: number, ox: number, oy: number, oz: number): void {
    const m = b.mesh!, first = m.cellFirst;
    if (m.slot < 0) return;
    const runs = this.castRuns;
    runs.length = 0;
    for (let i = 0; i < this.cascades.count; i++) {
      const bit = 1 << i;
      let open = -1, gap = 0;
      for (let c = 0; c < b.cells; c++) {
        const n = first[c + 1]! - first[c]!;
        if (n === 0) continue;
        if ((this.cellCasts[c]! & bit) === 0) {
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
    for (let k = 0; k < runs.length; k += 3) {
      if (runs[k + 2] === 0) continue;
      for (let j = k + 3; j < runs.length; j += 3) {
        if (runs[j] !== runs[k] || runs[j + 1] !== runs[k + 1]) continue;
        runs[k + 2]! |= runs[j + 2]!;
        runs[j + 2] = 0;
      }
      this.caster(this.near!.mesh, 0, m.slot, id, b.meshAt, 1, ox, oy, oz, DRAW_RANGED, 0, runs[k]! * 6, (runs[k + 1]! - runs[k]!) * 6, runs[k + 2]!);
    }
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
    const spread = b.sized ? this.assets.table.side[mesh]! * b.cellReach[q * b.cells + c]! : 0;
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
  private reform(b: ChunkBatch, t: ChunkTable, meshOf: Uint16Array, colorOf: Uint8Array): boolean {
    const { slots, kinds, data, ranges, cellFirst } = b;
    const blocks = b.blocks;
    for (let moves = 0; ; moves++) {
      let i = 0;
      while (i < b.meshAt && t.kind[slots[i]!] === kinds[i]) i++;
      if (i === b.meshAt) break;
      const slot = slots[i]!, kind = t.kind[slot]!, was = kinds[i]!;
      if (moves === 16 || kind === 0 || meshOf[kind] === HIDDEN) return false;
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
        } else {
          data.copyWithin((d + 1) * INSTANCE_BYTES, d * INSTANCE_BYTES, i * INSTANCE_BYTES);
          slots.copyWithin(d + 1, d, i);
          kinds.copyWithin(d + 1, d, i);
        }
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
        grow(b.zone, cell * 6, x - rad, y - rad, z - rad, x + rad, y + rad, z + rad);
        b.minX = Math.min(b.minX, x - rad);
        b.minY = Math.min(b.minY, y - rad);
        b.minZ = Math.min(b.minZ, z - rad);
        b.maxX = Math.max(b.maxX, x + rad);
        b.maxY = Math.max(b.maxY, y + rad);
        b.maxZ = Math.max(b.maxZ, z + rad);
      }
      data[at * INSTANCE_BYTES + 14] = colorOf[kind]!;
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
    return true;
  }

  /**
   * The instances of a chunk of the store, each mesh's together, shell before interior (rooms.ts), then by cell
   * (ChunkBatch.cells), and in a cell by slot. A mesh whose kinds turn into another's in place (a door and its open form)
   * has that mesh's range beside it, empty or not, so the turn can be made in place (`reform`). Given the chunk's `mesh`,
   * the pieces `mine` marks by slot are its and have no instance, and one instance at the chunk's corner draws it.
   */
  private rebuild(store: StructureStore, chunk: number, id: number, old: ChunkBatch | undefined, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null, mesh: NearMesh | null, mine: Uint8Array | null): ChunkBatch {
    const world = this.world;
    const t = store.chunks[chunk]!;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const side = this.chunkCells;
    const cells = side * side;
    if (this.cellCounts.length < this.counts.length * cells * 2) {
      this.cellCounts = new Uint32Array(this.counts.length * cells * 2);
      this.cellCursor = new Uint32Array(this.counts.length * cells * 2);
    }
    if (this.cellSeen.length < cells) {
      this.cellSeen = new Uint8Array(cells);
      this.cellCasts = new Uint8Array(cells);
    }
    if (this.blockAt.length < t.high) this.blockAt = new Uint8Array(Math.max(t.high, this.blockAt.length * 2));
    const rooms = sizeOf === null ? (old?.rooms ?? new Rooms()) : null;
    const inside = rooms !== null && this.finder.find(t, x0, z0, rooms);
    const blocks = inside ? cells * 2 : cells;
    const shell = rooms?.shell, blockAt = this.blockAt;
    const counts = this.cellCounts.fill(0, 0, this.counts.length * blocks);
    const skip = mesh ? mine! : null;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || meshOf[kind] === HIDDEN || (skip && skip[s] === 1)) continue;
      const i = Math.min(side - 1, Math.max(0, Math.floor(((t.x[s]! - x0) * side) / CHUNK_SIZE)));
      const j = Math.min(side - 1, Math.max(0, Math.floor(((t.z[s]! - z0) * side) / CHUNK_SIZE)));
      const block = (inside && shell![s] === 0 ? cells : 0) + j * side + (j & 1 ? side - 1 - i : i);
      blockAt[s] = block;
      counts[meshOf[kind]! * blocks + block]!++;
    }
    const ranges: number[] = [];
    let total = 0;
    for (let m = 0; m < this.counts.length; m++) {
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
    const n = ranges.length / 3;
    const count = total + (mesh ? 1 : 0);
    const data = old && old.data.length === count * INSTANCE_BYTES ? old.data : new Uint8Array(count * INSTANCE_BYTES);
    const slots = old && old.slots.length === count ? old.slots : new Uint16Array(count);
    const kinds = old && old.kinds.length === count ? old.kinds : new Uint16Array(count);
    const w = new InstanceWriter(data);
    const b: ChunkBatch = {
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
      zone: new Float32Array(cells * 6),
      cellLevel: new Int8Array(n * cells).fill(-1),
      crown: new Int8Array(n).fill(-1),
      thin: new Uint8Array(n).fill(255),
      cellCrown: new Int8Array(n * cells).fill(-1),
      cellThin: new Uint8Array(n * cells).fill(255),
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
    };
    emptyBoxes(b.cellBox);
    emptyBoxes(b.zone);
    for (let q = 0; q < n; q++) {
      const m = ranges[q * 3]!;
      for (let c = 0; c < blocks; c++) b.cellFirst[q * (blocks + 1) + c] = this.cellCursor[m * blocks + c]!;
      b.cellFirst[q * (blocks + 1) + blocks] = ranges[q * 3 + 1]! + ranges[q * 3 + 2]!;
      this.cursor[m] = q;
    }
    const box = b.cellBox, zone = b.zone;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || meshOf[kind] === HIDDEN || (skip && skip[s] === 1)) continue;
      const mesh = meshOf[kind]!;
      const x = t.x[s]!;
      const y = t.y[s]!;
      const z = t.z[s]!;
      const block = blockAt[s]!;
      const cell = block % cells;
      const i = this.cellCursor[mesh * blocks + block]!++;
      w.set(i, x - x0, y, z - z0, t.yaw[s]!, colorOf[kind]!);
      if (sizeOf) w.size(i, sizeOf[kind]!);
      slots[i] = s;
      kinds[i] = kind;
      // A node is held by its mesh's own bounds at its size, which for a tall tree are far tighter sideways than a sphere.
      const k = sizeOf ? sizeOf[kind]! / SIZE_UNITS : 1;
      const r = sizeOf ? this.assets.table.side[mesh]! * k : this.radiusOfMesh[mesh]!;
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
    if (mesh) {
      // The mesh's cells, x and z from the chunk's corner, in the chunk's.
      w.set(total, 0, 0, 0, 0, 0);
      slots[total] = MESH_SLOT;
      kinds[total] = 0;
      const mb = mesh.cellBox;
      for (let c = 0; c < cells; c++) {
        const k = c * 6;
        if (mb[k]! > mb[k + 3]!) continue;
        grow(zone, k, mb[k]! + x0, mb[k + 1]!, mb[k + 2]! + z0, mb[k + 3]! + x0, mb[k + 4]!, mb[k + 5]! + z0);
        b.minX = Math.min(b.minX, mb[k]! + x0);
        b.minY = Math.min(b.minY, mb[k + 1]!);
        b.minZ = Math.min(b.minZ, mb[k + 2]! + z0);
        b.maxX = Math.max(b.maxX, mb[k + 3]! + x0);
        b.maxY = Math.max(b.maxY, mb[k + 4]!);
        b.maxZ = Math.max(b.maxZ, mb[k + 5]! + z0);
      }
    }
    this.batches.set(id, b);
    return b;
  }

  private entities(cam: Camera, remote: RemoteSample): void {
    this.entityBatch(cam, remote, false);
    if (this.packet.lit) this.entityBatch(cam, remote, true);
  }

  /** A prop and a species can share a mesh, so the lit palette policy groups instances by kind as well as mesh. */
  private entityBatch(cam: Camera, remote: RemoteSample, plain: boolean): void {
    const p = this.packet;
    this.counts.fill(0);
    let visible = 0;
    const bodies = this.characters;
    for (let i = 0; i < remote.count; i++) {
      if (p.lit && this.speciesKind[remote.kind[i]!] !== Number(plain)) continue;
      // A cloud has no mesh of its own: it is puffs among the details (clouds.ts).
      if (bodies.has(remote.kind[i]!) || this.pitched[remote.kind[i]!] !== 0 || this.clouds.kinds[remote.kind[i]!] !== 0) continue;
      // A bag of one stack is drawn as its item, where the item has a lying mesh.
      const lies = this.dropped.item(remote.kind[i]!, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[remote.kind[i]!]!;
      const r = this.radiusOfMesh[mesh]!;
      // The mount the viewer rides is where its prediction has it, as its rider is drawn on it (bodies()).
      const mine = this.own !== null && remote.id[i] === this.skip;
      const x = (mine ? this.own!.x : remote.x[i]!) - cam.x;
      const y = (mine ? this.own!.y : remote.y[i]!) - cam.y;
      const z = (mine ? this.own!.z : remote.z[i]!) - cam.z;
      // Culled entries are left out of the counts. The second pass repeats the test.
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      this.tally(cam, mesh, x, y, z);
      visible++;
    }
    if (visible === 0) return;
    const total = this.drawTallied(cam, p.transientCount, plain ? DRAW_PLAIN : 0);
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (p.lit && this.speciesKind[kind] !== Number(plain)) continue;
      if (bodies.has(kind) || this.pitched[kind] !== 0 || this.clouds.kinds[kind] !== 0) continue;
      const lies = this.dropped.item(kind, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[kind]!;
      const r = this.radiusOfMesh[mesh]!;
      const mine = this.own !== null && remote.id[i] === this.skip;
      const x = (mine ? this.own!.x : remote.x[i]!) - cam.x;
      const y = (mine ? this.own!.y : remote.y[i]!) - cam.y;
      const z = (mine ? this.own!.z : remote.z[i]!) - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      const at = this.cursor[mesh]!++;
      const yaw = Math.round(((mine ? this.own!.yaw : remote.yaw[i]!) / (2 * Math.PI)) * 65536) & 0xffff;
      if (lies !== 0) this.transient.set(at, x, y, z, this.dropped.yaw(remote.id[i]!, yaw), this.dropped.colorOf(lies));
      else this.transient.set(at, x, y, z, yaw, this.colorOfKind[kind]!);
      this.transient.regions(at, remote.colors, i * 6);
      p.transientIds[at] = remote.id[i]!;
    }
    p.transientCount = total;
  }

  /** Counts an instance of `mesh` that is (x, y, z) from the camera, and keeps how near the nearest of them is and how far along the view they lie. */
  private tally(cam: Camera, mesh: number, x: number, y: number, z: number): void {
    const far = x * x + y * y + z * z;
    const along = cam.depth(x, y, z);
    const r = this.radiusOfMesh[mesh]!;
    if (this.counts[mesh] === 0) { this.nearest[mesh] = far; this.from[mesh] = along - r; this.to[mesh] = along + r; }
    else {
      if (far < this.nearest[mesh]!) this.nearest[mesh] = far;
      if (along - r < this.from[mesh]!) this.from[mesh] = along - r;
      if (along + r > this.to[mesh]!) this.to[mesh] = along + r;
    }
    this.counts[mesh]!++;
  }

  /**
   * Draws what was tallied, the instances of each mesh together, from transient instance `total` on. Returns where
   * they end. With `levels`, each mesh's are drawn at the level the nearest point of the nearest asks for, which it
   * keeps there; otherwise at their finest however far off, so only their materials are told how near they are.
   */
  private drawTallied(cam: Camera, total: number, flags = 0, levels: Int8Array | null = null): number {
    const counts = this.counts;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) {
        const near = levels ? Math.max(0, Math.sqrt(this.nearest[m]!) - this.radiusOfMesh[m]!) : Math.sqrt(this.nearest[m]!);
        const level = levels ? (levels[m] = this.assets.choose(this.assets.table.error[m]!, near, levels[m]!)) : 0;
        if (levels) this.assets.wantTextured(m, level, near);
        else showMaterials(this.assets, m, near);
        this.draw(m, level, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0, flags, cam.passesOf(this.from[m]!, this.to[m]!));
      }
      total += counts[m]!;
    }
    return total;
  }

  /**
   * Draws `count` instances of a mesh at the level the card has nearest to `wanted`: one draw for each of the level's
   * sections when the card has everything its materials take, and otherwise one flat draw of the whole of it. `passes`
   * are the depth ranges it is drawn in (Camera.passes), and a draw in both takes the room of two. A section whose
   * material has its layer on the card draws it at `layer`. A tree's crown may be drawn at a level of its own, `crown`,
   * and its cut-out leaves at a share, the first of them (tools/pack/sprays.ts): its bark from the level wanted and the
   * rest from the crown's, while both are drawn with their materials, else all of it at the crown's.
   */
  private draw(mesh: number, wanted: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, passes: number, hand = 0, layer = 0, crown = wanted, leaves = 1): void {
    const p = this.packet;
    const n = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (n + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    let lod = this.drawable(mesh, wanted, flags);
    if (lod < 0) {
      p.skipped++;
      return;
    }
    const sections = this.assets.table.sections[mesh]!;
    let runs = this.ready ? sections[lod]! : FLAT;
    // The crown's level and its runs; where that level is drawn flat, it draws the whole tree.
    let top = lod, over = runs;
    if ((crown !== wanted || leaves < 1) && this.ready) {
      const c = this.drawable(mesh, Math.max(crown, lod), flags);
      if (c >= 0) {
        top = c;
        over = this.ready ? sections[c]! : FLAT;
        if (!this.ready) {
          lod = c;
          runs = FLAT;
        }
      }
    }
    const parts = this.parts(over, runs, top !== lod, leaves);
    const draws = parts.length / 4;
    // A mesh the frame has no room for all of is left out whole.
    if (n + this.doubled + draws * copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    const slot = this.assets.residency.slot(mesh, lod);
    const topSlot = top === lod ? slot : this.assets.residency.slot(mesh, top);
    let tris = 0, crowns = 0;
    for (let k = 0; k < draws; k++) {
      const d = n + k;
      const material = parts[k * 4]!, trunk = parts[k * 4 + 1] === 1, from = parts[k * 4 + 2]!, indices = parts[k * 4 + 3]!;
      this.passOf[d] = passes;
      p.drawMesh[d] = mesh;
      p.drawLod[d] = trunk ? lod : top;
      p.drawSlot[d] = trunk ? slot : topSlot;
      p.drawBuffer[d] = buffer;
      p.drawFirst[d] = first;
      p.drawInstances[d] = count;
      p.drawOffset[d * 3] = ox;
      p.drawOffset[d * 3 + 1] = oy;
      p.drawOffset[d * 3 + 2] = oz;
      p.drawFlags[d] = flags | (material < 0 ? this.flatFlags[mesh]! : this.materialFlags[material]!);
      p.drawHand[d] = hand;
      p.drawLayer[d] = layer > 0 && material >= 0 && this.assets.layered(material) ? layer : 0;
      const made = material < 0 ? this.trisOfMesh[mesh]![top]! : indices / 3;
      tris += made;
      if (material < 0 || this.barkOf[material] === 0) crowns += made;
      if (material < 0) continue;
      p.drawMaterial[d] = material;
      p.drawFirstIndex[d] = from;
      p.drawIndexCount[d] = indices;
    }
    p.drawCount = n + draws;
    this.doubled += draws * (copies - 1);
    p.triangles += tris * count * copies;
    if (this.treeOf[mesh] === 1) this.budget.crowns += crowns * count * copies;
  }

  /** Scratch for the draws of a level, four numbers each: material, 1 if from the trunk's level, first index, indices. */
  private readonly drawParts: number[] = [];

  /**
   * The draws of a level's runs `over`: with `split`, a bark run from the trunk's `runs` in its place; cut-out runs to
   * the first `leaves` of their triangles, and none where that is none.
   */
  private parts(over: readonly number[], runs: readonly number[], split: boolean, leaves: number): readonly number[] {
    const out = this.drawParts;
    out.length = 0;
    for (let k = 0; k < over.length; k += 3) {
      const material = over[k]!;
      let trunk = 0, from = over[k + 1]!, indices = over[k + 2]!;
      if (split && material >= 0 && this.barkOf[material] === 1) {
        for (let j = 0; j < runs.length; j += 3) {
          if (runs[j] !== material) continue;
          trunk = 1;
          from = runs[j + 1]!;
          indices = runs[j + 2]!;
        }
      }
      if (leaves < 1 && material >= 0 && (this.materialFlags[material]! & DRAW_CUTOUT) !== 0) indices = Math.floor((indices / 3) * leaves) * 3;
      if (material < 0 || indices > 0) out.push(material, trunk, from, indices);
    }
    return out;
  }

  /** Whether the level `drawable` last gave is drawn with its materials. */
  private ready = false;

  /**
   * The level of a mesh to draw for `wanted`, or -1: the nearest held, and while that cannot be drawn with its materials
   * a finer one that can, so that a thing does not turn flat on its way from one level to the next. What is see-through
   * is drawn flat. Sets `ready`.
   */
  private drawable(mesh: number, wanted: number, flags: number): number {
    let lod = this.assets.level(mesh, wanted);
    this.ready = false;
    if (lod < 0) return -1;
    const sections = this.assets.table.sections[mesh]!;
    const solid = (flags & DRAW_BLEND) === 0;
    this.ready = solid && this.assets.textured(mesh, lod);
    if (solid && !this.ready && sections[wanted < sections.length ? wanted : sections.length - 1]!.length > 0) {
      for (let l = lod - 1; l >= 0 && !this.ready; l--) if ((this.ready = this.assets.textured(mesh, l))) lod = l;
    }
    return lod;
  }

  /**
   * The depth ranges of the characters' draws from `from` on, which are drawn on bones. Each instance is placed by its
   * first bone, and nothing of it reaches farther from where that bone puts its origin than its mesh, its offset and
   * `bodySlack`, stretched as the bone stretches. A draw found to be in both takes the room of two, or stays near.
   */
  private bodyPasses(cam: Camera, from: number): void {
    const p = this.packet;
    const b = p.bones;
    const f32 = this.transientF32;
    const u16 = this.transientU16;
    const fx = cam.viewProj[3]!, fy = cam.viewProj[7]!, fz = cam.viewProj[11]!;
    for (let d = from; d < p.drawCount; d++) {
      const first = p.drawFirst[d]!;
      // The sections of a level are drawn from the same instances.
      if (d > from && first === p.drawFirst[d - 1] && p.drawMesh[d] === p.drawMesh[d - 1]) {
        this.passOf[d] = this.passOf[d - 1]!;
        continue;
      }
      const r = this.radiusOfMesh[p.drawMesh[d]!]! + this.bodySlack;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = first; i < first + p.drawInstances[d]!; i++) {
        const o = u16[i * 10 + 6]! * BONE_FLOATS;
        const w = fx * b[o + 3]! + fy * b[o + 7]! + fz * b[o + 11]!;
        const gx = fx * b[o]! + fy * b[o + 4]! + fz * b[o + 8]!;
        const gy = fx * b[o + 1]! + fy * b[o + 5]! + fz * b[o + 9]!;
        const gz = fx * b[o + 2]! + fy * b[o + 6]! + fz * b[o + 10]!;
        const reach = Math.sqrt(gx * gx + gy * gy + gz * gz) * (r + Math.hypot(f32[i * 5]!, f32[i * 5 + 1]!, f32[i * 5 + 2]!));
        if (w - reach < lo) lo = w - reach;
        if (w + reach > hi) hi = w + reach;
      }
      let passes = cam.passesOf(lo, hi);
      if (passes === (NEAR | FAR)) {
        let sections = 1;
        while (d + sections < p.drawCount && p.drawFirst[d + sections] === first && p.drawMesh[d + sections] === p.drawMesh[d]) sections++;
        if (p.drawCount + this.doubled + sections > MAX_DRAWS) {
          p.dropped++;
          passes = NEAR;
        } else {
          this.doubled += sections;
          p.triangles += this.trisOfMesh[p.drawMesh[d]!]![p.drawLod[d]!]! * p.drawInstances[d]!;
        }
      }
      this.passOf[d] = passes;
    }
  }
}

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

export { bodySeed };
