// The governor keeps the frame steady under the tier the player chose, on a phone that warms or on any machine that
// meets a scene heavier than it can draw, taking first what a player notices least for what it buys on a phone, whose GPU
// is bound by triangles (D423). It reads only what every browser gives: each frame's interval, our code's time, whether
// the frame took uploads, and what the frame asked of the card, counted at the iPhone's measured costs. The app draws the
// tier it returns, and the shell only passes it the numbers.
//
// The rule: frames are taken in windows of two seconds. A window misses when its frames come slower than 60 a second, or
// than the display's own rate once that is known, and our code took under three quarters of them. Two missed windows in
// a row take a step down, which must take a share off the frame's interval. A GPU that is slow and a display that shows
// only whole intervals, or runs at half rate to save power, look alike: frames steady at 33.3 ms. So where a window's
// frames all came at one whole number of the display's intervals, two or more, a step that did not move them is followed
// by the next, until they come faster, which says the GPU was slow, or every step is spent, which says the display paces
// them: then every step is undone, and that interval is the display's until a window comes faster. The display's
// interval is the shortest it has given. Where frames were not paced so, a step that bought nothing is passed for the
// next at once; if that buys nothing either, both are undone and passed over for a while, and the governor rests. A
// step back up is tried only after a long while with no missed window, or sooner where the frame has asked far less of
// the card than after the step for some seconds together; a try that misses is undone at once, and that level waits
// twice as long the next time. Nothing counts in the first seconds after a join, a lost context, a tier the player
// chose, or a long gap.

import { nearer, type Tier } from "./assets/tiers.ts";

/** The frame the governor holds, in ms: 60 a second. */
export const TARGET_MS = 1000 / 60;
/** A window whose frames are this much slower than the target, on the mean of its middle eight tenths, has missed: one frame in forty a whole interval late, or each a little. */
const MISS = 1.025;
/** Our code's share of a frame from which the frame is ours and not the GPU's (D246). */
const OURS = 0.75;
/** Frames whose middle eight tenths lie within this share of their mean, and their mean within it of a whole number of the display's intervals, came at that number. */
const PACED = 0.05;
/** A window this much faster than the display's rate as found says the display can go faster. */
const FASTER = 0.85;
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
/** After a step, the frames that size the canvas again or fetch other levels are left out. */
const STEP_SETTLE_MS = 1000;
/**
 * A step down must take this share off the frame, or leave it within the target. Where frames were not paced, one that
 * does not is passed for the next; after USELESS steps that bought nothing they are undone and passed over for
 * PASSED_MS, and the governor rests REST_MS, doubled each time.
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
/**
 * A leaves step is passed by where the triangles crowns near could still give were under this share of a frame's work,
 * and the far city's step where the far city's triangles were.
 */
const CROWNS = 0.1;
const CITY = 0.1;

/**
 * What the iPhone's GPU spends at full clock, in ms (D349, D423): a drawn triangle, as the elder oaks took 6.5 ms a
 * million past what it held; a triangle into a 1,024 and a 2,048 shadow map; and a draw, drawn or cast, as 2,000 of its
 * ladder's own triangles, which took 2.9 ms a million, since 1,024 draws more broke the ladder where 2 M of them did.
 */
export const PHONE_MS = { triangle: 6.5e-6, cast1024: 1.8e-6, cast2048: 3.8e-6, draw: 5.8e-3 } as const;

/** What a frame asks of the card, in ms of the iPhone's GPU at full clock: its triangles, its draws and what it casts into maps `size` texels a side. */
export function workMs(triangles: number, draws: number, cast: number, castDraws: number, size: number): number {
  return PHONE_MS.triangle * triangles + PHONE_MS.draw * (draws + castDraws) + (size > 1024 ? PHONE_MS.cast2048 : PHONE_MS.cast1024) * cast;
}

/** What a step changes. Steps add up: a level is every step before it. */
interface Knobs {
  levels?: number;
  leaves?: number;
  everyOther?: boolean;
  ratio?: number;
  farReach?: number;
  city?: number;
  fewerCascades?: number;
  details?: number;
  bodies?: number;
  own?: boolean;
  noLightTarget?: boolean;
}

/**
 * The steps, what a player notices least for what it buys on a phone first (tools/bench/governor.ts counts each in the
 * soaks' scenes and the woods, and with a built map in its downtown). Levels give first: the tier's error loosened,
 * where at the phone's view most triangles of bodies, vehicles, pieces and rocks are under a pixel; half again takes 10
 * to 17% of a frame's triangles, twice 19 to 27%. Downtown, where the far city is most of a frame and levels find little
 * to take, its levels drawn 70% as far take 7 to 27% of it, the lattice changing a pixel in a hundred where it comes
 * nearer and the mass taking the lattice's place nearer; it is passed by where the far city draws little (CITY). Crowns
 * follow levels too, but where the frame's budget binds they take back what the rest gives, and there the leaves steps
 * give, each passed by where crowns near could give little (CROWNS). The farther cascade every other frame takes a sixth
 * to a quarter of what is cast. Then far trees, levels looser again, a cascade fewer and bodies' own levels, and only
 * then pixels, which a phone bound by triangles buys least with: the screen's own. Then what a fight shows, last. No step
 * takes the sun's shadows, which would change the light of the whole picture where a step may cost only detail; and
 * shadows less far is no step: a nearer cascade's finer texels ask finer casters, and it cast more. Before
 * all of these a desktop gives back what it was given beyond a phone: first the pixels ultra draws past the screen's
 * own, a quarter of its pixels on a screen of one device pixel to one, then the light target (render/post.ts), which no
 * phone draws: the frame keeps its grade and contact and loses bloom and the sharpen, and 3 to 4 ms of a desktop's card.
 */
export const STEPS: readonly { readonly name: string; readonly knobs: Knobs }[] = [
  { name: "no more pixels than the screen's own", knobs: { own: true } },
  { name: "no light target", knobs: { noLightTarget: true } },
  { name: "levels: half again the error", knobs: { levels: 1.5 } },
  { name: "the far city's levels to 70% as far", knobs: { city: 0.7 } },
  { name: "leaves: the frame's triangles to 75%", knobs: { leaves: 0.75 } },
  { name: "the farther cascade every other frame", knobs: { everyOther: true } },
  { name: "levels: twice the error", knobs: { levels: 2 } },
  { name: "far trees, rocks and bushes to 70% as far", knobs: { farReach: 0.7 } },
  { name: "leaves: the frame's triangles to 50%", knobs: { leaves: 0.5 } },
  { name: "levels: three times the error", knobs: { levels: 3 } },
  { name: "one cascade fewer", knobs: { fewerCascades: 1 } },
  { name: "bodies a level coarser", knobs: { bodies: 2 } },
  { name: "85% of the pixels a side", knobs: { ratio: 0.85 } },
  { name: "70% of the pixels a side", knobs: { ratio: 0.7 } },
  { name: "small details: half the pool, of each burst and of the fill", knobs: { details: 0.5 } },
];

/** `base` with `knobs`, for a screen of `dpr` device pixels a CSS pixel. */
function governed(base: Tier, knobs: Knobs, dpr: number): Tier {
  const s = base.shadows;
  const ratio = base.pixelRatio > 0 ? Math.min(dpr, base.pixelRatio) : dpr;
  const far = knobs.farReach ?? 1;
  return {
    ...base,
    threshold: base.threshold * (knobs.levels ?? 1),
    pixelRatio: knobs.ratio && ratio > 1 ? Math.max(1, Math.round(ratio * knobs.ratio * 100) / 100) : base.pixelRatio,
    fewest: knobs.own && base.fewest > ratio ? 0 : base.fewest,
    reach: { ...base.reach, trees: base.reach.trees * far, rocks: base.reach.rocks * far, bushes: base.reach.bushes * far },
    city: knobs.city ? { levels: nearer(base.city.levels, knobs.city) } : base.city,
    shadows: s.cascades === 0 || !base.lit ? s : { ...s, everyOther: s.everyOther || (knobs.everyOther === true && s.cascades > 1), cascades: Math.max(1, s.cascades - (knobs.fewerCascades ?? 0)) },
    budget: { ...base.budget, triangles: base.budget.triangles * (knobs.leaves ?? 1) },
    details: knobs.details ? { ...base.details, pool: Math.round(base.details.pool * knobs.details), share: base.details.share * knobs.details, fill: base.details.fill * knobs.details } : base.details,
    bodyError: base.bodyError * (knobs.bodies ?? 1),
    post: knobs.noLightTarget ? null : base.post,
  };
}

const same = (a: Tier, b: Tier): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A tier's levels: the tier, then each step that changes something on it, with its name and whether it is a leaves
 * step or the far city's. One list a tier and screen.
 */
type Level = { name: string; tier: Tier; leaves: boolean; city: boolean };
const ladders = new Map<Tier, Map<number, Level[]>>();
export function ladder(base: Tier, dpr: number): readonly Level[] {
  const mine = ladders.get(base) ?? ladders.set(base, new Map()).get(base)!;
  let out = mine.get(dpr);
  if (out) return out;
  out = [{ name: "the tier", tier: base, leaves: false, city: false }];
  let knobs: Knobs = {};
  for (const step of STEPS) {
    knobs = { ...knobs, ...step.knobs };
    const tier = governed(base, knobs, dpr);
    if (!same(tier, out.at(-1)!.tier)) out.push({ name: step.name, tier, leaves: step.knobs.leaves !== undefined, city: step.knobs.city !== undefined });
  }
  mine.set(dpr, out);
  return out;
}

/** The mean of the middle eight tenths of `sorted`, which a single hitch does not move and a mix of 16.7 and 33.3 ms frames does. */
export function middleMean(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const cut = Math.floor(sorted.length / 10);
  let sum = 0;
  for (let i = cut; i < sorted.length - cut; i++) sum += sorted[i]!;
  return sum / (sorted.length - 2 * cut);
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
  /** The interval the display was found to give frames at however light the frame, ms; 0 while none is known. */
  paced = 0;
  /** The shortest interval a window of steady frames has come at, ms: the display's own, until it shows a shorter. */
  display = TARGET_MS;

  private base: Tier | null = null;
  private dpr = 1;
  private top = 0;
  private quietUntil = 0;
  private windowAt = -1;
  private readonly intervals: number[] = [];
  private readonly ours: number[] = [];
  private work = 0;
  /**
   * The most crowns near could still give in a frame of the window and the most the far city drew, in the units of
   * `work`, and the last window's shares of its work.
   */
  private crowns = 0;
  private crownShare = 0;
  private city = 0;
  private cityShare = 0;
  private counted = 0;
  private misses = 0;
  private steadySince = 0;
  private restUntil = 0;
  private rest = REST_MS;
  /**
   * A step down awaiting its window, with the frame before it, the level it left, how many steps bought nothing, and
   * whether the frames before it came at whole intervals; a try up, with the level it left and its windows that held; a try that
   * held, while a step down undoes it.
   */
  private down: { before: number; from: number; tried: number; paced: boolean } | null = null;
  private trying: { from: number; windows: number } | null = null;
  private probation: { level: number; until: number } | null = null;
  /** For each level: how many tries of the level above it failed, the frame's work when it was stepped down to, and the share of the frame the step left. */
  private fails: number[] = [];
  private workAt: number[] = [];
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

  /**
   * A frame drawn at `now`, `interval` ms after the one before, our code's `ours` ms of it, `busy` if it took asset
   * uploads, `work` what it asked of the card (workMs), `crowns` the part of that crowns near took that they could still
   * give (render/budget.ts), and `city` the part the far city's triangles took.
   */
  frame(now: number, interval: number, ours: number, busy: boolean, work: number, crowns = 0, city = 0): void {
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
      this.city = Math.max(this.city, city);
    }
    if (now - this.windowAt >= WINDOW_MS) this.window(now);
  }

  private window(now: number): void {
    const usable = this.intervals.length >= this.counted * USABLE && this.intervals.length > 0;
    const sorted = this.intervals.sort((a, b) => a - b);
    const frame = middleMean(sorted);
    const n = sorted.length;
    const steady = n > 0 && sorted[Math.floor(n * 0.9)]! - sorted[Math.floor(n * 0.1)]! < frame * PACED;
    const ours = middleMean(this.ours.sort((a, b) => a - b));
    const work = this.work;
    if (this.work > 0) [this.crownShare, this.cityShare] = [this.crowns / this.work, this.city / this.work];
    this.clear();
    if (!usable) return;
    if (steady) this.display = Math.min(this.display, frame);
    const whole = Math.round(frame / this.display);
    const paced = steady && whole >= 2 && Math.abs(frame / this.display - whole) < PACED;
    if (this.paced > 0 && frame < this.paced * FASTER) this.paced = 0;
    const slow = frame > Math.max(TARGET_MS, this.paced) * MISS;
    const miss = slow && ours < OURS * frame;

    if (this.down) {
      const { before, from, tried, paced: was } = this.down;
      this.down = null;
      if (slow && frame > before * (1 - GAIN)) {
        // A step this card does not need may stand before one it does; and frames at whole intervals move only once
        // the GPU fits in fewer of them, so from those every level is tried.
        const to = this.below(now);
        if (to >= 0 && (was || tried < USELESS)) {
          this.down = { before, from, tried: tried + 1, paced: was };
          return this.move(now, to, was ? `frames stayed at ${Math.round(frame)} ms` : `the step before took ${Math.round(frame)} ms to ${Math.round(before)}`);
        }
        if (was) {
          this.paced = before;
          return this.move(now, from, `frames stayed at ${Math.round(frame)} ms at every level: the display's rate`);
        }
        for (let l = from + 1; l <= this.level; l++) this.passed[l] = now + PASSED_MS;
        this.move(now, from, `the steps took ${Math.round(frame)} ms to ${Math.round(before)}: the GPU is not what is slow`);
        this.restUntil = now + this.rest;
        this.rest = Math.min(this.rest * 2, REST_MOST);
        return;
      }
      // The levels passed on the way bought nothing by themselves, and a lighter scene goes back up through them as through this one.
      for (let l = from + 1; l <= this.level; l++) this.workAt[l] = work;
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
      this.down = { before: frame, from: this.level, tried: 1, paced };
      return this.move(now, to, `${Math.round(frame)} ms a frame${paced ? `, ${whole} display intervals` : ""}`);
    }
    this.misses = 0;
    if (slow || this.level === 0) return;
    const waited = now - this.steadySince;
    const backoff = 2 ** (this.fails[this.level] ?? 0);
    const wait = Math.min(WAIT_MS * backoff, WAIT_MOST);
    if (work > (this.workAt[this.level] ?? 0) * LIGHTER) this.lightSince = -1;
    else if (this.lightSince < 0) this.lightSince = now;
    const lighter = this.lightSince >= 0 && now - this.lightSince >= LIGHT_WAIT_MS * backoff;
    if (waited >= wait || lighter) {
      this.trying = { from: this.level, windows: 0 };
      this.move(now, this.level - 1, lighter && waited < wait ? "a lighter scene" : `${Math.round(waited / 1000)} s with no missed frame`);
    }
  }

  /** The next level down that is not passed over, nor a leaves step where crowns near could give little, nor the far city's where it drew little, or -1. */
  private below(now: number): number {
    const levels = ladder(this.base!, this.dpr);
    for (let to = this.level + 1; to <= this.top; to++) if ((this.passed[to] ?? 0) <= now && (!levels[to]!.leaves || this.crownShare >= CROWNS) && (!levels[to]!.city || this.cityShare >= CITY)) return to;
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
    [this.fails, this.workAt, this.passed, this.lightSince] = [[], [], [], -1];
    [this.down, this.trying, this.probation] = [null, null, null];
    [this.rest, this.restUntil, this.misses] = [REST_MS, 0, 0];
    this.pause(now, JOIN_MS);
    this.steadySince = now;
  }

  private clear(): void {
    this.windowAt = -1;
    this.intervals.length = this.ours.length = 0;
    this.counted = 0;
    this.work = this.crowns = this.city = 0;
  }
}
