// The wardrobe tail and the edition and dye columns, in the slot tables alone: where a garment may go, how a styled stack
// moves, splits and stacks, what an inventory saved before the wardrobe reads back as, and the stamp a body redraws by.
import { expect, test } from "bun:test";
import { RecordCodec, idMap } from "../../server/persist/codec.ts";
import { EntityRecord } from "../../server/records.ts";
import { SKIN_CHEST, SKIN_PELVIS } from "../../shared/anim/skin-zones.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { ARMOR_SLOTS, GEAR_SLOTS, HOTBAR_SLOTS, Inventory, WARDROBE_NAMES, WARDROBE_SLOTS, fitsSlot, moveSlot } from "../../shared/sim/items.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const BAG = 40;
const tee = id("tee");
const trousers = id("jeans");
/** Three palette colours as one number, the first lowest. */
const dye = (a: number, b: number, c: number): number => a | (b << 8) | (c << 16);

/** A survivor's inventory as one is carried: a full hotbar, hide armor, a bag of things, and a dyed edition of each garment. */
function carried(): Inventory {
  const inv = new Inventory(BAG + GEAR_SLOTS, BAG);
  ["hatchet", "pick", "spear", "bow", "torch", "waterskin", "slingshot", "club"].forEach((name, k) => inv.set(inv.hotbar + k, id(name), 1, 1, 30, 0));
  inv.set(inv.hotbar + 8, id("arrow_stone"), 40, 0, 0, 0);
  inv.set(inv.hotbar + 9, id("berry"), 12, 0, 0, 9000);
  ["hat", "shirt", "gloves", "pants", "boots"].forEach((piece, k) => inv.set(inv.armor + k, id(`hide_${piece}`), 1, 2, 40, 0));
  inv.add(id("stone"), 230, 0, 0, 0, reg);
  inv.add(id("wood"), 75, 0, 0, 0, reg);
  inv.add(id("fiber"), 300, 0, 0, 0, reg);
  inv.set(inv.wardrobe, tee, 1, 0, 0, 0);
  inv.setStyle(inv.wardrobe, 7, dye(12, 40, 3));
  inv.set(inv.wardrobe + 1, trousers, 1, 0, 0, 0);
  inv.setStyle(inv.wardrobe + 1, 9, dye(0, 22, 0));
  return inv;
}

test("the wardrobe follows the armor, one slot for each name, and only on an equipment tail", () => {
  const inv = new Inventory(BAG + GEAR_SLOTS, BAG);
  expect([inv.hotbar, inv.armor, inv.wardrobe]).toEqual([BAG, BAG + HOTBAR_SLOTS, BAG + HOTBAR_SLOTS + ARMOR_SLOTS]);
  expect(WARDROBE_NAMES.length).toBe(WARDROBE_SLOTS);
  expect(new Inventory(BAG).wardrobe).toBe(-1);
});

test("a garment names its slot and the zones it covers, and gives no armor", () => {
  expect([reg.garmentSlot[tee], reg.garmentSlot[trousers]]).toEqual([WARDROBE_NAMES.indexOf("top"), WARDROBE_NAMES.indexOf("bottom")]);
  expect(reg.garmentZones[tee]! & (1 << SKIN_CHEST)).not.toBe(0);
  expect(reg.garmentZones[trousers]! & (1 << SKIN_PELVIS)).not.toBe(0);
  expect(reg.garmentZones[tee]! & (1 << SKIN_PELVIS)).toBe(0);
  expect([reg.armor[tee], reg.wearSlot[tee], reg.uses[tee], reg.garmentDyes[tee]]).toEqual([0, -1, 0, 1]);
  expect(reg.garmentSlot[id("hide_shirt")]).toBe(-1);
});

test("content that misplaces a garment is refused", () => {
  const bad = (garment: object, more: object = {}): string[] =>
    compileContent([...CORE_CONTENT, { type: "item", class: "garment", id: "core:odd_tee", stack: 1, garment, ...more } as never]).errors.filter((e) => e.includes("odd_tee"));
  expect(bad({ slot: "top", covers: [SKIN_CHEST] })).toEqual([]);
  expect(bad({ slot: "belt", covers: [] }).length).toBeGreaterThan(0);
  expect(bad({ slot: "top", covers: [99] }).length).toBeGreaterThan(0);
  expect(bad({ slot: "top", covers: [] }, { stack: 5 }).length).toBeGreaterThan(0);
  expect(bad({ slot: "top", covers: [] }, { wear: { slot: "torso", armor: 1, uses: 1, set: "hide", colors: [0, 0, 0] } }).length).toBeGreaterThan(0);
});

test("a garment goes only in its own wardrobe slot, and armor only in its armor slot", () => {
  const inv = carried();
  const top = inv.wardrobe, bottom = inv.wardrobe + 1;
  expect([fitsSlot(inv, top, tee, reg), fitsSlot(inv, bottom, tee, reg), fitsSlot(inv, top, trousers, reg)]).toEqual([true, false, false]);
  for (let k = 0; k < ARMOR_SLOTS; k++) expect(fitsSlot(inv, inv.armor + k, tee, reg)).toBe(false);
  for (let k = 0; k < WARDROBE_SLOTS; k++) expect(fitsSlot(inv, inv.wardrobe + k, id("hide_shirt"), reg)).toBe(false);
  expect([fitsSlot(inv, inv.wardrobe + 2, id("stone"), reg), fitsSlot(inv, 0, tee, reg), fitsSlot(inv, inv.hotbar, tee, reg)]).toEqual([false, true, true]);
  // Refused moves change nothing: the tee into the trousers' slot, a shirt of armor onto the tee.
  const before = [...inv.item];
  expect(moveSlot(inv, top, inv, bottom, 0, reg)).toBe(0);
  expect(moveSlot(inv, inv.armor + 1, inv, top, 0, reg)).toBe(0);
  // Nor may the tee swap with a stone into its slot.
  expect(moveSlot(inv, 0, inv, top, 0, reg)).toBe(0);
  expect([...inv.item]).toEqual(before);
});

test("an edition and a dye go with their item on a move, a swap and between inventories", () => {
  const inv = carried();
  const top = inv.wardrobe;
  // Off into the bag's first free slot.
  const free = inv.free();
  expect(moveSlot(inv, top, inv, free, 0, reg)).toBe(1);
  expect([inv.item[top], inv.editionOf(top), inv.dyeOf(top)]).toEqual([0, 0, 0]);
  expect([inv.item[free], inv.editionOf(free), inv.dyeOf(free)]).toEqual([tee, 7, dye(12, 40, 3)]);
  // A second tee, plain, put on; the dyed one swapped back onto it.
  inv.set(top, tee, 1, 0, 0, 0);
  expect(moveSlot(inv, free, inv, top, 0, reg)).toBe(1);
  expect([inv.editionOf(top), inv.dyeOf(top), inv.editionOf(free), inv.dyeOf(free)]).toEqual([7, dye(12, 40, 3), 0, 0]);
  // Into a box that has never held a styled thing, and back.
  const box = new Inventory(20);
  expect(box.edition).toBeNull();
  expect(moveSlot(inv, inv.wardrobe + 1, box, 3, 0, reg)).toBe(1);
  expect([box.item[3], box.editionOf(3), box.dyeOf(3)]).toEqual([trousers, 9, dye(0, 22, 0)]);
  expect(moveSlot(box, 3, inv, inv.wardrobe + 1, 0, reg)).toBe(1);
  expect([inv.editionOf(inv.wardrobe + 1), inv.dyeOf(inv.wardrobe + 1), box.editionOf(3)]).toEqual([9, dye(0, 22, 0), 0]);
});

test("stacks of one item with other editions or dyes never join; a split keeps both halves alike", () => {
  const inv = new Inventory(6);
  const thread = id("fiber");
  inv.set(0, thread, 100, 0, 0, 0);
  inv.setStyle(0, 3, 0);
  inv.set(1, thread, 100, 0, 0, 0);
  inv.setStyle(1, 0, dye(5, 0, 0));
  inv.set(2, thread, 100, 0, 0, 0);
  // Onto another edition, another dye, or the plain kind, a part of a stack is refused and a whole one swaps.
  expect(moveSlot(inv, 0, inv, 1, 10, reg)).toBe(0);
  expect(moveSlot(inv, 0, inv, 2, 10, reg)).toBe(0);
  expect(moveSlot(inv, 0, inv, 2, 0, reg)).toBe(100);
  expect([inv.editionOf(0), inv.editionOf(2), inv.count[0], inv.count[2]]).toEqual([0, 3, 100, 100]);
  // Split: both halves are the edition.
  expect(moveSlot(inv, 2, inv, 4, 40, reg)).toBe(40);
  expect([inv.count[2], inv.count[4], inv.editionOf(2), inv.editionOf(4)]).toEqual([60, 40, 3, 3]);
  // Like onto like joins.
  expect(moveSlot(inv, 4, inv, 2, 0, reg)).toBe(40);
  expect([inv.count[2], inv.item[4]]).toEqual([100, 0]);
  // Adding fills only stacks of its like, and room counts only them.
  const bag = new Inventory(3);
  bag.add(thread, 50, 0, 0, 0, reg, 0, 0, 3, 0);
  expect(bag.room(thread, 0, reg)).toBe(2 * reg.stack[thread]!);
  expect(bag.room(thread, 0, reg, 0, 3, 0)).toBe(3 * reg.stack[thread]! - 50);
  expect(bag.add(thread, 50, 0, 0, 0, reg)).toBe(0);
  expect([bag.count[0], bag.count[1], bag.editionOf(0), bag.editionOf(1)]).toEqual([50, 50, 3, 0]);
  expect(bag.add(thread, 10, 0, 0, 0, reg, 0, 0, 3, 0)).toBe(0);
  expect(bag.count[0]).toBe(60);
});

test("emptying a slot clears its edition and dye", () => {
  const inv = carried();
  const top = inv.wardrobe;
  inv.remove(top, 1);
  expect([inv.item[top], inv.editionOf(top), inv.dyeOf(top)]).toEqual([0, 0, 0]);
  inv.set(top, tee, 1, 0, 0, 0);
  expect([inv.editionOf(top), inv.dyeOf(top)]).toEqual([0, 0]);
});

test("the worn stamp moves when the armor or wardrobe does, not the hotbar or bag, and no two inventories share one", () => {
  const inv = carried();
  const other = carried();
  expect(inv.worn).not.toBe(other.worn);
  const was = inv.worn;
  // A round spent from the bow in hand, a stone added and taken: nothing worn changed.
  inv.setGear(inv.hotbar + 3, id("arrow_stone"), 4, 0);
  inv.setGear(inv.hotbar + 3, id("arrow_stone"), 3, 0);
  inv.add(id("stone"), 5, 0, 0, 0, reg);
  inv.take(id("stone"), 5);
  inv.setDur(inv.hotbar, 29);
  expect(inv.worn).toBe(was);
  inv.setDur(inv.armor + 1, 39);
  const armored = inv.worn;
  expect(armored).not.toBe(was);
  inv.setStyle(inv.wardrobe, 7, dye(1, 1, 1));
  expect(inv.worn).not.toBe(armored);
  const dyed = inv.worn;
  // Setting what it already is changes nothing.
  inv.setStyle(inv.wardrobe, 7, dye(1, 1, 1));
  expect(inv.worn).toBe(dyed);
});

test("an edition and a dye are saved with their slot, and only for the slots that have one", () => {
  const c = compileContent(CORE_CONTENT).registry!;
  const codec = new RecordCodec(Uint16Array.from(c.ids, (_, i) => i), idMap(c, c.ids.map((name, i) => [name, i]), c.ids.length), false);
  const rec = new EntityRecord(10, c.index.get("core:survivor")!);
  rec.inv = carried();
  rec.inv.setStyle(3, 0xfffffffe, dye(255, 254, 253));
  const plain = new EntityRecord(11, c.index.get("core:survivor")!);
  plain.inv = carried();
  plain.inv.setStyle(plain.inv.wardrobe, 0, 0);
  plain.inv.setStyle(plain.inv.wardrobe + 1, 0, 0);
  const back = codec.decode({ pid: 10, kind: rec.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(rec).slice() })!.inv!;
  for (let s = 0; s < back.cap; s++) expect([back.editionOf(s), back.dyeOf(s)]).toEqual([rec.inv.editionOf(s), rec.inv.dyeOf(s)]);
  expect(codec.encode(plain).length).toBeLessThan(codec.encode(rec).length);
  expect(codec.decode({ pid: 11, kind: plain.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(plain).slice() })!.inv!.edition).toBeNull();
});
