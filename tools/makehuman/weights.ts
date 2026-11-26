// Reads MakeHuman skin weights (.mhw, JSON): for each bone, the base vertices it moves and by how much. A skeleton
// names its weights file (weights_file in the .mhskel). Bones that move nothing are absent.

import { readFileSync } from "node:fs";

export interface Weights {
  readonly name: string;
  readonly license: string;
  /** Vertex and weight pairs by bone name, as the file lists them. */
  readonly bones: ReadonlyMap<string, { readonly vertices: Uint32Array; readonly weights: Float32Array }>;
}

export function parseWeights(text: string, path = "weights"): Weights {
  const json = JSON.parse(text) as { name?: string; license?: string; weights: Record<string, [number, number][]> };
  if (!json.weights || typeof json.weights !== "object") throw new Error(`${path}: no weights`);
  const bones = new Map<string, { vertices: Uint32Array; weights: Float32Array }>();
  for (const [bone, pairs] of Object.entries(json.weights)) {
    const vertices = new Uint32Array(pairs.length);
    const weights = new Float32Array(pairs.length);
    pairs.forEach(([v, w], i) => {
      if (!Number.isInteger(v) || v < 0) throw new Error(`${path}: bone ${bone} names vertex ${v}`);
      vertices[i] = v;
      weights[i] = w;
    });
    bones.set(bone, { vertices, weights });
  }
  return { name: json.name ?? "", license: json.license ?? "", bones };
}

export function readWeights(path: string): Weights {
  return parseWeights(readFileSync(path, "utf8"), path);
}

export interface Influences {
  /** Where each vertex's influences start in `bone` and `weight`; one more entry than there are vertices. */
  readonly start: Uint32Array;
  /** Index into `boneNames`. */
  readonly bone: Uint16Array;
  readonly weight: Float32Array;
}

/**
 * The bones on each of `vertexCount` vertices, heaviest first, as written (not normalised). `boneNames` sets the bone
 * indices, a skeleton's bones in order; a weighted bone missing from it throws.
 */
export function influences(w: Weights, boneNames: readonly string[], vertexCount: number): Influences {
  const index = new Map(boneNames.map((n, i) => [n, i]));
  const lists: { bone: number; weight: number }[][] = Array.from({ length: vertexCount }, () => []);
  for (const [name, { vertices, weights }] of w.bones) {
    const b = index.get(name);
    if (b === undefined) throw new Error(`weights name bone ${name}, which the skeleton has not`);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i]!;
      if (v >= vertexCount) throw new Error(`bone ${name} weighs on vertex ${v}, past the mesh's ${vertexCount}`);
      if (weights[i]! > 0) lists[v]!.push({ bone: b, weight: weights[i]! });
    }
  }
  const start = new Uint32Array(vertexCount + 1);
  let total = 0;
  for (let v = 0; v < vertexCount; v++) {
    lists[v]!.sort((a, b) => b.weight - a.weight || a.bone - b.bone);
    total += lists[v]!.length;
    start[v + 1] = total;
  }
  const bone = new Uint16Array(total);
  const weight = new Float32Array(total);
  for (let v = 0; v < vertexCount; v++) {
    lists[v]!.forEach((e, k) => {
      bone[start[v]! + k] = e.bone;
      weight[start[v]! + k] = e.weight;
    });
  }
  return { start, bone, weight };
}
