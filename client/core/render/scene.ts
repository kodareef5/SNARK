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
import { AnimState, PITCH_STEPS, bodySeed } from "../../../shared/anim/pose.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { Falling } from "../rubble.ts";
import type { Shots } from "../shots.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { Characters, showMaterials } from "./characters.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_SIZED, DRAW_TEXTURED, DRAW_TWO_SIDED, FRAME, FramePacket, InstanceWriter, LOOSE_BONES, MAX_BONES, MAX_DRAWS, MAX_TILES, MAX_WATER_TILES, PASS_FAR, PASS_NEAR, STEP_BODY, STEP_FAR_SEE, STEP_NEAR_SEE, TRANSIENT_BUFFER } from "./packet.ts";
import { UNDERWATER_DIM, UNDERWATER_VIEW, WATER_TILE } from "./shading.ts";
import { SKY_SIZE, flatLight, skyFrame, theSky } from "./sky.ts";
import { TerrainLod } from "./terrain.ts";

export interface RenderWorld {
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes, drawn as structures are. */
  readonly nodes?: StructureStore;
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
}

/** Instance buffers of the node store are numbered from here, clear of chunk indices. */
export const NODE_BUFFERS = 1 << 20;
/**
 * A chunk of nodes is cut into this many cells a side, 16 m across, and a mesh's nodes in it are drawn by cell, each cell
 * at the level its own distance asks for, so the plants at the far side of a chunk a player stands in are not drawn as
 * finely as those at his feet. Neighbouring cells of one level are one draw, so a chunk off in the distance is still one
 * draw for each mesh. Chosen on a wood with every slot filled (tools/bench/nodes.ts): by the chunk, 4.2 M triangles and
 * 96 draws a frame; by these cells, 3.5 M and 141 (3.4 M and 203 were cells never joined at the cost of a draw); by cells
 * of 8 m, 3.4 M and 154.
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
  /** The time of this frame, in milliseconds, for what the asset library waits on. */
  now = 0;
  /** Loose meshes to draw: the stress scene's. */
  things: Thing[] = [];

  /** Pack mesh index per content index. */
  readonly meshOfKind: Uint16Array;
  /** Region 0 colour per content index. */
  readonly colorOfKind: Uint8Array;
  /** Per node form, its pack mesh or HIDDEN, its region 0 colour, and its size in SIZE_UNITS. */
  private readonly meshOfForm: Uint16Array;
  private readonly colorOfForm: Uint8Array;
  private readonly sizeOfForm: Uint8Array;
  /**
   * Per mesh, the largest size a node draws it at, as a multiple of its modelled size, or 1. A node mesh's level and textures
   * are chosen for its distance divided by this, as if every node of it were that size.
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
   * draw's step in each range, where each step begins, and the draw and range each place in the order takes.
   */
  private readonly columns: (Uint8Array | Uint16Array | Uint32Array | Float32Array)[];
  private readonly scratch = [new Float64Array(MAX_DRAWS * 3), new Float64Array(MAX_DRAWS * 3)] as const;
  private readonly steps = new Int8Array(MAX_DRAWS * 2);
  private readonly starts = new Int32Array(STEP_BODY + 2);
  private readonly source = new Uint16Array(MAX_DRAWS);
  private readonly sourcePass = new Uint8Array(MAX_DRAWS);
  /** The farthest any body's posed vertex gets from where its first bone puts its origin, short of its own mesh and offset. */
  private readonly bodySlack: number;
  private readonly transient: InstanceWriter;
  private readonly transientF32: Float32Array;
  private readonly transientU16: Uint16Array;
  private readonly waterMesh: number;
  private readonly beamMesh: number;
  /** Places to mark with a beam, x, y, z each. The app sets them before build(). */
  readonly beams: number[] = [];
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  readonly characters: Characters;
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
  private readonly drawBody = (mesh: number, lod: number, first: number, count: number, flags: number): void => this.draw(mesh, lod, TRANSIENT_BUFFER, first, count, 0, 0, 0, flags, NEAR);
  /** Linear RGB of the open sky and of deep water. */
  private readonly skyColor = new Float32Array(3);
  private readonly deepColor = new Float32Array(3);

  /** With `stream`, `pack` is the boot pack and other levels are asked of the port as they are wanted. */
  constructor(world: RenderWorld, reg: Registry, pack: Pack, stream?: { manifest: Manifest; port: AssetPort }) {
    this.world = world;
    this.terrain = new TerrainLod(world.hf);
    this.assets = new Assets(reg, pack, stream?.manifest, stream?.port);
    // The renderer holds the sky table on every tier.
    this.assets.residency.reserve("sky table", SKY_SIZE ** 3 * 4);
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
    const p = this.packet as unknown as Record<string, unknown>;
    this.columns = Object.keys(p).filter((k) => k.startsWith("draw") && k !== "drawPass" && ArrayBuffer.isView(p[k])).map((k) => p[k] as Uint8Array);
    let reach = 0;
    for (let k = 1; k < reg.defs.length; k++) if (this.characters.has(k)) reach = Math.max(reach, this.characters.reach(k));
    this.bodySlack = reach * 2;

    this.waterMesh = table.find(WATER_MESH);
    this.beamMesh = table.find(BEAM_MESH);
    for (let k = 0; k < 3; k++) {
      this.skyColor[k] = pack.palette[SKY_COLOR * 4 + k]! / 255;
      this.deepColor[k] = (pack.palette[WATER_COLOR * 4 + k]! / 255) * UNDERWATER_DIM;
    }
  }

  /** Call after a lost graphics context. Every buffer and every level is uploaded again. */
  resetUploads(): void {
    for (const b of this.batches.values()) b.uploaded = false;
    this.assets.residency.reset();
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
    // Lit tiers take their light from the sky table.
    if (p.tier.lit) skyFrame(this.hour, theSky(), p.frame);

    // Under water the view is short and the fog is the water's colour, dimmed.
    const sea = this.world.hf.seaLevel;
    p.frame[FRAME.eyeHeight] = cam.y - sea;
    if (cam.y < sea) {
      for (let k = 0; k < 3; k++) p.sky[k] = this.deepColor[k]! * p.light;
      p.fogStart = 0;
      p.fogEnd = UNDERWATER_VIEW;
    } else {
      for (let k = 0; k < 3; k++) p.sky[k] = this.skyColor[k]! * p.light;
      p.fogStart = this.viewDistance * 0.45;
      p.fogEnd = this.viewDistance;
    }

    this.terrain.select(cam, p, this.viewDistance);
    // The selection stops at a full list, so a full list has left tiles out.
    if (p.tileCount === MAX_TILES) p.dropped++;
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
    this.characters.flush(p, this.transient, true, this.drawBody);
    this.order();
    this.assets.end(p, this.now);
    return p;
  }

  /**
   * Puts the draws in the order of the steps they are drawn in (packet.ts), each in the ranges `passOf` gives it, so a
   * draw in both is listed twice. With one range they stay as they were made, all in the near range.
   */
  private order(): void {
    const p = this.packet;
    const n = p.drawCount;
    if (p.split <= 0) {
      p.drawPass.fill(PASS_NEAR, 0, n);
      p.skyAt = n;
      return;
    }
    // Each draw's step in each range, -1 where it is not drawn in that range, as stepOf will find it.
    const steps = this.steps;
    const starts = this.starts.fill(0);
    for (let d = 0; d < n; d++) {
      const flags = p.drawFlags[d]!;
      for (let range = PASS_NEAR; range <= PASS_FAR; range++) {
        let s = (this.passOf[d]! & (1 << range)) === 0 ? -1 : (flags & DRAW_BLEND) !== 0 ? STEP_NEAR_SEE - range : range;
        if ((flags & DRAW_NEAR) !== 0) s = range === PASS_NEAR ? STEP_BODY : -1;
        steps[d * 2 + range] = s;
        if (s >= 0) starts[s + 1]!++;
      }
    }
    for (let s = 1; s < starts.length; s++) starts[s]! += starts[s - 1]!;
    const total = starts[STEP_BODY + 1]!;
    p.skyAt = starts[STEP_FAR_SEE]!;
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

  private bodies(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const ch = this.characters;
    const st = this.state;
    const own = this.own;
    ch.begin();
    if (remote) {
      // First which bodies are in view and where, then which of them the frame has the bones to pose.
      const from = this.bodyFrom;
      const place = this.bodyAt;
      const rigid = this.bodyRigid;
      let n = 0;
      let wanted = 0;
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        if (!ch.has(kind) || remote.id[i] === this.skip) continue;
        let x = remote.x[i]! - cam.x;
        let y = remote.y[i]! - cam.y;
        let z = remote.z[i]! - cam.z;
        let yaw = remote.yaw[i]!;
        // A rider is drawn on its mount's seat. The viewer's own mount is placed as predicted, any other as the server sent it.
        const on = remote.seat[i]! - 1;
        if (on >= 0) {
          const at = this.seatAt;
          let found = false;
          if (own && own.id === on) {
            found = ch.seat(own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, at);
            yaw = own.yaw;
          } else {
            for (let j = 0; j < remote.count && !found; j++) {
              if (remote.id[j] !== on) continue;
              const ms = this.mountState;
              ms.unpack(remote.anim[j]!);
              ms.seed = bodySeed(on);
              found = ch.seat(remote.kind[j]!, remote.x[j]! - cam.x, remote.y[j]! - cam.y, remote.z[j]! - cam.z, remote.yaw[j]!, ms, remote.tick, at);
              yaw = remote.yaw[j]!;
            }
          }
          if (found) {
            x = at[0]!;
            y = at[1]! - SEAT_DROP;
            z = at[2]!;
          }
        }
        const r = ch.reach(kind);
        if (!cam.boxVisible(x - r, y - 0.3, z - r, x + r, y + (r > 2.2 ? r : 2.2), z + r)) continue;
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
      for (let k = 0; k < n; k++) {
        const i = from[k]!;
        const kind = remote.kind[i]!;
        st.unpack(remote.anim[i]!);
        st.seed = bodySeed(remote.id[i]!);
        const look = remote.hasLook[i] !== 0 ? remote.look : null;
        const size = remote.grown[i] !== 0 ? youngScale(this.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
        ch.add(p, kind, place[k * 4]!, place[k * 4 + 1]!, place[k * 4 + 2]!, place[k * 4 + 3]!, st, remote.tick, look, i * LOOK_BYTES, remote.colors, i * 6, remote.gear, i * GEAR_COUNT, remote.id[i]!, false, false, size, rigid[k] !== 0);
      }
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
    if (own && ch.has(own.kind)) ch.add(p, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson);
    const from = p.drawCount;
    ch.flush(p, this.transient, false, this.drawBody);
    if (cam.split > 0) this.bodyPasses(cam, from);
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

  /** Tiles of one flat mesh over the map, drawn last because they are see-through. */
  private water(cam: Camera, sea: number): void {
    const p = this.packet;
    const hf = this.world.hf;
    const first = p.transientCount;
    let n = 0;
    const half = WATER_TILE / 2;
    // The box round every tile drawn, for its depth ranges.
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let tz = 0; tz * WATER_TILE < hf.sizeZ; tz++) {
      for (let tx = 0; tx * WATER_TILE < hf.sizeX; tx++) {
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
    this.draw(this.waterMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, DRAW_BLEND, cam.passes(x0, sea - cam.y - 0.1, z0, x1, sea - cam.y + 0.1, z1));
    p.transientCount = first + n;
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
      if (!cam.boxVisible(ax, ay, az, bx, by, bz)) continue;
      const dx = ax > 0 ? ax : bx < 0 ? -bx : 0;
      const dy = ay > 0 ? ay : by < 0 ? -by : 0;
      const dz = az > 0 ? az : bz < 0 ? -bz : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > this.viewDistance || dist > this.structureDistance) continue;
      if (!batch.uploaded) {
        p.uploads.push({ buffer: id, data: batch.data, slots: batch.slots });
        batch.uploaded = true;
      }
      const passes = cam.passes(ax, ay, az, bx, by, bz);
      if (batch.cells > 1) {
        this.nodeRanges(cam, batch, id, dist, x0, z0, passes);
        continue;
      }
      for (let r = 0; r < batch.ranges.length; r += 3) {
        const mesh = batch.ranges[r]!;
        const lod = (batch.level[r / 3] = this.assets.choose(this.assets.table.error[mesh]!, dist, batch.level[r / 3]!));
        this.assets.wantTextured(mesh, lod, dist);
        this.draw(mesh, lod, id, batch.ranges[r + 1]!, batch.ranges[r + 2]!, x0 - cam.x, -cam.y, z0 - cam.z, 0, passes);
      }
    }
  }

  /**
   * Draws a chunk of nodes `dist` metres off. A mesh's level is chosen as if every node of it were its kind's largest. Where
   * the chunk's nearest and farthest points ask for the same level, each mesh is one draw; otherwise each cell takes the level
   * its own nearest point asks for. Every draw of the chunk is in the depth ranges `passes`.
   */
  private nodeRanges(cam: Camera, b: ChunkBatch, id: number, dist: number, x0: number, z0: number, passes: number): void {
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
      const reach = this.reachOfMesh[mesh]!;
      const near = this.assets.choose(errors, dist / reach, b.level[q]!);
      if (near === this.assets.choose(errors, far / reach, b.level[q]!)) {
        b.level[q] = near;
        levels.fill(near, q * cells, (q + 1) * cells);
        this.assets.wantTextured(mesh, near, dist / reach);
        this.draw(mesh, near, id, b.ranges[r + 1]!, b.ranges[r + 2]!, ox, oy, oz, DRAW_SIZED, passes);
        continue;
      }
      b.level[q] = -1;
      // Runs of neighbouring cells, each drawn at the finest level any of its cells asks for. A cell joins the run before it
      // when they ask for the same level, or for levels one apart and drawing the coarser at the finer costs fewer triangles
      // than a draw does. So no node is drawn more than one level finer than its own cell asks.
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
        const seen = Math.sqrt(dx * dx + dy * dy + dz * dz) / reach;
        const level = (levels[q * cells + c] = this.assets.choose(errors, seen, levels[q * cells + c]!));
        // A run is its first and end instance, its level, the coarsest level a cell of it asked for, its nearest distance, and how many of it asked for that coarsest.
        const last = runs.length - 6;
        if (last >= 0 && runs[last + 1] === first[at]) {
          const [finer, coarser] = [Math.min(runs[last + 2]!, level), Math.max(runs[last + 3]!, level)];
          const coarse = level > runs[last + 2]! ? n : level < runs[last + 2]! ? runs[last + 1]! - runs[last]! : 0;
          if (coarser - finer <= 1 && coarse * ((tris[finer] ?? 0) - (tris[coarser] ?? 0)) <= RUN_TRIANGLES) {
            [runs[last + 1], runs[last + 2], runs[last + 3], runs[last + 4]] = [first[at + 1]!, finer, coarser, Math.min(runs[last + 4]!, seen)];
            continue;
          }
        }
        runs.push(first[at]!, first[at + 1]!, level, level, seen, 0);
      }
      for (let k = 0; k < runs.length; k += 6) {
        this.assets.wantTextured(mesh, runs[k + 2]!, runs[k + 4]!);
        this.draw(mesh, runs[k + 2]!, id, runs[k]!, runs[k + 1]! - runs[k]!, ox, oy, oz, DRAW_SIZED, passes);
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
      const at = (this.cursor[mesh]! * cells + cell) * 6;
      box[at] = Math.min(box[at]!, x - r);
      box[at + 1] = Math.min(box[at + 1]!, lo);
      box[at + 2] = Math.min(box[at + 2]!, z - r);
      box[at + 3] = Math.max(box[at + 3]!, x + r);
      box[at + 4] = Math.max(box[at + 4]!, hi);
      box[at + 5] = Math.max(box[at + 5]!, z + r);
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
      const mesh = this.meshOfKind[remote.kind[i]!]!;
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
      const mesh = this.meshOfKind[kind]!;
      const r = this.radiusOfMesh[mesh]!;
      const x = remote.x[i]! - cam.x;
      const y = remote.y[i]! - cam.y;
      const z = remote.z[i]! - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      const at = this.cursor[mesh]!++;
      this.transient.set(at, x, y, z, Math.round((remote.yaw[i]! / (2 * Math.PI)) * 65536) & 0xffff, this.colorOfKind[kind]!);
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
   * are the depth ranges it is drawn in (Camera.passes), and a draw in both takes the room of two.
   */
  private draw(mesh: number, wanted: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, passes: number): void {
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
