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

export function exhaustPhase(ms: number): number {
  return (ms % 320) * (2 * Math.PI / 320);
}

// Optical depth through the plume falls at the silhouette and toward the tip. A travelling
// compression band modulates the hot core without blinking either jet off between frames.
export function exhaustLight(out: Float64Array, along: number, azimuth: number, facing: number, phase: number, exposure: number): number {
  const fuel = clamp(1 - along);
  const ripple = Math.sin(6.2831853 * azimuth + 19 * along - phase);
  const depth = clamp((facing - 0.12 + 0.12 * along * ripple) / 0.88);
  const cells = 0.5 + 0.5 * Math.cos(32 * along + 4 * (1-depth) - phase);
  const spine = clamp(1.8*depth - 0.25);
  const core = fuel * fuel * spine ** 3 * (0.55 + 0.45 * cells);
  const adapt = Math.min(1, 1.7 / Math.max(1, exposure));
  out[0] = adapt * (0.008 + 3.9 * core ** 3);
  out[1] = adapt * (0.10 + 5.8 * core);
  out[2] = adapt * (1.45 + 4.2 * core);
  return fuel*fuel*(3-2*fuel) * Math.min(0.98, 1.45*depth*depth) * (0.82+0.18*cells);
}

export const EXHAUST_GLSL = `
vec4 exhaustLight(vec2 uv, float facing, float phase, float exposure) {
  float fuel = clamp(1.0-uv.y,0.0,1.0);
  float ripple = sin(6.2831853*uv.x+19.0*uv.y-phase);
  float depth = clamp((facing-0.12+0.12*uv.y*ripple)/0.88,0.0,1.0);
  float cells = 0.5+0.5*cos(32.0*uv.y+4.0*(1.0-depth)-phase);
  float spine = clamp(1.8*depth-0.25,0.0,1.0);
  float core = fuel*fuel*spine*spine*spine*(0.55+0.45*cells);
  vec3 light = vec3(0.008+3.9*core*core*core,0.10+5.8*core,1.45+4.2*core);
  return vec4(light*min(1.0,1.7/max(1.0,exposure)),
              fuel*fuel*(3.0-2.0*fuel)*min(0.98,1.45*depth*depth)*(0.82+0.18*cells));
}`;
