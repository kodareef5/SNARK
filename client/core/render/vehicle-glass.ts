// A vehicle's glass where its own mesh holds the pane (content/vehicles/glass.ts): seen through, at no cost but a few
// sums on the pane. The pane is drawn in the opaque pass with the rest of its material, cut out, and covers half of
// each pixel. Where the frame has samples (fGlass.x), it covers one of a pixel's two (two of four on a canvas), so the
// samples' resolve blends it evenly with what is behind; where it has none, as a supersampled light target has not, it
// keeps every other pixel by the 4 by 4 pattern the fades use (hand.ts FADE_ORDER), which the canvas's larger picture
// blends as it is drawn to the screen. Half and no other share: a share kept by a pattern over pixels, as the fades keep
// theirs, read on a pane as a mesh of dots, and an even half reads as tinted glass. Nothing is sorted or blended and no
// draw is added: the seats, the wheel and whoever sits behind the pane are drawn as they were, and show in the rest.
// The pane's half is lit as before, sun, lamp and sky, and mirrors the street by what the glass sends back of the light
// by the angle it is seen at (a windscreen card's optics, windscreens.ts paneOptics), over the half it covers. Its
// shadow is the mesh's as before. Flat levels have no texture coordinates, so a far vehicle's glass stays solid.
//
// The maths is here twice, as functions on numbers for the software rasterizer and as GLSL for SURFACE.
import { GLASS } from "../../../content/vehicles/glass.ts";
import { FADE_ORDER } from "./hand.ts";
import { DRAW_CUTOUT, type FramePacket } from "./packet.ts";

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** Each material's glass set, by its id: its place in GLASS plus one, 0 for none. */
export function glassSet(id: string): number {
  return GLASS.findIndex((g) => g.materials.includes(id)) + 1;
}

/**
 * A draw's optics (packet.ts drawOptics): bit 0 a wheel's crowned spokes, the next six its material's glass set, and
 * OPTICS_CUT where the draw is cut out only for its glass.
 */
export const OPTICS_CUT = 128;
export const opticsGlass = (optics: number): number => (optics >> 1) & 63;
/** The draw's optics with no glass, and its flags as they were without it, for `?off=glass` (passes.ts). */
export function withoutGlass(p: Pick<FramePacket, "drawOptics" | "drawFlags">, d: number): void {
  if ((p.drawOptics[d]! & OPTICS_CUT) !== 0) p.drawFlags[d]! &= ~DRAW_CUTOUT;
  p.drawOptics[d]! &= 1;
}

/** How far forward a face of a vehicle with a windscreen card may turn and still be one of its panes (GlassCells.card). */
export const CARD_FORWARD = 0.3;

/**
 * Whether texel (u, v) of a material of glass set `set` lies on a pane, on a face whose rest normal turns `forward`
 * toward the vehicle's front. Its pictures repeat, as every material's do.
 */
export function glassAt(set: number, u: number, v: number, forward: number): boolean {
  const g = GLASS[set - 1];
  if (!g || (g.card && forward > CARD_FORWARD)) return false;
  u -= Math.floor(u);
  v -= Math.floor(v);
  return g.cells.some((c) => u >= c[0] && u < c[2] && v >= c[1] && v < c[3]);
}

/** The share of the light a pane sends back seen at `cosine` from its face, with the street look's `gloss`: a windscreen card's from outside. */
export function glassReflected(cosine: number, gloss: number): number {
  const grazing = (1 - Math.min(1, Math.abs(cosine))) ** 3;
  return Math.min(0.86, (0.07 + 0.74 * grazing) * (1 + gloss * 0.45));
}

/**
 * How much of window pixel (x, y), counted from the bottom left, a pane covers: half its samples where the frame has
 * them, and where it has not all of every other pixel. SURFACE's `glassCovers` twin.
 */
export function glassCovers(samples: boolean, x: number, y: number): number {
  return samples ? 0.5 : FADE_ORDER[(y & 3) * 4 + (x & 3)]! < 8 ? 1 : 0;
}

const cells = GLASS.flatMap((g) => g.cells);
const sets = GLASS.map((g, k) => [GLASS.slice(0, k).reduce((n, h) => n + h.cells.length, 0), g.cells.length, g.card ? 1 : 0]);
const MOST_CELLS = Math.max(...GLASS.map((g) => g.cells.length));

/** The same in GLSL, for SURFACE's cut-out text, after HAND_GLSL (whose pattern it shares) and the frame block. */
export const VEHICLE_GLASS_GLSL = `
const vec4 GLASS_CELLS[${cells.length}] = vec4[${cells.length}](${cells.map((c) => `vec4(${c.map(f).join(", ")})`).join(", ")});
const vec3 GLASS_SETS[${sets.length}] = vec3[${sets.length}](${sets.map((s) => `vec3(${s.map(f).join(", ")})`).join(", ")});
bool glassAt(int set, vec2 uv, float forward) {
  if (set < 1 || set > ${sets.length}) return false;
  vec3 g = GLASS_SETS[set - 1];
  if (g.z > 0.5 && forward > ${f(CARD_FORWARD)}) return false;
  uv = fract(uv);
  for (int k = 0; k < ${MOST_CELLS}; k++) {
    if (k >= int(g.y)) break;
    vec4 c = GLASS_CELLS[int(g.x) + k];
    if (all(greaterThanEqual(uv, c.xy)) && all(lessThan(uv, c.zw))) return true;
  }
  return false;
}
float glassReflected(float cosine) {
  return min(0.86, (0.07 + 0.74 * pow(1.0 - min(1.0, abs(cosine)), 3.0)) * (1.0 + 0.45 * fStreetLook.x));
}
float glassCovers() {
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  return fGlass.x > 0.5 ? 0.5 : (FADE_ORDER[q.y * 4 + q.x] < 8.0 ? 1.0 : 0.0);
}
`;
