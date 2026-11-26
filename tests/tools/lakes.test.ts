// The perched lakes a city's build makes (tools/mapworld/lakes.ts), on a small grid of its own.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../../tools/mapworld/base.ts";
import { readLakes } from "../../tools/mapworld/lakes.ts";

const folder = mkdtempSync(join(tmpdir(), "snark-lakes-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a lake at the map's east edge grows no water on the west edge of the next row", () => {
  // Ten samples a row, six rows, 2 m apart; columns grow eastward from the west edge at 0.
  const nx = 10, nz = 6, cell = 2;
  mkdirSync(join(folder, "base"), { recursive: true });
  // The lake's outline: the east three columns of rows 1 to 4, its surface 3 m over the sea.
  const ring = [[14.5, 10.5], [20, 10.5], [20, 1.5], [14.5, 1.5], [14.5, 10.5]];
  writeFileSync(join(folder, "base/perched_water.geojson"), JSON.stringify({ features: [{ geometry: { type: "Polygon", coordinates: [ring] }, properties: { id: "pond", name: "Edge Pond", above_sea_m: 3 } }] }));
  // Flat at its surface under the lake and down the far west columns; high ground between.
  const dem = Float32Array.from({ length: nx * nz }, (_, i) => (i % nx >= 7 || i % nx <= 1 ? 3 : 8));
  const base = { folder, grid: { nx, nz, cell, west: 0, north: 12 } } as unknown as Base;
  const lakes = readLakes(base, {}, 0, -32, 1 / 256, dem, () => false)!;
  const wet = [...lakes.body.keys()].filter((i) => lakes.body[i]! > 0);
  expect(wet.length).toBeGreaterThan(0);
  expect(wet.filter((i) => i % nx < 5)).toEqual([]);
});
