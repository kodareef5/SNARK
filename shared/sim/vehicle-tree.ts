// Energy-based tree fracture shared by authority and the local driver's collision prediction.
import type { Registry } from "../content/registry.ts";
import { len3 } from "../math/scalar.ts";
import type { NodeForms } from "../world/nodes.ts";
import { applyVehicleImpulse, vehicleMassProperties, vehiclePointInverseMass, vehiclePointVelocity } from "./vehicle-rigid.ts";
import type { VehicleContact, VehicleSpec, VehicleState } from "./vehicle.ts";

/** Design tuning in joules for a half-metre young trunk, before authored size/height/health. */
const TRUNK_WORK = 75000, MIN_CLOSING = 3;

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
      if (def?.type !== "node" || def.material !== "wood" || forms.depleted[form]) continue;
      let height = 0, area = 0;
      const start = parts.start[form]! * 6, end = parts.start[form + 1]! * 6, box = parts.box;
      for (let i = start; i < end; i += 6) height = Math.max(height, box[i + 1]! + box[i + 4]!);
      const section = Math.min(.6, height * .25);
      // The entire basal section resists felling: multiple banyan trunks do not become a single thin branch.
      for (let i = start; i < end; i += 6) if (box[i + 1]! - box[i + 4]! <= section && box[i + 1]! + box[i + 4]! >= section) area += 4 * box[i + 3]! * box[i + 5]!;
      if (!(area > 0)) continue;
      const relativeDiameter = Math.sqrt(area) / .5, heightScale = Math.max(.7, Math.min(2, Math.sqrt(height / 4)));
      this.work[form] = Math.max(3500, TRUNK_WORK * relativeDiameter * relativeDiameter * relativeDiameter * heightScale * reg.nodeHits[forms.kind[form]!]! / def.hits);
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
    const energy = .5 * closing * closing / inverseMass;
    if (!(work <= energy * .8)) return NaN;
    const after = Math.sqrt(Math.max(0, closing * closing - 2 * work * inverseMass));
    return (closing - after) / inverseMass;
  }

  /** Applies the measured resistance only after the caller has consumed its node; returns absorbed equivalent speed. */
  apply(state: VehicleState, spec: VehicleSpec, hit: VehicleContact, form: number, impulse: number): number {
    applyVehicleImpulse(state, spec, hit.x!, hit.y!, hit.z!, hit.nx * impulse, hit.ny * impulse, hit.nz * impulse);
    return Math.sqrt(2 * this.work[form]! / vehicleMassProperties(spec, state).mass);
  }
}
