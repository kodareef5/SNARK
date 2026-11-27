// `nav.pick`: which of an objective's choices a mover makes for next (server/courses.ts). Courses takes the plain pick at
// once, the highest priority and then the nearest by a straight line, and puts the question; an answer acted on in the
// same tick sends the mover elsewhere, through a detour first where one is worth its seconds. Off or watched, the plain
// pick and the plain detours stand.
//
// Each choice is priced by a way, not a line: a straight walk where the body can walk it, else a search of the point's
// own, the searches of one answer held to PICK_CELLS in all. A choice left unsearched is priced by its line and says so.

import { answer as choose } from "../../shared/decide/forward.ts";
import { DETOUR_HALF, PICK, PICK_HALF } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { soon } from "../../shared/decide/units.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { PRIORITY_MOST, WAYPOINT_KINDS, worthOf, type Waypoint } from "../../shared/world/course.ts";
import { PATH_FOUND, PATH_LEG, PATH_NONE, PathFinder } from "../../shared/world/path.ts";
import type { Behavior } from "../behavior.ts";
import type { Courses, Picker } from "../courses.ts";
import type { Pin } from "../pins.ts";
import type { ServerWorld } from "../world.ts";
import { COST_RING, type Decide, type Point } from "./decide.ts";

/** Choices one answer weighs at the most; an objective with more weighs the first of those still open. */
export const PICK_MOST = 16;
/** Cells all the searches of one answer may expand, and one search at the most. */
export const PICK_CELLS = 3000;
export const PICK_SEARCH = 1500;
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

export class Pick implements Picker {
  readonly point: Point;
  /** The point's number on the decider. */
  id = -1;
  /** Searches run and the cells they expanded, since the start. */
  searches = 0;
  cells = 0;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly courses: Courses;
  private readonly pinsOf: PinsOf;
  private readonly decide: Decide;
  private readonly table = tableFor(PICK, PICK_MOST);
  private readonly finder: PathFinder;
  /** Of the last answer, by candidate: the choice made for, and the detour taken first or -1. */
  private readonly aimOf = new Int32Array(PICK_MOST);
  private readonly detourOf = new Int32Array(PICK_MOST);
  private readonly ways: Way[] = Array.from({ length: PICK_MOST }, way);
  private readonly via = way();
  /** Choice indices open, nearest by line first, and their lines in metres. */
  private readonly open = new Int32Array(PICK_MOST);
  private readonly lines = new Float64Array(PICK_MOST);
  private budget = 0;
  private pace = 1;
  private pins: readonly Pin[] = [];

  constructor(world: ServerWorld, mind: Behavior, courses: Courses, pinsOf: PinsOf, decide: Decide) {
    this.world = world;
    this.mind = mind;
    this.courses = courses;
    this.pinsOf = pinsOf;
    this.decide = decide;
    this.finder = new PathFinder(world, world.reg.move[world.reg.index.get("core:survivor") ?? 0]!);
    this.finder.doorways = world.reg.doorway;
    const pick = this;
    this.point = {
      name: "nav.pick", cost: COST_RING, horizon: 0, tables: [{ profile: PICK, table: this.table }],
      still: (e) => (world.ents.flags[e]! & F_AWAKE) !== 0 && courses.objectiveOf(e) !== null,
      answer: (e, _tick, _rung, ask) => (pick.fill(e) ? choose("choice", pick.table, ask(PICK, pick.table)) : -1),
      apply: (e, _tick, _rung, k) => void courses.take(e, pick.aimOf[k]!, pick.detourOf[k]!),
    };
  }

  on(): boolean {
    return this.decide.on(this.id);
  }

  acts(): boolean {
    return this.decide.acts(this.id);
  }

  ask(e: number): void {
    this.decide.put(this.id, e, 0, this.mind.back(e));
  }

  /** Fills the table for `e`'s objective. False where no choice it may end at is open. */
  fill(e: number): boolean {
    const o = this.courses.objectiveOf(e), body = this.mind.walkerOf(e);
    if (!o || !body) return false;
    const ents = this.world.ents, x = ents.x[e]!, z = ents.z[e]!;
    // The open choices, nearest first, so a search the budget leaves out is of the farthest.
    let n = 0, ends = 0;
    for (let i = 0; i < o.choices.length && n < PICK_MOST; i++) {
      if (!this.courses.open(e, i)) continue;
      const p = o.choices[i]!.place, d = Math.hypot(p.x - x, p.z - z);
      let j = n++;
      for (; j > 0 && this.lines[j - 1]! > d; j--) {
        this.open[j] = this.open[j - 1]!;
        this.lines[j] = this.lines[j - 1]!;
      }
      this.open[j] = i;
      this.lines[j] = d;
      if (!o.choices[i]!.detour) ends++;
    }
    if (ends === 0) return false;
    this.finder.body = body;
    this.pace = Math.max(LEAST_PACE, this.courses.speedOf(e));
    this.budget = PICK_CELLS;
    this.pins = ents.team[e] !== 0 ? this.pinsOf(ents.team[e]!) : [];
    for (let j = 0; j < n; j++) {
      const p = o.choices[this.open[j]!]!.place;
      this.price(x, z, p.x, p.z, p.radius, this.ways[j]!);
    }
    // The aim a detour is weighed against: the plain order of priority, then seconds by a way, never where none leads.
    let a = -1;
    for (let j = 0; j < n; j++) {
      const c = o.choices[this.open[j]!]!;
      if (c.detour) continue;
      if (a < 0 || this.before(c.place.priority, this.ways[j]!, o.choices[this.open[a]!]!.place.priority, this.ways[a]!)) a = j;
    }
    const aim = this.open[a]!, A = o.choices[aim]!.place, wa = this.ways[a]!, kept = this.courses.keptAim(e);
    const t = this.table, c = PICK.c, w = t.width;
    t.clear(n);
    const pullA = pullAt(this.pins, A);
    for (let j = 0; j < n; j++) {
      const i = this.open[j]!, ch = o.choices[i]!, p = ch.place, row = j * w, wj = this.ways[j]!;
      let priority = p.priority, pull = pullAt(this.pins, p);
      this.aimOf[j] = i;
      this.detourOf[j] = -1;
      if (ch.detour) {
        // A detour is the way to the aim through it.
        this.price(p.x, p.z, A.x, A.z, A.radius, this.via);
        const v = this.via, extra = Math.max(0, wj.seconds + v.seconds - wa.seconds);
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
      if (p.kind >= 0 && p.kind < WAYPOINT_KINDS.length) t.rows[row + p.kind] = 1;
      t.rows[row + c.priority] = priority / PRIORITY_MOST;
      t.rows[row + c.pull] = pull;
      t.bias[j] = BIAS_PRIORITY * priority + BIAS_PULL * pull;
    }
    return true;
  }

  /** Whether a choice of `pa` priced `wa` comes before one of `pb` priced `wb` in the plain order by a way. */
  private before(pa: number, wa: Way, pb: number, wb: Way): boolean {
    if (wa.none !== wb.none) return !wa.none;
    if (pa !== pb) return pa > pb;
    return wa.seconds < wb.seconds;
  }

  /** Prices the trip from (x0, z0) to within `r` of (x1, z1) into `out`: a straight walk, else a search, else the line. */
  private price(x0: number, z0: number, x1: number, z1: number, r: number, out: Way): void {
    const f = this.finder, line = Math.hypot(x1 - x0, z1 - z0);
    out.none = false;
    out.byWay = true;
    out.seconds = line / this.pace;
    if (line <= r || f.sight(x0, z0, x1, z1)) {
      out.danger = this.dangerLine(x0, z0, x1, z1);
      return;
    }
    if (this.budget <= 0) {
      out.byWay = false;
      out.danger = this.dangerLine(x0, z0, x1, z1);
      return;
    }
    f.budget = Math.min(PICK_SEARCH, this.budget);
    const status = f.find(x0, z0, x1, z1);
    this.budget -= f.expanded;
    this.searches++;
    this.cells += f.expanded;
    if (status === PATH_NONE) {
      out.none = true;
      out.danger = this.dangerLine(x0, z0, x1, z1);
      return;
    }
    // Ended short with cells to spare: nothing more could be reached, and no way leads there.
    const reached = status === PATH_FOUND || status === PATH_LEG;
    if (!reached && f.expanded < f.budget) out.none = true;
    else if (!reached) out.byWay = false;
    let metres = 0, danger = 0, worst = 0;
    for (let k = 1; k < f.count; k++) metres += Math.hypot(f.x[k]! - f.x[k - 1]!, f.z[k]! - f.z[k - 1]!);
    const lx = f.count > 0 ? f.x[f.count - 1]! : x0, lz = f.count > 0 ? f.z[f.count - 1]! : z0;
    const rest = Math.hypot(x1 - lx, z1 - lz);
    if (reached) out.seconds = (metres + rest) / this.pace;
    for (const q of this.pins) {
      if (q.pull >= 0) continue;
      let inside = 0, all = 0;
      for (let k = 1; k < f.count; k++) [inside, all] = this.along(q, f.x[k - 1]!, f.z[k - 1]!, f.x[k]!, f.z[k]!, inside, all);
      if (rest > 0) [inside, all] = this.along(q, lx, lz, x1, z1, inside, all);
      danger = all > 0 ? (-q.pull * inside) / all : 0;
      if (danger > worst) worst = danger;
    }
    out.danger = worst;
  }

  /** The danger of the straight line from (x0, z0) to (x1, z1): the most of any repelling pin's pull by the share of it inside. */
  private dangerLine(x0: number, z0: number, x1: number, z1: number): number {
    let worst = 0;
    for (const q of this.pins) {
      if (q.pull >= 0) continue;
      const [inside, all] = this.along(q, x0, z0, x1, z1, 0, 0);
      const v = all > 0 ? (-q.pull * inside) / all : 0;
      if (v > worst) worst = v;
    }
    return worst;
  }

  /** Points every DANGER_STEP metres along a segment, and of them those within `q`, added to the counts given. */
  private along(q: Pin, x0: number, z0: number, x1: number, z1: number, inside: number, all: number): [number, number] {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / DANGER_STEP)), r2 = q.radius * q.radius;
    for (let k = 1; k <= n; k++) {
      const px = x0 + ((x1 - x0) * k) / n - q.x, pz = z0 + ((z1 - z0) * k) / n - q.z;
      if (px * px + pz * pz <= r2) inside++;
    }
    return [inside, all + n];
  }
}

/** Puts `nav.pick` on `decide` for the objectives `courses` walks, priced against the pins `pinsOf` gives. */
export function addPick(decide: Decide, world: ServerWorld, mind: Behavior, courses: Courses, pinsOf: PinsOf): Pick {
  const pick = new Pick(world, mind, courses, pinsOf, decide);
  pick.id = decide.add(pick.point);
  courses.pick = pick;
  return pick;
}
