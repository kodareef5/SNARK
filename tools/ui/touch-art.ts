// Cuts the touch controls' sheet (client/core/ui/touch-art.ts) from the generated pictures in assets/source/ui/touch.
//
// Each picture is glass and glow on pure black, and black becomes transparency: a pixel's alpha is its brightest channel
// and its colour is brought back up, so over black it is the picture again and over anything else its glow fades evenly.
// A body gets dark glass under it, or it would vanish against a bright sky.
//
// Every part is measured before it is placed. A body's edge is where its rim rises steepest, which is the same place
// for a part at rest and its lit twin whose glow is wider, so a button does not change size as it is pressed. Parts are
// brought to the sheet's size with a Lanczos filter, a pill is laid out so that its ends are slices of a fixed size,
// glyphs are sized by eye (by area, within a box) and every cell fades to nothing at its border. What was placed is
// measured again and the tool fails if a body is off its size or its centre.
//
//   bun tools/ui/touch-art.ts          writes assets/source/ui/touch.png, and touch.webp for the build where cwebp is here

import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BODY, GLYPH, ICON, ICONS, ICON_COLUMNS, ICON_Y, PART, PILL_BODY, PILL_H, PILL_W, PILL_Y, P_KNOB, P_RING, P_ROUND, P_ROUND_LIT, P_SQUARE, P_SQUARE_LIT, TOUCH_HEIGHT, TOUCH_WIDTH } from "../../client/core/ui/touch-art.ts";
import { readPng } from "../pack/png-read.ts";
import { encodePng } from "../snap/png.ts";

const SOURCE = resolve(import.meta.dir, "../../assets/source/ui/touch");
/** The sheet as cut, kept whole, and the copy the build ships. */
export const TOUCH_SHEET = resolve(import.meta.dir, "../../assets/source/ui/touch.png");
export const TOUCH_SHIPPED = resolve(import.meta.dir, "../../assets/source/ui/touch.webp");
/** What counts as black in a picture, of 1: its darkest corner reads a little over nothing. */
const BLACK = 0.04;
/**
 * The share of a rim's brightness at which its edge is taken. A glow that bright beside its rim would be taken for it,
 * which is what measuring each part again once it is placed is there to catch.
 */
const RIM_SHARE = 0.8;
/** A glyph's core, of 1. */
const CORE = 0.3;
/** How much a picture's light is brought up for the sheet, so that a rim is solid and a glow carries. */
const GAIN = 1.2;
/** The dark glass under a body. */
const UNDER = [6 / 255, 28 / 255, 66 / 255] as const;
/** How far a placed body may measure from its size, as a share of it (a rim a few pixels thick is measured to about one), and pixels off its cell's middle. */
const SIZE_SLACK = 0.03, CENTRE_SLACK = 2;

export interface Picture { width: number; height: number; channels: number; data: Uint8Array }
/** Premultiplied RGBA, 0 to 1. */
export interface Layer { w: number; h: number; data: Float32Array }
type Region = readonly [x: number, y: number, w: number, h: number];
export type Shape = "disc" | "square" | "pill" | "ring";
export interface Box { l: number; t: number; r: number; b: number }

export const smooth = (lo: number, hi: number, v: number): number => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

/** A region of a picture as light over nothing. */
export function lift(p: Picture, [x0, y0, w, h]: Region, gain: number): Layer {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = ((y0 + y) * p.width + x0 + x) * p.channels, r = p.data[at]! / 255, g = p.data[at + 1]! / 255, b = p.data[at + 2]! / 255;
    const top = Math.max(r, g, b), lum = Math.max(0, (top - BLACK) / (1 - BLACK));
    if (lum <= 0) continue;
    // Its colour at full strength, times how much of it there is.
    const a = Math.min(1, lum ** 0.9 * gain), k = a / top, o = (y * w + x) * 4;
    data[o] = r * k; data[o + 1] = g * k; data[o + 2] = b * k; data[o + 3] = a;
  }
  return { w, h, data };
}

/** How bright the layer is along a line through `at`, averaged over a band `band` wide: across (`row`) or down. */
function profile(l: Layer, row: boolean, at: number, band: number): Float32Array {
  const n = row ? l.w : l.h, out = new Float32Array(n), from = Math.max(0, Math.round(at - band / 2)), to = Math.min(row ? l.h : l.w, from + band);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = from; k < to; k++) { const o = ((row ? k : i) * l.w + (row ? i : k)) * 4; sum += Math.max(l.data[o]!, l.data[o + 1]!, l.data[o + 2]!); }
    out[i] = sum / Math.max(1, to - from);
  }
  return out;
}

/**
 * Where a rim's outer edge is along a profile, coming in from its start (`step` 1) or its end (-1), to a part of a
 * pixel. A glow rises gently for a long way and the rim steeply: the rim is found by the first rise at least half as
 * steep as the steepest, and its edge is where the profile reaches most of the rim's own brightness (RIM_SHARE), which is
 * the same place at any size and for a lit part's wider glow.
 */
function rise(p: Float32Array, step: number): number {
  const n = p.length, reach = Math.max(1, Math.round(n / 170)), at = (i: number): number => p[Math.max(0, Math.min(n - 1, i))]!;
  const grad = (i: number): number => at(i + step * reach) - at(i - step * reach);
  let most = 0, found = -1;
  for (let i = 0; i < n / 2; i++) most = Math.max(most, grad(step > 0 ? i : n - 1 - i));
  for (let i = 0; i < n / 2 && found < 0; i++) if (grad(step > 0 ? i : n - 1 - i) >= most * 0.5) found = step > 0 ? i : n - 1 - i;
  if (found < 0) throw new Error("no edge found");
  let peak = 0;
  for (let k = 0; k <= n / 20; k++) peak = Math.max(peak, at(found + step * k));
  for (let i = found - step * Math.ceil(n / 30); ; i += step) {
    if (at(i) < peak * RIM_SHARE) continue;
    const before = at(i - step);
    return i - step * (before < at(i) ? (at(i) - peak * RIM_SHARE) / (at(i) - before) : 0) + 0.5;
  }
}

/**
 * The box of a body: its rim's outer edge each way, measured through its middle. Measure a layer lifted as the sheet's
 * is (GAIN) and before any glass goes under it: a thin rim is then solid, and stays the brightest thing in its line
 * when the part is made smaller, where a rim lifted plainly fades toward its glow.
 */
export function body(l: Layer): Box {
  // The middle of what is bright, then twice: the second measure runs through the first's middle.
  let cx = l.w / 2, cy = l.h / 2, box: Box = { l: 0, t: 0, r: l.w, b: l.h };
  for (let pass = 0; pass < 2; pass++) {
    // A band wide enough to average a rim's grain, and narrow enough that a round rim does not curve away within it.
    const across = profile(l, true, cy, l.h * 0.06), down = profile(l, false, cx, l.w * 0.06);
    box = { l: rise(across, 1), r: rise(across, -1), t: rise(down, 1), b: rise(down, -1) };
    cx = (box.l + box.r) / 2; cy = (box.t + box.b) / 2;
  }
  return box;
}

/** The box of everything in the layer at least `level` bright. */
export function extent(l: Layer, level: number): Box {
  let x0 = l.w, y0 = l.h, x1 = -1, y1 = -1;
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) if (l.data[(y * l.w + x) * 4 + 3]! >= level) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) throw new Error("nothing bright in the region");
  return { l: x0, t: y0, r: x1 + 1, b: y1 + 1 };
}

/** A rounded square's corner, from how far in along its diagonal the rim is. */
export function corner(l: Layer, b: Box): number {
  const side = Math.min(b.r - b.l, b.b - b.t), n = Math.floor(side / 2), x0 = Math.round(b.l), y0 = Math.round(b.t), diagonal = new Float32Array(n);
  for (let i = 0; i < n; i++) { const o = ((y0 + i) * l.w + x0 + i) * 4; diagonal[i] = Math.max(l.data[o]!, l.data[o + 1]!, l.data[o + 2]!); }
  // A corner of radius r meets the diagonal r less r over root 2 in from the box's corner, along each axis.
  return Math.max(side * 0.1, Math.min(side * 0.5, rise(diagonal, 1) / (1 - Math.SQRT1_2)));
}

/** How far inside `shape`, fitted to `b`, the point is, in pixels; negative outside. */
function inside(shape: Shape, b: Box, radius: number, x: number, y: number): number {
  const w = b.r - b.l, h = b.b - b.t, r = shape === "disc" ? Math.min(w, h) / 2 : shape === "pill" ? h / 2 : radius;
  const qx = Math.abs(x - (b.l + b.r) / 2) - w / 2 + r, qy = Math.abs(y - (b.t + b.b) / 2) - h / 2 + r;
  return r - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
}

/** Dark glass under the body, `much` of it, where the picture's own light does not already cover. */
export function underlay(l: Layer, shape: Shape, b: Box, radius: number, much: number): void {
  if (shape === "ring" || much <= 0) return;
  for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
    const o = (y * l.w + x) * 4, glass = much * smooth(1.5, 5, inside(shape, b, radius, x + 0.5, y + 0.5)) * (1 - l.data[o + 3]!);
    if (glass <= 0) continue;
    l.data[o] = l.data[o]! + UNDER[0] * glass; l.data[o + 1] = l.data[o + 1]! + UNDER[1] * glass; l.data[o + 2] = l.data[o + 2]! + UNDER[2] * glass; l.data[o + 3] = l.data[o + 3]! + glass;
  }
}

const lanczos = (x: number): number => { if (x === 0) return 1; if (Math.abs(x) >= 3) return 0; const p = Math.PI * x; return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p); };

/** One way of a Lanczos resize: `n` samples of `src` spaced `1 / scale` apart, the first centred on `first`. */
function resample(src: Float32Array, srcN: number, stride: number, lines: number, lineStride: number, n: number, first: number, scale: number): Float32Array {
  const out = new Float32Array(n * lines * 4), wide = Math.max(1, 1 / scale), reach = Math.ceil(3 * wide);
  for (let i = 0; i < n; i++) {
    const centre = first + i / scale, from = Math.floor(centre - reach), to = Math.ceil(centre + reach);
    let total = 0;
    for (let k = from; k <= to; k++) total += lanczos((k + 0.5 - centre) / wide);
    for (let line = 0; line < lines; line++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = from; k <= to; k++) {
        if (k < 0 || k >= srcN) continue;
        const wgt = lanczos((k + 0.5 - centre) / wide) / total, o = line * lineStride + k * stride;
        r += src[o]! * wgt; g += src[o + 1]! * wgt; b += src[o + 2]! * wgt; a += src[o + 3]! * wgt;
      }
      const o = (line * n + i) * 4;
      out[o] = Math.max(0, r); out[o + 1] = Math.max(0, g); out[o + 2] = Math.max(0, b); out[o + 3] = Math.max(0, Math.min(1, a));
    }
  }
  return out;
}

/** The layer scaled by `sx` across and `sy` down into `w` by `h`, with the layer's point `cx`, `cy` at the middle. */
export function resize(l: Layer, sx: number, sy: number, w: number, h: number, cx: number, cy: number): Layer {
  // Across, into a layer `w` wide and as tall as the source; then down. Lines are rows first, then columns.
  const across = resample(l.data, l.w, 4, l.h, l.w * 4, w, cx - (w / 2 - 0.5) / sx, sx);
  const columns = new Float32Array(w * l.h * 4);
  for (let y = 0; y < l.h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) columns[(x * l.h + y) * 4 + c] = across[(y * w + x) * 4 + c]!;
  const down = resample(columns, l.h, 4, w, l.h * 4, h, cy - (h / 2 - 0.5) / sy, sy);
  const data = new Float32Array(w * h * 4);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = down[(x * h + y) * 4 + c]!;
  return { w, h, data };
}

const sheet = new Float32Array(TOUCH_WIDTH * TOUCH_HEIGHT * 4);
const report: string[] = [];

/** Puts the layer in the sheet at `x`, `y`, fading to nothing over the last sixteenth of the cell each way. */
function place(l: Layer, x: number, y: number): void {
  const margin = Math.min(l.w, l.h) / 16;
  for (let j = 0; j < l.h; j++) for (let i = 0; i < l.w; i++) {
    const edge = smooth(0, margin, Math.min(i + 0.5, j + 0.5, l.w - i - 0.5, l.h - j - 0.5)), o = (j * l.w + i) * 4, at = ((y + j) * TOUCH_WIDTH + x + i) * 4;
    for (let c = 0; c < 4; c++) sheet[at + c] = l.data[o + c]! * edge;
  }
}

/** Checks a placed body against its cell, `w` by `h` wanted in the middle: `seen` is it without its glass, as it was measured, and `l` as it is placed. */
function check(name: string, seen: Layer, l: Layer, w: number, h: number): void {
  const b = body(seen), dw = b.r - b.l - w, dh = b.b - b.t - h, dx = (b.l + b.r) / 2 - l.w / 2, dy = (b.t + b.b) / 2 - l.h / 2;
  let border = 0;
  for (let i = 0; i < l.w; i++) border = Math.max(border, l.data[i * 4 + 3]!, l.data[((l.h - 1) * l.w + i) * 4 + 3]!);
  for (let j = 0; j < l.h; j++) border = Math.max(border, l.data[j * l.w * 4 + 3]!, l.data[(j * l.w + l.w - 1) * 4 + 3]!);
  report.push(`${name.padEnd(12)} body ${(b.r - b.l).toFixed(1)} by ${(b.b - b.t).toFixed(1)} (wanted ${w.toFixed(1)} by ${h.toFixed(1)}), off centre ${dx.toFixed(1)}, ${dy.toFixed(1)}, glow at the cell's border ${(border * 255).toFixed(1)} of 255`);
  if (Math.abs(dw) > w * SIZE_SLACK || Math.abs(dh) > h * SIZE_SLACK || Math.abs(dx) > CENTRE_SLACK || Math.abs(dy) > CENTRE_SLACK) throw new Error(`${name} is not where its cell wants it: ${report.at(-1)}`);
}

/** A round or square part: measured, given its glass, sized so that its body is BODY of the cell, and placed in column `column`. */
function part(name: string, p: Picture, region: Region, column: number, shape: Shape, glass: number): void {
  const seen = lift(p, region, GAIN), l = lift(p, region, GAIN), b = body(seen), radius = shape === "square" ? corner(seen, b) : 0;
  underlay(l, shape, b, radius, glass);
  // Each way by its own measure: a generated disc is a few parts in a hundred off round, and a part at rest and its
  // lit twin are off by different amounts, which a press would show as a change of shape.
  const want = PART * BODY;
  const sized = (layer: Layer): Layer => resize(layer, want / (b.r - b.l), want / (b.b - b.t), PART, PART, (b.l + b.r) / 2, (b.t + b.b) / 2);
  const out = sized(l);
  check(name, sized(seen), out, want, want);
  place(out, column * PART, 0);
}

/**
 * A pill: sized by its height, then laid out so that its body is exactly PILL_BODY wide. Its two ends keep their shape
 * and the straight run between them is stretched or squeezed to fit, which a straight run does not show.
 */
function pill(name: string, p: Picture, region: Region, at: number, glass: number): void {
  const seen = lift(p, region, GAIN), l = lift(p, region, GAIN), b = body(seen);
  underlay(l, "pill", b, 0, glass);
  const high = PILL_H * BODY, scale = high / (b.b - b.t), wide = Math.round((b.r - b.l) * scale);
  const laid = (layer: Layer): Layer => {
    // The whole pill at the sheet's scale, wide enough for its glow.
    const fair = resize(layer, scale, scale, wide + PILL_H, PILL_H, (b.l + b.r) / 2, (b.t + b.b) / 2);
    const out: Layer = { w: PILL_W, h: PILL_H, data: new Float32Array(PILL_W * PILL_H * 4) };
    // An end is the round part and a little of the straight; between the ends the columns are spread evenly.
    const end = high * 0.62, from = (fair.w - wide) / 2, to = (PILL_W - PILL_BODY) / 2;
    for (let x = 0; x < PILL_W; x++) {
      const d = x + 0.5 - to;
      const s = d < end ? from + d : d > PILL_BODY - end ? from + wide - (PILL_BODY - d) : from + end + ((d - end) / (PILL_BODY - end * 2)) * (wide - end * 2);
      const k = Math.max(0, Math.min(fair.w - 1.001, s - 0.5)), k0 = Math.floor(k), f = k - k0;
      for (let y = 0; y < PILL_H; y++) for (let c = 0; c < 4; c++) out.data[(y * PILL_W + x) * 4 + c] = s < 0 || s > fair.w ? 0 : fair.data[(y * fair.w + k0) * 4 + c]! * (1 - f) + fair.data[(y * fair.w + k0 + 1) * 4 + c]! * f;
    }
    return out;
  };
  const out = laid(l);
  check(name, laid(seen), out, PILL_BODY, high);
  place(out, at, PILL_Y);
}

/** A glyph: sized by eye, so that a long thin one and a square one weigh the same, and never past GLYPH of its cell. */
function glyph(n: number, p: Picture, region: Region): void {
  const l = lift(p, region, GAIN), b = extent(l, CORE), w = b.r - b.l, h = b.b - b.t;
  const scale = Math.min((ICON * GLYPH) / Math.max(w, h), (ICON * GLYPH * 0.8) / Math.sqrt(w * h));
  place(resize(l, scale, scale, ICON, ICON, (b.l + b.r) / 2, (b.t + b.b) / 2), (n % ICON_COLUMNS) * ICON, ICON_Y + Math.floor(n / ICON_COLUMNS) * ICON);
}

/** The sheet as straight RGBA, or null where the generated pictures are not installed. */
export function touchSheet(): Uint8ClampedArray | null {
  const names = ["controls-1.png", "controls-2.png", "icons-1.png", "icons-2.png", "icons-3.png"].map((n) => resolve(SOURCE, n));
  if (!names.every((n) => existsSync(n))) return null;
  const [c1, c2, ...icons] = names.map((n) => readPng(n) as Picture) as [Picture, Picture, ...Picture[]];
  const half = c1.width / 2, band = c2.height / 4;
  part("round", c1, [0, 0, half, half], P_ROUND, "disc", 0.55);
  part("round lit", c1, [half, 0, half, half], P_ROUND_LIT, "disc", 0.35);
  part("ring", c1, [0, half, half, half], P_RING, "ring", 0);
  // The knob rides over the ring, which would show through it as a scratch: its glass is nearly whole.
  part("knob", c1, [half, half, half, half], P_KNOB, "disc", 0.8);
  pill("pill", c2, [0, 0, c2.width, band], 0, 0.55);
  pill("pill lit", c2, [0, band, c2.width, band], PILL_W, 0.35);
  part("square", c2, [0, band * 2, c2.width, band], P_SQUARE, "square", 0.55);
  part("square lit", c2, [0, band * 3, c2.width, band], P_SQUARE_LIT, "square", 0.35);
  icons.forEach((p, s) => {
    const cell = p.width / 4;
    for (let k = 0; k < 16 && s * 16 + k < ICONS; k++) glyph(s * 16 + k, p, [(k % 4) * cell, Math.floor(k / 4) * cell, cell, cell]);
  });
  const out = new Uint8ClampedArray(sheet.length);
  for (let i = 0; i < sheet.length; i += 4) {
    const a = Math.min(1, sheet[i + 3]!);
    if (a < 0.5 / 255) continue;
    out[i] = (sheet[i]! / a) * 255; out[i + 1] = (sheet[i + 1]! / a) * 255; out[i + 2] = (sheet[i + 2]! / a) * 255; out[i + 3] = a * 255;
  }
  return out;
}

if (import.meta.main) {
  const pixels = touchSheet();
  if (!pixels) throw new Error(`the generated pictures are not in ${SOURCE}`);
  for (const line of report) console.log(line);
  writeFileSync(TOUCH_SHEET, encodePng(TOUCH_WIDTH, TOUCH_HEIGHT, pixels));
  console.log(`${TOUCH_SHEET}: ${TOUCH_WIDTH} by ${TOUCH_HEIGHT}, ${statSync(TOUCH_SHEET).size} bytes`);
  // The build ships the smaller copy. Its alpha is kept exactly, since that is where a glow's evenness lives.
  const made = Bun.spawnSync(["cwebp", "-quiet", "-q", "90", "-alpha_q", "100", "-m", "6", "-sharp_yuv", TOUCH_SHEET, "-o", TOUCH_SHIPPED]);
  if (made.exitCode === 0) console.log(`${TOUCH_SHIPPED}: ${statSync(TOUCH_SHIPPED).size} bytes`);
  else console.log("cwebp is not here: the build will ship the PNG");
}
