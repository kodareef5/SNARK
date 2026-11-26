// The admin page, /admin/: is the server well, who is on it and where, and what happened. What it decides is in
// client/core/admin, the shapes it is told in shared/admin.ts and shared/survivor-log.ts; these files ask the server
// (server/admin/routes.ts) and draw. This one polls the server's state and draws the health, tiles, table of survivors
// and details; map.ts the map; history.ts the timeline and the log; charts.ts the charts.

import type { Minutes, SettingsPage, Stats, Survivors } from "../../shared/admin.ts";
import { RESTART_MOST } from "../../shared/net/protocol.ts";
import { RecentChat } from "../core/admin/chat.ts";
import { SPANS, clockText, joinMinutes } from "../core/admin/chart.ts";
import { agoText, bytesText, counted, idWords, msText, spanText } from "../core/admin/format.ts";
import { MAP_LAYERS, readInvestigation, writeInvestigation, type Investigation } from "../core/admin/investigation.ts";
import { stopText } from "../core/admin/settings.ts";
import { DOT_AWAY, DOT_DEAD, DOT_OUT, DOT_SPECTATING, liveFrame } from "../core/admin/frame.ts";
import { sessionAt } from "../core/admin/past.ts";
import { FAILING, recentLoop, verdict } from "../core/admin/health.ts";
import { deathsText, findSurvivors, placeText, playedText, seenText, sortSurvivors, type SortKey } from "../core/admin/table.ts";
import { addChatChannels, chatPanel } from "./chat.ts";
import { drawCharts, spark } from "./charts.ts";
import { $, S, ask, esc, hooks, offset, paintHtml } from "./dom.ts";
import { centerReplaySelection, ensure, refresh, seek, showPastPeople, syncLog } from "./history.ts";
import { colourBases, drawMap, loadMap, lookAt, pollBases } from "./map.ts";
import { adminContext } from "./shell.ts";

const ctx = await adminContext();
const titles = { map: "Map & replay", survivors: "Survivors", items: "Item history", health: "Health", saves: "Saves", restart: "Restart" };
type Page = keyof typeof titles;
const page: Page = Object.hasOwn(titles, ctx.view) ? ctx.view as Page : "map";
const roster = page === "map" || page === "survivors";
const replay = roster || page === "items";
S.page = page;

const visible: Record<Page, string[]> = {
  map: ["mapbox", "people", "timeline", "events-box", "figures"],
  survivors: ["people", "timeline", "events-box", "world-chat"],
  items: ["timeline", "itemsbox", "events-box"],
  health: ["health", "tiles", "charts", "health-details"],
  saves: ["health", "save-details"],
  restart: ["restart-panel"],
};
for (const id of new Set(Object.values(visible).flat())) $(id).hidden = !visible[page].includes(id);
$("work-area").hidden = !replay;
$("investigation").dataset.view = page;
$("investigation").hidden = false;
$("name").textContent = titles[page];
$("where").textContent = ctx.world && ctx.world.name !== ctx.world.map ? ctx.world.map : "";
document.title = `${titles[page]}${ctx.world ? ` · ${ctx.world.name}` : ""} · SNARK admin`;

let initial: Investigation | null = readInvestigation(new URLSearchParams(location.search));
S.chosen = initial.survivor;
S.item = initial.item;
for (const layer of MAP_LAYERS) $<HTMLInputElement>(layer).checked = initial.layers.includes(layer);

function restoreReplay(): void {
  const { timeline } = S;
  if (!timeline.known || !initial) return;
  if (initial.start !== null && initial.end !== null) timeline.show(initial.start, initial.end);
  if (initial.at !== null) {
    timeline.seek(initial.at);
    if (initial.survivor && initial.camera === null) centerReplaySelection();
  }
  initial = null;
}

function stateOf(pid = S.chosen, at = S.timeline.live ? null : S.timeline.at): Investigation {
  const t = S.timeline;
  const camera = S.view && !S.view.fitted ? { x: S.view.x, z: S.view.z, zoom: S.view.scale } : null;
  return { at, survivor: pid, item: S.item, layers: MAP_LAYERS.filter((layer) => $<HTMLInputElement>(layer).checked),
    start: t.known ? t.start : null, end: t.known ? t.end : null, camera };
}

function parameters(url: URL, pid?: number, at?: number): URL {
  writeInvestigation(url.searchParams, stateOf(pid, at));
  return url;
}

let urlTimer: ReturnType<typeof setTimeout> | undefined;
hooks.stateChanged = () => {
  if (!replay) return;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    if (initial && !S.timeline.known && initial.at !== null) return;
    const url = parameters(new URL(location.href));
    history.replaceState(null, "", url);
    $("item-map").setAttribute("href", hooks.mapUrl());
  }, 140);
};
hooks.mapUrl = (pid, at) => parameters(new URL(ctx.worldUrl("map"), location.href), pid, at).href;

let polling = false;
async function poll(): Promise<void> {
  if (polling || document.hidden || !ctx.world) return;
  polling = true;
  try {
    const [s, p] = await Promise.all([
      ask("stats.json").then((r) => r.json() as Promise<Stats>),
      roster ? ask("survivors.json").then((r) => r.json() as Promise<Survivors>) : null,
    ]);
    S.stats = s;
    S.people = p;
    S.answeredAt = Date.now();
    $("connection").textContent = "Connected";
    $("connection").dataset.state = "online";
    if (page === "health" || page === "saves") showStats();
    if (replay) syncLog(restoreReplay);
    if (roster) showPeople();
  } catch (e) {
    $("connection").textContent = "World unavailable";
    $("connection").dataset.state = "offline";
    $("connection").title = String(e);
    $("health").dataset.level = String(FAILING);
    $("word").textContent = "World unavailable";
    $("line").textContent = S.answeredAt ? `Last answered ${agoText(S.answeredAt, Date.now())}` : String(e);
    if (!S.people && roster) $("none").textContent = "The world could not provide its survivor roster.";
    if (!S.stats && replay) $("lognote").textContent = "The world could not provide its survivor log.";
  } finally {
    polling = false;
  }
}

const chatChannel = $<HTMLSelectElement>("chat-channel");
const chat = new RecentChat();
const chatView = chatPanel($("chat-lines"), $("chat-state"));
const drawChat = (): void => chatView(chat.view(chatChannel.value));
async function pollChat(): Promise<void> {
  if (document.hidden) return;
  await chat.refresh(async () => (await ask("chat.json")).json());
  drawChat();
}

async function pollMinutes(): Promise<void> {
  if (document.hidden && S.minutes) return;
  S.minutes = joinMinutes(S.minutes, (await (await ask(`minutes.json?from=${S.minutes?.next ?? 0}`)).json()) as Minutes);
  drawCharts();
}

function tile(label: string, value: string, sub: string, cls = "", sparkId = ""): string {
  return `<div class="tile admin-panel ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>${sparkId ? `<canvas id="${sparkId}"></canvas>` : ""}</div>`;
}

function showStats(): void {
  const s = S.stats!;
  const v = verdict(s);
  const loop = recentLoop(s);
  const budget = s.ticks.budget;
  $("health").dataset.level = String(v.level);
  $("word").textContent = v.word;
  $("line").textContent = v.line;
  $("reasons").innerHTML = v.reasons.map((r) => `<li>${esc(r)}</li>`).join("");
  if (page === "saves") return showDetails(s);
  const b = s.bodies, save = s.save, latest = save?.backups[0], log = s.log;
  const room = b.max - b.reserve;
  $("tiles").innerHTML = [
    tile("Tick", msText(loop.typical), `worst ${msText(loop.worst)} of ${msText(budget)}`, loop.typical > budget * 0.5 ? "warn" : "", "s-tick"),
    tile("Tick start", loop.late <= budget ? "on time" : `${msText(loop.late)} late`, `${loop.perSecond.toFixed(1)} ticks a second${loop.dropped > 0 ? `, ${loop.dropped} given up` : ""}`, loop.dropped > 0 ? "bad" : loop.late > budget * 2 ? "warn" : "", "s-late"),
    tile("Online", `${s.online.now}<small>of ${s.online.max}</small>`, S.people ? `${counted(S.people.survivors.length, "survivor")} in all` : ""),
    tile("Bodies", b.count.toLocaleString("en"), `of ${room.toLocaleString("en")}${b.refused > 0 ? `, ${b.refused} refused` : ""}`, b.count >= room * 0.9 ? "warn" : ""),
    tile("Memory", bytesText(s.memory.rss), `heap ${bytesText(s.memory.heapUsed)} of ${bytesText(s.memory.heapTotal)}`),
    save ? tile("Save", save.failing ? "failing" : "saving", save.failing ? `${esc(save.failing.code)} for ${spanText(save.failing.seconds * 1000)}` : `${save.commits.toLocaleString("en")} commits, ${bytesText(save.bytes)}`, save.failing ? "bad" : "") : tile("Save", "none", "no --db: nothing is kept", "warn"),
    tile("Backup", latest ? agoText(latest.at, s.at) : save ? "none yet" : "none", save ? `${counted(save.backups.length, "kept", "kept")}, ${bytesText(save.backups.reduce((n, x) => n + x.bytes, 0))}` : "with no save, none"),
    tile("Survivor log", log.from !== null && log.to !== null ? spanText(log.to - log.from) : log.on ? "empty" : "off", log.on || log.from !== null ? `${bytesText(log.bytes)} of ${bytesText(log.cap)}` : esc(log.why), log.on ? "" : "warn"),
    tile("Up", spanText(s.at - s.world.startedAt), `since ${clockText(s.world.startedAt, offset)}, tick ${s.world.tick.toLocaleString("en")}`),
  ].join("");
  const sec = s.ticks.seconds;
  spark($<HTMLCanvasElement>("s-tick"), [sec.p50, sec.worst], ["#2365a5", "#aa6228"], Math.max(budget, ...sec.worst));
  spark($<HTMLCanvasElement>("s-late"), [sec.late], ["#aa6228"], Math.max(budget, ...sec.late));
  showDetails(s);
}

function rowsOf(list: [string, string][]): string {
  return list.map(([k, v]) => `<tr><td>${k}</td><td class="wrap">${v}</td></tr>`).join("");
}

function showDetails(s: Stats): void {
  const most = s.bodies.kinds[0]?.n ?? 1;
  const groups = Object.entries(s.bodies.groups).sort((a, b) => b[1] - a[1]);
  $("t-bodies").innerHTML =
    groups.map(([g, n]) => `<tr><td><b>${esc(g)}</b></td><td class="num"><b>${n.toLocaleString("en")}</b></td></tr>`).join("") +
    s.bodies.kinds.map((k) => `<tr><td>${esc(S.labels[k.id] ?? idWords(k.id))} <span class="faint">${esc(k.group)}</span><div class="barline"><i style="width:${(100 * k.n) / most}%"></i></div></td><td class="num">${k.n.toLocaleString("en")}</td></tr>`).join("");
  const save = s.save;
  $("t-save").innerHTML = save
    ? rowsOf([
        ["File", `${esc(save.file)}, ${bytesText(save.bytes)}`],
        ["Commits", save.commits.toLocaleString("en")],
        ["Failing", save.failing ? `${esc(save.failing.code)}: ${esc(save.failing.error)}, ${counted(save.failing.tries, "try", "tries")}` : "no"],
        ["Checkpoint", `${msText(save.checkpoint.ms)}, ${counted(save.checkpoint.pages, "page")} left in the log`],
      ])
    : rowsOf([["Save", "none: the server was started without --db, and nothing is kept when it stops"]]);
  $("t-backups").innerHTML = save?.backups.length ? rowsOf(save.backups.map((b) => [esc(b.name), `${clockText(b.at, offset, true)} · ${bytesText(b.bytes)} · tick ${b.tick.toLocaleString("en")}`]))
    : rowsOf([["Backups", save ? "None recorded yet" : "No save is configured"]]);
  $("t-settings").innerHTML = s.settings.length === 0 ? rowsOf([["Every setting", "at its default"]]) : s.settings.map((x) => `<tr><td>${esc(x.name)}${x.status === "live" ? "" : ` <span class="faint">${esc(x.status)}</span>`}</td><td class="wrap">${(Array.isArray(x.value) ? x.value : [x.value]).map(esc).join("<br>")}</td><td class="faint">${esc(x.source)}</td></tr>`).join("");
  $("t-modules").innerHTML = s.modules.length === 0 ? rowsOf([["None", "no module is loaded"]]) : s.modules.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${counted(m.calls, "call")}</td><td class="num">${msText(m.ms)} in all</td><td class="num">${msText(m.worst)} at worst${m.off > 0 ? `, ${m.off} off` : ""}</td></tr>`).join("");
}

const headers: [SortKey, string, string][] = [
  ["name", "Name", ""], ["tribe", "Tribe", "wide"], ["level", "Lvl", "num wide"],
  ["seen", "Presence", ""], ["played", "Played", "wide"], ["deaths", "Deaths", "wide"],
];
const LIVE_HEADS = headers.map(([key, label, cls]) => `<th class="${cls}" scope="col"><button type="button" data-sort="${key}">${label}</button></th>`).join("")
  + '<th class="wide" scope="col">Where</th><th class="wide" scope="col">ID</th>';

function showPeople(): void {
  if (showPastPeople()) return showInspector();
  const all = S.people?.survivors ?? [];
  const query = $<HTMLInputElement>("find").value;
  const presence = $<HTMLSelectElement>("presence").value;
  const listed = all.filter((r) => presence === "all" || r.online === (presence === "online"));
  const rows = findSurvivors(sortSurvivors(listed, S.sort), query);
  const now = S.people?.at ?? Date.now();
  if ($("heads").dataset.mode !== "live") {
    $("heads").innerHTML = LIVE_HEADS;
    $("heads").dataset.mode = "live";
  }
  $("count").textContent = `${all.filter((r) => r.online).length} online · ${all.length} total${query.trim() ? ` · ${rows.length} found` : ""}`;
  paintHtml($("rows"), rows.map((r) => {
    const dot = r.online ? (r.dead ? "dead" : "on") : "";
    const selected = r.pid === S.chosen;
    const where = Number.isFinite(r.x) && Number.isFinite(r.z) ? `X ${Math.round(r.x)} · Z ${Math.round(r.z)}` : "—";
    return `<tr data-pid="${r.pid}"${selected ? ' class="chosen"' : ""}><td><button type="button" class="row-button" data-focus="survivor-${r.pid}" aria-pressed="${selected}"><span class="dot ${dot}"></span>${esc(r.name)}</button></td><td class="wide">${esc(r.tribe || "—")}</td><td class="num wide">${r.level}</td><td>${seenText(r, now)}</td><td class="wide">${playedText(r)}</td><td class="wide">${deathsText(r, now)}</td><td class="wide">${where}</td><td class="wide">${esc(r.id || "—")}</td></tr>`;
  }).join(""));
  $("none").hidden = rows.length > 0;
  $("none").textContent = !S.people ? "Loading survivors…" : all.length === 0 ? "No survivors on this world yet." : "No survivors match these filters.";
  for (const b of document.querySelectorAll<HTMLElement>("#heads button")) b.parentElement?.setAttribute("aria-sort", b.dataset.sort !== S.sort ? "none" : S.sort === "name" || S.sort === "tribe" ? "ascending" : "descending");
  S.frame = liveFrame(now, all, $<HTMLInputElement>("offline").checked);
  showInspector();
  drawMap();
}

function showInspector(): void {
  const pid = S.chosen;
  $("inspector").hidden = !roster || pid === 0;
  if (!roster || pid === 0) return;
  const now = S.people?.survivors.find((r) => r.pid === pid);
  const past = S.recall.windowFor(S.timeline)?.survivors.find((r) => r.pid === pid);
  const d = S.frame.dots.find((r) => r.pid === pid);
  const historic = !S.timeline.live;
  const position = historic ? d : now;
  const dims = S.head?.dims;
  const locationText = position && Number.isFinite(position.x) && Number.isFinite(position.z)
    ? dims ? placeText(dims, position.x, position.z) : `X ${Math.round(position.x)} · Z ${Math.round(position.z)}` : "No recorded position";
  const name = (historic ? past?.name : now?.name) ?? now?.name ?? past?.name ?? `Survivor ${pid}`;
  $("inspector-name").textContent = name;
  const liveInfo = !historic && now
    ? `<dt>ID</dt><dd>${esc(now.id || "—")}</dd><dt>Tribe</dt><dd>${esc(now.tribe || "Unaffiliated")}</dd><dt>Level</dt><dd>${now.level}</dd><dt>Presence</dt><dd>${esc(seenText(now, S.people!.at))}</dd><dt>Played</dt><dd>${esc(playedText(now)) || "—"}</dd>` : "";
  const session = historic && past ? sessionAt(past, S.timeline.at, S.timeline.to) : null;
  const words: Record<number, string> = { [DOT_AWAY]: "Away", [DOT_DEAD]: "Dead", [DOT_OUT]: "Unconscious", [DOT_SPECTATING]: "Spectating" };
  const pastInfo = !historic ? "" : `<dt>Presence</dt><dd>${d ? words[d.state] ?? "Online" : session ? "Online" : "Offline"}</dd>`
    + (session ? `<dt>Tribe</dt><dd>${esc(session.tribe || "Unaffiliated")}</dd>` : "");
  const deaths = !historic ? now?.deaths.slice().reverse() ?? [] : [];
  paintHtml($("survivor-detail"), `<dl>${liveInfo}${pastInfo}<dt>${historic ? "Recorded location" : "Location"}</dt><dd>${esc(locationText)}</dd></dl>
    ${page !== "map" ? `<a data-focus="survivor-map" class="action-link" href="${esc(hooks.mapUrl(pid))}">Open replay map</a>` : position ? '<button type="button" id="locate-survivor" data-focus="locate">Center map</button>' : ""}
    ${deaths.length ? `<details><summary>Recorded deaths</summary><ul class="goes">${deaths.map((x) => `<li>${x.at === null ? "Earlier run" : `<a href="${esc(hooks.mapUrl(pid, x.at))}">${clockText(x.at, offset, true)}</a>`}${dims ? ` · ${esc(placeText(dims, x.x, x.z))}` : ""}</li>`).join("")}</ul></details>` : ""}`);
}

function choose(pid: number, look: boolean): void {
  if (pid !== S.chosen) S.recall.forget();
  S.chosen = pid;
  if (look) {
    const d = S.frame.dots.find((x) => x.pid === pid) ?? (S.timeline.live ? S.people?.survivors.find((x) => x.pid === pid) : undefined);
    if (d) lookAt(d.x, d.z);
  }
  showPeople();
  colourBases();
  refresh();
  ensure();
  hooks.stateChanged();
}

hooks.drawMap = drawMap;
hooks.showPeople = showPeople;
hooks.showInspector = showInspector;
hooks.seek = seek;
hooks.chooseSurvivor = choose;

$("rows").addEventListener("click", (e) => {
  const pid = Number((e.target as HTMLElement).closest("tr")?.dataset.pid ?? 0);
  if (pid) choose(pid, true);
});
$("heads").addEventListener("click", (e) => {
  const key = (e.target as HTMLElement).closest("button")?.dataset.sort as SortKey | undefined;
  if (key) S.sort = key;
  showPeople();
});
$("find").addEventListener("input", showPeople);
$("presence").addEventListener("change", showPeople);
$("find").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.querySelector<HTMLButtonElement>("#rows button")?.click();
});
$("close-inspector").addEventListener("click", () => {
  const selected = S.chosen;
  choose(0, false);
  (document.querySelector<HTMLButtonElement>(`#rows [data-focus="survivor-${selected}"]`) ?? $("find")).focus();
});
$("survivor-detail").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("#locate-survivor")) choose(S.chosen, true);
});
document.addEventListener("keydown", (e) => {
  if (!roster || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === "/") {
    e.preventDefault();
    $("find").focus();
  } else if (e.key === "Escape" && S.chosen) $("close-inspector").click();
});
for (const layer of MAP_LAYERS) $(layer).addEventListener("change", () => {
  if (layer === "offline") showPeople();
  if (layer === "trails") refresh();
  drawMap();
  hooks.stateChanged();
});

$("spans").innerHTML = SPANS.map((s, i) => `<button type="button" data-span="${i}" aria-pressed="${i === 0}">${s.label}</button>`).join("");
$("spans").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  S.span = SPANS[Number(b.dataset.span)]!;
  for (const x of $("spans").children) x.setAttribute("aria-pressed", String(x === b));
  drawCharts();
});

let stopping = false, checkingStop = false, stopVersion = 0;
async function restartStatus(): Promise<void> {
  if (stopping || checkingStop || document.hidden) return;
  checkingStop = true;
  const version = stopVersion;
  try {
    const got = await (await ask("settings.json")).json() as SettingsPage;
    if (version !== stopVersion) return;
    $("stop-line").textContent = got.stopLeft < 0 ? "No stop scheduled." : stopText(got.stopLeft);
    $("stop-cancel").hidden = got.stopLeft < 0;
    $<HTMLButtonElement>("stop-review").disabled = got.stopLeft >= 0;
    $("connection").textContent = "Connected";
    $("connection").dataset.state = "online";
  } catch (e) {
    if (version !== stopVersion) return;
    $("stop-line").textContent = "The world could not be reached.";
    $<HTMLButtonElement>("stop-review").disabled = true;
    $("stop-cancel").hidden = true;
    $("connection").textContent = "World unavailable";
    $("connection").dataset.state = "offline";
    $("connection").title = String(e);
  } finally {
    checkingStop = false;
    if (!stopping && version !== stopVersion) void restartStatus();
  }
}

async function stop(body: { seconds: number } | { cancel: true }): Promise<void> {
  if (stopping) return;
  stopping = true;
  stopVersion++;
  $<HTMLButtonElement>("stop-review").disabled = $<HTMLButtonElement>("stop-cancel").disabled = true;
  try {
    const r = await fetch(ctx.api("stop"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status !== 200 && r.status !== 400) throw Error(((await r.json().catch(() => null)) as { why?: string } | null)?.why ?? `The world answered ${r.status}.`);
    const result = await r.json() as { ok: boolean; why: string };
    $("stop-message").textContent = result.ok ? ("cancel" in body ? "Scheduled stop canceled." : "Stop scheduled.") : result.why;
  } catch (e) {
    $("stop-message").textContent = String(e);
  } finally {
    stopping = false;
    $<HTMLButtonElement>("stop-cancel").disabled = false;
    void restartStatus();
  }
}

function wireRestart(): void {
  $<HTMLInputElement>("stop-seconds").max = String(RESTART_MOST);
  const dialog = $<HTMLDialogElement>("stop-dialog");
  let seconds = 60;
  $("stop-form").addEventListener("submit", (e) => {
    e.preventDefault();
    seconds = $<HTMLInputElement>("stop-seconds").valueAsNumber;
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > RESTART_MOST) return;
    $("stop-confirm-text").textContent = `Stop ${ctx.world?.name ?? "this world"} ${seconds === 0 ? "now" : `in ${counted(seconds, "second")}`}?`;
    dialog.showModal();
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "stop") void stop({ seconds });
    dialog.returnValue = "";
  });
  $("stop-cancel").addEventListener("click", () => void stop({ cancel: true }));
  void restartStatus();
  setInterval(() => void restartStatus(), 2000);
}

if (ctx.world) {
  if (page === "restart") wireRestart();
  else {
    void poll();
    document.addEventListener("visibilitychange", () => void poll());
    setInterval(() => void poll(), 2000);
  }
  if (replay) {
    void ask("content.json").then((r) => r.json() as Promise<{ labels: Record<string, string> }>).then((c) => {
      S.labels = c.labels;
      refresh();
    }).catch(() => {});
  }
  if (page === "map") {
    const camera = initial?.camera ?? null;
    void loadMap(ctx.api, camera).catch((e: unknown) => { $("loading").textContent = `The terrain could not be loaded. ${String(e)}`; });
    setInterval(() => void pollBases().catch(() => {}), 10_000);
  }
  if (page === "survivors") {
    addChatChannels(chatChannel);
    chatChannel.addEventListener("change", drawChat);
    void pollChat();
    setInterval(() => void pollChat(), 3000);
  }
  if (page === "health") {
    addEventListener("resize", drawCharts);
    void pollMinutes().catch(() => {});
    setInterval(() => void pollMinutes().catch(() => {}), 30_000);
  }
} else {
  $("connection").textContent = "Choose a world";
}
