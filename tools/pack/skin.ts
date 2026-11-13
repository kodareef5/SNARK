// Turns a skinned, textured glTF body into what the game draws: meshes cut by
// body slot, every vertex on one bone of the 28-bone skeleton, every triangle
// one palette colour or colour region.
//
// The source is what tools/blender/reduce.py wrote: the original body at a few
// levels of detail, still on its 65-joint skeleton, still with texture
// coordinates. Three things are decided here:
//
//   bone     a vertex follows the bone of ours that the joints it was weighted
//            to add up to most strongly. Fingers fold into one bone, toes into
//            another.
//   colour   a triangle takes the colour its texture has at its middle, turned
//            into a palette index or a colour region by a rule per material.
//   slot     a triangle belongs to the slot of the bone most of its corners
//            follow, so a worn piece can replace exactly that part.
//
// The body's own joint positions become its rig: the same bones as the
// skeleton, resting where this body has them.

import {
  B_FINGERS_L, B_FINGERS_R, B_HAND_L, B_HAND_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R, HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_NAMES,
} from "../../shared/anim/human.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { HUMAN_SOURCE_JOINTS } from "./anim.ts";
import { multiply4, nodeParents, readAccessor, restMatrices, type Gltf } from "./gltf.ts";
import { sampleImage, type Image } from "./png-read.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** A texture colour (0..255 each) to a palette index or colour region. */
export type ColorRule = (r: number, g: number, b: number) => number;

export interface MaterialRule {
  /** The material's base colour texture, or null when the rule ignores the colour. */
  image: Image | null;
  color: ColorRule;
}

export interface BodyOptions {
  /** Mesh id prefix, such as "core:human_m". Slot meshes are "<id>/head" and so on. */
  id: string;
  /** Scale applied to the source, so that the body is the size the skeleton is. */
  scale: number;
  /** Rule per material name. A primitive whose material has no rule is left out, with a warning. */
  materials: Readonly<Record<string, MaterialRule>>;
  /** Id of the rig these meshes are made on. */
  rig: string;
  /** Make one mesh with this id instead of cutting by slot (hair, a beard). */
  whole?: string;
  /**
   * Where the joints of the body it will be worn on rest. Vertices are moved,
   * bone by bone, from where the source's joints rest to these, so that a piece
   * sits right on a body it was not modelled on.
   */
  onto?: readonly number[];
}

export interface ConvertedBody {
  meshes: SourceMesh[];
  /** Where this body's joints rest, as a rig of the humanoid skeleton. */
  rig: PackRig;
  warnings: string[];
}

interface Part {
  positions: number[];
  colors: number[];
  bones: number[];
  indices: number[];
  /** (source vertex, colour) to vertex of this part, and source vertex to any one of its copies. */
  seen: Map<number, number>;
  any: Map<number, number>;
}

/** Which of our bones each joint of the source skeleton moves, by node index. */
function boneOfJoints(g: Gltf): Map<number, number> {
  const nodes = g.json.nodes ?? [];
  const parent = nodeParents(g);
  const direct = new Map<number, number>();
  HUMAN_SOURCE_JOINTS.forEach((name, bone) => {
    if (name === null) return;
    const i = nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`${g.path}: no joint named "${name}"`);
    direct.set(i, bone);
  });
  const out = new Map<number, number>();
  nodes.forEach((node, i) => {
    const name = node.name ?? "";
    const side = /_l$/.test(name) ? 0 : 1;
    // Every finger joint folds into the one fingers bone of its hand, every thumb joint into the thumb.
    if (/^(index|middle|ring|pinky)_/.test(name)) out.set(i, side === 0 ? B_FINGERS_L : B_FINGERS_R);
    else if (/^thumb_/.test(name)) out.set(i, side === 0 ? B_THUMB_L : B_THUMB_R);
    else if (/^ball_/.test(name)) out.set(i, side === 0 ? B_TOE_L : B_TOE_R);
    else {
      // Anything else follows the nearest joint above it that is one of ours.
      for (let j = i; j >= 0; j = parent[j]!) {
        const bone = direct.get(j);
        if (bone !== undefined) {
          out.set(i, bone);
          break;
        }
      }
    }
  });
  return out;
}

/** Where the source's joints rest, scaled, as positions of our 28 bones. */
export function rigOf(g: Gltf, id: string, scale: number): PackRig {
  const nodes = g.json.nodes ?? [];
  const world = restMatrices(g);
  const rest = new Array<number>(HUMAN_BONES * 3).fill(0);
  HUMAN_SOURCE_JOINTS.forEach((name, bone) => {
    if (name === null) return;
    const i = nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`${g.path}: no joint named "${name}"`);
    for (let k = 0; k < 3; k++) rest[bone * 3 + k] = world[i]![12 + k]! * scale;
  });
  // The prop bones have no joint in the source: they sit in the palm as they do on the skeleton.
  for (const [prop, hand] of [[B_PROP_L, B_HAND_L], [B_PROP_R, B_HAND_R]] as const) {
    for (let k = 0; k < 3; k++) rest[prop * 3 + k] = rest[hand * 3 + k]! + HUMAN.rest[prop * 3 + k]! - HUMAN.rest[hand * 3 + k]!;
  }
  return { id, skeleton: HUMAN.id, rest: rest.map((v) => +v.toFixed(5)) };
}

/**
 * Convert every skinned mesh of the given files into one set of meshes. Nodes
 * named "..._LOD<n>" are level n; others level 0. Several files are several
 * parts of one thing (an outfit's body, arms, legs and feet).
 */
export function convertBody(sources: Gltf | readonly Gltf[], opts: BodyOptions): ConvertedBody {
  const list = Array.isArray(sources) ? (sources as readonly Gltf[]) : [sources as Gltf];
  const warnings: string[] = [];
  const whole = opts.whole;
  const partCount = whole ? 1 : SLOT_COUNT;
  /** parts[level][slot] */
  const levels: Part[][] = [];
  const rgb = [0, 0, 0];
  const warned = new Set<string>();
  let rig = rigOf(list[0]!, opts.rig, opts.scale);

  for (const g of list) {
  const json = g.json;
  const nodes = json.nodes ?? [];
  const world = restMatrices(g);
  const boneOf = boneOfJoints(g);
  rig = rigOf(g, opts.rig, opts.scale);
  nodes.forEach((node) => {
    if (node.mesh === undefined || node.skin === undefined) return;
    const level = Number(/_LOD(\d)$/i.exec(node.name ?? "")?.[1] ?? 0);
    while (levels.length <= level) levels.push(Array.from({ length: partCount }, () => ({ positions: [], colors: [], bones: [], indices: [], seen: new Map(), any: new Map() })));
    const parts = levels[level]!;
    const skin = json.skins![node.skin]!;
    const inverse = skin.inverseBindMatrices === undefined ? null : readAccessor(g, skin.inverseBindMatrices).data;
    // What carries a vertex of this mesh to model space at rest, per joint: world(joint) * inverseBind(joint).
    const bind = skin.joints.map((j, k) => (inverse ? multiply4(world[j]!, inverse.subarray(k * 16, k * 16 + 16)) : world[j]!));
    for (const prim of json.meshes![node.mesh]!.primitives) {
      if ((prim.mode ?? 4) !== 4) continue;
      const material = prim.material === undefined ? "" : (json.materials?.[prim.material]?.name ?? "");
      const rule = opts.materials[material];
      if (!rule) {
        if (!warned.has(material)) warnings.push(`material "${material}" has no rule; its triangles are left out`);
        warned.add(material);
        continue;
      }
      const a = prim.attributes;
      if (a.POSITION === undefined || a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) {
        warnings.push(`node "${node.name}": a primitive without positions, joints and weights was left out`);
        continue;
      }
      const pos = readAccessor(g, a.POSITION).data;
      const joints = readAccessor(g, a.JOINTS_0).data;
      const weights = readAccessor(g, a.WEIGHTS_0).data;
      const uv = a.TEXCOORD_0 === undefined ? null : readAccessor(g, a.TEXCOORD_0).data;
      if (rule.image && !uv) {
        warnings.push(`node "${node.name}": no texture coordinates; left out`);
        continue;
      }
      const count = pos.length / 3;
      const index = prim.indices === undefined ? Float64Array.from({ length: count }, (_, i) => i) : readAccessor(g, prim.indices).data;

      // Per source vertex: where it is in model space, and the bone it follows.
      const model = new Float64Array(count * 3);
      const bone = new Uint8Array(count);
      const sum = new Float64Array(HUMAN_BONES);
      for (let v = 0; v < count; v++) {
        sum.fill(0);
        let top = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights[v * 4 + k]!;
          if (w <= 0) continue;
          const b = boneOf.get(skin.joints[joints[v * 4 + k]!]!);
          if (b !== undefined) sum[b]! += w;
          if (w > weights[v * 4 + top]!) top = k;
        }
        let best = 0;
        for (let b = 1; b < HUMAN_BONES; b++) if (sum[b]! > sum[best]!) best = b;
        bone[v] = best;
        const m = bind[joints[v * 4 + top]!]!;
        const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
        for (let k = 0; k < 3; k++) {
          let p = (m[k]! * x + m[4 + k]! * y + m[8 + k]! * z + m[12 + k]!) * opts.scale;
          // A piece made on another body moves, bone by bone, to where this one's joints are.
          if (opts.onto) p += opts.onto[best * 3 + k]! - rig.rest[best * 3 + k]!;
          model[v * 3 + k] = p;
        }
      }

      for (let t = 0; t + 2 < index.length; t += 3) {
        const i0 = index[t]!, i1 = index[t + 1]!, i2 = index[t + 2]!;
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        // The colour at the middle of the triangle.
        let color = 0;
        if (rule.image) {
          const u = (uv![i0 * 2]! + uv![i1 * 2]! + uv![i2 * 2]!) / 3;
          const w = (uv![i0 * 2 + 1]! + uv![i1 * 2 + 1]! + uv![i2 * 2 + 1]!) / 3;
          sampleImage(rule.image, u, w, 2, rgb);
          color = rule.color(rgb[0]!, rgb[1]!, rgb[2]!);
        } else color = rule.color(0, 0, 0);
        // The slot most corners belong to; the first corner's when all three differ.
        let slot = 0;
        if (!whole) {
          const s0 = HUMAN.slot[bone[i0]!]!, s1 = HUMAN.slot[bone[i1]!]!, s2 = HUMAN.slot[bone[i2]!]!;
          slot = s1 === s2 ? s1 : s0;
        }
        const part = parts[slot]!;
        // A triangle is drawn in the colour of its last vertex, so that vertex is one of this colour.
        const corner = (i: number): number => {
          const key = i * 256 + color;
          let at = part.seen.get(key);
          if (at === undefined) {
            at = part.positions.length / 3;
            part.positions.push(model[i * 3]!, model[i * 3 + 1]!, model[i * 3 + 2]!);
            part.colors.push(color);
            part.bones.push(bone[i]!);
            part.seen.set(key, at);
            if (!part.any.has(i)) part.any.set(i, at);
          }
          return at;
        };
        // The other two corners take any copy of their vertex that exists: their colour is not used.
        const shared = (i: number): number => part.any.get(i) ?? corner(i);
        part.indices.push(shared(i0), shared(i1), corner(i2));
      }
      // Vertex keys are per primitive: another primitive's vertex numbers mean other vertices.
      for (const p of parts) {
        p.seen.clear();
        p.any.clear();
      }
    }
  });
  }

  if (levels.length === 0) throw new Error(`${list[0]!.path}: no skinned mesh`);
  const meshes: SourceMesh[] = [];
  for (let slot = 0; slot < partCount; slot++) {
    const lods: SourceLod[] = [];
    for (const parts of levels) {
      const p = parts[slot]!;
      if (p.indices.length === 0) break;
      lods.push({ positions: Float32Array.from(p.positions), colors: Uint8Array.from(p.colors), bones: Uint8Array.from(p.bones), indices: Uint32Array.from(p.indices) });
    }
    const id = whole ?? `${opts.id}/${SLOT_NAMES[slot]}`;
    // A set need not have a piece for every slot.
    if (lods.length === 0) continue;
    meshes.push({ id, lods, skeleton: HUMAN.id, rig: opts.rig });
  }
  // Made to sit on another body's joints, it is on that body's rig.
  return { meshes, rig: opts.onto ? { id: opts.rig, skeleton: HUMAN.id, rest: [...opts.onto] } : rig, warnings };
}
