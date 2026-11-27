// What a stuck mover can do besides choose a heading, and `nav.do`, which asks which of those would help with what it is
// stuck on. The model
// prefers; the game acts. An action is declared once: its row of the DO profile (what it changes, its prices, its reach,
// how soon it is ready; never its name), whether the body can do it now, how well it meets what is in the way, how far
// the decider may go on its own (its consent), and how it starts, by pressing what a player would press through
// Behavior's own buttons, move and look.
//
// Consent: `free` actions the decider starts by itself (wait, sprint, jump). `sure` ones it starts only on the stuck
// rungs, and only when `nav.sure`, asked of the action, clears SURE_DO (bite through). `ask` ones are only handed on as a
// preference for whoever set the goal; none needs it yet.

import { TICK_RATE } from "../../shared/coords.ts";
import { answer as choose } from "../../shared/decide/forward.ts";
import { DO, MID_SPANS, MODES, SURE } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { soon, span, unit } from "../../shared/decide/units.ts";
import { BTN_JUMP, BTN_SPRINT, MF_NO_JUMP, MF_ROOTED } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_NODE, HIT_STRUCTURE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Behavior } from "../behavior.ts";
import type { BodyBlocking } from "../blocking.ts";
import type { ServerWorld } from "../world.ts";
import { creatureSize } from "../young-move.ts";
import { COST_PROBE, type Ask, type Point } from "./decide.ts";

export const CONSENT_FREE = 0;
export const CONSENT_SURE = 1;
export const CONSENT_ASK = 2;
/** How sure `nav.sure` must be that a `sure` action frees the mover before the decider starts it. */
export const SURE_DO = 0.8;
/** Seconds a wait stands, a sprint runs and a jump is given to clear what it jumps. */
export const WAIT_SECONDS = 1.5;
export const SPRINT_SECONDS = 2;
const JUMP_TICKS = TICK_RATE;
/** In 65536ths of a turn: it faces what it jumps within this before it jumps. */
const FACING = 4096;
/** Seconds a bite through is kept at before it is asked again. */
const BITE_SECONDS = 2;
/** Seconds of an action's time at which its `seconds` column is a half, and stuck at which `stuckSoon` is. */
const SECONDS_HALF = 2;
const STUCK_HALF = 4;
/** Metres from the body's edge that it looks for what is in its way, at least, and in its own radii. */
const AHEAD_LEAST = 1;
const AHEAD_RADII = 1.5;
/** Of the body's height: where it looks for what is in its way, and how high above what it jumps it must find room. */
const KNEE = 0.3;
/** Of a jump's height, the most an obstacle may stand and still be jumped. */
const JUMP_SHARE = 0.85;
/** Metres the near pass's grain is, as in nav-ring.ts. */
const GRAIN = 1;
const REACT = 5 / TICK_RATE;

type DoColumn = (typeof DO.columns)[number];

export interface Action {
  readonly name: string;
  /** Its row of DO but for `fits`, by column; a column not named is 0. */
  readonly row: Partial<Record<DoColumn, number>>;
  readonly consent: number;
  /** Whether the body has it and it is ready. */
  can(e: number): boolean;
  /** How well it meets what is in the way, 0 to 1. */
  fits(e: number): number;
  /** Starts it: presses what a player would. Returns the ticks it lasts, 0 for this one only. */
  start(e: number, tick: number): number;
  /** While it lasts, presses again what it needs, `from` ticks after it began. */
  keep?(e: number, tick: number, from: number): void;
}

/** What the decider knows of the stuck movers it acts for (server/decide/nav.ts). */
export interface Held {
  /** The pool slot of `e`, or -1. */
  slotOf(e: number): number;
  /**
   * The heading along which `e` asks what it can do, in 65536ths of a turn, or -1: into what it was stuck on, else the way
   * it would go if nothing stood in it.
   */
  trying(e: number): number;
  /** Its rung, how long since it came on the stuck rungs in ticks, and the share of headings its last ring left open. */
  rungOf(e: number): number;
  stuckFor(e: number, tick: number): number;
  ways(e: number): number;
  /** Whether `e` has meant to turn and has not, for a while. */
  wedged(e: number, tick: number): boolean;
}

/** What lies along the heading held, found once an answer (`look`). */
class Ahead {
  /** Metres from the body's edge to what is in the way, Infinity for nothing; what it is (a HIT_ value) and its ref. */
  t = Infinity;
  kind = 0;
  ref = 0;
  /** How high it stands over the ground, in metres; whether the mover's bite can harm it; room over it to jump. */
  tall = 0;
  soft = 0;
  room = 0;
  /** The share of the way ahead under water, and whether another body stands in it. */
  wet = 0;
  body = 0;
  /** The mover's heading as a unit, and its span. */
  dx = 0;
  dz = 1;
  span = 1;
}

export class Actions {
  readonly list: Action[];
  readonly point: Point;
  /** `put` names it by this. */
  id = -1;
  /** Actions started since the start, by name. */
  readonly started: Record<string, number> = {};
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly blocking: BodyBlocking;
  private readonly held: Held;
  private readonly ahead = new Ahead();
  private readonly table = tableFor(DO, 8);
  private readonly sure = tableFor(SURE, 1);
  /** The action of each candidate of the last answer. */
  private readonly of = new Int8Array(8);
  /** The rows as declared, by action. */
  private readonly rows: Float32Array;
  // By pool slot: the action under way (-1 none), when it began and until when; and a preference handed on (-1 none).
  private readonly doing: Int8Array;
  private readonly from: Int32Array;
  private readonly until: Int32Array;
  private readonly prefer: Int8Array;

  constructor(world: ServerWorld, mind: Behavior, blocking: BodyBlocking, held: Held, slots: number) {
    this.world = world;
    this.mind = mind;
    this.blocking = blocking;
    this.held = held;
    this.doing = new Int8Array(slots).fill(-1);
    this.from = new Int32Array(slots);
    this.until = new Int32Array(slots);
    this.prefer = new Int8Array(slots).fill(-1);
    const me = this, ahead = this.ahead, ents = world.ents;
    this.list = [
      {
        name: "none", row: { none: 1 }, consent: CONSENT_FREE,
        can: () => true, fits: () => 0, start: () => 0,
      },
      {
        // A body that moves may move off: it stands and lets it.
        name: "wait", row: { waits: 1, seconds: soon(WAIT_SECONDS, SECONDS_HALF) }, consent: CONSENT_FREE,
        can: () => true,
        fits: () => ahead.body,
        start: (e) => (me.stand(e), WAIT_SECONDS * TICK_RATE),
        keep: (e) => me.stand(e),
      },
      {
        // Through what slows it, water most of all, at a price in stamina.
        name: "sprint", row: { through: 1, stamina: 0.5, seconds: soon(SPRINT_SECONDS, SECONDS_HALF), noise: 0.3 }, consent: CONSENT_FREE,
        can: (e) => { const p = mind.walkerOf(e); return p !== null && p.sprintMul > 1 && ents.stamina[e]! > p.staminaSprint * TICK_RATE; },
        fits: () => ahead.wet,
        start: (e, tick) => (me.go(e, tick, BTN_SPRINT), SPRINT_SECONDS * TICK_RATE),
        keep: (e, tick) => me.go(e, tick, BTN_SPRINT),
      },
      {
        // Over what is low enough for its jump, where there is room over it.
        name: "jump", row: { over: 1, stamina: 0.2, seconds: soon(0.5, SECONDS_HALF), noise: 0.2 }, consent: CONSENT_FREE,
        can: (e) => {
          const p = mind.walkerOf(e);
          return p !== null && p.jumpSpeed > 0 && (ents.flags[e]! & F_GROUNDED) !== 0 && (ents.mflags[e]! & (MF_NO_JUMP | MF_ROOTED)) === 0 && ents.stamina[e]! >= p.staminaJump;
        },
        fits: (e) => {
          const p = mind.walkerOf(e)!, clears = (p.jumpSpeed * p.jumpSpeed) / (2 * p.gravity);
          return ahead.room !== 0 && (ahead.kind === HIT_STRUCTURE || ahead.kind === HIT_NODE) && ahead.tall > p.stepUp && ahead.tall <= clears * JUMP_SHARE ? 1 : 0;
        },
        start: (e, tick) => (me.leap(e, tick), JUMP_TICKS),
        keep: (e, tick) => me.leap(e, tick),
      },
      {
        // A hunter whose prey is behind a piece its bite can harm bites the piece, as it would bite it at the prey's side.
        name: "bite", row: { removes: 1, harms: 1, seconds: soon(BITE_SECONDS, SECONDS_HALF), noise: 0.6 }, consent: CONSENT_SURE,
        can: (e) => mind.wants(e) === 3 && mind.want.prey >= 0,
        fits: (e) => {
          const prey = mind.want.prey, t = mind.pieceBetween(e, prey);
          return t >= 0 && t <= world.reg.reach[ents.kind[e]!]! * creatureSize(world, e) ? 1 : 0;
        },
        start: (e, tick) => (me.bite(e, tick), BITE_SECONDS * TICK_RATE),
        keep: (e, tick) => me.bite(e, tick),
      },
    ];
    if (this.list.length > this.of.length) throw new Error("more actions than a DO table holds");
    const w = DO.columns.length;
    this.rows = new Float32Array(this.list.length * w);
    this.list.forEach((a, i) => {
      for (const [name, v] of Object.entries(a.row)) this.rows[i * w + DO.c[name as DoColumn]] = v as number;
      this.started[a.name] = 0;
    });
    this.point = {
      name: "nav.do", cost: COST_PROBE, horizon: 0, tables: [{ profile: DO, table: this.table }, { profile: SURE, table: this.sure }],
      still: (e) => held.rungOf(e) >= 2 && held.trying(e) >= 0,
      answer: (e, tick, rung, ask) => me.ask(e, tick, rung, ask),
      apply: (e, tick, _rung, pick) => me.take(e, tick, pick),
      release: () => me.release(),
    };
  }

  /** No longer acted on: nothing is under way for anyone. */
  release(): void {
    this.doing.fill(-1);
    this.prefer.fill(-1);
  }

  /** A new mover took slot `s`: nothing is under way. */
  clear(s: number): void {
    this.doing[s] = -1;
    this.prefer[s] = -1;
  }

  /** Whether an action holds `e` this tick; if so it has pressed what it needs. */
  act(e: number, tick: number): boolean {
    const s = this.held.slotOf(e);
    if (s < 0 || this.doing[s]! < 0) return false;
    if (tick >= this.until[s]!) {
      this.doing[s] = -1;
      return false;
    }
    this.list[this.doing[s]!]!.keep?.(e, tick, tick - this.from[s]!);
    return true;
  }

  /** The action `e` was last preferred to take and left to whoever set its goal, by name, or null. */
  preferred(e: number): string | null {
    const s = this.held.slotOf(e);
    return s < 0 || this.prefer[s]! < 0 ? null : this.list[this.prefer[s]!]!.name;
  }

  /** The action under way for `e`, by name, or null. */
  under(e: number): string | null {
    const s = this.held.slotOf(e);
    return s < 0 || this.doing[s]! < 0 || this.world.tick >= this.until[s]! ? null : this.list[this.doing[s]!]!.name;
  }

  private ask(e: number, tick: number, rung: number, ask: Ask): number {
    const yaw = this.held.trying(e);
    if (yaw < 0 || !this.look(e, yaw)) return -1;
    const t = this.table, mind = this.mind, ahead = this.ahead, s = DO.s, w = DO.columns.length;
    const mode = mind.wants(e), deep = Math.max(rung, this.held.rungOf(e));
    let k = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i]!.can(e)) this.of[k++] = i;
    t.clear(k);
    t.state[s[MODES[mode]!]] = 1;
    t.state[s.rung] = deep / 3;
    t.state[s.stuckSoon] = soon(this.held.stuckFor(e, tick) / TICK_RATE, STUCK_HALF);
    t.state[s.tall] = ahead.t < Infinity && ahead.kind !== 0 ? unit(ahead.tall / ahead.span, MID_SPANS) : 0;
    t.state[s.soft] = ahead.soft;
    t.state[s.water] = ahead.wet;
    for (let j = 0; j < k; j++) {
      const a = this.of[j]!;
      t.rows.set(this.rows.subarray(a * w, (a + 1) * w), j * w);
      t.rows[j * w + DO.c.fits] = this.list[a]!.fits(e);
    }
    let pick = choose("choice", t, ask(DO, t));
    // An action the decider may start only when sure is asked of; one it doubts is set aside for the next.
    this.sure.clear(0);
    while (pick >= 0 && this.list[this.of[pick]!]!.consent === CONSENT_SURE && this.doubt(e, tick, pick, deep, ask)) {
      t.mask[pick] = 1;
      pick = choose("choice", t, 1);
    }
    return pick;
  }

  /** Whether `nav.sure`, asked of action candidate `j` as if what it meets were gone, is short of SURE_DO. */
  private doubt(e: number, tick: number, j: number, deep: number, ask: Ask): boolean {
    const t = this.table, u = this.sure, c = SURE.c, w = DO.columns.length, at = j * w;
    let second = 0;
    for (let i = 0; i < t.k; i++) if (i !== j && t.mask[i] === 0 && t.out[i]! > second) second = t.out[i]!;
    u.clear(1);
    const fits = t.rows[at + DO.c.fits]!;
    u.rows[c.rung] = deep / 3;
    u.rows[c.ways] = this.held.ways(e);
    u.rows[c.top] = t.out[j]!;
    u.rows[c.lead] = t.out[j]! > second ? t.out[j]! - second : 0;
    u.rows[c.open] = fits;
    u.rows[c.run] = fits;
    u.rows[c.price] = t.rows[at + DO.c.health]! > t.rows[at + DO.c.wear]! ? t.rows[at + DO.c.health]! : t.rows[at + DO.c.wear]!;
    u.rows[c.stuckSoon] = soon(this.held.stuckFor(e, tick) / TICK_RATE, STUCK_HALF);
    choose("yes", u, ask(SURE, u));
    return deep < 2 || u.out[0]! < SURE_DO;
  }

  private take(e: number, tick: number, pick: number): void {
    const s = this.held.slotOf(e);
    if (s < 0) return;
    const a = this.of[pick]!, action = this.list[a]!;
    if (action.consent === CONSENT_ASK) {
      this.prefer[s] = a;
      return;
    }
    // Keeping on moving leaves an action under way to run its time.
    if (a === 0) return;
    this.doing[s] = -1;
    const ticks = action.start(e, tick);
    this.started[action.name]!++;
    if (ticks > 0) {
      this.doing[s] = a;
      this.from[s] = tick;
      this.until[s] = tick + ticks;
    }
  }

  /** Finds what is in the way of `e` along `yaw` into `ahead`; false where it has no body to look with. */
  private look(e: number, yaw: number): boolean {
    const p = this.mind.walkerOf(e);
    if (!p) return false;
    const world = this.world, hf = world.hf, ents = world.ents, ahead = this.ahead, a = (yaw / 65536) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a), x = ents.x[e]!, z = ents.z[e]!, r = p.radius;
    const sp = span(r, GRAIN, p.walkSpeed, REACT), far = Math.max(AHEAD_LEAST, r * AHEAD_RADII);
    const ground = hf.heightAt(x, z);
    ahead.dx = dx;
    ahead.dz = dz;
    ahead.span = sp;
    ahead.kind = castWorld(world, x + dx * r, ground + KNEE * p.height, z + dz * r, dx, 0, dz, far, true);
    ahead.t = ahead.kind === 0 ? Infinity : rayHit.t;
    ahead.ref = rayHit.ref;
    ahead.tall = ahead.soft = ahead.room = 0;
    if (ahead.kind === HIT_STRUCTURE || ahead.kind === HIT_NODE) {
      // Its top: straight down onto it from above the body's head, just past where the knee ray met it.
      const at = r + ahead.t + 0.05, hx = x + dx * at, hz = z + dz * at, up = ground + p.height + p.stepUp;
      const met = castWorld(world, hx, up, hz, 0, -1, 0, p.height + p.stepUp, true);
      ahead.tall = met === 0 ? 0 : up - rayHit.t - ground;
      if (ahead.kind === HIT_STRUCTURE) {
        const structs = world.structs, ref = ahead.ref;
        const takes = world.reg.structTakes[structs.bodyKind(Math.floor(ref / 65536), ref & 0xffff)];
        ahead.soft = takes && takes[DMG_MELEE]! > 0 ? 1 : 0;
      }
      // Room for its body over the top, a radius past where it was met.
      const ox = x + dx * (r + ahead.t + r), oz = z + dz * (r + ahead.t + r);
      ahead.room = capsuleFree(world, ox, ground + ahead.tall + 0.05, oz, r, p.height) ? 1 : 0;
    }
    let wet = 0;
    for (let j = 1; j <= 4; j++) {
      const px = x + dx * (r + far) * (j / 4), pz = z + dz * (r + far) * (j / 4);
      if (hf.waterAt(px, pz) - hf.heightAt(px, pz) > 0.1) wet++;
    }
    ahead.wet = wet / 4;
    ahead.body = 0;
    const bodies = this.blocking.around(e, x, ents.y[e]!, z, r + far, ents.team[e]!, true, this.mind.targetOf(e));
    for (let b = 0; bodies !== null && b < bodies.count && ahead.body === 0; b++) {
      const bx = (bodies.ax[b]! + bodies.bx[b]!) / 2 - x, bz = (bodies.az[b]! + bodies.bz[b]!) / 2 - z;
      const along = bx * dx + bz * dz, side = bx * dz - bz * dx;
      const wide = r + bodies.r[b]! + Math.hypot(bodies.ax[b]! - bodies.bx[b]!, bodies.az[b]! - bodies.bz[b]!) / 2;
      if (along > 0 && along <= r + far + wide && (side < 0 ? -side : side) < wide) ahead.body = 1;
    }
    return true;
  }

  /** Stands where it is. */
  private stand(e: number): void {
    this.mind.move[e] = 0;
    this.mind.buttons[e] = 0;
  }

  /** Goes along the heading it asked along, pressing `button` too. */
  private go(e: number, _tick: number, button: number): void {
    const yaw = this.held.trying(e), mind = this.mind;
    if (yaw >= 0) mind.look[e] = yaw;
    mind.move[e] = 127;
    mind.buttons[e] = button;
  }

  /** Turns to what it jumps, then runs at it holding its jump. */
  private leap(e: number, tick: number): void {
    const yaw = this.held.trying(e), facing = this.world.ents.yaw[e]!;
    if (yaw >= 0 && Math.abs(((facing - yaw + 32768) & 0xffff) - 32768) > FACING) {
      this.mind.look[e] = yaw;
      this.stand(e);
      return;
    }
    this.go(e, tick, BTN_JUMP);
  }

  /** Bites at its prey's middle, where the piece between them stands. */
  private bite(e: number, tick: number): void {
    const mind = this.mind;
    mind.wants(e);
    if (mind.want.prey < 0) return;
    mind.aimAt(e, mind.want.prey);
    mind.move[e] = 0;
    mind.buttons[e] = 0;
    // It bites once it faces the piece, and not into whatever it faces on the way round.
    const ents = this.world.ents;
    if (Math.abs(((ents.yaw[e]! - mind.look[e]! + 32768) & 0xffff) - 32768) <= FACING) mind.bite(e, ents.act[e]!);
    else if (this.held.wedged(e, tick)) {
      // Caught where it cannot turn, it backs out the way it faces first.
      mind.look[e] = ents.yaw[e]!;
      mind.move[e] = -127;
    }
  }
}
