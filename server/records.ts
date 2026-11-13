// Cold records: the slow-changing, valuable state of a persistent entity.
//
// The simulation's hot columns (position, velocity, flags) live in typed arrays
// and change every tick. Everything else about a survivor or creature (name,
// inventory, and later stat points, colours, ancestry, progression) lives here,
// changes only when a command or deadline touches it, and is what a save must
// never lose or duplicate.
//
// Records are keyed by persistent id and exist whether or not the entity is
// currently in the simulation (an offline survivor still has one).

import { makePid } from "../shared/ids.ts";

export class EntityRecord {
  readonly pid: number;
  /** Content index of the species. */
  kind: number;
  name = "";
  /** Last known position; refreshed from the simulation when saved. */
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  /** Item content index -> count. */
  readonly items = new Map<number, number>();
  /** Component blobs this build does not understand, kept byte for byte. */
  readonly extra = new Map<number, Uint8Array>();

  constructor(pid: number, kind: number) {
    this.pid = pid;
    this.kind = kind;
  }
}

export class Records {
  readonly worldId: number;
  readonly byPid = new Map<number, EntityRecord>();
  /** Live entity index for a pid, when it is in the simulation. */
  readonly entOf = new Map<number, number>();
  /** Records with changes that the next commit must include. */
  readonly dirty = new Set<number>();
  readonly deleted: number[] = [];
  nextSeq = 1;

  constructor(worldId: number) {
    this.worldId = worldId;
  }

  create(kind: number, name = ""): EntityRecord {
    const rec = new EntityRecord(makePid(this.worldId, this.nextSeq++), kind);
    rec.name = name;
    this.byPid.set(rec.pid, rec);
    this.dirty.add(rec.pid);
    return rec;
  }

  delete(pid: number): void {
    if (!this.byPid.delete(pid)) return;
    this.entOf.delete(pid);
    this.dirty.delete(pid);
    this.deleted.push(pid);
  }

  give(pid: number, item: number, count: number): void {
    const rec = this.byPid.get(pid)!;
    rec.items.set(item, (rec.items.get(item) ?? 0) + count);
    this.dirty.add(pid);
  }

  /**
   * Move items between two records. All or nothing; both records join the next
   * commit, so a crash can never save one side without the other.
   */
  transfer(from: number, to: number, item: number, count: number): boolean {
    const a = this.byPid.get(from);
    const b = this.byPid.get(to);
    if (!a || !b || from === to || !(count > 0) || !Number.isInteger(count)) return false;
    const have = a.items.get(item) ?? 0;
    if (have < count) return false;
    if (have === count) a.items.delete(item);
    else a.items.set(item, have - count);
    b.items.set(item, (b.items.get(item) ?? 0) + count);
    this.dirty.add(from);
    this.dirty.add(to);
    return true;
  }

  totalOf(item: number): number {
    let n = 0;
    for (const rec of this.byPid.values()) n += rec.items.get(item) ?? 0;
    return n;
  }
}
