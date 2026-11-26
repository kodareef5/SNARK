// A record as bytes: the form a save keeps it in, and the form it travels in between servers (server/cluster/parcel.ts).
// Content is written as an index into a table of content ids that goes with the bytes, never as a build's own index.

import { JET_CAPACITY } from "../../shared/sim/character.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { COLOR_REGIONS, Genome, STAT_COUNT } from "../../shared/sim/genome.ts";
import { FLAG_BLUEPRINT, FLAG_ON, Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import { validLook } from "../../shared/anim/look.ts";
import { EntityRecord } from "../records.ts";
import { SAVED, moved, saved, savedAs, type Coding } from "../saved.ts";

/** The revision of a record's components, in its first byte. Raise it whenever one changes: a build reads only its own. */
const RECORD_FORMAT = 8;
// A record is a list of components, each a number and a length-prefixed blob. A build that does not know a
// component keeps its bytes and writes them back, so a save survives a server that lacks a content pack.
// Each is declared with `saved` (server/saved.ts) and numbered from its name: those every record may have at the end
// of this file, and a feature's own in the feature's file. Other parts of the server keep bytes of their own in
// rec.extra under numbers chosen by hand, apart from these: 83 a survivor's activity (server/survivor-activity.ts), 90
// the Cast person a body is (server/cast/host.ts).
/** The most bytes of one component that a save holds. */
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
  readonly styles: number[] = [];
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
  /** A record, and the component of it being written. Both grow when a record needs it (encode). */
  private w = new BitWriter(65536);
  private c = new BitWriter(32768);
  /** A component of the record being written did not fit in `c`. */
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

  /** Writes the record into `w`. False if it did not fit. */
  private write(rec: EntityRecord): boolean {
    const w = this.w;
    const c = this.c;
    this.cut = false;
    w.reset();
    w.u8(RECORD_FORMAT);
    w.string(rec.name);
    const rows = SAVED;
    if (this.has.length < rows.length) this.has = new Uint8Array(rows.length * 2);
    const has = this.has;
    let count = rec.extra.size;
    for (let i = 0; i < rows.length; i++) {
      const yes = rows[i]!.has(rec);
      has[i] = yes ? 1 : 0;
      if (yes) count++;
    }
    w.varint(count);
    for (let i = 0; i < rows.length; i++) {
      if (has[i] === 0) continue;
      c.reset();
      rows[i]!.write(rec, c, this);
      if (c.overflow) this.cut = true;
      w.varint(rows[i]!.id);
      w.blobOf(c);
    }
    if (rec.extra.size > 0) {
      for (const [component, blob] of rec.extra) {
        w.varint(component);
        w.blob(blob);
      }
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
    rec.name = r.string(256);
    const c = this.cr;
    const refs = this.refs;
    refs.length = 0;
    const styles = this.styles;
    styles.length = 0;
    this.refused = false;
    this.stale = false;
    for (let n = r.varint(); n > 0 && !r.overflow; n--) {
      const component = r.varint();
      const blob = r.blob(MAX_PART);
      c.reset(blob);
      this.blob = blob;
      const declared = savedAs(component);
      if (declared) declared.read(rec, c, this);
      else rec.extra.set(component, blob.slice());
      if (this.refused) return null;
      if (c.overflow) throw new Error(`entity ${row.pid}: unreadable component ${component}`);
    }
    this.blob = NO_BYTES;
    if (r.overflow) throw new Error(`entity ${row.pid}: truncated record`);
    // A slot whose item was left out with its content stands for nothing. Its record is let go when eggs resume.
    for (let k = 0; k < refs.length && rec.inv; k += 2) if (refs[k]! < rec.inv.cap && rec.inv.item[refs[k]!] !== 0) rec.inv.setRef(refs[k]!, refs[k + 1]!);
    for (let k = 0; k < styles.length && rec.inv; k += 3) if (styles[k]! < rec.inv.cap && rec.inv.item[styles[k]!] !== 0) rec.inv.setStyle(styles[k]!, styles[k + 1]!, styles[k + 2]!);
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
    if (this.stale && rec.vitals) this.unrated.add(row.pid);
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

// The components every record may have, whatever features are loaded.

function writeBytes(w: BitWriter, src: Uint8Array): void {
  for (let i = 0; i < src.length; i++) w.u8(src[i]!);
}

function readBytes(r: BitReader, into: Uint8Array): void {
  for (let i = 0; i < into.length; i++) into[i] = r.u8();
}

saved({
  name: "jet",
  has: (rec) => rec.jetSpent > 0,
  write: (rec, w) => w.u16(rec.jetSpent),
  read(rec, r) {
    // Held to today's capacity, never refused: the capacity is a number to tune, and a save made when it was larger
    // would otherwise lose the survivor's whole record over a spent reserve.
    rec.jetSpent = Math.min(JET_CAPACITY, r.u16());
  },
});

/** A ground creature's plate mode. Its attacks are never saved. */
saved({
  name: "creature mode",
  has: (rec) => rec.creatureMode !== 0,
  write: (rec, w) => w.u8(rec.creatureMode),
  read(rec, r, from) {
    rec.creatureMode = r.u8();
    if (rec.creatureMode > 2) from.refused = true;
  },
});

saved({
  name: "markers",
  has: (rec) => rec.markers.length > 0,
  write(rec, w) {
    w.varint(rec.markers.length);
    for (const m of rec.markers) {
      w.u8(m.kind);
      w.f32(m.x);
      w.f32(m.y);
      w.f32(m.z);
      w.uint53(m.tick);
    }
  },
  read(rec, r) {
    for (let k = r.varint(); k > 0 && !r.overflow; k--) rec.markers.push({ kind: r.u8(), x: r.f32(), y: r.f32(), z: r.f32(), tick: r.uint53() });
  },
  rebase(rec) {
    // Death markers are places on the world it left, so they go.
    rec.markers.length = 0;
    rec.markersVersion++;
  },
});

/** Dead flag, expiry tick, the hotbar slot in hand, and whether it flies. */
saved({
  name: "state",
  has: (rec) => rec.dead || rec.expiresAt !== 0 || rec.held >= 0 || rec.flying,
  write(rec, w) {
    w.bool(rec.dead);
    w.uint53(rec.expiresAt);
    // The hotbar slot in hand plus one, or 0 for none, then whether it flies.
    w.u8(rec.held + 1);
    w.bool(rec.flying);
  },
  read(rec, r) {
    rec.dead = r.bool();
    rec.expiresAt = r.uint53();
    rec.held = r.u8() - 1;
    rec.flying = r.bool();
  },
  rebase: (rec, delta) => void (rec.expiresAt = moved(rec.expiresAt, delta)),
});

saved({
  name: "team",
  has: (rec) => rec.team !== 0,
  write(rec, w) {
    w.varint(rec.team);
    w.u8(rec.rank);
  },
  read(rec, r) {
    rec.team = r.varint();
    rec.rank = r.u8();
  },
});

/**
 * The inventory's size and bag, then each slot with what a weapon holds and its flags (FLAG_ bits, shared/sim/items.ts).
 */
saved({
  name: "slots",
  has(rec) {
    const inv = rec.inv;
    if (inv) for (let slot = 0; slot < inv.cap; slot++) if (inv.item[slot] !== 0) return true;
    return false;
  },
  write(rec, w, to) {
    const inv = rec.inv!;
    w.varint(inv.cap);
    w.varint(inv.bag);
    w.varint(inv.used());
    for (let slot = 0; slot < inv.cap; slot++) {
      if (inv.item[slot] === 0) continue;
      w.varint(slot);
      w.varint(to.toSaved[inv.item[slot]!]!);
      w.varint(inv.count[slot]!);
      w.u8(inv.quality[slot]!);
      w.varint(inv.dur[slot]!);
      w.varint(inv.spoilAt[slot]!);
      const holds = inv.ammo[slot] !== 0 || inv.attach[slot] !== 0;
      w.bool(holds);
      if (holds) {
        w.varint(inv.ammo[slot] === 0 ? 0 : to.toSaved[inv.ammo[slot]!]!);
        w.u8(inv.loaded[slot]!);
        w.varint(inv.attach[slot] === 0 ? 0 : to.toSaved[inv.attach[slot]!]!);
      }
      w.u8(inv.flags[slot]!);
    }
  },
  read(rec, r, from) {
    const size = r.varint();
    const bag = r.varint();
    const inv = (rec.inv = new Inventory(size, bag));
    for (let k = r.varint(); k > 0 && !r.overflow; k--) {
      const slot = r.varint();
      const saved = r.varint();
      const count = r.varint();
      const item = from.item(saved, rec.pid, count);
      const quality = r.u8();
      const dur = r.varint();
      const spoilAt = r.varint();
      const holds = r.bool();
      // 0 is "none". Anything else must be content this build has.
      const savedAmmo = holds ? r.varint() : 0;
      const loaded = holds ? r.u8() : 0;
      const savedAttach = holds ? r.varint() : 0;
      const ammo = savedAmmo === 0 ? 0 : from.item(savedAmmo, rec.pid, loaded);
      const attach = savedAttach === 0 ? 0 : from.item(savedAttach, rec.pid, 1);
      // A bit this build has no flag for is dropped: an older save marked issued pieces with one.
      const flags = r.u8() & (FLAG_BLUEPRINT | FLAG_ON);
      if (item === 0) {
        // The rounds in a weapon that is gone, and what was fixed to it, go with it.
        if (ammo !== 0 && loaded > 0) from.burn(ammo, loaded);
        if (attach !== 0) from.burn(attach, 1);
        continue;
      }
      if (slot >= inv.cap) continue;
      inv.set(slot, item, count, quality, dur, spoilAt, flags);
      if (holds) inv.setGear(slot, ammo, ammo === 0 ? 0 : loaded, attach);
    }
  },
  rebase(rec, delta) {
    const inv = rec.inv;
    for (let s = 0; inv && s < inv.cap; s++) {
      // A charge held full names no tick.
      const at = inv.spoilAt[s]!;
      if (inv.item[s] === 0 || at === 0 || at === 0xffffffff) continue;
      inv.spoilAt[s] = Math.min(0xffffffff, moved(at, delta));
    }
  },
});

/** The slots of its inventory that stand for a record (Inventory.ref): each slot and that record's pid. */
saved({
  name: "refs",
  has(rec) {
    const inv = rec.inv;
    if (inv?.ref) for (let slot = 0; slot < inv.cap; slot++) if (inv.item[slot] !== 0 && inv.ref[slot] !== 0) return true;
    return false;
  },
  write(rec, w) {
    const inv = rec.inv!;
    const ref = inv.ref!;
    let refs = 0;
    for (let slot = 0; slot < inv.cap; slot++) if (inv.item[slot] !== 0 && ref[slot] !== 0) refs++;
    w.varint(refs);
    for (let slot = 0; slot < inv.cap; slot++) {
      if (inv.item[slot] === 0 || ref[slot] === 0) continue;
      w.varint(slot);
      w.uint53(ref[slot]!);
    }
  },
  read(_rec, r, from) {
    for (let k = r.varint(); k > 0 && !r.overflow; k--) from.refs.push(r.varint(), r.uint53());
  },
});

/** The slots whose item is an edition or dyed (Inventory.edition and dye): each slot, its edition and its three dye colours. */
saved({
  name: "styles",
  has(rec) {
    const inv = rec.inv;
    if (inv && (inv.edition || inv.dye)) for (let slot = 0; slot < inv.cap; slot++) if (inv.item[slot] !== 0 && (inv.editionOf(slot) !== 0 || inv.dyeOf(slot) !== 0)) return true;
    return false;
  },
  write(rec, w) {
    const inv = rec.inv!;
    let n = 0;
    for (let slot = 0; slot < inv.cap; slot++) if (inv.item[slot] !== 0 && (inv.editionOf(slot) !== 0 || inv.dyeOf(slot) !== 0)) n++;
    w.varint(n);
    for (let slot = 0; slot < inv.cap; slot++) {
      const edition = inv.editionOf(slot), dye = inv.dyeOf(slot);
      if (inv.item[slot] === 0 || (edition === 0 && dye === 0)) continue;
      w.varint(slot);
      w.varint(edition);
      w.u8(dye & 0xff);
      w.u8((dye >>> 8) & 0xff);
      w.u8((dye >>> 16) & 0xff);
    }
  },
  read(_rec, r, from) {
    for (let k = r.varint(); k > 0 && !r.overflow; k--) from.styles.push(r.varint(), r.varint(), r.u8() | (r.u8() << 8) | (r.u8() << 16));
  },
});

/** The vitals with 53-bit values and tick, and whether the body is unconscious. */
saved({
  name: "vitals",
  has: (rec) => rec.vitals !== null,
  write(rec, w) {
    // Maxima come from stats and are not saved.
    const v = rec.vitals!;
    let mask = 0;
    for (let i = 0; i < V_COUNT; i++) if (v.max[i]! > 0) mask |= 1 << i;
    w.u8(mask);
    w.uint53(v.tick);
    for (let i = 0; i < V_COUNT; i++) {
      if ((mask & (1 << i)) === 0) continue;
      w.uint53(v.value[i]!);
      w.svarint(v.rate[i]!);
    }
    w.bool(rec.out);
  },
  read(rec, r) {
    const v = (rec.vitals = new Vitals());
    const mask = r.u8();
    v.tick = r.uint53();
    for (let i = 0; i < V_COUNT; i++) {
      if ((mask & (1 << i)) === 0) continue;
      const value = r.uint53();
      v.value[i] = value;
      v.rate[i] = r.svarint();
      // A placeholder until the survival system sets the true maximum from the body's stats.
      v.max[i] = value > 0 ? value : 1;
    }
    rec.out = r.bool();
  },
  rebase(rec, delta) {
    if (rec.vitals) rec.vitals.tick = Math.max(0, rec.vitals.tick + delta);
    rec.vitalsDue = 0;
  },
});

saved({
  name: "genome",
  has: (rec) => rec.genome !== null,
  write(rec, w) {
    const g = rec.genome!;
    writeBytes(w, g.wild);
    writeBytes(w, g.mutated);
    writeBytes(w, g.tamed);
    writeBytes(w, g.colors);
    w.varint(g.mutMat);
    w.varint(g.mutPat);
    w.uint53(g.mother);
    w.uint53(g.father);
    w.bool(g.female);
  },
  read(rec, r, from) {
    const g = (rec.genome = new Genome());
    if (from.blob.length < STAT_COUNT * 3 + COLOR_REGIONS) throw new Error(`entity ${rec.pid}: short genome`);
    readBytes(r, g.wild);
    readBytes(r, g.mutated);
    readBytes(r, g.tamed);
    readBytes(r, g.colors);
    g.mutMat = r.varint();
    g.mutPat = r.varint();
    g.mother = r.uint53();
    g.father = r.uint53();
    g.female = r.bool();
  },
});

/** The hash of the device key that owns a survivor. */
saved({
  name: "identity",
  has: (rec) => rec.keyHash !== null,
  write: (rec, w) => writeBytes(w, rec.keyHash!),
  read: (rec, _r, from) => void (rec.keyHash = from.blob.slice()),
});

/** The bytes of shared/anim/look.ts. */
const LOOK = saved({
  name: "look",
  has: (rec) => rec.look !== null,
  write: (rec, w) => writeBytes(w, rec.look!),
  read(rec, _r, from) {
    // A look this build cannot read is kept in rec.extra and not worn.
    if (validLook(from.blob)) rec.look = from.blob.slice();
    else rec.extra.set(LOOK.id, from.blob.slice());
  },
});

/**
 * Moves every world tick a record keeps by `delta`, for a record that left one world's clock for another's. What was due by the
 * old clock is due as far off by the new. Each component moves its own (Saved.rebase).
 */
export function rebaseTicks(rec: EntityRecord, delta: number): void {
  const rows = SAVED;
  for (let i = 0; i < rows.length; i++) rows[i]!.rebase?.(rec, delta);
}
