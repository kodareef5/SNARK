// A campfire that burns and cooks unobserved, a bed its tribe respawns at, and a mortar and pestle things are made at.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { BED_WAIT_TICKS } from "../../server/host.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT, CMD_CRAFT_AT, CMD_LEARN, CMD_MOVE, CMD_PLACE, CMD_RESPAWN, CMD_SELECT, CMD_STRUCT, RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, RESULT_WAIT, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { ON_TOP } from "../../shared/world/snap.ts";
import { NO_PIN, STRUCT_DEMOLISH, STRUCT_LIGHT, STRUCT_PICKUP, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { KEY_STATION_JOB, KEY_STATION_RECIPE, StationPanel, stationRecipes } from "../../client/core/ui/station.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { flatGround } from "../fixtures/arena.ts";
import { builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
type Made = ReturnType<typeof builder>;

/** Places a free-standing item at (x, z), on the ground or on top of `target`. Returns its ref. */
function setDown(made: Made, s: ClientSession, item: string, x: number, z: number, target = NO_TARGET): number {
  const { h } = made;
  h.say(s, `give ${item} 1`);
  const inv = s.inventory!;
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + 7), w.u16(0), w.u16(id(item))));
  h.run(100);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(7));
  h.run(100);
  const before = h.host.build.placed;
  s.command(CMD_PLACE, (w: BitWriter) => {
    w.u8(0);
    w.u32(target);
    if (target !== NO_TARGET) w.u8(ON_TOP);
    w.sbits(Math.round(x * U), 32);
    w.sbits(Math.round(z * U), 32);
    w.u16(0);
    if (target === NO_TARGET) w.sbits(0, 8);
    w.u8(0);
  });
  h.run(150);
  expect(h.host.build.placed).toBe(before + 1);
  return h.host.build.last;
}

const kindAt = (h: Harness, ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;

function act(h: Harness, s: ClientSession, ref: number, action: number): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action)));
  h.run(150);
  return code;
}

test("a campfire burns the fuel on it and cooks what lies over it, at the reference's times, with nobody looking; it goes out when the fuel does, and is kept burning across a restart", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-fire-"));
  const dbPath = joinPath(dir, "world.db");
  const made = builder(["ada", "bob"], 40, 40, { dbPath });
  let { h } = made;
  const { at } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  // Without this setting a piece can be picked up only in the half minute after it is placed.
  h.say(ada, "setting AlwaysAllowStructurePickup True");
  const fire = setDown(made, ada, "piece_campfire", at.x, at.z + 2);
  expect([kindAt(h, fire), h.host.fixtures.count]).toEqual([id("campfire"), 0]);
  // With no fuel it will not light.
  expect([act(h, ada, fire, STRUCT_LIGHT), act(h, bob, fire, STRUCT_LIGHT)]).toEqual([RESULT_SHORT, RESULT_NOT_YOURS]);
  // Wood burns half a minute a piece. Raw meat cooks in twenty seconds a piece.
  let state = h.host.fixtures.ensure(fire);
  expect(h.host.items.inv(state).cap).toBe(3);
  h.host.items.mint(state, id("wood"), 2);
  h.host.items.mint(state, id("meat"), 3);
  expect(act(h, ada, fire, STRUCT_LIGHT)).toBe(RESULT_OK);
  const lit = state.fire!.at;
  // A lit fire is a different structure kind in the same slot. The first piece of wood is already burning.
  expect([kindAt(h, fire), bob.world!.structs.chunks[Math.floor(fire / 65536)]!.kind[fire & 0xffff], state.inv!.total(id("wood"))]).toEqual([id("campfire_lit"), id("campfire_lit"), 1]);
  expect(state.fire).toMatchObject({ fuel: 900, cook: 0 });
  // The fire is lazy. After 25 s nothing has run, and reading its inventory through items.inv() cooks the one piece due.
  const due = state.fire!.due;
  expect(due - lit).toBe(1800);
  h.run(25000);
  expect([state.inv!.total(id("meat_cooked")), state.fire!.due]).toEqual([0, due]);
  expect([h.host.items.inv(state).total(id("meat_cooked")), state.inv!.total(id("meat")), h.host.stations.cooked]).toEqual([1, 2, 1]);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  const again = h.join("ada");
  h.run(600);
  state = h.host.fixtures.find(fire)!;
  expect([kindAt(h, fire), state.fire !== null, state.inv!.total(id("meat")), h.world.tick > lit]).toEqual([id("campfire_lit"), true, 2, true]);
  // A minute after lighting (1800 ticks) the wood is gone and the fire is out.
  h.run(Math.max(0, ((lit + 1800 - h.world.tick) / TICK_RATE) * 1000) + 500);
  expect([kindAt(h, fire), again.world!.structs.chunks[Math.floor(fire / 65536)]!.kind[fire & 0xffff], state.fire, h.host.stations.wentOut]).toEqual([id("campfire"), id("campfire"), null, 1]);
  expect([state.inv!.total(id("meat_cooked")), state.inv!.total(id("meat")), state.inv!.total(id("wood"))]).toEqual([3, 0, 0]);
  // Cooked meat spoils from the tick it was cooked, not from when someone looked. The first was cooked at lit + 600.
  const slot = state.inv!.item.indexOf(id("meat_cooked"));
  expect(state.inv!.spoilAt[slot]! - reg.spoilTicks[id("meat_cooked")]!).toBe(lit + 600);

  // Putting it out by hand loses the piece that was burning.
  h.say(again, "enablecheats");
  h.host.items.mint(state, id("thatch"), 4);
  expect(act(h, again, fire, STRUCT_LIGHT)).toBe(RESULT_OK);
  expect([kindAt(h, fire), state.inv!.total(id("thatch"))]).toEqual([id("campfire_lit"), 3]);
  expect(act(h, again, fire, STRUCT_LIGHT)).toBe(RESULT_OK);
  expect([kindAt(h, fire), state.fire, state.inv!.total(id("thatch"))]).toEqual([id("campfire"), null, 3]);
  // Three thatch at 7.5 s each burn out after 22.5 s.
  act(h, again, fire, STRUCT_LIGHT);
  const relit = h.world.tick;
  h.run(22000);
  expect(kindAt(h, fire)).toBe(id("campfire_lit"));
  h.run(1000);
  expect([kindAt(h, fire), h.host.stations.wentOut, h.world.tick - relit > 675]).toEqual([id("campfire"), 2, true]);
  // It cannot be picked up while it holds anything.
  expect(act(h, again, fire, STRUCT_PICKUP)).not.toBe(RESULT_OK);
  h.host.items.burnAll(state);
  expect([act(h, again, fire, STRUCT_PICKUP), again.inventory!.total(id("piece_campfire")), h.host.fixtures.count]).toEqual([RESULT_OK, 1, 0]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

for (const how of ["demolished", "destroyed"] as const) test(`a ${how} fire spills the same cooked contents whether anyone observed it or not`, () => {
  const results: number[][] = [];
  for (const observe of [false, true]) {
    const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 });
    try {
      const s = h.join("ada");
      h.run(300);
      const me = h.host.records.byPid.get(h.client(s)!.pid)!;
      const at = flatGround(h, 30, 30);
      h.say(s, "enablecheats");
      h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
      const fire = h.world.structs.add(id("campfire"), at.x + 11, at.y + reg.halfY[id("campfire")]!, at.z + 10, 0, me.team, 100);
      const rec = h.host.fixtures.ensure(fire);
      h.host.items.mint(rec, id("wood"), 10);
      h.host.items.mint(rec, id("meat"), 3);
      expect(act(h, s, fire, STRUCT_LIGHT)).toBe(RESULT_OK);
      h.run(45000);
      if (observe) h.host.items.inv(rec);
      if (how === "demolished") expect(act(h, s, fire, STRUCT_DEMOLISH)).toBe(RESULT_OK);
      else expect(h.world.structs.damage(fire, 1000, h.world.tick)).toBe(0);
      const cache = [...h.host.records.byPid.values()].find((r) => r.kind === id("cache"))!;
      results.push([cache.inv!.total(id("wood")), cache.inv!.total(id("meat")), cache.inv!.total(id("meat_cooked"))]);
      expect(h.host.records.byPid.has(rec.pid)).toBe(false);
      expect(h.host.fixtures.find(fire)).toBeNull();
      expect(h.host.items.audit()).toEqual([]);
    } finally {
      h.host.shutdown();
    }
  }
  expect(results).toEqual([[8, 1, 2], [8, 1, 2]]);
});

test("every bed of the tribe is offered to its dead, thirty as surely as two, and the last of them is one to rise at", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 70, 10);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const bed = id("bed");
  const refs = Array.from({ length: 30 }, (_, k) => h.world.structs.add(bed, g.x + 3 + k * 2.2, g.y + reg.halfY[bed]!, g.z + 5, 0, me.team, 100));
  for (const ref of refs) h.host.fixtures.ensure(ref);
  h.say(ada, "suicide");
  h.run(300);
  const spawns = h.world.spawns.length;
  expect([ada.sessionState, ada.respawnPoints.length]).toEqual([SESSION_DEAD, spawns + 30]);
  expect(ada.respawnPoints.slice(0, spawns).map((p) => p.name)).toEqual(h.world.spawns.map((p) => p.name));
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_RESPAWN, (w: BitWriter) => w.u8(spawns + 29));
  h.run(500);
  expect([code, ada.sessionState, Math.abs(ada.own.x - (g.x + 3 + 29 * 2.2)) < 0.5]).toEqual([RESULT_OK, SESSION_ALIVE, true]);
});

test("a bed is where its tribe returns to life: listed for them and nobody else, used once in five minutes, and stood on wherever it is", () => {
  const made = builder(["ada", "bob"]);
  const { h, at, join } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  const low = setDown(made, ada, "piece_bed", at.x - 3, at.z + 3);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(at.x * U), 32), w.sbits(Math.round((at.z + 6) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const f = h.host.build.last;
  const wall = join(ada, "wall", f, 2).ref;
  const floor = join(ada, "ceiling", wall, 1).ref;
  const t = h.world.structs.chunks[Math.floor(floor / 65536)]!;
  const high = setDown(made, ada, "piece_bed", t.x[floor & 0xffff]!, t.z[floor & 0xffff]!, floor);
  expect([kindAt(h, low), kindAt(h, high), h.host.fixtures.count]).toEqual([id("bed"), id("bed"), 2]);
  const top = h.world.structs.chunks[Math.floor(high / 65536)]!.y[high & 0xffff]! + 0.25;
  expect(top - at.y).toBeGreaterThan(3);

  const respawn = (s: ClientSession, index: number): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(CMD_RESPAWN, (w: BitWriter) => w.u8(index));
    h.run(300);
    return code;
  };
  // Beds are listed after the world's spawn points, for their tribe only.
  h.say(ada, "suicide");
  h.say(bob, "suicide");
  h.run(300);
  expect([ada.sessionState, bob.sessionState]).toEqual([SESSION_DEAD, SESSION_DEAD]);
  const spawns = h.world.spawns.length;
  expect(bob.respawnPoints.length).toBe(spawns);
  expect(ada.respawnPoints.slice(spawns).map((p) => [p.name.startsWith("bed at "), p.wait])).toEqual([[true, 0], [true, 0]]);
  const upstairs = ada.respawnPoints.findIndex((p, i) => i >= spawns && Math.abs(p.x - t.x[floor & 0xffff]!) < 0.01);
  const ground = ada.respawnPoints.findIndex((p, i) => i >= spawns && i !== upstairs);
  expect([respawn(bob, spawns), respawn(bob, 0), bob.sessionState]).toEqual([RESULT_INVALID, RESULT_OK, SESSION_ALIVE]);
  expect(respawn(ada, upstairs)).toBe(RESULT_OK);
  h.run(500);
  expect([ada.sessionState, Math.abs(ada.own.x - t.x[floor & 0xffff]!) < 0.5]).toEqual([SESSION_ALIVE, true]);
  expect(Math.abs(ada.own.y - top)).toBeLessThan(0.1);
  // A used bed has a five minute wait. The other bed has none.
  h.say(ada, "suicide");
  h.run(300);
  const wait = ada.respawnPoints[upstairs]!.wait;
  expect([wait > 280 && wait <= 300, ada.respawnPoints[ground]!.wait]).toEqual([true, 0]);
  expect([respawn(ada, upstairs), ada.sessionState]).toEqual([RESULT_WAIT, SESSION_DEAD]);
  expect([respawn(ada, ground), ada.sessionState]).toEqual([RESULT_OK, SESSION_ALIVE]);
  expect(Math.hypot(ada.own.x - (at.x - 3), ada.own.z - (at.z + 3))).toBeLessThan(0.5);
  // readyAt is moved up so the test need not run five minutes.
  h.say(ada, "suicide");
  h.run(300);
  expect(respawn(ada, ground)).toBe(RESULT_WAIT);
  const state = h.host.fixtures.find(high)!;
  state.readyAt = h.world.tick + 30;
  expect(BED_WAIT_TICKS).toBe(300 * TICK_RATE);
  h.run(1200);
  expect([respawn(ada, upstairs), ada.sessionState]).toEqual([RESULT_OK, SESSION_ALIVE]);
  h.say(ada, "suicide");
  h.run(300);
  h.world.structs.damage(low, 1e9, h.world.tick);
  h.run(200);
  expect([respawn(ada, ground), h.host.fixtures.count]).toEqual([RESULT_INVALID, 1]);
  expect(respawn(ada, 0)).toBe(RESULT_OK);
  expect(h.host.items.audit()).toEqual([]);
});

test("sparkpowder is made only at a mortar and pestle, from what lies in it and into it, for a survivor who knows its engram, who gets the experience; the queue goes on across a restart and is lost with the mortar", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-mortar-"));
  const dbPath = joinPath(dir, "world.db");
  const made = builder(["ada", "bob"], 40, 40, { dbPath });
  let { h } = made;
  const { at } = made;
  const [ada, bob] = made.sessions as [ClientSession, ClientSession];
  const spark = id("sparkpowder");
  const mortar = setDown(made, ada, "piece_mortar", at.x + 1, at.z + 1.5);
  const box = setDown(made, ada, "piece_storage_box", at.x - 1.5, at.z + 1.5);
  expect(kindAt(h, mortar)).toBe(id("mortar"));
  const send = (s: ClientSession, cmd: number, write: (w: BitWriter) => void): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(cmd, write);
    h.run(150);
    return code;
  };
  const use = (s: ClientSession, ref: number): number => send(s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
  const at_ = (s: ClientSession, item: number, n: number): number => send(s, CMD_CRAFT_AT, (w) => (w.u16(item), w.u8(n)));
  /** Gives the survivor `n` of the item and moves that many into the open box. */
  const put = (s: ClientSession, item: number, n: number): void => {
    h.say(s, `give ${reg.ids[item]!.slice(5)} ${n}`);
    const from = s.inventory!.item.indexOf(item);
    expect(send(s, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_OPEN, 1), w.varint(s.open!.inventory.free()), w.u16(n), w.u16(item)))).toBe(RESULT_OK);
  };
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;

  // The client lists what the mortar makes, from content: the item names it in craft.at.
  expect(stationRecipes(reg, id("mortar"))).toEqual([spark]);
  expect([reg.craftAt[spark], reg.craftAt[id("pick")]]).toEqual([id("mortar"), 0]);
  // With nothing open, or a box that is no station open, nothing is made at one.
  expect(at_(ada, spark, 1)).toBe(RESULT_DENIED);
  expect(use(ada, box)).toBe(RESULT_OK);
  expect([ada.open !== null, ada.station]).toEqual([true, null]);
  expect(at_(ada, spark, 1)).toBe(RESULT_INVALID);
  use(ada, box);

  // Opened, the mortar is a station with 24 slots and an empty queue.
  expect(use(ada, mortar)).toBe(RESULT_OK);
  expect([ada.open?.inventory.cap, ada.station]).toEqual([24, { kind: id("mortar"), jobs: [] }]);
  // Without the engram it is refused. The engram is ARK's: level 6 and 3 points.
  expect(at_(ada, spark, 1)).toBe(RESULT_DENIED);
  h.say(ada, "addxp 1000");
  expect(send(ada, CMD_LEARN, (w) => w.u16(id("engram-sparkpowder")))).toBe(RESULT_OK);
  // It is never made in the hands, and flint and stone in the survivor's bag are not the mortar's.
  h.say(ada, "give flint 10");
  h.say(ada, "give stone 10");
  expect(send(ada, CMD_CRAFT, (w) => (w.u16(spark), w.u8(1)))).toBe(RESULT_DENIED);
  expect(at_(ada, spark, 1)).toBe(RESULT_SHORT);
  expect(at_(ada, id("pick"), 1)).toBe(RESULT_INVALID);

  put(ada, id("flint"), 5);
  put(ada, id("stone"), 2);
  const state = h.host.fixtures.find(mortar)!;
  const inv = state.inv!;
  const xp = me.xp;
  const bag = ada.inventory!.total(id("flint"));
  // Three grinds asked for. The first takes its 2 flint and 1 stone at once, and each makes 2 in a second.
  expect(at_(ada, spark, 3)).toBe(RESULT_OK);
  expect([inv.total(id("flint")), inv.total(id("stone")), state.jobs.length, state.jobs[0]!.by]).toEqual([3, 1, 1, me.pid]);
  expect(ada.station!.jobs.map((j) => [j.item, j.left])).toEqual([[spark, 3]]);
  expect(me.jobs.length).toBe(0);
  h.run(1100);
  expect([inv.total(spark), inv.total(id("flint")), inv.total(id("stone"))]).toEqual([2, 1, 0]);
  h.run(1100);
  // The third had too little left, so the job ended and took nothing for it. The product is the mortar's; the experience, 0.24 a grind, is ada's.
  expect([inv.total(spark), inv.total(id("flint")), state.jobs.length, ada.station!.jobs]).toEqual([4, 1, 0, []]);
  expect([ada.inventory!.total(spark), ada.inventory!.total(id("flint")), state.xp]).toEqual([0, bag, 0]);
  expect(me.xp - xp).toBeCloseTo(0.48, 9);
  // The panel beside the open mortar lists sparkpowder with a button for the engram ada knows, and the button asks the
  // mortar for one grind, which one flint cannot make.
  const f = new UiFrame();
  f.begin(16 / 9);
  const panel = new StationPanel();
  panel.build(f, ada, reg, 400, 100, 474);
  expect([f.find(KEY_STATION_RECIPE)?.text, f.find(KEY_STATION_RECIPE + 1)?.text, f.find(KEY_STATION_JOB)?.text]).toEqual(["sparkpowder x2: 2 flint, 1 stone", "make", "nothing being made"]);
  let clicked = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (clicked = c));
  expect(panel.click(KEY_STATION_RECIPE + 1, ada, reg)).toBe(true);
  h.run(150);
  expect(clicked).toBe(RESULT_SHORT);

  // Bob may open ada's unlocked mortar, and is refused for not knowing the engram.
  use(ada, mortar);
  expect(use(bob, mortar)).toBe(RESULT_OK);
  expect(at_(bob, spark, 1)).toBe(RESULT_DENIED);
  use(bob, mortar);

  // A queue part made goes on across a restart, and its experience still goes to who asked for it.
  use(ada, mortar);
  put(ada, id("flint"), 9);
  put(ada, id("stone"), 4);
  expect(at_(ada, spark, 5)).toBe(RESULT_OK);
  h.run(500);
  const jobs = state.jobs.map((j) => ({ ...j }));
  expect(jobs).toEqual([{ item: spark, left: 5, doneAt: jobs[0]!.doneAt, by: me.pid }]);
  const sparkBefore = inv.total(spark);
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  const again = h.join("ada");
  h.run(600);
  const back = h.host.fixtures.find(mortar)!;
  const me2 = h.host.records.byPid.get(me.pid)!;
  const xp2 = me2.xp;
  expect(back.jobs[0]).toMatchObject({ item: spark, by: me.pid });
  h.run(5000);
  expect([back.inv!.total(spark), back.jobs.length]).toEqual([sparkBefore + 8, 0]);
  expect(me2.xp - xp2).toBeGreaterThan(0);
  expect(h.host.items.audit()).toEqual([]);

  // A mortar destroyed mid-job loses its queue and the grind under way; what it held lies where it stood.
  h.say(again, "enablecheats");
  h.host.items.mint(back, id("flint"), 4);
  h.host.items.mint(back, id("stone"), 2);
  expect(h.host.progression.craftAt(me2, back, spark, 2)).toBe(RESULT_OK);
  const left = back.inv!.total(spark);
  h.world.structs.damage(mortar, 1e9, h.world.tick);
  h.run(3000);
  expect([h.host.fixtures.find(mortar), h.host.records.byPid.has(back.pid)]).toEqual([null, false]);
  expect([back.inv, left]).toEqual([null, sparkBefore + 8]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
