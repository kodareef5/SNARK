import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_USE, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_STALE } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_SPRINT, MF_NO_SPRINT, MF_ROOTED } from "../../shared/sim/character.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_WATER } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { Harness } from "../fixtures/net.ts";

function setup(link = {}) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada", link);
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const id = (name: string) => h.reg.index.get(name)!;
  return { h, s, rec, id, pilot: h.pilots[0]!, ents: h.world.ents, e: h.ent(s), items: h.host.items, sv: h.host.survival };
}

const move = (s: ClientSession, from: number, to: number, count: number, expectItem: number, fromBox = BOX_SELF, toBox = BOX_SELF): number =>
  s.command(CMD_MOVE, (w: BitWriter) => {
    w.bits(fromBox, 1);
    w.varint(from);
    w.bits(toBox, 1);
    w.varint(to);
    w.u16(count);
    w.u16(expectItem);
  });
const use = (s: ClientSession, slot: number, expectItem: number): number => s.command(CMD_USE, (w: BitWriter) => (w.varint(slot), w.u16(expectItem)));

function same(a: Inventory, b: Inventory): boolean {
  if (a.cap !== b.cap) return false;
  for (let i = 0; i < a.cap; i++) {
    if (a.item[i] !== b.item[i] || a.count[i] !== b.count[i] || a.quality[i] !== b.quality[i] || a.dur[i] !== b.dur[i] || a.spoilAt[i] !== b.spoilAt[i]) return false;
  }
  return true;
}

test("the client's inventory is the server's, whatever is done to it, and the books always balance", () => {
  const { h, s, rec, id, items } = setup({ latencyMs: 60, jitterMs: 20 });
  const kinds = [id("core:stone"), id("core:berry"), id("core:waterskin"), id("core:fiber"), id("core:meat")];
  const results: number[] = [];
  s.onResult = (_seq, code) => results.push(code);
  const rng = new Rng(21);
  for (let round = 0; round < 60; round++) {
    const inv = items.inv(rec);
    const k = rng.int(4);
    if (k === 0) items.mint(rec, kinds[rng.int(kinds.length)]!, 1 + rng.int(180));
    else if (k === 1) items.burn(rec, rng.int(inv.cap), 1 + rng.int(20));
    // The client acts on its own copy of the inventory, so some of its requests are stale.
    const mine = s.inventory;
    for (let n = rng.int(4); n > 0 && mine; n--) {
      const from = rng.int(mine.cap);
      if (rng.int(3) === 0) use(s, from, mine.item[from]!);
      else move(s, from, rng.int(mine.cap), rng.int(3) === 0 ? 0 : rng.int(60), mine.item[from]!);
    }
    h.run(rng.int(3) === 0 ? 40 : 250);
    expect(items.audit()).toEqual([]);
  }
  h.run(1000);
  expect(same(s.inventory!, items.inv(rec))).toBe(true);
  expect(results.length).toBeGreaterThan(40);
  expect(results.includes(RESULT_OK)).toBe(true);
  expect(results.includes(RESULT_STALE)).toBe(true);
  expect(results.every((c) => c === RESULT_OK || c === RESULT_STALE || c === RESULT_INVALID)).toBe(true);
  expect(items.audit()).toEqual([]);
});

test("hostile slot commands cannot mint, cannot reach another box, and cannot break the books", () => {
  const { h, s, rec, id, items } = setup();
  const stone = id("core:stone");
  items.mint(rec, stone, 500);
  h.run(300);
  const before = items.minted[stone]! - items.burned[stone]!;
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const rng = new Rng(4);
  for (let i = 0; i < 400; i++) {
    for (let n = 3; n > 0; n--) {
      const c = rng.int(5);
      if (c === 0) move(s, rng.int(256), rng.int(256), rng.int(65536), rng.int(4) === 0 ? stone : rng.int(65536));
      else if (c === 1) move(s, rng.int(40), rng.int(40), rng.int(65536), stone, rng.int(2), rng.int(2));
      else if (c === 2) use(s, rng.int(256), rng.int(2) === 0 ? stone : rng.int(65536));
      else if (c === 3) s.command(CMD_MOVE, (w) => w.u8(rng.int(256))); // cut short
      else s.command(CMD_USE);
    }
    h.run(1000 / 30);
  }
  h.run(500);
  expect(codes.length).toBeGreaterThan(1000);
  expect(codes.includes(RESULT_DENIED)).toBe(true); // BOX_OPEN with nothing open
  expect(items.total(stone)).toBe(before); // stone is not food, so no use consumes it
  expect(items.audit()).toEqual([]);
  expect(same(s.inventory!, items.inv(rec))).toBe(true);
  expect(s.state).toBe("active");
  codes.length = 0;
  move(s, 0, 0, 0, stone, BOX_SELF, BOX_OPEN);
  h.run(200);
  expect(codes).toEqual([RESULT_DENIED]);
});

test("vitals reach the HUD as rates: bars move with no messages, and eating is one message", () => {
  const { h, s, rec, id, items, sv } = setup();
  const berry = id("core:berry");
  h.say(s, "give berry 10");
  h.run(1000);
  expect(s.hasVitals).toBe(true);
  expect(s.inventory!.total(berry)).toBe(10);

  // An unchanged version means no vitals message arrived in twenty seconds.
  const versions = s.vitals.version;
  h.run(20000);
  expect(s.vitals.version).toBe(versions);
  for (const tick of [h.world.tick - 300, h.world.tick, h.world.tick + 900]) {
    for (const i of [V_HEALTH, V_FOOD, V_WATER, V_OXYGEN]) expect(s.vitals.at(i, tick)).toBe(rec.vitals!.at(i, tick));
  }
  expect(sv.value(rec, V_FOOD)).toBeLessThan(100);
  expect(sv.value(rec, V_FOOD)).toBeGreaterThan(99);

  // Food is lowered first, so the berry's four points fit under the cap.
  sv.add(rec, V_FOOD, -50);
  const food = sv.value(rec, V_FOOD);
  const water = sv.value(rec, V_WATER);
  const slot = s.inventory!.item.indexOf(berry);
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  use(s, slot, berry);
  h.run(300);
  expect(codes).toEqual([RESULT_OK]);
  expect(items.inv(rec).total(berry)).toBe(9);
  expect(s.inventory!.total(berry)).toBe(9);
  expect(items.burned[berry]).toBe(1);
  expect(sv.value(rec, V_FOOD)).toBeGreaterThan(food + 3.9);
  expect(sv.value(rec, V_WATER)).toBeGreaterThan(water);
  expect(s.vitals.at(V_FOOD, h.world.tick)).toBe(rec.vitals!.at(V_FOOD, h.world.tick));
  codes.length = 0;
  use(s, slot, id("core:stone"));
  h.say(s, "give stone 1");
  use(s, s.inventory!.item.indexOf(id("core:stone")), id("core:stone"));
  h.run(300);
  expect(codes).toEqual([RESULT_STALE, RESULT_OK, RESULT_INVALID]); // the middle one answers the console line
  expect(items.audit()).toEqual([]);
});

test("a head under water runs out of air, then of health; surfacing brings the air back; falls hurt", () => {
  const { h, s, rec, pilot, ents, e, sv } = setup();
  h.say(s, `tp ${PROVING_POOL.x} ${PROVING_POOL.z}`); // the bottom of the pool, 7.5 m down
  h.run(300);
  expect(sv.isSubmerged(rec)).toBe(true);
  const air = sv.value(rec, V_OXYGEN);
  h.run(10000);
  expect(sv.value(rec, V_OXYGEN)).toBeCloseTo(air - 30, 0); // three points a second
  expect(sv.value(rec, V_HEALTH)).toBeGreaterThan(99.9);
  h.run(30000); // out of air for some seven seconds by now
  expect(sv.value(rec, V_OXYGEN)).toBe(0);
  const hurt = sv.value(rec, V_HEALTH);
  expect(hurt).toBeLessThan(60);
  expect(hurt).toBeGreaterThan(10);
  expect(s.vitals.at(V_HEALTH, h.world.tick)).toBe(rec.vitals!.at(V_HEALTH, h.world.tick));

  pilot.buttons = 1;
  h.run(4000);
  pilot.buttons = 0;
  expect(sv.isSubmerged(rec)).toBe(false);
  // The swim up cost more health. At the surface it comes back.
  const surfaced = sv.value(rec, V_HEALTH);
  expect(surfaced).toBeLessThan(hurt);
  expect(surfaced).toBeGreaterThan(0);
  h.run(6000);
  expect(sv.value(rec, V_OXYGEN)).toBe(100);
  expect(sv.value(rec, V_HEALTH)).toBeGreaterThan(surfaced);

  // A twelve metre fall costs seven health for each metre per second over twelve.
  sv.add(rec, V_HEALTH, 100);
  const before = sv.value(rec, V_HEALTH);
  h.say(s, "tp 256 12 240");
  h.run(4000);
  expect(ents.y[e]).toBe(0);
  const lost = before - sv.value(rec, V_HEALTH);
  const g = h.reg.move[ents.kind[e]!]!.gravity;
  const expected = (Math.sqrt(2 * g * 12) - 12) * 7;
  expect(expected).toBeGreaterThan(20);
  expect(Math.abs(lost - expected)).toBeLessThan((g / 30) * 7 + 1.5);
  const now = sv.value(rec, V_HEALTH);
  pilot.buttons = 1;
  h.run(200);
  pilot.buttons = 0;
  h.run(2000);
  expect(sv.value(rec, V_HEALTH)).toBeGreaterThanOrEqual(now);
});

test("vitals stop while a survivor is out of the world and resume when it returns", () => {
  const { h, s, rec, sv } = setup();
  sv.add(rec, V_FOOD, -40);
  h.run(1000);
  s.close();
  h.run(6000); // the body lingers five seconds, still hungry, then leaves
  expect(h.world.ents.count).toBe(0);
  const food = sv.value(rec, V_FOOD);
  expect(food).toBeLessThan(60);
  for (let i = 0; i < 30 * 3600; i++) h.server.tick(); // an hour passes with nobody there
  expect(sv.value(rec, V_FOOD)).toBe(food);
  const again = h.join("ada");
  h.run(1000);
  expect(again.state).toBe("active");
  expect(sv.value(rec, V_FOOD)).toBeLessThan(food);
  expect(sv.value(rec, V_FOOD)).toBeGreaterThan(food - 0.1);
  expect(again.vitals.at(V_FOOD, h.world.tick)).toBe(rec.vitals!.at(V_FOOD, h.world.tick));
  expect(again.inventory).not.toBeNull();
});

test("a heavy load slows the body and a load at the limit roots it, on both sides alike", () => {
  const { h, s, pilot, ents, e } = setup({ latencyMs: 40 });
  pilot.moveZ = 1;
  pilot.buttons = BTN_SPRINT;
  h.say(s, "give stone 180"); // 90 kg of a 100 kg limit
  h.run(500);
  expect(ents.mflags[e]! & MF_NO_SPRINT).toBe(MF_NO_SPRINT);
  expect(ents.speedQ[e]).toBe(600);
  const z = ents.z[e]!;
  const corrections = s.stats.corrections;
  h.run(2000);
  expect(ents.z[e]! - z).toBeCloseTo(4.5 * 0.6 * 2, 0);
  expect(s.stats.corrections).toBe(corrections);
  h.say(s, "give stone 20"); // 100 kg
  h.run(500);
  expect(ents.mflags[e]! & MF_ROOTED).toBe(MF_ROOTED);
  const stuck = ents.z[e]!;
  h.run(1500);
  expect(ents.z[e]).toBe(stuck);
  expect(s.own.z).toBe(stuck);
  h.say(s, "setstat weight 100"); // 100 kg * (1 + 100 * 0.1)
  h.run(1500);
  expect(ents.mflags[e]! & (MF_ROOTED | MF_NO_SPRINT)).toBe(0);
  expect(ents.z[e]!).toBeGreaterThan(stuck + 3);
});

test("berries spoil one by one on the world clock, seen or not, and the ledger counts each", () => {
  const { h, s, rec, id, items } = setup();
  const berry = id("core:berry");
  h.say(s, "give berry 50");
  h.run(300);
  const interval = h.reg.spoilTicks[berry]!;
  const start = h.world.tick;
  // Twenty minutes and a little: two pieces. Much longer and she would die of thirst with them.
  while (h.world.tick < start + interval * 2 + 400) h.server.tick();
  h.run(500); // the client learns of it when the server next looks
  expect(items.inv(rec).total(berry)).toBe(48);
  expect(s.inventory!.total(berry)).toBe(48);
  expect(items.burned[berry]).toBe(2);
  expect(items.audit()).toEqual([]);
});

test("creatures arrive with their level and colours, players with their names, and a change is sent again", () => {
  const { h, s } = setup();
  const bo = h.join("bo");
  h.run(300);
  expect(h.say(s, "spawn grazer 150")[0]).toBe("spawned core:grazer level 150");
  expect(h.say(s, "spawn nothing")[0]).toContain("no species");
  expect(h.say(s, "give nothing")[0]).toContain("no item");
  h.run(300);
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  expect(seen.count).toBe(2);
  const grazer = h.reg.index.get("core:grazer")!;
  const g = [...Array(seen.count).keys()].find((i) => seen.kind[i] === grazer)!;
  const p = 1 - g;
  const rec = [...h.host.records.byPid.values()].find((r) => r.kind === grazer)!;
  expect(seen.level[g]).toBe(150);
  expect([...seen.colors.subarray(g * 6, g * 6 + 6)]).toEqual([...rec.genome!.colors]);
  expect(seen.colors.subarray(g * 6, g * 6 + 6).every((c) => c !== 0)).toBe(true);
  expect(seen.name[g]).toBe("");
  expect(seen.name[p]).toBe("ada");
  expect(seen.level[p]).toBe(1);
  expect(h.say(s, "addxp 40")[0]).toContain("level 4");
  h.run(300);
  bo.sampleRemote(seen);
  const p2 = [...Array(seen.count).keys()].find((i) => seen.kind[i] !== grazer)!;
  expect(seen.level[p2]).toBe(4);
  expect(bo.stats.undecodable).toBe(0);
});

test("setstat refreshes everything the points feed, with the load still counted", () => {
  const { h, s, rec, ents, e } = setup();
  h.say(s, "give stone 200"); // 100 kg, the limit
  h.run(300);
  expect(ents.mflags[e]! & MF_ROOTED).toBe(MF_ROOTED);
  expect(h.say(s, "setstat food 10")).toEqual(["food: 10 points, value 200"]);
  h.run(300);
  expect(ents.mflags[e]! & MF_ROOTED).toBe(MF_ROOTED);
  expect(rec.vitals!.max[V_FOOD]).toBe(200_000_000);
  expect(s.vitals.max[V_FOOD]).toBe(200_000_000);
  expect(h.say(s, "setstat health 20")).toEqual(["health: 20 points, value 300"]);
  h.run(300);
  expect(s.vitals.max[V_HEALTH]).toBe(300_000_000);
  expect(ents.level[e]).toBe(1); // a survivor's level is its experience, not points an admin set
  // 100 kg of a 200 kg limit.
  h.say(s, "setstat weight 10");
  h.run(300);
  expect(ents.mflags[e]! & (MF_ROOTED | MF_NO_SPRINT)).toBe(0);
  expect(ents.speedQ[e]).toBe(1000);
});

test("handing food to someone else does not make it fresher", () => {
  const { h, rec, id, items } = setup();
  const berry = id("core:berry");
  // A box keeps food as long as hands do. A creature keeps it longer (ark-numbers.test.ts).
  const other = h.host.records.create(id("core:cache"), "box");
  const made = h.world.tick;
  items.mint(rec, berry, 30);
  const clock = items.inv(rec).spoilAt[0]!;
  expect(clock).toBe(made + h.reg.spoilTicks[berry]!);
  while (h.world.tick < clock - 10) h.server.tick();
  expect(items.give(rec, other, berry, 20)).toBe(true);
  const theirs = items.inv(other);
  expect(theirs.total(berry)).toBe(20);
  expect(theirs.spoilAt[theirs.item.indexOf(berry)]).toBe(clock);
  while (h.world.tick < clock + 5) h.server.tick();
  expect(items.inv(other).total(berry)).toBe(19);
  expect(items.inv(rec).total(berry)).toBe(9);
  // A merged stack keeps the older part's spoil clock.
  items.mint(other, berry, 5);
  expect(items.inv(other).spoilAt[theirs.item.indexOf(berry)]).toBe(clock + h.reg.spoilTicks[berry]!);
  expect(items.audit()).toEqual([]);
});
