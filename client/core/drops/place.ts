// Places and pace on the drop book's admin page (planning/workstreams/supply.md, "The admin page"): where a point of
// the world is on the page's map and back, the sites of a draft added, moved and taken away, and how many drops an
// hour a circuit will call. The map is the admin pages' relief picture (shared/world/relief.ts), a square the longer of
// the world's sides across with the world in its middle, north up and x running west.

import type { CircuitDoc, SiteDoc, SupplyBook } from "../../../shared/supply/book.ts";

export interface WorldSize {
  sizeX: number;
  sizeZ: number;
}

/** Where a place of the world is on a square picture `side` pixels across. */
export function toPixel(w: WorldSize, x: number, z: number, side: number): [number, number] {
  const whole = Math.max(w.sizeX, w.sizeZ);
  return [(((w.sizeX + whole) / 2 - x) / whole) * side, (((w.sizeZ + whole) / 2 - z) / whole) * side];
}

/** The place of the world under a point of the picture, to the metre. */
export function toWorld(w: WorldSize, px: number, py: number, side: number): [number, number] {
  const whole = Math.max(w.sizeX, w.sizeZ);
  return [Math.round((w.sizeX + whole) / 2 - (px / side) * whole), Math.round((w.sizeZ + whole) / 2 - (py / side) * whole)];
}

export const inWorld = (w: WorldSize, x: number, z: number): boolean => x >= 0 && z >= 0 && x <= w.sizeX && z <= w.sizeZ;

/** The site nearest a place, within `reach` metres of it, or null. */
export function siteNear(sites: readonly SiteDoc[], x: number, z: number, reach: number): SiteDoc | null {
  let best: SiteDoc | null = null;
  let near = reach;
  for (const s of sites) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d <= near) [best, near] = [s, d];
  }
  return best;
}

/** The circuit a site belongs to, or null for one no circuit names. */
export function circuitOf(book: SupplyBook, site: string): CircuitDoc | null {
  return book.circuits.find((c) => c.sites.includes(site)) ?? null;
}

/** A new site of a circuit at a place, under the next key the circuit has free. Its key. */
export function addSite(book: SupplyBook, circuit: string, x: number, z: number): string | null {
  const c = book.circuits.find((k) => k.key === circuit);
  if (!c) return null;
  const taken = new Set(book.sites.map((s) => s.key));
  let n = c.sites.length + 1;
  let key = `${circuit}/${String(n).padStart(3, "0")}`;
  while (taken.has(key)) key = `${circuit}/${String(++n).padStart(3, "0")}`;
  book.sites.push({ key, x: Math.round(x), z: Math.round(z) });
  c.sites.push(key);
  return key;
}

export function moveSite(book: SupplyBook, key: string, x: number, z: number): void {
  const s = book.sites.find((k) => k.key === key);
  if (s) [s.x, s.z] = [Math.round(x), Math.round(z)];
}

/** Takes a site out of the book and out of every circuit that names it. */
export function removeSite(book: SupplyBook, key: string): void {
  book.sites = book.sites.filter((s) => s.key !== key);
  for (const c of book.circuits) c.sites = c.sites.filter((k) => k !== key);
}

/** A circuit with no sites of its own under a key not taken, off until it is given some or an area. */
export function addCircuit(book: SupplyBook, key: string): boolean {
  if (!/^[a-z0-9_-]{1,32}$/.test(key) || book.circuits.some((c) => c.key === key)) return false;
  book.circuits.push({ key, name: key, on: false, sites: [], maxLive: 3, firstDelay: [120, 300], interval: [300, 600], tierWeights: Object.fromEntries(book.tiers.slice(0, 3).map((t) => [t.key, 1])) });
  return true;
}

/** Takes a circuit away, and its sites with it. */
export function removeCircuit(book: SupplyBook, key: string): void {
  const c = book.circuits.find((k) => k.key === key);
  if (!c) return;
  const gone = new Set(c.sites);
  book.sites = book.sites.filter((s) => !gone.has(s.key));
  book.circuits = book.circuits.filter((k) => k.key !== key);
}

export interface Forecast {
  /** Drops an hour by its clock alone, and with its own and the book's most at once holding it back. */
  asked: number;
  hour: number;
  /** What holds it back: "", "its most at once", "the book's most at once", "it is off", "it draws no tier". */
  held: string;
  /** Each tier's share of its drops, in the book's order, for the tiers it draws. */
  tiers: { key: string; share: number }[];
}

/**
 * What a circuit will call in an hour with somebody near. Its clock asks for one every mean interval; no more than its
 * most at once may be live, and a drop is live from its call to the end of its time on the ground if nobody empties
 * it, so that is a ceiling on the hour too. The book's own most at once is shared by every circuit.
 */
export function forecast(book: SupplyBook, c: CircuitDoc): Forecast {
  const total = book.tiers.reduce((n, t) => n + (c.tierWeights[t.key] ?? 0), 0);
  const tiers = total > 0 ? book.tiers.filter((t) => (c.tierWeights[t.key] ?? 0) > 0).map((t) => ({ key: t.key, share: (c.tierWeights[t.key] ?? 0) / total })) : [];
  const asked = 3600 / Math.max(1, (c.interval[0] + c.interval[1]) / 2);
  if (!c.on) return { asked, hour: 0, held: "it is off", tiers };
  if (total <= 0) return { asked, hour: 0, held: "it draws no tier", tiers };
  const live = book.rules.noticeSeconds + book.rules.lifeSeconds;
  const own = (c.maxLive * 3600) / live;
  const all = (book.rules.maxLive * 3600) / live;
  const hour = Math.min(asked, own, all);
  return { asked, hour, held: hour === asked ? "" : own <= all ? "its most at once" : "the book's most at once", tiers };
}
