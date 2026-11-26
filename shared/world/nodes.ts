// Node positions are a pure function of the map, the same on the server and every client, never saved and never sent. The only
// state is which nodes are used up. Chunks near a body are loaded into a StructureStore, so collision and drawing reuse that code.
// What the store holds for a node is its form: one variant of its kind at one size, or what is left of it once used up. Each
// form has its own boxes, already sized, so bodies, rays and paths meet a node as it is drawn.

import { shapeHalf, type ShapeBox } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { CHUNK_SIZE, chunkCount, chunkCx, chunkCz, frameKey, type MapDims } from "../coords.ts";
import type { Heightfield } from "./heightfield.ts";
import { StructureStore, type PartTable } from "./structures.ts";
import { seaHere } from "./water.ts";

/** A kind with a range of sizes grows at this many, evenly from its least to its most. */
export const SIZE_STEPS = 16;
/** A size is a whole number of these. A drawn node carries the number in its last colour region. */
export const SIZE_UNITS = 64;
/** Where a kind grows against the sea (NodeDef.sea): on dry ground, only under the sea, or either. */
export const SEA_DRY = 0;
export const SEA_UNDER = 1;
export const SEA_EITHER = 2;

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
  /** Per content index: how far its footing reaches and the fall it allows, in metres (0 for none), and what grows instead. */
  readonly footReach: Float32Array;
  readonly footFall: Float32Array;
  readonly footElse: Uint16Array;
  /** Per content index: where it grows against the sea, SEA_DRY, SEA_UNDER or SEA_EITHER. */
  readonly sea: Uint8Array;
  /** Per content index: how near, in metres, two of its nodes in a chunk are kept from being one variant (NodeDef.apart), or 0. */
  readonly apart: Float32Array;
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
  const footReach = new Float32Array(n);
  const footFall = new Float32Array(n);
  const footElse = new Uint16Array(n);
  const sea = new Uint8Array(n);
  const apart = new Float32Array(n);
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
    sea[k] = d.sea === "under" ? SEA_UNDER : d.sea === "either" ? SEA_EITHER : SEA_DRY;
    apart[k] = d.apart ?? 0;
    if (d.footing) {
      footReach[k] = d.footing.reach;
      footFall[k] = d.footing.fall;
      footElse[k] = d.footing.else === undefined ? 0 : (reg.index.get(d.footing.else) ?? 0);
    }
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
    footReach,
    footFall,
    footElse,
    sea,
    apart,
  };
}

const built = new WeakMap<Registry, NodeForms>();

/** The forms of a registry's nodes. The same registry always gives the same object. */
export function nodeForms(reg: Registry): NodeForms {
  let forms = built.get(reg);
  if (!forms) built.set(reg, (forms = buildForms(reg)));
  return forms;
}

/** What grows at a place: content indices repeated for weight, with 0 for bare ground, or null where nothing grows. */
export type KindsAt = (x: number, z: number) => readonly number[] | null;

/** How many slots the rule of resolveSlots left empty, by why, and how many it stood as their footings' other kinds. */
export interface SlotsTaken {
  water: number;
  slope: number;
  footing: number;
  other: number;
}

/** A slot's place, from the first of its hashes, and its second, which draws its kind and turn and, with its chunk's key, its form. */
interface Drawn {
  x: number;
  z: number;
  /** Its place in 65536ths of a chunk from the map's corner. */
  ux: number;
  uz: number;
  g: number;
  key: number;
}

function draw(dims: MapDims, seed: number, chunk: number, index: number, d: Drawn): void {
  const key = frameKey(dims, chunk);
  const h = mix(seed, key, index);
  d.g = mix(h, index, key);
  d.key = key;
  d.ux = chunkCx(dims, chunk) * 65536 + (h & 0xffff);
  d.uz = chunkCz(dims, chunk) * 65536 + (h >>> 16);
  d.x = (chunkCx(dims, chunk) + (h & 0xffff) / 65536) * CHUNK_SIZE;
  d.z = (chunkCz(dims, chunk) + (h >>> 16) / 65536) * CHUNK_SIZE;
}

/** The kind a drawn slot's hash and `kindsAt` give it, 0 for none. */
function drawnKind(kindsAt: KindsAt, d: Drawn): number {
  const grows = kindsAt(d.x, d.z);
  return grows === null || grows.length === 0 ? 0 : grows[d.g % grows.length]!;
}

const isSet = (bits: Uint8Array, bit: number): boolean => ((bits[bit >> 3]! >> (bit & 7)) & 1) === 1;

/**
 * Whether the node each slot of a scattered layer draws stands on `hf`, and as what: the rule of where nodes stand, which a
 * map's build applies once and its file then says (shared/world/mapfile.ts). A slot draws its place from a hash of the seed,
 * its chunk's frame key and its index, and its kind from a second and `kindsAt` there. Its node does not stand where the
 * ground is steeper than about 32 degrees, or for a kind of dry ground lower than 0.3 m above the water, or for a kind of the
 * sea floor where the ground is not under the sea; and a kind with a footing grows only where the ground under it falls no
 * further than it allows, and elsewhere what it names, or nothing. Bit `chunk * perChunk + slot` of `out` is set where its
 * node does not stand, and of `other` where it stands as its footing's other kind; a slot that draws no node has neither.
 * Bits set in `taken` (slots a build took out) are kept and those slots not judged.
 */
export function resolveSlots(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, forms: NodeForms, kindsAt: KindsAt, taken?: Uint8Array, tally?: SlotsTaken): { out: Uint8Array; other: Uint8Array } {
  const bytes = Math.ceil((chunkCount(dims) * perChunk) / 8);
  const out = new Uint8Array(bytes);
  if (taken) out.set(taken);
  const other = new Uint8Array(bytes);
  // A footing is judged in the heightfield's own whole numbers, so every engine judges it alike: the height samples as far
  // out as it reaches, along the axes and the diagonals, against the sample nearest the origin, in steps of height.
  const count = forms.footReach.length;
  const ring = new Int32Array(count);
  const slant = new Int32Array(count);
  const fall = new Int32Array(count);
  for (let k = 0; k < count; k++) {
    if (!(forms.footReach[k]! > 0)) continue;
    ring[k] = Math.ceil(forms.footReach[k]! / hf.cell);
    // A diagonal sample as far out: ring / sqrt(2), rounded.
    slant[k] = Math.floor((ring[k]! * 181 + 128) / 256);
    fall[k] = Math.floor(forms.footFall[k]! / hf.stepY);
  }
  // A place is a whole number of 65536ths of a chunk, and samples are `per` of them apart.
  const per = (hf.cell * 65536) / CHUNK_SIZE;
  const all = hf.view(0, 0, hf.nx - 1, hf.nz - 1);
  const height = (i: number, j: number): number => all.heights[all.off + Math.min(hf.nz - 1, Math.max(0, j)) * all.stride + Math.min(hf.nx - 1, Math.max(0, i))]!;
  const fits = (kind: number, ux: number, uz: number): boolean => {
    const i = Math.floor((ux + per / 2) / per);
    const j = Math.floor((uz + per / 2) / per);
    const low = height(i, j) - fall[kind]!;
    const [r, d] = [ring[kind]!, slant[kind]!];
    return height(i + r, j) >= low && height(i - r, j) >= low && height(i, j + r) >= low && height(i, j - r) >= low && height(i + d, j + d) >= low && height(i + d, j - d) >= low && height(i - d, j + d) >= low && height(i - d, j - d) >= low;
  };
  const d: Drawn = { x: 0, z: 0, ux: 0, uz: 0, g: 0, key: 0 };
  for (let chunk = 0, bit = 0; chunk < chunkCount(dims); chunk++) {
    for (let index = 0; index < perChunk; index++, bit++) {
      if (isSet(out, bit)) continue;
      draw(dims, seed, chunk, index, d);
      const kind = drawnKind(kindsAt, d);
      if (kind === 0) continue;
      const y = hf.heightAt(d.x, d.z);
      // A kind of the sea floor grows only under the sea, not a lake; one of either anywhere; and every other only on dry
      // ground, out of the sea and every lake.
      const sea = forms.sea[kind]!;
      const wet = sea === SEA_DRY ? y < hf.waterAt(d.x, d.z) + 0.3 : sea === SEA_UNDER && (y >= hf.seaLevel || !seaHere(hf.water, d.x, d.z));
      const steep = !wet && hf.slopeCosAt(d.x, d.z) < 0.85;
      const footless = !wet && !steep && ring[kind]! > 0 && !fits(kind, d.ux, d.uz);
      if (wet || steep || (footless && forms.footElse[kind] === 0)) out[bit >> 3]! |= 1 << (bit & 7);
      else if (footless) other[bit >> 3]! |= 1 << (bit & 7);
      if (!tally) continue;
      if (wet) tally.water++;
      else if (steep) tally.slope++;
      else if (footless && forms.footElse[kind] === 0) tally.footing++;
      else if (footless) tally.other++;
    }
  }
  return { out, other };
}

/**
 * Nodes scattered by a hash as resolveSlots draws them, standing where `out` and `other` say: none where `out` is set, its
 * footing's other kind where `other` is, else the kind drawn. Its variant and size come from a third hash, so a node stands
 * where it did when its map is widened. Only a node's height reads `hf`.
 *
 * A kind that keeps apart (NodeDef.apart) is the exception: slot by slot through its chunk, a node whose variant a nearer
 * one of its kind in the chunk already is takes the next variant along that none of them is, at its own size. So two
 * heaps side by side are two different heaps, but for two in neighbouring chunks.
 */
export function placedNodes(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, forms: NodeForms, kindsAt: KindsAt, slots: SlotsOf): NodeSource {
  const d: Drawn = { x: 0, z: 0, ux: 0, uz: 0, g: 0, key: 0 };
  const bits: SlotBits = { out: NO_BITS, other: NO_BITS, at: 0 };
  /** The kind a slot grows as, 0 for none, with `d` drawn for it. */
  const kindOf = (chunk: number, index: number): number => {
    if (!slots(chunk, bits)) return 0;
    const bit = bits.at + index;
    if (isSet(bits.out, bit)) return 0;
    draw(dims, seed, chunk, index, d);
    const kind = drawnKind(kindsAt, d);
    return kind !== 0 && isSet(bits.other, bit) ? forms.footElse[kind]! : kind;
  };
  // The forms of the last chunk asked for whose slots keep apart, worked out together.
  let held = -1;
  const kept = new Uint16Array(perChunk);
  const kinds = new Uint16Array(perChunk);
  const xs = new Float64Array(perChunk);
  const zs = new Float64Array(perChunk);
  const taken = new Uint8Array(256);
  const apartIn = (chunk: number): Uint16Array => {
    if (held === chunk) return kept;
    held = chunk;
    for (let i = 0; i < perChunk; i++) {
      const kind = (kinds[i] = kindOf(chunk, i));
      xs[i] = d.x;
      zs[i] = d.z;
      kept[i] = 0;
      if (kind === 0 || !(forms.apart[kind]! > 0)) continue;
      const own = formOf(forms, kind, mix(d.g, d.key, seed));
      const first = forms.first[kind]!, steps = forms.steps[kind]!, count = forms.sums[kind]!.length, reach = forms.apart[kind]! * forms.apart[kind]!;
      taken.fill(0, 0, count);
      for (let j = 0; j < i; j++) {
        if (kinds[j] !== kind) continue;
        const dx = xs[j]! - xs[i]!, dz = zs[j]! - zs[i]!;
        if (dx * dx + dz * dz < reach) taken[forms.variant[kept[j]!]!] = 1;
      }
      let variant = forms.variant[own]!;
      for (let k = 0; k < count && taken[variant] === 1; k++) variant = (variant + 1) % count;
      kept[i] = first + variant * steps + ((own - first) % steps);
    }
    return kept;
  };
  return {
    perChunk,
    at(chunk, index, spot) {
      spot.kind = 0;
      const kind = kindOf(chunk, index);
      if (kind === 0) return;
      const x = d.x, z = d.z, yaw = (d.g >>> 8) & 0xffff;
      spot.kind = kind;
      spot.form = forms.apart[kind]! > 0 ? apartIn(chunk)[index]! : formOf(forms, kind, mix(d.g, d.key, seed));
      spot.x = x;
      spot.y = hf.heightAt(x, z);
      spot.z = z;
      spot.yaw = yaw;
    },
  };
}

/** Nodes scattered by a hash on `hf`, whether each stands decided once as the source is made (resolveSlots, placedNodes). */
export function scatterNodes(dims: MapDims, hf: Heightfield, seed: number, perChunk: number, forms: NodeForms, kindsAt: KindsAt): NodeSource {
  const { out, other } = resolveSlots(dims, hf, seed, perChunk, forms, kindsAt);
  return placedNodes(dims, hf, seed, perChunk, forms, kindsAt, denseSlots(out, other, perChunk));
}

/** Where a chunk's slots' bits are: bit `at + index` of `out` and `other` is its slot `index`'s. */
export interface SlotBits {
  out: Uint8Array;
  other: Uint8Array;
  at: number;
}

/** Sets `into` to where chunk `chunk`'s slots' bits are and gives true; false where none is held, and no slot stands. */
export type SlotsOf = (chunk: number, into: SlotBits) => boolean;

const NO_BITS = new Uint8Array(0);

/** Every chunk's slots' bits in one pair of arrays, `perChunk` a chunk, as resolveSlots gives them. */
export function denseSlots(out: Uint8Array, other: Uint8Array, perChunk: number): SlotsOf {
  return (chunk, into) => {
    into.out = out;
    into.other = other;
    into.at = chunk * perChunk;
    return true;
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
  private hits: Float32Array;

  /** Takes the starting hit counts from content a server's settings have changed. Nodes already loaded keep what they have left. */
  retable(reg: Registry): void {
    this.hits = reg.nodeHits;
  }

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
   * the kind's full count. A source override must return the same immutable map spots; vehicles use it to memoize cold fills.
   */
  retain(center: number, radius: number, delta: number, gone: (chunk: number, index: number) => boolean, left?: (chunk: number, index: number) => number, crushed?: (chunk: number, index: number) => boolean, source = this.source): void {
    const dims = this.dims;
    const cx = chunkCx(dims, center);
    const cz = chunkCz(dims, center);
    for (let z = Math.max(0, cz - radius); z <= Math.min(dims.chunksZ - 1, cz + radius); z++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(dims.chunksX - 1, cx + radius); x++) {
        const chunk = z * dims.chunksX + x;
        const before = this.refs[chunk]!;
        this.refs[chunk] = before + delta;
        if (before === 0 && delta > 0) this.fill(chunk, gone, left, crushed, source);
        else if (before === 1 && delta < 0) this.store.dropChunk(chunk);
      }
    }
  }

  private fill(chunk: number, gone: (chunk: number, index: number) => boolean, left: ((chunk: number, index: number) => number) | undefined, crushed: ((chunk: number, index: number) => boolean) | undefined, source: NodeSource): void {
    const spot = this.spot;
    for (let i = 0; i < source.perChunk; i++) {
      source.at(chunk, i, spot);
      if (spot.kind === 0) continue;
      if (gone(chunk, i)) {
        if (crushed?.(chunk, i)) continue;
        const rest = this.forms.left[spot.form]!;
        if (rest !== 0) this.store.put(chunk, i, rest, spot.x, spot.y, spot.z, spot.yaw, 0, 0, 1);
        continue;
      }
      const hp = left ? left(chunk, i) : -1;
      this.store.put(chunk, i, spot.form, spot.x, spot.y, spot.z, spot.yaw, 0, hp >= 0 ? hp : this.hits[spot.kind]!, 1);
    }
  }

  /** `present` false marks the node used up, true grown back. Does nothing if its chunk is not filled. */
  set(chunk: number, index: number, present: boolean, crushed = false): void {
    if (!this.isLoaded(chunk)) return;
    const spot = this.spot;
    this.source.at(chunk, index, spot);
    const form = spot.kind === 0 || !present && crushed ? 0 : present ? spot.form : this.forms.left[spot.form]!;
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
