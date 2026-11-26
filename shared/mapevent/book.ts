// A world's event book (planning/workstreams/map-events.md): which kinds of map event run, how often, under what rules,
// and each kind's tuning. Like the drop book it is admin data, a JSON file beside the save, edited on the events page
// while the world runs. The kinds are code, defined by modules; the book only switches, schedules and tunes them.
//
// It is read leniently and saved strictly. A book is kept whole, so a kind no module defines now, or a field a kind no
// longer has, is warned of and kept as written; a value out of its field's bounds is warned of at load and its default
// used, and refused at save.

import type { BookFault } from "../supply/book.ts";
import { fieldsFaults, valueFaults, type FieldValue, type Fields } from "./fields.ts";

export const EVENT_BOOK_FORMAT = 2;
/** The most events live on a map at once. */
export const MAPEVENT_MOST = 8;
export const EVENT_MOST = { schedules: 32, kinds: 64, bytes: 256 * 1024 } as const;
const KEY = /^[a-z0-9][a-z0-9_./-]{0,47}$/;
/** A kind's id: "ufo". */
export const KIND_ID = /^[a-z][a-z0-9_]{0,31}$/;

/** How an event is told of besides being seen and heard: nothing more, or a line to everyone in the world. */
export type EventAnnounce = "none" | "chat";

export interface EventRules {
  /** Survivors in the world at the least for a schedule to call an event. */
  minPlayers: number;
  /** Events live on the map at once at the most. */
  maxLive: number;
}

/** A schedule: a clock of its own that calls events of one kind. */
export interface ScheduleDoc {
  key: string;
  kind: string;
  on: boolean;
  /** Seconds from the world's start, or from the book's saving, to its first look: [least, most]. */
  firstDelay: [number, number];
  /** Seconds between looks: [least, most]. */
  interval: [number, number];
  /** Events of this schedule live at once at the most. */
  maxLive: number;
  /** Hours of the world's day it calls in, [from, to], wrapping past midnight where `from` is the later; null for any. */
  hours: [number, number] | null;
  /** Its own chance at each look of calling one, 0 to 1. */
  chance: number;
}

export interface EventBook {
  format: number;
  /** The map it was written for, or "" for any. */
  map: string;
  revision: number;
  rules: EventRules;
  announce: EventAnnounce;
  /** Kinds switched off, by id. A kind not named is on. */
  kinds: Record<string, { on: boolean }>;
  /** Each kind's values, by its id and its field's key. A field not given takes its default. */
  tuning: Record<string, Record<string, FieldValue>>;
  schedules: ScheduleDoc[];
}

/** A kind of map event as data: what the book is checked against and what the events page shows. */
export interface KindSheet {
  readonly id: string;
  readonly label: string;
  readonly about: string;
  /** The module that defines it. */
  readonly module: string;
  readonly fields: Fields;
  /** The schedules the kind starts a book with. */
  readonly schedules: readonly ScheduleDoc[];
}

/** The book a world begins with: each kind's starter schedules, every kind on, every field at its default. */
export function starterEventBook(sheets: Iterable<KindSheet> = []): EventBook {
  const schedules: ScheduleDoc[] = [];
  for (const s of sheets) for (const d of s.schedules) if (schedules.length < EVENT_MOST.schedules) schedules.push({ ...d, kind: s.id, firstDelay: [...d.firstDelay], interval: [...d.interval], hours: d.hours ? [...d.hours] : null });
  return { format: EVENT_BOOK_FORMAT, map: "", revision: 0, rules: { minPlayers: 1, maxLive: 2 }, announce: "chat", kinds: {}, tuning: {}, schedules };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** What is wrong with a schedule, each fault at its path under `path`. Its kind is the book's to check. */
export function scheduleFaults(s: unknown, path: string): BookFault[] {
  const out: BookFault[] = [];
  const bad = (p: string, message: string): void => void out.push({ path: `${path}.${p}`, message });
  if (!isObject(s)) return [{ path, message: "a schedule is an object" }];
  const d = s as Partial<ScheduleDoc>;
  const range = (p: string, v: unknown, min: number, max: number): void => {
    if (!(Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && v[0] >= min && v[1] >= v[0] && v[1] <= max)) bad(p, `seconds: [least, most] from ${min} to ${max}`);
  };
  if (typeof d.key !== "string" || !KEY.test(d.key)) bad("key", "a key is 1 to 48 of a to z, 0 to 9 and _ . / -, beginning with a letter or a digit");
  if (typeof d.on !== "boolean") bad("on", "true or false");
  range("firstDelay", d.firstDelay, 0, 7 * 24 * 3600);
  range("interval", d.interval, 60, 7 * 24 * 3600);
  if (!(Number.isInteger(d.maxLive) && (d.maxLive as number) >= 0 && (d.maxLive as number) <= MAPEVENT_MOST)) bad("maxLive", `events: a whole number from 0 to ${MAPEVENT_MOST}`);
  if (!(finite(d.chance) && d.chance >= 0 && d.chance <= 1)) bad("chance", "a chance from 0 to 1");
  if (d.hours !== null && !(Array.isArray(d.hours) && d.hours.length === 2 && d.hours.every((h) => finite(h) && h >= 0 && h < 24))) bad("hours", "null, or [from, to] hours from 0 to 24");
  return out;
}

/** What is wrong with a kind as data, before it is defined: its id, words, fields and starter schedules. */
export function sheetFaults(s: KindSheet): string[] {
  const out: string[] = [];
  if (!KIND_ID.test(s.id)) out.push(`"${s.id}": a kind's id is a letter, then letters, digits and _, 32 at the most`);
  if (typeof s.label !== "string" || s.label === "" || s.label.length > 48) out.push(`${s.id}: a label of 1 to 48 characters`);
  if (typeof s.about !== "string" || s.about.length > 400) out.push(`${s.id}: about it in 400 characters at the most`);
  out.push(...fieldsFaults(s.fields).map((f) => `${s.id}: ${f}`));
  s.schedules.forEach((d, i) => out.push(...scheduleFaults({ ...d, kind: s.id }, `schedules[${i}]`).map((f) => `${s.id}: ${f.path}: ${f.message}`)));
  return out;
}

/**
 * What is wrong with a book, each at its path, against the kinds defined now. At "load" only what makes it no book at
 * all is a fault and the rest is warned of; at "save" a known kind's values must be within their fields too.
 */
export function eventBookFaults(book: unknown, sheets: ReadonlyMap<string, KindSheet>, mode: "load" | "save"): BookFault[] {
  const out: BookFault[] = [];
  const bad = (path: string, message: string): void => void out.push({ path, message });
  const warn = (path: string, message: string): void => void out.push({ path, message, warn: true });
  if (!isObject(book)) return [{ path: "", message: "a book is an object" }];
  const b = book as Partial<EventBook> & Record<string, unknown>;
  if (b.format !== EVENT_BOOK_FORMAT) bad("format", `this build reads format ${EVENT_BOOK_FORMAT}`);
  if (typeof b.map !== "string") bad("map", "the map's id, or an empty string for any map");
  if (!(Number.isInteger(b.revision) && (b.revision as number) >= 0)) bad("revision", "a whole number, not negative");
  if (!isObject(b.rules)) bad("rules", "the rules are an object");
  else {
    const r = b.rules as Partial<EventRules>;
    if (!(Number.isInteger(r.minPlayers) && (r.minPlayers as number) >= 0 && (r.minPlayers as number) <= 255)) bad("rules.minPlayers", "survivors: a whole number from 0 to 255");
    if (!(Number.isInteger(r.maxLive) && (r.maxLive as number) >= 0 && (r.maxLive as number) <= MAPEVENT_MOST)) bad("rules.maxLive", `events: a whole number from 0 to ${MAPEVENT_MOST}`);
  }
  if (b.announce !== "none" && b.announce !== "chat") bad("announce", `"none" or "chat"`);

  if (!isObject(b.kinds)) bad("kinds", "the kinds switched off are an object");
  else {
    if (Object.keys(b.kinds).length > EVENT_MOST.kinds) bad("kinds", `${EVENT_MOST.kinds} at the most`);
    for (const [id, k] of Object.entries(b.kinds)) {
      if (!isObject(k) || typeof k.on !== "boolean") bad(`kinds.${id}`, "{ on: true or false }");
      else if (!sheets.has(id)) warn(`kinds.${id}`, "no module defines this kind now: it is kept");
    }
  }

  if (!isObject(b.tuning)) bad("tuning", "each kind's values are an object");
  else {
    if (Object.keys(b.tuning).length > EVENT_MOST.kinds) bad("tuning", `${EVENT_MOST.kinds} kinds at the most`);
    for (const [id, values] of Object.entries(b.tuning)) {
      const sheet = sheets.get(id);
      if (!isObject(values)) bad(`tuning.${id}`, "a kind's tuning is an object");
      else if (!sheet) warn(`tuning.${id}`, "no module defines this kind now: its values are kept");
      else out.push(...valueFaults(sheet.fields, values, `tuning.${id}`, mode === "load"));
    }
  }

  if (!Array.isArray(b.schedules)) bad("schedules", "a list");
  else {
    if (b.schedules.length > EVENT_MOST.schedules) bad("schedules", `${EVENT_MOST.schedules} at the most`);
    const seen = new Set<string>();
    b.schedules.forEach((s: unknown, i: number) => {
      const p = `schedules[${i}]`;
      out.push(...scheduleFaults(s, p));
      if (!isObject(s)) return;
      const d = s as Partial<ScheduleDoc>;
      if (typeof d.key === "string") {
        if (seen.has(d.key)) bad(`${p}.key`, `"${d.key}" is another schedule's`);
        seen.add(d.key);
      }
      if (typeof d.kind !== "string" || !KIND_ID.test(d.kind)) bad(`${p}.kind`, "a kind's id");
      else if (!sheets.has(d.kind)) warn(`${p}.kind`, `no module defines "${d.kind}" now: the schedule is kept and calls nothing`);
    });
  }
  return out;
}

/** Whether `hour` (0 to 24) is within a schedule's hours, which wrap past midnight where `from` is the later. */
export function inHours(hours: readonly [number, number] | null, hour: number): boolean {
  if (!hours) return true;
  const [from, to] = hours;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Whether a kind is on in a book: one not named is. */
export function kindOn(book: EventBook, kind: string): boolean {
  return book.kinds[kind]?.on !== false;
}
