// Hurt and dead bodies on a GPU, a check of tools/probe-lit.ts: the tube of the scene fixture with a hurt and decay
// layer, four of them side on at hurt stages 1 and 3 and decay stages 1 and 3, on medium at noon, each drawn as a road
// vehicle in a wear story of its own (wear.ts). The surfaceLayer program is held to the rasterizer, which draws the
// layer by surface.ts `wounded`, at points on one body with no edge near, and enough of those points must be where a
// layer is drawn.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { WEAR_STORIES } from "../../client/core/render/wear.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_HURT_SHIFT } from "../../shared/anim/pose.ts";
import { sceneSet, sceneWorld } from "../../tests/fixtures/sceneworld.ts";
import { TUBE } from "../../tests/fixtures/textured.ts";
import { spread } from "../probe-textured.ts";
import { PICK_ENTITY, Rasterizer } from "../snap/raster.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [480, 270];
const NEAR = 4;
const SMOOTH = 3;
/** Levels of 255, as the textured probe holds the surface program: 95 pixels in 100, and every 5 by 5 mean. */
const TOLERANCE = { pixelP95: 4, meanWorst: 4 };
const LEAST = { all: 200, layered: 100 };
const CUES = [1 << CUE_HURT_SHIFT, 3 << CUE_HURT_SHIFT, CUE_DEAD | (1 << CUE_DECAY_SHIFT), CUE_DEAD | (3 << CUE_DECAY_SHIFT)];

let made: { frame: number; color: Uint8ClampedArray; pickKind: Uint8Array; pickId: Float64Array; pickDraw: Int16Array; layered: Uint8Array } | null = null;

export const layersCheck: LitCheck = {
  name: "hurt and decay layers",

  shots(): Shot[] {
    const set = sceneSet(64, true);
    const w = sceneWorld({}, tierOf("medium"), set);
    w.scene.viewHeight = H;
    w.scene.plainSky = true;
    w.cam.aspect = W / H;
    CUES.forEach((cue, k) => (w.remote.cue[w.place(TUBE, 30.2 + k * 1.2, 23, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 })] = cue));
    const raster = new Rasterizer(W, H, w.pack, w.hf, w.manifest);
    const shot = new Shot("layers", W, H, w.hf, set.files[0]!.bytes);
    shot.manifest = set.manifest;
    for (let f = 0; f < 40; f++) {
      const p = w.frame(100, false);
      for (let d = 0; d < p.drawCount; d++) if (p.drawLayer[d]! > 0) p.drawWear[d] = 1 + (d % WEAR_STORIES);
      raster.render(p);
      shot.add(p, f === 39);
      if (f === 39) made = { frame: f, color: raster.color.slice(), pickKind: raster.pickKind.slice(), pickId: raster.pickId.slice(), pickDraw: raster.pickDraw.slice(), layered: p.drawLayer.slice(0, p.drawCount) };
    }
    return [shot];
  },

  judge(back: Readback) {
    const m = made!;
    const gpu = back.pixels("layers", m.frame);
    if (!gpu) return { ok: false, lines: ["NO PICTURE"] };
    const { color, pickKind, pickId, pickDraw } = m;
    const one = (i: number): boolean => {
      if (pickKind[i] !== PICK_ENTITY) return false;
      for (let dy = -NEAR; dy <= NEAR; dy++) {
        for (let dx = -NEAR; dx <= NEAR; dx++) {
          const j = i + dy * W + dx;
          if (pickId[j] !== pickId[i] || pickDraw[j] !== pickDraw[i]) return false;
          for (let c = 0; c < 3; c++) if (Math.abs(color[j * 4 + c]! - color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(color[j * 4 + c]! - color[(j + W) * 4 + c]!) > SMOOTH) return false;
        }
      }
      return true;
    };
    const pixel: number[] = [];
    const mean: number[] = [];
    let layered = 0;
    for (let y = NEAR + 2; y < H - NEAR - 2; y++) {
      for (let x = NEAR + 2; x < W - NEAR - 2; x++) {
        const i = y * W + x;
        if (!one(i)) continue;
        if (m.layered[pickDraw[i]!]! > 0) layered++;
        let most = 0;
        let mostMean = 0;
        for (let c = 0; c < 3; c++) {
          most = Math.max(most, Math.abs(gpu[i * 4 + c]! - color[i * 4 + c]!));
          let sum = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - color[(i + dy * W + dx) * 4 + c]!;
          mostMean = Math.max(mostMean, Math.abs(sum / 25));
        }
        pixel.push(most);
        mean.push(mostMean);
      }
    }
    const [p, mm] = [spread(pixel), spread(mean)];
    const ok = p.points >= LEAST.all && layered >= LEAST.layered && p.p95 <= TOLERANCE.pixelP95 && mm.worst <= TOLERANCE.meanWorst;
    return { ok, lines: [`four bodies at hurt stages 1 and 3 and decay stages 1 and 3, each in a wear story, against the rasterizer: ${p.points} points, ${layered} on a layer; pixels 95 in 100 within ${p.p95}, worst ${p.worst}; 5 by 5 means worst ${mm.worst.toFixed(2)}  ${ok ? "ok" : "FAIL"}`] };
  },
};
