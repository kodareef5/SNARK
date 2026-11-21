// The damage numbers' glyphs (render/damage-numbers.ts): chunky slanted digits, a "k" and a point, each a few thick strokes
// and rounded rings, drawn by their distance so that one distance gives the fill and a fat dark outline round it at any size,
// with no picture. The shader's text is made from the same tables as its twin here, so the two cannot drift apart.
//
// A glyph is in units where its strokes' middles run from -0.78 to 0.78 up and -0.42 to 0.42 across; a number's card holds
// its glyphs side by side, ADVANCE apart, leaning SLANT to the right as they go up.

/** Stroke radius, outline width beyond it, glyph advance and slant, in glyph units. */
export const STROKE = 0.22;
export const OUTLINE = 0.26;
export const ADVANCE = 1.2;
export const SLANT = 0.16;
/** The card's half height, and its half width past its glyphs, in glyph units: room for the strokes, outline and slant. */
export const HALF_HEIGHT = 0.78 + STROKE + OUTLINE + 0.04;
export const SIDE_PAD = 0.42 + STROKE + OUTLINE + SLANT * HALF_HEIGHT - ADVANCE / 2 + 0.04;
/** Glyphs a card holds at most, and the codes of the two that are not digits. */
export const MOST_GLYPHS = 5;
export const GLYPH_K = 10;
export const GLYPH_POINT = 11;
/** The outline's colour, deep navy, as sRGB 0 to 1. */
export const OUTLINE_RGB = [6 / 255, 18 / 255, 42 / 255] as const;

type Seg = readonly [number, number, number, number];
type Ring = readonly [cx: number, cy: number, hx: number, hy: number];
type Glyph = { segs: readonly Seg[]; rings: readonly Ring[] };

/** A polyline as its segments. */
const line = (...p: number[]): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i + 3 < p.length; i += 2) out.push([p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!]);
  return out;
};

/** 0 to 9, then k and a point. Rounded rings make the bowls; strokes the rest, cut square at the corners for weight. */
export const GLYPHS: readonly Glyph[] = [
  { segs: [], rings: [[0, 0, 0.42, 0.78]] },
  { segs: [...line(-0.24, 0.5, 0.06, 0.78, 0.06, -0.78), ...line(-0.26, -0.78, 0.36, -0.78)], rings: [] },
  { segs: line(-0.42, 0.5, -0.16, 0.78, 0.18, 0.78, 0.42, 0.54, 0.42, 0.26, -0.42, -0.78, 0.44, -0.78), rings: [] },
  { segs: [...line(-0.42, 0.78, 0.4, 0.78, 0.02, 0.12, 0.2, 0.12, 0.42, -0.1, 0.42, -0.54, 0.18, -0.78, -0.42, -0.78)], rings: [] },
  { segs: line(0.22, -0.78, 0.22, 0.78, -0.44, -0.3, 0.46, -0.3), rings: [] },
  { segs: line(0.42, 0.78, -0.36, 0.78, -0.42, 0.06, 0.18, 0.12, 0.42, -0.1, 0.42, -0.54, 0.18, -0.78, -0.42, -0.78), rings: [] },
  { segs: line(0.34, 0.78, -0.08, 0.78, -0.42, 0.4, -0.42, -0.3), rings: [[0, -0.33, 0.42, 0.45]] },
  { segs: line(-0.42, 0.78, 0.44, 0.78, -0.12, -0.78), rings: [] },
  { segs: [], rings: [[0, 0.42, 0.36, 0.36], [0, -0.36, 0.42, 0.42]] },
  { segs: line(0.42, 0.3, 0.42, -0.4, 0.08, -0.78, -0.34, -0.78), rings: [[0, 0.33, 0.42, 0.45]] },
  { segs: [...line(-0.36, 0.78, -0.36, -0.78), ...line(0.4, 0.22, -0.36, -0.28), ...line(-0.1, -0.1, 0.42, -0.78)], rings: [] },
  { segs: [[0, -0.7, 0, -0.7]], rings: [] },
];

/** The glyphs of `n`: its digits up to 99,999, then thousands with a k ("123k"), as many as fit. */
export function glyphsOf(n: number): number[] {
  const v = Math.max(0, Math.floor(n));
  if (v < 100000) return String(v).split("").map(Number);
  const k = Math.min(9999, Math.floor(v / 1000));
  return [...String(k).split("").map(Number), GLYPH_K];
}

/** The glyphs in one 24-bit word, as colour B carries them: the count in its lowest 3 bits, then 4 bits each. */
export function packGlyphs(glyphs: readonly number[]): number {
  const n = Math.min(MOST_GLYPHS, glyphs.length);
  let w = n;
  for (let i = 0; i < n; i++) w |= (glyphs[i]! & 15) << (3 + i * 4);
  return w >>> 0;
}

export function unpackGlyphs(word: number): number[] {
  const n = word & 7;
  return Array.from({ length: n }, (_, i) => (word >>> (3 + i * 4)) & 15);
}

/** The card's half width in glyph units, for `n` glyphs. */
export function halfWidth(n: number): number {
  return (n * ADVANCE) / 2 + SIDE_PAD;
}

const capsule = (px: number, py: number, s: Seg): number => {
  const dx = s[2] - s[0], dy = s[3] - s[1];
  const l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l)) : 0;
  return Math.hypot(px - s[0] - t * dx, py - s[1] - t * dy);
};
const ring = (px: number, py: number, r: Ring): number => {
  const rr = Math.min(r[2], r[3]);
  const qx = Math.abs(px - r[0]) - (r[2] - rr), qy = Math.abs(py - r[1]) - (r[3] - rr);
  return Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr);
};

/** Distance from (x, y), in glyph units about the glyph's middle, to the middle of glyph `g`'s strokes. */
export function glyphDistance(g: number, x: number, y: number): number {
  const glyph = GLYPHS[g];
  if (!glyph) return 1e3;
  let d = 1e3;
  for (const s of glyph.segs) d = Math.min(d, capsule(x, y, s));
  for (const r of glyph.rings) d = Math.min(d, ring(x, y, r));
  return d;
}

/** Distance to the strokes of the number packed in `word` at (x, y) in card units (its middle at 0): the nearest of the glyph under it and its neighbours. */
export function numberDistance(word: number, x: number, y: number): number {
  const n = word & 7;
  const u = x - SLANT * y + (n * ADVANCE) / 2;
  const at = Math.floor(u / ADVANCE);
  let d = 1e3;
  for (let i = at - 1; i <= at + 1; i++) {
    if (i < 0 || i >= n) continue;
    d = Math.min(d, glyphDistance((word >>> (3 + i * 4)) & 15, u - (i + 0.5) * ADVANCE, y));
  }
  return d;
}

/**
 * Twin of the shader's `digitsOf`: at corner (cx, cy) of a card of the number in `word` (each -1 to 1, x across, y up), how
 * much shows (the outline's coverage), the share of the fill over the outline, and its shade (lighter toward the top).
 * `pixel` is a pixel's size in glyph units, for the soft edge.
 */
export function digitsOf(word: number, cx: number, cy: number, pixel: number, out: Float64Array | number[]): void {
  const x = cx * halfWidth(word & 7), y = cy * HALF_HEIGHT;
  const d = numberDistance(word, x, y);
  const w = Math.max(pixel, 1e-4);
  out[0] = Math.max(0, Math.min(1, (STROKE + OUTLINE - d) / w + 0.5));
  out[1] = Math.max(0, Math.min(1, (STROKE - d) / w + 0.5));
  out[2] = 0.86 + 0.22 * Math.max(0, Math.min(1, (y + 0.78) / 1.56));
}

const v = (n: number): string => n.toFixed(4);
const segs = GLYPHS.flatMap((g) => g.segs), rings = GLYPHS.flatMap((g) => g.rings);
const ranges = (key: "segs" | "rings"): string => {
  let at = 0;
  return GLYPHS.map((g) => {
    const r = `ivec2(${at}, ${g[key].length})`;
    at += g[key].length;
    return r;
  }).join(", ");
};

/** The shader's twin of `digitsOf`, made from the same tables; it reads the packed word from vB. */
export const DIGITS_GLSL = `const vec4 GSEG[${segs.length}] = vec4[${segs.length}](${segs.map((s) => `vec4(${s.map(v).join(", ")})`).join(", ")});
const vec4 GRING[${rings.length}] = vec4[${rings.length}](${rings.map((r) => `vec4(${r.map(v).join(", ")})`).join(", ")});
const ivec2 GSEGS[${GLYPHS.length}] = ivec2[${GLYPHS.length}](${ranges("segs")});
const ivec2 GRINGS[${GLYPHS.length}] = ivec2[${GLYPHS.length}](${ranges("rings")});
float glyphDistance(uint g, vec2 p) {
  float d = 1000.0;
  ivec2 s = GSEGS[int(g)];
  for (int i = s.x; i < s.x + s.y; i++) {
    vec4 q = GSEG[i];
    vec2 e = q.zw - q.xy;
    float l = dot(e, e);
    float t = l > 0.0 ? clamp(dot(p - q.xy, e) / l, 0.0, 1.0) : 0.0;
    d = min(d, length(p - q.xy - t * e));
  }
  ivec2 r = GRINGS[int(g)];
  for (int i = r.x; i < r.x + r.y; i++) {
    vec4 q = GRING[i];
    float rr = min(q.z, q.w);
    vec2 k = abs(p - q.xy) - (q.zw - rr);
    d = min(d, abs(length(max(k, 0.0)) + min(max(k.x, k.y), 0.0) - rr));
  }
  return d;
}
vec3 digitsOf(vec2 c) {
  uvec3 b = uvec3(round(vB * 255.0));
  uint word = b.r | (b.g << 8) | (b.b << 16);
  uint n = word & 7u;
  vec2 p = c * vec2(float(n) * ${v(ADVANCE / 2)} + ${v(SIDE_PAD)}, ${v(HALF_HEIGHT)});
  float u = p.x - ${v(SLANT)} * p.y + float(n) * ${v(ADVANCE / 2)};
  int at = int(floor(u / ${v(ADVANCE)}));
  float d = 1000.0;
  for (int i = at - 1; i <= at + 1; i++) {
    if (i < 0 || i >= int(n)) continue;
    d = min(d, glyphDistance((word >> uint(3 + i * 4)) & 15u, vec2(u - (float(i) + 0.5) * ${v(ADVANCE)}, p.y)));
  }
  float w = max(fwidth(d), 0.0001);
  return vec3(clamp((${v(STROKE + OUTLINE)} - d) / w + 0.5, 0.0, 1.0), clamp((${v(STROKE)} - d) / w + 0.5, 0.0, 1.0), 0.86 + 0.22 * clamp((p.y + 0.78) / 1.56, 0.0, 1.0));
}
const vec3 DIGITS_OUTLINE = vec3(${OUTLINE_RGB.map(v).join(", ")});
`;
