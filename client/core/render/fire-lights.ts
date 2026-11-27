// Light from fire on what is near it (planning/workstreams/fire.md): the fires that stand (fires.ts) and a blast's
// flash and fireball (blasts.ts), the strongest few by the light each throws round the eye, as points of light with no
// shadow. Every lit program adds them (`fireSees`, which `sunShadow` calls as it does the orb's), and so does the smoke,
// which they light from below, and the sea's glint, where the strongest breaks into a streak on the waves. A fire's
// light flickers slowly; one coming into or going out of the few does so over a moment, so none pops.
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
/** Candidates a frame holds at the most: past them the weakest gives up its place to a stronger. */
const MOST = 64;
/** Floats a candidate is held in: its place from the eye, its light a metre off, its colour, how far it flickers, and the share of it by day. */
const HELD = 9;
/** Seconds a light takes to come into the few, and to go out of them. */
export const FIRE_RISES = 0.3;
export const FIRE_FALLS = 0.25;
/** How many times as strong as one of the few a light outside them must be to take its place: near equals do not trade places. */
export const FIRE_HOLDS = 1.3;
/** Metres within which a light this frame is the light a place held last frame, and the most seconds between two frames that fade. */
const SAME = 0.5;
const STEP_MOST = 0.5;
/** Floats a place of the few holds: its light's place in the world, then as a candidate's from its light on, its seed, its score, and how much of it shows. */
const PLACE = 13;

type Numbers = ArrayLike<number>;

export class FireLights {
  private readonly held = new Float32Array(MOST * HELD);
  private readonly score = new Float32Array(MOST);
  private readonly seeds = new Float32Array(MOST);
  private readonly sudden = new Uint8Array(MOST);
  /** The place of the few that holds each candidate, or -1, and each candidate's score as it is ranked. */
  private readonly placeOf = new Int8Array(MOST);
  private readonly ranked = new Float32Array(MOST);
  private readonly order: number[] = [];
  private readonly byRank = (a: number, b: number): number => this.ranked[b]! - this.ranked[a]! || a - b;
  // The few, from frame to frame: each place's light, whether it is held, and the candidate it is this frame.
  private readonly places = new Float64Array(FIRE_LIGHTS * PLACE);
  private readonly live = new Uint8Array(FIRE_LIGHTS);
  private readonly now = new Int8Array(FIRE_LIGHTS);
  private readonly lanes: number[] = [];
  private readonly byShown = (a: number, b: number): number => this.places[b * PLACE + 11]! * this.places[b * PLACE + 12]! - this.places[a * PLACE + 11]! * this.places[a * PLACE + 12]! || a - b;
  private eye = [0, 0, 0];
  private last = NaN;
  /** Candidates this frame, and lights written to the frame. */
  count = 0;
  written = 0;

  /** A new frame's lights, as seen from the eye at (ex, ey, ez) in the world: by it a light is known from one frame to the next. */
  begin(ex = 0, ey = 0, ez = 0): void {
    this.count = 0;
    this.eye[0] = ex;
    this.eye[1] = ey;
    this.eye[2] = ez;
  }

  /**
   * A light at (x, y, z) from the eye, `light` as the eye sees it a metre off by night, of colour (r, g, b), `day` of
   * it shown by day; flickering by `flicker` of itself, with `seed`. A `sudden` one, a blast's, is whole at once and
   * takes a place at once; another comes in by degrees.
   */
  add(x: number, y: number, z: number, light: number, r: number, g: number, b: number, day: number, flicker = 0, seed = 0, sudden = false): void {
    if (light <= 0) return;
    // What it throws round the eye, which decides the few.
    const score = light / Math.max(x * x + y * y + z * z, 4);
    let k = this.count;
    if (k >= MOST) {
      // The frame is full: it takes the weakest's place if it is stronger, whenever it was handed in.
      k = 0;
      for (let j = 1; j < MOST; j++) if (this.score[j]! < this.score[k]!) k = j;
      if (this.score[k]! >= score) return;
    } else this.count++;
    const o = k * HELD, h = this.held;
    h[o] = x;
    h[o + 1] = y;
    h[o + 2] = z;
    h[o + 3] = light;
    h[o + 4] = r;
    h[o + 5] = g;
    h[o + 6] = b;
    h[o + 7] = flicker;
    h[o + 8] = day;
    this.score[k] = score;
    this.seeds[k] = seed;
    this.sudden[k] = sudden ? 1 : 0;
  }

  /**
   * Writes the strongest `most` into `frame`'s fires section at the scene's clock `now` ms, and none past them, each
   * shown as `dark` as it is (0 by day, 1 by night: surface.ts lampsOn) and before the frame's exposure. The few are
   * kept from frame to frame: one of them holds its place against a light a little stronger, one that loses its
   * place goes out over FIRE_FALLS seconds, and the one that takes it comes in over FIRE_RISES, so the rest shine on
   * whole and none pops. With no time passed since the last frame, or too much, they are as they come to rest.
   */
  write(frame: Float32Array, most: number, now: number, dark = 1): void {
    frame.fill(0, FIRES_AT, FIRES_AT + FIRE_LIGHTS * 8);
    this.written = 0;
    const n = this.count, take = Math.min(most, FIRE_LIGHTS), places = this.places, live = this.live, h = this.held;
    const step = (now - this.last) / 1000, settled = !(step > 0 && step <= STEP_MOST), [ex, ey, ez] = this.eye as [number, number, number];
    this.last = now;
    for (let s = take; s < FIRE_LIGHTS; s++) live[s] = 0;
    if (take === 0) return;
    // Which candidate each place's light is this frame: the nearest to where it was, within a step.
    const placeOf = this.placeOf.fill(-1, 0, n);
    for (let s = 0; s < take; s++) {
      this.now[s] = -1;
      if (live[s] === 0) continue;
      let best = SAME * SAME;
      for (let k = 0; k < n; k++) {
        if (placeOf[k]! >= 0) continue;
        const d = (h[k * HELD]! + ex - places[s * PLACE]!) ** 2 + (h[k * HELD + 1]! + ey - places[s * PLACE + 1]!) ** 2 + (h[k * HELD + 2]! + ez - places[s * PLACE + 2]!) ** 2;
        if (d < best) {
          best = d;
          this.now[s] = k;
        }
      }
      if (this.now[s]! >= 0) placeOf[this.now[s]!] = s;
    }
    // The strongest few, a light that has a place counted stronger than it is.
    const order = this.order;
    order.length = 0;
    for (let k = 0; k < n; k++) {
      this.ranked[k] = this.score[k]! * (placeOf[k]! >= 0 && !settled ? FIRE_HOLDS : 1);
      order.push(k);
    }
    order.sort(this.byRank);
    const wins = Math.min(take, n);
    for (let i = wins; i < n; i++) this.ranked[order[i]!] = -1;
    // Each place: its light still of the few comes up, and one that is not goes down and then leaves it.
    for (let s = 0; s < take; s++) {
      if (live[s] === 0) continue;
      const k = this.now[s]!, o = s * PLACE, won = k >= 0 && this.ranked[k]! >= 0;
      if (k >= 0) this.keep(s, k);
      places[o + 12] = settled ? (won ? 1 : 0) : won ? Math.min(1, places[o + 12]! + step / FIRE_RISES) : places[o + 12]! - step / FIRE_FALLS;
      if (places[o + 12]! <= 0) live[s] = 0;
    }
    // Each of the few with no place takes a free one. A sudden one takes the place of the least of those going out;
    // another waits for a place to come free.
    for (let i = 0; i < wins; i++) {
      const k = order[i]!;
      if (placeOf[k]! >= 0) continue;
      let to = -1;
      for (let s = 0; s < take && to < 0; s++) if (live[s] === 0) to = s;
      if (to < 0 && this.sudden[k] === 1) {
        for (let s = 0; s < take; s++) {
          const going = this.now[s]! < 0 || this.ranked[this.now[s]!]! < 0;
          if (going && (to < 0 || places[s * PLACE + 11]! * places[s * PLACE + 12]! < places[to * PLACE + 11]! * places[to * PLACE + 12]!)) to = s;
        }
      }
      if (to < 0) continue;
      live[to] = 1;
      this.now[to] = k;
      placeOf[k] = to;
      this.keep(to, k);
      places[to * PLACE + 12] = settled || this.sudden[k] === 1 ? 1 : Math.min(1, step / FIRE_RISES);
    }
    // Written the strongest first: the sea glints with the first alone.
    const lanes = this.lanes;
    lanes.length = 0;
    for (let s = 0; s < take; s++) if (live[s] === 1) lanes.push(s);
    lanes.sort(this.byShown);
    const t = now / 1000, exposure = frame[FRAME.exposure]! || 1;
    for (const place of lanes) {
      const o = place * PLACE, s = 6.2831853 * places[o + 10]!;
      // Slow waves on its strength, never a frame's noise, which would strobe.
      const flicker = 1 + places[o + 7]! * (0.55 * Math.sin(1.7 * t + s) + 0.3 * Math.sin(4.3 * t + 2 * s) + 0.15 * Math.sin(9.1 * t + 3 * s));
      const shown = places[o + 12]! * (places[o + 8]! + (1 - places[o + 8]!) * dark);
      const light = (places[o + 3]! * flicker * shown) / exposure, f = FIRES_AT + this.written * 8;
      if (light <= 0) continue;
      // The most its glint off the sea shows, after exposure, by as much of it as shows.
      frame[f + 7] = FIRE_GLINT * shown;
      frame[f] = places[o]! - ex;
      frame[f + 1] = places[o + 1]! - ey;
      frame[f + 2] = places[o + 2]! - ez;
      frame[f + 3] = FIRE_REACH_PER * Math.sqrt(places[o + 3]!);
      frame[f + 4] = places[o + 4]! * light;
      frame[f + 5] = places[o + 5]! * light;
      frame[f + 6] = places[o + 6]! * light;
      this.written++;
    }
  }

  /** Place `s` of the few takes candidate `k`'s light as it is this frame, where it is in the world. */
  private keep(s: number, k: number): void {
    const o = s * PLACE, c = k * HELD, places = this.places, h = this.held;
    for (let i = 0; i < 3; i++) places[o + i] = h[c + i]! + this.eye[i]!;
    for (let i = 3; i < HELD; i++) places[o + i] = h[c + i]!;
    places[o + 10] = this.seeds[k]!;
    places[o + 11] = this.score[k]!;
  }
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
