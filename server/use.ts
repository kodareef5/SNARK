// What using an item does beyond what eating it gives (ItemDef.use): stats changed at once or over time, buffs given, and a
// vessel of water drunk from and filled. Nothing is stepped. What comes over time is a buff's rate, as a meal's health is
// (core:fed) and a dose's torpor is (core:drugged), so it is saved and ends at a deadline like any buff.
//
// The water skin is ARK's Waterskin (ark.wiki.gg/wiki/Waterskin, read 2026-11-15): it holds 100 water, is drunk from once
// before it must be filled again, is filled by using it "while standing in the rain or while standing in shallow water" and
// not while swimming, and is not used up. ARK keeps the water as the item's durability (its AddEquipmentDurability cheat
// adds water), so SNARK does too: the slot's `dur`, which is saved, sent and moved with the item, and which a vessel has
// free because it wears no other way. Rain and irrigation taps are not built, and the skin does not leak
// (planning/quality/deviations.md).

import type { ItemDef, UseFacet } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { RESULT_INVALID, RESULT_OK, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { MODE_SWIM, STAMINA_UNITS } from "../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../shared/sim/vitals.ts";
import type { Buffs } from "./buffs.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

/** The vital each stat a use may change at once is, or -1 for stamina, which is the body's. */
const VITAL: Readonly<Record<string, number>> = { health: V_HEALTH, food: V_FOOD, water: V_WATER, oxygen: V_OXYGEN, torpidity: V_TORPOR, stamina: -1 };
/** Water one drink from the sea or a lake gives: a tenth of a survivor's first 100. */
export const DRINK = 10;

export interface UseContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly buffs: Buffs;
}

export class Use {
  private readonly ctx: UseContext;
  /** The buffs that carry health and torpor given over time, or 0 in a pack without them. */
  private readonly mending: number;
  private readonly drugged: number;

  constructor(ctx: UseContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.mending = reg.index.get("core:mending") ?? 0;
    this.drugged = reg.index.get("core:drugged") ?? 0;
  }

  /** What `use` does to the body of `rec`, the one used having been burned. */
  apply(rec: EntityRecord, use: UseFacet): void {
    const { survival, buffs, world, records } = this.ctx;
    for (const a of use.adds ?? []) {
      const vital = VITAL[a.stat];
      if (vital === undefined) continue;
      if (a.seconds !== undefined && a.seconds > 0) {
        const carrier = vital === V_HEALTH ? this.mending : vital === V_TORPOR ? this.drugged : 0;
        if (carrier !== 0) {
          this.over(rec, carrier, vital === V_HEALTH, a.amount, a.seconds);
          continue;
        }
      }
      if (vital >= 0) survival.add(rec, vital, a.amount);
      else {
        const e = records.entOf.get(rec.pid);
        if (e === undefined) continue;
        const ents = world.ents;
        const next = ents.stamina[e]! + Math.round(a.amount * STAMINA_UNITS);
        const max = ents.staminaMax[e]! * STAMINA_UNITS;
        ents.stamina[e] = next < 0 ? 0 : next > max ? max : next;
      }
    }
    for (const id of use.buffs ?? []) {
      const buff = world.reg.index.get(id);
      if (buff !== undefined) buffs.give(rec, buff, 0);
    }
  }

  /**
   * `amount` of health or torpor over `seconds`, on the carrier's one instance. What it still had to give runs on, and the
   * new amount follows it: both are spread over the time left and the new seconds, as doses run one after another.
   */
  private over(rec: EntityRecord, carrier: number, health: boolean, amount: number, seconds: number): void {
    const now = this.ctx.world.tick;
    const on = rec.buffs.find((b) => b.buff === carrier);
    const left = on && on.until > now ? (on.until - now) / TICK_RATE : 0;
    const was = left > 0 ? (health ? on!.health : on!.torpor) * left : 0;
    const rate = (was + amount) / (left + seconds);
    // Each carrier carries one of the two, so the other is 0.
    this.ctx.buffs.give(rec, carrier, 0, left + seconds, health ? 0 : rate, health ? rate : 0);
  }

  /** True while the body of `rec` stands with its feet in water and is not swimming: ARK's shallow water. */
  inWater(rec: EntityRecord): boolean {
    const { world, records } = this.ctx;
    const e = records.entOf.get(rec.pid);
    if (e === undefined) return false;
    return world.ents.y[e]! < world.hf.waterAt(world.ents.x[e]!, world.ents.z[e]!) && world.ents.mode[e] !== MODE_SWIM;
  }

  /**
   * ARK's drink from water (patch 187.0): E with nothing else to use, standing or swimming in water, the sea or a lake, is a
   * drink of DRINK water (DEV162). False out of water, where E does nothing.
   */
  drink(c: Client): boolean {
    const { world, records, survival } = this.ctx;
    const rec = records.byPid.get(c.pid);
    const e = rec ? records.entOf.get(rec.pid) : undefined;
    if (!rec || e === undefined || !(world.ents.y[e]! < world.hf.waterAt(world.ents.x[e]!, world.ents.z[e]!))) return false;
    survival.add(rec, V_WATER, DRINK);
    return true;
  }

  /**
   * Using a vessel: in shallow water it is filled, if it is not full; otherwise one drink is taken from it, `each` or what is
   * left. It is kept either way. An empty vessel out of water is refused, and the survivor told.
   */
  vessel(c: Client, rec: EntityRecord, slot: number, def: ItemDef): number {
    const holds = def.use!.holds!;
    const { items, survival, game } = this.ctx;
    const held = items.inv(rec).dur[slot]!;
    if (held < holds.water && this.inWater(rec)) {
      items.setDur(rec, slot, holds.water);
      return RESULT_OK;
    }
    if (held <= 0) {
      game.sendText(c, TEXT_NOTICE, `The ${def.label ?? "vessel"} is empty. Use it standing in water to fill it.`);
      return RESULT_INVALID;
    }
    const drunk = held < holds.each ? held : holds.each;
    items.setDur(rec, slot, held - drunk);
    survival.add(rec, V_WATER, drunk);
    return RESULT_OK;
  }
}
