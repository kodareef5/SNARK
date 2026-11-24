// What the admin page's files share: finding elements, writing text into HTML, its colours and face, sizing a canvas to
// its box, and the page's state, which each file reads and the entry (admin.ts) fills.

import type { Minutes, Stats, Survivors } from "../../shared/admin.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import type { MapHead } from "../../shared/world/mapfile.ts";
import type { BaseChunk, BaseSquare } from "../core/admin/bases.ts";
import type { InvestigatedItem } from "../core/admin/investigation.ts";
import { SPANS } from "../core/admin/chart.ts";
import type { MapFrame } from "../core/admin/frame.ts";
import { Recall } from "../core/admin/recall.ts";
import type { SortKey } from "../core/admin/table.ts";
import { Timeline } from "../core/admin/timeline.ts";
import type { MapWindow } from "../core/admin/view.ts";
import { adminContext } from "./shell.ts";

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export { esc } from "../core/admin/format.ts";
export const ICE = "#a9d6f2", WARN = "#ecb048", BAD = "#ec6a52", WELL = "#8fd9c4", INK = "#eef7ff", DIM = "#93a9bd";
export const FACE = '"Barlow Semi Condensed", system-ui, sans-serif';
/** Minutes the reader's clock is behind UTC. */
export const offset = new Date().getTimezoneOffset();
export const palette = defaultPalette();

/** Sizes a canvas's pixels to its box at the screen's density, and gives its context drawing in CSS pixels. */
export function fit(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio;
  [c.width, c.height] = [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

/** Text with a dark edge, readable over the map or a chart. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  g.lineWidth = 3;
  g.strokeStyle = "rgba(4,10,18,0.8)";
  g.strokeText(text, x, y);
  g.fillStyle = colour;
  g.fillText(text, x, y);
}

/** Fetches a path under /admin/, fresh, and fails on anything but success. */
export async function ask(path: string): Promise<Response> {
  const r = await fetch((await adminContext()).api(path), { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}: ${await r.text()}`);
  return r;
}

/** The page's state. */
export const S = {
  page: "",
  stats: null as Stats | null,
  minutes: null as Minutes | null,
  people: null as Survivors | null,
  answeredAt: 0,
  head: null as MapHead | null,
  hf: null as Heightfield | null,
  ground: null as HTMLCanvasElement | null,
  view: null as MapWindow | null,
  bases: [] as BaseChunk[],
  squares: [] as BaseSquare[],
  basesLevel: -1,
  /** The chosen survivor's record id, 0 for none. */
  chosen: 0,
  sort: "seen" as SortKey,
  span: SPANS[0]!,
  /** What the map draws: now, or the playhead's moment. */
  frame: { at: 0, live: true, dots: [] } as MapFrame,
  /** The content's names for ids, where they are not the id's words. */
  labels: {} as Record<string, string>,
  timeline: new Timeline(),
  recall: new Recall(async (path) => (await ask(path)).json()),
  /** The item asked about: who held it is drawn on the map. */
  item: null as InvestigatedItem | null,
};

/** What one file asks of another, set by the entry, so the files need not import each other in a ring. */
export const hooks = {
  drawMap: (): void => {},
  showInspector: (): void => {},
  seek: (_at: number): void => {},
  stateChanged: (): void => {},
  mapUrl: (_pid?: number, _at?: number): string => "#",
  showPeople: (): void => {},
  chooseSurvivor: (_pid: number, _look: boolean): void => {},
};

const rendered = new WeakMap<HTMLElement, string>();

export function paintHtml(el: HTMLElement, html: string): void {
  if (rendered.get(el) === html) return;
  const active = document.activeElement;
  const key = el.contains(active) && active instanceof HTMLElement ? active.dataset.focus : undefined;
  el.innerHTML = html;
  rendered.set(el, html);
  if (key) Array.from(el.querySelectorAll<HTMLElement>("[data-focus]")).find((node) => node.dataset.focus === key)?.focus({ preventScroll: true });
}
