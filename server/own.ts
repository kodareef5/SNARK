// Owner-private state: what only the survivor's own client is told. Sent on
// the reliable channel when it changes, at most once per tick per component.
// Also the handlers for the slot commands, which are the only way a client
// can ask for its inventory to change.

import type { ItemDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_RESPAWN, CMD_SPEND, CMD_USE, OWN_MARKERS, OWN_PROGRESSION, OWN_OPEN, OWN_RESPAWN, OWN_SLOTS, OWN_VITALS, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_STALE, SESSION_DEAD } from "../shared/net/protocol.ts";
import type { Inventory } from "../shared/sim/items.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_WATER } from "../shared/sim/vitals.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Progression } from "./progression.ts";
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
  closeOpen(c: Client): void;
  respawn(c: Client, index: number): number;
  readonly progression: Progression;
}

/** Write the slots of `inv` that changed after version `since` (all the occupied ones if `full`). */
function sendSlots(ctx: OwnContext, c: Client, box: number, inv: Inventory, since: number, full: boolean): void {
  const w = ctx.game.beginOwn(OWN_SLOTS);
  w.bits(box, 1);
  w.u8(inv.cap);
  w.bool(full);
  const at = w.pos;
  w.u8(0);
  let n = 0;
  for (let s = 0; s < inv.cap; s++) {
    if (full ? inv.item[s] === 0 : inv.mod[s]! <= since) continue;
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
  ctx.game.endOwn(c);
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
    sendSlots(ctx, c, BOX_SELF, inv, c.sentInv, c.sentInv < 0);
    c.sentInv = inv.version;
    // What is carried changes how the body moves.
    if (c.ent >= 0) refreshMods(ctx.world.reg, ctx.world.ents, c.ent, rec.genome, inv.weight(ctx.items.table));
  }

  // The container it has open: announced when it changes, then kept up to date like its own.
  const open = ctx.openOf(c);
  const openPid = open ? open.pid : 0;
  if (openPid !== c.sentOpen) {
    const w = game.beginOwn(OWN_OPEN);
    w.bool(open !== null);
    if (open) {
      w.u8(ctx.items.inv(open).cap);
      w.string(open.name);
    }
    game.endOwn(c);
    c.sentOpen = openPid;
    c.sentOpenVersion = -1;
  }
  if (open) {
    const box = ctx.items.inv(open);
    if (box.version !== c.sentOpenVersion) {
      sendSlots(ctx, c, BOX_OPEN, box, c.sentOpenVersion, c.sentOpenVersion < 0);
      c.sentOpenVersion = box.version;
    }
  }

  if (rec.markersVersion !== c.sentMarkers) {
    const w = game.beginOwn(OWN_MARKERS);
    w.u8(rec.markers.length);
    for (const m of rec.markers) {
      w.u8(m.kind);
      w.f32(m.x);
      w.f32(m.y);
      w.f32(m.z);
      w.u32(m.tick);
    }
    game.endOwn(c);
    c.sentMarkers = rec.markersVersion;
  }

  if (rec.progVersion !== c.sentProgress) {
    const prog = ctx.progression;
    const w = game.beginOwn(OWN_PROGRESSION);
    w.u32(Math.floor(rec.xp));
    w.u16(prog.levelOf(rec.xp));
    w.u16(prog.statPoints(rec));
    w.u16(prog.engramPoints(rec));
    w.u8(rec.engrams.length);
    for (const e of rec.engrams) w.u16(e);
    w.u8(rec.jobs.length);
    for (const j of rec.jobs) {
      w.u16(j.recipe);
      w.u8(j.left > 255 ? 255 : j.left);
      w.u32(j.doneAt);
    }
    game.endOwn(c);
    c.sentProgress = rec.progVersion;
  }

  // Dead: told once where it may return.
  if (c.state === SESSION_DEAD && !c.sentRespawn) {
    const w = game.beginOwn(OWN_RESPAWN);
    const spawns = ctx.world.spawns;
    w.u8(spawns.length);
    for (const p of spawns) {
      w.string(p.name);
      w.f32(p.x);
      w.f32(p.z);
    }
    game.endOwn(c);
    c.sentRespawn = true;
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

  ctx.game.handle(CMD_CLOSE, (c: Client) => {
    ctx.closeOpen(c);
    return RESULT_OK;
  });

  ctx.game.handle(CMD_RESPAWN, (c: Client, r: BitReader) => {
    const index = r.u8();
    return r.overflow ? RESULT_INVALID : ctx.respawn(c, index);
  });

  const mine = (c: Client): EntityRecord | null => (c.ent >= 0 ? (ctx.records.byPid.get(c.pid) ?? null) : null);
  ctx.game.handle(CMD_SPEND, (c: Client, r: BitReader) => {
    const stat = r.u8();
    const rec = mine(c);
    return r.overflow ? RESULT_INVALID : rec ? ctx.progression.spend(rec, stat) : RESULT_DENIED;
  });
  ctx.game.handle(CMD_LEARN, (c: Client, r: BitReader) => {
    const engram = r.u16();
    const rec = mine(c);
    return r.overflow ? RESULT_INVALID : rec ? ctx.progression.learn(rec, engram) : RESULT_DENIED;
  });
  ctx.game.handle(CMD_CRAFT, (c: Client, r: BitReader) => {
    const recipe = r.u16();
    const count = r.u8();
    const rec = mine(c);
    return r.overflow ? RESULT_INVALID : rec ? ctx.progression.craft(rec, recipe, count) : RESULT_DENIED;
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
