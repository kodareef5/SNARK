import type { Registry } from "../../shared/content/registry.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { tekWallKinds } from "../../shared/world/lattice/tek-walls.ts";
import { rayBox } from "../../shared/world/ray.ts";
import { Found, type StructureStore } from "../../shared/world/structures.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";

/** Owners can aim the structure menu at an open field while bodies, shots and ordinary use pass through. */
export class OpenWallPick {
  private readonly kind: number;
  private readonly half: readonly [number, number, number];
  private readonly found = new Found(16);
  private readonly refs: number[] = [];
  private store: StructureStore | null = null;
  private shape = -1;
  private gx = 0;
  private gy = 0;
  private gz = 0;

  constructor(reg: Registry) {
    this.kind = tekWallKinds(reg.index).open;
    this.half = [reg.halfX[this.kind]!, reg.halfY[this.kind]!, reg.halfZ[this.kind]!];
  }

  at(store: StructureStore, team: number, x: number, y: number, z: number, dir: readonly number[], limit: number): number {
    if (!this.kind || !team) return -1;
    const gx = Math.floor(x), gy = Math.floor(y), gz = Math.floor(z);
    if (store !== this.store || this.shape !== store.shapes || gx !== this.gx || gy !== this.gy || gz !== this.gz) {
      this.store = store;
      this.shape = store.shapes;
      this.gx = gx;
      this.gy = gy;
      this.gz = gz;
      this.refs.length = 0;
      const r = ACT_REACH;
      const n = store.query(gx - r, gz - r, gx + 1 + r, gz + 1 + r, this.found, gy - r, gy + 1 + r);
      for (let i = 0; i < n; i++) {
        const ref = this.found.refs[i]!;
        if (store.chunks[ref >>> 16]!.kind[ref & 65535] === this.kind) this.refs.push(ref);
      }
    }
    const [hx, hy, hz] = this.half;
    let best = limit, picked = -1;
    for (const ref of this.refs) {
      const row = store.chunks[ref >>> 16]!, s = ref & 65535;
      if (row.owner[s] !== team) continue;
      frameOf(row.yaw[s]!, row.twAt(s));
      const c = frame.cos, sn = frame.sin, scale = frame.stretch;
      const px = x - row.x[s]!, pz = z - row.z[s]!;
      const hit = rayBox((c * px - sn * pz) / scale, y - row.y[s]!, (sn * px + c * pz) / scale,
        (c * dir[0]! - sn * dir[2]!) / scale, dir[1]!, (sn * dir[0]! + c * dir[2]!) / scale, -hx, -hy, -hz, hx, hy, hz);
      if (hit < best) { best = hit; picked = ref; }
    }
    return picked;
  }
}
