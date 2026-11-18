// Native vehicle impacts spend kinetic energy to fracture wood nodes. The resource lifecycle owns every disappearance.
// A street lamp or pole hit as hard falls the same way: the same account, then its fallen kind swapped in where it stood.
import { STREET_TOPPLES } from "../content/street.ts";
import { CHUNK_SIZE, TICK_DT } from "../shared/coords.ts";
import { Body } from "../shared/sim/character.ts";
import { stepVehicleBody } from "../shared/sim/vehicle-body.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "../shared/sim/vehicle-rigid.ts";
import { TreeFracture } from "../shared/sim/vehicle-tree.ts";
import { isWheelVehicle, type VehicleContact, type VehicleSpec, type VehicleState } from "../shared/sim/vehicle.ts";
import { StaticVehicleWorld } from "../shared/world/vehicle.ts";
import { VehicleNodeCache } from "./vehicle-node-cache.ts";
import type { Harvest } from "./harvest.ts";
import type { ServerWorld } from "./world.ts";

/** As a trunk's fracture: the slowest closing speed that fells, the share of a payload a chassis puts into a post, and the
 * share of the speed left that the crumpled front keeps. */
const TOPPLE_CLOSING = 3, TOPPLE_PAYLOAD = .5, TOPPLE_DEFORMATION = .12;

export class VehicleTrees extends StaticVehicleWorld {
  private readonly fracture: TreeFracture;
  private readonly authority: ServerWorld;
  private readonly harvest: Harvest;
  private readonly sleeping = new Body();
  private readonly nodes: VehicleNodeCache;
  /** A street piece a car can knock down, by its kind: the kind it falls as and the work its foot takes. */
  private readonly topples = new Map<number, { into: number; work: number }>();
  private readonly point = new Float64Array(3);
  constructor(authority: ServerWorld, harvest: Harvest) {
    super(authority); this.authority = authority; this.harvest = harvest; this.fracture = new TreeFracture(authority.reg, harvest.field.forms);
    this.nodes = new VehicleNodeCache(harvest.field.source);
    for (const [from, t] of Object.entries(STREET_TOPPLES)) {
      const a = authority.reg.index.get(from), b = authority.reg.index.get(t.into);
      if (a !== undefined && b !== undefined) this.topples.set(a, { into: b, work: t.work });
    }
  }

  /** Cold nodes are retained only for the swept neighbourhood of this wheel step, then released symmetrically. */
  readonly step: typeof stepVehicleBody = (world, body, moveX, moveZ, buttons, definition, dt = TICK_DT, yaw = body.yaw, pilot = true) => {
    if (!isWheelVehicle(definition)) { stepVehicleBody(world, body, moveX, moveZ, buttons, definition, dt, yaw, pilot); return; }
    // A sleeping chassis' support heartbeat tests terrain/structures, without filling cold forest chunks.
    const still = !pilot && moveX === 0 && moveZ === 0 && body.grounded && body.vx === 0 && body.vz === 0 &&
      Math.abs(body.vy) < .001 && Math.abs(body.vehicleYawRate) < .001 && Math.abs(body.vehiclePitchRate) < .001 &&
      Math.abs(body.vehicleRollRate) < .001 && Math.abs(body.vehicleRideVelocity) < .001;
    if (still) {
      this.sleeping.copy(body); stepVehicleBody(world, body, moveX, moveZ, buttons, definition, dt, yaw, pilot);
      if (body.grounded && body.x === this.sleeping.x && body.y === this.sleeping.y && body.z === this.sleeping.z) return;
      // A removed support or a car perched on cold wood may wake. Re-run that heartbeat with the native node view.
      body.copy(this.sleeping);
    }
    this.nodes.begin(this.authority.tick, this.authority.hf.changes.length);
    const dims = this.authority.dims, reach = Math.hypot(definition.spec.halfWidth, definition.spec.halfLength, definition.spec.height) + this.fracture.reach + 1;
    const endX = body.x + body.vx * dt, endZ = body.z + body.vz * dt;
    const minX = Math.max(0, Math.floor((Math.min(body.x, endX) - reach) / CHUNK_SIZE));
    const maxX = Math.min(dims.chunksX - 1, Math.floor((Math.max(body.x, endX) + reach) / CHUNK_SIZE));
    const minZ = Math.max(0, Math.floor((Math.min(body.z, endZ) - reach) / CHUNK_SIZE));
    const maxZ = Math.min(dims.chunksZ - 1, Math.floor((Math.max(body.z, endZ) + reach) / CHUNK_SIZE));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) this.harvest.retain(z * dims.chunksX + x, 0, 1, this.nodes);
    try { stepVehicleBody(world, body, moveX, moveZ, buttons, definition, dt, yaw, pilot, this); }
    finally { for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) this.harvest.retain(z * dims.chunksX + x, 0, -1); }
  };

  breakContact(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null {
    if (hit.reason.startsWith("structure:")) return this.topple(state, spec, hit);
    if (!hit.reason.startsWith("node:") || hit.x === undefined || hit.y === undefined || hit.z === undefined) return null;
    const ref = Number(hit.reason.slice(5)), chunk = Math.floor(ref / 65536), index = ref & 65535;
    const field = this.harvest.field, row = field.store.chunks[chunk], form = row?.kind[index] ?? 0;
    if (this.harvest.crushed(chunk, index)) return null;
    const impulse = this.fracture.impulse(state, spec, hit, form);
    if (!Number.isFinite(impulse) || !this.harvest.breakTree(chunk, index)) return null;
    return this.fracture.apply(state, spec, hit, form, impulse);
  }

  /** A lamp or a pole hit hard enough falls: its foot's work out of the impact as a trunk's, then its fallen kind in its place. */
  private topple(state: VehicleState, spec: VehicleSpec, hit: VehicleContact): number | null {
    if (hit.x === undefined || hit.y === undefined || hit.z === undefined) return null;
    const ref = Number(hit.reason.slice(10)), structs = this.authority.structs;
    const t = this.topples.get(structs.chunks[Math.floor(ref / 65536)]?.kind[ref & 65535] ?? 0);
    if (!t) return null;
    vehiclePointVelocity(state, spec, hit.x, hit.y, hit.z, this.point);
    const closing = -(this.point[0]! * hit.nx + this.point[1]! * hit.ny + this.point[2]! * hit.nz);
    if (!(closing >= TOPPLE_CLOSING)) return null;
    const inverseMass = vehiclePointInverseMass(state, spec, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
    const mass = vehicleMassProperties(spec, state).mass, curb = mass - Math.max(0, state.payloadMass);
    const usable = curb + Math.min(Math.max(0, state.payloadMass), curb * TOPPLE_PAYLOAD);
    const fraction = t.work / (.5 * closing * closing / (inverseMass * mass / usable));
    if (!(fraction <= 1) || !structs.swap(ref, t.into)) return null;
    const after = closing * Math.sqrt(Math.max(0, (1 - fraction) * (1 - TOPPLE_DEFORMATION)));
    const impulse = (closing - after) / inverseMass;
    applyVehicleImpulse(state, spec, hit.x, hit.y, hit.z, hit.nx * impulse, hit.ny * impulse, hit.nz * impulse);
    return Math.sqrt(Math.max(0, closing * closing - after * after));
  }
}
