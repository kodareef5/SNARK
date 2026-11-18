// The admin page, /admin/: is the server well, who is on it and where. What it decides is in client/core/admin, the shapes
// it is told in shared/admin.ts; this asks the server (server/admin/routes.ts) and draws. The map draws a frame (frame.ts):
// the live one now, and any other moment's from whatever says where survivors were then.

import type { Minutes, Stats, Survivors } from "../../shared/admin.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { latLonText, latOf, lonOf } from "../../shared/world/coords.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { MapHead } from "../../shared/world/mapfile.ts";
import { levelFor } from "../../shared/world/tactical.ts";
import { baseSquares, readBases, type BaseChunk, type BaseSquare } from "../core/admin/bases.ts";
import { SPANS, chartRuns, clockText, joinMinutes, timeTicks, valueAxis } from "../core/admin/chart.ts";
import { agoText, bytesText, counted, idWords, msText, spanText } from "../core/admin/format.ts";
import { DOT_DEAD, DOT_OFFLINE, dotAt, liveFrame, type Dot, type MapFrame } from "../core/admin/frame.ts";
import { groundPicture, loadGround, pictureExtent } from "../core/admin/ground.ts";
import { FAILING, recentLoop, verdict } from "../core/admin/health.ts";
import { deathsText, findSurvivors, placeText, playedText, seenText, sortSurvivors, type SortKey } from "../core/admin/table.ts";
import { MapWindow, gridLines } from "../core/admin/view.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ICE = "#a9d6f2", WARN = "#ecb048", BAD = "#ec6a52", WELL = "#8fd9c4";
const FACE = '"Barlow Semi Condensed", system-ui, sans-serif';
const offset = new Date().getTimezoneOffset();
const palette = defaultPalette();
const mapBox = $("map"), canvas = $<HTMLCanvasElement>("mapcanvas"), ctx = canvas.getContext("2d")!;

let stats: Stats | null = null;
let minutes: Minutes | null = null;
let people: Survivors | null = null;
let answeredAt = 0;
let head: MapHead | null = null;
let hf: Heightfield | null = null;
let ground: HTMLCanvasElement | null = null;
let view: MapWindow | null = null;
let bases: BaseChunk[] = [];
let squares: BaseSquare[] = [];
let basesLevel = -1;
let chosen = 0;
let sort: SortKey = "seen";
let span = SPANS[0]!;
let frame: MapFrame = { at: 0, live: true, dots: [] };

async function ask(path: string): Promise<Response> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r;
}

async function poll(): Promise<void> {
  if (document.hidden) return;
  try {
    const [s, p] = await Promise.all([ask("stats.json").then((r) => r.json() as Promise<Stats>), ask("survivors.json").then((r) => r.json() as Promise<Survivors>)]);
    stats = s;
    people = p;
    answeredAt = Date.now();
    showStats();
    showPeople();
  } catch (e) {
    $("health").dataset.level = String(FAILING);
    $("word").textContent = "Not answering";
    $("line").textContent = answeredAt ? `its last answer was ${agoText(answeredAt, Date.now())}` : String(e);
  }
}

async function pollMinutes(): Promise<void> {
  if (document.hidden && minutes) return;
  minutes = joinMinutes(minutes, (await (await ask(`minutes.json?from=${minutes?.next ?? 0}`)).json()) as Minutes);
  drawCharts();
}

async function pollBases(): Promise<void> {
  if (!view || !$<HTMLInputElement>("bases").checked) return;
  basesLevel = levelFor(view.span());
  bases = readBases(new Uint8Array(await (await ask(`bases.bin?level=${basesLevel}`)).arrayBuffer())) ?? [];
  colourBases();
}

function colourBases(): void {
  const team = people?.survivors.find((r) => r.pid === chosen)?.team ?? 0;
  squares = head ? baseSquares(head.dims, bases, palette, team) : [];
  drawMap();
}

function tile(label: string, value: string, sub: string, cls = "", spark = ""): string {
  return `<div class="tile glass ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>${spark ? `<canvas id="${spark}"></canvas>` : ""}</div>`;
}

function showStats(): void {
  const s = stats!;
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
  const b = s.bodies, save = s.save, latest = save?.backups[0];
  const room = b.max - b.reserve;
  $("tiles").innerHTML = [
    tile("Tick", msText(loop.typical), `worst ${msText(loop.worst)} of ${msText(budget)}`, loop.typical > budget * 0.5 ? "warn" : "", "s-tick"),
    tile("Tick start", loop.late <= budget ? "on time" : `${msText(loop.late)} late`, `${loop.perSecond.toFixed(1)} ticks a second${loop.dropped > 0 ? `, ${loop.dropped} given up` : ""}`, loop.dropped > 0 ? "bad" : loop.late > budget * 2 ? "warn" : "", "s-late"),
    tile("Online", `${s.online.now}<small>of ${s.online.max}</small>`, people ? `${counted(people.survivors.length, "survivor")} in all` : ""),
    tile("Bodies", b.count.toLocaleString("en"), `of ${room.toLocaleString("en")}${b.refused > 0 ? `, ${b.refused} refused` : ""}`, b.count >= room * 0.9 ? "warn" : ""),
    tile("Memory", bytesText(s.memory.rss), `heap ${bytesText(s.memory.heapUsed)} of ${bytesText(s.memory.heapTotal)}`),
    save ? tile("Save", save.failing ? "failing" : "saving", save.failing ? `${esc(save.failing.code)} for ${spanText(save.failing.seconds * 1000)}` : `${save.commits.toLocaleString("en")} commits, ${bytesText(save.bytes)}`, save.failing ? "bad" : "") : tile("Save", "none", "no --db: nothing is kept", "warn"),
    tile("Backup", latest ? agoText(latest.at, s.at) : save ? "none yet" : "none", save ? `${counted(save.backups.length, "kept", "kept")}, ${bytesText(save.backups.reduce((n, x) => n + x.bytes, 0))}` : "with no save, none"),
    tile("Up", spanText(s.at - s.world.startedAt), `since ${clockText(s.world.startedAt, offset)}, tick ${s.world.tick.toLocaleString("en")}`),
  ].join("");
  const sec = s.ticks.seconds;
  spark($<HTMLCanvasElement>("s-tick"), [sec.p50, sec.worst], [ICE, WARN], Math.max(budget, ...sec.worst));
  spark($<HTMLCanvasElement>("s-late"), [sec.late], [WARN], Math.max(budget, ...sec.late));
  showDetails(s);
}

function fit(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio;
  [c.width, c.height] = [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** The last two minutes, a point a second, as lines over the tile's foot. */
function spark(c: HTMLCanvasElement, series: number[][], colours: string[], top: number): void {
  const g = fit(c), w = c.clientWidth, h = c.clientHeight;
  series.forEach((v, k) => {
    g.strokeStyle = colours[k]!;
    g.lineWidth = 1.5;
    g.beginPath();
    v.forEach((y, i) => g.lineTo((i / Math.max(1, v.length - 1)) * w, h - 1 - (Math.min(y, top) / top) * (h - 2)));
    g.stroke();
  });
}

function chart(id: string, lines: { v: number[]; colour: string; fill?: boolean }[], floor: number, words: (v: number) => string, budget = 0): void {
  const c = $<HTMLCanvasElement>(id), g = fit(c), w = c.clientWidth, h = c.clientHeight;
  const [left, foot] = [44, 18];
  const at = minutes?.columns.at ?? [];
  const t1 = stats?.at ?? Date.now(), t0 = t1 - span.ms;
  const shown = (v: number[]): number[] => v.filter((_, i) => at[i]! >= t0);
  const axis = valueAxis(Math.max(0, ...lines.flatMap((l) => shown(l.v))), floor);
  g.font = `12px ${FACE}`;
  g.fillStyle = "#93a9bd";
  g.strokeStyle = "rgba(168,204,234,0.12)";
  for (const v of axis.ticks) {
    const y = Math.round(h - foot - (v / axis.top) * (h - foot - 6)) + 0.5;
    g.fillText(words(v), 0, y + 4);
    g.beginPath();
    g.moveTo(left, y);
    g.lineTo(w, y);
    g.stroke();
  }
  for (const t of timeTicks(t0, t1, Math.max(2, Math.floor(w / 90)), offset)) g.fillText(clockText(t, offset), left + ((t - t0) / span.ms) * (w - left) - 14, h - 3);
  if (at.length === 0) g.fillText("the first minute is being timed", left + 8, (h - foot) / 2);
  g.save();
  g.translate(left, 6);
  const [cw, ch] = [w - left, h - foot - 6];
  if (budget > 0) {
    g.strokeStyle = BAD;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ch - (budget / axis.top) * ch);
    g.lineTo(cw, ch - (budget / axis.top) * ch);
    g.stroke();
    g.setLineDash([]);
  }
  for (const l of lines) {
    for (const run of chartRuns(at, l.v, t0, t1, axis.top, cw, ch, 90_000)) {
      g.beginPath();
      for (let i = 0; i < run.length; i += 2) g.lineTo(run[i]!, run[i + 1]!);
      if (l.fill && run.length > 2) {
        g.lineTo(run[run.length - 2]!, ch);
        g.lineTo(run[0]!, ch);
        g.fillStyle = "rgba(169,214,242,0.22)";
        g.fill();
      } else {
        g.strokeStyle = l.colour;
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }
  g.restore();
}

function drawCharts(): void {
  const m = minutes?.columns, none: number[] = [];
  const mb = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} GB` : `${Math.round(v / 1e6)} MB`);
  chart("c-tick", [{ v: m?.p50 ?? none, colour: ICE, fill: true }, { v: m?.p50 ?? none, colour: ICE }, { v: m?.worst ?? none, colour: WARN }], stats?.ticks.budget ?? 33, (v) => `${v} ms`, stats?.ticks.budget ?? 0);
  chart("c-late", [{ v: m?.late ?? none, colour: WARN }, { v: m?.lateMean ?? none, colour: ICE }], 10, (v) => `${v} ms`);
  chart("c-online", [{ v: m?.online ?? none, colour: WELL }], 4, (v) => String(v));
  chart("c-memory", [{ v: m?.rss ?? none, colour: ICE }, { v: m?.heap ?? none, colour: WELL }], 1e8, mb);
}

function rowsOf(list: [string, string][]): string {
  return list.map(([k, v]) => `<tr><td>${k}</td><td class="wrap">${v}</td></tr>`).join("");
}

function showDetails(s: Stats): void {
  const most = s.bodies.kinds[0]?.n ?? 1;
  const groups = Object.entries(s.bodies.groups).sort((a, b) => b[1] - a[1]);
  $("t-bodies").innerHTML =
    groups.map(([g, n]) => `<tr><td><b>${esc(g)}</b></td><td class="num"><b>${n.toLocaleString("en")}</b></td></tr>`).join("") +
    s.bodies.kinds.map((k) => `<tr><td>${esc(idWords(k.id))} <span class="faint">${esc(k.group)}</span><div class="barline"><i style="width:${(100 * k.n) / most}%"></i></div></td><td class="num">${k.n.toLocaleString("en")}</td></tr>`).join("");
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

function showPeople(): void {
  const all = people?.survivors ?? [];
  const query = $<HTMLInputElement>("find").value;
  const rows = findSurvivors(sortSurvivors(all, sort), query);
  const d = head?.dims;
  const now = people?.at ?? Date.now();
  $("count").textContent = `${all.filter((r) => r.online).length} online of ${all.length}${query.trim() ? `, ${rows.length} found` : ""}`;
  $("rows").innerHTML = rows
    .map((r) => {
      const dot = r.online ? (r.dead ? "dead" : "on") : "";
      const where = d ? placeText(d, r.x, r.z) + (r.riding ? `, on a ${idWords(r.riding)}` : "") : "";
      return `<tr data-pid="${r.pid}"${r.pid === chosen ? ' class="chosen"' : ""}><td><span class="dot ${dot}"></span>${esc(r.name)}</td><td class="wide">${esc(r.tribe)}</td><td class="num">${r.level}</td><td>${seenText(r, now)}</td><td class="num wide">${playedText(r)}</td><td class="wide">${where}</td><td class="wide">${deathsText(r, now)}</td></tr>`;
    })
    .join("");
  $("none").hidden = rows.length > 0;
  $("none").textContent = all.length === 0 ? "No survivor has been made on this world yet." : `No survivor or tribe is called "${query}".`;
  for (const th of document.querySelectorAll<HTMLElement>("#heads th")) th.classList.toggle("on", th.dataset.sort === sort);
  frame = liveFrame(now, all, $<HTMLInputElement>("offline").checked);
  drawMap();
}

function choose(pid: number, look: boolean): void {
  chosen = pid;
  const r = people?.survivors.find((x) => x.pid === pid);
  if (r && look && view) view.look(r.x, r.z, Math.max(view.scale, 0.15));
  showPeople();
  colourBases();
  document.querySelector(`tr[data-pid="${pid}"]`)?.scrollIntoView({ block: "nearest" });
}

let queued = false;
function drawMap(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(paintMap);
}

function paintMap(): void {
  queued = false;
  if (!view || !head || !hf) return;
  const v = view, dpr = devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0a1522";
  ctx.fillRect(0, 0, v.width, v.height);
  if (ground) {
    const e = pictureExtent(hf);
    ctx.imageSmoothingEnabled = v.scale * hf.cell < 3;
    ctx.drawImage(ground, v.sx(e.west), v.sy(e.north), e.side * v.scale, e.side * v.scale);
  }
  const [left, top, right, bottom] = [Math.max(0, v.sx(hf.sizeX)), Math.max(0, v.sy(hf.sizeZ)), Math.min(v.width, v.sx(0)), Math.min(v.height, v.sy(0))];
  const grid = gridLines(head.dims, v);
  ctx.font = `12px ${FACE}`;
  for (const l of grid.lon) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.42 : 0.2})`;
    ctx.fillRect(Math.round(l.at), top, 1, bottom - top);
    if (l.numbered) label(String(l.k), l.at + 3, top + 13, "#dbe8f3");
  }
  for (const l of grid.lat) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.42 : 0.2})`;
    ctx.fillRect(left, Math.round(l.at), right - left, 1);
    if (l.numbered && l.at - top > 16) label(String(l.k), left + 3, l.at + 13, "#dbe8f3");
  }
  if ($<HTMLInputElement>("bases").checked) {
    for (const q of squares) {
      const s = Math.max(1.5, q.size * v.scale);
      ctx.fillStyle = `#${q.colour.toString(16).padStart(6, "0")}`;
      ctx.fillRect(v.sx(q.x + q.size), v.sy(q.z + q.size), s, s);
    }
  }
  const seen = frame.dots.filter((d) => onMap(d));
  const names = $<HTMLInputElement>("names").checked;
  const crowded = seen.filter((d) => d.state !== DOT_OFFLINE).length > 60;
  for (const d of seen) {
    const [x, y] = [v.sx(d.x), v.sy(d.z)];
    ctx.beginPath();
    ctx.arc(x, y, d.state === DOT_OFFLINE ? 3 : 5, 0, Math.PI * 2);
    ctx.fillStyle = d.state === DOT_OFFLINE ? "rgba(170,188,204,0.6)" : d.state === DOT_DEAD ? BAD : "#eef7ff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = d.riding ? WARN : "rgba(4,10,18,0.85)";
    ctx.stroke();
    if (d.pid === chosen) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = ICE;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (d.pid === chosen || (names && d.state !== DOT_OFFLINE && !crowded)) label(d.name, x + 9, y + 4, d.pid === chosen ? ICE : "#eef7ff");
  }
  ctx.strokeStyle = "rgba(206,230,250,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(v.sx(hf.sizeX)) + 0.5, Math.round(v.sy(hf.sizeZ)) + 0.5, Math.round(hf.sizeX * v.scale), Math.round(hf.sizeZ * v.scale));
  $("when").innerHTML = frame.live ? `<b>&#9679;</b> live, ${clockText(frame.at || Date.now(), offset, true)}` : `at ${clockText(frame.at, offset, true)}`;
}

function onMap(d: Dot): boolean {
  const [x, y] = [view!.sx(d.x), view!.sy(d.z)];
  return x > -40 && y > -20 && x < view!.width + 40 && y < view!.height + 20;
}

function label(text: string, x: number, y: number, colour: string): void {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(4,10,18,0.8)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function sizeMap(): void {
  const r = mapBox.getBoundingClientRect();
  [canvas.width, canvas.height] = [Math.round(r.width * devicePixelRatio), Math.round(r.height * devicePixelRatio)];
  view?.resize(r.width, r.height);
  drawMap();
}

async function loadMap(): Promise<void> {
  const named = (await (await ask("../map.json")).json()) as { head: string };
  // A map's parts are named by their hash, so the browser keeps them.
  const got = await loadGround(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }, `../${named.head}`);
  head = got.head;
  hf = got.hf;
  view = new MapWindow(hf);
  sizeMap();
  // The picture is painted once, after the frame that shows the map's grid and survivors.
  await new Promise((done) => requestAnimationFrame(done));
  const rgba = groundPicture(hf, palette);
  const side = Math.sqrt(rgba.length / 4);
  ground = document.createElement("canvas");
  [ground.width, ground.height] = [side, side];
  ground.getContext("2d")!.putImageData(new ImageData(rgba, side, side), 0, 0);
  $("loading").hidden = true;
  showPeople();
  void pollBases();
}

// The map moves under one pointer, zooms under two, and a tap chooses the survivor under it.
const pointers = new Map<number, { x: number; y: number }>();
let travel = 0;
const at = (e: PointerEvent | WheelEvent | MouseEvent): [number, number] => {
  const r = mapBox.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
mapBox.addEventListener("pointerdown", (e) => {
  mapBox.setPointerCapture(e.pointerId);
  const [x, y] = at(e);
  pointers.set(e.pointerId, { x, y });
  travel = 0;
  mapBox.classList.add("dragging");
});
mapBox.addEventListener("pointermove", (e) => {
  const [x, y] = at(e);
  if (view && head) $("readout").textContent = latLonText(latOf(head.dims, view.worldZ(y)), lonOf(head.dims, view.worldX(x)));
  const p = pointers.get(e.pointerId);
  if (!p || !view) return;
  const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
  if (other) {
    const was = Math.hypot(p.x - other.x, p.y - other.y), now = Math.hypot(x - other.x, y - other.y);
    if (was > 0) view.zoomAt(now / was, (x + other.x) / 2, (y + other.y) / 2);
  } else view.pan(x - p.x, y - p.y);
  travel += Math.abs(x - p.x) + Math.abs(y - p.y);
  [p.x, p.y] = [x, y];
  drawMap();
});
mapBox.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  mapBox.classList.remove("dragging");
  if (travel > 6 || !view) return void soonBases();
  const [x, y] = at(e);
  const d = dotAt(frame, (d) => [view!.sx(d.x), view!.sy(d.z)], x, y, 14);
  if (d) choose(d.pid, false);
});
mapBox.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));
mapBox.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [x, y] = at(e);
  view?.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), x, y);
  drawMap();
  soonBases();
}, { passive: false });
mapBox.addEventListener("dblclick", (e) => {
  const [x, y] = at(e);
  view?.zoomAt(2, x, y);
  drawMap();
  soonBases();
});
for (const [id, factor] of [["zin", 1.6], ["zout", 1 / 1.6], ["zfit", 0]] as const) {
  $(id).addEventListener("pointerdown", (e) => e.stopPropagation());
  $(id).addEventListener("click", () => {
    if (!view) return;
    if (factor === 0) view.fit();
    else view.zoomAt(factor, view.width / 2, view.height / 2);
    drawMap();
    soonBases();
  });
}

let basesTimer: ReturnType<typeof setTimeout> | undefined;
/** Asks for the bases again once the zoom has settled, if it wants cells of another size. */
function soonBases(): void {
  clearTimeout(basesTimer);
  basesTimer = setTimeout(() => view && levelFor(view.span()) !== basesLevel && void pollBases(), 300);
}

$("rows").addEventListener("click", (e) => {
  const pid = Number((e.target as HTMLElement).closest("tr")?.dataset.pid ?? 0);
  if (pid) choose(pid, true);
});
$("heads").addEventListener("click", (e) => {
  const key = (e.target as HTMLElement).closest("th")?.dataset.sort as SortKey | undefined;
  if (key) sort = key;
  showPeople();
});
$("find").addEventListener("input", showPeople);
$("find").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = findSurvivors(sortSurvivors(people?.survivors ?? [], sort), $<HTMLInputElement>("find").value)[0];
  if (first) choose(first.pid, true);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== $("find")) {
    e.preventDefault();
    $("find").focus();
  } else if (e.key === "Escape") {
    $<HTMLInputElement>("find").value = "";
    choose(0, false);
  }
});
for (const id of ["offline", "names"]) $(id).addEventListener("change", showPeople);
$("bases").addEventListener("change", () => void pollBases().then(drawMap));
$("spans").innerHTML = SPANS.map((s, i) => `<button data-span="${i}"${i === 0 ? ' class="on"' : ""}>${s.label}</button>`).join("");
$("spans").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  span = SPANS[Number(b.dataset.span)]!;
  for (const x of $("spans").children) x.classList.toggle("on", x === b);
  drawCharts();
});
new ResizeObserver(sizeMap).observe(mapBox);
addEventListener("resize", drawCharts);
document.addEventListener("visibilitychange", () => void (document.hidden || poll()));

void poll();
void pollMinutes();
void loadMap().catch((e: unknown) => ($("loading").textContent = `The map did not load: ${String(e)}`));
setInterval(() => void poll(), 2000);
setInterval(() => void pollMinutes().catch(() => {}), 30_000);
setInterval(() => void pollBases().catch(() => {}), 10_000);
