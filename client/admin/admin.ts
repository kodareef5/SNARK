// The admin page, /admin/: is the server well, who is on it and where, and what happened. What it decides is in
// client/core/admin, the shapes it is told in shared/admin.ts and shared/survivor-log.ts; these files ask the server
// (server/admin/routes.ts) and draw. This one polls the server's state and draws the health, tiles, table of survivors
// and details; map.ts the map; history.ts the timeline and the log; charts.ts the charts.

import type { Minutes, Stats, Survivors } from "../../shared/admin.ts";
import { RecentChat } from "../core/admin/chat.ts";
import { SPANS, clockText, joinMinutes } from "../core/admin/chart.ts";
import { agoText, bytesText, counted, idWords, msText, spanText } from "../core/admin/format.ts";
import { liveFrame } from "../core/admin/frame.ts";
import { FAILING, recentLoop, verdict } from "../core/admin/health.ts";
import { deathsText, findSurvivors, placeText, playedText, seenText, sortSurvivors, type SortKey } from "../core/admin/table.ts";
import { addChatChannels, chatPanel } from "./chat.ts";
import { drawCharts, spark } from "./charts.ts";
import { $, ICE, S, WARN, ask, esc, hooks, offset } from "./dom.ts";
import { ensure, refresh, showPastPeople, syncLog } from "./history.ts";
import { colourBases, drawMap, loadMap, lookAt, pollBases } from "./map.ts";

async function poll(): Promise<void> {
  if (document.hidden) return;
  try {
    const [s, p] = await Promise.all([ask("stats.json").then((r) => r.json() as Promise<Stats>), ask("survivors.json").then((r) => r.json() as Promise<Survivors>)]);
    S.stats = s;
    S.people = p;
    S.answeredAt = Date.now();
    showStats();
    showPeople();
    syncLog();
  } catch (e) {
    $("health").dataset.level = String(FAILING);
    $("word").textContent = "Not answering";
    $("line").textContent = S.answeredAt ? `its last answer was ${agoText(S.answeredAt, Date.now())}` : String(e);
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
  return `<div class="tile glass ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>${sparkId ? `<canvas id="${sparkId}"></canvas>` : ""}</div>`;
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
  $("name").textContent = s.world.name;
  $("where").textContent = `${s.map.label}, ${(s.map.sizeX / 1000).toFixed(1)} by ${(s.map.sizeZ / 1000).toFixed(1)} km${s.world.cluster ? ` · cluster ${s.world.cluster}` : ""}`;
  $("dev").hidden = !s.world.dev;
  document.title = `${v.word} · ${s.world.name} · SNARK admin`;
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
  spark($<HTMLCanvasElement>("s-tick"), [sec.p50, sec.worst], [ICE, WARN], Math.max(budget, ...sec.worst));
  spark($<HTMLCanvasElement>("s-late"), [sec.late], [WARN], Math.max(budget, ...sec.late));
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
        ...save.backups.map((b): [string, string] => [agoText(b.at, s.at), `${esc(b.name)}, ${bytesText(b.bytes)}`]),
      ])
    : rowsOf([["Save", "none: the server was started without --db, and nothing is kept when it stops"]]);
  $("t-settings").innerHTML = s.settings.length === 0 ? rowsOf([["Every setting", "at its default"]]) : s.settings.map((x) => `<tr><td>${esc(x.name)}${x.status === "live" ? "" : ` <span class="faint">${esc(x.status)}</span>`}</td><td class="wrap">${(Array.isArray(x.value) ? x.value : [x.value]).map(esc).join("<br>")}</td><td class="faint">${esc(x.source)}</td></tr>`).join("");
  $("t-modules").innerHTML = s.modules.length === 0 ? rowsOf([["None", "no module is loaded"]]) : s.modules.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${counted(m.calls, "call")}</td><td class="num">${msText(m.ms)} in all</td><td class="num">${msText(m.worst)} at worst${m.off > 0 ? `, ${m.off} off` : ""}</td></tr>`).join("");
}

const LIVE_HEADS = '<th data-sort="name">Name</th><th data-sort="tribe" class="wide">Tribe</th><th data-sort="level" class="num">Lvl</th><th data-sort="seen">Seen</th><th data-sort="played" class="num wide">Played</th><th class="wide">Where</th><th data-sort="deaths" class="wide">Deaths</th>';

/** The table and the map's frame now; at the playhead's moment the log's instead (history.ts). */
function showPeople(): void {
  if (showPastPeople()) return;
  const all = S.people?.survivors ?? [];
  const query = $<HTMLInputElement>("find").value;
  const rows = findSurvivors(sortSurvivors(all, S.sort), query);
  const d = S.head?.dims;
  const now = S.people?.at ?? Date.now();
  if ($("heads").dataset.mode !== "live") {
    $("heads").innerHTML = LIVE_HEADS;
    $("heads").dataset.mode = "live";
  }
  $("count").textContent = `${all.filter((r) => r.online).length} online of ${all.length}${query.trim() ? `, ${rows.length} found` : ""}`;
  $("rows").innerHTML = rows
    .map((r) => {
      const dot = r.online ? (r.dead ? "dead" : "on") : "";
      const where = d ? placeText(d, r.x, r.z) + (r.riding ? `, on a ${esc(S.labels[r.riding] ?? idWords(r.riding))}` : "") : "";
      return `<tr data-pid="${r.pid}"${r.pid === S.chosen ? ' class="chosen"' : ""}><td><span class="dot ${dot}"></span>${esc(r.name)}</td><td class="wide">${esc(r.tribe)}</td><td class="num">${r.level}</td><td>${seenText(r, now)}</td><td class="num wide">${playedText(r)}</td><td class="wide">${where}</td><td class="wide">${deathsText(r, now)}</td></tr>`;
    })
    .join("");
  $("none").hidden = rows.length > 0;
  $("none").textContent = all.length === 0 ? "No survivor has been made on this world yet." : `No survivor or tribe is called "${query}".`;
  for (const th of document.querySelectorAll<HTMLElement>("#heads th")) th.classList.toggle("on", th.dataset.sort === S.sort);
  S.frame = liveFrame(now, all, $<HTMLInputElement>("offline").checked);
  drawMap();
}

/** Chooses a survivor: its row, its tribe's bases, its log; with `look`, the map goes to where it is or was. */
function choose(pid: number, look: boolean): void {
  S.chosen = pid;
  if (pid === 0) S.recall.forget();
  if (look) {
    const d = S.frame.dots.find((x) => x.pid === pid) ?? S.people?.survivors.find((x) => x.pid === pid);
    if (d) lookAt(d.x, d.z);
  }
  showPeople();
  colourBases();
  refresh();
  ensure();
  document.querySelector(`#rows tr[data-pid="${pid}"]`)?.scrollIntoView({ block: "nearest" });
}

hooks.drawMap = drawMap;
hooks.showPeople = showPeople;
hooks.chooseSurvivor = choose;

$("rows").addEventListener("click", (e) => {
  const pid = Number((e.target as HTMLElement).closest("tr")?.dataset.pid ?? 0);
  if (pid) choose(pid, true);
});
$("heads").addEventListener("click", (e) => {
  const key = (e.target as HTMLElement).closest("th")?.dataset.sort as SortKey | undefined;
  if (key) S.sort = key;
  showPeople();
});
$("find").addEventListener("input", showPeople);
$("find").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = document.querySelector<HTMLElement>("#rows tr[data-pid]");
  if (first) choose(Number(first.dataset.pid), true);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("find") && !(document.activeElement instanceof HTMLInputElement)) {
    e.preventDefault();
    $("find").focus();
  } else if (e.key === "Escape") {
    $<HTMLInputElement>("find").value = "";
    choose(0, false);
  }
});
for (const id of ["offline", "names"]) $(id).addEventListener("change", () => (S.timeline.live ? showPeople() : refresh()));
$("spans").innerHTML = SPANS.map((s, i) => `<button data-span="${i}"${i === 0 ? ' class="on"' : ""}>${s.label}</button>`).join("");
$("spans").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  S.span = SPANS[Number(b.dataset.span)]!;
  for (const x of $("spans").children) x.classList.toggle("on", x === b);
  drawCharts();
});
addEventListener("resize", drawCharts);
document.addEventListener("visibilitychange", () => void (document.hidden || poll()));

void ask("content.json")
  .then((r) => r.json() as Promise<{ labels: Record<string, string> }>)
  .then((c) => (S.labels = c.labels))
  .catch(() => {});
addChatChannels(chatChannel);
chatChannel.addEventListener("change", drawChat);
void pollChat();
setInterval(() => void pollChat(), 3000);
void poll();
void pollMinutes().catch(() => {});
void loadMap().catch((e: unknown) => ($("loading").textContent = `The map did not load: ${String(e)}`));
setInterval(() => void poll(), 2000);
setInterval(() => void pollMinutes().catch(() => {}), 30_000);
setInterval(() => void pollBases().catch(() => {}), 10_000);
