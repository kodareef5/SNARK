// Inventories: fixed-capacity slot tables.
//
// A slot holds a stack: an item, a count, and for things that do not stack a
// quality and a durability. Nothing here ticks. Spoilage is stored as the tick
// at which the stack's top item goes bad, so time passing costs nothing, and
// `settle` works out in one step how many have gone since anyone last looked.
//
// The server edits inventories only through server/items.ts, which keeps the
// ledger. The client holds mirrors filled from slot deltas.

/** Per content index: what the item model needs to know about each item. */
export interface ItemTable {
  /** Largest stack; 0 for content that is not an item. */
  readonly stack: Uint16Array;
  /** Kilograms each. */
  readonly weight: Float32Array;
  /** Ticks one item lasts; 0 for items that do not spoil. */
  readonly spoilTicks: Uint32Array;
}

export class Inventory {
  readonly cap: number;
  /** Content index; 0 is an empty slot. */
  readonly item: Uint16Array;
  readonly count: Uint16Array;
  readonly quality: Uint8Array;
  readonly dur: Uint16Array;
  /** Tick at which the top item of the stack spoils; 0 for a stack that does not. */
  readonly spoilAt: Uint32Array;
  /** `version` at which each slot last changed, for sending only what a client lacks. */
  readonly mod: Uint32Array;
  version = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.item = new Uint16Array(cap);
    this.count = new Uint16Array(cap);
    this.quality = new Uint8Array(cap);
    this.dur = new Uint16Array(cap);
    this.spoilAt = new Uint32Array(cap);
    this.mod = new Uint32Array(cap);
  }

  /** Overwrite a slot. Count 0 or item 0 empties it. */
  set(slot: number, item: number, count: number, quality: number, dur: number, spoilAt: number): void {
    const empty = item === 0 || count === 0;
    this.item[slot] = empty ? 0 : item;
    this.count[slot] = empty ? 0 : count;
    this.quality[slot] = empty ? 0 : quality;
    this.dur[slot] = empty ? 0 : dur;
    this.spoilAt[slot] = empty ? 0 : spoilAt;
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

  /** How many more of `item` would fit: room on matching stacks plus every empty slot. */
  room(item: number, quality: number, t: ItemTable): number {
    const stack = t.stack[item]!;
    let n = 0;
    for (let s = 0; s < this.cap; s++) {
      if (this.item[s] === 0) n += stack;
      else if (stack > 1 && this.item[s] === item && this.quality[s] === quality) n += stack - this.count[s]!;
    }
    return n;
  }

  /**
   * Add `n` of `item`, topping up matching stacks before using empty slots.
   * Returns how many did not fit. Items made now start their spoil clock at
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
      for (let s = 0; s < this.cap && n > 0; s++) {
        if (this.item[s] !== item || this.quality[s] !== quality) continue;
        const fit = Math.min(n, stack - this.count[s]!);
        if (fit <= 0) continue;
        this.count[s] = this.count[s]! + fit;
        if (spoilAt > 0 && (this.spoilAt[s] === 0 || spoilAt < this.spoilAt[s]!)) this.spoilAt[s] = spoilAt;
        this.mod[s] = ++this.version;
        n -= fit;
      }
    }
    for (let s = 0; s < this.cap && n > 0; s++) {
      if (this.item[s] !== 0) continue;
      const fit = Math.min(n, stack);
      this.set(s, item, fit, quality, dur, clock);
      n -= fit;
    }
    return n;
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
  if (other === 0) {
    b.set(sb, item, n, a.quality[sa]!, a.dur[sa]!, a.spoilAt[sa]!);
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
  a.set(sa, other, b.count[sb]!, b.quality[sb]!, b.dur[sb]!, b.spoilAt[sb]!);
  b.set(sb, item, have, q, d, sp);
  return have;
}
