// The drop book's admin page (planning/workstreams/supply.md, "The admin page"): it reads a world's book and catalogue
// (server/admin/supply-routes.ts), works the book out with the code the server rolls with, and draws it. What it shows
// is decided in client/core/drops; this file fetches, draws and listens.

import { esc } from "../core/admin/format.ts";
import { addEntry, addSlot, changes, differs, ensureAt, moveAt, parseBook, read, setAt, type Kind, type Path } from "../core/drops/edit.ts";
import { addCircuit, removeLoose, removeSite, takeOut } from "../core/drops/place.ts";
import { arkHtml, liveHtml } from "./live.ts";
import { $, S, TABS, ask, field, post, say, type ArkWire, type BookWire, type RevisionWire, type Tab } from "./state.ts";
import { circuitsHtml, dropPlace, mapDraw, mapHtml, mapListen, mapRead, tiersHtml } from "./world.ts";
import type { CircuitDoc, SiteDoc } from "../../shared/supply/book.ts";
import { catalogOfWire, css, load, matrix, nameOf, num, pct, simulation, tableDetail, waitingRows, type CatalogWire, type Loaded, type SlotView } from "../core/drops/view.ts";
import { MARKS } from "../../shared/sim/supply.ts";
import { bookFaults, type BookFault } from "../../shared/supply/book.ts";

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

/** What stands between the draft and the book in force: its changes, its faults, and the ways to save or leave them. */
function barHtml(): string {
  const w = S.wire!, d = S.draft!;
  const changed = differs(w.book, d);
  const lines = changed ? changes(w.book, d, 12) : [];
  const faults = S.faults.length === 0 ? "" : `<div class="bad">${S.faults.slice(0, 8).map((f) => `${esc(f.path)}: ${esc(f.message)}`).join("<br>")}${S.faults.length > 8 ? `<br>and ${S.faults.length - 8} more` : ""}</div>`;
  const conflict = S.conflict < 0 ? "" : `<div class="warn">Another editor saved revision ${S.conflict} since this page read the book. <button data-do="theirs">Read theirs, and lose these changes</button> <button data-do="over" class="risk">Save over revision ${S.conflict}</button></div>`;
  const tools = `<button data-do="export" title="The draft as a file.">Export JSON</button><button data-do="import" title="A book from a file becomes the draft; nothing is saved until Save.">Import JSON</button><button data-do="starter" class="risk" title="The starter book again, as the next revision."${changed ? " disabled" : ""}>The starter again</button><input type="file" id="file" accept="application/json,.json" hidden>`;
  if (!changed) return `<section class="glass"><div class="row"><span class="dim">The book in force, revision ${w.revision}. A change here is a draft until it is saved.</span><span class="grow"></span>${tools}</div>${conflict}</section>`;
  return `<section class="glass"><div class="row"><h2>Not saved</h2><span class="dim">${lines.length} ${lines.length === 1 ? "change" : "changes"} to revision ${w.revision}</span><span class="grow"></span>
    <input id="note" placeholder="what this save is for" maxlength="200" style="width:320px"><button data-do="save" class="go"${S.faults.length ? " disabled" : ""}>Save</button><button data-do="discard">Discard</button>${tools}</div>
    <div class="faint" style="font-size:13px;margin-top:6px">${lines.map(esc).join("<br>")}</div>${faults}${conflict}</section>`;
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
    <p class="dim" style="margin:6px 0">A table's mean worth as designed, over its tier's target (the mark is the target). Each is rolled ${num(l.cells[0]?.designed.n ?? 0)} times here; the simulator rolls one as often as asked.${l.quality === 1 ? "" : ` This world multiplies quality by ${l.quality} (SupplyCrateLootQualityMultiplier): the figures here are the book's alone, which its targets are held by, and the simulator rolls what the world gives.`}</p>
    <div class="scroll"><table class="matrix"><tr><th></th>${heads}</tr>${rows.join("")}</table></div>
    ${r.lints.length === 0 ? "" : `<p class="warn">${r.lints.map((f) => `${esc(f.path)}: ${esc(f.message)}`).join("<br>")}</p>`}</section>${S.open === "" ? "" : detailHtml(l, S.open)}`;
}

/** A slot of the opened table with fields in place of words: its chances, each set's measure, each line. */
function slotEdit(table: string, k: number, slot: SlotView): string {
  const at = ["tables", table, "slots", k] as const;
  const sets = slot.sets.map((set, f) => {
    const doc = S.draft!.sets[set.key];
    if (!doc) return `<div class="bad">no set ${esc(set.key)}</div>`;
    const sp = ["sets", set.key] as const;
    const lines = doc.entries.map((_, e) => {
      const ep = [...sp, "entries", e] as const;
      const where = esc(JSON.stringify(ep));
      return `<div class="line">${field([...ep, "items"], "ids", 210, false)} ${field([...ep, "min"], "whole", 44, false)}–${field([...ep, "max"], "whole", 44, false)}
        <label title="How often it is drawn among its set's lines.">weight ${field([...ep, "weight"], "number", 44)}</label><label title="tier, or a rating range such as 1.25 to 3.25; empty for none">quality ${field([...ep, "quality"], "quality", 78)}</label>
        <label title="How often it comes as a blueprint, in hundredths.">blueprint % ${field([...ep, "blueprint"], "share", 44)}</label><label>always ${field([...ep, "forceBlueprint"], "flag")}</label><label title="Kept apart from the table's worth.">jackpot ${field([...ep, "jackpot"], "flag")}</label>
        <button data-do="up" data-at="${where}" title="Up">↑</button><button data-do="down" data-at="${where}" title="Down">↓</button><button data-do="del" data-at="${where}" class="risk" title="Take this line out">×</button></div>`;
    });
    return `<div style="margin-top:6px"><b title="${esc(set.key)}">${esc(set.name)}</b> <label>pick weight ${field([...at, "from", f, "weight"], "number", 44)}</label> <label>every line ${field([...sp, "all"], "flag")}</label> <label>draws ${field([...sp, "min"], "whole", 40)}–${field([...sp, "max"], "whole", 40)}</label>
      ${lines.join("")}<button data-do="line" data-set="${esc(set.key)}">Add a line</button></div>`;
  });
  return `<div class="slot wide"><div class="row"><h3>${field([...at, "name"], "text", 120)}</h3><label>chance % ${field([...at, "chance"], "share", 50)}</label><label title="Where a ringed drop differs.">ringed % ${field([...at, "ringed"], "share", 50)}</label><span class="grow"></span><button data-do="del" data-at="${esc(JSON.stringify(at))}" class="risk">Take this slot out</button></div>${sets.join("")}</div>`;
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
  const body = S.editing ? `<div class="slots one">${slots.map((slot, k) => slotEdit(key, k, slot)).join("")}</div><div class="row" style="margin-top:8px"><select id="newSlot">${Object.keys(S.draft!.sets).map((k) => `<option>${esc(k)}</option>`).join("")}</select><button data-do="slot" data-table="${esc(key)}">Add a slot drawing from this set</button></div>` : `<div class="slots" style="margin-top:8px">${slots.map(slotHtml).join("")}</div>`;
  return `<section class="glass"><div class="row"><h2>${esc(key)}</h2><span class="dim">its slots in order: each a chance, a pick among its sets, and what the set gives</span><span class="grow"></span><button data-do="edit" class="${S.editing ? "on" : ""}">${S.editing ? "Done editing" : "Edit"}</button><button data-sim="${esc(key)}">Roll it in the simulator</button><button data-open="">Close</button></div>
    ${note ? `<p class="dim">${esc(note)}</p>` : ""}${body}</section>`;
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
  const v = simulation(l, p.key, p.ringed, p.n, p.seed, p.designed, true, p.world);
  const form = `<div class="row"><label>Table <select id="simKey">${keys.map((k) => `<option${k === p.key ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="simRinged"${p.ringed ? " checked" : ""}> ringed</label>
    <label title="Counts what the book waits for as if the game had it."><input type="checkbox" id="simDesigned"${p.designed ? " checked" : ""}> as designed</label>
    <label title="SupplyCrateLootQualityMultiplier, as this world's server rolls. Unticked, the book alone, which is what its targets are held by."${l.quality === 1 ? " hidden" : ""}><input type="checkbox" id="simWorld"${p.world ? " checked" : ""}> at this world's quality × ${l.quality}</label>
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
  // A table's address may end in /edit, which opens it with its fields.
  S.editing = rest[rest.length - 1] === "edit";
  const key = (S.editing ? rest.slice(0, -1) : rest).join("/");
  if (S.tab === "tables") S.open = key;
  if (S.tab === "sim" && key !== "") S.sim.key = key;
}

function draw(): void {
  if (!S.wire || !S.l) return;
  const hash = `#${S.tab}${S.tab === "tables" && S.open !== "" ? `/${S.open}${S.editing ? "/edit" : ""}` : S.tab === "sim" && S.sim.key !== "" ? `/${S.sim.key}` : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  head();
  // What is typed in the note outlives a redraw.
  const note = document.getElementById("note") as HTMLInputElement | null;
  const kept = note?.value ?? "";
  const view: Record<Tab, (l: Loaded) => string> = { tables: tablesHtml, waiting: waitingHtml, sim: simHtml, tiers: tiersHtml, map: mapHtml, circuits: circuitsHtml, live: liveHtml, ark: arkHtml };
  $("main").innerHTML = barHtml() + view[S.tab](S.l);
  const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");
  if (S.tab === "map") {
    // The map's picture and what is live are read the first time it is looked at.
    if (S.map.live) mapDraw(S.l);
    else void mapRead().then(draw, failed);
  }
  if (S.tab === "live" && (!S.map.live || S.revisions === null)) void Promise.all([mapRead(), ask<RevisionWire[]>("revisions.json").then((r) => void (S.revisions = r))]).then(draw, failed);
  const again = document.getElementById("note") as HTMLInputElement | null;
  if (again) again.value = kept;
  if (!document.getElementById("things")) document.body.insertAdjacentHTML("beforeend", `<datalist id="things">${[...S.catalog!.byId.values()].map((i) => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join("")}</datalist>`);
}

/** The draft changed: it is checked, and worked out again if it is sound. With faults the last sound figures stand. */
function changed(): void {
  S.faults = bookFaults(S.draft!).filter((f) => !f.warn);
  if (S.faults.length === 0) S.l = load(S.draft!, S.catalog!, undefined, S.wire!.settings.quality);
  draw();
}

/** Saves the draft over `revision`, and reads the book in force again, or says why it was not saved. */
async function save(what: "book" | "reset", revision: number): Promise<void> {
  const note = (document.getElementById("note") as HTMLInputElement | null)?.value ?? "";
  const { status, answer } = await post(what, { revision, book: S.draft, note });
  if (status === 200) {
    S.conflict = -1;
    await start(`saved as revision ${String(answer.revision)}${answer.unkept ? `, but ${String(answer.unkept)}` : ""}`);
  } else if (status === 409) {
    S.conflict = Number(answer.revision);
    say("not saved: another editor saved first", "warn");
    draw();
  } else if (status === 422) {
    S.faults = (answer.faults as BookFault[] | undefined) ?? [];
    say("not saved: the book has faults", "bad");
    draw();
  } else say(`not saved: ${String(answer.error ?? status)}`, "bad");
}

/** A button of the save bar or of an opened table. */
async function act(at: HTMLElement): Promise<void> {
  const d = S.draft!, what = at.dataset.do!;
  const path = at.dataset.at ? (JSON.parse(at.dataset.at) as Path) : [];
  if (what === "edit") S.editing = !S.editing;
  else if (what === "line") addEntry(d, at.dataset.set!);
  else if (what === "slot") addSlot(d, at.dataset.table!, $<HTMLSelectElement>("newSlot").value);
  else if (what === "del") takeOut(d, path);
  else if (what === "up" || what === "down") moveAt(d, path, what === "up" ? -1 : 1);
  else if (what === "discard") [S.draft, S.conflict] = [structuredClone(S.wire!.book), -1];
  else if (what === "unsite") [, S.map.site] = [removeSite(d, S.map.site), ""];
  else if (what === "unloose") say(`${removeLoose(d)} taken out that no circuit named: not saved yet`);
  else if (what === "circuit") {
    if (!addCircuit(d, $<HTMLInputElement>("newCircuit").value.trim())) return say("a circuit's key is small letters, digits, _ and -, and not one taken", "warn");
  } else if (what === "found") {
    // The server's proposal for this map as it stands replaces the draft's sites and circuits; Save keeps it.
    say("finding a place in every square…");
    const made = await ask<{ sites: SiteDoc[]; circuits: CircuitDoc[]; faults: Record<string, number> }>("found.json");
    if (made.sites.length === 0) return say("no place a drop may land was found", "warn");
    [d.sites, d.circuits] = [made.sites, made.circuits];
    say(`${made.sites.length} sites found in ${made.circuits.length} circuits: not saved yet`);
  } else if (what === "arkread" || what === "arkput") {
    // ARK's own override, read by the server as it reads its own setting: nothing is changed by reading it.
    // What it is silent on (a tier's plain crate, where it has only the ringed one) is kept from the draft as it stands.
    if (what === "arkread") S.ark.text = $<HTMLTextAreaElement>("arkText").value;
    const got = await post("ark", { text: S.ark.text, book: d });
    if (got.status !== 200) return say(String(got.answer.error ?? got.status), "warn");
    S.ark.got = got.answer as unknown as ArkWire;
    if (what === "arkread") return draw();
    Object.assign(d.sets, S.ark.got.sets);
    Object.assign(d.tables, S.ark.got.tables);
    say(`ARK's tables for ${S.ark.got.tiers.map((t) => t.tier).join(", ")} are in the draft: not saved yet`);
    S.tab = "tables";
  } else if (what === "compare") {
    const old = await ask<{ revision: number; book: BookWire["book"] }>(`revision.json?n=${at.dataset.id}`);
    S.compared = { revision: old.revision, lines: changes(old.book, d, 60) };
    return draw();
  } else if (what === "restore") {
    if (!confirm(`Bring revision ${at.dataset.id} back, as the next revision?`)) return;
    const got = await post("restore", { revision: S.wire!.revision, to: Number(at.dataset.id) });
    if (got.status !== 200) return say(`not restored: ${String(got.answer.error ?? got.status)}`, "warn");
    S.revisions = null;
    return start(`revision ${at.dataset.id} is revision ${String(got.answer.revision)} now`);
  } else if (what === "drop" || what === "landall" || what === "landone" || what === "cancel" || what === "relive") {
    // What is done to the world is done now, by the book in force: none of it is the draft's.
    const where = dropPlace();
    const sent = what === "drop" && where ? await post("call", { x: where[0], z: where[1], tier: S.map.tier, cls: S.map.cls, ringed: S.map.ringed }) : what === "landall" ? await post("land", { id: "all", seconds: 0 }) : what === "landone" ? await post("land", { id: Number(at.dataset.id), seconds: 0 }) : what === "cancel" ? await post("cancel", { id: Number(at.dataset.id) }) : null;
    say(sent ? String(sent.answer.said ?? sent.answer.error ?? "").split("\n")[0]! : "", sent && sent.status !== 200 ? "warn" : "dim");
    await mapRead();
    return draw();
  }
  else if (what === "save") return save("book", S.wire!.revision);
  else if (what === "over") return save("book", S.conflict);
  else if (what === "starter") return confirm("Put the starter book back, as the next revision?") ? save("reset", S.wire!.revision) : undefined;
  else if (what === "theirs") return start("read again");
  else if (what === "export") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${JSON.stringify(d, null, 1)}\n`], { type: "application/json" }));
    a.download = `drops-${S.wire!.map.replace(/[^a-z0-9]+/gi, "-") || "world"}-r${S.wire!.revision}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  } else if (what === "import") return $<HTMLInputElement>("file").click();
  changed();
}

/** Reads the simulator's form into the state. */
function simRead(): void {
  S.sim = { key: $<HTMLSelectElement>("simKey").value, ringed: $<HTMLInputElement>("simRinged").checked, designed: $<HTMLInputElement>("simDesigned").checked, world: $<HTMLInputElement>("simWorld").checked, n: Number($<HTMLInputElement>("simN").value) || 1000, seed: Number($<HTMLInputElement>("simSeed").value) || 0 };
}

document.addEventListener("click", (e) => {
  const at = (e.target as HTMLElement).closest<HTMLElement>("[data-tab],[data-open],[data-sim],[data-do],#simGo");
  if (!at) return;
  if (at.dataset.do) return void act(at).catch((err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
  if (at.dataset.tab) S.tab = at.dataset.tab as Tab;
  else if (at.dataset.open !== undefined) S.open = S.open === at.dataset.open ? "" : at.dataset.open;
  else if (at.dataset.sim) [S.tab, S.sim.key] = ["sim", at.dataset.sim];
  else simRead();
  draw();
});
document.addEventListener("change", (e) => {
  const at = e.target as HTMLInputElement;
  if (at.id === "file" && at.files?.[0]) {
    // A book from a file becomes the draft, to be looked at and then saved or discarded.
    void at.files[0].text().then((text) => {
      const made = parseBook(text);
      if ("error" in made) return say(`not read: ${made.error}`, "bad");
      [made.book.revision, made.book.map] = [S.wire!.revision, S.wire!.book.map];
      S.draft = made.book;
      say("read from the file: not saved yet");
      changed();
    });
  } else if (at.name === "circuit" || at.id.startsWith("map") || at.id.startsWith("drop")) {
    // The map's own choices, which are the page's and not the draft's.
    const m = S.map;
    if (at.name === "circuit") m.circuit = at.value;
    else if (at.id === "mapAdd") m.adding = at.checked;
    else if (at.id === "mapZoom") m.zoom = Number(at.value) || 1;
    else if (at.id === "dropTier") m.tier = at.value;
    else if (at.id === "dropCls") m.cls = at.value;
    else if (at.id === "dropRinged") m.ringed = at.checked;
    draw();
  } else if (at.dataset.path) {
    const got = read(at.dataset.kind as Kind, at.type === "checkbox" ? String(at.checked) : at.value, at.dataset.need !== "1");
    if (!got.ok) {
      at.classList.add("wrong");
      return say("that is not what this field takes", "warn");
    }
    const path = JSON.parse(at.dataset.path) as Path;
    // A first weight makes the list it is put in.
    if (got.value !== undefined) ensureAt(S.draft!, path);
    setAt(S.draft!, path, got.value);
    say("");
    changed();
  } else if (at.id.startsWith("sim")) {
    simRead();
    draw();
  }
});

async function start(said = ""): Promise<void> {
  say("reading the book…");
  const [wire, catalog] = await Promise.all([ask<BookWire>("book.json"), ask<CatalogWire>("catalog.json")]);
  S.wire = wire;
  S.catalog = catalogOfWire(catalog);
  const faults = bookFaults(wire.book).filter((f) => !f.warn);
  if (faults.length > 0) throw new Error(`the book in force has faults: ${faults[0]!.path}: ${faults[0]!.message}`);
  S.draft = structuredClone(wire.book);
  S.faults = [];
  S.revisions = null;
  S.l = load(S.draft, S.catalog, undefined, wire.settings.quality);
  say(said);
  fromHash();
  draw();
}

mapListen(changed, draw);
// What is live is read again every few seconds while it is being looked at.
setInterval(() => {
  if (S.tab !== "live" || !S.l || document.hidden) return;
  void mapRead().then(draw, () => {});
}, 4000);
addEventListener("hashchange", () => {
  fromHash();
  draw();
});
start().catch((err: unknown) => say(err instanceof Error ? err.message : String(err), "bad"));
// The names a page under test reads the state by.
(globalThis as { drops?: unknown }).drops = { S, nameOf };
