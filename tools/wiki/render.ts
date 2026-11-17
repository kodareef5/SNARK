// Every page of the wiki as complete HTML, by path under BASE. A page needs no script to be read; the script plays
// sounds, moves the map, copies a console line, searches, and works a figure out again for the world a visitor came from.

import { BOX, type Atlas, type Mark } from "./atlas.ts";
import type { Cell, Entry, Kind, Ref, Table } from "./catalogue.ts";
import { KINDS, num, sentence, time } from "./catalogue.ts";
import type { ControlGroup } from "./controls.ts";
import { LEFT_OUT, type LeftOut } from "./coverage.ts";
import { BASE, SOURCE, esc, heading, img, page, pager, slug, type Assets } from "./html.ts";
import type { Drawn } from "./posters.ts";
import type { Command, Setting } from "./reference.ts";

export interface Sound {
  id: string;
  owner: string;
  name: string;
  file: string;
  at: number;
  rate: number;
  takes: (readonly [samples: number, bytes: number])[];
  /** It is in the file the game plays from. */
  game: boolean;
}

export interface Track {
  id: string;
  bpm: number;
  seconds: number;
  layers: { name: string; file: string }[];
}

export interface Site {
  assets: Assets;
  entries: Entry[];
  pictures: ReadonlyMap<string, Drawn>;
  /** What each entry's model and its motion are. */
  credits: ReadonlyMap<string, string>;
  atlases: Atlas[];
  sounds: Sound[];
  /** By entry, the ids of the sounds the game plays for it. */
  heard: ReadonlyMap<string, readonly string[]>;
  music: Track[];
  commands: Command[];
  settings: Setting[];
  engrams: { item: string; level: number; cost: number }[];
  /** Experience to reach each level from the first, and the engram points reaching it gives. */
  levels: { xp: readonly number[]; points: readonly number[] } | null;
  controls: ControlGroup[];
  /** What the wiki leaves out (coverage.ts), each reason with how many. */
  left: { why: LeftOut; count: number; names: string[] }[];
  /** What each id is called: entries, nodes and structures. */
  names: ReadonlyMap<string, string>;
}

/** Cards a list page holds, and sounds a sound page. */
export const PAGE = 60;
/** The front page's cards of the creatures and vehicles met most, a selection it says it is. */
export const FRONT_CARDS = 8;
const TITLES: Record<Kind, string> = { creatures: "Creatures", items: "Items", resources: "Resources", vehicles: "Vehicles", landmarks: "Landmarks", statuses: "Statuses", characters: "Characters" };

function groupBy<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
  return out;
}

const join = <T>(list: readonly T[], each: (t: T) => string): string => list.map(each).join("");
/** A take's length: hundredths below a second, tenths below a minute. */
const seconds = (s: number): string => (s < 60 ? `${num(s, s < 1 ? 2 : 1)} s` : time(s));
const groupPath = (group: string): string => `${BASE}items/group/${slug(group.toLowerCase().replace(/ /g, "_"))}/`;

export function entryPath(e: Pick<Entry, "kind" | "id">): string {
  return `${BASE}${e.kind}/${slug(e.id)}/`;
}

export function renderWiki(site: Site): Map<string, string> {
  const pages = new Map<string, string>();
  const write = (path: string, title: string, here: string, body: string): void => {
    if (pages.has(path)) throw new Error(`two pages of the wiki are at ${path}`);
    pages.set(path, page(site.assets, title, here, body));
  };
  const v = views(site);
  write("", "Home", "", v.front());
  for (const kind of KINDS) {
    const all = site.entries.filter((e) => e.kind === kind);
    const groups = [...new Set(all.map((e) => e.group))].sort();
    const chips = kind === "items" ? `<nav class="chips">${join(groups, (g) => `<a href="${groupPath(g)}">${esc(g)}</a>`)}</nav>` : "";
    const ordered = kind === "items" ? [...all].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)) : all;
    for (let at = 0; at * PAGE < Math.max(1, ordered.length); at++) {
      const shown = v.cards(ordered.slice(at * PAGE, (at + 1) * PAGE));
      const body = `${heading(TITLES[kind], `${all.length} in the game`)}${chips}${shown}${pager(`${BASE}${kind}/`, all.length, PAGE, at)}`;
      write(`${kind}/${at ? `page/${at + 1}/` : ""}`, TITLES[kind], kind, body);
    }
    for (const g of kind === "items" ? groups : []) {
      write(groupPath(g).slice(BASE.length), g, kind, `${heading(g, "Items")}${chips}${v.cards(all.filter((e) => e.group === g))}`);
    }
  }
  for (const e of site.entries) write(entryPath(e).slice(BASE.length), e.label, e.kind, v.entry(e));
  write("engrams/", "Engrams", "engrams", v.engrams());
  if (site.levels) write("levels/", "Levels", "engrams", v.levels(site.levels));
  write("maps/", "Maps", "maps", `${heading("Maps", `${site.atlases.length} maps`)}${v.maps()}`);
  for (const a of site.atlases) write(`maps/${a.slug}/`, a.label, "maps", atlasPage(a, site.names, site.entries.filter((e) => e.kind === "landmarks" && a.landmarks.some((l) => l.of === e.id)), v.cards));
  write("sounds/", "Sounds", "sounds", v.soundOwners());
  for (const [o, list] of v.owners) {
    for (let at = 0; at * PAGE < list.length; at++) {
      write(`sounds/${slug(o)}/${at ? `page/${at + 1}/` : ""}`, `${v.ownerName(o)} sounds`, "sounds", v.soundPage(o, list, at));
    }
  }
  write("music/", "Music", "sounds", v.music());
  write("controls/", "Controls", "controls", v.controls());
  write("commands/", "Commands", "commands", v.commands());
  write("settings/", "Server settings", "", v.settings());
  write("search/", "Search", "", v.search());
  write("credits/", "Credits", "", v.credits());
  return pages;
}

/** The parts pages are made of, over one site. */
function views(site: Site) {
  const byId = new Map(site.entries.map((e) => [e.id, e]));
  // A link to a thing with no page of its own shows the first map it grows on.
  const grows = new Map<string, string>();
  for (const a of site.atlases) for (const r of a.resources) if (!grows.has(r.of)) grows.set(r.of, `${BASE}maps/${a.slug}/?show=${r.id}`);
  const owners = groupBy(site.sounds, (s) => s.owner);
  const soundById = new Map(site.sounds.map((s) => [s.id, s]));
  const ownerName = (o: string): string => site.names.get(o) ?? o.slice(o.indexOf(":") + 1).replace(/[_/-]+/g, " ");
  const sortedOwners = new Map([...owners].sort(([a], [b]) => ownerName(a).localeCompare(ownerName(b))));

  const ref = (r: Ref): string => {
    const name = esc(site.names.get(r.id) ?? r.id);
    const e = byId.get(r.id);
    const href = e ? entryPath(e) : grows.get(r.id);
    return `${href ? `<a href="${href}">${name}</a>` : name}${r.note ? ` <small>${esc(r.note)}</small>` : ""}`;
  };
  const cell = (c: Cell): string => (typeof c === "string" ? esc(c) : "rate" in c ? `<span data-figure="${c.rate}" data-v="${esc(c.v)}">${esc(c.text)}</span>` : ref(c));
  const row = (r: readonly Cell[]): string => `<tr>${r.map((c, k) => (k === 0 ? `<th>${cell(c)}</th>` : `<td>${cell(c)}</td>`)).join("")}</tr>`;
  const table = (t: Table): string => {
    const head = `<thead><tr>${join(t.head, (h) => `<th>${cell(h)}</th>`)}</tr></thead>`;
    const note = t.note?.length ? `<p class="note">${t.note.map(cell).join("")}</p>` : "";
    const data = t.taming ? ` data-taming="${esc(JSON.stringify(t.taming))}"` : "";
    return `<section><h2>${esc(t.title)}</h2><div class="wide"><table${data}>${head}<tbody>${join(t.rows, row)}</tbody></table></div>${note}</section>`;
  };
  const card = (e: Entry): string => {
    const p = site.pictures.get(e.id);
    const picture = p ? img(p.card, "") : `<span class="blank">${esc(e.label.charAt(0))}</span>`;
    return `<a class="card" href="${entryPath(e)}">${picture}<b>${esc(e.label)}</b><small>${esc(e.line ?? e.group)}</small></a>`;
  };
  const cards = (list: readonly Entry[]): string => `<div class="cards">${join(list, card)}</div>`;
  // A sound's takes are play buttons of one group, each saying what it plays and how long it is, and filling as it sounds (--d).
  const sound = (s: Sound): string => {
    const n = s.takes.length;
    const of = `${ownerName(s.owner)} ${s.name}`.toLowerCase();
    const takes = s.takes.map(([samples], k) => {
      const long = samples / s.rate;
      const said = `Play ${of}${n > 1 ? `, take ${k + 1} of ${n}` : ""}, ${seconds(long)}`;
      return `<button type="button" class="take" data-k="${k}" aria-pressed="false" aria-label="${esc(said)}" style="--d:${long.toFixed(3)}s">${n > 1 ? `<b>${k + 1}</b>` : ""}<small>${seconds(long)}</small></button>`;
    }).join("");
    const data = `data-file="/assets/${esc(s.file)}" data-at="${s.at}" data-rate="${s.rate}" data-takes="${s.takes.map((t) => t.join(":")).join(" ")}"`;
    const later = s.game ? "" : ' <i class="tag">Not in the game yet</i>';
    const count = n > 1 ? ` <small>${n} takes</small>` : "";
    return `<li class="sound" ${data}><span>${esc(s.name)}${count}${later}</span><span class="takes" role="group" aria-label="${esc(`${sentence(of)}, ${n} ${n === 1 ? "take" : "takes"}`)}">${takes}</span></li>`;
  };
  // A map's card says what it holds besides its ground: its landmarks by name. Read from a server, the page adds the worlds
  // running each (data-maps, client/core/wiki/world.ts).
  const maps = (): string =>
    `<div class="cards" data-maps="every">${join(site.atlases, (a) => {
      const holds = [extent(a), ...a.landmarks.map((l) => site.names.get(l.of) ?? l.of)].join(" · ");
      return `<div class="card map" data-map="${esc(a.id)}"><a href="${BASE}maps/${a.slug}/">${img(a.card, "")}<b>${esc(a.label)}</b><small>${esc(holds)}</small></a></div>`;
    })}</div>`;

  const front = (): string => {
    const shelves: [string, string, string][] = [
      ...KINDS.map((k): [string, string, string] => [`${k}/`, TITLES[k], String(site.entries.filter((e) => e.kind === k).length)]),
      ["engrams/", "Engrams", String(site.engrams.length)],
      ...(site.levels ? [["levels/", "Levels", String(site.levels.xp.length)] as [string, string, string]] : []),
      ["maps/", "Maps", String(site.atlases.length)],
      ["sounds/", "Sounds", `${owners.size} owners`],
      ["music/", "Music", `${site.music.length} tracks`],
      ["controls/", "Controls", `${site.controls.length} groups`],
      ["commands/", "Commands", String(site.commands.length)],
    ];
    // The creatures and vehicles a player meets most on the maps, by spawn regions and by vehicles parked.
    const met = (e: Entry): number => site.atlases.reduce((n, a) => n + (a.creatures.find((l) => l.of === e.id)?.count ?? 0) + (a.vehicles.find((v) => v.kind === e.id)?.count ?? 0), 0);
    const featured = site.entries.filter((e) => e.kind === "creatures" || e.kind === "vehicles").sort((a, b) => met(b) - met(a) || a.label.localeCompare(b.label)).slice(0, FRONT_CARDS);
    const every = `<p class="note"><a href="${BASE}creatures/">Every creature</a> · <a href="${BASE}vehicles/">Every vehicle</a></p>`;
    const left = site.left.map((l) => `${LEFT_OUT[l.why]}${l.names.length ? `: ${l.names.join(", ")}` : ""}`);
    const missing = left.length ? `<p class="note">Not in the wiki: ${esc(left.join("; "))}.</p>` : "";
    return `${heading("Wiki", "", "Creatures, items, maps and the console, read from the game itself.")}
<form class="find big" action="${BASE}search/" role="search"><input name="q" aria-label="Search the wiki" placeholder="Raptor, wooden foundation, pistol…"></form>
<nav class="shelves">${join(shelves, ([path, label, n]) => `<a href="${BASE}${path}"><b>${label}</b><small>${n}</small></a>`)}<a href="${SOURCE}"><b>Source code</b></a></nav>
<section><h2>The creatures and vehicles met most</h2>${cards(featured)}${every}</section>
<section><h2>Maps</h2>${maps()}</section>
${missing}`;
  };

  const entry = (e: Entry): string => {
    const p = site.pictures.get(e.id);
    const credit = site.credits.get(e.id);
    const pictures = p ? p.views.map((view, k) => img(view, k === 0 ? e.label : `${e.label} from the side`, k > 0)).join("") : "";
    const figure = pictures ? `<figure class="views">${pictures}${credit ? `<figcaption>${esc(credit)}</figcaption>` : ""}</figure>` : "";
    const facts = join(e.facts, (f) => `<dt>${esc(f.label)}</dt><dd>${f.value.map(cell).join("")}</dd>`);
    const line = e.console
      ? `<p class="console"><code id="console">${esc(e.console)}</code><button type="button" data-copy="console">Copy</button></p><p class="note">In the console, with cheats on.</p>`
      : "";
    const lives = site.atlases.flatMap((a) => {
      const link = (show: string): string => `<a href="${BASE}maps/${a.slug}/?show=${esc(show)}">${esc(a.label)}</a>`;
      const layer = a.creatures.find((l) => l.of === e.id);
      const parked = a.vehicles.find((v) => v.kind === e.id);
      const grown = a.resources.find((r) => r.of === e.id);
      if (layer) return [`<li>${link(slug(e.id))}: ${layer.count} spawn ${layer.count === 1 ? "region" : "regions"}</li>`];
      if (grown) return [`<li>${link(grown.id)}: ${num(grown.count)} grow</li>`];
      if (a.landmarks.some((l) => l.of === e.id)) return [`<li>${link("landmarks")}</li>`];
      return parked ? [`<li>${link(slug(e.id))}: ${parked.count} parked</li>`] : [];
    });
    const title = e.kind === "vehicles" ? "Where to find one" : e.kind === "resources" ? "Where it grows" : e.kind === "landmarks" ? "Where it stands" : "Where it lives";
    const where = lives.length ? `<section><h2>${title}</h2><ul class="places">${lives.join("")}</ul></section>` : "";
    const heard = (site.heard.get(e.id) ?? []).map((id) => soundById.get(id)!).sort((a, b) => a.name.localeCompare(b.name));
    const every = owners.has(e.id) ? `<p class="note"><a href="${BASE}sounds/${slug(e.id)}/">Every sound of the ${esc(e.label.toLowerCase())}</a></p>` : "";
    const sounds = heard.length ? `<section><h2>What it sounds like</h2><ul class="sounds">${join(heard, sound)}</ul>${every}</section>` : "";
    const related = join(e.related, (g) => `<dt>${esc(g.relation)}</dt><dd>${g.refs.map(ref).join(", ")}</dd>`);
    return `<article class="entry">${heading(e.label, e.group)}
<div class="lead">${figure}<aside class="facts glass"><dl>${facts}</dl>${line}</aside></div>
${e.tables.map(table).join("\n")}
${where}
${sounds}
${related ? `<section><h2>Related</h2><dl class="related">${related}</dl></section>` : ""}</article>`;
  };

  const engrams = (): string => {
    const name = (id: string): string => site.names.get(id) ?? id;
    const rows = [...site.engrams].sort((a, b) => a.level - b.level || name(a.item).localeCompare(name(b.item)));
    const lines = join(rows, (r) => `<tr><td>${r.level}</td><th>${ref({ id: r.item })}</th><td>${r.cost}</td></tr>`);
    const lede = "What a survivor may learn at each level, and the points it costs.";
    const levels = site.levels ? `<p><a href="${BASE}levels/">The experience each level takes, and the points it gives</a></p>` : "";
    return `${heading("Engrams", `${rows.length} to learn`, lede)}${levels}<div class="wide"><table><thead><tr><th>Level</th><th>Engram</th><th>Points</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  };

  const levels = (l: NonNullable<Site["levels"]>): string => {
    const lines = l.xp.map((xp, i) => `<tr><th>${i + 1}</th><td>${num(xp)}</td><td>${l.points[i] ? `+${l.points[i]}` : ""}</td></tr>`).join("");
    const lede = "The experience a survivor has in all on reaching each level, and the engram points that level gives to spend.";
    return `${heading("Levels", `${l.xp.length} levels`, lede)}<p><a href="${BASE}engrams/">What the points learn</a></p><div class="wide"><table><thead><tr><th>Level</th><th>Experience</th><th>Engram points</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  };

  const soundOwners = (): string => {
    const lede = "Each as the game plays it, decoded from the game's own sound files. Sounds not in the game yet are marked.";
    const list = join([...sortedOwners], ([o, l]) => `<li><a href="${BASE}sounds/${slug(o)}/">${esc(ownerName(o))}</a> <small>${l.length}</small></li>`);
    return `${heading("Sounds", `${site.sounds.length} sounds`, lede)}<ul class="list">${list}</ul>`;
  };
  const soundPage = (o: string, list: readonly Sound[], at: number): string => {
    const e = byId.get(o);
    const back = e ? `<p><a href="${entryPath(e)}">${esc(e.label)}</a></p>` : "";
    const shown = join(list.slice(at * PAGE, (at + 1) * PAGE), sound);
    return `${heading(ownerName(o), "Sounds")}${back}<ul class="sounds">${shown}</ul>${pager(`${BASE}sounds/${slug(o)}/`, list.length, PAGE, at)}`;
  };

  const music = (): string => {
    const track = (t: Track): string => {
      const layers = join(t.layers, (l) => `<li><span>${esc(l.name)}</span><audio controls preload="none" src="/assets/music/${esc(t.id)}/${esc(l.file)}"></audio></li>`);
      return `<section><h2>${esc(t.id.replace(/_/g, " "))} <small>${time(t.seconds)}, ${num(t.bpm)} beats a minute</small></h2><ul class="layers">${layers}</ul></section>`;
    };
    return `${heading("Music", `${site.music.length} tracks`, "Each track in its layers, from calm to the height of a fight.")}${join(site.music, track)}`;
  };

  const controls = (): string => {
    const rows = (list: ControlGroup["keys"], what: string): string =>
      list.length ? `<table><thead><tr><th>${what}</th><th>Does</th></tr></thead><tbody>${join(list, (c) => `<tr><th>${esc(c.keys.join(" or "))}</th><td>${esc(c.title)}${c.detail ? `<br><small>${esc(c.detail)}</small>` : ""}</td></tr>`)}</tbody></table>` : "";
    const groups = join(site.controls, (g) => `<section id="${slug(g.name.toLowerCase())}"><h2>${esc(g.name)}</h2>${rows(g.keys, "Key")}${rows(g.pad, "Gamepad")}</section>`);
    return `${heading("Controls", `${site.controls.length} groups`, "Each key and gamepad button, as the game's own controls screen gives them.")}${groups}`;
  };

  const commands = (): string => {
    const command = (c: Command): string => {
      const examples = c.examples.length ? `<br>${c.examples.map((x) => `<code>${esc(x)}</code>`).join(" ")}` : "";
      return `<dt><code>${esc(c.name)}${c.usage ? ` ${esc(c.usage)}` : ""}</code>${c.admin ? ' <i class="tag">Admin</i>' : ""}</dt><dd>${esc(c.help)}${examples}</dd>`;
    };
    const lede = "Typed in the console. An admin command needs cheats on: enablecheats and the server's password.";
    const families = join([...groupBy(site.commands, (c) => c.family)], ([family, list]) => `<section><h2>${esc(family)}</h2><dl class="commands">${join(list, command)}</dl></section>`);
    return `${heading("Commands", `${site.commands.length} commands`, lede)}${families}`;
  };

  const settings = (): string => {
    const lede = "What a server may change of the game, as ARK names it, and its value if the server says nothing.";
    const rows = join(site.settings, (s) => `<tr><th><code>${esc(s.name)}</code><br><small>${esc(s.where)}</small></th><td data-setting="${esc(s.name)}">${esc(s.def)}</td><td>${esc(s.doc)}</td></tr>`);
    const head = "<thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>";
    return `${heading("Server settings", `${site.settings.length} settings`, lede)}<div class="wide"><table>${head}<tbody>${rows}</tbody></table></div>`;
  };

  const search = (): string =>
    `${heading("Search")}<form class="find big" action="${BASE}search/" role="search"><input name="q" aria-label="Search the wiki" autofocus></form>
<ol class="results" data-search="${site.assets.search}"></ol><noscript><p>Searching needs JavaScript. Every page is reached from the lists without it.</p></noscript>`;

  const credits = (): string => {
    const by = groupBy([...site.credits], ([, c]) => c);
    const models = join([...by].sort(([a], [b]) => a.localeCompare(b)), ([c, list]) => `<li>${esc(c.replace(/\.$/, ""))}: ${list.map(([id]) => ref({ id })).join(", ")}</li>`);
    const sources = join(site.atlases, (a) => `<dt>${esc(a.label)}</dt><dd>${a.sources.map(esc).join("; ")}</dd>`);
    return `${heading("Credits")}<section><h2>Models and motion</h2><ul class="list">${models}</ul></section>
<section><h2>Maps</h2><dl class="related">${sources}</dl></section>
${site.assets.font ? '<section><h2>Type</h2><p>Barlow Semi Condensed, under the <a href="/assets/hud-font-license.txt">SIL Open Font License</a>.</p></section>' : ""}`;
  };

  return { owners: sortedOwners, ownerName, ref, cards, maps, front, entry, engrams, levels, soundOwners, soundPage, music, controls, commands, settings, search, credits };
}

const at1 = (n: number): number => Math.round(n * 10) / 10;

/** "8.1 km across", or for a map that is not square "12 by 8 km", west to east first. */
function extent(a: Atlas): string {
  const [w, d] = a.metres;
  return w === d ? `${num(w / 1000, 1)} km across` : `${num(w / 1000, 1)} by ${num(d / 1000, 1)} km`;
}

/** A map's page: the map with its layers, and under it a card for each landmark it places, as its dot and its row lead to. */
function atlasPage(a: Atlas, names: ReadonlyMap<string, string>, placed: readonly Entry[], cards: (list: readonly Entry[]) => string): string {
  const name = (id: string): string => names.get(id) ?? id;
  const box = (show: string, label: string, count: string, colour: string, on = false): string =>
    `<label><input type="checkbox" data-show="${esc(show)}"${on ? " checked" : ""}><i style="--c:${colour}"></i>${esc(label)} <small>${count}</small></label>`;
  const regions = (id: string): string =>
    join(a.regions.filter((r) => r.species.includes(id)), (r) => {
      if (!r.half) return `<circle cx="${r.x}" cy="${r.y}" r="${Math.max(1, r.r)}"/>`;
      return `<rect x="${at1(r.x - r.half[0])}" y="${at1(r.y - r.half[1])}" width="${at1(r.half[0] * 2)}" height="${at1(r.half[1] * 2)}"/>`;
    });
  const marks = (list: Mark[], cls: string): string =>
    join(list, (m) => `<g class="${cls}" transform="translate(${m.x} ${m.y})"><circle r="5"/>${m.name ? `<text y="-9">${esc(m.name)}</text>` : ""}</g>`);
  const districts = join(a.districts, (d) => `<polygon points="${d.points.map((p) => p.join(",")).join(" ")}"/><text x="${d.at.x}" y="${d.at.y}">${esc(d.name)}</text>`);
  // A landmark with a page is a link there, as its dot and as its row of the layers.
  const landmarks = a.landmarks.map((l) => ({ ...l, name: name(l.of), entry: placed.find((e) => e.id === l.of) }));
  const linked = (href: string | undefined, inner: string): string => (href ? `<a href="${href}">${inner}</a>` : inner);
  const dots = join(landmarks, (l) => linked(l.entry && entryPath(l.entry), marks([l], "landmark")));
  // The box is BOX wide and as deep as the map's proportions, as the overlays were placed (atlas.ts).
  const svg = `<svg class="marks" viewBox="0 0 ${BOX} ${at1((BOX * a.metres[1]) / a.metres[0])}" aria-hidden="true">
<g data-layer="districts">${districts}</g>
${a.creatures.map((c) => `<g data-layer="${esc(c.id)}" class="region" style="--c:${c.colour}" hidden>${regions(c.of)}</g>`).join("\n")}
${a.vehicles.map((v) => `<g data-layer="${esc(slug(v.kind))}" class="parked" hidden>${join(v.at, (m) => `<circle cx="${m.x}" cy="${m.y}" r="4"/>`)}</g>`).join("\n")}
<g data-layer="obelisks">${marks(a.obelisks, "obelisk")}</g>
<g data-layer="landmarks">${dots}</g>
<g data-layer="spawns">${marks(a.spawns, "spawn")}</g>
</svg>`;
  const layers = join(a.resources, (r) => `<img class="layer" data-layer="${esc(r.id)}" data-src="${esc(r.picture!.file)}" width="${r.picture!.width}" height="${r.picture!.height}" alt="" hidden>`);
  const resources = [...a.resources].sort((p, q) => name(p.of).localeCompare(name(q.of)));
  const places = [
    box("districts", "Districts", String(a.districts.length), "#e9eef5", true),
    box("spawns", "Where survivors arrive", String(a.spawns.length), "#9fe3ff", true),
    box("obelisks", "Obelisks", String(a.obelisks.length), "#d8b4ff", true),
    ...(landmarks.length ? [box("landmarks", "Landmarks", String(landmarks.length), "#ffb38a", true)] : []),
    ...landmarks.map((l) => linked(l.entry && entryPath(l.entry), esc(l.name))),
  ].join("");
  const panel = `<aside class="layers glass">
<fieldset><legend>Places</legend>${places}</fieldset>
<fieldset><legend>Creatures</legend>${join(a.creatures, (c) => box(c.id, name(c.of), `${c.count} regions`, c.colour))}</fieldset>
<fieldset><legend>Resources</legend>${join(resources, (r) => box(r.id, name(r.of), num(r.count), r.colour))}</fieldset>
<fieldset><legend>Vehicles</legend>${join(a.vehicles, (v) => box(slug(v.kind), name(v.kind), `${v.count} parked`, "#ffd479"))}</fieldset>
</aside>`;
  const button = (by: number, label: string, text: string): string => `<button type="button" data-zoom="${by}" aria-label="${label}">${text}</button>`;
  const zoom = `<div class="zoom">${button(1, "Zoom in", "+")}${button(-1, "Zoom out", "−")}${button(0, "Whole map", "⤢")}</div>`;
  const standing = placed.length ? `<section><h2>Landmarks</h2>${cards(placed)}</section>` : "";
  return `${heading(a.label, "Map", `${extent(a)}. North is up.`)}<div data-maps><div class="note" data-map="${esc(a.id)}"></div></div>
<div class="atlas"><div><div class="viewport" data-atlas tabindex="0" style="aspect-ratio:${a.metres[0]} / ${a.metres[1]}" aria-label="Map of ${esc(a.label)}: drag to move, plus and minus to zoom">
<div class="plane">${img(a.ground, `${a.label} from above`, false, "ground")}${layers}${svg}</div>${zoom}</div>${standing}</div>
${panel}</div>`;
}
