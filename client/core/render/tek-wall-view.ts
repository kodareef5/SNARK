// Only shape changes and the short interval in which a wall is dissolving change its draw state.
import { isTekWall, tekWallKinds, tekWallNeighbours, type TekWallKinds } from "../../../shared/world/lattice/tek-walls.ts";
import { TICK_RATE, chunkAt, chunkCx, chunkCz } from "../../../shared/coords.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { INSTANCE_BYTES } from "../../../shared/pack/pack.ts";
import type { Staged } from "./piece-state.ts";

export const TEK_PHASE_MS = 690;
export const TEK_WALL_INSTANCE = 128;
interface WallCell {
  kind: number; frame: number; key: number; key1: number; mask: number; amount: number; stamp?: number;
}
interface Moving { row: WallCell; from: number; to: number; start: number }

function progress(effect: Moving, now: number): number {
  const travel = Math.max(0, now - effect.start) * 255 / TEK_PHASE_MS;
  return Math.round(effect.to > effect.from ? Math.min(effect.to, effect.from + travel) : Math.max(effect.to, effect.from - travel));
}

export class TekWallView {
  readonly kinds: TekWallKinds;
  readonly cells = new Map<number, Map<number, WallCell>>();
  readonly layouts = new Set<number>();
  readonly exposing = new Set<number>();
  private readonly pending = new Set<number>();
  private readonly moving = new Map<number, Moving>();
  private readonly updated = new Map<number, number[]>();
  private readonly neighbours = new Int32Array(4);
  private readonly variants = new Int32Array(16).fill(-1);
  private readonly changed = new Set<number>();
  private readonly triggers: number[] = [];
  private readonly store: StructureStore;
  constructor(store: StructureStore, index: ReadonlyMap<string, number>, mesh: (id: string) => number) {
    this.store = store;
    this.kinds = tekWallKinds(index);
    for (let i = 1; i < 16; i++) this.variants[i] = mesh(`core:wall_join_${i}_tek`);
    if (this.kinds.solid || this.kinds.door) {
      for (const c of store.held) this.pending.add(c);
      store.onShape.push((c, kind) => {
        if (kind === undefined || isTekWall(this.kinds, kind)) this.pending.add(c);
      });
      const previous = store.onOwned;
      store.onOwned = (kind, x, z, owner, by) => {
        previous?.(kind, x, z, owner, by);
        if (isTekWall(this.kinds, kind)) this.pending.add(chunkAt(store.dims, x, z));
      };
    }
  }

  markMeshes(flags: Uint32Array, flag: number): void {
    for (const mesh of this.variants) if (mesh >= 0 && mesh < flags.length) flags[mesh] = flag;
  }

  private around(chunk: number): void {
    const { dims } = this.store, cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
    for (let z = Math.max(0, cz - 1); z <= Math.min(dims.chunksZ - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(dims.chunksX - 1, cx + 1); x++) this.changed.add(z * dims.chunksX + x);
    }
  }

  private scan(chunk: number, tick?: number): void {
    const t = this.store.chunks[chunk], old = this.cells.get(chunk);
    if (!t && !old) return;
    const rows = new Map<number, WallCell>();
    for (let s = 0; t && s < t.high; s++) {
      const kind = t.kind[s]!;
      if (!isTekWall(this.kinds, kind)) continue;
      const frame = t.fr?.[s] ?? 0, key = t.k0?.[s] ?? 0, key1 = t.k1?.[s] ?? 0, before = old?.get(s), ref = chunk * 65536 + s;
      if (before && before.frame === frame && before.key === key && before.key1 === key1) {
        if (kind !== before.kind) {
          const open = kind === this.kinds.open, wasOpen = before.kind === this.kinds.open;
          if (open !== wasOpen) this.triggers.push(ref);
          before.kind = kind;
          this.layouts.add(chunk);
        }
        rows.set(s, before);
      } else {
        this.moving.delete(ref);
        let amount = kind === this.kinds.open ? 255 : 0;
        const stamp = t.phaseTick?.get(s);
        if (tick !== undefined && stamp !== undefined && (tick - stamp) * 1000 / TICK_RATE < TEK_PHASE_MS) {
          amount = 255 - amount;
          this.triggers.push(ref);
        }
        rows.set(s, { kind, frame, key, key1, mask: 0, amount, stamp });
        this.layouts.add(chunk);
      }
    }
    if (old) for (const s of old.keys()) if (!rows.has(s)) { this.moving.delete(chunk * 65536 + s); this.layouts.add(chunk); }
    if (rows.size) this.cells.set(chunk, rows); else this.cells.delete(chunk);
    if (old || rows.size) this.around(chunk);
  }

  /** A server changes every connected bay together. The first replicated row starts all visible members on one clock. */
  private startGroups(now: number, tick?: number): void {
    if (!this.triggers.length) return;
    const seen = new Set<number>();
    const stampOf = (ref: number) => this.store.chunks[ref >>> 16]?.phaseTick?.get(ref & 65535);
    if (this.triggers.length > 1) this.triggers.sort((a, b) => (stampOf(b) ?? 0) - (stampOf(a) ?? 0));
    for (const ref of this.triggers) {
      if (seen.has(ref)) continue;
      const first = this.cells.get(ref >>> 16)?.get(ref & 65535);
      if (!first) continue;
      const to = first.kind === this.kinds.open ? 255 : 0, stack = [ref];
      const stamp = stampOf(ref);
      const start = stamp !== undefined && tick !== undefined ? now - Math.max(0, tick - stamp) * 1000 / TICK_RATE : now;
      while (stack.length) {
        const next = stack.pop()!;
        if (seen.has(next)) continue;
        seen.add(next);
        const row = this.cells.get(next >>> 16)?.get(next & 65535);
        if (!row || (stamp !== undefined && row.stamp !== undefined && stamp < row.stamp)) continue;
        row.stamp = stamp;
        const prior = this.moving.get(next);
        if (prior?.to !== to) {
          const from = prior ? progress(prior, start) : row.amount;
          if (from !== to || row.amount !== to) this.moving.set(next, { row, from, to, start });
          else this.moving.delete(next);
          if (row.amount === 255) { this.layouts.add(next >>> 16); this.around(next >>> 16); }
        }
        if (!isTekWall(this.kinds, row.kind, true)) continue;
        tekWallNeighbours(this.store, this.kinds, next, this.neighbours, true);
        for (const other of this.neighbours) if (other >= 0 && !seen.has(other)) stack.push(other);
      }
    }
    this.triggers.length = 0;
  }

  update(now: number, tick?: number): void {
    this.updated.clear(); this.changed.clear(); this.exposing.clear();
    for (const chunk of this.pending) {
      this.scan(chunk, tick);
      if (!this.store.chunks[chunk]) this.layouts.delete(chunk);
    }
    this.startGroups(now, tick);
    this.pending.clear();
    for (const ref of this.moving.keys()) {
      const effect = this.moving.get(ref)!, { row, to } = effect, chunk = ref >>> 16;
      const before = row.amount;
      row.amount = progress(effect, now);
      if (before !== row.amount) {
        let list = this.updated.get(chunk);
        if (!list) this.updated.set(chunk, list = []);
        list.push(ref & 65535);
      }
      if (row.amount === to) {
        this.moving.delete(ref);
        this.layouts.add(chunk);
        if (to === 255) this.around(chunk);
      } else this.exposing.add(chunk);
    }
    for (const chunk of this.changed) {
      const cells = this.cells.get(chunk);
      if (!cells) continue;
      for (const slot of cells.keys()) {
        const row = cells.get(slot)!;
        const ref = chunk * 65536 + slot;
        let mask = tekWallNeighbours(this.store, this.kinds, ref, this.neighbours);
        for (let i = 0; i < 4; i++) {
          const other = this.neighbours[i]!;
          if (other >= 0 && this.cells.get(other >>> 16)?.get(other & 65535)?.amount === 255 && !this.moving.has(other)) mask &= ~(1 << i);
        }
        if (row.mask !== mask) { row.mask = mask; this.layouts.add(chunk); }
      }
    }
  }

  mesh(chunk: number, slot: number, base: number): number {
    const row = this.cells.get(chunk)?.get(slot);
    if (!row) return base;
    if (row.amount === 255 && !this.moving.has(chunk * 65536 + slot)) return 0xffff;
    const variant = this.variants[row.mask]!;
    return variant >= 0 ? variant : base;
  }

  write(data: Uint8Array, instance: number, chunk: number, slot: number, trim = false): void {
    const row = this.cells.get(chunk)?.get(slot);
    if (!row) return;
    if (row.kind === this.kinds.solid && (trim || row.mask === 0) && row.amount === 0 && !this.moving.has(chunk * 65536 + slot)) {
      const at = instance * INSTANCE_BYTES;
      if (data[at + 17]! & TEK_WALL_INSTANCE) {
        data[at + 17]! &= ~TEK_WALL_INSTANCE;
        data[at + 15] = data[at + 16] = 0;
      }
      return;
    }
    const at = instance * INSTANCE_BYTES;
    data[at + 17]! |= TEK_WALL_INSTANCE;
    if (!trim) data[at + 19]! &= ~(row.mask & 3);
    data[at + 15] = trim ? 0 : row.mask;
    data[at + 16] = row.amount;
  }

  follow(batch: Staged, chunk: number): void {
    for (const slot of this.updated.get(chunk) ?? []) {
      const i = batch.at[slot] ?? -1;
      if (i < 0) continue;
      this.write(batch.data, i, chunk, slot); batch.dirty.push(i);
      if (batch.trimFirst) for (let j = batch.trimFirst[slot]!; j < batch.trimFirst[slot + 1]!; j++) {
        const trim = batch.trimAt![j]!;
        this.write(batch.data, trim, chunk, slot, true); batch.dirty.push(trim);
      }
    }
  }
}
