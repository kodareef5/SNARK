// A loadout's tame (server/loadout/tame.ts): a creature made at its level and handed over in a full soul ball. It is a
// tame as any other from then on: counted, mated, unsaddled, kept in any ball, killed for a body, and lost with its ball.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { HostOptions } from "../../server/host.ts";
import { NOT_A_CREATURE, giveTame } from "../../server/loadout/tame.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { Loadout, LoadoutBook, TameEntry } from "../../shared/loadout/book.ts";
import { CMD_DROP, CMD_ORDER, CMD_RESPAWN, ORDER_MATE, ORDER_UNSADDLE, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_PRIMARY, BTN_USE, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS } from "../../shared/sim/items.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { send } from "../kit/kit.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const BALL = id("soul_ball");
const FULL = id("soul_ball_full");
const PTERANODON = id("pteranodon");
const SADDLE = id("saddle_pteranodon");
const dir = mkdtempSync(join(tmpdir(), "snark-loadout-tame-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Pilot = Harness["pilots"][number];
const MOUNT: TameEntry = { tame: "core:pteranodon", level: 240, saddled: true, place: "hotbar" };
const loadout = (entries: Loadout["entries"]): Loadout => ({ id: "one", label: "one", note: "", respawn: false, entries });
const scout = (book: LoadoutBook): void => void (book.assign.player = "scout");

/** The book in force with `change` made to it, saved as its next revision. */
function edit(h: Harness, change: (book: LoadoutBook) => void): void {
  const store = h.host.loadoutBook;
  const next = JSON.parse(JSON.stringify(store.book)) as LoadoutBook;
  const revision = store.book.revision;
  change(next);
  expect(store.save(next, revision, "test", "")).toEqual({ ok: true, revision: revision + 1 });
}

/**
 * Ada, joined as a player of a server whose book `change` has made, then with cheats on level ground, facing up it. A
 * server that starts on a save keeps the book that save's world had.
 */
function setup(change: (book: LoadoutBook) => void = scout, host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  if (h.host.loadoutBook.builtin) edit(h, change);
  const s = h.join("ada");
  h.run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.say(s, "enablecheats");
  const g = flatGround(h, 60, 40);
  const at = { x: g.x + 30, z: g.z + 8 };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  pilot.yaw = 0;
  pilot.pitch = 0;
  return { h, s, me, at, pilot, inv: () => h.host.items.inv(me), hotbar: h.host.items.inv(me).hotbar };
}

/** Every pteranodon the world's records hold, in the world or kept. */
const mounts = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === PTERANODON);
const notices = (s: ClientSession, from: number): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text);

/** One click: the button down long enough for the throw's strike, and let go. */
function click(h: Harness, pilot: Pilot): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(300);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(400);
}

/** Takes a full ball in hand, in hotbar place `place`, and clicks a little way up the ground. Returns the body of `p`, or -1. */
function loose(h: Harness, s: ClientSession, pilot: Pilot, p: EntityRecord, place = 0): number {
  takeInHand(h, s, FULL, place);
  h.run(700);
  pilot.yaw = 0;
  pilot.pitch = -0.25;
  h.run(200);
  click(h, pilot);
  return h.host.records.entOf.get(p.pid) ?? -1;
}

/** Stands her beside the body `e`, looking at it. */
function beside(h: Harness, s: ClientSession, pilot: Pilot, e: number): void {
  const ents = h.world.ents;
  h.say(s, `tp ${(ents.x[e]! - 2.5).toFixed(3)} ${ents.z[e]!.toFixed(3)}`);
  pilot.yaw = Math.PI / 2;
  pilot.pitch = -0.1;
  h.run(200);
}

test("a tame entry is a full soul ball naming a kept tame of its level", () => {
  const { h, s, me, inv, hotbar } = setup();
  const own = inv();
  const [p] = mounts(h);
  // The ball is on her hotbar, unmarked, its charge running as any full ball's, and it names the tame.
  const charge = own.spoilAt[hotbar]! - h.world.tick;
  expect([own.item[hotbar], own.flags[hotbar], own.refOf(hotbar), mounts(h).length]).toEqual([FULL, 0, p!.pid, 1]);
  expect([charge > 29 * 86400 * TICK_RATE, charge <= 30 * 86400 * TICK_RATE]).toEqual([true, true]);
  // The tame is of exactly its level, tamed as a forced tame is, saddled and hers, with no body until she lets it out.
  expect([p!.genome!.level, p!.te, p!.saddle, p!.team, p!.stored > 0, p!.vitals, h.host.records.entOf.has(p!.pid)]).toEqual([240, 0, SADDLE, me.team, true, null, false]);
  // Her client is told what the ball holds. Kept, it counts against no tame limit, and the books balance.
  expect([...s.kept[0]]).toEqual([[hotbar, { kind: PTERANODON, level: 240, name: "" }]]);
  expect([h.host.taming.count(me.team).ours, h.host.items.total(FULL), h.host.items.audit()]).toEqual([0, 1, []]);

  // Asked for the bag it lies there, and so does one that finds the hotbar full; unsaddled, it wears nothing.
  const bagged = h.host.loadouts.give(me, loadout([{ tame: "core:raptor", level: 7, saddled: false, place: "bag" }]), { tames: true });
  const raptor = [...h.host.records.byPid.values()].find((r) => r.kind === id("raptor"))!;
  expect([bagged, own.item[0], own.refOf(0), raptor.genome!.level, raptor.saddle]).toEqual([{ given: ["raptor 7"], missed: [] }, FULL, raptor.pid, 7, 0]);
  for (let k = 1; k < HOTBAR_SLOTS; k++) expect([h.host.items.mint(me, id("spear"), 1), h.host.items.move(me, 1, me, hotbar + k, 0)]).toEqual([1, 1]);
  expect(h.host.loadouts.give(me, loadout([MOUNT]), { tames: true }).missed).toEqual([]);
  expect([own.item[1], mounts(h).length, h.host.items.audit()]).toEqual([FULL, 2, []]);
  h.host.shutdown();
});

test("loosed, it is the tribe's and saddled, and counts against the tame limit", () => {
  const { h, s, me, pilot, inv, hotbar } = setup();
  const [p] = mounts(h);
  const e = loose(h, s, pilot, p!);
  const ents = h.world.ents;
  expect(e).toBeGreaterThanOrEqual(0);
  // Out a few metres up the ground, hers, and the ball in her hand is an empty one.
  expect([ents.team[e], p!.team, p!.stored, p!.saddle, inv().item[hotbar], inv().refOf(hotbar)]).toEqual([me.team, me.team, 0, SADDLE, BALL, 0]);
  // Its first body is rested and whole, whatever its level makes its most.
  expect(ents.staminaMax[e]).toBeGreaterThan(100);
  expect([ents.stamina[e], p!.vitals!.value[V_HEALTH]]).toEqual([ents.staminaMax[e]! * STAMINA_UNITS, p!.vitals!.max[V_HEALTH]!]);
  // She gets on it by its saddle.
  beside(h, s, pilot, e);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(400);
  expect(s.driving).toBe(e);
  beside(h, s, pilot, e);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(600);
  expect(s.driving).toBe(-1);

  // It is one of the tribe's tames to the limit: with one the most, a second stays in its ball.
  expect([h.host.taming.count(me.team).ours, h.host.setSetting("MaxPersonalTamedDinos", "1")]).toEqual([1, ""]);
  expect(h.host.loadouts.give(me, loadout([MOUNT]), { tames: true }).given).toEqual(["pteranodon 240"]);
  const second = mounts(h).find((r) => r !== p)!;
  h.run(300);
  const from = s.logVersion;
  expect(loose(h, s, pilot, second, 1)).toBe(-1);
  expect(notices(s, from)).toEqual(["Your tribe has as many tamed creatures as it may (1)."]);
  expect([second.stored > 0, inv().refOf(hotbar + 1), h.host.items.audit()]).toEqual([true, second.pid, []]);
  h.host.shutdown();
});

test("it mates, gives up its saddle and goes into any ball", () => {
  const { h, s, me, pilot, inv } = setup();
  const items = h.host.items;
  const [p] = mounts(h);
  const e = loose(h, s, pilot, p!);
  beside(h, s, pilot, e);
  const order = (what: number): number => send(h, s, CMD_ORDER, (w) => (w.u32(e), w.u8(what)));
  expect([order(ORDER_MATE), p!.mating]).toEqual([RESULT_OK, true]);
  // The saddle comes off into what it carries, and is an item in the ledger from then.
  expect([order(ORDER_UNSADDLE), p!.saddle, items.inv(p!).total(SADDLE), items.minted[SADDLE]]).toEqual([RESULT_OK, 0, 1, 1]);
  // A ball she was given some other way takes it, as it takes any tame of hers.
  expect(items.mint(me, BALL, 1)).toBe(1);
  const other = inv().item.indexOf(BALL);
  expect(other).toBeLessThan(inv().bag);
  expect([h.host.balls.keepIn(me, other, e), p!.stored > 0, inv().item[other], inv().refOf(other), h.host.records.entOf.has(p!.pid)]).toEqual(["", true, FULL, p!.pid, false]);
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
});

test("killed, it leaves a body and its killer gains experience", () => {
  const { h, s, pilot } = setup();
  const [p] = mounts(h);
  expect(loose(h, s, pilot, p!)).toBeGreaterThanOrEqual(0);
  const bo = h.join("bo");
  h.run(500);
  const killer = h.host.records.byPid.get(h.client(bo)!.pid)!;
  const xp = killer.xp;
  h.host.survival.hurt(p!, 1e9, killer.pid);
  h.run(300);
  const bodies = [...h.host.records.byPid.values()].filter((r) => r.kind === id("corpse") && r.corpse?.species === PTERANODON);
  expect([h.host.records.byPid.has(p!.pid), bodies.length, killer.xp > xp, h.host.items.audit()]).toEqual([false, 1, true, []]);
  h.host.shutdown();
});

test("its ball is dropped and given as any, and the tame is lost with it", () => {
  const { h, s, me, inv, hotbar } = setup();
  const items = h.host.items;
  const [p] = mounts(h);
  expect(send(h, s, CMD_DROP, (w) => (w.varint(hotbar), w.u16(0), w.u16(FULL)))).toBe(RESULT_OK);
  const [bag] = [...h.host.records.byPid.values()].filter((r) => r.kind === id("bag"));
  expect([items.inv(bag!).item[0], items.inv(bag!).refOf(0), inv().item[hotbar], p!.stored > 0]).toEqual([FULL, p!.pid, 0, true]);
  // Taken up again, and handed to someone of another tribe, it is the same ball with the same tame in it.
  expect(items.move(bag!, 0, me, hotbar, 1)).toBe(1);
  const bo = h.join("bo");
  h.run(500);
  const him = h.host.records.byPid.get(h.client(bo)!.pid)!;
  expect([him.team !== me.team, items.give(me, him, FULL, 1)]).toEqual([true, true]);
  // It lies in his bag, before the ball of his own on his hotbar.
  const given = items.inv(him).item.indexOf(FULL);
  expect([given < items.inv(him).bag, items.inv(him).refOf(given)]).toEqual([true, p!.pid]);
  // Destroyed, it takes its tame with it, and the tame's tribe is told. His own is untouched.
  const from = s.logVersion;
  expect(items.burn(him, given, 1)).toBe(true);
  h.run(300);
  expect([h.host.records.byPid.has(p!.pid), h.host.balls.lost, mounts(h).length, notices(s, from), items.audit()]).toEqual([false, 1, 1, ["pteranodon was lost with the soul ball that held it."], []]);
  h.host.shutdown();
});

test("a tame entry is not given again at a respawn", () => {
  // Both roles are given it: she joins as a player, and has cheats by the time she dies.
  const { h, s, me, inv } = setup((book) => {
    book.assign.player = book.assign.admin = "scout";
    book.loadouts.find((l) => l.id === "scout")!.respawn = true;
  });
  const [p] = mounts(h);
  h.host.death.die(me, 1);
  h.run(300);
  expect(send(h, s, CMD_RESPAWN, (w) => (w.u8(0), w.u8(s.placesList)))).toBe(RESULT_OK);
  h.run(200);
  // She rises in the suit again and with no ball: the one tame is the one in the ball in her cache.
  const own = inv();
  const suit = [...own.item.slice(own.armor, own.armor + ARMOR_SLOTS)];
  expect([suit, own.used(), own.total(FULL), h.host.loadouts.rises]).toEqual([["hat", "shirt", "gloves", "pants", "boots"].map((piece) => id(`meridian_${piece}`)), 5, 0, 1]);
  const [cache] = [...h.host.records.byPid.values()].filter((r) => r.kind === id("cache"));
  const held = h.host.items.inv(cache!);
  expect([mounts(h).map((r) => r.pid), held.refOf(held.item.indexOf(FULL)), p!.stored > 0, h.host.items.audit()]).toEqual([[p!.pid], p!.pid, true, []]);
  h.host.shutdown();
});

test("a full ball across a restart still holds its loadout tame", () => {
  const dbPath = join(dir, "kept.db");
  const one = setup(scout, { dbPath });
  const [p] = mounts(one.h);
  const was = { pid: p!.pid, stored: p!.stored, wild: [...p!.genome!.wild], colors: [...p!.genome!.colors], female: p!.genome!.female };
  one.h.run(3000);
  one.s.close();
  one.h.run(200);
  one.h.host.shutdown();

  const two = setup(scout, { dbPath, config: one.h.host.rules });
  const again = two.h.host.records.byPid.get(was.pid)!;
  const own = two.inv();
  // The same ball names the same tame, still without a body, and nothing more was handed out or put right.
  expect([two.me.pid, own.item[two.hotbar], own.refOf(two.hotbar), mounts(two.h).length, two.h.host.loadouts.firsts, two.h.host.balls.mended]).toEqual([one.me.pid, FULL, was.pid, 1, 0, 0]);
  expect({ pid: again.pid, stored: again.stored, wild: [...again.genome!.wild], colors: [...again.genome!.colors], female: again.genome!.female }).toEqual(was);
  expect([again.vitals, again.saddle, again.team, again.genome!.level]).toEqual([null, SADDLE, two.me.team, 240]);
  let bodies = 0;
  const ents = two.h.world.ents;
  for (let i = 0; i < ents.cap; i++) if ((ents.flags[i]! & F_ALIVE) !== 0 && ents.pid[i] === was.pid) bodies++;
  expect(bodies).toBe(0);
  // Loosed after it, it comes out rested, as its first body does.
  const e = loose(two.h, two.s, two.pilot, again);
  expect(e).toBeGreaterThanOrEqual(0);
  expect([again.stored, ents.stamina[e], own.item[two.hotbar], two.h.host.items.audit()]).toEqual([0, ents.staminaMax[e]! * STAMINA_UNITS, BALL, []]);
  two.h.host.shutdown();
});

test("with no room for the ball no tame is made", () => {
  const { h, me, inv, hotbar } = setup(() => {});
  const items = h.host.items;
  expect([inv().used(), mounts(h).length]).toEqual([0, 0]);
  for (let k = 0; k < HOTBAR_SLOTS; k++) expect([items.mint(me, id("spear"), 1), items.move(me, 0, me, hotbar + k, 0)]).toEqual([1, 1]);
  expect(items.mint(me, id("spear"), inv().bag)).toBe(inv().bag);
  const records = h.host.records.byPid.size;
  expect(h.host.loadouts.give(me, loadout([MOUNT, { ...MOUNT, place: "bag" }]), { tames: true })).toEqual({ given: [], missed: ["pteranodon 240", "pteranodon 240"] });
  expect([mounts(h).length, h.host.records.byPid.size, items.minted[FULL], items.audit()]).toEqual([0, records, 0, []]);
  // Only a creature goes into a ball: not a vehicle, a survivor, or a thing.
  const ctx = { world: h.world, records: h.host.records, items, rng: new Rng(1) };
  items.burnAll(me);
  expect(["helicopter", "survivor", "spear"].map((name) => giveTame(ctx, me, id(name), 5, false, "bag"))).toEqual([NOT_A_CREATURE, NOT_A_CREATURE, NOT_A_CREATURE]);
  expect([h.host.records.byPid.size, inv().used()]).toEqual([records, 0]);
  h.host.shutdown();
});
