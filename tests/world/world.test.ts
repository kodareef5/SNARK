import { expect, test } from "bun:test";
import { Found } from "../../shared/world/structures.ts";
import { Rng } from "../../shared/rng.ts";
import { SKIN, capsuleBox, capsuleFree } from "../../shared/world/collide.ts";
import { flatWorld, provingWorld, type TestWorld } from "../fixtures/world.ts";

function capsuleFreeAgainst(w: TestWorld, ref: number, x: number, y: number, z: number): boolean {
  return !capsuleBox(w.structs, ref, x, y, z, 0.4, 1.8, SKIN);
}

test("terrain height is continuous across cell and triangle edges", () => {
  const { hf } = provingWorld();
  const rng = new Rng(3);
  for (let n = 0; n < 4000; n++) {
    const x = rng.range(1, hf.sizeX - 1);
    const z = rng.range(1, hf.sizeZ - 1);
    const h = hf.heightAt(x, z);
    // No slope on this map is much over 60 degrees, so a 1 mm move changes the height by millimetres.
    expect(Math.abs(hf.heightAt(x + 0.001, z) - h)).toBeLessThan(0.02);
    expect(Math.abs(hf.heightAt(x, z + 0.001) - h)).toBeLessThan(0.02);
  }
  expect(hf.heightAt(40, 60)).toBeCloseTo(hf.sample(20, 30), 9);
});

test("structures can be added, found, removed and their slots reused", () => {
  const w = flatWorld(2);
  const wall = w.kind("core:wall");
  const out = new Found();
  const a = w.structs.add(wall, 63.2, 1.5, 20, 0, 7, 100); // footprint crosses a chunk edge
  const b = w.structs.add(wall, 30, 1.5, 20, 16384, 7, 100);
  expect(w.structs.count).toBe(2);
  expect(w.structs.query(64.1, 19.9, 64.2, 20.1, out)).toBe(1); // found from the neighbouring chunk
  expect(out.refs[0]).toBe(a);
  expect(w.structs.query(29.9, 18.6, 30.1, 18.7, out)).toBe(1); // rotated footprint
  expect(out.refs[0]).toBe(b);

  const t = w.structs.chunks[0]!;
  const v = t.version;
  expect(w.structs.remove(a)).toBe(true);
  expect(w.structs.remove(a)).toBe(false);
  expect(t.version).toBe(v + 1);
  expect(w.structs.query(60, 19, 68, 21, out)).toBe(0);
  const c = w.structs.add(wall, 10, 1.5, 10, 0, 7, 100);
  expect(c).toBe(a); // same chunk, same slot
  expect(t.mod[c & 0xffff]).toBe(t.version);
});

test("the collision grid matches a brute-force search", () => {
  const w = flatWorld(4);
  const rng = new Rng(9);
  const kinds = ["core:wall", "core:crate", "core:slab", "core:pillar"].map((id) => w.kind(id));
  const refs: number[] = [];
  for (let i = 0; i < 600; i++) refs.push(w.structs.add(kinds[rng.int(4)]!, rng.range(2, 254), rng.range(0, 3), rng.range(2, 254), rng.int(65536), 0, 1));
  for (let i = 0; i < 200; i++) w.structs.remove(refs.splice(rng.int(refs.length), 1)[0]!);
  // The 400 results are more than the 64 a Found starts with, so its list grows.
  const found = new Found();
  const count = w.structs.query(0, 0, 256, 256, found);
  const all = found.refs;
  expect(count).toBe(400);
  for (let n = 0; n < 3000; n++) {
    const x = rng.range(1, 255);
    const z = rng.range(1, 255);
    const y = rng.range(0, 3);
    const viaGrid = capsuleFree(w, x, y, z, 0.4, 1.8);
    let brute = true;
    for (let i = 0; i < count && brute; i++) {
      const ref = all[i]!;
      const t = w.structs.chunks[Math.floor(ref / 65536)]!;
      const s = ref & 0xffff;
      const k = t.kind[s]!;
      const reach = Math.hypot(w.structs.halfXOf(k), w.structs.halfZOf(k)) + 0.4;
      if (Math.hypot(t.x[s]! - x, t.z[s]! - z) > reach) continue;
      brute = brute && capsuleFreeAgainst(w, ref, x, y, z);
    }
    expect(viaGrid).toBe(brute);
  }
});

