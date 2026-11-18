// Energy-based tree fracture shared by authority and the local driver's collision prediction.
import type { Registry } from "../content/registry.ts";
import { len3 } from "../math/scalar.ts";
import type { NodeForms } from "../world/nodes.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "./vehicle-rigid.ts";
import type { VehicleContact, VehicleSpec, VehicleState } from "./vehicle.ts";

/** Reversible gameplay tuning: half-metre young trunk work, a 50%-curb usable load, and 12% post-fracture deformation. */
const TRUNK_WORK = 75000, MIN_CLOSING = 3, USABLE_PAYLOAD = .5, DEFORMATION = .12;

export class TreeFracture {
  readonly work: Float64Array;
  readonly reach: number;
  private readonly point = new Float64Array(3);
  constructor(reg: Registry, forms: NodeForms) {
    const parts = forms.parts;
    this.work = new Float64Array(forms.count);
    let reach = 0;
    for (let form = 1; form < forms.count; form++) {
      reach = Math.max(reach, len3(forms.halfX[form]!, 0, forms.halfZ[form]!));
      const def = reg.defs[forms.kind[form]!];
      if (def?.type !== "node" || def.material !== "wood") continue;
      let height = 0, area = 0;
      const start = parts.start[form]! * 6, end = parts.start[form + 1]! * 6, box = parts.box;
      for (let i = start; i < end; i += 6) height = Math.max(height, box[i + 1]! + box[i + 4]!);
      const section = Math.min(.6, height * .25);
      // The entire basal section resists felling: multiple banyan trunks do not become a single thin branch.
      for (let i = start; i < end; i += 6) if (box[i + 1]! - box[i + 4]! <= section && box[i + 1]! + box[i + 4]! >= section) area += 4 * box[i + 3]! * box[i + 5]!;
      if (!(area > 0)) continue;
      const relativeDiameter = Math.sqrt(area) / .5, heightScale = Math.max(.1, Math.min(2, Math.sqrt(height / 4)));
      this.work[form] = Math.max(3500, TRUNK_WORK * relativeDiameter * relativeDiameter * relativeDiameter * heightScale * Math.min(1, height / .6));
    }
    this.reach = reach;
  }

  /** Required point impulse, or NaN when this contact cannot finish fracture. Does not mutate either body or node. */
  impulse(state: VehicleState, spec: VehicleSpec, hit: VehicleContact, form: number): number {
    const work = this.work[form] ?? 0;
    if (!(work > 0) || hit.x === undefined || hit.y === undefined || hit.z === undefined) return NaN;
    vehiclePointVelocity(state, spec, hit.x, hit.y, hit.z, this.point);
    const closing = -(this.point[0]! * hit.nx + this.point[1]! * hit.ny + this.point[2]! * hit.nz);
    if (!(closing >= MIN_CLOSING)) return NaN;
    const inverseMass = vehiclePointInverseMass(state, spec, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
    const mass = vehicleMassProperties(spec, state).mass;
    // The chassis can transmit only a plausible load into a trunk. Excess inventory does not become a logging weight;
    // the actual point impulse still uses the body's real mass/inertia and dissipates the excess in the chassis.
    const curb = mass - Math.max(0, state.payloadMass), usable = curb + Math.min(Math.max(0, state.payloadMass), curb * USABLE_PAYLOAD);
    const usableInverse = inverseMass * mass / usable, energy = .5 * closing * closing / usableInverse;
    const fraction = work / energy;
    hit.restitution = .12 * Math.max(0, 1 - 1 / fraction) * Math.max(0, 1 - 1 / fraction);
    if (fraction > 1) return NaN;
    // No reserved-speed cliff: both a nearly failed and a just-completed fracture approach zero normal speed.
    const after = closing * Math.sqrt(Math.max(0, (1 - fraction) * (1 - DEFORMATION)));
    return (closing - after) / inverseMass;
  }

  /** Applies the measured resistance only after the caller has consumed its node; returns absorbed equivalent speed. */
  apply(state: VehicleState, spec: VehicleSpec, hit: VehicleContact, _form: number, impulse: number): number {
    vehiclePointVelocity(state, spec, hit.x!, hit.y!, hit.z!, this.point);
    const closing = -(this.point[0]! * hit.nx + this.point[1]! * hit.ny + this.point[2]! * hit.nz);
    const inverseMass = vehiclePointInverseMass(state, spec, hit.x!, hit.y!, hit.z!, hit.nx, hit.ny, hit.nz);
    const change = impulse * inverseMass;
    applyVehicleImpulse(state, spec, hit.x!, hit.y!, hit.z!, hit.nx * impulse, hit.ny * impulse, hit.nz * impulse);
    return Math.sqrt(Math.max(0, change * (2 * closing - change)));
  }
}
