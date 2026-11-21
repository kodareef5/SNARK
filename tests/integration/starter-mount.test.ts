// The starter mount (StarterMount, D992; server/mount.ts): every survivor has a tamed, saddled level 240 pteranodon of
// its own in an issued soul ball, which a new survivor looses, rides, flies, lands and keeps again; which is never a
// second one, however often its survivor dies, and is no way to make things to give away; which comes back when it is
// lost; which an old save gets at its survivor's next rise; and which does not travel.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ballInfo } from "../../client/core/balls.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { ISSUED_BALL_STAYS } from "../../server/own.ts";
import { STARTER_LEVEL } from "../../server/mount.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { Rules } from "../../server/settings/rules.ts";
import { STAT_WEIGHT, statOf } from "../../server/survival.ts";
import { ISSUED_SADDLE } from "../../server/taming.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_DROP, CMD_ORDER, CMD_RESPAWN, ORDER_MATE, ORDER_UNSADDLE, RESULT_DENIED, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_SPRINT, BTN_USE, MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { CHARGED, FLAG_ISSUED } from "../../shared/sim/items.ts";
import { TestCluster, beat, keyAt, rec, rise, travel } from "../fixtures/cluster.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const BALL = id("soul_ball");
const FULL = id("soul_ball_full");
const PTERANODON = id("pteranodon");
const SADDLE = id("saddle_pteranodon");
const dir = mkdtempSync(join(tmpdir(), "snark-mount-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Pilot = Harness["pilots"][number];

/** Rules as the server ships them, with lines of GameUserSettings.ini's [SnarkSettings] and of Game.ini's section. */
function shipped(snark: string[] = [], game: string[] = []): Rules {
  const made = loadConfig({ gus: ["[SnarkSettings]", ...snark].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...game].join("\n") });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return asShipped(made.rules);
}

/** A survivor new to a server as it comes, on level ground. send() sends one command and returns its result code, or -1. */
function setup(config = shipped(), dbPath?: string) {
  const h = new Harness({}, 1, 60, { config, ...(dbPath ? { dbPath } : {}) });
  const s = h.join("ada");
  h.run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const codes = new Map<number, number>();
  s.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void): number => {
    const seq = s.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const g = flatGround(h, 60, 40);
  const at = { x: g.x + 30, z: g.z + 8 };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  return { h, s, me, send, at, pilot: h.pilots[0]!, inv: () => h.host.items.inv(me), hotbar: h.host.items.inv(me).hotbar };
}

/** Every starter mount issued to `me`, in the world or kept. */
const starters = (h: Harness, me: EntityRecord): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.issuedTo === me.pid);

/** One click: the button down long enough for the throw's strike, and let go. */
function click(h: Harness, pilot: Pilot): void {
  pilot.buttons |= 4;
  h.run(300);
  pilot.buttons &= ~4;
  h.run(400);
}

/** Looks at the middle of the body `e`, from where she stands. */
function lookAt(h: Harness, s: ClientSession, pilot: Pilot, e: number, pitch?: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const dx = ents.x[e]! - ents.x[me]!;
  const dz = ents.z[e]! - ents.z[me]!;
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = pitch ?? Math.atan2(ents.y[e]! + reg.bodyHeight[ents.kind[e]!]! / 2 - (ents.y[me]! + 1.62), Math.hypot(dx, dz));
  h.run(200);
}

/** Takes the ball in her hotbar's first slot in hand and looses its tame a little way up the ground. Returns its body. */
function loose(h: Harness, s: ClientSession, pilot: Pilot, p: EntityRecord): number {
  takeInHand(h, s, FULL);
  h.run(700);
  pilot.yaw = 0;
  pilot.pitch = -0.25;
  h.run(200);
  click(h, pilot);
  const e = h.host.records.entOf.get(p.pid);
  expect(e).toBeDefined();
  return e!;
}

/** Dies by the console and rises at the first place offered. */
function dieAndRise(h: Harness, s: ClientSession, send: ReturnType<typeof setup>["send"]): void {
  expect(h.say(s, "suicide")).toEqual(["You were killed."]);
  expect(send(CMD_RESPAWN, (w) => (w.u8(0), w.u8(s.placesList)))).toBe(RESULT_OK);
}

test("a new survivor has a tamed, saddled level 240 pteranodon of its own, kept in an issued soul ball on its hotbar", () => {
  const { h, s, me, inv, hotbar } = setup();
  const own = inv();
  const [p] = starters(h, me);
  // The ball is in the hotbar's first slot, issued, its charge held full, and it names the tame.
  expect([own.item[hotbar], own.flags[hotbar], own.spoilAt[hotbar], own.refOf(hotbar)]).toEqual([FULL, FLAG_ISSUED, CHARGED, p!.pid]);
  // The tame is a pteranodon of level 240, perfectly tamed, saddled and hers, with no body until she lets it out.
  expect([p!.kind, p!.genome!.level, p!.te, p!.saddle, p!.team, p!.stored > 0, h.host.records.entOf.has(p!.pid)]).toEqual([PTERANODON, STARTER_LEVEL, 1, SADDLE, me.team, true, false]);
  // Her client holds the ball and is told what it holds, without the server's mark.
  expect([s.inventory!.item[hotbar], s.inventory!.flags[hotbar], s.inventory!.spoilAt[hotbar]]).toEqual([FULL, 0, CHARGED]);
  expect(ballInfo(reg, FULL, s.kept[0].get(hotbar), CHARGED, h.world.tick)).toBe("soul ball holds pteranodon, level 240; held at full charge");
  // It counts against no tame limit, and the books balance.
  expect([h.host.taming.count(me.team).ours, h.host.items.total(FULL), h.host.items.audit()]).toEqual([0, 1, []]);

  // The suit's switch is not this one: a server without the suit still gives the mount.
  const bare = setup(shipped([], ["bDisableDefaultMapItemSets=True"]));
  expect([bare.inv().item[bare.hotbar], starters(bare.h, bare.me).length]).toEqual([FULL, 1]);
  // A server whose files say StarterMount=False gives none.
  const off = setup(shipped(["StarterMount=False"]));
  expect([off.inv().used(), starters(off.h, off.me).length]).toEqual([5, 0]);
});

test("a new survivor with no levels and no engrams looses it, gets on, flies, sets down, gets off and keeps it again; it is built for travel", () => {
  const { h, s, me, pilot, inv, hotbar } = setup();
  expect([me.xp, me.engrams.length]).toEqual([0, 0]);
  const [p] = starters(h, me);
  const e = loose(h, s, pilot, p!);
  const ents = h.world.ents;
  // Out a few metres up the ground, hers and saddled, and the ball in her hand is empty and still issued.
  expect([ents.team[e], p!.stored, inv().item[hotbar], inv().flags[hotbar], inv().refOf(hotbar)]).toEqual([me.team, 0, BALL, FLAG_ISSUED, 0]);
  expect(ents.z[e]! - ents.z[h.ent(s)]!).toBeGreaterThan(2);
  // Its stamina sprints it 4 km, across the map, on one bar, and it carries 240 kg.
  const def = reg.defs[PTERANODON] as SpeciesDef;
  const sprint = def.fly!.speed * def.fly!.tamedSprintMul!;
  expect(ents.staminaMax[e]).toBe(1275);
  expect((ents.staminaMax[e]! / def.fly!.stamina.sprint) * sprint).toBeGreaterThan(4000);
  expect(statOf(def, p!.genome, STAT_WEIGHT, 0)).toBeCloseTo(240, 5);

  // She stands beside it and gets on.
  h.say(s, `tp ${(ents.x[e]! - 2.5).toFixed(3)} ${ents.z[e]!.toFixed(3)}`);
  lookAt(h, s, pilot, e, -0.1);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(400);
  expect(s.driving).toBe(e);
  // Up and away, then sprinting.
  const ground = h.world.hf.heightAt(ents.x[e]!, ents.z[e]!);
  pilot.yaw = 0;
  pilot.pitch = 0.6;
  pilot.moveZ = 127;
  pilot.buttons = BTN_JUMP;
  h.run(3000);
  pilot.buttons = BTN_JUMP | BTN_SPRINT;
  h.run(1500);
  expect(ents.mode[e]).toBe(MODE_FLYER);
  expect(ents.y[e]! - ground).toBeGreaterThan(5);
  // That spends little of its bar.
  expect(ents.stamina[e]! / (ents.staminaMax[e]! * 1000)).toBeGreaterThan(0.95);
  // Let go, it sets down, and she gets off.
  pilot.moveZ = 0;
  pilot.pitch = 0;
  pilot.buttons = 0;
  for (let k = 0; k < 40 && ents.mode[e] !== MODE_WALK; k++) h.run(500);
  expect([ents.mode[e], s.driving]).toEqual([MODE_WALK, e]);
  lookAt(h, s, pilot, e, -0.1);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(600);
  expect(s.driving).toBe(-1);

  // Kept again, the same tame: the ball in her hand is full, still issued, its charge held.
  takeInHand(h, s, BALL);
  h.run(700);
  lookAt(h, s, pilot, e);
  click(h, pilot);
  expect([p!.stored > 0, h.host.records.entOf.has(p!.pid), inv().item[hotbar], inv().flags[hotbar], inv().spoilAt[hotbar], inv().refOf(hotbar)]).toEqual([true, false, FULL, FLAG_ISSUED, CHARGED, p!.pid]);
  // Let out again at once it is not ball sick, as it would be from another ball on a PvP server, and she is not chilled.
  const again = loose(h, s, pilot, p!);
  expect([p!.out, p!.buffs.some((b) => b.buff === id("ball_sick")), me.buffs.some((b) => b.buff === id("ball_chill")), h.host.balls.sickened]).toEqual([false, false, false, 0]);
  expect(h.world.ents.pid[again]).toBe(p!.pid);
  expect(h.host.items.audit()).toEqual([]);
});

test("it is never a second one: it waits in its ball through deaths, is called back from where it was left, and is no way to make things to give away", () => {
  const { h, s, me, send, pilot, inv, hotbar, at } = setup();
  const items = h.host.items;
  const [p] = starters(h, me);
  // Died in three times with it in the ball, she rises each time with the same tame in a new ball, and no cache holds one.
  for (let life = 0; life < 3; life++) {
    dieAndRise(h, s, send);
    expect([starters(h, me).map((r) => r.pid), inv().item[hotbar], inv().flags[hotbar], inv().refOf(hotbar)]).toEqual([[p!.pid], FULL, FLAG_ISSUED, p!.pid]);
  }
  expect([items.minted[FULL], items.burned[FULL], items.total(FULL)]).toEqual([4, 3, 1]);
  expect([...h.host.records.byPid.values()].filter((r) => r.name === "ada's cache").length).toBe(0);

  // Let out and left 40 m off, it is called back into her ball as she rises.
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  loose(h, s, pilot, p!);
  h.say(s, `tp ${(at.x - 25).toFixed(3)} ${(at.z + 30).toFixed(3)}`);
  dieAndRise(h, s, send);
  expect([starters(h, me).map((r) => r.pid), h.host.records.entOf.has(p!.pid), inv().item[hotbar], inv().refOf(hotbar)]).toEqual([[p!.pid], false, FULL, p!.pid]);

  // One left carrying something stays where it is, with it; her ball is empty, and keeps it when she reaches it.
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const e = loose(h, s, pilot, p!);
  items.mint(p!, id("stone"), 3);
  dieAndRise(h, s, send);
  expect([h.host.records.entOf.get(p!.pid), inv().item[hotbar], inv().flags[hotbar]]).toEqual([e, BALL, FLAG_ISSUED]);
  h.say(s, `tp ${(h.world.ents.x[e]! - 3).toFixed(3)} ${h.world.ents.z[e]!.toFixed(3)}`);
  takeInHand(h, s, BALL);
  h.run(700);
  lookAt(h, s, pilot, e);
  click(h, pilot);
  expect([p!.stored > 0, inv().item[hotbar], inv().refOf(hotbar)]).toEqual([true, FULL, p!.pid]);
  expect([...h.host.records.byPid.values()].filter((r) => r.name === "bag").map((b) => items.inv(b).total(id("stone")))).toEqual([3]);

  // The ball stays with her: not dropped, stored, given or spent.
  const from = s.logVersion;
  expect(send(CMD_DROP, (w) => (w.varint(hotbar), w.u16(0), w.u16(FULL)))).toBe(RESULT_DENIED);
  expect(s.log.slice(-(s.logVersion - from)).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text)).toEqual([ISSUED_BALL_STAYS]);
  const box = h.host.records.create(id("bag"), "elsewhere");
  expect([items.give(me, box, FULL, 1), items.move(me, hotbar, box, 0, 0), items.burnItem(me, FULL, 1)]).toEqual([false, 0, false]);
  h.host.records.delete(box.pid);

  // It goes into no other ball, and her ball takes no other tame: not another's starter, nor a tame of her own.
  const pe = loose(h, s, pilot, p!);
  h.say(s, "give soul_ball 1");
  const other = inv().item.indexOf(BALL, 0);
  expect(other).toBeLessThan(hotbar);
  expect(h.host.balls.keepIn(me, other, pe)).toBe("It goes only into the soul ball it was issued with.");
  const bo = h.join("bo");
  h.run(500);
  const boRec = h.host.records.byPid.get(h.client(bo)!.pid)!;
  const [bp] = starters(h, boRec);
  expect(h.host.balls.looseAt(boRec, hotbar, h.world.ents.x[pe]! + 4, h.world.ents.y[pe]!, h.world.ents.z[pe]!, 0)).toBe("");
  expect(h.host.balls.keepIn(boRec, hotbar, pe)).toBe("This soul ball was issued with your pteranodon, and keeps only that one.");
  const raptor = h.host.spawnCreature("core:raptor", at.x + 6, at.z - 6, 10);
  h.host.taming.give(h.host.records.byPid.get(h.world.ents.pid[raptor]!)!, me, 0.5);
  h.run(100);
  expect(h.host.balls.keepIn(me, hotbar, raptor)).toBe("This soul ball was issued with your pteranodon, and keeps only that one.");

  // Its saddle stays on, and it does not mate.
  const order = (what: number): number => send(CMD_ORDER, (w) => (w.u32(pe), w.u8(what)));
  const told = s.logVersion;
  expect([order(ORDER_UNSADDLE), order(ORDER_MATE), p!.saddle, p!.mating]).toEqual([RESULT_DENIED, RESULT_DENIED, SADDLE, false]);
  expect(s.log.slice(-(s.logVersion - told)).some((l) => l.text === ISSUED_SADDLE)).toBe(true);

  // Killed, it leaves no body to harvest and no saddle, its killer gains nothing, and she rises with a new one.
  const xp = boRec.xp;
  h.host.survival.hurt(p!, 1e9, boRec.pid);
  h.run(300);
  expect([h.host.records.byPid.has(p!.pid), items.total(SADDLE), boRec.xp]).toEqual([false, 0, xp]);
  expect([...h.host.records.byPid.values()].filter((r) => r.kind === id("corpse")).length).toBe(0);
  expect(starters(h, me)).toEqual([]);
  dieAndRise(h, s, send);
  const [next] = starters(h, me);
  expect([starters(h, me).length, next!.pid !== p!.pid, inv().item[hotbar], inv().refOf(hotbar)]).toEqual([1, true, FULL, next!.pid]);
  // Bo's is still one too, out where Bo let it go.
  expect(starters(h, boRec).map((r) => r.pid)).toEqual([bp!.pid]);
  expect(items.audit()).toEqual([]);
});

test("switched off while the server runs, a survivor's starter goes at its next rise, and none is given", () => {
  const { h, s, me, send, pilot, inv, hotbar } = setup();
  const [p] = starters(h, me);
  loose(h, s, pilot, p!);
  expect(h.host.setSetting("StarterMount", "False")).not.toContain("no setting");
  dieAndRise(h, s, send);
  expect([starters(h, me).length, h.host.records.entOf.has(p!.pid), inv().item[hotbar], h.host.items.total(BALL) + h.host.items.total(FULL)]).toEqual([0, false, 0, 0]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a world saved before the mount was given loads as it was: its survivor gets one at its next rise, which stays in its ball through a restart", () => {
  const db = join(dir, "before.db");
  // Saved by a server that gave no mount, as every one did before.
  const before = setup(shipped(["StarterMount=False"]), db);
  before.h.host.items.mint(before.me, id("stone"), 7);
  before.h.run(200);
  before.s.close();
  before.h.run(200);
  before.h.host.shutdown();

  const after = setup(shipped(), db);
  expect([after.me.pid, after.inv().item[after.hotbar], starters(after.h, after.me).length, after.inv().total(id("stone"))]).toEqual([before.me.pid, 0, 0, 7]);
  dieAndRise(after.h, after.s, after.send);
  const [p] = starters(after.h, after.me);
  expect([after.inv().item[after.hotbar], after.inv().refOf(after.hotbar)]).toEqual([FULL, p!.pid]);
  after.s.close();
  after.h.run(200);
  after.h.host.shutdown();

  // Back after a restart, the ball is the same one, still issued and full, and it lets the same tame out.
  const again = setup(shipped(), db);
  const inv = again.inv();
  expect([inv.item[again.hotbar], inv.flags[again.hotbar], inv.spoilAt[again.hotbar], inv.refOf(again.hotbar), starters(again.h, again.me).map((r) => r.pid)]).toEqual([FULL, FLAG_ISSUED, CHARGED, p!.pid, [p!.pid]]);
  expect(again.h.host.balls.mended).toBe(0);
  const kept = again.h.host.records.byPid.get(p!.pid)!;
  expect([kept.issuedTo, kept.saddle, kept.genome!.level]).toEqual([again.me.pid, SADDLE, STARTER_LEVEL]);
  loose(again.h, again.s, again.pilot, kept);
  expect([again.h.host.items.minted[FULL], again.h.host.items.audit()]).toEqual([1, []]);
  again.h.host.shutdown();
});

test("dead across a restart, the tame that waited in no ball is set in the world by the load, and called back as she rises", () => {
  const db = join(dir, "dead.db");
  const one = setup(shipped(), db);
  const [p] = starters(one.h, one.me);
  expect(one.h.say(one.s, "suicide")).toEqual(["You were killed."]);
  expect([one.inv().item[one.hotbar], p!.stored > 0]).toEqual([0, true]);
  one.s.close();
  one.h.run(200);
  one.h.host.shutdown();

  const two = setup(shipped(), db);
  expect([two.h.host.balls.mended, two.h.host.records.entOf.has(p!.pid)]).toEqual([1, true]);
  expect(two.send(CMD_RESPAWN, (w) => (w.u8(0), w.u8(two.s.placesList)))).toBe(RESULT_OK);
  expect([starters(two.h, two.me).map((r) => r.pid), two.h.host.records.entOf.has(p!.pid), two.inv().item[two.hotbar], two.inv().refOf(two.hotbar)]).toEqual([[p!.pid], false, FULL, p!.pid]);
  expect(two.h.host.items.audit()).toEqual([]);
  two.h.host.shutdown();
});

test("it does not travel: it goes as she leaves, the ball is not sent, and the next server gives her its own", () => {
  const t = new TestCluster();
  try {
    const clock = { ms: Date.now() };
    const a = t.server("Island", "mount", clock, { shipped: true, argv: ["?PreventUploadItems=True"] });
    const b = t.server("Miami", "mount", clock, { shipped: true });
    beat(a, b);
    const ada: ClientSession = a.h.join("ada", {}, { key: keyAt("ada", a.world) });
    a.h.run(300);
    const me = rec(a, "ada")!;
    const [was] = starters(a.h, me);
    expect(was).toBeDefined();
    const ticket = travel(a, ada, b.world);
    expect(ticket).toBeInstanceOf(Uint8Array);
    // The island burned the ball as she left and let its tame go: none was sent, and none is left there.
    expect([a.h.host.items.sent[FULL], a.h.host.items.burned[FULL], a.h.host.items.total(FULL), a.h.host.records.byPid.has(was!.pid)]).toEqual([0, 1, 0, false]);
    clock.ms += 30_000;
    beat(a, b);
    const there = b.h.join("ada", {}, { key: keyAt("ada", b.world), ticket: ticket as Uint8Array });
    b.h.run(400);
    rise(b, there);
    const here = rec(b, "ada")!;
    const [mine] = starters(b.h, here);
    const inv = b.h.host.items.inv(here);
    expect([inv.item[inv.hotbar], inv.refOf(inv.hotbar), mine!.genome!.level, b.h.host.items.received[FULL], b.h.host.items.minted[FULL]]).toEqual([FULL, mine!.pid, STARTER_LEVEL, 0, 1]);
    expect(t.audit(a, b)).toEqual([]);
  } finally {
    t.cleanup();
  }
});
