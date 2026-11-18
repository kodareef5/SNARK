// The finish (client/core/render/post.ts), a check of tools/probe-lit.ts: the proving ground from its spawn point on high,
// drawn as light into the shell's light target and finished in one pass. Without bloom, at noon, an hour before sunset
// and at night, with the plain sky and no body in view, it is held to the software rasterizer, which takes the same
// tone curve and grade, as the lit check holds medium (its points and tolerance); the sharpen moves nothing on a smooth
// surface and the dither a step at most. Bloom is the GPU's alone: an hour before sunset, facing the sun with its disc
// drawn, the picture with bloom is held to the one without it, its mean within BLOOM_MEAN (bloom moves light and makes
// none) and BLOOM_PIXELS pixels at least moved by 2 levels or more, the glow round the disc. Contact (contact.ts) is
// the GPU's alone too: with the proving ground's survivor and grazer standing a few metres ahead at noon, CONTACT_PIXELS
// more pixels at least than in the same frame without them must be darker than the rasterizer's by CONTACT_LEAST levels
// or more in every channel, the ground round their feet, and no more than CONTACT_SHARE of the picture.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { tierWithout } from "../../client/core/passes.ts";
import { buildCorePack } from "../pack/build.ts";
import { provingView } from "../snap.ts";
import { judge, type Picture } from "./lit.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [640, 360];
/** Noon, an hour before sunset, and the middle of the night. */
const HOURS = [12, 17, 0];
const BLOOM_MEAN = 1;
const BLOOM_PIXELS = 200;
const CONTACT_LEAST = 4;
const CONTACT_PIXELS = 100;
const CONTACT_SHARE = 0.02;

const pictures: Picture[] = [];
let bloom: { plain: number; bloomed: number } | null = null;
let contacted: { frame: number; color: Uint8ClampedArray } | null = null;

export const postCheck: LitCheck = {
  name: "the finish on high (post.ts)",

  shots(): Shot[] {
    const view = provingView(W, H);
    view.cam.pitch = 0;
    view.scene.plainSky = true;
    view.scene.canvasHeight = H;
    const [high, plain] = [tierOf("high"), tierWithout(tierOf("high"), new Set(["bloom"]))];
    const shot = new Shot("post", W, H, view.hf, buildCorePack());
    const bodies = view.remote.count;
    view.remote.count = 0;
    view.scene.assets.tier = plain;
    for (const hour of HOURS) {
      view.scene.hour = hour;
      for (let f = 0; f < 3; f++) shot.add(view.render(), f === 2);
      const r = view.raster;
      pictures.push({ hour, frame: shot.read.at(-1)!, color: r.color.slice(), depth: r.depth.slice(), pickKind: r.pickKind.slice(), pickId: r.pickId.slice() });
    }
    // Toward the sun an hour before sunset, its disc drawn: without bloom, then with it.
    const [yaw, pitch] = [view.cam.yaw, view.cam.pitch];
    [view.scene.hour, view.scene.plainSky, view.cam.yaw, view.cam.pitch] = [17, false, Math.PI / 2, 0.2];
    for (let f = 0; f < 3; f++) shot.add(view.render(), f === 2);
    const before = shot.read.at(-1)!;
    view.scene.assets.tier = high;
    for (let f = 0; f < 2; f++) shot.add(view.render(), f === 1);
    bloom = { plain: before, bloomed: shot.read.at(-1)! };
    // The bodies a few metres ahead at noon, with the plain sky again.
    [view.scene.hour, view.scene.plainSky, view.cam.yaw, view.cam.pitch] = [12, true, yaw, pitch];
    view.scene.assets.tier = plain;
    view.remote.count = bodies;
    for (let i = 0; i < bodies; i++) [view.remote.x[i], view.remote.z[i]] = [view.cam.x - 1 + 2.5 * i, view.cam.z + 5 + i];
    for (let i = 0; i < bodies; i++) view.remote.y[i] = view.hf.heightAt(view.remote.x[i]!, view.remote.z[i]!);
    for (let f = 0; f < 3; f++) shot.add(view.render(), f === 2);
    contacted = { frame: shot.read.at(-1)!, color: view.raster.color.slice() };
    return [shot];
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`the proving ground on high, finished without bloom, against the rasterizer as the lit check holds medium`];
    let ok = true;
    for (const pic of pictures) {
      const gpu = back.pixels("post", pic.frame);
      if (!gpu) {
        lines.push(`${String(pic.hour).padStart(5)} h: NO PICTURE`);
        ok = false;
        continue;
      }
      const j = judge(pic, gpu);
      ok &&= j.ok;
      lines.push(`${String(pic.hour).padStart(5)} h: ${j.pixel.points} points: pixels mean ${j.pixel.mean.toFixed(2)}, 99 in 100 within ${j.pixel.p99}, worst ${j.pixel.worst}; means worst ${j.mean.worst.toFixed(2)}  ${j.ok ? "ok" : "FAIL"}`);
    }
    const [plain, bloomed] = [back.pixels("post", bloom!.plain), back.pixels("post", bloom!.bloomed)];
    if (!plain || !bloomed) return { ok: false, lines: [...lines, "bloom: NO PICTURE"] };
    const sums = [0, 0, 0];
    let [moved, most] = [0, 0];
    for (let i = 0; i < W * H; i++) {
      let far = 0;
      for (let c = 0; c < 3; c++) {
        sums[c]! += bloomed[i * 4 + c]! - plain[i * 4 + c]!;
        far = Math.max(far, Math.abs(bloomed[i * 4 + c]! - plain[i * 4 + c]!));
      }
      if (far >= 2) moved++;
      most = Math.max(most, far);
    }
    const mean = Math.max(...sums.map((s) => Math.abs(s / (W * H))));
    const glows = mean <= BLOOM_MEAN && moved >= BLOOM_PIXELS;
    lines.push(`bloom, toward the sun at 17 h: the mean moved ${mean.toFixed(2)} (within ${BLOOM_MEAN}), ${moved} pixels moved by 2 levels or more (${BLOOM_PIXELS} at least), the most ${most}  ${glows ? "ok" : "FAIL"}`);
    const [gpu, bare] = [contacted && back.pixels("post", contacted.frame), back.pixels("post", pictures[0]!.frame)];
    if (!gpu || !bare) return { ok: false, lines: [...lines, "contact: NO PICTURE"] };
    const darker = (got: Uint8Array, want: ArrayLike<number>): number => {
      let n = 0;
      for (let i = 0; i < W * H; i++) if ([0, 1, 2].every((c) => got[i * 4 + c]! - want[i * 4 + c]! <= -CONTACT_LEAST)) n++;
      return n;
    };
    const more = darker(gpu, contacted!.color) - darker(bare, pictures[0]!.color);
    const fine = more >= CONTACT_PIXELS && more <= W * H * CONTACT_SHARE;
    lines.push(`contact: with the survivor and the grazer a few metres ahead at noon, ${more} more pixels (${((more / (W * H)) * 100).toFixed(2)}%) than without them ${CONTACT_LEAST} levels or more darker than the rasterizer  ${fine ? "ok" : "FAIL"}`);
    return { ok: ok && glows && fine, lines };
  },
};
