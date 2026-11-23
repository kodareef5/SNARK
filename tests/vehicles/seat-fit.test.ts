import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters, type VehicleSeatPose } from "../../client/core/render/characters.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_PROP_L, B_PROP_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { B_HEAD } from "../../shared/anim/human.ts";
import { defaultLook, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { createOccupantSeat, OccupantBody, occupantSeat, poseSeated } from "../../shared/anim/occupant.ts";
import { AnimState, HumanAnim } from "../../shared/anim/pose.ts";
import { footClearance, HEAD_MARGIN, headClearance, HIPS_DROP, RECLINE_MOST, seatFit } from "../../shared/anim/seat-fit.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import type { Seat, SeatRoom } from "../../shared/sim/seats.ts";
import type { VehicleDefinition } from "../../shared/sim/vehicle.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { ACT_HOLD, HOLD_PISTOL, HOLD_RIFLE } from "../../shared/sim/weapon.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = frozenPack(), anim = new HumanAnim(pack.clips), reg = coreRegistry();
const frame = { x: 40, y: 3, z: 60, yaw: .7, pitch: .12, roll: -.2, steering: 0 };
/** Every look slider at one end: the largest body the client draws, or the smallest. */
function stretched(value: number): Float32Array {
  const look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3);
  for (let region = 0; region < REGION_COUNT; region++) setRegion(look, region, value);
  lookScales(look, scale);
  return scale;
}
const bodies: { name: string; rest: Float32Array; scale: Float32Array | null }[] = [{ name: "default", rest: HUMAN.rest, scale: null }];
for (const rig of pack.header.rigs.filter((r) => r.id === "human_m" || r.id === "human_f")) {
  for (const value of [1, -1]) bodies.push({ name: `${rig.id} ${value > 0 ? "largest" : "smallest"}`, rest: Float32Array.from(rig.rest), scale: stretched(value) });
}
const holds = [0, (HOLD_PISTOL << 3) | ACT_HOLD, (HOLD_RIFLE << 3) | ACT_HOLD];
const enclosed = (): { id: string; def: VehicleDefinition; seat: Seat & { room: SeatRoom } }[] => reg.vehicle.flatMap((def, kind) =>
  (def?.seats ?? []).filter((seat): seat is Seat & { room: SeatRoom } => seat.room !== undefined).map((seat) => ({ id: reg.ids[kind]!, def: def!, seat })));

function seated(def: VehicleDefinition, seat: Seat, aimYaw?: number): VehicleSeatPose {
  const out = { ...createOccupantSeat(), wheelAngle: 0, steer: 0 } as VehicleSeatPose;
  occupantSeat(def, seat, frame, aimYaw, out);
  return out;
}
function state(action = 0): AnimState {
  const st = new AnimState();
  st.stance = STANCE_CROUCH; st.action = action;
  return st;
}
/** The pose's head clearance under the roof and its lowest foot's over the floor, in metres. */
function room(seat: Seat & { room: SeatRoom }, rest: Float32Array, scale: Float32Array | null, action = 0, def?: VehicleDefinition, fitted = true) {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), host = def ?? reg.vehicle.find((d) => d?.seats.includes(seat))!;
  const drop = poseSeated(anim, state(action), 30, seated(host, fitted ? seat : { ...seat, room: undefined }), rest, scale, pose, solved);
  return { drop, solved, head: headClearance(solved, scale, seat.room, drop), feet: Math.min(...[B_FOOT_L, B_FOOT_R].map((f) => footClearance(solved, scale, f, seat.room, drop))) };
}

/** The rest joints hits are judged on for a body of a rig: the male rig's, unstretched (server/combat.ts occupant.rest). */
const judged = Float32Array.from(pack.header.rigs.find((r) => r.id === "human_m")!.rest);

test("every enclosed seat keeps a judged body under its roof and on its floor", () => {
  const all = enclosed();
  expect(all.length).toBeGreaterThan(30);
  for (const { id, seat } of all) for (const rest of [HUMAN.rest, judged]) for (const action of holds) {
    const { head, feet } = room(seat, rest, null, action);
    expect(head, `${id} ${seat.id} hold ${action}`).toBeGreaterThanOrEqual(-1e-4);
    expect(feet, `${id} ${seat.id} hold ${action}`).toBeGreaterThanOrEqual(-1e-4);
  }
});

test("a body drawn with any look keeps its head within 9 cm of the head that is shot", () => {
  let worst = 0, deepest = 0;
  for (const { seat } of enclosed()) for (const body of bodies.slice(1)) for (const action of holds) {
    const host = reg.vehicle.find((d) => d?.seats.includes(seat))!;
    const shot = new Pose(HUMAN_BONES), shotSolved = new Solved(HUMAN_BONES), drawn = new Pose(HUMAN_BONES), drawnSolved = new Solved(HUMAN_BONES);
    const d1 = poseSeated(anim, state(action), 30, seated(host, seat), judged, null, shot, shotSolved);
    const d2 = poseSeated(anim, state(action), 30, seated(host, seat), body.rest, body.scale, drawn, drawnSolved, undefined, undefined, judged);
    // Each head from its hips' joint, which the seat pins at its anchor less the drop.
    const at = (s: Solved, d: number) => [s.pos[B_HEAD * 3]! - s.pos[0]!, s.pos[B_HEAD * 3 + 1]! - s.pos[1]! - d, s.pos[B_HEAD * 3 + 2]! - s.pos[2]!];
    const a = at(shotSolved, d1), b = at(drawnSolved, d2);
    worst = Math.max(worst, Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!));
    // It sinks a little more where its own head would clip the roof, but never leans further: the largest look may
    // still touch the lowest roofs, whose seats sit high in the art.
    deepest = Math.min(deepest, headClearance(drawnSolved, body.scale, seat.room, d2));
  }
  expect(worst).toBeLessThan(0.09);
  expect(deepest).toBeGreaterThan(-0.04);
});

test("Zephyr and Veloce seats fit a default body under the roof and on the floor", () => {
  for (const vehicle of ["core:zephyr", "core:veloce"]) {
    const seats = enclosed().filter((e) => e.id === vehicle);
    expect(seats.map((s) => s.seat.id)).toEqual(["driver", "passenger"]);
    for (const { def, seat } of seats) for (const action of holds) {
      const before = room(seat, HUMAN.rest, null, action, def, false), after = room(seat, HUMAN.rest, null, action, def);
      // As posed, the soles hang through the footwell floor; the Zephyr's roof also cuts the head.
      expect(before.feet).toBeLessThan(-.05);
      if (vehicle === "core:zephyr" && seat.driver) expect(before.head).toBeLessThan(-.1);
      expect(after.head, `${vehicle} ${seat.id} ${action}`).toBeGreaterThanOrEqual(Math.min(before.head, HEAD_MARGIN) - 1e-4);
      expect(after.head).toBeGreaterThanOrEqual(0);
      expect(after.feet).toBeGreaterThanOrEqual(-1e-4);
      expect(after.feet).toBeLessThan(.01);
    }
  }
  // The Zephyr's low canopy sinks its driver's hips, takes the back to the chest's limit, and sinks them on.
  const zephyr = enclosed().find((e) => e.id === "core:zephyr" && e.seat.driver)!;
  room(zephyr.seat, HUMAN.rest, null, 0, zephyr.def);
  expect(seatFit.recline).toBeCloseTo(RECLINE_MOST, 6);
  expect(seatFit.drop).toBeGreaterThan(HIPS_DROP);
  expect(seatFit.head).toBe(0);
  // The Veloce's roof wants only a few centimetres, which the cushion gives without a recline.
  const veloce = enclosed().find((e) => e.id === "core:veloce" && e.seat.driver)!;
  room(veloce.seat, HUMAN.rest, null, 0, veloce.def);
  expect(seatFit.recline).toBe(0);
  expect(seatFit.drop).toBeGreaterThan(0);
  expect(seatFit.drop).toBeLessThanOrEqual(HIPS_DROP);
});

test("the server's and the client's seated eye agree to a nanometre in every seat", () => {
  const characters = new Characters(reg, pack, new Assets(reg, pack)), server = new OccupantBody(pack.header.rigs);
  const survivor = reg.index.get("core:survivor")!, mesh = reg.defs[survivor]!.type === "species" ? (reg.defs[survivor] as { mesh: string }).mesh : "";
  const client = new Float64Array(3), authority = new Float64Array(3);
  for (const { def, seat } of enclosed()) for (const aimYaw of [undefined, frame.yaw + .4]) {
    const pose = seated(def, seat, aimYaw), st = state((HOLD_PISTOL << 3) | ACT_HOLD);
    expect(characters.seatedEye(survivor, pose, client, st, 30)).toBe(true);
    server.vehicle(anim, st, 30, pose, server.rest(mesh));
    server.eye(authority);
    // The same pose; the client turns the eye by a quaternion and the server by its rows, which differ in the last bits.
    expect(Math.max(...[0, 1, 2].map((k) => Math.abs(client[k]! - authority[k]!))), `${def.id} ${seat.id}`).toBeLessThan(1e-9);
  }
});

test("hands still reach their controls when a low roof reclines the body", () => {
  let tried = 0;
  for (const def of reg.vehicle) for (const seat of def?.seats ?? []) {
    if (!seat.controls) continue;
    // A roof just over the anchor forces the back over and the hips down before the hands go to the controls.
    const low = { ...seat, room: { roof: [.62, 0, 0], floor: [-.9, 0], seat: 0 } } as Seat & { room: SeatRoom };
    const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), occupant = seated(def!, low);
    const drop = poseSeated(anim, state(), 30, occupant, HUMAN.rest, null, pose, solved);
    expect(seatFit.recline, `${def!.id} ${seat.id}`).toBeGreaterThan(0);
    expect(drop).toBe(seatFit.drop);
    for (const [prop, grip] of [[B_PROP_L, seat.controls.left], [B_PROP_R, seat.controls.right]] as const) {
      const gap = Math.hypot(...[0, 1, 2].map((k) => solved.pos[prop * 3 + k]! - solved.pos[k]! - (grip[k]! - seat.anchor[k]! + (k === 1 ? drop : 0))));
      expect(gap, `${def!.id} ${seat.id}`).toBeLessThan(.001);
    }
    tried++;
  }
  expect(tried).toBeGreaterThan(5);
});

test("a seat that the body already fits leaves its pose exactly as posed", () => {
  const van = enclosed().find((e) => e.id === "core:panel_van" && e.seat.driver)!;
  const fitted = room(van.seat, HUMAN.rest, null, 0, van.def);
  expect(seatFit.recline).toBe(0);
  expect(fitted.drop).toBe(0);
  const plain = room(van.seat, HUMAN.rest, null, 0, van.def, false);
  expect([...fitted.solved.pos]).toEqual([...plain.solved.pos]);
});
