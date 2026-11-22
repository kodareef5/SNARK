import type { TideEyeSite } from "../../../shared/world/tide-eye.ts";
import { writeEyeSky } from "./tide-eye.ts";
import { TreeFalls } from "../tree-fall.ts";
import { EYE_FROM } from "../optics.ts";
import type { TreePresentationEvent } from "../vehicle-trees.ts";
import { IMPALE_SLOT, MAX_SEATS } from "../../../shared/sim/seats.ts";
import { remoteVehiclePose } from "../vehicle-view.ts";
// Structures are drawn per chunk and per mesh as instanced batches. A chunk's instance buffer is rebuilt only when a
// piece is added, removed or replaced, and uploaded once. Damage changes nothing that is drawn. Resource nodes are drawn
// the same way, each as the mesh of its form (shared/world/nodes.ts) at its size.

import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE, CHUNK_SIZE, YAW_UNITS, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { Assets } from "../assets/assets.ts";
import type { AssetPort } from "../assets/port.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, type Pack } from "../../../shared/pack/pack.ts";
import { atlasBytes } from "../../../shared/pack/details.ts";
import { SKY_COLOR, WATER_COLOR } from "../../../shared/pack/palette.ts";
import { floatingKinds, landmarkKinds } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import { SIZE_UNITS, nodeForms } from "../../../shared/world/nodes.ts";
import { LOOK_BYTES } from "../../../shared/anim/look.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { AnimState, CUE_DEAD, CUE_HELD, PITCH_STEPS, bodySeed } from "../../../shared/anim/pose.ts";
import { SEAT_FLOATS } from "../../../shared/anim/seat.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { sortU32 } from "../../../shared/sort.ts";
import { Details } from "../details/details.ts";
import { DEFAULT_FINISH_GLOSS, DEFAULT_ROAD_FINISH } from "../settings.ts";
import { StreetDraws } from "./street-draws.ts";
import { streetTextureBytes } from "./street-finish.ts";
import { StreetReflections } from "./street-reflections.ts";
import { StreetLamps } from "./street-lamps.ts";
import { DamageNumbers } from "./damage-numbers.ts";
import { StreetWires } from "./street-wires.ts";
import type { Falling } from "../rubble.ts";
import type { ShotEnd } from "../occasions.ts";
import type { Shots } from "../shots.ts";
import type { SupplyView } from "../supply.ts";
import { writeDropSky } from "./supply-sky.ts";
import type { RemoteSample } from "../session.ts";
import type { CameraBody } from "../camera-body.ts";
import { farPlane, type Camera } from "./camera.ts";
import { Characters, riderFitScratch, seatScratch, type RiderFit, showMaterials, type VehicleRenderPose, type VehicleSeatPose } from "./characters.ts";
import { exhaustPhase } from "./suit-finish.ts";
import { Clouds } from "./clouds.ts";
import { Dropped } from "./dropped.ts";
import { CITY_BUFFER, FAR_BUFFER, FAR_MESH, FarBlocks, farColours, type FarSource } from "./far.ts";
import { FrameBudget, coverScale, crownScale, leavesAt, thinning } from "./budget.ts";
import type { FarCity, CitySource } from "./farcity.ts";
import type { CityBlocks, BlocksSource } from "./cityblocks.ts";
import type { RoofMap } from "./roofmap.ts";
import { FarLandmarks, LANDMARK_BUFFER } from "./farlandmarks.ts";
import { CrownCover, coverDistance, type CoverLooks, type CoverRule } from "./cover.ts";
import { FarNodes, farLevelOf, familyOf, type FarNodeSource, type NodeLooks } from "./farnodes.ts";
import { HAND_NEAR } from "./hand.ts";
import { HIDE_PIXELS, Hiding, OCCLUDER } from "./hide.ts";
import { MESH_SLOT, NearCity, type NearMesh } from "./nearcity.ts";
import { DOOR_FRONTIER, DOOR_OPEN, RoomFinder, Rooms } from "./rooms.ts";
import { OPTIC_AT, OPTIC_HEAT } from "./packet.ts";
import { BEND_BUFFERS, BONE_FLOATS, GLASS_AT, DRAW_BENT, DRAW_BLEND, DRAW_CUTOUT, DRAW_GROUND, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_PULLED, DRAW_RANGED, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, FRAME, FramePacket, InstanceWriter, MAX_BONES, MAX_CASCADES, MAX_DRAWS, MAX_TILES, PASS_FAR, PASS_NEAR, TILE_CASTS, TILE_QUADS, TRANSIENT_BUFFER, markJoins, texturedFlags, quadIndexCount, SHORE_AT } from "./packet.ts";
import { MADE_MARK, WorldFinishes, citySurface, finishTaps, surfaceCity, weatherBytes } from "./world-surfaces.ts";
import { recipeIndex } from "../../../content/texgen/finishes.ts";
import { FinishNear, NEAR_FRONT, NEAR_GLASS, NEAR_WALL } from "./finish-near.ts";
import { FacadeAtlases } from "./facade.ts";
import { UNDERWATER_DIM, UNDERWATER_VIEW } from "./shading.ts";
import { FADE_FROM, FADE_SHARE, SKY_ASKED, SKY_MATERIAL, VIEW_FADE, airFrame } from "./atmosphere.ts";
import { FarShadow } from "./farshadow.ts";
import { Cascades } from "./shadow.ts";
import { shadowBytes } from "./shadowtext.ts";
import { LAMP_BIT, LampView } from "./lamp.ts";
import { ParkedContacts, contactFrame } from "./contact.ts";
import { lightBytes, lightSamples, opticFrame, postFrame, sceneSize, type Optic } from "./post.ts";
import { lampsOn, skyShown } from "./surface.ts";
import { SKY_SIZE, SKY_SLICES, flatLight, skyFrame, theSky } from "./sky.ts";
import { TerrainLod } from "./terrain.ts";
import { bendOf, type MapLandmark } from "../../../shared/world/mapfile.ts";
import { KERB_BACK } from "../../../shared/world/bends.ts";
import { landmarkFars } from "../../../shared/pack/far.ts";
import type { MotionSource } from "./motion.ts";
import { Frame, walk, type Pass } from "./pass.ts";
import { Casting } from "./casting.ts";
import { SupplyDrops } from "./passes/supply-drops.ts";
import { TideEyes } from "./passes/tide-eyes.ts";
import { Water } from "./passes/water.ts";
import { MovingStatics } from "./passes/moving-statics.ts";
import { Beams } from "./passes/beams.ts";
import { Ghost } from "./passes/ghost.ts";
import { Things, type Thing } from "./passes/things.ts";
import { CUTOUTS, Draws, NEAR_BUCKETS, type Cutouts } from "./draws.ts";
import type { Tier } from "../assets/tiers.ts";

export interface RenderWorld {
  /** Chooses the data-defined city surface palette; no terrain or geometry changes. */
  readonly mapId?: string;
  readonly tideEyes?: readonly TideEyeSite[];
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
  /** The map's tops as they come, of which the city past what the far city draws is drawn as blocks (cityblocks.ts). */
  readonly tops?: BlocksSource;
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

/** Metres the far depth range of a frame with one begins at, through a sight: the lit tiers' split (tiers.ts). */
const WINDOW_SPLIT = 384;
/** The zoom from which a sight's focus has the terrain's fine window, the ground round the body unseen (D1087). */
const TERRAIN_FOCUS = 8;
/** Metres up and down a chunk's column is taken to reach, to ask whether a sight's window sees it. */
const CHUNK_COLUMN = 1000;
const MISSING_MESH = "core:missing";
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
const QUAD_INDICES = "quad indices";
/** Numbers a run of cells takes in `runs` (Scene.ranges), and in `castRuns` (Scene.castChunk). */
const RUN = 13;
const CAST_RUN = 5;
/** Milliseconds a chunk's doors stand other than its rooms were found with before they are found again. */
const SETTLE = 2000;
/** A node form with nothing to draw: what is left of a used-up node whose mesh no pack has. */
const HIDDEN = 0xffff;
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
const NO_SHOTS: readonly ShotEnd[] = [];
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

/** Metres round the camera within which Scene.nearPiece finds the nearest piece. */
const CLEAR = 8;
/** Metres over the lowest ground drawn a tile's ground must stand for the box under it to be put in the picture. */
const RELIEF = 2;



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
  /** For trees that swap levels (Scene.swapOf): the crown and trunk levels a cell was last drawn at and when, and the levels it is changing from and since when; -1 for none. */
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
  /** Per cell, 1 where its mesh has faces in view this frame (Scene.meshCells). */
  inView: Uint8Array;
  /**
   * Per instance, its bend where its kind is bent (bend.ts), eight numbers each, which go up as the buffer BEND_BUFFERS past
   * the instances'; null where none is. `unbent`: built before its chunk's bends were to hand (before its sector's statics
   * came), so built again once they are.
   */
  bends: Int16Array | null;
  unbent: boolean;
}

export class Scene {
  readonly packet = new FramePacket();
  readonly treeFalls = new TreeFalls();
  private readonly hiddenNodes = new Set<number>();
  private readonly hiddenChanged = new Set<number>();
  /** How many crowns stand in the way of a cell of trees (cover.ts), made from the near node field on tiers that ask. */
  readonly cover: CrownCover;
  private readonly coverLooks: CoverLooks;
  hideNode(ref: number, hide: boolean): void {
    if (this.hiddenNodes.has(ref) === hide) return;
    if (hide) this.hiddenNodes.add(ref); else this.hiddenNodes.delete(ref);
    const chunk = Math.floor(ref / 65536); this.hiddenChanged.add(chunk);
    this.world.farNodes?.changes.touch(chunk);
  }
  readonly terrain: TerrainLod;
  /**
   * Metres to the end of the view: the tier's (Tier.viewDistance), or what is set here, as tests and tools hold it. The
   * ground, the sea, lakes, parts and the city's blocks are not drawn past it, the haze and low poly's fog end there, and
   * the camera's far plane is set from it (camera.ts farPlane). The tier's view is a distance along the ground: it grows
   * with the camera's height (alongGround), so flying up does not shrink the ground in view.
   */
  get viewDistance(): number {
    return this.heldView > 0 ? this.heldView : this.alongGround(this.assets.tier.viewDistance);
  }

  /**
   * The distance from the camera that reaches `metres` along the ground below it. Everything is culled by its distance
   * from the eye, a sphere, which meets the ground in a smaller circle the higher the eye is: from 3 km up a 4 km reach
   * met it 2.6 km out.
   */
  alongGround(metres: number): number {
    return Math.hypot(metres, this.lift);
  }

  /** The camera's height over the ground under it, set each frame. */
  private lift = 0;

  /**
   * Metres from the eye where what is drawn starts to fade into the sky, along the ground as the view is: at FADE_SHARE
   * of the tier's view, and no later than FADE_FROM (atmosphere.ts). A view a test or tool holds fades over its last fifth.
   */
  get fadeFrom(): number {
    if (this.heldView > 0) return this.heldView * VIEW_FADE;
    return this.alongGround(Math.min(this.assets.tier.viewDistance * FADE_SHARE, FADE_FROM));
  }

  set viewDistance(metres: number) {
    this.heldView = metres;
  }

  private heldView = 0;
  structureDistance = Infinity;
  /** Hour of the day, 0..24. It sets the sun's position and the brightness. */
  hour = 12;
  /**
   * Where a sight that magnifies is on, x and z (NaN for none), which the app sets: the far trees round it come as if near,
   * and from TERRAIN_FOCUS times the fine ground is round it (D1087).
   */
  focusX = NaN;
  focusZ = NaN;
  /** The near trees' hand-over band's scale this frame: a sight's zoom, else 1 (D1090). */
  private handScale = 1;
  /** What a visor does to the picture this frame (post.ts opticFrame, D1080), which the app sets. */
  readonly optic: Optic = { mode: 0, gain: 1, grain: 0 };
  /** The height of the view in pixels. With the field of view, it says how large a level's error is on screen. */
  viewHeight = 720;
  /** The canvas in its own pixels, which the light target takes and bloom's levels are counted from, and whether it draws more than the screen's own (post.ts). */
  canvasWidth = 1280;
  canvasHeight = 720;
  supersampled = false;
  /** The share of the canvas a side a frame with a light target draws its scene at before the governor's steps (post.ts sceneShare). The app sets it. */
  share = 1;
  /** Whether this frame is drawn with the page's other effects off (FramePacket.alternate). */
  alternate = false;
  /** The time of this frame, in milliseconds, for what the asset library waits on and how far the clouds have blown. */
  now = 0;
  /** Damage numbers (damage-numbers.ts): struck by Feedback, drawn as detail cards over everything else. */
  readonly damage = new DamageNumbers();
  /** On a lit tier, the dome is drawn as the table alone and nothing is hazed, as the rasterizer draws: for checks that hold a GPU to it. */
  plainSky = false;
  /**
   * Where an opaque step's cut-out draws go among its other draws: "last", after them all, so that a tiled GPU can
   * reject the cut-out pixels an opaque surface hides before it shades them; "made", as they were made; "first", before
   * them all, where it can reject none but those the ground hides; "none", left out. The device page sets them side by
   * side, and prices the cut-outs by the last two.
   */
  get cutouts(): Cutouts {
    return this.put.cutouts;
  }
  set cutouts(to: Cutouts) {
    this.put.cutouts = to;
  }
  /**
   * Whether a frame leaves out what something drawn in it wholly hides (hide.ts), and whether an opaque step's draws go
   * nearest first, the ground after them. A page turns either off for a before and after (passes.ts).
   */
  hide = true;
  get nearFirst(): boolean {
    return this.put.nearFirst;
  }
  set nearFirst(on: boolean) {
    this.put.nearFirst = on;
  }
  /** The light of the street lamps that still work (street-lamps.ts). */
  readonly streetLamps: StreetLamps;
  /** The wires between the utility poles still standing (street-wires.ts). */
  readonly streetWires: StreetWires;
  /** What hides what this frame. */
  readonly hiding = new Hiding();

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
  /** Per mesh, DRAW_GROUND where a kind of paint on the ground is drawn with it, which casts no shadow; else 0. */
  private readonly groundFlags: Uint16Array;
  /** Per mesh, DRAW_BENT where a bent kind is drawn with it (bend.ts), else 0; and per kind, 1 for a bent one. */
  private readonly bentFlags: Uint32Array;
  private readonly bentKind: Uint8Array;
  /** The chunks whose bends' buffers the card holds (BEND_BUFFERS). */
  private readonly bendsOnCard = new Set<number>();
  /** Per mesh, what a static's distance is divided by when its level is chosen: 1, or less for a coarse kind's. */
  private readonly reachOfStatic: Float32Array;
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
  /**
   * Per mesh, a standing tree's levels that cut out its leaves, a bit each (a palm's fronds among them); 0 for any other
   * mesh, a car whose glass cuts out or a bush (Scene.castable).
   */
  private readonly foliageOf: Uint16Array;
  private readonly barkOf: Uint8Array;
  /** What a frame may spend, what it has, and the squeeze crowns near are drawn at (budget.ts). */
  readonly budget = new FrameBudget();
  /** Per mesh, 1 for a standing tree's, whose crown gives to the budget and whose trunk does not. */
  private readonly treeOf: Uint8Array;
  /**
   * Per mesh, the flags a draw of it in palette colours carries besides its own: DRAW_PLAIN for a landmark's, whose flat
   * levels are its art's own colours and take neither the world finish nor the checker, and for a vehicle's that a static
   * draws (a marina's moored hulls, content/docks.ts), as the vehicle itself is drawn.
   */
  readonly flatFlags: Uint16Array;
  /** Per structure kind, five bytes: the palette colours of its mesh's regions 1 to 5 (StructureDef.colors), 0 where it gives none. */
  private readonly regionsOfKind: Uint8Array;
  /** Per mesh and level, the triangles of its sections drawn with bark and of its cut-out ones. */
  private readonly trunkTris: number[][];
  private readonly leafTris: number[][];
  private readonly streetDraws: StreetDraws;
  readonly street: StreetReflections;
  finishGloss = DEFAULT_FINISH_GLOSS;
  roadFinish = DEFAULT_ROAD_FINISH;
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
  /** Chunks of the near store whose mesh has a draw this frame; per chunk that casts, its casters from and to and its shadow's box. */
  private readonly meshDrawn = new Set<number>();
  private readonly chunkCasts: number[] = [];
  /** The chunks whose meshes are drawn once the frame knows what hides what: each its id, corner from the camera and depth ranges. */
  private readonly later: number[] = [];
  /** The shadow's reach `zones` found for the chunk it was last given. */
  private zoneStretch = 0;
  /** The farthest any body's posed vertex gets from where its first bone puts its origin, short of its own mesh and offset. */
  private readonly bodySlack: number;
  private readonly transient: InstanceWriter;
  private readonly transientF32: Float32Array;
  private readonly transientU16: Uint16Array;
  /** The materials whose pictures the dome and the sea draw, or -1 where the pack has none. */
  private readonly skyMaterial: number;
  private readonly finishes: WorldFinishes;
  /** How near the eye each finish, wall, front and glass comes, which sizes what the finishes and the facades ask for. */
  readonly finishNear: FinishNear;
  private readonly facades: FacadeAtlases;
  readonly characters: Characters;
  private readonly vehicleSeats: (VehicleSeatPose | undefined)[] = new Array(MAX_VIEW);
  /** What vehicleSeats points into, a pose a slot, and the own body's seat. */
  private readonly seatPoses: VehicleSeatPose[] = [];
  private readonly ownSeat = seatScratch();
  private readonly ownRiderFit = riderFitScratch();
  private readonly riderFits: (RiderFit | undefined)[] = [];
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
  /** A kind's mesh's half length along its way, 0 until its bounds have come: what contact takes a long body's length from. */
  private readonly halfLength = (kind: number): number => {
    const m = this.meshOfKind[kind];
    return m === undefined || m === HIDDEN ? 0 : (this.assets.manifest.meshes[m]?.half[2] ?? 0);
  };
  /** What contact reads of the registry: bodies' sizes and vehicles' (contact.ts). */
  private readonly parkedContacts: ParkedContacts;
  private readonly sizes: Pick<Registry, "bodyRadius" | "bodyHeight" | "vehicle">;
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
  private readonly drawBody = (mesh: number, lod: number, first: number, count: number, flags: number, layer: number, standIn: number): void => this.put.draw(mesh, lod, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, NEAR, 0, layer);
  /** Bases drawn as blocks where the near store does not hold their chunks whole, given a far source and the far mesh. */
  private readonly far: FarBlocks | null;
  /** Nodes past the near node field, given a source of them. */
  readonly nodesFar: FarNodes | null;
  /** The map's own buildings where the near store does not hold their chunks whole, given a source of them. */
  city: FarCity | null = null;
  /** The world's statics the far city was made of. */
  private citySource: CitySource | null = null;
  /** With the far city, the near store's chunks' statics drawn flat as their form as a mesh a chunk (nearcity.ts). */
  readonly near: NearCity | null;
  /** Whether a chunk the near store holds whole draws such statics from its mesh; false draws them as instances, for pictures held to them. */
  nearMesh = true;
  /** The map's landmarks where the near store does not hold their pieces' chunks whole, with the far city. */
  landmarks: FarLandmarks | null = null;
  /** The city past what the far city and the far blocks draw, as blocks from its tops, given them and the far mesh. */
  blocks: CityBlocks | null = null;
  /** What the city's blocks are made from, until the late code (city-late.ts) has come to make them. */
  private blocksFrom: { tops: BlocksSource; colours: Uint8Array } | null;
  /** The far city and the city's blocks, once city-late.ts has loaded. Until then a scene draws neither. */
  static late: { FarCity: typeof FarCity; CityBlocks: typeof CityBlocks; RoofMap: typeof RoofMap } | null = null;
  /** Per content index, 1 for a kind a landmark brings, which the far city leaves to the landmark's far mesh. */
  private readonly landmarkKinds: Uint8Array;
  /** Per content index, 1 for a kind that stands in the air with nothing under it, which casts no far shadow (city.ts floatingKinds). */
  private readonly floatingKinds: Uint8Array;
  private readonly farMesh: number;
  private readonly farBounds: { center: readonly number[]; half: readonly number[] } | undefined;
  farShadow: FarShadow | null = null;
  /** Bodies out of view whose shadows may fall in it: which remote entity each is, and its place (x, y, z, yaw). */
  private readonly unseenFrom = new Uint16Array(MAX_VIEW);
  private readonly unseenAt = new Float64Array(MAX_VIEW * 4);
  private readonly unseenMount = new Int16Array(MAX_VIEW);
  /** Linear RGB of the open sky and of deep water. */
  /** The pack's colours, four bytes each, which the map of what stands overhead takes the ground's colour from (roof.ts). */
  private readonly groundPalette: Uint8Array;
  private readonly skyColor = new Float32Array(3);
  private readonly deepColor = new Float32Array(3);
  /** The nearest and farthest depth the clouds' puffs reach this frame. */
  private readonly cloudRange = [0, 0];
  /** What the passes read of the frame, filled by `begin`; the passes in the frame's order; and their hooks, each a walk of them. */
  private readonly frame: Frame;
  /** The packet's writer: every draw of the frame goes through it (draws.ts). */
  readonly put: Draws;
  /** Sun shadows: the cascades and the lamp's view fitted this frame, what casts into them, and the casters (casting.ts). */
  readonly casting: Casting;
  /** The tide eyes (passes/tide-eyes.ts), whose clock and directed poses the app sets here. */
  private readonly eyes: TideEyes;
  get eyeSeconds(): number { return this.eyes.seconds; }
  set eyeSeconds(s: number) { this.eyes.seconds = s; }
  get eyeIndexOffset(): number { return this.eyes.indexOffset; }
  set eyeIndexOffset(a: number) { this.eyes.indexOffset = a; }
  get sextantScale(): number { return this.eyes.sextantScale; }
  set sextantScale(s: number) { this.eyes.sextantScale = s; }
  get eyeHold(): number | null { return this.eyes.hold; }
  set eyeHold(s: number | null) { this.eyes.hold = s; }
  /** The sea and the lakes (passes/water.ts). */
  private readonly waters: Water;
  /** The map's moving statics' parts (passes/moving-statics.ts). */
  private readonly movingStatics: MovingStatics;
  /** Beams over places to mark, the piece about to be built, and loose meshes, each a pass, which the app sets through these. */
  private readonly marks: Beams;
  private readonly placing: Ghost;
  private readonly loose: Things;
  get beams(): number[] { return this.marks.beams; }
  get ghost(): Ghost["ghost"] { return this.placing.ghost; }
  get things(): Thing[] { return this.loose.things; }
  set things(list: Thing[]) { this.loose.things = list; }
  /** The supply drops live on the map (passes/supply-drops.ts), and the kind of the server's prop its model stands in for, or -1. */
  private readonly supplyDrops: SupplyDrops;
  private readonly capsuleKind: number;
  get supply(): SupplyView | null { return this.supplyDrops.view; }
  set supply(view: SupplyView | null) { this.supplyDrops.view = view; }
  get cascades(): Cascades {
    return this.casting.cascades;
  }
  get lamp(): LampView {
    return this.casting.lamp;
  }
  get sunAt(): Float64Array {
    return this.casting.sunAt;
  }
  /** Whether the moon casts through the cascades by night where the tier's shadows say it may, which a bench turns off every other frame (`?ab=moon`). */
  get moonShadows(): boolean {
    return this.casting.moonShadows;
  }
  set moonShadows(on: boolean) {
    this.casting.moonShadows = on;
  }
  readonly passes: readonly Pass[];
  private readonly hooks: Required<Pass>;

  /** With `stream`, `pack` is the boot pack and other levels are asked of the port as they are wanted. */
  /** `opts.farPalms`: the far store draws palms as their frond level, not their solid, for a bench's comparison (farLevelOf). */
  constructor(world: RenderWorld, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort; pages?: readonly Uint8Array[] }, opts: { farPalms?: boolean } = {}) {
    this.world = world;
    this.groundPalette = pack.palette;
    this.terrain = new TerrainLod(world.hf);
    this.assets = new Assets(reg, pack, stream?.manifest, stream?.port, stream?.pages);
    // The renderer holds the sky table on every tier.
    this.assets.residency.reserve("sky table", SKY_SIZE * SKY_SIZE * SKY_SLICES * 4);
    const { table, bind } = this.assets;
    const missing = Math.max(0, table.find(MISSING_MESH));
    this.meshOfKind = new Uint16Array(reg.defs.length).fill(missing);
    this.colorOfKind = new Uint8Array(reg.defs.length);
    this.speciesKind = Uint8Array.from(reg.defs, (d) => d?.type === "species" ? 1 : 0);
    this.pitched = Uint8Array.from(reg.defs, (d) => (d?.type === "prop" && d.pitched ? 1 : 0));
    this.birthScale = reg.birthScale;
    this.saddleSeats = reg.saddleSeats;
    this.sizes = reg;
    this.parkedContacts = new ParkedContacts(reg);
    this.groundFlags = new Uint16Array(table.count);
    this.bentFlags = new Uint32Array(table.count);
    this.bentKind = Uint8Array.from(reg.defs, (d) => (d?.type === "structure" && d.bent ? 1 : 0));
    this.reachOfStatic = new Float32Array(table.count).fill(1);
    this.regionsOfKind = new Uint8Array(reg.defs.length * 5);
    const vehicleMeshes = new Set<number>();
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
      if (mesh >= 0 && d.type === "structure" && d.paint) this.groundFlags[mesh] = DRAW_GROUND;
      if (mesh >= 0 && d.type === "structure" && d.bent) this.bentFlags[mesh] = DRAW_BENT;
      // A static whose levels are chosen farther off than it stands: every static of its mesh is (StructureDef.coarse).
      if (mesh >= 0 && d.type === "structure" && d.coarse) this.reachOfStatic[mesh] = Math.min(this.reachOfStatic[mesh]!, 1 / d.coarse);
      if (d.type === "structure" && d.colors) this.regionsOfKind.set(d.colors, k * 5);
      // A piece of a material made from a recipe, drawn as an instance, says it in its last two regions: MADE_MARK, which
      // is no colour, then the recipe's number (world-surfaces.ts worldVertex). Such a piece's mesh has no regions of its own.
      if (d.type === "structure" && d.recipe && !d.colors) {
        this.regionsOfKind[k * 5 + 3] = MADE_MARK;
        this.regionsOfKind[k * 5 + 4] = recipeIndex(d.recipe);
      }
      if (mesh >= 0 && d.type === "structure" && d.mesh !== "shape") {
        const of = reg.defs[reg.index.get(d.mesh) ?? 0];
        if (of?.type === "species" && of.vehicle) vehicleMeshes.add(mesh);
      }
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
    this.cover = new CrownCover(world.dims);
    this.coverLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, treeOf: this.treeOf, side: table.side, low: table.low, high: table.high, hidden: (ref) => this.hiddenNodes.has(ref) };
    this.streetDraws = new StreetDraws(stream?.manifest ?? pack.header, pack.header.rigs);
    this.street = new StreetReflections(reg, pack.palette, forms, { meshes: (stream?.manifest ?? pack.header).meshes, kinds: this.meshOfKind, forms: this.meshOfForm });
    // A landmark's definitions and meshes are in its namespace, and its definitions are the map's own (withContent).
    const landmarks = new Set([...reg.own].map((k) => reg.defs[k]!.id.split(":")[0]));
    this.landmarkKinds = landmarkKinds(reg);
    this.floatingKinds = floatingKinds(reg);
    this.flatFlags = Uint16Array.from(this.assets.manifest.meshes, (m, mesh) => (landmarks.has(m.id.split(":")[0]) ? DRAW_PLAIN | (m.seeThrough ? DRAW_BLEND : 0) : vehicleMeshes.has(mesh) ? DRAW_PLAIN : 0));
    this.trisOfMesh = table.tris;
    this.radiusOfMesh = table.radius;
    this.materialFlags = new Uint8Array(table.materials.length);
    this.barkOf = new Uint8Array(table.materials.length);
    this.trunkTris = table.sections.map(() => []);
    this.leafTris = table.sections.map(() => []);
    this.foliageOf = new Uint16Array(table.sections.length);
    this.learn(table.sections.map((_, mesh) => mesh));
    this.casting = new Casting(this.packet, this.assets, this.terrain, this.hiding, { materialFlags: this.materialFlags, bentFlags: this.bentFlags, trisOfMesh: this.trisOfMesh, radiusOfMesh: this.radiusOfMesh, foliageOf: this.foliageOf });
    this.put = new Draws(this.packet, this.assets, this.budget, { groundFlags: this.groundFlags, bentFlags: this.bentFlags, flatFlags: this.flatFlags, materialFlags: this.materialFlags, barkOf: this.barkOf, treeOf: this.treeOf, trisOfMesh: this.trisOfMesh });
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
    this.streetLamps = new StreetLamps(reg);
    this.casting.join(this.characters, this.streetLamps);
    this.streetWires = new StreetWires(reg);
    this.details = new Details(reg, pack.header.details, pack.palette, (kind) => this.characters.creature(kind), (id, kind, tick) => this.characters.drawnGait(id, kind, tick), (id, kind, tick) => this.characters.drawnPose(id, kind, tick));
    if (pack.header.details) this.assets.residency.reserve("details atlas", atlasBytes(pack.header.details.atlas.side));
    this.clouds = new Clouds(reg, pack.header.details, pack.palette);
    this.waters = new Water(world, reg, this.assets, this.packet, this.put, this.terrain);
    this.eyes = new TideEyes(this.assets);
    this.movingStatics = new MovingStatics(reg, this.assets, this.flatFlags, this.landmarkKinds);
    this.marks = new Beams(this.assets);
    this.placing = new Ghost(this.assets, this.meshOfKind);
    this.loose = new Things(this.assets);
    this.supplyDrops = new SupplyDrops(reg, this.assets, pack.palette, this.details);
    this.capsuleKind = this.supplyDrops.kind;
    this.characters.thrusterPlumes.pictures(pack.header.details);
    this.dropped = new Dropped(reg, bind);
    let reach = 0;
    for (let k = 1; k < reg.defs.length; k++) if (this.characters.has(k)) reach = Math.max(reach, this.characters.reach(k));
    this.bodySlack = reach * 2;

    const far = (this.farMesh = table.find(FAR_MESH));
    this.farBounds = far >= 0 ? this.assets.manifest.meshes[far] : undefined;
    // A build works the colours out from every piece. Without them, they are worked out from the pieces the pack holds.
    const shown = (k: number): number => (this.meshOfKind[k] === missing || this.meshOfKind[k] === HIDDEN ? -1 : (pack.meshIndex.get(this.assets.manifest.meshes[this.meshOfKind[k]!]!.id) ?? -1));
    const listed = this.assets.manifest.farColours;
    const colours = this.farBounds && (world.far || world.tops) ? (listed ? Uint8Array.from(listed) : farColours(reg, pack, shown)) : null;
    this.far = world.far && colours ? new FarBlocks(world.far, world.dims, world.hf, far, this.farBounds!, colours) : null;
    this.blocksFrom = world.tops && colours ? { tops: world.tops, colours } : null;
    this.makeBlocks();
    const flat = (k: number): boolean => this.meshOfKind[k] !== missing && this.meshOfKind[k] !== HIDDEN && table.sections[this.meshOfKind[k]!]!.every((runs) => runs.length === 0);
    this.near = this.farBounds ? new NearCity(reg, far, this.landmarkKinds, flat) : null;
    this.startCity();
    const last = (mesh: number): ReturnType<NodeLooks["last"]> => this.assets.residency.heldGeometry(mesh, farLevelOf(this.assets.manifest.meshes[mesh]!.id, table.tris[mesh]!, opts.farPalms ?? false));
    const looks: NodeLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, colorOfForm: this.colorOfForm, side: table.side, low: table.low, high: table.high, tris: table.tris, last, known: (mesh) => this.assets.known(mesh) };
    if (world.farNodes) world.farNodes.hidden = ref => this.hiddenNodes.has(ref);
    this.nodesFar = world.farNodes ? new FarNodes(world.farNodes, world.far?.cells ?? null, world.dims, reg, looks) : null;
    this.finishes = new WorldFinishes(table.materials, this.assets.manifest.textures ?? []);
    this.finishNear = new FinishNear(reg, surfaceCity(world.mapId ?? "default") === "las-vegas");
    this.facades = new FacadeAtlases(table.materials, world.mapId ?? "default");
    citySurface(this.packet.surfaceCity, world.mapId ?? "default");
    this.skyMaterial = table.materials.findIndex((m) => m.id === SKY_MATERIAL);
    for (let k = 0; k < 3; k++) {
      this.skyColor[k] = pack.palette[SKY_COLOR * 4 + k]! / 255;
      this.deepColor[k] = (pack.palette[WATER_COLOR * 4 + k]! / 255) * UNDERWATER_DIM;
    }
    this.frame = new Frame(this.packet, world, this.assets, this.budget, this.put, this.casting, this.transient);
    this.passes = this.rows();
    this.hooks = walk(this.passes);
  }

  /** Works out what the scene keeps of the materials, and of each mesh given, whose row is here. */
  private learn(meshes: readonly number[]): void {
    const table = this.assets.table;
    table.materials.forEach((m, k) => {
      this.materialFlags[k] = texturedFlags(m.flags);
      this.barkOf[k] = m.id.endsWith("bark") ? 1 : 0;
    });
    const part = (mesh: number, keep: (material: number) => boolean): number[] => table.sections[mesh]!.map((runs) => runs.reduce((n, _, k) => (k % 3 === 0 && keep(runs[k]!) ? n + runs[k + 2]! / 3 : n), 0));
    for (const mesh of meshes) {
      this.trunkTris[mesh] = part(mesh, (m) => this.barkOf[m] === 1);
      const leaves = (this.leafTris[mesh] = part(mesh, (m) => (this.materialFlags[m]! & DRAW_CUTOUT) !== 0));
      // A standing tree's levels that cut out its leaves, a bit each.
      if (this.treeOf[mesh] === 1) this.foliageOf[mesh] = leaves.reduce((bits, n, l) => (n > 0 ? bits | (1 << l) : bits), 0);
    }
    // A mesh learnt has its extents now, which the crowns' grid is made from. Learnt first before the grid is made.
    if (meshes.length > 0 && this.cover) this.cover.stale = true;
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
    this.waters.reset();
    this.blocks?.reset();
    this.casting.cascades.clear();
    this.farShadow?.reset();
  }

  private charactersPrepared = false;

  /** Only the controlled native mount, whose full pose has reserved bones even under frame pressure. */
  prepareCameraBody(own: OwnBody): CameraBody | null {
    if (!this.charactersPrepared) {
      this.characters.clock = this.shotTick;
      this.characters.begin(this.packet, this.world);
    }
    this.charactersPrepared = true;
    return this.characters.prepareCameraBody(own.kind, own.id, own.generation ?? 0, own.x, own.y, own.z, own.yaw, own.state, own.tick);
  }

  /**
   * A frame: its values are set and the ground chosen (`begin`), each pass brings what it holds up to date and then each
   * draws, in the order of `passes`; the draws are put in the order of their steps, and the frame is closed.
   */
  build(cam: Camera, remote: RemoteSample | null, focus?: readonly number[], loadTime = this.now): FramePacket {
    const f = this.begin(cam, remote, focus, loadTime);
    this.hooks.update(f);
    this.hooks.draw(f);
    this.put.order();
    const p = this.packet;
    this.streetDraws.write(p);
    markJoins(p);
    // The frame's count, from which the next frame's crowns near take their squeeze.
    this.budget.end(this.now, p.triangles, p.drawCount);
    this.assets.end(p, loadTime);
    return p;
  }

  /** Starts the packet and sets what every pass reads: the camera's ranges, the tier, the light, the cascades, the air and the ground in view. */
  private begin(cam: Camera, remote: RemoteSample | null, focus: readonly number[] | undefined, loadTime: number): Frame {
    const p = this.packet;
    p.beginFrame();
    for (const chunk of this.hiddenChanged) { const batch = this.batches.get(NODE_BUFFERS + chunk); if (batch) batch.shape = -1; }
    if (this.hiddenChanged.size > 0) this.cover.stale = true;
    this.hiddenChanged.clear();
    this.put.begin();
    this.hiding.on = false;
    this.meshDrawn.clear();
    this.closes.clear();
    this.chunkCasts.length = 0;
    this.later.length = 0;
    // Low poly's one depth range resolves about 2 m at 3 km, which a sight magnifies into the picture: through one, it
    // splits as the lit tiers do (D1077).
    cam.split = p.split = this.assets.tier.split > 0 ? this.assets.tier.split : cam.zoom > EYE_FROM ? WINDOW_SPLIT : 0;
    this.lift = Math.max(0, cam.y - this.world.hf.heightAt(cam.x, cam.z));
    cam.far = farPlane(this.viewDistance);
    cam.update();
    this.assets.begin(loadTime, this.viewHeight, cam.fovY);
    if (focus) for (const mesh of focus) if (this.assets.known(mesh)) this.assets.wantTextured(mesh, 0, 1);
    if (this.assets.residency.learned.length > 0) this.learn(this.assets.residency.learned);
    this.budget.begin(this.assets.tier);
    p.tier = this.assets.tier;
    p.lit = p.tier.lit;
    p.room = p.tier.post ? this.share : 1; p.share = p.tier.post ? this.share * (p.tier.post.scale ?? 1) : 1;
    p.viewProj.set(cam.split > 0 ? cam.ranges[PASS_NEAR] : cam.viewProj);
    const win = cam.window, windowed = cam.windowed;
    for (let k = 0; k < 4; k++) p.window[k] = windowed ? win[k]! * 0.5 + 0.5 : 0;
    p.farViewProj.set(cam.ranges[PASS_FAR]);
    p.nearViewProj.set(cam.nearViewProj);
    p.camX = cam.x;
    p.camY = cam.y;
    p.camZ = cam.z;
    // The sun rises at six, peaks at noon and sets at eighteen. At night the light comes from a fixed moon and is dimmer.
    p.light = flatLight(this.hour, p.sun);
    p.alternate = this.alternate;
    // Through a sight the near trees hand over to the far its zoom times as far, so those round what it is on are drawn
    // near (D1090); out of its window none is drawn at all.
    this.handScale = cam.zoom > 1 ? cam.zoom : 1;
    p.frame[FRAME.handFrom] = this.assets.tier.nodes.band[0] * this.handScale;
    p.frame[FRAME.handTo] = this.assets.tier.nodes.band[1] * this.handScale;
    if (this.nodesFar) this.nodesFar.handScale = this.handScale;
    // Lit tiers take their light from the sky table, and the air and the dome's pictures from atmosphere.ts.
    const near = this.finishNear.metres, scale = this.assets.scale;
    if (p.tier.lit) this.finishNear.update(cam.x, cam.y, cam.z, this.world.hf, this.world.structs, scale, finishTaps(p.tier));
    this.finishes.frame(p, this.assets.residency, p.tier, near, scale);
    // The walls' weathering masks are made on the card, not fetched (texgen/weather.ts), so their bytes are held apart.
    this.assets.residency.reserve("weather masks", weatherBytes(p.weatherSide));
    this.facades.frame(p, this.assets.residency, p.tier, near[NEAR_WALL]!, near[NEAR_FRONT]!, near[NEAR_GLASS]!, scale);
    this.characters.heatView = false;
    if (p.tier.lit) {
      skyFrame(this.hour, theSky(), p.frame);
      airFrame(p.frame, theSky(), this.hour, cam.x, cam.z, this.now / 1000, this.viewDistance, this.plainSky ? 0 : p.tier.clouds, this.plainSky, this.fadeFrom);
      postFrame(p.frame, p.tier, this.hour, Math.round(this.canvasHeight * p.room), p.share);
      opticFrame(p.frame, p.tier, this.optic, Math.floor(this.now / 16));
      this.characters.heatView = p.frame[OPTIC_AT] === OPTIC_HEAT;
      p.lightSamples = lightSamples(this.supersampled);
      // A vehicle's glass covers a share of a pixel's samples where the frame has them: a canvas is drawn antialiased, a
      // light target with samples unless it is supersampled (vehicle-glass.ts).
      p.frame[GLASS_AT] = p.tier.post !== null && p.lightSamples === 0 ? 0 : 1;
      // The bodies nearest the camera, for their contact and, by night where the tier's shadows say so, for the shadows in
      // the lamps' pool cards (lamp.ts poolShade), which a tier without contact reads for nothing else.
      const contacts = p.tier.contact || (p.tier.shadows.pools === true && this.streetLamps.on && this.streetLamps.shaded && lampsOn(p.frame) > 0.004);
      contactFrame(p.frame, contacts, this.sizes, remote, this.own, cam, this.halfLength);
      if (contacts) this.parkedContacts.add(p.frame, this.world.structs, this.assets.manifest.meshes, this.meshOfKind, cam);
      if (!this.plainSky && this.skyMaterial >= 0) this.assets.residency.material(this.skyMaterial, SKY_ASKED.pixels, SKY_ASKED.distance, undefined, true);
    }
    if (!p.lit) p.frame[FRAME.exposure] = 0;
    writeEyeSky(p.frame, this.world.tideEyes ?? [], this.eyeSeconds, cam.x, cam.y, cam.z, this.sextantScale, this.eyeHold);
    writeDropSky(p.frame, this.supply?.list ?? null, this.supply?.tick ?? 0, TICK_RATE, cam.x, cam.y, cam.z, this.world.tideEyes ?? [], this.eyeSeconds);
    // The street lamps' cards, and the one lamp that lights as a light where the tier lets it, the one by the viewer's own
    // body, before what casts is chosen.
    const shadows = p.tier.shadows;
    this.streetLamps.build(p, cam, this.world.structs, this.world.dims.chunksX, this.world.dims.chunksZ, this.now, p.lit && shadows.cascades > 0 && shadows.lamp === true, this.world.hf, p.lit && shadows.pools === true, this.own ?? cam, Math.round(this.canvasHeight * p.share));
    this.assets.residency.reserve("shadow maps", p.lit ? shadowBytes(p.tier.shadows) : 0);
    if (!this.alternate) this.assets.residency.reserve("light target", p.tier.post ? lightBytes(...sceneSize(this.canvasWidth, this.canvasHeight, p.room), lightSamples(this.supersampled)) : 0);
    this.casting.fit(cam);
    this.casting.fitLamp(cam);

    // Under water, the sea's or a lake's where the camera is, the view is short and the fog is the water's colour, dimmed.
    // Out of it the air is measured from the sea, or from 0 over a map with none.
    const sea = this.world.hf.seaLevel;
    const water = this.world.hf.waterAt(cam.x, cam.z);
    const under = cam.y < water;
    p.frame[FRAME.eyeHeight] = under ? cam.y - water : Math.max(cam.y - (sea > -Infinity ? sea : 0), 0);
    // The lit ground is wet just over the sea, measured from the eye's height over it (bank.ts shoreWet).
    p.frame[SHORE_AT] = sea > -Infinity && !under ? 1 : 0;
    if (under) {
      for (let k = 0; k < 3; k++) p.sky[k] = this.deepColor[k]! * p.light;
      p.fogStart = 0;
      p.fogEnd = UNDERWATER_VIEW;
    } else {
      for (let k = 0; k < 3; k++) p.sky[k] = this.skyColor[k]! * p.light;
      p.fogStart = this.viewDistance * 0.45;
      p.fogEnd = this.viewDistance;
    }
    skyShown(p);

    const focused = !Number.isNaN(this.focusX) && cam.zoom >= TERRAIN_FOCUS;
    this.terrain.centreX = focused ? this.focusX : NaN;
    this.terrain.centreZ = focused ? this.focusZ : NaN;
    this.terrain.select(cam, p, this.viewDistance, this.assets.residency, this.casting.on ? this.casting.groundCasts : undefined);
    // The selection stops at a full list, so a full list has left tiles out.
    if (p.tileCount === MAX_TILES) p.dropped++;
    const f = this.frame;
    f.cam = cam;
    f.viewHeight = this.viewHeight;
    f.lift = this.lift;
    f.plainSky = this.plainSky;
    f.remote = remote;
    f.own = this.own;
    f.tier = this.assets.tier;
    f.now = this.now;
    f.view = this.viewDistance;
    f.under = under;
    f.hider = undefined;
    return f;
  }

  /** The city's blocks' reach: a tier that draws no far city draws none of its blocks either. */
  private blocksView(tier: Tier): number {
    return tier.reach.city > 0 && tier.city.levels.length > 0 ? this.viewDistance : 0;
  }

  /** The frame's passes, in the order they update and draw in. */
  private rows(): Pass[] {
    const p = this.packet;
    return [
      this.waters,
      // Before the statics, so a full frame leaves out pieces of a chunk rather than a yacht's sails.
      this.eyes,
      this.supplyDrops,
      this.movingStatics,
      {
        draw: (f) => {
          this.structures(f.cam, this.world.structs, 0, this.meshOfKind, this.colorOfKind, null);
          if (this.world.nodes) this.structures(f.cam, this.world.nodes, NODE_BUFFERS, this.meshOfForm, this.colorOfForm, this.sizeOfForm);
          if (this.instanceBytes !== this.instancesReserved) this.assets.residency.reserve(INSTANCES, (this.instancesReserved = this.instanceBytes));
        },
      },
      // What the near store's meshes and the ground hide, of what is drawn so far and from here on: the meshes themselves first.
      { draw: (f) => { if (this.hide) this.hideDrawn(f.cam); } },
      {
        draw: (f) => {
          for (let k = 0; k < this.later.length; k += 5) {
            const id = this.later[k]!;
            this.meshRuns(this.batches.get(id)!, id, this.later[k + 1]!, this.later[k + 2]!, this.later[k + 3]!, this.later[k + 4]!);
          }
          f.hider = this.hiding.on ? this.hiding : undefined;
        },
      },
      {
        // The map's statics handed over again: the far city is made of them, taking over what it can of the one before.
        update: (f) => {
          if (this.city && this.world.city !== this.citySource) this.startCity(this.city);
          if (this.city ?? this.startCity()) this.farCity(f.cam);
        },
        draw: (f) => void this.city?.draw(f.cam, this.alongGround(f.tier.reach.city), this.drawCity, f.hider),
      },
      {
        update: (f) => {
          const cam = f.cam;
          this.farShadow?.update(p, this.assets.residency, cam.x, cam.y, cam.z, p.cascadeCount > 0 ? this.casting.sunAt : null, this.now, p.cascadeCount > 0 && this.casting.sunCasts ? this.casting.sunAt : null);
        },
      },
      {
        update: (f) => {
          p.frame[FRAME.fade] = f.tier.fade;
          this.far?.update(p, this.assets.residency, f.cam.x, f.cam.z, f.tier.reach.bases);
        },
        draw: (f) => void this.far?.draw(f.cam, f.tier.reach.bases, f.tier.fade, this.drawFar, f.hider),
      },
      {
        update: (f) => {
          this.makeBlocks();
          this.blocks?.update(p, this.assets.residency, f.cam, this.blocksView(f.tier), this.city ? this.citySource!.statics : null, this.city);
        },
        draw: (f) => void this.blocks?.draw(f.cam, this.blocksView(f.tier), this.shown, this.drawCity, f.hider),
      },
      {
        update: (f) => void this.nodesFar?.update(p, this.assets.residency, f.cam.x, f.cam.z, f.tier, f.cam.zoom > 1 ? this.focusX : NaN, this.focusZ),
        draw: (f) => void this.nodesFar?.draw(f.cam, this.drawFarNodes, f.hider),
      },
      {
        update: (f) => { if (this.casting.on && !this.terrain.casters(f.cam, p, this.viewDistance, this.casting.groundCasts)) p.casterDropped++; },
        draw: () => { if (this.casting.on) this.casting.groundCast(); },
      },
      { draw: (f) => { if (f.remote) this.entities(f.cam, f.remote); } },
      { draw: (f) => this.bodies(f.cam, f.remote) },
      this.marks,
      { draw: (f) => { if (this.falling && this.falling.count > 0) this.showFalling(f.cam, this.falling); } },
      { draw: (f) => { if (this.treeFalls.count > 0) this.treeFalls.frame(this.now, (event, pose) => this.showTreeFall(f.cam, event, pose)); } },
      this.placing,
      this.loose,
      { draw: (f) => this.showDetails(f.cam, f.remote) },
      {
        // The viewer's own body goes over everything else, water included.
        draw: () => {
          this.quadsOnCard();
          this.characters.flush(p, this.transient, true, this.drawBody, this.casting.on ? this.casting.castBody : null);
        },
      },
      {
        draw: (f) => {
          p.frame[FRAME.exhaustPhase] = exhaustPhase(this.now);
          p.frame[FRAME.streetLook] = this.finishGloss - 1;
          p.frame[FRAME.streetLook + 2] = this.roadFinish > 0 ? 1 : 0;
          p.frame[FRAME.streetLook + 3] = this.roadFinish === 2 ? 1 : 0;
          this.street.frame(p, f.cam, this.world, f.remote, this.hiddenNodes, this.now, this.own);
          this.assets.residency.reserve("street environment", streetTextureBytes(p.tier.reflectionHz));
        },
      },
    ];
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
    const flags = sized ? DRAW_SIZED : 0;
    const runs = this.castRuns;
    const spans = this.spans;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0 || this.groundFlags[mesh] !== 0) continue;
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
   * Makes the picture of what hides what from what is sure to be drawn whole this frame, and leaves out what it hides of
   * the frame so far: the ground's tiles from the view, and from the sun's maps those whose shadow it hides; the near
   * store's draws; and its chunks' casters where it hides all their shadows can fall on. Nothing is hidden on a frame
   * that has left anything out, nor while the near plane may cut into the ground or into a piece of the near store's
   * meshes, which would open them. What is in the picture:
   * - the ground: under each tile drawn whose farthest point is within the view, a box up to its lowest sample. A line of
   *   sight from the camera, over the ground, that reaches such a box has met the ground drawn on its way. What of a box
   *   of the near store, a body or a shadow lies under the samples round it is hidden the same way (Hiding.hidesOver).
   * - the near store's meshes: the occluders of a chunk whose mesh is drawn (nearcity.ts), where each chunk round it whose
   *   pieces may hold its faces has its mesh drawn too, or none of its pieces in view, or none at all. A face the mesh
   *   leaves out is held by another piece drawn, or lies under the ground.
   */
  private hideDrawn(cam: Camera): void {
    const p = this.packet, h = this.hiding, hf = this.world.hf;
    // The meshes are drawn after: room for each cell of them in view a draw in each range, or no picture.
    let cells = 0;
    for (let k = 0; k < this.later.length; k += 5) for (const v of this.batches.get(this.later[k]!)!.inView) cells += v;
    if (p.dropped > 0 || p.drawCount + this.put.doubled + 2 * cells > MAX_DRAWS) return;
    const slope = Math.tan(cam.fovY / 2);
    const reach = cam.near * Math.sqrt(1 + slope * slope * (1 + cam.aspect * cam.aspect));
    // The highest the ground stands round the camera, as the tile under it draws it: the samples of its quad and those round it.
    let stride = 1;
    for (let t = 0; t < p.tileCount; t++) {
      const size = p.tiles[t * 4 + 2]! * TILE_QUADS;
      if (p.tiles[t * 4]! <= 0 && p.tiles[t * 4]! + size > 0 && p.tiles[t * 4 + 1]! <= 0 && p.tiles[t * 4 + 1]! + size > 0) stride = p.tiles[t * 4 + 3]!;
    }
    const cell = hf.cell;
    if (cam.x < 0 || cam.z < 0 || cam.x >= hf.sizeX || cam.z >= hf.sizeZ) return;
    const ci = Math.floor(cam.x / cell / stride) * stride, cj = Math.floor(cam.z / cell / stride) * stride;
    let ground = -Infinity;
    for (let j = cj - stride; j <= cj + 2 * stride; j += stride) for (let i = ci - stride; i <= ci + 2 * stride; i += stride) ground = Math.max(ground, hf.sample(Math.min(Math.max(i, 0), hf.nx - 1), Math.min(Math.max(j, 0), hf.nz - 1)));
    if (cam.y - ground <= reach) return;
    h.begin(cam);
    // Under each tile drawn wholly within the view, a box from far under the ground up to its lowest sample; but where
    // that stands no higher than RELIEF over the lowest ground drawn, as all of a flat map's does, it hides only what is
    // under the ground, which a box tested over it is cut to.
    const floor = hf.minY - 1 - cam.y, low = this.terrain.low, up = this.terrain.farthestFrom(cam.y);
    let lowest = Infinity;
    for (let t = 0; t < p.tileCount; t++) if ((p.tilePass[t]! & (NEAR | FAR)) !== 0) lowest = Math.min(lowest, low[t]!);
    // Over a rectangle the ground drawn stands no lower than the samples a quad round it, the coarsest drawn's.
    let quad = 0;
    for (let t = 0; t < p.tileCount; t++) quad = Math.max(quad, p.tiles[t * 4 + 2]!);
    h.under = (x0, z0, x1, z1) => {
      const ax = cam.x + x0 - quad, az = cam.z + z0 - quad, bx = cam.x + x1 + quad, bz = cam.z + z1 + quad;
      return ax < 0 || az < 0 || bx > hf.sizeX || bz > hf.sizeZ ? -Infinity : this.terrain.lowest(ax, az, bx, bz) - cam.y;
    };
    h.underReach = this.viewDistance;
    for (let t = 0; t < p.tileCount; t++) {
      if ((p.tilePass[t]! & (NEAR | FAR)) === 0 || low[t]! <= lowest + RELIEF) continue;
      const x0 = p.tiles[t * 4]!, z0 = p.tiles[t * 4 + 1]!, size = p.tiles[t * 4 + 2]! * TILE_QUADS;
      if (Math.hypot(Math.max(-x0, x0 + size), Math.max(-z0, z0 + size), up) > this.viewDistance || low[t]! <= floor) continue;
      h.box(x0 + size / 2, (floor + low[t]!) / 2, z0 + size / 2, size / 2, (low[t]! - floor) / 2, size / 2, 1, 0);
    }
    if (this.near && !this.nearPiece(cam, reach)) {
      // An occluder whose face is too small on the picture to cover a pixel or two whole is left out: it would add little.
      const across = h.height / (2 * Math.tan(cam.fovY / 2)) / HIDE_PIXELS;
      for (const chunk of this.meshDrawn) {
        if (!this.sealed(cam, chunk)) continue;
        const o = this.batches.get(chunk)!.mesh!.occluders;
        for (let k = 0; k < o.length; k += OCCLUDER) {
          const x = o[k]! - cam.x, y = o[k + 1]! - cam.y, z = o[k + 2]! - cam.z, r = o[k + 8]!;
          const d = Math.sqrt(x * x + y * y + z * z) - r;
          if ((d > 0 && o[k + 9]! * across < d) || !cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
          h.box(x, y, z, o[k + 3]!, o[k + 4]!, o[k + 5]!, o[k + 6]!, o[k + 7]!);
        }
      }
    }
    if (!h.on) return;
    h.end();
    // The ground's tiles, in view and cast.
    const high = this.terrain.high;
    for (let t = 0; t < p.tileCount; t++) {
      const x0 = p.tiles[t * 4]!, z0 = p.tiles[t * 4 + 1]!, quad = p.tiles[t * 4 + 2]!, size = quad * TILE_QUADS;
      const skirt = low[t]! - 2 * quad;
      if ((p.tilePass[t]! & (NEAR | FAR)) !== 0 && h.hidesOver(x0, skirt, z0, x0 + size, high[t]!, z0 + size)) {
        p.tilePass[t] = p.tilePass[t]! & ~(NEAR | FAR);
        p.triangles -= TILE_QUADS * TILE_QUADS * 2;
      }
      if (p.tilePass[t]! < TILE_CASTS) continue;
      const s = this.casting.stretch(x0, z0, x0 + size, z0 + size, high[t]!);
      const sx = -this.casting.sunAt[0]! * s, sy = -this.casting.sunAt[1]! * s, sz = -this.casting.sunAt[2]! * s;
      if (this.casting.shadeHidden(Math.min(x0, x0 + sx), Math.min(skirt, skirt + sy), Math.min(z0, z0 + sz), Math.max(x0 + size, x0 + size + sx), Math.max(high[t]!, high[t]! + sy), Math.max(z0 + size, z0 + size + sz))) p.tilePass[t] = p.tilePass[t]! & (NEAR | FAR);
    }
    // A tile neither drawn nor cast leaves the list.
    let tiles = 0;
    for (let t = 0; t < p.tileCount; t++) {
      if (p.tilePass[t] === 0) continue;
      if (tiles !== t) {
        p.tiles.copyWithin(tiles * 4, t * 4, t * 4 + 4);
        p.tileOrigin.copyWithin(tiles * 2, t * 2, t * 2 + 2);
        p.tileSource.copyWithin(tiles * 4, t * 4, t * 4 + 4);
        p.tilePass[tiles] = p.tilePass[t]!;
      }
      tiles++;
    }
    p.tileCount = tiles;
    // The near store's draws, and its chunks' casters.
    const tris = this.trisOfMesh, box = this.put.boxOf;
    let kept = 0;
    for (let d = 0; d < p.drawCount; d++) {
      const o = d * 6;
      if (this.put.boxed[d] === 0 || !h.hidesOver(box[o]!, box[o + 1]!, box[o + 2]!, box[o + 3]!, box[o + 4]!, box[o + 5]!)) {
        if (kept !== d) this.put.moveRow(d, kept);
        kept++;
        continue;
      }
      const copies = this.put.passOf[d] === (NEAR | FAR) ? 2 : 1;
      p.triangles -= ((p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.drawIndexCount[d]! / 3 : tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]! * copies;
      this.put.doubled -= copies - 1;
    }
    // The rows let go take what beginFrame gives every row, which draws that leave them alone count on.
    for (const a of [p.drawFade, p.drawHand, p.drawLayer, p.drawWear, p.drawSwap]) a.fill(0, kept, p.drawCount);
    p.drawEffect.fill(0, kept * 4, p.drawCount * 4);
    p.drawCount = kept;
    const casts = this.chunkCasts;
    let at = 0, next = 0;
    for (let k = 0; k < casts.length; k += 8) {
      const e0 = casts[k]!, e1 = casts[k + 1]!;
      for (; next < e0; next++) this.casting.moveCaster(next, at++);
      if (!this.casting.shadeHidden(casts[k + 2]!, casts[k + 3]!, casts[k + 4]!, casts[k + 5]!, casts[k + 6]!, casts[k + 7]!)) for (; next < e1; next++) this.casting.moveCaster(next, at++);
      for (; next < e1; next++) {
        const maps = this.casting.maps(p.casterCascades[next]!);
        p.castDraws -= maps;
        p.castTriangles -= ((p.casterFlags[next]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.casterIndexCount[next]! / 3 : tris[p.casterMesh[next]!]![p.casterLod[next]!]!) * p.casterInstances[next]! * maps;
      }
    }
    for (; next < p.casterCount; next++) this.casting.moveCaster(next, at++);
    p.casterCount = at;
  }

  /**
   * Whether the pieces chunk `chunk` of the near store draws in its mesh are closed this frame: whether each chunk round
   * it, whose pieces may hold its faces, has its mesh drawn, or is drawn by the far city at a form that holds every piece
   * whole, or has none of its pieces in view, or none at all; so that no face of the chunk's another holds is open.
   */
  private sealed(cam: Camera, chunk: number): boolean {
    const dims = this.world.dims, city = this.world.city!.statics, reach = this.alongGround(this.assets.tier.reach.city);
    const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, z = cz + dz;
        if ((dx === 0 && dz === 0) || x < 0 || z < 0 || x >= dims.chunksX || z >= dims.chunksZ) continue;
        const n = z * dims.chunksX + x;
        let closed = this.closes.get(n);
        if (closed === undefined) this.closes.set(n, (closed = this.meshDrawn.has(n) || city.in(n) === 0 || this.unseen(cam, n) || (this.city?.isFar(n) === true && this.city.exactly(n, cam, reach))));
        if (!closed) return false;
      }
    }
    return true;
  }

  /** Per chunk asked of this frame, whether it leaves no face of a neighbour's open (`sealed`). */
  private readonly closes = new Map<number, boolean>();

  /** Per chunk of the map's statics, found when first asked for: per cell of 16 m, the box round the pieces whose middles are in it. */
  private readonly boxes = new Map<number, Float64Array>();

  /** Whether no piece of chunk `chunk` of the map's statics is in view: each its turned box of its kind's half extents. */
  private unseen(cam: Camera, chunk: number): boolean {
    let b = this.boxes.get(chunk);
    if (!b) {
      const { first, kind, yaw, x, y, z, halfX, halfY, halfZ } = this.world.city!.statics;
      b = new Float64Array(CHUNK_CELLS * CHUNK_CELLS * 6);
      for (let k = 0; k < b.length; k += 6) b.fill(Infinity, k, k + 3).fill(-Infinity, k + 3, k + 6);
      const x0 = chunkCx(this.world.dims, chunk) * CHUNK_SIZE, z0 = chunkCz(this.world.dims, chunk) * CHUNK_SIZE;
      for (let i = first[chunk]!; i < first[chunk + 1]!; i++) {
        const k = kind[i]!, a = (yaw[i]! / YAW_UNITS) * Math.PI * 2;
        const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        const rx = c * halfX[k]! + s * halfZ[k]! + 0.01, rz = s * halfX[k]! + c * halfZ[k]! + 0.01;
        const ci = Math.min(CHUNK_CELLS - 1, Math.max(0, Math.floor(((x[i]! - x0) * CHUNK_CELLS) / CHUNK_SIZE)));
        const cj = Math.min(CHUNK_CELLS - 1, Math.max(0, Math.floor(((z[i]! - z0) * CHUNK_CELLS) / CHUNK_SIZE)));
        const o = (cj * CHUNK_CELLS + ci) * 6;
        b[o] = Math.min(b[o]!, x[i]! - rx);
        b[o + 1] = Math.min(b[o + 1]!, y[i]! - halfY[k]!);
        b[o + 2] = Math.min(b[o + 2]!, z[i]! - rz);
        b[o + 3] = Math.max(b[o + 3]!, x[i]! + rx);
        b[o + 4] = Math.max(b[o + 4]!, y[i]! + halfY[k]!);
        b[o + 5] = Math.max(b[o + 5]!, z[i]! + rz);
      }
      this.boxes.set(chunk, b);
    }
    for (let o = 0; o < b.length; o += 6) if (b[o]! <= b[o + 3]! && cam.boxVisible(b[o]! - cam.x, b[o + 1]! - cam.y, b[o + 2]! - cam.z, b[o + 3]! - cam.x, b[o + 4]! - cam.y, b[o + 5]! - cam.z)) return false;
    return true;
  }

  /**
   * Whether a piece the near store's meshes draw may come within `reach` of the camera, where the near plane would cut
   * it open: any of the map's pieces whose turned box of its kind's half extents (which hold all of its form) comes that
   * near. Those of the chunks round the camera's are looked at for the nearest within CLEAR, which holds while the
   * camera moves less than the difference; a piece of a chunk farther reaches no nearer than 48 m.
   */
  private nearPiece(cam: Camera, reach: number): boolean {
    const dims = this.world.dims, city = this.world.city;
    if (!city) return false;
    // No piece came nearer than `clear` from where it was last looked for: none can be within reach until the camera has moved the difference.
    const at = this.clearAt;
    if (Math.hypot(cam.x - at[0]!, cam.y - at[1]!, cam.z - at[2]!) < at[3]! - reach * 1.1) return false;
    let clear = CLEAR;
    const { first, kind, yaw, x, y, z, halfX, halfY, halfZ } = city.statics;
    const cx = Math.floor(cam.x / CHUNK_SIZE), cz = Math.floor(cam.z / CHUNK_SIZE);
    for (let j = Math.max(0, cz - 1); j <= Math.min(dims.chunksZ - 1, cz + 1); j++) {
      for (let i = Math.max(0, cx - 1); i <= Math.min(dims.chunksX - 1, cx + 1); i++) {
        const c = j * dims.chunksX + i;
        for (let s = first[c]!; s < first[c + 1]!; s++) {
          const k = kind[s]!;
          const dx = cam.x - x[s]!, dy = cam.y - y[s]!, dz = cam.z - z[s]!, r = halfX[k]! + halfY[k]! + halfZ[k]! + CLEAR;
          if (this.near!.kinds[k] !== 1 || Math.abs(dx) > r || Math.abs(dy) > r || Math.abs(dz) > r) continue;
          const a = (yaw[s]! / YAW_UNITS) * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
          const lx = Math.max(Math.abs(co * dx - si * dz) - halfX[k]!, 0), ly = Math.max(Math.abs(dy) - halfY[k]!, 0), lz = Math.max(Math.abs(si * dx + co * dz) - halfZ[k]!, 0);
          clear = Math.min(clear, Math.sqrt(lx * lx + ly * ly + lz * lz));
        }
      }
    }
    at[0] = cam.x;
    at[1] = cam.y;
    at[2] = cam.z;
    at[3] = clear;
    return clear < reach * 1.1;
  }

  /** Where the camera was when `nearPiece` last looked, and how far the nearest piece was then. */
  private readonly clearAt = Float64Array.of(NaN, NaN, NaN, 0);

  /** Small details (client/core/details/): the cut-out ones with the near opaque, the see-through ones after the sea. */
  private showDetails(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const { rotorBlur, patrolLights, thrusterPlumes, windscreens, tireContacts } = this.characters;
    const { streetLamps, streetWires } = this;
    streetWires.build(p, cam, this.world.structs, this.world.dims.chunksX, this.world.dims.chunksZ);
    tireContacts.build(p, this.world);
    this.damage.build(cam, this.now);
    const cut = this.details.frame(p, cam, remote, this.characters.fallen, this.shots?.ends ?? NO_SHOTS, this.own, this.world.hf, this.assets.tier, this.now, this.world, tireContacts.count + windscreens.count + rotorBlur.count + patrolLights.count + thrusterPlumes.count + streetLamps.count + streetWires.count + this.damage.count);
    const particles = p.detailCount;
    rotorBlur.write(p);
    const lamps = p.detailCount;
    patrolLights.write(p);
    const plumes = p.detailCount;
    thrusterPlumes.write(p);
    const wires = p.detailCount;
    streetWires.write(p);
    const street = p.detailCount;
    streetLamps.write(p);
    const wheelsAndGlass = p.detailCount;
    tireContacts.write(p);
    windscreens.write(p);
    // The damage numbers' cards, drawn last of all below, over the clouds too.
    const numbers = p.detailCount;
    this.damage.write(p);
    const glassAndNumbers = p.detailCount;
    // The clouds' puffs after them, in the depth ranges they reach, as they may be seen from far off (clouds.ts).
    const seen = p.detailCount;
    const solid = this.clouds.write(p, cam, remote, this.cloudRange);
    const far = seen < p.detailCount ? cam.passesOf(this.cloudRange[0]!, this.cloudRange[1]!) : NEAR;
    this.put.drawDetails(0, cut, DRAW_CUTOUT, NEAR);
    this.put.drawDetails(cut, particles - cut, DRAW_BLEND, NEAR);
    this.put.drawDetails(particles, lamps - particles, DRAW_BLEND, rotorBlur.passes(cam));
    this.put.drawDetails(lamps, plumes - lamps, DRAW_BLEND, patrolLights.passes(cam));
    this.put.drawDetails(plumes, wires - plumes, DRAW_BLEND, thrusterPlumes.passes(cam));
    this.put.drawDetails(wires, street - wires, DRAW_BLEND, streetWires.passes(cam));
    this.put.drawDetails(street, wheelsAndGlass - street, DRAW_BLEND, streetLamps.passes(cam));
    this.put.drawDetails(wheelsAndGlass, numbers - wheelsAndGlass, DRAW_BLEND, tireContacts.passes(cam) | windscreens.passes(cam));
    this.put.drawDetails(seen, solid, DRAW_CUTOUT, far);
    this.put.drawDetails(seen + solid, p.detailCount - seen - solid, DRAW_BLEND, far);
    this.put.drawDetails(numbers, glassAndNumbers - numbers, DRAW_BLEND, this.damage.passes(cam));
  }

  /** A tile of far blocks, `near` metres off: one instance of its own level, gone at the tier's reach where it reaches into the fade (far.ts). */
  private readonly drawFar = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
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
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += triangles * copies;
  };

  /** The city's blocks, made once the late code has come: at once where it already has, as in tests and tools. */
  private makeBlocks(): void {
    if (this.blocks || !this.blocksFrom || !Scene.late) return;
    this.blocks = new Scene.late.CityBlocks(this.blocksFrom.tops, this.world.dims, this.world.hf, this.farMesh, this.blocksFrom.colours, this.landmarkKinds);
    this.blocksFrom = null;
  }

  /**
   * The far city once the world has the map's statics, which the far blocks then leave their cells to; or, given the far
   * city `before` of statics handed over before, of those the world has now.
   */
  private startCity(before: FarCity | null = null): FarCity | null {
    const source = this.world.city;
    if (!source || !this.farBounds || !Scene.late) return null;
    this.citySource = source;
    this.boxes.clear();
    this.clearAt.fill(NaN, 0, 3);
    this.clearAt[3] = 0;
    this.city = new Scene.late.FarCity(source, this.world.dims, this.world.hf, this.farMesh, this.farBounds, this.landmarkKinds, before);
    this.farShadow = new FarShadow(source.statics, this.world.hf, this.city, source.maker ?? null, source.complete, this.landmarkKinds, this.floatingKinds);
    this.farShadow.roof = new Scene.late.RoofMap();
    this.farShadow.roof.palette = this.groundPalette;
    this.far?.leaveTo(this.city);
    const placed = this.world.landmarks ?? [];
    if (placed.length > 0) this.landmarks = new FarLandmarks(source, this.world.dims, placed, landmarkFars(this.assets.manifest));
    this.movingStatics.landmarks = this.landmarks;
    return this.city;
  }

  /**
   * The map's buildings to the tier's reach, in place of chunks the near store does not hold whole, faded over the last
   * of it: what is on the card, and the landmarks' far meshes. The buildings are drawn once the near store is.
   */
  private farCity(cam: Camera): void {
    const p = this.packet;
    const tier = this.assets.tier;
    p.frame[FRAME.fade] = tier.fade;
    // Through a sight its tiles in the window reach as far as the view ends (D1088).
    this.city!.view = this.viewDistance;
    this.city!.update(p, this.assets.residency, cam, tier.city.levels, this.alongGround(tier.reach.city), tier.fade, this.world.structs, this.world.far?.cells ?? null);
    // A landmark is drawn to the end of the view, as the city's blocks leave its cells to it.
    this.landmarks?.draw(p, cam, this.assets, this.viewDistance, tier.fade, this.drawLandmark);
  }

  /** Who draws a chunk's buildings other than the city's blocks this frame (cityblocks.ts Shown). */
  private readonly shown = (chunk: number): number => {
    if (this.world.far?.complete(chunk) ?? this.world.city?.complete(chunk)) return -1;
    const city = this.city?.shows(chunk) ?? 0, far = this.far?.shows(chunk) ?? 0;
    return city < 0 || far < 0 ? -1 : city || far;
  };

  /** A run of a far city tile's chunks at one of its levels, or of a tile of the city's blocks, `near` metres off: one instance, gone or come at `fade` (farcity.ts). */
  private readonly drawCity = (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
    p.drawMesh[d] = this.farMesh;
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
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** A run of a landmark's far mesh: its one instance, gone at `fade` (farlandmarks.ts), in its own colours as its flat draws are. */
  private readonly drawLandmark = (mesh: number, level: number, instance: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = Math.hypot(ox, oy, oz);
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
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** A run of far nodes of every mesh, `near` metres off, each its mesh's row of the atlas (farnodes.ts), gone at its row's reach. */
  private readonly drawFarNodes = (slot: number, mesh: number, indices: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, hand: number, reach: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
    p.drawMesh[d] = mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = buffer;
    p.drawFirst[d] = first;
    p.drawInstances[d] = count;
    // An instance's vertices: the renderer reads them from the slot, and a count (bench-run.ts) from here.
    p.drawIndexCount[d] = indices;
    p.drawFlags[d] = DRAW_PULLED;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawFade[d] = reach;
    p.drawHand[d] = hand;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indices / 3) * count * copies;
  };

  private bodies(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const ch = this.characters;
    const st = this.state;
    const own = this.own;
    if (!this.charactersPrepared) {
      ch.clock = this.shotTick;
      ch.begin(p, this.world);
    }
    this.charactersPrepared = false;
    let unseen = 0;
    if (remote) {
      // Loose things and the dead first: they keep their bones, and the living share what is left.
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        // A thing thrown flies along its length, as an arrow is drawn, until it lies (server/loose.ts).
        const flying = this.dropped.flying(kind, remote.anim[i]!);
        if (this.pitched[kind] === 0 && !flying) continue;
        const x = remote.x[i]! - cam.x;
        const y = remote.y[i]! - cam.y;
        const z = remote.z[i]! - cam.z;
        if (!cam.boxVisible(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1)) continue;
        st.unpack(remote.anim[i]!);
        const pitch = (st.pitch / PITCH_STEPS) * (Math.PI / 2);
        const level = Math.cos(pitch);
        const lies = flying ? this.dropped.item(kind, remote.gear, i * GEAR_COUNT) : 0;
        ch.loose(p, lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[kind]!, x, y, z, Math.sin(remote.yaw[i]!) * level, Math.sin(pitch), Math.cos(remote.yaw[i]!) * level, 1);
      }
      ch.corpses(p, cam, remote, this.world);
    }
    // Then the shots in the air, and the supply drops' shafts and capsules.
    this.shots?.draw(ch, p, cam, this.shotTick);
    this.supply?.draw(ch, p, cam);
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
        const top = y + (r > 2.2 ? r : 2.2);
        if (!cam.boxVisible(x - r, y - 0.3, z - r, x + r, top, z + r) || this.hiding.hidesOver(x - r, y - 0.3, z - r, x + r, top, z + r)) {
          // Out of view, a body whose shadow may fall in it is posed after those in view, while bones are left.
          if (this.casting.on && this.casting.bodyShadows.body(x, y, z, r) !== 0) {
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
        this.bodyRides[n] = remote.seatSlot[i] !== IMPALE_SLOT && mount !== -1 && (remote.cue[i]! & CUE_HELD) === 0 && !ch.vehicle(mount === MOUNT_OWN ? own!.kind : remote.kind[mount]!) ? 1 : 0;
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
      ch.eye.pitch = cam.pitch;
      ch.eye.half = cam.fovY / 2;
      let seat: VehicleSeatPose | undefined;
      let saddled = false, impaled = false;
      this.ownRiderFit.profile = 0;
      const at = this.seatAt;
      const j = own.attachment && remote ? indexOfId(remote, own.attachment.host) : -1;
      if (j >= 0 && remote!.gen[j] === own.attachment!.generation) {
        const vehicle = ch.vehicle(remote!.kind[j]!) ? remoteVehiclePose(remote!, j, this.vehiclePose) : undefined, ms = this.mountState;
        ms.unpack(remote!.anim[j]!, remote!.cue[j]!);
        ms.seed = bodySeed(remote!.id[j]!);
        const v = this.viewed[j]!;
        if (ch.seat(remote!.kind[j]!, remote!.x[j]! - cam.x, remote!.y[j]! - cam.y, remote!.z[j]! - cam.z, remote!.yaw[j]!, ms, remote!.tick, at, own.attachment!.slot, vehicle, remote!.gear[j * GEAR_COUNT + GEAR_WORN]!, remote!.id[j]!, v >= 0 && this.bodyRigid[v] !== 0, remote!.grown[j] ? youngScale(this.birthScale[remote!.kind[j]!]!, remote!.span[j]!, remote!.grown[j]!, remote!.tick) : 1, this.ownRiderFit)) {
          // A passenger in a car is posed in the car's frame; on a creature, astride in its seat's.
          if (own.attachment!.slot === IMPALE_SLOT) { impaled = true; at[1]! -= ch.impaleDrop(own.kind); }
          else if (vehicle) seat = ch.seatPose(remote!.kind[j]!, own.attachment!.slot, vehicle, at, remote!.yaw[j]!, own.yaw, this.ownSeat);
          else saddled = true;
        }
      }
      if (impaled) ch.add(p, own.kind, at[0]!, at[1]!, at[2]!, remote!.yaw[j]!, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, null, 0, undefined, undefined, false, true);
      else if (saddled) ch.add(p, own.kind, at[0]!, at[1]!, at[2]!, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, at, 3, undefined, undefined, false, false, this.ownRiderFit);
      else ch.add(p, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, null, 0, own.vehicle, seat);
    }
    if (remote && unseen > 0) this.poseUnseen(remote, unseen);
    const from = p.drawCount;
    ch.flush(p, this.transient, false, this.drawBody, this.casting.on ? this.casting.castBody : null);
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
      st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!);
      const mount = this.bodyMount[k]!, slot = remote.seatSlot[i]!;
      const saddle = mount === MOUNT_OWN ? this.own!.gear[GEAR_WORN]! : mount >= 0 ? remote.gear[mount * GEAR_COUNT + GEAR_WORN]! : 0;
      // Missing authored sockets can only over-reserve; valid seats match add()'s separate fitted stand-in exactly.
      const profile = this.bodyRides[k] && this.saddleSeats[saddle]?.[slot - 1]?.rider ? saddle * (MAX_SEATS + 1) + slot : 0;
      need -= ch.bones(remote.kind[i]!) - 1 - ch.standInBones(remote.kind[i]!, remote.hasLook[i] !== 0 ? remote.look : null, i * LOOK_BYTES, st, this.bodyRides[k] !== 0, slot === IMPALE_SLOT, profile, remote.gear, i * GEAR_COUNT);
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
    const impaled = remote.seatSlot[i] === IMPALE_SLOT;
    const rider = (this.riderFits[i] ??= riderFitScratch());
    rider.profile = 0;
    let found: boolean;
    let saddle: number;
    let yaw: number;
    if (mount === MOUNT_OWN) {
      const own = this.own!;
      const x = own.x - p.camX, y = own.y - p.camY, z = own.z - p.camZ;
      saddle = own.gear[GEAR_WORN]!;
      found = held ? ch.heldAt(remote.id[i]!, remote.kind[i]!, own.id, own.kind, x, y, z, own.yaw, own.state, at) : ch.seat(own.kind, x, y, z, own.yaw, own.state, own.tick, at, remote.seatSlot[i]!, own.vehicle, saddle, own.id, false, 1, rider);
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
      found = held ? ch.heldAt(remote.id[i]!, remote.kind[i]!, remote.id[j]!, remote.kind[j]!, x, y, z, remote.yaw[j]!, ms, at) : ch.seat(remote.kind[j]!, x, y, z, remote.yaw[j]!, ms, remote.tick, at, remote.seatSlot[i]!, vehicle, saddle, remote.id[j]!, v >= 0 && this.bodyRigid[v] !== 0, remote.grown[j] ? youngScale(this.birthScale[remote.kind[j]!]!, remote.span[j]!, remote.grown[j]!, remote.tick) : 1, rider);
      yaw = remote.yaw[j]!;
      if (found && !held && vehicle) this.vehicleSeats[i] = ch.seatPose(remote.kind[j]!, remote.seatSlot[i]!, vehicle, at, yaw, remote.yaw[i]!, (this.seatPoses[i] ??= seatScratch()));
    }
    if (found && impaled) at[1]! -= ch.impaleDrop(remote.kind[i]!, remote.grown[i] ? youngScale(this.birthScale[remote.kind[i]!]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1);
    place[k * 4] = found ? at[0]! : remote.x[i]! - p.camX;
    place[k * 4 + 1] = found ? at[1]! : remote.y[i]! - p.camY;
    place[k * 4 + 2] = found ? at[2]! : remote.z[i]! - p.camZ;
    place[k * 4 + 3] = yaw;
    // A rider sits in its seat's whole frame; one in a vehicle's seat is posed in the vehicle's (vehicleSeats).
    if (!found || held || impaled || this.vehicleSeats[i]) return;
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
    st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!);
    st.seed = bodySeed(remote.id[i]!);
    const look = remote.hasLook[i] !== 0 ? remote.look : null;
    const size = remote.grown[i] !== 0 ? youngScale(this.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    this.characters.add(this.packet, kind, at[k * 4]!, at[k * 4 + 1]!, at[k * 4 + 2]!, at[k * 4 + 3]!, st, remote.tick, look, i * LOOK_BYTES, remote.colors, i * 6, remote.gear, i * GEAR_COUNT, remote.id[i]!, false, this.own?.cockpitActor === remote.id[i]!, size, rigid, unseen, this.seated[i] !== 0 ? this.seatTurn : null, i * 9, this.characters.vehicle(kind) ? remoteVehiclePose(remote, i, this.vehiclePose) : undefined, this.vehicleSeats[i], this.seated[i] !== 2, remote.seatSlot[i] === IMPALE_SLOT, this.seated[i] ? this.riderFits[i] : undefined);
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

  private showTreeFall(cam: Camera, event: TreePresentationEvent, pose: Float64Array): void {
    const p = this.packet, mesh = this.meshOfForm[event.form]!;
    if (mesh === HIDDEN || p.boneCount >= Math.min(p.tier.bones, MAX_BONES) || p.transientCount >= p.transientIds.length) return;
    const x = event.x - cam.x, y = event.y - cam.y, z = event.z - cam.z, size = this.sizeOfForm[event.form]! / SIZE_UNITS;
    const radius = this.radiusOfMesh[mesh]! * size, distance = Math.hypot(x, y, z);
    if (distance > 72 || !cam.boxVisible(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius)) return;
    const bone = p.boneCount++, b = bone * BONE_FLOATS;
    for (let i = 0; i < 12; i++) p.bones[b + i] = i % 4 === 3 ? pose[i]! - (i === 3 ? cam.x : i === 7 ? cam.y : cam.z) : pose[i]! * size;
    const first = p.transientCount++; this.transient.setSkinned(first, bone, this.colorOfForm[event.form]!); p.transientIds[first] = 0;
    const level = this.assets.choose(this.assets.table.error[mesh]!, Math.max(0, distance - radius), -1);
    this.assets.wantTextured(mesh, level, distance);
    this.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_SKINNED | DRAW_ONE_BONE, cam.passes(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius));
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
      if (base === 0 && p.tier.reflectionHz) this.street.indexChunk(t,x0,z0,cam);
      // Its near mesh is made nearest first, a chunk in a sight's window as if its zoom times nearer (D1087).
      const across = Math.hypot(x0 + CHUNK_SIZE / 2 - cam.x, z0 + CHUNK_SIZE / 2 - cam.z);
      const sooner = cam.zoom > 1 && cam.boxVisible(x0 - cam.x, -CHUNK_COLUMN - cam.y, z0 - cam.z, x0 + CHUNK_SIZE - cam.x, CHUNK_COLUMN - cam.y, z0 + CHUNK_SIZE - cam.z) ? cam.zoom : 1;
      const own = near ? near.of(chunk, t, statics!, this.city!, this.chunkCells, across / sooner, p) : null;
      const mesh = own?.mesh ?? null;
      let batch = this.batches.get(id);
      // A piece that took another kind in place is moved in place; a chunk whose doors have stood a while other than its
      // rooms were found with has them found again. A mesh not yet known has its page asked for while it is near. A chunk
      // whose mesh came, or went with a change to what stands, is laid out again the same frame.
      let learnt = false;
      if (batch) for (const m of batch.unknown) learnt = this.assets.known(m) || learnt;
      const turned = batch !== undefined && batch.shape !== t.shape && !batch.sized && batch.placed === t.placed;
      if (!batch || learnt || batch.mesh !== mesh || (batch.unbent && statics?.bent.bends.has(chunk)) || (batch.shape !== t.shape && !(turned && this.reform(batch, t, meshOf, colorOf))) || (batch.differ > 0 && this.now - batch.since >= SETTLE)) {
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
        this.assets.residency.spend(bytes);
        this.instanceBytes += bytes - batch.onCard;
        batch.onCard = bytes;
      }
      this.zones(cam, batch, seen, casts);
      // From outside air a chunk's interior is neither seen nor seen to cast: only its shell is drawn and cast.
      const all = batch.blocks === batch.cells || batch.exposing > 0 || batch.rooms!.near(cam.x, cam.y, cam.z, reach);
      const ox = x0 - cam.x, oy = -cam.y, oz = z0 - cam.z;
      if (seen) this.ranges(cam, batch, id, dist, ox, oy, oz, cam.passes(ax, ay, az, bx, by, bz), all);
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
    near?.end(p, this.assets.residency, statics!, this.city!, world.hf, this.chunkCells, laid);
  }

  /** Lets go of a chunk's instances, and the card of its buffer. */
  private drop(id: number): void {
    const b = this.batches.get(id);
    if (!b) return;
    if (b.uploaded || b.onCard > 0) this.packet.drops.push(id);
    if (this.bendsOnCard.delete(id)) this.packet.drops.push(id + BEND_BUFFERS);
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
    const flags = sized ? DRAW_SIZED : 0;
    const swapMs = sized ? (this.assets.tier.nodes.levels ?? 0) : 0;
    const rule = sized ? this.assets.tier.nodes.cover : undefined;
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      if (b.ranges[r + 2] === 0) continue;
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
        crowns.fill(crown, q * cells, (q + 1) * cells);
        thins.fill(b.thin[q]!, q * cells, (q + 1) * cells);
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
    const m = b.mesh!, first = m.cellFirst, box = m.cellBox;
    if (m.slot < 0) return 0;
    let n = 0;
    for (let c = 0; c < b.cells; c++) {
      const k = c * 6, seen = this.cellSeen[c]!;
      b.inView[c] = first[c + 1]! > first[c]! && (seen === 2 || (seen === 1 && cam.boxVisible(box[k]! + ox, box[k + 1]! + oy, box[k + 2]! + oz, box[k + 3]! + ox, box[k + 4]! + oy, box[k + 5]! + oz))) ? 1 : 0;
      n += b.inView[c]!;
    }
    return n;
  }

  /**
   * Draws a chunk's mesh by its cells `meshCells` marked, less those the picture of what hides what hides, each run of
   * neighbouring cells one draw in the depth ranges `passes`, a run going on over cells left out between where they weigh
   * less than a draw.
   */
  private meshRuns(b: ChunkBatch, id: number, ox: number, oy: number, oz: number, passes: number): void {
    const m = b.mesh!, first = m.cellFirst, box = m.cellBox;
    let from = -1, to = 0, gap = 0, c0 = 0, c1 = 0;
    for (let c = 0; c < b.cells; c++) {
      const n = first[c + 1]! - first[c]!;
      if (n === 0) continue;
      const k = c * 6;
      if (b.inView[c] === 0 || this.hiding.hidesOver(box[k]! + ox, box[k + 1]! + oy, box[k + 2]! + oz, box[k + 3]! + ox, box[k + 4]! + oy, box[k + 5]! + oz)) {
        gap += n;
        continue;
      }
      if (from >= 0 && gap * 2 > RUN_TRIANGLES) {
        this.drawMesh(b, id, from, to, ox, oy, oz, passes, c0, c1);
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
    if (from >= 0) this.drawMesh(b, id, from, to, ox, oy, oz, passes, c0, c1);
  }

  /** Faces `from` up to `to` of a chunk's mesh, which lie in cells `c0` up to `c1`: one instance of its level, at the chunk's corner. */
  private drawMesh(b: ChunkBatch, id: number, from: number, to: number, ox: number, oy: number, oz: number, passes: number, c0: number, c1: number): void {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.boxCells(d, d + 1, b.mesh!.cellBox, c0, c1, ox, oy, oz);
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
    const m = b.mesh!, first = m.cellFirst;
    if (m.slot < 0) return;
    const runs = this.castRuns;
    runs.length = 0;
    for (let i = 0; i <= MAX_CASCADES; i++) {
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
      this.casting.caster(this.near!.mesh, 0, m.slot, id, b.meshAt, 1, ox, oy, oz, DRAW_RANGED, 0, runs[k]! * 6, (runs[k + 1]! - runs[k]!) * 6, runs[k + 2]!);
    }
  }

  /**
   * Gives the draws from `from` on the box round range `q`'s instances in cells `c0` up to `c1` of a chunk: a piece's
   * whole, a node's to its mesh's reach sideways from its trunk at the largest size in the cell.
   */
  private boxRun(from: number, b: ChunkBatch, q: number, mesh: number, c0: number, c1: number, cam: Camera): void {
    const box = b.cellBox, cells = b.cells;
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
  private reform(b: ChunkBatch, t: ChunkTable, meshOf: Uint16Array, colorOf: Uint8Array): boolean {
    // Moved in place, the bends would no longer stand by their instances.
    if (b.bends) return false;
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
      if (colorOf === this.colorOfKind) data.set(this.regionsOfKind.subarray(kind * 5, kind * 5 + 5), at * INSTANCE_BYTES + 15);
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
    let bent = 0;
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || meshOf[kind] === HIDDEN || (skip && skip[s] === 1) || (sizeOf && this.hiddenNodes.has(chunk * 65536 + s))) continue;
      if (!sizeOf) bent += this.bentKind[kind]!;
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
    // A bent piece's bend is the map's for its slot while the slot holds the piece the map set there, of the map's statics
    // as they come, so a sector's are drawn once it has (city.ts CityStatics.bent).
    const city = bent > 0 ? this.world.city?.statics : undefined, map = city?.bent, from = map ? map.first[chunk]! : 0, rows = map ? map.first[chunk + 1]! - from : 0;
    const bends = bent > 0 ? new Int16Array(count * 8) : null, chunkBends = map?.bends.get(chunk);
    const b: ChunkBatch = {
      bends,
      unbent: bent > 0 && !chunkBends,
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
      if (kind === 0 || meshOf[kind] === HIDDEN || (skip && skip[s] === 1) || (sizeOf && this.hiddenNodes.has(chunk * 65536 + s))) continue;
      const mesh = meshOf[kind]!;
      const x = t.x[s]!;
      const y = t.y[s]!;
      const z = t.z[s]!;
      const block = blockAt[s]!;
      const cell = block % cells;
      const i = this.cellCursor[mesh * blocks + block]!++;
      w.set(i, x - x0, y, z - z0, t.yaw[s]!, colorOf[kind]!);
      if (sizeOf) w.size(i, sizeOf[kind]!);
      else w.bytes.set(this.regionsOfKind.subarray(kind * 5, kind * 5 + 5), i * INSTANCE_BYTES + 15);
      slots[i] = s;
      kinds[i] = kind;
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
      if (bodies.has(remote.kind[i]!) || this.pitched[remote.kind[i]!] !== 0 || this.clouds.kinds[remote.kind[i]!] !== 0 || remote.kind[i] === this.capsuleKind || this.dropped.flying(remote.kind[i]!, remote.anim[i]!)) continue;
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
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r) || this.hiding.hidesOver(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      this.tally(cam, mesh, x, y, z);
      visible++;
    }
    if (visible === 0) return;
    const total = this.drawTallied(cam, p.transientCount, plain ? DRAW_PLAIN : 0);
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (p.lit && this.speciesKind[kind] !== Number(plain)) continue;
      // A supply capsule is drawn from its drop, in pieces (showSupply), where the pack has its model.
      if (bodies.has(kind) || this.pitched[kind] !== 0 || this.clouds.kinds[kind] !== 0 || kind === this.capsuleKind || this.dropped.flying(kind, remote.anim[i]!)) continue;
      const lies = this.dropped.item(kind, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[kind]!;
      const r = this.radiusOfMesh[mesh]!;
      const mine = this.own !== null && remote.id[i] === this.skip;
      const x = (mine ? this.own!.x : remote.x[i]!) - cam.x;
      const y = (mine ? this.own!.y : remote.y[i]!) - cam.y;
      const z = (mine ? this.own!.z : remote.z[i]!) - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r) || this.hiding.hidesOver(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
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
        this.put.nearAt = near;
        this.put.draw(m, level, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0, flags, cam.passesOf(this.from[m]!, this.to[m]!));
      }
      total += counts[m]!;
    }
    this.put.nearAt = 0;
    return total;
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
        this.put.passOf[d] = this.put.passOf[d - 1]!;
        this.put.nearOf[d] = this.put.nearOf[d - 1]!;
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
      this.put.nearOf[d] = Math.max(0, lo);
      if (passes === (NEAR | FAR)) {
        let sections = 1;
        while (d + sections < p.drawCount && p.drawFirst[d + sections] === first && p.drawMesh[d + sections] === p.drawMesh[d]) sections++;
        if (p.drawCount + this.put.doubled + sections > MAX_DRAWS) {
          p.dropped++;
          passes = NEAR;
        } else {
          this.put.doubled += sections;
          p.triangles += this.trisOfMesh[p.drawMesh[d]!]![p.drawLod[d]!]! * p.drawInstances[d]!;
        }
      }
      this.put.passOf[d] = passes;
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

export { bodySeed, CUTOUTS, NEAR_BUCKETS, type Cutouts, type Thing };
