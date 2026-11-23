import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters, type VehicleSeatPose } from "../../client/core/render/characters.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_PROP_L, B_PROP_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { B_HEAD, ZONE_HEAD } from "../../shared/anim/human.ts";
import { defaultLook, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { createOccupantSeat, OccupantBody, occupantSeat, poseSeated, seatOrigin } from "../../shared/anim/occupant.ts";
import { AnimState, HumanAnim, PITCH_STEPS } from "../../shared/anim/pose.ts";
import { footClearance, HEAD_MARGIN, headClearance, HIPS_DROP, RECLINE_MOST, seatFit } from "../../shared/anim/seat-fit.ts";
import { boneToModel, rayZones, Solved } from "../../shared/anim/skeleton.ts";
import { quatRotate, quatUnrotate } from "../../shared/math/quat.ts";
import { Rng } from "../../shared/rng.ts";
import { vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import type { Seat, SeatRoom } from "../../shared/sim/seats.ts";
import type { VehicleDefinition } from "../../shared/sim/vehicle.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { ACT_HOLD, HOLD_PISTOL, HOLD_RIFLE } from "../../shared/sim/weapon.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = frozenPack(), anim = new HumanAnim(pack.clips), reg = coreRegistry();
const frame = { x: 40, y: 3, z: 60, yaw: .7, pitch: .12, roll: -.2, steering: 0 };
/** Every look slider at one end: the largest body the client draws, or the smallest. */
function stretched(value: number | ((region: number) => number), rest: Float32Array): Float32Array {
  const look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3);
  for (let region = 0; region < REGION_COUNT; region++) setRegion(look, region, typeof value === "number" ? value : value(region));
  lookScales(look, scale, rest);
  return scale;
}
const bodies: { name: string; rest: Float32Array; scale: Float32Array | null }[] = [{ name: "default", rest: HUMAN.rest, scale: null }];
for (const rig of pack.header.rigs.filter((r) => r.id === "human_m" || r.id === "human_f")) {
  const rest = Float32Array.from(rig.rest);
  for (const value of [1, -1]) bodies.push({ name: `${rig.id} ${value > 0 ? "largest" : "smallest"}`, rest, scale: stretched(value, rest) });
}
/** The bodies, the rigs' own looks and some looks between the ends. */
const looks = [...bodies];
for (const rig of pack.header.rigs.filter((r) => r.id === "human_m" || r.id === "human_f")) {
  const rest = Float32Array.from(rig.rest), rng = new Rng(rig.id.length);
  looks.push({ name: `${rig.id} default`, rest, scale: null });
  for (let k = 0; k < 2; k++) {
    const values = Array.from({ length: REGION_COUNT }, () => rng.range(-1, 1));
    looks.push({ name: `${rig.id} look ${k}`, rest, scale: stretched((r) => values[r]!, rest) });
  }
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

/** A seated body drawn on `rest` stretched by `scale`, placed in the world as the client places it. */
function drawnSeated(sp: VehicleSeatPose, st: AnimState, rest: Float32Array, scale: Float32Array | null) {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), rotation = new Float64Array(4), origin = new Float64Array(3);
  const drop = poseSeated(anim, st, 30, sp, rest, scale, pose, solved, undefined, undefined, judged);
  const { side, ahead } = seatFit;
  vehicleRotation(sp, rotation);
  seatOrigin(solved, sp, drop, rotation, origin, rest, side, ahead);
  return { solved, drop, side, ahead, rotation, origin };
}
/** The middle of a solved head stretched by `scale`, in its body's frame. */
function middle(s: Solved, scale: Float32Array | null): number[] {
  const k = (a: number): number => (scale ? scale[B_HEAD * 3 + a]! : 1), out = [0, 0, 0];
  boneToModel(s, B_HEAD, ((HUMAN.capA[B_HEAD * 3]! + HUMAN.capB[B_HEAD * 3]!) / 2) * k(0), ((HUMAN.capA[B_HEAD * 3 + 1]! + HUMAN.capB[B_HEAD * 3 + 1]!) / 2) * k(1), ((HUMAN.capA[B_HEAD * 3 + 2]! + HUMAN.capB[B_HEAD * 3 + 2]!) / 2) * k(2), out);
  return out;
}
/** A point of a body's frame in the world: turned by `rotation` and moved to `origin`. */
function world(p: number[], rotation: Float64Array, origin: Float64Array): number[] {
  const out = new Float64Array(3);
  quatRotate(rotation, 0, p[0]!, p[1]!, p[2]!, out, 0);
  return [0, 1, 2].map((a) => out[a]! + origin[a]!);
}
const server = new OccupantBody(pack.header.rigs);
/** Where the server's body has the middle of its head in the world, as it judges a shot. */
function judgedHead(sp: VehicleSeatPose, st: AnimState): number[] {
  server.vehicle(anim, st, 30, sp, judged);
  const m = middle(server.solved, null), f = server.frame;
  return [0, 1, 2].map((a) => f[a]! + f[3 + a * 3]! * m[0]! + f[4 + a * 3]! * m[1]! + f[5 + a * 3]! * m[2]!);
}
const gazes = [-90, -66, 0, 66, 90].map((d) => (d * Math.PI) / 180);

test("a seated look's drawn head sits on the head that is shot, under its roof", () => {
  let tried = 0;
  for (const { def, seat } of enclosed()) for (const body of looks) for (const gaze of gazes) for (const action of [0, holds[2]!]) {
    const sp = seated(def, seat, frame.yaw + gaze), st = state(action), at = `${def.id} ${seat.id} ${body.name} ${gaze} ${action}`;
    const shot = judgedHead(sp, st), drawn = drawnSeated(sp, st, body.rest, body.scale);
    const head = world(middle(drawn.solved, body.scale), drawn.rotation, drawn.origin);
    expect(Math.hypot(head[0]! - shot[0]!, head[1]! - shot[1]!, head[2]! - shot[2]!), at).toBeLessThan(1e-6);
    expect(headClearance(drawn.solved, body.scale, seat.room, drawn.drop, drawn.side, drawn.ahead), at).toBeGreaterThanOrEqual(0);
    for (const foot of [B_FOOT_L, B_FOOT_R]) expect(footClearance(drawn.solved, body.scale, foot, seat.room, drawn.drop, drawn.side, drawn.ahead), at).toBeGreaterThanOrEqual(-1e-4);
    // The hips move only as far as a look moves a head.
    expect(Math.hypot(drawn.side, drawn.ahead), at).toBeLessThan(0.04);
    tried++;
  }
  expect(tried).toBeGreaterThan(1000);
});

test("a ray through a seated drawn head's middle picks the zone on the server it picks drawn", () => {
  /** Side rays through the drawn head within `share` of its reach: how many the drawn body and the server differ on, head or not. */
  const differ = (def: VehicleDefinition, seat: Seat, body: (typeof looks)[number], gaze: number, pitch: number, action: number, share: number): { rays: number; differ: number; lost: number } => {
    const sp = seated(def, seat, frame.yaw + gaze), st = state(action);
    st.pitch = Math.round((pitch / 90) * PITCH_STEPS);
    server.vehicle(anim, st, 30, sp, judged);
    const drawn = drawnSeated(sp, st, body.rest, body.scale), c = world(middle(drawn.solved, body.scale), drawn.rotation, drawn.origin);
    const s = (a: number): number => (body.scale ? body.scale[B_HEAD * 3 + a]! : 1), r = HUMAN.capR[B_HEAD]! * Math.max(s(0), s(1), s(2)) * share;
    const axis = (x: number, y: number, z: number): number[] => { const o = new Float64Array(3); quatRotate(drawn.rotation, 0, x, y, z, o, 0); return [...o]; };
    const across = axis(1, 0, 0), up = axis(0, 1, 0), fore = axis(0, 0, 1), local = new Float64Array(3), dir = new Float64Array(3);
    let rays = 0, count = 0, lost = 0;
    for (const way of [1, -1]) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      if (a * a + b * b > 4) continue;
      const p = [0, 1, 2].map((k) => c[k]! + (up[k]! * a + fore[k]! * b) * (r / 2) - across[k]! * way * 3);
      const d = across.map((v) => v * way);
      const atServer = server.ray(p[0]!, p[1]!, p[2]!, d[0]!, d[1]!, d[2]!, 10);
      quatUnrotate(drawn.rotation, 0, p[0]! - drawn.origin[0]!, p[1]! - drawn.origin[1]!, p[2]! - drawn.origin[2]!, local, 0);
      quatUnrotate(drawn.rotation, 0, d[0]!, d[1]!, d[2]!, dir, 0);
      const atDrawn = rayZones(HUMAN, drawn.solved, local[0]!, local[1]!, local[2]!, dir[0]!, dir[1]!, dir[2]!, 10);
      rays++;
      if ((atDrawn === ZONE_HEAD) !== (atServer === ZONE_HEAD)) count++;
      if (atDrawn === ZONE_HEAD && atServer !== ZONE_HEAD) lost++;
    }
    return { rays, differ: count, lost };
  };
  // The case a review found: the smallest woman in the Berlinetta's passenger seat, looking far aside either way.
  const berlinetta = enclosed().find((e) => e.id === "core:berlinetta" && e.seat.id === "passenger")!;
  const smallest = looks.find((b) => b.name === "human_f smallest")!;
  for (const gaze of [-66, 66]) {
    const sp = seated(berlinetta.def, berlinetta.seat, frame.yaw + (gaze * Math.PI) / 180);
    server.vehicle(anim, state(), 30, sp, judged);
    const drawn = drawnSeated(sp, state(), smallest.rest, smallest.scale), c = world(middle(drawn.solved, smallest.scale), drawn.rotation, drawn.origin);
    const side = new Float64Array(3);
    quatRotate(drawn.rotation, 0, 1, 0, 0, side, 0);
    for (const way of [1, -1]) expect(server.ray(c[0]! - side[0]! * way * 3, c[1]! - side[1]! * way * 3, c[2]! - side[2]! * way * 3, side[0]! * way, side[1]! * way, side[2]! * way, 10), `${gaze} ${way}`).toBe(ZONE_HEAD);
    const got = differ(berlinetta.def, berlinetta.seat, smallest, (gaze * Math.PI) / 180, 0, 0, 0.3);
    expect(got.lost).toBe(0);
  }
  // Over every seat, look, gaze, look up or down and hold: none for the hit body's own look. For others, an arm raised
  // to aim crosses the face where its own arms put it.
  let rays = 0, count = 0, lost = 0;
  for (const { def, seat } of enclosed()) for (const body of looks) for (const gaze of gazes) for (const pitch of [-60, 0, 60]) for (const action of holds) {
    const got = differ(def, seat, body, gaze, pitch, action, 0.3);
    if (body.name === "human_m default") expect(got.differ, `${def.id} ${seat.id} ${gaze} ${pitch} ${action}`).toBe(0);
    rays += got.rays; count += got.differ; lost += got.lost;
  }
  expect(rays).toBeGreaterThan(300000);
  expect(count / rays).toBeLessThan(0.02);
  // A head shot through what is drawn lost on the server: rarer still.
  expect(lost / rays).toBeLessThan(0.01);
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
