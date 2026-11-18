// A hurt body's layer on the card: held as fine as the base colour it lies on, up to its own top, however much smaller
// than its maps it is stored, so that thin marks are drawn as lines at middle distance and not swollen by a coarse step.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { CUE_HURT_SHIFT } from "../../shared/anim/pose.ts";
import { stepOf } from "../../shared/pack/texture.ts";
import { sceneSet, sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE } from "../fixtures/textured.ts";

test("a hurt tube's layer, stored two steps under its maps, comes to the base colour's step near and far, and never past its own top", () => {
  const steps: number[][] = [];
  for (const z of [22, 26, 30, 44]) {
    const w = sceneWorld({}, tierOf("medium"), sceneSet(512, true, 128));
    w.scene.viewHeight = 720;
    w.remote.cue[w.place(TUBE, 32, z, { yaw: Math.PI / 2 })] = 2 << CUE_HURT_SHIFT;
    for (let f = 0; f < 60; f++) w.frame(100, false);
    const state = w.scene.assets.residency.textureState();
    const step = (role: string): number => state.find((t) => t.id === `${TUBE}/${role}`)!.have;
    expect(step("layer")).toBe(Math.min(step("base"), stepOf(128)));
    steps.push([step("base"), step("layer")]);
  }
  // Near, the base colour is held past the layer's top; then at a step and at the step of it; far off, at the first.
  expect(steps.map(([base]) => base)).toEqual([stepOf(512), stepOf(256), stepOf(128), stepOf(64)]);
});
