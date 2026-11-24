// The light an orb casts on what stands round it by night (orb.ts OrbCast writes its colour into fOrb[6]): the ball as
// one sphere light with no shadow, which the lit programs add where the tier says so (tiers.ts `orb.light`). It falls
// off as a ball's light does, with the square of the distance from its middle, and is gone ORB_REACH from its skin.
// The lit programs' text is in the first frame, so this file holds only that and its twin for the software render.
//
// And the shadow the ball casts in the light the cascades are cast from, the sun's by day and the moon's by night
// (`orbShade`): worked out, not looked up, since no shadow map reaches as far as a ball this size throws its shadow.
// A point is in it where its ray to the light passes through the ball. Every tier with shadows takes it.

import { CAST_AT, ORB_AT } from "./packet.ts";

/** Metres from the skin at which the light is gone. */
export const ORB_REACH = 400;
/** Where the frame block holds the light's colour, fOrb[6].yzw: light before exposure on a face at the skin turned to the ball. */
export const ORB_COLOUR = ORB_AT + 25;
/** And fOrb[7].xyz: how many times the sky's light the street's picture holds, less one, for the ball in it (street-finish.ts). */
export const ORB_OVER = ORB_AT + 28;

/**
 * The shadow's edge: metres either side of the ball's outline over which it goes from lit to dark at the ball, and how
 * many more for each metre the light has come past the ball's middle, as a penumbra widens (the sun's own is a quarter
 * as wide: this is for the look). And the metres past the ball's middle at which the shadow is gone, fading from half that.
 */
export const ORB_SHADE_SOFT = 1.5;
export const ORB_SHADE_GROWS = 0.02;
export const ORB_SHADE_LENGTH = 1500;

type Numbers = ArrayLike<number>;

const step = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The share of the casting light (fCast) the ball leaves a camera-relative point, 1 for all of it: less where the
 * point's ray to the light passes through the ball, or the point is in it, by how strongly that light casts.
 */
export function orbShade(frame: Numbers, x: number, y: number, z: number): number {
  const r = frame[ORB_AT + 3]!;
  if (r <= 0) return 1;
  const dx = frame[ORB_AT]! - x, dy = frame[ORB_AT + 1]! - y, dz = frame[ORB_AT + 2]! - z;
  // How far along the ray the ball's middle is, and how far off it. A point in the ball is in its shadow by its depth in it.
  const along = dx * frame[CAST_AT]! + dy * frame[CAST_AT + 1]! + dz * frame[CAST_AT + 2]!, far = dx * dx + dy * dy + dz * dz;
  const w = ORB_SHADE_SOFT + ORB_SHADE_GROWS * Math.max(along, 0), off = Math.sqrt(Math.max(far - along * along, 0));
  const dark = (1 - step(r - w, r + w, off)) * step(0, w, Math.max(along, (r * r - far) / (2 * r))) * (1 - step(0.5 * ORB_SHADE_LENGTH, ORB_SHADE_LENGTH, along));
  return 1 - dark * frame[CAST_AT + 3]!;
}

/**
 * The share of the orb's light a camera-relative point (x, y, z) with face normal `n` takes, 0 to 1: 1 on the skin on a
 * face turned to the ball's middle, less by the square of the distance, by the face's cosine, and nothing past its reach.
 */
export function orbReach(frame: Numbers, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const radius = frame[ORB_AT + 3]!;
  if (radius <= 0) return 0;
  const dx = frame[ORB_AT]! - x, dy = frame[ORB_AT + 1]! - y, dz = frame[ORB_AT + 2]! - z;
  const far = Math.max(Math.hypot(dx, dy, dz), radius), t = (far - radius) / ORB_REACH, s = radius / far, w = Math.max(1 - t * t, 0);
  return s * s * w * w * Math.max((nx * dx + ny * dy + nz * dz) / far, 0);
}

/** The orb's light on the point the software render is lighting, which `lit` (surface.ts) adds to what is not metal. */
export const orbCast = new Float64Array(3);

/** Sets `orbCast` for a camera-relative point with face normal `n`, from the frame block; nothing where the tier has no such light. */
export function orbSees(frame: Numbers, on: boolean, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const share = on ? orbReach(frame, x, y, z, nx, ny, nz) : 0;
  for (let c = 0; c < 3; c++) orbCast[c] = frame[ORB_COLOUR + c]! * share;
}

/** `orbSees` in GLSL, after LIGHT, which declares gOrb: one branch where the map has no orb. */
export const ORB_SEES_GLSL = `#ifdef ORB_LIGHT
void orbSees(vec3 rel, vec3 normal) {
  gOrb = vec3(0.0);
  if (fOrb[0].w <= 0.0) return;
  vec3 d = fOrb[0].xyz - rel;
  float far = max(length(d), fOrb[0].w), t = (far - fOrb[0].w) / ${ORB_REACH.toFixed(1)}, s = fOrb[0].w / far, w = max(1.0 - t * t, 0.0);
  gOrb = fOrb[6].yzw * (s * s * w * w * max(dot(normal, d) / far, 0.0));
}
#endif
`;

/** `orbShade` in GLSL, after the frame block: one branch where the map has no orb. */
export const ORB_SHADE_GLSL = `#ifdef ORB_SHADE
float orbShade(vec3 rel) {
  if (fOrb[0].w <= 0.0) return 1.0;
  vec3 d = fOrb[0].xyz - rel;
  float along = dot(d, fCast.xyz), far = dot(d, d), r = fOrb[0].w;
  float w = ${ORB_SHADE_SOFT.toFixed(1)} + ${ORB_SHADE_GROWS} * max(along, 0.0), off = sqrt(max(far - along * along, 0.0));
  float dark = (1.0 - smoothstep(r - w, r + w, off)) * smoothstep(0.0, w, max(along, (r * r - far) / (2.0 * r))) * (1.0 - smoothstep(${(0.5 * ORB_SHADE_LENGTH).toFixed(1)}, ${ORB_SHADE_LENGTH.toFixed(1)}, along));
  return 1.0 - dark * fCast.w;
}
#endif
`;
