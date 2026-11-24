// Owner-private state, sent only to the survivor's own client on the reliable channel when it changes, at most once per tick
// per component. Also the slot command handlers, the only way a client can ask for its inventory to change.

import type { ItemDef } from "../shared/content/defs.ts";
import { fitBytes, type BitReader } from "../shared/net/codec.ts";
import { TEXT_NOTICE, MAX_OPEN_NAME_BYTES, OPEN_TAKE_ONLY, OWN_KEPT, BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_CLOSE, CMD_CRAFT, CMD_CRAFT_AT, CMD_CRAFT_BLUEPRINT, CMD_CREATE, CMD_DETACH, CMD_DROP, CMD_LEARN, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_RESPAWN, CMD_SELECT, CMD_SPEND, CMD_UNLOAD, CMD_USE, OWN_BUFFS, OWN_HELD, OWN_RULES, RULE_CORPSE_LOCATOR, RULE_CREATIVE, RULE_SURVIVORS_PASS, RULE_CROSSHAIR, RULE_DAMAGE_NUMBERS, RULE_GLOBAL_CHAT, RULE_HIT_MARKERS, RULE_MAP_LOCATION, RULE_THIRD_PERSON, OWN_LOOK, OWN_MARKERS, OWN_OPEN, OWN_PROGRESSION, OWN_RESPAWN, OWN_SLOTS, OWN_SUBJECT, OWN_VITALS, OWN_VOICE, OWN_XP, MAX_PLACE_NAME_BYTES, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_SHORT, RESULT_STALE, SESSION_CREATING, SESSION_DEAD } from "../shared/net/protocol.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { TOKEN_BYTES } from "../shared/voice/packet.ts";
import { ORB_GAIN_UNITS, orbOnly } from "../shared/world/orb.ts";
import { FLAG_BLUEPRINT, HOTBAR_SLOTS, type Inventory } from "../shared/sim/items.ts";
import { V_COUNT, V_FOOD, V_WATER } from "../shared/sim/vitals.ts";
import { sendKept } from "./balls.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Progression } from "./progression.ts";
import type { Rules } from "./settings/rules.ts";
import type { Survival } from "./survival.ts";
import type { Subject } from "./taming.ts";
import type { Use } from "./use.ts";
import type { Voice } from "./voice.ts";
import type { Beds } from "./beds.ts";
import type { ServerWorld } from "./world.ts";
import { event } from "./events/bus.ts";

const SESSION_CREATE = event("session.create");
const ITEM_MOVE = event("item.move");
const ITEM_USE = event("item.use");
const ITEM_DROP = event("item.drop");

/** Asks modules about something a session is about to do with an item. A session refused is told why. */
function asked(ctx: OwnContext, c: Client, ev: number, data: Record<string, number | string>): boolean {
  const refused = ctx.game.bus.before(ev, data);
  if (refused !== "") ctx.game.sendText(c, TEXT_NOTICE, refused);
  return refused === "";
}

/** What a survivor is told when it would put something into a supply drop's capsule. */
export const TAKE_ONLY = "A supply drop is only taken from: nothing can be put into it.";

export interface OwnContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  openOf(c: Client): EntityRecord | null;
  closeOpen(c: Client): void;
  /** Where a survivor without a body may rise, and its choosing (server/beds.ts). */
  readonly beds: Beds;
  /** Null if `rec` is not a creature. */
  subject(rec: EntityRecord): Subject | null;
  readonly progression: Progression;
  readonly rules: Rules;
  readonly voice: Voice;
  /** See `Host.refreshBody`. */
  refresh(rec: EntityRecord): void;
  /** Food gives `points` of health. */
  mend(rec: EntityRecord, points: number): void;
  /** See `Taming.dose`. */
  dose(rec: EntityRecord, item: number, by: number): void;
  /** The item in this survivor's hands was replaced by a move, perhaps by another of its kind. It takes a moment to be ready, as a change of hotbar slot does. */
  rearm(rec: EntityRecord): void;
  /** See `Death.drop`. */
  drop(rec: EntityRecord, slot: number, n: number): boolean;
  /** What using an item does beyond eating it (server/use.ts). */
  readonly use: Use;
}

/** Sends the slots of `inv` changed after version `since`, or every occupied slot if `full`. */
function sendSlots(ctx: OwnContext, c: Client, box: number, inv: Inventory, since: number, full: boolean): void {
  const w = ctx.game.beginOwn(OWN_SLOTS);
  // Sizes and slot numbers are varints, because a vault has more than 255 slots.
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
      // Flags (SLOT_ bits): a blueprint, an attachment switched on.
      w.u8(inv.flags[s]!);
      w.u16(inv.dur[s]!);
      w.u32(inv.spoilAt[s]!);
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
  w.u16(n);
  w.pos = end;
  ctx.game.endOwn(c);
}

/** What a session was last told it has open: the box's record id (0 for none), the version of its slots (-1 for none sent), and whether it was told of a kept tame in it. */
interface OpenSent {
  pid: number;
  version: number;
  kept: boolean;
}

/** What a session was last sent of the creature it has open, packed into one number (-1 for none), and when. */
interface SubjectSent {
  sum: number;
  at: number;
}

/**
 * Registers the kinds of owner state that no system registers for itself. The tribe's is registered by server/tribes.ts and
 * the open station's by server/stations.ts.
 */
export function addOwnState(ctx: OwnContext): void {
  const game = ctx.game;
  const own = game.own;
  own.add({
    kind: OWN_LOOK,
    version: (_c, rec) => rec.look ?? undefined,
    write(w, _c, rec) {
      for (let i = 0; i < LOOK_BYTES; i++) w.u8(rec.look![i]!);
    },
  });
  own.add({
    kind: OWN_VITALS,
    version: (_c, rec) => rec.vitals?.version,
    write(w, _c, rec) {
      const v = rec.vitals!;
      w.u32(v.tick);
      for (let i = 0; i < V_COUNT; i++) {
        w.uint53(v.value[i]!);
        w.svarint(v.rate[i]!);
        w.uint53(v.max[i]!);
      }
    },
  });
  // The survivor's own inventory: the slots that changed, then the tames its soul balls keep.
  own.group(OWN_SLOTS, (c, rec) => {
    const inv = ctx.items.inv(rec);
    const sent = (c.sent[OWN_SLOTS] as number | undefined) ?? -1;
    if (inv.version === sent) return;
    sendSlots(ctx, c, BOX_SELF, inv, sent, sent < 0);
    c.sent[OWN_SLOTS] = inv.version;
    c.sent[OWN_KEPT] = sendKept(game, ctx.records, c, BOX_SELF, inv, c.sent[OWN_KEPT] === true);
    // The load changes how the body moves, and others see its gear.
    if (c.ent >= 0) ctx.refresh(rec);
  });
  own.add({
    kind: OWN_RULES,
    version: () => ctx.rules.version,
    write(w) {
      const rules = ctx.rules;
      w.u16(
        (rules.on("ShowFloatingDamageText") ? RULE_DAMAGE_NUMBERS : 0) |
          (rules.on("ProximityChat") ? 0 : RULE_GLOBAL_CHAT) |
          (rules.on("AllowHitMarkers") ? RULE_HIT_MARKERS : 0) |
          (rules.on("AllowThirdPersonPlayer") ? RULE_THIRD_PERSON : 0) |
          (rules.on("ServerCrosshair") ? RULE_CROSSHAIR : 0) |
          (rules.on("ShowMapPlayerLocation") ? RULE_MAP_LOCATION : 0) |
          (rules.on("bUseCorpseLocator") ? RULE_CORPSE_LOCATOR : 0) |
          (rules.on("bShowCreativeMode") ? RULE_CREATIVE : 0) |
          (rules.on("SurvivorsBlock") ? 0 : RULE_SURVIVORS_PASS),
      );
      w.u8(orbOnly(rules.text("OrbScene")) + 1);
      w.u8(Math.round(Math.min(4, Math.max(0, rules.num("OrbBrightness"))) * ORB_GAIN_UNITS));
    },
  });
  // The voice token is sent once to each connection.
  own.add({
    kind: OWN_VOICE,
    version: (c) => ctx.voice.token(c),
    write(w, c) {
      const token = ctx.voice.token(c);
      w.u16(c.id);
      for (let i = 0; i < TOKEN_BYTES; i++) w.u8(token[i]!);
      w.u8(1);
    },
  });
  own.add({
    kind: OWN_BUFFS,
    version: (_c, rec) => rec.buffsVersion,
    write(w, _c, rec) {
      w.u8(rec.buffs.length);
      for (const b of rec.buffs) {
        w.u16(b.buff);
        w.u32(b.until);
      }
    },
  });
  own.add({
    kind: OWN_HELD,
    version: (_c, rec) => rec.held,
    write: (w, _c, rec) => void w.u8(rec.held < 0 ? 255 : rec.held),
  });

  // The open container is announced when it changes, then synced like the survivor's own inventory. What is sent of a
  // creature that is open, and of the tames an open box's soul balls keep, goes with it.
  own.group(OWN_OPEN, (c) => {
    const sent = (c.sent[OWN_OPEN] ??= { pid: 0, version: -1, kept: false }) as OpenSent;
    const open = ctx.openOf(c);
    const openPid = open ? open.pid : 0;
    if (openPid !== sent.pid) {
      const w = game.beginOwn(OWN_OPEN);
      w.bool(open !== null);
      if (open) {
        w.varint(ctx.items.inv(open).cap);
        w.string(fitBytes(open.name, MAX_OPEN_NAME_BYTES));
        // Protocol 41: what kind of box it is (OPEN_ bits).
        w.u8(ctx.world.reg.takeOnly[open.kind] === 1 ? OPEN_TAKE_ONLY : 0);
      }
      game.endOwn(c);
      sent.pid = openPid;
      sent.version = -1;
    }
    // An open creature's state is sent at most every 6 ticks, and only when it changed.
    const told = (c.sent[OWN_SUBJECT] ??= { sum: -1, at: 0 }) as SubjectSent;
    const subject = open ? ctx.subject(open) : null;
    if (!subject) {
      if (told.sum !== -1) {
        game.beginOwn(OWN_SUBJECT).bool(false);
        game.endOwn(c);
        told.sum = -1;
      }
    } else if (ctx.world.tick - told.at >= 6) {
      const q = [subject.taming ? 1 : 0, subject.owned ? 1 : 0, subject.level, Math.round(subject.progress * 1000), Math.round(subject.te * 1000), Math.round(subject.torpor * 1000), Math.round(subject.food * 1000), subject.id, subject.points, subject.stance, (subject.following ? 1 : 0) | (subject.wandering ? 2 : 0), subject.saddled ? 1 : 0, (subject.breeds ? 1 : 0) | (subject.mating ? 2 : 0) | (subject.female ? 4 : 0) | (subject.stage << 3), Math.round(subject.maturity * 1000), Math.round(subject.mate * 1000), subject.wait];
      const sum = q.reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7) >>> 0;
      if (sum !== told.sum) {
        const w = game.beginOwn(OWN_SUBJECT);
        w.bool(true);
        w.bool(subject.taming);
        w.bool(subject.owned);
        w.u16(subject.level);
        w.bits(q[3]!, 10);
        w.bits(q[4]!, 10);
        w.bits(q[5]!, 10);
        w.bits(q[6]!, 10);
        w.u32(subject.id >>> 0);
        w.u8(subject.points);
        w.bits(subject.stance, 2);
        w.bool(subject.following);
        w.bool(subject.wandering);
        w.bool(subject.saddled);
        w.bool(subject.breeds);
        w.bool(subject.mating);
        w.bool(subject.female);
        w.bits(subject.stage, 2);
        w.bits(q[13]!, 10);
        w.bits(q[14]!, 10);
        w.varint(subject.wait);
        game.endOwn(c);
        told.sum = sum;
        told.at = ctx.world.tick;
      }
    }
    if (open) {
      const box = ctx.items.inv(open);
      if (box.version !== sent.version) {
        // A box newly opened was told nothing of yet, and the client forgot what the last one held.
        const fresh = sent.version < 0;
        sendSlots(ctx, c, BOX_OPEN, box, sent.version, fresh);
        sent.version = box.version;
        sent.kept = sendKept(game, ctx.records, c, BOX_OPEN, box, sent.kept && !fresh);
      }
    }
  });

  own.add({
    kind: OWN_MARKERS,
    version: (_c, rec) => rec.markersVersion,
    write(w, _c, rec) {
      w.u8(rec.markers.length);
      for (const m of rec.markers) {
        w.u8(m.kind);
        w.f32(m.x);
        w.f32(m.y);
        w.f32(m.z);
        w.u32(m.tick);
      }
    },
  });
  own.add({
    kind: OWN_XP,
    version: (_c, rec) => rec.xpVersion,
    write(w, _c, rec) {
      const prog = ctx.progression;
      w.f64(rec.xp);
      w.u16(prog.level(rec));
      w.u16(prog.statPoints(rec));
    },
  });
  own.add({
    kind: OWN_PROGRESSION,
    version: (_c, rec) => rec.progVersion,
    write(w, _c, rec) {
      const prog = ctx.progression;
      w.varint(prog.engramPoints(rec));
      const known = prog.known(rec);
      w.varint(known.length);
      for (const e of known) w.u16(e);
      w.u8(rec.jobs.length);
      for (const j of rec.jobs) {
        w.u16(j.item);
        w.u8(j.left > 255 ? 255 : j.left);
        w.u32(j.doneAt);
      }
    },
  });

  // A session without a body is sent where it may rise, and again whenever a bed changes: the map's spawn points, then its
  // tribe's beds, each with the tick it is ready from. Why it chooses comes first. What it remembers is the version of the
  // beds the places were made from.
  own.group(OWN_RESPAWN, (c, rec) => {
    if (c.state !== SESSION_DEAD || c.sent[OWN_RESPAWN] === ctx.beds.version) return;
    const places = ctx.beds.places(rec, c.why);
    c.respawnAt.length = 0;
    c.respawnAt.push(...places);
    c.placesList = (c.placesList + 1) & 0xff;
    const w = game.beginOwn(OWN_RESPAWN);
    w.u8(c.why);
    w.u8(c.placesList);
    w.u8(places.length);
    for (const p of places) {
      w.u16(p.kind);
      w.string(fitBytes(p.name, MAX_PLACE_NAME_BYTES));
      w.f32(p.x);
      w.f32(p.z);
      w.u32(p.readyAt);
    }
    game.endOwn(c);
    c.sent[OWN_RESPAWN] = ctx.beds.version;
  });
}

/** Sends a session what changed of its survivor's owner state: every registered kind, in the table's order (server/ownstate.ts). */
export function syncOwn(ctx: OwnContext, c: Client): void {
  const rec = ctx.records.byPid.get(c.pid);
  if (rec) ctx.game.own.sync(c, rec);
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
    // Nothing is put into a supply capsule, nor swapped into one.
    if (a !== b && !ctx.items.takes(a, fromSlot, b, toSlot)) {
      ctx.game.sendText(c, TEXT_NOTICE, TAKE_ONLY);
      return RESULT_DENIED;
    }
    // A module is asked about a stack that changes hands, not one moved about in one inventory.
    if (a !== b && !asked(ctx, c, ITEM_MOVE, { byPid: c.pid, from: a.pid, to: b.pid, item: ctx.world.reg.ids[expect]!, n: count === 0 ? src.count[fromSlot]! : count })) return RESULT_DENIED;
    if (ctx.items.move(a, fromSlot, b, toSlot, count) === 0) return RESULT_INVALID;
    // A loaded weapon swapped into the hands for a spent one of its kind must not fire at once.
    const me = ctx.records.byPid.get(c.pid);
    if (me && me.held >= 0) {
      const held = ctx.items.inv(me).hotbar + me.held;
      if ((a === me && fromSlot === held) || (b === me && toSlot === held)) ctx.rearm(me);
    }
    return RESULT_OK;
  });

  ctx.game.handle(CMD_CREATE, (c: Client, r: BitReader) => {
    const look = new Uint8Array(LOOK_BYTES);
    for (let i = 0; i < LOOK_BYTES; i++) look[i] = r.u8();
    if (r.overflow || !validLook(look)) return RESULT_INVALID;
    if (c.state !== SESSION_CREATING) return RESULT_DENIED;
    if (ctx.game.bus.before(SESSION_CREATE, { name: c.name }) !== "") return RESULT_DENIED;
    const spawn = r.remainingBits >= 8 ? r.u8() : undefined;
    if (spawn !== undefined && !ctx.world.spawns[spawn]) return RESULT_INVALID;
    return ctx.game.sessions.create(c, look, spawn) ? RESULT_OK : RESULT_FULL;
  });
  ctx.game.handle(CMD_CLOSE, (c: Client) => {
    ctx.closeOpen(c);
    return RESULT_OK;
  });

  ctx.game.handle(CMD_RESPAWN, (c: Client, r: BitReader) => {
    const index = r.u8();
    const list = r.u8();
    return r.overflow || c.state !== SESSION_DEAD ? RESULT_INVALID : ctx.beds.choose(c, index, list);
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
    const item = r.u16();
    const count = r.u8();
    const rec = mine(c);
    return r.overflow ? RESULT_INVALID : rec ? ctx.progression.craft(rec, item, count) : RESULT_DENIED;
  });
  // Made at the station the session has open, from what lies in it. The open box is the server's, so no station is named.
  ctx.game.handle(CMD_CRAFT_AT, (c: Client, r: BitReader) => {
    const item = r.u16();
    const count = r.u8();
    const rec = mine(c);
    const station = ctx.openOf(c);
    return r.overflow ? RESULT_INVALID : rec && station ? ctx.progression.craftAt(rec, station, item, count) : RESULT_DENIED;
  });
  // Made from a blueprint in the session's own bag, or in the station it has open, whichever the item is made from.
  ctx.game.handle(CMD_CRAFT_BLUEPRINT, (c: Client, r: BitReader) => {
    const which = r.bits(1);
    const slot = r.varint();
    const count = r.u8();
    if (r.overflow) return RESULT_INVALID;
    const rec = mine(c);
    const on = rec ? box(ctx, c, which) : null;
    return rec && on ? ctx.progression.craftBlueprint(rec, on, slot, count) : RESULT_DENIED;
  });

  const itemDef = (kind: number): ItemDef | null => {
    const d = ctx.world.reg.defs[kind];
    return d?.type === "item" ? d : null;
  };
  /** Null without a body. */
  const bagOf = (c: Client): { rec: EntityRecord; inv: Inventory } | null => {
    const rec = mine(c);
    return rec ? { rec, inv: ctx.items.inv(rec) } : null;
  };

  ctx.game.handle(CMD_SELECT, (c: Client, r: BitReader) => {
    const slot = r.u8();
    const own = bagOf(c);
    if (r.overflow || (slot !== 255 && slot >= HOTBAR_SLOTS)) return RESULT_INVALID;
    if (!own || own.inv.hotbar < 0) return RESULT_DENIED;
    // 255 or an empty slot means nothing held.
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
    const weapon = slot < inv.cap && (inv.flags[slot]! & FLAG_BLUEPRINT) === 0 ? itemDef(inv.item[slot]!)?.weapon : undefined;
    if (!weapon?.ammo || !weapon.ammo.includes(ctx.world.reg.ids[ammo] ?? "")) return RESULT_INVALID;
    if (inv.ammo[slot] === ammo) return RESULT_OK;
    // Rounds of the other kind come out first. The new kind goes in at the next reload.
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
    if (!weapon?.fits || !weapon.fits.includes(ctx.world.reg.ids[inv.item[from]!] ?? "")) return RESULT_INVALID;
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
    // A blueprint does not wear.
    if (slot >= inv.cap || inv.item[slot] === 0 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return RESULT_INVALID;
    const item = inv.item[slot]!;
    const max = ctx.items.maxDur(item, inv.quality[slot]!);
    const craft = (ctx.world.reg.defs[item] as ItemDef).craft;
    if (max === 0 || !craft || inv.dur[slot]! >= max) return RESULT_INVALID;
    // Half of what it is made of, scaled by wear, and at least one of each.
    const worn = 1 - inv.dur[slot]! / max;
    const cost = craft.needs.map((n) => ({ item: ctx.world.reg.index.get(n.item)!, count: Math.max(1, Math.ceil(n.count * 0.5 * worn)) }));
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
    if (!asked(ctx, c, ITEM_DROP, { byPid: c.pid, item: ctx.world.reg.ids[expect]!, n: count === 0 ? own.inv.count[slot]! : count })) return RESULT_DENIED;
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
    // A blueprint is crafted from (CMD_CRAFT_BLUEPRINT), never eaten, used or worn.
    if ((inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return RESULT_INVALID;
    // Using a wearable item puts it on, or takes it off.
    const worn = ctx.world.reg.wearSlot[item]!;
    if (worn >= 0 && inv.armor >= 0) {
      const to = slot >= inv.armor ? inv.free() : inv.armor + worn;
      if (to < 0) return RESULT_FULL;
      return ctx.items.move(rec, slot, rec, to, 0) > 0 ? RESULT_OK : RESULT_INVALID;
    }
    const def = ctx.world.reg.defs[item] as ItemDef;
    const eat = def.eat;
    const use = def.use;
    if (!eat && !use) return RESULT_INVALID;
    if (!asked(ctx, c, ITEM_USE, { byPid: c.pid, item: ctx.world.reg.ids[item]! })) return RESULT_DENIED;
    // A vessel is drunk from or filled, and kept.
    if (use?.holds) return ctx.use.vessel(c, rec, slot, def);
    if (!ctx.items.burn(rec, slot, 1)) return RESULT_STALE;
    if (eat?.food) ctx.survival.add(rec, V_FOOD, eat.food);
    if (eat?.water) ctx.survival.add(rec, V_WATER, eat.water);
    if (eat?.health) ctx.mend(rec, eat.health);
    if (use) ctx.use.apply(rec, use);
    ctx.dose(rec, item, c.pid);
    return RESULT_OK;
  });
}
