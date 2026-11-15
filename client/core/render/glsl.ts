// The shader text of the flat renderer: palette colours, one bone a vertex, the face normal for light. It is the text
// low poly has always been drawn with, and a test pins its hash so that it stays so. A WebGL2 shell compiles it as is.
// The lit tiers draw the same vertices with LIT, which lights them as surface.ts does.

import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import { FADE_ORDER } from "./far.ts";
import { BONES_PER_ROW, FRAME_BLOCK } from "./packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE } from "./shading.ts";
import { AIR } from "./atmosphere.ts";
import { SHADOW_GLSL } from "./shadowtext.ts";
import { LIGHT } from "./surface.ts";

const f = (n: number): string => n.toFixed(4);

export const FLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRel;
flat in vec3 vColor;
uniform vec3 uSun, uSky, uCamMod;
uniform vec2 uFog;
uniform float uSolid, uAlpha, uLight;
out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  float light = (${f(AMBIENT)} + ${f(DIFFUSE)} * max(dot(n, uSun), 0.0)) * uLight;
  vec3 w = vRel + uCamMod - n * ${f(CHECK_INSET)};
  if (uSolid < 0.5) w.y = 0.0;
  float d = length(vRel);
  float shade = 1.0;
  vec3 a = floor(w);
  vec3 b = floor(w / ${f(CHECK_COARSE_SIZE)});
  if (uSolid < 1.5) {
    if (mod(a.x + a.y + a.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_FINE)} * max(0.0, 1.0 - d / ${f(CHECK_FINE_FADE)});
    if (mod(b.x + b.y + b.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_COARSE)} * max(0.0, 1.0 - d / ${f(CHECK_COARSE_FADE)});
  }
  float fog = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  o = vec4(mix(vColor * light * shade, uSky, fog * fog), uAlpha);
}`;

/**
 * LIT, what the lit tiers draw flat with in FLAT's place, from FLAT's vertex texts: its normal and checker, the checker
 * darkening the palette colour as FLAT's does, then lit as SURFACE lights a fully rough surface that is not metal, in
 * the sun's shadow where it falls.
 */
export const LIT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRel;
flat in vec3 vColor;
uniform vec3 uCamMod;
uniform float uSolid, uAlpha;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${AIR}void main() {
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 w = vRel + uCamMod - n * ${f(CHECK_INSET)};
  if (uSolid < 0.5) w.y = 0.0;
  float d = length(vRel);
  float shade = 1.0;
  vec3 a = floor(w);
  vec3 b = floor(w / ${f(CHECK_COARSE_SIZE)});
  if (uSolid < 1.5) {
    if (mod(a.x + a.y + a.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_FINE)} * max(0.0, 1.0 - d / ${f(CHECK_FINE_FADE)});
    if (mod(b.x + b.y + b.z, 2.0) > 0.5) shade -= ${f(1 - CHECK_COARSE)} * max(0.0, 1.0 - d / ${f(CHECK_COARSE_FADE)});
  }
  vec3 c = vColor * shade;
  vec3 albedo = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  o = vec4(shown(lit(albedo, vec3(1.0, 1.0, 0.0), n, -vRel / d, vec3(0.0), sunShadow(vRel, n)), vRel), uAlpha);
}`;

export const FLAT_MESH_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in uint aColor;
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
layout(location=6) in uint aBone;
uniform mat4 uViewProj;
uniform vec3 uOffset, uCenter, uHalf;
uniform float uSkin;
uniform sampler2D uPalette;
uniform highp sampler2D uBones;
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
  if (uSkin > 0.5) {
    // A body with bones: the instance names its first bone where a rigid one has its yaw. With uSkin 2 every vertex follows that bone.
    int n = (int(iYaw * 65535.0 + 0.5) + (uSkin > 1.5 ? 0 : int(aBone))) * 3;
    ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
    vec4 v = vec4(l + iPos, 1.0);
    p = vec3(dot(texelFetch(uBones, at, 0), v), dot(texelFetch(uBones, at + ivec2(1, 0), 0), v), dot(texelFetch(uBones, at + ivec2(2, 0), 0), v));
  } else {
    float t = iYaw * 6.283185307;
    float s = sin(t), c = cos(t);
    if (uSkin < -0.5) l *= float(iRegB.y) / ${SIZE_UNITS.toFixed(1)};
    p = vec3(c * l.x + s * l.z, l.y, c * l.z - s * l.x) + iPos + uOffset;
  }
  uint i = aColor;
  if (i >= ${REGION_BASE}u) { uint r = i - ${REGION_BASE}u; i = r < 4u ? iRegA[r] : iRegB[r - 4u]; }
  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const FLAT_TERRAIN_VERTEX = `#version 300 es
layout(location=0) in uvec4 aGrid;
layout(location=1) in vec4 iTile;
layout(location=2) in vec2 iOrigin;
uniform mat4 uViewProj;
uniform highp usampler2D uHeight, uTint;
uniform sampler2D uPalette;
uniform vec4 uField;
uniform vec2 uLast;
out vec3 vRel;
flat out vec3 vColor;
void main() {
  vec2 ij = min(iOrigin + vec2(aGrid.xy) * iTile.w, uLast);
  ivec2 at = ivec2(ij);
  float h = uField.x + float(texelFetch(uHeight, at, 0).r) * uField.y - uField.w;
  vec2 d = (ij - iOrigin) * uField.z;
  vec3 p = vec3(iTile.x + d.x, h - float(aGrid.z) * iTile.z * 2.0, iTile.y + d.y);
  vColor = texelFetch(uPalette, ivec2(int(texelFetch(uTint, at, 0).r), 0), 0).rgb;
  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

/**
 * Every see-through program of a lit tier includes this and calls dropNearer() first. A see-through draw across the
 * split is drawn in both depth ranges; in the far one `uFrom` is the split, and a fragment nearer than that, which the
 * near range drew, is dropped, so no band of it is blended twice. Everywhere else `uFrom` is 0.
 */
export const SEE_THROUGH_SPLIT = `uniform float uFrom;
void dropNearer() {
  if (1.0 / gl_FragCoord.w < uFrom) discard;
}
`;

/** FLAT's fragment text with SEE_THROUGH_SPLIT, for a tier with a split that is not lit. */
export const FLAT_SPLIT_FRAGMENT = FLAT_FRAGMENT.replace("out vec4 o;\nvoid main() {\n", `out vec4 o;\n${SEE_THROUGH_SPLIT}void main() {\n  dropNearer();\n`);

/** LIT's fragment text with SEE_THROUGH_SPLIT, which the lit tiers draw see-through flat draws with. */
export const LIT_SPLIT_FRAGMENT = LIT_FRAGMENT.replace("void main() {\n", `${SEE_THROUGH_SPLIT}void main() {\n  dropNearer();\n`);

/**
 * The far fade, whose twin is far.ts `fadeKeeps`: a far draw is gone at `uFade` metres, and over the last share of that,
 * fView.w, a fragment is dropped where its pixel's place in a 4 by 4 ordered pattern says, so its coverage falls evenly
 * to none. A program calls fadeOut() first, before anything is lit.
 */
export const FAR_FADE = `uniform float uFade;
const float FADE_ORDER[16] = float[16](${FADE_ORDER.map((v) => v.toFixed(1)).join(", ")});
void fadeOut() {
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  if ((uFade - length(vRel)) * 16.0 <= (FADE_ORDER[q.y * 4 + q.x] + 0.5) * uFade * fView.w) discard;
}
`;

/** FLAT's fragment text with the far fade, which low poly draws far blocks with. */
export const FLAT_FAR_FRAGMENT = FLAT_FRAGMENT.replace("out vec4 o;\nvoid main() {\n", `out vec4 o;\n${FRAME_BLOCK}${FAR_FADE}void main() {\n  fadeOut();\n`);

/** LIT's fragment text with the far fade, which the lit tiers draw far blocks with. */
export const LIT_FAR_FRAGMENT = LIT_FRAGMENT.replace("void main() {\n", `${FAR_FADE}void main() {\n  fadeOut();\n`);
