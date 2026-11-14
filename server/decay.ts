// Decay keeps no per-piece state. Each team has one clock per chunk it has built in, the last tick a member was within a chunk of it.
// A decayed piece still stands, and anyone may then demolish it (server/build.ts).

import type { Registry } from "../shared/content/registry.ts";
import { TICK_RATE, chunkCx, chunkCz } from "../shared/coords.ts";
import { GONE_TAKEN } from "../shared/world/structures.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

const DAY_TICKS = 86400 * TICK_RATE;
export const DECAY_EVERY = 5 * TICK_RATE;
/** Most pieces auto-destroy removes in one sweep. */
const SWEEP_MAX = 256;

export class Decay {
  dirty = false;
  /** Pieces auto-destroy has removed. */
  destroyed = 0;
  /** Whether a root piece has nothing joined to it. */
  lone: ((ref: number) => boolean) | null = null;
  private readonly world: ServerWorld;
  private readonly reg: Registry;
  private readonly rules: Rules;
  /** Team, then chunk, to the tick a member was last near. */
  private readonly clocks = new Map<number, Map<number, number>>();
  /** Per chunk, the teams with anything built in it, cached at chunk version teamsAt. */
  private readonly teams: (number[] | undefined)[] = [];
  private readonly teamsAt: number[] = [];

  constructor(world: ServerWorld, rules: Rules) {
    this.world = world;
    this.reg = world.reg;
    this.rules = rules;
  }

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

  /** A member of `team` is in `chunk`. Sets the team's clocks there and in the eight chunks around it. */
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

  /** Ticks a structure of `kind` lasts unvisited, or 0 for no decay. `lone` is a root with nothing joined to it. */
  period(kind: number, lone: boolean): number {
    const days = this.reg.decayDays[kind]!;
    if (!(days > 0)) return 0;
    const whole = Math.round(days * DAY_TICKS * this.rules.num("PvEStructureDecayPeriodMultiplier"));
    if (!lone || !this.rules.on("FastDecayUnsnappedCoreStructures")) return whole;
    const fast = Math.round(this.rules.num("FastDecayInterval") * TICK_RATE);
    return fast < whole ? fast : whole;
  }

  active(): boolean {
    const r = this.rules;
    return !r.on("DisableStructureDecayPvE") && (r.on("serverPVE") || r.on("PvPStructureDecay"));
  }

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
      // No clock yet (another team built it, or its tribe changed), so its time starts now.
      this.set(team, chunk, tick);
      return false;
    }
    const left = tick - last;
    if (left >= this.period(kind, false)) return true;
    return left >= this.period(kind, true) && this.lone !== null && this.lone(ref);
  }

  /** Call once a tick. `near` calls visit for the team and chunk of each living, connected survivor. */
  step(tick: number, near: (visit: (team: number, chunk: number) => void) => void): void {
    if (tick % DECAY_EVERY !== 0) return;
    near((team, chunk) => this.visit(team, chunk, tick));
    // ARK's -AutoDestroyStructures. A multiplier of 1 removes a piece as soon as anyone could demolish it.
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
          // The period it expired by, whole or lone, must have passed `after` times over.
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

  /** A flat JSON array of team, chunk, tick triples. Drops clocks for chunks where the team has nothing left. */
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

  /** Skips any triple that is not three valid numbers. */
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
