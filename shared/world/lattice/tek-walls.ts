import type { StructureStore } from "../structures.ts";
import { STOREY_LEVELS } from "./forms.ts";
import { ownDir } from "./frames.ts";
import { CLS_EDGE, LVL_MOST, M_MOST, SIDE, key0, key1, keyAnchor, keyDir, keyLayer, keyLvl, tupleStep, tupleWithin } from "./module.ts";

export interface TekWallKinds { solid: number; door: number; open: number }

export function tekWallKinds(index: ReadonlyMap<string, number>): TekWallKinds {
  return {
    solid: index.get("core:wall_tek") ?? 0,
    door: index.get("core:phase_wall_tek") ?? 0,
    open: index.get("core:phase_wall_open_tek") ?? 0,
  };
}

export function isTekWall(kinds: TekWallKinds, kind: number, doorsOnly = false): boolean {
  return kind > 0 && (kind === kinds.door || kind === kinds.open || (!doorsOnly && kind === kinds.solid));
}

const anchor = new Int32Array(8);

/** Each bit is a whole edge shared with a wall of the same base and owner, in local left, right, bottom, top order. */
export function tekWallNeighbours(store: StructureStore, kinds: TekWallKinds, ref: number, out: Int32Array, doorsOnly = false): number {
  out.fill(-1, 0, 4);
  const t = store.chunks[ref >>> 16], s = ref & 65535;
  if (!t || !store.forms || !t.fr?.[s] || !isTekWall(kinds, t.kind[s]!, doorsOnly)) return 0;
  const fr = t.fr[s]!, k0 = t.k0![s]!, k1 = t.k1![s]!, dir = keyDir(k1), lvl = keyLvl(k1), layer = keyLayer(k1);
  const run = ownDir(store.forms, t.kind[s]!, k1);
  keyAnchor(k0, k1, anchor, 0);
  let mask = 0;
  for (let i = 0; i < 4; i++) {
    const h = i < 2 ? lvl : lvl + (i === 2 ? -STOREY_LEVELS : STOREY_LEVELS);
    if (Math.abs(h) > LVL_MOST) continue;
    const at = i < 2 ? 4 : 0;
    if (i < 2) {
      tupleStep(anchor, 0, run, i === 0 ? -SIDE : SIDE, anchor, at);
      if (!tupleWithin(anchor, at, M_MOST)) continue;
    }
    const a = key0(CLS_EDGE, anchor[at]!, anchor[at + 1]!, anchor[at + 2]!);
    const b = key1(anchor[at + 3]!, h, dir, layer, 0, 0);
    const other = store.refAt(fr, a, b);
    if (other < 0) continue;
    const row = store.chunks[other >>> 16]!, slot = other & 65535;
    if (row.owner[slot] === t.owner[s] && isTekWall(kinds, row.kind[slot]!, doorsOnly)) {
      out[i] = other;
      mask |= 1 << i;
    }
  }
  return mask;
}
