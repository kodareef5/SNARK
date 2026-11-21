// The drop book's admin page (planning/workstreams/supply.md, "The admin page"): it reads a world's book and catalogue
// (server/admin/supply-routes.ts), works the book out with the code the server rolls with, and draws it. What it shows
// is decided in client/core/drops; this file fetches, draws and listens.

import { esc } from "../core/admin/format.ts";
import { catalogOfWire, css, load, matrix, nameOf, num, pct, simulation, tableDetail, waitingRows, type CatalogWire, type Loaded, type SlotView } from "../core/drops/view.ts";
import { MARKS } from "../../shared/sim/supply.ts";
import { bookFaults, type SupplyBook } from "../../shared/supply/book.ts";
import type { Catalog } from "../../shared/supply/catalog.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** What book.json carries (server/admin/supply-routes.ts). */
interface BookWire {
  revision: number;
  starter: boolean;
  kept: boolean;
  map: string;
  book: SupplyBook;
  overrides: { tier: string; plain: boolean; ringed: boolean }[];
  settings: { off: boolean; quality: number; random: boolean };
}

const TABS = [["tables", "Tables"], ["waiting", "Waiting"], ["sim", "Simulator"]] as const;
type Tab = (typeof TABS)[number][0];

/** The page's state. */
const S = {
  wire: null as BookWire | null,
  catalog: null as Catalog | null,
  l: null as Loaded | null,
  tab: "tables" as Tab,
  /** The table opened in the matrix, and what the simulator rolls. */
  open: "",
  sim: { key: "", ringed: false, n: 5000, seed: 1, designed: false },
};

const say = (text: string, cls = "dim"): void => {
  $("said").className = cls;
  $("said").textContent = text;
};

async function ask<T>(path: string): Promise<T> {
  const r = await fetch(`supply/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return (await r.json()) as T;
}

/** A mark's shape as a few strokes, for a class's column: the seven top-marks (shared/sim/supply.ts MARKS). */
const GLYPH: Readonly<Record<string, string>> = { bar: "▬", saltire: "✕", buckler: "◯", hourglass: "⧗", cross: "✚", cone_down: "▼", cone_up: "▲" };

function head(): void {
  const w = S.wire!;
  $("world").textContent = `${w.map === "" ? "this world" : w.map} · revision ${w.revision}${w.starter ? ", the starter book" : ""}`;
  const chips: string[] = [];
  if (!w.kept) chips.push('<span class="chip warn" title="This world has no save: an edit lasts until it stops.">not kept</span>');
  if (w.settings.off) chips.push('<span class="chip bad" title="bDisableLootCrates: no circuit calls a drop. A test drop still lands.">drops are off</span>');
  if (w.settings.quality !== 1) chips.push(`<span class="chip" title="SupplyCrateLootQualityMultiplier">quality × ${w.settings.quality}</span>`);
  for (const o of w.overrides) chips.push(`<span class="chip warn" title="ConfigOverrideSupplyCrateItems gives this tier's tables: the book's are not rolled for it.">${esc(o.tier)} is the server's own</span>`);
  $("chips").innerHTML = chips.join("");
  $("tabs").innerHTML = TABS.map(([key, name]) => `<button data-tab="${key}" class="${S.tab === key ? "on" : ""}">${name}</button>`).join("");
}

function tablesHtml(l: Loaded): string {
  const m = matrix(l);
  const heads = l.book.classes.map((c) => `<th title="${esc(c.key)}">${GLYPH[MARKS[c.mark] ?? ""] ?? ""} ${esc(c.name)}</th>`).join("");
  const rows = l.book.tiers.map((tier, t) => {
    const cells = m[t]!.map((c) => {
      if (!c) return '<td class="faint">no table</td>';
      const of = c.designed / c.target;
      const sub = c.health === "dormant" ? "dormant" : `least ${pct(c.least / c.target)}${c.waiting > 0 ? ` · ${c.waiting} waiting` : ""}${c.jackpot > 0 ? ` · jackpot ${pct(c.jackpot)}` : ""}`;
      return `<td><button class="cell ${c.health}${S.open === c.key ? " open" : ""}" data-open="${esc(c.key)}" title="${num(c.designed)} of ${num(c.target)} as designed, ${num(c.today)} today; a ringed drop ${c.ringed.toFixed(2)} times that; ${c.stacks} stacks at the most"><span class="of">${pct(of)}</span><div class="meter"><i style="width:${Math.min(100, of * 66.7).toFixed(1)}%"></i><b></b></div><span class="sub">${sub}</span></button></td>`;
    });
    return `<tr><th class="tier"><span class="swatch" style="background:${css(tier.rgb)}"></span>${esc(tier.name)} <span class="faint">level ${tier.level} · ${num(tier.target)}</span></th>${cells.join("")}</tr>`;
  });
  const r = l.today.report;
  const notes = [`${Object.keys(l.book.tables).length} tables`, `${r.dormant.length} dormant`, `${r.waiting.length} waiting`, `${r.emptySets.length} sets with nothing the game has`, `${r.lints.length} things to look at`];
  return `<section class="glass"><div class="row"><h2>Every tier and class against its target</h2><span class="dim">${notes.join(" · ")}</span></div>
    <p class="dim" style="margin:6px 0">A table's mean worth as designed, over its tier's target (the mark is the target). Each is rolled ${num(l.cells[0]?.designed.n ?? 0)} times here; the simulator rolls one as often as asked.</p>
    <div class="scroll"><table class="matrix"><tr><th></th>${heads}</tr>${rows.join("")}</table></div>
    ${r.lints.length === 0 ? "" : `<p class="warn">${r.lints.map((f) => `${esc(f.path)}: ${esc(f.message)}`).join("<br>")}</p>`}</section>${S.open === "" ? "" : detailHtml(l, S.open)}`;
}

function slotHtml(slot: SlotView): string {
  const chance = slot.chance === slot.ringed ? pct(slot.chance) : `${pct(slot.chance)} plain, ${pct(slot.ringed)} ringed`;
  const sets = slot.sets.map((set) => {
    const lines = set.entries.map((e) => {
      const what = e.items.map((i) => `<span class="${i.has ? "" : "faint"}" title="${esc(i.id)}">${esc(i.name)}</span>`).join(" or ");
      const tags = [e.quality, e.blueprint, e.ballast ? "ballast" : "", e.jackpot ? "jackpot" : ""].filter((t) => t !== "").map((t) => `<span class="tag">${esc(t)}</span>`).join(" · ");
      const count = e.min === e.max ? String(e.min) : `${e.min}–${e.max}`;
      return `<div class="entry${e.gone ? " gone" : ""}"><span class="dim">${set.gives === "every line" ? "" : pct(e.share)}</span><span>${count} × ${what}${tags === "" ? "" : `<br>${tags}`}</span><span class="dim" title="one, at no quality">${num(e.each)}</span></div>`;
    });
    return `<div style="margin-top:6px"><span title="${esc(set.key)}">${esc(set.name)}</span> <span class="dim">${slot.sets.length > 1 ? `${pct(set.share)} · ` : ""}${esc(set.gives)}</span>${lines.join("")}</div>`;
  });
  return `<div class="slot"><div class="row"><h3>${esc(slot.name)}</h3><span class="dim">${chance}</span></div>${sets.join("")}</div>`;
}

function detailHtml(l: Loaded, key: string): string {
  const slots = tableDetail(l, key);
  const note = l.book.tables[key]?.note;
  return `<section class="glass"><div class="row"><h2>${esc(key)}</h2><span class="dim">its slots in order: each a chance, a pick among its sets, and what the set gives</span><span class="grow"></span><button data-sim="${esc(key)}">Roll it in the simulator</button><button data-open="">Close</button></div>
    ${note ? `<p class="dim">${esc(note)}</p>` : ""}<div class="slots" style="margin-top:8px">${slots.map(slotHtml).join("")}</div></section>`;
}

function waitingHtml(l: Loaded): string {
  const rows = waitingRows(l);
  if (rows.length === 0) return '<section class="glass"><h2>Waiting</h2><p class="well">Everything the book names is in the game.</p></section>';
  const why: Readonly<Record<string, string>> = { future: "the book says what it will be", unknown: "nothing knows it", renamed: "the game calls it something else now", never: "loot may not hold it" };
  const body = rows.map((r) => {
    const name = r.page === "" ? esc(r.name) : `<a href="${esc(r.page)}" target="_blank" rel="noreferrer">${esc(r.name)}</a>`;
    const often = r.most ? `${pct(r.most.share)} of ${esc(r.most.key)}` : "";
    return `<tr><td>${name}<br><span class="faint">${esc(r.id)}</span></td><td class="n">${r.level > 0 ? r.level : ""}</td><td>${esc(why[r.why] ?? r.why)}${r.to.length ? `: ${r.to.map(esc).join(", ")}` : ""}</td><td>${r.cells.map(esc).join(", ")}<br><span class="faint">${r.sets.map(esc).join(", ")}</span></td><td>${often}</td></tr>`;
  });
  return `<section class="glass"><div class="row"><h2>Waiting</h2><span class="dim">what the book names that the game cannot give: each leaves its line, and the table goes on without it</span></div>
    <div class="scroll"><table><tr><th>Thing</th><th class="n">ARK's level</th><th>Why it waits</th><th>Where it would drop</th><th>Oftenest, as designed</th></tr>${body.join("")}</table></div></section>`;
}

function simHtml(l: Loaded): string {
  const keys = Object.keys(l.book.tables);
  if (!keys.includes(S.sim.key)) S.sim.key = keys[0] ?? "";
  const p = S.sim;
  const v = simulation(l, p.key, p.ringed, p.n, p.seed, p.designed, true);
  const form = `<div class="row"><label>Table <select id="simKey">${keys.map((k) => `<option${k === p.key ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="simRinged"${p.ringed ? " checked" : ""}> ringed</label>
    <label title="Counts what the book waits for as if the game had it."><input type="checkbox" id="simDesigned"${p.designed ? " checked" : ""}> as designed</label>
    <label>Rolls <input id="simN" type="number" min="1" max="200000" step="1000" value="${p.n}" style="width:96px"></label>
    <label>Seed <input id="simSeed" type="number" min="0" step="1" value="${p.seed}" style="width:96px"></label><button id="simGo" class="go">Roll</button></div>`;
  if (!v) return `<section class="glass"><h2>Simulator</h2>${form}<p class="dim">No such table.</p></section>`;
  const s = v.stats;
  const figure = (label: string, value: string, sub = ""): string => `<div><span class="label">${label}</span><b>${value}</b><span class="dim">${sub}</span></div>`;
  const figures = [
    figure("Mean", num(s.mean), `${pct(v.mean)} of ${num(v.target)}`), figure("Least", num(s.min), pct(v.least)), figure("5 in 100 under", num(s.p5)), figure("Median", num(s.median)),
    figure("95 in 100 under", num(s.p95)), figure("Most", num(s.max), pct(v.most)), figure("Blueprints", pct(s.blueprintShare), "of all things"), figure("Stacks at most", String(s.stacksMost), "of the capsule's 60"),
    ...(s.jackpotShare > 0 ? [figure("Jackpot", pct(s.jackpotShare), `worth ${num(s.jackpotMean)}, kept apart`)] : []), ...(s.empty > 0 ? [figure("Empty rolls", String(s.empty), "given the floor")] : []),
  ];
  const shades = ["#7f8c99", "#8fd9c4", "#a9d6f2", "#b79cf0", "#ecb048", "#ec6a52"];
  const mix = v.quality.length === 0 ? '<span class="dim">nothing drawn from a quality band</span>' : `<div class="mix">${v.quality.map((q, k) => `<i style="width:${(q.share * 100).toFixed(2)}%;background:${shades[k % shades.length]}" title="${esc(q.name)} ${pct(q.share)}"></i>`).join("")}</div><div class="row dim" style="font-size:13px">${v.quality.map((q) => `${esc(q.name)} ${pct(q.share)}`).join(" · ")}</div>`;
  const items = v.items.map((i) => `<tr><td title="${esc(i.id)}">${esc(i.name)}</td><td class="n">${pct(i.share)}</td><td class="n">${i.each >= 10 ? num(i.each) : i.each.toFixed(1)}</td><td class="n">${i.blueprint > 0 ? pct(i.blueprint) : ""}</td></tr>`);
  return `<section class="glass"><div class="row"><h2>Simulator</h2><span class="dim">the table rolled as the server rolls it; a dormant one is topped up as an admin's test drop is</span></div>${form}
    <div class="figures" style="margin-top:10px">${figures.join("")}</div>
    <div class="label" style="margin-top:10px">Worth of a roll, from ${num(v.from)} to ${num(v.to)}</div><div class="bars">${v.bars.map((b) => `<i style="height:${(b * 100).toFixed(1)}%"></i>`).join("")}</div>
    <div class="label">Quality of what was drawn from a band</div>${mix}
    <div class="scroll" style="margin-top:10px"><table><tr><th>Thing</th><th class="n">In rolls</th><th class="n">Each time</th><th class="n">As a blueprint</th></tr>${items.join("")}</table></div></section>`;
}

/** The tab and the table opened are in the address, so a view can be linked to: `#tables/blue/voyage`, `#sim/red/arms`. */
function fromHash(): void {
  const [tab, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (TABS.some(([key]) => key === tab)) S.tab = tab as Tab;
  const key = rest.join("/");
  if (S.tab === "tables") S.open = key;
  if (S.tab === "sim" && key !== "") S.sim.key = key;
}

function draw(): void {
  if (!S.wire || !S.l) return;
  const hash = `#${S.tab}${S.tab === "tables" && S.open !== "" ? `/${S.open}` : S.tab === "sim" && S.sim.key !== "" ? `/${S.sim.key}` : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  head();
  $("main").innerHTML = S.tab === "tables" ? tablesHtml(S.l) : S.tab === "waiting" ? waitingHtml(S.l) : simHtml(S.l);
}

/** Reads the simulator's form into the state. */
function simRead(): void {
  S.sim = { key: $<HTMLSelectElement>("simKey").value, ringed: $<HTMLInputElement>("simRinged").checked, designed: $<HTMLInputElement>("simDesigned").checked, n: Number($<HTMLInputElement>("simN").value) || 1000, seed: Number($<HTMLInputElement>("simSeed").value) || 0 };
}

document.addEventListener("click", (e) => {
  const at = (e.target as HTMLElement).closest<HTMLElement>("[data-tab],[data-open],[data-sim],#simGo");
  if (!at) return;
  if (at.dataset.tab) S.tab = at.dataset.tab as Tab;
  else if (at.dataset.open !== undefined) S.open = S.open === at.dataset.open ? "" : at.dataset.open;
  else if (at.dataset.sim) [S.tab, S.sim.key] = ["sim", at.dataset.sim];
  else simRead();
  draw();
});
document.addEventListener("change", (e) => {
  if ((e.target as HTMLElement).id.startsWith("sim")) {
    simRead();
    draw();
  }
});

async function start(): Promise<void> {
  say("reading the book…");
  const [wire, catalog] = await Promise.all([ask<BookWire>("book.json"), ask<CatalogWire>("catalog.json")]);
  S.wire = wire;
  S.catalog = catalogOfWire(catalog);
  const faults = bookFaults(wire.book).filter((f) => !f.warn);
  if (faults.length > 0) throw new Error(`the book in force has faults: ${faults[0]!.path}: ${faults[0]!.message}`);
  S.l = load(wire.book, S.catalog);
  say("");
  fromHash();
  draw();
}

addEventListener("hashchange", () => {
  fromHash();
  draw();
});
start().catch((err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
// The names a page under test reads the state by.
(globalThis as { drops?: unknown }).drops = { S, nameOf };
