// Light from fire on what is near it (planning/workstreams/fire.md): the fires that stand (fires.ts) and a blast's
// flash and fireball (blasts.ts), the strongest few by the light each throws round the eye, as points of light with no
// shadow. Every lit program adds them (`fireSees`, which `sunShadow` calls as it does the orb's), and so does the smoke,
// which they light from below, and the sea's glint, where the strongest breaks into a streak on the waves. A fire's
// light flickers slowly; one coming into or going out of the few fades as it nears the last of them, so none pops.
//
// As the street lamp's (lamp.ts lampFrame), a light is given as the eye sees it, after exposure, and written before it:
// the eye's gain runs from 1 at noon to some 50,000 by night, and a fire's light is to look the same all night. By day
// it is all but gone in the sun's; a blast's flash keeps a share of itself.

import { FIRES_AT, FIRE_LIGHTS, FRAME } from "./packet.ts";

/** A fire's light as the eye sees it a metre from it, for each square metre of its flames, and its colour. */
export const FIRE_LIGHT = 8;
export const FIRE_COLOUR = [1, 0.42, 0.12] as const;
/** The share of a fire's light shown by day, and of a blast's. */
export const FIRE_BY_DAY = 0.04;
export const BLAST_BY_DAY = 0.35;
/** Metres a light's reach is, for the square root of its light a metre off. */
export const FIRE_REACH_PER = 3.5;
/**
 * The nearest a lit point is counted to a light, as a share of its reach: a fire is as large as its light is strong, and
 * a surface in it or by it is not lit without bound.
 */
export const FIRE_NEAREST = 0.2;
/**
 * The brightest a fire's glint off the sea is shown by night, after exposure: a fire is no sun, and what the water
 * mirrors of it is a share of the flame itself, an orange streak and never a white one.
 */
export const FIRE_GLINT = 0.7;
/** The share of a fire's light smoke over it gives back, whatever its own colour: a fire lights its smoke from within. */
export const SMOKE_FIRE = 0.12;
/** The share of a light that wraps round past the side of a surface turned from it: a fire is no point. */
const WRAP = 0.2;
/** Candidates a frame holds at the most. */
const MOST = 64;
/** Floats a candidate is held in: its place from the eye, its light a metre off, its colour, how far it flickers, and the share of it by day. */
const HELD = 9;

type Numbers = ArrayLike<number>;

export class FireLights {
  private readonly held = new Float32Array(MOST * HELD);
  private readonly score = new Float32Array(MOST);
  private readonly order: number[] = [];
  private readonly byScore = (a: number, b: number): number => this.score[b]! - this.score[a]!;
  /** Candidates this frame, and lights written to the frame. */
  count = 0;
  written = 0;

  begin(): void {
    this.count = 0;
  }

  /**
   * A light at (x, y, z) from the eye, `light` as the eye sees it a metre off by night, of colour (r, g, b), `day` of
   * it shown by day; flickering by `flicker` of itself, with `seed`.
   */
  add(x: number, y: number, z: number, light: number, r: number, g: number, b: number, day: number, flicker = 0, seed = 0): void {
    if (light <= 0 || this.count >= MOST) return;
    const o = this.count * HELD, h = this.held;
    h[o] = x;
    h[o + 1] = y;
    h[o + 2] = z;
    h[o + 3] = light;
    h[o + 4] = r;
    h[o + 5] = g;
    h[o + 6] = b;
    h[o + 7] = flicker;
    h[o + 8] = day;
    // What it throws round the eye, which decides the few.
    this.score[this.count] = light / Math.max(x * x + y * y + z * z, 4);
    this.seeds[this.count] = seed;
    this.count++;
  }
  private readonly seeds = new Float32Array(MOST);

  /**
   * Writes the strongest `most` into `frame`'s fires section at the scene's clock `now` ms, and none past them, each
   * shown as `dark` as it is (0 by day, 1 by night: surface.ts lampsOn) and before the frame's exposure.
   */
  write(frame: Float32Array, most: number, now: number, dark = 1): void {
    frame.fill(0, FIRES_AT, FIRES_AT + FIRE_LIGHTS * 8);
    this.written = 0;
    const n = this.count, take = Math.min(most, FIRE_LIGHTS, n);
    if (take === 0) return;
    const order = this.order;
    order.length = 0;
    for (let k = 0; k < n; k++) order.push(k);
    order.sort(this.byScore);
    // The first left out: those near it fade, so a light changing places with it comes and goes by degrees.
    const cut = n > take ? this.score[order[take]!]! : 0;
    const t = now / 1000, exposure = frame[FRAME.exposure]! || 1;
    for (let i = 0; i < take; i++) {
      const k = order[i]!, o = k * HELD, h = this.held, s = 6.2831853 * this.seeds[k]!;
      const weight = cut > 0 ? smooth(cut, 1.6 * cut, this.score[k]!) : 1;
      if (weight <= 0) continue;
      // Slow waves on its strength, never a frame's noise, which would strobe.
      const flicker = 1 + h[o + 7]! * (0.55 * Math.sin(1.7 * t + s) + 0.3 * Math.sin(4.3 * t + 2 * s) + 0.15 * Math.sin(9.1 * t + 3 * s));
      const shown = weight * (h[o + 8]! + (1 - h[o + 8]!) * dark);
      const light = (h[o + 3]! * flicker * shown) / exposure, f = FIRES_AT + this.written * 8;
      if (light <= 0) continue;
      // The most its glint off the sea shows, after exposure, by as much of it as shows.
      frame[f + 7] = FIRE_GLINT * shown;
      frame[f] = h[o]!;
      frame[f + 1] = h[o + 1]!;
      frame[f + 2] = h[o + 2]!;
      frame[f + 3] = FIRE_REACH_PER * Math.sqrt(h[o + 3]!);
      frame[f + 4] = h[o + 4]! * light;
      frame[f + 5] = h[o + 5]! * light;
      frame[f + 6] = h[o + 6]! * light;
      this.written++;
    }
  }
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of light `k`'s colour a camera-relative point with face normal `n` takes, 0 where it is out of reach: by the
 * square of the distance, held at FIRE_NEAREST, windowed to nothing at its reach, and by how the face is turned to it.
 */
export function fireReach(frame: Numbers, k: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const f = FIRES_AT + k * 8, reach = frame[f + 3]!;
  if (reach <= 0) return 0;
  const dx = frame[f]! - x, dy = frame[f + 1]! - y, dz = frame[f + 2]! - z;
  // The way to it is its true one, however near: only how strong it is is held.
  const d2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-4), r2 = Math.max(d2, (FIRE_NEAREST * reach) ** 2), s = r2 / (reach * reach), w = Math.max(1 - s * s, 0);
  return ((w * w) / r2) * Math.max(WRAP + (1 - WRAP) * ((nx * dx + ny * dy + nz * dz) / Math.sqrt(d2)), 0);
}

/** The fires' light on the point the software render is lighting, which `lit` (surface.ts) adds to what is not metal. */
export const fireCast = new Float64Array(3);

/** Sets `fireCast` for a camera-relative point with face normal `n`, from the frame block; nothing where the tier has no such light. */
export function fireSees(frame: Numbers, on: boolean, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  fireCast.fill(0);
  if (!on) return;
  for (let k = 0; k < FIRE_LIGHTS; k++) {
    if (!(frame[FIRES_AT + k * 8 + 3]! > 0)) break;
    const share = fireReach(frame, k, x, y, z, nx, ny, nz);
    for (let c = 0; c < 3; c++) fireCast[c] += frame[FIRES_AT + k * 8 + 4 + c]! * share;
  }
}

/** `fireSees` in GLSL, after LIGHT, which declares gFire: one branch where no fire is near. */
export const FIRE_SEES_GLSL = `#ifdef FIRE_LIGHT
void fireSees(vec3 rel, vec3 normal) {
  gFire = vec3(0.0);
  for (int k = 0; k < ${FIRE_LIGHTS}; k++) {
    vec4 at = fFires[2 * k];
    if (at.w <= 0.0) break;
    vec3 d = at.xyz - rel;
    float d2 = max(dot(d, d), 1.0e-4), r2 = max(d2, ${(FIRE_NEAREST * FIRE_NEAREST).toFixed(4)} * at.w * at.w), s = r2 / (at.w * at.w), w = max(1.0 - s * s, 0.0);
    gFire += fFires[2 * k + 1].rgb * (w * w / r2) * max(${WRAP.toFixed(2)} + ${(1 - WRAP).toFixed(2)} * dot(normal, d) * inversesqrt(d2), 0.0);
  }
}
#endif
`;
