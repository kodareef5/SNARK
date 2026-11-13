// Decay: what nobody of its tribe has come near for long enough may be taken
// down by anyone.
//
// Nothing is kept per piece. There is one clock for each team in each chunk
// where it has built: the last tick one of the team was near, which is within
// a chunk of it. A piece has decayed when that clock is older than what the
// piece is made of allows (shared content: thatch four days, wood eight,
// stone twelve, metal sixteen; a foundation or a ground pillar with nothing
// joined to it, half a day, if the server says so). The server's
// `PvEStructureDecayPeriodMultiplier` stretches or shrinks all of those, and
// `DisableStructureDecayPvE` stops decay.
//
// What has decayed still stands. Anyone may then demolish it
// (server/build.ts); a server started with `-AutoDestroyStructures` takes it
// down itself after `AutoDestroyOldStructuresMultiplier` decay periods, a few
// chunks at a time.

import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE, chunkCx, chunkCz } from "../shared/coords.ts";
import { GONE_TAKEN } from "../shared/world/structures.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

const DAY_TICKS = 86400 * TICK_RATE;
/** Who is near what is looked at this often: five seconds. */
export const DECAY_EVERY = 5 * TICK_RATE;
/** The most pieces the server takes down in one look, when it takes down what has decayed. */
const SWEEP_MAX = 256;

export class Decay {
  /** A clock changed since this was last saved. */
  dirty = false;
  /** Pieces the server took down itself. */
  destroyed = 0;
  /** Whether a root piece has nothing joined to it. Given by whoever knows what is joined to what. */
  lone: ((ref: number) => boolean) | null = null;
  private readonly world: ServerWorld;
  private readonly reg: Registry;
  private readonly rules: Rules;
  /** Team, then chunk: the tick one of the team was last near. */
  private readonly clocks = new Map<number, Map<number, number>>();
  /** Per chunk: the teams with anything built in it, as of a version of the chunk. */
  private readonly teams: (number[] | undefined)[] = [];
  private readonly teamsAt: number[] = [];

  constructor(world: ServerWorld, rules: Rules) {
    this.world = world;
    this.reg = world.reg;
    this.rules = rules;
  }

  /** The teams with anything built in a chunk. */
  private teamsIn(chunk: number): readonly number[] {
    const t = this.world.structs.chunks[chunk];
    if (!t || t.live === 0) return NONE;
    let list = this.teams[chunk];
    if (list && this.teamsAt[chunk] === t.version) return list;
    list = [];
    for (let s = 0; s < t.high; s++) {
      const owner = t.owner[s]!;
      if (t.kind[s] !== 0 && owner !== 0 && !list.includes(owner)) list.push(owner);
    }
    this.teams[chunk] = list;
    this.teamsAt[chunk] = t.version;
    return list;
  }

  /** One of `team` is in `chunk`: whatever the team has built there and in the chunks around has been visited. */
  visit(team: number, chunk: number, tick: number): void {
    if (team === 0) return;
    const dims = this.world.dims;
    const cx = chunkCx(dims, chunk);
    const cz = chunkCz(dims, chunk);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cx + dx < 0 || cz + dz < 0 || cx + dx >= dims.chunksX || cz + dz >= dims.chunksZ) continue;
        const at = (cz + dz) * dims.chunksX + cx + dx;
        if (this.teamsIn(at).includes(team)) this.set(team, at, tick);
      }
    }
  }

  private set(team: number, chunk: number, tick: number): void {
    let of = this.clocks.get(team);
    if (!of) this.clocks.set(team, (of = new Map()));
    of.set(chunk, tick);
    this.dirty = true;
  }

  /** How many ticks a structure of `kind` lasts unvisited; `lone` for a root with nothing joined to it. 0: for ever. */
  period(kind: number, lone: boolean): number {
    const days = this.reg.decayDays[kind]!;
    if (!(days > 0)) return 0;
    const whole = Math.round(days * DAY_TICKS * this.rules.num("PvEStructureDecayPeriodMultiplier"));
    // By the server's rule a foundation or pillar joined to nothing decays in a time of its own, if that is sooner.
    if (!lone || !this.rules.on("FastDecayUnsnappedCoreStructures")) return whole;
    const fast = Math.round(this.rules.num("FastDecayInterval") * TICK_RATE);
    return fast < whole ? fast : whole;
  }

  /**
   * Whether anything decays at all, by the server's rules: on a PvE server
   * unless it is switched off, and on any other only if it is switched on.
   */
  active(): boolean {
    const r = this.rules;
    return !r.on("DisableStructureDecayPvE") && (r.on("serverPVE") || r.on("PvPStructureDecay"));
  }

  /** Whether the structure at `ref` has been left long enough that anyone may take it down. */
  expired(ref: number, tick: number): boolean {
    const chunk = Math.floor(ref / 65536);
    const slot = ref & 0xffff;
    const t = this.world.structs.chunks[chunk];
    if (!t || slot >= t.high || t.kind[slot] === 0) return false;
    const team = t.owner[slot]!;
    const kind = t.kind[slot]!;
    if (team === 0 || !(this.reg.decayDays[kind]! > 0) || !this.active()) return false;
    const last = this.clocks.get(team)?.get(chunk);
    if (last === undefined) {
      // Never looked at before (built by another hand, or its tribe has changed): its time starts now.
      this.set(team, chunk, tick);
      return false;
    }
    const left = tick - last;
    if (left >= this.period(kind, false)) return true;
    return left >= this.period(kind, true) && this.lone !== null && this.lone(ref);
  }

  /**
   * Once a tick. Every five seconds: each team with someone alive in the
   * world has visited what is near them; and, if the rule says so, what has
   * decayed is taken down.
   */
  step(tick: number, near: (visit: (team: number, chunk: number) => void) => void): void {
    if (tick % DECAY_EVERY !== 0) return;
    near((team, chunk) => this.visit(team, chunk, tick));
    // The server takes down what has decayed only if it was started to (ARK's -AutoDestroyStructures), and then after
    // so many decay periods as its rule says: 1 is as soon as anyone might have.
    const after = this.rules.num("AutoDestroyOldStructuresMultiplier");
    if (this.rules.flag("AutoDestroyStructures") !== true || !(after > 0) || !this.active()) return;
    const structs = this.world.structs;
    let taken = 0;
    for (const [team, of] of this.clocks) {
      for (const [chunk, last] of of) {
        const t = structs.chunks[chunk];
        for (let s = 0; t && s < t.high && taken < SWEEP_MAX; s++) {
          if (t.kind[s] === 0 || t.owner[s] !== team) continue;
          const ref = chunk * 65536 + s;
          if (!this.expired(ref, tick)) continue;
          // Expired by which of its two periods; and that many times over.
          const whole = this.period(t.kind[s]!, false);
          const mine = tick - last >= whole ? whole : this.period(t.kind[s]!, true);
          if (tick - last < mine * after) continue;
          structs.remove(ref, GONE_TAKEN, tick);
          taken++;
        }
      }
    }
    this.destroyed += taken;
  }

  /** The clocks as text, without those of teams that have nothing left where the clock is. */
  serialize(): string {
    const out: number[] = [];
    for (const [team, of] of this.clocks) {
      for (const [chunk, last] of of) {
        if (this.teamsIn(chunk).includes(team)) out.push(team, chunk, last);
        else of.delete(chunk);
      }
      if (of.size === 0) this.clocks.delete(team);
    }
    this.dirty = false;
    return JSON.stringify(out);
  }

  /** Take in saved clocks. Anything that is not three numbers at a time is left out. */
  restore(saved: string | number | null): void {
    if (typeof saved !== "string") return;
    let list: unknown;
    try {
      list = JSON.parse(saved);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    for (let i = 0; i + 2 < list.length; i += 3) {
      const [team, chunk, last] = [list[i], list[i + 1], list[i + 2]];
      if (typeof team !== "number" || typeof chunk !== "number" || typeof last !== "number" || !(team > 0) || !(chunk >= 0)) continue;
      let of = this.clocks.get(team);
      if (!of) this.clocks.set(team, (of = new Map()));
      of.set(chunk, last);
    }
    this.dirty = false;
  }
}

const NONE: readonly number[] = [];
