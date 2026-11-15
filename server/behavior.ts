// Decides the input of a creature nobody rides. The input feeds the same movement and action step as a survivor's (D76).
// Thinking is staggered by entity index, so a crowd's thinking is spread evenly over ticks.
// A creature heads straight for what it wants. Only when it is stuck, or a hunter or follower sees the line blocked, does it ask
// for a way round, and the searches of the whole server share one budget a tick.

import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { DMG_MELEE } from "../shared/sim/damage.ts";
import { BTN_PRIMARY, BTN_SPRINT, MF_OUT, stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, wider } from "../shared/sim/entities.ts";
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { GROUND_FREE, PATH_FOUND, PATH_LEG, PATH_NONE, PATH_REACH, PATH_SHORT, PathFinder, groundAt, shapeStamp } from "../shared/world/path.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../shared/world/ray.ts";
import { BodyGrid } from "./bodies.ts";
import type { GameServer } from "./game.ts";
import type { ServerWorld } from "./world.ts";

export const TEMPER_FLEES = 0;
export const TEMPER_DEFENDS = 1;
export const TEMPER_HUNTS = 2;
export const TEMPERS: readonly string[] = ["flees", "defends", "hunts"];

/** Neutral fights back when it or a nearby tribe mate is hurt. Aggressive also goes for wild creatures and strangers it sees. */
export const STANCE_PASSIVE = 0;
export const STANCE_NEUTRAL = 1;
export const STANCE_AGGRESSIVE = 2;
export const STANCES: readonly string[] = ["passive", "neutral", "aggressive"];

export const MIND_WANDER = 0;
export const MIND_FLEE = 1;
export const MIND_HUNT = 2;

/** A creature thinks once every THINK_TICKS. One that hunts, follows or flees corrects its heading every STEER_TICKS, and every tick on a way. */
export const THINK_TICKS = 15;
const STEER_TICKS = 3;
const FLEE_TICKS = 5 * TICK_RATE;
/** A hunt ends after HUNT_TICKS. After giving one up, a creature looks for no new prey for REST_TICKS. */
const HUNT_TICKS = 40 * TICK_RATE;
const REST_TICKS = 6 * TICK_RATE;
/** A hunter keeps chasing out to this many times its sight range. */
const KEEP = 1.6;
/** Metres. A follower stops FOLLOW_NEAR from its leader, plus both body radii, and sprints when more than FOLLOW_RUN behind. */
const FOLLOW_NEAR = 2.5;
const FOLLOW_RUN = 12;
/** Metres. An owned creature helps a tribe mate hurt within this distance. */
const HELP_RANGE = 25;

/** A creature that means to move and covers less than STUCK_SHARE of its walking pace for STUCK_TICKS ticks in a row is stuck. */
export const STUCK_TICKS = 6;
const STUCK_SHARE = 0.3;
/**
 * Cells the path searches of all creatures may expand in one tick, and one search in all. A cell costs about a microsecond,
 * two on a busy machine, so this is one or two milliseconds of a 33 ms tick at most. A search may run over several ticks.
 */
export const PATH_TICK_CELLS = 1000;
export const SEARCH_CELLS = 4000;
/** What starting a search costs, counted in cells: clearing its grid. */
const SEARCH_START = 10;
/** After a search a creature asks for no other for ASK_TICKS, or for NO_WAY_TICKS after one that found no way. */
const ASK_TICKS = TICK_RATE;
const NO_WAY_TICKS = 5 * TICK_RATE;
/** Metres. A creature on a way asks for another when its goal has gone this far from where the way was found to. */
const GOAL_MOVED = 4;
/** Metres. A way that ends further than this from its goal leads only as near as the search could get. */
const SHORT_OF = 1.5;
/** Points kept of a way. A longer one is followed that far and then found again. */
const ROUTE_POINTS = 32;
/** Metres. A point of a way is reached within this, or once passed. */
const ARRIVE = 0.5;
/**
 * Metres. A way holds while no chunk within this of it changes shape: further than any piece or node reaches from its middle
 * (a banyan's outer trunks, 13 m), with a body's radius.
 */
export const ROUTE_MARGIN = 16;

/** Where a creature is with its way: heading straight, on a way, or told that no way was found. */
const WAY_STRAIGHT = 0;
const WAY_ON = 1;
const WAY_NONE = 2;
/** A search asked for by a creature with no way, or to refresh one it is on. */
const ASK_NOW = 1;
const ASK_LATER = 2;

/** A way a creature follows. */
class Route {
  readonly x = new Float32Array(ROUTE_POINTS);
  readonly z = new Float32Array(ROUTE_POINTS);
  count = 0;
  /** The point it heads for. The first is where it stood. */
  next = 1;
  /** Where the goal was when the way was found. */
  gx = 0;
  gz = 0;
  /** It ends short of the goal, as near as the search could get. */
  short = false;
  /** The rectangle the way crosses, with the margin, and the shape stamp of its chunks then. */
  minX = 0;
  minZ = 0;
  maxX = 0;
  maxZ = 0;
  stamp = 0;
}

/** Entity indices, oldest first. */
class Queue {
  list: number[] = [];
  at = 0;

  /** Drops the taken entries once they are most of the list. */
  trim(): void {
    if (this.at > 4096 && this.at * 2 > this.list.length) {
      this.list = this.list.slice(this.at);
      this.at = 0;
    }
  }
}

export class Behavior {
  // Every column is by entity index, and is replaced when the entity store grows.
  /** A MIND_ value. */
  mind = new Uint8Array(0);
  /** The decided input. move is forward effort, -127 to 127. look and pitch are in wire units. pressed holds the buttons that go down this tick. */
  move = new Int8Array(0);
  look = new Uint16Array(0);
  pitch = new Int16Array(0);
  buttons = new Uint8Array(0);
  pressed = new Uint8Array(0);
  /** For an owned creature: a STANCE_ value, and the entity it follows, or -1 to stay. */
  stance = new Uint8Array(0);
  leader = new Int32Array(0);
  /** Ticks in a row it has been stuck, as `moved` counts them. */
  stuck = new Uint8Array(0);
  private leaderGen = new Uint16Array(0);
  /** Owned creatures that are awake. */
  readonly owned = new Set<number>();
  /** Every awake creature, set by Creatures. The grid of wild creatures is filled from it. */
  herd: { readonly awake: Int32Array; awakeCount: number } | null = null;
  /** `bites` counts bite presses, not hits. */
  hunts = 0;
  gaveUp = 0;
  bites = 0;
  /** Searches finished, cells they expanded all told, and the cells spent in the last tick, start costs included. */
  searches = 0;
  searched = 0;
  spent = 0;
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly reg: Registry;
  private readonly rng: Rng;
  /**
   * The hunted entity and its generation, where the hunt began (for a fleeing creature, the point it makes for), the tick the
   * current state ends, and the tick it may next look for prey.
   */
  private target = new Int32Array(0);
  private targetGen = new Uint16Array(0);
  private homeX = new Float32Array(0);
  private homeZ = new Float32Array(0);
  private until = new Uint32Array(0);
  private rested = new Uint32Array(0);
  /** A WAY_ value, and one more than the index in `routes` of the creature's way, or 0 before it has had one. */
  private way = new Uint8Array(0);
  private routeOf = new Int32Array(0);
  private readonly routes: Route[] = [];
  /** An ASK_ value while it waits for a search, and the tick before which it may not ask again. */
  private asked = new Uint8Array(0);
  private askAfter = new Uint32Array(0);
  private readonly urgent = new Queue();
  private readonly later = new Queue();
  private readonly finder: PathFinder;
  /** The creature whose search is under way, or -1, and the shape stamp of the search's grid when it began. */
  private searching = -1;
  private window = 0;
  private windowX = 0;
  private windowZ = 0;
  /** Survivors and creatures that are somebody's, and wild creatures, with the tick each was last filled. */
  private readonly claimed: BodyGrid;
  private readonly wild: BodyGrid;
  private claimedAt = -1;
  private wildAt = -1;

  constructor(world: ServerWorld, game: GameServer, seed: number) {
    this.world = world;
    this.game = game;
    this.reg = world.reg;
    this.rng = new Rng(seed);
    // Each search is for the body that asked.
    this.finder = new PathFinder(world, { radius: 0.5, height: 1, slopeCos: 0.5, stepUp: 0.5 });
    this.finder.budget = SEARCH_CELLS;
    this.finder.doorways = world.reg.doorway;
    this.claimed = new BodyGrid(world.dims);
    this.wild = new BodyGrid(world.dims);
    this.widen(world.ents.cap);
    world.ents.onGrow.push((cap) => this.widen(cap));
  }

  /** Gives every column room for `cap` entities. */
  private widen(cap: number): void {
    this.mind = wider(this.mind, cap);
    this.move = wider(this.move, cap);
    this.look = wider(this.look, cap);
    this.pitch = wider(this.pitch, cap);
    this.buttons = wider(this.buttons, cap);
    this.pressed = wider(this.pressed, cap);
    this.stance = wider(this.stance, cap, STANCE_NEUTRAL);
    this.leader = wider(this.leader, cap, -1);
    this.stuck = wider(this.stuck, cap);
    this.leaderGen = wider(this.leaderGen, cap);
    this.target = wider(this.target, cap, -1);
    this.targetGen = wider(this.targetGen, cap);
    this.homeX = wider(this.homeX, cap);
    this.homeZ = wider(this.homeZ, cap);
    this.until = wider(this.until, cap);
    this.rested = wider(this.rested, cap);
    this.way = wider(this.way, cap);
    this.routeOf = wider(this.routeOf, cap);
    this.asked = wider(this.asked, cap);
    this.askAfter = wider(this.askAfter, cap);
  }

  reset(e: number): void {
    this.mind[e] = MIND_WANDER;
    this.move[e] = 0;
    this.buttons[e] = this.pressed[e] = 0;
    this.pitch[e] = 0;
    this.look[e] = this.world.ents.yaw[e]!;
    this.target[e] = -1;
    this.until[e] = 0;
    this.rested[e] = 0;
    this.stance[e] = STANCE_NEUTRAL;
    this.leader[e] = -1;
    this.owned.delete(e);
    this.lose(e);
  }

  /** `whom` is an entity index, or -1 to stay. */
  follow(e: number, whom: number): void {
    if (whom !== this.leader[e] && this.mind[e] !== MIND_HUNT) this.lose(e);
    this.leader[e] = whom;
    if (whom >= 0) this.leaderGen[e] = this.world.ents.gen[whom]!;
    else if (this.mind[e] !== MIND_HUNT) this.stay(e, 0);
  }

  /** Sets an owned creature's stance. One made passive drops its hunt. */
  order(e: number, stance: number): void {
    this.stance[e] = stance;
    if (stance === STANCE_PASSIVE && this.mind[e] === MIND_HUNT) this.wander(e, this.world.tick, 0);
  }

  /**
   * `by` hurt `victim`, a member of `team`. Each creature of that team within HELP_RANGE of the victim
   * goes for `by`, unless it is passive or already hunting.
   */
  alert(team: number, victim: number, by: number): void {
    if (team === 0 || by < 0 || this.owned.size === 0) return;
    const ents = this.world.ents;
    if (ents.team[by] === team) return;
    const tick = this.world.tick;
    const grid = this.claimedNow();
    const n = grid.near(ents.x[victim]!, ents.z[victim]!, HELP_RANGE + 1);
    for (let k = 0; k < n; k++) {
      const e = grid.found[k]!;
      if (e === victim || !this.owned.has(e) || ents.team[e] !== team || this.stance[e] === STANCE_PASSIVE || this.mind[e] === MIND_HUNT || (ents.mflags[e]! & MF_OUT) !== 0) continue;
      const dx = ents.x[e]! - ents.x[victim]!;
      const dz = ents.z[e]! - ents.z[victim]!;
      if (dx * dx + dz * dz <= HELP_RANGE * HELP_RANGE) this.hunt(e, by, tick);
    }
  }

  /** Stands still until tick `until`, unless something hurts it first. */
  stay(e: number, until: number): void {
    this.mind[e] = MIND_WANDER;
    this.target[e] = -1;
    this.move[e] = 0;
    this.buttons[e] = 0;
    this.pitch[e] = 0;
    this.until[e] = until;
    this.rested[e] = until;
    this.lose(e);
  }

  /** The entity index `e` hunts, or -1. */
  targetOf(e: number): number {
    return this.mind[e] === MIND_HUNT ? this.target[e]! : -1;
  }

  /** How many points of a way `e` has left to follow, 0 if it heads straight. */
  wayLeft(e: number): number {
    if (this.way[e] !== WAY_ON) return 0;
    const r = this.route(e);
    return r.count - r.next;
  }

  /** Something at (x, z) hurt `e`. `by` is the entity that did it, or -1. A creature that flees runs away from (x, z). */
  provoke(e: number, x: number, z: number, by: number): void {
    const ents = this.world.ents;
    const tick = this.world.tick;
    const team = ents.team[e]!;
    // An unclaimed young creature reacts to nothing.
    if (team === 0 && ents.grown[e] !== 0) return;
    if (team !== 0) {
      // An owned creature goes by its stance, not its species' temper, and never attacks its own team.
      if (this.stance[e] !== STANCE_PASSIVE && by >= 0 && by !== e && ents.team[by] !== team) this.hunt(e, by, tick);
      return;
    }
    if (this.reg.temper[ents.kind[e]!] !== TEMPER_FLEES && by >= 0 && by !== e) {
      this.hunt(e, by, tick);
      return;
    }
    this.flee(e, x, z, tick);
  }

  /**
   * After a step: `e` went (dx, dz), where a body walking freely goes `pace` metres a tick. Counts the ticks it has meant to
   * move and barely has.
   */
  moved(e: number, dx: number, dz: number, pace: number): void {
    if (this.move[e] === 0 || dx * dx + dz * dz >= STUCK_SHARE * STUCK_SHARE * pace * pace) this.stuck[e] = 0;
    else if (this.stuck[e]! < 255) this.stuck[e]!++;
  }

  /** Spends this tick's search budget, on those with no way first and in the order they asked. Call once a tick, before steering. */
  plan(tick: number): void {
    const f = this.finder;
    let left = PATH_TICK_CELLS;
    while (left > 0) {
      let e = this.searching;
      // One that fell asleep meanwhile asks again when it wakes and wants a way.
      if (e >= 0 && (this.world.ents.flags[e]! & F_AWAKE) === 0) {
        this.asked[e] = 0;
        e = this.searching = -1;
      }
      if (e < 0) {
        if (left <= SEARCH_START) break;
        e = this.pop();
        if (e < 0) break;
        const begun = this.begin(e);
        if (begun < 0) {
          this.asked[e] = 0;
          continue;
        }
        left -= SEARCH_START;
        if (begun === 0) {
          this.answer(e, tick, PATH_NONE);
          continue;
        }
        this.searching = e;
      }
      const before = f.expanded;
      const over = f.run(left);
      left -= f.expanded - before;
      this.searched += f.expanded - before;
      if (!over) break;
      this.searching = -1;
      this.answer(e, tick, f.finish());
    }
    this.spent = PATH_TICK_CELLS - left;
    this.urgent.trim();
    this.later.trim();
  }

  private hunt(e: number, prey: number, tick: number): void {
    const ents = this.world.ents;
    if (this.mind[e] !== MIND_HUNT) {
      this.homeX[e] = ents.x[e]!;
      this.homeZ[e] = ents.z[e]!;
      this.hunts++;
    }
    if (this.mind[e] !== MIND_HUNT || this.target[e] !== prey) this.lose(e);
    this.mind[e] = MIND_HUNT;
    this.target[e] = prey;
    this.targetGen[e] = ents.gen[prey]!;
    this.until[e] = tick + HUNT_TICKS;
    this.aim(e, prey);
    if (this.blocked(e, prey, tick)) this.ask(e, tick, ASK_NOW);
  }

  private wander(e: number, tick: number, rest: number): void {
    if (this.mind[e] === MIND_HUNT) this.gaveUp++;
    this.mind[e] = MIND_WANDER;
    this.target[e] = -1;
    this.move[e] = 0;
    this.buttons[e] = 0;
    this.pitch[e] = 0;
    this.until[e] = tick;
    this.rested[e] = tick + rest;
    this.lose(e);
  }

  /** Runs from (x, z) for FLEE_TICKS, toward a point as far off as it runs in that time. */
  private flee(e: number, x: number, z: number, tick: number): void {
    const ents = this.world.ents;
    const a = Math.atan2(ents.x[e]! - x, ents.z[e]! - z);
    this.lose(e);
    this.mind[e] = MIND_FLEE;
    this.look[e] = Math.round((a / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = 0;
    this.move[e] = 127;
    this.buttons[e] = BTN_SPRINT;
    this.until[e] = tick + FLEE_TICKS;
    const p = this.reg.move[ents.kind[e]!]!;
    const run = (p.walkSpeed * p.sprintMul * FLEE_TICKS) / TICK_RATE;
    this.homeX[e] = ents.x[e]! + Math.sin(a) * run;
    this.homeZ[e] = ents.z[e]! + Math.cos(a) * run;
    if (this.blocked(e, -1, tick)) this.ask(e, tick, ASK_NOW);
  }

  /**
   * A hunter that cannot reach its prey gives up. A wild one runs from it (as the reference's wild creatures do when they cannot
   * reach their target) and rests after; one that is somebody's stops.
   */
  private giveUp(e: number, tick: number): void {
    const prey = this.target[e]!;
    if (this.world.ents.team[e] !== 0) return this.wander(e, tick, REST_TICKS);
    this.gaveUp++;
    this.flee(e, this.world.ents.x[prey]!, this.world.ents.z[prey]!, tick);
    this.rested[e] = this.until[e]! + REST_TICKS;
  }

  /** Forgets its way and any search it asked for, because what it heads for changed. */
  private lose(e: number): void {
    this.way[e] = WAY_STRAIGHT;
    this.asked[e] = 0;
    this.askAfter[e] = 0;
    this.stuck[e] = 0;
    if (this.searching === e) this.searching = -1;
  }

  /** The way of `e`, made the first time it needs one. */
  private route(e: number): Route {
    if (this.routeOf[e] === 0) {
      this.routes.push(new Route());
      this.routeOf[e] = this.routes.length;
    }
    return this.routes[this.routeOf[e]! - 1]!;
  }

  /** Aims at the middle of `prey`. Returns the flat distance to it. */
  private aim(e: number, prey: number): number {
    const ents = this.world.ents;
    const reg = this.reg;
    const dx = ents.x[prey]! - ents.x[e]!;
    const dz = ents.z[prey]! - ents.z[e]!;
    const flat = Math.sqrt(dx * dx + dz * dz);
    const eye = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, 0);
    const dy = ents.y[prey]! + reg.bodyHeight[ents.kind[prey]!]! * 0.55 - eye;
    this.look[e] = Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = Math.round((Math.atan2(dy, flat) / (Math.PI / 2)) * 16384);
    return flat;
  }

  /** What castWorld meets first on the line from the eye of `e` to the middle of `o`. rayHit says where. */
  private between(e: number, o: number): number {
    const ents = this.world.ents;
    return this.line(e, ents.x[o]!, ents.y[o]! + this.reg.bodyHeight[ents.kind[o]!]! * 0.55, ents.z[o]!);
  }

  /** What castWorld meets first on the line from the eye of `e` to (x, y, z), or at eye height when `y` is NaN. */
  private line(e: number, x: number, y: number, z: number): number {
    const ents = this.world.ents;
    const ex = ents.x[e]!;
    const ez = ents.z[e]!;
    const eye = ents.y[e]! + stanceEye(this.reg.move[ents.kind[e]!]!, 0);
    const dx = x - ex;
    const dy = Number.isNaN(y) ? 0 : y - eye;
    const dz = z - ez;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return far > 0.5 ? castWorld(this.world, ex, eye, ez, dx / far, dy / far, dz / far, far) : HIT_NONE;
  }

  /** Survivors and the awake creatures that are somebody's, by where they stood when first wanted this tick. */
  private claimedNow(): BodyGrid {
    const grid = this.claimed;
    if (this.claimedAt === this.world.tick) return grid;
    this.claimedAt = this.world.tick;
    const ents = this.world.ents;
    grid.clear();
    for (const c of this.game.clients) if (c?.active && !c.closed && c.ent >= 0) grid.add(c.ent, ents.x[c.ent]!, ents.z[c.ent]!);
    for (const o of this.owned) grid.add(o, ents.x[o]!, ents.z[o]!);
    return grid;
  }

  /** The awake wild creatures, likewise. Only an aggressive tame looks among them. */
  private wildNow(): BodyGrid {
    const grid = this.wild;
    if (this.wildAt === this.world.tick) return grid;
    this.wildAt = this.world.tick;
    const ents = this.world.ents;
    grid.clear();
    const herd = this.herd;
    if (herd) {
      for (let k = 0; k < herd.awakeCount; k++) {
        const o = herd.awake[k]!;
        if (ents.team[o] === 0) grid.add(o, ents.x[o]!, ents.z[o]!);
      }
    }
    return grid;
  }

  /** The nearest target `e` can see within its sight range, as an entity index, or -1. */
  private prey(e: number): number {
    const ents = this.world.ents;
    const kind = ents.kind[e]!;
    const sight = this.reg.sight[kind]!;
    const ex = ents.x[e]!;
    const ez = ents.z[e]!;
    let best = -1;
    let near = sight * sight;
    const team = ents.team[e]!;
    // Survivors and creatures that are somebody's. An aggressive owned creature goes for wild creatures too.
    for (let pass = 0; pass < (team !== 0 ? 2 : 1); pass++) {
      const grid = pass === 0 ? this.claimedNow() : this.wildNow();
      // A metre more, for bodies that moved since the grid was filled.
      const n = grid.near(ex, ez, sight + 1);
      for (let k = 0; k < n; k++) {
        const o = grid.found[k]!;
        // Skips itself, the dead, its own team and unclaimed young.
        if (o === e || (ents.flags[o]! & F_ALIVE) === 0 || (team !== 0 && ents.team[o] === team) || (ents.team[o] === 0 && ents.grown[o] !== 0)) continue;
        const dx = ents.x[o]! - ex;
        const dz = ents.z[o]! - ez;
        const d2 = dx * dx + dz * dz;
        if (d2 >= near) continue;
        // The target must be in line of sight, with nothing castWorld hits between the eye and the target's middle.
        if (this.between(e, o) !== HIT_NONE) continue;
        near = d2;
        best = o;
      }
    }
    return best;
  }

  /** Most ticks this only clears last tick's press. `act` is the body's current ACT_ value. */
  steer(e: number, tick: number, act: number): void {
    this.pressed[e] = 0;
    // An unconscious creature drops what it was doing.
    if ((this.world.ents.mflags[e]! & MF_OUT) !== 0) {
      if (this.mind[e] !== MIND_WANDER || this.move[e] !== 0) this.wander(e, tick, REST_TICKS);
      return;
    }
    const mind = this.mind[e]!;
    const turn = (tick + e) % THINK_TICKS === 0;
    const heading = turn || (tick + e) % STEER_TICKS === 0 || this.way[e] === WAY_ON;
    const ents = this.world.ents;
    if (mind === MIND_HUNT) {
      if (!heading) return;
      const reg = this.reg;
      const kind = ents.kind[e]!;
      const prey = this.target[e]!;
      // The prey is gone, dead, replaced, or now on its own team.
      if (prey < 0 || (ents.flags[prey]! & F_ALIVE) === 0 || ents.gen[prey] !== this.targetGen[e] || (ents.team[e] !== 0 && ents.team[prey] === ents.team[e])) return this.wander(e, tick, 0);
      const flat = this.aim(e, prey);
      const hx = ents.x[e]! - this.homeX[e]!;
      const hz = ents.z[e]! - this.homeZ[e]!;
      const leash = reg.leash[kind]!;
      // It gives up when led past its leash, when the prey is too far, or when the hunt has run too long. Then it rests.
      if (hx * hx + hz * hz > leash * leash || flat > reg.sight[kind]! * KEEP || tick >= this.until[e]!) return this.wander(e, tick, REST_TICKS);
      // Within reach it stops and bites, else it runs at the prey. Reach counts from its eye to half a radius inside the prey.
      const reach = reg.reach[kind]! + reg.bodyRadius[ents.kind[prey]!]! * 0.5;
      if (flat <= reach) {
        this.way[e] = WAY_STRAIGHT;
        this.move[e] = 0;
        this.buttons[e] = 0;
        if (act === ACT_NONE) {
          // A piece its bite cannot harm stands between them: it cannot reach its prey.
          if (this.walled(e, prey)) return this.giveUp(e, tick);
          this.pressed[e] = BTN_PRIMARY;
          this.bites++;
        }
        return;
      }
      this.move[e] = 127;
      this.buttons[e] = BTN_SPRINT;
      if (!this.head(e, tick, ents.x[prey]!, ents.z[prey]!, turn && this.blocked(e, prey, tick))) this.giveUp(e, tick);
      return;
    }
    if (ents.team[e] !== 0) {
      // An owned creature follows its leader or stands. An aggressive one first looks for prey on its turn.
      if (turn && this.stance[e] === STANCE_AGGRESSIVE && tick >= this.rested[e]!) {
        const prey = this.prey(e);
        if (prey >= 0) return this.hunt(e, prey, tick);
      }
      if (!heading) return;
      const whom = this.leader[e]!;
      if (whom < 0 || (ents.flags[whom]! & F_ALIVE) === 0 || ents.gen[whom] !== this.leaderGen[e]) {
        if (whom >= 0) {
          this.leader[e] = -1;
          this.lose(e);
        }
        this.move[e] = 0;
        this.buttons[e] = 0;
        return;
      }
      const flat = this.aim(e, whom);
      this.pitch[e] = 0;
      const near = FOLLOW_NEAR + this.reg.bodyRadius[ents.kind[e]!]! + this.reg.bodyRadius[ents.kind[whom]!]!;
      if (flat <= near) this.way[e] = WAY_STRAIGHT;
      this.move[e] = flat <= near ? 0 : flat > FOLLOW_RUN ? 127 : 90;
      this.buttons[e] = flat > FOLLOW_RUN ? BTN_SPRINT : 0;
      // With no way to its leader it waits.
      if (flat > near && !this.head(e, tick, ents.x[whom]!, ents.z[whom]!, turn && this.blocked(e, whom, tick))) {
        this.move[e] = 0;
        this.buttons[e] = 0;
      }
      return;
    }
    // An unclaimed young creature waits where it hatched.
    if (ents.grown[e] !== 0) {
      this.move[e] = 0;
      this.buttons[e] = 0;
      return;
    }
    if (mind === MIND_FLEE) {
      if (tick < this.until[e]!) {
        // With no way away it stands, rather than run at a wall.
        if (heading) {
          const away = this.head(e, tick, this.homeX[e]!, this.homeZ[e]!, turn && this.blocked(e, -1, tick));
          this.move[e] = away ? 127 : 0;
          this.buttons[e] = away ? BTN_SPRINT : 0;
        }
        return;
      }
      this.wander(e, tick, Math.max(0, this.rested[e]! - tick));
    }
    if (!turn && tick < this.until[e]!) return;
    if (turn && this.reg.temper[ents.kind[e]!] === TEMPER_HUNTS && tick >= this.rested[e]!) {
      const prey = this.prey(e);
      if (prey >= 0) return this.hunt(e, prey, tick);
    }
    if (tick < this.until[e]!) return;
    const rng = this.rng;
    this.move[e] = rng.int(3) === 0 ? 0 : 90;
    this.look[e] = rng.int(65536);
    this.buttons[e] = 0;
    this.until[e] = tick + 30 + rng.int(150);
  }

  /**
   * Whether `e`, heading straight and free to ask for a search, sees a piece or a node between it and `o`, or with `o` -1
   * on the level toward its flee point. The ground between is not counted: a crest hides a body that can still be walked to.
   */
  private blocked(e: number, o: number, tick: number): boolean {
    if (this.way[e] !== WAY_STRAIGHT || this.asked[e] !== 0 || tick < this.askAfter[e]!) return false;
    const hit = o >= 0 ? this.between(e, o) : this.line(e, this.homeX[e]!, NaN, this.homeZ[e]!);
    return hit === HIT_STRUCTURE || hit === HIT_NODE;
  }

  /** Whether the bite of `e` at `prey` would land on a piece that its kind of damage does not harm. */
  private walled(e: number, prey: number): boolean {
    if (this.between(e, prey) !== HIT_STRUCTURE) return false;
    const structs = this.world.structs;
    const t = structs.chunks[Math.floor(rayHit.ref / 65536)];
    const takes = t ? this.reg.structTakes[t.kind[rayHit.ref & 0xffff]!] : null;
    return !takes || !(takes[DMG_MELEE]! > 0);
  }

  /**
   * Turns `e` for this tick toward the next point of its way to (gx, gz), if it is on one. Heading straight, its look stays as
   * the caller set it. A creature stuck, or whose line the caller found `blocked`, asks for a way. False when there is none.
   */
  private head(e: number, tick: number, gx: number, gz: number, blocked: boolean): boolean {
    if (this.way[e] === WAY_NONE) {
      if (tick < this.askAfter[e]!) return false;
      this.way[e] = WAY_STRAIGHT;
    }
    const ents = this.world.ents;
    const x = ents.x[e]!;
    const z = ents.z[e]!;
    if (this.way[e] === WAY_ON) {
      const r = this.route(e);
      // A point is reached when near it, or once past it along the leg that leads to it.
      while (r.next < r.count) {
        const px = r.x[r.next]!;
        const pz = r.z[r.next]!;
        const dx = x - px;
        const dz = z - pz;
        if (dx * dx + dz * dz > ARRIVE * ARRIVE && dx * (px - r.x[r.next - 1]!) + dz * (pz - r.z[r.next - 1]!) < 0) break;
        r.next++;
      }
      if (r.next >= r.count) {
        this.way[e] = WAY_STRAIGHT;
        if (r.short) {
          this.way[e] = WAY_NONE;
          this.askAfter[e] = tick + NO_WAY_TICKS;
          return false;
        }
      } else if (this.stuck[e]! >= STUCK_TICKS) {
        // The way did not hold.
        this.way[e] = WAY_STRAIGHT;
      } else {
        if ((tick + e) % THINK_TICKS === 0) {
          if (shapeStamp(this.world, r.minX, r.minZ, r.maxX, r.maxZ) !== r.stamp) {
            // Something was built or taken away across it: it is found again at once.
            this.way[e] = WAY_STRAIGHT;
            this.askAfter[e] = 0;
            this.ask(e, tick, ASK_NOW);
          } else if ((gx - r.gx) * (gx - r.gx) + (gz - r.gz) * (gz - r.gz) > GOAL_MOVED * GOAL_MOVED) this.ask(e, tick, ASK_LATER);
        }
        if (this.way[e] === WAY_ON) {
          this.look[e] = Math.round((Math.atan2(r.x[r.next]! - x, r.z[r.next]! - z) / (Math.PI * 2)) * 65536) & 0xffff;
          return true;
        }
      }
    }
    if (blocked || this.stuck[e]! >= STUCK_TICKS) this.ask(e, tick, ASK_NOW);
    return true;
  }

  private ask(e: number, tick: number, level: number): void {
    if (tick < this.askAfter[e]! || this.asked[e] === ASK_NOW || this.asked[e] === level) return;
    this.asked[e] = level;
    (level === ASK_NOW ? this.urgent : this.later).list.push(e);
  }

  /** The next creature whose search is due, or -1. */
  private pop(): number {
    for (let level = ASK_NOW; level <= ASK_LATER; level++) {
      const q = level === ASK_NOW ? this.urgent : this.later;
      // An entry left behind when its creature asked again more urgently, or stopped wanting, is passed over.
      while (q.at < q.list.length) {
        const e = q.list[q.at++]!;
        if (this.asked[e] === level) return e;
      }
    }
    return -1;
  }

  /** Starts the search `e` asked for: 1 if it began, 0 if it cannot (no way, then), -1 if `e` no longer wants one. */
  private begin(e: number): number {
    const ents = this.world.ents;
    const p = this.reg.move[ents.kind[e]!];
    if ((ents.flags[e]! & F_AWAKE) === 0 || !p) return -1;
    let gx: number;
    let gz: number;
    if (this.mind[e] === MIND_HUNT || (ents.team[e] !== 0 && this.leader[e]! >= 0)) {
      const o = this.mind[e] === MIND_HUNT ? this.target[e]! : this.leader[e]!;
      if (o < 0 || (ents.flags[o]! & F_ALIVE) === 0) return -1;
      gx = ents.x[o]!;
      gz = ents.z[o]!;
    } else if (this.mind[e] === MIND_FLEE) {
      this.fleeGoal(e);
      gx = this.homeX[e]!;
      gz = this.homeZ[e]!;
    } else return -1;
    const f = this.finder;
    f.body = p;
    const x = ents.x[e]!;
    const z = ents.z[e]!;
    this.windowX = x;
    this.windowZ = z;
    this.window = shapeStamp(this.world, x - PATH_REACH, z - PATH_REACH, x + PATH_REACH + 1, z + PATH_REACH + 1);
    const r = this.route(e);
    r.gx = gx;
    r.gz = gz;
    return f.begin(x, z, gx, gz) ? 1 : 0;
  }

  /** A fleeing creature makes for a point it can stand on: the one away from what hurt it, or the nearest turn of it that is. */
  private fleeGoal(e: number): void {
    const ents = this.world.ents;
    const p = this.reg.move[ents.kind[e]!]!;
    const x = ents.x[e]!;
    const z = ents.z[e]!;
    const dx = this.homeX[e]! - x;
    const dz = this.homeZ[e]! - z;
    for (const turn of [0, 1, -1, 2, -2, 3, -3]) {
      const c = Math.cos((turn * Math.PI) / 4);
      const s = Math.sin((turn * Math.PI) / 4);
      const gx = x + dx * c + dz * s;
      const gz = z - dx * s + dz * c;
      if (groundAt(this.world, p, gx, gz) !== GROUND_FREE) continue;
      this.homeX[e] = gx;
      this.homeZ[e] = gz;
      return;
    }
  }

  /** The search for `e` is over. */
  private answer(e: number, tick: number, status: number): void {
    this.asked[e] = 0;
    this.searches++;
    const f = this.finder;
    const r = this.route(e);
    // The ground changed under a search spread over ticks: it is done again.
    const w = this.world;
    if (status !== PATH_NONE && shapeStamp(w, this.windowX - PATH_REACH, this.windowZ - PATH_REACH, this.windowX + PATH_REACH + 1, this.windowZ + PATH_REACH + 1) !== this.window) {
      this.askAfter[e] = 0;
      this.ask(e, tick, ASK_NOW);
      return;
    }
    const follows = this.mind[e] !== MIND_HUNT && this.mind[e] !== MIND_FLEE;
    if (f.count >= 2 && (status === PATH_FOUND || status === PATH_LEG || (status === PATH_SHORT && follows))) {
      this.askAfter[e] = tick + ASK_TICKS;
      const n = Math.min(ROUTE_POINTS, f.count);
      let minX = f.x[0]!;
      let minZ = f.z[0]!;
      let maxX = minX;
      let maxZ = minZ;
      for (let k = 0; k < n; k++) {
        r.x[k] = f.x[k]!;
        r.z[k] = f.z[k]!;
        minX = Math.min(minX, f.x[k]!);
        minZ = Math.min(minZ, f.z[k]!);
        maxX = Math.max(maxX, f.x[k]!);
        maxZ = Math.max(maxZ, f.z[k]!);
      }
      r.count = n;
      r.next = 1;
      const ex = f.x[f.count - 1]! - r.gx;
      const ez = f.z[f.count - 1]! - r.gz;
      r.short = n === f.count && status !== PATH_LEG && ex * ex + ez * ez > SHORT_OF * SHORT_OF;
      r.minX = minX - ROUTE_MARGIN;
      r.minZ = minZ - ROUTE_MARGIN;
      r.maxX = maxX + ROUTE_MARGIN;
      r.maxZ = maxZ + ROUTE_MARGIN;
      r.stamp = shapeStamp(w, r.minX, r.minZ, r.maxX, r.maxZ);
      this.way[e] = WAY_ON;
      this.stuck[e] = 0;
      return;
    }
    this.way[e] = WAY_NONE;
    this.askAfter[e] = tick + NO_WAY_TICKS;
    if (this.mind[e] === MIND_HUNT) this.giveUp(e, tick);
  }
}
