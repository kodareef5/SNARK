// What a wild creature decides to do.
//
// A creature is driven the way a survivor is: by an input (which way to face,
// how hard to go, which buttons) fed to the same movement and the same action
// step (D76). This is where that input comes from when nobody rides it. It
// decides, it does not act: its bite lands through the shared action step and
// the one damage function, like anything else's blow.
//
// A species has a temper. All of them wander. One that flees runs from
// whatever hurt it. One that hunts goes for a survivor it sees, runs it down,
// bites when it is in reach, and gives up when it has been led too far from
// where it began, or has lost it. One that defends does the same to whoever
// hurt it and to nobody else.
//
// Thinking is not done every tick. Each creature thinks on a tick of its own
// out of every few (by its index), so a crowd's thinking is spread evenly; in
// between it keeps doing what it decided, and only one that is chasing
// corrects its heading more often. A creature standing still, decided on
// nothing, costs nothing.

import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { BTN_PRIMARY, BTN_SPRINT, MF_OUT, stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE } from "../shared/sim/entities.ts";
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { HIT_NONE, castWorld } from "../shared/world/ray.ts";
import type { GameServer } from "./game.ts";
import type { ServerWorld } from "./world.ts";

export const TEMPER_FLEES = 0;
export const TEMPER_DEFENDS = 1;
export const TEMPER_HUNTS = 2;
export const TEMPERS: readonly string[] = ["flees", "defends", "hunts"];

export const MIND_WANDER = 0;
export const MIND_FLEE = 1;
export const MIND_HUNT = 2;

/** A creature thinks once in this many ticks; one that is chasing looks to its heading this often. */
export const THINK_TICKS = 15;
const STEER_TICKS = 3;
/** How long a creature that was hurt runs for. */
const FLEE_TICKS = 5 * TICK_RATE;
/** A hunt that has gone on this long is given up, and it does not start another for a while after any. */
const HUNT_TICKS = 40 * TICK_RATE;
const REST_TICKS = 6 * TICK_RATE;
/** It keeps after what it is hunting out to this many times the distance it would have noticed it at. */
const KEEP = 1.6;

export class Behavior {
  /** What each creature is doing (a MIND_), by entity index. */
  readonly mind: Uint8Array;
  /** The input it has decided on: how hard forward (-127 to 127), where it looks (yaw and pitch, wire units), which buttons, and which of them it presses this tick. */
  readonly move: Int8Array;
  readonly look: Uint16Array;
  readonly pitch: Int16Array;
  readonly buttons: Uint8Array;
  readonly pressed: Uint8Array;
  /** Hunts begun, hunts given up, and bites asked for. */
  hunts = 0;
  gaveUp = 0;
  bites = 0;
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly reg: Registry;
  private readonly rng: Rng;
  /** What it is after or running from: an entity and its generation; where it began; when what it is doing ends; and when it may next begin a hunt. */
  private readonly target: Int32Array;
  private readonly targetGen: Uint16Array;
  private readonly homeX: Float32Array;
  private readonly homeZ: Float32Array;
  private readonly until: Uint32Array;
  private readonly rested: Uint32Array;

  constructor(world: ServerWorld, game: GameServer, seed: number) {
    this.world = world;
    this.game = game;
    this.reg = world.reg;
    this.rng = new Rng(seed);
    const cap = world.ents.cap;
    this.mind = new Uint8Array(cap);
    this.move = new Int8Array(cap);
    this.look = new Uint16Array(cap);
    this.pitch = new Int16Array(cap);
    this.buttons = new Uint8Array(cap);
    this.pressed = new Uint8Array(cap);
    this.target = new Int32Array(cap).fill(-1);
    this.targetGen = new Uint16Array(cap);
    this.homeX = new Float32Array(cap);
    this.homeZ = new Float32Array(cap);
    this.until = new Uint32Array(cap);
    this.rested = new Uint32Array(cap);
  }

  /** A creature has just been put in the world: it has decided on nothing, and looks the way it faces. */
  reset(e: number): void {
    this.mind[e] = MIND_WANDER;
    this.move[e] = 0;
    this.buttons[e] = this.pressed[e] = 0;
    this.pitch[e] = 0;
    this.look[e] = this.world.ents.yaw[e]!;
    this.target[e] = -1;
    this.until[e] = 0;
    this.rested[e] = 0;
  }

  /** Creature `e` stands where it is until tick `until`, unless something hurts it first. */
  stay(e: number, until: number): void {
    this.mind[e] = MIND_WANDER;
    this.target[e] = -1;
    this.move[e] = 0;
    this.buttons[e] = 0;
    this.pitch[e] = 0;
    this.until[e] = until;
    this.rested[e] = until;
  }

  /** What creature `e` is after, as an entity index, or -1. */
  targetOf(e: number): number {
    return this.mind[e] === MIND_HUNT ? this.target[e]! : -1;
  }

  /**
   * Something at (x, z) hurt creature `e`; `by` is the entity that did it, or
   * -1. One that flees runs the other way; any other goes for whoever it was.
   */
  provoke(e: number, x: number, z: number, by: number): void {
    const ents = this.world.ents;
    const tick = this.world.tick;
    if (this.reg.temper[ents.kind[e]!] !== TEMPER_FLEES && by >= 0 && by !== e) {
      this.hunt(e, by, tick);
      return;
    }
    this.mind[e] = MIND_FLEE;
    this.look[e] = Math.round((Math.atan2(ents.x[e]! - x, ents.z[e]! - z) / (Math.PI * 2)) * 65536) & 0xffff;
    this.pitch[e] = 0;
    this.move[e] = 127;
    this.buttons[e] = BTN_SPRINT;
    this.until[e] = tick + FLEE_TICKS;
  }

  private hunt(e: number, prey: number, tick: number): void {
    const ents = this.world.ents;
    if (this.mind[e] !== MIND_HUNT) {
      this.homeX[e] = ents.x[e]!;
      this.homeZ[e] = ents.z[e]!;
      this.hunts++;
    }
    this.mind[e] = MIND_HUNT;
    this.target[e] = prey;
    this.targetGen[e] = ents.gen[prey]!;
    this.until[e] = tick + HUNT_TICKS;
    this.aim(e, prey);
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
  }

  /** Turn its look to where `prey` is: its yaw to it on the flat, its pitch to the middle of it. */
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

  /** The nearest survivor a hunter at `e` can see within its sight, as an entity index, or -1. */
  private prey(e: number): number {
    const world = this.world;
    const ents = world.ents;
    const reg = this.reg;
    const kind = ents.kind[e]!;
    const sight = reg.sight[kind]!;
    const ex = ents.x[e]!;
    const ez = ents.z[e]!;
    const eye = ents.y[e]! + stanceEye(reg.move[kind]!, 0);
    let best = -1;
    let near = sight * sight;
    for (const c of this.game.clients) {
      if (!c?.active || c.closed || c.ent < 0 || (ents.flags[c.ent]! & F_ALIVE) === 0) continue;
      const dx = ents.x[c.ent]! - ex;
      const dz = ents.z[c.ent]! - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 >= near) continue;
      // Seen, not sensed: nothing built and no hill between its eye and the middle of them.
      const dy = ents.y[c.ent]! + reg.bodyHeight[ents.kind[c.ent]!]! * 0.55 - eye;
      const far = Math.sqrt(d2 + dy * dy);
      if (far > 0.5 && castWorld(world, ex, eye, ez, dx / far, dy / far, dz / far, far) !== HIT_NONE) continue;
      near = d2;
      best = c.ent;
    }
    return best;
  }

  /**
   * Decide creature `e`'s input for this tick. Most ticks this only clears
   * the press of the tick before; on its own tick out of every few it thinks.
   * `act` is what its body is doing with its jaws now.
   */
  steer(e: number, tick: number, act: number): void {
    this.pressed[e] = 0;
    // Unconscious, it decides nothing; what it was about is forgotten.
    if ((this.world.ents.mflags[e]! & MF_OUT) !== 0) {
      if (this.mind[e] !== MIND_WANDER || this.move[e] !== 0) this.wander(e, tick, REST_TICKS);
      return;
    }
    const mind = this.mind[e]!;
    const turn = (tick + e) % THINK_TICKS === 0;
    if (mind === MIND_HUNT) {
      if (!turn && (tick + e) % STEER_TICKS !== 0) return;
      const ents = this.world.ents;
      const reg = this.reg;
      const kind = ents.kind[e]!;
      const prey = this.target[e]!;
      // Gone, dead, or another thing in its place: there is nothing to hunt.
      if (prey < 0 || (ents.flags[prey]! & F_ALIVE) === 0 || ents.gen[prey] !== this.targetGen[e]) return this.wander(e, tick, 0);
      const flat = this.aim(e, prey);
      const hx = ents.x[e]! - this.homeX[e]!;
      const hz = ents.z[e]! - this.homeZ[e]!;
      const leash = reg.leash[kind]!;
      // Led too far from where it began, lost, or at it too long: it gives up, and wants a rest before another.
      if (hx * hx + hz * hz > leash * leash || flat > reg.sight[kind]! * KEEP || tick >= this.until[e]!) return this.wander(e, tick, REST_TICKS);
      // In reach of its jaws (from its eye, past its own length and into the other's): it stops and bites. Else it runs at it.
      const reach = reg.reach[kind]! + reg.bodyRadius[ents.kind[prey]!]! * 0.5;
      if (flat <= reach) {
        this.move[e] = 0;
        this.buttons[e] = 0;
        if (act === ACT_NONE) {
          this.pressed[e] = BTN_PRIMARY;
          this.bites++;
        }
      } else {
        this.move[e] = 127;
        this.buttons[e] = BTN_SPRINT;
      }
      return;
    }
    if (!turn && tick < this.until[e]!) return;
    if (mind === MIND_FLEE) {
      if (tick < this.until[e]!) return;
      this.wander(e, tick, 0);
    }
    // Wandering. One that hunts looks about first.
    if (turn && this.reg.temper[this.world.ents.kind[e]!] === TEMPER_HUNTS && tick >= this.rested[e]!) {
      const prey = this.prey(e);
      if (prey >= 0) return this.hunt(e, prey, tick);
    }
    if (tick < this.until[e]!) return;
    // Pick a heading and walk, or stand, for a few seconds.
    const rng = this.rng;
    this.move[e] = rng.int(3) === 0 ? 0 : 90;
    this.look[e] = rng.int(65536);
    this.buttons[e] = 0;
    this.until[e] = tick + 30 + rng.int(150);
  }
}
