// A record as bytes: the form a save keeps it in, and the form it travels in between servers (server/cluster/parcel.ts).
// Content is written as an index into a table of content ids that goes with the bytes, never as a build's own index.

import { JET_CAPACITY } from "../../shared/sim/character.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { COLOR_REGIONS, Genome, STAT_COUNT } from "../../shared/sim/genome.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import { validLook } from "../../shared/anim/look.ts";
import type { Lane } from "../../shared/sim/station.ts";
import { EntityRecord, type FireState, type Job } from "../records.ts";
import { SAVED, savedAs, type Coding } from "../saved.ts";

/** The revision of a record's parts, in its first byte. Raise it whenever a part changes: a build reads only its own. */
const RECORD_FORMAT = 7;
// A record is a list of components, each an id and a length-prefixed blob. A build that does not know a
// component keeps its bytes and writes them back, so a save survives a server that lacks a content pack.
const COMP_GENOME = 3;
const COMP_IDENTITY = 6;
const COMP_MARKERS = 5;
/** Dead flag, expiry tick, the hotbar slot in hand, and whether it flies. */
const COMP_STATE = 9;
/** The bytes of shared/anim/look.ts. */
const COMP_LOOK = 10;
/** The inventory's size and bag, then each slot with what a weapon holds and its flags (FLAG_ bits, shared/sim/items.ts). */
const COMP_SLOTS3 = 22;
/** The vitals with 53-bit values and tick, and whether the body is unconscious. */
const COMP_VITALS53 = 17;
const COMP_TEAM = 13;
/** How well a tamed creature was tamed and, for one being tamed, what it has been given so far and for whom. */
const COMP_TAME = 15;
/**
 * Breeding: mating state, a young one's growing and an egg's hatching. Each timer is a span and an end tick, never a
 * start, because growing made slower part way through would put the start before the world began (D92).
 */
const COMP_BREED2 = 18;
/** The ref of the structure it belongs to, whether it is locked, and its PIN plus one. */
const COMP_FIXTURE = 14;
/** Experience, learned engrams, crafting jobs. */
const COMP_PROGRESSION = 4;
/** The buffs on it (server/buffs.ts): each one's content, the tick it ends, who gave it and the torpor a second it adds, then, if any adds health, the health a second each adds. */
const COMP_BUFFS = 19;
/** The slots of its inventory that stand for a record (Inventory.ref): each slot and that record's pid. */
const COMP_REFS = 20;
/** A creature's body (EntityRecord.corpse). A build without bodies has no core:corpse either, so it never passes over one. */
const COMP_CORPSE = 21;
/** Persistent ground creature mode; unknown builds preserve this component. */
const COMP_CREATURE_MODE = 23;
const COMP_JET_SPENT = 24;
// Components a feature declares in its own file (server/saved.ts) are not listed here: 25 a kept tame's mark
// (server/balls.ts), 26 a starter mount's (server/mount.ts).
// Components kept in rec.extra by other parts of the server, numbered apart from these: 83 a survivor's activity
// (server/survivor-activity.ts), 90 the Cast person a body is (server/cast/host.ts).
/** The most bytes of one part that a save holds. */
const MAX_PART = 1 << 20;
const NO_BYTES = new Uint8Array(0);
/** How an operator goes on from a save that uses content the build lacks. */
export const WITHOUT = "start with the content it was made with, or with --allow-missing-content to go on without what is made of it, which is then dropped for good";

/** A record as a save's row holds it. `kind` is an index into the table the bytes were written with. */
export interface RecordRow {
  pid: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  data: Uint8Array;
}

/**
 * How a table of content ids written with some bytes reads in this build. `runtime` maps each written index to this build's,
 * 0 for content it lacks, which `lost` names. An id renamed to more than one thing is read as the first, and `split` says all.
 */
export interface IdMap {
  runtime: Uint16Array;
  lost: Map<number, string>;
  split: Map<number, readonly number[]>;
}

/** `table` lists the written index of each id. */
export function idMap(reg: Registry, table: Iterable<[string, number]>, high: number): IdMap {
  const runtime = new Uint16Array(high + 1);
  const lost = new Map<number, string>();
  const split = new Map<number, readonly number[]>();
  for (const [id, idx] of table) {
    const now = reg.index.get(id);
    const renamed = reg.redirects.get(id);
    if (now !== undefined) runtime[idx] = now;
    else if (renamed) {
      // What was written under the old id is read as the new one.
      runtime[idx] = renamed[0]!;
      if (renamed.length > 1) split.set(idx, renamed);
    } else lost.set(idx, id);
  }
  return { runtime, lost, split };
}

/**
 * Writes and reads records against one table of content ids. `toSaved` maps this build's indices to the table's, and `ids` the
 * table's back. What a read leaves out because its content is gone is counted in `dropped`, as a save's load reports it.
 */
export class RecordCodec implements Coding {
  readonly toSaved: Uint16Array;
  readonly toRuntime: Uint16Array;
  readonly split: Map<number, readonly number[]>;
  /** What the component being read tells of the record being read (Coding). */
  blob: Uint8Array = NO_BYTES;
  refused = false;
  stale = false;
  readonly refs: number[] = [];
  /**
   * What reading left out because its content is gone and the reader chose to go on. `count` is how many things of each
   * missing id. `burn` is what went with them and still has content, by item, for the ledger to burn: what a record of a
   * missing kind held, the rounds in a missing weapon. `pids` are the records of a missing kind, and `changed` and `chunks`
   * the records and chunks that held some of it.
   */
  readonly dropped = { count: new Map<string, number>(), burn: new Map<number, number>(), pids: [] as number[], changed: new Set<number>(), chunks: new Set<number>() };
  /**
   * Records read whose vitals' rates may hold what a buff gave with no buff to end it, because this build lacks the buff.
   * Their rates are worked out again (Buffs.restore).
   */
  readonly unrated = new Set<number>();
  private readonly lost: Map<number, string>;
  private readonly allowMissing: boolean;
  /** What is read, and what to do about missing content: the start and end of the error that stops a read. */
  private readonly subject: string;
  private readonly without: string;
  /** A record, and the part of it being written. Both grow when a record needs it (encode). */
  private w = new BitWriter(65536);
  private c = new BitWriter(32768);
  /** A part of the record being written did not fit in `c`. */
  private cut = false;
  /** Which declared components the record being written has, by place in SAVED. */
  private has = new Uint8Array(64);
  private readonly r = new BitReader();
  private readonly cr = new BitReader();

  constructor(toSaved: Uint16Array, map: IdMap, allowMissing: boolean, subject = "save", without = WITHOUT) {
    this.toSaved = toSaved;
    this.toRuntime = map.runtime;
    this.lost = map.lost;
    this.split = map.split;
    this.allowMissing = allowMissing;
    this.subject = subject;
    this.without = without;
  }

  /** The bytes of a record, valid until the next call. A record that outgrows the writers is written again in larger ones, which are kept. */
  encode(rec: EntityRecord): Uint8Array {
    while (!this.write(rec)) {
      if (this.cut) {
        if (this.c.buf.length >= MAX_PART) throw new Error(`record ${rec.pid} is too large to save: one part of it is over ${MAX_PART} bytes, the most a save holds`);
        this.c = new BitWriter(this.c.buf.length * 2);
      }
      if (this.w.overflow) this.w = new BitWriter(this.w.buf.length * 2);
    }
    return this.w.bytes();
  }

  /** Ends the part written in `c` and puts it in the record. */
  private part(component: number): void {
    if (this.c.overflow) this.cut = true;
    this.w.varint(component);
    this.w.blob(this.c.bytes());
  }

  /** Writes the record into `w`. False if it did not fit. */
  private write(rec: EntityRecord): boolean {
    const w = this.w;
    const c = this.c;
    this.cut = false;
    w.reset();
    w.u8(RECORD_FORMAT);
    w.string(rec.name);
    const inv = rec.inv;
    const used = inv ? inv.used() : 0;
    const hasState = rec.dead || rec.expiresAt !== 0 || rec.held >= 0 || rec.flying;
    const hasProgress = rec.xp > 0 || rec.engrams.length > 0 || rec.jobs.length > 0;
    const hasBreed = rec.mating || rec.mateReadyAt !== 0 || rec.grown !== 0 || rec.egg !== null;
    const hasTame = !!rec.tame || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1 || rec.saddle !== 0 || rec.wander;
    let refs = 0;
    for (let slot = 0; inv?.ref && slot < inv.cap; slot++) if (inv.item[slot] !== 0 && inv.ref[slot] !== 0) refs++;
    const rows = SAVED;
    if (this.has.length < rows.length) this.has = new Uint8Array(rows.length * 2);
    const has = this.has;
    let declared = 0;
    for (let i = 0; i < rows.length; i++) {
      const yes = rows[i]!.has(rec);
      has[i] = yes ? 1 : 0;
      if (yes) declared++;
    }
    w.varint(declared + (refs > 0 ? 1 : 0) + (used > 0 ? 1 : 0) + (rec.vitals ? 1 : 0) + (rec.genome ? 1 : 0) + (rec.keyHash ? 1 : 0) + (rec.look ? 1 : 0) + (rec.markers.length > 0 ? 1 : 0) + (hasState ? 1 : 0) + (hasProgress ? 1 : 0) + (rec.team !== 0 ? 1 : 0) + (rec.at >= 0 ? 1 : 0) + (hasTame ? 1 : 0) + (hasBreed ? 1 : 0) + (rec.buffs.length > 0 ? 1 : 0) + (rec.corpse ? 1 : 0) + (rec.creatureMode !== 0 ? 1 : 0) + (rec.jetSpent > 0 ? 1 : 0) + rec.extra.size);
    for (let i = 0; i < rows.length; i++) {
      if (has[i] === 0) continue;
      c.reset();
      rows[i]!.write(rec, c, this);
      this.part(rows[i]!.id);
    }
    if (rec.jetSpent > 0) { c.reset(); c.u16(rec.jetSpent); this.part(COMP_JET_SPENT); }
    if (rec.creatureMode !== 0) { c.reset(); c.u8(rec.creatureMode); this.part(COMP_CREATURE_MODE); }
    if (rec.buffs.length > 0) {
      c.reset();
      c.varint(rec.buffs.length);
      for (const b of rec.buffs) {
        c.varint(this.toSaved[b.buff]!);
        c.uint53(b.until);
        c.uint53(b.by);
        c.f64(b.torpor);
      }
      // The health a second each adds follows them all, and only when one adds some.
      if (rec.buffs.some((b) => b.health !== 0)) for (const b of rec.buffs) c.f64(b.health);
      this.part(COMP_BUFFS);
    }
    if (hasBreed) {
      c.reset();
      c.bool(rec.mating);
      c.uint53(rec.mateReadyAt);
      c.uint53(rec.span);
      c.uint53(rec.grown);
      c.bool(rec.egg !== null);
      if (rec.egg) {
        c.varint(this.toSaved[rec.egg.species]!);
        c.uint53(rec.egg.span);
        c.uint53(rec.egg.hatchAt);
        c.uint53(rec.egg.carrier);
      }
      this.part(COMP_BREED2);
    }
    if (hasTame) {
      c.reset();
      c.f32(rec.te);
      c.bool(rec.tame !== null);
      if (rec.tame) {
        c.f64(rec.tame.affinity);
        c.f64(rec.tame.sum);
        c.uint53(rec.tame.by);
      }
      c.u8(rec.stance);
      c.uint53(rec.follow);
      c.varint(rec.saddle === 0 ? 0 : this.toSaved[rec.saddle]!);
      c.bool(rec.wander);
      this.part(COMP_TAME);
    }
    if (rec.at >= 0) {
      c.reset();
      c.u32(rec.at);
      c.bits(rec.lock, 2);
      c.varint(rec.pin + 1);
      c.uint53(rec.readyAt);
      c.bool(rec.fire !== null);
      if (rec.fire) {
        c.uint53(rec.fire.at);
        c.varint(rec.fire.fuel);
        c.varint(rec.fire.cook);
        // Then the piece burning (0 for none known) and each lane's item and ticks under way.
        const piece = rec.fire.piece ?? 0;
        c.varint(piece === 0 ? 0 : this.toSaved[piece]!);
        const lanes = rec.fire.lanes ?? [];
        c.varint(lanes.length);
        for (const l of lanes) {
          c.varint(this.toSaved[l.item]!);
          c.varint(l.ticks);
        }
      }
      this.part(COMP_FIXTURE);
    }
    if (hasProgress) {
      c.reset();
      c.f64(rec.xp);
      c.varint(rec.engrams.length);
      for (const e of rec.engrams) c.varint(this.toSaved[e]!);
      c.varint(rec.jobs.length);
      for (const j of rec.jobs) {
        c.varint(this.toSaved[j.item]!);
        c.varint(j.left);
        c.uint53(j.doneAt);
      }
      // Then who queued each job at a station. A job made in the hands has none.
      const queued = rec.jobs.some((j) => j.by !== undefined);
      c.bool(queued);
      if (queued) for (const j of rec.jobs) c.uint53(j.by ?? 0);
      // Then, as a bit and a byte each, the quality plus one of the blueprint each job is made from, 0 for the engram.
      const fromBlueprint = rec.jobs.some((j) => j.bp !== undefined);
      c.bool(fromBlueprint);
      if (fromBlueprint) for (const j of rec.jobs) c.u8(j.bp === undefined ? 0 : j.bp + 1);
      // Then a bit and the ticks plus one each job's unit has left while its station is out, 0 for none.
      const resting = rec.jobs.some((j) => j.rest !== undefined);
      c.bool(resting);
      if (resting) for (const j of rec.jobs) c.varint(j.rest === undefined ? 0 : j.rest + 1);
      this.part(COMP_PROGRESSION);
    }
    if (rec.markers.length > 0) {
      c.reset();
      c.varint(rec.markers.length);
      for (const m of rec.markers) {
        c.u8(m.kind);
        c.f32(m.x);
        c.f32(m.y);
        c.f32(m.z);
        c.uint53(m.tick);
      }
      this.part(COMP_MARKERS);
    }
    if (hasState) {
      c.reset();
      c.bool(rec.dead);
      c.uint53(rec.expiresAt);
      // The hotbar slot in hand plus one, or 0 for none, then whether it flies.
      c.u8(rec.held + 1);
      c.bool(rec.flying);
      this.part(COMP_STATE);
    }
    if (rec.team !== 0) {
      c.reset();
      c.varint(rec.team);
      c.u8(rec.rank);
      this.part(COMP_TEAM);
    }
    if (inv && used > 0) {
      c.reset();
      c.varint(inv.cap);
      c.varint(inv.bag);
      c.varint(used);
      for (let slot = 0; slot < inv.cap; slot++) {
        if (inv.item[slot] === 0) continue;
        c.varint(slot);
        c.varint(this.toSaved[inv.item[slot]!]!);
        c.varint(inv.count[slot]!);
        c.u8(inv.quality[slot]!);
        c.varint(inv.dur[slot]!);
        c.varint(inv.spoilAt[slot]!);
        const holds = inv.ammo[slot] !== 0 || inv.attach[slot] !== 0;
        c.bool(holds);
        if (holds) {
          c.varint(inv.ammo[slot] === 0 ? 0 : this.toSaved[inv.ammo[slot]!]!);
          c.u8(inv.loaded[slot]!);
          c.varint(inv.attach[slot] === 0 ? 0 : this.toSaved[inv.attach[slot]!]!);
        }
        c.u8(inv.flags[slot]!);
      }
      this.part(COMP_SLOTS3);
    }
    if (inv && refs > 0) {
      c.reset();
      c.varint(refs);
      for (let slot = 0; slot < inv.cap; slot++) {
        if (inv.item[slot] === 0 || inv.ref![slot] === 0) continue;
        c.varint(slot);
        c.uint53(inv.ref![slot]!);
      }
      this.part(COMP_REFS);
    }
    if (rec.corpse) {
      const b = rec.corpse;
      c.reset();
      c.varint(this.toSaved[b.species]!);
      c.f64(b.max);
      c.f64(b.left);
      c.varint(b.span);
      c.bool(b.young);
      c.bool(b.out);
      c.uint53(b.life);
      c.bool(b.air);
      this.part(COMP_CORPSE);
    }
    const v = rec.vitals;
    if (v) {
      // Maxima come from stats and are not saved.
      c.reset();
      let mask = 0;
      for (let i = 0; i < V_COUNT; i++) if (v.max[i]! > 0) mask |= 1 << i;
      c.u8(mask);
      c.uint53(v.tick);
      for (let i = 0; i < V_COUNT; i++) {
        if ((mask & (1 << i)) === 0) continue;
        c.uint53(v.value[i]!);
        c.svarint(v.rate[i]!);
      }
      c.bool(rec.out);
      this.part(COMP_VITALS53);
    }
    const g = rec.genome;
    if (g) {
      c.reset();
      for (const points of [g.wild, g.mutated, g.tamed, g.colors]) for (let i = 0; i < points.length; i++) c.u8(points[i]!);
      c.varint(g.mutMat);
      c.varint(g.mutPat);
      c.uint53(g.mother);
      c.uint53(g.father);
      c.bool(g.female);
      this.part(COMP_GENOME);
    }
    if (rec.keyHash) {
      w.varint(COMP_IDENTITY);
      w.blob(rec.keyHash);
    }
    if (rec.look) {
      w.varint(COMP_LOOK);
      w.blob(rec.look);
    }
    for (const [component, blob] of rec.extra) {
      w.varint(component);
      w.blob(blob);
    }
    return !this.cut && !w.overflow;
  }

  /**
   * The record a row holds. Null for one of a kind this build lacks, which a reader that may go on without missing content
   * counts in `dropped`, with what it held. Throws for missing content otherwise.
   */
  decode(row: RecordRow): EntityRecord | null {
    const kind = this.toRuntime[row.kind] ?? 0;
    if (kind === 0 && !this.allowMissing) {
      if (row.kind !== 0 && this.lost.has(row.kind)) throw new Error(`${this.subject} uses content this build does not have: ${this.lost.get(row.kind)}: ${this.without}`);
      return null;
    }
    // Past here a kind of 0 is content that is gone, which the reader chose to go on without. The record is read all
    // the same, because what it held leaves the ledger with it.
    const rec = new EntityRecord(row.pid, kind);
    rec.x = row.x;
    rec.y = row.y;
    rec.z = row.z;
    rec.yaw = row.yaw;
    const r = this.r;
    r.reset(row.data);
    const format = r.u8();
    if (format !== RECORD_FORMAT) throw new Error(`entity ${row.pid} was saved in record format ${format}, and this build reads ${RECORD_FORMAT}`);
    let stale = false;
    rec.name = r.string(256);
    const c = this.cr;
    /** Slot and pid pairs, put on the inventory once every part is read. */
    const refs: number[] = [];
    this.refused = false;
    for (let n = r.varint(); n > 0 && !r.overflow; n--) {
      const component = r.varint();
      const blob = r.blob(MAX_PART);
      c.reset(blob);
      const declared = savedAs(component);
      if (declared) {
        this.blob = blob;
        declared.read(rec, c, this);
        if (this.refused) return null;
      } else if (component === COMP_SLOTS3) {
        const cap = c.varint();
        const inv = (rec.inv = new Inventory(cap, c.varint()));
        for (let k = c.varint(); k > 0 && !c.overflow; k--) {
          const slot = c.varint();
          const saved = c.varint();
          const count = c.varint();
          const item = this.item(saved, row.pid, count);
          const quality = c.u8();
          const dur = c.varint();
          const spoilAt = c.varint();
          const holds = c.bool();
          // 0 is "none". Anything else must be content this build has.
          const savedAmmo = holds ? c.varint() : 0;
          const loaded = holds ? c.u8() : 0;
          const savedAttach = holds ? c.varint() : 0;
          const ammo = savedAmmo === 0 ? 0 : this.item(savedAmmo, row.pid, loaded);
          const attach = savedAttach === 0 ? 0 : this.item(savedAttach, row.pid, 1);
          const flags = c.u8();
          if (item === 0) {
            // The rounds in a weapon that is gone, and what was fixed to it, go with it.
            if (ammo !== 0 && loaded > 0) this.burn(ammo, loaded);
            if (attach !== 0) this.burn(attach, 1);
            continue;
          }
          if (slot >= inv.cap) continue;
          inv.set(slot, item, count, quality, dur, spoilAt, flags);
          if (holds) inv.setGear(slot, ammo, ammo === 0 ? 0 : loaded, attach);
        }
      } else if (component === COMP_VITALS53) {
        const v = (rec.vitals = new Vitals());
        const mask = c.u8();
        v.tick = c.uint53();
        for (let i = 0; i < V_COUNT; i++) {
          if ((mask & (1 << i)) === 0) continue;
          const value = c.uint53();
          v.value[i] = value;
          v.rate[i] = c.svarint();
          // A placeholder until the survival system sets the true maximum from the body's stats.
          v.max[i] = value > 0 ? value : 1;
        }
        rec.out = c.bool();
      } else if (component === COMP_GENOME) {
        const g = (rec.genome = new Genome());
        if (blob.length < STAT_COUNT * 3 + COLOR_REGIONS) throw new Error(`entity ${row.pid}: short genome`);
        for (const points of [g.wild, g.mutated, g.tamed, g.colors]) for (let i = 0; i < points.length; i++) points[i] = c.u8();
        g.mutMat = c.varint();
        g.mutPat = c.varint();
        g.mother = c.uint53();
        g.father = c.uint53();
        g.female = c.bool();
      } else if (component === COMP_IDENTITY) rec.keyHash = blob.slice();
      // A look this build cannot read is kept in rec.extra and not worn.
      else if (component === COMP_LOOK && validLook(blob)) rec.look = blob.slice();
      else if (component === COMP_MARKERS) {
        for (let k = c.varint(); k > 0 && !c.overflow; k--) rec.markers.push({ kind: c.u8(), x: c.f32(), y: c.f32(), z: c.f32(), tick: c.uint53() });
      } else if (component === COMP_PROGRESSION) {
        rec.xp = c.f64();
        // Engrams and jobs whose content is gone are dropped. Nothing of value is lost with them.
        for (let k = c.varint(); k > 0 && !c.overflow; k--) {
          const saved = c.varint();
          // An engram that became several is known as all of them.
          for (const e of this.split.get(saved) ?? [this.toRuntime[saved] ?? 0]) if (e !== 0 && !rec.engrams.includes(e)) rec.engrams.push(e);
        }
        const jobs: Job[] = [];
        for (let k = c.varint(); k > 0 && !c.overflow; k--) {
          const item = this.toRuntime[c.varint()] ?? 0;
          const left = c.varint();
          const doneAt = c.uint53();
          jobs.push({ item, left, doneAt });
        }
        if (c.bool()) {
          for (const j of jobs) {
            const by = c.uint53();
            if (by !== 0) j.by = by;
          }
        }
        if (c.bool()) {
          for (const j of jobs) {
            const bp = c.u8();
            if (bp !== 0) j.bp = bp - 1;
          }
        }
        if (c.bool()) {
          for (const j of jobs) {
            const rest = c.varint();
            if (rest !== 0) j.rest = rest - 1;
          }
        }
        for (const j of jobs) if (j.item !== 0) rec.jobs.push(j);
      } else if (component === COMP_JET_SPENT) {
        // Held to today's capacity, never refused: the capacity is a number to tune, and a save made when it was larger
        // would otherwise lose the survivor's whole record over a spent reserve.
        rec.jetSpent = Math.min(JET_CAPACITY, c.u16());
      } else if (component === COMP_CREATURE_MODE) {
        rec.creatureMode = c.u8();
        if (rec.creatureMode > 2) return null;
      } else if (component === COMP_STATE) {
        rec.dead = c.bool();
        rec.expiresAt = c.uint53();
        rec.held = c.u8() - 1;
        rec.flying = c.bool();
      } else if (component === COMP_TEAM) {
        rec.team = c.varint();
        rec.rank = c.u8();
      } else if (component === COMP_TAME) {
        rec.te = c.f32();
        if (c.bool()) rec.tame = { affinity: c.f64(), sum: c.f64(), by: c.uint53(), seen: -1, due: 0 };
        rec.stance = c.u8();
        rec.follow = c.uint53();
        const saddle = c.varint();
        rec.saddle = saddle === 0 ? 0 : (this.toRuntime[saddle] ?? 0);
        rec.wander = c.bool();
      } else if (component === COMP_BREED2) {
        rec.mating = c.bool();
        rec.mateReadyAt = c.uint53();
        rec.span = c.uint53();
        rec.grown = c.uint53();
        if (c.bool()) rec.egg = { species: this.toRuntime[c.varint()] ?? 0, span: c.uint53(), hatchAt: c.uint53(), carrier: c.uint53() };
      } else if (component === COMP_FIXTURE) {
        rec.at = c.u32();
        rec.lock = c.bits(2);
        rec.pin = c.varint() - 1;
        rec.readyAt = c.uint53();
        if (c.bool()) {
          const fire: FireState = { at: c.uint53(), fuel: c.varint(), cook: c.varint(), due: 0, out: 0 };
          // A piece or a lane whose content is gone is dropped: it is no item anyone holds.
          const piece = this.toRuntime[c.varint()] ?? 0;
          if (piece !== 0) fire.piece = piece;
          const lanes: Lane[] = [];
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const item = this.toRuntime[c.varint()] ?? 0;
            const ticks = c.varint();
            if (item !== 0) lanes.push({ item, ticks });
          }
          if (lanes.length > 0) fire.lanes = lanes;
          rec.fire = fire;
        }
      } else if (component === COMP_BUFFS) {
        const read: { buff: number; until: number; by: number; torpor: number; health: number }[] = [];
        for (let k = c.varint(); k > 0 && !c.overflow; k--) read.push({ buff: this.toRuntime[c.varint()] ?? 0, until: c.uint53(), by: c.uint53(), torpor: c.f64(), health: 0 });
        // The healths follow only when one is not 0.
        if (c.pos + 64 * read.length <= blob.length * 8) for (const on of read) on.health = c.f64();
        for (const on of read) {
          // A buff whose content is gone is dropped, and what it gave the vitals with it.
          if (on.buff !== 0) rec.buffs.push(on);
          else stale = true;
        }
      } else if (component === COMP_REFS) {
        for (let k = c.varint(); k > 0 && !c.overflow; k--) refs.push(c.varint(), c.uint53());
      } else if (component === COMP_CORPSE) {
        // A body of a species this build lacks keeps 0, and Corpses lets it go with what it held.
        rec.corpse = { species: this.toRuntime[c.varint()] ?? 0, max: c.f64(), left: c.f64(), span: c.varint(), young: c.bool(), out: c.bool(), life: c.uint53(), air: c.bool() };
      } else rec.extra.set(component, blob.slice());
      if (c.overflow) throw new Error(`entity ${row.pid}: unreadable component ${component}`);
    }
    if (r.overflow) throw new Error(`entity ${row.pid}: truncated record`);
    // A slot whose item was left out with its content stands for nothing. Its record is let go when eggs resume.
    for (let k = 0; k < refs.length && rec.inv; k += 2) if (refs[k]! < rec.inv.cap && rec.inv.item[refs[k]!] !== 0) rec.inv.setRef(refs[k]!, refs[k + 1]!);
    if (kind === 0) {
      this.drop(row.kind, 1);
      this.dropped.pids.push(row.pid);
      this.dropped.changed.delete(row.pid);
      const inv = rec.inv;
      for (let s = 0; inv && s < inv.cap; s++) {
        if (inv.item[s] === 0) continue;
        this.burn(inv.item[s]!, inv.count[s]!);
        if (inv.loaded[s]! > 0) this.burn(inv.ammo[s]!, inv.loaded[s]!);
        if (inv.attach[s] !== 0) this.burn(inv.attach[s]!, 1);
      }
      return null;
    }
    if (stale && rec.vitals) this.unrated.add(row.pid);
    return rec;
  }

  /** Counts `n` things of the missing content with written index `saved` as left out. */
  drop(saved: number, n: number): void {
    const id = this.lost.get(saved) ?? `content ${saved}`;
    this.dropped.count.set(id, (this.dropped.count.get(id) ?? 0) + n);
  }

  /** Counts `n` of `item` as gone with something that was left out. */
  burn(item: number, n: number): void {
    this.dropped.burn.set(item, (this.dropped.burn.get(item) ?? 0) + n);
  }

  /** An item whose content is gone stops the read unless missing content is allowed. Then the `n` of it that record `pid` held are left out. */
  item(saved: number, pid: number, n: number): number {
    const item = this.toRuntime[saved] ?? 0;
    if (item !== 0) return item;
    if (!this.allowMissing) throw new Error(`${this.subject} uses content this build does not have: ${this.lost.get(saved) ?? "an item"}, held by record ${pid}: ${this.without}`);
    this.drop(saved, n);
    this.dropped.changed.add(pid);
    return 0;
  }
}

/**
 * Moves every world tick a record keeps by `delta`, for a record that left one world's clock for another's. What was due by the
 * old clock is due as far off by the new. A tick of 0 means none and stays 0. A fertilised egg held as an item keeps the time
 * it has left, not a tick, so it is left alone. Death markers are places on the world it left, so they go.
 */
export function rebaseTicks(rec: EntityRecord, delta: number): void {
  const move = (tick: number): number => (tick === 0 ? 0 : Math.max(1, tick + delta));
  if (rec.vitals) rec.vitals.tick = Math.max(0, rec.vitals.tick + delta);
  const inv = rec.inv;
  for (let s = 0; inv && s < inv.cap; s++) {
    const at = inv.spoilAt[s]!;
    if (inv.item[s] === 0 || at === 0 || at === 0xffffffff) continue;
    inv.spoilAt[s] = Math.min(0xffffffff, move(at));
  }
  for (const j of rec.jobs) j.doneAt = move(j.doneAt);
  for (const b of rec.buffs) b.until = move(b.until);
  rec.expiresAt = move(rec.expiresAt);
  rec.mateReadyAt = move(rec.mateReadyAt);
  rec.grown = move(rec.grown);
  // A tame kept in a soul ball stays as long kept by the new clock.
  rec.stored = move(rec.stored);
  rec.readyAt = move(rec.readyAt);
  if (rec.fire) rec.fire.at = move(rec.fire.at);
  if (rec.egg && rec.egg.carrier !== rec.pid) rec.egg.hatchAt = move(rec.egg.hatchAt);
  rec.markers.length = 0;
  rec.markersVersion++;
  // Worked out again from the rest.
  rec.vitalsDue = 0;
  rec.growDue = 0;
  rec.mealDue = 0;
}
