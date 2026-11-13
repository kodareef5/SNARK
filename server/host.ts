// Assembles a running world: map, records, persistence and the game loop.
// Used by server/main.ts and by tests; neither needs to know the wiring.

import type { Registry } from "../shared/content/registry.ts";
import { Rng } from "../shared/rng.ts";
import { Creatures } from "./creatures.ts";
import { GameServer, type GameOptions } from "./game.ts";
import { Persistence, type LoadReport } from "./persist/persistence.ts";
import { WorldStore, type StoreOptions } from "./persist/store.ts";
import { Records } from "./records.ts";
import { createProvingWorld, type ServerWorld } from "./world.ts";

export interface HostOptions {
  /** SQLite file. Omit for a world that lives only in memory. */
  dbPath?: string;
  worldId?: number;
  /** Ticks between commits. 6 ticks is 200 ms. */
  commitEvery?: number;
  game?: Partial<GameOptions>;
  store?: StoreOptions;
  /** Wild creatures placed around the plaza of a new world. */
  startingCreatures?: number;
  /** Chunks around a player in which creatures are simulated. */
  wakeRadius?: number;
  seed?: number;
}

export interface Host {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly game: GameServer;
  readonly creatures: Creatures;
  readonly persistence: Persistence | null;
  readonly loaded: LoadReport | null;
  /** Spawn a wild creature by content id. Returns its entity index, or -1. */
  spawnCreature(id: string, x: number, z: number, level: number): number;
  /** Commit and close the store. */
  shutdown(): void;
}

export function createHost(reg: Registry, opts: HostOptions = {}): Host {
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, opts.store) : null;
  // A save supplies its own structures; only a new world gets the proving ground's.
  const world = createProvingWorld(reg, { populate: !store || store.fresh });
  const records = new Records(opts.worldId ?? 1);
  const game = new GameServer(world, opts.game);
  const persistence = store ? new Persistence(world, records, store) : null;
  const loaded = persistence ? persistence.load() : null;
  const commitEvery = opts.commitEvery ?? 6;
  const survivor = reg.index.get("core:survivor")!;
  const names = new Map<string, number>();
  const creatures = new Creatures(world, records, opts.seed ?? 1, opts.wakeRadius ?? 3);
  /** Chunk each connected player is keeping awake. */
  const playerChunk = new Map<number, number>();

  const spawnCreature = (id: string, x: number, z: number, level: number): number => {
    const kind = reg.index.get(id);
    const e = kind === undefined ? -1 : creatures.spawn(kind, x, z, level);
    if (e >= 0 && persistence) persistence.attach(records.byPid.get(world.ents.pid[e]!)!, e);
    return e;
  };
  if (loaded && !loaded.fresh) {
    // Every saved record that is not a survivor is a creature: put it back where it stood.
    const survivors = new Set(persistence!.survivors.values());
    for (const rec of records.byPid.values()) {
      if (survivors.has(rec.pid)) continue;
      const e = creatures.adopt(rec);
      if (e >= 0) persistence!.attach(rec, e);
    }
  } else {
    const rng = new Rng((opts.seed ?? 1) + 17);
    for (let i = opts.startingCreatures ?? 0; i > 0; i--) spawnCreature("core:grazer", rng.range(200, 312), rng.range(190, 250), 1 + rng.int(30));
  }

  game.savedPosition = (name) => {
    const pid = persistence ? persistence.survivors.get(name) : names.get(name);
    return pid === undefined ? null : (records.byPid.get(pid) ?? null);
  };
  game.onJoin = (c) => {
    let pid = persistence ? persistence.survivors.get(c.name) : names.get(c.name);
    let rec = pid === undefined ? undefined : records.byPid.get(pid);
    if (!rec) {
      rec = records.create(survivor, c.name);
      pid = rec.pid;
      if (persistence) persistence.bindSurvivor(c.name, pid);
      else names.set(c.name, pid);
    }
    if (persistence) persistence.attach(rec, c.ent);
    else {
      records.entOf.set(rec.pid, c.ent);
      world.ents.pid[c.ent] = rec.pid;
    }
    const chunk = world.ents.chunk[c.ent]!;
    playerChunk.set(c.id, chunk);
    creatures.playerMoved(-1, chunk);
  };
  game.onLeave = (c) => {
    creatures.playerMoved(playerChunk.get(c.id) ?? -1, -1);
    playerChunk.delete(c.id);
    const pid = world.ents.pid[c.ent]!;
    if (persistence) persistence.detach(pid);
    else {
      const rec = records.byPid.get(pid);
      if (rec) {
        rec.x = world.ents.x[c.ent]!;
        rec.y = world.ents.y[c.ent]!;
        rec.z = world.ents.z[c.ent]!;
        rec.yaw = world.ents.yaw[c.ent]!;
      }
      records.entOf.delete(pid);
    }
  };
  game.onStep = (tick) => {
    for (const c of game.clients) {
      if (!c?.active) continue;
      const chunk = world.ents.chunk[c.ent]!;
      const was = playerChunk.get(c.id)!;
      if (chunk === was) continue;
      playerChunk.set(c.id, chunk);
      creatures.playerMoved(was, chunk);
    }
    creatures.step(tick);
    if (persistence && tick % commitEvery === 0) persistence.commit();
  };

  return {
    world,
    records,
    game,
    creatures,
    persistence,
    loaded,
    spawnCreature,
    shutdown() {
      if (!persistence) return;
      persistence.commit();
      persistence.store.close();
    },
  };
}
