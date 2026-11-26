// The XF-51 Wraith: an original fighter with a lift fan and a swivel nozzle, one to a world, parked in a hangar
// (planning/workstreams/jet.md). Its handling, guns and missiles are the game's choices, not any real aircraft's. Its
// measures are its art's (jet-art.ts).
import type { Def, SpeciesDef } from "../../shared/content/defs.ts";
import type { JetSpec, JetVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { JET_ART as ART } from "./jet-art.ts";

export const JET: JetSpec = {
  halfWidth: ART.halfWidth, halfLength: ART.halfLength, height: ART.top, clearance: .8,
  mass: 16000, fuelCapacity: 400, fuelPerSecond: .3,
  maxForward: 160, maxReverse: 2,
  cruiseSpeed: 120, topSpeed: 160, thrust: 7.5,
  stallSpeed: 46, criticalAngle: .35, incidence: .05, inducedDrag: .15, gLimit: 9,
  pitchRate: 1.6, rollRate: 4, yawRate: .35, turnAcceleration: 9, aimResponse: 3.5,
  vtolSpeed: 40, vtolFade: 16, vtolLift: 14, climbSpeed: 8, descendSpeed: 5,
  spoolUp: .7, spoolDown: .9, gravity: 9.81,
  noseGear: ART.noseGear, mainGear: ART.mainGear, gearTrack: ART.gearTrack, rotateSpeed: 50, brake: 6, minGroundNormal: .94,
  bodyBoxes: ART.bodyBoxes,
};

export const JET_VEHICLE: JetVehicleDefinition = {
  id: "core:jet", movement: "jet", spec: JET, wreck: "core:jet_wreck",
  seats: [
    { id: "pilot", driver: true, anchor: ART.seat, entry: ART.entry, pose: "pilot", weapons: false, controls: { left: ART.throttle, right: ART.stick } },
  ],
  doors: [],
  wheels: [],
  actionTicks: 30, beltline: 2.3,
  weapons: {
    cannon: { weapon: "core:jet_cannon", ammo: "core:cannon_round", rounds: 220, interval: .1, muzzle: ART.muzzle, spread: .003 },
    missiles: {
      weapon: "core:jet_missile_rack", ammo: "core:jet_missile", prop: "core:jet_missile_live", count: 6, reload: 1.5,
      lock: 1.5, cone: .26, range: 1800, speed: 240, navigation: 3, turn: 300, life: 8, fuse: 6, rail: ART.rail,
    },
  },
};

export const JET_SPECIES: SpeciesDef = {
  type: "species", class: "vehicle", id: "core:jet", aliases: ["jet", "aircraft", "xf51", "wraith", "fighter"],
  mesh: "core:jet", skeleton: "core:jet", color: 4,
  radius: JET.halfWidth, height: JET.height, eyeHeight: ART.camera[1],
  walkSpeed: .01, sprintMul: 1, jumpSpeed: .01, still: true,
  mass: JET.mass, slots: 8, keeps: 1, fists: 0,
  stats: { health: [2400, 0, 0], stamina: [100, 0, 0], weight: [200, 0, 0] },
  corpse: { health: 900, roll: 40 },
  drops: [{ item: "core:ingot", min: 6, max: 12, weight: 4, favoured: "stone" }, { item: "core:polymer", min: 2, max: 4, weight: 2 }, { item: "core:electronics", min: 2, max: 6, weight: 2 }],
  regions: [
    { name: "Paint", colors: [[86, 1]] },
    { name: "Panel lines", colors: [[83, 1]] },
    null, null, null, null,
  ],
  vehicle: JET_VEHICLE,
};

/**
 * What the jet fires. The weapons are fitted, never carried: no recipe, engram or loot names them. The cannon's round is
 * a 25 mm shell, hitscan as a rifle's is; the missile looks, flies and goes off as the launcher's rocket does, with a
 * larger blast.
 */
export const JET_ARMS: readonly Def[] = [
  { type: "item", class: "weapon", id: "core:jet_cannon", label: "XF-51 cannon", stack: 1, weight: 0, color: 11, weapon: { kind: "gun", ammo: ["core:cannon_round"], power: 1, clip: 220, interval: .1, uses: 1, mesh: "core:blockout", hold: "rifle" } },
  { type: "item", class: "ammo", id: "core:cannon_round", label: "25 mm cannon round", stack: 220, weight: .1, color: 6, ammo: { damage: 60, type: "bullet" } },
  { type: "item", class: "weapon", id: "core:jet_missile_rack", label: "XF-51 missile", stack: 1, weight: 0, color: 11, weapon: { kind: "gun", ammo: ["core:jet_missile"], power: 1, clip: 6, reload: 1.5, structures: 7350 / 250, uses: 1, mesh: "core:blockout", hold: "rifle" } },
  { type: "item", class: "ammo", id: "core:jet_missile", label: "guided missile", stack: 6, weight: 85, color: 7, ammo: { damage: 2400, type: "explosive", speed: 240, blast: 10, mesh: "core:rocket_round", motor: { flame: 1.6 }, burst: "rocket" } },
  // The missile in flight, a prop every client draws along its way as the rocket's round.
  { type: "prop", class: "projectile", id: "core:jet_missile_live", mesh: "core:rocket_round", color: 10, radius: .3, height: .6, pitched: true },
];
export const JETS = [JET_SPECIES] as const;
