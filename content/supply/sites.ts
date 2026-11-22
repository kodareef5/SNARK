// Where and how often the starter book's drops land (planning/workstreams/supply.md). A city has a list of sites found
// on its built map by the site rule (shared/supply/sites.ts; `bun run supply sites` writes content/supply/city-sites.ts),
// in three bands by how far each is from where survivors rise, and a circuit to each band: the nearer ground gets the
// lower tiers and gets them more often, as ARK's beaches do and its mountains do not. A map with no list has one
// circuit that draws open ground at random, by the same test of a place.

import type { CircuitDoc, SiteDoc, SupplyBook } from "../../shared/supply/book.ts";
import { CITY_SITES } from "./city-sites.ts";

export interface Band {
  readonly key: string;
  readonly name: string;
  /** The share of a map's sites it takes, nearest the spawns first. */
  readonly share: number;
  readonly maxLive: number;
  readonly firstDelay: [number, number];
  readonly interval: [number, number];
  readonly tierWeights: Readonly<Record<string, number>>;
}

/**
 * Twelve live at the most between them, which is the book's own limit. Each band's weights lean to its lowest tier, as
 * ARK's higher colours are the rarer; red and Meridian come only where the walk is long.
 */
export const BANDS: readonly Band[] = [
  { key: "shore", name: "Near the landings", share: 0.4, maxLive: 5, firstDelay: [60, 180], interval: [240, 420], tierWeights: { white: 5, green: 3.5, blue: 1.5, purple: 0.5 } },
  { key: "inland", name: "Inland", share: 0.35, maxLive: 4, firstDelay: [120, 300], interval: [360, 600], tierWeights: { green: 2, blue: 3, purple: 3, yellow: 1.5, red: 0.4 } },
  { key: "deep", name: "The far ground", share: 0.25, maxLive: 3, firstDelay: [240, 480], interval: [540, 900], tierWeights: { purple: 1.5, yellow: 3, red: 2.5, meridian: 1 } },
];

/** A map with no sites: open ground anywhere, every tier, the higher the rarer. */
export const OPEN: CircuitDoc = { key: "open", name: "Open ground", on: true, sites: [], maxLive: 8, firstDelay: [60, 180], interval: [240, 480], tierWeights: { white: 5, green: 4, blue: 3, purple: 2, yellow: 1.2, red: 0.6, meridian: 0.2 } };

const pad = (n: number): string => String(n).padStart(3, "0");

/** A band's sites and its circuit, from its places as x and z in turn. */
export function bandDocs(band: Band, places: readonly number[]): { sites: SiteDoc[]; circuit: CircuitDoc } {
  const sites: SiteDoc[] = [];
  for (let k = 0; k + 1 < places.length; k += 2) sites.push({ key: `${band.key}/${pad(k / 2 + 1)}`, x: places[k]!, z: places[k + 1]! });
  return { sites, circuit: { key: band.key, name: band.name, on: true, sites: sites.map((s) => s.key), maxLive: band.maxLive, firstDelay: [...band.firstDelay], interval: [...band.interval], tierWeights: { ...band.tierWeights } } };
}

/** `book` with the sites and circuits of the map: its city's list in three bands, or the one circuit over open ground. */
export function withSites(book: SupplyBook, mapId: string): SupplyBook {
  const city = CITY_SITES[mapId];
  if (!city) return { ...book, sites: [], circuits: [JSON.parse(JSON.stringify(OPEN)) as CircuitDoc] };
  const docs = BANDS.map((band) => bandDocs(band, city[band.key] ?? []));
  return { ...book, sites: docs.flatMap((d) => d.sites), circuits: docs.filter((d) => d.sites.length > 0).map((d) => d.circuit) };
}
