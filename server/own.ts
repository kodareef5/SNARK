// Owner-private state: what only the survivor's own client is told. Sent on
// the reliable channel when it changes, at most once per tick per component.
// Also the handlers for the slot commands, which are the only way a client
// can ask for its inventory to change.

import type { ItemDef, RecipeDef } from "../shared/content/defs.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_CLOSE, CMD_CRAFT, CMD_CREATE, CMD_DETACH, CMD_DROP, CMD_LEARN, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_RESPAWN, CMD_SELECT, CMD_SPEND, CMD_UNLOAD, CMD_USE, OWN_BUFFS, OWN_HELD, OWN_RULES, OWN_LOOK, OWN_MARKERS, OWN_OPEN, OWN_PROGRESSION, OWN_RESPAWN, OWN_SLOTS, OWN_TRIBE, OWN_VITALS, OWN_VOICE, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_SHORT, RESULT_STALE, SESSION_CREATING, SESSION_DEAD } from "../shared/net/protocol.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { TOKEN_BYTES } from "../shared/voice/packet.ts";
import { HOTBAR_SLOTS, type Inventory } from "../shared/sim/items.ts";
import { V_COUNT, V_FOOD, V_HEALTH, V_WATER } from "../shared/sim/vitals.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Progression } from "./progression.ts";
import type { Rules } from "./rules.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
import type { Voice } from "./voice.ts";
import type { ServerWorld } from "./world.ts";

/** Members of a tribe listed to a client; a larger tribe is told of its first this many. */
const MAX_MEMBERS_SENT = 100;

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
  readonly rules: Rules;
  readonly tribes: Tribes;
  readonly voice: Voice;
  /** Whether the survivor with this persistent id has a session here now. */
  online(pid: number): boolean;
  /** Recompute what follows from a record's stats, load and equipment. */
  refresh(rec: EntityRecord): void;
  /** Put `n` of what is in a slot on the ground by the body. False if that could not be done. */
  drop(rec: EntityRecord, slot: number, n: number): boolean;
}

/** Write the slots of `inv` that changed after version `since` (all the occupied ones if `full`). */
function sendSlots(ctx: OwnContext, c: Client, box: number, inv: Inventory, since: number, full: boolean): void {
  const w = ctx.game.beginOwn(OWN_SLOTS);
  // Sizes and slot numbers are varints: a vault holds more than a byte counts.
  w.bits(box, 1);
  w.varint(inv.cap);
  w.varint(inv.bag);
  w.bool(full);
  const at = w.pos;
  w.u16(0);
  let n = 0;
  for (let s = 0; s < inv.cap; s++) {
    if (full ? inv.item[s] === 0 : inv.mod[s]! <= since) continue;
    w.varint(s);
    w.u16(inv.item[s]!);
    if (inv.item[s] !== 0) {
      w.u16(inv.count[s]!);
      w.u8(inv.quality[s]!);
      w.u16(inv.dur[s]!);
      w.u32(inv.spoilAt[s]!);
      // What a weapon holds.
      const holds = inv.ammo[s] !== 0 || inv.attach[s] !== 0;
      w.bool(holds);
      if (holds) {
        w.u16(inv.ammo[s]!);
        w.u8(inv.loaded[s]!);
        w.u16(inv.attach[s]!);
      }
    }
    n++;
  }
  const end = w.pos;
  w.pos = at;
  w.u16(n); // written over the zero placeholder
  w.pos = end;
  ctx.game.endOwn(c);
}

/** Bring one client up to date with its survivor's vitals and inventory. */
export function syncOwn(ctx: OwnContext, c: Client): void {
  const rec = ctx.records.byPid.get(c.pid);
  if (!rec) return;
  const game = ctx.game;
  if (rec.look && c.sentLook !== rec.look) {
    const w = game.beginOwn(OWN_LOOK);
    for (let i = 0; i < LOOK_BYTES; i++) w.u8(rec.look[i]!);
    game.endOwn(c);
    c.sentLook = rec.look;
  }
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
    // What is carried changes how the body moves, and what it holds and wears is seen by others.
    if (c.ent >= 0) ctx.refresh(rec);
  }
  if (ctx.rules.version !== c.sentRules) {
    const w = game.beginOwn(OWN_RULES);
    w.u8((ctx.rules.values.damageNumbers !== 0 ? 1 : 0) | (ctx.rules.values.globalChat !== 0 ? 2 : 0));
    game.endOwn(c);
    c.sentRules = ctx.rules.version;
  }
  // What lets it open the voice socket: sent once to each connection.
  const token = ctx.voice.token(c);
  if (c.sentVoice !== token) {
    const w = game.beginOwn(OWN_VOICE);
    w.u16(c.id);
    for (let i = 0; i < TOKEN_BYTES; i++) w.u8(token[i]!);
    w.u8(1);
    game.endOwn(c);
    c.sentVoice = token;
  }
  // Who it is with: sent whenever any tribe changes, someone comes or goes, or an invitation it was shown runs out.
  const tribes = ctx.tribes;
  if (tribes.version !== c.sentTribe || (c.inviteUntil !== 0 && ctx.world.tick >= c.inviteUntil)) {
    const invite = tribes.inviteOf(rec);
    const tribe = tribes.of(rec);
    const w = game.beginOwn(OWN_TRIBE);
    w.varint(rec.team);
    w.string(tribe ? tribe.name : "");
    if (tribe) {
      w.u8(rec.rank);
      const n = Math.min(tribe.members.length, MAX_MEMBERS_SENT);
      w.u8(n);
      for (let i = 0; i < n; i++) {
        const pid = tribe.members[i]!;
        w.string(ctx.records.byPid.get(pid)?.name ?? "");
        w.bool(ctx.online(pid));
        w.bool(pid === tribe.owner);
      }
    }
    w.string(invite ? invite.tribe.name : "");
    if (invite) w.string(invite.by);
    game.endOwn(c);
    c.sentTribe = tribes.version;
    c.inviteUntil = invite ? invite.until : 0;
  }
  if (rec.buffsVersion !== c.sentBuffs) {
    const w = game.beginOwn(OWN_BUFFS);
    w.u8(rec.buffs.length);
    for (const b of rec.buffs) {
      w.u16(b.buff);
      w.u32(b.until);
    }
    game.endOwn(c);
    c.sentBuffs = rec.buffsVersion;
  }
  if (rec.held !== c.sentHeld) {
    const w = game.beginOwn(OWN_HELD);
    w.u8(rec.held < 0 ? 255 : rec.held);
    game.endOwn(c);
    c.sentHeld = rec.held;
  }

  // The container it has open: announced when it changes, then kept up to date like its own.
  const open = ctx.openOf(c);
  const openPid = open ? open.pid : 0;
  if (openPid !== c.sentOpen) {
    const w = game.beginOwn(OWN_OPEN);
    w.bool(open !== null);
    if (open) {
      w.varint(ctx.items.inv(open).cap);
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
    const fromSlot = r.varint();
    const toBox = r.bits(1);
    const toSlot = r.varint();
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

  ctx.game.handle(CMD_CREATE, (c: Client, r: BitReader) => {
    const look = new Uint8Array(LOOK_BYTES);
    for (let i = 0; i < LOOK_BYTES; i++) look[i] = r.u8();
    if (r.overflow || !validLook(look)) return RESULT_INVALID;
    if (c.state !== SESSION_CREATING) return RESULT_DENIED;
    return ctx.game.create(c, look) ? RESULT_OK : RESULT_FULL;
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

  const reg = ctx.world.reg;
  const itemDef = (kind: number): ItemDef | null => {
    const d = reg.defs[kind];
    return d?.type === "item" ? d : null;
  };
  /** The session's own inventory, for a command that names a slot of it; null without a body. */
  const bagOf = (c: Client): { rec: EntityRecord; inv: Inventory } | null => {
    const rec = mine(c);
    return rec ? { rec, inv: ctx.items.inv(rec) } : null;
  };

  ctx.game.handle(CMD_SELECT, (c: Client, r: BitReader) => {
    const slot = r.u8();
    const own = bagOf(c);
    if (r.overflow || (slot !== 255 && slot >= HOTBAR_SLOTS)) return RESULT_INVALID;
    if (!own || own.inv.hotbar < 0) return RESULT_DENIED;
    // An empty slot is nothing to hold.
    own.rec.held = slot !== 255 && own.inv.item[own.inv.hotbar + slot] !== 0 ? slot : -1;
    ctx.records.dirty.add(own.rec.pid);
    ctx.refresh(own.rec);
    return RESULT_OK;
  });

  ctx.game.handle(CMD_LOAD, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const ammo = r.u16();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    const { rec, inv } = own;
    const weapon = slot < inv.cap ? itemDef(inv.item[slot]!)?.weapon : undefined;
    if (!weapon?.ammo || !weapon.ammo.includes(reg.ids[ammo] ?? "")) return RESULT_INVALID;
    if (inv.ammo[slot] === ammo) return RESULT_OK;
    // Rounds of the other kind come out first; the new kind goes in when the weapon is reloaded.
    if (!ctx.items.unload(rec, slot)) return RESULT_FULL;
    inv.setGear(slot, ammo, 0, inv.attach[slot]!);
    ctx.records.dirty.add(rec.pid);
    return RESULT_OK;
  });

  ctx.game.handle(CMD_ATTACH, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const from = r.varint();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    const { rec, inv } = own;
    if (slot >= inv.cap || from >= inv.cap) return RESULT_INVALID;
    const weapon = itemDef(inv.item[slot]!)?.weapon;
    if (!weapon?.fits || !weapon.fits.includes(reg.ids[inv.item[from]!] ?? "")) return RESULT_INVALID;
    return ctx.items.attach(rec, slot, from) ? RESULT_OK : RESULT_INVALID;
  });

  ctx.game.handle(CMD_DETACH, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    if (slot >= own.inv.cap || own.inv.attach[slot] === 0) return RESULT_INVALID;
    return ctx.items.detach(own.rec, slot) ? RESULT_OK : RESULT_FULL;
  });

  ctx.game.handle(CMD_UNLOAD, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    if (slot >= own.inv.cap || own.inv.loaded[slot] === 0) return RESULT_INVALID;
    return ctx.items.unload(own.rec, slot) ? RESULT_OK : RESULT_FULL;
  });

  ctx.game.handle(CMD_REPAIR, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    const { rec, inv } = own;
    if (slot >= inv.cap || inv.item[slot] === 0) return RESULT_INVALID;
    const item = inv.item[slot]!;
    const max = ctx.items.maxDur(item, inv.quality[slot]!);
    const recipe = reg.defs.find((d): d is RecipeDef => d?.type === "recipe" && d.makes === reg.ids[item]);
    if (max === 0 || !recipe || inv.dur[slot]! >= max) return RESULT_INVALID;
    // Half of what it is made of, in proportion to how worn it is, and never nothing.
    const worn = 1 - inv.dur[slot]! / max;
    const cost = recipe.needs.map((n) => ({ item: reg.index.get(n.item)!, count: Math.max(1, Math.ceil(n.count * 0.5 * worn)) }));
    for (const n of cost) if (inv.total(n.item) < n.count) return RESULT_SHORT;
    for (const n of cost) if (!ctx.items.burnItem(rec, n.item, n.count)) throw new Error("the ingredients were counted");
    ctx.items.mend(rec, slot);
    return RESULT_OK;
  });

  ctx.game.handle(CMD_DROP, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const count = r.u16();
    const expect = r.u16();
    const own = bagOf(c);
    if (r.overflow) return RESULT_INVALID;
    if (!own) return RESULT_DENIED;
    if (slot >= own.inv.cap) return RESULT_INVALID;
    if (own.inv.item[slot] !== expect || expect === 0) return RESULT_STALE;
    return ctx.drop(own.rec, slot, count) ? RESULT_OK : RESULT_FULL;
  });

  ctx.game.handle(CMD_USE, (c: Client, r: BitReader) => {
    const slot = r.varint();
    const expect = r.u16();
    if (r.overflow) return RESULT_INVALID;
    const rec = ctx.records.byPid.get(c.pid);
    if (!rec || c.ent < 0) return RESULT_DENIED;
    const inv = ctx.items.inv(rec);
    if (slot >= inv.cap) return RESULT_INVALID;
    const item = inv.item[slot]!;
    if (item !== expect || item === 0) return RESULT_STALE;
    // Something worn: using it puts it on, or takes it off again.
    const worn = reg.wearSlot[item]!;
    if (worn >= 0 && inv.armor >= 0) {
      const to = slot >= inv.armor ? inv.free() : inv.armor + worn;
      if (to < 0) return RESULT_FULL;
      return ctx.items.move(rec, slot, rec, to, 0) > 0 ? RESULT_OK : RESULT_INVALID;
    }
    const eat = (ctx.world.reg.defs[item] as ItemDef).eat;
    if (!eat) return RESULT_INVALID;
    if (!ctx.items.burn(rec, slot, 1)) return RESULT_STALE;
    if (eat.food) ctx.survival.add(rec, V_FOOD, eat.food);
    if (eat.water) ctx.survival.add(rec, V_WATER, eat.water);
    if (eat.health) ctx.survival.add(rec, V_HEALTH, eat.health);
    return RESULT_OK;
  });
}
