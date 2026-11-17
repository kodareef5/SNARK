// Native vehicle impacts spend kinetic energy to fracture wood nodes. The resource lifecycle owns every disappearance.
import { CHUNK_SIZE, TICK_DT } from "../shared/coords.ts";
import { stepVehicleBody } from "../shared/sim/vehicle-body.ts";
import { TreeFracture } from "../shared/sim/vehicle-tree.ts";
import { isWheelVehicle, type VehicleContact, type VehicleSpec, type VehicleState } from "../shared/sim/vehicle.ts";
import { StaticVehicleWorld } from "../shared/world/vehicle.ts";
import type { Harvest } from "./harvest.ts";
import type { ServerWorld } from "./world.ts";

export class VehicleTrees extends StaticVehicleWorld {
  private readonly fracture: TreeFracture;
  private readonly authority: ServerWorld;
  private readonly harvest: Harvest;
  constructor(authority: ServerWorld, harvest: Harvest) {
    super(authority); this.authority = authority; this.harvest = harvest; this.fracture = new TreeFracture(authority.reg, harvest.field.forms);
  }

  /** Cold nodes are retained only for the swept neighbourhood of this wheel step, then released symmetrically. */
  readonly step: typeof stepVehicleBody = (world, body, moveX, moveZ, buttons, definition, dt = TICK_DT, yaw = body.yaw, pilot = true) => {
    if (!isWheelVehicle(definition)) { stepVehicleBody(world, body, moveX, moveZ, buttons, definition, dt, yaw, pilot); return; }
    const dims = this.authority.dims, reach = Math.hypot(definition.spec.halfWidth, definition.spec.halfLength, definition.spec.height) + this.fracture.reach + 1;
    const endX = body.x + body.vx * dt, endZ = body.z + body.vz * dt;
    const minX = Math.max(0, Math.floor((Math.min(body.x, endX) - reach) / CHUNK_SIZE));
    const maxX = Math.min(dims.chunksX - 1, Math.floor((Math.max(body.x, endX) + reach) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((Math.min(body.z, endZ) - reach) / CHUNK_SIZE));
    const maxZ = Math.min(dims.chunksZ - 1, Math.floor((Math.max(body.z, endZ) + reach) / CHUNK_SIZE));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) this.harvest.retain(z * dims.chunksX + x, 0, 1);
    try { stepVehicleBody(world, body, moveX, moveZ, buttons, definition, dt, yaw, pilot, this); }
    finally { for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) this.harvest.retain(z * dims.chunksX + x, 0, -1); }
  };

  breakContact(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null {
    if (!hit.reason.startsWith("node:") || hit.x === undefined || hit.y === undefined || hit.z === undefined) return null;
    const ref = Number(hit.reason.slice(5)), chunk = Math.floor(ref / 65536), index = ref & 65535;
    const field = this.harvest.field, row = field.store.chunks[chunk], form = row?.kind[index] ?? 0;
    if (this.harvest.regrowsAt(chunk, index)) return null;
    const impulse = this.fracture.impulse(state, spec, hit, form);
    if (!Number.isFinite(impulse) || !this.harvest.breakTree(chunk, index)) return null;
    return this.fracture.apply(state, spec, hit, form, impulse);
  }
}
