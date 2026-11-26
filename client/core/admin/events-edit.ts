// What an edit on the events page does to an event book (planning/workstreams/map-events.md, "The events page"). The
// page holds a draft, a copy of the book in force; every field on it names a place in the draft by a path, and these
// read a field's text, put its value there, switch kinds, add and take schedules, and say what differs from the book in
// force. Whether a draft is a sound book is shared/mapevent/book.ts's to say, here and on the server.

import type { EventBook, KindSheet, ScheduleDoc } from "../../../shared/mapevent/book.ts";
import type { FieldDef, FieldValue } from "../../../shared/mapevent/fields.ts";
import type { SupplyBook } from "../../../shared/supply/book.ts";
import { changes as bookChanges } from "../drops/edit.ts";

export type Path = readonly (string | number)[];

/**
 * What a field holds: a number, a whole number, a share typed as a percent, [least, most] of numbers or of whole numbers,
 * a switch, text, keys separated by commas, a span of the day's hours (empty for any), or one of a list.
 */
export type EditKind = "number" | "whole" | "share" | "pair" | "wholePair" | "flag" | "text" | "keys" | "hours" | "choice";

/** The edit kind of a kind's tuning field. */
export function editKindOf(f: FieldDef): EditKind {
  switch (f.kind) {
    case "range":
      return "pair";
    case "wholeRange":
      return "wholePair";
    default:
      return f.kind;
  }
}

export function getAt(book: unknown, path: Path): unknown {
  let at: unknown = book;
  for (const key of path) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}

/** Puts `value` at `path`, making the objects on the way where they are not. */
export function setAt(book: unknown, path: Path, value: unknown): void {
  let at = book as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
    at = at[key] as Record<string | number, unknown>;
  }
  const last = path[path.length - 1];
  if (last === undefined) throw new Error("an empty path");
  at[last] = value;
}

/** A field's value as its text, for the page to show. */
export function show(kind: EditKind, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (kind === "share") return String(Math.round((value as number) * 10000) / 100);
  if (kind === "pair" || kind === "wholePair" || kind === "hours") return (value as number[]).join(" to ");
  if (kind === "keys") return (value as string[]).join(", ");
  return String(value);
}

const KEY = /^[a-z0-9][a-z0-9_.:/-]{0,63}$/;

/**
 * A field's text as its value: `ok` false for text that is not its kind, which the page marks and does not put in the
 * draft. Every field must say something, but a span of hours, where empty is any hour (null).
 */
export function read(kind: EditKind, text: string): { ok: boolean; value?: unknown } {
  const t = text.trim();
  if (kind === "flag") return { ok: true, value: t === "true" };
  if (kind === "text" || kind === "choice") return { ok: true, value: text };
  if (kind === "hours" && (t === "" || t === "any")) return { ok: true, value: null };
  if (t === "") return { ok: false };
  const pair = (): number[] | null => {
    const parts = t.split(/\s*(?:to|–|,|\s)\s*/).filter((p) => p !== "").map(Number);
    return parts.length === 2 && parts.every((n) => Number.isFinite(n)) ? parts : null;
  };
  if (kind === "number" || kind === "whole") {
    const n = Number(t);
    return Number.isFinite(n) && (kind === "number" || Number.isInteger(n)) ? { ok: true, value: n } : { ok: false };
  }
  if (kind === "share") {
    const n = Number(t.replace(/%$/, ""));
    return Number.isFinite(n) && n >= 0 && n <= 100 ? { ok: true, value: Math.round(n * 100) / 10000 } : { ok: false };
  }
  if (kind === "pair" || kind === "wholePair" || kind === "hours") {
    const p = pair();
    if (!p || (kind !== "hours" && p[0]! > p[1]!) || (kind === "wholePair" && !p.every(Number.isInteger))) return { ok: false };
    return kind === "hours" && !p.every((h) => h >= 0 && h < 24) ? { ok: false } : { ok: true, value: p };
  }
  // keys
  const keys = t.split(/[\s,]+/).filter((s) => s !== "");
  return keys.length > 0 && keys.every((k) => KEY.test(k)) ? { ok: true, value: keys } : { ok: false };
}

/** A kind's value in a book: the book's where it has one, its field's default where not. */
export function tuningValue(book: EventBook, sheet: KindSheet, key: string): FieldValue {
  return (book.tuning[sheet.id]?.[key] ?? sheet.fields[key]?.def) as FieldValue;
}

/**
 * Sets a kind's field in a book. A value equal to its default is taken out, and a kind with no value left has no tuning
 * of its own, so a book holds only what was changed.
 */
export function setTuning(book: EventBook, sheet: KindSheet, key: string, value: unknown): void {
  const f = sheet.fields[key];
  const own = { ...(book.tuning[sheet.id] ?? {}) };
  if (f && JSON.stringify(f.def) === JSON.stringify(value)) delete own[key];
  else own[key] = value as FieldValue;
  if (Object.keys(own).length === 0) delete book.tuning[sheet.id];
  else book.tuning[sheet.id] = own;
}

/** Every field of a kind back to its default. */
export function resetTuning(book: EventBook, kind: string): void {
  delete book.tuning[kind];
}

/** Switches a kind on or off. On is said by not naming it. */
export function setKindOn(book: EventBook, kind: string, on: boolean): void {
  if (on) delete book.kinds[kind];
  else book.kinds[kind] = { on: false };
}

/** A schedule's key not taken in `book`: `base`, or `base.2`, `base.3`… */
export function freeKey(book: EventBook, base: string): string {
  const taken = new Set(book.schedules.map((s) => s.key));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}.${n}`)) return `${base}.${n}`;
}

/** A new schedule of `kind` at the list's end: off, so that nothing is called by it until it is looked over and switched on. */
export function addSchedule(book: EventBook, kind: string): string {
  const key = freeKey(book, `${kind}.new`);
  book.schedules.push({ key, kind, on: false, firstDelay: [600, 1800], interval: [3600, 7200], maxLive: 1, hours: null, chance: 1 });
  return key;
}

/** Takes the schedule at `k` out. */
export function removeSchedule(book: EventBook, k: number): void {
  if (k >= 0 && k < book.schedules.length) book.schedules.splice(k, 1);
}

/** Adds a kind's starter schedules the book has not got, each under a key of its own. Returns how many it added. */
export function addStarter(book: EventBook, sheet: KindSheet): number {
  let n = 0;
  for (const s of sheet.schedules) {
    if (book.schedules.some((b) => b.kind === sheet.id && b.key === s.key)) continue;
    const doc: ScheduleDoc = { ...s, kind: sheet.id, key: freeKey(book, s.key), firstDelay: [...s.firstDelay], interval: [...s.interval], hours: s.hours ? [...s.hours] : null };
    book.schedules.push(doc);
    n++;
  }
  return n;
}

/** Whether two books differ in anything but their revision and the map they are kept for, which the server sets. */
export function differs(a: EventBook, b: EventBook): boolean {
  return JSON.stringify({ ...a, revision: 0, map: "" }) !== JSON.stringify({ ...b, revision: 0, map: "" });
}

/** What differs between two books, a line a place: "tuning.ufo.health: 60000 → 40000". */
export function changes(from: EventBook, to: EventBook, most = 40): string[] {
  // The drops page's walk reads any JSON alike; only its type names the drop book.
  return bookChanges(from as unknown as SupplyBook, to as unknown as SupplyBook, most);
}

/** A book read from a file's text: the book, or what is wrong with the text. A book's own faults are eventBookFaults'. */
export function parseEventBook(text: string): { book: EventBook } | { error: string } {
  let made: unknown;
  try {
    made = JSON.parse(text);
  } catch (err) {
    return { error: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof made !== "object" || made === null || Array.isArray(made)) return { error: "a book is a JSON object" };
  const b = made as Partial<EventBook> & Record<string, unknown>;
  // A drop book has these and an event book does not: the wrong file, said plainly.
  if ("tables" in b || "tiers" in b) return { error: "this is a drop book, not an event book" };
  for (const key of ["rules", "kinds", "tuning"] as const) if (typeof b[key] !== "object" || b[key] === null) return { error: `an event book has ${key}` };
  if (!Array.isArray(b.schedules)) return { error: "an event book has schedules" };
  return { book: made as EventBook };
}
