// Breeding: two creatures that are somebody's make young.
//
// The arithmetic is shared/sim/breeding.ts and shared/sim/genome.ts. This
// keeps the state, and almost none of it steps (D77): an egg is a record with
// the tick it hatches at; a young one is a record with the ticks its growing
// takes and the tick it ends, and grows a hundredth at a time, each a moment known in
// advance. So an egg hatches, and a young one is grown, on the same tick
// watched or not, and across a restart.
//
// Mating is as the reference has it since its remake: both must be told they
// may, and then a female and a male of one species and one tribe, standing
// near each other, neither following anyone, ridden, overloaded, unconscious
// or still young, become a pair. Pairs are looked for among the creatures
// that are awake, once a second. A pair that stays together for half a minute
// has done: the female lays (one egg, sometimes two or three), or carries her
// young if her species does, and will not mate again for most of a day or
// two. One that is parted first has nothing for it. A male may be several
// females' at once.
//
// What hatches is nobody's until someone takes it (the use button): anyone
// may. Until then it stands where it hatched, and it hungers many times as
// fast as a grown one, so one that nobody comes for does not live long.
//
// What the reference does that this does not yet: an egg cannot be carried,
// kept cold, eaten or broken, and wants no particular warmth; nothing is
// imprinted on whoever raises it. Its twins come out of one egg; here each
// has its own.

import { TICK_RATE } from "../shared/coords.ts";
import { EVENT_TAMED, ORDER_MATE, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { GROWN, MATE_RANGE, MATE_TICKS, growthStep, litter, mateWait, maturity, stageOf, stepTick } from "../shared/sim/breeding.ts";
import { MF_NO_SPRINT } from "../shared/sim/character.ts";
import { F_AWAKE } from "../shared/sim/entities.ts";
import { breed } from "../shared/sim/genome.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { capsuleFree } from "../shared/world/collide.ts";
import type { Creatures } from "./creatures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Persistence } from "./persist/persistence.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./rules.ts";
import type { Lists } from "./settings/lists.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_BREED = 8;
/** Pairs are looked for, and those there are looked at again, this often: ticks. */
export const PAIR_TICKS = TICK_RATE;
/** Palette indices a mutation may give a colour region: none of them one a wild creature has. */
export const MUTATION_COLORS: readonly number[] = [8, 10, 11, 13, 14, 17, 19, 21];
/** In the event that says a creature is someone's, the mark of one that was taken as young and not tamed. */
export const CLAIMED = 255;

export interface BreedingContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly rules: Rules;
  readonly deadlines: DeadlineHeap;
  readonly creatures: Creatures;
  readonly persistence: Persistence | null;
  /** Put the body of a prop (an egg) in the world where its record says it is. */
  place(rec: EntityRecord): void;
  /** Recompute what follows from a record: its body's limits, level, name and team. */
  refresh(rec: EntityRecord): void;
  /** Work out again when a creature that is somebody's next eats of what it carries. */
  meal(rec: EntityRecord): void;
  /** The server's lists that name classes. */
  readonly lists: Lists;
  /** Why a team may have no more tamed creatures; "" if it may. */
  full(team: number): string;
  /** Tell a survivor something, if they are here. */
  notice(pid: number, text: string): void;
}

/** A rule that speeds something: what it divides a time by. Turned to nothing, it is as slow as a rule can make it. */
const speed = (rule: number): number => (rule > 0.001 ? rule : 0.001);

export class Breeding {
  /** Matings that came to something; eggs laid and young begun; young hatched or born; young taken by someone; young grown up. */
  mated = 0;
  laid = 0;
  hatched = 0;
  claimed = 0;
  grownUp = 0;
  /** Pairs begun, and pairs parted before they had done. */
  begun = 0;
  parted = 0;
  private readonly ctx: BreedingContext;
  private readonly rng: Rng;
  /** The pairs there are, by the female's persistent id: the male, and the ticks they began and will have done. */
  private readonly pairs = new Map<number, { male: number; began: number; due: number }>();
  /** Scratch for a pass: the willing females and males that are awake (entity indices), and the females among them (persistent ids). */
  private readonly females: number[] = [];
  private readonly males: number[] = [];
  private readonly seen = new Set<number>();

  constructor(ctx: BreedingContext, seed: number) {
    this.ctx = ctx;
    this.rng = new Rng(seed);
  }

  /** After a load, with every body back in the world: eggs wait to hatch again, and the young go on growing. */
  resume(): void {
    const { world, records, deadlines } = this.ctx;
    for (const rec of records.byPid.values()) {
      if (rec.egg) {
        const e = records.entOf.get(rec.pid);
        if (e !== undefined) world.ents.setYoung(e, rec.egg.span, rec.egg.hatchAt);
        const at = rec.egg.hatchAt > world.tick ? rec.egg.hatchAt : world.tick + 1;
        rec.egg.hatchAt = at;
        deadlines.push(at, DEADLINE_BREED, rec.pid, at);
      } else if (rec.grown !== 0) this.next(rec);
    }
  }

  /** Whether creature `rec`, whose body is entity `e`, would mate now if it had someone to mate with. */
  private able(rec: EntityRecord, e: number): boolean {
    const { world } = this.ctx;
    const ents = world.ents;
    // Not if the server says nothing breeds, or not its kind.
    if (this.ctx.rules.on("bDisableDinoBreeding") || this.ctx.lists.kinds("PreventBreedingForClassNames").has(rec.kind)) return false;
    // Somebody's, told it may, grown, awake to the world, standing where it was left, nobody on it, and not weighed down.
    return rec.mating && rec.team !== 0 && rec.grown === 0 && rec.egg === null && !rec.out && !rec.dead && rec.follow === 0 && rec.genome !== null && world.reg.breedEgg[rec.kind] !== 0xffff && ents.driven[e] === 0 && (ents.mflags[e]! & MF_NO_SPRINT) === 0;
  }

  /** Whether two bodies are near enough to be a pair. */
  private together(a: number, b: number): boolean {
    const ents = this.ctx.world.ents;
    const dx = ents.x[a]! - ents.x[b]!;
    const dz = ents.z[a]! - ents.z[b]!;
    return dx * dx + dz * dz <= MATE_RANGE * MATE_RANGE;
  }

  /**
   * Once a tick; on one tick in every second, among the creatures that are
   * somebody's and awake: every willing female with no pair takes the nearest
   * willing male of her kind and tribe within reach, and every pair one of
   * which has gone, or is no longer willing, is parted.
   */
  step(tick: number): void {
    if (tick % PAIR_TICKS !== 0) return;
    const { world, records, creatures, deadlines } = this.ctx;
    if (creatures.mind.owned.size === 0 && this.pairs.size === 0) return;
    const ents = world.ents;
    const females = this.females;
    const males = this.males;
    const seen = this.seen;
    females.length = males.length = 0;
    seen.clear();
    for (const e of creatures.mind.owned) {
      const rec = records.byPid.get(ents.pid[e]!);
      if (!rec || !rec.mating || !this.able(rec, e)) continue;
      if (!rec.genome!.female) males.push(e);
      else if (tick >= rec.mateReadyAt) females.push(e);
    }
    for (const f of females) {
      const pid = ents.pid[f]!;
      const pair = this.pairs.get(pid);
      let best = -1;
      let near = MATE_RANGE * MATE_RANGE;
      let kept = false;
      for (const m of males) {
        if (ents.kind[m] !== ents.kind[f] || ents.team[m] !== ents.team[f]) continue;
        const dx = ents.x[m]! - ents.x[f]!;
        const dz = ents.z[m]! - ents.z[f]!;
        const d2 = dx * dx + dz * dz;
        if (d2 > MATE_RANGE * MATE_RANGE) continue;
        if (pair && ents.pid[m] === pair.male) kept = true;
        if (best < 0 || d2 < near) {
          near = d2;
          best = m;
        }
      }
      if (pair) {
        if (kept) {
          seen.add(pid);
          continue;
        }
        // He has gone, or will not: what they had begun is lost.
        this.pairs.delete(pid);
        this.parted++;
      }
      if (best < 0) continue;
      const due = tick + MATE_TICKS;
      this.pairs.set(pid, { male: ents.pid[best]!, began: tick, due });
      deadlines.push(due, DEADLINE_BREED, pid, due);
      seen.add(pid);
      this.begun++;
    }
    // A pair whose female is awake and was not found willing just now is parted. One asleep cannot have changed.
    for (const pid of this.pairs.keys()) {
      if (seen.has(pid)) continue;
      const e = records.entOf.get(pid);
      if (e === undefined || (ents.flags[e]! & F_AWAKE) !== 0) {
        this.pairs.delete(pid);
        this.parted++;
      }
    }
  }

  /** A DEADLINE_BREED entry came due: an egg hatches, a young one is a hundredth more grown, or a pair has done. */
  due(pid: number, stamp: number): void {
    const { world, records } = this.ctx;
    const rec = records.byPid.get(pid);
    if (!rec) {
      this.pairs.delete(pid);
      return;
    }
    if (rec.egg) {
      if (rec.egg.hatchAt === stamp) this.hatch(rec);
      return;
    }
    if (rec.grown !== 0) {
      if (rec.growDue === stamp) this.grow(rec);
      return;
    }
    const pair = this.pairs.get(pid);
    if (!pair || pair.due !== stamp) return;
    this.pairs.delete(pid);
    // Both still there, still willing, and still together, at the moment it counts.
    const father = records.byPid.get(pair.male);
    const fe = records.entOf.get(pid);
    const me = father ? records.entOf.get(father.pid) : undefined;
    if (!father || fe === undefined || me === undefined || !this.able(rec, fe) || !this.able(father, me) || !this.together(fe, me) || world.tick < rec.mateReadyAt || father.kind !== rec.kind || father.team !== rec.team) {
      this.parted++;
      return;
    }
    this.lay(rec, father, fe);
  }

  /** A pair has done: the female lays, or begins to carry, and will not mate again for a while. */
  private lay(mother: EntityRecord, father: EntityRecord, e: number): void {
    const { world, records, rules, deadlines } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const tick = world.tick;
    const n = litter(this.rng.float());
    const eggKind = reg.breedEgg[mother.kind]!;
    const span = Math.max(1, Math.ceil(reg.incubateTicks[mother.kind]! / speed(rules.values.hatchSpeed)));
    const hatchAt = tick + span;
    const id = reg.ids[mother.kind]!;
    const what = id.slice(id.indexOf(":") + 1);
    const facing = (ents.yaw[e]! / 65536) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      // Each of a litter is its own draw of what its parents have.
      const egg = records.create(eggKind !== 0 ? eggKind : mother.kind, `${what} egg`);
      egg.genome = breed(mother.genome!, father.genome!, mother.pid, father.pid, this.rng, MUTATION_COLORS);
      egg.egg = { species: mother.kind, span, hatchAt, carrier: eggKind !== 0 ? 0 : mother.pid };
      // Just behind her, where it can be seen and she is not in the way of it; more than one lie fanned out. If there is no room there (a wall at her back), under her.
      const a = facing + Math.PI + (k - (n - 1) / 2) * 0.7;
      const off = reg.bodyRadius[mother.kind]! + 0.45;
      egg.x = ents.x[e]! + Math.sin(a) * off;
      egg.z = ents.z[e]! + Math.cos(a) * off;
      const ground = world.hf.heightAt(egg.x, egg.z);
      egg.y = ground > ents.y[e]! ? ground : ents.y[e]!;
      if (eggKind !== 0 && !capsuleFree(world, egg.x, egg.y, egg.z, reg.bodyRadius[eggKind]!, reg.bodyHeight[eggKind]!)) {
        egg.x = ents.x[e]!;
        egg.y = ents.y[e]!;
        egg.z = ents.z[e]!;
      }
      egg.yaw = this.rng.int(65536);
      if (eggKind !== 0) this.put(egg);
      deadlines.push(hatchAt, DEADLINE_BREED, egg.pid, hatchAt);
      this.laid++;
    }
    mother.mateReadyAt = tick + Math.round(mateWait(this.rng.float()) * TICK_RATE * rules.values.matingInterval);
    records.dirty.add(mother.pid);
    this.mated++;
  }

  /** Put a laid egg's body in the world: anyone who looks at it can tell when it will hatch. */
  private put(egg: EntityRecord): void {
    this.ctx.place(egg);
    const e = this.ctx.records.entOf.get(egg.pid);
    if (e !== undefined) this.ctx.world.ents.setYoung(e, egg.egg!.span, egg.egg!.hatchAt);
  }

  /** Take an egg out of the world for good. */
  private discard(egg: EntityRecord): void {
    const { world, records } = this.ctx;
    const e = records.entOf.get(egg.pid);
    if (e !== undefined) world.ents.destroy(e);
    records.delete(egg.pid);
  }

  /** An egg's time has come: what was in it is in the world, young, and nobody's. */
  private hatch(egg: EntityRecord): void {
    const { world, records, creatures, rules, deadlines, persistence } = this.ctx;
    const reg = world.reg;
    const ents = world.ents;
    const tick = world.tick;
    const info = egg.egg!;
    let x = egg.x;
    let y = egg.y;
    let z = egg.z;
    if (info.carrier !== 0) {
      // Carried: born where its mother now stands. If she is gone, so is what she carried.
      const mother = records.byPid.get(info.carrier);
      const me = mother ? records.entOf.get(mother.pid) : undefined;
      if (!mother || mother.dead || me === undefined) return this.discard(egg);
      x = ents.x[me]!;
      y = ents.y[me]!;
      z = ents.z[me]!;
    }
    if (!egg.genome || reg.defs[info.species]?.type !== "species" || reg.breedEgg[info.species] === 0xffff) return this.discard(egg);
    const rec = records.create(info.species);
    rec.genome = egg.genome;
    rec.x = x;
    rec.y = y;
    rec.z = z;
    rec.yaw = egg.yaw;
    // Never so fast that a hundredth of it is less than a tick.
    rec.span = Math.max(GROWN, Math.ceil(reg.matureTicks[info.species]! / speed(rules.values.matureSpeed)));
    rec.grown = tick + rec.span;
    const e = creatures.adopt(rec);
    if (e < 0) {
      // No room in the world for another body: it waits a moment longer in the egg.
      records.delete(rec.pid);
      info.hatchAt = tick + PAIR_TICKS;
      records.dirty.add(egg.pid);
      deadlines.push(info.hatchAt, DEADLINE_BREED, egg.pid, info.hatchAt);
      return;
    }
    persistence?.attach(rec, e);
    this.discard(egg);
    this.hatched++;
    this.next(rec);
  }

  /** Set the tick a young one is next a hundredth more grown. */
  private next(rec: EntityRecord): void {
    const tick = this.ctx.world.tick;
    const at = stepTick(rec.span, rec.grown, growthStep(rec.span, rec.grown, tick) + 1);
    const due = at > tick ? at : tick + 1;
    rec.growDue = due;
    this.ctx.deadlines.push(due, DEADLINE_BREED, rec.pid, due);
  }

  /** A young one is a hundredth more grown: it can hold more, carry more, and hungers a little less. Or it is grown. */
  private grow(rec: EntityRecord): void {
    const { world, records } = this.ctx;
    if (world.tick >= rec.grown) {
      rec.span = rec.grown = rec.growDue = 0;
      const e = records.entOf.get(rec.pid);
      if (e !== undefined) world.ents.setYoung(e, 0, 0);
      this.grownUp++;
    }
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    this.ctx.meal(rec);
    if (rec.grown !== 0) this.next(rec);
  }

  /** A cheat: this egg hatches now. False if it is no egg. */
  hatchNow(egg: EntityRecord): boolean {
    if (!egg.egg) return false;
    egg.egg.hatchAt = this.ctx.world.tick;
    this.hatch(egg);
    return true;
  }

  /** A cheat: this young one is grown now. False if it is not young. */
  growNow(rec: EntityRecord): boolean {
    if (rec.grown === 0 || rec.egg) return false;
    rec.grown = this.ctx.world.tick;
    this.grow(rec);
    return true;
  }

  /** Whether this is a young one that is nobody's yet. */
  unclaimed(rec: EntityRecord): boolean {
    return rec.team === 0 && rec.grown !== 0 && rec.egg === null && rec.keyHash === null;
  }

  /** A session takes a young one that is nobody's: it is its tribe's from now, and stands where it is until told otherwise. */
  claim(c: Client, rec: EntityRecord): number {
    const { world, records, creatures, game } = this.ctx;
    const me = records.byPid.get(c.pid);
    if (!me || me.team === 0 || me.dead || me.out) return RESULT_DENIED;
    if (!this.unclaimed(rec)) return RESULT_INVALID;
    // Not if the tribe, or the server, has as many tamed creatures as it may.
    const full = this.ctx.full(me.team);
    if (full !== "") {
      this.ctx.notice(c.pid, full);
      return RESULT_FULL;
    }
    rec.team = me.team;
    records.dirty.add(rec.pid);
    this.ctx.refresh(rec);
    const e = records.entOf.get(rec.pid);
    if (e !== undefined) {
      creatures.mind.stay(e, 0xffffffff);
      creatures.claimed(e);
    }
    this.ctx.meal(rec);
    this.claimed++;
    // Whoever took it is told, as of a creature tamed, so that they can say what it is to be called.
    if (e !== undefined) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_TAMED);
      w.u32(world.ents.handleOf(e));
      w.u16(rec.kind);
      w.u16(rec.genome ? rec.genome.level : 1);
      w.u8(CLAIMED);
      game.endOwn(c);
    }
    return RESULT_OK;
  }

  /**
   * A creature of someone's tribe is told it may mate, or may not (an ORDER_
   * of the protocol). Whether whoever tells it may is the caller's to have
   * checked. Not one that is young, or of a species that does not breed.
   */
  order(rec: EntityRecord, what: number): number {
    const { world, records } = this.ctx;
    if (world.reg.breedEgg[rec.kind] === 0xffff || rec.grown !== 0 || rec.team === 0) return RESULT_INVALID;
    const on = what === ORDER_MATE;
    if (on && (this.ctx.rules.on("bDisableDinoBreeding") || this.ctx.lists.kinds("PreventBreedingForClassNames").has(rec.kind))) return RESULT_DENIED;
    if (rec.mating === on) return RESULT_OK;
    rec.mating = on;
    records.dirty.add(rec.pid);
    // Told it may not: whatever it had begun is lost, now and not at the next look.
    if (!on) {
      if (this.pairs.delete(rec.pid)) this.parted++;
      for (const [pid, pair] of this.pairs) {
        if (pair.male !== rec.pid) continue;
        this.pairs.delete(pid);
        this.parted++;
      }
    }
    return RESULT_OK;
  }

  /** How far along the pair this creature is one of has got, 0 to 1; 0 for one that is in none. A male's is that of the furthest along. */
  progress(rec: EntityRecord): number {
    const tick = this.ctx.world.tick;
    const share = (p: { began: number; due: number }): number => Math.max(0, Math.min(1, (tick - p.began) / (p.due - p.began)));
    const own = this.pairs.get(rec.pid);
    if (own) return share(own);
    let best = 0;
    for (const p of this.pairs.values()) if (p.male === rec.pid) best = Math.max(best, share(p));
    return best;
  }

  /** What a session looking into a creature is shown of its breeding. */
  subject(rec: EntityRecord): { mating: boolean; female: boolean; stage: number; maturity: number; mate: number; wait: number } {
    const tick = this.ctx.world.tick;
    const step = growthStep(rec.span, rec.grown, tick);
    return {
      mating: rec.mating,
      female: rec.genome ? rec.genome.female : false,
      stage: stageOf(step),
      maturity: maturity(rec.span, rec.grown, tick),
      mate: rec.mating ? this.progress(rec) : 0,
      // Seconds until a female may mate again.
      wait: rec.mateReadyAt > tick ? Math.ceil((rec.mateReadyAt - tick) / TICK_RATE) : 0,
    };
  }

  /** How many pairs there are now. */
  get pairCount(): number {
    return this.pairs.size;
  }
}
