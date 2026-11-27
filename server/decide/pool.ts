// A small pool of slots for the movers the decider minds closely: those in trouble, in a chase or in flight. A point
// keeps what it remembers of a mover (its last rings, its trail, the headings it tried) in arrays of its own, by slot.
// When the pool is full the slot used longest ago is taken.

export class Pool {
  readonly size: number;
  /** The entity in each slot (-1 free), its generation, and the tick it was last used. */
  readonly ent: Int32Array;
  readonly gen: Int32Array;
  readonly used: Int32Array;
  /** Slots taken from a mover still using one, since the start. */
  taken = 0;
  private slotOf: Int32Array;

  constructor(size = 1024, entities = 4096) {
    this.size = size;
    this.ent = new Int32Array(size).fill(-1);
    this.gen = new Int32Array(size);
    this.used = new Int32Array(size);
    this.slotOf = new Int32Array(entities).fill(-1);
  }

  /** The slot of entity `e` of generation `gen`, or -1. */
  find(e: number, gen: number): number {
    const s = e < this.slotOf.length ? this.slotOf[e]! : -1;
    return s >= 0 && this.ent[s] === e && this.gen[s] === gen ? s : -1;
  }

  /** The slot of `e`, given one if it has none. `fresh` is called with a slot newly given, to clear what a point keeps there. */
  hold(e: number, gen: number, tick: number, fresh: (slot: number) => void): number {
    let s = this.find(e, gen);
    if (s < 0) {
      // An entity's number that came round again with a new generation takes over its old slot: left there it would be
      // held twice, and the living mover would lose its slot when the dead one's was taken.
      const mine = e < this.slotOf.length ? this.slotOf[e]! : -1;
      s = mine >= 0 && this.ent[mine] === e ? mine : this.oldest();
      const was = this.ent[s]!;
      if (was >= 0 && was !== e) {
        this.slotOf[was] = -1;
        this.taken++;
      }
      if (e >= this.slotOf.length) {
        const wider = new Int32Array(Math.max(e + 1, this.slotOf.length * 2)).fill(-1);
        wider.set(this.slotOf);
        this.slotOf = wider;
      }
      this.slotOf[e] = s;
      this.ent[s] = e;
      this.gen[s] = gen;
      fresh(s);
    }
    this.used[s] = tick;
    return s;
  }

  /** Gives up the slot of `e`, if it has one. */
  drop(e: number): void {
    const s = e < this.slotOf.length ? this.slotOf[e]! : -1;
    if (s < 0 || this.ent[s] !== e) return;
    this.slotOf[e] = -1;
    this.ent[s] = -1;
  }

  /** Slots in use. */
  count(): number {
    let n = 0;
    for (let s = 0; s < this.size; s++) if (this.ent[s]! >= 0) n++;
    return n;
  }

  private oldest(): number {
    let best = 0, at = Infinity;
    for (let s = 0; s < this.size; s++) {
      if (this.ent[s]! < 0) return s;
      if (this.used[s]! < at) {
        at = this.used[s]!;
        best = s;
      }
    }
    return best;
  }
}
