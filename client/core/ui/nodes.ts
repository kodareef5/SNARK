// The interface as data.
//
// A screen is a flat list of nodes, each with an explicit rectangle on a
// virtual canvas 720 units high (its width follows the window's aspect). All
// layout is decided here, in code that runs in Bun, so it can be tested without
// a browser. The shell's binder (client/shell/ui.ts) only positions one element
// per node and forwards events; `bun run snap` draws the same list onto a PNG.
//
// Nodes are identified by a number that stays the same from frame to frame.

import { STYLES, LINE_HEIGHT, CHAR_ADVANCE } from "./style.ts";

/** A filled rectangle. */
export const K_PANEL = 0;
/** One line of text. */
export const K_TEXT = 1;
/** A track filled from the left to `value` (0 to 1). */
export const K_BAR = 2;
/** A picture from the frame's image table, stretched to the rectangle. */
export const K_IMAGE = 3;
/** A text field the viewer types into. `text` is its content, owned by core. */
export const K_INPUT = 4;
/** A panel with a centred label that can be pressed. */
export const K_BUTTON = 5;

export const CANVAS_HEIGHT = 720;
/** Narrowest canvas laid out: a phone held upright. */
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
  /** Receives pointer events. */
  interactive: boolean;
  /** Should hold the keyboard focus, for K_INPUT. */
  focus: boolean;
  /** A fill colour of the node's own, 0xRRGGBB, instead of its style's; -1 for none. */
  tint: number;
  /** How solid the whole node is, 0 to 1: for things that fade. */
  alpha: number;
}

export interface UiImage {
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8ClampedArray;
  /** Changes when `data` does. */
  version: number;
}

export class UiFrame {
  width = 1280;
  readonly height = CANVAS_HEIGHT;
  count = 0;
  readonly nodes: UiNode[] = [];
  readonly images: (UiImage | null)[] = [null];

  /** Start a frame for a window of the given aspect (width over height). */
  begin(aspect: number): void {
    const a = aspect < MIN_ASPECT ? MIN_ASPECT : aspect > MAX_ASPECT ? MAX_ASPECT : aspect;
    this.width = Math.round(CANVAS_HEIGHT * a);
    this.count = 0;
  }

  add(key: number, kind: number, x: number, y: number, w: number, h: number, style: number): UiNode {
    let n = this.nodes[this.count];
    if (!n) {
      n = { key: 0, kind: 0, x: 0, y: 0, w: 0, h: 0, style: 0, text: "", value: 0, image: 0, interactive: false, focus: false, tint: -1, alpha: 1 };
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
    n.interactive = false;
    n.focus = false;
    n.tint = -1;
    n.alpha = 1;
    return n;
  }

  /** A line of text in a box `w` wide; the height comes from the style's font. */
  text(key: number, x: number, y: number, w: number, style: number, text: string): UiNode {
    const n = this.add(key, K_TEXT, x, y, w, lineHeight(style), style);
    n.text = text;
    return n;
  }

  find(key: number): UiNode | null {
    for (let i = 0; i < this.count; i++) if (this.nodes[i]!.key === key) return this.nodes[i]!;
    return null;
  }
}

export function lineHeight(style: number): number {
  return Math.ceil(STYLES[style]!.font * LINE_HEIGHT);
}

/** Width of `text` in a style. The interface uses one monospace face, so this is exact enough to lay out by. */
export function textWidth(text: string, style: number): number {
  return text.length * STYLES[style]!.font * CHAR_ADVANCE;
}

/** Characters that fit in `width`. */
export function columns(width: number, style: number): number {
  return Math.max(1, Math.floor(width / (STYLES[style]!.font * CHAR_ADVANCE)));
}

/** Break `text` into rows of at most `cols` characters, at spaces where it can. */
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
