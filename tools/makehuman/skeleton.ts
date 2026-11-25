// Reads a MakeHuman skeleton (.mhskel, JSON). A joint is named by base vertices and sits at their mean, so a skeleton
// follows any morph of the base. Bones come out parents first; the file lists them by name.

import { readFileSync } from "node:fs";

export interface SkeletonBone {
  readonly name: string;
  /** Index of the parent in `bones`, or -1 for the root. */
  readonly parent: number;
  readonly head: string;
  readonly tail: string;
  /** Three joint names whose plane sets the bone's roll, where the file gives one. */
  readonly plane: readonly [string, string, string] | null;
}

export interface Skeleton {
  readonly name: string;
  readonly license: string;
  /** The weights file that pairs with it, beside it. */
  readonly weightsFile: string;
  readonly bones: readonly SkeletonBone[];
  /** Base vertices by joint name. */
  readonly joints: ReadonlyMap<string, Uint32Array>;
}

interface SkeletonJson {
  name?: string;
  license?: string;
  weights_file?: string;
  bones: Record<string, { parent: string | null; head: string; tail: string; rotation_plane?: string | null }>;
  joints: Record<string, number[]>;
  planes?: Record<string, string[]>;
}

export function parseSkeleton(text: string, path = "skeleton"): Skeleton {
  const json = JSON.parse(text) as SkeletonJson;
  const joints = new Map(Object.entries(json.joints).map(([k, v]) => [k, new Uint32Array(v)]));
  const entries = Object.entries(json.bones);
  const byName = new Map(entries);
  const bones: SkeletonBone[] = [];
  const index = new Map<string, number>();
  const visit = (name: string, chain: Set<string>): number => {
    const done = index.get(name);
    if (done !== undefined) return done;
    const b = byName.get(name);
    if (!b) throw new Error(`${path}: no bone ${name}`);
    if (chain.has(name)) throw new Error(`${path}: bone ${name} is its own ancestor`);
    chain.add(name);
    const parent = b.parent ? visit(b.parent, chain) : -1;
    for (const j of [b.head, b.tail]) if (!joints.has(j)) throw new Error(`${path}: bone ${name} names no joint ${j}`);
    const plane = b.rotation_plane ? json.planes?.[b.rotation_plane] : undefined;
    if (plane && plane.length !== 3) throw new Error(`${path}: plane ${b.rotation_plane} names ${plane.length} joints`);
    bones.push({ name, parent, head: b.head, tail: b.tail, plane: plane ? (plane as [string, string, string]) : null });
    index.set(name, bones.length - 1);
    return bones.length - 1;
  };
  for (const [name] of entries) visit(name, new Set());
  return { name: json.name ?? "", license: json.license ?? "", weightsFile: json.weights_file ?? "", bones, joints };
}

export function readSkeleton(path: string): Skeleton {
  return parseSkeleton(readFileSync(path, "utf8"), path);
}

/** Where a joint sits on `base` (x, y, z a vertex): the mean of its vertices. */
export function jointAt(s: Skeleton, joint: string, base: Float32Array): [number, number, number] {
  const verts = s.joints.get(joint);
  if (!verts || verts.length === 0) throw new Error(`no joint ${joint}`);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += base[v * 3]!;
    y += base[v * 3 + 1]!;
    z += base[v * 3 + 2]!;
  }
  return [x / verts.length, y / verts.length, z / verts.length];
}

/** Each bone's head and tail on `base`, six numbers a bone in the order of `bones`. */
export function bonePositions(s: Skeleton, base: Float32Array): Float32Array {
  const out = new Float32Array(s.bones.length * 6);
  s.bones.forEach((b, i) => {
    out.set(jointAt(s, b.head, base), i * 6);
    out.set(jointAt(s, b.tail, base), i * 6 + 3);
  });
  return out;
}

export const boneIndex = (s: Skeleton, name: string): number => s.bones.findIndex((b) => b.name === name);
