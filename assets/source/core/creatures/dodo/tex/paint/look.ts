// Close views of the painted dodo, drawn by the game's own renderer from a built pack: the whole bird and close-ups of
// its head, back and legs, in its default dyes and in loud ones. The renderer reads the rgba variant, so the pictures
// are at most 1,024 across here.
//
//   bun tex/paint/look.ts [--source DIR] --out DIR

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DODO_DYES } from "../../../../../../../content/creatures/dodo.ts";
import { buildRig } from "../../../../../../../shared/anim/rigs.ts";
import { parsePack } from "../../../../../../../shared/pack/pack.ts";
import { nearestColour } from "../../../../../../../shared/pack/palette.ts";
import { findAssets } from "../../../../../../../tools/art/assets.ts";
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

const asset = (await findAssets(arg("source"))).find((a) => a.id === "core:dodo");
if (!asset) throw new Error("no core:dodo here");
const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
const index = pack.meshIndex.get("core:dodo")!;
const header = pack.header.meshes[index]!;
const rig = buildRig(pack.header.rigs[header.rig!]!, pack.clips);
if (!rig) throw new Error("the dodo's pack has no rig");
new Poser(rig).set(null, 0);
const materials = materialsOf(asset);
const textures = (pack.header.textures ?? []).map((t) => rgbaOf(materials.find((m) => t.id === `${m.id}/${t.role}`)!, t.role, t.top, null));

const hex = (h: string): number => nearestColour(pack.palette, parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
const DYES: Record<string, readonly number[]> = {
  default: DODO_DYES,
  loud: ["FF3EA5", "9FE01F", "9FE01F", "3070FF", "FFE020", "20D0D0"].map(hex),
  dark: ["2E2B24", "AFA093", "2D3138", "65686F", "E6E3DC", "2E2B24"].map(hex),
};
// Point looked at (bird frame: x left, y up, z forward), radius held, degrees around from the front and above.
const SHOTS: Record<string, [readonly [number, number, number], number, number, number]> = {
  bird_front_left: [[0, 0.33, 0.04], 0.40, 40, 12],
  bird_side: [[0, 0.33, 0.04], 0.40, 90, 5],
  bird_back_right: [[0, 0.33, 0.04], 0.40, 220, 18],
  head_side: [[0, 0.57, 0.22], 0.12, 80, 5],
  head_front_left: [[0, 0.57, 0.20], 0.12, 35, 10],
  back_bars: [[0, 0.36, -0.06], 0.20, 180, 55],
  legs: [[0, 0.09, 0.03], 0.12, 30, 10],
  hood_edge: [[0.03, 0.56, 0.15], 0.05, 75, 5],
  nape: [[0, 0.52, 0.09], 0.09, 200, 10],
};
const W = 1200;
const H = 900;
const SS = 2;
const view = new ModelView(pack, W * SS, H * SS, [0.84, 0.83, 0.81]);
textures.forEach((t, slot) => view.texture(slot, t.role, t.pictures));

// The bird as it is mostly seen: drawn at each size directly, so the renderer reads the mips it would, then set side
// by side at that size and enlarged four times beside it.
const TALL = [200, 100, 50, 20];
const strip = (colors: readonly number[], around: number): { w: number; h: number; img: Uint8Array } => {
  const pad = 12;
  const pieces: { small: Uint8ClampedArray; sw: number; sh: number }[] = [];
  for (const t of TALL) {
    // The bird is 0.65 m tall; a radius of 0.40 m about its middle fills a square picture 0.80 m across.
    const sh = Math.round((t * 0.8) / 0.65);
    const sw = sh;
    const v = new ModelView(pack, sw, sh, [0.84, 0.83, 0.81]);
    textures.forEach((tex, slot) => v.texture(slot, tex.role, tex.pictures));
    v.draw({ mesh: index, level: 0, around, above: 12, centre: [0, 0.33, 0.04], radius: 0.4, rig: rig!, colors, textured: true });
    pieces.push({ small: v.raster.color.slice(), sw, sh });
  }
  const w = pieces.reduce((s, p) => s + p.sw * 5 + pad * 2, pad);
  const h = pieces[0]!.sh * 4 + pad * 2;
  const img = new Uint8Array(w * h * 4).fill(214);
  let x = pad;
  for (const { small, sw, sh } of pieces) {
    for (let y = 0; y < sh; y++) for (let k = 0; k < sw * 4; k++) img[((pad + y) * w) * 4 + x * 4 + k] = small[y * sw * 4 + k]!;
    x += sw + pad;
  }
  for (const { small, sw, sh } of pieces) {
    for (let y = 0; y < sh * 4; y++) for (let xx = 0; xx < sw * 4; xx++) for (let c = 0; c < 4; c++) img[((pad + y) * w + x + xx) * 4 + c] = small[(Math.floor(y / 4) * sw + Math.floor(xx / 4)) * 4 + c]!;
    x += sw * 4 + pad;
  }
  return { w, h, img };
};

for (const [dyes, colors] of Object.entries(DYES)) {
  for (const [side, around] of [["front_left", 40], ["side", 90]] as const) {
    const s = strip(colors, around);
    const file = join(out, `sizes_${side}_${dyes}.png`);
    writeFileSync(file, encodePng(s.w, s.h, s.img));
    console.log(file);
  }
}

for (const [dyes, colors] of Object.entries(DYES)) {
  for (const [name, [centre, radius, around, above]] of Object.entries(SHOTS)) {
    if (dyes !== "default" && !name.startsWith("bird") && name !== "head_side") continue;
    view.draw({ mesh: index, level: 0, around, above, centre, radius, rig, colors, textured: true });
    const src = view.raster.color;
    const img = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += src[((y * SS + dy) * W * SS + x * SS + dx) * 4 + c]!;
          img[(y * W + x) * 4 + c] = Math.round(sum / (SS * SS));
        }
      }
    }
    const file = join(out, `${name}_${dyes}.png`);
    writeFileSync(file, encodePng(W, H, img));
    console.log(file);
  }
}
