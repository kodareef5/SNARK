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

import { outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import { RoundShape, Shape, add, clip, cross, dot, ears, inset, length, mirror, pathFrames, planeAt, planeMoved, poleRings, railingSticks, retile, rimStrips, roundEven, scale, slabOn, sub, unit, uprightPlane, type Flat, type Patch, type Plane, type Uv, type Vec } from "./kit.ts";
import { colliderBox, planOf, type TierRecipe } from "./lod.ts";
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

  /** A solid, or a sheet, given in the kit's own frame. */
  raw(patches: readonly Patch[], sheet = false): void {
    if (sheet) this.shape.card(patches);
    else this.shape.skin(patches);
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

/**
 * The post at the wall's left end, proud of the thatch outside, and a lighter one inside that the rails meet. Without
 * `posts` neither is drawn, and the rest of the wall is cut from the same poles: the corner's joint stands for both.
 */
function cornerPost(hut: Hut, rng: PyRandom, look: FrameLook, posts = true): void {
  const [post, inner, cord] = posts ? [look.post, look.inner, look.cord] : [null, null, false];
  drawPole(hut, poleOf(rng, [POST_X, -0.02, POST_Z], [POST_X + 0.008, 2.94, POST_Z - 0.006], POST_R[0], POST_R[1], { band: "bark", bow: 0.014, bowDir: [0.3, 0, 1], caps: ["flat", "axe"], segments: 6 }), post);
  for (const y of [UPPER_ROD, LOWER_ROD]) drawCord(hut, cordOf(rng, [POST_X + 0.004, y + 0.012, POST_Z], [0.06, 1, 0], POST_R[1] + 0.012, 0.09), cord ? (POST_R[0] + POST_R[1]) / 2 : null);
  drawPole(hut, poleOf(rng, [-H + 0.03, -0.01, INNER_Z], [-H + 0.036, 2.95, INNER_Z], 0.058, 0.05, { band: "bark", bow: 0.01, bowDir: [1, 0, -0.4], caps: ["flat", "axe"], segments: 5 }), inner);
  // The inner post's bow carries it a millimetre over the wall's yield ring: it and its cord are left whole there.
  for (const y of [LOWER_ROD, UPPER_ROD]) drawCord(hut, cordOf(rng, [-H + 0.033, y, INNER_Z], [0.002, 1, 0], 0.064, 0.08), cord ? 0.054 : null, 0);
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

function wall(level: number, posts: boolean): Shape | null {
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
  cornerPost(hut, rng, look, posts);
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

function doorframe(level: number, posts: boolean): Shape | null {
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
  cornerPost(hut, rng, look, posts);
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

/**
 * The ceiling: reed on a mat over six joists between two edge beams, its eaves drooping past every side. With no
 * `eaves` it ends square on its sides, and the client lays `eave_thatch` (`eaveTrim`) along a side that wants one.
 */
function ceiling(level: number, eaves = true): Shape | null {
  if (level > 3) return null;
  const hut = new Hut(0);
  if (level === 3) {
    hut.box([-H, -C_TOP + 0.01, -H], [H, C_TOP, H], "roof", NO_UV);
    return hut.shape;
  }
  if (level === 2 && !eaves) hut.box([-H, C_TOP - 0.23, -H], [H, C_TOP, H], "roof", roofUv);
  else if (level === 2) {
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
  }
  if (level === 2) return hut.shape;
  if (level === 1 && !eaves) hut.box([-H, MAT_Y, -H], [H, C_TOP - 0.012, H], "roof", roofUv);
  else if (level === 1) pillow(hut);
  else {
    // The body: thatch between the mat over the joists and the top. The top is laid in courses half a metre wide,
    // each a centimetre thicker at its butts than where the next covers it, so from above it shows its rows.
    const zs: [number, number][] = [[-H, C_TOP - 0.012]];
    // The last course ends on the side, where it ran 0.22 m past it and back: a fin over the eave's tips.
    for (let k = 0; k < 6; k++) zs.push([-1.25 + 0.5 * k, C_TOP - 0.006], [Math.min(-1.25 + 0.5 * k + 0.47, H), C_TOP - 0.019]);
    zs.push([H, C_TOP - 0.012]);
    const patches: Patch[] = [];
    const quad = (points: Vec[]): void => void patches.push({ points, uvs: points.map(roofUv), mat: "roof" });
    for (let i = 0; i + 1 < zs.length; i++) quad([[-H, zs[i]![1], zs[i]![0]], [-H, zs[i + 1]![1], zs[i + 1]![0]], [H, zs[i + 1]![1], zs[i + 1]![0]], [H, zs[i]![1], zs[i]![0]]]);
    quad([[-H, MAT_Y, -H], [H, MAT_Y, -H], [H, MAT_Y, H], [-H, MAT_Y, H]]);
    for (const x of [-H, H]) quad([...zs.map(([z, y]): Vec => [x, y, z]), [x, MAT_Y, H], [x, MAT_Y, -H]]);
    for (const z of [-H, H]) quad([[-H, MAT_Y, z], [H, MAT_Y, z], [H, C_TOP - 0.012, z], [-H, C_TOP - 0.012, z]]);
    hut.solid(patches);
    for (let side = 0; side < (eaves ? 4 : 0); side++) eave(hut, side);
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

// The forms past the first five ---------------------------------------------------------------------------------------
//
// A pitched roof in three forms, the gable under it in two hands, a low wall and a fence. Each is built from its row's
// own numbers in the kit's frame, x along, y back and z up, and what it shares with a wall is the wall's own.

/** A point of the kit's frame in the Python's axes, which a pole is cut in. */
const py = (p: Vec): Vec => [p[0], p[2], -p[1]];
/** An axis of the kit's frame as the Python's count it. */
const PY_AXIS = [0, 2, 1] as const;

/** Courses to a roof's rise: the roof picture's six rows, one tile up the slope. */
const ROOF_COURSES = 6;
/** How far the tips of the lowest course reach past a low side, measured level, and how far its solid reed does. */
const ROOF_EAVE = 0.3;
const ROOF_LIP = 0.22;
/** A course's thickness over the roof's plane at its butt and at its head, measured upright, and the eave course's at its lip. */
const COURSE_BUTT = 0.05;
const COURSE_HEAD = 0.014;
const EAVE_BUTT = 0.075;
/** The lip's underside lies this far under the plane, and the top course swells to this at the roof's highest contour: half a ridge's roll. */
const LIP_UNDER = 0.06;
const RIDGE_SWELL = 0.045;
const RAFTER_R = 0.048;
const BATTEN_R = 0.022;
/** Level metres up the slope at which a batten lies. */
const BATTENS = [0.3, 0.9, 1.5, 2.1, 2.7] as const;
const EAVES = new Clumps("eave", 0.17, 0.31);

/** One flat face of a roof: its corners in plan, what each side is, and its own axes, along its contours and up its slope. */
interface Slope {
  poly: Flat[];
  kinds: ("eave" | "ridge" | "rake" | "fold")[];
  /** The height of its lowest contour, and metres it rises to a level metre. */
  lo: number;
  g: number;
  up: Flat;
  along: Flat;
  /** Where its lowest contour meets the side of the cell its contours are counted from. */
  o: Flat;
  /** The axis of the kit's frame its contours run along. */
  axis: number;
}

interface Roof {
  plan: Flat[];
  /** The top's height over each corner, about the collider's origin. */
  tops: number[];
  slopes: Slope[];
  fold: number;
  hip: boolean;
  rise: number;
  thick: number;
  /** How far under the top the thatch's underside lies, on the battens. */
  body: number;
}

/** The point of a slope `a` along its contours, `s` level metres up it and `n` upright over its plane. */
const onSlope = (f: Slope, a: number, s: number, n = 0): Vec => [f.o[0] + a * f.along[0] + s * f.up[0], f.o[1] + a * f.along[1] + s * f.up[1], f.lo + s * f.g + n];
const slopeAt = (f: Slope, q: Flat): [number, number] => [(q[0] - f.o[0]) * f.along[0] + (q[1] - f.o[1]) * f.along[1], (q[0] - f.o[0]) * f.up[0] + (q[1] - f.o[1]) * f.up[1]];
/** The upright planes a slope's parts end at: each side's own, an eave's moved out past its tips. */
const slopeSides = (f: Slope): Plane[] => f.poly.map((a, k) => planeMoved(uprightPlane(a, f.poly[(k + 1) % f.poly.length]!), f.kinds[k] === "eave" ? ROOF_EAVE + 0.02 : 0));

/**
 * A roof row as flat faces: one, or two where its four corners are folded on the diagonal through the odd one. Its top
 * is the top of its collider's box: the corner heights where the slab hangs under them, and the slab's thickness
 * over them where it stands on them.
 */
function roofOf(form: FormDef): Roof {
  const plan = planOf(form);
  const most = Math.max(...form.corner!);
  const over = colliderBox(form)[4] - (most - form.at[1]);
  const tops = form.corner!.map((h) => h - form.at[1] + over);
  const n = plan.length;
  const [lo, hi] = [Math.min(...tops), Math.max(...tops)];
  const odd = n === 4 ? tops.findIndex((h, k) => tops.filter((t) => Math.abs(t - h) < 1e-9).length === 1 && tops.filter((t) => Math.abs(t - tops[(k + 1) % n]!) < 1e-9).length === 3) : -1;
  const fold = Math.max(0, odd);
  const lists = odd < 0 ? [plan.map((_, k) => k)] : [[fold, (fold + 1) % n, (fold + 2) % n], [fold, (fold + 2) % n, (fold + 3) % n]];
  const slopes = lists.map((list): Slope => {
    const poly = list.map((k) => plan[k]!);
    const [a, b, c] = [0, 1, 2].map((i): Vec => [poly[i]![0], poly[i]![1], tops[list[i]!]!]);
    const nrm = cross(sub(b, a), sub(c, a));
    const [gx, gy] = [-nrm[0] / nrm[2], -nrm[1] / nrm[2]];
    const g = Math.hypot(gx, gy);
    const up: Flat = [gx / g, gy / g];
    const along: Flat = [up[1], -up[0]];
    const low = poly[list.findIndex((k) => Math.abs(tops[k]! - lo) < 1e-9)]!;
    // Contours are counted from the cell's own side, so a bundle falls in the same place on every face.
    const least = Math.min(...plan.map((q) => q[0] * along[0] + q[1] * along[1]));
    const back = least - (low[0] * along[0] + low[1] * along[1]);
    const kinds = list.map((k, i) => {
      const j = list[(i + 1) % list.length]!;
      if ((j - k + n) % n !== 1) return "fold" as const;
      if (Math.abs(tops[k]! - tops[j]!) > 1e-9) return "rake" as const;
      return Math.abs(tops[k]! - lo) < 1e-9 ? ("eave" as const) : ("ridge" as const);
    });
    return { poly, kinds, lo, g, up, along, o: [low[0] + back * along[0], low[1] + back * along[1]], axis: Math.abs(along[0]) > 0.5 ? 0 : 1 };
  });
  const k = Math.hypot(1, slopes[0]!.g);
  const body = Math.max(0.06, form.thick - 2 * RAFTER_R * k - 2 * BATTEN_R + 0.006);
  return { plan, tops, slopes, fold, hip: odd >= 0 && Math.abs(tops[fold]! - hi) < 1e-9, rise: hi - lo, thick: form.thick, body };
}

/** A corner of a section across a slope: level metres up it and upright over its plane. The side that leaves it may wear its own. */
interface Corner {
  s: number;
  n: number;
  mat?: string;
  uv?: (a: number, s: number, n: number) => Uv;
}

/**
 * A solid along a slope's contours from a0 to a1 whose section is `ring`. A `prism` is the same all the way along and
 * is left whole by a ring across it.
 */
function alongSlope(hut: Hut, f: Slope, a0: number, a1: number, ring: readonly Corner[], mat: string, uv: (a: number, s: number, n: number) => Uv, capUv: (a: number, s: number, n: number) => Uv, prism: boolean): void {
  const more = prism ? { along: f.axis } : {};
  const patches: Patch[] = ring.map((c, k) => {
    const d = ring[(k + 1) % ring.length]!;
    const q = [[a0, c], [a1, c], [a1, d], [a0, d]] as const;
    const map = c.uv ?? uv;
    return { points: q.map(([a, e]) => onSlope(f, a, e.s, e.n)), uvs: q.map(([a, e]) => map(a, e.s, e.n)), mat: c.mat ?? mat, ...more };
  });
  // An end is its section laid in triangles: a stepped section's corners stand over one another.
  const laid = ears(ring.map((c): Flat => [c.s, c.n]));
  for (const a of [a0, a1]) {
    for (let t = 0; t < laid.length; t += 3) {
      const tri = [ring[laid[t]!]!, ring[laid[t + 1]!]!, ring[laid[t + 2]!]!];
      patches.push({ points: tri.map((c) => onSlope(f, a, c.s, c.n)), uvs: tri.map((c) => capUv(a, c.s, c.n)), mat, ...more });
    }
  }
  hut.raw(patches);
}

/** Where a pole from `a` to `b` is cut across by a plane, it shows the grain of its end, about the middle of the cut. */
function endGrain(a: Vec, b: Vec, plane: Plane): (q: Vec) => readonly [string, Uv] {
  const t = (plane[1] - dot(plane[0], a)) / (dot(plane[0], sub(b, a)) || 1);
  const c = add(a, scale(sub(b, a), t));
  // Two ways across that no plane a pole is cut by holds both of.
  const [e1, e2]: [Vec, Vec] = [[1, 0, 0.37], [0, 1, 0.19]];
  return (q) => ["wood", [184 / 2048 + (dot(sub(q, c), e1) * 118) / 2048 / 0.07, 1 - 1915 / 2048 + (dot(sub(q, c), e2) * 118) / 2048 / 0.07]];
}

/** A pole between two points of the kit's frame, cut as the scripts cut theirs. */
function kitPole(rng: PyRandom, a: Vec, b: Vec, r0: number, r1: number, o: PoleOpts = {}): Pole {
  return poleOf(rng, py(a), py(b), r0, r1, { ...o, ...(o.bowDir ? { bowDir: py(o.bowDir) } : {}) });
}

/**
 * The thatch on one slope. Level 0: the eave course, its lip cut bundle by bundle and its tips hanging from it, and
 * the courses over it as one solid whose top steps down at each butt. Level 1: one solid, its top flat and its tips
 * its skirt, down to the slab's underside. Every measure up the slope is a height over the low side, and every thickness is upright, so two slopes
 * agree along any side they share and along a fold.
 */
function thatchOn(hut: Hut, level: number, r: Roof, f: Slope): void {
  const { rise, body } = r;
  const folded = r.slopes.length > 1;
  const eave = f.kinds.includes("eave");
  const sTop = rise / f.g;
  const course = sTop / ROOF_COURSES;
  const spans = f.poly.map((q) => slopeAt(f, q)[0]);
  // A folded slope is built past its fold and cut back to it.
  const [a0, a1] = [Math.min(...spans) - (folded ? ROOF_EAVE + 0.1 : 0), Math.max(...spans) + (folded ? ROOF_EAVE + 0.1 : 0)];
  // One tile of the roof's picture to the rise, a row to a course: a butt's riser takes the part of the row its course's fall leaves.
  const uv = (a: number, s: number, n: number): Uv => [a / TILE.roof, (s * f.g + n) / rise + 1 / 12];
  // A cut side shows the reed end on along the slope.
  const sideUv = (_: number, s: number, n: number): Uv => [0.5 + n / TILE.roof, (s * f.g) / rise + 1 / 12];
  const from = hut.shape.faces.length;
  const nTop = (s: number): number => COURSE_HEAD + ((course - s) * (EAVE_BUTT - COURSE_HEAD)) / (course + ROOF_LIP);
  const nUnder = (s: number): number => -body + ((course - s) * (body - LIP_UNDER)) / (course + ROOF_LIP);
  if (level === 1) {
    // Flat from the top down to the eave course's head, and from there the line an eave's top lies in, whether the slope has one or not.
    const flat = COURSE_BUTT * 0.6;
    const fall = (s: number): number => flat + ((course - s) * (EAVE_BUTT - flat)) / (course + ROOF_LIP);
    const low: Corner[] = eave
      ? [{ s: -ROOF_LIP, n: EAVE_BUTT, mat: TIPS, uv: (a, s) => eaveTipUv(a - H, s < -ROOF_LIP - 1e-6 ? 1 : 0) }, { s: -ROOF_EAVE, n: EAVE_BUTT - 0.19 }, { s: -ROOF_LIP + 0.025, n: nUnder(-ROOF_LIP + 0.025) }]
      : [{ s: 0, n: fall(0) }];
    // Its underside is the slab's own, so its sides are closed and it needs no pole.
    alongSlope(hut, f, a0, a1, [{ s: sTop, n: flat }, { s: course, n: flat }, ...low, { s: 0, n: -r.thick }, { s: sTop, n: -r.thick }], "roof", uv, sideUv, false);
  } else {
    if (eave) {
      const xs = EAVES.columns(a0 - H, a1 - H, 2);
      const reach = (x: number): number => Math.min(ROOF_EAVE - 0.04, ROOF_LIP - EAVES.foot(x, 0, 0.035, 0.008, 0.45));
      const at = (x: number, s: number, n: number): Vec => onSlope(f, x + H, s, n);
      const lipTop = xs.map((x) => at(x, -reach(x), nTop(-reach(x))));
      const lipLow = xs.map((x) => at(x, -reach(x) + 0.025, nUnder(-reach(x) + 0.025)));
      const [b0, b1, u0, u1] = [at(xs[0]!, course, COURSE_HEAD), at(xs.at(-1)!, course, COURSE_HEAD), at(xs[0]!, course, -body), at(xs.at(-1)!, course, -body)];
      const where = (p: Vec): Uv => {
        const [a, s] = slopeAt(f, [p[0], p[1]]);
        return uv(a, s, p[2] - f.lo - s * f.g);
      };
      const face = (points: Vec[], group?: number): Patch => ({ points, uvs: points.map(where), mat: "roof", ...(group === undefined ? {} : { group }) });
      // The top and the underside each lie in one plane, their outer edge the bundles' ends.
      const patches: Patch[] = [face([b0, ...lipTop, b1]), face([u0, ...lipLow, u1]), face([b0, b1, u1, u0]), face([b0, lipTop[0]!, lipLow[0]!, u0]), face([b1, lipTop.at(-1)!, lipLow.at(-1)!, u1])];
      const groups = new Map<number, number>();
      for (let j = 0; j + 1 < xs.length; j++) {
        const [i] = EAVES.at((xs[j]! + xs[j + 1]!) / 2);
        if (!groups.has(i)) groups.set(i, hut.shape.group());
        patches.push(face([lipTop[j]!, lipTop[j + 1]!, lipLow[j + 1]!, lipLow[j]!], groups.get(i)));
      }
      hut.raw(patches);
      // The tips: a sheet to a bundle, hung from the lip's top edge, each as long as its bundle hangs.
      const edges = EAVES.columns(a0 - H, a1 - H, 1);
      const tips: Patch[] = [];
      for (let j = 0; j + 1 < edges.length; j++) {
        const [xa, xb] = [edges[j]!, edges[j + 1]!];
        const [i] = EAVES.at((xa + xb) / 2);
        const fall = 0.17 - 0.5 * EAVES.drop[i]!;
        const end = (x: number): Vec => at(x, -Math.min(ROOF_EAVE, reach(x) + 0.07), nTop(-reach(x)) - fall);
        tips.push({ points: [lipTop[xs.indexOf(xa)]!, lipTop[xs.indexOf(xb)]!, end(xb), end(xa)], uvs: [eaveTipUv(xa, 0), eaveTipUv(xb, 0), eaveTipUv(xb, 1), eaveTipUv(xa, 1)], mat: TIPS });
      }
      hut.raw(tips, true);
    }
    // The courses over the eave's as one solid: each a butt and a fall to its head, and the top one swelling to the ridge.
    const first = eave ? 1 : 0;
    const top: Corner[] = [];
    // The lowest course of a slope with no eave lies as an eave's does over the low side, so the two meet side by side.
    for (let i = first; i < ROOF_COURSES; i++) top.push({ s: i * course, n: i === 0 ? nTop(0) : COURSE_BUTT }, { s: (i + 1) * course, n: COURSE_HEAD });
    top.splice(-1, 1, { s: sTop - 0.26, n: COURSE_HEAD + (0.26 / course) * (COURSE_BUTT - COURSE_HEAD) }, { s: sTop - 0.1, n: RIDGE_SWELL }, { s: sTop, n: RIDGE_SWELL });
    alongSlope(hut, f, a0, a1, [{ s: first * course, n: -body }, ...top, { s: sTop, n: -body }], "roof", uv, sideUv, !folded);
  }
  if (!folded) return;
  for (const side of slopeSides(f)) clip(hut.shape, side, null, from);
  retile(hut.shape, from);
}

/**
 * The poles under a roof's thatch: a rafter inside each sloped side and one up the middle of each face, their tails
 * out under the eave, one under a fold, and battens along the contours lashed to them, on which the thatch lies.
 */
function roofFrame(hut: Hut, level: number, r: Roof): void {
  const rng = new PyRandom(`roof${r.slopes.length}${r.hip ? "h" : ""}`);
  const fine = level === 0;
  const n = r.plan.length;
  r.slopes.forEach((f) => {
    const k = Math.hypot(1, f.g);
    const sTop = r.rise / f.g;
    const eave = f.kinds.includes("eave");
    const spans = f.poly.map((q) => slopeAt(f, q));
    const [a0, a1] = [Math.min(...spans.map((q) => q[0])), Math.max(...spans.map((q) => q[0]))];
    const fold = f.kinds.indexOf("fold");
    const foldPlane = fold < 0 ? null : slopeSides(f)[fold]!;
    // The contour at s runs from the sloped side to the fold, where the face has one.
    const reach = (s: number): [number, number] => {
      if (fold < 0) return [a0, a1];
      const [p, q] = [spans[fold]!, spans[(fold + 1) % spans.length]!];
      const at = p[0] + ((q[0] - p[0]) * (s - p[1])) / (q[1] - p[1]);
      const rake = spans[f.kinds.indexOf("rake")]![0];
      return rake < at ? [rake, at] : [at, rake];
    };
    const upward: Vec = [-f.up[0] * f.g, -f.up[1] * f.g, 1];
    // One up the middle. Along a sloped side the verge, as deep as the slab, carries the battens' ends: the rafter
    // there stays in the list, undrawn, so the poles after it are cut from the scripts' stream as they were.
    const rafters: [number, number][] = [];
    f.kinds.forEach((kind, i) => {
      if (kind === "rake") rafters.push([spans[i]![0] + Math.sign((a0 + a1) / 2 - spans[i]![0]) * 0.05, 0.036]);
    });
    rafters.push([(a0 + a1) / 2, RAFTER_R]);
    for (const [a, radius] of rafters) {
      const drop = -r.thick + radius * k + 0.004;
      const from = hut.shape.faces.length;
      const [s0, s1] = [eave ? -ROOF_LIP + 0.04 : 0.13, sTop - 0.13];
      const how: Drawn | null = fine && radius === RAFTER_R ? {} : null;
      const [foot, head] = [onSlope(f, a, s0, drop), onSlope(f, a, s1, drop)];
      drawPole(hut, kitPole(rng, foot, head, radius, radius * 0.9, { band: "bark", bow: 0.006, bowDir: upward, segments: 3, sides: 6, caps: ["axe", "flat"] }), how);
      if (foldPlane && how) clip(hut.shape, planeMoved(foldPlane, -0.09), endGrain(foot, head, planeMoved(foldPlane, -0.09)), from);
    }
    const lie = -r.thick + 2 * RAFTER_R * k + BATTEN_R + 0.002;
    BATTENS.forEach((s, row) => {
      if (s > sTop - 0.2) return;
      const [b0, b1] = reach(s);
      // Its end at a sloped side is the side's own; at a fold it stops a hand short.
      const rakes = f.kinds.flatMap((kind, i) => (kind === "rake" ? [spans[i]![0]] : []));
      const short = (at: number): number => (rakes.some((a) => Math.abs(a - at) < 1e-9) ? 0.004 : 0.05);
      const ends: [number, number] = [b0 + short(b0), b1 - short(b1)];
      if (ends[1] - ends[0] < 0.5) return;
      const sag = rng.uniform(0.003, 0.007);
      drawPole(hut, kitPole(rng, onSlope(f, ends[0], s, lie), onSlope(f, ends[1], s, lie + rng.uniform(-0.004, 0.004)), BATTEN_R, BATTEN_R * 0.85, { band: "stick", bow: fold < 0 ? sag : 0, bowDir: [0, 0, -1], segments: fold < 0 ? 3 : 2, sides: 5, caps: ["flat", "flat"] }), fine ? { along: PY_AXIS[f.axis]! } : null);
      // Lashed where it crosses a rafter: every other crossing of the middle one, and on a plain slope the lowest and highest of the others.
      for (const [a, radius] of rafters) {
        if (a < ends[0] + 0.03 || a > ends[1] - 0.03) continue;
        const tied = radius === RAFTER_R && row % 2 === 0;
        const cord = cordOf(rng, py(onSlope(f, a, s - 0.045, -r.thick + radius * k + 0.004)), py([f.up[0], f.up[1], f.g]), radius + 0.008, 0.05);
        drawCord(hut, cord, fine && tied ? radius : null);
      }
    });
  });
  if (r.slopes.length < 2 || !fine) return;
  // The rafter under the fold, from the corner across from it. Under a hip its tail runs out under the corner of the eaves.
  const [a, b] = [r.plan[(r.fold + 2) % n]!, r.plan[r.fold]!];
  const [za, zb] = [r.tops[(r.fold + 2) % n]!, r.tops[r.fold]!];
  const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const drop = -r.thick + (RAFTER_R + 0.004) * Math.hypot(1, (zb - za) / run) + 0.004;
  const at = (t: number): Vec => [a[0] + ((b[0] - a[0]) * t) / run, a[1] + ((b[1] - a[1]) * t) / run, za + ((zb - za) * t) / run + drop];
  drawPole(hut, kitPole(rng, at(r.hip ? -0.24 : 0.2), at(run - 0.2), RAFTER_R + 0.004, RAFTER_R * 0.92, { band: "bark", bow: 0.006, bowDir: [0, 0, 1], segments: 3, sides: 6, caps: ["axe", "flat"] }), {});
}

/** A roof's rim lies on its sides' own lines, as wide as its yield band and as deep as its slab, 2 mm in from a side so its face is not the thatch's. */
const ROOF_RIM = 0.1;
const RIM_IN = 0.002;
/** A low side's plate runs out over the wall under it, short of its outer face, and down onto the wall's head, 11 to 14 mm under the storey's line. */
const PLATE_OUT = 0.096;
const SEAT = 0.013;
/** The ridge's roll (`ridgeRoll`) across, at each level: how far from its line each corner of its back lies, and how high over it. A hip's saddle is its end. */
const RIDGE_BACK: readonly (readonly (readonly [number, number])[])[] = [[[0, 0.105], [0.06, 0.105], [0.16, 0.012], [0.27, -0.085]], [[0, 0.1], [0.08, 0.1], [0.27, -0.085]], [[0, 0.11], [0.27, -0.1]]];
/** A hip's roll of reed across its fold: its height over the faces at the fold, and how far into each face it lies, where it is on the courses. */
const HIP_ROLL = { top: 0.085, wide: 0.18, edge: 0.02 } as const;

/** A squared pole's faces in the wood sheet's peeled band, its grain along the side from `a` to `b`: a side across its height, a top or underside across its width. */
const timberOn = (a: Flat, b: Flat, deep: number) => (part: "top" | "under" | "side"): readonly [string, (q: Vec) => Uv] => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [top, bottom] = bandV("peeled");
  const round = (t: number): number => bottom + (top - bottom) * (t - Math.floor(t));
  return ["wood", (q) => {
    const along = ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / l;
    const across = (-(q[0] - a[0]) * (b[1] - a[1]) + (q[1] - a[1]) * (b[0] - a[0])) / l;
    return [along / TILE.wood, round(part === "side" ? 0.5 * q[2] / deep : 0.25 + across / 0.4)];
  }];
};

/**
 * A pitched roof: thatch in courses on battens and rafters of poles. Its top is the plane through the top of its
 * row's box at each corner, the courses standing on it, and its frame hangs in the slab's thickness under it. A hip and
 * a valley are two such faces cut to the fold between them. Its rim is as deep as its slab on its sides' own lines: a
 * verge of reed along a sloped side, a beam along a high one, and along a low one a plate that runs out over the wall
 * and bears on its head. A hip's fold is capped by a roll of reed that runs into a saddle at its high corner, the end of
 * a ridge's roll.
 */
function roof(form: FormDef, level: number): Shape | null {
  if (level > 3) return null;
  const hut = new Hut(0);
  const p = hut.shape;
  const r = roofOf(form);
  const n = r.plan.length;
  const sideOf = (k: number): Slope => r.slopes.find((f) => f.poly.includes(r.plan[k]!) && f.poly.includes(r.plan[(k + 1) % n]!))!;
  const kindOf = (k: number): Slope["kinds"][number] => sideOf(k).kinds[sideOf(k).poly.indexOf(r.plan[k]!)]!;
  const heightOn = (f: Slope, q: Flat): number => f.lo + slopeAt(f, q)[1] * f.g;
  const wear = (f: Slope) => (q: Vec): Uv => {
    const [a, s] = slopeAt(f, [q[0], q[1]]);
    return [a / TILE.roof, (s * f.g) / r.rise + 1 / 12];
  };
  const reedSide = (q: Vec): Uv => [(q[0] + q[1]) / TILE.roof, 1 / 12 + (q[2] - r.tops[0]!) / TILE.roof];
  const lowest = Math.min(...r.tops) - r.thick;
  const eaves = r.plan.map((_, k) => kindOf(k) === "eave");
  const raked = r.plan.map((_, k) => kindOf(k) === "rake");
  const axis = (k: number): number | undefined => {
    const [a, b] = [r.plan[k]!, r.plan[(k + 1) % n]!];
    return Math.abs(a[1] - b[1]) < 1e-9 ? 0 : Math.abs(a[0] - b[0]) < 1e-9 ? 1 : undefined;
  };
  /** The plates along the low sides, from `top` under the roof's top down onto the wall's head. */
  const plates = (top: number): void => rimStrips(r.plan, r.plan.map((_, k) => (eaves[k] ? PLATE_OUT : -RIM_IN)), ROOF_RIM, raked).forEach((quad, k) => {
    if (eaves[k]) slabOn(p, quad, quad.map((q) => heightOn(sideOf(k), q) - top), quad.map(() => lowest - SEAT), timberOn(r.plan[k]!, r.plan[(k + 1) % n]!, r.thick), 0, axis(k));
  });
  /** A hip's saddle at its high corner: the end of a ridge's roll at this level, turned down both faces to the fold. */
  const saddle = (back: readonly (readonly [number, number])[]): void => {
    const c = r.plan[r.fold]!;
    const zc = r.tops[r.fold]!;
    const [d1, d2] = [r.plan[(r.fold + 1) % n]!, r.plan[(r.fold + n - 1) % n]!].map((q): Flat => [(q[0] - c[0]) / SPAN, (q[1] - c[1]) / SPAN]);
    const at = (i: number, j: number): Flat => [c[0] + d1![0] * i + d2![0] * j, c[1] + d1![1] * i + d2![1] * j];
    const under = (q: Flat): number => Math.min(...r.slopes.map((f) => heightOn(f, q))) - 0.03;
    const reed: (part: "top" | "under" | "side", k: number) => readonly [string, (q: Vec) => Uv] = (part) => ["roof", part === "top" ? wear(r.slopes[0]!) : reedSide];
    // Over each half of the corner its height is the ridge's at its distance from the side it lies nearer: a ring at a
    // time, the flat top as one square, and a ring that is one slope as one slab folded on the corner's diagonal.
    const near = 0.001;
    for (let k = 0; k + 1 < back.length; k++) {
      const [[t0, h0], [t1, h1]] = [back[k]!, back[k + 1]!];
      const [lo, hi] = [Math.max(t0, near), t1];
      if (Math.abs(h0 - h1) < 1e-9) slabOn(p, [at(near, near), at(hi, near), at(hi, hi), at(near, hi)], [0, 1, 2, 3].map(() => zc + h0), [at(near, near), at(hi, near), at(hi, hi), at(near, hi)].map(under), reed, 0);
      else if (lo === near) slabOn(p, [at(near, near), at(hi, near), at(hi, hi), at(near, hi)], [h0, h1, h1, h1].map((h) => zc + h), [at(near, near), at(hi, near), at(hi, hi), at(near, hi)].map(under), reed, 0);
      else for (const [quad, tops] of [[[at(lo, near), at(hi, near), at(hi, hi), at(lo, lo)], [h0, h1, h1, h0]], [[at(near, lo), at(lo, lo), at(hi, hi), at(near, hi)], [h0, h0, h1, h1]]] as const) {
        slabOn(p, quad, tops.map((h) => zc + h), quad.map(under), reed, 0);
      }
    }
  };
  if (level === 3) {
    // One solid: its top wears the courses' colour, and it runs out to a thin edge over each eave.
    const moved = inset(r.plan, eaves.map((e) => (e ? -ROOF_EAVE + 0.04 : 0)));
    const out = moved.map((q, k) => Math.hypot(q[0] - r.plan[k]![0], q[1] - r.plan[k]![1]) > 1e-9);
    const high = moved.map((q, k) => heightOn(out[k] ? r.slopes.find((f) => f.poly.includes(r.plan[k]!) && f.kinds.includes("eave"))! : sideOf(k), q) + COURSE_BUTT * 0.6);
    const low = moved.map((_, k) => (out[k] ? high[k]! - 0.16 : r.tops[k]! - r.thick));
    slabOn(p, moved, high, low, () => ["roof", NO_UV], r.fold);
    return p;
  }
  if (level === 2) {
    // The slab as deep as its row to every side, its top wearing the courses; a thin edge out over each eave; the plates; and a hip's saddle.
    slabOn(p, r.plan, r.tops.map((h) => h + COURSE_BUTT * 0.6), r.thick + COURSE_BUTT * 0.6, (part, k) => ["roof", part === "side" ? reedSide : wear(r.slopes[Math.min(k, r.slopes.length - 1)]!)], r.fold);
    // Each eave and its plate as one: out to a thin edge, and in over the wall's head as deep as the plate.
    rimStrips(r.plan, eaves.map((e) => (e ? ROOF_EAVE - 0.04 : 0)), ROOF_RIM).forEach((quad, k) => {
      if (!eaves[k]) return;
      const f = sideOf(k);
      const tops = quad.map((q) => heightOn(f, q) + COURSE_BUTT * 0.6);
      slabOn(p, quad, tops, quad.map((q, v) => (v < 2 ? tops[v]! - 0.16 : lowest - SEAT)), (part) => ["roof", part === "side" ? reedSide : wear(f)], 0, axis(k));
    });
    if (r.hip) saddle(RIDGE_BACK[2]!);
    return p;
  }
  for (const f of r.slopes) thatchOn(hut, level, r, f);
  roofFrame(hut, level, r);
  if (level === 0) {
    // The verges and the beams: reed run down to the slab's underside along a sloped side, a squared pole along a high one.
    rimStrips(r.plan, r.plan.map((_, k) => (eaves[k] ? PLATE_OUT : -RIM_IN)), ROOF_RIM, raked).forEach((quad, k) => {
      if (eaves[k]) return;
      const f = sideOf(k);
      const from = p.faces.length;
      if (raked[k]) slabOn(p, quad, quad.map((q) => heightOn(f, q) - 0.02), r.thick - 0.02, (part) => ["roof", part === "top" ? wear(f) : reedSide], 0);
      else slabOn(p, quad, quad.map((q) => heightOn(f, q) - 0.02), r.thick - 0.02, timberOn(r.plan[k]!, r.plan[(k + 1) % n]!, r.thick), 0, axis(k));
      // A verge runs on past a low side to the plate's face, and ends level on the wall's head there as the plate does.
      if (raked[k]) clip(p, planeAt([0, 0, lowest - SEAT], [0, 0, -1]), null, from);
    });
  }
  plates(0.02);
  if (r.hip && level < 2) {
    // The roll of reed along the fold, from the corner of the eaves up into the saddle, a strip either side.
    const [a, b] = [r.plan[(r.fold + 2) % n]!, r.plan[r.fold]!];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [ux, uy] = [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
    const reach = r.slopes.every((f) => f.kinds.includes("eave")) ? ROOF_LIP * Math.SQRT2 : 0;
    const from = p.faces.length;
    for (const f of r.slopes) {
      // Into the face: square to the fold, toward the face's own middle.
      const mid: Flat = [f.poly.reduce((sum, q) => sum + q[0], 0) / 3, f.poly.reduce((sum, q) => sum + q[1], 0) / 3];
      const side = Math.sign((mid[0] - a[0]) * -uy + (mid[1] - a[1]) * ux);
      const across = (q: Flat, d: number): Flat => [q[0] - uy * side * d, q[1] + ux * side * d];
      const [lo, hi]: [Flat, Flat] = [[a[0] - ux * reach, a[1] - uy * reach], [b[0], b[1]]];
      const quad = [lo, hi, across(hi, HIP_ROLL.wide), across(lo, HIP_ROLL.wide)];
      slabOn(p, quad, quad.map((q, v) => heightOn(f, q) + (v < 2 ? HIP_ROLL.top : HIP_ROLL.edge)), quad.map((q) => heightOn(f, q) - 0.03), (part) => ["roof", part === "top" ? wear(f) : reedSide], 0);
    }
    // Cut to the sides, an eave's past its lip, and a sloped one a millimetre in, as the saddle is: where it nears the
    // slope beside it, it runs into the saddle and is no part of the face that meets that slope's.
    for (const side of r.plan.map((q, k) => planeMoved(uprightPlane(q, r.plan[(k + 1) % n]!), eaves[k] ? ROOF_LIP : -0.001))) clip(p, side, null, from);
    saddle(RIDGE_BACK[level]!);
  }
  return p;
}

// The low walls: a gable under a roof's sloped side, a half wall and a fence -----------------------------------------------

/** A wall-family row that is no whole wall: half its width, how high it stands, and how far its foot is under its collider's origin. */
function lowOf(form: FormDef): { hx: number; high: number; lift: number } {
  const [u0, v0, u1, v1] = outlineBox(form);
  return { hx: (u1 - u0) / 2, high: v1 - v0, lift: form.at[1] - v0 };
}

/** A wall's lower tier across the whole of a low wall, as a wall of the same level has it: built to its own height, to be cut to the row's. */
function lowTier(hut: Hut, level: number): void {
  const lower = { clumps: LOWER, foot: LOWER_FOOT, flare: 0.05, tuft: 0.1, feet: 4, lean: [LOWER_ROD, LEAN[1]], uv: lowerUv, uvBack: innerUv, mats: [BODY, TIPS], x0: -H, x1: H, pinch: postPinch } as const;
  const solid = (p: Vec): Uv => lowerUv([p[0], LOWER_ROWS.last[0] + 0.03, p[2]]);
  if (level === 0) tier(hut, { ...lower, tips: "skirt", back: [...LOWER_BACK, [FRONT_FOOT, CORE_Z, solid], [LOWER_ROWS.last[0], CORE_Z, solid]], rows: [row(LOWER_ROWS.top, "ends"), row(LOWER_ROWS.rod, "full"), row(LOWER_ROWS.belly, "full"), row(LOWER_ROWS.last, "full")] });
  else tier(hut, { ...lower, tips: "none", plain: true, back: LOWER_BACK, rows: [row(LOWER_ROWS.top, "ends"), row(LOWER_ROWS.rod, "ends"), row(LOWER_ROWS.last, "ends"), row([FRONT_FOOT, LOWER_ROWS.last[1] + 0.05 + 0.9 * LOWER_ROWS.last[2], 0], "ends")] });
}

/** A cut through thatch shows reed end on: the lower tier's own picture over its tips, run through the wall's thickness. */
const cutReed = (q: Vec): readonly [string, Uv] => [BODY, lowerUv([q[0], LOWER_ROWS.last[0] + 0.1 - q[1], 0])];

/** How a level draws a low wall's poles. */
const LOW_LOOKS: readonly { post: Drawn | null; pole: Drawn | null; rail: Drawn | null; cord: boolean }[] = [
  { post: {}, pole: { sides: 6 }, rail: { sides: 6, along: 0 }, cord: true },
  { post: { plain: true, sides: 6 }, pole: { plain: true, sides: 3 }, rail: { plain: true, sides: 3, along: 0 }, cord: false },
  { post: { plain: true, sides: 4 }, pole: null, rail: null, cord: false },
];

/**
 * The gable under a roof's sloped side: a wall's lower tier of thatch cut by the plane its outline's top lies in, a
 * pole along that cut outside and one inside, a rod and a rail across it, and half a post at its high end, which the
 * other hand makes whole. It is built high at its -x end, and the other hand is that one in a mirror.
 */
function gable(form: FormDef, level: number, posts: boolean): Shape | null {
  if (level > 3) return null;
  const { hx, high, lift } = lowOf(form);
  const hut = new Hut(lift);
  const right = form.outline.some(([u, v]) => v > form.outline[0]![1] + 1e-9 && u > form.at[0]);
  const done = (): Shape => (right ? mirror(hut.shape, 0) : hut.shape);
  // The top's plane in the kit's frame, and its height over x in the wall's own, from its foot.
  const slope = planeAt([hx, 0, -lift], [high, 0, 2 * hx]);
  const top = (x: number): number => (high * (hx - x)) / (2 * hx);
  const k = Math.hypot(1, high / (2 * hx));
  if (level === 3) {
    const tri: Vec[] = [[-hx, 0, 0], [hx, 0, 0], [-hx, high, 0]];
    hut.solid([{ points: tri.map(([x, y]): Vec => [x, y, BACK_Z]), uvs: tri.map(NO_UV), mat: BODY }, { points: tri.map(([x, y]): Vec => [x, y, 0.1]), uvs: tri.map(NO_UV), mat: BODY }, ...tri.map((a, i): Patch => {
      const b = tri[(i + 1) % 3]!;
      return { points: [[a[0], a[1], BACK_Z], [b[0], b[1], BACK_Z], [b[0], b[1], 0.1], [a[0], a[1], 0.1]], uvs: [0, 1, 2, 3].map(NO_UV), mat: BODY };
    })]);
    return done();
  }
  if (level === 2) slab(hut, -hx, hx, null, true, false);
  else lowTier(hut, level);
  clip(hut.shape, slope, cutReed);
  if (level === 2) clip(hut.shape, planeAt([0, 0, -lift - 0.03], [0, 0, -1]), cutReed);
  const look = LOW_LOOKS[level]!;
  const rng = new PyRandom("gable0");
  const from = hut.shape.faces.length;
  // The poles along the cut: one outside that the thatch is tied to, and a lighter one inside.
  const along = (z: number, radius: number, band: string, how: Drawn | null): void => {
    const drop = radius * k + 0.012;
    drawPole(hut, poleOf(rng, [hx + 0.2, top(hx + 0.2) - drop, z], [-hx - 0.2, top(-hx - 0.2) - drop, z], radius, radius * 0.92, { band, segments: 3, sides: 6, caps: ["flat", "flat"] }), how);
  };
  along(ROD_Z + 0.012, 0.036, "bark", look.pole);
  along(RAIL_Z, 0.036, "peeled", look.pole);
  clip(hut.shape, planeAt([0, 0, -lift - 0.02], [0, 0, -1]), null, from);
  // Half a post on the high end's own line, where the other hand's half meets it.
  drawPole(hut, poleOf(rng, [-hx, -0.02, POST_Z], [-hx, high + 0.1, POST_Z - 0.004], POST_R[0], POST_R[1] + 0.004, { band: "bark", caps: ["flat", "flat"], segments: 3 }), posts ? look.post : null);
  for (const [x, radius] of [[-0.75 * hx, 0.045], [0, 0.043], [0.6 * hx, 0.043]] as const) {
    drawCord(hut, cordOf(rng, [x, top(x) - 0.036 * k - 0.012, ROD_Z + 0.012], [-2 * hx, high, 0], radius, 0.07), look.cord ? 0.036 : null);
  }
  // Each is cut to the wall's ends and its top, and the two along the top to its foot; a cut wears the pole's own skin carried through.
  for (const plane of [planeAt([-hx, 0, 0], [-1, 0, 0]), planeAt([hx, 0, 0], [1, 0, 0]), planeMoved(slope, -0.004)]) clip(hut.shape, plane, null, from);
  retile(hut.shape);
  if (level < 2) {
    // A split pole laid flat on the inner pole, across the wall's inner half under the cut: the roof's verge bears on it.
    const plank: Flat[] = [[-hx, 0.026], [hx, 0.026], [hx, 0.1], [-hx, 0.1]];
    const [vTop, vBottom] = bandV("peeled");
    const batten = hut.shape.faces.length;
    slabOn(hut.shape, plank, plank.map(([x]) => top(x) - lift - 0.0015), 0.03, () => ["wood", (q) => [q[0] / TILE.wood, vBottom + (vTop - vBottom) * (0.5 + (q[1] - q[2]) / 0.3)]]);
    clip(hut.shape, planeAt([0, 0, -lift], [0, 0, -1]), null, batten);
  }
  // A rod outside and a rail inside, each as far as the cut lets it run.
  const rise = rng.uniform(-0.006, 0.006);
  const far = (y: number): number => hx - ((y + 0.09) * 2 * hx) / high;
  // The rod lies over the bundles' bellies, which stand further out here than at a wall's tie.
  const over = LOWER_ROWS.belly[1] + LOWER_ROWS.belly[2] + ROD_R + 0.016;
  drawPole(hut, poleOf(rng, [-hx, 0.62, over], [far(0.62), 0.62 + rise, over + 0.004], ROD_R, ROD_R * 0.85, { band: "stick", bow: 0.008, bowDir: [0, -1, 0.15], segments: 3, sides: 6 }), look.rail);
  drawCord(hut, cordOf(rng, [(far(0.62) - hx) / 2, 0.62 - 0.007, over], [1, 0.02, 0], ROD_R + 0.009, 0.045), look.cord ? ROD_R : null);
  drawPole(hut, poleOf(rng, [-hx, RAILS[0], RAIL_Z], [far(RAILS[0]), RAILS[0], RAIL_Z], RAIL_R, RAIL_R * 0.9, { band: "peeled", caps: ["flat", "axe"], segments: 3, sides: 6 }), look.rail);
  return done();
}

/**
 * A wall half a storey high: the lower tier alone, cut level at its top, on the wall's own rods and rails, with a
 * pole along its top outside. Its post stands at its left end as a wall's does.
 */
function halfWall(form: FormDef, level: number, posts: boolean): Shape | null {
  if (level > 3) return null;
  const { hx, high, lift } = lowOf(form);
  const hut = new Hut(lift);
  if (level === 3) {
    hut.box([-hx, 0, BACK_Z], [hx, high - 0.015, 0.12], BODY, NO_UV);
    return hut.shape;
  }
  if (level === 2) slab(hut, -hx, hx, null, true, false);
  else lowTier(hut, level);
  clip(hut.shape, planeAt([0, 0, high - lift - 0.012], [0, 0, 1]), cutReed);
  if (level === 2) clip(hut.shape, planeAt([0, 0, -lift - 0.03], [0, 0, -1]), cutReed);
  const look = LOW_LOOKS[level]!;
  const rng = new PyRandom("half0");
  const [post, cord] = posts ? [look.post, look.cord] : [null, false];
  drawPole(hut, poleOf(rng, [POST_X, -0.02, POST_Z], [POST_X + 0.005, high - 0.07, POST_Z - 0.004], POST_R[0], POST_R[1] + 0.004, { band: "bark", bow: 0.008, bowDir: [0.3, 0, 1], caps: ["flat", "axe"], segments: 4 }), post);
  drawCord(hut, cordOf(rng, [POST_X + 0.003, LOWER_ROD + 0.012, POST_Z], [0.06, 1, 0], POST_R[1] + 0.016, 0.09), cord ? (POST_R[0] + POST_R[1]) / 2 : null);
  const lookAs: FrameLook = { post: null, inner: null, rod: look.rail && (level === 0 ? { sides: 6, along: 0 } : look.rail), rail: look.rail && (level === 0 ? { along: 0 } : look.rail), sill: look.rail && (level === 0 ? { along: 0 } : null), jamb: null, stick: null, cord: look.cord, tie: look.cord };
  rods(hut, rng, lookAs, -hx, hx, [high - 0.09, LOWER_ROD]);
  rails(hut, rng, lookAs, -hx, hx, [RAILS[0], LOWER_ROD]);
  return hut.shape;
}

/**
 * A fence of poles a quarter storey high: a rail under its top and one over its foot, a post at each end and in the
 * middle, and two crossed sticks to a bay, lashed where they meet. An end post is half a post, which the next fence
 * makes whole.
 */
function fence(form: FormDef, level: number): Shape | null {
  if (level > 4) return null;
  const { hx, high, lift } = lowOf(form);
  const hut = new Hut(0);
  // From 386 m its rails are one board: twelve triangles are all a piece may be from there.
  if (level === 4) {
    hut.box([-hx, 0.1 - lift, -0.02], [hx, high - 0.02 - lift, 0.02], "wood", NO_UV);
    return hut.shape;
  }
  if (level === 3) {
    // A top rail and a foot rail as one thin board each: two boxes.
    for (const y of [high - 0.1, 0.1]) hut.box([-hx, y - lift, -0.02], [hx, y + 0.08 - lift, 0.02], "wood", NO_UV);
    return hut.shape;
  }
  const rng = new PyRandom("fence0");
  const sticks = railingSticks(hx, -lift, high - lift, [0.07, 0.07], [0.11, 0.11], [0.04, 0.04]);
  const how = (what: string): Drawn | null => (level === 0 ? (what === "brace" ? { sides: 5 } : what === "rail" ? { sides: 6, along: 0 } : { sides: 6 }) : level === 1 ? { plain: true, sides: what === "post" ? 4 : 3, grow: 1.25, ...(what === "rail" ? { along: 0 } : {}) } : what === "brace" ? null : { plain: true, sides: 3, grow: 1.25 });
  for (const s of sticks) {
    const post = s.what === "post";
    // A post stands on the fence's own line, a half one at an end, and runs up past the top rail.
    const [a, b]: [Vec, Vec] = post ? [[Math.abs(s.a[0]) > hx - 0.1 ? Math.sign(s.a[0]) * hx : s.a[0], 0, s.a[2]], [Math.abs(s.a[0]) > hx - 0.1 ? Math.sign(s.a[0]) * hx : s.a[0], 0, high - lift - 0.04]] : [s.a, s.b];
    const radius = post ? 0.052 : s.what === "rail" ? 0.034 : 0.02;
    const side = s.what === "rail" ? -0.045 : s.what === "brace" ? Math.sign(a[1]) * 0.02 - 0.022 : 0;
    const from = hut.shape.faces.length;
    drawPole(hut, kitPole(rng, [a[0], side, a[2]], [b[0], side, b[2]], radius, radius * 0.9, { band: post ? "bark" : s.what === "rail" ? "peeled" : "stick", segments: post ? 2 : 3, sides: s.what === "brace" ? 5 : 6, bow: post ? 0 : 0.006, bowDir: [0, 0, -1], caps: post ? ["flat", "axe"] : ["flat", "flat"] }), how(s.what));
    for (const x of [-hx, hx]) clip(hut.shape, planeAt([x, 0, 0], [Math.sign(x), 0, 0]), null, from);
    // Each rail is lashed to the post it passes.
    if (post && level === 0) for (const z of [high - lift - 0.035 - 0.07 / 2, 0.1 + 0.035 - lift]) drawCord(hut, cordOf(rng, py([a[0], -0.03, z]), [0, 1, 0], radius + 0.012, 0.07), radius);
    if (post) for (const x of [-hx, hx]) clip(hut.shape, planeAt([x, 0, 0], [Math.sign(x), 0, 0]), null, from);
  }
  return hut.shape;
}

// Trims ---------------------------------------------------------------------------------------------------------------
//
// What the client draws where thatch pieces meet (client/core/render/trims.ts). A joint is the pole a corner's walls
// are tied to. It is cut to a lower wall's height by clamping what is over n quarter storeys and a centimetre down onto
// that height, so its shaft thins upward and has a ring at each such height, and its lashing is part of its own skin.

/** The heights a joint may be cut to, and its own. */
const JOINT_RINGS = [0.76, 1.51, 2.26] as const;
const JOINT_HIGH = 3.01;
/** Half the corner pole's width at its foot. It fills the notch two walls leave at a corner, 0.1 m each way from it. */
const JOINT_R = 0.112;
/** The pole where two walls meet at 60 degrees: their outer faces meet 0.2 m from the corner, and it fills the notch to 0.14 m. */
const JOINT_R21 = 0.18;
/** Where its lashing is, at the height of a wall's lower rod, and how far the cord stands off the pole. */
const JOINT_CORD = [1.155, 1.245] as const;
const CORD_OFF = 0.013;

/**
 * A corner pole of `radius` at its foot. Its eight sides have a point on each of a square corner's four ways and on
 * each diagonal between, so it covers the walls' ends however it is turned by quarters.
 */
function cornerPole(level: number, radius: number, seed: string): Shape {
  const shape = new RoundShape();
  if (level === 3) {
    // Far off, a pole of three sides.
    const ring = [0, 1, 2].map((k): Flat => [Math.cos((2 * Math.PI * k) / 3) * radius * 1.2, Math.sin((2 * Math.PI * k) / 3) * radius * 1.2]);
    return shape.skin([{ points: ring.map(([x, y]): Vec => [x, y, 0]), uvs: ring.map(NO_UV), mat: "wood" }, { points: ring.map(([x, y]): Vec => [x, y, JOINT_HIGH]), uvs: ring.map(NO_UV), mat: "wood" }, ...ring.map((a, k): Patch => {
      const b = ring[(k + 1) % 3]!;
      return { points: [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], JOINT_HIGH], [a[0], a[1], JOINT_HIGH]], uvs: [0, 1, 2, 3].map(NO_UV), mat: "wood" };
    })]);
  }
  const rng = new PyRandom(seed);
  const sides = level === 0 ? 8 : level === 1 ? 5 : 4;
  // A pole of few sides is as thick through as the round one, and a square one holds the round one's width.
  const thick = level === 0 ? 1 : level === 1 ? Math.sqrt(Math.PI / ((sides / 2) * Math.sin((2 * Math.PI) / sides))) : 0.92 * Math.SQRT2;
  const twist = level === 2 ? Math.PI / 4 : 0;
  const taper = (z: number): number => radius * thick * (1 - 0.08 * (z / JOINT_HIGH));
  // Each ring: its height, its radius, whether it is the cord's, and how far each point strays.
  const heights: [number, number, boolean][] = level === 0
    ? [[0, taper(0), false], [JOINT_RINGS[0], taper(0.76), false], [JOINT_CORD[0] - 0.015, taper(1.14), false], [JOINT_CORD[0], taper(1.155) + CORD_OFF, true], [JOINT_CORD[1], taper(1.245) + CORD_OFF, true], [JOINT_CORD[1] + 0.015, taper(1.26), false], [JOINT_RINGS[1], taper(1.51), false], [JOINT_RINGS[2], taper(2.26), false], [2.94, taper(2.94), false], [JOINT_HIGH, taper(3.01) * 0.8, false]]
    : level === 1 ? [[0, taper(0), false], ...JOINT_RINGS.map((z): [number, number, boolean] => [z, taper(z), false]), [JOINT_HIGH, taper(3.01) * 0.85, false]]
    : [[0, taper(0), false], [JOINT_HIGH, taper(0), false]];
  // A point's dent is the same up the pole, so no ring stands outside the one under it.
  const dents = Array.from({ length: sides }, () => (level === 0 ? 1 + rng.uniform(-0.035, 0.015) : 1));
  const rings = heights.map(([z, r, cord]) => Array.from({ length: sides }, (_, j): Vec => {
    const t = twist + (2 * Math.PI * j) / sides;
    const at = r * (cord ? 1 : dents[j]!);
    return [Math.cos(t) * at, Math.sin(t) * at, z];
  }));
  const [barkTop, barkBottom] = bandV("bark");
  const [cordTop, cordBottom] = bandV("cord");
  const [bark, cord] = [shape.group(), shape.group()];
  const patches: Patch[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const corded = heights[i]![2] && heights[i + 1]![2];
    const [v0, v1] = corded ? [cordBottom, cordTop] : [barkBottom, barkTop];
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const [va, vb] = [v0 + ((v1 - v0) * j) / sides, v0 + ((v1 - v0) * (j + 1)) / sides];
      const [ua, ub] = [heights[i]![0] / TILE.wood, heights[i + 1]![0] / TILE.wood];
      patches.push({ points: [rings[i]![j]!, rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![j]!], uvs: [[ua, va], [ua, vb], [ub, vb], [ub, va]], mat: "wood", ...(level === 2 ? {} : { group: corded ? cord : bark }) });
    }
  }
  const [cu, cv, rad] = [(184 + 336 * 2) / 2048, 1 - 1915 / 2048, 118 / 2048];
  for (const ring of [[...rings[0]!].reverse(), rings.at(-1)!]) patches.push({ points: ring, uvs: ring.map((p): Uv => [cu + (rad * p[0]) / radius, cv + (rad * p[1]) / radius]), mat: "wood" });
  return shape.skin(patches);
}

/** A face a trim has no back for, given looking outward: a level drawn open where it is never seen from behind. */
function openSheet(shape: Shape, points: Vec[], mat: string): Shape {
  shape.faces.push({ points, uvs: points.map(NO_UV), mat });
  return shape;
}

/**
 * The skirt under a foundation's open side, from the middle of the side, +x along it and its front at -y: a bank of
 * packed earth under the crib of logs, held by driven stakes and two poles across them. Its top is the crib's foot,
 * so the foundation's own logs stay in view, and it is drawn sunk into the ground.
 */
function skirt(level: number): Shape {
  const hut = new Hut(0);
  const [top, deep, face, foot] = [-FOUND_T + 0.02, 2.4, 0.05, 0.085];
  const earth = (p: Vec): Uv => [(p[0] + H) / TILE.earth, p[2] / TILE.earth];
  if (level === 3) return openSheet(hut.shape, [[-H, -foot, -deep], [H, -foot, -deep], [H, -face, top], [-H, -face, top]], "earth");
  // The bank: its face leans out to its foot, and its back is upright on the side's own line.
  const section: Flat[] = [[0, top], [-face, top], [-foot, -deep], [0, -deep]];
  const patches: Patch[] = section.map((a, k): Patch => {
    const b = section[(k + 1) % section.length]!;
    const points: Vec[] = [[-H, a[0], a[1]], [H, a[0], a[1]], [H, b[0], b[1]], [-H, b[0], b[1]]];
    return { points, uvs: points.map(level === 2 ? earth : earth), mat: "earth" };
  });
  for (const x of [-H, H]) patches.push({ points: section.map(([y, z]): Vec => [x, y, z]), uvs: section.map(([y, z]): Uv => [y / TILE.earth, z / TILE.earth]), mat: "earth" });
  if (level === 2) {
    // Its face and its top over an upright back: a wedge, eight triangles.
    const wedge: Flat[] = [[0, top], [-face, top], [-foot, -deep]];
    hut.raw([...wedge.map((a, k): Patch => {
      const b = wedge[(k + 1) % 3]!;
      const points: Vec[] = [[-H, a[0], a[1]], [H, a[0], a[1]], [H, b[0], b[1]], [-H, b[0], b[1]]];
      return { points, uvs: points.map(earth), mat: "earth" };
    }), ...[-H, H].map((x): Patch => ({ points: wedge.map(([y, z]): Vec => [x, y, z]), uvs: wedge.map(([y, z]): Uv => [y / TILE.earth, z / TILE.earth]), mat: "earth" }))]);
    return hut.shape;
  }
  hut.raw(patches);
  const rng = new PyRandom("skirt0");
  const lean = (z: number): number => -face - ((foot - face) * (top - z)) / (deep + top);
  const stake: Drawn = level === 0 ? { sides: 5 } : { plain: true, sides: 3, grow: 1.15 };
  for (const x of level === 0 ? [-1.02, 0.04, 1.1] : [-1.02, 1.1]) {
    const r = 0.03;
    drawPole(hut, kitPole(rng, [x, lean(top - 0.03) - r * 0.25, top - 0.03], [x + rng.uniform(-0.03, 0.03), lean(-deep) - r * 0.25, -deep + 0.02], r, r * 0.8, { band: "bark", caps: ["axe", "flat"], segments: 2, sides: 5 }), stake);
  }
  if (level > 0) return hut.shape;
  for (const z of [-0.72, -1.55]) {
    drawPole(hut, kitPole(rng, [-H + 0.01, lean(z) - 0.012, z], [H - 0.01, lean(z) - 0.012, z + rng.uniform(-0.03, 0.03)], 0.02, 0.017, { band: "stick", caps: ["flat", "flat"], segments: 2, sides: 5 }), { sides: 5, along: 0 });
  }
  return hut.shape;
}

/** How far a ridge's roll runs past each end of its side: an open end stands proud of the roofs' ends, cut square as reed is, and the client lays an end square where the next ridge runs on. */
const RIDGE_PROUD = 0.02;

/**
 * The roll along a ridge where two roofs' high sides meet: a saddle of reed laid over both top courses, held by a rod
 * along each flank that is pegged down. It lies along x on the ridge's own line, at its origin's height.
 */
function ridgeRoll(level: number): Shape {
  const hut = new Hut(0);
  const end = H + RIDGE_PROUD;
  const reed = (p: Vec): Uv => [(p[0] + H) / TILE.roof, 0.42 + (p[1] + Math.sign(p[1]) * Math.max(0, p[2]) * 0.6) / TILE.roof];
  if (level === 3) return openSheet(hut.shape, [[-end, 0.24, -0.06], [-end, -0.24, -0.06], [end, -0.24, -0.06], [end, 0.24, -0.06]], "roof");
  // Its section over the ridge, (y, z) going round: the saddle's back, and an underside that lies inside both roofs.
  const back: Flat[] = level === 0 ? [[0.27, -0.085], [0.16, 0.012], [0.06, 0.105], [-0.06, 0.105], [-0.16, 0.012], [-0.27, -0.085]] : level === 1 ? [[0.27, -0.085], [0.08, 0.1], [-0.08, 0.1], [-0.27, -0.085]] : [[0.27, -0.1], [0, 0.11], [-0.27, -0.1]];
  const section: Flat[] = level === 2 ? back : [...back, [-0.27, -0.16], [0.27, -0.16]];
  const round = hut.shape.group();
  hut.raw([...section.map((a, k): Patch => {
    const b = section[(k + 1) % section.length]!;
    const points: Vec[] = [[-end, a[0], a[1]], [end, a[0], a[1]], [end, b[0], b[1]], [-end, b[0], b[1]]];
    return { points, uvs: points.map(reed), mat: "roof", ...(level < 2 && k + 1 < back.length ? { group: round } : {}) };
  }), ...[-end, end].map((x): Patch => ({ points: section.map(([y, z]): Vec => [x, y, z]), uvs: section.map(([y, z]): Uv => [0.5 + z / TILE.roof, 0.42 + y / TILE.roof]), mat: "roof" }))]);
  if (level > 0) return hut.shape;
  const rng = new PyRandom("ridge0");
  for (const s of [-1, 1]) {
    drawPole(hut, kitPole(rng, [-H + 0.02, s * 0.2, -0.016], [H - 0.02, s * 0.2, -0.016 + rng.uniform(-0.004, 0.004)], 0.014, 0.012, { band: "stick", caps: ["flat", "flat"], segments: 2, sides: 4 }), { sides: 4, along: 0 });
    for (const x of [-0.8, 0.85]) drawPole(hut, kitPole(rng, [x + s * 0.05, s * 0.226, 0.01], [x + s * 0.05, s * 0.17, -0.07], 0.011, 0.009, { band: "peeled", caps: ["flat", "flat"], segments: 2, sides: 3 }), { sides: 3 });
  }
  return hut.shape;
}

/**
 * A flat ceiling's eave along one side, as the client lays it where a side wants one: the reed run on over the edge and
 * drooping, and a skirt of tips from its lip, as the ceiling's own eave is. From the middle of the side, +x along it and
 * out at -y, its top at the ceiling's top. It ends square on the side's two ends: the client lays each end on the plane
 * that halves its corner (piece-fit.ts), so two meet there round an outside corner and clear an inside one.
 */
function eaveTrim(level: number): Shape {
  const hut = new Hut(0);
  // (out from the side's line, height from the ceiling's top) round the section, as `eave` has it from its root 6 cm in.
  const root = EAVE_ROOT - H;
  const lip = root + EAVE_BODY;
  const sections: readonly (readonly [number, number])[][] = [
    [[root, -0.012], [root + 0.07, -0.04], [lip, -0.1], [lip, MAT_Y - 0.03 - C_TOP], [root, MAT_Y + 0.02 - C_TOP]],
    [[root, -0.012], [lip, -0.1], [lip, MAT_Y - 0.03 - C_TOP], [root, MAT_Y + 0.02 - C_TOP]],
    [[root, -0.012], [root + 0.3, -0.23], [root, MAT_Y + 0.02 - C_TOP]],
  ];
  const at = (x: number, out: number, h: number): Vec => [x, h, out];
  const lipUv = (p: Vec): Uv => [(p[0] + H) / TILE.roof, (p[2] + 2 * H) / TILE.roof];
  if (level === 3) return openSheet(hut.shape, [[-H, -0.24, -0.23], [H, -0.24, -0.23], [H, 0, -0.03], [-H, 0, -0.03]], "roof");
  const section = sections[level]!;
  const patches: Patch[] = section.map((a, k) => {
    const b = section[(k + 1) % section.length]!;
    const points = [at(-H, a[0], a[1]), at(H, a[0], a[1]), at(H, b[0], b[1]), at(-H, b[0], b[1])];
    return { points, uvs: points.map(lipUv), mat: "roof" };
  });
  for (const s of [-1, 1]) patches.push({ points: section.map(([out, h]) => at(s * H, out, h)), uvs: section.map(([out, h]) => lipUv(at(s * H, out, h))), mat: "roof" });
  hut.solid(patches);
  if (level < 2) {
    // The tips hang from the lip's top edge, a sheet seen from above and from under the eave.
    const [far, fall] = [lip + EAVE_HANG, -0.1 - EAVE_FALL];
    const card: Vec[] = [at(-H, lip, -0.1), at(H, lip, -0.1), at(H, far, fall), at(-H, far, fall)];
    hut.card([{ points: card, uvs: card.map((p, i) => eaveTipUv(p[0], i < 2 ? 0 : 1)), mat: TIPS }]);
  }
  return hut.shape;
}

/** Thatch's trims by the names the client finds them under, each at its four levels; with `eaves`, a ceiling's eave among them. */
function thatchTrims(eaves: boolean): Record<string, Shape[]> {
  const levels = (make: (level: number) => Shape): Shape[] => [0, 1, 2, 3].map(make);
  return {
    // The corner pole. Where walls meet at 120 or 150 degrees the same pole fills the corner, so the second is the first again.
    joint_sq: levels((level) => cornerPole(level, JOINT_R, "joint")),
    joint_r15: levels((level) => cornerPole(level, JOINT_R, "joint")),
    // At 60 degrees the walls' outer faces meet 0.2 m from the corner, and the pole is a stouter one.
    joint_r21: levels((level) => cornerPole(level, JOINT_R21, "joint21")),
    skirt: levels(skirt),
    ridge: levels(ridgeRoll),
    // A flat ceiling's eave, which a ceiling drawn with no eaves of its own leaves to the client: the client lays one
    // wherever the pack has it, so it is in the pack only with those ceilings.
    ...(eaves ? { eave: levels(eaveTrim) } : {}),
  };
}

// Each is an entry of the palette (shared/pack/palette.ts), so the nearest entry is the colour itself.
const GOLD = [196, 156, 88] as const;
const STRAW = [192, 148, 97] as const;
const EARTH = [139, 97, 58] as const;
const BARK = [116, 72, 42] as const;

/** The forms of content's that thatch is made in: it has no window, pillar or stairs. */
export const THATCH_FORMS = ["foundation", "wall", "doorframe", "ceiling", "door", "door_open"] as const;
/** The planned forms thatch is made in: a pitched roof, the gable under it, and a low wall and a fence for a yard. */
export const THATCH_PLANNED = ["roof", "roof_hip", "roof_valley", "sloped_wall_left", "sloped_wall_right", "half_wall", "railing"] as const;

/** The pictures each body is drawn whole with: a material of the tier's bake that names its cut-out twin's textures. */
export const THATCH_SOLIDS: Readonly<Record<string, string>> = { thatch_solid: "thatch", door_solid: "door" };

const PLANNED: Readonly<Record<string, (form: FormDef, level: number, posts: boolean) => Shape | null>> = {
  roof,
  roof_hip: roof,
  roof_valley: roof,
  sloped_wall_left: gable,
  sloped_wall_right: gable,
  half_wall: halfWall,
  railing: fence,
};

/**
 * The thatch tier. With `posts`, a wall has the post at its left end that fills a corner where no joint is drawn. With
 * `eaves`, a flat ceiling has its eaves on every side; without, it ends square and `eave_thatch` is among the trims,
 * which the client lays where a side wants one.
 */
export function thatchRecipe(posts: boolean, eaves = true): TierRecipe {
  return {
    name: "thatch",
    rank: 0,
    runPost: true,
    jointHalf: JOINT_R,
    tones: { thatch: GOLD, thatch_solid: GOLD, door: GOLD, door_solid: GOLD, roof: GOLD, floor: STRAW, earth: EARTH, wood: BARK },
    split(name, form, level) {
      const planned = PLANNED[name];
      if (planned) return planned(form, level, posts);
      // The rows are the scripts', drawn for a 3 m wall with a 1.4 by 2.3125 m doorway: a form of another size has no thatch yet.
      const [u0, v0, u1, v1] = outlineBox(form);
      const fits = (wide: number, high: number): boolean => Math.abs(u1 - u0 - wide) < 1e-9 && Math.abs(v1 - v0 - high) < 1e-9;
      if (form.layer === "wall" && fits(SPAN, WALL_H) && !form.openings) return wall(level, posts);
      const o = form.openings?.[0];
      if (form.layer === "wall" && fits(SPAN, WALL_H) && form.openings?.length === 1 && o && o.y0 === 0 && Math.abs(o.x1 - o.x0 - DOOR_W) < 1e-9 && Math.abs(o.y1 - DOOR_H) < 1e-9) return doorframe(level, posts);
      if (form.layer === "slab" && form.root === "always" && fits(SPAN, SPAN) && form.thick === FOUND_T) return foundation(level);
      if (form.layer === "slab" && fits(SPAN, SPAN) && form.thick === FLOOR_T && !form.corner && !form.openings) return ceiling(level, eaves);
      if (form.layer === "leaf" && fits(DOOR_W, DOOR_H)) return door(level, form.plane === "across");
      throw new Error(`thatch has no recipe for ${name} yet`);
    },
    trims: () => thatchTrims(!eaves),
  };
}

// Thatch's pack holds core:joint_sq_thatch and core:eave_thatch, so the client draws a pole at each corner where a
// wall's own post stood, and lays an eave where a ceiling's side wants one (client/core/render/trims.ts).
export const THATCH: TierRecipe = thatchRecipe(false, false);
/** Thatch as it was before joints were drawn: each wall keeps its own post. */
export const THATCH_POSTED: TierRecipe = thatchRecipe(true, false);
/** Thatch as it was before the client laid eaves: a flat ceiling has its own on every side, and no eave is a trim. */
export const THATCH_EAVED: TierRecipe = thatchRecipe(false, true);
