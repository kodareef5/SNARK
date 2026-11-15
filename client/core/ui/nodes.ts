// A screen is a flat list of nodes, each with an explicit rectangle on a virtual canvas 720 units high. All layout is decided
// in core, so it can be tested in Bun without a browser. A node's key stays the same from frame to frame.

import { STYLES, LINE_HEIGHT, CHAR_ADVANCE } from "./style.ts";

/** A filled rectangle. */
export const K_PANEL = 0;
/** One line of text. */
export const K_TEXT = 1;
/** A track filled from the left to `value` (0 to 1). */
export const K_BAR = 2;
/** A picture from the frame's image table, stretched to the rectangle: the whole of it, or the part `sx` to `sh` say. */
export const K_IMAGE = 3;
/** A text field the viewer types into. `text` is its content, owned by core. */
export const K_INPUT = 4;
/** A panel with a centred label that can be pressed. */
export const K_BUTTON = 5;

export const CANVAS_HEIGHT = 720;
/** The narrowest canvas laid out is a phone held upright. */
export const MIN_ASPECT = 9 / 16;
export const MAX_ASPECT = 32 / 9;

export interface UiNode {
  key: number;
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into STYLES. */
  style: number;
  text: string;
  value: number;
  /** Index into the frame's image table, for K_IMAGE. */
  image: number;
  /** For K_IMAGE, the part of the image shown, in its pixels: left, top, width, height. A width of 0 shows all of it. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  interactive: boolean;
  /** Should hold the keyboard focus, for K_INPUT. */
  focus: boolean;
  /** A fill colour that replaces the style's, 0xRRGGBB. -1 for none. */
  tint: number;
  /** Opacity of the whole node, 0 to 1. */
  alpha: number;
}

export interface UiImage {
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8ClampedArray;
  /** Changes when `data` does. */
  version: number;
  /**
   * A file the page fetches the picture from, for an image too large to hand over by its pixels: a sheet of inventory
   * pictures. `data` may then be empty, and is the same picture where a tool fills it.
   */
  url?: string;
}

/** Where a screen finds the picture of a definition (client/core/assets/icons.ts). */
export interface UiIcons {
  /** Points a K_IMAGE node at the picture of the definition `owner`, and is true; false where it has none. */
  place(n: UiNode, owner: string): boolean;
}

export class UiFrame {
  width = 1280;
  readonly height = CANVAS_HEIGHT;
  count = 0;
  readonly nodes: UiNode[] = [];
  readonly images: (UiImage | null)[] = [null];
  /** The inventory pictures, or null where there are none: then every item shows its swatch. */
  icons: UiIcons | null = null;

  /** `aspect` is width over height. */
  begin(aspect: number): void {
    const a = aspect < MIN_ASPECT ? MIN_ASPECT : aspect > MAX_ASPECT ? MAX_ASPECT : aspect;
    this.width = Math.round(CANVAS_HEIGHT * a);
    this.count = 0;
  }

  add(key: number, kind: number, x: number, y: number, w: number, h: number, style: number): UiNode {
    let n = this.nodes[this.count];
    if (!n) {
      n = { key: 0, kind: 0, x: 0, y: 0, w: 0, h: 0, style: 0, text: "", value: 0, image: 0, sx: 0, sy: 0, sw: 0, sh: 0, interactive: false, focus: false, tint: -1, alpha: 1 };
      this.nodes.push(n);
    }
    this.count++;
    n.key = key;
    n.kind = kind;
    n.x = x;
    n.y = y;
    n.w = w;
    n.h = h;
    n.style = style;
    n.text = "";
    n.value = 0;
    n.image = 0;
    n.sx = n.sy = n.sw = n.sh = 0;
    n.interactive = false;
    n.focus = false;
    n.tint = -1;
    n.alpha = 1;
    return n;
  }

  /** The height comes from the style's font. */
  text(key: number, x: number, y: number, w: number, style: number, text: string): UiNode {
    const n = this.add(key, K_TEXT, x, y, w, lineHeight(style), style);
    n.text = text;
    return n;
  }

  /**
   * The picture of the definition `owner` as a K_IMAGE node, where there is one. Null where there is not, and nothing is
   * added: the caller draws what stands in.
   */
  picture(key: number, x: number, y: number, w: number, h: number, style: number, owner: string): UiNode | null {
    if (!this.icons) return null;
    const n = this.add(key, K_IMAGE, x, y, w, h, style);
    if (this.icons.place(n, owner)) return n;
    this.count--;
    return null;
  }

  find(key: number): UiNode | null {
    for (let i = 0; i < this.count; i++) if (this.nodes[i]!.key === key) return this.nodes[i]!;
    return null;
  }
}

export function lineHeight(style: number): number {
  return Math.ceil(STYLES[style]!.font * LINE_HEIGHT);
}

/** The interface uses one monospace face, so this is exact enough to lay out by. */
export function textWidth(text: string, style: number): number {
  return text.length * STYLES[style]!.font * CHAR_ADVANCE;
}

/** Characters that fit in `width`. */
export function columns(width: number, style: number): number {
  return Math.max(1, Math.floor(width / (STYLES[style]!.font * CHAR_ADVANCE)));
}

/** Appends rows of at most `cols` characters to `out`, breaking at spaces where it can. */
export function wrap(text: string, cols: number, out: string[]): void {
  let rest = text;
  while (rest.length > cols) {
    let cut = rest.lastIndexOf(" ", cols);
    if (cut <= 0) cut = cols;
    out.push(rest.slice(0, cut));
    rest = rest.slice(rest[cut] === " " ? cut + 1 : cut);
  }
  out.push(rest);
}
