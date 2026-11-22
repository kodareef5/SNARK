// The front door for a test of the game: a real server in a named place, survivors joined to it as clients, and the
// actions a player has. Recipes are in tests/COOKBOOK.md. What is here asks the server as a client or its console would;
// what it cannot do, the fixtures it stands on can (tests/fixtures/README.md).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { FILE_OF, GAME_FILE, SECTION_OF, loadConfig } from "../../server/settings/config.ts";
import type { Rules } from "../../server/settings/rules.ts";
import type { LevelsDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_FEED, CMD_MOVE, CMD_OPEN, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import type { Harness, Pilot } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { field, type Place, type Spot } from "./places.ts";
import { ScreenHarness } from "./screen.ts";

export * from "./places.ts";
export * from "./screen.ts";

const TICK_MS = 1000 / TICK_RATE;
const reg = coreRegistry();

/** A link a player far away on a poor line has. */
export const BAD_LINK: LinkOptions = { latencyMs: 120, jitterMs: 20, loss: 0.05 };

/** The content index of a name: "spear" is core:spear. */
export function id(name: string): number {
  const k = reg.index.get(name.includes(":") ? name : `core:${name}`);
  if (k === undefined) throw new Error(`the content has nothing called ${name}`);
  return k;
}

export interface SurvivorOptions {
  /** The line to the server: latency, jitter, loss. */
  link?: LinkOptions;
  /** Where it is put. Without one it stands where the server put it: a spawn point, or where the save has it. */
  at?: Spot;
  /** False leaves it a plain player. Everything below needs cheats. */
  cheats?: boolean;
  /** Nothing harms it. */
  god?: boolean;
  /** Kits by the console's names: "pistol", "bow", "tools", "hide". */
  gear?: readonly string[];
  /** Items and how many of each. */
  items?: Readonly<Record<string, number>>;
  level?: number;
  /** Founds this tribe, or joins it if a survivor within reach has founded it. */
  tribe?: string;
  /** Runs the whole app for it, with an interface and frames: see `screen`. */
  screen?: boolean;
}

export interface CampOptions extends SurvivorOptions {
  /** The flat field, where not given. */
  place?: Place;
  /** Settings by ARK's names, read as the server's files are. */
  rules?: Readonly<Record<string, string | number | boolean>>;
  /** Keeps the world in a save, for `restart`: true for a file of the kit's own, or a path. */
  save?: boolean | string;
  seed?: number;
  /** Frames a second each client runs at. */
  fps?: number;
  host?: HostOptions;
}

export interface Camp {
  h: ScreenHarness;
  /** The first survivor's client. */
  ada: ClientSession;
  /** Its record on the server. */
  me: EntityRecord;
  /** Where it stands. */
  at: { x: number; y: number; z: number };
}

interface Started {
  host: HostOptions;
  seed: number;
  fps: number;
}
const STARTED = new WeakMap<Harness, Started>();

let saves: string | null = null;
let saved = 0;

/** A new save file's path, in a folder removed when the process ends. */
function saveFile(): string {
  if (saves === null) {
    const dir = (saves = mkdtempSync(join(tmpdir(), "snark-kit-")));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  }
  return join(saves, `${saved++}.db`);
}

/** Rules from settings by name, each written to the file and section it belongs in. A setting the server would not take throws. */
export function rules(settings: Readonly<Record<string, string | number | boolean>>): Rules {
  const text: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(settings)) {
    const row = rowOf(name);
    if (!row) throw new Error(`there is no setting called ${name}`);
    (text[FILE_OF[row.at]] ??= []).push(SECTION_OF[row.at], `${name}=${typeof value === "boolean" ? (value ? "True" : "False") : value}`);
  }
  const { [GAME_FILE]: game, ...rest } = text;
  const gus = Object.values(rest).flat();
  const made = loadConfig({ ...(gus.length ? { gus: gus.join("\n") } : {}), ...(game ? { game: game.join("\n") } : {}) });
  const wrong = [...made.report.refused.map((r) => `${r.key}: ${r.why}`), ...made.report.unknown.map((u) => `${u.key}: unknown`), ...made.report.waiting.map((w) => `${w.row.name}: not effective yet`)];
  if (wrong.length > 0) throw new Error(`settings the server would not take: ${wrong.join("; ")}`);
  return made.rules;
}

/** A development server in a place, and ada standing there with cheats on. */
export function camp(o: CampOptions = {}): Camp {
  const place = o.place ?? field();
  const db = o.save === true ? saveFile() : o.save || undefined;
  const host: HostOptions = { dev: true, ...(place.map ? { map: place.map } : {}), ...(db ? { dbPath: db } : {}), ...(o.rules ? { config: rules(o.rules) } : {}), ...o.host };
  const started = { host, seed: o.seed ?? 1, fps: o.fps ?? 60 };
  const h = new ScreenHarness({}, started.seed, started.fps, host);
  STARTED.set(h, started);
  const ada = survivor(h, "ada", o);
  const to = place.at(h);
  const e = h.ent(ada);
  // A map's own spawn point is where its place says to stand; the proving ground's level ground is reached by teleport.
  if (o.at === undefined && Math.hypot(h.world.ents.x[e]! - to.x, h.world.ents.z[e]! - to.z) > 0.5) put(h, ada, to);
  return { h, ada, me: record(h, ada), at: pos(h, ada) };
}

/** The server stopped and started again on the same save, with the same place and settings. Nobody is joined: `survivor` joins one again. */
export function restart(h: Harness): ScreenHarness {
  const started = STARTED.get(h);
  if (!started?.host.dbPath) throw new Error("only a camp with a save can restart: camp({ save: true })");
  h.host.shutdown();
  const next = new ScreenHarness({}, started.seed, started.fps, { ...started.host, config: h.host.rules });
  STARTED.set(next, started);
  return next;
}

/** What the console answered, or an error naming the line, unless it began as it should. */
function told(h: Harness, s: ClientSession, line: string, begins: string): string {
  const said = h.say(s, line);
  if (!said[0]?.startsWith(begins)) throw new Error(`"${line}" as ${s.name}: ${said.join(" / ") || "no answer"}`);
  return said[0];
}

/** Teleports a survivor with cheats to stand on the ground at a spot. */
export function put(h: Harness, s: ClientSession, at: Spot): void {
  told(h, s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`, "at ");
}

/** Joins a survivor and waits until it stands in the world, then gives it what was asked for through the console. */
export function survivor(h: Harness, name: string, o: SurvivorOptions = {}): ClientSession {
  if (o.screen && !(h instanceof ScreenHarness)) throw new Error("a screen needs a harness made by camp()");
  const s = o.screen ? (h as ScreenHarness).open(name, o.link) : h.join(name, o.link);
  h.run(500);
  if (!until(h, () => s.state === "active" && s.inventory !== null, 10)) throw new Error(`${name} did not join: ${s.state} ${s.closeText}`);
  if (o.cheats === false) return s;
  told(h, s, "enablecheats", "cheats enabled");
  if (o.at) put(h, s, o.at);
  if (o.god) told(h, s, "god", "god on");
  for (const kit of o.gear ?? []) told(h, s, `kit ${kit}`, "gave ");
  for (const [item, n] of Object.entries(o.items ?? {})) told(h, s, `give ${reg.ids[id(item)]} ${n}`, `gave ${n} `);
  if (o.level !== undefined && o.level > 1) {
    const table = (reg.defs.find((d) => d?.type === "levels") as LevelsDef).xp;
    told(h, s, `addxp ${table[o.level - 1]! - record(h, s).xp}`, `level ${o.level},`);
  }
  if (o.tribe !== undefined) {
    const founder = h.sessions.find((other) => other !== s && other.tribe.name === o.tribe);
    if (!founder) told(h, s, `tribe create "${o.tribe}"`, "You founded");
    else {
      h.say(founder, `tribe invite ${name}`);
      told(h, s, "tribe accept", "You joined");
    }
  }
  return s;
}

/** A survivor's record on the server: its owner, team, vitals, experience. */
export function record(h: Harness, s: ClientSession): EntityRecord {
  return h.host.records.byPid.get(h.client(s)!.pid)!;
}

/** How many of an item a survivor carries, as the server has it. */
export function count(h: Harness, s: ClientSession, item: string): number {
  return h.host.items.inv(record(h, s)).total(id(item));
}

/** Where the server has an entity, or a survivor's body. */
export function pos(h: Harness, of: number | ClientSession): { x: number; y: number; z: number } {
  const e = typeof of === "number" ? of : h.ent(of);
  const ents = h.world.ents;
  return { x: ents.x[e]!, y: ents.y[e]!, z: ents.z[e]! };
}

/** The keys and look a survivor's client sends each frame. */
export function pilot(h: Harness, s: ClientSession): Pilot {
  return (h instanceof ScreenHarness ? h.screens.get(s)?.app.controls : undefined) ?? h.pilots[h.sessions.indexOf(s)]!;
}

/** Runs until `done` or for so many seconds of the world's time, a tick at a go. Returns whether it was done. */
export function until(h: Harness, done: () => boolean, seconds = 30): boolean {
  for (let left = seconds * TICK_RATE; left > 0 && !done(); left--) h.run(TICK_MS);
  return done();
}

/** Turns a survivor's look to an entity's middle, or to a point (on the ground, without a y). */
export function look(h: Harness, s: ClientSession, at: number | { x: number; y?: number; z: number }): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const to = typeof at === "number" ? { ...pos(h, at), y: ents.y[at]! + reg.bodyHeight[ents.kind[at]!]! * 0.5 } : { ...at, y: at.y ?? h.world.hf.heightAt(at.x, at.z) };
  const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, ents.stance[me]!);
  const dx = to.x - ents.x[me]!;
  const dz = to.z - ents.z[me]!;
  const p = pilot(h, s);
  p.yaw = Math.atan2(dx, dz);
  p.pitch = Math.atan2(to.y - eye, Math.hypot(dx, dz));
  h.run(150);
}

/** Walks a survivor straight to a spot with the forward key. Returns whether it got within half a metre in the time. */
export function walk(h: Harness, s: ClientSession, to: Spot, seconds = 30): boolean {
  const p = pilot(h, s);
  const left = (): number => Math.hypot(to.x - pos(h, s).x, to.z - pos(h, s).z);
  p.pitch = 0;
  p.moveZ = 1;
  const there = until(h, () => ((p.yaw = Math.atan2(to.x - pos(h, s).x, to.z - pos(h, s).z)), left() < 0.5), seconds);
  p.moveZ = 0;
  h.run(300);
  return there;
}

/** Holds buttons (BTN_ constants) down for so many ticks and lets go. */
export function press(h: Harness, s: ClientSession, buttons: number, ticks = 3): void {
  const p = pilot(h, s);
  p.buttons |= buttons;
  h.run(ticks * TICK_MS);
  p.buttons &= ~buttons;
  h.run(200);
}

/** Looks at an entity and presses the use key. Returns the result the server sent for it, or -1 if it sent none. */
export function use(h: Harness, s: ClientSession, e: number): number {
  look(h, s, e);
  const was = s.onResult;
  let code = -1;
  s.onResult = (seq, c) => void (seq === 0 && (code = c));
  press(h, s, BTN_USE);
  s.onResult = was;
  return code;
}

/** Sends a command (a CMD_ constant, with what it carries) and returns the server's result for it, or -1 if none came. */
export function send(h: Harness, s: ClientSession, op: number, write?: (w: BitWriter) => void): number {
  const was = s.onResult;
  let code = -1;
  const sent = s.command(op, write);
  s.onResult = (seq, c) => void (seq === sent && (code = c));
  until(h, () => code >= 0, 2);
  s.onResult = was;
  return code;
}

export interface Body {
  /** The entity's index on the server. */
  e: number;
  rec: EntityRecord;
}

/** A wild creature at a spot, standing still until something disturbs it. */
export function creature(h: Harness, species: string, at: Spot, level = 1): Body {
  const e = h.host.spawnCreature(reg.ids[id(species)]!, at.x, at.z, level);
  if (e < 0) throw new Error(`no room for a ${species} at ${at.x}, ${at.z}`);
  h.host.creatures.mind.stay(e, h.world.tick + 30 * TICK_RATE);
  h.run(100);
  return { e, rec: h.host.records.byPid.get(h.world.ents.pid[e]!)! };
}

/**
 * A creature a survivor with cheats owns, 3 m in front of it or at a spot in its sight: forced tame at the console, and
 * with `saddled` its saddle put on through its inventory, for which it must be within reach.
 */
export function tame(h: Harness, s: ClientSession, species: string, o: { at?: Spot; level?: number; saddled?: boolean } = {}): Body {
  const me = pos(h, s);
  const yaw = pilot(h, s).yaw;
  const made = creature(h, species, o.at ?? { x: me.x + Math.sin(yaw) * 3, z: me.z + Math.cos(yaw) * 3 }, o.level);
  look(h, s, made.e);
  told(h, s, "forcetame", "tamed ");
  if (o.saddled) {
    const saddle = reg.saddleFits.indexOf(made.rec.kind);
    if (saddle <= 0) throw new Error(`no saddle fits a ${species}`);
    told(h, s, `give ${reg.ids[saddle]} 1`, "gave 1 ");
    const from = s.inventory!.item.indexOf(saddle);
    const opened = send(h, s, CMD_OPEN, (w) => w.u32(made.e));
    const moved = send(h, s, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(0), w.u16(saddle)));
    const worn = send(h, s, CMD_FEED, (w) => (w.varint(0), w.u16(saddle)));
    send(h, s, CMD_CLOSE);
    if (made.rec.saddle !== saddle) throw new Error(`the ${species} was not saddled: open ${opened}, move ${moved}, wear ${worn}`);
  }
  return made;
}

/** Gets a survivor onto a saddled creature of its tribe, or into the nearest seat of a vehicle, with the use key. */
export function ride(h: Harness, s: ClientSession, e: number): void {
  const code = use(h, s, e);
  if (!until(h, () => s.driving === e || h.world.ents.seat[h.ent(s)] === e + 1, 3)) throw new Error(`${s.name} did not get on: result ${code}`);
}

/**
 * A vehicle a survivor's tribe owns, parked 6 m in front of it or at a spot. With `drive` the survivor is put at its
 * driver's door and gets in with the use key.
 */
export function vehicle(h: Harness, s: ClientSession, kind: string, o: { at?: Spot; yaw?: number; drive?: boolean } = {}): Body {
  const me = pos(h, s);
  const yaw = o.yaw ?? pilot(h, s).yaw;
  const at = o.at ?? { x: me.x + Math.sin(yaw) * 6, z: me.z + Math.cos(yaw) * 6 };
  const e = h.host.spawnVehicle(reg.ids[id(kind)]!, at.x, at.z, record(h, s).team, yaw);
  if (e < 0) throw new Error(`no room for a ${kind} at ${at.x}, ${at.z}`);
  h.run(500);
  if (o.drive) drive(h, s, e);
  return { e, rec: h.host.records.byPid.get(h.world.ents.pid[e]!)! };
}

/** Puts a survivor with cheats at a vehicle's driver's door and gets it in with the use key. */
export function drive(h: Harness, s: ClientSession, e: number): void {
  const def = reg.vehicle[h.world.ents.kind[e]!]!;
  const door = [0, 0, 0];
  h.host.urban.door(e, def.seats.find((seat) => seat.driver)!, reg.move[id("survivor")]!.radius, door);
  put(h, s, { x: door[0]!, z: door[2]! });
  ride(h, s, e);
  if (!until(h, () => s.driving === e, 3)) throw new Error(`${s.name} is in the ${def.id ?? "vehicle"}, but not at its wheel`);
}

/** The first entity of a kind in the world: a car a map parked, a creature. */
export function find(h: Harness, kind: string): Body {
  const k = id(kind);
  for (const rec of h.host.records.byPid.values()) {
    const e = h.host.records.entOf.get(rec.pid);
    if (rec.kind === k && e !== undefined) return { e, rec };
  }
  throw new Error(`the world has no ${kind}`);
}

export { RESULT_OK };
