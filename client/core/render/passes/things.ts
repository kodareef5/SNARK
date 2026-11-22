// Meshes stood somewhere by themselves: a stress scene's, a device page's.

import type { Assets } from "../../assets/assets.ts";
import { TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

/** A mesh stood somewhere by itself, with no entity or structure behind it. `level` is the level it was last drawn at, or -1. */
export interface Thing {
  mesh: number;
  x: number;
  y: number;
  z: number;
  level: number;
}

export class Things implements Pass {
  /** Loose meshes to draw (Scene.things). */
  things: Thing[] = [];
  private readonly radius: Float32Array;

  constructor(assets: Assets) {
    this.radius = assets.table.radius;
  }

  draw(f: Frame): void {
    if (this.things.length === 0) return;
    const p = f.packet, cam = f.cam;
    const errors = f.assets.table.error;
    let wanted = -1;
    for (const t of this.things) {
      const r = this.radius[t.mesh]!;
      const x = t.x - cam.x, y = t.y - cam.y, z = t.z - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      if (p.transientCount === p.transientIds.length) {
        p.dropped++;
        continue;
      }
      const far = Math.sqrt(x * x + y * y + z * z);
      wanted = f.assets.choose(errors[t.mesh]!, far, wanted < 0 ? t.level : wanted);
      f.assets.wantTextured(t.mesh, wanted, far);
      const first = p.transientCount;
      f.transient.set(first, x, y, z, 0, 0);
      p.transientIds[first] = 0;
      const d = p.drawCount;
      f.put.draw(t.mesh, wanted, TRANSIENT_BUFFER, first, 1, 0, 0, 0, 0, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
      // What was drawn, which is coarser than what was wanted until that has come.
      t.level = p.drawCount > d ? p.drawLod[d]! : -1;
      wanted = -1;
      p.transientCount = first + 1;
    }
  }
}
