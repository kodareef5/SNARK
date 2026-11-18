import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { BoatDrive, BoatDriveRig, BoatSpec, BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { BOAT_SPECIES } from "./boat.ts";
import { SMALL_CRAFT } from "./small-craft.ts";
import { MOTOR_YACHTS } from "./motor-yachts.ts";
import { POWER_CATS } from "./power-cats.ts";
import type { MarineModel, MarinePoint } from "./marine-model.ts";

export const MARINE_MODELS: readonly MarineModel[] = [...SMALL_CRAFT, ...MOTOR_YACHTS, ...POWER_CATS];

interface Outfit {
  mass: number; speed: number; acceleration: number; wheel: number; fuel: number;
  slots: number; payload: number; hp: number; aliases: string[];
}
const outfits: Record<string, Outfit> = {
  "core:needle": { mass: 2400, speed: 49, acceleration: 7.7, wheel: .38, fuel: 280, slots: 8, payload: 320, hp: 960, aliases: ["speedboat", "cigarette", "offshore_racer"] },
  "core:thunderbolt": { mass: 5100, speed: 43, acceleration: 6.5, wheel: .4, fuel: 490, slots: 24, payload: 750, hp: 1450, aliases: ["cigar_boat", "offshore_speedboat"] },
  "core:jon_boat": { mass: 195, speed: 11, acceleration: 4.8, wheel: .65, fuel: 25, slots: 16, payload: 290, hp: 540, aliases: ["jonboat", "reviewer_boat", "skiff"] },
  "core:riptide": { mass: 390, speed: 29, acceleration: 9.8, wheel: .65, fuel: 58, slots: 5, payload: 230, hp: 620, aliases: ["jetski", "jet_ski", "pwc"] },
  "core:solstice": { mass: 6800, speed: 21, acceleration: 3.1, wheel: .53, fuel: 400, slots: 32, payload: 1200, hp: 1850, aliases: ["day_yacht", "dayboat"] },
  "core:meridian": { mass: 17500, speed: 19, acceleration: 2.2, wheel: .5, fuel: 720, slots: 48, payload: 2100, hp: 2600, aliases: ["sport_yacht", "coupe_yacht"] },
  "core:belvedere": { mass: 46500, speed: 15, acceleration: 1.45, wheel: .48, fuel: 1250, slots: 64, payload: 4200, hp: 3650, aliases: ["flybridge_yacht", "motor_yacht"] },
  "core:sovereign": { mass: 126000, speed: 12, acceleration: .95, wheel: .46, fuel: 2200, slots: 80, payload: 8000, hp: 5000, aliases: ["superyacht", "flagship_yacht"] },
  "core:manta": { mass: 4600, speed: 28, acceleration: 4.9, wheel: .54, fuel: 330, slots: 24, payload: 850, hp: 1700, aliases: ["catamaran", "sport_powerboat"] },
  "core:lagoon": { mass: 28800, speed: 15, acceleration: 1.7, wheel: .48, fuel: 920, slots: 56, payload: 3200, hp: 3000, aliases: ["powercat", "catamaran_yacht"] },
};

function driveAt(at: MarinePoint, pivot: MarinePoint | undefined, radius: number, intake?: MarinePoint): BoatDrive {
  const propeller = { at, radius, ...(intake ? { enclosed: true, intake } : {}) };
  if (!pivot) return { propeller };
  return { propeller, outboard: { pivot, boxes: [
    { at: [at[0], (at[1] + pivot[1]) / 2, (at[2] + pivot[2]) / 2], half: [radius * .65, Math.max(.07, Math.abs(pivot[1] - at[1]) / 2), Math.max(.08, Math.abs(pivot[2] - at[2]) / 2)] },
  ] } };
}
function movingDrive(suffix: string, pivot: MarinePoint | undefined, jet: boolean): BoatDriveRig {
  return {
    ...(!jet ? { propeller: { bone: "propeller" + suffix, axis: [0, 0, 1] as const, ratio: suffix ? -1 : 1 } } : {}),
    ...(pivot ? { outboard: { bone: "outboard" + suffix, axis: [0, 1, 0] as const, ratio: -1 } } : {}),
  };
}

function vessel(model: MarineModel): SpeciesDef {
  const trim = model.trim ?? (model.family === "yacht" ? [84, 101] as const : undefined);
  const cat = model.family === "catamaran";
  const o = outfits[model.id]!, yacht = model.family === "yacht", jet = model.family === "pwc";
  const big = model.length >= 14, planing = big ? .12 : yacht ? .32 : model.family === "jon" ? .28 : .48;
  const thrust = o.mass * o.acceleration;
  const halfWidth = model.beam / 2, halfLength = model.length / 2;
  const buoyancyHeight = Math.min(model.height, Math.max(.45, model.draft * 2.3));
  const displacement = Math.max(o.mass * 2.5, o.mass + o.payload + model.seats.length * 100 + o.mass * .2);
  // Float centres place the lightship on its authored waterline. Three sections distribute lift down each side.
  const floatY = model.draft + buoyancyHeight * (.5 - o.mass / displacement);
  const buoyancyPoints = [-.66, -.06, .54].flatMap(z => [-1, 1].map(side => ({
    at: [side * (model.sponsonX ?? halfWidth * .72), floatY, z * halfLength] as MarinePoint, weight: 1 / 6,
  })));
  const radius = Math.min(.85, Math.max(.09, model.draft * .46));
  // Resistance at the design speed reflects the wetted area left on plane with one pilot aboard.
  const wetted = Math.min(1, (o.mass * (1 - planing) + 80) / (displacement * .35));
  const drag = ((thrust - (o.mass + 80) * .015 * o.speed) / wetted - 90 * o.speed) / (o.speed ** 2 * .68);
  const spec: BoatSpec = {
    halfWidth, halfLength, height: model.height, clearance: 0, mass: o.mass, displacement, draft: model.draft,
    buoyancyHeight, buoyancyPoints, buoyancyDamping: big ? 5.8 : 4.7, centerOfMass: [0, floatY - .1, -.06 * halfLength], hullBoxes: model.boxes,
    ...driveAt(model.propeller, model.outboard, radius, model.jetIntake),
    ...(model.secondPropeller ? { secondDrive: driveAt(model.secondPropeller, model.secondOutboard, radius) } : {}),
    thrust, reverseThrust: thrust * .36, idleRpm: big ? 650 : 900, maxRpm: big ? 3100 : jet ? 8200 : 6400,
    rpmRate: big ? 1100 : jet ? 6000 : 3700, shiftDelay: big ? .48 : .22, maxSteer: o.wheel, steerRate: big ? .65 : jet ? 2.8 : 1.65,
    maxForward: o.speed, maxReverse: big ? 3.2 : 4, planingSpeed: o.speed * .36, planingLift: planing, planingTrim: big ? .035 : .07,
    ...(jet ? { planingBankArm: .14 } : {}),
    forwardDrag: Math.max(1, drag), sideDrag: o.mass * (jet ? 1.35 : .87), angularDrag: big ? 3.1 : 2.8, gravity: 18,
    fuelCapacity: o.fuel, fuelPerSecond: o.fuel / (big ? 4000 : jet ? 1550 : 2450),
  };
  const helmAxis = model.helmAxis ?? (jet ? [0, 1, 0] : [0, 0, 1]), ratio = jet ? -1 : .69 / spec.maxSteer;
  const [hx, hy, hz] = model.helm;
  const vehicle: BoatVehicleDefinition = {
    id: model.id, movement: "boat", family: model.family, spec, boarding: model.boarding, wreck: model.id,
    seats: model.seats.map((anchor, i) => ({
      id: i ? "passenger_" + i : "pilot", anchor, entry: model.boarding.water, weapons: false,
      ...(i ? { pose: jet ? "pwc" as const : "cabin" as const } : { driver: true, pose: jet ? "pwc" as const : "pilot" as const, controls: {
        style: jet ? "handlebar" : "helm", left: [hx + model.grip, hy, hz], right: [hx - model.grip, hy, hz], turn: { pivot: model.helm, axis: helmAxis, ratio },
      } }),
    })),
    doors: [], wheels: [], steeringWheel: { bone: "steering", axis: helmAxis, ratio },
    ...movingDrive("", model.outboard, jet),
    ...(model.secondPropeller ? { secondDrive: movingDrive("_starboard", model.secondOutboard, false) } : {}),
    actionTicks: jet ? 13 : big ? 29 : 20, beltline: model.beltline,
  };
  return {
    ...BOAT_SPECIES, id: model.id, skeleton: model.id, mesh: model.id, aliases: o.aliases, vehicle,
    radius: halfWidth, height: model.height, eyeHeight: Math.min(model.height, model.camera[1]), color: model.paint, mass: o.mass, slots: o.slots,
    stats: { health: [o.hp, 0, 0], stamina: [o.fuel, 0, 0], weight: [o.payload, 0, 0] },
    corpse: { health: Math.round(o.hp * .42), roll: 40 },
    regions: [
      { name: cat ? "Hull" : "Paint", colors: [[model.paint, 1]] },
      trim ? { name: cat ? "Boot stripe" : "Stripe", colors: [[trim[0], 1]] } : null,
      trim ? { name: "Upholstery", colors: [[trim[1], 1]] } : null, null, null, null,
    ],
  };
}
export const MARINE_FLEET = MARINE_MODELS.map(vessel);
