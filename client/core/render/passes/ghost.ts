// The piece a builder is about to place, shown see-through where it would stand, and the pieces it has set down that
// the server has not yet sent a row for (predict-build.ts), shown as built. With them, this frame's marks: pieces and
// slots' outlines drawn see-through in one colour each, for a row being dragged, the places a piece may go, pieces
// that would fall, a plan.

import type { Assets } from "../../assets/assets.ts";
import { STRUCT_UNITS } from "../../../../shared/coords.ts";
import { poseOf, type LatticePose } from "../../../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_VERTEX } from "../../../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../../../shared/world/structures.ts";
import { DRAW_BLEND, MAX_PREDICTED, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

/** The pack's meshes for a slot's mark: a side's strip, a square's outline, a corner's pad (tools/pack/slots.ts). */
export const SLOT_EDGE_MESH = "core:slot_edge";
export const SLOT_SQUARE_MESH = "core:slot_square";
export const SLOT_VERTEX_MESH = "core:slot_vertex";
/** Marks one frame may hold. One past that is not drawn. */
export const MARKS_MOST = 320;

/** A piece set down and not yet a row: kind 0 for none. `fade` is 0 while it stands as built, and from there to 1 as a refused one goes. */
export interface PredictedPiece {
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fade: number;
}

/** A mesh drawn see-through for one frame in one palette colour, `fade` of the way to nothing. */
interface Mark {
  mesh: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: number;
  fade: number;
}

const pose: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };

export class Ghost implements Pass {
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  /** The pieces set down and awaited, the first `predicted` of them, and the palette colour a refused one goes in. */
  readonly pieces: PredictedPiece[] = Array.from({ length: MAX_PREDICTED }, () => ({ kind: 0, x: 0, y: 0, z: 0, yaw: 0, fade: 0 }));
  predicted = 0;
  refusedColor = 0;
  /** This frame's marks, the first `marked` of them. Whoever shows marks clears them each frame and adds its own. */
  readonly marks: Mark[] = Array.from({ length: MARKS_MOST }, () => ({ mesh: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0, fade: 0 }));
  marked = 0;
  private readonly meshOfKind: Uint16Array;
  private readonly colorOfKind: Uint8Array;
  private readonly radius: Float32Array;
  /** The slot meshes by class, -1 where the pack has none. */
  private readonly slotMesh: number[];

  /** `meshOfKind` and `colorOfKind` are the scene's: the pack mesh and the palette colour of each content index. */
  constructor(assets: Assets, meshOfKind: Uint16Array, colorOfKind: Uint8Array) {
    this.meshOfKind = meshOfKind;
    this.colorOfKind = colorOfKind;
    this.radius = assets.table.radius;
    this.slotMesh = [];
    this.slotMesh[CLS_VERTEX] = assets.table.find(SLOT_VERTEX_MESH);
    this.slotMesh[CLS_EDGE] = assets.table.find(SLOT_EDGE_MESH);
    this.slotMesh[CLS_SQUARE] = assets.table.find(SLOT_SQUARE_MESH);
  }

  /** Forgets the frame's marks. */
  clear(): void {
    this.marked = 0;
  }

  /** Marks a piece of `kind` at a place in metres and a facing in wire units, in palette colour `color`. */
  piece(kind: number, x: number, y: number, z: number, yaw: number, color: number, fade = 0): void {
    this.mark(this.meshOfKind[kind]!, x, y, z, yaw, color, fade);
  }

  /** Marks a piece of `kind` in the slot (k0, k1) of frame `fr` of `structs`. False where the frame is not made. */
  keyed(structs: StructureStore, kind: number, fr: number, k0: number, k1: number, color: number, fade = 0): boolean {
    const f = structs.frames.get(fr);
    if (!f || !structs.forms) return false;
    poseOf(f, k0, k1, structs.forms, kind, pose);
    this.piece(kind, pose.x / STRUCT_UNITS, pose.y / STRUCT_UNITS, pose.z / STRUCT_UNITS, pose.yaw, color, fade);
    return true;
  }

  /** Marks a slot of class `cls` (a CLS_ of the lattice) by its outline: a side at its middle, a square at its middle, a corner at its point. */
  slot(cls: number, x: number, y: number, z: number, yaw: number, color: number, fade = 0): void {
    const mesh = this.slotMesh[cls] ?? -1;
    if (mesh >= 0) this.mark(mesh, x, y, z, yaw, color, fade);
  }

  private mark(mesh: number, x: number, y: number, z: number, yaw: number, color: number, fade: number): void {
    if (this.marked === MARKS_MOST) return;
    const m = this.marks[this.marked++]!;
    [m.mesh, m.x, m.y, m.z, m.yaw, m.color, m.fade] = [mesh, x, y, z, yaw & 0xffff, color, fade];
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
    this.drawMarks(f);
  }

  /** The marks, those next to each other of one mesh, colour and fade as one draw. */
  private drawMarks(f: Frame): void {
    const p = f.packet, cam = f.cam, put = f.put;
    const room = p.transientIds.length;
    for (let i = 0; i < this.marked && p.transientCount < room; ) {
      const m = this.marks[i]!;
      const first = p.transientCount;
      const r = this.radius[m.mesh]!;
      let n = 0;
      let from = Infinity;
      let to = -Infinity;
      for (; i < this.marked && first + n < room; i++, n++) {
        const q = this.marks[i]!;
        if (q.mesh !== m.mesh || q.color !== m.color || q.fade !== m.fade) break;
        const x = q.x - cam.x, y = q.y - cam.y, z = q.z - cam.z;
        f.transient.set(first + n, x, y, z, q.yaw, q.color);
        p.transientIds[first + n] = 0;
        from = Math.min(from, cam.depth(x, y, z) - r);
        to = Math.max(to, cam.depth(x, y, z) + r);
      }
      put.tint = m.color + 1;
      put.fade = m.fade;
      put.draw(m.mesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, DRAW_BLEND, cam.passesOf(from, to));
      put.tint = put.fade = 0;
      p.transientCount = first + n;
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
