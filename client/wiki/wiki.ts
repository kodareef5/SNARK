// The wiki's pages read whole without this. It plays a sound from the game's sound files, moves and layers a map,
// copies a console line, searches, works the figures out again for the world the visitor came from, and says which maps
// the cluster behind it runs.

import { findRows, mapTransform, type SearchRow } from "../core/wiki/filter.ts";
import { wireAudio } from "./audio.ts";
import { wireModels } from "./model.ts";
import { setupTamingTools } from "./taming.ts";
import { liveMaps, worldPath, type LiveWorld, type ServerSaid } from "../core/wiki/world.ts";

const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

const sidebar = document.querySelector<HTMLDetailsElement>("[data-sidebar]");
if (sidebar) {
  const narrow = matchMedia("(max-width: 52rem)");
  const resize = (): void => { sidebar.open = !narrow.matches; };
  resize();
  narrow.addEventListener("change", resize);
}

wireAudio();
wireModels();

document.addEventListener("click", (event) => {
  const copy = (event.target as Element).closest<HTMLButtonElement>("[data-copy]");
  const code = copy?.dataset.copy && document.getElementById(copy.dataset.copy);
  if (!copy || !code) return;
  const select = (): void => {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    copy.textContent = "Selected";
  };
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(code.textContent ?? "").then(() => (copy.textContent = "Copied"), select);
  } else select();
});

for (const directory of all<HTMLElement>("[data-directory]")) {
  const tools = directory.querySelector<HTMLElement>("[data-directory-tools]")!;
  const selects = all<HTMLSelectElement>("[data-filter]", tools);
  if (!selects.length) continue;
  const rows = all<HTMLTableRowElement>("[data-directory-row]", directory).map((row) => ({
    row, fields: JSON.parse(row.dataset.directoryRow!) as Record<string, string>,
  }));
  const count = tools.querySelector<HTMLElement>("[data-directory-count]")!;
  const update = (): void => {
    let visible = 0;
    for (const { row, fields } of rows) {
      row.hidden = selects.some((item) => item.value && item.value !== fields[item.dataset.filter!]);
      if (!row.hidden) visible++;
    }
    count.textContent = visible ? `${visible} ${visible === 1 ? "entry" : "entries"}` : "No entries match these filters.";
  };
  tools.hidden = false;
  tools.addEventListener("change", update);
  update();
}

// The search page asks for the index once, as the first letter is typed or a query arrives in its address.
for (const list of all<HTMLOListElement>("[data-search]")) {
  const input = document.querySelector<HTMLInputElement>("main .find input")!;
  const note = document.querySelector<HTMLElement>("[data-search-note]")!;
  let rows: Promise<SearchRow[]> | null = null;
  let revision = 0;
  const show = async (): Promise<void> => {
    const request = ++revision;
    const query = input.value.trim();
    if (!query) {
      list.replaceChildren();
      note.textContent = "";
      return;
    }
    rows ??= fetch(list.dataset.search!).then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json() as Promise<SearchRow[]>;
    });
    try {
      const found = findRows(await rows, query);
      if (request !== revision) return;
      note.textContent = found.length ? `${found.length} ${found.length === 1 ? "result" : "results"}` : "No results. Try a name or game ID.";
      list.replaceChildren(...found.map(([label, path, group, picture]) => {
        const li = document.createElement("li");
        const a = li.appendChild(document.createElement("a"));
        a.href = path;
        if (picture) Object.assign(a.appendChild(document.createElement("img")), { src: picture, alt: "", loading: "lazy", width: 48, height: 36 });
        a.append(label);
        li.appendChild(document.createElement("small")).textContent = group;
        return li;
      }));
    } catch {
      rows = null;
      if (request !== revision) return;
      list.replaceChildren();
      note.textContent = "Search could not load. Press Search to try again.";
    }
  };
  const query = new URLSearchParams(location.search);
  input.value = query.get("q") ?? "";
  input.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim()) query.set("q", input.value.trim());
    else query.delete("q");
    history.replaceState(null, "", query.size ? `?${query}` : location.pathname);
    void show();
  });
  input.addEventListener("input", () => void show());
  if (input.value) void show();
}

// The world says what it runs beside its links.json; with no world behind the page, or one at its defaults, nothing changes.
const kept = ((): string | null => { try { return sessionStorage.getItem("world"); } catch { return null; } })();
const world = worldPath(location.search, document.referrer, location.origin, kept);
try { sessionStorage.setItem("world", world); } catch { /* Without storage each page asks by its own address. */ }
const needsSettings = !!document.querySelector("[data-taming], [data-figure], [data-setting]");
const settings = needsSettings
  ? fetch(`${world}/settings.json`, { cache: "no-cache" }).then((r) => r.ok ? r.json() as Promise<ServerSaid> : null).catch(() => null)
  : Promise.resolve(null);
setupTamingTools(settings);
void settings.then(async (said) => {
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
  const ground = plane.querySelector<HTMLImageElement>(".ground")!;
  let at = { zoom: 1, x: 0, y: 0 };
  let drag: { id: number; x: number; y: number; from: typeof at } | null = null;
  const draw = (): void => {
    at = mapTransform(at.zoom, at.x, at.y, view.clientWidth, view.clientHeight);
    plane.style.transform = `translate(${at.x}px, ${at.y}px) scale(${at.zoom})`;
    view.style.setProperty("--zoom", String(at.zoom));
    const displayed = `${Math.ceil(view.clientWidth * at.zoom)}px`;
    if (ground.sizes !== displayed) ground.sizes = displayed;
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
  const boxes = all<HTMLInputElement>("[data-show]", atlas);
  for (const box of boxes) {
    if (box.dataset.show === asked) {
      box.checked = true;
      const group = box.closest("details");
      if (group) group.open = true;
    }
    box.addEventListener("change", () => show(box));
    show(box);
  }
  const panel = atlas.querySelector<HTMLElement>(".layers")!;
  panel.querySelector<HTMLElement>(".layer-tools")!.hidden = false;
  const filter = panel.querySelector<HTMLInputElement>("[data-layer-filter]")!;
  const groups = all<HTMLDetailsElement>("details", panel);
  const options = all<HTMLElement>("[data-layer-choice]", panel);
  const note = panel.querySelector<HTMLElement>("[data-layer-note]")!;
  let openBeforeFilter: boolean[] = [];
  const filterLayers = (): void => {
    const query = filter.value.trim().toLowerCase();
    if (query && !openBeforeFilter.length) openBeforeFilter = groups.map((group) => group.open);
    for (const option of options) option.hidden = !option.dataset.layerChoice!.toLowerCase().includes(query);
    for (const [index, group] of groups.entries()) {
      group.hidden = !!query && !group.querySelector("[data-layer-choice]:not([hidden])");
      if (query) group.open = !group.hidden;
      else if (openBeforeFilter.length) group.open = openBeforeFilter[index]!;
    }
    if (!query) openBeforeFilter = [];
    note.textContent = query && options.every((option) => option.hidden) ? "No layers match." : "";
  };
  filter.addEventListener("input", filterLayers);
  panel.querySelector("[data-layer-reset]")!.addEventListener("click", () => {
    filter.value = "";
    filterLayers();
    for (const box of boxes) {
      box.checked = box.defaultChecked;
      show(box);
    }
    if (asked) {
      const url = new URL(location.href);
      url.searchParams.delete("show");
      history.replaceState(null, "", url);
    }
  });
}
