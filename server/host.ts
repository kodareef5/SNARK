// Assembles a running world: map, records, persistence and the game loop.
// Used by server/main.ts and by tests; neither needs to know the wiring.

import type { Registry } from "../shared/content/registry.ts";
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
}

export interface Host {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly game: GameServer;
  readonly persistence: Persistence | null;
  readonly loaded: LoadReport | null;
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
  };
  game.onLeave = (c) => {
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
  if (persistence) {
    game.onStep = (tick) => {
      if (tick % commitEvery === 0) persistence.commit();
    };
  }

  return {
    world,
    records,
    game,
    persistence,
    loaded,
    shutdown() {
      if (!persistence) return;
      persistence.commit();
      persistence.store.close();
    },
  };
}
