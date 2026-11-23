import { SurvivorActivity } from "./survivor-activity.ts";
import { CREATE_REQUEST,ownsSurvivor } from "./survivor-access.ts";
import { ZONE_NONE, ZONE_TORSO } from "../shared/anim/human.ts";
import { IMPALE_SLOT } from "../shared/sim/seats.ts";
import { CreatureTraits, inventoryEffectiveWeight } from "./creature-traits.ts";
import { CreatureImpale } from "./creature-impale.ts";
import { CreatureContacts } from "./creature-combat.ts";
// Assembles a running world: map, records, persistence and the game loop. server/main.ts and the tests both use it.

import { withContent, type Registry } from "../shared/content/registry.ts";
import { CHOOSE_ARRIVED, CHOOSE_DIED, SESSION_DEAD, CMD_CARRY, CMD_CHAT, CMD_EMOTE, CMD_CLOSE, CMD_FAR, CMD_FEED, CMD_NAME, CMD_OPEN, CMD_ORDER, CMD_PLACE, CMD_STRUCT, CMD_TAKE, CMD_TEXT, CMD_THROW, CMD_TRAVEL, CMD_VEHICLE, MAX_CHAT_BYTES, MAX_TEXT_BYTES, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OK, TEXT_CONSOLE, TEXT_MOTD, TEXT_NOTICE, REJECT_KICKED, RESTART_MOST, RESTART_OFF } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Genome } from "../shared/sim/genome.ts";
import { Build } from "./build.ts";
import { Motion } from "./motion.ts";
import { Fixtures } from "./fixtures.ts";
import { Beds, type Place } from "./beds.ts";
import { CastHost } from "./cast/host.ts";
import type { CastSettings } from "../shared/cast/state.ts";
import { Taming } from "./taming.ts";
import { Riding } from "./riding.ts";
import { Urban } from "./urban.ts";
import { foundVehicle, vehiclePlaceFree, VehicleService, VEHICLE_ORIGIN, type VehicleStart } from "./vehicle-service.ts";
import { vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { carShapes } from "../shared/world/vehicle-shapes.ts";
import { StaticVehicleSolids } from "../shared/world/vehicle-solid.ts";
import { isBoatVehicle, isSkateboard, isRotorVehicle, isWheelVehicle } from "../shared/sim/vehicle.ts";
import { boatRestY } from "../shared/sim/boat.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { VehicleContacts } from "./vehicle-contacts.ts";
import { Entangle } from "./entangle.ts";
import { Breeding } from "./breeding.ts";
import { Emotes } from "./emote.ts";
import { Carry } from "./carry.ts";
import { Corpses } from "./corpses.ts";
import { CorpseReplication } from "./corpse-motion.ts";
import { CMD_CLOCK, CMD_CORPSE } from "../shared/net/protocol.ts";
import { Creative } from "./creative.ts";
import { Balls } from "./balls.ts";
import { Eggs } from "./eggs.ts";
import { MountedRoars } from "./creature-roar.ts";
import { Feces } from "./feces.ts";
import { Hurt } from "./hurt.ts";
import { Overhead } from "./overhead.ts";
import { Gaze } from "./gaze.ts";
import { growthStep, youngShare } from "../shared/sim/breeding.ts";
import { creatureAnims } from "../shared/anim/creature.ts";
import { buildRigs } from "../shared/anim/rigs.ts";
import type { CorpseImpact } from "../shared/anim/corpse.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { Stations, tellStation } from "./stations.ts";
import { wirePower } from "./power.ts";
import { wirePreserve } from "./preserve.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Chat } from "./chat.ts";
import { Tribes } from "./tribes.ts";
import { Voice } from "./voice.ts";
import { Console, OP_ADMIN } from "./console.ts";
import { DeadlineHeap } from "../shared/sim/schedule.ts";
import { Buffs } from "./buffs.ts";
import { Combat, type Source } from "./combat.ts";
import { DMG_MELEE } from "../shared/sim/damage.ts";
import { Creatures } from "./creatures.ts";
import { Containers } from "./containers.ts";
import { Death, OP_DEATH } from "./death.ts";
import { Harvest } from "./harvest.ts";
import { VehicleTrees } from "./vehicle-trees.ts";
import { Progression } from "./progression.ts";
import { JET_BOOTS, JET_CUIRASS, JET_HELMET, stanceEye } from "../shared/sim/character.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { ACT_EQUIP, ACT_NONE, FISTS, HOLD_CARRY } from "../shared/sim/weapon.ts";
import { GameServer, type Client, type GameOptions } from "./game.ts";
import { walk, type System } from "./system.ts";
import { Items } from "./items.ts";
import { COMMAND_FAMILIES } from "./commands/families.ts";
import { addOwnCommands, addOwnState, syncOwn, type OwnContext } from "./own.ts";
import { Persistence, type LoadReport } from "./persist/persistence.ts";
import { Loose } from "./loose.ts";
import { Falls } from "./falls.ts";
import { Projectiles } from "./projectiles.ts";
import { Clouds } from "./clouds.ts";
import type { ModuleDef } from "./api/module.ts";
import { Bus, event } from "./events/bus.ts";
import { Modules } from "./events/modules.ts";
import { workerKeeper } from "./persist/keeper.ts";
import { WorldStore, type StoreOptions } from "./persist/store.ts";
import { Records, hashKey, type EntityRecord } from "./records.ts";
import { Use } from "./use.ts";
import { Rules, timersOf, wordsOf } from "./settings/rules.ts";
import { CATALOG, fixedWhy, rowOf } from "./settings/catalog.ts";
import { KeptSettings, rowNamed } from "./settings/kept.ts";
import { Lists } from "./settings/lists.ts";
import { LIVE_FILE, applyLive, emptyReport, formatReport } from "./settings/config.ts";
import { difficultyOf, tuningOf, wildLevel } from "./settings/tune.ts";
import { deriveRegistry, tuningText, type Tuning } from "../shared/content/tuning.ts";
import { withSurfaces } from "../shared/world/structures.ts";
import { hourOfDay, offsetForHour } from "../shared/sim/clock.ts";
import { CAUSE_WORDS, Survival, refreshMods } from "./survival.ts";
import { createMapWorld, provingFile, type ServerWorld } from "./world.ts";
import { settle, settleNear } from "./place.ts";
import { Spawner, wildStep } from "./spawner.ts";
import { PART } from "./admin/parts.ts";
import { CarReturn } from "./car-return.ts";
import { withSites } from "../content/supply/sites.ts";
import { starterBook } from "../content/supply/starter.ts";
import { catalogOf } from "../shared/supply/catalog.ts";
import { SETTING as ARK_CRATES, arkCrates } from "./supply/ark.ts";
import { Supply } from "./supply.ts";
import { BookStore } from "./supply/store.ts";
import { builtinLoadouts } from "../content/loadouts.ts";
import { LoadoutStore } from "./loadout/store.ts";
import { spawnTables } from "./settings/spawns.ts";
import { parseMap, type MapFile } from "../shared/world/mapfile.ts";
import { Tactical } from "./tactical.ts";
import type { ClipSet } from "../shared/anim/clip.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { F_ALIVE, GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ON } from "../shared/sim/items.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import { Cluster } from "./cluster/cluster.ts";
import { SurvivorLog, type SurvivorLogOptions } from "./survivor-log/log.ts";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface HostOptions {
  /** SQLite file. Omit for a world that lives only in memory. */
  dbPath?: string;
  worldId?: number;
  /** Ticks between commits. 6 ticks is 200 ms. */
  commitEvery?: number;
  /** "worker" gives checkpoints and backups to a thread of their own, as a running server wants. The default does them on the calling thread. */
  keeper?: "inline" | "worker";
  /** Back the save up beside itself at every autosave mark (AutoSavePeriodMinutes). */
  backups?: boolean;
  /** Modules to load, in order (server/api/module.ts). */
  modules?: readonly ModuleDef[];
  /** A clock in milliseconds, for timing what modules do. Without one nothing is timed. */
  now?: () => number;
  /** Where the host's own lines go. The console, where not given. */
  log?: (line: string) => void;
  game?: Partial<GameOptions>;
  store?: StoreOptions;
  /** Keep the map's spawn regions stocked with wild creatures (server/spawner.ts), as a running server does. Off where not given. */
  wild?: boolean;
  /** Cast's background people (server/cast): settings over its defaults, or true for them as they are. Off unless given. */
  cast?: boolean | Partial<CastSettings>;
  /** For a new world: wild creatures scattered near the spawn point, their species (core:grazer by default), and hunters further off. */
  startingCreatures?: number;
  startingSpecies?: string;
  startingHunters?: number;
  /** Chunks around a player in which creatures are simulated. */
  wakeRadius?: number;
  /**
   * A map file (shared/world/mapfile.ts): its bytes, or its path, which is read here and not kept, as the server serves the
   * file from there. Without one, and without `world`, the proving ground.
   */
  map?: Uint8Array<ArrayBuffer> | string;
  /** Reads the map while it is being loaded, before the simulation drops its drawing data. */
  onMapLoaded?: (map: MapFile) => void;
  /** Use this world instead of creating one from a map file. Its structures are kept only if the save is new. */
  world?: ServerWorld;
  /** For a world the host creates: the most entities it holds, in place of the MaxEntities setting, and the size its store starts at. */
  entityMax?: number;
  entityStart?: number;
  seed?: number;
  /** Password for `enablecheats`. Without one, cheats are off unless `dev` is set. */
  adminPassword?: string;
  /** Development server. Cheats need no password. Never set it in a public deployment. */
  dev?: boolean;
  /** Load a save whose item ledger does not match its contents, instead of refusing. */
  allowLedgerMismatch?: boolean;
  /** The animation clips of the asset pack the clients are served. They decide where hit zones are. */
  clips?: ClipSet;
  /** The rigs of that pack. Creatures are posed and hit on the rigs that have their own bones. */
  rigs?: readonly PackRig[];
  /** The server's rules (server/settings/config.ts). Without them, ARK's defaults. */
  config?: Rules;
  /**
   * Returns the live file's text, or null if there is none. With -UseDynamicConfig the host reads it every
   * AutoSavePeriodMinutes and on the forceupdatedynamicconfig command.
   */
  live?: () => string | null;
  /** How the survivor log beside the save is written and read (server/survivor-log/log.ts). */
  survivorLog?: SurvivorLogOptions;
}

/** Ticks between console lines accepted from one session. */
const TEXT_INTERVAL = 6;

export interface Host {
  survivorIds(): IterableIterator<number>;
  survivorRecord(name: string): EntityRecord | undefined;
  readonly world: ServerWorld;
  /**
   * The map file the world stands on, for clients to fetch: HostOptions.map's bytes, or the proving ground's. Null for a world
   * made in code and handed to the host, and for a map given by its path, which is served from its file.
   */
  readonly mapFile: Uint8Array<ArrayBuffer> | null;
  readonly records: Records;
  readonly activity: SurvivorActivity;
  /** Where each survivor was and what it held, over time, and the functions that read it back. */
  readonly survivorLog: SurvivorLog;
  readonly game: GameServer;
  readonly creatures: Creatures;
  readonly impale: CreatureImpale;
  readonly items: Items;
  readonly survival: Survival;
  readonly death: Death;
  readonly containers: Containers;
  readonly combat: Combat;
  readonly buffs: Buffs;
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly chat: Chat;
  readonly voice: Voice;
  readonly build: Build;
  readonly fixtures: Fixtures;
  readonly motion: Motion;
  readonly stations: Stations;
  readonly taming: Taming;
  readonly riding: Riding;
  readonly urban: Urban;
  /** The city's background people (server/cast): always there, idle while CastEnabled is off. */
  readonly cast: CastHost;
  readonly vehicles: VehicleService;
  readonly entangle: Entangle;
  readonly breeding: Breeding;
  readonly tactical: Tactical;
  /** The creature packages' modules, each still doing nothing. */
  readonly corpses: Corpses;
  readonly carry: Carry;
  readonly emotes: Emotes;
  readonly feces: Feces;
  readonly eggs: Eggs;
  /** Things thrown from the hand, in flight (server/loose.ts). */
  readonly loose: Loose;
  /** Survivors knocked off their feet, lying as ragdolls (server/falls.ts). */
  readonly falls: Falls;
  readonly balls: Balls;
  readonly overhead: Overhead;
  readonly gaze: Gaze;
  readonly hurt: Hurt;
  /** Null unless the host was asked to keep the wild stocked and the map has spawn regions. Under a -NoDinos flag it makes nothing. */
  readonly spawner: Spawner | null;
  /** Null for a map that parks no car. */
  readonly carReturn: CarReturn | null;
  /** Supply drops, and the drop book they are rolled from (server/supply.ts). */
  readonly supply: Supply;
  readonly supplyBook: BookStore;
  /** The loadouts new survivors are given, kept beside the save (server/loadout/store.ts). */
  readonly loadoutBook: LoadoutStore;
  /** Where a survivor without a body may rise, and its choosing (server/beds.ts). */
  readonly beds: Beds;
  /** The cluster the server is part of (-clusterid), or null for one alone. */
  readonly cluster: Cluster | null;
  /** Bodies found inside a node or a piece as their chunk or a node near them loaded, and set free (server/place.ts). */
  readonly settled: { readonly bodies: number };
  /** The list settings that name classes, as tables, and the names this build lacks. */
  readonly lists: Lists;
  /** The content-changing settings the server skipped at startup, one line each. */
  readonly passed: readonly string[];
  /** A lingering body does not count. */
  online(pid: number): boolean;
  /** Sets a live setting by ARK's name. Returns "" if it was set, or the reason it was not. It lasts until the server restarts. */
  setSetting(name: string, words: string): string;
  /**
   * Sets a live setting from the admin page, a list or a command-line flag too (`-Name`), and keeps it across restarts
   * (settings/kept.ts). Null words take the page's value away. `why` is "" if it was done; `unkept` says why the
   * change, though made, was not written beside the save.
   */
  pageSetting(name: string, words: string | null): { why: string; unkept?: string };
  /** What the admin page set. */
  readonly kept: KeptSettings;
  /** Reads the live file again now. Returns the report lines. */
  readLive(): string[];
  /** The setting values a loaded save's timers were computed under. Null for a new world. */
  readonly loadedUnder: Record<string, number> | null;
  readonly projectiles: Projectiles;
  /** Smoke and gas where grenades went off (W5). */
  readonly clouds: Clouds;
  readonly progression: Progression;
  /** Null for a world whose map has no resource nodes. */
  readonly harvest: Harvest | null;
  readonly deadlines: DeadlineHeap;
  readonly persistence: Persistence | null;
  readonly loaded: LoadReport | null;
  readonly console: Console;
  /** Carries events to modules. */
  readonly bus: Bus;
  readonly modules: Modules;
  readonly adminPassword: string | null;
  readonly dev: boolean;
  /** `id` is a content id. Returns the entity index, or -1. */
  spawnCreature(id: string, x: number, z: number, level: number, why?: string): number;
  /** Creates a normal vehicle record/entity; ownerTeam is legal title, separate from its driver. */
  spawnVehicle(id: string, x: number, z: number, ownerTeam?: number, yaw?: number, start?: VehicleStart): number;
  /** Recomputes a body's vitals' maxima, movement modifiers, level and gear. Call it after changing its stat points or what it carries. */
  refreshBody(rec: EntityRecord): void;
  /** Run a console line as the operator, or as `client`. Returns what it printed. */
  exec(line: string, client?: Client): string;
  /** Call between ticks, when there is time to spare. Does work that would otherwise stop a tick: the database checkpoint. */
  idle(): void;
  /** Commit and close the store. */
  shutdown(): void;
  /**
   * Says the server stops in `seconds`, to every session and to whoever joins meanwhile, and stops it then by
   * `onStop`. Returns "" if the stop is set, or why not. A stop already set is set again at the new time.
   */
  stopIn(seconds: number): string;
  /** Takes back a stop that was said. Returns whether there was one. */
  stopCancel(): boolean;
  /** Seconds until the stop that was said, or -1. */
  readonly stopLeft: number;
  /** Stops the process the host runs in, once it has said "go" to its pages. Whoever starts the server gives it. */
  onStop: (() => void) | null;
}

/** One minute, in ticks. */
const DECAY_SAVE_TICKS = 1800;
/** How long commits have failed, in ticks, before sessions are told and before logins are refused. */
const UNSAVED_TELL_TICKS = 10 * TICK_RATE;
const UNSAVED_REFUSE_TICKS = 60 * TICK_RATE;

/** The registry a server with these rules runs on. A world built before its host must be built from this. */
export function contentFor(content: Registry, rules: Rules): Registry {
  return deriveRegistry(content, tuningOf(rules, new Lists(rules, content), content).tuning);
}

/** A host that fails to start lets go of its save, so the next try can open it. */

/** Seconds a survivor knocked off their feet has no hold on where they go, where it cannot fall as a ragdoll. */
const KNOCKDOWN_SECONDS = 1.2;
/** Seconds a survivor getting up from a fall is held still. */
const GET_UP_SECONDS = 0.5;
/** A car door's blow: so much and so much a metre a second the car goes, at most so much. */
const DOOR_HARM_BASE = 8;
const DOOR_HARM_PER = 1.5;
const DOOR_HARM_MOST = 50;
export function createHost(content: Registry, opts: HostOptions = {}): Host {
  const opened: { close(): void }[] = [];
  try {
    return makeHost(content, opts, opened);
  } catch (err) {
    for (const store of opened) {
      try {
        store.close();
      } catch {
        // The error that stopped the start is the one to report.
      }
    }
    throw err;
  }
}

const SERVER_START = event("server.start");
const SERVER_TICK = event("server.tick");
const SERVER_SECOND = event("server.second");
const SERVER_SAVE = event("server.save");
const SERVER_SAVE_FAILED = event("server.saveFailed");
const SERVER_SAVED = event("server.saved");
const SERVER_STOP = event("server.stop");
const SERVER_SETTINGS = event("server.settings");
const SESSION_JOIN = event("session.join");
const SESSION_PRESENCE = event("session.presence");
const SESSION_LEAVE = event("session.leave");
const SESSION_SPAWN = event("session.spawn");
const DEATH = event("death");
const BODY_OUT = event("body.out");

/**
 * The folder a server of cluster `id` shares with the others: ARK's -ClusterDirOverride, or where it is not given, `clusters`
 * beside the save, as ARK's servers of one installation share its Saved/clusters. Both hold a folder for each cluster id.
 */
export function clusterRoot(rules: Rules, dbPath: string, id: string): string {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id) || id.startsWith(".")) throw new Error(`-clusterid=${id}: a cluster id is 1 to 64 letters, digits, dots, dashes and underscores`);
  const over = rules.flag("ClusterDirOverride");
  return join(typeof over === "string" && over !== "" ? resolve(over) : join(dirname(resolve(dbPath)), "clusters"), id);
}

/** A file's bytes as a plain array: a Buffer's slice is a view, which would keep the whole file with what is copied out of it. */
function fileBytes(path: string): Uint8Array {
  const b = readFileSync(path);
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

function makeHost(core: Registry, opts: HostOptions, opened: { close(): void }[]): Host {
  // A map's landmarks bring their own definitions, compiled after the core's.
  const given = opts.world || !opts.map ? null : parseMap(typeof opts.map === "string" ? fileBytes(opts.map) : opts.map);
  const content = withContent(core, given?.content?.defs ?? []);
  // The config files are the truth at every start (D88). No rule is read from the save.
  const rules = opts.config ?? new Rules();
  // The admin page's values are laid over them, from their own file beside the save.
  const kept = new KeptSettings(opts.dbPath ? `${opts.dbPath}.settings.json` : null, rules);
  const keptSaid = kept.load();
  kept.check = () => (contentNow().reg === null ? `gives content that does not compile: ${contentNow().fault}` : "");
  const lists = new Lists(rules, content);
  // Settings that change content are applied to the definitions once, before anything reads them (D90). From here on `reg` is the only registry.
  const tuned = tuningOf(rules, lists, content);
  lists.warm();
  const derived = deriveRegistry(content, tuned.tuning);
  if (opts.world && opts.world.reg.hash !== derived.hash) throw new Error("a world made before its host must be made of the content the host's settings give: contentFor(content, rules)");
  // The registry in force. A setting that changes content replaces it while the server runs (recontent, below).
  let reg = opts.world ? opts.world.reg : derived;
  const storeOptions = { ...opts.store, allowNetworkDisk: opts.store?.allowNetworkDisk ?? rules.flag("AllowNetworkSave") === true };
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, storeOptions) : null;
  if (store) opened.push(store);
  const mapFile = opts.world || typeof opts.map === "string" ? null : (opts.map ?? provingFile(reg));
  const parsed = given ?? (mapFile ? parseMap(mapFile) : null);
  if (parsed) opts.onMapLoaded?.(parsed);
  // Every world starts from the map's statics. A save's chunks are laid over them (Persistence.load).
  const world = opts.world ?? createMapWorld(reg, parsed!, { entityMax: opts.entityMax ?? rules.num("MaxEntities"), entityStart: opts.entityStart });
  world.clock.cycle = rules.num("DayCycleSpeedScale");
  world.clock.day = rules.num("DayTimeSpeedScale");
  world.clock.night = rules.num("NightTimeSpeedScale");
  // A new world starts at nine in the morning.
  world.dayOffset = offsetForHour(world.tick, 9, world.clock);
  if (opts.clips) world.anim = new HumanAnim(opts.clips);
  if (opts.clips && opts.rigs) world.rigs = buildRigs(opts.rigs, opts.clips);
  world.anims = creatureAnims(reg, (d) => world.rigs.get(d.mesh));
  let settingsAt: { dirty: boolean; version: number } | null = null;
  let settingsToldAt = -1;
  // A server of a cluster takes its world id there, and the save keeps it: its records are numbered under it for good.
  const clusterFlag = rules.flag("clusterid");
  const clusterId = typeof clusterFlag === "string" ? clusterFlag : "";
  if (clusterId !== "" && !store) throw new Error(`-clusterid=${clusterId}: a server of a cluster needs a save, so give it --db`);
  const cluster = store && clusterId !== "" ? Cluster.open(clusterRoot(rules, store.path, clusterId), clusterId, store) : null;
  if (cluster) opened.push({ close: () => cluster.stop() });
  // Alone, it would let a name be taken whose survivor is away, and never see it come back.
  const member = store?.meta("cluster") ?? null;
  if (!cluster && member !== null) throw new Error(`this save is in the cluster ${member}: start it with -clusterid=${member} and the folder it used, so that what left it can come back`);
  const records = new Records(opts.worldId ?? cluster?.world ?? (store && !store.fresh ? Number(store.meta("world_id") ?? 1) : 1));
  const activity = new SurvivorActivity(records);
  const say = opts.log ?? ((line: string) => console.log(line));
  for (const line of keptSaid) say(line);
  // Carries events to modules. Made before the systems, so that each can raise its own.
  const bus = new Bus();
  bus.log = say;
  if (opts.now) bus.now = opts.now;
  // The physics lane is timed by the same clock: without one, nothing gives way to physics (server/lane.ts).
  const seats = rules.flag("WinLiveMaxPlayers");
  const game = new GameServer(world, {
    password: rules.text("ServerPassword"),
    motdSeconds: rules.num("Duration"),
    viewCap: rules.num("ViewCap"),
    snapshotBytesMax: rules.num("SnapshotBytesMax"),
    pendingPerAddress: rules.num("PendingPerAddress"),
    ...opts.game,
    maxClients: opts.game?.maxClients ?? (typeof seats === "string" && seats !== "" ? Number(seats) : rules.num("MaxPlayers")),
  });
  if (opts.now) game.lane.setClock(opts.now);
  game.bus = bus;
  // A full world still has a place for every survivor that may join.
  world.ents.reserve = game.clients.length;
  /** Survivors made since they were last told of: a module hears of each once, as new. */
  const made = new Set<number>();
  const joined = (c: Client): void => {
    if (c.joined) return;
    c.joined = true;
    activity.login(c.pid);
    survivorLog.enter(c);
    bus.after(SESSION_JOIN, { pid: c.pid, name: c.name, isNew: made.delete(c.pid) });
  };
  let started = false;
  /** Creates the entity store had refused when the log last said so, and the tick from which it may say so again. */
  let refusedTold = 0;
  let refusedNext = 0;
  const persistence = store ? new Persistence(world, records, store) : null;
  const loaded = persistence ? persistence.load() : null;
  const commitEvery = opts.commitEvery ?? 6;
  const survivor = reg.index.get("core:survivor")!;
  const survivorMove = reg.move[survivor]!;
  const names = new Map<string, number>();
  // One heap for every deadline. A system asks it for a kind of its own, and is given the entries of that kind as they come due.
  const deadlines = new DeadlineHeap();
  const survival = new Survival(world, records, deadlines);
  survival.rules = rules;
  survival.bus = bus;
  const items = new Items(world, records);
  items.bus = bus;
  // Inventory transactions finish before their derived movement and equipment state is refreshed.
  const inventoryChanged = new Set<EntityRecord>();
  items.onChange = (rec) => {
    if (reg.defs[rec.kind]?.type === "species") inventoryChanged.add(rec);
  };
  if (persistence) {
    // The ledger is written once something is minted, so a save without one has minted nothing.
    items.restore(loaded!.fresh ? "{}" : ((persistence.store.meta("ledger") as string | null) ?? "{}"));
    const dropped = persistence.store.dropped;
    if (dropped.count.size > 0) {
      // What went with the content an operator chose to go on without leaves the ledger too.
      for (const [item, n] of dropped.burn) items.burned[item] = items.burned[item]! + n;
      items.dirty = true;
      say(`left out, as --allow-missing-content asked, and gone from the save at its next commit: ${[...dropped.count].map(([id, n]) => `${n} of ${id}`).join(", ")}`);
      if (dropped.burn.size > 0) say(`what they held went with them: ${[...dropped.burn].map(([item, n]) => `${n} of ${reg.ids[item]}`).join(", ")}`);
    }
    const wrong = items.audit();
    if (wrong.length > 0 && !opts.allowLedgerMismatch) throw new Error("the item ledger does not balance:\n" + wrong.join("\n"));
    persistence.sidecar("ledger", items);
    if (!loaded!.fresh) game.sessions.refusals.restore(persistence.store.meta("refused") as string | null);
    persistence.sidecar("refused", game.sessions.refusals);
    persistence.open = (path) => new WorldStore(path, reg, storeOptions);
  }
  const creatures = new Creatures(world, game, records, survival, opts.seed ?? 1, opts.wakeRadius ?? 3);
  const creatureTraits = new CreatureTraits({ world, records, refresh: rec => refreshBody(rec), healthChanged: rec => survival.init(rec) });
  survival.healthMultiplier = rec => creatureTraits.healthOf(rec);
  creatures.bus = bus;
  creatures.swimGain = rules.num("OxygenSwimSpeedStatMultiplier");
  /** The chunk each session's focus keeps awake. */
  const focus = new Map<number, number>();
  const recordOf = (name: string) => {
    const pid = persistence ? persistence.survivors.get(name) : names.get(name);
    return pid === undefined ? undefined : records.byPid.get(pid);
  };

  const spawnCreature = (id: string, x: number, z: number, level: number, why = "wild"): number => {
    const kind = reg.index.get(id);
    const e = kind === undefined ? -1 : creatures.spawn(kind, x, z, level, why);
    if (e >= 0 && reg.vehicle[kind!]) urban.register(e);
    if (e >= 0 && persistence) persistence.attach(records.byPid.get(world.ents.pid[e]!)!, e);
    return e;
  };
  const parkingSolids = new StaticVehicleSolids(world);
  const parkVehicle = (id: string, x: number, z: number, ownerTeam: number, yaw: number, why: string, start: VehicleStart = {}): number => {
    const kind = reg.index.get(id);
    if (kind === undefined || !reg.vehicle[kind] || !Number.isSafeInteger(ownerTeam) || ownerTeam < 0 || !Number.isFinite(yaw)) return -1;
    const def = reg.vehicle[kind]!;
    const y = start.y ?? (isBoatVehicle(def) ? boatRestY(def.spec, world.hf.waterAt(x, z)) : groundUnder(world.hf, x, z, def.spec.halfWidth));
    if (!Number.isFinite(y) || [start.hull, start.engine, start.rotor, start.fuel].some(n => n !== undefined && (!Number.isFinite(n) || n < 0 || n > 1))) return -1;
    if ((isRotorVehicle(def) || isBoatVehicle(def)) && !vehiclePlaceFree(world, x, y, z, yaw, def)) return -1;
    const e = creatures.spawn(kind, x, z, 1, why, y);
    if (e < 0) return e;
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    if (isSkateboard(def)) rec.name = "Street skateboard";
    rec.team = ownerTeam; rec.yaw = Math.round(yaw / (2 * Math.PI) * 65536) & 65535;
    world.ents.yaw[e] = rec.yaw;
    // Registered once turned, so the parked state it saves at once has its yaw.
    urban.register(e);
    const ents = world.ents, v = ents.vrow[e]!;
    ents.vehicleYaw[v] = Math.fround(yaw);
    ents.vehicleQy[v] = Math.fround(Math.sin(yaw / 2)); ents.vehicleQw[v] = Math.fround(Math.cos(yaw / 2));
    if (isWheelVehicle(def) && start.y === undefined) {
      // Fit the ground under the authored axles. The chassis origin can be off-centre between them.
      const sn = Math.sin(yaw), cs = Math.cos(yaw);
      const height = (side: number, along: number) => world.hf.heightAt(x + cs * side + sn * along, z - sn * side + cs * along);
      const spec = def.spec, axles = spec.axles ?? [{ z: spec.wheelbase / 2, track: spec.track }, { z: -spec.wheelbase / 2, track: spec.track }];
      const tyres = axles.map(a => ({ ...a, left: height(-a.track / 2, a.z), right: height(a.track / 2, a.z) }));
      const front = tyres[0]!, rear = tyres.at(-1)!;
      const along = (front.left + front.right - rear.left - rear.right) / (2 * (front.z - rear.z));
      const cross = tyres.reduce((sum, a) => sum + (a.right - a.left) / a.track, 0) / tyres.length;
      const placedY = (front.left + front.right) / 2 - front.z * along;
      const normal = 1 / Math.hypot(cross, along, 1), travel = spec.suspensionTravel ?? .18;
      const onPlane = tyres.every(a => {
        const centre = placedY + a.z * along, rise = cross * a.track / 2;
        return Math.max(Math.abs(a.left - centre + rise), Math.abs(a.right - centre - rise)) * 4 < travel;
      });
      if (normal < 1 && normal >= spec.minGroundNormal && onPlane && Math.abs(placedY - y) < travel) {
        const roll = Math.atan(cross), pitch = Math.asin(along * normal);
        const q = new Float64Array(4);
        vehicleRotation({ x, y, z, yaw, pitch, roll }, q);
        const frame = { x, y: placedY, z, qx: q[0]!, qy: q[1]!, qz: q[2]!, qw: q[3]! };
        if (!parkingSolids.blocked(frame, frame, carShapes(def.spec), undefined, false, 0)) {
          ents.vehicleQx[v] = frame.qx; ents.vehicleQy[v] = frame.qy; ents.vehicleQz[v] = frame.qz; ents.vehicleQw[v] = frame.qw;
          ents.vehiclePitch[v] = pitch; ents.vehicleRoll[v] = roll;
          ents.setPosition(e, x, placedY, z);
        }
      }
    }
    ents.fuel[v] = Math.fround((start.fuel ?? 1) * def.spec.fuelCapacity);
    ents.vehicleEngineCondition[v] = start.engine ?? 1; ents.vehicleRotorCondition[v] = start.rotor ?? 1;
    ents.vehicleHullCondition[v] = Math.max(.01, start.hull ?? 1); ents.vehicleFlooding[v] = 0;
    if (start.origin) rec.extra.set(VEHICLE_ORIGIN, new TextEncoder().encode(start.origin));
    if (persistence) persistence.attach(rec, e);
    records.dirty.add(rec.pid);
    items.inv(rec);
    refreshBody(rec);
    if (start.hull !== undefined && rec.vitals) survival.add(rec, V_HEALTH, -(1 - Math.max(.01, start.hull)) * rec.vitals.max[V_HEALTH]! / 1e6);
    urban.initialized(e);
    return e;
  };
  const spawnVehicle = (id: string, x: number, z: number, ownerTeam = 0, yaw = 0, start: VehicleStart = {}): number => parkVehicle(id, x, z, ownerTeam, yaw, "admin", start);
  const containers = new Containers({ world, game, records, items });
  const death = new Death({ world, game, records, items, survival, creatures, persistence, deadlines, rules, bus, containers });
  containers.emptied = (box) => death.remove(box);
  const progression = new Progression(world, records, items, deadlines);
  progression.rules = rules;
  progression.bus = bus;
  const harvest = world.nodeField ? new Harvest(world, game, records, items, progression, deadlines, (opts.seed ?? 1) + 31) : null;
  if (harvest) {
    harvest.rules = rules;
    harvest.lists = lists;
  }
  const buffs = new Buffs(world, records, survival, deadlines);
  const spawns = spawnTables(reg, rules, lists);
  // No spawn region here is forced, streamed, put by hand or in water, so each -NoDinosExcept flag is -NoDinos.
  const quiet = (): boolean => ["NoDinos", "NoDinosExceptForcedSpawn", "NoDinosExceptStreamingSpawn", "NoDinosExceptManualSpawn", "NoDinosExceptWaterSpawn"].some((f) => rules.flag(f) === true);
  const stocked = opts.wild ? new Spawner({ world, game, records, creatures, items, survival, buffs, persistence, rules, deadlines, tables: spawns.tables }, (opts.seed ?? 1) + 101) : null;
  const spawner = stocked && stocked.regions.length > 0 ? stocked : null;
  // A flag may be set and taken away while the server runs, so the spawner is there either way and is told.
  if (spawner) spawner.quiet = quiet();
  // The save keeps the setting values its timers were computed under, so they can be re-timed under other rules.
  const loadedUnder = persistence && !loaded!.fresh ? timersOf(persistence.store.meta("settings_at")) : null;
  if (persistence) {
    const at = { dirty: true, version: rules.version, serialize: () => JSON.stringify({ timers: rules.timers() }) };
    persistence.sidecar("settings_at", at);
    settingsAt = at;
  }
  const combat = new Combat({ world, game, records, items, survival, progression, creatures, buffs, rules, lists, harvest, bus, rigs: opts.rigs }, (opts.seed ?? 1) + 53);
  containers.eye = (e, out) => { combat.eye(e, out); };
  creatures.onStrike = (e) => combat.bite(e);
  const tribes = new Tribes(world, records);
  tribes.rules = rules;
  tribes.bus = bus;
  if (persistence && !loaded!.fresh) tribes.restore(persistence.store.meta("tribes"));
  const survivorLog = new SurvivorLog({ world, records, tribes, rules, persistence, opAdmin: OP_ADMIN, opDeath: OP_DEATH, causes: CAUSE_WORDS, say }, opts.survivorLog);
  opened.push({ close: () => survivorLog.stop() });
  // What the cluster's folder says came and went that the save does not know is done again now, before anything resumes.
  cluster?.start(
    {
      get reg() {
        return reg;
      },
      world,
      records,
      items,
      persistence: persistence!,
      rules,
      tribes,
      game,
      bus,
      mayLeave: (c, rec) => (rec.out ? "you are unconscious" : riding.riding(c) ? "get off your mount first: it stays here" : urban.riding(c) ? "get out of the vehicle first: it stays here" : carry.holding(c) >= 0 ? "put down what is in your arms first" : ""),
      suspend: (rec, off) => { if (off) activity.checkpoint(rec.pid); survival.suspend(rec, off); },
      adopt: (rec) => {
        survival.restore(rec, false);
        progression.resume(rec);
        buffs.restore(rec, false);
      },
      forget: (rec) => {
        buffs.died(rec);
        survival.forget(rec.pid);
        inHand.delete(rec.pid);
      },
      say,
    },
    loaded!.fresh,
  );
  const taming = new Taming({ world, game, records, items, survival, buffs, rules, lists, tribes, deadlines, creatures, progression, onNotice: (pid, text) => notice(pid, text), openOf: (c) => containers.openOf(c), refresh: (rec) => refreshBody(rec), onTamed: (rec) => {
    const e = records.entOf.get(rec.pid);
    spawner?.left(rec);
    // A new tame stays where it woke until ordered otherwise.
    if (e !== undefined) {
      creatures.mind.stay(e, 0xffffffff);
      creatures.claimed(e);
    }
  } }, (opts.seed ?? 1) + 71);
  // Closing a creature reschedules its meal, because its food may have changed.
  containers.onShut.on((rec) => taming.meal(rec));
  // A hit's buff goes through entangling, which reads the bola's fields (weapons-plan.md, M6); a bola'd body is not mounted.
  const entangle = new Entangle({ world, game, records, buffs });
  combat.entangle = (victim, buff, by) => void entangle.give(victim, buff, by);
  const riding = new Riding({ world, game, records, tribes, rigs: opts.rigs, refresh: (rec) => refreshBody(rec), tangled: (rec) => entangle.tangled(rec) });
  // A saddle stays on while anyone sits on it, steering or not.
  taming.ridden = (e) => riding.occupied(e);
  // An unowned car is anyone's to take, and a tribe's own cars are its members'. On PvP another tribe's car
  // can be stolen; on PvE its owner can reclaim it from someone who no longer has access,
  // while an authorized survivor in an unowned car keeps their seat.
  const urbanMay = (me: EntityRecord, car: EntityRecord, victim: EntityRecord | null): boolean => {
    if (!rules.on("serverPVE")) return true;
    if (car.team !== 0 && !tribes.may(me, car.team)) return false;
    const kind = reg.defs[victim?.kind ?? -1];
    if (victim && car.team !== 0 && !tribes.may(victim, car.team)) return true;
    return !victim || kind?.type !== "species" || kind.class !== "survivor" || tribes.may(me, victim.team);
  };
  const trees = harvest ? new VehicleTrees(world, harvest) : null;
  if (trees) game.players.vehicleStep = trees.step;
  const urban = new Urban({ world, game, records, items, creatures, vehicleStep: game.players.vehicleStep, rigs: opts.rigs ?? [], refresh: (rec) => refreshBody(rec), may: urbanMay, tangled: rec => entangle.tangled(rec), damage: (rec, points, by) => survival.hurt(rec, points, by), collisionDamage: (rec, points, by) => combat.vehicleHurt(rec, points, by),
    mayDisplaceRider: (by, vehicle, rider) => combat.vehicleDisplaces(by, vehicle, rider),
  });
  const vehicles = new VehicleService({ world, game, records, items, survival, urban,
    may: (actor, vehicle) => urbanMay(actor, vehicle, null),
    spawn: (kind, x, z, team, yaw, start) => parkVehicle(kind, x, z, team, yaw, "crafted", start),
    discard: e => { const pid = world.ents.pid[e]!; persistence?.detach(pid); creatures.remove(e); survival.forget(pid); records.delete(pid); },
  });
  // Its tribe may open a tamed creature while it is awake, and whoever may use a vehicle may open it.
  containers.canOpen.on((c, rec) => {
    const actor = records.byPid.get(c.pid);
    return !!actor && (reg.vehicle[rec.kind] ? urbanMay(actor, rec, null) : rec.team !== 0 && tribes.may(actor, rec.team));
  });
  containers.keepsBoatCargo = (c, e) => vehicles.keepsBoatCargo(c, e);
  game.players.onVehicleStep.on(e => urban.impact(e));
  survival.onRated.on((rec) => { if (reg.vehicle[rec.kind]) urban.rated(rec.pid); });
  game.players.feet.boarding = (actor, vehicle) => urban.boarding(actor, vehicle);
  urban.contacts = new VehicleContacts({
    world, records, combat, driverOf: e => urban.riderOf(e), pair: pair => urban.collisionPair(pair),
    // A car that strikes a survivor hard knocks them off their feet (Knockdowns), as a door does.
    struck: (body) => knockDown(body),
    parkingBrake: e => urban.parkingBrake(e),
    resting: e => urban.resting(e),
    asleep: e => urban.asleep(e),
    boarding: (actor, vehicle) => urban.boarding(actor, vehicle),
    anchored: (e, opposing) => {
      const vehicle = records.byPid.get(world.ents.pid[e]!);
      return !!vehicle && vehicle.team !== 0 && vehicle.team !== opposing.team &&
        rules.on("serverPVE") && opposing.team !== 0 && urban.parked(e);
    },
  });
  // The use button gets off a mount, and sets down what is in the arms.
  containers.riding = (c) => impale.held(c.pid) || urban.riding(c) || riding.riding(c) || carry.holding(c) >= 0;
  containers.offMount = (c) => (impale.held(c.pid) ? undefined : urban.riding(c) ? urban.dismount(c, true) : riding.riding(c) ? riding.dismount(c) : void carry.drop(c));
  const breeding = new Breeding({ world, game, records, rules, lists, deadlines, creatures, persistence, full: (team) => taming.full(team), notice: (pid, text) => notice(pid, text), place: (rec) => death.place(rec), refresh: (rec) => refreshBody(rec), meal: (rec) => taming.meal(rec) }, (opts.seed ?? 1) + 89);
  taming.onMate = (rec, what) => breeding.order(rec, what);
  const corpses = new Corpses({ world, game, records, items, deadlines, rules, lists, progression, death, containers }, (opts.seed ?? 1) + 103);
  death.corpses = containers.corpses = combat.corpses = corpses;
  const carry = new Carry({ world, game, records, items, survival, creatures, tribes, refresh: (rec) => refreshBody(rec) });
  const emotes = new Emotes({ world, game });
  const eggs = new Eggs({ world, game, records, items, rules, deadlines, creatures, breeding, place: (rec) => death.place(rec) });
  const balls = new Balls({
    world, game, records, items, rules, creatures, survival, buffs, taming, breeding, tribes, riding, carry, death, containers,
    detach: (rec, e) => {
      const ents = world.ents;
      rec.x = ents.x[e]!;
      rec.y = ents.y[e]!;
      rec.z = ents.z[e]!;
      rec.yaw = ents.yaw[e]!;
      rec.creatureMode = ents.creatureMode[e]!;
      persistence?.detach(rec.pid);
    },
    attach: (rec, e) => {
      persistence?.attach(rec, e);
      // What its body's load makes of it is worked out at the next tick, as it is for every body a load brings back.
      inventoryChanged.add(rec);
    },
    release: (rec) => {
      impale.release(rec.pid);
      carry.release(rec.pid);
      creatureTraits.remove(rec);
    },
    refresh: (rec) => refreshBody(rec),
    notice: (pid, text) => notice(pid, text),
    tell: (team, text) => {
      for (const c of game.clients) if (c?.active && !c.closed && records.byPid.get(c.pid)?.team === team) game.sendText(c, TEXT_NOTICE, text);
    },
  });
  // What a slot stood for goes with its item: an egg's young (server/eggs.ts), or a soul ball's tame.
  items.onRefGone.on((ref) => balls.gone(ref));
  combat.onBall.on((c, rec, slot) => balls.click(c, rec, slot));
  const feces = new Feces({ world, records, items, deadlines, rules, eggs, woke: creatures.onWake, place: (rec) => death.place(rec) }, (opts.seed ?? 1) + 107);
  const roars = new MountedRoars({ world, records, creatures, feces });
  game.players.onMountSecondary.on(e => roars.use(e));
  const overhead = new Overhead({ world, records, breeding, game, survival, tribes });
  // A sight's cone widens its session's view and holds what it is on awake (server/gaze.ts, D1079).
  // A look through a sight tells what it is on as far as the sight's gaze reaches (D1082).
  overhead.reach = (c) => gaze.lookReach(c);
  const gaze = new Gaze({ world, records, items, game, spot: (team, e, until) => tactical.spot(team, e, until), wake: (chunk, delta) => {
    creatures.watch(chunk, delta, woke);
    if (woke.length > 0) settled.bodies += settle(world, woke, relocated);
    woke.length = 0;
  } });
  const hurt = new Hurt({ world, records, survival, deadlines });
  creatures.onAdopt.on((_e, rec) => hurt.follow(rec));
  taming.bred = (rec) => breeding.subject(rec);
  containers.onRide = (c, e) => {
    if (impale.held(c.pid) || world.ents.seatSlot[e] === IMPALE_SLOT) return RESULT_BUSY;
    if (carry.holding(c) < 0) {
      const vehicle = urban.mount(c, e);
      if (vehicle >= 0) return vehicle;
    }
    // Using whoever sits on a creature is using the creature, as using a car's occupant is using the car.
    const on = world.ents.seat[e]! - 1;
    if (on >= 0 && world.ents.seatSlot[e] !== 0 && world.ents.gen[on] === world.ents.seatGen[e] && (world.ents.flags[on]! & F_ALIVE) !== 0) e = on;
    const rec = records.byPid.get(world.ents.pid[e]!);
    // The use button claims an unclaimed young creature.
    if (rec && breeding.unclaimed(rec)) return breeding.claim(c, rec);
    // Nobody rides, takes or opens what is in someone's arms. A small creature of the session's tribe is picked up.
    if (carry.held(e)) return RESULT_BUSY;
    const taken = carry.use(c, e);
    if (taken >= 0) return taken;
    // Only a saddled, grown, awake creature of the session's tribe can be ridden. -1 passes the press on.
    if (rules.on("bDisableDinoRiding")) return -1;
    if (!rec || rec.keyHash !== null || rec.saddle === 0 || rec.out || rec.grown !== 0 || !tribes.may(records.byPid.get(c.pid), rec.team)) return -1;
    return riding.mount(c, e);
  };
  // A held creature's peck spares its carrier and is credited to it, as a mount's bite is to its rider.
  combat.riderOf = (mount) => {
    const e = records.entOf.get(mount.pid);
    return e === undefined ? null : (urban.riderOf(e) ?? riding.riderOf(e) ?? carry.carrierOf(e));
  };
  if (harvest) harvest.riderOf = combat.riderOf;
  combat.damageModifier = rec => creatureTraits.damageOf(rec);
  combat.resistanceModifier = rec => creatureTraits.takenOf(rec);
  const impale = new CreatureImpale({ world, records, survival,
    hostile: (by, victim) => combat.creatureHostile(by, victim),
    refresh: rec => refreshBody(rec),
    forceDismount: victim => {
      const e = records.entOf.get(victim.pid);
      if (e === undefined) return false;
      const host = world.ents.seat[e]! - 1;
      if (host < 0) return true;
      if (world.ents.gen[host] !== world.ents.seatGen[e] || reg.vehicle[world.ents.kind[host]!] || reg.combat[world.ents.kind[host]!] ?.protectsRider) return false;
      riding.standDown(victim.pid);
      return world.ents.seat[e] === 0;
    },
    damage: (by, victim, attack, mode, points) => {
      const e = records.entOf.get(victim.pid);
      if (e !== undefined) combat.creatureContact(by, e, attack, mode, [world.ents.x[e]!, world.ents.y[e]! + reg.bodyHeight[victim.kind]! * .5, world.ents.z[e]!], ZONE_TORSO, 1, true, points);
    },
  });
  combat.onCreatureHit.on((by, target, attack, mode) => {
    const victim = records.byPid.get(world.ents.pid[target]!);
    const slow = mode?.slow ?? attack.slow;
    if (victim && slow) creatureTraits.applySlow(victim, slow.multiplier, slow.seconds);
    if (attack.impale && impale.tryStart(by, target, attack)) return;
    const e = records.entOf.get(by.pid), impulse = attack.knockback ?? 0;
    if (e !== undefined && impulse > 0 && world.ents.seat[target] === 0) {
      const ents = world.ents, dx = ents.x[target]! - ents.x[e]!, dz = ents.z[target]! - ents.z[e]!, distance = Math.hypot(dx, dz);
      const force = impulse * Math.min(1, (reg.drag[by.kind]! || 50) / Math.max(1, reg.drag[ents.kind[target]!]! || 50));
      if (distance > .001) { ents.vx[target] = Math.fround(ents.vx[target]! + dx / distance * force); ents.vz[target] = Math.fround(ents.vz[target]! + dz / distance * force); }
    }
  });
  const creatureContacts = new CreatureContacts({ world, records, harvest,
    test: (target, from, to, radius) => combat.creatureTest(target, from, to, radius),
    hit: (by, target, attack, mode, point, zone, power) => combat.creatureContact(by, target, attack, mode, point, zone, power),
    structure: (by, ref, attack, mode, point, power) => combat.creatureStructure(by, ref, attack, mode, point, power),
  });
  combat.onHarm.on((victim, points) => taming.harmed(victim, points));
  combat.onHarm.on((victim, points) => hurt.harmed(victim, points));
  const chat = new Chat({ game, records, rules, tribes, bus });
  // Cast is always there, doing nothing while CastEnabled is off, so the admin page can turn it on live.
  const castHost = new CastHost({
    world, game, records, creatures, emotes, chat, items, urban, bus, refresh: (rec) => refreshBody(rec), seed: (opts.seed ?? 1) + 907,
    park: (id, x, z, yaw) => parkVehicle(id, x, z, 0, yaw, "cast"),
    places: (parsed?.content?.landmarks ?? []).map((l) => ({ name: l.name, kind: "landmark", x: l.x, z: l.z })),
    rules,
    ...(typeof opts.cast === "object" ? { settings: { enabled: true, ...opts.cast } } : opts.cast === true ? { settings: { enabled: true } } : {}),
    logDir: opts.dbPath ? join(dirname(resolve(opts.dbPath)), "cast") : null,
  });
  const fixtures = new Fixtures(world, records, items);
  fixtures.rules = rules;
  fixtures.index();
  const motion = new Motion(world, records, fixtures, game);
  const stations = new Stations(world, records, items, fixtures, deadlines);
  // A powered station (the fabricator) makes things only while it burns; why it refuses is told as a notice.
  wirePower(world, stations, progression);
  progression.onNotice = (pid, text) => notice(pid, text);
  // A preserving bin keeps food longer only while lit: its clocks are rescaled at the tick it swaps.
  wirePreserve(stations, items);
  // A death refills the survivor. One that arrives or travels comes as it left.
  function rise(c: Client, p: Place, why: number): number {
    const at = Number.isNaN(p.y) ? undefined : p.y;
    if (why === CHOOSE_DIED) return death.respawn(c, p.x, p.z, p.yaw, at);
    if (why === CHOOSE_ARRIVED && cluster) return cluster.rise(c, p.x, p.z, p.yaw, at);
    const rec = records.byPid.get(c.pid);
    if (!rec) return RESULT_INVALID;
    rec.dead = false;
    if (!game.sessions.revive(c, p.x, p.z, p.yaw, at)) {
      rec.dead = true;
      return RESULT_INVALID;
    }
    records.dirty.add(rec.pid);
    return RESULT_OK;
  }
  const beds = new Beds({
    world, game, records, tribes, fixtures, rules, bus,
    rise,
    mayLeave: (c, rec) => (rec.out ? "you are unconscious" : riding.riding(c) ? "get off your mount first" : urban.riding(c) ? "get out of the vehicle first" : carry.holding(c) >= 0 ? "put down what is in your arms first" : ""),
    drop: (rec, x, y, z) => void death.dropAll(rec, x, y, z),
  });
  if (persistence && !loaded!.fresh) beds.restore(persistence.store.meta("beds"));
  persistence?.sidecar("beds", beds.saved);
  const build = new Build({ world, game, records, items, tribes, rules, fixtures, bus, motion: (ref) => motion.throw(ref), light: (ref) => stations.toggle(ref), bed: (c, ref, action, name) => beds.act(c, ref, action, name), spill: (x, y, z, name, owner) => death.spill(x, y, z, name, owner) });
  build.onPlaced = (by, ref) => beds.placed(by, ref);
  containers.onUseBuilt = (c, ref) => build.use(c, ref);
  containers.keepsBuilt = (c, ref) => build.keeps(c, ref);
  if (persistence && !loaded!.fresh) build.decay.restore(persistence.store.meta("decay"));
  persistence?.sidecar("decay", build.decay, DECAY_SAVE_TICKS);
  combat.onStructureHurt.on((ref) => build.hurt(ref));
  const voice = new Voice({ game, muted: (listener, speaker) => chat.muted(listener.name, speaker.name), everywhere: () => rules.on("globalVoiceChat") }, (out) => void crypto.getRandomValues(out));
  /** Lingering bodies are not counted. */
  const sessionOf = (pid: number) => game.clients.find((c) => c?.active && !c.closed && c.pid === pid) ?? null;
  function notice(pid: number, text: string): void {
    const to = sessionOf(pid);
    if (to) game.sendText(to, TEXT_NOTICE, text);
  }
  const tribesSaved = { dirty: false, serialize: () => tribes.serialize() };
  persistence?.sidecar("tribes", tribesSaved);
  tribes.onSave = () => {
    tribesSaved.dirty = true;
  };
  tribes.onTeam = (rec) => refreshBody(rec);
  tribes.onNotice = (pid, text) => notice(pid, text);
  const projectiles = new Projectiles({ world, game, records, items, combat, bus }, (opts.seed ?? 1) + 97);
  const loose = new Loose({ world, game, records, items, combat, death });
  const falls = new Falls(world);
  game.players.isDown = (e) => falls.isDown(e);
  combat.downPose = (e, tick) => falls.poseAt(e, tick);
  corpses.handOff = (e) => falls.take(e);
  // A sight's zero lifts its flying rounds (D1083).
  projectiles.zero = (c) => gaze.zeroOf(c);
  // Every shot and blast, hit or miss, is heard by Cast's people near it.
  projectiles.heard.push((kind, x, z, by, silenced) => castHost.heard(kind, x, z, by, silenced));
  combat.onFire.on((c, rec, weapon, quality, ammo, draw) => projectiles.launch(c, rec, weapon, quality, ammo, draw));
  // A thrown thing with an ammo facet of its own flies and hits (the bola); any other is lobbed and goes off on its fuse.
  combat.onThrow.on((c, rec, item, quality, draw) => (reg.ammoSpeed[item]! > 0 ? projectiles.fling(c, rec, item, quality, draw) : projectiles.lob(c, rec, item, quality)));
  const clouds = new Clouds({ world, records, buffs, rules });
  projectiles.onCloud = (item, x, y, z, by) => clouds.make(item, x, y, z, by);
  // The killer is credited before death.die, which may delete the record.
  const dying = new Set<number>();
  survival.onDeath = (rec, cause, by, impact) => {
    // Removing the body touches its vitals again, and so does setting down what dies held. It must die only once.
    if (rec.dead || dying.has(rec.pid)) return;
    dying.add(rec.pid);
    try {
      died(rec, cause, by, impact);
    } finally {
      dying.delete(rec.pid);
    }
  };
  const died = (rec: EntityRecord, cause: number, by: number, impact?: CorpseImpact): void => {
    if (bus.n[DEATH] !== 0) {
      // The killer is whoever struck last, or gave the buff that did it. A kill by a ridden creature is credited to its rider.
      const killer = by !== 0 ? records.byPid.get(by) : undefined;
      const rider = killer ? (combat.riderOf?.(killer) ?? null) : null;
      const struck = combat.blow.victim === rec.pid;
      bus.after(DEATH, { victim: rec.pid, kind: reg.ids[rec.kind]!, cause: CAUSE_WORDS[cause] ?? "", killer: killer ? killer.pid : 0, rider: rider ? rider.pid : 0, credit: !killer ? 0 : killer.kind === survivor ? killer.pid : rider ? rider.pid : 0, team: rec.team, item: struck && combat.blow.item !== 0 ? reg.ids[combat.blow.item]! : "", far: struck ? combat.blow.far : 0 });
    }
    // What a carrier held is set down while its body is still there to set it down by, and what dies held is let go.
    impale.release(rec.pid);
    carry.release(rec.pid);
    combat.killed(rec, by);
    // A creature may eat of what its kill left it.
    const taker = by !== 0 ? records.byPid.get(by) : undefined;
    if (taker) taming.meal(taker);
    buffs.died(rec);
    spawner?.left(rec);
    if (reg.vehicle[rec.kind]?.movement === "boat") urban.releaseHost(rec.pid);
    corpses.fell(rec, cause, by, impact);
    if (rec.kind === survivor) beds.died(rec, by !== 0 ? (records.byPid.get(by)?.team ?? 0) : 0);
    death.die(rec, cause);
  };
  // Unconsciousness, an injury and any buff change how a body moves.
  const injured = reg.index.get("core:injured") ?? 0;
  const fed = reg.index.get("core:fed") ?? 0;
  const fedDef = reg.defs[fed];
  const fedRate = fedDef?.type === "buff" ? (fedDef.health ?? 0) : 0;
  survival.onOut = (rec, out) => {
    bus.after(BODY_OUT, { pid: rec.pid, out });
    if (out) impale.release(rec.pid);
    refreshBody(rec);
    taming.out(rec, out);
    const e = records.entOf.get(rec.pid);
    if (e !== undefined) creatures.knocked(e, out);
  };
  survival.onInjured = (rec, on) => void (on ? buffs.give(rec, injured) : buffs.take(rec, injured));
  buffs.onChange = (rec) => refreshBody(rec);
  const use = new Use({ world, game, records, items, survival, buffs });
  // E with nothing else to use picks a bush, else drinks the water the survivor stands in.
  containers.onUse.on((c) => void (harvest?.pick(c) || use.drink(c)));
  if (harvest) {
    if (persistence) {
      if (!loaded!.fresh) for (const row of persistence.store.loadBlobs(harvest.tag)) harvest.decode(row.chunk, row.data);
      persistence.blobs.push(harvest);
    }
  }
  const wakeRadius = opts.wakeRadius ?? 3;
  const woke: number[] = [];
  const settled = { bodies: 0 };
  const relocated = (e: number): void => creatures.relocated(e);
  /** A session's focus left `from` and entered `to`. Either may be -1 for none. */
  const moved = (from: number, to: number): void => {
    creatures.playerMoved(from, to, woke);
    if (harvest && wakeRadius >= 0) {
      if (to >= 0) harvest.retain(to, wakeRadius, 1);
      if (from >= 0) harvest.retain(from, wakeRadius, -1);
    }
    // Nodes load over the chunks that wake. A body a save or a changed map left inside a node or a piece there is set free.
    if (woke.length > 0) settled.bodies += settle(world, woke, relocated);
    woke.length = 0;
  };
  if (harvest) harvest.onGrown = (x, z, reach) => void (settled.bodies += settleNear(world, x, z, reach, relocated));
  /**
   * The setting values the world's timers and rates were computed under. A save's own until retime brings it to this server's.
   * A setting the save omits was at its default.
   */
  let under: Record<string, number> = loadedUnder ?? rules.timers();
  const wasAt = (name: string): number => under[name] ?? (rowOf(name)!.def as number);
  const RATES = CATALOG.filter((row) => row.retime === "rate").map((row) => row.name);
  /**
   * Re-times everything in progress from the values it was computed under to the server's current ones (D91). It runs once at a
   * load, for a save made under other settings, and whenever a live rule changes. Spoilage and fires are computed only when
   * read, so they are first settled by the table they ran under: at a load the save's, made again from its values, and
   * while running the registry that was in force until the change (`timed`).
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
    const spoilWas = wasAt("GlobalSpoilingTimeMultiplier");
    const fuelWas = wasAt("FuelConsumptionIntervalMultiplier");
    if (spoilWas !== now.GlobalSpoilingTimeMultiplier || fuelWas !== now.FuelConsumptionIntervalMultiplier) {
      const old = atLoad ? deriveRegistry(content, { ...tuning, spoil: spoilWas, fuel: fuelWas }) : timed;
      items.table = old;
      stations.refuel(old, fuelWas, now.FuelConsumptionIntervalMultiplier!);
      items.respoil(old, spoilWas, now.GlobalSpoilingTimeMultiplier!);
      items.table = reg;
    }
    timed = reg;
    harvest?.retime(wasAt("ResourcesRespawnPeriodMultiplier"));
    if (!atLoad && RATES.some((name) => wasAt(name) !== now[name])) {
      // A body keeps the rates it was last given until something touches it, so each body in the world is rated again and
      // its next meal set. One kept in a soul ball is left: its time stands still, and it is rated when it is let out.
      for (const pid of [...records.entOf.keys()]) {
        const rec = records.byPid.get(pid);
        if (!rec || rec.dead || rec.egg !== null || rec.stored !== 0 || !rec.vitals) continue;
        survival.touch(rec);
        taming.rerate(rec);
      }
    }
    if (!atLoad) {
      // The hour of day survives a change of the clock's pace, as at a load. Every session is told the pace with the offset.
      const pace = { cycle: wasAt("DayCycleSpeedScale"), day: wasAt("DayTimeSpeedScale"), night: wasAt("NightTimeSpeedScale") };
      const is = { cycle: now.DayCycleSpeedScale!, day: now.DayTimeSpeedScale!, night: now.NightTimeSpeedScale! };
      if (pace.cycle !== is.cycle || pace.day !== is.day || pace.night !== is.night) {
        world.dayOffset = offsetForHour(world.tick, hourOfDay(world.tick, world.dayOffset, pace), is);
        Object.assign(world.clock, is);
        game.replication.markAllOwn();
      }
    }
    under = now;
    if (settingsAt) settingsAt.dirty = true;
  };
  let retimedAt = rules.version;
  /** The tuning the registry in force was made from, and what of the content settings was skipped in making it. */
  let tuning: Tuning = tuned.tuning;
  let contentPassed: readonly string[] = tuned.passed;
  /** The registry the spoiling and burning now under way were timed by. */
  let timed = reg;
  /** The content the settings now give, made once for each change of them, or why it does not compile. */
  let contentMade: { version: number; tuning: Tuning; passed: readonly string[]; reg: Registry | null; fault: string } | null = null;
  const contentNow = (): NonNullable<typeof contentMade> => {
    if (contentMade?.version === rules.version) return contentMade;
    const next = tuningOf(rules, lists, content);
    contentMade = { version: rules.version, tuning: next.tuning, passed: next.passed, reg: null, fault: "" };
    try {
      contentMade.reg = tuningText(next.tuning) === reg.tuning ? reg : deriveRegistry(content, next.tuning);
    } catch (err) {
      contentMade.fault = (err instanceof Error ? err.message : String(err)).split("\n").slice(0, 3).join("; ");
    }
    return contentMade;
  };
  /** What the host gave a copy of at start, by setting, as it last gave it. */
  const lastGiven = new Map<string, string>();
  /** Whether a setting has another value than when it was last asked of here. The first asking only notes it. */
  const turned = (...names: string[]): boolean => {
    let any = false;
    for (const name of names) {
      const row = name.startsWith("-") ? rowOf(name.slice(1), true)! : rowOf(name)!;
      const words = wordsOf(row, rules.valueOf(row));
      if (lastGiven.has(name) && lastGiven.get(name) !== words) any = true;
      lastGiven.set(name, words);
    }
    return any;
  };
  /**
   * Gives again what was copied out of the settings at start, where a setting has changed: the game's options, the
   * sizes, the spawn tables. What is already made is left as it is, and a size made smaller only stops more being added.
   */
  const reoption = (): void => {
    const o = game.opts;
    if (turned("ServerPassword")) o.password = rules.text("ServerPassword");
    if (turned("Duration")) o.motdSeconds = rules.num("Duration");
    if (turned("PendingPerAddress")) o.pendingPerAddress = rules.num("PendingPerAddress");
    if (turned("SnapshotBytesMax")) o.snapshotBytesMax = rules.num("SnapshotBytesMax");
    if (turned("ViewCap")) {
      o.viewCap = rules.num("ViewCap");
      game.replication.recap();
    }
    if (turned("MaxPlayers")) {
      game.setSeats(rules.num("MaxPlayers"));
      tactical.seats(game.clients.length);
      world.ents.reserve = game.clients.length;
    }
    if (turned("MaxEntities")) world.ents.setMax(rules.num("MaxEntities"));
    if (turned("AutoSavePeriodMinutes")) liveEvery = Math.max(1, Math.round(rules.num("AutoSavePeriodMinutes") * 60 * TICK_RATE));
    if (turned("OxygenSwimSpeedStatMultiplier")) creatures.swimGain = rules.num("OxygenSwimSpeedStatMultiplier");
    if (turned(ARK_CRATES)) recrate();
    if (spawner) {
      spawner.quiet = quiet();
      if (turned("DinoCountMultiplier", "DinoSpawnWeightMultipliers", "NPCReplacements", "ConfigAddNPCSpawnEntriesContainer", "ConfigSubtractNPCSpawnEntriesContainer", "ConfigOverrideNPCSpawnEntriesContainer")) {
        const next = spawnTables(reg, rules, lists);
        spawnsPassed = next.passed;
        spawner.retable(next.tables);
      }
    }
  };
  let spawnsPassed: readonly string[] = spawns.passed;
  // The first asking notes each setting as it stands at the start.
  reoption();
  /**
   * Puts the content the settings now give in force, if it is another: the registry is replaced, what kept a table of
   * the old one takes the new, and every session is told the tuning, to derive the same. Indices never change under a
   * tuning, so whatever names content by index is as it was. What is already contentMade is left as it is.
   */
  const recontent = (): void => {
    const next = contentNow();
    if (next.reg === null) return void say(`the content settings give content that does not compile, so the content stays as it was: ${next.fault}`);
    contentPassed = next.passed;
    if (next.reg === reg) return;
    reg = world.reg = next.reg;
    tuning = next.tuning;
    // Unless the spoiling or burning times changed, which the re-time settles by the old registry, the new one times them.
    if (wasAt("GlobalSpoilingTimeMultiplier") === rules.num("GlobalSpoilingTimeMultiplier") && wasAt("FuelConsumptionIntervalMultiplier") === rules.num("FuelConsumptionIntervalMultiplier")) timed = reg;
    items.table = reg;
    stations.retable();
    world.nodeField?.retable(reg);
    // A wheel's ray reads each road piece's surface, and the ground's grips, from the parts.
    world.structs.parts = withSurfaces(world.structs.parts, reg.parts);
    progression.rebuild();
    supply.retable();
    urban.retable();
    game.players.feet.retable();
    // A body's limits are worked out from its species' numbers, so each body in the world is worked out again.
    for (const pid of [...records.entOf.keys()]) {
      const rec = records.byPid.get(pid);
      if (rec) refreshBody(rec);
    }
    game.sendTuning();
  };
  /** In ticks. ARK reads its live file at every world save. */
  let liveEvery = Math.max(1, Math.round(rules.num("AutoSavePeriodMinutes") * 60 * TICK_RATE));
  /** The tick at which a stop that was said comes, or -1 (Host.stopIn). */
  let stopAt = -1;
  const tellAll = (text: string): void => {
    for (const c of game.clients) if (c?.active && !c.closed) game.sendText(c, TEXT_NOTICE, text);
  };
  const readLive = (): string[] => {
    if (!opts.live || rules.flag("UseDynamicConfig") !== true) return ["the live file is not in use: the server was not started with -UseDynamicConfig"];
    const text = opts.live();
    if (text === null) return [`there is no ${LIVE_FILE} to read`];
    const report = emptyReport();
    applyLive(rules, text, report);
    const [first, ...rest] = formatReport(report, rules);
    return [`${LIVE_FILE} read again: ${first!.slice("settings: ".length)}`, ...rest];
  };
  // What refreshBody works with, made before the load: a buff restored there refreshes its body, and a saddled creature
  // saved with a buff on it (a tame ball sick, or poisoned) stopped the start when these were made after it.
  const gear = new Uint16Array(GEAR_COUNT);
  /** The held slot of each record at its last refresh. */
  const inHand = new Map<number, number>();
  if (loaded && !loaded.fresh) {
    // Bodies saved under other rates are rated again as they load.
    survival.rerate = RATES.some((name) => wasAt(name) !== rules.num(name));
    const survivors = new Set(persistence!.survivors.values());
    let bodiless = 0;
    for (const rec of records.byPid.values()) {
      if (survivors.has(rec.pid)) {
        // A survivor stays out of the world until its owner returns, with its vitals stopped.
        survival.restore(rec, false);
        continue;
      }
      // A structure's record has no entity, and neither has carried young, nor a tame kept in a soul ball.
      if (rec.at >= 0 || reg.defs[rec.kind]?.type === "structure" || (rec.egg !== null && rec.egg.carrier !== 0) || rec.stored !== 0) continue;
      if (reg.defs[rec.kind]?.type === "prop") death.place(rec);
      else {
        const e = creatures.adopt(rec);
        if (e >= 0) {
          persistence!.attach(rec, e);
          if (reg.vehicle[rec.kind]) urban.register(e);
          inventoryChanged.add(rec);
        }
      }
      if (!records.entOf.has(rec.pid)) bodiless++;
    }
    // Their records stay in the save, and get bodies at a start that allows more.
    if (bodiless > 0) say(`no body for ${bodiless} of the creatures and things in the save, which stay in it without one: the world holds ${world.ents.count} of the ${world.ents.max} that MaxEntities allows, with ${world.ents.reserve} kept for survivors`);
    refusedTold = world.ents.refused;
    // Before the rest resume: a kept tame that no ball names is set back in the world here, and is theirs to resume as
    // any other with a body is.
    balls.resume();
    survival.rerate = false;
    // The hour of day survives a change of clock pace, so the offset is recomputed for the new pace.
    const pace = { cycle: wasAt("DayCycleSpeedScale"), day: wasAt("DayTimeSpeedScale"), night: wasAt("NightTimeSpeedScale") };
    if (pace.cycle !== world.clock.cycle || pace.day !== world.clock.day || pace.night !== world.clock.night) {
      world.dayOffset = offsetForHour(world.tick, hourOfDay(world.tick, world.dayOffset, pace), world.clock);
      if (settingsAt) settingsAt.dirty = true;
    }
    retime(true);
    // These resume once every body is back and its limits are known.
    for (const rec of records.byPid.values()) progression.resume(rec);
    stations.resume();
    taming.resume();
    breeding.resume();
    eggs.resume();
    // Last, because a buff's change refreshes its body, and that settles what the body carries.
    for (const rec of records.byPid.values()) buffs.restore(rec, persistence!.store.unrated.has(rec.pid));
  } else {
    const rng = new Rng((opts.seed ?? 1) + 17);
    // A wild creature's level is one of thirty steps, drawn by ARK's weights, each the size of the server's difficulty.
    const difficulty = difficultyOf(rules);
    // A place off the zone or inside a structure is tried again. A map with no spawn zone starts empty, and so does ARK's -NoDinos.
    const scatter = (zone: ServerWorld["zones"][number] | undefined, species: string, wanted: number): void => {
      if (!zone || rules.flag("NoDinos") === true) return;
      const [cx, cz] = zone.at;
      const [hx, hz] = zone.half ?? [zone.radius ?? 0, zone.radius ?? 0];
      for (let tries = wanted * 20; wanted > 0 && tries > 0; tries--) {
        const x = rng.range(cx - hx, cx + hx);
        const z = rng.range(cz - hz, cz + hz);
        const level = wildLevel(wildStep(rng), difficulty);
        if (!zone.half && (x - cx) * (x - cx) + (z - cz) * (z - cz) > hx * hx) continue;
        if (spawnCreature(species, x, z, level) >= 0) wanted--;
      }
    };
    // The herd starts in the map's first spawn zone and the hunters in its last.
    scatter(world.zones[0], opts.startingSpecies ?? "core:grazer", opts.startingCreatures ?? 0);
    scatter(world.zones[world.zones.length - 1], "core:raptor", opts.startingHunters ?? 0);
    // The map's parked vehicles, owned by nobody. From here on the save keeps them, as it keeps any record.
    const missed = new Map<string, number>();
    for (const v of parsed?.vehicles ?? []) {
      if (parkVehicle(v.kind, v.x, v.z, 0, (v.yaw / 65536) * 2 * Math.PI, "wild", foundVehicle(world.mapId, v, opts.seed ?? 1)) < 0) missed.set(v.kind, (missed.get(v.kind) ?? 0) + 1);
    }
    if (missed.size > 0) say(`not parked, for want of the content or of room: ${[...missed].map(([id, n]) => `${n} of the map's ${id}`).join(", ")}`);
  }
  if (spawner) {
    const fresh = !loaded || loaded.fresh;
    // -ForceRespawnDinos, or ServerAutoForceRespawnWildDinosInterval come round, replaces the wild of a saved world at its start.
    const forced = !spawner.quiet && spawner.forced(persistence && !fresh ? persistence.store.meta("spawner") : null, Date.now() / 1000);
    const wiped = forced && !fresh ? spawner.wipe() : -1;
    // Under a -NoDinos flag nothing is put in: what a save holds is counted, and the regions wait for the flag to go.
    spawner.begin(!spawner.quiet && (fresh || wiped >= 0));
    if (wiped >= 0) say(`destroyed ${wiped} wild creatures at the start, to be replaced`);
    persistence?.sidecar("spawner", spawner.saved);
  }
  // A place where the map parks a car gets another some days after its car went (server/car-return.ts).
  const returning = new CarReturn({ world, game, records, rules, deadlines, seed: opts.seed ?? 1,
    park: (v, start) => parkVehicle(v.kind, v.x, v.z, 0, (v.yaw / 65536) * 2 * Math.PI, "wild", start) }, parsed?.vehicles ?? []);
  const carReturn = returning.places.length > 0 ? returning : null;
  if (carReturn) {
    carReturn.begin(persistence && !loaded!.fresh ? (persistence.store.meta("carReturn") as string | null) : null);
    persistence?.sidecar("carReturn", carReturn.saved);
  }
  // Supply drops (server/supply.ts). The drop book is a file beside the save, which a wipe of the world leaves; the
  // drops that are live are the save's, written in the commit that writes their capsules.
  // The starter book comes with the map's own sites and circuits (content/supply/sites.ts).
  const supplyBook = new BookStore(opts.dbPath ? `${opts.dbPath}.supply.json` : null, world.mapId, () => withSites(starterBook(), world.mapId), say);
  const loadoutBook = new LoadoutStore(opts.dbPath ? `${opts.dbPath}.loadouts.json` : null, builtinLoadouts, reg, say);
  const supply = new Supply({ world, game, records, items, death, containers, progression, deadlines, bus, book: supplyBook, seed: opts.seed ?? 1, rules, say });
  /** ARK's own override of what a crate holds wins over the book, tier by tier, as an ARK operator expects. */
  const recrate = (): void => {
    const loot = catalogOf(reg);
    const ark = arkCrates(rules.list(ARK_CRATES), supplyBook.book.tiers, (name) => lists.ids(ARK_CRATES, name, "item"), (id) => loot.byId.get(id)?.never !== true);
    supply.overrides = ark.tables;
    for (const line of ark.passed) say(line);
  };
  recrate();
  supply.begin(persistence && !loaded!.fresh ? (persistence.store.meta("supply") as string | null) : null);
  persistence?.sidecar("supply", supply.saved);
  build.keepClear = (x, z) => supply.buildFault(x, z);
  // Cast's people and planned stories are kept a minute at a time; its bodies never are (a start sweeps them).
  castHost.cast.load(persistence && !loaded!.fresh ? (persistence.store.meta("cast") as string | null) : null);
  persistence?.sidecar("cast", castHost.saved, 60 * TICK_RATE);

  // A name belongs to the first device key that takes a body under it.
  game.sessions.sameCreation=(name,key,request)=>{
    const rec=recordOf(name), prior=rec?.extra.get(CREATE_REQUEST);
    return !!rec && !!prior && ownsSurvivor(rec,key) && prior.length===request.length && request.every((b,i)=>prior[i]===b);
  };
  game.sessions.owns = (name, key) => { const rec = recordOf(name); return !!rec && ownsSurvivor(rec, key); };
  game.sessions.authorize = (name, key) => {
    // Nobody joins a world that has not saved for a minute.
    if (persistence?.failing && world.tick - persistence.failing.since >= UNSAVED_REFUSE_TICKS) return false;
    const rec = recordOf(name);
    return !rec || !rec.keyHash || ownsSurvivor(rec,key);
  };
  if (cluster) {
    game.sessions.arrive = (name, key, ticket) => (persistence?.failing && world.tick - persistence.failing.since >= UNSAVED_REFUSE_TICKS ? "this server has not been able to save for a minute, so nobody may come yet" : cluster.arrive(name, key, ticket));
    game.sessions.nameAway = name => cluster.away.has(name);
    game.sessions.away = (name, key) => cluster.awayCheck(name, key);
  }
  // A survivor that came from another server and has not risen joins as one that died does: with no body, choosing where.
  game.sessions.savedPosition = (name) => {
    const rec = recordOf(name);
    return rec && cluster?.arriving.has(rec.pid) ? { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, dead: true, team: rec.team } : (rec ?? null);
  };
  game.sessions.needsLook = (name) => !recordOf(name)?.look;
  game.sessions.onBody.on((c) => {
    let rec = recordOf(c.name);
    const first = !rec;
    if (!rec) {
      rec = records.create(survivor, c.name);
      if(c.createRequest)rec.extra.set(CREATE_REQUEST,c.createRequest.slice());
      if (persistence) persistence.bindSurvivor(c.name, rec.pid);
      else names.set(c.name, rec.pid);
      made.add(rec.pid);
    }
    if (!rec.keyHash) {
      rec.keyHash = hashKey(c.key);
      records.dirty.add(rec.pid);
    }
    // A survivor without a look takes the one it came with, or the default.
    if (!rec.look) {
      rec.look = c.look ?? defaultLook();
      records.dirty.add(rec.pid);
    }
    world.ents.setBodyLook(c.ent, rec.look);
    world.ents.jetSpent[c.ent] = rec.jetSpent;
    // Every survivor is on a team, even a team of one.
    if (rec.team === 0) {
      rec.team = records.newTeam();
      records.dirty.add(rec.pid);
    }
    // A survivor's stat points live in a genome, like any body's.
    rec.genome ??= new Genome();
    c.pid = rec.pid;
    if (persistence) persistence.attach(rec, c.ent);
    else {
      records.entOf.set(rec.pid, c.ent);
      world.ents.pid[c.ent] = rec.pid;
    }
    refreshBody(rec);
    survival.suspend(rec, false);
    // A save from a server that stopped without standing its drivers down has them inside their cars.
    urban.settle(c.ent);
    bus.after(SESSION_SPAWN, { pid: rec.pid, first, why: first ? "made" : c.entered ? "respawned" : "returned" });
    // A session that was in the creator has its survivor only now.
    if (c.entered) joined(c);
  });
  game.sessions.onBodyGone.on((c) => {
    impale.release(c.pid);
    carry.release(c.pid);
    // Seats are not saved: a survivor in a car or on a creature is saved standing beside it.
    urban.standDown(c.pid);
    riding.standDown(c.pid);
    // Out of the world, a survivor neither eats nor drowns.
    const gone = records.byPid.get(c.pid);
    if (gone) survival.suspend(gone, true);
    inHand.delete(c.pid);
    glidingSince.delete(c.pid);
    if (persistence) persistence.detach(c.pid);
    else {
      const rec = records.byPid.get(c.pid);
      if (rec) {
        rec.jetSpent = world.ents.jetSpent[c.ent]!;
        rec.x = world.ents.x[c.ent]!;
        rec.y = world.ents.y[c.ent]!;
        rec.z = world.ents.z[c.ent]!;
        rec.yaw = world.ents.yaw[c.ent]!;
      }
      records.entOf.delete(c.pid);
    }
  });
  const creative = new Creative(world, game, rules, bus, persistence);
  game.sessions.onEnter.on((c) => {
    // A survivor that joins dead gets no onBody call, so its pid is set here.
    if (c.pid === 0) c.pid = recordOf(c.name)?.pid ?? 0;
    creative.enter(c);
    focus.set(c.id, c.chunk);
    moved(-1, c.chunk);
    c.entered = true;
    // One that joins with no body chooses where to rise, for the reason it left its body.
    if (c.state === SESSION_DEAD) c.why = cluster?.arriving.has(c.pid) ? CHOOSE_ARRIVED : beds.whyOf(c.pid);
    // One still making its survivor is told of when it has made it.
    if (c.pid !== 0) joined(c);
    // Tribe member lists show who is online.
    tribes.version++;
    // The Message setting separates its lines with a literal backslash and n.
    const name = rules.text("SessionName");
    if (name !== "") game.sendText(c, TEXT_MOTD, name);
    for (const line of rules.text("Message").split("\\n")) if (line.trim() !== "") game.sendText(c, TEXT_MOTD, line.trim());
    // One who joins during the countdown to a stop is told of it too.
    if (stopAt >= 0) game.sendRestart(Math.max(1, Math.ceil((stopAt - world.tick) / TICK_RATE)), c);
  });
  game.sessions.onPresence.on((c) => {
    if (c.closed) activity.leave(c.pid);
    else activity.login(c.pid);
    bus.after(SESSION_PRESENCE, { pid: c.pid, connected: !c.closed });
    tribes.version++;
    // The voice socket belonged to the old connection.
    voice.revoke(c);
  });
  game.sessions.onExit.on((c) => {
    activity.leave(c.pid);
    survivorLog.leave(c, c.left);
    bus.after(SESSION_LEAVE, { pid: c.pid, why: c.left });
    tribes.version++;
    voice.revoke(c);
    moved(focus.get(c.id) ?? -1, -1);
    focus.delete(c.id);
  });
  const seatedHead = new Float64Array(3);
  const parts = game.parts;
  const lane = game.lane;
  // A car door held open strikes whoever stands where it swings (server/urban.ts doorStrikes): a blow by the car's
  // driver, by its speed, told to everyone near as a car's (EVENT_IMPACT), and a creature it kills tumbles.
  // A survivor knocked off their feet (Knockdowns) goes limp as its ragdoll, thrown as the blow left it moving, and gets
  // up where it comes to rest (server/falls.ts), stunned a moment more as it does. Where no ragdoll may fall it is stunned
  // standing: the body has no hold on where it goes (shared/sim/character.ts, MF_ROOTED), and its client predicts it so.
  const stunned = reg.index.get("core:stunned") ?? -1;
  const knockDown = (body: number, wx = 0, wy = 0, wz = 0): void => {
    if (stunned < 0 || !rules.on("Knockdowns")) return;
    const rec = records.byPid.get(world.ents.pid[body]!);
    if (!rec || rec.kind !== survivor) return;
    const ents = world.ents;
    if (!falls.knock(body, ents.vx[body]!, ents.vy[body]!, ents.vz[body]!, wx, wy, wz)) buffs.give(rec, stunned, 0, KNOCKDOWN_SECONDS);
    refreshBody(rec);
  };
  urban.onSkateFall = (actor, yaw) => {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    world.ents.vx[actor] = dx * 1.1; world.ents.vz[actor] = dz * 1.1;
    knockDown(actor, dz * 2, .35, -dx * 2);
  };
  falls.onUp = (body) => {
    const rec = records.byPid.get(world.ents.pid[body]!);
    if (rec && stunned >= 0) buffs.give(rec, stunned, 0, GET_UP_SECONDS);
    if (rec) refreshBody(rec);
  };
  const doorBlow: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  urban.onDoorStrike = (vehicle, body, speed, dx, dz) => {
    const ents = world.ents, driver = game.clients.find((c) => c?.active && c.drive === vehicle);
    doorBlow.by = driver ? records.byPid.get(driver.pid) ?? null : null;
    doorBlow.x = ents.x[vehicle]!;
    doorBlow.z = ents.z[vehicle]!;
    doorBlow.base = Math.min(DOOR_HARM_MOST, DOOR_HARM_BASE + speed * DOOR_HARM_PER);
    const impact = { victimHandle: ents.handleOf(body), victimPid: ents.pid[body]!, vx: ents.vx[body]!, vy: ents.vy[body]!, vz: ents.vz[body]!, wx: dz * 3, wy: 0, wz: -dx * 3 };
    knockDown(body, impact.wx, impact.wy, impact.wz);
    combat.land(doorBlow, body, ZONE_NONE, ents.x[body]!, ents.y[body]! + 1, ents.z[body]!, 0, impact);
  };
  game.players.blockBodies = () => [creatures.awake, creatures.awakeCount];
  // The host's own work in the tick. Each is a row of `systems` below, which says when it runs.
  /** A session whose focus left its chunk wakes what is round the new one. */
  const followFocus = (): void => {
    for (const c of game.clients) {
      if (!c?.active) continue;
      const was = focus.get(c.id)!;
      if (c.chunk === was) continue;
      focus.set(c.id, c.chunk);
      moved(was, c.chunk);
    }
  };
  /** Whether each survivor's head is under water, a seated one's where its seat puts it. */
  const markSubmerged = (): void => {
    for (const c of game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const rec = records.byPid.get(c.pid);
      if (rec) {
        const seated = riding.eye(c.ent, seatedHead) || urban.eye(c.ent, seatedHead);
        survival.setSubmerged(rec, seated
          ? seatedHead[1]! < world.hf.waterAt(seatedHead[0]!, seatedHead[2]!)
          : world.ents.y[c.ent]! + stanceEye(survivorMove, world.ents.stance[c.ent]!) < world.hf.waterAt(world.ents.x[c.ent]!, world.ents.z[c.ent]!));
      }
    }
  };
  const contacts = (): void => {
    creatureContacts.step(creatures.awake, creatures.awakeCount);
    for (const e of urban.contacts!.step()) {
      urban.syncAfterContact(e);
      riding.syncAfterContact(e);
    }
  };
  const keepHouse = (tick: number): void => {
    // A full entity store is logged when it first refuses, and then at most once a minute.
    if (world.ents.refused !== refusedTold && tick >= refusedNext) {
      say(`the world has no place for more bodies (${world.ents.refused - refusedTold} refused): it holds ${world.ents.count} of the ${world.ents.max} that MaxEntities allows, with ${world.ents.reserve} kept for survivors`);
      refusedTold = world.ents.refused;
      refusedNext = tick + 60 * TICK_RATE;
    }
    // The idle kick runs only with ARK's -EnableIdlePlayerKick.
    if (tick % TICK_RATE === 0 && rules.flag("EnableIdlePlayerKick") === true) {
      const most = Math.round(rules.num("KickIdlePlayersPeriod") * TICK_RATE);
      for (const c of game.clients) if (c?.active && !c.closed && tick - c.activeAt > most) game.sessions.reject(c, REJECT_KICKED);
    }
    // The report is logged only when the live file changed a rule.
    if (opts.live && tick % liveEvery === 0 && rules.flag("UseDynamicConfig") === true) {
      const before = rules.version;
      const said = readLive();
      if (rules.version !== before) for (const line of said) console.log(line);
    }
    // A stop that was said: the chat counts it down, and at its tick the process is stopped (main.ts stopGently).
    if (stopAt >= 0) {
      const left = stopAt - tick;
      if (left <= 0) {
        stopAt = -1;
        host.onStop?.();
      } else if (left % TICK_RATE === 0) {
        const seconds = left / TICK_RATE;
        if (seconds % 60 === 0 || seconds === 30 || seconds <= 10) tellAll(`The server restarts in ${seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`}. Stay on this page and you will be brought back.`);
      }
    }
    if (retimedAt !== rules.version) {
      retimedAt = rules.version;
      // Before the re-time, which settles what spoils and burns by the registry this replaces.
      recontent();
      reoption();
      retime(false);
    }
    // The next commit saves the values the timers now run under.
    if (settingsAt && settingsAt.version !== rules.version) {
      settingsAt.version = rules.version;
      settingsAt.dirty = true;
    }
  };
  /** What happened this tick is told to modules before it is committed. */
  const tellModules = (tick: number): void => {
    if (!started) bus.after(SERVER_START, { tick, map: world.mapId, fresh: loaded ? loaded.fresh : true });
    started = true;
    if (bus.n[SERVER_TICK] !== 0) bus.after(SERVER_TICK, { tick });
    if (tick % (30 * TICK_RATE) === 0) activity.checkpointAll();
    if (tick % TICK_RATE === 0) bus.after(SERVER_SECOND, { tick });
    if (settingsToldAt !== rules.version) {
      // The first is the settings as they stood at start, which is not a change.
      if (settingsToldAt >= 0) bus.after(SERVER_SETTINGS, { names: "", source: "" });
      settingsToldAt = rules.version;
    }
  };
  const announceBackup = (tick: number): void => {
    if (persistence && opts.backups && tick % liveEvery === 0) bus.after(SERVER_SAVE, { tick, folder: `${persistence.store.path}.backups` });
  };
  const save = (tick: number): void => {
    if (persistence && opts.backups && tick % liveEvery === 0) persistence.keeper.backup();
    if (persistence && !persistence.tryCommit(commitEvery)) {
      const late = tick - persistence.failing!.since;
      if (late === UNSAVED_TELL_TICKS || (late > UNSAVED_TELL_TICKS && late % (60 * TICK_RATE) === 0)) {
        for (const c of game.clients) if (c?.active && !c.closed) game.sendText(c, TEXT_NOTICE, `the server has not been able to save for ${Math.round(late / TICK_RATE)} seconds; what happens now is lost if it stops`);
      }
    }
  };
  if (persistence) {
    persistence.onFailing = (f) => {
      if (f === null) bus.after(SERVER_SAVED, { tick: world.tick });
      else if (f.tries === 1) bus.after(SERVER_SAVE_FAILED, { code: f.code, since: f.since });
      if (f === null) console.log("saving again");
      else if (f.tries === 1) console.log(`the world could not be saved (${f.code}: ${f.error}); trying again, and the world runs on`);
    };
    persistence.onMoved = (path) => console.log(`the save file is broken; the world is now saved in ${path}, so start the server with --db ${path} next time`);
    persistence.onBackup = (r) => console.log(r.path === "" ? `no backup was made: ${r.why}` : `backup of tick ${r.tick} in ${r.path} (${(r.bytes / 1e6).toFixed(1)} MB, ${Math.round(r.ms)} ms)`);
    // Last, so a host that fails to start has no thread to stop.
    if (opts.keeper === "worker") persistence.keepWith((s) => workerKeeper(s.path));
  }
  // A command that threw may have left the world half done. Its ledger is what a save is checked by as it loads, so while that
  // balances the world goes on; else the server stops as at any other throw, saving nothing but the refusal.
  game.players.onFault = (c, op, command, err) => {
    say(`a command of ${c.name} (survivor ${c.pid}) threw at tick ${world.tick}; it is put out, and its device and machine refused for 10 minutes. Op ${op}, the message ${Buffer.from(command).toString("hex")}:\n${err instanceof Error ? err.stack : String(err)}`);
    const wrong = items.audit();
    if (wrong.length === 0) return true;
    say(`the item ledger does not balance after it, so the server stops without saving the tick:\n${wrong.join("\n")}`);
    try {
      persistence?.writeSidecar("refused");
    } catch {
      // The stop goes on.
    }
    return false;
  };
  // An unconscious survivor can talk, use the console and the sundial, shut what it had open and say how far off it is sent bases. Its client
  // can make it do nothing else.
  game.players.allows.on((c, op) => op === CMD_TEXT || op === CMD_CLOCK || op === CMD_CHAT || op === CMD_CLOSE || op === CMD_FAR || !records.byPid.get(c.pid)?.out);
  game.players.onLand.on((c, speed) => {
    const rec = records.byPid.get(c.pid);
    if (rec && !(world.ents.jetGear[c.ent]! & JET_BOOTS)) survival.landed(rec, speed);
  });
  // A glider wears as it is flown and is charged as it folds, never in the air: one use for each of its `seconds` it was
  // open, and at least one a flight (GlideFacet). The one charged is the one refreshBody says it flies.
  const glidingSince = new Map<number, number>();
  /** The slot of the best serviceable glider `rec` carries, the first of them, or -1. */
  function gliderSlot(rec: EntityRecord): number {
    const inv = rec.inv;
    let best = -1;
    if (inv) for (let s = 0; s < inv.cap; s++) {
      const grade = reg.glide[inv.item[s]!]!;
      if (grade > 0 && inv.dur[s]! > 0 && (best < 0 || grade > reg.glide[inv.item[best]!]!)) best = s;
    }
    return best;
  }
  game.players.onGlide.on((c, opened) => {
    if (opened) {
      glidingSince.set(c.pid, world.tick);
      return;
    }
    const since = glidingSince.get(c.pid);
    glidingSince.delete(c.pid);
    const rec = records.byPid.get(c.pid);
    const slot = rec ? gliderSlot(rec) : -1;
    if (!rec || since === undefined || slot < 0) return;
    const item = rec.inv!.item[slot]!;
    const used = Math.max(1, Math.ceil((world.tick - since) / reg.glideTicks[item]!));
    const def = reg.defs[item];
    if (items.wear(rec, slot, used) === 0) notice(c.pid, `Your ${(def?.type === "item" && def.label) || "glider"} has come apart.`);
  });
  const own: OwnContext = {
    world, game, records, items, survival, progression, rules, voice,
    use,
    openOf: (c) => containers.openOf(c),
    closeOpen: (c) => containers.close(c),
    beds,
    subject: (rec) => taming.subject(rec),
    refresh: (rec) => refreshBody(rec),
    mend: (rec, points) => {
      // Health from food comes over time, at the rate of the buff that shows it, and one meal at a time.
      if (fedRate > 0) buffs.give(rec, fed, 0, points / fedRate);
      else survival.add(rec, V_HEALTH, points);
    },
    dose: (rec, item, by) => taming.dose(rec, item, by),
    rearm: (rec) => {
      // No slot is -2, so the refresh sees a change of what is in hand.
      inHand.set(rec.pid, -2);
      refreshBody(rec);
    },
    // An egg is set down as an egg where it lies.
    drop: (rec, slot, n) => eggs.put(rec, slot, n) ?? death.drop(rec, slot, n),
  };
  const tactical = new Tactical(world, game, records, rules);
  game.replication.contactProxies = (c, out) => { if (c.drive >= 0) urban.contacts?.proxies(c.drive, out); };
  const corpseReplication = new CorpseReplication(game, [corpses, falls]);
  game.handle(CMD_CORPSE, (c, r) => corpseReplication.request(c, r));
  progression.onChange = (rec) => refreshBody(rec);
  addOwnCommands(own);
  addOwnState(own);
  tribes.tell(game, (pid) => sessionOf(pid) !== null);
  tellStation(game, records);

  function refreshInventories(): void {
    for (const rec of inventoryChanged) {
      inventoryChanged.delete(rec);
      if (records.byPid.get(rec.pid) === rec) refreshBody(rec);
    }
  }

  function refreshBody(rec: EntityRecord): void {
    survival.init(rec);
    const e = records.entOf.get(rec.pid);
    if (e === undefined || reg.defs[rec.kind]?.type !== "species") return;
    // A mount's load includes what its riders carry, at its species' share (a pteranodon's 0.85), and a survivor's half of
    // what a creature in its arms carries.
    const driver = urban.riderOf(e);
    let carried = driver?.inv ? items.inv(driver).weight(items.table) : 0;
    for (const rider of riding.riders(e)) if (rider.inv) carried += items.inv(rider).weight(items.table);
    const arms = carry.heldBy(rec.pid);
    if (rec.inv) items.inv(rec); // Settle spoilage before weighing the remaining stacks.
    const load = inventoryEffectiveWeight(reg, rec, items.table) + carried * reg.riderWeight[rec.kind]! + (arms >= 0 ? carry.load(rec) : 0);
    if (reg.vehicle[rec.kind]) {
      const v = world.ents.vrow[e]!, mass = Math.fround(urban.payloadMass(e));
      // A sleeping vehicle whose load changes, as when what it holds spoils, settles on its springs at its next heartbeat.
      if (mass !== world.ents.vehiclePayloadMass[v]) urban.rouse(e);
      world.ents.vehiclePayloadMass[v] = mass;
    }
    // A creature in someone's arms weighs on them.
    const carrier = carry.carrierOf(e);
    if (carrier && carrier !== rec) refreshBody(carrier);
    // Changing a rider's pack also changes the mount's load.
    const seat = world.ents.seat[e]! - 1;
    const mount = seat >= 0 && (riding.occupancy.seatOf(rec.pid)?.host === world.ents.pid[seat] || urban.occupancy.seatOf(rec.pid)?.host === world.ents.pid[seat]) ? records.byPid.get(world.ents.pid[seat]!) : undefined;
    if (mount && mount !== rec) refreshBody(mount);
    // A young creature carries a share of a grown one's capacity, so its load is scaled up.
    const strength = youngShare(growthStep(rec.span, rec.grown, world.tick));
    refreshMods(reg, world.ents, e, rec.genome, load / strength, buffs.speedOf(rec) * creatureTraits.speedOf(rec), buffs.rooted(rec), rec.out, creatures.swimGain);
    const level = rec.kind === survivor ? progression.levelOf(rec.xp) : rec.genome ? rec.genome.level : 1;
    world.ents.setLook(e, level, rec.genome ? rec.genome.colors : null, rec.name);
    world.ents.setTeam(e, rec.team);
    const inv = rec.inv;
    if (inv && inv.hotbar >= 0) {
      const ents = world.ents;
      // Arms round a creature hold nothing else: what is chosen stays put away until it is set down.
      if (arms >= 0 && rec.held >= 0) {
        rec.held = -1;
        records.dirty.add(rec.pid);
      }
      const slot = rec.held >= 0 && inv.item[inv.hotbar + rec.held] !== 0 ? inv.hotbar + rec.held : -1;
      const item = slot >= 0 ? inv.item[slot]! : 0;
      const was = ents.gears.get(e)?.[GEAR_HELD] ?? 0;
      gear[GEAR_HELD] = item;
      let suit = 0;
      for (let k = 0; k < ARMOR_SLOTS; k++) {
        const slot = inv.armor + k, id = inv.item[slot]!;
        gear[GEAR_WORN + k] = id;
        // A piece that flies (WearFacet.jet) and is not worn out lends its slot's bit.
        if (inv.dur[slot]! > 0) suit |= reg.wearJet[id]! << k;
      }
      const helmetChanged = ((ents.jetGear[e]! ^ suit) & JET_HELMET) !== 0;
      ents.jetGear[e] = suit;
      // The glider it flies is the best serviceable one it carries, wherever it lies. Arms round a creature fly none.
      const flown = arms < 0 ? gliderSlot(rec) : -1;
      ents.glideGear[e] = flown >= 0 ? reg.glide[inv.item[flown]!]! : 0;
      if (!(suit & JET_CUIRASS)) ents.jetThrust[e] = ents.jetKeys[e] = ents.jetJumpTap[e] = ents.jetSprintTap[e] = 0;
      // Its air under water follows the helmet at once, not at the vitals' next deadline.
      if (helmetChanged) survival.touch(rec);
      ents.setGear(e, gear);
      // Only the thing in hand has its attachment on, and taking another in hand switches it off: "it does require you to
      // press N each time you switch" (Flashlight Attachment). Others see a laser on (weapons-plan.md, M10).
      const before = inHand.get(rec.pid);
      items.switchOff(rec, before === undefined || before === slot ? slot : -1);
      ents.setOn(e, slot >= 0 && (inv.flags[slot]! & FLAG_ON) !== 0 && items.attachmentOf(inv, slot) === "laser");
      // A worn-out weapon counts as holding no rounds and takes none.
      const params = reg.weapon[item] ?? FISTS;
      const works = slot >= 0 && params.clip > 0 && inv.dur[slot]! > 0;
      const loaded = works ? inv.loaded[slot]! : 0;
      const ammo = works ? combat.ammoFor(rec, slot) : 0;
      ents.hold[e] = arms >= 0 ? HOLD_CARRY : params.hold;
      ents.rounds[e] = loaded;
      ents.reloadTo[e] = works ? Math.min(params.clip, (ammo === inv.ammo[slot] ? loaded : 0) + (ammo !== 0 ? inv.total(ammo) : 0)) : 0;
      // A change of held item stops its action and starts the equip delay.
      if (item !== was || slot !== (inHand.get(rec.pid) ?? -1)) {
        ents.act[e] = item !== 0 ? ACT_EQUIP : ACT_NONE;
        ents.actTicks[e] = 0;
        // What this tick's action step decided was decided for the thing it held before. Combat resolves it after commands run.
        const session = sessionOf(rec.pid);
        if (session) session.did = 0;
      }
      inHand.set(rec.pid, slot);
    } else if (rec.saddle !== 0 || world.ents.gears.has(e)) {
      // A creature's gear names the saddle it wears, which every client draws on it (D491).
      gear.fill(0);
      gear[GEAR_WORN] = rec.saddle;
      world.ents.setGear(e, gear);
    }
  }
  refreshInventories();

  const con = new Console();
  con.bus = bus;
  for (const [, add] of COMMAND_FAMILIES) add(con);
  // After the server's own commands, so a module can take no name of theirs.
  const modules = new Modules(
    {
      bus,
      world: {
        get tick() {
          return world.tick;
        },
        online: () => game.clients.flatMap((c) => (c?.active && !c.closed ? [{ pid: c.pid, name: c.name }] : [])),
      },
      act: {
        tell: (pid, text) => notice(pid, text),
        broadcast: (text) => {
          for (const c of game.clients) if (c?.active && !c.closed) game.sendText(c, TEXT_NOTICE, text);
        },
      },
      addCommand: (module, c) => {
        if (con.commands.has(c.name.toLowerCase())) throw new Error(`module ${module}: there is already a command "${c.name}"`);
        con.add({ name: c.name.toLowerCase(), usage: c.usage, help: c.help, admin: c.admin, run: (ctx, args) => c.run({ pid: ctx.client?.pid ?? 0, name: ctx.client?.name ?? "(operator)", operator: ctx.client === null }, args) });
      },
      log: say,
    },
    opts.modules ?? [],
  );
  const mark = (part: number): System => ({ step: () => parts.mark(part) });
  /** Physics: its time is the lane's (server/lane.ts). */
  const physics = (s: System): System => ({ step: (tick) => { lane.enter(); s.step!(tick); lane.leave(); } });
  // The tick. Each hook walks this list from the top, so a row's place here is its place in every hook it has: a new
  // system is a row where its work belongs. The simulation is the same on every run only while the order is.
  const systems: System[] = [
    { beforeStep: refreshInventories },
    creative,
    gaze,
    { step: followFocus },
    mark(PART.focus),
    { step: markSubmerged },
    { step: (tick) => void deadlines.run(tick) },
    { step: refreshInventories },
    mark(PART.deadlines),
    // Struggling, and the grace after a bola, once the buffs that came due have ended.
    entangle,
    { step: () => creatureTraits.step(creatures.awake, creatures.awakeCount) },
    containers,
    death,
    supply,
    mark(PART.life),
    // Riders move with their mounts before combat aims at either.
    urban,
    riding,
    { beforeStep: () => void (game.players.blocking.survivorsPass = !rules.on("SurvivorsBlock")) },
    carry,
    emotes,
    mark(PART.riders),
    // Combat resolves this tick's swings and shots now that every body has moved.
    combat,
    projectiles,
    physics(loose),
    clouds,
    mark(PART.combat),
    creatures,
    mark(PART.creatures),
    physics({ step: contacts }),
    mark(PART.contacts),
    impale,
    ...(spawner ? [spawner] : []),
    castHost,
    mark(PART.spawner),
    build,
    mark(PART.build),
    taming,
    breeding,
    feces,
    overhead,
    physics(corpses),
    physics({ step: () => falls.step() }),
    voice,
    mark(PART.world),
    { step: keepHouse },
    { step: tellModules },
    ...(cluster ? [cluster] : []),
    { step: announceBackup },
    modules,
    { step: () => bus.flush() },
    { step: refreshInventories },
    survivorLog,
    mark(PART.modules),
    { step: save },
    // Each session's feeds, just before its snapshot, and what follows the view it was sent.
    { replicate: (c) => motion.sync(c) },
    { replicate: (c) => syncOwn(own, c) },
    ...(harvest ? [{ replicate: (c: Client) => harvest.sync(c) }] : []),
    { replicate: (c) => tactical.sync(c) },
    { replicate: (c) => supply.sync(c) },
    { snapshot: (c, view) => corpseReplication.sync(c, view) },
  ];
  const tick = walk(systems);
  game.onBeforeStep = tick.beforeStep;
  game.onStep = tick.step;
  game.replication.onReplicate = tick.replicate;
  game.replication.onSnapshot = tick.snapshot;
  const host: Host = {
    world,
    mapFile,
    records,
    game,
    creatures,
    impale,
    items,
    survival,
    death,
    containers,
    combat,
    buffs,
    rules,
    tribes,
    chat,
    voice,
    build,
    fixtures,
    motion,
    stations,
    taming,
    riding,
    urban,
    cast: castHost,
    vehicles,
    entangle,
    breeding,
    tactical,
    corpses,
    carry,
    emotes,
    feces,
    eggs,
    loose,
    falls,
    balls,
    overhead,
    gaze,
    hurt,
    spawner,
    carReturn,
    supply,
    supplyBook,
    loadoutBook,
    beds,
    cluster,
    settled,
    survivorIds: () => (persistence?.survivors ?? names).values(),
    survivorRecord: recordOf,
    online: (pid) => sessionOf(pid) !== null,
    setSetting(name, words) {
      const row = rowOf(name);
      if (!row) return `there is no setting called ${name}`;
      const fixed = fixedWhy(row);
      if (fixed !== "") return `${row.name} ${fixed}`;
      const was = { value: rules.valueOf(row), source: rules.sourceOf(row) };
      const no = rules.assign(row.name, words, "console");
      if (no !== "" || contentNow().reg !== null) return no;
      // A value the content cannot be made with is not taken.
      const fault = contentNow().fault;
      rules.put(row, was.value, was.source);
      return `${row.name} gives content that does not compile: ${fault}`;
    },
    pageSetting(name, words) {
      const row = rowNamed(name);
      if (!row) return { why: `there is no setting called ${name}` };
      const fixed = fixedWhy(row);
      if (fixed !== "") return { why: `${row.name} ${fixed}` };
      const did = words === null ? kept.reset(row) : kept.set(row, words);
      if (did.why !== "") return { why: words === null ? did.why : `${row.name} ${did.why}` };
      // In the admin journal as the console's `setting` is, a list by its size and a secret not at all.
      const shown = words === null ? "(as before the page set it)" : row.secret ? "****" : words.includes("\n") ? `(${words.split("\n").length} lines)` : words;
      persistence?.journal(OP_ADMIN, new TextEncoder().encode(`(admin page)\tsetting ${name} ${shown}`));
      return did;
    },
    kept,
    onStop: null,
    get stopLeft() {
      return stopAt < 0 ? -1 : Math.max(0, Math.ceil((stopAt - world.tick) / TICK_RATE));
    },
    stopIn(seconds) {
      if (!host.onStop) return "this server was not started in a way that can stop itself";
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > RESTART_MOST) return `a stop is from 0 to ${RESTART_MOST} seconds ahead`;
      const ticks = Math.max(1, Math.round(seconds * TICK_RATE));
      stopAt = world.tick + ticks;
      game.sendRestart(Math.max(1, Math.ceil(ticks / TICK_RATE)));
      tellAll(`The server restarts in ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`} for an update. Stay on this page and you will be brought back.`);
      return "";
    },
    stopCancel() {
      if (stopAt < 0) return false;
      stopAt = -1;
      game.sendRestart(RESTART_OFF);
      tellAll("The server will not restart after all.");
      return true;
    },
    readLive,
    loadedUnder,
    projectiles,
    clouds,
    progression, activity, survivorLog,
    harvest,
    deadlines,
    persistence,
    loaded,
    console: con,
    bus,
    modules,
    adminPassword: opts.adminPassword || rules.text("ServerAdminPassword") || null,
    lists,
    get passed() {
      return [...contentPassed, ...spawnsPassed];
    },
    dev: opts.dev ?? false,
    spawnCreature,
    spawnVehicle,
    refreshBody,
    exec: (line, client) => con.exec({ host, client: client ?? null }, line),
    idle: () => persistence?.idle(),
    shutdown() {
      activity.checkpointAll();
      survivorLog.stop();
      // Told at once: there is no later tick to tell it in.
      bus.after(SERVER_STOP, { why: "stopped" });
      bus.flush();
      impale.stop();
      if (!persistence) return;
      // A creature in someone's arms is saved standing where it is set down, not where the arms had it, and so is whoever
      // sits in a car or on a creature.
      carry.releaseAll();
      urban.standDownAll();
      riding.standDownAll();
      // Every body that can have moved is saved where it stands.
      for (let r = 0; r < world.history.rows; r++) {
        const pid = world.ents.pid[world.history.tracked(r)]!;
        if (pid !== 0) records.dirty.add(pid);
      }
      persistence.commit(true);
      persistence.close();
      cluster?.stop();
    },
  };
  game.handle(CMD_VEHICLE, (c, r) => vehicles.command(c, r));
  game.handle(CMD_CLOCK, (c, r) => creative.turn(c, r));
  game.handle(CMD_PLACE, (c, r) => build.place(c, r));
  game.handle(CMD_STRUCT, (c, r) => build.act(c, r));
  game.handle(CMD_FEED, (c, r) => taming.feed(c, r));
  game.handle(CMD_ORDER, (c, r) => taming.order(c, r));
  game.handle(CMD_OPEN, (c, r) => taming.open(c, r));
  game.handle(CMD_NAME, (c, r) => taming.rename(c, r));
  game.handle(CMD_CARRY, (c, r) => carry.command(c, r));
  game.handle(CMD_EMOTE, (c, r) => emotes.command(c, r));
  game.handle(CMD_TAKE, (c, r) => {
    const which = r.u32();
    if (r.overflow) return RESULT_INVALID;
    const took = loose.take(c, which);
    return took >= 0 ? took : eggs.take(c, which);
  });
  game.handle(CMD_THROW, (c) => loose.command(c));
  game.handle(CMD_TRAVEL, (c, r) => {
    const to = r.u16();
    const at = r.u32();
    if (r.overflow || !cluster) return RESULT_INVALID;
    // A survivor travels from a terminal it stands at, as ARK's from an obelisk's.
    if (!cluster.atTerminal(c, at)) return RESULT_FAR;
    const why = cluster.leave(c, to);
    if (why === "") return RESULT_OK;
    game.sendText(c, TEXT_NOTICE, why);
    return RESULT_DENIED;
  });
  game.handle(CMD_CHAT, (c, r) => {
    const channel = r.bits(3);
    const words = r.string(MAX_CHAT_BYTES);
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
