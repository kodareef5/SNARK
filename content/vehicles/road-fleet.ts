import { BUS, SEMI } from "./heavy-road.ts";
import { TANKER } from "./tanker.ts";
// All three road frames use the compact's wheel solver and rig conventions. Body-specific measurements come from art.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { VehicleDoor, VehicleSeat, VehicleSpec, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { COMPACT, COMPACT_SPECIES, COMPACT_VEHICLE } from "./compact.ts";
import { FASTBACK_ART } from "./fastback-art.ts";
import { BERLINETTA_ART, VELOCE_ART } from "./sports-art.ts";
import { CARAVAN_ART, PANEL_VAN_ART } from "./van-art.ts";

// Each enclosed body supplies its own metal cabin panels; the compact dimensions do not fit the fleet.
const { shotPanels: _compactPanels, ...roadDefaults } = COMPACT_VEHICLE;

type Point = readonly [number, number, number];
interface RoadModel {
  readonly id: string;
  readonly envelope: { readonly max: Point };
  readonly bones: readonly string[];
  readonly pivots: readonly Point[];
  readonly wheelRadius: number;
  readonly shotPanels: NonNullable<WheelVehicleDefinition["shotPanels"]>;
  readonly anchors: {
    readonly seat_driver: Point; readonly seat_front_passenger: Point;
    readonly approach_left: Point; readonly approach_right: Point;
    readonly camera_driver: Point;
  };
}

const sports: VehicleSpec = {
  ...COMPACT, clearance: .115, mass: 1450, brake: 19, maxForward: 61, maxReverse: 9,
  maxSteer: .52, steerRate: 3.2, steerSpeed: 29, frontGrip: 1.72, rearGrip: 1.9,
  corneringStiffness: 11, suspensionFrequency: 14, suspensionDamping: .93, suspensionTravel: .13,
  yawDamping: 1.05, handbrakeGrip: .19, dragScale: .13, downforce: 1.7, frontDriveShare: .32,
  fuelCapacity: 65, fuelPerSecond: .006,
  drivetrain: {
    torqueCurve: [[900, 270], [2700, 420], [4800, 535], [6700, 558], [7800, 505], [8500, 405]],
    idleRpm: 900, redlineRpm: 8500, launchRpm: 3300, rpmResponse: 18000,
    forwardRatios: [3.17, 2.19, 1.68, 1.36, 1.12, .96, .82], reverseRatio: 3.1, finalDrive: 4.35, efficiency: .92,
    upshiftRpm: 7700, downshiftRpm: 2800, shiftDuration: .085, shiftCooldown: .42, engineBrakeNm: 36,
  },
};
const van: VehicleSpec = {
  ...COMPACT, clearance: .19, mass: 2240, brake: 13, maxForward: 29, maxReverse: 5,
  maxSteer: .62, steerRate: 1.9, steerSpeed: 17, frontGrip: 1.13, rearGrip: 1.22, corneringStiffness: 7.1,
  suspensionFrequency: 8.7, suspensionDamping: .96, suspensionTravel: .24,
  yawDamping: 1.48, handbrakeGrip: .38, frontDriveShare: 0, dragScale: .34,
  fuelCapacity: 75, fuelPerSecond: .004,
  drivetrain: {
    torqueCurve: [[750, 200], [1400, 370], [2300, 425], [3400, 365], [4300, 220]],
    idleRpm: 750, redlineRpm: 4300, launchRpm: 1550, rpmResponse: 8500,
    forwardRatios: [4.4, 2.7, 1.82, 1.34, 1, .78], reverseRatio: 4.1, finalDrive: 3.65, efficiency: .88,
    upshiftRpm: 3650, downshiftRpm: 1550, shiftDuration: .24, shiftCooldown: .83, engineBrakeNm: 34,
  },
};

interface Trim {
  readonly aliases: readonly string[];
  readonly paints: readonly number[];
  readonly health: number;
  readonly slots: number;
  readonly payload: number;
  readonly beltline: number;
  readonly extraSeats?: readonly VehicleSeat[];
  readonly extraDoors?: readonly VehicleDoor[];
  readonly cargoDoor?: number;
}

function roadCar(art: RoadModel, frame: NonNullable<WheelVehicleDefinition["frame"]>, tuning: VehicleSpec, trim: Trim): SpeciesDef {
  const at = art.anchors, [halfWidth, height, halfLength] = art.envelope.max;
  const pivot = (name: string) => art.pivots[art.bones.indexOf(name)]!;
  const front = pivot("wheel_front_left");
  const spec = {
    ...tuning, halfWidth, height, halfLength, wheelRadius: art.wheelRadius,
    track: front[0] - pivot("wheel_front_right")[0], wheelbase: front[2] - pivot("wheel_rear_left")[2],
  };
  const vehicle: WheelVehicleDefinition = {
    ...roadDefaults, id: art.id, frame, spec, beltline: trim.beltline, shotPanels: art.shotPanels,
    seats: [
      { id: "driver", driver: true, anchor: at.seat_driver, entry: at.approach_left, door: 0 },
      { id: "passenger", anchor: at.seat_front_passenger, entry: at.approach_right, door: 1 },
      ...(trim.extraSeats ?? []),
    ],
    doors: [...COMPACT_VEHICLE.doors, ...(trim.extraDoors ?? [])],
    ...(trim.cargoDoor !== undefined ? { cargoDoor: trim.cargoDoor } : {}),
  };
  return {
    ...COMPACT_SPECIES, id: art.id, mesh: art.id, skeleton: art.id, aliases: trim.aliases, vehicle,
    color: trim.paints[0]!, radius: halfWidth, height, eyeHeight: at.camera_driver[1],
    mass: spec.mass!, slots: trim.slots,
    stats: { health: [trim.health, 0, 0], stamina: [spec.fuelCapacity, 0, 0], weight: [trim.payload, 0, 0] },
    regions: [{ name: "Paint", colors: trim.paints.map(c => [c, 1] as const) }, ...COMPACT_SPECIES.regions!.slice(1)],
  };
}

const fastback = roadCar(FASTBACK_ART, "car", COMPACT, {
  aliases: ["fastback", "porsche"], paints: [46, 232, 90, 29, 103], health: 800, slots: 24, payload: 400, beltline: COMPACT_VEHICLE.beltline,
});
const veloce = roadCar(VELOCE_ART, "sports_car", sports, {
  aliases: ["veloce", "lambo", "lamborghini", "sports_car"], paints: [47, 48, 49, 232], health: 840, slots: 12, payload: 180, beltline: .79,
});
const berlinetta = roadCar(BERLINETTA_ART, "sports_car", {
  ...sports, mass: 1390, frontDriveShare: 0, rearGrip: 2.22, downforce: 1.9, steerSpeed: 31, maxForward: 63,
}, { aliases: ["berlinetta", "ferrari"], paints: [46, 34, 48, 90], health: 840, slots: 12, payload: 180, beltline: .79 });

const slider = (side: "left" | "right", travel: number): VehicleDoor => ({
  bone: `door_slide_${side}`, slide: { outward: side === "left" ? .115 : -.115, along: -travel }, openTicks: 12, closeTicks: 16,
});
const panelVan = roadCar(PANEL_VAN_ART, "van", van, {
  aliases: ["panel_van", "cargo_van", "van"], paints: [10], health: 1200, slots: 72, payload: 1050,
  beltline: PANEL_VAN_ART.beltline, extraDoors: [slider("right", PANEL_VAN_ART.slideTravel)], cargoDoor: 2,
});
const rear = CARAVAN_ART.anchors;
const caravan = roadCar(CARAVAN_ART, "van", {
  ...van, mass: 1860, clearance: .155, maxForward: 35, frontDriveShare: 1, suspensionFrequency: 9.5,
  dragScale: .25, drivetrain: {
    ...COMPACT.drivetrain!, torqueCurve: [[850, 155], [2000, 260], [3800, 340], [5200, 315], [6500, 225]],
    redlineRpm: 6500, upshiftRpm: 5600, forwardRatios: [3.75, 2.38, 1.63, 1.2, .92, .74],
  },
}, {
  aliases: ["caravan", "minivan", "family_van"], paints: [103, 5, 90, 232, 22], health: 1000, slots: 40, payload: 640,
  beltline: CARAVAN_ART.beltline,
  extraSeats: [
    { id: "rear_left", anchor: rear.seat_rear_left, entry: rear.approach_rear_left, door: 2 },
    { id: "rear_right", anchor: rear.seat_rear_right, entry: rear.approach_rear_right, door: 3 },
  ],
  extraDoors: [slider("left", CARAVAN_ART.slideTravel), slider("right", CARAVAN_ART.slideTravel)],
});

export const ROAD_FLEET = [COMPACT_SPECIES, fastback, veloce, berlinetta, panelVan, caravan, TANKER, BUS.species, SEMI.species] as const;
