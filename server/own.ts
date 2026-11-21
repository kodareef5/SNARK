// Owner-private state, sent only to the survivor's own client on the reliable channel when it changes, at most once per tick
// per component. Also the slot command handlers, the only way a client can ask for its inventory to change.

import type { ItemDef } from "../shared/content/defs.ts";
import { fitBytes, type BitReader } from "../shared/net/codec.ts";
import { TEXT_NOTICE, OWN_KEPT, BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_CLOSE, CMD_CRAFT, CMD_CRAFT_AT, CMD_CRAFT_BLUEPRINT, CMD_CREATE, CMD_DETACH, CMD_DROP, CMD_LEARN, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_RESPAWN, CMD_SELECT, CMD_SPEND, CMD_UNLOAD, CMD_USE, OWN_BUFFS, OWN_HELD, OWN_RULES, RULE_CORPSE_LOCATOR, RULE_CREATIVE, RULE_CROSSHAIR, RULE_DAMAGE_NUMBERS, RULE_GLOBAL_CHAT, RULE_HIT_MARKERS, RULE_MAP_LOCATION, RULE_THIRD_PERSON, OWN_LOOK, OWN_MARKERS, OWN_OPEN, OWN_PROGRESSION, OWN_RESPAWN, OWN_SLOTS, OWN_SUBJECT, OWN_TRIBE, OWN_VITALS, OWN_VOICE, MAX_PLACE_NAME_BYTES, RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_SHORT, RESULT_STALE, SESSION_CREATING, SESSION_DEAD } from "../shared/net/protocol.ts";
import { LOOK_BYTES, validLook } from "../shared/anim/look.ts";
import { TOKEN_BYTES } from "../shared/voice/packet.ts";
import { FLAG_BLUEPRINT, FLAG_ISSUED, HOTBAR_SLOTS, type Inventory } from "../shared/sim/items.ts";
import { V_COUNT, V_FOOD, V_WATER } from "../shared/sim/vitals.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Progression } from "./progression.ts";
import { sendStation } from "./stations.ts";
import type { Rules } from "./settings/rules.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
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

/** What a survivor is told when it would part with a piece of the suit it was issued (server/suit.ts). */
export const ISSUED_STAYS = "Your Meridian suit was issued to you: it stays with you, and cannot be dropped, stored or given away.";
/** And when it would part with the soul ball of its starter mount (server/mount.ts). */
export const ISSUED_BALL_STAYS = "This soul ball was issued to you with your pteranodon: it stays with you, and cannot be dropped, stored or given away.";

/** What a survivor is told when it would part with the issued `item`. */
function issuedStays(ctx: OwnContext, item: number): string {
  const reg = ctx.world.reg;
  return reg.ballFull[item] !== 0 || reg.ballEmpty[item] !== 0 ? ISSUED_BALL_STAYS : ISSUED_STAYS;
}

/** The count is one byte on the wire. A larger tribe sends only its first members. */
const MAX_MEMBERS_SENT = 255;

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
  readonly tribes: Tribes;
  readonly voice: Voice;
  online(pid: number): boolean;
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
      // Flags (SLOT_ bits): a blueprint, an attachment switched on. Whether a piece was issued is the server's alone.
      w.u8(inv.flags[s]! & ~FLAG_ISSUED);
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

/**
 * Sends the tames kept in the soul balls of `inv` (OWN_KEPT), whole, if it holds one or `told` says the session was last
 * told of one. Returns whether it holds one now. Call after the box's slots are sent.
 */
function sendKept(ctx: OwnContext, c: Client, box: number, inv: Inventory, told: boolean): boolean {
  const reg = ctx.world.reg;
  const slots: number[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && reg.ballEmpty[inv.item[s]!] !== 0 && ctx.records.byPid.get(inv.refOf(s))?.stored) slots.push(s);
  if (slots.length === 0 && !told) return false;
  const w = ctx.game.beginOwn(OWN_KEPT);
  w.bits(box, 1);
  w.varint(slots.length);
  for (const s of slots) {
    const tame = ctx.records.byPid.get(inv.refOf(s))!;
    w.varint(s);
    w.u16(tame.kind);
    w.u16(tame.genome ? tame.genome.level : 1);
    w.string(tame.name);
  }
  ctx.game.endOwn(c);
  return slots.length > 0;
}

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
    c.sentKept = sendKept(ctx, c, BOX_SELF, inv, c.sentKept);
    // The load changes how the body moves, and others see its gear.
    if (c.ent >= 0) ctx.refresh(rec);
  }
  if (ctx.rules.version !== c.sentRules) {
    const w = game.beginOwn(OWN_RULES);
    const rules = ctx.rules;
    w.u16(
      (rules.on("ShowFloatingDamageText") ? RULE_DAMAGE_NUMBERS : 0) |
        (rules.on("ProximityChat") ? 0 : RULE_GLOBAL_CHAT) |
        (rules.on("AllowHitMarkers") ? RULE_HIT_MARKERS : 0) |
        (rules.on("AllowThirdPersonPlayer") ? RULE_THIRD_PERSON : 0) |
        (rules.on("ServerCrosshair") ? RULE_CROSSHAIR : 0) |
        (rules.on("ShowMapPlayerLocation") ? RULE_MAP_LOCATION : 0) |
        (rules.on("bUseCorpseLocator") ? RULE_CORPSE_LOCATOR : 0) |
        (rules.on("bShowCreativeMode") ? RULE_CREATIVE : 0),
    );
    game.endOwn(c);
    c.sentRules = ctx.rules.version;
  }
  // The voice token is sent once to each connection.
  const token = ctx.voice.token(c);
  if (c.sentVoice !== token) {
    const w = game.beginOwn(OWN_VOICE);
    w.u16(c.id);
    for (let i = 0; i < TOKEN_BYTES; i++) w.u8(token[i]!);
    w.u8(1);
    game.endOwn(c);
    c.sentVoice = token;
  }
  // Sent whenever any tribe changes, a session comes or goes, or the invitation it was shown expires.
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

  // The open container is announced when it changes, then synced like the survivor's own inventory.
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
  // An open creature's state is sent at most every 6 ticks, and only when it changed.
  const subject = open ? ctx.subject(open) : null;
  if (!subject) {
    if (c.sentSubject !== -1) {
      game.beginOwn(OWN_SUBJECT).bool(false);
      game.endOwn(c);
      c.sentSubject = -1;
    }
  } else if (ctx.world.tick - c.sentSubjectAt >= 6) {
    const q = [subject.taming ? 1 : 0, subject.owned ? 1 : 0, subject.level, Math.round(subject.progress * 1000), Math.round(subject.te * 1000), Math.round(subject.torpor * 1000), Math.round(subject.food * 1000), subject.id, subject.points, subject.stance, (subject.following ? 1 : 0) | (subject.wandering ? 2 : 0), subject.saddled ? 1 : 0, (subject.breeds ? 1 : 0) | (subject.mating ? 2 : 0) | (subject.female ? 4 : 0) | (subject.stage << 3), Math.round(subject.maturity * 1000), Math.round(subject.mate * 1000), subject.wait];
    const sum = q.reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7) >>> 0;
    if (sum !== c.sentSubject) {
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
      c.sentSubject = sum;
      c.sentSubjectAt = ctx.world.tick;
    }
  }
  if (open) {
    const box = ctx.items.inv(open);
    if (box.version !== c.sentOpenVersion) {
      // A box newly opened was told nothing of yet, and the client forgot what the last one held.
      const fresh = c.sentOpenVersion < 0;
      sendSlots(ctx, c, BOX_OPEN, box, c.sentOpenVersion, fresh);
      c.sentOpenVersion = box.version;
      c.sentKeptOpen = sendKept(ctx, c, BOX_OPEN, box, c.sentKeptOpen && !fresh);
    }
  }
  // An open station's queue follows its slots.
  sendStation(game, c, open);

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
    w.u16(prog.level(rec));
    w.u16(prog.statPoints(rec));
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
    game.endOwn(c);
    c.sentProgress = rec.progVersion;
  }

  // A session without a body is sent where it may rise, and again whenever a bed changes: the map's spawn points, then its
  // tribe's beds, each with the tick it is ready from. Why it chooses comes first.
  if (c.state === SESSION_DEAD && c.sentPlaces !== ctx.beds.version) {
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
    c.sentPlaces = ctx.beds.version;
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
    // An issued piece moves about its survivor's own inventory only, and is not swapped out of it either.
    if (a !== b && (ctx.items.issued(a, fromSlot) || ctx.items.issued(b, toSlot))) {
      ctx.game.sendText(c, TEXT_NOTICE, issuedStays(ctx, ctx.items.issued(a, fromSlot) ? expect : ctx.items.inv(b).item[toSlot]!));
      return RESULT_DENIED;
    }
    // A module is asked about a stack that changes hands, not one moved about in one inventory.
    if (a !== b && !asked(ctx, c, ITEM_MOVE, { byPid: c.pid, from: a.pid, to: b.pid, item: reg.ids[expect]!, n: count === 0 ? src.count[fromSlot]! : count })) return RESULT_DENIED;
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
    return ctx.game.create(c, look, spawn) ? RESULT_OK : RESULT_FULL;
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

  const reg = ctx.world.reg;
  const itemDef = (kind: number): ItemDef | null => {
    const d = reg.defs[kind];
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
    if (!weapon?.ammo || !weapon.ammo.includes(reg.ids[ammo] ?? "")) return RESULT_INVALID;
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
    // A blueprint does not wear.
    if (slot >= inv.cap || inv.item[slot] === 0 || (inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return RESULT_INVALID;
    const item = inv.item[slot]!;
    const max = ctx.items.maxDur(item, inv.quality[slot]!);
    const craft = (reg.defs[item] as ItemDef).craft;
    if (max === 0 || !craft || inv.dur[slot]! >= max) return RESULT_INVALID;
    // Half of what it is made of, scaled by wear, and at least one of each.
    const worn = 1 - inv.dur[slot]! / max;
    const cost = craft.needs.map((n) => ({ item: reg.index.get(n.item)!, count: Math.max(1, Math.ceil(n.count * 0.5 * worn)) }));
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
    if (ctx.items.issued(own.rec, slot)) {
      ctx.game.sendText(c, TEXT_NOTICE, issuedStays(ctx, expect));
      return RESULT_DENIED;
    }
    if (!asked(ctx, c, ITEM_DROP, { byPid: c.pid, item: reg.ids[expect]!, n: count === 0 ? own.inv.count[slot]! : count })) return RESULT_DENIED;
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
    const worn = reg.wearSlot[item]!;
    if (worn >= 0 && inv.armor >= 0) {
      const to = slot >= inv.armor ? inv.free() : inv.armor + worn;
      if (to < 0) return RESULT_FULL;
      return ctx.items.move(rec, slot, rec, to, 0) > 0 ? RESULT_OK : RESULT_INVALID;
    }
    const def = ctx.world.reg.defs[item] as ItemDef;
    const eat = def.eat;
    const use = def.use;
    if (!eat && !use) return RESULT_INVALID;
    if (!asked(ctx, c, ITEM_USE, { byPid: c.pid, item: reg.ids[item]! })) return RESULT_DENIED;
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
