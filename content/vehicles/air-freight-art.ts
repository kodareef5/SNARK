/**
 * The air freight machines' measured asset contract. Metres; +Y up, +Z forward, +X the driver's left.
 * Each origin is on its own ground plane (the wheels' or skids' support), centred.
 */
type Point = readonly [number, number, number];

const DECK = 1.3;
const bays: Point[] = [0, 1, 2, 3, 4, 5].map((i) => [0, DECK + 0.95, (i - 2.5) * 1.1] as const);

/** The towed container: a six-bay drone rack on a two-axle chassis with a kingpin and landing legs. */
export const AIR_TRAILER_ART = {
  id: "core:air_trailer",
  envelope: { min: [-1.3, 0, -4.45], max: [1.3, DECK + 1.95, 4.45] },
  container: { min: [-1.2, DECK, -3.9], max: [1.2, DECK + 1.92, 3.9] },
  deck: DECK,
  /** The kingpin's bottom, which rides on the tractor's fifth wheel. */
  kingpin: [0, 1.2, 3.75] as Point,
  axles: [{ z: -2.5, track: 2.14 }, { z: -3.75, track: 2.14 }],
  wheelRadius: 0.51,
  /** Landing legs: down when parked, cranked up when hitched. */
  legs: { z: 2.3, halfWidth: 1.0, lift: 0.42 },
  roof: { hinge: [-1.15, DECK + 1.85, 0] as Point, open: (Math.PI * 5) / 6 },
  side: { hinge: [1.16, DECK + 0.3, 0] as Point, open: (-Math.PI * 95) / 180 },
  bones: [
    "chassis", "roof", "side", "legs",
    "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right",
    "bay_1", "bay_2", "bay_3", "bay_4", "bay_5", "bay_6",
  ],
  anchors: {
    kingpin: [0, 1.2, 3.75] as Point,
    legs: [0, 0, 2.3] as Point,
    bay_1: bays[0]!, bay_2: bays[1]!, bay_3: bays[2]!, bay_4: bays[3]!, bay_5: bays[4]!, bay_6: bays[5]!,
    jaw_front_left: [1.17, DECK + 1.65, 3.52] as Point,
    jaw_front_right: [-1.17, DECK + 1.65, 3.52] as Point,
    jaw_rear_left: [1.17, DECK + 1.65, -3.52] as Point,
    jaw_rear_right: [-1.17, DECK + 1.65, -3.52] as Point,
    lights: [0, DECK + 1.2, -4.3] as Point,
  },
} as const;

/** The tandem-rotor carrier. The load hangs with its jaw anchors at the carrier's own jaw anchors. */
export const AIR_CARRIER_ART = {
  id: "core:air_carrier",
  envelope: { min: [-3.6, 0, -7.4], max: [3.6, 3.4, 7.4] },
  rotorRadius: 3.55,
  rotors: [{ bone: "rotor_front", center: [0, 2.85, 3.84] as Point }, { bone: "rotor_rear", center: [0, 3.25, -3.84] as Point }],
  /** Where the trailer's origin sits under a hovering carrier with closed jaws. */
  load: [0, -(DECK + 1.65) + 0.25, 0] as Point,
  bones: ["chassis", "rotor_front", "rotor_rear", "clamp_front_left", "clamp_front_right", "clamp_rear_left", "clamp_rear_right"],
  anchors: {
    jaw_front_left: [1.17, 0.25, 3.52] as Point,
    jaw_front_right: [-1.17, 0.25, 3.52] as Point,
    jaw_rear_left: [1.17, 0.25, -3.52] as Point,
    jaw_rear_right: [-1.17, 0.25, -3.52] as Point,
    rotor_front: [0, 2.85, 3.84] as Point,
    rotor_rear: [0, 3.25, -3.84] as Point,
    landing: [0, 0, 0] as Point,
  },
} as const;

/** The expendable camera drone, flown from its nose camera. Nose along +Z. */
export const SURVEY_DRONE_ART = {
  id: "core:survey_drone",
  envelope: { min: [-0.55, 0, -0.62], max: [0.55, 0.32, 0.62] },
  impellers: [
    { bone: "impeller_1", at: [-0.36, 0.12, -0.36] as Point, turn: 1 },
    { bone: "impeller_2", at: [-0.36, 0.12, 0.235] as Point, turn: -1 },
    { bone: "impeller_3", at: [0.36, 0.12, -0.36] as Point, turn: -1 },
    { bone: "impeller_4", at: [0.36, 0.12, 0.235] as Point, turn: 1 },
  ],
  bones: ["chassis", "impeller_1", "impeller_2", "impeller_3", "impeller_4", "gimbal"],
  anchors: {
    camera: [0, 0.1, 0.58] as Point,
    payload: [0, 0.04, 0] as Point,
  },
} as const;
