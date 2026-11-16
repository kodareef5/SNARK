import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters, type VehicleSeatPose } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket, InstanceWriter } from "../../client/core/render/packet.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { buildHud, KEY_VEHICLE } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { B_HEAD, B_HIPS, B_PROP_R, B_SPINE, HUMAN, HUMAN_BONES, SLOT_NAMES, SLOT_TORSO } from "../../shared/anim/human.ts";
import { defaultLook, LOOK_SKIN, LOOK_REGIONS } from "../../shared/anim/look.ts";
import { AnimState, PITCH_STEPS } from "../../shared/anim/pose.ts";
import { quatRotate, quatUnrotate } from "../../shared/math/quat.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette, SKIN_BASE } from "../../shared/pack/palette.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { vehiclePoint, vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import { Body } from "../../shared/sim/character.ts";
import { boxMesh, buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

// A small exact fixture exercises real body bindings, proportions and equipment without building any art library.
const rest = Float32Array.from(HUMAN.rest, (n, i) => i % 3 === 1 ? n * 1.13 : n);
const humanRig: PackRig = { id: "test:proportions", skeleton: HUMAN.id, rest: [...rest] };
const carRig: PackRig = {
  id: "core:compact", skeleton: "core:compact",
  names: ["chassis", "wheel_front_left", "wheel_front_right", "wheel_rear_left", "wheel_rear_right", "door_left", "door_right", "steering_wheel"],
  parent: [-1, 0, 0, 0, 0, 0, 0, 0],
  rest: [0, 0, 0, .78, .3, 1.25, -.78, .3, 1.25, .78, .3, -1.25, -.78, .3, -1.25, .84, .76, .65, -.84, .76, .65, .42, .89, .55],
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
sources.push(mesh("core:compact", 0, carRig.skeleton, carRig.id));
const pack = parsePack(buildPack(sources, defaultPalette(), [], [humanRig, carRig]));
const reg = coreRegistry();
const survivor = reg.index.get("core:survivor")!;
const compact = reg.index.get("core:compact")!;
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
const seat: VehicleSeatPose = { x: 4, y: 2, z: 8, yaw: .7, pitch: .2, roll: -.15, steering: .25, wheelAngle: 1.2, driver: false, aimYaw: .7, steer: .25 / .55 };

test("seated survivors retain real body bindings, proportions, appearance and equipped meshes", () => {
  const { characters, packet } = fixture();
  const look = defaultLook(), gear = new Uint16Array(GEAR_COUNT), state = new AnimState();
  look[LOOK_SKIN] = 6;
  look[LOOK_REGIONS + 13] = 100;
  gear[GEAR_HELD] = reg.index.get("core:rifle")!;
  gear[GEAR_WORN + SLOT_TORSO] = reg.index.get("core:cloth_shirt")!;
  expect(characters.add(packet, survivor, 0, 0, 0, 0, state, 12, look, 0, colors, 0, gear, 0, 7, false, false, 1, false, false, null, 0, undefined, seat)).toBe(true);
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
    f.characters.add(f.packet, survivor, 0, 0, 0, 0, new AnimState(), 3, defaultLook(), 0, colors, 0, null, 0, 7, false, false, 1, false, false, null, 0, undefined, { ...seat, aimYaw });
    close(transform(f.packet, B_HIPS, rest.subarray(0, 3)), [seat.x, seat.y, seat.z]);
  }
  expect([...a.packet.bones.subarray(B_HEAD * BONE_FLOATS, (B_HEAD + 1) * BONE_FLOATS)]).not.toEqual([...b.packet.bones.subarray(B_HEAD * BONE_FLOATS, (B_HEAD + 1) * BONE_FLOATS)]);
});

test("native car chassis and both seat sockets share full attitude; steering affects only front wheels", () => {
  const { characters, packet } = fixture(), state = new AnimState(), out = new Float64Array(12), expected = [0, 0, 0];
  const frame = { ...seat, x: 2, y: 3, z: 4, yaw: .8 };
  expect(characters.vehicle(compact)).toBe(true);
  for (const slot of [1, 2]) {
    expect(characters.seat(compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, out, slot, frame)).toBe(true);
    vehiclePoint(frame, [slot === 1 ? .42 : -.42, .59, .12], expected);
    close(out, expected);
  }
  characters.add(packet, compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, null, 0, colors, 0, null, 0, 9, false, false, 1, false, false, null, 0, frame);
  vehiclePoint(frame, [0, 1, 0], expected);
  close(transform(packet, 0, [0, 1, 0]), expected);
  expect(packet.boneCount).toBe(8);
  const front = packet.bones.subarray(BONE_FLOATS, BONE_FLOATS + 3), rear = packet.bones.subarray(3 * BONE_FLOATS, 3 * BONE_FLOATS + 3);
  expect([...front]).not.toEqual([...rear]);
});

test("suspension holds all wheel hubs on the support plane while chassis, occupants and doors follow the sprung body", () => {
  const { characters, packet } = fixture(), state = new AnimState(), expected = [0, 0, 0];
  const frame = { ...seat, pitch: -.12, roll: .18, rideOffset: .09, groundPitch: .08, groundRoll: -.04, grounded: true, doors: 0xffff };
  characters.add(packet, compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, null, 0, colors, 0, null, 0, 9, false, false, 1, false, false, null, 0, frame);
  for (const wheel of [1, 2, 3, 4]) {
    const pivot = carRig.rest.slice(wheel * 3, wheel * 3 + 3);
    vehiclePoint({ ...frame, y: frame.y - frame.rideOffset, pitch: frame.groundPitch, roll: frame.groundRoll }, pivot, expected);
    close(transform(packet, wheel, pivot), expected);
  }
  vehiclePoint(frame, [0, 1, 0], expected);
  close(transform(packet, 0, [0, 1, 0]), expected);
  // Both door hinges remain attached; their trailing edges swing away from the cabin on the correct sides.
  for (const door of [5, 6]) {
    const pivot = carRig.rest.slice(door * 3, door * 3 + 3);
    vehiclePoint(frame, pivot, expected);
    close(transform(packet, door, pivot), expected);
  }
  const closed = fixture();
  closed.characters.add(closed.packet, compact, frame.x, frame.y, frame.z, frame.yaw, state, 2, null, 0, colors, 0, null, 0, 9, false, false, 1, false, false, null, 0, { ...frame, doors: 0, steering: 0 });
  expect(transform(packet, 5, [.84, .76, -.35])).not.toEqual(transform(closed.packet, 5, [.84, .76, -.35]));
  expect(transform(packet, 7, [.42, 1.05, .55])).not.toEqual(transform(closed.packet, 7, [.42, 1.05, .55]));
});

test("camera target damping is frame-rate independent and snaps safely across a teleport", () => {
  const sixty = new Viewpoint(), thirty = new Viewpoint(), a = new Camera(), b = new Camera();
  for (const [v, c, step] of [[sixty, a, 1000 / 60], [thirty, b, 1000 / 30]] as const) {
    v.placeVehicle(c, null, 0, 1, 0, 0, 0, 0, 0, step, false);
    v.placeVehicle(c, null, 1, 1, 0, 0, 0, 0, 0, step, false);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(.2);
    for (let t = step; t < 500 - .1; t += step) v.placeVehicle(c, null, 1, 1, 0, 0, 0, 0, 0, step, false);
  }
  close([a.x, a.y, a.z], [b.x, b.y, b.z]);
  sixty.placeVehicle(a, null, 100, 1, 0, 0, 0, 0, 0, 16, false);
  expect(a.x).toBe(100);
});

test("driving instruments read mechanical gear/RPM, including neutral, and never invent a speed-based shift", () => {
  const v = new VehicleTelemetry(), b = new Body(), definition = reg.vehicle[compact]!;
  if (definition.movement === 'rotor' || definition.movement === 'boat') throw new Error('compact telemetry requires its wheeled controller');
  const spec = definition.spec;
  b.vehicle = b.grounded = true; b.fuel = spec.fuelCapacity;
  b.vehicleGear = 2; b.vehicleRpm = 3700; b.vz = 35;
  v.update(4, b, 1, false, spec, 16);
  expect(v.gear).toBe(2); expect(v.rpm).toBe(3700); expect(v.load).toBe(1);
  b.vehicleShiftTime = spec.drivetrain!.shiftCooldown; v.update(4, b, 1, false, spec, 16);
  expect(v.load).toBe(.35);
  b.vehicleShiftTime = .1; v.update(4, b, 1, false, spec, 16);
  expect(v.load).toBe(1); expect(v.redline).toBe(spec.drivetrain!.redlineRpm);
  v.update(4, b, -1, false, spec, 16);
  expect(v.brake).toBe(1);
  b.vehicleGear = 0; b.vehicleRpm = 850; v.update(4, b, 0, false, spec, 16);
  expect(v.gear).toBe(0); expect(v.rpm).toBe(850);
  b.vehicleGear = -1; b.vz = -3; v.update(4, b, -1, false, spec, 16);
  expect(v.gear).toBe(-1); expect(v.brake).toBe(0);
  b.vx = 4; b.vz = 10; v.update(4, b, 1, true, spec, 16);
  expect(v.slip).toBeGreaterThan(.5);
  b.grounded = false; v.update(4, b, 1, true, spec, 16);
  expect(v.slip).toBe(0);
  b.fuel = 0; v.update(4, b, 1, false, spec, 16);
  expect(v.load).toBe(0);
  v.stop(); expect(v.active).toBe(false); expect(v.rpm).toBe(0);
});

test("driving instruments fit wide and portrait native HUDs without requiring a hotbar", () => {
  const hud = new HudModel(), f = new UiFrame(), v = new VehicleTelemetry();
  v.active = true; v.speed = 12; v.gear = 3; v.rpm = 3400; v.fuel = .72;
  hud.vehicle = v;
  for (const aspect of [16 / 9, 9 / 16]) {
    f.begin(aspect); buildHud(f, hud);
    const gauges = f.nodes.slice(0, f.count).filter(n => n.key >= KEY_VEHICLE && n.key < KEY_VEHICLE + 8);
    expect(gauges.length).toBe(8);
    for (const n of gauges) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThan(f.height); }
    expect(gauges.map(n => n.text)).toContain("D3");
    expect(gauges.map(n => n.text)).toContain("Fuel 72%");
  }
});

test("a vehicle's chase camera stands back by its size: a bus's boom is longer than a car's", () => {
  const back = (boom: number): number => {
    const view = new Viewpoint(), cam = new Camera();
    view.placeVehicle(cam, null, 64, 1, 64, 0, 0, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 1, boom });
    return Math.hypot(cam.x - 64, cam.z - 64);
  };
  expect(back(12)).toBeGreaterThan(back(6) * 1.8);
  expect(back(6)).toBeGreaterThan(5);
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

test("an inverted enclosed passenger keeps a seated pelvis and stows held equipment even when a rigid LOD is requested", () => {
  const { characters, packet } = fixture(), look = defaultLook(), gear = new Uint16Array(GEAR_COUNT);
  gear[GEAR_HELD] = reg.index.get("core:rifle")!;
  const enclosed: VehicleSeatPose = { ...seat, role: "cabin", weapons: false, qx: 0, qy: 0, qz: 1, qw: 0 };
  expect(characters.add(packet, survivor, 0, 0, 0, 0, new AnimState(), 3, look, 0, colors, 0, gear, 0, 7, false, false, 1, true, false, null, 0, undefined, enclosed)).toBe(true);
  expect(packet.boneCount).toBe(HUMAN_BONES);
  close(transform(packet, B_HIPS, rest.subarray(0, 3)), [seat.x, seat.y, seat.z]);
  const eye = new Float64Array(3);
  expect(characters.seatedEye(survivor, look, enclosed, eye)).toBe(true);
  expect(eye[1]).toBeLessThan(seat.y - .5);
  const drawn: string[] = [];
  characters.flush(packet, new InstanceWriter(packet.transient), false, m => drawn.push(pack.header.meshes[m]!.id));
  expect(drawn).not.toContain("core:rifle"); expect(drawn).toContain("core:human_m/head");
});

test("own and observed enclosed head look stays cabin-local through inversion and steep pitch without moving the torso", () => {
  const q = new Float64Array(4), direction = new Float64Array(3), local = new Float64Array(3);
  const localYaw = .3, localPitch = -.25;
  const gaze = [Math.sin(localYaw) * Math.cos(localPitch), Math.sin(localPitch), Math.cos(localYaw) * Math.cos(localPitch)];
  for (const role of ["pilot", "cabin"] as const) for (const own of [false, true]) {
    let levelHead: number[] | null = null, levelSpine: number[] | null = null;
    for (const angles of [{ yaw: 0, pitch: 0, roll: 0 }, { yaw: .7, pitch: 1.45, roll: .8 }, { yaw: -.4, pitch: 0, roll: Math.PI }, { yaw: .3, pitch: Math.PI, roll: .4 }]) {
      const f = fixture(), st = new AnimState(), seated = { ...seat, ...angles, role, driver: role === "pilot", weapons: false };
      vehicleRotation(seated, q); quatRotate(q, 0, gaze[0]!, gaze[1]!, gaze[2]!, direction, 0);
      seated.aimYaw = Math.atan2(direction[0]!, direction[2]!);
      st.pitch = Math.atan2(direction[1]!, Math.hypot(direction[0]!, direction[2]!)) * PITCH_STEPS / (Math.PI / 2);
      const pitchBefore = st.pitch;
      f.characters.add(f.packet, survivor, 0, 0, 0, seated.aimYaw, st, 3, defaultLook(), 0, colors, 0, null, 0, 7, own, own, 1, false, false, null, 0, undefined, seated);
      expect(st.pitch).toBe(pitchBefore);
      const heads: number[] = [], spines: number[] = [];
      for (const [bone, out] of [[B_HEAD, heads], [B_SPINE, spines]] as const) {
        const at = bone * BONE_FLOATS, m = f.packet.bones;
        for (let col = 0; col < 3; col++) {
          quatUnrotate(q, 0, m[at + col]!, m[at + 4 + col]!, m[at + 8 + col]!, local, 0);
          out.push(...local);
        }
      }
      if (levelHead) for (let k = 0; k < 9; k++) { expect(heads[k]!).toBeCloseTo(levelHead[k]!, 5); expect(spines[k]!).toBeCloseTo(levelSpine![k]!, 5); }
      else { levelHead = heads; levelSpine = spines; }
      close(transform(f.packet, B_HIPS, rest.subarray(0, 3)), [seat.x, seat.y, seat.z]);
    }
  }
});
