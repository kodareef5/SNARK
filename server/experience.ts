// Experience no one deed earns alone. The drip comes with time: to a living survivor whose session is here, and to a
// tame with such a survivor of its team near it. The share is half of what a kill, a harvest or a craft earned, given to
// whoever steers the earner, to each other living survivor of the earner's team near it, and once to each tame one of
// them sits on. The earner keeps its own. Both figures are the reference game's (ark.wiki.gg, Experience, 2026-11-23);
// it gives the drip for tames only.

import { TICK_RATE } from "../shared/coords.ts";
import type { GameServer } from "./game.ts";
import { XP_TIME, type Progression } from "./progression.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** Experience a minute, before GenericXPMultiplier. */
export const DRIP_PER_MINUTE = 0.66;
/**
 * Ticks between one body's drips. Each body has its own tick of them, by its record id, so that the saving and the
 * sending a drip causes fall on a few records a tick and never on every one at once.
 */
export const DRIP_TICKS = 10 * TICK_RATE;
/** Metres from a survivor within which its team shares what is earned, and its tames get the drip. */
export const SHARE_RANGE = 100;
export const SHARE_PART = 0.5;

export interface ExperienceContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly game: GameServer;
  readonly progression: Progression;
  /** The creatures that are awake, and how many of the list they are. */
  awake(): readonly [list: ArrayLike<number>, count: number];
  /** The creature a survivor sits on, or null. */
  mountOf(rec: EntityRecord): EntityRecord | null;
  /** Who steers a creature, or null. */
  riderOf(rec: EntityRecord): EntityRecord | null;
}

export class Experience {
  private readonly ctx: ExperienceContext;
  /** The living survivors whose sessions are here, as of the last gathering: each one's team and entity. */
  private readonly teams: number[] = [];
  private readonly bodies: number[] = [];
  private readonly found: EntityRecord[] = [];
  /** The tames given their part of the share being made. */
  private readonly paid: EntityRecord[] = [];
  private readonly survivor: number;

  constructor(ctx: ExperienceContext) {
    this.ctx = ctx;
    this.survivor = ctx.world.reg.index.get("core:survivor") ?? 0;
    ctx.progression.onShare = (rec, amount, source) => this.share(rec, amount, source);
  }

  step(tick: number): void {
    const { world, records, game, progression } = this.ctx;
    const ents = world.ents;
    const slot = tick % DRIP_TICKS;
    const amount = (DRIP_PER_MINUTE * DRIP_TICKS) / (60 * TICK_RATE);
    let here = false;
    for (let i = 0; i < game.clients.length; i++) {
      const c = game.clients[i];
      if (!c || !c.active || c.closed || c.pid === 0) continue;
      here = true;
      if (c.pid % DRIP_TICKS !== slot) continue;
      const rec = records.byPid.get(c.pid);
      if (rec && !rec.dead && !rec.out && records.entOf.has(rec.pid)) progression.addXp(rec, amount, XP_TIME);
    }
    if (!here) return;
    const [list, count] = this.ctx.awake();
    const { teams, bodies } = this;
    let gathered = false;
    for (let k = 0; k < count; k++) {
      const e = list[k]!, pid = ents.pid[e]!;
      if (pid % DRIP_TICKS !== slot) continue;
      const rec = records.byPid.get(pid);
      // The list holds every body that is awake. Only a tamed creature is given this.
      if (!rec || rec.team === 0 || !rec.genome || rec.kind === this.survivor) continue;
      if (!gathered) this.gather();
      gathered = true;
      for (let i = 0; i < teams.length; i++) {
        if (teams[i] !== rec.team || !near(ents, e, bodies[i]!)) continue;
        progression.addXp(rec, amount, XP_TIME);
        break;
      }
    }
  }

  /** Gives its rider and those near `rec` their part of `amount`, which it earned before any multiplier. */
  private share(rec: EntityRecord, amount: number, source: number): void {
    const { world, records, progression } = this.ctx;
    const part = amount * SHARE_PART;
    // Whoever steers the earner has its half whatever the deed and whoever's the earner is: a mount's rider, a held creature's carrier.
    const rider = this.ctx.riderOf(rec);
    if (rider && rider !== rec && !rider.dead) progression.addXp(rider, part, source, false);
    const from = records.entOf.get(rec.pid);
    if (rec.team === 0 || from === undefined) return;
    this.gather();
    const { teams, bodies, found, paid } = this;
    paid.length = 0;
    for (let i = 0; i < found.length; i++) {
      const mate = found[i]!;
      if (teams[i] !== rec.team || !near(world.ents, from, bodies[i]!)) continue;
      if (mate !== rec && mate !== rider) progression.addXp(mate, part, source, false);
      // A tame with several on it has one part, not one for each.
      const mount = this.ctx.mountOf(mate);
      if (!mount || mount === rec || mount.team !== rec.team || paid.includes(mount)) continue;
      paid.push(mount);
      progression.addXp(mount, part, source, false);
    }
  }

  private gather(): void {
    const { records, game } = this.ctx;
    const { teams, bodies, found } = this;
    teams.length = bodies.length = found.length = 0;
    for (const c of game.clients) {
      if (!c || !c.active || c.closed || c.pid === 0) continue;
      const rec = records.byPid.get(c.pid);
      const e = rec ? records.entOf.get(rec.pid) : undefined;
      if (!rec || e === undefined || rec.dead || rec.out) continue;
      teams.push(rec.team);
      bodies.push(e);
      found.push(rec);
    }
  }
}

function near(ents: { x: Float32Array; y: Float32Array; z: Float32Array }, a: number, b: number): boolean {
  const dx = ents.x[a]! - ents.x[b]!, dy = ents.y[a]! - ents.y[b]!, dz = ents.z[a]! - ents.z[b]!;
  return dx * dx + dy * dy + dz * dz <= SHARE_RANGE * SHARE_RANGE;
}
