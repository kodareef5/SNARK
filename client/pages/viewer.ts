// Activated only by View model. All media stays on the static host and the viewer owns its resource lifetime.
import { parsePack } from "../../shared/pack/pack.ts";
import type { Clip } from "../../shared/anim/clip.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { modelDocument, type ModelClip } from "../../shared/pages/model.ts";
import { ModelPose } from "../core/pages/model.ts";
import { ModelGl } from "./model-gl.ts";

let active: (() => void) | null = null;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
async function bytes(url: string, most: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > most) throw new Error("The model file could not be loaded");
  if (!response.body) throw new Error("The model file was empty");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > most) { await reader.cancel(); throw new Error("The model file exceeds its declared size"); }
    chunks.push(value);
  }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data;
}
/** Mount a model and its controls; callers dispose when replacing the host or closing its panel. */
export async function mountViewer(host: HTMLElement, url: string): Promise<() => void> {
  active?.();
  const abort = new AbortController(), signal = abort.signal;
  let renderer: ModelGl | null = null, raf = 0, disposed = false, clipAbort: AbortController | null = null;
  const wrapper = element("div", "model-viewer"), status = element("p", "model-status", "Loading model…");
  status.setAttribute("role", "status"); wrapper.append(status); host.replaceChildren(wrapper);
  let observer: IntersectionObserver | null = null, resize: ResizeObserver | null = null;
  const dispose = () => {
    if (disposed) return;
    disposed = true; abort.abort(); clipAbort?.abort(); cancelAnimationFrame(raf); observer?.disconnect(); resize?.disconnect(); renderer?.dispose();
    if (active === dispose) active = null;
  };
  active = dispose;
  try {
    if (!url.startsWith("/media/models/") || url.includes("..")) throw new Error("Invalid model address");
    const doc = modelDocument(JSON.parse(new TextDecoder().decode(await bytes(url, 160000, signal))));
    const pack = parsePack(await bytes(doc.pack, doc.packBytes, signal));
    if (pack.header.meshes.length > 16 || pack.header.rigs.length > 1) throw new Error("Unsupported model package");
    if (pack.header.meshes.reduce((sum, m) => sum + m.lods[0]!.vertexCount, 0) > 100000 || pack.header.meshes.reduce((sum, m) => sum + m.lods[0]!.indexCount, 0) > 300000) throw new Error("Model geometry exceeds preview memory budget");
    const pose = new ModelPose(pack);
    const canvas = element("canvas", "model-canvas"); canvas.tabIndex = 0; canvas.setAttribute("aria-label", `${doc.label} 3D model. Arrow keys rotate, plus and minus zoom, R resets.`);
    canvas.style.width = "100%"; canvas.style.height = "400px"; canvas.style.display = "block"; canvas.style.touchAction = "none";
    wrapper.prepend(canvas); renderer = new ModelGl(canvas, pack, doc);
    const controls = element("div", "model-toolbar"), animation = element("div", "model-animation");
    let yaw = 0.61, pitch = 0.20, zoom = 1.06, current: Clip | null = null, currentMeta: ModelClip | null = null, frame = 0, playing = false, visible = true, last = 0, bounds = doc.bounds;
    const play = element("button", "model-button", "Play"), select = element("select", "model-select"), range = element("input", "model-timeline"), speed = element("select", "model-speed"), time = element("output", "model-time", "0:00");
    select.setAttribute("aria-label", "Animation"); speed.setAttribute("aria-label", "Playback speed"); range.setAttribute("aria-label", "Animation position");
    range.type = "range"; range.min = "0"; range.max = "1"; range.step = "0.01"; range.value = "0";
    const loop = element("input"); loop.type = "checkbox"; loop.setAttribute("aria-label", "Loop animation");
    const loopLabel = element("label", "model-loop", "Loop "); loopLabel.prepend(loop);
    const none = element("option", "", "Rest pose"); none.value = ""; select.append(none);
    for (const c of doc.clips) { const option = element("option", "", c.label); option.value = c.id; select.append(option); }
    for (const n of [0.25, 0.5, 1, 1.5, 2]) { const option = element("option", "", `${n}×`); option.value = String(n); option.selected = n === 1; speed.append(option); }
    const timestamp = () => { time.value = `${(frame / TICK_RATE).toFixed(2)} / ${(currentMeta?.seconds ?? 0).toFixed(2)} s`; range.value = String(frame); play.textContent = playing ? "Pause" : "Play"; };
    const draw = () => { if (!disposed) { pose.sample(current, frame); renderer!.draw(pose, bounds, yaw, pitch, zoom); timestamp(); } };
    const tick = (now: number) => {
      raf = 0; if (disposed || document.hidden || !visible || !playing || !current) return;
      frame += Math.min(0.1, last ? (now - last) / 1000 : 0) * TICK_RATE * Number(speed.value); last = now;
      if (frame >= current.frames - 1) { if (loop.checked && current.frames > 1) frame %= current.frames; else { frame = current.frames - 1; playing = false; } }
      draw(); if (playing) raf = requestAnimationFrame(tick);
    };
    const schedule = () => { if (!raf && playing && visible && !document.hidden && !disposed) { last = 0; raf = requestAnimationFrame(tick); } };
    const button = (text: string, act: () => void, parent: HTMLElement = controls, label = text) => { const b = element("button", "model-button", text); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.addEventListener("click", act, { signal }); parent.append(b); return b; };
    const reset = () => { yaw = 0.61; pitch = 0.20; zoom = 1.06; draw(); };
    button("Reset", reset); button("Front", () => { yaw = 0; pitch = 0.12; draw(); }); button("Side", () => { yaw = Math.PI / 2; pitch = 0.12; draw(); }); button("Back", () => { yaw = Math.PI; pitch = 0.12; draw(); });
    button("−", () => { zoom = Math.min(3, zoom * 1.15); draw(); }).setAttribute("aria-label", "Zoom out"); button("+", () => { zoom = Math.max(0.45, zoom / 1.15); draw(); }).setAttribute("aria-label", "Zoom in");
    animation.append(select, play, range, time, speed, loopLabel); wrapper.append(controls); if (doc.clips.length) wrapper.append(animation);
    const cache = new Map<string, Clip>(); let choosing = 0;
    const choose = async (id: string, start: boolean) => {
      const request = ++choosing; clipAbort?.abort(); clipAbort = new AbortController();
      playing = false; cancelAnimationFrame(raf); raf = 0;
      const meta = doc.clips.find((c) => c.id === id);
      if (!meta) { current = null; currentMeta = null; select.value = ""; frame = 0; bounds = doc.bounds; status.textContent = "Rest pose · drag to rotate"; draw(); return; }
      status.textContent = `Loading ${meta.label}…`; select.value = meta.id;
      try {
        let c = cache.get(meta.id);
        if (!c) {
          const clipPack = parsePack(await bytes(meta.url, meta.bytes, clipAbort.signal));
          c = clipPack.clips.clips.find((c) => c.id === meta.id);
          if (!c || c.frames !== meta.frames || c.bones !== pose.rig?.bones) throw new Error("This animation does not match the model");
          if (cache.size >= 4) cache.delete(cache.keys().next().value!); cache.set(meta.id, c);
        }
        if (disposed || request !== choosing) return;
        current = c; currentMeta = meta; frame = 0; bounds = meta.bounds; range.max = String(Math.max(1, c.frames - 1)); loop.checked = c.loop; playing = start && c.frames > 1;
        status.textContent = `${meta.label} · ${meta.frames} frames · drag to rotate`; draw(); schedule();
      } catch (error) { if (request === choosing && !disposed && !(error instanceof DOMException && error.name === "AbortError")) { status.textContent = "Animation could not load. Choose it again to retry."; playing = false; draw(); } }
    };
    select.addEventListener("change", () => void choose(select.value, true), { signal });
    const adjacent = (step: number) => { const index = doc.clips.findIndex((c) => c.id === select.value); const next = index < 0 ? (step > 0 ? 0 : doc.clips.length - 1) : (index + step + doc.clips.length) % doc.clips.length; const c = doc.clips[next]; if (c) void choose(c.id, true); };
    if (doc.clips.length) {
      const previous = button("‹", () => adjacent(-1), animation, "Previous animation"), next = button("›", () => adjacent(1), animation, "Next animation");
      animation.prepend(previous); select.after(next);
      button("−1f", () => { playing = false; frame = Math.max(0, frame - 1); draw(); }, animation, "Previous animation frame");
      button("+1f", () => { playing = false; frame = Math.min(current ? current.frames - 1 : 0, frame + 1); draw(); }, animation, "Next animation frame");
    }
    play.addEventListener("click", () => { if (!current) return; if (!playing && frame >= current.frames - 1) frame = 0; playing = !playing; if (playing) schedule(); else { cancelAnimationFrame(raf); raf = 0; } draw(); }, { signal });
    range.addEventListener("input", () => { playing = false; cancelAnimationFrame(raf); raf = 0; frame = Math.min(current ? current.frames - 1 : 0, Number(range.value)); draw(); }, { signal });
    host.addEventListener("guide:clip", (event) => { const id = (event as CustomEvent<{ id?: unknown }>).detail?.id; if (typeof id === "string") void choose(id, true); }, { signal });
    host.addEventListener("guide:pause", () => { playing = false; cancelAnimationFrame(raf); raf = 0; draw(); }, { signal });
    const pointers = new Map<number, { x: number; y: number }>();
    canvas.addEventListener("pointerdown", (e) => { canvas.focus({ preventScroll: true }); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); }, { signal });
    canvas.addEventListener("pointermove", (e) => {
      const before = pointers.get(e.pointerId); if (!before) return;
      if (pointers.size === 2) { const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1]; const old = Math.hypot(before.x - other.x, before.y - other.y), next = Math.hypot(e.clientX - other.x, e.clientY - other.y); if (next > 5) zoom = Math.max(0.45, Math.min(3, zoom * old / next)); }
      else { yaw -= (e.clientX - before.x) * 0.008; pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - before.y) * 0.006)); }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); draw();
    }, { signal });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, (e) => pointers.delete((e as PointerEvent).pointerId), { signal });
    canvas.addEventListener("wheel", (e) => { if (document.activeElement !== canvas) return; e.preventDefault(); zoom = Math.max(0.45, Math.min(3, zoom * Math.exp(e.deltaY * 0.001))); draw(); }, { signal, passive: false });
    canvas.addEventListener("keydown", (e) => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "r", "R"].includes(e.key)) return; e.preventDefault(); if (e.key === "ArrowLeft") yaw += 0.1; if (e.key === "ArrowRight") yaw -= 0.1; if (e.key === "ArrowUp") pitch = Math.min(1.3, pitch + 0.1); if (e.key === "ArrowDown") pitch = Math.max(-1.3, pitch - 0.1); if (e.key === "+" || e.key === "=") zoom = Math.max(0.45, zoom / 1.15); if (e.key === "-") zoom = Math.min(3, zoom * 1.15); if (e.key.toLowerCase() === "r") reset(); draw(); }, { signal });
    document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); raf = 0; if (!document.hidden) { draw(); schedule(); } }, { signal });
    observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (!visible) { cancelAnimationFrame(raf); raf = 0; } else { draw(); schedule(); } }); observer.observe(canvas);
    resize = new ResizeObserver(draw); resize.observe(canvas);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); dispose(); status.textContent = "3D context was lost. Close and reopen the model to retry; the images remain available."; }, { signal });
    draw();
    for (const texture of doc.textures) {
      const data = await bytes(texture.url, texture.bytes, signal);
      const bitmap = await createImageBitmap(new Blob([data]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      if (bitmap.width !== texture.width || bitmap.height !== texture.height) { bitmap.close(); throw new Error("Model texture dimensions do not match its manifest"); }
      renderer.texture(texture.slot, bitmap); draw();
    }
    status.textContent = "Drag to rotate · focus the model to zoom with the wheel";
    const idle = doc.clips.find((c) => c.id.endsWith("/idle")) ?? doc.clips[0];
    if (idle) await choose(idle.id, false);
    return dispose;
  } catch (error) {
    dispose(); status.classList.add("model-error"); status.textContent = error instanceof Error ? error.message : "Model could not load. The image gallery remains available.";
    throw error;
  }
}
