import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { BoatDrive, BoatDriveRig, BoatSpec, BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { BOAT_SPECIES } from "./boat.ts";
import { SMALL_CRAFT } from "./small-craft.ts";
import { MOTOR_YACHTS } from "./motor-yachts.ts";
import { POWER_CATS } from "./power-cats.ts";
import type { MarineModel, MarinePoint } from "./marine-model.ts";

export const MARINE_MODELS: readonly MarineModel[] = [...SMALL_CRAFT, ...MOTOR_YACHTS, ...POWER_CATS];

/**
 * Each vessel's own handling and kit. Speeds in m/s, angles in radians, times in seconds. `speed` is flat out with one
 * pilot aboard; the hull's resistance is solved from it. `push` is full thrust over the light ship's mass. `lock` is the
 * drive's or nozzle's angle at full helm and `helm` how fast it gets there. `grip` is side drag per kilogram, what holds
 * a hull to its line; `steady` damps every rotation; `bank` is the lean into a turn on plane, in metres of lever.
 * Planing starts at `plane` of top speed and carries `lift` of the weight. `spool` is engine rpm gained a second and
 * `shift` the pause in neutral between ahead and astern. The centre of mass is `low` metres under the float centres. A tank of `fuel` lasts `minutes` at full throttle.
 */
interface Outfit {
  mass: number; speed: number; astern: number; push: number; lock: number; helm: number;
  grip: number; steady: number; bank: number; plane: number; lift: number; spool: number; shift: number; low: number;
  fuel: number; minutes: number; slots: number; payload: number; hp: number; aliases: string[];
}
const outfits: Record<string, Outfit> = {
  // Fastest on the water and thirsty; full helm flat out heels it over and stalls the engine as it goes.
  "core:needle": { mass: 2400, speed: 50, astern: 4, push: 9.5, lock: .38, helm: 1, grip: .6, steady: 2.2, bank: .9, plane: .36, lift: .48, spool: 3700, shift: .22, low: .1, fuel: 280, minutes: 16, slots: 8, payload: 320, hp: 960, aliases: ["speedboat", "cigarette", "offshore_racer"] },
  // Heavier and twin engined: as hard to turn flat out, but wider and it stays upright.
  "core:thunderbolt": { mass: 5100, speed: 45, astern: 4, push: 8.2, lock: .42, helm: 1, grip: .6, steady: 2.2, bank: 1, plane: .36, lift: .48, spool: 3700, shift: .22, low: .1, fuel: 490, minutes: 19, slots: 24, payload: 750, hp: 1450, aliases: ["cigar_boat", "offshore_speedboat"] },
  // A flat bottom with a tiller outboard: slow to climb on plane and it slides through a turn.
  "core:jon_boat": { mass: 195, speed: 11, astern: 4, push: 5.5, lock: .35, helm: 1.8, grip: .5, steady: 4, bank: .55, plane: .62, lift: .4, spool: 3700, shift: .22, low: .1, fuel: 25, minutes: 55, slots: 16, payload: 290, hp: 540, aliases: ["jonboat", "reviewer_boat", "skiff"] },
  // Off the line before anything else, leans hard into a carve and spins on the spot; no throttle, no steering.
  "core:riptide": { mass: 390, speed: 29, astern: 4, push: 20, lock: .5, helm: 3.2, grip: 2, steady: 4.5, bank: .4, plane: .36, lift: .48, spool: 9000, shift: .15, low: .15, fuel: 58, minutes: 22, slots: 5, payload: 230, hp: 620, aliases: ["jetski", "jet_ski", "pwc"] },
  // The yachts gather way slowly, carry it a long way and turn wider the bigger they are, at full helm still coming round
  // in a basin: their drives turn far over and their hulls let the stern swing.
  "core:solstice": { mass: 6800, speed: 21, astern: 4, push: 2.6, lock: .8, helm: 1.4, grip: .8, steady: 2.2, bank: .55, plane: .36, lift: .32, spool: 3000, shift: .3, low: .1, fuel: 400, minutes: 45, slots: 32, payload: 1200, hp: 1850, aliases: ["day_yacht", "dayboat"] },
  "core:meridian": { mass: 17500, speed: 17.5, astern: 3.2, push: 1.6, lock: .9, helm: .8, grip: .6, steady: 1.4, bank: .55, plane: .36, lift: .12, spool: 1100, shift: .48, low: .1, fuel: 720, minutes: 55, slots: 48, payload: 2100, hp: 2600, aliases: ["sport_yacht", "coupe_yacht"] },
  "core:belvedere": { mass: 46500, speed: 14.5, astern: 3, push: 1.1, lock: .95, helm: .65, grip: .5, steady: 1, bank: .55, plane: .36, lift: .12, spool: 900, shift: .6, low: .1, fuel: 1250, minutes: 70, slots: 64, payload: 4200, hp: 3650, aliases: ["flybridge_yacht", "motor_yacht"] },
  "core:sovereign": { mass: 126000, speed: 12, astern: 2.8, push: .75, lock: .95, helm: .5, grip: .42, steady: .8, bank: .55, plane: .36, lift: .12, spool: 700, shift: .8, low: .1, fuel: 2200, minutes: 90, slots: 80, payload: 8000, hp: 5000, aliases: ["superyacht", "flagship_yacht"] },
  // Two hulls far apart: they stay flat in a turn and hold their line.
  "core:manta": { mass: 4600, speed: 28, astern: 4, push: 5.8, lock: .6, helm: 1.5, grip: 1.2, steady: 4, bank: .24, plane: .36, lift: .48, spool: 3700, shift: .22, low: .1, fuel: 330, minutes: 34, slots: 24, payload: 850, hp: 1700, aliases: ["catamaran", "sport_powerboat"] },
  "core:lagoon": { mass: 28800, speed: 13.5, astern: 3.2, push: 1.3, lock: .95, helm: .65, grip: .55, steady: 1.3, bank: .24, plane: .36, lift: .12, spool: 1100, shift: .48, low: .1, fuel: 920, minutes: 100, slots: 56, payload: 3200, hp: 3000, aliases: ["powercat", "catamaran_yacht"] },
};

// The colours each vessel is found in, a palette index each, today's first: its paint, then the stripe and the upholstery
// where it has them. A vessel's colours also choose its wear story (client/core/render/wear.ts), so two of a kind seldom
// hurt alike.
const liveries: Record<string, { paint: number[]; stripe?: number[]; seats?: number[] }> = {
  "core:needle": { paint: [20, 46, 232, 230, 48, 53], seats: [230, 22, 232] },
  "core:thunderbolt": { paint: [29, 232, 230, 34, 84, 41], seats: [104, 230, 22, 101] },
  "core:jon_boat": { paint: [136, 128, 120, 87, 98] },
  "core:riptide": { paint: [52, 49, 46, 230, 53, 48], seats: [230, 84, 46] },
  "core:solstice": { paint: [131, 232, 29, 84, 104], stripe: [84, 230, 29, 90], seats: [101, 104, 230, 124] },
  "core:meridian": { paint: [98, 84, 232, 30], stripe: [84, 230, 90, 213], seats: [101, 104, 230, 22] },
  "core:belvedere": { paint: [93, 232, 29, 87], stripe: [84, 230, 29, 213], seats: [101, 104, 230, 124] },
  "core:sovereign": { paint: [87, 232, 230, 29], stripe: [84, 213, 90, 230], seats: [101, 104, 230, 22] },
  "core:manta": { paint: [40, 232, 46, 230], stripe: [74, 230, 29, 46], seats: [100, 101, 230] },
  "core:lagoon": { paint: [91, 232, 104, 236], stripe: [41, 230, 29, 213], seats: [225, 101, 230] },
};
const dyes = (colors: readonly number[]) => colors.map(c => [c, 1] as const);

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
  const livery = liveries[model.id]!, trim = model.family === "yacht" || model.family === "catamaran";
  const cat = model.family === "catamaran";
  const o = outfits[model.id]!, jet = model.family === "pwc";
  const big = model.length >= 14;
  const thrust = o.mass * o.push;
  const halfWidth = model.beam / 2, halfLength = model.length / 2;
  const buoyancyHeight = Math.min(model.height, Math.max(.45, model.draft * 2.3));
  const displacement = Math.max(o.mass * 2.5, o.mass + o.payload + model.seats.length * 100 + o.mass * .2);
  // Float centres place the lightship on its authored waterline. Three sections distribute lift down each side.
  const floatY = model.draft + buoyancyHeight * (.5 - o.mass / displacement);
  const buoyancyPoints = [-.66, -.06, .54].flatMap(z => [-1, 1].map(side => ({
    at: [side * (model.sponsonX ?? halfWidth * .72), floatY, z * halfLength] as MarinePoint, weight: 1 / 6,
  })));
  const radius = Math.min(.85, Math.max(.09, model.draft * .46));
  // Resistance at the design speed reflects how far the hull is on plane there and the wetted area left with one pilot aboard.
  const planed = Math.min(1, Math.max(0, (1 - o.plane) / (o.plane * .8)));
  const wetted = Math.min(1, (o.mass * (1 - o.lift * planed) + 80) / (displacement * .35));
  const drag = ((thrust - (o.mass + 80) * .015 * o.speed) / wetted - 90 * o.speed) / (o.speed ** 2 * (1 - .32 * planed));
  const spec: BoatSpec = {
    halfWidth, halfLength, height: model.height, clearance: 0, mass: o.mass, displacement, draft: model.draft,
    buoyancyHeight, buoyancyPoints, buoyancyDamping: big ? 5.8 : 4.7, centerOfMass: [0, floatY - o.low, -.06 * halfLength], hullBoxes: model.boxes,
    ...driveAt(model.propeller, model.outboard, radius, model.jetIntake),
    ...(model.secondPropeller ? { secondDrive: driveAt(model.secondPropeller, model.secondOutboard, radius) } : {}),
    thrust, reverseThrust: thrust * .36, idleRpm: big ? 650 : 900, maxRpm: big ? 3100 : jet ? 8200 : 6400,
    rpmRate: o.spool, shiftDelay: o.shift, maxSteer: o.lock, steerRate: o.helm,
    maxForward: o.speed, maxReverse: o.astern, planingSpeed: o.speed * o.plane, planingLift: o.lift, planingTrim: big ? .035 : .07, planingBankArm: o.bank,
    forwardDrag: Math.max(1, drag), sideDrag: o.mass * o.grip, angularDrag: o.steady, gravity: 18,
    fuelCapacity: o.fuel, fuelPerSecond: o.fuel / (o.minutes * 60),
  };
  const helmAxis = model.helmAxis ?? (jet ? [0, 1, 0] : [0, 0, 1]), ratio = jet ? -1 : .69 / spec.maxSteer;
  const [hx, hy, hz] = model.helm;
  const vehicle: BoatVehicleDefinition = {
    id: model.id, movement: "boat", family: model.family, spec, boarding: model.boarding, wreck: `${model.id}_sunk`,
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
    // The small craft's seats are their second region (performance_marine/spec.ts); a yacht's and a catamaran's third.
    regions: [
      { name: cat ? "Hull" : "Paint", colors: dyes(livery.paint) },
      trim ? { name: cat ? "Boot stripe" : "Stripe", colors: dyes(livery.stripe!) } : livery.seats ? { name: "Upholstery", colors: dyes(livery.seats) } : null,
      trim ? { name: "Upholstery", colors: dyes(livery.seats!) } : null, null, null, null,
    ],
  };
}
export const MARINE_FLEET = MARINE_MODELS.map(vessel);
