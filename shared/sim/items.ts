// Inventories: fixed-capacity slot tables.
//
// A slot holds a stack: an item, a count, and for things that do not stack a
// quality and a durability. Nothing here ticks. Spoilage is stored as the tick
// at which the stack's top item goes bad, so time passing costs nothing, and
// `settle` works out in one step how many have gone since anyone last looked.
//
// A body that carries equipment has a tail of reserved slots after its bag: ten
// hotbar slots, then one armor slot per body slot. They are slots like any
// other (an item is in exactly one place, and a hotbar slot holds the thing
// itself), but nothing lands in them by itself: `add` fills the bag only.
//
// A weapon carries three more things on its own slot: the kind of ammunition
// it takes, how many rounds are in it, and an attachment. Those are items too,
// held inside the weapon instead of in a stack, and the ledger counts them.
//
// The server edits inventories only through server/items.ts, which keeps the
// ledger. The client holds mirrors filled from slot deltas.

export const HOTBAR_SLOTS = 10;
/** One per body slot, in the order of shared/anim/human.ts: head, torso, hands, legs, feet. */
export const ARMOR_SLOTS = 5;
export const GEAR_SLOTS = HOTBAR_SLOTS + ARMOR_SLOTS;

/** The six tiers of quality, lowest first, and how much each multiplies what an item's definition says. */
export const QUALITY_NAMES: readonly string[] = ["primitive", "ramshackle", "apprentice", "journeyman", "mastercraft", "ascendant"];
export const QUALITY_MUL: readonly number[] = [1, 1.2, 1.45, 1.75, 2.1, 2.6];

/** Per content index: what the item model needs to know about each item. */
export interface ItemTable {
  /** Largest stack; 0 for content that is not an item. */
  readonly stack: Uint16Array;
  /** Kilograms each. */
  readonly weight: Float32Array;
  /** Ticks one item lasts; 0 for items that do not spoil. */
  readonly spoilTicks: Uint32Array;
  /** The armor slot an item is worn in (0 to 4), or -1 for anything not worn. */
  readonly wearSlot: Int8Array;
}

export class Inventory {
  readonly cap: number;
  /** Slots 0 .. bag-1 are the bag. When `cap` is larger, the hotbar and then the armor slots follow. */
  readonly bag: number;
  /** Content index; 0 is an empty slot. */
  readonly item: Uint16Array;
  readonly count: Uint16Array;
  readonly quality: Uint8Array;
  readonly dur: Uint16Array;
  /** Tick at which the top item of the stack spoils; 0 for a stack that does not. */
  readonly spoilAt: Uint32Array;
  /** For a weapon: the ammunition it is set to take (content index, 0 for none yet) and the rounds in it. */
  readonly ammo: Uint16Array;
  readonly loaded: Uint8Array;
  /** For a weapon: the attachment fitted to it (content index), or 0. */
  readonly attach: Uint16Array;
  /** `version` at which each slot last changed, for sending only what a client lacks. */
  readonly mod: Uint32Array;
  version = 0;

  /** `bag` slots of bag; with `cap` larger, the rest is the hotbar and armor tail. */
  constructor(cap: number, bag = cap) {
    this.cap = cap;
    this.bag = bag;
    this.item = new Uint16Array(cap);
    this.count = new Uint16Array(cap);
    this.quality = new Uint8Array(cap);
    this.dur = new Uint16Array(cap);
    this.spoilAt = new Uint32Array(cap);
    this.ammo = new Uint16Array(cap);
    this.loaded = new Uint8Array(cap);
    this.attach = new Uint16Array(cap);
    this.mod = new Uint32Array(cap);
  }

  /** First hotbar slot, or -1 for an inventory with no equipment tail. */
  get hotbar(): number {
    return this.cap >= this.bag + GEAR_SLOTS ? this.bag : -1;
  }

  /** First armor slot, or -1. */
  get armor(): number {
    return this.cap >= this.bag + GEAR_SLOTS ? this.bag + HOTBAR_SLOTS : -1;
  }

  /** Overwrite a slot. Count 0 or item 0 empties it. What a weapon held (rounds, an attachment) is cleared: see `setGear`. */
  set(slot: number, item: number, count: number, quality: number, dur: number, spoilAt: number): void {
    const empty = item === 0 || count === 0;
    this.item[slot] = empty ? 0 : item;
    this.count[slot] = empty ? 0 : count;
    this.quality[slot] = empty ? 0 : quality;
    this.dur[slot] = empty ? 0 : dur;
    this.spoilAt[slot] = empty ? 0 : spoilAt;
    this.ammo[slot] = 0;
    this.loaded[slot] = 0;
    this.attach[slot] = 0;
    this.mod[slot] = ++this.version;
  }

  /** Set what the weapon in a slot holds. */
  setGear(slot: number, ammo: number, loaded: number, attach: number): void {
    this.ammo[slot] = ammo;
    this.loaded[slot] = loaded;
    this.attach[slot] = attach;
    this.mod[slot] = ++this.version;
  }

  /** The slot's durability changed. */
  setDur(slot: number, dur: number): void {
    this.dur[slot] = dur;
    this.mod[slot] = ++this.version;
  }

  /** Take `n` from a slot. The caller has checked there are that many. */
  remove(slot: number, n: number): void {
    const left = this.count[slot]! - n;
    if (left <= 0) this.set(slot, 0, 0, 0, 0, 0);
    else {
      this.count[slot] = left;
      this.mod[slot] = ++this.version;
    }
  }

  /** How many of `item` there are across all slots. */
  total(item: number): number {
    let n = 0;
    for (let s = 0; s < this.cap; s++) if (this.item[s] === item) n += this.count[s]!;
    return n;
  }

  used(): number {
    let n = 0;
    for (let s = 0; s < this.cap; s++) if (this.item[s] !== 0) n++;
    return n;
  }

  weight(t: ItemTable): number {
    let kg = 0;
    for (let s = 0; s < this.cap; s++) if (this.item[s] !== 0) kg += t.weight[this.item[s]!]! * this.count[s]!;
    return kg;
  }

  /** How many more of `item` would fit in the bag: room on matching stacks plus every empty slot. */
  room(item: number, quality: number, t: ItemTable): number {
    const stack = t.stack[item]!;
    let n = 0;
    for (let s = 0; s < this.bag; s++) {
      if (this.item[s] === 0) n += stack;
      // (A stack may hold more than the limit has since become: it has no room, not less than none.)
      else if (stack > this.count[s]! && this.item[s] === item && this.quality[s] === quality) n += stack - this.count[s]!;
    }
    return n;
  }

  /**
   * Add `n` of `item` to the bag, topping up matching stacks before using empty
   * slots. Returns how many did not fit. Items made now start their spoil clock at
   * `now`. Items that already existed (a transfer) bring their clock with
   * them as `spoilAt`: a new stack keeps it, and a stack they join becomes as
   * old as its oldest part. Moving food never makes it fresher.
   */
  add(item: number, n: number, quality: number, dur: number, now: number, t: ItemTable, spoilAt = 0): number {
    const stack = t.stack[item]!;
    if (stack === 0) return n;
    const spoil = t.spoilTicks[item]!;
    const clock = spoil === 0 ? 0 : spoilAt > 0 ? spoilAt : now + spoil;
    if (stack > 1) {
      for (let s = 0; s < this.bag && n > 0; s++) {
        if (this.item[s] !== item || this.quality[s] !== quality) continue;
        const fit = Math.min(n, stack - this.count[s]!);
        if (fit <= 0) continue;
        this.count[s] = this.count[s]! + fit;
        if (spoilAt > 0 && (this.spoilAt[s] === 0 || spoilAt < this.spoilAt[s]!)) this.spoilAt[s] = spoilAt;
        this.mod[s] = ++this.version;
        n -= fit;
      }
    }
    for (let s = 0; s < this.bag && n > 0; s++) {
      if (this.item[s] !== 0) continue;
      const fit = Math.min(n, stack);
      this.set(s, item, fit, quality, dur, clock);
      n -= fit;
    }
    return n;
  }

  /** The first empty bag slot, or -1. */
  free(): number {
    for (let s = 0; s < this.bag; s++) if (this.item[s] === 0) return s;
    return -1;
  }

  /** Remove `n` of `item` across slots, last slots first. All or nothing. */
  take(item: number, n: number): boolean {
    if (this.total(item) < n) return false;
    for (let s = this.cap - 1; s >= 0 && n > 0; s--) {
      if (this.item[s] !== item) continue;
      const k = Math.min(n, this.count[s]!);
      this.remove(s, k);
      n -= k;
    }
    return true;
  }

  /**
   * Apply spoilage up to `now`: each stack loses one item per interval since
   * its top item went bad. `lost` is told what disappeared. Calling this once
   * gives exactly what calling it every tick would.
   */
  settle(now: number, t: ItemTable, lost: (item: number, n: number) => void): void {
    for (let s = 0; s < this.cap; s++) {
      const at = this.spoilAt[s]!;
      if (at === 0 || at > now || this.item[s] === 0) continue;
      const item = this.item[s]!;
      const interval = t.spoilTicks[item]! || 1;
      const gone = Math.min(this.count[s]!, 1 + Math.floor((now - at) / interval));
      lost(item, gone);
      if (gone === this.count[s]) this.set(s, 0, 0, 0, 0, 0);
      else {
        this.count[s] = this.count[s]! - gone;
        this.spoilAt[s] = at + gone * interval;
        this.mod[s] = ++this.version;
      }
    }
  }
}

/**
 * Move up to `n` items (0 means the whole stack) from slot `sa` of `a` to slot
 * `sb` of `b`: into an empty slot, onto a matching stack, or, for a whole
 * stack onto a different one, by swapping. Returns how many moved; 0 means the
 * move was refused and nothing changed.
 */
export function moveSlot(a: Inventory, sa: number, b: Inventory, sb: number, n: number, t: ItemTable): number {
  if (sa >= a.cap || sb >= b.cap || (a === b && sa === sb)) return 0;
  const item = a.item[sa]!;
  const have = a.count[sa]!;
  if (item === 0) return 0;
  if (n === 0 || n > have) n = have;
  const other = b.item[sb]!;
  // An armor slot takes only what is worn there, and what comes back the other way must fit where it goes.
  if (!fitsSlot(b, sb, item, t) || (other !== 0 && other !== item && !fitsSlot(a, sa, other, t))) return 0;
  if (other === 0) {
    b.set(sb, item, n, a.quality[sa]!, a.dur[sa]!, a.spoilAt[sa]!);
    // One thing moved whole takes what it holds with it.
    if (n === have) b.setGear(sb, a.ammo[sa]!, a.loaded[sa]!, a.attach[sa]!);
    a.remove(sa, n);
    return n;
  }
  const stack = t.stack[item]!;
  if (other === item && stack > 1 && b.quality[sb] === a.quality[sa]) {
    const fit = Math.min(n, stack - b.count[sb]!);
    if (fit <= 0) return 0;
    // The joined stack spoils as its older part would have.
    const sp = a.spoilAt[sa]!;
    if (sp !== 0 && (b.spoilAt[sb] === 0 || sp < b.spoilAt[sb]!)) b.spoilAt[sb] = sp;
    b.count[sb] = b.count[sb]! + fit;
    b.mod[sb] = ++b.version;
    a.remove(sa, fit);
    return fit;
  }
  if (n !== have) return 0;
  const q = a.quality[sa]!;
  const d = a.dur[sa]!;
  const sp = a.spoilAt[sa]!;
  const ammo = a.ammo[sa]!;
  const loaded = a.loaded[sa]!;
  const attach = a.attach[sa]!;
  a.set(sa, other, b.count[sb]!, b.quality[sb]!, b.dur[sb]!, b.spoilAt[sb]!);
  a.setGear(sa, b.ammo[sb]!, b.loaded[sb]!, b.attach[sb]!);
  b.set(sb, item, have, q, d, sp);
  b.setGear(sb, ammo, loaded, attach);
  return have;
}

/** Whether `item` may be put in slot `slot` of `inv`: anything anywhere, except that an armor slot takes only its own kind of piece. */
export function fitsSlot(inv: Inventory, slot: number, item: number, t: ItemTable): boolean {
  const armor = inv.armor;
  return armor < 0 || slot < armor || t.wearSlot[item] === slot - armor;
}
