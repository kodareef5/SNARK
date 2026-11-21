// What the drop book's admin page's files share: finding an element, the page's state, saying a line, asking the world
// and telling it, and a field of the draft.

import { esc } from "../core/admin/format.ts";
import { faultsAt, pathText, show, type Kind, type Path } from "../core/drops/edit.ts";
import type { Loaded } from "../core/drops/view.ts";
import type { BookFault, SupplyBook } from "../../shared/supply/book.ts";
import type { Catalog } from "../../shared/supply/catalog.ts";

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** What book.json carries (server/admin/supply-routes.ts). */
export interface BookWire {
  revision: number;
  starter: boolean;
  kept: boolean;
  map: string;
  book: SupplyBook;
  overrides: { tier: string; plain: boolean; ringed: boolean }[];
  settings: { off: boolean; quality: number; random: boolean };
}

/** What live.json carries. */
export interface LiveWire {
  tick: number;
  rate: number;
  revision: number;
  size: [number, number];
  obelisks: { x: number; z: number; eye: number }[];
  drops: { id: number; tier: string; cls: string; ringed: boolean; state: string; x: number; z: number; landed: boolean; opened: boolean; lands: number; left: number; circuit: string; site: string; source: string }[];
  circuits: { key: string; on: boolean; looks: number; why: string; called: number }[];
  calls: number;
  landings: number;
  mended: number;
  acts: { at: number; tick: number; what: string }[];
}

export const TABS = [["tables", "Tables"], ["waiting", "Waiting"], ["sim", "Simulator"], ["tiers", "Tiers and classes"], ["map", "Map and sites"], ["circuits", "Circuits and rules"]] as const;
export type Tab = (typeof TABS)[number][0];

/** The page's state. */
export const S = {
  wire: null as BookWire | null,
  catalog: null as Catalog | null,
  l: null as Loaded | null,
  /** The book being edited: a copy of the book in force until something is changed, and its faults. */
  draft: null as SupplyBook | null,
  faults: [] as BookFault[],
  /** Whether the opened table shows fields, and the revision a save lost to, if one did. */
  editing: false,
  conflict: -1,
  tab: "tables" as Tab,
  /** The table opened in the matrix, and what the simulator rolls. */
  open: "",
  sim: { key: "", ringed: false, n: 5000, seed: 1, designed: false },
  /** The map: the circuit new sites join, the site chosen, the place last clicked, how far it is zoomed, and what is live. */
  map: { circuit: "", site: "", at: null as [number, number] | null, zoom: 1, adding: false, terrain: null as HTMLCanvasElement | null, live: null as LiveWire | null, tier: "", cls: "", ringed: false },
};

export const say = (text: string, cls = "dim"): void => {
  $("said").className = cls;
  $("said").textContent = text;
};

export async function ask<T>(path: string): Promise<T> {
  const r = await fetch(`supply/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return (await r.json()) as T;
}

export async function post(what: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> }> {
  const r = await fetch(`supply/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A field of the draft: its place, what it holds, and its faults, which redden it. */
export function field(path: Path, kind: Kind, width = 64, blank = true): string {
  const d = S.draft!;
  let at: unknown = d;
  for (const key of path) at = (at as Record<string | number, unknown> | undefined)?.[key];
  const faults = faultsAt(S.faults, path);
  const common = `data-path="${esc(JSON.stringify(path))}" data-kind="${kind}"${blank ? "" : ' data-need="1"'} title="${esc(faults.length ? faults.map((f) => f.message).join("; ") : pathText(path))}"${faults.length ? ' class="wrong"' : ""}`;
  if (kind === "flag") return `<input type="checkbox" ${common}${at === true ? " checked" : ""}>`;
  return `<input ${common} value="${esc(show(kind, at))}" style="width:${width}px"${kind === "ids" ? ' list="things"' : ""}>`;
}
