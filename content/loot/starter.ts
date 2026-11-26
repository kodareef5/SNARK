// The starter book's world loot (planning/workstreams/loot.md): what lies in a creature's body, and later in holds,
// street things and rooms. content/supply/starter.ts joins it to the drops' sets and tables.

import type { EntryDoc, SetDoc, SourceDoc, SupplyBook, TableDoc } from "../../shared/supply/book.ts";

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
];

/**
 * `book` with what world loot needs that it lacks: the starter's sources where it has none of its own, and each of the
 * sets and tables above that it has not. A book saved before a source existed gets it so, and one that has its own
 * keeps them.
 */
export function withLoot(book: SupplyBook): SupplyBook {
  if (book.sources !== undefined) return book;
  return { ...book, sets: { ...LOOT_SETS, ...book.sets }, tables: { ...LOOT_TABLES, ...book.tables }, sources: LOOT_SOURCES.map((s) => ({ ...s })) };
}
