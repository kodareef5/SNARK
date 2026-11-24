import { mountChangelog } from "./changelog.ts";
import { imageTile, loadGallery, mapArt, mapChoices, regionTiles, serverCard, survivorStats, type WorldCard as World } from "./gallery.ts";
import { worldUrl } from "./address.ts";
import { defaultLook, LOOK_SEX, LOOK_BEARD, randomLook, setRegion } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { loadIdentity } from "../core/identity.ts";
import { readLaunch, launchKey, savedName, validName, type EntrySurvivor, type Launch, type Remembered } from "../core/entry-state.ts";
import { appearanceFields, bodyFields, identityFields, button, esc, field } from "./forms.ts";
import { defaultEntrySpawn, playSurvivor, playWorld, titlePreloadWorld } from "../core/player-flow.ts";
import { sceneFor } from "./scenery.ts";
import { listingsOf, mergeListings, type Listing } from "../core/directories.ts";

type Screen =
  "title" | "servers" | "roster" | "create" | "spawn" | "link" | "approve" | "backup" | "recover" | "direct" | "password";
interface Details extends World {
  spawns: { name: string; x: number; z: number }[];
  width: number;
  height: number;
}
const root = document.querySelector<HTMLElement>("#entry-root")!,
  status = document.querySelector<HTMLElement>("#loading")!;
const home = worldUrl("./", location.href),
  direct = document.body.dataset.world === "true";
// The server directories the world names, its own ("directory") among them if it hosts one; none if it names none (D872).
const dirs = () => (document.body.dataset.directory ?? "").split(" ").filter(Boolean).map((d) => new URL(d, home).href);
const memory = new Map<string, string>();
const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? memory.get(k) ?? null;
  } catch {
    return memory.get(k) ?? null;
  }
};
const write = (k: string, v: string) => {
  memory.set(k, v);
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const store = { getItem: read, setItem: write };
const identity = loadIdentity(
  store,
  (b) => {
    crypto.getRandomValues(b);
  },
  "",
);
const key = Array.from(identity.key, (b) => b.toString(16).padStart(2, "0")).join("");
const rosterStore = "snark.survivors.v2";
function remembered(): Remembered[] {
  try {
    return (JSON.parse(read(rosterStore) ?? "[]") as Remembered[])
      .filter((r) => r && savedName(r.name) && worldUrl(r.world, home) === r.world)
      .sort((a, b) => b.played - a.played);
  } catch {
    return [];
  }
}
const route = new URLSearchParams(location.search).get("screen");
const directScreen = direct && ["roster", "link", "create"].includes(route ?? "");
let screen: Screen = "title",
  worlds: World[] = [],
  listed: Listing[] = [],
  selected: World | null = null,
  data: Details | null = null,
  known: EntrySurvivor[] = [],
  pick = "",
  notice = "",
  query = "",
  mapFilter = "",
  accessFilter = "";
let draft = "",
  look = defaultLook(),
  customise = false,
  editor: "appearance" | "build" = "appearance",
  group = 0,
  chart = false,
  spawn = -1,
  turn = 0.25,
  code = "",
  backup = "",
  password = "",
  connecting = false,
  fromWorld = false;
let prep: AbortController | null = null,
  selectionPrep: AbortController | null = null,
  titlePrep: { address: string; job: AbortController } | null = null,
  version = 0,
  loadingWorld = false,
  loadError = false,
  clock = 0;
let pending: Launch | null = null;
let afterWorld: Screen = "roster";
let directoryOffline = false;
let mapsOpen = false;
let worldChoice = "";
let recoveryName = "";
let warmers: Promise<typeof import("./preload.ts")> | null = null;
const loadWarmers = () => (warmers ??= import("./preload.ts"));
let lastWorldRequest: { screen: Screen; wanted: string } | null = null;
let priorLaunch: Launch | null = null;
const base = () => selected?.address || home;
const directWorld = (): World | null => direct
  ? worlds.find((w) => w.address === home) ?? { address: home, name: "World", map: "", mapId: "", players: 0, max: 0 }
  : null;
const selectedRow = () => known.find((r) => r.name === pick);
const getInput = (id: string) => document.querySelector<HTMLInputElement>("#" + id)?.value ?? "";
async function json(url: string, opts?: RequestInit) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
  let result;
  try {
    result = await r.json();
  } catch {
    throw Error("The server did not return a SNARK response.");
  }
  if (!r.ok) throw Error(result.error || "The server could not complete that request.");
  return result;
}
function owner(action: string, extra: Record<string, unknown> = {}) {
  if (new URL(base()).origin !== location.origin) throw Error("Open this server to use its survivors.");
  return json(new URL("survivors", base()).href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, key, ...extra }),
  });
}
function lastVisit(world: string): { name: string; time: number } | null {
  try {
    const v = JSON.parse(read("snark.played." + world) ?? "null");
    return v && savedName(v.name) && Number.isFinite(v.time) ? v : null;
  } catch {
    return null;
  }
}
function lastPlayed() {
  const saved = remembered().filter(r => r.played > 0);
  const visits = worlds.flatMap(w => {
    const visit = lastVisit(w.address);
    return visit ? [{ name: visit.name, played: visit.time, world: w.address, server: w.name, map: w.map }] : [];
  });
  return [...saved, ...visits].sort((a, b) => b.played - a.played)[0];
}
function remember(world: World, rows: EntrySurvivor[]) {
  const old = remembered(), visit = lastVisit(world.address);
  const next = old.filter(r => r.world !== world.address);
  for (const r of rows) {
    const previous = old.find(p => p.world === world.address && p.id === r.id);
    next.push({
      ...r, world: world.address, server: world.name, map: world.map,
      played: visit?.name === r.name ? visit.time : previous?.played ?? (r.name === read("snark.name") ? 1 : 0),
    });
  }
  write(rosterStore, JSON.stringify(next));
}
function launchWarm(address: string): AbortController {
  const job = new AbortController();
  void loadWarmers().then(({ preloadLaunch }) => {
    if (!job.signal.aborted) return preloadLaunch(address, job.signal);
  }).catch(() => {});
  return job;
}

function warmTitleAfterPaint(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (screen !== "title" || document.hidden) return;
    const address = titlePreloadWorld(direct ? home : null, lastPlayed()?.world ?? null, location.origin);
    if (titlePrep?.address === address) return;
    titlePrep?.job.abort();
    titlePrep = address ? { address, job: launchWarm(address) } : null;
  }));
}

function warm() {
  prep?.abort();
  const job = new AbortController();
  prep = job;
  const survivor = screen === "roster" ? selectedRow() : undefined;
  const p = survivor && !survivor.dead && typeof survivor.x === "number" && typeof survivor.z === "number"
    ? { x: survivor.x, z: survivor.z }
    : data?.spawns[spawn];
  if (!p) return;
  const address = base();
  void loadWarmers().then(({ preloadWorld }) => {
    if (!job.signal.aborted) return preloadWorld(address, p.x, p.z, job.signal);
  }).catch(() => {});
}

function createDraft(): void {
  const prior = read("snark.name");
  draft = savedName(prior) && !known.some((r) => r.name === prior) ? prior : "";
  look = defaultLook();
  priorLaunch = null;
  customise = false;
  editor = "appearance";
  group = 0;
  chart = false;
  turn = 0.25;
}

async function selectWorld(w: World, to: Screen = "roster", wanted = ""): Promise<boolean> {
  const address = worldUrl(w.address, home);
  const alreadyWarming = titlePrep?.address === address ? titlePrep.job : null;
  if (!alreadyWarming) titlePrep?.job.abort();
  titlePrep = null;
  if (new URL(address).origin !== location.origin) {
    const dest = new URL(address);
    dest.searchParams.set("screen", to);
    if (wanted) dest.searchParams.set("survivor", wanted);
    location.assign(dest.href);
    return false;
  }
  prep?.abort();
  prep = null;
  selectionPrep?.abort();
  selectionPrep = alreadyWarming ?? launchWarm(address);
  lastWorldRequest = { screen: to, wanted };
  status.textContent = "";
  const v = ++version;
  selected = { ...w, address };
  data = null;
  known = [];
  pick = wanted;
  spawn = -1;
  password = "";
  loadingWorld = true;
  loadError = false;
  fromWorld = true;
  notice = "";
  screen = to;
  render();
  topOfPage();
  try {
    const [info, roster] = await Promise.all([json(new URL("entry-world.json", address).href), owner("roster")]);
    if (v !== version) return false;
    data = info;
    known = roster.survivors;
    const current: World = { ...w, ...info, address };
    selected = current;
    const chosen = playSurvivor(known, wanted) ?? playSurvivor(known, "");
    pick = chosen?.name ?? "";
    spawn = address === home && priorLaunch?.intent === "create" && info.spawns[priorLaunch.spawn!]
      ? priorLaunch.spawn!
      : defaultEntrySpawn(info.spawns, read("snark.spawn." + address));
    remember(current, known);
    warm();
  } catch (e) {
    if (v !== version) return false;
    notice = String((e as Error).message);
    loadError = true;
  }
  if (v === version) {
    loadingWorld = false;
    render();
  }
  return v === version && !loadError;
}
async function worldsRefresh() {
  try {
    const rows: World[] = await json(new URL("entry-worlds.json", home).href);
    worlds = rows.flatMap((w) => {
      try {
        return [{ ...w, address: worldUrl(w.address, home) }];
      } catch {
        return [];
      }
    });
  } catch {}
  if (screen !== "servers" || !dirs().length) return;
  const ask = (url: string) =>
    fetch(url, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(listingsOf, () => null);
  void Promise.all(dirs().map(ask)).then((got) => {
    const rows = mergeListings(got);
    directoryOffline = rows === null;
    if (rows) listed = rows;
    refreshFilters();
  });
  refreshFilters();
}
function nav(next: Screen) {
  if (screen === "link" && code && next !== "link") void owner("cancel", { code }).catch(() => {});
  if (next === "title" || next === "servers") {
    fromWorld = false;
    loadError = false;
    titlePrep?.job.abort();
    titlePrep = null;
    prep?.abort();
    prep = null;
    selectionPrep?.abort();
    selectionPrep = null;
    void warmers?.then(({ stopPreloading }) => {
      if (!selectionPrep && !titlePrep) stopPreloading();
    }).catch(() => {});
    status.textContent = "";
  }
  if (loadingWorld) {
    selectionPrep?.abort();
    selectionPrep = null;
    version++;
    loadingWorld = false;
  }
  notice = "";
  code = "";
  clearTimeout(clock);
  screen = next;
  render();
  topOfPage();
  if (next === "title") warmTitleAfterPaint();
  if (next === "servers") {
    void worldsRefresh().then(() => {
      if (screen !== "servers") return;
      if (!worldChoice) worldChoice = playWorld(worlds, direct ? home : null, location.origin)?.address ?? "";
      refreshFilters();
    });
  }
}
function syncScene() {
  const saved = screen === "roster" && fromWorld ? selectedRow()?.look : null;
  const portrait = screen === "create" || !!saved;
  const cover = screen === "spawn" ? mapArt(selected?.mapId, selected?.map)?.cover : undefined;
  document.body.style.setProperty("--world-cover", cover ? "url(" + JSON.stringify(cover) + ")" : "");
  sceneFor(selected?.address ?? "", portrait, saved ? Uint8Array.from(saved) : look, Math.max(0, spawn), turn, false, screen === "title");
}

function panel(title: string, inside: string, primary = "", style = "") {
  const retry = loadError && fromWorld ? button("retry-world", "Retry world", "primary") : primary;
  return `<section class="panel ${style}" aria-labelledby="flow-title"><div class="entry-content"><h1 id="flow-title" tabindex="-1">${esc(title)}</h1>${inside}</div>
    <div class="entry-actions"><p role="alert" class="message">${esc(notice)}</p><div class="advance-row">
      ${retry}${button("back", "← Back", "back")}
    </div></div></section>`;
}

function visibleWorlds() {
  const dedupe = new Map<string, World>();
  for (const w of [...listed, ...worlds]) dedupe.set(w.address, w);
  return [...dedupe.values()].filter(
    (w) =>
      (w.name + " " + w.map + " " + w.address).toLowerCase().includes(query.toLowerCase()) &&
      (!mapFilter || mapFilter === w.map) &&
      (!accessFilter || (accessFilter === "locked" ? w.password === true : w.password === false)),
  );
}
function topOfPage() {
  window.scrollTo({ top: 0, behavior: "instant" });
  root.querySelector(".entry-content")?.scrollTo({ top: 0, behavior: "instant" });
  root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}
const previousCards = new WeakMap<Element, string>();
function updateCards(parent: Element, markup: string) {
  if (previousCards.get(parent) === markup) return;
  const active = parent.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
  const key = active?.dataset.world ?? active?.dataset.map;
  parent.innerHTML = markup;
  previousCards.set(parent, markup);
  if (key)
    parent
      .querySelector<HTMLElement>('[data-world="' + CSS.escape(key) + '"],[data-map="' + CSS.escape(key) + '"]')
      ?.focus({ preventScroll: true });
}
function refreshFilters() {
  const strip = root.querySelector("#map-filter");
  if (!strip) return;
  const tiles = mapChoices([...worlds, ...listed], mapFilter);
  updateCards(strip, tiles);
  const note = root.querySelector<HTMLElement>("#directory-offline");
  if (note) note.hidden = !directoryOffline;
  renderList();
}
function renderList() {
  const list = root.querySelector("#results");
  if (!list) return;
  const rows = visibleWorlds();
  updateCards(list, rows.map((world) => serverCard(world, world.address === worldChoice)).join("") || "<p>No matching servers.</p>");
  const n = root.querySelector("#result-count");
  if (n) n.textContent = rows.length + " " + (rows.length === 1 ? "world" : "worlds");
  const chosen = rows.find((w) => w.address === worldChoice);
  const advance = root.querySelector<HTMLButtonElement>('[data-action="choose-world"]');
  if (advance) {
    advance.disabled = !chosen || chosen.online === false;
    advance.textContent = chosen ? "Use " + chosen.name : "Select a world";
  }
}
function survivors(): { content: string; primary: string } {
  const local = fromWorld ? known : remembered();
  const cards = local
    .map((r) => {
      const saved = "world" in r ? (r as Remembered) : undefined;
      const address = saved?.world ?? base(),
        server = saved?.server ?? selected?.name,
        map = saved?.map ?? selected?.map;
      const art = mapArt(saved ? undefined : selected?.mapId, map);
      return (
        '<article class="survivor-card" data-selected="' +
        (fromWorld && r.name === pick) +
        '"><button class="pick" type="button" data-action="pick" data-world="' +
        esc(address) +
        '" data-name="' +
        esc(r.name) +
        '" aria-pressed="' +
        (fromWorld && r.name === pick) +
        '">' +
        imageTile(art?.cover) +
        "<span><small>" +
        esc([...new Set([server, map].filter(Boolean))].join(" · ")) +
        "</small><strong>" +
        esc(r.name) +
        '</strong></span><span class="pick-mark" aria-hidden="true">' +
        (fromWorld && r.name === pick ? "✓" : "›") +
        "</span></button>" +
        survivorStats(r) +
        (r.dead ? '<span class="respawn-note">Awaiting respawn</span>' : "") +
        "</article>"
      );
    })
    .join("");
  const chosen = fromWorld && selectedRow();
  const primary = loadError ? button("retry-world", "Retry world", "primary") :
    loadingWorld ? button("wait", "Finding survivors…", "primary", "disabled") :
    chosen ? button("continue", chosen.dead ? "Return as " + pick : "Play as " + pick, "primary") :
    button("new", "Create a survivor", "primary");
  return {
    primary,
    content: (chosen && chosen.dead ? '<p class="lead">Choose a respawn point after entering the world.</p>' : "")
      + '<div class="roster-grid">' + (loadingWorld ? "<p>Finding survivors…</p>" : cards || "<p>No survivors yet.</p>") + '</div>'
      + '<div class="support">'
      + (chosen ? button("new", "Create a survivor", "quiet") : "")
      + button(fromWorld ? "link" : "link-world", "Link this browser", "quiet")
      + (chosen ? button("approve", "Link another browser", "quiet") + button("backup", "Save recovery code", "quiet") : "")
      + "</div>",
  };
}

function render() {
  const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.action;
  const focusAttr = focused
    ? Object.entries(focused.dataset)
        .map(([k, v]) => "[data-" + k + '="' + CSS.escape(v ?? "") + '"]')
        .join("")
    : "";
  const scroll = root.querySelector(".entry-content")?.scrollTop ?? 0;
  const last = lastPlayed();
  let html = "";
  if (screen === "title") {
    html = `<section class="home entry-title" aria-labelledby="entry-title">
      <div class="title-identity"><h1 id="entry-title" tabindex="-1"><img class="title-emblem" src="title/snark-emblem.webp" alt="SNARK · Miami Devolved" width="480" height="480"></h1></div>
      <div class="home-actions">
        ${last ? `<p class="return-world">${esc([...new Set([last.server, last.map].filter(Boolean))].join(" · "))}</p>` : ""}
        <p class="message" role="alert">${esc(notice)}</p>
        <div class="title-options">${button("servers", "Browse worlds", "quiet")}${button("all", "My survivors", "quiet")}</div>
        ${button("begin", last ? "Continue as " + last.name : "Play", "primary")}
      </div></section>`;
  } else if (screen === "servers") {
    const filters = [["", "Any access"], ["open", "Open"], ["locked", "Password"]];
    html = panel("Choose a world", `<div class="filters"><label class="search"><span>Search worlds</span><input type="search" id="query" value="${esc(query)}" placeholder="World name or city"></label>
      <div class="chips" role="group" aria-label="World access">${filters.map(([id, name]) => button("access", name!, "chip", `data-filter="${id}" aria-pressed="${accessFilter === id}"`)).join("")}</div></div>
      <details id="map-shelf" ${mapsOpen ? "open" : ""}><summary>Maps${mapFilter ? " · " + esc(mapFilter) : ""}</summary><div id="map-filter" class="map-options"></div></details>
      <div class="results-heading"><p class="context" id="result-count"></p>${mapFilter ? button("choose-map", "Clear map filter", "quiet", 'data-map=""') : ""}</div>
      <div id="results" class="server-grid"></div>
      <p id="directory-offline" ${directoryOffline ? "" : "hidden"}>Public directory unavailable. Cluster worlds and direct joins are available.</p>
      <div class="support">${button("direct", "Join by address", "quiet")}</div>`, button("choose-world", "Select a world", "primary", "disabled"), "world-browser");
  } else if (screen === "roster") {
    const r = survivors();
    html = panel("Your survivors", r.content, r.primary, "roster");
  } else if (screen === "create") {
    const controls = customise
      ? `<div class="appearance-editor"><div class="chips" role="group" aria-label="Appearance options">
        ${button("editor", "Appearance", "chip", `data-editor="appearance" aria-pressed="${editor === "appearance"}"`)}
        ${button("editor", "Proportions", "chip", `data-editor="build" aria-pressed="${editor === "build"}"`)}
      </div>${editor === "appearance" ? appearanceFields(look) : bodyFields(look, group)}
      <div class="support">${button("rotate", "Rotate preview", "quiet")}${button("random", "Randomize", "quiet")}${button("reset", "Reset appearance", "quiet")}</div></div>`
      : "";
    html = panel("Create a survivor", `<div class="identity-fields">${identityFields(look, draft)}</div>
      <div class="support">${button("customise", customise ? "Hide appearance options" : "Customize appearance", "quiet", `aria-expanded="${customise}"`)}</div>${controls}`,
      button("spawn", "Choose spawn", "primary", loadingWorld || loadError ? "disabled" : ""), "creator");
  } else if (screen === "spawn") {
    const points = data?.spawns ?? [], point = points[spawn], art = mapArt(selected?.mapId, selected?.map);
    const pins = points.map((p, i) => `<button type="button" class="pin" aria-label="${esc(p.name)}" title="${esc(p.name)}" data-action="place" data-index="${i}" aria-pressed="${i === spawn}" style="left:${(1 - p.x / data!.width) * 100}%;top:${(1 - p.z / data!.height) * 100}%"></button>`).join("");
    const places = chart
      ? `<div class="chart" ${art?.overview ? `style="background-image:url('${esc(art.overview)}')"` : ""}>${pins}</div>`
      : regionTiles(points, art, spawn, data?.width ?? 1, data?.height ?? 1);
    html = panel("Choose a spawn", `<div class="spawn-current"><div><p class="context">${esc(draft)} · ${esc(selected?.map)}</p><strong>${esc(point?.name ?? "No spawn selected")}</strong></div>
      ${art?.overview ? `<div class="chips" role="group" aria-label="Spawn view">${button("places", "Places", "chip", `aria-pressed="${!chart}"`)}${button("chart", "Map", "chip", `aria-pressed="${chart}"`)}</div>` : ""}</div>${places}`,
      button("commit", point ? "Enter at " + point.name : "Enter world", "primary", point ? "" : "disabled"), "spawn-page");
  } else if (screen === "direct") {
    html = panel("Join by address",
      field("address", "Server address", "", 'placeholder="https://play.example.org/" inputmode="url" autocomplete="url"'),
      button("go-direct", "Open world", "primary"));
  } else if (screen === "link") {
    html = panel("Link this browser", code
      ? `<p>Enter this code in the browser that owns your survivor, under Link another browser.</p><output class="code">${esc(code.slice(0, 4) + " " + code.slice(4))}</output><p>Waiting for approval · Expires in five minutes</p>`
      : `<div class="support">${button("recover", "Use a recovery code", "quiet")}</div>`,
      code ? button("wait", "Waiting for approval", "primary", "disabled") : button("pair", "Get a linking code", "primary"));
  } else if (screen === "approve") {
    html = panel("Approve another browser",
      `<p>${esc(pick)} · ${esc(selected?.name)}</p>` + field("pair-code", "Code shown on the new browser", "", 'autocomplete="off"'),
      button("grant", "Approve link", "primary"));
  } else if (screen === "backup") {
    html = panel("Recovery code", backup
      ? `<p>Keep this one-use code private. Save it with your survivor name and world.</p><output class="code">${esc(backup)}</output>`
      : `<p>Generate a new code for ${esc(pick)}. Any previous recovery code will expire.</p>`,
      backup ? button("back", "Done", "primary") : button("make-backup", "Generate recovery code", "primary"));
  } else if (screen === "recover") {
    html = panel("Recover a survivor",
      field("who", "Survivor name", recoveryName) + field("recovery", "Saved recovery code", "", 'autocomplete="off"'),
      button("restore", "Recover survivor", "primary"));
  } else if (screen === "password") {
    html = panel("World password",
      field("password", "Password for " + (selected?.name ?? "this world"), "", 'type="password" autocomplete="current-password"'),
      button("unlock", "Enter world", "primary"));
  }
  root.innerHTML = html;
  const content = root.querySelector<HTMLElement>(".entry-content");
  if (content) content.scrollTop = scroll;
  document.body.dataset.entryScreen = screen;
  if (screen === "servers") {
    refreshFilters();
    const shelf = root.querySelector<HTMLDetailsElement>("#map-shelf");
    if (shelf)
      shelf.ontoggle = () => {
        if (shelf.isConnected) mapsOpen = shelf.open;
      };
  }
  if (focusKey && focusAttr) root.querySelector<HTMLElement>(focusAttr)?.focus({ preventScroll: true });
  document.querySelector("#world-label")!.textContent = selected && fromWorld && !["title", "servers"].includes(screen)
    ? [...new Set([selected.name, selected.map].filter(Boolean))].join(" · ") : "";
  syncScene();
}
function enter(launch: Launch) {
  try {
    if (localStorage.getItem("snark.key") !== key) throw Error();
  } catch {
    throw Error("Allow browser storage to save and enter with this survivor.");
  }
  if (launch.intent === "create" && !launch.request)
    launch.request = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (data?.password && !password) {
    pending = launch;
    nav("password");
    return;
  }
  const dest = new URL("play.html", base());
  launch.password = password;
  try {
    sessionStorage.setItem(launchKey(dest.pathname), JSON.stringify(launch));
  } catch {
    throw Error("Allow session storage in this tab to enter the world.");
  }
  dest.searchParams.set("name", launch.name);
  location.assign(dest.href);
}
async function poll(world: string, token: string) {
  try {
    if (screen !== "link" || base() !== world || code !== token) return;
    const answer = await owner("poll", { code: token });
    if (screen !== "link" || base() !== world || code !== token) return;
    if (answer.survivor) {
      await selectWorld(selected!, "roster", answer.survivor.name);
      return;
    }
    clock = window.setTimeout(() => void poll(world, token), 1500);
  } catch (e) {
    if (screen === "link" && code === token) {
      code = "";
      notice = (e as Error).message;
      render();
    }
  }
}
async function action(a: string, b: HTMLElement) {
  if (a === "back") {
    if (screen === "spawn") nav("create");
    else if (screen === "password" && pending?.intent === "create") nav("spawn");
    else if (screen === "recover") nav("link");
    else if (["create", "link", "approve", "backup", "password"].includes(screen)) nav("roster");
    else if (screen === "direct" || (screen === "roster" && fromWorld)) nav("servers");
    else nav("title");
    return;
  }
  if (a === "servers" || a === "link-world") {
    afterWorld = a === "link-world" ? "link" : "roster";
    fromWorld = false;
    nav("servers");
    return;
  }
  if (a === "begin") {
    const mark = version;
    if (!direct && worlds.length === 0) {
      status.textContent = "Finding worlds…";
      await firstWorlds;
      if (screen !== "title" || mark !== version) return;
      status.textContent = "";
    }
    const last = lastPlayed();
    if (last) {
      const knownWorld = worlds.find((w) => w.address === last.world);
      const rememberedWorld = { address: last.world, name: last.server, map: last.map, mapId: "", players: 0, max: 0 };
      if (await selectWorld(knownWorld ?? rememberedWorld, "roster", last.name)) {
        if (pick === last.name) enter({ intent: "resume", name: pick, password: "" });
        else {
          notice = `${last.name} is no longer available on this browser.`;
          render();
        }
      }
      return;
    }
    const world = directWorld() ?? playWorld(worlds, null, location.origin);
    if (!world) {
      fromWorld = false;
      nav("servers");
      return;
    }
    if (!(await selectWorld(world))) return;
    if (known.length) {
      enter({ intent: "resume", name: pick, password: "" });
    } else {
      createDraft();
      nav("create");
    }
    return;
  }
  if (a === "all") {
    fromWorld = false;
    pick = "";
    nav("roster");
    void discoverSurvivors();
    return;
  }
  if (a === "world") {
    worldChoice = b.dataset.world ?? "";
    renderList();
    return;
  }
  if (a === "retry-world" && lastWorldRequest && selected) {
    await selectWorld(selected, lastWorldRequest.screen, lastWorldRequest.wanted);
    return;
  }
  if (a === "choose-world") {
    const w = visibleWorlds().find((w) => w.address === worldChoice);
    if (w && w.online !== false) {
      const next = afterWorld;
      if (next === "create") createDraft();
      if (await selectWorld(w, next)) afterWorld = "roster";
    }
    return;
  }
  if (a === "pick") {
    if (!fromWorld) {
      const r = remembered().find((r) => r.world === b.dataset.world && r.name === b.dataset.name);
      if (r) await selectWorld({ address: r.world, name: r.server, map: r.map, mapId: "", players: 0, max: 0 }, "roster", r.name);
    } else {
      pick = b.dataset.name!;
      warm();
      render();
    }
    return;
  }
  if (a === "new") {
    if (!fromWorld || !data) {
      afterWorld = "create";
      fromWorld = false;
      nav("servers");
      return;
    }
    createDraft();
    nav("create");
    return;
  }
  if (a === "continue" && selectedRow()) {
    enter({ intent: "resume", name: pick, password: "" });
    return;
  }
  if (a === "access" || a === "choose-map") {
    if (a === "access") accessFilter = b.dataset.filter ?? "";
    else mapFilter = b.dataset.map === mapFilter ? "" : (b.dataset.map ?? "");
    render();
    return;
  }
  if (a === "customise" || a === "editor") {
    if (a === "customise") customise = !customise;
    else editor = b.dataset.editor === "build" ? "build" : "appearance";
    render();
    if (customise && a === "customise") root.querySelector(".appearance-editor")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (a === "group") {
    group = Number(b.dataset.index);
    render();
    return;
  }
  if (a === "places" || a === "chart") {
    chart = a === "chart";
    render();
    return;
  }
  if (a === "rotate") {
    turn += Math.PI / 4;
    syncScene();
    return;
  }
  if (a === "reset" || a === "random") {
    look = a === "reset" ? defaultLook() : randomLook(new Rng(crypto.getRandomValues(new Uint32Array(1))[0]!));
    render();
    return;
  }
  if (a === "swatch" || a === "style") {
    look[Number(b.dataset.field)] = Number(b.dataset.value);
    if (Number(b.dataset.field) === LOOK_SEX && look[LOOK_SEX]) look[LOOK_BEARD] = 0;
    render();
    return;
  }
  if (a === "spawn") {
    if (!validName(draft) || draft.trim() === "") throw Error("Enter 1–24 letters, numbers, spaces, hyphens or underscores.");
    if (!data || spawn < 0) throw Error("This world has no public spawn points.");
    const checking = draft, selectedVersion = version;
    const answer = await owner("available", { name: checking });
    if (screen !== "create" || checking !== draft || selectedVersion !== version) return;
    if (!answer.available) throw Error("That name is already in use on this world.");
    nav("spawn");
    warm();
    return;
  }
  if (a === "place") {
    const next = Number(b.dataset.index);
    if (!data?.spawns[next] || next === spawn) return;
    spawn = next;
    notice = "";
    warm();
    render();
    return;
  }
  if (a === "commit" && data?.spawns[spawn]) {
    write("snark.spawn." + base(), data.spawns[spawn]!.name);
    const request = priorLaunch?.intent === "create" && priorLaunch.name === draft && priorLaunch.spawn === spawn
      && priorLaunch.look?.every((n, i) => n === look[i]) ? priorLaunch.request : undefined;
    enter({ intent: "create", name: draft, look: Array.from(look), spawn, password: "", request });
    return;
  }
  if (a === "unlock" && pending) {
    password = getInput("password");
    if (!password) throw Error("Enter the server password.");
    enter(pending);
    return;
  }
  if (a === "go-direct") {
    const raw = getInput("address").trim();
    if (!raw) throw Error("Enter the server address.");
    const address = worldUrl(raw.includes("://") ? raw : "https://" + raw, home);
    const dest = new URL(address);
    dest.searchParams.set("screen", "roster");
    location.assign(dest.href);
    return;
  }
  if (a === "backup") backup = "";
  if (a === "recover") recoveryName = pick;
  if (["direct", "link", "approve", "recover", "backup"].includes(a)) {
    nav(a as Screen);
    return;
  }
  if (a === "pair") {
    const world = base(), accessVersion = version;
    const { code: issued } = await owner("pair");
    if (screen !== "link" || base() !== world || accessVersion !== version) {
      void json(new URL("survivors", world).href, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", key, code: issued }),
      }).catch(() => {});
      return;
    }
    code = issued;
    render();
    void poll(world, issued);
    return;
  }
  if (a === "grant") {
    const at = version;
    await owner("approve", { name: pick, code: getInput("pair-code") });
    if (screen !== "approve" || at !== version) return;
    nav("roster");
    notice = "Browser approved. Continue from the new browser.";
    render();
    return;
  }
  if (a === "make-backup") {
    const at = version;
    const { code: secret } = await owner("backup", { name: pick });
    if (screen !== "backup" || at !== version) return;
    backup = secret;
    render();
    return;
  }
  if (a === "restore") {
    const at = version;
    const r = await owner("recover", { name: getInput("who"), code: getInput("recovery") });
    if (screen === "recover" && at === version) await selectWorld(selected!, "roster", r.survivor.name);
    return;
  }
}
let actionVersion = 0;
root.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!b || (connecting && b.dataset.action !== "back")) return;
  connecting = true;
  const actionId = ++actionVersion, screenAt = screen;
  notice = "";
  try {
    await action(b.dataset.action!, b);
  } catch (err) {
    if (screen !== screenAt || actionId !== actionVersion) return;
    notice = (err as Error).message;
    const msg = root.querySelector(".message");
    if (msg) msg.textContent = notice;
    else render();
  } finally {
    if (actionId === actionVersion) connecting = false;
  }
});
root.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "name") {
    draft = input.value;
    if (notice && validName(draft)) {
      notice = "";
      const message = root.querySelector(".message");
      if (message) message.textContent = "";
    }
  }
  if (input.id === "query") {
    query = input.value;
    renderList();
  }
  if (input.dataset.region !== undefined) {
    setRegion(look, Number(input.dataset.region), Number(input.value));
    syncScene();
  }
});
root.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement) || !["text", "password", "url"].includes(e.target.type)) return;
  const advance = root.querySelector<HTMLButtonElement>(".entry-actions .primary");
  if (!advance || advance.disabled) return;
  e.preventDefault();
  advance.click();
});
document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  nav("title");
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && screen !== "title") void action("back", root);
});
async function discoverSurvivors() {
  await worldsRefresh();
  // Discover old named survivors with their existing key, including names used only by a legacy deep link.
  for (const w of worlds.filter((w) => new URL(w.address).origin === location.origin)) {
    try {
      const r = await json(new URL("survivors", w.address).href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "roster", key }),
      });
      remember(w, r.survivors);
    } catch {}
  }
  if (screen === "roster" && !fromWorld) render();
}
let firstWorlds: Promise<void> = Promise.resolve();

async function start() {
  if (location.hash.startsWith("#travel=")) {
    location.replace("play.html" + location.search + location.hash);
    return;
  }
  const cue = window as Window & { snarkTitleAction?: "begin" | "servers" | "all" };
  root.dataset.mounted = "true";
  const titleAction = cue.snarkTitleAction;
  delete cue.snarkTitleAction;
  mountChangelog();
  firstWorlds = worldsRefresh();
  void loadGallery().then(() => {
    if (["servers", "roster", "spawn"].includes(screen)) render();
  }).catch(() => {});
  if (directScreen) {
    if (route === "create") {
      try {
        const prior = readLaunch(sessionStorage.getItem(launchKey(new URL("play.html", home).pathname)));
        if (prior?.intent === "create") {
          priorLaunch = prior;
          draft = prior.name;
          look = Uint8Array.from(prior.look!);
        }
      } catch {}
    }
    const wanted = new URLSearchParams(location.search).get("survivor") ?? "";
    await selectWorld(directWorld()!, route as Screen, wanted);
  } else {
    render();
    warmTitleAfterPaint();
    if (titleAction) root.querySelector<HTMLButtonElement>(`[data-action="${titleAction}"]`)?.click();
    await firstWorlds;
    if (screen === "title") {
      render();
      warmTitleAfterPaint();
    }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    titlePrep?.job.abort();
    titlePrep = null;
  } else if (screen === "title") warmTitleAfterPaint();
});
setInterval(() => {
  if (screen === "servers" && !document.hidden) void worldsRefresh();
}, 15000);
void start().catch((e) => {
  notice = e.message;
  render();
});
