// The shader text of the flat renderer: palette colours, one bone a vertex, the face normal for light. It is the text
// low poly has always been drawn with, and a test pins its hash so that it stays so. A WebGL2 shell compiles it as is.
// The lit tiers draw the same vertices with LIT, which lights them as surface.ts does.

import { DRY_ASPHALT } from "../../../content/surfaces.ts";
import { GLASS, RUST, STEEL, STREET_GLSL } from "./street-finish.ts";
import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import { HAND_GLSL, HAND_VERTEX } from "./hand.ts";
import { BEND_GLSL, BEND_PLACE } from "./bend.ts";
import { PIECE_END, PIECE_GLSL, PIECE_PLACE, PIECE_SHADE, WEAR_OVER_MADE, WEAR_STAGE } from "./pieces.ts";
import { ATLAS_REGION, ATLAS_WIDTH, BONES_PER_ROW, FRAME_BLOCK } from "./packet.ts";
import { AMBIENT, CHECK_COARSE, CHECK_COARSE_FADE, CHECK_COARSE_SIZE, CHECK_FINE, CHECK_FINE_FADE, CHECK_INSET, DIFFUSE } from "./shading.ts";
import { AIR } from "./atmosphere.ts";
import { SHADOW_GLSL } from "./shadowtext.ts";
import { OVER_GROUND_GLSL, SKY_OPEN_GLSL } from "./skyopen.ts";
import { ROOF_GLSL } from "./roof.ts";
import { LIGHT, THROUGH } from "./surface.ts";
import { FACADE_GLSL, ROOM_OPEN_LEAST } from "./facade.ts";
import { GROUND_BAND, GROUND_GLSL, GROUND_SCALE, ROAD_GLSL, SPALL_RIM, SPALL_SURFACE, STREETS_GLSL, WORLD_GLSL, WORLD_SHARP } from "./world-surfaces.ts";
import { WET_DARK, WET_GLSL, WET_ROUGH } from "./bank.ts";

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

/**
 * Palette geometry on textured tiers: world-projected finishes share SURFACE's lighting. Its vertex text gives the colour
 * as light (world-surfaces.ts `worldVertex`). The sky's light is taken down where the sky is hidden and at the foot of
 * what stands, but a body's (skyopen.ts), and under what stands overhead (roof.ts), and its light from the ground is
 * the ground's it sees (roof.ts roofBounce).
 */
export const LIT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 vRel;
flat in vec3 vColor;
flat in int vSurface;
#ifdef STREET_FINISH
flat in int vFixture;
#endif
#ifdef WORLD_WEATHER
in vec3 vOwn;
flat in vec2 vPlace;
in vec2 vFace;
flat in uint vEdges;
flat in int vMade;
#endif
#ifdef FACADE
flat in int vFacade;
#endif
uniform float uSolid, uAlpha, uSkin;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${SKY_OPEN_GLSL}${ROOF_GLSL}${OVER_GROUND_GLSL}${AIR}${WORLD_GLSL.replace("WORLD_NORMAL", "rg")}${FACADE_GLSL}${STREET_GLSL}void main() {
  vec3 dx = dFdx(vRel), dy = dFdy(vRel);
  vec3 geometric = normalize(cross(dx, dy));
  vec3 n = geometric;
  vec3 albedo = vColor;
  vec3 orm = vec3(1.0, 1.0, 0.0);
  float painted = 0.0;
  int surface = vSurface;
#ifdef WORLD_WEATHER
  // A face's material, and over it its piece's wear (pieces.ts): past worn, a wall is lost to its core in patches.
  worldMade = vMade & ${(1 << WEAR_OVER_MADE) - 1};
  int wear = vMade >> ${WEAR_OVER_MADE};
  float rim = 0.0;
  if ((wear & ${WEAR_STAGE}) >= 2 && uSolid < 1.5 && uSkin < 0.5 && uWorldReady > 0.5) {
    vec2 lost = spalled(vRel + uWorldEye, geometric, wear & ${WEAR_STAGE});
    rim = lost.y;
    if (lost.x > 0.5) {
      albedo = SPALL_COLOUR;
      surface = ${SPALL_SURFACE};
      worldMade = 0;
    }
  }
#endif
  if (uSolid < 1.5 && uWorldReady > 0.5) painted = worldSurface(albedo, orm, n, geometric, surface, vRel, dx, dy);
#ifdef WORLD_WEATHER
  albedo *= 1.0 - ${SPALL_RIM} * rim;
#endif
  float over = overGround(vRel);
  float open = skyOpen(vRel, geometric, over, uSkin > 0.5 ? 0.0 : 1.0) * contact(vRel, geometric, uSkin > 0.5 ? 0.0 : 1.0) * roofOpen(vRel, geometric, over);
  roofBounce(vRel, geometric, over);
  // The weathering and the edges read the packed maps, so they come up with them (uWorldReady 2 is the base colours alone).
  float risen = 2.0 - uWorldReady;
#ifdef WORLD_WEATHER
  // No ground known under it (skyopen.ts NO_GROUND), no weathering by its height over it.
  if (uSolid < 1.5 && uSkin < 0.5 && uWorldReady > 0.5 && risen > 0.0 && fFacade.z < 1.5 && over < 1e5) {
    vec3 a0 = albedo, o0 = orm;
    weathered(albedo, orm, surface, over, open, vRel, geometric, dx, dy);
    albedo = mix(a0, albedo, risen);
    orm = mix(o0, orm, risen);
    n = normalize(mix(n, geometric, worldLost * worldCoat * risen));
  }
#endif
#if defined(WORLD_EDGES) || defined(WORLD_EDGE_LINE)
  if (uSolid < 1.5 && uSkin < 0.5 && uWorldReady > 0.5 && risen > 0.0 && mod(fFacade.z, 2.0) < 0.5) {
    vec3 a0 = albedo, o0 = orm, n0 = n;
    edged(albedo, orm, n, surface, vFace, vEdges, painted, vRel, dx, dy);
    albedo = mix(a0, albedo, risen);
    orm = mix(o0, orm, risen);
    if (risen < 1.0) n = normalize(mix(n0, n, risen));
  }
#endif
  // A facade's part and the marks on a wall (facade.ts): the room behind glass lit by the face's daylight, and the street's far side it mirrors.
  vec3 room = vec3(0.0);
  vec4 far = vec4(0.0), roomAt = vec4(vRel, over);
  float roomOpen = 0.0;
  int front = 0;
#ifdef FACADE
  if (uSolid < 1.5 && uSkin < 0.5 && fFacade.y > 0.5 && (front = facade(albedo, orm, n, room, far, roomAt, vFacade, vFace, dFdx(vFace), dFdy(vFace), vOwn, dFdx(vOwn), dFdy(vOwn), vPlace, vEdges, vRel, dx, dy, geometric, vRel.y + uWorldEye.y, over, wear)) == 2) worldSharp = true;
  // A room is lit by the sky's share over the street at the top of its opening (facade.ts ROOM_OUT).
  roomOpen = max(skyOpen(roomAt.xyz, geometric, roomAt.w, 0.0), ${ROOM_OPEN_LEAST.toFixed(2)});
#endif
  vec3 v = -normalize(vRel);
  // A rough finish mirrors the sky's light, which is a colour; only a smooth one shows the sky's picture.
#ifdef STREET_FINISH
  float fixtureShare = 0.8;
  if (vFixture > 0) {
    albedo = vColor;
    n = geometric;
    vec3 place = vRel + uWorldEye;
    float grain = 0.055*sin(dot(place,vec3(3.0,9.0,2.0)));
    worldSharp = vFixture == 3;
    orm = vec3(1.0,(vFixture == 1 ? 0.37 : vFixture == 2 ? 0.58 : 0.26)+grain,vFixture == 2 ? 0.78 : 0.0);
    if (vFixture >= 4) {
      bool tire = vFixture == 5;
      worldSharp = vFixture == 4;
      orm.gb = vFixture == 4 ? vec2(0.14,0.91) : tire ? vec2(0.95,0.0) : vFixture == 6 ? vec2(0.42,0.72) : vec2(0.53,0.08);
      albedo *= tire ? 0.31+0.8*grain : 1.0;
      weatherVehicle(albedo,orm,place,0.0,0.32,false);
      fixtureShare = tire ? 0.0 : (1.0-orm.g)*(vFixture == 7 ? 0.32 : 1.0);
    }
  }
#endif
  vec3 r = reflect(-v,n);
  vec3 mirrored = orm.y >= 1.0 ? vec3(0.0) : worldSharp ? skyFrom(r) : skyLight(r);
  mirrored = mix(mirrored, far.rgb * skyLight(-geometric), far.a);
#ifdef STREET_FINISH
  float receives = vFixture > 0 ? fixtureShare : front == 2 ? 1.0 : front == 3 ? clamp((0.85-orm.y)*3.0,0.0,1.0) : 0.0;
  if (front == 0 && uSolid < 1.5 && uSkin < 0.5 && vFixture == 0) {
    if (surface == ${GLASS}) receives = clamp((0.8-orm.y)*2.5,0.0,1.0);
    else if (surface == ${STEEL} || surface == ${RUST}) receives = clamp((0.85-orm.y)*3.0,0.0,1.0)*orm.z;
  }
  orm.y = receives > 0.0 ? glossRoughness(orm.y,receives) : orm.y;
  mirrored = streetMirror(mirrored,r,vRel,orm.y,receives);
#endif
  o = vec4(shown(lit(albedo, orm * vec3(open, 1.0, 1.0), n, v, mirrored, sunShadow(vRel, geometric)) + room * skyLight(geometric) * roomOpen, vRel), uAlpha);
}`;

/** `text` with `from` put as `to`, which it must hold. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`glsl: no ${JSON.stringify(from)} to replace`);
  return text.replace(from, to);
}

/**
 * LIT's fragment text for a flat mesh: a vertex in one of its landmark's finishes (shared/pack/finish.ts, `finishVertex`)
 * is lit with the finish's occlusion, roughness and metalness, mirroring the sky as SURFACE does, and with its sheet's
 * light from behind. A line's finish, one with a share, is lit as if it faced the eye, and shows its share where it is
 * drawn see-through. Any other is fully rough, as before.
 */
export const LIT_MESH_FRAGMENT = [
  ["flat in vec3 vColor;\n", "flat in vec3 vColor;\nflat in vec4 vFinish;\nflat in float vShare;\n"],
  ["void main() {\n", `${THROUGH}void main() {\n`],
  ["  vec3 orm = vec3(1.0, 1.0, 0.0);\n", "  vec3 orm = vFinish.xyz;\n"],
  ["  vec3 v = -normalize(vRel);\n", "  vec3 v = -normalize(vRel);\n  if (vShare < 1.0) n = v;\n"],
  ["  orm.y = receives > 0.0", "  if (uSolid >= 2.0 && vShare >= 1.0) receives = max(receives,clamp((0.85-orm.y)*3.0,0.0,1.0)*orm.z);\n  orm.y = receives > 0.0"],
  ["worldSharp ? skyFrom(r)", "worldSharp || vFinish.y < 1.0 ? skyFrom(r)"],
  ["  o = vec4(shown(lit(albedo, orm * vec3(open, 1.0, 1.0), n, v, mirrored, sunShadow(vRel, geometric)) + room * skyLight(geometric) * roomOpen, vRel), uAlpha);", "  float shade = sunShadow(vRel, sunward(geometric, vFinish.w));\n  o = vec4(shown(lit(albedo, orm * vec3(open, 1.0, 1.0), n, v, mirrored, shade) + through(albedo, orm, n, vFinish.w, shade) + room * skyLight(geometric) * roomOpen, vRel), uAlpha * vShare);"],
].reduce((text, [from, to]) => swap(text, from!, to!), LIT_FRAGMENT);

/**
 * A flat mesh program's vertex text on a lit tier, after `worldVertex`: where `uSolid` is past 2 the draw is of a
 * landmark whose finishes are in row uSolid - 2 of them on the palette's unit (shared/pack/finish.ts `finishTable`), and
 * a vertex in a colour the landmark states takes the finish's own colour and gives its occlusion, roughness,
 * metalness, sheet and share. Any other vertex gives a fully rough surface that is not metal, all of which shows.
 */
export function finishVertex(vertex: string): string {
  const fetch = "  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;\n";
  return swap(swap(vertex, "flat out vec3 vColor;\n", "flat out vec3 vColor;\nflat out vec4 vFinish;\nflat out float vShare;\nuniform float uSolid;\n"), fetch, `${fetch}  vFinish = vec4(1.0, 1.0, 0.0, 0.0);
  vShare = 1.0;
  if (uSolid > 2.5) {
    int row = int(uSolid) * 2 - 5;
    vec4 own = texelFetch(uPalette, ivec2(int(i), row), 0);
    if (own.a > 0.0) {
      vColor = own.rgb;
      vFinish = texelFetch(uPalette, ivec2(int(i), row + 1), 0);
      vShare = own.a;
    }
  }
`);
}

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
${BONE}${BEND_GLSL}${PIECE_GLSL}void main() {
  vec3 l = uCenter + aPos * uHalf;
  vec3 p;
${PIECE_PLACE}  if (uSkin > 0.5) {
    // A body with bones: the instance names its first bone where a rigid one has its yaw. With uSkin 2 each vertex follows
    // its bone of the pose the body stands in, whose first bone is uOffset.x, and then the instance's first bone.
    vec4 v = vec4(l + iPos, 1.0);
    int first = int(iYaw * 65535.0 + 0.5);
    if (uSkin > 1.5) v = vec4(v * bone(int(uOffset.x) + int(aBone)), 1.0);
    p = v * bone(first + (uSkin > 1.5 ? 0 : int(aBone)));
  } else {
    float t = iYaw * 6.283185307;
    float s = sin(t), c = cos(t);
    if (uSkin < -0.5 && uSkin > -1.5) l *= float(iRegB.y) / ${SIZE_UNITS.toFixed(1)};
${BEND_PLACE}    p = vec3(c * l.x + s * l.z, l.y, c * l.z - s * l.x) + iPos + uOffset;
  }
  uint i = aColor;
  if (i >= ${REGION_BASE}u) { uint r = i - ${REGION_BASE}u; i = r < 4u ? iRegA[r] : iRegB[r - 4u]; }
  vColor = texelFetch(uPalette, ivec2(int(i), 0), 0).rgb;
${PIECE_SHADE}  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
${PIECE_END}}`;

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
 * The lit tiers' terrain text. Its place is FLAT's. The normal the light falls on is from the heights a stride of the tile
 * either side, as far as the picture holds them, and the GPU blends it across each triangle (terrain.ts `groundNormal`).
 * The cover is chosen a pixel, so the vertex gives no colour, only where it is in the picture's samples.
 */
export const LIT_TERRAIN_VERTEX = `#version 300 es
layout(location=0) in uvec4 aGrid;
layout(location=1) in vec4 iTile;
layout(location=2) in vec2 iOrigin;
uniform mat4 uViewProj;
uniform highp usampler2D uHeight;
uniform vec4 uField;
uniform vec2 uLast;
out vec3 vRel, vNormal;
out vec2 vAt;
void main() {
  vec2 ij = min(iOrigin + vec2(aGrid.xy) * iTile.w, uLast);
  ivec2 at = ivec2(ij);
  float h = uField.x + float(texelFetch(uHeight, at, 0).r) * uField.y - uField.w;
  vec2 d = (ij - iOrigin) * uField.z;
  vec3 p = vec3(iTile.x + d.x, h - float(aGrid.z) * iTile.z * 2.0, iTile.y + d.y);
  ivec2 s = ivec2(int(iTile.w), 0), last = ivec2(uLast);
  ivec2 l = max(at - s, 0), r = min(at + s, last), b = max(at - s.yx, 0), f = min(at + s.yx, last);
  vec2 rise = vec2(float(texelFetch(uHeight, r, 0).r) - float(texelFetch(uHeight, l, 0).r), float(texelFetch(uHeight, f, 0).r) - float(texelFetch(uHeight, b, 0).r));
  rise *= uField.y / (vec2(r.x - l.x, f.y - b.y) * uField.z);
  vNormal = normalize(vec3(-rise.x, 1.0, -rise.y));
  vAt = ij;
  vRel = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

/**
 * The lit tiers' ground: LIT lit by the ground's own normal, the face's still choosing the finish's projection and where
 * growth takes, and putting the sun's shadow off the surface. Its cover is the tint of the four samples round the pixel
 * with most of their weight at a place moved by a wander of a fraction of a metre (world-surfaces.ts `groundCover`), so
 * an edge between two covers curves and wanders across a cell; where its finish meets another's, the higher of their
 * painted heights shows through (`groundMeet`). It reads the picture its tile reads at that picture's own samples,
 * however coarse the tile, so it does not change as a tile splits. Its sky's light is taken down where the sky is
 * hidden (skyopen.ts).
 */
export const LIT_TERRAIN_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec3 vRel, vNormal;
in vec2 vAt;
uniform highp usampler2D uTint;
uniform highp sampler2D uPalette;
uniform vec4 uField;
uniform vec2 uLast;
out vec4 o;
${LIGHT}${SHADOW_GLSL}${SKY_OPEN_GLSL}${ROOF_GLSL}${AIR}${WORLD_GLSL.replace("WORLD_NORMAL", "rg")}${GROUND_GLSL}${STREETS_GLSL}${ROAD_GLSL}${WET_GLSL}vec3 groundColour(int tint) {
  vec3 c = texelFetch(uPalette, ivec2(tint, 0), 0).rgb;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec3 dx = dFdx(vRel), dy = dFdy(vRel);
  vec3 geometric = normalize(cross(dx, dy));
  float footprint = max(length(dx.xz), length(dy.xz));
  vec2 world = vRel.xz + uWorldEye.xz;
  // Near a street on the tiers that draw them, its edges come from its lines (STREETS_GLSL), straight at any angle, and
  // the cover is looked up where the pixel is.
  bool streets = false;
#ifdef GROUND_STREETS
  vec3 streetE;
  uvec4 streetK;
  streets = streetsAt(world, streetE, streetK);
#endif
  vec2 s = clamp(vAt + (streets ? vec2(0.0) : groundWander(world, footprint) / uField.z), vec2(0.0), uLast);
  ivec2 i = min(ivec2(s), ivec2(uLast) - 1);
  ivec4 tints = ivec4(texelFetch(uTint, i, 0).r, texelFetch(uTint, i + ivec2(1, 0), 0).r, texelFetch(uTint, i + ivec2(0, 1), 0).r, texelFetch(uTint, i + 1, 0).r);
  // A walk's edge is straight: where the sidewalk is one of the four, the cover is looked up where the pixel is.
  if (!streets && groundWalks(tints)) {
    s = clamp(vAt, vec2(0.0), uLast);
    i = min(ivec2(s), ivec2(uLast) - 1);
    tints = ivec4(texelFetch(uTint, i, 0).r, texelFetch(uTint, i + ivec2(1, 0), 0).r, texelFetch(uTint, i + ivec2(0, 1), 0).r, texelFetch(uTint, i + 1, 0).r);
  }
  int tint = groundCover(tints, s - vec2(i)), streetOther = -1;
  float streetShare = 0.0;
#ifdef GROUND_STREETS
  if (streets) streets = streetCover(tints, s - vec2(i), streetE, streetK, world, footprint, tint, streetOther, streetShare);
#endif
  vec3 albedo = groundColour(tint);
  float asphalt = groundSurface(tint) == ${DRY_ASPHALT.surface} ? 1.0 : 0.0;
  vec3 n = normalize(vNormal), level = n;
  vec3 orm = vec3(1.0, 1.0, 0.0);
  if (uWorldReady > 0.5) {
    float h = worldSurface(albedo, orm, n, geometric, groundSurface(tint), vRel, dx, dy), share;
#ifdef WORLD_ROAD
    groundWorn(albedo, orm, n, groundSurface(tint), vRel + uWorldEye, vAt, dx, dy);
    worldSharp = orm.y < ${f(WORLD_SHARP)};
#endif
    // Where it meets another finish, the higher of the two shows through the other, and a walk meets it on a line; a
    // street's band meets the next on its line.
    int other = streets ? streetOther : groundMeet(tint, tints, s - vec2(i), share);
    if (streets) share = streetShare;
    bool straight = streets || (other >= 0 && (groundSurface(tint) == GROUND_WALK || groundSurface(other) == GROUND_WALK));
    if (straight && !streets) share = walkMeet(share, footprint);
    if (share > 0.0) {
      vec3 albedo2 = groundColour(other), orm2, n2 = level;
      float h2 = worldSurface(albedo2, orm2, n2, geometric, groundSurface(other), vRel, dx, dy);
      float b = straight ? share : higher(h, h2, share, ${f(GROUND_SCALE)}, ${f(GROUND_BAND)});
#ifdef WORLD_ROAD
      groundWorn(albedo2, orm2, n2, groundSurface(other), vRel + uWorldEye, vAt, dx, dy);
#endif
      asphalt = mix(asphalt,groundSurface(other) == ${DRY_ASPHALT.surface} ? 1.0 : 0.0,b);
      albedo = mix(albedo, albedo2, b);
      orm = mix(orm, orm2, b);
      n = normalize(mix(n, n2, b));
      worldSharp = orm.y < ${f(WORLD_SHARP)};
    }
  }
  float shade = sunShadow(vRel, geometric);
  float dry = asphalt*fStreetLook.z;
  albedo *= mix(1.0,${f(DRY_ASPHALT.albedo)},dry);
  orm.y = mix(orm.y,max(orm.y,${f(DRY_ASPHALT.roughnessFloor)}),${f(DRY_ASPHALT.roughnessShare)}*dry);
  if (dry > 0.0) worldSharp = orm.y < ${f(WORLD_SHARP)};
  // Just over the sea and under it the ground is wet (bank.ts shoreWet): darker, and glossier.
  float wet = shoreWet(vRel.y + fHaze.z, geometric, groundSurface(tint));
  if (wet > 0.0) {
    albedo *= 1.0 - ${f(1 - WET_DARK)} * wet;
    orm.y *= 1.0 - ${f(1 - WET_ROUGH)} * wet;
    worldSharp = orm.y < ${f(WORLD_SHARP)};
  }
  float daylight = smoothstep(0.0,0.25,fTrueSun.y);
  orm.x *= (1.0-${f(DRY_ASPHALT.shade)}*dry*fStreetLook.w*(1.0-shade)*daylight)
    * skyOpen(vRel, vec3(0.0, 1.0, 0.0), 0.0, 0.0) * contact(vRel, geometric, 1.0) * roofOpen(vRel, vec3(0.0, 1.0, 0.0), 0.0);
  vec3 v = -normalize(vRel);
  vec3 r = reflect(-v,n);
  // What the ground mirrors, wet most of all: the sky, and the ball where the ray meets it (orb-light.ts).
  vec3 mirrored = orm.y >= 1.0 ? vec3(0.0) : orbMirror(worldSharp ? skyFrom(r) : skyLight(r), r, vRel, orm.y, 1.0);
  o = vec4(shown(lit(albedo, orm, n, v, mirrored, shade), vRel), 1.0);
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
export const LIT_SPLIT_FRAGMENT = LIT_MESH_FRAGMENT.replace("void main() {\n", `${SEE_THROUGH_SPLIT}void main() {\n  dropNearer();\n`);

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
export const LIT_FAR_FRAGMENT = LIT_MESH_FRAGMENT.replace("void main() {\n", `${FAR_FADE}void main() {\n  fadeOut();\n`);
