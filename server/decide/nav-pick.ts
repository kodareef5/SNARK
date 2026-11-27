// `nav.pick`: which of an objective's choices a mover makes for next (server/courses.ts). Courses takes the plain pick at
// once, the highest priority and then the nearest by a straight line, and puts the question; an answer acted on in the
// same tick sends the mover elsewhere, through a detour first where one is worth its seconds. Off or watched, the plain
// pick and the plain detours stand.
//
// Each choice is priced by a way, not a line: a straight walk where the body can walk it, else a search of the point's
// own, first back from the choice (a choice shut in is told in a few hundred cells) and then out from the mover. A cell
// costs one to three microseconds, so the question is priced before it is put: for a mover a player is close to, its
// searches run in Courses' row, PICK_TICK_CELLS a tick for every such mover in turn, and the question is put once they
// are done; a mover in the background is asked at once, its trips priced by sight and line alone. A choice that one
// already priced beats whatever its way (a lower priority, or a line longer than that one's way) is not searched, and one
// whose search ran out is priced by its line and says so.

import { TICK_RATE } from "../../shared/coords.ts";
import { answer as choose } from "../../shared/decide/forward.ts";
import { DETOUR_HALF, PICK, PICK_HALF } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { soon } from "../../shared/decide/units.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { PRIORITY_MOST, WAYPOINT_KINDS, worthOf, type Waypoint } from "../../shared/world/course.ts";
import { PATH_FOUND, PATH_LEG, PATH_NONE, PathFinder } from "../../shared/world/path.ts";
import type { Behavior } from "../behavior.ts";
import type { Lane } from "../lane.ts";
import type { Courses, Picker } from "../courses.ts";
import type { Pin } from "../pins.ts";
import type { ServerWorld } from "../world.ts";
import { COST_RING, type Decide, type Point } from "./decide.ts";

/** Choices one answer weighs at the most; an objective with more weighs the first of those still open. */
export const PICK_MOST = 16;
/**
 * Cells the pricing of every mover may expand in one tick, one search out from a mover, and one back from a choice. A
 * search's start is counted as SEARCH_START cells and a straight walk tried as one cell for each SIGHT_METRES of it.
 */
export const PICK_TICK_CELLS = 150;
export const PICK_SEARCH = 2500;
export const PICK_BACK = 400;
/** Movers waiting to be priced at the most; one past it is asked with its trips priced by sight and line alone. */
export const PICK_QUEUE = 256;
const SEARCH_START = 10;
const SIGHT_METRES = 5;
/** Ticks a mover's prices are good for. */
const PRICED_TICKS = TICK_RATE;
/** Added to a candidate's score whatever the scorer says: for each step of priority, and for its pull. */
export const BIAS_PRIORITY = 0.5;
export const BIAS_PULL = 2;
/** Metres between the points of a way read for danger. */
const DANGER_STEP = 2;
/** Metres a second where a mover's own pace is not known. */
const LEAST_PACE = 0.5;

/** The pins of a team; none for team 0. */
export type PinsOf = (team: number) => readonly Pin[];

/** -1 to 1: the place's own pull and that of each pin it lies within, leaving out a pin that is the place itself. */
export function pullAt(pins: readonly Pin[], p: Waypoint): number {
  let v = p.pull;
  for (const q of pins) {
    if (q.x === p.x && q.z === p.z) continue;
    const dx = q.x - p.x, dz = q.z - p.z;
    if (dx * dx + dz * dz <= q.radius * q.radius) v += q.pull;
  }
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * What the pins add to each heading from (x, z), as one vector into `out` at most 1 long: each pin's pull along the
 * bearing to it, whole within its radius and by its radius over the distance beyond. A heading's pull is its dot with it.
 */
export function pullToward(pins: readonly Pin[], x: number, z: number, out: { x: number; z: number }): void {
  let vx = 0, vz = 0;
  for (const q of pins) {
    const dx = q.x - x, dz = q.z - z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.1) continue;
    const k = (q.pull * (d <= q.radius ? 1 : q.radius / d)) / d;
    vx += dx * k;
    vz += dz * k;
  }
  const len = Math.sqrt(vx * vx + vz * vz);
  out.x = len > 1 ? vx / len : vx;
  out.z = len > 1 ? vz / len : vz;
}

/** One trip priced for a pick: its seconds, whether they were measured along a way, whether none leads there, and its danger. */
interface Way {
  seconds: number;
  byWay: boolean;
  none: boolean;
  danger: number;
}

const way = (): Way => ({ seconds: 0, byWay: false, none: false, danger: 0 });

/** One mover's choices being priced: where it stood, its open choices in the plain order, and their trips. */
class Pricing {
  e = -1;
  gen = 0;
  tick = 0;
  x = 0;
  z = 0;
  pace = 1;
  n = 0;
  /** Of the open list, the one the detours are weighed against, and the next trip to price (n and on are detours' vias). */
  aim = -1;
  next = 0;
  /** The best priced so far with a way, for the trips it makes not worth a search. */
  top = -1;
  soonest = Infinity;
  /** False for a pricing done at once, by sight and line alone. */
  searches = true;
  pins: readonly Pin[] = [];
  readonly open = new Int32Array(PICK_MOST);
  readonly lines = new Float64Array(PICK_MOST);
  readonly ways: Way[] = Array.from({ length: PICK_MOST }, way);
  readonly vias: Way[] = Array.from({ length: PICK_MOST }, way);
}

export class Pick implements Picker {
  readonly point: Point;
  /** The point's number on the decider. */
  id = -1;
  /** Searches run and the cells they expanded, movers priced, and those asked unpriced for a full queue, since the start. */
  searches = 0;
  cells = 0;
  priced = 0;
  overflow = 0;
  /** Movers in the background asked at once, unsearched. */
  unsearched = 0;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly courses: Courses;
  private readonly pinsOf: PinsOf;
  private readonly decide: Decide;
  private readonly lane: Lane | null;
  private readonly table = tableFor(PICK, PICK_MOST);
  /** One for the searches spread over ticks, and one for the straight walks tried between them. */
  private readonly finder: PathFinder;
  private readonly sighter: PathFinder;
  /** Of the last answer, by candidate: the choice made for, and the detour taken first or -1. */
  private readonly aimOf = new Int32Array(PICK_MOST);
  private readonly detourOf = new Int32Array(PICK_MOST);
  /** Movers waiting to be priced, with their generations; the one being priced; the last priced; one priced at once. */
  private readonly queue: number[] = [];
  private readonly queueGen: number[] = [];
  private job: Pricing | null = null;
  private readonly working = new Pricing();
  private readonly done = new Pricing();
  private readonly now = new Pricing();
  /** The trip under way: 0 none, 1 searching back from its end, 2 out from its start; its ends and its price. */
  private phase = 0;
  private tx0 = 0;
  private tz0 = 0;
  private tx1 = 0;
  private tz1 = 0;
  private trip: Way = way();
  /** Cells' worth of work done this step besides the cells searched: starts and straight walks. */
  private charge = 0;

  constructor(world: ServerWorld, mind: Behavior, courses: Courses, pinsOf: PinsOf, decide: Decide, lane: Lane | null = null) {
    this.world = world;
    this.mind = mind;
    this.courses = courses;
    this.pinsOf = pinsOf;
    this.decide = decide;
    this.lane = lane;
    this.finder = new PathFinder(world, world.reg.move[world.reg.index.get("core:survivor") ?? 0]!);
    this.finder.doorways = world.reg.doorway;
    this.sighter = new PathFinder(world, this.finder.body);
    this.sighter.doorways = world.reg.doorway;
    const pick = this;
    this.point = {
      name: "nav.pick", cost: COST_RING, horizon: 0, tables: [{ profile: PICK, table: this.table }],
      still: (e) => (world.ents.flags[e]! & F_AWAKE) !== 0 && courses.objectiveOf(e) !== null,
      answer: (e, _tick, _rung, ask) => (pick.fill(e) ? choose("choice", pick.table, ask(PICK, pick.table)) : -1),
      apply: (e, _tick, _rung, k) => void courses.take(e, pick.aimOf[k]!, pick.detourOf[k]!),
      release: () => pick.clear(),
    };
  }

  on(): boolean {
    return this.decide.on(this.id);
  }

  acts(): boolean {
    return this.decide.acts(this.id);
  }

  /** `e` is to be priced; its question is put once it is. */
  ask(e: number): void {
    const gen = this.world.ents.gen[e]!;
    if (this.job?.e === e && this.job.gen === gen) this.job = null;
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i] === e) {
      this.queue.splice(i, 1);
      this.queueGen.splice(i, 1);
      break;
    }
    const back = this.mind.back(e);
    if (back || this.queue.length >= PICK_QUEUE) {
      if (back) this.unsearched++;
      else this.overflow++;
      this.decide.put(this.id, e, 0, back);
      return;
    }
    this.queue.push(e);
    this.queueGen.push(gen);
  }

  /** Forgets every pricing, under way or waiting. */
  clear(): void {
    this.queue.length = this.queueGen.length = 0;
    this.job = null;
    this.phase = 0;
    this.done.e = -1;
  }

  /** Prices movers in turn for PICK_TICK_CELLS, putting the question of each one done. Courses calls it each tick. */
  step(tick: number): void {
    if (this.job === null && this.queue.length === 0) return;
    let left = PICK_TICK_CELLS;
    while (left > 0) {
      const job = this.job ?? this.take(tick);
      if (job === null) break;
      if (this.phase !== 0) {
        if (this.lane !== null && left < PICK_TICK_CELLS && !this.lane.may()) break;
        left -= this.advance(left) + this.charge;
        this.charge = 0;
        if (this.phase !== 0) break;
        this.settle(job, job.next - 1);
        continue;
      }
      const more = this.begin(job);
      left -= this.charge;
      this.charge = 0;
      if (!more) {
        this.finish(job);
        this.job = null;
      }
    }
    this.charge = 0;
  }

  /** The next mover waiting that still has an objective, set up for pricing; null for none. */
  private take(tick: number): Pricing | null {
    const ents = this.world.ents;
    while (this.queue.length > 0) {
      const e = this.queue.shift()!, gen = this.queueGen.shift()!;
      if (ents.gen[e] !== gen || !this.setup(this.working, e, tick, true)) continue;
      this.phase = 0;
      return (this.job = this.working);
    }
    return null;
  }

  /** Sets `p` up for `e`: its open choices in the plain order. False where none it may end at is open. */
  private setup(p: Pricing, e: number, tick: number, searches: boolean): boolean {
    const o = this.courses.objectiveOf(e), body = this.mind.walkerOf(e);
    if (!o || !body) return false;
    const ents = this.world.ents, x = ents.x[e]!, z = ents.z[e]!;
    let n = 0, ends = 0;
    const after = (i: number, j: number, d: number): boolean => {
      const a = o.choices[i]!, b = o.choices[p.open[j]!]!;
      if (a.detour !== b.detour) return a.detour;
      return a.place.priority !== b.place.priority ? a.place.priority < b.place.priority : d >= p.lines[j]!;
    };
    for (let i = 0; i < o.choices.length && n < PICK_MOST; i++) {
      if (!this.courses.open(e, i)) continue;
      const q = o.choices[i]!.place, d = Math.hypot(q.x - x, q.z - z);
      let j = n++;
      for (; j > 0 && !after(i, j - 1, d); j--) {
        p.open[j] = p.open[j - 1]!;
        p.lines[j] = p.lines[j - 1]!;
      }
      p.open[j] = i;
      p.lines[j] = d;
      if (!o.choices[i]!.detour) ends++;
    }
    if (ends === 0) return false;
    p.e = e;
    p.gen = ents.gen[e]!;
    p.tick = tick;
    p.x = x;
    p.z = z;
    p.n = n;
    p.next = 0;
    p.aim = -1;
    p.top = -1;
    p.soonest = Infinity;
    p.searches = searches;
    p.pace = Math.max(LEAST_PACE, this.courses.speedOf(e));
    p.pins = ents.team[e] !== 0 ? this.pinsOf(ents.team[e]!) : [];
    return true;
  }

  /** Starts `p`'s next trip, settling it at once where no search is needed. False once every trip is priced. */
  private begin(p: Pricing): boolean {
    const o = this.courses.objectiveOf(p.e);
    if (!o) return false;
    const body = this.mind.walkerOf(p.e);
    if (!body) return false;
    // Water is swum where the body swims, at its walk over its swim and never under dry ground's price.
    this.sighter.body = body;
    this.sighter.swim = body.swimSpeed > 0 ? Math.max(1, body.walkSpeed / body.swimSpeed) : 0;
    while (p.next < 2 * p.n) {
      if (p.next === p.n) p.aim = this.aimOf_(p, o.choices);
      const j = p.next++;
      const detour = j >= p.n;
      const k = detour ? j - p.n : j, ch = o.choices[p.open[k]!]!;
      if (detour && !ch.detour) continue;
      let search = p.searches;
      let x0 = p.x, z0 = p.z, x1 = ch.place.x, z1 = ch.place.z, r = ch.place.radius;
      if (detour) {
        const A = o.choices[p.open[p.aim]!]!.place;
        x0 = ch.place.x;
        z0 = ch.place.z;
        x1 = A.x;
        z1 = A.z;
        r = A.radius;
      } else if (!ch.detour && p.top >= 0 && (ch.place.priority < p.top || p.lines[k]! / p.pace >= p.soonest)) search = false;
      const out = detour ? p.vias[k]! : p.ways[k]!;
      if (this.start(p, x0, z0, x1, z1, r, out, search)) return true;
      this.settle(p, j);
    }
    if (p.aim < 0) p.aim = this.aimOf_(p, o.choices);
    return false;
  }

  /** The open list's index of the aim the detours are weighed against: priority, then seconds by a way, none last. */
  private aimOf_(p: Pricing, choices: readonly { place: Waypoint; detour: boolean }[]): number {
    let a = -1;
    for (let j = 0; j < p.n; j++) {
      const c = choices[p.open[j]!]!;
      if (c.detour) continue;
      if (a < 0 || this.before(c.place.priority, p.ways[j]!, choices[p.open[a]!]!.place.priority, p.ways[a]!)) a = j;
    }
    return a;
  }

  /** Notes trip `j` of `p` priced, for the trips after it. */
  private settle(p: Pricing, j: number): void {
    if (j >= p.n) return;
    const o = this.courses.objectiveOf(p.e);
    const ch = o?.choices[p.open[j]!];
    const w = p.ways[j]!;
    if (!ch || ch.detour || w.none || !w.byWay) return;
    if (ch.place.priority > p.top) {
      p.top = ch.place.priority;
      p.soonest = w.seconds;
    } else if (ch.place.priority === p.top && w.seconds < p.soonest) p.soonest = w.seconds;
  }

  /** `p` is priced: kept for its answer, and its question put. */
  private finish(p: Pricing): void {
    this.priced++;
    const d = this.done;
    d.e = p.e;
    d.gen = p.gen;
    d.tick = p.tick;
    d.x = p.x;
    d.z = p.z;
    d.pace = p.pace;
    d.n = p.n;
    d.aim = p.aim;
    d.pins = p.pins;
    for (let j = 0; j < p.n; j++) {
      d.open[j] = p.open[j]!;
      d.lines[j] = p.lines[j]!;
      Object.assign(d.ways[j]!, p.ways[j]!);
      Object.assign(d.vias[j]!, p.vias[j]!);
    }
    this.decide.put(this.id, p.e, 0, this.mind.back(p.e));
  }

  /** Starts pricing a trip into `out`: true where a search is now under way, false where it is priced already. */
  private start(p: Pricing, x0: number, z0: number, x1: number, z1: number, r: number, out: Way, search: boolean): boolean {
    const f = this.finder, line = Math.hypot(x1 - x0, z1 - z0);
    out.none = false;
    out.byWay = true;
    out.seconds = line / p.pace;
    out.danger = dangerLine(p.pins, x0, z0, x1, z1);
    if (line <= r) return false;
    this.charge += 1 + line / SIGHT_METRES;
    if (this.sighter.sight(x0, z0, x1, z1)) return false;
    if (!search) {
      out.byWay = false;
      return false;
    }
    f.body = this.sighter.body;
    f.swim = this.sighter.swim;
    this.tx0 = x0;
    this.tz0 = z0;
    this.tx1 = x1;
    this.tz1 = z1;
    this.trip = out;
    f.budget = PICK_BACK;
    this.searches++;
    this.charge += SEARCH_START;
    if (!f.begin(x1, z1, x0, z0)) {
      out.none = true;
      return false;
    }
    this.phase = 1;
    return true;
  }

  /** Runs the search under way for at most `cells`; returns the cells spent. Settles the trip when the search is over. */
  private advance(cells: number): number {
    const f = this.finder, before = f.expanded, job = this.job!;
    const over = f.run(cells < 250 ? cells : 250);
    const spent = f.expanded - before;
    this.cells += spent;
    if (!over) return spent;
    const status = f.finish(), out = this.trip;
    const reached = status === PATH_FOUND || status === PATH_LEG;
    if (this.phase === 1 && !reached && status !== PATH_NONE && f.expanded >= f.budget) {
      // Nothing shuts the end in that close: out from the mover, with the full budget.
      f.budget = PICK_SEARCH;
      this.searches++;
      this.charge += SEARCH_START;
      if (f.begin(this.tx0, this.tz0, this.tx1, this.tz1)) {
        this.phase = 2;
        return spent;
      }
      out.none = true;
      this.phase = 0;
      return spent;
    }
    this.phase = 0;
    if (status === PATH_NONE || (!reached && f.expanded < f.budget)) {
      out.none = true;
      return spent;
    }
    if (!reached) {
      out.byWay = false;
      return spent;
    }
    let metres = 0;
    for (let k = 1; k < f.count; k++) metres += Math.hypot(f.x[k]! - f.x[k - 1]!, f.z[k]! - f.z[k - 1]!);
    const ex = f.count > 0 ? f.x[f.count - 1]! : 0, ez = f.count > 0 ? f.z[f.count - 1]! : 0;
    // A search back ends at the mover, one out at the choice; either way the rest is the straight line to the far end.
    const back = f.count > 0 && Math.hypot(ex - this.tx0, ez - this.tz0) < Math.hypot(ex - this.tx1, ez - this.tz1);
    const rest = back ? Math.hypot(ex - this.tx0, ez - this.tz0) : Math.hypot(this.tx1 - ex, this.tz1 - ez);
    out.seconds = (metres + rest) / job.pace;
    out.danger = dangerPath(job.pins, f);
    return spent;
  }

  /** Fills the table for `e`'s objective, from its pricing where it is fresh, else by sight and line alone. */
  fill(e: number): boolean {
    const ents = this.world.ents, d = this.done;
    let p: Pricing = d;
    const fresh = d.e === e && d.gen === ents.gen[e] && this.world.tick - d.tick <= PRICED_TICKS && this.same(d);
    if (!fresh) {
      p = this.now;
      if (!this.setup(p, e, this.world.tick, false)) return false;
      while (this.begin(p)) this.phase = 0;
    }
    const o = this.courses.objectiveOf(e)!;
    const n = p.n, aim = p.open[p.aim]!, A = o.choices[aim]!.place, wa = p.ways[p.aim]!, kept = this.courses.keptAim(e);
    const t = this.table, c = PICK.c, w = t.width;
    t.clear(n);
    const pullA = pullAt(p.pins, A);
    for (let j = 0; j < n; j++) {
      const i = p.open[j]!, ch = o.choices[i]!, q = ch.place, row = j * w, wj = p.ways[j]!;
      let priority = q.priority, pull = pullAt(p.pins, q);
      this.aimOf[j] = i;
      this.detourOf[j] = -1;
      if (ch.detour) {
        // A detour is the way to the aim through it.
        const v = p.vias[j]!, extra = Math.max(0, wj.seconds + v.seconds - wa.seconds);
        this.aimOf[j] = aim;
        this.detourOf[j] = i;
        priority = A.priority;
        pull = Math.max(-1, Math.min(1, pull + pullA));
        t.rows[row + c.travelSoon] = soon(wa.seconds, PICK_HALF);
        t.rows[row + c.byWay] = wj.byWay && v.byWay ? 1 : 0;
        t.rows[row + c.noWay] = wj.none || v.none ? 1 : 0;
        t.rows[row + c.danger] = Math.max(wj.danger, v.danger);
        t.rows[row + c.detour] = 1;
        t.rows[row + c.worth] = soon(worthOf(ch), DETOUR_HALF);
        t.rows[row + c.extraSoon] = soon(extra, DETOUR_HALF);
      } else {
        t.rows[row + c.travelSoon] = soon(wj.seconds, PICK_HALF);
        t.rows[row + c.byWay] = wj.byWay ? 1 : 0;
        t.rows[row + c.noWay] = wj.none ? 1 : 0;
        t.rows[row + c.danger] = wj.danger;
        t.rows[row + c.current] = i === kept ? 1 : 0;
      }
      if (q.kind >= 0 && q.kind < WAYPOINT_KINDS.length) t.rows[row + q.kind] = 1;
      t.rows[row + c.priority] = priority / PRIORITY_MOST;
      t.rows[row + c.pull] = pull;
      t.bias[j] = BIAS_PRIORITY * priority + BIAS_PULL * pull;
    }
    return true;
  }

  /** Whether the choices open to `p`'s mover are still those it priced. */
  private same(p: Pricing): boolean {
    const o = this.courses.objectiveOf(p.e);
    if (!o || p.aim < 0) return false;
    let open = 0;
    for (let i = 0; i < o.choices.length; i++) if (this.courses.open(p.e, i)) open++;
    if (open !== p.n) return false;
    for (let j = 0; j < p.n; j++) if (!this.courses.open(p.e, p.open[j]!)) return false;
    return true;
  }

  /** Whether a choice of `pa` priced `wa` comes before one of `pb` priced `wb` in the plain order by a way. */
  private before(pa: number, wa: Way, pb: number, wb: Way): boolean {
    if (wa.none !== wb.none) return !wa.none;
    if (pa !== pb) return pa > pb;
    return wa.seconds < wb.seconds;
  }
}

/** The danger of the straight line from (x0, z0) to (x1, z1): the most of any repelling pin's pull by the share of it inside. */
function dangerLine(pins: readonly Pin[], x0: number, z0: number, x1: number, z1: number): number {
  let worst = 0;
  for (const q of pins) {
    if (q.pull >= 0) continue;
    const [inside, all] = along(q, x0, z0, x1, z1, 0, 0);
    const v = all > 0 ? (-q.pull * inside) / all : 0;
    if (v > worst) worst = v;
  }
  return worst;
}

/** The danger of the finder's last way, as `dangerLine` reads a line. */
function dangerPath(pins: readonly Pin[], f: PathFinder): number {
  let worst = 0;
  for (const q of pins) {
    if (q.pull >= 0) continue;
    let inside = 0, all = 0;
    for (let k = 1; k < f.count; k++) [inside, all] = along(q, f.x[k - 1]!, f.z[k - 1]!, f.x[k]!, f.z[k]!, inside, all);
    const v = all > 0 ? (-q.pull * inside) / all : 0;
    if (v > worst) worst = v;
  }
  return worst;
}

/** Points every DANGER_STEP metres along a segment, and of them those within `q`, added to the counts given. */
function along(q: Pin, x0: number, z0: number, x1: number, z1: number, inside: number, all: number): [number, number] {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / DANGER_STEP)), r2 = q.radius * q.radius;
  for (let k = 1; k <= n; k++) {
    const px = x0 + ((x1 - x0) * k) / n - q.x, pz = z0 + ((z1 - z0) * k) / n - q.z;
    if (px * px + pz * pz <= r2) inside++;
  }
  return [inside, all + n];
}

/** Puts `nav.pick` on `decide` for the objectives `courses` walks, priced against the pins `pinsOf` gives. */
export function addPick(decide: Decide, world: ServerWorld, mind: Behavior, courses: Courses, pinsOf: PinsOf, lane: Lane | null = null): Pick {
  const pick = new Pick(world, mind, courses, pinsOf, decide, lane);
  pick.id = decide.add(pick.point);
  courses.pick = pick;
  return pick;
}
