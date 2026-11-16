// Original four-seat utility launch; the handling values are authored for SNARK.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { BOAT_ART as ART } from "./boat-art.ts";
import { BOAT } from "./boat-spec.ts";
export { BOAT } from "./boat-spec.ts";

export const BOAT_VEHICLE: BoatVehicleDefinition = {
  id: "core:boat", movement: "boat", spec: BOAT, wreck: "core:boat_wreck",
  seats: [
    { id: "pilot", driver: true, anchor: ART.anchors.seat_driver, entry: ART.anchors.boarding_water, pose: "pilot", weapons: false,
      controls: { left: ART.anchors.helm_left, right: ART.anchors.helm_right, style: "helm",
        turn: { pivot: ART.helm.center, axis: ART.helm.axis, ratio: ART.helm.turn / BOAT.maxSteer } } },
    { id: "front", anchor: ART.anchors.seat_front_passenger, entry: ART.anchors.boarding_water, pose: "cabin", weapons: false },
    { id: "rear_left", anchor: ART.anchors.seat_rear_left, entry: ART.anchors.boarding_water, pose: "cabin", weapons: false },
    { id: "rear_right", anchor: ART.anchors.seat_rear_right, entry: ART.anchors.boarding_water, pose: "cabin", weapons: false },
  ],
  doors: [], wheels: [],
  steeringWheel: { bone: "steering", axis: ART.helm.axis, ratio: ART.helm.turn / BOAT.maxSteer },
  outboard: { bone: "outboard", axis: [0, 1, 0], ratio: 1 },
  propeller: { bone: "propeller", axis: ART.propeller.axis, ratio: 1 },
  actionTicks: 24, beltline: ART.gunwale.height,
};

export const BOAT_SPECIES: SpeciesDef = {
  type: "species", class: "vehicle", id: "core:boat", aliases: ["boat", "motorboat", "launch"],
  mesh: "core:boat", skeleton: "core:boat", color: 9,
  radius: BOAT.halfWidth, height: BOAT.height, eyeHeight: ART.anchors.camera_driver[1],
  walkSpeed: .01, sprintMul: 1, jumpSpeed: .01, still: true,
  mass: BOAT.mass, slots: 32, keeps: 1, fists: 0,
  stats: { health: [1200, 0, 0], stamina: [100, 0, 0], weight: [650, 0, 0] },
  corpse: { health: 500, roll: 40 },
  drops: [{ item: "core:ingot", min: 2, max: 4, weight: 4, favoured: "stone" }, { item: "core:polymer", min: 1, max: 2, weight: 1 }],
  regions: [
    { name: "Paint", colors: [[232, 1], [103, 1], [124, 1]] },
    { name: "Stripe", colors: [[86, 1]] }, { name: "Upholstery", colors: [[101, 1]] }, null, null, null,
  ],
  vehicle: BOAT_VEHICLE,
};
export const BOAT_RESCUE: SpeciesDef = {
  ...BOAT_SPECIES, id: "core:boat_rescue", aliases: ["rescue_boat"], mesh: "core:boat_rescue",
  regions: [{ name: "Paint", colors: [[232, 1]] }, { name: "Stripe", colors: [[46, 1]] }, { name: "Upholstery", colors: [[101, 1]] }, null, null, null],
  vehicle: { ...BOAT_VEHICLE, id: "core:boat_rescue" },
};
export const BOAT_POLICE: SpeciesDef = {
  ...BOAT_SPECIES, id: "core:boat_police", aliases: ["police_boat"], mesh: "core:boat_police",
  regions: [{ name: "Paint", colors: [[83, 1]] }, { name: "Stripe", colors: [[232, 1]] }, { name: "Upholstery", colors: [[101, 1]] }, null, null, null],
  vehicle: { ...BOAT_VEHICLE, id: "core:boat_police" },
};
export const BOATS = [BOAT_SPECIES, BOAT_RESCUE, BOAT_POLICE] as const;
