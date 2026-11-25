import { TEK_WALL as wall } from "../../../content/building/tek-wall.ts";

export const RIPPLE_SPEED = 0.0048;
export const RIPPLE_MS = 590;
export const RIPPLE_TINT = [0.32, 0.79, 1] as const;

export function inField(x: number, y: number): boolean {
  const u = Math.abs(x), v = Math.abs(y);
  return u <= wall.panelX && v <= wall.panelY && u + v <= wall.panelX + wall.panelY - wall.corner;
}

/** The two card colours carry the wall coordinates of its centre and the point struck. */
export function fieldWord(x: number, y: number): number {
  return (Math.round(65535 * (x / wall.width + 0.5)) | (Math.round(65535 * (y / wall.height + 0.5)) << 16)) >>> 0;
}

export function rippleStrength(x: number, y: number, dx: number, dy: number, radius: number): number {
  if (!inField(x, y)) return 0;
  const d = Math.hypot(dx, dy);
  const crest = Math.max(0, 1 - Math.abs(d - radius) / 0.055);
  const wake = Math.max(0, 1 - Math.abs(d - radius + 0.12) / 0.045);
  const contact = Math.max(0, 1 - d / 0.11) * Math.max(0, 1 - radius / 0.52);
  return crest * crest + 0.34 * wake * wake + 0.9 * contact;
}

export const RIPPLE_GLSL = `float rippleOf() {
  vec2 at = vBulge.xy;
  vec2 edge = abs(at);
  if (edge.x > ${wall.panelX} || edge.y > ${wall.panelY} || edge.x + edge.y > ${(wall.panelX + wall.panelY - wall.corner).toFixed(4)}) return 0.0;
  float d = length(at - vB.xy);
  float crest = max(0.0, 1.0 - abs(d - vFloor) / 0.055);
  float wake = max(0.0, 1.0 - abs(d - vFloor + 0.12) / 0.045);
  float contact = max(0.0, 1.0 - d / 0.11) * max(0.0, 1.0 - vFloor / 0.52);
  return crest * crest + 0.34 * wake * wake + 0.9 * contact;
}`;

export const FIELD_COORDS_GLSL = `vec2 fieldCoords(vec4 bytes) {
  return ((bytes.rb + 256.0 * bytes.ga) / 257.0 - 0.5) * vec2(${wall.width.toFixed(1)}, ${wall.height.toFixed(1)});
}`;
