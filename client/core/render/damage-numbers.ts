// Damage numbers as ARK shows them, in blue: big chunky outlined digits that pop where a hit lands, rise, drift and fade.
// Each is one detail card (packet.ts DETAIL_DIGITS) whose glyphs the shader draws by their distance (digits.ts), so every
// number on screen is one instanced draw with no picture and no node. A number is held 1.5 m along the eye's ray to where
// it was struck, sized for the screen height it should have there, so the world never hides it; its height never falls
// below a floor, so one struck far off is still read. Hits close together in place and time add up in one number that
// pops again (a shotgun's pellets, a burst), and no more than LIVE are kept: nothing is made per hit or per frame.

import { DETAIL, DETAIL_DIGITS } from "./packet.ts";
import type { Camera } from "./camera.ts";
import { HALF_HEIGHT, glyphsOf, halfWidth, packGlyphs } from "./digits.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Numbers kept at once, a number's life, and how near in time and place a hit must be to add to one. */
export const LIVE = 48;
export const LIFE_MS = 1300;
export const MERGE_MS = 350;
export const MERGE_METRES = 1;
/** Metres from the eye a number is drawn at, or nearer for a hit nearer than that. */
export const PULL = 1.5;
/** A number's height as a share of the screen's: at most, at least, and the distance over which it falls from one toward the other. */
export const TALLEST = 0.075;
export const SHORTEST = 0.036;
const FALLS = 25;
/** The pop's length, the rise over a life and the most sideways drift, as shares of the screen's height. */
const POP_MS = 110;
const RISE = 0.06;
const DRIFT = 0.025;
/** The share of its life over which a number fades, at its end. */
const FADE = 0.35;

export const DAMAGE_BODY = 0;
export const DAMAGE_HEAD = 1;
export const DAMAGE_KILL = 2;
/** Soaked by a shield or armour. */
export const DAMAGE_BLOCKED = 3;

/** ARK's roles, in blue: each kind's fill (sRGB), its size and how far it pops. Data, so other roles slot in. */
export const DAMAGE_STYLES: readonly { fill: number; size: number; pop: number }[] = [
  { fill: 0x36a3ff, size: 1, pop: 1.35 },
  { fill: 0x7fe0ff, size: 1.15, pop: 1.45 },
  { fill: 0xffffff, size: 1.4, pop: 1.6 },
  { fill: 0x8fa6c2, size: 0.85, pop: 1.2 },
];
/** Which kind a merged number takes: a kill over a head hit over a body hit over a blocked one. */
const RANK = [1, 2, 3, 0];

/** A number's height as a share of the screen's for one `distance` metres off of `kind`, before its pop. */
export function screenHeight(distance: number, kind: number): number {
  const h = Math.max(SHORTEST, Math.min(TALLEST, TALLEST / (1 + Math.max(0, distance) / FALLS)));
  return h * (DAMAGE_STYLES[kind]?.size ?? 1);
}

/** How big a number is `ms` into its life, by its kind's pop: from its pop down to 1, easing out. */
export function popOf(ms: number, kind: number): number {
  const t = Math.max(0, Math.min(1, ms / POP_MS));
  const ease = 1 - (1 - t) * (1 - t);
  return (DAMAGE_STYLES[kind]?.pop ?? 1.3) * (1 - ease) + ease;
}

/** RGBA bytes, least significant first, as a card's colour word. */
const word = (rgb: number): number => (((rgb >> 16) & 255) | (((rgb >> 8) & 255) << 8) | ((rgb & 255) << 16) | (255 << 24)) >>> 0;

export class DamageNumbers extends VehicleCards {
  readonly x = new Float64Array(LIVE);
  readonly y = new Float64Array(LIVE);
  readonly z = new Float64Array(LIVE);
  readonly damage = new Float64Array(LIVE);
  readonly kind = new Uint8Array(LIVE);
  /** When its life (and pop) began, when it was last struck, and its sideways drift, -1 to 1. */
  readonly born = new Float64Array(LIVE).fill(-Infinity);
  readonly struck = new Float64Array(LIVE).fill(-Infinity);
  readonly drift = new Float32Array(LIVE);
  /** Its glyphs packed as its card carries them, and how many: made when it is struck, not each frame. */
  readonly packed = new Uint32Array(LIVE);
  readonly glyphs = new Uint8Array(LIVE);
  /** Whether numbers show at all: the server's rule and the reader's setting. */
  enabled = true;
  private turn = 0;
  private readonly screen = [0, 0, 0];

  constructor() {
    super(LIVE);
  }

  /** A hit of `damage` of `kind` at (x, y, z) at `now`: added to a number struck near it just before, or a number of its own. */
  hit(x: number, y: number, z: number, damage: number, kind: number, now: number): void {
    let slot = -1, oldest = 0;
    for (let i = 0; i < LIVE; i++) {
      if (now - this.struck[i]! < MERGE_MS && now - this.born[i]! < LIFE_MS && Math.hypot(x - this.x[i]!, y - this.y[i]!, z - this.z[i]!) < MERGE_METRES) {
        this.damage[i]! += damage;
        this.pack(i);
        if (RANK[kind]! > RANK[this.kind[i]!]!) this.kind[i] = kind;
        this.struck[i] = now;
        this.born[i] = now;
        return;
      }
      if (slot < 0 && now - this.born[i]! >= LIFE_MS) slot = i;
      if (this.born[i]! < this.born[oldest]!) oldest = i;
    }
    const i = slot >= 0 ? slot : oldest;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.damage[i] = damage;
    this.pack(i);
    this.kind[i] = kind;
    this.born[i] = now;
    this.struck[i] = now;
    // A spread of drifts that does not repeat for a while, so numbers struck together part.
    this.turn = (this.turn + 0.618034) % 1;
    this.drift[i] = this.turn * 2 - 1;
  }

  private pack(i: number): void {
    const g = glyphsOf(this.damage[i]!);
    this.packed[i] = packGlyphs(g);
    this.glyphs[i] = this.packed[i]! & 7;
  }

  /** How many numbers are alive at `now`. */
  alive(now: number): number {
    let n = 0;
    for (let i = 0; i < LIVE; i++) if (now - this.born[i]! < LIFE_MS) n++;
    return n;
  }

  /** The cards for `cam` at `now` (cam.update() done): one for each number alive and on screen. */
  build(cam: Camera, now: number): void {
    this.begin();
    if (!this.enabled) return;
    const m = cam.viewProj, tan = Math.tan(cam.fovY / 2);
    // The camera's right, up and forward, from its view (roll and all).
    const fl = 1 / tan, sx = fl / cam.aspect;
    const rx = m[0]! / sx, ry = m[4]! / sx, rz = m[8]! / sx;
    const ux = m[1]! / fl, uy = m[5]! / fl, uz = m[9]! / fl;
    const fx = m[3]!, fy = m[7]!, fz = m[11]!;
    for (let i = 0; i < LIVE; i++) {
      const age = now - this.born[i]!;
      if (!(age >= 0 && age < LIFE_MS)) continue;
      if (!cam.project(this.x[i]!, this.y[i]!, this.z[i]!, this.screen)) continue;
      const s = this.screen;
      if (s[0]! < -0.05 || s[0]! > 1.05 || s[1]! < -0.05 || s[1]! > 1.05) continue;
      const dx = this.x[i]! - cam.x, dy = this.y[i]! - cam.y, dz = this.z[i]! - cam.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-3) continue;
      const pull = Math.min(PULL, d * 0.85);
      let cx = (dx / d) * pull, cy = (dy / d) * pull, cz = (dz / d) * pull;
      // A screen's height in metres where the card stands: its depth along the view, not along its ray.
      const depth = cx * fx + cy * fy + cz * fz;
      const metres = 2 * depth * tan;
      const t = age / LIFE_MS, kind = this.kind[i]!;
      const rise = RISE * t * metres, side = DRIFT * this.drift[i]! * t * metres;
      cx += ux * rise + rx * side;
      cy += uy * rise + ry * side;
      cz += uz * rise + rz * side;
      // The glyphs' strokes stand two glyph units tall: a unit is half the number's height.
      const unit = (screenHeight(d, kind) * popOf(age, kind) * metres) / 2;
      const across = halfWidth(this.glyphs[i]!) * unit, along = HALF_HEIGHT * unit;
      const o = this.next(), card = this.cards, words = this.words;
      card[o] = cx; card[o + 1] = cy; card[o + 2] = cz;
      card[o + DETAIL.across] = rx * across; card[o + DETAIL.across + 1] = ry * across; card[o + DETAIL.across + 2] = rz * across;
      card[o + DETAIL.along] = ux * along; card[o + DETAIL.along + 1] = uy * along; card[o + DETAIL.along + 2] = uz * along;
      card[o + DETAIL.floor] = 0;
      words[o + DETAIL.colourA] = word(DAMAGE_STYLES[kind]?.fill ?? 0xffffff);
      words[o + DETAIL.colourB] = this.packed[i]!;
      const shows = Math.round(255 * Math.min(1, (1 - t) / FADE));
      words[o + DETAIL.misc] = ((255 << 24) | (shows << 16) | (DETAIL_DIGITS << 8)) >>> 0;
    }
  }
}
