// The shimmer of a body worth walking to (client/core/shimmer.ts), as the flat and the textured programs add it.

/**
 * How strongly a shimmer shows `t` of the way through its moment, 0 to 1: it eases in over most of a half, holds, and
 * eases out, so it comes as a hint and never snaps on.
 */
export function shimmerSwell(t: number): number {
  const ease = (a: number, b: number): number => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  return ease(0, 0.45) * (1 - ease(0.6, 1));
}

/** The most a shimmer brightens a body's own light, at its rim and in its band, and the pale light it adds beside, after exposure. */
export const SHIMMER_RIM = 0.45, SHIMMER_BAND = 0.35, SHIMMER_PALE = 0.1;

/**
 * The light `lit` of a body that shimmers (packet.ts drawGlow, as `uGlow`), with its shimmer: its own light a little
 * brighter in a thin rim where its surface turns from the eye and in a band rising from its foot to its top over its
 * moment, with a trace of pale blue, so the body keeps its colours under it and is never washed out. `eye` is the
 * frame's exposure, 1 where the light is already as a display shows it: the trace is the same by night as by day.
 * `lit` unchanged where the draw has no shimmer.
 */
export const SHIMMER_GLSL = `uniform vec4 uGlow;
vec3 shimmer(vec3 lit, vec3 n, vec3 v, vec3 rel, float eye) {
  if (uGlow.x <= 0.0) return lit;
  float rim = pow(1.0 - abs(dot(n, v)), 3.5);
  float high = clamp((rel.y - uGlow.z) / max(uGlow.w, 0.5), 0.0, 1.0);
  float band = exp(-pow((high - uGlow.y * 1.3 + 0.15) * 6.0, 2.0));
  float s = uGlow.x * (${SHIMMER_RIM} * rim + ${SHIMMER_BAND} * band);
  return lit * (1.0 + s) + vec3(0.5, 0.8, 1.0) * (${SHIMMER_PALE} * s / eye);
}
`;
