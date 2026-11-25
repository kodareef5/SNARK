// What a page holds of its map, by class, in bytes of typed arrays: a ruler for the map's memory (planning/workstreams/maps-v3.md).
// Each buffer is counted once, under the first class that reaches it, so a table one class shares with another is not
// counted twice. A class is walked a few levels deep and not into `skip`, so a registry it names is not the map's.

import type { MapLoader } from "./mapload.ts";

/** A class of the map and what it holds. */
export interface MapHeld {
  readonly name: string;
  readonly bytes: number;
}

/** What the ledger is read from: the loader and its staged map, the city made of the statics, the far shadow. */
export interface MapRoots {
  readonly loader?: MapLoader | null;
  readonly city?: unknown;
  readonly farShadow?: unknown;
  /** Objects not walked into, such as the content registry a city names. */
  readonly skip?: readonly unknown[];
}

const DEPTH = 6;

/** Bytes of the typed arrays and buffers `root` reaches within `depth` levels, each buffer once by `seen`. */
export function bytesHeld(root: unknown, seen: Set<unknown>, depth = DEPTH): number {
  if (root === null || typeof root !== "object" || seen.has(root)) return 0;
  if (ArrayBuffer.isView(root)) {
    if (seen.has(root.buffer)) return 0;
    seen.add(root.buffer);
    return root.buffer.byteLength;
  }
  if (root instanceof ArrayBuffer) {
    seen.add(root);
    return root.byteLength;
  }
  seen.add(root);
  if (depth === 0) return 0;
  let n = 0;
  if (root instanceof Map) for (const v of root.values()) n += bytesHeld(v, seen, depth - 1);
  else if (root instanceof Set) for (const v of root) n += bytesHeld(v, seen, depth - 1);
  else if (Array.isArray(root)) for (const v of root) n += bytesHeld(v, seen, depth - 1);
  else for (const v of Object.values(root)) n += bytesHeld(v, seen, depth - 1);
  return n;
}

/** The map's classes on a page and their bytes, in the order counted; a class with nothing is left out. */
export function mapLedger(roots: MapRoots): MapHeld[] {
  const seen = new Set<unknown>(roots.skip ?? []);
  const out: MapHeld[] = [];
  const add = (name: string, ...of: unknown[]): void => {
    const bytes = of.reduce<number>((n, o) => n + bytesHeld(o, seen), 0);
    if (bytes > 0) out.push({ name, bytes });
  };
  const staged = roots.loader?.staged;
  if (staged) {
    const hf = staged.hf;
    add("ground", hf.heights, hf.tint, hf.ground, hf.exact);
    add("water", hf.water);
    add("road", hf.road);
    add("streets", hf.streets);
    add("nodes", staged.nodes);
    add("tops", staged.tops);
    add("buildings", staged.buildings);
    add("head", staged.head);
    add("staged, other", staged);
  }
  add("statics", roots.loader?.statics);
  add("city", roots.city);
  add("far shadow", roots.farShadow);
  return out;
}

/** The ledger's total. */
export const heldTotal = (rows: readonly MapHeld[]): number => rows.reduce((n, r) => n + r.bytes, 0);
