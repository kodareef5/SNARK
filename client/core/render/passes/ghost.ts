// The piece a builder is about to place, shown see-through where it would stand, and the pieces it has set down that
// the server has not yet sent a row for (predict-build.ts), shown as built.

import type { Assets } from "../../assets/assets.ts";
import { DRAW_BLEND, MAX_PREDICTED, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

/** A piece set down and not yet a row: kind 0 for none. `fade` is 0 while it stands as built, and from there to 1 as a refused one goes. */
export interface PredictedPiece {
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fade: number;
}

export class Ghost implements Pass {
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  /** The pieces set down and awaited, the first `predicted` of them, and the palette colour a refused one goes in. */
  readonly pieces: PredictedPiece[] = Array.from({ length: MAX_PREDICTED }, () => ({ kind: 0, x: 0, y: 0, z: 0, yaw: 0, fade: 0 }));
  predicted = 0;
  refusedColor = 0;
  private readonly meshOfKind: Uint16Array;
  private readonly colorOfKind: Uint8Array;
  private readonly radius: Float32Array;

  /** `meshOfKind` and `colorOfKind` are the scene's: the pack mesh and the palette colour of each content index. */
  constructor(assets: Assets, meshOfKind: Uint16Array, colorOfKind: Uint8Array) {
    this.meshOfKind = meshOfKind;
    this.colorOfKind = colorOfKind;
    this.radius = assets.table.radius;
  }

  draw(f: Frame): void {
    const g = this.ghost;
    // The whole mesh takes the colour, so a piece with colours of its own shows fine or refused as a plain one does.
    if (g.kind !== 0) this.one(f, g.kind, g.x, g.y, g.z, g.yaw, g.color, DRAW_BLEND, g.color + 1, 0);
    for (let i = 0; i < this.predicted; i++) {
      const q = this.pieces[i]!;
      if (q.kind === 0) continue;
      // As built until it is refused; then see-through in the refused colour, going.
      if (q.fade <= 0) this.one(f, q.kind, q.x, q.y, q.z, q.yaw, this.colorOfKind[q.kind]!, 0, 0, 0);
      else this.one(f, q.kind, q.x, q.y, q.z, q.yaw, this.refusedColor, DRAW_BLEND, this.refusedColor + 1, Math.min(1, q.fade));
    }
  }

  private one(f: Frame, kind: number, wx: number, wy: number, wz: number, yaw: number, color: number, flags: number, tint: number, fade: number): void {
    const p = f.packet, cam = f.cam, put = f.put;
    const first = p.transientCount;
    const x = wx - cam.x, y = wy - cam.y, z = wz - cam.z;
    f.transient.set(first, x, y, z, yaw, color);
    p.transientIds[first] = 0;
    const mesh = this.meshOfKind[kind]!;
    const r = this.radius[mesh]!;
    put.tint = tint;
    put.fade = fade;
    put.draw(mesh, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
    put.tint = put.fade = 0;
    p.transientCount = first + 1;
  }
}
