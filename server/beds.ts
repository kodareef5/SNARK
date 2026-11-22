// Where a survivor without a body may rise: the map's spawn points, then its tribe's beds and its own sleeping bags. Why it
// chooses (it died, it arrived from another server, it travels from a bed) is a parameter of the list and of the rising. Every
// place is judged again when it is chosen, so a bed taken, destroyed, built over or walled in meanwhile is refused.

import type { ItemDef, StructureDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { CHOOSE_DIED, CHOOSE_TRAVEL, MAX_NAME_BYTES, OWN_RESPAWN, OWN_SLOTS, RESULT_DENIED, RESULT_INVALID, RESULT_OBSTRUCTED, RESULT_OK, RESULT_STALE, RESULT_WAIT, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { HIT_STRUCTURE, castWorld, rayHit } from "../shared/world/ray.ts";
import { GONE_TAKEN } from "../shared/world/structures.ts";
import { STRUCT_NAME, STRUCT_TRAVEL } from "../shared/world/upkeep.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event, type Bus } from "./events/bus.ts";

const SESSION_RESPAWN = event("session.respawn");
const NAME_SET = event("name.set");

/** A place is chosen by one byte, so that is how many a list holds: the map's spawn points first. */
export const MAX_PLACES = 255;
/** In ticks. The simple bed's wait, the one a bed whose kind gives none has. */
export const BED_WAIT_TICKS = 5 * 60 * TICK_RATE;
/**
 * On a PvP server a survivor rising at a sleeping bag puts its other bags this near on a wait (ARK 181.0). Neither number is
 * public: the radius is chosen, and the wait is the simple bed's.
 */
export const BAG_NEAR = 100;
/** A bed is walled in when every one of this many ways out, level, meets another tribe's piece within WALLED_REACH metres. */
const WALLED_WAYS = 8;
const WALLED_REACH = 16;
/** Metres above where it stands that the ways out are looked along: a survivor's chest. */
const WALLED_UP = 1.2;

/** Letters, digits, spaces and a few marks, as a creature's name is cleaned. */
const cleanName = (text: string): string => text.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, MAX_NAME_BYTES);

export interface Place {
  /** The bed's structure kind, or 0 for a spawn point. */
  kind: number;
  /** The bed's structure ref and its record's id, or -1 and 0 for a spawn point. */
  ref: number;
  pid: number;
  name: string;
  x: number;
  /** NaN for a spawn point: a body is put on the ground around it. */
  y: number;
  z: number;
  yaw: number;
  /** The tick it may be risen at from, 0 for now. */
  readyAt: number;
}

export interface BedsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly tribes: Tribes;
  readonly fixtures: Fixtures;
  readonly rules: Rules;
  readonly bus: Bus;
  /** Puts the session's survivor in the world at a place: a death refills it, any other way it comes as it was. A RESULT code. */
  rise(c: Client, place: Place, why: number): number;
  /** Why the survivor may not leave its body now, or "": it rides, or holds a creature. */
  mayLeave(c: Client, rec: EntityRecord): string;
  /** Leaves everything the survivor carries in a bag at a point (Death.dropAll). */
  drop(rec: EntityRecord, x: number, y: number, z: number): void;
}

/** A survivor's repeated deaths at the hands of other tribes, for the PvP respawn wait: how many, the last, and the wait's end. */
interface Killed {
  n: number;
  at: number;
  until: number;
}

export class Beds {
  /** The parts of a choosing survivor's list that change other than by time: what is built, who is in which tribe, and this. */
  private changes = 0;
  /** By a sleeping bag's record id, the survivor who set it down. */
  private readonly owners = new Map<number, number>();
  /** By a survivor travelling from a bed, that bed's record id. */
  private readonly travelling = new Map<number, number>();
  private readonly killed = new Map<number, Killed>();
  /** Saved with the world, in the same commit as the records it names. */
  readonly saved = { dirty: false, serialize: (): string => this.serialize() };
  private readonly ctx: BedsContext;

  constructor(ctx: BedsContext) {
    this.ctx = ctx;
  }

  /** A survivor without a body is sent its list again whenever this changes. */
  get version(): number {
    return this.changes + this.ctx.fixtures.version + this.ctx.tribes.version;
  }

  private def(kind: number): StructureDef {
    return this.ctx.world.reg.defs[kind] as StructureDef;
  }

  /** The bed whose record is `rec`, as a place, or null if its structure is gone or is no bed. */
  private placeOf(ref: number, rec: EntityRecord): Place | null {
    const world = this.ctx.world;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high) return null;
    const kind = t.kind[slot]!;
    if (world.reg.isBed[kind] !== 1) return null;
    // On top of it, facing the way it does, or where its kind says, turned with it.
    const yaw = (t.yaw[slot]! / 65536) * 2 * Math.PI;
    const [ox, oy, oz] = this.def(kind).rise ?? [0, world.reg.halfY[kind]!, 0];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { kind, ref, pid: rec.pid, name: rec.name, x: t.x[slot]! + ox * c + oz * s, y: t.y[slot]! + oy, z: t.z[slot]! - ox * s + oz * c, yaw, readyAt: rec.readyAt > world.tick ? rec.readyAt : 0 };
  }

  /** Whether `rec` may rise at the bed at `ref` whose record is `bed`: its tribe's, and a sleeping bag only its own. */
  private mayUse(rec: EntityRecord, ref: number, bed: EntityRecord): boolean {
    const t = this.ctx.world.structs.chunks[Math.floor(ref / 65536)];
    if (!t || !this.ctx.tribes.may(rec, t.owner[ref & 0xffff]!)) return false;
    const owner = this.owners.get(bed.pid);
    return !this.def(t.kind[ref & 0xffff]!).once || owner === undefined || owner === rec.pid;
  }

  /**
   * Where `rec` may rise. After a death or an arrival: the map's spawn points, then its beds. Travelling: its beds, the one it
   * left first and ready for it (to go back is to stay); the spawn points only if no bed is left. At most MAX_PLACES.
   */
  places(rec: EntityRecord, why: number): Place[] {
    const { world, fixtures } = this.ctx;
    const spawns = (): Place[] => world.spawns.map((p) => ({ kind: 0, ref: -1, pid: 0, name: p.name, x: p.x, y: NaN, z: p.z, yaw: p.yaw, readyAt: 0 }));
    const out: Place[] = why === CHOOSE_TRAVEL ? [] : spawns();
    const from = why === CHOOSE_TRAVEL ? (this.travelling.get(rec.pid) ?? 0) : 0;
    fixtures.each((ref, bed) => {
      if (out.length >= MAX_PLACES || !this.mayUse(rec, ref, bed)) return;
      const place = this.placeOf(ref, bed);
      if (!place) return;
      if (bed.pid === from) out.unshift({ ...place, readyAt: 0 });
      else out.push(place);
    });
    if (out.length === 0) out.push(...spawns());
    // After deaths at another tribe's hands on a PvP server, every place waits too.
    const until = why === CHOOSE_DIED ? this.killedUntil(rec) : 0;
    if (until > world.tick) for (const p of out) p.readyAt = Math.max(p.readyAt, until);
    return out;
  }

  /** Why the survivor of `pid`, with no body as it joins, chooses: it travels from a bed, or it died. */
  whyOf(pid: number): number {
    return this.travelling.has(pid) ? CHOOSE_TRAVEL : CHOOSE_DIED;
  }

  /** The survivor of `c` rises at the place its list `list` has at `index`. Returns a RESULT code. */
  choose(c: Client, index: number, list: number): number {
    const listed = c.respawnAt[index];
    if (list !== c.placesList || c.sent[OWN_RESPAWN] === undefined) return RESULT_STALE;
    if (!listed) return RESULT_INVALID;
    const { world, records, fixtures, bus } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return RESULT_INVALID;
    // A bed must still stand, as the same bed, and still be one it may use. The list is judged as it is now.
    const bed = listed.ref >= 0 ? fixtures.find(listed.ref) : null;
    if (listed.ref >= 0 && (!bed || bed.pid !== listed.pid || !this.mayUse(rec, listed.ref, bed))) return RESULT_INVALID;
    const now = bed ? this.placeOf(listed.ref, bed) : listed;
    if (!now) return RESULT_INVALID;
    const back = c.why === CHOOSE_TRAVEL && bed !== null && bed.pid === this.travelling.get(rec.pid);
    const until = c.why === CHOOSE_DIED ? this.killedUntil(rec) : 0;
    const readyAt = Math.max(back ? 0 : now.readyAt, until);
    // A module may refuse the place, or make the survivor wait: `wait` is seconds, and more than none refuses for now.
    const asked = { pid: c.pid, bed: listed.ref, wait: Math.max(0, Math.ceil((readyAt - world.tick) / TICK_RATE)) };
    if (bus.before(SESSION_RESPAWN, asked) !== "") return RESULT_DENIED;
    if (asked.wait > 0) return RESULT_WAIT;
    if (bed && this.walledIn(rec, now)) return RESULT_OBSTRUCTED;
    const code = this.ctx.rise(c, now, c.why);
    if (code !== RESULT_OK) return code;
    if (this.travelling.delete(rec.pid)) this.saved.dirty = true;
    if (bed && !back) this.used(rec, listed.ref, bed);
    this.changes++;
    return RESULT_OK;
  }

  /** A survivor rose at a bed: it waits, or a sleeping bag is gone, and on a PvP server its owner's bags near it wait too. */
  private used(rec: EntityRecord, ref: number, bed: EntityRecord): void {
    const { world, records, fixtures, rules } = this.ctx;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const def = this.def(t.kind[ref & 0xffff]!);
    const wait = def.wait !== undefined ? Math.round(def.wait * TICK_RATE) : BED_WAIT_TICKS;
    if (!def.once) {
      bed.readyAt = world.tick + wait;
      records.dirty.add(bed.pid);
      return;
    }
    const x = t.x[ref & 0xffff]!;
    const z = t.z[ref & 0xffff]!;
    this.owners.delete(bed.pid);
    this.saved.dirty = true;
    world.structs.remove(ref, GONE_TAKEN, world.tick);
    if (rules.on("serverPVE")) return;
    fixtures.each((other, rest) => {
      const k = world.structs.chunks[Math.floor(other / 65536)]!;
      const s = other & 0xffff;
      if (!this.def(k.kind[s]!).once || this.owners.get(rest.pid) !== rec.pid || Math.hypot(k.x[s]! - x, k.z[s]! - z) > BAG_NEAR) return;
      rest.readyAt = Math.max(rest.readyAt, world.tick + wait);
      records.dirty.add(rest.pid);
    });
  }

  /** Whether every way out of a place, level with a survivor's chest, meets another tribe's piece before WALLED_REACH. */
  private walledIn(rec: EntityRecord, p: Place): boolean {
    const world = this.ctx.world;
    for (let k = 0; k < WALLED_WAYS; k++) {
      const a = (k / WALLED_WAYS) * 2 * Math.PI;
      if (castWorld(world, p.x, p.y + WALLED_UP, p.z, Math.sin(a), 0, Math.cos(a), WALLED_REACH) !== HIT_STRUCTURE) return false;
      const t = world.structs.chunks[Math.floor(rayHit.ref / 65536)]!;
      const owner = t.owner[rayHit.ref & 0xffff]!;
      if (owner === 0 || this.ctx.tribes.may(rec, owner)) return false;
    }
    return true;
  }

  /** A STRUCT_NAME or STRUCT_TRAVEL on the bed at `ref`, by a survivor of its tribe within reach of it. Returns a RESULT code. */
  act(c: Client, ref: number, action: number, words: string): number {
    const { records, fixtures, bus, game } = this.ctx;
    const rec = records.byPid.get(c.pid);
    const bed = fixtures.ensure(ref);
    if (!rec) return RESULT_INVALID;
    if (action === STRUCT_NAME) {
      // A module may refuse the name or reword it. None gives the bed its kind's name.
      const asked = { what: "bed", text: cleanName(words) };
      if (bus.before(NAME_SET, asked) !== "") return RESULT_DENIED;
      const clean = cleanName(String(asked.text));
      bed.name = clean !== "" ? clean : this.label(ref);
      records.dirty.add(bed.pid);
      this.changes++;
      return RESULT_OK;
    }
    if (action !== STRUCT_TRAVEL) return RESULT_INVALID;
    if (!this.mayUse(rec, ref, bed)) return RESULT_DENIED;
    const why = this.ctx.mayLeave(c, rec);
    if (why !== "") {
      game.sendText(c, TEXT_NOTICE, why);
      return RESULT_DENIED;
    }
    // There must be somewhere else to go.
    this.travelling.set(rec.pid, bed.pid);
    const elsewhere = this.places(rec, CHOOSE_TRAVEL).some((p) => p.ref >= 0 && p.pid !== bed.pid);
    if (!elsewhere) {
      this.travelling.delete(rec.pid);
      game.sendText(c, TEXT_NOTICE, "Your tribe has no other bed to travel to.");
      return RESULT_INVALID;
    }
    // What it carries stays at the bed it leaves, as ARK has it, and it chooses with no body.
    const at = this.placeOf(ref, bed)!;
    this.ctx.drop(rec, at.x, at.y, at.z);
    rec.dead = true;
    records.dirty.add(rec.pid);
    game.sessions.kill(c);
    // Its inventory is a new one now, so the whole of it is sent again, as after a death.
    c.sent[OWN_SLOTS] = undefined;
    c.why = CHOOSE_TRAVEL;
    c.sent[OWN_RESPAWN] = undefined;
    this.saved.dirty = true;
    this.changes++;
    return RESULT_OK;
  }

  /** A bed was set down by `by`. A sleeping bag is its alone. */
  placed(by: EntityRecord, ref: number): void {
    const t = this.ctx.world.structs.chunks[Math.floor(ref / 65536)]!;
    if (!this.def(t.kind[ref & 0xffff]!).once) return;
    this.owners.set(this.ctx.fixtures.ensure(ref).pid, by.pid);
    this.saved.dirty = true;
  }

  /**
   * A survivor died. On a PvP server, killed by another tribe's within IncreasePvPRespawnIntervalCheckPeriod of the last time
   * it was, it waits to rise: the base amount, then that times the multiplier for each time more (ARK 196.0).
   */
  died(rec: EntityRecord, killerTeam: number): void {
    const { world, rules, tribes } = this.ctx;
    if (rules.on("serverPVE") || !rules.on("bIncreasePvPRespawnInterval") || killerTeam === 0 || tribes.may(rec, killerTeam)) return;
    const was = this.killed.get(rec.pid);
    const n = was && world.tick - was.at <= rules.num("IncreasePvPRespawnIntervalCheckPeriod") * TICK_RATE ? was.n + 1 : 1;
    const wait = n < 2 ? 0 : rules.num("IncreasePvPRespawnIntervalBaseAmount") * rules.num("IncreasePvPRespawnIntervalMultiplier") ** (n - 2);
    this.killed.set(rec.pid, { n, at: world.tick, until: wait > 0 ? world.tick + Math.round(wait * TICK_RATE) : 0 });
    this.saved.dirty = true;
  }

  /** The tick the PvP respawn wait of `rec` ends, while the rules give one. */
  private killedUntil(rec: EntityRecord): number {
    const rules = this.ctx.rules;
    return rules.on("serverPVE") || !rules.on("bIncreasePvPRespawnInterval") ? 0 : (this.killed.get(rec.pid)?.until ?? 0);
  }

  /** What a bed of the kind at `ref` is called until it is named. */
  private label(ref: number): string {
    const reg = this.ctx.world.reg;
    const t = this.ctx.world.structs.chunks[Math.floor(ref / 65536)]!;
    const item = reg.pieceItem[t.kind[ref & 0xffff]!]!;
    return item !== 0 ? ((reg.defs[item] as ItemDef).label ?? "") : "";
  }

  private serialize(): string {
    const records = this.ctx.records;
    const live = (pid: number): boolean => records.byPid.has(pid);
    const tick = this.ctx.world.tick;
    return JSON.stringify({
      owners: [...this.owners].filter(([bag]) => live(bag)),
      travelling: [...this.travelling].filter(([pid]) => live(pid)),
      killed: [...this.killed].filter(([pid, k]) => live(pid) && (k.until > tick || tick - k.at <= this.ctx.rules.num("IncreasePvPRespawnIntervalCheckPeriod") * TICK_RATE)).map(([pid, k]) => [pid, k.n, k.at, k.until]),
    });
  }

  /** After a load. What names a record that is gone is forgotten. */
  restore(saved: string | number | null): void {
    if (typeof saved !== "string") return;
    let parsed: { owners?: unknown; travelling?: unknown; killed?: unknown };
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    const pairs = (v: unknown): number[][] => (Array.isArray(v) ? v.filter((e): e is number[] => Array.isArray(e) && e.every((n) => typeof n === "number")) : []);
    const records = this.ctx.records;
    for (const [bag, by] of pairs(parsed.owners)) if (records.byPid.has(bag!)) this.owners.set(bag!, by!);
    // A survivor that has a body is not travelling, whatever was saved.
    for (const [pid, from] of pairs(parsed.travelling)) if (records.byPid.get(pid!)?.dead) this.travelling.set(pid!, from!);
    for (const [pid, n, at, until] of pairs(parsed.killed)) if (records.byPid.has(pid!)) this.killed.set(pid!, { n: n!, at: at!, until: until! });
  }
}
