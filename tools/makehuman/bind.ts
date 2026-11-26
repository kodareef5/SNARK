// Reads MakeHuman's binding of a mesh to the base (.mhclo for garments, eyes, brows, lashes and teeth; .proxy for body
// proxies), and places the bound mesh on a morphed base. Each bound vertex is one base vertex, or three base vertices
// with weights plus an offset that grows with the body along each axis.

import { readFileSync } from "node:fs";

/** Two base vertices and their distance along one axis on the body the binding was made on. */
export interface AxisScale {
  readonly a: number;
  readonly b: number;
  readonly length: number;
}

export interface Binding {
  readonly name: string;
  readonly uuid: string;
  /** The base mesh it was made on: hm08 for every file MakeHuman ships. */
  readonly basemesh: string;
  /** The bound mesh, beside the binding file. */
  readonly objFile: string;
  readonly material: string | null;
  readonly tags: readonly string[];
  /** How far out from the skin the mesh sits, as a draw order: 50 for eyes and proxies, larger for outer garments. */
  readonly zDepth: number | null;
  /** Per axis of the base mesh (x, y, z). A binding without them scales no offset. */
  readonly scales: readonly [AxisScale, AxisScale, AxisScale] | null;
  /** Three base vertices a bound vertex. A vertex bound to one base vertex names it three times. */
  readonly refs: Uint32Array;
  readonly weights: Float32Array;
  /** x, y, z a bound vertex, in the base mesh's axes, before scaling. */
  readonly offsets: Float32Array;
  /** Base vertices hidden under the mesh, in increasing order. */
  readonly deleteVerts: Uint32Array;
  /** Every other keyword line, by keyword, in file order. */
  readonly other: ReadonlyMap<string, readonly string[]>;
}

export const boundCount = (b: Binding): number => b.weights.length / 3;

/** Section keywords. Any other keyword between bound vertices (a material line, say) leaves the section open. */
const SECTIONS = new Set(["verts", "delete_verts", "weights"]);
const AXES = ["x_scale", "y_scale", "z_scale"] as const;

export function parseBinding(text: string, path = "binding"): Binding {
  let name = "";
  let uuid = "";
  let basemesh = "";
  let objFile = "";
  let material: string | null = null;
  let zDepth: number | null = null;
  const tags: string[] = [];
  const scales: (AxisScale | null)[] = [null, null, null];
  const refs: number[] = [];
  const weights: number[] = [];
  const offsets: number[] = [];
  const deleted = new Set<number>();
  const other = new Map<string, string[]>();
  let section = "";
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim();
    if (line === "" || line[0] === "#") continue;
    const w = line.split(/\s+/);
    const key = w[0]!;
    const rest = line.slice(key.length).trim();
    const where = `${path}:${n + 1}`;
    if (/^[a-z_]/i.test(key)) {
      if (SECTIONS.has(key)) section = key;
      const axis = AXES.indexOf(key as (typeof AXES)[number]);
      if (axis >= 0) {
        if (w.length !== 4) throw new Error(`${where}: ${key} takes two vertices and a length`);
        scales[axis] = { a: Number(w[1]), b: Number(w[2]), length: Number(w[3]) };
      } else if (key === "name") name = rest;
      else if (key === "uuid") uuid = rest;
      else if (key === "basemesh") basemesh = rest;
      else if (key === "obj_file") objFile = rest;
      else if (key === "material") material = rest;
      else if (key === "tag") tags.push(rest);
      else if (key === "z_depth") zDepth = Number(rest);
      else {
        const list = other.get(key) ?? [];
        list.push(rest);
        other.set(key, list);
      }
      continue;
    }
    if (section === "verts") {
      if (w.length === 1) {
        const v = Number(w[0]);
        refs.push(v, v, v);
        weights.push(1, 0, 0);
        offsets.push(0, 0, 0);
      } else if (w.length === 9) {
        refs.push(Number(w[0]), Number(w[1]), Number(w[2]));
        weights.push(Number(w[3]), Number(w[4]), Number(w[5]));
        offsets.push(Number(w[6]), Number(w[7]), Number(w[8]));
      } else throw new Error(`${where}: a bound vertex is 1 or 9 numbers, not ${w.length}`);
    } else if (section === "delete_verts") {
      for (let i = 0; i < w.length; i++) {
        if (w[i] === "-") continue;
        const v = Number(w[i]);
        if (w[i + 1] === "-") {
          const to = Number(w[i + 2]);
          for (let k = v; k <= to; k++) deleted.add(k);
          i += 2;
        } else deleted.add(v);
      }
    } else if (section !== "weights") throw new Error(`${where}: numbers outside a section`);
  }
  for (let i = 0; i < refs.length; i++) if (!Number.isInteger(refs[i]) || refs[i]! < 0) throw new Error(`${path}: bound vertex ${Math.floor(i / 3)} names base vertex ${refs[i]}`);
  const have = scales.filter((s) => s !== null).length;
  if (have !== 0 && have !== 3) throw new Error(`${path}: a binding gives all three axis scales or none`);
  return {
    name,
    uuid,
    basemesh,
    objFile,
    material,
    tags,
    zDepth,
    scales: have === 3 ? (scales as [AxisScale, AxisScale, AxisScale]) : null,
    refs: new Uint32Array(refs),
    weights: new Float32Array(weights),
    offsets: new Float32Array(offsets),
    deleteVerts: new Uint32Array([...deleted].sort((a, b) => a - b)),
    other,
  };
}

export function readBinding(path: string): Binding {
  return parseBinding(readFileSync(path, "utf8"), path);
}

/** How much the body has grown along each axis since the binding was made, from its scale vertices on `base`. */
export function axisGrowth(b: Binding, base: Float32Array): [number, number, number] {
  if (!b.scales) return [1, 1, 1];
  const g = (axis: number): number => {
    const s = b.scales![axis]!;
    return Math.abs(base[s.a * 3 + axis]! - base[s.b * 3 + axis]!) / s.length;
  };
  return [g(0), g(1), g(2)];
}

/** The bound mesh's vertices (x, y, z each) placed on `base`, the base mesh's vertices in any shape. */
export function fit(b: Binding, base: Float32Array): Float32Array {
  const n = boundCount(b);
  const out = new Float32Array(n * 3);
  const [gx, gy, gz] = axisGrowth(b, base);
  const { refs, weights, offsets } = b;
  for (let i = 0; i < n; i++) {
    const r0 = refs[i * 3]! * 3;
    const r1 = refs[i * 3 + 1]! * 3;
    const r2 = refs[i * 3 + 2]! * 3;
    if (r0 + 2 >= base.length || r1 + 2 >= base.length || r2 + 2 >= base.length) throw new Error(`${b.name}: bound vertex ${i} names a vertex past the base`);
    const w0 = weights[i * 3]!;
    const w1 = weights[i * 3 + 1]!;
    const w2 = weights[i * 3 + 2]!;
    for (let k = 0; k < 3; k++) {
      const grow = k === 0 ? gx : k === 1 ? gy : gz;
      out[i * 3 + k] = w0 * base[r0 + k]! + w1 * base[r1 + k]! + w2 * base[r2 + k]! + offsets[i * 3 + k]! * grow;
    }
  }
  return out;
}
