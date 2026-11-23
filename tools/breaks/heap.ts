// Heaps and hung forms that any family may call: what a fallen piece becomes where it lies, and a slab or a precast panel
// left hanging by one edge or one fixing. Drafts, as the other forms are.

import { MAX_SHAPE_BOXES, type ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { Rng } from "../../shared/rng.ts";
import { hullFault, type HullDef } from "../../shared/world/convex.ts";
import { chunkVolume } from "./check.ts";
import type { Chunk } from "./cut.ts";
import { seedOf, type Form } from "./forms.ts";
import { grid, type Corner, type Pt } from "./geometry.ts";

const RUST = 179, CORE = 102, BAR = 0.035;
/** Loose blocks' colours and lumps' colours, as the hand-made skirts have them. */
const LOOSE = [101, 99, 102] as const, LUMP = [101, 99] as const;
/** Rubble takes this much more room than the piece it was, and lies this far past the piece's footprint at most. */
const BULK = 1.3, GROW = 1.2;
/** A slab's heap is no higher than this, so a body climbs it. */
const CLIMB = 1.05;
/** The most a tooth of a snapped edge stands out, the art's figure. */
const TOOTH = 0.32;

export interface HeapAsk {
  readonly name: string;
  readonly variant: number;
  readonly kind: "wall" | "slab" | "pier";
  /** Where the piece stood, seen from above: from and to along x, then along z. */
  readonly footprint: readonly [x0: number, x1: number, z0: number, z1: number];
  /** The height of what it fell on. */
  readonly floor: number;
  /** The whole piece's volume, in cubic metres. */
  readonly volume: number;
  /** The colour of pieces still told as the piece's own: a plate, a length of column. The piece's finish unless given. */
  readonly finishColor?: number;
}

/** A lump before the heap's height is known: its base on the floor, and points over it at shares of that height. */
interface Mound {
  readonly base: readonly Pt[];
  readonly over: readonly Corner[];
  readonly color: number;
}

/** Where a piece lay, its long side first. */
interface Lay { readonly u0: number; readonly u1: number; readonly v0: number; readonly v1: number }

interface Heap {
  readonly mounds: readonly Mound[];
  /** The most the lumps may stand. */
  readonly cap: number;
  /** Plates and lengths that keep their form, as corners over the floor, once the lumps' height is known. */
  readonly rigid: (high: number) => Corner[][];
  readonly rigidVolume: number;
  /** Loose blocks: where, and how large. */
  readonly blocks: readonly (readonly [u: number, v: number, size: number])[];
}

/**
 * A lump against a line: its back `back` behind the line, its toe `out` before it, its crest near the line. `at` puts a
 * place along the line and a distance before it on the floor.
 */
function sideLump(rng: Rng, a0: number, a1: number, back: number, out: number, share: number, color: number, at: (a: number, w: number) => Pt): Mound {
  const long = a1 - a0;
  const base = [at(a0, -back), at(a1, -back), at(a1 - rng.range(0.08, 0.22) * long, out * rng.range(0.8, 1)), at(a0 + rng.range(0.08, 0.22) * long, out * rng.range(0.7, 0.95))];
  const top = (along: number, y: number, w: number): Corner => { const [u, v] = at(a0 + along * long, w * out); return [u, y * share, v]; };
  const near = rng.range(0.18, 0.32), far = rng.range(0.68, 0.84), turned = rng.float() < 0.5;
  // The crest's two points, then shoulders that swell its slope.
  const over = [top(turned ? far : near, 1, rng.range(0, 0.12)), top(turned ? near : far, rng.range(0.6, 0.85), rng.range(0, 0.12)), top(rng.range(0.38, 0.5), 0.62, 0.5), top(rng.range(0.6, 0.72), 0.5, 0.55)];
  return { base, over: over.slice(0, 2 + rng.int(3)), color };
}

/** A lump as a solid `high` tall. A point over it that would lie inside it is left out, from the last. */
function lumpOf(m: Mound, high: number, put: (u: number, y: number, v: number) => Corner): Chunk {
  const corners = (n: number): Corner[] => [...m.base.map(([u, v]) => put(u, 0, v)), ...m.over.slice(0, n).map(([u, y, v]) => put(u, y * high, v))];
  let n = m.over.length;
  while (n > 1 && hullFault({ corners: corners(n) }) !== "") n--;
  return { corners: corners(n), color: m.color };
}

/**
 * A box lying up a slope: from the middle of its low edge at `foot`, `long` up a slope of `rise` over `run` toward `way`,
 * `thick` off the slope and `wide` across it. `skew` slides its high end sideways.
 */
function sloped(foot: Corner, way: Pt, run: number, rise: number, long: number, thick: number, wide: number, skew = 0): Corner[] {
  const l = Math.hypot(run, rise), c = grid(run / l), s = grid(rise / l);
  const out: Corner[] = [];
  for (const j of [0, 1]) for (const k of [0, 1]) for (const i of [-0.5, 0.5]) {
    const along = j * long * c - k * thick * s, across = i * wide + j * skew;
    out.push([foot[0] + way[0] * along - way[1] * across, foot[1] + j * long * s + k * thick * c, foot[2] + way[1] * along + way[0] * across]);
  }
  return out;
}

/** A wall's heap: a skirt of lumps along its line on both sides, and at most one plate of it lying on a slope. */
function wallHeap(rng: Rng, l: Lay): Heap {
  const long = l.u1 - l.u0, mid = (l.v0 + l.v1) / 2, reach = (l.v1 - l.v0) / 2 + GROW;
  const runs = Math.max(1, Math.min(6, Math.round(long / 2.7)));
  const cap = Math.min(1.4, 0.95 * reach);
  const mounds: Mound[] = [], blocks: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    const at = (a: number, w: number): Pt => [a, mid + side * w];
    const cuts = Array.from({ length: runs + 1 }, (_, k) => l.u0 + (long * (k === 0 || k === runs ? k : k + rng.range(-0.25, 0.25))) / runs);
    for (let k = 0; k < runs; k++) mounds.push(sideLump(rng, cuts[k]! - 0.3, cuts[k + 1]! + 0.3, rng.range(0.15, 0.3), reach * rng.range(0.8, 1), rng.range(0.7, 1), LUMP[(k + (side > 0 ? 1 : 0)) % 2]!, at));
    for (let k = 0; k < runs + 1; k++) {
      const size = rng.range(0.15, 0.32);
      blocks.push([l.u0 + long * rng.range(0.05, 0.95), mid + side * (reach - size) * rng.range(0.62, 1), size]);
    }
  }
  const plated = rng.float() < 0.65, side = rng.float() < 0.5 ? -1 : 1;
  const thick = Math.min(l.v1 - l.v0, 0.3), wide = Math.min(long * 0.4, rng.range(1.4, 2.4)), where = l.u0 + long * rng.range(0.25, 0.75), skew = rng.range(-0.3, 0.3), share = rng.range(0.8, 1);
  const run = reach - 0.4;
  return {
    mounds, cap, blocks,
    rigid: (high) => (plated ? [sloped([where, 0.02, mid + side * (reach - 0.35)], [0, -side], run, high * 0.8, Math.hypot(run, high * 0.8) * share, thick, wide, skew)] : []),
    rigidVolume: plated ? wide * thick * Math.hypot(run, cap * 0.8) * share : 0,
  };
}

/** A plate lying on a plane that is not level: its outline from above, and its underside's height over the floor. */
interface Lie { readonly poly: readonly Pt[]; readonly p: number; readonly q: number; readonly r: number }
const under = (lie: Lie, [u, v]: Pt): number => lie.p + lie.q * u + lie.r * v;
/** A plate on a slope with its lowest corner on the floor. */
const rest = (poly: readonly Pt[], q: number, r: number): Lie => ({ poly, q, r, p: -Math.min(...poly.map(([u, v]) => q * u + r * v)) });

/** A slab's heap: the slab in two or three plates, one flat and the rest leaning on it, with lumps along its edges. */
function slabHeap(rng: Rng, l: Lay, volume: number): Heap {
  const du = l.u1 - l.u0, dv = l.v1 - l.v0, thick = volume / (du * dv);
  // One break across the slab, and in three plates a second from that break to the far edge.
  const c0 = l.u0 + du * rng.range(0.4, 0.6), c1 = l.u0 + du * rng.range(0.4, 0.6);
  const three = rng.float() < 0.5, part = rng.range(0.35, 0.65);
  const m: Pt = [c0 + (c1 - c0) * part, l.v0 + dv * part], e: Pt = [l.u1, l.v0 + dv * rng.range(0.35, 0.65)];
  const far: Pt[][] = three ? [[[c0, l.v0], [l.u1, l.v0], e, m], [m, e, [l.u1, l.v1], [c1, l.v1]]] : [[[c0, l.v0], [l.u1, l.v0], [l.u1, l.v1], [c1, l.v1]]];
  const first = rest([[l.u0, l.v0], [c0, l.v0], [c1, l.v1], [l.u0, l.v1]], rng.range(0.01, 0.03), rng.range(-0.015, 0.015));
  const lies: Lie[] = [first];
  far.forEach((poly, i) => {
    // Turned a little and slid over the first plate's edge: its first and last corners on that plate, its far edge on the floor.
    const slide = rng.range(0.25, 0.55), mu = (c0 + c1 + 2 * l.u1) / 4, mv = l.v0 + dv * (three ? 0.25 + i * 0.5 : 0.5);
    const s = grid(rng.range(0.4, 1) * (rng.float() < 0.5 ? -1 : 1) * Math.min(0.12, 0.5 / Math.hypot(du, dv))), c = grid(Math.sqrt(1 - s * s));
    const moved = poly.map(([u, v]): Pt => [mu + (u - mu) * c - (v - mv) * s - slide, mv + (u - mu) * s + (v - mv) * c]);
    const a = moved[0]!, b = moved[3]!;
    const need = Math.max(under(first, a), under(first, b)) + thick + 0.02 + i * rng.range(0.05, 0.12);
    const lie = rest(moved, -need / (l.u1 - slide - (a[0] + b[0]) / 2), rng.range(-0.02, 0.02));
    lies.push({ ...lie, p: lie.p + Math.max(0, need - Math.min(under(lie, a), under(lie, b))) });
  });
  const most = Math.max(...lies.flatMap((lie) => lie.poly.map((p) => under(lie, p))));
  const press = Math.max(0, Math.min(1, (CLIMB - thick) / most));
  const sides: readonly (readonly [number, number, (a: number, w: number) => Pt])[] = [
    [l.u0, l.u1, (a, w) => [a, l.v0 - w]], [l.u0, l.u1, (a, w) => [a, l.v1 + w]], [l.v0, l.v1, (a, w) => [l.u0 - w, a]], [l.v0, l.v1, (a, w) => [l.u1 + w, a]],
  ];
  const mounds: Mound[] = [], blocks: [number, number, number][] = [];
  const skip = rng.int(6), twice = rng.int(4);
  sides.forEach(([a0, a1, at], i) => {
    for (let n = 0; n < (i === skip ? 0 : i === twice ? 2 : 1); n++) {
      const long = (a1 - a0) * rng.range(0.3, 0.5), from = a0 + (a1 - a0 - long) * rng.float();
      mounds.push(sideLump(rng, from, from + long, 0.5, GROW * rng.range(0.75, 1), rng.range(0.7, 1), LUMP[(i + n) % 2]!, at));
    }
    const size = rng.range(0.15, 0.3), [u, v] = at(a0 + (a1 - a0) * rng.range(0.1, 0.9), rng.range(0.3, GROW - size));
    blocks.push([u, v, size]);
  });
  return {
    mounds, cap: CLIMB - 0.1, blocks, rigidVolume: volume,
    rigid: () => lies.map((lie) => [0, thick].flatMap((t) => lie.poly.map(([u, v]): Corner => [u, press * under(lie, [u, v]) + t, v]))),
  };
}

/** A pier's heap: a mound over its foot, lumps round that, and one length of the pier lying in it. */
function pierHeap(rng: Rng, l: Lay): Heap {
  const cu = (l.u0 + l.u1) / 2, cv = (l.v0 + l.v1) / 2, hu = (l.u1 - l.u0) / 2 + GROW, hv = (l.v1 - l.v0) / 2 + GROW;
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  const shares = [1, 0.88, 0.94, 0.8], first = rng.int(4);
  const mounds: Mound[] = [{
    base: signs.map(([su, sv]): Pt => [cu + su * hu * 0.62 * rng.range(0.8, 1), cv + sv * hv * 0.62 * rng.range(0.8, 1)]),
    over: signs.map(([su, sv], i): Corner => [cu + su * hu * 0.2 * rng.range(0.7, 1.2), shares[(i + first) % 4]!, cv + sv * hv * 0.2 * rng.range(0.7, 1.2)]),
    color: LUMP[0],
  }];
  const sides: readonly (readonly [number, number, (a: number, w: number) => Pt])[] = [
    [hu, hv, (a, w) => [cu + a, cv - 0.42 * hv - w]], [hu, hv, (a, w) => [cu + a, cv + 0.42 * hv + w]], [hv, hu, (a, w) => [cu - 0.42 * hu - w, cv + a]], [hv, hu, (a, w) => [cu + 0.42 * hu + w, cv + a]],
  ];
  const skip = rng.int(5);
  sides.forEach(([along, out, at], i) => {
    if (i !== skip) mounds.push(sideLump(rng, -along * rng.range(0.35, 0.8), along * rng.range(0.35, 0.8), 0.3, 0.58 * out * rng.range(0.8, 1), rng.range(0.45, 0.7), LUMP[(i + 1) % 2]!, at));
  });
  const blocks = signs.filter((_, i) => i !== first).map(([su, sv]): [number, number, number] => [cu + su * (hu - 0.3) * rng.range(0.7, 1), cv + sv * (hv - 0.3) * rng.range(0.7, 1), rng.range(0.15, 0.28)]);
  // The length lies along one axis, its low end out toward the heap's edge and its high end over the mound.
  const turned = rng.float() < 0.5, back = rng.float() < 0.5 ? -1 : 1;
  const way: Pt = turned ? [0, back] : [back, 0];
  const through = turned ? l.u1 - l.u0 : l.v1 - l.v0, deep = turned ? l.v1 - l.v0 : l.u1 - l.u0;
  const far = (turned ? hv : hu) * 0.55, aside = rng.range(-0.3, 0.3), long = rng.range(1.2, 1.6), rise = rng.range(0.3, 0.45);
  const foot: Corner = [cu - way[0] * far - way[1] * aside, 0, cv - way[1] * far + way[0] * aside];
  return { mounds, cap: 1.2, blocks, rigid: () => [sloped(foot, way, 1, rise, long, deep, through)], rigidVolume: through * deep * long };
}

/** The form named "heap": what a fallen piece that has something under it becomes, in place. */
export function heapForm(ask: HeapAsk): Form {
  const rng = new Rng(seedOf(ask.name, "heap", ask.variant));
  const [x0, x1, z0, z1] = ask.footprint;
  const turned = z1 - z0 > x1 - x0, flip = rng.float() < 0.5;
  const lay: Lay = turned ? { u0: z0, u1: z1, v0: x0, v1: x1 } : { u0: x0, u1: x1, v0: z0, v1: z1 };
  // The heap is laid out along the footprint's long side, and by half the seeds end for end.
  const put = (u: number, y: number, v: number): Corner => { const w = flip ? lay.u0 + lay.u1 - u : u; return turned ? [v, ask.floor + y, w] : [w, ask.floor + y, v]; };
  const heap = ask.kind === "wall" ? wallHeap(rng, lay) : ask.kind === "slab" ? slabHeap(rng, lay, ask.volume) : pierHeap(rng, lay);
  // A lump's volume goes as its height, so the height that makes the bulk is found from the lumps a metre tall.
  const unit = heap.mounds.reduce((s, m) => s + chunkVolume(lumpOf(m, 1, put)), 0);
  const high = Math.min(heap.cap, Math.max(0.3, (ask.volume * BULK - heap.rigidVolume) / unit));
  const lumps = heap.mounds.map((m) => lumpOf(m, high, put));
  const rigid = heap.rigid(high).map((corners): Chunk => ({ corners: corners.map(([u, y, v]) => put(u, y, v)), ...(ask.finishColor !== undefined ? { color: ask.finishColor } : {}) }));
  const start = rng.int(LOOSE.length);
  const boxes = heap.blocks.map(([u, v, size], i): ShapeBox => {
    const at = put(u, size * 0.4, v);
    return { at, half: turned ? [size * 0.8, size * 0.5, size] : [size, size * 0.5, size * 0.8], color: LOOSE[(start + i) % LOOSE.length]! };
  });
  const chunks = [...rigid, ...lumps];
  // A shape has room for sixteen solids: the largest are kept.
  const solid = chunks.length <= MAX_SHAPE_BOXES ? chunks : [...chunks].sort((a, b) => chunkVolume(b) - chunkVolume(a)).slice(0, MAX_SHAPE_BOXES);
  return { name: "heap", note: "fallen where it stood", look: { boxes, chunks }, walked: { boxes: [], hulls: solid.map((c): HullDef => ({ corners: c.corners })) }, fragments: [], panes: [], bears: false };
}

export interface HungSlabAsk {
  readonly name: string;
  readonly variant: number;
  /** The slab seen from above: from and to along x, then along z. */
  readonly bounds: readonly [x0: number, x1: number, z0: number, z1: number];
  readonly y0: number;
  readonly y1: number;
  /** The edge that still holds. */
  readonly held: "x0" | "x1" | "z0" | "z1";
  /** Bars bared at the hinge, as reinforced concrete has. They are drawn unless this is false. */
  readonly barsAt?: boolean;
}

/** The form named "hung" of a slab: turned down about its held edge's lower line, its far edge snapped in teeth. */
export function hungSlab(ask: HungSlabAsk): Form {
  const rng = new Rng(seedOf(ask.name, "hung", ask.variant));
  const [x0, x1, z0, z1] = ask.bounds;
  const alongX = ask.held === "x0" || ask.held === "x1", sign = ask.held.endsWith("0") ? 1 : -1;
  const hinge = ask.held === "x0" ? x0 : ask.held === "x1" ? x1 : ask.held === "z0" ? z0 : z1;
  const long = alongX ? x1 - x0 : z1 - z0, [s0, s1] = alongX ? [z0, z1] : [x0, x1], thick = ask.y1 - ask.y0;
  const degrees = rng.range(22, 30);
  // The turn's sine and cosine are on the grid, so every engine puts a corner alike and a flat face stays flat.
  const c = grid(Math.cos((degrees * Math.PI) / 180)), s = grid(Math.sin((degrees * Math.PI) / 180));
  const spot = (out: number, y: number, w: number): Corner => (alongX ? [hinge + sign * out, y, w] : [w, y, hinge + sign * out]);
  /** A point `d` out from the hinge along the slab, `e` up through it and `w` along the held edge. */
  const at = (d: number, e: number, w: number): Corner => spot(d * c + e * s, ask.y0 - d * s + e * c, w);
  const end = long - TOOTH;
  const body: Corner[] = [s0, s1].flatMap((w) => [at(0, 0, w), at(0, thick, w), at(end, 0, w), at(end, thick, w)]);
  const count = Math.max(2, Math.round((s1 - s0) / 2));
  const cuts = Array.from({ length: count + 1 }, (_, k) => s0 + ((s1 - s0) * (k === 0 || k === count ? k : k + rng.range(-0.3, 0.3))) / count);
  const teeth: Chunk[] = [];
  for (let k = 0; k < count; k++) {
    const a = cuts[k]!, b = cuts[k + 1]!, tip = a + (b - a) * rng.range(0.3, 0.7);
    // Long and short by turns, each thinned to its tip.
    const out = TOOTH * (k % 2 === ask.variant % 2 ? rng.range(0.7, 1) : rng.range(0.25, 0.55)), low = thick * rng.range(0.2, 0.45), high = thick * rng.range(0.7, 0.95);
    teeth.push({ corners: [at(end, 0, a), at(end, thick, a), at(end, 0, b), at(end, thick, b), at(end + out, low, tip), at(end + out, high, tip)], color: CORE });
  }
  // Three bars from the held edge over the gap the turn opens, two bent down and one up.
  const boxes: ShapeBox[] = [];
  if (ask.barsAt !== false) {
    [0.12, 0.49, 0.73].forEach((share, k) => {
      const w = s0 + (s1 - s0) * (share + rng.range(-0.04, 0.04)), y = ask.y1 - Math.min(0.12, thick / 3);
      const reach = thick * s + rng.range(0.15, 0.35), bend = (k === 1 ? 1 : -1) * rng.range(0.2, 0.45);
      const box = (o0: number, o1: number, ya: number, yb: number): ShapeBox => {
        const p = spot((o0 + o1) / 2, (ya + yb) / 2, w), half = (o1 - o0) / 2;
        return { at: p, half: alongX ? [half, (yb - ya) / 2, BAR] : [BAR, (yb - ya) / 2, half], color: RUST };
      };
      boxes.push(box(0, reach, y - BAR, y + BAR), box(reach - BAR, reach + BAR, Math.min(y, y + bend), Math.max(y, y + bend)));
    });
  }
  return { name: "hung", note: `hangs ${Math.round(degrees)} degrees from one edge`, look: { boxes, chunks: [{ corners: body }, ...teeth] }, walked: { boxes: [], hulls: [{ corners: body }] }, fragments: [], panes: [], bears: false };
}

export interface HungPanelAsk {
  readonly name: string;
  readonly variant: number;
  /** The panel seen from in front: from and to along x, then up. */
  readonly bounds: readonly [x0: number, x1: number, y0: number, y1: number];
  readonly z0: number;
  readonly z1: number;
}

/** The form named "hung" of a precast panel: from one top fixing, its far end dropped in its own plane, off the wall line. */
export function hungPanel(ask: HungPanelAsk): Form {
  const rng = new Rng(seedOf(ask.name, "hung", ask.variant));
  const [x0, x1, y0, y1] = ask.bounds;
  const degrees = rng.range(31, 37);
  const c = grid(Math.cos((degrees * Math.PI) / 180)), s = grid(Math.sin((degrees * Math.PI) / 180));
  // By half the seeds it hangs from its other top corner.
  const left = rng.float() < 0.5, fixing = left ? x0 : x1, way = left ? 1 : -1;
  const drop = grid(rng.range(0.2, 0.4)), off = grid(rng.range(0.1, 0.22)), top = y1 - drop;
  const corners: Corner[] = [ask.z0 + off, ask.z1 + off].flatMap((z) => ([[0, 0], [x1 - x0, 0], [x1 - x0, y0 - y1], [0, y0 - y1]] as const).map(([d, e]): Corner => [fixing + way * (d * c + e * s), top - d * s + e * c, z]));
  const hanger: ShapeBox = { at: [fixing + way * 0.06, y1 - (drop + 0.1) / 2, (ask.z0 + ask.z1) / 2 + off], half: [0.04, (drop + 0.1) / 2, 0.04], color: RUST };
  return { name: "hung", note: `hangs ${Math.round(degrees)} degrees from one fixing`, look: { boxes: [hanger], chunks: [{ corners }] }, walked: { boxes: [], hulls: [{ corners }] }, fragments: [], panes: [], bears: false };
}
