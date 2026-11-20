// What a world says of itself to the server directories it is listed in (D872): the world gives it in its
// entry-world.json, a directory reads it from there and keeps it, and a title shows it. Each of the three keeps only
// what `listing` passes, so a field is checked the same way wherever it is.

/** Short facts for a server list to show, sort and filter by: rates=3x, region=eu, slots=40. */
export type Tags = Record<string, string | number>;

/** What a listed world says of itself, past its address. */
export interface Listed {
  name: string;
  map: string;
  players: number;
  max: number;
  password: boolean;
  /** ARK's serverPVE: survivors and what they own cannot be harmed by other tribes. */
  pve: boolean;
  /** A line or two about the world. */
  about: string;
  /** Its Discord invite, or "". */
  discord: string;
  tags: Tags;
}

export const ABOUT_MAX = 300;
export const TAGS_MAX = 12;
const TAG_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const TAG_VALUE_MAX = 40;
const DISCORD = /^https:\/\/(discord\.gg\/[A-Za-z0-9-]{2,32}|discord\.com\/invite\/[A-Za-z0-9-]{2,32})$/;

/** Words as a list shows them: no control or formatting characters (bidirectional overrides among them), one space between words. */
export const plain = (raw: unknown) =>
  String(raw ?? "")
    .replace(/\s/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ +/g, " ")
    .trim();

/** A Discord invite as given, or "" for anything else. */
export const discordOf = (raw: unknown) => (typeof raw === "string" && DISCORD.test(raw.trim()) ? raw.trim() : "");

/**
 * Tags from a world's ServerTags ("rates=3x, region=eu") or from a listing's object: lowercase names, short values, a
 * number kept a number, the first of a name kept, at most TAGS_MAX. Anything else is dropped, not refused.
 */
export function tagsOf(raw: unknown): Tags {
  const pairs: [string, unknown][] =
    typeof raw === "string"
      ? raw.split(",").flatMap((p): [string, unknown][] => (p.includes("=") ? [[p.slice(0, p.indexOf("=")).trim().toLowerCase(), p.slice(p.indexOf("=") + 1)]] : []))
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.entries(raw)
        : [];
  const tags: Tags = {};
  for (const [name, v] of pairs) {
    if (Object.keys(tags).length >= TAGS_MAX) break;
    if (!TAG_NAME.test(name) || Object.hasOwn(tags, name) || (typeof v !== "string" && typeof v !== "number")) continue;
    const text = typeof v === "number" ? String(v) : plain(v);
    if (!text || text.length > TAG_VALUE_MAX) continue;
    const n = Number(text);
    tags[name] = /^-?\d+(\.\d+)?$/.test(text) && Number.isFinite(n) ? n : text;
  }
  return tags;
}

/** What may be listed of what a world says, or null if it is not a world that can be listed. */
export function listing(w: Record<string, unknown>): Listed | null {
  const name = plain(w.name).slice(0, 80),
    map = plain(w.map).slice(0, 80),
    players = Number(w.players),
    max = Number(w.max);
  if (!name || !map || !Number.isInteger(players) || !Number.isInteger(max) || players < 0 || max < 1 || max > 10000 || players > max) return null;
  return { name, map, players, max, password: w.password === true, pve: w.pve === true, about: plain(w.about).slice(0, ABOUT_MAX), discord: discordOf(w.discord), tags: tagsOf(w.tags) };
}
