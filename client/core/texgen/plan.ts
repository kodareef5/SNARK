// What the card draws of the walls' weathering masks each frame (weather.ts), for the shell to carry out
// (client/shell/texgen.ts): every layer first at an eighth of the side, which the card reads from as soon as it is
// whole, so the weathering shows within a few frames; then at the whole side, read from once that is whole. A frame
// draws bands of rows within its share of the card's time, which the shell measures where the card can be timed.

import { WEATHER_RECIPE } from "../../../content/texgen/weather.ts";
import { MADE_FIRST, MADE_LAYERS, WEATHER_BAYS, WEATHER_LAYERS, bayFeatures, baySeed, fieldLut, fieldSeed } from "./weather.ts";

/** Levels under the widest that the first pass is drawn at: an eighth of the side, a 64th of the work. */
export const WEATHER_COARSE = 3;
/** Frames over which the walls' weathering comes up once its first pass is whole, as the finishes come up (world-surfaces.ts WORLD_RISE). */
export const WEATHER_RISE = 20;
/** Pixels a frame draws before the card's time has been measured, and the least and most it ever draws. */
const FIRST_PIXELS = 1 << 16, LEAST_PIXELS = 1 << 13, MOST_PIXELS = 1 << 21;
/** Draws a frame holds at most: a band of a layer's rows each, or of a bay's half. */
const MOST_DRAWS = MADE_LAYERS * 2 + 2;

export class WeatherPlan {
  /** The side asked for, the level being drawn, and its next layer and row. */
  side = 0;
  level = 0;
  private layer = 0;
  private row = 0;
  /** Whether a whole pass is on the card to be read, and whether the widest is; frames since the first, up to WEATHER_RISE. */
  private shown = false;
  private done = false;
  private risen = 0;
  /** Pixels a frame may draw, and those this frame draws; the card's milliseconds spent in all, for the bench. */
  private pixels = FIRST_PIXELS;
  drawn = 0;
  spentMs = 0;
  /**
   * This frame's draws, `count` of them, four numbers each: the layer, the first row and the rows, and what it is: the
   * half of a bay's layer whose table it is drawn with (0 top, 1 bottom), -1 a field, or for a made material's layer 2
   * its base colour and 3 its relief; all at level `at`, `wide` a side.
   */
  readonly draws = new Int32Array(MOST_DRAWS * 4);
  count = 0;
  at = 0;
  wide = 0;
  /** After this frame's draws, the level the card is to read from and make the smaller ones of, or -1. */
  whole = -1;
  /** Each bay layer's two variants' tables (bayFeatures), the top's then the bottom's; each field's seed and table. */
  readonly tables = Array.from({ length: WEATHER_BAYS * 2 }, (_, k) => bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, k >> 1, k & 1)));
  readonly seeds = Array.from({ length: WEATHER_LAYERS - WEATHER_BAYS }, (_, f) => fieldSeed(WEATHER_RECIPE, f));
  readonly luts = this.seeds.map((seed) => fieldLut(seed));

  /** From 0 while the first pass is made to 1 once it has risen. */
  get ready(): number {
    return this.risen / WEATHER_RISE;
  }

  /** Begins again at `side` where it is new, which the card's array is made at: true where it is. 0 lets it go. */
  ask(side: number): boolean {
    if (side === this.side) return false;
    this.side = side;
    this.layer = this.row = this.risen = 0;
    this.shown = this.done = false;
    this.level = Math.max(0, Math.min(WEATHER_COARSE, 31 - Math.clz32(side) - 6));
    return true;
  }

  /** Lays out this frame's draws (`draws`, `count`), within its share of pixels; false where nothing is left to draw. */
  frame(): boolean {
    this.count = 0;
    this.whole = -1;
    if (this.shown) this.risen = Math.min(WEATHER_RISE, this.risen + 1);
    if (this.side === 0 || this.done) return false;
    this.at = this.level;
    const wide = (this.wide = this.side >> this.level), half = wide >> 1;
    let left = Math.max(1, Math.floor(this.pixels / wide));
    this.drawn = 0;
    while (left > 0 && this.layer < MADE_LAYERS && this.count < MOST_DRAWS) {
      // A bay's two halves are two variants, each drawn with its own table, so no draw crosses the middle.
      const field = this.layer >= WEATHER_BAYS, to = field || this.row >= half ? wide : half, n = Math.min(left, to - this.row), d = this.count++ * 4;
      const made = this.layer >= MADE_FIRST ? 2 + ((this.layer - MADE_FIRST) & 1) : 0;
      this.draws[d] = this.layer;
      this.draws[d + 1] = this.row;
      this.draws[d + 2] = n;
      this.draws[d + 3] = made || (field ? -1 : this.row >= half ? 1 : 0);
      this.drawn += n * wide;
      left -= n;
      this.row += n;
      if (this.row >= wide) {
        this.row = 0;
        this.layer++;
      }
    }
    if (this.layer >= MADE_LAYERS) {
      this.whole = this.level;
      this.shown = true;
      if (this.level === 0) this.done = true;
      else this.level = this.layer = 0;
    }
    return true;
  }

  /** The card's time for a frame's draws of `pixels`, in nanoseconds: sizes a frame's share to `targetMs` of it. */
  measured(ns: number, pixels: number, targetMs: number): void {
    if (ns <= 0 || pixels <= 0) return;
    this.spentMs += ns / 1e6;
    this.pixels = Math.max(LEAST_PIXELS, Math.min(MOST_PIXELS, Math.round((pixels * targetMs * 1e6) / ns)));
  }
}
