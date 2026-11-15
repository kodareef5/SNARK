// Structures are drawn per chunk and per mesh as instanced batches. A chunk's instance buffer is rebuilt only when a
// piece is added, removed or replaced, and uploaded once. Damage changes nothing that is drawn. Resource nodes are drawn
// the same way, each as the mesh of its form (shared/world/nodes.ts) at its size.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { Assets } from "../assets/assets.ts";
import type { AssetPort } from "../assets/port.ts";
import type { Manifest } from "../../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, type Pack } from "../../../shared/pack/pack.ts";
import { SKY_COLOR, WATER_COLOR } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { SIZE_UNITS, nodeForms } from "../../../shared/world/nodes.ts";
import { LOOK_BYTES } from "../../../shared/anim/look.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { GEAR_COUNT } from "../../../shared/sim/entities.ts";
import { AnimState, CUE_DEAD, CUE_HELD, PITCH_STEPS, bodySeed } from "../../../shared/anim/pose.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { Falling } from "../rubble.ts";
import type { Shots } from "../shots.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { Characters, showMaterials, type BodyShadows, type CastFn, type VehicleRenderPose, type VehicleSeatPose } from "./characters.ts";
import { Dropped } from "./dropped.ts";
import { FAR_BUFFER, FAR_MESH, FarBlocks, farColours, type FarSource } from "./far.ts";
import { FarNodes, type FarNodeSource, type NodeLooks } from "./farnodes.ts";
import { HAND_NEAR } from "./hand.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PULLED, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, DRAW_WATER, FRAME, FramePacket, InstanceWriter, LOOSE_BONES, MAX_BONES, MAX_CASCADES, MAX_CASTERS, MAX_DRAWS, MAX_TILES, MAX_WATER_TILES, PASS_FAR, PASS_NEAR, STEP_BODY, STEP_FAR, STEP_FAR_SEE, STEP_NEAR_SEE, TRANSIENT_BUFFER } from "./packet.ts";
import { UNDERWATER_DIM, UNDERWATER_VIEW, WATER_TILE } from "./shading.ts";
import { SKY_ASKED, SKY_MATERIAL, airFrame } from "./atmosphere.ts";
import { Cascades, MAX_REACH, reach } from "./shadow.ts";
import { shadowBytes } from "./shadowtext.ts";
import { SKY_SIZE, SKY_SLICES, flatLight, skyFrame, theSky, trueSun } from "./sky.ts";
import { TerrainLod, type CastTest } from "./terrain.ts";
import { WATER_ASKED, WATER_MATERIAL, seaFrame } from "./water.ts";

export interface RenderWorld {
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes, drawn as structures are. */
  readonly nodes?: StructureStore;
  /** Other bases past the near rows, drawn as blocks (far.ts). */
  readonly far?: FarSource;
  /** Trees, rocks and bushes past the near node field (farnodes.ts). */
  readonly farNodes?: FarNodeSource;
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
  attachment?: { host: number; slot: number; generation: number };
}

/** Instance buffers of the node store are numbered from here, clear of chunk indices. */
export const NODE_BUFFERS = 1 << 20;
/**
 * A chunk of nodes is cut into this many cells a side, 16 m across, and a mesh's nodes in it are drawn by cell, each cell
 * at the level its own distance asks for, so the plants at the far side of a chunk a player stands in are not drawn as
 * finely as those at his feet. Neighbouring cells of one level are one draw, so a chunk off in the distance is still one
 * draw for each mesh. Chosen on a wood with every slot filled (tools/bench/nodes.ts): by the chunk, 4.2 M triangles and
 * 96 draws a frame; by these cells, 3.5 M and 141 (3.4 M and 203 were cells never joined at the cost of a draw); by cells
 * of 8 m, 3.4 M and 154. Measured to the nodes' trunks and not their crowns, these cells give 3.3 M and 135, and 8 m ones
 * 3.3 M and 147.
 */
export const NODE_CELLS = 4;

/** Metres a rider's feet hang below its seat. Matches server/riding.ts. */
const SEAT_DROP = 0.55;
const MISSING_MESH = "core:missing";
const WATER_MESH = "core:water";
const BEAM_MESH = "core:beam";
/** Palette colour of the beam over a place of death. */
const BEAM_COLOR = 8;
/** A draw costs about what drawing this many more triangles does. Nodes in neighbouring cells share a draw when that saves more. */
const RUN_TRIANGLES = 4096;
/** A node form with nothing to draw: what is left of a used-up node whose mesh no pack has. */
const HIDDEN = 0xffff;
/** The one run of a level drawn flat: no material, and all its indices. */
const FLAT: readonly number[] = [-1, 0, 0];
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
/** What of a draw's flags a caster keeps: how its vertices are placed. */
const CAST_FLAGS = DRAW_SKINNED | DRAW_ONE_BONE | DRAW_SIZED;

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
  /** The table's `shape` when the instances were built. */
  shape: number;
  data: Uint8Array;
  slots: Uint16Array;
  /** Triples: mesh, first instance, instance count. */
  ranges: number[];
  /** The level each range was last drawn at, or -1. */
  level: Int8Array;
  /** Cells a range's instances are sorted into, in order: 1, or for nodes NODE_CELLS squared. */
  cells: number;
  /** Per range, the first instance of each cell and the end of the last. Null with one cell. */
  cellFirst: Uint32Array | null;
  /** Per range and cell: the box that holds its instances, x, y, z least then most, in metres. */
  cellBox: Float32Array | null;
  /** Per range and cell, the level it was last drawn at, or -1. */
  cellLevel: Int8Array | null;
  /**
   * Per range, and per range and cell, the largest size of the kinds of its nodes, as a multiple of the modelled size. Two
   * kinds may grow as one mesh at different sizes (the young live oak and the elder), and each is drawn by its own.
   */
  reach: Float32Array | null;
  cellReach: Float32Array | null;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  uploaded: boolean;
}

export class Scene {
  readonly packet = new FramePacket();
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
  /** Per material, the flags of a draw with it. */
  private readonly materialFlags: Uint8Array;
  private readonly world: RenderWorld;
  private readonly batches = new Map<number, ChunkBatch>();
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  /** Scratch for the runs of cells a mesh of a chunk of nodes is drawn in. */
  private readonly runs: number[] = [];
  /** Cells a chunk of nodes is cut into along each side, to choose levels by. NODE_CELLS, or 1 to choose them by the chunk. */
  nodeCells = NODE_CELLS;
  /** Per mesh and cell, as `counts` and `cursor` are per mesh, for a chunk of nodes. */
  private cellCounts = new Uint32Array(0);
  private cellCursor = new Uint32Array(0);
  /** Per mesh counted in `counts`, the square of how far off the nearest instance is, and how far along the view they all lie. */
  private readonly nearest: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  /** The depth ranges of each draw made so far, a bit each by PASS_, and how many draws are in both. */
  private readonly passOf = new Uint8Array(MAX_DRAWS);
  private doubled = 0;
  /**
   * For putting the draws in order: the packet's columns of draws, room for one of them as made and as ordered, each
   * draw's place in each range (its step, an opaque step's cut-outs a place after its other draws), where each place
   * begins, and the draw and range each place in the order takes.
   */
  private readonly columns: (Uint8Array | Uint16Array | Uint32Array | Float32Array)[];
  private readonly scratch = [new Float64Array(MAX_DRAWS * 3), new Float64Array(MAX_DRAWS * 3)] as const;
  private readonly steps = new Int8Array(MAX_DRAWS * 2);
  private readonly starts = new Int32Array(STEP_BODY + 4);
  private readonly source = new Uint16Array(MAX_DRAWS);
  private readonly sourcePass = new Uint8Array(MAX_DRAWS);
  /** The farthest any body's posed vertex gets from where its first bone puts its origin, short of its own mesh and offset. */
  private readonly bodySlack: number;
  private readonly transient: InstanceWriter;
  private readonly transientF32: Float32Array;
  private readonly transientU16: Uint16Array;
  private readonly waterMesh: number;
  /** The materials whose pictures the dome and the sea draw, or -1 where the pack has none. */
  private readonly skyMaterial: number;
  private readonly waterMaterial: number;
  private readonly beamMesh: number;
  /** Places to mark with a beam, x, y, z each. The app sets them before build(). */
  readonly beams: number[] = [];
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  readonly characters: Characters;
  private readonly vehicleSeats: (VehicleSeatPose | undefined)[] = new Array(MAX_VIEW);
  /** A bag of one stack, drawn as its item lying (dropped.ts). */
  private readonly dropped: Dropped;
  /** Null draws no body for the viewer. The app sets it before build(). */
  own: OwnBody | null = null;
  /** Index of an entity to leave out of the remote bodies, because `own` is that body as the viewer predicts it (a mount). -1 for none. */
  skip = -1;
  private readonly seatAt = [0, 0, 0];
  /** The bodies in view this frame: which remote entity each is, its place (x, y, z, yaw), and whether it gets only one bone. */
  private readonly bodyFrom = new Uint16Array(MAX_VIEW);
  private readonly bodyAt = new Float64Array(MAX_VIEW * 4);
  private readonly bodyRigid = new Uint8Array(MAX_VIEW);
  /** Scratch for sorting them: survivors before the rest, then by distance, with the body's number in the low bits. */
  private readonly bodyOrder = new Uint32Array(MAX_VIEW);
  private readonly mountState = new AnimState();
  private readonly state = new AnimState();
  /** The characters' draws, given their depth ranges once their instances are written (bodyPasses). */
  private readonly drawBody = (mesh: number, lod: number, first: number, count: number, flags: number, layer: number): void => this.draw(mesh, lod, TRANSIENT_BUFFER, first, count, 0, 0, 0, flags, NEAR, 0, layer);
  /** Bases drawn as blocks where the near store does not hold their chunks whole, given a far source and the far mesh. */
  private readonly far: FarBlocks | null;
  /** Nodes past the near node field, given a source of them. */
  readonly nodesFar: FarNodes | null;
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
  /** The camera of the frame being built. */
  private camera: Camera | null = null;
  /**
   * The cascades something in a camera-relative box casts into: those it can shade, its shadow reaching as far along the
   * light as its top stands over the floor, while that shadow can fall in view.
   */
  private readonly castBox: CastTest = (minX, minY, minZ, maxX, maxY, maxZ) => {
    const [dx, dy, dz] = [Math.max(minX, -maxX, 0), Math.max(minY, -maxY, 0), Math.max(minZ, -maxZ, 0)];
    if (dx * dx + dy * dy + dz * dz > this.castRange * this.castRange) return 0;
    const stretch = this.stretch(minX, minZ, maxX, maxZ, maxY);
    return this.inView(minX, minY, minZ, maxX, maxY, maxZ, stretch) ? this.cascades.mask(minX, minY, minZ, maxX, maxY, maxZ, Infinity, stretch) : 0;
  };
  private readonly bodyShadows: BodyShadows = {
    body: (x, y, z, r) => {
      if (Math.hypot(x, y, z) - r > this.castRange) return 0;
      const stretch = this.stretch(x - r, z - r, x + r, z + r, y + r);
      return this.inView(x - r, y - r, z - r, x + r, y + r, z + r, stretch) ? this.cascades.sphereMask(x, y, z, r, stretch) : 0;
    },
    mesh: (mesh) => this.cascades.fits(this.radiusOfMesh[mesh]!),
  };
  /**
   * The characters' casters: in each cascade the coarsest held level within its texel, but none finer than the held
   * level nearest the one the view draws.
   */
  private readonly castBody: CastFn = (mesh, lod, first, count, flags, cascades) => {
    const view = this.assets.heldLevel(mesh, lod);
    if (view < 0) return;
    const out = this.pairs;
    const n = this.cascades.entries(cascades, this.assets.table.error[mesh]!, this.assets.held(mesh), out);
    let left = cascades;
    for (let e = 0; e < n; e++) {
      if (out[e * 2]! <= view) continue;
      this.cast(mesh, out[e * 2]!, TRANSIENT_BUFFER, first, count, 0, 0, 0, flags, out[e * 2 + 1]!);
      left &= ~out[e * 2 + 1]!;
    }
    if (left !== 0) this.cast(mesh, view, TRANSIENT_BUFFER, first, count, 0, 0, 0, flags, left);
  };
  /** Linear RGB of the open sky and of deep water. */
  private readonly skyColor = new Float32Array(3);
  private readonly deepColor = new Float32Array(3);

  /** With `stream`, `pack` is the boot pack and other levels are asked of the port as they are wanted. */
  constructor(world: RenderWorld, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort }) {
    this.world = world;
    this.terrain = new TerrainLod(world.hf);
    this.assets = new Assets(reg, pack, stream?.manifest, stream?.port);
    // The renderer holds the sky table on every tier.
    this.assets.residency.reserve("sky table", SKY_SIZE * SKY_SIZE * SKY_SLICES * 4);
    const { table, bind } = this.assets;
    const missing = Math.max(0, table.find(MISSING_MESH));
    this.meshOfKind = new Uint16Array(reg.defs.length).fill(missing);
    this.colorOfKind = new Uint8Array(reg.defs.length);
    this.pitched = Uint8Array.from(reg.defs, (d) => (d?.type === "prop" && d.pitched ? 1 : 0));
    this.birthScale = reg.birthScale;
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!;
      if (!("mesh" in d)) continue;
      // A body drawn in parts has no one mesh. The characters draw it.
      const mesh = bind.mesh(d.id, d.type === "species" ? "body" : "mesh");
      this.meshOfKind[k] = mesh >= 0 ? mesh : missing;
      this.colorOfKind[k] = d.color;
    }
    const forms = nodeForms(reg);
    this.meshOfForm = new Uint16Array(forms.count).fill(HIDDEN);
    this.colorOfForm = new Uint8Array(forms.count);
    this.sizeOfForm = forms.size;
    this.mostOfForm = forms.most;
    this.reachOfMesh = new Float32Array(table.count).fill(1);
    for (let f = 1; f < forms.count; f++) {
      const kind = forms.kind[f]!;
      // A variant whose mesh no pack has yet stands as its kind's own mesh. What is left of a used-up node is not drawn.
      const own = forms.mesh[f] === "" ? -1 : table.find(forms.mesh[f]!);
      const mesh = own >= 0 ? own : forms.depleted[f] === 1 ? HIDDEN : this.meshOfKind[kind]!;
      this.meshOfForm[f] = mesh;
      this.colorOfForm[f] = this.colorOfKind[kind]!;
      if (mesh !== HIDDEN) this.reachOfMesh[mesh] = Math.max(this.reachOfMesh[mesh]!, forms.most[f]! / SIZE_UNITS);
    }
    this.trisOfMesh = table.tris;
    this.radiusOfMesh = table.radius;
    this.materialFlags = Uint8Array.from(table.materials, (m) => DRAW_TEXTURED | ((m.flags & MATERIAL_TWO_SIDED) !== 0 ? DRAW_TWO_SIDED : 0) | ((m.flags & MATERIAL_CUTOUT) !== 0 ? DRAW_CUTOUT : 0));
    this.counts = new Uint32Array(table.count);
    this.cursor = new Uint32Array(table.count);
    this.nearest = new Float32Array(table.count);
    this.from = new Float32Array(table.count);
    this.to = new Float32Array(table.count);
    this.transient = new InstanceWriter(this.packet.transient);
    const t = this.packet.transient;
    this.transientF32 = new Float32Array(t.buffer, t.byteOffset, t.byteLength >> 2);
    this.transientU16 = new Uint16Array(t.buffer, t.byteOffset, t.byteLength >> 1);
    this.characters = new Characters(reg, pack, this.assets);
    this.dropped = new Dropped(reg, bind);
    const p = this.packet as unknown as Record<string, unknown>;
    this.columns = Object.keys(p).filter((k) => k.startsWith("draw") && k !== "drawPass" && ArrayBuffer.isView(p[k])).map((k) => p[k] as Uint8Array);
    let reach = 0;
    for (let k = 1; k < reg.defs.length; k++) if (this.characters.has(k)) reach = Math.max(reach, this.characters.reach(k));
    this.bodySlack = reach * 2;

    const far = table.find(FAR_MESH);
    const shown = (k: number): number => (this.meshOfKind[k] === missing ? -1 : this.meshOfKind[k]!);
    this.far = world.far && far >= 0 ? new FarBlocks(world.far, world.dims, world.hf, far, pack.header.meshes[far]!, farColours(reg, pack, shown)) : null;
    const last = (mesh: number): ReturnType<NodeLooks["last"]> => this.assets.residency.bootLevel(mesh, table.tris[mesh]!.length - 1);
    const looks: NodeLooks = { meshOfForm: this.meshOfForm, sizeOfForm: this.sizeOfForm, colorOfForm: this.colorOfForm, side: table.side, low: table.low, high: table.high, tris: table.tris, last };
    this.nodesFar = world.farNodes ? new FarNodes(world.farNodes, world.far?.cells ?? null, world.dims, reg, looks) : null;
    this.waterMesh = table.find(WATER_MESH);
    this.beamMesh = table.find(BEAM_MESH);
    this.skyMaterial = table.materials.findIndex((m) => m.id === SKY_MATERIAL);
    this.waterMaterial = table.materials.findIndex((m) => m.id === WATER_MATERIAL);
    for (let k = 0; k < 3; k++) {
      this.skyColor[k] = pack.palette[SKY_COLOR * 4 + k]! / 255;
      this.deepColor[k] = (pack.palette[WATER_COLOR * 4 + k]! / 255) * UNDERWATER_DIM;
    }
  }

  /** Call after a lost graphics context. Every buffer and every level is uploaded again. */
  resetUploads(): void {
    for (const b of this.batches.values()) b.uploaded = false;
    this.assets.residency.reset();
    this.terrain.reset();
    this.far?.reset();
    this.nodesFar?.reset();
    this.cascades.clear();
  }

  build(cam: Camera, remote: RemoteSample | null): FramePacket {
    const p = this.packet;
    p.beginFrame();
    this.doubled = 0;
    cam.split = p.split = this.assets.tier.split;
    cam.update();
    this.assets.begin(this.now, this.viewHeight, cam.fovY);
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
      skyFrame(this.hour, theSky(), p.frame);
      airFrame(p.frame, theSky(), this.hour, cam.x, cam.z, this.now / 1000, this.viewDistance, this.plainSky ? 0 : p.tier.clouds, this.plainSky);
      if (!this.plainSky && this.skyMaterial >= 0) this.assets.residency.material(this.skyMaterial, SKY_ASKED.pixels, SKY_ASKED.distance);
    }
    this.fit(cam);

    // Under water the view is short and the fog is the water's colour, dimmed.
    const sea = this.world.hf.seaLevel;
    // Over a map with no sea the air is measured from 0, and the camera is never under water.
    p.frame[FRAME.eyeHeight] = sea > -Infinity ? cam.y - sea : Math.max(cam.y, 0);
    if (cam.y < sea) {
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
    if (this.far) this.farBlocks(cam);
    if (this.nodesFar) this.farNodes(cam);
    if (this.casting && !this.terrain.casters(cam, p, this.viewDistance, this.castBox)) p.casterDropped++;
    this.structures(cam, this.world.structs, 0, this.meshOfKind, this.colorOfKind, null);
    if (this.world.nodes) this.structures(cam, this.world.nodes, NODE_BUFFERS, this.meshOfForm, this.colorOfForm, this.sizeOfForm);
    if (remote) this.entities(cam, remote);
    this.bodies(cam, remote);
    if (this.beams.length > 0 && this.beamMesh >= 0) this.markBeams(cam);
    if (this.falling && this.falling.count > 0) this.showFalling(cam, this.falling);
    if (this.ghost.kind !== 0) this.showGhost(cam);
    if (this.things.length > 0) this.showThings(cam);
    if (sea > -Infinity && this.waterMesh >= 0) this.water(cam, sea);
    // The viewer's own body goes over everything else, water included.
    this.characters.flush(p, this.transient, true, this.drawBody, this.casting ? this.castBody : null);
    this.order();
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
      const [x, y, z, r] = [c.sphere[i * 4]!, c.sphere[i * 4 + 1]!, c.sphere[i * 4 + 2]!, c.sphere[i * 4 + 3]!];
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
    const [sx, sz] = [-this.sunAt[0]! * most, -this.sunAt[2]! * most];
    const low = this.terrain.lowest(p.camX + Math.min(minX, minX + sx), p.camZ + Math.min(minZ, minZ + sz), p.camX + Math.max(maxX, maxX + sx), p.camZ + Math.max(maxZ, maxZ + sz));
    return low > this.floor ? reach(top + p.camY - low, this.sunY) : most;
  }

  /** Whether the shadow of a camera-relative box, swept `stretch` metres away from the sun, can fall in view. */
  private inView(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, stretch: number): boolean {
    const [sx, sy, sz] = [-this.sunAt[0]! * stretch, -this.sunAt[1]! * stretch, -this.sunAt[2]! * stretch];
    return this.camera!.boxVisible(Math.min(minX, minX + sx), Math.min(minY, minY + sy), Math.min(minZ, minZ + sz), Math.max(maxX, maxX + sx), Math.max(maxY, maxY + sy), Math.max(maxZ, maxZ + sz));
  }

  /** Puts the meshes of a chunk whose box casts into `casts` in the caster list, each at the coarsest level held within a cascade's texel. */
  private castChunk(b: ChunkBatch, id: number, ox: number, oy: number, oz: number, casts: number, sized: boolean): void {
    const c = this.cascades;
    const out = this.pairs;
    for (let r = 0; r < b.ranges.length; r += 3) {
      const mesh = b.ranges[r]!;
      // A node is drawn up to its kind's largest size, which scales its radius and errors.
      const scale = sized ? this.reachOfMesh[mesh]! : 1;
      const mask = casts & c.fits(this.radiusOfMesh[mesh]! * scale);
      if (mask === 0) continue;
      const n = c.entries(mask, this.assets.table.error[mesh]!, this.assets.held(mesh), out, scale);
      for (let e = 0; e < n; e++) this.cast(mesh, out[e * 2]!, id, b.ranges[r + 1]!, b.ranges[r + 2]!, ox, oy, oz, sized ? DRAW_SIZED : 0, out[e * 2 + 1]!);
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
  }

  /**
   * Puts the draws in the order of the steps they are drawn in (packet.ts), each in the ranges `passOf` gives it, so a
   * draw in both is listed twice, and an opaque step's cut-out draws where `cutouts` says. With one range they are all
   * in the near range, and stay as they were made unless a cut-out is to move.
   */
  private order(): void {
    const p = this.packet;
    const n = p.drawCount;
    const one = p.split <= 0;
    // A cut-out's place and the rest's within the step, -1 for left out.
    const [cutAt, restAt] = this.cutouts === "last" ? [1, 0] : this.cutouts === "first" ? [0, 1] : this.cutouts === "none" ? [-1, 0] : [0, 0];
    if (one) {
      p.drawPass.fill(PASS_NEAR, 0, n);
      p.skyAt = n;
      let cut = false;
      for (let d = 0; d < n && !cut; d++) cut = cutAt !== restAt && (p.drawFlags[d]! & (DRAW_CUTOUT | DRAW_BLEND | DRAW_NEAR)) === DRAW_CUTOUT;
      if (!cut) return;
    }
    // Each draw's place in each range, -1 where it is not drawn in that range: its step as stepOf will find it, and in
    // an opaque step the cut-outs a place after the rest, or before it, or none.
    const steps = this.steps;
    const starts = this.starts.fill(0);
    for (let d = 0; d < n; d++) {
      const flags = p.drawFlags[d]!;
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        const drawn = one ? range === PASS_NEAR : (this.passOf[d]! & (1 << range)) !== 0;
        let s = !drawn ? -1 : (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - range : range;
        if ((flags & DRAW_NEAR) !== 0) s = range === PASS_NEAR ? STEP_BODY : -1;
        const at = s <= STEP_FAR && (flags & DRAW_CUTOUT) !== 0 ? cutAt : restAt;
        const place = s < 0 || at < 0 ? -1 : s <= STEP_FAR ? s * 2 + at : s + 2;
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
    if (moved) {
      // By way of float64 copies, since JavaScriptCore is many times slower at one loop that writes typed arrays of several kinds.
      const [from, to] = this.scratch;
      for (const a of this.columns) {
        const w = a.length / MAX_DRAWS;
        from.set(a.subarray(0, n * w));
        for (let k = 0; k < total; k++) for (let j = 0; j < w; j++) to[k * w + j] = from[source[k]! * w + j]!;
        a.set(to.subarray(0, total * w));
      }
    }
    p.drawPass.set(pass.subarray(0, total));
    p.drawCount = total;
  }

  /** Bases as blocks to the tier's reach, faded over the last of it, in place of chunks the near store does not hold whole. */
  private farBlocks(cam: Camera): void {
    const p = this.packet;
    const tier = this.assets.tier;
    p.frame[FRAME.fade] = tier.fade;
    this.far!.update(p, this.assets.residency, cam.x, cam.z, tier.reach.bases);
    this.far!.draw(cam, tier.reach.bases, this.drawFar);
  }

  /** A tile of far blocks: one instance of its own level, gone at the tier's reach. */
  private readonly drawFar = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    [p.drawMesh[d], p.drawLod[d], p.drawSlot[d], p.drawBuffer[d], p.drawFirst[d], p.drawInstances[d], p.drawFlags[d]] = [this.far!.mesh, 0, slot, FAR_BUFFER, 0, 1, 0];
    p.drawOffset.set([ox, oy, oz], d * 3);
    p.drawFade[d] = this.assets.tier.reach.bases;
    this.passOf[d] = passes;
    p.drawCount = d + 1;
    this.doubled += copies - 1;
    p.triangles += triangles * copies;
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
    [p.drawMesh[d], p.drawLod[d], p.drawSlot[d], p.drawBuffer[d], p.drawFirst[d], p.drawInstances[d], p.drawFlags[d]] = [mesh, 0, slot, buffer, first, count, DRAW_PULLED];
    p.drawOffset.set([ox, oy, oz], d * 3);
    [p.drawFade[d], p.drawHand[d]] = [reach, hand];
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
    ch.begin();
    let unseen = 0;
    if (remote) {
      this.vehicleSeats.fill(undefined, 0, remote.count);
      // First which bodies are in view and where, then which of them the frame has the bones to pose.
      const from = this.bodyFrom;
      const place = this.bodyAt;
      const rigid = this.bodyRigid;
      let n = 0;
      let wanted = 0;
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        // A dead creature's body is drawn where it lies, by ch.corpses.
        if (!ch.has(kind) || remote.id[i] === this.skip || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
        let x = remote.x[i]! - cam.x;
        let y = remote.y[i]! - cam.y;
        let z = remote.z[i]! - cam.z;
        let yaw = remote.yaw[i]!;
        // A rider is drawn on its mount's seat, and a creature held in someone's arms in them. The viewer's own body is
        // placed as predicted, any other as the server sent it.
        const on = remote.seat[i]! - 1;
        if (on >= 0) {
          const at = this.seatAt;
          const held = (remote.cue[i]! & CUE_HELD) !== 0;
          let found = false;
          if (own && own.id === on && (remote.seatSlot[i] === 0 || own.generation === remote.seatGen[i])) {
            found = held ? ch.heldAt(remote.id[i]!, kind, on, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, at) : ch.seat(own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, at, remote.seatSlot[i]!, own.vehicle);
            yaw = own.yaw;
            if (found && !held && ch.vehicle(own.kind)) this.vehicleSeats[i] = { ...own.vehicle!, x: at[0]!, y: at[1]!, z: at[2]!, yaw, driver: remote.seatSlot[i] !== 2, aimYaw: remote.yaw[i]! };
          } else {
            for (let j = 0; j < remote.count && !found; j++) {
              if (remote.id[j] !== on) continue;
              if (remote.seatSlot[i] !== 0 && remote.seatGen[i] !== remote.gen[j]) continue;
              const ms = this.mountState;
              ms.unpack(remote.anim[j]!, remote.cue[j]!);
              ms.seed = bodySeed(on);
              const vehicle = this.remoteVehicle(remote, j);
              found = held ? ch.heldAt(remote.id[i]!, kind, on, remote.kind[j]!, remote.x[j]! - cam.x, remote.y[j]! - cam.y, remote.z[j]! - cam.z, remote.yaw[j]!, ms, at) : ch.seat(remote.kind[j]!, remote.x[j]! - cam.x, remote.y[j]! - cam.y, remote.z[j]! - cam.z, remote.yaw[j]!, ms, remote.tick, at, remote.seatSlot[i]!, vehicle);
              yaw = remote.yaw[j]!;
              if (found && !held && ch.vehicle(remote.kind[j]!)) this.vehicleSeats[i] = { ...vehicle, x: at[0]!, y: at[1]!, z: at[2]!, yaw, driver: remote.seatSlot[i] !== 2, aimYaw: remote.yaw[i]! };
            }
          }
          if (found) {
            x = at[0]!;
            y = at[1]! - (held || this.vehicleSeats[i] ? 0 : SEAT_DROP);
            z = at[2]!;
          }
        }
        const r = ch.reach(kind);
        if (!cam.boxVisible(x - r, y - 0.3, z - r, x + r, y + (r > 2.2 ? r : 2.2), z + r)) {
          // Out of view, a body whose shadow may fall in it is posed after those in view, while bones are left.
          if (this.casting && this.bodyShadows.body(x, y, z, r) !== 0) {
            this.unseenFrom[unseen] = i;
            this.unseenAt.set([x, y, z, yaw], unseen * 4);
            unseen++;
          }
          continue;
        }
        from[n] = i;
        place[n * 4] = x;
        place[n * 4 + 1] = y;
        place[n * 4 + 2] = z;
        place[n * 4 + 3] = yaw;
        wanted += ch.bones(kind);
        n++;
      }
      // The tier's bones, less those of the viewer's own body, which comes last, and at the top tier those of loose things.
      const budget = Math.min(this.assets.tier.bones, MAX_BONES - LOOSE_BONES) - (own && ch.has(own.kind) ? ch.bones(own.kind) : 0);
      rigid.fill(0, 0, n);
      if (wanted > budget) {
        // Survivors are posed first, then whatever is nearest, while one bone is left for each body still waiting. Those get that one.
        const order = this.bodyOrder;
        for (let k = 0; k < n; k++) {
          const far = Math.sqrt(place[k * 4]! * place[k * 4]! + place[k * 4 + 1]! * place[k * 4 + 1]! + place[k * 4 + 2]! * place[k * 4 + 2]!);
          order[k] = (ch.human(remote.kind[from[k]!]!) ? 0 : 0x80000000) + Math.min(Math.floor(far * 256), 0xfffff) * MAX_VIEW + k;
        }
        sortU32(order, n);
        let left = budget - n;
        let k = 0;
        for (; k < n; k++) {
          const more = ch.bones(remote.kind[from[order[k]! % MAX_VIEW]!]!) - 1;
          if (more > left) break;
          left -= more;
        }
        for (; k < n; k++) rigid[order[k]! % MAX_VIEW] = 1;
      }
      for (let k = 0; k < n; k++) this.addRemote(remote, from[k]!, place, k, rigid[k] !== 0, false);
      // Pitched props, such as an arrow where it landed.
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
    if (own && ch.has(own.kind)) {
      let seat: VehicleSeatPose | undefined;
      if (own.attachment && remote) for (let j = 0; j < remote.count; j++) {
        if (remote.id[j] !== own.attachment.host || remote.gen[j] !== own.attachment.generation || !ch.vehicle(remote.kind[j]!)) continue;
        const vehicle = this.remoteVehicle(remote, j), at = this.seatAt;
        if (ch.seat(remote.kind[j]!, remote.x[j]! - cam.x, remote.y[j]! - cam.y, remote.z[j]! - cam.z, remote.yaw[j]!, this.mountState, remote.tick, at, own.attachment.slot, vehicle)) {
          seat = { ...vehicle, x: at[0]!, y: at[1]!, z: at[2]!, yaw: remote.yaw[j]!, driver: own.attachment.slot !== 2, aimYaw: own.yaw };
        }
        break;
      }
      ch.add(p, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson, 1, false, false, own.vehicle, seat);
    }
    if (remote && unseen > 0) this.poseUnseen(remote, unseen);
    const from = p.drawCount;
    ch.flush(p, this.transient, false, this.drawBody, this.casting ? this.castBody : null);
    if (cam.split > 0) this.bodyPasses(cam, from);
  }

  /** Poses remote entity `i` at the place `at` holds at `k` (x, y, z camera-relative, and yaw), for the view or, `unseen`, for its shadow alone. */
  private addRemote(remote: RemoteSample, i: number, at: Float64Array, k: number, rigid: boolean, unseen: boolean): void {
    const st = this.state;
    const kind = remote.kind[i]!;
    st.unpack(remote.anim[i]!, remote.cue[i]!);
    st.seed = bodySeed(remote.id[i]!);
    const look = remote.hasLook[i] !== 0 ? remote.look : null;
    const size = remote.grown[i] !== 0 ? youngScale(this.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    this.characters.add(this.packet, kind, at[k * 4]!, at[k * 4 + 1]!, at[k * 4 + 2]!, at[k * 4 + 3]!, st, remote.tick, look, i * LOOK_BYTES, remote.colors, i * 6, remote.gear, i * GEAR_COUNT, remote.id[i]!, false, false, size, rigid, unseen, this.remoteVehicle(remote, i), this.vehicleSeats[i]);
  }

  private remoteVehicle(remote: RemoteSample, i: number): VehicleRenderPose {
    return { pitch: remote.vehiclePitch[i]!, roll: remote.vehicleRoll[i]!, steering: remote.steering[i]!, wheelAngle: remote.wheelAngle[i]!, groundPitch: remote.vehicleGroundPitch[i]!, groundRoll: remote.vehicleGroundRoll[i]!, rideOffset: remote.vehicleRideOffset[i]!, grounded: remote.vehicleGrounded[i] !== 0, doorLeft: remote.vehicleDoorLeft[i]!, doorRight: remote.vehicleDoorRight[i]! };
  }

  /**
   * Poses the bodies out of view whose shadows may fall in it, nearest first, by the same call as a body in view, so a
   * shadow matches its body when it walks in. They take the tier's bones those in view leave, and stand rigid when one
   * bone is all that is left.
   */
  private poseUnseen(remote: RemoteSample, count: number): void {
    const p = this.packet;
    const place = this.unseenAt;
    const order = this.bodyOrder;
    for (let k = 0; k < count; k++) order[k] = Math.min(Math.floor(Math.hypot(place[k * 4]!, place[k * 4 + 1]!, place[k * 4 + 2]!) * 256), 0xfffff) * MAX_VIEW + k;
    sortU32(order, count);
    const limit = Math.min(this.assets.tier.bones, MAX_BONES);
    for (let o = 0; o < count; o++) {
      const k = order[o]! % MAX_VIEW;
      const i = this.unseenFrom[k]!;
      const rigid = p.boneCount + this.characters.bones(remote.kind[i]!) > limit;
      if (rigid && p.boneCount >= limit) break;
      this.addRemote(remote, i, place, k, rigid, true);
    }
  }

  private showFalling(cam: Camera, f: Falling): void {
    const p = this.packet;
    this.counts.fill(0);
    for (let i = 0; i < f.count; i++) this.tally(cam, this.meshOfKind[f.kind[i]!]!, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z);
    const total = this.drawTallied(cam, p.transientCount);
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
    const [x, y, z] = [g.x - cam.x, g.y - cam.y, g.z - cam.z];
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
      const [x, y, z] = [t.x - cam.x, t.y - cam.y, t.z - cam.z];
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

  private markBeams(cam: Camera): void {
    const p = this.packet;
    const first = p.transientCount;
    let n = 0;
    let from = Infinity;
    let to = -Infinity;
    const r = this.radiusOfMesh[this.beamMesh]!;
    for (let i = 0; i + 2 < this.beams.length && n < 16; i += 3) {
      const [x, y, z] = [this.beams[i]! - cam.x, this.beams[i + 1]! - cam.y, this.beams[i + 2]! - cam.z];
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
   * Tiles of one flat mesh over the map, drawn last because they are see-through. On a lit tier the sea seen from above
   * runs on past the map to the end of the view, and is drawn with its waves and its depth (water.ts); seen from under
   * it, or in a plain sky, it is as it always was.
   */
  private water(cam: Camera, sea: number): void {
    const p = this.packet;
    const hf = this.world.hf;
    const first = p.transientCount;
    let n = 0;
    const half = WATER_TILE / 2;
    const lit = p.lit && !this.plainSky && cam.y >= sea;
    const r = Math.ceil(this.viewDistance / WATER_TILE);
    const [cx, cz] = [Math.floor(cam.x / WATER_TILE), Math.floor(cam.z / WATER_TILE)];
    const [ix0, iz0, ix1, iz1] = lit ? [cx - r, cz - r, cx + r, cz + r] : [0, 0, Math.ceil(hf.sizeX / WATER_TILE) - 1, Math.ceil(hf.sizeZ / WATER_TILE) - 1];
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
        if (!cam.boxVisible(x - half, y - 0.1, z - half, x + half, y + 0.1, z + half)) continue;
        if (n === MAX_WATER_TILES) {
          p.dropped++;
          continue;
        }
        this.transient.set(first + n, x, y, z, 0, WATER_COLOR);
        p.transientIds[first + n] = 0;
        n++;
        [x0, z0, x1, z1] = [Math.min(x0, x - half), Math.min(z0, z - half), Math.max(x1, x + half), Math.max(z1, z + half)];
      }
    }
    if (n === 0) return;
    const d = p.drawCount;
    this.draw(this.waterMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, lit ? DRAW_BLEND | DRAW_WATER : DRAW_BLEND, cam.passes(x0, sea - cam.y - 0.1, z0, x1, sea - cam.y + 0.1, z1));
    p.transientCount = first + n;
    if (!lit || p.drawCount === d) return;
    p.drawMaterial[d] = this.waterMaterial;
    seaFrame(p.frame, hf, this.terrain.size, p.groundWindow, cam.x, cam.z, this.now / 1000);
    if (this.waterMaterial >= 0) this.assets.residency.material(this.waterMaterial, WATER_ASKED.pixels, WATER_ASKED.distance);
  }

  /**
   * Chunk `c` of the store uses instance buffer `base + c`. A slot's kind is drawn as `meshOf` and `colorOf` say, and at the
   * size `sizeOf` says if it is given.
   */
  private structures(cam: Camera, store: StructureStore, base: number, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null): void {
    const p = this.packet;
    const world = this.world;
    const chunks = store.chunks;

    // Chunks that no longer exist on this client free their buffers.
    for (const [id, batch] of this.batches) {
      if (id < base || id >= base + NODE_BUFFERS || chunks[id - base]) continue;
      if (batch.uploaded) p.drops.push(id);
      this.batches.delete(id);
    }

    for (let chunk = 0; chunk < chunks.length; chunk++) {
      const t = chunks[chunk];
      const id = base + chunk;
      if (!t || t.live === 0) {
        const stale = this.batches.get(id);
        if (stale) {
          if (stale.uploaded) p.drops.push(id);
          this.batches.delete(id);
        }
        continue;
      }
      // Until the near store holds it whole, a chunk the far feed has cells of is drawn as blocks.
      if (base === 0 && this.far?.isFar(chunk)) continue;
      let batch = this.batches.get(id);
      if (!batch || batch.shape !== t.shape) batch = this.rebuild(store, chunk, id, batch, meshOf, colorOf, sizeOf);
      const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
      const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
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
      const seen = cam.boxVisible(ax, ay, az, bx, by, bz) && dist <= this.viewDistance && dist <= this.structureDistance && (sizeOf === null || dist < this.assets.tier.nodes.band[1]);
      // A chunk out of view may still cast into it.
      const casts = this.casting ? this.castBox(ax, ay, az, bx, by, bz) : 0;
      if (!seen && casts === 0) continue;
      if (!batch.uploaded) {
        p.uploads.push({ buffer: id, data: batch.data, slots: batch.slots });
        batch.uploaded = true;
      }
      if (seen) {
        const passes = cam.passes(ax, ay, az, bx, by, bz);
        if (batch.cells > 1) this.nodeRanges(cam, batch, id, dist, x0, z0, passes);
        else {
          for (let r = 0; r < batch.ranges.length; r += 3) {
            const mesh = batch.ranges[r]!;
            const lod = (batch.level[r / 3] = this.assets.choose(this.assets.table.error[mesh]!, dist, batch.level[r / 3]!));
            this.assets.wantTextured(mesh, lod, dist);
            this.draw(mesh, lod, id, batch.ranges[r + 1]!, batch.ranges[r + 2]!, x0 - cam.x, -cam.y, z0 - cam.z, 0, passes);
          }
        }
      }
      if (casts !== 0) this.castChunk(batch, id, x0 - cam.x, -cam.y, z0 - cam.z, casts, sizeOf !== null);
    }
  }

  /**
   * Draws a chunk of nodes `dist` metres off. A mesh's level is chosen as if each node of it were its kind's largest, and a
   * cell holding nodes of two kinds of it as if all were the larger kind's largest. Where the chunk's nearest and
   * farthest points ask for the same level and all of it is short of the tier's hand-over band, each mesh is one draw;
   * otherwise each cell takes the level the nearest of its nodes asks for, measured to its trunk. A cell all past the band
   * is left to the far store, and one that reaches into it fades out over it as the far store's draw fades in (hand.ts).
   * Every draw of the chunk is in the depth ranges `passes`.
   */
  private nodeRanges(cam: Camera, b: ChunkBatch, id: number, dist: number, x0: number, z0: number, passes: number): void {
    const [from, to] = this.assets.tier.nodes.band;
    const cells = b.cells;
    const first = b.cellFirst!;
    const box = b.cellBox!;
    const levels = b.cellLevel!;
    const fx = Math.max(Math.abs(b.minX - cam.x), Math.abs(b.maxX - cam.x));
    const fy = Math.max(Math.abs(b.minY - cam.y), Math.abs(b.maxY - cam.y));
    const fz = Math.max(Math.abs(b.minZ - cam.z), Math.abs(b.maxZ - cam.z));
    const far = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const [ox, oy, oz] = [x0 - cam.x, -cam.y, z0 - cam.z];
    for (let r = 0, q = 0; r < b.ranges.length; r += 3, q++) {
      const mesh = b.ranges[r]!;
      const errors = this.assets.table.error[mesh]!;
      const reach = b.reach![q]!;
      const near = this.assets.choose(errors, dist / reach, b.level[q]!);
      if (far <= from && near === this.assets.choose(errors, far / reach, b.level[q]!)) {
        b.level[q] = near;
        levels.fill(near, q * cells, (q + 1) * cells);
        this.assets.wantTextured(mesh, near, dist / reach);
        this.draw(mesh, near, id, b.ranges[r + 1]!, b.ranges[r + 2]!, ox, oy, oz, DRAW_SIZED, passes);
        continue;
      }
      b.level[q] = -1;
      // Runs of neighbouring cells, each drawn at the finest level any of its cells asks for. A cell joins the run before it
      // when they ask for the same level, or for levels one apart and drawing the coarser at the finer costs fewer
      // triangles than a draw does. So no node is drawn more than one level finer than its own cell asks. A run fades
      // over the band where a cell of it reaches into it, which keeps every pixel of a node short of it.
      const tris = this.trisOfMesh[mesh]!;
      const runs = this.runs;
      runs.length = 0;
      for (let c = 0; c < cells; c++) {
        const at = q * (cells + 1) + c;
        const n = first[at + 1]! - first[at]!;
        if (n === 0) continue;
        const k = (q * cells + c) * 6;
        const dx = Math.max(box[k]! - cam.x, cam.x - box[k + 3]!, 0);
        const dy = Math.max(box[k + 1]! - cam.y, cam.y - box[k + 4]!, 0);
        const dz = Math.max(box[k + 2]! - cam.z, cam.z - box[k + 5]!, 0);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= to) continue;
        const most = Math.hypot(Math.max(Math.abs(box[k]! - cam.x), Math.abs(box[k + 3]! - cam.x)), Math.max(Math.abs(box[k + 1]! - cam.y), Math.abs(box[k + 4]! - cam.y)), Math.max(Math.abs(box[k + 2]! - cam.z), Math.abs(box[k + 5]! - cam.z)));
        const hand = most > from ? HAND_NEAR : 0;
        const seen = d / b.cellReach![q * cells + c]!;
        const level = (levels[q * cells + c] = this.assets.choose(errors, seen, levels[q * cells + c]!));
        // A run is its first and end instance, its level, the coarsest level a cell of it asked for, its nearest distance, and its hand-over.
        const last = runs.length - 6;
        if (last >= 0 && runs[last + 1] === first[at]) {
          const [finer, coarser] = [Math.min(runs[last + 2]!, level), Math.max(runs[last + 3]!, level)];
          const coarse = level > runs[last + 2]! ? n : level < runs[last + 2]! ? runs[last + 1]! - runs[last]! : 0;
          if (coarser - finer <= 1 && coarse * ((tris[finer] ?? 0) - (tris[coarser] ?? 0)) <= RUN_TRIANGLES) {
            [runs[last + 1], runs[last + 2], runs[last + 3], runs[last + 4], runs[last + 5]] = [first[at + 1]!, finer, coarser, Math.min(runs[last + 4]!, seen), runs[last + 5]! | hand];
            continue;
          }
        }
        runs.push(first[at]!, first[at + 1]!, level, level, seen, hand);
      }
      for (let k = 0; k < runs.length; k += 6) {
        this.assets.wantTextured(mesh, runs[k + 2]!, runs[k + 4]!);
        this.draw(mesh, runs[k + 2]!, id, runs[k]!, runs[k + 1]! - runs[k]!, ox, oy, oz, DRAW_SIZED, passes, runs[k + 5]!);
      }
    }
  }

  /**
   * The instances of a chunk of the store, each mesh's together. A chunk of nodes (`sizeOf` given) has each mesh's sorted into
   * NODE_CELLS squared cells, one row and then the next back the other way, so that neighbouring cells follow one another.
   */
  private rebuild(store: StructureStore, chunk: number, id: number, old: ChunkBatch | undefined, meshOf: Uint16Array, colorOf: Uint8Array, sizeOf: Uint8Array | null): ChunkBatch {
    const world = this.world;
    const t = store.chunks[chunk]!;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const side = sizeOf ? this.nodeCells : 1;
    const cells = side * side;
    if (this.cellCounts.length < this.counts.length * cells) {
      this.cellCounts = new Uint32Array(this.counts.length * cells);
      this.cellCursor = new Uint32Array(this.counts.length * cells);
    }
    const cellOf = (x: number, z: number): number => {
      const i = Math.min(side - 1, Math.max(0, Math.floor(((x - x0) * side) / CHUNK_SIZE)));
      const j = Math.min(side - 1, Math.max(0, Math.floor(((z - z0) * side) / CHUNK_SIZE)));
      return j * side + (j & 1 ? side - 1 - i : i);
    };
    const counts = this.cellCounts.fill(0, 0, this.counts.length * cells);
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && meshOf[t.kind[s]!] !== HIDDEN) counts[meshOf[t.kind[s]!]! * cells + cellOf(t.x[s]!, t.z[s]!)]!++;
    const ranges: number[] = [];
    let total = 0;
    for (let m = 0; m < this.counts.length; m++) {
      const from = total;
      for (let c = 0; c < cells; c++) {
        this.cellCursor[m * cells + c] = total;
        total += counts[m * cells + c]!;
      }
      if (total > from) ranges.push(m, from, total - from);
    }
    const n = ranges.length / 3;
    const data = old && old.data.length === total * INSTANCE_BYTES ? old.data : new Uint8Array(total * INSTANCE_BYTES);
    const slots = old && old.slots.length === total ? old.slots : new Uint16Array(total);
    const w = new InstanceWriter(data);
    const b: ChunkBatch = {
      shape: t.shape,
      data,
      slots,
      ranges,
      level: new Int8Array(n).fill(-1),
      cells,
      cellFirst: cells > 1 ? new Uint32Array(n * (cells + 1)) : null,
      cellBox: cells > 1 ? new Float32Array(n * cells * 6) : null,
      cellLevel: cells > 1 ? new Int8Array(n * cells).fill(-1) : null,
      reach: cells > 1 ? new Float32Array(n) : null,
      cellReach: cells > 1 ? new Float32Array(n * cells) : null,
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      uploaded: false,
    };
    const box = b.cellBox;
    if (box) {
      for (let k = 0; k < box.length; k += 6) box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], k);
      for (let q = 0; q < n; q++) {
        const m = ranges[q * 3]!;
        for (let c = 0; c < cells; c++) b.cellFirst![q * (cells + 1) + c] = this.cellCursor[m * cells + c]!;
        b.cellFirst![q * (cells + 1) + cells] = ranges[q * 3 + 1]! + ranges[q * 3 + 2]!;
        this.cursor[m] = q;
      }
    }
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0 || meshOf[kind] === HIDDEN) continue;
      const mesh = meshOf[kind]!;
      const x = t.x[s]!;
      const y = t.y[s]!;
      const z = t.z[s]!;
      const cell = cells > 1 ? cellOf(x, z) : 0;
      const i = this.cellCursor[mesh * cells + cell]!++;
      w.set(i, x - x0, y, z - z0, t.yaw[s]!, colorOf[kind]!);
      if (sizeOf) w.size(i, sizeOf[kind]!);
      slots[i] = s;
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
      if (!box) continue;
      // A cell's level is chosen by how far its nodes stand, at their trunks. Measured to their crowns, a live oak's 15 m
      // of limbs drew every oak of the cell as finely as one by the camera.
      const at = (this.cursor[mesh]! * cells + cell) * 6;
      box[at] = Math.min(box[at]!, x);
      box[at + 1] = Math.min(box[at + 1]!, lo);
      box[at + 2] = Math.min(box[at + 2]!, z);
      box[at + 3] = Math.max(box[at + 3]!, x);
      box[at + 4] = Math.max(box[at + 4]!, hi);
      box[at + 5] = Math.max(box[at + 5]!, z);
      const most = this.mostOfForm[kind]! / SIZE_UNITS;
      b.reach![this.cursor[mesh]!] = Math.max(b.reach![this.cursor[mesh]!]!, most);
      b.cellReach![this.cursor[mesh]! * cells + cell] = Math.max(b.cellReach![this.cursor[mesh]! * cells + cell]!, most);
    }
    this.batches.set(id, b);
    return b;
  }

  private entities(cam: Camera, remote: RemoteSample): void {
    const p = this.packet;
    this.counts.fill(0);
    let visible = 0;
    const bodies = this.characters;
    for (let i = 0; i < remote.count; i++) {
      if (bodies.has(remote.kind[i]!) || this.pitched[remote.kind[i]!] !== 0) continue;
      // A bag of one stack is drawn as its item, where the item has a lying mesh.
      const lies = this.dropped.item(remote.kind[i]!, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[remote.kind[i]!]!;
      const r = this.radiusOfMesh[mesh]!;
      const x = remote.x[i]! - cam.x;
      const y = remote.y[i]! - cam.y;
      const z = remote.z[i]! - cam.z;
      // Culled entries are left out of the counts. The second pass repeats the test.
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      this.tally(cam, mesh, x, y, z);
      visible++;
    }
    if (visible === 0) return;
    const total = this.drawTallied(cam, p.transientCount);
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (bodies.has(kind) || this.pitched[kind] !== 0) continue;
      const lies = this.dropped.item(kind, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[kind]!;
      const r = this.radiusOfMesh[mesh]!;
      const x = remote.x[i]! - cam.x;
      const y = remote.y[i]! - cam.y;
      const z = remote.z[i]! - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      const at = this.cursor[mesh]!++;
      const yaw = Math.round((remote.yaw[i]! / (2 * Math.PI)) * 65536) & 0xffff;
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
    if (this.counts[mesh] === 0) [this.nearest[mesh], this.from[mesh], this.to[mesh]] = [far, along - r, along + r];
    else {
      if (far < this.nearest[mesh]!) this.nearest[mesh] = far;
      if (along - r < this.from[mesh]!) this.from[mesh] = along - r;
      if (along + r > this.to[mesh]!) this.to[mesh] = along + r;
    }
    this.counts[mesh]!++;
  }

  /**
   * Draws what was tallied, the instances of each mesh together, from transient instance `total` on. Returns where
   * they end. They are drawn at their finest however far off, so only their materials are told how near they are.
   */
  private drawTallied(cam: Camera, total: number): number {
    const counts = this.counts;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) {
        showMaterials(this.assets, m, Math.sqrt(this.nearest[m]!));
        this.draw(m, 0, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0, 0, cam.passesOf(this.from[m]!, this.to[m]!));
      }
      total += counts[m]!;
    }
    return total;
  }

  /**
   * Draws `count` instances of a mesh at the level the card has nearest to `wanted`: one draw for each of the level's
   * sections when the card has everything its materials take, and otherwise one flat draw of the whole of it. `passes`
   * are the depth ranges it is drawn in (Camera.passes), and a draw in both takes the room of two. A section whose
   * material has its layer on the card draws it at `layer`.
   */
  private draw(mesh: number, wanted: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, passes: number, hand = 0, layer = 0): void {
    const p = this.packet;
    const n = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (n + this.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    let lod = this.assets.level(mesh, wanted);
    if (lod < 0) {
      p.skipped++;
      return;
    }
    const sections = this.assets.table.sections[mesh]!;
    // What is see-through is drawn flat.
    const solid = (flags & DRAW_BLEND) === 0;
    let ready = solid && this.assets.textured(mesh, lod);
    // While the level wanted cannot be drawn with its materials, a finer one that can is drawn in its place, so that a
    // thing does not turn flat on its way from one level to the next.
    if (solid && !ready && sections[wanted < sections.length ? wanted : sections.length - 1]!.length > 0) {
      for (let l = lod - 1; l >= 0 && !ready; l--) if ((ready = this.assets.textured(mesh, l))) lod = l;
    }
    const runs = ready ? sections[lod]! : FLAT;
    const draws = runs.length / 3;
    // A mesh the frame has no room for all of is left out whole.
    if (n + this.doubled + draws * copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    const slot = this.assets.residency.slot(mesh, lod);
    for (let k = 0; k < draws; k++) {
      const d = n + k;
      const material = runs[k * 3]!;
      this.passOf[d] = passes;
      p.drawMesh[d] = mesh;
      p.drawLod[d] = lod;
      p.drawSlot[d] = slot;
      p.drawBuffer[d] = buffer;
      p.drawFirst[d] = first;
      p.drawInstances[d] = count;
      p.drawOffset[d * 3] = ox;
      p.drawOffset[d * 3 + 1] = oy;
      p.drawOffset[d * 3 + 2] = oz;
      p.drawFlags[d] = material < 0 ? flags : flags | this.materialFlags[material]!;
      p.drawHand[d] = hand;
      p.drawLayer[d] = layer > 0 && material >= 0 && this.assets.layered(material) ? layer : 0;
      if (material < 0) continue;
      p.drawMaterial[d] = material;
      p.drawFirstIndex[d] = runs[k * 3 + 1]!;
      p.drawIndexCount[d] = runs[k * 3 + 2]!;
    }
    p.drawCount = n + draws;
    this.doubled += draws * (copies - 1);
    const tris = this.trisOfMesh[mesh]!;
    p.triangles += tris[lod]! * count * copies;
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
    const [fx, fy, fz] = [cam.viewProj[3]!, cam.viewProj[7]!, cam.viewProj[11]!];
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

export { bodySeed };
