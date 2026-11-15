import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { B_HIPS, HUMAN, HUMAN_BONES, SLOT_NAMES } from "../../shared/anim/human.ts";
import { lookScales } from "../../shared/anim/look.ts";
import { createMountMotion, mountOrigin, mountPose } from "../../shared/anim/mount.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { BTN_PRIMARY, BTN_RELOAD, BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { vehiclePoint, vehicleRotation } from "../../shared/sim/vehicle-frame.ts";
import { boxMesh, buildPack, type SourceMesh } from "../../tools/pack/write.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const LINK = { latencyMs: 80, jitterMs: 10, loss: .02 };

function setup(armed = false) {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], entityStart: 3 });
  const driver = h.join("driver", LINK), passenger = h.join("passenger", LINK);
  h.run(1200);
  h.say(driver, "enablecheats"); h.say(passenger, "enablecheats");
  if (armed) {
    h.say(passenger, "kit pistol"); h.run(500);
    takeInHand(h, passenger, h.reg.index.get("core:pistol")!); h.run(6000);
  }
  const x = h.world.spawn.x, z = h.world.spawn.z - 8;
  h.say(driver, `tp ${x + 1.6} ${z + .12}`); h.say(passenger, `tp ${x - 1.6} ${z + .12}`);
  const car = h.host.spawnVehicle("urban:compact", x, z, 0, 0), a = h.client(driver)!, b = h.client(passenger)!;
  expect(h.host.urban.mount(a, car)).toBe(RESULT_OK);
  expect(h.host.urban.mount(b, car)).toBe(RESULT_OK);
  h.run(1200);
  expect(driver.driving).toBe(car); expect(passenger.own.seatSlot).toBe(2);
  return { h, driver, passenger, car, a, b, x, z };
}

test("a moving passenger's shot, recoil and reload remain predicted across delayed/lost snapshots", () => {
  const { h, driver, passenger: s, car, b } = setup(true);
  try {
    h.pilots[0]!.moveZ = 1; h.run(1000);
    const beforeZ = driver.own.z, rounds = s.own.rounds;
    expect(rounds).toBeGreaterThan(0);
    const shotCount = s.fired.length;
    let restoredAmmo = 0, sawShot = false, bloom = 0, kick = 0;
    const observe = () => {
      sawShot ||= s.fired.length > shotCount;
      if (sawShot && s.own.rounds >= rounds) restoredAmmo++;
      bloom = Math.max(bloom, s.own.bloom); kick = Math.max(kick, s.own.kick);
    };
    h.pilots[1]!.yaw = 1; h.pilots[1]!.pitch = .15;
    h.pilots[1]!.buttons = BTN_PRIMARY | BTN_SECONDARY; h.run(100, observe);
    h.pilots[1]!.buttons = BTN_SECONDARY; h.run(800, observe);
    expect(s.fired.length - shotCount).toBe(1);
    expect(restoredAmmo).toBe(0);
    expect(bloom).toBeGreaterThan(0); expect(kick).toBeGreaterThan(0);
    expect(h.world.ents.rounds[b.ent]).toBe(rounds - 1);
    expect(driver.own.z).toBeGreaterThan(beforeZ + 3);
    expect(s.own.seat).toBe(car + 1); expect(s.own.yaw).toBe(Math.round(65536 / (Math.PI * 2)));
    h.pilots[0]!.moveZ = 0; h.pilots[1]!.buttons = BTN_RELOAD; h.run(100);
    h.pilots[1]!.buttons = 0; h.run(6000);
    expect(s.own.rounds).toBe(h.world.ents.rounds[b.ent]);
    expect(s.own.rounds).toBeGreaterThan(0);
  } finally { h.host.shutdown(); }
});

// Tiny native bindings with different proportions exercise the same camera/seat path without the full art pack.
const rest = Float32Array.from(HUMAN.rest, (n, i) => i % 3 === 1 ? n * 1.13 : n);
const human: PackRig = { id: "test:passenger", skeleton: HUMAN.id, rest: [...rest] };
const carRig: PackRig = { id: "urban:compact", skeleton: "urban:compact", names: ["chassis"], parent: [-1], rest: [0, 0, 0], sockets: [
  { name: "seat_driver", bone: 0, x: .42, y: .59, z: .12 }, { name: "seat_front_passenger", bone: 0, x: -.42, y: .59, z: .12 },
] };
function mesh(id: string, skeleton = HUMAN.id, rig = human.id): SourceMesh {
  const lod = boxMesh([.04, .04, .04], 16); lod.bones = new Uint8Array(lod.positions.length / 3).fill(skeleton === HUMAN.id ? B_HIPS : 0);
  return { id, skeleton, rig, lods: [lod] };
}
const pack = parsePack(buildPack([...SLOT_NAMES.map(part => mesh(`core:human_m/${part}`)), mesh("urban:compact", carRig.skeleton, carRig.id)], defaultPalette(), [], [human, carRig]));

test("first-person passenger camera uses the rendered host tick, rig proportions and generation", () => {
  const { h, passenger: s, car } = setup();
  try {
    h.pilots[0]!.moveZ = 1; h.run(1600);
    const app = new App(s, h.reg, pack); app.steer = false; app.ui.settings.tier = "lowpoly";
    s.thirdPerson = false; app.controls.yaw = .4; app.controls.pitch = .2;
    expect(app.frame(h.now, 640, 360)).not.toBeNull();
    const r = app.remote, index = [...r.id.subarray(0, r.count)].indexOf(car);
    expect(index).toBeGreaterThanOrEqual(0);
    const frame = { x: r.x[index]!, y: r.y[index]!, z: r.z[index]!, yaw: r.yaw[index]!, pitch: r.vehiclePitch[index]!, roll: r.vehicleRoll[index]! };
    const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), scales = new Float32Array(HUMAN_BONES * 3), anchor = [0, 0, 0], rotation = [0, 0, 0, 1], origin = [0, 0, 0];
    mountPose(createMountMotion(), { role: "passenger", tick: 0, startTick: 0, durationTicks: 1 }, pose);
    lookScales(s.ownLook!, scales); solve(HUMAN, pose, solved, rest, scales);
    vehiclePoint(frame, [-.42, .59, .12], anchor); vehicleRotation(frame, rotation); mountOrigin(solved, anchor, rotation, origin);
    const eye = stanceEye(h.reg.move[s.own.kind]!, s.own.stance);
    expect(app.cam.x).toBeCloseTo(origin[0]!, 5); expect(app.cam.y).toBeCloseTo(origin[1]! + eye, 5); expect(app.cam.z).toBeCloseTo(origin[2]!, 5);
    expect(Math.abs(app.cam.z - s.own.z)).toBeGreaterThan(.2);
    expect(app.controls.yaw).toBe(.4); expect(app.controls.pitch).toBe(.2);
    // A replacement in the same entity slot cannot become this passenger's camera parent.
    s.own.seatGen++;
    app.frame(h.now, 640, 360);
    expect(app.cam.x).toBeCloseTo(s.own.x, 5); expect(app.cam.z).toBeCloseTo(s.own.z, 5);
  } finally { h.host.shutdown(); }
});

test("delayed passengers detach on exit and cannot reattach to a recycled host slot", () => {
  const { h, driver, passenger: s, car, b, x, z } = setup();
  try {
    const gen = h.world.ents.gen[car]!;
    h.host.urban.dismount(b); h.run(800);
    expect(s.own.seat).toBe(0); expect(s.own.seatSlot).toBe(0);
    expect(h.host.urban.mount(b, car)).toBe(RESULT_OK); h.run(1200);
    expect(s.own.seatGen).toBe(gen);
    const pid = h.world.ents.pid[car]!;
    h.host.survival.hurt(h.host.records.byPid.get(pid)!, 1e6, 0); h.run(800);
    expect(s.own.seat).toBe(0); expect(driver.driving).toBe(-1);
    const replacement = h.host.spawnVehicle("urban:compact", x, z + 6, 0, 0); h.run(800);
    expect(replacement).toBe(car); expect(h.world.ents.gen[replacement]).not.toBe(gen);
    const remote = new RemoteSample(); s.sampleRemote(remote);
    const seen = [...remote.id.subarray(0, remote.count)].indexOf(replacement);
    expect(seen).toBeGreaterThanOrEqual(0); expect(remote.gen[seen]).not.toBe(gen);
    expect(s.own.seat).toBe(0); expect(s.own.seatGen).toBe(0);
  } finally { h.host.shutdown(); }
});
