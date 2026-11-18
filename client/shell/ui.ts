// Draws the interface: one element per node, placed where client/core says, with no layout or state here.
// Text is always set as text, never as markup, so nothing a player types or is named can become HTML.

import { K_BAR, K_BUTTON, K_DIAL, K_IMAGE, K_INPUT, K_SECRET, K_SLIDER, type UiFrame, type UiNode } from "../core/ui/nodes.ts";
import { bindTextInput, type UiEvents } from "../core/ui/events.ts";
import { STYLES } from "../core/ui/style.ts";

interface Bound {
  el: HTMLElement;
  /** The filled part of a bar. */
  fill: HTMLElement | null;
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: number;
  text: string;
  value: number;
  version: number;
  /** For a picture in a file: the background that shows the part of it drawn. */
  src: string;
  interactive: boolean;
  tint: number;
  alpha: number;
  order: number;
  seen: number;
  label: string;
}

const rgba = (c: number): string => `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${(c & 255) / 255})`;
const rgb = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

export class UiView {
  private readonly root: HTMLElement;
  private readonly events: UiEvents;
  private readonly bound = new Map<number, Bound>();
  private scale = 0;
  private pass = 0;

  constructor(root: HTMLElement, events: UiEvents) {
    this.root = root;
    this.events = events;
    root.textContent = "";
    const forward = (kind: number) => (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
      const key = Number(el?.dataset.k ?? 0);
      // A dial keeps the pointer from its press to its release, wherever it goes, and a cancelled touch lets go of it.
      const dial = this.bound.get(key)?.kind === K_DIAL;
      if (kind === 0 && dial) el!.setPointerCapture(e.pointerId);
      if (kind === 3 && !dial) return;
      if (key !== 0 && this.scale > 0) events.pointer(kind === 3 ? 1 : kind, key, e.clientX / this.scale, e.clientY / this.scale, e.button);
    };
    root.addEventListener("pointerdown", forward(0));
    root.addEventListener("pointerup", forward(1));
    root.addEventListener("pointermove", forward(2));
    root.addEventListener("pointercancel", forward(3));
    root.addEventListener("click", (e) => {
      const key = Number((e.target as HTMLElement).dataset?.k ?? 0);
      if (e.detail === 0 && key) events.pointer(0, key, 0, 0, 0);
    });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Scales so the canvas is `heightPx` tall. Writes only what changed. */
  apply(f: UiFrame, heightPx: number): void {
    const scale = heightPx / f.height;
    const rescaled = scale !== this.scale;
    this.scale = scale;
    const pass = ++this.pass;
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      let b = this.bound.get(n.key);
      if (b && b.kind !== n.kind) {
        b.el.remove();
        b = undefined;
      }
      b ??= this.create(n);
      b.seen = pass;
      const s = b.el.style;
      if (rescaled || b.x !== n.x || b.y !== n.y || b.w !== n.w || b.h !== n.h) {
        b.x = n.x;
        b.y = n.y;
        b.w = n.w;
        b.h = n.h;
        s.transform = `translate(${n.x * scale}px,${n.y * scale}px)`;
        s.width = `${n.w * scale}px`;
        s.height = `${n.h * scale}px`;
        s.lineHeight = `${n.h * scale}px`;
      }
      if (rescaled || b.style !== n.style || b.tint !== n.tint) {
        b.style = n.style;
        b.tint = n.tint;
        b.src = "";
        const st = STYLES[n.style]!;
        s.background = n.tint >= 0 ? rgb(n.tint) : (st.fill & 255) === 0 ? "none" : rgba(st.fill);
        s.color = rgb(st.ink);
        s.fontSize = `${st.font * scale}px`;
        s.fontFamily = st.sans ? "Hud, Arial, sans-serif" : "ui-monospace, Menlo, Consolas, monospace";
        s.textAlign = st.align === 1 ? "center" : st.align === 2 ? "right" : "left";
        s.textShadow = st.shadow ? "0 1px 2px #000" : "none";
        if (b.fill) b.fill.style.background = rgb(st.ink);
      }
      if (b.alpha !== n.alpha) {
        b.alpha = n.alpha;
        s.opacity = String(n.alpha);
      }
      if (n.kind === K_INPUT || n.kind === K_SECRET || n.kind === K_SLIDER) {
        const field = b.el as HTMLInputElement;
        // Integer native steps keep both endpoints reachable, including fractions such as sensitivity's 1/28.
        const value = n.kind === K_SLIDER ? String(Math.round(n.value/n.step)) : n.text;
        if (n.kind === K_SLIDER && field.max !== String(Math.round(1/n.step))) field.max = String(Math.round(1/n.step));
        if ((n.kind !== K_SLIDER || b.value !== n.value) && field.value !== value) field.value = value;
        b.value = n.value;
        if (n.kind === K_SLIDER && b.text !== n.text) field.setAttribute("aria-valuetext", n.text);
        b.text = n.text;
      } else if (b.text !== n.text) {
        b.text = n.text;
        if (!b.fill && n.kind !== K_IMAGE) b.el.textContent = n.text;
      }
      if (b.fill && b.value !== n.value) {
        b.value = n.value;
        b.fill.style.width = `${Math.max(0, Math.min(1, n.value)) * 100}%`;
      }
      if (n.kind === K_IMAGE) {
        const image = f.images[n.image];
        // A picture in a file is the background, the part shown scaled to fill the node. The browser fetches the file once.
        const w = n.sw || image?.width || 1, h = n.sh || image?.height || 1;
        const src = image?.url ? `url("${image.url}") ${(n.sx / Math.max(1, image.width - w)) * 100}% ${(n.sy / Math.max(1, image.height - h)) * 100}% / ${(image.width / w) * 100}% ${(image.height / h) * 100}% no-repeat` : "";
        if (src !== "" && b.src !== src) {
          b.src = src;
          (b.el as HTMLCanvasElement).width = 1;
          s.background = src;
          s.imageRendering = "auto";
        }
        const crop = `${n.image}/${n.sx}/${n.sy}/${w}/${h}`;
        if (image && !image.url && (b.version !== image.version || b.src !== crop)) {
          b.version = image.version;
          b.src = crop;
          const canvas = b.el as HTMLCanvasElement;
          s.imageRendering = image.smooth ? "auto" : "pixelated";
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          // The part shown goes straight from the picture's own pixels onto the node.
          canvas.getContext("2d")!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), -n.sx, -n.sy, n.sx, n.sy, w, h);
        }
      }
      if (b.interactive !== n.interactive) {
        b.interactive = n.interactive;
        s.pointerEvents = n.interactive ? "auto" : "none";
        if (n.kind === K_BUTTON) (b.el as HTMLButtonElement).tabIndex = n.interactive ? 0 : -1;
      }
      const label = n.label || n.text;
      if (b.label !== label) { b.label = label; b.el.title = n.label; b.el.setAttribute("aria-label", label); }
      if (b.order !== i) {
        b.order = i;
        s.zIndex = String(i);
      }
      if (n.focus && document.activeElement !== b.el) b.el.focus();
    }
    for (const key of this.bound.keys()) {
      const b = this.bound.get(key)!;
      if (b.seen === pass) continue;
      b.el.remove();
      this.bound.delete(key);
    }
  }

  /** For the self-check. Counts elements that are not where core placed them, to the pixel. */
  misplaced(f: UiFrame): number {
    let bad = this.bound.size === f.count ? 0 : 1;
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      const r = this.bound.get(n.key)?.el.getBoundingClientRect();
      const s = this.scale;
      if (!r || Math.abs(r.left - n.x * s) > 1 || Math.abs(r.top - n.y * s) > 1 || Math.abs(r.width - n.w * s) > 1 || Math.abs(r.height - n.h * s) > 1) bad++;
    }
    return bad;
  }

  private create(n: UiNode): Bound {
    const typed = n.kind === K_INPUT || n.kind === K_SECRET || n.kind === K_SLIDER;
    const el = document.createElement(typed ? "input" : n.kind === K_IMAGE ? "canvas" : n.kind === K_BUTTON ? "button" : "div");
    if (n.kind === K_BUTTON) { (el as HTMLButtonElement).type = "button"; el.tabIndex = -1; }
    let fill: HTMLElement | null = null;
    if (n.kind === K_BAR) {
      fill = document.createElement("div");
      fill.style.height = "100%";
      el.append(fill);
    } else if (typed) {
      const field = el as HTMLInputElement;
      if (n.kind === K_SLIDER) { field.type = "range"; field.min = "0"; field.step = "1"; }
      if (n.kind === K_SECRET) field.type = "password";
      field.spellcheck = false;
      field.autocomplete = "off";
      field.addEventListener("input", bindTextInput(n, field, this.events));
    } else if (n.kind === K_IMAGE) el.style.imageRendering = "pixelated";
    else if (n.kind === K_DIAL) { el.style.touchAction = "none"; el.style.cursor = "grab"; }
    el.dataset.k = String(n.key);
    el.style.pointerEvents = "none";
    this.root.append(el);
    const b: Bound = { el, fill, kind: n.kind, x: NaN, y: NaN, w: NaN, h: NaN, style: -1, text: "", label: "", value: NaN, version: 0, src: "", interactive: false, tint: -2, alpha: 1, order: -1, seen: 0 };
    this.bound.set(n.key, b);
    return b;
  }
}
