// Turns a skinned, textured glTF body from tools/blender/reduce.py into meshes cut by body slot. Every vertex
// follows one bone of the human skeleton, and every triangle has one palette colour or colour region.

import {
  B_FINGERS_L, B_FINGERS_R, B_FINGERTIPS_L, B_FINGERTIPS_R, B_HAND_L, B_HAND_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_TOE_L, B_TOE_R, HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_NAMES,
} from "../../shared/anim/human.ts";
import type { PackRig } from "../../shared/pack/pack.ts";
import { HUMAN_SOURCE_JOINTS } from "./anim.ts";
import { multiply4, nodeParents, readAccessor, restMatrices, type Gltf } from "./gltf.ts";
import { sampleImage, type Image } from "./png-read.ts";
import type { SourceLod, SourceMesh } from "./write.ts";

/** Maps a texture colour, 0 to 255 per channel, to a palette index or colour region. */
export type ColorRule = (r: number, g: number, b: number) => number;

export interface MaterialRule {
  /** The material's base colour texture, or null when the rule ignores the colour. */
  image: Image | null;
  color: ColorRule;
}

export interface BodyOptions {
  /** Mesh id prefix, such as "core:human_m". Slot meshes are "<id>/head" and so on. */
  id: string;
  /** Applied to the source so the body is the size of the skeleton. */
  scale: number;
  /** Keyed by material name. A primitive whose material has no rule is left out, with a warning. */
  materials: Readonly<Record<string, MaterialRule>>;
  /** Rig id. */
  rig: string;
  /** Make one mesh with this id instead of cutting by slot (hair, a beard). */
  whole?: string;
  /** Joint rest positions of the body it will be worn on. Each vertex moves by its bone's offset, so the piece fits that body. */
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
  /** seen maps (source vertex, colour) to a vertex of this part. any maps a source vertex to any one of its copies. */
  seen: Map<number, number>;
  any: Map<number, number>;
}

/** The human bone each source joint moves, by node index. */
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
    // Keep the original proximal/distal source articulation, grouped across the four fingers of each hand.
    if (/^(index|middle|ring|pinky)_/.test(name)) out.set(i, /_0[234](?:_leaf)?_/.test(name) ? side === 0 ? B_FINGERTIPS_L : B_FINGERTIPS_R : side === 0 ? B_FINGERS_L : B_FINGERS_R);
    else if (/^thumb_/.test(name)) out.set(i, side === 0 ? B_THUMB_L : B_THUMB_R);
    else if (/^ball_/.test(name)) out.set(i, side === 0 ? B_TOE_L : B_TOE_R);
    else {
      // Any other joint follows the nearest mapped joint above it.
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

/** The source's joint rest positions, scaled, including the appended distal-finger pivots. */
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
  // The prop bones have no source joint. They sit in the palm as they do on the skeleton.
  for (const [prop, hand] of [[B_PROP_L, B_HAND_L], [B_PROP_R, B_HAND_R]] as const) {
    for (let k = 0; k < 3; k++) rest[prop * 3 + k] = rest[hand * 3 + k]! + HUMAN.rest[prop * 3 + k]! - HUMAN.rest[hand * 3 + k]!;
  }
  return { id, skeleton: HUMAN.id, rest: rest.map((v) => +v.toFixed(5)) };
}

/** Nodes named "..._LOD<n>" are level n, others level 0. Several files are parts of one thing, such as an outfit's pieces. */
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
    // Per joint, world(joint) * inverseBind(joint) carries a vertex of this mesh to model space at rest.
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

      // A vertex follows the human bone that its joint weights add up to most strongly.
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
        // First choose among the bones before the fingertips, each finger weighed whole. Splitting the finger must not
        // let a weaker hand/forearm branch win and change ordinary deformation or slot classification.
        const tipL = sum[B_FINGERTIPS_L]!, tipR = sum[B_FINGERTIPS_R]!;
        sum[B_FINGERS_L]! += tipL; sum[B_FINGERS_R]! += tipR;
        let best = 0;
        for (let b = 1; b < B_FINGERTIPS_L; b++) if (sum[b]! > sum[best]!) best = b;
        const whole = best;
        if (best === B_FINGERS_L && tipL > sum[B_FINGERS_L]! - tipL) best = B_FINGERTIPS_L;
        if (best === B_FINGERS_R && tipR > sum[B_FINGERS_R]! - tipR) best = B_FINGERTIPS_R;
        bone[v] = best;
        const m = bind[joints[v * 4 + top]!]!;
        const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
        for (let k = 0; k < 3; k++) {
          let p = (m[k]! * x + m[4 + k]! * y + m[8 + k]! * z + m[12 + k]!) * opts.scale;
          if (opts.onto) p += opts.onto[whole * 3 + k]! - rig.rest[whole * 3 + k]!;
          model[v * 3 + k] = p;
        }
      }

      for (let t = 0; t + 2 < index.length; t += 3) {
        const i0 = index[t]!, i1 = index[t + 1]!, i2 = index[t + 2]!;
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;
        // A triangle takes the texture colour at its middle.
        let color = 0;
        if (rule.image) {
          const u = (uv![i0 * 2]! + uv![i1 * 2]! + uv![i2 * 2]!) / 3;
          const w = (uv![i0 * 2 + 1]! + uv![i1 * 2 + 1]! + uv![i2 * 2 + 1]!) / 3;
          sampleImage(rule.image, u, w, 2, rgb);
          color = rule.color(rgb[0]!, rgb[1]!, rgb[2]!);
        } else color = rule.color(0, 0, 0);
        // A triangle goes to the slot most of its corners belong to, or the first corner's when all three differ.
        let slot = 0;
        if (!whole) {
          const s0 = HUMAN.slot[bone[i0]!]!, s1 = HUMAN.slot[bone[i1]!]!, s2 = HUMAN.slot[bone[i2]!]!;
          slot = s1 === s2 ? s1 : s0;
        }
        const part = parts[slot]!;
        // A triangle is drawn in the colour of its last vertex, so that vertex must have this colour.
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
        // The other two corners take any existing copy of their vertex, because their colour is not used.
        const shared = (i: number): number => part.any.get(i) ?? corner(i);
        part.indices.push(shared(i0), shared(i1), corner(i2));
      }
      // Vertex keys are per primitive, because another primitive numbers its own vertices.
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
  // A piece fitted onto another body's joints is on that body's rig.
  return { meshes, rig: opts.onto ? { id: opts.rig, skeleton: HUMAN.id, rest: [...opts.onto] } : rig, warnings };
}
