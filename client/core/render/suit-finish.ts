// The sky seen in Meridian's polished surfaces. Widen the bright horizon with roughness.
// Local silhouettes are composited over this light, so a wall can interrupt the highlight.
import { FRAME } from "./packet.ts";

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function polishMask(rough: number): number {
  return clamp((0.64 - rough) * 5.5);
}

export function polishedSky(rgb: Float64Array, frame: Float32Array, ray: ArrayLike<number>, rough: number): void {
  const y = ray[1]!, upper = clamp(5 * y + 0.32);
  const toward = clamp(0.5 + 0.5 * (ray[0]! * frame[FRAME.look]! + ray[2]! * frame[FRAME.look + 1]!));
  const band = 2 ** (-Math.abs(y - 0.105) / (0.034 + 0.14 * rough));
  const fill = band * (2.8 + 2.2 * toward);
  for (let i = 0; i < 3; i++) rgb[i] = rgb[i]! * (0.19 + 0.78 * upper) + frame[FRAME.skyAbove + i]! * fill;
}

export const POLISHED_SKY = `
float polishMask(float rough) { return clamp((0.64-rough)*5.5,0.0,1.0); }
vec3 polishedSky(vec3 rgb, vec3 ray, float rough) {
  float up = clamp(5.0*ray.y+0.32,0.0,1.0);
  float toward = clamp(0.5+0.5*dot(ray.xz,fLook.xy),0.0,1.0);
  float band = exp2(-abs(ray.y-0.105)/(0.034+0.14*rough));
  return rgb*(0.19+0.78*up) + fSkyAbove.rgb*band*(2.8+2.2*toward);
}
`;
