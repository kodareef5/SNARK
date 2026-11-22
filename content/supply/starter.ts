// The starter drop book (planning/workstreams/supply.md, and the appendix of the plan it was written from): seven tiers
// by seven classes, every table a kit, a prize, an echo of the tier below's prize and the tier's staples, as ARK's
// beacons give themed kits at white and green and one fine thing from blue up (ark.wiki.gg Supply Crate and
// Loot tables/The Island/Supply Crates, 2026-11-21), carried here through every tier. A world begins with this book and
// an admin edits a copy (server/supply/store.ts). It is data, kept out of the core content on purpose: content is hashed
// for every client, and this is not theirs to hold.
//
// It names things the game does not have yet, each said in `FUTURE` with its name in ARK, its level and a guess at its
// worth: a book forgives those (shared/supply/compile.ts), and the list of them is the backlog of what to make.
//
// Balance (shared/supply/worth.ts): a tier's target doubles from 200. A kit is about 42% of it, the prize 38%, the echo
// 7%, the staples 13%. One line of each kit is its ballast, which `bun run supply -- fit` scales to bring the table to
// its target (FIT, content/supply/fit.ts); tests/unit/supply-starter.test.ts holds every table to it.

import { BOOK_FORMAT, tableKey, type ClassDoc, type EntryDoc, type FutureDoc, type SetDoc, type SupplyBook, type TableDoc, type TierDoc } from "../../shared/supply/book.ts";
import { FIT } from "./fit.ts";

const id = (name: string): string => (name.includes(":") ? name : `core:${name}`);
const ids = (names: string | readonly string[]): string[] => (typeof names === "string" ? [id(names)] : names.map(id));
/** `min` to `max` of one of `names`. */
const some = (names: string | readonly string[], min: number, max = min, more: Partial<EntryDoc> = {}): EntryDoc => ({ items: ids(names), min, max, ...more });
/** One of `names` at the tier's quality, a blueprint one time in five. */
const fine = (names: string | readonly string[], more: Partial<EntryDoc> = {}): EntryDoc => ({ items: ids(names), min: 1, max: 1, quality: "tier", blueprint: 0.2, ...more });
/** Always the blueprint of one of `names`, at no quality. */
const plan = (names: string | readonly string[], more: Partial<EntryDoc> = {}): EntryDoc => ({ items: ids(names), min: 1, max: 1, forceBlueprint: true, ...more });
const w = (weight: number): Partial<EntryDoc> => ({ weight });
const ballast: Partial<EntryDoc> = { ballast: true };
const PIECES = ["hat", "shirt", "gloves", "pants", "boots"] as const;
/** The five pieces of an armour set. */
const suit = (set: string): string[] => PIECES.map((p) => `${set}_${p}`);
const piece = (what: string, of: string): string => `piece_${what}_${of}`;

export const TIERS: readonly TierDoc[] = [
  { key: "white", name: "White", rgb: 0xf4f4ee, level: 3, target: 200, quality: [1, 1.4], staple: "staple.white", floor: "staple.white" },
  { key: "green", name: "Green", rgb: 0x38d060, level: 15, target: 400, quality: [1, 2], staple: "staple.green", floor: "staple.green" },
  { key: "blue", name: "Blue", rgb: 0x3a8cff, level: 25, target: 800, quality: [1.25, 3.25], staple: "staple.blue", floor: "staple.blue" },
  { key: "purple", name: "Purple", rgb: 0xa050f0, level: 35, target: 1600, quality: [1.25, 5.25], staple: "staple.purple", floor: "staple.purple" },
  { key: "yellow", name: "Yellow", rgb: 0xf4d020, level: 45, target: 3200, quality: [2.5, 7.5], staple: "staple.yellow", floor: "staple.yellow" },
  { key: "red", name: "Red", rgb: 0xf03838, level: 60, target: 6400, quality: [2.5, 10.5], staple: "staple.red", floor: "staple.red" },
  // The suit's lamp: sea-glass cyan. ARK's deep sea crates open at 80.
  { key: "meridian", name: "Meridian", rgb: 0x60f0e0, level: 80, target: 12800, quality: [4.5, 13], staple: "staple.meridian", floor: "staple.meridian" },
];

/**
 * The top-marks, as sea-marks wear them (shared/sim/supply.ts MARKS): bar, saltire, buckler, hourglass, cross, cone
 * down, cone up. These seven were kept by measuring which read apart as silhouettes eight pixels high.
 */
export const CLASSES: readonly ClassDoc[] = [
  { key: "shelter", name: "Shelter", mark: 0, fill: "fill.shelter" },
  { key: "arms", name: "Arms", mark: 1, fill: "fill.arms" },
  { key: "armour", name: "Armour", mark: 2, fill: "fill.armour" },
  { key: "stable", name: "Stable", mark: 3, fill: "fill.stable" },
  { key: "works", name: "Works", mark: 4, fill: "fill.works" },
  { key: "provisions", name: "Provisions", mark: 5, fill: "fill.provisions" },
  { key: "voyage", name: "Voyage", mark: 6, fill: "fill.voyage" },
];

/**
 * What the book wants that the game does not have: ARK's name, the level of its engram there, and a guess at its worth.
 * The rest of what it once waited for is blocked out (content/items/blockouts.ts) and is the game's now. The raft waits
 * still: it is a vehicle that is built on, and neither a raft nor building on a vehicle is made.
 */
export const FUTURE: Readonly<Record<string, FutureDoc>> = {
  [id("raft_assembly")]: { ark: "Wooden Raft", page: "https://ark.wiki.gg/wiki/Wooden_Raft", level: 16, worth: 600, cls: "vehicle", quality: false, blueprint: false },
};

const sets: Record<string, SetDoc> = {};
/** A kit: every line is given. */
const kit = (cls: string, tier: string, ...entries: EntryDoc[]): void => void (sets[`kit.${cls}.${tier}`] = { name: `${cls} kit, ${tier}`, tier, all: true, entries });
/** A prize: `min` to `max` of its lines. */
const prize = (cls: string, tier: string, min: number, max: number, ...entries: EntryDoc[]): void => void (sets[`prize.${cls}.${tier}`] = { name: `${cls} prize, ${tier}`, tier, min, max, entries });
const all = (key: string, name: string, ...entries: EntryDoc[]): void => void (sets[key] = { name, all: true, entries });

// What every drop of a tier holds besides, and what a roll that gave nothing is given.
all("staple.white", "white staples", some("thatch", 8, 16), some("wood", 4, 8), some("fiber", 4, 8));
all("staple.green", "green staples", some("wood", 10, 20), some("stone", 10, 20), some("fiber", 10, 20), some("flint", 5, 10));
all("staple.blue", "blue staples", some("wood", 15, 30), some("stone", 15, 30), some("hide", 8, 16), some("ore", 8, 16));
all("staple.purple", "purple staples", some("ingot", 10, 20), some("hide", 15, 25), some("gunpowder", 10, 20), some("paste", 1, 2));
all("staple.yellow", "yellow staples", some("ingot", 25, 45), some("paste", 4, 8), some("oil", 8, 16), some("crystal", 2, 4));
all("staple.red", "red staples", some("ingot", 50, 90), some("polymer", 3, 5), some("electronics", 6, 12), some("gasoline", 3, 5));
all("staple.meridian", "Meridian staples", some("ingot", 90, 150), some("polymer", 8, 12), some("electronics", 15, 25), some("gasoline", 4, 6));

// A class's own materials, which a table too thin of its own is topped up from, so its mark stays true.
all("fill.shelter", "building materials", some("wood", 20), some("thatch", 20), some("stone", 10));
all("fill.arms", "arrows and powder", some("arrow_stone", 6), some("flint", 10));
all("fill.armour", "hide and fibre", some("hide", 10), some("fiber", 20));
all("fill.stable", "taming stores", some("narcotic", 2), some("hide", 8));
all("fill.works", "workshop stores", some("sparkpowder", 10), some("stone", 20), some("flint", 10));
all("fill.provisions", "stores", some("meat_cooked", 4), some("berry", 15), some("fiber", 15));
all("fill.voyage", "travelling stores", some("thatch", 20), some("fiber", 20), some("meat_cooked", 4));

// ---- Tier 1, white: ARK's Campsite, Clothing, Weapons, Resources, Shanty Shack, Furniture and Saddles.
kit("shelter", "white", some(piece("foundation", "thatch"), 1), some(piece("wall", "thatch"), 2), some(piece("door", "thatch"), 1), some(piece("ceiling", "thatch"), 1), some("thatch", 20, 30, ballast));
prize("shelter", "white", 1, 1, some("piece_storage_box", 1), some("piece_sleeping_bag", 1), some("piece_campfire", 1, 2), plan("piece_bed", w(0.5)), some("piece_bed", 1, 1, w(0.3)), some("piece_standing_torch", 1, 2));
kit("arms", "white", some("spear", 1, 2), some("slingshot", 1), some("club", 1), some("stone", 10, 20, ballast));
prize("arms", "white", 1, 1, fine("bow"), some("bola", 2, 4), fine("spear", w(0.5)));
kit("armour", "white", ...suit("cloth").map((p) => some(p, 1)), some("fiber", 10, 20, ballast));
prize("armour", "white", 1, 1, ...suit("hide").map((p) => some(p, 1)), plan(suit("cloth"), w(2)));
kit("stable", "white", some("narcoberry", 10, 20, ballast), some("club", 1), some("bola", 1));
prize("stable", "white", 1, 1, plan("saddle_parasaur"), some("narcotic", 4, 6), some("saddle_parasaur", 1, 1, w(0.25)), plan("saddle_carbonemys", w(0.15)));
kit("works", "white", some("pick", 1), some("hatchet", 1), some("sparkpowder", 8, 16), some("flint", 15, 25), some("stone", 30, 50, ballast), some("torch", 1));
prize("works", "white", 1, 1, some("piece_mortar", 1, 1, w(1.5)), fine("pick"), fine("hatchet"), some("piece_campfire", 1, 1, w(0.5)), plan("piece_forge", w(0.3)), some("piece_cooking_pot", 1, 1, w(0.5)));
kit("provisions", "white", some("berry", 20, 30), some("meat_cooked", 4, 8, ballast), some("waterskin", 1), some("piece_campfire", 1));
prize("provisions", "white", 1, 2, some("hide", 20, 30), some("fiber", 40, 80), some("wood", 40, 60), some("thatch", 60, 90), some("narcotic", 3, 5, w(0.5)), some("piece_sleeping_bag", 1, 1, w(0.5)));
kit("voyage", "white", some("frond_glider", 1), some("waterskin", 1), some("berry", 10, 20, ballast), some("compass", 1));
prize("voyage", "white", 1, 1, fine("frond_glider"), some("flare_gun", 1, 2), plan("flare_gun", w(0.5)), some("spyglass", 1));

// ---- Tier 2, green: ARK's Wood Shack, Cold-weather gear, Raider, Farming, Furniture and Saddles.
kit("shelter", "green", some(piece("wall", "wood"), 2), some(piece("door", "wood"), 1), some("wood", 20, 30, ballast));
prize("shelter", "green", 1, 2, some(piece("foundation", "wood"), 1, 2), some(piece("ceiling", "wood"), 1, 2), some("piece_storage_large", 1), some("piece_preserving_bin", 1, 1, w(0.7)), some(piece("stairs", "wood"), 1, 1, w(0.5)), plan(piece("wall", "stone"), w(0.5)), plan(piece("foundation", "stone"), w(0.5)));
kit("arms", "green", some("bow", 1), some("arrow_stone", 15, 25, ballast));
prize("arms", "green", 1, 1, some("arrow_tranq", 8, 14), fine("bow"), fine("crossbow", w(0.7)), some("grenade_smoke", 1, 2, w(0.6)));
kit("armour", "green", ...suit("hide").map((p) => some(p, 1)), some("hide", 10, 20, ballast));
prize("armour", "green", 1, 1, ...suit("hide").map((p) => fine(p)), ...suit("fur").map((p) => some(p, 1, 1, w(0.3))));
kit("stable", "green", some("narcotic", 5, 8, ballast), some("bola", 2));
prize("stable", "green", 1, 1, plan("saddle_trike"), plan("saddle_raptor"), some("arrow_tranq", 6, 10), some("saddle_parasaur", 1, 1, w(0.4)), some("saddle_trike", 1, 1, w(0.3)), some("saddle_raptor", 1, 1, w(0.3)));
kit("works", "green", some("ore", 20, 30), some("charcoal", 10, 20), some("sparkpowder", 10, 20), some("hide", 10, 20, ballast));
prize("works", "green", 1, 1, some("piece_smithy", 1), plan("piece_forge"), plan("piece_smithy"), some("paste", 4, 8), some("ingot", 10, 20), some("piece_forge", 1, 1, w(0.5)), fine("pick_metal"), fine("hatchet_metal"));
kit("provisions", "green", some("meat_cooked", 8, 12, ballast), some("jerky", 3, 5), some("berry", 20, 40), some("narcotic", 2, 4), some("waterskin", 1), some("stimulant", 2, 4));
prize("provisions", "green", 1, 2, some("hide", 40, 60), some("wood", 60, 100), some("stone", 60, 100), some("fiber", 80, 120), some("flint", 40, 60), some("ore", 15, 25), some("chitin", 10, 20), some("thatch", 100, 160));
kit("voyage", "green", some("flare_gun", 1, 2), some("frond_glider", 1), some("waterskin", 1), some("jerky", 2, 3, ballast));
prize("voyage", "green", 1, 1, fine("frond_glider"), some("flare_gun", 2, 3), some("spyglass", 1), some("compass", 1), some("raft_assembly", 1, 1, w(0.2)));

// ---- Tier 3, blue: ARK's level 25 lists.
kit("shelter", "blue", some(piece("wall", "stone"), 2), some(piece("door", "stone"), 1), some(piece("ceiling", "stone"), 1), some("stone", 30, 50, ballast));
prize("shelter", "blue", 1, 2, some(piece("foundation", "stone"), 2, 3), plan(piece("wall", "metal")), plan(piece("door", "metal"), w(0.7)), some(piece("pillar", "stone"), 2, 3, w(0.5)), some(piece("stairs", "stone"), 1, 2, w(0.5)), plan(piece("foundation", "metal"), w(0.5)), some("piece_bed", 1, 1, w(0.5)), some("piece_fireplace", 1, 1, w(0.5)));
kit("arms", "blue", some("crossbow", 1), some("arrow_stone", 20, 30), some("arrow_flame", 8, 12), some("gunpowder", 10, 20, ballast));
prize("arms", "blue", 1, 1, fine("crossbow"), some("round_pistol", 15, 25), some("grenade_smoke", 2, 3, w(0.6)), fine("pistol", w(0.4)), fine("rifle", w(0.2)), fine("pike"), fine("sword", w(0.5)));
kit("armour", "blue", fine(suit("hide")), fine(suit("hide")), fine(suit("hide")), some("hide", 30, 50, ballast), some("fiber", 20, 40));
prize("armour", "blue", 1, 1, ...suit("chitin").map((p) => some(p, 1)), ...suit("fur").map((p) => fine(p)), ...suit("ghillie").map((p) => fine(p, w(0.5))));
kit("stable", "blue", some("narcotic", 10, 16, ballast), some("arrow_tranq", 10, 14));
prize("stable", "blue", 1, 1, plan("saddle_stego"), some("saddle_raptor", 1, 1, w(0.7)), some("saddle_stego", 1, 1, w(0.5)), some("saddle_trike", 1, 1, w(0.5)), plan("saddle_pteranodon", w(0.4)));
kit("works", "blue", some("ingot", 20, 30), some("charcoal", 20, 30), some("gunpowder", 15, 25), some("paste", 2, 4, ballast));
prize("works", "blue", 1, 2, some("piece_forge", 1), some("piece_smithy", 1, 2), some("crystal", 20, 30), some("obsidian", 30, 50), some("oil", 20, 30), plan("piece_fabricator", w(0.3)), fine("sickle", w(0.5)));
kit("provisions", "blue", some("jerky", 6, 10), some("meat_cooked", 10, 16), some("narcotic", 6, 10), some("berry", 30, 50), some("hide", 30, 50, ballast), some("water_jar", 1));
prize("provisions", "blue", 2, 2, some("ore", 40, 60), some("wood", 120, 180), some("stone", 120, 180), some("fiber", 140, 200), some("hide", 60, 90), some("chitin", 40, 60), some("keratin", 40, 60), some("obsidian", 20, 40), some("flint", 100, 140));
kit("voyage", "blue", fine("frond_glider"), some("flare_gun", 2, 3), some("jerky", 4, 6, ballast), some("waterskin", 1), some("compass", 1), some("spyglass", 1));
prize("voyage", "blue", 1, 1, some("flare_gun", 3, 5), fine("frond_glider"), some("magnifying_glass", 1), some("raft_assembly", 1, 1, w(0.5)));

// ---- Tier 4, purple: ARK's level 35 lists.
kit("shelter", "purple", plan(piece("wall", "metal")), plan(piece("ceiling", "metal")), plan(piece("door", "metal")), some(piece("wall", "stone"), 2, 4, ballast));
prize("shelter", "purple", 2, 2, plan(piece("foundation", "metal")), some(piece("wall", "metal"), 2, 3, w(0.6)), some(piece("door", "metal"), 1, 2, w(0.6)), plan(piece("pillar", "metal"), w(0.5)), plan(piece("stairs", "metal"), w(0.5)), some("piece_storage_large", 2, 2, w(0.5)));
kit("arms", "purple", some("round_pistol", 20, 30), some("round_rifle", 8, 12), some("gunpowder", 15, 25, ballast));
prize("arms", "purple", 1, 1, some("grenade", 2, 3), some("scope", 1), fine("pistol", w(0.7)), some("silencer", 1, 1, w(0.7)), some("round_shotgun", 10, 16, w(0.7)), some("grenade_poison", 1, 2, w(0.5)), fine("rifle", w(0.4)), fine("shotgun", w(0.3)));
kit("armour", "purple", fine(suit("chitin")), fine(suit("chitin")), fine(suit("chitin")), some("chitin", 30, 50, ballast), some("hide", 30, 50));
prize("armour", "purple", 2, 2, ...suit("chitin").map((p) => fine(p)), ...suit("ghillie").map((p) => fine(p, w(0.5))));
kit("stable", "purple", some("narcotic", 15, 25, ballast), some("arrow_tranq", 15, 25), some("bola", 3, 5));
prize("stable", "purple", 1, 1, plan("saddle_pteranodon"), some("saddle_stego", 1, 1, w(0.8)), some("saddle_pteranodon", 1, 1, w(0.6)), some("saddle_raptor", 1, 2, w(0.5)), some("dart_tranq", 6, 10, w(0.5)), some("soul_ball", 1, 1, w(0.3)));
kit("works", "purple", some("ingot", 40, 60), some("paste", 6, 10), some("crystal", 10, 20), some("oil", 10, 20), some("sparkpowder", 20, 40, ballast));
prize("works", "purple", 1, 2, plan("piece_fabricator"), some("silica_pearls", 40, 60), some("obsidian", 60, 90), some("polymer", 8, 12, w(0.6)), some("electronics", 15, 25, w(0.6)), some("piece_fabricator", 1, 1, w(0.4)));
kit("provisions", "purple", some("jerky", 10, 16), some("jerky_prime", 4, 6), some("narcotic", 10, 16), some("meat_cooked", 15, 25), some("hide", 60, 100, ballast));
prize("provisions", "purple", 2, 2, some("ore", 80, 120), some("ingot", 30, 50), some("chitin", 80, 120), some("hide", 120, 180), some("obsidian", 50, 70), some("crystal", 30, 50), some("oil", 30, 50), some(["fiber", "wood", "stone"], 250, 350));
kit("voyage", "purple", some("gasoline", 10, 20, ballast), fine("frond_glider"), some("flare_gun", 3, 5), some("jerky", 6, 10), some("grappling_hook", 2, 4));
prize("voyage", "purple", 1, 1, some("gasoline", 30, 50), plan("gps"), plan("radio"), some("canteen", 1));

// ---- Tier 5, yellow: ARK's level 45 lists.
kit("shelter", "yellow", some(piece("wall", "metal"), 2, 3, ballast), some(piece("ceiling", "metal"), 1), some(piece("door", "metal"), 1));
prize("shelter", "yellow", 1, 1, some(piece("foundation", "metal"), 2, 3), some(piece("pillar", "metal"), 2, 4, w(0.7)), some(piece("stairs", "metal"), 1, 2, w(0.7)), some("piece_bunk_bed", 1, 1, w(0.6)), some("piece_storage_large", 3, 4, w(0.5)), plan("piece_vault", w(0.15)));
kit("arms", "yellow", some("round_rifle", 20, 30, ballast), some("round_shotgun", 12, 18), some("grenade", 1, 2));
// The fabricated guns are ahead of this tier (ARK's 55 and 58): their blueprints, not the guns.
prize("arms", "yellow", 1, 1, some("flashlight", 1), fine("pistol", w(0.7)), some("grenade_poison", 2, 4, w(0.7)), fine("rifle", w(0.4)), fine("shotgun", w(0.4)), some("laser", 1, 1, w(0.4)), plan("pistol_fabricated", w(0.5)), plan("shotgun_pump", w(0.3)), plan("rifle_assault", w(0.2)), some("round_advanced", 25, 40));
kit("armour", "yellow", fine(suit("flak")), fine(suit("flak")), fine(suit("flak")), some("ingot", 30, 50, ballast), some("hide", 60, 100));
prize("armour", "yellow", 3, 3, ...suit("flak").map((p) => fine(p)), ...suit("meridian").map((p) => fine(p, w(0.2))));
kit("stable", "yellow", some("dart_tranq", 10, 16, ballast), some("narcotic", 20, 30));
prize("stable", "yellow", 1, 1, some("saddle_pteranodon", 1), plan("saddle_brachio", w(0.5)), plan("saddle_spino", w(0.5)), plan("saddle_rex", w(0.5)), some("soul_ball", 2, 3));
kit("works", "yellow", some("polymer", 10, 16), some("electronics", 15, 25), some("gasoline", 5, 10), some("ingot", 30, 50, ballast));
prize("works", "yellow", 1, 2, some("piece_fabricator", 1), some("silica_pearls", 100, 140, w(0.7)), some("crystal", 60, 100, w(0.7)), some("polymer", 20, 30, w(0.7)), some("electronics", 40, 60, w(0.7)), plan("piece_vault", w(0.1)), plan("piece_generator"));
kit("provisions", "yellow", some("jerky_prime", 8, 12), some("jerky", 15, 25), some("narcotic", 20, 30), some("paste", 10, 16), some("ingot", 40, 60, ballast));
prize("provisions", "yellow", 2, 2, some("ingot", 80, 120), some("polymer", 10, 14), some("oil", 80, 120), some("crystal", 80, 120), some("chitin", 160, 240), some("hide", 250, 350), some("obsidian", 120, 180), some("silica_pearls", 100, 140), some("gasoline", 50, 80));
kit("voyage", "yellow", some("gasoline", 30, 50, ballast), some("ingot", 40, 60), some("polymer", 6, 10), some("electronics", 10, 16));
prize("voyage", "yellow", 1, 1, some("gasoline", 80, 120), some("polymer", 15, 25), some("electronics", 40, 60), fine("frond_glider", w(0.5)), some("boat_assembly", 1, 1, { weight: 0.056, jackpot: true }), some("gps", 1), some("canteen", 1));

// ---- Tier 6, red: ARK's level 60 lists.
kit("shelter", "red", some(piece("foundation", "metal"), 2, 3), some(piece("wall", "metal"), 3, 5, ballast));
prize("shelter", "red", 1, 1, some(piece("ceiling", "metal"), 3, 5), some(piece("stairs", "metal"), 2, 3, w(0.6)), some(piece("pillar", "metal"), 4, 6, w(0.6)), some("piece_bunk_bed", 1, 2, w(0.6)), plan("piece_vault", w(0.5)), some("piece_vault", 1, 1, w(0.1)));
// Rounds for what its prize may be: the fabricated pistol's and the assault rifle's.
kit("arms", "red", some("dart_tranq", 10, 16), some("round_advanced", 20, 30), some("round_advanced_rifle", 20, 30), some("round_rifle", 30, 50, ballast), some("grenade", 2, 4));
// The fabricated guns as they are made, at no quality: one is a prize of this tier whole. The compound bow and the
// rocket launcher are ahead of it, and come as blueprints.
prize("arms", "red", 1, 1, fine("rifle"), fine("shotgun"), fine("pistol", w(0.7)), some("laser", 1, 1, w(0.7)), some("flashlight", 1, 2, w(0.5)), some("grenade_poison", 4, 6, w(0.5)), some("pistol_fabricated", 1, 1, w(0.6)), some("shotgun_pump", 1, 1, w(0.4)), some("rifle_assault", 1, 1, w(0.3)), plan("bow_compound", w(0.3)), some("c4", 1, 3, w(0.5)), plan("rocket_launcher", w(0.2)));
kit("armour", "red", ...suit("flak").map((p) => fine(p)), some("ingot", 60, 100, ballast), some("electronics", 6, 10));
prize("armour", "red", 4, 4, ...suit("flak").map((p) => fine(p)), ...suit("riot").map((p) => plan(p, w(0.5))), ...suit("meridian").map((p) => fine(p, w(0.3))));
kit("stable", "red", some("dart_tranq", 15, 25), some("narcotic", 40, 60, ballast), some("soul_ball", 1, 2));
prize("stable", "red", 2, 2, some("saddle_rex", 1), some("saddle_spino", 1), some("saddle_brachio", 1), plan("saddle_rex", w(0.7)), plan("saddle_spino", w(0.7)), plan("saddle_brachio", w(0.7)));
kit("works", "red", some("polymer", 25, 35), some("electronics", 30, 50), some("ingot", 50, 90, ballast));
// The grinder's blueprint is no prize of this tier: a blueprint ahead of its finder is worth half its thing, and the
// grinder is 3,200 ingots.
prize("works", "red", 1, 1, some("polymer", 40, 60), some("electronics", 100, 140), some("piece_fabricator", 1, 2), some("crystal", 200, 300, w(0.6)), some("gasoline", 150, 250, w(0.6)), plan("piece_vault", w(0.4)), some("piece_refrigerator", 1, 1, w(0.8)), some("piece_air_conditioner", 1, 2, w(0.6)), some("piece_generator", 2, 3, w(0.6)));
kit("provisions", "red", some("jerky_prime", 15, 25), some("jerky", 30, 50), some("narcotic", 40, 60), some("ingot", 80, 120), some("paste", 20, 40, ballast));
const RED_STORES: EntryDoc[] = [some("ingot", 160, 240), some("polymer", 20, 30), some("electronics", 50, 70), some("oil", 160, 240), some("crystal", 160, 240), some("silica_pearls", 200, 280), some("obsidian", 250, 350), some("gasoline", 100, 160), some("chitin", 300, 500)];
prize("provisions", "red", 2, 2, ...RED_STORES);
kit("voyage", "red", some("gasoline", 60, 100, ballast), some("polymer", 12, 18), some("electronics", 20, 30), some("ingot", 80, 120));
prize("voyage", "red", 1, 1, some("gasoline", 200, 300), some("polymer", 40, 60), some("electronics", 100, 140), some("boat_assembly", 1, 1, { weight: 0.08, jackpot: true }), some("helicopter_assembly", 1, 1, { weight: 0.03, jackpot: true }));

// ---- Tier 7, Meridian: as ARK's deep sea crates, few things and fine.
kit("shelter", "meridian", some(piece("foundation", "metal"), 4, 6), some(piece("wall", "metal"), 6, 10, ballast));
prize("shelter", "meridian", 1, 1, some(piece("ceiling", "metal"), 6, 10), some(piece("stairs", "metal"), 4, 6, w(0.6)), some("piece_vault", 1, 1, w(0.5)), some("piece_bunk_bed", 2, 3, w(0.5)), some("piece_soul_vault", 1, 1, w(0.5)));
// And here the sniper's and the compound bow's, so that neither prize comes with nothing to fire.
kit("arms", "meridian", some("dart_shock", 10, 16), some("dart_tranq", 20, 30), some("round_advanced_rifle", 40, 60), some("round_advanced_sniper", 6, 10), some("arrow_metal", 10, 16), some("round_rifle", 60, 90, ballast));
prize("arms", "meridian", 1, 1, fine("rifle"), fine("shotgun"), fine("pistol", { weight: 0.6, blueprint: 0 }), some("laser", 2, 2, w(0.5)), some("rifle_assault", 1, 1, w(0.8)), some("shotgun_pump", 1, 1, w(0.6)), some("rifle_sniper", 1, 1, w(0.3)), some("bow_compound", 1, 1, w(0.4)), plan("prod", w(0.3)), plan("rocket_launcher", w(0.5)), some("rocket", 2, 4, w(0.3)));
kit("armour", "meridian", fine(suit("flak")), fine(suit("flak")), some("electronics", 30, 50, ballast), some("crystal", 30, 50));
// Riot pieces as they are made, two of them: one at this tier's quality would be the whole drop's worth.
prize("armour", "meridian", 2, 2, ...suit("riot").map((p) => some(p, 1)), ...suit("flak").map((p) => fine(p, w(0.6))), ...suit("meridian").map((p) => fine(p, w(0.4))));
kit("stable", "meridian", some("dart_shock", 15, 25), some("narcotic", 80, 120, ballast), some("soul_ball", 3, 5));
prize("stable", "meridian", 2, 2, some("saddle_rex", 1), some("saddle_spino", 1), some("saddle_brachio", 1), some("piece_soul_vault", 1, 1, w(0.5)));
kit("works", "meridian", some("polymer", 50, 70), some("electronics", 60, 100), some("ingot", 100, 160, ballast));
prize("works", "meridian", 1, 1, some("polymer", 80, 120), some("electronics", 200, 280), some("piece_fabricator", 2, 3, w(0.6)), some("piece_vault", 1, 1, w(0.3)), some("piece_refrigerator", 1, 2, w(0.6)), plan("piece_forge_industrial", w(0.6)), plan("piece_grinder", w(0.4)), plan("piece_chemistry_bench", w(0.12)), plan("piece_cooker_industrial", w(0.08)));
kit("provisions", "meridian", some("jerky_prime", 30, 50), some("narcotic", 80, 120), some("ingot", 200, 300), some("paste", 60, 100, ballast));
prize("provisions", "meridian", 2, 2, ...RED_STORES.map((e) => ({ ...e, min: e.min * 2, max: e.max * 2 })));
// A diver's mask, tank and flippers in every one; the leggings, which are most of the set's worth, are a prize.
kit("voyage", "meridian", some("gasoline", 150, 250, ballast), some("polymer", 25, 35), some("electronics", 50, 70), some("ingot", 100, 160), some("scuba_mask", 1), some("scuba_tank", 1), some("scuba_flippers", 1));
prize("voyage", "meridian", 1, 1, some("gasoline", 400, 600), some("polymer", 80, 120), some("electronics", 200, 280), some("boat_assembly", 1, 1, { weight: 0.11, jackpot: true }), some("helicopter_assembly", 1, 1, { weight: 0.05, jackpot: true }), some("scuba_leggings", 1));

/** Every tier and class has its table, of the same four parts; a ringed drop adds a second prize and makes the echo sure. */
function tables(): Record<string, TableDoc> {
  const out: Record<string, TableDoc> = {};
  TIERS.forEach((tier, t) => {
    for (const cls of CLASSES) {
      out[tableKey(tier.key, cls.key)] = {
        tier: tier.key,
        cls: cls.key,
        slots: [
          { name: "kit", from: [{ set: `kit.${cls.key}.${tier.key}` }] },
          { name: "prize", from: [{ set: `prize.${cls.key}.${tier.key}` }] },
          ...(t > 0 ? [{ name: "echo", chance: 0.35, ringed: 1, from: [{ set: `prize.${cls.key}.${TIERS[t - 1]!.key}` }] }] : []),
          { name: "second prize", chance: 0, ringed: 1, from: [{ set: `prize.${cls.key}.${tier.key}` }] },
          { name: "staples", from: [{ set: tier.staple }] },
        ],
      };
    }
  });
  return out;
}

/**
 * The book a world begins with. Its sites and circuits are the map's (content/supply/sites.ts), added by the server.
 * `fit` is what each kit's ballast line is multiplied by (the tool passes none, to measure the book as written).
 */
export function starterBook(fit: Readonly<Record<string, number>> = FIT): SupplyBook {
  // A copy each time, so that no caller's change reaches the next.
  const book: SupplyBook = {
    format: BOOK_FORMAT,
    map: "",
    revision: 0,
    rules: { noticeSeconds: 240, flightSeconds: 30, brakeSeconds: 7, lifeSeconds: 1200, baseExclusion: 100, maxLive: 12, minPlayers: 1, announce: "none", ringedChance: 0.06, ringedQuality: 1.5, floorShare: 0.4, loot: "shared" },
    worth: {
      // How hard a raw thing is to come by: a blow anywhere on land 1; from a kill 2; from rock 3; rarer rock 4; by hand
      // from the deep 5; undersea or mountain veins 6.
      raw: Object.fromEntries(
        (
          [
            [1, ["thatch", "wood", "stone", "flint", "fiber", "berry", "spoiled_meat"]],
            [2, ["hide", "meat", "narcoberry", "stimberry", "keratin", "charcoal"]],
            [3, ["ore", "chitin", "pelt"]],
            [4, ["obsidian"]],
            [5, ["silica_pearls"]],
            // Organic polymer and AnglerGel as polymer's and oil's kin: from creatures of the cold shore and the deep.
            [6, ["oil", "crystal", "angler_gel"]],
            [8, ["organic_polymer"]],
          ] as const
        ).flatMap(([worth, names]) => names.map((n) => [id(n), worth])),
      ),
      // Cooked by a fire and not crafted, and the bunk bed, which nothing makes.
      items: { [id("meat_cooked")]: 2.5, [id("meat_prime")]: 8, [id("meat_prime_cooked")]: 10.5, [id("piece_bunk_bed")]: 600 },
    },
    tiers: [...TIERS],
    classes: [...CLASSES],
    sets,
    tables: tables(),
    future: { ...FUTURE },
    circuits: [],
    sites: [],
  };
  const out = JSON.parse(JSON.stringify(book)) as SupplyBook;
  for (const [key, scale] of Object.entries(fit)) {
    const line = out.sets[key]?.entries.find((e) => e.ballast);
    if (!line) continue;
    line.min = Math.max(1, Math.round(line.min * scale));
    line.max = Math.max(line.min, Math.round(line.max * scale));
  }
  return out;
}
