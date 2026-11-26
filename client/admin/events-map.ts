import { adminContext } from "./shell.ts";
// The events page's map: the world's relief, as the drops page draws it, with the survivors, what is live (each craft's
// path and where it is now, where one came to rest, sites and crates), and what an event of a kind called now with a
// seed would make. A path is the server's (preview.json), drawn with the code every party flies it by.

import { esc } from "../core/admin/format.ts";
import { pathRuns, pathWords, eventWords } from "../core/admin/events.ts";
import { toPixel, type WorldSize } from "../core/drops/place.ts";
import { S, ask, type PreviewWire } from "./events.ts";

const side = (): number => 860 * S.zoom;
const HIGH = "#a9d6f2";
const LOW = "#ecb048";
const SITE = "#b79cf0";
const CRATE = "#8fd9c4";
const SHIELD: Readonly<Record<string, string>> = { closed: "#a9d6f2", open: "#ecb048", broken: "#ec6a52", none: "#93a9bd" };

export function mapHtml(): string {
  const p = S.preview, live = S.live;
  const kinds = S.wire!.kinds;
  const choose = `<select id="mapKind">${kinds.map((k) => `<option value="${esc(k.id)}"${k.id === S.kind ? " selected" : ""}>${esc(k.label)}</option>`).join("")}</select>`;
  const made = p
    ? `<div class="sub" style="margin-top:10px">Seed ${p.seed}</div>
      ${p.crafts.map((c) => `<div>${esc(c.name)}: ${esc(pathWords(c.points, c.seconds))}</div>`).join("")}
      ${p.sites.length + p.crates.length > 0 ? `<div>${p.sites.length} sites and ${p.crates.length} crates as it comes</div>` : ""}
      ${p.crafts.length + p.sites.length + p.crates.length === 0 ? '<div class="dim">nothing to draw: this kind makes no part as it is called</div>' : ""}
      ${p.notices.map((n) => `<div class="dim">says: “${esc(n)}”</div>`).join("")}
      <div class="dim">${p.near.length === 0 ? "nobody is in the world: it is put where its kind puts it with nobody near" : `put near ${p.near.length === 1 ? "the survivor" : `the ${p.near.length} survivors`} in the world now`}, coming ${p.notice} s after it is called</div>
      <div class="row" style="margin-top:6px"><button data-do="callseed" class="go" title="Called now with this seed. It makes this while the survivors stand where they do now.">Call this one</button></div>`
    : '<p class="dim">Give a seed, or draw a new one, to see what an event of this kind called now would make.</p>';
  const events = live ? live.events.filter((e) => e.state !== "ended").map((e) => `<div>${e.id}: ${esc(e.kind)}, ${esc(eventWords(e))}</div>`).join("") : "";
  return `<section class="glass"><div class="row"><h2>Map</h2><span class="dim">the relief, the survivors, what is live, and what a seed would make</span><span class="grow"></span>
      <label>zoom <select id="mapZoom">${[1, 2, 4].map((z) => `<option${z === S.zoom ? " selected" : ""}>${z}</option>`).join("")}</select></label><button data-do="relive">Read what is live</button></div>
    <div class="mapgrid"><div class="mapbox"><canvas id="map" width="${side()}" height="${side()}" style="width:${side()}px;height:${side()}px"></canvas></div>
    <div><div class="sub">What a seed would make</div><div class="row">${choose}<input id="seed" style="width:130px" value="${S.seed ?? ""}" placeholder="a whole number"><button data-do="preview">Draw</button><button data-do="newseed">New seed</button></div>${made}
      <div class="sub" style="margin-top:12px">Key</div><div class="key"><div><i style="background:${HIGH}"></i>a craft's path</div><div><i style="background:${LOW};height:5px"></i>a low pass, its beam on</div>
      <div><i style="background:#8fd9c4;height:8px;width:8px"></i>where it comes in · <i style="background:#ec6a52;height:8px;width:8px"></i>where it leaves</div><div><i style="background:#ffffff;height:6px;width:6px"></i>a survivor</div>
      <div><i style="background:${SITE};height:8px;width:8px"></i>a site · <i style="background:${CRATE};height:8px;width:8px"></i>a crate</div>
      <div><i style="background:rgba(169,214,242,0.45)"></i>a live craft's path, and its disc where it is now: pale with its shield shut, amber open, red broken; a red cross where one came to rest</div></div>
      ${live ? `<div class="sub" style="margin-top:12px">Live now</div>${events || '<span class="dim">no events</span>'}` : ""}</div></div></section>`;
}

type Points = readonly { x: number; z: number; low: boolean; y: number; speed: number }[];

/** Draws a path's runs, high and low in their colours, in `alpha`. */
function drawPath(g: CanvasRenderingContext2D, w: WorldSize, points: Points, alpha: number, width: number): void {
  const s = side();
  g.globalAlpha = alpha;
  g.lineJoin = "round";
  for (const run of pathRuns(points)) {
    g.strokeStyle = run.low ? LOW : HIGH;
    g.lineWidth = run.low ? width + 1.5 : width;
    g.beginPath();
    run.line.forEach(([x, z], k) => {
      const [px, py] = toPixel(w, x, z, s);
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
  }
  g.globalAlpha = 1;
  g.lineWidth = 1;
}

const dot = (g: CanvasRenderingContext2D, px: number, py: number, r: number, fill: string): void => {
  g.fillStyle = "#08111c";
  g.beginPath();
  g.arc(px, py, r + 1.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(px, py, r, 0, Math.PI * 2);
  g.fill();
};

const square = (g: CanvasRenderingContext2D, px: number, py: number, r: number, colour: string, filled: boolean): void => {
  g.fillStyle = "#08111c";
  g.fillRect(px - r - 1.5, py - r - 1.5, 2 * r + 3, 2 * r + 3);
  g.strokeStyle = colour;
  g.lineWidth = 2;
  g.strokeRect(px - r, py - r, 2 * r, 2 * r);
  if (filled) {
    g.fillStyle = colour;
    g.fillRect(px - r / 2, py - r / 2, r, r);
  }
  g.lineWidth = 1;
};

/** Paints the map: the relief, the survivors, what is live and where, and what the seed drawn would make. */
export function mapDraw(): void {
  const canvas = document.getElementById("map") as HTMLCanvasElement | null;
  const live = S.live;
  if (!canvas || !live) return;
  const g = canvas.getContext("2d")!, s = side();
  const w = { sizeX: live.size[0], sizeZ: live.size[1] };
  g.fillStyle = "#0b1622";
  g.fillRect(0, 0, s, s);
  if (S.terrain) {
    g.imageSmoothingEnabled = S.zoom === 1;
    g.drawImage(S.terrain, 0, 0, s, s);
  }
  for (const e of live.events) {
    if (e.state === "ended") continue;
    for (const p of e.parts) {
      const [px, py] = toPixel(w, p.x, p.z, s);
      if (p.type === "site") square(g, px, py, 5, SITE, true);
      else if (p.type === "crate") square(g, px, py, 4, CRATE, true);
      else {
        if (p.points && (p.state === "coming" || p.state === "flying")) drawPath(g, w, p.points, 0.45, 1.5);
        if (p.state === "flying" || p.state === "falling") {
          dot(g, px, py, 7, p.state === "falling" ? "#ec6a52" : (SHIELD[p.shield ?? "none"] ?? "#93a9bd"));
          g.fillStyle = "#08111c";
          g.font = "bold 10px sans-serif";
          g.textAlign = "center";
          g.fillText(String(e.id), px, py + 3.5);
        } else if (p.state === "rest") {
          g.strokeStyle = "#ec6a52";
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(px - 8, py - 8);
          g.lineTo(px + 8, py + 8);
          g.moveTo(px + 8, py - 8);
          g.lineTo(px - 8, py + 8);
          g.stroke();
          g.lineWidth = 1;
        }
      }
    }
  }
  const p = S.preview;
  if (p && p.kind === S.kind) {
    for (const c of p.crafts) {
      if (c.points.length < 2) continue;
      drawPath(g, w, c.points, 1, 2.5);
      for (const q of c.points) {
        const [px, py] = toPixel(w, q.x, q.z, s);
        g.fillStyle = q.low ? LOW : HIGH;
        g.fillRect(px - 2.5, py - 2.5, 5, 5);
      }
      const first = c.points[0]!, last = c.points[c.points.length - 1]!;
      dot(g, ...toPixel(w, first.x, first.z, s), 6, "#8fd9c4");
      dot(g, ...toPixel(w, last.x, last.z, s), 6, "#ec6a52");
    }
    for (const site of p.sites) square(g, ...toPixel(w, site.x, site.z, s), 5, SITE, false);
    for (const crate of p.crates) square(g, ...toPixel(w, crate.x, crate.z, s), 4, CRATE, false);
  }
  for (const v of live.survivors) dot(g, ...toPixel(w, v.x, v.z, s), 3, "#ffffff");
}

/** The relief picture, once. */
export async function readTerrain(): Promise<void> {
  if (S.terrain) return;
  const r = await fetch((await adminContext()).api("terrain.rgba"), { cache: "no-store" });
  if (!r.ok) return;
  const bytes = new Uint8ClampedArray(await r.arrayBuffer());
  const n = Math.round(Math.sqrt(bytes.length / 4));
  const c = document.createElement("canvas");
  [c.width, c.height] = [n, n];
  c.getContext("2d")!.putImageData(new ImageData(bytes, n, n), 0, 0);
  S.terrain = c;
}

/** What the seed chosen would make, as the server would make it now. */
export async function readPreview(): Promise<void> {
  S.preview = S.seed === null || S.kind === "" ? null : await ask<PreviewWire>(`preview.json?kind=${encodeURIComponent(S.kind)}&seed=${S.seed}`);
}
