// Paints the strand sheet every hair and beard is drawn with: its left half the solid core's streaks, opaque; its right
// half four cards, cut out by alpha (fine strands, clumps, coils, stubble). Every texel dyes the hair's colour region,
// and its base colour is a ratio about the mean, as the skins' are, so the look's palette colour sets the tone. Nothing
// is read from outside: the strands are drawn from seeded noise. Run it with Bun from the repository; it writes the
// pictures beside the other painted skins.
//
//   bun assets/source/core/humans/hair/paint.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePng, type Picture } from "../../../../../tools/pack/image.ts";
import { Rng } from "../../../../../shared/rng.ts";
import { CARD_KINDS, CORE_U } from "./sheet.ts";

export const SIDE = 1024;
const MASK_SIDE = 512;
const PACKED_SIDE = 512;
/** The base colour's mean where dyed, as light, as the skins' painters have it. */
const MEAN = 0.5;
/** Hair is glossier than skin. */
const ROUGHNESS = 0.48;

const srgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

interface Sheet {
  /** Ratio about the mean colour, alpha, normal x, occlusion, a texel each. */
  ratio: Float32Array;
  alpha: Float32Array;
  lean: Float32Array;
  occlusion: Float32Array;
}

/** Smooth noise along one axis: a sum of seeded sines. */
function streaks(rng: Rng, terms: number, lowest: number): (x: number) => number {
  const parts = Array.from({ length: terms }, (_, k) => ({ f: lowest * 1.9 ** k * (0.8 + rng.float() * 0.4), p: rng.float() * Math.PI * 2, a: 1 / 1.6 ** k }));
  const total = parts.reduce((t, q) => t + q.a, 0);
  return (x) => parts.reduce((t, q) => t + q.a * Math.sin(x * q.f + q.p), 0) / total;
}

/** The core: streaks along the fall, darker towards the root. Opaque. */
function paintCore(s: Sheet): void {
  const rng = new Rng(17);
  const across = streaks(rng, 6, (Math.PI * 2 * 9) / (SIDE * CORE_U));
  const fine = streaks(rng, 4, (Math.PI * 2 * 60) / (SIDE * CORE_U));
  const along = streaks(rng, 3, (Math.PI * 2 * 3) / SIDE);
  const width = Math.round(SIDE * CORE_U);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < width; x++) {
    const i = y * SIDE + x;
    const h = across(x) * 0.6 + fine(x) * 0.4;
    s.ratio[i] = (1 + 0.42 * h + 0.08 * along(y)) * (0.8 + 0.2 * Math.min(1, y / (SIDE * 0.12)));
    s.alpha[i] = 1;
    s.lean[i] = (fine(x + 1) - fine(x - 1)) * 2.5;
    s.occlusion[i] = 0.8 + 0.2 * (h * 0.5 + 0.5);
  }
}

interface Strand {
  /** Centre across the cell at each row, in pixels from the cell's left. */
  x: (v: number) => number;
  width: number;
  from: number;
  to: number;
  shade: number;
}

/** Draws strands into one card's cell, `left` pixels in: alpha is the most any strand covers, colour that strand's. */
function drawStrands(s: Sheet, left: number, cell: number, strands: readonly Strand[]): void {
  for (const st of strands) {
    for (let y = Math.floor(st.from * SIDE); y < Math.min(SIDE, Math.ceil(st.to * SIDE)); y++) {
      const v = (y + 0.5) / SIDE;
      // Thins to nothing over the last fifth of its length.
      const left_ = (st.to - v) / Math.max(1e-3, st.to - st.from);
      const w = st.width * Math.min(1, left_ / 0.2) * Math.min(1, (v - st.from) * SIDE / 3 + 0.3);
      if (w <= 0.05) continue;
      const cx = st.x(v);
      for (let x = Math.floor(cx - w - 1); x <= Math.ceil(cx + w + 1); x++) {
        if (x < 0 || x >= cell) continue;
        const d = Math.abs(x + 0.5 - cx);
        const cover = Math.max(0, Math.min(1, w + 0.5 - d));
        if (cover <= 0) continue;
        const i = y * SIDE + left + x;
        if (cover > s.alpha[i]!) {
          s.alpha[i] = cover;
          s.ratio[i] = st.shade;
          s.lean[i] = Math.max(-0.8, Math.min(0.8, (x + 0.5 - cx) / Math.max(0.6, w)));
          s.occlusion[i] = 0.72 + 0.28 * Math.min(1, v * 3);
        }
      }
    }
  }
}

function paintCards(s: Sheet): void {
  const cell = Math.round((SIDE * (1 - CORE_U)) / CARD_KINDS.length);
  CARD_KINDS.forEach((kind, k) => {
    const rng = new Rng(101 + k * 31);
    const left = Math.round(SIDE * CORE_U) + k * cell;
    const strands: Strand[] = [];
    if (kind === "fine" || kind === "clumps") {
      const count = kind === "fine" ? 46 : 30;
      const clumps = kind === "clumps" ? Array.from({ length: 6 }, () => 8 + rng.float() * (cell - 16)) : [];
      for (let n = 0; n < count; n++) {
        const x0 = 3 + ((n + rng.float()) / count) * (cell - 6);
        const sway = (1 + rng.float() * 2.5) * (rng.float() < 0.5 ? -1 : 1), f = 1 + rng.float() * 2, p = rng.float() * 6.28;
        // A clump's strands lean together towards its tip.
        const to = clumps.length ? clumps.reduce((a, b) => (Math.abs(b - x0) < Math.abs(a - x0) ? b : a)) : x0;
        const pull = kind === "clumps" ? 0.7 : 0;
        strands.push({
          x: (v) => x0 + (to - x0) * pull * v * v + sway * Math.sin(v * f * Math.PI + p),
          width: kind === "fine" ? 0.9 + rng.float() * 0.7 : 1.2 + rng.float() * 0.9,
          from: rng.float() * 0.04, to: 0.8 + rng.float() * 0.2, shade: 0.75 + rng.float() * 0.5,
        });
      }
    } else if (kind === "coils") {
      for (let n = 0; n < 22; n++) {
        const x0 = 4 + ((n + rng.float()) / 22) * (cell - 8);
        const a = 2 + rng.float() * 2.5, f = 26 + rng.float() * 14, p = rng.float() * 6.28;
        strands.push({ x: (v) => x0 + a * Math.sin(v * f * Math.PI + p), width: 1.6 + rng.float() * 1.1, from: rng.float() * 0.03, to: 0.86 + rng.float() * 0.14, shade: 0.7 + rng.float() * 0.5 });
      }
    } else {
      // Stubble: bristles all over, each a millimetre or two along a card.
      for (let n = 0; n < 1500; n++) {
        const x0 = rng.float() * cell, v0 = rng.float() * 0.96, slant = (rng.float() - 0.5) * 0.15;
        strands.push({ x: (v) => x0 + slant * (v - v0) * SIDE, width: 0.7 + rng.float() * 0.5, from: v0, to: v0 + (18 + rng.float() * 22) / SIDE, shade: 0.6 + rng.float() * 0.5 });
      }
    }
    drawStrands(s, left, cell, strands);
  });
}

export function paintSheet(): Sheet {
  const n = SIDE * SIDE;
  const s: Sheet = { ratio: new Float32Array(n).fill(1), alpha: new Float32Array(n), lean: new Float32Array(n), occlusion: new Float32Array(n).fill(1) };
  paintCore(s);
  paintCards(s);
  return s;
}

/** The sheet's five pictures as the material reads them. */
export function sheetPictures(s: Sheet): Record<"base" | "normal" | "orm" | "mask" | "mask2", Picture> {
  const n = SIDE * SIDE;
  const base = new Uint8Array(n * 4), normal = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = byte(srgb(MEAN * s.ratio[i]!));
    base.set([c, c, c, byte(s.alpha[i]!)], i * 4);
    const x = s.lean[i]! * 0.6, z = Math.sqrt(Math.max(0, 1 - x * x));
    normal.set([byte(x * 0.5 + 0.5), 128, byte(z * 0.5 + 0.5)], i * 3);
  }
  const step = SIDE / PACKED_SIDE;
  const orm = new Uint8Array(PACKED_SIDE * PACKED_SIDE * 3);
  for (let y = 0; y < PACKED_SIDE; y++) for (let x = 0; x < PACKED_SIDE; x++) {
    let o = 0;
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) o += s.occlusion[(y * step + dy) * SIDE + x * step + dx]!;
    orm.set([byte(o / (step * step)), byte(ROUGHNESS), 0], (y * PACKED_SIDE + x) * 3);
  }
  // Every texel dyes region 3, the hair's colour: the first channel of the second mask.
  const mask = new Uint8Array(MASK_SIDE * MASK_SIDE * 3);
  const mask2 = new Uint8Array(MASK_SIDE * MASK_SIDE * 3);
  for (let i = 0; i < MASK_SIDE * MASK_SIDE; i++) mask2[i * 3] = 255;
  const pic = (side: number, channels: number, data: Uint8Array): Picture => ({ width: side, height: side, channels, depth: 8, data });
  return { base: pic(SIDE, 4, base), normal: pic(SIDE, 3, normal), orm: pic(PACKED_SIDE, 3, orm), mask: pic(MASK_SIDE, 3, mask), mask2: pic(MASK_SIDE, 3, mask2) };
}

if (import.meta.main) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dir, "../human-bodies/skin");
  mkdirSync(dir, { recursive: true });
  const pictures = sheetPictures(paintSheet());
  for (const [role, p] of Object.entries(pictures)) writeFileSync(join(dir, `strands-${role}.png`), encodePng(p));
  console.log(`strands: wrote ${Object.keys(pictures).length} pictures to ${dir}`);
}
