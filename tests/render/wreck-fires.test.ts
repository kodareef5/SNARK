// The fire on a wreck that burns where it stands (client/core/render/wreck-fires.ts): cards for the nearest few, none
// where nothing burns near, and nothing asked of a frame with none.

import { expect, test } from "bun:test";
import { burningKind } from "../../content/docks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_SMOKE, FramePacket } from "../../client/core/render/packet.ts";
import { MAX_WRECK_FIRES, WreckFires } from "../../client/core/render/wreck-fires.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), DIMS = { chunksX: 8, chunksZ: 8 };
const store = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const kindsOf = (p: FramePacket): number[] => Array.from({ length: p.detailCount }, (_, n) => (p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255);

test("a burning wreck near has its flames and its smoke, and one far off or not burning has none", () => {
  const fires = new WreckFires(reg), s = store(), cam = new Camera(), p = new FramePacket();
  [cam.x, cam.y, cam.z] = [200, 3, 200];
  expect(fires.any).toBe(true);
  const burning = reg.index.get(burningKind("core:needle"))!, plain = reg.ids.findIndex((id) => id.startsWith("core:zzzzhull_needle_") && !id.endsWith("_burning"));
  s.add(plain, 210, 0, 210, 0, 0, 1);
  fires.build(p, cam, s, 8, 8, 1000);
  expect(fires.count).toBe(0);
  s.add(burning, 220, 0, 220, 0, 0, 1);
  s.add(burning, 480, 0, 480, 0, 0, 1);
  fires.build(p, cam, s, 8, 8, 1000);
  fires.write(p);
  const kinds = kindsOf(p);
  // Two flames always; a puff newly risen or all but gone may show too little to send.
  expect(kinds.filter((k) => k === DETAIL_GLOW).length).toBe(2);
  expect(kinds.filter((k) => k === DETAIL_SMOKE).length).toBeGreaterThanOrEqual(3);
  expect(kinds.length).toBeLessThanOrEqual(7);
  // Every card stands over the wreck, between its deck and where its smoke ends.
  for (let n = 0; n < p.detailCount; n++) {
    const o = n * DETAIL_FLOATS, d = p.details;
    expect(Math.hypot(d[o]! - 20, d[o + 2]! - 20)).toBeLessThan(9);
    expect(d[o + 1]! + 3).toBeGreaterThan(0);
    expect(d[o + 1]! + 3).toBeLessThan(24);
  }
  // The smoke moves with the clock and the flames flicker: another moment, other cards.
  const first = Array.from(p.details.subarray(0, p.detailCount * DETAIL_FLOATS));
  p.detailCount = 0;
  fires.build(p, cam, s, 8, 8, 1700);
  fires.write(p);
  expect(Array.from(p.details.subarray(0, p.detailCount * DETAIL_FLOATS))).not.toEqual(first);
});

test("only the nearest eight burn at once", () => {
  const fires = new WreckFires(reg), s = store(), cam = new Camera(), p = new FramePacket();
  [cam.x, cam.y, cam.z] = [200, 3, 200];
  const burning = reg.index.get(burningKind("core:jon_boat"))!;
  for (let k = 0; k < 14; k++) s.add(burning, 205 + k * 6, 0, 200, 0, 0, 1);
  fires.build(p, cam, s, 8, 8, 0);
  expect(fires.count).toBeLessThanOrEqual(MAX_WRECK_FIRES * 7);
  expect(fires.count).toBeGreaterThan(MAX_WRECK_FIRES * 4);
  fires.write(p);
  let far = 0;
  for (let n = 0; n < p.detailCount; n++) far = Math.max(far, p.details[n * DETAIL_FLOATS]!);
  // The eighth stands 47 m along; the ninth's cards, 53 m along, are not there.
  expect(far).toBeLessThan(47 + 8);
});
