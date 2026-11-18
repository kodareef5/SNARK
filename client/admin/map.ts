// The admin page's map: the ground painted once from the map file's overviews, the grid, the tribes' bases, and the frame
// of survivors (now, or the playhead's moment with where each had just been), with the chosen survivor's track and who
// held the chosen item. It moves under one pointer, zooms under two or the wheel, and a tap chooses a survivor.

import { latLonText, latOf, lonOf } from "../../shared/world/coords.ts";
import { levelFor } from "../../shared/world/tactical.ts";
import { baseSquares, readBases } from "../core/admin/bases.ts";
import { clockText, momentText } from "../core/admin/chart.ts";
import { idWords } from "../core/admin/format.ts";
import { DOT_AWAY, DOT_DEAD, DOT_OFFLINE, DOT_OUT, DOT_SPECTATING, dotAt, type Dot } from "../core/admin/frame.ts";
import { groundPicture, loadGround, pictureExtent } from "../core/admin/ground.ts";
import { holdingAt } from "../core/admin/recall.ts";
import { MapWindow, gridLines } from "../core/admin/view.ts";
import { $, BAD, FACE, ICE, INK, S, WARN, ask, hooks, label, offset, palette } from "./dom.ts";

const box = $("map"), canvas = $<HTMLCanvasElement>("mapcanvas"), ctx = canvas.getContext("2d")!;
const FILL: Readonly<Record<number, string>> = { [DOT_OFFLINE]: "rgba(170,188,204,0.6)", [DOT_DEAD]: BAD, [DOT_OUT]: WARN, [DOT_SPECTATING]: "rgba(0,0,0,0)", [DOT_AWAY]: "rgba(150,170,190,0.75)" };

export async function pollBases(): Promise<void> {
  if (!S.view || !$<HTMLInputElement>("bases").checked) return;
  S.basesLevel = levelFor(S.view.span());
  S.bases = readBases(new Uint8Array(await (await ask(`bases.bin?level=${S.basesLevel}`)).arrayBuffer())) ?? [];
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
  if (queued) return;
  queued = true;
  requestAnimationFrame(paint);
}

function paint(): void {
  queued = false;
  const { view: v, head, hf, frame } = S;
  if (!v || !head || !hf) return;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = "#0a1522";
  ctx.fillRect(0, 0, v.width, v.height);
  if (S.ground) {
    const e = pictureExtent(hf);
    ctx.imageSmoothingEnabled = v.scale * hf.cell < 3;
    ctx.drawImage(S.ground, v.sx(e.west), v.sy(e.north), e.side * v.scale, e.side * v.scale);
  }
  const [left, top, right, bottom] = [Math.max(0, v.sx(hf.sizeX)), Math.max(0, v.sy(hf.sizeZ)), Math.min(v.width, v.sx(0)), Math.min(v.height, v.sy(0))];
  const grid = gridLines(head.dims, v);
  ctx.font = `12px ${FACE}`;
  for (const l of grid.lon) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.42 : 0.2})`;
    ctx.fillRect(Math.round(l.at), top, 1, bottom - top);
    if (l.numbered) label(ctx, String(l.k), l.at + 3, top + 13, "#dbe8f3");
  }
  for (const l of grid.lat) {
    ctx.fillStyle = `rgba(4,10,18,${l.sector ? 0.42 : 0.2})`;
    ctx.fillRect(left, Math.round(l.at), right - left, 1);
    if (l.numbered && l.at - top > 16) label(ctx, String(l.k), left + 3, l.at + 13, "#dbe8f3");
  }
  if ($<HTMLInputElement>("bases").checked) {
    for (const q of S.squares) {
      const s = Math.max(1.5, q.size * v.scale);
      ctx.fillStyle = `#${q.colour.toString(16).padStart(6, "0")}`;
      ctx.fillRect(v.sx(q.x + q.size), v.sy(q.z + q.size), s, s);
    }
  }
  track();
  const holding = S.item && S.recall.holders ? holdingAt(S.recall.holders.holders, frame.live ? S.timeline.to : frame.at, S.timeline.to) : null;
  const seen = frame.dots.filter((d) => onMap(d));
  const names = $<HTMLInputElement>("names").checked;
  const crowded = seen.filter((d) => d.state !== DOT_OFFLINE).length > 60;
  for (const d of seen) {
    const [x, y] = [v.sx(d.x), v.sy(d.z)];
    if (d.tail && d.tail.length > 2) {
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
    if (d.pid === S.chosen || (names && d.state !== DOT_OFFLINE && !crowded)) label(ctx, d.riding ? `${d.name}, ${S.labels[d.riding] ?? idWords(d.riding)}` : d.name, x + 9, y + 4, d.pid === S.chosen ? ICE : INK);
  }
  ctx.strokeStyle = "rgba(206,230,250,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(v.sx(hf.sizeX)) + 0.5, Math.round(v.sy(hf.sizeZ)) + 0.5, Math.round(hf.sizeX * v.scale), Math.round(hf.sizeZ * v.scale));
  const loading = !frame.live && !S.recall.window ? ", reading the log" : "";
  $("when").innerHTML = frame.live ? `<b>&#9679;</b> live, ${clockText(frame.at || Date.now(), offset, true)}` : `<b class="past">&#9632;</b> ${momentText(frame.at, offset)}${loading}`;
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
  const c = S.recall.chosen;
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
  [canvas.width, canvas.height] = [Math.round(r.width * devicePixelRatio), Math.round(r.height * devicePixelRatio)];
  S.view?.resize(r.width, r.height);
  drawMap();
}

/** The map's head and overviews, its window, and once the first frame is up, the ground's picture. */
export async function loadMap(): Promise<void> {
  const named = (await (await ask("../map.json")).json()) as { head: string };
  // A map's parts are named by their hash, so the browser keeps them.
  const got = await loadGround(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }, `../${named.head}`);
  S.head = got.head;
  S.hf = got.hf;
  S.view = new MapWindow(got.hf);
  sizeMap();
  await new Promise((done) => requestAnimationFrame(done));
  const rgba = groundPicture(got.hf, palette);
  const side = Math.sqrt(rgba.length / 4);
  S.ground = document.createElement("canvas");
  [S.ground.width, S.ground.height] = [side, side];
  S.ground.getContext("2d")!.putImageData(new ImageData(rgba, side, side), 0, 0);
  $("loading").hidden = true;
  hooks.showPeople();
  void pollBases().catch(() => {});
}

/** Puts a place at the map's middle, nearer if the map shows more than a few kilometres. */
export function lookAt(x: number, z: number): void {
  if (S.view && Number.isFinite(x)) S.view.look(x, z, Math.max(S.view.scale, 0.15));
  drawMap();
}

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
  if (travel > 6 || !S.view) return void soonBases();
  const [x, y] = at(e);
  const d = dotAt(S.frame, (d) => [S.view!.sx(d.x), S.view!.sy(d.z)], x, y, 14);
  if (d) hooks.chooseSurvivor(d.pid, false);
});
box.addEventListener("pointercancel", (e) => pointers.delete(e.pointerId));
box.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const [x, y] = at(e);
    S.view?.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), x, y);
    drawMap();
    soonBases();
  },
  { passive: false },
);
box.addEventListener("dblclick", (e) => {
  const [x, y] = at(e);
  S.view?.zoomAt(2, x, y);
  drawMap();
  soonBases();
});
for (const [id, factor] of [["zin", 1.6], ["zout", 1 / 1.6], ["zfit", 0]] as const) {
  $(id).addEventListener("pointerdown", (e) => e.stopPropagation());
  $(id).addEventListener("click", () => {
    if (!S.view) return;
    if (factor === 0) S.view.fit();
    else S.view.zoomAt(factor, S.view.width / 2, S.view.height / 2);
    drawMap();
    soonBases();
  });
}
$("bases").addEventListener("change", () => void pollBases().then(drawMap, drawMap));
new ResizeObserver(sizeMap).observe(box);
