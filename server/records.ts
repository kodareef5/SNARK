// Cold records hold everything about a persistent entity that is not a hot simulation column. They are keyed by
// persistent id and exist whether or not the entity is in the simulation.

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

/**
 * A run of making one item. `left` units remain, and the current one finishes at tick `doneAt`. The record a job is on gives
 * the ingredients and takes the product. `by` is the record id of the survivor who queued it at a station, who gets the
 * experience; it is absent for a job made in the hands. `bp` is the quality of the blueprint it is made from, absent for one
 * made from the engram.
 */
export interface Job {
  item: number;
  left: number;
  doneAt: number;
  by?: number;
  bp?: number;
}

export class EntityRecord {
  readonly pid: number;
  kind: number;
  name = "";
  /** Last known position, refreshed from the simulation when saved. */
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  /** Edited only through server/items.ts. Null until something is put in. */
  inv: Inventory | null = null;
  /** Owned by server/survival.ts. Null for bodies that have none. `vitalsDue` is the tick of their deadline, or 0. It is derived, not saved. */
  vitals: Vitals | null = null;
  vitalsDue = 0;
  genome: Genome | null = null;
  /** Hash of the device key that owns this survivor. Null until one claims it. */
  keyHash: Uint8Array | null = null;
  /** A survivor's look (shared/anim/look.ts). */
  look: Uint8Array | null = null;
  /** Hotbar slot in hand, 0 to 9, or -1 for none. */
  held = -1;
  /** A survivor waiting to respawn. */
  dead = false;
  /** Tick at which a cache disappears with its contents. 0 for records that stay. */
  expiresAt = 0;
  /** Oldest first. */
  readonly markers: Marker[] = [];
  markersVersion = 0;
  /** Experience, learned engrams (content indices), and crafting jobs. */
  xp = 0;
  readonly engrams: number[] = [];
  readonly jobs: Job[] = [];
  /** Counts every change to the three above, for sending. */
  progVersion = 0;
  /** The owning team: a survivor's own, a tribe's, or 0 for a wild creature. `rank` is its standing in a tribe. */
  team = 0;
  rank = 0;
  /** Timed effects (server/buffs.ts). `buffsVersion` counts every change, for sending, and is not saved. */
  readonly buffs: BuffOn[] = [];
  buffsVersion = 0;
  /** Unconscious. Its torpor reached the maximum and has not yet run out. */
  out = false;
  /**
   * For the state of a built structure (server/fixtures.ts). `at` is the structure's ref, or -1 for any other record.
   * `lock` is 0 for its kind's default, 1 for locked, 2 for unlocked. `pin` is 0 to 9999, or -1 for none.
   */
  at = -1;
  lock = 0;
  pin = -1;
  /**
   * For an unconscious creature being tamed (server/taming.ts): its affinity, the sum its effectiveness is made from,
   * the record id of the survivor who last opened it (the tame will be theirs), the inventory version last seen, and
   * the tick it is next due to eat. `te` is how well a tamed creature was tamed, 0 to 1.
   */
  tame: { affinity: number; sum: number; by: number; seen: number; due: number } | null = null;
  te = 0;
  /**
   * For an owned creature: a STANCE_ of server/behavior.ts, the record id it follows (0 to stay), whether it wanders (it
   * follows nobody then), and the tick it is next due to eat from what it carries (0 for none).
   */
  stance = 1;
  follow = 0;
  wander = false;
  mealDue = 0;
  /** Content index of its saddle, or 0. */
  saddle = 0;
  /**
   * A creature in its own flight (MODE_FLYER) when last saved, so that it loads in the air and does not fall
   * (planning/reference/flyers-plan.md, FL0). Refreshed from the simulation when saved, as the position is.
   */
  flying = false;
  /**
   * Breeding (server/breeding.ts). `mating` is whether an owned creature is willing to mate, and `mateReadyAt` the tick
   * from which a female may again (0 for now). `span` and `grown` are the ticks growing takes and the tick it ends,
   * both 0 for one that is grown. `growDue` is the tick it is next a hundredth more grown. It is derived, not saved.
   */
  mating = false;
  mateReadyAt = 0;
  span = 0;
  grown = 0;
  growDue = 0;
  /**
   * For an egg: the species that hatches (a content index), the ticks hatching takes, the tick it hatches, and the record
   * id of a mother carrying unborn young (0 for a laid egg). The hatchling gets this record's genome. An egg held as an
   * item is carried by itself, and its hatchAt is the ticks it has left; an unfertilised one has no genome and span 0
   * (server/breeding.ts, server/eggs.ts).
   */
  egg: { species: number; span: number; hatchAt: number; carrier: number } | null = null;
  /**
   * For a creature's body (server/corpses.ts): the species it was (a content index), the harvest damage it takes in all and
   * what is left of that, its size as its entity's span, whether it was young and whether it died knocked out, and the ticks
   * its whole time lasts.
   */
  corpse: { species: number; max: number; left: number; span: number; young: boolean; out: boolean; life: number } | null = null;
  /** For a bed, the tick from which a survivor may next respawn at it. */
  readyAt = 0;
  /** For a burning fire: its state as of tick `at` (shared/sim/station.ts), and the tick of its deadline. Null when it is out. */
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

  /** Team ids come from the record counter, so they are saved with it and never repeat. */
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
