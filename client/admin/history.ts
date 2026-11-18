// The admin page over the survivor log: the timeline of what the log holds, with each survivor's sessions and the deaths
// and admin commands on it; the map and the table at the playhead; a chosen survivor's log (what it held then, what it
// gained and lost, its sessions and deaths); the window's figures; and who held an item. What is worked out is
// client/core/admin's (timeline.ts, recall.ts, past.ts, holding.ts); this asks and draws.

import type { LogMark, LogSurvivor } from "../../shared/survivor-log.ts";
import { bytesText, counted, idWords, spanText } from "../core/admin/format.ts";
import { clockText, dayText, momentText, tickText, timeStep, timeTicks } from "../core/admin/chart.ts";
import { DOT_AWAY, DOT_DEAD, DOT_OUT, DOT_SPECTATING } from "../core/admin/frame.ts";
import { changeText, heldAt, heldText, itemName, nearestChange } from "../core/admin/holding.ts";
import { figures, frameAt, onlineCounts, playIn, rowsAt, sessionAt } from "../core/admin/past.ts";
import { holdingAt } from "../core/admin/recall.ts";
import { findSurvivors, placeText } from "../core/admin/table.ts";
import { PRESETS, SPEEDS, localMoment, localText } from "../core/admin/timeline.ts";
import { $, BAD, DIM, FACE, ICE, S, WARN, WELL, esc, fit, hooks, offset } from "./dom.ts";
import { drawMap, lookAt } from "./map.ts";

const canvas = $<HTMLCanvasElement>("tlcanvas"), tip = $("tltip");
/** The name column, and the rows of the timeline from the top, in CSS pixels. */
const NAMES = 104;
const AXIS = 18, ONLINE = 28, MARKS = 14, LANE = 14, BAND = 14;
/** Lanes shown: those who played most in the window, and the chosen survivor always. */
const LANES = 12;
const STATE_WORDS: Readonly<Record<number, string>> = { [DOT_DEAD]: "dead", [DOT_OUT]: "unconscious", [DOT_SPECTATING]: "spectating", [DOT_AWAY]: "away, body left" };
const t = S.timeline;

/** The lanes drawn now, top to bottom, for pointing at them. */
let lanes: LogSurvivor[] = [];

/** Takes the log's state from the server's stats: its span, and what to say of it. */
export function syncLog(): void {
  const log = S.stats?.log;
  if (!log) return;
  const note = $("lognote");
  const has = log.from !== null && log.to !== null;
  $("timeline").classList.toggle("empty", !has);
  if (!has) {
    note.textContent = log.on ? "The survivor log is on and holds nothing yet: it begins as survivors play." : `No survivor log: ${log.why}.`;
    return;
  }
  const end = log.on ? Math.max(log.to!, S.stats!.at) : log.to!;
  t.setSpan(log.from!, end);
  note.textContent = `${log.on ? "The survivor log holds" : `The survivor log is off (${log.why}); it holds`} ${spanText(end - log.from!)} from ${momentText(log.from!, offset)}, ${bytesText(log.bytes)} of its ${bytesText(log.cap)}.`;
  refresh();
  ensure();
}

let asking: ReturnType<typeof setTimeout> | undefined;
/** Asks for what the window and the chosen survivor need, once the timeline has kept still a moment. */
export function ensure(): void {
  clearTimeout(asking);
  asking = setTimeout(() => void fetchAll(), 200);
}

async function fetchAll(): Promise<void> {
  if (!t.known) return;
  try {
    const got = await S.recall.fetchWindow(t);
    const chose = S.chosen !== 0 && (await S.recall.fetchChosen(S.chosen, t));
    if (S.item && got) await S.recall.fetchHolders(S.item.item, S.item.quality, S.item.blueprint, t);
    if (got) showItems();
    if (got || chose) refresh();
  } catch (e) {
    $("lognote").textContent = `The survivor log could not be read: ${String(e)}`;
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

/** The map, the table, the timeline and the panels at the playhead; live, the map and table are the server's now. */
function showPast(): void {
  const w = S.recall.window;
  if (!t.live) {
    const tail = Math.min(900_000, Math.max(15_000, (w?.step ?? 1000) * 30));
    S.frame = w ? frameAt(t.at, w.survivors, w.positions, t.to, tail) : { at: t.at, live: false, dots: [] };
    const d = lookChosen ? S.frame.dots.find((x) => x.pid === S.chosen) : undefined;
    if (d) lookAt(d.x, d.z);
    if (w) lookChosen = false;
  }
  if (!t.live) hooks.showPeople();
  drawTimeline();
  showChosen();
  showFigures();
  showHolders();
  const g = $<HTMLInputElement>("goto");
  if (document.activeElement !== g) g.value = localText(t.at, offset);
  $("live").classList.toggle("on", t.live);
  $("play").textContent = t.playing ? "❚❚" : "▶";
  drawMap();
}

/** The table at the playhead, in place of now's; false while live. */
export function showPastPeople(): boolean {
  if (t.live) return false;
  const w = S.recall.window;
  const rows = w ? findSurvivors(rowsAt(t.at, w.survivors, w.positions, w.marks, t.start, t.end, t.to), $<HTMLInputElement>("find").value) : [];
  const d = S.head?.dims;
  if ($("heads").dataset.mode !== "past") {
    $("heads").innerHTML = '<th>Name</th><th class="wide">Tribe</th><th>At the playhead</th><th class="num wide">Played</th><th class="wide">Where</th><th class="wide">Deaths</th>';
    $("heads").dataset.mode = "past";
  }
  $("rows").innerHTML = rows
    .map((r) => {
      const state = r.online ? (STATE_WORDS[r.state] ?? "online") + (r.riding ? `, on a ${esc(S.labels[r.riding] ?? idWords(r.riding))}` : "") : "offline";
      const where = d && Number.isFinite(r.x) ? placeText(d, r.x, r.z) : "";
      return `<tr data-pid="${r.pid}"${r.pid === S.chosen ? ' class="chosen"' : ""}><td><span class="dot ${r.online ? (r.state === DOT_DEAD ? "dead" : "on") : ""}"></span>${esc(r.name)}</td><td class="wide">${esc(r.tribe)}</td><td>${state}</td><td class="num wide">${r.playMs > 0 ? spanText(r.playMs) : ""}</td><td class="wide">${where}</td><td class="wide">${r.deaths || ""}</td></tr>`;
    })
    .join("");
  const online = rows.filter((r) => r.online).length;
  $("count").textContent = w ? `${online} online at ${clockText(t.at, offset)} of ${counted(w.survivors.length, "survivor")} in the window` : "reading the log";
  $("none").hidden = rows.length > 0;
  $("none").textContent = w ? "Nobody was online in this window." : "Reading the log.";
  return true;
}

function drawTimeline(): void {
  const w = S.recall.window;
  const shown = w ? [...w.survivors].sort((a, b) => playIn(b, t.start, t.end, t.to) - playIn(a, t.start, t.end, t.to)).filter((s) => playIn(s, t.start, t.end, t.to) > 0) : [];
  lanes = shown.slice(0, LANES);
  const chosen = shown.find((s) => s.pid === S.chosen);
  if (chosen && !lanes.includes(chosen)) lanes.push(chosen);
  const height = AXIS + ONLINE + MARKS + lanes.length * LANE + BAND + 6;
  canvas.style.height = `${height}px`;
  const g = fit(canvas), W = canvas.clientWidth, sw = W - NAMES;
  const x = (at: number): number => NAMES + t.x(at, sw);
  g.font = `12px ${FACE}`;
  if (!t.known) return;
  // The marks of the time axis, down the whole strip.
  const step = timeStep(t.start, t.end, Math.max(2, Math.floor(sw / 110)));
  for (const at of timeTicks(t.start, t.end, Math.max(2, Math.floor(sw / 110)), offset)) {
    g.fillStyle = "rgba(168,204,234,0.10)";
    g.fillRect(Math.round(x(at)), AXIS, 1, height - AXIS - BAND);
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
    g.fillText(`online, ${most} at most`, 4, y + ONLINE / 2 + 4);
  }
  y += ONLINE;
  g.fillStyle = DIM;
  g.fillText("deaths, commands", 4, y + 11);
  for (const m of w?.marks ?? []) if (m.wall >= t.start && m.wall <= t.end) mark(g, x(m.wall), y + 3, m.kind === "death" ? BAD : ICE, m.kind === "death");
  y += MARKS;
  for (const s of lanes) {
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
  }
  // The whole span below, the window on it.
  y += 4;
  const span = Math.max(1, t.to - t.from);
  const sx = (at: number): number => NAMES + ((at - t.from) / span) * sw;
  g.fillStyle = "rgba(168,204,234,0.12)";
  g.fillRect(NAMES, y, sw, BAND - 4);
  g.fillStyle = "rgba(169,214,242,0.45)";
  g.fillRect(sx(t.start), y, Math.max(2, sx(t.end) - sx(t.start)), BAND - 4);
  g.fillStyle = DIM;
  g.fillText(dayText(t.from, offset), 4, y + 9);
  // The playhead.
  const px = Math.round(x(t.at)) + 0.5;
  g.strokeStyle = t.live ? WELL : WARN;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, AXIS - 2);
  g.lineTo(px, y - 4);
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
const goes = (at: number, html: string, cls = ""): string => `<li data-at="${at}"${cls ? ` class="${cls}"` : ""}>${html}</li>`;

function showChosen(): void {
  const box = $("chosenlog");
  const w = S.recall.window;
  const c = S.recall.chosen?.pid === S.chosen ? S.recall.chosen : null;
  const s = w?.survivors.find((x) => x.pid === S.chosen) ?? null;
  const now = S.people?.survivors.find((x) => x.pid === S.chosen);
  if (S.chosen === 0 || !t.known) {
    box.innerHTML = `<h2>A survivor's log</h2><p class="dim pad">${t.known ? "Choose a survivor on the map, in the table or on the timeline: what it held at the playhead, what it gained and lost, its sessions and deaths." : "With no survivor log there is no past to read."}</p>`;
    return;
  }
  const name = s?.name ?? c?.changes.name ?? now?.name ?? "";
  const on = s ? sessionAt(s, t.at, t.to) : null;
  const held = c ? heldAt(c.changes, t.at) : [];
  const near = c ? nearestChange(c.changes.entries, t.at) : -1;
  const entries = c ? c.changes.entries.slice(Math.max(0, near - 20), near + 21) : [];
  const deaths = (w?.marks ?? []).filter((m) => m.kind === "death" && m.pid === S.chosen);
  box.innerHTML =
    `<h2>${esc(name)} <span class="dim">${esc(on?.tribe ?? s?.sessions.at(-1)?.tribe ?? "")}</span></h2>` +
    `<p class="dim pad">${on ? "online" : "offline"} at ${clockText(t.at, offset, true)}${s ? `, ${spanText(playIn(s, t.start, t.end, t.to))} played in the window` : ""}</p>` +
    `<h3>Held at the playhead</h3>${!c ? '<p class="dim pad">Reading its log.</p>' : held.length === 0 ? '<p class="dim pad">Nothing the log holds.</p>' : `<ul class="held">${held.map((h) => `<li>${esc(heldText(h, S.labels))}</li>`).join("")}</ul>`}` +
    (c?.changes.more ? '<p class="dim pad">More changes than one read lists: narrow the window for every one.</p>' : "") +
    `<h3>Gained and lost${c ? ` <span class="dim">in the window: ${esc(changeText(c.changes, S.labels)) || "nothing"}</span>` : ""}</h3>` +
    `<ol class="goes">${entries.map((e, i) => goes(e.wall, `<time>${clockText(e.wall, offset, true)}</time> ${esc(changeText(e, S.labels))}`, i + Math.max(0, near - 20) === near ? "near" : "")).join("")}</ol>` +
    `<h3>Sessions</h3><ol class="goes">${(s?.sessions ?? []).map((x) => goes(x.from, `<time>${dayText(x.from, offset)} ${clockText(x.from, offset)}</time> to ${x.to === null ? "now" : clockText(x.to, offset)}, ${spanText((x.to ?? t.to) - x.from)}${x.why ? `, ${esc(x.why)}` : ""}`)).join("") || '<li class="dim">none in the window</li>'}</ol>` +
    `<h3>Deaths</h3><ol class="goes">${deaths.map((m) => goes(m.wall, `<time>${clockText(m.wall, offset, true)}</time> ${esc(m.text || "died")}`)).join("") || '<li class="dim">none in the window</li>'}</ol>`;
}

let figuresKey = "";
function showFigures(): void {
  const w = S.recall.window;
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
  const marks = w.marks.filter((m) => m.wall >= t.start && m.wall <= t.end).slice(-60).reverse();
  const cell = (k: string, v: string): string => `<div><span class="label">${k}</span><b>${v}</b></div>`;
  box.innerHTML =
    `<h2>In the window <span class="dim">${momentText(t.start, offset)} to ${clockText(t.end, offset)}</span></h2>` +
    `<div class="figs">${cell("Survivors", String(f.survivors))}${cell("Sessions", String(f.sessions))}${cell("Played", spanText(f.playMs))}${cell("Most at once", f.peak > 0 ? `${f.peak}, ${clockText(f.peakAt, offset)}` : "0")}${cell("Deaths", String(f.deaths))}${cell("Admin commands", String(f.commands))}</div>` +
    (f.causes.length > 0 ? `<p class="dim pad">Deaths by cause: ${f.causes.map(([c, n]) => `${esc(c)} ${n}`).join(", ")}</p>` : "") +
    `<h3>Played most</h3><table class="players">${f.players.slice(0, 12).map((p) => `<tr data-pid="${p.pid}"${p.pid === S.chosen ? ' class="chosen"' : ""}><td>${esc(p.name)} <span class="faint">${esc(p.tribe)}</span><div class="barline"><i style="width:${(100 * p.playMs) / most}%"></i></div></td><td class="num">${spanText(p.playMs)}</td><td class="num">${counted(p.sessions, "session")}</td></tr>`).join("")}</table>` +
    `<h3>Deaths and commands${w.moreMarks ? ' <span class="dim">(more than one read lists)</span>' : ""}</h3><ol class="goes">${marks.map((m) => goes(m.wall, markText(m))).join("") || '<li class="dim">none in the window</li>'}</ol>`;
}

function markText(m: LogMark): string {
  return m.kind === "death" ? `<time>${clockText(m.wall, offset, true)}</time> <b class="bad">${esc(m.name || "someone")}</b> died${m.text ? `: ${esc(m.text)}` : ""}` : `<time>${clockText(m.wall, offset, true)}</time> ${esc(m.name || "the operator")}: <code>${esc(m.text)}</code>`;
}

/** The items held in the window, most widely held first, to ask who held one. */
function showItems(): void {
  const w = S.recall.window;
  const pick = $<HTMLSelectElement>("itempick");
  const items = [...(w?.items ?? [])].sort((a, b) => b.survivors - a.survivors || itemName(a, S.labels).localeCompare(itemName(b, S.labels)));
  const keep = pick.value;
  pick.innerHTML = `<option value="">${items.length > 0 ? "Choose an item held in the window" : "Nothing was held in the window"}</option>${items.map((i) => `<option value="${esc(`${i.item}|${i.quality}|${i.blueprint ? 1 : 0}`)}">${esc(itemName(i, S.labels))}, ${counted(i.survivors, "survivor")}, ${i.most.toLocaleString("en")} at most</option>`).join("")}`;
  pick.value = keep;
  showHolders();
}

function showHolders(): void {
  const h = S.recall.holders;
  const rows = S.item && h ? h.holders : [];
  const now = h ? holdingAt(rows, t.at, t.to) : new Set<number>();
  $("holders").innerHTML = rows.length === 0 ? `<tr><td class="dim">${S.item ? "Nobody held it in the window." : "Choose an item to see who held it, and when."}</td></tr>` : rows
    .map((x) => `<tr data-pid="${x.pid}" data-at="${Math.max(x.from, t.start)}"${now.has(x.pid) ? ' class="chosen"' : ""}><td>${esc(x.name)}</td><td>${esc(itemName({ item: h!.item, quality: x.quality, blueprint: x.blueprint }, S.labels))}</td><td>${dayText(x.from, offset)} ${clockText(x.from, offset)} to ${x.to === null ? "now" : clockText(x.to, offset)}</td><td class="num">${x.most.toLocaleString("en")} at most</td></tr>`)
    .join("");
}

/** The playhead to `at`, out of live; the window and the chosen survivor's log follow. */
function seek(at: number): void {
  t.seek(at);
  refresh();
  ensure();
}

// ------------------------------------------------------------------ the timeline under the pointer

let scrubbing = false;
const where = (e: MouseEvent): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
/** The lane at a height, or null. */
const laneAt = (y: number): LogSurvivor | null => lanes[Math.floor((y - AXIS - ONLINE - MARKS) / LANE)] ?? null;
const bandTop = (): number => AXIS + ONLINE + MARKS + lanes.length * LANE + 4;

canvas.addEventListener("pointerdown", (e) => {
  if (!t.known) return;
  const [x, y] = where(e);
  const sw = canvas.clientWidth - NAMES;
  if (x < NAMES) {
    const s = laneAt(y);
    if (s) hooks.chooseSurvivor(s.pid, true);
    return;
  }
  if (y >= bandTop()) {
    const at = t.from + ((x - NAMES) / sw) * (t.to - t.from);
    const width = t.end - t.start;
    t.show(at - width / 2, at + width / 2);
    if (!t.live && (t.at < t.start || t.at > t.end)) t.seek(at);
    refresh();
    ensure();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  scrubbing = true;
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
  // What is under the pointer: a mark, or a survivor's lane at that moment.
  const at = t.time(x - NAMES, sw);
  const w = S.recall.window;
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
  canvas.addEventListener(end, () => {
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
    const [x] = where(e);
    const sw = canvas.clientWidth - NAMES;
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
  S.recall.forget();
  hooks.showPeople();
  refresh();
  ensure();
});
let last = 0;
function play(now: number): void {
  if (!t.playing) return;
  t.advance(last ? Math.min(200, now - last) : 0);
  last = now;
  refresh();
  if (!S.recall.servesWindow(t)) ensure();
  requestAnimationFrame(play);
}
$("play").addEventListener("click", () => {
  if (!t.known) return;
  if (t.live) t.seek(t.start);
  t.playing = !t.playing;
  last = 0;
  if (t.playing) requestAnimationFrame(play);
  refresh();
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
  t.seek(at);
  t.show(at - 1_800_000, at + 1_800_000);
  refresh();
  ensure();
});
// A row or a list entry that names a moment moves the playhead there, and one naming a survivor chooses it.
for (const id of ["chosenlog", "figures", "holders"]) {
  $(id).addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-at], [data-pid]");
    if (!el) return;
    if (el.dataset.pid) hooks.chooseSurvivor(Number(el.dataset.pid), false);
    if (!el.dataset.at) return;
    lookChosen = true;
    seek(Number(el.dataset.at));
  });
}
$("itempick").addEventListener("change", () => {
  const [item, q, bp] = $<HTMLSelectElement>("itempick").value.split("|");
  S.item = item ? { item, quality: Number(q), blueprint: bp === "1" } : null;
  if (!S.item) return void showHolders();
  void S.recall.fetchHolders(S.item.item, S.item.quality, S.item.blueprint, t).then(() => {
    showHolders();
    drawMap();
  });
});
addEventListener("resize", () => drawTimeline());
