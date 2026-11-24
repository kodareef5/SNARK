// What the near store knows of built pieces: which meshes are drawn as pieces and how each kind fits (piece-fit.ts), and
// a piece's damage stage, which reaches the card as the one byte of its instance that changed.

import type { Registry } from "../../../shared/content/registry.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import type { ChunkTable } from "../../../shared/world/structures.ts";
import { DRAW_PIECE, type BufferUpload } from "./packet.ts";
import { PIECE_MADE_BITS, PIECE_STAGE, PIECE_STATE_AT, fitOfForm, yields } from "./piece-fit.ts";
import { MADE_MARK } from "./world-surfaces.ts";

/** A piece's stage at health `hp` of `max`, by the cuts a map piece's has (shared/world/breaking.ts stageOf): whole, worn, cracked, failing. */
export function stageOfHealth(hp: number, max: number): number {
  return !(max > 0) || hp * 3 > max * 2 ? 0 : hp * 3 > max ? 1 : hp * 6 > max ? 2 : 3;
}

/** Per kind and per mesh, what drawing a built piece reads, made once. */
export class PieceLooks {
  /** Per mesh: DRAW_PIECE where a kind with a form is drawn with it, else 0. Every instance of such a mesh is laid out as a piece. */
  readonly flag: Uint32Array;
  /** Per kind: its fit byte's class and size; 1 where its ends or sides may yield; the recipe material it wears; its full health. */
  readonly fit: Uint8Array;
  readonly yields: Uint8Array;
  readonly made: Uint8Array;
  readonly maxHp: ArrayLike<number>;

  /** `regions` are the scene's five bytes a kind (scene.ts regionsOfKind), `missing` the mesh that stands for one no pack has. */
  constructor(reg: Registry, meshOfKind: Uint16Array, regions: Uint8Array, meshes: number, missing: number) {
    const n = reg.defs.length;
    this.flag = new Uint32Array(meshes);
    this.fit = new Uint8Array(n);
    this.yields = new Uint8Array(n);
    this.made = new Uint8Array(n);
    this.maxHp = reg.maxHp;
    for (let k = 1; k < n; k++) {
      // A piece says the material it wears where a static does (scene.ts): the mark, then the number.
      if (regions[k * 5 + 3] === MADE_MARK) this.made[k] = regions[k * 5 + 4]! & PIECE_MADE_BITS;
      const form = reg.forms?.def[k];
      const mesh = meshOfKind[k]!;
      if (!form || mesh === missing || mesh >= meshes) continue;
      this.flag[mesh] = DRAW_PIECE;
      this.fit[k] = fitOfForm(form);
      this.yields[k] = yields(form) ? 1 : 0;
    }
  }

  /** The stage the piece in `slot` of `t` is drawn at: an owned piece's by its health, any other's whole. */
  stage(t: ChunkTable, slot: number): number {
    return t.owner[slot] !== 0 ? stageOfHealth(t.hp[slot]!, this.maxHp[t.kind[slot]!]!) : 0;
  }
}

/** What of a chunk's batch a change of stage reads and writes (passes/near-store.ts ChunkBatch). */
export interface Staged {
  data: Uint8Array;
  slots: Uint16Array;
  /** Per slot of the table when it was built, its instance, or -1. */
  at: Int32Array;
  /** The table's version the stages were last read at. */
  seen: number;
  /** Instances whose state changed since the card was given the buffer. */
  dirty: number[];
  /** Per slot, the first of its trims in `trimAt`, and one past the last slot's: null where the chunk has no trims. */
  trimFirst: Uint32Array | null;
  trimAt: Uint32Array | null;
}

/**
 * Brings a batch's stages up to its table: each slot changed since they were last read has its instance's stage, and
 * its trims', set from its health. Only an instance whose stage differs is written, and marked for the card.
 */
export function followStages(b: Staged, t: ChunkTable, looks: PieceLooks, meshOf: Uint16Array): void {
  const seen = b.seen, mod = t.mod, at = b.at;
  b.seen = t.version;
  for (let s = 0, n = Math.min(t.high, at.length); s < n; s++) {
    if (mod[s]! <= seen || at[s]! < 0) continue;
    const kind = t.kind[s]!;
    if (kind === 0 || looks.flag[meshOf[kind]!] === 0) continue;
    const stage = looks.stage(t, s);
    stain(b, at[s]!, stage);
    if (b.trimFirst) for (let k = b.trimFirst[s]!; k < b.trimFirst[s + 1]!; k++) stain(b, b.trimAt![k]!, stage);
  }
}

function stain(b: Staged, i: number, stage: number): void {
  const o = i * INSTANCE_BYTES + PIECE_STATE_AT;
  if ((b.data[o]! & PIECE_STAGE) === stage) return;
  b.data[o] = (b.data[o]! & ~PIECE_STAGE) | stage;
  b.dirty.push(i);
}

/**
 * The uploads that give the card a batch's changed instances, each run of neighbours one: INSTANCE_BYTES for a piece
 * whose stage changed. Returns the bytes they hold. `dirty` is emptied.
 */
export function stageUploads(b: Staged, buffer: number, out: BufferUpload[]): number {
  const dirty = b.dirty.sort((x, y) => x - y);
  let bytes = 0;
  for (let k = 0; k < dirty.length; ) {
    let end = k + 1;
    while (end < dirty.length && dirty[end]! <= dirty[end - 1]! + 1) end++;
    const from = dirty[k]! * INSTANCE_BYTES, n = (dirty[end - 1]! + 1) * INSTANCE_BYTES - from;
    out.push({ buffer, data: b.data, slots: b.slots, from, bytes: n });
    bytes += n;
    k = end;
  }
  dirty.length = 0;
  return bytes;
}
