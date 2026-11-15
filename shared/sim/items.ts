// Fixed-capacity slot tables. Nothing ticks. A stack stores the tick its top item spoils, and `settle` applies the loss in one step.
// The server edits inventories only through server/items.ts, which keeps the ledger. The client holds mirrors filled from slot deltas.

export const HOTBAR_SLOTS = 10;
/** One per body slot, in the order of shared/anim/human.ts: head, torso, hands, legs, feet. */
export const ARMOR_SLOTS = 5;
export const GEAR_SLOTS = HOTBAR_SLOTS + ARMOR_SLOTS;

/** Lowest first. QUALITY_MUL multiplies the values in an item's definition. */
export const QUALITY_NAMES: readonly string[] = ["primitive", "ramshackle", "apprentice", "journeyman", "mastercraft", "ascendant"];
export const QUALITY_MUL: readonly number[] = [1, 1.2, 1.45, 1.75, 2.1, 2.6];

/** Indexed by content index. */
export interface ItemTable {
  /** Largest stack. 0 for content that is not an item. */
  readonly stack: Uint16Array;
  /** Kilograms each. */
  readonly weight: Float32Array;
  /** Ticks one item lasts. 0 for items that do not spoil. */
  readonly spoilTicks: Uint32Array;
  /** The armor slot an item is worn in (0 to 4), or -1 for anything not worn. */
  readonly wearSlot: Int8Array;
}

export class Inventory {
  readonly cap: number;
  /** Slots below `bag` are the bag. When `cap` is larger, the hotbar and then the armor slots follow, and `add` never fills those. */
  readonly bag: number;
  /** Content index. 0 is an empty slot. */
  readonly item: Uint16Array;
  readonly count: Uint16Array;
  readonly quality: Uint8Array;
  readonly dur: Uint16Array;
  /** Tick at which the stack's top item spoils. 0 for a stack that does not. */
  readonly spoilAt: Uint32Array;
  /** For a weapon: the ammunition it takes (content index, 0 for none yet) and the rounds in it. The ledger counts those rounds as items. */
  readonly ammo: Uint16Array;
  readonly loaded: Uint8Array;
  /** For a weapon: its attachment (content index), or 0. */
  readonly attach: Uint16Array;
  /** `version` at which each slot last changed, for sending only what a client lacks. */
  readonly mod: Uint32Array;
  version = 0;
  /** How many times as long things keep here before they spoil. Whoever holds the inventory sets it (server/items.ts). */
  keep = 1;
  /**
   * For an item that is one of a kind (a fertilised egg): the record it stands for, by pid, or 0. Such an item stacks to 1,
   * moves with its slot and is never sent. Null until a slot has one.
   */
  ref: Float64Array | null = null;

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

  /** Count 0 or item 0 empties the slot. Also clears ammo, loaded and attach, which setGear sets. */
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
    if (this.ref) this.ref[slot] = 0;
    this.mod[slot] = ++this.version;
  }

  refOf(slot: number): number {
    return this.ref ? this.ref[slot]! : 0;
  }

  setRef(slot: number, pid: number): void {
    if (pid === 0 && !this.ref) return;
    this.ref ??= new Float64Array(this.cap);
    this.ref[slot] = pid;
  }

  setGear(slot: number, ammo: number, loaded: number, attach: number): void {
    this.ammo[slot] = ammo;
    this.loaded[slot] = loaded;
    this.attach[slot] = attach;
    this.mod[slot] = ++this.version;
  }

  setDur(slot: number, dur: number): void {
    this.dur[slot] = dur;
    this.mod[slot] = ++this.version;
  }

  /** The caller has checked the slot holds `n`. */
  remove(slot: number, n: number): void {
    const left = this.count[slot]! - n;
    if (left <= 0) this.set(slot, 0, 0, 0, 0, 0);
    else {
      this.count[slot] = left;
      this.mod[slot] = ++this.version;
    }
  }

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
    for (let s = 0; s < this.cap; s++) {
      if (this.item[s] === 0) continue;
      kg += t.weight[this.item[s]!]! * this.count[s]!;
      if (this.loaded[s]! > 0) kg += t.weight[this.ammo[s]!]! * this.loaded[s]!;
      if (this.attach[s] !== 0) kg += t.weight[this.attach[s]!]!;
    }
    return kg;
  }

  /** Counts the bag only. */
  room(item: number, quality: number, t: ItemTable): number {
    const stack = t.stack[item]!;
    let n = 0;
    for (let s = 0; s < this.bag; s++) {
      if (this.item[s] === 0) n += stack;
      // A stack may hold more than a stack limit that has since shrunk. It then has no room, not negative room.
      else if (stack > this.count[s]! && this.item[s] === item && this.quality[s] === quality) n += stack - this.count[s]!;
    }
    return n;
  }

  /**
   * Fills the bag only, matching stacks before empty slots. Returns how many did not fit. New items start their spoil clock at
   * `now`. Transferred items bring theirs as `spoilAt`, and a stack they join becomes as old as its oldest part, so moving food
   * never makes it fresher.
   */
  add(item: number, n: number, quality: number, dur: number, now: number, t: ItemTable, spoilAt = 0): number {
    const stack = t.stack[item]!;
    if (stack === 0) return n;
    const spoil = t.spoilTicks[item]!;
    const clock = spoil === 0 ? 0 : spoilAt > 0 ? spoilAt : clock32(now + Math.round(spoil * this.keep));
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

  /** Last slots first. All or nothing. */
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
   * Applies spoilage up to `now`. Each stack loses one item per interval since its top item went bad, and `lost` gets what
   * disappeared, with the record a one of a kind stood for and the tick the first of them went bad, from which what it
   * spoils into starts its own clock (server/items.ts). One call gives exactly what a call every tick would.
   */
  settle(now: number, t: ItemTable, lost: (item: number, n: number, ref: number, at: number) => void): void {
    for (let s = 0; s < this.cap; s++) {
      const at = this.spoilAt[s]!;
      if (at === 0 || at > now || this.item[s] === 0) continue;
      const item = this.item[s]!;
      const interval = Math.round(t.spoilTicks[item]! * this.keep) || 1;
      const gone = Math.min(this.count[s]!, 1 + Math.floor((now - at) / interval));
      lost(item, gone, this.refOf(s), at);
      if (gone === this.count[s]) this.set(s, 0, 0, 0, 0, 0);
      else {
        this.count[s] = this.count[s]! - gone;
        this.spoilAt[s] = clock32(at + gone * interval);
        this.mod[s] = ++this.version;
      }
    }
  }
}

/** A spoil clock holds 32 bits. */
function clock32(at: number): number {
  return at > 0xffffffff ? 0xffffffff : at;
}

/**
 * The spoil clock `at` as it is in an inventory that keeps things `to` times as long, coming from one that keeps them
 * `from` times: what it had left at `now` is scaled, and rounded down so that moving food never makes it fresher.
 */
export function carried(at: number, now: number, from: number, to: number): number {
  if (at === 0 || from === to || at <= now) return at;
  return clock32(now + Math.floor(((at - now) * to) / from));
}

/**
 * Moves up to `n` items (0 means the whole stack) into an empty slot or onto a matching stack. A whole stack moved onto a
 * different item swaps with it. Returns how many moved. 0 means the move was refused and nothing changed. `now` is needed
 * only between inventories that keep things for different times.
 */
export function moveSlot(a: Inventory, sa: number, b: Inventory, sb: number, n: number, t: ItemTable, now = 0): number {
  if (sa >= a.cap || sb >= b.cap || (a === b && sa === sb)) return 0;
  const item = a.item[sa]!;
  const have = a.count[sa]!;
  if (item === 0) return 0;
  if (n === 0 || n > have) n = have;
  const other = b.item[sb]!;
  // An armor slot takes only its own kind of piece, and an item swapped back must fit its slot too.
  if (!fitsSlot(b, sb, item, t) || (other !== 0 && other !== item && !fitsSlot(a, sa, other, t))) return 0;
  const sp = carried(a.spoilAt[sa]!, now, a.keep, b.keep);
  const ref = a.refOf(sa);
  if (other === 0) {
    b.set(sb, item, n, a.quality[sa]!, a.dur[sa]!, sp);
    // A weapon moved whole keeps its rounds and attachment, and a one of a kind what it stands for.
    if (n === have) {
      b.setGear(sb, a.ammo[sa]!, a.loaded[sa]!, a.attach[sa]!);
      b.setRef(sb, ref);
    }
    a.remove(sa, n);
    return n;
  }
  const stack = t.stack[item]!;
  if (other === item && stack > 1 && b.quality[sb] === a.quality[sa]) {
    const fit = Math.min(n, stack - b.count[sb]!);
    if (fit <= 0) return 0;
    // The joined stack spoils as its older part would have.
    if (sp !== 0 && (b.spoilAt[sb] === 0 || sp < b.spoilAt[sb]!)) b.spoilAt[sb] = sp;
    b.count[sb] = b.count[sb]! + fit;
    b.mod[sb] = ++b.version;
    a.remove(sa, fit);
    return fit;
  }
  if (n !== have) return 0;
  const q = a.quality[sa]!;
  const d = a.dur[sa]!;
  const ammo = a.ammo[sa]!;
  const loaded = a.loaded[sa]!;
  const attach = a.attach[sa]!;
  const otherRef = b.refOf(sb);
  a.set(sa, other, b.count[sb]!, b.quality[sb]!, b.dur[sb]!, carried(b.spoilAt[sb]!, now, b.keep, a.keep));
  a.setGear(sa, b.ammo[sb]!, b.loaded[sb]!, b.attach[sb]!);
  a.setRef(sa, otherRef);
  b.set(sb, item, have, q, d, sp);
  b.setGear(sb, ammo, loaded, attach);
  b.setRef(sb, ref);
  return have;
}

/** Any slot takes any item, except that an armor slot takes only its own kind of piece. */
export function fitsSlot(inv: Inventory, slot: number, item: number, t: ItemTable): boolean {
  const armor = inv.armor;
  return armor < 0 || slot < armor || t.wearSlot[item] === slot - armor;
}
