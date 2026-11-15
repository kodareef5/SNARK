// Durable world state in one SQLite database. One commit is one transaction, so a crash lands the whole world on a commit boundary.
// Saves refer to content by string id through content_ids, never by a build's dense index, so adding content does not disturb them.

import { Database, type Statement } from "bun:sqlite";
import type { Registry } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { COLOR_REGIONS, Genome, STAT_COUNT } from "../../shared/sim/genome.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import type { ChunkTable, StructureStore } from "../../shared/world/structures.ts";
import { EntityRecord } from "../records.ts";
import { validLook } from "../../shared/anim/look.ts";
import { existsSync } from "node:fs";
import { listBackups } from "./backup.ts";
import { refuseNetworkDisk } from "./disk.ts";
import { holdSave, type SaveLock } from "./lock.ts";

export const SCHEMA_VERSION = 2;
const CHUNK_FORMAT = 1;
/**
 * The revision of a record's parts, in its first byte. Raise it whenever a part gains a field, or a part is added that a build
 * without it must not pass over. A build reads every revision up to its own and refuses a later one: it would write a part it
 * knows back without what was added. Revision 1 grew without being raised (a tame's stance and saddle, a bed's wait, a fire,
 * the slot in hand), so builds from before each of those read newer saves and dropped them. 2 is all of that.
 * 3 saves buffs. A build without them would keep the part unread and leave a buff's rates in the vitals with no end.
 * 4 saves what a one of a kind in a slot stands for (a fertilised egg's record). A build without it would keep the part
 * unread, and an egg taken up would never hatch.
 */
const RECORD_FORMAT = 4;
/** The first revision whose vitals hold, beyond a body's own rates, only what its saved buffs give. */
const FORMAT_BUFFS = 3;
// A record is a list of components, each an id and a length-prefixed blob. A build that does not know a
// component keeps its bytes and writes them back, so a save survives a server that lacks a content pack.
const COMP_INVENTORY = 1;
const COMP_VITALS = 2;
const COMP_GENOME = 3;
const COMP_IDENTITY = 6;
// Components 1 and 2 are the oldest inventory (item and count pairs) and food. They are read and never written.
const COMP_SLOTS = 7;
const COMP_VITALS4 = 8;
const COMP_MARKERS = 5;
/** Dead flag, expiry tick and the hotbar slot in hand. */
const COMP_STATE = 9;
/** The bytes of shared/anim/look.ts. */
const COMP_LOOK = 10;
/** COMP_SLOTS plus the bag's size and, for weapons, what each holds. */
const COMP_SLOTS2 = 11;
/** Eight vitals and whether the body is unconscious. COMP_VITALS4 held four. Both are read and no longer written. */
const COMP_VITALS8 = 12;
/** The same with 53-bit values and tick. COMP_VITALS8 wrote a value in 32 bits of millionths, which cut off anything above 4,294 points. */
const COMP_VITALS53 = 17;
const COMP_TEAM = 13;
/** How well a tamed creature was tamed and, for one being tamed, what it has been given so far and for whom. */
const COMP_TAME = 15;
/** The first breeding form. It stored the ticks a young one was born and an egg was laid, where COMP_BREED2 stores spans. Still read. */
const COMP_BREED = 16;
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
/** The most bytes of one part that a save holds. */
const MAX_PART = 1 << 20;
/** The most slots a converted COMP_INVENTORY may be laid out in. */
const MAX_INVENTORY_SLOTS = 255;
/** How an operator goes on from a save that uses content the build lacks. */
const WITHOUT = "start with the content it was made with, or with --allow-missing-content to go on without what is made of it, which is then dropped for good";
/** Per structure slot in a chunk blob: kind, x, y, z, yaw, owner, hp, mod. */
const SLOT_BYTES = 2 + 4 + 4 + 4 + 2 + 4 + 4 + 4;

const MIGRATIONS: ((db: Database) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE content_ids (idx INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE);
      CREATE TABLE chunk_structs (chunk INTEGER PRIMARY KEY, version INTEGER NOT NULL, slots INTEGER NOT NULL, data BLOB NOT NULL);
      CREATE TABLE entities (pid INTEGER PRIMARY KEY, kind INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, yaw INTEGER NOT NULL, data BLOB NOT NULL);
      CREATE TABLE survivors (name TEXT PRIMARY KEY, pid INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE journal (seq INTEGER PRIMARY KEY, tick INTEGER NOT NULL, op INTEGER NOT NULL, data BLOB NOT NULL);
    `);
  },
  // Schema 2 adds per-chunk state other than structures, keyed by tag.
  (db) => {
    db.exec("CREATE TABLE chunk_blobs (chunk INTEGER NOT NULL, tag INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (chunk, tag)) WITHOUT ROWID");
  },
];

export interface JournalEntry {
  seq: number;
  tick: number;
  op: number;
  data: Uint8Array;
}

export interface StoreOptions {
  /** "NORMAL" survives a process crash. "FULL" also survives power loss, at an fsync per commit. */
  synchronous?: "NORMAL" | "FULL";
  /** Load saves that reference content ids this build lacks, dropping those objects. */
  allowMissingContent?: boolean;
  /** Accept a save on a network file system, where write-ahead logging can corrupt it. */
  allowNetworkDisk?: boolean;
}

/** SQLite's code for an error it raised ("SQLITE_FULL"), or "" for an error of our own. */
export function sqliteCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_") ? code : "";
}

/** Bun reports SQLite's extended codes, so a `base` of SQLITE_READONLY is also SQLITE_READONLY_DBMOVED. */
export function sqliteIs(code: string, base: string): boolean {
  return code === base || code.startsWith(`${base}_`);
}

export class WorldStore {
  readonly db: Database;
  readonly path: string;
  /** Maps a runtime content index to the index stored in this save. */
  readonly toSaved: Uint16Array;
  /** The reverse. 0 if the content is gone. */
  readonly toRuntime: Uint16Array;
  /** Content ids present in the save but not in this build. */
  readonly missingContent: string[] = [];
  /** Their saved indices. */
  private readonly lost = new Map<number, string>();
  /**
   * What loading left out because its content is gone and the operator chose to go on. `count` is how many things of each
   * missing id. `burn` is what went with them and still has content, by item, for the ledger to burn: what a record of a
   * missing kind held, the rounds in a missing weapon. `pids` are the records of a missing kind, and `changed` and `chunks`
   * the records and chunks that held some of it. The next commit deletes the first and writes the others again
   * (Persistence.load), so one start is enough.
   */
  readonly dropped = { count: new Map<string, number>(), burn: new Map<number, number>(), pids: [] as number[], changed: new Set<number>(), chunks: new Set<number>() };
  /** Saved indices of ids that were renamed to more than one thing, and what they are now. */
  private readonly split = new Map<number, readonly number[]>();
  /** No commit has landed in the file, so it holds no world. */
  readonly fresh: boolean;
  /**
   * Loaded records whose vitals' rates may hold what a buff gave with no buff to end it: one saved before buffs were, or
   * one whose buff this build lacks. Their rates are worked out again (Buffs.restore).
   */
  readonly unrated = new Set<number>();

  private readonly reg: Registry;
  private readonly allowMissing: boolean;
  private readonly lock: SaveLock;
  private readonly putMeta: Statement;
  private readonly putChunk: Statement;
  private readonly putEntity: Statement;
  private readonly dropEntity: Statement;
  private readonly putJournal: Statement;
  private readonly putSurvivor: Statement;
  /** A record, and the part of it being written. Both grow when a record needs it (saveEntity). */
  private w = new BitWriter(65536);
  private c = new BitWriter(32768);
  /** A part of the record being written did not fit in `c`. */
  private cut = false;
  private readonly r = new BitReader();
  private readonly cr = new BitReader();

  constructor(path: string, reg: Registry, opts: StoreOptions = {}) {
    if (path === "" || path === ":memory:") throw new Error("a save needs a file: write-ahead logging does not work in memory");
    if (!opts.allowNetworkDisk) refuseNetworkDisk(path);
    this.path = path;
    this.reg = reg;
    this.allowMissing = opts.allowMissingContent ?? false;
    this.lock = holdSave(path);
    let opened: Database | null = null;
    try {
      const db = (opened = new Database(path, { create: true }));
      this.db = db;
      const mode = (db.query("PRAGMA journal_mode = WAL").get() as { journal_mode: string }).journal_mode;
      if (mode !== "wal") throw new Error(`${path} cannot use write-ahead logging here (the file system gave "${mode}"): put the save on a local disk`);
      // A file that held anything is checked before it is trusted. The check reads every page once.
      if ((db.query("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n > 0) {
        const found = (db.query("PRAGMA quick_check").all() as { quick_check: string }[]).map((r) => r.quick_check);
        if (found[0] !== "ok") throw Object.assign(new Error(found.slice(0, 3).join("; ")), { code: "SQLITE_CORRUPT" });
      }
      db.exec(`PRAGMA synchronous = ${opts.synchronous ?? "NORMAL"}`);
      // Milliseconds a commit waits for another program that holds the file (a backup, an operator's query). After that it
      // fails and is tried again later (Persistence.tryCommit), so a tick never stops for longer.
      db.exec("PRAGMA busy_timeout = 15");
      // SQLite checkpoints inside whichever commit passes this many WAL pages, which stops a tick for 3 to 20 ms. The server
      // checkpoints between ticks (checkpoint()), so this is only a ceiling of 64 MB for a host that nobody calls idle() on.
      db.exec("PRAGMA wal_autocheckpoint = 16000");
      // In bytes. After a burst the log file is cut back to this when it is next emptied.
      db.exec("PRAGMA journal_size_limit = 67108864");
      db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value) WITHOUT ROWID");

      const current = Number(this.meta("schema_version") ?? 0);
      // Every commit writes the tick. A file with tables and no tick is a first start that stopped before its first commit.
      this.fresh = this.meta("tick") === null;
      if (current > SCHEMA_VERSION) throw new Error(`save has schema ${current}; this build understands up to ${SCHEMA_VERSION}`);
      if (current < SCHEMA_VERSION) {
        // The save as it was, kept beside it before its form changes. An older copy of the same form is left alone.
        if (current > 0 && !existsSync(`${path}.pre-v${current}`)) db.query("VACUUM INTO ?").run(`${path}.pre-v${current}`);
        db.transaction(() => {
          for (let v = current; v < SCHEMA_VERSION; v++) MIGRATIONS[v]!(db);
          db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
        })();
      }

      // Intern every content id this build knows, then map the save's indices to runtime ones.
      const saved = new Map<string, number>();
      for (const row of db.query("SELECT idx, id FROM content_ids").all() as { idx: number; id: string }[]) saved.set(row.id, row.idx);
      const add = db.prepare("INSERT INTO content_ids (idx, id) VALUES (?, ?)");
      let high = 0;
      for (const idx of saved.values()) if (idx > high) high = idx;
      db.transaction(() => {
        for (let i = 1; i < reg.ids.length; i++) {
          if (saved.has(reg.ids[i]!)) continue;
          saved.set(reg.ids[i]!, ++high);
          add.run(high, reg.ids[i]!);
        }
      })();
      add.finalize();
      if (high > 65535) throw new Error("save has interned more than 65535 content ids");
      this.toSaved = new Uint16Array(reg.ids.length);
      this.toRuntime = new Uint16Array(high + 1);
      for (const [id, idx] of saved) {
        const runtime = reg.index.get(id);
        const renamed = reg.redirects.get(id);
        if (runtime !== undefined) {
          this.toSaved[runtime] = idx;
          this.toRuntime[idx] = runtime;
        } else if (renamed) {
          // What was saved under the old id is read as the new one, and written back under the new one's own row.
          this.toRuntime[idx] = renamed[0]!;
          if (renamed.length > 1) this.split.set(idx, renamed);
        } else {
          this.missingContent.push(id);
          this.lost.set(idx, id);
        }
      }
      if (this.missingContent.length > 0 && !opts.allowMissingContent && this.referencesMissing()) {
        db.close();
        throw new Error(`save uses content this build does not have: ${this.missingContent.join(", ")}: ${WITHOUT}`);
      }

      this.putMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      this.putChunk = db.prepare("INSERT OR REPLACE INTO chunk_structs (chunk, version, slots, data) VALUES (?, ?, ?, ?)");
      this.putEntity = db.prepare("INSERT OR REPLACE INTO entities (pid, kind, x, y, z, yaw, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
      this.dropEntity = db.prepare("DELETE FROM entities WHERE pid = ?");
      this.putJournal = db.prepare("INSERT INTO journal (seq, tick, op, data) VALUES (?, ?, ?, ?)");
      this.putSurvivor = db.prepare("INSERT OR REPLACE INTO survivors (name, pid) VALUES (?, ?)");
    } catch (err) {
      try {
        opened?.close();
      } catch {
        // It is being abandoned either way.
      }
      this.lock.release();
      const code = sqliteCode(err);
      if (sqliteIs(code, "SQLITE_CORRUPT") || sqliteIs(code, "SQLITE_NOTADB")) {
        const newest = listBackups(path)[0];
        throw new Error(`${path} is damaged (${err instanceof Error ? err.message : code}): ${newest ? `start with --restore ${newest}` : "there is no backup of it"}`);
      }
      throw err;
    }
  }

  /** Empties the write-ahead log into the file, closes it and lets go of the save. */
  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // A file that cannot be written is closed as it is.
    }
    // A statement left open keeps the connection, and its hold on the file, alive after close.
    for (const s of [this.putMeta, this.putChunk, this.putEntity, this.dropEntity, this.putJournal, this.putSurvivor]) s.finalize();
    this.db.close();
    this.lock.release();
  }

  meta(key: string): string | number | null {
    const row = this.db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string | number } | null;
    return row ? row.value : null;
  }

  transaction(write: () => void): void {
    this.db.transaction(write).immediate();
  }

  setMeta(key: string, value: string | number): void {
    this.putMeta.run(key, value);
  }

  saveChunk(chunk: number, t: ChunkTable): void {
    const n = t.high;
    const out = new Uint8Array(1 + n * SLOT_BYTES);
    out[0] = CHUNK_FORMAT;
    let off = 1;
    const kinds = new Uint16Array(n);
    for (let s = 0; s < n; s++) kinds[s] = this.toSaved[t.kind[s]!]!;
    for (const col of [kinds, t.x, t.y, t.z, t.yaw, t.owner, t.hp, t.mod]) {
      const bytes = new Uint8Array(col.buffer, col.byteOffset, n * col.BYTES_PER_ELEMENT);
      out.set(bytes, off);
      off += bytes.length;
    }
    this.putChunk.run(chunk, t.version, n, out);
  }

  /** Returns the number of structures. */
  loadChunks(structs: StructureStore): number {
    const rows = this.db.query("SELECT chunk, version, slots, data FROM chunk_structs").all() as { chunk: number; version: number; slots: number; data: Uint8Array }[];
    for (const row of rows) {
      const n = row.slots;
      if (row.data[0] !== CHUNK_FORMAT || row.data.length !== 1 + n * SLOT_BYTES) throw new Error(`chunk ${row.chunk}: unreadable structure data`);
      let off = 1;
      const take = <T extends Uint16Array | Uint32Array | Float32Array>(ctor: new (n: number) => T): T => {
        // Copy, because blob offsets are not aligned to the element size.
        const col = new ctor(n);
        const size = col.BYTES_PER_ELEMENT * n;
        new Uint8Array(col.buffer).set(row.data.subarray(off, off + size));
        off += size;
        return col;
      };
      const kind = take(Uint16Array);
      const x = take(Float32Array);
      const y = take(Float32Array);
      const z = take(Float32Array);
      const yaw = take(Uint16Array);
      const owner = take(Uint32Array);
      const hp = take(Float32Array);
      const mod = take(Uint32Array);
      for (let s = 0; s < n; s++) {
        const now = this.toRuntime[kind[s]!]!;
        if (now === 0 && kind[s] !== 0 && this.allowMissing) {
          this.drop(kind[s]!, 1);
          this.dropped.chunks.add(row.chunk);
        }
        structs.put(row.chunk, s, now, x[s]!, y[s]!, z[s]!, yaw[s]!, owner[s]!, hp[s]!, mod[s]!);
      }
      structs.setVersion(row.chunk, row.version);
    }
    return structs.count;
  }

  saveEntity(rec: EntityRecord): void {
    // A record that outgrows the writers is written again in larger ones, which are kept. Nothing is ever saved cut short.
    while (!this.encode(rec)) {
      if (this.cut) {
        if (this.c.buf.length >= MAX_PART) throw new Error(`record ${rec.pid} is too large to save: one part of it is over ${MAX_PART} bytes, the most a save holds`);
        this.c = new BitWriter(this.c.buf.length * 2);
      }
      if (this.w.overflow) this.w = new BitWriter(this.w.buf.length * 2);
    }
    this.putEntity.run(rec.pid, this.toSaved[rec.kind]!, rec.x, rec.y, rec.z, rec.yaw, this.w.bytes().slice());
  }

  /** Ends the part written in `c` and puts it in the record. */
  private part(component: number): void {
    if (this.c.overflow) this.cut = true;
    this.w.varint(component);
    this.w.blob(this.c.bytes());
  }

  /** Writes the record into `w`. False if it did not fit. */
  private encode(rec: EntityRecord): boolean {
    const w = this.w;
    const c = this.c;
    this.cut = false;
    w.reset();
    w.u8(RECORD_FORMAT);
    w.string(rec.name);
    const inv = rec.inv;
    const used = inv ? inv.used() : 0;
    const hasState = rec.dead || rec.expiresAt !== 0 || rec.held >= 0;
    const hasProgress = rec.xp > 0 || rec.engrams.length > 0 || rec.jobs.length > 0;
    const hasBreed = rec.mating || rec.mateReadyAt !== 0 || rec.grown !== 0 || rec.egg !== null;
    let refs = 0;
    for (let slot = 0; inv?.ref && slot < inv.cap; slot++) if (inv.item[slot] !== 0 && inv.ref[slot] !== 0) refs++;
    w.varint((refs > 0 ? 1 : 0) + (used > 0 ? 1 : 0) + (rec.vitals ? 1 : 0) + (rec.genome ? 1 : 0) + (rec.keyHash ? 1 : 0) + (rec.look ? 1 : 0) + (rec.markers.length > 0 ? 1 : 0) + (hasState ? 1 : 0) + (hasProgress ? 1 : 0) + (rec.team !== 0 ? 1 : 0) + (rec.at >= 0 ? 1 : 0) + (rec.tame || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1 || rec.saddle !== 0 ? 1 : 0) + (hasBreed ? 1 : 0) + (rec.buffs.length > 0 ? 1 : 0) + (rec.corpse ? 1 : 0) + rec.extra.size);
    if (rec.buffs.length > 0) {
      c.reset();
      c.varint(rec.buffs.length);
      for (const b of rec.buffs) {
        c.varint(this.toSaved[b.buff]!);
        c.uint53(b.until);
        c.uint53(b.by);
        c.f64(b.torpor);
      }
      // The health a second each adds follows them all, and only when one adds some, so a save without any reads as before.
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
    if (rec.tame || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1 || rec.saddle !== 0 || rec.wander) {
      c.reset();
      c.f32(rec.te);
      c.bool(rec.tame !== null);
      if (rec.tame) {
        c.f64(rec.tame.affinity);
        c.f64(rec.tame.sum);
        c.uint53(rec.tame.by);
      }
      // Older saves end before the stance and the follow target.
      c.u8(rec.stance);
      c.uint53(rec.follow);
      // Some saves have those two and end before the saddle, and some end before the wander.
      c.varint(rec.saddle === 0 ? 0 : this.toSaved[rec.saddle]!);
      c.bool(rec.wander);
      this.part(COMP_TAME);
    }
    if (rec.at >= 0) {
      c.reset();
      c.u32(rec.at);
      c.bits(rec.lock, 2);
      c.varint(rec.pin + 1);
      // Older saves end before a bed's wait and a burning fire.
      c.uint53(rec.readyAt);
      c.bool(rec.fire !== null);
      if (rec.fire) {
        c.uint53(rec.fire.at);
        c.varint(rec.fire.fuel);
        c.varint(rec.fire.cook);
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
      // The hotbar slot in hand plus one, or 0 for none. Older saves end before this.
      c.u8(rec.held + 1);
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
      }
      this.part(COMP_SLOTS2);
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

  deleteEntity(pid: number): void {
    this.dropEntity.run(pid);
  }

  loadEntities(): EntityRecord[] {
    const rows = this.db.query("SELECT pid, kind, x, y, z, yaw, data FROM entities").all() as { pid: number; kind: number; x: number; y: number; z: number; yaw: number; data: Uint8Array }[];
    const out: EntityRecord[] = [];
    const r = this.r;
    this.unrated.clear();
    for (const row of rows) {
      const kind = this.toRuntime[row.kind]!;
      if (kind === 0 && !this.allowMissing) continue;
      // Past here a kind of 0 is content that is gone, which the operator chose to go on without. The record is read all
      // the same, because what it held leaves the ledger with it.
      const rec = new EntityRecord(row.pid, kind);
      rec.x = row.x;
      rec.y = row.y;
      rec.z = row.z;
      rec.yaw = row.yaw;
      r.reset(row.data);
      const format = r.u8();
      if (format > RECORD_FORMAT) throw new Error(`entity ${row.pid} was saved by a newer build (record format ${format}, and this build reads up to ${RECORD_FORMAT}): start the save with that build or a newer one`);
      if (format === 0) throw new Error(`entity ${row.pid}: unknown record format`);
      let stale = format < FORMAT_BUFFS;
      rec.name = r.string(256);
      const c = this.cr;
      /** Slot and pid pairs, put on the inventory once every part is read. */
      const refs: number[] = [];
      for (let n = r.varint(); n > 0 && !r.overflow; n--) {
        const component = r.varint();
        const blob = r.blob(MAX_PART);
        c.reset(blob);
        if (component === COMP_INVENTORY) {
          // The oldest form is a list of items and counts. The inventory is sized to hold all of them, so converting loses nothing.
          const pairs: [number, number][] = [];
          let need = 0;
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const saved = c.varint();
            const count = c.varint();
            const item = this.item(saved, row.pid, count);
            if (item === 0) continue;
            pairs.push([item, count]);
            need += Math.ceil(count / (this.reg.stack[item] || 1));
          }
          if (need > MAX_INVENTORY_SLOTS) throw new Error(`entity ${row.pid}: its round 1 inventory needs ${need} slots and at most ${MAX_INVENTORY_SLOTS} can be represented`);
          const inv = (rec.inv = new Inventory(Math.max(40, need)));
          for (const [item, count] of pairs) {
            if (inv.add(item, count, 0, 0, 0, this.reg) !== 0) throw new Error(`entity ${row.pid}: could not convert its round 1 inventory`);
          }
        } else if (component === COMP_SLOTS) {
          const inv = (rec.inv = new Inventory(c.varint()));
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const slot = c.varint();
            const saved = c.varint();
            const count = c.varint();
            const item = this.item(saved, row.pid, count);
            const quality = c.u8();
            const dur = c.varint();
            const spoilAt = c.varint();
            if (item !== 0 && slot < inv.cap) inv.set(slot, item, count, quality, dur, spoilAt);
          }
        } else if (component === COMP_SLOTS2) {
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
            if (item === 0) {
              // The rounds in a weapon that is gone, and what was fixed to it, go with it.
              if (ammo !== 0 && loaded > 0) this.burn(ammo, loaded);
              if (attach !== 0) this.burn(attach, 1);
              continue;
            }
            if (slot >= inv.cap) continue;
            inv.set(slot, item, count, quality, dur, spoilAt);
            if (holds) inv.setGear(slot, ammo, ammo === 0 ? 0 : loaded, attach);
          }
        } else if (component === COMP_VITALS) {
          // The oldest food is dropped. The survival system starts this body full.
        } else if (component === COMP_VITALS4 || component === COMP_VITALS8 || component === COMP_VITALS53) {
          // COMP_VITALS4 has a four-bit mask, and a body saved in it has no torpor. The two older forms hold each value in 32 bits.
          const whole = component === COMP_VITALS53;
          const v = (rec.vitals = new Vitals());
          const mask = component === COMP_VITALS4 ? c.bits(4) : c.u8();
          v.tick = whole ? c.uint53() : c.varint();
          for (let i = 0; i < 8; i++) {
            if ((mask & (1 << i)) === 0) continue;
            const value = whole ? c.uint53() : c.varint();
            const rate = c.svarint();
            if (i >= V_COUNT) continue;
            v.value[i] = value;
            v.rate[i] = rate;
            // A placeholder until the survival system sets the true maximum from the body's stats.
            v.max[i] = value > 0 ? value : 1;
          }
          if (component !== COMP_VITALS4) rec.out = c.bool();
        } else if (component === COMP_GENOME) {
          const g = (rec.genome = new Genome());
          if (blob.length < STAT_COUNT * 3 + COLOR_REGIONS) throw new Error(`entity ${row.pid}: short genome`);
          for (const points of [g.wild, g.mutated, g.tamed, g.colors]) for (let i = 0; i < points.length; i++) points[i] = c.u8();
          g.mutMat = c.varint();
          g.mutPat = c.varint();
          g.mother = c.uint53();
          g.father = c.uint53();
          g.female = c.bool();
        } else if (component === COMP_IDENTITY) rec.keyHash = blob;
        // A look this build cannot read is kept in rec.extra and not worn.
        else if (component === COMP_LOOK && validLook(blob)) rec.look = blob;
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
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            // A job saved when recipes were definitions of their own names the recipe. Its rename leads to the item.
            const item = this.toRuntime[c.varint()] ?? 0;
            const left = c.varint();
            const doneAt = c.uint53();
            if (item !== 0) rec.jobs.push({ item, left, doneAt });
          }
        } else if (component === COMP_STATE) {
          rec.dead = c.bool();
          rec.expiresAt = c.uint53();
          rec.held = c.pos + 8 <= blob.length * 8 ? c.u8() - 1 : -1;
        } else if (component === COMP_TEAM) {
          rec.team = c.varint();
          rec.rank = c.u8();
        } else if (component === COMP_TAME) {
          rec.te = c.f32();
          if (c.bool()) rec.tame = { affinity: c.f64(), sum: c.f64(), by: c.uint53(), seen: -1, due: 0 };
          if (c.pos + 61 <= blob.length * 8) {
            rec.stance = c.u8();
            rec.follow = c.uint53();
            if (c.pos + 8 <= blob.length * 8) {
              const saved = c.varint();
              rec.saddle = saved === 0 ? 0 : (this.toRuntime[saved] ?? 0);
              if (c.pos + 1 <= blob.length * 8) rec.wander = c.bool();
            }
          }
        } else if (component === COMP_BREED || component === COMP_BREED2) {
          // COMP_BREED stored a start tick where COMP_BREED2 stores a span, so the span is the end minus that start.
          const began = component === COMP_BREED;
          rec.mating = c.bool();
          rec.mateReadyAt = c.uint53();
          const first = c.uint53();
          rec.grown = c.uint53();
          rec.span = !began ? first : rec.grown > first ? rec.grown - first : 0;
          if (c.bool()) {
            const species = this.toRuntime[c.varint()] ?? 0;
            const laid = c.uint53();
            const hatchAt = c.uint53();
            rec.egg = { species, span: !began ? laid : hatchAt > laid ? hatchAt - laid : 1, hatchAt, carrier: c.uint53() };
          }
        } else if (component === COMP_FIXTURE) {
          rec.at = c.u32();
          rec.lock = c.bits(2);
          rec.pin = c.varint() - 1;
          if (c.pos + 54 <= blob.length * 8) {
            rec.readyAt = c.uint53();
            if (c.bool()) rec.fire = { at: c.uint53(), fuel: c.varint(), cook: c.varint(), due: 0 };
          }
        } else if (component === COMP_BUFFS) {
          const read: { buff: number; until: number; by: number; torpor: number; health: number }[] = [];
          for (let k = c.varint(); k > 0 && !c.overflow; k--) read.push({ buff: this.toRuntime[c.varint()] ?? 0, until: c.uint53(), by: c.uint53(), torpor: c.f64(), health: 0 });
          // A save from before an instance could carry health has none after the list.
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
          rec.corpse = { species: this.toRuntime[c.varint()] ?? 0, max: c.f64(), left: c.f64(), span: c.varint(), young: c.bool(), out: c.bool(), life: c.uint53() };
        } else rec.extra.set(component, blob);
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
        continue;
      }
      if (stale && rec.vitals) this.unrated.add(row.pid);
      out.push(rec);
    }
    return out;
  }

  /** Counts `n` things of the missing content with saved index `saved` as left out. */
  private drop(saved: number, n: number): void {
    const id = this.lost.get(saved) ?? `content ${saved}`;
    this.dropped.count.set(id, (this.dropped.count.get(id) ?? 0) + n);
  }

  /** Counts `n` of `item` as gone with something that was left out. */
  private burn(item: number, n: number): void {
    this.dropped.burn.set(item, (this.dropped.burn.get(item) ?? 0) + n);
  }

  /** A null `data` deletes the blob. */
  saveBlob(chunk: number, tag: number, data: Uint8Array | null): void {
    if (data) this.db.query("INSERT OR REPLACE INTO chunk_blobs (chunk, tag, data) VALUES (?, ?, ?)").run(chunk, tag, data);
    else this.db.query("DELETE FROM chunk_blobs WHERE chunk = ? AND tag = ?").run(chunk, tag);
  }

  loadBlobs(tag: number): { chunk: number; data: Uint8Array }[] {
    return this.db.query("SELECT chunk, data FROM chunk_blobs WHERE tag = ?").all(tag) as { chunk: number; data: Uint8Array }[];
  }

  /** An item whose content is gone stops the load unless allowMissingContent is set. Then the `n` of it that record `pid` held are left out. */
  private item(saved: number, pid: number, n: number): number {
    const item = this.toRuntime[saved] ?? 0;
    if (item !== 0) return item;
    if (!this.allowMissing) throw new Error(`save uses content this build does not have: ${this.lost.get(saved) ?? "an item"}, held by record ${pid}: ${WITHOUT}`);
    this.drop(saved, n);
    this.dropped.changed.add(pid);
    return 0;
  }

  appendJournal(seq: number, tick: number, op: number, data: Uint8Array): void {
    this.putJournal.run(seq, tick, op, data);
  }

  /** 0 for an empty journal. */
  lastJournalSeq(): number {
    return Number((this.db.query("SELECT MAX(seq) AS seq FROM journal").get() as { seq: number | null }).seq ?? 0);
  }

  /** Keeps the newest `keep` entries. */
  pruneJournal(keep: number): void {
    this.db.query("DELETE FROM journal WHERE seq <= (SELECT MAX(seq) FROM journal) - ?").run(keep);
  }

  journal(afterSeq = 0): JournalEntry[] {
    return this.db.query("SELECT seq, tick, op, data FROM journal WHERE seq > ? ORDER BY seq").all(afterSeq) as JournalEntry[];
  }

  saveSurvivor(name: string, pid: number): void {
    this.putSurvivor.run(name, pid);
  }

  survivors(): Map<string, number> {
    const out = new Map<string, number>();
    for (const row of this.db.query("SELECT name, pid FROM survivors").all() as { name: string; pid: number }[]) out.set(row.name, row.pid);
    return out;
  }

  private referencesMissing(): boolean {
    // Ids are interned when a build first sees them, so one can be missing while nothing in the save uses it. Only real use blocks loading.
    const missing = new Set<number>();
    for (const row of this.db.query("SELECT idx, id FROM content_ids").all() as { idx: number; id: string }[]) {
      if (this.missingContent.includes(row.id)) missing.add(row.idx);
    }
    for (const row of this.db.query("SELECT DISTINCT kind FROM entities").all() as { kind: number }[]) if (missing.has(row.kind)) return true;
    for (const row of this.db.query("SELECT slots, data FROM chunk_structs").all() as { slots: number; data: Uint8Array }[]) {
      for (let s = 0; s < row.slots; s++) if (missing.has(row.data[1 + s * 2]! | (row.data[2 + s * 2]! << 8))) return true;
    }
    return false;
  }
}
