// A camera obstruction uses the exact creature pose reserved for this frame's body and saddle.
import type { Socket } from "../../shared/anim/human.ts";
import { boneToModel, rayZones, zoneHit, type Skeleton, type Solved } from "../../shared/anim/skeleton.ts";

/** Reused by Characters; valid only between its frame preparation and the next begin(). */
export class CameraBody {
  rig: (Skeleton & { readonly sockets?: ReadonlyMap<string, Socket> }) | null = null;
  solved: Solved | null = null;
  id = -1;
  generation = -1;
  kind = -1;
  frame = -1;
  x = 0; y = 0; z = 0;
  size = 1;
  /** World-space standing movement height, independent of the head or tail's current animation. */
  standingHeight = 0;
  private sine = 0;
  private cosine = 1;
  private upper = -Infinity;
  horizontalExtent = 0;
  private readonly point = new Float64Array(3);

  set(rig: Skeleton, solved: Solved, id: number, generation: number, kind: number, frame: number, x: number, y: number, z: number, yaw: number, size = 1, height = 0): this {
    this.rig = rig; this.solved = solved;
    this.id = id; this.generation = generation; this.kind = kind; this.frame = frame;
    this.x = x; this.y = y; this.z = z; this.size = size;
    this.sine = Math.sin(yaw); this.cosine = Math.cos(yaw);
    this.upper = -Infinity;
    this.horizontalExtent = 0;
    for (let b = 0; b < rig.zoneBones; b++) {
      if (!rig.zone[b]) continue;
      for (let end = 0; end < 2; end++) {
        const cap = end ? rig.capB : rig.capA;
        boneToModel(solved, b, cap[b * 3]!, cap[b * 3 + 1]!, cap[b * 3 + 2]!, this.point);
        this.horizontalExtent = Math.max(this.horizontalExtent, (Math.hypot(this.point[0]!, this.point[2]!) + rig.capR[b]!) * size);
        this.upper = Math.max(this.upper, y + (this.point[1]! + rig.capR[b]!) * size);
      }
    }
    // Direct pose diagnostics may have no movement content; their geometric envelope is a conservative fallback.
    this.standingHeight = height > 0 ? height * size : Math.max(0, this.upper - y);
    return this;
  }

  clear(): void { this.rig = null; this.solved = null; this.frame = -1; }

  /** Posed native saddle plus a framing point at a seated survivor’s nominal eye height and forward offset. */
  saddleFocus(out: Float64Array): boolean {
    const socket = this.rig?.sockets?.get("seat");
    if (!this.solved || !socket) return false;
    boneToModel(this.solved, socket.bone, socket.x, socket.y, socket.z, this.point);
    const px = this.point[0]! * this.size, pz = this.point[2]! * this.size;
    out[0] = this.x + this.cosine * px + this.sine * pz;
    out[1] = this.y + this.point[1]! * this.size;
    out[2] = this.z + this.cosine * pz - this.sine * px;
    out[3] = out[0] + .24 * this.sine;
    out[4] = out[1] + .78;
    out[5] = out[2] + .24 * this.cosine;
    return true;
  }

  /** The current posed capsule envelope; cached with the pinned pose, not recomputed from a later animation state. */
  top(padding: number): number { return this.rig ? this.upper + padding + .02 : -Infinity; }

  /** World-space unit ray; padding and returned distance are world metres, including on a scaled body. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, padding: number): number {
    if (!this.rig || !this.solved) return length;
    const x = ox - this.x, z = oz - this.z, s = this.sine, c = this.cosine, size = this.size;
    return rayZones(this.rig, this.solved, (c * x - s * z) / size, (oy - this.y) / size, (s * x + c * z) / size,
      c * dx - s * dz, dy, s * dx + c * dz, length / size, padding / size, "capsules") ? zoneHit.t * size : length;
  }
}
