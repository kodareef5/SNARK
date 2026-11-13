// Cold records: the slow-changing, valuable state of a persistent entity.
//
// The simulation's hot columns (position, velocity, flags) live in typed arrays
// and change every tick. Everything else about a survivor or creature (name,
// inventory, vitals, stat points, colours, ancestry, progression) lives here,
// changes only when a command or deadline touches it, and is what a save must
// never lose or duplicate.
//
// Records are keyed by persistent id and exist whether or not the entity is
// currently in the simulation (an offline survivor still has one).

import { makePid } from "../shared/ids.ts";
import type { Genome } from "../shared/sim/genome.ts";
import type { Inventory } from "../shared/sim/items.ts";
import type { Vitals } from "../shared/sim/vitals.ts";

export interface Marker {
  kind: number;
  x: number;
  y: number;
  z: number;
  tick: number;
}

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
  /** What it carries. Edited only through server/items.ts; null until something is put in. */
  inv: Inventory | null = null;
  /** Health, food, water, oxygen; null for bodies that have none. Owned by server/survival.ts. */
  vitals: Vitals | null = null;
  /** Stat points, colours and ancestry; null for bodies that have none. */
  genome: Genome | null = null;
  /** Hash of the device key that owns this survivor; null until one claims it. */
  keyHash: Uint8Array | null = null;
  /** A survivor waiting to respawn. */
  dead = false;
  /** Tick at which a cache disappears with whatever is left in it; 0 for things that stay. */
  expiresAt = 0;
  /** Places this survivor should be able to find again, oldest first. */
  readonly markers: Marker[] = [];
  markersVersion = 0;
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
}
