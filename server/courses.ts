// Courses: movers taken through places in an order (a Course), or to one of several (an Objective), by the goal that
// Behavior already walks a creature to (goTo, arrived). Only movers given one are stepped, from a short list; with none
// the step costs nothing. A mover asleep, ridden or knocked out waits where it is, its leg's time held.
//
// Below the runner, the tame orders that use it: ORDER_MOVE and ORDER_PATROL, kept on the tame's record.

import { TICK_RATE } from "../shared/coords.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { ORDER_MOVE, RESULT_FAR, RESULT_INVALID, RESULT_OK } from "../shared/net/protocol.ts";
import { MF_OUT } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE } from "../shared/sim/entities.ts";
import { COURSE_BACK, COURSE_LOOP, COURSE_ONCE, advance, course, current, pickPlain, type Choice, type Course, type Objective, type Waypoint } from "../shared/world/course.ts";
import { GOAL_NONE, GOAL_RUN, GOAL_STROLL, GOAL_WALK, MIND_WANDER, type Behavior } from "./behavior.ts";
import type { Client } from "./game.ts";
import { PIN_REACH, lookPlace, type Pins } from "./pins.ts";
import { part, type EntityRecord, type Records } from "./records.ts";
import { saved } from "./saved.ts";
import type { ServerWorld } from "./world.ts";

/** Seconds a leg has at the least; beyond that, 1.6 times its walk and 30 s more (Cast's goto step, server/cast/stage.ts). */
export const LEG_LEAST = 120;
/** A leg's time in seconds: `d` metres at `speed` metres a second. */
export function legSeconds(d: number, speed: number): number {
  return Math.max(LEG_LEAST, (1.6 * d) / Math.max(0.1, speed) + 30);
}
/** A `reach` under this (and not unknown, under 0) for REACH_LOW_TICKS running gives the leg up early. */
export const REACH_LOW = 0.15;
export const REACH_LOW_TICKS = 5 * TICK_RATE;
/** Metres past a detour's radius from the mover's line within which it is visited on the way. */
export const DETOUR_SLACK = 4;
/** Ticks between looks for a detour, and between a mover's owner being asked to look at its course again. */
const DETOUR_EVERY = 15;
const WATCH_EVERY = TICK_RATE;

/**
 * A decider point that picks among an objective's choices (server/decide/nav-pick.ts). Courses makes the plain pick at
 * once; where the point is on it is asked too, and an answer acted on comes back through `take` in the same tick.
 */
export interface Picker {
  /** Whether it is asked at all. */
  on(): boolean;
  /** Whether its answers are acted on. */
  acts(): boolean;
  ask(e: number): void;
  /** Its own work for the tick, after the movers are stepped. */
  step?(tick: number): void;
}

/** Whoever set a course hears of it here. `at` is the point of the course, or the choice of the objective. */
export interface CourseOwner {
  arrived?(e: number, at: number): void;
  /** Point `at` was not reached in its time, or `reach` said it would not be: the course went on without it. */
  failed?(e: number, at: number): void;
  /** It ran out: the last point was reached or given up, or nothing was left to choose. Not told for `stop`. */
  ended?(e: number): void;
  /** Once a second while it moves: a chance to change or stop it. */
  watch?(e: number): void;
}

class Mover {
  e = -1;
  gen = 0;
  owner: CourseOwner = {};
  pace = GOAL_WALK;
  course: Course | null = null;
  objective: Objective | null = null;
  /** For an objective: 1 for each choice visited or given up. */
  done = new Uint8Array(0);
  /** The choice made for, and a detour taken on the way to it, or -1. */
  aim = -1;
  detour = -1;
  /** Whether the aim was kept from before a detour rather than picked afresh. */
  kept = false;
  /** Whether a pick acted on chose this leg: then it chose its detours too, and none is looked for aside. */
  picked = false;
  /** The leg: where, how near counts, the awake ticks spent on it and allowed, and the ticks `reach` has been low. */
  x = 0;
  z = 0;
  radius = 0;
  spent = 0;
  budget = 0;
  low = 0;
  live = true;
}

export interface CoursesContext {
  readonly world: ServerWorld;
  readonly mind: Behavior;
}

export class Courses {
  /** Movers stepped, over every tick; legs given up; and courses that ran out. For measurement. */
  stepped = 0;
  gaveUp = 0;
  finished = 0;
  /** 0 to 1: whether `e` will reach its leg's end, under 0 where unknown. Under REACH_LOW for long, the leg is given up. */
  reach: ((e: number) => number) | null = null;
  /** Picks among an objective's choices besides the plain pick, where it is on. */
  pick: Picker | null = null;
  /** Told of each leg's end: reached, or given up. */
  legEnded: ((e: number, ok: boolean, x: number, z: number) => void) | null = null;
  private readonly ctx: CoursesContext;
  private readonly list: Mover[] = [];
  private readonly byEnt = new Map<number, Mover>();
  private dirty = false;
  /** What is left of an objective, for the plain pick, and where each came from. */
  private readonly left: Objective = { choices: [] };
  private readonly leftAt: number[] = [];

  constructor(ctx: CoursesContext) {
    this.ctx = ctx;
  }

  get count(): number {
    return this.byEnt.size;
  }

  /** Why `e` may not be given a course, or "". */
  refuse(e: number): string {
    const { ents, reg } = this.ctx.world;
    if (e < 0 || e >= ents.cap || (ents.flags[e]! & F_ALIVE) === 0) return "it is not in the world";
    // Behavior's goal is walked on the ground: it has no public way to fly a creature to a point.
    if (reg.flies[ents.kind[e]!]) return "a flyer cannot be sent on a course yet";
    return "";
  }

  /** Sends `e` along `c` at a GOAL_ pace, in place of whatever it had. "" or why not. */
  give(e: number, c: Course, owner: CourseOwner, pace = GOAL_WALK): string {
    const why = this.refuse(e);
    if (why !== "") return why;
    const m = this.add(e, owner, pace);
    m.course = c;
    if (c.at < 0) this.end(m, false);
    else this.leg(m);
    return "";
  }

  /** Sends `e` to one choice of `o` after another until none is left. "" or why not. */
  aim(e: number, o: Objective, owner: CourseOwner, pace = GOAL_WALK): string {
    const why = this.refuse(e);
    if (why !== "") return why;
    const m = this.add(e, owner, pace);
    m.objective = o;
    m.done = new Uint8Array(o.choices.length);
    m.aim = this.choose(m);
    if (m.aim < 0) this.end(m, false);
    else {
      this.leg(m);
      this.askPick(m);
    }
    return "";
  }

  /** Takes `e`'s course away, telling nobody. Its goal is left as it is. */
  stop(e: number): boolean {
    const m = this.byEnt.get(e);
    if (!m) return false;
    this.drop(m);
    return true;
  }

  of(e: number): Course | null {
    return this.byEnt.get(e)?.course ?? null;
  }

  has(e: number): boolean {
    return this.byEnt.has(e);
  }

  /** The choice `e` makes for now, a detour first; -1 for none. */
  making(e: number): number {
    const m = this.byEnt.get(e);
    return !m || !m.objective ? -1 : m.detour >= 0 ? m.detour : m.aim;
  }

  /** `e`'s objective, or null. */
  objectiveOf(e: number): Objective | null {
    return this.byEnt.get(e)?.objective ?? null;
  }

  /** Whether choice `i` of `e`'s objective is still to be made for: neither visited nor given up. */
  open(e: number, i: number): boolean {
    const m = this.byEnt.get(e);
    return !!m && m.objective !== null && i >= 0 && i < m.done.length && m.done[i] === 0;
  }

  /** The choice `e` aims at past any detour, and whether it was kept from before one: -1 where none was kept. */
  keptAim(e: number): number {
    const m = this.byEnt.get(e);
    return m && m.objective && m.kept ? m.aim : -1;
  }

  /** Metres a second that `e` walks its course at. */
  speedOf(e: number): number {
    const m = this.byEnt.get(e);
    return this.speed(e, m ? m.pace : GOAL_WALK);
  }

  /** The tick by which `e`'s leg runs out if every tick from now counts, or -1 for none. */
  legEnds(e: number): number {
    const m = this.byEnt.get(e);
    return m && m.live && m.budget > 0 ? this.ctx.world.tick + Math.max(0, m.budget - m.spent) : -1;
  }

  /**
   * Sends `e` for choice `aim` of its objective, through `detour` first where it is not -1, as a pick decided. False where
   * either is not open or is of the wrong sort; nothing changes where it is already so.
   */
  take(e: number, aim: number, detour: number): boolean {
    const m = this.byEnt.get(e);
    if (!m || !m.live || !m.objective) return false;
    const c = m.objective.choices;
    if (!this.open(e, aim) || c[aim]!.detour || (detour >= 0 && (!this.open(e, detour) || !c[detour]!.detour))) return false;
    m.picked = true;
    if (m.aim === aim && m.detour === detour) return true;
    m.aim = aim;
    m.detour = detour;
    m.kept = false;
    this.leg(m);
    return true;
  }

  step(tick: number): void {
    if (this.list.length === 0) return;
    const { world, mind } = this.ctx;
    const ents = world.ents;
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i]!;
      if (!m.live) continue;
      const e = m.e;
      if ((ents.flags[e]! & F_ALIVE) === 0 || ents.gen[e] !== m.gen) {
        this.drop(m);
        continue;
      }
      // Asleep, ridden or out, it waits, and its leg's time waits with it.
      if ((ents.flags[e]! & F_AWAKE) === 0 || ents.driven[e] !== 0 || (ents.mflags[e]! & MF_OUT) !== 0) continue;
      this.stepped++;
      if ((tick + e) % WATCH_EVERY === 0 && m.owner.watch) {
        m.owner.watch(e);
        if (!m.live) continue;
      }
      if (mind.arrived(e, m.radius)) {
        this.reached(m, true);
        continue;
      }
      // A hunt or a fright comes first, and its time is not the leg's.
      if (mind.mind[e] !== MIND_WANDER) continue;
      m.spent++;
      const r = this.reach !== null ? this.reach(e) : -1;
      if (r >= 0 && r < REACH_LOW) m.low++;
      else m.low = 0;
      if (m.spent > m.budget || m.low >= REACH_LOW_TICKS) {
        this.gaveUp++;
        this.reached(m, false);
        continue;
      }
      if (m.objective !== null && m.detour < 0 && !m.picked && (tick + e) % DETOUR_EVERY === 0) this.lookAside(m);
    }
    if (this.dirty) {
      this.dirty = false;
      let n = 0;
      for (const m of this.list) if (m.live) this.list[n++] = m;
      this.list.length = n;
    }    this.pick?.step?.(tick);
  }

  /** Every mover a pick re-aimed goes back to the plain pick: the point's answers are no longer acted on. */
  letGo(): void {
    for (const m of this.list) {
      if (!m.live || !m.objective || !m.picked) continue;
      const was = m.detour;
      m.picked = false;
      m.kept = false;
      m.detour = -1;
      const plain = this.choose(m);
      if (plain < 0 || (plain === m.aim && was < 0)) continue;
      m.aim = plain;
      this.leg(m);
    }
  }

  private add(e: number, owner: CourseOwner, pace: number): Mover {
    const was = this.byEnt.get(e);
    if (was) this.drop(was);
    const m = new Mover();
    m.e = e;
    m.gen = this.ctx.world.ents.gen[e]!;
    m.owner = owner;
    m.pace = pace;
    this.byEnt.set(e, m);
    this.list.push(m);
    return m;
  }

  private drop(m: Mover): void {
    m.live = false;
    this.dirty = true;
    if (this.byEnt.get(m.e) === m) this.byEnt.delete(m.e);
  }

  /** The point `m` makes for now. */
  private point(m: Mover): Waypoint | null {
    if (m.course) return current(m.course);
    const o = m.objective!;
    const at = m.detour >= 0 ? m.detour : m.aim;
    return at >= 0 ? o.choices[at]!.place : null;
  }

  /** Metres a second `e` walks at `pace`. */
  private speed(e: number, pace: number): number {
    const { world } = this.ctx, ents = world.ents;
    const move = (ents.team[e] !== 0 ? world.reg.tamedMove : world.reg.move)[ents.kind[e]!]!;
    return move.walkSpeed * (pace === GOAL_RUN ? move.sprintMul : pace === GOAL_STROLL ? 0.5 : 1);
  }

  /** Starts the leg to `m`'s point, with its time from where it stands. */
  private leg(m: Mover): void {
    const p = this.point(m)!;
    const { world, mind } = this.ctx;
    const ents = world.ents, e = m.e;
    const dx = p.x - ents.x[e]!, dz = p.z - ents.z[e]!;
    const speed = this.speed(e, m.pace);
    m.x = p.x;
    m.z = p.z;
    m.radius = Math.max(p.radius, 0.5);
    m.spent = 0;
    m.low = 0;
    m.budget = Math.round(legSeconds(Math.sqrt(dx * dx + dz * dz), speed) * TICK_RATE);
    mind.goTo(e, p.x, p.z, m.pace);
  }

  /** The leg's end was reached, or given up; the owner is told and the course goes on. */
  private reached(m: Mover, ok: boolean): void {
    const e = m.e;
    let at: number;
    if (m.course) at = m.course.at;
    else if (m.detour >= 0) at = m.detour;
    else at = m.aim;
    if (m.objective) m.done[at] = 1;
    this.legEnded?.(e, ok, m.x, m.z);
    if (ok) m.owner.arrived?.(e, at);
    else m.owner.failed?.(e, at);
    // The owner may have stopped it, or given it another.
    if (!m.live) return;
    let more: boolean;
    if (m.course) more = advance(m.course);
    else if (m.detour >= 0) {
      m.detour = -1;
      m.kept = true;
      more = m.done[m.aim] === 0;
    } else {
      m.aim = this.choose(m);
      m.kept = false;
      more = m.aim >= 0;
    }
    if (!more) return this.end(m, ok);
    m.picked = false;
    this.leg(m);
    if (m.objective) this.askPick(m);
  }

  /** Puts the question of the pick for `m`, where the point is on. */
  private askPick(m: Mover): void {
    if (this.pick !== null && this.pick.on()) this.pick.ask(m.e);
  }

  /** It ran out. Where its last leg was given up, it stops where it is rather than walk on at what it cannot reach. */
  private end(m: Mover, ok: boolean): void {
    const ents = this.ctx.world.ents;
    this.drop(m);
    this.finished++;
    if (!ok) this.ctx.mind.goTo(m.e, ents.x[m.e]!, ents.z[m.e]!, GOAL_NONE);
    m.owner.ended?.(m.e);
  }

  /** The plain pick of what is left of `m`'s objective: the highest priority, then the nearest; never a detour. -1 for none. */
  private choose(m: Mover): number {
    const o = m.objective!, left = this.left.choices as Choice[], at = this.leftAt;
    left.length = 0;
    at.length = 0;
    for (let i = 0; i < o.choices.length; i++) {
      if (m.done[i] !== 0) continue;
      left.push(o.choices[i]!);
      at.push(i);
    }
    if (left.length === 0) return -1;
    const ents = this.ctx.world.ents;
    const k = pickPlain(this.left, ents.x[m.e]!, ents.z[m.e]!);
    return k >= 0 ? at[k]! : -1;
  }

  /** A detour not yet visited near the line from `m` to its choice is taken first. */
  private lookAside(m: Mover): void {
    const o = m.objective!, ents = this.ctx.world.ents;
    const ax = ents.x[m.e]!, az = ents.z[m.e]!, bx = m.x - ax, bz = m.z - az;
    const len = bx * bx + bz * bz;
    for (let i = 0; i < o.choices.length; i++) {
      const c = o.choices[i]!;
      if (!c.detour || m.done[i] !== 0) continue;
      const px = c.place.x - ax, pz = c.place.z - az;
      const t = len > 0 ? Math.max(0, Math.min(1, (px * bx + pz * bz) / len)) : 0;
      const dx = px - t * bx, dz = pz - t * bz, near = c.place.radius + DETOUR_SLACK;
      if (dx * dx + dz * dz > near * near) continue;
      m.detour = i;
      this.leg(m);
      return;
    }
  }
}

// ---- Tame orders ----

/** Metres from where its orderer looked that a tame told to go there counts as come. */
export const MOVE_RADIUS = 2;
/** Pins a patrol walks at the most. */
export const PATROL_MOST = 8;

/** A tame's standing move or patrol: ORDER_MOVE or ORDER_PATROL, or 0 for none; the place looked at; the pins; who gave it. */
export const ORDERED = part(() => ({ what: 0, back: false, x: 0, z: 0, pins: [] as number[], by: 0, seen: -1 }));

saved({
  name: "course",
  has: (rec) => (rec.part(ORDERED)?.what ?? 0) !== 0,
  write(rec, w) {
    const o = rec.part(ORDERED)!;
    w.u8(o.what);
    w.bool(o.back);
    w.f32(o.x);
    w.f32(o.z);
    w.uint53(o.by);
    w.u8(o.pins.length);
    for (const id of o.pins) w.varint(id);
  },
  read(rec, r) {
    const o = rec.own(ORDERED);
    o.what = r.u8();
    o.back = r.bool();
    o.x = r.f32();
    o.z = r.f32();
    o.by = r.uint53();
    o.pins.length = 0;
    for (let n = r.u8(); n > 0 && !r.overflow; n--) o.pins.push(r.varint());
  },
});

export interface TameOrdersContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly pins: Pins;
  readonly courses: Courses;
  readonly mind: Behavior;
  /** Metres past PIN_REACH that `c`'s look reaches now (Gaze.lookReach). */
  reach(c: Client): number;
  tell(pid: number, text: string): void;
}

/** An order as read from its command, checked against the orderer's pins, waiting to be given to each tame that hears. */
interface Asked {
  what: number;
  back: boolean;
  x: number;
  z: number;
  readonly pins: number[];
}

export class TameOrders implements CourseOwner {
  /** Moves and patrols given, and legs a tame did not reach. */
  given = 0;
  missed = 0;
  private readonly ctx: TameOrdersContext;
  private readonly asked: Asked = { what: 0, back: false, x: 0, z: 0, pins: [] };

  constructor(ctx: TameOrdersContext) {
    this.ctx = ctx;
  }

  /**
   * Reads what follows ORDER_MOVE or ORDER_PATROL in a command from `c`, whose survivor is `me`, and checks it: each pin
   * one of her team's she is shown, and a place looked at found by the server along her own look. A RESULT_ code.
   */
  read(what: number, r: BitReader, c: Client, me: EntityRecord): number {
    const a = this.asked, pins = this.ctx.pins;
    a.what = what;
    a.pins.length = 0;
    a.back = false;
    if (what === ORDER_MOVE) {
      const id = r.varint();
      if (r.overflow) return RESULT_INVALID;
      if (id === 0) return lookPlace(this.ctx.world, c.ent, Math.max(PIN_REACH, this.ctx.reach(c)), a) ? RESULT_OK : RESULT_FAR;
      a.pins.push(id);
    } else {
      a.back = r.bool();
      for (let n = r.bits(3) + 1; n > 0; n--) a.pins.push(r.varint());
      if (r.overflow) return RESULT_INVALID;
    }
    for (const id of a.pins) {
      const pin = pins.find(me.team, id);
      if (!pin || (!pin.shared && pin.author !== me.pid)) return RESULT_INVALID;
    }
    return RESULT_OK;
  }

  /** Gives tame `e` the order last read, for good: it is kept on its record. A RESULT_ code. */
  give(e: number, rec: EntityRecord, by: number): number {
    if (this.ctx.courses.refuse(e) !== "") return RESULT_INVALID;
    const a = this.asked, o = rec.own(ORDERED);
    o.what = a.what;
    o.back = a.back;
    o.x = a.x;
    o.z = a.z;
    o.by = by;
    o.pins.length = 0;
    for (const id of a.pins) o.pins.push(id);
    this.given++;
    return this.apply(e, rec) ? RESULT_OK : RESULT_INVALID;
  }

  /** Every other order: a move or a patrol ends, and the goal goes with it. */
  clear(e: number, rec: EntityRecord): void {
    const o = rec.part(ORDERED);
    if (o) o.what = 0;
    this.ctx.courses.stop(e);
    const ents = this.ctx.world.ents;
    this.ctx.mind.goTo(e, ents.x[e]!, ents.z[e]!, GOAL_NONE);
  }

  /** A body was made for `rec`, new, loaded or set back in the world: its standing order is taken up again. */
  adopted(e: number, rec: EntityRecord): void {
    if ((rec.part(ORDERED)?.what ?? 0) !== 0) this.apply(e, rec);
  }

  /** Puts the order on `rec` to body `e` as a course. False, and the order ends, where none of its pins is left. */
  private apply(e: number, rec: EntityRecord): boolean {
    const o = rec.own(ORDERED), { pins, courses } = this.ctx;
    o.seen = pins.version(rec.team);
    let c: Course;
    if (o.what === ORDER_MOVE && o.pins.length === 0) c = course([{ x: o.x, z: o.z, radius: MOVE_RADIUS, kind: 0, priority: 0, pull: 0 }], COURSE_ONCE);
    else {
      const points = this.points(rec);
      if (points.length === 0) {
        this.end(e, rec);
        return false;
      }
      c = course(points, o.what === ORDER_MOVE ? COURSE_ONCE : o.back ? COURSE_BACK : COURSE_LOOP);
    }
    return courses.give(e, c, this, o.what === ORDER_MOVE ? GOAL_RUN : GOAL_WALK) === "";
  }

  /** The order's pins that are still there, and the list kept on the record cut to them. */
  private points(rec: EntityRecord): Waypoint[] {
    const o = rec.own(ORDERED), out: Waypoint[] = [];
    let n = 0;
    for (const id of o.pins) {
      const pin = this.ctx.pins.find(rec.team, id);
      if (!pin) continue;
      out.push(pin);
      o.pins[n++] = id;
    }
    o.pins.length = n;
    return out;
  }

  /** The order is over: it stays where it is. */
  private end(e: number, rec: EntityRecord): void {
    this.clear(e, rec);
    this.ctx.records.dirty.add(rec.pid);
  }

  private rec(e: number): EntityRecord | undefined {
    return this.ctx.records.byPid.get(this.ctx.world.ents.pid[e]!);
  }

  /** A pin of its team was removed: a move to it ends, and a patrol goes on by those left, to the next still there. */
  watch(e: number): void {
    const rec = this.rec(e), o = rec?.part(ORDERED);
    if (!rec || !o || o.what === 0) return;
    const v = this.ctx.pins.version(rec.team);
    if (v === o.seen) return;
    o.seen = v;
    if (o.pins.length === 0) return;
    const c = this.ctx.courses.of(e);
    const was = o.pins.length, heading = c ? o.pins[c.at] ?? -1 : -1, step = c ? c.step : 1;
    const points = this.points(rec);
    if (points.length === was) return;
    this.ctx.records.dirty.add(rec.pid);
    if (points.length === 0) return this.end(e, rec);
    const next = course(points, o.what === ORDER_MOVE ? COURSE_ONCE : o.back ? COURSE_BACK : COURSE_LOOP);
    // The pin it was making for if it is left, else the one that took its place in the list.
    const at = o.pins.indexOf(heading);
    next.at = at >= 0 ? at : Math.min(points.length - 1, Math.max(0, c ? c.at : 0));
    next.step = points.length > 1 ? step : 1;
    this.ctx.courses.give(e, next, this, GOAL_WALK);
  }

  /** Its orderer is told. A move given up is over, and is not taken up again after a restart. */
  failed(e: number, at: number): void {
    this.missed++;
    const rec = this.rec(e), o = rec?.part(ORDERED);
    if (!rec || !o || o.what === 0) return;
    const pin = o.pins.length > 0 ? this.ctx.pins.find(rec.team, o.pins[at] ?? 0) : null;
    const where = pin ? (pin.label !== "" ? pin.label : "a pin") : "where you looked";
    if (o.by !== 0) this.ctx.tell(o.by, `${rec.name !== "" ? rec.name : "Your creature"} could not find a way to ${where}.`);
    if (o.what === ORDER_MOVE) {
      o.what = 0;
      this.ctx.records.dirty.add(rec.pid);
    }
  }
}
