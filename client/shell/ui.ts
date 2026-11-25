// Draws the interface: one element per node, placed where client/core says, with no layout or state here.
// Text is always set as text, never as markup, so nothing a player types or is named can become HTML.

import { K_BAR, K_BUTTON, K_DIAL, K_HOLD, K_IMAGE, K_INPUT, K_SECRET, K_SLIDER, type UiFrame, type UiImage, type UiNode } from "../core/ui/nodes.ts";
import { bindTextInput, type UiEvents } from "../core/ui/events.ts";
import { STYLES } from "../core/ui/style.ts";
const LENS = ["none", "radial-gradient(closest-side,#0000 99%,#000 100%)", "radial-gradient(circle closest-side at 28.4% 50%,#0000 99%,#000 100%),radial-gradient(circle closest-side at 71.6% 50%,#0000 99%,#000 100%)",
  "repeating-linear-gradient(#0000 0 2px,#000 2px 3px)", "radial-gradient(farthest-corner,#0000 45%,#000 100%)"];

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
  image?: UiImage;
  sx: number; sy: number; sw: number; sh: number;
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
  /** A finger's device: its text fields are never drawn under 16 px, below which iOS zooms the page to one in focus. */
  private readonly coarse = matchMedia("(pointer: coarse)").matches;
  /**
   * A field that takes the focus within a finger's press. A phone raises its keyboard only for a focus made inside a
   * press, and the field core asks for is not drawn until the next frame, when it takes the focus over with the keyboard up.
   */
  private readonly lure = Object.assign(document.createElement("input"), { tabIndex: -1, ariaHidden: "true" });

  constructor(root: HTMLElement, events: UiEvents) {
    this.root = root;
    this.events = events;
    root.textContent = "";
    const held = new Map<number, number>();
    const forward = (kind: number) => (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-k]");
      const owner = held.get(e.pointerId);
      const key = owner ?? Number(el?.dataset.k ?? 0);
      if (kind === 3 && owner === undefined) return;
      if (kind === 0 && el) {
        const node = this.bound.get(key)?.kind;
        if (node === K_DIAL || node === K_HOLD) {
          held.set(e.pointerId, key);
          el.setPointerCapture(e.pointerId);
        }
      }
      if (kind === 1 || kind === 3) held.delete(e.pointerId);
      if (key !== 0 && this.scale > 0) events.pointer(kind, key, e.clientX / this.scale, e.clientY / this.scale, e.button, e.pointerType === "touch" ? Math.abs(e.pointerId) + 1 : 0);
      if (e.pointerType === "touch" && kind < 2 && events.typing?.() && !(document.activeElement instanceof HTMLInputElement)) this.lure.focus();
    };
    this.lure.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none;border:0;padding:0";
    root.after(this.lure);
    root.addEventListener("pointerdown", forward(0));
    root.addEventListener("pointerup", forward(1));
    root.addEventListener("pointermove", forward(2));
    root.addEventListener("pointercancel", forward(3));
    document.addEventListener("lostpointercapture", forward(3));
    root.addEventListener("click", (e) => {
      const key = Number((e.target as HTMLElement).dataset?.k ?? 0);
      if (e.detail === 0 && key) events.pointer(0, key, 0, 0, 0, 0);
    });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Scales so the canvas is `heightPx` tall. Writes only what changed. */
  apply(f: UiFrame, heightPx: number): void {
    const scale = heightPx / f.height;
    const rescaled = scale !== this.scale;
    this.scale = scale;
    const pass = ++this.pass;
    if (document.activeElement === this.lure && !this.events.typing?.()) this.lure.blur();
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
        b.image = undefined;
        const st = STYLES[n.style]!;
        s.background = n.tint >= 0 ? rgb(n.tint) : (st.fill & 255) === 0 ? "none" : rgba(st.fill);
        // A sight's lens: the fill only outside its round hole, or its two (style.ts Style.lens).
        s.maskImage = LENS[st.lens ?? 0]!; s.maskComposite = "intersect";
        s.color = rgb(st.ink);
        s.fontSize = `${this.coarse && (n.kind === K_INPUT || n.kind === K_SECRET) ? Math.max(16, st.font * scale) : st.font * scale}px`;
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
        const w = n.sw || image?.width || 1, h = n.sh || image?.height || 1;
        if (image && (b.image !== image || b.version !== image.version || b.sx !== n.sx || b.sy !== n.sy || b.sw !== w || b.sh !== h)) {
          b.image = image; b.version = image.version;
          b.sx = n.sx; b.sy = n.sy; b.sw = w; b.sh = h;
          const canvas = b.el as HTMLCanvasElement;
          if (image.url) {
            if (canvas.width !== 1) canvas.width = 1;
            s.background = `url("${image.url}") ${n.sx / Math.max(1, image.width - w) * 100}% ${n.sy / Math.max(1, image.height - h) * 100}% / ${image.width / w * 100}% ${image.height / h * 100}% no-repeat`;
            s.imageRendering = "auto";
          } else {
            s.background = "none";
            s.imageRendering = image.smooth ? "auto" : "pixelated";
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            canvas.getContext("2d")!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), -n.sx, -n.sy, n.sx, n.sy, w, h);
          }
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
    const b: Bound = { el, fill, kind: n.kind, x: NaN, y: NaN, w: NaN, h: NaN, style: -1, text: "", label: "", value: NaN, version: 0, sx: -1, sy: -1, sw: 0, sh: 0, interactive: false, tint: -2, alpha: 1, order: -1, seen: 0 };
    this.bound.set(n.key, b);
    return b;
  }
}
