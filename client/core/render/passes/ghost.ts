// The piece a builder is about to place, shown see-through where it would stand.

import type { Assets } from "../../assets/assets.ts";
import { DRAW_BLEND, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";

export class Ghost implements Pass {
  /** The piece shown where it would be built. kind is 0 for none, x, y, z are metres, yaw is in wire units, color is a palette index. */
  readonly ghost = { kind: 0, x: 0, y: 0, z: 0, yaw: 0, color: 0 };
  private readonly meshOfKind: Uint16Array;
  private readonly radius: Float32Array;

  /** `meshOfKind` is the scene's: the pack mesh of each content index. */
  constructor(assets: Assets, meshOfKind: Uint16Array) {
    this.meshOfKind = meshOfKind;
    this.radius = assets.table.radius;
  }

  draw(f: Frame): void {
    if (this.ghost.kind === 0) return;
    const p = f.packet, cam = f.cam;
    const g = this.ghost;
    const first = p.transientCount;
    const x = g.x - cam.x, y = g.y - cam.y, z = g.z - cam.z;
    f.transient.set(first, x, y, z, g.yaw, g.color);
    p.transientIds[first] = 0;
    const mesh = this.meshOfKind[g.kind]!;
    const r = this.radius[mesh]!;
    f.put.draw(mesh, 0, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_BLEND, cam.passes(x - r, y - r, z - r, x + r, y + r, z + r));
    p.transientCount = first + 1;
  }
}
