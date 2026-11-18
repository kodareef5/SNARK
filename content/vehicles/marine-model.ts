import type { BoatSpec } from "../../shared/sim/vehicle.ts";

export type MarinePoint = readonly [number, number, number];

/** Physical measurements shared by the shipyard's art and its playable boat. Keel origin, +X port, +Z bow. */
export interface MarineModel {
  readonly id: string; // Namespaced species and mesh ID.
  readonly label: string;
  readonly family: "offshore" | "jon" | "pwc" | "yacht" | "catamaran";
  readonly length: number; // Overall closed length, centred about Z=0.
  readonly beam: number;
  readonly height: number;
  readonly draft: number; // Waterline above the keel at rest.
  readonly beltline: number;
  readonly seats: readonly MarinePoint[]; // Pelvis anchors. Pilot first, then passengers.
  readonly helm: MarinePoint; // Pivot of the steering bone.
  readonly helmAxis?: MarinePoint; // Defaults to +Z for wheels, +Y for bars.
  readonly grip: number; // Half the width between hand grips.
  readonly camera: MarinePoint; // Eyes of seated pilot.
  readonly propeller: MarinePoint; // Effective thrust centre; in the water at rest.
  readonly outboard?: MarinePoint; // Pivot of the optional steering drive/nozzle bone.
  readonly jetIntake?: MarinePoint; // Fixed underwater intake feeding a steerable jet nozzle.
  readonly secondPropeller?: MarinePoint;
  readonly secondOutboard?: MarinePoint;
  readonly boarding: { readonly water: MarinePoint; readonly ladder: MarinePoint; readonly deck: MarinePoint };
  readonly boxes: BoatSpec["hullBoxes"];
  readonly sponsonX?: number; // Positive X of the catamaran's port hull centre.
  readonly paint: number;
  readonly trim?: readonly [stripe: number, upholstery: number];
}
