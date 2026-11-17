// A map's landmarks past the near rows, each drawn from its far mesh (shared/pack/far.ts) as one instance at its origin
// turned by its yaw. A piece of it is drawn here while the near store does not hold the chunk its static stands in whole,
// and then the near store draws none of that chunk, so each piece is drawn one way or the other and never both or
// neither. Pieces next to each other in the mesh's order, drawn here and in the same depth ranges, are one ranged draw,
// at the finest level a piece of it asks for by its distance, as any mesh's level is asked for. The levels asked for
// are wanted while any of the landmark is within reach, whoever draws its pieces, so a chunk let go finds its level on
// the card. Until a level has come nothing is drawn in its place.

import { STRUCT_UNITS, chunkAt, type MapDims } from "../../../shared/coords.ts";
import type { LandmarkFar } from "../../../shared/pack/far.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import { landmarkPoint } from "../../../shared/world/landmark.ts";
import type { MapLandmark } from "../../../shared/world/mapfile.ts";
import type { Assets } from "../assets/assets.ts";
import type { Camera } from "./camera.ts";
import { FAR_BUFFER } from "./far.ts";
import { InstanceWriter, type FramePacket } from "./packet.ts";

/** The instance buffer the landmarks are drawn with: one instance a landmark, at the origin, turned by its yaw. */
export const LANDMARK_BUFFER = FAR_BUFFER + 3;

/** A landmark as it is drawn far: its far mesh, where it stands, and per piece where it is drawn and the chunk it belongs to. */
export interface PlacedFar {
  readonly far: LandmarkFar;
  /** Its instance in LANDMARK_BUFFER. */
  readonly instance: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** In 1/65,536 turns. */
  readonly yaw: number;
  /** Per piece: the chunk its static stands in, and the middle of its sphere in the world as the mesh is turned. */
  readonly chunk: Int32Array;
  readonly at: Float64Array;
  /** The box every piece's sphere is in. */
  readonly box: Float64Array;
  /** Per piece: the level it last asked for, -1 for none; and this frame, the depth ranges it is drawn here in, or 0 for none. */
  readonly level: Int8Array;
  readonly ways: Uint8Array;
  /** Per piece this frame: metres from the camera to the farthest of its sphere. */
  readonly most: Float64Array;
}

export class FarLandmarks {
  readonly placed: readonly PlacedFar[];
  /** Last frame: runs in view and reach not drawn, their level not yet on the card. */
  readonly stats = { unseen: 0 };
  private readonly source: { complete(chunk: number): boolean };
  /** Per chunk, 1 where a landmark's piece belongs to it. */
  private readonly has: Uint8Array;
  private on = false;
  private sent = false;
  private readonly instances: Uint8Array;
  /** Per level this frame: the level of the card drawn for it, -2 for not yet asked. */
  private readonly drawn = [-2, -2];
  private readonly nearest = [0, 0];

  /** `placed` are the map's landmarks, and `fars` the far meshes the manifest lists; a landmark with none is left out. */
  constructor(source: { complete(chunk: number): boolean }, dims: MapDims, placed: readonly MapLandmark[], fars: readonly LandmarkFar[]) {
    this.source = source;
    this.has = new Uint8Array(dims.chunksX * dims.chunksZ);
    const out: PlacedFar[] = [];
    const p = [0, 0, 0];
    const snap = (v: number): number => Math.fround(Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
    for (const l of placed) {
      const far = fars.find((f) => f.name === l.name);
      if (!far) continue;
      const n = far.pieces;
      const chunk = new Int32Array(n), at = new Float64Array(n * 3);
      const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
      // As the instance is turned: x' = c x + s z, z' = c z - s x.
      const a = (l.yaw / 65536) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let i = 0; i < n; i++) {
        const lx = far.at[i * 3]!, ly = far.at[i * 3 + 1]!, lz = far.at[i * 3 + 2]!, r = far.radius[i]!;
        landmarkPoint(l.x, l.y, l.z, l.yaw, [lx, ly, lz], p);
        chunk[i] = chunkAt(dims, snap(p[0]!), snap(p[2]!));
        this.has[chunk[i]!] = 1;
        at[i * 3] = l.x + c * lx + s * lz;
        at[i * 3 + 1] = l.y + ly;
        at[i * 3 + 2] = l.z + c * lz - s * lx;
        for (let k = 0; k < 3; k++) {
          box[k] = Math.min(box[k]!, at[i * 3 + k]! - r);
          box[k + 3] = Math.max(box[k + 3]!, at[i * 3 + k]! + r);
        }
      }
      out.push({ far, instance: out.length, x: l.x, y: l.y, z: l.z, yaw: l.yaw, chunk, at, box, level: new Int8Array(n).fill(-1), ways: new Uint8Array(n), most: new Float64Array(n) });
    }
    this.placed = out;
    this.instances = new Uint8Array(out.length * INSTANCE_BYTES);
    const w = new InstanceWriter(this.instances);
    for (const l of out) w.set(l.instance, 0, 0, 0, l.yaw, 0);
  }

  /** Whether a landmark's pieces of `chunk` are drawn here this frame, so the near store draws none of that chunk. */
  isFar(chunk: number): boolean {
    return this.on && this.has[chunk] === 1 && !this.source.complete(chunk);
  }

  /** After a lost context: the instance buffer goes on the card again. */
  reset(): void {
    this.sent = false;
  }

  /**
   * Calls `put` for each run of a landmark's pieces drawn here, within `reach` of the camera and in its view: its far mesh
   * and the level of the card to draw, its instance, its first index and how many, where its origin is from the camera,
   * the depth ranges its pieces are in, and where it is gone (`drawFade`, 0 for a run wholly short of where the reach
   * fades over its last `share`). Levels are chosen and wanted through `assets`. The instance buffer's upload goes in the
   * packet.
   */
  draw(p: FramePacket, cam: Camera, assets: Assets, reach: number, share: number, put: (mesh: number, level: number, instance: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number) => void): void {
    this.on = reach > 0;
    this.stats.unseen = 0;
    if (!this.on || this.placed.length === 0) return;
    if (!this.sent) {
      p.uploads.push({ buffer: LANDMARK_BUFFER, data: this.instances, slots: new Uint16Array(this.placed.length) });
      this.sent = true;
    }
    const whole = reach * (1 - share);
    for (const l of this.placed) {
      const b = l.box;
      const off = Math.hypot(Math.max(b[0]! - cam.x, cam.x - b[3]!, 0), Math.max(b[1]! - cam.y, cam.y - b[4]!, 0), Math.max(b[2]! - cam.z, cam.z - b[5]!, 0));
      if (off >= reach) {
        l.level.fill(-1);
        continue;
      }
      const { far, at, ways, level, most, chunk } = l;
      const mesh = far.mesh;
      const errors = assets.table.error[mesh]!;
      this.nearest[0] = this.nearest[1] = Infinity;
      for (let i = 0; i < far.pieces; i++) {
        const r = far.radius[i]!;
        const x = at[i * 3]! - cam.x, y = at[i * 3 + 1]! - cam.y, z = at[i * 3 + 2]! - cam.z;
        const d = Math.sqrt(x * x + y * y + z * z);
        const near = Math.max(0, d - r);
        ways[i] = 0;
        if (near >= reach) {
          level[i] = -1;
          continue;
        }
        const k = (level[i] = assets.choose(errors, near, level[i]!));
        if (near < this.nearest[k]!) this.nearest[k] = near;
        if (this.source.complete(chunk[i]!) || !cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
        ways[i] = cam.passes(x - r, y - r, z - r, x + r, y + r, z + r);
        most[i] = d + r;
      }
      // With no level on the card nothing of the landmark is drawn here, so its coarser level comes first.
      const nearest = Math.min(this.nearest[0]!, this.nearest[1]!);
      if (nearest < Infinity && assets.held(mesh) === 0) assets.wantFirst(mesh, 1, nearest);
      for (let k = 0; k < 2; k++) if (this.nearest[k]! < Infinity) assets.want(mesh, k, this.nearest[k]!);
      this.drawn[0] = this.drawn[1] = -2;
      const ox = l.x - cam.x, oy = l.y - cam.y, oz = l.z - cam.z;
      for (let run = 0, i = 1; i <= far.pieces; i++) {
        if (i < far.pieces && ways[i] === ways[run]) continue;
        if (ways[run]! > 0) {
          // A run is drawn at the finest level a piece of it asks for: a draw costs more than its coarser pieces drawn finer.
          let wanted = 1, farthest = 0;
          for (let j = run; j < i; j++) {
            wanted = Math.min(wanted, level[j]!);
            farthest = Math.max(farthest, most[j]!);
          }
          if (this.drawn[wanted] === -2) this.drawn[wanted] = assets.level(mesh, wanted);
          const lod = this.drawn[wanted]!;
          if (lod < 0) this.stats.unseen++;
          else {
            const firsts = far.first[lod as 0 | 1], counts = far.count[lod as 0 | 1], first = firsts[run]!;
            put(mesh, lod, l.instance, first, firsts[i - 1]! + counts[i - 1]! - first, ox, oy, oz, ways[run]!, farthest < whole ? 0 : reach);
          }
        }
        run = i;
      }
    }
  }
}
