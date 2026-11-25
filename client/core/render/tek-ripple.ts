import { TEK_WALL as wall } from "../../../content/building/tek-wall.ts";

export const RIPPLE_SPEED = 0.0048;
export const RIPPLE_MS = 590;

export function inField(x: number, y: number): boolean {
  const u = Math.abs(x), v = Math.abs(y);
  return u <= wall.panelX && v <= wall.panelY && u + v <= wall.panelX + wall.panelY - wall.corner;
}

/** The two card colours carry the wall coordinates of its centre and the point struck. */
export function fieldWord(x: number, y: number): number {
  return (Math.round(65535 * (x / wall.width + 0.5)) | (Math.round(65535 * (y / wall.height + 0.5)) << 16)) >>> 0;
}

function band(s: number, width: number, pixel: number): number {
  const t = Math.max(0, 1 - Math.abs(s) / (width + pixel));
  return t * t * (3 - 2 * t) * width / (width + pixel);
}

function dash(x: number, y: number, half: number, pixel: number): number {
  return Math.max(0, 1 - (Math.max(0, Math.abs(x) - half) + Math.abs(y)) / (0.018 + pixel));
}

/** Premultiplied light and the fraction of the underlying field absorbed in the trough. */
export function rippleOf(out: number[] | Float64Array, x: number, y: number, dx: number, dy: number, radius: number, pixelSize: number): void {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (!inField(x, y)) return;
  const d = Math.hypot(dx, dy), offset = d - radius, reach = Math.min(1.3, radius);
  if ((offset > 0.20 + 0.18 * reach || offset < -0.77 - 0.18 * reach) && (radius > 0.92 || d > 0.54)) return;
  const pixel = Math.min(0.045, 0.5 * pixelSize), length = Math.max(d, 0.025);
  const nx = dx / length, ny = dy / length;
  const sin2 = 2 * nx * ny, cos2 = nx * nx - ny * ny;
  const sin3 = sin2 * nx + cos2 * ny, cos3 = cos2 * nx - sin2 * ny;
  const cos5 = cos3 * cos2 - sin3 * sin2;
  const s = offset - reach * (0.094 * sin3 + 0.052 * cos5 + 0.029 * sin2);
  const sun = 0.5 + 0.5 * (0.82 * ny - 0.57 * nx);
  const swell = 0.145 + 0.132 * sun + 0.032 * cos2;
  const crest = band(s, 0.023 + 0.042 * sun, pixel) * (0.57 + 0.71 * sun);
  const shoulder = band(s + 0.16 * swell, s > -0.16 * swell ? 0.078 + 0.10 * sun : swell * 0.69, pixel) * (0.33 + 0.64 * sun);
  const trough = band(s + 0.76 * swell, swell * 0.54, pixel) * Math.min(1, radius / 0.26);
  const breakUp = Math.max(0, Math.min(1, 1.55 * (0.44 * cos2 - 0.45 * sin3 + 0.52 * cos5 - 0.16)));
  const caustic = breakUp * band(s + swell * (1.56 + 0.32 * sin3), 0.031 + 0.024 * sun, pixel) / (1 + 0.8 * radius);
  const wash = band(s + 1.55 * swell, 1.05 * swell, pixel) * (0.15 + 0.21 * sun + 0.12 * breakUp) * (1 - 0.85 * trough);
  let splash = 0;
  if (radius < 0.92 && d < 0.54) {
    const t = radius / 0.92, step = Math.floor(3 * t) / 2, along = dx - 0.50 * dy;
    const a = dash(along - 0.13 - 0.13 * t - 0.036 * step, dy - 0.07 - 0.10 * t, 0.070, pixel);
    const b = dash(along + 0.16 + 0.13 * t + 0.022 * step, dy + 0.10 + 0.093 * t, 0.086, pixel);
    const c = dash(along + 0.12 + 0.044 * t, dy - 0.195 - 0.073 * t - 0.026 * step, 0.046, pixel);
    const contact = Math.max(0, 1 - d / 0.11) * Math.max(0, 1 - 2 * t);
    splash = (1 - t * t) * (Math.max(a, b, c) * (0.018 / (0.018 + pixel)) + contact);
  }
  out[0] = 1.06 * crest + 0.12 * shoulder + 0.08 * caustic + 0.16 * wash + 0.84 * splash;
  out[1] = 1.08 * crest + 0.52 * shoulder + 0.53 * caustic + 0.38 * wash + 1.02 * splash;
  out[2] = 1.10 * crest + 0.79 * shoulder + 0.89 * caustic + 1.00 * wash + 1.17 * splash;
  out[3] = (0.88 + 0.07 * (1 - sun)) * trough;
}

export const RIPPLE_GLSL = `float fieldBand(float s, float width, float pixel) {
  float t = max(0.0, 1.0 - abs(s) / (width + pixel));
  return t * t * (3.0 - 2.0 * t) * width / (width + pixel);
}
float fieldDash(vec2 p, float halfWidth, float pixel) {
  return max(0.0, 1.0 - (max(0.0, abs(p.x) - halfWidth) + abs(p.y)) / (0.018 + pixel));
}
vec4 rippleOf() {
  vec2 at = vBulge.xy, edge = abs(at);
  float pixel = min(0.045, 0.5 * max(length(dFdx(at)), length(dFdy(at))));
  if (edge.x > ${wall.panelX} || edge.y > ${wall.panelY} || edge.x + edge.y > ${(wall.panelX + wall.panelY - wall.corner).toFixed(4)}) return vec4(0.0);
  vec2 from = at - vB.xy;
  float d = length(from), offset = d - vFloor, reach = min(1.3, vFloor);
  if ((offset > 0.20 + 0.18 * reach || offset < -0.77 - 0.18 * reach) && (vFloor > 0.92 || d > 0.54)) return vec4(0.0);
  vec2 n = from / max(d, 0.025);
  float sin2 = 2.0 * n.x * n.y, cos2 = n.x * n.x - n.y * n.y;
  float sin3 = sin2 * n.x + cos2 * n.y, cos3 = cos2 * n.x - sin2 * n.y;
  float cos5 = cos3 * cos2 - sin3 * sin2;
  float s = offset - reach * (0.094 * sin3 + 0.052 * cos5 + 0.029 * sin2);
  float sun = 0.5 + 0.5 * dot(n, vec2(-0.57, 0.82));
  float swell = 0.145 + 0.132 * sun + 0.032 * cos2;
  float crest = fieldBand(s, 0.023 + 0.042 * sun, pixel) * (0.57 + 0.71 * sun);
  float shoulder = fieldBand(s + 0.16 * swell, s > -0.16 * swell ? 0.078 + 0.10 * sun : swell * 0.69, pixel) * (0.33 + 0.64 * sun);
  float trough = fieldBand(s + 0.76 * swell, swell * 0.54, pixel) * min(1.0, vFloor / 0.26);
  float breakUp = clamp(1.55 * (0.44 * cos2 - 0.45 * sin3 + 0.52 * cos5 - 0.16), 0.0, 1.0);
  float caustic = breakUp * fieldBand(s + swell * (1.56 + 0.32 * sin3), 0.031 + 0.024 * sun, pixel) / (1.0 + 0.8 * vFloor);
  float wash = fieldBand(s + 1.55 * swell, 1.05 * swell, pixel) * (0.15 + 0.21 * sun + 0.12 * breakUp) * (1.0 - 0.85 * trough);
  float splash = 0.0;
  if (vFloor < 0.92 && d < 0.54) {
    float t = vFloor / 0.92, jump = floor(3.0 * t) / 2.0;
    vec2 p = vec2(from.x - 0.50 * from.y, from.y);
    float a = fieldDash(p - vec2(0.13 + 0.13 * t + 0.036 * jump, 0.07 + 0.10 * t), 0.070, pixel);
    float b = fieldDash(p + vec2(0.16 + 0.13 * t + 0.022 * jump, 0.10 + 0.093 * t), 0.086, pixel);
    float c = fieldDash(p - vec2(-0.12 - 0.044 * t, 0.195 + 0.073 * t + 0.026 * jump), 0.046, pixel);
    float contact = max(0.0, 1.0 - d / 0.11) * max(0.0, 1.0 - 2.0 * t);
    splash = (1.0 - t * t) * (max(a, max(b, c)) * (0.018 / (0.018 + pixel)) + contact);
  }
  vec3 light = vec3(1.06, 1.08, 1.10) * crest + vec3(0.12, 0.52, 0.79) * shoulder
    + vec3(0.08, 0.53, 0.89) * caustic + vec3(0.16, 0.38, 1.00) * wash + vec3(0.84, 1.02, 1.17) * splash;
  return vec4(light, (0.88 + 0.07 * (1.0 - sun)) * trough);
}`;

export const FIELD_COORDS_GLSL = `vec2 fieldCoords(vec4 bytes) {
  return ((bytes.rb + 256.0 * bytes.ga) / 257.0 - 0.5) * vec2(${wall.width.toFixed(1)}, ${wall.height.toFixed(1)});
}`;
