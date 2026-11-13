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

import type { BuffOn } from "./buffs.ts";
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

/** A run of one recipe: `left` units still to make, the current one finished at tick `doneAt`. */
export interface Job {
  recipe: number;
  left: number;
  doneAt: number;
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
  /** A survivor's look, as the character creator made it (shared/anim/look.ts); null for anything else. */
  look: Uint8Array | null = null;
  /** Which hotbar slot is in its hands, 0 to 9, or -1 for none. */
  held = -1;
  /** A survivor waiting to respawn. */
  dead = false;
  /** Tick at which a cache disappears with whatever is left in it; 0 for things that stay. */
  expiresAt = 0;
  /** Places this survivor should be able to find again, oldest first. */
  readonly markers: Marker[] = [];
  markersVersion = 0;
  /** Experience, learned engrams (content indices), and what is being crafted. */
  xp = 0;
  readonly engrams: number[] = [];
  readonly jobs: Job[] = [];
  /** Counts every change to the three above, for sending. */
  progVersion = 0;
  /**
   * The team that owns it: a survivor's own, a tribe's, or 0 for nobody (a
   * wild creature). A survivor alone is a team of one. `rank` is its standing
   * in a tribe; nothing reads it yet.
   */
  team = 0;
  rank = 0;
  /** What is acting on it for a time (server/buffs.ts). Not saved. `buffsVersion` counts every change, for sending. */
  readonly buffs: BuffOn[] = [];
  buffsVersion = 0;
  /** Unconscious: its torpor reached its most, and has not yet run out. */
  out = false;
  /**
   * For the state of something built (server/fixtures.ts): the structure it
   * is the state of, as a ref, or -1 for anything else. Then whether that is
   * locked (0: as its kind starts out, 1: locked, 2: unlocked) and its PIN (0
   * to 9999, or -1 for none).
   */
  at = -1;
  lock = 0;
  pin = -1;
  /**
   * For a creature lying unconscious and being tamed (server/taming.ts): the
   * affinity it has been given, the sum its effectiveness is made from, who
   * last looked into it (a persistent id: the tame will be theirs), and what
   * was last seen of its inventory and when it is next due to eat. Null for
   * anything else. And for a creature that has been tamed, how well: 0 to 1.
   */
  tame: { affinity: number; sum: number; by: number; seen: number; due: number } | null = null;
  te = 0;
  /**
   * For a creature that is somebody's: what it does about others (a STANCE_
   * of server/behavior.ts), whom it follows (a persistent id; 0: it stays),
   * and the tick it is next due to eat of what it carries (0: nothing set).
   */
  stance = 1;
  follow = 0;
  mealDue = 0;
  /** For a bed: the tick from which someone may next return to life at it. */
  readyAt = 0;
  /** For a fire that is burning: how far it has been worked out (shared/sim/station.ts), and the tick it is next due to be looked at. Null when it is out. */
  fire: { at: number; fuel: number; cook: number; due: number } | null = null;
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

  /** A new team id: from the same counter as records, so it is saved with it and never repeats. */
  newTeam(): number {
    return this.nextSeq++;
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
