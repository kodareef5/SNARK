// What the events page shows (planning/workstreams/map-events.md, "The events page"): its views and their place in the
// address, a craft's path as lines to draw with its low passes apart, an event and its parts in words, a schedule's
// pace and its last look, and each kind's tuning in groups. Nothing here touches a page: client/admin/events.ts draws
// what these say. Nothing here knows a kind: every kind is drawn from its sheet and its parts.

import { inHours, type EventBook, type KindSheet, type ScheduleDoc } from "../../../shared/mapevent/book.ts";
import { buildTrack, newCraftPose, trackPose, type PathPoint } from "../../../shared/sim/craft.ts";
import { editKindOf, type EditKind, type Path } from "./events-edit.ts";

export const VIEWS = [["library", "Library"], ["schedules", "Schedules"], ["map", "Map"], ["tuning", "Tuning"], ["live", "Live and log"], ["revisions", "Revisions"]] as const;
export type View = (typeof VIEWS)[number][0];

/** Where the page is, as its address has it: `#map/ufo/12345`, `#tuning/ufo`, `#live`. */
export interface Place {
  view: View | null;
  kind: string;
  seed: number | null;
}

export function fromHash(hash: string): Place {
  const [view, kind, seed] = decodeURIComponent(hash.replace(/^#/, "")).split("/");
  const known = VIEWS.some(([key]) => key === view) ? (view as View) : null;
  return { view: known, kind: kind && /^[a-z][a-z0-9_]{0,31}$/.test(kind) ? kind : "", seed: known === "map" ? seedOf(seed ?? "") : null };
}

export function toHash(p: { view: View; kind: string; seed: number | null }): string {
  if ((p.view === "map" || p.view === "tuning") && p.kind !== "") return `#${p.view}/${p.kind}${p.view === "map" && p.seed !== null ? `/${p.seed}` : ""}`;
  return `#${p.view}`;
}

/** A seed as typed: a whole number a 32-bit draw is made from, or null. */
export function seedOf(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= 0xffffffff ? n : null;
}

/** A run of a path's line, all high or all low: places to draw through, in order. */
export interface PathRun {
  low: boolean;
  line: [number, number][];
}

/**
 * A path as runs of lines to draw, a sample every `step` seconds and at its end, split where its beam comes on or goes
 * off (at half its ease), with the sample at the change in both runs so the line is unbroken.
 */
export function pathRuns(points: readonly PathPoint[], step = 2): PathRun[] {
  if (points.length < 2) return [];
  const track = buildTrack(points);
  if (!Number.isFinite(track.seconds)) return [];
  const pose = newCraftPose();
  const runs: PathRun[] = [];
  let run: PathRun | null = null;
  for (let t = 0; ; t = Math.min(track.seconds, t + step)) {
    trackPose(track, t, pose);
    const low = pose.low >= 0.5;
    const at: [number, number] = [pose.x, pose.z];
    if (!run || run.low !== low) {
      if (run) run.line.push(at);
      run = { low, line: [at] };
      runs.push(run);
    } else run.line.push(at);
    if (t >= track.seconds) break;
  }
  return runs;
}

/** Seconds as the page says them. */
export function span(s: number): string {
  const n = Math.max(0, Math.round(s));
  return n < 90 ? `${n} s` : n < 5400 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(1)} h`;
}

/** A path in a line: how long it flies, its points and its low passes. */
export function pathWords(points: readonly PathPoint[], seconds: number): string {
  let passes = 0;
  for (let i = 0; i < points.length; i++) if (points[i]!.low && !points[i - 1]?.low) passes++;
  return `${span(seconds)} across the map, ${points.length} points, ${passes === 1 ? "1 low pass" : `${passes} low passes`}`;
}

/** A part as live.json tells it (server/admin/event-routes.ts LivePart), as far as its words need. */
export interface PartWords {
  type: string;
  id: number;
  state?: string;
  x: number;
  y?: number;
  z: number;
  health?: number;
  most?: number;
  shield?: string;
  stacks?: number;
}

const SHIELD: Readonly<Record<string, string>> = { closed: "its shield shut", open: "its shield open", broken: "its shield broken", none: "no shield" };

/** A part in words: "craft 1 flying, 80% of its health, its shield shut, at 2100, 3300, 900 up". */
export function partWords(p: PartWords): string {
  if (p.type === "crate") return `crate ${p.id} at ${Math.round(p.x)}, ${Math.round(p.z)}, ${p.stacks ?? 0} stacks`;
  if (p.type === "site") return `site ${p.id} at ${Math.round(p.x)}, ${Math.round(p.z)}`;
  const where = p.state === "flying" || p.state === "falling" ? ` at ${Math.round(p.x)}, ${Math.round(p.z)}, ${Math.round(p.y ?? 0)} up` : p.state === "rest" ? ` at rest at ${Math.round(p.x)}, ${Math.round(p.z)}` : "";
  const health = p.state === "flying" && p.most ? `, ${Math.round((100 * (p.health ?? 0)) / p.most)}% of its health, ${SHIELD[p.shield ?? "none"] ?? p.shield}` : "";
  return `craft ${p.id} ${p.state ?? ""}${health}${where}`;
}

/** An event in words: "coming in 40 s" or "live; craft 1 flying…". */
export function eventWords(e: { state: string; left: number; parts: readonly PartWords[] }): string {
  if (e.state === "notice") return `coming in ${span(e.left)}`;
  if (e.state === "ended") return "ended";
  return e.parts.length === 0 ? "live" : e.parts.map(partWords).join("; ");
}

/** A schedule's hours in words. */
export function hoursWords(hours: readonly [number, number] | null): string {
  if (!hours) return "any hour";
  const clock = (h: number): string => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  return `${clock(hours[0])} to ${clock(hours[1])}${hours[0] > hours[1] ? ", past midnight" : ""}`;
}

/** The share of the day a schedule's hours are, from 0 to 1, to the hundredth of an hour. */
export function hoursShare(hours: readonly [number, number] | null): number {
  if (!hours) return 1;
  let n = 0;
  for (let k = 0; k < 2400; k++) if (inHours(hours, k / 100)) n++;
  return n / 2400;
}

/** About how many events a schedule calls a day with survivors in the world and room on the map. */
export function perDay(s: ScheduleDoc): number {
  if (!s.on || s.maxLive === 0) return 0;
  const mean = (s.interval[0] + s.interval[1]) / 2;
  return mean > 0 ? ((24 * 3600) / mean) * s.chance * hoursShare(s.hours) : 0;
}

/** A schedule as live.json tells it. */
export interface ScheduleLive {
  key: string;
  on: boolean;
  looks: number;
  why: string;
  looked: number;
  now: string;
}

/** A schedule's clock in words: when it looks next, why its last look called nothing, and what would stop it now. */
export function lookWords(s: ScheduleLive | undefined): { next: string; last: string; now: string } {
  if (!s || !s.on) return { next: "off", last: "", now: "" };
  return {
    next: `looks in ${span(s.looks)}`,
    last: s.looked === 0 ? "has not looked yet" : s.why === "" ? "called one when it last looked" : `passed: ${s.why}`,
    now: s.now === "" ? "would call one now, at its chance" : `would pass now: ${s.now}`,
  };
}

/** What the library says of a kind: on or off, its schedules, how many are on, what they call a day, and what is live. */
export function kindStatus(book: EventBook, kind: string, live: number): { on: boolean; schedules: number; scheduled: number; perDay: number; live: number } {
  const mine = book.schedules.filter((s) => s.kind === kind);
  const on = book.kinds[kind]?.on !== false;
  return { on, schedules: mine.length, scheduled: mine.filter((s) => s.on).length, perDay: on ? mine.reduce((n, s) => n + perDay(s), 0) : 0, live };
}

/** A field of a kind's tuning as the page shows it: its place in the book, how it is typed, and its words. */
export interface TuningField {
  key: string;
  path: Path;
  kind: EditKind;
  label: string;
  help: string;
  unit: string;
  options: readonly string[];
  bounds: string;
}

/** A kind's fields in the order it declares them, gathered in its groups in the order each group first comes. */
export function tuningGroups(sheet: KindSheet): { group: string; fields: TuningField[] }[] {
  const out: { group: string; fields: TuningField[] }[] = [];
  for (const [key, f] of Object.entries(sheet.fields)) {
    let g = out.find((x) => x.group === f.group);
    if (!g) out.push((g = { group: f.group, fields: [] }));
    const bounds = "min" in f ? `${f.min} to ${f.max}` : f.kind === "keys" ? `1 to ${f.most}` : f.kind === "text" ? `${f.most} characters at the most` : "";
    g.fields.push({ key, path: ["tuning", sheet.id, key], kind: editKindOf(f), label: f.label, help: f.help, unit: f.unit ?? (f.kind === "share" ? "%" : ""), options: f.kind === "choice" ? f.options : [], bounds });
  }
  return out;
}
