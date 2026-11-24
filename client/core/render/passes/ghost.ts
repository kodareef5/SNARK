// The piece a builder is about to place, shown see-through where it would stand, and the pieces it has set down that
// the server has not yet sent a row for (predict-build.ts), shown as built.

import type { Assets } from "../../assets/assets.ts";
import { DRAW_BLEND, DRAW_PIECE, MAX_PREDICTED, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { FrameTable, PIECE_FRAMED, pieceWord, plainYaw, writePiece } from "../piece-fit.ts";
import type { PieceLooks } from "../piece-state.ts";

/**
 * A piece set down and not yet a row: kind 0 for none. `tw` is its turn class, as a row's (0 unless it stands 30 or 60
 * degrees round in its base). `fade` is 0 while it stands as built, and from there to 1 as a refused one goes.
 */
export interface PredictedPiece {
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tw: number;
  fade: number;
}

export class Ghost implements Pass {
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, tw its turn class, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, tw: 0, color: 0 };
  /** The pieces set down and awaited, the first `predicted` of them, and the palette colour a refused one goes in. */
  readonly pieces: PredictedPiece[] = Array.from({ length: MAX_PREDICTED }, () => ({ kind: 0, x: 0, y: 0, z: 0, yaw: 0, tw: 0, fade: 0 }));
  predicted = 0;
  refusedColor = 0;
  private readonly meshOfKind: Uint16Array;
  private readonly colorOfKind: Uint8Array;
  private readonly radius: Float32Array;
  /** How built pieces are drawn (the near store's): with it, a piece is shown by the basis its row will be drawn by. */
  looks: PieceLooks | null = null;
  /** The bases this frame's pieces stand in. */
  private readonly frames = new FrameTable();

  /** `meshOfKind` and `colorOfKind` are the scene's: the pack mesh and the palette colour of each content index. */
  constructor(assets: Assets, meshOfKind: Uint16Array, colorOfKind: Uint8Array) {
    this.meshOfKind = meshOfKind;
    this.colorOfKind = colorOfKind;
    this.radius = assets.table.radius;
  }

  draw(f: Frame): void {
    const g = this.ghost;
    this.frames.clear();
    if (this.looks) f.packet.frameTables.set(TRANSIENT_BUFFER, this.frames);
    // The whole mesh takes the colour, so a piece with colours of its own shows fine or refused as a plain one does.
    if (g.kind !== 0) this.one(f, g.kind, g.x, g.y, g.z, g.yaw, g.tw, g.color, DRAW_BLEND, g.color + 1, 0);
    for (let i = 0; i < this.predicted; i++) {
      const q = this.pieces[i]!;
      if (q.kind === 0) continue;
      // As built until it is refused; then see-through in the refused colour, going.
      if (q.fade <= 0) this.one(f, q.kind, q.x, q.y, q.z, q.yaw, q.tw, this.colorOfKind[q.kind]!, 0, 0, 0);
      else this.one(f, q.kind, q.x, q.y, q.z, q.yaw, q.tw, this.refusedColor, DRAW_BLEND, this.refusedColor + 1, Math.min(1, q.fade));
    }
  }

  private one(f: Frame, kind: number, wx: number, wy: number, wz: number, yaw: number, tw: number, color: number, flags: number, tint: number, fade: number): void {
    const p = f.packet, cam = f.cam, put = f.put;
    const first = p.transientCount;
    const x = wx - cam.x, y = wy - cam.y, z = wz - cam.z;
    const mesh = this.meshOfKind[kind]!;
    f.transient.set(first, x, y, z, yaw, color);
    // A built piece stands as its row will: on its base's own vectors, with no end or side given way.
    if (this.looks && this.looks.flag[mesh] !== 0) {
      const at = this.frames.add(yaw);
      writePiece(p.transient, first, at < 0 ? plainYaw(yaw, tw) : pieceWord(at, yaw, tw), this.looks.made[kind]!, at < 0 ? 0 : PIECE_FRAMED, this.looks.fit[kind]!);
      flags |= DRAW_PIECE;
    }
    p.transientIds[first] = 0;
    const r = this.radius[mesh]!;
    put.tint = tint;
    put.fade = fade;
    put.draw(mesh, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
    put.tint = put.fade = 0;
    p.transientCount = first + 1;
  }
}
