// The drops page's views of the world: tiers and classes, the map with its sites, and the circuits with the book's
// rules. Each draws fields of the draft (state.ts field); the map also listens to its own picture.

import { esc } from "../core/admin/format.ts";
import { addSite, circuitOf, forecast, inWorld, moveSite, siteNear, toPixel, toWorld } from "../core/drops/place.ts";
import { css, num, pct, type Loaded } from "../core/drops/view.ts";
import { ANNOUNCES, MARKS } from "../../shared/sim/supply.ts";
import type { CircuitDoc, SiteDoc } from "../../shared/supply/book.ts";
import { $, S, ask, field, say, type LiveWire } from "./state.ts";

/** A choice among words or numbers that is a field of the draft. */
function choice(path: readonly (string | number)[], kind: "text" | "whole", options: readonly (readonly [string | number, string])[], now: unknown): string {
  return `<select data-path="${esc(JSON.stringify(path))}" data-kind="${kind}" data-need="1">${options.map(([v, name]) => `<option value="${esc(String(v))}"${v === now ? " selected" : ""}>${esc(name)}</option>`).join("")}</select>`;
}

export function tiersHtml(l: Loaded): string {
  const d = S.draft!;
  const sets = Object.keys(d.sets).map((k) => [k, k] as const);
  const tiers = d.tiers.map((t, k) => {
    const at = ["tiers", k] as const;
    return `<tr><td><span class="swatch" style="background:${css(t.rgb)}"></span>${esc(t.key)}</td><td>${field([...at, "name"], "text", 110, false)}</td>
      <td><input type="color" data-path="${esc(JSON.stringify([...at, "rgb"]))}" data-kind="rgb" data-need="1" value="${css(t.rgb)}"></td>
      <td>${field([...at, "level"], "whole", 60, false)}</td><td>${field([...at, "target"], "whole", 80, false)}</td><td title="The item rating its quality lines draw from.">${field([...at, "quality"], "pair", 110, false)}</td>
      <td>${choice([...at, "staple"], "text", sets, t.staple)}</td><td>${choice([...at, "floor"], "text", sets, t.floor)}</td></tr>`;
  });
  const classes = d.classes.map((c, k) => {
    const at = ["classes", k] as const;
    const weights = d.tiers.map((t) => `<td>${field([...at, "weights", t.key], "number", 50)}</td>`).join("");
    return `<tr><td>${esc(c.key)}</td><td>${field([...at, "name"], "text", 110, false)}</td><td>${choice([...at, "mark"], "whole", MARKS.map((m, i) => [i, m.replace("_", " ")] as const), c.mark)}</td><td>${choice([...at, "fill"], "text", sets, c.fill)}</td>${weights}</tr>`;
  });
  return `<section class="glass"><div class="row"><h2>Tiers</h2><span class="dim">a tier is a colour, the level that opens it, the worth its tables are held to, and the quality its fine things are drawn at</span></div>
    <div class="scroll"><table><tr><th>Key</th><th>Name</th><th>Colour</th><th>Opens at level</th><th>Worth</th><th>Quality</th><th>Staples</th><th>Floor</th></tr>${tiers.join("")}</table></div></section>
    <section class="glass"><div class="row"><h2>Classes</h2><span class="dim">a class is a top-mark, the set a thin table of it is topped up from, and how often it is drawn at each tier (1 where empty)</span></div>
    <div class="scroll"><table><tr><th>Key</th><th>Name</th><th>Top-mark</th><th>Its own materials</th>${l.book.tiers.map((t) => `<th>${esc(t.name)}</th>`).join("")}</tr>${classes.join("")}</table></div></section>`;
}

function circuitHtml(l: Loaded, c: CircuitDoc, k: number): string {
  const d = S.draft!, at = ["circuits", k] as const;
  const f = forecast(d, c);
  const pace = f.hour === 0 ? `<span class="warn">calls none: ${esc(f.held)}</span>` : `about <b>${f.hour.toFixed(1)}</b> an hour with somebody near${f.held === "" ? "" : ` <span class="warn">(its clock asks for ${f.asked.toFixed(1)}; held by ${esc(f.held)})</span>`}`;
  const mix = f.tiers.map((t) => `<i style="width:${(t.share * 100).toFixed(2)}%;background:${css(l.book.tiers.find((x) => x.key === t.key)?.rgb ?? 0x888888)}" title="${esc(t.key)} ${pct(t.share)}"></i>`).join("");
  return `<div class="slot"><div class="row"><h3>${esc(c.key)}</h3>${field([...at, "name"], "text", 150)}<label>on ${field([...at, "on"], "flag")}</label><span class="grow"></span><button data-do="del" data-at="${esc(JSON.stringify(at))}" class="risk" title="Its sites go with it.">Take this circuit out</button></div>
    <div class="line"><label>most at once ${field([...at, "maxLive"], "whole", 50, false)}</label><label title="Seconds before its first drop.">first after ${field([...at, "firstDelay"], "pair", 100, false)} s</label><label title="Seconds between its drops.">then every ${field([...at, "interval"], "pair", 100, false)} s</label><label title="Empty for the book's.">ringed % ${field([...at, "ringedChance"], "share", 50)}</label><span class="dim">${c.sites.length === 0 ? "open ground" : `${num(c.sites.length)} sites`}</span></div>
    <div class="line"><span class="dim">tiers drawn, by weight</span>${d.tiers.map((t) => `<label>${esc(t.name)} ${field([...at, "tierWeights", t.key], "number", 46)}</label>`).join("")}</div>
    <div class="line"><span class="dim">classes, 1 where empty</span>${d.classes.map((x) => `<label>${esc(x.name)} ${field([...at, "classWeights", x.key], "number", 46)}</label>`).join("")}</div>
    <div style="margin-top:6px">${pace}</div><div class="mix" style="margin-top:4px">${mix}</div></div>`;
}

export function circuitsHtml(l: Loaded): string {
  const d = S.draft!, r = ["rules"] as const;
  const rules = `<div class="line"><label title="Seconds from a call to the landing at the least.">notice ${field([...r, "noticeSeconds"], "whole", 60, false)} s</label><label title="Seconds the cast is in the air.">flight ${field([...r, "flightSeconds"], "whole", 50, false)} s</label><label>braking ${field([...r, "brakeSeconds"], "whole", 50, false)} s</label><label title="Seconds a landed capsule stays if nobody empties it.">on the ground ${field([...r, "lifeSeconds"], "whole", 64, false)} s</label></div>
    <div class="line"><label>most live on the map ${field([...r, "maxLive"], "whole", 50, false)}</label><label title="Survivors that must be in the world for a circuit to call one.">survivors needed ${field([...r, "minPlayers"], "whole", 50, false)}</label><label title="Metres from a survivor within which a circuit calls a drop; 0 for anywhere; 2,500 where empty.">within ${field([...r, "reach"], "whole", 64)} m of a survivor</label><label title="Metres from a tribe's structures within which no drop is called.">clear of a base by ${field([...r, "baseExclusion"], "whole", 56, false)} m</label></div>
    <div class="line"><label title="What everyone is told of a drop that is called.">told by ${choice([...r, "announce"], "text", ANNOUNCES.map((a) => [a, a === "none" ? "nothing: found by looking" : a === "compass" ? "a pip on the compass" : a === "map" ? "the compass and the map" : "those, and a line to everyone"] as const), d.rules.announce)}</label><label>ringed % ${field([...r, "ringedChance"], "share", 50, false)}</label><label title="What a ringed drop multiplies every quality band by.">ringed quality × ${field([...r, "ringedQuality"], "number", 50, false)}</label><label title="The share of its tier's worth a table must reach of its own to be called, and that no roll may fall under.">floor % ${field([...r, "floorShare"], "share", 50, false)}</label></div>`;
  const all = d.circuits.reduce((n, c) => n + forecast(d, c).hour, 0);
  return `<section class="glass"><div class="row"><h2>The book's rules</h2><span class="dim">times, how many, who is told</span></div>${rules}</section>
    <section class="glass"><div class="row"><h2>Circuits</h2><span class="dim">each looks on a clock of its own and draws a tier, a class and a place: about ${all.toFixed(1)} drops an hour in all, where survivors are near every circuit</span><span class="grow"></span><input id="newCircuit" placeholder="a key, such as harbour" style="width:170px"><button data-do="circuit">Add a circuit</button></div>
    <div class="slots one">${d.circuits.map((c, k) => circuitHtml(l, c, k)).join("")}</div></section>`;
}

/** A circuit's colour on the map: its first tiers' colours tell the bands apart at a glance. */
const SHADES = ["#f4f4ee", "#38d060", "#ecb048", "#a050f0", "#3a8cff", "#f03838", "#60f0e0"];
const shadeOf = (k: number): string => SHADES[k % SHADES.length]!;
const side = (): number => 860 * S.map.zoom;

export function mapHtml(l: Loaded): string {
  const d = S.draft!, m = S.map;
  if (!d.circuits.some((c) => c.key === m.circuit)) m.circuit = d.circuits[0]?.key ?? "";
  if (!d.tiers.some((t) => t.key === m.tier)) m.tier = d.tiers[0]?.key ?? "";
  if (!d.classes.some((c) => c.key === m.cls)) m.cls = d.classes[0]?.key ?? "";
  const site = d.sites.find((s) => s.key === m.site);
  const k = site ? d.sites.indexOf(site) : -1;
  const circuits = d.circuits.map((c, i) => `<label class="row" style="gap:6px"><input type="radio" name="circuit" value="${esc(c.key)}"${c.key === m.circuit ? " checked" : ""}><span class="swatch" style="background:${shadeOf(i)}"></span>${esc(c.name ?? c.key)} <span class="dim">${num(c.sites.length)} sites${c.on ? "" : ", off"}</span></label>`).join("");
  const chosen = site
    ? `<div class="label" style="margin-top:10px">The site chosen</div><div>${esc(site.key)} <span class="dim">of ${esc(circuitOf(d, site.key)?.key ?? "no circuit")}</span></div>
      <div class="line"><label>x ${field(["sites", k, "x"], "whole", 70, false)}</label><label>z ${field(["sites", k, "z"], "whole", 70, false)}</label><label title="How often it is drawn among its circuit's; 1 where empty.">weight ${field(["sites", k, "weight"], "number", 50)}</label></div>
      <div class="row"><button data-do="unsite" class="risk">Take this site out</button></div>`
    : `<p class="dim">Click a site to choose it, and drag it to move it. With “add” on, a click on open ground is a new site of the circuit chosen.</p>`;
  const at = site ? [site.x, site.z] : m.at;
  const drop = `<div class="label" style="margin-top:10px">A test drop</div><div class="line"><select id="dropTier">${d.tiers.map((t) => `<option value="${esc(t.key)}"${t.key === m.tier ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select><select id="dropCls">${d.classes.map((c) => `<option value="${esc(c.key)}"${c.key === m.cls ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select><label><input type="checkbox" id="dropRinged"${m.ringed ? " checked" : ""}> ringed</label></div>
    <div class="row"><button data-do="drop"${at ? "" : " disabled"} title="Called at once by the book in force, as the console's supply call.">Call it ${at ? `at ${num(at[0]!)}, ${num(at[1]!)}` : "at a place clicked"}</button><button data-do="landall" title="Every pending drop lands now.">Land all</button></div>`;
  const live = m.live ? `<div class="label" style="margin-top:10px">Live now</div>${m.live.drops.length === 0 ? '<span class="dim">no drops</span>' : m.live.drops.map((x) => `<div><span class="swatch" style="background:${css(l.book.tiers.find((t) => t.key === x.tier)?.rgb ?? 0x888888)}"></span>${x.id}: ${x.ringed ? "ringed " : ""}${esc(x.tier)} ${esc(x.cls)}, ${esc(x.state)} <button data-do="cancel" data-id="${x.id}" class="risk">Cancel</button></div>`).join("")}` : "";
  return `<section class="glass"><div class="row"><h2>Map and sites</h2><span class="dim">${num(d.sites.length)} sites in ${d.circuits.length} circuits; the rings are the obelisks' decks, where no drop lands</span><span class="grow"></span>
      <label><input type="checkbox" id="mapAdd"${m.adding ? " checked" : ""}> add sites by clicking</label><label>zoom <select id="mapZoom">${[1, 2, 4].map((z) => `<option${z === m.zoom ? " selected" : ""}>${z}</option>`).join("")}</select></label>
      <button data-do="found" title="A place to each square of 420 m wherever a drop may land now, in three bands by how far each is from where survivors rise. It replaces the draft's sites and circuits; nothing is saved until Save.">Find starter sites</button><button data-do="relive">Read what is live</button></div>
    <div class="mapgrid"><div class="mapbox"><canvas id="map" width="${side()}" height="${side()}" style="width:${side()}px;height:${side()}px"></canvas></div><div>${circuits}${chosen}${drop}${live}</div></div></section>`;
}

/** Paints the map: the relief, the decks' rings, each circuit's sites in its colour, what is live, the site and place chosen. */
export function mapDraw(l: Loaded): void {
  const canvas = document.getElementById("map") as HTMLCanvasElement | null;
  const m = S.map, live = m.live;
  if (!canvas || !live) return;
  const g = canvas.getContext("2d")!, s = side(), d = S.draft!;
  const w = { sizeX: live.size[0], sizeZ: live.size[1] };
  g.fillStyle = "#0b1622";
  g.fillRect(0, 0, s, s);
  if (m.terrain) {
    g.imageSmoothingEnabled = m.zoom === 1;
    g.drawImage(m.terrain, 0, 0, s, s);
  }
  const scale = s / Math.max(w.sizeX, w.sizeZ);
  g.strokeStyle = "rgba(236,106,82,0.9)";
  for (const o of live.obelisks) {
    const [px, py] = toPixel(w, o.x, o.z, s);
    g.beginPath();
    g.arc(px, py, Math.max(3, 110 * scale), 0, Math.PI * 2);
    g.stroke();
  }
  // A site is a square of its circuit's colour with a dark edge, so it shows on any ground.
  const r = Math.max(4, Math.min(8, 2 * m.zoom + 2));
  d.circuits.forEach((c, k) => {
    const keys = new Set(c.sites);
    g.globalAlpha = c.on ? 1 : 0.45;
    for (const site of d.sites) {
      if (!keys.has(site.key)) continue;
      const [px, py] = toPixel(w, site.x, site.z, s);
      g.fillStyle = "#08111c";
      g.fillRect(px - r / 2 - 1, py - r / 2 - 1, r + 2, r + 2);
      g.fillStyle = shadeOf(k);
      g.fillRect(px - r / 2, py - r / 2, r, r);
    }
  });
  g.globalAlpha = 1;
  for (const x of live.drops) {
    const [px, py] = toPixel(w, x.x, x.z, s);
    g.fillStyle = css(l.book.tiers.find((t) => t.key === x.tier)?.rgb ?? 0x888888);
    g.beginPath();
    g.moveTo(px, py - 8);
    g.lineTo(px + 6, py);
    g.lineTo(px, py + 8);
    g.lineTo(px - 6, py);
    g.fill();
    g.strokeStyle = "#08111c";
    g.stroke();
  }
  const mark = (x: number, z: number, colour: string): void => {
    const [px, py] = toPixel(w, x, z, s);
    g.strokeStyle = colour;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, 9, 0, Math.PI * 2);
    g.moveTo(px - 14, py);
    g.lineTo(px + 14, py);
    g.moveTo(px, py - 14);
    g.lineTo(px, py + 14);
    g.stroke();
    g.lineWidth = 1;
  };
  const site = d.sites.find((x) => x.key === m.site);
  if (site) mark(site.x, site.z, "#ffffff");
  else if (m.at) mark(m.at[0], m.at[1], "#a9d6f2");
}

/** The relief picture and what is live, read once and again when asked. */
export async function mapRead(): Promise<void> {
  S.map.live = await ask<LiveWire>("live.json");
  if (S.map.terrain) return;
  const r = await fetch("terrain.rgba", { cache: "no-store" });
  if (!r.ok) return;
  const bytes = new Uint8ClampedArray(await r.arrayBuffer());
  const n = Math.round(Math.sqrt(bytes.length / 4));
  const c = document.createElement("canvas");
  [c.width, c.height] = [n, n];
  c.getContext("2d")!.putImageData(new ImageData(bytes, n, n), 0, 0);
  S.map.terrain = c;
}

/** The map's own listening: a site chosen and dragged, a place clicked, a site added. `changed` works the draft out again. */
export function mapListen(changed: () => void, redraw: () => void): void {
  let dragging: SiteDoc | null = null;
  let moved = false;
  const place = (e: PointerEvent): [number, number] | null => {
    const canvas = document.getElementById("map") as HTMLCanvasElement | null;
    const live = S.map.live;
    if (!canvas || !live || e.target !== canvas) return null;
    const box = canvas.getBoundingClientRect();
    return toWorld({ sizeX: live.size[0], sizeZ: live.size[1] }, ((e.clientX - box.left) / box.width) * side(), ((e.clientY - box.top) / box.height) * side(), side());
  };
  document.addEventListener("pointerdown", (e) => {
    const at = place(e), live = S.map.live;
    if (!at || !live) return;
    const reach = (10 * Math.max(live.size[0], live.size[1])) / side();
    dragging = siteNear(S.draft!.sites, at[0], at[1], reach);
    moved = false;
    if (dragging) S.map.site = dragging.key;
    else if (!inWorld({ sizeX: live.size[0], sizeZ: live.size[1] }, at[0], at[1])) return;
    else if (S.map.adding && S.map.circuit !== "") {
      S.map.site = addSite(S.draft!, S.map.circuit, at[0], at[1]) ?? "";
      return changed();
    } else [S.map.site, S.map.at] = ["", at];
    redraw();
  });
  document.addEventListener("pointermove", (e) => {
    const at = dragging ? place(e) : null;
    if (!at || !dragging) return;
    moveSite(S.draft!, dragging.key, at[0], at[1]);
    moved = true;
    if (S.l) mapDraw(S.l);
  });
  document.addEventListener("pointerup", () => {
    if (dragging && moved) {
      say(`moved ${dragging.key}: not saved yet`);
      changed();
    }
    dragging = null;
  });
}

/** The place a test drop is called at: the site chosen, else the place last clicked. */
export function dropPlace(): [number, number] | null {
  const site = S.draft!.sites.find((s) => s.key === S.map.site);
  return site ? [site.x, site.z] : S.map.at;
}

export { $ };
