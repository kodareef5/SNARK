import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { CONCEPT003_ART as art } from "../../content/vehicles/concept003-art.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("a nearby detached door falls briefly and late arrivals see the opening", () => {
  const id = art.id, lod = boxMesh([1, .3, 2], 32), reg = coreRegistry();
  const doorBone = art.bones.indexOf("door_left"), glassBone = art.bones.indexOf("glass_left");
  lod.bones = new Uint8Array(lod.positions.length / 3).fill(doorBone);
  const mesh = { id, rig: id, skeleton: id, lods: [lod] };
  const rig = { id, skeleton: id, names: art.bones, parent: art.bones.map((_, i) => i ? 0 : -1), rest: art.pivots.flat() };
  const pack = parsePack(buildPack([mesh], defaultPalette(), [], [rig]));
  const ch = new Characters(reg, pack, new Assets(reg, pack)), packet = new FramePacket();
  const render = (tick: number, missingPanels: number, entity = 16, rigid = false) => {
    packet.boneCount = 0; ch.clock = tick; ch.begin();
    const pose = { pitch: 0, roll: 0, wheelAngle: 0, steering: 0, missingPanels };
    expect(ch.add(packet, reg.index.get(id)!, 0, 0, 5, 0, new AnimState(), tick,
      null, 0, new Uint8Array(6), 0, null, 0, entity, false, false, 1, rigid, false, null, 0, pose)).toBe(true);
    const row = (bone: number) => packet.bones.slice(bone * BONE_FLOATS, (bone + 1) * BONE_FLOATS);
    return { door: row(doorBone), glass: row(glassBone) };
  };
  const live = render(10, 0), mask = (1 << 0) | (1 << 6);
  expect(live.door[0]).toBe(1);
  expect(render(11, mask).door[0]).toBe(1);
  const fallen = render(15, mask);
  expect(fallen.door[1]).not.toBe(0);
  expect(fallen.glass.every(v => v === 0)).toBe(true);
  expect(render(35, mask).door.every(v => v === 0)).toBe(true);
  expect(render(36, mask, 17).door.every(v => v === 0)).toBe(true);
  expect(render(37, mask, 18, true).glass.every(v => v === 0)).toBe(true);
});
