// Owner-private state: what only the survivor's own client is told. Sent on
// the reliable channel when it changes, at most once per tick per component.
// Also the handlers for the slot commands, which are the only way a client
// can ask for its inventory to change.

import type { ItemDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_USE, OWN_SLOTS, OWN_VITALS, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_STALE } from "../shared/net/protocol.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_WATER } from "../shared/sim/vitals.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import { refreshMods, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

export interface OwnContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  /** The record of the container a session has open, or null. */
  openOf(c: Client): EntityRecord | null;
}

/** Bring one client up to date with its survivor's vitals and inventory. */
export function syncOwn(ctx: OwnContext, c: Client): void {
  const rec = ctx.records.byPid.get(c.pid);
  if (!rec) return;
  const game = ctx.game;
  const v = rec.vitals;
  if (v && v.version !== c.sentVitals) {
    const w = game.beginOwn(OWN_VITALS);
    w.u32(v.tick);
    for (let i = 0; i < V_COUNT; i++) {
      w.uint53(v.value[i]!);
      w.svarint(v.rate[i]!);
      w.uint53(v.max[i]!);
    }
    game.endOwn(c);
    c.sentVitals = v.version;
  }
  const inv = ctx.items.inv(rec);
  if (inv.version !== c.sentInv) {
    const full = c.sentInv < 0;
    const w = game.beginOwn(OWN_SLOTS);
    w.bits(BOX_SELF, 1);
    w.u8(inv.cap);
    w.bool(full);
    const at = w.pos;
    w.u8(0);
    let n = 0;
    for (let s = 0; s < inv.cap; s++) {
      if (full ? inv.item[s] === 0 : inv.mod[s]! <= c.sentInv) continue;
      w.u8(s);
      w.u16(inv.item[s]!);
      if (inv.item[s] !== 0) {
        w.u16(inv.count[s]!);
        w.u8(inv.quality[s]!);
        w.u16(inv.dur[s]!);
        w.u32(inv.spoilAt[s]!);
      }
      n++;
    }
    const end = w.pos;
    w.pos = at;
    w.u8(n); // written over the zero placeholder
    w.pos = end;
    game.endOwn(c);
    c.sentInv = inv.version;
    // What is carried changes how the body moves.
    if (c.ent >= 0) refreshMods(ctx.world.reg, ctx.world.ents, c.ent, rec.genome, inv.weight(ctx.items.table));
  }
}

function box(ctx: OwnContext, c: Client, which: number): EntityRecord | null {
  if (which === BOX_OPEN) return ctx.openOf(c);
  return ctx.records.byPid.get(c.pid) ?? null;
}

export function addOwnCommands(ctx: OwnContext): void {
  ctx.game.handle(CMD_MOVE, (c: Client, r: BitReader) => {
    const fromBox = r.bits(1);
    const fromSlot = r.u8();
    const toBox = r.bits(1);
    const toSlot = r.u8();
    const count = r.u16();
    const expect = r.u16();
    if (r.overflow) return RESULT_INVALID;
    if (c.ent < 0) return RESULT_DENIED;
    const a = box(ctx, c, fromBox);
    const b = box(ctx, c, toBox);
    if (!a || !b) return RESULT_DENIED;
    const src = ctx.items.inv(a);
    if (fromSlot >= src.cap || toSlot >= ctx.items.inv(b).cap) return RESULT_INVALID;
    if (src.item[fromSlot] !== expect || expect === 0) return RESULT_STALE;
    return ctx.items.move(a, fromSlot, b, toSlot, count) > 0 ? RESULT_OK : RESULT_INVALID;
  });

  ctx.game.handle(CMD_USE, (c: Client, r: BitReader) => {
    const slot = r.u8();
    const expect = r.u16();
    if (r.overflow) return RESULT_INVALID;
    const rec = ctx.records.byPid.get(c.pid);
    if (!rec || c.ent < 0) return RESULT_DENIED;
    const inv = ctx.items.inv(rec);
    if (slot >= inv.cap) return RESULT_INVALID;
    const item = inv.item[slot]!;
    if (item !== expect || item === 0) return RESULT_STALE;
    const eat = (ctx.world.reg.defs[item] as ItemDef).eat;
    if (!eat) return RESULT_INVALID;
    if (!ctx.items.burn(rec, slot, 1)) return RESULT_STALE;
    if (eat.food) ctx.survival.add(rec, V_FOOD, eat.food);
    if (eat.water) ctx.survival.add(rec, V_WATER, eat.water);
    if (eat.health) ctx.survival.add(rec, V_HEALTH, eat.health);
    return RESULT_OK;
  });
}
