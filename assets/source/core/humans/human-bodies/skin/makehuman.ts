// Paints the MakeHuman bodies' three materials from the mirror's CC0 pictures (assets/raw/makehuman): one skin for
// both sexes, with each sex's underwear in its own masks; the eyes with the teeth and tongue on one sheet; the brows
// and lashes on another, cut out. Base colours are each region's colour over its mean, so the look's palette colour
// still sets the tone. Run it with Bun from the repository; it writes beside itself.
//
//   bun assets/source/core/humans/human-bodies/skin/makehuman.ts

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { B_CHEST, B_HIPS, B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R } from "../../../../../../shared/anim/human.ts";
import { encodePng, readPicture, unpack } from "../../../../../../tools/pack/image.ts";
import { BROWS_SHEET, EYE_PICTURE, EYES_SHEET, type Place } from "../../../../../../tools/makehuman/cooked.ts";
import { fitBody, PART_NAMES, type FittedBody } from "../../../../../../tools/makehuman/fit.ts";
import { RIGS } from "../rigs.ts";
import { blurred, field, fill, fromLinear, leaning, luma, picture, shrink, type Field } from "./paint.ts";

const HERE = import.meta.dir;
const MH = resolve(HERE, "../../../../../raw/makehuman");
/** MakeHuman's own default skin, young and light, with no hair or make-up painted on. */
const SKIN = "system-assets/skins/young_caucasian_male/young_lightskinned_male_diffuse.png";
const EYE = EYE_PICTURE;
const TEETH = "system-assets/teeth/teeth_base/teeth.png";
const TONGUE = "system-assets/tongue/tongue01/tongue01_diffuse.png";
const BROWS = "system-assets/eyebrows/eyebrow001/eyebrow001.png";
const LASHES = "system-assets/eyelashes/eyelashes01/eyelashes01.png";

/** The base colour's mean where a region dyes it, as light, and the ratio's floor and ceiling, as skin/paint.ts has them. */
const MEAN = 0.5;
const RATIO = [0.2, 1.9] as const;
const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** A picture as linear RGBA at `side`, by bilinear sampling. */
function sampled(file: string): { side: number; at: (u: number, v: number, out: number[]) => void } {
  const p = readPicture(join(MH, file));
  const rgba = unpack(p, linear);
  // unpack keeps alpha as it is; colour channels go through the curve.
  const w = p.width, h = p.height;
  return {
    side: w,
    at: (u, v, out) => {
      const x = Math.min(w - 1, Math.max(0, u * w - 0.5)), y = Math.min(h - 1, Math.max(0, v * h - 0.5));
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = x - x0, fy = y - y0;
      for (let c = 0; c < 4; c++) {
        const a = rgba[(y0 * w + x0) * 4 + c]!, b = rgba[(y0 * w + x1) * 4 + c]!, d = rgba[(y1 * w + x0) * 4 + c]!, e = rgba[(y1 * w + x1) * 4 + c]!;
        out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    },
  };
}

/** Per texel of a `side` picture of the body's UVs: the point of the body at rest it shows (NaN where none), and its bone. */
interface Surface {
  side: number;
  at: Float32Array;
  bone: Int16Array;
}

function surfaceOf(f: FittedBody, side: number): Surface {
  const at = new Float32Array(side * side * 3).fill(NaN);
  const bone = new Int16Array(side * side).fill(-1);
  const body = PART_NAMES.indexOf("body");
  for (let t = 0; t < f.indices.length / 3; t++) {
    if (f.part[t] !== body) continue;
    const c = [0, 1, 2].map((k) => f.indices[t * 3 + k]!);
    const px = c.map((v) => f.uvs[v * 2]! * side - 0.5);
    const py = c.map((v) => (1 - f.uvs[v * 2 + 1]!) * side - 0.5);
    const area = (px[1]! - px[0]!) * (py[2]! - py[0]!) - (px[2]! - px[0]!) * (py[1]! - py[0]!);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...px)) - 1), x1 = Math.min(side - 1, Math.ceil(Math.max(...px)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...py)) - 1), y1 = Math.min(side - 1, Math.ceil(Math.max(...py)) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w1 = ((x - px[0]!) * (py[2]! - py[0]!) - (px[2]! - px[0]!) * (y - py[0]!)) / area;
      const w2 = ((px[1]! - px[0]!) * (y - py[0]!) - (x - px[0]!) * (py[1]! - py[0]!)) / area;
      const w0 = 1 - w1 - w2;
      // Inside, or within about a texel of an edge, as the skin painter's coverage reaches.
      const slack = 1.5 / Math.sqrt(Math.abs(area));
      if (w0 < -slack || w1 < -slack || w2 < -slack) continue;
      const i = y * side + x;
      const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
      if (!inside && bone[i]! >= 0) continue;
      const w = [w0, w1, w2];
      for (let a = 0; a < 3; a++) at[i * 3 + a] = w.reduce((s, k, j) => s + k * f.positions[c[j]! * 3 + a]!, 0);
      bone[i] = f.bone[c[w.indexOf(Math.max(...w))]!]!;
    }
  }
  return { side, at, bone };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Which texels the underwear of `sex` covers: briefs for both, a top for her. */
function underwear(s: Surface, sex: number): Uint8Array {
  const rig = RIGS[sex]!;
  const legY = rig[B_UPPER_LEG_L * 3 + 1]!, legX = rig[B_UPPER_LEG_L * 3]!, backZ = rig[B_HIPS * 3 + 2]!;
  const n = s.side * s.side;
  const out = new Uint8Array(n);
  const lower = new Set([B_HIPS, B_SPINE, B_UPPER_LEG_L, B_UPPER_LEG_R]);
  const upper = new Set([B_SPINE, B_CHEST, B_UPPER_CHEST, B_SHOULDER_L, B_SHOULDER_R, B_NECK]);
  // Her bust's front, where the top's cups are highest.
  let apexY = 0, apexZ = -Infinity;
  if (sex === 1) for (let i = 0; i < n; i++) {
    const x = Math.abs(s.at[i * 3]!), y = s.at[i * 3 + 1]!, z = s.at[i * 3 + 2]!;
    if (!upper.has(s.bone[i]!) || x < 0.04 || x > 0.14 || z <= apexZ) continue;
    [apexY, apexZ] = [y, z];
  }
  const chestZ = rig[B_UPPER_CHEST * 3 + 2]!;
  for (let i = 0; i < n; i++) {
    const b = s.bone[i]!;
    if (b < 0) continue;
    const x = Math.abs(s.at[i * 3]!), y = s.at[i * 3 + 1]!, z = s.at[i * 3 + 2]!;
    if (lower.has(b)) {
      const top = legY + (sex === 0 ? 0.085 : 0.075);
      // The leg openings rise from the crotch to the hip, a little lower behind, where the briefs cover more.
      const rise = smooth(0.02, legX + 0.07, x);
      const bottom = legY - 0.08 + rise * (sex === 0 ? 0.075 : 0.105) - (z < backZ ? 0.03 : 0);
      if (y <= top && y >= bottom) out[i] = 1;
    }
    if (sex === 1 && upper.has(b)) {
      const front = z > chestZ;
      const under = apexY - 0.075;
      // The cups, joined by a low gore in the middle and running down to the band at the sides and behind.
      const cup = smooth(0.0, 0.03, x) * (1 - smooth(0.14, 0.18, x));
      const top = front ? apexY - 0.01 + cup * 0.075 : apexY - 0.03;
      if (y >= under && y <= top) out[i] = 1;
      // The straps, over each shoulder.
      if (Math.abs(x - 0.085) < 0.011 && y > under && y < rig[B_NECK * 3 + 1]! + 0.02) out[i] = 1;
    }
  }
  return out;
}

/** The texels of the body's UVs, at `side`. */
const usedOf = (s: Surface): Uint8Array => Uint8Array.from(s.bone, (b) => (b >= 0 ? 1 : 0));

/** Masks of regions, `w` six a texel, as the two mask pictures at `side`. */
function masks(w: Field, side: number): { mask: Field; mask2: Field } {
  const small = shrink(w, side);
  const mask = field(side, 3);
  const mask2 = field(side, 3);
  for (let i = 0; i < side * side; i++) {
    const q = Array.from({ length: 6 }, (_, k) => Math.round(small.data[i * 6 + k]! * 255));
    for (let over = q.reduce((t, v) => t + v, 0) - 255; over > 0; over--) q[q.indexOf(Math.max(...q))]!--;
    for (let k = 0; k < 3; k++) {
      mask.data[i * 3 + k] = q[k]!;
      mask2.data[i * 3 + k] = q[k + 3]!;
    }
  }
  return { mask, mask2 };
}

const write = (name: string, p: Field, encode: (v: number, c: number) => number): void => writeFileSync(join(HERE, `${name}.png`), encodePng(picture(p, encode)));
const srgb8 = (v: number): number => fromLinear(v);
const unit8 = (v: number): number => Math.round((v * 0.5 + 0.5) * 255);
const byte = (v: number): number => Math.round(v * 255);

function paintSkin(bodies: readonly FittedBody[]): string {
  const side = 2048;
  const src = sampled(SKIN);
  const surfaces = bodies.map((f) => surfaceOf(f, side));
  const used = usedOf(surfaces[0]!);
  const worn = surfaces.map((s, sex) => underwear(s, sex));
  const n = side * side;
  const colour = field(side, 3);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    src.at((x + 0.5) / side, (y + 0.5) / side, px);
    for (let c = 0; c < 3; c++) colour.data[(y * side + x) * 3 + c] = px[c]!;
  }
  // Under either sex's underwear the skin is evened out, so no nipple or fold shows through cloth: the same picture serves both.
  const anyWorn = Float32Array.from({ length: n }, (_, i) => (worn[0]![i]! || worn[1]![i]! ? 1 : 0));
  const near = blurred(anyWorn, side, 6);
  const known = Uint8Array.from({ length: n }, (_, i) => (used[i] && near[i]! === 0 ? 1 : 0));
  const even = { side, channels: 3, data: Float32Array.from(colour.data) };
  fill(even, known);
  const evenBlur = [0, 1, 2].map((c) => blurred(Float32Array.from({ length: n }, (_, i) => even.data[i * 3 + c]!), side, 12));
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, near[i]! * 3);
    for (let c = 0; c < 3; c++) colour.data[i * 3 + c] = colour.data[i * 3 + c]! * (1 - k) + evenBlur[c]![i]! * k;
  }
  fill(colour, used);
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) if (used[i] && !anyWorn[i]) {
    for (let c = 0; c < 3; c++) mean[c]! += colour.data[i * 3 + c]!;
    count++;
  }
  for (let c = 0; c < 3; c++) mean[c]! /= count;
  const base = field(side, 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) base.data[i * 3 + c] = MEAN * Math.min(RATIO[1], Math.max(RATIO[0], colour.data[i * 3 + c]! / mean[c]!));
  const { normal, occlusion } = leaning(colour, used);
  const packed = field(side, 3);
  for (let i = 0; i < n; i++) {
    packed.data[i * 3] = occlusion.data[i]!;
    // Rough enough that a near face shows no grey sheen of the sky; under the underwear as rough as cloth.
    packed.data[i * 3 + 1] = 0.7 + 0.12 * near[i]!;
  }
  for (const f of [base, normal, packed]) fill(f, used);
  write("mh-skin-base", base, srgb8);
  write("mh-skin-normal", normal, unit8);
  write("mh-skin-orm", shrink(packed, 1024), byte);
  const sexes = ["m", "f"];
  worn.forEach((w, sex) => {
    const regions = field(side, 6);
    for (let i = 0; i < n; i++) regions.data[i * 6 + (w[i] ? 1 : 0)] = 1;
    const { mask, mask2 } = masks(regions, 512);
    write(`mh-skin-${sexes[sex]}-mask`, mask, (v) => v);
    write(`mh-skin-${sexes[sex]}-mask2`, mask2, (v) => v);
  });
  const share = (w: Uint8Array): string => `${((w.reduce((t, v, i) => t + (v && used[i] ? 1 : 0), 0) / count) * 100).toFixed(1)}%`;
  return `skin: ${count} texels of skin; underwear his ${share(worn[0]!)}, hers ${share(worn[1]!)}`;
}

/** Draws `file` into `place` of `out` (linear RGBA, `side` across), returning which texels it covered. */
function placeInto(out: Field, file: string, place: Place): Uint8Array {
  const src = sampled(file);
  const side = out.side;
  const covered = new Uint8Array(side * side);
  const [u0, v0, w, h] = place;
  const px = [0, 0, 0, 0];
  for (let y = Math.floor(v0 * side); y < Math.ceil((v0 + h) * side); y++) for (let x = Math.floor(u0 * side); x < Math.ceil((u0 + w) * side); x++) {
    src.at(((x + 0.5) / side - u0) / w, ((y + 0.5) / side - v0) / h, px);
    for (let c = 0; c < out.channels; c++) out.data[(y * side + x) * out.channels + c] = c < 3 ? px[c]! : px[3]!;
    covered[y * side + x] = 1;
  }
  return covered;
}

function paintEyes(): string {
  const side = 512;
  const n = side * side;
  const colour = field(side, 4);
  const eye = placeInto(colour, EYE, EYES_SHEET.eyes);
  const teeth = placeInto(colour, TEETH, EYES_SHEET.teeth);
  const tongue = placeInto(colour, TONGUE, EYES_SHEET.tongue);
  const used = Uint8Array.from({ length: n }, (_, i) => eye[i]! | teeth[i]! | tongue[i]!);
  const rgb = field(side, 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) rgb.data[i * 3 + c] = colour.data[i * 4 + c]!;
  fill(rgb, used);
  // The iris is dyed by the look's eye colour; the white, the pupil, the teeth and the tongue keep their own.
  const iris = new Uint8Array(n);
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!eye[i]) continue;
    const s = [0, 1, 2].map((c) => fromLinear(rgb.data[i * 3 + c]!));
    const sat = (Math.max(...s) - Math.min(...s)) / Math.max(1, Math.max(...s));
    // The iris is dark and strongly coloured; the white is pale and grey, the pupil black.
    if (sat < 0.5 || Math.max(...s) < 16) continue;
    iris[i] = 1;
    for (let c = 0; c < 3; c++) mean[c]! += rgb.data[i * 3 + c]!;
    count++;
  }
  for (let c = 0; c < 3; c++) mean[c]! /= Math.max(1, count);
  const evened = blurred(Float32Array.from(iris), side, 1);
  const base = field(side, 3);
  const regions = field(side, 6);
  const packed = field(side, 3);
  const normal = field(side, 3);
  for (let i = 0; i < n; i++) {
    const k = evened[i]! > 0.5 ? 1 : 0;
    for (let c = 0; c < 3; c++) base.data[i * 3 + c] = k ? MEAN * Math.min(RATIO[1], Math.max(RATIO[0], rgb.data[i * 3 + c]! / mean[c]!)) : rgb.data[i * 3 + c]!;
    if (k) regions.data[i * 6 + 2] = 1;
    normal.data[i * 3 + 2] = 1;
    packed.data[i * 3] = 1;
    packed.data[i * 3 + 1] = eye[i] ? (k ? 0.12 : 0.16) : teeth[i] ? 0.3 : 0.4;
  }
  write("mh-eyes-base", base, srgb8);
  write("mh-eyes-normal", normal, unit8);
  write("mh-eyes-orm", shrink(packed, 256), byte);
  const { mask, mask2 } = masks(regions, 256);
  write("mh-eyes-mask", mask, (v) => v);
  write("mh-eyes-mask2", mask2, (v) => v);
  return `eyes: iris ${((count / Math.max(1, eye.reduce((t, v) => t + v, 0))) * 100).toFixed(1)}% of the eye picture`;
}

function paintBrows(): string {
  const side = 512;
  const n = side * side;
  const colour = field(side, 4);
  const brows = placeInto(colour, BROWS, BROWS_SHEET.brows);
  placeInto(colour, LASHES, BROWS_SHEET.lashes);
  // Single hairs vanish under a cut-out's mips; each stroke is spread a little and its cover raised, so a brow reads as a brow.
  const spread = blurred(Float32Array.from({ length: n }, (_, i) => colour.data[i * 4 + 3]!), side, 2);
  for (let i = 0; i < n; i++) colour.data[i * 4 + 3] = smooth(0.04, 0.3, Math.max(spread[i]!, colour.data[i * 4 + 3]!));
  // Hair colour sets the tone: each stroke is the hair's colour over the strokes' mean lightness, the lashes a little darker.
  let lit = 0, weight = 0;
  for (let i = 0; i < n; i++) {
    const a = colour.data[i * 4 + 3]!;
    lit += a * luma(colour.data[i * 4]!, colour.data[i * 4 + 1]!, colour.data[i * 4 + 2]!);
    weight += a;
  }
  const mean = Math.max(1e-4, lit / Math.max(1e-6, weight));
  const base = field(side, 4);
  const regions = field(side, 6);
  const packed = field(side, 3);
  const normal = field(side, 3);
  for (let i = 0; i < n; i++) {
    const a = colour.data[i * 4 + 3]!;
    const l = a > 0.02 ? luma(colour.data[i * 4]!, colour.data[i * 4 + 1]!, colour.data[i * 4 + 2]!) : mean;
    const ratio = Math.min(RATIO[1], Math.max(RATIO[0], (l / mean) * (brows[i] ? 1 : 0.6)));
    for (let c = 0; c < 3; c++) base.data[i * 4 + c] = MEAN * ratio;
    base.data[i * 4 + 3] = a;
    regions.data[i * 6 + 3] = 1;
    normal.data[i * 3 + 2] = 1;
    packed.data[i * 3] = 1;
    packed.data[i * 3 + 1] = 0.5;
  }
  write("mh-brows-base", base, (v, c) => (c === 3 ? byte(v) : srgb8(v)));
  write("mh-brows-normal", normal, unit8);
  write("mh-brows-orm", shrink(packed, 256), byte);
  const { mask, mask2 } = masks(regions, 256);
  write("mh-brows-mask", mask, (v) => v);
  write("mh-brows-mask2", mask2, (v) => v);
  return `brows: strokes' mean lightness ${mean.toFixed(3)}`;
}

if (import.meta.main) {
  const bodies = [fitBody("male", RIGS[0]!), fitBody("female", RIGS[1]!)];
  console.log(paintSkin(bodies));
  console.log(paintEyes());
  console.log(paintBrows());
}
