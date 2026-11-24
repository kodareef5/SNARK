// The light an orb casts on what stands round it by night (orb.ts OrbCast writes its colour into fOrb[6]): the ball as
// one sphere light with no shadow, which the lit programs add where the tier says so (tiers.ts `orb.light`). It falls
// off as a ball's light does, with the square of the distance from its middle, and is gone ORB_REACH from its skin.
// The lit programs' text is in the first frame, so this file holds only that and its twin for the software render.

import { ORB_AT } from "./packet.ts";

/** Metres from the skin at which the light is gone. */
export const ORB_REACH = 400;
/** Where the frame block holds the light's colour, fOrb[6].yzw: light before exposure on a face at the skin turned to the ball. */
export const ORB_COLOUR = ORB_AT + 25;
/** And fOrb[7].xyz: how many times the sky's light the street's picture holds, less one, for the ball in it (street-finish.ts). */
export const ORB_OVER = ORB_AT + 28;

type Numbers = ArrayLike<number>;

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
