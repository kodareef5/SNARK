// The vehicles and heavy creatures a ragdoll on the server meets as movers (shared/anim/ragdoll.ts): each one near it
// where it is now and where history had it a tick ago, parked cars too, so a body lands on a car rather than through it.
// Past the most one meets, it meets the nearest, as a watcher does (shared/sim/vehicle-movers.ts nearestMovers).

import { CHUNK_SIZE } from "../shared/coords.ts";
import { makeHandle } from "../shared/ids.ts";
import type { Mover, MoverPose, Ragdoll } from "../shared/anim/ragdoll.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { MOVER_MARGIN, WALKING, moverNear, nearestMovers, solidOf } from "../shared/sim/vehicle-movers.ts";
import { detCos, detSin } from "../shared/math/scalar.ts";
import { Past } from "./history.ts";
import type { ServerWorld } from "./world.ts";

/** A solid a ragdoll may meet, as a mover, with how near it comes and its handle to rank it by. */
interface Met { from: MoverPose; to: MoverPose; boxes: Float64Array; aside: boolean; near: number; handle: number }

export class RagdollMovers {
  private readonly world: ServerWorld;
  private readonly found: Met[] = [];
  private readonly pool: Met[] = [];
  private readonly past = new Past();
  private readonly root = new Float64Array(3);

  constructor(world: ServerWorld) {
    this.world = world;
  }

  /** The solids near ragdoll `r`, reused by the next call. */
  near(r: Ragdoll): readonly Mover[] {
    r.rootPosition(this.root);
    return this.around(this.root[0]!, this.root[1]!, this.root[2]!);
  }

  /** The solids within reach of (x, y, z), the nearest as every machine meets them; reused by the next call. */
  around(x: number, y: number, z: number): readonly Mover[] {
    const { ents, reg, dims, history, tick } = this.world;
    const found = this.found;
    found.length = 0;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      const kx = cx + ox, kz = cz + oz;
      if (kx < 0 || kz < 0 || kx >= dims.chunksX || kz >= dims.chunksZ) continue;
      for (let e = ents.chunkHead[kz * dims.chunksX + kx]!; e >= 0; e = ents.next[e]!) {
        const solid = solidOf(reg, ents.kind[e]!);
        if (!solid || (ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
        const reach = solid.reach + MOVER_MARGIN, dx = ents.x[e]! - x, dz = ents.z[e]! - z;
        if (dx * dx + dz * dz > reach * reach) continue;
        const m = (this.pool[found.length] ??= { from: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, to: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, boxes: new Float64Array(0), aside: false, near: 0, handle: 0 });
        const v = ents.vrow[e]!;
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
        m.near = Math.min(moverNear(solid.boxes, m.from, x, y, z), moverNear(solid.boxes, m.to, x, y, z));
        m.handle = makeHandle(e, ents.gen[e]!);
        found.push(m);
      }
    }
    nearestMovers(found);
    return found;
  }
}

/** A body at (x, y, z) facing `yaw` (1/65536 turns), as a mover's place and turn. */
function facing(out: MoverPose, x: number, y: number, z: number, yaw: number): void {
  const half = (yaw / 65536) * Math.PI;
  Object.assign(out, { x, y, z, qx: 0, qy: detSin(half), qz: 0, qw: detCos(half) });
}
