import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PartDiff } from "../../tools/maps/diff.ts";
import { midFootprint, tooFar } from "../../tools/maps/local-gate.ts";

const square = (e: number, n: number, side: number, id: number) => ({ geometry: { type: "Polygon", coordinates: [[[e, n], [e + side, n], [e + side, n + side], [e, n + side], [e, n]]] }, properties: { id } });

test("the footprint taken out is the mid-size one nearest the cut's middle, whatever the file's order", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-gate-"));
  try {
    mkdirSync(join(dir, "base"));
    writeFileSync(join(dir, "map.json"), JSON.stringify({ bounds: [1000, 2000, 2000, 3000], frame: [10, 20] }));
    const rows = [square(1480, 2480, 10, 1), square(1470, 2470, 60, 2), square(1100, 2100, 25, 3), square(1560, 2560, 25, 4)];
    const find = (features: unknown[]) => { writeFileSync(join(dir, "base/buildings.geojson"), JSON.stringify({ features })); return midFootprint(dir); };
    // 1 is too small and 2 too large; 4 is nearer the middle than 3. Its place counts west from the east edge, north from the south.
    expect([find(rows).id, find([...rows].reverse()).id]).toEqual([4, 4]);
    expect([find(rows).x, find(rows).z, find(rows).area]).toEqual([10 * 64 + (2000 - 1572.5), 20 * 64 + (2572.5 - 2000), 625]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a part that differs far from the edit fails, one near it or clipped does not", () => {
  const row = (state: PartDiff["state"], from: number, clipped = false): PartDiff => ({ kind: "statics", col: 1, row: 1, state, clipped, inside: 0, from });
  const rows = [row("changed", 0), row("changed", 599), row("changed", 2423), row("same", 5000), row("changed", 3000, true), { ...row("changed", 4000), kind: "head" as const }];
  expect(tooFar(rows, (r) => r.from ?? 0).map((r) => r.from)).toEqual([2423]);
});
