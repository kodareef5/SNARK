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
const clearance = TEK_WALL.fieldZ - TEK_WALL.panelZ;
const railBreak = 0.35;
const clamp = (v: number): number => Math.max(0, Math.min(v, 1));
const fract = (v: number): number => v - Math.floor(v);

function smooth(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function panelMargin(x: number, y: number): number {
  const dx = TEK_WALL.panelX - Math.abs(x), dy = TEK_WALL.panelY - Math.abs(y);
  return Math.min(dx, dy, (dx + dy - TEK_WALL.corner) * Math.SQRT1_2);
}

/** Adds the light from the rails and the moving field to the lit plate before exposure and fog. */
export function tekFieldLight(light: Float64Array, x: number, y: number, seed: number, facing: number, footprint: number, phase: number, exposure: number, relief = 0.5, viewX = 0, viewY = 0, conductor = 0): void {
  const resolved = 1 - smooth(0.035, 0.12, footprint);
  let green = 0.026, purple = 0.009, white = 0.002;
  if (resolved > 0) {
    const dx = Math.max(0, TEK_WALL.railX - Math.abs(x)), tip = Math.max(0, Math.abs(y) - TEK_WALL.railY);
    const falloff = 1 / (1 + 63 * dx * dx + 180 * tip * tip);
    const gap = 1 - smooth(0.008, 0.036 + 0.26 * dx, Math.abs(Math.abs(y) - railBreak));
    const feed = falloff * falloff * (1 - 0.83 * gap / (1 + 7 * dx));
    const normalView = clamp(facing), rim = 1 - normalView, variation = 0.11 * (seed & 31);
    // The ray meets the field before the metal. The gap closes into the gasket.
    const travel = clearance * smooth(0, 0.16, panelMargin(x, y)) / Math.max(0.28, normalView);
    const sx = x + viewX * travel, sy = y + viewY * travel;
    const skin = smooth(-0.002, 0.024, panelMargin(sx, sy));
    const arc = Math.sin(1.9 * sx + 0.52 * sy + variation);
    const sweep = 1.45 * sx + 3.55 * sy + 1.32 * arc + 0.34 * sx * sy + variation + 1.7 * rim - phase;
    const wave = Math.sin(sweep), wake = smooth(0.65, 1, Math.sin(sweep - 0.56 - 0.43 * rim));
    const crest = skin * smooth(0.54, 1, wave), core = skin * smooth(0.90, 1, wave);
    const reach = (0.68 + 1.15 * rim * rim) * (0.81 + 0.19 * arc);
    const pickup = clamp((0.36 - relief) * 4.3), brush = clamp(0.52 + (relief - 0.5) * 4);
    // Charge runs along the etched metal below the optical return.
    let pulse = 0, trace = 0;
    if (conductor > 0 && footprint < 0.065) {
      const bus = Math.sin(2.8 * Math.abs(x) - 3.9 * y + variation - phase * 2);
      pulse = smooth(0.27, 0.94, bus);
      trace = clamp(conductor) * pulse * pulse * (1 - smooth(0.015, 0.065, footprint));
    }
    const deep = smooth(-0.35, 0.85, Math.sin(1.85 * x + 2.52 * y + 0.64 * x * y - 0.68 + variation - phase));
    const under = deep * (0.065 + 0.29 * rim * rim) * (0.63 + 0.37 * brush);
    const litCells = Math.max(crest, skin * smooth(0.014, 0.56, feed)) * (1 - smooth(0.009, 0.034, footprint));
    let facet = 0, glint = 0;
    if (litCells > 0) {
      // Crossing ruled grooves make tiny lens facets. Their return moves as the field passes under them.
      const u = 2 * fract((sx + 0.63 * sy) / pitch) - 1, v = 2 * fract((sx - 0.63 * sy) / pitch) - 1;
      const bevel = smooth(0.56, 0.93, Math.max(Math.abs(u), Math.abs(v)));
      const edgeWidth = 0.14 + footprint / pitch;
      const slopeU = u * clamp((1 - Math.abs(u)) / edgeWidth), slopeV = v * clamp((1 - Math.abs(v)) / edgeWidth);
      const catchLight = smooth(0.30, 0.93, (0.70 + 0.30 * wave) * slopeU - (0.50 - 0.25 * wave) * slopeV + 0.30 * rim);
      facet = litCells * bevel * (0.26 + 0.74 * catchLight);
      glint = litCells * bevel * catchLight;
    }
    const cyanLight = 0.56 * feed + under + reach * crest * (0.14 + 0.12 * brush) + 0.32 * facet + 0.07 * pickup + 0.91 * trace;
    const violetLight = skin * wake * (0.045 + 0.21 * feed + 0.25 * rim) * (1 - 0.65 * core) + 0.18 * under * rim;
    const whiteLight = 0.08 * feed + reach * (0.033 * core + 0.65 * core * glint) + 0.22 * feed * glint + 0.39 * trace * pulse;
    green += resolved * (cyanLight - green);
    purple += resolved * (violetLight - purple);
    white += resolved * (whiteLight - white);
  }
  const gain = 1 / Math.max(exposure, 0.001);
  for (let c = 0; c < 3; c++) light[c]! += (idle[c]! + teal[c]! * green + violet[c]! * purple + pearl[c]! * white) * gain;
}

const rgb = (c: readonly number[]): string => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;
export const TEK_FIELD_GLSL = `float tekPanelMargin(vec2 p) {
  vec2 d = vec2(${TEK_WALL.panelX}, ${TEK_WALL.panelY}) - abs(p);
  return min(min(d.x, d.y), (d.x + d.y - ${TEK_WALL.corner}) * 0.70710678);
}
vec3 tekFieldLight(vec2 p, int seed, float facing, float footprint, float relief, float viewX, float viewY, float conductor) {
  float resolved = 1.0 - smoothstep(0.035, 0.12, footprint);
  vec3 bands = vec3(0.026, 0.009, 0.002);
  if (resolved > 0.0) {
    float dx = max(0.0, ${TEK_WALL.railX} - abs(p.x)), tip = max(0.0, abs(p.y) - ${TEK_WALL.railY});
    float falloff = 1.0 / (1.0 + 63.0 * dx * dx + 180.0 * tip * tip);
    float gap = 1.0 - smoothstep(0.008, 0.036 + 0.26 * dx, abs(abs(p.y) - ${railBreak}));
    float feed = falloff * falloff * (1.0 - 0.83 * gap / (1.0 + 7.0 * dx));
    float normalView = clamp(facing, 0.0, 1.0), rim = 1.0 - normalView, variation = 0.11 * float(seed & 31);
    float travel = ${clearance.toFixed(6)} * smoothstep(0.0, 0.16, tekPanelMargin(p)) / max(0.28, normalView);
    vec2 skinAt = p + vec2(viewX, viewY) * travel;
    float skin = smoothstep(-0.002, 0.024, tekPanelMargin(skinAt));
    float arc = sin(1.9 * skinAt.x + 0.52 * skinAt.y + variation);
    float sweep = 1.45 * skinAt.x + 3.55 * skinAt.y + 1.32 * arc + 0.34 * skinAt.x * skinAt.y + variation + 1.7 * rim - fMade[${(TEK_FIELD - 1) * 2}].z;
    float wave = sin(sweep), wake = smoothstep(0.65, 1.0, sin(sweep - 0.56 - 0.43 * rim));
    float crest = skin * smoothstep(0.54, 1.0, wave), core = skin * smoothstep(0.90, 1.0, wave);
    float reach = (0.68 + 1.15 * rim * rim) * (0.81 + 0.19 * arc);
    float pickup = clamp((0.36 - relief) * 4.3, 0.0, 1.0), brush = clamp(0.52 + (relief - 0.5) * 4.0, 0.0, 1.0);
    float pulse = 0.0, trace = 0.0;
    if (conductor > 0.0 && footprint < 0.065) {
      float bus = sin(2.8 * abs(p.x) - 3.9 * p.y + variation - fMade[${(TEK_FIELD - 1) * 2}].z * 2.0);
      pulse = smoothstep(0.27, 0.94, bus);
      trace = clamp(conductor, 0.0, 1.0) * pulse * pulse * (1.0 - smoothstep(0.015, 0.065, footprint));
    }
    float deep = smoothstep(-0.35, 0.85, sin(1.85 * p.x + 2.52 * p.y + 0.64 * p.x * p.y - 0.68 + variation - fMade[${(TEK_FIELD - 1) * 2}].z));
    float under = deep * (0.065 + 0.29 * rim * rim) * (0.63 + 0.37 * brush);
    float litCells = max(crest, skin * smoothstep(0.014, 0.56, feed)) * (1.0 - smoothstep(0.009, 0.034, footprint));
    float facet = 0.0, glint = 0.0;
    if (litCells > 0.0) {
      vec2 cell = 2.0 * fract(vec2(skinAt.x + 0.63 * skinAt.y, skinAt.x - 0.63 * skinAt.y) / ${pitch}) - 1.0;
      float bevel = smoothstep(0.56, 0.93, max(abs(cell.x), abs(cell.y)));
      vec2 slope = cell * clamp((1.0 - abs(cell)) / (0.14 + footprint / ${pitch}), 0.0, 1.0);
      float catchLight = smoothstep(0.30, 0.93, (0.70 + 0.30 * wave) * slope.x - (0.50 - 0.25 * wave) * slope.y + 0.30 * rim);
      facet = litCells * bevel * (0.26 + 0.74 * catchLight);
      glint = litCells * bevel * catchLight;
    }
    float cyanLight = 0.56 * feed + under + reach * crest * (0.14 + 0.12 * brush) + 0.32 * facet + 0.07 * pickup + 0.91 * trace;
    float violetLight = skin * wake * (0.045 + 0.21 * feed + 0.25 * rim) * (1.0 - 0.65 * core) + 0.18 * under * rim;
    float whiteLight = 0.08 * feed + reach * (0.033 * core + 0.65 * core * glint) + 0.22 * feed * glint + 0.39 * trace * pulse;
    bands = mix(bands, vec3(cyanLight, violetLight, whiteLight), resolved);
  }
  return (${rgb(idle)} + ${rgb(teal)} * bands.x + ${rgb(violet)} * bands.y + ${rgb(pearl)} * bands.z) / max(fSunColor.w, 0.001);
}
`;
