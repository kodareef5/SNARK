// The XF-51's art as the simulation is fitted to it: content/vehicles/jet-rig.json is measured from the model by
// assets/source/core/vehicles/jet/convert.py, and the boxes below from the model's parts. Metres; +Y up, +Z forward, +X
// the pilot's left; the origin on the ground under the middle of the wheels.
import rig from "./jet-rig.json" with { type: "json" };

type Point = readonly [number, number, number];
const point = (v: readonly number[]): Point => [v[0]!, v[1]!, v[2]!];
const plus = (a: Point, x: number, y: number, z: number): Point => [a[0] + x, a[1] + y, a[2] + z];

const p = rig.pivots, a = rig.anchors;
const seat = point(a.seat_pilot);

export const JET_ART = {
  id: "core:jet",
  envelope: { min: point(rig.envelope.min), max: point(rig.envelope.max) },
  /** The belly's lowest point, the top of the fins, and the reach of the wing and the tailplanes. */
  belly: .83,
  top: 3.53,
  halfWidth: 5.15,
  halfLength: 7.8,
  /** The wheels: the nose wheel's middle ahead and the mains' behind, the mains' half track, and each wheel's radius. */
  noseGear: p.wheel_nose[2]!,
  mainGear: (p.wheel_main_left[2]! + p.wheel_main_right[2]!) / 2,
  gearTrack: (p.wheel_main_left[0]! - p.wheel_main_right[0]!) / 2,
  noseWheel: p.wheel_nose[1]!,
  mainWheel: (p.wheel_main_left[1]! + p.wheel_main_right[1]!) / 2,
  seat,
  /** Where the pilot climbs in, beside the cockpit and ahead of the wing. */
  entry: point([a.approach_left[0]!, 0, seat[2]]),
  camera: point(a.camera_pilot),
  /** The throttle under the left hand and the stick under the right, from the seat. */
  throttle: plus(seat, .28, .2, .22),
  stick: plus(seat, -.14, .26, .32),
  muzzle: point(a.muzzle),
  rail: point(a.rail),
  exhaust: point(a.exhaust),
  /** Fuselage, spine, nose, canopy, wing, tailplanes and the twin fins, from the model's parts. */
  bodyBoxes: [
    { at: [0, 1.45, -1.4], half: [1.45, .6, 4.8] },
    { at: [0, 2.45, .6], half: [.55, .45, 2.8] },
    { at: [0, 1.85, 4.6], half: [.55, .7, 1.25] },
    { at: [0, 2.64, 4.38], half: [.5, .36, 1] },
    { at: [0, 1.83, -3.1], half: [5.15, .22, 1.6] },
    { at: [0, 2.03, -6.2], half: [3.5, .08, 1.6] },
    { at: [1.85, 2.75, -6.6], half: [.4, .78, 1.15] },
    { at: [-1.85, 2.75, -6.6], half: [.4, .78, 1.15] },
  ] as readonly { readonly at: Point; readonly half: Point }[],
  /** The bones that move, by name, and the one each hangs from. */
  bones: Object.keys(p),
  parents: rig.parents as Readonly<Record<string, string>>,
  pivots: Object.fromEntries(Object.entries(p).map(([name, v]) => [name, point(v)])) as Readonly<Record<string, Point>>,
};
