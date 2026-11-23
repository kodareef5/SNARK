// The loadout book: named sets of what a new survivor wears and carries, and which set each role is given.
// An admin edits it while the world runs, so it is a document and not content. Everything here is plain data and pure.

import type { ItemDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { QUALITY_NAMES } from "../sim/items.ts";

/** The most of each a book may hold, so a mistaken document costs a bounded amount to check and hand out. */
export const MOST = { loadouts: 64, entries: 64, bytes: 256 * 1024, label: 40, note: 200, level: 1000, count: 10000 } as const;
/** A loadout's id: what a console line and a URL carry unescaped. */
export const LOADOUT_ID = /^[a-z0-9-]{1,32}$/;

export type Place = "wear" | "hotbar" | "bag";

export interface ItemEntry {
  item: string;
  count: number;
  /** An index into QUALITY_NAMES; primitive where not given. */
  quality?: number;
  blueprint?: boolean;
  place: Place;
  /** The ammunition a weapon comes loaded with, and the attachment it comes fitted with. */
  ammo?: string;
  attach?: string;
}

/** A tame of a species, handed over in a soul ball. */
export interface TameEntry {
  tame: string;
  level: number;
  saddled: boolean;
  place: "hotbar" | "bag";
}

export type Entry = ItemEntry | TameEntry;

export interface Loadout {
  id: string;
  label: string;
  note: string;
  /** True hands it out again after each death; false at the first join only. */
  respawn: boolean;
  entries: Entry[];
}

export interface LoadoutBook {
  /** Raised by every save; a save names the revision it changed. */
  revision: number;
  /** The id of the loadout each role is given. */
  assign: { player: string; admin: string };
  loadouts: Loadout[];
}

/** Something wrong with a book, at a path into it. A warning does not stop it from being saved. */
export interface LoadoutFault {
  path: string;
  message: string;
  warn?: boolean;
}

export function isTame(e: Entry): e is TameEntry {
  return "tame" in e;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const contentId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 96;
const whole = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const text = (v: unknown, min: number, max: number): boolean => typeof v === "string" && v.length >= min && [...v].length <= max;

/** What the registry says of the game's items and species, as the checks below ask it. */
interface Known {
  reg: Registry;
  /** Items that stand for a record (a fertilised egg, a full soul ball): made without one they are broken. */
  never: Set<number>;
  /** Species a saddle fits. */
  saddled: Set<number>;
}

function known(reg: Registry): Known {
  const never = new Set<number>();
  const saddled = new Set<number>();
  for (const k of reg.propFertile) if (k !== 0) never.add(k);
  for (let i = 1; i < reg.defs.length; i++) {
    if (reg.ballEmpty[i] !== 0) never.add(i);
    if (reg.saddleFits[i] !== 0) saddled.add(reg.saddleFits[i]!);
  }
  return { reg, never, saddled };
}

/** Why the game lacks `id`, said with what it was renamed to where it was. */
function lacking(reg: Registry, id: string): string {
  const now = reg.redirects.get(id);
  return now && now.length > 0 ? `the game no longer has ${id}: it is now ${now.map((k) => reg.ids[k]).join(", ")}` : `the game has no ${id}`;
}

/**
 * What is wrong with a book. It reads `book` as untrusted, since an admin page or a file may hand it anything, and never
 * throws. With `reg` it also checks each id against the game: one the game lacks is a warning, so a book written for
 * other content still loads.
 */
export function loadoutFaults(book: unknown, reg?: Registry): LoadoutFault[] {
  const out: LoadoutFault[] = [];
  const bad = (path: string, message: string): void => void out.push({ path, message });
  const warn = (path: string, message: string): void => void out.push({ path, message, warn: true });
  if (!isObject(book)) return [{ path: "", message: "a book is an object" }];
  const b = book as Partial<LoadoutBook>;
  if (!whole(b.revision, 0, Number.MAX_SAFE_INTEGER)) bad("revision", "a whole number, not negative");
  const game = reg ? known(reg) : null;

  const item = (at: string, e: Record<string, unknown>, worn: Set<number>): void => {
    const blueprint = e.blueprint === true;
    if (!contentId(e.item)) bad(`${at}.item`, "an item's id");
    if (!whole(e.count, 1, MOST.count)) bad(`${at}.count`, `a whole number from 1 to ${MOST.count}`);
    else if (e.place === "wear" && e.count !== 1) bad(`${at}.count`, "one piece is worn");
    if (e.quality !== undefined && !whole(e.quality, 0, QUALITY_NAMES.length - 1)) bad(`${at}.quality`, `a whole number from 0 (${QUALITY_NAMES[0]}) to ${QUALITY_NAMES.length - 1} (${QUALITY_NAMES.at(-1)})`);
    if (e.blueprint !== undefined && typeof e.blueprint !== "boolean") bad(`${at}.blueprint`, "true or false");
    if (e.place !== "wear" && e.place !== "hotbar" && e.place !== "bag") bad(`${at}.place`, "one of wear, hotbar, bag");
    else if (blueprint && e.place !== "bag") bad(`${at}.place`, "a blueprint goes in the bag");
    for (const part of ["ammo", "attach"] as const) {
      if (e[part] === undefined) continue;
      if (!contentId(e[part])) bad(`${at}.${part}`, "an item's id");
      else if (blueprint) bad(`${at}.${part}`, "a blueprint holds no rounds and takes no attachment");
    }
    if (!game || !contentId(e.item)) return;
    const { reg } = game;
    const k = reg.index.get(e.item);
    if (k === undefined) return warn(`${at}.item`, lacking(reg, e.item));
    const def = reg.defs[k]!;
    if (def.type !== "item") return bad(`${at}.item`, `${e.item} is not an item`);
    if (game.never.has(k)) bad(`${at}.item`, `${e.item} stands for a record and is never handed out by itself`);
    if (blueprint && reg.blueprints[k] !== 1) bad(`${at}.blueprint`, `${e.item} is never a blueprint`);
    if (e.place === "wear") {
      const slot = reg.wearSlot[k]!;
      if (slot < 0) bad(`${at}.place`, `${e.item} is not armor, so it is not worn`);
      else if (worn.has(slot)) warn(`${at}.place`, "another entry is worn in the same place, so this one stays in the bag");
      else worn.add(slot);
    }
    const weapon = (def as ItemDef).weapon;
    const ammo = contentId(e.ammo) ? reg.index.get(e.ammo) : undefined;
    if (contentId(e.ammo)) {
      if (ammo === undefined) warn(`${at}.ammo`, lacking(reg, e.ammo));
      else if (!weapon?.ammo?.includes(e.ammo)) warn(`${at}.ammo`, `${e.item} does not take ${e.ammo}`);
    }
    if (contentId(e.attach)) {
      if (!reg.index.has(e.attach)) warn(`${at}.attach`, lacking(reg, e.attach));
      else if (!weapon?.fits?.includes(e.attach)) warn(`${at}.attach`, `${e.attach} does not fit ${e.item}`);
      else if (ammo !== undefined && (reg.defs[ammo] as ItemDef).ammo?.bare === true) warn(`${at}.attach`, `loaded with ${e.ammo as string}, ${e.item} takes no attachment`);
    }
  };

  const tame = (at: string, e: Record<string, unknown>): void => {
    if (!contentId(e.tame)) bad(`${at}.tame`, "a species' id");
    if (!whole(e.level, 1, MOST.level)) bad(`${at}.level`, `a whole number from 1 to ${MOST.level}`);
    if (typeof e.saddled !== "boolean") bad(`${at}.saddled`, "true or false");
    if (e.place !== "hotbar" && e.place !== "bag") bad(`${at}.place`, "one of hotbar, bag");
    if (!game || !contentId(e.tame)) return;
    const k = game.reg.index.get(e.tame);
    if (k === undefined) return warn(`${at}.tame`, lacking(game.reg, e.tame));
    const def = game.reg.defs[k]!;
    if (def.type !== "species" || def.class !== "creature") return bad(`${at}.tame`, `${e.tame} is not a creature`);
    if (e.saddled === true && !game.saddled.has(k)) warn(`${at}.saddled`, `no saddle fits ${e.tame}`);
  };

  const ids = new Set<string>();
  if (!Array.isArray(b.loadouts)) bad("loadouts", "the loadouts are a list");
  else {
    if (b.loadouts.length > MOST.loadouts) bad("loadouts", `at most ${MOST.loadouts} loadouts`);
    b.loadouts.slice(0, MOST.loadouts).forEach((l: unknown, i) => {
      const path = `loadouts[${i}]`;
      if (!isObject(l)) return bad(path, "a loadout is { id, label, note, respawn, entries }");
      if (typeof l.id !== "string" || !LOADOUT_ID.test(l.id)) bad(`${path}.id`, "an id is 1 to 32 of a to z, 0 to 9 and -");
      else if (ids.has(l.id)) bad(`${path}.id`, "a loadout's id is its own");
      else ids.add(l.id);
      if (!text(l.label, 1, MOST.label)) bad(`${path}.label`, `a label of 1 to ${MOST.label} characters`);
      if (!text(l.note, 0, MOST.note)) bad(`${path}.note`, `a note of at most ${MOST.note} characters`);
      if (typeof l.respawn !== "boolean") bad(`${path}.respawn`, "true or false");
      if (!Array.isArray(l.entries)) return bad(`${path}.entries`, "the entries are a list");
      if (l.entries.length > MOST.entries) bad(`${path}.entries`, `at most ${MOST.entries} entries`);
      const worn = new Set<number>();
      l.entries.slice(0, MOST.entries).forEach((e: unknown, j) => {
        const at = `${path}.entries[${j}]`;
        if (!isObject(e)) return bad(at, "an entry is an item or a tame");
        if ("tame" in e && "item" in e) return bad(at, "an entry is an item or a tame, not both");
        if ("tame" in e) tame(at, e);
        else item(at, e, worn);
      });
    });
  }

  if (!isObject(b.assign)) bad("assign", "assign is { player, admin }, each the id of a loadout");
  else for (const role of ["player", "admin"] as const) if (typeof b.assign[role] !== "string" || !ids.has(b.assign[role])) bad(`assign.${role}`, "names a loadout of the book");
  return out;
}
