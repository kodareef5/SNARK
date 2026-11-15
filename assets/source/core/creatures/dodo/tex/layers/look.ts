// The dodo's hurt and decay layers as the game's own renderer draws them, from the pictures in tex/ as they are now: no
// build, nothing written outside --out. Every stage side by side, from three sides, close up, and at the sizes it is
// seen at from 2 m and 10 m. The renderer reads the rgba variant, where the layer is stored at 256 across.
//
//   bun tex/layers/look.ts --out DIR [--dyes default,loud,dark]
//
// Each picture is a row of seven: unhurt, hurt stages 1, 2 and 3 (3 is also a fresh corpse), then decay stages 1, 2
// and 3. The corpse is drawn standing here, which it never is in the game, so that each picture is of the same pose.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_LEVELS, LAYER_STAGES } from "../../../../../../../client/core/render/surface.ts";
import { DODO_DYES } from "../../../../../../../content/creatures/dodo.ts";
import { buildRig } from "../../../../../../../shared/anim/rigs.ts";
import { parsePack } from "../../../../../../../shared/pack/pack.ts";
import { nearestColour } from "../../../../../../../shared/pack/palette.ts";
import { findAssets } from "../../../../../../../tools/art/assets.ts";
import { repack } from "../../../../../../../tools/art/build.ts";
import { Poser } from "../../../../../../../tools/art/check.ts";
import { materialsOf } from "../../../../../../../tools/art/materials.ts";
import { ModelView } from "../../../../../../../tools/snap.ts";
import { rgbaOf } from "../../../../../../../tools/snap/files.ts";
import { encodePng } from "../../../../../../../tools/snap/png.ts";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const out = arg("out");
if (!out) throw new Error("--out DIR");
mkdirSync(out, { recursive: true });

const asset = (await findAssets()).find((a) => a.id === "core:dodo")!;
const pack = parsePack(repack(new Uint8Array(readFileSync(asset.file)), false, asset));
const index = pack.meshIndex.get("core:dodo")!;
const rig = buildRig(pack.header.rigs[pack.header.meshes[index]!.rig!]!, pack.clips)!;
new Poser(rig).set(null, 0);
const materials = materialsOf(asset);
const textures = (pack.header.textures ?? []).map((t) => rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));

const hex = (h: string): number => nearestColour(pack.palette, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
const ALL_DYES: Record<string, readonly number[]> = {
  default: DODO_DYES,
  loud: ["FF3EA5", "9FE01F", "9FE01F", "3070FF", "FFE020", "20D0D0"].map(hex),
  dark: ["2E2B24", "AFA093", "2D3138", "65686F", "E6E3DC", "2E2B24"].map(hex),
};
const dyes = (arg("dyes") ?? "default,loud,dark").split(",");
const STAGES = Array.from({ length: LAYER_STAGES + 1 }, (_, s) => (s * LAYER_LEVELS) / LAYER_STAGES);
const BACKGROUND = [0.84, 0.83, 0.81] as const;

type Shot = [centre: readonly [number, number, number], radius: number, around: number, above: number];
const VIEWS: Record<string, Shot> = {
  front_left: [[0, 0.33, 0.04], 0.4, 40, 12],
  side: [[0, 0.33, 0.04], 0.4, 90, 5],
  back_right: [[0, 0.33, 0.04], 0.4, 220, 18],
  head: [[0, 0.57, 0.2], 0.13, 50, 8],
  back: [[0, 0.36, -0.06], 0.2, 180, 55],
  legs: [[0, 0.1, 0.03], 0.13, 30, 10],
};

/** The bird drawn `side` pixels square at each stage, supersampled `ss` times, as one row. */
function row(shot: Shot, colors: readonly number[], side: number, ss: number): { w: number; h: number; img: Uint8Array } {
  const pad = 8;
  const w = STAGES.length * (side + pad) + pad;
  const h = side + pad * 2;
  const img = new Uint8Array(w * h * 4).fill(214);
  const view = new ModelView(pack, side * ss, side * ss, BACKGROUND);
  textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));
  STAGES.forEach((layer, k) => {
    view.draw({ mesh: index, level: 0, centre: shot[0], radius: shot[1], around: shot[2], above: shot[3], rig, colors, textured: true, layer });
    const src = view.raster.color;
    const x0 = pad + k * (side + pad);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) sum += src[((y * ss + dy) * side * ss + x * ss + dx) * 4 + c]!;
          img[((pad + y) * w + x0 + x) * 4 + c] = Math.round(sum / (ss * ss));
        }
      }
    }
  });
  return { w, h, img };
}

/** Rows one under another, each enlarged `times` times, pixel for pixel. */
function stack(rows: { w: number; h: number; img: Uint8Array; times: number }[]): { w: number; h: number; img: Uint8Array } {
  const w = Math.max(...rows.map((r) => r.w * r.times));
  const h = rows.reduce((s, r) => s + r.h * r.times, 0);
  const img = new Uint8Array(w * h * 4).fill(214);
  let y0 = 0;
  for (const r of rows) {
    for (let y = 0; y < r.h * r.times; y++) for (let x = 0; x < r.w * r.times; x++) img.set(r.img.subarray(((Math.floor(y / r.times) * r.w) + Math.floor(x / r.times)) * 4, ((Math.floor(y / r.times) * r.w) + Math.floor(x / r.times)) * 4 + 4), ((y0 + y) * w + x) * 4);
    y0 += r.h * r.times;
  }
  return { w, h, img };
}

const write = (name: string, p: { w: number; h: number; img: Uint8Array }): void => {
  const file = join(out, `${name}.png`);
  writeFileSync(file, encodePng(p.w, p.h, p.img));
  console.log(file);
};

for (const d of dyes) {
  const colors = ALL_DYES[d]!;
  for (const [name, shot] of Object.entries(VIEWS)) write(`stages_${name}_${d}`, row(shot, colors, name === "head" || name === "back" || name === "legs" ? 280 : 300, 2));
  // In the game's 70 degree view, 720 pixels tall, the bird is about 205 pixels tall from 2 m and 41 from 10 m; the
  // square holds 0.8 m of it. Each is drawn at that size and shown again four and twelve times as large.
  const near = row(VIEWS.front_left!, colors, 252, 1);
  const far = row(VIEWS.front_left!, colors, 50, 1);
  write(`sizes_${d}`, stack([{ ...near, times: 1 }, { ...far, times: 1 }, { ...far, times: 5 }]));
}
