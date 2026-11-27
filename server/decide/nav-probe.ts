// `nav.probe`: a calm wanderer looks before it walks. Behavior draws its heading as it always has and puts the question;
// the answer weighs that heading against one either side of it by how far its knee and chest see free over two seconds
// of walking, and turns the wanderer to the freest. Off or watched, the wanderer walks the heading it drew.

import { TICK_RATE } from "../../shared/coords.ts";
import { answer as choose } from "../../shared/decide/forward.ts";
import { PROBE, PROBE_SECONDS } from "../../shared/decide/profiles.ts";
import { tableFor } from "../../shared/decide/table.ts";
import { unit } from "../../shared/decide/units.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { MIND_WANDER, type Behavior } from "../behavior.ts";
import type { ServerWorld } from "../world.ts";
import { COST_PROBE, type Ask, type Point } from "./decide.ts";
import { Fan } from "./nav-fan.ts";

/** In 65536ths of a turn: how far either side of the drawn heading the other two lie. */
export const PROBE_TURN = 10923;
/** Of the body's height, where the knee and the chest rays run. */
const KNEE = 0.3;
const CHEST = 0.75;
/** Of the body's radius, how far to a side its rays run, and how far ahead of its middle they begin, on its skin. */
const SIDE = 0.9;
const FRONT = Math.sqrt(1 - SIDE * SIDE);
/** Metres it looks at least, for the slowest. */
const LEAST = 1;

export class Probe {
  readonly point: Point;
  private readonly world: ServerWorld;
  private readonly mind: Behavior;
  private readonly table = tableFor(PROBE, 3);
  private readonly fan: Fan;
  /** The headings of the last answer, in 65536ths of a turn, the metres each runs free, and ticks a metre at its walk. */
  private readonly yaw = new Uint16Array(3);
  private readonly free = new Float64Array(3);
  private perMetre = 0;
  private looked = 0;

  constructor(world: ServerWorld, mind: Behavior) {
    this.world = world;
    this.mind = mind;
    this.fan = new Fan(world);
    const probe = this;
    this.point = {
      name: "nav.probe", cost: COST_PROBE, horizon: 0, tables: [{ profile: PROBE, table: this.table }],
      still: (e) => (world.ents.flags[e]! & F_AWAKE) !== 0 && mind.mind[e] === MIND_WANDER && mind.move[e] !== 0 && mind.rung[e] === 0,
      answer: (e, _tick, _rung, ask) => probe.ask(e, ask),
      apply: (e, tick, _rung, pick) => probe.turn(e, tick, pick),
    };
  }

  private ask(e: number, ask: Ask): number {
    const p = this.mind.walkerOf(e);
    if (!p) return -1;
    const world = this.world, ents = world.ents, hf = world.hf, t = this.table, c = PROBE.c, fan = this.fan;
    const x = ents.x[e]!, z = ents.z[e]!, r = p.radius, run = Math.max(LEAST, p.walkSpeed * PROBE_SECONDS);
    const ground = hf.heightAt(x, z), knee = ground + KNEE * p.height, chest = ground + CHEST * p.height;
    const drawn = this.mind.look[e]!, facing = (ents.yaw[e]! / 65536) * Math.PI * 2;
    t.clear(3);
    this.perMetre = TICK_RATE / p.walkSpeed;
    this.looked = run;
    fan.gather(x, z, r + run, knee, chest);
    for (let i = 0; i < 3; i++) {
      const yaw = (this.yaw[i] = (drawn + (i - 1) * PROBE_TURN) & 0xffff), a = (yaw / 65536) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a), at = i * t.width;
      // The knee ray runs from one shoulder and the chest ray from the other, as wide as the body: most of what a
      // wanderer walks into, it meets off its middle.
      const ahead = r * FRONT, aside = r * SIDE;
      const low = fan.cast(x + dx * ahead + dz * aside, knee, z + dz * ahead - dx * aside, dx, dz, run);
      const high = fan.cast(x + dx * ahead - dz * aside, chest, z + dz * ahead + dx * aside, dx, dz, run);
      this.free[i] = low < high ? low : high;
      t.rows[at + c.run] = unit(low, run);
      t.rows[at + c.runHigh] = unit(high, run);
      t.rows[at + c.drawn] = i === 1 ? 1 : 0;
      t.rows[at + c.facing] = Math.cos(a - facing);
    }
    return choose("choice", t, ask(PROBE, t));
  }

  /** It turns to the heading chosen, and walks no further than it saw free: there it draws again. */
  private turn(e: number, tick: number, pick: number): void {
    this.mind.look[e] = this.yaw[pick]!;
    const free = this.free[pick]!;
    if (free < this.looked) this.mind.walkUntil(e, tick + Math.max(1, Math.floor(free * this.perMetre)));
  }
}
