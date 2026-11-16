// Smoke and gas where a grenade with a cloud went off (planning/reference/weapons-plan.md, M7). A cloud is a prop entity
// of class prop/cloud, kept here on its own list as Projectiles keeps what is thrown, and never saved: it lasts its
// grenade's seconds, which are under a minute. Every half second it looks at the survivors inside it and gives each its
// buff for a little longer than that, so a body that walks out stops taking it soon after. A cloud with no buff (smoke)
// only hides, which is the client's (client/core/render/clouds.ts): it hides nothing from creatures, as ARK's does not
// (Smoke Grenade), so their sight is not touched. ARK's gases act on humans alone ("creatures are completely immune",
// Poison Grenade), so a cloud's buff goes to survivors only.
//
// Its reach and height are its prop's radius and height. The registry gives a cloud no body (bodyRadius 0), so nothing
// aims at it, opens it or meets it; this reads them from its definition.

import type { PropDef } from "../shared/content/defs.ts";
import { CHUNK_SIZE, TICK_RATE } from "../shared/coords.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import type { Buffs } from "./buffs.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** Ticks between a cloud's looks at the bodies inside it: half a second (D433). */
export const CLOUD_EVERY = TICK_RATE / 2;
/** Seconds the buff a look gives lasts: the half second to the next look and a fifth of a second more. */
export const CLOUD_HOLD = (CLOUD_EVERY + 6) / TICK_RATE;
/** One more than this and the oldest ends. */
export const MAX_CLOUDS = 256;
/** Metres under where it went off that a cloud still reaches: a grenade lies a little above the ground, and bodies stand on slopes. */
const BELOW = 0.5;

export interface CloudsContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly buffs: Buffs;
  readonly rules: Rules;
}

interface Cloud {
  ent: number;
  gen: number;
  /** Content index of its buff, 0 for none. */
  buff: number;
  /** The thrower's pid and team, as they were when it went off. */
  by: number;
  team: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  /** The tick it ends, and the tick of its next look. */
  until: number;
  next: number;
}

export class Clouds {
  /** Counters for tests and measurement: clouds made, looks at who is inside one, and buffs given. */
  made = 0;
  looked = 0;
  gave = 0;

  private readonly ctx: CloudsContext;
  private readonly list: Cloud[] = [];
  private readonly survivor: number;

  constructor(ctx: CloudsContext) {
    this.ctx = ctx;
    this.survivor = ctx.world.reg.index.get("core:survivor") ?? 0;
  }

  get count(): number {
    return this.list.length;
  }

  /** For tests: the entity index of cloud `i`, oldest first. */
  entityOf(i: number): number {
    return this.list[i]!.ent;
  }

  /**
   * Grenade `item`, thrown by pid `by`, went off at (x, y, z): its cloud stands there from now for its seconds. The entity
   * carries them as a young thing does its growing (`span` its ticks and `grown` its end), so a client knows how old it is.
   */
  make(item: number, x: number, y: number, z: number, by: number): void {
    const { world, records } = this.ctx;
    const reg = world.reg;
    const prop = reg.cloudProp[item]!;
    const ticks = reg.cloudTicks[item]!;
    const def = reg.defs[prop];
    if (prop === 0 || ticks === 0 || def?.type !== "prop") return;
    const ents = world.ents;
    const ent = ents.create(prop, x, y, z, F_PROP);
    if (ent < 0) return;
    const until = world.tick + ticks;
    ents.setYoung(ent, ticks, until);
    if (this.list.length >= MAX_CLOUDS) this.end(this.list.shift()!);
    const d = def as PropDef;
    this.list.push({ ent, gen: ents.gen[ent]!, buff: reg.cloudBuff[item]!, by, team: records.byPid.get(by)?.team ?? 0, x, y, z, radius: d.radius, height: d.height, until, next: world.tick });
    this.made++;
  }

  /** Each tick: clouds whose time is up end, and those due look at who is inside them. */
  step(): void {
    const list = this.list;
    if (list.length === 0) return;
    const tick = this.ctx.world.tick;
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      if (tick >= c.until || !this.stands(c)) {
        this.end(c);
        continue;
      }
      if (c.buff !== 0 && tick >= c.next) {
        c.next = tick + CLOUD_EVERY;
        this.look(c);
      }
      list[kept++] = c;
    }
    list.length = kept;
  }

  /** Gives `c`'s buff to every survivor inside it that the rules do not spare. */
  private look(c: Cloud): void {
    this.looked++;
    const { world, records, buffs, rules } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    // On a PvE server a gas spares other tribes: it acts on its thrower and the thrower's tribe (Poison Grenade, 228.2).
    const pve = c.team !== 0 && rules.on("serverPVE");
    const reach = c.radius + 1;
    const x0 = Math.max(0, Math.floor((c.x - reach) / CHUNK_SIZE));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((c.x + reach) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((c.z - reach) / CHUNK_SIZE));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((c.z + reach) / CHUNK_SIZE));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if ((ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE || ents.kind[i] !== this.survivor) continue;
          const dx = ents.x[i]! - c.x;
          const dz = ents.z[i]! - c.z;
          const r = c.radius + reg.bodyRadius[this.survivor]!;
          if (dx * dx + dz * dz > r * r) continue;
          // Some of the body is between the cloud's floor and its top.
          const y = ents.y[i]!;
          if (y > c.y + c.height || y + reg.bodyHeight[this.survivor]! < c.y - BELOW) continue;
          const rec = records.byPid.get(ents.pid[i]!);
          if (!rec || (pve && rec.team !== 0 && rec.team !== c.team && rec.pid !== c.by)) continue;
          if (buffs.give(rec, c.buff, c.by, CLOUD_HOLD)) this.gave++;
        }
      }
    }
  }

  private stands(c: Cloud): boolean {
    const ents = this.ctx.world.ents;
    return (ents.flags[c.ent]! & F_ALIVE) !== 0 && ents.gen[c.ent] === c.gen;
  }

  private end(c: Cloud): void {
    if (this.stands(c)) this.ctx.world.ents.destroy(c.ent);
  }
}
