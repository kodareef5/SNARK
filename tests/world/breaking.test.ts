// The store's part in a city that breaks: wear told to nobody, a form swapped in place, and pieces broken as one batch.

import { expect, test } from "bun:test";
import { FORM_HEAP, FORM_OPEN, formKind } from "../../shared/content/breaks.ts";
import { heapAt, heapHealth, variantAt } from "../../shared/world/breaking.ts";
import { GONE_BLAST, TOUCH_KIND, TOUCH_LEFT, TOUCH_MOVED, type Leaves } from "../../shared/world/structures.ts";
import { city } from "../fixtures/city.ts";

const walls = (n: number, z = 100) => Array.from({ length: n }, (_, k) => ({ shape: "wall4" as const, finish: "limestucco" as const, x: 100 + k * 10, z }));

test("wear changes health and what differs from the map, and neither the chunk's version nor its log", () => {
  const c = city(walls(3));
  const structs = c.h.world.structs;
  const [a, b] = c.refs as [number, number];
  const chunk = Math.floor(a / 65536);
  const t = structs.chunks[chunk]!;
  const [version, shape, mod] = [t.version, t.shape, t.mod[a & 0xffff]!];
  const told: boolean[] = [];
  const was = structs.onChunkChanged;
  structs.onChunkChanged = (k, healthOnly) => (k === chunk ? void told.push(healthOnly) : was?.(k, healthOnly));
  expect(structs.wear(a, 7000)).toBe(true);
  expect([t.hp[a & 0xffff], t.version, t.shape, t.mod[a & 0xffff], t.recentCount, t.recentSlot]).toEqual([7000, version, shape, mod, 0, null]);
  // The save is told a hurt chunk, and the changed slots are listed.
  expect([told, t.changed, t.differs, structs.asPlaced(chunk), [...structs.changedSlots(chunk)]]).toEqual([[true], 1, 1, false, [a & 0xffff]]);
  // A slot already on the list leaves the list standing, and another makes it anew.
  const list = structs.changedSlots(chunk);
  structs.wear(a, 6000);
  expect(structs.changedSlots(chunk)).toBe(list);
  structs.wear(b, 6000);
  expect([...structs.changedSlots(chunk)]).toEqual([a & 0xffff, b & 0xffff]);
  // Worn back to full, the chunk stands as placed again.
  structs.wear(a, 7500);
  structs.wear(b, 7500);
  expect([t.changed, structs.asPlaced(chunk), t.version]).toEqual([0, true, version]);
  expect(structs.wear(chunk * 65536 + 900, 1)).toBe(false);
});

test("a swap may set health, changes version once, and is logged as a kind changed in place", () => {
  const c = city(walls(1));
  const structs = c.h.world.structs, reg = c.h.reg;
  const a = c.refs[0]!;
  const t = structs.chunks[Math.floor(a / 65536)]!;
  const [version, placed, x] = [t.version, t.placed, t.x];
  const open = formKind(reg, t.kind[a & 0xffff]!, FORM_OPEN, 1);
  expect(structs.swap(a, open, 1875)).toBe(true);
  expect([t.kind[a & 0xffff], t.hp[a & 0xffff], t.version - version, t.placed, t.x === x]).toEqual([open, 1875, 1, placed, true]);
  expect([t.recentSlot![0], t.recentShaped![0], t.recentVer![0]]).toEqual([a & 0xffff, TOUCH_KIND, version + 1]);
  // Without a health given, a swap keeps the row's.
  structs.swap(a, formKind(reg, open, FORM_HEAP, 1));
  expect(t.hp[a & 0xffff]).toBe(1875);
});

test("pieces broken together are one version, one batch and one shape signal a chunk, heaps left in place", () => {
  // Three walls in one chunk and one in the next, across x = 128.
  const c = city([...walls(3), { shape: "wall4", finish: "limestucco", x: 132, z: 100 }]);
  const structs = c.h.world.structs, reg = c.h.reg;
  const [a, b, d, far] = c.refs as [number, number, number, number];
  const [near, next] = [Math.floor(a / 65536), Math.floor(far / 65536)];
  expect([Math.floor(d / 65536), next !== near]).toEqual([near, true]);
  const [t, u] = [structs.chunks[near]!, structs.chunks[next]!];
  const versions = [t.version, u.version];
  const shaped: number[] = [];
  const removed: number[] = [];
  structs.onShape.push((chunk) => void shaped.push(chunk));
  const was = structs.onRemove;
  structs.onRemove = (ref, cause) => {
    removed.push(ref, cause);
    was?.(ref, cause);
  };
  // Two leave their heaps and two are emptied.
  const leaves = (ref: number, out: Leaves): void => {
    if (ref !== a && ref !== far) return;
    const [v, slot] = [structs.chunks[Math.floor(ref / 65536)]!, ref & 0xffff];
    out.kind = heapAt(reg, v.kind[slot]!, v.x[slot]!, v.y[slot]!, v.z[slot]!);
    out.hp = heapHealth(reg, out.kind);
  };
  const refs = Uint32Array.of(far, d, a, b, a);
  expect(structs.breakMany(refs, 5, GONE_BLAST, leaves, 111, 2, 99, 77, 7.5)).toBe(4);
  expect([t.version - versions[0]!, u.version - versions[1]!, shaped.sort()]).toEqual([1, 1, [near, next].sort()]);
  const heap = formKind(reg, reg.index.get("core:zruin_wall4_limestucco")!, FORM_HEAP, variantAt(t.x[a & 0xffff]!, t.y[a & 0xffff]!, t.z[a & 0xffff]!));
  expect([t.kind[a & 0xffff], t.hp[a & 0xffff], t.kind[b & 0xffff], t.kind[d & 0xffff], reg.breakForm[u.kind[far & 0xffff]!]]).toEqual([heap, 24, 0, 0, FORM_HEAP]);
  expect(t.gone).toEqual([{ version: versions[0]! + 1, cause: GONE_BLAST, x: 111, y: 2, z: 99, stamp: 77, radius: 7.5, runs: [b & 0xffff, 2], left: [a & 0xffff, 1], count: 3 }]);
  expect(u.gone).toEqual([{ version: versions[1]! + 1, cause: GONE_BLAST, x: 111, y: 2, z: 99, stamp: 77, radius: 7.5, runs: [], left: [far & 0xffff, 1], count: 1 }]);
  // Only what was emptied is told as removed. A heap is its piece still, in its slot.
  expect(removed).toEqual([b, GONE_BLAST, d, GONE_BLAST]);
  expect(Array.from(t.recentShaped!.subarray(0, 3))).toEqual([TOUCH_KIND | TOUCH_LEFT, TOUCH_MOVED, TOUCH_MOVED]);
  // All four are the map's changed slots, the emptied ones kept, and a query finds the heaps where the walls stood.
  expect([[...structs.changedSlots(near)], t.mapped, t.free]).toEqual([[a & 0xffff, b & 0xffff, d & 0xffff], 3, []]);
  // While held, listeners wait, and are told once of a chunk at the release.
  shaped.length = 0;
  structs.hold();
  structs.swap(a, formKind(reg, heap, FORM_OPEN, 0));
  structs.swap(a, heap);
  expect(shaped).toEqual([]);
  structs.release();
  expect(shaped).toEqual([near]);
});
