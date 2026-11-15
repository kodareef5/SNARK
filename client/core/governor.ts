// The governor keeps the frame steady under the tier the player chose, on a phone that warms or on any machine that
// meets a scene heavier than it can draw, taking from what matters least in a fight first. It is told each frame's interval, our code's
// time, the GPU's time where the browser times it, whether the frame took uploads and how much the frame asked of the
// card; the app draws the tier it returns, and the shell only passes it the numbers.
//
// The rule: frames are taken in windows of two seconds. A window misses when its frames come slower than 60 a second
// and the GPU is what is slow: the GPU's own time where it is known, else our code's time under three quarters of the
// frame and the frames not all at one whole number of display intervals, as a phone saving power gives them. Two missed
// windows in a row take a step down. A step that bought nothing is passed for the next at once; if that buys nothing
// either, both are undone and passed over for a while, and the governor rests. A step back up is tried only after a
// long while with no missed window, or sooner where the frame has asked far less of the card than after the step for
// some seconds together; a try that misses is undone at once, and that level waits twice as long the next time.
// Nothing counts in the first seconds after a join, a lost context, a tier the player chose, or a long gap.

import type { Tier } from "./assets/tiers.ts";

/** The frame the governor holds, in ms: 60 a second. */
export const TARGET_MS = 1000 / 60;
/** A window whose frames are this much slower than the target, on the mean of its middle eight tenths, has missed. */
const MISS = 1.04;
/** Where the GPU's time is known, a window misses only if the GPU took this share of the target or more. */
const GPU_FULL = 0.85;
/** Our code's share of a frame from which the frame is ours and not the GPU's (D246). */
const OURS = 0.75;
/** Frames within this share of one another and of a whole number of 60ths of a second are paced by the display, not slowed. */
const PACED = 0.05;
const WINDOW_MS = 2000;
/** Missed windows in a row before a step down. */
const MISSES = 2;
/** A window with fewer of its frames usable than this says nothing. */
const USABLE = 0.5;
/** A gap this long is a hidden page, a stall or a collection, never the scene's frame: nothing counts for SETTLE_MS after. */
const STALL_MS = 250;
const SETTLE_MS = 3000;
/** After a join, a lost context or a tier the player chose, everything is still arriving. */
export const JOIN_MS = 15000;
/** After a step, the frames that compile programs or size the canvas again are left out. */
const STEP_SETTLE_MS = 1000;
/**
 * A step down must take this share off the load. One that does not is passed for the next; after USELESS steps that
 * bought nothing they are undone and passed over for PASSED_MS, and the governor rests REST_MS, doubled each time.
 */
const GAIN = 0.03;
const USELESS = 2;
const PASSED_MS = 960000;
const REST_MS = 60000;
const REST_MOST = 960000;
/**
 * The wait with no missed window before a level above is tried, doubled each time a try fails. A phone warms for ten
 * minutes and more (the iPhone's soaks, D349), and a try while it warms only finds it warmer.
 */
const WAIT_MS = 600000;
const WAIT_MOST = 2400000;
/** A frame that has asked this share or less of what it asked after a step, for LIGHT_WAIT_MS together, is a lighter scene, and the level above is tried. */
const LIGHTER = 0.7;
const LIGHT_WAIT_MS = 10000;
/** A try that held is undone by a step down within this long, which counts as the try failing. */
const PROBATION_MS = 60000;
/** What a draw asks of a phone's card in triangles, for a frame's work: the iPhone's ladder broke near 1,000 draws more or 2 M triangles more (D349). */
export const DRAW_TRIANGLES = 2000;
/** A leaves step is passed by where the triangles crowns near could still give were under this share of a frame's work. */
const CROWNS = 0.1;

/** What a step changes. Steps add up: a level is every step before it. */
interface Knobs {
  leaves?: number;
  everyOther?: boolean;
  ratio?: number;
  shadowReach?: number;
  farReach?: number;
  fewerCascades?: number;
  noShadows?: boolean;
  details?: number;
  bodies?: number;
}

/**
 * The steps, in the frame's order (render/budget.ts) from its foot: leaves and far trees first, then shadows, then
 * pixels, then what a fight shows, and bodies' own levels last of all. A leaves step lowers the frame's triangles, which
 * crowns near give up; it is passed by where crowns near could give little (CROWNS).
 */
export const STEPS: readonly { readonly name: string; readonly knobs: Knobs }[] = [
  { name: "leaves: the frame's triangles to 75%", knobs: { leaves: 0.75 } },
  { name: "far trees, rocks and bushes to 70% as far", knobs: { farReach: 0.7 } },
  { name: "leaves: the frame's triangles to 50%", knobs: { leaves: 0.5 } },
  { name: "the farther cascade every other frame", knobs: { everyOther: true } },
  { name: "shadows to 60% as far", knobs: { shadowReach: 0.6 } },
  { name: "one cascade fewer", knobs: { fewerCascades: 1 } },
  { name: "no sun shadows", knobs: { noShadows: true } },
  { name: "85% of the pixels a side", knobs: { ratio: 0.85 } },
  { name: "70% of the pixels a side", knobs: { ratio: 0.7 } },
  { name: "small details: half the pool, of each burst and of the fill", knobs: { details: 0.5 } },
  { name: "bodies a level coarser", knobs: { bodies: 2 } },
];

/** `base` with `knobs`, for a screen of `dpr` device pixels a CSS pixel. */
function governed(base: Tier, knobs: Knobs, dpr: number): Tier {
  const s = base.shadows;
  const ratio = base.pixelRatio > 0 ? Math.min(dpr, base.pixelRatio) : dpr;
  const far = knobs.farReach ?? 1;
  return {
    ...base,
    pixelRatio: knobs.ratio && ratio > 1 ? Math.max(1, Math.round(ratio * knobs.ratio * 100) / 100) : base.pixelRatio,
    reach: { ...base.reach, trees: base.reach.trees * far, rocks: base.reach.rocks * far, bushes: base.reach.bushes * far },
    shadows: s.cascades === 0 || !base.lit ? s : { ...s, everyOther: s.everyOther || (knobs.everyOther === true && s.cascades > 1), distance: s.distance * (knobs.shadowReach ?? 1), cascades: knobs.noShadows ? 0 : Math.max(1, s.cascades - (knobs.fewerCascades ?? 0)) },
    budget: { ...base.budget, triangles: base.budget.triangles * (knobs.leaves ?? 1) },
    details: knobs.details ? { ...base.details, pool: Math.round(base.details.pool * knobs.details), share: base.details.share * knobs.details, fill: base.details.fill * knobs.details } : base.details,
    bodyError: base.bodyError * (knobs.bodies ?? 1),
  };
}

const same = (a: Tier, b: Tier): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A tier's levels: the tier, then each step that changes something on it, with its name and whether it is a leaves
 * step. One list a tier and screen.
 */
const ladders = new Map<Tier, Map<number, { name: string; tier: Tier; leaves: boolean }[]>>();
export function ladder(base: Tier, dpr: number): readonly { name: string; tier: Tier; leaves: boolean }[] {
  const mine = ladders.get(base) ?? ladders.set(base, new Map()).get(base)!;
  let out = mine.get(dpr);
  if (out) return out;
  out = [{ name: "the tier", tier: base, leaves: false }];
  let knobs: Knobs = {};
  for (const step of STEPS) {
    knobs = { ...knobs, ...step.knobs };
    const tier = governed(base, knobs, dpr);
    if (!same(tier, out.at(-1)!.tier)) out.push({ name: step.name, tier, leaves: step.knobs.leaves !== undefined });
  }
  mine.set(dpr, out);
  return out;
}

/** The mean of the middle eight tenths, which a single hitch does not move and a mix of 16.7 and 33.3 ms frames does. */
export function middleMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const cut = Math.floor(s.length / 10);
  let sum = 0;
  for (let i = cut; i < s.length - cut; i++) sum += s[i]!;
  return sum / (s.length - 2 * cut);
}

/** Whether `sorted` frames, `frame` ms on the mean, all come at one whole number of 60ths of a second. */
function paced(sorted: readonly number[], frame: number): boolean {
  const n = sorted.length;
  const whole = Math.round(frame / TARGET_MS);
  return whole >= 2 && Math.abs(frame / TARGET_MS - whole) < PACED && sorted[Math.floor(n * 0.9)]! - sorted[Math.floor(n * 0.1)]! < frame * PACED;
}

/** What the governor did, for the device report and the frame numbers. */
export interface GovernorStep {
  /** ms on the clock it was told. */
  at: number;
  level: number;
  name: string;
  why: string;
}

export class Governor {
  /** The level drawn: 0 for the tier, n for its first n steps. */
  level = 0;
  /** Set to hold a level and never move it, as the bench and the pages that pin pictures do. Null to govern. */
  held: number | null = null;
  /** Everything it did, the last 64, and how many moves it has made in all. */
  readonly steps: GovernorStep[] = [];
  moved = 0;
  /** The last window's mean frame and GPU time, ms, for the frame numbers. */
  frameMs = 0;
  gpuMs: number | null = null;

  private base: Tier | null = null;
  private dpr = 1;
  private top = 0;
  private quietUntil = 0;
  private windowAt = -1;
  private readonly intervals: number[] = [];
  private readonly ours: number[] = [];
  private readonly gpu: number[] = [];
  private sorted: number[] = [];
  private work = 0;
  /** The most triangles crowns near could still give in a frame of the window, and the last window's share of its work. */
  private crowns = 0;
  private crownShare = 0;
  private counted = 0;
  private misses = 0;
  private steadySince = 0;
  private restUntil = 0;
  private rest = REST_MS;
  /** A step down awaiting its window, with the load before it and the level it left; a try up, with the level it left and its windows that held; a try that held, while a step down undoes it. */
  private down: { before: number; from: number; tried: number } | null = null;
  private trying: { from: number; windows: number } | null = null;
  private probation: { level: number; until: number } | null = null;
  /** For each level: how many tries of the level above it failed, the frame's work when it was stepped down to, and the share of the load the step left. */
  private fails: number[] = [];
  private workAt: number[] = [];
  private kept: number[] = [];
  /** Until when each level is passed over, having bought nothing; and since when the frame has been lighter, or -1. */
  private passed: number[] = [];
  private lightSince = -1;

  /** The tier to draw this frame: `base` as the player chose it, governed if `on`. A new base starts again from it. */
  tier(base: Tier, on: boolean, dpr: number, now: number): Tier {
    const levels = ladder(base, dpr);
    if (base !== this.base || dpr !== this.dpr) {
      if (this.level > 0) this.move(now, 0, "a tier chosen");
      [this.base, this.dpr, this.top] = [base, dpr, levels.length - 1];
      this.reset(now);
    }
    if (this.held !== null) return levels[Math.min(this.held, this.top)]!.tier;
    if (!on && this.level > 0) this.move(now, 0, "turned off");
    return levels[on ? this.level : 0]!.tier;
  }

  /** The name of the step the level last took, or "" at the tier. */
  get name(): string {
    return this.base && this.level > 0 ? ladder(this.base, this.dpr)[this.level]!.name : "";
  }

  /** Nothing counts for `ms` from `now`: a lost context and the uploads that follow it. */
  pause(now: number, ms = JOIN_MS): void {
    this.quietUntil = Math.max(this.quietUntil, now + ms);
    this.clear();
  }

  /** A frame the GPU timed, as its time comes back. */
  timed(ms: number): void {
    if (this.windowAt >= 0) this.gpu.push(ms);
  }

  /**
   * A frame drawn at `now`, `interval` ms after the one before, our code's `ours` ms of it, `busy` if it took asset
   * uploads, `work` what it asked of the card (triangles and DRAW_TRIANGLES a draw), and `crowns` the triangles crowns
   * near took that they could still give (render/budget.ts).
   */
  frame(now: number, interval: number, ours: number, busy: boolean, work: number, crowns = 0): void {
    if (this.held !== null || this.base === null) return;
    if (interval > STALL_MS) return this.pause(now, SETTLE_MS);
    if (now < this.quietUntil) return;
    if (this.windowAt < 0) this.windowAt = now;
    this.counted++;
    if (!busy && interval > 0) {
      this.intervals.push(interval);
      this.ours.push(ours);
      this.work = Math.max(this.work, work);
      this.crowns = Math.max(this.crowns, crowns);
    }
    if (now - this.windowAt >= WINDOW_MS) this.window(now);
  }

  private window(now: number): void {
    const usable = this.intervals.length >= this.counted * USABLE && this.intervals.length > 0;
    this.sorted = [...this.intervals].sort((a, b) => a - b);
    const frame = middleMean(this.sorted);
    const known = this.gpu.length >= this.intervals.length * USABLE && this.gpu.length > 0;
    const gpu = known ? middleMean(this.gpu) : null;
    const ours = middleMean(this.ours);
    const work = this.work;
    if (this.work > 0) this.crownShare = this.crowns / this.work;
    this.clear();
    if (!usable) return;
    [this.frameMs, this.gpuMs] = [frame, gpu];
    const load = gpu ?? frame;
    const slow = frame > TARGET_MS * MISS;
    const miss = slow && (gpu !== null ? gpu >= TARGET_MS * GPU_FULL : ours < OURS * frame && !paced(this.sorted, frame));

    if (this.down) {
      const { before, from, tried } = this.down;
      this.down = null;
      if (load > before * (1 - GAIN)) {
        // A step this card does not need may stand before one it does.
        const to = this.below(now);
        if (tried < USELESS && to > 0) {
          this.down = { before, from, tried: tried + 1 };
          return this.move(now, to, `the step before took ${Math.round(load)} ms to ${Math.round(before)}`);
        }
        for (let l = from + 1; l <= this.level; l++) this.passed[l] = now + PASSED_MS;
        this.move(now, from, `the steps took ${Math.round(load)} ms to ${Math.round(before)}: the GPU is not what is slow`);
        this.restUntil = now + this.rest;
        this.rest = Math.min(this.rest * 2, REST_MOST);
        return;
      }
      // The levels passed on the way bought nothing, and a lighter scene goes back up through them as through this one.
      for (let l = from + 1; l < this.level; l++) [this.kept[l], this.workAt[l]] = [1, work];
      this.kept[this.level] = load / before;
      this.workAt[this.level] = work;
    }
    if (this.trying) {
      const { from } = this.trying;
      if (miss) {
        this.fails[from] = (this.fails[from] ?? 0) + 1;
        this.trying = null;
        return this.move(now, from, `the try missed at ${Math.round(frame)} ms`);
      }
      if (++this.trying.windows >= MISSES) {
        this.trying = null;
        this.probation = { level: from, until: now + PROBATION_MS };
      }
      return;
    }

    if (miss) {
      this.steadySince = now;
      this.lightSince = -1;
      const to = this.below(now);
      if (++this.misses < MISSES || to < 0 || now < this.restUntil) return;
      if (this.probation && this.probation.level === this.level + 1 && now < this.probation.until) this.fails[this.level + 1] = (this.fails[this.level + 1] ?? 0) + 1;
      this.probation = null;
      this.down = { before: load, from: this.level, tried: 1 };
      return this.move(now, to, `${Math.round(frame)} ms a frame${gpu !== null ? `, ${Math.round(gpu)} on the GPU` : ""}`);
    }
    this.misses = 0;
    if (slow || this.level === 0) return;
    const waited = now - this.steadySince;
    const backoff = 2 ** (this.fails[this.level] ?? 0);
    const wait = Math.min(WAIT_MS * backoff, WAIT_MOST);
    if (work > (this.workAt[this.level] ?? 0) * LIGHTER) this.lightSince = -1;
    else if (this.lightSince < 0) this.lightSince = now;
    const lighter = this.lightSince >= 0 && now - this.lightSince >= LIGHT_WAIT_MS * backoff;
    // Where the GPU's time is known, a level above is tried only if the step's share says it would hold.
    const fits = gpu === null || gpu / (this.kept[this.level] ?? 1) < TARGET_MS * GPU_FULL;
    if (fits && (waited >= wait || lighter)) {
      this.trying = { from: this.level, windows: 0 };
      this.move(now, this.level - 1, lighter && waited < wait ? "a lighter scene" : `${Math.round(waited / 1000)} s with no missed frame`);
    }
  }

  /** The next level down that is not passed over, nor a leaves step where crowns near could give little, or -1. */
  private below(now: number): number {
    const levels = ladder(this.base!, this.dpr);
    for (let to = this.level + 1; to <= this.top; to++) if ((this.passed[to] ?? 0) <= now && (!levels[to]!.leaves || this.crownShare >= CROWNS)) return to;
    return -1;
  }

  private move(now: number, level: number, why: string): void {
    const was = this.level;
    this.level = level;
    this.moved++;
    if (this.steps.push({ at: Math.round(now), level, name: level > was ? ladder(this.base!, this.dpr)[level]!.name : `back from ${ladder(this.base!, this.dpr)[was]!.name}`, why }) > 64) this.steps.shift();
    this.quietUntil = Math.max(this.quietUntil, now + STEP_SETTLE_MS);
    this.steadySince = now;
    this.misses = 0;
    this.clear();
  }

  private reset(now: number): void {
    [this.fails, this.workAt, this.kept, this.passed, this.lightSince] = [[], [], [], [], -1];
    [this.down, this.trying, this.probation] = [null, null, null];
    [this.rest, this.restUntil, this.misses] = [REST_MS, 0, 0];
    this.pause(now, JOIN_MS);
    this.steadySince = now;
  }

  private clear(): void {
    this.windowAt = -1;
    this.intervals.length = this.ours.length = this.gpu.length = 0;
    this.counted = 0;
    this.work = this.crowns = 0;
  }
}
