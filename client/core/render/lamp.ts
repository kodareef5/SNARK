// The street lamp that lights as a light by night (planning/workstreams/night-light.md). Every working lamp near enough
// draws its cards (street-lamps.ts); on a tier whose shadows say so, the nearest within LAMP_REACH of the camera is a
// light in the lit programs as well: a cone straight down from its lens, falling off with the square of the distance and
// cut off at LAMP_RANGE, and a shadow drawn from the lens into a layer of the shadow array of its own, after the far
// map's (shadowtext.ts `shadowLayer`). Its pool card fades out as its light fades in, and the light goes from one lamp to
// the next through their cards. The software render has no shadow maps, so there the lamp lights unshadowed (`lampSees`).

import { FRAME, LAMP_AT, MAX_CASCADES } from "./packet.ts";

/** The lamp's bit among a caster's cascades and the frame's maps drawn: the one after the cascades'. */
export const LAMP_BIT = 1 << MAX_CASCADES;
/** Metres along the ground from the camera within which the nearest working lamp lights as a light. */
export const LAMP_REACH = 40;
/** Metres from the lens the lamp's light reaches, falling smoothly to nothing there, and the far plane of its map. */
export const LAMP_RANGE = 24;
/**
 * The cosines of the angles from straight down at which the lamp's cone begins to fall off and is gone: with the fall
 * with distance, a pool on the road as wide as its card's (street-lamps.ts POOL), which shows most of itself within half
 * its radius.
 */
export const LAMP_INNER = Math.cos((15 * Math.PI) / 180);
export const LAMP_OUTER = Math.cos((45 * Math.PI) / 180);
/** The farthest across from under its lens the lamp lights anything: its range at the cone's edge. */
export const LAMP_ACROSS = LAMP_RANGE * Math.sqrt(1 - LAMP_OUTER * LAMP_OUTER);
/** Half the side of the map's view from the lens, as a tangent: 47 degrees from straight down, a little past the cone. */
export const LAMP_TAN = Math.tan((47 * Math.PI) / 180);
/** Metres from the lens to the map's near plane: under the head, which stands over the lens and so is not drawn. */
export const LAMP_NEAR = 0.25;
/** About how far a lamp's lens stands over the road under it (street-lamps.ts LENS), where its map's texel sets its casters' levels. */
const LAMP_GROUND = 9;
/** The nearest a lit point is taken to stand to the lens, so that its light does not run away there. */
export const LAMP_NEAREST = 0.5;
/**
 * The lamp's light: a high-pressure sodium lamp's warm colour, as its cards have it (street-lamps.ts POOL_COLOUR), and
 * how strong it is a metre off, as light after exposure, so that it shows as brightly whatever the night's exposure, as the
 * cards do.
 */
export const LAMP_COLOUR = [1, 0.3, 0.08] as const;
export const LAMP_STRENGTH = 700;
/** Seconds the lamp's light takes to fade into its card, or out of it. */
export const LAMP_FADE = 0.15;

type Numbers = ArrayLike<number>;

/**
 * Writes the lamp's part of the frame block: its lens camera-relative and its range in fLamp, its light a metre off in
 * fLampColor, `share` of it, and in fLampColor.w the layer of the shadow array its map is drawn into, or -1 for no
 * shadow; or no lamp, with `lens` null.
 */
export function lampFrame(frame: Float32Array, lens: Numbers | null, share: number, layer: number): void {
  frame.fill(0, LAMP_AT, LAMP_AT + 8);
  if (!lens || share <= 0) return;
  const exposure = frame[FRAME.exposure]! || 1;
  for (let k = 0; k < 3; k++) {
    frame[LAMP_AT + k] = lens[k]!;
    frame[LAMP_AT + 4 + k] = (LAMP_COLOUR[k]! * LAMP_STRENGTH * share) / exposure;
  }
  frame[LAMP_AT + 3] = LAMP_RANGE;
  frame[LAMP_AT + 7] = layer;
}

/**
 * How much of the lamp's light reaches a camera-relative point (x, y, z) with face normal `n`, by its distance, its cone
 * and which way the face is turned, 0 to 1 of its light a metre off; and the unit vector from the point toward the lens
 * into `way`. No shadow: the GLSL twin, `lampSees`, takes that from the lamp's map.
 */
export function lampReach(frame: Numbers, x: number, y: number, z: number, nx: number, ny: number, nz: number, way: Float64Array | number[]): number {
  const range = frame[LAMP_AT + 3]!;
  if (range <= 0) return 0;
  const dx = frame[LAMP_AT]! - x, dy = frame[LAMP_AT + 1]! - y, dz = frame[LAMP_AT + 2]! - z;
  const far = dx * dx + dy * dy + dz * dz;
  if (far >= range * range) return 0;
  const d = Math.sqrt(far);
  way[0] = dx / d;
  way[1] = dy / d;
  way[2] = dz / d;
  const c = Math.min(1, Math.max(0, (way[1]! - LAMP_OUTER) / (LAMP_INNER - LAMP_OUTER)));
  const w = 1 - (far * far) / (range * range * range * range);
  const facing = Math.min(1, Math.max(0, (nx * way[0]! + ny * way[1]! + nz * way[2]!) * 20));
  return ((c * c * (3 - 2 * c) * w * w) / Math.max(far, LAMP_NEAREST * LAMP_NEAREST)) * facing;
}

/**
 * The lamp's light on the point the software render is lighting (lampSees), which `lit` (surface.ts) adds: the way to
 * the lens, then its colour as much of it as reaches the point. The rasterizer sets it for each pixel it lights and
 * clears it after, as the lit programs' sunShadow sets their gLamp.
 */
export const lampLight = new Float64Array(7);

/** Sets `lampLight` for a camera-relative point with face normal `n`, from the frame block. */
export function lampSees(frame: Numbers, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const share = lampReach(frame, x, y, z, nx, ny, nz, lampLight);
  for (let k = 0; k < 3; k++) lampLight[4 + k] = frame[LAMP_AT + 4 + k]! * share;
}

/**
 * The lamp's view from its lens, camera-relative: whether a lamp lights this frame, its lens, the matrix its map is drawn
 * and looked up with (straight down, square, LAMP_TAN either way), and what a caster is tested by: the pyramid under the
 * lens out to LAMP_RANGE. A texel of the map at the ground under it, in metres, sets the level its casters are drawn at.
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

  /** The lamp's lens at camera-relative (x, y, z), its map `size` texels a side. */
  set(x: number, y: number, z: number, size: number): void {
    this.on = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.texel = (2 * LAMP_TAN * LAMP_GROUND) / size;
    // Clip x is world x, clip y world -z and clip w the depth under the lens, so it turns as a camera does.
    const f = 1 / LAMP_TAN, n = LAMP_NEAR, r = LAMP_RANGE;
    const a = (r + n) / (r - n), b = (-2 * r * n) / (r - n);
    const m = this.matrix;
    m.fill(0);
    m[0] = f;
    m[12] = -f * x;
    m[9] = -f;
    m[13] = f * z;
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
