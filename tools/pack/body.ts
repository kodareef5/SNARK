// The human cook. Reads skinned, textured glTF bodies, hair and outfits as they come and makes a person's meshes: every
// level keeps the flat stream (a palette colour or colour region and one bone a vertex), and the finer levels also keep
// their surface, up to four bones a vertex and up to three materials, as a creature's do. Hands and feet stay on one
// bone a vertex at every level, since the grips and soles are calibrated on them. A bare body's triangles go by skin zone
// (shared/anim/skin-zones.ts), whose borders are held as material borders are, so a part drawn without a zone has no crack.

import {
  B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R,
  HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_FEET, SLOT_HANDS, SLOT_NAMES,
} from "../../shared/anim/human.ts";
import { SKIN_ZONE_SLOT, skinZoneAt } from "../../shared/anim/skin-zones.ts";
import { TEXTURE_ROLES } from "../../shared/pack/texture.ts";
import { setTexture, textureOf, type PackMaterial, type PackRig, type PackTexture } from "../../shared/pack/pack.ts";
import { multiply4, readAccessor, restMatrices, type Gltf } from "./gltf.ts";
import { simplifySurface, withSurfaceLevels, type ByZone } from "./simplify.ts";
import { boneOfJoints, ownBone, rigOf } from "./skin.ts";
import { fourHeaviest, spanOf } from "./surface.ts";
import type { MaterialMaps } from "./texture.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** Bones whose vertices are wholly on their own bone at every level: the hands and the feet. */
export const RIGID_BONES: ReadonlySet<number> = new Set([B_HAND_L, B_FINGERS_L, B_FINGERTIPS_L, B_THUMB_L, B_PROP_L, B_HAND_R, B_FINGERS_R, B_FINGERTIPS_R, B_THUMB_R, B_PROP_R, B_FOOT_L, B_TOE_L, B_FOOT_R, B_TOE_R]);

/**
 * By skin zone, how much more a point of it costs to move as levels are made: the head, hands and feet are small and
 * rigid, so a level made by error alone keeps little of them. These give each slot about the share of a level Blender's
 * reduction gave it.
 */
export const ZONE_WEIGHTS: readonly number[] = [100, 5, 1, 1, 1, 1, 1, 1, 1, 1, 100, 100, 1, 1, 1, 1, 1, 1, 1, 25, 25];

/** A material as the cook takes it: what the pack says of it, its textures, and its pictures for the flat colours. */
export interface CookMaterial {
  material: PackMaterial;
  textures: readonly PackTexture[];
  maps: MaterialMaps;
}

export interface CookOptions {
  /** Mesh id prefix, such as "core:human_m". Slot meshes are "<id>/head" and so on. */
  id: string;
  /** Applied to the source so the body is the size of the skeleton. */
  scale: number;
  rig: string;
  /** Each source material the cook keeps, by name: its place in `materials`. A primitive whose material is not named is left out. */
  sections: Readonly<Record<string, number>>;
  materials: readonly CookMaterial[];
  /** Make one mesh with this id instead of cutting by slot (hair, a beard). */
  whole?: string;
  /** Joint rest positions of the body it is fitted to. Each vertex moves by its bones' offsets, as much as each weighs on it. */
  onto?: readonly number[];
  /** Whether the meshes keep their triangles by skin zone: a bare body. */
  zoned?: boolean;
  /** The finest level's most triangles, and then each coarser level's. */
  triangles: readonly number[];
  /** The first flat level: the levels before it keep their surface. */
  flat: number;
  /** How its zones are kept as levels are made (simplify.ts ByZone). On a piece cut by slot, ZONE_WEIGHTS and the slots where not given. */
  byZone?: ByZone;
  palette: Uint8Array;
}

export interface Cooked {
  meshes: SourceMesh[];
  /** Where the joints rest: the source's own, or `onto` where given. */
  rig: PackRig;
  warnings: string[];
  /** Vertices of the finest level, and how many of them blend more than one bone. */
  vertices: number;
  blended: number;
}

/** A whole body as one level before it is cut by slot: what every primitive brought, every vertex its own. */
interface Gathered {
  positions: number[];
  normals: number[];
  uvs: number[];
  bones: number[];
  joints: number[];
  weights: number[];
  indices: number[];
  sections: number[];
  zones: number[];
  /** 1 for a vertex held wholly on its own bone: a hand's or a foot's. */
  rigid: number[];
}

/** The materials' textures as one list, each material naming its own by their place in it. */
export function pooled(materials: readonly CookMaterial[]): { materials: PackMaterial[]; textures: PackTexture[] } {
  const textures: PackTexture[] = [];
  const out = materials.map((m) => {
    const material = { ...m.material };
    for (const role of TEXTURE_ROLES) if (textureOf(material, role) >= 0) setTexture(material, role, textureOf(material, role) + textures.length);
    textures.push(...m.textures);
    return material;
  });
  return { materials: out, textures };
}

/** Rotates a direction by the inverse transpose of a matrix's upper 3 by 3: how a normal moves with a point. */
function normalBy(m: Float64Array, x: number, y: number, z: number, out: number[]): void {
  const c = [[m[0]!, m[1]!, m[2]!], [m[4]!, m[5]!, m[6]!], [m[8]!, m[9]!, m[10]!]];
  // The cofactor matrix is the inverse transpose up to a scale, which normalising removes.
  const row = (i: number): number[] => {
    const [a, b] = [c[(i + 1) % 3]!, c[(i + 2) % 3]!];
    return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  };
  const [r0, r1, r2] = [row(0), row(1), row(2)];
  for (let a = 0; a < 3; a++) out[a] = r0[a]! * x + r1[a]! * y + r2[a]! * z;
  const len = Math.hypot(out[0]!, out[1]!, out[2]!) || 1;
  for (let a = 0; a < 3; a++) out[a]! /= len;
}

function gather(list: readonly Gltf[], opts: CookOptions, warnings: string[]): { at: Gathered; rig: PackRig } {
  const at: Gathered = { positions: [], normals: [], uvs: [], bones: [], joints: [], weights: [], indices: [], sections: [], zones: [], rigid: [] };
  const warned = new Set<string>();
  let rig = rigOf(list[0]!, opts.rig, opts.scale);
  const n = [0, 0, 0];
  const sum = new Float64Array(HUMAN_BONES);
  for (const g of list) {
    const json = g.json;
    const world = restMatrices(g);
    const boneOf = boneOfJoints(g);
    rig = rigOf(g, opts.rig, opts.scale);
    const onto = opts.onto ?? rig.rest;
    for (const node of json.nodes ?? []) {
      if (node.mesh === undefined || node.skin === undefined) continue;
      if (/_LOD[1-9]$/i.test(node.name ?? "")) continue;
      const skin = json.skins![node.skin]!;
      const inverse = skin.inverseBindMatrices === undefined ? null : readAccessor(g, skin.inverseBindMatrices).data;
      // Per joint, world(joint) * inverseBind(joint) carries a vertex of this mesh to model space at rest.
      const bind = skin.joints.map((j, k) => (inverse ? multiply4(world[j]!, inverse.subarray(k * 16, k * 16 + 16)) : world[j]!));
      for (const prim of json.meshes![node.mesh]!.primitives) {
        if ((prim.mode ?? 4) !== 4) continue;
        const material = prim.material === undefined ? "" : (json.materials?.[prim.material]?.name ?? "");
        const section = opts.sections[material];
        if (section === undefined) {
          if (!warned.has(material)) warnings.push(`material "${material}" is not cooked; its triangles are left out`);
          warned.add(material);
          continue;
        }
        const a = prim.attributes;
        if (a.POSITION === undefined || a.NORMAL === undefined || a.TEXCOORD_0 === undefined || a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) {
          warnings.push(`node "${node.name}": a primitive without positions, normals, texture coordinates, joints and weights was left out`);
          continue;
        }
        const pos = readAccessor(g, a.POSITION).data;
        const normal = readAccessor(g, a.NORMAL).data;
        const uv = readAccessor(g, a.TEXCOORD_0).data;
        const sets: { joints: Float64Array; weights: Float64Array }[] = [];
        for (let s = 0; a[`JOINTS_${s}`] !== undefined && a[`WEIGHTS_${s}`] !== undefined; s++) sets.push({ joints: readAccessor(g, a[`JOINTS_${s}`]!).data, weights: readAccessor(g, a[`WEIGHTS_${s}`]!).data });
        const count = pos.length / 3;
        const index = prim.indices === undefined ? Float64Array.from({ length: count }, (_, i) => i) : readAccessor(g, prim.indices).data;
        const base = at.bones.length;
        for (let v = 0; v < count; v++) {
          sum.fill(0);
          let top = 0;
          let topWeight = -1;
          const bones: number[] = [];
          const weights: number[] = [];
          for (const s of sets) {
            for (let k = 0; k < 4; k++) {
              const w = s.weights[v * 4 + k]!;
              if (w <= 0) continue;
              const joint = s.joints[v * 4 + k]!;
              const b = boneOf.get(skin.joints[joint]!);
              if (b === undefined) continue;
              sum[b]! += w;
              bones.push(b);
              weights.push(w);
              if (w > topWeight) [top, topWeight] = [joint, w];
            }
          }
          const own = ownBone(sum);
          let four = fourHeaviest(bones, weights);
          const rigid = RIGID_BONES.has(own);
          at.rigid.push(rigid ? 1 : 0);
          if (rigid || four.bones.length === 0) four = { bones: [own], weights: [1], dropped: false };
          else if (!four.bones.includes(own)) {
            four.bones[four.bones.length - 1] = own;
            const total = four.weights.reduce((t, w, k) => t + (k < four.weights.length - 1 ? w : 0), 0) + sum[own]!;
            four.weights[four.weights.length - 1] = sum[own]!;
            four.weights = four.weights.map((w) => w / total);
          }
          const m = bind[top]!;
          const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
          for (let k = 0; k < 3; k++) {
            let p = (m[k]! * x + m[4 + k]! * y + m[8 + k]! * z + m[12 + k]!) * opts.scale;
            for (let j = 0; j < four.bones.length; j++) p += four.weights[j]! * (onto[four.bones[j]! * 3 + k]! - rig.rest[four.bones[j]! * 3 + k]!);
            at.positions.push(p);
          }
          normalBy(m, normal[v * 3]!, normal[v * 3 + 1]!, normal[v * 3 + 2]!, n);
          at.normals.push(n[0]!, n[1]!, n[2]!);
          at.uvs.push(uv[v * 2]!, uv[v * 2 + 1]!);
          at.bones.push(own);
          for (let k = 0; k < 4; k++) {
            at.joints.push(four.bones[k] ?? own);
            at.weights.push(four.weights[k] ?? 0);
          }
        }
        for (let t = 0; t + 2 < index.length; t += 3) {
          const [i0, i1, i2] = [base + index[t]!, base + index[t + 1]!, base + index[t + 2]!];
          if (i0 === i1 || i1 === i2 || i0 === i2) continue;
          at.indices.push(i0, i1, i2);
          at.sections.push(section);
        }
      }
    }
  }
  return { at, rig: opts.onto ? { id: opts.rig, skeleton: HUMAN.id, rest: [...opts.onto] } : rig };
}

/** Each triangle's skin zone: the zone most of its corners are in, or its first corner's where all three differ. */
function zonesOf(at: Gathered, rest: readonly number[]): void {
  const of = at.bones.map((b, v) => skinZoneAt(b, at.positions[v * 3]!, at.positions[v * 3 + 1]!, at.positions[v * 3 + 2]!, rest));
  at.zones = [];
  for (let t = 0; t < at.indices.length; t += 3) {
    const [z0, z1, z2] = [of[at.indices[t]!]!, of[at.indices[t + 1]!]!, of[at.indices[t + 2]!]!];
    at.zones.push(z1 === z2 ? z1 : z0);
  }
}

/** Puts every corner of a hand or foot triangle wholly on its own bone, so the hands and feet meshes follow one bone a vertex. */
function stiffen(at: Gathered): void {
  for (let t = 0; t < at.indices.length; t += 3) {
    const slot = SKIN_ZONE_SLOT[at.zones[t / 3]!]!;
    if (slot !== SLOT_HANDS && slot !== SLOT_FEET) continue;
    for (let k = 0; k < 3; k++) {
      const v = at.indices[t + k]!;
      at.rigid[v] = 1;
      for (let j = 0; j < 4; j++) {
        at.joints[v * 4 + j] = at.bones[v]!;
        at.weights[v * 4 + j] = j === 0 ? 1 : 0;
      }
    }
  }
}

/** The limbs whose far joint's bend is eased into rings before the rigid hand or foot: limb, far bone, metres eased over. */
const EASED: readonly (readonly [limb: number, end: number, reach: number])[] = [
  [B_LOWER_ARM_L, B_HAND_L, 0.06], [B_LOWER_ARM_R, B_HAND_R, 0.06], [B_LOWER_LEG_L, B_FOOT_L, 0.08], [B_LOWER_LEG_R, B_FOOT_R, 0.08],
];
/** The most a far bone weighs on the forearm or shin, at the edge of the rigid hand or foot. */
const EASED_MOST = 0.5;

/**
 * Gives the forearm and shin the wrist's and ankle's bend: the hand and foot are rigid, so a vertex of the limb before
 * them weighs on them more the nearer it is, from nothing `reach` back to EASED_MOST at their edge. A vertex keeps its
 * own weight on them where that is more.
 */
function ease(at: Gathered, rest: readonly number[]): void {
  const n = at.bones.length;
  const rigid = (v: number): boolean => at.rigid[v] === 1;
  for (const [limb, end, reach] of EASED) {
    const axis = [0, 1, 2].map((k) => rest[end * 3 + k]! - rest[limb * 3 + k]!);
    const len = Math.hypot(axis[0]!, axis[1]!, axis[2]!);
    const along = (v: number): number => [0, 1, 2].reduce((t, k) => t + (at.positions[v * 3 + k]! - rest[end * 3 + k]!) * axis[k]!, 0) / len;
    // Where the rigid part begins along the limb: its nearest vertex that is wholly on the far bone's side.
    let edge = Infinity;
    for (let v = 0; v < n; v++) if (rigid(v) && HUMAN.slot[at.bones[v]!] === HUMAN.slot[end] && sideOf(at.bones[v]!) === sideOf(end)) edge = Math.min(edge, along(v));
    if (edge === Infinity) continue;
    for (let v = 0; v < n; v++) {
      if (at.bones[v] !== limb || rigid(v)) continue;
      const t = along(v);
      if (t > edge || t < edge - reach) continue;
      const want = EASED_MOST * (1 - (edge - t) / reach);
      const w = at.weights.slice(v * 4, v * 4 + 4);
      const j = at.joints.slice(v * 4, v * 4 + 4);
      let k = j.findIndex((b, i) => b === end && w[i]! > 0);
      const had = k >= 0 ? w[k]! : 0;
      if (had >= want) continue;
      if (k < 0) {
        // The lightest place other than the vertex's own bone gives way to the far bone.
        k = [0, 1, 2, 3].filter((i) => j[i] !== limb || w[i] === 0).sort((a, b) => w[a]! - w[b]!)[0]!;
        w[k] = 0;
        j[k] = end;
      }
      const rest = w.reduce((sum, x, i) => sum + (i === k ? 0 : x), 0);
      for (let i = 0; i < 4; i++) w[i] = i === k ? want : rest > 0 ? (w[i]! * (1 - want)) / rest : 0;
      at.weights.splice(v * 4, 4, ...w);
      at.joints.splice(v * 4, 4, ...j);
    }
  }
}

/** -1 for a bone of the body's middle, 0 for its left side, 1 for its right. */
const sideOf = (bone: number): number => (/\.L$/.test(HUMAN.names[bone]!) ? 0 : /\.R$/.test(HUMAN.names[bone]!) ? 1 : -1);

/** The triangles of `lod` that `keep` keeps, on vertices of their own: a slot's part of a level. */
function cut(lod: SourceLod, keep: (t: number) => boolean): SourceLod | null {
  const map = new Int32Array(lod.positions.length / 3).fill(-1);
  const kept: number[] = [];
  const indices: number[] = [];
  const triangles: number[] = [];
  for (let t = 0; t < lod.indices.length / 3; t++) {
    if (!keep(t)) continue;
    triangles.push(t);
    for (let k = 0; k < 3; k++) {
      const v = lod.indices[t * 3 + k]!;
      if (map[v]! < 0) map[v] = kept.push(v) - 1;
      indices.push(map[v]!);
    }
  }
  if (triangles.length === 0) return null;
  const each = <T extends Float32Array | Uint8Array>(all: T, size: number, make: (n: number) => T): T => {
    const out = make(kept.length * size);
    kept.forEach((v, i) => out.set(all.subarray(v * size, v * size + size), i * size));
    return out;
  };
  const out: SourceLod = { positions: each(lod.positions, 3, (n) => new Float32Array(n)), colors: each(lod.colors, 1, (n) => new Uint8Array(n)), indices: Uint32Array.from(indices) };
  if (lod.bones) out.bones = each(lod.bones, 1, (n) => new Uint8Array(n));
  if (lod.uvs) out.uvs = each(lod.uvs, 2, (n) => new Float32Array(n));
  if (lod.normals) out.normals = each(lod.normals, 3, (n) => new Float32Array(n));
  if (lod.tangents) out.tangents = each(lod.tangents, 4, (n) => new Float32Array(n));
  if (lod.joints) out.joints = each(lod.joints, 4, (n) => new Uint8Array(n));
  if (lod.weights) out.weights = each(lod.weights, 4, (n) => new Float32Array(n));
  if (lod.sections) out.sections = Uint8Array.from(triangles, (t) => lod.sections![t]!);
  if (lod.zones) out.zones = Uint8Array.from(triangles, (t) => lod.zones![t]!);
  return out;
}

/** Cooks one body, or a piece worn on one, from its source files: several are parts of one thing, such as an outfit's. */
export function cookBody(sources: Gltf | readonly Gltf[], opts: CookOptions): Cooked {
  const list = Array.isArray(sources) ? (sources as readonly Gltf[]) : [sources as Gltf];
  const warnings: string[] = [];
  const { at, rig } = gather(list, opts, warnings);
  if (at.indices.length === 0) throw new Error(`${list[0]!.path}: no skinned mesh`);
  zonesOf(at, rig.rest);
  if (!opts.whole) {
    stiffen(at);
    ease(at, rig.rest);
  }
  const { materials, textures } = pooled(opts.materials);
  const byZone = opts.byZone ?? (opts.whole ? {} : { weights: ZONE_WEIGHTS, groups: SKIN_ZONE_SLOT });
  let fine: SourceLod = {
    positions: Float32Array.from(at.positions), colors: new Uint8Array(at.bones.length), indices: Uint32Array.from(at.indices), bones: Uint8Array.from(at.bones),
    uvs: Float32Array.from(at.uvs), normals: Float32Array.from(at.normals), joints: Uint8Array.from(at.joints), weights: Float32Array.from(at.weights),
    sections: Uint8Array.from(at.sections), zones: Uint8Array.from(at.zones),
  };
  // A source finer than the finest level's budget is first brought down to it, keeping its surface.
  if (fine.indices.length / 3 > opts.triangles[0]!) fine = simplifySurface(fine, [opts.triangles[0]!], [], byZone)[0]!.lod;
  for (const [k, m] of materials.entries()) if (m.span === 0) m.span = spanOf(fine, k);
  const id = opts.whole ?? opts.id;
  const made = withSurfaceLevels({ id, lods: [fine], skeleton: HUMAN.id, rig: opts.rig, materials, textures }, {
    budgets: opts.triangles.slice(1), flat: opts.flat, maps: opts.materials.map((m) => m.maps), palette: opts.palette, byZone,
  });
  // The levels' errors are measured again on each part; a whole piece keeps the ones measured on it.
  const parts: { id: string; keep: (t: number, lod: SourceLod) => boolean }[] = opts.whole
    ? [{ id: opts.whole, keep: () => true }]
    : SLOT_NAMES.slice(0, SLOT_COUNT).map((name, slot) => ({ id: `${opts.id}/${name}`, keep: (t: number, lod: SourceLod) => SKIN_ZONE_SLOT[lod.zones![t]!] === slot }));
  const meshes: SourceMesh[] = [];
  for (const part of parts) {
    const lods: SourceLod[] = [];
    for (const lod of made.lods) {
      const piece = opts.whole ? { ...lod } : cut(lod, (t) => part.keep(t, lod));
      if (!piece) break;
      if (!opts.whole) delete piece.error;
      if (!opts.zoned) delete piece.zones;
      lods.push(piece);
    }
    // A set need not have a piece for every slot.
    if (lods.length === 0) continue;
    meshes.push({ id: part.id, lods, skeleton: HUMAN.id, rig: opts.rig, flat: Math.min(made.flat ?? 0, lods.length), materials, textures });
  }
  let blended = 0;
  for (let v = 0; v < at.bones.length; v++) if (at.weights[v * 4]! < 1) blended++;
  return { meshes, rig, warnings, vertices: at.bones.length, blended };
}
