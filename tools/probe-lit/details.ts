// Small details on a GPU, a check of tools/probe-lit.ts: a dodo dying on the proving ground's grass, its ring of dust and
// its feathers, on medium at noon and on low poly, drawn by the shell and held to the rasterizer (tools/snap/raster.ts)
// where the details changed the picture: at the middles of the cut-out feathers, and in the see-through dust.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_DETAILS, type FramePacket } from "../../client/core/render/packet.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { spread } from "../probe-textured.ts";
import { provingView } from "../snap.ts";
import { playDetails } from "../snap/details.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [320, 240];
/** The moments read, in seconds after it dies: the dust rolling out over the feathers, and the feathers lying. */
const MOMENTS = [1.1, 1.4, 3];
/** Levels of 255. Cut-out middles as the textured probe holds a surface; dust read between levels as the card reads it, so looser. */
const TOLERANCE = { feathers: 8, dust: 14 };
const LEAST = { feathers: 30, dust: 300 };

interface Made {
  frames: number[];
  colour: Uint8ClampedArray[];
  /** Per pixel of each read frame: 1 where a feather's middle is, 2 where only the dust changed the picture. */
  where: Uint8Array[];
}

const made = new Map<string, Made>();

/** Where the details changed the rasterizer's picture of `p`: its pixels with them and without, and the draws they are. */
function changed(view: ReturnType<typeof provingView>, p: FramePacket): { colour: Uint8ClampedArray; where: Uint8Array } {
  const r = view.raster;
  const colour = r.color.slice();
  const draws = [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_DETAILS) !== 0);
  const pickDraw = r.pickDraw.slice();
  const cover = r.cover.slice();
  const counts = draws.map((d) => p.drawInstances[d]!);
  for (const d of draws) p.drawInstances[d] = 0;
  r.render(p);
  draws.forEach((d, k) => (p.drawInstances[d] = counts[k]!));
  const without = r.color;
  const where = new Uint8Array(W * H);
  const differs = (i: number): boolean => colour[i * 4] !== without[i * 4] || colour[i * 4 + 1] !== without[i * 4 + 1] || colour[i * 4 + 2] !== without[i * 4 + 2];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (!differs(i)) continue;
      // Away from any edge of what changed, and of a feather.
      let inside = true;
      let feather = draws.includes(pickDraw[i]!) && cover[i] === 1;
      for (let dy = -2; dy <= 2 && inside; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const j = i + dy * W + dx;
          if (!differs(j)) inside = false;
          if (pickDraw[j] !== pickDraw[i] || cover[j] !== 1) feather = false;
        }
      }
      if (inside) where[i] = feather ? 1 : draws.includes(pickDraw[i]!) ? 0 : 2;
    }
  }
  return { colour, where };
}

export const detailsCheck: LitCheck = {
  name: "small details",

  shots(): Shot[] {
    return ["medium", "lowpoly"].map((tier) => {
      const view = provingView(W, H);
      view.scene.assets.tier = tierOf(tier);
      view.scene.viewHeight = H;
      view.scene.plainSky = true;
      const shot = new Shot(`details-${tier}`, W, H, view.hf, corePackBytes());
      const m: Made = { frames: [], colour: [], where: [] };
      playDetails(view, "death", W, H, {
        moments: MOMENTS,
        zoom: 2,
        rows: 1,
        each: (p, moment) => {
          shot.add(p, moment);
          if (!moment) return;
          m.frames.push(shot.frames.length - 1);
          const c = changed(view, p);
          m.colour.push(c.colour);
          m.where.push(c.where);
        },
      });
      made.set(shot.key, m);
      return shot;
    });
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    for (const [key, m] of made) {
      const feathers: number[] = [];
      const dust: number[] = [];
      m.frames.forEach((frame, k) => {
        const gpu = back.pixels(key, frame);
        if (!gpu) return;
        const [colour, where] = [m.colour[k]!, m.where[k]!];
        for (let i = 0; i < W * H; i++) {
          if (where[i] === 0) continue;
          let most = 0;
          for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(gpu[i * 4 + c]! - colour[i * 4 + c]!));
          (where[i] === 1 ? feathers : dust).push(most);
        }
      });
      const [f, d] = [spread(feathers), spread(dust)];
      const pass = f.points >= LEAST.feathers && d.points >= LEAST.dust && f.p95 <= TOLERANCE.feathers && d.p95 <= TOLERANCE.dust;
      ok &&= pass;
      lines.push(`${key}: feathers' middles ${f.points} points, 95 in 100 within ${f.p95}, worst ${f.worst}; dust ${d.points} points, 95 in 100 within ${d.p95}, worst ${d.worst}  ${pass ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
