// What an edit on the drop book's admin page does to a book (planning/workstreams/supply.md, "The admin page"). The
// page holds a draft, a copy of the book in force; every field on it names a place in the draft by a path, and these
// read a field's text, put its value there, add and take lines, and say what differs from the book in force. Nothing
// here decides whether a draft is a sound book: shared/supply/book.ts bookFaults does, here and on the server.

import type { BookFault, EntryDoc, SetDoc, SupplyBook } from "../../../shared/supply/book.ts";

/** A place in a book: keys and indices from its root. A set's key has dots in it, so a path is a list and not a string. */
export type Path = readonly (string | number)[];

/** A path as bookFaults writes one, to find the faults of a field. */
export const pathText = (path: Path): string => path.join(".");

export function getAt(book: SupplyBook, path: Path): unknown {
  let at: unknown = book;
  for (const key of path) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}

/** Puts `value` at `path`, or takes the key away where it is undefined. The place's parent must be there. */
export function setAt(book: SupplyBook, path: Path, value: unknown): void {
  const parent = getAt(book, path.slice(0, -1));
  const key = path[path.length - 1];
  if (typeof parent !== "object" || parent === null || key === undefined) throw new Error(`no place ${pathText(path)}`);
  if (value === undefined && !Array.isArray(parent)) delete (parent as Record<string | number, unknown>)[key];
  else (parent as Record<string | number, unknown>)[key] = value;
}

/** Makes the records on the way to `path` that are not there, so that a first weight may be put in a list of none. */
export function ensureAt(book: SupplyBook, path: Path): void {
  let at = book as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
    at = at[key] as Record<string | number, unknown>;
  }
}

/** Takes a line out of a list, or a key out of a record. */
export function removeAt(book: SupplyBook, path: Path): void {
  const parent = getAt(book, path.slice(0, -1));
  const key = path[path.length - 1];
  if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
  else if (typeof parent === "object" && parent !== null && key !== undefined) delete (parent as Record<string | number, unknown>)[key];
}

/** Moves a line of a list one place up (-1) or down (1). */
export function moveAt(book: SupplyBook, path: Path, by: -1 | 1): void {
  const list = getAt(book, path.slice(0, -1));
  const k = path[path.length - 1];
  if (!Array.isArray(list) || typeof k !== "number" || k + by < 0 || k + by >= list.length) return;
  [list[k], list[k + by]] = [list[k + by], list[k]];
}

/** What a field holds: a whole number, a number, a share written as hundredths, words, a list of ids, a yes or no, or an entry's quality. */
export type Kind = "whole" | "number" | "share" | "text" | "ids" | "flag" | "quality" | "rgb" | "pair";

/** A field's value as its text, for the page to show. */
export function show(kind: Kind, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (kind === "share") return String(Math.round((value as number) * 10000) / 100);
  if (kind === "ids") return (value as string[]).join(", ");
  if (kind === "quality") return value === "tier" ? "tier" : (value as number[]).join(" to ");
  if (kind === "pair") return (value as number[]).join(" to ");
  if (kind === "rgb") return `#${((value as number) & 0xffffff).toString(16).padStart(6, "0")}`;
  return String(value);
}

/**
 * A field's text as its value: `ok` false for text that is not its kind, which the page marks and does not put in the
 * draft. An empty field is no value (the key is taken away), where `blank` allows it.
 */
export function read(kind: Kind, text: string, blank = true): { ok: boolean; value?: unknown } {
  const t = text.trim();
  if (kind === "flag") return { ok: true, value: t === "true" ? true : undefined };
  if (t === "") return blank ? { ok: true, value: undefined } : { ok: false };
  const pair = (): number[] | null => {
    const parts = t.split(/\s*(?:to|-|–|,)\s*/).map(Number);
    return parts.length === 2 && parts.every((n) => Number.isFinite(n)) && parts[0]! <= parts[1]! ? parts : null;
  };
  if (kind === "whole" || kind === "number") {
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 && (kind === "number" || Number.isInteger(n)) ? { ok: true, value: n } : { ok: false };
  }
  if (kind === "share") {
    const n = Number(t.replace(/%$/, ""));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? { ok: true, value: Math.round(n * 100) / 10000 } : { ok: false };
  }
  if (kind === "ids") {
    const ids = t.split(/[\s,]+/).filter((s) => s !== "").map((s) => (s.includes(":") ? s : `core:${s}`));
    return ids.every((s) => /^[a-z0-9_]+:[a-z0-9_./-]+$/.test(s)) && ids.length > 0 ? { ok: true, value: ids } : { ok: false };
  }
  if (kind === "quality") {
    if (t === "tier") return { ok: true, value: "tier" };
    const p = pair();
    return p ? { ok: true, value: p } : { ok: false };
  }
  if (kind === "pair") {
    const p = pair();
    return p ? { ok: true, value: p } : { ok: false };
  }
  if (kind === "rgb") return /^#[0-9a-f]{6}$/i.test(t) ? { ok: true, value: parseInt(t.slice(1), 16) } : { ok: false };
  return { ok: true, value: t };
}

/** A new line for a set: one of something, which the editor then names. */
export function addEntry(book: SupplyBook, set: string, item = "core:thatch"): void {
  const s = book.sets[set];
  if (s) s.entries.push({ items: [item], min: 1, max: 1 } satisfies EntryDoc);
}

/** A new set, empty but for one line, under a key not taken. */
export function addSet(book: SupplyBook, key: string): boolean {
  if (key === "" || book.sets[key] !== undefined || !/^[a-z0-9_.-]{1,64}$/.test(key)) return false;
  book.sets[key] = { name: key, min: 1, max: 1, entries: [{ items: ["core:thatch"], min: 1, max: 1 }] } satisfies SetDoc;
  return true;
}

/** A new slot at a table's end, drawing always from `set`. */
export function addSlot(book: SupplyBook, table: string, set: string): void {
  book.tables[table]?.slots.push({ name: "more", from: [{ set }] });
}

/** Whether two books differ in anything but their revision and the map they are kept for, which the server sets. */
export function differs(a: SupplyBook, b: SupplyBook): boolean {
  return JSON.stringify({ ...a, revision: 0, map: "" }) !== JSON.stringify({ ...b, revision: 0, map: "" });
}

const brief = (v: unknown): string => {
  const t = JSON.stringify(v);
  return t === undefined ? "nothing" : t.length > 60 ? `${t.slice(0, 57)}…` : t;
};

/**
 * What differs between two books, a line a place: "sets.prize.arms.blue.entries.2.min: 1 → 2". A list whose length
 * changed is one line, and so is a whole thing added or taken. At most `most` lines, and then how many more.
 */
export function changes(from: SupplyBook, to: SupplyBook, most = 40): string[] {
  const out: string[] = [];
  let more = 0;
  const say = (line: string): void => void (out.length < most ? out.push(line) : more++);
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (a === b) return;
    const [oa, ob] = [typeof a === "object" && a !== null, typeof b === "object" && b !== null];
    if (!oa || !ob || Array.isArray(a) !== Array.isArray(b)) return say(`${path}: ${brief(a)} → ${brief(b)}`);
    if (Array.isArray(a) && Array.isArray(b)) {
      // Lists of plain values, and lists that grew or shrank, are said whole.
      if (a.length !== b.length || a.every((v) => typeof v !== "object")) {
        if (JSON.stringify(a) !== JSON.stringify(b)) say(a.length === b.length ? `${path}: ${brief(a)} → ${brief(b)}` : `${path}: ${a.length} → ${b.length} lines`);
        return;
      }
      a.forEach((v, k) => walk(v, b[k], `${path}.${k}`));
      return;
    }
    const [ra, rb] = [a as Record<string, unknown>, b as Record<string, unknown>];
    for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      const at = path === "" ? key : `${path}.${key}`;
      if (!(key in ra)) say(`${at}: added ${brief(rb[key])}`);
      else if (!(key in rb)) say(`${at}: taken away`);
      else walk(ra[key], rb[key], at);
    }
  };
  walk({ ...from, revision: 0, map: "" }, { ...to, revision: 0, map: "" }, "");
  if (more > 0) out.push(`and ${more} more`);
  return out;
}

/** The faults at a field or under it. */
export function faultsAt(faults: readonly BookFault[], path: Path): BookFault[] {
  const at = pathText(path);
  return faults.filter((f) => f.path === at || f.path.startsWith(`${at}.`));
}

/** A book read from a file's text: the book, or what is wrong with the text. A book's own faults are bookFaults'. */
export function parseBook(text: string): { book: SupplyBook } | { error: string } {
  let made: unknown;
  try {
    made = JSON.parse(text);
  } catch (err) {
    return { error: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof made !== "object" || made === null || Array.isArray(made)) return { error: "a book is a JSON object" };
  const b = made as Partial<SupplyBook>;
  for (const key of ["rules", "tiers", "classes", "sets", "tables"] as const) if (typeof b[key] !== "object" || b[key] === null) return { error: `a book has ${key}` };
  return { book: made as SupplyBook };
}
