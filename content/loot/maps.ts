// What each map is known for (planning/workstreams/loot.md): a find or two that is common there and rare or absent
// elsewhere, so a thing is worth carrying from one city to another. The server joins a map's to its starter book.

import type { EntryDoc, SetDoc, SourceDoc, SupplyBook, TableDoc } from "../../shared/supply/book.ts";

const id = (name: string): string => `core:${name}`;
const some = (name: string, min: number, max: number, weight = 1): EntryDoc => ({ items: [id(name)], min, max, ...(weight !== 1 ? { weight } : {}) });
const one = (set: string, note: string): TableDoc => ({ slots: [{ name: "special", from: [{ set }] }], note });

export interface MapLoot {
  readonly sets: Readonly<Record<string, SetDoc>>;
  readonly tables: Readonly<Record<string, TableDoc>>;
  readonly sources: readonly SourceDoc[];
}

export const MAP_LOOT: Readonly<Record<string, MapLoot>> = {
  // The weed on Miami's dead boats is ARK's organic polymer.
  "core:miami": {
    sets: { "special.weed": { name: "weed off a hull", min: 1, max: 1, entries: [some("organic_polymer", 2, 6)] } },
    tables: { "special/weed": one("special.weed", "Miami: a weed-grown boat.") },
    sources: [{ key: "miami/weed", name: "Weed-grown boat", on: true, kind: "static", when: { holds: ["hull_weed"] }, chance: 0.7, tables: [{ table: "special/weed" }], refillHours: [40, 60], target: 22 }],
  },
  // Tampa Bay's sunk hulks hold what lives in them: ARK's angler gel.
  "core:tampa": {
    sets: { "special.gel": { name: "gel from a sunk hulk", min: 1, max: 1, entries: [some("angler_gel", 2, 5)] } },
    tables: { "special/gel": one("special.gel", "Tampa: a sunk hulk.") },
    sources: [{ key: "tampa/sunk", name: "Sunk hulk", on: true, kind: "static", when: { holds: ["hulk_sunk"] }, chance: 0.7, tables: [{ table: "special/gel" }], refillHours: [40, 60], target: 15 }],
  },
  // San Francisco is cold enough that its homes kept furs.
  "core:san-francisco": {
    sets: { "special.furs": { name: "furs in a wardrobe", min: 1, max: 1, entries: [some("pelt", 3, 8)] } },
    tables: { "special/furs": one("special.furs", "San Francisco: a bed in a home.") },
    sources: [{ key: "sf/furs", name: "Wardrobe", on: true, kind: "static", when: { holds: ["bed"], building: ["house", "apartment_block", "tower_residential", "hotel"] }, chance: 0.12, tables: [{ table: "special/furs" }], refillHours: [40, 60], target: 2 }],
  },
  // Los Angeles's patrol cars and boats carry riot gear's plans, and rounds.
  "core:los-angeles": {
    sets: {
      "special.riot": {
        name: "a patrol's locker",
        min: 1,
        max: 1,
        entries: [{ items: ["riot_hat", "riot_shirt", "riot_gloves", "riot_pants", "riot_boots"].map(id), min: 1, max: 1, forceBlueprint: true }, some("round_pistol", 10, 20, 2), some("round_shotgun", 6, 12)],
      },
    },
    tables: { "special/riot": one("special.riot", "Los Angeles: a found patrol car, boat or helicopter.") },
    sources: [{ key: "la/patrol", name: "Patrol locker", on: true, kind: "vehicle", when: { species: ["patrol_sedan", "patrol_jeep", "boat_police", "helicopter_police"].map(id) }, chance: 0.8, tables: [{ table: "special/riot" }], target: 390 }],
  },
  // Las Vegas's pay stations pay out now and then: plasma cells, and once in a long while a plasma pistol's plan.
  "core:las-vegas": {
    sets: { "special.jackpot": { name: "a jackpot", min: 1, max: 1, entries: [some("plasma_cell", 2, 6, 3), some("plasma_charge", 1, 3, 2), { items: [id("pistol_plasma")], min: 1, max: 1, forceBlueprint: true, weight: 0.3 }] } },
    tables: { "special/jackpot": one("special.jackpot", "Las Vegas: a pay station.") },
    sources: [{ key: "vegas/jackpot", name: "Jackpot", on: true, kind: "static", when: { holds: ["paystation"] }, chance: 0.05, tables: [{ table: "special/jackpot" }], refillHours: [40, 60], target: 9 }],
  },
};

/** `book` with the specials of map `mapId` added to its sets, tables and sources, where it has none by those keys. */
export function withSpecials(book: SupplyBook, mapId: string): SupplyBook {
  const map = MAP_LOOT[mapId];
  if (!map) return book;
  const have = new Set((book.sources ?? []).map((s) => s.key));
  return { ...book, sets: { ...map.sets, ...book.sets }, tables: { ...map.tables, ...book.tables }, sources: [...(book.sources ?? []), ...map.sources.filter((s) => !have.has(s.key)).map((s) => ({ ...s }))] };
}

/** `book` with every map's specials: what the game can give somewhere, for the lists of what has no source. */
export const withEverySpecial = (book: SupplyBook): SupplyBook => Object.keys(MAP_LOOT).reduce((b, mapId) => withSpecials(b, mapId), book);
