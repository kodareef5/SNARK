// The shader text of the flat renderer: palette colours, one bone a vertex, the face normal for light. It is the text
// low poly has always been drawn with, and a test pins its hash so that it stays so. A WebGL2 shell compiles it as is.
// The lit tiers draw the same vertices with LIT, which lights them as surface.ts does.

import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import { HAND_GLSL, HAND_VERTEX } from "./hand.ts";
import { ATLAS_REGION, ATLAS_WIDTH, BONES_PER_ROW, FRAME_BLOCK } from "./packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE } from "./shading.ts";
import { AIR } from "./atmosphere.ts";
import { SHADOW_GLSL } from "./shadowtext.ts";
import { LIGHT } from "./surface.ts";
import { WORLD_GLSL } from "./world-surfaces.ts";

const f = (n: number): string => n.toFixed(4);

const BONE = `mat3x4 bone(int i) {
  int n = i * 3;
  ivec2 at = ivec2(n % ${BONES_PER_ROW * 3}, n / ${BONES_PER_ROW * 3});
  return mat3x4(texelFetch(uBones, at, 0), texelFetch(uBones, at + ivec2(1, 0), 0), texelFetch(uBones, at + ivec2(2, 0), 0));
}
`;

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

/** Palette geometry on textured tiers: world-projected finishes share SURFACE's lighting. Its vertex text gives the colour as light (world-surfaces.ts `worldVertex`). */
export const LIT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 vRel;
flat in vec3 vColor;
uniform float uSolid, uAlpha;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${AIR}${WORLD_GLSL.replace("WORLD_NORMAL", "rg")}void main() {
  vec3 geometric = normalize(cross(dFdx(vRel), dFdy(vRel)));
  vec3 n = geometric;
  vec3 albedo = vColor;
  vec3 orm = vec3(1.0, 1.0, 0.0);
  if (uSolid < 1.5 && uWorldReady > 0.5) worldSurface(albedo, orm, n);
  vec3 v = -normalize(vRel);
  vec3 mirrored = orm.y < 1.0 ? skyFrom(reflect(-v,n)) : vec3(0.0);
  o = vec4(shown(lit(albedo, orm, n, v, mirrored, sunShadow(vRel, geometric)), vRel), uAlpha);
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
${BONE}void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
  if (uSkin > 0.5) {
    // A body with bones: the instance names its first bone where a rigid one has its yaw. With uSkin 2 each vertex follows
    // its bone of the pose the body stands in, whose first bone is uOffset.x, and then the instance's first bone.
    vec4 v = vec4(l + iPos, 1.0);
    int first = int(iYaw * 65535.0 + 0.5);
    if (uSkin > 1.5) v = vec4(v * bone(int(uOffset.x) + int(aBone)), 1.0);
    p = v * bone(first + (uSkin > 1.5 ? 0 : int(aBone)));
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
 * split is drawn in both depth ranges; in the far one `uFrom` is the split, and a fragment wholly nearer than that,
 * which the near range drew, is dropped. Everywhere else `uFrom` is 0. The near range is cut at the split sample by
 * sample but a fragment is dropped whole, so a pixel whose samples reach past the split (half its depth across bounds
 * where they lie) is kept in the far range, and none of them is left undrawn; its samples between where the far range
 * begins and the split are blended twice.
 */
export const SEE_THROUGH_SPLIT = `uniform float uFrom;
void dropNearer() {
  float z = 1.0 / gl_FragCoord.w;
  if (z + 0.5 * fwidth(z) < uFrom) discard;
}
`;

/** FLAT's fragment text with SEE_THROUGH_SPLIT, for a tier with a split that is not lit. */
export const FLAT_SPLIT_FRAGMENT = FLAT_FRAGMENT.replace("out vec4 o;\nvoid main() {\n", `out vec4 o;\n${SEE_THROUGH_SPLIT}void main() {\n  dropNearer();\n`);

/** LIT's fragment text with SEE_THROUGH_SPLIT, which the lit tiers draw see-through flat draws with. */
export const LIT_SPLIT_FRAGMENT = LIT_FRAGMENT.replace("void main() {\n", `${SEE_THROUGH_SPLIT}void main() {\n  dropNearer();\n`);

/**
 * The far fade, whose twin is far.ts `fadeKeeps`: a far draw is gone at `vGone` metres, and over the last share of that,
 * fView.w, a fragment is dropped where its pixel's place in a 4 by 4 ordered pattern says, so its coverage falls evenly
 * to none. A draw at -`vGone` fades in over the same distances, keeping what the other drops (farcity.ts). A node's draw
 * also drops what the hand-over between the stores says (hand.ts). A program calls fadeOut() first, before anything is lit.
 */
export const FAR_FADE = `${HAND_GLSL}flat in float vGone;
void fadeOut() {
  ivec2 q = ivec2(gl_FragCoord.xy) & 3;
  float g = abs(vGone);
  if (vGone != 0.0 && ((g - length(vRel)) * 16.0 <= (FADE_ORDER[q.y * 4 + q.x] + 0.5) * g * fView.w) == (vGone > 0.0)) discard;
  if (handDrops()) discard;
}
`;

/**
 * FLAT's vertex text for the far programs: where the draw is gone, `uFade`, and how far the instance's foot is, an
 * instance its hand-over keeps none of put out of view.
 */
export const FAR_MESH_VERTEX = FLAT_MESH_VERTEX.replace("out vec3 vRel;\n", `out vec3 vRel;\n${FRAME_BLOCK}${HAND_VERTEX}uniform float uFade;\nflat out float vGone, vAt;\n`)
  .replace("  vRel = p;\n", "  vRel = p;\n  vGone = uFade;\n  vAt = length(iPos + uOffset);\n")
  .replace("  gl_Position = uViewProj * vec4(p, 1.0);\n", "  gl_Position = handGone(vAt) ? vec4(0.0, 0.0, 2.0, 1.0) : uViewProj * vec4(p, 1.0);\n");

/**
 * The vertex text of a DRAW_PULLED draw: the instance's mesh is the row of the atlas its region ATLAS_REGION names, and
 * this vertex is that row's texel after the first, as FLAT's would be, sized and turned. An instance past the row's
 * reach, or one its hand-over keeps none of, is put out of view, and an index past the row's vertices finds a texel of
 * zeros, a triangle of no size.
 */
export const PULLED_VERTEX = `#version 300 es
layout(location=2) in vec3 iPos;
layout(location=3) in float iYaw;
layout(location=4) in uvec4 iRegA;
layout(location=5) in uvec2 iRegB;
uniform mat4 uViewProj;
uniform vec3 uOffset;
uniform sampler2D uPalette;
uniform highp sampler2D uAtlas;
out vec3 vRel;
flat out vec3 vColor;
flat out float vGone, vAt;
${FRAME_BLOCK}${HAND_VERTEX}void main() {
  int row = int(iRegB.x);
  vec4 v = gl_VertexID < ${ATLAS_WIDTH - 1} ? texelFetch(uAtlas, ivec2(gl_VertexID + 1, row), 0) : vec4(0.0);
  float t = iYaw * 6.283185307;
  float s = sin(t), c = cos(t);
  vec3 l = v.xyz * (float(iRegB.y) / ${SIZE_UNITS.toFixed(1)});
  vec3 p = vec3(c * l.x + s * l.z, l.y, c * l.z - s * l.x) + iPos + uOffset;
  uint i = uint(v.w);
  if (i >= ${REGION_BASE}u) { uint r = i - ${REGION_BASE}u; i = r < ${ATLAS_REGION}u ? iRegA[r] : 0u; }
  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
  vRel = p;
  vGone = texelFetch(uAtlas, ivec2(0, row), 0).x;
  vAt = length(iPos + uOffset);
  gl_Position = vAt < vGone && !handGone(vAt) ? uViewProj * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}`;

/** FLAT's fragment text with the far fade, which low poly draws far blocks with. */
export const FLAT_FAR_FRAGMENT = FLAT_FRAGMENT.replace("out vec4 o;\nvoid main() {\n", `out vec4 o;\n${FRAME_BLOCK}${FAR_FADE}void main() {\n  fadeOut();\n`);

/** LIT's fragment text with the far fade, which the lit tiers draw far blocks with. */
export const LIT_FAR_FRAGMENT = LIT_FRAGMENT.replace("void main() {\n", `${FAR_FADE}void main() {\n  fadeOut();\n`);
