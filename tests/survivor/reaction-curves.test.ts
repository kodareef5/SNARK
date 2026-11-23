// The reaction curves are baked by the ragdoll solver once where they load, and a page's build bakes them into the
// file a page fetches (tools/page-script.ts). Every machine decodes the same packed text; none runs the solver for a
// stagger.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { bakeCurve } from "../../shared/anim/reaction-bake.ts";
import { packReact, reactCurve, REACT_FALL, REACT_HEAVY, REACT_NONE, REACT_STAGGER } from "../../shared/anim/reactions.ts";
import "../../shared/anim/reaction-late.ts";
import { bakedCurves } from "../../tools/page-script.ts";
import { REACT_CURVES } from "../../shared/anim/reaction-curves.ts";

const ROOT = join(import.meta.dir, "../..");

/** Degrees between two turns, four numbers each. */
function apart(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): number {
  let dot = 0, d2 = 0;
  for (let c = 0; c < 4; c++) dot += a[ao + c]! * b[bo + c]!;
  for (let c = 0; c < 4; c++) d2 += (a[ao + c]! - Math.sign(dot || 1) * b[bo + c]!) ** 2;
  return (4 * Math.asin(Math.min(1, Math.sqrt(d2) / 2)) * 180) / Math.PI;
}

/** Every stagger and heavy stagger word, at start `start`, with what it is made of. */
function everyWord(start: number): { word: number; kind: number; dir: number; height: number; strength: number }[] {
  const out = [];
  for (const kind of [REACT_STAGGER, REACT_HEAVY]) for (let dir = 0; dir < 16; dir++) for (let height = 0; height < 4; height++) for (let strength = 0; strength < 4; strength++) out.push({ word: packReact(kind, start, dir, height, strength), kind, dir, height, strength });
  return out;
}

test("a page's build puts the baked text in its curves file, and no solver", async () => {
  const built = await Bun.build({ entrypoints: [join(ROOT, "shared/anim/reaction-late.ts")], target: "browser", minify: true, plugins: [bakedCurves] });
  expect(built.success).toBe(true);
  const text = await built.outputs[0]!.text();
  expect(text.includes(JSON.stringify(REACT_CURVES))).toBe(true);
  // The text and its reader: the solver would bring a heightfield and the ragdoll with it.
  expect(text.length).toBeLessThan(REACT_CURVES.length + 20000);
});

test("packed ways decode near the solver's turns, and ways past 8 near its own", () => {
  let packed = 0, mirrored = 0;
  for (const { word, dir } of everyWord(77)) {
    const got = reactCurve(word)!, want = bakeCurve(word);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i += 4) {
      if (dir <= 8) packed = Math.max(packed, apart(got, i, want, i));
      else mirrored = Math.max(mirrored, apart(got, i, want, i));
    }
  }
  // A hundredth of a degree from rounding; the solver itself is not quite symmetric, by about a degree.
  expect(packed).toBeLessThan(0.01);
  expect(mirrored).toBeLessThan(2);
  expect([reactCurve(REACT_NONE), reactCurve(packReact(REACT_FALL, 0, 3, 1, 0))]).toEqual([null, null]);
});

test("a way past 8 decodes as the mirror of 16 less it: the arms trade sides", () => {
  for (const { word, kind, dir, height, strength } of everyWord(5)) {
    if (dir <= 8) continue;
    const curve = reactCurve(word)!, from = reactCurve(packReact(kind, 5, 16 - dir, height, strength))!;
    const mirror = new Float64Array(from.length), swap = [0, 1, 4, 5, 2, 3];
    for (let f = 0; f < from.length / 24; f++) for (let k = 0; k < 6; k++) {
      const o = (f * 6 + k) * 4, s = (f * 6 + swap[k]!) * 4;
      mirror[o] = from[s]!;
      mirror[o + 1] = -from[s + 1]!;
      mirror[o + 2] = -from[s + 2]!;
      mirror[o + 3] = from[s + 3]!;
    }
    expect(curve).toEqual(mirror);
  }
});

test("a curve's start does not change it, and it is decoded once a word", () => {
  const a = packReact(REACT_HEAVY, 12, 11, 2, 3), b = packReact(REACT_HEAVY, 200, 11, 2, 3);
  expect(reactCurve(a)).toBe(reactCurve(b));
});

test("posing a reeling body reaches no solver: its module imports none", () => {
  const seen = new Set<string>(), next = [join(ROOT, "shared/anim/reactions.ts")];
  while (next.length > 0) {
    const file = next.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gms)) {
      const path = join(dirname(file), m[2]!);
      if (!m[1] && m[2]!.startsWith(".") && existsSync(path)) next.push(path);
    }
  }
  const files = [...seen].map((f) => relative(ROOT, f));
  expect(files).toContain("shared/anim/human.ts");
  for (const file of ["shared/anim/ragdoll.ts", "shared/anim/reaction-bake.ts", "shared/anim/reaction-curves.ts"]) expect(files.includes(file), file).toBe(false);
});
