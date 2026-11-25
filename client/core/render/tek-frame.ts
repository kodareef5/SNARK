// The light from the inset lens falls across its metal housing in the wall's own metres.
import { TEK_WALL } from "../../../content/building/tek-wall.ts";
import { RAIL_LIGHT } from "./tek-field.ts";

const flux = [0.055, 0.62, 0.83] as const;
const clamp = (n: number): number => Math.max(0, Math.min(1, n));

export function frameSpill(x: number, y: number): number {
  const dx = Math.abs(x) - TEK_WALL.railX;
  const dy = Math.max(0, Math.abs(y) - TEK_WALL.railY);
  const d2 = dx * dx + dy * dy;
  return 0.59 / (1 + 2100 * d2) + 0.095 / (1 + 150 * d2);
}

/** The finish of the pale machined lands and the dark seal, using the roughness and height already sampled. */
export function tekFrameSurface(albedo: Float64Array, orm: Float64Array, palette: Float64Array, height: number): void {
  const t = clamp((palette[1]! - 0.016) / 0.15), polished = t * t * (3 - 2 * t);
  const grain = 0.82 + 0.35 * height;
  for (let c = 0; c < 3; c++) {
    const paint = palette[c]!, steel = 0.085 + 1.22 * Math.sqrt(paint);
    albedo[c] = (paint + (steel - paint) * polished) * grain + 0.07 * albedo[c]!;
  }
  orm[1] = Math.max(0.17, Math.min(0.72, 0.57 - 0.33 * polished + (orm[1]! - 0.40) * 0.60));
  orm[2] = 0.16 + 0.76 * polished;
}

export function tekRailLight(light: Float64Array, x: number, y: number, emitter: boolean, exposure: number): void {
  const intensity = (emitter ? 3.6 : frameSpill(x, y)) / Math.max(exposure, 0.001);
  const colour = emitter ? RAIL_LIGHT : flux;
  for (let c = 0; c < 3; c++) light[c]! += intensity * colour[c]!;
}

export const TEK_FRAME_GLSL = `void tekFrameSurface(inout vec3 base, inout vec3 orm, vec3 palette, float height) {
  float polished = smoothstep(0.016, 0.166, palette.g);
  vec3 steel = 0.085 + 1.22 * sqrt(palette);
  base = mix(palette, steel, polished) * (0.82 + 0.35 * height) + 0.07 * base;
  orm.yz = vec2(clamp(0.57 - 0.33 * polished + (orm.y - 0.40) * 0.60, 0.17, 0.72), 0.16 + 0.76 * polished);
}
vec3 tekRailLight(vec2 p, bool emitter) {
  vec2 d = vec2(abs(p.x) - ${TEK_WALL.railX}, max(0.0, abs(p.y) - ${TEK_WALL.railY}));
  float d2 = dot(d, d);
  float spill = 0.59 / (1.0 + 2100.0 * d2) + 0.095 / (1.0 + 150.0 * d2);
  return (emitter ? 3.6 * vec3(${RAIL_LIGHT.join(", ")}) : vec3(${flux.join(", ")}) * spill) / max(fSunColor.w, 0.001);
}`;
