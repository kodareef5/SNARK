import { initialShots, SCENE_CATEGORIES, type EditableSceneCategory, type SceneCategory, type ShotCatalog, type WikiSceneCatalog, type WikiSceneRecipe } from "../../shared/player-scenes.ts";
import { CAMERA_FIELDS, OPENING_SHOT, type CameraField, type TitleShot } from "../../shared/title-scene.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $("view"),
  frame = view.querySelector("iframe")!,
  list = $<HTMLSelectElement>("shots"),
  name = $<HTMLInputElement>("name"),
  recipes = $<HTMLSelectElement>("recipes"),
  picture = $<HTMLImageElement>("wiki-picture");
const categoryButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-category]"));
const endpoint = (value: SceneCategory): string => "/admin/scenes/api?category=" + value;
const keys = Object.keys(CAMERA_FIELDS) as CameraField[],
  sliders = new Map<CameraField, HTMLInputElement>();
let category: SceneCategory = "title",
  catalog: ShotCatalog | null = null,
  wiki: WikiSceneCatalog | null = null,
  viewerReady = false,
  loading = 0,
  baseline = { ...OPENING_SHOT.camera },
  shot = structuredClone(OPENING_SHOT),
  paused = false,
  saving = false,
  changed = false;
const notify = (m: string) => {
  $("notice").textContent = m;
};
function updateFrame() {
  if (category === "wiki") return;
  frame.contentWindow?.postMessage({ source: "snark-title", preset: shot, paused }, location.origin);
}
function setCamera(k: CameraField, v: number) {
  const [, min, max, step] = CAMERA_FIELDS[k];
  shot.camera[k] = Number(Math.max(min, Math.min(max, Math.round(v / step) * step)).toFixed(2));
  sliders.get(k)!.value = String(shot.camera[k]);
  $(k + "-value").textContent = String(shot.camera[k]) + (["pan", "tilt", "lens"].includes(k) ? "°" : k === "hour" ? " h" : " m");
}
for (const k of keys) {
  const [label, min, max, step] = CAMERA_FIELDS[k],
    row = document.createElement("label"),
    input = document.createElement("input"),
    output = document.createElement("output");
  row.className = "control";
  input.type = "range";
  input.id = "field-" + k;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  output.id = k + "-value";
  output.htmlFor.add(input.id);
  row.append(label, input, output);
  $("controls").append(row);
  sliders.set(k, input);
  input.oninput = () => {
    setCamera(k, Number(input.value));
    edit();
  };
}
function edit() {
  changed = true;
  notify("Unsaved changes");
  updateFrame();
}
function select(s: TitleShot) {
  shot = structuredClone(s);
  baseline = { ...shot.camera };
  changed = false;
  name.value = shot.name;
  list.value = shot.id;
  for (const k of keys) setCamera(k, shot.camera[k]);
  updateFrame();
}
function actions() {
  $<HTMLButtonElement>("publish").disabled = !catalog || !viewerReady || saving;
  for (const action of ["save", "copy", "reset"]) $<HTMLButtonElement>(action).disabled = !catalog || saving;
  for (const button of categoryButtons) button.disabled = saving;
}

function install(c: ShotCatalog, id: string) {
  catalog = c;
  list.replaceChildren(...c.shots.map((s) => new Option(s.name, s.id)));
  $("published").textContent = (category === "loaders" ? "Published loader · " : "Published title · ") + c.published.name;
  select(c.shots.find((s) => s.id === id) ?? c.shots[0]!);
  $("reload").hidden = true;
  actions();
}

function wikiFields(recipe: WikiSceneRecipe): [string, string][] {
  const map = recipe.map.replace(/(^|-)([a-z])/g, (_, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
  const where: [string, string][] = [["Map", map], ["Placement", recipe.route]];
  if (recipe.kind === "shore") return [...where, ["Set", "Wynwood shore"], ["Sun hour", String(recipe.shot.camera.hour)], ["Frame", `${recipe.seconds} s`]];
  if (recipe.kind === "section") {
    const { actors, hour, landmark } = recipe.composition;
    const cast = [...new Set(actors.map(([kind]) => kind.replaceAll("_", " ")))];
    if (landmark) cast.push(landmark);
    return [...where, ["Sun hour", String(hour)], ...(cast.length ? [["Cast", cast.join(", ")] as [string, string]] : [])];
  }
  return [...where, ["Sun hour", String(recipe.camera.hour)], ...(recipe.kind === "obelisk" ? [["Camera", recipe.camera.view] as [string, string]] : [])];
}

function selectRecipe() {
  const recipe = wiki?.recipes.find(({ id }) => id === recipes.value);
  const media = recipe ? wiki?.media[recipe.id] : undefined;
  const image = media?.landscape;
  const shown = !!image && /^\/wiki\/media\/[a-z0-9.-]+\.webp$/i.test(image.file);
  const note = $("wiki-preview-note");
  note.hidden = shown;
  picture.hidden = !shown;
  if (image && shown) {
    picture.src = image.file;
    picture.alt = recipe?.alt ?? "";
    picture.width = image.width;
    picture.height = image.height;
  } else {
    picture.removeAttribute("src");
    note.textContent = recipe ? "Run bun run wiki to render this preview." : "Build the client to load Wiki recipes.";
  }
  $("recipe-description").textContent = recipe?.alt ?? "";
  $("recipe-detail").replaceChildren(...(recipe ? wikiFields(recipe).flatMap(([label, value]) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    return [dt, dd];
  }) : []));
  $("recipe-declaration").hidden = !recipe;
  $("recipe-source").textContent = recipe ? JSON.stringify(recipe, null, 2) : "";
  const link = $<HTMLAnchorElement>("recipe-page");
  link.hidden = !shown || !recipe?.route.startsWith("/wiki/");
  link.href = link.hidden ? "/wiki/" : recipe!.route;
}

function installWiki(c: WikiSceneCatalog) {
  wiki = c;
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const recipe of c.recipes) {
    const label = recipe.kind === "city" ? "City galleries" : recipe.kind === "obelisk" ? "Obelisk galleries" : "Wiki sections";
    let group = groups.get(label);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = label;
      groups.set(label, group);
    }
    group.append(new Option(recipe.name, recipe.id));
  }
  recipes.replaceChildren(...groups.values());
  selectRecipe();
}

async function load() {
  const wanted = category, request = ++loading;
  try {
    const r = await fetch(endpoint(wanted), { cache: "no-store" });
    if (!r.ok) throw Error("Could not open the scene library.");
    const data: unknown = await r.json();
    if (request !== loading) return;
    if (wanted === "wiki") installWiki(data as WikiSceneCatalog);
    else {
      const c = data as ShotCatalog;
      install(c, c.active);
    }
    $("reload").hidden = true;
    notify("");
  } catch (e) {
    if (request !== loading) return;
    notify(e instanceof Error ? e.message : String(e));
    $("reload").hidden = false;
  }
}

function changeCategory(next: SceneCategory, first = false) {
  if (saving || !first && next === category) return;
  if (changed && !confirm("Discard unsaved changes to this shot?")) return;
  category = next;
  catalog = null;
  changed = false;
  for (const button of categoryButtons) button.setAttribute("aria-pressed", String(button.dataset.category === next));
  const viewingWiki = next === "wiki";
  $("live-monitor").hidden = $("editor-panel").hidden = viewingWiki;
  $("wiki-monitor").hidden = $("wiki-panel").hidden = !viewingWiki;
  if (viewingWiki) {
    viewerReady = false;
    delete view.dataset.ready;
    frame.removeAttribute("src");
    selectRecipe();
  } else {
    const initial = initialShots(next);
    view.dataset.category = next;
    if (!frame.hasAttribute("src")) {
      $("playback").textContent = "Loading set…";
      frame.src = "/flight.html?set=wynwood-shore";
    }
    list.replaceChildren(new Option(initial.published.name, initial.active));
    select(initial.published);
    $("published").textContent = "";
    $("publish").textContent = next === "loaders" ? "Publish loader" : "Publish title";
  }
  const url = new URL(location.href);
  if (next === "title") url.searchParams.delete("category");
  else url.searchParams.set("category", next);
  history.replaceState(null, "", url);
  notify("Loading scene library…");
  actions();
  void load();
}

let sequence = 0,
  capture: { request: number; done: (value: string) => void } | null = null;
function poster(portrait: boolean): Promise<string> {
  const request = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      capture = null;
      reject(Error("The preview is still loading. Try publishing when it is live."));
    }, 8000);
    capture = {
      request,
      done: (picture) => {
        clearTimeout(timeout);
        capture = null;
        resolve(picture);
      },
    };
    frame.contentWindow?.postMessage({ source: "snark-title", preset: shot, posterRequest: request, portrait }, location.origin);
  });
}
async function save(publish: boolean) {
  if (publish && !viewerReady) { notify("Wait for the live preview before publishing."); return; }
  if (!catalog || category === "wiki" || saving) return;
  if (!name.value.trim()) {
    name.focus();
    notify("Give this shot a name.");
    return;
  }
  saving = true;
  document.querySelector("main")!.inert = true;
  const snapshot = structuredClone(shot),
    id = snapshot.id;
  snapshot.name = name.value.trim();
  const target: EditableSceneCategory = category;
  actions();
  try {
    const picture = publish ? await poster(false) : undefined;
    const portrait = publish ? await poster(true) : undefined;
    const r = await fetch(endpoint(target), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: target, shot: snapshot, revision: catalog.revision, publish, picture, portrait }),
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 409) $("reload").hidden = false;
      throw Error(data.error ?? "Save failed.");
    }
    install(data, id);
    notify(publish ? (target === "loaders" ? "Published for new loading screens." : "Published for new title screens.") : "Draft saved.");
  } catch (e) {
    notify(String(e));
  } finally {
    saving = false;
    document.querySelector("main")!.inert = false;
    actions();
  }
}
name.oninput = () => {
  shot.name = name.value;
  edit();
};
list.onchange = () => {
  const next = catalog?.shots.find((s) => s.id === list.value);
  if (next) {
    if (changed && !confirm("Discard unsaved changes to this shot?")) {
      list.value = shot.id;
      return;
    }
    select(next);
    notify("");
  }
};
$("copy").onclick = () => {
  shot = structuredClone(shot);
  shot.id = "shot-" + crypto.getRandomValues(new Uint32Array(2)).join("-");
  shot.name = (name.value.slice(0, 68) || "Untitled") + " copy";
  list.add(new Option(shot.name, shot.id));
  select(shot);
  edit();
  name.focus();
};
$("save").onclick = () => void save(false);
$("publish").onclick = () => void save(true);
$("reload").onclick = () => void load();
$("reset").onclick = () => {
  for (const k of keys) setCamera(k, baseline[k]);
  edit();
};
$("pause").onclick = () => {
  paused = !paused;
  $("pause").textContent = paused ? "Resume motion" : "Pause motion";
  updateFrame();
};
$<HTMLInputElement>("guides").onchange = (e) => {
  $("guide").hidden = !(e.target as HTMLInputElement).checked;
};
$<HTMLSelectElement>("aspect").onchange = (e) => view.classList.toggle("tall", (e.target as HTMLSelectElement).value === "tall");
let drag: { x: number; y: number; id: number } | null = null;
view.onpointerdown = (e) => {
  view.focus();
  view.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
};
view.onpointermove = (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = (e.clientX - drag.x) / view.clientHeight,
    dy = (e.clientY - drag.y) / view.clientHeight;
  if (e.shiftKey) {
    setCamera("side", shot.camera.side - dx * 18);
    setCamera("height", shot.camera.height + dy * 18);
  } else {
    setCamera("pan", shot.camera.pan + dx * shot.camera.lens);
    setCamera("tilt", shot.camera.tilt + dy * shot.camera.lens);
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  edit();
};
view.onlostpointercapture = () => {
  drag = null;
};
view.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    setCamera("back", shot.camera.back + Math.sign(e.deltaY) * 0.25);
    edit();
  },
  { passive: false },
);
view.onkeydown = (e) => {
  const delta: Record<string, [CameraField, number]> = {
    ArrowLeft: ["pan", 1],
    ArrowRight: ["pan", -1],
    ArrowUp: ["tilt", 1],
    ArrowDown: ["tilt", -1],
  };
  const d = delta[e.key];
  if (d) {
    e.preventDefault();
    setCamera(d[0], shot.camera[d[0]] + d[1]);
    edit();
  }
};
addEventListener("message", (e) => {
  if (category === "wiki" || e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.source !== "snark-scene") return;
  if (e.data.type === "poster" && capture?.request === e.data.request && typeof e.data.picture === "string") capture?.done(e.data.picture);
  if (e.data.type === "frame") updateFrame();
  if (e.data.type === "ready") {
    viewerReady = true;
    view.dataset.ready = "";
    $("playback").textContent = "Live · Miami";
    actions();
  }
  if (e.data.type === "failed") {
    viewerReady = false;
    delete view.dataset.ready;
    $("playback").textContent = "The renderer could not load. Reload the studio to retry.";
    actions();
  }
});
recipes.onchange = selectRecipe;
picture.onerror = () => {
  picture.hidden = true;
  $("wiki-preview-note").hidden = false;
  $("wiki-preview-note").textContent = "This photo could not load. Rebuild the Wiki and reload the library.";
};
for (const button of categoryButtons) button.onclick = () => changeCategory(button.dataset.category as SceneCategory);
const requested = new URLSearchParams(location.search).get("category") as SceneCategory;
changeCategory(SCENE_CATEGORIES.includes(requested) ? requested : "title", true);
