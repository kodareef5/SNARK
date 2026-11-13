// Assembles a running world: map, records, persistence and the game loop.
// Used by server/main.ts and by tests; neither needs to know the wiring.

import type { Registry } from "../shared/content/registry.ts";
import { CMD_TEXT, MAX_TEXT_BYTES, RESULT_BUSY, RESULT_INVALID, RESULT_OK, TEXT_CONSOLE } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Genome } from "../shared/sim/genome.ts";
import { addAdminCommands } from "./commands/admin.ts";
import { addCoreCommands } from "./commands/core.ts";
import { Console } from "./console.ts";
import { Creatures } from "./creatures.ts";
import { GameServer, type Client, type GameOptions } from "./game.ts";
import { Persistence, type LoadReport } from "./persist/persistence.ts";
import { WorldStore, type StoreOptions } from "./persist/store.ts";
import { Records } from "./records.ts";
import { refreshMods } from "./survival.ts";
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
  /** Use this world instead of creating the proving ground. Its structures are kept only if the save is new. */
  world?: ServerWorld;
  seed?: number;
  /** Password for `enablecheats`. Without one, cheats are off unless `dev` is set. */
  adminPassword?: string;
  /** Development server: cheats need no password. Never set in a public deployment. */
  dev?: boolean;
}

/** Ticks between console lines accepted from one session. */
const TEXT_INTERVAL = 6;
/** Bytes of the SHA-256 of a device key that a survivor record keeps. */
const KEY_HASH_BYTES = 16;

function hashKey(key: Uint8Array): Uint8Array {
  return new Bun.CryptoHasher("sha256").update(key).digest().slice(0, KEY_HASH_BYTES);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface Host {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly game: GameServer;
  readonly creatures: Creatures;
  readonly persistence: Persistence | null;
  readonly loaded: LoadReport | null;
  readonly console: Console;
  readonly adminPassword: string | null;
  readonly dev: boolean;
  /** Spawn a wild creature by content id. Returns its entity index, or -1. */
  spawnCreature(id: string, x: number, z: number, level: number): number;
  /** Run a console line as the operator, or as `client`. Returns what it printed. */
  exec(line: string, client?: Client): string;
  /** Commit and close the store. */
  shutdown(): void;
}

export function createHost(reg: Registry, opts: HostOptions = {}): Host {
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, opts.store) : null;
  // A save supplies its own structures; only a new world gets the proving ground's.
  const world = opts.world ?? createProvingWorld(reg, { populate: !store || store.fresh });
  const records = new Records(opts.worldId ?? 1);
  const game = new GameServer(world, opts.game);
  const persistence = store ? new Persistence(world, records, store) : null;
  const loaded = persistence ? persistence.load() : null;
  const commitEvery = opts.commitEvery ?? 6;
  const survivor = reg.index.get("core:survivor")!;
  const names = new Map<string, number>();
  const creatures = new Creatures(world, records, opts.seed ?? 1, opts.wakeRadius ?? 3);
  /** Chunk each session's focus is keeping awake. */
  const focus = new Map<number, number>();
  const recordOf = (name: string) => {
    const pid = persistence ? persistence.survivors.get(name) : names.get(name);
    return pid === undefined ? undefined : records.byPid.get(pid);
  };

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
    // Scatter the herd north of the spawn point; positions inside structures are skipped and retried.
    let wanted = opts.startingCreatures ?? 0;
    for (let tries = wanted * 20; wanted > 0 && tries > 0; tries--) {
      if (spawnCreature("core:grazer", rng.range(226, 286), rng.range(244, 300), 1 + rng.int(30)) >= 0) wanted--;
    }
  }

  // A name belongs to the first device key that takes a body under it.
  game.authorize = (name, key) => {
    const rec = recordOf(name);
    return !rec || !rec.keyHash || sameBytes(rec.keyHash, hashKey(key));
  };
  game.savedPosition = (name) => recordOf(name) ?? null;
  game.onBody = (c) => {
    let rec = recordOf(c.name);
    if (!rec) {
      rec = records.create(survivor, c.name);
      if (persistence) persistence.bindSurvivor(c.name, rec.pid);
      else names.set(c.name, rec.pid);
    }
    if (!rec.keyHash) {
      rec.keyHash = hashKey(c.key);
      records.dirty.add(rec.pid);
    }
    // A survivor has stat points like any body, all of them its own to place.
    rec.genome ??= new Genome();
    refreshMods(reg, world.ents, c.ent, rec.genome);
    c.pid = rec.pid;
    if (persistence) persistence.attach(rec, c.ent);
    else {
      records.entOf.set(rec.pid, c.ent);
      world.ents.pid[c.ent] = rec.pid;
    }
  };
  game.onBodyGone = (c) => {
    if (persistence) persistence.detach(c.pid);
    else {
      const rec = records.byPid.get(c.pid);
      if (rec) {
        rec.x = world.ents.x[c.ent]!;
        rec.y = world.ents.y[c.ent]!;
        rec.z = world.ents.z[c.ent]!;
        rec.yaw = world.ents.yaw[c.ent]!;
      }
      records.entOf.delete(c.pid);
    }
  };
  game.onEnter = (c) => {
    focus.set(c.id, c.chunk);
    creatures.playerMoved(-1, c.chunk);
  };
  game.onExit = (c) => {
    creatures.playerMoved(focus.get(c.id) ?? -1, -1);
    focus.delete(c.id);
  };
  game.onStep = (tick) => {
    for (const c of game.clients) {
      if (!c?.active) continue;
      const was = focus.get(c.id)!;
      if (c.chunk === was) continue;
      focus.set(c.id, c.chunk);
      creatures.playerMoved(was, c.chunk);
    }
    creatures.step(tick);
    if (persistence && tick % commitEvery === 0) persistence.commit();
  };

  const con = new Console();
  addCoreCommands(con);
  addAdminCommands(con);
  const host: Host = {
    world,
    records,
    game,
    creatures,
    persistence,
    loaded,
    console: con,
    adminPassword: opts.adminPassword || null,
    dev: opts.dev ?? false,
    spawnCreature,
    exec: (line, client) => con.exec({ host, client: client ?? null }, line),
    shutdown() {
      if (!persistence) return;
      // Every body still in the world is saved where it stands.
      for (const c of game.clients) if (c?.active && c.ent >= 0) records.dirty.add(c.pid);
      persistence.commit();
      persistence.store.close();
    },
  };
  game.handle(CMD_TEXT, (c, r) => {
    const line = r.string(MAX_TEXT_BYTES);
    if (r.overflow) return RESULT_INVALID;
    if (world.tick < c.textReadyAt) return RESULT_BUSY;
    c.textReadyAt = world.tick + TEXT_INTERVAL;
    const out = con.exec({ host, client: c }, line);
    if (out) game.sendText(c, TEXT_CONSOLE, out);
    return RESULT_OK;
  });
  return host;
}
