// The server's side of a body on foot meeting vehicles (shared/sim/foot-contact.ts): each vehicle round it as this
// tick's snapshots will carry it, rounded as `GameServer.viewAround` rounds it. It reads the vehicle as it stands, so it
// holds whether or not the vehicle was stepped this tick.
import { CHUNK_SIZE } from "../shared/coords.ts";
import { dequantX, dequantY, quantX, quantY } from "../shared/net/view.ts";
import { Body, type MoveParams } from "../shared/sim/character.ts";
import { F_PROP } from "../shared/sim/entities.ts";
import { FOOT_SKIN, FootContacts, FootVehicles } from "../shared/sim/foot-contact.ts";
import { packVehiclePose } from "../shared/sim/vehicle-body.ts";
import { packVehicleQuaternionPair } from "../shared/sim/vehicle-presentation.ts";
import { CAPSULE_EXTENT } from "../shared/world/vehicle-pair.ts";
import { vehicleSolidRadius } from "../shared/world/vehicle-shapes.ts";
import type { ServerWorld } from "./world.ts";

export class ServerFootContacts {
  private readonly world: ServerWorld;
  private readonly contacts: FootContacts;
  private readonly list = new FootVehicles();
  private readonly found: number[] = [];
  /** A body going into a vehicle by its approved path does not meet that vehicle (server/vehicle-contacts.ts, `boarding`). */
  boarding: ((actor: number, vehicle: number) => boolean) | null = null;
  /** Diagnostics: bodies that met a vehicle in their own step. */
  met = 0;

  constructor(world: ServerWorld) {
    this.world = world;
    this.contacts = new FootContacts(world, world.reg);
  }

  /** Meets `e`'s body `b`, stepped this tick from `before` with `p`, with the vehicles round it. */
  meet(e: number, before: Body, b: Body, p: MoveParams): void {
    const { world } = this, ents = world.ents, dims = world.dims, found = this.found;
    // A centimetre wider than the shared rule's own test, which is of the rounded place.
    const own = (p.radius + FOOT_SKIN) * CAPSULE_EXTENT + .06;
    const x0 = Math.min(before.x, b.x) - own, x1 = Math.max(before.x, b.x) + own, z0 = Math.min(before.z, b.z) - own, z1 = Math.max(before.z, b.z) + own;
    const pad = this.contacts.reach;
    const cx0 = Math.max(0, Math.floor((x0 - pad) / CHUNK_SIZE)), cx1 = Math.min(dims.chunksX - 1, Math.floor((x1 + pad) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((z0 - pad) / CHUNK_SIZE)), cz1 = Math.min(dims.chunksZ - 1, Math.floor((z1 + pad) / CHUNK_SIZE));
    found.length = 0;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
        const def = world.reg.vehicle[ents.kind[i]!];
        if (!def || i === e || (ents.flags[i]! & F_PROP) !== 0) continue;
        const reach = vehicleSolidRadius(def), x = ents.x[i]!, z = ents.z[i]!;
        if (x + reach < x0 || x - reach > x1 || z + reach < z0 || z - reach > z1 || this.boarding?.(e, i)) continue;
        found.push(i);
      }
    }
    if (found.length === 0) return;
    found.sort((a, c) => a - c);
    const list = this.list;
    list.count = 0;
    for (const i of found) {
      const v = ents.vrow[i]!;
      list.push(ents.kind[i]!, dequantX(quantX(ents.x[i]!)), dequantY(quantY(ents.y[i]!)), dequantX(quantX(ents.z[i]!)), packVehiclePose(ents.vehiclePitch[v]!, ents.vehicleRoll[v]!, ents.steering[v]!),
        packVehicleQuaternionPair(ents.vehicleQx[v]!, ents.vehicleQy[v]!), packVehicleQuaternionPair(ents.vehicleQz[v]!, ents.vehicleQw[v]!));
    }
    if (this.contacts.meet(before, b, p, list)) this.met++;
  }
}
