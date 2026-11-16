// Decode and pose a bounded native preview pack without a world, session or renderer.
import { Pose, sampleClip, type Clip } from "../../../shared/anim/clip.ts";
import { buildRig, type Rig } from "../../../shared/anim/rigs.ts";
import { solve } from "../../../shared/anim/skeleton.ts";
import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { lodSkin, lodSurface, lodVertices, readIndices, type Pack, type PackMesh } from "../../../shared/pack/pack.ts";
import type { ModelBounds } from "../../../shared/pages/model.ts";

export interface ModelMesh { vertices: Float32Array; indices: Uint32Array; sections: number[]; skinned: boolean }
export const MODEL_STRIDE = 23;
const snorm = (n: number): number => Math.max(-1, ((n << 22) >> 22) / 511);
export function modelMesh(pack: Pack, mesh: PackMesh, colors: readonly number[]): ModelMesh {
  const lod = mesh.lods[0]!;
  if (lod.vertexCount > 100000 || lod.indexCount > 300000) throw new Error("Preview geometry exceeds its limit");
  const raw = lodVertices(pack, lod), surface = lodSurface(pack, lod), skin = lodSkin(pack, lod);
  const pos = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const surf = surface ? new DataView(surface.buffer, surface.byteOffset, surface.byteLength) : null;
  const vertices = new Float32Array(lod.vertexCount * MODEL_STRIDE);
  for (let v = 0; v < lod.vertexCount; v++) {
    const at = v * MODEL_STRIDE;
    for (let a = 0; a < 3; a++) vertices[at + a] = mesh.center[a]! + pos.getInt16(v * 8 + a * 2, true) / 32767 * mesh.half[a]!;
    if (surf) {
      const normal = surf.getUint32(v * 12 + 4, true), tangent = surf.getUint32(v * 12 + 8, true);
      for (let a = 0; a < 3; a++) { vertices[at + 3 + a] = snorm(normal >>> (a * 10)); vertices[at + 19 + a] = snorm(tangent >>> (a * 10)); }
      vertices[at + 22] = (tangent >> 30) < 0 ? -1 : 1;
      vertices[at + 6] = (mesh.uv?.[0] ?? 0) + surf.getUint16(v * 12, true) / 65535 * (mesh.uv?.[2] ?? 1);
      vertices[at + 7] = (mesh.uv?.[1] ?? 0) + surf.getUint16(v * 12 + 2, true) / 65535 * (mesh.uv?.[3] ?? 1);
    }
    const ink = raw[v * 8 + 6]!;
    const palette = ink >= REGION_BASE ? colors[ink - REGION_BASE] ?? 15 : ink;
    for (let c = 0; c < 3; c++) vertices[at + 8 + c] = pack.palette[palette * 4 + c]! / 255;
    if (skin) for (let k = 0; k < 4; k++) { vertices[at + 11 + k] = skin[v * 8 + k]!; vertices[at + 15 + k] = skin[v * 8 + 4 + k]! / 255; }
    else { vertices[at + 11] = raw[v * 8 + 7]!; vertices[at + 15] = 1; }
  }
  return { vertices, indices: readIndices(pack, lod), sections: lod.sections ?? [-1, 0, lod.indexCount], skinned: !!mesh.skeleton && mesh.rig !== undefined };
}
export class ModelPose {
  readonly rig: Rig | null;
  readonly pose: Pose | null;
  constructor(pack: Pack) {
    this.rig = pack.header.rigs[0] ? buildRig(pack.header.rigs[0], pack.clips) : null;
    if (this.rig && this.rig.bones > 64) throw new Error("Preview rig exceeds its limit");
    this.pose = this.rig ? new Pose(this.rig.bones) : null;
    this.sample(null, 0);
  }
  sample(clip: Clip | null, frame: number): void {
    if (!this.rig || !this.pose) return;
    if (clip) {
      if (clip.bones !== this.rig.bones) throw new Error("Animation does not match this model");
      sampleClip(clip, frame, this.pose);
      this.pose.root[0] = this.pose.root[2] = 0;
    } else this.pose.rest();
    solve(this.rig, this.pose, this.rig.solved);
  }
}
/** Framing includes extremities rather than relying on a standing collision capsule. */
export function meshBounds(meshes: readonly ModelMesh[], pose: ModelPose): ModelBounds {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (let at = 0; at < m.vertices.length; at += MODEL_STRIDE) {
    const p = [0, 0, 0];
    if (m.skinned && pose.rig) {
      const { rest, solved } = pose.rig;
      for (let k = 0; k < 4; k++) {
        const w = m.vertices[at + 15 + k]!;
        if (w <= 0) continue;
        const b = m.vertices[at + 11 + k]!;
        if (b >= pose.rig.bones) throw new Error("Model vertex names a missing bone");
        const x = m.vertices[at]! - rest[b * 3]!, y = m.vertices[at + 1]! - rest[b * 3 + 1]!, z = m.vertices[at + 2]! - rest[b * 3 + 2]!;
        const qx = solved.rot[b * 4]!, qy = solved.rot[b * 4 + 1]!, qz = solved.rot[b * 4 + 2]!, qw = solved.rot[b * 4 + 3]!;
        const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        p[0]! += (x + qw * tx + qy * tz - qz * ty + solved.pos[b * 3]!) * w;
        p[1]! += (y + qw * ty + qz * tx - qx * tz + solved.pos[b * 3 + 1]!) * w;
        p[2]! += (z + qw * tz + qx * ty - qy * tx + solved.pos[b * 3 + 2]!) * w;
      }
    } else for (let k = 0; k < 3; k++) p[k] = m.vertices[at + k]!;
    for (let k = 0; k < 3; k++) { low[k] = Math.min(low[k]!, p[k]!); high[k] = Math.max(high[k]!, p[k]!); }
  }
  const center = low.map((v, k) => (v + high[k]!) / 2) as [number, number, number];
  return { center, radius: Math.max(0.05, Math.hypot(...high.map((v, k) => (v - low[k]!) / 2))), height: Math.max(0.01, high[1]! - low[1]!) };
}
