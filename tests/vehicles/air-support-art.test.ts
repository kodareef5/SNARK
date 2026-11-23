import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { Mixer, KIND_VEHICLE, LOOP } from "../../client/core/sound/mixer.ts";
import { SoundPacket } from "../../client/core/sound/packet.ts";
import { AirSounds } from "../../client/core/sound/air-support.ts";
import { readMaps } from "../../tools/art/materials.ts";
import { airMaterial, airSupportMeshes } from "../../tools/pack/air-support.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { AIR_PHASE, emptyAirSupport, type AirCarrier } from "../../shared/sim/air-support.ts";
import { cueKey } from "../../shared/sound/cues.ts";
import { airMesh, type AirPiece } from "../../shared/world/air-support-art.ts";
import { flatWorld } from "../fixtures/world.ts";

const meshes = airSupportMeshes();
const pack = parsePack(buildPack(meshes, defaultPalette()));
const carrier: AirCarrier = { id: 5, phase: AIR_PHASE.lower, loaded: true, trailer: true, jaws: 0, x: 32, y: 0, z: 36, yaw: 0 };

function stage() {
  const world = flatWorld();
  const scene = new Scene(world, world.reg, pack),
    cam = new Camera();
  cam.x = 32;
  cam.y = 3;
  cam.z = 10;
  scene.assets.tier = tierOf("high");
  const view = emptyAirSupport();
  scene.airSupport.view = view;
  const draw = () => scene.build(cam, null);
  const count = (id: AirPiece) =>
    Array.from(scene.packet.drawMesh.subarray(0, scene.packet.drawCount)).filter(
      (n, i) => n === pack.meshIndex.get(airMesh(id)) && (scene.packet.drawFlags[i]! & DRAW_SKINNED) !== 0,
    ).length;
  return { scene, cam, view, draw, count };
}

test("the freight models keep their silhouettes and share one finish atlas", () => {
  const maps = readMaps(airMaterial);
  expect([maps.base?.width, maps.normal?.width, maps.mro?.width]).toEqual([512, 512, 512]);
  for (const mesh of meshes)
    for (const lod of mesh.lods) {
      expect(lod.positions.every(Number.isFinite)).toBe(true);
      expect(lod.indices.every((i) => i < lod.positions.length / 3)).toBe(true);
    }
  for (const name of ["carrier", "pod", "drone", "chassis", "wheel"] as const) {
    const m = pack.header.meshes[pack.meshIndex.get(airMesh(name))!]!;
    expect(m.lods[0]!.indexCount).toBeGreaterThan(m.lods.at(-1)!.indexCount);
    expect(m.lods[0]!.sections?.length).toBe(3);
    expect(m.lods.at(-1)!.sections).toBeUndefined();
  }
});

test("the carrier shows four grips, wheel gear and two rotor discs", () => {
  const { view, scene, draw, count } = stage();
  view.carriers.push({ ...carrier });
  draw();
  expect(count("carrier")).toBe(1);
  expect(count("clamp")).toBe(4);
  expect(count("wheel")).toBe(4);
  expect(count("roof")).toBe(1);
  expect(scene.characters.rotorBlur.count).toBe(2);
  expect(count("rotor")).toBe(2);
  scene.assets.tier = tierOf("lowpoly");
  draw();
  expect(count("rotor")).toBe(2);
  view.carriers[0]!.loaded = false;
  draw();
  expect(count("pod")).toBe(0);
  expect(count("clamp")).toBe(4);
});

test("a late observer sees occupied bays and the pilot sees through their drone", () => {
  const { view, draw, count } = stage();
  view.pods.push({ ...carrier, ent: 0, hitched: true, open: 1, slots: 0b110101, selected: 2 });
  view.drones.push({ ...carrier, id: 24, pitch: 0.1, fuel: 0.8, bay: 3 });
  draw();
  expect(count("drone")).toBe(4);
  expect(count("droneFrame")).toBe(1);
  expect(count("impeller")).toBe(4);
  expect(count("indicator")).toBe(6);
  expect(count("feet")).toBe(1);
  view.flight = 24;
  draw();
  expect(count("droneFrame")).toBe(0);
  expect(count("impeller")).toBe(0);
  expect(count("drone")).toBe(4);
  view.pods[0]!.open = 0;
  draw();
  expect(count("drone")).toBe(0);
});

test("the ground marker shows its footprint and a distant carrier clears the view", () => {
  const { view, scene, cam, draw, count } = stage();
  view.carriers.push({ ...carrier, z: cam.z + 600 });
  scene.airSupport.preview = { x: cam.x, y: 0, z: cam.z + 10, yaw: 0 };
  draw();
  expect(count("marker")).toBe(1);
  expect(count("carrier")).toBe(0);
});

test("touchdown sounds once and late observers hear the running rotors", () => {
  const sounds = new AirSounds(),
    shots: number[] = [],
    loops: number[] = [];
  const play = (view: ReturnType<typeof emptyAirSupport>) =>
    sounds.update(
      view,
      1,
      2,
      (_, key) => shots.push(key),
      (_, __, key) => loops.push(key),
    );
  const before = emptyAirSupport();
  before.carriers.push({ ...carrier });
  play(before);
  expect(shots).toEqual([]);
  expect(loops).toContain(cueKey("engine/mid"));
  const settled = emptyAirSupport();
  settled.carriers.push({ ...carrier, phase: AIR_PHASE.release, loaded: false });
  play(settled);
  play(settled);
  expect(shots).toEqual([cueKey("supply/land")]);
});

test("a moving carrier's loop follows it across the listener", () => {
  const mixer = new Mixer(),
    p = new SoundPacket(),
    ear = { x: 0, y: 0, z: 0 };
  const voice = mixer.play(p, ear, 0, 0, 0, 3, 200, KIND_VEHICLE, 1, -1, -8, 4, 0, 0, 1, 1, 0, LOOP);
  expect(voice).toBeGreaterThan(0);
  p.clear();
  expect(mixer.gain(voice, 1, { x: 8, y: 4, z: 0 })).toBe(true);
  mixer.follow(p, ear, () => false);
  expect(p.moves.slice(2, 5)).toEqual([8, 4, 0]);
});
