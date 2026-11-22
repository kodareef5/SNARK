// The admin's first-frame page (client/admin/first-frame.ts): what a player downloads before the first frame, as the
// build weighed it (tools/first-frame.ts, first-frame.json beside the client). One bar of the budget split into its parts
// and the room left, each map's, the page's script by folder as a second bar, its largest modules in a table, and every
// figure's change against the last build's. Made here as HTML strings; the page's file only fetches and places them.

import { esc } from "./format.ts";

/** first-frame.json, as tools/first-frame.ts writes it. */
export interface Weight { name: string; bytes: number }
export interface ModuleWeight { file: string; bytes: number; raw: number }
export interface FirstFrameJson {
  at: string;
  commit: string;
  clean: boolean | null;
  quick: boolean;
  budget: number;
  total: number;
  room: number;
  parts: (Weight & { files: string[] })[];
  maps: { map: string; total: number; room: number; landmarks: Weight[] }[];
  modules: ModuleWeight[];
  folders: ModuleWeight[];
  previous: { at: string; commit: string; quick: boolean; total: number; parts: Weight[]; maps: { map: string; total: number }[]; modules: ModuleWeight[] } | null;
}

const COLOURS = ["#5aa9e6", "#4fd1c5", "#7bd389", "#f2d23a", "#f2a477", "#e06a6a", "#b48ae6", "#e68ab4", "#a0a8b0", "#8fb8c8"];
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

/** A change of bytes in words, with a class for its colour: "+2.1 KB" in warn, "-0.4 KB" in well, "same" dim. */
export function changeHtml(now: number, was: number | undefined): string {
  if (was === undefined) return "";
  if (now === was) return '<span class="dim">same</span>';
  return `<span class="${now > was ? "warn" : "well"}">${now > was ? "+" : "-"}${kb(Math.abs(now - was))}</span>`;
}

/** A bar of parts on `scale` bytes, each a coloured share with its name in its title, and the room left after them. */
export function barHtml(parts: readonly Weight[], scale: number, room = 0): string {
  const cells = parts.map((p, i) => `<i style="width:${((p.bytes / scale) * 100).toFixed(3)}%;background:${COLOURS[i % COLOURS.length]}" title="${esc(`${p.name}: ${kb(p.bytes)}`)}"></i>`);
  if (room > 0) cells.push(`<i class="room" style="width:${((room / scale) * 100).toFixed(3)}%" title="${esc(`room left: ${kb(room)}`)}"></i>`);
  return `<div class="bar">${cells.join("")}</div>`;
}

/** The page's parts: `summary`, `bar`, `parts`, `maps`, `folders` and `modules`, by the id of the element each fills. */
export function firstFrameView(w: FirstFrameJson, map = ""): Record<string, string> {
  const p = w.previous, m = w.maps.find((x) => x.map === map) ?? null;
  const total = m ? m.total : w.total, room = w.budget - total;
  const parts: Weight[] = [...w.parts, ...(m ? m.landmarks.map((l) => ({ name: `landmark ${l.name}`, bytes: l.bytes })) : [])];
  const over = room < 0;
  const summary = `<b class="${over ? "bad" : room < 16 * 1024 ? "warn" : "well"}">${kb(total)}</b> of ${kb(w.budget)}${m ? ` on ${esc(m.map)}` : " for every map"}, ${over ? `<b class="bad">${kb(-room)} over</b>` : `${kb(room)} left`} ${changeHtml(total, m ? p?.maps.find((x) => x.map === m.map)?.total : p?.total)}`
    + `<br><span class="dim">built ${esc(w.at.slice(0, 16).replace("T", " "))} at ${esc(w.commit.slice(0, 10))}${w.clean === false ? " with changes" : ""}${w.quick ? ", a quick build: its Brotli runs about a tenth over a real build's" : ""}${p ? `; the change is against the build of ${esc(p.at.slice(0, 16).replace("T", " "))}${p.quick ? " (quick)" : ""}` : ""}</span>`;
  const partRows = parts.map((x, i) => `<tr><td><i class="key" style="background:${COLOURS[i % COLOURS.length]}"></i>${esc(x.name)}</td><td>${kb(x.bytes)}</td><td>${((x.bytes / w.budget) * 100).toFixed(1)}%</td><td>${changeHtml(x.bytes, p?.parts.find((y) => y.name === x.name)?.bytes)}</td></tr>`).join("");
  const mapRows = w.maps.map((x) => `<tr><td>${esc(x.map)}</td><td>${kb(x.total)}</td><td class="${x.room < 0 ? "bad" : ""}">${x.room < 0 ? `${kb(-x.room)} over` : `${kb(x.room)} left`}</td><td>${changeHtml(x.total, p?.maps.find((y) => y.map === x.map)?.total)}</td></tr>`).join("");
  const script = w.parts[0]!, folders = w.folders.slice(0, 9), rest = w.folders.slice(9).reduce((n, f) => n + f.bytes, 0);
  const before = new Map((p?.modules ?? []).map((x) => [x.file, x.bytes]));
  const moduleRows = w.modules.slice(0, 40).map((x) => `<tr><td>${esc(x.file)}</td><td>${kb(x.bytes)}</td><td class="dim">${kb(x.raw)}</td><td>${p ? changeHtml(x.bytes, before.get(x.file) ?? 0) : ""}</td></tr>`).join("");
  return {
    summary,
    bar: barHtml(parts, Math.max(w.budget, total), room),
    parts: partRows,
    maps: mapRows,
    folders: barHtml([...folders.map((f) => ({ name: f.file, bytes: f.bytes })), ...(rest > 0 ? [{ name: "the rest", bytes: rest }] : [])], script.bytes) + `<p class="dim">${folders.map((f, i) => `<i class="key" style="background:${COLOURS[i % COLOURS.length]}"></i>${esc(f.file)} ${kb(f.bytes)}`).join(" &nbsp; ")}</p>`,
    modules: moduleRows,
  };
}
