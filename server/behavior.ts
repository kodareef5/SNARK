// Decides the input of a creature nobody rides. The input feeds the same movement and action step as a survivor's (D76).
// Thinking is staggered by entity index, so a crowd's thinking is spread evenly over ticks.

import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { Rng } from "../shared/rng.ts";
import { BTN_PRIMARY, BTN_SPRINT, MF_OUT, stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, wider } from "../shared/sim/entities.ts";
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { HIT_NONE, castWorld } from "../shared/world/ray.ts";
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

/** A creature thinks once every THINK_TICKS. One that hunts or follows corrects its heading every STEER_TICKS. */
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
  private leaderGen = new Uint16Array(0);
  /** Owned creatures that are awake. */
  readonly owned = new Set<number>();
  /** Every awake creature, set by Creatures. An aggressive owned creature searches it for wild prey. */
  herd: { readonly awake: Int32Array; awakeCount: number } | null = null;
  /** `bites` counts bite presses, not hits. */
  hunts = 0;
  gaveUp = 0;
  bites = 0;
  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly reg: Registry;
  private readonly rng: Rng;
  /** The hunted entity and its generation, where the hunt began, the tick the current state ends, and the tick it may next look for prey. */
  private target = new Int32Array(0);
  private targetGen = new Uint16Array(0);
  private homeX = new Float32Array(0);
  private homeZ = new Float32Array(0);
  private until = new Uint32Array(0);
  private rested = new Uint32Array(0);

  constructor(world: ServerWorld, game: GameServer, seed: number) {
    this.world = world;
    this.game = game;
    this.reg = world.reg;
    this.rng = new Rng(seed);
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
    this.leaderGen = wider(this.leaderGen, cap);
    this.target = wider(this.target, cap, -1);
    this.targetGen = wider(this.targetGen, cap);
    this.homeX = wider(this.homeX, cap);
    this.homeZ = wider(this.homeZ, cap);
    this.until = wider(this.until, cap);
    this.rested = wider(this.rested, cap);
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
  }

  /** `whom` is an entity index, or -1 to stay. */
  follow(e: number, whom: number): void {
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
    for (const e of this.owned) {
      if (e === victim || ents.team[e] !== team || this.stance[e] === STANCE_PASSIVE || this.mind[e] === MIND_HUNT || (ents.mflags[e]! & MF_OUT) !== 0) continue;
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
  }

  /** The entity index `e` hunts, or -1. */
  targetOf(e: number): number {
    return this.mind[e] === MIND_HUNT ? this.target[e]! : -1;
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

  /** The nearest target `e` can see within its sight range, as an entity index, or -1. */
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
    const team = ents.team[e]!;
    const look = (o: number): void => {
      // Skips itself, the dead, its own team and unclaimed young.
      if (o === e || (ents.flags[o]! & F_ALIVE) === 0 || (team !== 0 && ents.team[o] === team) || (ents.team[o] === 0 && ents.grown[o] !== 0)) return;
      const dx = ents.x[o]! - ex;
      const dz = ents.z[o]! - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 >= near) return;
      // The target must be in line of sight, with nothing castWorld hits between the eye and the target's middle.
      const dy = ents.y[o]! + reg.bodyHeight[ents.kind[o]!]! * 0.55 - eye;
      const far = Math.sqrt(d2 + dy * dy);
      if (far > 0.5 && castWorld(world, ex, eye, ez, dx / far, dy / far, dz / far, far) !== HIT_NONE) return;
      near = d2;
      best = o;
    };
    for (const c of this.game.clients) if (c?.active && !c.closed && c.ent >= 0) look(c.ent);
    for (const o of this.owned) look(o);
    // An aggressive owned creature goes for wild creatures too.
    if (team !== 0 && this.herd) for (let n = 0; n < this.herd.awakeCount; n++) if (ents.team[this.herd.awake[n]!] === 0) look(this.herd.awake[n]!);
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
    if (mind === MIND_HUNT) {
      if (!turn && (tick + e) % STEER_TICKS !== 0) return;
      const ents = this.world.ents;
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
    const ents = this.world.ents;
    if (ents.team[e] !== 0) {
      // An owned creature follows its leader or stands. An aggressive one first looks for prey on its turn.
      if (turn && this.stance[e] === STANCE_AGGRESSIVE && tick >= this.rested[e]!) {
        const prey = this.prey(e);
        if (prey >= 0) return this.hunt(e, prey, tick);
      }
      if (!turn && (tick + e) % STEER_TICKS !== 0) return;
      const whom = this.leader[e]!;
      if (whom < 0 || (ents.flags[whom]! & F_ALIVE) === 0 || ents.gen[whom] !== this.leaderGen[e]) {
        if (whom >= 0) this.leader[e] = -1;
        this.move[e] = 0;
        this.buttons[e] = 0;
        return;
      }
      const flat = this.aim(e, whom);
      this.pitch[e] = 0;
      const near = FOLLOW_NEAR + this.reg.bodyRadius[ents.kind[e]!]! + this.reg.bodyRadius[ents.kind[whom]!]!;
      this.move[e] = flat <= near ? 0 : flat > FOLLOW_RUN ? 127 : 90;
      this.buttons[e] = flat > FOLLOW_RUN ? BTN_SPRINT : 0;
      return;
    }
    // An unclaimed young creature waits where it hatched.
    if (ents.grown[e] !== 0) {
      this.move[e] = 0;
      this.buttons[e] = 0;
      return;
    }
    if (!turn && tick < this.until[e]!) return;
    if (mind === MIND_FLEE) {
      if (tick < this.until[e]!) return;
      this.wander(e, tick, 0);
    }
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
}
