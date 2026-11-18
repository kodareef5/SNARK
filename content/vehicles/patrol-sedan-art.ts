/** Dimensions in metres. The engine's +X is the driver's side, +Z points through the grille. */
const bones = [
  "chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right",
  "door_left", "door_right", "door_rear_left", "door_rear_right", "steering_wheel",
] as const;
const pivots = [
  [0, 0, 0], [.84, .345, 1.49], [-.84, .345, 1.49], [.84, .345, -1.49], [-.84, .345, -1.49],
  [.941, .80, .965], [-.941, .80, .965], [.95, .80, -.184], [-.95, .80, -.184], [.47, .901, .655],
] as const;
export const PATROL_SEDAN_ART = {
  id: "core:patrol_sedan", bones, pivots, beltline: 1.0, wheelRadius: .345, wheelWidth: .235,
  envelope: { min: [-1.08, 0, -2.59], max: [1.08, 1.67, 2.59] },
  anchors: {
    door_left: pivots[5], door_right: pivots[6], door_rear_left: pivots[7], door_rear_right: pivots[8], steering: pivots[9],
    seat_driver: [.47, .53, .24], seat_front_passenger: [-.47, .53, .24],
    seat_rear_left: [.47, .53, -.74], seat_rear_right: [-.47, .53, -.74],
    approach_left: [1.42, 0, .24], approach_right: [-1.42, 0, .24],
    exit_left: [1.42, 0, .24], exit_right: [-1.42, 0, .24],
    approach_rear_left: [1.42, 0, -.74], approach_rear_right: [-1.42, 0, -.74],
    exit_rear_left: [1.42, 0, -.74], exit_rear_right: [-1.42, 0, -.74],
    camera_driver: [.47, 1.16, .31], camera_front_passenger: [-.47, 1.16, .31],
    camera_rear_left: [.47, 1.16, -.67], camera_rear_right: [-.47, 1.16, -.67], camera_chase: [0, 1.08, 0],
    exhaust_left: [.64, .25, -2.55], exhaust_right: [-.64, .25, -2.55],
    light_red_front: [.43, 1.615, .150], light_red_rear: [.43, 1.615, -.150],
    light_red_side: [.704, 1.615, 0], light_blue_side: [-.704, 1.615, 0],
    light_blue_front: [-.43, 1.615, .150], light_blue_rear: [-.43, 1.615, -.150],
  },
  shotPanels: [
    [[-.70,1.45,.39],[.70,1.45,.39],[.70,1.49,-.25],[-.70,1.49,-.25]],
    [[-.70,1.49,-.25],[.70,1.49,-.25],[.68,1.445,-.92],[-.68,1.445,-.92]],
    ...([-1, 1] as const).flatMap(s => [
      [[s*.70,1.45,.39],[s*.755,1.39,.33],[s*.74,1.385,-.85],[s*.68,1.445,-.92]],
      [[s*.70,1.45,.39],[s*.755,1.39,.33],[s*.91,.993,.935],[s*.873,1.006,1.043]],
      [[s*.754,1.40,-.149],[s*.754,1.40,-.212],[s*.923,1.0,-.247],[s*.923,1.0,-.145]],
      [[s*.706,1.435,-.90],[s*.744,1.384,-.803],[s*.908,.996,-1.28],[s*.862,.996,-1.59]],
    ] as const),
  ] as const,
} as const;
