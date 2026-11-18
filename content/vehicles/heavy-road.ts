import type { SpeciesDef } from "../../shared/content/defs.ts";
import type {
  VehicleSeat,
  WheelVehicleDefinition,
} from "../../shared/sim/vehicle.ts";
import { COMPACT_SPECIES, COMPACT_VEHICLE } from "./compact.ts";
import { TANKER_VEHICLE } from "./tanker.ts";

type Point = readonly [number, number, number];

function heavyRoad(name: "bus" | "semi") {
  const bus = name === "bus";
  const mass = bus ? 7200 : 6800;
  const id = "core:" + name;
  const driver: Point = bus ? [0.54, 1.46, 2.88] : [0.49, 1.61, 1.24];
  const right: Point = bus ? [-1.69, 0, 3.14] : [-1.61, 0, 1.35];
  const left: Point = [-right[0], 0, right[2]];
  const eye: Point = [
    driver[0],
    driver[1] + (bus ? 0.7 : 0.83),
    driver[2] + (bus ? 0.08 : 0.2),
  ];
  const passenger: Point = bus ? [-0.67, 1.44, 1.78] : [-0.49, 1.61, 1.24];
  const anchors: Record<string, Point> = {
    seat_driver: driver,
    seat_front_passenger: passenger,
    camera_driver: eye,
    camera_front_passenger: [passenger[0], passenger[1] + 0.7, passenger[2]],
    approach_left: left,
    approach_right: right,
    exit_left: left,
    exit_right: right,
    camera_chase: [0, 2.5, 0],
    steering: [driver[0], driver[1] + 0.35, driver[2] + 0.425],
  };
  const seats: VehicleSeat[] = [
    { id: "driver", driver: true, anchor: driver, entry: left, door: 0 },
    { id: "passenger", anchor: passenger, entry: right, door: 1 },
  ];
  if (bus) {
    for (const [row, z] of [1.78, 0.58, -0.62, -1.82, -3.02, -4.22].entries()) {
      for (const side of [1, -1]) {
        if (row === 0 && side === -1) continue;
        const seat = "row_" + (row + 1) + (side === 1 ? "_left" : "_right");
        const anchor: Point = [0.67 * side, 1.44, z];
        seats.push({ id: seat, anchor, entry: right, door: 1 });
        anchors["seat_" + seat] = anchor;
      }
    }
  }
  const axles = bus
    ? [
        { z: 4.275, track: 1.96, loadShare: 2.225 / 6.5 },
        { z: -2.225, track: 1.78, loadShare: 4.275 / 6.5 },
      ]
    : [
        { z: 2.546, track: 2.04, loadShare: 2.614 / 5.16 },
        { z: -1.954, track: 1.8, loadShare: 1.273 / 5.16 },
        { z: -3.274, track: 1.8, loadShare: 1.273 / 5.16 },
      ];
  const width = bus ? 1.51 : 1.46,
    length = bus ? 5.64 : 4.34,
    height = bus ? 3.16 : 3.96;
  const roof = bus ? 2.64 : 2.9,
    nose = bus ? 3.61 : 2.04,
    rear = bus ? -5.45 : -0.89,
    side = bus ? 1.2 : 1.06;
  const vehicle: WheelVehicleDefinition = {
    ...COMPACT_VEHICLE,
    id,
    frame: "van",
    ...(bus ? {passengerAisle: 0} : {}),
    seats,
    spec: {
      ...TANKER_VEHICLE.spec,
      axles,
      mass,
      halfWidth: width,
      halfLength: length,
      height,
      wheelbase: bus ? 6.5 : 5.16,
      track: axles[0]!.track,
      wheelRadius: bus ? 0.5 : 0.52,
      maxForward: bus ? 22 : 28,
      maxSteer: bus ? 0.62 : 0.68,
      fuelCapacity: bus ? 145 : 260,
    },
    wheels: (bus ? ["front", "rear"] : ["front", "middle", "rear"]).flatMap(
      (axle) =>
        ["left", "right"].map((side) => ({
          bone: "wheel_" + axle + "_" + side,
          steers: axle === "front",
        })),
    ),
    beltline: bus ? 1.78 : 2,
    steeringWheel: {
      bone: "steering_wheel",
      axis: [0, -0.62, 0.78],
      ratio: -5.5,
    },
    shotPanels: [
      [
        [-side, roof, rear],
        [side, roof, rear],
        [side, roof, nose],
        [-side, roof, nose],
      ],
      ...(!bus
        ? [
            [
              [-side, 1.15, rear],
              [side, 1.15, rear],
              [side, roof, rear],
              [-side, roof, rear],
            ] as const,
          ]
        : []),
    ],
  };
  const species: SpeciesDef = {
    ...COMPACT_SPECIES,
    id,
    mesh: id,
    skeleton: id,
    aliases: bus
      ? ["bus", "school_bus"]
      : ["semi", "tractor_truck", "semi_truck"],
    vehicle,
    color: bus ? 9 : 28,
    regions: [null, null, null, null, null, null],
    height,
    radius: width,
    eyeHeight: eye[1],
    slots: bus ? 40 : 32,
    mass,
    stats: {
      health: [bus ? 1800 : 2100, 0, 0],
      stamina: [vehicle.spec.fuelCapacity, 0, 0],
      weight: [bus ? 1300 : 1100, 0, 0],
    },
  };
  return { anchors, species };
}
export const BUS = heavyRoad("bus");
export const SEMI = heavyRoad("semi");
