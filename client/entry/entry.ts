import { imageTile, loadGallery, mapArt, mapChoices, regionTiles, serverCard, survivorStats, type WorldCard as World } from "./gallery.ts";
import { worldUrl } from "./address.ts";
import { defaultLook, LOOK_SEX, LOOK_BEARD, randomLook, setRegion } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { loadIdentity } from "../core/identity.ts";
import { readLaunch, launchKey, savedName, validName, type EntrySurvivor, type Launch, type Remembered } from "../core/entry-state.ts";
import { appearanceFields, bodyFields, identityFields, stepper, button, esc, field } from "./forms.ts";
import { preloadWorld } from "./preload.ts";
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
let waitingForDirectScreen = direct && ["roster","link","create"].includes(new URLSearchParams(location.search).get("screen") ?? "");
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
  step = 0,
  group = 0,
  chart = false,
  spawn = 0,
  turn = 0.25,
  code = "",
  backup = "",
  password = "",
  connecting = false,
  fromWorld = false,
  preloaded = false;
let prep: AbortController | null = null,
  version = 0,
  loadingWorld = false,
  loadError = false,
  clock = 0;
let pending: Launch | null = null;
let afterWorld: Screen = "roster";
let directoryOffline = false;
let mapsOpen = matchMedia("(min-width:761px)").matches;
const base = () => selected?.address || home;
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
function warm() {
  prep?.abort();
  prep = new AbortController();
  const job = prep;
  preloaded = false;
  const survivor = screen === "roster" ? selectedRow() : undefined;
  const p =
    survivor && !survivor.dead && typeof survivor.x === "number" && typeof survivor.z === "number"
      ? { name: survivor.name, x: survivor.x, z: survivor.z }
      : data?.spawns[spawn];
  if (!p) return;
  status.textContent = "Preparing " + p.name;
  preloadWorld(base(), p.x, p.z, job.signal, (s) => {
    if (prep === job) status.textContent = s;
  })
    .then(() => {
      if (prep !== job) return;
      preloaded = true;
      status.textContent = "World ready";
      if (screen === "spawn") render();
    })
    .catch(() => {
      if (prep !== job || job.signal.aborted) return;
      status.textContent = "World preload interrupted";
      if (screen === "spawn") {
        notice = "Loading was interrupted. Retry to prepare this spawn.";
        render();
      }
    });
}
async function selectWorld(w: World, to: Screen = "roster", wanted = "") {
  const address = worldUrl(w.address, home);
  if (new URL(address).origin !== location.origin) {
    const dest = new URL(address);
    dest.searchParams.set("screen", to);
    location.assign(dest.href);
    return;
  }
  prep?.abort();
  prep = null;
  status.textContent = "";
  const v = ++version;
  selected = { ...w, address };
  data = null;
  known = [];
  pick = wanted;
  spawn = 0;
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
    if (v !== version) return;
    data = info;
    known = roster.survivors;
    const current: World = { ...w, ...info, address };
    selected = current;
    pick = known.some((r) => r.name === wanted) ? wanted : (known[0]?.name ?? "");
    remember(current, known);
    warm();
  } catch (e) {
    if (v !== version) return;
    notice = String((e as Error).message);
    loadError = true;
  }
  if (v === version) {
    loadingWorld = false;
    render();
  }
}
async function worldsRefresh() {
  try {
    const rows: World[] = await json(new URL("entry-worlds.json", home).href);
    worlds = rows.map((w) => ({ ...w, address: worldUrl(w.address, home) }));
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
  if (next === "title") waitingForDirectScreen = false;
  if (screen === "link" && code && next !== "link") void owner("cancel", { code }).catch(() => {});
  if (next === "title" || next === "servers") {
    prep?.abort();
    prep = null;
    status.textContent = "";
  }
  if (loadingWorld) {
    version++;
    loadingWorld = false;
  }
  notice = "";
  code = "";
  clearTimeout(clock);
  screen = next;
  render();
  topOfPage();
  if (next === "servers") void worldsRefresh();
}
function syncScene() {
  const saved = screen === "roster" && fromWorld ? selectedRow()?.look : null;
  const portrait = screen === "create" || !!saved;
  sceneFor(selected?.address ?? "", portrait, saved ? Uint8Array.from(saved) : look, spawn, turn, screen === "create", screen === "title" && !waitingForDirectScreen);
}
function panel(title: string, inside: string, style = "", back = "back") {
  return (
    '<section class="panel ' +
    style +
    '"><div class="topline">' +
    button(back, "← Back", "quiet") +
    "<span>" +
    esc(fromWorld ? (selected?.name ?? "") : "") +
    '</span></div><h1 tabindex="-1">' +
    esc(title) +
    "</h1>" +
    inside +
    '<p role="alert" class="message">' +
    esc(notice) +
    "</p></section>"
  );
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
  root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}
function goStep(next: number) {
  step = next;
  notice = "";
  render();
  topOfPage();
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
  updateCards(list, rows.map(serverCard).join("") || "<p>No matching servers.</p>");
  const n = root.querySelector("#result-count");
  if (n) n.textContent = rows.length + " " + (rows.length === 1 ? "server" : "servers");
}
function survivors() {
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
  return (
    '<p class="context">' +
    esc(fromWorld ? selected?.map : "On this browser") +
    '</p><div class="roster-grid">' +
    (loadingWorld ? "<p>Finding survivors…</p>" : cards || "<p>No survivors here yet.</p>") +
    '</div><div class="actions">' +
    (chosen ? button("continue", "Continue as " + pick, "primary") : "") +
    button("new", "New survivor", chosen ? "secondary" : "primary", fromWorld && (loadingWorld || loadError) ? "disabled" : "") +
    (loadError ? button("retry-world", "Retry world") : "") +
    '</div><div class="support">' +
    button(fromWorld ? "link" : "link-world", "Link this browser", "quiet") +
    (chosen ? button("approve", "Link another browser", "quiet") + button("backup", "Save recovery code", "quiet") : "") +
    "</div>"
  );
}
function render() {
  const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.dataset.action;
  const focusAttr = focused
    ? Object.entries(focused.dataset)
        .map(([k, v]) => "[data-" + k + '="' + CSS.escape(v ?? "") + '"]')
        .join("")
    : "";
  const last = lastPlayed();
  let html = "";
  if (screen === "title") {
    html =
      '<section class="home"><div class="wordmark"><b>SNARK</b><small>Miami Devolved</small></div><div class="home-actions">' +
      (last ? button("last", "Continue as " + last.name, "primary") : "") +
      button("servers", "Find a server", last ? "" : "primary") +
      button("all", "My survivors", "") +
      "</div>" +
      (last ? "<p>" + esc(last.server) + " · " + esc(last.map) + "</p>" : "") +
      "</section>";
  } else if (screen === "servers") {
    const filters = [
      ["", "Any access"],
      ["open", "Open"],
      ["locked", "Password"],
    ];
    html = panel(
      "Find a server",
      '<div class="filters"><label class="search"><span>Search servers or cities</span><input type="search" id="query" value="' +
        esc(query) +
        '" placeholder="Search servers or cities"></label><div class="chips" role="group" aria-label="Server access">' +
        filters
          .map(([id, name]) => button("access", name!, "chip", 'data-filter="' + id + '" aria-pressed="' + (accessFilter === id) + '"'))
          .join("") +
        '</div></div><details id="map-shelf" ' +
        (mapsOpen ? "open" : "") +
        "><summary>Browse maps" +
        (mapFilter ? " · " + esc(mapFilter) : "") +
        '</summary><div id="map-filter" class="map-options"></div></details><div class="results-heading"><p class="context" id="result-count"></p>' +
        (mapFilter ? button("choose-map", "Clear map filter", "quiet", 'data-map=""') : "") +
        '</div><div id="results" class="server-grid"></div><p id="directory-offline" ' +
        (directoryOffline ? "" : "hidden") +
        '>Public directory unavailable. Cluster worlds and direct joins are available.</p><div class="support">' +
        button("direct", "Join by address", "quiet") +
        "</div>",
      "wide",
    );
  } else if (screen === "roster") html = panel("My survivors", survivors(), "roster");
  else if (screen === "create") {
    const title = ["New survivor", "Appearance", "Body proportions"][step]!;
    const edit = step === 0 ? identityFields(look, draft) : step === 1 ? appearanceFields(look) : bodyFields(look, group);
    const toolbar = step
      ? '<div class="support">' +
        button("rotate", "Rotate preview", "quiet") +
        button("random", "Randomize", "quiet") +
        button("reset", "Reset", "quiet") +
        "</div>"
      : "";
    html = panel(
      title,
      stepper(step) +
        edit +
        toolbar +
        '<div class="actions">' +
        button(step === 2 ? "spawn" : "next-step", ["Choose appearance", "Continue to build", "Choose spawn"][step]!, "primary") +
        "</div>",
      "creator",
    );
  } else if (screen === "spawn") {
    const points = data?.spawns ?? [],
      point = points[spawn],
      art = mapArt(selected?.mapId, selected?.map);
    const pins = points
      .map(
        (p, i) =>
          '<button type="button" class="pin" aria-label="' +
          esc(p.name) +
          '" title="' +
          esc(p.name) +
          '" data-action="place" data-index="' +
          i +
          '" aria-pressed="' +
          (i === spawn) +
          '" style="left:' +
          (1 - p.x / data!.width) * 100 +
          "%;top:" +
          (1 - p.z / data!.height) * 100 +
          '%"></button>',
      )
      .join("");
    const content = chart
      ? '<div class="chart" ' + (art?.overview ? 'style="background-image:url(' + esc(art.overview) + ')"' : "") + ">" + pins + "</div>"
      : regionTiles(points, art, spawn, data?.width ?? 1, data?.height ?? 1);
    html = panel(
      "Choose spawn",
      stepper(3) +
        '<div class="spawn-flow"><div class="spawn-choice"><span><small>' +
        esc(draft) +
        " · " +
        esc(selected?.map) +
        "</small><strong>" +
        esc(point?.name ?? "Loading world…") +
        "</strong></span>" +
        '</div><div class="place-tools"><div class="chips" role="group" aria-label="Spawn view">' +
        button("places", "Places", "chip", 'aria-pressed="' + !chart + '"') +
        button("chart", "Map", "chip", 'aria-pressed="' + chart + '"') +
        "</div>" +
        (notice && !preloaded ? button("warm", "Retry preload", "quiet") : "") +
        "</div>" +
        content +
        button("commit", preloaded && point ? "Create at " + point.name : notice ? "Preload interrupted" : "Preparing spawn…", "primary", preloaded ? "" : "disabled") +
        "</div>",
      "wide spawn-page",
    );
  } else if (screen === "direct")
    html = panel(
      "Join by address",
      field("address", "Server address (include http:// for LAN)", "", 'placeholder="https://play.example.org/"') +
        button("go-direct", "Open server", "primary"),
    );
  else if (screen === "link")
    html = panel(
      "Link this browser",
      code
        ? '<p>Enter this code in your other browser. Select your survivor there and choose Link another browser.</p><output class="code">' +
            esc(code.slice(0, 4) + " " + code.slice(4)) +
            "</output><p>Waiting for approval · Expires in five minutes</p>"
        : button("pair", "Get a linking code", "primary") + button("recover", "Use a recovery code", "quiet"),
    );
  else if (screen === "approve")
    html = panel(
      "Approve another browser",
      "<p>" +
        esc(pick) +
        " · " +
        esc(selected?.name) +
        "</p>" +
        field("pair-code", "Code shown in the new browser", "", 'autocomplete="off"') +
        button("grant", "Approve handoff", "primary"),
    );
  else if (screen === "backup")
    html = panel(
      "Recovery code",
      backup
        ? '<p>Save this one-use code with your survivor name and world. Keep it private.</p><output class="code">' + esc(backup) + "</output>"
        : "<p>Generate a new recovery code for " +
            esc(pick) +
            ". Any previous recovery code will expire.</p>" +
            button("make-backup", "Generate recovery code", "primary"),
    );
  else if (screen === "recover")
    html = panel(
      "Recover a survivor",
      field("who", "Survivor name") +
        field("recovery", "Saved recovery code", "", 'autocomplete="off"') +
        button("restore", "Recover survivor", "primary"),
    );
  else if (screen === "password")
    html = panel(
      "Server password",
      field("password", "Password for " + (selected?.name ?? "this world"), "", 'type="password" autocomplete="current-password"') +
        button("unlock", "Join world", "primary"),
    );
  root.innerHTML = html;
  if (screen === "servers") {
    refreshFilters();
    const shelf = root.querySelector<HTMLDetailsElement>("#map-shelf");
    if (shelf)
      shelf.ontoggle = () => {
        if (shelf.isConnected) mapsOpen = shelf.open;
      };
  }
  if (focusKey && focusAttr) root.querySelector<HTMLElement>(focusAttr)?.focus({ preventScroll: true });
  document.querySelector("#world-label")!.textContent = selected && screen !== "title" ? selected.name : "";
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
    if (screen === "create" && step > 0) {
      goStep(step - 1);
      return;
    }
    if (screen === "spawn") nav("create");
    else if (screen === "password" && pending?.intent === "create") nav("spawn");
    else if (["create", "link", "approve", "backup", "password", "recover"].includes(screen)) nav("roster");
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
  if (a === "last") {
    const last = lastPlayed();
    if (last) {
      await selectWorld({ address: last.world, name: last.server, map: last.map, mapId: "", players: 0, max: 0 }, "roster", last.name);
      if (!loadError && pick === last.name) enter({ intent: "resume", name: pick, password: "" });
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
  if (a === "world" || a === "retry-world") {
    const w = a === "world" ? visibleWorlds().find((w) => w.address === b.dataset.world) : selected;
    if (w) {
      if (afterWorld === "create") {
        draft = "";
        look = defaultLook();
        step = group = 0;
        chart = false;
      }
      await selectWorld(w, afterWorld);
      afterWorld = "roster";
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
    draft = "";
    look = defaultLook();
    step = group = 0;
    chart = false;
    turn = 0.25;
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
  if (a === "next-step") {
    if (step === 0) {
      if (!data) throw Error("Wait for the selected world.");
      if (!validName(draft)) throw Error("Use 1–24 letters, numbers, spaces, hyphens or underscores.");
      const checking = draft,
        selectedVersion = version;
      const { available } = await owner("available", { name: checking });
      if (screen !== "create" || step !== 0 || checking !== draft || selectedVersion !== version) return;
      if (!available) throw Error("That name is already in use on this world.");
    }
    goStep(Math.min(2, step + 1));
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
    if (!validName(draft)) throw Error("Use 1–24 letters, numbers, spaces, hyphens or underscores.");
    const checking = draft,
      selectedVersion = version;
    const answer = await owner("available", { name: checking });
    if (screen !== "create" || step !== 2 || checking !== draft || selectedVersion !== version) return;
    if (!answer.available) {
      goStep(0);
      throw Error("That name is already in use on this world.");
    }
    if (!data?.spawns.length) throw Error("This world has no public spawn points.");
    warm();
    nav("spawn");
    return;
  }
  if (a === "place" || a === "warm") {
    if (a === "place") spawn = Number(b.dataset.index);
    notice = "";
    warm();
    render();
    return;
  }
  if (a === "commit" && preloaded) {
    enter({ intent: "create", name: draft, look: Array.from(look), spawn, password: "" });
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
  if (["direct", "link", "approve", "recover", "backup"].includes(a)) {
    nav(a as Screen);
    return;
  }
  if (a === "pair") {
    code = (await owner("pair")).code;
    render();
    void poll(base(), code);
    return;
  }
  if (a === "grant") {
    await owner("approve", { name: pick, code: getInput("pair-code") });
    nav("roster");
    notice = "Browser approved. Continue from the new browser.";
    render();
    return;
  }
  if (a === "make-backup") {
    backup = (await owner("backup", { name: pick })).code;
    render();
    return;
  }
  if (a === "restore") {
    const r = await owner("recover", { name: getInput("who"), code: getInput("recovery") });
    await selectWorld(selected!, "roster", r.survivor.name);
    return;
  }
}
root.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!b || connecting) return;
  connecting = true;
  notice = "";
  try {
    await action(b.dataset.action!, b);
  } catch (err) {
    notice = (err as Error).message;
    const msg = root.querySelector(".message");
    if (msg) msg.textContent = notice;
    else render();
  } finally {
    connecting = false;
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
  if (e.key === "Enter" && (e.target as HTMLInputElement).id === "name") {
    e.preventDefault();
    root.querySelector<HTMLButtonElement>('[data-action="next-step"]')?.click();
  }
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
async function start() {
  if (location.hash.startsWith("#travel=")) {
    location.replace("play.html" + location.search + location.hash);
    return;
  }
  await Promise.all([worldsRefresh(), loadGallery().catch(() => {})]);
  if (screen === "servers") refreshFilters();
  if (screen === "spawn" || screen === "roster") render();
  if (screen === "title" && !root.querySelector(".opening")) render();
  const cur =
    worlds.find((w) => w.address === home) ?? (direct ? { address: home, name: "World", map: "", mapId: "", players: 0, max: 0 } : null);
  const wanted = new URLSearchParams(location.search).get("screen");
  if (cur && wanted === "roster") await selectWorld(cur);
  else if (cur && (wanted === "link" || wanted === "create")) {
    if (wanted === "create") {
      try {
        const prior = readLaunch(sessionStorage.getItem(launchKey(new URL("play.html", home).pathname)));
        if (prior?.intent === "create") {
          draft = prior.name;
          look = Uint8Array.from(prior.look!);
        }
      } catch {}
    }
    await selectWorld(cur, wanted);
  } else if (screen === "title" && !root.querySelector(".opening")) render();
}
if (!location.hash.startsWith("#travel=")) {
  syncScene();
  let seen = false;
  try {
    seen = !!sessionStorage.getItem("snark.intro");
    sessionStorage.setItem("snark.intro", "1");
  } catch {}
  const intro = () => {
    if (root.querySelector(".opening")) render();
  };
  const skip = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      intro();
      removeEventListener("keydown", skip);
    }
  };
  if (!seen) addEventListener("keydown", skip);
  if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) intro();
  else {
    setTimeout(intro, 1400);
    root.addEventListener("click", intro, { once: true });
  }
}
setInterval(() => {
  if (screen === "servers" && !document.hidden) void worldsRefresh();
}, 15000);
void start().catch((e) => {
  notice = e.message;
  render();
});
