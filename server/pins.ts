// Pins: places a survivor marks on the map (CMD_PIN), kept per team and told whole to each member when its team's change
// (OWN_PINS). A survivor alone is a team of one, so its pins are private without a rule of their own; one placed in a
// tribe and not shared is seen by its author alone. Nothing here is stepped: a pin that lapses is a deadline.

import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { fitBytes, type BitReader, type BitWriter } from "../shared/net/codec.ts";
import { CMD_PIN, MAX_NAME_BYTES, OWN_PINS, PIN_ADD, PIN_LABEL_BYTES, PIN_LOOK, PIN_REMOVE, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_RATE } from "../shared/net/protocol.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { stanceEye } from "../shared/sim/character.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { PRIORITY_MOST, WAYPOINT_KINDS, type Waypoint } from "../shared/world/course.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import { RANK_MEMBER, type Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** The most pins a team keeps: a new one past it lets the oldest go. */
export const PINS_MOST = 32;
/** Metres from the eye a look may meet something to pin; a sight raised reaches as far as its gaze. */
export const PIN_REACH = 300;
/** An author may place PIN_BURST pins at once, and then one each PIN_EVERY ticks. */
export const PIN_BURST = 5;
export const PIN_EVERY = 2 * TICK_RATE;
/** The pins are saved at most this often. */
export const PINS_SAVE_TICKS = 10 * TICK_RATE;

/** What a pin of a kind is when placed: its radius in metres, priority, pull, and the seconds it lasts (0 for ever). */
export interface PinKind {
  readonly radius: number;
  readonly priority: number;
  readonly pull: number;
  readonly lasts: number;
}

/** By WAYPOINT_KINDS: go, danger, enemy, resource, meet. Every number is a guess the owner may turn. */
export const PIN_KINDS: readonly PinKind[] = [
  { radius: 10, priority: 3, pull: 0.5, lasts: 0 },
  { radius: 40, priority: 5, pull: -1, lasts: 30 * 60 },
  { radius: 30, priority: 6, pull: -0.5, lasts: 5 * 60 },
  { radius: 15, priority: 2, pull: 0.3, lasts: 0 },
  { radius: 10, priority: 4, pull: 0.7, lasts: 0 },
];

export interface Pin extends Waypoint {
  /** Unique in its team while it lives, and never given again there. */
  id: number;
  label: string;
  /** The permanent id of the survivor that placed it. */
  author: number;
  /** Seen by the whole team, or by its author alone. */
  shared: boolean;
  /** The tick it was placed at, and the tick it goes at, 0 for never. */
  at: number;
  expires: number;
}

interface TeamPins {
  /** Oldest first. */
  readonly list: Pin[];
  next: number;
  version: number;
}

export interface PinsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly tribes: Tribes;
  readonly deadlines: DeadlineHeap;
  /** Metres past PIN_REACH that `c`'s look reaches now, through a sight (Gaze.lookReach). */
  reach(c: Client): number;
}

/** A label as it is kept: control characters out, trimmed, at most PIN_LABEL_BYTES. */
export function cleanLabel(s: string): string {
  return fitBytes(s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim(), PIN_LABEL_BYTES).trim();
}

const NOTHING: readonly Pin[] = [];
const lookDir = [0, 0, 0];

/** Whether body `e`'s look from its own eye meets the ground or anything built or grown within `reach` metres; where, into `out`. */
export function lookPlace(world: ServerWorld, e: number, reach: number, out: { x: number; z: number }): boolean {
  const ents = world.ents, d = lookDir;
  const ex = ents.x[e]!, ey = ents.y[e]! + stanceEye(world.reg.move[ents.kind[e]!]!, ents.stance[e]!), ez = ents.z[e]!;
  lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
  if (castWorld(world, ex, ey, ez, d[0]!, d[1]!, d[2]!, reach) === HIT_NONE) return false;
  out.x = ex + d[0]! * rayHit.t;
  out.z = ez + d[2]! * rayHit.t;
  return true;
}

export class Pins {
  /** For the save: set when anything saved changed. */
  dirty = false;
  private readonly ctx: PinsContext;
  private readonly byTeam = new Map<number, TeamPins>();
  /** Every change of any team takes the next number, so no two teams' pins as they stand share a version. */
  private serial = 0;
  private readonly deadline: number;
  /** Per author, the tick its allowance of adds is spent to (a leaky bucket). */
  private readonly spent = new Map<number, number>();
  private readonly hit = { x: 0, z: 0 };
  private readonly authors: number[] = [];
  private hitX = 0;
  private hitZ = 0;

  constructor(ctx: PinsContext) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("pin", (team, id, tick) => this.due(team, id, tick));
    ctx.game.handle(CMD_PIN, (c, r) => this.command(c, r));
    ctx.game.own.add({
      kind: OWN_PINS,
      unsent: 0,
      version: (_c, rec) => this.version(rec.team),
      write: (w, _c, rec) => this.write(w, rec),
    });
  }

  /** The team's pins, oldest first. */
  of(team: number): readonly Pin[] {
    return this.byTeam.get(team)?.list ?? NOTHING;
  }

  find(team: number, id: number): Pin | null {
    const list = this.byTeam.get(team)?.list;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i]!.id === id) return list[i]!;
    return null;
  }

  /** Changes whenever the team's pins do; 0 for a team that never had any. */
  version(team: number): number {
    return this.byTeam.get(team)?.version ?? 0;
  }

  /** Places a pin of `kind` for `team` at (x, z), as its kind places one. The oldest goes past PINS_MOST. */
  place(team: number, author: number, x: number, z: number, kind: number, shared: boolean, label: string): Pin {
    const tick = this.ctx.world.tick;
    const k = PIN_KINDS[kind]!;
    const t = this.team(team);
    const pin: Pin = { id: t.next++, x, z, radius: k.radius, kind, priority: k.priority, pull: k.pull, label: cleanLabel(label), author, shared, at: tick, expires: k.lasts > 0 ? tick + k.lasts * TICK_RATE : 0 };
    t.list.push(pin);
    if (t.list.length > PINS_MOST) t.list.shift();
    this.lapse(team, pin);
    this.changed(t);
    return pin;
  }

  /** Takes pin `id` of `team` away. False if there was none. */
  remove(team: number, id: number): boolean {
    const t = this.byTeam.get(team);
    const at = t ? t.list.findIndex((p) => p.id === id) : -1;
    if (!t || at < 0) return false;
    t.list.splice(at, 1);
    this.changed(t);
    return true;
  }

  /** Whether `rec` may take `pin` of its team away: its own, or any one for the tribe's owner or a rank above member. */
  mayRemove(rec: EntityRecord, pin: Pin): boolean {
    return pin.author === rec.pid || rec.rank > RANK_MEMBER || this.ctx.tribes.of(rec)?.owner === rec.pid;
  }

  /** Everything of team `from` became `to`'s (Tribes.onMerged): its pins join, renumbered, and the newest PINS_MOST stay. */
  merge(from: number, to: number): void {
    const was = this.byTeam.get(from);
    if (!was || from === to) return;
    this.byTeam.delete(from);
    const t = this.team(to);
    for (const p of was.list) {
      const moved = { ...p, id: t.next++ };
      t.list.push(moved);
      this.lapse(to, moved);
    }
    t.list.sort((a, b) => a.at - b.at);
    if (t.list.length > PINS_MOST) t.list.splice(0, t.list.length - PINS_MOST);
    this.changed(t);
  }

  /** The team is gone (Tribes.onGone), and its pins with it. */
  drop(team: number): void {
    if (!this.byTeam.delete(team)) return;
    this.dirty = true;
  }

  serialize(): string {
    const out: { team: number; next: number; pins: Pin[] }[] = [];
    for (const [team, t] of this.byTeam) if (t.list.length > 0) out.push({ team, next: t.next, pins: t.list });
    return JSON.stringify(out);
  }

  /** Takes the pins a save held. What is not a pin is left out. */
  restore(saved: string | number | null): void {
    if (typeof saved !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(saved);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    for (const raw of parsed as { team?: unknown; next?: unknown; pins?: unknown }[]) {
      if (typeof raw !== "object" || raw === null || !num(raw.team) || raw.team <= 0 || !Array.isArray(raw.pins) || this.byTeam.has(raw.team)) continue;
      const team = raw.team;
      const t: TeamPins = { list: [], next: num(raw.next) ? Math.max(1, Math.floor(raw.next)) : 1, version: 0 };
      for (const p of raw.pins as Partial<Pin>[]) {
        if (typeof p !== "object" || p === null || !num(p.id) || !num(p.x) || !num(p.z) || !num(p.kind) || !num(p.author) || !num(p.at)) continue;
        if (p.kind < 0 || p.kind >= WAYPOINT_KINDS.length || t.list.some((q) => q.id === p.id)) continue;
        const k = PIN_KINDS[p.kind]!;
        const pin: Pin = {
          id: p.id, x: p.x, z: p.z, kind: p.kind, author: p.author, at: p.at,
          radius: num(p.radius) && p.radius > 0 ? p.radius : k.radius,
          priority: num(p.priority) ? Math.max(0, Math.min(PRIORITY_MOST, Math.round(p.priority))) : k.priority,
          pull: num(p.pull) ? Math.max(-1, Math.min(1, p.pull)) : k.pull,
          label: typeof p.label === "string" ? cleanLabel(p.label) : "",
          shared: p.shared !== false,
          expires: num(p.expires) && p.expires > 0 ? p.expires : 0,
        };
        t.list.push(pin);
        t.next = Math.max(t.next, pin.id + 1);
      }
      if (t.list.length === 0) continue;
      t.list.sort((a, b) => a.at - b.at);
      if (t.list.length > PINS_MOST) t.list.splice(0, t.list.length - PINS_MOST);
      t.version = ++this.serial;
      this.byTeam.set(team, t);
      for (const pin of t.list) this.lapse(team, pin);
    }
  }

  private team(team: number): TeamPins {
    let t = this.byTeam.get(team);
    if (!t) this.byTeam.set(team, (t = { list: [], next: 1, version: 0 }));
    return t;
  }

  private changed(t: TeamPins): void {
    t.version = ++this.serial;
    this.dirty = true;
  }

  private lapse(team: number, pin: Pin): void {
    if (pin.expires > 0) this.ctx.deadlines.push(pin.expires, this.deadline, team, pin.id);
  }

  private due(team: number, id: number, tick: number): void {
    const pin = this.find(team, id);
    if (pin && pin.expires > 0 && pin.expires <= tick) this.remove(team, id);
  }

  private command(c: Client, r: BitReader): number {
    const op = r.bits(2);
    if (op === PIN_REMOVE) {
      const id = r.varint();
      return r.overflow ? RESULT_INVALID : this.removeFor(c, id);
    }
    if (op !== PIN_ADD && op !== PIN_LOOK) return RESULT_INVALID;
    const x = op === PIN_ADD ? r.f32() : 0, z = op === PIN_ADD ? r.f32() : 0;
    const kind = r.bits(3), shared = r.bool(), label = r.string(PIN_LABEL_BYTES * 4);
    if (r.overflow || kind >= WAYPOINT_KINDS.length || !Number.isFinite(x) || !Number.isFinite(z)) return RESULT_INVALID;
    const rec = this.living(c);
    if (!rec) return RESULT_DENIED;
    const now = this.ctx.world.tick, free = Math.max(this.spent.get(rec.pid) ?? 0, now);
    if (free - now > (PIN_BURST - 1) * PIN_EVERY) return RESULT_RATE;
    let px = x, pz = z;
    if (op === PIN_LOOK) {
      if (!this.looked(c)) return RESULT_FAR;
      px = this.hitX;
      pz = this.hitZ;
    }
    const dims = this.ctx.world.dims;
    px = Math.max(0, Math.min(dims.chunksX * CHUNK_SIZE, px));
    pz = Math.max(0, Math.min(dims.chunksZ * CHUNK_SIZE, pz));
    this.spent.set(rec.pid, free + PIN_EVERY);
    this.place(rec.team, rec.pid, px, pz, kind, shared, label);
    return RESULT_OK;
  }

  private removeFor(c: Client, id: number): number {
    const rec = this.ctx.records.byPid.get(c.pid);
    if (!rec || rec.team === 0) return RESULT_DENIED;
    const pin = this.find(rec.team, id);
    // A pin its reader is not shown is as good as none.
    if (!pin || (!pin.shared && pin.author !== rec.pid)) return RESULT_INVALID;
    if (!this.mayRemove(rec, pin)) return RESULT_NOT_YOURS;
    this.remove(rec.team, id);
    return RESULT_OK;
  }

  /** `c`'s survivor, if it is alive in the world and has a team. */
  private living(c: Client): EntityRecord | null {
    const rec = this.ctx.records.byPid.get(c.pid);
    const ents = this.ctx.world.ents;
    if (!rec || rec.dead || rec.team === 0 || c.ent < 0 || (ents.flags[c.ent]! & F_ALIVE) === 0) return null;
    return rec;
  }

  /** Whether `c`'s look from its own eye meets anything within reach; where it does is left in hitX and hitZ. */
  private looked(c: Client): boolean {
    if (!lookPlace(this.ctx.world, c.ent, Math.max(PIN_REACH, this.ctx.reach(c)), this.hit)) return false;
    this.hitX = this.hit.x;
    this.hitZ = this.hit.z;
    return true;
  }

  private write(w: BitWriter, rec: EntityRecord): void {
    const list = this.of(rec.team), authors = this.authors;
    authors.length = 0;
    let n = 0;
    for (const p of list) {
      if (!p.shared && p.author !== rec.pid) continue;
      n++;
      if (!authors.includes(p.author)) authors.push(p.author);
    }
    w.u8(n);
    w.u8(authors.length);
    for (const a of authors) w.string(fitBytes(this.ctx.records.byPid.get(a)?.name ?? "", MAX_NAME_BYTES * 3));
    for (const p of list) {
      if (!p.shared && p.author !== rec.pid) continue;
      w.varint(p.id);
      w.bits(p.kind, 3);
      w.bool(p.shared);
      w.bool(p.author === rec.pid);
      w.u8(authors.indexOf(p.author));
      w.f32(p.x);
      w.f32(p.z);
      w.u16(Math.max(0, Math.min(65535, Math.round(p.radius * 10))));
      w.bits(Math.max(0, Math.min(PRIORITY_MOST, p.priority)), 3);
      w.sbits(Math.max(-127, Math.min(127, Math.round(p.pull * 127))), 8);
      w.u32(p.at);
      w.bool(p.expires > 0);
      if (p.expires > 0) w.u32(p.expires);
      w.string(p.label);
    }
  }
}
