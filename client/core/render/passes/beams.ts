// Beams of light over places to mark: where the viewer died.

import type { Assets } from "../../assets/assets.ts";
import { TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

const BEAM_MESH = "core:beam";
/** Palette colour of the beam over a place of death. */
const BEAM_COLOR = 8;

export class Beams implements Pass {
  /** Places to mark with a beam, x, y, z each. The app sets them before build() (Scene.beams). */
  readonly beams: number[] = [];
  private readonly mesh: number;
  private readonly radius: Float32Array;

  constructor(assets: Assets) {
    this.mesh = assets.table.find(BEAM_MESH);
    this.radius = assets.table.radius;
  }

  draw(f: Frame): void {
    if (this.beams.length === 0 || this.mesh < 0) return;
    const p = f.packet, cam = f.cam;
    const first = p.transientCount;
    let n = 0;
    let from = Infinity;
    let to = -Infinity;
    const r = this.radius[this.mesh]!;
    for (let i = 0; i + 2 < this.beams.length && n < 16; i += 3) {
      const x = this.beams[i]! - cam.x, y = this.beams[i + 1]! - cam.y, z = this.beams[i + 2]! - cam.z;
      f.transient.set(first + n, x, y, z, 0, BEAM_COLOR);
      p.transientIds[first + n] = 0;
      from = Math.min(from, cam.depth(x, y, z) - r);
      to = Math.max(to, cam.depth(x, y, z) + r);
      n++;
    }
    p.dropped += Math.floor(this.beams.length / 3) - n;
    f.put.draw(this.mesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, 0, cam.passesOf(from, to));
    p.transientCount = first + n;
  }
}
