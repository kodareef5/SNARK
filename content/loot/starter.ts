// The starter book's world loot (planning/workstreams/loot.md): what lies in a creature's body, and later in holds,
// street things and rooms. content/supply/starter.ts joins it to the drops' sets and tables.

import type { EntryDoc, SetDoc, SourceDoc, SupplyBook, TableDoc } from "../../shared/supply/book.ts";
import { withSpecials } from "./maps.ts";

const id = (name: string): string => `core:${name}`;
const some = (name: string, min: number, max: number, weight = 1): EntryDoc => ({ items: [id(name)], min, max, ...(weight !== 1 ? { weight } : {}) });

/** What a wild creature's level makes of its body's tier. Wild levels run to 150 at the default difficulty. */
const BY_LEVEL: NonNullable<SourceDoc["ladder"]> = [
  { level: 30, tier: "green" },
  { level: 60, tier: "blue" },
  { level: 90, tier: "purple" },
  { level: 120, tier: "yellow" },
  { level: 145, tier: "red" },
];
const prize = (cls: string, weight = 1): SourceDoc["tables"][number] => ({ table: `{tier}/${cls}`, slots: ["prize"], ...(weight !== 1 ? { weight } : {}) });

/** The found vehicles that carry a load: their kinds, without their pack. */
const HAULERS = ["panel_van", "caravan", "bus", "semi", "monster_truck"] as const;

export const LOOT_SETS: Readonly<Record<string, SetDoc>> = {
  // What a creature had eaten, and what was left in it by those who failed to kill it.
  "find.scraps": {
    name: "scraps",
    min: 1,
    max: 2,
    entries: [
      some("berry", 3, 8),
      some("fiber", 4, 10),
      some("thatch", 4, 10),
      some("stone", 3, 8),
      some("flint", 2, 5),
      some("hide", 1, 3),
      some("narcoberry", 2, 5, 0.6),
      some("stimberry", 2, 5, 0.6),
      some("arrow_stone", 1, 3, 0.5),
      some("keratin", 1, 2, 0.4),
      some("chitin", 1, 2, 0.4),
    ],
  },
  "find.rubbish": {
    name: "rubbish",
    min: 1,
    max: 2,
    entries: [
      some("spoiled_meat", 1, 2),
      some("fiber", 3, 8),
      some("thatch", 3, 8),
      some("berry", 2, 6),
      some("wood", 2, 5),
      some("stone", 2, 5),
      some("flint", 1, 3),
      some("hide", 1, 2, 0.5),
      some("charcoal", 2, 5, 0.5),
      some("waterskin", 1, 1, 0.15),
      some("polymer", 1, 2, 0.15),
      some("gasoline", 1, 1, 0.1),
    ],
  },
  "find.post": { name: "post", min: 1, max: 1, entries: [some("fiber", 5, 12), some("sparkpowder", 3, 6, 0.6), some("narcotic", 1, 2, 0.4), some("stimulant", 1, 2, 0.4)] },
  "find.papers": { name: "papers", min: 1, max: 1, entries: [some("fiber", 4, 10), some("thatch", 3, 6, 0.5)] },
  "find.coins": { name: "coins and works", min: 1, max: 2, entries: [some("ingot", 2, 5), some("ore", 3, 8), some("electronics", 1, 2, 0.5), some("crystal", 1, 1, 0.2)] },
  // What was left in a car that still runs: tools, fuel, rounds.
  "find.trunk": {
    name: "a boot",
    min: 2,
    max: 3,
    entries: [
      some("gasoline", 2, 6),
      some("ingot", 3, 8),
      some("fiber", 8, 16),
      some("hide", 3, 8),
      some("waterskin", 1, 1, 0.6),
      some("torch", 1, 1, 0.6),
      some("hatchet", 1, 1, 0.5),
      some("pick", 1, 1, 0.5),
      some("arrow_stone", 6, 12, 0.5),
      some("round_pistol", 4, 10, 0.3),
      some("electronics", 1, 3, 0.3),
      some("polymer", 1, 3, 0.3),
      some("narcotic", 1, 3, 0.3),
    ],
  },
  // A van's or a lorry's load: a builder's or a trader's stock, in bulk.
  "find.load": {
    name: "a load",
    min: 2,
    max: 3,
    entries: [some("wood", 40, 80), some("stone", 40, 80), some("thatch", 40, 80), some("fiber", 30, 60), some("ingot", 10, 20, 0.7), some("hide", 15, 30, 0.7), some("gasoline", 6, 12, 0.6), some("paste", 2, 5, 0.4), some("polymer", 3, 6, 0.3), some("electronics", 3, 6, 0.3)],
  },
  // A boat's locker: what a crew keeps aboard.
  "find.locker": {
    name: "a locker",
    min: 2,
    max: 3,
    entries: [some("gasoline", 4, 10), some("fiber", 10, 20), some("jerky", 1, 3), some("waterskin", 1, 1, 0.7), some("oil", 2, 5, 0.5), some("flare_gun", 1, 1, 0.3), some("compass", 1, 1, 0.25), some("spyglass", 1, 1, 0.2), some("silica_pearls", 2, 6, 0.3)],
  },
  // An aircraft's stores.
  "find.stores": { name: "stores", min: 2, max: 3, entries: [some("gasoline", 8, 16), some("electronics", 3, 8), some("polymer", 3, 8), some("ingot", 10, 20), some("flare_gun", 1, 2, 0.5), some("jerky", 2, 4, 0.5)] },
  // What is left in a dead car after the years, and in a dead boat.
  "find.wreck": { name: "a wreck's leavings", min: 1, max: 2, entries: [some("fiber", 3, 8), some("hide", 1, 3), some("ingot", 1, 3), some("flint", 2, 5), some("gasoline", 1, 2, 0.4), some("polymer", 1, 2, 0.3), some("electronics", 1, 1, 0.15), some("waterskin", 1, 1, 0.15)] },
  "find.bilge": { name: "a dead boat's hold", min: 1, max: 2, entries: [some("fiber", 6, 14), some("wood", 5, 12), some("oil", 1, 3, 0.6), some("gasoline", 1, 3, 0.5), some("silica_pearls", 1, 4, 0.4), some("chitin", 2, 5, 0.4), some("flare_gun", 1, 1, 0.1), some("compass", 1, 1, 0.1), some("organic_polymer", 1, 2, 0.06), some("angler_gel", 1, 1, 0.04)] },
  "find.ash": { name: "what a fire leaves", min: 1, max: 1, entries: [some("charcoal", 4, 10), some("ingot", 1, 3, 0.5)] },
  // What is left by a bed, and in a counter's drawers. Pelt is rare here and common in one city's homes (maps.ts). Clothes
  // are left by beds and sold on shop shelves, with scissors and hair dye.
  "find.bedside": { name: "by a bed", min: 1, max: 1, entries: [some("fiber", 3, 8), some("hide", 1, 3), some("berry", 2, 6, 0.6), some("narcotic", 1, 2, 0.4), some("stimulant", 1, 1, 0.3), some("waterskin", 1, 1, 0.2), some("pelt", 1, 2, 0.08), some("tee", 1, 1, 0.06), some("loose_tee", 1, 1, 0.05), some("hoodie", 1, 1, 0.05), some("jeans", 1, 1, 0.05), some("shorts", 1, 1, 0.05), some("trainers", 1, 1, 0.04)] },
  "find.drawer": { name: "in a drawer", min: 1, max: 1, entries: [some("fiber", 3, 8), some("thatch", 3, 8), some("flint", 2, 4), some("sparkpowder", 2, 5, 0.5), some("charcoal", 2, 4, 0.5), some("arrow_stone", 2, 5, 0.3), some("electronics", 1, 1, 0.1), some("scissors", 1, 1, 0.1)] },
  "find.medicine": { name: "a ward's stores", min: 1, max: 1, entries: [some("narcotic", 2, 5), some("stimulant", 2, 4), some("fiber", 6, 12, 0.6), some("water_jar", 1, 1, 0.3), some("paste", 1, 2, 0.2)] },
  "find.shelf": { name: "a shop's shelf", min: 1, max: 2, entries: [some("jerky", 1, 3), some("meat_cooked", 2, 4), some("berry", 8, 16), some("waterskin", 1, 1, 0.6), some("narcotic", 1, 2, 0.3), some("torch", 1, 1, 0.3), some("tee", 1, 1, 0.06), some("loose_tee", 1, 1, 0.05), some("hoodie", 1, 1, 0.05), some("jeans", 1, 1, 0.05), some("shorts", 1, 1, 0.05), some("trainers", 1, 1, 0.04), some("apron", 1, 1, 0.03), some("scissors", 1, 1, 0.04), some("hair_dye_black", 1, 1, 0.02), some("hair_dye_blond", 1, 1, 0.02), some("hair_dye_brown", 1, 1, 0.02), some("hair_dye_ginger", 1, 1, 0.02), some("hair_dye_red", 1, 1, 0.02), some("hair_dye_white", 1, 1, 0.02)] },
  "find.desk": { name: "a desk", min: 1, max: 1, entries: [some("electronics", 1, 2), some("ingot", 2, 5), some("sparkpowder", 3, 6), some("crystal", 1, 1, 0.3), some("polymer", 1, 2, 0.3)] },
  // Plans for the first things a survivor makes, at the white tier's quality.
  "find.plans": {
    name: "plans",
    tier: "white",
    min: 1,
    max: 1,
    entries: [
      { items: ["hatchet", "pick", "spear", "torch"].map(id), min: 1, max: 1, quality: "tier", forceBlueprint: true },
      { items: ["bow", "slingshot", "club"].map(id), min: 1, max: 1, quality: "tier", forceBlueprint: true, weight: 0.6 },
      { items: ["cloth_hat", "cloth_shirt", "cloth_gloves", "cloth_pants", "cloth_boots"].map(id), min: 1, max: 1, quality: "tier", forceBlueprint: true, weight: 0.8 },
      { items: ["waterskin", "piece_campfire", "piece_storage_box", "piece_sleeping_bag"].map(id), min: 1, max: 1, forceBlueprint: true, weight: 0.6 },
    ],
  },
};

export const LOOT_TABLES: Readonly<Record<string, TableDoc>> = {
  "body/scraps": { slots: [{ name: "scraps", from: [{ set: "find.scraps" }] }], note: "What any creature's body may hold." },
  "street/bin": { slots: [{ name: "rubbish", from: [{ set: "find.rubbish" }] }], note: "A street bin." },
  "street/mailbox": { slots: [{ name: "post", from: [{ set: "find.post" }] }, { name: "plan", chance: 0.25, from: [{ set: "find.plans" }] }], note: "A mailbox: post, and now and then a plan somebody sent for." },
  "street/newsbox": { slots: [{ name: "papers", from: [{ set: "find.papers" }] }, { name: "plan", chance: 0.04, from: [{ set: "find.plans" }] }], note: "A newspaper box." },
  "hold/car": { slots: [{ name: "boot", from: [{ set: "find.trunk" }] }], note: "A found car's boot." },
  "hold/hauler": { slots: [{ name: "load", from: [{ set: "find.load" }] }, { name: "boot", chance: 0.5, from: [{ set: "find.trunk" }] }], note: "A found van's, bus's or lorry's load." },
  "hold/boat": { slots: [{ name: "locker", from: [{ set: "find.locker" }] }], note: "A found boat's locker." },
  "hold/aircraft": { slots: [{ name: "stores", from: [{ set: "find.stores" }] }], note: "A found helicopter's stores." },
  "dead/wreck": { slots: [{ name: "leavings", from: [{ set: "find.wreck" }] }], note: "A street wreck." },
  "dead/hull": { slots: [{ name: "hold", from: [{ set: "find.bilge" }] }], note: "A dead boat at its mooring, or a harbour's hulk." },
  "dead/burnt": { slots: [{ name: "ash", from: [{ set: "find.ash" }] }], note: "A dead boat that burnt." },
  "room/bed": { slots: [{ name: "bedside", from: [{ set: "find.bedside" }] }], note: "A bed in any building." },
  "room/counter": { slots: [{ name: "drawer", from: [{ set: "find.drawer" }] }, { name: "plan", chance: 0.03, from: [{ set: "find.plans" }] }], note: "A counter in any building." },
  "room/ward": { slots: [{ name: "stores", from: [{ set: "find.medicine" }] }], note: "A hospital's bed." },
  "room/shop": { slots: [{ name: "shelf", from: [{ set: "find.shelf" }] }], note: "A shop's counter." },
  "room/office": { slots: [{ name: "desk", from: [{ set: "find.desk" }] }], note: "An office's counter." },
  "street/paystation": { slots: [{ name: "coins", from: [{ set: "find.coins" }] }], note: "A car park's pay station: its coin box and its works." },
};

/**
 * A street thing holds little: rubbish, post, papers, coins. It is there to be worth a look on the way past, not a trip.
 * Every wild body may hold scraps. A bigger one may hold a prize of its level's tier besides: a large one of a drop's
 * stores, an apex one of its arms and armour.
 */
export const LOOT_SOURCES: readonly SourceDoc[] = [
  { key: "body/any", name: "Any body", on: true, kind: "body", chance: 0.5, tables: [{ table: "body/scraps" }], target: 4.3 },
  { key: "body/medium", name: "Medium body", on: true, kind: "body", when: { size: ["medium"] }, chance: 0.06, tier: "white", ladder: BY_LEVEL, tables: [prize("provisions"), prize("stable", 0.5)], share: 0.022 },
  { key: "body/large", name: "Large body", on: true, kind: "body", when: { size: ["large"] }, chance: 0.18, tier: "white", ladder: BY_LEVEL, tables: [prize("provisions"), prize("works"), prize("stable")], share: 0.065 },
  { key: "body/apex", name: "Apex body", on: true, kind: "body", when: { size: ["apex"] }, chance: 0.5, tier: "white", ladder: BY_LEVEL, tables: [prize("arms"), prize("armour"), prize("stable"), prize("works")], share: 0.18 },
  { key: "street/bin", name: "Street bin", on: true, kind: "static", when: { holds: ["bin"] }, chance: 0.6, tables: [{ table: "street/bin" }], refillHours: [20, 30], target: 5 },
  { key: "street/mailbox", name: "Mailbox", on: true, kind: "static", when: { holds: ["mailbox"] }, chance: 0.5, tables: [{ table: "street/mailbox" }], refillHours: [40, 60], target: 10 },
  { key: "street/newsbox", name: "Newspaper box", on: true, kind: "static", when: { holds: ["newsbox"] }, chance: 0.35, tables: [{ table: "street/newsbox" }], refillHours: [20, 30], target: 2.6 },
  { key: "street/paystation", name: "Pay station", on: true, kind: "static", when: { holds: ["paystation"] }, chance: 0.7, tables: [{ table: "street/paystation" }], refillHours: [40, 60], target: 21 },
  // A found vehicle is a prize already, so what it holds is a bonus; the haulers are few and hold the most.
  { key: "vehicle/car", name: "Found car", on: true, kind: "vehicle", when: { vehicle: ["wheeled"] }, chance: 0.6, tables: [{ table: "hold/car" }], target: 40 },
  { key: "vehicle/hauler", name: "Found van or lorry", on: true, kind: "vehicle", when: { species: HAULERS.map(id) }, chance: 0.8, tables: [{ table: "hold/hauler" }], target: 170 },
  { key: "vehicle/boat", name: "Found boat", on: true, kind: "vehicle", when: { vehicle: ["boat"] }, chance: 0.7, tables: [{ table: "hold/boat" }], target: 55 },
  { key: "vehicle/aircraft", name: "Found helicopter", on: true, kind: "vehicle", when: { vehicle: ["rotor"] }, chance: 0.9, tables: [{ table: "hold/aircraft" }], target: 280 },
  // The dead are many: a street wreck is worth a look in passing, as a bin is.
  { key: "dead/wreck", name: "Street wreck", on: true, kind: "static", when: { holds: ["wreck"] }, chance: 0.3, tables: [{ table: "dead/wreck" }], refillHours: [40, 60], target: 5 },
  { key: "dead/hull", name: "Dead boat", on: true, kind: "static", when: { holds: ["hull", "hulk", "hull_weed", "hulk_sunk"] }, chance: 0.6, tables: [{ table: "dead/hull" }], refillHours: [40, 60], target: 11 },
  { key: "dead/burnt", name: "Burnt boat", on: true, kind: "static", when: { holds: ["hull_burnt"] }, chance: 0.5, tables: [{ table: "dead/burnt" }], refillHours: [40, 60], target: 6.5 },
  // Rooms are a hundred thousand on a map, so a bed or a counter holds little and seldom. What a building is for adds
  // to it, and so does the climb: from the fifteenth storey up there may be a prize, of a tier that rises with the storey.
  { key: "room/bed", name: "Bed", on: true, kind: "static", when: { holds: ["bed"] }, chance: 0.2, tables: [{ table: "room/bed" }], refillHours: [40, 60], target: 1.6 },
  { key: "room/counter", name: "Counter", on: true, kind: "static", when: { holds: ["counter"] }, chance: 0.2, tables: [{ table: "room/counter" }], refillHours: [40, 60], target: 1.6 },
  { key: "room/ward", name: "Hospital bed", on: true, kind: "static", when: { holds: ["bed"], building: ["hospital"] }, chance: 0.4, tables: [{ table: "room/ward" }], refillHours: [40, 60], target: 18 },
  { key: "room/shop", name: "Shop counter", on: true, kind: "static", when: { holds: ["counter"], building: ["shopping_street", "shop", "mall"] }, chance: 0.5, tables: [{ table: "room/shop" }], refillHours: [40, 60], target: 12 },
  { key: "room/office", name: "Office desk", on: true, kind: "static", when: { holds: ["counter"], building: ["office", "tower_office", "government", "tower"] }, chance: 0.15, tables: [{ table: "room/office" }], refillHours: [40, 60], target: 3.4 },
  { key: "room/high", name: "High room", on: true, kind: "static", when: { holds: ["bed", "counter"], level: [15, 1000] }, chance: 0.25, tier: "green", ladder: [{ level: 30, tier: "blue" }, { level: 45, tier: "purple" }], tables: [prize("provisions"), prize("works"), prize("arms", 0.5)], refillHours: [60, 90], share: 0.09 },
  // The far ground is the richer, as the drops' far band is: anything on the street there may hold a green prize.
  { key: "street/far", name: "Far ground", on: true, kind: "static", when: { holds: ["bin", "mailbox", "newsbox", "paystation", "wreck"], band: ["deep"] }, chance: 0.06, tier: "green", tables: [prize("provisions"), prize("works")], refillHours: [40, 60], share: 0.018 },
];

/**
 * `book` with what world loot needs that it lacks: the starter's sources where it has none of its own, with the map's
 * specials, and each of the sets and tables above that it has not. A book saved before a source existed gets it so,
 * and one that has its own keeps them.
 */
export function withLoot(book: SupplyBook, mapId = ""): SupplyBook {
  if (book.sources !== undefined) return book;
  return withSpecials({ ...book, sets: { ...LOOT_SETS, ...book.sets }, tables: { ...LOOT_TABLES, ...book.tables }, sources: LOOT_SOURCES.map((s) => ({ ...s })) }, mapId);
}
