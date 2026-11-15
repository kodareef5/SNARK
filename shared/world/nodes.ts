// Node positions are a pure function of the map, the same on the server and every client, never saved and never sent. The only
// state is which nodes are used up. Chunks near a body are loaded into a StructureStore, so collision and drawing reuse that code.
// What the store holds for a node is its form: one variant of its kind at one size, or what is left of it once used up. Each
// form has its own boxes, already sized, so bodies, rays and paths meet a node as it is drawn.

import { shapeHalf, type ShapeBox } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, type MapDims } from "../coords.ts";
import type { Heightfield } from "./heightfield.ts";
import { StructureStore, type PartTable } from "./structures.ts";

/** A kind with a range of sizes grows at this many, evenly from its least to its most. */
export const SIZE_STEPS = 16;
/** A size is a whole number of these. A drawn node carries the number in its last colour region. */
export const SIZE_UNITS = 64;

export interface NodeSpot {
  /** Content index, or 0 if the slot is empty on this map. */
  kind: number;
  /** What it grows as (NodeForms). */
  form: number;
  /** Its origin: the ground under it. */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** `at` must be a pure function of its arguments. */
export interface NodeSource {
  /** Slots per chunk, at most 256. */
  readonly perChunk: number;
  at(chunk: number, index: number, out: NodeSpot): void;
}

/** Every form a node may take under one registry. Form 0 is none. */
export interface NodeForms {
  readonly count: number;
  /** Per form: its kind's content index, its variant's place in the kind's list, its size in SIZE_UNITS, and 1 if it is used up. */
  readonly kind: Uint16Array;
  readonly variant: Uint8Array;
  readonly size: Uint8Array;
  readonly depleted: Uint8Array;
  /**
   * Per form, the largest size of its kind, in SIZE_UNITS. A mesh's level and textures are chosen for every node of it as if it
   * were this size: from its distance divided by this many SIZE_UNITS.
   */
  readonly most: Uint8Array;
  /** Per form that grows, what is left of it once used up, or 0 if nothing is. */
  readonly left: Uint16Array;
  /** Per form, its mesh id, or "" for its kind's own. */
  readonly mesh: readonly string[];
  /** Per form, as a StructureStore of forms takes them. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  readonly soft: Uint8Array;
  readonly parts: PartTable;
  /** Per content index: its first form and its number of sizes. A kind's forms that grow run variant by variant, size by size. */
  readonly first: Uint32Array;
  readonly steps: Uint8Array;
  /** Per content index of a node, the running sums of its variants' weights. */
  readonly sums: readonly (Uint16Array | null)[];
}

export function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The form a node of `kind` grows as, from 32 bits hashed from its place: its variant by weight from the low half, its size from the high. */
export function formOf(forms: NodeForms, kind: number, v: number): number {
  const sums = forms.sums[kind]!;
  const steps = forms.steps[kind]!;
  const r = (v & 0xffff) % sums[sums.length - 1]!;
  let variant = 0;
  while (sums[variant]! <= r) variant++;
  return forms.first[kind]! + variant * steps + ((v >>> 16) % steps);
}

/** Size step `step` of `steps` from `lo` to `hi`, in SIZE_UNITS. */
function sizeAt(lo: number, hi: number, step: number, steps: number): number {
  const at = steps === 1 ? lo : lo + ((hi - lo) * step) / (steps - 1);
  return Math.min(255, Math.max(1, Math.round(at * SIZE_UNITS)));
}

function buildForms(reg: Registry): NodeForms {
  const n = reg.defs.length;
  const first = new Uint32Array(n);
  const steps = new Uint8Array(n);
  const sums: (Uint16Array | null)[] = new Array(n).fill(null);
  const kind = [0];
  const variant = [0];
  const size = [0];
  const depleted = [0];
  const most = [0];
  const left = [0];
  const mesh = [""];
  const soft = [0];
  const boxes: ShapeBox[][] = [[]];
  const add = (k: number, v: number, s: number, largest: number, gone: boolean, id: string, of: readonly ShapeBox[], isSoft: boolean): number => {
    const scale = s / SIZE_UNITS;
    kind.push(k);
    variant.push(v);
    size.push(s);
    depleted.push(gone ? 1 : 0);
    most.push(largest);
    left.push(0);
    mesh.push(id);
    soft.push(isSoft ? 1 : 0);
    boxes.push(of.map((b) => ({ at: [b.at[0] * scale, b.at[1] * scale, b.at[2] * scale], half: [b.half[0] * scale, b.half[1] * scale, b.half[2] * scale] })));
    return kind.length - 1;
  };
  for (let k = 1; k < n; k++) {
    const d = reg.defs[k];
    if (d?.type !== "node") continue;
    const variants = d.variants ?? [{ mesh: "" }];
    const [lo, hi] = d.size ?? [1, 1];
    const s = lo === hi ? 1 : SIZE_STEPS;
    const own: ShapeBox[] = [{ at: [0, d.half[1], 0], half: d.half }];
    const largest = sizeAt(lo, hi, s - 1, s);
    first[k] = kind.length;
    steps[k] = s;
    let sum = 0;
    sums[k] = Uint16Array.from(variants, (v) => (sum += v.weight ?? 1));
    for (let v = 0; v < variants.length; v++) {
      for (let step = 0; step < s; step++) add(k, v, sizeAt(lo, hi, step, s), largest, false, variants[v]!.mesh, variants[v]!.boxes ?? own, d.soft === true);
    }
    for (let v = 0; v < variants.length; v++) {
      const gone = variants[v]!.depleted ?? d.depleted;
      if (!gone) continue;
      for (let step = 0; step < s; step++) left[first[k]! + v * s + step] = add(k, v, sizeAt(lo, hi, step, s), largest, true, gone.mesh, gone.boxes ?? [], d.soft === true);
    }
  }
  const count = kind.length;
  // A structure store keeps a form in 16 bits.
  if (count > 65535) throw new Error(`nodes: the content's node kinds take ${count} forms, and a store holds 65,535`);
  const start = new Uint32Array(count + 1);
  for (let f = 0; f < count; f++) start[f + 1] = start[f]! + boxes[f]!.length;
  const box = new Float32Array(start[count]! * 6);
  const halfX = new Float32Array(count);
  const halfY = new Float32Array(count);
  const halfZ = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    boxes[f]!.forEach((b, i) => box.set([...b.at, ...b.half], (start[f]! + i) * 6));
    [halfX[f], halfY[f], halfZ[f]] = shapeHalf(boxes[f]!);
  }
  return {
    count,
    kind: Uint16Array.from(kind),
    variant: Uint8Array.from(variant),
    size: Uint8Array.from(size),
    depleted: Uint8Array.from(depleted),
    most: Uint8Array.from(most),
    left: Uint16Array.from(left),
    mesh,
    halfX,
    halfY,
    halfZ,
    soft: Uint8Array.from(soft),
    parts: { start, box },
    first,
    steps,
    sums,
  };
}

const built = new WeakMap<Registry, NodeForms>();

/** The forms of a registry's nodes. The same registry always gives the same object. */
export function nodeForms(reg: Registry): NodeForms {
  let forms = built.get(reg);
  if (!forms) built.set(reg, (forms = buildForms(reg)));
  return forms;
}

/**
 * Scatters nodes by a hash. `kindsAt` gives the content indices that may grow at a place, repeated for weight, with 0 for
 * bare ground, or null where nothing grows. A slot is also empty where the ground is lower than 0.3 m above sea level or too
 * steep. A node's kind and turn come from one hash of its slot, as they always have, and its variant and size from a third.
 */
export function scatterNodes(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, forms: NodeForms, kindsAt: (x: number, z: number) => readonly number[] | null): NodeSource {
  return {
    perChunk,
    at(chunk, index, out) {
      out.kind = 0;
      const h = mix(seed, chunk, index);
      const g = mix(h, index, chunk);
      const x = (chunkCx(dims, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
      const z = (chunkCz(dims, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
      const kinds = kindsAt(x, z);
      if (kinds === null || kinds.length === 0) return;
      const y = hf.heightAt(x, z);
      if (y < hf.seaLevel + 0.3 || hf.slopeCosAt(x, z) < 0.85) return;
      const kind = kinds[g % kinds.length]!;
      if (kind === 0) return;
      out.kind = kind;
      out.form = formOf(forms, kind, mix(g, chunk, seed));
      out.x = x;
      out.y = y;
      out.z = z;
      out.yaw = (g >>> 8) & 0xffff;
    },
  };
}

/** chunk * 65536 + slot, as for structures. */
export function nodeRef(chunk: number, index: number): number {
  return chunk * 65536 + index;
}

export class NodeField {
  readonly store: StructureStore;
  readonly source: NodeSource;
  readonly forms: NodeForms;
  /** Per chunk, the number of bodies or viewers keeping it filled. */
  private readonly refs: Uint16Array;
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private readonly dims: MapDims;
  /** Each kind's starting hit count. */
  private readonly hits: Float32Array;

  constructor(dims: MapDims, reg: Registry, source: NodeSource) {
    this.dims = dims;
    this.source = source;
    this.hits = reg.nodeHits;
    const f = (this.forms = nodeForms(reg));
    this.store = new StructureStore(dims, f.halfX, f.halfY, f.halfZ, f.soft, f.parts);
    this.refs = new Uint16Array(chunkCount(dims));
  }

  isLoaded(chunk: number): boolean {
    return this.refs[chunk]! > 0;
  }

  /**
   * Retains (delta +1) or releases (delta -1) the square of chunks within `radius` of `center`. A chunk fills when its count leaves
   * zero, with every node of the map: those `gone` reports as what is left of them, the rest at the hit count `left` gives or else
   * the kind's full count.
   */
  retain(center: number, radius: number, delta: number, gone: (chunk: number, index: number) => boolean, left?: (chunk: number, index: number) => number): void {
    const dims = this.dims;
    const cx = chunkCx(dims, center);
    const cz = chunkCz(dims, center);
    for (let z = Math.max(0, cz - radius); z <= Math.min(dims.chunksZ - 1, cz + radius); z++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(dims.chunksX - 1, cx + radius); x++) {
        const chunk = z * dims.chunksX + x;
        const before = this.refs[chunk]!;
        this.refs[chunk] = before + delta;
        if (before === 0 && delta > 0) this.fill(chunk, gone, left);
        else if (before === 1 && delta < 0) this.store.dropChunk(chunk);
      }
    }
  }

  private fill(chunk: number, gone: (chunk: number, index: number) => boolean, left?: (chunk: number, index: number) => number): void {
    const spot = this.spot;
    for (let i = 0; i < this.source.perChunk; i++) {
      this.source.at(chunk, i, spot);
      if (spot.kind === 0) continue;
      if (gone(chunk, i)) {
        const rest = this.forms.left[spot.form]!;
        if (rest !== 0) this.store.put(chunk, i, rest, spot.x, spot.y, spot.z, spot.yaw, 0, 0, 1);
        continue;
      }
      const hp = left ? left(chunk, i) : -1;
      this.store.put(chunk, i, spot.form, spot.x, spot.y, spot.z, spot.yaw, 0, hp >= 0 ? hp : this.hits[spot.kind]!, 1);
    }
  }

  /** `present` false marks the node used up, true grown back. Does nothing if its chunk is not filled. */
  set(chunk: number, index: number, present: boolean): void {
    if (!this.isLoaded(chunk)) return;
    const spot = this.spot;
    this.source.at(chunk, index, spot);
    const form = spot.kind === 0 ? 0 : present ? spot.form : this.forms.left[spot.form]!;
    if (form === 0) this.store.put(chunk, index, 0, 0, 0, 0, 0, 0, 0, 1);
    else this.store.put(chunk, index, form, spot.x, spot.y, spot.z, spot.yaw, 0, present ? this.hits[spot.kind]! : 0, 1);
  }

  /** The content index the map defines for the slot, used up or not. */
  kindAt(chunk: number, index: number): number {
    this.source.at(chunk, index, this.spot);
    return this.spot.kind;
  }

  /** The content index of what the store holds in a slot that is standing and not used up, or 0. */
  standing(chunk: number, index: number): number {
    const form = this.store.chunks[chunk]?.kind[index] ?? 0;
    return form === 0 || this.forms.depleted[form] === 1 ? 0 : this.forms.kind[form]!;
  }
}
