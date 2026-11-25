// The emitter sweeps one interference pattern through the inset plate, in the wall's own metres.
import { FIT_CLASS_SHIFT, FIT_WALL } from "./piece-fit.ts";
import { MADE_FLOATS, materialIndex } from "../texgen/layers.ts";

export const TEK_FIELD = materialIndex("tek_field");
export const TEK_TRIM = materialIndex("plate");
/** The borrowed metal joint has the owner's dye and its own fit class. */
export const pieceFinish = (material: number, fit: number): number => material === TEK_FIELD && (fit >> FIT_CLASS_SHIFT) !== FIT_WALL ? TEK_TRIM : material;
export const FIELD_PHASE = (TEK_FIELD - 1) * MADE_FLOATS + 2;
export const FIELD_PERIOD = 12500;
export const fieldPhase = (ms: number): number => ((ms % FIELD_PERIOD) / FIELD_PERIOD) * 2 * Math.PI;

const idle = [0.002, 0.006, 0.011];
export const RAIL_LIGHT = [0.44, 0.96, 1.30] as const;
const cyan = [0.012, 0.22, 0.31];
const violet = [0.13, 0.036, 0.23];
const clamp = (v: number): number => Math.max(0, Math.min(v, 1));

/** Adds the plate's light before exposure and fog. Grazing views separate the colours. */
export function tekFieldLight(light: Float64Array, x: number, y: number, seed: number, facing: number, footprint: number, phase: number, exposure: number, relief = 0.5): void {
  const t = clamp((footprint - 0.035) / 0.085), resolved = 1 - t * t * (3 - 2 * t);
  let blue = 0.018, purple = 0.012;
  if (resolved > 0) {
    const rim = 1 - clamp(facing), variation = 0.11 * (seed & 31);
    const arc = Math.sin(1.9 * x + 0.52 * y + variation);
    const sweep = 1.45 * x + 3.55 * y + 1.32 * arc + 0.34 * x * y + variation + 1.7 * rim - phase;
    const ridge = clamp((Math.sin(sweep) - 0.72) / 0.28);
    const edge = clamp((Math.abs(x) + 0.35 * Math.abs(y) - 0.68) * 1.6);
    const reach = (0.33 + 1.35 * rim) * (0.49 + 0.37 * edge + 0.14 * arc);
    const seam = Math.max(Math.abs(x) - 1.09, Math.abs(y) - 1.14, (Math.abs(x) + Math.abs(y) - 1.99) * 0.7071);
    const score = 1 - clamp(Math.abs(seam) / (0.008 + footprint));
    const engraving = clamp((0.41 - relief) * 3.6), brushing = clamp(0.45 + (relief - 0.5) * 5);
    blue += resolved * (reach * ridge * ridge * (0.50 + 0.76 * brushing) + 0.08 * score + 0.14 * engraving - blue);
    purple += resolved * (reach * edge * clamp(1 - Math.abs(Math.sin(sweep - 0.36) - 0.90) * 4) * 0.44 - purple);
  }
  const gain = 1 / Math.max(exposure, 0.001);
  for (let c = 0; c < 3; c++) light[c]! += (idle[c]! + cyan[c]! * blue + violet[c]! * purple) * gain;
}

const rgb = (c: readonly number[]): string => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;
export const TEK_FIELD_GLSL = `vec3 tekFieldLight(vec2 p, int seed, float facing, float footprint, float relief) {
  float resolved = 1.0 - smoothstep(0.035, 0.12, footprint);
  vec2 bands = vec2(0.018, 0.012);
  if (resolved > 0.0) {
    float rim = 1.0 - clamp(facing, 0.0, 1.0), variation = 0.11 * float(seed & 31);
    float arc = sin(1.9 * p.x + 0.52 * p.y + variation);
    float sweep = 1.45 * p.x + 3.55 * p.y + 1.32 * arc + 0.34 * p.x * p.y + variation + 1.7 * rim - fMade[${(TEK_FIELD - 1) * 2}].z;
    float ridge = clamp((sin(sweep) - 0.72) / 0.28, 0.0, 1.0);
    float edge = clamp((abs(p.x) + 0.35 * abs(p.y) - 0.68) * 1.6, 0.0, 1.0);
    float reach = (0.33 + 1.35 * rim) * (0.49 + 0.37 * edge + 0.14 * arc);
    float seam = max(max(abs(p.x) - 1.09, abs(p.y) - 1.14), (abs(p.x) + abs(p.y) - 1.99) * 0.7071);
    float score = 1.0 - clamp(abs(seam) / (0.008 + footprint), 0.0, 1.0);
    float engraving = clamp((0.41 - relief) * 3.6, 0.0, 1.0), brushing = clamp(0.45 + (relief - 0.5) * 5.0, 0.0, 1.0);
    float blue = reach * ridge * ridge * (0.50 + 0.76 * brushing) + 0.08 * score + 0.14 * engraving;
    float purple = reach * edge * clamp(1.0 - abs(sin(sweep - 0.36) - 0.90) * 4.0, 0.0, 1.0) * 0.44;
    bands = mix(bands, vec2(blue, purple), resolved);
  }
  return (${rgb(idle)} + ${rgb(cyan)} * bands.x + ${rgb(violet)} * bands.y) / max(fSunColor.w, 0.001);
}
`;
