// What stands overhead: an arcade's slab, an awning, a roof or the floor of a storey over the ground. Under one the lit
// tiers take the sky's light down to what can be seen past its edges, mostly from its open sides, on static pieces, the
// ground and bodies alike (D334). The sky's openness (skyopen.ts) cannot see this: it is made of the city's outline, so
// the floor under an arcade read the street's sky.
//
// - The map: a window ROOF_SIDE metres a side round the camera, a cell a metre, made from the map's own pieces as the
//   far city holds them (CityStatics) when the camera has gone ROOF_MOVE from the middle of the one shown. A piece whose
//   underside stands ROOF_CLEAR or more over its ground roofs each cell whose middle its turned box covers; a cell keeps
//   the lowest underside over it. From each roofed cell, rays leave RAY_FROM over the floor along WAYS ways round and
//   HEIGHTS heights up, each an equal share of the sky; one gets out if it reaches a cell no roof covers before it
//   rises to the roof over where it is, and is taken as stopped after RAY_MOST metres under cover. What got out gives
//   the share of the sky a face turned up keeps there, the way most of it lies, and how much more a face turned that
//   way sees than one turned up. Walls are not in it, so a room deep in a building sees out through them, which keeps a
//   room's light kinder than it would be, never under ROOF_LEAST.
// - On the card: four bytes a cell on its own unit, filtered: the underside's height over the ground in sixteenths of a
//   metre, spread two cells past the roof's edge so the height a point is tested at does not fall away across it; the
//   share a face turned up keeps, 255 where nothing roofs it; and how much more a face turned sideways keeps along x and z,
//   from 128. A cell roofed by nothing keeps everything whatever way it faces, so the filter between a roofed cell and an
//   open one falls smoothly from the one to the other.
// - A point is under a roof when it is below the underside over it, or is a face turned down at it, and the share it
//   keeps is the roof's for its face: the share up, plus the more toward the open side, all of it on an upright face
//   turned that way, half on one turned across it and none on one turned from it, falling to none on a face turned up
//   or down, never under ROOF_LEAST. Over the last ROOF_FADE metres of the window it fades to nothing.
// - The ground's light sent back (the frame block's fSkyBelow, which the sky's table makes as a grey ground in the sun
//   everywhere) is the ground's a face sees: the ground before the face as far as the face stands over it, under a roof
//   out toward its open side. How much of it the sun is on takes the sun's part of that light (BOUNCE_SUN) off where it
//   is not, down to BOUNCE_LEAST of it, what lit ground and walls further off send back; its colour against the grey
//   tints it, half its hue and half its lightness. Both are the map's second layer where the way leads, the sun's share
//   softened over a couple of metres (roofmap.ts), so a ceiling over a shaded floor grades smoothly and shows no copy of
//   the shadows on it. A face low over the ground (BOUNCE_LOW) takes the sun's share from the shadow maps as well, four
//   compared reads along the way, so a car's floor and sills see the shadow the car itself casts. A wall over a sunlit
//   walk gets the walk's warm light and one over a shaded street does not. Under a roof the light from below is this
//   and not the roof's share of it as well. The software rasterizer has no shadow maps, so for it the shadow maps' part
//   is lit and the map's part is as baked.
// - The second layer: the colour of the ground in each cell, as sRGB, from the ground's own tint or the flat piece
//   lying on it, a walk's slab or a floor; and how much of it the sun is on.
//
// The map is made in roofmap.ts, which the first frame's script does not carry. The lookups are here twice, as
// functions on numbers for the software rasterizer and as GLSL for the lit programs, which the rasterizer is held to.

import { srgbToLinear } from "./color-space.ts";
import { ROOF_AT } from "./packet.ts";

/** The share of the light on it the ground sends back, and what stands on it: grass, sand and pale stone; the sky's table is made with it (tools/sky/build.ts). */
export const GROUND = 0.3;
/**
 * The share of what a face on land sees above the horizon that is open sky. The rest is the land about it and what
 * stands on it, hills, trees, rocks and walls, which send back the ground's light.
 */
export const OPEN = 0.6;
/** The sun's part of fSkyBelow for each unit of the sun's light on a face up: GROUND of it, sent back between the ground and what stands on it. */
export const BOUNCE_SUN = GROUND / (1 - GROUND * (1 - OPEN));
/** Cells a side of the window round the camera, a metre each (roofmap.ts). */
export const ROOF_SIDE = 256;
/** The least share of the sky's light a point under a roof keeps: what the floor and walls about it send back. */
export const ROOF_LEAST = 0.25;
/** Metres at the window's edge over which a roof's shade fades to nothing. */
export const ROOF_FADE = 16;
/** Metres under the underside over which a point goes from out from under it to under it. */
export const ROOF_UNDER = 0.4;
/** Bytes a cell, and layers: what stands overhead, then the ground's colour. */
export const ROOF_BYTES = 4;
export const ROOF_LAYERS = 2;
/** Metres the ground a face sees is out toward a roof's open side, at the most, and up off the ground to look the sun's shadow up. */
const BOUNCE_OUT = 3;
const BOUNCE_LIFT = 0.15;
/** The least share of the sun's part of the ground's light kept where the ground a face sees is in shade. */
export const BOUNCE_LEAST = 0.45;
/** Metres over the ground below which a face takes the sun's share from the shadow maps, wholly at the first. */
const BOUNCE_LOW = [0.6, 1.6] as const;
/** The zero of a cell's sideways shares, and their steps to a whole share. */
export const SIDE_ZERO = 128;
export const SIDE_STEPS = 127;

/** A number as GLSL writes it. */
const g = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * What `roofOpen` found last, as ROOF_GLSL's gRoof and gRoofKept hold it for `roofBounce`: the way toward the open side,
 * x and z, times how far under the roof the point is, that share, how far inside the window's fade it is, and the share
 * it kept.
 */
export const ROOF_LAST = new Float64Array(5);
const m = new Float64Array(ROOF_BYTES);

/**
 * Cell (`u`, `v`) of layer `layer` of the map, `side` cells a side, as shares of the window, filtered between the four
 * about it as the card filters a layer of its stack, into `m`; both are held half a cell inside it.
 */
function filtered(map: Uint8Array, side: number, u: number, v: number, layer: number): void {
  const held = (w: number): number => Math.min(Math.max(w, 0.5 / side), 1 - 0.5 / side);
  const tx = held(u) * side - 0.5, tz = held(v) * side - 0.5;
  const bx = Math.floor(tx), bz = Math.floor(tz), fx = tx - bx, fz = tz - bz;
  const byte = (i: number, j: number, b: number): number => map[((layer * side + Math.min(side - 1, Math.max(0, j))) * side + Math.min(side - 1, Math.max(0, i))) * ROOF_BYTES + b]! / 255;
  for (let b = 0; b < ROOF_BYTES; b++) m[b] = (byte(bx, bz, b) * (1 - fx) + byte(bx + 1, bz, b) * fx) * (1 - fz) + (byte(bx, bz + 1, b) * (1 - fx) + byte(bx + 1, bz + 1, b) * fx) * fz;
}

/**
 * The share of the sky's light a camera-relative point keeps under what roofs it, 0 to 1, from the map as the card
 * holds it, `side` cells a side: `n` its face's normal and `over` its height over the ground under it. 1 with no map or
 * past the window. It leaves what it found in ROOF_LAST. The twin of ROOF_GLSL's `roofOpen`.
 */
export function roofOpen(map: Uint8Array, side: number, frame: ArrayLike<number>, rx: number, rz: number, nx: number, ny: number, nz: number, over: number): number {
  ROOF_LAST.fill(0);
  ROOF_LAST[4] = 1;
  const at = ROOF_AT;
  if (frame[at + 3]! <= 0 || side <= 0) return 1;
  const span = frame[at + 2]!;
  const u = (rx - frame[at]!) / span, v = (rz - frame[at + 1]!) / span;
  const inside = Math.min(1, Math.max(0, (Math.min(u, 1 - u, v, 1 - v) * span) / ROOF_FADE));
  if (inside <= 0) return 1;
  filtered(map, side, u, v, 0);
  // A face turned down at the underside's height is the underside, and under it as much as the floor is.
  const height = m[0]! * (255 / 16) + ROOF_UNDER * Math.max(-ny, 0);
  const t = Math.min(1, Math.max(0, (over - height + ROOF_UNDER * 0.75) / ROOF_UNDER));
  const below = inside * (1 - t * t * (3 - 2 * t));
  const tx = (m[2]! * 255 - SIDE_ZERO) / SIDE_STEPS, tz = (m[3]! * 255 - SIDE_ZERO) / SIDE_STEPS;
  ROOF_LAST[0] = tx * below;
  ROOF_LAST[1] = tz * below;
  ROOF_LAST[2] = below;
  ROOF_LAST[3] = inside;
  const seen = Math.min(1, Math.max(ROOF_LEAST, m[1]! + 0.5 * (Math.hypot(tx, tz) + nx * tx + nz * tz) * (1 - Math.abs(ny))));
  return (ROOF_LAST[4] = 1 + (seen - 1) * below);
}

/**
 * After `roofOpen` for the same point, how its light from the ground is changed (surface.ts `bounce`) into `out`: the
 * ground's colour against the sky table's grey, red, green and blue, over the share roofOpen kept, and the share of the
 * sun's part of that light that is lit, from the map's share of the ground the sun is on and, for a face low over the
 * ground, `lit`, the shadow maps' (1 for a software render, which has none). Neutral, all 1, on a frame without it
 * (fRoof.w not 2), past the window, and on a face turned up. The twin of ROOF_GLSL's `roofBounce`.
 */
export function roofBounce(out: Float64Array, map: Uint8Array, side: number, frame: ArrayLike<number>, rx: number, rz: number, nx: number, ny: number, nz: number, over: number, lit = 1): void {
  out.fill(1);
  const at = ROOF_AT, inside = ROOF_LAST[3]!;
  if (frame[at + 3]! <= 1.5 || inside <= 0 || 0.5 - 0.5 * ny < 0.05) return;
  const reach = Math.min(3, Math.max(0.5, over));
  const span = frame[at + 2]!;
  filtered(map, side, (rx + nx * reach + ROOF_LAST[0]! * BOUNCE_OUT - frame[at]!) / span, (rz + nz * reach + ROOF_LAST[1]! * BOUNCE_OUT - frame[at + 1]!) / span, 1);
  const r = srgbToLinear(m[0]!), g = srgbToLinear(m[1]!), b = srgbToLinear(m[2]!);
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bright = 0.5 + (0.5 * grey) / GROUND, scale = bright / Math.max(grey, 0.02), kept = ROOF_LAST[4]!;
  out[0] = 1 + ((0.5 * (bright + r * scale)) / kept - 1) * inside;
  out[1] = 1 + ((0.5 * (bright + g * scale)) / kept - 1) * inside;
  out[2] = 1 + ((0.5 * (bright + b * scale)) / kept - 1) * inside;
  const t = Math.min(1, Math.max(0, (over - BOUNCE_LOW[0]) / (BOUNCE_LOW[1] - BOUNCE_LOW[0]))), low = 1 - t * t * (3 - 2 * t);
  const sunlit = m[3]! + (lit - m[3]!) * low;
  out[3] = 1 + (BOUNCE_LEAST + (1 - BOUNCE_LEAST) * sunlit - 1) * inside;
}

/**
 * `roofOpen` and `roofBounce` as GLSL, which a lit program includes after the frame block and SHADOW_GLSL, with ROOF
 * defined on a tier that has roofs. `groundSun` is how much of the sun the ground gets along a way, `q` its middle and
 * `reach` half of it: four compared reads, at a quarter and three quarters of each half, in the finest cascade that
 * holds the middle, and the far map's there past the near store's pieces; 1 past the cascades. Only a face low over
 * the ground reads it.
 */
export const ROOF_GLSL = `#ifdef ROOF
uniform highp sampler2D uRoof;
vec4 gRoof = vec4(0.0);
float gRoofKept = 1.0;
float roofOpen(vec3 rel, vec3 normal, float over) {
  if (fRoof.w <= 0.0) return 1.0;
  vec2 uv = (rel.xz - fRoof.xy) / fRoof.z;
  vec2 edge = min(uv, 1.0 - uv);
  float inside = clamp(min(edge.x, edge.y) * fRoof.z / ${g(ROOF_FADE)}, 0.0, 1.0);
  if (inside <= 0.0) return 1.0;
  uv = clamp(uv, 0.5 / fRoof.z, 1.0 - 0.5 / fRoof.z);
  vec4 m = texture(uRoof, vec2(uv.x, uv.y * 0.5));
  float height = m.r * ${g(255 / 16)} + ${g(ROOF_UNDER)} * max(-normal.y, 0.0);
  float below = inside * (1.0 - smoothstep(height - ${g(ROOF_UNDER * 0.75)}, height + ${g(ROOF_UNDER * 0.25)}, over));
  vec2 toward = (m.zw * 255.0 - ${g(SIDE_ZERO)}) / ${g(SIDE_STEPS)};
  gRoof = vec4(toward * below, below, inside);
  gRoofKept = mix(1.0, clamp(m.y + 0.5 * (length(toward) + dot(normal.xz, toward)) * (1.0 - abs(normal.y)), ${g(ROOF_LEAST)}, 1.0), below);
  return gRoofKept;
}
#ifdef SHADOW_CASCADES
float groundSun(vec3 q, vec3 reach) {
  if (uCascades == 0 || fSun.w <= 0.0) return 1.0;
  int k = 0;
  float t = shadowShare(q, 0);
  for (int i = 1; i < SHADOW_CASCADES; i++) {
    if (t < 1.0 || i >= uCascades) break;
    k = i;
    t = shadowShare(q, i);
  }
  if (t >= 1.0) return 1.0;
  vec3 at = (fCascades[k] * vec4(q, 1.0)).xyz * 0.5 + 0.5;
  vec3 stride = mat3(fCascades[k]) * reach;
  at.z -= ${g(2 / 65535)};
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 p = at + stride * (float(i) * 0.5 - 0.75);
    sum += texture(uShadow, vec4(p.xy, float(k), p.z));
  }
  return mix(1.0, sum * 0.25 * farBeyond(q, vec3(0.0, 1.0, 0.0)), fSun.w);
}
#else
float groundSun(vec3 q, vec3 reach) {
  return 1.0;
}
#endif
void roofBounce(vec3 rel, vec3 normal, float over) {
  if (fRoof.w <= 1.5 || gRoof.w <= 0.0 || 0.5 - 0.5 * normal.y < 0.05) return;
  vec2 way = normal.xz * clamp(over, 0.5, 3.0) + gRoof.xy * ${g(BOUNCE_OUT)};
  vec2 uv = clamp((rel.xz + way - fRoof.xy) / fRoof.z, 0.5 / fRoof.z, 1.0 - 0.5 / fRoof.z);
  vec4 ground = texture(uRoof, vec2(uv.x, 0.5 + 0.5 * uv.y));
  vec3 c = mix(ground.rgb / 12.92, pow((ground.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, ground.rgb));
  float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float bright = 0.5 + 0.5 * grey / ${g(GROUND)};
  vec3 tint = 0.5 * (bright + c * (bright / max(grey, 0.02))) / gRoofKept;
  float low = 1.0 - smoothstep(${g(BOUNCE_LOW[0])}, ${g(BOUNCE_LOW[1])}, over), lit = ground.a;
  if (low > 0.0) lit = mix(lit, groundSun(vec3(rel.x + way.x, rel.y - over + ${g(BOUNCE_LIFT)}, rel.z + way.y), vec3(way.x, 0.0, way.y) * 0.5), low);
  gBounce = mix(vec4(1.0), vec4(tint, ${g(BOUNCE_LEAST)} + ${g(1 - BOUNCE_LEAST)} * lit), gRoof.w);
}
#else
float roofOpen(vec3 rel, vec3 normal, float over) {
  return 1.0;
}
void roofBounce(vec3 rel, vec3 normal, float over) {
}
#endif
`;
