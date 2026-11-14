// Turns a rigged, animated creature model into a rig that is a whole skeleton, one mesh on it, and its clips.
// The skeleton is data, so a different model needs only a different spec (tools/art/spec.ts) and content.

import type { Clip } from "../../shared/anim/clip.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { REGION_BASE, REGION_COUNT } from "../../shared/pack/palette.ts";
import { ZONES, type CreatureAsset } from "../art/spec.ts";
import { convertClips, type ClipSpec } from "./anim.ts";
import { nodeParents, readAccessor, restMatrices, type Gltf } from "./gltf.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** The most bones a rig may have (shared/anim/rigs.ts), and the most joints that may weigh on one vertex of a model. */
export const MOST_BONES = 127;
export const MOST_WEIGHTS = 4;

export interface ConvertedCreature {
  rig: PackRig;
  /** The levels the model came with. One, unless its mesh objects are named "..._LOD<n>". */
  mesh: SourceMesh;
  clips: Clip[];
  /** Counted over every level: vertices, those no joint weighs on, those more than MOST_WEIGHTS do, and those more than one does. */
  weights: { vertices: number; none: number; over: number; shared: number };
  warnings: string[];
  /** What would draw wrong. A model with any is not written to a pack. */
  faults: string[];
}

const percentile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))] ?? 0;
};

/** `id` is the id of the rig, and of the mesh. */
export function convertCreature(g: Gltf, id: string, spec: CreatureAsset): ConvertedCreature {
  const skeleton = spec.skeleton;
  const nodes = g.json.nodes ?? [];
  const parentNode = nodeParents(g);
  const world = restMatrices(g);
  const warnings: string[] = [];
  const faults: string[] = [];
  const skin = g.json.skins?.[0];
  if (!skin) throw new Error(`${g.path}: no skin`);
  const nameOf = (n: number): string => nodes[n]!.name ?? "";

  // Bones are the kept joints of the skin, the root first and every parent before its children.
  const kept = skin.joints.filter((n) => !skeleton.drop?.test(nameOf(n)));
  const parentName = (n: number): string | null => {
    const moved = skeleton.reparent?.[nameOf(n)];
    if (moved !== undefined) return moved;
    for (let p = parentNode[n]!; p >= 0; p = parentNode[p]!) if (kept.includes(p)) return nameOf(p);
    return null;
  };
  const names: string[] = [skeleton.root];
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of kept) {
      const name = nameOf(n);
      if (names.includes(name)) continue;
      const p = parentName(n);
      // A kept joint with no kept joint above it hangs on the root.
      if (p === null || names.includes(p)) {
        names.push(name);
        grew = true;
      }
    }
  }
  if (names.length !== kept.length) throw new Error(`${g.path}: ${kept.length - names.length} joints could not be placed under "${skeleton.root}"`);
  const nodeOfBone = names.map((name) => kept.find((n) => nameOf(n) === name)!);
  if (nodeOfBone[0] === undefined) throw new Error(`${g.path}: no joint named "${skeleton.root}"`);
  const most = Math.min(skeleton.bones ?? MOST_BONES, MOST_BONES);
  if (names.length > most) faults.push(`${names.length} bones, and the most is ${most}`);
  const bone = (name: string): number => {
    const b = names.indexOf(name);
    if (b < 0) throw new Error(`${id}: no bone named "${name}"`);
    return b;
  };
  const parent = names.map((_, b) => (b === 0 ? -1 : names.indexOf(parentName(nodeOfBone[b]!) ?? skeleton.root)));
  const scale = spec.scale;
  const rest = names.flatMap((_, b) => [0, 1, 2].map((k) => world[nodeOfBone[b]!]![12 + k]! * scale));

  // Maps every joint, kept or not, to the bone its vertices follow.
  const boneOfNode = new Map<number, number>();
  for (const n of skin.joints) {
    let at = n;
    while (at >= 0 && !kept.includes(at)) at = parentNode[at]!;
    boneOfNode.set(n, at >= 0 ? names.indexOf(nameOf(at)) : 0);
  }

  // Every primitive of every skinned mesh of a level goes into one mesh. A vertex follows the one joint that weighs most on it.
  const materials = spec.regions.map((r) => r.material);
  const levels: { positions: number[]; colors: number[]; bones: number[]; indices: number[] }[] = [];
  const weights = { vertices: 0, none: 0, over: 0, shared: 0 };
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const level = (levels[Number(/_LOD(\d)$/i.exec(node.name ?? "")?.[1] ?? 0)] ??= { positions: [], colors: [], bones: [], indices: [] });
    const { positions, colors, bones, indices } = level;
    for (const prim of g.json.meshes![node.mesh]!.primitives) {
      const pos = readAccessor(g, prim.attributes.POSITION!);
      const joints = readAccessor(g, prim.attributes.JOINTS_0!);
      const weight = readAccessor(g, prim.attributes.WEIGHTS_0!);
      const more = prim.attributes.WEIGHTS_1 === undefined ? null : readAccessor(g, prim.attributes.WEIGHTS_1);
      const material = g.json.materials?.[prim.material ?? -1]?.name ?? "";
      let region = materials.indexOf(material);
      if (region < 0 || region >= REGION_COUNT) {
        warnings.push(`material "${material}" is not one of the regions: read as the first`);
        region = 0;
      }
      const base = positions.length / 3;
      for (let v = 0; v < pos.count; v++) {
        for (let k = 0; k < 3; k++) positions.push(pos.data[v * 3 + k]! * scale);
        let best = 0;
        let count = 0;
        for (let k = 0; k < 4; k++) {
          if (weight.data[v * 4 + k]! > weight.data[v * 4 + best]!) best = k;
          if (weight.data[v * 4 + k]! > 0) count++;
        }
        weights.vertices++;
        if (count === 0) weights.none++;
        if (count > 1) weights.shared++;
        if (more) for (let k = 0; k < more.size; k++) if (more.data[v * more.size + k]! > 0) count++;
        if (count > MOST_WEIGHTS) weights.over++;
        bones.push(boneOfNode.get(skin.joints[joints.data[v * 4 + best]!]!) ?? 0);
        colors.push(REGION_BASE + region);
      }
      const index = readAccessor(g, prim.indices!);
      for (let i = 0; i < index.count; i++) indices.push(base + index.data[i]!);
    }
  }
  const fine = levels[0];
  if (!fine || fine.positions.length === 0) throw new Error(`${g.path}: no skinned mesh`);
  for (let l = 0; l < levels.length; l++) {
    if (!levels[l]) throw new Error(`${g.path}: levels of detail must be consecutive, and there is no level ${l}`);
    if (levels[l]!.positions.length / 3 > 65535) throw new Error(`${g.path}: too many vertices for one mesh`);
  }
  if (weights.none > 0) faults.push(`${weights.none} vertices that no joint weighs on`);
  if (weights.over > 0) faults.push(`${weights.over} vertices with more than ${MOST_WEIGHTS} joints weighing on them`);
  const { positions, bones } = fine;

  const vertsOf = (covers: readonly string[]): number[] => {
    const set = new Set(covers.map(bone));
    const out: number[] = [];
    for (let v = 0; v < bones.length; v++) if (set.has(bones[v]!)) out.push(v);
    return out;
  };

  // A fitted hit capsule runs along the line between two joints, as far as its vertices reach, with a radius that holds 85% of them.
  const caps: number[] = [];
  const jointAt = (name: string): number[] => {
    const n = nodes.findIndex((node) => node.name === name);
    if (n < 0) throw new Error(`${id}: no joint named "${name}"`);
    return [0, 1, 2].map((k) => world[n]![12 + k]! * scale);
  };
  for (const z of spec.zones) {
    const carrier = bone(z.on);
    if ("radius" in z) {
      caps.push(carrier, ZONES[z.zone], ...z.a, ...z.b, z.radius);
      continue;
    }
    const from = jointAt(z.from);
    const to = jointAt(z.to);
    const d = [0, 1, 2].map((k) => to[k]! - from[k]!);
    const length = Math.hypot(d[0]!, d[1]!, d[2]!);
    const verts = vertsOf(z.covers);
    if (length < 1e-6 || verts.length === 0) {
      warnings.push(`zone on "${z.on}" covers nothing: left out`);
      continue;
    }
    for (let k = 0; k < 3; k++) d[k] = d[k]! / length;
    const along: number[] = [];
    const away: number[] = [];
    for (const v of verts) {
      const r = [0, 1, 2].map((k) => positions[v * 3 + k]! - from[k]!);
      const t = r[0]! * d[0]! + r[1]! * d[1]! + r[2]! * d[2]!;
      along.push(t);
      away.push(Math.hypot(r[0]! - t * d[0]!, r[1]! - t * d[1]!, r[2]! - t * d[2]!));
    }
    const radius = Math.max(0.03, percentile(away, 0.85));
    // The round ends reach past the segment, so the segment stops short of where the vertices end.
    let t0 = percentile(along, 0.03) + radius * 0.6;
    let t1 = percentile(along, 0.97) - radius * 0.6;
    if (t1 < t0) t0 = t1 = (t0 + t1) / 2;
    caps.push(carrier, ZONES[z.zone], ...[t0, t1].flatMap((t) => d.map((c, k) => +(from[k]! + c * t - rest[carrier * 3 + k]!).toFixed(4))), +radius.toFixed(4));
  }

  // Socket positions are relative to the bone that carries them.
  const sockets = spec.sockets.map((s) => {
    const b = bone(s.bone);
    if ("offset" in s) return { name: s.name, bone: b, x: s.offset[0], y: s.offset[1], z: s.offset[2] };
    const verts = vertsOf(s.of);
    let x = 0;
    let y = rest[b * 3 + 1]!;
    let z = rest[b * 3 + 2]!;
    if (s.at === "top") {
      // The highest vertex within a short way of the bone, fore and aft.
      y = -Infinity;
      for (const v of verts) if (Math.abs(positions[v * 3 + 2]! - z) < 0.35 * scale * 4 && Math.abs(positions[v * 3]!) < 0.2 * scale * 4 && positions[v * 3 + 1]! > y) y = positions[v * 3 + 1]!;
      if (y === -Infinity) y = rest[b * 3 + 1]!;
    } else {
      // The vertex furthest forward.
      for (const v of verts) {
        if (positions[v * 3 + 2]! <= z) continue;
        x = positions[v * 3]!;
        y = positions[v * 3 + 1]!;
        z = positions[v * 3 + 2]!;
      }
    }
    return { name: s.name, bone: b, x: +(x - rest[b * 3]!).toFixed(4), y: +(y - rest[b * 3 + 1]!).toFixed(4), z: +(z - rest[b * 3 + 2]!).toFixed(4) };
  });

  const specs: ClipSpec[] = spec.clips.map((c) => ({ source: c.source, id: `${id}/${c.name}`, loop: c.loop, from: c.from, to: c.to }));
  const made = convertClips(g, names, parent, specs, scale);
  warnings.push(...made.warnings);
  for (const c of spec.clips) if (!made.clips.some((m) => m.id === `${id}/${c.name}`)) faults.push(`clip "${c.name}" was not made`);
  const rig: PackRig = { id, skeleton: skeleton.id, rest: rest.map((v) => +v.toFixed(5)), names, parent, caps, sockets };
  const lods = levels.map((l): SourceLod => ({ positions: Float32Array.from(l.positions), colors: Uint8Array.from(l.colors), indices: Uint32Array.from(l.indices), bones: Uint8Array.from(l.bones) }));
  return { rig, mesh: { id, skeleton: skeleton.id, rig: id, lods }, clips: made.clips, weights, warnings, faults };
}
