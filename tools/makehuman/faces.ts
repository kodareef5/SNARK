// Bakes the 32 face modifiers of a look (bytes 40 to 71) as sparse deltas on a fitted MakeHuman body (fit.ts): each
// modifier's MakeHuman targets added to the shaped base, faded out across the neck, carried through the fit (the head
// moves as one piece), with the eyes, brows, lashes, teeth and tongue bound again on the moved base. A modifier's side is
// cut only where it alone would carry a vertex out of the hit head grown by FACE_SLACK: the client holds each summed face
// inside that bound as it blends it (shared/people/faces.ts clampFace). The face rows (jaw, lids, eyes) come from
// MakeHuman's own weights.

import { dirname, join } from "node:path";
import { B_HEAD, SLOT_HEAD } from "../../shared/anim/human.ts";
import { SKIN_ZONE_SLOT, skinZoneAt } from "../../shared/anim/skin-zones.ts";
import { FACE_COUNT, HEAD_GROW } from "../../shared/anim/look.ts";
import {
  allowed, blendFace, decodeFaces, drawnAt, encodeFaces, FACE_EYE_L, FACE_EYE_R, FACE_JAW, FACE_LID_L, FACE_LID_R, FACE_PIVOTS, FACE_ROWS, headBound, type FaceRows, type FaceSide, type FaceTable,
  type HeadBound,
} from "../../shared/people/faces.ts";
import { fit, readBinding, type Binding } from "./bind.ts";
import { fitBody, fitStages, PART_NAMES, type FitOptions, type FitStages, type FittedBody, type Sex } from "./fit.ts";
import { BASE_OBJ, DEFAULT_SKELETON, MAKEHUMAN, TARGETS } from "./index.ts";
import { readSkeleton, type Skeleton } from "./skeleton.ts";
import { readWeights } from "./weights.ts";

export { allowed, drawnAt, headBound, OUTSIDE_TOLERANCE, type HeadBound } from "../../shared/people/faces.ts";
import { groupVertices, readObj, type ObjMesh } from "./obj.ts";
import { readTarget, type Target } from "./target.ts";

/** A face modifier: the targets it adds at -1 and at +1, each under TARGETS; {s} stands for both sides, l and r. */
export interface FaceModifier {
  readonly name: string;
  readonly minus: readonly string[];
  readonly plus: readonly string[];
}

const axis = (name: string, stem: string, minus: string, plus: string): FaceModifier => ({ name, minus: [`${stem}-${minus}`], plus: [`${stem}-${plus}`] });

/** In byte order: modifier i is look byte LOOK_FACE + i. MakeHuman's face targets are the same for both sexes. */
export const FACE_MODIFIERS: readonly FaceModifier[] = [
  axis("head age", "head/head-age", "decr", "incr"),
  axis("head fullness", "head/head-fat", "decr", "incr"),
  { name: "oval to round", minus: ["head/head-oval"], plus: ["head/head-round"] },
  { name: "heart to square", minus: ["head/head-invertedtriangular"], plus: ["head/head-square"] },
  axis("forehead slope", "forehead/forehead-trans", "backward", "forward"),
  axis("forehead height", "forehead/forehead-scale-vert", "decr", "incr"),
  axis("brow ridge", "eyebrows/eyebrows-trans", "backward", "forward"),
  axis("brow height", "eyebrows/eyebrows-trans", "down", "up"),
  axis("eye size", "eyes/{s}-eye-scale", "decr", "incr"),
  axis("eye spacing", "eyes/{s}-eye-trans", "in", "out"),
  axis("eye height", "eyes/{s}-eye-trans", "down", "up"),
  axis("eye slant", "eyes/{s}-eye-corner1", "down", "up"),
  axis("eye fold", "eyes/{s}-eye-epicanthus", "in", "out"),
  axis("nose length", "nose/nose-scale-vert", "decr", "incr"),
  axis("nose width", "nose/nose-scale-horiz", "decr", "incr"),
  axis("nose projection", "nose/nose-scale-depth", "decr", "incr"),
  axis("nose bridge", "nose/nose-hump", "decr", "incr"),
  axis("nose tip", "nose/nose-point", "down", "up"),
  axis("nostrils", "nose/nose-flaring", "decr", "incr"),
  axis("cheekbones", "cheek/{s}-cheek-bones", "decr", "incr"),
  axis("cheek fullness", "cheek/{s}-cheek-volume", "decr", "incr"),
  axis("mouth width", "mouth/mouth-scale-horiz", "decr", "incr"),
  axis("upper lip", "mouth/mouth-upperlip-volume", "decr", "incr"),
  axis("lower lip", "mouth/mouth-lowerlip-volume", "decr", "incr"),
  axis("mouth corners", "mouth/mouth-angles", "down", "up"),
  axis("chin prominence", "chin/chin-prominent", "decr", "incr"),
  axis("chin width", "chin/chin-width", "decr", "incr"),
  axis("chin height", "chin/chin-height", "decr", "incr"),
  axis("jaw width", "chin/chin-bones", "decr", "incr"),
  axis("jaw angle", "chin/chin-jaw-drop", "decr", "incr"),
  axis("ear size", "ears/{s}-ear-scale", "decr", "incr"),
  axis("ear angle", "ears/{s}-ear-wing", "decr", "incr"),
];
if (FACE_MODIFIERS.length !== FACE_COUNT) throw new Error(`${FACE_MODIFIERS.length} face modifiers for ${FACE_COUNT} face bytes`);

/** Target files of a side, both sides of a {s} name. */
export function sideFiles(names: readonly string[]): string[] {
  return names.flatMap((n) => (n.includes("{s}") ? ["l", "r"].map((s) => n.replace("{s}", s)) : [n])).map((n) => `${n}.target`);
}

/** The bound parts, as fit.ts binds them, in the order of PART_NAMES after the body. */
const PART_FILES = [
  "system-assets/eyes/high-poly/high-poly.mhclo",
  "system-assets/eyebrows/eyebrow001/eyebrow001.mhclo",
  "system-assets/eyelashes/eyelashes01/eyelashes01.mhclo",
  "system-assets/teeth/teeth_base/teeth_base.mhclo",
  "system-assets/tongue/tongue01/tongue01.mhclo",
];
/** How far inside its bound a cut puts a vertex, in metres, for the rounding that follows. */
const ROUNDING_ROOM = 1e-4;
/** A delta under this, in metres on every axis, is left out. */
const LEAST = 5e-5;

// ---- The mirror, read once ----------------------------------------------------------------------------------------

interface Parts {
  base: ObjMesh;
  bindings: Binding[];
  meshes: ObjMesh[];
}
let parts: Parts | null = null;
function readParts(): Parts {
  if (parts) return parts;
  const bindings = PART_FILES.map((f) => readBinding(join(MAKEHUMAN, f)));
  const meshes = PART_FILES.map((f, k) => readObj(join(MAKEHUMAN, dirname(f), bindings[k]!.objFile)));
  return (parts = { base: readObj(BASE_OBJ), bindings, meshes });
}

const targets = new Map<string, Target>();
function target(file: string): Target {
  let t = targets.get(file);
  if (!t) targets.set(file, (t = readTarget(join(TARGETS, file))));
  return t;
}

// ---- Where each fitted vertex came from ---------------------------------------------------------------------------

/** For each vertex of a FittedBody: its part (0 the body) and the vertex of the base or of the part's mesh it was made from. */
export interface Sources {
  readonly part: Uint8Array;
  readonly vertex: Uint32Array;
}

/** fitBody's vertex order, made again: a vertex per position and UV pair in face order, quads cut on the shorter diagonal. */
function order(mesh: ObjMesh, faces: ArrayLike<number>, at: Float64Array, part: number, outPart: number[], outVertex: number[]): void {
  const seen = new Set<number>();
  const vertex = (corner: number): void => {
    const v = mesh.corners[corner]!;
    const key = v * 65536 + mesh.cornerUvs[corner]!;
    if (seen.has(key)) return;
    seen.add(key);
    outPart.push(part);
    outVertex.push(v);
  };
  const d2 = (a: number, b: number): number => {
    const va = mesh.corners[a]! * 3, vb = mesh.corners[b]! * 3;
    return (at[va]! - at[vb]!) ** 2 + (at[va + 1]! - at[vb + 1]!) ** 2 + (at[va + 2]! - at[vb + 2]!) ** 2;
  };
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    const s = mesh.faceStart[f]!, e = mesh.faceStart[f + 1]!;
    const corners = e - s === 4 ? (d2(s, s + 2) <= d2(s + 1, s + 3) ? [s, s + 1, s + 2, s, s + 2, s + 3] : [s, s + 1, s + 3, s + 1, s + 2, s + 3]) : [];
    if (e - s !== 4) for (let c = s + 1; c + 1 < e; c++) corners.push(s, c, c + 1);
    for (const c of corners) vertex(c);
  }
}

/** The fitted body's sources, checked against its positions: fit.ts building its vertices otherwise is an error here. */
export function sourcesOf(body: FittedBody, stages: FitStages): Sources {
  const { base, bindings, meshes } = readParts();
  const part: number[] = [];
  const vertex: number[] = [];
  const placed: Float64Array[] = [stages.landed];
  order(base, base.groups.get("body")!, stages.landed, 0, part, vertex);
  const decimetres = Float32Array.from(stages.landed, (c) => c * 10);
  bindings.forEach((b, k) => {
    const metres = Float64Array.from(fit(b, decimetres), (c) => c / 10);
    placed.push(metres);
    order(meshes[k]!, Uint32Array.from({ length: meshes[k]!.faceStart.length - 1 }, (_, f) => f), metres, k + 1, part, vertex);
  });
  if (part.length * 3 !== body.positions.length) throw new Error(`fit.ts made ${body.positions.length / 3} vertices, not the ${part.length} its faces give`);
  for (let i = 0; i < part.length; i++) {
    const at = placed[part[i]!]!;
    for (let k = 0; k < 3; k++) {
      if (Math.fround(at[vertex[i]! * 3 + k]!) !== body.positions[i * 3 + k]) throw new Error(`fitted vertex ${i} is not where its source puts it`);
    }
  }
  return { part: Uint8Array.from(part), vertex: Uint32Array.from(vertex) };
}

// ---- The deltas ---------------------------------------------------------------------------------------------------

/** How much of a head delta a vertex takes, from its weight on the head bone: none below the neck, all over the face. */
export function fade(headWeight: number): number {
  const t = headWeight <= 0 ? 0 : headWeight >= 1 ? 1 : headWeight;
  return t * t * (3 - 2 * t);
}

/** How far from the head slot's border a vertex takes all of its fade, in metres along the skin. */
export const BORDER_RAMP = 0.02;

/**
 * Each fitted vertex's slot border: whether a triangle outside the head slot uses it, its triangle's skin zone found as
 * tools/pack/body.ts finds it. The client's head is the head slot, so these never move.
 */
export function onSlotBorder(body: FittedBody): Uint8Array {
  const n = body.positions.length / 3;
  const zone = Uint8Array.from({ length: n }, (_, v) => skinZoneAt(body.bone[v]!, body.positions[v * 3]!, body.positions[v * 3 + 1]!, body.positions[v * 3 + 2]!, body.rest));
  const out = new Uint8Array(n);
  for (let t = 0; t < body.indices.length / 3; t++) {
    const a = body.indices[t * 3]!, b = body.indices[t * 3 + 1]!, c = body.indices[t * 3 + 2]!;
    if (SKIN_ZONE_SLOT[zone[b] === zone[c] ? zone[b]! : zone[a]!] !== SLOT_HEAD) out[a] = out[b] = out[c] = 1;
  }
  return out;
}

/**
 * The share of a head delta each base vertex takes: its fade by head weight, times a ramp from nothing on the head
 * slot's border to all of it BORDER_RAMP along the skin above. MakeHuman's head weight runs down the throat into the
 * chest's triangles, so the weight alone would move the border.
 */
function shares(stages: FitStages, body: FittedBody, src: Sources): Float64Array {
  const n = stages.landed.length / 3;
  const out = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (stages.skin.bones[v * 4 + k] === B_HEAD) w += stages.skin.weights[v * 4 + k]!;
    out[v] = fade(w);
  }
  // Distances along the base's body edges from the border, by Dijkstra.
  const { base } = readParts();
  const dist = new Float64Array(stages.body).fill(Infinity);
  const border = onSlotBorder(body);
  for (let i = 0; i < border.length; i++) if (border[i] && src.part[i] === 0) dist[src.vertex[i]!] = 0;
  const next: number[][] = Array.from({ length: stages.body }, () => []);
  for (const f of base.groups.get("body")!) {
    const s = base.faceStart[f]!, e = base.faceStart[f + 1]!;
    for (let c = s; c < e; c++) {
      const a = base.corners[c]!, b = base.corners[c + 1 < e ? c + 1 : s]!;
      next[a]!.push(b);
      next[b]!.push(a);
    }
  }
  const p = stages.landed;
  const heap = new Heap();
  for (let v = 0; v < stages.body; v++) if (dist[v] === 0) heap.push(0, v);
  while (heap.size > 0) {
    const [d, v] = heap.pop();
    if (d > dist[v]! || d >= BORDER_RAMP) continue;
    for (const u of next[v]!) {
      const nd = d + Math.hypot(p[u * 3]! - p[v * 3]!, p[u * 3 + 1]! - p[v * 3 + 1]!, p[u * 3 + 2]! - p[v * 3 + 2]!);
      if (nd < dist[u]!) {
        dist[u] = nd;
        heap.push(nd, u);
      }
    }
  }
  for (let v = 0; v < stages.body; v++) if (dist[v]! < BORDER_RAMP) out[v]! *= fade(dist[v]! / BORDER_RAMP);
  return out;
}

/** A min-heap of (key, value) pairs; ties go to the smaller value, so the order never depends on the engine. */
class Heap {
  private keys: number[] = [];
  private values: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  private less(i: number, j: number): boolean {
    return this.keys[i]! < this.keys[j]! || (this.keys[i] === this.keys[j] && this.values[i]! < this.values[j]!);
  }
  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j]!, this.keys[i]!];
    [this.values[i], this.values[j]] = [this.values[j]!, this.values[i]!];
  }
  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    for (let i = this.keys.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0]!, this.values[0]!];
    const k = this.keys.pop()!, v = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = k;
      this.values[0] = v;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * A side's targets summed on every base vertex, in metres, each taking its share (shares()). The fit turns no bone above
 * the hips and lands the head with one move, so a delta on the shaped base is the same delta on the landed one.
 */
function baseDelta(files: readonly string[], share: Float64Array): Float64Array {
  const d = new Float64Array(share.length * 3);
  for (const file of files) {
    const t = target(file);
    for (let i = 0; i < t.vertices.length; i++) for (let k = 0; k < 3; k++) d[t.vertices[i]! * 3 + k]! += t.deltas[i * 3 + k]! / 10;
  }
  for (let v = 0; v < share.length; v++) for (let k = 0; k < 3; k++) d[v * 3 + k]! *= share[v]!;
  return d;
}

/** A base delta on the fitted body's vertices: the body's own, and the bound parts' bound again on the moved base. */
function fittedDelta(d: Float64Array, stages: FitStages, src: Sources, count: number): FaceSide {
  const { bindings } = readParts();
  const before = Float32Array.from(stages.landed, (c) => c * 10);
  const after = Float32Array.from(stages.landed, (c, i) => (c + d[i]!) * 10);
  const moved = bindings.map((b) => {
    const a = fit(b, before), z = fit(b, after);
    return Float64Array.from(z, (c, i) => (c - a[i]!) / 10);
  });
  const vertices: number[] = [];
  const deltas: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = src.part[i] === 0 ? d : moved[src.part[i]! - 1]!;
    const v = src.vertex[i]! * 3;
    const x = at[v]!, y = at[v + 1]!, z = at[v + 2]!;
    if (Math.abs(x) < LEAST && Math.abs(y) < LEAST && Math.abs(z) < LEAST) continue;
    vertices.push(i);
    deltas.push(x, y, z);
  }
  return { vertices: Uint32Array.from(vertices), deltas: Float32Array.from(deltas) };
}

// ---- The bound ----------------------------------------------------------------------------------------------------

/** The head's stretch on each axis, 1 or HEAD_GROW: a body is drawn at most this grown, and the bound is checked at each. */
export const GROWTHS: readonly (readonly number[])[] = Array.from({ length: 8 }, (_, c) => [0, 1, 2].map((k) => ((c >> k) & 1 ? HEAD_GROW : 1)));

/** The nearest point of the capsule's axis to p, written to out. */
function nearestOnAxis(bound: HeadBound, p: readonly number[], out: number[]): void {
  const sx = bound.b[0]! - bound.a[0]!, sy = bound.b[1]! - bound.a[1]!, sz = bound.b[2]! - bound.a[2]!;
  const l2 = sx * sx + sy * sy + sz * sz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0]! - bound.a[0]!) * sx + (p[1]! - bound.a[1]!) * sy + (p[2]! - bound.a[2]!) * sz) / l2)) : 0;
  out[0] = bound.a[0]! + t * sx;
  out[1] = bound.a[1]! + t * sy;
  out[2] = bound.a[2]! + t * sz;
}

/** How far p is from the capsule's axis. */
export function axisDistance(bound: HeadBound, p: readonly number[]): number {
  const c = [0, 0, 0];
  nearestOnAxis(bound, p, c);
  return Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!);
}

/**
 * A checked vertex at one stretch: how far the neutral head puts it from the axis, how far it may be, and each side's
 * delta that moves it as three parts: outward from the axis, and along two directions across that. Any face moves it
 * by at most one side of each modifier.
 */
interface Probe {
  d0: number;
  limit: number;
  /** Its sides, increasing, minus then plus of each modifier: side j is modifier j >> 1. */
  side: Uint16Array;
  /** Outward, across and across again, three a side. */
  part: Float64Array;
}

/** The sums worst() leaves: the outward reach and each across reach, for the cut to weigh sides by. */
const reach = [0, 0, 0];

/**
 * The farthest any face can put the probe's vertex from the axis, each side scaled by `k`, measured from the axis point
 * nearest the neutral vertex. Each of the three parts is bounded alone by the sum of each modifier's worst choice of
 * none, minus or plus, so no face goes past it.
 */
function worst(p: Probe, k: Float64Array): number {
  let outP = 0, outN = 0, uP = 0, uN = 0, wP = 0, wN = 0;
  let m = -1, mo = 0, mno = 0, mu = 0, mnu = 0, mw = 0, mnw = 0;
  for (let e = 0; e <= p.side.length; e++) {
    const j = e < p.side.length ? p.side[e]! : -2;
    if (j >> 1 !== m) {
      outP += mo; outN += mno; uP += mu; uN += mnu; wP += mw; wN += mnw;
      mo = mno = mu = mnu = mw = mnw = 0;
      m = j >> 1;
    }
    if (j < 0) break;
    const s = k[j]!, o = s * p.part[e * 3]!, u = s * p.part[e * 3 + 1]!, w = s * p.part[e * 3 + 2]!;
    mo = Math.max(mo, o); mno = Math.max(mno, -o);
    mu = Math.max(mu, u); mnu = Math.max(mnu, -u);
    mw = Math.max(mw, w); mnw = Math.max(mnw, -w);
  }
  const radial = Math.max(p.d0 + outP, Math.abs(p.d0 - outN));
  reach[0] = radial;
  reach[1] = Math.max(uP, uN);
  reach[2] = Math.max(wP, wN);
  return Math.sqrt(radial * radial + reach[1] * reach[1] + reach[2] * reach[2]);
}

/** The vertices the bound holds: those drawn on the head, and every bound part. */
function checkedVertex(body: FittedBody, src: Sources, i: number): boolean {
  return src.part[i] !== 0 || body.bone[i] === B_HEAD;
}

function probes(body: FittedBody, src: Sources, sides: readonly FaceSide[], bound: HeadBound): Probe[] {
  const count = body.positions.length / 3;
  // Each vertex's entries: side and index in it, in side order.
  const lists: number[][] = Array.from({ length: count }, () => []);
  sides.forEach((s, j) => s.vertices.forEach((v, i) => lists[v]!.push(j, i)));
  const out: Probe[] = [];
  const q = [0, 0, 0], c = [0, 0, 0];
  const axisDir = unit3([bound.b[0]! - bound.a[0]!, bound.b[1]! - bound.a[1]!, bound.b[2]! - bound.a[2]!], [0, 1, 0]);
  for (let i = 0; i < count; i++) {
    const list = lists[i]!;
    if (list.length === 0 || !checkedVertex(body, src, i)) continue;
    for (const grow of GROWTHS) {
      drawnAt(bound, grow, body.positions[i * 3]!, body.positions[i * 3 + 1]!, body.positions[i * 3 + 2]!, q);
      nearestOnAxis(bound, q, c);
      const r = [q[0]! - c[0]!, q[1]! - c[1]!, q[2]! - c[2]!];
      const d0 = Math.hypot(r[0]!, r[1]!, r[2]!);
      // Any three directions at right angles bound a move; outward, along the axis and around it bound it closest.
      const n = unit3(r, [0, 0, 1]);
      const e1 = unit3(sub3(axisDir, n, dot3(axisDir, n)), Math.abs(n[0]!) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
      const e1n = unit3(sub3(e1, n, dot3(e1, n)), [0, 1, 0]);
      const e2 = [n[1]! * e1n[2]! - n[2]! * e1n[1]!, n[2]! * e1n[0]! - n[0]! * e1n[2]!, n[0]! * e1n[1]! - n[1]! * e1n[0]!];
      const side = new Uint16Array(list.length / 2);
      const part = new Float64Array(side.length * 3);
      for (let e = 0; e < side.length; e++) {
        const j = list[e * 2]!, at = list[e * 2 + 1]! * 3, d = sides[j]!.deltas;
        const v = [grow[0]! * d[at]!, grow[1]! * d[at + 1]!, grow[2]! * d[at + 2]!];
        side[e] = j;
        part[e * 3] = dot3(v, n);
        part[e * 3 + 1] = dot3(v, e1n);
        part[e * 3 + 2] = dot3(v, e2);
      }
      out.push({ d0, limit: allowed(bound, d0), side, part });
    }
  }
  return out;
}

const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub3 = (a: readonly number[], b: readonly number[], s: number): number[] => [a[0]! - s * b[0]!, a[1]! - s * b[1]!, a[2]! - s * b[2]!];
/** `a` at unit length, or `or` where `a` is too short to have a direction. */
function unit3(a: readonly number[], or: readonly number[]): number[] {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return l > 1e-9 ? [a[0]! / l, a[1]! / l, a[2]! / l] : [...or];
}

/**
 * Cuts each side's scale in `k` (minus then plus of each modifier) only where that side alone would carry a vertex out
 * of the bound: to the largest scale that keeps every vertex it moves inside, a little short for the rounding after.
 * Faces that sum several sides are held inside by clampFace as they are blended.
 */
function aloneCuts(ps: readonly Probe[], k: Float64Array): void {
  for (const p of ps) {
    const limit = p.limit - ROUNDING_ROOM;
    for (let e = 0; e < p.side.length; e++) {
      const j = p.side[e]!, o = p.part[e * 3]!, u = p.part[e * 3 + 1]!, w = p.part[e * 3 + 2]!;
      const s = k[j]!;
      if (Math.hypot(p.d0 + s * o, s * u, s * w) <= p.limit) continue;
      // The largest scale t with (d0 + t o)^2 + t^2 (u^2 + w^2) at the limit.
      const a = o * o + u * u + w * w, b = p.d0 * o, c = p.d0 * p.d0 - limit * limit;
      k[j] = Math.max(0, Math.min(s, (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a));
    }
  }
}

/** The farthest one side alone puts a vertex past what it may reach, in metres: at most 0 when every side keeps inside. */
function aloneWorst(ps: readonly Probe[]): number {
  let over = -Infinity;
  for (const p of ps) for (let e = 0; e < p.side.length; e++) over = Math.max(over, Math.hypot(p.d0 + p.part[e * 3]!, p.part[e * 3 + 1]!, p.part[e * 3 + 2]!) - p.limit);
  return over;
}

const scaled = (s: FaceSide, k: number): FaceSide => ({ vertices: s.vertices, deltas: Float32Array.from(s.deltas, (d) => d * k) });

// ---- Face rows ----------------------------------------------------------------------------------------------------

/** The MakeHuman joints face rows turn about, in the order of shared/people/faces.ts PIVOT_. */
const PIVOT_JOINTS = ["jaw____head", "eye.L____head", "eye.R____head"];

let skeleton: Skeleton | null = null;
/** Per base vertex, the share of its MakeHuman weight on the bones of each face row, FACE_ROWS a vertex. */
let rowWeights: Float64Array | null = null;

/** The row of each MakeHuman bone: the jaw and every bone under it, each upper lid, each eye; -1 for the rest. */
function rowOfBones(skel: Skeleton): Int8Array {
  const index = new Map(skel.bones.map((b, i) => [b.name, i]));
  const own: Readonly<Record<string, number>> = { "jaw": FACE_JAW, "orbicularis03.L": FACE_LID_L, "orbicularis03.R": FACE_LID_R, "eye.L": FACE_EYE_L, "eye.R": FACE_EYE_R };
  return Int8Array.from(skel.bones, (b) => {
    for (let at = index.get(b.name)!; at >= 0; at = skel.bones[at]!.parent) {
      const name = skel.bones[at]!.name;
      if (own[name] !== undefined) return own[name]!;
    }
    return -1;
  });
}

function readRows(): { skel: Skeleton; rows: Float64Array } {
  if (skeleton && rowWeights) return { skel: skeleton, rows: rowWeights };
  const skel = readSkeleton(DEFAULT_SKELETON);
  const weights = readWeights(join(dirname(DEFAULT_SKELETON), skel.weightsFile));
  const n = readParts().base.positions.length / 3;
  const rowOf = rowOfBones(skel);
  const sum = new Float64Array(n), rows = new Float64Array(n * FACE_ROWS);
  skel.bones.forEach((b, i) => {
    const w = weights.bones.get(b.name);
    if (!w) return;
    for (let e = 0; e < w.vertices.length; e++) {
      const v = w.vertices[e]!, x = w.weights[e]!;
      if (!(x > 0)) continue;
      sum[v]! += x;
      if (rowOf[i]! >= 0) rows[v * FACE_ROWS + rowOf[i]!]! += x;
    }
  });
  for (let v = 0; v < n; v++) for (let r = 0; r < FACE_ROWS; r++) if (sum[v]! > 0) rows[v * FACE_ROWS + r]! /= sum[v]!;
  skeleton = skel;
  rowWeights = rows;
  return { skel, rows };
}

/**
 * Each fitted vertex that follows a face row, its heaviest: the share of its head weight that row takes. A body vertex
 * takes MakeHuman's weights faded to nothing at the head slot's border (shares), a bound one its binding's three.
 */
function faceRows(body: FittedBody, src: Sources, share: Float64Array): FaceRows {
  const { rows } = readRows();
  const { bindings } = readParts();
  const vertices: number[] = [], row: number[] = [], amount: number[] = [];
  const of = new Float64Array(FACE_ROWS);
  for (let i = 0; i < src.part.length; i++) {
    of.fill(0);
    let head = 1;
    if (src.part[i] === 0) {
      const v = src.vertex[i]!;
      for (let r = 0; r < FACE_ROWS; r++) of[r] = rows[v * FACE_ROWS + r]! * share[v]!;
      head = headWeightOf(body, i);
    } else {
      const b = bindings[src.part[i]! - 1]!, at = src.vertex[i]! * 3;
      for (let c = 0; c < 3; c++) for (let r = 0; r < FACE_ROWS; r++) of[r]! += b.weights[at + c]! * rows[b.refs[at + c]! * FACE_ROWS + r]!;
    }
    let best = 0;
    for (let r = 1; r < FACE_ROWS; r++) if (of[r]! > of[best]!) best = r;
    if (!(of[best]! > 0) || !(head > 0)) continue;
    vertices.push(i);
    row.push(best);
    // An eyeball turns whole with its eye.
    amount.push(src.part[i] === PART_EYES && (best === FACE_EYE_L || best === FACE_EYE_R) ? 1 : Math.min(1, of[best]! / head));
  }
  return { vertices: Uint32Array.from(vertices), row: Uint8Array.from(row), share: Float32Array.from(amount) };
}

/** The middle of each pivot's joint on base positions `p` (or moves of them), x, y, z each, added to `out` at `at`. */
function pivotsOn(p: Float64Array, out: Float64Array, at: number): void {
  const { skel } = readRows();
  PIVOT_JOINTS.forEach((joint, k) => {
    const verts = skel.joints.get(joint);
    if (!verts || verts.length === 0) throw new Error(`MakeHuman's skeleton has no joint ${joint}`);
    for (const v of verts) for (let c = 0; c < 3; c++) out[at + k * 3 + c]! += p[v * 3 + c]! / verts.length;
  });
}

// ---- The cook -----------------------------------------------------------------------------------------------------

export interface CookedModifier {
  readonly name: string;
  /** What each side keeps of its targets after the cut, minus then plus: 1 where nothing was cut. */
  readonly kept: readonly [number, number];
  /** The largest move of each side, in millimetres, before the cut. */
  readonly most: readonly [number, number];
}

export interface FaceCook {
  readonly sex: Sex;
  readonly body: FittedBody;
  readonly sources: Sources;
  readonly bound: HeadBound;
  /** What ships: the table as bytes, and as the client decodes it. */
  readonly bytes: Uint8Array;
  readonly table: FaceTable;
  readonly modifiers: readonly CookedModifier[];
  /** Fitted vertices the bound holds, and of those how many the neutral head already has outside it at some stretch. */
  readonly checked: number;
  readonly outsideAtNeutral: number;
  /** The middle of each eye's joint, left then right, three each: at neutral, then each side's move of it as cut. */
  readonly eyeJoints: Float64Array;
  readonly eyeJointMoves: Float64Array;
  /** Each side's worst alone, past what a vertex may reach, in metres: at most 0. */
  readonly aloneOver: number;
}

const cooked = new Map<string, FaceCook>();

/** Lets the next cookFaces cook again rather than return what it kept. */
export function forgetCookedFaces(): void {
  cooked.clear();
}

/** The face table for `sex` fitted to `rig`. The same inputs give the same bytes. */
export function cookFaces(sex: Sex, rig: readonly number[], opts: FitOptions = {}): FaceCook {
  const key = `${sex} ${rig.join(",")} ${JSON.stringify(opts)}`;
  const kept = cooked.get(key);
  if (kept) return kept;
  const stages = fitStages(sex, rig, opts);
  const body = fitBody(sex, rig, opts);
  const src = sourcesOf(body, stages);
  const count = body.positions.length / 3;
  const share = shares(stages, body, src);
  const sides: FaceSide[] = [];
  const { base } = readParts();
  const eyeGroups = ["joint-l-eye", "joint-r-eye"].map((g) => groupVertices(base, g));
  const eyeJoints = new Float64Array(6);
  const eyeJointMoves = new Float64Array(FACE_COUNT * 2 * 6);
  const middle = (p: Float64Array, out: Float64Array, at: number): void => {
    eyeGroups.forEach((g, e) => {
      for (const v of g) for (let k = 0; k < 3; k++) out[at + e * 3 + k]! += p[v * 3 + k]! / g.length;
    });
  };
  middle(stages.landed, eyeJoints, 0);
  const pivots = new Float64Array(FACE_PIVOTS * 3);
  const pivotMoves = new Float64Array(FACE_COUNT * 2 * FACE_PIVOTS * 3);
  pivotsOn(stages.landed, pivots, 0);
  // MakeHuman's left is the body's +X, as the fit keeps it.
  if (!(pivots[3]! > 0 && pivots[6]! < 0)) throw new Error("the left eye's joint is not on the body's left");
  for (const m of FACE_MODIFIERS) {
    for (const files of [m.minus, m.plus]) {
      const d = baseDelta(sideFiles(files), share);
      middle(d, eyeJointMoves, sides.length * 6);
      pivotsOn(d, pivotMoves, sides.length * FACE_PIVOTS * 3);
      sides.push(fittedDelta(d, stages, src, count));
    }
  }
  const rows = faceRows(body, src, share);
  const bound = headBound(rig);
  const k = new Float64Array(sides.length).fill(1);
  // Cut on the deltas as decoded, so the rounding to steps cannot carry a face out.
  let table: FaceTable = { vertexCount: count, modifiers: [] };
  let bytes: Uint8Array = new Uint8Array();
  for (let round = 0; ; round++) {
    if (round > 20) throw new Error("the face cut and its rounding do not settle");
    const moves = Float32Array.from(pivotMoves, (v, i) => v * k[Math.floor(i / (FACE_PIVOTS * 3))]!);
    const now: FaceTable = {
      vertexCount: count, modifiers: FACE_MODIFIERS.map((_, m) => ({ minus: scaled(sides[m * 2]!, k[m * 2]!), plus: scaled(sides[m * 2 + 1]!, k[m * 2 + 1]!) })),
      rows, pivots: Float32Array.from(pivots), pivotMoves: moves,
    };
    bytes = encodeFaces(now);
    table = decodeFaces(bytes);
    const decoded = table.modifiers.flatMap((m) => [m.minus, m.plus]);
    const ps = probes(body, src, decoded, bound);
    const step = new Float64Array(sides.length).fill(1);
    aloneCuts(ps, step);
    if (step.every((s) => s === 1)) break;
    for (let j = 0; j < k.length; j++) k[j]! *= step[j]!;
  }
  const most = (s: FaceSide): number => {
    let m = 0;
    for (let i = 0; i < s.vertices.length; i++) m = Math.max(m, Math.hypot(s.deltas[i * 3]!, s.deltas[i * 3 + 1]!, s.deltas[i * 3 + 2]!));
    return m * 1000;
  };
  const neutral = probes(body, src, table.modifiers.flatMap((m) => [m.minus, m.plus]), bound);
  const checkedSet = new Set<number>();
  for (const side of table.modifiers.flatMap((m) => [m.minus, m.plus])) for (const v of side.vertices) if (checkedVertex(body, src, v)) checkedSet.add(v);
  let outside = 0;
  for (let i = 0; i < neutral.length; i += GROWTHS.length) if (neutral.slice(i, i + GROWTHS.length).some((p) => p.d0 > bound.r)) outside++;
  const out: FaceCook = {
    sex,
    body,
    sources: src,
    bound,
    bytes,
    table,
    modifiers: FACE_MODIFIERS.map((m, i) => ({ name: m.name, kept: [k[i * 2]!, k[i * 2 + 1]!], most: [most(sides[i * 2]!), most(sides[i * 2 + 1]!)] })),
    checked: checkedSet.size,
    outsideAtNeutral: outside,
    eyeJoints,
    eyeJointMoves: eyeJointMoves.map((v, i) => v * k[Math.floor(i / 6)]!),
    aloneOver: aloneWorst(probes(body, src, table.modifiers.flatMap((m) => [m.minus, m.plus]), bound)),
  };
  cooked.set(key, out);
  return out;
}

/** The farthest any face of the table puts a checked vertex past what it may reach, in metres: at most 0 when the bound holds. */
export function worstOver(c: FaceCook): number {
  const k = new Float64Array(c.table.modifiers.length * 2).fill(1);
  let over = -Infinity;
  for (const p of probes(c.body, c.sources, c.table.modifiers.flatMap((m) => [m.minus, m.plus]), c.bound)) over = Math.max(over, worst(p, k) - p.limit);
  return over;
}

// ---- Measures ----------------------------------------------------------------------------------------------------

const PART_EYES = PART_NAMES.indexOf("eyes");
const MOUTH_PARTS = [PART_NAMES.indexOf("teeth"), PART_NAMES.indexOf("tongue")];

/** A fitted vertex's weight on the head bone. */
export function headWeightOf(body: FittedBody, i: number): number {
  let w = 0;
  for (let k = 0; k < 4; k++) if (body.joints[i * 4 + k] === B_HEAD) w += body.weights[i * 4 + k]!;
  return w;
}

/** The fitted body with a face's values (-1..1, one a modifier) summed on, as the client will sum it. */
export function faceOn(c: FaceCook, values: ArrayLike<number>): Float32Array {
  return blendFace(c.table, values, c.body.positions, new Float32Array(c.body.positions.length));
}

export interface Seating {
  /** How far each eye's middle moves from its joint's middle, the farther of the two, in millimetres. */
  readonly eyeMm: number;
  /** Teeth and tongue vertices through the skin (skin just behind them and none in front), on this face and on the neutral one. */
  readonly mouthOut: number;
  readonly mouthOutNeutral: number;
}

/** Whether the eyes stay in their sockets and the teeth and tongue behind the lips on the face of `values`. */
export function seating(c: FaceCook, values: ArrayLike<number>): Seating {
  const body = c.body;
  const at = faceOn(c, values);
  const n = at.length / 3;
  let eyeMm = 0;
  for (let e = 0; e < 2; e++) {
    let x = 0, y = 0, z = 0, count = 0, x0 = 0, y0 = 0, z0 = 0;
    for (let i = 0; i < n; i++) {
      if (c.sources.part[i] !== PART_EYES || (body.positions[i * 3]! > 0) !== (e === 0)) continue;
      x += at[i * 3]! - body.positions[i * 3]!;
      y += at[i * 3 + 1]! - body.positions[i * 3 + 1]!;
      z += at[i * 3 + 2]! - body.positions[i * 3 + 2]!;
      count++;
    }
    for (let m = 0; m < c.table.modifiers.length; m++) {
      const v = values[m] ?? 0;
      if (v === 0) continue;
      const j = (m * 2 + (v > 0 ? 1 : 0)) * 6 + e * 3;
      x0 += Math.abs(v) * c.eyeJointMoves[j]!;
      y0 += Math.abs(v) * c.eyeJointMoves[j + 1]!;
      z0 += Math.abs(v) * c.eyeJointMoves[j + 2]!;
    }
    eyeMm = Math.max(eyeMm, Math.hypot(x / count - x0, y / count - y0, z / count - z0) * 1000);
  }
  return { eyeMm, mouthOut: mouthOut(c, at), mouthOutNeutral: mouthOut(c, body.positions) };
}

/** How near behind a tooth the skin must be for the tooth to be through it, in metres: past the lips' gap the mouth is deep. */
const THROUGH = 0.015;
/** Half the widest gap between the lips that a tooth may show through, in metres. */
const LIP_GAP = 0.002;

/** Teeth and tongue vertices with skin of the head within THROUGH behind them and none in front. */
export function mouthOut(c: FaceCook, at: ArrayLike<number>): number {
  const body = c.body;
  const cell = 0.005;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number): number => Math.floor(x / cell) * 100_000 + Math.floor(y / cell);
  for (let t = 0; t < body.indices.length / 3; t++) {
    if (body.part[t] !== 0) continue;
    const a = body.indices[t * 3]!, b = body.indices[t * 3 + 1]!, d = body.indices[t * 3 + 2]!;
    if (headWeightOf(body, a) === 0 && headWeightOf(body, b) === 0 && headWeightOf(body, d) === 0) continue;
    const xs = [at[a * 3]!, at[b * 3]!, at[d * 3]!], ys = [at[a * 3 + 1]!, at[b * 3 + 1]!, at[d * 3 + 1]!];
    for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++) {
      for (let gy = Math.floor(Math.min(...ys) / cell); gy <= Math.floor(Math.max(...ys) / cell); gy++) {
        const k = gx * 100_000 + gy;
        const list = grid.get(k);
        if (list) list.push(t);
        else grid.set(k, [t]);
      }
    }
  }
  /** What skin a ray forward from (x, y, z) meets: 2 in front of it, 1 within THROUGH behind it only, 0 none. */
  const meets = (x: number, y: number, z: number): number => {
    let found = 0;
    for (const t of grid.get(key(x, y)) ?? []) {
      const a = body.indices[t * 3]! * 3, b = body.indices[t * 3 + 1]! * 3, d = body.indices[t * 3 + 2]! * 3;
      const area = (at[b]! - at[a]!) * (at[d + 1]! - at[a + 1]!) - (at[d]! - at[a]!) * (at[b + 1]! - at[a + 1]!);
      if (area === 0) continue;
      const w0 = ((at[b]! - x) * (at[d + 1]! - y) - (at[d]! - x) * (at[b + 1]! - y)) / area;
      const w1 = ((at[d]! - x) * (at[a + 1]! - y) - (at[a]! - x) * (at[d + 1]! - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const sz = w0 * at[a + 2]! + w1 * at[b + 2]! + w2 * at[d + 2]!;
      if (sz > z) return 2;
      if (sz > z - THROUGH) found = 1;
    }
    return found;
  };
  let out = 0;
  for (let i = 0; i < at.length / 3; i++) {
    if (!MOUTH_PARTS.includes(c.sources.part[i]!)) continue;
    const x = at[i * 3]!, y = at[i * 3 + 1]!, z = at[i * 3 + 2]!;
    // A tooth seen between parted lips has lip a little above or below it in front; one through the skin has none.
    if (meets(x, y, z) === 1 && meets(x, y - LIP_GAP, z) !== 2 && meets(x, y + LIP_GAP, z) !== 2) out++;
  }
  return out;
}
