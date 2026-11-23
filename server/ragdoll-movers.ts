// The vehicles and heavy creatures a ragdoll on the server meets as movers (shared/anim/ragdoll.ts): each one near it
// where it is now and where history had it a tick ago, parked cars too, so a body lands on a car rather than through it.

import { CHUNK_SIZE } from "../shared/coords.ts";
import type { Mover, MoverPose, Ragdoll } from "../shared/anim/ragdoll.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { WALKING, solidOf } from "../shared/sim/vehicle-movers.ts";
import { detCos, detSin } from "../shared/math/scalar.ts";
import { Past } from "./history.ts";
import type { ServerWorld } from "./world.ts";

/** The most vehicles one ragdoll meets in a step, and metres beyond a vehicle's reach within which it meets one. */
const MOST = 4;
const MARGIN = 2;

export class RagdollMovers {
  private readonly world: ServerWorld;
  private readonly found: Mover[] = [];
  private readonly pool: { from: MoverPose; to: MoverPose; boxes: Float64Array; aside: boolean }[] = Array.from({ length: MOST }, () => ({
    from: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, to: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, boxes: new Float64Array(0), aside: false,
  }));
  private readonly past = new Past();
  private readonly root = new Float64Array(3);

  constructor(world: ServerWorld) {
    this.world = world;
  }

  /** The vehicles near ragdoll `r`, reused by the next call. */
  near(r: Ragdoll): readonly Mover[] {
    r.rootPosition(this.root);
    return this.around(this.root[0]!, this.root[2]!);
  }

  /** The vehicles within reach of (x, z), reused by the next call. */
  around(x: number, z: number): readonly Mover[] {
    const { ents, reg, dims, history, tick } = this.world;
    const found = this.found;
    found.length = 0;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const kx = cx + ox, kz = cz + oz;
      if (kx < 0 || kz < 0 || kx >= dims.chunksX || kz >= dims.chunksZ) continue;
      for (let e = ents.chunkHead[kz * dims.chunksX + kx]!; e >= 0 && found.length < MOST; e = ents.next[e]!) {
        const solid = solidOf(reg, ents.kind[e]!);
        if (!solid || (ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
        const reach = solid.reach + MARGIN, dx = ents.x[e]! - x, dz = ents.z[e]! - z;
        if (dx * dx + dz * dz > reach * reach) continue;
        const m = this.pool[found.length]!, v = ents.vrow[e]!;
        if (solid.vehicle) Object.assign(m.to, { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]!, qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! });
        else facing(m.to, ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.yaw[e]!);
        const p = this.past;
        if (!history.at(tick - 1, e, p)) Object.assign(m.from, m.to);
        else if (solid.vehicle) Object.assign(m.from, { x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
        else facing(m.from, p.x, p.y, p.z, p.yaw);
        // A creature meets what lies at its feet only as it walks.
        if (!solid.vehicle && (m.to.x - m.from.x) * (m.to.x - m.from.x) + (m.to.z - m.from.z) * (m.to.z - m.from.z) < WALKING * WALKING) continue;
        m.boxes = solid.boxes;
        m.aside = !solid.vehicle;
        found.push(m);
      }
    }
    return found;
  }
}

/** A body at (x, y, z) facing `yaw` (1/65536 turns), as a mover's place and turn. */
function facing(out: MoverPose, x: number, y: number, z: number, yaw: number): void {
  const half = (yaw / 65536) * Math.PI;
  Object.assign(out, { x, y, z, qx: 0, qy: detSin(half), qz: 0, qw: detCos(half) });
}
