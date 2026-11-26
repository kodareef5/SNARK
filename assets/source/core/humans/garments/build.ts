// Makes a garment cut on a cooked body by script: the skin it covers, cut along smooth hems past the borders of the
// zones it hides, lifted off the skin by the cloth's thickness and ease, smoothed where it would fold, closed at each
// opening with a turned hem, unrolled onto its print sheet (shared/people/cuts.ts) and weighted from the skin under it.

import { HUMAN_BONES } from "../../../../../shared/anim/human.ts";
import { SHEETS, type SheetName } from "../../../../../shared/people/cuts.ts";
import { smoothNormals, welded, type Nearest } from "../../../../../tools/pack/refit.ts";
import type { ScriptedBody } from "../../../../../tools/pack/body.ts";
import { Cloth } from "./cloth.ts";
import { measureRing, onRing, seamSide, unit, type Ring, type RingFrame, type Vec } from "./rings.ts";
import { convexHull, hullReach } from "./shapes.ts";
import { zonePoints, type Skin } from "./skin.ts";

/** A joint's rest, three numbers a bone. */
export type Rest = ArrayLike<number>;
export const joint = (rest: Rest, b: number): Vec => [rest[b * 3]!, rest[b * 3 + 1]!, rest[b * 3 + 2]!];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

/** Colour regions of a cut, as its masks paint them: main, accent and trim (shared/people/cuts.ts EDITION_REGIONS). */
export const MAIN = 0;
export const ACCENT = 1;
export const TRIM = 2;

/** An opening of a cut: where it ends past the zones it hides. */
export interface Hem {
  name: string;
  /** The zones past the hidden ones that the cloth reaches into here, cut at this hem. */
  into: readonly number[];
  /** `along` grows away from the hidden zones. */
  frame: (rest: Rest) => RingFrame;
  /** The hidden points this hem must reach past: those near it. */
  near: (p: Vec, rest: Rest) => boolean;
  /** Straight across its axis, or following the border it passes, smoothed. */
  straight?: boolean;
  /** Metres more past what the hidden zones need, for the cut's own length. */
  extra?: number;
  /** How far along its frame it reaches at least, as a cuff reaches the wrist. */
  atLeast?: (rest: Rest) => number;
  /** Metres inside it painted as a band of trim (a rib, a waistband), 0 for none. */
  rib?: number;
  /** Metres more ease at the hem itself, fading over `flareOver`. Negative draws it in, as a cuff. */
  flare?: number;
  flareOver?: number;
}

export interface CutDef {
  name: string;
  sheet: SheetName;
  covers: readonly number[];
  hems: readonly Hem[];
  /** How far off the skin the cloth sits at a point of a zone, before smoothing, in metres. */
  offset: (zone: number, p: Vec, rest: Rest) => number;
  /** The least it keeps while smoothing. */
  least: number;
  /** Passes of smoothing. */
  smooth?: number;
  /** Metres the turned hem reaches back inside. */
  facing?: number;
  /** Every point on one bone, as a shoe is: the bone for a point by the weights under it. */
  rigid?: (weights: Float32Array, p: Vec) => number;
  /** Its colour region at a point, from the skin point under it, how far inside its nearest hem it is, and that hem. */
  region?: (p: Vec, inside: number, hem: Hem | null, rest: Rest) => number;
  /** A surface of its own to start from, in place of the skin of the zones it hides and reaches into. */
  shape?: (skin: Skin, rest: Rest) => Cloth;
  /** The lowest the cloth goes: a shoe's sole on the ground. */
  floor?: number;
  /** Keeps the weights its shape gave each point, in place of the skin's nearest the lifted cloth. */
  ownWeights?: boolean;
  /**
   * Below this height it hangs: each point goes out to the hull of the body's slice there, so it spans the cleft and the
   * groin as a shirt's tail does. The zones the slices are taken from.
   */
  drape?: { below: (rest: Rest) => number; zones: readonly number[] };
}

/** A cut as made: what the cook takes, with what the painter needs to paint its masks. */
export interface MadeCut {
  body: ScriptedBody;
  /** Per vertex, its colour region weights: main, accent and trim. */
  regions: Float32Array;
  /** Metres past the hidden zones each hem reaches at its nearest, at each body level. */
  reach: Record<string, number[]>;
  report: string[];
}

const TURNS = 72;

/** For each turn about a hem's axis, how far along it the cloth must reach. */
function hemReach(hem: Hem, rest: Rest, levels: readonly Skin[], hidden: ReadonlySet<number>, clear: readonly number[]): { need: Float64Array; reach: Float64Array; frame: RingFrame } {
  const frame = hem.frame(rest);
  const need = new Float64Array(TURNS).fill(-Infinity);
  levels.forEach((skin, level) => {
    const c = clear[Math.min(level, clear.length - 1)]!;
    for (const v of zonePoints(skin, hidden)) {
      const p: Vec = [skin.positions[v * 3]!, skin.positions[v * 3 + 1]!, skin.positions[v * 3 + 2]!];
      if (!hem.near(p, rest)) continue;
      const { along, turn } = frameAt(frame, p);
      const t = Math.floor(turn * TURNS) % TURNS;
      need[t] = Math.max(need[t]!, along + c);
    }
  });
  // Turns with no hidden point near take their neighbours'.
  for (let pass = 0; pass < TURNS && need.some((x) => x === -Infinity); pass++) {
    const was = Float64Array.from(need);
    for (let t = 0; t < TURNS; t++) if (was[t] === -Infinity) need[t] = Math.max(was[(t + 1) % TURNS]!, was[(t + TURNS - 1) % TURNS]!);
  }
  if (need.every((x) => x === -Infinity)) throw new Error(`hem ${hem.name}: no hidden point is near it`);
  let reach: Float64Array;
  if (hem.straight) reach = new Float64Array(TURNS).fill(Math.max(...need));
  else {
    // The smooth curve that is nowhere short of what is needed.
    reach = Float64Array.from(need);
    for (let pass = 0; pass < 40; pass++) {
      const was = Float64Array.from(reach);
      for (let t = 0; t < TURNS; t++) reach[t] = Math.max(need[t]!, (was[(t + TURNS - 1) % TURNS]! + 2 * was[t]! + was[(t + 1) % TURNS]!) / 4);
    }
    for (let pass = 0; pass < 6; pass++) {
      const was = Float64Array.from(reach);
      for (let t = 0; t < TURNS; t++) reach[t] = (was[(t + TURNS - 1) % TURNS]! + 2 * was[t]! + was[(t + 1) % TURNS]!) / 4;
    }
    const short = Math.max(...need.map((n, t) => n - reach[t]!));
    for (let t = 0; t < TURNS; t++) reach[t]! += Math.max(0, short);
  }
  const least = hem.atLeast?.(rest) ?? -Infinity;
  for (let t = 0; t < TURNS; t++) reach[t] = Math.max(reach[t]! + (hem.extra ?? 0), least);
  return { need, reach, frame };
}

/** A point's distance along a frame and its turn about it, 0 to 1 from the seam. */
export function frameAt(f: RingFrame, p: ArrayLike<number>): { along: number; turn: number } {
  const d = sub(p, f.origin);
  let turn = Math.atan2(dot(d, f.quarter), dot(d, f.seam)) / (Math.PI * 2);
  if (turn < 0) turn += 1;
  return { along: dot(d, f.axis), turn };
}

const reachAt = (reach: Float64Array, turn: number): number => {
  const ft = turn * TURNS - 0.5, t0 = Math.floor(ft), tt = ft - t0;
  const at = (t: number): number => reach[((t % TURNS) + TURNS) % TURNS]!;
  return at(t0) * (1 - tt) + at(t0 + 1) * tt;
};

/** A panel of a sheet as the builder unrolls it. */
export interface Panel {
  name: string;
  /** Whether a skin point is on it. */
  on: (p: Vec, n: Vec) => boolean;
  /** Its sheet coordinates for a skin point; on a ring, `near` is the share round of the triangle's middle, which a corner's is taken within a half of. */
  uv: (p: Vec, near: number) => [number, number];
  /** Splits that bound it: the cloth is split where each changes sign. */
  bounds: ((p: Vec, n: Vec) => number)[];
  ring?: Ring;
}

/** A ring panel: `around` the sheet axis that goes round the ring; `flip` runs the other along the sheet's way back. */
export function ringPanel(sheet: SheetName, name: string, frame: RingFrame, skinPoints: ArrayLike<number>, on: (p: Vec, n: Vec) => boolean, around: "u" | "v", bounds: ((p: Vec, n: Vec) => number)[] = [], flip = false): Panel {
  const s = SHEETS[sheet];
  const rect = s.panels.find((p) => p.name === name)?.rect;
  if (!rect) throw new Error(`sheet ${sheet} has no panel ${name}`);
  const ring = measureRing(frame, skinPoints);
  return {
    name, on, bounds, ring,
    uv: (p, near) => {
      const r = onRing(ring, p);
      const share = r.share + Math.round(near - r.share);
      const along = r.along / s.metres;
      if (around === "u") return [rect[0] + share * rect[2], rect[1] + along];
      return [rect[0] + (flip ? rect[2] - along : along), rect[1] + share * rect[3]];
    },
  };
}

/**
 * A flat panel: the sheet coordinates are a point's metres along `right` and `down`, counted from the least of `points`
 * (the skin it lies on, three numbers a point) each way, and centred in the panel's rectangle.
 */
export function flatPanel(sheet: SheetName, name: string, points: ArrayLike<number>, right: Vec, down: Vec, on: (p: Vec, n: Vec) => boolean, bounds: ((p: Vec, n: Vec) => number)[] = []): Panel {
  const s = SHEETS[sheet];
  const rect = s.panels.find((p) => p.name === name)?.rect;
  if (!rect) throw new Error(`sheet ${sheet} has no panel ${name}`);
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    const p = [points[i]!, points[i + 1]!, points[i + 2]!];
    [dot(p, right), dot(p, down)].forEach((x, a) => {
      lo[a] = Math.min(lo[a]!, x);
      hi[a] = Math.max(hi[a]!, x);
    });
  }
  const pad = [0, 1].map((a) => (rect[2 + a]! - (hi[a]! - lo[a]!) / s.metres) / 2);
  return { name, on, bounds, uv: (p) => [rect[0] + pad[0]! + (dot(p, right) - lo[0]!) / s.metres, rect[1] + pad[1]! + (dot(p, down) - lo[1]!) / s.metres] };
}

/** The points of the skin's triangles of `zones` that `keep` takes, three numbers a point. */
export function skinPointsOf(skin: Skin, zones: readonly number[], keep: (p: Vec, n: Vec) => boolean = () => true): number[] {
  const out: number[] = [];
  for (const v of zonePoints(skin, new Set(zones))) {
    const p: Vec = [skin.positions[v * 3]!, skin.positions[v * 3 + 1]!, skin.positions[v * 3 + 2]!];
    if (keep(p, [skin.normals[v * 3]!, skin.normals[v * 3 + 1]!, skin.normals[v * 3 + 2]!])) out.push(...p);
  }
  return out;
}

interface Lifted {
  q: number[];
  /** Per point, how far inside its nearest hem and which hem, -1 for none. */
  inside: number[];
  hemOf: number[];
}

/**
 * Builds a cut on `levels[0]`, the finest skin, with each coarser skin's hidden zones reached past too. `clear` is how far
 * past them at each level, in metres.
 */
export function buildCut(def: CutDef, rest: Rest, levels: readonly Skin[], panels: readonly Panel[], clear: readonly number[]): MadeCut {
  const skin = levels[0]!;
  const report: string[] = [];
  const hidden = new Set(def.covers);
  const into = new Set(def.hems.flatMap((h) => h.into));
  const cloth = def.shape ? def.shape(skin, rest) : Cloth.fromSkin(skin, (z) => hidden.has(z) || into.has(z));
  // Cut each hem along the curve it reaches to.
  const reaches = def.hems.map((h) => hemReach(h, rest, levels, hidden, clear));
  const along: number[][] = [];
  def.hems.forEach((hem, k) => {
    const { reach, frame } = reaches[k]!;
    const zones = new Set(hem.into);
    const g = (v: number): number => {
      const { along: a, turn } = frameAt(frame, cloth.point(v));
      return a - reachAt(reach, turn);
    };
    // A cut of its own shape is cut wherever the hem passes; one made of the skin only in the zones the hem reaches into.
    const cuts = (t: number): boolean => (def.shape ? hem.near(cloth.point(cloth.idx[t * 3]!), rest) : zones.has(cloth.zone[t]!));
    const value = cloth.split(g, cuts);
    cloth.keep((t) => !cuts(t) || cloth.centroid(value, t) <= 0);
  });
  // Bits left over that do not touch what is hidden are not part of it.
  if (hidden.size > 0) {
    const joined = cloth.connected((t) => hidden.has(cloth.zone[t]!));
    cloth.keep((t) => joined[t] === 1);
  }
  // Split along each panel's bounds and each ring's seam.
  for (const panel of panels) for (const b of panel.bounds) cloth.split((v) => b(cloth.point(v), cloth.normal(v)));
  for (const panel of panels) {
    if (!panel.ring) continue;
    const ring = panel.ring;
    const wraps = (t: number): boolean => {
      const ids = [0, 1, 2].map((k) => cloth.idx[t * 3 + k]!);
      const c = ids.map((v) => cloth.point(v));
      if (!ids.every((v) => panel.on(cloth.point(v), cloth.normal(v)))) return false;
      const s = c.map((p) => onRing(ring, p).turn);
      return Math.max(...s) - Math.min(...s) > 0.5;
    };
    cloth.split((v) => seamSide(ring, cloth.point(v)).side, wraps);
  }
  for (let k = 0; k < def.hems.length; k++) {
    const { frame, reach } = reaches[k]!;
    along.push(Array.from({ length: cloth.points }, (_, v) => {
      const f = frameAt(frame, cloth.point(v));
      return reachAt(reach, f.turn) - f.along;
    }));
  }
  const lifted = lift(def, rest, skin, cloth, along);
  const made = finish(def, rest, skin, cloth, lifted, panels, report);
  const reach: Record<string, number[]> = {};
  def.hems.forEach((h, k) => {
    // How far the curve is past the farthest hidden point near the hem, at each level.
    reach[h.name] = levels.map((lv) => {
      let worst = Infinity;
      const { reach: r, frame } = reaches[k]!;
      for (const v of zonePoints(lv, hidden)) {
        const p: Vec = [lv.positions[v * 3]!, lv.positions[v * 3 + 1]!, lv.positions[v * 3 + 2]!];
        if (!h.near(p, rest)) continue;
        const f = frameAt(frame, p);
        worst = Math.min(worst, reachAt(r, f.turn) - f.along);
      }
      return worst;
    });
  });
  return { ...made, reach };
}

/** Lifts the cloth off the skin: each point out along the skin's normal by its offset, then smoothed, never nearer than `least`. */
function lift(def: CutDef, rest: Rest, skin: Skin, cloth: Cloth, inside: number[][]): Lifted {
  const n = cloth.points;
  const zoneOf = new Int32Array(n).fill(-1);
  for (let t = 0; t < cloth.triangles; t++) for (let k = 0; k < 3; k++) {
    const v = cloth.idx[t * 3 + k]!;
    if (zoneOf[v]! < 0 || def.covers.includes(cloth.zone[t]!)) zoneOf[v] = cloth.zone[t]!;
  }
  const insideOf: number[] = [], hemOf: number[] = [];
  for (let v = 0; v < n; v++) {
    let best = Infinity, which = -1;
    def.hems.forEach((h, k) => {
      if (!h.near(cloth.point(v), rest) && !h.into.includes(zoneOf[v]!)) return;
      if (inside[k]![v]! < best) [best, which] = [inside[k]![v]!, k];
    });
    insideOf.push(best);
    hemOf.push(which);
  }
  const want = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let o = def.offset(zoneOf[v]!, cloth.point(v), rest);
    const h = hemOf[v]! >= 0 ? def.hems[hemOf[v]!]! : null;
    if (h?.flare) o += h.flare * Math.max(0, 1 - insideOf[v]! / (h.flareOver ?? 0.08)) ** 2;
    want[v] = Math.max(def.least, o);
  }
  const q: number[] = [];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) q.push(cloth.p[v * 3 + a]! + cloth.n[v * 3 + a]! * want[v]!);
  // Taubin's smoothing, which does not shrink, along the border on the border alone; then out of the skin where too near.
  const near = cloth.neighbours();
  const border = new Set(cloth.borderEdges().flat());
  const ring = near.map((list, v) => (border.has(v) ? list.filter((u) => border.has(u)) : list));
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const passes = def.smooth ?? 12;
  for (let pass = 0; pass < passes * 2; pass++) {
    const k = pass % 2 === 0 ? 0.5 : -0.53;
    const was = q.slice();
    for (let v = 0; v < n; v++) {
      const list = ring[v]!;
      if (list.length === 0) continue;
      for (let a = 0; a < 3; a++) {
        let s = 0;
        for (const u of list) s += was[u * 3 + a]!;
        q[v * 3 + a] = was[v * 3 + a]! + k * (s / list.length - was[v * 3 + a]!);
      }
    }
    if (pass % 2 === 1) pushOut(skin, q, Array.from(want, (w) => Math.min(w, Math.max(def.least, w * 0.8))), hit);
  }
  pushOut(skin, q, Array.from(want, (w) => Math.min(w, Math.max(def.least, w * 0.8))), hit);
  if (def.drape) hang(def.drape.below(rest), def.drape.zones, skin, cloth, q, want);
  if (def.floor !== undefined) for (let v = 0; v < n; v++) q[v * 3 + 1] = Math.max(def.floor, q[v * 3 + 1]!);
  return { q, inside: insideOf, hemOf };
}

/** How far over the drape's top it fades in, in metres, and the slices' step. */
const DRAPE_FADE = 0.06;
const SLICE = 0.01;

/** Moves each point of the cloth below `below` out to the hull of the skin's slice at its height, by its offset. */
function hang(below: number, zones: readonly number[], skin: Skin, cloth: Cloth, q: number[], want: Float64Array): void {
  const keep = new Set(zones);
  const slices = new Map<number, [number, number][]>();
  for (const v of zonePoints(skin, keep)) {
    const y = skin.positions[v * 3 + 1]!;
    if (y > below + SLICE) continue;
    const k = Math.round(y / SLICE);
    (slices.get(k) ?? slices.set(k, []).get(k)!).push([skin.positions[v * 3]!, skin.positions[v * 3 + 2]!]);
  }
  const hulls = new Map<number, { h: [number, number][]; c: [number, number] }>();
  const hullAt = (k: number) => {
    let got = hulls.get(k);
    if (!got) {
      const pts = [...(slices.get(k - 1) ?? []), ...(slices.get(k) ?? []), ...(slices.get(k + 1) ?? [])];
      const h = convexHull(pts);
      got = { h, c: [h.reduce((s, p) => s + p[0], 0) / (h.length || 1), h.reduce((s, p) => s + p[1], 0) / (h.length || 1)] };
      hulls.set(k, got);
    }
    return got;
  };
  for (let v = 0; v < q.length / 3; v++) {
    const y = cloth.p[v * 3 + 1]!;
    if (y > below) continue;
    const share = Math.min(1, (below - y) / DRAPE_FADE);
    const { h, c } = hullAt(Math.round(y / SLICE));
    if (h.length < 3) continue;
    const dx = q[v * 3]! - c[0], dz = q[v * 3 + 2]! - c[1];
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const reach = hullReach(h, c, Math.atan2(dz, dx)) + want[v]!;
    if (r >= reach) continue;
    const to = r + (reach - r) * share;
    q[v * 3] = c[0] + (dx / r) * to;
    q[v * 3 + 2] = c[1] + (dz / r) * to;
  }
}

/** Moves each point out of the skin along the skin's normal until it is `least[v]` off it. */
function pushOut(skin: Skin, q: number[], least: readonly number[], hit: Nearest): void {
  for (let v = 0; v < q.length / 3; v++) {
    const [x, y, z] = [q[v * 3]!, q[v * 3 + 1]!, q[v * 3 + 2]!];
    if (!skin.grid.nearest(x, y, z, 0.12, hit)) continue;
    const c = [skin.indices[hit.triangle * 3]!, skin.indices[hit.triangle * 3 + 1]!, skin.indices[hit.triangle * 3 + 2]!];
    const share = [hit.u, hit.v, hit.w];
    const nn = unit([0, 1, 2].map((a) => share.reduce((s, w, k) => s + w * skin.normals[c[k]! * 3 + a]!, 0)));
    const out = (x - hit.x) * nn[0] + (y - hit.y) * nn[1] + (z - hit.z) * nn[2];
    if (out >= least[v]!) continue;
    for (let a = 0; a < 3; a++) q[v * 3 + a] = [hit.x, hit.y, hit.z][a]! + nn[a]! * least[v]!;
  }
}

/** The weights of the skin nearest a point, all thirty, or null where no skin is near. */
function skinWeights(skin: Skin, p: ArrayLike<number>, hit: Nearest, keep?: (t: number) => boolean): Float32Array | null {
  if (!skin.grid.nearest(p[0]!, p[1]!, p[2]!, 0.15, hit, keep)) return null;
  const out = new Float32Array(HUMAN_BONES);
  const share = [hit.u, hit.v, hit.w];
  for (let k = 0; k < 3; k++) {
    const c = skin.indices[hit.triangle * 3 + k]!;
    for (let b = 0; b < HUMAN_BONES; b++) out[b]! += share[k]! * skin.weights[c * HUMAN_BONES + b]!;
  }
  return out;
}

/** The four heaviest of thirty weights, heaviest first, summing to 1; a slot of weight 0 repeats the first bone. */
function fourOf(w: Float32Array): { joints: number[]; weights: number[] } {
  const order = Array.from({ length: HUMAN_BONES }, (_, b) => b).filter((b) => w[b]! > 1e-3).sort((a, b) => w[b]! - w[a]!).slice(0, 4);
  const total = order.reduce((s, b) => s + w[b]!, 0) || 1;
  const joints = [0, 1, 2, 3].map((k) => order[k] ?? order[0] ?? 0);
  const weights = [0, 1, 2, 3].map((k) => (k < order.length ? w[order[k]!]! / total : 0));
  return { joints, weights };
}

/** The outer shell, the turned hems, the sheet's coordinates, the weights and the regions. */
function finish(def: CutDef, rest: Rest, skin: Skin, cloth: Cloth, lifted: Lifted, panels: readonly Panel[], report: string[]): Omit<MadeCut, "reach"> {
  const { q } = lifted;
  const tris = cloth.triangles;
  // Each triangle's panel, and whether its corners on a ring's seam take the far side.
  const panelOf = new Int32Array(tris).fill(-1);
  /** Per triangle, the share round of its middle on its panel's ring. */
  const near = new Float64Array(tris);
  for (let t = 0; t < tris; t++) {
    const ids = [0, 1, 2].map((k) => cloth.idx[t * 3 + k]!);
    const c = ids.map((v) => cloth.point(v));
    const mid: Vec = [0, 1, 2].map((a) => (c[0]![a]! + c[1]![a]! + c[2]![a]!) / 3) as unknown as Vec;
    const midN = unit([0, 1, 2].map((a) => ids.reduce((s, v) => s + cloth.n[v * 3 + a]!, 0)));
    const p = panels.findIndex((pn) => pn.on(mid, midN));
    panelOf[t] = p;
    const ring = p >= 0 ? panels[p]!.ring : undefined;
    // A triangle on a ring's seam takes the side of its corner farthest from it.
    if (ring) {
      const far = c.reduce((best, x) => (Math.abs(seamSide(ring, x).side) > Math.abs(seamSide(ring, best).side) ? x : best), c[0]!);
      near[t] = onRing(ring, far).share;
    }
  }
  const lost = cloth.uv ? 0 : [...panelOf].filter((p) => p < 0).length;
  if (lost) report.push(`${def.name}: ${lost} triangles on no panel of the ${def.sheet} sheet`);
  // Output vertices by cloth point, panel and seam side.
  const positions: number[] = [], uvs: number[] = [], weights: Float32Array[] = [], regions: number[] = [];
  const indices: number[] = [];
  const key = new Map<string, number>();
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const region = (p: Vec, inside: number, hem: number): number[] => {
    const r = def.region?.(p, inside, hem >= 0 ? def.hems[hem]! : null, rest);
    const rib = hem >= 0 ? (def.hems[hem]!.rib ?? 0) : 0;
    const out = [0, 0, 0];
    out[r ?? (rib > 0 && inside < rib ? TRIM : MAIN)] = 1;
    return out;
  };
  const weightsAt = (at: ArrayLike<number>, fallback: Float32Array): Float32Array => skinWeights(skin, at, hit) ?? fallback;
  const vertex = (v: number, t: number): number => {
    const ring = panels[panelOf[t]!]?.ring;
    const shift = ring ? Math.round(near[t]! - onRing(ring, cloth.point(v)).share) : 0;
    const k = `${v} ${panelOf[t]} ${shift}`;
    let i = key.get(k);
    if (i !== undefined) return i;
    i = positions.length / 3;
    key.set(k, i);
    positions.push(q[v * 3]!, q[v * 3 + 1]!, q[v * 3 + 2]!);
    const panel = panels[panelOf[t]!];
    const uv = cloth.uv ? [cloth.uv[v * 2]!, cloth.uv[v * 2 + 1]!] : panel ? panel.uv(cloth.point(v), near[t]!) : [0, 0];
    uvs.push(uv[0]!, uv[1]!);
    weights.push(def.ownWeights ? cloth.w[v]! : weightsAt(q.slice(v * 3, v * 3 + 3), cloth.w[v]!));
    regions.push(...region(cloth.point(v), lifted.inside[v]!, lifted.hemOf[v]!));
    return i;
  };
  const outerOf: number[][] = [];
  for (let t = 0; t < tris; t++) {
    const c = [0, 1, 2].map((k) => vertex(cloth.idx[t * 3 + k]!, t));
    indices.push(...c);
    outerOf.push(c);
  }
  // The turned hems: from each border edge's outer points, in by the cloth's edge, then back inside under it.
  // A cut of its own shape closes itself; only openings cut at hems are turned in.
  const border = def.hems.length ? cloth.borderEdges() : [];
  const edgeTri = new Map<string, number>();
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) edgeTri.set(`${cloth.idx[t * 3 + k]},${cloth.idx[t * 3 + ((k + 1) % 3)]}`, t);
  const facing = def.facing ?? 0.015;
  const EDGE = 0.002;
  const ringOf = new Map<string, { turn: number; back: number }>();
  /** Per border point: the way in along the skin, from its border edges. */
  const inward = new Map<number, number[]>();
  for (const [a, b] of border) {
    const dir = sub(cloth.point(b), cloth.point(a));
    for (const v of [a, b]) {
      const n = [cloth.n[v * 3]!, cloth.n[v * 3 + 1]!, cloth.n[v * 3 + 2]!];
      const inn = cross(n, dir);
      const was = inward.get(v) ?? [0, 0, 0];
      inward.set(v, [was[0]! + inn[0], was[1]! + inn[1], was[2]! + inn[2]]);
    }
  }
  const uvOut = (t: number, a: number, b: number): [number, number] => {
    // Away from the triangle's third corner, across the border edge, on the sheet.
    const corners = [0, 1, 2].map((k) => cloth.idx[t * 3 + k]!);
    const c = corners.find((x) => x !== a && x !== b)!;
    const [ia, ib, ic] = [a, b, c].map((x) => outerOf[t]![corners.indexOf(x)]!);
    const ua = [uvs[ia! * 2]!, uvs[ia! * 2 + 1]!], ub = [uvs[ib! * 2]!, uvs[ib! * 2 + 1]!], uc = [uvs[ic! * 2]!, uvs[ic! * 2 + 1]!];
    let px = -(ub[1]! - ua[1]!), py = ub[0]! - ua[0]!;
    if (px * (uc[0]! - ua[0]!) + py * (uc[1]! - ua[1]!) > 0) [px, py] = [-px, -py];
    const l = Math.hypot(px, py) || 1;
    return [px / l, py / l];
  };
  for (const [a, b] of border) {
    const t = edgeTri.get(`${a},${b}`)!;
    const dirUv = uvOut(t, a, b);
    const ends = [a, b].map((v) => {
      const ring = panels[panelOf[t]!]?.ring;
      const k = `${v} ${panelOf[t]} ${ring ? Math.round(near[t]! - onRing(ring, cloth.point(v)).share) : 0}`;
      let made = ringOf.get(k);
      if (!made) {
        const o = outerOf[t]![[0, 1, 2].find((i) => cloth.idx[t * 3 + i] === v)!]!;
        const n = unit([cloth.n[v * 3]!, cloth.n[v * 3 + 1]!, cloth.n[v * 3 + 2]!]);
        const inn = unit(inward.get(v)!);
        const qo = [positions[o * 3]!, positions[o * 3 + 1]!, positions[o * 3 + 2]!];
        const height = dot(sub(qo, cloth.point(v)), n);
        const edge = Math.min(EDGE, Math.max(0, height - 0.0015));
        const turnAt = [0, 1, 2].map((k2) => qo[k2]! - n[k2]! * edge);
        const backAt0 = [0, 1, 2].map((k2) => cloth.p[v * 3 + k2]! + inn[k2]! * facing);
        // The facing's end lies on the skin there, just off it.
        let backAt = backAt0;
        if (skin.grid.nearest(backAt0[0]!, backAt0[1]!, backAt0[2]!, 0.05, hit)) {
          const c = [skin.indices[hit.triangle * 3]!, skin.indices[hit.triangle * 3 + 1]!, skin.indices[hit.triangle * 3 + 2]!];
          const sh = [hit.u, hit.v, hit.w];
          const nn = unit([0, 1, 2].map((ax) => sh.reduce((s, w, kk) => s + w * skin.normals[c[kk]! * 3 + ax]!, 0)));
          backAt = [hit.x, hit.y, hit.z].map((x, ax) => x + nn[ax]! * Math.min(0.0012, height * 0.5));
        }
        const uv0 = [uvs[o * 2]!, uvs[o * 2 + 1]!];
        const metres = SHEETS[def.sheet].metres;
        const add = (p: number[], du: number): number => {
          const i = positions.length / 3;
          positions.push(...p);
          uvs.push(uv0[0]! + dirUv[0] * du / metres, uv0[1]! + dirUv[1] * du / metres);
          weights.push(weightsAt(p, cloth.w[v]!));
          regions.push(...regions.slice(o * 3, o * 3 + 3));
          return i;
        };
        made = { turn: add(turnAt, EDGE), back: add(backAt, EDGE + facing) };
        ringOf.set(k, made);
      }
      return { outer: outerOf[t]![[0, 1, 2].find((i) => cloth.idx[t * 3 + i] === v)!]!, ...made };
    });
    const [A, B] = ends as [{ outer: number; turn: number; back: number }, { outer: number; turn: number; back: number }];
    // The edge: the outer shell turned in, facing out of the opening; wound as the shell is, a border edge a -> b runs
    // with the cloth on its left, so b, a then the turn is wound away from it.
    indices.push(B.outer, A.outer, A.turn, B.outer, A.turn, B.turn);
    // The facing, both ways, so it hides the gap under the cloth from any side.
    indices.push(B.turn, A.turn, A.back, B.turn, A.back, B.back);
    indices.push(A.turn, B.turn, A.back, B.turn, B.back, A.back);
  }
  report.push(`${def.name}: ${tris} triangles of shell, ${border.length} border edges turned in`);
  // Normals from the made surface, one across a sheet's seams.
  const count = positions.length / 3;
  const w = welded({ positions, indices });
  const nw = new Float64Array(w.positions.length);
  smoothNormals(w.positions, w.indices, nw);
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) for (let a = 0; a < 3; a++) normals[v * 3 + a] = nw[w.of[v]! * 3 + a]!;
  const joints = new Uint8Array(count * 4), wts = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    let four: { joints: number[]; weights: number[] };
    if (def.rigid) {
      const b = def.rigid(weights[v]!, [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!]);
      four = { joints: [b, b, b, b], weights: [1, 0, 0, 0] };
    } else four = fourOf(weights[v]!);
    joints.set(four.joints, v * 4);
    wts.set(four.weights, v * 4);
  }
  return {
    body: { positions: Float32Array.from(positions), normals, uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices), joints, weights: wts, sections: new Uint8Array(indices.length / 3) },
    regions: Float32Array.from(regions),
    report,
  };
}

