import { BLOCKED_OUT } from "../../content/items/blockouts.ts";
import { JET_ARMS } from "../../content/vehicles/jet.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { DRAW_NEAR, DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { KEY_HOTBAR } from "../../client/core/ui/hud.ts";
import { KEY_HOTBAR_LIT } from "../../client/core/hud/hotbar.ts";
import { KEY_INV_ACTION, KEY_INV_PANEL, KEY_INV_ROW_LABEL, KEY_INV_SLOT, KEY_INV_INFO } from "../../client/core/ui/inventory.ts";
import { K_TEXT, textWidth, type UiFrame } from "../../client/core/ui/nodes.ts";
import { BAG_TICKS } from "../../server/death.ts";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { BitReader, type BitWriter } from "../../shared/net/codec.ts";
import {
  BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_DETACH, CMD_DROP, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_SELECT, CMD_UNLOAD, CMD_USE, RESULT_DENIED, RESULT_FULL, RESULT_INVALID,
  RESULT_OK, RESULT_STALE,
} from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS, GEAR_SLOTS, HOTBAR_SLOTS, Inventory, QUALITY_MUL, fitsSlot, moveSlot } from "../../shared/sim/items.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-gear-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** A survivor with cheats. send() and move() send one command and return its result code, or -1 if none came. */
function setup(host = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const s = h.join("ada");
  h.run(400);
  h.say(s, "enablecheats");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const codes = new Map<number, number>();
  s.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void, who: ClientSession = s): number => {
    const seq = who.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const move = (from: number, to: number, item: number, count = 0): number =>
    send(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(count), w.u16(item)));
  const inv = (): Inventory => h.host.items.inv(rec);
  const give = (name: string, n = 1): number => {
    expect(h.host.items.mint(rec, id(name), n)).toBe(n);
    h.run(100);
    return inv().item.lastIndexOf(id(name));
  };
  return { h, s, rec, send, move, inv, give, items: h.host.items };
}

test("an inventory with an equipment tail: things land in the bag, an armor slot takes only its piece, and a weapon moves with what it holds", () => {
  const inv = new Inventory(8 + GEAR_SLOTS, 8);
  expect([inv.bag, inv.hotbar, inv.armor, inv.wardrobe, inv.cap]).toEqual([8, 8, 18, 23, 28]);
  expect(new Inventory(40).hotbar).toBe(-1);
  // Adding fills only the bag. Eight stacks of 100 leave 200 over.
  expect(inv.add(id("stone"), 1000, 0, 0, 0, reg)).toBe(200);
  expect(inv.used()).toBe(8);
  for (let s = inv.bag; s < inv.cap; s++) expect(inv.item[s]).toBe(0);
  expect(inv.room(id("stone"), 0, reg)).toBe(0);
  expect(inv.free()).toBe(-1);
  inv.set(0, id("flak_shirt"), 1, 2, 77, 0);
  inv.set(1, id("rifle"), 1, 3, 50, 0);
  inv.setGear(1, id("round_rifle"), 1, id("scope"));
  const torso = inv.armor + 1;
  expect(reg.wearSlot[id("flak_shirt")]).toBe(1);
  expect(fitsSlot(inv, torso, id("flak_shirt"), reg)).toBe(true);
  expect(fitsSlot(inv, inv.armor, id("flak_shirt"), reg)).toBe(false);
  expect(fitsSlot(inv, torso, id("stone"), reg)).toBe(false);
  expect(moveSlot(inv, 0, inv, inv.armor + 3, 0, reg)).toBe(0);
  expect(moveSlot(inv, 2, inv, torso, 0, reg)).toBe(0);
  expect(moveSlot(inv, 0, inv, torso, 0, reg)).toBe(1);
  expect([inv.item[torso], inv.quality[torso], inv.dur[torso]]).toEqual([id("flak_shirt"), 2, 77]);
  // A swap that would put stone in the torso slot is refused both ways.
  expect(moveSlot(inv, torso, inv, 3, 0, reg)).toBe(0);
  expect(moveSlot(inv, 3, inv, torso, 0, reg)).toBe(0);
  expect(moveSlot(inv, 1, inv, inv.hotbar + 4, 0, reg)).toBe(1);
  expect([inv.item[inv.hotbar + 4], inv.ammo[inv.hotbar + 4], inv.loaded[inv.hotbar + 4], inv.attach[inv.hotbar + 4], inv.quality[inv.hotbar + 4]]).toEqual([id("rifle"), id("round_rifle"), 1, id("scope"), 3]);
  expect([inv.item[1], inv.ammo[1], inv.loaded[1], inv.attach[1]]).toEqual([0, 0, 0, 0]);
  expect(moveSlot(inv, inv.hotbar + 4, inv, 5, 0, reg)).toBe(1);
  expect([inv.item[5], inv.loaded[5], inv.attach[5]]).toEqual([id("rifle"), 1, id("scope")]);
  expect([inv.item[inv.hotbar + 4], inv.count[inv.hotbar + 4], inv.loaded[inv.hotbar + 4]]).toEqual([id("stone"), 100, 0]);
  for (let q = 1; q < QUALITY_MUL.length; q++) expect(QUALITY_MUL[q]!).toBeGreaterThan(QUALITY_MUL[q - 1]!);
  expect([HOTBAR_SLOTS, ARMOR_SLOTS]).toEqual([10, 5]);
});

artTest("the content hangs together: every engram can be reached, every thing that is made unlocked, every weapon fed, every piece drawn", () => {
  const levels = reg.defs.find((d) => d?.type === "levels")!;
  expect(levels.type === "levels" && levels.xp.length).toBe(105);
  const pack = corePack();
  const items = reg.defs.filter((d): d is ItemDef => d?.type === "item");
  // What a fire makes by itself (the forge's ingots and gasoline) has no engram, as in ARK.
  const made = items.filter((d) => d.craft !== undefined && !d.craft.fired);
  const engrams = reg.defs.filter((d): d is EngramDef => d?.type === "engram");
  for (const r of made) expect(engrams.filter((e) => e.item === r.id).length, r.id).toBe(1);
  for (const e of engrams) expect(e.level, e.id).toBeLessThanOrEqual(100);
  const points = levels.type === "levels" ? levels.engramPoints.reduce((a, b) => a + b, 0) : 0;
  expect(points).toBeGreaterThan(engrams.reduce((a, e) => a + e.cost, 0));
  // A soul ball is held and swung as a thrown weapon is, and harms nothing (content/items/balls.ts): the full one is never
  // made, an empty one becomes it. tests/creatures/balls.test.ts holds them; here, that their meshes follow a hand.
  // What is blocked out is a plain box in the hand (tests/items/blockouts.test.ts), and so is what is fitted to the jet,
  // which no hand holds.
  const blocked = new Set([...BLOCKED_OUT, ...JET_ARMS.map((d) => d.id)]);
  const weapons = items.filter((d) => d.weapon && !d.ball && !blocked.has(d.id));
  const balls = items.filter((d) => d.ball);
  expect(balls.map((d) => [d.id.slice(5), d.weapon?.kind, d.craft !== undefined, pack.header.meshes[pack.meshIndex.get(d.weapon!.mesh!)!]!.skeleton])).toEqual([["soul_ball", "thrown", true, "human"], ["soul_ball_full", "thrown", false, "human"]]);
  expect(weapons.map((d) => d.id.slice(5)).sort()).toEqual(["bola", "bow", "club", "crossbow", "flare_gun", "grenade", "grenade_poison", "grenade_smoke", "hatchet", "pick", "pistol", "pistol_plasma", "rifle", "rifle_plasma", "rocket_launcher", "shotgun", "slingshot", "spear"]);
  // Ammunition is made, or gathered as a slingshot's stone is.
  const gathered = new Set(reg.defs.flatMap((d) => (d?.type === "node" ? d.yields.map((y) => y.item) : [])));
  for (const d of weapons) {
    // A weapon mesh is skinned to the human skeleton, so it follows a hand.
    const mesh = pack.header.meshes[pack.meshIndex.get(d.weapon!.mesh!)!]!;
    expect(mesh.skeleton, d.id).toBe("human");
    for (const a of d.weapon!.ammo ?? []) expect(items.find((x) => x.id === a)?.ammo, a).toBeDefined();
    if (d.weapon!.ammo) expect(d.weapon!.ammo.some((a) => made.some((r) => r.id === a) || gathered.has(a))).toBe(true);
    expect(d.craft !== undefined, d.id).toBe(true);
  }
  // Five independently wearable sets, and four blocked out (fur, ghillie, riot and SCUBA's four pieces), which are drawn
  // as hide's pieces are.
  const worn = items.filter((d) => d.wear);
  expect([worn.filter((d) => !blocked.has(d.id)).length, worn.filter((d) => blocked.has(d.id)).length]).toEqual([25, 19]);
  const rating = (tier: string): number => worn.find((d) => d.id === `core:${tier}_shirt`)!.wear!.armor;
  expect([rating("cloth"), rating("hide"), rating("chitin"), rating("flak"), rating("meridian")]).toEqual([10, 20, 50, 100, 180]);
  for (const d of worn) {
    for (const sex of ["m", "f"]) expect(pack.meshIndex.has(`core:human_${sex}/armor/${d.wear!.set}/${d.wear!.slot}`), `${d.id} on ${sex}`).toBe(true);
    expect(d.craft !== undefined, d.id).toBe(true);
  }
  for (const need of made.flatMap((r) => r.craft!.needs)) expect(reg.index.has(need.item), need.item).toBe(true);
  for (const mesh of ["core:arrow", "core:dart", "core:stone_shot"]) expect(pack.meshIndex.has(mesh)).toBe(true);
});

test("Meridian equips through inventory commands and a second survivor sees all five pieces", () => {
  const { h, s, send, inv } = setup();
  const observer = h.join("observer");
  h.run(400);
  h.say(s, "kit meridian");
  h.run(150);
  const names = ["hat", "shirt", "gloves", "pants", "boots"];
  const items = names.map(name => id(`meridian_${name}`));
  for (const item of items) {
    const bagSlot = inv().item.indexOf(item);
    expect(bagSlot).toBeGreaterThanOrEqual(0);
    expect(send(CMD_USE, w => { w.u8(bagSlot); w.u16(item); })).toBe(RESULT_OK);
  }
  expect([...inv().item.slice(inv().armor, inv().armor + 5)]).toEqual(items);
  const seen = new RemoteSample();
  observer.sampleRemote(seen);
  const remote = seen.id.subarray(0, seen.count).indexOf(h.ent(s));
  expect(remote).toBeGreaterThanOrEqual(0);
  expect([...seen.gear.slice(remote * GEAR_COUNT + GEAR_WORN, remote * GEAR_COUNT + GEAR_WORN + 5)]).toEqual(items);
});

test("a survivor takes things in hand and puts armor on, and everyone sees it", () => {
  const { h, s, rec, send, move, inv, give } = setup();
  const bo = h.join("bo", { latencyMs: 30 });
  h.run(400);
  const ents = h.world.ents;
  const e = h.ent(s);
  const seenByBo = (): number[] => {
    const seen = new RemoteSample();
    bo.sampleRemote(seen);
    expect(seen.count).toBe(1);
    return [...seen.gear.subarray(0, GEAR_COUNT)];
  };
  expect(inv().cap).toBe(40 + GEAR_SLOTS);
  expect(s.inventory!.bag).toBe(40);
  expect(seenByBo()).toEqual([0, 0, 0, 0, 0, 0]);
  expect(s.held).toBe(-1);

  const bow = give("bow");
  expect(inv().dur[bow]).toBe(50);
  const hot = inv().hotbar;
  expect(move(bow, hot + 2, id("bow"))).toBe(RESULT_OK);
  expect(send(CMD_SELECT, (w) => w.u8(2))).toBe(RESULT_OK);
  expect([rec.held, s.held]).toEqual([2, 2]);
  expect(ents.gears.get(e)![GEAR_HELD]).toBe(id("bow"));
  expect(seenByBo()[GEAR_HELD]).toBe(id("bow"));
  // Selecting an empty slot or 255 empties the hand. Slot 10 does not exist.
  expect(send(CMD_SELECT, (w) => w.u8(5))).toBe(RESULT_OK);
  expect([rec.held, seenByBo()[GEAR_HELD]]).toEqual([-1, 0]);
  expect(send(CMD_SELECT, (w) => w.u8(10))).toBe(RESULT_INVALID);
  expect(send(CMD_SELECT, (w) => w.u8(2))).toBe(RESULT_OK);
  expect(send(CMD_SELECT, (w) => w.u8(255))).toBe(RESULT_OK);
  expect(rec.held).toBe(-1);
  expect(send(CMD_SELECT, (w) => w.u8(2))).toBe(RESULT_OK);
  // Moving the bow out of the selected slot empties the hand, and moving it back fills it.
  expect(move(hot + 2, 0, id("bow"))).toBe(RESULT_OK);
  expect(seenByBo()[GEAR_HELD]).toBe(0);
  expect(move(0, hot + 2, id("bow"))).toBe(RESULT_OK);
  expect(seenByBo()[GEAR_HELD]).toBe(id("bow"));

  // CMD_USE on armor puts it on. A hat cannot go on the feet (slot 4).
  const shirt = give("flak_shirt");
  const armor = inv().armor;
  expect(send(CMD_USE, (w) => (w.u8(shirt), w.u16(id("flak_shirt"))))).toBe(RESULT_OK);
  expect(inv().item[armor + 1]).toBe(id("flak_shirt"));
  const pants = give("hide_pants");
  expect(move(pants, armor + 3, id("hide_pants"))).toBe(RESULT_OK);
  const hat = give("cloth_hat");
  expect(move(hat, armor + 4, id("cloth_hat"))).toBe(RESULT_INVALID);
  expect(move(hat, armor, id("cloth_hat"))).toBe(RESULT_OK);
  expect(seenByBo()).toEqual([id("bow"), id("cloth_hat"), id("flak_shirt"), 0, id("hide_pants"), 0]);
  expect([...ents.gears.get(e)!.subarray(GEAR_WORN)]).toEqual([id("cloth_hat"), id("flak_shirt"), 0, id("hide_pants"), 0]);
  // CMD_USE on a worn piece takes it off. A second shirt swaps with the first.
  expect(send(CMD_USE, (w) => (w.u8(armor), w.u16(id("cloth_hat"))))).toBe(RESULT_OK);
  expect(inv().item[armor]).toBe(0);
  expect(inv().total(id("cloth_hat"))).toBe(1);
  const second = give("chitin_shirt");
  expect(send(CMD_USE, (w) => (w.u8(second), w.u16(id("chitin_shirt"))))).toBe(RESULT_OK);
  expect([inv().item[armor + 1], inv().item[second]]).toEqual([id("chitin_shirt"), id("flak_shirt")]);
  expect(seenByBo()[GEAR_WORN + 1]).toBe(id("chitin_shirt"));
  // The command names the item the client believes is in the slot. A wrong one is RESULT_STALE.
  const stone = give("stone", 5);
  expect(send(CMD_USE, (w) => (w.u8(stone), w.u16(id("stone"))))).toBe(RESULT_INVALID);
  expect(send(CMD_USE, (w) => (w.u8(second), w.u16(id("bow"))))).toBe(RESULT_STALE);
  expect(h.host.items.audit()).toEqual([]);
  expect(bo.stats.undecodable + s.stats.undecodable).toBe(0);
});

test("a weapon is set to its ammunition, loaded, fired empty, fitted and stripped, and every round stays on the books", () => {
  const { h, s, rec, send, inv, give, items } = setup();
  const rifle = give("rifle");
  const rounds = give("round_rifle", 12);
  const darts = give("dart_tranq", 5);
  const scope = give("scope");
  const arrows = give("arrow_stone", 9);
  void [rounds, darts, arrows];
  const total = (name: string): number => items.total(id(name));

  // The rifle takes rifle rounds and darts, not arrows.
  expect(send(CMD_LOAD, (w) => (w.u8(rifle), w.u16(id("arrow_stone"))))).toBe(RESULT_INVALID);
  expect(send(CMD_LOAD, (w) => (w.u8(arrows), w.u16(id("round_rifle"))))).toBe(RESULT_INVALID);
  expect(send(CMD_LOAD, (w) => (w.u8(rifle), w.u16(id("round_rifle"))))).toBe(RESULT_OK);
  expect([inv().ammo[rifle], inv().loaded[rifle]]).toEqual([id("round_rifle"), 0]);
  expect(s.inventory!.ammo[rifle]).toBe(id("round_rifle"));
  // The rifle holds one round. Loading moves it out of the stack.
  expect(items.load(rec, rifle, id("round_rifle"), 1)).toBe(1);
  expect([inv().loaded[rifle], inv().total(id("round_rifle")), total("round_rifle")]).toEqual([1, 11, 12]);
  expect(items.load(rec, rifle, id("round_rifle"), 1)).toBe(1); // already full
  expect(inv().total(id("round_rifle"))).toBe(11);
  h.run(100);
  expect(s.inventory!.loaded[rifle]).toBe(1);
  expect(items.spend(rec, rifle)).toBe(true);
  expect(items.spend(rec, rifle)).toBe(false);
  expect([total("round_rifle"), items.burned[id("round_rifle")]]).toEqual([11, 1]);
  // Switching to darts with a round in it puts the round back first.
  items.load(rec, rifle, id("round_rifle"), 1);
  expect(send(CMD_LOAD, (w) => (w.u8(rifle), w.u16(id("dart_tranq"))))).toBe(RESULT_OK);
  expect([inv().ammo[rifle], inv().loaded[rifle], inv().total(id("round_rifle"))]).toEqual([id("dart_tranq"), 0, 11]);
  items.load(rec, rifle, id("dart_tranq"), 1);
  expect(send(CMD_UNLOAD, (w) => w.u8(rifle))).toBe(RESULT_OK);
  expect([inv().loaded[rifle], inv().total(id("dart_tranq"))]).toEqual([0, 5]);
  expect(send(CMD_UNLOAD, (w) => w.u8(rifle))).toBe(RESULT_INVALID);

  // A pistol holds six. Loading takes what there is.
  const pistol = give("pistol");
  give("round_pistol", 4);
  expect(items.load(rec, pistol, id("round_pistol"), 6)).toBe(4);
  expect(inv().total(id("round_pistol"))).toBe(0);
  give("round_pistol", 10);
  expect(items.load(rec, pistol, id("round_pistol"), 6)).toBe(6);
  expect([inv().total(id("round_pistol")), total("round_pistol")]).toEqual([8, 14]);

  // The scope does not fit the bow. A second attachment swaps with the first, and detaching returns it to the bag.
  const bow = give("bow");
  expect(send(CMD_ATTACH, (w) => (w.u8(bow), w.u8(scope)))).toBe(RESULT_INVALID);
  expect(send(CMD_ATTACH, (w) => (w.u8(rifle), w.u8(scope)))).toBe(RESULT_OK);
  expect([inv().attach[rifle], inv().item[scope], total("scope")]).toEqual([id("scope"), 0, 1]);
  const silencer = give("silencer");
  expect(send(CMD_ATTACH, (w) => (w.u8(rifle), w.u8(silencer)))).toBe(RESULT_OK);
  expect([inv().attach[rifle], inv().item[silencer]]).toEqual([id("silencer"), id("scope")]);
  expect(send(CMD_DETACH, (w) => w.u8(rifle))).toBe(RESULT_OK);
  expect([inv().attach[rifle], total("silencer"), inv().total(id("silencer"))]).toEqual([0, 1, 1]);
  expect(send(CMD_DETACH, (w) => w.u8(rifle))).toBe(RESULT_INVALID);
  expect(send(CMD_ATTACH, (w) => (w.u8(rifle), w.u8(rifle)))).toBe(RESULT_INVALID);
  expect(items.audit()).toEqual([]);

  // With a full bag, an unload or a detach has nowhere to put the item.
  items.load(rec, rifle, id("round_rifle"), 1);
  send(CMD_ATTACH, (w) => (w.varint(rifle), w.varint(inv().item.indexOf(id("scope")))));
  items.mint(rec, id("waterskin"), 60);
  expect(inv().free()).toBe(-1);
  items.burnItem(rec, id("round_rifle"), inv().total(id("round_rifle"))); // no stack of rounds left to top up
  items.mint(rec, id("waterskin"), 5);
  expect(send(CMD_UNLOAD, (w) => w.u8(rifle))).toBe(RESULT_FULL);
  expect(send(CMD_DETACH, (w) => w.u8(rifle))).toBe(RESULT_FULL);
  expect([inv().loaded[rifle], inv().attach[rifle]]).toEqual([1, id("scope")]);
  // Burning the rifle burns its loaded round and its scope through the ledger.
  const roundsBurned = items.burned[id("round_rifle")]!;
  expect(items.burn(rec, rifle, 1)).toBe(true);
  expect([items.burned[id("round_rifle")]! - roundsBurned, items.burned[id("scope")], total("scope")]).toEqual([1, 1, 0]);
  expect(items.audit()).toEqual([]);
});

test("loading and fitting keep carried weight, moving gear transfers it, and firing removes only the spent round", () => {
  const { h, s, rec, send, move, inv, give, items } = setup();
  const rifle = give("rifle");
  give("round_rifle");
  const scope = give("scope");
  const weight = inv().weight(items.table);
  // A long rifle of 15, a rifle round of 0.1 and a scope of 0.1 (Longneck Rifle, Simple Rifle Ammo, Scope Attachment).
  expect(weight).toBeCloseTo(15.2);
  expect(items.load(rec, rifle, id("round_rifle"), 1)).toBe(1);
  expect(inv().weight(items.table)).toBeCloseTo(weight);
  expect(send(CMD_ATTACH, (w) => (w.varint(rifle), w.varint(scope)))).toBe(RESULT_OK);
  expect(inv().weight(items.table)).toBeCloseTo(weight);
  const held = inv().hotbar;
  expect(move(rifle, held, id("rifle"))).toBe(RESULT_OK);
  expect(s.inventory!.weight(items.table)).toBeCloseTo(weight);
  const other = h.host.records.create(id("cache"));
  expect(items.move(rec, held, other, 0, 0)).toBe(1);
  expect([inv().weight(items.table), items.inv(other).weight(items.table)]).toEqual([0, weight]);
  expect(items.move(other, 0, rec, held, 0)).toBe(1);
  expect(items.spend(rec, held)).toBe(true);
  const left = weight - items.table.weight[id("round_rifle")]!;
  expect(inv().weight(items.table)).toBeCloseTo(left);
  expect(send(CMD_DETACH, (w) => w.varint(held))).toBe(RESULT_OK);
  expect(inv().weight(items.table)).toBeCloseTo(left);
  expect(items.audit()).toEqual([]);
  h.host.shutdown();
});

test("what is dropped lies in a bag anyone can open, and is gone, on the books, after two minutes", () => {
  // Two drops from where she stands go into one bag (DEV99).
  const { h, s, rec, send, inv, give, items } = setup();
  const bo = h.join("bo");
  h.run(300);
  const stone = give("stone", 80);
  const rifle = give("rifle");
  items.load(rec, rifle, id("round_rifle"), 0);
  give("round_rifle", 3);
  items.load(rec, rifle, id("round_rifle"), 1);
  const before = h.world.ents.count;
  expect(send(CMD_DROP, (w) => (w.u8(stone), w.u16(30), w.u16(id("stone"))))).toBe(RESULT_OK);
  expect(send(CMD_DROP, (w) => (w.u8(rifle), w.u16(0), w.u16(id("rifle"))))).toBe(RESULT_OK);
  expect(send(CMD_DROP, (w) => (w.u8(rifle), w.u16(0), w.u16(id("rifle"))))).toBe(RESULT_STALE);
  expect(h.world.ents.count).toBe(before + 1);
  expect([inv().total(id("stone")), inv().total(id("rifle")), items.total(id("stone")), items.total(id("round_rifle"))]).toEqual([50, 0, 80, 3]);
  const bags = [...h.host.records.byPid.values()].filter((r) => r.name === "bag");
  expect(bags.length).toBe(1);
  const e = h.ent(s);
  expect(Math.hypot(bags[0]!.x - h.world.ents.x[e]!, bags[0]!.z - h.world.ents.z[e]!)).toBeCloseTo(0.8, 2);
  expect(items.audit()).toEqual([]);

  h.say(bo, "enablecheats");
  h.say(bo, `tp ${(bags[0]!.x - 1.2).toFixed(2)} ${bags[0]!.z.toFixed(2)}`);
  const p = h.pilots[1]!;
  p.yaw = Math.PI / 2;
  p.pitch = -0.9;
  h.run(300);
  p.buttons = BTN_USE;
  h.run(100);
  p.buttons = 0;
  h.run(300);
  expect(bo.open?.name).toBe("bag");
  expect([bo.open!.inventory.item[0], bo.open!.inventory.item[1]]).toEqual([id("stone"), id("rifle")]);
  expect(bo.open!.inventory.loaded[1]).toBe(1);
  bo.command(CMD_MOVE, (w) => (w.bits(BOX_OPEN, 1), w.varint(1), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(id("rifle"))));
  h.run(300);
  const boRec = h.host.records.byPid.get(h.world.ents.pid[h.ent(bo)]!)!;
  expect([items.inv(boRec).item[0], items.inv(boRec).loaded[0], items.inv(boRec).ammo[0]]).toEqual([id("rifle"), 1, id("round_rifle")]);
  // The bag still holds the stone. It lasts BAG_TICKS from the last drop, and the stone is burned with it.
  h.run(600);
  expect([...h.host.records.byPid.values()].filter((r) => r.name === "bag").length).toBe(1);
  const burned = items.burned[id("stone")]!;
  for (let t = 0; t < BAG_TICKS + 60; t++) h.server.tick();
  expect([...h.host.records.byPid.values()].filter((r) => r.name === "bag").length).toBe(0);
  expect(items.burned[id("stone")]! - burned).toBe(30);
  expect(h.world.ents.count).toBe(before);
  expect(items.audit()).toEqual([]);
  h.say(s, "suicide");
  h.run(300);
  expect(rec.dead).toBe(true);
  expect(send(CMD_DROP, (w) => (w.u8(0), w.u16(0), w.u16(id("stone"))))).toBe(RESULT_DENIED);
});

test("a Meridian survivor rejoins a restarted server with the same reserve spent in midair", () => {
  const dbPath = join(dir, "meridian-charge.db");
  const { h, s, rec } = setup({ dbPath });
  h.say(s, "armor meridian");
  h.pilots[0]!.buttons = BTN_JUMP;
  h.run(2200);
  h.pilots[0]!.buttons = 0;
  h.run(150);
  const spent = h.world.ents.jetSpent[h.ent(s)]!;
  expect(spent).toBeGreaterThan(50);
  h.host.shutdown();

  const again = new Harness({}, 1, 60, { dbPath, dev: true });
  const survivor = again.join("ada");
  again.run(200);
  expect(again.host.records.byPid.get(rec.pid)!.jetSpent).toBe(spent);
  expect(survivor.own.jetSpent).toBe(spent);
  expect(survivor.own.jetGear).toBe(31);
  again.host.shutdown();
});

test("equipment survives death in the cache and a restart in the save: rounds loaded, attachment fitted, armor worn, slot in hand", () => {
  const db = join(dir, "gear.db");
  const { h, s, rec, send, move, inv, give, items } = setup({ dbPath: db });
  const rifle = give("rifle");
  give("round_rifle", 7);
  const scope = give("scope");
  const hot = inv().hotbar;
  expect(move(rifle, hot + 1, id("rifle"))).toBe(RESULT_OK);
  expect(send(CMD_ATTACH, (w) => (w.u8(hot + 1), w.u8(scope)))).toBe(RESULT_OK);
  items.load(rec, hot + 1, id("round_rifle"), 1);
  const hat = give("meridian_hat");
  expect(send(CMD_USE, (w) => (w.u8(hat), w.u16(id("meridian_hat"))))).toBe(RESULT_OK);
  expect(send(CMD_SELECT, (w) => w.u8(1))).toBe(RESULT_OK);
  inv().setDur(hot + 1, 31);
  h.run(400);
  const pid = rec.pid;
  s.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db, dev: true });
  expect(h2.host.items.audit()).toEqual([]);
  const rec2 = h2.host.records.byPid.get(pid)!;
  const inv2 = h2.host.items.inv(rec2);
  expect([inv2.cap, inv2.bag]).toEqual([40 + GEAR_SLOTS, 40]);
  expect([inv2.item[hot + 1], inv2.ammo[hot + 1], inv2.loaded[hot + 1], inv2.attach[hot + 1], inv2.dur[hot + 1]]).toEqual([id("rifle"), id("round_rifle"), 1, id("scope"), 31]);
  expect(inv2.item[inv2.armor]).toBe(id("meridian_hat"));
  expect(rec2.held).toBe(1);
  expect(h2.host.items.total(id("round_rifle"))).toBe(7);
  const again = h2.join("ada");
  h2.run(500);
  expect(again.held).toBe(1);
  expect([...h2.world.ents.gears.get(h2.ent(again))!]).toEqual([id("rifle"), id("meridian_hat"), 0, 0, 0, 0]);
  expect(again.inventory!.loaded[hot + 1]).toBe(1);

  h2.say(again, "enablecheats");
  h2.say(again, "suicide");
  h2.run(300);
  expect(rec2.dead).toBe(true);
  expect(rec2.held).toBe(-1);
  const cache = [...h2.host.records.byPid.values()].find((r) => r.name.endsWith("cache"))!;
  const kept = cache.inv!;
  expect([kept.item[hot + 1], kept.loaded[hot + 1], kept.attach[hot + 1]]).toEqual([id("rifle"), 1, id("scope")]);
  expect(kept.item[kept.armor]).toBe(id("meridian_hat"));
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

test("fuzz: no stream of equipment commands, valid or not, makes or loses an item", () => {
  const h = new Harness({}, 3, 60, { dev: true });
  const sessions = ["ada", "bo", "cy"].map((name) => h.join(name));
  h.run(400);
  const items = h.host.items;
  const recs = sessions.map((s) => h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!);
  const stock = ["rifle", "pistol", "bow", "crossbow", "round_rifle", "round_pistol", "arrow_stone", "dart_tranq", "scope", "silencer", "laser", "flak_shirt", "hide_pants", "cloth_hat", "chitin_boots", "flak_gloves", "stone", "berry", "pick", "grenade"];
  for (const rec of recs) for (const name of stock) items.mint(rec, id(name), reg.stack[id(name)]! > 1 ? 30 : 2);
  const rng = new Rng(2026);
  const ops = [CMD_MOVE, CMD_SELECT, CMD_LOAD, CMD_ATTACH, CMD_DETACH, CMD_UNLOAD, CMD_REPAIR, CMD_DROP, CMD_USE];
  for (let round = 0; round < 400; round++) {
    const k = rng.int(sessions.length);
    const s = sessions[k]!;
    const inv = s.inventory!;
    // Mostly real slots and the items in them. Sometimes any number.
    const slot = (): number => (rng.int(5) === 0 ? rng.int(600) : rng.int(inv.cap));
    const item = (at: number): number => (rng.int(6) === 0 ? rng.int(reg.defs.length) : (inv.item[at] ?? 0));
    const op = ops[rng.int(ops.length)]!;
    const a = slot();
    const b = slot();
    s.command(op, (w) => {
      if (op === CMD_MOVE) (w.bits(rng.int(2), 1), w.varint(a), w.bits(rng.int(2), 1), w.varint(b), w.u16(rng.int(3) === 0 ? rng.int(40) : 0), w.u16(item(a)));
      else if (op === CMD_SELECT) w.u8(rng.int(4) === 0 ? 255 : rng.int(12));
      else if (op === CMD_LOAD) (w.varint(a), w.u16(item(b)));
      else if (op === CMD_ATTACH) (w.varint(a), w.varint(b));
      else if (op === CMD_DROP) (w.varint(a), w.u16(rng.int(2) === 0 ? 0 : rng.int(20)), w.u16(item(a)));
      else if (op === CMD_USE) (w.varint(a), w.u16(item(a)));
      else w.varint(a);
    });
    // The test also loads, spends and wears through the server directly, as the weapon step does.
    const rec = recs[k]!;
    const own = items.inv(rec);
    const at = rng.int(own.cap);
    const def = reg.defs[own.item[at]!] as ItemDef | null;
    if (def?.weapon?.ammo) {
      if (own.ammo[at] !== 0 && rng.int(2) === 0) items.load(rec, at, own.ammo[at]!, def.weapon.clip ?? 1);
      else items.spend(rec, at);
    }
    if (rng.int(7) === 0 && own.item[at] !== 0 && reg.uses[own.item[at]!]! > 0) items.wear(rec, at, 1 + rng.int(30));
    h.run(40);
    if (round % 20 === 19) {
      expect(items.audit()).toEqual([]);
      for (const rec2 of recs) {
        const own2 = items.inv(rec2);
        // Every worn piece is in its own slot, and every weapon holds only ammunition and attachments it takes.
        for (let w = 0; w < ARMOR_SLOTS; w++) if (own2.item[own2.armor + w] !== 0) expect(reg.wearSlot[own2.item[own2.armor + w]!]).toBe(w);
        for (let sl = 0; sl < own2.cap; sl++) {
          const d = reg.defs[own2.item[sl]!] as ItemDef | null;
          if (own2.loaded[sl]! > 0) expect(d?.weapon?.ammo?.includes(reg.ids[own2.ammo[sl]!]!)).toBe(true);
          if (own2.loaded[sl]! > 0) expect(own2.loaded[sl]!).toBeLessThanOrEqual(d!.weapon!.clip ?? 1);
          if (own2.attach[sl] !== 0) expect(d?.weapon?.fits?.includes(reg.ids[own2.attach[sl]!]!)).toBe(true);
          if (own2.item[sl] === 0) expect([own2.ammo[sl], own2.loaded[sl], own2.attach[sl]]).toEqual([0, 0, 0]);
        }
      }
    }
  }
  h.run(500);
  expect(items.audit()).toEqual([]);
  sessions.forEach((s, k) => {
    const own = items.inv(recs[k]!);
    for (let sl = 0; sl < own.cap; sl++) {
      expect([s.inventory!.item[sl], s.inventory!.count[sl], s.inventory!.dur[sl], s.inventory!.ammo[sl], s.inventory!.loaded[sl], s.inventory!.attach[sl]]).toEqual([own.item[sl]!, own.count[sl]!, own.dur[sl]!, own.ammo[sl]!, own.loaded[sl]!, own.attach[sl]!]);
    }
    expect(s.held).toBe(recs[k]!.held);
    expect(s.stats.undecodable).toBe(0);
  });
  expect(h.server.stats.malformed).toBe(0);
});

artTest("the client draws what is worn and held, and the hotbar and inventory screens show and send it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  // She chose to look from the eye, so her own body is drawn as first person draws it.
  app.ui.settings.thirdPerson = false;
  let packet = app.frame(0, 1280, 720);
  const run = (ms: number, w = 1280, ht = 720): void => h.run(ms, (now) => (packet = app.frame(now, w, ht)));
  run(500);
  const s = app.session;
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const items = h.host.items;
  const give = (name: string, n = 1): void => void items.mint(rec, id(name), n);
  for (const name of ["rifle", "bow", "scope", "flak_shirt", "hide_hat"]) give(name);
  give("round_rifle", 9);
  give("arrow_stone", 30);
  run(200);
  const f = app.ui.frame;
  const sent: number[] = [];
  const command = s.command.bind(s);
  s.command = (op, args) => (sent.push(op), command(op, args));
  const inv = s.inventory!;
  const slotOf = (name: string): number => inv.item.indexOf(id(name));
  const cell = (slot: number): number => KEY_INV_SLOT + slot * 3;
  const click = (key: number, button = 0): void => {
    app.pointer(0, key, 0, 0, button);
    run(120);
  };

  // The HUD hotbar has ten cells of three keys each. An empty cell has no label.
  expect(f.find(KEY_HOTBAR)).not.toBeNull();
  expect(f.find(KEY_HOTBAR + 9 * 3)).not.toBeNull();
  expect(f.find(KEY_HOTBAR + 1)).toBeNull();
  app.key("KeyI", true);
  for (const [name, aspect] of [["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9], ["phone upright", 9 / 16]] as const) {
    app.ui.build(aspect, app.hud, s);
    fits(f, name);
    expect(f.find(cell(inv.hotbar + 9))!.interactive).toBe(true);
    expect(f.find(cell(inv.armor + 4))!.interactive).toBe(true);
    expect(f.find(KEY_INV_ROW_LABEL)!.text).toBe("Hotbar");
    expect(f.find(KEY_INV_ACTION + 3)!.text).toBe("Detach");
  }
  run(50);
  // A click picks a stack up and a second click puts it down.
  click(cell(slotOf("rifle")));
  click(cell(inv.hotbar));
  click(cell(slotOf("bow")));
  click(cell(inv.hotbar + 1));
  expect([inv.item[inv.hotbar], inv.item[inv.hotbar + 1]]).toEqual([id("rifle"), id("bow")]);
  // Rounds put down on the rifle set its ammunition, and a scope put down on it is fitted.
  click(cell(slotOf("round_rifle")));
  click(cell(inv.hotbar));
  expect(inv.ammo[inv.hotbar]).toBe(id("round_rifle"));
  expect(inv.total(id("round_rifle"))).toBe(9); // the stack stayed where it was
  click(cell(slotOf("scope")));
  click(cell(inv.hotbar));
  expect(inv.attach[inv.hotbar]).toBe(id("scope"));
  expect(sent.slice(-4)).toEqual([CMD_MOVE, CMD_MOVE, CMD_LOAD, CMD_ATTACH]);
  // A right click puts armor on.
  click(cell(slotOf("flak_shirt")), 2);
  click(cell(slotOf("hide_hat")), 2);
  expect([inv.item[inv.armor], inv.item[inv.armor + 1]]).toEqual([id("hide_hat"), id("flak_shirt")]);
  // Hovering the rifle shows its name, durability, load and attachment.
  items.load(rec, inv.hotbar, id("round_rifle"), 1);
  run(100);
  app.pointer(2, cell(inv.hotbar), 0, 0, 0);
  run(34);
  expect(f.find(KEY_INV_INFO)!.text).toBe("primitive long rifle  70/70  1 rifle round  + scope");
  expect(f.find(cell(inv.hotbar) + 2)!.text).toBe("1"); // the rounds in it
  // The Detach and Unload buttons act on the stack that is picked up.
  click(cell(inv.hotbar));
  click(KEY_INV_ACTION + 3);
  click(cell(inv.hotbar));
  click(KEY_INV_ACTION + 2);
  expect([inv.attach[inv.hotbar], inv.loaded[inv.hotbar], inv.total(id("scope")), inv.total(id("round_rifle"))]).toEqual([0, 0, 1, 9]);
  expect(sent.slice(-2)).toEqual([CMD_DETACH, CMD_UNLOAD]);
  click(cell(slotOf("scope")));
  click(KEY_INV_ACTION);
  expect(inv.total(id("scope"))).toBe(0);
  expect(sent[sent.length - 1]).toBe(CMD_DROP);
  app.key("KeyI", true);
  run(50);
  expect(f.find(KEY_INV_PANEL)).toBeNull();

  // A number key takes its slot in hand. The same key again puts it away.
  app.key("Digit1", true);
  run(150);
  expect(s.held).toBe(0);
  expect(f.find(KEY_HOTBAR_LIT)).not.toBeNull();
  expect(f.find(KEY_HOTBAR + 1)!.text).toBe("long");
  expect(f.find(KEY_HOTBAR + 2)!.text).toBe("0");
  // In first person the head and the hat are not drawn.
  const meshes = (): string[] => [...packet!.drawMesh.subarray(0, packet!.drawCount)].filter((_, d) => (packet!.drawFlags[d]! & DRAW_NEAR) !== 0).map((m) => pack.header.meshes[m]!.id);
  expect(meshes().sort()).toEqual(["core:human_m/armor/hide/torso", "core:human_m/feet", "core:human_m/hands", "core:human_m/legs", "core:rifle"]);
  app.key("Digit2", true);
  run(150);
  expect(s.held).toBe(1);
  expect(meshes()).toContain("core:bow");
  app.key("Digit2", true);
  run(150);
  expect(s.held).toBe(-1);
  app.key("Digit5", true);
  run(150);
  expect(s.held).toBe(-1);
  app.key("Digit0", true);
  run(150);
  expect(sent.slice(-5).every((op) => op === CMD_SELECT)).toBe(true);

  // Seen by another, the hat hides the hair and the shirt replaces the bare torso.
  app.key("Digit2", true);
  const bo = new App(h.join("bo", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  // He looks from the eye too, so his own body is not among what he sees of her.
  bo.ui.settings.thirdPerson = false;
  let seen = bo.frame(0, 1280, 720);
  h.say(bo.session, "enablecheats");
  h.run(600, (now) => {
    app.frame(now, 1280, 720);
    seen = bo.frame(now, 1280, 720);
  });
  const e = h.ent(s);
  const eb = h.ent(bo.session);
  const ents = h.world.ents;
  bo.controls.yaw = Math.atan2(ents.x[e]! - ents.x[eb]!, ents.z[e]! - ents.z[eb]!);
  h.run(300, (now) => {
    app.frame(now, 1280, 720);
    seen = bo.frame(now, 1280, 720);
  });
  const others = [...seen!.drawMesh.subarray(0, seen!.drawCount)].filter((_, d) => (seen!.drawFlags[d]! & (DRAW_SKINNED | DRAW_NEAR)) === DRAW_SKINNED).map((m) => pack.header.meshes[m]!.id);
  expect(others.sort()).toEqual(["core:bow", "core:human_m/armor/hide/head", "core:human_m/armor/hide/torso", "core:human_m/feet", "core:human_m/hands", "core:human_m/head", "core:human_m/legs"]);

  // Wear the complete suit from the inventory and inspect the first-person pass.
  app.key("KeyI", true);
  for (const name of ["hat", "shirt", "gloves", "pants", "boots"]) give("meridian_" + name);
  run(200);
  for (const name of ["hat", "shirt", "gloves", "pants", "boots"]) click(cell(slotOf("meridian_" + name)), 2);
  app.key("KeyI", true);
  run(180);
  expect([...new Set(meshes())].sort()).toEqual(["core:bow", ...["feet", "hands", "legs", "torso"].map(slot => "core:human_m/armor/meridian/" + slot)]);

  // Seen by another: close by the suit is drawn; from farther its levels come sooner than the body's would; and from far
  // off the body's own parts stand in for it, since nobody can tell plates from paint there.
  const watch = (metres: number): { id: string; level: number }[] => {
    // The wearer is set down `metres` north of the watcher, who turns to face it.
    ents.x[e] = ents.x[eb]!;
    ents.z[e] = ents.z[eb]! + metres;
    ents.y[e] = h.world.hf.heightAt(ents.x[e]!, ents.z[e]!);
    bo.controls.yaw = 0;
    h.run(500, (now) => {
      app.frame(now, 1280, 720);
      seen = bo.frame(now, 1280, 720);
    });
    return [...seen!.drawMesh.subarray(0, seen!.drawCount)].map((m, d) => ({ id: pack.header.meshes[m]!.id, level: seen!.drawLod[d]!, flags: seen!.drawFlags[d]! }))
      .filter((d) => (d.flags & (DRAW_SKINNED | DRAW_NEAR)) === DRAW_SKINNED && d.id.startsWith("core:human_m/"));
  };
  const suit = (drawn: { id: string; level: number }[]) => drawn.filter((d) => d.id.includes("/armor/meridian/"));
  const near = watch(3);
  expect(suit(near).map((d) => d.id).sort()).toEqual(["feet", "hands", "head", "legs", "torso"].map((slot) => "core:human_m/armor/meridian/" + slot));
  expect(suit(near).every((d) => d.level === 0)).toBe(true);
  const middle = watch(12);
  expect(suit(middle).length).toBe(5);
  expect(suit(middle).every((d) => d.level >= 1)).toBe(true);
  const far = watch(130);
  expect(suit(far)).toEqual([]);
  expect(far.map((d) => d.id).sort()).toEqual(["feet", "hands", "head", "legs", "torso"].map((slot) => "core:human_m/" + slot));
});

/** Fails if a node is off the canvas, a text is wider than its box, or two controls overlap. */
function fits(f: UiFrame, where: string): void {
  for (let i = 0; i < f.count; i++) {
    const n = f.nodes[i]!;
    const at = `${where} key=${n.key}`;
    expect(n.x, at).toBeGreaterThanOrEqual(-0.01);
    expect(n.y, at).toBeGreaterThanOrEqual(-0.01);
    expect(n.x + n.w, at).toBeLessThanOrEqual(f.width + 0.01);
    expect(n.y + n.h, at).toBeLessThanOrEqual(f.height + 0.01);
    if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), `${at} "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
    for (let j = i + 1; j < f.count; j++) {
      const q = f.nodes[j]!;
      const over = n.x < q.x + q.w - 0.01 && q.x < n.x + n.w - 0.01 && n.y < q.y + q.h - 0.01 && q.y < n.y + n.h - 0.01;
      if (n.interactive && q.interactive) expect(over, `${at} and ${q.key}`).toBe(false);
    }
  }
}

void BitReader;
void CMD_REPAIR;
