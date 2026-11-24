// The thatch tier's recipe: long reed hung in two tiers on a frame of hand-cut poles, lashed with cord; a floor of mats
// on a crib of logs; a roof laid in courses whose eaves droop past its edges. Ported from the tier's Python
// (assets/source/core/structures/thatch/pieces.py and kit.py), drawing from the same seeds, so its poles and bundles
// are the ones those made.
//
// It is written in the Python's axes, x along a piece, y up from its foot and z out of its front, and turned into the
// kit's frame as each solid is handed over.
//
// Levels: 0 is the frame as the scripts made it, each bundle a belly of its own and each skirt ending in its ragged
// foot; 1 is straight poles without cord, the upper skirt's bundles a facet each over their cut-out tips and the lower
// tier one leaning slab; 2 is two slabs that wear the picture and a post; 3 and 4 are plain solids in flat colours.
// No level is thinned from another.
//
// Materials: "thatch" and "door" are the tier's pictures cut out where their alpha says, for the tips alone;
// "thatch_solid" and "door_solid" are the same pictures drawn whole, for the bodies, and name no textures of their own
// (the tier's asset points them at the cut-out ones'). Past level 1 nothing is cut out.

import { outlineBox } from "../../../shared/world/lattice/forms.ts";
import { RoundShape, Shape, add, cross, dot, length, pathFrames, poleRings, roundEven, scale, sub, unit, type Patch, type Uv, type Vec } from "./kit.ts";
import type { TierRecipe } from "./lod.ts";
import { PyRandom, pyMod, pyRepr, pyRound } from "./mt.ts";

const SPAN = 3;
const H = SPAN / 2;
const WALL_H = 3;

/** Metres a picture spans. The wall and door pictures cover a piece each; the wood sheet's bands wrap along a pole. */
const TILE = { thatch: 3, roof: 3, door: 3, floor: 3, earth: 1.5, wood: 1.5 } as const;
const BODY = "thatch_solid";
const TIPS = "thatch";

/** The wood sheet's bands, as rows of 2,048 from its top: v at the top and at the bottom of each. */
const BANDS: Readonly<Record<string, readonly [number, number]>> = { bark: [0, 614], peeled: [614, 1126], stick: [1126, 1434], cord: [1434, 1782], ends: [1782, 2048] };
const bandV = (name: string): [number, number] => [1 - BANDS[name]![0] / 2048, 1 - BANDS[name]![1] / 2048];

const smooth = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bump = (t: number): number => Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)) ** 0.6;
/** A number from 0 up to 1 that depends only on a bundle run's name and a place along it. */
const hash01 = (seed: string, x: number): number => new PyRandom(`('${seed}', ${pyRepr(x)})`).random();

/** A piece as it is gathered, in the Python's axes. `lift` is how far its foot stands under its middle. */
class Hut {
  readonly shape = new RoundShape();
  private readonly lift: number;
  private readonly swung: boolean;

  constructor(lift: number, swung = false) {
    [this.lift, this.swung] = [lift, swung];
  }

  private readonly turn = (p: Vec): Vec => {
    // An open door is the shut one a quarter turn round its hinge side.
    const q: Vec = this.swung ? [-DOOR_W / 2 - p[2], p[1], p[0] + DOOR_W / 2] : p;
    return [q[0], -q[2], q[1] - this.lift];
  };

  private turned(patches: readonly Patch[]): Patch[] {
    // The kit's axes are x, the Python's z turned about, and its y.
    return patches.map((f) => ({ ...f, points: f.points.map(this.turn), ...(f.along === undefined ? {} : { along: [0, 2, 1][f.along]! }) }));
  }

  solid(patches: readonly Patch[]): void {
    this.shape.skin(this.turned(patches));
  }

  card(patches: readonly Patch[]): void {
    this.shape.card(this.turned(patches));
  }

  box(lo: Vec, hi: Vec, mat: string, uv: (p: Vec) => Uv, along?: number): void {
    const at = (i: number, j: number, k: number): Vec => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
    const corners = [[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]];
    this.solid(corners.map((face) => {
      const points = face.map(([i, j, k]) => at(i!, j!, k!));
      return { points, uvs: points.map(uv), mat, ...(along === undefined ? {} : { along }) };
    }));
  }
}

/** A flat level's face: a colour and nothing else. */
const NO_UV = (): Uv => [0, 0];

// Poles ---------------------------------------------------------------------------------------------------------------

interface Pole {
  a: Vec;
  b: Vec;
  path: Vec[];
  radii: number[];
  /** How far each point of each ring stands in or out of round. */
  dents: number[][];
  twist: number;
  /** The way each end is cut at a slant, or null where it is cut square. */
  axe: [number | null, number | null];
  /** Which of the sheet's six end grain discs its ends wear. */
  disc: number;
  sides: number;
  band: string;
}

interface PoleOpts {
  band?: string;
  bow?: number;
  bowDir?: Vec;
  caps?: readonly [string, string];
  segments?: number;
  sides?: number;
}

/** A hand-cut pole from a to b as the scripts drew it, taking from `rng` what they took. */
function poleOf(rng: PyRandom, a: Vec, b: Vec, r0: number, r1: number, o: PoleOpts = {}): Pole {
  const { band = "peeled", bow = 0, bowDir = [0, 0, 1], caps = ["axe", "axe"], segments = 5, sides = 8 } = o;
  let n = segments;
  if (length(sub(b, a)) < 0.6) n = Math.min(n, Math.abs(bow) < 1e-6 ? 2 : 3);
  const path: Vec[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    path.push(add(lerp(a, b, t), scale(unit(bowDir), Math.sin(Math.PI * t) * bow)));
    radii.push(r0 + (r1 - r0) * t);
  }
  const twist = rng.uniform(0, 6.28);
  const dents = path.map(() => Array.from({ length: sides }, () => 1 + rng.uniform(-0.07, 0.07)));
  const axe = caps.map((kind) => (kind === "axe" ? rng.uniform(0, 2 * Math.PI) : null)) as [number | null, number | null];
  return { a, b, path, radii, dents, twist, axe, disc: rng.randrange(6), sides, band };
}

/** How a level draws a pole: with fewer sides or rings than it was made with, or straight and smooth from end to end. */
interface Drawn {
  sides?: number;
  rings?: readonly number[];
  plain?: boolean;
  /** A straight pole is made as thick through as the round one unless this says how many times its radius it is. */
  grow?: number;
  /** It runs along this axis of the Python's and may cross a yield ring whole. */
  along?: number;
}

function drawPole(hut: Hut, pole: Pole, how: Drawn | null): void {
  if (!how) return;
  const sides = how.sides ?? pole.sides;
  const last = pole.path.length - 1;
  const kept = how.plain ? [0, last] : (how.rings ?? pole.path.map((_, i) => i));
  const frames = pathFrames(pole.path);
  // A ring with fewer sides takes each point's dent from the nearest the scripts drew.
  const dent = (i: number, j: number): number => (how.plain ? 1 : pole.dents[i]![Math.round((j * pole.sides) / sides) % pole.sides]!);
  // A straight pole of few sides is made as thick through as the round one: a triangle inside its circle would be a third of it.
  const thick = how.grow ?? Math.sqrt(Math.PI / ((sides / 2) * Math.sin((2 * Math.PI) / sides)));
  const all = poleRings(how.plain ? [pole.path[0]!, pole.path[last]!] : pole.path, sides, pole.twist, (i, j) => (how.plain ? [pole.radii[0]!, pole.radii[last]!][i]! * thick : pole.radii[i]! * dent(i, j)));
  if (!how.plain) {
    [0, last].forEach((end, k) => {
      const ang = pole.axe[k];
      if (ang === null || ang === undefined) return;
      const d = frames[end]![0];
      all[end] = all[end]!.map((p, j) => add(p, scale(d, (k === 0 ? -1 : 1) * Math.cos(pole.twist + (2 * Math.PI * j) / sides - ang) * pole.radii[end]! * 0.7)));
    });
  }
  const rings = how.plain ? all : kept.map((i) => all[i]!);
  const along = [0];
  for (let i = 1; i < pole.path.length; i++) along.push(along[i - 1]! + length(sub(pole.path[i]!, pole.path[i - 1]!)));
  const run = how.plain ? [0, along[last]!] : kept.map((i) => along[i]!);
  const [vTop, vBottom] = bandV(pole.band);
  const band = vTop - vBottom;
  const group = hut.shape.group();
  const more = how.along === undefined ? {} : { along: how.along };
  const patches: Patch[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const [va, vb, ua, ub] = [vBottom + (band * j) / sides, vBottom + (band * (j + 1)) / sides, run[i]! / TILE.wood, run[i + 1]! / TILE.wood];
      patches.push({ points: [rings[i]![j]!, rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![j]!], uvs: [[ua, va], [ua, vb], [ub, vb], [ub, va]], mat: "wood", group, ...more });
    }
  }
  // The cut ends wear one of the six end grain discs, centred 336 pixels apart from (184, 1915), 118 in radius.
  const [cu, cv, rad] = [(184 + 336 * pole.disc) / 2048, 1 - 1915 / 2048, 118 / 2048];
  const axis = unit(sub(pole.b, pole.a));
  const e1 = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(axis, e1);
  for (const ring of [[...rings[0]!].reverse(), rings[rings.length - 1]!]) {
    const c = scale(ring.reduce((sum, p) => add(sum, p), [0, 0, 0] as Vec), 1 / ring.length);
    const most = Math.max(...ring.map((p) => length(sub(p, c)))) || 1;
    patches.push({ points: ring, uvs: ring.map((p): Uv => [cu + (rad * dot(sub(p, c), e1)) / most, cv + (rad * dot(sub(p, c), e2)) / most]), mat: "wood", ...more });
  }
  hut.solid(patches);
}

interface Cord {
  path: Vec[];
  radii: number[];
  dents: number[][];
  twist: number;
}

/** Turns of cord round a pole, a short fat band, as the scripts drew it. */
function cordOf(rng: PyRandom, centre: Vec, axis: Vec, radius: number, width: number): Cord {
  const a = unit(axis);
  const twist = rng.uniform(0, 6.28);
  const path = [add(centre, scale(a, -width / 2)), centre, add(centre, scale(a, width / 2))];
  return { path, radii: [radius * 0.96, radius * 1.03, radius * 0.96], dents: path.map(() => Array.from({ length: 7 }, () => 1 + rng.uniform(-0.05, 0.05))), twist };
}

/**
 * The cord as a band between its two ends, as wide round as the scripts' was at its middle. `on` is the radius of the
 * pole it is wound on, or null where the level draws no cord: it has as few sides as keep its flats clear of the pole.
 */
function drawCord(hut: Hut, cord: Cord, on: number | null, along?: number): void {
  if (on === null) return;
  const off = cord.radii[1]! / on;
  const sides = off >= 1.3 ? 5 : off >= 1.2 ? 6 : 7;
  const more = along === undefined ? {} : { along };
  const frames = pathFrames(cord.path);
  const ends = [0, 2];
  const rings = poleRings(cord.path, sides, cord.twist, (_, j) => cord.radii[1]! * cord.dents[1]![Math.round((j * 7) / sides) % 7]!).filter((_, i) => ends.includes(i));
  const [vTop, vBottom] = bandV("cord");
  const band = vTop - vBottom;
  const width = length(sub(cord.path[2]!, cord.path[0]!));
  const group = hut.shape.group();
  const patches: Patch[] = [];
  for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides;
    const [va, vb] = [vBottom + (band * j) / sides, vBottom + (band * (j + 1)) / sides];
    patches.push({ points: [rings[0]![j]!, rings[0]![k]!, rings[1]![k]!, rings[1]![j]!], uvs: [[0, va], [0, vb], [width / TILE.wood, vb], [width / TILE.wood, va]], mat: "wood", group, ...more });
  }
  [[...rings[0]!].reverse(), rings[1]!].forEach((ring, k) => {
    const [, e1, e2] = frames[ends[k]!]!;
    const c = cord.path[ends[k]!]!;
    patches.push({ points: ring, uvs: ring.map((p): Uv => [0.5 + dot(sub(p, c), e1) / TILE.wood, vBottom + band * (0.5 + dot(sub(p, c), e2) / TILE.wood)]), mat: "wood", ...more });
  });
  hut.solid(patches);
}

// Thatch: a tier of long stems ----------------------------------------------------------------------------------------

/** Bundles of stems across a run that repeats: where each starts, how full it is, how far it hangs and how deep the gap after it opens. */
class Clumps {
  readonly edges: number[];
  readonly n: number;
  readonly full: number[];
  readonly drop: number[];
  readonly split: number[];
  private readonly jitters = new Map<number, number>();
  readonly seed: string;
  readonly period: number;

  constructor(seed: string, lo = 0.11, hi = 0.26, period = SPAN, start = -H, drop: readonly [number, number] = [-0.08, 0.05]) {
    [this.seed, this.period] = [seed, period];
    const rng = new PyRandom(seed);
    let widths: number[] = [];
    const sum = (): number => widths.reduce((s, w) => s + w, 0);
    while (sum() < period) widths.push(rng.uniform(lo, hi));
    const k = period / sum();
    widths = widths.map((w) => w * k);
    const offset = rng.uniform(0, widths[0]!);
    this.edges = [start + offset];
    for (const w of widths.slice(0, -1)) this.edges.push(this.edges[this.edges.length - 1]! + w);
    this.n = widths.length;
    this.full = widths.map(() => rng.uniform(0.5, 1));
    this.drop = widths.map(() => rng.uniform(drop[0], drop[1]));
    this.split = widths.map(() => rng.uniform(0.55, 1.35));
  }

  /** Which bundle x is in, and how far across it, 0 to 1. */
  at(x: number): [number, number] {
    const x0 = this.edges[0]!;
    const u = pyMod(x - x0, this.period) + x0;
    for (let i = 0; i < this.n; i++) {
      const a = this.edges[i]!;
      const b = i + 1 < this.n ? this.edges[i + 1]! : x0 + this.period;
      if (a <= u && u < b + 1e-9) return [i, Math.min((u - a) / (b - a), 1)];
    }
    return [this.n - 1, 1];
  }

  /** Points across [x0, x1]: `per` to a bundle with its edges among them, and x0 and x1 themselves. */
  columns(x0: number, x1: number, per: number): number[] {
    const xs = new Set([pyRound(x0, 6), pyRound(x1, 6)]);
    for (let i = 0; i < this.n; i++) {
      const a = this.edges[i]!;
      const b = i + 1 < this.n ? this.edges[i + 1]! : this.edges[0]! + this.period;
      for (const shift of [-this.period, 0, this.period]) {
        for (let k = 0; k < per; k++) {
          const x = a + shift + ((b - a) * k) / per;
          if (x0 + 0.025 < x && x < x1 - 0.025) xs.add(pyRound(x, 6));
        }
      }
    }
    return [...xs].sort((p, q) => p - q);
  }

  /** How much a point of the foot is out of line, from -1 to 1, the same wherever x recurs. */
  jitter(x: number): number {
    const key = pyRound(pyMod(x, this.period), 4);
    let v = this.jitters.get(key);
    if (v === undefined) this.jitters.set(key, (v = 2 * hash01(this.seed, key) - 1));
    return v;
  }

  /** Where the stems at x end: longest at a bundle's middle, so the gaps between bundles open into a V. */
  foot(x: number, foot: number, tuft: number, jitter: number, by = 1): number {
    const [i, t] = this.at(x);
    const split = t > 0.5 ? this.split[i]! : this.split[(i - 1 + this.n) % this.n]!;
    return foot + by * (this.drop[i]! + jitter * this.jitter(x) + tuft * split * (1 - bump(t) ** 1.5));
  }
}

/** How far of its swell a row stands out on the whole: a bundle's mean fullness by the mean of its rounding across. */
const MEAN_FULL = 0.58;

/** A row of a tier's front: its height, how far out it stands, how far a full bundle swells past that, and how finely it is cut across. */
interface Row {
  y: number;
  z: number;
  swell: number;
  /** "ends" is one face across, "edges" a point between bundles, "full" one at each bundle's middle too. */
  cut: "ends" | "edges" | "full";
}

interface TierSpec {
  clumps: Clumps;
  x0: number;
  x1: number;
  /** From the top down to where the tips begin. */
  rows: readonly Row[];
  /**
   * The back's heights and depths from the top down, flat across, ending at the line behind where the tips begin. A
   * row may name the picture the strip down to it wears, where that is not the back's own.
   */
  back: readonly (readonly [number, number, ((p: Vec) => Uv)?])[];
  foot: number;
  flare: number;
  tuft: number;
  jitter?: number;
  /** Points to a bundle along the ragged foot: 4 follows the scripts' foot, which the picture's tips are painted to. */
  feet: number;
  /**
   * How thin the thatch is pressed against a post, by place across. A row that is one face across is not pressed: the
   * wall's head then stands as thick as its middle sheet from end to end, and nothing shows through along it.
   */
  pinch?: (x: number) => number;
  /** Below its tie each bundle leans this far across for each metre down. */
  lean?: readonly [number, number];
  uv: (p: Vec) => Uv;
  uvBack?: (p: Vec) => Uv;
  mats: readonly [string, string];
  /**
   * How the tips hang: "skirt" as part of the tier, their back a plain sheet nobody sees behind; "open" the same with
   * the back cut out too, for a skirt seen from under it; "ends" cut out so only near the tier's two ends, where a
   * wall's free end shows the back of its skirt; "none" where the level draws them whole with the body.
   */
  tips: "skirt" | "open" | "ends" | "none";
  /** Flat across, each row standing out by a bundle's mean: what a level draws that shows no bundles. Its points across are only those its lean needs. */
  plain?: boolean;
}

/**
 * A tier of thatch from x0 to x1 as one closed slab: its front swells bundle by bundle below its tie and its foot is
 * ragged. Each bundle is shaded as one round belly, and the gaps between bundles stay sharp.
 */
function tier(hut: Hut, s: TierSpec): void {
  const { clumps, x0, x1, rows, back, mats } = s;
  const pinch = s.pinch ?? (() => 1);
  const jitter = s.jitter ?? 0.03;
  // A lean is none at a tier's ends and whole 0.4 m in from them.
  const leaning = x1 - x0 > 1 ? [x0, x0 + 0.4, x1 - 0.4, x1] : [x0, (x0 + x1) / 2, x1];
  const columns = (cut: Row["cut"] | number): number[] => (s.plain ? leaning : cut === "ends" ? [pyRound(x0, 6), pyRound(x1, 6)] : clumps.columns(x0, x1, cut === "edges" ? 1 : cut === "full" ? 2 : cut));
  const lean = (p: Vec): Vec => (s.lean ? [p[0] + s.lean[1] * Math.max(0, s.lean[0] - p[1]) * smooth((p[0] - x0) / 0.4) * smooth((x1 - p[0]) / 0.4), p[1], p[2]] : p);
  const last = rows[rows.length - 1]!;
  const front = (row: Row, x: number): Vec => {
    const [i, t] = clumps.at(x);
    return [x, row.y, (row.z + row.swell * (s.plain ? MEAN_FULL : clumps.full[i]! * bump(t))) * (row.cut === "ends" && !s.plain ? 1 : pinch(x))];
  };
  const tip = (x: number): Vec => {
    const [i, t] = clumps.at(x);
    return [x, clumps.foot(x, s.foot, s.tuft, jitter), (last.z + s.flare + last.swell * clumps.full[i]! * bump(t) * 0.9) * pinch(x)];
  };
  const groups = new Map<number, number>();
  const groupAt = (x: number): number => {
    const [i] = clumps.at(x);
    if (!groups.has(i)) groups.set(i, hut.shape.group());
    return groups.get(i)!;
  };
  // Every point is laid on the picture where it hangs straight, and then leans with its bundle.
  const face = (points: Vec[], mat: string, uv: (p: Vec) => Uv, group?: number): Patch => ({ points: points.map(lean), uvs: points.map(uv), mat, ...(group === undefined ? {} : { group }) });
  const solidUv = (p: Vec): Uv => s.uv([p[0], Math.max(p[1], last.y + 0.03), p[2]]);
  const lines = rows.map((row) => columns(row.cut).map((x) => front(row, x)));
  const hem = s.tips === "none" ? null : columns(s.feet).map(tip);
  const patches: Patch[] = [];
  /** Faces between an upper line of points and a lower one, where one's places across are among the other's: one face to each step of the coarser. */
  const ladder = (upper: Vec[], lower: Vec[], mat: string, round: boolean, uv = s.uv): void => {
    const [coarse, fine] = upper.length <= lower.length ? [upper, lower] : [lower, upper];
    for (let k = 0; k + 1 < coarse.length; k++) {
      const within = fine.filter((p) => p[0] >= coarse[k]![0] - 1e-9 && p[0] <= coarse[k + 1]![0] + 1e-9);
      const [top, bottom] = coarse === upper ? [[coarse[k]!, coarse[k + 1]!], within] : [within, [coarse[k]!, coarse[k + 1]!]];
      patches.push(face([...top, ...[...bottom].reverse()], mat, uv, round ? groupAt((coarse[k]![0] + coarse[k + 1]![0]) / 2) : undefined));
    }
  };
  for (let r = 0; r + 1 < lines.length; r++) ladder(lines[r]!, lines[r + 1]!, mats[0], !s.plain && rows[r]!.cut !== "ends");
  const low = back.length - 1;
  // Behind the tips the back's last row has a point at each gap between bundles, so their back is a sheet to each
  // bundle, hidden behind its own tips.
  const backs = back.map(([y, z], r) => (r === low && hem ? columns("edges") : [x0, x1]).map((x): Vec => [x, y, z]));
  if (hem) {
    ladder(lines[lines.length - 1]!, hem, mats[1], true);
    // The back of the tips, a sheet to each bundle: cut out as the tips are where it can be seen.
    const [coarse, shown] = [backs[low]!, s.tips === "open" ? Infinity : s.tips === "ends" ? 0.75 : 0];
    for (let k = 0; k + 1 < coarse.length; k++) {
      const open = Math.min(coarse[k + 1]![0] - x0, x1 - coarse[k]![0]) < shown;
      ladder([coarse[k]!, coarse[k + 1]!], hem.filter((p) => p[0] >= coarse[k]![0] - 1e-9 && p[0] <= coarse[k + 1]![0] + 1e-9), open ? mats[1] : mats[0], false, open ? s.uv : solidUv);
    }
  } else ladder(lines[lines.length - 1]!, backs[low]!, mats[0], false, solidUv);
  for (let r = 0; r < low; r++) ladder(backs[r]!, backs[r + 1]!, mats[0], false, back[r + 1]![2] ?? s.uvBack ?? s.uv);
  ladder(lines[0]!, backs[0]!, mats[0], false, solidUv);
  // A cut end is solid reed all the way down, so it wears the body's picture above where the tips begin.
  for (const at of [0, -1]) {
    const column = [...lines.map((l) => l.at(at)!), ...(hem ? [hem.at(at)!] : [])];
    patches.push(face([...column, ...backs.map((l) => l.at(at)!).reverse()], mats[0], solidUv));
  }
  hut.solid(patches);
}

// The wall ------------------------------------------------------------------------------------------------------------

// Heights in metres above the foot of the wall.
const UPPER_ROD = 2.62;
const LOWER_ROD = 1.2;
const UPPER_FOOT = 1.4;
const LOWER_FOOT = -0.04;
const RAILS = [0.16, LOWER_ROD, UPPER_ROD, 2.84] as const;
const POST_R = [0.08, 0.068] as const;
// The post at a wall's left end stands proud of the thatch and a little past the end.
const POST_X = -H - 0.035;
const POST_Z = 0.1;
const ROD_R = 0.024;
const ROD_Z = 0.08;
const RAIL_R = 0.042;
const RAIL_Z = -0.064;
const INNER_Z = -0.082;
const BACK_Z = -0.022;
// A wall's top and foot are not quite level from front to back, so where two walls meet at a corner theirs cross and
// do not lie in one plane.
const BACK_TOP = 2.989;
const FRONT_FOOT = -0.034;
/** How far the upper and lower bundles lean, metres across for each metre down from their tie. */
const LEAN = [0.09, 0.07] as const;
const UPPER = new Clumps("upper", 0.15, 0.32);
const LOWER = new Clumps("lower", 0.16, 0.34, SPAN, -H, [-0.06, 0.05]);

// The wall picture covers a wall from WALL_V0 below its foot, so the lower tips, which hang a little below the floor,
// fall inside it. Below LOWER_TOP it is the lower tier's alone. The lower tier's head, behind the upper skirt, wears
// the picture's row there, so from its head down to its rod the hand's breadth of picture under that row is drawn out.
const WALL_V0 = -0.15;
const LOWER_TOP = 1.28;
const wallV = (y: number): number => (y - WALL_V0) / TILE.thatch;
const wallUv = (shift = 0, top = WALL_V0 + TILE.thatch - 0.005) => (p: Vec): Uv => [(p[0] + H) / TILE.thatch, wallV(Math.min(p[1] - shift, top))];
const lowerUv = wallUv(0, LOWER_TOP);
/** Inside, the lower tier wears its own body squeezed to fit, clear of the tips at either end. */
const innerUv = (p: Vec): Uv => lowerUv([p[0], 0.4 + ((Math.min(Math.max(p[1], -0.03), 1.82) + 0.03) * 0.85) / 1.85, p[2]]);
const postPinch = (x: number): number => 0.5 + 0.5 * smooth(Math.min(Math.abs(x + H), Math.abs(x - H)) / 0.18);

/** The scripts' rows of each tier, of which a level takes those it draws. */
const UPPER_ROWS = { top: [2.985, 0.03, 0.006], rod: [UPPER_ROD, 0.042, 0.006], belly: [2.4, 0.05, 0.05], last: [1.66, 0.066, 0.085] } as const;
const LOWER_ROWS = { top: [1.82, 0.024, 0.004], rod: [LOWER_ROD, 0.04, 0.006], belly: [0.98, 0.046, 0.05], last: [0.24, 0.062, 0.085] } as const;
// The upper tier's back stands 4 mm behind the lower one's, so it is not in one plane with the foot of a wall stood on this one.
const HEAD_BACK = -0.026;
const UPPER_BACK = [[BACK_TOP, HEAD_BACK], [1.86, HEAD_BACK], [1.72, 0.03], [1.66, 0.044]] as const;
const LOWER_BACK = [[1.82, BACK_Z], [-0.03, BACK_Z]] as const;
/** Behind the lower tips the wall stands this far out, solid down to the floor: what shows between them. */
const CORE_Z = 0.02;
const row = (r: readonly [number, number, number], cut: Row["cut"]): Row => ({ y: r[0], z: r[1], swell: r[2], cut });

/** The two tiers across each of `spans`, the upper one's skirt hung over the lower one's head. */
function wallTiers(hut: Hut, level: number, spans: readonly (readonly [number, number, (x: number) => number])[]): void {
  const fine = level === 0;
  const lower = { clumps: LOWER, foot: LOWER_FOOT, flare: 0.05, tuft: 0.1, feet: 4, lean: [LOWER_ROD, LEAN[1]], uv: lowerUv, uvBack: innerUv, mats: [BODY, TIPS] } as const;
  // The lower tier's body wears its own picture just over its tips wherever it is seen edge on or from behind them.
  const solid = (p: Vec): Uv => lowerUv([p[0], LOWER_ROWS.last[0] + 0.03, p[2]]);
  for (const [x0, x1, pinch] of spans) {
    // Past the first level the lower tier is one slab that leans as its bundles did, its tips drawn whole down to their mean foot.
    if (fine) tier(hut, { ...lower, x0, x1, pinch, tips: "skirt", back: [...LOWER_BACK, [FRONT_FOOT, CORE_Z, solid], [LOWER_ROWS.last[0], CORE_Z, solid]], rows: [row(LOWER_ROWS.top, "ends"), row(LOWER_ROWS.rod, "full"), row(LOWER_ROWS.belly, "full"), row(LOWER_ROWS.last, "full")] });
    else tier(hut, { ...lower, x0, x1, pinch, tips: "none", plain: true, back: LOWER_BACK, rows: [row(LOWER_ROWS.top, "ends"), row(LOWER_ROWS.rod, "ends"), row(LOWER_ROWS.last, "ends"), row([FRONT_FOOT, LOWER_ROWS.last[1] + 0.05 + 0.9 * LOWER_ROWS.last[2], 0], "ends")] });
    tier(hut, {
      clumps: UPPER, x0, x1, pinch, foot: UPPER_FOOT, flare: 0.06, tuft: 0.13, feet: fine ? 4 : 2, lean: [UPPER_ROD, LEAN[0]], uv: wallUv(), mats: [BODY, TIPS], tips: fine ? "ends" : "skirt", back: UPPER_BACK,
      rows: fine ? [row(UPPER_ROWS.top, "ends"), row(UPPER_ROWS.rod, "full"), row(UPPER_ROWS.belly, "full"), row(UPPER_ROWS.last, "full")] : [row(UPPER_ROWS.top, "ends"), row(UPPER_ROWS.rod, "edges"), row(UPPER_ROWS.last, "full")],
    });
  }
}

/** How a level draws each kind of pole of a wall, and how many sides its cord has. Null is not drawn. */
interface FrameLook {
  post: Drawn | null;
  inner: Drawn | null;
  rod: Drawn | null;
  rail: Drawn | null;
  /** The rails at a wall's foot and head, which nothing is tied to. */
  sill: Drawn | null;
  jamb: Drawn | null;
  stick: Drawn | null;
  cord: boolean;
  /** Whether the cord that ties a rail inside to its rod is drawn. */
  tie: boolean;
}

const WALL_LOOKS: readonly FrameLook[] = [
  { post: {}, inner: { along: 0 }, rod: { sides: 6, along: 0 }, rail: { along: 0 }, sill: { along: 0 }, jamb: {}, stick: {}, cord: true, tie: true },
  { post: { plain: true, sides: 6 }, inner: { plain: true, sides: 4, along: 0 }, rod: { plain: true, sides: 3, along: 0 }, rail: { plain: true, sides: 3, along: 0 }, sill: null, jamb: { plain: true, sides: 6 }, stick: { plain: true, sides: 3 }, cord: false, tie: false },
  { post: { plain: true, sides: 4 }, inner: null, rod: null, rail: null, sill: null, jamb: { plain: true, sides: 4 }, stick: null, cord: false, tie: false },
];

function rods(hut: Hut, rng: PyRandom, look: FrameLook, x0: number, x1: number, heights: readonly number[]): void {
  for (const y of heights) {
    const sag = rng.uniform(0.008, 0.016);
    const rise = rng.uniform(-0.012, 0.012);
    drawPole(hut, poleOf(rng, [x0, y, ROD_Z], [x1, y + rise, ROD_Z + 0.004], ROD_R, ROD_R * 0.82, { band: "stick", bow: sag, bowDir: [0, -1, 0.15], segments: 5 }), look.rod);
    const n = Math.max(1, roundEven((x1 - x0) / 1.0));
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * (k + 0.5)) / n + rng.uniform(-0.08, 0.08);
      drawCord(hut, cordOf(rng, [x, y - sag * 0.9, ROD_Z], [1, 0.02, 0], ROD_R + 0.009, 0.045), look.cord ? ROD_R : null);
    }
  }
}

function rails(hut: Hut, rng: PyRandom, look: FrameLook, x0: number, x1: number, heights: readonly number[]): void {
  for (const y of heights) {
    const rise = rng.uniform(-0.008, 0.008);
    const bow = rng.uniform(0.004, 0.01);
    const tied = y === LOWER_ROD || y === UPPER_ROD;
    drawPole(hut, poleOf(rng, [x0, y, RAIL_Z], [x1, y + rise, RAIL_Z], RAIL_R, RAIL_R * 0.9, { band: "peeled", bow, bowDir: [0, 0, -1], caps: ["flat", "flat"], segments: 4 }), tied ? look.rail : look.sill);
    if (!tied) continue;
    // Where the rod outside is tied through the thatch to the rail inside.
    const n = Math.max(1, roundEven((x1 - x0) / 0.75));
    for (let k = 0; k < n; k++) {
      const x = x0 + ((x1 - x0) * (k + 0.5)) / n + rng.uniform(-0.06, 0.06);
      drawCord(hut, cordOf(rng, [x, y, RAIL_Z], [1, 0.03, 0], RAIL_R + 0.008, 0.04), look.tie ? RAIL_R * 0.95 : null);
    }
  }
}

/** The post at the wall's left end, proud of the thatch outside, and a lighter one inside that the rails meet. */
function cornerPost(hut: Hut, rng: PyRandom, look: FrameLook): void {
  drawPole(hut, poleOf(rng, [POST_X, -0.02, POST_Z], [POST_X + 0.008, 2.94, POST_Z - 0.006], POST_R[0], POST_R[1], { band: "bark", bow: 0.014, bowDir: [0.3, 0, 1], caps: ["flat", "axe"], segments: 6 }), look.post);
  for (const y of [UPPER_ROD, LOWER_ROD]) drawCord(hut, cordOf(rng, [POST_X + 0.004, y + 0.012, POST_Z], [0.06, 1, 0], POST_R[1] + 0.012, 0.09), look.cord ? (POST_R[0] + POST_R[1]) / 2 : null);
  drawPole(hut, poleOf(rng, [-H + 0.03, -0.01, INNER_Z], [-H + 0.036, 2.95, INNER_Z], 0.058, 0.05, { band: "bark", bow: 0.01, bowDir: [1, 0, -0.4], caps: ["flat", "axe"], segments: 5 }), look.inner);
  // The inner post's bow carries it a millimetre over the wall's yield ring: it and its cord are left whole there.
  for (const y of [LOWER_ROD, UPPER_ROD]) drawCord(hut, cordOf(rng, [-H + 0.033, y, INNER_Z], [0.002, 1, 0], 0.064, 0.08), look.cord ? 0.054 : null, 0);
}

/** The mean a bundle's belly stands out past its row, and how far out its tips hang, for a level that draws no bundles. */
const BELLY = 0.05;
const HEM = 0.1;

/**
 * Both tiers from x0 to x1 as one slab whose section is the wall's: each tier out to its foot, the upper skirt over
 * the lower one's head. The tips are drawn whole with it, since nothing of their raggedness shows from so far.
 */
function slab(hut: Hut, x0: number, x1: number, over: number | null, textured: boolean, tied = true): void {
  type Corner = readonly [number, number, (p: Vec) => Uv];
  const upper = wallUv(over === null ? 0 : over - UPPER_FOOT);
  const foot = over ?? UPPER_FOOT;
  const [out, low] = [UPPER_ROWS.last[1] + HEM, LOWER_ROWS.last[1] + HEM];
  // The upper tier's front from the top down to its foot, then the lower tier's from under the skirt, and the back.
  let chain: Corner[] = [[2.985, 0.03, upper], [foot, out, upper]];
  let under: Corner[] = [[foot, 0.035, lowerUv], [FRONT_FOOT, low, lowerUv], [-0.03, BACK_Z, upper]];
  if (textured && over === null) {
    // Each tier is drawn in at its rod, but for a doorway's narrow sides, which have no triangles to spare for it.
    chain = [[2.985, 0.03, upper], ...(tied ? [[UPPER_ROD, 0.045, upper] as Corner] : []), [UPPER_ROWS.last[0], UPPER_ROWS.last[1] + BELLY, upper], [foot, out, upper]];
    under = [[foot, 0.035, lowerUv], ...(tied ? [[LOWER_ROD, 0.043, lowerUv] as Corner] : []), [LOWER_ROWS.last[0], LOWER_ROWS.last[1] + BELLY, lowerUv], [FRONT_FOOT, low, lowerUv], [-0.03, BACK_Z, innerUv], [1.82, BACK_Z, upper]];
  } else if (over !== null) {
    chain = [[2.985, 0.03, upper], [over + 0.26, UPPER_ROWS.last[1] + BELLY, upper], [foot, out, upper]];
    under = [[foot, 0.044, upper]];
  }
  const ring: Corner[] = [...chain, ...under, [BACK_TOP, HEAD_BACK, upper]];
  const fronts = chain.length - 1;
  const groups = [hut.shape.group(), hut.shape.group()];
  const patches: Patch[] = ring.map((a, k) => {
    const b = ring[(k + 1) % ring.length]!;
    // A face wears the picture of the corner it leaves, but for the one that turns under the skirt.
    const uv = k === fronts ? b[2] : a[2];
    const points: Vec[] = [[x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]]];
    const round = k < fronts ? groups[0] : textured && over === null && k > fronts && k <= fronts + (tied ? 3 : 2) ? groups[1] : undefined;
    return { points, uvs: textured ? points.map(uv) : points.map(NO_UV), mat: BODY, ...(round === undefined ? {} : { group: round }) };
  });
  for (const x of [x0, x1]) {
    const points = ring.map((c): Vec => [x, c[0], c[1]]);
    patches.push({ points, uvs: textured ? points.map((p) => upper([p[0], Math.max(p[1], foot + 0.3), p[2]])) : points.map(NO_UV), mat: BODY });
  }
  hut.solid(patches);
}

function wall(level: number): Shape | null {
  if (level > 4) return null;
  const hut = new Hut(WALL_H / 2);
  if (level === 4) {
    hut.box([-H, 0, BACK_Z], [H, WALL_H - 0.015, 0.12], BODY, NO_UV);
    return hut.shape;
  }
  if (level >= 2) {
    slab(hut, -H, H, null, level === 2);
    if (level === 3) return hut.shape;
  } else wallTiers(hut, level, [[-H, H, postPinch]]);
  const rng = new PyRandom("wall0");
  const look = WALL_LOOKS[level]!;
  cornerPost(hut, rng, look);
  rods(hut, rng, look, -H, H, [UPPER_ROD, LOWER_ROD]);
  rails(hut, rng, look, -H, H, RAILS);
  return hut.shape;
}

// The doorframe -------------------------------------------------------------------------------------------------------

const DOOR_W = 1.4;
const DOOR_H = 2.3125;
const JAMB_R = 0.075;
const JAMB_X = DOOR_W / 2 + JAMB_R + 0.002;
const JAMB_Z = 0.03;
const LINTEL_R = 0.07;
const LINTEL_Y = DOOR_H + LINTEL_R + 0.004;
const LINTEL_Z = 0.05;
const OVER_FOOT = DOOR_H + 0.09;

function doorframe(level: number): Shape | null {
  if (level > 4) return null;
  const hut = new Hut(WALL_H / 2);
  const edge = JAMB_X - 0.03;
  if (level === 4) {
    hut.box([-H, 0, BACK_Z], [H, WALL_H - 0.015, 0.12], BODY, NO_UV);
    return hut.shape;
  }
  if (level === 3) {
    // The wall either side of the doorway and over it, in one piece.
    const outline: [number, number][] = [[-H, 0], [-edge, 0], [-edge, DOOR_H], [edge, DOOR_H], [edge, 0], [H, 0], [H, WALL_H - 0.015], [-H, WALL_H - 0.015]];
    const face = (z: number): Patch => ({ points: outline.map(([x, y]): Vec => [x, y, z]), uvs: outline.map(NO_UV), mat: BODY });
    hut.solid([face(0.12), face(BACK_Z), ...outline.map((a, k): Patch => {
      const b = outline[(k + 1) % outline.length]!;
      return { points: [[a[0], a[1], BACK_Z], [b[0], b[1], BACK_Z], [b[0], b[1], 0.12], [a[0], a[1], 0.12]], uvs: [0, 1, 2, 3].map(NO_UV), mat: BODY };
    })]);
    return hut.shape;
  }
  const sidePinch = (x: number): number => 0.5 + 0.5 * smooth(Math.min(Math.abs(x + H), Math.abs(x - H), Math.abs(Math.abs(x) - JAMB_X)) / 0.16);
  const shift = OVER_FOOT - UPPER_FOOT;
  if (level === 2) {
    slab(hut, -H, -edge, null, true, false);
    slab(hut, edge, H, null, true, false);
    slab(hut, -edge - 0.04, edge + 0.04, OVER_FOOT, true);
  } else {
    wallTiers(hut, level, [[-H, -edge, sidePinch], [edge, H, sidePinch]]);
    // Over the doorway: the upper tier alone, cut short, its foot hanging just over the lintel, seen from inside too.
    // Its picture is moved down so that its foot wears the upper tier's foot.
    tier(hut, {
      clumps: UPPER, x0: -edge - 0.04, x1: edge + 0.04, pinch: sidePinch, foot: OVER_FOOT, flare: 0.05, tuft: 0.13, feet: level === 0 ? 4 : 2, lean: [UPPER_ROD, LEAN[0]], uv: wallUv(shift), mats: [BODY, TIPS], tips: level === 0 ? "open" : "skirt",
      rows: [row(UPPER_ROWS.top, "edges"), row([OVER_FOOT + 0.26, UPPER_ROWS.last[1], UPPER_ROWS.last[2]], "full")], back: [[BACK_TOP, HEAD_BACK], [OVER_FOOT + 0.26, 0.044]],
    });
  }
  const rng = new PyRandom("doorframe0");
  const look = DOOR_LOOKS[level]!;
  cornerPost(hut, rng, look);
  for (const s of [-1, 1]) {
    const x = s * JAMB_X;
    drawPole(hut, poleOf(rng, [x, -0.01, JAMB_Z], [x + s * 0.006, 2.94, JAMB_Z], JAMB_R, JAMB_R * 0.9, { band: "bark", bow: 0.008, bowDir: [s, 0, 0.5], caps: ["flat", "axe"], segments: 5 }), look.jamb);
    // A second, thinner pole beside each jamb, as the doorway is built doubled.
    const x2 = s * (JAMB_X + JAMB_R + 0.04);
    drawPole(hut, poleOf(rng, [x2, -0.01, JAMB_Z + 0.03], [x2 - s * 0.01, 2.6, JAMB_Z + 0.03], 0.042, 0.036, { band: "stick", bow: 0.01, bowDir: [s, 0, 1], caps: ["flat", "axe"], segments: 4 }), look.stick);
    drawCord(hut, cordOf(rng, [x + s * 0.004, LINTEL_Y, JAMB_Z], [0.02 * s, 1, 0], JAMB_R * 0.95 + 0.01, 0.16), look.cord ? JAMB_R * 0.92 : null);
    const inner = JAMB_X + 0.07;
    rods(hut, rng, look, s < 0 ? -H : inner, s < 0 ? -inner : H, [UPPER_ROD, LOWER_ROD]);
    rails(hut, rng, look, s < 0 ? -H : JAMB_X, s < 0 ? -JAMB_X : H, RAILS.slice(0, 3));
  }
  drawPole(hut, poleOf(rng, [-JAMB_X - 0.22, LINTEL_Y + 0.01, LINTEL_Z], [JAMB_X + 0.2, LINTEL_Y - 0.008, LINTEL_Z], LINTEL_R, LINTEL_R * 0.88, { band: "bark", bow: 0.012, bowDir: [0, 1, 0], segments: 5 }), look.jamb);
  rails(hut, rng, look, -H, H, RAILS.slice(3));
  return hut.shape;
}

/** A doorway has twice a wall's poles in the same budget: its short rods and rails are drawn with fewer sides and rings, and its rails without their ties. */
const DOOR_LOOKS: readonly FrameLook[] = [
  { post: {}, inner: { sides: 6, along: 0 }, rod: { sides: 6, rings: [0, 2, 4], along: 0 }, rail: { sides: 6, rings: [0, 3], along: 0 }, sill: { sides: 6, rings: [0, 3], along: 0 }, jamb: {}, stick: { sides: 6 }, cord: true, tie: false },
  WALL_LOOKS[1]!,
  { ...WALL_LOOKS[2]!, jamb: { plain: true, sides: 3 } },
];

// The door ------------------------------------------------------------------------------------------------------------

const D_STILE = DOOR_W / 2 - 0.045;
const D_FRAME_Z = 0.022;
const D_FRAME_R = 0.028;
/** The door picture holds the outside face on its left half and the inside face on its right. */
const doorUv = (front: boolean) => (p: Vec): Uv => (front ? [(p[0] + DOOR_W / 2 + 0.05) / TILE.door, (p[1] + 0.3) / TILE.door] : [(DOOR_W / 2 - p[0] + 1.55) / TILE.door, (p[1] + 0.3) / TILE.door]);
/** Where the door picture's reeds are whole: below and above, their ends are cut out. */
const MAT_SOLID = [0.108, 2.26] as const;

function door(level: number, opened: boolean): Shape | null {
  if (level > 3) return null;
  const hut = new Hut(DOOR_H / 2, opened);
  if (level === 3) {
    hut.box([-DOOR_W / 2, 0.01, -0.035], [DOOR_W / 2, DOOR_H - 0.01, 0.045], "door_solid", NO_UV);
    return hut.shape;
  }
  // The reed infill: a mat of upright reeds, flat but for its picture, its ends ragged top and bottom.
  const [x0, x1] = [-DOOR_W / 2 + 0.02, DOOR_W / 2 - 0.02];
  const [z0, z1] = [-0.03, 0.012];
  const [top, bottom] = [DOOR_H - 0.03, 0.03];
  const ys = level === 2 ? [bottom + 0.02, top] : [bottom, MAT_SOLID[0], MAT_SOLID[1], top];
  const patches: Patch[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const mat = level < 2 && k !== 1 ? "door" : "door_solid";
    for (const [z, front] of [[z1, true], [z0, false]] as const) {
      const points: Vec[] = [[x0, ys[k]!, z], [x1, ys[k]!, z], [x1, ys[k + 1]!, z], [x0, ys[k + 1]!, z]];
      patches.push({ points, uvs: points.map(doorUv(front)), mat });
    }
    for (const x of [x0, x1]) {
      const points: Vec[] = [[x, ys[k]!, z0], [x, ys[k]!, z1], [x, ys[k + 1]!, z1], [x, ys[k + 1]!, z0]];
      // An edge wears the reeds beside it, clear of the cut-out ends.
      patches.push({ points, uvs: points.map((p) => doorUv(true)([p[0], Math.min(Math.max(p[1], MAT_SOLID[0] + 0.01), MAT_SOLID[1] - 0.01), p[2]])), mat: "door_solid" });
    }
  }
  for (const y of [ys[0]!, ys[ys.length - 1]!]) {
    const points: Vec[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
    patches.push({ points, uvs: points.map((p) => doorUv(true)([p[0], y < 1 ? MAT_SOLID[0] + 0.01 : MAT_SOLID[1] - 0.01, p[2]])), mat: "door_solid" });
  }
  hut.solid(patches);
  const rng = new PyRandom("door0");
  const stick: Drawn | null = level === 0 ? { sides: 6 } : { plain: true, sides: 3 };
  // From across a yard the battens inside are too thin to show.
  const batten = level === 2 ? null : stick;
  const cord = level === 0;
  // The frame on the outside face: two stiles, three rails, and a brace from the hinge side's foot up.
  for (const s of [-1, 1]) drawPole(hut, poleOf(rng, [s * D_STILE, 0.02, D_FRAME_Z], [s * D_STILE, DOOR_H - 0.02, D_FRAME_Z], D_FRAME_R, D_FRAME_R * 0.9, { band: "stick", segments: 4 }), stick);
  for (const y of [0.11, 1.18, DOOR_H - 0.11]) {
    const rise = rng.uniform(-0.01, 0.01);
    drawPole(hut, poleOf(rng, [-DOOR_W / 2 + 0.01, y, D_FRAME_Z + 0.008], [DOOR_W / 2 - 0.01, y + rise, D_FRAME_Z + 0.008], D_FRAME_R * 0.92, D_FRAME_R * 0.85, { band: "stick", segments: 4 }), stick);
  }
  drawPole(hut, poleOf(rng, [-D_STILE + 0.04, 0.16, D_FRAME_Z + 0.004], [D_STILE - 0.05, DOOR_H - 0.17, D_FRAME_Z + 0.004], 0.024, 0.022, { band: "stick", segments: 3 }), stick);
  for (const x of [-D_STILE, D_STILE]) {
    for (const y of [0.11, 1.18, DOOR_H - 0.11]) drawCord(hut, cordOf(rng, [x - 0.045 * (x > 0 ? 1 : -1), y, D_FRAME_Z + 0.008], [1, 0, 0], D_FRAME_R + 0.006, 0.04), cord ? D_FRAME_R * 0.9 : null);
  }
  // Cord loops on the hinge side, and a loop of cord to pull it by.
  for (const y of [0.42, DOOR_H - 0.42]) drawCord(hut, cordOf(rng, [-D_STILE, y, D_FRAME_Z], [0, 1, 0], D_FRAME_R + 0.012, 0.06), cord ? D_FRAME_R : null);
  drawCord(hut, cordOf(rng, [D_STILE, 1.05, D_FRAME_Z], [0, 1, 0], D_FRAME_R + 0.01, 0.09), cord ? D_FRAME_R : null);
  // Inside, two battens across the reeds where the picture has them twined, tied through to the frame.
  for (const y of [0.48, 1.67]) {
    const rise = rng.uniform(-0.01, 0.01);
    drawPole(hut, poleOf(rng, [-D_STILE + 0.03, y, -0.046], [D_STILE - 0.03, y + rise, -0.046], 0.018, 0.016, { band: "stick", segments: 3 }), batten);
    for (const x of [-D_STILE + 0.08, 0, D_STILE - 0.08]) {
      const off = rng.uniform(-0.03, 0.03);
      drawCord(hut, cordOf(rng, [x + off, y, -0.046], [1, 0, 0], 0.026, 0.03), cord ? 0.018 : null);
    }
  }
  return hut.shape;
}

// The ceiling ---------------------------------------------------------------------------------------------------------

const FLOOR_T = 0.25;
const C_TOP = FLOOR_T / 2;
const JOIST_R = 0.05;
const JOIST_Y = -C_TOP + JOIST_R;
const JOISTS = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25] as const;
const MAT_Y = -C_TOP + 2 * JOIST_R - 0.005;
const EAVE = 0.29;
/** An eave's root stands this far inside the edge, and its body of solid reed reaches this far from its root. */
const EAVE_ROOT = H - 0.06;
const EAVE_BODY = 0.14;
const roofUv = (p: Vec): Uv => [(p[0] + H) / TILE.roof, (p[2] + H) / TILE.roof];
/** An eave's tips hang this far out past its lip and fall this far, a little past the scripts' foot, which was ragged. */
const EAVE_HANG = EAVE - EAVE_BODY + 0.07;
const EAVE_FALL = (0.14 * EAVE_HANG) / (EAVE - EAVE_BODY);
/**
 * An eave's tips wear the wall picture's lower tips, which end in nothing, from a little way up in solid reed: `down`
 * is 0 at the lip and 1 at their end. The upper skirt's tips, which the scripts gave them, end against the lower tier's
 * picture, and needed the ragged foot cut in the mesh.
 */
const eaveTipUv = (x: number, down: number): Uv => [(x + H) / TILE.thatch, wallV(0.33 - down * 0.36)];

/** The value at x of the line through (xs, ys), held level past either end. */
function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
  return ys[ys.length - 1]!;
}

/**
 * The thatch along one edge of a ceiling: the roof's reed run on over the edge and drooping, and from its lip a
 * skirt of tips, cut out. `side` is 0 to 3 for +z, +x, -z and -x. Past the panel's corners it reaches less far and
 * bends down, so where two meet the corner is rounded.
 */
function eave(hut: Hut, side: number): void {
  const turn = (side * Math.PI) / 2;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const xs = [-H - 0.75 * EAVE, -H - 0.36 * EAVE, -H, H, H + 0.36 * EAVE, H + 0.75 * EAVE];
  // An eave's own (x along the edge, reach out from its root, height), turned to its side of the ceiling.
  const place = (x: number, reach: number, height: number): Vec => {
    const past = Math.max(0, Math.abs(x) - H);
    const r = reach * (1 - 0.95 * smooth(past / (0.75 * EAVE)));
    const zz = EAVE_ROOT + r;
    return [x * c + zz * s, height - interp(past, [0, 0.07, EAVE_BODY, EAVE], [0, 0.028, 0.088, 0.21]), -x * s + zz * c];
  };
  // The reed runs out over the edge on every side, so the two sides across wear the roof's picture turned.
  const lipUv = (x: number, reach: number): Uv => [(x + H) / TILE.roof, (EAVE_ROOT + reach + H) / TILE.roof];
  // Its section: the top out to the lip, the lip's cut end, and the underside back to the root.
  const section: readonly (readonly [number, number, number])[] = [[0, C_TOP - 0.012, 0], [0.07, C_TOP - 0.04, 0.07], [EAVE_BODY, C_TOP - 0.1, EAVE_BODY], [EAVE_BODY, MAT_Y - 0.03, EAVE_BODY + 0.1], [0, MAT_Y + 0.02, 2 * EAVE_BODY + 0.1]];
  const rounded = hut.shape.group();
  const patches: Patch[] = [];
  section.forEach((a, k) => {
    const b = section[(k + 1) % section.length]!;
    for (let i = 0; i + 1 < xs.length; i++) {
      const at = [[xs[i]!, a], [xs[i + 1]!, a], [xs[i + 1]!, b], [xs[i]!, b]] as const;
      // The root's face lies inside the roof and wears whatever is there.
      patches.push({ points: at.map(([x, q]) => place(x, q[0], q[1])), uvs: at.map(([x, q]) => lipUv(x, k === section.length - 1 ? 0 : q[2])), mat: "roof", ...(k < 2 ? { group: rounded } : {}) });
    }
  });
  for (const x of [xs[0]!, xs[xs.length - 1]!]) patches.push({ points: section.map((q) => place(x, q[0], q[1])), uvs: section.map((q) => lipUv(x, q[2])), mat: "roof" });
  hut.solid(patches);
  // The tips hang from the lip's top edge, a sheet seen from above and from under the eave.
  const card: Patch[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const at = [[xs[i]!, 0], [xs[i + 1]!, 0], [xs[i + 1]!, 1], [xs[i]!, 1]] as const;
    card.push({ points: at.map(([x, t]) => place(x, EAVE_BODY + t * EAVE_HANG, C_TOP - 0.1 - t * EAVE_FALL)), uvs: at.map(([x, t]) => eaveTipUv(x, t)), mat: TIPS });
  }
  hut.card(card);
}

/**
 * A ceiling past the first level, as one solid: the roof's top, its lip drooping past each edge and cut across at the
 * corners, the tips as the lip's own skirt, and the underside. The tips' back is the underside, which nobody sees
 * from where this is drawn.
 */
function pillow(hut: Hut): void {
  const [topY, lipY, endY] = [C_TOP - 0.012, C_TOP - 0.1, C_TOP - 0.1 - EAVE_FALL];
  const [lip, end] = [EAVE_ROOT + EAVE_BODY, EAVE_ROOT + EAVE_BODY + EAVE_HANG];
  // A side's own (x along the edge, out from the middle), turned to its side of the ceiling.
  const side = (k: number) => {
    const [c, s] = [Math.cos((k * Math.PI) / 2), Math.sin((k * Math.PI) / 2)];
    return { out: (x: number, zz: number, y: number): Vec => [x * c + zz * s, y, -x * s + zz * c], back: (p: Vec): [number, number] => [p[0] * c - p[2] * s, p[0] * s + p[2] * c] };
  };
  const patches: Patch[] = [];
  const roof = (points: Vec[], uv: (p: Vec) => Uv = roofUv): void => void patches.push({ points, uvs: points.map(uv), mat: "roof" });
  const top = [0, 1, 2, 3].map((k) => side(k).out(-H, H, topY));
  const under = [0, 1, 2, 3].map((k) => side(k).out(-H, H, MAT_Y));
  roof(top);
  roof(under);
  for (let k = 0; k < 4; k++) {
    const [here, next] = [side(k), side((k + 1) % 4)];
    // The reed runs out over the edge on every side, so each side wears the roof's picture along its own way out.
    const lipUv = (p: Vec): Uv => [(here.back(p)[0] + H) / TILE.roof, (here.back(p)[1] + H) / TILE.roof];
    const [t0, t1] = [here.out(-H, H, topY), here.out(H, H, topY)];
    const [l0, l1, lNext] = [here.out(-H, lip, lipY), here.out(H, lip, lipY), next.out(-H, lip, lipY)];
    // The tips draw in toward a corner, as the first level's eaves tuck in there.
    const [e0, e1, eNext] = [here.out(-H + 0.12, end, endY), here.out(H - 0.12, end, endY), next.out(-H + 0.12, end, endY)];
    roof([t0, t1, l1, l0], lipUv);
    roof([t1, lNext, l1], lipUv);
    const tips = (points: Vec[], down: readonly number[]): void => void patches.push({ points, uvs: points.map((p, i) => eaveTipUv(here.back(p)[0], down[i]!)), mat: TIPS });
    tips([l0, l1, e1, e0], [0, 0, 1, 1]);
    tips([l1, lNext, eNext, e1], [0, 0, 1, 1]);
    roof([e0, e1, here.out(H, H, MAT_Y), here.out(-H, H, MAT_Y)]);
    roof([e1, eNext, here.out(H, H, MAT_Y)]);
  }
  hut.solid(patches);
}

function ceiling(level: number): Shape | null {
  if (level > 3) return null;
  const hut = new Hut(0);
  if (level === 3) {
    hut.box([-H, -C_TOP + 0.01, -H], [H, C_TOP, H], "roof", NO_UV);
    return hut.shape;
  }
  if (level === 2) {
    // The roof's top, its eaves drooping out past it and cut across at the corners, and one flat underside.
    const [r, cut, low] = [H + 0.24, 0.22, C_TOP - 0.23];
    const top: Vec[] = [[-H, C_TOP, -H], [H, C_TOP, -H], [H, C_TOP, H], [-H, C_TOP, H]];
    const ring: Vec[] = [[-r + cut, low, -r], [r - cut, low, -r], [r, low, -r + cut], [r, low, r - cut], [r - cut, low, r], [-r + cut, low, r], [-r, low, r - cut], [-r, low, -r + cut]];
    const patches: Patch[] = [{ points: top, uvs: top.map(roofUv), mat: "roof" }, { points: [...ring].reverse(), uvs: [...ring].reverse().map(roofUv), mat: "roof" }];
    for (let k = 0; k < 4; k++) {
      const [a, b] = [top[k]!, top[(k + 1) % 4]!];
      for (const points of [[a, b, ring[2 * k + 1]!, ring[2 * k]!], [b, ring[(2 * k + 2) % 8]!, ring[2 * k + 1]!]]) patches.push({ points, uvs: points.map(roofUv), mat: "roof" });
    }
    hut.solid(patches);
    return hut.shape;
  }
  if (level === 1) pillow(hut);
  else {
    // The body: thatch between the mat over the joists and the top. The top is laid in courses half a metre wide,
    // each a centimetre thicker at its butts than where the next covers it, so from above it shows its rows.
    const zs: [number, number][] = [[-H, C_TOP - 0.012]];
    for (let k = 0; k < 6; k++) zs.push([-1.25 + 0.5 * k, C_TOP - 0.006], [-1.25 + 0.5 * k + 0.47, C_TOP - 0.019]);
    zs.push([H, C_TOP - 0.012]);
    const patches: Patch[] = [];
    const quad = (points: Vec[]): void => void patches.push({ points, uvs: points.map(roofUv), mat: "roof" });
    for (let i = 0; i + 1 < zs.length; i++) quad([[-H, zs[i]![1], zs[i]![0]], [-H, zs[i + 1]![1], zs[i + 1]![0]], [H, zs[i + 1]![1], zs[i + 1]![0]], [H, zs[i]![1], zs[i]![0]]]);
    quad([[-H, MAT_Y, -H], [H, MAT_Y, -H], [H, MAT_Y, H], [-H, MAT_Y, H]]);
    for (const x of [-H, H]) quad([...zs.map(([z, y]): Vec => [x, y, z]), [x, MAT_Y, H], [x, MAT_Y, -H]]);
    for (const z of [-H, H]) quad([[-H, MAT_Y, z], [H, MAT_Y, z], [H, C_TOP - 0.012, z], [-H, C_TOP - 0.012, z]]);
    hut.solid(patches);
    for (let side = 0; side < 4; side++) eave(hut, side);
  }
  // The joists under the mat, their ends showing past two edges, and the edge beams along the other two, which the
  // eaves hide from further off.
  const rng = new PyRandom("ceiling0");
  const [joist, beam]: [Drawn, Drawn | null] = level === 0 ? [{ along: 0 }, { along: 0 }] : [{ plain: true, sides: 3, along: 0 }, null];
  for (const z of JOISTS) {
    const [dy, dz] = [rng.uniform(-0.004, 0.004), rng.uniform(-0.02, 0.02)];
    drawPole(hut, poleOf(rng, [-H - 0.12, JOIST_Y + dy, z + dz], [H + 0.12, JOIST_Y, z], JOIST_R, JOIST_R * 0.88, { band: "bark", bow: 0.01, bowDir: [0, 1, 0], segments: 5, sides: 6 }), joist);
  }
  for (const s of [-1, 1]) drawPole(hut, poleOf(rng, [-H + 0.06, JOIST_Y - 0.002, s * (H - 0.06)], [H - 0.06, JOIST_Y, s * (H - 0.06)], 0.055, 0.05, { band: "bark", caps: ["flat", "flat"], segments: 4, sides: 6 }), beam);
  return hut.shape;
}

// The foundation ------------------------------------------------------------------------------------------------------

const FOUND_T = 0.375;
const F_TOP = FOUND_T / 2;
const LOG_R = 0.075;
const LOG_IN = H - LOG_R - 0.005;
const TOP_LOG_Y = F_TOP - LOG_R - 0.012;
const LOW_LOG_Y = -F_TOP + LOG_R;
const floorUv = (p: Vec): Uv => [(p[0] + H) / TILE.floor, (p[2] + H) / TILE.floor];
const earthUv = (p: Vec): Uv => [((Math.abs(p[0]) > Math.abs(p[2]) ? p[2] : p[0]) + H) / TILE.earth, (p[1] + F_TOP) / TILE.earth];

function foundation(level: number): Shape | null {
  if (level > 3) return null;
  const hut = new Hut(0);
  if (level === 3) {
    // Its mats on top and its logs round it.
    hut.box([-H, -F_TOP, -H], [H, F_TOP, H], "wood", NO_UV);
    hut.shape.paint("floor", (middle) => middle[2] > F_TOP - 1e-6);
    return hut.shape;
  }
  // The floor and the packed earth under it: one closed block, its sides set in behind the logs.
  const inset = H - 0.025;
  const [lo, hi] = [-F_TOP + 0.01, F_TOP];
  const square = (half: number, y: number): Vec[] => [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]];
  const [top, mid, low] = [square(H, hi), square(inset, TOP_LOG_Y), square(inset, lo)];
  // Past the first level the earth is hidden behind the logs and is drawn as more floor.
  const under = level === 0 ? "earth" : "floor";
  const patches: Patch[] = [{ points: top, uvs: top.map(floorUv), mat: "floor" }, { points: low, uvs: low.map(level === 0 ? earthUv : floorUv), mat: under }];
  for (let k = 0; k < 4; k++) {
    const b = (k + 1) % 4;
    const rim = [top[k]!, top[b]!, mid[b]!, mid[k]!];
    const side = [mid[k]!, mid[b]!, low[b]!, low[k]!];
    patches.push({ points: rim, uvs: rim.map(floorUv), mat: "floor" }, { points: side, uvs: side.map(level === 0 ? earthUv : floorUv), mat: under });
  }
  hut.solid(patches);
  if (level === 2) {
    // The crib as a rim: each side's two logs one squared block, two of them between the other two.
    for (const s of [-1, 1]) {
      for (const axis of [0, 2]) {
        const at = (along: number, y: number, across: number): Vec => (axis === 0 ? [along, y, across] : [across, y, along]);
        const [a, b] = [s * (H - 2 * LOG_R), s * (H + 0.005)].sort((p, q) => p - q) as [number, number];
        const reach = axis === 0 ? H : H - 2 * LOG_R;
        const [vTop, vBottom] = bandV("bark");
        hut.box(at(-reach, -F_TOP, a), at(reach, TOP_LOG_Y + LOG_R, b), "wood", (p) => [(p[axis]! + H) / TILE.wood, vBottom + ((vTop - vBottom) * (p[1] + F_TOP)) / (2 * F_TOP)]);
      }
    }
    return hut.shape;
  }
  const rng = new PyRandom("foundation0");
  // A straight log is kept a little thin, so its corners stay under the floor's edge.
  const [log, stake, cord]: [Drawn, Drawn, boolean] = level === 0 ? [{}, {}, true] : [{ plain: true, sides: 5, grow: 1.08 }, { plain: true, sides: 3 }, false];
  // Two logs a side, crossing at the corners like a crib, the top ones running past their ends.
  [LOW_LOG_Y, TOP_LOG_Y].forEach((y, layer) => {
    for (const axis of [0, 1]) {
      const reach = H + ((layer + axis) % 2 === 0 ? 0.11 : -0.02);
      for (const s of [-1, 1]) {
        const c = s * LOG_IN;
        const r0 = LOG_R + rng.uniform(-0.006, 0.004);
        const r1 = LOG_R + rng.uniform(-0.012, 0);
        const [a, b]: [Vec, Vec] = axis === 0 ? [[-reach, y, c], [reach, y, c]] : [[c, y, -reach], [c, y, reach]];
        drawPole(hut, poleOf(rng, a, b, r0, r1, { band: "bark", bow: 0.012, bowDir: [0, -1, 0], segments: 5 }), log);
      }
    }
  });
  // Stakes driven in outside the logs and lashed to both: a stout one at the corner each side starts from, going
  // round, and two lighter ones along it.
  for (let side = 0; side < 4; side++) {
    const a = (Math.PI / 2) * side;
    const start = [-H * Math.cos(a) + H * Math.sin(a), -H * Math.cos(a) - H * Math.sin(a)] as const;
    const along = [Math.cos(a), Math.sin(a)] as const;
    const out = [along[1], -along[0]] as const;
    const second = 1.0 + rng.uniform(-0.08, 0.08);
    const third = 2.0 + rng.uniform(-0.08, 0.08);
    for (const [d, r] of [[0.05, 0.056], [second, 0.044], [third, 0.044]] as const) {
      const x = start[0] + along[0] * d + out[0] * (r - 0.012);
      const z = start[1] + along[1] * d + out[1] * (r - 0.012);
      const head = r > 0.05 ? F_TOP - 0.05 : TOP_LOG_Y + LOG_R * 0.7;
      const lean = rng.uniform(-0.01, 0.01);
      drawPole(hut, poleOf(rng, [x, -F_TOP - 0.02, z], [x + lean, head, z], r, r * 0.9, { band: "bark", caps: ["flat", "axe"], segments: 2, sides: 7 }), stake);
      for (const y of [TOP_LOG_Y, LOW_LOG_Y]) drawCord(hut, cordOf(rng, [x, y, z], [0, 1, 0], r + 0.012, 0.07), cord ? r * 0.95 : null);
    }
  }
  return hut.shape;
}

// Each is an entry of the palette (shared/pack/palette.ts), so the nearest entry is the colour itself.
const GOLD = [196, 156, 88] as const;
const STRAW = [192, 148, 97] as const;
const EARTH = [139, 97, 58] as const;
const BARK = [116, 72, 42] as const;

/** The forms thatch is made in: it has no window, pillar or stairs. */
export const THATCH_FORMS = ["foundation", "wall", "doorframe", "ceiling", "door", "door_open"] as const;

/** The pictures each body is drawn whole with: a material of the tier's bake that names its cut-out twin's textures. */
export const THATCH_SOLIDS: Readonly<Record<string, string>> = { thatch_solid: "thatch", door_solid: "door" };

export const THATCH: TierRecipe = {
  name: "thatch",
  rank: 0,
  runPost: true,
  jointHalf: 0.15,
  tones: { thatch: GOLD, thatch_solid: GOLD, door: GOLD, door_solid: GOLD, roof: GOLD, floor: STRAW, earth: EARTH, wood: BARK },
  split(name, form, level) {
    // The rows are the scripts', drawn for a 3 m wall with a 1.4 by 2.3125 m doorway: a form of another size has no thatch yet.
    const [u0, v0, u1, v1] = outlineBox(form);
    const fits = (wide: number, high: number): boolean => Math.abs(u1 - u0 - wide) < 1e-9 && Math.abs(v1 - v0 - high) < 1e-9;
    if (form.layer === "wall" && fits(SPAN, WALL_H) && !form.openings) return wall(level);
    const o = form.openings?.[0];
    if (form.layer === "wall" && fits(SPAN, WALL_H) && form.openings?.length === 1 && o && o.y0 === 0 && Math.abs(o.x1 - o.x0 - DOOR_W) < 1e-9 && Math.abs(o.y1 - DOOR_H) < 1e-9) return doorframe(level);
    if (form.layer === "slab" && form.root === "always" && fits(SPAN, SPAN) && form.thick === FOUND_T) return foundation(level);
    if (form.layer === "slab" && fits(SPAN, SPAN) && form.thick === FLOOR_T && !form.corner && !form.openings) return ceiling(level);
    if (form.layer === "leaf" && fits(DOOR_W, DOOR_H)) return door(level, form.plane === "across");
    throw new Error(`thatch has no recipe for ${name} yet`);
  },
};
