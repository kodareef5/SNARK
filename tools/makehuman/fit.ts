// Fits MakeHuman's base body to one of the frozen human rigs (rigs.ts beside the human-bodies asset): shaped by
// its macro and measurement targets, re-posed from its A-pose to the rig's T-pose with its own skeleton and weights,
// landed on the rig's joints, and its weights collapsed onto the thirty bones of shared/anim/human.ts.

import { dirname, join } from "node:path";
import { B_PROP_L, B_PROP_R, HUMAN, HUMAN_BONES, SOCKET_EYE } from "../../shared/anim/human.ts";
import { quatMul, quatNormalize, quatRotate } from "../../shared/math/quat.ts";
import { fit, readBinding } from "./bind.ts";
import { BASE_OBJ, DEFAULT_SKELETON, MAKEHUMAN, TARGETS } from "./index.ts";
import { bodyVertexCount, readObj, type ObjMesh } from "./obj.ts";
import { readSkeleton, type Skeleton } from "./skeleton.ts";
import { readTarget, type Target } from "./target.ts";
import { readWeights } from "./weights.ts";

export type Sex = "male" | "female";

export const MATERIAL_SKIN = 0;
export const MATERIAL_EYES = 1;
/** Brows and lashes: cut-out cards. */
export const MATERIAL_BROWS = 2;
/** Teeth and tongue. */
export const MATERIAL_MOUTH = 3;

/** What each triangle was made from, by `FittedBody.part`. */
export const PART_NAMES = ["body", "eyes", "brows", "lashes", "teeth", "tongue"] as const;
const PART_MATERIAL = [MATERIAL_SKIN, MATERIAL_EYES, MATERIAL_BROWS, MATERIAL_BROWS, MATERIAL_MOUTH, MATERIAL_MOUTH];

/** The bound parts, each a binding under the mirror, in the order of PART_NAMES after the body. */
const PART_FILES = [
  "system-assets/eyes/high-poly/high-poly.mhclo",
  "system-assets/eyebrows/eyebrow001/eyebrow001.mhclo",
  "system-assets/eyelashes/eyelashes01/eyelashes01.mhclo",
  "system-assets/teeth/teeth_base/teeth_base.mhclo",
  "system-assets/tongue/tongue01/tongue01.mhclo",
];

export interface FittedBody {
  readonly sex: Sex;
  /** x, y, z a vertex in metres: standing on y = 0, facing +Z, its left at +X, arms out along X. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** u, v a vertex: MakeHuman's base UVs on the body, each part's own on the parts. */
  readonly uvs: Float32Array;
  /** Three a triangle, wound counter-clockwise seen from outside. */
  readonly indices: Uint32Array;
  /** Four bones a vertex, heaviest first; a slot of weight 0 repeats the first bone. */
  readonly joints: Uint8Array;
  /** Four a vertex, summing to 1. */
  readonly weights: Float32Array;
  /** Each vertex's heaviest bone, which is joints[v * 4]. */
  readonly bone: Uint8Array;
  /** A material a triangle: MATERIAL_SKIN and the rest. */
  readonly material: Uint8Array;
  /** A part a triangle, an index into PART_NAMES. */
  readonly part: Uint8Array;
  /** The joints it was fitted to, three a bone of HUMAN: its sex's rig. */
  readonly rest: Float32Array;
  readonly report: FitReport;
}

export interface FitReport {
  /** Every target used and its weight. */
  readonly targets: readonly { readonly file: string; readonly weight: number }[];
  /** The slider values the targets came from: macro values 0 to 1, measurements -1 to 1. */
  readonly sliders: readonly { readonly name: string; readonly value: number }[];
  /** Millimetres from each joint to the rig, a bone: after shaping and re-posing, and after landing. */
  readonly shaped: Float64Array;
  readonly landed: Float64Array;
  /** Each segment's length on the rig over its length before landing, and how far landing shifts its tail across it. */
  readonly stretch: readonly { readonly bone: string; readonly child: string; readonly along: number; readonly across: number }[];
  /** The global move along Z, in metres, that centres the trunk on its capsules. */
  readonly shiftZ: number;
  /** Triangles by part, and the base body's before its helpers were dropped. */
  readonly triangles: Readonly<Record<string, number>>;
  /** The lowest vertex of each foot, in metres, and the squash below each ankle that put it on y = 0. */
  readonly soles: readonly [number, number];
  readonly squash: readonly [number, number];
}

export interface FitOptions {
  /** How the A-pose becomes the T-pose: dual quaternions (default) or linear blend skinning. */
  readonly skinning?: "dual" | "linear";
  /** Macro sliders to hold instead of the sex's defaults; height and proportions are still fitted. */
  readonly macro?: Partial<Pick<Macro, "age" | "muscle" | "weight">>;
}

// ---- The mapping: MakeHuman's bones and joints onto the thirty -----------------------------------------------------

/** Each MakeHuman bone moves the first bone of the thirty its name matches. Sides follow the name's .L or .R. */
const COLLAPSE: readonly (readonly [RegExp, string])[] = [
  [/^(root|spine05|pelvis\.)/, "hips"],
  [/^(spine04|spine03)$/, "spine"],
  [/^(spine02|breast\.)/, "chest"],
  [/^spine01$/, "upperChest"],
  [/^(neck01|neck02)$/, "neck"],
  [/^(clavicle|shoulder01)\./, "shoulder"],
  [/^upperarm0[12]\./, "upperArm"],
  [/^lowerarm0[12]\./, "lowerArm"],
  [/^(wrist|metacarpal\d)\./, "hand"],
  [/^finger1-/, "thumb"],
  [/^finger[2-5]-1\./, "fingers"],
  [/^finger[2-5]-[23]\./, "fingertips"],
  [/^upperleg0[12]\./, "upperLeg"],
  [/^lowerleg0[12]\./, "lowerLeg"],
  [/^foot\./, "foot"],
  [/^toe\d-\d\./, "toe"],
  // The upper neck, the skull, the jaw, the face, the eyes and the tongue.
  [/./, "head"],
];

/** The MakeHuman joint each limb bone of the thirty is fitted by, as a bone whose head it is. */
const OWN: Readonly<Record<string, string>> = {
  shoulder: "clavicle", upperArm: "upperarm01", lowerArm: "lowerarm01", hand: "wrist",
  upperLeg: "upperleg01", lowerLeg: "lowerleg01", foot: "foot", toe: "toe3-1",
  fingers: "finger3-1", fingertips: "finger3-2",
};

/**
 * Bones whose joint is the rig's, carried by another bone: the props, and the thumb, whose rig joint sits two to three
 * centimetres from any of MakeHuman's thumb joints. Moving the thumb there would tear it from the palm.
 */
const CARRIED: readonly (readonly [string, string])[] = [["prop", "hand"], ["thumb", "hand"]];

/**
 * Trunk bones. MakeHuman's spine runs along the back and the rig's through the middle, so a trunk joint sits as high
 * between the hip joints and the head's joint as the rig's does, and as deep as the middle of a slab of the body
 * around its capsule. The head's joint sits below MakeHuman's eyes as the eye socket of the skeleton is above it, so
 * the drawn eyes are where the camera is; its slab is taken at the brow, above the nose. The neck, too thin for a
 * steady slab, sits between the upper chest and the head as on the rig.
 */
const TRUNK = ["hips", "spine", "chest", "upperChest", "neck", "head"];
const EYES = ["eye.L____head", "eye.R____head"];
/** Each trunk bone's slab: half its width and how far above the capsule's middle, in metres. */
const SLAB: Readonly<Record<string, readonly [number, number]>> = { hips: [0.08, 0], spine: [0.07, 0], chest: [0.07, 0], upperChest: [0.07, 0], head: [0.05, 0.02] };
const SLAB_Y = 0.0125;

/** The segments the re-pose turns onto the rig: a bone of the thirty, its tail bone. Parents come first. */
const SEGMENTS: readonly (readonly [string, string])[] = [
  ["shoulder", "upperArm"], ["upperArm", "lowerArm"], ["lowerArm", "hand"], ["hand", "fingers"], ["fingers", "fingertips"],
  ["upperLeg", "lowerLeg"], ["lowerLeg", "foot"], ["foot", "toe"],
];
/** Bones that turn with another: the thumb and fingertips keep their rest curl on the hand and fingers. */
const TURNS_WITH: Readonly<Record<string, string>> = { thumb: "hand", fingertips: "fingers", toe: "foot" };

const HAND_GROUP = ["hand", "fingers", "fingertips", "thumb"];
const FOOT_GROUP = ["foot", "toe"];
/** How far up the forearm and shin the wrist and ankle blends reach, in metres, and the most a ring vertex weighs on the hand or foot. */
const RING = 0.05;
const RING_MOST = 0.45;
/** A weight below this is dropped before the four heaviest are kept. */
const LEAST_WEIGHT = 0.01;
const MOST_INFLUENCES = 4;

const boneNamed = (name: string): number => {
  const b = HUMAN.names.indexOf(name);
  if (b < 0) throw new Error(`no bone ${name}`);
  return b;
};
const sided = (base: string, side: string): number => boneNamed(HUMAN.names.includes(base) ? base : `${base}.${side}`);
const baseName = (b: number): string => HUMAN.names[b]!.replace(/\.[LR]$/, "");
const sideOf = (b: number): string => (HUMAN.names[b]!.endsWith(".R") ? "R" : "L");

/** The bone of the thirty a MakeHuman bone collapses onto. */
export function collapsedBone(name: string): number {
  const side = name.endsWith(".R") ? "R" : "L";
  for (const [pattern, to] of COLLAPSE) if (pattern.test(name)) return sided(to, side);
  throw new Error(`no bone for ${name}`);
}

/** The MakeHuman joint (a vertex group of the skeleton) a limb bone of the thirty is fitted by; null for the trunk and CARRIED bones. */
export function ownJointName(b: number): string | null {
  const own = OWN[baseName(b)];
  return own ? `${own}.${sideOf(b)}____head` : null;
}

// ---- The mirror, read once ----------------------------------------------------------------------------------------

interface Mirror {
  base: ObjMesh;
  body: number;
  skel: Skeleton;
  /** MakeHuman bone index to the thirty. */
  collapse: Int16Array;
  /** Per vertex: MakeHuman bones and weights, normalised. */
  infStart: Uint32Array;
  infBone: Uint16Array;
  infWeight: Float64Array;
  /** Vertices of base faces that are not helpers or joint cubes: the body group. */
  bodyFaces: Uint32Array;
  /** The lowest base vertices of the left foot, whose mean is the sole while shaping. */
  sole: Uint32Array;
}

let mirror: Mirror | null = null;

function readMirror(): Mirror {
  if (mirror) return mirror;
  const base = readObj(BASE_OBJ);
  const body = bodyVertexCount(base);
  const skel = readSkeleton(DEFAULT_SKELETON);
  const weights = readWeights(join(dirname(DEFAULT_SKELETON), skel.weightsFile));
  const n = base.positions.length / 3;
  const index = new Map(skel.bones.map((b, i) => [b.name, i]));
  const lists: [number, number][][] = Array.from({ length: n }, () => []);
  // Bones in skeleton order, so the sums below are made in one order everywhere.
  for (const b of skel.bones) {
    const w = weights.bones.get(b.name);
    if (!w) continue;
    for (let i = 0; i < w.vertices.length; i++) if (w.weights[i]! > 0) lists[w.vertices[i]!]!.push([index.get(b.name)!, w.weights[i]!]);
  }
  const infStart = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) infStart[v + 1] = infStart[v]! + lists[v]!.length;
  const infBone = new Uint16Array(infStart[n]!);
  const infWeight = new Float64Array(infStart[n]!);
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (const [, w] of lists[v]!) sum += w;
    if (!(sum > 0)) throw new Error(`base vertex ${v} has no weight`);
    lists[v]!.forEach(([b, w], k) => {
      infBone[infStart[v]! + k] = b;
      infWeight[infStart[v]! + k] = w / sum;
    });
  }
  const collapse = Int16Array.from(skel.bones, (b) => collapsedBone(b.name));
  const bodyFaces = base.groups.get("body");
  if (!bodyFaces) throw new Error("the base has no body group");
  const left = Array.from({ length: body }, (_, v) => v).filter((v) => base.positions[v * 3]! > 0.5);
  left.sort((a, b) => base.positions[a * 3 + 1]! - base.positions[b * 3 + 1]! || a - b);
  return (mirror = { base, body, skel, collapse, infStart, infBone, infWeight, bodyFaces, sole: Uint32Array.from(left.slice(0, 16)) });
}

const targetCache = new Map<string, Target>();
function target(file: string): Target {
  let t = targetCache.get(file);
  if (!t) targetCache.set(file, (t = readTarget(join(TARGETS, file))));
  return t;
}

// ---- Shaping ------------------------------------------------------------------------------------------------------

/** MakeHuman's macro sliders, each 0 to 1. Gender 0 is female and 1 male; age 0.5 is 25 years. */
export interface Macro {
  gender: number;
  age: number;
  muscle: number;
  weight: number;
  height: number;
  proportions: number;
}

/** The macro targets and their weights, interpolated as MakeHuman's macro modifiers are. Each race weighs a third. */
export function macroTargets(m: Macro): { file: string; weight: number }[] {
  const genders: [string, number][] = [["female", 1 - m.gender], ["male", m.gender]];
  const ages: [string, number][] = m.age < 0.5
    ? [["baby", Math.max(0, 1 - m.age * 5.333)], ["child", Math.max(0, Math.min(1, 5.333 * m.age) - Math.max(0, (m.age - 0.1875) * 3.2))], ["young", Math.max(0, (m.age - 0.1875) * 3.2)], ["old", 0]]
    : [["baby", 0], ["child", 0], ["young", 1 - Math.max(0, m.age * 2 - 1)], ["old", Math.max(0, m.age * 2 - 1)]];
  const three = (v: number): [string, number][] => (v < 0.5 ? [["min", 1 - v * 2], ["average", v * 2], ["max", 0]] : [["min", 0], ["average", 2 - v * 2], ["max", v * 2 - 1]]);
  const muscles = three(m.muscle);
  const weights = three(m.weight);
  const heights: [string, number][] = [["minheight", Math.max(0, 1 - m.height * 2)], ["maxheight", Math.max(0, m.height * 2 - 1)]];
  const props: [string, number][] = [["uncommonproportions", Math.max(0, 1 - m.proportions * 2)], ["idealproportions", Math.max(0, m.proportions * 2 - 1)]];
  const out: { file: string; weight: number }[] = [];
  const put = (file: string, weight: number): void => {
    if (weight > 1e-9) out.push({ file, weight });
  };
  for (const [g, gw] of genders) {
    for (const [a, aw] of ages) {
      for (const race of ["african", "asian", "caucasian"]) put(`macrodetails/${race}-${g}-${a}.target`, gw * aw / 3);
      for (const [mu, mw] of muscles) {
        for (const [we, ww] of weights) {
          const body = `${g}-${a}-${mu}muscle-${we}weight`;
          put(`macrodetails/universal-${body}.target`, gw * aw * mw * ww);
          for (const [h, hw] of heights) put(`macrodetails/height/${body}-${h}.target`, gw * aw * mw * ww * hw);
          if (a !== "baby") for (const [p, pw] of props) put(`macrodetails/proportions/${body}-${p}.target`, gw * aw * mw * ww * pw);
        }
      }
    }
  }
  return out;
}

/** Measurement sliders, -1 to 1, each a pair of targets; a name with {s} is set alike on both sides. */
const MEASURES: readonly string[] = [
  "measure/measure-upperarm-length", "measure/measure-lowerarm-length", "measure/measure-upperleg-height", "measure/measure-lowerleg-height",
  "measure/measure-shoulder-dist", "measure/measure-neck-height", "measure/measure-napetowaist-dist", "measure/measure-waisttohip-dist",
  "armslegs/{s}-hand-scale", "armslegs/{s}-hand-fingers-length", "armslegs/{s}-foot-scale", "armslegs/{s}-foot-scale-vert",
];

function measureTargets(values: ArrayLike<number>): { file: string; weight: number }[] {
  const out: { file: string; weight: number }[] = [];
  MEASURES.forEach((m, i) => {
    const v = values[i]!;
    if (v === 0) return;
    for (const s of m.includes("{s}") ? ["l", "r"] : [""]) out.push({ file: `${m.replace("{s}", s)}-${v > 0 ? "incr" : "decr"}.target`, weight: Math.abs(v) });
  });
  return out;
}

/**
 * The macro sliders each sex is fitted from, with height and proportions free: a 25-year-old a little more muscled and
 * heavier than MakeHuman's average, which fills the capsules (sized on stockier bodies) without leaving them.
 */
const MACRO_BASE: Readonly<Record<Sex, Macro>> = {
  male: { gender: 1, age: 0.5, muscle: 0.8, weight: 0.7, height: 0.5, proportions: 0.5 },
  female: { gender: 0, age: 0.5, muscle: 0.8, weight: 0.7, height: 0.5, proportions: 0.5 },
};

/** Joint positions (decimetres, a joint of `names` each) on the base and each target's change to them. */
interface JointTable {
  names: string[];
  index: Map<string, number>;
  base: Float64Array;
  deltas: Map<string, Float64Array>;
}

function jointTable(m: Mirror, files: Iterable<string>): JointTable {
  const names = [...m.skel.joints.keys()];
  const index = new Map(names.map((n, i) => [n, i]));
  const groups = names.map((n) => m.skel.joints.get(n)!);
  groups.push(m.sole);
  names.push("sole");
  index.set("sole", names.length - 1);
  const mean = (p: (v: number, k: number) => number, out: Float64Array): void => {
    groups.forEach((g, j) => {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (const v of g) s += p(v, k);
        out[j * 3 + k] = s / g.length;
      }
    });
  };
  const base = new Float64Array(names.length * 3);
  mean((v, k) => m.base.positions[v * 3 + k]!, base);
  const deltas = new Map<string, Float64Array>();
  for (const file of files) {
    if (deltas.has(file)) continue;
    const t = target(file);
    const dense = new Map<number, number>();
    t.vertices.forEach((v, i) => dense.set(v, i));
    const d = new Float64Array(names.length * 3);
    mean((v, k) => {
      const i = dense.get(v);
      return i === undefined ? 0 : t.deltas[i * 3 + k]!;
    }, d);
    deltas.set(file, d);
  }
  return { names, index, base, deltas };
}

function jointsFor(t: JointTable, targets: readonly { file: string; weight: number }[]): Float64Array {
  const out = t.base.slice();
  for (const { file, weight } of targets) {
    const d = t.deltas.get(file)!;
    for (let i = 0; i < out.length; i++) out[i]! += weight * d[i]!;
  }
  return out;
}

/** Every target file the fit may use for `sex`. */
function candidateFiles(sex: Sex, hold: FitOptions["macro"]): string[] {
  const files = new Set<string>();
  for (const h of [0, 1]) for (const p of [0, 1]) for (const t of macroTargets({ ...MACRO_BASE[sex], ...hold, height: h, proportions: p })) files.add(t.file);
  for (const v of [-1, 1]) for (const t of measureTargets(MEASURES.map(() => v))) files.add(t.file);
  return [...files].sort();
}

/** How high a trunk bone's joint sits on the rig between the hip joints (0) and the head's joint (1). */
function trunkShare(rig: readonly number[], b: number): number {
  const hip = rig[sided("upperLeg", "L") * 3 + 1]!;
  return (rig[b * 3 + 1]! - hip) / (rig[boneNamed("head") * 3 + 1]! - hip);
}

/** How far the joints are from the rig's, by lengths and heights that the re-pose does not change. */
function shapeError(t: JointTable, joints: Float64Array, rig: readonly number[]): number {
  const J = (name: string): [number, number, number] => {
    const j = t.index.get(name)!;
    return [joints[j * 3]! / 10, joints[j * 3 + 1]! / 10, joints[j * 3 + 2]! / 10];
  };
  const sole = J("sole")[1];
  const own = (base: string): [number, number, number] => {
    const at = J(ownJointName(sided(base, "L"))!);
    if (base === "toe") at[1] = sole + rig[sided("toe", "L") * 3 + 1]!;
    return at;
  };
  const R = (base: string): [number, number, number] => {
    const b = sided(base, "L");
    return [rig[b * 3]!, rig[b * 3 + 1]!, rig[b * 3 + 2]!];
  };
  const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  let e = 0;
  for (const [a, b] of [["shoulder", "upperArm"], ["upperArm", "lowerArm"], ["lowerArm", "hand"], ["hand", "fingers"], ["fingers", "fingertips"], ["upperLeg", "lowerLeg"], ["lowerLeg", "foot"], ["foot", "toe"]] as const) {
    e += (dist(own(a), own(b)) - dist(R(a), R(b))) ** 2;
  }
  for (const b of ["upperArm", "upperLeg", "shoulder"]) e += (own(b)[0] - R(b)[0]) ** 2;
  const hip = own("upperLeg")[1];
  const rigHip = R("upperLeg")[1];
  e += ((J(EYES[0]!)[1] + J(EYES[1]!)[1]) / 2 - SOCKET_EYE.y - hip - (R("head")[1] - rigHip)) ** 2;
  for (const b of ["shoulder", "upperArm"]) e += (own(b)[1] - hip - (R(b)[1] - rigHip)) ** 2;
  e += (own("foot")[1] - sole - R("foot")[1]) ** 2;
  return e;
}

interface Shape {
  macro: Macro;
  measures: Float64Array;
  targets: { file: string; weight: number }[];
}

/** Height, proportions and the measurements that bring the joints nearest the rig, by a pattern search from MakeHuman's average. */
function shape(m: Mirror, sex: Sex, rig: readonly number[], hold: FitOptions["macro"] = {}): Shape {
  const table = jointTable(m, candidateFiles(sex, hold));
  const vars = new Float64Array(2 + MEASURES.length);
  vars[0] = 0.5;
  vars[1] = 0.5;
  // Proportions stay between MakeHuman's regular and ideal: its uncommon end thickens the waist.
  const lo = (i: number): number => (i === 1 ? 0.5 : i === 0 ? 0 : -1);
  const make = (v: Float64Array): Shape => {
    const macro = { ...MACRO_BASE[sex], ...hold, height: v[0]!, proportions: v[1]! };
    const measures = v.slice(2);
    return { macro, measures, targets: [...macroTargets(macro), ...measureTargets(measures)] };
  };
  // A slider at its end costs as much as two millimetres of joint error.
  const cost = (v: Float64Array): number => {
    let e = shapeError(table, jointsFor(table, make(v).targets), rig);
    for (let i = 2; i < v.length; i++) e += 4e-6 * v[i]! ** 2;
    return e;
  };
  let best = cost(vars);
  for (let step = 0.25; step > 1e-4; step /= 2) {
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < vars.length; i++) {
        for (const dir of [1, -1]) {
          const was = vars[i]!;
          const next = Math.min(1, Math.max(lo(i), was + dir * step));
          if (next === was) continue;
          vars[i] = next;
          const c = cost(vars);
          if (c < best - 1e-12) {
            best = c;
            improved = true;
          } else vars[i] = was;
        }
      }
    }
  }
  return make(vars);
}

function morphAll(m: Mirror, targets: readonly { file: string; weight: number }[]): Float64Array {
  const p = Float64Array.from(m.base.positions);
  for (const { file, weight } of targets) {
    const t = target(file);
    for (let i = 0; i < t.vertices.length; i++) {
      const at = t.vertices[i]! * 3;
      p[at] += weight * t.deltas[i * 3]!;
      p[at + 1] += weight * t.deltas[i * 3 + 1]!;
      p[at + 2] += weight * t.deltas[i * 3 + 2]!;
    }
  }
  return p;
}

// ---- Joints on a mesh ---------------------------------------------------------------------------------------------

function meanOf(p: Float64Array, verts: ArrayLike<number>): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    x += p[v * 3]!;
    y += p[v * 3 + 1]!;
    z += p[v * 3 + 2]!;
  }
  return [x / verts.length, y / verts.length, z / verts.length];
}

/** The capsule's middle in model space at rest: where hits are taken, on the skeleton's rest for both sexes. */
function capsuleMiddle(b: number): [number, number, number] {
  return [0, 1, 2].map((k) => HUMAN.rest[b * 3 + k]! + (HUMAN.capA[b * 3 + k]! + HUMAN.capB[b * 3 + k]!) / 2) as [number, number, number];
}

/** The middle in depth of the body's vertices in a thin slab across the trunk. */
function slabMiddle(p: Float64Array, body: number, y: number, halfX: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < body; v++) {
    if (Math.abs(p[v * 3]!) >= halfX || Math.abs(p[v * 3 + 1]! - y) >= SLAB_Y) continue;
    lo = Math.min(lo, p[v * 3 + 2]!);
    hi = Math.max(hi, p[v * 3 + 2]!);
  }
  if (!(hi >= lo)) throw new Error(`no trunk at height ${y.toFixed(3)}`);
  return (lo + hi) / 2;
}

/**
 * The body's own joints (metres, three a bone): a limb's joint is MakeHuman's, nudged by `nudge`; the trunk's are as
 * TRUNK says; the CARRIED bones sit on their carrier as on the rig.
 */
function ownJoints(m: Mirror, p: Float64Array, rig: readonly number[], nudge: Float64Array): Float64Array {
  const out = new Float64Array(HUMAN_BONES * 3);
  const at = (joint: string): [number, number, number] => meanOf(p, m.skel.joints.get(joint)!);
  for (let b = 0; b < HUMAN_BONES; b++) {
    const name = ownJointName(b);
    if (name) out.set(at(name).map((c, k) => c + nudge[b * 3 + k]!), b * 3);
  }
  const hip = (out[sided("upperLeg", "L") * 3 + 1]! + out[sided("upperLeg", "R") * 3 + 1]!) / 2;
  const top = (at(EYES[0]!)[1] + at(EYES[1]!)[1]) / 2 - SOCKET_EYE.y;
  for (const name of TRUNK) {
    const b = boneNamed(name);
    const y = hip + trunkShare(rig, b) * (top - hip);
    const slab = SLAB[name];
    if (!slab) {
      out[b * 3 + 1] = y;
      continue;
    }
    const c = capsuleMiddle(b);
    const z = slabMiddle(p, m.body, y + c[1] - rig[b * 3 + 1]! + slab[1], slab[0]) + rig[b * 3 + 2]! - c[2];
    out.set([0, y, z], b * 3);
  }
  const neck = boneNamed("neck"), below = boneNamed("upperChest"), above = boneNamed("head");
  const t = (rig[neck * 3 + 1]! - rig[below * 3 + 1]!) / (rig[above * 3 + 1]! - rig[below * 3 + 1]!);
  const lerp = (o: ArrayLike<number>): number => o[below * 3 + 2]! + t * (o[above * 3 + 2]! - o[below * 3 + 2]!);
  out[neck * 3 + 2] = lerp(out) + rig[neck * 3 + 2]! - lerp(rig);
  for (const side of ["L", "R"]) {
    for (const [what, by] of CARRIED) {
      const b = sided(what, side);
      const c = sided(by, side);
      for (let k = 0; k < 3; k++) out[b * 3 + k] = out[c * 3 + k]! + rig[b * 3 + k]! - rig[c * 3 + k]!;
    }
  }
  return out;
}

// ---- Re-pose ------------------------------------------------------------------------------------------------------

/** The turn that carries unit vector a onto unit vector b the short way. */
function fromTo(a: readonly number[], b: readonly number[], out: Float64Array, at: number): void {
  const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  out[at] = a[1]! * b[2]! - a[2]! * b[1]!;
  out[at + 1] = a[2]! * b[0]! - a[0]! * b[2]!;
  out[at + 2] = a[0]! * b[1]! - a[1]! * b[0]!;
  out[at + 3] = 1 + d;
  quatNormalize(out, at);
}

const unit = (v: readonly number[]): number[] => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

/**
 * Turns the limbs from the A-pose so every segment of SEGMENTS points as the rig's does, with MakeHuman's skeleton and
 * weights. Each segment turns the least from where its parent carried it, so no twist builds along an arm.
 */
function repose(m: Mirror, p: Float64Array, rig: readonly number[], nudge: Float64Array, opts: FitOptions): Float64Array {
  const bones = m.skel.bones;
  const heads = bones.map((b) => meanOf(p, m.skel.joints.get(b.head)!));
  // A turn for each of the thirty, identity where none is set.
  const turn = new Float64Array(HUMAN_BONES * 4);
  for (let b = 0; b < HUMAN_BONES; b++) turn[b * 4 + 3] = 1;
  const own = (b: number): number[] => meanOf(p, m.skel.joints.get(ownJointName(b)!)!).map((c, k) => c + nudge[b * 3 + k]!);
  for (const side of ["L", "R"]) {
    for (const [from, to] of SEGMENTS) {
      const b = sided(from, side);
      const c = sided(to, side);
      const parent = HUMAN.parent[b]!;
      const a = own(b);
      const t = own(c);
      const carried = [0, 0, 0];
      quatRotate(turn, parent * 4, t[0] - a[0], t[1] - a[1], t[2] - a[2], carried, 0);
      const want = unit([rig[c * 3]! - rig[b * 3]!, rig[c * 3 + 1]! - rig[b * 3 + 1]!, rig[c * 3 + 2]! - rig[b * 3 + 2]!]);
      fromTo(unit(carried), want, turn, b * 4);
      quatMul(turn, b * 4, turn, b * 4, turn, parent * 4);
    }
    for (const [b, w] of Object.entries(TURNS_WITH)) turn.set(turn.subarray(sided(w, side) * 4, sided(w, side) * 4 + 4), sided(b, side) * 4);
  }
  // Each MakeHuman bone turns as the bone it collapses onto, the deltoid helper with the clavicle: turned halfway to the
  // arm it drags the socket off the arm's line and the landing kinks the arm.
  const rot = new Float64Array(bones.length * 4);
  bones.forEach((_, i) => rot.set(turn.subarray(m.collapse[i]! * 4, m.collapse[i]! * 4 + 4), i * 4));
  const posed: [number, number, number][] = [];
  const tmp = [0, 0, 0];
  bones.forEach((bone, i) => {
    const h = heads[i]!;
    if (bone.parent < 0) {
      posed.push([h[0], h[1], h[2]]);
      return;
    }
    const ph = heads[bone.parent]!;
    const pp = posed[bone.parent]!;
    quatRotate(rot, bone.parent * 4, h[0] - ph[0], h[1] - ph[1], h[2] - ph[2], tmp, 0);
    posed.push([pp[0] + tmp[0]!, pp[1] + tmp[1]!, pp[2] + tmp[2]!]);
  });
  const n = p.length / 3;
  const out = new Float64Array(p.length);
  const dual = opts.skinning !== "linear";
  // A bone's dual part is half its translation times its turn: t = posed head - turn(head).
  const dq = new Float64Array(bones.length * 4);
  bones.forEach((_, i) => {
    const h = heads[i]!;
    quatRotate(rot, i * 4, h[0], h[1], h[2], tmp, 0);
    const tx = posed[i]![0] - tmp[0]!, ty = posed[i]![1] - tmp[1]!, tz = posed[i]![2] - tmp[2]!;
    const qx = rot[i * 4]!, qy = rot[i * 4 + 1]!, qz = rot[i * 4 + 2]!, qw = rot[i * 4 + 3]!;
    dq[i * 4] = 0.5 * (tx * qw + ty * qz - tz * qy);
    dq[i * 4 + 1] = 0.5 * (-tx * qz + ty * qw + tz * qx);
    dq[i * 4 + 2] = 0.5 * (tx * qy - ty * qx + tz * qw);
    dq[i * 4 + 3] = -0.5 * (tx * qx + ty * qy + tz * qz);
  });
  const r = new Float64Array(4);
  const d = new Float64Array(4);
  for (let v = 0; v < n; v++) {
    const x = p[v * 3]!, y = p[v * 3 + 1]!, z = p[v * 3 + 2]!;
    const s = m.infStart[v]!, e = m.infStart[v + 1]!;
    if (!dual) {
      let ox = 0, oy = 0, oz = 0;
      for (let k = s; k < e; k++) {
        const i = m.infBone[k]!, w = m.infWeight[k]!, h = heads[i]!, q = posed[i]!;
        quatRotate(rot, i * 4, x - h[0], y - h[1], z - h[2], tmp, 0);
        ox += w * (tmp[0]! + q[0]);
        oy += w * (tmp[1]! + q[1]);
        oz += w * (tmp[2]! + q[2]);
      }
      out[v * 3] = ox;
      out[v * 3 + 1] = oy;
      out[v * 3 + 2] = oz;
      continue;
    }
    r.fill(0);
    d.fill(0);
    // Every turn is taken on the same side as the heaviest bone's, so the blend goes the short way.
    let top = s;
    for (let k = s + 1; k < e; k++) if (m.infWeight[k]! > m.infWeight[top]!) top = k;
    const lead = m.infBone[top]!;
    for (let k = s; k < e; k++) {
      const i = m.infBone[k]!;
      const dot = rot[i * 4]! * rot[lead * 4]! + rot[i * 4 + 1]! * rot[lead * 4 + 1]! + rot[i * 4 + 2]! * rot[lead * 4 + 2]! + rot[i * 4 + 3]! * rot[lead * 4 + 3]!;
      const w = m.infWeight[k]! * (dot < 0 ? -1 : 1);
      for (let c = 0; c < 4; c++) {
        r[c]! += w * rot[i * 4 + c]!;
        d[c]! += w * dq[i * 4 + c]!;
      }
    }
    const len = Math.hypot(r[0]!, r[1]!, r[2]!, r[3]!);
    for (let c = 0; c < 4; c++) {
      r[c]! /= len;
      d[c]! /= len;
    }
    // Translation of a unit dual quaternion: 2 (w_r d - w_d r + r x d).
    const tx = 2 * (r[3]! * d[0]! - d[3]! * r[0]! + r[1]! * d[2]! - r[2]! * d[1]!);
    const ty = 2 * (r[3]! * d[1]! - d[3]! * r[1]! + r[2]! * d[0]! - r[0]! * d[2]!);
    const tz = 2 * (r[3]! * d[2]! - d[3]! * r[2]! + r[0]! * d[1]! - r[1]! * d[0]!);
    quatRotate(r, 0, x, y, z, tmp, 0);
    out[v * 3] = tmp[0]! + tx;
    out[v * 3 + 1] = tmp[1]! + ty;
    out[v * 3 + 2] = tmp[2]! + tz;
  }
  return out;
}

// ---- Weights on the thirty ------------------------------------------------------------------------------------------

interface Skin {
  /** MOST_INFLUENCES a vertex. */
  bones: Uint8Array;
  weights: Float64Array;
}

/**
 * MakeHuman's weights summed onto the thirty. A vertex of a hand or foot is wholly on its heaviest bone there; the
 * forearm and shin take the wrist's and ankle's blend instead, rising toward the hand or foot over RING.
 */
function collapseWeights(m: Mirror, p: Float64Array, own: Float64Array): Skin {
  const n = p.length / 3;
  const bones = new Uint8Array(n * MOST_INFLUENCES);
  const weights = new Float64Array(n * MOST_INFLUENCES);
  const sum = new Float64Array(HUMAN_BONES);
  const groups: { limb: number; end: number; members: number[] }[] = [];
  for (const side of ["L", "R"]) {
    groups.push({ limb: sided("lowerArm", side), end: sided("hand", side), members: HAND_GROUP.map((g) => sided(g, side)) });
    groups.push({ limb: sided("lowerLeg", side), end: sided("foot", side), members: FOOT_GROUP.map((g) => sided(g, side)) });
  }
  const sums: Float64Array[] = [];
  for (let v = 0; v < n; v++) {
    sum.fill(0);
    for (let k = m.infStart[v]!; k < m.infStart[v + 1]!; k++) sum[m.collapse[m.infBone[k]!]!]! += m.infWeight[k]!;
    sums.push(sum.slice());
  }
  const heaviest = (s: Float64Array): number => {
    let best = 0;
    for (let b = 1; b < HUMAN_BONES; b++) if (s[b]! > s[best]!) best = b;
    return best;
  };
  const along = (g: (typeof groups)[number], v: number): number => {
    const a = g.limb * 3, e = g.end * 3;
    const ax = own[e]! - own[a]!, ay = own[e + 1]! - own[a + 1]!, az = own[e + 2]! - own[a + 2]!;
    const l = Math.hypot(ax, ay, az);
    return ((p[v * 3]! - own[e]!) * ax + (p[v * 3 + 1]! - own[e + 1]!) * ay + (p[v * 3 + 2]! - own[e + 2]!) * az) / l;
  };
  // Where each hand or foot begins along its limb: the nearest of its own vertices to the elbow or knee.
  const start = groups.map((g) => {
    let lo = Infinity;
    for (let v = 0; v < m.body; v++) if (g.members.includes(heaviest(sums[v]!))) lo = Math.min(lo, along(g, v));
    return lo;
  });
  for (let v = 0; v < n; v++) {
    const s = sums[v]!;
    const top = heaviest(s);
    const g = groups.findIndex((x) => x.members.includes(top));
    if (g >= 0) {
      s.fill(0);
      s[top] = 1;
    } else {
      const ring = groups.findIndex((x) => x.limb === top);
      if (ring >= 0) {
        const grp = groups[ring]!;
        const t = Math.min(1, Math.max(0, (along(grp, v) - (start[ring]! - RING)) / RING));
        const end = RING_MOST * t * t * (3 - 2 * t);
        let rest = 0;
        for (const b of grp.members) s[b] = 0;
        for (let b = 0; b < HUMAN_BONES; b++) rest += s[b]!;
        for (let b = 0; b < HUMAN_BONES; b++) s[b]! *= (1 - end) / rest;
        s[grp.end] = end;
      }
    }
    const order = Array.from({ length: HUMAN_BONES }, (_, b) => b).filter((b) => s[b]! >= LEAST_WEIGHT || b === top);
    order.sort((a, b) => s[b]! - s[a]! || a - b);
    const kept = order.slice(0, MOST_INFLUENCES);
    let total = 0;
    for (const b of kept) total += s[b]!;
    for (let k = 0; k < MOST_INFLUENCES; k++) {
      const b = kept[k];
      bones[v * MOST_INFLUENCES + k] = b ?? kept[0]!;
      weights[v * MOST_INFLUENCES + k] = b === undefined ? 0 : s[b]! / total;
    }
  }
  return { bones, weights };
}

// ---- Landing ------------------------------------------------------------------------------------------------------

const CHILDREN: readonly number[][] = (() => {
  const out: number[][] = Array.from({ length: HUMAN_BONES }, () => []);
  for (let b = 0; b < HUMAN_BONES; b++) if (HUMAN.parent[b]! >= 0 && b !== B_PROP_L && b !== B_PROP_R) out[HUMAN.parent[b]!]!.push(b);
  return out;
})();

/**
 * Moves each joint by `move` (three a bone) and the mesh with it: along a bone the move runs from its head's to its
 * tail's, so the bone stretches; a bone with several tails blends them by nearness; a last bone only moves.
 */
function land(p: Float64Array, skin: Skin, own: Float64Array, move: Float64Array): Float64Array {
  const n = p.length / 3;
  const out = new Float64Array(p.length);
  const shift = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    const x = p[v * 3]!, y = p[v * 3 + 1]!, z = p[v * 3 + 2]!;
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < MOST_INFLUENCES; k++) {
      const w = skin.weights[v * MOST_INFLUENCES + k]!;
      if (w === 0) continue;
      const b = skin.bones[v * MOST_INFLUENCES + k]!;
      boneMove(b, x, y, z, own, move, shift);
      dx += w * shift[0]!;
      dy += w * shift[1]!;
      dz += w * shift[2]!;
    }
    out[v * 3] = x + dx;
    out[v * 3 + 1] = y + dy;
    out[v * 3 + 2] = z + dz;
  }
  return out;
}

function boneMove(b: number, x: number, y: number, z: number, own: Float64Array, move: Float64Array, out: number[]): void {
  const kids = CHILDREN[b]!;
  if (kids.length === 0) {
    out[0] = move[b * 3]!;
    out[1] = move[b * 3 + 1]!;
    out[2] = move[b * 3 + 2]!;
    return;
  }
  let ox = 0, oy = 0, oz = 0, total = 0;
  const hx = own[b * 3]!, hy = own[b * 3 + 1]!, hz = own[b * 3 + 2]!;
  for (const c of kids) {
    const sx = own[c * 3]! - hx, sy = own[c * 3 + 1]! - hy, sz = own[c * 3 + 2]! - hz;
    const len2 = sx * sx + sy * sy + sz * sz;
    const t = Math.min(1, Math.max(0, ((x - hx) * sx + (y - hy) * sy + (z - hz) * sz) / len2));
    const near = kids.length === 1 ? 1 : 1 / ((x - hx - t * sx) ** 2 + (y - hy - t * sy) ** 2 + (z - hz - t * sz) ** 2 + 1e-4);
    ox += near * ((1 - t) * move[b * 3]! + t * move[c * 3]!);
    oy += near * ((1 - t) * move[b * 3 + 1]! + t * move[c * 3 + 1]!);
    oz += near * ((1 - t) * move[b * 3 + 2]! + t * move[c * 3 + 2]!);
    total += near;
  }
  out[0] = ox / total;
  out[1] = oy / total;
  out[2] = oz / total;
}

// ---- Assembly -----------------------------------------------------------------------------------------------------

interface Built {
  positions: number[];
  uvs: number[];
  /** The position vertex each output vertex came from, for normals that ignore UV seams, offset per part. */
  source: number[];
  indices: number[];
  part: number[];
}

/** Adds faces as triangles, quads cut along their shorter diagonal, a vertex per position and UV pair. */
function addFaces(out: Built, mesh: ObjMesh, faces: ArrayLike<number>, at: Float64Array, part: number, sourceBase: number): void {
  const seen = new Map<number, number>();
  const vertex = (corner: number): number => {
    const v = mesh.corners[corner]!;
    const t = mesh.cornerUvs[corner]!;
    const key = v * 65536 + t;
    let i = seen.get(key);
    if (i === undefined) {
      i = out.positions.length / 3;
      out.positions.push(at[v * 3]!, at[v * 3 + 1]!, at[v * 3 + 2]!);
      out.uvs.push(t === 0xffffffff ? 0 : mesh.uvs[t * 2]!, t === 0xffffffff ? 0 : mesh.uvs[t * 2 + 1]!);
      out.source.push(sourceBase + v);
      seen.set(key, i);
    }
    return i;
  };
  const d2 = (a: number, b: number): number => {
    const va = mesh.corners[a]! * 3, vb = mesh.corners[b]! * 3;
    return (at[va]! - at[vb]!) ** 2 + (at[va + 1]! - at[vb + 1]!) ** 2 + (at[va + 2]! - at[vb + 2]!) ** 2;
  };
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    const s = mesh.faceStart[f]!, e = mesh.faceStart[f + 1]!;
    const tri = (a: number, b: number, c: number): void => {
      out.indices.push(vertex(a), vertex(b), vertex(c));
      out.part.push(part);
    };
    if (e - s === 4) {
      if (d2(s, s + 2) <= d2(s + 1, s + 3)) {
        tri(s, s + 1, s + 2);
        tri(s, s + 2, s + 3);
      } else {
        tri(s, s + 1, s + 3);
        tri(s + 1, s + 2, s + 3);
      }
    } else for (let c = s + 1; c + 1 < e; c++) tri(s, c, c + 1);
  }
}

function normalsOf(positions: Float32Array, indices: Uint32Array, source: number[]): Float32Array {
  const sums = new Map<number, [number, number, number]>();
  for (const s of source) if (!sums.has(s)) sums.set(s, [0, 0, 0]);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    // The cross product's length is twice the area, so larger triangles count for more.
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [indices[t]!, indices[t + 1]!, indices[t + 2]!]) {
      const s = sums.get(source[i]!)!;
      s[0] += nx;
      s[1] += ny;
      s[2] += nz;
    }
  }
  const out = new Float32Array(positions.length);
  source.forEach((s, i) => {
    const [x, y, z] = sums.get(s)!;
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l;
    out[i * 3 + 1] = y / l;
    out[i * 3 + 2] = z / l;
  });
  return out;
}

// ---- The fit ------------------------------------------------------------------------------------------------------

/** The fit's steps on all of MakeHuman's vertices (body, helpers and joint cubes), in metres, for pictures and checks. */
export interface FitStages {
  readonly rig: readonly number[];
  readonly shaped: Shape;
  /** Shaped and standing on y = 0, in the A-pose. */
  readonly placed: Float64Array;
  /** In the T-pose and moved along Z by shiftZ. */
  readonly posed: Float64Array;
  readonly landed: Float64Array;
  readonly shiftZ: number;
  /** Own joints before and after landing, three a bone. */
  readonly before: Float64Array;
  readonly after: Float64Array;
  /** Four bones and weights on the thirty a vertex. */
  readonly skin: Skin;
  /** How many of the vertices are the body's. */
  readonly body: number;
  /** How much each foot's underside was squashed to stand on y = 0: 1 where none was needed. */
  readonly squash: readonly [number, number];
}

/**
 * Squashes each foot's body vertices below its ankle, in place, so the lowest stands on y = 0. The joint cubes are not
 * moved, so no joint moves. Returns the factor for each foot.
 */
function soles(body: number, p: Float64Array, skin: Skin, rig: readonly number[]): [number, number] {
  return (["L", "R"] as const).map((side) => {
    const members = FOOT_GROUP.map((g) => sided(g, side));
    const ankle = rig[sided("foot", side) * 3 + 1]!;
    const on = (v: number): boolean => members.includes(skin.bones[v * MOST_INFLUENCES]!);
    let lo = Infinity;
    for (let v = 0; v < body; v++) if (on(v)) lo = Math.min(lo, p[v * 3 + 1]!);
    if (lo >= 0) return 1;
    const k = ankle / (ankle - lo);
    for (let v = 0; v < body; v++) if (on(v) && p[v * 3 + 1]! < ankle) p[v * 3 + 1] = ankle - (ankle - p[v * 3 + 1]!) * k;
    return k;
  }) as [number, number];
}

export function fitStages(sex: Sex, rig: readonly number[], opts: FitOptions = {}): FitStages {
  const m = readMirror();
  if (rig.length !== HUMAN_BONES * 3) throw new Error(`a rig has ${HUMAN_BONES * 3} numbers, not ${rig.length}`);
  const shaped = shape(m, sex, rig, opts.macro);
  // Decimetres to metres, standing on y = 0.
  const morphed = morphAll(m, shaped.targets);
  let floor = Infinity;
  for (let v = 0; v < m.body; v++) floor = Math.min(floor, morphed[v * 3 + 1]!);
  const placed = morphed.map((c, i) => (i % 3 === 1 ? (c - floor) / 10 : c / 10));
  // The toes bend at the rig's height above the sole, under MakeHuman's ball of the foot.
  const nudge = new Float64Array(HUMAN_BONES * 3);
  for (const side of ["L", "R"]) {
    const toe = sided("toe", side);
    nudge[toe * 3 + 1] = rig[toe * 3 + 1]! - meanOf(placed, m.skel.joints.get(ownJointName(toe)!)!)[1];
  }
  const posed = repose(m, placed, rig, nudge, opts);
  // Move the body along Z so the lower trunk sits centred on its capsules, as near as one move can.
  let shiftZ = 0;
  {
    const own = ownJoints(m, posed, rig, nudge);
    const trunk = ["hips", "spine", "chest", "upperChest"].map(boneNamed);
    for (const b of trunk) shiftZ += (rig[b * 3 + 2]! - own[b * 3 + 2]!) / trunk.length;
    for (let v = 0; v < posed.length / 3; v++) posed[v * 3 + 2]! += shiftZ;
  }
  const before = ownJoints(m, posed, rig, nudge);
  const skin = collapseWeights(m, posed, before);
  const move = new Float64Array(HUMAN_BONES * 3);
  for (let i = 0; i < move.length; i++) move[i] = rig[i]! - before[i]!;
  let landed = posed;
  let after = before;
  // The landed joints miss by what the bones' blends lose near each joint; feeding that back closes it.
  for (let pass = 0; pass < 40; pass++) {
    landed = land(posed, skin, before, move);
    after = ownJoints(m, landed, rig, nudge);
    let worst = 0;
    for (let i = 0; i < move.length; i++) {
      move[i]! += rig[i]! - after[i]!;
      worst = Math.max(worst, Math.abs(rig[i]! - after[i]!));
    }
    if (worst < 1e-6) break;
  }
  const squash = soles(m.body, landed, skin, rig);
  after = ownJoints(m, landed, rig, nudge);
  return { rig, shaped, placed, posed, landed, shiftZ, before, after, skin, body: m.body, squash };
}

/**
 * MakeHuman's body fitted to `rig`, the frozen joints of `sex` (RIGS beside the human-bodies asset, three a bone). Reads
 * only the mirror; the same inputs give the same body.
 */
export function fitBody(sex: Sex, rig: readonly number[], opts: FitOptions = {}): FittedBody {
  const m = readMirror();
  const { shaped, landed, shiftZ, before, after, skin, squash } = fitStages(sex, rig, opts);
  const built: Built = { positions: [], uvs: [], source: [], indices: [], part: [] };
  addFaces(built, m.base, m.bodyFaces, landed, 0, 0);
  const bodyVerts = built.positions.length / 3;
  // Bound parts follow the landed base; bindings measure in decimetres.
  const decimetres = Float32Array.from(landed, (c) => c * 10);
  PART_FILES.forEach((file, k) => {
    const binding = readBinding(join(MAKEHUMAN, file));
    const mesh = readObj(join(MAKEHUMAN, dirname(file), binding.objFile));
    const at = fit(binding, decimetres);
    const metres = Float64Array.from(at, (c) => c / 10);
    const faces = Uint32Array.from({ length: mesh.faceStart.length - 1 }, (_, f) => f);
    addFaces(built, mesh, faces, metres, k + 1, (k + 1) * 1_000_000);
  });

  const positions = Float32Array.from(built.positions);
  const indices = Uint32Array.from(built.indices);
  const count = positions.length / 3;
  const joints = new Uint8Array(count * MOST_INFLUENCES);
  const weights = new Float32Array(count * MOST_INFLUENCES);
  const bone = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (i < bodyVerts) {
      const v = built.source[i]!;
      for (let k = 0; k < MOST_INFLUENCES; k++) {
        joints[i * 4 + k] = skin.bones[v * 4 + k]!;
        weights[i * 4 + k] = skin.weights[v * 4 + k]!;
      }
    } else {
      joints.fill(boneNamed("head"), i * 4, i * 4 + 4);
      weights[i * 4] = 1;
    }
    bone[i] = joints[i * 4]!;
  }
  const part = Uint8Array.from(built.part);
  const triangles: Record<string, number> = { "base before helpers": (m.base.faceStart.length - 1) * 2 };
  PART_NAMES.forEach((name, k) => (triangles[name] = built.part.filter((p) => p === k).length));
  triangles.total = indices.length / 3;

  const shapedMm = new Float64Array(HUMAN_BONES);
  const landedMm = new Float64Array(HUMAN_BONES);
  for (let b = 0; b < HUMAN_BONES; b++) {
    const d = (o: Float64Array): number => Math.hypot(o[b * 3]! - rig[b * 3]!, o[b * 3 + 1]! - rig[b * 3 + 1]!, o[b * 3 + 2]! - rig[b * 3 + 2]!) * 1000;
    shapedMm[b] = d(before);
    landedMm[b] = d(after);
  }
  const stretch: { bone: string; child: string; along: number; across: number }[] = [];
  for (let b = 0; b < HUMAN_BONES; b++) {
    for (const c of CHILDREN[b]!) {
      const was = [0, 1, 2].map((k) => before[c * 3 + k]! - before[b * 3 + k]!);
      const now = [0, 1, 2].map((k) => rig[c * 3 + k]! - rig[b * 3 + k]!);
      const lw = Math.hypot(...was);
      const ln = Math.hypot(...now);
      const cos = (was[0]! * now[0]! + was[1]! * now[1]! + was[2]! * now[2]!) / (lw * ln);
      stretch.push({ bone: HUMAN.names[b]!, child: HUMAN.names[c]!, along: ln / lw, across: ln * Math.sqrt(Math.max(0, 1 - cos * cos)) });
    }
  }
  const sole = (side: string): number => {
    const members = FOOT_GROUP.map((g) => sided(g, side));
    let lo = Infinity;
    for (let i = 0; i < bodyVerts; i++) if (members.includes(bone[i]!)) lo = Math.min(lo, positions[i * 3 + 1]!);
    return lo;
  };
  const sliders = [
    ...Object.entries(shaped.macro).map(([name, value]) => ({ name, value })),
    ...MEASURES.map((name, i) => ({ name: name.replace(/^.*\//, "").replace("{s}-", ""), value: shaped.measures[i]! })),
  ];
  return {
    sex,
    positions,
    normals: normalsOf(positions, indices, built.source),
    uvs: Float32Array.from(built.uvs),
    indices,
    joints,
    weights,
    bone,
    material: Uint8Array.from(part, (p) => PART_MATERIAL[p]!),
    part,
    rest: Float32Array.from(rig),
    report: { targets: shaped.targets, sliders, shaped: shapedMm, landed: landedMm, stretch, shiftZ, triangles, soles: [sole("L"), sole("R")], squash },
  };
}
