/**
 * The compact's measured contract, which the simulation and seats depend on: metres, +Y up, +Z forward, +X the driver's
 * side (the car's left), origin on the ground. rig.py and shape.py build the rig on these numbers, asset.ts takes the
 * sockets from them, and tests/unit/vehicle-asset.test.ts holds the built pack and the content's numbers (compact.ts) to them. ref/DESIGN.md says what each is.
 */
export const COMPACT_ART = {
  id: "core:compact",
  envelope: { min: [-0.9, 0, -2], max: [0.9, 1.5, 2] },
  // Roof between the two glass panes, side rails and the A/C pillars, from the greenhouse sections in shape.py.
  // Points run round each face. The windscreen, rear glass and open side windows stay clear.
  shotPanels: [
    [[-.68,1.44,.247],[.68,1.44,.247],[.68,1.50,-.23],[-.68,1.50,-.23]],
    [[-.68,1.50,-.23],[.68,1.50,-.23],[.68,1.44,-.705],[-.68,1.44,-.705]],
    ...([-1, 1] as const).flatMap(side => [
      [[side*.68,1.44,.247],[side*.73,1.37,.20],[side*.74,1.36,-.57],[side*.68,1.44,-.705]],
      [[side*.68,1.44,.247],[side*.73,1.37,.20],[side*.79,.95,.63],[side*.72,.95,.73]],
      [[side*.68,1.44,-.705],[side*.74,1.36,-.57],[side*.79,.95,-.96],[side*.70,.95,-1.37]],
    ] as const),
  ] as const,
  wheelRadius: 0.3,
  wheelWidth: 0.24,
  bones: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right", "door_left", "door_right", "steering_wheel"],
  pivots: [[0, 0, 0], [0.78, 0.3, 1.25], [-0.78, 0.3, 1.25], [0.78, 0.3, -1.25], [-0.78, 0.3, -1.25], [0.84, 0.76, 0.65], [-0.84, 0.76, 0.65], [0.42, 0.89, 0.55]],
  anchors: {
    seat_driver: [0.42, 0.59, 0.12],
    seat_front_passenger: [-0.42, 0.59, 0.12],
    approach_left: [1.25, 0, 0.12],
    approach_right: [-1.25, 0, 0.12],
    exit_left: [1.25, 0, 0.12],
    exit_right: [-1.25, 0, 0.12],
    door_left: [0.84, 0.76, 0.65],
    door_right: [-0.84, 0.76, 0.65],
    camera_driver: [0.42, 1.11, 0.17],
    camera_front_passenger: [-0.42, 1.11, 0.17],
    camera_chase: [0, 1.0, 0],
    steering: [0.42, 0.89, 0.55],
    exhaust_left: [0.57, 0.255, -1.99],
    exhaust_right: [-0.57, 0.255, -1.99],
  },
} as const;
