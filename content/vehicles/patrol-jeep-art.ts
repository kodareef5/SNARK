// Engine metres. The nose faces +Z and the driver sits at +X.
const point = (x: number, y: number, z: number) => [x, y, z] as const;
const wheel = (side: number, end: number) => point(side * .85, .42, end * 1.45);
const hinge = (side: number, rear = false) => point(side * .87, .99, rear ? -.14 : .87);
const seat = (side: number, rear = false) => point(side * .446, .94, rear ? -.78 : .22);
const entry = (side: number, rear = false) => point(side * 1.39, 0, rear ? -.78 : .22);
const eye = (side: number, rear = false) => point(side * .446, 1.54, rear ? -.73 : .27);
const steering = point(.446, 1.20, .63);

export const PATROL_JEEP_ART = {
  id: "core:patrol_jeep", envelope: { min: point(-1.065, 0, -2.39), max: point(1.065, 2.09, 2.39) },
  wheelRadius: .42, wheelWidth: .29, beltline: 1.31,
  bones: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right",
    "door_left", "door_right", "steering_wheel", "door_rear_left", "door_rear_right"],
  pivots: [point(0, 0, 0), wheel(1, 1), wheel(-1, 1), wheel(1, -1), wheel(-1, -1),
    hinge(1), hinge(-1), steering, hinge(1, true), hinge(-1, true)],
  anchors: {
    seat_driver: seat(1), seat_front_passenger: seat(-1), seat_rear_left: seat(1, true), seat_rear_right: seat(-1, true),
    camera_driver: eye(1), camera_front_passenger: eye(-1), camera_rear_left: eye(1, true), camera_rear_right: eye(-1, true),
    approach_left: entry(1), approach_right: entry(-1), approach_rear_left: entry(1, true), approach_rear_right: entry(-1, true),
    exit_left: entry(1), exit_right: entry(-1), exit_rear_left: entry(1, true), exit_rear_right: entry(-1, true),
    door_left: hinge(1), door_right: hinge(-1), door_rear_left: hinge(1, true), door_rear_right: hinge(-1, true),
    camera_chase: point(0, 1.23, 0), steering, exhaust_left: point(.64, .42, -2.12),
    lightbar_red: point(.44, 2.045, .28), lightbar_blue: point(-.44, 2.045, .28),
    lightbar_red_front: point(.44, 2.045, .386), lightbar_red_rear: point(.44, 2.045, .174),
    lightbar_blue_front: point(-.44, 2.045, .386), lightbar_blue_rear: point(-.44, 2.045, .174),
    lightbar_red_side: point(.729, 2.044, .280), lightbar_blue_side: point(-.729, 2.044, .280),
    grille_red: point(.39, 1, 2.15), grille_blue: point(-.39, 1, 2.15),
  },
  shotPanels: [
    [point(-.813, 1.90, .59), point(.813, 1.90, .59), point(.813, 1.90, -1.99), point(-.813, 1.90, -1.99)],
    ...[-1, 1].flatMap(s => [
      [point(s * .852, 1.31, .94), point(s * .852, 1.31, .857), point(s * .795, 1.865, .526), point(s * .795, 1.865, .609)],
      [point(s * .85, 1.31, -.15), point(s * .85, 1.31, -.21), point(s * .795, 1.865, -.21), point(s * .795, 1.865, -.15)],
      [point(s * .85, 1.31, -1.91), point(s * .85, 1.31, -2.0), point(s * .795, 1.865, -2.0), point(s * .795, 1.865, -1.91)],
    ] as const),
  ],
} as const;
