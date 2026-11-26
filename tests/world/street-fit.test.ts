// A street is typed by the looks of its stretches near each one (tools/mapworld/streets/fit.ts pooled), not by every
// stretch of its name: an edit beside one stretch, or a cut that leaves some out, changes nothing past the reach.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Base } from "../../tools/mapworld/base.ts";
import { POOL_WITHIN, fitRuns, pooled, type Run } from "../../tools/mapworld/streets/fit.ts";
import { REACH } from "../../tools/maps/local-gate.ts";

const folder = mkdtempSync(join(tmpdir(), "snark-street-fit-"));
mkdirSync(join(folder, "base"));
writeFileSync(join(folder, "base/walks.geojson"), JSON.stringify({ features: [] }));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

// Ground 2 km by 200 m at 2 m a sample, and one street of twenty blocks of 100 m along it, each block its own way.
const NX = 1001, NZ = 101;
const toSample = (x: number, z: number): number => (x < 0 || z < 0 || x > 2000 || z > 200 ? -1 : Math.round(z / 2) * NX + Math.round(x / 2));
const block = (k: number): Run => ({ id: `osm:${k}:0`, run: 0, line: k, way: k, name: "Main Street", mtfcc: "S1400", highway: "residential", lanes: 2, half: 4, oneway: 0, sidewalk: null, parking: [null, null], maxspeed: null, yielded: null, passage: null, xz: Float64Array.of(k * 100, 100, k * 100 + 100, 100) });
/** The blocks' fits on ground with a building 60 m long beside each block of `built`, 5 m back from the kerb. */
function fits(blocks: readonly number[], built: readonly number[]) {
  const mask = new Uint8Array(NX * NZ), none = new Uint8Array(NX * NZ);
  for (const k of built) for (let x = k * 100 + 20; x <= k * 100 + 80; x += 2) for (let z = 110; z <= 120; z += 2) mask[toSample(x, z)] = 1;
  const base = { folder, bytes: (name: string) => (name === "buildings" ? mask : none), elevation: () => new Float32Array(NX * NZ) } as unknown as Base;
  return fitRuns(blocks.map(block), base, (e, n) => [e, n], [], toSample);
}
const all = Array.from({ length: 20 }, (_, k) => k);

test("a building beside one block changes the street's looks near it and not 600 m on", () => {
  const [bare, built] = [fits(all, []), fits(all, [0])];
  const share = (f: ReturnType<typeof fits>, k: number): number => Math.max(f[k]!.street[0].built, f[k]!.street[1].built);
  // The block itself and the three after it see it in their street; none whose far end is past the pool does.
  expect(all.filter((k) => share(built, k) !== share(bare, k))).toEqual([0, 1, 2, 3]);
  expect(share(built, 0)).toBeGreaterThan(share(built, 3));
  for (const k of all.slice(4)) expect(built[k]).toEqual(bare[k]!);
  expect(POOL_WITHIN + 100).toBeLessThan(REACH);
});

test("a block is fitted the same in a cut that leaves out the far blocks of its street", () => {
  const built = [2, 6, 7, 11, 12, 13, 18], whole = fits(all, built), cut = fits(all.slice(6), built);
  // Blocks 10 on pool nothing before block 6 (their middles 448 m less a block's length apart at most).
  for (let k = 10; k < 20; k++) expect(cut[k - 6]).toEqual(whole[k]!);
  expect(cut[0]).not.toEqual(whole[6]!);
});

test("a pool is the stretches of one key whose far ends are within the bound, itself always", () => {
  const mids = [[0, 0], [300, 0], [398, 0], [399, 0], [0, 10]] as const, lengths = [100, 0, 0, 0, 2000].map((length) => ({ length }));
  const key = (k: number): string => (k === 4 ? "other" : "street");
  expect(pooled(5, key, mids, lengths)).toEqual([[0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3], [1, 2, 3], [4]]);
});
