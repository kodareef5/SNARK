// A closed rounded mechanical part used to become an inward tetrahedron: every individual collapse passed the
// face-normal test. Preserve the component's signed volume as well as each face's local orientation.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { measureSurface } from "../../tools/art/check.ts";
import { simplify } from "../../tools/pack/simplify.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/geometry/rounded-control.json", import.meta.url), "utf8")) as { positions: number[]; indices: number[] };
const original: SourceLod = { positions: Float32Array.from(fixture.positions), indices: Uint32Array.from(fixture.indices), colors: new Uint8Array(fixture.positions.length / 3).fill(5) };

/** Volume around the first point, avoiding a dependence on the distance from the world origin. */
function volume(lod: SourceLod): number {
  const p = lod.positions;
  let result = 0;
  for (let t = 0; t < lod.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map(k => {
      const v = lod.indices[t + k]! * 3;
      return [p[v]! - p[0]!, p[v + 1]! - p[1]!, p[v + 2]! - p[2]!];
    });
    result += (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) + a![1]! * (b![2]! * c![0]! - b![0]! * c![2]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) / 6;
  }
  return result;
}

test("closed rounded parts cannot become inward tetrahedra through locally gentle collapses", () => {
  expect(volume(original)).toBeGreaterThan(0);
  for (const scale of [0.1, 1, 10]) {
    const fine = { ...original, positions: Float32Array.from(original.positions, (v, i) => v * scale + [13, -27, 41][i % 3]!) };
    for (const { lod } of simplify(fine, [32, 16, 8, 6, 4, 2])) {
      expect(volume(lod)).toBeGreaterThanOrEqual(-1e-10 * scale ** 3);
      const facts = measureSurface(lod);
      expect([facts.holes, facts.flipped, facts.insideOut]).toEqual([0, 0, 0]);
    }
  }
});

test("separate closed parts retain their own winding when one part follows another bone", () => {
  const count = original.positions.length / 3;
  const fine: SourceLod = {
    positions: Float32Array.from([...original.positions, ...original.positions.map((v, i) => v + (i % 3 === 0 ? 3 : 0))]),
    colors: new Uint8Array(count * 2).fill(5),
    bones: Uint8Array.from({ length: count * 2 }, (_, i) => i < count ? 0 : 1),
    indices: Uint32Array.from([...original.indices, ...original.indices.map(v => v + count)]),
  };
  for (const { lod } of simplify(fine, [32, 16, 12, 8])) {
    const facts = measureSurface(lod);
    expect([facts.holes, facts.flipped, facts.insideOut]).toEqual([0, 0, 0]);
    for (const bone of [0, 1]) {
      const own = { ...lod, indices: Uint32Array.from([...lod.indices].filter(v => lod.bones![v] === bone)) };
      expect(volume(own)).toBeGreaterThanOrEqual(-1e-10);
    }
  }
});
