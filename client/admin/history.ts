// The admin page over the survivor log: the timeline of what the log holds, with each survivor's sessions and the deaths
// and admin commands on it; the map and the table at the playhead; a chosen survivor's log (what it held then, what it
// gained and lost, its sessions and deaths); the window's figures; and who held an item. What is worked out is
// client/core/admin's (timeline.ts, recall.ts, past.ts, holding.ts); this asks and draws.

import type { LogMark, LogSurvivor } from "../../shared/survivor-log.ts";
import { bytesText, counted, idWords, spanText } from "../core/admin/format.ts";
import { clockText, dayText, momentText, tickText, timeStep, timeTicks } from "../core/admin/chart.ts";
import { DOT_AWAY, DOT_DEAD, DOT_OUT, DOT_SPECTATING } from "../core/admin/frame.ts";
import { itemKey, nextEvent, readItem, windowEvents, type EventFilter } from "../core/admin/investigation.ts";
import { changeText, heldAt, heldText, itemName, nearestChange } from "../core/admin/holding.ts";
import { figures, frameAt, onlineCounts, playIn, rowsAt, sessionAt } from "../core/admin/past.ts";
import { holdingAt } from "../core/admin/recall.ts";
import { findSurvivors, placeText } from "../core/admin/table.ts";
import { LaneList } from "../core/admin/lanes.ts";
import { PRESETS, SPEEDS, localMoment, localText } from "../core/admin/timeline.ts";
import { $, BAD, DIM, FACE, ICE, S, WARN, WELL, esc, fit, hooks, offset, paintHtml } from "./dom.ts";
import { drawMap, lookAt } from "./map.ts";

const canvas = $<HTMLCanvasElement>("tlcanvas"), tip = $("tltip");
/** The name column, and the rows of the timeline from the top, in CSS pixels. */
const NAMES = 104;
const AXIS = 18, ONLINE = 28, MARKS = 14, LANE = 14;
/** Where the lanes begin. */
const LANES_TOP = AXIS + ONLINE + MARKS;
const STATE_WORDS: Readonly<Record<number, string>> = { [DOT_DEAD]: "dead", [DOT_OUT]: "unconscious", [DOT_SPECTATING]: "spectating", [DOT_AWAY]: "away, body left" };
const t = S.timeline;

/** Every survivor's lane in the window, the chosen one pinned, the rest scrolling in a view of a dozen rows. */
const lanes = new LaneList();

/** Takes the log's state from the server's stats: its span, and what to say of it. */
export function syncLog(restore?: () => void): void {
  const log = S.stats?.log;
  if (!log) return;
  const note = $("lognote");
  const end = log.on ? Math.max(log.to ?? 0, S.stats!.at) : log.to;
  const has = log.from !== null && end !== null && end > log.from;
  $("timeline").classList.toggle("empty", !has);
  for (const id of ["play", "speed", "goto", "scrub", "retained"]) $<HTMLButtonElement>(id).disabled = !has;
  if (!has) {
    if (t.known) {
      t.setSpan(0, 0);
      t.goLive();
      S.recall.reset();
      desired++;
      hooks.showPeople();
    }
    note.textContent = log.on ? "The survivor log is on and holds nothing yet: it begins as survivors play." : `No survivor log: ${log.why}.`;
    refresh();
    return;
  }
  t.setSpan(log.from!, end!);
  restore?.();
  note.textContent = `${log.on ? "The survivor log holds" : `The survivor log is off (${log.why}); it holds`} ${spanText(end - log.from!)} from ${momentText(log.from!, offset)}, ${bytesText(log.bytes)} of its ${bytesText(log.cap)}.`;
  refresh();
  ensure();
}

let asking: ReturnType<typeof setTimeout> | undefined;
let desired = 0;
export function ensure(): void {
  clearTimeout(asking);
  const request = ++desired;
  asking = setTimeout(() => void fetchAll(request), 140);
}

async function fetchAll(request: number): Promise<void> {
  if (!t.known || !["map", "survivors", "items"].includes(S.page)) return;
  const pid = S.chosen, item = S.item;
  try {
    const answers = await Promise.all([
      S.recall.fetchWindow(t),
      pid ? S.recall.fetchChosen(pid, t) : false,
      item ? S.recall.fetchHolders(item.item, item.quality, item.blueprint, t) : false,
    ]);
    if (answers.some(Boolean)) refresh();
  } catch (e) {
    if (request === desired) $("lognote").textContent = `The survivor log could not be read. ${String(e)}`;
  }
}

let queued = false;
/** Draws everything that follows the playhead, once a frame however often it moves. */
export function refresh(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    showPast();
  });
}

/** Set by an entry that moves the playhead: the map then looks at the chosen survivor where it was. */
let lookChosen = false;
export function centerReplaySelection(): void {
  lookChosen = true;
}

/** The map, the table, the timeline and the panels at the playhead; live, the map and table are the server's now. */
function showPast(): void {
  const w = S.recall.windowFor(t);
  if (!t.live) {
    const tail = $<HTMLInputElement>("trails").checked ? Math.min(900_000, Math.max(15_000, (w?.step ?? 1000) * 30)) : 0;
    S.frame = w ? frameAt(t.at, w.survivors, w.positions, t.to, tail) : { at: t.at, live: false, dots: [] };
    const d = lookChosen ? S.frame.dots.find((x) => x.pid === S.chosen) : undefined;
    if (d) lookAt(d.x, d.z);
    if (d && S.view) lookChosen = false;
  }
  if (!t.live) hooks.showPeople();
  drawTimeline();
  if (S.page === "survivors" || S.page === "map") showChosen();
  if (S.page === "map") showFigures();
  showEvents();
  if (S.page === "items") showItems();
  const g = $<HTMLInputElement>("goto");
  if (t.known && document.activeElement !== g) g.value = localText(t.at, offset);
  $("live").setAttribute("aria-pressed", String(t.live));
  $<HTMLInputElement>("bases").disabled = !t.live;
  $("play").textContent = t.playing ? "❚❚" : "▶";
  $("play").setAttribute("aria-label", t.playing ? "Pause" : "Play");
  const retained = $<HTMLInputElement>("retained");
  const scale = Math.max(1, t.to - t.from);
  const full = (at: number): number => (at - t.from) / scale;
  retained.value = String(Math.round(full((t.start + t.end) / 2) * 1000));
  retained.setAttribute("aria-valuetext", t.known ? `Window from ${momentText(t.start, offset)} to ${momentText(t.end, offset)}` : "No retained history");
  const focus = $("focus-window");
  focus.style.left = `${full(t.start) * 100}%`;
  focus.style.width = `${(full(t.end) - full(t.start)) * 100}%`;
  $("retained-start").textContent = t.known ? momentText(t.from, offset) : "";
  $("retained-end").textContent = t.known ? momentText(t.to, offset) : "";
  const scrub = $<HTMLInputElement>("scrub");
  scrub.value = String(Math.round(t.x(t.at, 1000)));
  scrub.setAttribute("aria-valuetext", t.known ? momentText(t.at, offset) : "No recorded history");
  $("playhead").textContent = t.live ? "Live" : momentText(t.at, offset);
  drawMap();
  if (!scrubbing && !t.playing) hooks.stateChanged();
}

/** The table at the playhead, in place of now's; false while live. */
export function showPastPeople(): boolean {
  if (t.live) return false;
  const w = S.recall.windowFor(t);
  const found = w ? findSurvivors(rowsAt(t.at, w.survivors, w.positions, w.marks, t.start, t.end, t.to), $<HTMLInputElement>("find").value) : [];
  const presence = $<HTMLSelectElement>("presence").value;
  const rows = found.filter((r) => presence === "all" || r.online === (presence === "online"));
  const d = S.head?.dims;
  if ($("heads").dataset.mode !== "past") {
    $("heads").innerHTML = '<th>Name</th><th class="wide">Tribe</th><th>At the playhead</th><th class="num wide">Played</th><th class="wide">Where</th><th class="wide">Deaths</th>';
    $("heads").dataset.mode = "past";
  }
  paintHtml($("rows"), rows
    .map((r) => {
      const state = r.online ? (STATE_WORDS[r.state] ?? "online") + (r.riding ? `, on a ${esc(S.labels[r.riding] ?? idWords(r.riding))}` : "") : "offline";
      const where = Number.isFinite(r.x) ? d ? placeText(d, r.x, r.z) : `X ${Math.round(r.x)} · Z ${Math.round(r.z)}` : "—";
      return `<tr data-pid="${r.pid}"${r.pid === S.chosen ? ' class="chosen"' : ""}><td><button type="button" class="row-button" data-focus="survivor-${r.pid}" aria-pressed="${r.pid === S.chosen}"><span class="dot ${r.online ? (r.state === DOT_DEAD ? "dead" : "on") : ""}"></span>${esc(r.name)}</button></td><td class="wide">${esc(r.tribe)}</td><td>${state}</td><td class="num wide">${r.playMs > 0 ? spanText(r.playMs) : ""}</td><td class="wide">${where}</td><td class="wide">${r.deaths || ""}</td></tr>`;
    })
    .join(""));
  const online = rows.filter((r) => r.online).length;
  $("count").textContent = w ? `${online} online at ${clockText(t.at, offset)} of ${counted(w.survivors.length, "survivor")} in the window` : "reading the log";
  $("none").hidden = rows.length > 0;
  $("none").textContent = w ? "No survivors match these filters in this window." : "Loading the selected history…";
  return true;
}

function drawTimeline(): void {
  const w = S.recall.windowFor(t);
  lanes.set(w?.survivors ?? [], t.start, t.end, t.to, S.chosen);
  const view = lanes.view();
  const rows = lanes.pinned ? [lanes.pinned, ...view.shown] : view.shown;
  const height = LANES_TOP + lanes.drawn * LANE + 12;
  canvas.style.height = `${height}px`;
  const g = fit(canvas), W = canvas.clientWidth, sw = W - NAMES;
  const x = (at: number): number => NAMES + t.x(at, sw);
  g.font = `12px ${FACE}`;
  if (!t.known) return;
  // The marks of the time axis, down the whole strip.
  const step = timeStep(t.start, t.end, Math.max(2, Math.floor(sw / 110)));
  for (const at of timeTicks(t.start, t.end, Math.max(2, Math.floor(sw / 110)), offset)) {
    g.fillStyle = "rgba(168,204,234,0.10)";
    g.fillRect(Math.round(x(at)), AXIS, 1, height - AXIS - 4);
    g.fillStyle = DIM;
    g.fillText(tickText(at, step, offset), x(at) + 3, 13);
  }
  // How many were online, the most in each stretch of three pixels.
  let y = AXIS;
  if (w) {
    const n = Math.max(1, Math.floor(sw / 3));
    const counts = onlineCounts(w.survivors, t.start, t.end, n, t.to);
    const most = Math.max(1, ...counts);
    g.fillStyle = "rgba(169,214,242,0.35)";
    counts.forEach((c, i) => c > 0 && g.fillRect(NAMES + (i * sw) / n, y + ONLINE - 4 - (c / most) * (ONLINE - 8), sw / n + 0.5, (c / most) * (ONLINE - 8)));
    g.fillStyle = DIM;
    g.fillText(`${lanes.count} online, ${most} at once`, 4, y + ONLINE / 2 + 4);
  }
  y += ONLINE;
  g.fillStyle = DIM;
  g.fillText("deaths, commands", 4, y + 11);
  for (const m of w?.marks ?? []) if (m.wall >= t.start && m.wall <= t.end) mark(g, x(m.wall), y + 3, m.kind === "death" ? BAD : ICE, m.kind === "death");
  y += MARKS;
  // Where more lanes lie above or below the view, a bar at its right edge says how much and where.
  if (view.above + view.below > 0) {
    const top = y + (lanes.pinned ? LANE : 0), all = lanes.rest.length, tall = view.shown.length * LANE;
    g.fillStyle = "rgba(168,204,234,0.12)";
    g.fillRect(W - 4, top, 3, tall);
    g.fillStyle = "rgba(169,214,242,0.6)";
    g.fillRect(W - 4, top + (view.above / all) * tall, 3, Math.max(6, (view.shown.length / all) * tall));
  }
  for (const s of rows) {
    const mine = s.pid === S.chosen;
    g.fillStyle = mine ? WELL : "#dbe8f3";
    g.fillText(s.name.length > 15 ? `${s.name.slice(0, 14)}…` : s.name, 4, y + 11);
    g.fillStyle = mine ? "rgba(143,217,196,0.9)" : "rgba(169,214,242,0.55)";
    for (const x0 of s.sessions) {
      const [a, b] = [Math.max(t.start, x0.from), Math.min(t.end, x0.to ?? t.to)];
      if (b > a) g.fillRect(x(a), y + 3, Math.max(1.5, x(b) - x(a)), LANE - 6);
    }
    for (const m of w?.marks ?? []) if (m.kind === "death" && m.pid === s.pid && m.wall >= t.start && m.wall <= t.end) mark(g, x(m.wall), y + 2, BAD, true);
    y += LANE;
    // The pinned lane stands apart from the list that scrolls under it.
    if (s === lanes.pinned && view.shown.length > 0) {
      g.fillStyle = "rgba(168,204,234,0.22)";
      g.fillRect(4, y - 0.5, W - 8, 1);
    }
  }
  // The playhead.
  const px = Math.round(x(t.at)) + 0.5;
  g.strokeStyle = t.live ? WELL : WARN;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, AXIS - 2);
  g.lineTo(px, height - 4);
  g.stroke();
  g.fillStyle = t.live ? WELL : WARN;
  g.beginPath();
  g.moveTo(px - 5, AXIS - 6);
  g.lineTo(px + 5, AXIS - 6);
  g.lineTo(px, AXIS);
  g.fill();
}

/** A death as a mark pointing down, a command as one pointing up. */
function mark(g: CanvasRenderingContext2D, x: number, y: number, colour: string, down: boolean): void {
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x - 4, down ? y : y + 8);
  g.lineTo(x + 4, down ? y : y + 8);
  g.lineTo(x, down ? y + 8 : y);
  g.fill();
}

/** A list item that moves the playhead to `at` when chosen. */
const goes = (at: number, html: string, cls = ""): string => `<li${cls ? ` class="${cls}"` : ""}><button type="button" data-at="${at}" data-focus="at-${at}">${html}</button></li>`;

function showChosen(): void {
  const box = $("chosenlog");
  const w = S.recall.windowFor(t);
  const c = S.recall.chosenFor(S.chosen, t);
  const s = w?.survivors.find((x) => x.pid === S.chosen) ?? null;
  if (S.chosen === 0 || !t.known) {
    box.innerHTML = `<h2>Survivor log</h2><p class="dim pad">${t.known ? "Choose a survivor on the map, in the table or on the timeline: what it held at the playhead, what it gained and lost, its sessions and deaths." : "With no survivor log there is no past to read."}</p>`;
    return;
  }
  const on = s ? sessionAt(s, t.at, t.to) : null;
  const held = c ? heldAt(c.changes, t.at) : [];
  const near = c ? nearestChange(c.changes.entries, t.at) : -1;
  const entries = c ? c.changes.entries.slice(Math.max(0, near - 20), near + 21) : [];
  const deaths = (w?.marks ?? []).filter((m) => m.kind === "death" && m.pid === S.chosen);
  paintHtml(box,
    `<h2>Recorded activity</h2>` +
    `<p class="dim pad">${on ? "online" : "offline"} at ${clockText(t.at, offset, true)}${s ? `, ${spanText(playIn(s, t.start, t.end, t.to))} played in the window` : ""}</p>` +
    `<h3>Held at the playhead</h3>${!c ? '<p class="dim pad">Reading its log.</p>' : held.length === 0 ? '<p class="dim pad">Nothing the log holds.</p>' : `<ul class="held">${held.map((h) => `<li>${esc(heldText(h, S.labels))}</li>`).join("")}</ul>`}` +
    (c?.changes.more ? '<p class="dim pad">More changes than one read lists: narrow the window for every one.</p>' : "") +
    `<h3>Gained and lost${c ? ` <span class="dim">${clockText(c.from, offset)} to ${clockText(c.to, offset)}: ${esc(changeText(c.changes, S.labels)) || "nothing"}</span>` : ""}</h3>` +
    `<ol class="goes">${entries.map((e, i) => goes(e.wall, `<time>${clockText(e.wall, offset, true)}</time> ${esc(changeText(e, S.labels))}`, i + Math.max(0, near - 20) === near ? "near" : "")).join("")}</ol>` +
    `<h3>Sessions</h3><ol class="goes">${(s?.sessions ?? []).map((x) => goes(x.from, `<time>${dayText(x.from, offset)} ${clockText(x.from, offset)}</time> to ${x.to === null ? "now" : clockText(x.to, offset)}, ${spanText((x.to ?? t.to) - x.from)}${x.why ? `, ${esc(x.why)}` : ""}`)).join("") || '<li class="dim">none in the window</li>'}</ol>` +
    `<h3>Deaths</h3><ol class="goes">${deaths.map((m) => goes(m.wall, `<time>${clockText(m.wall, offset, true)}</time> ${esc(m.text || "died")}`)).join("") || '<li class="dim">None in this window</li>'}</ol>`);
}

let figuresKey = "";
function showFigures(): void {
  const w = S.recall.windowFor(t);
  const key = `${t.start}|${t.end}|${w?.from}|${w?.to}|${S.chosen}`;
  if (key === figuresKey) return;
  figuresKey = key;
  const box = $("figures");
  if (!w) {
    box.innerHTML = `<h2>In the window</h2><p class="dim pad">${t.known ? "Reading the log." : "With no survivor log there is nothing to sum."}</p>`;
    return;
  }
  const f = figures(w.survivors, w.marks, t.start, t.end, t.to);
  const most = f.players[0]?.playMs ?? 1;
  const cell = (k: string, v: string): string => `<div><span class="label">${k}</span><b>${v}</b></div>`;
  box.innerHTML =
    `<h2>In the window <span class="dim">${momentText(t.start, offset)} to ${clockText(t.end, offset)}</span></h2>` +
    `<div class="figs">${cell("Survivors", String(f.survivors))}${cell("Sessions", String(f.sessions))}${cell("Played", spanText(f.playMs))}${cell("Most at once", f.peak > 0 ? `${f.peak}, ${clockText(f.peakAt, offset)}` : "0")}${cell("Deaths", String(f.deaths))}${cell("Admin commands", String(f.commands))}</div>` +
    (f.causes.length > 0 ? `<p class="dim pad">Deaths by cause: ${f.causes.map(([c, n]) => `${esc(c)} ${n}`).join(", ")}</p>` : "") +
    `<h3>Played most</h3><table class="players">${f.players.slice(0, 12).map((p) => `<tr data-pid="${p.pid}"${p.pid === S.chosen ? ' class="chosen"' : ""}><td><button type="button" class="row-button" data-focus="activity-${p.pid}">${esc(p.name)}</button> <span class="faint">${esc(p.tribe)}</span><div class="barline"><i style="width:${(100 * p.playMs) / most}%"></i></div></td><td class="num">${spanText(p.playMs)}</td><td class="num">${counted(p.sessions, "session")}</td></tr>`).join("")}</table>`;
}

function markText(m: LogMark): string {
  return m.kind === "death" ? `<time>${clockText(m.wall, offset, true)}</time> <b class="bad">${esc(m.name || "someone")}</b> died${m.text ? `: ${esc(m.text)}` : ""}` : `<time>${clockText(m.wall, offset, true)}</time> ${esc(m.name || "the operator")}: <code>${esc(m.text)}</code>`;
}

function visibleEvents(): LogMark[] {
  const w = S.recall.windowFor(t);
  return windowEvents(w?.marks ?? [], t.start, t.end, $<HTMLSelectElement>("event-filter").value as EventFilter);
}

function showEvents(): void {
  const events = visibleEvents();
  const has = S.recall.windowFor(t);
  $("event-note").textContent = !t.known ? "No history is available." : !has ? "Loading the selected history…" : events.length ? has.moreMarks ? "These are the most recent events. Narrow the time window to see earlier events." : "" : "No matching events in this window.";
  paintHtml($("event-list"), events.slice(-100).reverse().map((m) =>
    `<li><button type="button" data-at="${m.wall}" data-pid="${m.pid}" data-focus="event-${m.kind}-${m.tick}-${m.pid}"${m.wall === Math.floor(t.at) ? ' aria-current="time"' : ""}>${markText(m)}</button></li>`).join(""));
  $<HTMLButtonElement>("previous-event").disabled = nextEvent(events, t.at, -1) === null;
  $<HTMLButtonElement>("next-event").disabled = nextEvent(events, t.at, 1) === null;
}

function showItems(): void {
  const w = S.recall.windowFor(t);
  const pick = $<HTMLSelectElement>("itempick");
  const query = $<HTMLInputElement>("item-search").value.trim().toLowerCase();
  const items = [...(w?.items ?? [])].filter((i) => itemName(i, S.labels).toLowerCase().includes(query) || itemKey(i) === (S.item && itemKey(S.item)))
    .sort((a, b) => b.survivors - a.survivors || itemName(a, S.labels).localeCompare(itemName(b, S.labels)));
  const missing = S.item && !items.some((i) => itemKey(i) === itemKey(S.item!)) ? S.item : null;
  paintHtml(pick, `<option value="">${items.length > 0 ? "Choose an item" : query ? "No matching items" : w ? "Nothing held in this window" : "Waiting for item history"}</option>`
    + (missing ? `<option value="${esc(itemKey(missing))}">${esc(itemName(missing, S.labels))}</option>` : "")
    + items.map((i) => `<option value="${esc(itemKey(i))}">${esc(itemName(i, S.labels))} · ${counted(i.survivors, "survivor")}</option>`).join(""));
  pick.value = S.item ? itemKey(S.item) : "";
  $("item-map").setAttribute("href", hooks.mapUrl());
  showHolders();
}

function showHolders(): void {
  const item = S.item;
  const h = item ? S.recall.holdersFor(item.item, item.quality, item.blueprint, t) : null;
  const rows = h?.holders.filter((x) => x.from <= t.end && (x.to ?? t.to) >= t.start) ?? [];
  const now = holdingAt(rows, t.at, t.to);
  const empty = !t.known ? "No recorded item history is available." : !item ? "Select an item to see who held it and when."
    : !h ? "Loading holding intervals…" : "Nobody held this item in the selected window.";
  paintHtml($("holders"), rows.length === 0 ? `<tbody><tr><td class="dim">${empty}</td></tr></tbody>` :
    '<thead><tr><th scope="col">Survivor</th><th scope="col">Holding interval</th><th scope="col">Peak</th><th scope="col">Map</th></tr></thead><tbody>' + rows.map((x) => {
      const at = Math.max(x.from, t.start), active = now.has(x.pid);
      return `<tr${active ? ' class="chosen"' : ""}><td><button type="button" class="row-button" data-pid="${x.pid}" data-at="${at}" data-focus="holder-${x.pid}-${x.from}">${esc(x.name)}</button>${active ? ' <span class="holding-now">At playhead</span>' : ""}</td><td>${dayText(x.from, offset)} ${clockText(x.from, offset)} to ${x.to === null ? "ongoing" : clockText(x.to, offset)}</td><td class="num">${x.most.toLocaleString("en")}</td><td><a href="${esc(hooks.mapUrl(x.pid, at))}">Show on map</a></td></tr>`;
    }).join("") + "</tbody>");
}

export function seek(at: number): void {
  if (!t.known || !Number.isFinite(at)) return;
  t.playing = false;
  t.seek(at);
  refresh();
  ensure();
}

function selectEvent(direction: -1 | 1): void {
  const event = nextEvent(visibleEvents(), t.at, direction);
  if (!event) return;
  if (event.pid && S.page !== "items") hooks.chooseSurvivor(event.pid, false);
  lookChosen = true;
  seek(event.wall);
}

// ------------------------------------------------------------------ the timeline under the pointer

let scrubbing = false;
/** A drag of the names, which scrolls the lanes: where it began, the scroll then, and whether it has moved. */
let names: { y: number; scroll: number; moved: boolean } | null = null;
/** Wheel movement not yet a whole lane, in pixels. */
let wheelRest = 0;
const where = (e: MouseEvent): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
/** The lane at a height, or null. */
const laneAt = (y: number): LogSurvivor | null => (y < LANES_TOP ? null : lanes.at(Math.floor((y - LANES_TOP) / LANE)));
const lanesEnd = (): number => LANES_TOP + lanes.drawn * LANE;

canvas.addEventListener("pointerdown", (e) => {
  if (!t.known) return;
  const [x, y] = where(e);
  const sw = canvas.clientWidth - NAMES;
  if (x < NAMES) {
    // A tap on a name chooses it; a drag scrolls the list.
    canvas.setPointerCapture(e.pointerId);
    names = { y, scroll: lanes.scroll, moved: false };
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  scrubbing = true;
  t.playing = false;
  t.seek(t.time(x - NAMES, sw));
  refresh();
});
canvas.addEventListener("pointermove", (e) => {
  const [x, y] = where(e);
  const sw = canvas.clientWidth - NAMES;
  if (scrubbing) {
    t.seek(Math.max(t.start, Math.min(t.end, t.time(x - NAMES, sw))));
    refresh();
    return;
  }
  if (names) {
    names.moved ||= Math.abs(y - names.y) > 4;
    lanes.scrollTo(names.scroll + Math.round((names.y - y) / LANE));
    refresh();
    return;
  }
  // What is under the pointer: a mark, or a survivor's lane at that moment.
  const at = t.time(x - NAMES, sw);
  const w = S.recall.windowFor(t);
  let says = "";
  if (w && x > NAMES && y >= AXIS + ONLINE && y < AXIS + ONLINE + MARKS) {
    const near = w.marks.filter((m) => Math.abs(NAMES + t.x(m.wall, sw) - x) <= 5);
    says = near.slice(0, 4).map(markText).join("<br>");
  } else if (x > NAMES && laneAt(y)) {
    const s = laneAt(y)!;
    const on = sessionAt(s, at, t.to);
    says = `${esc(s.name)} at ${clockText(at, offset, true)}: ${on ? `online since ${clockText(on.from, offset)}` : "offline"}`;
  }
  tip.innerHTML = says;
  tip.hidden = says === "";
  tip.style.left = `${Math.min(x + 12, canvas.clientWidth - 260)}px`;
  tip.style.top = `${y + 14}px`;
});
canvas.addEventListener("pointerleave", () => (tip.hidden = true));
for (const end of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(end, (e) => {
    const drag = names;
    names = null;
    if (drag && !drag.moved && e.type === "pointerup") {
      const s = laneAt(drag.y);
      if (s) hooks.chooseSurvivor(s.pid, true);
    }
    if (!scrubbing) return;
    scrubbing = false;
    ensure();
  });
}
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!t.known) return;
    e.preventDefault();
    const [x, y] = where(e);
    const sw = canvas.clientWidth - NAMES;
    // Over the names, or over the lanes when they are more than their view holds, the wheel scrolls them; elsewhere it zooms.
    const list = y >= LANES_TOP && y < lanesEnd() && (x < NAMES || lanes.rest.length > lanes.rows);
    if (list && !e.ctrlKey && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      wheelRest += e.deltaY * (e.deltaMode === 1 ? LANE : 1);
      const by = Math.trunc(wheelRest / LANE);
      wheelRest -= by * LANE;
      lanes.scrollBy(by);
      refresh();
      return;
    }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) t.pan(((e.deltaX || e.deltaY) / sw) * (t.end - t.start));
    else t.zoomAt(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), t.time(Math.max(0, x - NAMES), sw));
    refresh();
    ensure();
  },
  { passive: false },
);

// ------------------------------------------------------------------ the controls

$("live").addEventListener("click", () => {
  t.goLive();
  hooks.showPeople();
  refresh();
  ensure();
});
let last = 0, looked = 0;
function play(now: number): void {
  if (!t.playing) return;
  t.advance(last ? Math.min(200, now - last) : 0);
  last = now;
  refresh();
  if (now - looked >= 350 && !S.recall.servesWindow(t)) {
    looked = now;
    ensure();
  }
  requestAnimationFrame(play);
}
function togglePlay(): void {
  if (!t.known) return;
  if (t.live || t.at >= t.to) t.seek(t.start);
  t.playing = !t.playing;
  last = looked = 0;
  if (t.playing) requestAnimationFrame(play);
  refresh();
  ensure();
}
$("play").addEventListener("click", togglePlay);
$("previous-event").addEventListener("click", () => selectEvent(-1));
$("next-event").addEventListener("click", () => selectEvent(1));
$("event-filter").addEventListener("change", showEvents);
$("retained").addEventListener("input", () => {
  const fraction = $<HTMLInputElement>("retained").valueAsNumber / 1000;
  t.focus(t.from + fraction * (t.to - t.from));
  refresh();
  ensure();
});
$("scrub").addEventListener("input", () => seek(t.time(Number($<HTMLInputElement>("scrub").value), 1000)));
$("tl").addEventListener("keydown", (e) => {
  if (!t.known || e.altKey || e.ctrlKey || e.metaKey) return;
  const step = e.shiftKey ? 60_000 : 5000;
  switch (e.key) {
    case " ": togglePlay(); break;
    case "ArrowLeft": seek(t.at - step); break;
    case "ArrowRight": seek(t.at + step); break;
    case "[": selectEvent(-1); break;
    case "]": selectEvent(1); break;
    case "Home": seek(t.start); break;
    case "End": $("live").click(); break;
    default: return;
  }
  e.preventDefault();
});
$("speed").innerHTML = SPEEDS.map((s) => `<option value="${s}"${s === t.speed ? " selected" : ""}>${s}×</option>`).join("");
$("speed").addEventListener("change", () => (t.speed = Number($<HTMLSelectElement>("speed").value)));
$("presets").innerHTML = PRESETS.map((p, i) => `<button data-preset="${i}">${p.label}</button>`).join("");
$("presets").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b || !t.known) return;
  const ms = PRESETS[Number(b.dataset.preset)]!.ms;
  if (t.live) t.show(t.to - ms, t.to);
  else t.show(t.at - ms / 2, t.at + ms / 2);
  refresh();
  ensure();
});
$("goto").addEventListener("change", () => {
  const at = localMoment($<HTMLInputElement>("goto").value, offset);
  if (at === null || !t.known) return;
  seek(at);
});
// A row or a list entry that names a moment moves the playhead there, and one naming a survivor chooses it.
for (const id of ["chosenlog", "figures", "holders", "event-list"]) {
  $(id).addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-at], [data-pid]");
    if (!el) return;
    if (el.dataset.pid && S.page !== "items") hooks.chooseSurvivor(Number(el.dataset.pid), false);
    if (!el.dataset.at) return;
    lookChosen = true;
    seek(Number(el.dataset.at));
  });
}
$("itempick").addEventListener("change", () => {
  S.item = readItem($<HTMLSelectElement>("itempick").value);
  S.recall.forgetHolders();
  refresh();
  ensure();
  hooks.stateChanged();
});
$("item-search").addEventListener("input", showItems);
addEventListener("resize", () => { if (t.known) drawTimeline(); });
