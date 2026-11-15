import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters, type VehicleSeatPose } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket, InstanceWriter } from "../../client/core/render/packet.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { B_HEAD, B_HIPS, B_PROP_R, B_SPINE, HUMAN, HUMAN_BONES, SLOT_NAMES, SLOT_TORSO } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_SKIN, LOOK_REGIONS } from "../../shared/anim/look.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette, SKIN_BASE } from "../../shared/pack/palette.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { boxMesh, buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

// A small exact fixture exercises real body bindings, proportions and equipment without building any art library.
const rest = Float32Array.from(HUMAN.rest, (n, i) => i % 3 === 1 ? n * 1.13 : n);
const humanRig: PackRig = { id: "test:proportions", skeleton: HUMAN.id, rest: [...rest] };
const carRig: PackRig = {
  id: "urban:compact", skeleton: "urban:compact",
  names: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right", "door_left", "door_right"],
  parent: [-1, 0, 0, 0, 0, 0, 0],
  rest: [0, 0, 0, .78, .3, 1.25, -.78, .3, 1.25, .78, .3, -1.25, -.78, .3, -1.25, .84, .76, .65, -.84, .76, .65],
  sockets: [
    { name: "seat_driver", bone: 0, x: .42, y: .59, z: .12 },
    { name: "seat_front_passenger", bone: 0, x: -.42, y: .59, z: .12 },
  ],
};
function mesh(id: string, bone: number, skeleton = HUMAN.id, rig = humanRig.id): SourceMesh {
  const lod = boxMesh([.04, .04, .04], 16);
  lod.bones = new Uint8Array(lod.positions.length / 3).fill(bone);
  return { id, skeleton, rig, lods: [lod] };
}
const sources = SLOT_NAMES.map((part, i) => mesh(`core:human_m/${part}`, i === 0 ? B_HEAD : B_HIPS));
sources.push(mesh("core:human_m/armor/cloth/torso", B_SPINE), mesh("core:rifle", B_PROP_R));
sources.push(mesh("urban:compact", 0, carRig.skeleton, carRig.id));
const pack = parsePack(buildPack(sources, defaultPalette(), [], [humanRig, carRig]));
const reg = coreRegistry();
const survivor = reg.index.get("core:survivor")!;
const compact = reg.index.get("urban:compact")!;
const colors = new Uint8Array(6);

function fixture() {
  const assets = new Assets(reg, pack), characters = new Characters(reg, pack, assets), packet = new FramePacket();
  characters.begin();
  return { characters, packet };
}
function transform(packet: FramePacket, bone: number, point: ArrayLike<number>): number[] {
  const out = [0, 0, 0], rows = packet.bones, k = bone * BONE_FLOATS;
  for (let i = 0; i < 3; i++) out[i] = rows[k + i * 4]! * point[0]! + rows[k + i * 4 + 1]! * point[1]! + rows[k + i * 4 + 2]! * point[2]! + rows[k + i * 4 + 3]!;
  return out;
}
function close(a: ArrayLike<number>, b: ArrayLike<number>): void { for (let i = 0; i < 3; i++) expect(a[i]!).toBeCloseTo(b[i]!, 5); }
const seat: VehicleSeatPose = { x: 4, y: 2, z: 8, yaw: .7, pitch: .2, roll: -.15, steering: .25, wheelAngle: 1.2, driver: false, aimYaw: .7 };

test("seated survivors retain real body bindings, proportions, appearance and equipped meshes", () => {
  const { characters, packet } = fixture();
  const look = defaultLook(), gear = new Uint16Array(GEAR_COUNT), state = new AnimState();
  look[LOOK_SKIN] = 6;
  look[LOOK_REGIONS + 13] = 100;
  gear[GEAR_HELD] = reg.index.get("core:rifle")!;
  gear[GEAR_WORN + SLOT_TORSO] = reg.index.get("core:cloth_shirt")!;
  expect(characters.add(packet, survivor, 0, 0, 0, 0, state, 12, look, 0, colors, 0, gear, 0, 7, false, false, 1, false, false, undefined, seat)).toBe(true);
  expect(packet.boneCount).toBe(HUMAN_BONES);
  close(transform(packet, B_HIPS, rest.subarray(0, 3)), [seat.x, seat.y, seat.z]);
  const drawn: string[] = [];
  characters.flush(packet, new InstanceWriter(packet.transient), false, m => drawn.push(pack.header.meshes[m]!.id));
  expect(drawn).toContain("core:human_m/head");
  expect(drawn).toContain("core:human_m/armor/cloth/torso");
  expect(drawn).toContain("core:rifle");
  expect(drawn).not.toContain("core:human_m/torso");
  expect([...packet.transient.subarray(0, packet.transientCount * 20)]).toContain(SKIN_BASE + 6);
  expect([...packet.bones.subarray(0, packet.boneCount * BONE_FLOATS)].every(Number.isFinite)).toBe(true);
});

test("passenger aim changes the upper body while the actual pelvis stays on the seat", () => {
  const a = fixture(), b = fixture();
  for (const [f, aimYaw] of [[a, seat.yaw], [b, seat.yaw + .9]] as const) {
    f.characters.add(f.packet, survivor, 0, 0, 0, 0, new AnimState(), 3, defaultLook(), 0, colors, 0, null, 0, 7, false, false, 1, false, false, undefined, { ...seat, aimYaw });
    close(transform(f.packet, B_HIPS, rest.subarray(0, 3)), [seat.x, seat.y, seat.z]);
  }
  expect([...a.packet.bones.subarray(B_HEAD * BONE_FLOATS, (B_HEAD + 1) * BONE_FLOATS)]).not.toEqual([...b.packet.bones.subarray(B_HEAD * BONE_FLOATS, (B_HEAD + 1) * BONE_FLOATS)]);
});

test("native car chassis and both seat sockets share full attitude; steering affects only front wheels", () => {
  const { characters, packet } = fixture(), state = new AnimState(), out = [0, 0, 0], expected = [0, 0, 0];
  const frame = { ...seat, x: 2, y: 3, z: 4, yaw: .8 };
  expect(characters.vehicle(compact)).toBe(true);
  for (const slot of [1, 2]) {
    expect(characters.seat(compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, out, slot, frame)).toBe(true);
    vehiclePoint(frame, [slot === 1 ? .42 : -.42, .59, .12], expected);
    close(out, expected);
  }
  characters.add(packet, compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, null, 0, colors, 0, null, 0, 9, false, false, 1, false, false, frame);
  vehiclePoint(frame, [0, 1, 0], expected);
  close(transform(packet, 0, [0, 1, 0]), expected);
  expect(packet.boneCount).toBe(7);
  const front = packet.bones.subarray(BONE_FLOATS, BONE_FLOATS + 3), rear = packet.bones.subarray(3 * BONE_FLOATS, 3 * BONE_FLOATS + 3);
  expect([...front]).not.toEqual([...rear]);
});

test("vehicle chase camera keeps mouse look, eases idle heading, and collision pulls it out of a wall", () => {
  const view = new Viewpoint(), cam = new Camera();
  let yaw = .8;
  for (let i = 0; i < 10; i++) yaw = view.placeVehicle(cam, null, 64, 1, 64, yaw, 0, 0, 12, 100);
  expect(yaw).toBe(.8);
  for (let i = 0; i < 30; i++) yaw = view.placeVehicle(cam, null, 64, 1, 64, yaw, 0, 0, 12, 100);
  expect(yaw).toBeGreaterThan(0);
  expect(yaw).toBeLessThan(.3);
  yaw = view.placeVehicle(cam, null, 64, 1, 64, 1.4, .2, 0, 12, 100);
  expect(yaw).toBe(1.4);
  const world = flatWorld();
  view.placeVehicle(cam, world, 64, 1, 64, 0, 0, 0, 0, 16);
  expect(cam.z).toBeLessThan(59);
  world.structs.add(world.kind("core:wall"), 64, 1.5, 62.9, 0, 0, 1);
  view.placeVehicle(cam, world, 64, 1, 64, 0, 0, 0, 0, 16);
  expect(cam.z).toBeGreaterThan(63);
  expect(cam.z).toBeLessThan(64);
});
