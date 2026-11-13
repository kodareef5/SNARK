// Assembles a running world: map, records, persistence and the game loop.
// Used by server/main.ts and by tests; neither needs to know the wiring.

import type { Registry } from "../shared/content/registry.ts";
import { CMD_CHAT, CMD_PLACE, CMD_STRUCT, CMD_TEXT, MAX_TEXT_BYTES, RESULT_BUSY, RESULT_INVALID, RESULT_OK, TEXT_CONSOLE, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Genome } from "../shared/sim/genome.ts";
import { addAdminCommands } from "./commands/admin.ts";
import { addCombatCommands } from "./commands/combat.ts";
import { addCoreCommands } from "./commands/core.ts";
import { addSocialCommands } from "./commands/social.ts";
import { Build } from "./build.ts";
import { Fixtures } from "./fixtures.ts";
import { Chat } from "./chat.ts";
import { Tribes } from "./tribes.ts";
import { Voice } from "./voice.ts";
import { Console } from "./console.ts";
import { DeadlineHeap } from "../shared/sim/schedule.ts";
import { Buffs, DEADLINE_BUFF } from "./buffs.ts";
import { Combat } from "./combat.ts";
import { Creatures } from "./creatures.ts";
import { DEADLINE_DESPAWN, Death } from "./death.ts";
import { DEADLINE_NODE, Harvest } from "./harvest.ts";
import { DEADLINE_CRAFT, Progression } from "./progression.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { ACT_EQUIP, ACT_NONE, FISTS } from "../shared/sim/weapon.ts";
import { GameServer, type Client, type GameOptions } from "./game.ts";
import { Items } from "./items.ts";
import { addOwnCommands, syncOwn, type OwnContext } from "./own.ts";
import { Persistence, type LoadReport } from "./persist/persistence.ts";
import { Projectiles } from "./projectiles.ts";
import { WorldStore, type StoreOptions } from "./persist/store.ts";
import { Records, type EntityRecord } from "./records.ts";
import { Rules } from "./rules.ts";
import { DEADLINE_VITALS, Survival, refreshMods } from "./survival.ts";
import { createProvingWorld, type ServerWorld } from "./world.ts";
import type { ClipSet } from "../shared/anim/clip.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../shared/sim/entities.ts";
import { ARMOR_SLOTS } from "../shared/sim/items.ts";
import { HumanAnim } from "../shared/anim/pose.ts";

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
  /** Load a save whose item ledger does not match its contents, instead of refusing. */
  allowLedgerMismatch?: boolean;
  /** The animation clips of the asset pack the clients are served. They decide where hit zones are. */
  clips?: ClipSet;
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
  readonly items: Items;
  readonly survival: Survival;
  readonly death: Death;
  readonly combat: Combat;
  readonly buffs: Buffs;
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly chat: Chat;
  readonly voice: Voice;
  readonly build: Build;
  readonly fixtures: Fixtures;
  /** Whether the survivor with this persistent id has a session here now. */
  online(pid: number): boolean;
  /** Change a server rule, save it, and tell every client. False if there is no such rule or the value is out of range. */
  setRule(name: string, value: number): boolean;
  readonly projectiles: Projectiles;
  readonly progression: Progression;
  /** Null for a world whose map has no resource nodes. */
  readonly harvest: Harvest | null;
  readonly deadlines: DeadlineHeap;
  readonly persistence: Persistence | null;
  readonly loaded: LoadReport | null;
  readonly console: Console;
  readonly adminPassword: string | null;
  readonly dev: boolean;
  /** Spawn a wild creature by content id. Returns its entity index, or -1. */
  spawnCreature(id: string, x: number, z: number, level: number): number;
  /**
   * Recompute everything derived from a record's stat points and what it
   * carries: vitals' maxima, movement modifiers, and the level others see.
   * Call after changing either.
   */
  refreshBody(rec: EntityRecord): void;
  /** Run a console line as the operator, or as `client`. Returns what it printed. */
  exec(line: string, client?: Client): string;
  /** Commit and close the store. */
  shutdown(): void;
}

/** How often the clocks of decay are saved: once a minute, in ticks. */
const DECAY_SAVE_TICKS = 1800;

export function createHost(reg: Registry, opts: HostOptions = {}): Host {
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, opts.store) : null;
  // A save supplies its own structures; only a new world gets the proving ground's.
  const world = opts.world ?? createProvingWorld(reg, { populate: !store || store.fresh });
  if (opts.clips) world.anim = new HumanAnim(opts.clips);
  const records = new Records(opts.worldId ?? 1);
  const game = new GameServer(world, opts.game);
  const persistence = store ? new Persistence(world, records, store) : null;
  const loaded = persistence ? persistence.load() : null;
  const commitEvery = opts.commitEvery ?? 6;
  const survivor = reg.index.get("core:survivor")!;
  const survivorMove = reg.move[survivor]!;
  const names = new Map<string, number>();
  // One heap for everything that happens at a tick; entries are dispatched by kind in onStep.
  const deadlines = new DeadlineHeap();
  const survival = new Survival(world, records, deadlines);
  const items = new Items(world, records);
  // A save's ledger must match what the save holds, or the save is not trusted.
  if (persistence) {
    items.restore(loaded!.fresh ? "{}" : (persistence.store.meta("ledger") as string | null));
    const wrong = items.audit();
    if (wrong.length > 0 && !opts.allowLedgerMismatch) throw new Error("the item ledger does not balance:\n" + wrong.join("\n"));
    persistence.ledger = items;
  }
  const creatures = new Creatures(world, records, survival, opts.seed ?? 1, opts.wakeRadius ?? 3);
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
  const death = new Death({ world, game, records, items, survival, creatures, persistence, deadlines });
  const progression = new Progression(world, records, items, deadlines);
  const harvest = world.nodeField ? new Harvest(world, game, records, items, progression, deadlines, (opts.seed ?? 1) + 31) : null;
  const buffs = new Buffs(world, records, survival, deadlines);
  const rules = new Rules();
  if (persistence && !loaded!.fresh) rules.restore(persistence.store.meta("rules"));
  const combat = new Combat({ world, game, records, items, survival, progression, creatures, buffs, rules, harvest }, (opts.seed ?? 1) + 53);
  const tribes = new Tribes(world, records);
  if (persistence && !loaded!.fresh) tribes.restore(persistence.store.meta("tribes"));
  const chat = new Chat({ game, records, rules, tribes });
  // What has state among the things built: found again among the records that were loaded.
  const fixtures = new Fixtures(world, records, items);
  fixtures.index();
  const build = new Build({ world, game, records, items, tribes, rules, fixtures, spill: (x, y, z, name) => death.spill(x, y, z, name) });
  death.onUseBuilt = (c, ref) => build.use(c, ref);
  if (persistence && !loaded!.fresh) build.decay.restore(persistence.store.meta("decay"));
  combat.onStructureHurt = (ref) => build.hurt(ref);
  const voice = new Voice({ game, muted: (listener, speaker) => chat.muted(listener.name, speaker.name), everywhere: () => rules.values.globalVoice !== 0 }, (out) => void crypto.getRandomValues(out));
  /** The session a survivor has here now, lingering bodies not counted. */
  const sessionOf = (pid: number) => game.clients.find((c) => c?.active && !c.closed && c.pid === pid) ?? null;
  tribes.onSave = () => persistence?.store.setMeta("tribes", tribes.serialize());
  tribes.onTeam = (rec) => refreshBody(rec);
  tribes.onNotice = (pid, text) => {
    const to = sessionOf(pid);
    if (to) game.sendText(to, TEXT_NOTICE, text);
  };
  const projectiles = new Projectiles({ world, game, records, items, combat }, (opts.seed ?? 1) + 71);
  combat.onFire = (c, rec, weapon, quality, ammo, draw) => projectiles.launch(c, rec, weapon, quality, ammo, draw);
  combat.onThrow = (c, rec, item, quality) => projectiles.lob(c, rec, item, quality);
  // Whoever killed it has what a kill gives, while it is still there to be asked about; then it dies.
  survival.onDeath = (rec, cause, by) => {
    // Taking the body out of the world looks at its vitals again: it dies once.
    if (rec.dead) return;
    combat.killed(rec, by);
    // Whatever was acting on it ends with it.
    rec.buffs.length = 0;
    rec.buffsVersion++;
    death.die(rec, cause);
  };
  // Going under, coming round, an injury, and anything else that begins or ends acting on a body change how it moves.
  const injured = reg.index.get("core:injured") ?? 0;
  survival.onOut = (rec) => refreshBody(rec);
  survival.onInjured = (rec, on) => void (on ? buffs.give(rec, injured) : buffs.take(rec, injured));
  buffs.onChange = (rec) => refreshBody(rec);
  if (harvest) {
    death.onUse = (c) => void harvest.pick(c);
    if (persistence) {
      if (!loaded!.fresh) for (const row of persistence.store.loadBlobs(harvest.tag)) harvest.decode(row.chunk, row.data);
      persistence.blobs.push(harvest);
    }
  }
  const wakeRadius = opts.wakeRadius ?? 3;
  /** A session's focus entered `to` and left `from` (-1 for none): creatures wake and nodes are filled around it. */
  const moved = (from: number, to: number): void => {
    creatures.playerMoved(from, to);
    if (harvest && wakeRadius >= 0) {
      if (to >= 0) harvest.retain(to, wakeRadius, 1);
      if (from >= 0) harvest.retain(from, wakeRadius, -1);
    }
  };
  if (loaded && !loaded.fresh) {
    // Every saved record that is not a survivor goes back where it stood: creatures to live, caches to wait.
    const survivors = new Set(persistence!.survivors.values());
    for (const rec of records.byPid.values()) {
      if (survivors.has(rec.pid)) {
        // Not in the world until its owner returns: its vitals wait.
        survival.restore(rec, false);
        continue;
      }
      // The state of something built has no body of its own: the structure is its body.
      if (rec.at >= 0 || reg.defs[rec.kind]?.type === "structure") continue;
      if (reg.defs[rec.kind]?.type === "prop") death.place(rec);
      else {
        const e = creatures.adopt(rec);
        if (e >= 0) persistence!.attach(rec, e);
      }
    }
    // Whatever was being made goes on being made.
    for (const rec of records.byPid.values()) progression.resume(rec);
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
  game.needsLook = (name) => !recordOf(name)?.look;
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
    // Its look is what it brought or chose; one that predates looks gets the plain one.
    if (!rec.look) {
      rec.look = c.look ?? defaultLook();
      records.dirty.add(rec.pid);
    }
    world.ents.setBodyLook(c.ent, rec.look);
    // Every survivor is on a team, if only its own.
    if (rec.team === 0) {
      rec.team = records.newTeam();
      records.dirty.add(rec.pid);
    }
    // A survivor has stat points like any body, all of them its own to place.
    rec.genome ??= new Genome();
    c.pid = rec.pid;
    if (persistence) persistence.attach(rec, c.ent);
    else {
      records.entOf.set(rec.pid, c.ent);
      world.ents.pid[c.ent] = rec.pid;
    }
    refreshBody(rec);
    survival.suspend(rec, false);
  };
  game.onBodyGone = (c) => {
    // Out of the world, a survivor neither eats nor drowns.
    const gone = records.byPid.get(c.pid);
    if (gone) survival.suspend(gone, true);
    inHand.delete(c.pid);
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
    // A survivor that joins dead has no body yet, but it is still that survivor.
    if (c.pid === 0) c.pid = recordOf(c.name)?.pid ?? 0;
    focus.set(c.id, c.chunk);
    moved(-1, c.chunk);
    // Its tribe sees it arrive.
    tribes.version++;
  };
  game.onPresence = (c) => {
    tribes.version++;
    // A connection that ended, or a new one in its place: the voice socket that went with the old one is no good.
    voice.revoke(c);
  };
  game.onExit = (c) => {
    tribes.version++;
    voice.revoke(c);
    moved(focus.get(c.id) ?? -1, -1);
    focus.delete(c.id);
  };
  game.onStep = (tick) => {
    for (const c of game.clients) {
      if (!c?.active) continue;
      const was = focus.get(c.id)!;
      if (c.chunk === was) continue;
      focus.set(c.id, c.chunk);
      moved(was, c.chunk);
    }
    // A head under water starts the air running out; coming up stops it.
    for (const c of game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const rec = records.byPid.get(c.pid);
      if (rec) survival.setSubmerged(rec, world.ents.y[c.ent]! + stanceEye(survivorMove, world.ents.stance[c.ent]!) < world.hf.seaLevel);
    }
    deadlines.run(tick, (kind, pid, stamp) => {
      if (kind === DEADLINE_VITALS) survival.due(pid, stamp);
      else if (kind === DEADLINE_DESPAWN) death.despawn(pid, stamp);
      else if (kind === DEADLINE_CRAFT) progression.due(pid, stamp);
      else if (kind === DEADLINE_NODE) harvest?.due(pid, stamp);
      else if (kind === DEADLINE_BUFF) buffs.due(pid, stamp);
    });
    death.step();
    // Swings that landed and shots that left on this tick, now that every body has moved.
    combat.step();
    projectiles.step();
    creatures.step(tick);
    build.step();
    voice.step(tick);
    // Who was last near what: saved now and then, not with every step somebody takes.
    if (persistence && build.decay.dirty && tick % DECAY_SAVE_TICKS === 0) persistence.store.setMeta("decay", build.decay.serialize());
    if (persistence && tick % commitEvery === 0) persistence.commit();
  };
  game.onLand = (c, speed) => {
    const rec = records.byPid.get(c.pid);
    if (rec) survival.landed(rec, speed);
  };
  const own: OwnContext = {
    world, game, records, items, survival, progression, rules, tribes, voice,
    online: (pid) => sessionOf(pid) !== null,
    openOf: (c) => death.openOf(c),
    closeOpen: (c) => death.close(c),
    respawn: (c, index) => death.respawn(c, index),
    refresh: (rec) => refreshBody(rec),
    drop: (rec, slot, n) => death.drop(rec, slot, n),
  };
  game.onReplicate = (c) => {
    syncOwn(own, c);
    harvest?.sync(c, game.opts.structRadius);
  };
  progression.onChange = (rec) => refreshBody(rec);
  addOwnCommands(own);

  function refreshBody(rec: EntityRecord): void {
    survival.init(rec);
    const e = records.entOf.get(rec.pid);
    if (e === undefined || reg.defs[rec.kind]?.type !== "species") return;
    refreshMods(reg, world.ents, e, rec.genome, rec.inv ? items.inv(rec).weight(items.table) : 0, buffs.speedOf(rec), buffs.rooted(rec), rec.out);
    // A survivor's level is what its experience has earned; a creature's is its points.
    const level = rec.kind === survivor ? progression.levelOf(rec.xp) : rec.genome ? rec.genome.level : 1;
    world.ents.setLook(e, level, rec.genome ? rec.genome.colors : null, rec.name);
    world.ents.setTeam(e, rec.team);
    // What it holds and wears is seen by others.
    const inv = rec.inv;
    if (inv && inv.hotbar >= 0) {
      const ents = world.ents;
      const slot = rec.held >= 0 && inv.item[inv.hotbar + rec.held] !== 0 ? inv.hotbar + rec.held : -1;
      const item = slot >= 0 ? inv.item[slot]! : 0;
      const was = ents.gear[e]?.[GEAR_HELD] ?? 0;
      gear[GEAR_HELD] = item;
      for (let k = 0; k < ARMOR_SLOTS; k++) gear[GEAR_WORN + k] = inv.item[inv.armor + k]!;
      ents.setGear(e, gear);
      // What its action step runs on: how the thing is held, what it has loaded, and what a reload would bring that to.
      // A weapon that is worn out holds nothing and takes nothing.
      const params = reg.weapon[item] ?? FISTS;
      const works = slot >= 0 && params.clip > 0 && inv.dur[slot]! > 0;
      const loaded = works ? inv.loaded[slot]! : 0;
      const ammo = works ? combat.ammoFor(rec, slot) : 0;
      ents.hold[e] = params.hold;
      ents.rounds[e] = loaded;
      ents.reloadTo[e] = works ? Math.min(params.clip, (ammo === inv.ammo[slot] ? loaded : 0) + (ammo !== 0 ? inv.total(ammo) : 0)) : 0;
      // Something else in its hands: whatever it was doing stops, and the new thing takes a moment to be ready.
      if (item !== was || slot !== (inHand.get(rec.pid) ?? -1)) {
        ents.act[e] = item !== 0 ? ACT_EQUIP : ACT_NONE;
        ents.actTicks[e] = 0;
      }
      inHand.set(rec.pid, slot);
    }
  }
  const gear = new Uint16Array(GEAR_COUNT);
  /** The slot of what each record had in its hands when its body was last refreshed. */
  const inHand = new Map<number, number>();

  const con = new Console();
  addCoreCommands(con);
  addAdminCommands(con);
  addCombatCommands(con);
  addSocialCommands(con);
  const host: Host = {
    world,
    records,
    game,
    creatures,
    items,
    survival,
    death,
    combat,
    buffs,
    rules,
    tribes,
    chat,
    voice,
    build,
    fixtures,
    online: (pid) => sessionOf(pid) !== null,
    setRule(name, value) {
      if (!rules.set(name, value)) return false;
      persistence?.store.setMeta("rules", rules.serialize());
      return true;
    },
    projectiles,
    progression,
    harvest,
    deadlines,
    persistence,
    loaded,
    console: con,
    adminPassword: opts.adminPassword || null,
    dev: opts.dev ?? false,
    spawnCreature,
    refreshBody,
    exec: (line, client) => con.exec({ host, client: client ?? null }, line),
    shutdown() {
      if (!persistence) return;
      // Every body still in the world is saved where it stands.
      for (const c of game.clients) if (c?.active && c.ent >= 0) records.dirty.add(c.pid);
      if (build.decay.dirty) persistence.store.setMeta("decay", build.decay.serialize());
      persistence.commit();
      persistence.store.close();
    },
  };
  game.handle(CMD_PLACE, (c, r) => build.place(c, r));
  game.handle(CMD_STRUCT, (c, r) => build.act(c, r));
  game.handle(CMD_CHAT, (c, r) => {
    const channel = r.bits(3);
    const words = r.string(MAX_TEXT_BYTES);
    if (r.overflow) return RESULT_INVALID;
    return chat.say(c, channel, words);
  });
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
