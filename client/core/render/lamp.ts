// The street lamp that lights as a light by night (planning/workstreams/night-light.md). Every working lamp near enough
// draws its cards (street-lamps.ts); on a tier whose shadows say so, the nearest within LAMP_REACH of the camera is a
// light in the lit programs as well: its pool thrown out over the road as a cobra head's refractor throws it, falling off
// with the square of the distance and cut off at LAMP_RANGE, and a shadow drawn from the lens into a layer of the shadow
// array of its own, after the far map's (shadowtext.ts `shadowLayer`). Its pool card fades out as its light fades in,
// and the light goes from one lamp to the next through their cards, which on such a tier lie where its light does and
// show on the road as it does. The software render has no shadow maps, so there the lamp lights unshadowed (`lampSees`).

import { FRAME, LAMP_AT, MAX_CASCADES } from "./packet.ts";

/** The lamp's bit among a caster's cascades and the frame's maps drawn: the one after the cascades'. */
export const LAMP_BIT = 1 << MAX_CASCADES;
/** Metres along the ground from the camera within which the nearest working lamp lights as a light. */
export const LAMP_REACH = 40;
/**
 * Metres nearer to the camera than the pool of the lamp that lights another's must be to take its light: the light
 * changes hands seldom, well past the middle between two lamps, and never back and forth.
 */
export const LAMP_HOLD = 6;
/** Metres from the lens the lamp's light reaches, falling smoothly to nothing there, and the far plane of its map. */
export const LAMP_RANGE = 24;
/** How far a lamp's lens stands over the road under it (street-lamps.ts LENS): its pool is laid out on the ground that far down. */
export const LAMP_GROUND = 8.85;
/**
 * The lamp's pool on that ground, as a cobra head's refractor throws it: an ellipse whose middle lies LAMP_OUT metres
 * out over the road from under the lens, LAMP_WIDE either way across the road from there (so its rim comes back over
 * the walk behind the mast less far than it reaches out over the road) and LAMP_LONG either way along it. Its light
 * falls from the middle to the rim as the card's does (detailtext.ts poolOf), and the card is laid out alike
 * (street-lamps.ts), so on the road the two show alike. A way from the lens takes the light of the ground it points at,
 * so a car's roof under the pool's middle takes the middle's light, and more of it for being nearer the lens.
 */
export const LAMP_OUT = 2;
export const LAMP_WIDE = 9;
export const LAMP_LONG = 12;
/** Half the side of the map's view from the lens, as a tangent: a little past the farthest the pool reaches. */
export const LAMP_TAN = (1.05 * Math.max(LAMP_OUT + LAMP_WIDE, LAMP_LONG)) / LAMP_GROUND;
/** The farthest across from under its lens the lamp lights anything: its range at the edge of its map's view. */
export const LAMP_ACROSS = (LAMP_RANGE * LAMP_TAN) / Math.sqrt(1 + LAMP_TAN * LAMP_TAN);
/**
 * The lamp's map takes a corner of its layer, this share of its side, so its texels are that much wider than the
 * cascades' (about 4 cm on the road from a 2,048 layer): the four taps that look it up then soften a car's shadow's
 * edge over some 10 cm, as a lens 0.4 by 0.7 m would, and what casts into it is drawn at a coarser level.
 */
export const LAMP_CORNER = 0.25;
/** Metres from the lens to the map's near plane: under the head, which stands over the lens and so is not drawn. */
export const LAMP_NEAR = 0.25;
/** The least depth under the lens a lit point is taken to stand at, so that its light does not run away there. */
export const LAMP_NEAREST = 0.5;
/**
 * The lamp's light: a high-pressure sodium lamp's warm colour, as its cards have it (street-lamps.ts POOL_COLOUR), and
 * how much of it falls on the ground at the pool's middle, as light after exposure, so that it shows as brightly
 * whatever the night's exposure, as the cards do. The road's asphalt, a twentieth of the light or so, then shows about
 * as the old card did, and a pale walk at the mast at the tone's knee (surface.ts KNEE), not blown white.
 */
export const LAMP_COLOUR = [1, 0.3, 0.08] as const;
export const LAMP_POOL = 16;
/**
 * A sodium lamp's light is a narrow band of yellow and orange, not white light with its blue taken out, so a surface
 * sends back the share of it its reflectance there gives, which lies between its red's and its green's (LAMP_SEES of
 * each), whatever its colour: under it colours wash into the lamp's own, LAMP_WASH of the way. Taken channel by
 * channel as the sun's broad light is, a green surface would send back twice the green a grey one does, and grass by
 * the mast showed yellow-green in a pool of orange.
 */
export const LAMP_SEES = [0.6, 0.4, 0] as const;
export const LAMP_WASH = 0.8;
/** Seconds the lamp's light takes to fade into its card, or out of it, eased at both ends. */
export const LAMP_FADE = 0.4;
/**
 * The shadows in a lamp's pool card (street-lamps.ts, packet.ts DETAIL_SHADED_POOL), where the tier's shadows say so
 * (Tier.shadows.pools): each body of the frame's contact list (contact.ts fContact, the bodies and parked cars nearest
 * the camera, each a box) takes the pool's light where the way from the ground to the lens runs through its box, all of
 * it once the way runs POOL_SOFT metres inside, so the shadow's edge is soft where the way only grazes the box. A body
 * casts less from POOL_FROM metres from the camera and nothing at the list's reach, POOL_TO, so it fades as it leaves.
 */
export const POOL_SOFT = 0.35;
export const POOL_FROM = 45;
export const POOL_TO = 60;
/** How the lens's place from a pool card's middle is held in the card's second colour, which a pool's shape does not use: x and z across ±POOL_ACROSS / 2, y up to POOL_UP. */
export const POOL_ACROSS = 8;
export const POOL_UP = 12;

type Numbers = ArrayLike<number>;

const step = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A body's box's frame: the point, the way to the lens and the half extents, in it. */
const inBox = new Float64Array(3), toLens = new Float64Array(3), half = new Float64Array(3);

/**
 * The bodies of the contact list (from `contact` in `frame`, `slots` of them) that may stand between a pool reaching
 * `reach` metres along the ground round its lens, at camera-relative (lx, lz), and the lens, a bit each: those whose
 * box comes within that of it. A pool card holds them (its floor, packet.ts DETAIL), and its fragment looks at those
 * alone, which are seldom more than two or three; a card that holds none is a plain pool.
 */
export function poolCasters(frame: Numbers, contact: number, slots: number, lx: number, lz: number, reach: number): number {
  let mask = 0;
  for (let k = 0; k < slots; k++) {
    const o = contact + k * 8, across = frame[o + 4]!;
    if (across <= 0) break;
    const r = reach + Math.max(across, Math.abs(frame[o + 6]!));
    if ((frame[o]! - lx) ** 2 + (frame[o + 2]! - lz) ** 2 < r * r) mask |= 1 << k;
  }
  return mask;
}

/**
 * The share of a card lamp's pool left at camera-relative (x, y, z) by the bodies `mask` names of the frame's contact
 * list, its lens at camera-relative (lx, ly, lz): the twin of `poolShadeGlsl`.
 */
export function poolShade(frame: Numbers, contact: number, slots: number, mask: number, x: number, y: number, z: number, lx: number, ly: number, lz: number): number {
  let keep = 1;
  const dx = lx - x, dy = ly - y, dz = lz - z, span = Math.hypot(dx, dy, dz);
  for (let k = 0; k < slots && mask >> k !== 0; k++) {
    const o = contact + k * 8;
    if (((mask >> k) & 1) === 0) continue;
    if (frame[o + 4]! <= 0) break;
    const c = frame[o + 3]!, s = frame[o + 7]!, ox = x - frame[o]!, oy = y - frame[o + 1]!, oz = z - frame[o + 2]!;
    inBox[0] = c * ox - s * oz; inBox[1] = oy; inBox[2] = s * ox + c * oz;
    toLens[0] = c * dx - s * dz; toLens[1] = dy; toLens[2] = s * dx + c * dz;
    half[0] = frame[o + 4]!; half[1] = frame[o + 5]!; half[2] = Math.abs(frame[o + 6]!);
    let enter = 0, leave = 1;
    for (let i = 0; i < 3; i++) {
      const ri = Math.abs(toLens[i]!) < 1e-5 ? 1e-5 : toLens[i]!, t0 = (-half[i]! - inBox[i]!) / ri, t1 = (half[i]! - inBox[i]!) / ri;
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
    }
    if (leave <= enter) continue;
    const far = frame[o]! ** 2 + frame[o + 1]! ** 2 + frame[o + 2]! ** 2;
    keep *= 1 - step(0, POOL_SOFT, (leave - enter) * span) * (1 - step(POOL_FROM * POOL_FROM, POOL_TO * POOL_TO, far));
  }
  return keep;
}

/**
 * A pool card's lens from its middle as its second colour's bytes (RGBA, least significant first): see POOL_ACROSS. -1
 * where it lies farther than they hold, as over ground far under the lamp's foot, which then takes no shadows.
 */
export function lensWord(dx: number, dy: number, dz: number): number {
  if (Math.abs(dx) > POOL_ACROSS / 2 || Math.abs(dz) > POOL_ACROSS / 2 || dy <= 0 || dy > POOL_UP) return -1;
  const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (byte(dx / POOL_ACROSS + 0.5) | (byte(dy / POOL_UP) << 8) | (byte(dz / POOL_ACROSS + 0.5) << 16) | (255 << 24)) >>> 0;
}

/** The lens's place from the middle, from a pool card's second colour (`lensWord`), into `out`. */
export function lensOfWord(word: number, out: Float64Array | number[]): void {
  out[0] = ((word & 255) / 255 - 0.5) * POOL_ACROSS;
  out[1] = (((word >>> 8) & 255) / 255) * POOL_UP;
  out[2] = (((word >>> 16) & 255) / 255 - 0.5) * POOL_ACROSS;
}

const gl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** `poolShade` in GLSL, after the frame block, `slots` the contact list's (packet.ts MAX_CONTACTS). */
export const poolShadeGlsl = (slots: number): string => `float poolShade(vec3 p, vec3 l, uint mask) {
  float keep = 1.0;
  vec3 d = l - p;
  float span = length(d);
  for (int k = 0; k < ${slots} && (mask >> uint(k)) != 0u; k++) {
    if (((mask >> uint(k)) & 1u) == 0u) continue;
    vec4 a = fContact[k * 2], b = fContact[k * 2 + 1];
    if (b.x <= 0.0) break;
    vec3 m = p - a.xyz;
    vec3 q = vec3(a.w * m.x - b.w * m.z, m.y, b.w * m.x + a.w * m.z), r = vec3(a.w * d.x - b.w * d.z, d.y, b.w * d.x + a.w * d.z);
    r = mix(r, vec3(1e-5), lessThan(abs(r), vec3(1e-5)));
    vec3 e = abs(b.xyz), t0 = (-e - q) / r, t1 = (e - q) / r, lo = min(t0, t1), hi = max(t0, t1);
    float inside = min(min(hi.x, hi.y), min(hi.z, 1.0)) - max(max(lo.x, lo.y), max(lo.z, 0.0));
    if (inside > 0.0) keep *= 1.0 - smoothstep(0.0, ${gl(POOL_SOFT)}, inside * span) * (1.0 - smoothstep(${gl(POOL_FROM * POOL_FROM)}, ${gl(POOL_TO * POOL_TO)}, dot(a.xyz, a.xyz)));
  }
  return keep;
}
`;

/**
 * Writes the lamp's part of the frame block: its lens camera-relative and its range in fLamp, its light a metre off in
 * fLampColor, `share` of it, and in fLampColor.w the layer of the shadow array its map is drawn into, or -1 for no
 * shadow; and in fLampWay the way its head faces out over the road along the ground, `way` x and z, a unit vector. Or
 * no lamp, with `lens` null.
 */
export function lampFrame(frame: Float32Array, lens: Numbers | null, way: Numbers, share: number, layer: number): void {
  frame.fill(0, LAMP_AT, LAMP_AT + 8);
  frame.fill(0, LAMP_AT + 24, LAMP_AT + 28);
  if (!lens || share <= 0) return;
  const exposure = frame[FRAME.exposure]! || 1;
  for (let k = 0; k < 3; k++) {
    frame[LAMP_AT + k] = lens[k]!;
    frame[LAMP_AT + 4 + k] = (LAMP_COLOUR[k]! * LAMP_POOL * LAMP_GROUND * LAMP_GROUND * share) / exposure;
  }
  frame[LAMP_AT + 3] = LAMP_RANGE;
  frame[LAMP_AT + 7] = layer;
  frame[LAMP_AT + 24] = way[0]!;
  frame[LAMP_AT + 25] = way[1]!;
}

/**
 * How much of the pool's light falls on the ground LAMP_GROUND under the lens at (u, v) metres from under it along x
 * and z, 0 to 1, its head facing (wx, wz): 1 at the pool's middle, nothing past its rim.
 */
export function lampPool(u: number, v: number, wx: number, wz: number): number {
  const out = u * wx + v * wz;
  const q = ((out - LAMP_OUT) / LAMP_WIDE) ** 2 + (u * u + v * v - out * out) / (LAMP_LONG * LAMP_LONG);
  if (q >= 1) return 0;
  const t = Math.sqrt(q), s = 1 - t * t * (3 - 2 * t);
  return s * s;
}

/**
 * How much of the lamp's light reaches a camera-relative point (x, y, z) with face normal `n`, by the pool's light where
 * the way from the lens through it meets the ground, its distance and which way the face is turned, as a share of its
 * light a metre off; and the unit vector from the point toward the lens into `way`. No shadow: the GLSL twin,
 * `lampSees`, takes that from the lamp's map.
 */
export function lampReach(frame: Numbers, x: number, y: number, z: number, nx: number, ny: number, nz: number, way: Float64Array | number[]): number {
  const range = frame[LAMP_AT + 3]!;
  if (range <= 0) return 0;
  const dx = frame[LAMP_AT]! - x, dy = frame[LAMP_AT + 1]! - y, dz = frame[LAMP_AT + 2]! - z;
  const far = dx * dx + dy * dy + dz * dz;
  if (far >= range * range || dy <= 0) return 0;
  const pool = lampPool((-dx * LAMP_GROUND) / dy, (-dz * LAMP_GROUND) / dy, frame[LAMP_AT + 24]!, frame[LAMP_AT + 25]!);
  if (pool <= 0) return 0;
  const d = Math.sqrt(far);
  way[0] = dx / d;
  way[1] = dy / d;
  way[2] = dz / d;
  const w = 1 - (far * far) / (range * range * range * range);
  const facing = Math.min(1, Math.max(0, (nx * way[0]! + ny * way[1]! + nz * way[2]!) * 20));
  // The light the way from the lens carries, over the square of the distance: on the ground the pool's own light.
  const deep = Math.max(dy, LAMP_NEAREST);
  return ((pool * w * w * d) / (deep * deep * deep)) * facing;
}

/**
 * The lamp's light on the point the software render is lighting (lampSees), which `lit` (surface.ts) adds: the way to
 * the lens, then its colour as much of it as reaches the point. The rasterizer sets it for each pixel it lights and
 * clears it after, as the lit programs' sunShadow sets their gLamp.
 */
export const lampLight = new Float64Array(7);

/** A surface's colour as the lamp's light finds it (LAMP_SEES, LAMP_WASH), into `out`. The twin of LIGHT's `sodium`. */
export function lampAlbedo(out: Float64Array | number[], albedo: Numbers): void {
  const seen = albedo[0]! * LAMP_SEES[0] + albedo[1]! * LAMP_SEES[1] + albedo[2]! * LAMP_SEES[2];
  for (let k = 0; k < 3; k++) out[k] = albedo[k]! + (seen - albedo[k]!) * LAMP_WASH;
}

/** Sets `lampLight` for a camera-relative point with face normal `n`, from the frame block. */
export function lampSees(frame: Numbers, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const share = lampReach(frame, x, y, z, nx, ny, nz, lampLight);
  for (let k = 0; k < 3; k++) lampLight[4 + k] = frame[LAMP_AT + 4 + k]! * share;
}

/**
 * The lamp's view from its lens, camera-relative: whether a lamp lights this frame, its lens, the matrix its map is drawn
 * and looked up with (straight down, square, LAMP_TAN either way, into a corner of its layer LAMP_CORNER of its side),
 * and what a caster is tested by: the pyramid under the lens out to LAMP_RANGE. A texel of the map at the ground under
 * it, in metres, sets the level its casters are drawn at.
 */
export class LampView {
  on = false;
  x = 0;
  y = 0;
  z = 0;
  texel = 0;
  /** Column-major, from camera-relative metres to the map's clip space, depth -1 at the near plane. */
  readonly matrix = new Float32Array(16);

  /** No lamp this frame. */
  off(): void {
    this.on = false;
    this.texel = 0;
  }

  /** The lamp's lens at camera-relative (x, y, z), its map's layer `size` texels a side. */
  set(x: number, y: number, z: number, size: number): void {
    this.on = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.texel = (2 * LAMP_TAN * LAMP_GROUND) / (size * LAMP_CORNER);
    // Clip x is world x, clip y world -z and clip w the depth under the lens, so it turns as a camera does; x and y are
    // then taken into the corner of the layer from -1 to -1 + 2 LAMP_CORNER.
    const f = LAMP_CORNER / LAMP_TAN, n = LAMP_NEAR, r = LAMP_RANGE, c = LAMP_CORNER - 1;
    const a = (r + n) / (r - n), b = (-2 * r * n) / (r - n);
    const m = this.matrix;
    m.fill(0);
    m[0] = f;
    m[4] = -c;
    m[12] = -f * x + c * y;
    m[9] = -f;
    m[5] = -c;
    m[13] = f * z + c * y;
    m[6] = -a;
    m[14] = a * y + b;
    m[7] = -1;
    m[15] = y;
  }

  /** LAMP_BIT where a camera-relative box may stand in the lamp's view, else 0: a test that lets a little more in than it must. */
  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    if (!this.on) return 0;
    const deepest = Math.min(LAMP_RANGE, this.y - minY);
    if (deepest < LAMP_NEAR || this.y - maxY > LAMP_RANGE) return 0;
    const half = LAMP_TAN * deepest;
    return minX > this.x + half || maxX < this.x - half || minZ > this.z + half || maxZ < this.z - half ? 0 : LAMP_BIT;
  }

  /** As `box`, for what lies within `r` of a camera-relative point. */
  sphere(x: number, y: number, z: number, r: number): number {
    return this.box(x - r, y - r, z - r, x + r, y + r, z + r);
  }
}
