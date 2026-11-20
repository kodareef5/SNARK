// What a renderer is handed besides draws: the programs it compiles, the units their samplers read, and the frame
// block every lit program shares.
import { expect, test } from "bun:test";
import { TIERS, forTouch } from "../../client/core/assets/tiers.ts";
import { FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { HAND_FAR, HAND_NEAR } from "../../client/core/render/hand.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_PULLED, DRAW_TEXTURED, DRAW_WATER, FRAME, FRAME_BLOCK, FRAME_FLOATS, FramePacket, MAX_CASCADES, MAX_TIRE_CONTACTS, MAX_CONTACTS } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT, drawProgram, tierPrograms } from "../../client/core/render/programs.ts";
import type { PackMaterial } from "../../shared/pack/pack.ts";
import { TEXTURE_FORMATS } from "../../shared/pack/texture.ts";

/** A program's name, from its number. */
const named = (n: number): string => Object.keys(PROGRAMS)[n]!;

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
  // The material's five maps and the rest each have a unit, the layer and the details atlas after them, which only the
  // details program reads and which is free outside its draws, where the finish's passes, after every draw, read their
  // sources (post.ts); and the sky's openness and the facades' five past the sixteen: no program reads more than
  // fifteen, the flat program on a tier that draws facades, two of them in its vertex text and thirteen in its
  // fragment's, within the sixteen a fragment text may read.
  const units = [UNIT.palette, UNIT.heights, UNIT.tint, UNIT.bones, ...[0, 1, 2, 3, 4].map((r) => UNIT.maps + r), UNIT.shadow, UNIT.sky, UNIT.windowHeights, UNIT.windowTint, UNIT.atlas, UNIT.layer, UNIT.details, UNIT.open];
  expect([new Set(units).size, Math.max(...units)]).toEqual([17, 16]);
  expect(Math.max(...TIERS.flatMap((tier) => Object.values(PROGRAMS).map((make) => Object.keys(make(tier, "bc").samplers).length)))).toBe(15);
  expect(Object.entries(PROGRAMS).filter(([, make]) => Object.values(make(TIERS[1]!, "bc").samplers).includes(UNIT.details)).map(([name]) => name)).toEqual(["details", "bloomDown", "bloomUp", "finish"]);
});

test("the frame block: each value inside its slot, a GLSL slot for every four floats, and the packet's views of it", () => {
  // Three numbers start a slot, two fit in its first three lanes, and one is anywhere in it.
  for (const at of [FRAME.sun, FRAME.sunColor, FRAME.moon, FRAME.moonColor, FRAME.skyAbove, FRAME.skyBelow, FRAME.cloudSun, FRAME.skySide, FRAME.skySun]) expect(at % 4).toBe(0);
  for (const at of [FRAME.ends, FRAME.clouds, FRAME.clouds + 2]) expect(at % 4).toBeLessThanOrEqual(2);
  const [slots, spheres, cascades, after] = [/highp vec4 (f[^;]+);/, /highp vec4 fSpheres\[(\d+)\]/, /highp mat4 fCascades\[(\d+)\]/, /fCascades\[\d+\];\s+highp vec4 (f[^;]+);/].map((re) => FRAME_BLOCK.match(re)![1]!);
  expect(slots.split(",").length * 4).toBe(FRAME.spheres);
  expect([Number(spheres), Number(cascades)]).toEqual([MAX_CASCADES, MAX_CASCADES]);
  expect([FRAME.spheres + MAX_CASCADES * 4, FRAME.cascades + MAX_CASCADES * 16, FRAME.skySide + after.split(",").length * 4]).toEqual([FRAME.cascades, FRAME.skySide, FRAME.contact]);
  // Each body takes two contact slots before the obelisk lenses (contact.ts).
  expect([Number(FRAME_BLOCK.match(/highp vec4 fContact\[(\d+)\]/)![1]), FRAME.contact + MAX_CONTACTS * 8]).toEqual([MAX_CONTACTS * 2, FRAME.eyes]);
  expect(Math.max(...Object.values(FRAME))).toBeLessThan(FRAME_FLOATS);

  expect(FRAME_BLOCK).toContain("highp vec4 fEyes[6]");
  expect(FRAME.eyes + 6 * 4).toBe(FRAME.reflection);
  expect([FRAME.reflection + 4, FRAME.previousReflection + 4, FRAME.streetLook + 4, FRAME.tireContacts + 4*MAX_TIRE_CONTACTS]).toEqual([FRAME.previousReflection, FRAME.streetLook, FRAME.tireContacts, FRAME.exhaustPhase]);
  expect(FRAME.exhaustPhase + 4).toBe(FRAME_FLOATS);
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

/** Floats a vertex text writes for each vertex: gl_Position and its outputs. */
const outputs = (vertex: string): number => {
  const size: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, mat3: 9 };
  return 4 + [...vertex.matchAll(/^(?:flat )?out (\w+) ([^;]+);/gm)].reduce((sum, m) => sum + size[m[1]!]! * m[2]!.split(",").length, 0);
};

test("a textured draw is drawn undyed where its material has no masks, and by a program that drops nothing unless it is cut out or handed over", () => {
  const p = new FramePacket();
  p.split = 384;
  const draw = (flags: number, hand = 0, layer = 0, fade = 0): number => {
    const d = p.drawCount++;
    [p.drawFlags[d], p.drawHand[d], p.drawLayer[d], p.drawFade[d]] = [flags, hand, layer, fade];
    return d;
  };
  const masks = (mask: number, mask2: number): PackMaterial => ({ mask, mask2 }) as PackMaterial;
  const [none, one, second] = [masks(-1, -1), masks(3, -1), masks(-1, 4)];
  expect([
    drawProgram(p, draw(DRAW_TEXTURED), none),
    drawProgram(p, draw(DRAW_TEXTURED | DRAW_CUTOUT), none),
    drawProgram(p, draw(DRAW_TEXTURED, HAND_FAR), none),
    drawProgram(p, draw(DRAW_TEXTURED | DRAW_BLEND), one),
    drawProgram(p, draw(DRAW_TEXTURED, HAND_NEAR), second),
    drawProgram(p, draw(DRAW_TEXTURED, 0, 5), none),
  ].map(named)).toEqual(["surfaceUndyedWhole", "surfaceUndyed", "surfaceUndyed", "surfaceWhole", "surface", "surfaceLayer"]);
  expect([draw(DRAW_PULLED, 0, 0, 900), draw(0, 0, 0, 900), draw(0, HAND_NEAR), draw(DRAW_WATER | DRAW_BLEND), draw(DRAW_BLEND), draw(0)].map((d) => named(drawProgram(p, d, undefined)))).toEqual(["pulled", "far", "far", "water", "seeThrough", "flat"]);
  p.split = 0;
  expect(named(drawProgram(p, draw(DRAW_BLEND), undefined))).toBe("flat");

  // The whole undyed variant skips both dye matrices and the hand-over distance, saving nineteen floats.
  const tier = TIERS[2]!;
  const [any, undyed, whole] = [PROGRAMS.surface!(tier, "astc"), PROGRAMS.surfaceUndyed!(tier, "astc"), PROGRAMS.surfaceUndyedWhole!(tier, "astc")];
  expect([any, PROGRAMS.surfaceWhole!(tier, "astc"), undyed, whole].map((t) => outputs(t.vertex))).toEqual([43, 42, 25, 24]);
  expect([any, undyed, whole].map((t) => [t.fragment.split("discard").length - 1, t.fragment.split("texture(uMask").length - 1])).toEqual([[2, 2], [2, 0], [0, 0]]);
  expect(whole.fragment).toContain("vec3 albedo = base.rgb * uTint;");
  expect(whole.fragment).toContain("float paint = 0.0;");
  expect(whole.fragment).toContain("mix(radiance,mirror*open,coat)");
});

test("a tier's programs are every one its frames may draw with, each once, the same down the governor's steps", () => {
  for (const base of TIERS) {
    for (const touch of [false, true]) {
      const tier = forTouch(base, touch);
      const names = tierPrograms(tier).map(named);
      expect(new Set(names).size).toBe(names.length);
      if (!tier.lit) expect(names).toEqual(["flat", "terrain", "terrainWindow", "far", "pulled", "sky", "details", "skyline", "signal"]);
      else expect(names).toEqual(Object.keys(PROGRAMS).filter((n) => tier.post !== null || !["bloomDown", "bloomUp", "finish"].includes(n)));
      const texts = new Set(names.map((n) => JSON.stringify(PROGRAMS[n]!(tier, "astc"))));
      expect(texts.size).toBe(names.length);
    }
  }
});
