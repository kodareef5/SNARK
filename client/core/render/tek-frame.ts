// The light from the inset lens falls across its metal housing in the wall's own metres.
import { TEK_WALL } from "../../../content/building/tek-wall.ts";
import { RAIL_LIGHT } from "./tek-field.ts";

const aperture = [0.80, 0.94, 1.14] as const;
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
  const grain = 0.72 + 0.55 * height;
  for (let c = 0; c < 3; c++) {
    const paint = palette[c]!, steel = 0.065 + 1.30 * Math.sqrt(paint);
    albedo[c] = (paint + (steel - paint) * polished) * grain + 0.07 * albedo[c]!;
  }
  orm[1] = Math.max(0.13, Math.min(0.75, 0.59 - 0.39 * polished + (orm[1]! - 0.40) * 0.78));
  orm[2] = 0.16 + 0.76 * polished;
}

/** The pressed pan bows slightly and the long polished lands roll across the tool axis. */
export function tekFinishNormal(n: Float64Array, x: number, y: number, c: number, s: number, plate: boolean, coat: number): void {
  let dx = 0.065 * x, dy = 0.12 * y + 0.045 * x;
  if (!plate) {
    const upright = Math.abs(x) > Math.abs(y), across = upright ? x : y;
    const width = (Math.abs(across) - (upright ? 1.402 : 1.432)) * 14;
    if (Math.abs(width) >= 1) return;
    const roll = 0.66 * width * (1 - width * width) * Math.sign(across);
    dx = upright ? roll : 0;
    dy = upright ? 0 : roll;
  }
  const amount = coat * Math.abs(s * n[0]! + c * n[2]!);
  const nx = n[0]! + c * dx * amount, ny = n[1]! + dy * amount, nz = n[2]! - s * dx * amount;
  const length = Math.hypot(nx, ny, nz);
  n[0] = nx / length;
  n[1] = ny / length;
  n[2] = nz / length;
}

export function tekPlateSurface(base: Float64Array, orm: Float64Array, height: number, facing: number, viewX: number): void {
  const edge = clamp((1 - facing) * 1.45 + 0.16 * viewX - 0.12);
  const film = edge * edge;
  const steel = 0.55 + 0.65 * height;
  base[0] = 0.86 * base[0]! + 0.026 * steel + 0.21 * film;
  base[1] = 0.95 * base[1]! + 0.051 * steel;
  base[2] = base[2]! + 0.076 * steel + 0.20 * film;
  orm[1] = Math.max(0.16, Math.min(0.55, 0.17 + 0.82 * (orm[1]! - 0.19)));
  orm[2] = 0.56 + 0.13 * height + 0.10 * film;
}

export function tekRailLight(light: Float64Array, x: number, y: number, emitter: boolean, exposure: number): void {
  const intensity = (emitter ? 3.6 : frameSpill(x, y)) / Math.max(exposure, 0.001);
  const projector = emitter && Math.abs(x) < 1.10;
  const colour = projector ? aperture : emitter ? RAIL_LIGHT : flux;
  for (let c = 0; c < 3; c++) light[c]! += intensity * colour[c]!;
}

export const TEK_FRAME_GLSL = `void tekFrameSurface(inout vec3 base, inout vec3 orm, vec3 palette, float height) {
  float polished = smoothstep(0.016, 0.166, palette.g);
  vec3 steel = 0.065 + 1.30 * sqrt(palette);
  base = mix(palette, steel, polished) * (0.72 + 0.55 * height) + 0.07 * base;
  orm.yz = vec2(clamp(0.59 - 0.39 * polished + (orm.y - 0.40) * 0.78, 0.13, 0.75), 0.16 + 0.76 * polished);
}
vec3 tekFinishNormal(vec3 n, vec2 p, vec2 turn, bool plate, float coat) {
  vec2 lean = vec2(0.065 * p.x, 0.12 * p.y + 0.045 * p.x);
  if (!plate) {
    bool upright = abs(p.x) > abs(p.y);
    float across = upright ? p.x : p.y;
    float width = (abs(across) - (upright ? 1.402 : 1.432)) * 14.0;
    if (abs(width) >= 1.0) return n;
    float roll = 0.66 * width * (1.0 - width * width) * sign(across);
    lean = upright ? vec2(roll, 0.0) : vec2(0.0, roll);
  }
  float amount = coat * abs(dot(turn.yx, n.xz));
  return normalize(n + vec3(turn.x * lean.x, lean.y, -turn.y * lean.x) * amount);
}
void tekPlateSurface(inout vec3 base, inout vec3 orm, float height, float facing, float viewX) {
  float edge = clamp((1.0 - facing) * 1.45 + 0.16 * viewX - 0.12, 0.0, 1.0), film = edge * edge;
  base = vec3(0.86, 0.95, 1.0) * base + vec3(0.026, 0.051, 0.076) * (0.55 + 0.65 * height) + vec3(0.21, 0.0, 0.20) * film;
  orm.yz = vec2(clamp(0.17 + 0.82 * (orm.y - 0.19), 0.16, 0.55), 0.56 + 0.13 * height + 0.10 * film);
}
vec3 tekRailLight(vec2 p, bool emitter) {
  vec2 d = vec2(abs(p.x) - ${TEK_WALL.railX}, max(0.0, abs(p.y) - ${TEK_WALL.railY}));
  float d2 = dot(d, d);
  float spill = 0.59 / (1.0 + 2100.0 * d2) + 0.095 / (1.0 + 150.0 * d2);
  vec3 lens = abs(p.x) < 1.10 ? vec3(${aperture.join(", ")}) : vec3(${RAIL_LIGHT.join(", ")});
  return (emitter ? 3.6 * lens : vec3(${flux.join(", ")}) * spill) / max(fSunColor.w, 0.001);
}`;
