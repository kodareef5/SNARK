// Cold records hold everything about a persistent entity that is not a hot simulation column. They are keyed by
// persistent id and exist whether or not the entity is in the simulation.

import type { BuffOn } from "./buffs.ts";
import { makePid } from "../shared/ids.ts";
import type { Genome } from "../shared/sim/genome.ts";
import type { Fire } from "../shared/sim/station.ts";
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
 * made from the engram. `rest` is the ticks left of the unit under way when its powered station went out, absent for a job
 * that is not waiting for fuel (planning/reference/stations-plan.md, M5: kept and saved, set by nothing until S2).
 */
export interface Job {
  item: number;
  left: number;
  doneAt: number;
  by?: number;
  bp?: number;
  rest?: number;
}

/**
 * A burning fire's state (shared/sim/station.ts), with what the server derives from it and does not save: the tick of its
 * deadline, and the tick it is due to go out on what lies in it (0 until worked out), which OWN_STATION tells.
 */
export interface FireState extends Fire {
  due: number;
  out: number;
}

/**
 * A feature's own state on a record, in place of a field on EntityRecord. The feature declares one in its own file,
 * `export const ISSUED = part(() => ({ to: 0 }))`: `rec.part(ISSUED)` is that state, or undefined for a record that has
 * none, and `rec.own(ISSUED)` makes it. What of it is saved is a component declared beside it (server/saved.ts).
 */
export class Part<S> {
  /** Its place among a record's parts: the order parts were declared in on this run, which nothing saves. */
  readonly at: number;
  readonly make: () => S;

  constructor(at: number, make: () => S) {
    this.at = at;
    this.make = make;
  }
}

let parts = 0;

/** Declares a feature's state. `make` gives a record's own, as it is before the feature has set any of it. */
export function part<S>(make: () => S): Part<S> {
  return new Part(parts++, make);
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
   * For a tame kept in a soul ball (server/balls.ts): the tick it was kept, 0 for any other record. A kept tame has no body
   * and its time stands still: every tick it holds is as of this one, and is moved on by the time it was kept when it is
   * loosed (rebaseTicks). The full ball that holds it names this record (Inventory.ref).
   */
  stored = 0;
  jetSpent = 0;
  /** Selected ground-combat plate mode; transient attacks are never saved. */
  creatureMode = 0;
  /**
   * A creature in its own flight (MODE_FLYER) when last saved, so that it loads in the air and does not fall
   * (planning/reference/flyers-plan.md, FL0). Refreshed from the simulation when saved, as the position is.
   */
  flying = false;
  /**
   * Breeding (server/breeding.ts). `mating` is whether an owned creature is willing to mate. `span` and `grown` are the
   * ticks growing takes and the tick it ends, both 0 for one that is grown. `growDue` is the tick it is next a hundredth
   * more grown. It is derived, not saved.
   */
  mating = false;
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
   * what is left of that, its size as its entity's span, whether it was young, died knocked out or died in its own flight,
   * and the ticks its whole time lasts.
   */
  corpse: { species: number; max: number; left: number; span: number; young: boolean; out: boolean; air: boolean; life: number } | null = null;
  /** For a bed, the tick from which a survivor may next respawn at it. */
  readyAt = 0;
  /** For a burning fire: its state as of tick `at` (shared/sim/station.ts), and the tick of its deadline. Null when it is out. */
  fire: FireState | null = null;
  /** Component blobs this build does not understand, kept byte for byte. */
  readonly extra = new Map<number, Uint8Array>();
  /** Features' own state, by Part.at. Null until a feature makes some. */
  private parts: unknown[] | null = null;

  constructor(pid: number, kind: number) {
    this.pid = pid;
    this.kind = kind;
  }

  /** A feature's state on this record, or undefined where it has none. */
  part<S>(of: Part<S>): S | undefined {
    const parts = this.parts;
    return parts === null ? undefined : (parts[of.at] as S | undefined);
  }

  /** A feature's state on this record, made the first time it is asked for and the same object ever after. */
  own<S>(of: Part<S>): S {
    const parts = (this.parts ??= []);
    while (parts.length <= of.at) parts.push(undefined);
    return (parts[of.at] ??= of.make()) as S;
  }
}

/** Bytes of the SHA-256 of a device key that a survivor record keeps. */
const KEY_HASH_BYTES = 16;

/** What a survivor record keeps of the device key that owns it (EntityRecord.keyHash). */
export function hashKey(key: Uint8Array): Uint8Array {
  return new Bun.CryptoHasher("sha256").update(key).digest().slice(0, KEY_HASH_BYTES);
}

/**
 * Team numbers each world makes. A world's are its id times this plus a count of its own, so a team means the same on every
 * server of a cluster and a survivor keeps its team as it travels.
 */
export const TEAM_RANGE = 1 << 20;
/** A team number is 32 bits, so this is the highest world id that can make teams. */
export const MAX_TEAM_WORLD = 4095;

export class Records {
  readonly worldId: number;
  readonly byPid = new Map<number, EntityRecord>();
  /** Live entity index for a pid, when it is in the simulation. */
  readonly entOf = new Map<number, number>();
  /** Records with changes that the next commit must include. */
  readonly dirty = new Set<number>();
  readonly deleted: number[] = [];
  nextSeq = 1;
  /** Teams made, saved with the record counter. */
  nextTeam = 1;

  constructor(worldId: number) {
    this.worldId = worldId;
  }

  /** Never repeats, here or on another world of a cluster. */
  newTeam(): number {
    if (this.nextTeam >= TEAM_RANGE || this.worldId > MAX_TEAM_WORLD) throw new Error(`world ${this.worldId} has made all the teams it can`);
    return this.worldId * TEAM_RANGE + this.nextTeam++;
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

  /** Puts a record in that came from elsewhere. One deleted since the last commit is written again, not deleted. */
  put(rec: EntityRecord): void {
    this.byPid.set(rec.pid, rec);
    for (let i = this.deleted.indexOf(rec.pid); i >= 0; i = this.deleted.indexOf(rec.pid)) this.deleted.splice(i, 1);
    this.dirty.add(rec.pid);
  }
}
