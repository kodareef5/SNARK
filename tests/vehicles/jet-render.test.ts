// The jet's moving parts as drawn (client/core/render/jet-parts.ts): the gear folds over its seconds once the wheels are
// up, the nozzle and the lift fan's doors swing with VTOL, and the surfaces follow how the jet turns.
import { expect, test } from "bun:test";
import rig from "../../content/vehicles/jet-rig.json" with { type: "json" };
import { DOOR_OPEN, GEAR_FOLD, JetParts, jetPoseOf, jetRig, NOZZLE_DOWN, SURFACE_MOST, type JetPose } from "../../client/core/render/jet-parts.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { camp, drawn, look, screen, vehicle } from "../kit/kit.ts";

const names = Object.keys(rig.pivots), bones = jetRig(names);
/** The angle of bone `b`'s local turn in `rot`, signed by the axis it is about. */
const angle = (rot: Float64Array, b: number, axis: number): number => 2 * Math.atan2(rot[b * 4 + axis]!, rot[b * 4 + 3]!);
const pose = (o: Partial<JetPose> = {}): JetPose => ({ gear: 1, nozzle: 0, wheelAngle: 0, qx: 0, qy: 0, qz: 0, qw: 1, burner: false, ...o });

test("every moving bone the renderer works is in the model's rig", () => {
  expect(Object.entries(bones).filter(([, b]) => b < 0)).toEqual([]);
});

test("the gear folds up over its seconds once the wheels are up, and comes down again", () => {
  const parts = new JetParts(), rot = new Float64Array(names.length * 4);
  parts.pose(rot, bones, 7, pose(), 0);
  expect(angle(rot, bones.gearNose, 0)).toBeCloseTo(0, 6);
  const frames = (from: number, to: number, gear: number): void => { for (let f = from * 60 + 1; f <= to * 60; f++) parts.pose(rot, bones, 7, pose({ gear }), f / 60 * TICK_RATE); };
  frames(0, 1.5, 0);
  expect(parts.last.gear).toBeCloseTo(.5, 3);
  frames(1.5, 4, 0);
  expect(parts.last.gear).toBe(0);
  expect(angle(rot, bones.gearNose, 0)).toBeCloseTo(-GEAR_FOLD, 4);
  expect(angle(rot, bones.gearLeft, 2)).toBeCloseTo(GEAR_FOLD, 4);
  expect(angle(rot, bones.gearRight, 2)).toBeCloseTo(-GEAR_FOLD, 4);
  frames(4, 5, 1);
  expect(parts.last.gear).toBeCloseTo(1 / 3, 3);
});

test("the nozzle swings down and the lift fan's doors open with VTOL, and the wheels roll", () => {
  const parts = new JetParts(), rot = new Float64Array(names.length * 4);
  parts.pose(rot, bones, 1, pose({ nozzle: 1, wheelAngle: .7 }), 0);
  expect(angle(rot, bones.nozzle, 0)).toBeCloseTo(NOZZLE_DOWN, 4);
  expect(angle(rot, bones.doorTop, 0)).toBeCloseTo(DOOR_OPEN, 4);
  expect(angle(rot, bones.doorBottom, 0)).toBeCloseTo(DOOR_OPEN, 4);
  expect(angle(rot, bones.wheelLeft, 0)).toBeCloseTo(.7, 4);
  parts.pose(rot, bones, 1, pose({ nozzle: .5 }), 1);
  expect(angle(rot, bones.nozzle, 0)).toBeCloseTo(NOZZLE_DOWN / 2, 4);
});

test("a roll throws the flaperons against each other, a pull the stabilators together, within their travel", () => {
  const parts = new JetParts(), rot = new Float64Array(names.length * 4), q = new Float64Array(4);
  // Rolling at half a radian a second about the nose, for a second at sixty frames.
  for (let f = 0; f <= 60; f++) {
    quatAxis(q, 0, 0, 0, 1, f / 120);
    parts.pose(rot, bones, 2, pose({ qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! }), f / 60 * TICK_RATE);
  }
  expect(parts.last.roll).toBeCloseTo(.25, 2);
  expect(angle(rot, bones.aileronLeft, 0)).toBeCloseTo(-angle(rot, bones.aileronRight, 0), 6);
  expect(Math.abs(parts.last.pitch) + Math.abs(parts.last.yaw)).toBeLessThan(1e-3);
  // A hard pull past the stabilators' travel.
  const pull = new JetParts();
  for (let f = 0; f <= 60; f++) {
    quatAxis(q, 0, 1, 0, 0, -3 * f / 60);
    pull.pose(rot, bones, 3, pose({ qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! }), f / 60 * TICK_RATE);
  }
  expect(pull.last.pitch).toBeCloseTo(SURFACE_MOST, 3);
  expect(angle(rot, bones.stabilatorLeft, 0)).toBeCloseTo(angle(rot, bones.stabilatorRight, 0), 6);
});

test("a jet's pose is read from how it is drawn: gear and burner from its drive word, nozzle from its rotor word", () => {
  const out = pose();
  jetPoseOf({ gear: 0, shifting: true, rotorPhase: .4, wheelAngle: 1, qx: 0, qy: 0, qz: 0, qw: 1 }, 0, out);
  expect([out.gear, out.burner, out.nozzle, out.wheelAngle]).toEqual([0, true, .4, 1]);
  jetPoseOf({ wheelAngle: 0 }, Math.PI, out);
  expect([out.gear, out.burner, out.nozzle]).toEqual([1, false, 0]);
  expect(out.qy).toBeCloseTo(1, 6);
});

artTest("a parked jet is drawn with its own model, and its parts are posed for it", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const jet = vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0 });
  look(h, ada, jet.e);
  h.run(500);
  expect(drawn(view, "core:jet")).toBeGreaterThan(0);
  const parts = view.app.scene!.characters.jetParts;
  // Parked with its wheels down and its nozzle swung for VTOL.
  expect(parts.last.gear).toBe(1);
});
