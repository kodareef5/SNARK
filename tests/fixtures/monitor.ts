// Shared by the resource monitor's tests: a stand-in for the app, and the checks that its strip, card and panel fit
// where they stand and keep clear of what else the interface shows.

import { expect } from "bun:test";
import type { App } from "../../client/core/app.ts";
import type { FrameRing } from "../../client/core/assets/frames.ts";
import { KEY_MONITOR } from "../../client/core/ui/monitor.ts";
import { K_IMAGE, textWidth, type UiFrame, type UiNode } from "../../client/core/ui/nodes.ts";
import { BODY } from "../../client/core/ui/touch-art.ts";

/** A stand-in for the app: what the monitor reads of it. */
export function fakeApp(ring: FrameRing | null = null): App {
  return { scene: null, frames: ring, sounds: null, nowMs: 0, session: { world: null } } as unknown as App;
}

/** The monitor's own nodes: its keys, its glass's, and its buttons' hairlines. */
export const ofMonitor = (k: number): boolean => (k >= KEY_MONITOR && k < KEY_MONITOR + 1000) || (k >= 2000000 + KEY_MONITOR * 16 && k < 2000000 + (KEY_MONITOR + 1000) * 16) || (k >= 90000 + KEY_MONITOR && k < 90000 + KEY_MONITOR + 1000);

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

/**
 * The monitor's glass `key` is inside the screen's edges, its words fit, its own nodes stand inside it, and nothing
 * else the interface shows is under it but the zones a finger plays in (and what `also` lets be).
 */
export function fitsClear(f: UiFrame, key: number, where: string, also: (n: UiNode) => boolean = () => false): Box {
  const box = glassBox(f, key);
  expect(box, `${where}: glass ${key}`).not.toBeNull();
  const b = box!;
  expect(b.x >= f.left - 0.01 && b.y >= f.top - 0.01 && b.x + b.w <= f.width - f.right + 0.01 && b.y + b.h <= f.height - f.bottom + 0.01, `${where}: ${key} at ${b.x},${b.y} ${b.w}x${b.h}`).toBe(true);
  for (const n of f.nodes.slice(0, f.count)) {
    if (ofMonitor(n.key)) {
      if (n.text) expect(textWidth(n.text, n.style), `${where}: "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
      continue;
    }
    // The zones a finger plays in lie under the whole HUD.
    if (n.key === 5600 || n.key === 5601 || also(n)) continue;
    expect(meets(covered(n), b), `${where}: ${n.key} "${n.text || n.label}" at ${n.x},${n.y} ${n.w}x${n.h} under ${key}`).toBe(false);
  }
  return b;
}

/** Every node with a key from `from` to `to` (and the glass of those keys) stands inside the box: nothing of a panel spills past its glass. */
export function within(f: UiFrame, box: Box, from: number, to: number, where: string): void {
  for (const n of f.nodes.slice(0, f.count)) {
    const own = (n.key >= from && n.key < to) || (n.key >= 2000000 + from * 16 && n.key < 2000000 + to * 16) || (n.key >= 90000 + from && n.key < 90000 + to);
    if (own) expect(n.x >= box.x - 0.01 && n.y >= box.y - 0.01 && n.x + n.w <= box.x + box.w + 0.01 && n.y + n.h <= box.y + box.h + 0.01, `${where}: ${n.key} "${n.text || n.label}" at ${n.x},${n.y} ${n.w}x${n.h} past its glass`).toBe(true);
  }
}

/** The strip's glass is the monitor's first. */
export const stripFits = (f: UiFrame, where: string): Box => fitsClear(f, KEY_MONITOR, where);
