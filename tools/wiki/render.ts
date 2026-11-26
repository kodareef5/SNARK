// Every page of the wiki as complete HTML, by path under BASE. A page needs no script to be read; the script plays
// sounds, moves the map, copies a console line, searches, and works a figure out again for the world a visitor came from.

import { renderSound, renderTrack, type Sound, type Track } from "./audio.ts";
import { buildDirectory } from "./directories.ts";
import { GUIDES, guidePath, type Guide } from "./guides.ts";
import { BOX, type Atlas, type Mark } from "./atlas.ts";
import { fleetTables } from "./driving.ts";
import type { Cell, Entry, Kind, Ref, Table } from "./catalogue.ts";
import { KINDS, num } from "./catalogue.ts";
import type { ControlGroup } from "./controls.ts";
import { LEFT_OUT, type LeftOut } from "./coverage.ts";
import { BASE, contents, esc, fullPhoto, heading, img, page, pager, sectionId, slug, trail, type Assets, type Image } from "./html.ts";
import type { PlaceShot } from "./places-shots.ts";
import type { WikiScene } from "./scenes.ts";
import type { Drawn } from "./posters.ts";
import type { Command, Setting } from "./reference.ts";
import { RANK_NAMES } from "../../shared/ranks.ts";

export type { Sound, Track } from "./audio.ts";

export interface Site {
  assets: Assets;
  entries: Entry[];
  pictures: ReadonlyMap<string, Drawn>;
  scenes?: ReadonlyMap<string, WikiScene>;
  places?: ReadonlyMap<string, readonly PlaceShot[]>;
  itemGroups?: ReadonlyMap<string, { picture: Image; members: readonly Entry[] }>;
  itemSwatches?: ReadonlySet<string>;
  models?: ReadonlyMap<string, { url: string; descriptor: string }>;
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
const TITLES: Record<Kind, string> = { creatures: "Creatures", items: "Items", resources: "Resources", vehicles: "Vehicles", landmarks: "Landmarks", statuses: "Statuses", characters: "Characters" };

function groupBy<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of list) {
    const name = key(t);
    const group = out.get(name);
    if (group) group.push(t);
    else out.set(name, [t]);
  }
  return out;
}

const join = <T>(list: readonly T[], each: (t: T) => string): string => list.map(each).join("");
const groupPath = (group: string): string => `${BASE}items/group/${slug(group.toLowerCase().replace(/ /g, "_"))}/`;

export const commandId = (name: string): string => `command-${sectionId(name)}`;
export const settingId = (name: string): string => `setting-${sectionId(name)}`;

export function entryPath(e: Pick<Entry, "kind" | "id">): string {
  return `${BASE}${e.kind}/${slug(e.id)}/`;
}

export function renderWiki(site: Site): Map<string, string> {
  const pages = new Map<string, string>();
  const write = (path: string, title: string, here: string, body: string): void => {
    if (pages.has(path)) throw new Error(`two pages of the wiki are at ${path}`);
    pages.set(path, page(site.assets, title, here, path, body, site.scenes?.get("footer")));
  };
  const v = views(site);
  write("", "SNARK Wiki", "", v.front());
  write("guides/", "Guides", "guides", v.guides());
  for (const g of GUIDES) write(guidePath(g.slug).slice(BASE.length), g.title, "guides", v.guide(g));
  write("reference/", "Reference", "reference", v.reference());
  write("server/", "Server & controls", "server", v.server());
  write("about/", "About the wiki", "", v.about());
  for (const kind of KINDS) {
    const all = site.entries.filter((e) => e.kind === kind);
    const groups = [...new Set(all.map((e) => e.group))].sort();
    const chips = kind === "items" && groups.length ? `<details class="categories"><summary>Browse item categories</summary><nav class="chips" aria-label="Item categories">${join(groups, (g) => `<a href="${groupPath(g)}">${esc(g)}</a>`)}</nav></details>` : "";
    const ordered = kind === "items" ? [...all].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label)) : all;
    const compared = kind === "vehicles" && all.length ? `<div id="compare"><h2>Compare vehicles</h2>${fleetTables(all).map(v.table).join("")}</div>` : "";
    const compareLink = compared ? '<p><a href="#compare">Compare vehicle handling</a></p>' : "";
    const title = TITLES[kind];
    const grouped = kind === "items" ? v.groupGallery(groups, all) : "";
    const directory = v.directory(kind, ordered);
    const catalogue = grouped
      ? `<p><a href="#item-index">Jump to every item</a></p>${grouped}<section id="item-index"><h2>All items</h2>${directory}</section>`
      : chips + directory;
    write(`${kind}/`, title, kind, `${trail([[`${BASE}reference/`, "Reference"]])}${v.banner(`${kind}/`, title)}${compareLink}${catalogue}${compared}`);
    for (let at = 1; at * PAGE < ordered.length; at++) {
      const path = `${BASE}${kind}/`;
      write(`${kind}/page/${at + 1}/`, title, kind, `${trail([[path, title]])}${heading(title, `Page ${at + 1}`)}<p><a href="${path}">Browse all ${title.toLowerCase()}</a></p>${v.directory(kind, ordered.slice(at * PAGE, (at + 1) * PAGE))}${pager(path, ordered.length, PAGE, at)}`);
    }
    for (const g of kind === "items" ? groups : []) {
      const members = all.filter((e) => e.group === g);
      write(groupPath(g).slice(BASE.length), g, kind, `${trail([[`${BASE}items/`, "Items"]])}${v.groupBanner(g)}${chips}${v.cards(members, g)}<details class="item-comparison"><summary>Compare ${esc(g.toLowerCase())}</summary>${v.directory(kind, members)}</details>`);
    }
  }
  for (const e of site.entries) write(entryPath(e).slice(BASE.length), e.label, e.kind, v.entry(e));
  write("engrams/", "Engrams", "engrams", v.engrams());
  if (site.levels) write("levels/", "Levels", "engrams", v.levels(site.levels));
  write("maps/", "Maps", "maps", `${v.banner("maps/", "Maps")}${v.maps()}${v.obelisks()}`);
  for (const a of site.atlases) write(`maps/${a.slug}/`, a.label, "maps", atlasPage(a, site.names, v.entryLink, site.places?.get(a.slug) ?? [], site.entries.filter((e) => e.kind === "landmarks" && a.landmarks.some((l) => l.of === e.id)), v.cards));
  write("sounds/", "Sounds", "sounds", v.soundOwners());
  for (const [o, list] of v.owners) {
    for (let at = 0; at * PAGE < list.length; at++) {
      write(`sounds/${slug(o)}/${at ? `page/${at + 1}/` : ""}`, `${v.ownerName(o)} sounds`, "sounds", v.soundPage(o, list, at));
    }
  }
  write("music/", "Music", "music", v.music());
  write("controls/", "Controls", "controls", v.controls());
  write("commands/", "Commands", "commands", v.commands());
  write("settings/", "Server settings", "settings", v.settings());
  write("search/", "Search", "search", v.search());
  write("credits/", "Credits", "", v.credits());
  return pages;
}

const COVER_SIZES = "(min-width: 90rem) 76rem, (min-width: 52rem) calc(100vw - 16rem), 100vw";

function titleCard(title: string, scene: WikiScene, kicker = "", lede = ""): string {
  return `<header class="section-banner photo-cover">
${img(scene.picture, scene.alt, false, "cover-art", COVER_SIZES)}
<div class="cover-copy">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}<h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}</div>
${fullPhoto(scene.picture, scene.caption || title)}
</header>`;
}

/** The parts pages are made of, over one site. */
function views(site: Site) {
  const byId = new Map(site.entries.map((e) => [e.id, e]));
  const banner = (path: string, title: string, kicker = "", lede = ""): string => {
    const scene = site.scenes?.get(path);
    return scene ? titleCard(title, scene, kicker, lede) : heading(title, kicker, lede);
  };
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
  const entryLink = (id: string): string | undefined => {
    const entry = byId.get(id);
    return entry && entryPath(entry);
  };
  const cell = (c: Cell): string => (typeof c === "string" ? esc(c) : "rate" in c ? `<span data-figure="${c.rate}" data-v="${esc(c.v)}">${esc(c.text)}</span>` : ref(c));
  const part = (c: Cell | readonly Cell[]): string => {
    if (!Array.isArray(c)) return cell(c as Cell);
    return c.map((item, i) => `${i && typeof item === "object" && "id" in item && typeof c[i - 1] === "object" && "id" in c[i - 1]! ? ", " : ""}${cell(item)}`).join("");
  };
  const row = (r: readonly (Cell | readonly Cell[])[]): string => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${part(c)}</th>` : `<td>${part(c)}</td>`)).join("")}</tr>`;
  const table = (t: Table): string => {
    const id = sectionId(t.title);
    const head = `<thead><tr>${join(t.head, (h) => `<th scope="col">${cell(h)}</th>`)}</tr></thead>`;
    const note = t.note?.length ? `<p class="note">${t.note.map(cell).join("")}</p>` : "";
    const data = t.taming ? ` data-taming="${esc(JSON.stringify(t.taming))}"` : "";
    const tools = t.taming ? '<form class="taming-tools" data-taming-tools hidden><label>Wild level <input name="level" type="number" min="1" step="1"></label><output aria-live="polite"></output></form>' : "";
    const result = t.taming ? "<tbody data-taming-result hidden></tbody>" : "";
    return `<section id="${id}"><h2>${esc(t.title)}</h2>${tools}<div class="wide" role="region" aria-label="${esc(t.title)} table" tabindex="0"><table${data}>${head}<tbody>${join(t.rows, row)}</tbody>${result}</table></div>${note}</section>`;
  };
  const card = (e: Entry, category?: string): string => {
    const p = site.pictures.get(e.id);
    const picture = p ? img({ ...p.views[0]!, small: p.card }, "", true, "", "(min-width: 52rem) 26vw, 50vw") : `<span class="blank">${esc(e.label.charAt(0))}</span>`;
    const detail = e.line ?? e.group;
    return `<a class="card" href="${entryPath(e)}">${picture}<b>${esc(e.label)}</b>${detail && detail !== category ? `<small>${esc(detail)}</small>` : ""}</a>`;
  };
  const cards = (list: readonly Entry[], category?: string): string => `<div class="cards">${join(list, (entry) => card(entry, category))}</div>`;
  const sound = (s: Sound): string => renderSound(s, ownerName(s.owner));
  const directory = (kind: Kind, entries: readonly Entry[]): string => {
    const data = buildDirectory(kind, entries);
    if (!entries.length) return "<p>No entries in this build.</p>";
    if (!data && entries.some((entry) => site.pictures.has(entry.id))) return cards(entries);
    if (!data) return `<ul class="directory-simple">${join(entries, (e) => `<li><a href="${entryPath(e)}">${esc(e.label)}</a><small>${esc(e.line ?? e.group)}</small></li>`)}</ul>`;
    const label = (e: Entry): string => {
      const picture = site.pictures.get(e.id)?.card;
      return `<a class="directory-name" href="${entryPath(e)}">${picture ? img(picture, "") : ""}<span>${esc(e.label)}</span></a>`;
    };
    const filter = `<div class="directory-tools" data-directory-tools hidden>${join(data.filters, (f) => `<label>${esc(f.label)} <select data-filter="${esc(f.key)}"><option value="">All</option>${join(f.values, (v) => `<option>${esc(v)}</option>`)}</select></label>`)}<p data-directory-count aria-live="polite"></p></div>`;
    const rows = join(data.rows, ({ entry, cells, filters }) => `<tr data-directory-row="${esc(JSON.stringify(filters))}"><th scope="row">${label(entry)}</th>${join(cells, (c) => `<td>${part(c)}</td>`)}</tr>`);
    return `<div data-directory>${filter}<div class="wide" role="region" aria-label="${TITLES[kind]} directory" tabindex="0"><table class="directory"><thead><tr><th scope="col">Name</th>${join(data.columns, (title) => `<th scope="col">${esc(title)}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };
  const visualLink = (path: string, title: string, desc: string, picture?: Image, sizes = "(min-width: 52rem) 25vw, 50vw"): string => `<li class="visual-link"><a href="${path}">${picture ? img(picture, "", true, "", sizes) : ""}<span><b>${esc(title)}</b>${desc ? `<small>${esc(desc)}</small>` : ""}</span></a></li>`;
  const groupCaption = (members: readonly Entry[]): string => members.map((e) => e.label).join(" · ");
  const groupBanner = (group: string): string => {
    const art = site.itemGroups?.get(group);
    if (!art) return heading(group);
    return `<header class="group-title"><h1>${esc(group)}</h1>
<figure class="group-plate"><a href="${esc(art.picture.file)}">${img(art.picture, groupCaption(art.members), false, "", COVER_SIZES)}</a><figcaption>${esc(groupCaption(art.members))}</figcaption></figure></header>`;
  };
  const groupGallery = (groups: readonly string[], entries: readonly Entry[]): string => {
    if (!site.itemGroups?.size) return "";
    return `<ul class="visual-links collections" aria-label="Item groups">${join(groups, (group) => {
      const art = site.itemGroups!.get(group);
      const count = entries.filter((e) => e.group === group).length;
      return visualLink(groupPath(group), group, `${count} ${count === 1 ? "item" : "items"}`, art?.picture);
    })}</ul>`;
  };
  // A map's card says what it holds besides its ground: its landmarks by name. Read from a server, the page adds the worlds
  // running each (data-maps, client/core/wiki/world.ts).
  const maps = (): string =>
    `<div class="cards" data-maps="every">${join(site.atlases, (a) => {
      const holds = [extent(a), ...a.landmarks.map((l) => site.names.get(l.of) ?? l.of)].join(" · ");
      const photo = site.places?.get(a.slug)?.find((shot) => shot.kind === "city");
      const cover = photo ?? a.card;
      return `<div class="card map" data-map="${esc(a.id)}"><a href="${BASE}maps/${a.slug}/">${img(cover, photo?.alt ?? "", true, "", "(min-width: 52rem) 37vw, 70vw")}<b>${esc(a.label)}</b><small>${esc(holds)}</small></a></div>`;
    })}</div>`;

  const obelisks = (): string => {
    const places = site.atlases.flatMap((atlas) => (site.places?.get(atlas.slug) ?? [])
      .filter((shot) => shot.kind === "obelisk").map((shot) => ({ atlas, shot })));
    if (!places.length) return "";
    const instruments = [
      ["miami", "sextant", "Red Sextant"],
      ["tampa", "lantern", "Green Louver Lantern"],
      ["san-francisco", "tide-eye", "Blue Tide Eye"],
    ] as const;
    const cards = instruments.flatMap(([city, name, title]) => {
      const place = places.find((p) => p.atlas.slug === city && p.shot.name === name) ?? places.find((p) => p.shot.name === name);
      return place ? [{ ...place, title }] : [];
    });
    const shown = cards.length ? cards : places.map((p) => ({ ...p, title: p.shot.caption }));
    return `<section><h2>Obelisks</h2><ul class="visual-links obelisks">${join(shown, ({ atlas, shot, title }) =>
      visualLink(`${BASE}maps/${atlas.slug}/#${shot.name ? `photo-${slug(shot.name)}` : "obelisk-photos"}`, title, atlas.label, shot, "(min-width: 52rem) 28vw, 100vw"))}</ul></section>`;
  };
  const links = (entries: readonly (readonly [string, string, string])[], sizes?: string): string => {
    const hasPictures = entries.some(([path]) => site.scenes?.has(path));
    if (!hasPictures) return `<ul class="link-list">${join(entries, ([path, label, desc]) => `<li><a href="${BASE}${path}">${esc(label)}</a>${desc ? `<p>${esc(desc)}</p>` : ""}</li>`)}</ul>`;
    return `<ul class="visual-links">${join(entries, ([path, label, desc]) => {
      const scene = site.scenes?.get(path);
      return visualLink(`${BASE}${path}`, label, desc, scene?.picture, sizes);
    })}</ul>`;
  };

  const front = (): string => {
    const scene = site.scenes?.get("");
    const logo = site.assets.logo;
    const browse = [
      ["guides/", "Survival guides", "First tools, shelter, and tames"],
      ["vehicles/", "Vehicles", "On the road, on the water, and in the air"],
      ["creatures/", "Browse creatures", "Taming, breeding, and saddles"],
      ["characters/", "Characters", "The survivor and city residents"],
      ["items/", "Items & recipes", "Ingredients, stations, and unlocks"],
    ] as const;
    const plate = scene ? `<picture>${scene.portrait ? `<source media="(max-width: 35rem)" srcset="${esc(scene.portrait.file)}" width="${scene.portrait.width}" height="${scene.portrait.height}">` : ""}${img(scene.picture, scene.alt, false, "hero-art", COVER_SIZES)}</picture>` : "";
    return `<header class="front-lead photo-cover">
${plate}
<div class="front-intro">${logo ? img(logo, "SNARK emblem", false) : ""}<h1>SNARK Wiki</h1>
<p>Find a tame, look up a recipe, or scout a site for your next base.</p>
<a class="hero-action" href="${guidePath("getting-started")}">Getting started <span aria-hidden="true">→</span></a></div>
${scene ? fullPhoto(scene.picture, scene.caption) : ""}
</header>
<section class="front-browse" aria-labelledby="browse"><h2 id="browse">Explore the wiki</h2>${links(browse, "(min-width: 52rem) 38vw, 95vw")}</section>
<section aria-labelledby="front-maps"><div class="section-heading"><h2 id="front-maps">Cities &amp; worlds</h2><a href="${BASE}maps/">All maps</a></div>${maps()}</section>${obelisks()}`;
  };

  const guides = (): string => `${banner("guides/", "Guides")}${links(GUIDES.map((g) => [guidePath(g.slug).slice(BASE.length), g.title, g.summary]))}`;
  const guide = (g: Guide): string => `<article class="guide">${trail([[`${BASE}guides/`, "Guides"]])}${banner(guidePath(g.slug).slice(BASE.length), g.title, "", g.summary)}
${contents(g.sections.map((s) => [s.id, s.title]))}${join(g.sections, (s) => `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${join(s.steps, (step) => `<p>${join(step, (p) => typeof p === "string" ? esc(p) : "id" in p ? ref(p) : `<a href="${esc(p.href)}">${esc(p.text)}</a>`)}</p>`)}</section>`)}</article>`;
  const reference = (): string => `${banner("reference/", "Reference")}${links([
    ...KINDS.map((k): [string, string, string] => [`${k}/`, TITLES[k], ""]),
    ["engrams/", "Engrams", "Unlock levels and point costs."],
    ...(site.levels ? [["levels/", "Levels", "Experience and engram points."]] as const : []),
    ["sounds/", "Sounds", "Listen to effects by creature, item, or vehicle."],
    ["music/", "Music", "Listen to the game's music layers."],
  ])}`;
  const server = (): string => `${banner("server/", "Server & controls")}${links([
    ["controls/", "Controls", "Keyboard and gamepad actions."],
    ["commands/", "Console commands", "Syntax, permissions, and examples."],
    ["settings/", "Server settings", "Public configuration and defaults."],
  ])}`;
  const about = (): string => `${banner("about/", "About the wiki", "", "The reference comes from the game’s content, assets, maps, and server settings. The guides describe how to play.")}
${site.left.length ? `<section><h2>Coverage</h2><ul>${join(site.left, (l) => `<li>${esc(LEFT_OUT[l.why])}${l.names.length ? ` · ${esc(l.names.join(", "))}` : ""}</li>`)}</ul></section>` : ""}`;

  const entry = (e: Entry): string => {
    const p = site.pictures.get(e.id);
    const credit = site.credits.get(e.id);
    const heard = (site.heard.get(e.id) ?? []).flatMap((id) => soundById.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const every = owners.has(e.id) ? `<p><a href="${BASE}sounds/${slug(e.id)}/">All ${esc(e.label)} sounds</a></p>` : "";
    const listen = heard.length || every ? '<a href="#sounds">Listen to sounds</a>' : "";
    const model = site.models?.get(e.id);
    const viewer = model ? ` data-model data-model-file="${esc(model.descriptor)}"` : "";
    const studio = model ? `<button type="button" class="view3d" data-view="${esc(model.url)}" data-label="${esc(e.label)}" aria-expanded="false">View in 3D</button><p data-model-status role="status" hidden></p>` : "";
    const other = p?.views.slice(1) ?? [];
    const angles = other.length && e.kind === "items"
      ? `<div class="item-angles">${join(other, (view) => `<a href="${view.file}">${img(view, `${e.label} from another angle`, true, "", "6rem")}<span>Alternate angle</span></a>`)}</div>`
      : other.length ? `<details class="angles"><summary>Other views</summary>${other.map((view, index) => `<a href="${esc(view.file)}">${img(view, `${e.label}, angle ${index + 2}`, true, "", "16rem")}</a>`).join("")}</details>` : "";
    const swatch = site.itemSwatches?.has(e.id);
    const caption = swatch ? "Inventory swatch" : credit;
    const viewClass = e.kind === "items" ? "views item-views" : "views";
    const figure = p ? `<figure class="${viewClass}"${viewer}><div class="model-stage" data-model-stage>${img(p.views[0]!, e.label, false, "", "(min-width: 52rem) 36vw, 100vw")}</div><div class="media-tools">${studio}<a href="${esc(p.views[0]!.file)}">Full image</a>${listen}</div>${angles}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>` : "";
    const priority = {
      creatures: ["Temperament", "Tameable", "Rideable", "Breeds"],
      items: ["Engram", "Crafted at", "Crafted", "Made in", "Needs level", "Deploys a", "Tool", "Saddle"],
      resources: ["Grows", "Grows back", "Hits"],
      vehicles: ["Top speed", "Seats", "Driven", "Fuel tank", "Carries"],
      landmarks: ["Doors", "Brings"],
      statuses: ["Lasts", "Moves", "Health", "Speed"],
      characters: ["Speed"],
    }[e.kind];
    const quick = priority.flatMap((label) => e.facts.filter((f) => f.label === label));
    const breeding = e.facts.filter((f) => ["Incubation", "Gestation", "Maturation"].includes(f.label));
    const more = e.facts.filter((f) => !quick.includes(f) && !breeding.includes(f) && f.label !== "Placement");
    const facts = (list: typeof e.facts): string => `<dl class="facts">${join(list, (f) => `<div><dt>${esc(f.label)}</dt><dd>${part(f.value)}</dd></div>`)}</dl>`;
    const line = e.console ? `<section id="console-command"><h2>Console command</h2><p class="console"><code id="console">${esc(e.console)}</code><button type="button" data-copy="console">Copy</button></p><a href="${BASE}commands/">Console commands and permissions</a></section>` : "";
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
    const placeTitle = e.kind === "creatures" ? "Where it lives" : e.kind === "resources" ? "Where to gather" : "Where to find it";
    const related = (relations: typeof e.related): string => `<dl class="related">${join(relations, (g) => `<div><dt>${esc(g.relation)}</dt><dd>${g.refs.map(ref).join(", ")}</dd></div>`)}</dl>`;
    const sources = e.related.filter((g) => ["Gathered from", "Harvested from", "Cooked from", "Spoiled from", "Built from"].includes(g.relation));
    const use = e.related.filter((g) => ["Works", "Fits", "Fired by", "Given by", "Crafts", "Tames", "Also set as", "Ridden with"].includes(g.relation));
    const rest = e.related.filter((g) => !sources.includes(g) && !use.includes(g));
    const sections: [id: string, title: string, html: string][] = [];
    const add = (title: string, html: string): void => {
      if (html) sections.push([sectionId(title), title, `<section id="${sectionId(title)}"><h2>${title}</h2>${html}</section>`]);
    };
    const tables = (list: readonly Table[]): void => {
      for (const t of list) sections.push([sectionId(t.title), t.title, table(t)]);
    };
    if (e.kind === "resources") tables(e.tables);
    if (e.kind !== "resources") add(placeTitle, lives.length ? `<ul class="places">${lives.join("")}</ul>` : "");
    add("How to get it", sources.length ? related(sources) : "");
    if (e.kind === "items") tables(e.tables.filter((t) => t.title === "Crafting"));
    const placement = e.facts.find((f) => f.label === "Placement");
    const useTitle = e.kind === "creatures" ? "Riding" : "Using it";
    const ridingGuide = e.kind === "creatures" && use.length ? `<p><a href="${guidePath("taming-and-riding")}">Taming and riding guide</a></p>` : "";
    add(useTitle, `${placement ? `<p>${part(placement.value)} <a href="${guidePath("building-a-base")}">Building guide</a></p>` : ""}${use.length ? related(use) : ""}${ridingGuide}`);
    if (e.kind === "resources") add(placeTitle, lives.length ? `<ul class="places">${lives.join("")}</ul>` : "");
    else tables(e.tables.filter((t) => e.kind !== "items" || t.title !== "Crafting").sort((a, b) => Number(b.title === "Taming") - Number(a.title === "Taming")));
    add("Breeding", breeding.length ? facts(breeding) : "");
    add("Details", more.length ? facts(more) : "");
    add("Sounds", heard.length || every ? `${heard.length ? `<ul class="sounds">${join(heard, sound)}</ul>` : ""}${every}` : "");
    add("Related", rest.length ? related(rest) : "");
    if (line) sections.push(["console-command", "Console command", line]);
    const intro = quick.length ? facts(quick) : "";
    const group = e.kind === "items" ? e.group : "";
    const crumbs: [string, string][] = [[`${BASE}${e.kind}/`, TITLES[e.kind]]];
    if (group) crumbs.push([groupPath(group), group]);
    return `<article class="entry">${trail(crumbs)}${heading(e.label)}
<div class="article-lead">
<div class="article-overview">${intro}${contents(sections.map(([id, title]) => [id, title]))}${figure ? "" : listen}</div>
${figure}
</div>
<div class="article-body">${sections.map((s) => s[2]).join("\n")}</div></article>`;
  };

  const engrams = (): string => {
    const name = (id: string): string => site.names.get(id) ?? id;
    const rows = [...site.engrams].sort((a, b) => a.level - b.level || name(a.item).localeCompare(name(b.item)));
    const lines = join(rows, (r) => `<tr><td>${r.level}</td><th>${ref({ id: r.item })}</th><td>${r.cost}</td></tr>`);
    const lede = "What a survivor may learn at each level, and the points it costs.";
    const levels = site.levels ? `<p><a href="${BASE}levels/">The experience each level takes, and the points it gives</a></p>` : "";
    return `${banner("engrams/", "Engrams", `${rows.length} to learn`, lede)}${levels}<div class="wide"><table><thead><tr><th>Level</th><th>Engram</th><th>Points</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  };

  const levels = (l: NonNullable<Site["levels"]>): string => {
    const lines = l.xp.map((xp, i) => `<tr><th>${i + 1}</th><td>${num(xp)}</td><td>${l.points[i] ? `+${l.points[i]}` : ""}</td></tr>`).join("");
    const lede = "The experience a survivor has in all on reaching each level, and the engram points that level gives to spend.";
    return `${banner("levels/", "Levels", `${l.xp.length} levels`, lede)}<p><a href="${BASE}engrams/">What the points learn</a></p><div class="wide"><table><thead><tr><th>Level</th><th>Experience</th><th>Engram points</th></tr></thead><tbody>${lines}</tbody></table></div>`;
  };

  const soundOwners = (): string => {
    const lede = "Each as the game plays it, decoded from the game's own sound files. Sounds not in the game yet are marked.";
    const list = join([...sortedOwners], ([o, l]) => `<li><a href="${BASE}sounds/${slug(o)}/">${esc(ownerName(o))}</a> <small>${l.length}</small></li>`);
    return `${banner("sounds/", "Sounds", `${site.sounds.length} sounds`, lede)}<ul class="list">${list}</ul>`;
  };
  const soundPage = (o: string, list: readonly Sound[], at: number): string => {
    const e = byId.get(o);
    const back = e ? `<p><a href="${entryPath(e)}">${esc(e.label)}</a></p>` : "";
    const shown = join(list.slice(at * PAGE, (at + 1) * PAGE), sound);
    return `${heading(ownerName(o), "Sounds")}${back}<ul class="sounds">${shown}</ul>${pager(`${BASE}sounds/${slug(o)}/`, list.length, PAGE, at)}`;
  };

  const music = (): string => `${trail([[`${BASE}reference/`, "Reference"]])}${banner("music/", "Music", "", "Listen to each track’s layers.")}${join(site.music, renderTrack)}`;

  const controls = (): string => {
    const rows = (list: ControlGroup["keys"], what: string): string =>
      list.length ? `<table><thead><tr><th>${what}</th><th>Does</th></tr></thead><tbody>${join(list, (c) => `<tr><th>${esc(c.keys.join(" or "))}</th><td>${esc(c.title)}${c.detail ? `<br><small>${esc(c.detail)}</small>` : ""}</td></tr>`)}</tbody></table>` : "";
    const groups = join(site.controls, (g) => `<section id="${slug(g.name.toLowerCase())}"><h2>${esc(g.name)}</h2><div class="wide">${rows(g.keys, "Key")}${rows(g.pad, "Gamepad")}</div></section>`);
    return `${banner("controls/", "Controls")}${groups}`;
  };

  const copy = (id: string): string => `<button type="button" data-copy="${esc(id)}">Copy</button>`;
  const commands = (): string => {
    const command = (c: Command): string => {
      const id = commandId(c.name);
      const examples = c.examples.length ? `<ul class="examples">${join(c.examples.map((text, i) => [text, `${id}-example-${i + 1}`] as const), ([text, example]) => `<li><code id="${example}">${esc(text)}</code>${copy(example)}</li>`)}</ul>` : "";
      return `<article class="command" id="${id}"><h3><a href="#${id}">${esc(c.name)}</a></h3>${c.rank !== undefined ? `<p class="note">Requires the ${RANK_NAMES[c.rank]} rank</p>` : c.admin ? '<p class="note">Requires cheats</p>' : ""}<p>${esc(c.help)}</p><div class="console"><code id="${id}-syntax">${esc(c.name)}${c.usage ? ` ${esc(c.usage)}` : ""}</code>${copy(`${id}-syntax`)}</div>${examples}</article>`;
    };
    const families = [...groupBy(site.commands, (c) => c.family)];
    return `${trail([[`${BASE}server/`, "Server & controls"]])}${banner("commands/", "Console commands", "", "Press Tab or Backquote to open the console on the keyboard. Use enablecheats with the server password when an admin command requires it.")}
<p><a href="${BASE}controls/">Find the console key</a></p>
${contents(families.map(([family]) => [sectionId(family), family]))}
${join(families, ([family, list]) => `<section id="${sectionId(family)}"><h2>${esc(family)}</h2>${join(list, command)}</section>`)}`;
  };

  const settings = (): string => {
    const groups = [...groupBy(site.settings, (s) => s.group)];
    const rows = (list: Setting[]): string => join(list, (s) => {
      const id = settingId(s.name);
      return `<tr id="${id}"><th scope="row"><a href="#${id}"><code>${esc(s.name)}</code></a><br><small>${esc(s.where)}</small></th><td data-setting="${esc(s.name)}">${esc(s.def)}</td><td>${esc(s.doc)}</td></tr>`;
    });
    const head = '<thead><tr><th scope="col">Setting</th><th scope="col">Default</th><th scope="col">Effect</th></tr></thead>';
    return `${trail([[`${BASE}server/`, "Server & controls"]])}${banner("settings/", "Server settings", "", "Public settings, where to configure them, and their default values.")}
${contents(groups.map(([group]) => [sectionId(group), group]))}
${join(groups, ([group, list]) => `<section id="${sectionId(group)}"><h2>${esc(group)}</h2><div class="wide" role="region" aria-label="${esc(group)} settings" tabindex="0"><table>${head}<tbody>${rows(list)}</tbody></table></div></section>`)}`;
  };

  const search = (): string =>
    `${banner("search/", "Search")}<form class="find big" action="${BASE}search/" role="search"><label class="visually-hidden" for="query">Search the wiki</label><input id="query" name="q" type="search" placeholder="Name, recipe, command, or game ID" autofocus><button type="submit">Search</button></form>
<p data-search-note aria-live="polite"></p><ol class="results" data-search="${site.assets.search}"></ol><noscript><p><a href="${BASE}reference/">Browse the reference</a> or <a href="${BASE}guides/">read the guides</a>.</p></noscript>`;

  const credits = (): string => {
    const by = groupBy([...site.credits], ([, c]) => c);
    const models = join([...by].sort(([a], [b]) => a.localeCompare(b)), ([c, list]) => `<li>${esc(c.replace(/\.$/, ""))} · ${list.map(([id]) => ref({ id })).join(", ")}</li>`);
    const sources = join(site.atlases, (a) => `<dt>${esc(a.label)}</dt><dd>${a.sources.map(esc).join(" · ")}</dd>`);
    return `${banner("credits/", "Credits")}<section><h2>Models and motion</h2><ul class="list">${models}</ul></section>
<section><h2>Maps</h2><dl class="related">${sources}</dl></section>
${site.assets.font ? '<section><h2>Type</h2><p>Barlow Semi Condensed, under the <a href="/assets/hud-font-license.txt">SIL Open Font License</a>.</p></section>' : ""}`;
  };

  return { owners: sortedOwners, ownerName, entryLink, table, cards, directory, banner, groupGallery, groupBanner, maps, obelisks, front, guides, guide, reference, server, about, entry, engrams, levels, soundOwners, soundPage, music, controls, commands, settings, search, credits };
}

const at1 = (n: number): number => Math.round(n * 10) / 10;

/** "8.1 km across", or for a map that is not square "12 by 8 km", west to east first. */
function extent(a: Atlas): string {
  const [w, d] = a.metres;
  return w === d ? `${num(w / 1000, 1)} km across` : `${num(w / 1000, 1)} by ${num(d / 1000, 1)} km`;
}

/** A map's page: the map with its layers, and under it a card for each landmark it places, as its dot and its row lead to. */
function atlasPage(a: Atlas, names: ReadonlyMap<string, string>, entryLink: (id: string) => string | undefined, photos: readonly PlaceShot[], placed: readonly Entry[], cards: (list: readonly Entry[]) => string): string {
  const name = (id: string): string => names.get(id) ?? id;
  const box = (show: string, label: string, count: string, colour: string, on = false, href?: string): string =>
    `<div class="layer-option" data-layer-choice="${esc(label)}"><label><input type="checkbox" data-show="${esc(show)}"${on ? " checked" : ""}><i aria-hidden="true" style="--c:${colour}"></i>${esc(label)} <small>${count}</small></label>${href ? `<a href="${href}" aria-label="${esc(label)} article">Article</a>` : ""}</div>`;
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
    ...landmarks.map((l) => `<div class="layer-option landmark-link" data-layer-choice="${esc(l.name)}">${linked(l.entry && entryPath(l.entry), esc(l.name))}</div>`),
  ].join("");
  const group = (label: string, options: string, open = false): string => `<details${open ? " open" : ""}><summary>${label}</summary>${options || "<p>No entries on this map.</p>"}</details>`;
  const panel = `<aside class="layers" aria-label="Map layers">
<div class="layer-tools" hidden><label>Filter map layers <input type="search" data-layer-filter></label><button type="button" data-layer-reset>Reset layers</button><p data-layer-note aria-live="polite"></p></div>
${group("Places", places, true)}
${group("Creatures", join(a.creatures, (c) => box(c.id, name(c.of), `${c.count} regions`, c.colour, false, entryLink(c.of))))}
${group("Resources", join(resources, (r) => box(r.id, name(r.of), num(r.count), r.colour, false, entryLink(r.of))))}
${group("Vehicles", join(a.vehicles, (v) => box(slug(v.kind), name(v.kind), `${v.count} parked`, "#ffd479", false, entryLink(v.kind))))}
</aside>`;
  const button = (by: number, label: string, text: string): string => `<button type="button" data-zoom="${by}" aria-label="${label}">${text}</button>`;
  const zoom = `<div class="zoom">${button(1, "Zoom in", "+")}${button(-1, "Zoom out", "−")}${button(0, "Whole map", "⤢")}</div>`;
  const standing = placed.length ? `<section><h2>Landmarks</h2>${cards(placed)}</section>` : "";
  const cover = photos.find((shot) => shot.kind === "city");
  const photosOf = (kind: PlaceShot["kind"], title: string, id: string): string => {
    const shots = photos.filter((shot) => shot.kind === kind);
    return shots.length ? `<section id="${id}"><h2>${title}</h2><div class="photo-grid">${join(shots, (shot) =>
      `<figure${shot.name ? ` id="photo-${slug(shot.name)}"` : ""}><a href="${esc(shot.file)}">${img(shot, shot.alt, true, "", "(min-width: 52rem) 28vw, (min-width: 35rem) 48vw, 100vw")}</a><figcaption>${esc(shot.caption)}</figcaption></figure>`)}</div></section>` : "";
  };
  const city = photosOf("city", "City views", "city-photos");
  const obelisk = photosOf("obelisk", "Obelisks", "obelisk-photos");
  const photoLinks: [string, string][] = [["city-map", "Interactive map"]];
  if (city) photoLinks.push(["city-photos", "City views"]);
  if (obelisk) photoLinks.push(["obelisk-photos", "Obelisks"]);
  const photoNav = photoLinks.length > 1 ? `<nav class="photo-jumps" aria-label="City atlas">${join(photoLinks, ([id, label]) => `<a href="#${id}">${label}</a>`)}</nav>` : "";
  const head = cover ? titleCard(a.label, { picture: cover, alt: cover.alt, caption: cover.caption }, "", extent(a)) : heading(a.label, "", extent(a));
  return `${trail([[`${BASE}maps/`, "Maps"]])}${head}${photoNav}<div data-maps><div class="note" data-map="${esc(a.id)}"></div></div>
<div class="atlas" id="city-map"><div class="viewport" data-atlas tabindex="0" style="aspect-ratio:${a.metres[0]} / ${a.metres[1]}" aria-label="Map of ${esc(a.label)}: drag to move, plus and minus to zoom">
<div class="plane">${img(a.ground, `${a.label} from above, north is up`, !!cover, "ground", "(min-width: 52rem) 50vw, 100vw")}${layers}${svg}</div>${zoom}</div>
${panel}</div>${city}${obelisk}${standing}`;
}
