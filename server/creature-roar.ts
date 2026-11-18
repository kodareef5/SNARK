// Wildcard's TLC1 Rex roar briefly interrupts smaller non-allies at or below the Rex's level,
// with a separate grace period for victims. Here it acts on visible, grounded wild creatures.
import { CUE_ROAR, CUE_STARTLE } from "../shared/anim/pose.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { MF_OUT, MODE_WALK } from "../shared/sim/character.ts";
import { F_ALIVE, F_AWAKE, F_GROUNDED, F_HELD, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { ACT_NONE } from "../shared/sim/weapon.ts";
import { castWorld, HIT_NONE } from "../shared/world/ray.ts";
import type { Creatures } from "./creatures.ts";
import type { Feces } from "./feces.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

const READY = F_ALIVE | F_AWAKE | F_GROUNDED;

interface RoarContext {
  world: ServerWorld;
  records: Records;
  creatures: Creatures;
  feces: Feces;
}

export class MountedRoars {
  private readonly ctx: RoarContext;
  private readonly next = new WeakMap<EntityRecord, number>();
  private readonly immune = new WeakMap<EntityRecord, number>();

  constructor(ctx: RoarContext) {
    this.ctx = ctx;
  }

  use(e: number): void {
    const { world, records, creatures, feces } = this.ctx;
    const { ents, reg, tick } = world, kind = ents.kind[e]!, def = reg.defs[kind];
    if (def?.type !== "species" || !def.roar || ents.driven[e] === 0 || ents.act[e] !== ACT_NONE || !this.ready(e)) return;
    const rex = records.byPid.get(ents.pid[e]!);
    if (!rex || rex.dead || rex.out || tick < (this.next.get(rex) ?? 0)) return;
    const ability = def.roar;
    this.next.set(rex, tick + Math.ceil(ability.cooldown * TICK_RATE));
    creatures.cue(e, CUE_ROAR, false);

    const x = ents.x[e]!, y = ents.y[e]! + def.eyeHeight, z = ents.z[e]!;
    for (let i = 0; i < creatures.awakeCount; i++) {
      const target = creatures.awake[i]!, targetKind = ents.kind[target]!, drag = reg.drag[targetKind]!;
      // Unclaimed hatchlings have team zero too, and the wild AI leaves them alone.
      if (ents.team[target] !== 0 || ents.grown[target] !== 0 || ents.driven[target] !== 0 || !this.ready(target) ||
        !(drag > 0 && drag < ability.maxDrag) || ents.level[target]! > ents.level[e]!) continue;
      const victim = records.byPid.get(ents.pid[target]!);
      if (!victim?.genome || victim.dead || victim.out || tick < (this.immune.get(victim) ?? 0)) continue;
      const dx = ents.x[target]! - x, dz = ents.z[target]! - z, dy = ents.y[target]! + reg.bodyHeight[targetKind]! * .5 - y;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > ability.range) continue;
      if (distance > .001 && castWorld(world, x, y, z, dx / distance, dy / distance, dz / distance, distance) !== HIT_NONE) continue;
      this.immune.set(victim, tick + Math.ceil(ability.immunity * TICK_RATE));
      creatures.mind.stay(target, tick + Math.ceil(ability.interrupt * TICK_RATE));
      ents.act[target] = ACT_NONE;
      ents.actTicks[target] = 0;
      ents.pose(target, tick);
      creatures.cue(target, CUE_STARTLE, false);
      feces.go(victim, target, false);
    }
  }

  private ready(e: number): boolean {
    const ents = this.ctx.world.ents;
    return (ents.flags[e]! & (READY | F_HELD | F_PROP | F_PLAYER)) === READY && ents.mode[e] === MODE_WALK && !(ents.mflags[e]! & MF_OUT);
  }
}
