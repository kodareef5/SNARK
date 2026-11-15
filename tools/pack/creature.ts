// Turns a rigged, animated creature model into a rig that is a whole skeleton, one mesh on it, and its clips.
// The skeleton is data, so a different model needs only a different spec (tools/art/spec.ts) and content.

import type { Clip } from "../../shared/anim/clip.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { REGION_BASE, REGION_COUNT, defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { ZONES, type CreatureAsset, type MaterialSpec } from "../art/spec.ts";
import { convertClips, type ClipSpec } from "./anim.ts";
import { nodeParents, readAccessor, restMatrices, type Gltf } from "./gltf.ts";
import { fourHeaviest } from "./surface.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** The most bones a rig may have (shared/anim/rigs.ts), and the most joints that may weigh on one vertex of a model. */
export const MOST_BONES = 127;
export const MOST_WEIGHTS = 4;

/** The mesh a saddle item is drawn as on its creature (CreatureAsset.worn), and the creature's whole model as it is saddled. */
export const wornId = (item: string): string => `${item}/worn`;
export const saddledId = (creature: string): string => `${creature}/saddled`;

/**
 * The meshes a creature asset makes besides its bare body, each with its levels' plan: a worn saddle's and the saddled
 * model's own, in that order, by mesh id. Their materials are named as the body's are, all in one list for the asset.
 */
export function extraMeshes(id: string, spec: CreatureAsset): { id: string; materials: Readonly<Record<string, MaterialSpec>>; budgets: CreatureAsset["budgets"]; flat?: number }[] {
  const worn = (spec.worn ?? []).map((w) => ({ id: wornId(w.item), materials: w.materials ?? {}, budgets: w.budgets, flat: w.flat }));
  const s = spec.saddled;
  // The saddled model is the creature again, so it takes the body's materials where it gives none of its own.
  return s ? [...worn, { id: saddledId(id), materials: { ...spec.materials, ...s.materials }, budgets: s.budgets, flat: s.flat ?? spec.flat }] : worn;
}

/** The levels' plan of a mesh a creature asset makes: the body's, or a worn saddle's or the saddled model's own. */
export function planOf(id: string, spec: CreatureAsset, mesh: string): { materials: Readonly<Record<string, MaterialSpec>>; budgets: CreatureAsset["budgets"]; flat?: number } {
  return extraMeshes(id, spec).find((m) => m.id === mesh) ?? { materials: spec.materials ?? {}, budgets: spec.budgets, flat: spec.flat };
}

export interface ConvertedCreature {
  rig: PackRig;
  /**
   * The levels the model came with. One, unless its mesh objects are named "..._LOD<n>". Where the asset gives its
   * materials pictures, it is the finest level alone, with its surface and four bones a vertex, and a triangle's
   * section is the place of its material among the asset's `materials`.
   */
  mesh: SourceMesh;
  /**
   * The saddles worn on it and the saddled model, as `extraMeshes` lists them, each read as the body is: on the same
   * skeleton and rig, made on the same bones. One whose materials have pictures is its finest level alone.
   */
  extra: SourceMesh[];
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

/**
 * A hit capsule fitted to vertices `verts` of `positions`: along the line from joint `from` to joint `to`, or, without
 * them, along the vertices' own longest axis through their middle. It reaches as far along as they do and its radius
 * holds 85% of them. Its two ends are in model space.
 */
export function fitCapsule(positions: ArrayLike<number>, verts: readonly number[], from: readonly number[] | null, to: readonly number[] | null): { a: number[]; b: number[]; radius: number } | null {
  if (verts.length === 0) return null;
  let origin: number[];
  let d: number[];
  if (from && to) {
    origin = [...from];
    d = [0, 1, 2].map((k) => to[k]! - from[k]!);
  } else {
    origin = [0, 1, 2].map((k) => verts.reduce((s, v) => s + positions[v * 3 + k]!, 0) / verts.length);
    const spread = [0, 1, 2].map((i) => [0, 1, 2].map((j) => verts.reduce((s, v) => s + (positions[v * 3 + i]! - origin[i]!) * (positions[v * 3 + j]! - origin[j]!), 0)));
    // The largest of the spread's three axes, by repeated multiplication from a start no real body lies across.
    d = [0.31, 0.47, 0.83];
    for (let k = 0; k < 64; k++) {
      const n = [0, 1, 2].map((i) => spread[i]![0]! * d[0]! + spread[i]![1]! * d[1]! + spread[i]![2]! * d[2]!);
      const l = Math.hypot(n[0]!, n[1]!, n[2]!);
      if (l < 1e-12) break;
      d = n.map((c) => c / l);
    }
  }
  const length = Math.hypot(d[0]!, d[1]!, d[2]!);
  if (length < 1e-6) return null;
  d = d.map((c) => c / length);
  const along: number[] = [];
  const away: number[] = [];
  for (const v of verts) {
    const r = [0, 1, 2].map((k) => positions[v * 3 + k]! - origin[k]!);
    const t = r[0]! * d[0]! + r[1]! * d[1]! + r[2]! * d[2]!;
    along.push(t);
    away.push(Math.hypot(r[0]! - t * d[0]!, r[1]! - t * d[1]!, r[2]! - t * d[2]!));
  }
  const radius = Math.max(0.03, percentile(away, 0.85));
  // The round ends reach past the segment, so the segment stops short of where the vertices end.
  let t0 = percentile(along, 0.03) + radius * 0.6;
  let t1 = percentile(along, 0.97) - radius * 0.6;
  if (t1 < t0) t0 = t1 = (t0 + t1) / 2;
  return { a: d.map((c, k) => origin[k]! + c * t0), b: d.map((c, k) => origin[k]! + c * t1), radius };
}

/**
 * `rig` with what its asset says of how it moves and dies, by bone index: its feet, the stride of each gait, and the
 * bodies of its ragdoll with their limits. What names a bone the rig lacks is a fault. `clips` are its own.
 */
export function withMotion(rig: PackRig, spec: CreatureAsset, clips: readonly Clip[], faults: string[]): PackRig {
  const names = rig.names ?? [];
  const bone = (name: string, what: string): number => {
    const b = names.indexOf(name);
    if (b < 0) faults.push(`${what} "${name}" is not a bone of the rig`);
    return b;
  };
  const out: PackRig = { ...rig, feet: spec.feet.map((f) => bone(f, "foot")).filter((b) => b >= 0) };
  delete out.strides;
  delete out.ragdoll;
  if (Object.keys(spec.gaits).length > 0) out.strides = Object.fromEntries(Object.entries(spec.gaits).map(([clip, g]) => [clip, g.stride]));
  const r = spec.ragdoll;
  if (r && r.bodies.length > 0) {
    const death = clips.find((c) => c.id === `${rig.id}/death`);
    const bodies = r.bodies.map((b) => ({ bone: bone(b.bone, "ragdoll body"), mass: b.mass, swing: b.swing ?? 0, twist: b.twist ?? 0 })).filter((b) => b.bone >= 0);
    out.ragdoll = { limp: r.limp ?? (death ? death.frames - 1 : 0), bodies };
  }
  return out;
}

type Level = { positions: number[]; colors: number[]; bones: number[]; indices: number[]; uvs: number[]; normals: number[]; tangents: number[]; joints: number[]; weights: number[]; sections: number[]; loose: number[] };

/**
 * `id` is the id of the rig, and of the mesh. Mesh objects that the asset's `worn` and `saddled` name are read into
 * meshes of their own and are not the bare body's. `palette` gives the flat colour of a worn saddle's or the saddled
 * model's material that is not one of the regions and has no pictures: the nearest to its base colour.
 */
export function convertCreature(g: Gltf, id: string, spec: CreatureAsset, palette: Uint8Array = defaultPalette()): ConvertedCreature {
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
  // Each mesh object makes the bare body, a saddle worn on it, or the creature as it is saddled: parts[0] and on.
  const extra = extraMeshes(id, spec);
  const parts = [{ id, materials: spec.materials ?? {} }, ...extra].map((m) => ({
    ...m,
    // With pictures the finest level alone is read, with its surface: a primitive is a section, drawn with its material.
    pictured: Object.keys(m.materials),
    levels: [] as Level[],
    weights: { vertices: 0, none: 0, over: 0, shared: 0 },
  }));
  const objects = [...(spec.worn ?? []).map((w) => [w.object]), spec.saddled?.objects ?? []];
  const named = objects.flat();
  for (const [k, w] of (spec.worn ?? []).entries()) if ((spec.worn ?? []).findIndex((o) => o.item === w.item) !== k) faults.push(`worn: the saddle "${w.item}" is named twice`);
  for (const [k, o] of named.entries()) if (named.indexOf(o) !== k) faults.push(`the mesh object "${o}" is named twice among the worn saddles and the saddled model`);
  /** The part a mesh object makes, by its name less its level. */
  const partOf = (name: string): number => 1 + objects.findIndex((list) => list.includes(name.replace(/_LOD\d$/i, "")));
  /** A worn saddle's or the saddled model's material that is not a region is its own colour, the palette's nearest. */
  const ownColour = (material: number | undefined): number => {
    const base = g.json.materials?.[material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
    const [r, gr, b] = base.slice(0, 3).map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
    return nearestColour(palette, r!, gr!, b!);
  };
  let passed = 0;
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const at = Number(/_LOD(\d)$/i.exec(node.name ?? "")?.[1] ?? 0);
    const part = parts[partOf(node.name ?? "")]!;
    const { pictured, weights } = part;
    if (pictured.length > 0 && at > 0) {
      passed++;
      continue;
    }
    const level = (part.levels[at] ??= { positions: [], colors: [], bones: [], indices: [], uvs: [], normals: [], tangents: [], joints: [], weights: [], sections: [], loose: [] });
    const { positions, colors, bones, indices } = level;
    for (const prim of g.json.meshes![node.mesh]!.primitives) {
      const a = prim.attributes;
      const pos = readAccessor(g, a.POSITION!);
      const joints = readAccessor(g, a.JOINTS_0!);
      const weight = readAccessor(g, a.WEIGHTS_0!);
      const more = a.WEIGHTS_1 === undefined ? null : readAccessor(g, a.WEIGHTS_1);
      const material = g.json.materials?.[prim.material ?? -1]?.name ?? "";
      const region = materials.indexOf(material);
      const section = pictured.indexOf(material);
      // Cards drawn with a cutout material: plumage, hair, loose tips.
      const loose = part.materials[material]?.cutout ? 1 : 0;
      // A colour region, or for a saddle a colour of its own.
      let flat = 0;
      if (pictured.length > 0) {
        if (section < 0) faults.push(`${part === parts[0] ? "" : `${part.id}: `}material "${material}" has no pictures in asset.ts`);
        if (a.TEXCOORD_0 === undefined || a.NORMAL === undefined) throw new Error(`${g.path}: material "${material}" is on faces with no texture coordinates or no normals`);
      } else if (region >= 0 && region < REGION_COUNT) flat = REGION_BASE + region;
      else if (part !== parts[0]) flat = ownColour(prim.material);
      else {
        warnings.push(`material "${material}" is not one of the regions: read as the first`);
        flat = REGION_BASE;
      }
      const uv = pictured.length > 0 ? readAccessor(g, a.TEXCOORD_0!) : null;
      const normal = uv && readAccessor(g, a.NORMAL!);
      const tangent = uv && a.TANGENT !== undefined ? readAccessor(g, a.TANGENT) : null;
      // Every set of joints and weights, for the four bones that weigh most on a vertex.
      const sets: { joints: Float64Array; weights: Float64Array }[] = [];
      for (let s = 0; uv && a[`JOINTS_${s}`] !== undefined && a[`WEIGHTS_${s}`] !== undefined; s++) sets.push({ joints: readAccessor(g, a[`JOINTS_${s}`]!).data, weights: readAccessor(g, a[`WEIGHTS_${s}`]!).data });
      const base = positions.length / 3;
      for (let v = 0; v < pos.count; v++) {
        for (let k = 0; k < 3; k++) positions.push(pos.data[v * 3 + k]! * scale);
        level.loose.push(loose);
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
        if (!uv || !normal) {
          bones.push(boneOfNode.get(skin.joints[joints.data[v * 4 + best]!]!) ?? 0);
          colors.push(flat);
          continue;
        }
        // Joints that are left out weigh on the bone above them, so two of a vertex's joints may be one bone.
        const four = fourHeaviest(sets.flatMap((s) => [...s.joints.subarray(v * 4, v * 4 + 4)].map((j) => boneOfNode.get(skin.joints[j]!) ?? 0)), sets.flatMap((s) => [...s.weights.subarray(v * 4, v * 4 + 4)]));
        bones.push(four.bones[0] ?? 0);
        // Its flat colour is read off the pictures, when the levels are made.
        colors.push(0);
        for (let k = 0; k < 4; k++) level.joints.push(four.bones[k] ?? 0);
        for (let k = 0; k < 4; k++) level.weights.push(four.weights[k] ?? (k === 0 && four.bones.length === 0 ? 1 : 0));
        level.uvs.push(uv.data[v * 2]!, uv.data[v * 2 + 1]!);
        level.normals.push(normal.data[v * 3]!, normal.data[v * 3 + 1]!, normal.data[v * 3 + 2]!);
        if (tangent) level.tangents.push(tangent.data[v * 4]!, tangent.data[v * 4 + 1]!, tangent.data[v * 4 + 2]!, tangent.data[v * 4 + 3]! < 0 ? -1 : 1);
      }
      const index = readAccessor(g, prim.indices!);
      for (let i = 0; i < index.count; i++) indices.push(base + index.data[i]!);
      if (uv) for (let i = 0; i < index.count; i += 3) level.sections.push(Math.max(section, 0));
    }
  }
  if (passed > 0) warnings.push(`${passed} mesh objects are levels of the model's own, which a creature with pictures does not keep: its levels are made from its finest`);
  const fine = parts[0]!.levels[0];
  if (!fine || fine.positions.length === 0) throw new Error(`${g.path}: no skinned mesh`);
  for (const [k, part] of parts.entries()) {
    const { levels, weights } = part;
    const of = k === 0 ? "" : `${part.id}: `;
    if (k > 0 && levels.length === 0) {
      faults.push(`${of}the model has no skinned mesh object named ${objects[k - 1]!.map((o) => `"${o}"`).join(" or ")}`);
      continue;
    }
    for (let l = 0; l < levels.length; l++) {
      if (!levels[l]) throw new Error(`${g.path}: ${of}levels of detail must be consecutive, and there is no level ${l}`);
      if (levels[l]!.positions.length / 3 > 65535) throw new Error(`${g.path}: ${of}too many vertices for one mesh`);
    }
    if (weights.none > 0) faults.push(`${of}${weights.none} vertices that no joint weighs on`);
    if (weights.over > 0) faults.push(`${of}${weights.over} vertices with more than ${MOST_WEIGHTS} joints weighing on them`);
  }
  const weights = parts[0]!.weights;
  const { positions, bones } = fine;

  const vertsOf = (covers: readonly string[]): number[] => {
    const set = new Set(covers.map(bone));
    const out: number[] = [];
    for (let v = 0; v < bones.length; v++) if (set.has(bones[v]!)) out.push(v);
    return out;
  };

  // A fitted hit capsule runs along the line between two joints, as far as its vertices reach, with a radius that holds 85% of them.
  // It fits the body and not its loose cards, unless cards are all a zone has, as a tail of quills is.
  const bodyOf = (verts: number[]): number[] => {
    const own = verts.filter((v) => fine.loose[v] === 0);
    return own.length > 0 ? own : verts;
  };
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
    const verts = bodyOf(vertsOf(z.covers));
    const fitted = verts.length === 0 ? null : fitCapsule(positions, verts, z.from === undefined ? null : jointAt(z.from), z.to === undefined ? null : jointAt(z.to));
    if (!fitted) {
      warnings.push(`zone on "${z.on}" covers nothing: left out`);
      continue;
    }
    caps.push(carrier, ZONES[z.zone], ...[fitted.a, fitted.b].flatMap((p) => p.map((c, k) => +(c - rest[carrier * 3 + k]!).toFixed(4))), +fitted.radius.toFixed(4));
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
  const rig = withMotion({ id, skeleton: skeleton.id, rest: rest.map((v) => +v.toFixed(5)), names, parent, caps, sockets }, spec, made.clips, faults);
  const meshes = parts.filter((p) => p.levels.length > 0).map((p): SourceMesh => {
    const lods = p.levels.map((l): SourceLod => {
      const lod: SourceLod = { positions: Float32Array.from(l.positions), colors: Uint8Array.from(l.colors), indices: Uint32Array.from(l.indices), bones: Uint8Array.from(l.bones) };
      if (p.pictured.length === 0) return lod;
      Object.assign(lod, { uvs: Float32Array.from(l.uvs), normals: Float32Array.from(l.normals), joints: Uint8Array.from(l.joints), weights: Float32Array.from(l.weights), sections: Uint8Array.from(l.sections) });
      // Tangents are kept only where every part of the model has them.
      if (l.tangents.length === l.colors.length * 4) lod.tangents = Float32Array.from(l.tangents);
      return lod;
    });
    return { id: p.id, skeleton: skeleton.id, rig: id, lods };
  });
  return { rig, mesh: meshes[0]!, extra: meshes.slice(1), clips: made.clips, weights, warnings, faults };
}
