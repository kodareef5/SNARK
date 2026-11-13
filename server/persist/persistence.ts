// Decides what goes into each commit.
//
// Two classes of change:
//   valuable   inventories, ownership, structures, births and deaths. Every
//              record a valuable change touched is in the very next commit,
//              together, along with its journal entry.
//   lazy       positions. Each commit refreshes a slice of the live entities in
//              rotation. A position a few seconds stale after a crash is
//              harmless; an item saved on one side of a trade is not.
//
// Callers that must not tell a player "done" before it is durable register an
// `afterCommit` callback instead of replying at once.

import { F_ALIVE, F_AWAKE, F_PLAYER } from "../../shared/sim/entities.ts";
import type { EntityRecord, Records } from "../records.ts";
import type { ServerWorld } from "../world.ts";
import type { WorldStore } from "./store.ts";

export interface PersistenceOptions {
  /** Live entity positions refreshed per commit. */
  lazyRowsPerCommit: number;
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
  readonly store: WorldStore;
  /** Completed commits. */
  commits = 0;
  /** Sequence number of the newest journal entry, durable or not. */
  journalSeq = 0;
  /** Newest journal entry known to be on disk. */
  durableSeq = 0;
  readonly survivors = new Map<string, number>();

  private readonly world: ServerWorld;
  private readonly records: Records;
  private readonly opts: PersistenceOptions;
  private readonly dirtyChunks = new Set<number>();
  private readonly pending: PendingJournal[] = [];
  private readonly newSurvivors: [string, number][] = [];
  private callbacks: (() => void)[] = [];
  private readonly live: number[] = [];
  private readonly liveSet = new Set<number>();
  private cursor = 0;

  constructor(world: ServerWorld, records: Records, store: WorldStore, opts: Partial<PersistenceOptions> = {}) {
    this.world = world;
    this.records = records;
    this.store = store;
    this.opts = { lazyRowsPerCommit: 256, ...opts };
    world.structs.onChunkChanged = (chunk) => this.dirtyChunks.add(chunk);
  }

  /** Restore the world from the store. Call once, before the first tick. */
  load(): LoadReport {
    const store = this.store;
    const world = this.world;
    if (!store.fresh) {
      const mapId = store.meta("map_id");
      if (mapId !== world.mapId) throw new Error(`save is for map "${mapId}", not "${world.mapId}"`);
      world.tick = Number(store.meta("tick") ?? 0);
      this.records.nextSeq = Number(store.meta("next_seq") ?? 1);
    }
    const structures = store.fresh ? world.structs.count : store.loadChunks(world.structs);
    // A fresh save keeps the structures the world was created with; mark them all for the first commit.
    this.dirtyChunks.clear();
    if (store.fresh) world.structs.chunks.forEach((t, chunk) => t && this.dirtyChunks.add(chunk));
    for (const rec of store.loadEntities()) this.records.byPid.set(rec.pid, rec);
    for (const [name, pid] of store.survivors()) this.survivors.set(name, pid);
    const last = store.journal().at(-1);
    this.journalSeq = this.durableSeq = last ? last.seq : 0;
    return { fresh: store.fresh, tick: world.tick, structures, records: this.records.byPid.size };
  }

  /** Record a valuable operation. It is written in the same transaction as the state it produced. */
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

  /** An entity with a record entered the simulation. */
  attach(rec: EntityRecord, ent: number): void {
    this.records.entOf.set(rec.pid, ent);
    this.world.ents.pid[ent] = rec.pid;
    if (!this.liveSet.has(rec.pid)) {
      this.liveSet.add(rec.pid);
      this.live.push(rec.pid);
    }
  }

  /** An entity left the simulation; its record keeps its last position. */
  detach(pid: number): void {
    const rec = this.records.byPid.get(pid);
    const ent = this.records.entOf.get(pid);
    if (rec && ent !== undefined) {
      this.capture(rec, ent);
      this.records.dirty.add(pid);
    }
    this.records.entOf.delete(pid);
    if (this.liveSet.delete(pid)) {
      const i = this.live.indexOf(pid);
      this.live[i] = this.live[this.live.length - 1]!;
      this.live.pop();
    }
  }

  /** Write one transaction: all valuable changes, the journal, and a slice of positions. */
  commit(): void {
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
        const n = Math.min(this.opts.lazyRowsPerCommit, this.live.length);
        for (let i = 0; i < n; i++) {
          if (this.cursor >= this.live.length) this.cursor = 0;
          const pid = this.live[this.cursor++]!;
          if (records.dirty.has(pid)) continue;
          const ent = records.entOf.get(pid);
          // Sleeping creatures have not moved since they were last written.
          if (ent === undefined || (world.ents.flags[ent]! & (F_AWAKE | F_PLAYER)) === 0) continue;
          const rec = records.byPid.get(pid)!;
          this.capture(rec, ent);
          store.saveEntity(rec);
        }
        for (const j of this.pending) store.appendJournal(j.seq, j.tick, j.op, j.data);
        for (const [name, pid] of this.newSurvivors) store.saveSurvivor(name, pid);
        store.setMeta("tick", world.tick);
        store.setMeta("next_seq", records.nextSeq);
        store.setMeta("map_id", world.mapId);
      });
    } catch (err) {
      // Nothing was written. Keep the callbacks so a later commit can release them.
      this.callbacks = callbacks.concat(this.callbacks);
      throw err;
    }

    // Only now is it safe to forget what was dirty and to tell anyone.
    this.dirtyChunks.clear();
    records.dirty.clear();
    records.deleted.length = 0;
    this.pending.length = 0;
    this.newSurvivors.length = 0;
    this.durableSeq = this.journalSeq;
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
