import { adminContext } from "./shell.ts";
// The events page (planning/workstreams/map-events.md, "The events page"): it reads a world's event book, the kinds its
// modules define and what is live (server/admin/event-routes.ts), edits a draft of the book, and calls, hurries, brings
// down and ends events through the console's own lines. What it shows is decided in client/core/admin/events.ts; this
// file fetches, draws and listens. No kind is named here: each is drawn from the sheet the server sends.

import { esc } from "../core/admin/format.ts";
import { VIEWS, eventWords, fromHash, hoursWords, kindStatus, lookWords, perDay, seedOf, span, toHash, tuningGroups, type ScheduleLive, type View } from "../core/admin/events.ts";
import { addSchedule, addStarter, changes, differs, parseEventBook, read, removeSchedule, resetTuning, setAt, setKindOn, setTuning, show, tuningValue, type EditKind, type Path } from "../core/admin/events-edit.ts";
import { faultsAt, pathText, savedWords } from "../core/drops/edit.ts";
import { eventBookFaults, type EventBook, type KindSheet } from "../../shared/mapevent/book.ts";
import type { BookFault } from "../../shared/supply/book.ts";
import { mapDraw, mapHtml, readPreview, readTerrain } from "./events-map.ts";

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** A kind as book.json tells it: its sheet, whether its handlers threw it off, its time, and its notice now. */
export type KindWire = KindSheet & { off: boolean; calls: number; ms: number; worst: number; notice: number };

/** What book.json carries. */
export interface BookWire {
  revision: number;
  starter: boolean;
  kept: boolean;
  map: string;
  book: EventBook;
  first: EventBook;
  kinds: KindWire[];
  missing: string[];
  most: number;
}

/** A part as live.json tells it. */
export interface PartWire {
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
  points?: { x: number; y: number; z: number; speed: number; low: boolean }[];
  rest?: { x: number; y: number; z: number } | null;
}

export interface EventWire {
  id: number;
  kind: string;
  state: string;
  schedule: string;
  source: string;
  seed: number;
  left: number;
  parts: PartWire[];
}

/** What live.json carries. */
export interface LiveWire {
  tick: number;
  rate: number;
  revision: number;
  size: [number, number];
  hour: number;
  events: EventWire[];
  survivors: { x: number; z: number }[];
  schedules: (ScheduleLive & { kind: string })[];
  live: number;
  calls: number;
  downs: number;
  mended: number;
  acts: { at: number; tick: number; what: string }[];
  log: { tick: number; what: string }[];
}

/** What preview.json carries: what an event of a kind called now with a seed would make. */
export interface PreviewWire {
  kind: string;
  seed: number;
  notice: number;
  crafts: { id: number; name: string; points: { x: number; y: number; z: number; speed: number; low: boolean }[]; seconds: number }[];
  sites: { id: number; x: number; z: number }[];
  crates: { id: number; x: number; z: number; name: string }[];
  notices: string[];
  near: { x: number; z: number }[];
}

interface RevisionWire {
  revision: number;
  at: number;
  by: string;
  note: string;
}

/** The page's state. */
export const S = {
  wire: null as BookWire | null,
  sheets: new Map<string, KindSheet>(),
  draft: null as EventBook | null,
  faults: [] as BookFault[],
  conflict: -1,
  view: "library" as View,
  /** The kind the map and the tuning are of. */
  kind: "",
  live: null as LiveWire | null,
  terrain: null as HTMLCanvasElement | null,
  zoom: 1,
  seed: null as number | null,
  preview: null as PreviewWire | null,
  revisions: null as RevisionWire[] | null,
  compared: null as { revision: number | string; lines: string[] } | null,
};

export const say = (text: string, cls = "dim"): void => {
  $("said").className = cls;
  $("said").textContent = text;
};

export async function ask<T>(path: string): Promise<T> {
  const r = await fetch((await adminContext()).api(`events/${path}`), { cache: "no-store" });
  const answer = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(answer.error ?? `${path} answered ${r.status}`);
  return answer;
}

async function post(what: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> }> {
  const r = await fetch((await adminContext()).api(`events/${what}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

const faultWords = (path: Path): string => faultsAt(S.faults, path).map((f) => f.message).join("; ");

/** A field of the draft: its place, what it holds, and its faults, which redden it. `value` is shown in place of the draft's. */
function field(path: Path, kind: EditKind, width = 64, value?: unknown, options: readonly string[] = []): string {
  let at: unknown = S.draft;
  for (const key of path) at = (at as Record<string | number, unknown> | undefined)?.[key];
  const now = value === undefined ? at : value;
  const faults = faultWords(path);
  const common = `data-path="${esc(JSON.stringify(path))}" data-kind="${kind}" title="${esc(faults || pathText(path))}"${faults ? ' class="wrong"' : ""}`;
  if (kind === "flag") return `<input type="checkbox" ${common}${now === true ? " checked" : ""}>`;
  if (kind === "choice") return `<select ${common}>${options.map((o) => `<option${o === now ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  return `<input ${common} value="${esc(show(kind, now))}" style="width:${width}px">`;
}

const kindName = (id: string): string => S.wire!.kinds.find((k) => k.id === id)?.label ?? id;
const kindChoice = (id: string, at: string): string => {
  const ids = [...new Set([...S.wire!.kinds.map((k) => k.id), ...(id === "" ? [] : [id])])];
  return `<select id="${at}">${ids.map((k) => `<option value="${esc(k)}"${k === id ? " selected" : ""}>${esc(kindName(k))}</option>`).join("")}</select>`;
};
const reading = (title: string): string => `<section class="glass"><h2>${title}</h2><p class="dim">reading…</p></section>`;

function libraryHtml(): string {
  const w = S.wire!, live = S.live;
  if (w.kinds.length === 0 && w.missing.length === 0) return '<section class="glass"><h2>Library</h2><p class="dim">No module of this server defines a kind of map event. The game\'s own are in modules/ and load unless ModulesOff leaves them out.</p></section>';
  const cards = w.kinds.map((k) => {
    const st = kindStatus(S.draft!, k.id, live ? live.events.filter((e) => e.kind === k.id && e.state !== "ended").length : 0);
    const chips = [
      `<span class="chip" title="The module that defines it.">module ${esc(k.module)}</span>`,
      k.off ? '<span class="chip bad" title="Its handlers threw eight times running: nothing calls it until the server starts again.">off: its handlers threw</span>' : "",
      st.scheduled === 0 ? '<span class="chip warn">no schedule on</span>' : `<span class="chip">${st.scheduled} of ${st.schedules} schedules on</span>`,
    ].join(" ");
    const missing = k.schedules.some((s) => !S.draft!.schedules.some((b) => b.kind === k.id && b.key === s.key));
    return `<div class="slot"><div class="row"><h3>${esc(k.label)}</h3><span class="sub">${esc(k.id)}</span>${chips}<span class="grow"></span><label title="Off, no schedule calls it and modules may not; the console still may.">on ${field(["kinds", k.id, "on"], "flag", 0, st.on)}</label></div>
      <p class="about">${esc(k.about)}</p>
      <div class="row"><span class="dim">${st.on ? `about ${st.perDay.toFixed(1)} a day by its schedules` : "switched off"} · notice ${span(k.notice)}${live ? ` · ${st.live} live now` : ""} · its handlers ran ${k.calls} times, ${k.ms.toFixed(1)} ms in all, ${k.worst.toFixed(2)} ms at the most</span>
      <span class="grow"></span>${missing ? `<button data-do="starter-rows" data-kind="${esc(k.id)}" title="Its own schedules, as a draft.">Add its starter schedules</button>` : ""}<button data-go="tuning" data-kind="${esc(k.id)}">Tuning</button><button data-go="map" data-kind="${esc(k.id)}">Map</button></div></div>`;
  });
  const gone = w.missing.length === 0 ? "" : `<section class="glass"><h2>Named here, defined by no module</h2><p class="dim">The book or the world names ${w.missing.map((m) => `<b>${esc(m)}</b>`).join(", ")}, and no module loaded now defines it. Its rows are kept as they are; its schedules call nothing, and an event of it already in the world runs out on what it was saved with.</p></section>`;
  return `<section class="glass"><div class="row"><h2>Library</h2><span class="dim">each kind is a module's code; whether it runs, how often it comes and how it behaves are this book's</span></div><div class="slots">${cards.join("")}</div></section>${gone}`;
}

function schedulesHtml(): string {
  const d = S.draft!, r = ["rules"] as const;
  const looks = new Map((S.live?.schedules ?? []).map((s) => [s.key, s]));
  const kinds = [...new Set([...S.wire!.kinds.map((k) => k.id), ...d.schedules.map((s) => s.kind)])];
  const rows = d.schedules.map((s, k) => {
    const at = ["schedules", k] as const;
    const said = lookWords(looks.get(s.key));
    const faults = faultWords(at);
    return `<div class="slot"><div class="row"><h3>${field([...at, "key"], "text", 150)}</h3>${field([...at, "kind"], "choice", 0, undefined, kinds)}<label>on ${field([...at, "on"], "flag")}</label>
        <span class="dim">about ${perDay(s).toFixed(1)} a day</span><span class="grow"></span><button data-do="unschedule" data-k="${k}" class="risk">Take it out</button></div>
      <div class="line"><label title="Seconds from the world's start or the book's saving to its first look.">first look after ${field([...at, "firstDelay"], "pair", 110)} s</label><label title="Seconds between its looks.">then every ${field([...at, "interval"], "pair", 110)} s</label>
        <label title="Its own events live at once at the most.">most live ${field([...at, "maxLive"], "whole", 44)}</label><label title="Hours of the world's day it calls in: from to, past midnight where from is the later. Empty for any hour.">hours ${field([...at, "hours"], "hours", 70)}</label><span class="sub">${esc(hoursWords(s.hours))}</span>
        <label title="Its chance at each look of calling one.">chance % ${field([...at, "chance"], "share", 50)}</label></div>
      <div class="line"><span>${esc(said.next)}</span><span class="${said.last.startsWith("passed") ? "warn" : "dim"}">${esc(said.last)}</span><span class="dim">${esc(said.now)}</span></div>${faults ? `<div class="fault">${esc(faults)}</div>` : ""}</div>`;
  });
  return `<section class="glass"><div class="row"><h2>The book's rules</h2><span class="dim">for every schedule</span></div>
    <div class="line"><label title="Survivors in the world at the least for a schedule to call an event.">survivors needed ${field([...r, "minPlayers"], "whole", 44)}</label><label title="Events live on the map at once at the most, whatever called them; ${S.wire!.most} at the most.">most live on the map ${field([...r, "maxLive"], "whole", 44)}</label>
      <label title="chat: a line to everyone as an event is called and as its kind says; none: seen and heard only.">told by ${field(["announce"], "choice", 0, undefined, ["chat", "none"])}</label></div></section>
    <section class="glass"><div class="row"><h2>Schedules</h2><span class="dim">each looks on a clock of its own and calls an event of its kind unless the world, the map, the kind or its hours say no${S.live ? ` · the world's hour is ${S.live.hour.toFixed(1)}` : ""}</span><span class="grow"></span>${kindChoice(S.kind, "newKind")}<button data-do="schedule">Add a schedule</button></div>
    ${d.schedules.length === 0 ? '<p class="dim">No schedules: events come only when called.</p>' : `<div class="slots">${rows.join("")}</div>`}</section>`;
}

function tuningHtml(): string {
  const sheet = S.sheets.get(S.kind);
  if (!sheet) return '<section class="glass"><h2>Tuning</h2><p class="dim">Choose a kind.</p></section>';
  const own = S.draft!.tuning[sheet.id] ?? {};
  const groups = tuningGroups(sheet).map((g) => {
    const lines = g.fields.map((t) => {
      const faults = faultWords(t.path);
      const set = t.key in own;
      const width = t.kind === "keys" ? 260 : t.kind === "pair" || t.kind === "wholePair" ? 110 : t.kind === "text" ? 160 : 80;
      return `<div class="line"><label title="${esc(t.help)}" style="min-width:190px">${esc(t.label)}</label>${field(t.path, t.kind, width, tuningValue(S.draft!, sheet, t.key), t.options)}<span class="sub">${esc(t.unit)}</span>
        <span class="dim">${esc(t.help)}</span><span class="sub">${set ? "changed" : "its default"}${t.bounds ? ` · ${esc(t.bounds)}` : ""}</span>${faults ? `<span class="fault">${esc(faults)}</span>` : ""}</div>`;
    });
    return `<div class="slot"><h3>${esc(g.group)}</h3>${lines.join("")}</div>`;
  });
  return `<section class="glass"><div class="row"><h2>Tuning</h2>${kindChoice(S.kind, "tuneKind")}<span class="dim">an event called after a save is tuned by it; one already called keeps what it was called with</span><span class="grow"></span>
    <button data-do="defaults" class="risk" title="Every field of this kind to its default, as a draft.">Back to its defaults</button></div><div class="slots">${groups.join("")}</div></section>`;
}

const ago = (live: LiveWire, tick: number): string => `${span((live.tick - tick) / live.rate)} ago`;

function liveHtml(): string {
  const live = S.live;
  if (!live) return reading("Live and log");
  const rows = live.events.map((e) => {
    const flying = e.parts.some((p) => p.type === "craft" && p.state === "flying");
    const acts = e.state === "ended" ? "" : `${e.state === "notice" ? `<button data-do="hurry" data-id="${e.id}" title="It comes now.">Hurry</button>` : ""}${flying ? `<button data-do="down" data-id="${e.id}" title="Its craft brought down where they are.">Down</button>` : ""}<button data-do="cancel" data-id="${e.id}" class="risk" title="Ended, its crates with it.">End</button>`;
    return `<tr><td>${e.id}</td><td>${esc(kindName(e.kind))}</td><td>${esc(eventWords(e))}</td><td>${esc(e.schedule === "" ? e.source : e.schedule)}</td><td class="n">${e.seed}</td><td>${acts}</td></tr>`;
  });
  const lines = [...live.log.map((x) => ({ tick: x.tick, what: x.what, mine: false })).reverse(), ...live.acts.map((x) => ({ tick: x.tick, what: x.what, mine: true })).reverse()].sort((a, b) => b.tick - a.tick).slice(0, 120);
  const log = lines.length === 0 ? '<p class="dim">Nothing yet.</p>' : `<div class="scroll"><table>${lines.map((x) => `<tr><td class="dim" style="white-space:nowrap">${ago(live, x.tick)}</td><td>${x.mine ? '<span class="chip">admin</span> ' : ""}${esc(x.what)}</td></tr>`).join("")}</table></div>`;
  const schedules = live.schedules.map((s) => {
    const w = lookWords(s);
    return `<tr><td>${esc(s.key)}</td><td>${esc(kindName(s.kind))}</td><td>${esc(w.next)}</td><td class="n">${s.looked}</td><td class="${w.last.startsWith("passed") ? "warn" : "dim"}">${esc(w.last)}</td><td class="dim">${esc(w.now)}</td></tr>`;
  });
  const notice = S.wire!.kinds.find((k) => k.id === S.kind)?.notice;
  const call = S.wire!.kinds.length === 0 ? "" : `${kindChoice(S.kind, "callKind")}<label title="Seconds to its coming; its kind's notice where empty.">coming in <input id="callSeconds" style="width:56px" placeholder="${notice ?? ""}"> s</label><label title="The seed it is made from; the world's own draw where empty.">seed <input id="callSeed" style="width:110px"></label><button data-do="call" class="go">Call one</button>`;
  return `<section class="glass"><div class="row"><h2>Live</h2><span class="dim">${live.live} live; schedules call none past ${S.draft!.rules.maxLive} · ${live.calls} called and ${live.downs} craft brought down since the start${live.mended > 0 ? ` · <span class="warn">${live.mended} put right at the last start</span>` : ""}</span><span class="grow"></span>${call}<button data-do="hurry" data-id="all">Hurry all</button><button data-do="cancel" data-id="all" class="risk">End all</button><button data-do="relive">Read again</button></div>
    ${rows.length === 0 ? '<p class="dim">No events are live.</p>' : `<div class="scroll"><table><tr><th>Event</th><th>Kind</th><th>What</th><th>From</th><th class="n">Seed</th><th></th></tr>${rows.join("")}</table></div>`}</section>
    <section class="glass"><div class="row"><h2>Schedules' clocks</h2><span class="dim">when each looks next, how often it has looked, and why it last called none</span></div>${schedules.length === 0 ? '<p class="dim">No schedules.</p>' : `<div class="scroll"><table><tr><th>Schedule</th><th>Kind</th><th>Clock</th><th class="n">Looks</th><th>Last time</th><th>Now</th></tr>${schedules.join("")}</table></div>`}</section>
    <section class="glass"><div class="row"><h2>Log</h2><span class="dim">what events did, and what was done from this page</span></div>${log}</section>`;
}

function revisionsHtml(): string {
  if (S.revisions === null) return reading("The book's saves");
  const rows = [...S.revisions].reverse().map((r) => `<tr><td class="n">${r.revision}</td><td>${esc(new Date(r.at * 1000).toLocaleString())}</td><td>${esc(r.by)}</td><td>${esc(r.note)}</td>
      <td><button data-do="compare" data-id="${r.revision}" title="What differs between it and the draft.">Compare</button>${r.revision === S.wire!.revision ? "" : `<button data-do="restore" data-id="${r.revision}" class="risk" title="It comes back as the next revision.">Restore</button>`}</td></tr>`);
  const saves = rows.length === 0 ? '<p class="dim">The book has not been saved: it is the starter.</p>' : `<div class="scroll"><table><tr><th class="n">Revision</th><th>When</th><th>By</th><th>For</th><th></th></tr>${rows.join("")}</table></div>`;
  const c = S.compared;
  const compared = c ? `<div class="sub" style="margin-top:6px"><b>From ${typeof c.revision === "number" ? `revision ${c.revision}` : c.revision} to the draft:</b><br>${c.lines.length === 0 ? "no difference" : c.lines.map(esc).join("<br>")}</div>` : "";
  return `<section class="glass"><div class="row"><h2>The book's saves</h2><span class="dim">the last fifty, each whole</span><span class="grow"></span><button data-do="compare" data-id="starter" title="What differs between the starter book and the draft.">Compare the starter</button></div>${saves}${compared}</section>`;
}

function head(): void {
  const w = S.wire!;
  $("world").textContent = `${w.map === "" ? "this world" : w.map} · revision ${w.revision}${w.starter ? ", the starter book" : ""}`;
  const chips: string[] = [];
  if (!w.kept) chips.push('<span class="chip warn" title="This world has no save: an edit lasts until it stops.">not kept</span>');
  if (!w.book.schedules.some((s) => s.on)) chips.push('<span class="chip warn" title="No schedule is on: an event comes only when called.">no schedule on</span>');
  if (w.missing.length > 0) chips.push(`<span class="chip warn" title="Named in the book or the world, defined by no module now.">${w.missing.length} kinds not loaded</span>`);
  if (S.live && S.live.live > 0) chips.push(`<span class="chip">${S.live.live} live</span>`);
  $("chips").innerHTML = chips.join("");
  $("tabs").innerHTML = VIEWS.map(([key, name]) => `<button data-view="${key}" class="${S.view === key ? "on" : ""}">${name}</button>`).join("");
}

/** What stands between the draft and the book in force: its changes, its faults, and the ways to save or leave them. */
function barHtml(): string {
  const w = S.wire!, d = S.draft!;
  const changed = differs(w.book, d);
  const lines = changed ? changes(w.book, d, 12) : [];
  const faults = S.faults.length === 0 ? "" : `<div class="bad">${S.faults.slice(0, 8).map((f) => `${esc(f.path)}: ${esc(f.message)}`).join("<br>")}${S.faults.length > 8 ? `<br>and ${S.faults.length - 8} more` : ""}</div>`;
  const conflict = S.conflict < 0 ? "" : `<div class="warn">Another editor saved revision ${S.conflict} since this page read the book. <button data-do="theirs">Read theirs, and lose these changes</button> <button data-do="over" class="risk">Save over revision ${S.conflict}</button></div>`;
  const tools = `<button data-do="export" title="The draft as a file.">Export JSON</button><button data-do="import" title="A book from a file becomes the draft; nothing is saved until Save.">Import JSON</button><button data-do="starter" class="risk" title="The starter book again, as the next revision."${changed ? " disabled" : ""}>The starter again</button>`;
  if (!changed) return `<section class="glass"><div class="row"><span class="dim">The book in force, revision ${w.revision}. A change here is a draft until it is saved.</span><span class="grow"></span>${tools}</div>${conflict}</section>`;
  return `<section class="glass"><div class="row"><h2>Not saved</h2><span class="dim">${lines.length} ${lines.length === 1 ? "change" : "changes"} to revision ${w.revision}</span><span class="grow"></span>
    <input id="note" placeholder="what this save is for" maxlength="200" style="width:320px"><button data-do="save" class="go"${S.faults.length ? " disabled" : ""}>Save</button><button data-do="discard">Discard</button>${tools}</div>
    <div class="sub" style="margin-top:6px">${lines.map(esc).join("<br>")}</div>${faults}${conflict}</section>`;
}

async function readLive(): Promise<void> {
  S.live = await ask<LiveWire>("live.json");
  await readTerrain();
}

/** What each view needs read before it is drawn, read the first time it is looked at. */
function needs(): Promise<unknown> | null {
  if (S.view !== "revisions" && !S.live) return readLive();
  if (S.view === "map" && S.seed !== null && (S.preview?.seed !== S.seed || S.preview?.kind !== S.kind)) return readPreview();
  if (S.view === "revisions" && S.revisions === null) return ask<RevisionWire[]>("revisions.json").then((r) => void (S.revisions = r));
  return null;
}

const KEPT = ["note", "callSeconds", "callSeed", "seed"];

export function draw(): void {
  if (!S.wire || !S.draft) return;
  const hash = toHash(S);
  if (location.hash !== hash) history.replaceState(null, "", hash);
  head();
  // What is typed in the note and the call's fields outlives a redraw.
  const kept = KEPT.map((id) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? null);
  const view: Record<View, () => string> = { library: libraryHtml, schedules: schedulesHtml, map: mapHtml, tuning: tuningHtml, live: liveHtml, revisions: revisionsHtml };
  $("main").innerHTML = barHtml() + view[S.view]();
  KEPT.forEach((id, k) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input && kept[k] !== null && kept[k] !== "") input.value = kept[k]!;
  });
  if (S.view === "map") mapDraw();
  const more = needs();
  if (more) void more.then(draw, (err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
}

/** The draft changed: it is checked, and drawn again. */
function changed(): void {
  S.faults = eventBookFaults(S.draft!, S.sheets, "save").filter((f) => !f.warn);
  draw();
}

/** Saves the draft over `revision`, and reads the book in force again, or says why it was not saved. */
async function save(what: "book" | "reset", revision: number): Promise<void> {
  const note = (document.getElementById("note") as HTMLInputElement | null)?.value ?? "";
  const { status, answer } = await post(what, { revision, book: S.draft, note });
  if (status === 200) {
    S.conflict = -1;
    const words = savedWords(`saved as revision ${String(answer.revision)}`, answer);
    await start(words.text, words.warn ? "warn" : "");
  } else if (status === 409) {
    S.conflict = Number(answer.revision);
    say("not saved: another editor saved first", "warn");
    draw();
  } else if (status === 422) {
    S.faults = (answer.faults as BookFault[] | undefined) ?? [];
    say("not saved: the book has faults", "bad");
    draw();
  } else say(`not saved: ${String(answer.error ?? status)}`, "bad");
}

/** An act on the world, done now by the book in force: none of it is the draft's. What the console said is said. */
async function world(what: string, body: Record<string, unknown>): Promise<void> {
  const sent = await post(what, body);
  say(String(sent.answer.said ?? sent.answer.error ?? "").split("\n")[0]!, sent.status !== 200 ? "warn" : "dim");
  await readLive();
  draw();
}

/** A button of the save bar, of a view or of the map. */
async function act(at: HTMLElement): Promise<void> {
  const d = S.draft!, what = at.dataset.do!, id = at.dataset.id === "all" ? "all" : Number(at.dataset.id);
  if (what === "schedule") say(`${addSchedule(d, ($<HTMLSelectElement>("newKind")?.value ?? S.kind) || "event")} added, off: not saved yet`);
  else if (what === "unschedule") removeSchedule(d, Number(at.dataset.k));
  else if (what === "starter-rows") {
    const sheet = S.sheets.get(at.dataset.kind ?? "");
    if (sheet) say(`${addStarter(d, sheet)} of ${sheet.label}'s schedules added: not saved yet`);
  } else if (what === "defaults") resetTuning(d, S.kind);
  else if (what === "discard") [S.draft, S.conflict] = [structuredClone(S.wire!.book), -1];
  else if (what === "save") return save("book", S.wire!.revision);
  else if (what === "over") return save("book", S.conflict);
  else if (what === "starter") return confirm("Put the starter book back, as the next revision?") ? save("reset", S.wire!.revision) : undefined;
  else if (what === "theirs") return start("read again");
  else if (what === "export") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${JSON.stringify(d, null, 1)}\n`], { type: "application/json" }));
    a.download = `events-${S.wire!.map.replace(/[^a-z0-9]+/gi, "-") || "world"}-r${S.wire!.revision}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  } else if (what === "import") return $<HTMLInputElement>("file").click();
  else if (what === "compare") {
    const old = at.dataset.id === "starter" ? { revision: "the starter", book: S.wire!.first } : await ask<{ revision: number; book: EventBook }>(`revision.json?n=${at.dataset.id}`);
    S.compared = { revision: old.revision, lines: changes(old.book, d, 60) };
    return draw();
  } else if (what === "restore") {
    if (!confirm(`Bring revision ${at.dataset.id} back, as the next revision?`)) return;
    const got = await post("restore", { revision: S.wire!.revision, to: Number(at.dataset.id) });
    if (got.status !== 200) return say(`not restored: ${String(got.answer.error ?? got.status)}`, "warn");
    const words = savedWords(`revision ${at.dataset.id} is revision ${String(got.answer.revision)} now`, got.answer);
    return start(words.text, words.warn ? "warn" : "");
  } else if (what === "preview" || what === "newseed") {
    const seed = what === "newseed" ? crypto.getRandomValues(new Uint32Array(1))[0]! : seedOf($<HTMLInputElement>("seed").value);
    if (seed === null) return say("a seed is a whole number from 0 to 4294967295", "warn");
    S.seed = seed;
    await readPreview();
    return draw();
  } else if (what === "callseed") return world("call", { kind: S.preview!.kind, seed: S.preview!.seed });
  else if (what === "call") {
    const [seconds, seed] = [$<HTMLInputElement>("callSeconds").value.trim(), $<HTMLInputElement>("callSeed").value.trim()];
    if ((seconds !== "" && !/^\d+$/.test(seconds)) || (seed !== "" && seedOf(seed) === null)) return say("seconds and a seed are whole numbers", "warn");
    return world("call", { kind: $<HTMLSelectElement>("callKind").value, ...(seconds === "" ? {} : { seconds: Number(seconds) }), ...(seed === "" ? {} : { seed: Number(seed) }) });
  } else if (what === "hurry" || what === "down" || what === "cancel") return world(what, { id });
  else if (what === "relive") {
    await readLive();
    return draw();
  }
  changed();
}

document.addEventListener("click", (e) => {
  const at = (e.target as HTMLElement).closest<HTMLElement>("[data-view],[data-do],[data-go]");
  if (!at) return;
  if (at.dataset.do) return void act(at).catch((err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
  if (at.dataset.go) [S.view, S.kind] = [at.dataset.go as View, at.dataset.kind ?? S.kind];
  else S.view = at.dataset.view as View;
  draw();
});
document.addEventListener("change", (e) => {
  const at = e.target as HTMLInputElement;
  if (at.id === "file" && at.files?.[0]) {
    // A book from a file becomes the draft, to be looked at and then saved or discarded.
    void at.files[0].text().then((text) => {
      const made = parseEventBook(text);
      if ("error" in made) return say(`not read: ${made.error}`, "bad");
      [made.book.revision, made.book.map] = [S.wire!.revision, S.wire!.book.map];
      S.draft = made.book;
      say("read from the file: not saved yet");
      changed();
    });
    at.value = "";
  } else if (at.id === "mapZoom") {
    S.zoom = Number(at.value) || 1;
    draw();
  } else if (at.id === "tuneKind" || at.id === "mapKind" || at.id === "callKind" || at.id === "newKind") {
    S.kind = at.value;
    if (at.id === "mapKind") S.preview = null;
    draw();
  } else if (at.dataset.path) {
    const path = JSON.parse(at.dataset.path) as Path;
    const got = read(at.dataset.kind as EditKind, at.type === "checkbox" ? String(at.checked) : at.value);
    if (!got.ok) {
      at.classList.add("wrong");
      return say("that is not what this field takes", "warn");
    }
    // A kind's switch and a kind's tuning keep the book to what differs from its defaults.
    if (path[0] === "kinds") setKindOn(S.draft!, String(path[1]), got.value === true);
    else if (path[0] === "tuning" && S.sheets.has(String(path[1]))) setTuning(S.draft!, S.sheets.get(String(path[1]))!, String(path[2]), got.value);
    else setAt(S.draft!, path, got.value);
    say("");
    changed();
  }
});

async function start(said = "", cls = ""): Promise<void> {
  say("reading the book…");
  const wire = await ask<BookWire>("book.json");
  S.wire = wire;
  S.sheets = new Map(wire.kinds.map((k) => [k.id, k]));
  [S.draft, S.faults, S.revisions, S.live, S.compared] = [structuredClone(wire.book), [], null, null, null];
  say(said, cls);
  const at = fromHash(location.hash);
  if (at.view) [S.view, S.seed] = [at.view, at.seed ?? S.seed];
  S.kind = (at.kind && (S.sheets.has(at.kind) || wire.missing.includes(at.kind)) ? at.kind : S.kind) || (wire.kinds[0]?.id ?? "");
  draw();
}

// What is live is read again every few seconds while a view that shows it is looked at.
setInterval(() => {
  if (!S.wire || document.hidden || !(S.view === "live" || S.view === "map")) return;
  // A field being typed in is not drawn over: the map alone is painted again.
  const typing = document.activeElement instanceof HTMLInputElement;
  void readLive().then(() => (typing ? mapDraw() : draw()), () => {});
}, 3000);
addEventListener("hashchange", () => {
  const at = fromHash(location.hash);
  if (at.view) [S.view, S.seed, S.kind] = [at.view, at.seed ?? S.seed, at.kind || S.kind];
  draw();
});
start().catch((err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
// The names a page under test reads the state by.
(globalThis as { events?: unknown }).events = { S };
