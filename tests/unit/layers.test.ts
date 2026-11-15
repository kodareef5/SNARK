// A body's hurt and decay layer: the one texture its pictures make, how the lit tiers draw it at each stage, which
// bodies are drawn with it, and that a frame with no body hurt or dead is the frame it was.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { AIR } from "../../client/core/render/atmosphere.ts";
import { LAYER_RATE, Layers, corpseWanted, layerWanted } from "../../client/core/render/layers.ts";
import { DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { LAYER_LEVELS, LAYER_STAGES, surfaceFragment, wounded } from "../../client/core/render/surface.ts";
import { AnimState, CUE_DEAD, CUE_DECAY_SHIFT, CUE_HURT_SHIFT } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { TEXTURE_FORMATS } from "../../shared/pack/texture.ts";
import { layerMips, layerPicture } from "../../tools/pack/image.ts";
import { picture } from "../fixtures/stage.ts";
import { sceneSet, sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE } from "../fixtures/textured.ts";

const STAGE = LAYER_LEVELS / LAYER_STAGES;

test("the hurt picture comes before the decay picture in one layer, each over its three stages, and a mark keeps its stage from afar", () => {
  const hurt = picture(4, (x) => (x === 0 ? [200, 0, 0, 255] : x === 1 ? [200, 0, 0, 1] : [0, 0, 0, 0]));
  const decay = picture(4, (x, y) => (x === 1 && y === 0 ? [0, 0, 200, 255] : x === 2 ? [0, 0, 200, 255] : x === 3 ? [0, 200, 0, 2] : [0, 0, 0, 0]));
  const { picture: layer, hidden } = layerPicture(hurt, decay);
  // The decay texel under the hurt one is passed over, and counted.
  expect(hidden).toBe(1);
  const alpha = [0, 1, 2, 3].map((x) => layer.data[x * 4 + 3]);
  expect(alpha).toEqual([255, 128, 127, 1]);
  expect([...layer.data.subarray(4, 7)]).toEqual([200, 0, 0]);

  // A small early mark among texels that never show: its colour, and its step, not a mean with nothing.
  const mark = picture(8, (x, y) => (x < 2 && y < 2 ? [150, 20, 20, 255] : [0, 0, 0, 0]));
  const mips = layerMips(mark);
  const four = mips[2]!;
  expect([...four.subarray(0, 4)]).toEqual([150, 20, 20, 255]);
  const two = mips[1]!;
  expect([two[0], two[3]]).toEqual([150, 128]);
  // Where nothing under a pixel shows, it takes the colour of the pixel over it, so filtering brings in no black.
  expect([...four.subarray(4, 7)]).toEqual([150, 20, 20]);
  expect(four[7]).toBe(0);
});

test("a texel shows by the stage its alpha says, the corpse's decay dulls everything, and a fresh wound is wet", () => {
  const at = (texel: number[], stage: number) => {
    const albedo = [0.2, 0.3, 0.4];
    const mro = [1, 0.8, 0];
    wounded(albedo, mro, texel, stage / LAYER_STAGES);
    return { albedo, rough: mro[1]! };
  };
  const red = [0.5, 0, 0];
  // As the build stores them: a hurt texel of alpha a at 128 + a / 2, a decay texel at a / 2.
  const hurt = (a: number) => [...red, (128 + (a >> 1)) / 255];
  const decay = (a: number) => [...red, (a >> 1) / 255];
  // Whole by stage 1 from 191, by 2 from 106, by 3 from 21; not yet begun a stage before.
  for (const [a, whole] of [[191, 1], [106, 2], [21, 3]] as const) {
    expect(at(hurt(a), whole).albedo).toEqual(red);
    expect(at(hurt(a), whole - 1).albedo).toEqual([0.2, 0.3, 0.4]);
  }
  // A fresh corpse shows every hurt texel and no decay texel; decay texels come by the same rule after it.
  expect(at(hurt(1), 3).albedo.map((c) => +c.toFixed(3))).not.toEqual([0.2, 0.3, 0.4]);
  expect(at(decay(255), 3).albedo).toEqual([0.2, 0.3, 0.4]);
  for (const [a, whole] of [[191, 4], [106, 5], [21, 6]] as const) expect(at(decay(a), whole).albedo[1]).toBe(at(decay(255), whole).albedo[1]);
  // Wet while fresh, dry when the corpse has rotted; the plumage under nothing duller and darker with each decay stage.
  expect([at(hurt(255), 1).rough, at(hurt(255), 3).rough, at(hurt(255), 6).rough]).toEqual([0.32, 0.32, 0.8]);
  const greys = [3, 4, 5, 6].map((s) => at([0, 0, 0, 0], s).albedo);
  for (let k = 1; k < greys.length; k++) expect(greys[k]![2]!).toBeLessThan(greys[k - 1]![2]!);
});

test("the layered program is the surface program and the layer, and the surface program is the text it was", () => {
  for (const format of TEXTURE_FORMATS) {
    const plain = surfaceFragment(format, AIR);
    const layered = surfaceFragment(format, AIR, true);
    const without = layered
      .replace("uniform sampler2D uLayer;\nuniform float uLevel;\n", "")
      .replace(/vec3 wounded\([\s\S]*?\n}\n/, "")
      .replace(/  vec3 albedo = wounded\((dyed\(base\.rgb, mask, mask2\)), mro\);\n(.*)lit\(albedo,/, "$2lit($1,");
    expect(without).toBe(plain);
    const tier = tierOf("medium");
    expect(PROGRAMS.surfaceLayer!(tier, format).fragment).toBe(layered);
    expect(PROGRAMS.surface!(tier, format).fragment).toBe(plain);
  }
});

test("a body's layer reaches what its cues ask for over a moment, and one coming into view is drawn as it is", () => {
  const st = new AnimState();
  st.hurt = 2;
  expect(layerWanted(st)).toBe(2 * STAGE);
  st.dead = true;
  st.decay = 1;
  expect([layerWanted(st), corpseWanted(0), corpseWanted(2)]).toEqual([4 * STAGE, 3 * STAGE, 5 * STAGE]);
  const layers = new Layers();
  // Seen before, unhurt, then struck to stage 2: it grows at LAYER_RATE stages a second.
  expect(layers.level(1, 0, 0, true)).toBe(0);
  const second = TICK_RATE / LAYER_RATE;
  expect(layers.level(1, 2 * STAGE, 10, true)).toBe(0);
  expect(layers.level(1, 2 * STAGE, 10 + second / 2, true)).toBe(STAGE / 2);
  expect(layers.level(1, 2 * STAGE, 10 + second * 4, true)).toBe(2 * STAGE);
  // Mended, it fades as it grew.
  expect(layers.level(1, 0, 10 + second * 5, true)).toBe(STAGE);
  // One coming into view hurt is drawn at its stage at once.
  expect(layers.level(2, 3 * STAGE, 50, false)).toBe(3 * STAGE);
});

/** The draws of the tube's hide in a frame, as [layer level, instances]. */
const hides = (w: ReturnType<typeof sceneWorld>, p: FramePacket): number[][] => w.draws(p, TUBE).filter((d) => (p.drawFlags[d]! & DRAW_TEXTURED) !== 0 && p.drawMaterial[d] === w.manifest.materials!.findIndex((m) => m.id === "test:tube/hide")).map((d) => [p.drawLayer[d]!, p.drawInstances[d]!]);

test("only a hurt or dead body is drawn with its layer, on a lit tier, and a frame with none is the frame it was", () => {
  const scene = (layered: boolean, cues: number[], tier = "medium") => {
    const w = sceneWorld({}, tierOf(tier), sceneSet(64, layered));
    cues.forEach((cue, k) => (w.remote.cue[w.place(TUBE, 30 + k * 1.5, 24, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 })] = cue));
    let p = w.frame();
    for (let f = 0; f < 40; f++) p = w.frame();
    return { w, p };
  };
  const hurt = 2 << CUE_HURT_SHIFT;
  const rotting = CUE_DEAD | (1 << CUE_DECAY_SHIFT);
  const unhurt = scene(false, [0, 0, 0]);
  const plain = scene(true, [0, 0, 0]);
  const some = scene(true, [0, hurt, rotting]);
  // Three unhurt bodies are one draw, with no layer, and the layer is never fetched; their pixels are those of the tube with no layer at all.
  expect(hides(plain.w, plain.p)).toEqual([[0, 3]]);
  const layer = plain.w.manifest.textures!.findIndex((t) => t.role === "layer");
  expect([layer >= 0, plain.w.card.textures.has(layer), some.w.card.textures.has(layer)]).toEqual([true, false, true]);
  expect(plain.w.raster.color).toEqual(unhurt.w.raster.color);
  // The hurt one and the corpse each have a draw of their own at their level.
  expect(hides(some.w, some.p)).toEqual([[0, 1], [2 * STAGE, 1], [4 * STAGE, 1]]);
  expect(some.w.raster.color).not.toEqual(plain.w.raster.color);
  // A frame whose draws were dropped unread, as a tool that waits for the card does, leaves no layer to the next.
  some.p.drawCount = 0;
  some.w.remote.count = 0;
  const next = some.w.frame();
  expect([...next.drawLayer.subarray(0, next.drawCount)].every((l) => l === 0)).toBe(true);
  // On low poly nothing is drawn with a layer, and a hurt body is drawn as an unhurt one is.
  const low = scene(true, [0, hurt, rotting], "lowpoly");
  expect([...low.p.drawLayer.subarray(0, low.p.drawCount)].every((l) => l === 0)).toBe(true);
  const [lowHurt, lowPlain] = [scene(true, [0, hurt, 0], "lowpoly"), scene(true, [0, 0, 0], "lowpoly")];
  expect(lowHurt.p.drawCount).toBe(lowPlain.p.drawCount);
  expect(lowHurt.w.raster.color).toEqual(lowPlain.w.raster.color);
});
