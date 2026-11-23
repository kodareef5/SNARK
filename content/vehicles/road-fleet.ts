import { streetCar } from "./street-cars.ts";
import { BUS, SEMI } from "./heavy-road.ts";
import { TANKER } from "./tanker.ts";
// The road frames use the compact's wheel solver and rig conventions. Body-specific measurements come from art.
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { EmergencyLamp, VehicleDoor, VehicleSeat, VehicleSpec, WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { COMPACT, COMPACT_SPECIES, COMPACT_VEHICLE } from "./compact.ts";
import { PATROL_JEEP_ART } from "./patrol-jeep-art.ts";
import { PATROL_SEDAN_ART } from "./patrol-sedan-art.ts";
import { FASTBACK_ART } from "./fastback-art.ts";
import { BERLINETTA_ART, VELOCE_ART, ZEPHYR_ART, ZEPHYR_NOZZLES } from "./sports-art.ts";
import { ZEPHYR_THRUSTERS } from "../../shared/sim/vehicle-thrusters.ts";
import { CARAVAN_ART, PANEL_VAN_ART } from "./van-art.ts";
import { withRooms } from "./cabin-room.ts";

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
  readonly controls?: VehicleSeat["controls"];
  readonly shotPanels?: WheelVehicleDefinition["shotPanels"];
  readonly emergencyLights?: readonly EmergencyLamp[];
  readonly nozzles?: WheelVehicleDefinition["nozzles"];
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
    seats: withRooms(art.id, [
      { id: "driver", driver: true, anchor: at.seat_driver, entry: at.approach_left, door: 0, ...(trim.controls && { pose: "drive" as const, controls: trim.controls }) },
      { id: "passenger", anchor: at.seat_front_passenger, entry: at.approach_right, door: 1 },
      ...(trim.extraSeats ?? []),
    ]),
    doors: [...COMPACT_VEHICLE.doors, ...(trim.extraDoors ?? [])],
    ...(trim.shotPanels ? { shotPanels: trim.shotPanels } : {}),
    ...(trim.emergencyLights ? { emergencyLights: trim.emergencyLights } : {}),
    ...(trim.nozzles ? { nozzles: trim.nozzles } : {}),
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

function patrolCar(art: typeof PATROL_JEEP_ART | typeof PATROL_SEDAN_ART, frame: "off_road" | "car", spec: VehicleSpec,
  trim: Trim, emergencyLights: readonly EmergencyLamp[]): SpeciesDef {
  const at = art.anchors;
  return roadCar(art, frame, spec, { ...trim, emergencyLights, shotPanels: art.shotPanels,
    extraSeats: [
      { id: "rear_left", anchor: at.seat_rear_left, entry: at.approach_rear_left, door: 2 },
      { id: "rear_right", anchor: at.seat_rear_right, entry: at.approach_rear_right, door: 3 },
    ],
    extraDoors: [
      { bone: "door_rear_left", axis: [0, 1, 0], open: -1.09, openTicks: 7, closeTicks: 11 },
      { bone: "door_rear_right", axis: [0, 1, 0], open: 1.09, openTicks: 7, closeTicks: 11 },
    ],
  });
}
const sedanLamps = PATROL_SEDAN_ART.anchors, jeepLamps = PATROL_JEEP_ART.anchors;
const patrolSedan = patrolCar(PATROL_SEDAN_ART, "car", {
  ...COMPACT, mass: 1760, clearance: .16, maxForward: 52, brake: 17, fuelCapacity: 68,
  suspensionFrequency: 10.6, suspensionDamping: .76, suspensionTravel: .22, frontDriveShare: .23,
  frontGrip: 1.43, rearGrip: 1.53, steerSpeed: 28, yawDamping: 1.23, dragScale: .19,
  drivetrain: { ...COMPACT.drivetrain!, torqueCurve: [[800, 240], [2000, 380], [4000, 462], [5400, 438], [6800, 340]],
    forwardRatios: [4.15, 2.56, 1.74, 1.31, 1, .79], finalDrive: 3.56, engineBrakeNm: 34 },
}, { aliases: ["copcar", "police_car", "cruiser", "patrol_sedan"], paints: [10], health: 1080, slots: 32, payload: 560, beltline: PATROL_SEDAN_ART.beltline }, [
  { at: sedanLamps.light_red_front, color: "red", facing: "front" }, { at: sedanLamps.light_blue_front, color: "blue", facing: "front" },
  { at: sedanLamps.light_red_side, width: .13, color: "red" }, { at: sedanLamps.light_blue_side, width: .13, color: "blue" },
  { at: sedanLamps.light_red_rear, color: "red", facing: "rear" }, { at: sedanLamps.light_blue_rear, color: "blue", facing: "rear" },
]);

const patrolJeep = patrolCar(PATROL_JEEP_ART, "off_road", {
  ...COMPACT, mass: 2080, clearance: .315, maxForward: 38, brake: 14.5, fuelCapacity: 79, maxRise: .42, maxDrop: .64,
  suspensionFrequency: 7.65, suspensionDamping: .38, suspensionTravel: .37, frontDriveShare: .48,
  frontGrip: 1.3, rearGrip: 1.4, maxSteer: .64, steerSpeed: 20, yawDamping: 1.34, dragScale: .31,
  drivetrain: { ...COMPACT.drivetrain!, torqueCurve: [[800, 245], [1600, 365], [3200, 415], [4600, 390], [6100, 285]],
    redlineRpm: 6100, upshiftRpm: 5500, forwardRatios: [4.55, 2.83, 1.83, 1.35, 1, .78], finalDrive: 4.14, engineBrakeNm: 39 },
}, { aliases: ["copjeep", "police_jeep", "patrol_jeep"], paints: [19], health: 1280, slots: 40, payload: 720, beltline: PATROL_JEEP_ART.beltline }, [
  { at: jeepLamps.lightbar_red_front, color: "red", facing: "front" }, { at: jeepLamps.lightbar_blue_front, color: "blue", facing: "front" },
  { at: jeepLamps.lightbar_red_side, width: .047, color: "red" }, { at: jeepLamps.lightbar_blue_side, width: .047, color: "blue" },
  { at: jeepLamps.lightbar_red_rear, color: "red", facing: "rear" }, { at: jeepLamps.lightbar_blue_rear, color: "blue", facing: "rear" },
  { at: jeepLamps.grille_red, width: .14, color: "red", facing: "front" }, { at: jeepLamps.grille_blue, width: .14, color: "blue", facing: "front" },
]);

// The flying car: rear-biased like the berlinetta and heavier for its air tanks. It is spawned by an admin
// (`spawn core:zephyr`) and parks nowhere: no city weight, no wreck and no bay on the test-drive lot.
const zephyr = roadCar(ZEPHYR_ART, "sports_car", {
  ...sports, mass: 1700, frontDriveShare: 0, rearGrip: 2.22, downforce: 1.9, steerSpeed: 31, maxForward: 63, thrusters: ZEPHYR_THRUSTERS,
}, { aliases: ["zephyr", "flying_car"], paints: [34, 230, 232, 90, 29], health: 860, slots: 12, payload: 180, beltline: .79, nozzles: ZEPHYR_NOZZLES,
  controls: { left: [.592, .735, .385], right: [.248, .735, .385], style: "helm",
    turn: { pivot: ZEPHYR_ART.anchors.steering, axis: [0, 0, 1], ratio: COMPACT_VEHICLE.steeringWheel!.ratio } },
});

export const ROAD_FLEET = [COMPACT_SPECIES, fastback, veloce, berlinetta, panelVan, caravan, patrolSedan, patrolJeep, TANKER, BUS.species, SEMI.species,
  streetCar("monster_truck").species, streetCar("muscle_car").species, streetCar("taxi").species, zephyr] as const;
/** The fleet bodies that are only ever spawned by hand, never parked by a fixture or a city. */
export const SPAWN_ONLY: ReadonlySet<string> = new Set([zephyr.id]);
