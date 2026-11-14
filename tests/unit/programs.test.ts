// What a renderer is handed besides draws: the frame block every lit program shares.
import { expect, test } from "bun:test";
import { FRAME, FRAME_BLOCK, FRAME_FLOATS, FramePacket, MAX_CASCADES } from "../../client/core/render/packet.ts";

test("the frame block: each value inside its slot, a GLSL slot for every four floats, and the packet's views of it", () => {
  // Three numbers start a slot, two fit in its first three lanes, and one is anywhere in it.
  for (const at of [FRAME.sun, FRAME.sunColor, FRAME.moon, FRAME.moonColor, FRAME.skyAbove, FRAME.skyBelow]) expect(at % 4).toBe(0);
  for (const at of [FRAME.ends, FRAME.wind]) expect(at % 4).toBeLessThanOrEqual(2);
  const [slots, spheres, cascades] = [/highp vec4 (f[^;]+);/, /highp vec4 fSpheres\[(\d+)\]/, /highp mat4 fCascades\[(\d+)\]/].map((re) => FRAME_BLOCK.match(re)![1]!);
  expect(slots.split(",").length * 4).toBe(FRAME.spheres);
  expect([Number(spheres), Number(cascades)]).toEqual([MAX_CASCADES, MAX_CASCADES]);
  expect([FRAME.spheres + MAX_CASCADES * 4, FRAME.cascades + MAX_CASCADES * 16]).toEqual([FRAME.cascades, FRAME_FLOATS]);
  expect(Math.max(...Object.values(FRAME))).toBeLessThan(FRAME_FLOATS);

  const p = new FramePacket();
  p.split = 384;
  p.cascades[0] = 2;
  p.spheres[3] = 64;
  expect([p.frame[FRAME.split], p.frame[FRAME.cascades], p.frame[FRAME.spheres + 3], p.cascades.length, p.spheres.length]).toEqual([384, 2, 64, 64, 16]);
  // A frame starts with no far draw fading, no casters and no cascade drawn.
  p.drawCount = 3;
  p.drawFade[2] = 2048;
  [p.casterCount, p.casterDropped, p.cascadeCount, p.cascadesDrawn] = [5, 1, 2, 3];
  p.beginFrame();
  expect([p.drawFade[2], p.casterCount, p.casterDropped, p.cascadeCount, p.cascadesDrawn, p.split]).toEqual([0, 0, 0, 0, 0, 384]);
});
