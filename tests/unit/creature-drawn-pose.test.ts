// Effects must use the pose actually submitted, even when distance skips an update or the bone budget uses a rigid pose.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Details } from "../../client/core/details/details.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { creatureFootfallDomain, FOOTFALL_NONE } from "../../shared/anim/creature.ts";
import { AnimState, DIR_STEPS, LAYER_FLINCH } from "../../shared/anim/pose.ts";
import { boneToModel } from "../../shared/anim/skeleton.ts";
import { effectOf, type PackDetails } from "../../shared/pack/details.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { frozenPack } from "../fixtures/pack.ts";
import { flatWorld } from "../fixtures/world.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";

function yard(budget: number) {
  const world = flatWorld(), scene = new Scene(world, world.reg, frozenPack()), remote = new RemoteSample(), camera = new Camera();
  const kind = world.reg.index.get("core:raptor")!, state = new AnimState();
  scene.assets.tier = { ...tierOf("lowpoly"), bones: budget };
  scene.viewHeight = 480;
  camera.x = 64; camera.y = 1.6; camera.z = 50; camera.aspect = 16 / 9;
  remote.count = 2; state.speed = 3;
  for (let i = 0; i < 2; i++) {
    remote.id[i] = 100 + i; remote.kind[i] = kind; remote.x[i] = 64 + i * 2;
    remote.z[i] = 64; remote.flags[i] = 1; remote.anim[i] = state.pack();
  }
  const anim = scene.characters.creature(kind)!, socketName = [...anim.rig.sockets.keys()][0]!, socket = anim.rig.sockets.get(socketName)!;
  function frame(n: number): FramePacket {
    remote.tick = 100 + n * .5;
    for (let i = 0; i < 2; i++) remote.z[i] = 64 + 1.8 * n / 60;
    scene.now = remote.tick / 30 * 1000;
    return scene.build(camera, remote);
  }
  return { world, scene, remote, camera, kind, state, anim, socket, socketName, frame };
}

function submitted(p: FramePacket, id: number) {
  const instance = p.transientIds.subarray(0, p.transientCount).indexOf(id);
  expect(instance).toBeGreaterThanOrEqual(0);
  const words = new DataView(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength);
  const first = words.getUint16(instance * INSTANCE_BYTES + 12, true);
  for (let draw = 0; draw < p.drawCount; draw++) {
    if (p.drawBuffer[draw] !== TRANSIENT_BUFFER || (p.drawFlags[draw]! & DRAW_SKINNED) === 0) continue;
    if (instance < p.drawFirst[draw]! || instance >= p.drawFirst[draw]! + p.drawInstances[draw]!) continue;
    const rigid = (p.drawFlags[draw]! & DRAW_ONE_BONE) !== 0;
    return { first, rigid, pose: rigid ? p.drawOffset[draw * 3]! : first };
  }
  throw new Error(`No submitted body draw for ${id}`);
}

function transform(p: FramePacket, row: number, x: number, y: number, z: number): number[] {
  const at = row * 12, b = p.bones;
  return [b[at]! * x + b[at + 1]! * y + b[at + 2]! * z + b[at + 3]!,
    b[at + 4]! * x + b[at + 5]! * y + b[at + 6]! * z + b[at + 7]!,
    b[at + 8]! * x + b[at + 9]! * y + b[at + 10]! * z + b[at + 11]!];
}

test("the mount camera, seat, and submitted body use one current world-space pose, including after entity reuse", () => {
  const f = yard(58), state = new AnimState();
  state.speed = 3;
  const own = f.scene.own = { id: 9, generation: 1, kind: f.kind, x: 64, y: 0, z: 64, yaw: .4, tick: 100,
    state, firstPerson: false, colors: new Uint8Array(6), look: null, gear: new Uint16Array(GEAR_COUNT) };
  const view = new Viewpoint(), seat = new Float64Array(12), expected = new Float32Array(f.anim.rig.bones * 12);
  let previous: Float32Array | null = null, changed = 0;
  for (let n = 0; n < 12; n++) {
    own.tick = 100 + n * .5; own.z += .03;
    if (n === 6) { own.generation++; own.yaw = -1.2; }
    const obstruction = f.scene.prepareCameraBody(own)!;
    expect(f.scene.prepareCameraBody(own)).toBe(obstruction);
    const pinned = obstruction.solved!;
    expect(obstruction.generation).toBe(own.generation);
    view.placeVehicle(f.camera, null, own.x, own.y + 3, own.z, 0, -.2, own.yaw, 1.8, 16, false, { vx: 0, vy: 0, vz: 1.8, id: own.id }, obstruction);
    const p = f.scene.build(f.camera, f.remote), draw = submitted(p, own.id);
    expect(draw.rigid).toBe(false);
    expect(f.scene.characters.drawnPose(own.id, own.kind, own.tick)).toBe(pinned);
    expect(f.scene.characters.seat(own.kind, own.x - p.camX, own.y - p.camY, own.z - p.camZ, own.yaw, state, own.tick, seat, 0, undefined, 0, own.id)).toBe(true);
    writeBones(expected, 0, pinned, f.anim.rig.rest, null, own.x - p.camX, own.y - p.camY, own.z - p.camZ, own.yaw);
    expect(p.bones.subarray(draw.first * 12, draw.first * 12 + expected.length)).toEqual(expected);
    if (previous && pinned.pos.some((v, at) => v !== previous![at])) changed++;
    previous = pinned.pos.slice();
    expect(f.scene.characters.fresh).toBeGreaterThanOrEqual(1);
  }
  expect(changed).toBeGreaterThan(5);
  f.scene.own = null;
  f.scene.build(f.camera, null);
});

test("visible creature pose and gait match submitted native rows during distance caching and rigid fallback", () => {
  for (const budget of [1024, 30]) {
    const f = yard(budget), previous = new Map<number, Float32Array>();
    let cached = 0, rigid = 0;
    for (let frame = 0; frame < 12; frame++) {
      const p = f.frame(frame);
      expect(p.dropped).toBe(0);
      for (let i = 0; i < 2; i++) {
        const id = 100 + i, draw = submitted(p, id), shown = f.scene.characters.drawnPose(id, f.kind, f.remote.tick);
        const gait = f.scene.characters.drawnGait(id, f.kind, f.remote.tick);
        expect(shown).not.toBeNull(); expect(gait).not.toBeNull();
        const local = new Float32Array(f.anim.rig.bones * 12), expected = new Float32Array(local.length);
        writeBones(local, 0, shown!, f.anim.rig.rest, null, 0, 0, 0, 0);
        if (draw.rigid) {
          rigid++; expected.set(local); expect(gait).toEqual({ phase: 0, speed: 0, domain: FOOTFALL_NONE });
        } else {
          const before = previous.get(id);
          if (before && local.every((v, at) => v === before[at])) cached++;
          writeBones(expected, 0, shown!, f.anim.rig.rest, null, f.remote.x[i]! - p.camX, -p.camY, f.remote.z[i]! - p.camZ, 0);
        }
        previous.set(id, local);
        for (let k = 0; k < expected.length; k++) expect(p.bones[draw.pose * 12 + k]!).toBeCloseTo(expected[k]!, 6);
        expect(f.scene.characters.drawnPose(id, f.kind, f.remote.tick + 1)).toBeNull();
        expect(f.scene.characters.drawnPose(id, f.kind + 1, f.remote.tick)).toBeNull();
      }
    }
    if (budget === 1024) expect(cached).toBeGreaterThan(0);
    else expect(rigid).toBe(24);
  }
});

test("delayed socket particles originate at the actual cached or rigid packet transform", () => {
  for (const budget of [1024, 30]) {
    const f = yard(budget), details: PackDetails = {
      atlas: { offset: 0, side: 128 }, inputs: "",
      pictures: [{ id: "test:mark", cell: 0, regions: [-1, -1], grey: 1, flat: 0 }],
      effects: [effectOf("test:mark", { pictures: ["mark"], count: 1, gravity: 0, speed: 0, colour: [255, 255, 255] }, () => 0)],
      sheets: [{ owner: "core:raptor", cues: { struck: { effects: [{ effect: 0, from: f.socketName, at: 2 / 30 }] } } }],
    };
    const effects = new Details(f.world.reg, details, new Uint8Array(256 * 3), k => k === f.kind ? f.anim : null,
      (id, kind, tick) => f.scene.characters.drawnGait(id, kind, tick), (id, kind, tick) => f.scene.characters.drawnPose(id, kind, tick));
    let checked = 0, previous: Float32Array | null = null;
    for (let frame = 0; frame < 6; frame++) {
      if (frame === 1) {
        f.state.layer = LAYER_FLINCH; f.state.layerStart = 100;
        f.remote.anim[0] = f.state.pack(); f.remote.cue[0] = f.state.packCue();
      }
      const p = f.frame(frame), before = effects.pool.count, shown = f.scene.characters.drawnPose(100, f.kind, f.remote.tick)!;
      effects.frame(p, f.camera, f.remote, [], [], null, f.world.hf, tierOf("medium"), f.scene.now, f.world);
      if (effects.pool.count > before) {
        expect(frame).toBe(4);
        const draw = submitted(p, 100), s = f.socket, r = f.anim.rig.rest;
        let at = transform(p, draw.pose + s.bone, r[s.bone * 3]! + s.x, r[s.bone * 3 + 1]! + s.y, r[s.bone * 3 + 2]! + s.z);
        if (draw.rigid) at = transform(p, draw.first, at[0]!, at[1]!, at[2]!);
        expect(effects.pool.x[before]).toBeCloseTo(at[0]! + p.camX, 5);
        expect(effects.pool.y[before]).toBeCloseTo(at[1]! + p.camY, 5);
        expect(effects.pool.z[before]).toBeCloseTo(at[2]! + p.camZ, 5);
        if (!draw.rigid) expect(shown.pos).toEqual(previous!);
        // The socket also agrees with the publicly exposed pose, independently of packet packing.
        const point = new Float64Array(3); boneToModel(shown, s.bone, s.x, s.y, s.z, point);
        expect(effects.pool.y[before]).toBeCloseTo(point[1]!, 5);
        checked++;
      }
      previous = shown.pos.slice();
    }
    expect(checked).toBe(1);
  }
});

test("cached skeleton retains its posed contact domain across a newer remote direction", () => {
  const f = yard(1024); let delayed = 0, changed = 0;
  f.frame(0);
  for (let frame = 1; frame < 12; frame++) {
    const before = f.scene.characters.drawnPose(100, f.kind, f.remote.tick)!.pos.slice();
    const previousDomain = f.scene.characters.drawnGait(100, f.kind, f.remote.tick)!.domain;
    f.state.dir = frame % 2 ? DIR_STEPS / 2 : 0;
    const latestDomain = creatureFootfallDomain(f.anim, f.state, 100 + frame * .5);
    f.remote.anim[0] = f.state.pack(); f.frame(frame);
    const shown = f.scene.characters.drawnPose(100, f.kind, f.remote.tick)!;
    const gait = f.scene.characters.drawnGait(100, f.kind, f.remote.tick)!;
    if (shown.pos.every((v, at) => v === before[at])) {
      expect(gait.domain).toBe(previousDomain);
      if (latestDomain !== previousDomain) delayed++;
    } else { expect(gait.domain).toBe(latestDomain); changed++; }
  }
  expect(delayed).toBeGreaterThan(0); expect(changed).toBeGreaterThan(0);
});
