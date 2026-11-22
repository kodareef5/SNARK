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
import { TICK_RATE, type MapDims } from "../../../shared/coords.ts";
import { Assets } from "../assets/assets.ts";
import type { AssetPort } from "../assets/port.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { atlasBytes } from "../../../shared/pack/details.ts";
import { SKY_COLOR, WATER_COLOR } from "../../../shared/pack/palette.ts";
import { floatingKinds, landmarkKinds } from "../../../shared/world/city.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
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
import { FrameBudget } from "./budget.ts";
import type { FarCity, CitySource } from "./farcity.ts";
import type { CityBlocks, BlocksSource } from "./cityblocks.ts";
import type { RoofMap } from "./roofmap.ts";
import { FarLandmarks, LANDMARK_BUFFER } from "./farlandmarks.ts";
import { CrownCover } from "./cover.ts";
import { FarNodes, farLevelOf, familyOf, type FarNodeSource, type NodeLooks } from "./farnodes.ts";
import { Hiding } from "./hide.ts";
import { NearCity } from "./nearcity.ts";
import { OPTIC_AT, OPTIC_HEAT } from "./packet.ts";
import { BONE_FLOATS, GLASS_AT, DRAW_BENT, DRAW_BLEND, DRAW_CUTOUT, DRAW_GROUND, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_PULLED, DRAW_RANGED, DRAW_SKINNED, FRAME, FramePacket, InstanceWriter, MAX_BONES, MAX_DRAWS, MAX_TILES, PASS_FAR, PASS_NEAR, TRANSIENT_BUFFER, markJoins, texturedFlags, quadIndexCount, SHORE_AT } from "./packet.ts";
import { MADE_MARK, WorldFinishes, citySurface, finishTaps, surfaceCity, weatherBytes } from "./world-surfaces.ts";
import { recipeIndex } from "../../../content/texgen/finishes.ts";
import { FinishNear, NEAR_FRONT, NEAR_GLASS, NEAR_WALL } from "./finish-near.ts";
import { FacadeAtlases } from "./facade.ts";
import { UNDERWATER_DIM, UNDERWATER_VIEW } from "./shading.ts";
import { FADE_FROM, FADE_SHARE, SKY_ASKED, SKY_MATERIAL, VIEW_FADE, airFrame } from "./atmosphere.ts";
import { FarShadow } from "./farshadow.ts";
import { Cascades } from "./shadow.ts";
import { shadowBytes } from "./shadowtext.ts";
import { LampView } from "./lamp.ts";
import { ParkedContacts, contactFrame } from "./contact.ts";
import { lightBytes, lightSamples, opticFrame, postFrame, sceneSize, type Optic } from "./post.ts";
import { lampsOn, skyShown } from "./surface.ts";
import { SKY_SIZE, SKY_SLICES, flatLight, skyFrame, theSky } from "./sky.ts";
import { TerrainLod } from "./terrain.ts";
import type { MapLandmark } from "../../../shared/world/mapfile.ts";
import { landmarkFars } from "../../../shared/pack/far.ts";
import type { MotionSource } from "./motion.ts";
import { Frame, walk, type Pass } from "./pass.ts";
import { Casting } from "./casting.ts";
import { SupplyDrops } from "./passes/supply-drops.ts";
import { TideEyes } from "./passes/tide-eyes.ts";
import { Water } from "./passes/water.ts";
import { Occlusion } from "./passes/occlusion.ts";
import { CHUNK_CELLS, HIDDEN, NODE_BUFFERS, NearStore } from "./passes/near-store.ts";
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

/** Metres the far depth range of a frame with one begins at, through a sight: the lit tiers' split (tiers.ts). */
const WINDOW_SPLIT = 384;
/** The zoom from which a sight's focus has the terrain's fine window, the ground round the body unseen (D1087). */
const TERRAIN_FOCUS = 8;
const MISSING_MESH = "core:missing";
const QUAD_INDICES = "quad indices";
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



export class Scene {
  readonly packet = new FramePacket();
  readonly treeFalls = new TreeFalls();
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
  get hide(): boolean { return this.occlusion.on; }
  set hide(on: boolean) { this.occlusion.on = on; }
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
  /** Rigid species keep palette lighting; the static fallback finish belongs to world geometry. */
  private readonly speciesKind: Uint8Array;
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  /** The most indices of quads the card has been sent levels for, 16-bit and 32-bit, as the shell holds them once for all. */
  private readonly quadIndices = [0, 0];
  private quadsReserved = 0;
  /** Per mesh, the level its falling pieces were last drawn at, or -1. */
  private readonly fallLevel: Int8Array;
  /** Per mesh counted in `counts`, the square of how far off the nearest instance is, and how far along the view they all lie. */
  private readonly nearest: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
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
  /** The structures and nodes of the chunks held whole (passes/near-store.ts), whose settings tests and tools set through these. */
  private readonly nearStore: NearStore;
  get near(): NearCity | null { return this.nearStore.near; }
  get cover(): CrownCover { return this.nearStore.cover; }
  get chunkCells(): number { return this.nearStore.chunkCells; }
  set chunkCells(n: number) { this.nearStore.chunkCells = n; }
  get nearMesh(): boolean { return this.nearStore.nearMesh; }
  set nearMesh(on: boolean) { this.nearStore.nearMesh = on; }
  get structureDistance(): number { return this.nearStore.structureDistance; }
  set structureDistance(metres: number) { this.nearStore.structureDistance = metres; }
  hideNode(ref: number, hide: boolean): void { this.nearStore.hideNode(ref, hide); }
  /** The chunks' batches and the rooms' finder, which the rooms' tests read. */
  get batches(): NearStore["batches"] { return this.nearStore.batches; }
  get finder(): NearStore["finder"] { return this.nearStore.finder; }
  /** What hides what, found once the near store has drawn (passes/occlusion.ts). */
  private readonly occlusion: Occlusion;
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
    this.nearStore = new NearStore(world, reg, this.assets, this.packet, this.put, this.casting, this.budget, this.hiding, this.street, (stream?.manifest ?? pack.header).meshes, far, { meshOfKind: this.meshOfKind, colorOfKind: this.colorOfKind, meshOfForm: this.meshOfForm, colorOfForm: this.colorOfForm, sizeOfForm: this.sizeOfForm, mostOfForm: this.mostOfForm, reachOfMesh: this.reachOfMesh, reachOfStatic: this.reachOfStatic, groundFlags: this.groundFlags, bentKind: this.bentKind, regionsOfKind: this.regionsOfKind, treeOf: this.treeOf, trisOfMesh: this.trisOfMesh, radiusOfMesh: this.radiusOfMesh, trunkTris: this.trunkTris, leafTris: this.leafTris, landmarkKinds: this.landmarkKinds, missing });
    this.nearStore.far = this.far;
    this.occlusion = new Occlusion(world, this.assets, this.packet, this.put, this.casting, this.terrain, this.hiding, this.nearStore);
    this.startCity();
    const last = (mesh: number): ReturnType<NodeLooks["last"]> => this.assets.residency.heldGeometry(mesh, farLevelOf(this.assets.manifest.meshes[mesh]!.id, table.tris[mesh]!, opts.farPalms ?? false));
    const looks: NodeLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, colorOfForm: this.colorOfForm, side: table.side, low: table.low, high: table.high, tris: table.tris, last, known: (mesh) => this.assets.known(mesh) };
    if (world.farNodes) world.farNodes.hidden = ref => this.nearStore.hiddenNodes.has(ref);
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
    if (meshes.length > 0 && this.nearStore) this.nearStore.cover.stale = true;
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
    this.nearStore.reset();
    this.quadIndices[0] = this.quadIndices[1] = 0;
    this.assets.residency.reset();
    this.terrain.reset();
    this.far?.reset();
    this.nodesFar?.reset();
    this.city?.reset();
    this.nearStore.near?.reset();
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
    this.put.begin();
    this.hiding.on = false;
    this.nearStore.begin();
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
    f.handScale = this.handScale;
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
      this.nearStore,
      // What the near store's meshes and the ground hide, of what is drawn so far and from here on: the meshes themselves first.
      this.occlusion,
      this.nearStore.meshes,
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
          this.street.frame(p, f.cam, this.world, f.remote, this.nearStore.hiddenNodes, this.now, this.own);
          this.assets.residency.reserve("street environment", streetTextureBytes(p.tier.reflectionHz));
        },
      },
    ];
  }

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
    this.occlusion.forget();
    this.city = new Scene.late.FarCity(source, this.world.dims, this.world.hf, this.farMesh, this.farBounds, this.landmarkKinds, before);
    this.nearStore.city = this.occlusion.city = this.city;
    this.farShadow = new FarShadow(source.statics, this.world.hf, this.city, source.maker ?? null, source.complete, this.landmarkKinds, this.floatingKinds);
    this.farShadow.roof = new Scene.late.RoofMap();
    this.farShadow.roof.palette = this.groundPalette;
    this.far?.leaveTo(this.city);
    const placed = this.world.landmarks ?? [];
    if (placed.length > 0) this.landmarks = new FarLandmarks(source, this.world.dims, placed, landmarkFars(this.assets.manifest));
    this.movingStatics.landmarks = this.nearStore.landmarks = this.landmarks;
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

export { bodySeed, CHUNK_CELLS, CUTOUTS, NEAR_BUCKETS, NODE_BUFFERS, type Cutouts, type Thing };
