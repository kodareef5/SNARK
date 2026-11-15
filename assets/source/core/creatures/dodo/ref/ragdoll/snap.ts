// The dodo dying on the proving ground's 20 degree slope and coming to rest, drawn as a client on the high tier draws it:
// ten frames from the side, at 0, 0.6, 0.9 (it goes limp), 1.1, 1.4, 1.8, 2.4, 3, 3.6 and 4.2 seconds, left to right
// and top to bottom. It faces as the ragdoll test's dodo at yaw 2.1 did against its slope. Writes <name>.png beside this
// file, slope.png by default. before.png is the same drawing with the solver of 15819c4, on the pack its model built to
// there: it hops as it goes limp, turns over, and crawls on its back until about 3.4 s.
//
//   bun assets/source/core/creatures/dodo/ref/ragdoll/snap.ts [name]

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../../../../../../client/core/assets/tiers.ts";
import { AnimState } from "../../../../../../../shared/anim/pose.ts";
import { GEAR_COUNT } from "../../../../../../../shared/sim/entities.ts";
import { SLOPE_WIDTH, SLOPE_X0, SLOPE_Z0 } from "../../../../../../../shared/world/proving.ts";
import { findAssets } from "../../../../../../../tools/art/assets.ts";
import { SOURCE } from "../../../../../../../tools/art/source.ts";
import { provingView, settle } from "../../../../../../../tools/snap.ts";
import { gameFiles } from "../../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../../tools/snap/png.ts";

const [W, H] = [360, 300];
const SHOTS = [0, 0.6, 0.9, 1.1, 1.4, 1.8, 2.4, 3, 3.6, 4.2];
const ACROSS = 5;
const view = provingView(W, H, {}, await gameFiles(SOURCE));
view.scene.assets.tier = tierOf("high");
view.scene.viewHeight = H;
const { reg, hf, remote: r, cam, scene } = view;
const spec = (await findAssets(SOURCE)).find((a) => a.id === "core:dodo")!.spec;
// Halfway across the second strip, which rises toward +z, a third of the way up.
const [x, z] = [SLOPE_X0 + SLOPE_WIDTH * 1.5, SLOPE_Z0 + 12];
const id = 7;
r.count = 1;
[r.id[0], r.kind[0], r.x[0], r.y[0], r.z[0], r.yaw[0], r.flags[0]] = [id, reg.index.get("core:dodo")!, x, hf.heightAt(x, z), z, 2.1 - Math.PI / 2, 1];
r.gear.fill(0, 0, GEAR_COUNT);
if (spec.kind === "creature") spec.regions.forEach((region, q) => (r.colors[q] = region.sample));
r.span[0] = r.grown[0] = r.seat[0] = r.hasLook[0] = 0;
r.anim[0] = new AnimState().pack();
r.cue[0] = 0;
r.tick = 400;
// Across the slope, looking along +x: it rises to the left.
[cam.x, cam.z, cam.y] = [x - 1.7, z, hf.heightAt(x, z) + 0.5];
[cam.yaw, cam.pitch, cam.fovY] = [Math.PI / 2, -0.2, 0.5];
settle(view);
const frame = (): void => {
  scene.now += 1000 / 60;
  view.port?.advance(scene.now);
  r.tick += 0.5;
  view.raster.render(scene.build(cam, r));
};
const rows = Math.ceil(SHOTS.length / ACROSS);
const [SW, SH] = [ACROSS * (W + 2) - 2, rows * (H + 2) - 2];
const strip = new Uint8ClampedArray(SW * SH * 4).fill(255);
const keep = (k: number): void => {
  const [ox, oy] = [(k % ACROSS) * (W + 2), Math.floor(k / ACROSS) * (H + 2)];
  for (let y = 0; y < H; y++) strip.set(view.raster.color.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * SW + ox) * 4);
};
frame();
keep(0);
// It dies: gone from the view, as the server takes a dead creature out of the world.
r.died = new Map([[id, r.tick + 0.5]]);
r.count = 0;
let t = 0;
for (let k = 1; k < SHOTS.length; k++) {
  for (; t < SHOTS[k]! - 1e-9; t += 1 / 60) frame();
  keep(k);
}
const out = join(import.meta.dir, `${process.argv[2] ?? "slope"}.png`);
writeFileSync(out, encodePng(SW, SH, strip));
console.log(out);
