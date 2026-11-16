import { mapTransform, matchesGuideQuery, searchTerms } from "../core/pages/filter.ts";

const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];
const one = <T extends Element>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);

for (const area of all<HTMLElement>("[data-filter-area]")) {
  const query = one<HTMLInputElement>("[data-filter-query]", area)!;
  const kind = one<HTMLSelectElement>("[data-filter-kind]", area);
  const sort = one<HTMLSelectElement>("[data-filter-sort]", area);
  const changed = one<HTMLInputElement>("[data-changes-only]", area);
  const models = one<HTMLInputElement>("[data-models-only]", area);
  const list = one<HTMLElement>("[data-record-list]", area)!;
  const records = all<HTMLElement>("[data-record]", list);
  const params = new URLSearchParams(location.search);
  if (location.pathname.replace(/\/$/, "") === "/search") {
    query.value = params.get("q") ?? "";
    if (models) models.checked = params.get("media") === "models";
    const globalQuery = one<HTMLInputElement>(".global-search input");
    if (globalQuery) globalQuery.value = query.value;
  }
  const apply = (): void => {
    const terms = searchTerms(query.value);
    let visible = 0;
    for (const record of records) {
      record.hidden = !matchesGuideQuery(record.dataset.query ?? "", terms) || Boolean(kind?.value && record.dataset.kind !== kind.value) || Boolean(changed?.checked && record.dataset.changed !== "true") || Boolean(models?.checked && record.dataset.model !== "true");
      if (!record.hidden) visible++;
    }
    const ordered = [...records].sort((a, b) => (a.dataset.name ?? "").localeCompare(b.dataset.name ?? "") * (sort?.value === "reverse" ? -1 : 1));
    list.append(...ordered);
    const count = one<HTMLElement>("[data-result-count]", area);
    if (count) count.textContent = `${visible} ${visible === 1 ? "entry" : "entries"}`;
    const empty = one<HTMLElement>("[data-no-results]", area);
    if (empty) empty.hidden = visible !== 0;
  };
  area.addEventListener("input", apply);
  area.addEventListener("change", apply);
  one<HTMLButtonElement>("[data-clear-filter]", area)?.addEventListener("click", () => { query.value = ""; if (kind) kind.value = ""; if (changed) changed.checked = false; if (models) models.checked = false; apply(); query.focus(); });
  apply();
}

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input,select,textarea") || target?.isContentEditable) return;
  if (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
    event.preventDefault();
    one<HTMLInputElement>(".global-search input")?.focus();
  }
});

document.addEventListener("play", (event) => {
  if (!(event.target instanceof HTMLMediaElement)) return;
  for (const media of all<HTMLMediaElement>("audio,video")) if (media !== event.target) media.pause();
}, true);
document.addEventListener("visibilitychange", () => { if (document.hidden) for (const media of all<HTMLMediaElement>("audio,video")) media.pause(); });

for (const gallery of all<HTMLElement>(".gallery")) {
  for (const link of all<HTMLAnchorElement>("[data-gallery-image]", gallery)) link.addEventListener("click", (event) => {
    event.preventDefault();
    const image = one<HTMLImageElement>(".gallery-main", gallery)!;
    image.src = link.href;
    image.alt = link.dataset.label ?? "Model image";
    const caption = one<HTMLElement>("[data-gallery-caption]", gallery);
    if (caption) caption.textContent = image.alt;
    for (const thumb of all<HTMLElement>("[data-gallery-image]", gallery)) thumb.classList.toggle("selected", thumb === link);
  });
}

const viewers = new Map<HTMLElement, Promise<() => void>>();
async function activateModel(frame: HTMLElement): Promise<HTMLElement> {
  const host = one<HTMLElement>(".model-live", frame)!;
  const button = one<HTMLButtonElement>("[data-view-model]", frame)!;
  const feedback = one<HTMLElement>(".model-feedback", frame)!;
  let pending = viewers.get(frame);
  if (!pending) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    feedback.hidden = false;
    feedback.textContent = "Loading model…";
    host.hidden = false;
    pending = import("./viewer.ts").then(({ mountViewer }) => mountViewer(host, frame.dataset.modelUrl!));
    viewers.set(frame, pending);
  }
  try {
    await pending;
    one<HTMLElement>(".model-preview", frame)!.hidden = true;
    feedback.hidden = true;
  } catch {
    host.hidden = true;
    host.replaceChildren();
    viewers.delete(frame);
    feedback.textContent = "The model could not be loaded. Please try again.";
    throw new Error("Model preview unavailable");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
  return host;
}
for (const frame of all<HTMLElement>("[data-model-url]")) {
  one<HTMLButtonElement>("[data-view-model]", frame)!.addEventListener("click", () => { void activateModel(frame).catch(() => {}); });
}
for (const button of all<HTMLButtonElement>("[data-preview-clip]")) button.addEventListener("click", async () => {
  const frame = one<HTMLElement>("[data-model-url]");
  if (!frame) return;
  button.disabled = true;
  try {
    const host = await activateModel(frame);
    host.dispatchEvent(new CustomEvent("guide:clip", { detail: { id: button.dataset.previewClip } }));
    frame.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  } catch { /* The frame carries the retry message. */ }
  finally { button.disabled = false; }
});
window.addEventListener("pagehide", () => { for (const pending of viewers.values()) void pending.then((dispose) => dispose()).catch(() => {}); viewers.clear(); });

for (const atlas of all<HTMLElement>("[data-atlas]")) {
  const viewport = one<HTMLElement>(".map-viewport", atlas)!;
  const plane = one<HTMLElement>(".map-plane", atlas)!;
  const aside = atlas.parentElement!;
  const scale = one<HTMLOutputElement>("[data-map-scale]", atlas)!;
  let state = { zoom: 1, x: 0, y: 0 };
  let drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null;
  const draw = (): void => {
    state = mapTransform(state.zoom, state.x, state.y, viewport.clientWidth, viewport.clientHeight);
    plane.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.zoom})`;
    scale.value = `${Math.round(state.zoom * 100)}%`;
  };
  const zoom = (by: number): void => { const old = state.zoom; state.zoom = Math.max(1, Math.min(5, state.zoom * by)); state.x *= state.zoom / old; state.y *= state.zoom / old; draw(); };
  const reset = (): void => { state = { zoom: 1, x: 0, y: 0 }; draw(); };
  for (const button of all<HTMLButtonElement>("[data-map-zoom]", atlas)) button.addEventListener("click", () => zoom(button.dataset.mapZoom === "in" ? 1.35 : 1 / 1.35));
  one<HTMLButtonElement>("[data-map-reset]", atlas)!.addEventListener("click", reset);
  for (const marker of all<HTMLElement>("[data-map-marker]", atlas)) {
    marker.style.left = `${Math.max(0, Math.min(1, Number(marker.dataset.x) || 0)) * 100}%`;
    marker.style.top = `${Math.max(0, Math.min(1, Number(marker.dataset.y) || 0)) * 100}%`;
  }
  for (const toggle of all<HTMLInputElement>("[data-layer-toggle]", aside)) toggle.addEventListener("change", () => {
    const layer = all<HTMLElement>("[data-map-layer]", atlas).find((el) => el.dataset.mapLayer === toggle.dataset.layerToggle);
    if (layer) layer.hidden = !toggle.checked;
  });
  one<HTMLInputElement>("[data-places-toggle]", aside)?.addEventListener("change", (event) => { one<HTMLElement>(".map-marker-layer", atlas)!.hidden = !(event.target as HTMLInputElement).checked; });
  viewport.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("a") || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: state.x, panY: state.y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (event) => { if (drag?.id === event.pointerId) { state.x = drag.panX + event.clientX - drag.x; state.y = drag.panY + event.clientY - drag.y; draw(); } });
  const end = (): void => { drag = null; viewport.classList.remove("dragging"); };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);
  viewport.addEventListener("lostpointercapture", end);
  viewport.addEventListener("wheel", (event) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  viewport.addEventListener("keydown", (event) => {
    if (!["+", "=", "-", "0", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "+" || event.key === "=") zoom(1.35);
    else if (event.key === "-") zoom(1 / 1.35);
    else if (event.key === "0") reset();
    else { state.x += event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0; state.y += event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0; draw(); }
  });
  new ResizeObserver(draw).observe(viewport);
  draw();
}
