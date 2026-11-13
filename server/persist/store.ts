// Durable world state in one SQLite database (WAL mode).
//
// The rule that prevents duplication and loss: one commit is one transaction,
// and it contains every record touched by every valuable change since the last
// commit. A crash therefore lands the whole world on a commit boundary. There
// is no second store that could disagree with this one.
//
//   meta           schema version, world id, tick, id sequence
//   content_ids    stable content id <-> the integer used in this save
//   chunk_structs  one row per chunk: the structure table as column blobs
//   entities       one row per persistent entity: position columns + record blob
//   survivors      login name -> pid (placeholder until accounts exist)
//   journal        append-only log of valuable operations, written in the same
//                  transaction as the state they produced
//
// Saves store content by string id through content_ids, never by the dense
// index of a particular content build, so adding content does not disturb them.

import { Database, type Statement } from "bun:sqlite";
import type { Registry } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { COLOR_REGIONS, Genome, STAT_COUNT } from "../../shared/sim/genome.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import type { ChunkTable, StructureStore } from "../../shared/world/structures.ts";
import { EntityRecord } from "../records.ts";
import { validLook } from "../../shared/anim/look.ts";

export const SCHEMA_VERSION = 2;
const CHUNK_FORMAT = 1;
const RECORD_FORMAT = 1;
// A record is a list of components, each an id and a length-prefixed blob. A
// build that does not know a component keeps its bytes and writes them back,
// so a save survives a round trip through a server missing some content pack.
const COMP_INVENTORY = 1;
const COMP_VITALS = 2;
const COMP_GENOME = 3;
// 4 (progression) and 5 (markers) are reserved; see planning/architecture/gameplay-model.md.
const COMP_IDENTITY = 6;
// Components 1 and 2 are round 1's inventory (item and count pairs) and food.
// They are read once: the inventory becomes slots, the food is refilled. They are never written.
const COMP_SLOTS = 7;
const COMP_VITALS4 = 8;
const COMP_MARKERS = 5;
/** Dead flag and expiry tick. */
const COMP_STATE = 9;
/** A survivor's look: the bytes of shared/anim/look.ts. */
const COMP_LOOK = 10;
/** Slots as component 7 has them, with the bag's size and, for weapons, what each holds. */
const COMP_SLOTS2 = 11;
/** Vitals with room for eight, and whether the body is unconscious. COMP_VITALS4 held four and is still read. */
const COMP_VITALS8 = 12;
/** The team that owns it, and its rank there. */
const COMP_TEAM = 13;
/** Taming: how well a tamed creature was tamed; and, for one lying there being tamed, what it has been given so far and for whom. */
const COMP_TAME = 15;
/** The state of something built: the ref of the structure it belongs to, whether it is locked, and its PIN plus one. */
const COMP_FIXTURE = 14;
/** Experience, learned engrams, crafting jobs. */
const COMP_PROGRESSION = 4;
/** The most slots a round 1 inventory is laid out in when it is converted. */
const MAX_INVENTORY_SLOTS = 255;
/** Bytes per structure slot in a chunk blob. */
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
  // Schema 2: small per-chunk state other than structures, by tag. First use: resource nodes that have been touched.
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
  /** "NORMAL" survives a process crash; "FULL" also survives power loss, at an fsync per commit. */
  synchronous?: "NORMAL" | "FULL";
  /** Load saves that reference content ids this build lacks, dropping those objects. */
  allowMissingContent?: boolean;
}

export class WorldStore {
  readonly db: Database;
  /** Runtime content index -> index stored in this save. */
  readonly toSaved: Uint16Array;
  /** Index stored in this save -> runtime content index, 0 if the content is gone. */
  readonly toRuntime: Uint16Array;
  /** Content ids present in the save but not in this build. */
  readonly missingContent: string[] = [];
  readonly fresh: boolean;

  private readonly reg: Registry;
  private readonly allowMissing: boolean;
  private readonly putMeta: Statement;
  private readonly putChunk: Statement;
  private readonly putEntity: Statement;
  private readonly dropEntity: Statement;
  private readonly putJournal: Statement;
  private readonly putSurvivor: Statement;
  private readonly w = new BitWriter(65536);
  private readonly c = new BitWriter(32768);
  private readonly r = new BitReader();
  private readonly cr = new BitReader();

  constructor(path: string, reg: Registry, opts: StoreOptions = {}) {
    const db = new Database(path, { create: true });
    this.db = db;
    this.reg = reg;
    this.allowMissing = opts.allowMissingContent ?? false;
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`PRAGMA synchronous = ${opts.synchronous ?? "NORMAL"}`);
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value) WITHOUT ROWID");

    const current = Number(this.meta("schema_version") ?? 0);
    this.fresh = current === 0;
    if (current > SCHEMA_VERSION) throw new Error(`save has schema ${current}; this build understands up to ${SCHEMA_VERSION}`);
    if (current < SCHEMA_VERSION) {
      db.transaction(() => {
        for (let v = current; v < SCHEMA_VERSION; v++) MIGRATIONS[v]!(db);
        db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
      })();
    }

    // Intern every content id this build knows; map the save's indices to ours.
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
    if (high > 65535) throw new Error("save has interned more than 65535 content ids");
    this.toSaved = new Uint16Array(reg.ids.length);
    this.toRuntime = new Uint16Array(high + 1);
    for (const [id, idx] of saved) {
      const runtime = reg.index.get(id);
      if (runtime === undefined) this.missingContent.push(id);
      else {
        this.toSaved[runtime] = idx;
        this.toRuntime[idx] = runtime;
      }
    }
    if (this.missingContent.length > 0 && !opts.allowMissingContent && this.referencesMissing()) {
      db.close();
      throw new Error(`save uses content this build does not have: ${this.missingContent.join(", ")}`);
    }

    this.putMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    this.putChunk = db.prepare("INSERT OR REPLACE INTO chunk_structs (chunk, version, slots, data) VALUES (?, ?, ?, ?)");
    this.putEntity = db.prepare("INSERT OR REPLACE INTO entities (pid, kind, x, y, z, yaw, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.dropEntity = db.prepare("DELETE FROM entities WHERE pid = ?");
    this.putJournal = db.prepare("INSERT INTO journal (seq, tick, op, data) VALUES (?, ?, ?, ?)");
    this.putSurvivor = db.prepare("INSERT OR REPLACE INTO survivors (name, pid) VALUES (?, ?)");
  }

  close(): void {
    this.db.close();
  }

  meta(key: string): string | number | null {
    const row = this.db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string | number } | null;
    return row ? row.value : null;
  }

  /** Run `write` inside one transaction. Everything it stores commits together or not at all. */
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

  /** Restore every saved chunk into `structs`. Returns the number of structures. */
  loadChunks(structs: StructureStore): number {
    const rows = this.db.query("SELECT chunk, version, slots, data FROM chunk_structs").all() as { chunk: number; version: number; slots: number; data: Uint8Array }[];
    for (const row of rows) {
      const n = row.slots;
      if (row.data[0] !== CHUNK_FORMAT || row.data.length !== 1 + n * SLOT_BYTES) throw new Error(`chunk ${row.chunk}: unreadable structure data`);
      let off = 1;
      const take = <T extends Uint16Array | Uint32Array | Float32Array>(ctor: new (n: number) => T): T => {
        // Copy rather than view: blob offsets are not aligned to the element size.
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
        structs.put(row.chunk, s, this.toRuntime[kind[s]!]!, x[s]!, y[s]!, z[s]!, yaw[s]!, owner[s]!, hp[s]!, mod[s]!);
      }
      structs.setVersion(row.chunk, row.version);
    }
    return structs.count;
  }

  saveEntity(rec: EntityRecord): void {
    const w = this.w;
    const c = this.c;
    w.reset();
    w.u8(RECORD_FORMAT);
    w.string(rec.name);
    const inv = rec.inv;
    const used = inv ? inv.used() : 0;
    const hasState = rec.dead || rec.expiresAt !== 0 || rec.held >= 0;
    const hasProgress = rec.xp > 0 || rec.engrams.length > 0 || rec.jobs.length > 0;
    w.varint((used > 0 ? 1 : 0) + (rec.vitals ? 1 : 0) + (rec.genome ? 1 : 0) + (rec.keyHash ? 1 : 0) + (rec.look ? 1 : 0) + (rec.markers.length > 0 ? 1 : 0) + (hasState ? 1 : 0) + (hasProgress ? 1 : 0) + (rec.team !== 0 ? 1 : 0) + (rec.at >= 0 ? 1 : 0) + (rec.tame || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1 ? 1 : 0) + rec.extra.size);
    if (rec.tame || rec.te > 0 || rec.follow !== 0 || rec.stance !== 1) {
      c.reset();
      c.f32(rec.te);
      c.bool(rec.tame !== null);
      if (rec.tame) {
        c.f64(rec.tame.affinity);
        c.f64(rec.tame.sum);
        c.uint53(rec.tame.by);
      }
      // Older saves end before these: its stance, and whom it follows.
      c.u8(rec.stance);
      c.uint53(rec.follow);
      w.varint(COMP_TAME);
      w.blob(c.bytes());
    }
    if (rec.at >= 0) {
      c.reset();
      c.u32(rec.at);
      c.bits(rec.lock, 2);
      c.varint(rec.pin + 1);
      // Older saves end before these: a bed's wait, and a fire that is burning.
      c.uint53(rec.readyAt);
      c.bool(rec.fire !== null);
      if (rec.fire) {
        c.uint53(rec.fire.at);
        c.varint(rec.fire.fuel);
        c.varint(rec.fire.cook);
      }
      w.varint(COMP_FIXTURE);
      w.blob(c.bytes());
    }
    if (hasProgress) {
      c.reset();
      c.f64(rec.xp);
      c.varint(rec.engrams.length);
      for (const e of rec.engrams) c.varint(this.toSaved[e]!);
      c.varint(rec.jobs.length);
      for (const j of rec.jobs) {
        c.varint(this.toSaved[j.recipe]!);
        c.varint(j.left);
        c.uint53(j.doneAt);
      }
      w.varint(COMP_PROGRESSION);
      w.blob(c.bytes());
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
      w.varint(COMP_MARKERS);
      w.blob(c.bytes());
    }
    if (hasState) {
      c.reset();
      c.bool(rec.dead);
      c.uint53(rec.expiresAt);
      // One more than the hotbar slot in hand; 0 for none. Older saves end before this.
      c.u8(rec.held + 1);
      w.varint(COMP_STATE);
      w.blob(c.bytes());
    }
    if (rec.team !== 0) {
      c.reset();
      c.varint(rec.team);
      c.u8(rec.rank);
      w.varint(COMP_TEAM);
      w.blob(c.bytes());
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
        // What a weapon holds: the kind of round, how many, and an attachment.
        const holds = inv.ammo[slot] !== 0 || inv.attach[slot] !== 0;
        c.bool(holds);
        if (holds) {
          c.varint(inv.ammo[slot] === 0 ? 0 : this.toSaved[inv.ammo[slot]!]!);
          c.u8(inv.loaded[slot]!);
          c.varint(inv.attach[slot] === 0 ? 0 : this.toSaved[inv.attach[slot]!]!);
        }
      }
      w.varint(COMP_SLOTS2);
      w.blob(c.bytes());
    }
    const v = rec.vitals;
    if (v) {
      // Which vitals this body has, then for each its value and rate. Maxima come from stats and are not saved.
      c.reset();
      let mask = 0;
      for (let i = 0; i < V_COUNT; i++) if (v.max[i]! > 0) mask |= 1 << i;
      c.u8(mask);
      c.varint(v.tick);
      for (let i = 0; i < V_COUNT; i++) {
        if ((mask & (1 << i)) === 0) continue;
        c.varint(v.value[i]!);
        c.svarint(v.rate[i]!);
      }
      c.bool(rec.out);
      w.varint(COMP_VITALS8);
      w.blob(c.bytes());
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
      w.varint(COMP_GENOME);
      w.blob(c.bytes());
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
    if (w.overflow || c.overflow) throw new Error(`record ${rec.pid} is too large to save`);
    this.putEntity.run(rec.pid, this.toSaved[rec.kind]!, rec.x, rec.y, rec.z, rec.yaw, w.bytes().slice());
  }

  deleteEntity(pid: number): void {
    this.dropEntity.run(pid);
  }

  loadEntities(): EntityRecord[] {
    const rows = this.db.query("SELECT pid, kind, x, y, z, yaw, data FROM entities").all() as { pid: number; kind: number; x: number; y: number; z: number; yaw: number; data: Uint8Array }[];
    const out: EntityRecord[] = [];
    const r = this.r;
    for (const row of rows) {
      const kind = this.toRuntime[row.kind]!;
      if (kind === 0) continue; // content gone and the operator chose to proceed
      const rec = new EntityRecord(row.pid, kind);
      rec.x = row.x;
      rec.y = row.y;
      rec.z = row.z;
      rec.yaw = row.yaw;
      r.reset(row.data);
      if (r.u8() !== RECORD_FORMAT) throw new Error(`entity ${row.pid}: unknown record format`);
      rec.name = r.string(256);
      const c = this.cr;
      for (let n = r.varint(); n > 0 && !r.overflow; n--) {
        const component = r.varint();
        const blob = r.blob(1 << 20);
        c.reset(blob);
        if (component === COMP_INVENTORY) {
          // Round 1: a list of items and counts. Lay them out in slots, in an
          // inventory large enough for all of them: converting must not lose anything.
          const pairs: [number, number][] = [];
          let need = 0;
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const item = this.item(c.varint(), row.pid);
            const count = c.varint();
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
            const item = this.item(c.varint(), row.pid);
            const count = c.varint();
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
            const item = this.item(c.varint(), row.pid);
            const count = c.varint();
            const quality = c.u8();
            const dur = c.varint();
            const spoilAt = c.varint();
            const holds = c.bool();
            // 0 is "none"; anything else must be content this build has.
            const held = (saved: number): number => (saved === 0 ? 0 : this.item(saved, row.pid));
            const ammo = holds ? held(c.varint()) : 0;
            const loaded = holds ? c.u8() : 0;
            const attach = holds ? held(c.varint()) : 0;
            if (item === 0 || slot >= inv.cap) continue;
            inv.set(slot, item, count, quality, dur, spoilAt);
            if (holds) inv.setGear(slot, ammo, ammo === 0 ? 0 : loaded, attach);
          }
        } else if (component === COMP_VITALS) {
          // Round 1 food only: dropped; the survival system starts this body full.
        } else if (component === COMP_VITALS4 || component === COMP_VITALS8) {
          // The older form held four vitals behind a four-bit mask; a body saved in it has no torpor yet.
          const v = (rec.vitals = new Vitals());
          const mask = component === COMP_VITALS4 ? c.bits(4) : c.u8();
          v.tick = c.varint();
          for (let i = 0; i < 8; i++) {
            if ((mask & (1 << i)) === 0) continue;
            const value = c.varint();
            const rate = c.svarint();
            if (i >= V_COUNT) continue;
            v.value[i] = value;
            v.rate[i] = rate;
            // A placeholder until the survival system sets the true maximum from the body's stats.
            v.max[i] = value > 0 ? value : 1;
          }
          if (component === COMP_VITALS8) rec.out = c.bool();
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
        // A look this build cannot read (another length, a style that is gone) is kept as it is and not worn.
        else if (component === COMP_LOOK && validLook(blob)) rec.look = blob;
        else if (component === COMP_MARKERS) {
          for (let k = c.varint(); k > 0 && !c.overflow; k--) rec.markers.push({ kind: c.u8(), x: c.f32(), y: c.f32(), z: c.f32(), tick: c.uint53() });
        } else if (component === COMP_PROGRESSION) {
          rec.xp = c.f64();
          // Engrams and recipes whose content is gone are forgotten; nothing of value is lost with them.
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const e = this.toRuntime[c.varint()] ?? 0;
            if (e !== 0) rec.engrams.push(e);
          }
          for (let k = c.varint(); k > 0 && !c.overflow; k--) {
            const recipe = this.toRuntime[c.varint()] ?? 0;
            const left = c.varint();
            const doneAt = c.uint53();
            if (recipe !== 0) rec.jobs.push({ recipe, left, doneAt });
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
          }
        } else if (component === COMP_FIXTURE) {
          rec.at = c.u32();
          rec.lock = c.bits(2);
          rec.pin = c.varint() - 1;
          if (c.pos + 54 <= blob.length * 8) {
            rec.readyAt = c.uint53();
            if (c.bool()) rec.fire = { at: c.uint53(), fuel: c.varint(), cook: c.varint(), due: 0 };
          }
        } else rec.extra.set(component, blob);
        if (c.overflow) throw new Error(`entity ${row.pid}: unreadable component ${component}`);
      }
      if (r.overflow) throw new Error(`entity ${row.pid}: truncated record`);
      out.push(rec);
    }
    return out;
  }

  /** Store or, with null, delete a chunk's blob for a tag. */
  saveBlob(chunk: number, tag: number, data: Uint8Array | null): void {
    if (data) this.db.query("INSERT OR REPLACE INTO chunk_blobs (chunk, tag, data) VALUES (?, ?, ?)").run(chunk, tag, data);
    else this.db.query("DELETE FROM chunk_blobs WHERE chunk = ? AND tag = ?").run(chunk, tag);
  }

  loadBlobs(tag: number): { chunk: number; data: Uint8Array }[] {
    return this.db.query("SELECT chunk, data FROM chunk_blobs WHERE tag = ?").all(tag) as { chunk: number; data: Uint8Array }[];
  }

  /** Runtime index of a saved item index. An item whose content is gone stops the load unless the operator chose to drop such things. */
  private item(saved: number, pid: number): number {
    const item = this.toRuntime[saved] ?? 0;
    if (item === 0 && !this.allowMissing) throw new Error(`save uses content this build does not have: an item held by record ${pid}`);
    return item;
  }

  appendJournal(seq: number, tick: number, op: number, data: Uint8Array): void {
    this.putJournal.run(seq, tick, op, data);
  }

  /** Sequence number of the newest journal entry, or 0. */
  lastJournalSeq(): number {
    return Number((this.db.query("SELECT MAX(seq) AS seq FROM journal").get() as { seq: number | null }).seq ?? 0);
  }

  /** Delete journal entries older than the newest `keep`. */
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
    // Content ids are interned when a build first sees them, so an id can be
    // missing without anything in the save using it. Only real use blocks loading.
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
