// Boxes of the interface: whether two meet, what a node covers, and where a glass of nine slices stands.

import { K_IMAGE, type UiFrame, type UiNode } from "../../client/core/ui/nodes.ts";
import { BODY } from "../../client/core/ui/touch-art.ts";

export interface Box { x: number; y: number; w: number; h: number }
export const meets = (a: Box, b: Box): boolean => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

/** What a node covers: a touch-sheet picture only its body, inside the clear margin its glow is drawn in. */
export function covered(n: UiNode): Box {
  if (n.kind !== K_IMAGE || n.key < 3300000) return n;
  return { x: n.x + (n.w * (1 - BODY)) / 2, y: n.y + (n.h * (1 - BODY)) / 2, w: n.w * BODY, h: n.h * BODY };
}

/** The box of the glass whose nine slices start at `key`'s, or null where it is not drawn. */
export function glassBox(f: UiFrame, key: number): Box | null {
  let box: Box | null = null;
  for (const n of f.nodes.slice(0, f.count)) {
    if (n.key < 2000000 + key * 16 || n.key >= 2000000 + key * 16 + 9) continue;
    if (!box) box = { x: n.x, y: n.y, w: n.w, h: n.h };
    else { const r = Math.max(box.x + box.w, n.x + n.w), b = Math.max(box.y + box.h, n.y + n.h); box.x = Math.min(box.x, n.x); box.y = Math.min(box.y, n.y); box.w = r - box.x; box.h = b - box.y; }
  }
  return box;
}
