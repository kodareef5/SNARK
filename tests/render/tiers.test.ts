// What a tier asks of the screen and the card beside its detail: how many pixels the canvas has for one CSS pixel
// (canvasRatio), how a material's textures are read where they are seen at a glancing angle, and how far it sees.
import { expect, test } from "bun:test";
import { TIERS, canvasRatio, forTouch, offeredTiers, tierOf } from "../../client/core/assets/tiers.ts";
import { farPlane } from "../../client/core/render/camera.ts";
import { FRAME } from "../../client/core/render/packet.ts";
import { sceneWorld } from "../fixtures/sceneworld.ts";

test("high and ultra read a material's textures for the angle they are seen at, as far as 16 to 1 where the card offers it; low poly, medium and a touch-first device read them as seen head on", () => {
  expect(TIERS.map((t) => [t.name, t.anisotropy])).toEqual([["lowpoly", 1], ["medium", 1], ["high", 16], ["ultra", 16]]);
  expect(TIERS.map((t) => forTouch(t, true).anisotropy)).toEqual([1, 1, 1, 1]);
});

test("every tier draws the screen's own pixels as far as its pixelRatio, ultra as many as the screen has, and a touch-first device as its rule says", () => {
  /** The canvas a tier draws in a window of `w` by `h` CSS pixels on a screen of `dpr` device pixels to one. */
  const canvas = (name: string, dpr: number, w: number, h: number, touch = false): [number, number] => {
    const r = canvasRatio(forTouch(tierOf(name), touch), dpr, w, h);
    return [Math.floor(w * r), Math.floor(h * r)];
  };
  const tiers = ["lowpoly", "medium", "high", "ultra"];
  // A 1440p screen at one device pixel a CSS pixel, and at two; 1080p at one, and a laptop of 1080p at one and a half.
  expect(tiers.map((t) => canvas(t, 1, 2560, 1440))).toEqual([[2560, 1440], [2560, 1440], [2560, 1440], [2560, 1440]]);
  expect(tiers.map((t) => canvas(t, 2, 2560, 1440))).toEqual([[2560, 1440], [3840, 2160], [5120, 2880], [5120, 2880]]);
  expect(tiers.map((t) => canvas(t, 1, 1920, 1080))).toEqual([[1920, 1080], [1920, 1080], [1920, 1080], [1920, 1080]]);
  expect(tiers.map((t) => canvas(t, 1.5, 1280, 720))).toEqual([[1280, 720], [1920, 1080], [1920, 1080], [1920, 1080]]);
  // A touch-first device, as on a phone of three device pixels a CSS pixel.
  expect(tiers.map((t) => canvas(t, 3, 390, 844, true))).toEqual([[390, 844], [585, 1266], [780, 1688], [1170, 2532]]);
});

test("a tier names how far it sees, 4 km on low poly and medium, 6 on high and 8 on ultra, a touch-first device as far as medium; the haze's end, low poly's fog, the far plane and the sea's tiles follow it", () => {
  expect(TIERS.map((t) => t.viewDistance)).toEqual([4000, 4000, 6000, 8000]);
  expect(offeredTiers(true).map((t) => forTouch(t, true).viewDistance)).toEqual([4000, 4000, 4000]);
  const w = sceneWorld();
  w.hf.seaLevel = -0.5;
  for (const tier of TIERS) {
    w.scene.assets.tier = tier;
    const p = w.frame(100, false);
    // The tier's view along the ground, from the camera's height (Scene.alongGround).
    const view = w.scene.alongGround(tier.viewDistance);
    // The sea's tiles, a kilometre a side, run past the view's end round the camera on a lit tier.
    let d = 0;
    while (d < p.drawCount && p.drawMesh[d] !== w.mesh("core:water")) d++;
    const pos = new Float32Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 2);
    let sea = 0;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) sea = Math.max(sea, Math.hypot(pos[i * 5]!, pos[i * 5 + 2]!));
    expect([tier.name, p.lit ? p.frame[FRAME.ends + 1] : p.fogEnd, w.cam.far, p.lit ? sea >= view : true]).toEqual([tier.name, p.lit ? Math.fround(view) : view, farPlane(view), true]);
  }
  // Four kilometres as the camera always had them: its far plane at 6 km.
  expect([farPlane(4000), farPlane(6000), farPlane(8000)]).toEqual([6000, 9000, 12000]);
  // A view set on the scene, as tools and tests hold it, is the one drawn on any tier.
  w.scene.viewDistance = 1500;
  expect(w.frame(100, false).fogEnd).toBe(1500);
});
