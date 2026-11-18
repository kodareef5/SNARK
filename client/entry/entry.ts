import { worldUrl } from "./address.ts";
import { defaultLook, LOOK_SEX, LOOK_BEARD, randomLook, setRegion } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { loadIdentity } from "../core/identity.ts";
import { readLaunch, launchKey, savedName, validName, type EntrySurvivor, type Launch, type Remembered } from "../core/entry-state.ts";
import { appearanceFields, button, esc, field } from "./forms.ts";
import { preloadWorld } from "./preload.ts";
import { sceneFor } from "./scenery.ts";
import { directoryView, directoryAction, directoryRows, type Listing } from "./registration.ts";

type Screen =
  "title" | "servers" | "roster" | "create" | "spawn" | "link" | "approve" | "backup" | "recover" | "direct" | "register" | "password";
interface World {
  name: string;
  map: string;
  mapId: string;
  address: string;
  players: number;
  max: number;
  password?: boolean;
  online?: boolean;
}
interface Details extends World {
  spawns: { name: string; x: number; z: number }[];
  width: number;
  height: number;
}
const root = document.querySelector<HTMLElement>("#entry-root")!,
  status = document.querySelector<HTMLElement>("#loading")!;
const home = worldUrl("./", location.href),
  direct = document.body.dataset.world === "true";
const dir = () => document.body.dataset.directory || new URL("directory", home).href;
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
  body = false,
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
const base = () => selected?.address || home;
const human = () => screen === "create" || screen === "spawn";
const selectedRow = () => known.find((r) => r.name === pick);
const getInput = (id: string) => document.querySelector<HTMLInputElement>("#" + id)?.value ?? "";
async function json(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
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
function remember(rows: EntrySurvivor[], active = "") {
  const now = Date.now(),
    world = base(),
    old = remembered(),
    prior = old.filter((r) => r.world === world);
  const next = old.filter((r) => r.world !== world);
  for (const r of rows)
    next.push({
      ...r,
      world,
      server: selected?.name ?? "",
      map: selected?.map ?? "",
      played: r.name === active ? now : (prior.find((p) => p.id === r.id)?.played ?? 0),
    });
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
  const slug = selected?.mapId.split(":").pop();
  if (slug && /^[\w-]+$/.test(slug)) {
    const map = new Image();
    map.src = "title/map-" + slug + ".png";
    void map.decode().catch(() => {});
  }
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
  try {
    const [info, roster] = await Promise.all([json(new URL("entry-world.json", address).href), owner("roster")]);
    if (v !== version) return;
    data = info;
    known = roster.survivors;
    selected = { ...selected, ...info, address };
    pick = known.some((r) => r.name === wanted) ? wanted : (known[0]?.name ?? "");
    remember(known);
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
  void directoryRows(dir())
    .then((rows) => {
      listed = rows;
      directoryOffline = false;
      refreshFilters();
    })
    .catch(() => {
      directoryOffline = true;
      refreshFilters();
    });
  if (screen === "servers") renderList();
}
function nav(next: Screen) {
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
}
function syncScene() {
  const miami = worlds.find((w) => w.mapId === "core:miami" && new URL(w.address).origin === location.origin);
  const saved = screen === "roster" && fromWorld ? selectedRow()?.look : null;
  const portrait = human() || !!saved;
  const w = portrait ? selected : miami;
  sceneFor(w?.address ?? "", w?.mapId ?? "", portrait, saved ? Uint8Array.from(saved) : look, spawn, turn, screen === "create");
}
function panel(title: string, inside: string, style = "", back = "back") {
  return (
    '<section class="panel ' +
    style +
    '"><div class="topline">' +
    button(back, "← Back", "quiet") +
    "<span>" +
    esc(human() || fromWorld ? (selected?.name ?? "") : "") +
    "</span></div><h1>" +
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
function refreshFilters() {
  const maps = document.querySelector<HTMLSelectElement>("#map-filter");
  if (!maps) return;
  maps.innerHTML =
    '<option value="">All maps</option>' +
    [...new Set([...worlds, ...listed].map((w) => w.map))].map((m) => "<option>" + esc(m) + "</option>").join("");
  maps.value = mapFilter;
  const note = document.querySelector<HTMLElement>("#directory-offline");
  if (note) note.hidden = !directoryOffline;
  renderList();
}
function renderList() {
  const list = document.querySelector("#results");
  if (!list) return;
  list.innerHTML =
    visibleWorlds()
      .map(
        (w) =>
          '<button class="row" data-action="world" data-world="' +
          esc(w.address) +
          '"><span><strong>' +
          esc(w.name) +
          "</strong><small>" +
          esc(w.map) +
          (w.password ? " · Password required" : "") +
          "</small></span><span>" +
          (w.online === false ? "Offline" : esc(w.players) + " / " + esc(w.max)) +
          "　›</span></button>",
      )
      .join("") || "<p>No matching servers.</p>";
}
function survivors() {
  const local = fromWorld ? known : remembered();
  const rows = local
    .map((r) => {
      const address = "world" in r ? String(r.world) : base();
      return (
        '<button class="row" data-action="pick" data-world="' +
        esc(address) +
        '" data-name="' +
        esc(r.name) +
        '" aria-pressed="' +
        (r.name === pick && address === base()) +
        '"><span><strong>' +
        esc(r.name) +
        "</strong><small>" +
        esc("server" in r ? r.server : selected?.name) +
        " · Level " +
        r.level +
        (r.dead ? " · Awaiting respawn" : "") +
        "</small></span><span>›</span></button>"
      );
    })
    .join("");
  return (
    "<p>" +
    esc(fromWorld ? (selected?.map ?? "") + " · This world" : "On this browser") +
    '</p><div class="list">' +
    (loadingWorld ? "<p>Finding survivors…</p>" : rows || "<p>No survivors remembered here yet.</p>") +
    '</div><div class="stack">' +
    (fromWorld && selectedRow() ? button("continue", "Continue as " + pick, "primary") : "") +
    button("new", "New survivor", pick ? "secondary" : "primary", fromWorld && (loadingWorld || loadError) ? "disabled" : "") +
    (fromWorld ? button("link", "Link this browser", "quiet") : button("link-world", "Link this browser", "quiet")) +
    (fromWorld && selectedRow() ? button("approve", "Link another browser", "quiet") + button("backup", "Save a recovery code", "quiet") : "") +
    (loadError ? button("retry-world", "Retry world") : "") +
    "</div>"
  );
}
function render() {
  const old = root.querySelector(".appearance-fields")?.scrollTop ?? 0;
  const last = remembered().find((r) => r.played > 0);
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
    const maps = [...new Set([...worlds, ...listed].map((w) => w.map))];
    html = panel(
      "Find a server",
      '<div class="filters"><input aria-label="Search servers or cities" id="query" placeholder="Search servers or cities" value="' +
        esc(query) +
        '"><select id="map-filter" aria-label="Map"><option value="">All maps</option>' +
        maps.map((m) => "<option " + (mapFilter === m ? "selected" : "") + ">" + esc(m) + "</option>").join("") +
        '</select><select id="access-filter" aria-label="Access"><option value="">Any access</option><option value="open">Open</option><option value="locked">Password</option></select></div><div id="results" class="list"></div><p id="directory-offline" ' +
        (directoryOffline ? "" : "hidden") +
        '>Public directory unavailable. Cluster worlds and direct joins are available.</p><div class="actions">' +
        button("direct", "Join by address", "quiet") +
        button("register", "Register your server", "quiet") +
        "</div>",
      "wide",
    );
  } else if (screen === "roster") html = panel("My survivors", survivors());
  else if (screen === "create") {
    html = panel(
      "New survivor",
      field("name", "Survivor name", draft, 'maxlength="24" autocomplete="off" placeholder="Choose a name"') +
        '<div class="tabs">' +
        button("look", "Look", body ? "" : "selected") +
        button("body", "Body", body ? "selected" : "") +
        "</div>" +
        '<div class="appearance-fields">' +
        appearanceFields(look, body) +
        '<div class="actions">' +
        button("rotate", "Rotate") +
        button("random", "Randomize") +
        button("reset", "Reset") +
        '</div></div><div class="actions next">' +
        button("spawn", "Choose spawn", "primary") +
        "</div>",
      "creator",
    );
  } else if (screen === "spawn") {
    const points = data?.spawns ?? [],
      map = selected?.mapId.split(":").pop() || "",
      image = /^[\w-]+$/.test(map) ? "background-image:url(title/map-" + map + ".png);background-size:cover;" : "";
    const pins = points
      .map(
        (p, i) =>
          '<button class="pin" aria-label="' +
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
    html = panel(
      "Choose spawn",
      "<p>" +
        esc(draft) +
        " · " +
        esc(selected?.map) +
        '</p><div class="spawn-grid"><div class="chart" style="' +
        image +
        '">' +
        pins +
        '</div><div class="list">' +
        points.map((p, i) => button("place", p.name, i === spawn ? "selected" : "", 'data-index="' + i + '"')).join("") +
        '</div></div><div class="actions">' +
        button("commit", "Create and spawn", "primary", preloaded ? "" : "disabled") +
        (preloaded ? "" : button("warm", "Retry preload", "quiet")) +
        "</div>",
      "wide",
    );
  } else if (screen === "direct")
    html = panel(
      "Join by address",
      field("address", "Server or invite address", "", 'placeholder="https://play.example.org/"') +
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
  else if (screen === "register") html = panel("Register your server", directoryView());
  else if (screen === "password")
    html = panel(
      "Server password",
      field("password", "Password for " + (selected?.name ?? "this world"), "", 'type="password" autocomplete="current-password"') +
        button("unlock", "Join world", "primary"),
    );
  root.innerHTML = html;
  if (screen === "servers") {
    (document.querySelector("#access-filter") as HTMLSelectElement).value = accessFilter;
    renderList();
  }
  if (screen === "create" && body) root.querySelector(".appearance-fields")!.scrollTop = old;
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
  if (launch.intent === "resume") remember(known, launch.name);
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
    else if (["create", "link", "approve", "backup", "password", "recover"].includes(screen)) nav("roster");
    else if (["register", "direct"].includes(screen) || (screen === "roster" && fromWorld)) nav("servers");
    else nav("title");
    return;
  }
  if (a === "servers" || a === "link-world") {
    afterWorld = a === "link-world" ? "link" : "roster";
    fromWorld = false;
    nav("servers");
    void worldsRefresh();
    return;
  }
  if (a === "last") {
    const last = remembered().find((r) => r.played > 0);
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
    return;
  }
  if (a === "world" || a === "retry-world") {
    const w = a === "world" ? visibleWorlds().find((w) => w.address === b.dataset.world) : selected;
    if (w) {
      if (afterWorld === "create") {
        draft = "";
        look = defaultLook();
        body = false;
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
    body = false;
    turn = 0.25;
    nav("create");
    return;
  }
  if (a === "continue" && selectedRow()) {
    enter({ intent: "resume", name: pick, password: "" });
    return;
  }
  if (a === "look" || a === "body") {
    body = a === "body";
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
  if (a === "swatch") {
    look[Number(b.dataset.field)] = Number(b.dataset.value);
    render();
    return;
  }
  if (a === "spawn") {
    if (!validName(draft)) throw Error("Use 1–24 letters, numbers, spaces, hyphens or underscores.");
    const answer = await owner("available", { name: draft });
    if (!answer.available) throw Error("That name is already in use on this world.");
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
  if (["direct", "register", "link", "approve", "recover", "backup"].includes(a)) {
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
  if (a.startsWith("registry-")) {
    await directoryAction(a, dir(), getInput);
    render();
    void worldsRefresh();
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
  if (input.id === "name") draft = input.value;
  if (input.id === "query") {
    query = input.value;
    renderList();
  }
  if (input.dataset.region !== undefined) {
    setRegion(look, Number(input.dataset.region), Number(input.value));
    syncScene();
  }
});
root.addEventListener("change", (e) => {
  const input = e.target as HTMLSelectElement;
  if (input.id === "map-filter") mapFilter = input.value;
  if (input.id === "access-filter") accessFilter = input.value;
  if (input.dataset.look !== undefined) {
    const i = Number(input.dataset.look);
    look[i] = Number(input.value);
    if (i === LOOK_SEX && look[i]) look[LOOK_BEARD] = 0;
    render();
  } else renderList();
});
document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  nav("title");
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && screen !== "title") void action("back", root);
});
async function start() {
  if (location.hash.startsWith("#travel=")) {
    location.replace("play.html" + location.search + location.hash);
    return;
  }
  await worldsRefresh();
  if (screen === "title" && !root.querySelector(".opening")) render();
  const cur =
    worlds.find((w) => w.address === home) ?? (direct ? { address: home, name: "World", map: "", mapId: "", players: 0, max: 0 } : null);
  // Discover old named survivors with their existing key, including names used only by a legacy deep link.
  for (const w of worlds.filter((w) => new URL(w.address).origin === location.origin)) {
    try {
      const r = await json(new URL("survivors", w.address).href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "roster", key }),
      });
      const played = JSON.parse(read("snark.played." + w.address) ?? "null");
      const existing = remembered(),
        rows: Remembered[] = r.survivors.map((s: EntrySurvivor) => ({
          ...s,
          world: w.address,
          server: w.name,
          map: w.map,
          played:
            played?.name === s.name
              ? played.time
              : (existing.find((e) => e.world === w.address && e.id === s.id)?.played ?? (s.name === read("snark.name") ? 1 : 0)),
        }));
      write(rosterStore, JSON.stringify([...existing.filter((e) => e.world !== w.address), ...rows]));
    } catch {}
  }
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
