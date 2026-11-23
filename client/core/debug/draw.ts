// What the debug bar builds its interface with. The bar lays its nodes out a few times a second, or when something is
// pressed, into a record; every frame between, it plays the record into the interface's frame. Keys are handed out in
// order from KEY_DEBUG, and a pressed key finds its action and argument in two tables.

import { K_BUTTON, K_IMAGE, K_PANEL, K_TEXT, fitText, lineHeight, textWidth, type UiFrame } from "../ui/nodes.ts";
import { D_DIM, D_HEAD, D_NUM } from "./styles.ts";

/** The debug bar's keys, clear of every other screen's. */
export const KEY_DEBUG = 600000;
/** Nodes in a record at most. */
const MOST = 3000;

interface Rec {
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: number;
  text: string;
  label: string;
  tint: number;
  alpha: number;
  image: number;
  interactive: boolean;
}

export class Draw {
  private readonly recs: Rec[] = [];
  private n = 0;
  /** What pressing each node does, and with what, by its place in the record. */
  readonly act = new Int32Array(MOST);
  readonly arg = new Int32Array(MOST);

  /** Starts a new record. */
  begin(): void {
    this.n = 0;
  }

  get count(): number {
    return this.n;
  }

  private rec(kind: number, x: number, y: number, w: number, h: number, style: number, act: number, arg: number): Rec | null {
    if (this.n >= MOST) return null;
    let r = this.recs[this.n];
    if (!r) this.recs.push((r = { kind: 0, x: 0, y: 0, w: 0, h: 0, style: 0, text: "", label: "", tint: -1, alpha: 1, image: 0, interactive: false }));
    this.act[this.n] = act;
    this.arg[this.n] = arg;
    this.n++;
    r.kind = kind;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    r.style = style;
    r.text = r.label = "";
    r.tint = -1;
    r.alpha = 1;
    r.image = 0;
    r.interactive = act !== 0;
    return r;
  }

  /** A filled box in `style`, or in `tint` (0xRRGGBB) where one is given. Pressable where `act` is not 0. */
  box(x: number, y: number, w: number, h: number, style: number, tint = -1, alpha = 1, act = 0, arg = 0): void {
    const r = this.rec(K_PANEL, x, y, w, h, style, act, arg);
    if (!r) return;
    r.tint = tint;
    r.alpha = alpha;
  }

  /** One line of words, cut to fit `w`. Returns the line's height. */
  text(x: number, y: number, w: number, style: number, text: string, act = 0, arg = 0, label = ""): number {
    const h = lineHeight(style), r = this.rec(K_TEXT, x, y, w, h, style, act, arg);
    if (r) {
      r.text = textWidth(text, style) <= w ? text : fitText(text, w, style);
      r.label = label;
    }
    return h;
  }

  /** A section's heading. Returns the room it takes. */
  heading(x: number, y: number, w: number, text: string): number {
    return this.text(x, y, w, D_HEAD, text) + 2;
  }

  /** A label at the left of `w` and its value at the right. Returns the line's height. */
  pair(x: number, y: number, w: number, label: string, value: string, valueStyle = D_NUM): number {
    const v = Math.min(w * 0.55, textWidth(value, valueStyle) + 2);
    this.text(x, y, w - v - 6, D_DIM, label);
    return this.text(x + w - v, y, v, valueStyle, value);
  }

  /** A button with its words in the middle. */
  button(x: number, y: number, w: number, h: number, style: number, text: string, act: number, arg = 0, label = ""): void {
    const r = this.rec(K_BUTTON, x, y, w, h, style, act, arg);
    if (!r) return;
    r.text = textWidth(text, style) <= w - 6 ? text : fitText(text, w - 6, style);
    r.label = label || text;
  }

  /** A picture from the interface's image table, stretched to the box. */
  picture(x: number, y: number, w: number, h: number, image: number, act = 0, arg = 0): void {
    const r = this.rec(K_IMAGE, x, y, w, h, 0, act, arg);
    if (r) r.image = image;
  }

  /** Plays the record into the interface's frame. */
  play(f: UiFrame, base = KEY_DEBUG): void {
    for (let i = 0; i < this.n; i++) {
      const r = this.recs[i]!, n = f.add(base + i, r.kind, r.x, r.y, r.w, r.h, r.style);
      n.text = r.text;
      n.label = r.label;
      n.tint = r.tint;
      n.alpha = r.alpha;
      n.image = r.image;
      n.interactive = r.interactive;
    }
  }

  /** The action and argument of the node `key`, or null where it is not one of the record's or does nothing. */
  hit(key: number, base = KEY_DEBUG): readonly [number, number] | null {
    const i = key - base;
    return i >= 0 && i < this.n && this.act[i] !== 0 ? [this.act[i]!, this.arg[i]!] : null;
  }

  /** The box of the node `key` as last recorded, for where a press fell inside it. */
  boxOf(key: number, base = KEY_DEBUG): Rec | null {
    const i = key - base;
    return i >= 0 && i < this.n ? this.recs[i]! : null;
  }
}
