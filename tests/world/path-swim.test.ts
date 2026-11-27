// The path search that crosses water (PathFinder.swim): what floats in the water stops it, and a straight line does not
// swim what the search paid to go round.
import { expect, test } from "bun:test";
import { swimDepth } from "../../shared/sim/character.ts";
import { PATH_FOUND, PathFinder } from "../../shared/world/path.ts";
import { flatWorld, type TestWorld } from "../fixtures/world.ts";

/** Flat ground with a lake over the rectangle given, its banks sloping to 4 m deep, the water at -0.2 m. */
function lake(x0: number, x1: number, z0: number, z1: number): TestWorld {
  const w = flatWorld(), hf = w.hf;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const into = Math.min(i * 2 - x0, x1 - i * 2, j * 2 - z0, z1 - j * 2);
    if (into > 0) hf.setSample(i, j, -Math.min(4, into * 0.4));
  }
  hf.seaLevel = -0.2;
  return w;
}

/** Metres of the way last found over water deep enough that its body swims. */
function swum(w: TestWorld, f: PathFinder): number {
  const deep = swimDepth(f.body, 0.7);
  let m = 0;
  for (let k = 1; k < f.count; k++) {
    const n = Math.ceil(Math.hypot(f.x[k]! - f.x[k - 1]!, f.z[k]! - f.z[k - 1]!) / 0.5);
    for (let s = 1; s <= n; s++) {
      const x = f.x[k - 1]! + ((f.x[k]! - f.x[k - 1]!) * s) / n, z = f.z[k - 1]! + ((f.z[k]! - f.z[k - 1]!) * s) / n;
      if (w.hf.waterAt(x, z) - w.hf.heightAt(x, z) > deep) m += 0.5;
    }
  }
  return m;
}

function finder(w: TestWorld, swim: number): PathFinder {
  const f = new PathFinder(w, w.reg.move[w.kind("core:survivor")]!);
  f.budget = 193 * 193;
  f.swim = swim;
  return f;
}

test("a dear swim is walked round, and the way kept does not swim it after all", () => {
  const w = lake(50, 70, 52, 68), f = finder(w, 8);
  expect(f.find(60, 40, 60, 80)).toBe(PATH_FOUND);
  // Its cells keep to wading water; only the lines between them clip the deep edge.
  expect(swum(w, f)).toBeLessThan(2);
  // At the price of dry ground it swims straight across.
  const g = finder(w, 1);
  expect(g.find(60, 40, 60, 80)).toBe(PATH_FOUND);
  expect(swum(w, g)).toBeGreaterThan(5);
});

test("a wall standing where a swimmer floats stops a way across deep water", () => {
  // The wall runs across the lake from x 16 to 109, on the bed 4 m down and up out of the water.
  const w = lake(16, 112, 50, 70);
  for (let i = 0; i < 31; i++) w.structs.add(w.kind("core:wall"), 17.5 + 3 * i, 1.5, 60, 0, 0, 1);
  const f = finder(w, 1.2);
  expect(f.find(60, 40, 60, 80)).toBe(PATH_FOUND);
  // Where the way crosses the wall's line, it is past an end of the wall.
  for (let k = 1; k < f.count; k++) {
    const [az, bz] = [f.z[k - 1]!, f.z[k]!];
    if ((az - 60) * (bz - 60) > 0) continue;
    const x = f.x[k - 1]! + ((f.x[k]! - f.x[k - 1]!) * (60 - az)) / (bz - az || 1);
    expect(x < 16.5 || x > 108.5).toBe(true);
  }
});
