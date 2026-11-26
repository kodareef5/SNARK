// Reads MakeHuman morph targets: sparse lines of "vertex dx dy dz" on the base mesh, as text or gzipped (MPFB ships
// .target.gz). A modifier's weight scales the deltas, and weights of many targets add.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export interface Target {
  /** Base vertices the target moves, in file order. */
  readonly vertices: Uint32Array;
  /** dx, dy, dz a moved vertex, in decimetres. */
  readonly deltas: Float32Array;
}

export function parseTarget(text: string, path = "target"): Target {
  const vertices: number[] = [];
  const deltas: number[] = [];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim();
    if (line === "" || line[0] === "#") continue;
    const w = line.split(/\s+/);
    const v = Number(w[0]);
    if (w.length !== 4 || !Number.isInteger(v) || v < 0) throw new Error(`${path}:${n + 1}: expected "vertex dx dy dz"`);
    vertices.push(v);
    deltas.push(Number(w[1]), Number(w[2]), Number(w[3]));
  }
  return { vertices: new Uint32Array(vertices), deltas: new Float32Array(deltas) };
}

export function readTarget(path: string): Target {
  const bytes = readFileSync(path);
  const text = path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return parseTarget(text, path);
}

/** Adds `weight` times the target's deltas to `positions` (x, y, z a vertex) in place. */
export function applyTarget(positions: Float32Array, target: Target, weight: number): Float32Array {
  const { vertices, deltas } = target;
  for (let i = 0; i < vertices.length; i++) {
    const at = vertices[i]! * 3;
    if (at + 2 >= positions.length) throw new Error(`a target moves vertex ${vertices[i]}, past the mesh's ${positions.length / 3}`);
    positions[at] += weight * deltas[i * 3]!;
    positions[at + 1] += weight * deltas[i * 3 + 1]!;
    positions[at + 2] += weight * deltas[i * 3 + 2]!;
  }
  return positions;
}

/** A copy of `base` with each target added at its weight. */
export function morph(base: Float32Array, targets: readonly { target: Target; weight: number }[]): Float32Array {
  const out = base.slice();
  for (const { target, weight } of targets) if (weight !== 0) applyTarget(out, target, weight);
  return out;
}

/** Target files under `dir` by their group, the first folder below `dir`, each list in name order. */
export function targetFiles(dir: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const walk = (at: string, group: string): void => {
    for (const name of readdirSync(at).sort()) {
      const p = join(at, name);
      if (statSync(p).isDirectory()) walk(p, group || name);
      else if (group && (name.endsWith(".target") || name.endsWith(".target.gz"))) {
        const list = groups.get(group) ?? [];
        list.push(p);
        groups.set(group, list);
      }
    }
  };
  walk(dir, "");
  return groups;
}
