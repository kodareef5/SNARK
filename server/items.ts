// The only code that edits inventories, and the ledger that proves nothing was
// duplicated or lost.
//
// Items come into the world only through `mint` and leave it only through
// `burn` (and spoilage, which is a burn). Everything else moves them between
// slots. So for every item:  sum of all stacks = minted - burned.  The two
// totals are saved in the same commit as the records they describe, and the
// equation is checked when a world loads and in tests.
//
// Every edit here happens inside one tick and marks each record it touched, so
// both sides of a move land in the same commit. That, and never re-reading a
// record from disk while it is live, is why a crash cannot duplicate an item.

import type { ItemDef, SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { Inventory, moveSlot, type ItemTable } from "../shared/sim/items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** Slots given to a record whose species declares none (a cache, a test fixture). */
const DEFAULT_SLOTS = 40;

export class Items {
  readonly table: ItemTable;
  readonly minted: Float64Array;
  readonly burned: Float64Array;
  /** The ledger changed since it was last saved. */
  dirty = false;
  private readonly reg: Registry;
  private readonly records: Records;
  private readonly world: ServerWorld;
  private readonly spoiled = (item: number, n: number): void => {
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
  };

  constructor(world: ServerWorld, records: Records) {
    this.world = world;
    this.reg = world.reg;
    this.records = records;
    this.table = world.reg;
    this.minted = new Float64Array(world.reg.defs.length);
    this.burned = new Float64Array(world.reg.defs.length);
  }

  /** The record's inventory, brought up to date with spoilage. Created on first use. */
  inv(rec: EntityRecord): Inventory {
    let inv = rec.inv;
    if (!inv) {
      const def = this.reg.defs[rec.kind];
      inv = rec.inv = new Inventory((def?.type === "species" ? (def as SpeciesDef).slots : undefined) ?? DEFAULT_SLOTS);
    }
    const before = inv.version;
    inv.settle(this.world.tick, this.table, this.spoiled);
    if (inv.version !== before) this.records.dirty.add(rec.pid);
    return inv;
  }

  isItem(kind: number): boolean {
    return this.table.stack[kind]! > 0;
  }

  /** Create `n` of an item in a record's inventory. Returns how many fit, which is how many were created. */
  mint(rec: EntityRecord, item: number, n: number, quality = 0, dur = 0): number {
    if (!this.isItem(item) || !(n > 0) || !Number.isInteger(n)) return 0;
    // A tool is made with all its uses.
    if (dur === 0) dur = (this.reg.defs[item] as ItemDef).tool?.uses ?? 0;
    const made = n - this.inv(rec).add(item, n, quality, dur, this.world.tick, this.table);
    if (made > 0) {
      this.minted[item] = this.minted[item]! + made;
      this.dirty = true;
      this.records.dirty.add(rec.pid);
    }
    return made;
  }

  /** Destroy `n` items from one slot. Returns false, changing nothing, if there are not that many. */
  burn(rec: EntityRecord, slot: number, n: number): boolean {
    const inv = this.inv(rec);
    if (slot >= inv.cap || !(n > 0) || inv.count[slot]! < n) return false;
    const item = inv.item[slot]!;
    inv.remove(slot, n);
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Destroy `n` of an item wherever it is in the inventory. All or nothing. */
  burnItem(rec: EntityRecord, item: number, n: number): boolean {
    if (!(n > 0) || !this.inv(rec).take(item, n)) return false;
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Destroy everything a record holds (a cache that timed out). */
  burnAll(rec: EntityRecord): void {
    const inv = this.inv(rec);
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) this.burn(rec, s, inv.count[s]!);
  }

  /** Move between slots, within one record or across two. Returns how many moved. */
  move(a: EntityRecord, sa: number, b: EntityRecord, sb: number, n: number): number {
    const moved = moveSlot(this.inv(a), sa, this.inv(b), sb, n, this.table);
    if (moved > 0) {
      this.records.dirty.add(a.pid);
      this.records.dirty.add(b.pid);
    }
    return moved;
  }

  /** Move `n` of an item from one record to another, wherever it fits. All or nothing. */
  give(from: EntityRecord, to: EntityRecord, item: number, n: number): boolean {
    if (from === to || !(n > 0) || !Number.isInteger(n)) return false;
    const src = this.inv(from);
    const dst = this.inv(to);
    if (src.total(item) < n || dst.room(item, 0, this.table) < n) return false;
    // Slot by slot, each stack bringing its own spoil clock with it.
    for (let s = src.cap - 1; s >= 0 && n > 0; s--) {
      if (src.item[s] !== item) continue;
      const k = Math.min(n, src.count[s]!);
      if (dst.add(item, k, src.quality[s]!, src.dur[s]!, this.world.tick, this.table, src.spoilAt[s]!) !== 0) throw new Error("room was checked");
      src.remove(s, k);
      n -= k;
    }
    this.records.dirty.add(from.pid);
    this.records.dirty.add(to.pid);
    return true;
  }

  /** How many of an item exist in the whole world. */
  total(item: number): number {
    let n = 0;
    for (const rec of this.records.byPid.values()) if (rec.inv) n += rec.inv.total(item);
    return n;
  }

  /** Every item for which stacks and ledger disagree, as text. Empty means the books balance. */
  audit(): string[] {
    const sums = new Float64Array(this.minted.length);
    for (const rec of this.records.byPid.values()) {
      const inv = rec.inv;
      if (!inv) continue;
      for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) sums[inv.item[s]!] = sums[inv.item[s]!]! + inv.count[s]!;
    }
    const out: string[] = [];
    for (let k = 1; k < sums.length; k++) {
      const expected = this.minted[k]! - this.burned[k]!;
      if (sums[k] !== expected) out.push(`${this.reg.ids[k]}: ${sums[k]} in the world, ledger says ${expected} (${this.minted[k]} minted, ${this.burned[k]} burned)`);
    }
    return out;
  }

  /** The ledger as text, keyed by content id so it survives a change of content indices. */
  serialize(): string {
    const out: Record<string, [number, number]> = {};
    for (let k = 1; k < this.minted.length; k++) if (this.minted[k] !== 0 || this.burned[k] !== 0) out[this.reg.ids[k]!] = [this.minted[k]!, this.burned[k]!];
    return JSON.stringify(out);
  }

  /**
   * Load a saved ledger, or, for a save that has none, open the books at what
   * the world holds now.
   */
  restore(saved: string | null): void {
    this.minted.fill(0);
    this.burned.fill(0);
    if (saved === null) {
      for (const rec of this.records.byPid.values()) {
        const inv = rec.inv;
        if (!inv) continue;
        for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) this.minted[inv.item[s]!] = this.minted[inv.item[s]!]! + inv.count[s]!;
      }
      this.dirty = true;
      return;
    }
    for (const [id, pair] of Object.entries(JSON.parse(saved) as Record<string, [number, number]>)) {
      const k = this.reg.index.get(id);
      // Content that is gone took its stacks with it when the records were loaded.
      if (k === undefined) continue;
      this.minted[k] = pair[0];
      this.burned[k] = pair[1];
    }
  }
}
