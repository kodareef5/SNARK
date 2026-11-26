// The shimmer of a body worth walking to (client/core/shimmer.ts), as the flat and the textured programs add it.

/**
 * The light a body that shimmers adds (packet.ts drawGlow, as `uGlow`): a pale rim where its surface turns from the eye,
 * and a band rising from its foot to its top over its moment. Nothing where the draw has no shimmer.
 */
export const SHIMMER_GLSL = `uniform vec4 uGlow;
vec3 shimmer(vec3 n, vec3 v, vec3 rel) {
  if (uGlow.x <= 0.0) return vec3(0.0);
  float rim = pow(1.0 - abs(dot(n, v)), 2.5);
  float high = clamp((rel.y - uGlow.z) / max(uGlow.w, 0.5), 0.0, 1.0);
  float band = exp(-pow((high - uGlow.y * 1.3 + 0.15) * 6.0, 2.0));
  return vec3(0.55, 0.9, 1.0) * uGlow.x * (0.9 * rim + 0.7 * band);
}
`;
