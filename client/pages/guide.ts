// The guide's pages read whole without this. It plays a sound from the game's sound files, moves and layers a map,
// copies a console line, and searches.

import { findRows, mapTransform, type SearchRow } from "../core/pages/filter.ts";

const all = <T extends Element>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

// A sound's takes are fetched by range from the game's file and decoded as the game decodes them, once.
let audio: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
const decoded = new Map<string, Promise<AudioBuffer[]>>();

async function takes(row: HTMLElement): Promise<AudioBuffer[]> {
  const { file, at, rate } = row.dataset;
  const sizes = row.dataset.takes!.split(" ").map((t) => t.split(":").map(Number) as [number, number]);
  const bytes = sizes.reduce((n, t) => n + t[1], 0);
  const answer = await fetch(file!, { headers: { range: `bytes=${at}-${Number(at) + bytes - 1}` } });
  if (answer.status !== 206) throw new Error(`the server sent ${answer.status} for a range of ${file}`);
  const { decodeTakes } = await import("../../shared/pack/sound.ts");
  const samples = decodeTakes(new Uint8Array(await answer.arrayBuffer()), sizes.map(([samples, bytes]) => ({ samples, bytes })));
  if (!samples) throw new Error(`${file} at ${at} does not decode`);
  return samples.map((s) => {
    const b = new AudioBuffer({ length: s.length, numberOfChannels: 1, sampleRate: Number(rate) });
    b.copyToChannel(s, 0);
    return b;
  });
}

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-k]");
  const row = button?.closest<HTMLElement>("[data-takes]");
  if (button && row) {
    audio ??= new AudioContext();
    void audio.resume();
    const key = `${row.dataset.file}@${row.dataset.at}`;
    if (!decoded.has(key)) decoded.set(key, takes(row));
    decoded.get(key)!.then(
      (list) => {
        playing?.stop();
        playing = new AudioBufferSourceNode(audio!, { buffer: list[Number(button.dataset.k)]! });
        playing.connect(audio!.destination);
        playing.start();
      },
      () => {
        decoded.delete(key);
        button.classList.add("failed");
      },
    );
  }
  const copy = (event.target as Element).closest<HTMLButtonElement>("[data-copy]");
  if (copy) {
    const text = document.getElementById(copy.dataset.copy!)?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => (copy.textContent = "Copied"), () => (copy.textContent = "Select it to copy"));
  }
});
document.addEventListener("play", (event) => {
  for (const a of all<HTMLAudioElement>("audio")) if (a !== event.target) a.pause();
  playing?.stop();
}, true);

// The search page asks for the index once, as the first letter is typed or a query arrives in its address.
for (const list of all<HTMLOListElement>("[data-search]")) {
  const input = document.querySelector<HTMLInputElement>("main .find input")!;
  let rows: Promise<SearchRow[]> | null = null;
  const show = async (): Promise<void> => {
    rows ??= fetch(list.dataset.search!).then((r) => r.json() as Promise<SearchRow[]>);
    const found = findRows(await rows, input.value, 60);
    list.replaceChildren(...found.map(([label, path, group, picture]) => {
      const li = document.createElement("li");
      const a = li.appendChild(document.createElement("a"));
      a.href = path;
      if (picture) Object.assign(a.appendChild(document.createElement("img")), { src: picture, alt: "", loading: "lazy", width: 48, height: 36 });
      a.append(label);
      li.appendChild(document.createElement("small")).textContent = group;
      return li;
    }));
    if (input.value && found.length === 0) list.textContent = "Nothing in the guide is called that.";
  };
  input.value = new URLSearchParams(location.search).get("q") ?? "";
  input.addEventListener("input", () => void show());
  if (input.value) void show();
}

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
    if ((e.target as Element).closest("button")) return;
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
