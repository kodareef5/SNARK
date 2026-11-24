// Pieces shown where they would stand, see-through and in one colour each: a template being set down, and the plans a
// tribe has yet to fill (client/core/hammer.ts). A list of places, drawn as the ghost pass draws its one piece. The
// build-feel lane's "draw these as ghosts" does the same and the two can be folded together.

import type { Assets } from "../../assets/assets.ts";
import { DRAW_BLEND, MAX_HOLOGRAMS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

export class Holograms implements Pass {
  /** The pieces to draw, the first `count` of them: kinds, places in metres, yaws in wire units and palette colours. */
  readonly kind = new Uint16Array(MAX_HOLOGRAMS);
  readonly x = new Float64Array(MAX_HOLOGRAMS);
  readonly y = new Float32Array(MAX_HOLOGRAMS);
  readonly z = new Float64Array(MAX_HOLOGRAMS);
  readonly yaw = new Uint16Array(MAX_HOLOGRAMS);
  readonly color = new Uint8Array(MAX_HOLOGRAMS);
  count = 0;
  private readonly meshOfKind: Uint16Array;
  private readonly radius: Float32Array;

  constructor(assets: Assets, meshOfKind: Uint16Array) {
    this.meshOfKind = meshOfKind;
    this.radius = assets.table.radius;
  }

  /** Adds a piece. False when the frame's list is full. */
  add(kind: number, x: number, y: number, z: number, yaw: number, color: number): boolean {
    const i = this.count;
    if (i >= MAX_HOLOGRAMS) return false;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.yaw[i] = yaw;
    this.color[i] = color;
    this.count = i + 1;
    return true;
  }

  draw(f: Frame): void {
    const p = f.packet, cam = f.cam, put = f.put;
    for (let i = 0; i < this.count; i++) {
      const first = p.transientCount;
      const x = this.x[i]! - cam.x, y = this.y[i]! - cam.y, z = this.z[i]! - cam.z;
      const color = this.color[i]!;
      f.transient.set(first, x, y, z, this.yaw[i]!, color);
      p.transientIds[first] = 0;
      const mesh = this.meshOfKind[this.kind[i]!]!;
      const r = this.radius[mesh]!;
      put.tint = color + 1;
      put.draw(mesh, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_BLEND, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
      p.transientCount = first + 1;
    }
    put.tint = 0;
  }
}
