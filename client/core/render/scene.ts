// Builds the frame packet: terrain tiles, structure batches and entities.
//
// Structures are drawn per chunk and per mesh as instanced batches. A chunk's
// instance buffer is rebuilt only when its table version changes, and uploaded
// once; a still base costs the client nothing per frame beyond one draw per
// mesh kind per visible chunk.

import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCx, chunkCz, type MapDims } from "../../../shared/coords.ts";
import { INSTANCE_BYTES, type Pack } from "../../../shared/pack/pack.ts";
import { SKY_COLOR, WATER_COLOR } from "../../../shared/pack/palette.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { LOOK_BYTES } from "../../../shared/anim/look.ts";
import { GEAR_COUNT } from "../../../shared/sim/entities.ts";
import { AnimState, PITCH_STEPS, bodySeed } from "../../../shared/anim/pose.ts";
import type { Falling } from "../rubble.ts";
import type { Shots } from "../shots.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { Characters } from "./characters.ts";
import { DRAW_BLEND, FramePacket, InstanceWriter, MAX_DRAWS, MAX_WATER_TILES, TRANSIENT_BUFFER } from "./packet.ts";
import { NIGHT_LIGHT, UNDERWATER_DIM, UNDERWATER_VIEW, WATER_TILE } from "./shading.ts";
import { TerrainLod } from "./terrain.ts";

export interface RenderWorld {
  readonly dims: MapDims;
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes, drawn exactly as structures are. */
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
  /** Seen from its own eyes: drawn over everything, without its head. */
  firstPerson: boolean;
  /** Six colour regions; zero leaves the species' own. Used when it has no look. */
  readonly colors: Uint8Array;
  /** Its 28-byte look, or null. */
  look: Uint8Array | null;
  /** What it holds and wears, as `EntityStore.gear` has it. */
  readonly gear: Uint16Array;
  id: number;
}

/** Instance buffers of the node store are numbered from here, clear of chunk indices. */
export const NODE_BUFFERS = 1 << 20;

/** How far a rider's feet hang below where it sits: as the server has it (server/riding.ts). */
const SEAT_DROP = 0.55;
const MISSING_MESH = "core:missing";
const WATER_MESH = "core:water";
const BEAM_MESH = "core:beam";
/** Palette colour of the beam over a place of death. */
const BEAM_COLOR = 8;

interface ChunkBatch {
  /** Table version the instances were built from; -1 forces a rebuild. */
  version: number;
  data: Uint8Array;
  slots: Uint16Array;
  /** Triples: mesh, first instance, instance count. */
  ranges: number[];
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
  /** Structures farther than this are not drawn. Distant bases need merged stand-ins, not instances. */
  structureDistance = Infinity;
  /** Hour of the day, 0..24. Decides where the sun is and how bright the world is. Noon unless told. */
  hour = 12;
  /** Distances at which structure batches switch to lower levels of detail. */
  lodNear = 96;
  lodFar = 256;

  /** Pack mesh index per content index. */
  readonly meshOfKind: Uint16Array;
  /** Region 0 colour per content index. */
  readonly colorOfKind: Uint8Array;
  /** 1 for kinds drawn tilted to their pitch as well as turned to their facing. */
  private readonly pitched: Uint8Array;
  /** Shots in the air, drawn with the bodies; and the moment to draw them at, in ticks. Set by the app. */
  shots: Shots | null = null;
  shotTick = 0;
  /** Structures that have just gone, drawn where they have fallen to. Set by the app. */
  falling: Falling | null = null;
  private readonly trisOfMesh: number[][];
  private readonly radiusOfMesh: Float32Array;
  private readonly world: RenderWorld;
  private readonly batches = new Map<number, ChunkBatch>();
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  private readonly transient: InstanceWriter;
  private readonly waterMesh: number;
  private readonly beamMesh: number;
  /** Places to mark with a beam: x, y, z each. Set by the app before `build`. */
  readonly beams: number[] = [];
  /** A piece shown where it would be built: its kind (0 for none), where (metres), its facing (wire units) and a palette colour. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  /** Bodies with bones. */
  readonly characters: Characters;
  /** The viewer's own body, or null to draw none. Set by the app before `build`. */
  own: OwnBody | null = null;
  /** An entity not to draw from what the server says of it, because `own` is that body as the viewer predicts it (a mount): its index, or -1. */
  skip = -1;
  private readonly seatAt = [0, 0, 0];
  private readonly mountState = new AnimState();
  private readonly state = new AnimState();
  private readonly drawBody = (mesh: number, lod: number, first: number, count: number, flags: number): void => this.draw(mesh, lod, TRANSIENT_BUFFER, first, count, 0, 0, 0, flags);
  /** Linear RGB of the open sky and of deep water. */
  private readonly skyColor = new Float32Array(3);
  private readonly deepColor = new Float32Array(3);

  constructor(world: RenderWorld, reg: Registry, pack: Pack) {
    this.world = world;
    this.terrain = new TerrainLod(world.hf);
    const missing = pack.meshIndex.get(MISSING_MESH) ?? 0;
    this.meshOfKind = new Uint16Array(reg.defs.length).fill(missing);
    this.colorOfKind = new Uint8Array(reg.defs.length);
    this.pitched = Uint8Array.from(reg.defs, (d) => (d?.type === "prop" && d.pitched ? 1 : 0));
    for (let k = 1; k < reg.defs.length; k++) {
      const d = reg.defs[k]!;
      if (!("mesh" in d)) continue;
      this.meshOfKind[k] = pack.meshIndex.get(d.mesh === "box" || d.mesh === "shape" ? d.id : d.mesh) ?? missing;
      this.colorOfKind[k] = d.color;
    }
    const meshes = pack.header.meshes;
    this.trisOfMesh = meshes.map((m) => m.lods.map((l) => l.indexCount / 3));
    this.radiusOfMesh = Float32Array.from(meshes, (m) => Math.hypot(m.half[0], m.half[1], m.half[2]) + Math.hypot(m.center[0], m.center[1], m.center[2]));
    this.counts = new Uint32Array(meshes.length);
    this.cursor = new Uint32Array(meshes.length);
    this.transient = new InstanceWriter(this.packet.transient);
    this.characters = new Characters(reg, pack);

    this.waterMesh = pack.meshIndex.get(WATER_MESH) ?? -1;
    this.beamMesh = pack.meshIndex.get(BEAM_MESH) ?? -1;
    for (let k = 0; k < 3; k++) {
      this.skyColor[k] = pack.palette[SKY_COLOR * 4 + k]! / 255;
      this.deepColor[k] = (pack.palette[WATER_COLOR * 4 + k]! / 255) * UNDERWATER_DIM;
    }
  }

  /** Forget what the renderer holds (after a lost graphics context): every buffer is sent again. */
  resetUploads(): void {
    for (const b of this.batches.values()) b.uploaded = false;
  }

  build(cam: Camera, remote: RemoteSample | null): FramePacket {
    const p = this.packet;
    p.beginFrame();
    cam.update();
    p.viewProj.set(cam.viewProj);
    p.nearViewProj.set(cam.nearViewProj);
    p.camX = cam.x;
    p.camY = cam.y;
    p.camZ = cam.z;
    // The sun rises at six, stands highest at noon, sets at eighteen. At night
    // the light comes from a fixed moon and everything is dimmer.
    const up = Math.sin(((this.hour - 6) / 12) * Math.PI);
    const around = Math.cos(((this.hour - 6) / 12) * Math.PI);
    const dusk = Math.max(0, Math.min(1, (up + 0.1) / 0.4));
    p.light = NIGHT_LIGHT + (1 - NIGHT_LIGHT) * dusk * dusk * (3 - 2 * dusk);
    const sx = up > 0.15 ? around * 0.6 : 0.3;
    const sy = up > 0.15 ? up : 0.8;
    const sl = Math.hypot(sx, sy, 0.43);
    p.sun[0] = sx / sl;
    p.sun[1] = sy / sl;
    p.sun[2] = 0.43 / sl;

    // Under water the world is a short, dim view of the water's own colour.
    const sea = this.world.hf.seaLevel;
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
    this.structures(cam, this.world.structs, 0);
    if (this.world.nodes) this.structures(cam, this.world.nodes, NODE_BUFFERS);
    if (remote) this.entities(cam, remote);
    this.bodies(cam, remote);
    if (this.beams.length > 0 && this.beamMesh >= 0) this.markBeams(cam);
    if (this.falling && this.falling.count > 0) this.showFalling(cam, this.falling);
    if (this.ghost.kind !== 0) this.showGhost(cam);
    if (sea > -Infinity && this.waterMesh >= 0) this.water(cam, sea);
    // The viewer's own body goes over everything else, water included.
    this.characters.flush(p, this.transient, true, this.drawBody);
    return p;
  }

  /** Bodies with bones: every remote one in view, and the viewer's own. */
  private bodies(cam: Camera, remote: RemoteSample | null): void {
    const p = this.packet;
    const ch = this.characters;
    const st = this.state;
    ch.begin();
    if (remote) {
      for (let i = 0; i < remote.count; i++) {
        const kind = remote.kind[i]!;
        if (!ch.has(kind) || remote.id[i] === this.skip) continue;
        let x = remote.x[i]! - cam.x;
        let y = remote.y[i]! - cam.y;
        let z = remote.z[i]! - cam.z;
        let yaw = remote.yaw[i]!;
        // A rider is drawn on its mount's seat, where the mount is drawn: the viewer's own as it predicts it, another's as it is shown.
        const on = remote.seat[i]! - 1;
        if (on >= 0) {
          const own = this.own;
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
        st.unpack(remote.anim[i]!);
        st.seed = bodySeed(remote.id[i]!);
        const look = remote.hasLook[i] !== 0 ? remote.look : null;
        if (!ch.add(p, kind, x, y, z, yaw, st, remote.tick, look, i * LOOK_BYTES, remote.colors, i * 6, remote.gear, i * GEAR_COUNT, remote.id[i]!, false, false)) break;
      }
    }
    // Things that lie tilted as well as turned (an arrow where it landed), and whatever is in the air.
    if (remote) {
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
        if (!ch.loose(p, this.meshOfKind[kind]!, x, y, z, Math.sin(remote.yaw[i]!) * level, Math.sin(pitch), Math.cos(remote.yaw[i]!) * level, 1)) break;
      }
    }
    this.shots?.draw(ch, p, cam, this.shotTick);
    const own = this.own;
    if (own && ch.has(own.kind)) ch.add(p, own.kind, own.x - cam.x, own.y - cam.y, own.z - cam.z, own.yaw, own.state, own.tick, own.look, 0, own.colors, 0, own.gear, 0, own.id, own.firstPerson, own.firstPerson);
    ch.flush(p, this.transient, false, this.drawBody);
  }

  /** Structures on their way down: each as its own mesh, where its fall has taken it. */
  private showFalling(cam: Camera, f: Falling): void {
    const p = this.packet;
    const counts = this.counts.fill(0);
    for (let i = 0; i < f.count; i++) counts[this.meshOfKind[f.kind[i]!]!]!++;
    let total = p.transientCount;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) this.draw(m, 0, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0);
      total += counts[m]!;
    }
    for (let i = 0; i < f.count; i++) {
      const kind = f.kind[i]!;
      const at = this.cursor[this.meshOfKind[kind]!]!++;
      this.transient.set(at, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z, f.yaw[i]!, this.colorOfKind[kind]!);
      p.transientIds[at] = 0;
    }
    p.transientCount = total;
  }

  /** The piece a builder is about to set down, where it would go: see-through, in the colour given. */
  private showGhost(cam: Camera): void {
    const p = this.packet;
    const g = this.ghost;
    const first = p.transientCount;
    this.transient.set(first, g.x - cam.x, g.y - cam.y, g.z - cam.z, g.yaw, g.color);
    p.transientIds[first] = 0;
    const d = p.drawCount;
    this.draw(this.meshOfKind[g.kind]!, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0);
    if (p.drawCount > d) p.drawFlags[d] = DRAW_BLEND;
    p.transientCount = first + 1;
  }

  /** A tall thin beam over each marked place, visible from far off. */
  private markBeams(cam: Camera): void {
    const p = this.packet;
    const first = p.transientCount;
    let n = 0;
    for (let i = 0; i + 2 < this.beams.length && n < 16; i += 3) {
      this.transient.set(first + n, this.beams[i]! - cam.x, this.beams[i + 1]! - cam.y, this.beams[i + 2]! - cam.z, 0, BEAM_COLOR);
      p.transientIds[first + n] = 0;
      n++;
    }
    this.draw(this.beamMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0);
    p.transientCount = first + n;
  }

  /** The water surface: tiles of one flat mesh over the map, drawn last because they are see-through. */
  private water(cam: Camera, sea: number): void {
    const p = this.packet;
    const hf = this.world.hf;
    const first = p.transientCount;
    let n = 0;
    const half = WATER_TILE / 2;
    for (let tz = 0; tz * WATER_TILE < hf.sizeZ; tz++) {
      for (let tx = 0; tx * WATER_TILE < hf.sizeX; tx++) {
        const x = tx * WATER_TILE + half - cam.x;
        const z = tz * WATER_TILE + half - cam.z;
        const y = sea - cam.y;
        if (n === MAX_WATER_TILES || !cam.boxVisible(x - half, y - 0.1, z - half, x + half, y + 0.1, z + half)) continue;
        this.transient.set(first + n, x, y, z, 0, WATER_COLOR);
        p.transientIds[first + n] = 0;
        n++;
      }
    }
    if (n === 0) return;
    const d = p.drawCount;
    this.draw(this.waterMesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0);
    if (p.drawCount > d) p.drawFlags[d] = DRAW_BLEND;
    p.transientCount = first + n;
  }

  /** Draw one box store. Its chunk `c` uses instance buffer `base + c`. */
  private structures(cam: Camera, store: StructureStore, base: number): void {
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
      if (!batch || batch.version !== t.version) batch = this.rebuild(store, chunk, id, batch);
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
      const lod = dist < this.lodNear ? 0 : dist < this.lodFar ? 1 : 2;
      for (let r = 0; r < batch.ranges.length; r += 3) {
        this.draw(batch.ranges[r]!, lod, id, batch.ranges[r + 1]!, batch.ranges[r + 2]!, x0 - cam.x, -cam.y, z0 - cam.z);
      }
    }
  }

  private rebuild(store: StructureStore, chunk: number, id: number, old: ChunkBatch | undefined): ChunkBatch {
    const world = this.world;
    const t = store.chunks[chunk]!;
    const x0 = chunkCx(world.dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(world.dims, chunk) * CHUNK_SIZE;
    const counts = this.counts.fill(0);
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) counts[this.meshOfKind[t.kind[s]!]!]!++;
    const ranges: number[] = [];
    let total = 0;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) ranges.push(m, total, counts[m]!);
      total += counts[m]!;
    }
    const data = old && old.data.length === total * INSTANCE_BYTES ? old.data : new Uint8Array(total * INSTANCE_BYTES);
    const slots = old && old.slots.length === total ? old.slots : new Uint16Array(total);
    const w = new InstanceWriter(data);
    const b: ChunkBatch = { version: t.version, data, slots, ranges, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, uploaded: false };
    for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0) continue;
      const mesh = this.meshOfKind[kind]!;
      const i = this.cursor[mesh]!++;
      const x = t.x[s]!;
      const y = t.y[s]!;
      const z = t.z[s]!;
      w.set(i, x - x0, y, z - z0, t.yaw[s]!, this.colorOfKind[kind]!);
      slots[i] = s;
      const r = this.radiusOfMesh[mesh]!;
      if (x - r < b.minX) b.minX = x - r;
      if (y - r < b.minY) b.minY = y - r;
      if (z - r < b.minZ) b.minZ = z - r;
      if (x + r > b.maxX) b.maxX = x + r;
      if (y + r > b.maxY) b.maxY = y + r;
      if (z + r > b.maxZ) b.maxZ = z + r;
    }
    this.batches.set(id, b);
    return b;
  }

  private entities(cam: Camera, remote: RemoteSample): void {
    const p = this.packet;
    const counts = this.counts.fill(0);
    let visible = 0;
    const bodies = this.characters;
    for (let i = 0; i < remote.count; i++) {
      if (bodies.has(remote.kind[i]!) || this.pitched[remote.kind[i]!] !== 0) continue;
      const mesh = this.meshOfKind[remote.kind[i]!]!;
      const r = this.radiusOfMesh[mesh]!;
      const x = remote.x[i]! - cam.x;
      const y = remote.y[i]! - cam.y;
      const z = remote.z[i]! - cam.z;
      // Mark culled entries by leaving them out of the counts; the second pass repeats the test.
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      counts[mesh]!++;
      visible++;
    }
    if (visible === 0) return;
    let total = p.transientCount;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) this.draw(m, 0, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0);
      total += counts[m]!;
    }
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

  private draw(mesh: number, lod: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags = 0): void {
    const p = this.packet;
    const n = p.drawCount;
    if (n === MAX_DRAWS) return;
    p.drawMesh[n] = mesh;
    p.drawLod[n] = lod;
    p.drawBuffer[n] = buffer;
    p.drawFirst[n] = first;
    p.drawInstances[n] = count;
    p.drawOffset[n * 3] = ox;
    p.drawOffset[n * 3 + 1] = oy;
    p.drawOffset[n * 3 + 2] = oz;
    p.drawFlags[n] = flags;
    p.drawCount = n + 1;
    const tris = this.trisOfMesh[mesh]!;
    p.triangles += tris[lod < tris.length ? lod : tris.length - 1]! * count;
  }
}

export { bodySeed };
