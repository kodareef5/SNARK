import type { SpeciesDef } from "../../shared/content/defs.ts";
import type {
  VehicleSeat,
  VehicleSpec,
  WheelVehicleDefinition,
} from "../../shared/sim/vehicle.ts";
import { COMPACT, COMPACT_SPECIES, COMPACT_VEHICLE } from "./compact.ts";

type Point = readonly [number, number, number];
interface RoadFit {
  size: Point;
  driver: Point;
  eye: Point;
  wheel: Point;
  rearAxle: readonly [number, number];
  sill: number;
  roof: Point;
  entry: number;
  aliases: string[];
  tuning: Partial<VehicleSpec>;
  torque: number;
  finalDrive: number;
  color: number;
  hp: number;
  slots: number;
}
const fits = {
  monster_truck: {
    size: [1.488, 2.635, 2.29],
    driver: [0.42, 1.64, -0.46],
    eye: [0.42, 2.24, -0.37],
    wheel: [1.16, 0.8, 1.410028],
    rearAxle: [1.16, -1.489973],
    sill: 1.89,
    roof: [0.65, 2.4, -0.34],
    entry: -0.25,
    aliases: ["monster_truck", "monstertruck"],
    color: 28,
    hp: 1650,
    slots: 36,
    torque: 3.55,
    finalDrive: 7.4,
    tuning: {
      mass: 3050,
      maxForward: 29,
      maxReverse: 6,
      brake: 12,
      clearance: 0.52,
      maxRise: 0.5,
      maxDrop: 0.65,
      frontDriveShare: 0.46,
      suspensionFrequency: 7.5,
      suspensionTravel: 0.35,
      suspensionDamping: 0.94,
      frontGrip: 1.35,
      rearGrip: 1.46,
      steerSpeed: 16,
      maxSteer: 0.58,
      yawInertia: 1.52,
      fuelCapacity: 95,
    },
  },
  muscle_car: {
    size: [0.97, 1.39, 2.35],
    driver: [0.42, 0.59, -0.3],
    eye: [0.42, 1.145, -0.2],
    wheel: [0.74, 0.3425, 1.518311],
    rearAxle: [0.76, -1.341689],
    sill: 0.9,
    roof: [0.57, 1.35, -0.43],
    entry: -0.1,
    aliases: ["muscle_car", "musclecar"],
    color: 46,
    hp: 1000,
    slots: 27,
    torque: 1.63,
    finalDrive: 3.62,
    tuning: {
      mass: 1550,
      maxForward: 47,
      maxReverse: 7,
      brake: 15,
      clearance: 0.145,
      frontDriveShare: 0,
      frontGrip: 1.33,
      rearGrip: 1.36,
      handbrakeGrip: 0.18,
      steerSpeed: 24,
      yawInertia: 1.35,
      fuelCapacity: 67,
    },
  },
  taxi: {
    size: [0.96, 1.75, 2.4],
    driver: [0.42, 0.63, 0.16],
    eye: [0.42, 1.225, 0.27],
    wheel: [0.755, 0.33, 1.46],
    rearAxle: [0.755, -1.43],
    sill: 0.96,
    roof: [0.63, 1.45, -0.21],
    entry: 0.28,
    aliases: ["taxi", "cab", "city_cab"],
    color: 9,
    hp: 1100,
    slots: 32,
    torque: 1.14,
    finalDrive: 3.85,
    tuning: {
      mass: 1530,
      maxForward: 33,
      maxReverse: 6,
      brake: 13,
      clearance: 0.16,
      frontDriveShare: 0.52,
      frontGrip: 1.24,
      rearGrip: 1.38,
      steerSpeed: 21,
      yawDamping: 1.24,
      suspensionTravel: 0.22,
      fuelCapacity: 61,
    },
  },
} as const satisfies Record<string, RoadFit>;
export type StreetCar = keyof typeof fits;
export function streetCar(name: StreetCar) {
  const fit = fits[name],
    [w, height, l] = fit.size,
    [x, y, z] = fit.driver,
    [track, radius, front] = fit.wheel,
    [rearTrack, rear] = fit.rearAxle;
  const base = COMPACT.drivetrain!,
    wheelbase = front - rear,
    id = "core:" + name;
  const anchors: Record<string, Point> = {
    seat_driver: fit.driver,
    seat_front_passenger: [-x, y, z],
    camera_driver: fit.eye,
    camera_front_passenger: [-fit.eye[0], fit.eye[1], fit.eye[2]],
    camera_chase: [0, height * 0.76, 0],
    approach_left: [w + 0.43, 0, fit.entry],
    approach_right: [-w - 0.43, 0, fit.entry],
    steering: [x, y + 0.245, z + 0.305],
  };
  anchors.exit_left = anchors.approach_left!;
  anchors.exit_right = anchors.approach_right!;
  const doors = [...COMPACT_VEHICLE.doors],
    seats: VehicleSeat[] = [
      {
        id: "driver",
        driver: true,
        door: 0,
        anchor: fit.driver,
        entry: anchors.approach_left!,
      },
      {
        id: "passenger",
        door: 1,
        anchor: anchors.seat_front_passenger!,
        entry: anchors.approach_right!,
      },
    ];
  if (name === "taxi")
    for (const [i, side] of ["left", "right"].entries()) {
      const sign = i ? -1 : 1,
        anchor: Point = [sign * x, y - 0.012, -0.78],
        entry: Point = [sign * (w + 0.43), 0, -0.78];
      anchors["seat_rear_" + side] = anchor;
      anchors["approach_rear_" + side] = entry;
      seats.push({ id: "rear_" + side, door: i + 2, anchor, entry });
      doors.push({ ...doors[i]!, bone: "door_rear_" + side });
    }
  const [rw, ry, rz] = fit.roof,
    roofHalf =
      name === "monster_truck" ? 0.46 : name === "muscle_car" ? 0.49 : 0.7;
  const vehicle: WheelVehicleDefinition = {
    ...COMPACT_VEHICLE,
    id,
    frame: name === "monster_truck" ? "off_road" : "car",
    doors,
    seats,
    spec: {
      ...COMPACT,
      ...fit.tuning,
      halfWidth: w,
      height,
      halfLength: l,
      wheelRadius: radius,
      track: track * 2,
      wheelbase,
      axles: [
        { track: track * 2, z: front, loadShare: -rear / wheelbase },
        { track: rearTrack * 2, z: rear, loadShare: front / wheelbase },
      ],
      drivetrain: {
        ...base,
        torqueCurve: base.torqueCurve.map(
          ([rpm, torque]) => [rpm, Math.round(torque * fit.torque)] as const,
        ),
        finalDrive: fit.finalDrive,
      },
    },
    beltline: fit.sill,
    shotPanels: [
      [
        [-rw, ry, rz - roofHalf],
        [rw, ry, rz - roofHalf],
        [rw, ry, rz + roofHalf],
        [-rw, ry, rz + roofHalf],
      ],
    ],
    steeringWheel: {
      bone: "steering_wheel",
      axis: [0, 0.358, 0.934],
      ratio: -4.5,
    },
  };
  const species: SpeciesDef = {
    ...COMPACT_SPECIES,
    id,
    mesh: id,
    skeleton: id,
    vehicle,
    aliases: fit.aliases,
    color: fit.color,
    regions: [null, null, null, null, null, null],
    radius: w,
    height,
    eyeHeight: fit.eye[1],
    mass: fit.tuning.mass,
    slots: fit.slots,
    stats: {
      health: [fit.hp, 0, 0],
      stamina: [fit.tuning.fuelCapacity, 0, 0],
      weight: [fit.slots * 13, 0, 0],
    },
  };
  return { species, anchors };
}
