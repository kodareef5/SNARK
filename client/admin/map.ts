// The admin page's map: the ground painted once from the map file's overviews, the grid, the tribes' bases, and the frame
// of survivors (now, or the playhead's moment with where each had just been), with the chosen survivor's track and who
// held the chosen item. It moves under one pointer, zooms under two or the wheel, and a tap chooses a survivor.

import { readPart, type MapPart } from "../../shared/world/mapfile.ts";
import type { Stretch } from "../../shared/world/streets.ts";
import { latLonText, latOf, lonOf } from "../../shared/world/coords.ts";
import { levelFor } from "../../shared/world/tactical.ts";
import { baseSquares, readBases } from "../core/admin/bases.ts";
import { clockText, momentText } from "../core/admin/chart.ts";
import { idWords } from "../core/admin/format.ts";
import { DOT_AWAY, DOT_DEAD, DOT_OFFLINE, DOT_OUT, DOT_SPECTATING, dotAt, type Dot } from "../core/admin/frame.ts";
import { groundPicture, loadGround, paperPalette, pictureExtent, pictureSide } from "../core/admin/ground.ts";
import { placeAt, sampleBefore } from "../core/admin/past.ts";
import { mapLabelBox, type LabelBox } from "../core/admin/map-labels.ts";
import { streetsInView } from "../core/admin/street-view.ts";
import type { Investigation } from "../core/admin/investigation.ts";
import { holdingAt } from "../core/admin/recall.ts";
import { MapWindow, gridLines } from "../core/admin/view.ts";
import { $, BAD, FACE, ICE, INK, S, WARN, ask, hooks, label, offset, palette } from "./dom.ts";

const box = $("map"), canvas = $<HTMLCanvasElement>("mapcanvas"), ctx = canvas.getContext("2d")!;
const enabled = (id: string): boolean => $<HTMLInputElement>(id).checked;
const mapView = (): boolean => S.page === "map";
const FILL: Readonly<Record<number, string>> = { [DOT_OFFLINE]: "rgba(170,188,204,0.6)", [DOT_DEAD]: BAD, [DOT_OUT]: WARN, [DOT_SPECTATING]: "rgba(0,0,0,0)", [DOT_AWAY]: "rgba(150,170,190,0.75)" };

let baseAsk = 0;

export async function pollBases(): Promise<void> {
  if (!mapView() || !S.view || !S.timeline.live || !enabled("bases")) return;
  const askId = ++baseAsk, level = levelFor(S.view.span());
  const bases = readBases(new Uint8Array(await (await ask(`bases.bin?level=${level}`)).arrayBuffer())) ?? [];
  if (askId !== baseAsk || !S.view || level !== levelFor(S.view.span())) return;
  S.basesLevel = level;
  S.bases = bases;
  colourBases();
}

/** The bases' squares, the chosen survivor's tribe's in green. */
export function colourBases(): void {
  const team = S.people?.survivors.find((r) => r.pid === S.chosen)?.team ?? 0;
  S.squares = S.head ? baseSquares(S.head.dims, S.bases, palette, team) : [];
  drawMap();
}

let basesTimer: ReturnType<typeof setTimeout> | undefined;
/** Asks for the bases again once the zoom has settled, if it wants cells of another size. */
function soonBases(): void {
  clearTimeout(basesTimer);
  basesTimer = setTimeout(() => S.view && levelFor(S.view.span()) !== S.basesLevel && void pollBases().catch(() => {}), 300);
}

let queued = false;
export function drawMap(): void {
  if (queued || !mapView()) return;
  queued = true;
  requestAnimationFrame(paint);
}

function paint(): void {
  queued = false;
  const { view: v, head, hf, frame } = S;
  if (!v || !head || !hf) return;
  const density = Math.min(devicePixelRatio, 2);
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.fillStyle = "#e0e9ef";
  ctx.fillRect(0, 0, v.width, v.height);
  const [left, top, right, bottom] = [Math.max(0, v.sx(hf.sizeX)), Math.max(0, v.sy(hf.sizeZ)), Math.min(v.width, v.sx(0)), Math.min(v.height, v.sy(0))];
  if (S.ground) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    const e = pictureExtent(hf);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(S.ground, v.sx(e.west), v.sy(e.north), e.side * v.scale, e.side * v.scale);
    ctx.restore();
  }
  const grid = gridLines(head.dims, v);
  ctx.font = `12px ${FACE}`;
  for (const l of grid.lon) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.23 : 0.12})`;
    ctx.fillRect(Math.round(l.at), top, 1, bottom - top);
    if (l.numbered && l.at < v.width - 62) label(ctx, String(l.k), l.at + 3, top + 13, "#dbe8f3");
  }
  for (const l of grid.lat) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.23 : 0.12})`;
    ctx.fillRect(left, Math.round(l.at), right - left, 1);
    if (l.numbered && l.at - top > 16) label(ctx, String(l.k), left + 3, l.at + 13, "#dbe8f3");
  }
  drawStreets();
  if (frame.live && enabled("bases") && S.basesLevel === levelFor(v.span())) {
    for (const q of S.squares) {
      const s = Math.max(1.5, q.size * v.scale);
      ctx.fillStyle = `#${q.colour.toString(16).padStart(6, "0")}`;
      ctx.fillRect(v.sx(q.x + q.size), v.sy(q.z + q.size), s, s);
    }
  }
  const seen = frame.dots.filter(onMap);
  const mapSites = drawSites(seen);
  drawEvents();
  if (enabled("trails")) track();
  const item = S.item;
  const holders = item ? S.recall.holdersFor(item.item, item.quality, item.blueprint, S.timeline) : null;
  const holding = holders ? holdingAt(holders.holders, frame.live ? S.timeline.to : frame.at, S.timeline.to) : null;
  for (const d of seen) {
    const [x, y] = [v.sx(d.x), v.sy(d.z)];
    if (enabled("trails") && d.tail && d.tail.length > 2) {
      ctx.beginPath();
      for (let i = 0; i < d.tail.length; i += 2) ctx.lineTo(v.sx(d.tail[i]!), v.sy(d.tail[i + 1]!));
      ctx.strokeStyle = d.pid === S.chosen ? "rgba(169,214,242,0.9)" : "rgba(238,247,255,0.45)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, d.state === DOT_OFFLINE ? 3 : 5, 0, Math.PI * 2);
    ctx.fillStyle = FILL[d.state] ?? INK;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = d.state === DOT_SPECTATING ? ICE : d.riding ? WARN : "rgba(4,10,18,0.85)";
    ctx.stroke();
    if (holding?.has(d.pid)) ring(x, y, 9, WARN);
    if (d.pid === S.chosen) ring(x, y, 12, ICE);
  }
  drawNames(seen, mapSites, top, left);
  ctx.strokeStyle = "rgba(40,70,96,0.32)";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(v.sx(hf.sizeX)) + 0.5, Math.round(v.sy(hf.sizeZ)) + 0.5, Math.round(hf.sizeX * v.scale), Math.round(hf.sizeZ * v.scale));
  const loading = !frame.live && !S.recall.windowFor(S.timeline) ? " · loading" : "";
  $("when").dataset.live = String(frame.live);
  $("when").textContent = frame.at === 0 ? "Connecting" : frame.live ? `Live · ${clockText(frame.at, offset, true)}` : `Replay · ${momentText(frame.at, offset)}${loading}`;
  const measure = 78 / v.scale;
  $("map-scale").textContent = measure < 1000 ? `${Math.round(measure)} m` : `${(measure / 1000).toFixed(1)} km`;
}

interface MapSite { name: string; x: number; z: number; kind: "district" | "landmark" | "spawn" | "obelisk"; color?: string }
const eyeColour: Record<string, string> = { blue: "#83c8ff", red: "#ff928d", green: "#8fe0b5" };
let sites: MapSite[] = [];
let sectors: MapPart[] = [];
let partBase: URL | null = null;
const streets = new Map<string, readonly Stretch[]>();
const pending = new Set<string>();
let streetTimer: ReturnType<typeof setTimeout> | undefined;

interface PointName { x: number; y: number; text: string; colour: string; priority: number }
const pointIn = (v: MapWindow, x: number, y: number): boolean => x >= 7 && x <= v.width - 7 && y >= 7 && y <= v.height - 7;

function drawSites(dots: readonly Dot[]): PointName[] {
  if (!enabled("places")) return [];
  const v = S.view!;
  const names: PointName[] = [];
  for (const s of sites) {
    const x = v.sx(s.x), y = v.sy(s.z);
    if (!pointIn(v, x, y) || (s.kind === "spawn" && v.scale < 0.15)) continue;
    const size = s.kind === "obelisk" ? 5 : s.kind === "district" ? 0 : 3;
    const nearSurvivor = dots.some((d) => Math.hypot(x - v.sx(d.x), y - v.sy(d.z)) < 9);
    const colour = s.color ? eyeColour[s.color] ?? ICE : s.kind === "district" ? "#f2e4c4" : INK;
    if (size && !nearSurvivor) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = colour;
      ctx.fillRect(-size, -size, 2 * size, 2 * size);
      ctx.strokeStyle = "#07121e";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-size, -size, 2 * size, 2 * size);
      ctx.restore();
    }
    if (!nearSurvivor || s.kind === "obelisk") names.push({ x, y, text: s.name, colour, priority: s.kind === "obelisk" ? 3 : s.kind === "landmark" ? 2 : 1 });
  }
  return names;
}

function drawNames(dots: readonly Dot[], names: PointName[], top: number, left: number): void {
  const v = S.view!;
  const edge = { left: 7, top: 7, right: v.width - 7, bottom: v.height - 7 };
  const occupied: LabelBox[] = [
    { left: v.width - 58, top: 0, right: v.width, bottom: 139 },
    { left: 0, top: v.height - 38, right: v.width, bottom: v.height },
    { left: 0, top, right: v.width, bottom: top + 16 },
    { left, top, right: left + 23, bottom: v.height },
  ];
  const show = enabled("names");
  for (const d of dots) {
    const x = v.sx(d.x), y = v.sy(d.z);
    occupied.push({ left: x - 8, top: y - 7, right: x + 8, bottom: y + 7 });
    if (!pointIn(v, x, y) || (d.pid !== S.chosen && (!show || d.state === DOT_OFFLINE))) continue;
    const text = v.scale >= 0.12 && d.riding ? `${d.name} · ${S.labels[d.riding] ?? idWords(d.riding)}` : d.name;
    names.push({ x, y, text, colour: d.pid === S.chosen ? ICE : INK, priority: d.pid === S.chosen ? 5 : 4 });
  }
  names.sort((a, b) => b.priority - a.priority);
  const fit = v.scale < 0.065;
  const crowd = Math.max(2, Math.floor(v.width * v.height / (fit ? 63_000 : 33_000)));
  let minor = 0;
  ctx.font = `600 12px ${FACE}`;
  for (const name of names) {
    if (name.priority === 1 && (minor >= crowd || (fit && occupied.some((b) => b.left > name.x - 56 && b.right < name.x + 56 && b.top > name.y - 24 && b.bottom < name.y + 24)))) continue;
    const pos = mapLabelBox(name.x, name.y, ctx.measureText(name.text).width, edge, occupied);
    if (!pos) continue;
    occupied.push(pos);
    if (name.priority === 1) minor++;
    label(ctx, name.text, pos.left + 4, pos.top + 13, name.colour);
  }
}

function fillPlaces(): void {
  const pick = $<HTMLSelectElement>("place-pick");
  pick.replaceChildren(new Option("Select a place"));
  for (const [i, site] of sites.entries()) pick.add(new Option(site.name, String(i)));
  pick.options[0]!.value = "";
  drawMap();
}

function wantStreets(): void {
  clearTimeout(streetTimer);
  streetTimer = setTimeout(() => {
    const { head, view } = S;
    if (!enabled("streets") || !head || !view || !partBase || view.scale < 0.045) return;
    sectors = streetsInView(head, view, 18);
    drawMap();
    for (const part of sectors) {
      if (pending.size >= 5) break;
      if (streets.has(part.name) || pending.has(part.name)) continue;
      pending.add(part.name);
      const url = new URL(part.name, partBase);
      void fetch(url).then(async (r) => {
        if (!r.ok) throw Error(String(r.status));
        const piece = readPart(head, part, new Uint8Array(await r.arrayBuffer()));
        if (piece.kind === "streets") streets.set(part.name, piece.part.stretches);
        while (streets.size > 42) streets.delete(streets.keys().next().value!);
      }).catch(() => {
        streets.set(part.name, []);
      }).finally(() => {
        pending.delete(part.name);
        drawMap();
        wantStreets();
      });
    }
  }, 100);
}

function drawStreets(): void {
  const v = S.view!;
  if (!enabled("streets") || v.scale < 0.045) return;
  ctx.lineWidth = Math.max(0.6, Math.min(1.8, v.scale * 3));
  ctx.strokeStyle = "rgba(88,100,111,0.40)";
  ctx.beginPath();
  const seen = new Set<string>();
  for (const part of sectors) for (const street of streets.get(part.name) ?? []) {
    const line = street.xz;
    const id = `${street.seed}:${line[0]}:${line[1]}:${line.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ctx.moveTo(v.sx(line[0]!), v.sy(line[1]!));
    for (let k = 2; k < line.length; k += 2) ctx.lineTo(v.sx(line[k]!), v.sy(line[k + 1]!));
  }
  ctx.stroke();
}

let eventDots: { x: number; y: number; at: number; pid: number }[] = [];

function drawEvents(): void {
  eventDots = [];
  const v = S.view!, t = S.timeline, w = S.recall.windowFor(t);
  if (!enabled("events") || !w) return;
  const tracks = new Map(w.positions.tracks.map((track) => [track.pid, track]));
  for (const mark of w.marks.slice(-160)) {
    if (mark.wall < t.start || mark.wall > Math.min(t.end, t.at)) continue;
    const track = tracks.get(mark.pid);
    if (!track) continue;
    const k = sampleBefore(track.wall, mark.wall);
    const gap = w.step * 2.5;
    const distance = Math.min(mark.wall - (track.wall[k] ?? -Infinity), (track.wall[k + 1] ?? Infinity) - mark.wall);
    const spot = distance <= gap ? placeAt(track, mark.wall, gap) : null;
    if (!spot) continue;
    const x = v.sx(spot.x), y = v.sy(spot.z);
    if (x < 0 || y < 0 || x > v.width || y > v.height) continue;
    eventDots.push({ x, y, at: mark.wall, pid: mark.pid });
    ctx.strokeStyle = mark.kind === "death" ? BAD : WARN;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x - 3, y - 3, 6, 6);
  }
}

function ring(x: number, y: number, r: number, colour: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** The chosen survivor's track through the window, the stretch up to the playhead brighter; broken where it was away. */
function track(): void {
  const c = S.recall.chosenFor(S.chosen, S.timeline);
  const tr = c?.pid === S.chosen ? c.track.tracks[0] : undefined;
  if (!tr || !S.view) return;
  const gap = c!.track.step * 2.5;
  const at = S.frame.live ? Infinity : S.frame.at;
  for (const [upTo, colour] of [[Infinity, "rgba(143,217,196,0.35)"], [at, "rgba(143,217,196,0.95)"]] as const) {
    ctx.beginPath();
    for (let k = 0; k < tr.wall.length && tr.wall[k]! <= upTo; k++) {
      const [x, y] = [S.view.sx(tr.x[k]!), S.view.sy(tr.z[k]!)];
      if (k > 0 && tr.wall[k]! - tr.wall[k - 1]! > gap) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function onMap(d: Dot): boolean {
  const v = S.view!;
  const [x, y] = [v.sx(d.x), v.sy(d.z)];
  return x > -40 && y > -20 && x < v.width + 40 && y < v.height + 20;
}

function sizeMap(): void {
  const r = box.getBoundingClientRect();
  const density = Math.min(devicePixelRatio, 2);
  [canvas.width, canvas.height] = [Math.round(r.width * density), Math.round(r.height * density)];
  S.view?.resize(r.width, r.height);
  drawMap();
  wantStreets();
}

/** The map's head and overviews, its window, and once the first frame is up, the ground's picture. */
export async function loadMap(api: (path: string) => string, camera: Investigation["camera"]): Promise<void> {
  $("loading").hidden = false;
  const named = (await (await ask("../map.json")).json()) as { head: string };
  const url = api("../" + named.head);
  partBase = new URL(".", url);
  const got = await loadGround(async (part) => {
    const r = await fetch(part);
    if (!r.ok) throw new Error(`${new URL(part).pathname} answered ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }, url);
  S.head = got.head;
  S.hf = got.hf;
  S.view = new MapWindow(got.hf);
  sizeMap();
  if (camera) S.view.look(camera.x, camera.z, camera.zoom);
  else {
    const selected = S.frame.dots.find((d) => d.pid === S.chosen);
    if (selected) lookAt(selected.x, selected.z);
  }
  const title = (name: string): string => idWords(name).replace(/[-_]/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
  sites = [
    ...(got.head.tideEyes ?? []).map((s) => ({ ...s, name: `${s.name} obelisk`, kind: "obelisk" as const })),
    ...(got.head.landmarks ?? []).map((s) => ({ ...s, name: title(s.name), kind: "landmark" as const })),
    ...got.head.spawns.map((s) => ({ ...s, name: `${s.name} spawn`, kind: "spawn" as const })),
  ];
  fillPlaces();
  void ask("map-context.json").then((r) => r.json() as Promise<{ districts: Omit<MapSite, "kind">[] }>).then(({ districts }) => {
    sites = [...sites.filter((s) => s.kind !== "spawn"), ...districts.map((s) => ({ ...s, kind: "district" as const })), ...sites.filter((s) => s.kind === "spawn")];
    fillPlaces();
  }).catch(() => {});
  await new Promise((done) => requestAnimationFrame(done));
  const rgba = groundPicture(got.hf, paperPalette(palette), Math.min(1152, pictureSide(got.hf)));
  const side = Math.sqrt(rgba.length / 4);
  S.ground = document.createElement("canvas");
  [S.ground.width, S.ground.height] = [side, side];
  S.ground.getContext("2d")!.putImageData(new ImageData(rgba, side, side), 0, 0);
  $("loading").hidden = true;
  hooks.showPeople();
  void pollBases().catch(() => {});
  wantStreets();
}

/** Puts a place at the map's middle, nearer if the map shows more than a few kilometres. */
export function lookAt(x: number, z: number): void {
  if (S.view && Number.isFinite(x) && Number.isFinite(z)) S.view.look(x, z, Math.max(S.view.scale, 0.15));
  moved();
}

function moved(): void {
  drawMap();
  soonBases();
  wantStreets();
  hooks.stateChanged();
}

$("place-pick").addEventListener("change", () => {
  const key = $<HTMLSelectElement>("place-pick").value;
  const site = key === "" ? undefined : sites[Number(key)];
  if (site) lookAt(site.x, site.z);
});
$("streets").addEventListener("change", wantStreets);
box.addEventListener("keydown", (e) => {
  const v = S.view;
  if (!v || e.target !== box || e.ctrlKey || e.metaKey || e.altKey) return;
  const pan = e.shiftKey ? 128 : 48;
  switch (e.key) {
    case "ArrowUp": v.pan(0, pan); break;
    case "ArrowDown": v.pan(0, -pan); break;
    case "ArrowLeft": v.pan(pan, 0); break;
    case "ArrowRight": v.pan(-pan, 0); break;
    case "=":
    case "+": v.zoomAt(1.6, v.width / 2, v.height / 2); break;
    case "-": v.zoomAt(1 / 1.6, v.width / 2, v.height / 2); break;
    case "0": v.fit(); break;
    default: return;
  }
  e.preventDefault();
  moved();
});

const pointers = new Map<number, { x: number; y: number }>();
let travel = 0;
const at = (e: MouseEvent): [number, number] => {
  const r = box.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
box.addEventListener("pointerdown", (e) => {
  box.setPointerCapture(e.pointerId);
  const [x, y] = at(e);
  pointers.set(e.pointerId, { x, y });
  travel = 0;
  box.classList.add("dragging");
});
box.addEventListener("pointermove", (e) => {
  const [x, y] = at(e);
  const v = S.view;
  if (v && S.head) $("readout").textContent = latLonText(latOf(S.head.dims, v.worldZ(y)), lonOf(S.head.dims, v.worldX(x)));
  const p = pointers.get(e.pointerId);
  if (!p || !v) return;
  const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
  if (other) {
    const was = Math.hypot(p.x - other.x, p.y - other.y), now = Math.hypot(x - other.x, y - other.y);
    if (was > 0) v.zoomAt(now / was, (x + other.x) / 2, (y + other.y) / 2);
  } else v.pan(x - p.x, y - p.y);
  travel += Math.abs(x - p.x) + Math.abs(y - p.y);
  [p.x, p.y] = [x, y];
  drawMap();
});
box.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  box.classList.remove("dragging");
  if (!S.view || pointers.size) return;
  if (travel > 6) return moved();
  const [x, y] = at(e);
  const d = dotAt(S.frame, (d) => [S.view!.sx(d.x), S.view!.sy(d.z)], x, y, 14);
  if (d) return hooks.chooseSurvivor(d.pid, false);
  const event = eventDots.findLast((p) => Math.hypot(p.x - x, p.y - y) <= 8);
  if (event) {
    hooks.chooseSurvivor(event.pid, false);
    hooks.seek(event.at);
  }
});
box.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) box.classList.remove("dragging");
  moved();
});
box.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const [x, y] = at(e);
    S.view?.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), x, y);
    moved();
  },
  { passive: false },
);
box.addEventListener("dblclick", (e) => {
  const [x, y] = at(e);
  S.view?.zoomAt(2, x, y);
  moved();
});
for (const [id, factor] of [["zin", 1.6], ["zout", 1 / 1.6], ["zfit", 0]] as const) {
  $(id).addEventListener("pointerdown", (e) => e.stopPropagation());
  $(id).addEventListener("click", () => {
    if (!S.view) return;
    if (factor === 0) S.view.fit();
    else S.view.zoomAt(factor, S.view.width / 2, S.view.height / 2);
    moved();
  });
}
$("bases").addEventListener("change", () => void pollBases().then(drawMap, drawMap));
new ResizeObserver(sizeMap).observe(box);
