import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { CMD_CRAFT, CMD_LEARN, CMD_REPAIR, CMD_SPEND, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { nodesOf, standFacing, swing as holdSwing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-harvest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(host = {}, name = "ada") {
  const h = new Harness({}, 1, 30, { dev: true, ...host });
  const s = h.join(name, { latencyMs: 30 });
  h.run(500);
  expect(h.say(s, "enablecheats")).toEqual(["cheats enabled"]);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const id = (item: string) => h.reg.index.get(item)!;
  const have = (item: string) => h.host.items.inv(rec).total(id(item));
  return { h, s, rec, id, have, pilot: h.pilots[0]!, ents: h.world.ents, items: h.host.items, harvest: h.host.harvest! };
}
const SPEED = STAT_NAMES.indexOf("speed");
const learn = (s: ClientSession, engram: number) => s.command(CMD_LEARN, (w) => w.u16(engram));
const craft = (s: ClientSession, item: number, count = 1) => s.command(CMD_CRAFT, (w) => (w.u16(item), w.u8(count)));

test("a tree is gathered by hand until it is used up, is gone for everyone, and grows back when nobody is near", () => {
  const { h, s, have, pilot, harvest, rec } = setup();
  const tree = nodesOf(h, "core:tree", 256, 256).find((t) => standFacing(h, s, pilot, t));
  const table = () => harvest.field.store.chunks[tree!.chunk]!;
  expect(table().kind[tree!.index]).toBe(h.reg.index.get("core:tree")!);
  expect(table().hp[tree!.index]).toBe(12);
  expect(s.world!.nodes!.chunks[tree!.chunk]!.kind[tree!.index]).toBe(table().kind[tree!.index]!); // the client has the same tree

  // Three seconds of holding the button is six swings, half a second apart.
  holdSwing(h, pilot, 6, SWING_TICKS);
  expect(harvest.hits).toBe(6);
  expect(table().hp[tree!.index]).toBe(6);
  expect(have("core:thatch")).toBeGreaterThanOrEqual(12);
  expect(have("core:thatch")).toBeLessThanOrEqual(24);
  expect(have("core:wood")).toBeLessThanOrEqual(6); // by hand, at most one a hit
  expect(rec.xp).toBe(6);
  expect(s.inventory!.total(h.reg.index.get("core:thatch")!)).toBe(have("core:thatch"));
  expect(s.progress.xp).toBe(6);
  expect(s.progress.level).toBe(2);

  // Six more hits and it is gone, and the client can walk where it stood.
  holdSwing(h, pilot, 7, SWING_TICKS); // the seventh finds nothing there
  expect(harvest.hits).toBe(12);
  expect(table().kind[tree!.index]).toBe(0);
  expect(s.world!.nodes!.chunks[tree!.chunk]!.kind[tree!.index]).toBe(0);
  expect(harvest.goneCount).toBe(1);
  const corrections = s.stats.corrections;
  pilot.pitch = 0;
  pilot.moveZ = 1;
  h.run(1500);
  pilot.moveZ = 0;
  h.run(300);
  const e = h.ent(s);
  expect(Math.hypot(h.world.ents.x[e]! - tree!.x, h.world.ents.z[e]! - tree!.z)).toBeGreaterThan(2.5); // walked through its place
  expect(s.stats.corrections).toBe(corrections);
  const bo = h.join("bo");
  h.run(500);
  expect(bo.world!.nodes!.chunks[tree!.chunk]?.kind[tree!.index] ?? 0).toBe(0);

  // It grows back after two game hours, but not while someone stands by it.
  h.say(s, `tp ${tree!.x.toFixed(2)} ${(tree!.z + 3).toFixed(2)}`);
  const due = h.world.tick + 2 * GAME_HOUR_TICKS;
  while (h.world.tick < due + 60) h.server.tick();
  expect(table().kind[tree!.index]).toBe(0);
  h.say(s, "tp 256 240");
  h.say(bo, "enablecheats");
  h.say(bo, "tp 256 244");
  while (h.world.tick < due + 60 * 30 + 120) h.server.tick();
  h.run(500);
  expect(harvest.goneCount).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
  h.say(s, `tp ${tree!.x.toFixed(2)} ${(tree!.z + 3).toFixed(2)}`);
  h.run(500);
  expect(table().kind[tree!.index]).toBe(h.reg.index.get("core:tree")!);
  expect(table().hp[tree!.index]).toBe(12);
  expect(s.world!.nodes!.chunks[tree!.chunk]!.kind[tree!.index]).toBe(table().kind[tree!.index]!);
});

test("a pick gets three times the stone and flint besides, wears with each hit, and breaks; a bush is picked, not struck", () => {
  const { h, s, have, pilot, harvest, rec, items, id } = setup();
  const swing = (n: number): void => holdSwing(h, pilot, n, SWING_TICKS);
  const rocks = nodesOf(h, "core:rock", 256, 256);
  const rock = rocks.find((r) => standFacing(h, s, pilot, r, 1.9))!;
  swing(3);
  const byHand = have("core:stone");
  expect(byHand).toBeGreaterThanOrEqual(3);
  expect(byHand).toBeLessThanOrEqual(6);
  expect(have("core:flint")).toBe(0); // flint needs a tool

  // A pick in the bag does nothing. It works from the hand.
  h.say(s, "give pick");
  swing(1);
  expect(have("core:flint")).toBe(0);
  expect(items.inv(rec).dur[items.inv(rec).item.indexOf(id("core:pick"))]).toBe(60);
  const slot = takeInHand(h, s, id("core:pick"));
  expect(slot).toBe(items.inv(rec).hotbar);
  expect(rec.held).toBe(0);
  items.inv(rec).setDur(slot, 4);
  const withPick = have("core:stone");
  swing(3);
  expect(have("core:stone") - withPick).toBeGreaterThanOrEqual(9);
  expect(have("core:flint")).toBeGreaterThanOrEqual(9);
  expect(items.inv(rec).dur[slot]).toBe(1);
  expect(s.inventory!.dur[slot]).toBe(1); // the client sees the wear
  swing(1);
  // A broken pick stays in the slot, is not burned, and gathers no more than a bare hand.
  expect(have("core:pick")).toBe(1);
  expect(items.inv(rec).dur[slot]).toBe(0);
  expect(items.burned[id("core:pick")]).toBe(0);
  const flint = have("core:flint");
  const before = have("core:stone");
  swing(1);
  expect(have("core:stone") - before).toBeLessThanOrEqual(2);
  expect(have("core:flint")).toBe(flint);
  expect(items.inv(rec).dur[slot]).toBe(0);
  expect(harvest.hits).toBe(9);
  // A repair takes half of what the pick is made of (one stone, one wood, ten thatch), rounded up, and restores full durability.
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const repair = (): number => {
    codes.length = 0;
    s.command(CMD_REPAIR, (w) => w.varint(slot));
    h.run(200);
    return codes[0]!;
  };
  expect(repair()).toBe(RESULT_SHORT); // no wood, no thatch
  h.say(s, "give wood 3");
  h.say(s, "give thatch 8");
  const stone = have("core:stone");
  expect(repair()).toBe(RESULT_OK);
  expect(items.inv(rec).dur[slot]).toBe(60);
  expect([stone - have("core:stone"), have("core:wood"), have("core:thatch")]).toEqual([1, 2, 3]);
  expect(repair()).toBe(RESULT_INVALID); // nothing to mend
  expect(items.audit()).toEqual([]);
  swing(1);
  expect(have("core:flint")).toBeGreaterThan(flint);
  expect(harvest.hits).toBe(10);

  // Far from anything, swinging does nothing.
  h.say(s, "tp 256 240");
  swing(4);
  expect(harvest.hits).toBe(10);
  // 6 m from a rock, looking straight at it, is out of reach.
  expect(standFacing(h, s, pilot, nodesOf(h, "core:rock", rock.x + 30, rock.z)[0]!, 6)).toBe(true);
  swing(3);
  expect(harvest.hits).toBe(10);

  const bush = nodesOf(h, "core:bush", 256, 256).find((b) => standFacing(h, s, pilot, b, 1.4))!;
  swing(3);
  expect(have("core:berry")).toBe(0);
  for (let i = 0; i < 4; i++) {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(200);
  }
  expect(have("core:berry")).toBeGreaterThanOrEqual(12);
  expect(have("core:fiber")).toBeGreaterThanOrEqual(8);
  expect(harvest.field.store.chunks[bush.chunk]!.kind[bush.index]).toBe(0); // four picks and it is bare
  expect(items.audit()).toEqual([]);
});

test("touched nodes are saved and nothing else about nodes is; a save from before nodes gains the table", () => {
  const db = join(dir, "nodes.db");
  const { h, s, pilot, harvest } = setup({ dbPath: db });
  const trees = nodesOf(h, "core:tree", 256, 256)
    .slice(0, 12)
    .filter((t) => standFacing(h, s, pilot, t));
  const [a, b] = trees;
  standFacing(h, s, pilot, a!);
  holdSwing(h, pilot, 5, SWING_TICKS);
  standFacing(h, s, pilot, b!);
  holdSwing(h, pilot, 13, SWING_TICKS);
  expect(harvest.goneCount).toBe(1);
  h.host.shutdown();

  // The save holds only the two touched nodes, out of thousands on the map.
  const store = new WorldStore(db, h.reg);
  const blobs = store.loadBlobs(harvest.tag);
  expect(blobs.length).toBeLessThanOrEqual(2);
  expect(blobs.reduce((n, row) => n + row.data.length, 0)).toBeLessThan(40);
  // Makes the save look like one from before nodes existed, with no table and schema 1.
  store.db.exec("DROP TABLE chunk_blobs");
  store.db.exec("UPDATE meta SET value = 1 WHERE key = 'schema_version'");
  store.close();
  const old = new Harness({}, 1, 30, { dbPath: db, dev: true });
  expect(Number(old.host.persistence!.store.meta("schema_version"))).toBe(2);
  expect(old.host.harvest!.goneCount).toBe(0); // the table is there and empty, so every node stands
  old.host.shutdown();

  // After a restart the standing tree keeps its damage, and the felled one stays down and keeps its regrow time.
  const db2 = join(dir, "nodes2.db");
  const w = setup({ dbPath: db2 });
  standFacing(w.h, w.s, w.pilot, a!);
  holdSwing(w.h, w.pilot, 5, SWING_TICKS);
  standFacing(w.h, w.s, w.pilot, b!);
  holdSwing(w.h, w.pilot, 13, SWING_TICKS);
  const felledAt = w.h.world.tick;
  w.h.host.shutdown();
  const h2 = new Harness({}, 1, 30, { dbPath: db2, dev: true });
  const s2 = h2.join("ada");
  h2.run(500);
  const store2 = h2.host.harvest!.field.store;
  expect(store2.chunks[a!.chunk]!.hp[a!.index]).toBe(7);
  expect(store2.chunks[b!.chunk]?.kind[b!.index] ?? 0).toBe(0);
  expect(s2.world!.nodes!.chunks[b!.chunk]?.kind[b!.index] ?? 0).toBe(0);
  expect(h2.host.harvest!.goneCount).toBe(1);
  h2.say(s2, "enablecheats");
  h2.say(s2, "tp 256 240");
  while (h2.world.tick < felledAt + 2 * GAME_HOUR_TICKS + 30) h2.server.tick();
  expect(h2.host.harvest!.goneCount).toBe(0);
  h2.host.shutdown();
});

test("experience earns levels, levels earn points, points buy stats and engrams, and engrams allow crafting", () => {
  const { h, s, rec, id, have, ents, items } = setup();
  const e = h.ent(s);
  const prog = h.host.progression;
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const pick = id("core:engram-pick");
  const hatchet = id("core:engram-hatchet");
  const makePick = id("core:pick");
  const send = (f: () => void): number => {
    codes.length = 0;
    f();
    h.run(200);
    return codes[0]!;
  };

  expect([prog.levelOf(0), prog.levelOf(4.9), prog.levelOf(5), prog.levelOf(39), prog.levelOf(40), prog.levelOf(1e9)]).toEqual([1, 1, 2, 3, 4, 100]);
  expect(send(() => s.command(CMD_SPEND, (w) => w.u8(SPEED)))).toBe(RESULT_SHORT);
  expect(send(() => learn(s, hatchet))).toBe(RESULT_SHORT);
  expect(send(() => craft(s, makePick))).toBe(RESULT_DENIED);
  expect(send(() => learn(s, id("core:stone")))).toBe(RESULT_INVALID); // not an engram
  // The pick engram is free at level 1.
  expect(send(() => learn(s, pick))).toBe(RESULT_OK);
  expect(send(() => learn(s, pick))).toBe(RESULT_INVALID);
  expect(send(() => craft(s, makePick))).toBe(RESULT_SHORT);
  expect(s.progress.engrams).toEqual([pick]);

  expect(h.say(s, "addxp 20")[0]).toBe("level 3, 20 experience, 2 stat points and 16 engram points to spend");
  expect(s.progress.level).toBe(3);
  expect([s.progress.statPoints, s.progress.engramPoints]).toEqual([2, 16]);
  expect(ents.level[e]).toBe(3); // what others see
  expect(send(() => s.command(CMD_SPEND, (w) => w.u8(SPEED)))).toBe(RESULT_OK);
  expect(send(() => s.command(CMD_SPEND, (w) => w.u8(SPEED)))).toBe(RESULT_OK);
  expect(send(() => s.command(CMD_SPEND, (w) => w.u8(SPEED)))).toBe(RESULT_SHORT);
  expect(send(() => s.command(CMD_SPEND, (w) => w.u8(200)))).toBe(RESULT_INVALID);
  expect(ents.speedQ[e]).toBe(1030); // 1.5% a point
  expect(s.own.speedQ).toBe(1030);
  expect(send(() => learn(s, hatchet))).toBe(RESULT_OK);
  expect(s.progress.engramPoints).toBe(13);

  // Each pick's ingredients go when it is started, and the pick appears two seconds later.
  h.say(s, "give stone 3");
  h.say(s, "give wood 2");
  h.say(s, "give thatch 30");
  expect(send(() => craft(s, makePick, 3))).toBe(RESULT_OK);
  expect([have("core:stone"), have("core:wood"), have("core:thatch"), have("core:pick")]).toEqual([2, 1, 20, 0]);
  expect(s.progress.jobs.length).toBe(1);
  h.run(2000);
  expect(have("core:pick")).toBe(1);
  expect(have("core:thatch")).toBe(10); // the second is under way
  h.run(2200);
  // The third had no wood, so the job ended and took nothing for it.
  expect([have("core:stone"), have("core:wood"), have("core:thatch"), have("core:pick")]).toEqual([1, 0, 10, 2]);
  expect(rec.jobs.length).toBe(0);
  expect(s.progress.jobs.length).toBe(0);
  expect(rec.xp).toBe(24); // two for each pick
  expect(items.inv(rec).dur[items.inv(rec).item.indexOf(id("core:pick"))]).toBe(60); // crafted at full durability
  expect(items.audit()).toEqual([]);
  expect(send(() => craft(s, makePick, 0))).toBe(RESULT_INVALID);
  expect(send(() => craft(s, id("core:stone")))).toBe(RESULT_INVALID);
});

test("a crafting job goes on across a restart, and waits when there is no room for what it makes", () => {
  const db = join(dir, "jobs.db");
  const { h, s, rec, id, have, items } = setup({ dbPath: db });
  learn(s, id("core:engram-pick"));
  h.say(s, "give stone 2");
  h.say(s, "give wood 2");
  h.say(s, "give thatch 20");
  craft(s, id("core:pick"), 2);
  h.run(1000);
  expect(have("core:pick")).toBe(0);
  const doneAt = rec.jobs[0]!.doneAt;
  h.host.shutdown();

  const h2 = new Harness({}, 1, 30, { dbPath: db, dev: true });
  const rec2 = h2.host.records.byPid.get(rec.pid)!;
  expect(rec2.jobs).toEqual([{ item: id("core:pick"), left: 2, doneAt }]);
  expect(rec2.engrams).toEqual([id("core:engram-pick")]);
  // Fill every free slot, so the pick has nowhere to go.
  const inv = h2.host.items.inv(rec2);
  const skin = id("core:waterskin");
  h2.host.items.mint(rec2, skin, inv.cap);
  expect(inv.used()).toBe(inv.bag); // the bag is full, and crafted items do not go to hotbar or armor slots
  while (h2.world.tick < doneAt + 90) h2.server.tick();
  expect(inv.total(id("core:pick"))).toBe(0);
  expect(rec2.jobs[0]!.left).toBe(2); // still waiting, nothing lost
  h2.host.items.burn(rec2, inv.item.indexOf(skin), 1);
  while (h2.world.tick < doneAt + 90 + 31) h2.server.tick();
  expect(inv.total(id("core:pick"))).toBe(1);
  h2.host.items.burn(rec2, inv.item.indexOf(skin), 1);
  while (h2.world.tick < doneAt + 300) h2.server.tick();
  expect(inv.total(id("core:pick"))).toBe(2);
  expect(rec2.jobs.length).toBe(0);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
  void items;
});
