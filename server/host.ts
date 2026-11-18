// Assembles a running world: map, records, persistence and the game loop. server/main.ts and the tests both use it.

import { withContent, type Registry } from "../shared/content/registry.ts";
import { CHOOSE_ARRIVED, CHOOSE_DIED, SESSION_DEAD, CMD_CARRY, CMD_CHAT, CMD_CLOSE, CMD_FAR, CMD_FEED, CMD_NAME, CMD_OPEN, CMD_ORDER, CMD_PLACE, CMD_STRUCT, CMD_TAKE, CMD_TEXT, CMD_TRAVEL, CMD_VEHICLE, MAX_CHAT_BYTES, MAX_TEXT_BYTES, RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OK, TEXT_CONSOLE, TEXT_MOTD, TEXT_NOTICE, REJECT_KICKED } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Genome } from "../shared/sim/genome.ts";
import { Build } from "./build.ts";
import { Motion } from "./motion.ts";
import { Fixtures } from "./fixtures.ts";
import { Beds } from "./beds.ts";
import { DEADLINE_TAME, Taming } from "./taming.ts";
import { Riding } from "./riding.ts";
import { Urban } from "./urban.ts";
import { foundVehicle, vehiclePlaceFree, VehicleService, VEHICLE_ORIGIN, type VehicleStart } from "./vehicle-service.ts";
import { vehicleRotation } from "../shared/sim/vehicle-frame.ts";
import { carShapes } from "../shared/world/vehicle-shapes.ts";
import { StaticVehicleSolids } from "../shared/world/vehicle-solid.ts";
import { isBoatVehicle, isRotorVehicle, isWheelVehicle } from "../shared/sim/vehicle.ts";
import { boatRestY } from "../shared/sim/boat.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { VehicleContacts } from "./vehicle-contacts.ts";
import { Entangle } from "./entangle.ts";
import { Breeding, DEADLINE_BREED } from "./breeding.ts";
import { Carry } from "./carry.ts";
import { Corpses, DEADLINE_CORPSE } from "./corpses.ts";
import { CorpseReplication } from "./corpse-motion.ts";
import { CMD_CORPSE } from "../shared/net/protocol.ts";
import { Eggs } from "./eggs.ts";
import { DEADLINE_FECES, Feces } from "./feces.ts";
import { Hurt } from "./hurt.ts";
import { Overhead } from "./overhead.ts";
import { growthStep, youngShare } from "../shared/sim/breeding.ts";
import { creatureAnims } from "../shared/anim/creature.ts";
import { buildRigs } from "../shared/anim/rigs.ts";
import type { CorpseImpact } from "../shared/anim/corpse.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { DEADLINE_FIRE, Stations } from "./stations.ts";
import { wirePower } from "./power.ts";
import { wirePreserve } from "./preserve.ts";
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
import { VehicleTrees } from "./vehicle-trees.ts";
import { DEADLINE_CRAFT, Progression } from "./progression.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { V_HEALTH } from "../shared/sim/vitals.ts";
import { ACT_EQUIP, ACT_NONE, FISTS, HOLD_CARRY } from "../shared/sim/weapon.ts";
import { GameServer, type Client, type GameOptions } from "./game.ts";
import { Items } from "./items.ts";
import { COMMAND_FAMILIES } from "./commands/families.ts";
import { addOwnCommands, syncOwn, type OwnContext } from "./own.ts";
import { Persistence, type LoadReport } from "./persist/persistence.ts";
import { Projectiles } from "./projectiles.ts";
import { Clouds } from "./clouds.ts";
import type { ModuleDef } from "./api/module.ts";
import { Bus, event } from "./events/bus.ts";
import { Modules } from "./events/modules.ts";
import { workerKeeper } from "./persist/keeper.ts";
import { WorldStore, type StoreOptions } from "./persist/store.ts";
import { Records, hashKey, type EntityRecord } from "./records.ts";
import { Use } from "./use.ts";
import { Rules, timersOf } from "./settings/rules.ts";
import { CATALOG, rowOf } from "./settings/catalog.ts";
import { Lists } from "./settings/lists.ts";
import { LIVE_FILE, applyLive, emptyReport, formatReport } from "./settings/config.ts";
import { difficultyOf, tuningOf, wildLevel } from "./settings/tune.ts";
import { deriveRegistry } from "../shared/content/tuning.ts";
import { hourOfDay, offsetForHour } from "../shared/sim/clock.ts";
import { CAUSE_WORDS, DEADLINE_VITALS, Survival, refreshMods } from "./survival.ts";
import { createMapWorld, provingFile, type ServerWorld } from "./world.ts";
import { settle, settleNear } from "./place.ts";
import { DEADLINE_SPAWN, Spawner, wildStep } from "./spawner.ts";
import { CarReturn, DEADLINE_CAR } from "./car-return.ts";
import { spawnTables } from "./settings/spawns.ts";
import { parseMap } from "../shared/world/mapfile.ts";
import { Tactical } from "./tactical.ts";
import type { ClipSet } from "../shared/anim/clip.ts";
import { defaultLook } from "../shared/anim/look.ts";
import { F_ALIVE, GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ON } from "../shared/sim/items.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import { Cluster } from "./cluster/cluster.ts";
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
}

/** Ticks between console lines accepted from one session. */
const TEXT_INTERVAL = 6;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export interface Host {
  readonly world: ServerWorld;
  /**
   * The map file the world stands on, for clients to fetch: HostOptions.map's bytes, or the proving ground's. Null for a world
   * made in code and handed to the host, and for a map given by its path, which is served from its file.
   */
  readonly mapFile: Uint8Array<ArrayBuffer> | null;
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
  readonly motion: Motion;
  readonly stations: Stations;
  readonly taming: Taming;
  readonly riding: Riding;
  readonly urban: Urban;
  readonly vehicles: VehicleService;
  readonly entangle: Entangle;
  readonly breeding: Breeding;
  readonly tactical: Tactical;
  /** The creature packages' modules, each still doing nothing. */
  readonly corpses: Corpses;
  readonly carry: Carry;
  readonly feces: Feces;
  readonly eggs: Eggs;
  readonly overhead: Overhead;
  readonly hurt: Hurt;
  /** Null unless the host was asked to keep the wild stocked, the map has spawn regions, and no -NoDinos flag is given. */
  readonly spawner: Spawner | null;
  /** Null for a map that parks no car. */
  readonly carReturn: CarReturn | null;
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
  const lists = new Lists(rules, content);
  // Settings that change content are applied to the definitions once, before anything reads them (D90). From here on `reg` is the only registry.
  const tuned = tuningOf(rules, lists, content);
  lists.warm();
  const derived = deriveRegistry(content, tuned.tuning);
  if (opts.world && opts.world.reg.hash !== derived.hash) throw new Error("a world made before its host must be made of the content the host's settings give: contentFor(content, rules)");
  const reg = opts.world ? opts.world.reg : derived;
  const storeOptions = { ...opts.store, allowNetworkDisk: opts.store?.allowNetworkDisk ?? rules.flag("AllowNetworkSave") === true };
  const store = opts.dbPath ? new WorldStore(opts.dbPath, reg, storeOptions) : null;
  if (store) opened.push(store);
  const mapFile = opts.world || typeof opts.map === "string" ? null : (opts.map ?? provingFile(reg));
  const parsed = given ?? (mapFile ? parseMap(mapFile) : null);
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
  const say = opts.log ?? ((line: string) => console.log(line));
  // Carries events to modules. Made before the systems, so that each can raise its own.
  const bus = new Bus();
  bus.log = say;
  if (opts.now) bus.now = opts.now;
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
  game.bus = bus;
  // A full world still has a place for every survivor that may join.
  world.ents.reserve = game.clients.length;
  /** Survivors made since they were last told of: a module hears of each once, as new. */
  const made = new Set<number>();
  const joined = (c: Client): void => {
    if (c.joined) return;
    c.joined = true;
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
  // One heap for every deadline. onStep dispatches the entries by kind.
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
    if (!loaded!.fresh) game.refusals.restore(persistence.store.meta("refused") as string | null);
    persistence.sidecar("refused", game.refusals);
    persistence.open = (path) => new WorldStore(path, reg, storeOptions);
  }
  const creatures = new Creatures(world, game, records, survival, opts.seed ?? 1, opts.wakeRadius ?? 3);
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
    rec.team = ownerTeam; rec.yaw = Math.round(yaw / (2 * Math.PI) * 65536) & 65535;
    world.ents.yaw[e] = rec.yaw;
    // Registered once turned, so the parked state it saves at once has its yaw.
    urban.register(e);
    const ents = world.ents, v = ents.vrow[e]!;
    ents.vehicleYaw[v] = Math.fround(yaw);
    ents.vehicleQy[v] = Math.fround(Math.sin(yaw / 2)); ents.vehicleQw[v] = Math.fround(Math.cos(yaw / 2));
    if (isWheelVehicle(def) && start.y === undefined) {
      // Fit the four tyre heights at the spawn heading. An authored deck/air placement keeps its supplied height.
      const sn = Math.sin(yaw), cs = Math.cos(yaw);
      const height = (side: number, along: number) => world.hf.heightAt(x + cs * side + sn * along, z - sn * side + cs * along);
      const w = def.spec.track / 2, l = def.spec.wheelbase / 2;
      const fl = height(-w, l), fr = height(w, l), rl = height(-w, -l), rr = height(w, -l);
      const cross = (fr + rr - fl - rl) / (4 * w), along = (fl + fr - rl - rr) / (4 * l);
      const normal = 1 / Math.hypot(cross, along, 1);
      const placedY = (fl + fr + rl + rr) / 4, travel = def.spec.suspensionTravel ?? .18;
      if (normal < 1 && normal >= def.spec.minGroundNormal && Math.abs(fl + rr - fr - rl) < travel && Math.abs(placedY - y) < travel) {
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
  const death = new Death({ world, game, records, items, survival, creatures, persistence, deadlines, rules, bus });
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
  const quiet = ["NoDinos", "NoDinosExceptForcedSpawn", "NoDinosExceptStreamingSpawn", "NoDinosExceptManualSpawn", "NoDinosExceptWaterSpawn"].some((f) => rules.flag(f) === true);
  const stocked = opts.wild && !quiet ? new Spawner({ world, game, records, creatures, items, survival, buffs, persistence, rules, deadlines, tables: spawns.tables }, (opts.seed ?? 1) + 101) : null;
  const spawner = stocked && stocked.regions.length > 0 ? stocked : null;
  // The save keeps the setting values its timers were computed under, so they can be re-timed under other rules.
  const loadedUnder = persistence && !loaded!.fresh ? timersOf(persistence.store.meta("settings_at")) : null;
  if (persistence) {
    const at = { dirty: true, version: rules.version, serialize: () => JSON.stringify({ timers: rules.timers() }) };
    persistence.sidecar("settings_at", at);
    settingsAt = at;
  }
  const combat = new Combat({ world, game, records, items, survival, progression, creatures, buffs, rules, lists, harvest, bus, rigs: opts.rigs }, (opts.seed ?? 1) + 53);
  death.eye = (e, out) => { combat.eye(e, out); };
  creatures.onStrike = (e) => combat.bite(e);
  game.bodyContacts.pve = () => rules.on("serverPVE");
  const tribes = new Tribes(world, records);
  tribes.rules = rules;
  tribes.bus = bus;
  if (persistence && !loaded!.fresh) tribes.restore(persistence.store.meta("tribes"));
  // What the cluster's folder says came and went that the save does not know is done again now, before anything resumes.
  cluster?.start(
    {
      reg,
      world,
      records,
      items,
      persistence: persistence!,
      rules,
      tribes,
      game,
      bus,
      mayLeave: (c, rec) => (rec.out ? "you are unconscious" : riding.riding(c) ? "get off your mount first: it stays here" : urban.riding(c) ? "get out of the vehicle first: it stays here" : carry.holding(c) >= 0 ? "put down what is in your arms first" : ""),
      suspend: (rec, off) => survival.suspend(rec, off),
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
  const taming = new Taming({ world, game, records, items, survival, buffs, rules, lists, tribes, deadlines, creatures, progression, onNotice: (pid, text) => notice(pid, text), openOf: (c) => death.openOf(c), refresh: (rec) => refreshBody(rec), onTamed: (rec) => {
    const e = records.entOf.get(rec.pid);
    spawner?.left(rec);
    // A new tame stays where it woke until ordered otherwise.
    if (e !== undefined) {
      creatures.mind.stay(e, 0xffffffff);
      creatures.claimed(e);
    }
  } }, (opts.seed ?? 1) + 71);
  // Its tribe may open a tamed creature while it is awake. Closing it reschedules its meal, because its food may have changed.
  death.canOpen = (c, rec) => rec.team !== 0 && tribes.may(records.byPid.get(c.pid), rec.team);
  death.onShut = (rec) => taming.meal(rec);
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
  if (trees) game.vehicleStep = trees.step;
  const urban = new Urban({ world, game, records, items, creatures, vehicleStep: game.vehicleStep, rigs: opts.rigs ?? [], refresh: (rec) => refreshBody(rec), may: urbanMay, tangled: rec => entangle.tangled(rec), damage: (rec, points, by) => survival.hurt(rec, points, by), collisionDamage: (rec, points, by) => combat.vehicleHurt(rec, points, by) });
  const vehicles = new VehicleService({ world, game, records, items, survival, urban,
    may: (actor, vehicle) => urbanMay(actor, vehicle, null),
    spawn: (kind, x, z, team, yaw, start) => parkVehicle(kind, x, z, team, yaw, "crafted", start),
    discard: e => { const pid = world.ents.pid[e]!; persistence?.detach(pid); creatures.remove(e); survival.forget(pid); records.delete(pid); },
  });
  death.canOpen = (c, rec) => {
    const actor = records.byPid.get(c.pid);
    return !!actor && (reg.vehicle[rec.kind] ? urbanMay(actor, rec, null) : rec.team !== 0 && tribes.may(actor, rec.team));
  };
  death.keepsBoatCargo = (c, e) => vehicles.keepsBoatCargo(c, e);
  game.onVehicleStep = e => urban.impact(e);
  urban.contacts = new VehicleContacts({
    world, records, combat, driverOf: e => urban.riderOf(e), pair: pair => urban.collisionPair(pair),
    parkingBrake: e => urban.parkingBrake(e),
    boarding: (actor, vehicle) => urban.boarding(actor, vehicle),
    anchored: (e, opposing) => {
      const vehicle = records.byPid.get(world.ents.pid[e]!);
      return !!vehicle && vehicle.team !== 0 && vehicle.team !== opposing.team &&
        rules.on("serverPVE") && opposing.team !== 0 && urban.parked(e);
    },
  });
  // The use button gets off a mount, and sets down what is in the arms.
  death.riding = (c) => urban.riding(c) || riding.riding(c) || carry.holding(c) >= 0;
  death.offMount = (c) => (urban.riding(c) ? urban.dismount(c) : riding.riding(c) ? riding.dismount(c) : void carry.drop(c));
  const breeding = new Breeding({ world, game, records, rules, lists, deadlines, creatures, persistence, full: (team) => taming.full(team), notice: (pid, text) => notice(pid, text), place: (rec) => death.place(rec), refresh: (rec) => refreshBody(rec), meal: (rec) => taming.meal(rec) }, (opts.seed ?? 1) + 89);
  taming.onMate = (rec, what) => breeding.order(rec, what);
  const corpses = new Corpses({ world, game, records, items, deadlines, rules, lists, progression, death }, (opts.seed ?? 1) + 103);
  death.corpses = combat.corpses = corpses;
  const carry = new Carry({ world, game, records, items, survival, creatures, tribes, refresh: (rec) => refreshBody(rec) });
  const eggs = new Eggs({ world, game, records, items, rules, deadlines, creatures, breeding, place: (rec) => death.place(rec) });
  const feces = new Feces({ world, records, items, deadlines, rules, eggs, place: (rec) => death.place(rec) }, (opts.seed ?? 1) + 107);
  const overhead = new Overhead({ world, records, breeding, game, survival, tribes });
  const hurt = new Hurt({ world, records, survival });
  taming.bred = (rec) => breeding.subject(rec);
  death.onRide = (c, e) => {
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
  combat.onHarm = (victim, points) => {
    taming.harmed(victim, points);
    hurt.harmed(victim, points);
  };
  const chat = new Chat({ game, records, rules, tribes, bus });
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
  const beds = new Beds({
    world, game, records, tribes, fixtures, rules, bus,
    // A death refills the survivor. One that arrives or travels comes as it left.
    rise: (c, p, why) => {
      const at = Number.isNaN(p.y) ? undefined : p.y;
      if (why === CHOOSE_DIED) return death.respawn(c, p.x, p.z, p.yaw, at);
      if (why === CHOOSE_ARRIVED && cluster) return cluster.rise(c, p.x, p.z, p.yaw, at);
      const rec = records.byPid.get(c.pid);
      if (!rec) return RESULT_INVALID;
      rec.dead = false;
      if (!game.revive(c, p.x, p.z, p.yaw, at)) {
        rec.dead = true;
        return RESULT_INVALID;
      }
      records.dirty.add(rec.pid);
      return RESULT_OK;
    },
    mayLeave: (c, rec) => (rec.out ? "you are unconscious" : riding.riding(c) ? "get off your mount first" : urban.riding(c) ? "get out of the vehicle first" : carry.holding(c) >= 0 ? "put down what is in your arms first" : ""),
    drop: (rec, x, y, z) => void death.dropAll(rec, x, y, z),
  });
  if (persistence && !loaded!.fresh) beds.restore(persistence.store.meta("beds"));
  persistence?.sidecar("beds", beds.saved);
  const build = new Build({ world, game, records, items, tribes, rules, fixtures, bus, motion: (ref) => motion.throw(ref), light: (ref) => stations.toggle(ref), bed: (c, ref, action, name) => beds.act(c, ref, action, name), spill: (x, y, z, name, owner) => death.spill(x, y, z, name, owner) });
  build.onPlaced = (by, ref) => beds.placed(by, ref);
  death.onUseBuilt = (c, ref) => build.use(c, ref);
  death.keepsBuilt = (c, ref) => build.keeps(c, ref);
  if (persistence && !loaded!.fresh) build.decay.restore(persistence.store.meta("decay"));
  persistence?.sidecar("decay", build.decay, DECAY_SAVE_TICKS);
  combat.onStructureHurt = (ref) => build.hurt(ref);
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
  combat.onFire = (c, rec, weapon, quality, ammo, draw) => projectiles.launch(c, rec, weapon, quality, ammo, draw);
  // A thrown thing with an ammo facet of its own flies and hits (the bola); any other is lobbed and goes off on its fuse.
  combat.onThrow = (c, rec, item, quality, draw) => (reg.ammoSpeed[item]! > 0 ? projectiles.fling(c, rec, item, quality, draw) : projectiles.lob(c, rec, item, quality));
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
    refreshBody(rec);
    taming.out(rec, out);
    const e = records.entOf.get(rec.pid);
    if (e !== undefined) creatures.knocked(e, out);
  };
  survival.onInjured = (rec, on) => void (on ? buffs.give(rec, injured) : buffs.take(rec, injured));
  buffs.onChange = (rec) => refreshBody(rec);
  const use = new Use({ world, game, records, items, survival, buffs });
  // E with nothing else to use picks a bush, else drinks the water the survivor stands in.
  death.onUse = (c) => void (harvest?.pick(c) || use.drink(c));
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
   * load, for a save made under other settings, and whenever a live rule changes. Spoilage and fires are computed only when read.
   * Their rules cannot change while the server runs, so they are re-timed only at a load, after being settled at the old values.
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
        // The registry as the save had it, for the spoil and fuel timings.
        const old = deriveRegistry(content, { ...tuned.tuning, spoil: spoilWas, fuel: fuelWas });
        items.table = old;
        stations.refuel(old, fuelWas, now.FuelConsumptionIntervalMultiplier!);
        items.respoil(old, spoilWas, now.GlobalSpoilingTimeMultiplier!);
        items.table = reg;
      }
    } else if (RATES.some((name) => wasAt(name) !== now[name])) {
      // The young's hunger is a rate that can change while the server runs. Each young creature is rated again and its meal rescheduled.
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
  /** In ticks. ARK reads its live file at every world save. */
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
      // A structure's record has no entity, and neither has carried young.
      if (rec.at >= 0 || reg.defs[rec.kind]?.type === "structure" || (rec.egg !== null && rec.egg.carrier !== 0)) continue;
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
    const forced = spawner.forced(persistence && !fresh ? persistence.store.meta("spawner") : null, Date.now() / 1000);
    const wiped = forced && !fresh ? spawner.wipe() : -1;
    spawner.begin(fresh || wiped >= 0);
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

  // A name belongs to the first device key that takes a body under it.
  game.authorize = (name, key) => {
    // Nobody joins a world that has not saved for a minute.
    if (persistence?.failing && world.tick - persistence.failing.since >= UNSAVED_REFUSE_TICKS) return false;
    const rec = recordOf(name);
    return !rec || !rec.keyHash || sameBytes(rec.keyHash, hashKey(key));
  };
  if (cluster) {
    game.arrive = (name, key, ticket) => (persistence?.failing && world.tick - persistence.failing.since >= UNSAVED_REFUSE_TICKS ? "this server has not been able to save for a minute, so nobody may come yet" : cluster.arrive(name, key, ticket));
    game.away = (name, key) => cluster.awayCheck(name, key);
  }
  // A survivor that came from another server and has not risen joins as one that died does: with no body, choosing where.
  game.savedPosition = (name) => {
    const rec = recordOf(name);
    return rec && cluster?.arriving.has(rec.pid) ? { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw, dead: true, team: rec.team } : (rec ?? null);
  };
  game.needsLook = (name) => !recordOf(name)?.look;
  game.onBody = (c) => {
    let rec = recordOf(c.name);
    const first = !rec;
    if (!rec) {
      rec = records.create(survivor, c.name);
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
  };
  game.onBodyGone = (c) => {
    carry.release(c.pid);
    // Seats are not saved: a survivor in a car or on a creature is saved standing beside it.
    urban.standDown(c.pid);
    riding.standDown(c.pid);
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
    // A survivor that joins dead gets no onBody call, so its pid is set here.
    if (c.pid === 0) c.pid = recordOf(c.name)?.pid ?? 0;
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
  };
  game.onPresence = (c) => {
    bus.after(SESSION_PRESENCE, { pid: c.pid, connected: !c.closed });
    tribes.version++;
    // The voice socket belonged to the old connection.
    voice.revoke(c);
  };
  game.onExit = (c) => {
    bus.after(SESSION_LEAVE, { pid: c.pid, why: c.left });
    tribes.version++;
    voice.revoke(c);
    moved(focus.get(c.id) ?? -1, -1);
    focus.delete(c.id);
  };
  game.onBeforeStep = () => { refreshInventories(); urban.beforeStep(); riding.beforeStep(); };
  const seatedHead = new Float64Array(3);
  game.onStep = (tick) => {
    for (const c of game.clients) {
      if (!c?.active) continue;
      const was = focus.get(c.id)!;
      if (c.chunk === was) continue;
      focus.set(c.id, c.chunk);
      moved(was, c.chunk);
    }
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
    deadlines.run(tick, (kind, pid, stamp) => {
      if (kind === DEADLINE_VITALS) survival.due(pid, stamp);
      else if (kind === DEADLINE_DESPAWN) death.despawn(pid, stamp);
      else if (kind === DEADLINE_CRAFT) progression.due(pid, stamp);
      else if (kind === DEADLINE_NODE) harvest?.due(pid, stamp);
      else if (kind === DEADLINE_BUFF) buffs.due(pid, stamp);
      else if (kind === DEADLINE_FIRE) stations.due(pid, stamp);
      else if (kind === DEADLINE_TAME) taming.due(pid, stamp);
      else if (kind === DEADLINE_BREED) breeding.due(pid, stamp);
      else if (kind === DEADLINE_SPAWN) spawner?.due(pid, stamp);
      else if (kind === DEADLINE_CORPSE) corpses.due(pid, stamp);
      else if (kind === DEADLINE_FECES) feces.due(pid, stamp);
      else if (kind === DEADLINE_CAR) carReturn?.due(pid, stamp);
    });
    refreshInventories();
    // Struggling, and the grace after a bola, once the buffs that came due have ended.
    entangle.step(tick);
    death.step();
    // Riders move with their mounts before combat aims at either.
    urban.step();
    riding.step();
    carry.step(tick);
    // Combat resolves this tick's swings and shots now that every body has moved.
    combat.step();
    projectiles.step();
    clouds.step();
    creatures.step(tick);
    for (const e of urban.contacts!.step()) { urban.syncAfterContact(e); riding.syncAfterContact(e); }
    spawner?.step(tick);
    build.step();
    taming.step();
    breeding.step(tick);
    feces.step(tick);
    overhead.step(tick);
    corpses.step(tick);
    hurt.step(tick);
    voice.step(tick);
    // A full entity store is logged when it first refuses, and then at most once a minute.
    if (world.ents.refused !== refusedTold && tick >= refusedNext) {
      say(`the world has no place for more bodies (${world.ents.refused - refusedTold} refused): it holds ${world.ents.count} of the ${world.ents.max} that MaxEntities allows, with ${world.ents.reserve} kept for survivors`);
      refusedTold = world.ents.refused;
      refusedNext = tick + 60 * TICK_RATE;
    }
    // The idle kick runs only with ARK's -EnableIdlePlayerKick.
    if (tick % TICK_RATE === 0 && rules.flag("EnableIdlePlayerKick") === true) {
      const most = Math.round(rules.num("KickIdlePlayersPeriod") * TICK_RATE);
      for (const c of game.clients) if (c?.active && !c.closed && tick - c.activeAt > most) game.reject(c, REJECT_KICKED);
    }
    // The report is logged only when the live file changed a rule.
    if (opts.live && tick % liveEvery === 0 && rules.flag("UseDynamicConfig") === true) {
      const before = rules.version;
      const said = readLive();
      if (rules.version !== before) for (const line of said) console.log(line);
    }
    if (retimedAt !== rules.version) {
      retimedAt = rules.version;
      retime(false);
    }
    // The next commit saves the values the timers now run under.
    if (settingsAt && settingsAt.version !== rules.version) {
      settingsAt.version = rules.version;
      settingsAt.dirty = true;
    }
    // What happened this tick is told to modules before it is committed.
    if (!started) bus.after(SERVER_START, { tick, map: world.mapId, fresh: loaded ? loaded.fresh : true });
    started = true;
    if (bus.n[SERVER_TICK] !== 0) bus.after(SERVER_TICK, { tick });
    if (tick % TICK_RATE === 0) bus.after(SERVER_SECOND, { tick });
    if (settingsToldAt !== rules.version) {
      // The first is the settings as they stood at start, which is not a change.
      if (settingsToldAt >= 0) bus.after(SERVER_SETTINGS, { names: "", source: "" });
      settingsToldAt = rules.version;
    }
    cluster?.step(tick);
    if (persistence && opts.backups && tick % liveEvery === 0) bus.after(SERVER_SAVE, { tick, folder: `${persistence.store.path}.backups` });
    modules.step(tick);
    bus.flush();
    refreshInventories();
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
  game.onFault = (c, op, command, err) => {
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
  // An unconscious survivor can talk, use the console, shut what it had open and say how far off it is sent bases. Its client
  // can make it do nothing else.
  game.allows = (c, op) => op === CMD_TEXT || op === CMD_CHAT || op === CMD_CLOSE || op === CMD_FAR || !records.byPid.get(c.pid)?.out;
  game.onLand = (c, speed) => {
    const rec = records.byPid.get(c.pid);
    if (rec) survival.landed(rec, speed);
  };
  const own: OwnContext = {
    world, game, records, items, survival, progression, rules, tribes, voice,
    use,
    online: (pid) => sessionOf(pid) !== null,
    openOf: (c) => death.openOf(c),
    closeOpen: (c) => death.close(c),
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
  game.onReplicate = (c) => {
    motion.sync(c);
    syncOwn(own, c);
    harvest?.sync(c);
    tactical.sync(c);
  };
  game.contactProxies = (c, out) => { if (c.drive >= 0) urban.contacts?.proxies(c.drive, out); };
  const corpseReplication = new CorpseReplication(game, corpses);
  game.onSnapshot = (c, view) => corpseReplication.sync(c, view);
  game.handle(CMD_CORPSE, (c, r) => corpseReplication.request(c, r));
  progression.onChange = (rec) => refreshBody(rec);
  addOwnCommands(own);

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
    const load = (rec.inv ? items.inv(rec).weight(items.table) : 0) + carried * reg.riderWeight[rec.kind]! + (arms >= 0 ? carry.load(rec) : 0);
    if (reg.vehicle[rec.kind]) world.ents.vehiclePayloadMass[world.ents.vrow[e]!] = Math.fround(urban.payloadMass(e));
    // A creature in someone's arms weighs on them.
    const carrier = carry.carrierOf(e);
    if (carrier && carrier !== rec) refreshBody(carrier);
    // Changing a rider's pack also changes the mount's load.
    const seat = world.ents.seat[e]! - 1;
    const mount = seat >= 0 && (riding.occupancy.seatOf(rec.pid)?.host === world.ents.pid[seat] || urban.occupancy.seatOf(rec.pid)?.host === world.ents.pid[seat]) ? records.byPid.get(world.ents.pid[seat]!) : undefined;
    if (mount && mount !== rec) refreshBody(mount);
    // A young creature carries a share of a grown one's capacity, so its load is scaled up.
    const strength = youngShare(growthStep(rec.span, rec.grown, world.tick));
    refreshMods(reg, world.ents, e, rec.genome, load / strength, buffs.speedOf(rec), buffs.rooted(rec), rec.out, creatures.swimGain);
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
      for (let k = 0; k < ARMOR_SLOTS; k++) gear[GEAR_WORN + k] = inv.item[inv.armor + k]!;
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
  const gear = new Uint16Array(GEAR_COUNT);
  /** The held slot of each record at its last refresh. */
  const inHand = new Map<number, number>();
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
  const host: Host = {
    world,
    mapFile,
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
    motion,
    stations,
    taming,
    riding,
    urban,
    vehicles,
    entangle,
    breeding,
    tactical,
    corpses,
    carry,
    feces,
    eggs,
    overhead,
    hurt,
    spawner,
    carReturn,
    beds,
    cluster,
    settled,
    online: (pid) => sessionOf(pid) !== null,
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
    clouds,
    progression,
    harvest,
    deadlines,
    persistence,
    loaded,
    console: con,
    bus,
    modules,
    adminPassword: opts.adminPassword || rules.text("ServerAdminPassword") || null,
    lists,
    passed: [...tuned.passed, ...spawns.passed],
    dev: opts.dev ?? false,
    spawnCreature,
    spawnVehicle,
    refreshBody,
    exec: (line, client) => con.exec({ host, client: client ?? null }, line),
    idle: () => persistence?.idle(),
    shutdown() {
      // Told at once: there is no later tick to tell it in.
      bus.after(SERVER_STOP, { why: "stopped" });
      bus.flush();
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
  game.handle(CMD_PLACE, (c, r) => build.place(c, r));
  game.handle(CMD_STRUCT, (c, r) => build.act(c, r));
  game.handle(CMD_FEED, (c, r) => taming.feed(c, r));
  game.handle(CMD_ORDER, (c, r) => taming.order(c, r));
  game.handle(CMD_OPEN, (c, r) => taming.open(c, r));
  game.handle(CMD_NAME, (c, r) => taming.rename(c, r));
  game.handle(CMD_CARRY, (c, r) => carry.command(c, r));
  game.handle(CMD_TAKE, (c, r) => eggs.take(c, r));
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
