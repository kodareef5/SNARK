import { expect, test } from "bun:test";
import { Details } from "../../client/core/details/details.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { effectOf, type PackDetails } from "../../shared/pack/details.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { createMapWorld } from "../../server/world.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { flatMap } from "../fixtures/map.ts";

const reg = coreRegistry(), tree = reg.index.get("core:tree")!;
const dust: PackDetails = { atlas: { offset: 0, side: 128 }, inputs: "test", pictures: [{ id: "test:particle", cell: 0, regions: [-1, -1], grey: 1, flat: 1 }],
  effects: [effectOf("test:dust", { pictures: ["particle"], count: 4, shape: { sphere: .3 }, life: .5, size: .15, colour: [150, 110, 70], speed: 1, gravity: 1, reach: 40, pass: "blend" }, () => 0)], sheets: [] };

test("tree break feedback uses bounded short-lived authored particles without requiring a creature rig", () => {
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(2))));
  const details = new Details(reg, dust, defaultPalette(), () => null), remote = new RemoteSample(), cam = new Camera(), packet = new FramePacket();
  cam.x = 64; cam.y = 1.5; cam.z = 60; cam.aspect = 16 / 9; cam.update();
  const tier = tierOf("lowpoly");
  const frame = (tick: number) => { remote.tick = tick; packet.detailCount = 0; details.frame(packet, cam, remote, [], [], null, world.hf, tier, tick / 30 * 1000, world); };
  details.nodeBreak(tree, 7, 64, 0, 64, 0, 1); frame(0);
  expect(details.pool.count).toBeGreaterThan(0); expect(details.pool.count).toBeLessThanOrEqual(10);
  for (let i = 0; i < details.pool.count; i++) { expect(details.pool.y[i]!).toBeGreaterThan(0); expect(details.pool.end[i]!).toBeLessThanOrEqual(.5); }
  for (let tick = 1; tick <= 30; tick++) frame(tick);
  expect(details.pool.count).toBe(0);
  details.nodeBreak(tree, 8, 64, 0, 200, 31, 1); details.nodeBreak(reg.index.get("core:rock")!, 9, 64, 0, 64, 31, 1); frame(31);
  expect(details.pool.count).toBe(0);
  for (let i = 0; i < 800; i++) details.nodeBreak(tree, i, 64, 0, 64, 32, 1);
  frame(32); expect(details.pool.count).toBeLessThanOrEqual(24 * 10); expect(details.pool.count).toBeLessThanOrEqual(tier.details.pool);
});
