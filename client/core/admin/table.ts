// The admin page's table of survivors: finding one by a few letters of its name or its tribe's, and the orders it is sorted
// in. Online survivors lead every order but the alphabet's.

import type { SurvivorRow } from "../../../shared/admin.ts";
import type { FramedDims } from "../../../shared/coords.ts";
import { latLonText, latOf, lonOf } from "../../../shared/world/coords.ts";
import { agoText, spanText } from "./format.ts";

export const SORTS = ["seen", "name", "tribe", "level", "played", "deaths"] as const;
export type SortKey = (typeof SORTS)[number];

/** A row that can be searched: a survivor's, now or at the playhead. */
interface Named {
  name: string;
  tribe: string;
}

/** How well a row answers a search: 3 a name that starts with it, 2 a word of the name that does, 1 a name or tribe holding it, else 0. */
function match(r: Named, words: readonly string[]): number {
  const name = r.name.toLowerCase();
  const tribe = r.tribe.toLowerCase();
  if (!words.every((w) => name.includes(w) || tribe.includes(w))) return 0;
  const whole = words.join(" ");
  if (name.startsWith(whole)) return 3;
  return name.split(/\s+/).some((part) => part.startsWith(words[0]!)) ? 2 : 1;
}

/** The rows a search finds, best first, each order kept among equals; every row for a blank search. */
export function findSurvivors<T extends Named>(rows: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [...rows];
  return rows.map((r) => ({ r, m: match(r, words) })).filter((x) => x.m > 0).sort((a, b) => b.m - a.m).map((x) => x.r);
}

const byName = (a: SurvivorRow, b: SurvivorRow): number => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** The rows in an order: by when last seen (the default), name, tribe, level, play time or deaths, most first but for words. */
export function sortSurvivors(rows: readonly SurvivorRow[], key: SortKey): SurvivorRow[] {
  const online = (a: SurvivorRow, b: SurvivorRow): number => Number(b.online) - Number(a.online);
  const most = (f: (r: SurvivorRow) => number) => (a: SurvivorRow, b: SurvivorRow): number => online(a, b) || f(b) - f(a) || byName(a, b);
  const order: Record<SortKey, (a: SurvivorRow, b: SurvivorRow) => number> = {
    seen: most((r) => r.lastSeen ?? -1),
    name: byName,
    tribe: (a, b) => online(a, b) || (a.tribe === "" ? 1 : 0) - (b.tribe === "" ? 1 : 0) || a.tribe.localeCompare(b.tribe, "en", { sensitivity: "base" }) || byName(a, b),
    level: most((r) => r.level),
    played: most((r) => r.playMs ?? 0),
    deaths: most((r) => r.deaths.length),
  };
  return [...rows].sort(order[key]);
}

/** "online", "dead", "knocked out", or when last seen. */
export function seenText(r: SurvivorRow, now: number): string {
  if (r.online) return r.dead ? "online, dead" : r.out ? "online, knocked out" : "online";
  return r.lastSeen === null ? "never seen" : agoText(r.lastSeen, now);
}

export function playedText(r: SurvivorRow): string {
  return r.playMs === null ? "" : spanText(r.playMs);
}

/** A place as every screen writes it, latitude first. */
export function placeText(d: FramedDims, x: number, z: number): string {
  return latLonText(latOf(d, z), lonOf(d, x));
}

/** The deaths a survivor's record keeps, and the latest's time or tick. */
export function deathsText(r: SurvivorRow, now: number): string {
  const last = r.deaths.at(-1);
  if (!last) return "";
  return `${r.deaths.length}, last ${last.at === null ? `at tick ${last.tick}` : agoText(last.at, now)}`;
}
