// The knock-out kit in a running world: a new survivor knocks out a level 1 dodo with fists, a wooden club or a slingshot,
// and narcoberries are picked, eaten and fed. The counts are the wiki's (ark.wiki.gg, 2026-11-15); see tests/combat/knockout.test.ts.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { Blow } from "../../server/combat.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_FEED, CMD_MOVE, CMD_USE, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { nodesOf, standFacing, takeInHand } from "../fixtures/gather.ts";
import type { Harness, Pilot } from "../fixtures/net.ts";
import * as kit from "../kit/kit.ts";

const TICK_MS = 1000 / 30;
/** A dodo's yaw side on to a survivor looking north. */
const SIDE_ON = 16384;

/** Ada, a new survivor of level 1, on level ground with cheats on. */
function camp() {
  const { h, ada, me } = kit.camp({ place: kit.clearing() });
  h.run(300);
  return { h, ada, pilot: h.pilots[0]!, me, id: kit.id };
}

/** Stands the dodo `far` metres north of Ada, side on and still, and aims `high` metres above the middle of its body. */
function line(h: Harness, s: ClientSession, pilot: Pilot, e: number, far: number, high: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const x = ents.x[me]!;
  const z = ents.z[me]! + far;
  h.host.creatures.mind.stay(e, h.world.tick + 60 * 30);
  ents.setPosition(e, x, h.world.hf.heightAt(x, z), z);
  ents.vx[e] = ents.vz[e] = 0;
  ents.yaw[e] = h.host.creatures.mind.look[e] = SIDE_ON;
  h.run(700);
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 + high - eye, far);
  h.run(150);
}

/** One swing of what is in hand, or one stone loosed at full draw. Returns the blow that landed, or null. */
function strike(h: Harness, pilot: Pilot, drawn: boolean): Blow | null {
  const before = h.host.combat.hits;
  pilot.buttons |= BTN_PRIMARY;
  h.run(drawn ? 1300 : TICK_MS * 8);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(drawn ? 800 : TICK_MS * (SWING_TICKS + 6));
  return h.host.combat.hits === before + 1 ? { ...h.host.combat.last } : null;
}

/** Strikes a new level 1 dodo with `weapon` (bare hands for "") until it is out. Returns each blow and the torpor after it. */
function knockOut(weapon: string): { blows: Blow[]; torpor: number[]; rec: EntityRecord; h: Harness } {
  const { h, ada, pilot, me, id } = camp();
  const sling = weapon === "slingshot";
  if (weapon !== "") {
    h.say(ada, `give core:${weapon} 1`);
    if (sling) h.say(ada, "give core:stone 10");
    takeInHand(h, ada, id(weapon));
    h.run(1200);
  }
  const ents = h.world.ents;
  const e = h.host.spawnCreature("core:dodo", ents.x[h.ent(ada)]! + 3, ents.z[h.ent(ada)]! + 3, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  expect(rec.genome!.level).toBe(1);
  const blows: Blow[] = [];
  const torpor: number[] = [];
  for (let i = 0; i < 6 && !rec.out; i++) {
    line(h, ada, pilot, e, sling ? 4 : 1.1, sling ? 0.06 : 0);
    const b = strike(h, pilot, sling);
    expect(b).not.toBeNull();
    blows.push(b!);
    h.run(100);
    torpor.push(h.host.survival.value(rec, V_TORPOR));
  }
  expect(h.host.items.audit()).toEqual([]);
  expect(me.out).toBe(false);
  return { blows, torpor, rec, h };
}

test("a new survivor punches a level 1 dodo out in three, 14 torpor a punch, and it lives", () => {
  const { blows, torpor, rec, h } = knockOut("");
  expect(blows.map((b) => [b.damage, b.killed])).toEqual([[8, false], [8, false], [8, false]]);
  expect(torpor[0]).toBeCloseTo(14, 0);
  expect(torpor[1]!).toBeLessThan(30);
  expect([rec.out, h.host.survival.value(rec, V_HEALTH) > 0]).toEqual([true, true]);
});

test("a wooden club knocks a level 1 dodo out in two blows, 18.75 torpor each, and it lives", () => {
  const { blows, torpor, rec, h } = knockOut("club");
  expect(blows.map((b) => [b.damage, b.killed])).toEqual([[5, false], [5, false]]);
  expect(torpor[0]).toBeCloseTo(18.75, 0);
  expect([rec.out, h.host.survival.value(rec, V_HEALTH) > 0]).toEqual([true, true]);
});

test("a slingshot knocks a level 1 dodo out with two stones, 18.9 torpor each, and it lives", () => {
  const { blows, torpor, rec, h } = knockOut("slingshot");
  expect(blows.map((b) => [Math.round(b.damage * 1000) / 1000, b.killed])).toEqual([[14, false], [14, false]]);
  expect(torpor[0]).toBeCloseTo(18.9, 0);
  expect([rec.out, h.host.survival.value(rec, V_HEALTH) > 0]).toEqual([true, true]);
});

test("narcoberries: a bush bears some, eaten one is 4 food and 7.5 torpor over three seconds, and fed they keep a dodo under", () => {
  const { h, ada, pilot, me, id } = camp();
  const survival = h.host.survival;
  const ents = h.world.ents;
  const berry = id("narcoberry");
  const have = (): number => h.host.items.inv(me).total(berry);
  const home = `tp ${ents.x[h.ent(ada)]!.toFixed(3)} ${ents.z[h.ent(ada)]!.toFixed(3)}`;
  const bush = nodesOf(h, "core:bush", ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!).find((b) => standFacing(h, ada, pilot, b, 1.4))!;
  for (let i = 0; i < 4; i++) {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(200);
  }
  expect(have()).toBeGreaterThan(0);
  expect(have()).toBeLessThanOrEqual(8);
  expect(bush).toBeDefined();

  // Eaten. Torpor rises 2.5 a second and does not drain meanwhile, then a survivor sheds it at 4 a second.
  survival.add(me, V_FOOD, -20);
  const food = survival.value(me, V_FOOD);
  ada.command(CMD_USE, (w: BitWriter) => (w.varint(ada.inventory!.item.indexOf(berry)), w.u16(berry)));
  let most = 0;
  for (let t = 0; t < 40; t++) {
    h.run(100);
    most = Math.max(most, survival.value(me, V_TORPOR));
  }
  expect(most).toBeCloseTo(7.5, 1);
  expect(survival.value(me, V_FOOD) - food).toBeCloseTo(4, 0);
  h.run(3000);
  expect(survival.value(me, V_TORPOR)).toBe(0);

  // Fed to a knocked-out dodo, a narcotic and then at once a narcoberry: 47.5 over eleven seconds, and no drain.
  h.say(ada, home);
  h.run(300);
  const e = h.host.spawnCreature("core:dodo", ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]! + 1.6, 30);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, h.world.tick + 30);
  survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  survival.add(rec, V_TORPOR, -70);
  h.run(100);
  expect(rec.out).toBe(true);
  open(h, ada, pilot, e);
  expect(ada.subject?.taming).toBe(true);
  h.say(ada, "give core:narcotic 1");
  h.say(ada, "give core:narcoberry 1");
  const put = (item: number, slot: number): void => {
    const inv = ada.inventory!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(item)), w.bits(BOX_OPEN, 1), w.varint(slot), w.u16(0), w.u16(item)));
    h.run(150);
  };
  put(id("narcotic"), 0);
  put(berry, 1);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  const before = survival.value(rec, V_TORPOR);
  ada.command(CMD_FEED, (w: BitWriter) => (w.varint(0), w.u16(id("narcotic"))));
  ada.command(CMD_FEED, (w: BitWriter) => (w.varint(1), w.u16(berry)));
  h.run(11300);
  expect(codes).toEqual([RESULT_OK, RESULT_OK]);
  expect(survival.value(rec, V_TORPOR) - before).toBeCloseTo(47.5, 0);
  expect([rec.out, h.host.taming.doses]).toEqual([true, 2]);
});

/** Ada looks at `e` and presses use, which opens it. */
function open(h: Harness, s: ClientSession, pilot: Pilot, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
  h.run(150);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
}
