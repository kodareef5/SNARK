// A print on a garment as SURFACE draws it (prints.ts holds the pictures). A print is a picture in a layer of the prints'
// array, laid on its cut's print sheet, which is the cut's one UV map, as the Wardrobe page lays it (client/admin/
// wardrobe.ts paintPlace): in a rectangle from its corner `u`, `v` (v down from the top), its width the rectangle's
// times `scale`, its height by the picture's own shape, turned `turn` radians counter-clockwise about the rectangle's
// middle, and cut to the rectangle. A layer holds its picture premultiplied, as sRGB, stretched to the layer's square.
// Where it lies the print is the cloth's colour, its ink over the dyed cloth by its alpha, kept as bright as the weave
// under it, before the light. The dye does not reach the ink. Drawn as swatches (the governor's step), a print is its
// picture's mean colour, its last level, over where the picture lies.
//
// The maths is here twice, as GLSL and as a function the software rasterizer runs, from the same table of numbers.

/** The floats of a layer's row of the prints' table: where it lies (two fours), then its picture's mean colour. */
export const PRINT_FLOATS = 12;
/** The most layers a tier's prints' array has (tiers.ts `prints`). */
export const MAX_PRINT_LAYERS = 64;
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Where a print lies on its sheet (shared/people/doc.ts PrintPlace). */
export interface Placed {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
  readonly turn: number;
}

/**
 * Layer `k`'s row of the prints' table into `out`: the rectangle's corner and the inverse of its size, which take a
 * point of the sheet to the rectangle, -0.5 to 0.5 from its middle; the two rows that take that to the picture, 0 to 1
 * across and down; and the picture's mean colour, premultiplied, as light, and how much of it is covered. `aspect` is
 * the picture's height over its width.
 */
export function printRow(out: Float32Array, k: number, place: Placed, aspect: number, mean: ArrayLike<number>): void {
  const at = k * PRINT_FLOATS, { u, v, w, h, scale, turn } = place;
  const pw = w * scale, ph = pw * aspect, c = Math.cos(turn), s = Math.sin(turn);
  out[at] = u;
  out[at + 1] = v;
  out[at + 2] = 1 / w;
  out[at + 3] = 1 / h;
  out[at + 4] = (c * w) / pw;
  out[at + 5] = (-s * h) / pw;
  out[at + 6] = (s * w) / ph;
  out[at + 7] = (c * h) / ph;
  for (let i = 0; i < 4; i++) out[at + 8 + i] = mean[i]!;
}

/** A print's picture on the CPU: its levels as light, premultiplied, smallest first, level k 1 << k texels a side. */
export interface PrintPicture {
  readonly levels: readonly Float32Array[];
}

const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/**
 * A layer's picture as the card holds it, from `bytes`, `side` texels a side, RGBA premultiplied sRGB: its colour as
 * light, and each level the mean of four texels of the one above, as the card makes them by halving.
 */
export function printPicture(bytes: Uint8Array, side: number): PrintPicture {
  const top = new Float32Array(side * side * 4);
  for (let i = 0; i < top.length; i++) top[i] = (i & 3) === 3 ? bytes[i]! / 255 : TO_LINEAR[bytes[i]!]!;
  const levels = [top];
  for (let s = side >> 1; s >= 1; s >>= 1) {
    const up = levels[0]!, n = s * 2, out = new Float32Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 4; c++) {
      const a = ((2 * y) * n + 2 * x) * 4 + c;
      out[(y * s + x) * 4 + c] = (up[a]! + up[a + 4]! + up[a + n * 4]! + up[a + n * 4 + 4]!) / 4;
    }
    levels.unshift(out);
  }
  return { levels };
}

/** The mean of `bytes`, RGBA premultiplied sRGB, as light, premultiplied, and the share covered: what printRow takes. */
export function printMean(bytes: Uint8Array, out: Float64Array | number[] = [0, 0, 0, 0]): Float64Array | number[] {
  const sum = [0, 0, 0, 0], n = bytes.length / 4;
  for (let i = 0; i < bytes.length; i++) sum[i & 3]! += (i & 3) === 3 ? bytes[i]! / 255 : TO_LINEAR[bytes[i]!]!;
  for (let c = 0; c < 4; c++) out[c] = sum[c]! / Math.max(1, n);
  return out;
}

function bilinear(p: PrintPicture, k: number, u: number, v: number, weight: number, out: Float64Array): void {
  const size = 1 << k, t = p.levels[k]!;
  const x = u * size - 0.5, y = v * size - 0.5;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  // Clamped at the edge, as the card's array is.
  const x0 = Math.min(Math.max(Math.floor(x), 0), size - 1), x1 = Math.min(Math.max(Math.floor(x) + 1, 0), size - 1);
  const y0 = Math.min(Math.max(Math.floor(y), 0), size - 1), y1 = Math.min(Math.max(Math.floor(y) + 1, 0), size - 1);
  const a = (y0 * size + x0) * 4, b = (y0 * size + x1) * 4, c = (y1 * size + x0) * 4, d = (y1 * size + x1) * 4;
  const wa = weight * (1 - fx) * (1 - fy), wb = weight * fx * (1 - fy), wc = weight * (1 - fx) * fy, wd = weight * fx * fy;
  for (let i = 0; i < 4; i++) out[i]! += t[a + i]! * wa + t[b + i]! * wb + t[c + i]! * wc + t[d + i]! * wd;
}

/** Samples `p` at `u`, `v` as the card filters between texels and levels; `spread` is log2 of the picture's width one pixel crosses. */
export function samplePrint(p: PrintPicture, u: number, v: number, spread: number, out: Float64Array): void {
  const top = p.levels.length - 1;
  const level = top + spread > 0 ? Math.min(top + spread, top) : 0;
  const whole = Math.floor(level);
  out.fill(0);
  bilinear(p, top - whole, u, v, 1 - (level - whole), out);
  if (level > whole) bilinear(p, top - whole - 1, u, v, level - whole, out);
}

const ink = new Float64Array(4);

/**
 * `cloth`, the dyed colour, with layer `k`'s print over it at sheet point `u`, `v`, into `cloth`. `ux`, `vx`, `uy`, `vy`
 * are how far the sheet point moves to the next pixel right and down, which choose the level read. `base` is the
 * material's base colour as light and `grey` its mean brightness, by which the ink keeps the weave. With `swatch` the
 * print is its picture's last level, its mean. `picture` is null where the layer holds none, which draws no print.
 */
export function printedOver(cloth: Float64Array | number[], base: ArrayLike<number>, grey: number, table: Float32Array, k: number, picture: PrintPicture | null, swatch: boolean, u: number, v: number, ux: number, vx: number, uy: number, vy: number): void {
  if (k < 0 || !picture) return;
  const at = k * PRINT_FLOATS;
  const az = table[at + 2]!, aw = table[at + 3]!;
  const rx = (u - table[at]!) * az - 0.5, ry = (v - table[at + 1]!) * aw - 0.5;
  const m0 = table[at + 4]!, m1 = table[at + 5]!, m2 = table[at + 6]!, m3 = table[at + 7]!;
  const qx = m0 * rx + m1 * ry + 0.5, qy = m2 * rx + m3 * ry + 0.5;
  if (!(Math.abs(rx) <= 0.5 && Math.abs(ry) <= 0.5 && Math.abs(qx - 0.5) <= 0.5 && Math.abs(qy - 0.5) <= 0.5)) return;
  if (swatch) samplePrint(picture!, qx, qy, 16, ink);
  else {
    const dxx = m0 * ux * az + m1 * vx * aw, dxy = m2 * ux * az + m3 * vx * aw;
    const dyx = m0 * uy * az + m1 * vy * aw, dyy = m2 * uy * az + m3 * vy * aw;
    samplePrint(picture!, qx, qy, Math.log2(Math.max(Math.hypot(dxx, dxy), Math.hypot(dyx, dyy))), ink);
  }
  const weave = (base[0]! * LUMA[0] + base[1]! * LUMA[1] + base[2]! * LUMA[2]) / Math.max(grey, 0.01);
  for (let c = 0; c < 3; c++) cloth[c] = cloth[c]! * (1 - ink[3]!) + ink[c]! * weave;
}

const fl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * `printedOver` as GLSL, for a SURFACE text drawn with prints: the layer is the instance's third region byte, 0 for none.
 * The vertex text reads the layer's row of the table and folds it into sums of the sheet point, handed on flat, so a
 * pixel does the least: on the Intel GPU each instruction here shows over a screen of prints, and the same sums handed
 * on blended cost more. A swatch is the picture's last level, its mean. PRINT_LAYERS is the tier's layers, which the
 * program defines.
 */
export const PRINT_VERTEX = `uniform vec4 uPrintTable[PRINT_LAYERS * 3];
flat out vec4 vPrintAt, vPrintTurn, vPrintOff;
`;
/**
 * What the vertex text's main does for a print, from the instance's region bytes `iRegA`: the sums that take a sheet
 * point to the rectangle, `vPrintAt`, and to the picture, `vPrintTurn` and `vPrintOff`, then its layer, -1 for none,
 * and what the weave is divided by.
 */
export const PRINT_VERTEX_MAIN = `  int print = int(iRegA.z) - 1;
  vec4 printAt = uPrintTable[clamp(print, 0, PRINT_LAYERS - 1) * 3], printTurn = uPrintTable[clamp(print, 0, PRINT_LAYERS - 1) * 3 + 1];
  vec2 printFrom = -printAt.xy * printAt.zw - 0.5;
  vPrintAt = vec4(printAt.zw, printFrom);
  vPrintTurn = vec4(printTurn.xy * printAt.zw, printTurn.zw * printAt.zw);
  vPrintOff = vec4(dot(printTurn.xy, printFrom) + 0.5, dot(printTurn.zw, printFrom) + 0.5, print >= 0 && print < PRINT_LAYERS ? float(print) : -1.0, 1.0 / max(uGrey, 0.01));
`;
export const PRINT_GLSL = `uniform highp sampler2DArray uPrints;
uniform float uPrintSwatch;
flat in vec4 vPrintAt, vPrintTurn, vPrintOff;
vec3 printedOver(vec3 cloth, vec3 base, vec2 uv) {
  if (vPrintOff.z < -0.5) return cloth;
  vec2 r = uv * vPrintAt.xy + vPrintAt.zw;
  vec2 q = vec2(dot(vPrintTurn.xy, uv), dot(vPrintTurn.zw, uv)) + vPrintOff.xy;
  vec4 ink = uPrintSwatch > 0.5 ? textureLod(uPrints, vec3(q, vPrintOff.z), 16.0) : texture(uPrints, vec3(q, vPrintOff.z));
  vec4 off = abs(vec4(r, q - 0.5));
  float inside = step(max(max(off.x, off.y), max(off.z, off.w)), 0.5);
  return cloth * (1.0 - ink.a * inside) + ink.rgb * (dot(base, vec3(${LUMA.map(fl).join(", ")})) * vPrintOff.w * inside);
}
`;
