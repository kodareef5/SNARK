// Valuable changes (inventories, ownership, structures, births, deaths) go into the next commit together, with their journal entries.
// Positions are lazy, because a stale one is harmless after a crash. Each commit refreshes a slice of the live entities in rotation.
// Nothing is written to the save outside a commit. A commit that fails leaves everything it held for the next one.

import { resolve } from "node:path";
import { TICK_RATE } from "../../shared/coords.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import type { EntityRecord, Records } from "../records.ts";
import type { ServerWorld } from "../world.ts";
import { sqliteCode, type WorldStore } from "./store.ts";

/** Five seconds. A checkpoint syncs the database file, so this is not every commit. */
const CHECKPOINT_TICKS = 5 * TICK_RATE;

export interface PersistenceOptions {
  /**
   * Ticks in which every body that can move has its position saved once. Each save rewrites a database page, and that
   * volume is what sets how often SQLite stops the tick to checkpoint, so this is a minute and not a second.
   */
  positionTicks: number;
  /** Journal entries kept. Older ones are deleted. */
  journalKeep: number;
}

/** Commits between journal prunings. */
const PRUNE_EVERY = 512;
/** The longest wait between two tries of a failing commit, in ticks. */
const RETRY_MOST = 150;
/** The file itself is broken or cannot be written. Trying again will not help, so the world is saved elsewhere. */
const BROKEN = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB", "SQLITE_READONLY"]);

/** Something saved as one value under a key of its own, in the same transaction as the records it describes. */
export interface Sidecar {
  dirty: boolean;
  serialize(): string;
}

/** Commits have failed since tick `since`. `code` is SQLite's, and `tries` counts the failures. */
export interface Failing {
  since: number;
  tries: number;
  code: string;
  error: string;
  retryAt: number;
}


export interface LoadReport {
  fresh: boolean;
  tick: number;
  structures: number;
  records: number;
}

interface PendingJournal {
  seq: number;
  tick: number;
  op: number;
  data: Uint8Array;
}

export class Persistence {
  /** Changes when the world is saved elsewhere (saveAs). */
  store: WorldStore;
  commits = 0;
  /** Sequence number of the newest journal entry, durable or not. */
  journalSeq = 0;
  durableSeq = 0;
  readonly survivors = new Map<string, number>();
  /** Per-chunk state other than structures. Each provider encodes the chunks it has marked dirty, and `all` marks every chunk it has state for. */
  readonly blobs: { tag: number; dirty: Set<number>; encode(chunk: number): Uint8Array | null; all(): void }[] = [];
  /** Null while commits succeed. */
  failing: Failing | null = null;
  /** Called with each failure, and once with null when a commit succeeds again. */
  onFailing: ((f: Failing | null) => void) | null = null;
  /** Called with the path when a broken file made the world move to a new one. */
  onMoved: ((path: string) => void) | null = null;
  /** Opens a store at another path, for saveAs. */
  open: ((path: string) => WorldStore) | null = null;

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly opts: PersistenceOptions;
  private readonly dirtyChunks = new Set<number>();
  private readonly sidecars: { key: string; of: Sidecar; every: number; at: number }[] = [];
  private readonly written: number[] = [];
  private readonly pending: PendingJournal[] = [];
  private readonly newSurvivors: [string, number][] = [];
  private callbacks: (() => void)[] = [];
  private cursor = 0;
  private savedAt = 0;
  private checkpointAt = 0;
  private checkpointed = 0;

  constructor(world: ServerWorld, records: Records, store: WorldStore, opts: Partial<PersistenceOptions> = {}) {
    this.world = world;
    this.records = records;
    this.store = store;
    this.opts = { positionTicks: 1800, journalKeep: 100_000, ...opts };
    world.structs.onChunkChanged = (chunk) => this.dirtyChunks.add(chunk);
  }

  /** Call once, before the first tick. */
  load(): LoadReport {
    const store = this.store;
    const world = this.world;
    if (!store.fresh) {
      const mapId = store.meta("map_id");
      if (mapId !== world.mapId) throw new Error(`save is for map "${mapId}", not "${world.mapId}"`);
      world.tick = Number(store.meta("tick") ?? 0);
      world.dayOffset = Number(store.meta("day_offset") ?? 0);
      this.records.nextSeq = Number(store.meta("next_seq") ?? 1);
    }
    const structures = store.fresh ? world.structs.count : store.loadChunks(world.structs);
    // A fresh save keeps the structures the world was created with, so the first commit writes them all.
    this.dirtyChunks.clear();
    if (store.fresh) world.structs.chunks.forEach((t, chunk) => t && this.dirtyChunks.add(chunk));
    for (const rec of store.loadEntities()) this.records.byPid.set(rec.pid, rec);
    for (const [name, pid] of store.survivors()) this.survivors.set(name, pid);
    this.journalSeq = this.durableSeq = store.lastJournalSeq();
    return { fresh: store.fresh, tick: world.tick, structures, records: this.records.byPid.size };
  }

  /**
   * Saves `of` under meta key `key` in the commit after it turns dirty: the item ledger, the settings the records' timers
   * were computed under (D91), the tribes, the decay clocks. `every` is the fewest ticks between two writes of it.
   */
  sidecar(key: string, of: Sidecar, every = 0): void {
    this.sidecars.push({ key, of, every, at: -every });
  }

  /** The entry is written in the same transaction as the state it produced. */
  journal(op: number, data: Uint8Array): number {
    const seq = ++this.journalSeq;
    this.pending.push({ seq, tick: this.world.tick, op, data: data.slice() });
    return seq;
  }

  /** Run `cb` once everything done so far is durable. */
  afterCommit(cb: () => void): void {
    this.callbacks.push(cb);
  }

  bindSurvivor(name: string, pid: number): void {
    this.survivors.set(name, pid);
    this.newSurvivors.push([name, pid]);
  }

  attach(rec: EntityRecord, ent: number): void {
    this.records.entOf.set(rec.pid, ent);
    this.world.ents.pid[ent] = rec.pid;
  }

  /** The record keeps the entity's last position. */
  detach(pid: number): void {
    const rec = this.records.byPid.get(pid);
    const ent = this.records.entOf.get(pid);
    if (rec && ent !== undefined) {
      this.capture(rec, ent);
      this.records.dirty.add(pid);
    }
    this.records.entOf.delete(pid);
  }

  /**
   * Call between ticks, when there is time to spare. Checkpoints the database if anything was committed in the last
   * CHECKPOINT_TICKS, so that no commit, and so no tick, stops for it.
   */
  idle(): void {
    if (this.world.tick - this.checkpointAt < CHECKPOINT_TICKS || this.commits === this.checkpointed) return;
    this.checkpointAt = this.world.tick;
    this.checkpointed = this.commits;
    this.store.checkpoint();
  }

  /**
   * Call every tick. Commits when one is due, every `every` ticks. A commit SQLite refused is tried again after 6 ticks,
   * then 12, up to five seconds apart, and the world runs on meanwhile with nothing lost. An error of our own is thrown:
   * it would fail the same way every time, and stopping on the last good commit loses less than running on unsaved.
   * Returns false while commits are failing.
   */
  tryCommit(every: number): boolean {
    const tick = this.world.tick;
    const f = this.failing;
    if (f ? tick < f.retryAt : tick % every !== 0) return f === null;
    try {
      this.commit();
    } catch (err) {
      const code = sqliteCode(err);
      if (code === "") throw err;
      const now = f ?? (this.failing = { since: tick, tries: 0, code, error: "", retryAt: 0 });
      now.tries++;
      now.code = code;
      now.error = err instanceof Error ? err.message : String(err);
      now.retryAt = tick + Math.min(RETRY_MOST, every * 2 ** Math.min(now.tries - 1, 8));
      if (BROKEN.has(code) && this.open && this.rescue(tick)) return true;
      this.onFailing?.(now);
      return false;
    }
    if (f) {
      this.failing = null;
      this.onFailing?.(null);
    }
    return true;
  }

  private rescue(tick: number): boolean {
    const path = `${this.store.path}.rescue-t${tick}`;
    try {
      this.saveAs(path);
    } catch {
      return false;
    }
    this.onMoved?.(path);
    return true;
  }

  /**
   * Writes the whole world from memory into a new file at `path` and carries on there. The old file is closed and left
   * as it is. Its journal stays in it: the new file's journal starts with what is pending. Throws, with the old file
   * still in use, if `path` holds a save or cannot be written.
   */
  saveAs(path: string): void {
    if (!this.open) throw new Error("this world cannot be saved elsewhere");
    if (resolve(path) === resolve(this.store.path)) throw new Error(`the world is already saved in ${path}`);
    const next = this.open(path);
    if (!next.fresh) {
      next.close();
      throw new Error(`${path} already holds a save`);
    }
    const old = this.store;
    const world = this.world;
    this.store = next;
    world.structs.chunks.forEach((t, chunk) => t && this.dirtyChunks.add(chunk));
    for (const pid of this.records.byPid.keys()) this.records.dirty.add(pid);
    for (const b of this.blobs) b.all();
    for (const s of this.sidecars) s.of.dirty = true;
    this.newSurvivors.length = 0;
    for (const [name, pid] of this.survivors) this.newSurvivors.push([name, pid]);
    try {
      this.commit(true);
    } catch (err) {
      this.store = old;
      next.close();
      throw err;
    }
    try {
      old.close();
    } catch {
      // The old file is the one that failed. There is nothing more to do with it.
    }
    if (this.failing) {
      this.failing = null;
      this.onFailing?.(null);
    }
  }

  /** `last` writes every dirty sidecar whatever its interval, as a shutdown does. */
  commit(last = false): void {
    const store = this.store;
    const world = this.world;
    const records = this.records;
    const callbacks = this.callbacks;
    this.callbacks = [];

    try {
      store.transaction(() => {
        for (const chunk of this.dirtyChunks) {
          const t = world.structs.chunks[chunk];
          if (t) store.saveChunk(chunk, t);
        }
        for (const pid of records.dirty) {
          const rec = records.byPid.get(pid);
          if (!rec) continue;
          const ent = records.entOf.get(pid);
          if (ent !== undefined) this.capture(rec, ent);
          store.saveEntity(rec);
        }
        for (const pid of records.deleted) store.deleteEntity(pid);
        // Positions go a slice at a time, over the bodies that can have moved: history tracks awake creatures and players'
        // bodies. A creature that falls asleep is saved then (Creatures.sleep), so sleeping ones cost nothing here.
        const history = world.history;
        // At most a second's share at once, so a clock that jumps (a test, a benchmark) does not save every body in one commit.
        const n = Math.ceil((history.rows * Math.min(TICK_RATE, world.tick - this.savedAt)) / this.opts.positionTicks);
        this.savedAt = world.tick;
        for (let i = 0; i < n; i++) {
          if (this.cursor >= history.rows) this.cursor = 0;
          const ent = history.tracked(this.cursor++);
          const pid = world.ents.pid[ent]!;
          if (pid === 0 || records.dirty.has(pid)) continue;
          const rec = records.byPid.get(pid);
          if (!rec) continue;
          this.capture(rec, ent);
          store.saveEntity(rec);
        }
        for (const b of this.blobs) for (const chunk of b.dirty) store.saveBlob(chunk, b.tag, b.encode(chunk));
        for (const j of this.pending) store.appendJournal(j.seq, j.tick, j.op, j.data);
        this.written.length = 0;
        this.sidecars.forEach((s, i) => {
          if (!s.of.dirty || (!last && world.tick - s.at < s.every)) return;
          store.setMeta(s.key, s.of.serialize());
          this.written.push(i);
        });
        // The journal is an audit trail, not the state, so only the recent part is kept.
        if (this.commits % PRUNE_EVERY === PRUNE_EVERY - 1) store.pruneJournal(this.opts.journalKeep);
        for (const [name, pid] of this.newSurvivors) store.saveSurvivor(name, pid);
        store.setMeta("tick", world.tick);
        store.setMeta("day_offset", world.dayOffset);
        store.setMeta("next_seq", records.nextSeq);
        store.setMeta("map_id", world.mapId);
      });
    } catch (err) {
      // Nothing was written. Keep the callbacks so a later commit can release them.
      this.callbacks = callbacks.concat(this.callbacks);
      throw err;
    }

    // The dirty sets are cleared and the callbacks run only after the transaction succeeds.
    this.dirtyChunks.clear();
    records.dirty.clear();
    records.deleted.length = 0;
    this.pending.length = 0;
    this.newSurvivors.length = 0;
    this.durableSeq = this.journalSeq;
    for (const i of this.written) {
      this.sidecars[i]!.of.dirty = false;
      this.sidecars[i]!.at = world.tick;
    }
    for (const b of this.blobs) b.dirty.clear();
    this.commits++;
    for (const cb of callbacks) cb();
  }

  private capture(rec: EntityRecord, ent: number): void {
    const ents = this.world.ents;
    if ((ents.flags[ent]! & F_ALIVE) === 0) return;
    rec.x = ents.x[ent]!;
    rec.y = ents.y[ent]!;
    rec.z = ents.z[ent]!;
    rec.yaw = ents.yaw[ent]!;
  }
}
