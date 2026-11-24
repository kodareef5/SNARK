// Durable world state in one SQLite database. One commit is one transaction, so a crash lands the whole world on a commit boundary.
// Saves refer to content by string id through content_ids, never by a build's dense index, so adding content does not disturb them.
// The map's statics are the map's: chunk_structs holds only the chunks that no longer stand as the map placed them, and of
// each only what differs from the map, laid over the map's on load.

import { Database, type Statement } from "bun:sqlite";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { ROW_BITS_MOST, ROW_FREE, ROW_KEYED, RowCoder } from "../../shared/world/rows.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import type { EntityRecord } from "../records.ts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RecordCodec, WITHOUT, idMap, type RecordRow } from "./codec.ts";
import { listBackups } from "./backup.ts";
import { refuseNetworkDisk } from "./disk.ts";
import { holdSave, type SaveLock } from "./lock.ts";

export const SCHEMA_VERSION = 6;
/**
 * A chunk's structures as what differs from the map. Integers are little-endian, and a varint is 7 bits a byte, low first.
 *   format u8, the chunk's map slots u16
 *   changed map slots varint, then entries in ascending slots until that many are told:
 *     slots skipped since the entry before varint, flags u8, then as flagged the kind u16, health f32, owner u32, and the
 *     count less one varint of slots in a row that are the same
 *   live slots past the map's varint, then each as a row of a chunk message (shared/world/rows.ts), from the map's last
 *     slot on: free by its pose or keyed by its frame and key, its health exact
 * A map slot keeps the map's kind, its kind's health and no owner where no flag says otherwise. Kinds are the save's ids.
 * A frame a row names is a row of `frames`, never defined in the bytes.
 */
const CHUNK_FORMAT = 3;
const SLOT_EMPTY = 1;
const SLOT_KIND = 2;
const SLOT_HP = 4;
const SLOT_OWNER = 8;
const SLOT_RUN = 16;
/** The most bytes one changed map slot takes. */
const CHANGED_BYTES = 3 + 1 + 2 + 4 + 4;

/** What reads a chunk's saved structures is told: its map slot count, each changed map slot, each slot past the map's. */
interface ChunkVisitor {
  head(mapped: number): void;
  /** `flags` says which of `kind` (the save's id), `hp` and `owner` were saved. With SLOT_EMPTY the slot holds nothing. */
  changed(slot: number, flags: number, kind: number, hp: number, owner: number): void;
  /** `row` holds the row just read: its slot, its kind (`saved` the save's id), and its pose or its frame and key. */
  built(row: RowCoder): void;
}

const reader = new BitReader();

/**
 * Reads a chunk's saved structures to `to`, its rows through `rows`, their places told from the chunk's corner (x0, z0)
 * metres. Throws for a format this build does not read and for bytes that are not one.
 */
function readChunk(chunk: number, data: Uint8Array, rows: RowCoder, x0: number, z0: number, to: ChunkVisitor): void {
  if (data[0] !== CHUNK_FORMAT) throw new Error(`chunk ${chunk}: its structures were saved in format ${data[0]}, and this build reads ${CHUNK_FORMAT}: old saves are not read, so start a new save`);
  const r = reader;
  r.reset(data);
  r.u8();
  const bad = (): never => {
    throw new Error(`chunk ${chunk}: unreadable structure data`);
  };
  const mapped = r.u16();
  if (r.overflow) bad();
  to.head(mapped);
  let slot = 0;
  for (let left = r.varint(); left > 0; ) {
    slot += r.varint();
    const flags = r.u8();
    const kind = flags & SLOT_KIND ? r.u16() : 0;
    const hp = flags & SLOT_HP ? r.f32() : 0;
    const owner = flags & SLOT_OWNER ? r.u32() : 0;
    const n = flags & SLOT_RUN ? r.varint() + 1 : 1;
    if (r.overflow || n > left || slot + n > mapped) bad();
    for (const end = slot + n; slot < end; slot++) to.changed(slot, flags, kind, hp, owner);
    left -= n;
  }
  rows.begin(x0, z0, mapped - 1);
  for (let left = r.varint(); left > 0; left--) {
    rows.read(r);
    if (r.overflow || rows.slot > 0xffff || (rows.form !== ROW_FREE && rows.form !== ROW_KEYED)) bad();
    to.built(rows);
  }
  // The rows end within the last byte.
  if (r.overflow || r.remainingBits >= 8) bad();
}

// chunk_blobs holds per-chunk state other than structures, keyed by tag. transfers holds what left this world for another
// of its cluster, and what came (server/cluster/cluster.ts). frames holds each base some saved chunk has a row of: its
// origin in lattice units, its turn and its team.
const SCHEMA = `
  CREATE TABLE content_ids (idx INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE);
  CREATE TABLE chunk_structs (chunk INTEGER PRIMARY KEY, version INTEGER NOT NULL, data BLOB NOT NULL);
  CREATE TABLE frames (gid INTEGER PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL, z INTEGER NOT NULL, yaw INTEGER NOT NULL, team INTEGER NOT NULL);
  CREATE TABLE entities (pid INTEGER PRIMARY KEY, kind INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, yaw INTEGER NOT NULL, data BLOB NOT NULL);
  CREATE TABLE survivors (name TEXT PRIMARY KEY, pid INTEGER NOT NULL) WITHOUT ROWID;
  CREATE TABLE journal (seq INTEGER PRIMARY KEY, tick INTEGER NOT NULL, op INTEGER NOT NULL, data BLOB NOT NULL);
  CREATE TABLE chunk_blobs (chunk INTEGER NOT NULL, tag INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (chunk, tag)) WITHOUT ROWID;
  CREATE TABLE transfers (id TEXT NOT NULL, dir INTEGER NOT NULL, pid INTEGER NOT NULL, name TEXT NOT NULL, hop INTEGER NOT NULL, peer INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (id, dir)) WITHOUT ROWID;
`;

/**
 * A transfer as a save records it: `dir` is TRANSFER_OUT for one that left and TRANSFER_IN for one that came, `peer` the
 * other world, `hop` how many times the record had changed worlds, and `at` the wall clock in milliseconds.
 */
export interface TransferRow {
  id: string;
  dir: number;
  pid: number;
  name: string;
  hop: number;
  peer: number;
  at: number;
}
export const TRANSFER_OUT = 0;
export const TRANSFER_IN = 1;

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
  /** Content ids present in the save but not in this build. */
  readonly missingContent: string[] = [];
  /** No commit has landed in the file, so it holds no world. */
  readonly fresh: boolean;
  /**
   * The save's own name for itself, kept for good from its first commit (a backup has its save's), so a cluster can tell it
   * from another save of the same world. The world id its records are numbered under is `meta("world_id")`, 1 where absent.
   */
  readonly saveId: string;
  /** Writes and reads records against the save's table of content ids. */
  readonly codec: RecordCodec;

  private readonly allowMissing: boolean;
  private readonly maxHp: Float32Array;
  private readonly lock: SaveLock;
  private readonly putMeta: Statement;
  private readonly putChunk: Statement;
  private readonly dropChunk: Statement;
  private readonly putFrame: Statement;
  private readonly dropFrame: Statement;
  /** The team of each frame the save has a row for, and the frames each saved chunk's rows name. */
  private readonly framesSaved = new Map<number, number>();
  private readonly chunkFrames = new Map<number, number[]>();
  /** What puts those two back as they were, should the transaction that changed them fail. */
  private readonly undo: (() => void)[] = [];
  /** Writes and reads a chunk's rows, made for the store whose chunks are first saved or loaded. */
  private rows: RowCoder | null = null;
  private w = new BitWriter(4096);
  private readonly putEntity: Statement;
  private readonly dropEntity: Statement;
  private readonly putJournal: Statement;
  private readonly putSurvivor: Statement;
  private readonly putTransfer: Statement;

  /** Maps a runtime content index to the index stored in this save. */
  get toSaved(): Uint16Array {
    return this.codec.toSaved;
  }

  /** The reverse. 0 if the content is gone. */
  get toRuntime(): Uint16Array {
    return this.codec.toRuntime;
  }

  /**
   * What loading left out because its content is gone and the operator chose to go on (RecordCodec.dropped). The next commit
   * deletes its records and writes the others again (Persistence.load), so one start is enough.
   */
  get dropped(): RecordCodec["dropped"] {
    return this.codec.dropped;
  }

  /** Loaded records whose rates are worked out again (RecordCodec.unrated). */
  get unrated(): Set<number> {
    return this.codec.unrated;
  }

  constructor(path: string, reg: Registry, opts: StoreOptions = {}) {
    if (path === "" || path === ":memory:") throw new Error("a save needs a file: write-ahead logging does not work in memory");
    // A save in a folder not made yet makes it, as ARK makes its SavedArks.
    mkdirSync(dirname(resolve(path)), { recursive: true });
    if (!opts.allowNetworkDisk) refuseNetworkDisk(path);
    this.path = path;
    this.allowMissing = opts.allowMissingContent ?? false;
    this.maxHp = reg.maxHp;
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
      // Kept from the first open, so a first start that stopped before its first commit is the same save the next time.
      const named = this.meta("save_id");
      this.saveId = typeof named === "string" && named !== "" ? named : [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (named !== this.saveId) db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('save_id', ?)").run(this.saveId);
      if (current === 0) {
        db.transaction(() => {
          db.exec(SCHEMA);
          db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
        })();
      } else if (current !== SCHEMA_VERSION) {
        // Nothing older stays readable (planning/direction.md), so there is no step from one schema to the next.
        throw new Error(`save has schema ${current}, and this build reads ${SCHEMA_VERSION}: ${current < SCHEMA_VERSION ? "old saves are not read, so start a new save" : "a newer build wrote it"}`);
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
      // What was saved under an old id is read as the new one, and written back under the new one's own row.
      const map = idMap(reg, saved, high);
      const toSaved = new Uint16Array(reg.ids.length);
      for (const [id, idx] of saved) {
        const runtime = reg.index.get(id);
        if (runtime !== undefined) toSaved[runtime] = idx;
      }
      this.missingContent.push(...map.lost.values());
      this.codec = new RecordCodec(toSaved, map, opts.allowMissingContent ?? false);
      if (this.missingContent.length > 0 && !opts.allowMissingContent && this.referencesMissing()) {
        db.close();
        throw new Error(`save uses content this build does not have: ${this.missingContent.join(", ")}: ${WITHOUT}`);
      }

      this.putMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      this.putChunk = db.prepare("INSERT OR REPLACE INTO chunk_structs (chunk, version, data) VALUES (?, ?, ?)");
      this.dropChunk = db.prepare("DELETE FROM chunk_structs WHERE chunk = ?");
      this.putFrame = db.prepare("INSERT OR REPLACE INTO frames (gid, x, y, z, yaw, team) VALUES (?, ?, ?, ?, ?, ?)");
      this.dropFrame = db.prepare("DELETE FROM frames WHERE gid = ?");
      this.putEntity = db.prepare("INSERT OR REPLACE INTO entities (pid, kind, x, y, z, yaw, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
      this.dropEntity = db.prepare("DELETE FROM entities WHERE pid = ?");
      this.putJournal = db.prepare("INSERT INTO journal (seq, tick, op, data) VALUES (?, ?, ?, ?)");
      this.putSurvivor = db.prepare("INSERT OR REPLACE INTO survivors (name, pid) VALUES (?, ?)");
      this.putTransfer = db.prepare("INSERT OR REPLACE INTO transfers (id, dir, pid, name, hop, peer, at) VALUES (?, ?, ?, ?, ?, ?, ?)");
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
    for (const s of [this.putMeta, this.putChunk, this.dropChunk, this.putFrame, this.dropFrame, this.putEntity, this.dropEntity, this.putJournal, this.putSurvivor, this.putTransfer]) s.finalize();
    this.db.close();
    this.lock.release();
  }

  meta(key: string): string | number | null {
    const row = this.db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string | number } | null;
    return row ? row.value : null;
  }

  transaction(write: () => void): void {
    this.undo.length = 0;
    try {
      this.db.transaction(write).immediate();
    } catch (err) {
      // Nothing was written, so what was noted of frames is taken back.
      for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i]!();
      throw err;
    } finally {
      this.undo.length = 0;
    }
  }

  setMeta(key: string, value: string | number): void {
    this.putMeta.run(key, value);
  }

  /** The coder of a chunk's rows, for `structs`' forms: kinds as the save's ids and health exact. */
  private coder(structs: StructureStore): RowCoder {
    return (this.rows ??= new RowCoder(structs.forms, this.maxHp, { kindOut: this.toSaved, kindIn: this.toRuntime, exact: true }));
  }

  /** Notes which frames the chunk's saved rows name, to be put back if the transaction fails. */
  private names(chunk: number, gids: number[] | null): void {
    const was = this.chunkFrames.get(chunk);
    if ((was?.length ?? 0) === (gids?.length ?? 0) && (was ?? []).every((gid, i) => gid === gids![i])) return;
    this.undo.push(() => void (was ? this.chunkFrames.set(chunk, was) : this.chunkFrames.delete(chunk)));
    if (gids) this.chunkFrames.set(chunk, gids);
    else this.chunkFrames.delete(chunk);
  }

  /**
   * Writes what differs from the map in `chunk`: its changed map slots, with neighbours that are the same told as one, and
   * its live slots past the map's as rows. A chunk that stands as placed has no row, so one that does again loses its row.
   * A frame its rows name is written with it if the save has it not, or under another team, and a frame its rows named
   * before that has since gone is deleted.
   */
  saveChunk(chunk: number, structs: StructureStore): void {
    const t = structs.chunks[chunk];
    const named = this.chunkFrames.get(chunk);
    if (!t || t.differs === 0) this.dropChunk.run(chunk);
    else {
      const list = structs.changedSlots(chunk);
      const built = t.differs - t.changed;
      const room = 3 + 5 + list.length * CHANGED_BYTES + 5 + Math.ceil((built * ROW_BITS_MOST) / 8) + 1;
      if (room > this.w.buf.length) this.w = new BitWriter(Math.max(room, this.w.buf.length * 2));
      const w = this.w;
      w.reset();
      w.u8(CHUNK_FORMAT);
      w.u16(t.mapped);
      w.varint(list.length);
      const flagsOf = (s: number): number => {
        const kind = t.kind[s]!;
        if (kind === 0) return SLOT_EMPTY;
        return (kind !== structs.mapKind(chunk, s) ? SLOT_KIND : 0) | (t.hp[s] !== this.maxHp[kind] ? SLOT_HP : 0) | (t.owner[s] !== 0 ? SLOT_OWNER : 0);
      };
      let next = 0;
      for (let i = 0; i < list.length; ) {
        const s = list[i]!;
        const flags = flagsOf(s);
        // Neighbours that say the same are one entry: a storey levelled, or a wall given to one owner.
        let n = 1;
        for (; i + n < list.length; n++) {
          const u = list[i + n]!;
          if (u !== s + n || flagsOf(u) !== flags) break;
          if ((flags & SLOT_KIND && t.kind[u] !== t.kind[s]) || (flags & SLOT_HP && t.hp[u] !== t.hp[s]) || (flags & SLOT_OWNER && t.owner[u] !== t.owner[s])) break;
        }
        w.varint(s - next);
        w.u8(flags | (n > 1 ? SLOT_RUN : 0));
        if (flags & SLOT_KIND) w.u16(this.toSaved[t.kind[s]!]!);
        if (flags & SLOT_HP) w.f32(t.hp[s]!);
        if (flags & SLOT_OWNER) w.u32(t.owner[s]!);
        if (n > 1) w.varint(n - 1);
        next = s + n;
        i += n;
      }
      w.varint(built);
      const rows = this.coder(structs);
      rows.begin(chunkCx(structs.dims, chunk) * CHUNK_SIZE, chunkCz(structs.dims, chunk) * CHUNK_SIZE, t.mapped - 1);
      for (let s = t.mapped; s < t.high; s++) if (t.kind[s] !== 0) rows.write(w, t, s, false, false, structs.frames);
      if (w.overflow) throw new Error(`chunk ${chunk}: its structures do not fit the room made for them`);
      this.putChunk.run(chunk, t.version, w.bytes());
    }
    const now = t && t.differs !== 0 ? structs.frames.listed(chunk) : [];
    for (const f of now) {
      const was = this.framesSaved.get(f.gid);
      if (was === f.team) continue;
      this.putFrame.run(f.gid, f.ox, f.oy, f.oz, f.yaw, f.team);
      this.undo.push(() => void (was === undefined ? this.framesSaved.delete(f.gid) : this.framesSaved.set(f.gid, was)));
      this.framesSaved.set(f.gid, f.team);
    }
    // A frame goes with its last row, and that row's chunk is saved after it.
    for (const gid of named ?? []) {
      const team = this.framesSaved.get(gid);
      if (team === undefined || structs.frames.get(gid)) continue;
      this.dropFrame.run(gid);
      this.undo.push(() => void this.framesSaved.set(gid, team));
      this.framesSaved.delete(gid);
    }
    this.names(chunk, now.length > 0 ? now.map((f) => f.gid) : null);
  }

  /**
   * Lays the saved chunks over what `structs` holds, which is the map's statics as placeStatics set them down: each changed
   * map slot where the map has it, then the slots past the map's, a keyed row in its saved frame by its key and a free
   * row left free. A slot's `mod` is not saved. Each loaded slot takes its chunk's version, which is right for a client,
   * since every client starts from none. Returns the number of structures.
   */
  loadChunks(structs: StructureStore): number {
    // The frames first, under their own numbers, so that a base is one frame whatever order its rows come in.
    for (const f of this.db.query("SELECT gid, x, y, z, yaw, team FROM frames").all() as { gid: number; x: number; y: number; z: number; yaw: number; team: number }[]) {
      structs.frames.make(f.x, f.y, f.z, f.yaw, f.team, f.gid);
      this.framesSaved.set(f.gid, f.team);
    }
    structs.frames.next = Math.max(structs.frames.next, Number(this.meta("frame_next") ?? 0));
    const rows = this.db.query("SELECT chunk, version, data FROM chunk_structs").all() as { chunk: number; version: number; data: Uint8Array }[];
    const coder = this.coder(structs);
    for (const row of rows) {
      const chunk = row.chunk;
      const named: number[] = [];
      // A kind this build lacks is left out, and counted where the operator chose to go on without it.
      const lost = (kind: number): void => {
        if (!this.allowMissing) return;
        this.codec.drop(kind, 1);
        this.dropped.chunks.add(chunk);
      };
      readChunk(chunk, row.data, coder, chunkCx(structs.dims, chunk) * CHUNK_SIZE, chunkCz(structs.dims, chunk) * CHUNK_SIZE, {
        head: (mapped) => {
          const here = structs.chunks[chunk]?.mapped ?? 0;
          if (mapped !== here) throw new Error(`chunk ${chunk}: saved over ${mapped} pieces of the map's, and this map sets down ${here} there`);
        },
        changed: (slot, flags, kind, hp, owner) => {
          const now = flags & SLOT_EMPTY ? 0 : flags & SLOT_KIND ? this.toRuntime[kind]! : structs.mapKind(chunk, slot);
          if (now === 0 && flags & SLOT_KIND) lost(kind);
          structs.putMapped(chunk, slot, now, now === 0 ? 0 : owner, now === 0 ? 0 : flags & SLOT_HP ? hp : this.maxHp[now]!, row.version);
        },
        built: (r) => {
          const now = r.kind;
          if (r.form === ROW_KEYED && named[named.length - 1] !== r.fr && !named.includes(r.fr)) named.push(r.fr);
          if (now === 0) return lost(r.saved);
          const hp = r.health(this.maxHp[now]!);
          if (r.form === ROW_FREE) return structs.put(chunk, r.slot, now, r.x, r.y, r.z, r.yaw, r.owner, hp, row.version, 0);
          const at = structs.keyedPose(chunk, now, r.fr, r.k0, r.k1);
          if (!at) throw new Error(`chunk ${chunk}: the piece in slot ${r.slot} was saved by a key that is no slot of its form in a frame the save has: old saves are not read, so start a new save`);
          structs.put(chunk, r.slot, now, at.x / STRUCT_UNITS, at.y / STRUCT_UNITS, at.z / STRUCT_UNITS, at.yaw, r.owner, hp, row.version, r.fr, r.k0, r.k1);
        },
      });
      if (named.length > 0) this.chunkFrames.set(chunk, named);
      structs.setVersion(chunk, row.version);
    }
    // A frame all of whose rows were left out stands in no chunk. The save lets go of it when its chunk is next written.
    for (const gid of this.framesSaved.keys()) structs.frames.drop(gid);
    return structs.count;
  }

  saveEntity(rec: EntityRecord): void {
    const data = this.codec.encode(rec);
    this.putEntity.run(rec.pid, this.toSaved[rec.kind]!, rec.x, rec.y, rec.z, rec.yaw, data.slice());
  }

  deleteEntity(pid: number): void {
    this.dropEntity.run(pid);
  }

  loadEntities(): EntityRecord[] {
    const rows = this.db.query("SELECT pid, kind, x, y, z, yaw, data FROM entities").all() as RecordRow[];
    const out: EntityRecord[] = [];
    this.unrated.clear();
    for (const row of rows) {
      const rec = this.codec.decode(row);
      if (rec) out.push(rec);
    }
    return out;
  }

  /** A null `data` deletes the blob. */
  saveBlob(chunk: number, tag: number, data: Uint8Array | null): void {
    if (data) this.db.query("INSERT OR REPLACE INTO chunk_blobs (chunk, tag, data) VALUES (?, ?, ?)").run(chunk, tag, data);
    else this.db.query("DELETE FROM chunk_blobs WHERE chunk = ? AND tag = ?").run(chunk, tag);
  }

  loadBlobs(tag: number): { chunk: number; data: Uint8Array }[] {
    return this.db.query("SELECT chunk, data FROM chunk_blobs WHERE tag = ?").all(tag) as { chunk: number; data: Uint8Array }[];
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

  saveTransfer(t: TransferRow): void {
    this.putTransfer.run(t.id, t.dir, t.pid, t.name, t.hop, t.peer, t.at);
  }

  transfers(): TransferRow[] {
    return this.db.query("SELECT id, dir, pid, name, hop, peer, at FROM transfers").all() as TransferRow[];
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
    let used = false;
    // The rows are walked without the forms, for the kinds they name alone.
    const rows = new RowCoder(null, this.maxHp, { exact: true });
    for (const row of this.db.query("SELECT chunk, data FROM chunk_structs").all() as { chunk: number; data: Uint8Array }[]) {
      readChunk(row.chunk, row.data, rows, 0, 0, { head: () => {}, changed: (_slot, flags, kind) => (used ||= (flags & SLOT_KIND) !== 0 && missing.has(kind)), built: (r) => (used ||= missing.has(r.saved)) });
    }
    return used;
  }
}

/** A save as it was at its last commit, read by another program while its server may run (server/cluster/audit.ts). */
export interface SaveView {
  tick: number;
  world: number;
  ledger: string | null;
  records: EntityRecord[];
  transfers: TransferRow[];
}

/** Reads a save without holding it or changing it, in one read transaction, so what it gives is one commit's. */
export function readSave(path: string, reg: Registry): SaveView {
  const db = new Database(path, { readonly: true });
  try {
    db.exec("BEGIN");
    const meta = (key: string): string | number | null => (db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string | number } | null)?.value ?? null;
    const saved = new Map<string, number>();
    let high = 0;
    for (const row of db.query("SELECT idx, id FROM content_ids").all() as { idx: number; id: string }[]) {
      saved.set(row.id, row.idx);
      if (row.idx > high) high = row.idx;
    }
    // What this build lacks is counted as left out, not refused: the reader is only counting.
    const codec = new RecordCodec(new Uint16Array(reg.ids.length), idMap(reg, saved, high), true);
    const records: EntityRecord[] = [];
    for (const row of db.query("SELECT pid, kind, x, y, z, yaw, data FROM entities").all() as RecordRow[]) {
      const rec = codec.decode(row);
      if (rec) records.push(rec);
    }
    const ledger = meta("ledger");
    const transfers = db.query("SELECT id, dir, pid, name, hop, peer, at FROM transfers").all() as TransferRow[];
    db.exec("COMMIT");
    return { tick: Number(meta("tick") ?? 0), world: Number(meta("world_id") ?? 1), ledger: typeof ledger === "string" ? ledger : null, records, transfers };
  } finally {
    db.close();
  }
}
