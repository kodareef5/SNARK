import { expect, test } from "bun:test";
import { exhaustLight, exhaustPhase } from "../../client/core/render/suit-finish.ts";
import { artModule } from "../../tools/art/source.ts";

const { contour, finish, Surface } = await artModule("core/humans/human-bodies/meridian/surface.ts");

test("both shoulder plates close with opposite winding on either side of every edge", () => {
  for (const side of [-1, 1]) {
    const form = contour([[0.1, 0, 0, 0.09, 0.07], [0.24, 0, 0, 0.06, 0.05]], side);
    const shell = new Surface(0);
    shell.panel(form, [[0.10, -45, 160], [0.14, -56, 175], [0.21, -47, 164], [0.24, -25, 120]], finish.ceramic, 7, 24);
    const lod = shell.done();
    const corners = Array.from(lod.bones!, (_, i) => lod.positions.subarray(i*3, i*3+3).join(","));
    const edges = new Map<string, number[]>();
    for (let i = 0; i < lod.indices.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = corners[lod.indices[i+k]!]!, b = corners[lod.indices[i+(k+1)%3]!]!;
      const key = a < b ? a + "/" + b : b + "/" + a;
      const uses = edges.get(key) ?? [];
      uses.push(a < b ? 1 : -1);
      edges.set(key, uses);
    }
    for (const uses of edges.values()) expect(uses.sort()).toEqual([-1, 1]);
  }
});

test("each outsole covers the welt with downward triangles at every distance", () => {
  for (const level of [0, 1, 2]) {
    const shoe = new Surface(level), y = -0.01;
    const form = contour([[y, 0, 0, 0.07, 0.15], [0.024, 0, 0, 0.07, 0.15]]);
    shoe.panel(form, [[y, -180, 180], [0.024, -180, 180]], finish.rubber, 16, 24, 0, true);
    const lod = shoe.done(), p = lod.positions;
    let area = 0;
    for (let t = 0; t < lod.indices.length; t += 3) {
      const a = 3*lod.indices[t]!, b = 3*lod.indices[t+1]!, c = 3*lod.indices[t+2]!;
      if ([a,b,c].some(i => Math.abs(p[i+1]! - y) > 1e-6)) continue;
      const down = (p[b]!-p[a]!) * (p[c+2]!-p[a+2]!) - (p[b+2]!-p[a+2]!) * (p[c]!-p[a]!);
      expect(down).toBeGreaterThan(0);
      area += down / 2;
    }
    expect(area).toBeGreaterThan(0.88 * Math.PI * 0.07 * 0.15);
  }
});

test("the exhaust fades at the tip and silhouette, pulses continuously, and retains its blue at dusk exposure", () => {
  const rgb = new Float64Array(3);
  const sample = (along: number, facing: number, ms: number, exposure = 1) =>
    exhaustLight(rgb, along, 0.3, facing, exhaustPhase(ms), exposure);
  expect(sample(0, 1, 0)).toBeGreaterThan(0.9);
  const nozzle = [...rgb];
  expect(sample(1, 1, 0)).toBe(0);
  expect(sample(0.3, 0, 0)).toBe(0);
  expect(sample(0.28, 0.8, 0)).not.toBeCloseTo(sample(0.28, 0.8, 130), 2);
  expect(sample(0.28, 0.8, 319.999)).toBeCloseTo(sample(0.28, 0.8, 0), 4);
  sample(0, 1, 0, 32000);
  for (let i = 0; i < 3; i++) expect(rgb[i]! * 32000).toBeCloseTo(nozzle[i]! * 1.7, 5);
  sample(0.6, 0.9, 100);
  expect(rgb[2]!).toBeGreaterThan(2 * rgb[1]!);
});

test("each nozzle has independent travelling flecks that fade between emissions", () => {
  const rgb = new Float64Array(3), phase = exhaustPhase(80);
  for (const seed of [2, 4]) {
    const lane = 3, variant = ((lane + seed)*0.618034)%1;
    const age = (0.25+variant)%1;
    const azimuth = seed + (lane+0.5+0.22*Math.sin(age*5+lane))/7;
    expect(exhaustLight(rgb, age, azimuth, 1, phase, 1)).toBeGreaterThan(0.4);
    expect(rgb[2]).toBeGreaterThan(rgb[0]!);
    expect(exhaustLight(rgb, age, azimuth, 1, exhaustPhase(160), 1)).toBe(0);
    expect(exhaustLight(rgb, age, azimuth+(seed === 2 ? 2 : -2), 1, phase, 1)).toBe(0);
  }
});

test("the lining keeps the body's weights and stays put while the plates move", () => {
  const lod = {
    positions: Float32Array.from([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]), colors: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]), bones: Uint8Array.from([3, 3, 4]),
    joints: Uint8Array.from([3, 4, 0, 0, 3, 0, 0, 0, 4, 3, 0, 0]), weights: Float32Array.from([0.7, 0.3, 0, 0, 1, 0, 0, 0, 0.8, 0.2, 0, 0]),
  };
  const s = new Surface(0, () => [0, 0, 0.01]);
  s.liner(lod, false);
  s.panel(contour([[0, 0, 0, 0.05, 0.05], [0.1, 0, 0, 0.05, 0.05]]), [[0, -40, 40], [0.1, -40, 40]], finish.ceramic, 5, 6, 0);
  const out = s.done();
  expect([...out.positions.subarray(0, 9)]).toEqual([...lod.positions]);
  expect([...out.joints!.subarray(0, 12)]).toEqual([...lod.joints]);
  expect(out.weights![1]).toBeCloseTo(0.3, 6);
  // The plate is drawn 1 cm forward of where its form puts it, on its one bone.
  const n = out.positions.length / 3;
  expect(out.positions[3 * 3 + 2]! - contour([[0, 0, 0, 0.05, 0.05], [0.1, 0, 0, 0.05, 0.05]])(0, -40, 0)[2]).toBeCloseTo(0.01, 6);
  expect([out.joints![(n - 1) * 4], out.weights![(n - 1) * 4]]).toEqual([5, 1]);
});
