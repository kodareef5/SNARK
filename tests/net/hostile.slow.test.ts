// A hostile client that can do what a survivor can: levels and engrams, a full bag, tools and weapons in hand, a tame, a car
// it can sit in, a crate, a house, and stations with fuel. It sends commands made from what it has and what is around it,
// most near enough right to get past a handler's first checks and some a little wrong, from a seeded generator, across
// fresh worlds. Nothing may throw, the item ledger must balance after each world, and each family of commands must get
// past its first checks a fair share of the time. SNARK_FUZZ_SEED=<seed> runs one world.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import * as P from "../../shared/net/protocol.ts";
import { BOX_OPEN, BOX_SELF } from "../../shared/net/protocol.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_PRIMARY, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../../shared/sim/entities.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { NO_PIN, STRUCT_LIGHT, STRUCT_NAME, STRUCT_PIN, STRUCT_TRAVEL, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { ON_TOP } from "../../shared/world/snap.ts";
import { NO_TARGET } from "../../server/build.ts";
import type { Client } from "../../server/game.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { PIECES, builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";

const SEEDS = process.env.SNARK_FUZZ_SEED ? [Number(process.env.SNARK_FUZZ_SEED)] : Array.from({ length: 24 }, (_, i) => i + 1);
/** Commands one world is sent: 480,000 in all, each world saved and loaded again, about 9 s on the development machine. */
const COMMANDS = 20000;

/** Commands by family, and the share of them that must get past their first checks: about two thirds of what they got. */
const FAMILIES: Record<string, { ops: number[]; share: number }> = {
  inventory: { ops: [P.CMD_MOVE, P.CMD_USE, P.CMD_DROP, P.CMD_SELECT], share: 0.35 },
  weapons: { ops: [P.CMD_LOAD, P.CMD_ATTACH, P.CMD_DETACH, P.CMD_UNLOAD, P.CMD_REPAIR], share: 0.2 },
  progression: { ops: [P.CMD_SPEND, P.CMD_LEARN, P.CMD_CRAFT], share: 0.3 },
  building: { ops: [P.CMD_PLACE, P.CMD_STRUCT], share: 0.5 },
  stations: { ops: [P.CMD_CRAFT_AT, P.CMD_CRAFT_BLUEPRINT], share: 0.25 },
  creatures: { ops: [P.CMD_ORDER, P.CMD_NAME, P.CMD_FEED, P.CMD_OPEN, P.CMD_CARRY, P.CMD_TAKE], share: 0.2 },
  vehicles: { ops: [P.CMD_VEHICLE], share: 0.4 },
  session: { ops: [P.CMD_TEXT, P.CMD_CHAT, P.CMD_VIEW, P.CMD_MAP_ZOOM, P.CMD_FAR, P.CMD_RESPAWN, P.CMD_CREATE, P.CMD_CLOSE, P.CMD_STATICS, P.CMD_TRAVEL], share: 0.3 },
};
/** Answers that stop a command at its first checks. */
const EARLY = new Set([P.RESULT_INVALID, P.RESULT_DENIED, P.RESULT_STALE, P.RESULT_BUSY]);

/** The server's admin password, which the client is set up with and then has no cheats; it guesses others. */
const ADMIN = "kiwi";
const LINES = ["help", "pos", "who", "time", "enablecheats wrong", "enablecheats kiwi2", "spectate", "stopspectating", "give ingot 100", "kill", "settime 3", 'help "', "".padEnd(80, "€"), "tribe create Raiders", "tribe leave", "suicide"];

interface Sent {
  op: number;
  bytes: string;
}

/** A survivor set up to do everything, and where its things are. */
function survivor(seed: number) {
  const dbPath = join(mkdtempSync(join(tmpdir(), "snark-hostile-")), "world.db");
  const b = builder(["raider"], 40, 40, { seed, dev: false, adminPassword: ADMIN, dbPath });
  const { h, at } = b;
  const s = b.sessions[0]!;
  /** The client's session now, which a kick or a fault replaces when it joins again. */
  const now = { s, pilot: h.pilots[0]! };
  const reg = h.reg;
  const id = (name: string): number => reg.index.get(`core:${name}`)!;
  const c = (): Client => h.client(now.s)!;
  /** The client is taken there by the operator: it has no cheats of its own once it is set up. */
  const tp = (x: number, z: number, yaw = 0): void => {
    const was = c().admin;
    c().admin = true;
    now.pilot.yaw = yaw;
    h.say(now.s, `tp ${x.toFixed(3)} ${z.toFixed(3)}`);
    c().admin = was;
  };
  // A house of four foundations, walls round it with a door, built as a survivor builds.
  h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + 4).toFixed(3)}`);
  s.command(P.CMD_SELECT, (w) => w.u8(0));
  h.run(100);
  s.command(P.CMD_PLACE, (w) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(at.x * STRUCT_UNITS), 32), w.sbits(Math.round((at.z + 8) * STRUCT_UNITS), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const sw = h.host.build.last;
  const nw = b.join(s, "foundation", sw, 0).ref;
  const se = b.join(s, "foundation", sw, 1).ref;
  const ne = b.join(s, "foundation", nw, 1).ref;
  const door = b.join(s, "wall", sw, 2, 0, 1).ref;
  for (const [on, socket] of [[se, 2], [se, 1], [ne, 1], [ne, 0], [nw, 0], [nw, 3], [sw, 3]] as const) b.join(s, "wall", on, socket);
  b.join(s, "door", door, 0);
  expect([sw, nw, se, ne].every((r) => r >= 0)).toBe(true);
  // A yard beside it: a crate, a forge, a mortar and a smithy, each with something in it, and a car.
  const yard = { x: at.x - 10, z: at.z + 4 };
  const me = h.host.records.byPid.get(c().pid)!;
  const stand = (name: string, dx: number, dz: number, fill: [string, number][]): number => {
    const kind = id(name);
    const ref = h.world.structs.add(kind, yard.x + dx, at.y + reg.halfY[kind]!, yard.z + dz, 0, me.team, reg.maxHp[kind]!);
    const rec = h.host.fixtures.ensure(ref);
    for (const [item, n] of fill) h.host.items.mint(rec, id(item), n);
    return ref;
  };
  const crate = stand("storage_box", 3, 0, [["berry", 10], ["stone", 30], ["arrow_stone", 10]]);
  const forge = stand("forge", -3, 0, [["wood", 10], ["ore", 20], ["oil", 12], ["hide", 10]]);
  const mortar = stand("mortar", 0, 3, [["stone", 40], ["flint", 40], ["chitin", 20]]);
  const smithy = stand("smithy", 0, -3.5, [["ingot", 60], ["wood", 30], ["hide", 30], ["fiber", 50]]);
  const car = h.host.spawnVehicle("core:compact", yard.x + 5, yard.z + 5, me.team, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  h.host.survival.hurt(h.host.records.byPid.get(h.world.ents.pid[car]!)!, 120, 0);
  // Levels, most engrams, a full bag, and a saddled tame and a wild dodo beside the yard.
  c().admin = true;
  h.say(s, "addxp 300000");
  const engrams = reg.defs.flatMap((d, i) => (d?.type === "engram" ? [i] : []));
  for (const e of engrams.filter((_, i) => i % 4 !== 0)) h.host.progression.learn(me, e);
  for (const kit of ["tools", "bow", "pistol", "shotgun", "rifle", "cloth"]) h.say(s, `kit ${kit}`);
  for (const bp of ["spear", "pick", "bow"]) h.say(s, `give ${bp} 1 1 bp`);
  for (const [item, n] of [["wood", 100], ["stone", 100], ["fiber", 100], ["flint", 60], ["ingot", 80], ["hide", 60], ["paste", 40], ["sparkpowder", 40], ["gasoline", 40], ["polymer", 40], ["electronics", 40], ["berry", 40], ["meat", 20], ["dodo_egg_fertile", 2], ["helicopter_assembly", 1], ["piece_storage_box", 2], ["scope", 1], ["silencer", 1]] as const) h.host.items.mint(me, id(item), n);
  // Its tools and weapons worn, and its guns loaded, from what it carries.
  const bag = h.host.items.inv(me);
  for (let k = 0; k < bag.cap; k++) {
    const def = reg.defs[bag.item[k]!] as ItemDef | undefined;
    const max = h.host.items.maxDur(bag.item[k]!, bag.quality[k]!);
    if (max > 0 && (bag.flags[k]! & FLAG_BLUEPRINT) === 0) h.host.items.setDur(me, k, Math.floor(max / 2));
    const ammo = def?.weapon?.ammo?.[0];
    if (ammo) h.host.items.load(me, k, reg.index.get(ammo)!, 5);
  }
  tp(yard.x - 4, yard.z - 4, Math.PI);
  h.say(s, "gmsummon raptor 20");
  h.say(s, "spawn dodo 3");
  c().admin = false;
  h.run(300);
  const tame = (() => {
    const ents = h.world.ents;
    for (let e = 0; e < ents.cap; e++) if ((ents.flags[e]! & F_ALIVE) !== 0 && ents.kind[e] === id("raptor") && h.host.records.byPid.get(ents.pid[e]!)?.team === me.team) return e;
    return -1;
  })();
  expect(tame).toBeGreaterThanOrEqual(0);
  // Something in its bag to be fed from once its inventory is open.
  const fed = h.host.records.byPid.get(h.world.ents.pid[tame]!)!;
  for (const [item, n] of [["meat", 10], ["berry", 10], ["saddle_raptor", 1]] as const) h.host.items.mint(fed, id(item), n);
  return { h, dbPath, now, c, tp, reg, at, yard, engrams, refs: { house: [sw, nw, se, ne, door], crate, forge, mortar, smithy }, car, tame };
}

/** Sends `COMMANDS` commands to one world. Returns the answers by op, and what was sent last, for a failure to say. */
function fuzz(seed: number): { codes: Map<number, Map<number, number>>; faults: string[]; audit: string[]; sent: Sent[] } {
  const w0 = survivor(seed);
  const { h, now, c, tp, reg, yard, at, engrams, refs } = w0;
  const rng = new Rng(seed * 7919 + 13);
  const ents = h.world.ents;
  const faults: string[] = [];
  const hook = h.server.players.onFault;
  h.server.players.onFault = (cl, op, command, err) => {
    faults.push(`op ${op}, the message ${Buffer.from(command).toString("hex")}: ${err instanceof Error ? err.stack : String(err)}`);
    return hook ? hook(cl, op, command, err) : false;
  };
  const codes = new Map<number, Map<number, number>>();
  const bySeq = new Map<number, number>();
  const answer = (seq: number, code: number): void => {
    const op = bySeq.get(seq);
    if (op === undefined) return;
    bySeq.delete(seq);
    const m = codes.get(op) ?? new Map<number, number>();
    m.set(code, (m.get(code) ?? 0) + 1);
    codes.set(op, m);
  };
  now.s.onResult = answer;
  const sent: Sent[] = [];
  const args = new BitWriter(1024);

  // What the client may know of: its bag, what it has open, its body, what stands and lives around it.
  const pick = <T>(list: readonly T[]): T => list[rng.int(list.length)]!;
  const chance = (p: number): boolean => rng.float() < p;
  const items = reg.defs.flatMap((d, i) => (d?.type === "item" ? [i] : []));
  const itemDef = (i: number): ItemDef | null => (reg.defs[i]?.type === "item" ? (reg.defs[i] as ItemDef) : null);
  const handMade = items.filter((i) => itemDef(i)?.craft && reg.craftAt[i] === 0);
  const stationMade = items.filter((i) => reg.craftAt[i] !== 0);
  const stations = new Set(stationMade.map((i) => reg.craftAt[i]!));
  let near: { refs: number[]; mine: number[]; ents: number[]; eggs: number[] } = { refs: [], mine: [], ents: [], eggs: [] };
  const look = (): void => {
    const cl = c();
    const team = h.host.records.byPid.get(cl.pid)?.team ?? -1;
    const out = { refs: [] as number[], mine: [] as number[], ents: [] as number[], eggs: [] as number[] };
    const x = cl.body.x, z = cl.body.z;
    h.world.structs.chunks.forEach((t, chunk) => {
      if (!t) return;
      for (let k = 0; k < t.high; k++) {
        if (t.kind[k] === 0 || Math.hypot(t.x[k]! - x, t.z[k]! - z) > 14) continue;
        out.refs.push(chunk * 65536 + k);
        if (t.owner[k] === team) out.mine.push(chunk * 65536 + k);
      }
    });
    for (let e = 0; e < ents.cap; e++) {
      if ((ents.flags[e]! & F_ALIVE) === 0 || Math.hypot(ents.x[e]! - x, ents.z[e]! - z) > 30) continue;
      out.ents.push(e);
      if ((ents.flags[e]! & F_PROP) !== 0 && h.host.records.byPid.get(ents.pid[e]!)?.egg) out.eggs.push(e);
    }
    near = out;
  };
  const own = () => {
    const cl = c();
    const rec = h.host.records.byPid.get(cl.pid) ?? null;
    const open = cl.open ? (h.host.records.byPid.get(cl.open) ?? null) : null;
    return { cl, rec, inv: rec ? h.host.items.inv(rec) : null, open, openInv: open ? h.host.items.inv(open) : null };
  };
  type Inv = NonNullable<ReturnType<typeof own>["inv"]>;
  const full = (inv: Inv | null): number[] => {
    const out: number[] = [];
    for (let k = 0; inv && k < inv.cap; k++) if (inv.item[k] !== 0) out.push(k);
    return out;
  };
  const slotOf = (inv: Inv | null, filled = true): number => {
    const cap = inv?.cap ?? 40;
    const have = full(inv);
    if (filled && have.length > 0 && chance(0.8)) return pick(have);
    return chance(0.9) ? rng.int(cap) : chance(0.5) ? cap + rng.int(4) : rng.int(1 << 20);
  };
  const expected = (inv: Inv | null, k: number): number => (inv && k < inv.cap && chance(0.9) ? inv.item[k]! : pick(items));
  const count = (): number => (chance(0.4) ? 0 : chance(0.6) ? 1 + rng.int(5) : rng.int(65536));
  const slotsWhere = (inv: Inv | null, test: (item: number, k: number) => boolean): number[] => full(inv).filter((k) => test(inv!.item[k]!, k));
  const handle = (e: number): number => (e >= 0 ? ents.handleOf(e) : rng.int(2 ** 32));
  const entity = (prefer: number): number => (chance(0.6) && prefer >= 0 && (ents.flags[prefer]! & F_ALIVE) !== 0 ? prefer : near.ents.length > 0 && chance(0.85) ? pick(near.ents) : rng.int(ents.cap + 4));
  const text = (): string => pick(["Raiders", "", "x".repeat(30), "ok", "\u0000", "名前"]);

  const write: Record<number, (w: BitWriter) => void> = {
    [P.CMD_TEXT]: (w) => w.string(pick(LINES)),
    [P.CMD_MOVE]: (w) => {
      const o = own();
      const [fb, from] = o.openInv && chance(0.4) ? [BOX_OPEN, o.openInv] : [BOX_SELF, o.inv];
      const [tb, to] = o.openInv && chance(0.4) ? [BOX_OPEN, o.openInv] : [BOX_SELF, o.inv];
      const k = slotOf(from);
      w.bits(fb, 1), w.varint(k), w.bits(tb, 1), w.varint(slotOf(to, chance(0.3))), w.u16(count()), w.u16(expected(from, k));
    },
    [P.CMD_USE]: (w) => {
      const o = own();
      const k = slotOf(o.inv);
      w.varint(k), w.u16(expected(o.inv, k));
    },
    [P.CMD_CLOSE]: () => {},
    [P.CMD_RESPAWN]: (w) => (w.u8(chance(0.85) ? rng.int(Math.max(1, c().respawnAt.length)) : rng.int(8)), w.u8(chance(0.9) ? c().placesList & 255 : rng.int(256))),
    [P.CMD_SPEND]: (w) => w.u8(rng.int(14)),
    [P.CMD_LEARN]: (w) => w.u16(chance(0.85) ? pick(engrams) : rng.int(65536)),
    [P.CMD_CRAFT]: (w) => (w.u16(chance(0.85) ? pick(handMade) : pick(items)), w.u8(chance(0.9) ? 1 + rng.int(3) : rng.int(256))),
    [P.CMD_CREATE]: (w) => {
      const l = defaultLook();
      if (chance(0.3)) l[rng.int(l.length)] = rng.int(256);
      for (const b of l) w.u8(b);
    },
    [P.CMD_SELECT]: (w) => {
      const inv = own().inv;
      const pieces = inv ? Array.from({ length: 10 }, (_, k) => k).filter((k) => reg.places[inv.item[inv.hotbar + k]!]) : [];
      w.u8(pieces.length > 0 && chance(0.6) ? pick(pieces) : chance(0.75) ? rng.int(10) : chance(0.5) ? 255 : rng.int(256));
    },
    [P.CMD_LOAD]: (w) => {
      const o = own();
      const guns = slotsWhere(o.inv, (item) => !!itemDef(item)?.weapon?.ammo);
      const k = guns.length > 0 && chance(0.85) ? pick(guns) : slotOf(o.inv);
      const takes = itemDef(o.inv?.item[k] ?? 0)?.weapon?.ammo ?? [];
      w.varint(k), w.u16(takes.length > 0 && chance(0.85) ? reg.index.get(pick(takes))! : pick(items));
    },
    [P.CMD_ATTACH]: (w) => {
      const o = own();
      const guns = slotsWhere(o.inv, (item) => !!itemDef(item)?.weapon?.fits);
      const parts = slotsWhere(o.inv, (item) => ["scope", "silencer", "flashlight", "laser"].includes(reg.ids[item]!.replace("core:", "")));
      w.varint(guns.length > 0 && chance(0.85) ? pick(guns) : slotOf(o.inv)), w.varint(parts.length > 0 && chance(0.85) ? pick(parts) : slotOf(o.inv));
    },
    [P.CMD_DETACH]: (w) => {
      const o = own();
      const fitted = slotsWhere(o.inv, (_, k) => o.inv!.attach[k] !== 0);
      w.varint(fitted.length > 0 && chance(0.8) ? pick(fitted) : slotOf(o.inv));
    },
    [P.CMD_UNLOAD]: (w) => {
      const o = own();
      const loaded = slotsWhere(o.inv, (_, k) => o.inv!.loaded[k] !== 0);
      w.varint(loaded.length > 0 && chance(0.8) ? pick(loaded) : slotOf(o.inv));
    },
    [P.CMD_REPAIR]: (w) => {
      const o = own();
      const worn = slotsWhere(o.inv, (item, k) => (o.inv!.flags[k]! & FLAG_BLUEPRINT) === 0 && h.host.items.maxDur(item, o.inv!.quality[k]!) > o.inv!.dur[k]!);
      w.varint(worn.length > 0 && chance(0.8) ? pick(worn) : slotOf(o.inv));
    },
    [P.CMD_DROP]: (w) => {
      const o = own();
      const k = slotOf(o.inv);
      w.varint(k), w.u16(chance(0.7) ? 1 : count()), w.u16(expected(o.inv, k));
    },
    [P.CMD_CHAT]: (w) => (w.bits(rng.int(8), 3), w.string(text())),
    [P.CMD_PLACE]: (w) => {
      const o = own();
      const forms = o.rec && o.inv && o.rec.held >= 0 ? reg.places[o.inv.item[o.inv.hotbar + o.rec.held]!] : null;
      w.u8(forms && chance(0.85) ? rng.int(forms.length) : rng.int(4));
      const b = c().body;
      if (near.mine.length > 0 && chance(0.75)) {
        const on = pick(near.mine);
        w.u32(on);
        const socket = chance(0.15) ? ON_TOP : chance(0.9) ? rng.int(8) : rng.int(256);
        w.u8(socket);
        if (socket === ON_TOP) w.sbits(Math.round((b.x + rng.range(-3, 3)) * STRUCT_UNITS), 32), w.sbits(Math.round((b.z + rng.range(-3, 3)) * STRUCT_UNITS), 32), w.u16(rng.int(65536));
      } else {
        w.u32(chance(0.9) ? NO_TARGET : rng.int(2 ** 32));
        w.sbits(Math.round((b.x + rng.range(-6, 6)) * STRUCT_UNITS), 32), w.sbits(Math.round((b.z + rng.range(-6, 6)) * STRUCT_UNITS), 32), w.u16(rng.int(65536)), w.sbits(rng.int(5) - 2, 8);
      }
      w.u8(chance(0.8) ? rng.int(4) : rng.int(256));
    },
    [P.CMD_STRUCT]: (w) => {
      // With nothing open it mostly opens something to work at; the forge is lit and put out.
      const shut = c().open === 0;
      const boxes = [refs.crate, refs.forge, refs.mortar, refs.smithy, refs.smithy, refs.mortar];
      const ref = shut && chance(0.6) ? pick(boxes) : chance(0.4) ? pick([...boxes, ...refs.house]) : near.refs.length > 0 && chance(0.9) ? pick(near.refs) : rng.int(2 ** 32);
      w.u32(ref);
      const action = shut && boxes.includes(ref) && chance(0.8) ? STRUCT_USE : chance(0.3) ? STRUCT_USE : ref === refs.forge && chance(0.5) ? STRUCT_LIGHT : chance(0.95) ? rng.int(10) : rng.int(256);
      w.u8(action);
      if (action === STRUCT_PIN || action === STRUCT_USE) w.u16(chance(0.6) ? NO_PIN : chance(0.5) ? 1234 : rng.int(65536));
      if (action === STRUCT_NAME || action === STRUCT_TRAVEL) w.string(text());
    },
    [P.CMD_ORDER]: (w) => {
      w.u32(chance(0.15) ? P.ORDER_ALL : entity(w0.tame));
      const order = chance(0.85) ? pick([P.ORDER_STAY, P.ORDER_FOLLOW, P.ORDER_STANCE, P.ORDER_STANCE + 1, P.ORDER_STANCE + 2, P.ORDER_UNSADDLE, P.ORDER_MATE, P.ORDER_UNMATE, P.ORDER_WANDER, P.ORDER_ATTACK, P.ORDER_YOURS, P.ORDER_LAND, P.ORDER_LEVEL + rng.int(12)]) : rng.int(256);
      w.u8(order);
      if (order === P.ORDER_ATTACK) w.u32(entity(-1));
    },
    [P.CMD_NAME]: (w) => (w.u32(chance(0.8) ? handle(w0.tame) : handle(entity(-1))), w.string(text())),
    [P.CMD_FEED]: (w) => {
      const o = own();
      const k = slotOf(o.openInv);
      w.varint(k), w.u16(expected(o.openInv, k));
    },
    [P.CMD_OPEN]: (w) => w.u32(entity(w0.tame)),
    [P.CMD_VIEW]: (w) => (w.u16(rng.int(2048)), w.u16(rng.int(4096))),
    [P.CMD_MAP_ZOOM]: (w) => w.bits(rng.int(4), 2),
    [P.CMD_FAR]: (w) => w.u16(rng.int(4000)),
    [P.CMD_CARRY]: (w) => {
      // What is carried is mostly set down or thrown soon: arms that hold a creature hold nothing else.
      const action = h.host.carry.holding(c()) >= 0 && chance(0.7) ? 1 + rng.int(2) : chance(0.95) ? rng.int(3) : rng.int(256);
      w.u8(action);
      const small = near.ents.filter((e) => reg.carriable[ents.kind[e]!] !== 0 && e !== c().ent);
      if (action === P.CARRY_PICK_UP) w.u32(small.length > 0 && chance(0.8) ? pick(small) : entity(-1));
    },
    [P.CMD_TAKE]: (w) => w.u32(near.eggs.length > 0 && chance(0.7) ? pick(near.eggs) : entity(-1)),
    [P.CMD_CRAFT_AT]: (w) => {
      const o = own();
      const base = o.open ? reg.stationBase[o.open.kind] : 0;
      const here = stationMade.filter((i) => reg.craftAt[i] === base);
      w.u16(here.length > 0 && chance(0.85) ? pick(here) : chance(0.7) ? pick(stationMade) : pick(items)), w.u8(chance(0.9) ? 1 + rng.int(3) : rng.int(256));
    },
    [P.CMD_CRAFT_BLUEPRINT]: (w) => {
      const o = own();
      const box = o.openInv && chance(0.3) ? BOX_OPEN : BOX_SELF;
      const inv = box === BOX_OPEN ? o.openInv : o.inv;
      const prints = slotsWhere(inv, (_, k) => (inv!.flags[k]! & FLAG_BLUEPRINT) !== 0);
      w.bits(box, 1), w.varint(prints.length > 0 && chance(0.85) ? pick(prints) : slotOf(inv)), w.u8(chance(0.9) ? 1 + rng.int(2) : rng.int(256));
    },
    [P.CMD_TRAVEL]: (w) => (w.u16(rng.int(4)), w.u32(chance(0.5) ? pick(near.refs.length > 0 ? near.refs : [0]) : rng.int(2 ** 32))),
    [P.CMD_VEHICLE]: (w) => {
      const action = chance(0.95) ? rng.int(5) : rng.int(256);
      w.u8(action);
      if (action === P.VEHICLE_DEPLOY) {
        const o = own();
        const kits = slotsWhere(o.inv, (item) => reg.vehicleDeploy[item] !== 0);
        const b = c().body;
        w.u8(kits.length > 0 && chance(0.85) ? pick(kits) : rng.int(256));
        w.f32(b.x + rng.range(-8, 8)), w.f32(b.y + rng.range(-0.5, 1.5)), w.f32(b.z + rng.range(-8, 8)), w.u16(rng.int(65536));
        return;
      }
      w.u32(chance(0.85) ? handle(w0.car) : handle(entity(-1)));
      if (action === P.VEHICLE_REFUEL) w.u8(chance(0.5) ? 0 : rng.int(256));
    },
    [P.CMD_STATICS]: () => {},
  };
  /** How often each op is sent, by weight. The families the review found least reached are sent most. */
  const weights: [number, number][] = [
    [P.CMD_MOVE, 8], [P.CMD_USE, 4], [P.CMD_DROP, 2], [P.CMD_SELECT, 4], [P.CMD_LOAD, 2], [P.CMD_ATTACH, 2], [P.CMD_DETACH, 1], [P.CMD_UNLOAD, 1], [P.CMD_REPAIR, 2],
    [P.CMD_SPEND, 2], [P.CMD_LEARN, 2], [P.CMD_CRAFT, 3], [P.CMD_PLACE, 10], [P.CMD_STRUCT, 10], [P.CMD_CRAFT_AT, 2], [P.CMD_CRAFT_BLUEPRINT, 2], [P.CMD_CLOSE, 1],
    [P.CMD_ORDER, 4], [P.CMD_NAME, 1], [P.CMD_FEED, 1], [P.CMD_OPEN, 3], [P.CMD_CARRY, 2], [P.CMD_TAKE, 2], [P.CMD_VEHICLE, 8],
    [P.CMD_TEXT, 1], [P.CMD_CHAT, 1], [P.CMD_VIEW, 1], [P.CMD_MAP_ZOOM, 1], [P.CMD_FAR, 1], [P.CMD_RESPAWN, 1], [P.CMD_CREATE, 1], [P.CMD_TRAVEL, 1], [P.CMD_STATICS, 1],
  ];
  const total = weights.reduce((n, [, k]) => n + k, 0);
  const opOf = (): number => {
    let x = rng.int(total);
    for (const [op, k] of weights) if ((x -= k) < 0) return op;
    return P.CMD_MOVE;
  };
  /** One command, most made as its handler reads it, some cut short, some with more after, a few of an op no handler has. */
  const one = (): void => {
    // A command can end the session (three wrong admin passwords): the rest of the burst waits for the next connection.
    if (now.s.state !== "active" || !h.client(now.s)) return;
    const odd = rng.float();
    // A client does what what it has open is for, and once it has died asks to rise again before much else.
    const open = c().open === 0 ? null : h.host.records.byPid.get(c().open);
    const at = !open ? [] : reg.defs[open.kind]?.type === "species" ? [P.CMD_FEED, P.CMD_FEED, P.CMD_MOVE] : stations.has(reg.stationBase[open.kind]!) ? [P.CMD_CRAFT_AT, P.CMD_CRAFT_AT, P.CMD_CRAFT_BLUEPRINT, P.CMD_MOVE] : [P.CMD_MOVE];
    let op = odd < 0.01 ? rng.int(256) : c().state === P.SESSION_DEAD && chance(0.5) ? P.CMD_RESPAWN : at.length > 0 && chance(0.35) ? pick(at) : opOf();
    // A piece is chosen before it is placed.
    const me = own();
    if (op === P.CMD_PLACE && me.rec && me.inv && !(me.rec.held >= 0 && reg.places[me.inv.item[me.inv.hotbar + me.rec.held]!]) && chance(0.8)) op = P.CMD_SELECT;
    args.reset();
    write[op]?.(args);
    const bytes = args.bytes();
    const keep = odd > 0.95 ? rng.int(bytes.length + 1) : bytes.length;
    const seq = now.s.command(op, (w) => {
      for (let i = 0; i < keep; i++) w.u8(bytes[i]!);
      if (odd > 0.9 && odd <= 0.95) for (let n = rng.int(8); n > 0; n--) w.u8(rng.int(256));
    });
    if (seq === 0) return;
    bySeq.set(seq, op);
    sent.push({ op, bytes: Buffer.from(bytes.subarray(0, keep)).toString("hex") });
    if (sent.length > 64) sent.shift();
  };
  /** What it moved into boxes, dropped, spent or built is given again, so every family keeps something to work on. */
  const restock = (): void => {
    const rec = h.host.records.byPid.get(c().pid);
    if (!rec || rec.dead) return;
    const inv = h.host.items.inv(rec);
    for (const [item, n] of [["pistol", 1], ["rifle", 1], ["bow", 1], ["scope", 1], ["silencer", 1], ["round_pistol", 30], ["round_rifle", 20], ["arrow_stone", 20], ["gasoline", 10], ["ingot", 30], ["polymer", 10], ["electronics", 10], ["berry", 10], ["dodo_egg_fertile", 1], ["helicopter_assembly", 1]] as const) {
      if (inv.total(reg.index.get(`core:${item}`)!) === 0) h.host.items.mint(rec, reg.index.get(`core:${item}`)!, n);
    }
    for (const bp of ["spear", "pick", "bow"]) {
      const item = reg.index.get(`core:${bp}`)!;
      if (!full(inv).some((k) => inv.item[k] === item && (inv.flags[k]! & FLAG_BLUEPRINT) !== 0)) h.host.items.mint(rec, item, 1, 1, 0, -1, "", FLAG_BLUEPRINT);
    }
    for (const [ref, fill] of [[refs.mortar, [["stone", 40], ["flint", 40], ["chitin", 20]]], [refs.smithy, [["ingot", 60], ["wood", 30], ["hide", 30], ["fiber", 50]]], [refs.forge, [["wood", 10], ["ore", 20]]]] as const) {
      const box = h.host.fixtures.find(ref);
      if (!box) continue;
      const held = h.host.items.inv(box);
      for (const [name, n] of fill) {
        const item = reg.index.get(`core:${name}`)!;
        if (held.total(item) < n / 4) h.host.items.mint(box, item, n);
      }
    }
    PIECES.forEach((piece, k) => {
      const item = reg.index.get(`core:piece_${piece}_wood`)!;
      if (inv.item[inv.hotbar + k] !== 0 || h.host.items.mint(rec, item, 20) === 0) return;
      const from = inv.item.indexOf(item);
      if (from >= 0 && from !== inv.hotbar + k) h.host.items.move(rec, from, rec, inv.hotbar + k, 0);
    });
  };
  /** Where the client goes next, to have each thing in reach in turn. */
  const places = (): [number, number][] => {
    const car = w0.car >= 0 && (ents.flags[w0.car]! & F_ALIVE) !== 0 ? [ents.x[w0.car]! - 2.5, ents.z[w0.car]!] : [yard.x + 3, yard.z + 5];
    const tame = w0.tame >= 0 && (ents.flags[w0.tame]! & F_ALIVE) !== 0 ? [ents.x[w0.tame]! + 2, ents.z[w0.tame]!] : [yard.x - 4, yard.z - 4];
    return [[yard.x, yard.z], [yard.x + 1, yard.z + 1], car as [number, number], tame as [number, number], [at.x, at.z + 9], [at.x + 2, at.z + 11]];
  };

  let joins = 0;
  for (let i = 0; i < COMMANDS; ) {
    // A command that threw has put the client out and refused it; the world's report says which.
    if (faults.length > 0) break;
    if (now.s.state !== "active") {
      // Put out (three wrong admin passwords do it): it comes back on a new connection, with the same device.
      now.s = h.join("raider");
      now.pilot = h.pilots[h.pilots.length - 1]!;
      now.s.onResult = answer;
      h.run(300);
      expect([seed, i, now.s.state, ++joins < 200]).toEqual([seed, i, "active", true]);
    }
    const pilot = now.pilot;
    if (i % 300 === 0) {
      const [x, z] = pick(places());
      tp(x, z, rng.range(0, 6.28));
      restock();
      look();
    } else if (i % 40 === 0) look();
    if (i % 12 === 0) {
      pilot.moveX = chance(0.6) ? 0 : rng.range(-0.4, 0.4);
      pilot.moveZ = chance(0.6) ? 0 : rng.range(-0.4, 0.4);
      pilot.yaw = rng.range(0, 6.28);
      pilot.pitch = rng.range(-0.6, 0.4);
      pilot.buttons = (chance(0.25) ? BTN_USE : 0) | (chance(0.05) ? BTN_PRIMARY : 0) | (chance(0.03) ? BTN_SECONDARY : 0) | (chance(0.03) ? BTN_RELOAD : 0) | (chance(0.05) ? BTN_JUMP : 0) | (chance(0.05) ? BTN_CROUCH : 0) | (chance(0.05) ? BTN_SPRINT : 0);
    }
    for (let k = 0; k < 4 && i < COMMANDS; k++, i++) one();
    h.run(1000 / TICK_RATE);
  }
  h.run(500);
  const audit = h.host.items.audit();
  h.host.shutdown();
  // What it was saved as loads, its ledger checked as a server checks it when it starts.
  const again = new Harness({}, seed, 60, { seed, adminPassword: ADMIN, dbPath: w0.dbPath });
  audit.push(...again.host.items.audit());
  again.host.shutdown();
  rmSync(dirname(w0.dbPath), { recursive: true, force: true });
  return { codes, faults, audit, sent };
}

test("a hostile client that can do everything a survivor can sends near-valid commands, and nothing throws, the ledger balances, and every family is reached", () => {
  const all = new Map<number, Map<number, number>>();
  for (const seed of SEEDS) {
    let run: ReturnType<typeof fuzz>;
    try {
      run = fuzz(seed);
    } catch (err) {
      throw new Error(`seed ${seed} threw; SNARK_FUZZ_SEED=${seed} bun test tests/net/hostile.slow.test.ts runs it alone\n${err instanceof Error ? err.stack : String(err)}`);
    }
    const said = `seed ${seed} (SNARK_FUZZ_SEED=${seed} runs it alone); the last commands sent:\n${run.sent.map((x) => `  op ${x.op} ${x.bytes}`).join("\n")}`;
    expect([run.faults, run.audit], said).toEqual([[], []]);
    for (const [op, m] of run.codes) {
      const into = all.get(op) ?? new Map<number, number>();
      for (const [code, n] of m) into.set(code, (into.get(code) ?? 0) + n);
      all.set(op, into);
    }
  }
  // Each command's answers, code:count, and each family's share past its first checks.
  const report: string[] = [];
  const short: string[] = [];
  for (const [family, { ops, share }] of Object.entries(FAMILIES)) {
    let sentN = 0;
    let deep = 0;
    for (const op of ops) {
      const m = all.get(op) ?? new Map<number, number>();
      const n = [...m.values()].reduce((a, b) => a + b, 0);
      const past = [...m].reduce((a, [code, k]) => a + (EARLY.has(code) ? 0 : k), 0);
      sentN += n;
      deep += past;
      report.push(`  op ${op}: ${n} sent, ${past} past the first checks; ${[...m].sort((a, b) => a[0] - b[0]).map(([code, k]) => `${code}:${k}`).join(" ")}`);
    }
    report.push(`${family}: ${((100 * deep) / Math.max(1, sentN)).toFixed(0)}% past the first checks, of ${sentN}`);
    if (deep / Math.max(1, sentN) < share) short.push(family);
  }
  if (process.env.SNARK_FUZZ_REPORT) console.log(report.join("\n"));
  expect(short, report.join("\n")).toEqual([]);
});
