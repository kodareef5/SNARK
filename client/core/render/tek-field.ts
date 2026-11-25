// The emitter sweeps one interference pattern through the inset plate, in the wall's own metres.
import { TEK_WALL } from "../../../content/building/tek-wall.ts";
import { FIT_CLASS_SHIFT, FIT_WALL } from "./piece-fit.ts";
import { MADE_FLOATS, materialIndex } from "../texgen/layers.ts";

export const TEK_FIELD = materialIndex("tek_field");
export const TEK_TRIM = materialIndex("plate");
/** The borrowed metal joint has the owner's dye and its own fit class. */
export const pieceFinish = (material: number, fit: number): number => material === TEK_FIELD && (fit >> FIT_CLASS_SHIFT) !== FIT_WALL ? TEK_TRIM : material;
export const FIELD_PHASE = (TEK_FIELD - 1) * MADE_FLOATS + 2;
export const FIELD_PERIOD = 12500;
export const fieldPhase = (ms: number): number => ((ms % FIELD_PERIOD) / FIELD_PERIOD) * 2 * Math.PI;

export const RAIL_LIGHT = [0.44, 0.96, 1.30] as const;
const idle = [0.002, 0.007, 0.012];
const teal = [0.016, 0.48, 0.55];
const violet = [0.21, 0.038, 0.27];
const pearl = [0.60, 0.88, 0.92];
const pitch = 0.105;
const railBreak = 0.35;
const clamp = (v: number): number => Math.max(0, Math.min(v, 1));
const fract = (v: number): number => v - Math.floor(v);

function smooth(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

/** Adds the light from the rails and the moving field to the lit plate before exposure and fog. */
export function tekFieldLight(light: Float64Array, x: number, y: number, seed: number, facing: number, footprint: number, phase: number, exposure: number, relief = 0.5): void {
  const resolved = 1 - smooth(0.035, 0.12, footprint);
  let green = 0.026, purple = 0.009, white = 0.002;
  if (resolved > 0) {
    const dx = Math.max(0, TEK_WALL.railX - Math.abs(x)), tip = Math.max(0, Math.abs(y) - TEK_WALL.railY);
    const falloff = 1 / (1 + 63 * dx * dx + 180 * tip * tip);
    const gap = 1 - smooth(0.008, 0.036 + 0.26 * dx, Math.abs(Math.abs(y) - railBreak));
    const feed = falloff * falloff * (1 - 0.83 * gap / (1 + 7 * dx));
    const rim = 1 - clamp(facing), variation = 0.11 * (seed & 31);
    const arc = Math.sin(1.9 * x + 0.52 * y + variation);
    const sweep = 1.45 * x + 3.55 * y + 1.32 * arc + 0.34 * x * y + variation + 1.7 * rim - phase;
    const wave = Math.sin(sweep), wake = smooth(0.66, 1, Math.sin(sweep - 0.64));
    const crest = smooth(0.54, 1, wave), core = smooth(0.90, 1, wave);
    const reach = (0.70 + 1.25 * rim * rim) * (0.81 + 0.19 * arc);
    const pickup = clamp((0.36 - relief) * 4.3), brush = clamp(0.52 + (relief - 0.5) * 4);
    const litCells = Math.max(crest, smooth(0.014, 0.56, feed)) * (1 - smooth(0.009, 0.034, footprint));
    let facet = 0, glint = 0;
    if (litCells > 0) {
      // Crossing ruled grooves make tiny lens facets. Their return moves as the field passes under them.
      const u = 2 * fract((x + 0.63 * y) / pitch) - 1, v = 2 * fract((x - 0.63 * y) / pitch) - 1;
      const bevel = smooth(0.56, 0.93, Math.max(Math.abs(u), Math.abs(v)));
      const edgeWidth = 0.14 + footprint / pitch;
      const slopeU = u * clamp((1 - Math.abs(u)) / edgeWidth), slopeV = v * clamp((1 - Math.abs(v)) / edgeWidth);
      const catchLight = smooth(0.30, 0.93, (0.70 + 0.30 * wave) * slopeU - (0.50 - 0.25 * wave) * slopeV + 0.30 * rim);
      facet = litCells * bevel * (0.26 + 0.74 * catchLight);
      glint = litCells * bevel * catchLight;
    }
    const cyanLight = 0.58 * feed + reach * crest * (0.17 + 0.16 * brush) + 0.34 * facet + pickup * (0.06 + 0.14 * crest);
    const violetLight = wake * (0.067 + 0.26 * feed + 0.17 * rim) * (1 - 0.65 * core);
    const whiteLight = 0.08 * feed + reach * (0.035 * core + 0.72 * core * glint) + 0.23 * feed * glint;
    green += resolved * (cyanLight - green);
    purple += resolved * (violetLight - purple);
    white += resolved * (whiteLight - white);
  }
  const gain = 1 / Math.max(exposure, 0.001);
  for (let c = 0; c < 3; c++) light[c]! += (idle[c]! + teal[c]! * green + violet[c]! * purple + pearl[c]! * white) * gain;
}

const rgb = (c: readonly number[]): string => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;
export const TEK_FIELD_GLSL = `vec3 tekFieldLight(vec2 p, int seed, float facing, float footprint, float relief) {
  float resolved = 1.0 - smoothstep(0.035, 0.12, footprint);
  vec3 bands = vec3(0.026, 0.009, 0.002);
  if (resolved > 0.0) {
    float dx = max(0.0, ${TEK_WALL.railX} - abs(p.x)), tip = max(0.0, abs(p.y) - ${TEK_WALL.railY});
    float falloff = 1.0 / (1.0 + 63.0 * dx * dx + 180.0 * tip * tip);
    float gap = 1.0 - smoothstep(0.008, 0.036 + 0.26 * dx, abs(abs(p.y) - ${railBreak}));
    float feed = falloff * falloff * (1.0 - 0.83 * gap / (1.0 + 7.0 * dx));
    float rim = 1.0 - clamp(facing, 0.0, 1.0), variation = 0.11 * float(seed & 31);
    float arc = sin(1.9 * p.x + 0.52 * p.y + variation);
    float sweep = 1.45 * p.x + 3.55 * p.y + 1.32 * arc + 0.34 * p.x * p.y + variation + 1.7 * rim - fMade[${(TEK_FIELD - 1) * 2}].z;
    float wave = sin(sweep), wake = smoothstep(0.66, 1.0, sin(sweep - 0.64));
    float crest = smoothstep(0.54, 1.0, wave), core = smoothstep(0.90, 1.0, wave);
    float reach = (0.70 + 1.25 * rim * rim) * (0.81 + 0.19 * arc);
    float pickup = clamp((0.36 - relief) * 4.3, 0.0, 1.0), brush = clamp(0.52 + (relief - 0.5) * 4.0, 0.0, 1.0);
    float litCells = max(crest, smoothstep(0.014, 0.56, feed)) * (1.0 - smoothstep(0.009, 0.034, footprint));
    float facet = 0.0, glint = 0.0;
    if (litCells > 0.0) {
      vec2 cell = 2.0 * fract(vec2(p.x + 0.63 * p.y, p.x - 0.63 * p.y) / ${pitch}) - 1.0;
      float bevel = smoothstep(0.56, 0.93, max(abs(cell.x), abs(cell.y)));
      vec2 slope = cell * clamp((1.0 - abs(cell)) / (0.14 + footprint / ${pitch}), 0.0, 1.0);
      float catchLight = smoothstep(0.30, 0.93, (0.70 + 0.30 * wave) * slope.x - (0.50 - 0.25 * wave) * slope.y + 0.30 * rim);
      facet = litCells * bevel * (0.26 + 0.74 * catchLight);
      glint = litCells * bevel * catchLight;
    }
    float cyanLight = 0.58 * feed + reach * crest * (0.17 + 0.16 * brush) + 0.34 * facet + pickup * (0.06 + 0.14 * crest);
    float violetLight = wake * (0.067 + 0.26 * feed + 0.17 * rim) * (1.0 - 0.65 * core);
    float whiteLight = 0.08 * feed + reach * (0.035 * core + 0.72 * core * glint) + 0.23 * feed * glint;
    bands = mix(bands, vec3(cyanLight, violetLight, whiteLight), resolved);
  }
  return (${rgb(idle)} + ${rgb(teal)} * bands.x + ${rgb(violet)} * bands.y + ${rgb(pearl)} * bands.z) / max(fSunColor.w, 0.001);
}
`;
