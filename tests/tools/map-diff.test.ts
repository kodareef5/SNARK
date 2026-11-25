import { expect, test } from "bun:test";
import { readHead, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { byNames, diffMaps, report, type PartDiff } from "../../tools/maps/diff.ts";
import { wideMap } from "../fixtures/map.ts";

const head = (m = wideMap()) => readHead(writeMap(m));

test("a map compared with itself differs in no part", () => {
  const rows = diffMaps(head(), head());
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.every((r) => r.state === "same")).toBe(true);
});

test("a piece moved changes its own sector's statics and nothing else's", () => {
  const base = wideMap(), list = base.statics as readonly MapStatic[];
  const at = list.findIndex((s) => s.x > 1100 && s.x < 1900 && s.z > 300 && s.z < 700);
  const piece = { ...list[at]!, x: list[at]!.x + 1 / 512 };
  const moved = { ...base, statics: list.map((s, k) => (k === at ? piece : s)) };
  const dims = moved.dims as { frameX: number; frameZ: number };
  const near = { x: dims.frameX * 64 + piece.x, z: dims.frameZ * 64 + piece.z };
  const rows = diffMaps(head(), head(moved), near).filter((r) => r.state !== "same");
  const sectors = rows.filter((r) => r.kind !== "head" && r.kind !== "tops");
  expect(sectors.map((r) => `${r.kind} ${r.from}`)).toEqual(["statics 0"]);
  expect(report(rows, true).some((l) => l.startsWith("statics: 0 same, 1 differ"))).toBe(true);
});

test("a square one map holds only in part is told as clipped, and one only the other holds as its own", () => {
  const whole = wideMap();
  const smaller = wideMap();
  const dims = { ...whole.dims, chunksX: 40 };
  const side = 40 * 32 + 1, across = 70 * 32 + 1;
  const keep = (a: Uint16Array | Uint8Array) => a.filter((_, k) => k % across < side);
  const cut = { ...smaller, dims, heights: keep(smaller.heights) as Uint16Array, tint: keep(smaller.tint) as Uint8Array, statics: (smaller.statics as readonly MapStatic[]).filter((s) => s.x < 40 * 64), nodes: [], spawns: [{ ...smaller.spawns[0]!, x: 600 }], water: undefined };
  const rows = diffMaps(head(whole), readHead(writeMap(cut)));
  expect(rows.some((r) => r.state === "only a" && r.kind === "ground")).toBe(true);
  expect(rows.some((r) => r.clipped && r.kind === "ground")).toBe(true);
  expect(rows.filter((r) => r.state === "only b")).toEqual([]);
});

test("a kind new to one head renumbers other sectors, and by names only its own differs", () => {
  const base = wideMap(), list = base.statics as readonly MapStatic[];
  const at = list.findIndex((s) => s.x > 1100 && s.x < 1900 && s.z > 300 && s.z < 700);
  const renamed = { ...base, statics: list.map((s, k) => (k === at ? { ...s, kind: "core:aaa" } : s)) };
  const [ba, bb] = [writeMap(base), writeMap(renamed)];
  const [a, b] = [readHead(ba), readHead(bb)];
  const compared = diffMaps(a, b);
  const changed = (rows: readonly PartDiff[]): PartDiff[] => rows.filter((r) => r.kind === "statics" && r.state === "changed");
  expect(changed(compared).length).toBeGreaterThan(1);
  const rows = byNames(compared, a, b, (h, p) => (h === a ? ba : bb).subarray(p.at, p.at + p.length));
  expect(changed(rows)).toHaveLength(1);
  expect(rows.some((r) => r.state === "renumbered")).toBe(true);
  expect(report(rows, false).some((l) => /^statics: \d+ same, \d+ renumbered, 1 differ/.test(l))).toBe(true);
});
