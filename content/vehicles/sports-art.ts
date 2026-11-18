// Both mid-engine bodies fit the same two-seat sports chassis. +Y up, +Z nose, +X driver.
const bones = ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right", "door_left", "door_right", "steering_wheel"] as const;
const pivots = [[0, 0, 0], [.83, .345, 1.35], [-.83, .345, 1.35], [.83, .345, -1.35], [-.83, .345, -1.35], [.885, .64, .72], [-.885, .64, .72], [.42, .735, .485]] as const;
const anchors = {
  seat_driver: [.42, .415, .04], seat_front_passenger: [-.42, .415, .04],
  approach_left: [1.34, 0, .04], approach_right: [-1.34, 0, .04],
  exit_left: [1.34, 0, .04], exit_right: [-1.34, 0, .04],
  door_left: pivots[5], door_right: pivots[6], steering: pivots[7],
  camera_driver: [.42, .985, .10], camera_front_passenger: [-.42, .985, .10], camera_chase: [0, .86, 0],
} as const;
const frame = { bones, pivots, wheelRadius: .345, wheelWidth: .255, envelope: { min: [-1.035, 0, -2.25], max: [1.035, 1.31, 2.25] } } as const;
export const VELOCE_ART = { id: "core:veloce", ...frame, anchors: { ...anchors, exhaust_left: [.32, .47, -2.225], exhaust_right: [-.32, .47, -2.225] } } as const;
export const BERLINETTA_ART = { id: "core:berlinetta", ...frame, anchors: { ...anchors, exhaust_left: [.09, .48, -2.24], exhaust_right: [-.09, .48, -2.24] } } as const;
