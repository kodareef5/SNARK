// Software rasterizer that executes a frame packet on the CPU, so rendering can be looked at and tested without a browser.
// It reads the same packet, pack bytes and shading constants as the WebGL2 shell, and records what is under every pixel.

import { NEAR_BODY } from "../../client/core/render/camera.ts";
import { BONE_FLOATS, DRAW_BLEND, DRAW_NEAR, DRAW_PLAIN, DRAW_SKINNED, FramePacket, TILE_QUADS, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE, WATER_ALPHA } from "../../client/core/render/shading.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import type { Manifest } from "../../shared/pack/manifest.ts";
import { INSTANCE_BYTES, VERTEX_BYTES, lodVertices, readIndices, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

export const PICK_SKY = 0;
export const PICK_TERRAIN = 1;
export const PICK_STRUCTURE = 2;
export const PICK_ENTITY = 3;

interface DecodedLod {
  positions: Float32Array;
  colors: Uint8Array;
  bones: Uint8Array;
  indices: Uint32Array;
}

/** Vertices as the pack holds them, eight bytes each, within the bounds of their mesh. */
function vertices(verts: Uint8Array, n: number, m: { center: readonly number[]; half: readonly number[] }): { positions: Float32Array; colors: Uint8Array; bones: Uint8Array } {
  const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const positions = new Float32Array(n * 3);
  const colors = new Uint8Array(n);
  const bones = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    for (let a = 0; a < 3; a++) positions[v * 3 + a] = m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!;
    colors[v] = verts[v * VERTEX_BYTES + 6]!;
    bones[v] = verts[v * VERTEX_BYTES + 7]!;
  }
  return { positions, colors, bones };
}

export class Rasterizer {
  readonly width: number;
  readonly height: number;
  readonly color: Uint8ClampedArray;
  readonly depth: Float32Array;
  /** PICK_* per pixel. */
  readonly pickKind: Uint8Array;
  /** Structure ref (chunk * 65536 + slot) or entity slot index. */
  readonly pickId: Uint32Array;
  /** One more than the bone the triangle under the pixel follows. 0 where no skinned body is drawn. */
  readonly pickBone: Uint8Array;
  trianglesDrawn = 0;

  private readonly pack: Pack;
  private readonly hf: Heightfield;
  private readonly buffers = new Map<number, { data: Uint8Array; slots: Uint16Array }>();
  private readonly lods = new Map<number, DecodedLod>();
  /** Given a manifest, only what a packet has uploaded may be drawn, as on a graphics card. Levels are kept by slot. */
  private readonly manifest: Manifest | null;
  private packet!: FramePacket;
  /** The matrix and near distance in use: the packet's main pass or its near pass. */
  private matrix!: Float32Array;
  private nearClip = 0.05;
  /** Triangles are drawn without the checker. */
  private plain = false;
  /** What `pickBone` gets for the triangle being drawn. */
  private bone = 0;
  private scratch = new Float32Array(3 * 1024);
  // Clip scratch: up to 4 vertices of (camera-relative x, y, z, screen x, y, 1/w, NDC depth).
  private readonly poly = new Float64Array(4 * 7);

  constructor(width: number, height: number, pack: Pack, hf: Heightfield, manifest: Manifest | null = null) {
    this.width = width;
    this.height = height;
    this.pack = pack;
    this.hf = hf;
    this.manifest = manifest;
    this.color = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height);
    this.pickKind = new Uint8Array(width * height);
    this.pickId = new Uint32Array(width * height);
    this.pickBone = new Uint8Array(width * height);
  }

  render(packet: FramePacket): void {
    this.packet = packet;
    for (const u of packet.uploads) this.buffers.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
    for (const id of packet.drops) this.buffers.delete(id);
    if (this.manifest) {
      for (const u of packet.assetUploads) this.lods.set(u.slot, this.decodeUpload(u));
      for (const slot of packet.assetDrops) this.lods.delete(slot);
    }

    const sky = [packet.sky[0]! * 255, packet.sky[1]! * 255, packet.sky[2]! * 255];
    for (let i = 0; i < this.width * this.height; i++) {
      this.color[i * 4] = sky[0]!;
      this.color[i * 4 + 1] = sky[1]!;
      this.color[i * 4 + 2] = sky[2]!;
      this.color[i * 4 + 3] = 255;
    }
    this.depth.fill(Infinity);
    this.pickKind.fill(PICK_SKY);
    this.pickId.fill(0);
    this.pickBone.fill(0);
    this.trianglesDrawn = 0;

    this.matrix = packet.viewProj;
    this.nearClip = 0.05;
    this.plain = false;
    this.bone = 0;
    this.terrain(packet);
    for (let d = 0; d < packet.drawCount; d++) {
      // The viewer's own body draws over everything so far, with its own near plane.
      if ((packet.drawFlags[d]! & DRAW_NEAR) !== 0 && this.matrix !== packet.nearViewProj) {
        this.matrix = packet.nearViewProj;
        this.nearClip = NEAR_BODY;
        this.depth.fill(Infinity);
      }
      this.draw(packet, d);
    }
  }

  private terrain(p: FramePacket): void {
    const hf = this.hf;
    const row = TILE_QUADS + 1;
    const pos = new Float32Array(row * row * 3);
    const tint = new Uint8Array(row * row);
    for (let t = 0; t < p.tileCount; t++) {
      const stride = p.tiles[t * 4 + 3]!;
      const i0 = p.tileOrigin[t * 2]!;
      const j0 = p.tileOrigin[t * 2 + 1]!;
      for (let gz = 0; gz < row; gz++) {
        for (let gx = 0; gx < row; gx++) {
          const i = Math.min(i0 + gx * stride, hf.nx - 1);
          const j = Math.min(j0 + gz * stride, hf.nz - 1);
          const k = gz * row + gx;
          pos[k * 3] = i * hf.cell - p.camX;
          pos[k * 3 + 1] = hf.sample(i, j) - p.camY;
          pos[k * 3 + 2] = j * hf.cell - p.camZ;
          tint[k] = hf.tint[j * hf.nx + i]!;
        }
      }
      for (let gz = 0; gz < TILE_QUADS; gz++) {
        for (let gx = 0; gx < TILE_QUADS; gx++) {
          const a = gz * row + gx;
          const b = a + 1;
          const c = a + row;
          const d = c + 1;
          // Both triangles of a quad take the colour of its first corner.
          this.triangle(pos, d, b, a, tint[a]!, false, PICK_TERRAIN, 0);
          this.triangle(pos, c, d, a, tint[a]!, false, PICK_TERRAIN, 0);
        }
      }
    }
  }

  private draw(p: FramePacket, d: number): void {
    const meshIndex = p.drawMesh[d]!;
    const lod = this.decode(meshIndex, p.drawLod[d]!, p.drawSlot[d]!);
    const transient = p.drawBuffer[d] === TRANSIENT_BUFFER;
    const buffer = transient ? null : this.buffers.get(p.drawBuffer[d]!);
    if (!transient && !buffer) throw new Error(`draw ${d} uses buffer ${p.drawBuffer[d]} which was never uploaded`);
    const data = transient ? p.transient : buffer!.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ox = p.drawOffset[d * 3]!;
    const oy = p.drawOffset[d * 3 + 1]!;
    const oz = p.drawOffset[d * 3 + 2]!;
    const n = lod.positions.length / 3;
    if (this.scratch.length < n * 3) this.scratch = new Float32Array(n * 3);
    const out = this.scratch;
    const skinned = (p.drawFlags[d]! & DRAW_SKINNED) !== 0;
    this.plain = (p.drawFlags[d]! & DRAW_PLAIN) !== 0;
    const bones = p.bones;
    for (let k = 0; k < p.drawInstances[d]!; k++) {
      const inst = p.drawFirst[d]! + k;
      const at = inst * INSTANCE_BYTES;
      if (skinned) {
        // Each vertex follows one bone of this instance's body.
        const first = view.getUint16(at + 12, true);
        const px = view.getFloat32(at, true), py = view.getFloat32(at + 4, true), pz = view.getFloat32(at + 8, true);
        for (let v = 0; v < n; v++) {
          const b = (first + lod.bones[v]!) * BONE_FLOATS;
          const lx = lod.positions[v * 3]! + px, ly = lod.positions[v * 3 + 1]! + py, lz = lod.positions[v * 3 + 2]! + pz;
          out[v * 3] = bones[b]! * lx + bones[b + 1]! * ly + bones[b + 2]! * lz + bones[b + 3]!;
          out[v * 3 + 1] = bones[b + 4]! * lx + bones[b + 5]! * ly + bones[b + 6]! * lz + bones[b + 7]!;
          out[v * 3 + 2] = bones[b + 8]! * lx + bones[b + 9]! * ly + bones[b + 10]! * lz + bones[b + 11]!;
        }
      } else {
        const yaw = (view.getUint16(at + 12, true) / 65536) * Math.PI * 2;
        const s = Math.sin(yaw);
        const c = Math.cos(yaw);
        const ix = view.getFloat32(at, true) + ox;
        const iy = view.getFloat32(at + 4, true) + oy;
        const iz = view.getFloat32(at + 8, true) + oz;
        for (let v = 0; v < n; v++) {
          const lx = lod.positions[v * 3]!;
          const lz = lod.positions[v * 3 + 2]!;
          out[v * 3] = c * lx + s * lz + ix;
          out[v * 3 + 1] = lod.positions[v * 3 + 1]! + iy;
          out[v * 3 + 2] = -s * lx + c * lz + iz;
        }
      }
      const kind = transient ? PICK_ENTITY : PICK_STRUCTURE;
      const id = transient ? p.transientIds[inst]! : p.drawBuffer[d]! * 65536 + buffer!.slots[inst]!;
      for (let t = 0; t < lod.indices.length; t += 3) {
        const last = lod.indices[t + 2]!;
        let color = lod.colors[last]!;
        if (color >= REGION_BASE) color = data[at + 14 + color - REGION_BASE]!;
        this.bone = skinned ? lod.bones[last]! + 1 : 0;
        this.triangle(out, lod.indices[t]!, lod.indices[t + 1]!, last, color, true, kind, id, (p.drawFlags[d]! & DRAW_BLEND) !== 0);
      }
    }
  }

  private decode(mesh: number, level: number, slot: number): DecodedLod {
    if (this.manifest) {
      const lod = this.lods.get(slot);
      if (!lod) throw new Error(`a draw of ${this.manifest.meshes[mesh]!.id} at level ${level}, which is not on the graphics card`);
      return lod;
    }
    const key = mesh * 8 + level;
    let lod = this.lods.get(key);
    if (lod) return lod;
    const m = this.pack.header.meshes[mesh]!;
    if (level >= m.lods.length) throw new Error(`a draw of ${m.id} at level ${level}, which it does not have`);
    lod = { ...vertices(lodVertices(this.pack, m.lods[level]!), m.lods[level]!.vertexCount, m), indices: readIndices(this.pack, m.lods[level]!) };
    this.lods.set(key, lod);
    return lod;
  }

  /** A level from the bytes a packet uploads: its indices, padded to a multiple of 4, and then its vertices. */
  private decodeUpload(u: AssetUpload): DecodedLod {
    const view = new DataView(u.data.buffer, u.data.byteOffset, u.data.byteLength);
    const indices = new Uint32Array(u.indexCount);
    for (let i = 0; i < indices.length; i++) indices[i] = u.indexBytes === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
    const verts = u.data.subarray((u.indexCount * u.indexBytes + 3) & ~3);
    return { ...vertices(verts, verts.length / VERTEX_BYTES, this.manifest!.meshes[u.mesh]!), indices };
  }

  /** Positions are camera-relative. Counter-clockwise faces the viewer. */
  private triangle(pos: Float32Array, ia: number, ib: number, ic: number, colorIndex: number, solid: boolean, pickKind: number, pickId: number, blend = false): void {
    const p = this.packet;
    const ax = pos[ia * 3]!, ay = pos[ia * 3 + 1]!, az = pos[ia * 3 + 2]!;
    const bx = pos[ib * 3]!, by = pos[ib * 3 + 1]!, bz = pos[ib * 3 + 2]!;
    const cx = pos[ic * 3]!, cy = pos[ic * 3 + 1]!, cz = pos[ic * 3 + 2]!;
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (nx * ax + ny * ay + nz * az >= 0) {
      if (!blend) return; // faces away from the camera at the origin
      // A see-through surface is drawn from behind too, lit as the face seen.
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const nl = Math.hypot(nx, ny, nz);
    if (nl === 0) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // Clip against the near plane (w > near), producing 3 or 4 vertices.
    const m = this.matrix;
    const near = this.nearClip;
    const poly = this.poly;
    let count = 0;
    const src = [ax, ay, az, bx, by, bz, cx, cy, cz];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const x0 = src[i * 3]!, y0 = src[i * 3 + 1]!, z0 = src[i * 3 + 2]!;
      const x1 = src[j * 3]!, y1 = src[j * 3 + 1]!, z1 = src[j * 3 + 2]!;
      const w0 = m[3]! * x0 + m[7]! * y0 + m[11]! * z0;
      const w1 = m[3]! * x1 + m[7]! * y1 + m[11]! * z1;
      if (w0 > near) {
        poly[count * 7] = x0;
        poly[count * 7 + 1] = y0;
        poly[count * 7 + 2] = z0;
        count++;
      }
      if (w0 > near !== w1 > near) {
        const t = (near - w0) / (w1 - w0);
        poly[count * 7] = x0 + (x1 - x0) * t;
        poly[count * 7 + 1] = y0 + (y1 - y0) * t;
        poly[count * 7 + 2] = z0 + (z1 - z0) * t;
        count++;
      }
    }
    if (count < 3) return;
    const W = this.width;
    const H = this.height;
    for (let i = 0; i < count; i++) {
      const x = poly[i * 7]!, y = poly[i * 7 + 1]!, z = poly[i * 7 + 2]!;
      const w = m[3]! * x + m[7]! * y + m[11]! * z;
      poly[i * 7 + 3] = ((m[0]! * x + m[4]! * y + m[8]! * z) / w * 0.5 + 0.5) * W;
      poly[i * 7 + 4] = (0.5 - (m[1]! * x + m[5]! * y + m[9]! * z) / w * 0.5) * H;
      poly[i * 7 + 5] = 1 / w;
      poly[i * 7 + 6] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    }

    const light = (AMBIENT + DIFFUSE * Math.max(0, nx * p.sun[0]! + ny * p.sun[1]! + nz * p.sun[2]!)) * p.light;
    const pal = this.pack.palette;
    const r = pal[colorIndex * 4]! * light;
    const g = pal[colorIndex * 4 + 1]! * light;
    const b = pal[colorIndex * 4 + 2]! * light;
    // The checker samples the world position, pushed slightly behind the face.
    const sx = p.camX - nx * CHECK_INSET;
    const sy = p.camY - ny * CHECK_INSET;
    const sz = p.camZ - nz * CHECK_INSET;
    const fogSpan = p.fogEnd - p.fogStart;

    for (let k = 1; k + 1 < count; k++) {
      const v0 = 0, v1 = k * 7, v2 = (k + 1) * 7;
      const x0 = poly[v0 + 3]!, y0 = poly[v0 + 4]!;
      const x1 = poly[v1 + 3]!, y1 = poly[v1 + 4]!;
      const x2 = poly[v2 + 3]!, y2 = poly[v2 + 4]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;
      this.trianglesDrawn++;
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const fx = px + 0.5;
          const e0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) * inv;
          const e1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) * inv;
          const e2 = 1 - e0 - e1;
          if (e0 < 0 || e1 < 0 || e2 < 0) continue;
          const z = e0 * poly[v0 + 6]! + e1 * poly[v1 + 6]! + e2 * poly[v2 + 6]!;
          const at = py * W + px;
          if (z >= this.depth[at]!) continue;
          if (!blend) {
            this.depth[at] = z;
            this.pickKind[at] = pickKind;
            this.pickId[at] = pickId;
            this.pickBone[at] = this.bone;
          }
          // Perspective-correct position for the checker and fog.
          const q0 = e0 * poly[v0 + 5]!, q1 = e1 * poly[v1 + 5]!, q2 = e2 * poly[v2 + 5]!;
          const qs = 1 / (q0 + q1 + q2);
          const rx = (q0 * poly[v0]! + q1 * poly[v1]! + q2 * poly[v2]!) * qs;
          const ry = (q0 * poly[v0 + 1]! + q1 * poly[v1 + 1]! + q2 * poly[v2 + 1]!) * qs;
          const rz = (q0 * poly[v0 + 2]! + q1 * poly[v1 + 2]! + q2 * poly[v2 + 2]!) * qs;
          const wx = rx + sx, wy = solid ? ry + sy : 0, wz = rz + sz;
          const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
          let shade = 1;
          const cs = CHECK_COARSE_SIZE;
          if (this.plain) shade = 1;
          else {
            if (((Math.floor(wx) + Math.floor(wy) + Math.floor(wz)) & 1) !== 0) shade -= (1 - CHECK_FINE) * Math.max(0, 1 - dist / CHECK_FINE_FADE);
            if (((Math.floor(wx / cs) + Math.floor(wy / cs) + Math.floor(wz / cs)) & 1) !== 0) shade -= (1 - CHECK_COARSE) * Math.max(0, 1 - dist / CHECK_COARSE_FADE);
          }
          let fog = (dist - p.fogStart) / fogSpan;
          fog = fog < 0 ? 0 : fog > 1 ? 1 : fog * fog;
          const o = at * 4;
          const cr = r * shade * (1 - fog) + p.sky[0]! * 255 * fog;
          const cg = g * shade * (1 - fog) + p.sky[1]! * 255 * fog;
          const cb = b * shade * (1 - fog) + p.sky[2]! * 255 * fog;
          if (blend) {
            this.color[o] = this.color[o]! + (cr - this.color[o]!) * WATER_ALPHA;
            this.color[o + 1] = this.color[o + 1]! + (cg - this.color[o + 1]!) * WATER_ALPHA;
            this.color[o + 2] = this.color[o + 2]! + (cb - this.color[o + 2]!) * WATER_ALPHA;
          } else {
            this.color[o] = cr;
            this.color[o + 1] = cg;
            this.color[o + 2] = cb;
          }
        }
      }
    }
  }
}
