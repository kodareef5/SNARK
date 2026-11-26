// The dock's glass: a wheel's dial at the screen's edge, a tile, and a hairline. The dial and tile are the field parts
// (field-icons.ts FIELD_PARTS); a build without them draws hairlines alone.
import { K_PANEL, type UiFrame, type UiNode } from "./nodes.ts";
import { S_ICE, S_LABEL } from "./style.ts";

/** A part's rim is this share of its picture (tools/ui/field-art.ts), the rest its glow. */
const PART_BODY = 0.8;

/** Half a dial at `edge`, its rim `radius` from `cy`, the half toward the field, `reveal` of it out from the edge. */
export function rim(f: UiFrame, key: number, left: boolean, edge: number, cy: number, radius: number, alpha: number, reveal = 1): void {
  const side = (radius * 2) / PART_BODY, wide = (side / 2) * reveal;
  const n = f.picture(key, left ? edge : edge - wide, cy - side / 2, wide, side, S_LABEL, "ui:part-dial");
  if (!n) return;
  const cell = n.sw, shown = (cell / 2) * reveal;
  n.sx += left ? cell / 2 : cell / 2 - shown;
  n.sw = shown;
  n.alpha = alpha;
}

/** A glass tile whose rim is the box `x`, `y`, `w`, `h`, at rest or lit. Null where the build has no parts. */
export function tile(f: UiFrame, key: number, x: number, y: number, w: number, h: number, lit: boolean): UiNode | null {
  const gw = w / PART_BODY, gh = h / PART_BODY;
  return f.picture(key, x - (gw - w) / 2, y - (gh - h) / 2, gw, gh, S_LABEL, lit ? "ui:part-tile-lit" : "ui:part-tile");
}

export function line(f: UiFrame, key: number, x: number, y: number, w: number, h: number, tint: number, alpha: number): void {
  const n = f.add(key, K_PANEL, x, y, w, h, S_ICE);
  n.tint = tint; n.alpha = alpha;
}

/** A command's glyph (field-icons.ts "ui:glyph-") centred on button `b`, drawn as `key`; the button keeps `text` where there is none. */
export function glyph(f: UiFrame, key: number, b: UiNode, name: string, text: string, share = 0.62): void {
  const size = Math.min(b.w, b.h) * share;
  const n = f.picture(key, b.x + (b.w - size) / 2, b.y + (b.h - size) / 2, size, size, S_LABEL, "ui:glyph-" + name);
  if (n) { n.alpha = b.alpha; b.text = ""; } else b.text = text;
}
