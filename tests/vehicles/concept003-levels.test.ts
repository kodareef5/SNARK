import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Assets } from "../../client/core/assets/assets.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { FramePacket, InstanceWriter } from "../../client/core/render/packet.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("Concept 003 sheds close detail at street distances and keeps it under zoom", () => {
  const pack = parsePack(readFileSync("assets/source/core/vehicles/concept003/concept003.snpk"));
  const reg = coreRegistry(), kind = reg.index.get("core:concept003")!;
  const mesh = pack.meshIndex.get("core:concept003")!;
  const assets = new Assets(reg, pack), characters = new Characters(reg, pack, assets);
  const packet = new FramePacket(), state = new AnimState(), colors = new Uint8Array(6);
  const frame = { pitch: 0, roll: 0, steering: 0, wheelAngle: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  assets.tier = tierOf("high");
  let tick = 0;
  const at = (distance: number, fov = 70): number[] => {
    packet.beginFrame();
    assets.begin(++tick * 16, 1080, fov * Math.PI / 180);
    characters.begin();
    characters.add(packet, kind, 0, 0, -distance, 0, state, tick, null, 0, colors, 0, null, 0, 21, false, false, 1, false, false, null, 0, frame);
    const drawn = new Set<number>();
    characters.flush(packet, new InstanceWriter(packet.transient), false, (body, level) => {
      if (mesh === body) drawn.add(level);
    });
    return [...drawn];
  };
  expect([20, 55, 57, 123, 125, 93, 90, 42, 40].map(d => at(d))).toEqual([[0], [0], [1], [1], [2], [2], [1], [1], [0]]);
  expect(at(80, 35)).toEqual([0]);
  expect(at(80)).toEqual([1]);
  expect([150, 285, 420, 555].map(d => at(d))).toEqual([[2], [3], [4], [5]]);
  const physical = pack.header.meshes[mesh]!.lods.map(l => l.error);
  expect(assets.table.error[mesh]).toEqual(physical);
  expect(assets.choose(physical, 125, 0)).toBe(0);
});
