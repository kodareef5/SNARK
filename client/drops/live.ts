// The drops page's views of what is happening and what has been pasted: the live drops and the circuits' clocks, the
// log of what drops did and what was done to them, the book's saves, and ARK's own override read into the book's shape.

import { esc } from "../core/admin/format.ts";
import { css, num, type Loaded } from "../core/drops/view.ts";
import { S, type LiveWire } from "./state.ts";

const ago = (live: LiveWire, tick: number): string => {
  const s = Math.max(0, Math.round((live.tick - tick) / live.rate));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
};
const span = (s: number): string => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function liveHtml(l: Loaded): string {
  const live = S.map.live;
  if (!live) return '<section class="glass"><h2>Live and log</h2><p class="dim">reading…</p></section>';
  const colour = (tier: string): string => css(l.book.tiers.find((t) => t.key === tier)?.rgb ?? 0x888888);
  const drops = live.drops.map((d) => `<tr><td>${d.id}</td><td><span class="swatch" style="background:${colour(d.tier)}"></span>${d.ringed ? "ringed " : ""}${esc(d.tier)} ${esc(d.cls)}</td><td>${esc(d.state)}${d.opened ? ", opened" : ""}</td>
      <td class="n">${d.landed ? (d.left > 0 ? `${span(d.left)} left` : "") : `lands in ${span(d.lands)}`}</td><td class="n">${num(d.x)}, ${num(d.z)}</td><td>${esc(d.circuit === "" ? d.source : `${d.circuit}${d.site === "" ? "" : ` · ${d.site}`}`)}</td>
      <td>${d.landed ? "" : `<button data-do="landone" data-id="${d.id}">Land now</button>`}<button data-do="cancel" data-id="${d.id}" class="risk">Cancel</button></td></tr>`);
  const circuits = live.circuits.map((c) => `<tr><td>${esc(c.key)}</td><td>${c.on ? `looks in ${span(c.looks)}` : '<span class="faint">off</span>'}</td><td class="n">${num(c.called)}</td><td class="${c.why === "" ? "dim" : "warn"}">${c.why !== "" ? esc(c.why) : c.called === 0 ? "has not looked yet" : "called one when it last looked"}</td></tr>`);
  // What the drops did and what was done to them, in one list by when, the newest first.
  const lines = [...live.log.map((x) => ({ tick: x.tick, what: x.what, mine: false })), ...live.acts.map((x) => ({ tick: x.tick, what: x.what, mine: true }))].sort((a, b) => b.tick - a.tick).slice(0, 120);
  const log = lines.length === 0 ? '<p class="dim">Nothing yet.</p>' : `<div class="scroll"><table>${lines.map((x) => `<tr><td class="dim" style="white-space:nowrap">${ago(live, x.tick)}</td><td>${x.mine ? '<span class="chip">admin</span> ' : ""}${esc(x.what)}</td></tr>`).join("")}</table></div>`;
  const saves = S.revisions === null ? '<p class="dim">reading…</p>' : S.revisions.length === 0 ? '<p class="dim">The book has not been saved: it is the starter.</p>' : `<div class="scroll"><table><tr><th class="n">Revision</th><th>When</th><th>By</th><th>For</th><th></th></tr>${[...S.revisions].reverse().map((r) => `<tr><td class="n">${r.revision}</td><td>${esc(new Date(r.at * 1000).toLocaleString())}</td><td>${esc(r.by)}</td><td>${esc(r.note)}</td>
      <td><button data-do="compare" data-id="${r.revision}" title="What differs between it and the draft.">Compare</button>${r.revision === S.wire!.revision ? "" : `<button data-do="restore" data-id="${r.revision}" class="risk" title="It comes back as the next revision.">Restore</button>`}</td></tr>`).join("")}</table></div>`;
  const compared = S.compared ? `<div class="faint" style="font-size:13px;margin-top:6px"><b>From revision ${S.compared.revision} to the draft:</b><br>${S.compared.lines.length === 0 ? "no difference" : S.compared.lines.map(esc).join("<br>")}</div>` : "";
  return `<section class="glass"><div class="row"><h2>Live</h2><span class="dim">${live.drops.length} of ${l.book.rules.maxLive} at the most · ${num(live.calls)} called and ${num(live.landings)} landed since the start${live.mended > 0 ? ` · <span class="warn">${live.mended} put right at the last start</span>` : ""}</span><span class="grow"></span><button data-do="landall">Land all</button><button data-do="relive">Read again</button></div>
    ${live.drops.length === 0 ? '<p class="dim">No drops are live.</p>' : `<div class="scroll"><table><tr><th>Drop</th><th>Tier and class</th><th>State</th><th class="n">When</th><th class="n">Where</th><th>From</th><th></th></tr>${drops.join("")}</table></div>`}</section>
    <section class="glass"><div class="row"><h2>Circuits</h2><span class="dim">when each looks next, how many it has called, and why it last called none</span></div><div class="scroll"><table><tr><th>Circuit</th><th>Clock</th><th class="n">Called</th><th>Last time</th></tr>${circuits.join("")}</table></div></section>
    <section class="glass"><div class="row"><h2>Log</h2><span class="dim">what drops did and who first opened them, and what was done from this page</span></div>${log}</section>
    <section class="glass"><div class="row"><h2>The book's saves</h2><span class="dim">the last fifty, each whole</span></div>${saves}${compared}</section>`;
}

export function arkHtml(): string {
  const a = S.ark, g = a.got;
  const result = !g ? "" : `<div style="margin-top:10px"><div class="label">What it would make of this book</div>
    ${g.tiers.length === 0 ? '<p class="warn">Nothing: no crate in it is a tier\'s here.</p>' : `<div class="scroll"><table><tr><th>Tier</th><th class="n">Sets, plain</th><th class="n">Sets, ringed</th><th>Tables it replaces</th></tr>${g.tiers.map((t) => `<tr><td>${esc(t.tier)}</td><td class="n">${t.plain}</td><td class="n">${t.ringed}</td><td class="dim">every class of ${esc(t.tier)}: ARK has no classes</td></tr>`).join("")}</table></div>`}
    ${g.missing.length === 0 ? "" : `<p class="warn">Not in this build, and left out: ${g.missing.map(esc).join(", ")}</p>`}
    ${g.unclear.length === 0 ? "" : `<p class="warn">Could be several things, and read as none: ${g.unclear.map((u) => `${esc(u.name)} (${u.could.map(esc).join(" or ")})`).join("; ")}</p>`}
    ${g.said.length === 0 ? "" : `<p class="dim">${g.said.map(esc).join("<br>")}</p>`}
    <div class="row"><button data-do="arkput" class="go"${g.tiers.length === 0 ? " disabled" : ""}>Put these tables in the draft</button><span class="dim">${Object.keys(g.sets).length} sets and ${Object.keys(g.tables).length} tables; nothing is saved until Save</span></div></div>`;
  return `<section class="glass"><div class="row"><h2>ARK paste</h2><span class="dim">ConfigOverrideSupplyCrateItems lines from an ARK server's Game.ini, read as the server reads its own</span></div>
    <p class="dim" style="margin:6px 0">A crate is the tier that opens at its level (<code>SupplyCrate_Level25_C</code> is the tier at 25, and <code>_Double</code> its ringed drops). A server that has the setting in its own file needs none of this: its tables win over the book's at every start.</p>
    <textarea id="arkText" rows="9" style="width:100%" placeholder='ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level03_C",MinItemSets=1,MaxItemSets=1,…'>${esc(a.text)}</textarea>
    <div class="row" style="margin-top:6px"><button data-do="arkread">Read it</button></div>${result}</section>`;
}
