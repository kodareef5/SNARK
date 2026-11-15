// What a renderer is handed besides draws: the programs it compiles, the units their samplers read, and the frame
// block every lit program shares.
import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { FRAME, FRAME_BLOCK, FRAME_FLOATS, FramePacket, MAX_CASCADES } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT } from "../../client/core/render/programs.ts";
import { TEXTURE_FORMATS } from "../../shared/pack/texture.ts";

test("low poly's programs are the pinned flat texts, and every sampler a program declares reads a unit of its own", () => {
  const low = TIERS[0]!;
  expect(["flat", "terrain"].map((name) => PROGRAMS[name]!(low, "rgba")).map((p) => [p.vertex, p.fragment, p.defines])).toEqual([
    [FLAT_MESH_VERTEX, FLAT_FRAGMENT, ""],
    [FLAT_TERRAIN_VERTEX, FLAT_FRAGMENT, ""],
  ]);
  for (const tier of TIERS) {
    for (const format of TEXTURE_FORMATS) {
      for (const make of Object.values(PROGRAMS)) {
        const p = make(tier, format);
        const declared = [...(p.vertex + p.fragment).matchAll(/uniform\s+(?:\w+\s+)?\w*sampler\w+\s+([^;]+);/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
        expect(Object.keys(p.samplers).sort()).toEqual([...new Set(declared)].sort());
        expect(new Set(Object.values(p.samplers)).size).toBe(Object.keys(p.samplers).length);
      }
    }
  }
  // The material's five maps and the rest each have a unit, the layer the last but one, and 15 is left free.
  const units = [UNIT.palette, UNIT.heights, UNIT.tint, UNIT.bones, ...[0, 1, 2, 3, 4].map((r) => UNIT.maps + r), UNIT.shadow, UNIT.sky, UNIT.windowHeights, UNIT.windowTint, UNIT.atlas, UNIT.layer];
  expect([new Set(units).size, Math.max(...units)]).toEqual([15, 14]);
});

test("the frame block: each value inside its slot, a GLSL slot for every four floats, and the packet's views of it", () => {
  // Three numbers start a slot, two fit in its first three lanes, and one is anywhere in it.
  for (const at of [FRAME.sun, FRAME.sunColor, FRAME.moon, FRAME.moonColor, FRAME.skyAbove, FRAME.skyBelow, FRAME.cloudSun, FRAME.skySide, FRAME.skySun]) expect(at % 4).toBe(0);
  for (const at of [FRAME.ends, FRAME.clouds, FRAME.clouds + 2]) expect(at % 4).toBeLessThanOrEqual(2);
  const [slots, spheres, cascades, after] = [/highp vec4 (f[^;]+);/, /highp vec4 fSpheres\[(\d+)\]/, /highp mat4 fCascades\[(\d+)\]/, /fCascades\[\d+\];\s+highp vec4 (f[^;]+);/].map((re) => FRAME_BLOCK.match(re)![1]!);
  expect(slots.split(",").length * 4).toBe(FRAME.spheres);
  expect([Number(spheres), Number(cascades)]).toEqual([MAX_CASCADES, MAX_CASCADES]);
  expect([FRAME.spheres + MAX_CASCADES * 4, FRAME.cascades + MAX_CASCADES * 16, FRAME.skySide + after.split(",").length * 4]).toEqual([FRAME.cascades, FRAME.skySide, FRAME_FLOATS]);
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
