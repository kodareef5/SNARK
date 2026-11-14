// A structure with state (a lock, a PIN, an inventory) has a record whose `at` is its ref, made the first time there is
// something to remember. Whoever removes a structure asks here for its record and decides what becomes of it.

import type { Rules } from "./settings/rules.ts";
import type { ItemDef } from "../shared/content/defs.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export class Fixtures {
  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly items: Items;
  private readonly byRef = new Map<number, number>();
  rules: Rules | null = null;

  constructor(world: ServerWorld, records: Records, items: Items) {
    this.world = world;
    this.records = records;
    this.items = items;
  }

  each(visit: (ref: number, rec: EntityRecord) => void): void {
    for (const [ref, pid] of this.byRef) {
      const rec = this.records.byPid.get(pid);
      if (rec) visit(ref, rec);
    }
  }

  get count(): number {
    return this.byRef.size;
  }

  /** Call after a load. Deletes a record whose structure is gone or already has one, and burns what it held through the ledger. */
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

  find(ref: number): EntityRecord | null {
    const pid = this.byRef.get(ref);
    return pid === undefined ? null : (this.records.byPid.get(pid) ?? null);
  }

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

  /** Unbinds the record of a structure that is going and returns it. The caller decides what becomes of it. */
  release(ref: number): EntityRecord | null {
    const rec = this.find(ref);
    this.byRef.delete(ref);
    if (rec) rec.at = -1;
    return rec;
  }

  /** Binds a released record to the structure now at `ref`, the same piece set down somewhere else. */
  bind(rec: EntityRecord, ref: number): void {
    const t = this.world.structs.chunks[Math.floor(ref / 65536)]!;
    rec.x = t.x[ref & 0xffff]!;
    rec.y = t.y[ref & 0xffff]!;
    rec.z = t.z[ref & 0xffff]!;
    rec.at = ref;
    this.byRef.set(ref, rec.pid);
    this.records.dirty.add(rec.pid);
  }

  /** With no lock set on its record, the kind's default applies. */
  locked(ref: number): boolean {
    const lock = this.find(ref)?.lock ?? 0;
    return lock === 1 || (lock === 0 && (this.world.reg.lockedAtFirst[this.kindAt(ref)] === 1 || (this.rules?.on("ForceAllStructureLocking") ?? false)));
  }
}
