// Decides the input of a creature nobody rides. The input feeds the same movement and action step as a survivor's (D76).
// Thinking is staggered by entity index, so a crowd's thinking is spread evenly over ticks.
// A creature heads straight for what it wants. Only when it is stuck, or a hunter or follower sees the line blocked, does it ask
// for a way round, and the searches of the whole server share one budget a tick.
// A flyer keeps itself up by holding its jump (D496). In the open air it needs no way: it looks ahead along its course and
// climbs over or turns round what is in it, and holds its height over the ground and over what is built or grows there.

import type { Registry } from "../shared/content/registry.ts";
import { CHUNK_SIZE, TICK_RATE, chunkCount } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { DMG_MELEE } from "../shared/sim/damage.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_PRIMARY, BTN_SPRINT, MF_OUT, MODE_FLY, MODE_FLYER, MODE_SWIM, MODE_WALK, stanceEye, swimDepth, type MoveParams } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_HELD, F_PLAYER, wider } from "../shared/sim/entities.ts";
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { capsuleFree, groundUnder } from "../shared/world/collide.ts";
import { GROUND_FREE, PATH_FOUND, PATH_LEG, PATH_NONE, PATH_REACH, PATH_SHORT, ROUTE_MARGIN, PathFinder, groundAt, shapeStamp } from "../shared/world/path.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, rayHit } from "../shared/world/ray.ts";
import { BodyGrid } from "./bodies.ts";
import type { GameServer } from "./game.ts";
import type { ServerWorld } from "./world.ts";
import { creatureSize, youngMove } from "./young-move.ts";

export const TEMPER_FLEES = 0;
export const TEMPER_DEFENDS = 1;
export const TEMPER_HUNTS = 2;
export const TEMPERS: readonly string[] = ["flees", "defends", "hunts"];

/**
 * Neutral fights back when it or a nearby tribe mate is hurt. Aggressive also goes for wild creatures and strangers it sees.
 * Attacking your target is neutral, and also goes for whatever a tribe mate near it hurts (ARK's "Attack Your Target").
 */
export const STANCE_PASSIVE = 0;
export const STANCE_NEUTRAL = 1;
export const STANCE_AGGRESSIVE = 2;
export const STANCE_YOURS = 3;
export const STANCES: readonly string[] = ["passive", "neutral", "aggressive", "attacks your target"];

/** How a body walks to its goal: not at all, strolling, walking, running. */
export const GOAL_NONE = 0;
export const GOAL_STROLL = 1;
export const GOAL_WALK = 2;
export const GOAL_RUN = 3;
/** Standing where it was told and staying there: no wandering while it waits, serves or emotes. */
export const GOAL_STAY = 4;
/** Metres from its goal a body counts as there. */
export const GOAL_ARRIVE = 0.9;
/** No temper of its own: its species'. */
export const TEMPER_SPECIES = 255;

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
export { ROUTE_MARGIN } from "../shared/world/path.ts";

/** Where a creature is with its way: heading straight, on a way, or told that no way was found. */
const WAY_STRAIGHT = 0;
const WAY_ON = 1;
const WAY_NONE = 2;
/** A search asked for by a creature with no way, or to refresh one it is on. */
const ASK_NOW = 1;
const ASK_LATER = 2;

// A flyer's own mind (planning/reference/flyers-plan.md, FL3). Where ARK publishes nothing the numbers are chosen
// (planning/quality/deviations.md): a wild one's heights, range and rhythm of flying and resting, how far ahead it looks.
/** On the ground resting, cruising from point to point, making for where it will land, and going down onto it. */
const PHASE_REST = 0;
const PHASE_CRUISE = 1;
const PHASE_APPROACH = 2;
const PHASE_DESCEND = 3;
/** Metres. A wild flyer's points lie within WANDER of its home, CRUISE_LOW to CRUISE_HIGH over what is under them. */
const WANDER = 150;
const CRUISE_LOW = 12;
const CRUISE_HIGH = 40;
/** Seconds it stays up before it looks for a place to land, and rests there: ARK's "frequent pit stops", by the mind's clock. */
const ALOFT_SECONDS = [60, 150] as const;
const REST_SECONDS = [20, 60] as const;
/** Metres round a place to land that must be standing ground too. */
const MARGIN = 0.5;
/** Metres between the places a resting flyer's stroll is tested under open sky. */
const STROLL_STEP = 1.5;
/** Metres over the ground that a column's test begins, clear of the ground's own skin. */
const LIFTED = 0.05;
/** Metres from its home that it lands, places it tries a think, and the open sky it wants over one. */
const LAND_RANGE = 60;
const LAND_TRIES = 6;
const OPEN_SKY = 60;
/** Metres out it looks for land from the water, ring by ring. */
const SHORE_RINGS = [20, 40, 60, 80, 120, 160, 240, 320, 480, 640] as const;
/**
 * It makes for where it lands APPROACH_UP metres over it and over what is round it, and lets its jump go within DROP_NEAR
 * metres of it, slowing from SLOW_NEAR.
 */
const APPROACH_UP = 10;
const DROP_NEAR = 2.5;
const SLOW_NEAR = 15;
/** Ticks it gives an approach and a descent before it tries elsewhere. */
const APPROACH_TICKS = 60 * TICK_RATE;
const DESCEND_TICKS = 12 * TICK_RATE;
/** Ticks a wild flyer flies from harm, and metres higher than it cruises. */
const FLEE_AIR_TICKS = 10 * TICK_RATE;
const FLEE_UP = 15;
/** Radians: the steepest it climbs and dives by its look, and dives at prey; nearly straight up, out of a courtyard. */
const CLIMB_MAX = 0.87;
const DIVE_MAX = 0.61;
const STOOP_MAX = 1.3;
const STRAIGHT_UP = 1.45;
/** Metres short of its prey that a stooping flyer stops looking for what is in its way. */
const STOOP_SHORT = 1.5;
/** It looks AHEAD_SECONDS along its course at its speed, and never less than AHEAD_MIN metres. */
const AHEAD_SECONDS = 2.5;
const AHEAD_MIN = 12;
/** Metres a second the height of what is under it may fall, so it does not dive at every roof's edge. */
const FLOOR_FALL = 3;
/** Every STALL_TICKS a flyer meaning to go somewhere must have gone STALL_METRES, or it climbs and turns away. */
const STALL_TICKS = 2 * TICK_RATE;
const STALL_METRES = 1.5;
/** Ticks it steers round something ahead, the turns it tries, nearest first, and the most it climbs or dives doing so. */
const ASIDE_TICKS = (3 * TICK_RATE) / 2;
const ASIDE = [0.6, -0.6, 1.2, -1.2, 1.9, -1.9] as const;
const ASIDE_PITCH = 0.2;
/** Metres over its head that a flyer looks for a roof, and the ways, distances and pitches it tries for a way out when hemmed in. */
const ROOF = 8;
const ESCAPE_WAYS = 16;
const ESCAPE_STEPS = [1.5, 4, 10, 25, 40] as const;
const ESCAPE_PITCHES = [0, CLIMB_MAX, STRAIGHT_UP, -0.4] as const;
const ESCAPE_ROOFED = [0, -0.4] as const;
/** It counts a stall when it has come no metre nearer where it goes in STALE_TICKS, the goal moving no more than STALE_MOVED. */
const STALE_TICKS = 10 * TICK_RATE;
const STALE_MOVED = 2;
/** Metres a stall lifts the height a flyer keeps, the most it may, and metres a second the lift falls again. */
const LIFT = 20;
const LIFT_MOST = 150;
const LIFT_FALL = 1;
/** Metres ahead it looks for a roof it would fly in under. */
const ROOF_AHEAD = 6;
/** Hemmed in, for CAREFUL_TICKS it flies at CAREFUL_SPEED metres a second, braking down to it, and looks CAREFUL_AHEAD at least. */
const CAREFUL_TICKS = 3 * TICK_RATE;
const CAREFUL_SPEED = 2;
const CAREFUL_AHEAD = 4;
/** The way out `escape` found, in radians. */
const escaped = { yaw: 0, pitch: 0 };
/** Metres a following flyer keeps behind and above a flying leader, sprinting from FOLLOW_AIR_RUN. */
const FOLLOW_AIR = 6;
const FOLLOW_AIR_RUN = 25;
/** A follower on foot takes wing to a leader further than TAKE_WING metres, and one in the air sets down within SET_DOWN of a leader on foot. */
const TAKE_WING = 40;
const SET_DOWN = 10;
/** A leader this many metres over the ground under it, and not standing on anything, is flying. */
const LEADER_UP = 3;
/** Metres a flyer keeps from the map's edge, and that ground it lands or walks on is over the sea. */
const EDGE = 16;
const DRY = 0.3;

/** Metres: the side of a square of the skyline, a quarter of a chunk. */
const SKY_CELL = 16;
const SKY_SIDE = CHUNK_SIZE / SKY_CELL;

/**
 * The top of the highest thing built or growing in each SKY_CELL square, by chunk: made when first wanted, and again once the
 * chunk or one beside it changes shape, since a piece stands in the grid cells it covers, which may be its neighbour's. A
 * flyer keeps over it, as ARK's do over a city, so that it is not caught among towers.
 */
class Skyline {
  private readonly world: ServerWorld;
  private readonly tops: (Float32Array | null)[];
  private readonly stamps: Int32Array;

  constructor(world: ServerWorld) {
    this.world = world;
    this.tops = new Array(chunkCount(world.dims)).fill(null);
    this.stamps = new Int32Array(chunkCount(world.dims));
  }

  /** The top over (x, z), or -Infinity where nothing stands. */
  at(x: number, z: number): number {
    const world = this.world;
    const dims = world.dims;
    const cx = Math.min(dims.chunksX - 1, Math.max(0, Math.floor(x / CHUNK_SIZE)));
    const cz = Math.min(dims.chunksZ - 1, Math.max(0, Math.floor(z / CHUNK_SIZE)));
    const chunk = cz * dims.chunksX + cx;
    const stamp = shapeStamp(world, cx * CHUNK_SIZE - SKY_CELL, cz * CHUNK_SIZE - SKY_CELL, (cx + 1) * CHUNK_SIZE + SKY_CELL, (cz + 1) * CHUNK_SIZE + SKY_CELL);
    let t = this.tops[chunk];
    if (!t || this.stamps[chunk] !== stamp) {
      t ??= this.tops[chunk] = new Float32Array(SKY_SIDE * SKY_SIDE);
      this.stamps[chunk] = stamp;
      for (let j = 0; j < SKY_SIDE; j++) {
        for (let i = 0; i < SKY_SIDE; i++) {
          const x0 = cx * CHUNK_SIZE + i * SKY_CELL;
          const z0 = cz * CHUNK_SIZE + j * SKY_CELL;
          const built = world.structs.topIn(x0, z0, x0 + SKY_CELL - 0.01, z0 + SKY_CELL - 0.01);
          t[j * SKY_SIDE + i] = Math.max(built, world.nodes?.topIn(x0, z0, x0 + SKY_CELL - 0.01, z0 + SKY_CELL - 0.01) ?? -Infinity);
        }
      }
    }
    const i = Math.min(SKY_SIDE - 1, Math.max(0, Math.floor((x - cx * CHUNK_SIZE) / SKY_CELL)));
    const j = Math.min(SKY_SIDE - 1, Math.max(0, Math.floor((z - cz * CHUNK_SIZE) / SKY_CELL)));
    return t[j * SKY_SIDE + i]!;
  }
}

/**
 * Whether a body of radius `r` standing at (x, y, z) has nothing built or growing over it for OPEN_SKY metres, by one capsule
 * that tall: where a flyer may come down, and may be put down, since one under a roof cannot take off.
 */
export function openSky(world: ServerWorld, r: number, x: number, y: number, z: number): boolean {
  return capsuleFree(world, x, y + LIFTED, z, r, OPEN_SKY);
}

/** What a flyer's mind keeps beyond a walker's. */
class Flight {
  phase = PHASE_REST;
  /** Where it heads, and for a landing the ground's height there. */
  gx = 0;
  gy = 0;
  gz = 0;
  /** The tick it changes phase: takes off, looks for a place to land, gives a landing up. */
  until = 0;
  /** Metres over what is under it that it cruises this leg. */
  cruise = CRUISE_LOW;
  /** The height of the top of what is under it and ahead, falling at most FLOOR_FALL a second. */
  floor = -Infinity;
  /** Where it lives: where it came into the world, or was told to wander, or the land it last made for out of the water. */
  homeX = 0;
  homeZ = 0;
  /** A way round something ahead: the facing and pitch, in radians, it steers by until `aside`. */
  dyaw = 0;
  dpitch = 0;
  aside = 0;
  /** The tick until which it goes carefully, hemmed in. */
  careful = 0;
  /** Metres it keeps over its height after getting nowhere, falling at LIFT_FALL a second. */
  lift = 0;
  /** Where it was going when it last came nearer, how near, and when. */
  bx = 0;
  bz = 0;
  best = 0;
  bestAt = 0;
  /** Where it was at tick `at`, and the progress checks in a row it failed. */
  px = 0;
  py = 0;
  pz = 0;
  at = 0;
  stalls = 0;
  /** Told to land (ORDER_LAND): it keeps to the ground until told to follow, stay or wander. */
  down = false;
  /** A tame told to stay while it flew, or loaded in the air: it hovers there. Any other left in the air comes down. */
  parked = false;
  /** A wild one told to stand (Behavior.stay) holds still until this tick, unless something hurts it first. */
  still = 0;
}

/** A way a creature follows. */
class Route {
  /** Conservative growth envelope used by the accepted search, including overhead step clearance. */
  growing = false;
  radius = 0;
  top = 0;
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
  /**
   * For an owned creature: a STANCE_ value, and the entity it follows, or -1 to stay. An unclaimed young one follows the
   * survivor nearest it. `wanders` is 1 for an owned creature told to wander, which follows nobody.
   */
  stance = new Uint8Array(0);
  leader = new Int32Array(0);
  wanders = new Uint8Array(0);
  /** Ticks in a row it has been stuck, as `moved` counts them. */
  stuck = new Uint8Array(0);
  /**
   * A point it walks to (Cast's people: server/cast/stage.ts), and how: a GOAL_ pace, GOAL_NONE for none. Hunting and
   * fleeing come first; arrived, it stands until told otherwise.
   */
  goalX = new Float32Array(0);
  goalZ = new Float32Array(0);
  goalPace = new Uint8Array(0);
  /** A TEMPER_ value over its species' own, or TEMPER_SPECIES: a cop who fights back where a civilian runs. */
  temperOf = new Uint8Array(0);
  private leaderGen = new Uint16Array(0);
  /** Owned creatures that are awake. */
  readonly owned = new Set<number>();
  /** Every awake creature, set by Creatures. The grid of wild creatures is filled from it. */
  herd: { readonly awake: Int32Array; awakeCount: number } | null = null;
  /** Called when a creature takes fright and stands through its startle before it runs. */
  onStartle: ((e: number) => void) | null = null;
  /** `bites` counts bite presses, not hits. `alarmed` counts creatures that took fright or turned because one of their kind was hurt. */
  alarmed = 0;
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
  /** The tick a startled creature stops standing and runs, 0 when it is not startled; and 1 for a hunt it was ordered on. */
  private calm = new Uint32Array(0);
  private ordered = new Uint8Array(0);
  /** A WAY_ value, and one more than the index in `routes` of the creature's way, or 0 before it has had one. */
  private way = new Uint8Array(0);
  private routeOf = new Int32Array(0);
  private readonly routes: Route[] = [];
  /** One more than the index in `flights` of a flyer's own state, or 0 before it has had one. */
  private flightOf = new Int32Array(0);
  private readonly flights: Flight[] = [];
  private readonly sky: Skyline;
  /** Times a flyer turned round something ahead, and progress checks a flyer failed, for measurement. */
  turned = 0;
  stalled = 0;
  /** An ASK_ value while it waits for a search, and the tick before which it may not ask again. */
  private asked = new Uint8Array(0);
  private askAfter = new Uint32Array(0);
  private readonly urgent = new Queue();
  private readonly later = new Queue();
  private readonly finder: PathFinder;
  private searchGrowing = false;
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
    // Each search is for the body that asked, with the numbers it moves by (walker); until the first, a survivor's.
    this.finder = new PathFinder(world, world.reg.move[world.reg.index.get("core:survivor")!]!);
    this.finder.budget = SEARCH_CELLS;
    this.finder.doorways = world.reg.doorway;
    this.claimed = new BodyGrid(world.dims);
    this.sky = new Skyline(world);
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
    this.wanders = wider(this.wanders, cap);
    this.stuck = wider(this.stuck, cap);
    this.goalX = wider(this.goalX, cap);
    this.goalZ = wider(this.goalZ, cap);
    this.goalPace = wider(this.goalPace, cap);
    this.temperOf = wider(this.temperOf, cap, TEMPER_SPECIES);
    this.leaderGen = wider(this.leaderGen, cap);
    this.target = wider(this.target, cap, -1);
    this.targetGen = wider(this.targetGen, cap);
    this.homeX = wider(this.homeX, cap);
    this.homeZ = wider(this.homeZ, cap);
    this.until = wider(this.until, cap);
    this.rested = wider(this.rested, cap);
    this.calm = wider(this.calm, cap);
    this.ordered = wider(this.ordered, cap);
    this.way = wider(this.way, cap);
    this.routeOf = wider(this.routeOf, cap);
    this.flightOf = wider(this.flightOf, cap);
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
    this.wanders[e] = 0;
    this.calm[e] = 0;
    this.ordered[e] = 0;
    this.goalPace[e] = GOAL_NONE;
    this.temperOf[e] = TEMPER_SPECIES;
    this.owned.delete(e);
    this.lose(e);
    if (this.reg.flies[this.world.ents.kind[e]!]) this.ground(e);
  }

  /**
   * A flyer's state as it comes into the world: home where it is, cruising if it is in its own flight, else resting a few
   * seconds before it first takes off.
   */
  private ground(e: number): void {
    const ents = this.world.ents;
    const f = this.flight(e);
    const aloft = ents.mode[e] === MODE_FLYER;
    f.phase = aloft ? PHASE_CRUISE : PHASE_REST;
    f.until = this.world.tick + (aloft ? this.seconds(ALOFT_SECONDS) : 3 * TICK_RATE + this.rng.int(17 * TICK_RATE));
    f.homeX = ents.x[e]!;
    f.homeZ = ents.z[e]!;
    f.floor = -Infinity;
    f.aside = f.careful = f.lift = 0;
    f.at = 0;
    f.stalls = 0;
    f.down = false;
    f.parked = aloft;
    f.still = 0;
    if (aloft) this.waypoint(f);
  }

  /** `whom` is an entity index, or -1 to stay. Either way it no longer wanders, and a flyer told to land may fly again. */
  follow(e: number, whom: number): void {
    if (whom !== this.leader[e] && this.mind[e] !== MIND_HUNT) this.lose(e);
    this.leader[e] = whom;
    this.wanders[e] = 0;
    if (this.flightOf[e] !== 0) {
      const f = this.flight(e);
      f.down = false;
      f.parked = whom < 0 && this.world.ents.mode[e] === MODE_FLYER;
    }
    if (whom >= 0) this.leaderGen[e] = this.world.ents.gen[whom]!;
    else if (this.mind[e] !== MIND_HUNT) this.stay(e, 0);
  }

  /** An owned creature wanders about as a wild one does, following nobody, with no tether (ARK's has none). A flyer's home is where it was told. */
  wander(e: number): void {
    this.follow(e, -1);
    this.wanders[e] = 1;
    if (this.reg.flies[this.world.ents.kind[e]!]) {
      const f = this.flight(e);
      f.homeX = this.world.ents.x[e]!;
      f.homeZ = this.world.ents.z[e]!;
      f.parked = false;
    }
  }

  /**
   * ORDER_LAND, ARK's whistle that lands flyers (ASE 288.113): a flyer lets its jump go and comes down where it is, and keeps
   * to the ground, following on foot or standing, until it is told to follow, stay or wander again. Ends a hunt. False for one
   * that does not fly.
   */
  land(e: number): boolean {
    if (!this.reg.flies[this.world.ents.kind[e]!]) return false;
    if (this.mind[e] === MIND_HUNT) this.rest(e, this.world.tick, 0);
    const f = this.flight(e);
    f.down = true;
    f.parked = false;
    this.alight(e);
    return true;
  }

  /** A wild creature of a kind that flees but defends its egg (`defendsEgg`) turns on the thief `by`. */
  defend(e: number, by: number): void {
    if (by >= 0 && by !== e && (this.world.ents.flags[by]! & F_ALIVE) !== 0) this.hunt(e, by, this.world.tick);
  }

  /**
   * Sets an owned creature's stance. As ARK's whistles have it, every stance but aggressive ends the hunt it is on: passive
   * defends nothing, and neutral and attacking your target defend again when hurt again.
   */
  order(e: number, stance: number): void {
    this.stance[e] = stance;
    if (stance !== STANCE_AGGRESSIVE && this.mind[e] === MIND_HUNT) this.rest(e, this.world.tick, 0);
  }

  /** An order: `e` goes for `prey` however far it runs, until the hunt's time is up or it cannot reach it. */
  attack(e: number, prey: number): void {
    this.hunt(e, prey, this.world.tick);
    this.ordered[e] = 1;
  }

  /** `e` became somebody's. Young, it may have been following whoever was nearest. Now it follows when it is told to. */
  claim(e: number): void {
    if (this.leader[e]! < 0) return;
    this.leader[e] = -1;
    this.lose(e);
    this.move[e] = 0;
    this.buttons[e] = 0;
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

  /**
   * `by` hurt `victim`. Each creature of `by`'s team set to attack its tribe's target, within HELP_RANGE of `by`, goes for
   * `victim`, leaving any other hunt for it.
   */
  assist(by: number, victim: number): void {
    if (by < 0 || this.owned.size === 0) return;
    const ents = this.world.ents;
    const team = ents.team[by]!;
    if (team === 0 || ents.team[victim] === team || (ents.flags[victim]! & F_ALIVE) === 0) return;
    const tick = this.world.tick;
    const grid = this.claimedNow();
    const n = grid.near(ents.x[by]!, ents.z[by]!, HELP_RANGE + 1);
    for (let k = 0; k < n; k++) {
      const e = grid.found[k]!;
      if (e === by || e === victim || !this.owned.has(e) || ents.team[e] !== team || this.stance[e] !== STANCE_YOURS || this.targetOf(e) === victim || ents.driven[e] !== 0 || (ents.mflags[e]! & MF_OUT) !== 0) continue;
      const dx = ents.x[e]! - ents.x[by]!;
      const dz = ents.z[e]! - ents.z[by]!;
      if (dx * dx + dz * dz <= HELP_RANGE * HELP_RANGE) this.hunt(e, victim, tick);
    }
  }

  /**
   * `victim`, wild, was hurt from (x, z) by `by`, an entity index or -1. Others of its kind within its species' alarm range
   * take fright with it, as ARK's dodos do: a kind that flees runs from (x, z), startled if it was not running already, and
   * any other turns on `by`. One that hunts, is young, cold, held or ridden does nothing. Returns how many took fright.
   */
  alarm(victim: number, x: number, z: number, by: number): number {
    const ents = this.world.ents;
    const kind = ents.kind[victim]!;
    const range = this.reg.alarm[kind]!;
    if (!(range > 0) || ents.team[victim] !== 0) return 0;
    const flees = this.reg.temper[kind] === TEMPER_FLEES;
    // A kind that fights needs somebody to turn on, and never turns on one of its own.
    if (!flees && (by < 0 || (ents.team[by] === 0 && ents.kind[by] === kind))) return 0;
    const tick = this.world.tick;
    const vx = ents.x[victim]!;
    const vz = ents.z[victim]!;
    const grid = this.wildNow();
    const n = grid.near(vx, vz, range + 1);
    let count = 0;
    for (let k = 0; k < n; k++) {
      const e = grid.found[k]!;
      if (e === victim || e === by || ents.kind[e] !== kind || ents.grown[e] !== 0 || this.mind[e] === MIND_HUNT || ents.driven[e] !== 0 || (ents.flags[e]! & F_HELD) !== 0 || (ents.mflags[e]! & MF_OUT) !== 0) continue;
      const dx = ents.x[e]! - vx;
      const dz = ents.z[e]! - vz;
      if (dx * dx + dz * dz > range * range) continue;
      if (flees) this.flee(e, x, z, tick, true);
      else this.hunt(e, by, tick);
      count++;
    }
    this.alarmed += count;
    return count;
  }

  /** Stands still until tick `until`, unless something hurts it first. A flyer in the air comes down to stand. */
  stay(e: number, until: number): void {
    if (this.flightOf[e] !== 0) this.flight(e).still = until;
    this.mind[e] = MIND_WANDER;
    this.target[e] = -1;
    this.move[e] = 0;
    this.buttons[e] = 0;
    this.pitch[e] = 0;
    this.until[e] = until;
    this.rested[e] = until;
    this.lose(e);
  }

  /** Its temper: its own if it has one, else its species'. */
  temper(e: number): number {
    const own = this.temperOf[e]!;
    return own !== TEMPER_SPECIES ? own : this.reg.temper[this.world.ents.kind[e]!]!;
  }

  /** Walks `e` to a point at a GOAL_ pace, finding its way round what is in it; GOAL_NONE stops it where it is. A hunt or
   * a fright comes first, and it goes on to the point after. */
  goTo(e: number, x: number, z: number, pace: number): void {
    const moved = this.goalPace[e] === GOAL_NONE || Math.abs(this.goalX[e]! - x) + Math.abs(this.goalZ[e]! - z) > 2;
    this.goalX[e] = x;
    this.goalZ[e] = z;
    this.goalPace[e] = pace;
    if (pace === GOAL_NONE) {
      this.move[e] = 0;
      this.buttons[e] = 0;
    }
    if (moved) this.lose(e);
    if (this.mind[e] === MIND_WANDER) this.until[e] = 0;
  }

  /** Whether `e` is within `r` metres of its goal (on the flat). */
  arrived(e: number, r = GOAL_ARRIVE): boolean {
    const ents = this.world.ents;
    const dx = this.goalX[e]! - ents.x[e]!, dz = this.goalZ[e]! - ents.z[e]!;
    return dx * dx + dz * dz <= r * r;
  }

  /** Turns `e` to face a point, standing. */
  face(e: number, x: number, z: number): void {
    const ents = this.world.ents;
    this.look[e] = Math.round((Math.atan2(x - ents.x[e]!, z - ents.z[e]!) / (Math.PI * 2)) * 65536) & 0xffff;
  }

  /** The entity index `e` hunts, or -1. */
  targetOf(e: number): number {
    if (this.mind[e] !== MIND_HUNT) return -1;
    const prey = this.target[e]!, ents = this.world.ents;
    return prey >= 0 && (ents.flags[prey]! & F_ALIVE) !== 0 && ents.gen[prey] === this.targetGen[e]
      && (ents.team[e] === 0 || ents.team[prey] !== ents.team[e]) ? prey : -1;
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
    if (this.temper(e) !== TEMPER_FLEES && by >= 0 && by !== e) {
      this.hunt(e, by, tick);
      return;
    }
    this.flee(e, x, z, tick, true);
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
    this.ordered[e] = 0;
    this.until[e] = tick + HUNT_TICKS;
    this.aim(e, prey);
    if (this.blocked(e, prey, tick)) this.ask(e, tick, ASK_NOW);
  }

  /** It drops what it was doing and stands, and looks for no prey for `rest` ticks. */
  private rest(e: number, tick: number, rest: number): void {
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

  /**
   * Runs from (x, z) for FLEE_TICKS, toward a point as far off as it runs in that time, or the way it faces when (x, z) is
   * where it stands. One that takes fright with `startle` stands through its kind's startled clip first, so its feet do not
   * slide under it, and then turns away.
   */
  private flee(e: number, x: number, z: number, tick: number, startle = false): void {
    const ents = this.world.ents;
    const dx = ents.x[e]! - x;
    const dz = ents.z[e]! - z;
    const a = dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) : (ents.yaw[e]! / 65536) * Math.PI * 2;
    // A flyer flees by air (ARK's "will fly away when attacked"): it takes off where it stands and flies for longer. In the
    // air it is not startled.
    const flyer = this.flyer(e);
    if (flyer) this.flight(e).still = 0;
    const clip = startle && this.mind[e] !== MIND_FLEE && (ents.mflags[e]! & MF_OUT) === 0 && !(flyer && ents.mode[e] === MODE_FLYER) ? this.world.anims[ents.kind[e]!]?.startled : null;
    // One hit again while still startled keeps standing.
    const hold = clip ? tick + clip.frames - 1 : this.mind[e] === MIND_FLEE && tick < this.calm[e]! ? this.calm[e]! : 0;
    this.lose(e);
    this.mind[e] = MIND_FLEE;
    this.calm[e] = hold;
    this.look[e] = hold !== 0 ? ents.yaw[e]! : Math.round((a / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = 0;
    this.move[e] = hold !== 0 ? 0 : 127;
    this.buttons[e] = hold !== 0 ? 0 : BTN_SPRINT | (flyer ? BTN_JUMP : 0);
    const ticks = flyer ? FLEE_AIR_TICKS : FLEE_TICKS;
    this.until[e] = Math.max(tick, hold) + ticks;
    const p = youngMove(this.world, e, this.reg.move[ents.kind[e]!]!);
    const run = ((flyer ? p.flySpeed * p.flySprintMul : p.walkSpeed * p.sprintMul) * ticks) / TICK_RATE;
    this.homeX[e] = ents.x[e]! + Math.sin(a) * run;
    this.homeZ[e] = ents.z[e]! + Math.cos(a) * run;
    if (!flyer && this.blocked(e, -1, tick)) this.ask(e, tick, ASK_NOW);
    if (clip) this.onStartle?.(e);
  }

  /**
   * A hunter that cannot reach its prey gives up. A wild one runs from it (as the reference's wild creatures do when they cannot
   * reach their target) and rests after; one that is somebody's stops.
   */
  private giveUp(e: number, tick: number): void {
    const prey = this.target[e]!;
    if (this.world.ents.team[e] !== 0) return this.rest(e, tick, REST_TICKS);
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
    const eye = ents.y[e]! + stanceEye(youngMove(this.world, e, reg.move[ents.kind[e]!]!), 0);
    const dy = ents.y[prey]! + reg.bodyHeight[ents.kind[prey]!]! * creatureSize(this.world, prey) * 0.55 - eye;
    this.look[e] = Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = Math.round((Math.atan2(dy, flat) / (Math.PI / 2)) * 16384);
    return flat;
  }

  /** What castWorld meets first on the line from the eye of `e` to the middle of `o`. rayHit says where. */
  private between(e: number, o: number): number {
    const ents = this.world.ents;
    return this.line(e, ents.x[o]!, ents.y[o]! + this.reg.bodyHeight[ents.kind[o]!]! * creatureSize(this.world, o) * 0.55, ents.z[o]!);
  }

  /** What castWorld meets first on the line from the eye of `e` to (x, y, z), or at eye height when `y` is NaN. */
  private line(e: number, x: number, y: number, z: number): number {
    const ents = this.world.ents;
    const ex = ents.x[e]!;
    const ez = ents.z[e]!;
    const eye = ents.y[e]! + stanceEye(youngMove(this.world, e, this.reg.move[ents.kind[e]!]!), 0);
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
      if (this.mind[e] !== MIND_WANDER || this.move[e] !== 0) this.rest(e, tick, REST_TICKS);
      return;
    }
    const mind = this.mind[e]!;
    const turn = (tick + e) % THINK_TICKS === 0;
    const heading = turn || (tick + e) % STEER_TICKS === 0 || this.way[e] === WAY_ON;
    const ents = this.world.ents;
    const flyer = this.flyer(e);
    // Let go of in the air, caught by a bola or gone off a ledge, a flyer falls until it is down (ASE 203.1): it does not
    // catch itself.
    if (flyer && ents.mode[e] === MODE_WALK && (ents.flags[e]! & F_GROUNDED) === 0) {
      this.move[e] = 0;
      this.buttons[e] = 0;
      return;
    }
    if (mind === MIND_HUNT) {
      if (!heading) return;
      const reg = this.reg;
      const kind = ents.kind[e]!;
      const prey = this.target[e]!;
      // The prey is gone, dead, replaced, or now on its own team.
      if (prey < 0 || (ents.flags[prey]! & F_ALIVE) === 0 || ents.gen[prey] !== this.targetGen[e] || (ents.team[e] !== 0 && ents.team[prey] === ents.team[e])) return this.rest(e, tick, 0);
      const flat = this.aim(e, prey);
      const hx = ents.x[e]! - this.homeX[e]!;
      const hz = ents.z[e]! - this.homeZ[e]!;
      const leash = reg.leash[kind]!;
      // It gives up when led past its leash, when the prey is too far, or when the hunt has run too long. Then it rests.
      // One ordered to the hunt keeps on wherever it leads until its time is up.
      if ((this.ordered[e] === 0 && (hx * hx + hz * hz > leash * leash || flat > reg.sight[kind]! * KEEP)) || tick >= this.until[e]!) return this.rest(e, tick, REST_TICKS);
      if (flyer) return this.stoop(e, tick, act, prey);
      // Within reach it stops and bites, else it runs at the prey. Reach counts from its eye to half a radius inside the prey.
      const reach = reg.reach[kind]! * creatureSize(this.world, e) + reg.bodyRadius[ents.kind[prey]!]! * creatureSize(this.world, prey) * 0.5;
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
    if (this.goalPace[e] !== GOAL_NONE && mind !== MIND_FLEE) return this.seek(e, tick, turn, heading);
    if (ents.team[e] !== 0) {
      // An owned creature follows its leader, wanders, or stands. An aggressive one first looks for prey on its turn.
      if (turn && this.stance[e] === STANCE_AGGRESSIVE && tick >= this.rested[e]!) {
        const prey = this.prey(e);
        if (prey >= 0) return this.hunt(e, prey, tick);
      }
      if (flyer) return this.wanders[e] !== 0 ? this.roam(e, tick, turn, heading) : this.attend(e, tick, turn, heading);
      if (this.wanders[e] !== 0) return this.amble(e, tick);
      if (heading) this.go(e, tick, turn);
      return;
    }
    // An unclaimed young creature follows the survivor nearest it, as ARK's newly hatched young do, or waits.
    if (ents.grown[e] !== 0) {
      if (turn) this.guide(e);
      if (heading) this.go(e, tick, turn);
      return;
    }
    if (mind === MIND_FLEE) {
      if (tick < this.until[e]!) {
        // A startled one stands until its startle is over, then turns away and runs.
        if (tick < this.calm[e]!) return;
        const started = this.calm[e] !== 0;
        if (started) {
          this.calm[e] = 0;
          this.look[e] = Math.round((Math.atan2(this.homeX[e]! - ents.x[e]!, this.homeZ[e]! - ents.z[e]!) / (Math.PI * 2)) * 65536) & 0xffff;
        }
        // A flyer takes off and climbs away, sprinting, higher than it cruises.
        if (flyer) {
          if (heading || started) {
            const f = this.flight(e);
            this.pilot(e, f, tick, this.homeX[e]!, -Infinity, this.homeZ[e]!, true, f.cruise + FLEE_UP);
          }
          return;
        }
        // With no way away it stands, rather than run at a wall.
        if (heading || started) {
          const away = this.head(e, tick, this.homeX[e]!, this.homeZ[e]!, turn && this.blocked(e, -1, tick));
          this.move[e] = away ? 127 : 0;
          this.buttons[e] = away ? BTN_SPRINT : 0;
        }
        return;
      }
      this.rest(e, tick, Math.max(0, this.rested[e]! - tick));
      // Over its fright, a flyer flies on a while before it thinks of landing.
      if (flyer) this.cruise(this.flight(e), tick);
    }
    if (flyer) {
      if (turn && this.temper(e) === TEMPER_HUNTS && tick >= this.rested[e]!) {
        const prey = this.prey(e);
        if (prey >= 0) return this.hunt(e, prey, tick);
      }
      return this.roam(e, tick, turn, heading);
    }
    if (!turn && tick < this.until[e]!) return;
    if (turn && this.temper(e) === TEMPER_HUNTS && tick >= this.rested[e]!) {
      const prey = this.prey(e);
      if (prey >= 0) return this.hunt(e, prey, tick);
    }
    this.amble(e, tick);
  }

  /** Now and then it walks a new way, or stands a while. It walks at its walking speed, as ARK's wild creatures wander. */
  /** Walks to its goal at its pace; there, it stands still facing the way it was told. */
  private seek(e: number, tick: number, turn: boolean, heading: boolean): void {
    if (this.goalPace[e] === GOAL_STAY || this.arrived(e)) {
      this.way[e] = WAY_STRAIGHT;
      this.move[e] = 0;
      this.buttons[e] = 0;
      return;
    }
    if (!heading) return;
    const ents = this.world.ents;
    const gx = this.goalX[e]!, gz = this.goalZ[e]!;
    this.look[e] = Math.round((Math.atan2(gx - ents.x[e]!, gz - ents.z[e]!) / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = 0;
    const pace = this.goalPace[e]!;
    this.move[e] = pace === GOAL_STROLL ? 64 : 127;
    this.buttons[e] = pace === GOAL_RUN ? BTN_SPRINT : 0;
    this.homeX[e] = gx;
    this.homeZ[e] = gz;
    if (!this.head(e, tick, gx, gz, turn && this.blocked(e, -1, tick))) {
      this.move[e] = 0;
      this.buttons[e] = 0;
    }
  }

  private amble(e: number, tick: number): void {
    if (tick < this.until[e]!) return;
    const rng = this.rng;
    this.move[e] = rng.int(3) === 0 ? 0 : 127;
    this.look[e] = rng.int(65536);
    this.buttons[e] = 0;
    this.until[e] = tick + 30 + rng.int(150);
  }

  /** Whether `e` minds itself as a flyer: of a kind that flies, and grown or somebody's. An unclaimed young one walks after whoever is near. */
  private flyer(e: number): boolean {
    const ents = this.world.ents;
    return this.reg.flies[ents.kind[e]!] === 1 && (ents.team[e] !== 0 || ents.grown[e] === 0);
  }

  /** The flight state of `e`, made the first time it needs one. */
  private flight(e: number): Flight {
    if (this.flightOf[e] === 0) {
      this.flights.push(new Flight());
      this.flightOf[e] = this.flights.length;
    }
    return this.flights[this.flightOf[e]! - 1]!;
  }

  /** Ticks drawn evenly from a range of seconds. */
  private seconds(range: readonly [number, number]): number {
    return Math.round((range[0] + this.rng.float() * (range[1] - range[0])) * TICK_RATE);
  }

  /**
   * A wild flyer's day, and a tame's told to wander: it flies from point to point about its home, now and then picks open
   * ground near home, flies down onto it and rests, then takes off again. In the water it takes wing and makes for land
   * (ASE 214.0). A tame told to land keeps to the ground.
   */
  private roam(e: number, tick: number, turn: boolean, heading: boolean): void {
    const ents = this.world.ents;
    const f = this.flight(e);
    const mode = ents.mode[e]!;
    if (f.down) {
      if (mode !== MODE_WALK) this.alight(e);
      else if (turn) this.stroll(e, tick);
      return;
    }
    if (tick < f.still) {
      if (mode === MODE_FLYER) this.alight(e);
      else this.move[e] = this.buttons[e] = 0;
      return;
    }
    if (mode === MODE_SWIM && f.phase !== PHASE_APPROACH && !this.landing(e, f, tick)) this.cruise(f, tick);
    if (f.phase === PHASE_REST) {
      if (mode !== MODE_FLYER && tick < f.until) {
        if (turn) this.stroll(e, tick);
        return;
      }
      this.cruise(f, tick);
    }
    if (f.phase === PHASE_CRUISE) {
      if (turn && tick >= f.until && !this.landing(e, f, tick)) f.until = tick + 10 * TICK_RATE;
      if (f.phase === PHASE_CRUISE) {
        if (Math.hypot(f.gx - ents.x[e]!, f.gz - ents.z[e]!) < AHEAD_MIN || f.stalls > 0) this.waypoint(f);
        if (heading) this.pilot(e, f, tick, f.gx, -Infinity, f.gz, false, f.cruise);
        return;
      }
    }
    if (f.phase === PHASE_APPROACH) {
      const flat = Math.hypot(f.gx - ents.x[e]!, f.gz - ents.z[e]!);
      if (flat > DROP_NEAR) {
        // Held up on the way, it chooses again.
        if ((tick >= f.until || f.stalls >= 2) && !this.landing(e, f, tick)) return this.cruise(f, tick);
        // It comes in over what is round the place, and then straight down through the open sky over it.
        if (heading) this.pilot(e, f, tick, f.gx, f.gy + APPROACH_UP, f.gz, false, APPROACH_UP, false, flat < SLOW_NEAR);
        return;
      }
      // Over the place it brakes to a stop, so that it goes straight down.
      f.phase = PHASE_DESCEND;
      f.until = tick + DESCEND_TICKS;
      this.move[e] = 0;
      this.buttons[e] = BTN_JUMP | BTN_BRAKE;
    }
    if (mode === MODE_FLYER && (this.buttons[e]! & BTN_JUMP) !== 0) {
      if (Math.hypot(ents.vx[e]!, ents.vz[e]!) > 0.3) return;
      // Stopped, it lets its jump go if what is under it is still open ground, all the way down, and otherwise chooses again.
      const p = youngMove(this.world, e, this.reg.move[ents.kind[e]!]!);
      if (!this.landable(p, ents.x[e]!, ents.z[e]!) || !this.clearBelow(p, ents.x[e]!, ents.y[e]!, ents.z[e]!)) {
        if (!this.landing(e, f, tick)) this.cruise(f, tick);
        return;
      }
      this.buttons[e] = 0;
      return;
    }
    // Its jump let go, it goes down onto the place and rests there. One that does not come down, held over ground it cannot
    // stand on or caught on something, flies on and looks again soon.
    this.move[e] = 0;
    this.buttons[e] = 0;
    if (mode === MODE_WALK && (ents.flags[e]! & F_GROUNDED) !== 0) {
      f.phase = PHASE_REST;
      f.until = tick + this.seconds(REST_SECONDS);
      this.until[e] = tick;
    } else if (tick >= f.until) {
      this.cruise(f, tick);
      f.until = tick + 3 * TICK_RATE;
    }
  }

  /**
   * At rest on the ground it mostly stands, now and then walking a few steps: only where it could have landed, the way there
   * standing ground, dry and under open sky every STROLL_STEP metres, so it does not wade in, walk off a cliff or onto a slide,
   * or in under a roof, eaves or trunks.
   */
  private stroll(e: number, tick: number): void {
    if (tick < this.until[e]!) return;
    const ents = this.world.ents;
    const hf = this.world.hf;
    const walks = this.rng.int(4) === 0;
    const look = this.rng.int(65536);
    const ticks = 30 + this.rng.int(150);
    const a = (look / 65536) * Math.PI * 2;
    const p = youngMove(this.world, e, this.reg.move[ents.kind[e]!]!);
    const far = (p.walkSpeed * ticks) / TICK_RATE;
    const [x, z] = [ents.x[e]!, ents.z[e]!];
    const [s, c] = [Math.sin(a), Math.cos(a)];
    let way = walks && hf.heightAt(x + s * (far / 2), z + c * (far / 2)) > hf.waterAt(x + s * (far / 2), z + c * (far / 2)) + DRY && this.landable(p, x + s * far, z + c * far);
    for (let d = STROLL_STEP; way && d < far; d += STROLL_STEP) {
      const [px, pz] = [x + s * d, z + c * d];
      const py = groundUnder(hf, px, pz, p.radius);
      way = py > hf.waterAt(px, pz) + DRY && groundAt(this.world, p, px, pz) === GROUND_FREE && openSky(this.world, p.radius, px, py, pz);
    }
    this.move[e] = way ? 127 : 0;
    this.look[e] = look;
    this.pitch[e] = 0;
    this.buttons[e] = 0;
    this.until[e] = tick + ticks;
  }

  /** It flies on from where it is to a new point, for a leg of ALOFT_SECONDS. */
  private cruise(f: Flight, tick: number): void {
    f.phase = PHASE_CRUISE;
    f.until = tick + this.seconds(ALOFT_SECONDS);
    f.stalls = 0;
    this.waypoint(f);
  }

  /** A new point within WANDER of its home and inside the map, and a new height to cruise at. */
  private waypoint(f: Flight): void {
    const hf = this.world.hf;
    const a = this.rng.float() * Math.PI * 2;
    const d = WANDER * Math.sqrt(this.rng.float());
    f.gx = Math.min(hf.sizeX - EDGE, Math.max(EDGE, f.homeX + Math.sin(a) * d));
    f.gz = Math.min(hf.sizeZ - EDGE, Math.max(EDGE, f.homeZ + Math.cos(a) * d));
    f.cruise = CRUISE_LOW + this.rng.float() * (CRUISE_HIGH - CRUISE_LOW);
    f.stalls = 0;
  }

  /**
   * Picks open ground to land on near its home, or else near where it is. One whose home is the water makes the land nearest
   * it its home and lands there. Then it makes for the place. False if it found none this time.
   */
  private landing(e: number, f: Flight, tick: number): boolean {
    const ents = this.world.ents;
    const hf = this.world.hf;
    const p = youngMove(this.world, e, this.reg.move[ents.kind[e]!]!);
    const wet = hf.heightAt(f.homeX, f.homeZ) <= hf.waterAt(f.homeX, f.homeZ) + DRY;
    if (!(!wet && this.spot(p, f, f.homeX, f.homeZ, LAND_RANGE)) && !this.spot(p, f, ents.x[e]!, ents.z[e]!, LAND_RANGE) && !(wet && this.shore(e, f) && this.spot(p, f, f.homeX, f.homeZ, LAND_RANGE / 2))) return false;
    f.phase = PHASE_APPROACH;
    f.until = tick + APPROACH_TICKS;
    f.stalls = 0;
    return true;
  }

  /** A place to land within `range` of (cx, cz), into (f.gx, f.gy, f.gz). */
  private spot(p: MoveParams, f: Flight, cx: number, cz: number, range: number): boolean {
    for (let k = 0; k < LAND_TRIES; k++) {
      const a = this.rng.float() * Math.PI * 2;
      const d = range * Math.sqrt(this.rng.float());
      const x = cx + Math.sin(a) * d;
      const z = cz + Math.cos(a) * d;
      if (!this.landable(p, x, z)) continue;
      f.gx = x;
      f.gy = groundUnder(this.world.hf, x, z, p.radius);
      f.gz = z;
      return true;
    }
    return false;
  }

  /**
   * Whether a flyer moving by `p` may land at (x, z): dry ground it can stand on (groundAt, so no slide) there and MARGIN
   * round it, clear of nodes nobody has loaded, with open sky over it. So it comes down on the ground, where a survivor can
   * reach it to tame it, and not on a roof or in a tree.
   */
  private landable(p: MoveParams, x: number, z: number): boolean {
    const world = this.world;
    const hf = world.hf;
    if (x < EDGE || z < EDGE || x > hf.sizeX - EDGE || z > hf.sizeZ - EDGE) return false;
    const y = groundUnder(hf, x, z, p.radius);
    if (y < hf.waterAt(x, z) + DRY || world.unloaded?.meets(x, y, z, p.radius, p.height + p.stepUp) || !openSky(world, p.radius, x, y, z)) return false;
    // Standing ground there and MARGIN round it, so that coming down a hair off it does not set it on a slide.
    for (let k = 0; k < 5; k++) if (groundAt(world, p, x + (k === 1 ? MARGIN : k === 2 ? -MARGIN : 0), z + (k === 3 ? MARGIN : k === 4 ? -MARGIN : 0)) !== GROUND_FREE) return false;
    return true;
  }

  /** Makes the land nearest `e` its home, looking ring by ring out to the last of SHORE_RINGS. False if there is none in reach. */
  private shore(e: number, f: Flight): boolean {
    const ents = this.world.ents;
    const hf = this.world.hf;
    for (const d of SHORE_RINGS) {
      for (let k = 0; k < 16; k++) {
        const x = ents.x[e]! + Math.sin((k * Math.PI) / 8) * d;
        const z = ents.z[e]! + Math.cos((k * Math.PI) / 8) * d;
        if (x < EDGE || z < EDGE || x > hf.sizeX - EDGE || z > hf.sizeZ - EDGE || hf.heightAt(x, z) <= hf.waterAt(x, z) + DRY) continue;
        f.homeX = x;
        f.homeZ = z;
        return true;
      }
    }
    return false;
  }

  /** Whether `whom` is in the air: in flight, riding a flyer in flight, or high over the ground and standing on nothing. */
  private aloft(whom: number): boolean {
    const ents = this.world.ents;
    const seat = ents.seat[whom]! - 1;
    const m = seat >= 0 && (ents.flags[whom]! & F_PLAYER) !== 0 ? seat : whom;
    const mode = ents.mode[m]!;
    if (mode === MODE_FLYER || mode === MODE_FLY) return true;
    if ((ents.flags[m]! & F_GROUNDED) !== 0 || mode === MODE_SWIM) return false;
    return ents.y[m]! - groundUnder(this.world.hf, ents.x[m]!, ents.z[m]!, this.reg.bodyRadius[ents.kind[m]!]! * creatureSize(this.world, m)) > LEADER_UP;
  }

  /**
   * An owned flyer that follows or stays. It follows a flying leader through the air, behind and above it, and one on foot
   * on foot, taking wing when it falls far behind and setting down once near. Told to stay while it flies, or loaded in the
   * air, it hovers where it is (chosen: ARK's pages do not say); any other left in the air, as when water throws its rider
   * off, comes down. Told to land, it keeps to the ground.
   */
  private attend(e: number, tick: number, turn: boolean, heading: boolean): void {
    const ents = this.world.ents;
    const f = this.flight(e);
    const flying = ents.mode[e] === MODE_FLYER;
    const whom = this.leader[e]!;
    if (whom >= 0 && ((ents.flags[whom]! & F_ALIVE) === 0 || ents.gen[whom] !== this.leaderGen[e])) {
      this.leader[e] = -1;
      this.lose(e);
    }
    if (this.leader[e]! < 0) {
      if (!f.parked || f.down) return this.alight(e);
      this.move[e] = 0;
      this.buttons[e] = flying ? BTN_JUMP : 0;
      this.pitch[e] = 0;
      if (flying) this.look[e] = ents.yaw[e]!;
      return;
    }
    if (!heading) return;
    const flat = Math.hypot(ents.x[whom]! - ents.x[e]!, ents.z[whom]! - ents.z[e]!);
    if (!f.down && this.aloft(whom)) {
      const a = (ents.yaw[whom]! / 65536) * Math.PI * 2;
      const back = FOLLOW_AIR + this.reg.bodyRadius[ents.kind[e]!]! * creatureSize(this.world, e) + this.reg.bodyRadius[ents.kind[whom]!]! * creatureSize(this.world, whom);
      const bx = ents.x[whom]! - Math.sin(a) * back;
      const by = ents.y[whom]! + 1.5;
      const bz = ents.z[whom]! - Math.cos(a) * back;
      const d = Math.hypot(bx - ents.x[e]!, by - ents.y[e]!, bz - ents.z[e]!);
      if (d < 3) return this.hover(e, ents.yaw[whom]!);
      return this.pilot(e, f, tick, bx, by, bz, d > FOLLOW_AIR_RUN, 2, false, d < SLOW_NEAR);
    }
    if (flying) {
      if (f.down || flat < SET_DOWN) return this.alight(e);
      return this.pilot(e, f, tick, ents.x[whom]!, -Infinity, ents.z[whom]!, flat > FOLLOW_AIR_RUN, CRUISE_LOW, false, flat < 2 * SET_DOWN);
    }
    if (!f.down && flat > TAKE_WING) return this.pilot(e, f, tick, ents.x[whom]!, -Infinity, ents.z[whom]!, true, CRUISE_LOW);
    this.go(e, tick, turn);
  }

  /** In the air it brakes to a stop and then lets its jump go, so that it comes straight down where it is. */
  private alight(e: number): void {
    const ents = this.world.ents;
    this.move[e] = 0;
    this.buttons[e] = ents.mode[e] === MODE_FLYER && Math.hypot(ents.vx[e]!, ents.vz[e]!) > 0.3 ? BTN_JUMP | BTN_BRAKE : 0;
  }

  /** Holds still in the air, facing `yaw`. */
  private hover(e: number, yaw: number): void {
    this.move[e] = 0;
    this.buttons[e] = BTN_JUMP;
    this.pitch[e] = 0;
    this.look[e] = yaw;
  }

  /**
   * A flyer's hunt, its look already aimed: it flies straight at its prey (ASE 218.0), sprinting while far, and within reach
   * holds there, in the air or where it stands, and bites. Coming in fast it brakes. One that gets nowhere gives up.
   */
  private stoop(e: number, tick: number, act: number, prey: number): void {
    const ents = this.world.ents;
    const reg = this.reg;
    const kind = ents.kind[e]!;
    const f = this.flight(e);
    const my = ents.y[prey]! + reg.bodyHeight[ents.kind[prey]!]! * creatureSize(this.world, prey) * 0.55;
    const d = Math.hypot(ents.x[prey]! - ents.x[e]!, my - ents.y[e]! - stanceEye(youngMove(this.world, e, reg.move[kind]!), 0), ents.z[prey]! - ents.z[e]!);
    const reach = reg.reach[kind]! * creatureSize(this.world, e) + reg.bodyRadius[ents.kind[prey]!]! * creatureSize(this.world, prey) * 0.5;
    if (d <= reach) {
      this.move[e] = 0;
      this.buttons[e] = ents.mode[e] === MODE_FLYER ? BTN_JUMP : 0;
      if (act === ACT_NONE) {
        if (this.walled(e, prey)) return this.giveUp(e, tick);
        this.pressed[e] = BTN_PRIMARY;
        this.bites++;
      }
      return;
    }
    if (f.stalls >= 3) return this.giveUp(e, tick);
    this.pilot(e, f, tick, ents.x[prey]!, my, ents.z[prey]!, d > SLOW_NEAR, 0, true);
    if (d < reach + 4 && Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!) > 4) this.buttons[e]! |= BTN_BRAKE;
  }

  /**
   * Flies `e` toward (gx, gz), its feet at `gy` or `over` metres over what is under it and ahead, whichever is higher, holding
   * its jump; sprinting if `sprint`, at half effort if `slow`. With `direct` it aims its eye at (gx, gy, gz) itself, as at prey,
   * and keeps no height. What is in its way ahead it turns round for ASIDE_TICKS, the nearest way first, or climbs over, or
   * escapes along the way clear furthest. Roofed, it climbs no higher and makes for the widest way out. One that stops, or
   * gets no nearer where it is going for STALE_TICKS, escapes too and counts a stall, carefully, slow enough to turn on the spot.
   */
  private pilot(e: number, f: Flight, tick: number, gx: number, gy: number, gz: number, sprint: boolean, over: number, direct = false, slow = false): void {
    const ents = this.world.ents;
    const hf = this.world.hf;
    const p = youngMove(this.world, e, this.reg.move[ents.kind[e]!]!);
    const x = ents.x[e]!;
    const y = ents.y[e]!;
    const z = ents.z[e]!;
    const tx = Math.min(hf.sizeX - EDGE, Math.max(EDGE, gx));
    const tz = Math.min(hf.sizeZ - EDGE, Math.max(EDGE, gz));
    const flat = Math.hypot(tx - x, tz - z);
    const aside = tick < f.aside;
    let yaw = aside ? f.dyaw : flat > 0.3 ? Math.atan2(tx - x, tz - z) : (ents.yaw[e]! / 65536) * Math.PI * 2;
    const careful = tick < f.careful;
    const moving = Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!);
    const speed = careful ? CAREFUL_SPEED : Math.max(p.flySpeed * (sprint ? p.flySprintMul : 1), moving);
    const ahead = Math.max(careful ? CAREFUL_AHEAD : AHEAD_MIN, AHEAD_SECONDS * speed);
    const floor = this.floorAhead(f, p, x, z, yaw, ahead);
    // A flyer that got nowhere keeps higher for a while, so that it climbs out over the walls of a well between towers.
    f.lift = Math.max(0, f.lift - (LIFT_FALL * STEER_TICKS) / TICK_RATE);
    const ty = direct ? gy - p.eyeHeight : Math.max(gy, floor + over) + f.lift;
    const lead = direct ? Math.max(flat, 0.5) : Math.min(Math.max(flat, 2), Math.max(6, speed * 1.2));
    const want = Math.atan2(ty - y, lead);
    let pitch = aside ? f.dpitch : direct ? Math.min(STOOP_MAX, Math.max(-STOOP_MAX, want)) : Math.min(CLIMB_MAX, Math.max(-DIVE_MAX, want));
    const my = y + p.height * 0.5;
    const roofed = !this.clear(x, y + p.height, z, 0, Math.PI / 2, ROOF);
    const away = Math.hypot(flat, ty - y);
    // What is ahead along its course, no further than where it is going, and short of prey, which stands on the ground. Going
    // in under a roof counts as in its way, so it does not fly into a tower between its floors.
    const look = Math.min(ahead, away + (direct ? -STOOP_SHORT : 1));
    const top = y + p.height;
    const blocked = (a: number, b: number): boolean => !this.clear(x, my, z, a, b, look) || (!direct && this.roofAhead(x, top, z, a, b, Math.min(look, ROOF_AHEAD)));
    // Whether it got anywhere: every STALL_TICKS it must have moved STALL_METRES, and within STALE_TICKS have come a metre
    // nearer where it goes, the best so far kept while that stays put. A check missed while it hovered or stood is not counted.
    let stalled = false;
    if (Math.hypot(tx - f.bx, tz - f.bz) > STALE_MOVED || tick - f.at > 2 * STALL_TICKS) {
      f.bx = tx;
      f.bz = tz;
      f.best = away;
      f.bestAt = tick;
    } else if (away < f.best - 1) {
      f.best = away;
      f.bestAt = tick;
    } else if (tick - f.bestAt > STALE_TICKS) {
      stalled = true;
      f.bestAt = tick;
    }
    if (tick - f.at >= STALL_TICKS) {
      if (tick - f.at <= 2 * STALL_TICKS && Math.hypot(x - f.px, y - f.py, z - f.pz) < STALL_METRES) stalled = true;
      else if (!stalled) f.stalls = 0;
      f.px = x;
      f.py = y;
      f.pz = z;
      f.at = tick;
    }
    if (stalled) {
      f.stalls++;
      this.stalled++;
      f.lift = Math.min(LIFT_MOST, f.lift + LIFT);
      this.steerOut(f, p, tick, x, y, z, yaw, roofed, 2 * ASIDE_TICKS);
      yaw = f.dyaw;
      pitch = f.dpitch;
    } else if (roofed && !aside) {
      // Roofed, between a tower's floors, in a hall or under a canopy: it makes for the widest way out, no higher.
      this.steerOut(f, p, tick, x, y, z, yaw + Math.PI, true, ASIDE_TICKS);
      yaw = f.dyaw;
      pitch = f.dpitch;
    } else if (look > STOOP_SHORT && blocked(yaw, pitch)) {
      // Round it, the nearest way first, near level; else over it; else out along the way clear furthest.
      const was = yaw;
      const level = Math.min(ASIDE_PITCH, Math.max(-ASIDE_PITCH, pitch));
      for (const off of ASIDE) {
        if (blocked(was + off, level)) continue;
        yaw = was + off;
        pitch = level;
        break;
      }
      if (yaw === was && !roofed && !blocked(was, CLIMB_MAX)) pitch = CLIMB_MAX;
      else if (yaw === was) {
        this.steerOut(f, p, tick, x, y, z, was, roofed, ASIDE_TICKS);
        yaw = f.dyaw;
        pitch = f.dpitch;
      }
      if (yaw !== was || pitch === CLIMB_MAX) {
        f.dyaw = yaw;
        f.dpitch = pitch;
        f.aside = tick + ASIDE_TICKS;
      }
      this.turned++;
    }
    if (roofed && pitch > 0) pitch = 0;
    this.look[e] = Math.round((yaw / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = Math.round((pitch / (Math.PI / 2)) * 16384);
    this.move[e] = careful ? Math.round((127 * CAREFUL_SPEED) / p.flySpeed) : slow ? 64 : 127;
    this.buttons[e] = BTN_JUMP | (sprint && !careful ? BTN_SPRINT : 0) | (careful && moving > CAREFUL_SPEED + 1 ? BTN_BRAKE : 0);
  }

  /** It steers for `ticks` along the way out `escape` finds for `p` from (x, y, z), carefully. */
  private steerOut(f: Flight, p: MoveParams, tick: number, x: number, y: number, z: number, yaw: number, roofed: boolean, ticks: number): void {
    this.escape(p, x, y, z, yaw, roofed);
    f.dyaw = escaped.yaw;
    f.dpitch = escaped.pitch;
    f.aside = tick + ticks;
    f.careful = tick + CAREFUL_TICKS;
  }

  /** Whether something built or growing stands within ROOF over the point `d` metres from (x, y, z) along `yaw` and `pitch`. */
  private roofAhead(x: number, y: number, z: number, yaw: number, pitch: number, d: number): boolean {
    const cp = Math.cos(pitch);
    const hit = castWorld(this.world, x + Math.sin(yaw) * cp * d, y + Math.sin(pitch) * d, z + Math.cos(yaw) * cp * d, 0, 1, 0, ROOF);
    return hit === HIT_STRUCTURE || hit === HIT_NODE;
  }

  /**
   * The height of the top of what is under a flyer and ahead of it, at where it is and three points along its course: the
   * ground, the water, and the skyline of what is built or grows. It rises at once and falls at FLOOR_FALL a second.
   */
  private floorAhead(f: Flight, p: MoveParams, x: number, z: number, yaw: number, ahead: number): number {
    const hf = this.world.hf;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    let top = hf.seaLevel;
    for (let k = 0; k <= 3; k++) {
      const px = x + (s * ahead * k) / 3;
      const pz = z + (c * ahead * k) / 3;
      top = Math.max(top, groundUnder(hf, px, pz, p.radius), this.sky.at(px, pz), hf.waterAt(px, pz));
    }
    f.floor = Math.max(top, f.floor - (FLOOR_FALL * STEER_TICKS) / TICK_RATE);
    return f.floor;
  }

  /** Whether a flyer at (x, y, z) would come straight down to the ground: one capsule from the ground to its top is free. */
  private clearBelow(p: MoveParams, x: number, y: number, z: number): boolean {
    const ground = groundUnder(this.world.hf, x, z, p.radius) + LIFTED;
    return capsuleFree(this.world, x, ground, z, p.radius, Math.max(p.height, y + p.height - ground));
  }

  /** Whether nothing of the world lies within `len` metres of (x, y, z) along `yaw` and `pitch`, in radians. */
  private clear(x: number, y: number, z: number, yaw: number, pitch: number, len: number): boolean {
    const cp = Math.cos(pitch);
    return castWorld(this.world, x, y, z, Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp, len) === HIT_NONE;
  }

  /**
   * The way out for a flyer of `p` at (x, y, z), its feet's height, hemmed in or getting nowhere, into `escaped`: of
   * ESCAPE_WAYS ways round from behind it, level, steeply up and nearly straight up (not when roofed) and down, the one its
   * body goes furthest along, by its capsule set at ESCAPE_STEPS along each, so it does not try a gap it cannot fit.
   */
  private escape(p: MoveParams, x: number, y: number, z: number, yaw: number, roofed: boolean): void {
    let best = -1;
    for (let k = 0; k < ESCAPE_WAYS; k++) {
      const a = yaw + Math.PI + (k % 2 === 0 ? k / 2 : -(k + 1) / 2) * ((Math.PI * 2) / ESCAPE_WAYS);
      for (const pitch of roofed ? ESCAPE_ROOFED : ESCAPE_PITCHES) {
        const cp = Math.cos(pitch);
        let free = 0;
        for (const d of ESCAPE_STEPS) {
          if (!capsuleFree(this.world, x + Math.sin(a) * cp * d, y + Math.sin(pitch) * d, z + Math.cos(a) * cp * d, p.radius, p.height)) break;
          free = d;
        }
        if (free <= best) continue;
        best = free;
        escaped.yaw = a;
        escaped.pitch = pitch;
      }
    }
  }


  /** Goes after its leader and stops a few steps short, running when far behind. With no leader, or no way to it, it stands. */
  private go(e: number, tick: number, turn: boolean): void {
    const ents = this.world.ents;
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
    const near = FOLLOW_NEAR + this.reg.bodyRadius[ents.kind[e]!]! * creatureSize(this.world, e) + this.reg.bodyRadius[ents.kind[whom]!]! * creatureSize(this.world, whom);
    if (flat <= near) this.way[e] = WAY_STRAIGHT;
    this.move[e] = flat <= near ? 0 : flat > FOLLOW_RUN ? 127 : 90;
    this.buttons[e] = flat > FOLLOW_RUN ? BTN_SPRINT : 0;
    if (flat > near && !this.head(e, tick, ents.x[whom]!, ents.z[whom]!, turn && this.blocked(e, whom, tick))) {
      this.move[e] = 0;
      this.buttons[e] = 0;
    }
  }

  /** An unclaimed young creature's leader becomes the survivor nearest it within its sight, or nobody. Chosen: ARK gives no distance. */
  private guide(e: number): void {
    const ents = this.world.ents;
    const sight = this.reg.sight[ents.kind[e]!]!;
    const grid = this.claimedNow();
    const n = grid.near(ents.x[e]!, ents.z[e]!, sight + 1);
    let best = -1;
    let near = sight * sight;
    for (let k = 0; k < n; k++) {
      const o = grid.found[k]!;
      if ((ents.flags[o]! & (F_PLAYER | F_ALIVE)) !== (F_PLAYER | F_ALIVE)) continue;
      const dx = ents.x[o]! - ents.x[e]!;
      const dz = ents.z[o]! - ents.z[e]!;
      const d2 = dx * dx + dz * dz;
      if (d2 >= near) continue;
      near = d2;
      best = o;
    }
    if (best === this.leader[e] && (best < 0 || ents.gen[best] === this.leaderGen[e])) return;
    this.lose(e);
    this.leader[e] = best;
    if (best >= 0) this.leaderGen[e] = ents.gen[best]!;
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
      if (r.growing && this.outgrown(e, r.radius, r.top)) {
        this.way[e] = WAY_STRAIGHT; this.askAfter[e] = 0; this.ask(e, tick, ASK_NOW);
        this.move[e] = 0; this.buttons[e] = 0;
        return true;
      }
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

  /** What `e` moves by, as Creatures steps it: a tame by its tamed numbers, which stand on steeper slopes. */
  private walker(e: number): MoveParams | null {
    const ents = this.world.ents;
    const base = (ents.team[e] !== 0 ? this.reg.tamedMove : this.reg.move)[ents.kind[e]!];
    return base ? youngMove(this.world, e, base) : null;
  }

  private outgrown(e: number, radius: number, top: number): boolean {
    const p = this.walker(e);
    return p === null || p.radius > radius + 1e-6 || p.height + p.stepUp > top + 1e-6;
  }

  /** Starts the search `e` asked for: 1 if it began, 0 if it cannot (no way, then), -1 if `e` no longer wants one. */
  private begin(e: number): number {
    const ents = this.world.ents;
    const p = this.walker(e);
    if ((ents.flags[e]! & F_AWAKE) === 0 || !p) return -1;
    let gx: number;
    let gz: number;
    if (this.mind[e] === MIND_HUNT || (this.leader[e]! >= 0 && (ents.team[e] !== 0 || ents.grown[e] !== 0))) {
      const o = this.mind[e] === MIND_HUNT ? this.target[e]! : this.leader[e]!;
      if (o < 0 || (ents.flags[o]! & F_ALIVE) === 0) return -1;
      gx = ents.x[o]!;
      gz = ents.z[o]!;
    } else if (this.goalPace[e] !== GOAL_NONE && this.mind[e] !== MIND_FLEE) {
      gx = this.goalX[e]!;
      gz = this.goalZ[e]!;
    } else if (this.mind[e] === MIND_FLEE) {
      this.fleeGoal(e);
      gx = this.homeX[e]!;
      gz = this.homeZ[e]!;
    } else return -1;
    const f = this.finder;
    // The search freezes a slightly wider/taller footprint, capped at adult size. Its step capability and water
    // tolerance remain the young's actual ones: padding must not invent a climb or make deep water walkable.
    this.searchGrowing = ents.grown[e]! > this.world.tick;
    const margin = this.searchGrowing ? Math.min(1.02, 1 / creatureSize(this.world, e)) : 1;
    f.body = this.searchGrowing ? { ...p, radius: p.radius * margin, height: p.height * margin, swimDepth: swimDepth(p) } : p;
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
    const p = this.walker(e)!;
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
    // Tiny continuous growth fits the conservative search envelope. Larger growth during an incremental search
    // invalidates its result before it is followed, without mutating A*'s in-progress cell classifications.
    if (this.searchGrowing && this.outgrown(e, f.body.radius, f.body.height + f.body.stepUp)) {
      this.way[e] = WAY_STRAIGHT; this.askAfter[e] = 0; this.ask(e, tick, ASK_NOW);
      return;
    }
    // The ground changed under a search spread over ticks: it is done again.
    const w = this.world;
    if (status !== PATH_NONE && shapeStamp(w, this.windowX - PATH_REACH, this.windowZ - PATH_REACH, this.windowX + PATH_REACH + 1, this.windowZ + PATH_REACH + 1) !== this.window) {
      this.askAfter[e] = 0;
      this.ask(e, tick, ASK_NOW);
      return;
    }
    const follows = this.mind[e] !== MIND_HUNT && this.mind[e] !== MIND_FLEE;
    if (f.count >= 2 && (status === PATH_FOUND || status === PATH_LEG || (status === PATH_SHORT && follows))) {
      r.growing = this.searchGrowing; r.radius = f.body.radius; r.top = f.body.height + f.body.stepUp;
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
