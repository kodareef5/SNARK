// What a survivor held at the playhead, summed on the page from a window's changes (the log's `changes`): what it held as
// the window began, with every change up to the moment added. And how an item is written for an admin to read.

import type { LogChange, LogChanges, LogHeld } from "../../../shared/survivor-log.ts";
import { QUALITY_NAMES } from "../../../shared/sim/items.ts";
import { idWords } from "./format.ts";

const keyOf = (h: LogHeld): string => `${h.item}\t${h.quality}\t${h.blueprint ? 1 : 0}`;

/** In the log's order: by item, then quality, a blueprint after the item itself. */
const order = (a: LogHeld, b: LogHeld): number => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.quality - b.quality || Number(a.blueprint) - Number(b.blueprint));

/**
 * What was held at `t`: the window's `before` with each change at or before `t` added. A moment before the window is its
 * start, and one after its end its last change.
 */
export function heldAt(ch: LogChanges, t: number): LogHeld[] {
  const held = new Map<string, LogHeld>(ch.before.map((h) => [keyOf(h), { ...h }]));
  for (const e of ch.entries) {
    if (e.wall > t) break;
    for (const g of e.gained) {
      const k = keyOf(g);
      const h = held.get(k);
      if (h) h.count += g.count;
      else held.set(k, { ...g });
    }
    for (const l of e.lost) {
      const h = held.get(keyOf(l));
      if (h) h.count -= l.count;
    }
  }
  return [...held.values()].filter((h) => h.count > 0).sort(order);
}

/** The index of the change nearest `t`, -1 for none. */
export function nearestChange(entries: readonly LogChange[], t: number): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) if (best < 0 || Math.abs(entries[i]!.wall - t) < Math.abs(entries[best]!.wall - t)) best = i;
  return best;
}

/** An item as the game writes it: its quality's word but the plainest, its name, and blueprint if it is one. */
export function itemName(h: { item: string; quality: number; blueprint: boolean }, labels: Readonly<Record<string, string>>): string {
  const name = labels[h.item] ?? idWords(h.item);
  return `${h.quality > 0 ? `${QUALITY_NAMES[h.quality] ?? `quality ${h.quality}`} ` : ""}${name}${h.blueprint ? " blueprint" : ""}`;
}

/** A count and an item: "8 stone", "journeyman spear" for one. */
export function heldText(h: LogHeld, labels: Readonly<Record<string, string>>): string {
  return h.count === 1 ? itemName(h, labels) : `${h.count.toLocaleString("en")} ${itemName(h, labels)}`;
}

/** A change as one line: what came, then what went. */
export function changeText(c: { gained: readonly LogHeld[]; lost: readonly LogHeld[] }, labels: Readonly<Record<string, string>>): string {
  return [...c.gained.map((h) => `+${heldText(h, labels)}`), ...c.lost.map((h) => `−${heldText(h, labels)}`)].join(", ");
}
