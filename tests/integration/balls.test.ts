// Soul balls (planning/workstreams/soul-ball.md): a tame kept in an item and loosed again the same, what it leaves behind,
// what ends it, and what a modified client cannot do with one.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ballInfo, chargeWords, keptName, loosePrompt } from "../../client/core/balls.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEEP_REACH, LOOSE_REACH } from "../../server/balls.ts";
import { createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BAG_TICKS, CACHE_TICKS } from "../../server/death.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_STRUCT, CMD_DROP, CMD_MOVE, CMD_OPEN, CMD_NAME, CMD_ORDER, CMD_SELECT, CMD_USE, CARRY_PICK_UP, CMD_CARRY, CMD_FEED, EVENT_BALL, ORDER_FOLLOW, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { F_ALIVE, F_PROP } from "../../shared/sim/entities.ts";
import { CHARGED } from "../../shared/sim/items.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { BALL_TAMES, OP_BREAK, OP_KEEP, OP_LOOSE, OP_PASS } from "../fixtures/crash-child.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const BALL = id("soul_ball");
const FULL = id("soul_ball_full");
const dir = mkdtempSync(join(tmpdir(), "snark-balls-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Pilot = Harness["pilots"][number];

/** Ada with cheats on level ground, facing up it, and a soul ball in her hand. */
function pen(host: { dbPath?: string; config?: unknown } = {}, balls = 1) {
  const h = new Harness({}, 1, 60, { dev: true, ...host } as ConstructorParameters<typeof Harness>[3]);
  const ada = h.join("ada");
  h.run(500);
  const g = flatGround(h, 60, 40);
  const at = { x: g.x + 30, z: g.z + 8, y: g.y };
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const pilot = h.pilots[0]!;
  pilot.yaw = 0;
  pilot.pitch = 0;
  if (balls > 0) {
    h.say(ada, `give soul_ball ${balls}`);
    h.run(200);
    takeInHand(h, ada, BALL);
    h.run(700);
  }
  return { h, ada, at, me, pilot };
}

/** A grown raptor of `owner`'s, saddled and named, standing `ahead` metres up the ground from (x, z). */
function tame(h: Harness, owner: EntityRecord, x: number, z: number, name = "Bitey", species = "raptor"): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, x, z, 12);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.taming.give(rec, owner, 0.75);
  rec.name = name;
  if (species === "raptor") rec.saddle = id("saddle_raptor");
  rec.stance = 0;
  h.run(100);
  return { e, rec };
}

/** One click: the button down long enough for the throw's strike, and let go. */
function click(h: Harness, pilot: Pilot): void {
  pilot.buttons |= 4;
  h.run(300);
  pilot.buttons &= ~4;
  h.run(400);
}

/** Looks at the middle of the body `e`, from where she stands. */
function lookAt(h: Harness, s: ClientSession, pilot: Pilot, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const dx = ents.x[e]! - ents.x[me]!;
  const dz = ents.z[e]! - ents.z[me]!;
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + reg.bodyHeight[ents.kind[e]!]! / 2 - (ents.y[me]! + 1.62), Math.hypot(dx, dz));
  h.run(200);
}

const notices = (s: ClientSession, from: number): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);
const bags = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag"));
/** What must be the same of a tame after it has been kept and loosed. */
const facts = (r: EntityRecord) => ({ pid: r.pid, kind: r.kind, name: r.name, saddle: r.saddle, xp: r.xp, te: r.te, stance: r.stance, level: r.genome!.level, wild: [...r.genome!.wild], tamed: [...r.genome!.tamed], colors: [...r.genome!.colors], female: r.genome!.female });

test("a saddled tame is kept in a ball and loosed the same: one record, in the world or in the ball, never both", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  const slot = h.host.items.inv(me).hotbar;
  const was = facts(rec);
  const counted = h.host.taming.count(me.team).ours;
  rec.xp = was.xp = 37;
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  // Its body is gone, its record stays, and the ball in her hand is a full one that stands for it.
  const inv = h.host.items.inv(me);
  expect([h.host.records.entOf.has(rec.pid), rec.stored > 0, inv.item[slot], inv.refOf(slot), h.host.balls.kept]).toEqual([false, true, FULL, rec.pid, 1]);
  expect(h.world.ents.flags[e]! & F_ALIVE).toBe(0);
  expect(h.host.records.byPid.get(rec.pid)).toBe(rec);
  // Its charge is 30 days from then, and the client is told the full ball and its clock.
  const charge = inv.spoilAt[slot]! - h.world.tick;
  expect(charge).toBeGreaterThan(30 * 86400 * TICK_RATE - 5 * TICK_RATE);
  expect(charge).toBeLessThanOrEqual(30 * 86400 * TICK_RATE);
  expect([ada.inventory!.item[slot], ada.inventory!.spoilAt[slot]]).toEqual([FULL, inv.spoilAt[slot]!]);
  // Her client is told what the ball holds, and it and anyone near are told of the tame going in, to see and hear it.
  expect([...ada.kept[0]]).toEqual([[slot, { kind: rec.kind, level: rec.genome!.level, name: "Bitey" }]]);
  expect(ballInfo(reg, FULL, ada.kept[0].get(slot), ada.inventory!.spoilAt[slot]!, rec.stored)).toBe(`soul ball holds Bitey, raptor, level ${rec.genome!.level}; 30 days left`);
  expect(loosePrompt(reg, ada.kept[0].get(slot))).toBe("click  loose Bitey");
  const went = ada.events.filter((ev) => ev.kind === EVENT_BALL);
  expect(went.map((ev) => [ev.kill, ev.far, ev.vy])).toEqual([[true, Math.fround(reg.bodyRadius[rec.kind]!), Math.fround(reg.bodyHeight[rec.kind]!)]]);
  ada.events.length = 0;
  // Kept, it is not one of the tribe's tames to the limits, as ARK counts none in a cryopod.
  expect(h.host.taming.count(me.team).ours).toBe(counted - 1);
  expect(h.host.items.audit()).toEqual([]);

  // Time passes for the world and not for it.
  const food = rec.vitals!.value[V_FOOD]!;
  const stamp = rec.vitals!.tick;
  h.run(20000);
  expect([rec.vitals!.value[V_FOOD], rec.vitals!.tick, rec.vitalsDue, rec.mealDue]).toEqual([food, stamp, 0, 0]);

  // Loosed where she looks: the same record, with a body again a little way up the ground, and the ball empty.
  pilot.yaw = 0;
  pilot.pitch = -0.25;
  h.run(200);
  const before = h.world.tick;
  click(h, pilot);
  const body = h.host.records.entOf.get(rec.pid)!;
  expect(body).toBeGreaterThanOrEqual(0);
  expect([rec.stored, inv.item[slot], inv.refOf(slot), h.host.balls.loosed, h.host.balls.mended]).toEqual([0, BALL, 0, 1, 0]);
  expect(facts(rec)).toEqual(was);
  const ents = h.world.ents;
  expect(ents.z[body]! - ents.z[h.ent(ada)]!).toBeGreaterThan(1);
  expect(Math.hypot(ents.x[body]! - ents.x[h.ent(ada)]!, ents.z[body]! - ents.z[h.ent(ada)]!)).toBeLessThan(LOOSE_REACH + 1);
  expect([ents.pid[body], ents.team[body]]).toEqual([rec.pid, me.team]);
  // Its hunger goes on from where it stopped: it lost no more food than the moments since it was loosed take.
  h.host.survival.value(rec, V_FOOD);
  expect(rec.vitals!.tick).toBeGreaterThanOrEqual(before);
  expect(food - rec.vitals!.value[V_FOOD]!).toBeLessThan(food * 0.001);
  expect(h.host.taming.count(me.team).ours).toBe(counted);
  expect(ada.inventory!.item[slot]).toBe(BALL);
  // The ball holds nothing now, her client knows, and the tame was seen to come out where it stands.
  expect([ada.kept[0].size, ballInfo(reg, BALL, undefined, 0, h.world.tick)]).toEqual([0, "soul ball, empty: click one of your tribe's tames to keep it"]);
  const came = ada.events.filter((ev) => ev.kind === EVENT_BALL);
  expect(came.map((ev) => ev.kill)).toEqual([false]);
  expect(Math.hypot(came[0]!.x - ents.x[body]!, came[0]!.z - ents.z[body]!)).toBeLessThan(1.5);
  expect(h.host.items.audit()).toEqual([]);
});

test("a ball's charge in words: whole units rounded down, and held at full in a burning vault", () => {
  const D = reg.spoilTicks[FULL]!;
  const at = (seconds: number): string => chargeWords(1000 + seconds * TICK_RATE, 1000);
  expect([at(30 * 86400), at(30 * 86400 - 1), at(2 * 86400), at(2 * 86400 - 1), at(7200), at(7199), at(120), at(119), at(1), at(0), at(-50)]).toEqual(["30 days left", "29 days left", "2 days left", "47 hours left", "2 hours left", "119 minutes left", "2 minutes left", "119 s left", "1 s left", "0 s left", "0 s left"]);
  expect([chargeWords(CHARGED, 5), chargeWords(5 + D, 5)]).toEqual(["held at full charge", "30 days left"]);
  // A tame without a name is called by its species, and a ball whose tame the client was not told of still says its charge.
  const raptor = id("raptor");
  expect([keptName(reg, { kind: raptor, level: 3, name: "" }), ballInfo(reg, FULL, { kind: raptor, level: 3, name: "" }, CHARGED, 0), ballInfo(reg, FULL, undefined, 1000 + 3 * 86400 * TICK_RATE, 1000)]).toEqual(["the raptor", "soul ball holds raptor, level 3; held at full charge", "soul ball holds a tame; 3 days left"]);
});

test("what it carries drops in a bag where it stood, and she is told", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  h.host.items.mint(rec, id("wood"), 40);
  h.host.items.mint(rec, id("meat_cooked"), 3);
  const where = { x: h.world.ents.x[e]!, z: h.world.ents.z[e]! };
  const from = ada.logVersion;
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  expect(rec.stored).toBeGreaterThan(0);
  const [bag] = bags(h);
  expect(bags(h).length).toBe(1);
  expect([h.host.items.inv(bag!).total(id("wood")), h.host.items.inv(bag!).total(id("meat_cooked")), rec.inv]).toEqual([40, 3, null]);
  expect(Math.hypot(bag!.x - where.x, bag!.z - where.z)).toBeLessThan(0.01);
  expect(notices(ada, from)).toEqual(["What it carried lies in a bag where it stood."]);
  // The saddle is not cargo: it is on the tame still.
  expect(rec.saddle).toBe(id("saddle_raptor"));
  expect(h.host.items.audit()).toEqual([]);
});

test("a full ball across a restart: no body in the world, the tame still in the ball, and loosed after it", () => {
  const dbPath = join(dir, "kept.db");
  let { h, ada, at, me, pilot } = pen({ dbPath });
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  const was = facts(rec);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const slot = h.host.items.inv(me).hotbar;
  const stored = rec.stored;
  const health = rec.vitals!.value[V_HEALTH]!;
  expect(stored).toBeGreaterThan(0);
  h.run(3000);
  h.host.shutdown();

  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  pilot = h.pilots[0]!;
  h.run(1000);
  const again = h.host.records.byPid.get(rec.pid)!;
  const mine = h.host.records.byPid.get(me.pid)!;
  const inv = h.host.items.inv(mine);
  expect([again.stored, h.host.records.entOf.has(again.pid), inv.item[slot], inv.refOf(slot), h.host.balls.mended, h.host.eggs.mended, h.host.items.audit()]).toEqual([stored, false, FULL, rec.pid, 0, 0, []]);
  expect(facts(again)).toEqual(was);
  // No body of that record's anywhere in the world.
  const ents = h.world.ents;
  let bodies = 0;
  for (let i = 0; i < ents.cap; i++) if ((ents.flags[i]! & F_ALIVE) !== 0 && ents.pid[i] === rec.pid) bodies++;
  expect(bodies).toBe(0);
  h.run(5000);
  expect(again.vitals!.value[V_HEALTH]).toBe(health);

  pilot.yaw = 0;
  pilot.pitch = -0.25;
  h.run(300);
  click(h, pilot);
  expect([again.stored, h.host.records.entOf.has(again.pid), inv.item[slot], inv.refOf(slot)]).toEqual([0, true, BALL, 0]);
  expect(facts(again)).toEqual(was);
  expect(h.host.items.audit()).toEqual([]);
  // And a restart with it out again finds one body and an empty ball.
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  h.join("ada");
  h.run(1000);
  expect([h.host.records.byPid.get(rec.pid)!.stored, h.host.records.entOf.has(rec.pid), h.host.balls.mended, h.host.items.audit()]).toEqual([0, true, 0, []]);
});

test("a ball does nothing to what is not hers to keep, and says why", () => {
  const { h, ada, at, me, pilot } = pen();
  const slot = h.host.items.inv(me).hotbar;
  const unchanged = () => expect([h.host.items.inv(me).item[slot], h.host.items.inv(me).refOf(slot), h.host.balls.kept]).toEqual([BALL, 0, 0]);
  // Nothing looked at.
  let from = ada.logVersion;
  pilot.pitch = 1.2;
  h.run(200);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["Look at one of your tribe's creatures, close by."]);
  unchanged();
  // A wild one.
  const wild = h.host.spawnCreature("core:raptor", at.x, at.z + 3, 5);
  h.host.records.byPid.get(h.world.ents.pid[wild]!)!.out = false;
  from = ada.logVersion;
  lookAt(h, ada, pilot, wild);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["Only one of your tribe's tamed creatures goes into a soul ball."]);
  expect(h.world.ents.flags[wild]! & F_ALIVE).toBe(F_ALIVE);
  unchanged();
  // Another tribe's.
  const bob = h.join("bob");
  h.run(500);
  const him = h.host.records.byPid.get(h.client(bob)!.pid)!;
  const rec = h.host.records.byPid.get(h.world.ents.pid[wild]!)!;
  h.host.taming.give(rec, him, 1);
  h.run(100);
  from = ada.logVersion;
  lookAt(h, ada, pilot, wild);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["That creature is not your tribe's."]);
  expect([h.host.records.entOf.has(rec.pid), rec.stored, rec.team]).toEqual([true, 0, him.team]);
  unchanged();
  // Hers, but knocked out; and hers, but too far.
  const { e, rec: own } = tame(h, me, at.x + 4, at.z + 3, "Far");
  own.out = true;
  from = ada.logVersion;
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["It must be awake to go into a soul ball."]);
  own.out = false;
  h.world.ents.setPosition(e, at.x - 8, h.world.ents.y[e]!, at.z + KEEP_REACH + 6);
  h.run(100);
  from = ada.logVersion;
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["Look at one of your tribe's creatures, close by."]);
  expect([h.host.records.entOf.has(own.pid), own.stored]).toEqual([true, 0]);
  unchanged();
  expect(h.world.ents.flags[e]! & (F_ALIVE | F_PROP)).toBe(F_ALIVE);
  expect(h.host.items.audit()).toEqual([]);
});

/** A structure of `kind` set down `dx` metres along from (x, z), with its record. */
function built(h: Harness, kind: number, x: number, y: number, z: number, team: number): { ref: number; rec: EntityRecord } {
  const ref = h.world.structs.add(kind, x, y + reg.halfY[kind]!, z, 0, team, reg.maxHp[kind]!);
  return { ref, rec: h.host.fixtures.ensure(ref) };
}
const kindOf = (h: Harness, ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;

/** Takes in hand what is in hotbar slot `n`, moving nothing. */
function select(h: Harness, s: ClientSession, n: number): void {
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(n));
  h.run(900);
}

function command(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(op, write);
  h.run(200);
  return code;
}

test("the ball's and the vault's numbers are ARK's cryopod's and cryofridge's", () => {
  const [VAULT, LIT, PIECE, GAS] = [id("soul_vault"), id("soul_vault_lit"), id("piece_soul_vault"), id("gasoline")];
  // Cryopod: weight 0.5, one to a slot, 30 days of charge; 10 crystal, 15 fiber, 5 hide, 2 ingots, 4 oil, 8 polymer.
  expect([reg.weight[BALL], reg.stack[BALL], reg.weight[FULL], reg.stack[FULL], reg.spoilTicks[BALL], reg.spoilTicks[FULL]! / TICK_RATE / 86400, reg.spoilsInto[FULL], reg.charge[FULL], reg.charge[BALL]]).toEqual([0.5, 1, 0.5, 1, 0, 30, BALL, 1, 0]);
  expect([[...reg.recipeOf[BALL]!], reg.craftAt[BALL], reg.recipeOf[FULL] ?? null]).toEqual([[id("crystal"), 10, id("fiber"), 15, id("hide"), 5, id("ingot"), 2, id("oil"), 4, id("polymer"), 8], id("fabricator"), null]);
  expect([reg.ballFull[BALL], reg.ballEmpty[FULL], reg.ballFull[FULL], reg.ballEmpty[BALL]]).toEqual([FULL, BALL, 0, 0]);
  // Cryofridge: 72 slots, 20,000 health; only burning does it hold a charge, and it keeps food no longer than a box.
  expect([reg.structSlots[VAULT], reg.maxHp[VAULT], reg.structSlots[LIT], reg.lights[VAULT], reg.lights[LIT], reg.charges[VAULT], reg.charges[LIT], reg.keeps[VAULT], reg.keeps[LIT]]).toEqual([72, 20000, 72, LIT, VAULT, 0, 1, 1, 1]);
  expect([reg.stationFuel[VAULT]![GAS], [...reg.places[PIECE]!], [...reg.recipeOf[PIECE]!]]).toEqual([3600 * TICK_RATE, [VAULT], [id("crystal"), 25, id("polymer"), 60, id("ingot"), 240, id("silica_pearls"), 45]]);
  const engram = (name: string) => reg.defs[id(name)] as { level: number; cost: number };
  expect([engram("engram-soul_ball").level, engram("engram-soul_ball").cost, engram("engram-piece_soul_vault").level, engram("engram-piece_soul_vault").cost]).toEqual([51, 20, 88, 60]);
});

test("a burning vault holds a full ball at full charge; out, or taken out, it runs down from full; a preserving bin does nothing for it", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const items = h.host.items;
  const slot = items.inv(me).hotbar;
  const D = reg.spoilTicks[FULL]!;
  const keptAt = rec.stored;
  expect(items.inv(me).spoilAt[slot]).toBe(keptAt + D);
  const [VAULT, LIT, GAS, BIN, SPARK] = [id("soul_vault"), id("soul_vault_lit"), id("gasoline"), id("preserving_bin"), id("sparkpowder")];
  const vault = built(h, VAULT, at.x + 3, at.y, at.z, me.team);
  const bin = built(h, BIN, at.x - 3, at.y, at.z, me.team);
  const where = (r: EntityRecord): number => items.inv(r).item.indexOf(FULL);
  const clock = (r: EntityRecord): number => items.inv(r).spoilAt[where(r)]!;
  try {
    // A lit bin keeps food ten times as long. A ball's charge is not food: in and out again, it has the time it had.
    items.mint(bin.rec, SPARK, 1);
    expect(h.host.stations.toggle(bin.ref)).toBe(RESULT_OK);
    h.world.tick += 500;
    expect(items.move(me, slot, bin.rec, 0, 1)).toBe(1);
    expect([clock(bin.rec), items.inv(bin.rec).refOf(0)]).toEqual([keptAt + D, rec.pid]);
    h.world.tick += 500;
    expect(items.move(bin.rec, 0, me, slot, 1)).toBe(1);
    expect([clock(me), items.inv(me).refOf(slot)]).toEqual([keptAt + D, rec.pid]);

    // A vault that is out is a box.
    expect(items.move(me, slot, vault.rec, 0, 1)).toBe(1);
    expect(clock(vault.rec)).toBe(keptAt + D);
    // Lit, it holds what is in it at full charge from that tick, and what is put in it while it burns.
    items.mint(vault.rec, GAS, 1);
    expect(h.host.stations.toggle(vault.ref)).toBe(RESULT_OK);
    const L = h.world.tick;
    expect([kindOf(h, vault.ref), clock(vault.rec)]).toEqual([LIT, CHARGED]);
    h.world.tick += 40000;
    expect([clock(vault.rec), rec.stored, h.host.records.byPid.has(rec.pid)]).toEqual([CHARGED, keptAt, true]);
    // Taken out while it burns, it is full from then.
    const T = h.world.tick;
    expect(items.move(vault.rec, where(vault.rec), me, slot, 1)).toBe(1);
    expect(clock(me)).toBe(T + D);
    h.world.tick += 100;
    expect(items.move(me, slot, vault.rec, 0, 1)).toBe(1);
    expect(clock(vault.rec)).toBe(CHARGED);
    // Its one gasoline burns an hour. Nobody looks when it goes out, and looked at long after, the ball has run down from
    // full since the tick it did.
    const O = L + 3600 * TICK_RATE;
    h.world.tick = O + 250000;
    expect([clock(vault.rec), kindOf(h, vault.ref), vault.rec.fire]).toEqual([O + D, VAULT, null]);
    // And it ends there, thirty days after the vault went out: at the tick before the tame is kept still.
    h.world.tick = O + D - 1;
    expect([items.inv(vault.rec).item[where(vault.rec)], h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([FULL, true, 0]);
    h.world.tick = O + D;
    const inv = items.inv(vault.rec);
    expect([inv.item.indexOf(FULL), inv.total(BALL), h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([-1, 1, false, 1]);
    expect(inv.refOf(inv.item.indexOf(BALL))).toBe(0);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("when its charge is gone the tame is lost, its tribe is told, and the ball is an empty one again", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const inv = h.host.items.inv(me);
  const slot = inv.hotbar;
  expect([inv.item[slot], rec.stored > 0]).toEqual([FULL, true]);
  // Its charge is set to end three seconds on, as thirty days from the keeping would.
  inv.spoilAt[slot] = h.world.tick + 3 * TICK_RATE;
  const from = ada.logVersion;
  h.run(2000);
  expect([h.host.items.inv(me).item[slot], h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([FULL, true, 0]);
  h.run(2000);
  // The empty ball it leaves is in her bag, as what food spoils into is.
  const now = h.host.items.inv(me);
  const left = now.item.indexOf(BALL);
  expect([now.item[slot], now.total(FULL), now.total(BALL), now.refOf(left), now.spoilAt[left], h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([0, 0, 1, 0, 0, false, 1]);
  h.run(300);
  expect(notices(ada, from)).toEqual(["Bitey was lost with the soul ball that held it."]);
  expect(ada.inventory!.item[left]).toBe(BALL);
  expect(h.host.items.audit()).toEqual([]);
  // The empty ball keeps another.
  const next = tame(h, me, at.x, at.z + 3, "Second");
  const hand = takeInHand(h, ada, BALL);
  h.run(700);
  lookAt(h, ada, pilot, next.e);
  click(h, pilot);
  expect([now.item[hand], now.refOf(hand), next.rec.stored > 0]).toEqual([FULL, next.rec.pid, true]);
  h.host.shutdown();
});

test("loosed within five minutes of the last, a tame is ball sick on PvP; on PvE only where the server says", () => {
  const { h, ada, at, me, pilot } = pen({}, 2);
  const [CHILL, SICKNESS] = [id("ball_chill"), id("ball_sick")];
  const a = tame(h, me, at.x - 1.5, at.z + 3, "First");
  const b = tame(h, me, at.x + 1.5, at.z + 3, "Second");
  const hotbar = h.host.items.inv(me).hotbar;
  // The two balls lie in the first two hotbar slots throughout: the first takes `a`, the second `b`.
  const second = h.host.items.inv(me).item.findIndex((it, k) => it === BALL && k !== hotbar);
  expect(second).toBeGreaterThanOrEqual(0);
  expect(h.host.items.move(me, second, me, hotbar + 1, 1)).toBe(1);
  h.run(300);
  const keepBoth = (): void => {
    select(h, ada, 0);
    lookAt(h, ada, pilot, h.host.records.entOf.get(a.rec.pid)!);
    click(h, pilot);
    select(h, ada, 1);
    lookAt(h, ada, pilot, h.host.records.entOf.get(b.rec.pid)!);
    click(h, pilot);
    expect([a.rec.stored > 0, b.rec.stored > 0, h.host.items.inv(me).refOf(hotbar), h.host.items.inv(me).refOf(hotbar + 1)]).toEqual([true, true, a.rec.pid, b.rec.pid]);
  };
  const looseAt = (n: number, yaw: number): void => {
    select(h, ada, n);
    pilot.yaw = yaw;
    pilot.pitch = -0.3;
    h.run(200);
    click(h, pilot);
  };
  keepBoth();
  const buffs = h.host.buffs;
  // The first loosed is well, and she is chilled. The second, within the chill, is sick: out cold and taking ten times.
  looseAt(1, 0.4);
  expect([b.rec.stored, buffs.has(b.rec, SICKNESS), b.rec.out, buffs.has(me, CHILL), h.host.balls.sickened]).toEqual([0, false, false, true, 0]);
  looseAt(0, -0.4);
  expect([a.rec.stored, buffs.has(a.rec, SICKNESS), a.rec.out, buffs.has(me, CHILL), h.host.balls.sickened]).toEqual([0, true, true, true, 1]);
  expect(a.rec.vitals!.value[V_TORPOR]).toBe(a.rec.vitals!.max[V_TORPOR]!);
  expect((reg.defs[SICKNESS] as { taken?: number }).taken).toBe(10);
  // Sick, it is not kept again.
  select(h, ada, 0);
  const from = ada.logVersion;
  lookAt(h, ada, pilot, h.host.records.entOf.get(a.rec.pid)!);
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["It is ball sick, and cannot be kept again until that has passed."]);
  expect(a.rec.stored).toBe(0);
  // Five minutes on both have passed, and it wakes in its own time.
  h.run(301000);
  expect([buffs.has(a.rec, SICKNESS), buffs.has(me, CHILL)]).toEqual([false, false]);
  a.rec.vitals!.rebase(h.world.tick);
  a.rec.vitals!.value[V_TORPOR] = 0;
  h.host.survival.add(a.rec, V_TORPOR, 0);
  h.run(500);
  expect(a.rec.out).toBe(false);

  // On PvE neither is given.
  h.say(ada, "setting serverPVE true");
  keepBoth();
  looseAt(1, 0.4);
  looseAt(0, -0.4);
  expect([a.rec.stored, b.rec.stored, buffs.has(a.rec, SICKNESS), a.rec.out, buffs.has(me, CHILL), h.host.balls.sickened]).toEqual([0, 0, false, false, false, 1]);
  // Unless the server says so.
  h.say(ada, "setting EnableCryoSicknessPVE true");
  keepBoth();
  looseAt(1, 0.4);
  looseAt(0, -0.4);
  expect([buffs.has(b.rec, SICKNESS), buffs.has(a.rec, SICKNESS), a.rec.out, buffs.has(me, CHILL), h.host.balls.sickened]).toEqual([false, true, true, true, 2]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a saddled tame saved ball sick is there, sick and saddled, when the server starts again", () => {
  // The start used to stop here: a buff restored at load refreshes its body, and a saddled creature's refresh used what
  // the host had not yet made. Any buff on a saddled tame did it; ball sickness made it common.
  const dbPath = join(dir, "sick.db");
  let { h, ada, at, me, pilot } = pen({ dbPath });
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  const SICKNESS = id("ball_sick");
  const turn = (): void => {
    lookAt(h, ada, pilot, h.host.records.entOf.get(rec.pid) ?? e);
    click(h, pilot);
    pilot.yaw = 0;
    pilot.pitch = -0.3;
    h.run(200);
    click(h, pilot);
  };
  turn();
  expect([rec.stored, h.host.buffs.has(rec, SICKNESS)]).toEqual([0, false]);
  // Awake it is kept again, and loosed within the chill.
  turn();
  expect([rec.stored, h.host.buffs.has(rec, SICKNESS), rec.out, rec.saddle]).toEqual([0, true, true, id("saddle_raptor")]);
  const until = rec.buffs.find((b) => b.buff === SICKNESS)!.until;
  h.run(1000);
  h.host.shutdown();

  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  h.run(1000);
  const again = h.host.records.byPid.get(rec.pid)!;
  expect([h.host.records.entOf.has(again.pid), again.stored, h.host.buffs.has(again, SICKNESS), again.buffs.find((b) => b.buff === SICKNESS)?.until, again.saddle, again.out]).toEqual([true, 0, true, until, id("saddle_raptor"), true]);
  expect([h.host.balls.mended, h.host.items.audit()]).toEqual([0, []]);
  h.host.shutdown();
});

test("whoever looses it has it; and a tribe's limit is met when a tame comes out, not while it is kept", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const slot = h.host.items.inv(me).hotbar;
  expect(rec.stored).toBeGreaterThan(0);
  // With one tame the most a tribe may have, she tames another while the first is kept: it does not count.
  h.say(ada, "setting MaxPersonalTamedDinos 1");
  expect(h.host.taming.full(me.team)).toBe("");
  const other = tame(h, me, at.x + 6, at.z - 4, "Other");
  expect(h.host.taming.full(me.team)).not.toBe("");
  // The first does not come out over the limit, and the ball is as it was.
  pilot.yaw = 0;
  pilot.pitch = -0.3;
  h.run(200);
  let from = ada.logVersion;
  click(h, pilot);
  expect(notices(ada, from)).toEqual(["Your tribe has as many tamed creatures as it may (1)."]);
  expect([rec.stored > 0, h.host.records.entOf.has(rec.pid), h.host.items.inv(me).item[slot], h.host.items.inv(me).refOf(slot), h.host.balls.loosed]).toEqual([true, false, FULL, rec.pid, 0]);

  // Bob, of another tribe, is handed the full ball, and looses it: it is his.
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x - 6).toFixed(3)} ${at.z.toFixed(3)}`);
  const him = h.host.records.byPid.get(h.client(bob)!.pid)!;
  expect(him.team).not.toBe(me.team);
  expect(h.host.items.give(me, him, FULL, 1)).toBe(true);
  expect(h.host.items.inv(him).refOf(h.host.items.inv(him).item.indexOf(FULL))).toBe(rec.pid);
  h.run(300);
  const his = takeInHand(h, bob, FULL);
  h.run(700);
  const bobs = h.pilots[1]!;
  bobs.yaw = Math.PI;
  bobs.pitch = -0.3;
  h.run(200);
  from = bob.logVersion;
  click(h, bobs);
  const body = h.host.records.entOf.get(rec.pid)!;
  expect([rec.stored, rec.team, h.world.ents.team[body], rec.follow, h.host.items.inv(him).item[his], h.host.items.inv(him).refOf(his), h.host.balls.loosed]).toEqual([0, him.team, him.team, 0, BALL, 0, 1]);
  expect(rec.saddle).toBe(id("saddle_raptor"));
  expect(other.rec.team).toBe(me.team);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a modified client cannot reach a kept tame by its old handle, nor click a ball it does not hold", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 2.5);
  h.host.items.mint(rec, id("wood"), 5);
  // She has its inventory open as it goes in: it is closed for her.
  lookAt(h, ada, pilot, e);
  expect(command(h, ada, CMD_OPEN, (w) => w.u32(e))).toBe(RESULT_OK);
  expect(h.client(ada)!.open).toBe(rec.pid);
  click(h, pilot);
  expect([rec.stored > 0, h.client(ada)!.open]).toEqual([true, 0]);
  const slot = h.host.items.inv(me).hotbar;
  // Its body's old handle opens nothing, takes no order, no name and no arms, and nothing is fed from what was open.
  for (let k = 0; k < 3; k++) {
    expect(command(h, ada, CMD_OPEN, (w) => w.u32(e))).not.toBe(RESULT_OK);
    expect(command(h, ada, CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_FOLLOW)))).not.toBe(RESULT_OK);
    expect(command(h, ada, CMD_NAME, (w) => (w.u32(e), w.string("Mine")))).not.toBe(RESULT_OK);
    expect(command(h, ada, CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(e)))).not.toBe(RESULT_OK);
    expect(command(h, ada, CMD_FEED, (w) => (w.varint(0), w.u16(id("wood"))))).not.toBe(RESULT_OK);
  }
  expect([h.client(ada)!.open, rec.stored > 0, rec.follow, rec.name, h.host.records.entOf.has(rec.pid), rec.inv]).toEqual([0, true, 0, "Bitey", false, null]);
  // A move into the box she had open goes nowhere.
  expect(
    command(h, ada, CMD_MOVE, (w) => {
      w.bits(BOX_SELF, 1);
      w.varint(slot);
      w.bits(BOX_OPEN, 1);
      w.varint(0);
      w.u16(0);
      w.u16(FULL);
    }),
  ).not.toBe(RESULT_OK);
  expect([h.host.items.inv(me).item[slot], h.host.items.inv(me).refOf(slot)]).toEqual([FULL, rec.pid]);
  // The full ball cannot be eaten, split or stacked, and its tame is not doubled by trying.
  expect(command(h, ada, CMD_USE, (w) => (w.varint(slot), w.u16(FULL)))).not.toBe(RESULT_OK);
  expect([h.host.items.inv(me).item[slot], h.host.items.inv(me).refOf(slot), h.host.records.byPid.get(rec.pid)]).toEqual([FULL, rec.pid, rec]);
  // Held down, the button looses once and then keeps the same tame again at most: there is never a second.
  pilot.yaw = 0;
  pilot.pitch = -0.3;
  pilot.buttons |= 4;
  h.run(4000);
  pilot.buttons &= ~4;
  h.run(500);
  const ents = h.world.ents;
  let bodies = 0;
  for (let i = 0; i < ents.cap; i++) if ((ents.flags[i]! & F_ALIVE) !== 0 && ents.pid[i] === rec.pid) bodies++;
  const inv = h.host.items.inv(me);
  expect(bodies + (inv.refOf(slot) === rec.pid ? 1 : 0)).toBe(1);
  expect((rec.stored !== 0) === (inv.item[slot] === FULL)).toBe(true);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a session is told what a ball holds in its own inventory and in the box it has open, and no other session is", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  const bob = h.join("bob");
  h.run(500);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const slot = h.host.items.inv(me).hotbar;
  const told = { kind: rec.kind, level: rec.genome!.level, name: "Bitey" };
  expect([[...ada.kept[0]], [...ada.kept[1]], bob.kept[0].size, bob.kept[1].size]).toEqual([[[slot, told]], [], 0, 0]);
  // Bob stood near, and saw it go.
  expect(bob.events.filter((ev) => ev.kind === EVENT_BALL).length).toBe(1);
  // Put in a vault she has open, it is told of there, and follows the ball from slot to slot.
  const vault = built(h, id("soul_vault"), at.x + 1.5, at.y, at.z, me.team);
  expect(command(h, ada, CMD_STRUCT, (w) => (w.u32(vault.ref), w.u8(STRUCT_USE), w.u16(NO_PIN)))).toBe(RESULT_OK);
  expect(h.client(ada)!.open).toBe(vault.rec.pid);
  const move = (fromBox: number, from: number, toBox: number, to: number): number =>
    command(h, ada, CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.varint(from);
      w.bits(toBox, 1);
      w.varint(to);
      w.u16(0);
      w.u16(FULL);
    });
  expect(move(BOX_SELF, slot, BOX_OPEN, 3)).toBe(RESULT_OK);
  expect([[...ada.kept[0]], [...ada.kept[1]], h.host.items.inv(vault.rec).refOf(3)]).toEqual([[], [[3, told]], rec.pid]);
  expect(move(BOX_OPEN, 3, BOX_OPEN, 40)).toBe(RESULT_OK);
  expect([...ada.kept[1]]).toEqual([[40, told]]);
  expect(bob.kept[0].size + bob.kept[1].size).toBe(0);
  // Closed, her client forgets it; opened again, it is told again.
  expect(command(h, ada, CMD_CLOSE, () => {})).toBe(RESULT_OK);
  expect(ada.kept[1].size).toBe(0);
  expect(command(h, ada, CMD_STRUCT, (w) => (w.u32(vault.ref), w.u8(STRUCT_USE), w.u16(NO_PIN)))).toBe(RESULT_OK);
  expect([...ada.kept[1]]).toEqual([[40, told]]);
  // Taken back, it is in her own again.
  expect(move(BOX_OPEN, 40, BOX_SELF, slot)).toBe(RESULT_OK);
  expect([[...ada.kept[0]], [...ada.kept[1]], h.host.items.audit()]).toEqual([[[slot, told]], [], []]);
  h.host.shutdown();
});

test("a full ball dropped lies in a bag with its tame in it; left until the bag is gone, the tame is lost with it", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const slot = h.host.items.inv(me).hotbar;
  const clock = h.host.items.inv(me).spoilAt[slot]!;
  expect(command(h, ada, CMD_DROP, (w) => (w.varint(slot), w.u16(0), w.u16(FULL)))).toBe(RESULT_OK);
  const [bag] = bags(h);
  const inside = h.host.items.inv(bag!);
  expect([inside.item[0], inside.refOf(0), inside.spoilAt[0], h.host.items.inv(me).item[slot], rec.stored > 0, h.host.records.entOf.has(rec.pid)]).toEqual([FULL, rec.pid, clock, 0, true, false]);
  // Taken up again it is the same ball, and looses the same tame.
  expect(h.host.items.move(bag!, 0, me, slot, 1)).toBe(1);
  pilot.yaw = 0;
  pilot.pitch = -0.3;
  h.run(300);
  click(h, pilot);
  expect([rec.stored, h.host.records.entOf.has(rec.pid), h.host.items.inv(me).item[slot]]).toEqual([0, true, BALL]);

  // Kept again and dropped, and the bag left its two minutes.
  lookAt(h, ada, pilot, h.host.records.entOf.get(rec.pid)!);
  click(h, pilot);
  expect(rec.stored).toBeGreaterThan(0);
  expect(command(h, ada, CMD_DROP, (w) => (w.varint(slot), w.u16(0), w.u16(FULL)))).toBe(RESULT_OK);
  const from = ada.logVersion;
  h.run((BAG_TICKS / TICK_RATE) * 1000 + 3000);
  expect([bags(h).length, h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([0, false, 1]);
  expect(notices(ada, from)).toEqual(["Bitey was lost with the soul ball that held it."]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a full ball on a survivor who dies lies in her cache with its tame in it, and is lost with the cache if nobody comes", () => {
  const { h, ada, at, me, pilot } = pen();
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  expect(rec.stored).toBeGreaterThan(0);
  const clock = h.host.items.inv(me).spoilAt[h.host.items.inv(me).hotbar]!;
  h.host.death.die(me, 1);
  h.run(300);
  const caches = (): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === id("cache"));
  const [cache] = caches();
  const inside = h.host.items.inv(cache!);
  const slot = inside.item.indexOf(FULL);
  // What she carried is in the cache: the ball names its tame still, with the charge it had, and the tame is kept still.
  expect([slot >= 0, inside.refOf(slot), inside.spoilAt[slot], h.host.items.inv(me).total(FULL), rec.stored > 0, h.host.records.byPid.has(rec.pid)]).toEqual([true, rec.pid, clock, 0, true, true]);
  expect(h.host.items.audit()).toEqual([]);
  // Nobody comes for it in the cache's fifteen minutes.
  const from = ada.logVersion;
  h.world.tick += CACHE_TICKS;
  h.run(2000);
  expect([caches().length, h.host.records.byPid.has(rec.pid), h.host.balls.lost]).toEqual([0, false, 1]);
  expect(notices(ada, from)).toContain("Bitey was lost with the soul ball that held it.");
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a load puts right a full ball that names no kept tame, and a kept tame no ball names: an empty ball, and the tame back where it was kept", () => {
  const dbPath = join(dir, "mended.db");
  let { h, ada, at, me, pilot } = pen({ dbPath });
  const { e, rec } = tame(h, me, at.x, at.z + 3);
  const stood = { x: h.world.ents.x[e]!, z: h.world.ents.z[e]! };
  lookAt(h, ada, pilot, e);
  click(h, pilot);
  const slot = h.host.items.inv(me).hotbar;
  expect(rec.stored).toBeGreaterThan(0);
  // As if a save had been cut between the two: the ball names nothing.
  h.host.items.inv(me).setRef(slot, 0);
  h.host.records.dirty.add(me.pid);
  h.run(500);
  h.host.shutdown();

  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  h.run(1000);
  const again = h.host.records.byPid.get(rec.pid)!;
  const inv = h.host.items.inv(h.host.records.byPid.get(me.pid)!);
  const body = h.host.records.entOf.get(rec.pid)!;
  // The ball is an empty one, and the tame stands where it was kept: nothing is lost and nothing is doubled.
  expect([inv.item[slot], inv.refOf(slot), again.stored, body >= 0, h.host.balls.mended, h.host.items.audit()]).toEqual([BALL, 0, 0, true, 2, []]);
  expect(Math.hypot(h.world.ents.x[body]! - stood.x, h.world.ents.z[body]! - stood.z)).toBeLessThan(2);
  expect([again.saddle, again.name, again.team]).toEqual([id("saddle_raptor"), "Bitey", me.team]);
  h.host.shutdown();
});

async function runUntilKilled(db: string, seed: number, minAcks: number): Promise<void> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/crash-child.ts"), db, String(seed), "balls"], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  let killed = false;
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (!killed && text.split("acked").length > minAcks) {
      proc.kill(9);
      killed = true;
    }
  }
  await proc.exited;
}

test("a tame is neither lost nor doubled by a process killed at any moment: kept, loosed, passed on in its ball, and lost with a ball destroyed", async () => {
  const db = join(dir, "killed.db");
  const ops = new Map<number, number>();
  let broken = 0;
  for (const [seed, minAcks] of [[31, 50], [32, 80], [33, 40], [34, 65]] as const) {
    await runUntilKilled(db, seed, minAcks);
    // Loading audits the ledger and checks each ball against each kept tame: there must be nothing to put right.
    const host = createHost(reg, { dbPath: db });
    expect([host.items.audit(), host.balls.mended, host.eggs.mended]).toEqual([[], 0, 0]);
    // What a full ball names, and how often.
    const named = new Map<number, number>();
    let balls = 0;
    for (const rec of host.records.byPid.values()) {
      for (let s = 0; rec.inv && s < rec.inv.cap; s++) {
        if (rec.inv.item[s] === BALL) balls++;
        if (rec.inv.item[s] !== FULL) continue;
        balls++;
        named.set(rec.inv.refOf(s), (named.get(rec.inv.refOf(s)) ?? 0) + 1);
      }
    }
    // The twelve balls are all there, full or empty.
    expect(balls).toBe(12);
    const tames = [...host.records.byPid.values()].filter((r) => r.kind === id("raptor"));
    for (const t of tames) {
      // One tame is in the world or in one ball, never both and never neither; and it has its saddle and its name.
      const bodied = host.records.entOf.has(t.pid);
      expect([t.name, bodied ? 1 : 0, named.get(t.pid) ?? 0, t.stored !== 0]).toEqual([t.name, bodied ? 1 : 0, bodied ? 0 : 1, !bodied]);
      expect([t.saddle, t.name.startsWith("tame"), t.team !== 0]).toEqual([id("saddle_raptor"), true, true]);
      // What a kept one carried was dropped as it went in, and it carries nothing in the ball.
      if (!bodied) expect(t.inv?.used() ?? 0).toBe(0);
    }
    // No ball names what is not a kept tame.
    for (const ref of named.keys()) expect(tames.some((t) => t.pid === ref && t.stored !== 0)).toBe(true);
    for (const j of host.persistence!.store.journal()) ops.set(j.op, (ops.get(j.op) ?? 0) + 1);
    // Tames are lost only with a ball destroyed: each name is there once, or was in a ball that was.
    expect(new Set(tames.map((t) => t.name)).size).toBe(tames.length);
    broken = BALL_TAMES - tames.length;
    expect(broken).toBeGreaterThanOrEqual(0);
    host.shutdown();
  }
  // Each kind of step was taken, the common ones many times; and no more tames are gone than balls were destroyed.
  for (const op of [OP_KEEP, OP_LOOSE]) expect([op, (ops.get(op) ?? 0) > 10]).toEqual([op, true]);
  expect((ops.get(OP_PASS) ?? 0) > 0).toBe(true);
  expect(broken).toBeLessThanOrEqual(ops.get(OP_BREAK) ?? 0);
});
