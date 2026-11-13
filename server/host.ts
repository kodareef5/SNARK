// Assembles a running world: map, records, persistence and the game loop.
// Used by server/main.ts and by tests; neither needs to know the wiring.

import type { Registry } from "../shared/content/registry.ts";
import { CMD_CHAT, CMD_FEED, CMD_NAME, CMD_OPEN, CMD_ORDER, CMD_PLACE, CMD_STRUCT, CMD_TEXT, MAX_TEXT_BYTES, RESULT_BUSY, RESULT_INVALID, RESULT_OK, TEXT_CONSOLE, TEXT_MOTD, TEXT_NOTICE, REJECT_KICKED } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Genome } from "../shared/sim/genome.ts";
import { addAdminCommands } from "./commands/admin.ts";
import { addCombatCommands } from "./commands/combat.ts";
import { addCoreCommands } from "./commands/core.ts";
import { addSocialCommands } from "./commands/social.ts";
import { addCreatureCommands } from "./commands/creatures.ts";
import { addSettingsCommands } from "./commands/settings.ts";
import { Build } from "./build.ts";
import { Fixtures } from "./fixtures.ts";
import { DEADLINE_TAME, Taming } from "./taming.ts";
import { Riding } from "./riding.ts";
import { Breeding, DEADLINE_BREED } from "./breeding.ts";
import { growthStep, youngShare } from "../shared/sim/breeding.ts";
import { buildRigs } from "../shared/anim/rigs.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { DEADLINE_FIRE, Stations } from "./stations.ts";
import type { BedPoint } from "./own.ts";
import { RESULT_WAIT } from "../shared/net/protocol.ts";
import { TICK_RATE } from "../shared/coords.ts";
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
import { Rules, type RuleName } from "./rules.ts";
import { CATALOG, rowOf } from "./settings/catalog.ts";
import { Lists } from "./settings/lists.ts";
import { timersOf } from "./settings/rules.ts";
import { LIVE_FILE, applyLive, emptyReport, formatReport } from "./settings/config.ts";
import { difficultyOf, tuningOf, wildLevel } from "./settings/tune.ts";
import { deriveRegistry } from "../shared/content/tuning.ts";
import { hourOfDay, offsetForHour } from "../shared/sim/clock.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
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
  /** Wild creatures placed around the plaza of a new world; the species they are (grazers unless said); and how many hunters besides, further off. */
  startingCreatures?: number;
  startingSpecies?: string;
  startingHunters?: number;
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
  /** The rigs of that pack: those that are skeletons in themselves are what creatures are posed and hit on. */
  rigs?: readonly PackRig[];
  /** Old rules to begin with other than their defaults, by their old names. */
  rules?: Partial<Record<RuleName, number>>;
  /**
   * The server's rules, ready made: read from its config files and command
   * line (server/settings/config.ts), or carried over from a host that is
   * being started again. In place of `rules`.
   */
  config?: Rules;
  /**
   * The live file as it is now: its text, or null if there is none. Asked
   * again every `AutoSavePeriodMinutes` and at `ForceUpdateDynamicConfig`, if
   * the server was started with `-UseDynamicConfig`. Whoever starts the
   * server gives it (it reads `DynamicConfig.ini` beside the other two files).
   */
  live?: () => string | null;
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
  readonly stations: Stations;
  readonly taming: Taming;
  readonly riding: Riding;
  readonly breeding: Breeding;
  /** The server's settings that are lists naming classes, as tables; and what they named that this build lacks. */
  readonly lists: Lists;
  /** What of the settings that change content was passed over as the server started, in words. */
  readonly passed: readonly string[];
  /** Whether the survivor with this persistent id has a session here now. */
  online(pid: number): boolean;
  /** Change a server rule, save it, and tell every client. False if there is no such rule or the value is out of range. */
  setRule(name: string, value: number): boolean;
  /**
   * Set a setting by ARK's name from words, as the console does: only one
   * that may change while the server runs. Returns "" if it was set, or why
   * it was not. It lasts until the server is started again.
   */
  setSetting(name: string, words: string): string;
  /** Read the live file again now: what came of it, in words. */
  readLive(): string[];
  /** What a loaded save's timers were worked out under, by setting; null for a new world. */
  readonly loadedUnder: Record<string, number> | null;
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

/** After someone returns to life at a bed, nobody may again for this long: five minutes, in ticks. */
export const BED_WAIT_TICKS = 5 * 60 * TICK_RATE;
/** How often the clocks of decay are saved: once a minute, in ticks. */
const DECAY_SAVE_TICKS = 1800;

/**
 * Content as a server on these rules has it: what its settings make of the
 * definitions `content` came from. For whoever builds a world before the host
 * that will run it: the world must be made of this.
 */
export function contentFor(content: Registry, rules: Rules): Registry {
  return deriveRegistry(content, tuningOf(rules, new Lists(rules, content), content).tuning);
}

export function createHost(content: Registry, opts: HostOptions = {}): Host {
  // The files are the truth at every start (D88): nothing of the rules is read from the save.
  const rules = opts.config ?? new Rules(opts.rules);
  const lists = new Lists(rules, content);
  // Some settings change what content says. They are applied to the definitions, once, before anything reads them (D90):
  // from here on `reg` is content as this server has it, and there is no other.
  const tuned = tuningOf(rules, lists, content);
  lists.warm();
  const derived = deriveRegistry(content, tuned.tuning);
  // A world made before its host was made of some content already: it must be this content, and then its registry is the one.
  if (opts.world && opts.world.reg.hash !== derived.hash) throw new Error("a world made before its host must be made of the content the host's settings give: contentFor(content, rules)");
  const reg = opts.world ? opts.world.reg : derived;
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, opts.store) : null;
  // A save supplies its own structures; only a new world gets the proving ground's.
  const world = opts.world ?? createProvingWorld(reg, { populate: !store || store.fresh });
  // How fast its clock runs: the server's three rules for it. Clients are told as they are welcomed.
  world.clock.cycle = rules.num("DayCycleSpeedScale");
  world.clock.day = rules.num("DayTimeSpeedScale");
  world.clock.night = rules.num("NightTimeSpeedScale");
  // A new world begins at nine in the morning, by that clock.
  world.dayOffset = offsetForHour(world.tick, 9, world.clock);
  if (opts.clips) world.anim = new HumanAnim(opts.clips);
  if (opts.clips && opts.rigs) world.rigs = buildRigs(opts.rigs, opts.clips);
  let settingsAt: { dirty: boolean; version: number } | null = null;
  const records = new Records(opts.worldId ?? 1);
  // The most survivors at once: what whoever assembles the world says, else ARK's command-line flag, else its file's setting.
  const seats = rules.flag("WinLiveMaxPlayers");
  const game = new GameServer(world, {
    password: rules.text("ServerPassword"),
    motdSeconds: rules.num("Duration"),
    ...opts.game,
    maxClients: opts.game?.maxClients ?? (typeof seats === "string" && seats !== "" ? Number(seats) : rules.num("MaxPlayers")),
  });
  const persistence = store ? new Persistence(world, records, store) : null;
  const loaded = persistence ? persistence.load() : null;
  const commitEvery = opts.commitEvery ?? 6;
  const survivor = reg.index.get("core:survivor")!;
  const survivorMove = reg.move[survivor]!;
  const names = new Map<string, number>();
  // One heap for everything that happens at a tick; entries are dispatched by kind in onStep.
  const deadlines = new DeadlineHeap();
  const survival = new Survival(world, records, deadlines);
  survival.rules = rules;
  const items = new Items(world, records);
  // A save's ledger must match what the save holds, or the save is not trusted.
  if (persistence) {
    items.restore(loaded!.fresh ? "{}" : (persistence.store.meta("ledger") as string | null));
    const wrong = items.audit();
    if (wrong.length > 0 && !opts.allowLedgerMismatch) throw new Error("the item ledger does not balance:\n" + wrong.join("\n"));
    persistence.ledger = items;
  }
  const creatures = new Creatures(world, game, records, survival, opts.seed ?? 1, opts.wakeRadius ?? 3);
  creatures.swimGain = rules.num("OxygenSwimSpeedStatMultiplier");
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
  const death = new Death({ world, game, records, items, survival, creatures, persistence, deadlines, rules });
  const progression = new Progression(world, records, items, deadlines);
  progression.rules = rules;
  const harvest = world.nodeField ? new Harvest(world, game, records, items, progression, deadlines, (opts.seed ?? 1) + 31) : null;
  if (harvest) {
    harvest.rules = rules;
    harvest.lists = lists;
  }
  const buffs = new Buffs(world, records, survival, deadlines);
  // What is kept with the world is what its timers were worked out under, so that they can be re-timed under other rules.
  const loadedUnder = persistence && !loaded!.fresh ? timersOf(persistence.store.meta("settings_at"), persistence.store.meta("rules")) : null;
  if (persistence) {
    const at = { dirty: true, version: rules.version, serialize: () => JSON.stringify({ timers: rules.timers() }) };
    persistence.settingsAt = at;
    settingsAt = at;
  }
  const combat = new Combat({ world, game, records, items, survival, progression, creatures, buffs, rules, lists, harvest }, (opts.seed ?? 1) + 53);
  // A creature's bite is a blow like any other.
  creatures.onStrike = (e) => combat.bite(e);
  const tribes = new Tribes(world, records);
  tribes.rules = rules;
  if (persistence && !loaded!.fresh) tribes.restore(persistence.store.meta("tribes"));
  // Taming: what a creature lying unconscious is given, and whose it becomes.
  const taming = new Taming({ world, game, records, items, survival, buffs, rules, lists, tribes, deadlines, creatures, progression, onNotice: (pid, text) => notice(pid, text), openOf: (c) => death.openOf(c), refresh: (rec) => refreshBody(rec), onTamed: (rec) => {
    const e = records.entOf.get(rec.pid);
    // Somebody's now: until it is told otherwise it stands where it woke.
    if (e !== undefined) {
      creatures.mind.stay(e, 0xffffffff);
      creatures.claimed(e);
    }
  } }, (opts.seed ?? 1) + 71);
  // A creature that is somebody's can be looked into by its tribe while it is awake; shut, it may have more to eat than it had.
  death.canOpen = (c, rec) => rec.team !== 0 && tribes.may(records.byPid.get(c.pid), rec.team);
  death.onShut = (rec) => taming.meal(rec);
  // Riding: the use button on a saddled creature of one's tribe gets on it, and on a mount gets off.
  const riding = new Riding({ world, game, records, tribes, refresh: (rec) => refreshBody(rec) });
  death.riding = (c) => riding.riding(c);
  death.offMount = (c) => riding.dismount(c);
  // Breeding: pairs among the creatures that are somebody's, what they lay, and what hatches and grows up.
  const breeding = new Breeding({ world, game, records, rules, lists, deadlines, creatures, persistence, full: (team) => taming.full(team), notice: (pid, text) => notice(pid, text), place: (rec) => death.place(rec), refresh: (rec) => refreshBody(rec), meal: (rec) => taming.meal(rec) }, (opts.seed ?? 1) + 89);
  taming.onMate = (rec, what) => breeding.order(rec, what);
  taming.bred = (rec) => breeding.subject(rec);
  death.onRide = (c, e) => {
    const rec = records.byPid.get(world.ents.pid[e]!);
    // A young one that is nobody's: whoever uses it takes it.
    if (rec && breeding.unclaimed(rec)) return breeding.claim(c, rec);
    // Only what is saddled, grown, awake, and theirs is something to ride, and nothing is if the server says so; anything else is whatever it was.
    if (rules.on("bDisableDinoRiding")) return -1;
    if (!rec || rec.keyHash !== null || rec.saddle === 0 || rec.out || rec.grown !== 0 || !tribes.may(records.byPid.get(c.pid), rec.team)) return -1;
    return riding.mount(c, e);
  };
  combat.riderOf = (mount) => {
    const e = records.entOf.get(mount.pid);
    return e === undefined ? null : riding.riderOf(e);
  };
  combat.onHarm = (victim, points) => taming.harmed(victim, points);
  const chat = new Chat({ game, records, rules, tribes });
  // What has state among the things built: found again among the records that were loaded.
  const fixtures = new Fixtures(world, records, items);
  fixtures.rules = rules;
  fixtures.index();
  const stations = new Stations(world, records, items, fixtures, deadlines);
  const build = new Build({ world, game, records, items, tribes, rules, fixtures, light: (ref) => stations.toggle(ref), spill: (x, y, z, name) => death.spill(x, y, z, name) });
  death.onUseBuilt = (c, ref) => build.use(c, ref);
  if (persistence && !loaded!.fresh) build.decay.restore(persistence.store.meta("decay"));
  combat.onStructureHurt = (ref) => build.hurt(ref);
  const voice = new Voice({ game, muted: (listener, speaker) => chat.muted(listener.name, speaker.name), everywhere: () => rules.values.globalVoice !== 0 }, (out) => void crypto.getRandomValues(out));
  /** The session a survivor has here now, lingering bodies not counted. */
  const sessionOf = (pid: number) => game.clients.find((c) => c?.active && !c.closed && c.pid === pid) ?? null;
  /** Tell a survivor something, if they are here. */
  function notice(pid: number, text: string): void {
    const to = sessionOf(pid);
    if (to) game.sendText(to, TEXT_NOTICE, text);
  }
  tribes.onSave = () => persistence?.store.setMeta("tribes", tribes.serialize());
  tribes.onTeam = (rec) => refreshBody(rec);
  tribes.onNotice = (pid, text) => notice(pid, text);
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
  survival.onOut = (rec, out) => {
    refreshBody(rec);
    taming.out(rec, out);
  };
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
  /**
   * The values the world's timers and rates are worked out under: a save's
   * own until it has been brought to this server's, then this server's. A
   * setting the save says nothing of was at its default.
   */
  let under: Record<string, number> = loadedUnder ?? rules.timers();
  const wasAt = (name: string): number => under[name] ?? (rowOf(name)!.def as number);
  const RATES = CATALOG.filter((row) => row.retime === "rate").map((row) => row.name);
  /**
   * Bring everything under way from the values it was worked out under to
   * the server's now (D91): at a load, once, for a save made under other
   * settings; and while the server runs, whenever a rule that may change
   * does. One function for each kind of thing, the same for both. What is
   * worked out only when someone looks (a stack's spoiling, a fire) cannot
   * change while the server runs, and is settled as it was before it is
   * re-timed.
   */
  const retime = (atLoad: boolean): void => {
    const now = rules.timers();
    let any = false;
    for (const name in now) if (wasAt(name) !== now[name]) any = true;
    if (!any) {
      under = now;
      return;
    }
    breeding.retime({ hatch: wasAt("EggHatchSpeedMultiplier"), mature: wasAt("BabyMatureSpeedMultiplier"), interval: wasAt("MatingIntervalMultiplier"), mating: wasAt("MatingSpeedMultiplier") });
    death.retime(wasAt("GlobalItemDecompositionTimeMultiplier"), wasAt("GlobalCorpseDecompositionTimeMultiplier") * wasAt("UseCorpseLifeSpanMultiplier"));
    if (atLoad) {
      harvest?.retime(wasAt("ResourcesRespawnPeriodMultiplier"));
      const spoilWas = wasAt("GlobalSpoilingTimeMultiplier");
      const fuelWas = wasAt("FuelConsumptionIntervalMultiplier");
      if (spoilWas !== now.GlobalSpoilingTimeMultiplier || fuelWas !== now.FuelConsumptionIntervalMultiplier) {
        // Content as it was when the save was made, in the two things that time what lies in a box or on a fire.
        const old = deriveRegistry(content, { ...tuned.tuning, spoil: spoilWas, fuel: fuelWas });
        items.table = old;
        stations.refuel(old.fuelTicks, fuelWas, now.FuelConsumptionIntervalMultiplier!);
        items.respoil(old, spoilWas, now.GlobalSpoilingTimeMultiplier!);
        items.table = reg;
      }
    } else if (RATES.some((name) => wasAt(name) !== now[name])) {
      // A rate that may change while the server runs is the young's hunger: each is rated again, and eats when that says.
      for (const rec of records.byPid.values()) {
        if (rec.grown === 0 || rec.egg !== null || !rec.vitals) continue;
        survival.touch(rec);
        taming.meal(rec);
      }
    }
    under = now;
    if (settingsAt) settingsAt.dirty = true;
  };
  let retimedAt = rules.version;
  /** Ticks between looks at the live file: ARK reads its own at every save of the world. */
  const liveEvery = Math.max(1, Math.round(rules.num("AutoSavePeriodMinutes") * 60 * TICK_RATE));
  const readLive = (): string[] => {
    if (!opts.live || rules.flag("UseDynamicConfig") !== true) return ["the live file is not in use: the server was not started with -UseDynamicConfig"];
    const text = opts.live();
    if (text === null) return [`there is no ${LIVE_FILE} to read`];
    const report = emptyReport();
    applyLive(rules, text, report);
    const [first, ...rest] = formatReport(report, rules);
    return [`${LIVE_FILE} read again: ${first!.slice("settings: ".length)}`, ...rest];
  };
  if (loaded && !loaded.fresh) {
    // Bodies saved under other rates than this server's are rated again as they are taken in.
    survival.rerate = RATES.some((name) => wasAt(name) !== rules.num(name));
    // Every saved record that is not a survivor goes back where it stood: creatures to live, caches to wait.
    const survivors = new Set(persistence!.survivors.values());
    for (const rec of records.byPid.values()) {
      if (survivors.has(rec.pid)) {
        // Not in the world until its owner returns: its vitals wait.
        survival.restore(rec, false);
        continue;
      }
      // The state of something built has no body of its own: the structure is its body. Nor have young that are carried.
      if (rec.at >= 0 || reg.defs[rec.kind]?.type === "structure" || (rec.egg !== null && rec.egg.carrier !== 0)) continue;
      if (reg.defs[rec.kind]?.type === "prop") death.place(rec);
      else {
        const e = creatures.adopt(rec);
        if (e >= 0) persistence!.attach(rec, e);
      }
    }
    survival.rerate = false;
    // The hour is what it was when the world was stopped, whatever pace the clock keeps now: the offset is worked out
    // again for the new pace. A save from before the clock had a pace of its own counted 140 seconds to the hour.
    const paced = loadedUnder !== null && loadedUnder.DayCycleSpeedScale !== undefined;
    const pace = { cycle: wasAt("DayCycleSpeedScale"), day: wasAt("DayTimeSpeedScale"), night: wasAt("NightTimeSpeedScale") };
    if (!paced || pace.cycle !== world.clock.cycle || pace.day !== world.clock.day || pace.night !== world.clock.night) {
      const hour = paced ? hourOfDay(world.tick, world.dayOffset, pace) : ((world.tick + world.dayOffset) % (24 * GAME_HOUR_TICKS)) / GAME_HOUR_TICKS;
      world.dayOffset = offsetForHour(world.tick, hour, world.clock);
      if (settingsAt) settingsAt.dirty = true;
    }
    // A save made under other settings is brought to this server's, once: its timers from the values kept with it.
    retime(true);
    // With every body back and its limits known, whatever was under way goes on: what was being made, fires,
    // creatures lying there being tamed and the meals of those that are somebody's, eggs, and the young.
    for (const rec of records.byPid.values()) progression.resume(rec);
    stations.resume();
    taming.resume();
    breeding.resume();
  } else {
    const rng = new Rng((opts.seed ?? 1) + 17);
    // What is found wild is found at one of thirty levels the size of the server's difficulty.
    const difficulty = difficultyOf(rules);
    // Scatter the herd north of the spawn point; positions inside structures are skipped and retried.
    // None at all if the server was started so (ARK's -NoDinos).
    const none = rules.flag("NoDinos") === true;
    let wanted = none ? 0 : (opts.startingCreatures ?? 0);
    for (let tries = wanted * 20; wanted > 0 && tries > 0; tries--) {
      if (spawnCreature(opts.startingSpecies ?? "core:grazer", rng.range(226, 286), rng.range(244, 300), wildLevel(1 + rng.int(30), difficulty)) >= 0) wanted--;
    }
    // Hunters at the far edge of that ground: near enough to be found, too far to see who has just arrived.
    let hunters = none ? 0 : (opts.startingHunters ?? 0);
    for (let tries = hunters * 20; hunters > 0 && tries > 0; tries--) {
      if (spawnCreature("core:raptor", rng.range(226, 286), rng.range(288, 300), wildLevel(1 + rng.int(30), difficulty)) >= 0) hunters--;
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
    // The server's name and its message of the day, if it has them: each line of the message its own.
    const name = rules.text("SessionName");
    if (name !== "") game.sendText(c, TEXT_MOTD, name);
    for (const line of rules.text("Message").split("\\n")) if (line.trim() !== "") game.sendText(c, TEXT_MOTD, line.trim());
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
      else if (kind === DEADLINE_FIRE) stations.due(pid, stamp);
      else if (kind === DEADLINE_TAME) taming.due(pid, stamp);
      else if (kind === DEADLINE_BREED) breeding.due(pid, stamp);
    });
    death.step();
    // Riders go where their mounts went this tick, before anything is aimed at either.
    riding.step();
    // Swings that landed and shots that left on this tick, now that every body has moved.
    combat.step();
    projectiles.step();
    creatures.step(tick);
    build.step();
    taming.step();
    breeding.step(tick);
    voice.step(tick);
    // Whoever has done nothing for as long as the server's rule allows is put off it, if it was started to (ARK's -EnableIdlePlayerKick).
    if (tick % TICK_RATE === 0 && rules.flag("EnableIdlePlayerKick") === true) {
      const most = Math.round(rules.num("KickIdlePlayersPeriod") * TICK_RATE);
      for (const c of game.clients) if (c?.active && !c.closed && tick - c.activeAt > most) game.reject(c, REJECT_KICKED);
    }
    // The live file, looked at again as often as the server's rule says. What it changes is said; what it leaves alone is not.
    if (opts.live && tick % liveEvery === 0 && rules.flag("UseDynamicConfig") === true) {
      const before = rules.version;
      const said = readLive();
      if (rules.version !== before) for (const line of said) console.log(line);
    }
    // A rule has changed: whatever it times is timed again from this tick,
    if (retimedAt !== rules.version) {
      retimedAt = rules.version;
      retime(false);
    }
    // and what the world's timers are worked out under goes into the next commit with them.
    if (settingsAt && settingsAt.version !== rules.version) {
      settingsAt.version = rules.version;
      settingsAt.dirty = true;
    }
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
    respawn: (c, index) => {
      const p = c.respawnAt[index];
      if (!p) return RESULT_INVALID;
      if (p.bed < 0) return death.respawn(c, p.x, p.z, p.yaw);
      // A bed: still there, still its tribe's, and not just used.
      const bed = fixtures.find(p.bed);
      const t = world.structs.chunks[Math.floor(p.bed / 65536)];
      const slot = p.bed & 0xffff;
      if (!bed || !t || world.reg.isBed[t.kind[slot]!] !== 1 || !tribes.may(records.byPid.get(c.pid), t.owner[slot]!)) return RESULT_INVALID;
      if (bed.readyAt > world.tick) return RESULT_WAIT;
      const code = death.respawn(c, p.x, p.z, p.yaw, p.y);
      if (code === RESULT_OK) {
        bed.readyAt = world.tick + BED_WAIT_TICKS;
        records.dirty.add(bed.pid);
      }
      return code;
    },
    subject: (rec) => taming.subject(rec),
    beds: (rec) => {
      const out: BedPoint[] = [];
      fixtures.each((ref, bed) => {
        const t = world.structs.chunks[Math.floor(ref / 65536)]!;
        const slot = ref & 0xffff;
        const kind = t.kind[slot]!;
        if (world.reg.isBed[kind] !== 1 || !tribes.may(rec, t.owner[slot]!)) return;
        // To stand on it, facing the way it does.
        out.push({ ref, name: `bed at ${Math.round(t.x[slot]!)}, ${Math.round(t.z[slot]!)}`, x: t.x[slot]!, y: t.y[slot]! + world.reg.halfY[kind]!, z: t.z[slot]!, yaw: (t.yaw[slot]! / 65536) * 2 * Math.PI, wait: Math.max(0, Math.ceil((bed.readyAt - world.tick) / TICK_RATE)) });
      });
      return out;
    },
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
    // What it carries; and, for a mount, what its rider carries too.
    const rider = riding.riderOf(e);
    const load = (rec.inv ? items.inv(rec).weight(items.table) : 0) + (rider?.inv ? items.inv(rider).weight(items.table) : 0);
    // A young one can carry a share of what a grown one can: the same load is that much more of it.
    const strength = youngShare(growthStep(rec.span, rec.grown, world.tick));
    refreshMods(reg, world.ents, e, rec.genome, load / strength, buffs.speedOf(rec), buffs.rooted(rec), rec.out, creatures.swimGain);
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
  addCreatureCommands(con);
  addSettingsCommands(con);
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
    stations,
    taming,
    riding,
    breeding,
    online: (pid) => sessionOf(pid) !== null,
    setRule(name, value) {
      return rules.set(name, value);
    },
    setSetting(name, words) {
      const row = rowOf(name);
      if (!row) return `there is no setting called ${name}`;
      if (row.status !== "live") return `${row.name} does not take effect yet`;
      if (!row.live) return `${row.name} is read when the server starts: set it in its file and start again`;
      return rules.assign(row.name, words, "console");
    },
    readLive,
    loadedUnder,
    projectiles,
    progression,
    harvest,
    deadlines,
    persistence,
    loaded,
    console: con,
    adminPassword: opts.adminPassword || rules.text("ServerAdminPassword") || null,
    lists,
    passed: tuned.passed,
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
  game.handle(CMD_FEED, (c, r) => taming.feed(c, r));
  game.handle(CMD_ORDER, (c, r) => taming.order(c, r));
  game.handle(CMD_OPEN, (c, r) => taming.open(c, r));
  game.handle(CMD_NAME, (c, r) => taming.rename(c, r));
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
