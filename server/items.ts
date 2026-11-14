// The only code that edits inventories. Items enter only through `mint` and leave only through `burn` (spoilage is a burn), so
// stacks sum to minted minus burned for every item. An edit marks each record it touches in one tick, so a move lands in one commit.

import type { SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { GEAR_SLOTS, Inventory, QUALITY_MUL, carried, moveSlot, type ItemTable } from "../shared/sim/items.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";

/** For a record whose kind declares no slots (a cache, a test fixture). */
const DEFAULT_SLOTS = 40;

const ITEM_GAIN = event("item.gain");

export class Items {
  /** The registry, except while a save made under other tuning is brought up to date. */
  table: ItemTable;
  bus: Bus = NO_BUS;
  readonly minted: Float64Array;
  readonly burned: Float64Array;
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

  /** The record's inventory, settled for spoilage up to this tick. Created on first use. */
  inv(rec: EntityRecord): Inventory {
    let inv = rec.inv;
    const def = this.reg.defs[rec.kind];
    const species = def?.type === "species" ? (def as SpeciesDef) : null;
    if (!inv) {
      const bag = (def?.type === "species" || def?.type === "prop" || def?.type === "structure" ? def.slots : undefined) ?? DEFAULT_SLOTS;
      inv = rec.inv = new Inventory(bag + (species?.equips ? GEAR_SLOTS : 0), bag);
    } else if (species?.equips && inv.hotbar < 0) {
      // A save from before equipment gets the gear slots it lacked.
      const grown = new Inventory(inv.cap + GEAR_SLOTS, inv.cap);
      for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) grown.set(s, inv.item[s]!, inv.count[s]!, inv.quality[s]!, inv.dur[s]!, inv.spoilAt[s]!);
      inv = rec.inv = grown;
      this.records.dirty.add(rec.pid);
    }
    inv.keep = this.reg.keeps[rec.kind]!;
    // A burning fire is worked out first, so cooking happens before the leftovers spoil.
    if (rec.fire && this.onFire) this.onFire(rec);
    const before = inv.version;
    inv.settle(this.world.tick, this.table, this.spoiled);
    if (inv.version !== before) this.records.dirty.add(rec.pid);
    return inv;
  }

  /** Uses a new item of this quality has. 0 for items that do not wear. */
  maxDur(item: number, quality: number): number {
    return Math.round(this.reg.uses[item]! * (QUALITY_MUL[quality] ?? 1));
  }

  isItem(kind: number): boolean {
    return this.table.stack[kind]! > 0;
  }

  /** Called with a record whose fire is burning, before its inventory is settled (server/stations.ts). */
  onFire: ((rec: EntityRecord) => void) | null = null;

  /**
   * A save made at spoil multiplier `was` is loaded at `is`. Settles every inventory to this tick with the `old` table, then
   * rescales the time left on the top piece of each stack. The pieces under it have not started and use the current table.
   */
  respoil(old: ItemTable, was: number, is: number): void {
    const tick = this.world.tick;
    for (const rec of this.records.byPid.values()) {
      const inv = rec.inv;
      if (!inv) continue;
      inv.keep = this.reg.keeps[rec.kind]!;
      const before = inv.version;
      inv.settle(tick, old, this.spoiled);
      for (let s = 0; s < inv.cap; s++) {
        const at = inv.spoilAt[s]!;
        if (at <= tick || inv.item[s] === 0) continue;
        const next = tick + leftAtPeriod(at - tick, was, is);
        inv.spoilAt[s] = next > 0xffffffff ? 0xffffffff : next;
        inv.mod[s] = ++inv.version;
      }
      if (inv.version !== before) this.records.dirty.add(rec.pid);
    }
  }

  /** Settles spoilage up to tick `at` and no further, for a caller replaying an earlier moment. */
  spoilTo(rec: EntityRecord, at: number): void {
    const inv = rec.inv;
    if (!inv) return;
    inv.keep = this.reg.keeps[rec.kind]!;
    const before = inv.version;
    inv.settle(at, this.table, this.spoiled);
    if (inv.version !== before) this.records.dirty.add(rec.pid);
  }

  /**
   * Returns how many fit, which is how many it created. `at` is the tick it happens at. When given, the inventory is not
   * settled first. `why` says where the stack comes from, for a module that is asked about it: it may make it smaller
   * or larger, or refuse it.
   */
  mint(rec: EntityRecord, item: number, n: number, quality = 0, dur = 0, at = -1, why = ""): number {
    if (!this.isItem(item) || !(n > 0) || !Number.isInteger(n)) return 0;
    if (this.bus.n[ITEM_GAIN] !== 0) {
      const asked = { pid: rec.pid, item: this.reg.ids[item]!, why, n };
      if (this.bus.before(ITEM_GAIN, asked) !== "") return 0;
      n = Math.floor(Number(asked.n));
      if (!(n > 0)) return 0;
    }
    // 0 means new, with all its uses.
    if (dur === 0) dur = this.maxDur(item, quality);
    const made = n - (at < 0 ? this.inv(rec) : rec.inv!).add(item, n, quality, dur, at < 0 ? this.world.tick : at, this.table);
    if (made > 0) {
      this.minted[item] = this.minted[item]! + made;
      this.dirty = true;
      this.records.dirty.add(rec.pid);
    }
    return made;
  }

  /** Returns false, changing nothing, if the slot holds fewer than `n`. `raw` skips settling the inventory first. */
  burn(rec: EntityRecord, slot: number, n: number, raw = false): boolean {
    const inv = raw ? rec.inv! : this.inv(rec);
    if (slot >= inv.cap || !(n > 0) || inv.count[slot]! < n) return false;
    const item = inv.item[slot]!;
    // Loaded rounds and an attachment are burned with the weapon.
    if (inv.loaded[slot]! > 0) this.burned[inv.ammo[slot]!] = this.burned[inv.ammo[slot]!]! + inv.loaded[slot]!;
    if (inv.attach[slot] !== 0) this.burned[inv.attach[slot]!] = this.burned[inv.attach[slot]!]! + 1;
    inv.remove(slot, n);
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.records.dirty.add(rec.pid);
    return true;
  }

  /**
   * Loads `ammo` from the bag into the weapon in `slot`, up to `clip`. Rounds of another kind go back to the bag first.
   * Returns the rounds it then holds, or -1 if that cannot be done.
   */
  load(rec: EntityRecord, slot: number, ammo: number, clip: number): number {
    const inv = this.inv(rec);
    if (slot >= inv.cap || inv.item[slot] === 0) return -1;
    if (inv.ammo[slot] !== ammo && inv.loaded[slot]! > 0 && !this.unload(rec, slot)) return -1;
    const want = clip - (inv.ammo[slot] === ammo ? inv.loaded[slot]! : 0);
    const n = Math.min(want, inv.total(ammo));
    const have = inv.ammo[slot] === ammo ? inv.loaded[slot]! : 0;
    if (n > 0 && !inv.take(ammo, n)) return -1;
    // A move within the inventory, so the ledger does not change.
    inv.setGear(slot, ammo, have + (n > 0 ? n : 0), inv.attach[slot]!);
    this.records.dirty.add(rec.pid);
    return inv.loaded[slot]!;
  }

  /** Moves the weapon's rounds to the bag. False, changing nothing, if they do not fit. */
  unload(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    const n = inv.loaded[slot]!;
    if (n === 0) return true;
    const ammo = inv.ammo[slot]!;
    if (inv.room(ammo, 0, this.table) < n) return false;
    inv.setGear(slot, ammo, 0, inv.attach[slot]!);
    if (inv.add(ammo, n, 0, 0, this.world.tick, this.table) !== 0) throw new Error("room was checked");
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Burns one loaded round (it was fired). False if the weapon holds none. */
  spend(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    if (inv.loaded[slot]! === 0) return false;
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]! - 1, inv.attach[slot]!);
    this.burned[inv.ammo[slot]!] = this.burned[inv.ammo[slot]!]! + 1;
    this.dirty = true;
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Fits the item in `from` to the weapon in `slot`. An attachment already fitted comes off into `from`. False unless `from` holds exactly one. */
  attach(rec: EntityRecord, slot: number, from: number): boolean {
    const inv = this.inv(rec);
    if (slot >= inv.cap || from >= inv.cap || slot === from || inv.item[slot] === 0 || inv.count[from] !== 1) return false;
    const fitted = inv.item[from]!;
    const old = inv.attach[slot]!;
    inv.set(from, old, old === 0 ? 0 : 1, 0, 0, 0);
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]!, fitted);
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Moves the weapon's attachment to the bag. False if there is none or no room. */
  detach(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    const old = inv.attach[slot]!;
    if (old === 0 || inv.room(old, 0, this.table) < 1) return false;
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]!, 0);
    if (inv.add(old, 1, 0, 0, this.world.tick, this.table) !== 0) throw new Error("room was checked");
    this.records.dirty.add(rec.pid);
    return true;
  }

  /** Returns the uses left. At 0 the item is broken. It stays in its slot and can be repaired. */
  wear(rec: EntityRecord, slot: number, n: number): number {
    const inv = this.inv(rec);
    const left = inv.dur[slot]! - n;
    inv.setDur(slot, left > 0 ? left : 0);
    this.records.dirty.add(rec.pid);
    return inv.dur[slot]!;
  }

  /** Restores all uses. The caller takes the cost. */
  mend(rec: EntityRecord, slot: number): void {
    const inv = this.inv(rec);
    inv.setDur(slot, this.maxDur(inv.item[slot]!, inv.quality[slot]!));
    this.records.dirty.add(rec.pid);
  }

  /** Burns `n` of an item from any slots. All or nothing. */
  burnItem(rec: EntityRecord, item: number, n: number): boolean {
    if (!(n > 0) || !this.inv(rec).take(item, n)) return false;
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.records.dirty.add(rec.pid);
    return true;
  }

  burnAll(rec: EntityRecord): void {
    const inv = this.inv(rec);
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) this.burn(rec, s, inv.count[s]!);
  }

  /** Within one record or across two. Returns how many moved. */
  move(a: EntityRecord, sa: number, b: EntityRecord, sb: number, n: number): number {
    const moved = moveSlot(this.inv(a), sa, this.inv(b), sb, n, this.table, this.world.tick);
    if (moved > 0) {
      this.records.dirty.add(a.pid);
      this.records.dirty.add(b.pid);
    }
    return moved;
  }

  /** Moves `n` of an item to another record, wherever it fits. All or nothing. */
  give(from: EntityRecord, to: EntityRecord, item: number, n: number): boolean {
    if (from === to || !(n > 0) || !Number.isInteger(n)) return false;
    const src = this.inv(from);
    const dst = this.inv(to);
    if (src.total(item) < n || dst.room(item, 0, this.table) < n) return false;
    // Each stack keeps its spoil time, scaled if the other keeps things longer, and an unstackable item keeps its rounds and attachment.
    const tick = this.world.tick;
    for (let s = src.cap - 1; s >= 0 && n > 0; s--) {
      if (src.item[s] !== item) continue;
      const k = Math.min(n, src.count[s]!);
      const spoilAt = carried(src.spoilAt[s]!, tick, src.keep, dst.keep);
      if (this.table.stack[item] === 1) {
        const to = dst.free();
        if (to < 0) throw new Error("room was checked");
        dst.set(to, item, 1, src.quality[s]!, src.dur[s]!, spoilAt);
        dst.setGear(to, src.ammo[s]!, src.loaded[s]!, src.attach[s]!);
      } else if (dst.add(item, k, src.quality[s]!, src.dur[s]!, tick, this.table, spoilAt) !== 0) throw new Error("room was checked");
      src.remove(s, k);
      n -= k;
    }
    this.records.dirty.add(from.pid);
    this.records.dirty.add(to.pid);
    return true;
  }

  /** Counts the whole world: stacks, rounds loaded in weapons, and attachments fitted to them. */
  total(item: number): number {
    let n = 0;
    for (const rec of this.records.byPid.values()) {
      const inv = rec.inv;
      if (!inv) continue;
      n += inv.total(item);
      for (let s = 0; s < inv.cap; s++) {
        if (inv.item[s] === 0) continue;
        if (inv.ammo[s] === item) n += inv.loaded[s]!;
        if (inv.attach[s] === item) n++;
      }
    }
    return n;
  }

  /** One line per item whose stacks and ledger disagree. Empty means the ledger balances. */
  audit(): string[] {
    const sums = new Float64Array(this.minted.length);
    for (const rec of this.records.byPid.values()) {
      const inv = rec.inv;
      if (!inv) continue;
      for (let s = 0; s < inv.cap; s++) {
        if (inv.item[s] === 0) continue;
        sums[inv.item[s]!] = sums[inv.item[s]!]! + inv.count[s]!;
        if (inv.loaded[s]! > 0) sums[inv.ammo[s]!] = sums[inv.ammo[s]!]! + inv.loaded[s]!;
        if (inv.attach[s] !== 0) sums[inv.attach[s]!] = sums[inv.attach[s]!]! + 1;
      }
    }
    const out: string[] = [];
    for (let k = 1; k < sums.length; k++) {
      const expected = this.minted[k]! - this.burned[k]!;
      if (sums[k] !== expected) out.push(`${this.reg.ids[k]}: ${sums[k]} in the world, ledger says ${expected} (${this.minted[k]} minted, ${this.burned[k]} burned)`);
    }
    return out;
  }

  /** Keyed by content id, so it survives a change of content indices. Each value is [minted, burned]. */
  serialize(): string {
    const out: Record<string, [number, number]> = {};
    for (let k = 1; k < this.minted.length; k++) if (this.minted[k] !== 0 || this.burned[k] !== 0) out[this.reg.ids[k]!] = [this.minted[k]!, this.burned[k]!];
    return JSON.stringify(out);
  }

  /** A null `saved` is a save with no ledger. The ledger then starts at what the world holds now. */
  restore(saved: string | null): void {
    this.minted.fill(0);
    this.burned.fill(0);
    if (saved === null) {
      for (const rec of this.records.byPid.values()) {
        const inv = rec.inv;
        if (!inv) continue;
        for (let s = 0; s < inv.cap; s++) {
          if (inv.item[s] === 0) continue;
          this.minted[inv.item[s]!] = this.minted[inv.item[s]!]! + inv.count[s]!;
          if (inv.loaded[s]! > 0) this.minted[inv.ammo[s]!] = this.minted[inv.ammo[s]!]! + inv.loaded[s]!;
          if (inv.attach[s] !== 0) this.minted[inv.attach[s]!] = this.minted[inv.attach[s]!]! + 1;
        }
      }
      this.dirty = true;
      return;
    }
    for (const [id, pair] of Object.entries(JSON.parse(saved) as Record<string, [number, number]>)) {
      // What was counted under an id that has since been renamed is counted under what it is now. Two ids may have become one.
      const k = this.reg.index.get(id) ?? this.reg.redirects.get(id)?.[0];
      // Stacks of removed content were dropped when the records loaded.
      if (k === undefined) continue;
      this.minted[k] = this.minted[k]! + pair[0];
      this.burned[k] = this.burned[k]! + pair[1];
    }
  }
}
