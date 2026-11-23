import type { Def } from "../../shared/content/defs.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";

// These ids sort after the shipped city kinds, whose numeric indices are in existing maps.
export const BOARD_ID = "core:zzzzzskateboard";
export const BOARD_KIT = "core:zzzzzskateboard_assembly";
export const BOARD: WheelVehicleDefinition = {
  id: BOARD_ID, frame: "skateboard",
  spec: {
    halfWidth: .104, halfLength: .405, height: .139, clearance: .055, mass: 2.4,
    wheelbase: .356, track: .18, wheelRadius: .0265, acceleration: 3.9, brake: 7.5,
    maxForward: 9, maxReverse: 0, maxSteer: .48, steerRate: 2.4,
    maxRise: .18, maxDrop: .2, minGroundNormal: .72, fuelCapacity: 0, fuelPerSecond: 0,
  },
  seats: [{ id: "rider", driver: true, pose: "skate", anchor: [0, .935, 0], entry: [.64, 0, 0], weapons: false }],
  wheels: [], doors: [], actionTicks: 5, beltline: .13,
};
export const SKATEBOARDS: readonly Def[] = [
  { type: "species", class: "vehicle", id: BOARD_ID, aliases: ["skateboard"],
    mesh: "core:skateboard", skeleton: "core:skateboard", color: 90, radius: BOARD.spec.halfWidth, height: BOARD.spec.height,
    eyeHeight: .13, walkSpeed: .01, sprintMul: 1, jumpSpeed: .01, still: true, mass: 2.4, slots: 1, keeps: 1, fists: 0,
    stats: { health: [120, 0, 0], stamina: [100, 0, 0], weight: [100, 0, 0] }, vehicle: BOARD },
  { type: "item", class: "vehicle", id: BOARD_KIT, aliases: ["skateboard_assembly", "skate_kit"], label: "Street skateboard",
    stack: 1, weight: 2.4, color: 90, blueprint: false, deploys: BOARD_ID,
    craft: { needs: [{ item: "core:wood", count: 8 }, { item: "core:fiber", count: 6 }, { item: "core:stone", count: 4 }], seconds: 5, xp: 4 } },
  { type: "engram", id: "core:zzzzzskateboard_engram", label: "Street skateboard", level: 2, cost: 0, item: BOARD_KIT },
];
