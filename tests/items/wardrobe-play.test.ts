// A survivor dressed as one plays: a full hotbar, hide armor, a bag of things, and two garments, each an edition and dyed.
// The edition and the dye go with each garment on every path it takes: moved, swapped and put on, dropped and taken up, in
// a cache, given, saved and started again, to another map, and off a body that died and looted back.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { corpseWardrobe } from "../../server/corpses.ts";
import { captureLoadout } from "../../server/loadout/capture.ts";
import type { EntityRecord } from "../../server/records.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_DROP, CMD_MOVE, CMD_RESPAWN, CMD_TAKE, CMD_USE, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { JET_CUIRASS } from "../../shared/sim/character.ts";
import { ARMOR_SLOTS, Inventory, WARDROBE_SLOTS } from "../../shared/sim/items.ts";
import { TestCluster, keyAt, rec as clusterRec, rise, travel } from "../fixtures/cluster.ts";
import { Harness } from "../fixtures/net.ts";
import { editionOf } from "../fixtures/editions.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-wardrobe-"));
const cluster = new TestCluster();
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  cluster.cleanup();
});

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const tee = id("tee");
const trousers = id("jeans");
const dye = (a: number, b: number, c: number): number => a | (b << 8) | (c << 16);
// The first two editions a fresh people store gives, which dress publishes.
const TEE = [tee, 1, dye(12, 40, 3)];
const TROUSERS = [trousers, 2, dye(0, 22, 0)];

/** Fills a survivor's hotbar, armor and bag, and puts on a dyed edition of the tee and of the trousers. */
function dress(h: Harness, me: EntityRecord): void {
  const items = h.host.items;
  const inv = items.inv(me);
  ["hatchet", "pick", "spear", "bow", "torch", "waterskin", "slingshot", "club"].forEach((name, k) => expect(items.mintAt(me, inv.hotbar + k, id(name), 1, 1)).toBe(1));
  expect(items.mintAt(me, inv.hotbar + 8, id("arrow_stone"), 40)).toBe(40);
  expect(items.mintAt(me, inv.hotbar + 9, id("berry"), 12)).toBe(12);
  ["hat", "shirt", "gloves", "pants", "boots"].forEach((piece, k) => expect(items.mintAt(me, inv.armor + k, id(`hide_${piece}`), 1, 2)).toBe(1));
  expect(items.mint(me, id("stone"), 230)).toBe(230);
  expect(items.mint(me, id("wood"), 75)).toBe(75);
  expect(items.mint(me, id("fiber"), 300)).toBe(300);
  expect(items.mintAt(me, inv.wardrobe, tee, 1)).toBe(1);
  expect(items.mintAt(me, inv.wardrobe + 1, trousers, 1)).toBe(1);
  expect([editionOf(h.host, "core:tee"), editionOf(h.host, "core:jeans")]).toEqual([TEE[1]!, TROUSERS[1]!]);
  expect(items.restyle(me, inv.wardrobe, TEE[1]!, TEE[2]!)).toBe(true);
  expect(items.restyle(me, inv.wardrobe + 1, TROUSERS[1]!, TROUSERS[2]!)).toBe(true);
  h.run(200);
}

/** Every styled stack an inventory holds, as item, edition and dye, sorted. */
function styled(inv: Inventory): number[][] {
  const out: number[][] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && (inv.editionOf(s) !== 0 || inv.dyeOf(s) !== 0)) out.push([inv.item[s]!, inv.editionOf(s), inv.dyeOf(s)]);
  return out.sort((a, b) => a[0]! - b[0]!);
}

/** The wardrobe as item, edition and dye per slot. */
function wardrobe(inv: Inventory): number[][] {
  return Array.from({ length: WARDROBE_SLOTS }, (_, k) => [inv.item[inv.wardrobe + k]!, inv.editionOf(inv.wardrobe + k), inv.dyeOf(inv.wardrobe + k)]);
}

const EMPTY = [0, 0, 0];
const WORN = [TEE, TROUSERS, EMPTY, EMPTY, EMPTY];

/** Sends a command and runs on until the server answers it. Its result, or -1. */
function send(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  const was = s.onResult;
  const seq = s.command(op, write);
  s.onResult = (n, c) => void (n === seq && (code = c));
  for (let k = 0; k < 40 && code < 0; k++) h.run(25);
  s.onResult = was;
  h.run(100);
  return code;
}

function move(h: Harness, s: ClientSession, from: number, to: number, item: number, fromBox = BOX_SELF, toBox = BOX_SELF): number {
  return send(h, s, CMD_MOVE, (w) => (w.bits(fromBox, 1), w.varint(from), w.bits(toBox, 1), w.varint(to), w.u16(0), w.u16(item)));
}

function setup(dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, ...(dbPath ? { dbPath } : {}) });
  const s = h.join("ada");
  h.run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  dress(h, me);
  return { h, s, me, inv: h.host.items.inv(me) };
}

test("the owner's client sees each edition and dye, and they follow moves, swaps and putting on", () => {
  const { h, s, me, inv } = setup();
  try {
    const mine = (): Inventory => s.inventory!;
    expect([mine().cap, mine().wardrobe]).toEqual([inv.cap, inv.wardrobe]);
    expect(wardrobe(mine())).toEqual(WORN);
    for (let slot = 0; slot < inv.cap; slot++) expect([mine().item[slot], mine().editionOf(slot), mine().dyeOf(slot)]).toEqual([inv.item[slot], inv.editionOf(slot), inv.dyeOf(slot)]);
    // The tee off into the bag, then a stone and a shirt of armor refused where it was.
    const free = inv.free();
    expect(move(h, s, inv.wardrobe, free, tee)).toBe(RESULT_OK);
    expect([inv.item[free], inv.editionOf(free), inv.dyeOf(free), mine().editionOf(free), mine().dyeOf(free)]).toEqual([tee, TEE[1], TEE[2], TEE[1], TEE[2]]);
    expect(mine().item[inv.wardrobe]).toBe(0);
    expect(move(h, s, inv.item.indexOf(id("stone")), inv.wardrobe, id("stone"))).toBe(RESULT_INVALID);
    expect(move(h, s, inv.armor + 1, inv.wardrobe, id("hide_shirt"))).toBe(RESULT_INVALID);
    expect(move(h, s, free, inv.wardrobe + 1, tee)).toBe(RESULT_INVALID);
    // Used, it goes on; used again, it comes off.
    expect(send(h, s, CMD_USE, (w) => (w.varint(free), w.u16(tee)))).toBe(RESULT_OK);
    expect(wardrobe(mine())).toEqual(WORN);
    expect(send(h, s, CMD_USE, (w) => (w.varint(inv.wardrobe), w.u16(tee)))).toBe(RESULT_OK);
    const off = inv.item.indexOf(tee);
    expect([off < inv.bag, inv.editionOf(off), mine().dyeOf(off)]).toEqual([true, TEE[1], TEE[2]]);
    // A plain tee put on, then the dyed one swapped onto it: each keeps its own.
    expect(h.host.items.mintAt(me, inv.wardrobe, tee, 1)).toBe(1);
    h.run(100);
    expect(move(h, s, off, inv.wardrobe, tee)).toBe(RESULT_OK);
    expect(wardrobe(mine())).toEqual(WORN);
    expect([inv.item[off], inv.editionOf(off), inv.dyeOf(off), mine().editionOf(off)]).toEqual([tee, 0, 0, 0]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a garment dropped and taken up again is the same edition, dyed the same", () => {
  const { h, s, inv } = setup();
  try {
    expect(send(h, s, CMD_DROP, (w) => (w.varint(inv.wardrobe + 1), w.u16(0), w.u16(trousers)))).toBe(RESULT_OK);
    const bag = [...h.host.records.byPid.values()].find((r) => r.kind === id("bag"))!;
    expect(styled(h.host.items.inv(bag))).toEqual([TROUSERS]);
    expect(send(h, s, CMD_TAKE, (w) => w.u32(h.host.records.entOf.get(bag.pid)!))).toBe(RESULT_OK);
    expect(h.host.records.byPid.has(bag.pid)).toBe(false);
    expect(styled(inv)).toEqual([TEE, TROUSERS].sort((a, b) => a[0]! - b[0]!));
    const back = inv.item.indexOf(trousers);
    expect(back < inv.bag).toBe(true);
    expect([s.inventory!.editionOf(back), s.inventory!.dyeOf(back)]).toEqual([TROUSERS[1], TROUSERS[2]]);
    expect(move(h, s, back, inv.wardrobe + 1, trousers)).toBe(RESULT_OK);
    expect(wardrobe(inv)).toEqual(WORN);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a cache holds an edition and a dye, and gives them back", () => {
  const { h, s, inv } = setup();
  try {
    const e = h.ent(s);
    const cache = h.host.death.spill(h.world.ents.x[e]! + 1, h.world.ents.y[e]!, h.world.ents.z[e]!, "test cache");
    // An empty cache goes, so it holds a stone.
    expect(h.host.items.mint(cache, id("stone"), 1)).toBe(1);
    h.client(s)!.open = cache.pid;
    h.run(200);
    expect(move(h, s, inv.wardrobe, 1, tee, BOX_SELF, BOX_OPEN)).toBe(RESULT_OK);
    expect(move(h, s, inv.wardrobe + 1, 2, trousers, BOX_SELF, BOX_OPEN)).toBe(RESULT_OK);
    const box = h.host.items.inv(cache);
    expect(styled(box)).toEqual([TEE, TROUSERS]);
    // What the client has of the open box carries them too.
    expect([s.open!.inventory.editionOf(1), s.open!.inventory.dyeOf(2)]).toEqual([TEE[1], TROUSERS[2]]);
    expect(wardrobe(inv)).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
    expect(move(h, s, 2, inv.wardrobe + 1, trousers, BOX_OPEN, BOX_SELF)).toBe(RESULT_OK);
    expect(move(h, s, 1, inv.wardrobe, tee, BOX_OPEN, BOX_SELF)).toBe(RESULT_OK);
    expect(wardrobe(inv)).toEqual(WORN);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a garment given to another keeps its edition and dye, and a styled stack never joins a plain one", () => {
  const { h, me, inv } = setup();
  try {
    const bo = h.join("bo");
    h.run(500);
    const other = h.host.records.byPid.get(h.client(bo)!.pid)!;
    const items = h.host.items;
    expect(move(h, h.sessions[0]!, inv.wardrobe, inv.free(), tee)).toBe(RESULT_OK);
    expect(items.give(me, other, tee, 1)).toBe(true);
    const theirs = items.inv(other);
    expect(styled(theirs)).toEqual([TEE]);
    // Fiber of an edition given onto a bag that holds plain fiber lies in a stack of its own.
    expect(items.mint(other, id("fiber"), 10)).toBe(10);
    const fiber = inv.item.indexOf(id("fiber"));
    // No edition is of fiber, so the column is set as a load or a parcel from another build might set it.
    inv.setStyle(fiber, 3, 0);
    expect(items.give(me, other, id("fiber"), 300)).toBe(true);
    const stacks: number[][] = [];
    for (let slot = 0; slot < theirs.bag; slot++) if (theirs.item[slot] === id("fiber")) stacks.push([theirs.count[slot]!, theirs.editionOf(slot)]);
    expect(stacks.sort((a, b) => a[1]! - b[1]!)).toEqual([[10, 0], [300, 3]]);
    h.run(200);
    expect(bo.inventory!.editionOf(theirs.item.indexOf(tee))).toBe(TEE[1]);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a give that would not fit is refused whole, and a styled stack takes a slot of its own", () => {
  const { h } = setup();
  try {
    const items = h.host.items;
    const from = h.host.death.spill(0, 0, 0, "from");
    const to = h.host.death.spill(4, 0, 0, "to");
    from.inv = new Inventory(3);
    to.inv = new Inventory(2);
    // Plain stone at 60 and one free slot: two stacks of ninety of an edition need two slots, as plain stone would not.
    expect(items.mint(to, id("stone"), 60)).toBe(60);
    expect(items.mint(from, id("stone"), 180)).toBe(180);
    from.inv.setStyle(0, 4, 0);
    from.inv.setStyle(1, 4, 0);
    expect([from.inv.count[0], from.inv.count[1]]).toEqual([100, 80]);
    expect(items.give(from, to, id("stone"), 180)).toBe(false);
    expect([items.inv(to).total(id("stone")), items.inv(from).total(id("stone"))]).toEqual([60, 180]);
    expect(items.give(from, to, id("stone"), 90)).toBe(true);
    expect(styled(items.inv(to))).toEqual([[id("stone"), 4, 0]]);
    expect(items.inv(to).count[0]).toBe(60);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("editions and dyes are saved, and the survivor has them after a restart", () => {
  const db = join(dir, "restart.db");
  const { h, s, me, inv } = setup(db);
  const pid = me.pid;
  const before = styled(inv);
  const items = [...inv.item];
  s.close();
  h.run(300);
  h.host.shutdown();
  const h2 = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const back = h2.host.items.inv(h2.host.records.byPid.get(pid)!);
    expect(styled(back)).toEqual(before);
    expect([...back.item]).toEqual(items);
    expect(wardrobe(back)).toEqual(WORN);
    const again = h2.join("ada");
    h2.run(600);
    expect(wardrobe(again.inventory!)).toEqual(WORN);
    expect(h2.host.items.audit()).toEqual([]);
  } finally {
    h2.host.shutdown();
  }
});

test("a survivor who travels to another map arrives wearing the same editions and dyes", () => {
  const clock = { ms: Date.now() };
  const a = cluster.server("Island", "dressed", clock);
  const b = cluster.server("Miami", "dressed", clock);
  try {
    const ada = a.h.join("ada", {}, { key: keyAt("ada", 1) });
    a.h.run(300);
    const me = clusterRec(a, "ada")!;
    dress(a.h, me);
    const before = styled(a.h.host.items.inv(me));
    const ticket = travel(a, ada, b.world);
    expect(ticket).toBeInstanceOf(Uint8Array);
    clock.ms += 30_000;
    const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket: ticket as Uint8Array });
    b.h.run(400);
    rise(b, there);
    const binv = b.h.host.items.inv(clusterRec(b, "ada")!);
    expect(styled(binv)).toEqual(before);
    expect(wardrobe(binv)).toEqual(WORN);
    expect(wardrobe(there.inventory!)).toEqual(WORN);
    expect(cluster.audit(a, b)).toEqual([]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("a survivor's body keeps what it wore, through a restart, and its cache gives the garments back as they were", () => {
  const db = join(dir, "died.db");
  const { h, s, me } = setup(db);
  const pid = me.pid;
  const look = me.look!.slice();
  expect(h.say(s, "enablecheats")[0]).toMatch(/cheats/);
  expect(h.say(s, "suicide")).toEqual(["You were killed."]);
  h.run(300);
  const body = [...h.host.corpses.bodies.values()].find((b) => b.kind === me.kind)!;
  expect([...corpseWardrobe(body.rec)!]).toEqual(WORN.flat());
  const cache = [...h.host.records.byPid.values()].find((r) => r.kind === id("cache"))!;
  expect(styled(h.host.items.inv(cache))).toEqual([TEE, TROUSERS]);
  h.run(300);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const again = [...h2.host.corpses.bodies.values()].find((b) => b.kind === me.kind)!;
    expect([...corpseWardrobe(again.rec)!]).toEqual(WORN.flat());
    expect([...again.rec.look!]).toEqual([...look]);
    const kept = h2.host.records.byPid.get(cache.pid)!;
    expect(styled(h2.host.items.inv(kept))).toEqual([TEE, TROUSERS]);
    // Risen beside it, the survivor opens its cache and puts the two back on.
    const s2 = h2.join("ada");
    h2.run(600);
    expect(send(h2, s2, CMD_RESPAWN, (w) => (w.u8(0), w.u8(s2.placesList)))).toBe(RESULT_OK);
    h2.run(300);
    const rec2 = h2.host.records.byPid.get(pid)!;
    const e = h2.ent(s2);
    h2.world.ents.setPosition(e, kept.x + 1, kept.y, kept.z);
    h2.run(100);
    h2.client(s2)!.open = kept.pid;
    h2.run(200);
    const box = h2.host.items.inv(kept);
    const mine = h2.host.items.inv(rec2);
    expect(move(h2, s2, box.item.indexOf(tee), mine.wardrobe, tee, BOX_OPEN, BOX_SELF)).toBe(RESULT_OK);
    expect(move(h2, s2, box.item.indexOf(trousers), mine.wardrobe + 1, trousers, BOX_OPEN, BOX_SELF)).toBe(RESULT_OK);
    expect(wardrobe(mine)).toEqual(WORN);
    expect(wardrobe(s2.inventory!)).toEqual(WORN);
    expect(h2.host.items.audit()).toEqual([]);
  } finally {
    h2.host.shutdown();
  }
});

test("a body's worn gear is worked out again when the armor changes and on a new body, and a shot changes no stamp", () => {
  const db = join(dir, "worn.db");
  const h = new Harness({}, 1, 60, { dev: true, dbPath: db });
  try {
    const s = h.join("ada");
    h.run(500);
    h.say(s, "enablecheats");
    expect(h.say(s, "armor meridian")[0]).not.toMatch(/^no /);
    h.run(200);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const inv = h.host.items.inv(me);
    expect(h.world.ents.jetGear[h.ent(s)]! & JET_CUIRASS).not.toBe(0);
    // Rounds spent from a weapon in hand leave the stamp alone.
    expect(h.host.items.mintAt(me, inv.hotbar, id("bow"), 1)).toBe(1);
    expect(h.host.items.mintLoaded(me, inv.hotbar, id("arrow_stone"), 5)).toBe(5);
    h.run(100);
    const stamp = inv.worn;
    for (let k = 0; k < 3; k++) expect(h.host.items.spend(me, inv.hotbar)).toBe(true);
    h.run(100);
    expect(inv.worn).toBe(stamp);
    // The cuirass off: its bit goes. On again: it comes back.
    const cuirass = inv.item[inv.armor + 1]!;
    const free = inv.free();
    expect(move(h, s, inv.armor + 1, free, cuirass)).toBe(RESULT_OK);
    expect(h.world.ents.jetGear[h.ent(s)]! & JET_CUIRASS).toBe(0);
    expect(move(h, s, free, inv.armor + 1, cuirass)).toBe(RESULT_OK);
    expect(h.world.ents.jetGear[h.ent(s)]! & JET_CUIRASS).not.toBe(0);
    // Away and back: a new body, with the same inventory, flies again.
    s.close();
    h.run(300);
    const again = h.join("ada");
    h.run(600);
    expect(h.host.items.inv(h.host.records.byPid.get(me.pid)!).worn).toBe(inv.worn);
    expect(h.world.ents.jetGear[h.ent(again)]! & JET_CUIRASS).not.toBe(0);
    expect(h.world.ents.gears.get(h.ent(again))!.slice(1, 1 + ARMOR_SLOTS)).toEqual(inv.item.slice(inv.armor, inv.armor + ARMOR_SLOTS));
  } finally {
    h.host.shutdown();
  }
});

test("a loadout taken from a dressed survivor keeps its garments, in the bag and plain", () => {
  const { h, me } = setup();
  try {
    const entries = captureLoadout(h.host, me);
    const garments = entries.filter((e) => "item" in e && (e.item === "core:tee" || e.item === "core:jeans"));
    expect(garments).toEqual([{ item: "core:tee", count: 1, place: "bag" }, { item: "core:jeans", count: 1, place: "bag" }]);
  } finally {
    h.host.shutdown();
  }
});
