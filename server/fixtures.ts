// Things built that have state.
//
// A plain piece is a row and nothing more. A door that has been locked, a box
// with things in it, a vault: each has a record besides, which says which row
// it is the state of (`at`, a ref) and holds the lock, the PIN and the
// inventory. The record is made the first time there is something to
// remember and not before, so a wall costs what it always did.
//
// The rows know nothing of this. Whoever removes a structure asks here for
// its record and decides what becomes of it (server/build.ts).

import type { ItemDef } from "../shared/content/defs.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export class Fixtures {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly byRef = new Map<number, number>();

  constructor(world: ServerWorld, records: Records, items: Items) {
    this.world = world;
    this.records = records;
    this.items = items;
  }

  /** How many things built have state. */
  get count(): number {
    return this.byRef.size;
  }

  /**
   * After a load: find every record that is the state of something built. One
   * whose structure is not there any more is deleted, with whatever it held,
   * on the books.
   */
  index(): void {
    this.byRef.clear();
    for (const rec of [...this.records.byPid.values()]) {
      if (rec.at < 0) continue;
      if (this.kindAt(rec.at) === 0 || this.byRef.has(rec.at)) {
        if (rec.inv) this.items.burnAll(rec);
        this.records.delete(rec.pid);
      } else this.byRef.set(rec.at, rec.pid);
    }
  }

  private kindAt(ref: number): number {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    return t && slot < t.high ? t.kind[slot]! : 0;
  }

  /** The record of the structure at `ref`, or null if it has none. */
  find(ref: number): EntityRecord | null {
    const pid = this.byRef.get(ref);
    return pid === undefined ? null : (this.records.byPid.get(pid) ?? null);
  }

  /** The record of the structure at `ref`, made now if it had none. */
  ensure(ref: number): EntityRecord {
    const known = this.find(ref);
    if (known) return known;
    const kind = this.kindAt(ref);
    const reg = this.world.reg;
    const item = reg.pieceItem[kind]!;
    const rec = this.records.create(kind, item !== 0 ? ((reg.defs[item] as ItemDef).label ?? "") : "");
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    rec.x = t.x[ref & 0xffff]!;
    rec.y = t.y[ref & 0xffff]!;
    rec.z = t.z[ref & 0xffff]!;
    rec.team = t.owner[ref & 0xffff]!;
    rec.at = ref;
    this.byRef.set(ref, rec.pid);
    return rec;
  }

  /** The structure at `ref` is going: its record, if it has one, is no longer anything's. The caller decides what becomes of it. */
  release(ref: number): EntityRecord | null {
    const rec = this.find(ref);
    this.byRef.delete(ref);
    if (rec) rec.at = -1;
    return rec;
  }

  /** A record that was released is the state of the structure now at `ref` (the same thing, somewhere else). */
  bind(rec: EntityRecord, ref: number): void {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    rec.x = t.x[ref & 0xffff]!;
    rec.y = t.y[ref & 0xffff]!;
    rec.z = t.z[ref & 0xffff]!;
    rec.at = ref;
    this.byRef.set(ref, rec.pid);
    this.records.dirty.add(rec.pid);
  }

  /** Whether the structure at `ref` is locked: as its record says, or if that says nothing, as its kind starts out. */
  locked(ref: number): boolean {
    const lock = this.find(ref)?.lock ?? 0;
    return lock === 1 || (lock === 0 && this.world.reg.lockedAtFirst[this.kindAt(ref)] === 1);
  }
}
