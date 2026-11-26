// The only code that edits inventories. Items enter only through `mint` (or `mintRef`, or the mints into one slot or weapon) and leave only through
// `burn` (spoilage is a burn, and what spoils into something mints it), so stacks sum to minted minus burned for every item.
// An edit marks each record it touches in one tick, so a move lands in one commit.

import type { ItemDef, SpeciesDef } from "../shared/content/defs.ts";
import type { Registry } from "../shared/content/registry.ts";
import { FLAG_BLUEPRINT, FLAG_ON, GEAR_SLOTS, CHARGED, Inventory, QUALITY_MUL, carried, clockMoved, fitsSlot, moveSlot, type ItemTable, stackOf } from "../shared/sim/items.ts";
import { leftAtPeriod } from "../shared/sim/breeding.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import { Signal } from "./signal.ts";

/** For a record whose kind declares no slots (a cache, a test fixture). */
const DEFAULT_SLOTS = 40;

/** What a restyle asks of the cluster's editions (server/people/store.ts): the garment an edition is of, or null for one it does not hold. */
export interface EditionLookup {
  garmentOf(edition: number): string | null;
}
const NO_EDITIONS: EditionLookup = { garmentOf: () => null };

const ITEM_GAIN = event("item.gain");
/** Settle passes for forms that spoil into forms: meat into spoiled meat, which spoils away, takes two. */
const MAX_SPOIL_CHAIN = 4;

export class Items {
  /** The registry, except while a save made under other tuning is brought up to date. */
  table: ItemTable;
  bus: Bus = NO_BUS;
  /** The cluster's editions, which a restyle's edition must be one of. Without a store, no edition is. */
  editions: EditionLookup = NO_EDITIONS;
  readonly minted: Float64Array;
  readonly burned: Float64Array;
  /**
   * Of what was minted, what came from another server of the cluster, and of what was burned, what left for one (`cameIn`,
   * `sentAway`). Every server's counts and the transfers in its cluster's folder balance between them (server/cluster/audit.ts).
   */
  readonly received: Float64Array;
  readonly sent: Float64Array;
  dirty = false;
  private readonly records: Records;
  private readonly world: ServerWorld;
  private readonly spoiled = (item: number, n: number, ref: number, at: number): void => {
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    if (ref !== 0) this.onRefGone.emit(ref);
    if (this.reg.spoilsInto[item] !== 0) this.turned.push(item, n, at);
  };
  /**
   * What spoiled into something in the settles under way, three numbers each: the item, how many, the tick the first went
   * bad. A settle works on the entries it pushed, so one begun inside another (by onRefGone) leaves the outer one's alone.
   */
  private readonly turned: number[] = [];
  /** A one of a kind (Inventory.ref) was burned, eaten or spoiled, so the record it stood for goes too (server/eggs.ts). */
  readonly onRefGone = new Signal<[ref: number]>();

  /** An inventory changed. The host queues derived body updates, so transfers finish before any refresh. */
  onChange: ((rec: EntityRecord) => void) | null = null;

  private changed(rec: EntityRecord): void {
    this.records.dirty.add(rec.pid);
    this.onChange?.(rec);
  }

  /** The world's content now: its settings may change it while the server runs. */
  private get reg(): Registry {
    return this.world.reg;
  }

  constructor(world: ServerWorld, records: Records) {
    this.world = world;
    this.records = records;
    this.table = world.reg;
    this.minted = new Float64Array(world.reg.defs.length);
    this.burned = new Float64Array(world.reg.defs.length);
    this.received = new Float64Array(world.reg.defs.length);
    this.sent = new Float64Array(world.reg.defs.length);
  }

  /** What a record holds, by item: stacks and blueprints, rounds loaded in weapons, and attachments fitted to them. */
  held(rec: EntityRecord, into: Map<number, number> = new Map()): Map<number, number> {
    const inv = rec.inv;
    for (let s = 0; inv && s < inv.cap; s++) {
      if (inv.item[s] === 0) continue;
      into.set(inv.item[s]!, (into.get(inv.item[s]!) ?? 0) + inv.count[s]!);
      if (inv.loaded[s]! > 0) into.set(inv.ammo[s]!, (into.get(inv.ammo[s]!) ?? 0) + inv.loaded[s]!);
      if (inv.attach[s] !== 0) into.set(inv.attach[s]!, (into.get(inv.attach[s]!) ?? 0) + 1);
    }
    return into;
  }

  /** The record came from another server with what it holds, which the caller has put in the world: that is minted, as received. */
  receive(rec: EntityRecord): void {
    this.cameIn(this.held(rec));
    this.records.dirty.add(rec.pid);
  }

  /** Counts what left for another server, by item, as burned and sent. */
  sentAway(what: ReadonlyMap<number, number>): void {
    for (const [item, n] of what) {
      this.burned[item] = this.burned[item]! + n;
      this.sent[item] = this.sent[item]! + n;
    }
    this.dirty = true;
  }

  /** Counts what came from another server, by item, as minted and received. */
  cameIn(what: ReadonlyMap<number, number>): void {
    for (const [item, n] of what) {
      this.minted[item] = this.minted[item]! + n;
      this.received[item] = this.received[item]! + n;
    }
    this.dirty = true;
  }

  /**
   * Counts `n` of an item as minted, or a negative `n` as burned, with no inventory touched: what an older save restored over
   * a transfer had and the transfer carried differ by it (server/cluster/cluster.ts).
   */
  adjust(item: number, n: number): void {
    if (n > 0) this.minted[item] = this.minted[item]! + n;
    else if (n < 0) this.burned[item] = this.burned[item]! - n;
    this.dirty = true;
  }

  /** The record's inventory, settled for spoilage up to this tick. Created on first use. */
  inv(rec: EntityRecord): Inventory {
    let inv = rec.inv;
    if (!inv) {
      const def = this.reg.defs[rec.kind];
      const bag = (def?.type === "species" || def?.type === "prop" || def?.type === "structure" ? def.slots : undefined) ?? DEFAULT_SLOTS;
      inv = rec.inv = new Inventory(bag + (def?.type === "species" && (def as SpeciesDef).equips ? GEAR_SLOTS : 0), bag);
    }
    inv.keep = this.reg.keeps[rec.kind]!;
    inv.charges = this.reg.charges[rec.kind] === 1;
    // A burning fire is worked out first, so cooking happens before the leftovers spoil.
    if (rec.fire && this.onFire) this.onFire(rec);
    this.settle(rec, inv, this.world.tick, this.table);
    return inv;
  }

  /**
   * Applies spoilage to `inv`, the inventory of `rec`, up to tick `now`. What spoiled is burned, and what it spoils into
   * (ItemDef.spoilsInto, ARK's SpoilingItem) is minted into the bag, one for one, with its own clock started at the tick the
   * first went bad, so it spoils in turn as it would have from then. What finds no room in the bag is lost. The new form
   * joins a stack of its kind as moved food does, as old as its oldest part.
   */
  private settle(rec: EntityRecord, inv: Inventory, now: number, table: ItemTable): void {
    const before = inv.version;
    const start = this.turned.length;
    for (let pass = 0; pass < MAX_SPOIL_CHAIN; pass++) {
      inv.settle(now, table, this.spoiled);
      if (this.turned.length === start) break;
      for (let k = start; k < this.turned.length; k += 3) {
        const into = this.reg.spoilsInto[this.turned[k]!]!;
        const n = this.turned[k + 1]!;
        const spoil = table.spoilTicks[into]!;
        const clock = spoil === 0 ? 0 : Math.min(0xffffffff, this.turned[k + 2]! + Math.round(spoil * inv.keep));
        const made = n - inv.add(into, n, 0, this.maxDur(into, 0), now, table, clock);
        if (made > 0) this.minted[into] = this.minted[into]! + made;
      }
      this.turned.length = start;
    }
    if (inv.version !== before) this.changed(rec);
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
      inv.charges = this.reg.charges[rec.kind] === 1;
      const before = inv.version;
      this.settle(rec, inv, tick, old);
      for (let s = 0; s < inv.cap; s++) {
        const at = inv.spoilAt[s]!;
        // A charge held full has no time left to rescale.
        if (at <= tick || at === CHARGED || inv.item[s] === 0) continue;
        const next = tick + leftAtPeriod(at - tick, was, is);
        inv.spoilAt[s] = next > 0xffffffff ? 0xffffffff : next;
        inv.touch(s);
      }
      if (inv.version !== before) this.changed(rec);
    }
  }

  /**
   * The record's kind changed at tick `t` from `from` to `to`, which keep things for different times: a preserving bin lit or
   * gone out (server/preserve.ts). Its inventory is settled to `t` as `from` kept things, then every stack's clock is
   * rescaled by `carried`, as food moved between two inventories is, so the time each top item had left at `t` is scaled
   * and nothing is fresher. What lies under a top item has not started, and keeps by `to` from then on. Called with `t`
   * the tick it happened, however long ago, so a bin that went out unobserved is worked out exactly when next looked at.
   */
  rekeep(rec: EntityRecord, t: number, from: number, to: number): void {
    const inv = rec.inv;
    const was = this.reg.keeps[from]!;
    const is = this.reg.keeps[to]!;
    // The two kinds may also differ in whether they hold a charge full (a soul vault burning and out): a charge is held
    // from `t` where `to` does, and runs down from full from `t` where only `from` did.
    const held = this.reg.charges[from] === 1;
    const holds = this.reg.charges[to] === 1;
    if (!inv) return;
    if (was !== is || held !== holds) {
      const before = inv.version;
      inv.keep = was;
      inv.charges = held;
      this.settle(rec, inv, t, this.table);
      const there = inv.charges;
      inv.charges = holds;
      for (let s = 0; s < inv.cap; s++) {
        const at = inv.spoilAt[s]!;
        const item = inv.item[s]!;
        if (at === 0 || item === 0) continue;
        const next = this.table.charge?.[item] === 1 ? inv.chargeFrom(there ? CHARGED : at, t, this.table.spoilTicks[item]!) : carried(at, t, was, is);
        if (next === at) continue;
        inv.spoilAt[s] = next;
        inv.touch(s);
      }
      if (inv.version !== before) this.changed(rec);
    }
    inv.keep = is;
    inv.charges = holds;
  }

  /** Settles spoilage up to tick `at` and no further, for a caller replaying an earlier moment. */
  spoilTo(rec: EntityRecord, at: number): void {
    const inv = rec.inv;
    if (!inv) return;
    inv.keep = this.reg.keeps[rec.kind]!;
    inv.charges = this.reg.charges[rec.kind] === 1;
    this.settle(rec, inv, at, this.table);
  }

  /**
   * Returns how many fit, which is how many it created. `at` is the tick it happens at. When given, the inventory is not
   * settled first. `why` says where the stack comes from, for a module that is asked about it: it may make it smaller
   * or larger, or refuse it. A physical conversion can bound that gain with `limit`. `flags` (FLAG_ bits) makes blueprints, one a slot, of an item that may be one (Registry.blueprints).
   */
  mint(rec: EntityRecord, item: number, n: number, quality = 0, dur = 0, at = -1, why = "", flags = 0, limit = Infinity): number {
    if (!this.isItem(item) || !(n > 0) || !Number.isInteger(n)) return 0;
    if ((flags & FLAG_BLUEPRINT) !== 0 && this.reg.blueprints[item] === 0) return 0;
    if (this.bus.n[ITEM_GAIN] !== 0) {
      const asked = { pid: rec.pid, item: this.reg.ids[item]!, why, n };
      if (this.bus.before(ITEM_GAIN, asked) !== "") return 0;
      n = Math.floor(Math.min(Number(asked.n), limit));
      if (!(n > 0)) return 0;
    }
    // 0 means new, with all its uses. A blueprint has none to wear.
    if (dur === 0 && flags === 0) dur = this.maxDur(item, quality);
    const made = n - (at < 0 ? this.inv(rec) : rec.inv!).add(item, n, quality, flags === 0 ? dur : 0, at < 0 ? this.world.tick : at, this.table, 0, flags);
    if (made > 0) {
      this.minted[item] = this.minted[item]! + made;
      this.dirty = true;
      this.changed(rec);
    }
    return made;
  }

  /**
   * Mints `n` of `item` into the empty slot `slot` of `rec`, where `mint` fills only the bag: a piece onto the body or the
   * hotbar while the bag is full. A module is asked about it as `mint` asks, and may refuse it or make it smaller. Returns
   * how many it made: 0 if the slot is taken or does not take the item, or `n` is more than one slot holds.
   */
  mintAt(rec: EntityRecord, slot: number, item: number, n: number, quality = 0, why = ""): number {
    const inv = this.inv(rec);
    if (!this.isItem(item) || !Number.isInteger(n) || !(n > 0) || n > stackOf(item, 0, this.table)) return 0;
    if (slot < 0 || slot >= inv.cap || inv.item[slot] !== 0 || !fitsSlot(inv, slot, item, this.table)) return 0;
    n = this.asked(rec, item, n, why);
    if (n === 0) return 0;
    const spoil = this.table.spoilTicks[item]!;
    const clock = spoil === 0 ? 0 : this.table.charge?.[item] === 1 ? inv.chargeFrom(0, this.world.tick, spoil) : Math.min(0xffffffff, this.world.tick + Math.round(spoil * inv.keep));
    inv.set(slot, item, n, quality, this.maxDur(item, quality), clock);
    this.minted[item] = this.minted[item]! + n;
    this.dirty = true;
    this.changed(rec);
    return n;
  }

  /**
   * Mints `n` rounds of `ammo` into the empty weapon in `slot` of `rec`, none passing through the bag. The caller knows
   * the weapon fires them and holds that many. A module is asked as `mint` asks. Returns how many were loaded.
   */
  mintLoaded(rec: EntityRecord, slot: number, ammo: number, n: number, why = ""): number {
    const inv = this.inv(rec);
    if (slot < 0 || slot >= inv.cap || inv.item[slot] === 0 || inv.flags[slot] !== 0 || inv.loaded[slot] !== 0 || !this.isItem(ammo) || !Number.isInteger(n) || !(n > 0)) return 0;
    // Rounds fired bare go into no weapon that has something fitted.
    if (this.bare(ammo) && inv.attach[slot] !== 0) return 0;
    n = this.asked(rec, ammo, n, why);
    if (n === 0) return 0;
    inv.setGear(slot, ammo, n, inv.attach[slot]!);
    this.minted[ammo] = this.minted[ammo]! + n;
    this.dirty = true;
    this.changed(rec);
    return n;
  }

  /**
   * Mints one `part` fitted to the weapon in `slot` of `rec`, which has nothing fitted, not passing through the bag. The
   * caller knows the weapon takes it. A module is asked as `mint` asks. False, changing nothing, if it cannot be.
   */
  mintFitted(rec: EntityRecord, slot: number, part: number, why = ""): boolean {
    const inv = this.inv(rec);
    if (slot < 0 || slot >= inv.cap || inv.item[slot] === 0 || inv.flags[slot] !== 0 || inv.attach[slot] !== 0 || !this.isItem(part)) return false;
    if (inv.loaded[slot]! > 0 && this.bare(inv.ammo[slot]!)) return false;
    if (this.asked(rec, part, 1, why) !== 1) return false;
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]!, part);
    this.minted[part] = this.minted[part]! + 1;
    this.dirty = true;
    this.changed(rec);
    return true;
  }

  /** How many of `n` new `item` a module lets `rec` have, which is never more than `n`: all of them where none listens. */
  private asked(rec: EntityRecord, item: number, n: number, why: string): number {
    if (this.bus.n[ITEM_GAIN] === 0) return n;
    const asked = { pid: rec.pid, item: this.reg.ids[item]!, why, n };
    if (this.bus.before(ITEM_GAIN, asked) !== "") return 0;
    const most = Math.floor(Math.min(Number(asked.n), n));
    return most > 0 ? most : 0;
  }

  /**
   * Creates one of a kind standing for record `ref` in a free bag slot of `rec`, or in its empty slot `at` where that is
   * given. Returns the slot, or -1 if there is none, `at` is taken or does not take the item, or the item stacks: only an
   * item that stacks to 1 may stand for a record. With `why`, a module is asked about it as `mint` asks, and may refuse it.
   */
  mintRef(rec: EntityRecord, item: number, ref: number, at = -1, why?: string): number {
    if (this.table.stack[item] !== 1 || ref === 0) return -1;
    const inv = this.inv(rec);
    const slot = at < 0 ? inv.free() : at < inv.cap && inv.item[at] === 0 && fitsSlot(inv, at, item, this.table) ? at : -1;
    if (slot < 0) return -1;
    if (why !== undefined && this.bus.n[ITEM_GAIN] !== 0) {
      const asked = { pid: rec.pid, item: this.reg.ids[item]!, why, n: 1 };
      if (this.bus.before(ITEM_GAIN, asked) !== "" || !(Number(asked.n) >= 1)) return -1;
    }
    inv.set(slot, item, 1, 0, this.maxDur(item, 0), 0);
    inv.setRef(slot, ref);
    // Its spoil clock starts as any new item's does, and a charge's full.
    const spoil = this.table.spoilTicks[item]!;
    if (spoil > 0) inv.spoilAt[slot] = this.table.charge?.[item] === 1 ? inv.chargeFrom(0, this.world.tick, spoil) : Math.min(0xffffffff, this.world.tick + Math.round(spoil * inv.keep));
    this.minted[item] = this.minted[item]! + 1;
    this.dirty = true;
    this.changed(rec);
    return slot;
  }

  /**
   * The one item in `slot` of `rec` becomes one `into`, where it lies: a soul ball that takes a tame in or lets it out
   * (server/balls.ts). The old item is burned and the new one minted in the ledger, new, with a new item's clock, and it
   * stands for record `ref` where one is given. What the old one stood for is forgotten, not told it is gone. False,
   * changing nothing, unless the slot holds one unflagged item that stacks to 1 and `into` stacks to 1 too.
   */
  turn(rec: EntityRecord, slot: number, into: number, ref = 0): boolean {
    const inv = this.inv(rec);
    const was = slot < inv.cap ? inv.item[slot]! : 0;
    if (was === 0 || inv.count[slot] !== 1 || inv.flags[slot] !== 0 || this.table.stack[was] !== 1 || this.table.stack[into] !== 1 || !fitsSlot(inv, slot, into, this.table)) return false;
    const spoil = this.table.spoilTicks[into]!;
    const charge = this.table.charge?.[into] === 1;
    const clock = spoil === 0 ? 0 : charge ? inv.chargeFrom(0, this.world.tick, spoil) : Math.min(0xffffffff, this.world.tick + Math.round(spoil * inv.keep));
    inv.set(slot, into, 1, 0, this.maxDur(into, 0), clock);
    if (ref !== 0) inv.setRef(slot, ref);
    this.burned[was] = this.burned[was]! + 1;
    this.minted[into] = this.minted[into]! + 1;
    this.dirty = true;
    this.changed(rec);
    return true;
  }

  /**
   * Returns false, changing nothing, if the slot holds fewer than `n`. `raw` skips settling the inventory first. A blueprint is
   * never eaten, used or fed, so only a raw burn, of what empties a whole inventory, takes one.
   */
  burn(rec: EntityRecord, slot: number, n: number, raw = false): boolean {
    const inv = raw ? rec.inv! : this.inv(rec);
    if (slot >= inv.cap || !(n > 0) || inv.count[slot]! < n || (!raw && (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0)) return false;
    const item = inv.item[slot]!;
    const ref = inv.refOf(slot);
    // Loaded rounds and an attachment are burned with the weapon.
    if (inv.loaded[slot]! > 0) this.burned[inv.ammo[slot]!] = this.burned[inv.ammo[slot]!]! + inv.loaded[slot]!;
    if (inv.attach[slot] !== 0) this.burned[inv.attach[slot]!] = this.burned[inv.attach[slot]!]! + 1;
    inv.remove(slot, n);
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.changed(rec);
    if (ref !== 0) this.onRefGone.emit(ref);
    return true;
  }

  /**
   * Loads `ammo` from the bag into the weapon in `slot`, up to `clip`. Rounds of another kind go back to the bag first, and
   * so does an attachment if `ammo` is fired bare (AmmoFacet.bare: loaded with darts the Longneck "cannot use any
   * attachments", Longneck Rifle). Returns the rounds it then holds, or -1 if that cannot be done.
   */
  load(rec: EntityRecord, slot: number, ammo: number, clip: number): number {
    const inv = this.inv(rec);
    if (slot >= inv.cap || inv.item[slot] === 0 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return -1;
    if (inv.ammo[slot] !== ammo && inv.loaded[slot]! > 0 && !this.unload(rec, slot)) return -1;
    if (this.bare(ammo) && inv.attach[slot] !== 0 && inv.total(ammo) > 0 && !this.detach(rec, slot)) return -1;
    const want = clip - (inv.ammo[slot] === ammo ? inv.loaded[slot]! : 0);
    const n = Math.min(want, inv.total(ammo));
    const have = inv.ammo[slot] === ammo ? inv.loaded[slot]! : 0;
    if (n > 0 && !inv.take(ammo, n)) return -1;
    // A move within the inventory, so the ledger does not change.
    inv.setGear(slot, ammo, have + (n > 0 ? n : 0), inv.attach[slot]!);
    this.changed(rec);
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
    this.changed(rec);
    return true;
  }

  /** Burns one loaded round (it was fired). False if the weapon holds none. */
  spend(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    if (inv.loaded[slot]! === 0) return false;
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]! - 1, inv.attach[slot]!);
    this.burned[inv.ammo[slot]!] = this.burned[inv.ammo[slot]!]! + 1;
    this.dirty = true;
    this.changed(rec);
    return true;
  }

  /**
   * Fits the item in `from` to the weapon in `slot`. An attachment already fitted comes off into `from`. False unless `from`
   * holds exactly one, or while the weapon holds rounds fired bare (darts). A new attachment starts switched off.
   */
  attach(rec: EntityRecord, slot: number, from: number): boolean {
    const inv = this.inv(rec);
    if (slot >= inv.cap || from >= inv.cap || slot === from || inv.item[slot] === 0 || inv.count[from] !== 1 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0 || inv.flags[from] !== 0) return false;
    if (inv.loaded[slot]! > 0 && this.bare(inv.ammo[slot]!)) return false;
    const fitted = inv.item[from]!;
    const old = inv.attach[slot]!;
    inv.set(from, old, old === 0 ? 0 : 1, 0, 0, 0);
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]!, fitted);
    if ((inv.flags[slot]! & FLAG_ON) !== 0) inv.setFlags(slot, inv.flags[slot]! & ~FLAG_ON);
    this.changed(rec);
    return true;
  }

  /** Moves the weapon's attachment to the bag, and it is off. False if there is none or no room. */
  detach(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    const old = inv.attach[slot]!;
    if (old === 0 || inv.room(old, 0, this.table) < 1) return false;
    inv.setGear(slot, inv.ammo[slot]!, inv.loaded[slot]!, 0);
    if ((inv.flags[slot]! & FLAG_ON) !== 0) inv.setFlags(slot, inv.flags[slot]! & ~FLAG_ON);
    if (inv.add(old, 1, 0, 0, this.world.tick, this.table) !== 0) throw new Error("room was checked");
    this.changed(rec);
    return true;
  }

  /** The kind of attachment (ItemDef.attachment) fitted to the weapon in `slot` of `inv`, or "" for none. */
  attachmentOf(inv: Inventory, slot: number): string {
    const fitted = slot >= 0 && slot < inv.cap ? inv.attach[slot]! : 0;
    return fitted === 0 ? "" : ((this.reg.defs[fitted] as ItemDef | null)?.attachment ?? "");
  }

  /** Whether a round of `ammo` is fired with nothing fitted to its weapon (AmmoFacet.bare). */
  bare(ammo: number): boolean {
    return ammo !== 0 && (this.reg.defs[ammo] as ItemDef | null)?.ammo?.bare === true;
  }

  /**
   * Switches the attachment of the weapon in `slot` on or off (FLAG_ON). Only a flashlight or a laser switches ("press N
   * to turn the flashlight on", Flashlight Attachment; the laser "is turned on/off by pressing N", Laser Attachment); a
   * scope or silencer works whenever it is fitted, and a worn-out weapon's stays off. Returns whether it is now on.
   */
  toggle(rec: EntityRecord, slot: number): boolean {
    const inv = this.inv(rec);
    if (slot < 0 || slot >= inv.cap || inv.item[slot] === 0) return false;
    const kind = this.attachmentOf(inv, slot);
    const was = (inv.flags[slot]! & FLAG_ON) !== 0;
    const broken = this.reg.uses[inv.item[slot]!]! > 0 && inv.dur[slot] === 0;
    const on = !was && (kind === "light" || kind === "laser") && !broken;
    if (on === was) return on;
    inv.setFlags(slot, on ? inv.flags[slot]! | FLAG_ON : inv.flags[slot]! & ~FLAG_ON);
    this.changed(rec);
    return on;
  }

  /** Switches off every attachment of `rec` but the one on the weapon in `keep` (-1 for none). */
  switchOff(rec: EntityRecord, keep = -1): void {
    const inv = rec.inv;
    if (!inv) return;
    let changed = false;
    for (let s = 0; s < inv.cap; s++) {
      if (s === keep || (inv.flags[s]! & FLAG_ON) === 0) continue;
      inv.setFlags(s, inv.flags[s]! & ~FLAG_ON);
      changed = true;
    }
    if (changed) this.changed(rec);
  }

  /** Returns the uses left. At 0 the item is broken. It stays in its slot and can be repaired, and its attachment goes off. */
  wear(rec: EntityRecord, slot: number, n: number): number {
    const inv = this.inv(rec);
    const left = inv.dur[slot]! - n;
    inv.setDur(slot, left > 0 ? left : 0);
    if (left <= 0 && (inv.flags[slot]! & FLAG_ON) !== 0) inv.setFlags(slot, inv.flags[slot]! & ~FLAG_ON);
    this.changed(rec);
    return inv.dur[slot]!;
  }

  /** Sets what the slot holds as its durability: the water in a vessel (server/use.ts), from 0 to 65535. Mints and burns nothing. */
  setDur(rec: EntityRecord, slot: number, dur: number): void {
    const inv = this.inv(rec);
    inv.setDur(slot, dur < 0 ? 0 : dur > 65535 ? 65535 : Math.round(dur));
    this.changed(rec);
  }

  /** Restores all uses. The caller takes the cost. */
  mend(rec: EntityRecord, slot: number): void {
    const inv = this.inv(rec);
    inv.setDur(slot, this.maxDur(inv.item[slot]!, inv.quality[slot]!));
    this.changed(rec);
  }

  /** Burns `n` of an item from any slots. All or nothing. */
  burnItem(rec: EntityRecord, item: number, n: number): boolean {
    const inv = this.inv(rec);
    if (!(n > 0) || inv.total(item) < n) return false;
    if (inv.ref) {
      // Last slots first, as Inventory.take goes, one slot at a time so that what each stood for goes with it.
      for (let s = inv.cap - 1; s >= 0 && n > 0; s--) {
        if (inv.item[s] !== item || (inv.flags[s]! & FLAG_BLUEPRINT) !== 0) continue;
        const k = Math.min(n, inv.count[s]!);
        this.burn(rec, s, k, true);
        n -= k;
      }
      return true;
    }
    inv.take(item, n);
    this.burned[item] = this.burned[item]! + n;
    this.dirty = true;
    this.changed(rec);
    return true;
  }

  burnAll(rec: EntityRecord): void {
    const inv = this.inv(rec);
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) this.burn(rec, s, inv.count[s]!, true);
  }

  /**
   * Whether a stack may go from `a` to `b`'s slot under the take-only rule (Registry.takeOnly, a supply capsule): nothing
   * goes into one, and what leaves one lands on an empty slot or joins its like, since a swap would put the taker's stack in.
   */
  takes(a: EntityRecord, sa: number, b: EntityRecord, sb: number): boolean {
    if (this.reg.takeOnly[b.kind] === 1) return false;
    if (this.reg.takeOnly[a.kind] !== 1) return true;
    const src = this.inv(a);
    const dst = this.inv(b);
    if (sa >= src.cap || sb >= dst.cap || dst.item[sb] === 0) return true;
    const item = src.item[sa]!;
    return dst.item[sb] === item && stackOf(item, src.flags[sa]!, this.table) > 1 && dst.quality[sb] === src.quality[sa] && dst.flags[sb] === (src.flags[sa]! & ~FLAG_ON) && dst.sameStyle(sb, src, sa);
  }

  /**
   * Sets the edition and dye of the item in `slot` of `rec` (Inventory.edition and dye): what it looks like, which mints and
   * burns nothing. False, changing nothing, for an empty slot, a blueprint, a dye on a garment that takes none, or an
   * edition the store does not hold or holds of another garment. A retired edition is one still.
   */
  restyle(rec: EntityRecord, slot: number, edition: number, dye: number): boolean {
    const inv = this.inv(rec);
    if (slot < 0 || slot >= inv.cap || inv.item[slot] === 0 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return false;
    if (!(Number.isInteger(edition) && edition >= 0 && edition <= 0xffffffff && Number.isInteger(dye) && dye >= 0 && dye <= 0xffffff)) return false;
    // A garment made to take no dye keeps its own colours.
    const item = inv.item[slot]!;
    if (dye !== 0 && this.reg.garmentSlot[item]! >= 0 && this.reg.garmentDyes[item] === 0) return false;
    if (edition !== 0 && edition !== inv.editionOf(slot) && this.editions.garmentOf(edition) !== this.reg.defs[item]?.id) return false;
    inv.setStyle(slot, edition, dye);
    this.changed(rec);
    return true;
  }

  /** Within one record or across two. Returns how many moved. */
  move(a: EntityRecord, sa: number, b: EntityRecord, sb: number, n: number): number {
    if (a !== b && !this.takes(a, sa, b, sb)) return 0;
    const moved = moveSlot(this.inv(a), sa, this.inv(b), sb, n, this.table, this.world.tick);
    if (moved > 0) {
      this.changed(a);
      this.changed(b);
    }
    return moved;
  }

  /** Moves `n` of an item to another record, wherever it fits. All or nothing. Blueprints of it stay. */
  give(from: EntityRecord, to: EntityRecord, item: number, n: number): boolean {
    if (from === to || !(n > 0) || !Number.isInteger(n) || this.reg.takeOnly[to.kind] === 1) return false;
    const src = this.inv(from);
    const dst = this.inv(to);
    if (src.total(item) < n || !this.fits(src, dst, item, n)) return false;
    // Each stack keeps its spoil time, scaled if the other keeps things longer, and its edition and dye. An unstackable item
    // keeps its rounds and attachment too.
    const tick = this.world.tick;
    for (let s = src.cap - 1; s >= 0 && n > 0; s--) {
      if (src.item[s] !== item || (src.flags[s]! & FLAG_BLUEPRINT) !== 0) continue;
      const k = Math.min(n, src.count[s]!);
      const spoilAt = clockMoved(src, s, dst, tick, this.table);
      if (this.table.stack[item] === 1) {
        const to = dst.free();
        if (to < 0) throw new Error("room was checked");
        dst.set(to, item, 1, src.quality[s]!, src.dur[s]!, spoilAt);
        dst.setGear(to, src.ammo[s]!, src.loaded[s]!, src.attach[s]!);
        dst.setRef(to, src.refOf(s));
        dst.setStyle(to, src.editionOf(s), src.dyeOf(s));
      } else if (dst.add(item, k, src.quality[s]!, src.dur[s]!, tick, this.table, spoilAt, 0, src.editionOf(s), src.dyeOf(s)) !== 0) throw new Error("room was checked");
      src.remove(s, k);
      n -= k;
    }
    this.changed(from);
    this.changed(to);
    return true;
  }

  /**
   * Whether `n` of `item` taken from `src` as `give` takes them, last slots first, all find room in the bag of `dst`. Each
   * stack goes onto its like (quality, edition and dye) before empty slots, as `Inventory.add` puts it.
   */
  private fits(src: Inventory, dst: Inventory, item: number, n: number): boolean {
    const stack = this.table.stack[item]!;
    let free = 0;
    for (let s = 0; s < dst.bag; s++) if (dst.item[s] === 0) free++;
    if (stack === 1) return free >= n;
    const empty = free;
    // The room left on the partial stacks of each like, as stacks given before it have changed it.
    const spare = new Map<string, number>();
    for (let s = src.cap - 1; s >= 0 && n > 0; s--) {
      if (src.item[s] !== item || (src.flags[s]! & FLAG_BLUEPRINT) !== 0) continue;
      let k = Math.min(n, src.count[s]!);
      n -= k;
      const q = src.quality[s]!, edition = src.editionOf(s), dye = src.dyeOf(s);
      const like = `${q}/${edition}/${dye}`;
      let room = spare.get(like) ?? dst.room(item, q, this.table, 0, edition, dye) - empty * stack;
      const join = Math.min(k, room);
      k -= join;
      room -= join;
      const slots = Math.ceil(k / stack);
      if (slots > free) return false;
      free -= slots;
      spare.set(like, room + slots * stack - k);
    }
    return true;
  }

  /** Counts the whole world as the ledger does: stacks and blueprints, rounds loaded in weapons, and attachments fitted to them. */
  total(item: number): number {
    let n = 0;
    for (const rec of this.records.byPid.values()) {
      const inv = rec.inv;
      if (!inv) continue;
      for (let s = 0; s < inv.cap; s++) {
        if (inv.item[s] === 0) continue;
        if (inv.item[s] === item) n += inv.count[s]!;
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

  /** Keyed by content id, so it survives a change of content indices. Each value is [minted, burned], then [received, sent] if either is not 0. */
  serialize(): string {
    const out: Record<string, number[]> = {};
    for (let k = 1; k < this.minted.length; k++) {
      if (this.minted[k] === 0 && this.burned[k] === 0) continue;
      out[this.reg.ids[k]!] = this.received[k] === 0 && this.sent[k] === 0 ? [this.minted[k]!, this.burned[k]!] : [this.minted[k]!, this.burned[k]!, this.received[k]!, this.sent[k]!];
    }
    return JSON.stringify(out);
  }

  restore(saved: string): void {
    this.minted.fill(0);
    this.burned.fill(0);
    this.received.fill(0);
    this.sent.fill(0);
    for (const [id, pair] of Object.entries(JSON.parse(saved) as Record<string, number[]>)) {
      // What was counted under an id that has since been renamed is counted under what it is now. Two ids may have become one.
      const k = this.reg.index.get(id) ?? this.reg.redirects.get(id)?.[0];
      // Stacks of removed content were dropped when the records loaded.
      if (k === undefined) continue;
      this.minted[k] = this.minted[k]! + pair[0]!;
      this.burned[k] = this.burned[k]! + pair[1]!;
      this.received[k] = this.received[k]! + (pair[2] ?? 0);
      this.sent[k] = this.sent[k]! + (pair[3] ?? 0);
    }
  }
}
