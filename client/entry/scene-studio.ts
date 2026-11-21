import { CAMERA_FIELDS, OPENING_SHOT, type CameraField, type TitleShot } from "../../shared/title-scene.ts";
type Catalog = { revision: number; active: string; published: TitleShot; shots: TitleShot[] };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const view = $("view"),
  frame = view.querySelector("iframe")!,
  list = $<HTMLSelectElement>("shots"),
  name = $<HTMLInputElement>("name");
const keys = Object.keys(CAMERA_FIELDS) as CameraField[],
  sliders = new Map<CameraField, HTMLInputElement>();
let catalog: Catalog | null = null,
  shot = structuredClone(OPENING_SHOT),
  paused = false,
  saving = false,
  changed = false;
const notify = (m: string) => {
  $("notice").textContent = m;
};
function updateFrame() {
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
  changed = false;
  name.value = shot.name;
  list.value = shot.id;
  for (const k of keys) setCamera(k, shot.camera[k]);
  updateFrame();
}
function install(c: Catalog, id: string) {
  catalog = c;
  list.replaceChildren(...c.shots.map((s) => new Option(s.name, s.id)));
  $("published").textContent = "On the title · " + c.published.name;
  select(c.shots.find((s) => s.id === id) ?? c.shots[0]!);
  $("reload").hidden = true;
}
async function load() {
  try {
    const r = await fetch("api", { cache: "no-store" });
    if (!r.ok) throw Error("Could not open the shot library.");
    const c: Catalog = await r.json();
    install(c, c.active);
    notify("");
  } catch (e) {
    notify(String(e));
    $("reload").hidden = false;
  }
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
let viewerReady = false;
async function save(publish: boolean) {
  if (publish && !viewerReady) { notify("Wait for the live preview before publishing."); return; }
  if (!catalog || saving) return;
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
  $("save").setAttribute("disabled", "");
  $("publish").setAttribute("disabled", "");
  try {
    const picture = publish ? await poster(false) : undefined;
    const portrait = publish ? await poster(true) : undefined;
    const r = await fetch("api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shot: snapshot, revision: catalog.revision, publish, picture, portrait }),
    });
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 409) $("reload").hidden = false;
      throw Error(data.error ?? "Save failed.");
    }
    install(data, id);
    notify(publish ? "Published. New title screens use this shot." : "Draft saved.");
  } catch (e) {
    notify(String(e));
  } finally {
    saving = false;
    document.querySelector("main")!.inert = false;
    $("save").removeAttribute("disabled");
    $<HTMLButtonElement>("publish").disabled = !viewerReady;
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
  for (const k of keys) setCamera(k, OPENING_SHOT.camera[k]);
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
  if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.source !== "snark-scene") return;
  if (e.data.type === "poster" && capture?.request === e.data.request && typeof e.data.picture === "string") capture?.done(e.data.picture);
  if (e.data.type === "frame") updateFrame();
  if (e.data.type === "ready") {
    viewerReady = true;
    $("playback").textContent = "Live · Miami";
    $<HTMLButtonElement>("publish").disabled = false;
  }
  if (e.data.type === "failed") {
    viewerReady = false;
    $("playback").textContent = "The renderer could not load. Reload the studio to retry.";
    $<HTMLButtonElement>("publish").disabled = true;
  }
});
void load();
