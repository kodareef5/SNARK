// The finish (client/core/render/post.ts), a check of tools/probe-lit.ts: the proving ground from its spawn point on high,
// drawn as light into the shell's light target and finished in one pass, at noon, an hour before sunset and at night.
// Without bloom it is held to the software rasterizer, which takes the same tone curve and grade, as the lit check holds
// medium (its points and tolerance); the sharpen moves nothing on a smooth surface and the dither a step at most. Bloom
// is the GPU's alone: with it, the picture's mean is held to the one without it, since bloom keeps the light's energy,
// and every pixel to it within BLOOM_MOST.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { tierWithout } from "../../client/core/passes.ts";
import { buildCorePack } from "../pack/build.ts";
import { spread } from "../probe-textured.ts";
import { provingView } from "../snap.ts";
import { judge, type Picture } from "./lit.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** Noon, an hour before sunset, and the middle of the night. */
const HOURS = [12, 17, 0];
/** Levels of 255 bloom may move the picture's mean, any channel, and 999 pixels in 1,000. */
const BLOOM_MEAN = 1;
const BLOOM_MOST = 8;

const pictures: (Picture & { bloomed: number })[] = [];

export const postCheck: LitCheck = {
  name: "the finish on high (post.ts)",

  shots(): Shot[] {
    const view = provingView(W, H);
    view.cam.pitch = 0;
    view.scene.plainSky = true;
    view.scene.canvasHeight = H;
    const high = tierOf("high");
    const shot = new Shot("post", W, H, view.hf, buildCorePack());
    for (const hour of HOURS) {
      view.scene.hour = hour;
      view.scene.assets.tier = tierWithout(high, new Set(["bloom"]));
      for (let f = 0; f < 3; f++) shot.add(view.render(), f === 2);
      const r = view.raster;
      const frame = shot.read.at(-1)!;
      view.scene.assets.tier = high;
      shot.add(view.render(), true);
      pictures.push({ hour, frame, bloomed: shot.read.at(-1)!, color: r.color.slice(), depth: r.depth.slice(), pickKind: r.pickKind.slice(), pickId: r.pickId.slice() });
    }
    return [shot];
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`the proving ground on high, finished without bloom, against the rasterizer as the lit check holds medium; with bloom, its mean within ${BLOOM_MEAN} of that and 999 pixels in 1,000 within ${BLOOM_MOST}`];
    let ok = true;
    for (const pic of pictures) {
      const [gpu, bloomed] = [back.pixels("post", pic.frame), back.pixels("post", pic.bloomed)];
      if (!gpu || !bloomed) {
        lines.push(`${String(pic.hour).padStart(5)} h: NO PICTURE`);
        ok = false;
        continue;
      }
      const j = judge(pic, gpu);
      const sums = [0, 0, 0];
      const moved: number[] = [];
      for (let i = 0; i < W * H; i++) {
        let most = 0;
        for (let c = 0; c < 3; c++) {
          sums[c]! += bloomed[i * 4 + c]! - gpu[i * 4 + c]!;
          most = Math.max(most, Math.abs(bloomed[i * 4 + c]! - gpu[i * 4 + c]!));
        }
        moved.push(most);
      }
      const mean = Math.max(...sums.map((s) => Math.abs(s / (W * H))));
      const m = spread(moved);
      const p999 = moved.sort((a, b) => a - b)[Math.floor(moved.length * 0.999)]!;
      const fine = j.ok && mean <= BLOOM_MEAN && p999 <= BLOOM_MOST;
      ok &&= fine;
      lines.push(`${String(pic.hour).padStart(5)} h: ${j.pixel.points} points: pixels mean ${j.pixel.mean.toFixed(2)}, 99 in 100 within ${j.pixel.p99}, worst ${j.pixel.worst}; means worst ${j.mean.worst.toFixed(2)}; bloom moves the mean ${mean.toFixed(2)}, pixels by ${m.mean.toFixed(2)} on average, 999 in 1,000 within ${p999}, worst ${m.worst}  ${fine ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
