// The wiki's pages read whole without this. It plays a sound from the game's sound files, moves and layers a map,
// copies a console line, searches, works the figures out again for the world the visitor came from, and says which maps
// the cluster behind it runs.

import { findRows, mapTransform, type SearchRow } from "../core/wiki/filter.ts";
import { takeSamples } from "../core/wiki/sound.ts";
import { liveMaps, worldPath, type LiveWorld, type ServerSaid } from "../core/wiki/world.ts";

const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

// A sound's takes are fetched at the first press of one (client/core/wiki/sound.ts). One sound plays at a time: the button
// pressed, `playing`, shows it sounding (aria-pressed) from when `source` starts until it ends or is stopped.
let audio: AudioContext | null = null;
let playing: HTMLElement | null = null;
let source: AudioBufferSourceNode | null = null;
const decoded = new Map<string, Promise<AudioBuffer[]>>();

const takes = async (row: HTMLElement): Promise<AudioBuffer[]> => (await takeSamples(row.dataset, fetch)).map((s) => {
  const b = new AudioBuffer({ length: s.length, numberOfChannels: 1, sampleRate: Number(row.dataset.rate) });
  b.copyToChannel(s, 0);
  return b;
});

/** Stops the take sounding, and the music but `keep`. */
function hush(keep?: EventTarget | null): void {
  for (const a of all<HTMLAudioElement>("audio")) if (a !== keep) a.pause();
  playing?.setAttribute("aria-pressed", "false");
  source?.stop();
  [playing, source] = [null, null];
}

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-k]");
  const row = button?.closest<HTMLElement>("[data-takes]");
  if (button && row) {
    const again = playing === button;
    hush();
    if (again) return;
    audio ??= new AudioContext();
    void audio.resume();
    playing = button;
    const key = `${row.dataset.file}@${row.dataset.at}`;
    if (!decoded.has(key)) decoded.set(key, takes(row));
    decoded.get(key)!.then((list) => {
      if (playing !== button || source) return;
      source = new AudioBufferSourceNode(audio!, { buffer: list[Number(button.dataset.k)]! });
      source.connect(audio!.destination);
      source.onended = (e) => source === e.target && hush();
      source.start();
      button.setAttribute("aria-pressed", "true");
    }, () => {
      decoded.delete(key);
      button.classList.add("failed");
    });
  }
  const copy = (event.target as Element).closest<HTMLButtonElement>("[data-copy]");
  if (copy) {
    const text = document.getElementById(copy.dataset.copy!)?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => (copy.textContent = "Copied"), () => (copy.textContent = "Select it to copy"));
  }
});
document.addEventListener("play", (event) => hush(event.target), true);

// The search page asks for the index once, as the first letter is typed or a query arrives in its address.
for (const list of all<HTMLOListElement>("[data-search]")) {
  const input = document.querySelector<HTMLInputElement>("main .find input")!;
  let rows: Promise<SearchRow[]> | null = null;
  const show = async (): Promise<void> => {
    rows ??= fetch(list.dataset.search!).then((r) => r.json() as Promise<SearchRow[]>);
    const found = findRows(await rows, input.value);
    list.replaceChildren(...found.map(([label, path, group, picture]) => {
      const li = document.createElement("li");
      const a = li.appendChild(document.createElement("a"));
      a.href = path;
      if (picture) Object.assign(a.appendChild(document.createElement("img")), { src: picture, alt: "", loading: "lazy", width: 48, height: 36 });
      a.append(label);
      li.appendChild(document.createElement("small")).textContent = group;
      return li;
    }));
    if (input.value && found.length === 0) list.textContent = "Nothing in the wiki is called that.";
  };
  input.value = new URLSearchParams(location.search).get("q") ?? "";
  input.addEventListener("input", () => void show());
  if (input.value) void show();
}

// The world says what it runs beside its links.json; with no world behind the page, or one at its defaults, nothing changes.
const kept = ((): string | null => { try { return sessionStorage.getItem("world"); } catch { return null; } })();
const world = worldPath(location.search, document.referrer, location.origin, kept);
try { sessionStorage.setItem("world", world); } catch { /* Without storage each page asks by its own address. */ }
void fetch(`${world}/settings.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then(async (said: ServerSaid | null) => {
  if (!said?.settings || Object.keys(said.settings).length === 0) return;
  const { changed, rated, settingText, settingsLine, tamingRows } = await import("../core/wiki/rates.ts");
  const kinds = new Set<string>();
  for (const el of all<HTMLElement>("[data-figure]")) el.textContent = rated(kinds.add(el.dataset.figure!) && el.dataset.figure!, el.dataset.v!, said);
  for (const t of all<HTMLTableElement>("[data-taming]")) {
    kinds.add("taming");
    t.tBodies[0]!.replaceChildren(...tamingRows(JSON.parse(t.dataset.taming!), said).map((row) => {
      const tr = document.createElement("tr");
      row.forEach((text, k) => (tr.appendChild(document.createElement(k ? "td" : "th")).textContent = text));
      return tr;
    }));
  }
  for (const td of all<HTMLElement>("[data-setting]")) {
    const v = said.settings[td.dataset.setting!];
    if (v !== undefined) td.appendChild(document.createElement("b")).textContent = ` · ${said.name}: ${settingText(v)}`;
  }
  const differ = changed(kinds, said);
  if (differ.length === 0) return;
  const note = Object.assign(document.createElement("p"), { className: "note" });
  note.append("Figures here are for ", Object.assign(document.createElement("a"), { href: `${world}/`, textContent: said.name }), `: ${settingsLine(differ)}.`);
  document.querySelector("main .heading")?.after(note);
}, () => {});

// The maps the cluster behind the page runs, as its start screen lists its worlds; with no server behind it, as built.
const lists = all<HTMLElement>("[data-maps]");
if (lists.length) void fetch("/worlds.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((worlds: LiveWorld[] | null) => {
  for (const at of Array.isArray(worlds) ? lists : []) at.innerHTML = liveMaps(all<HTMLElement>("[data-map]", at).map((c) => [c.dataset.map!, c.outerHTML]), worlds!, at.dataset.maps === "every");
}, () => {});

// A map moves under a drag and zooms by its buttons, the wheel with ctrl, and the keys; its layers show by their boxes.
for (const view of all<HTMLElement>("[data-atlas]")) {
  const plane = view.querySelector<HTMLElement>(".plane")!;
  let at = { zoom: 1, x: 0, y: 0 };
  let drag: { id: number; x: number; y: number; from: typeof at } | null = null;
  const draw = (): void => {
    at = mapTransform(at.zoom, at.x, at.y, view.clientWidth, view.clientHeight);
    plane.style.transform = `translate(${at.x}px, ${at.y}px) scale(${at.zoom})`;
    view.style.setProperty("--zoom", String(at.zoom));
  };
  const zoom = (by: number): void => {
    const z = Math.max(1, Math.min(8, at.zoom * by));
    at = { zoom: z, x: (at.x * z) / at.zoom, y: (at.y * z) / at.zoom };
    draw();
  };
  for (const b of all<HTMLButtonElement>("[data-zoom]", view)) {
    b.addEventListener("click", () => (b.dataset.zoom === "0" ? ((at = { zoom: 1, x: 0, y: 0 }), draw()) : zoom(b.dataset.zoom === "1" ? 1.5 : 1 / 1.5)));
  }
  view.addEventListener("pointerdown", (e) => {
    // A button or a landmark's link is pressed, not dragged.
    if ((e.target as Element).closest("button, a")) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { ...at } };
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener("pointermove", (e) => {
    if (drag?.id !== e.pointerId) return;
    at = { ...at, x: drag.from.x + e.clientX - drag.x, y: drag.from.y + e.clientY - drag.y };
    draw();
  });
  for (const end of ["pointerup", "pointercancel"]) view.addEventListener(end, () => (drag = null));
  view.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  view.addEventListener("keydown", (e) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
    if (e.key === "+" || e.key === "=") zoom(1.5);
    else if (e.key === "-") zoom(1 / 1.5);
    else if (step[e.key]) at = { ...at, x: at.x + step[e.key]![0], y: at.y + step[e.key]![1] };
    else return;
    e.preventDefault();
    draw();
  });
  new ResizeObserver(draw).observe(view);
  const atlas = view.closest(".atlas")!;
  const show = (box: HTMLInputElement): void => {
    for (const layer of all<HTMLElement | SVGElement>(`[data-layer="${box.dataset.show}"]`, atlas)) {
      if (layer instanceof HTMLImageElement && box.checked && !layer.src) layer.src = layer.dataset.src!;
      if (box.checked) layer.removeAttribute("hidden");
      else layer.setAttribute("hidden", "");
    }
  };
  const asked = new URLSearchParams(location.search).get("show");
  for (const box of all<HTMLInputElement>("[data-show]", atlas)) {
    if (box.dataset.show === asked) box.checked = true;
    box.addEventListener("change", () => show(box));
    show(box);
  }
}

// "View in 3D" puts the game's own studio (client/entry/studio.ts) over an entry's picture, one at a time. The picture comes
// back, with a note, if the studio says it cannot draw here or has not drawn within 45 s.
let shown: { figure: HTMLElement; frame: HTMLIFrameElement; timer: number } | null = null;
function closeView(note = ""): void {
  if (!shown) return;
  const { figure, frame, timer } = shown;
  [shown, frame.src] = [null, "about:blank"];
  clearTimeout(timer);
  frame.remove();
  figure.classList.remove("in3d");
  const b = figure.querySelector<HTMLButtonElement>("[data-view]")!;
  b.setAttribute("aria-expanded", "false");
  if (note) b.insertAdjacentHTML("afterend", `<p class="note">${note}</p>`);
}
document.addEventListener("click", (event) => {
  const b = (event.target as Element).closest<HTMLButtonElement>("[data-view]");
  const figure = b?.closest<HTMLElement>("figure");
  if (!b || !figure) return;
  const again = shown?.figure === figure;
  closeView();
  if (again) return;
  const frame = Object.assign(document.createElement("iframe"), { src: b.dataset.view!, title: `${b.dataset.label} in 3D`, className: "studio", allow: "fullscreen" });
  figure.prepend(frame);
  figure.classList.add("in3d");
  b.setAttribute("aria-expanded", "true");
  shown = { figure, frame, timer: window.setTimeout(() => closeView("The 3D view did not start."), 45_000) };
});
addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.source !== "snark-studio" || event.source !== shown?.frame.contentWindow) return;
  if (event.data.type === "ready") clearTimeout(shown!.timer);
  else closeView("3D could not be shown in this browser.");
});
