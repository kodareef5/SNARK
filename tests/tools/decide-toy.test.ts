// The lab's toy world (tools/decide/toy.ts): the whole loop with no game in it, and a trained scorer that beats a poor rule.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { toyLoop } from "../../tools/decide/toy.ts";

const ROOT = join(import.meta.dir, "../..");

/**
 * Every file `file` loads, and what they load, by the paths written in their static imports. A dynamic import is left
 * out: fit.ts loads the game's catalogue so only when it is run as a command.
 */
function reach(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) reach(resolve(dirname(file), m[1]!), seen);
  return seen;
}

test("the toy loads nothing outside the engine and the lab but the seeded random numbers", () => {
  const files = [...reach(join(ROOT, "tools/decide/toy.ts"))].map((f) => relative(ROOT, f));
  const outside = files.filter((f) => !f.startsWith("shared/decide/") && !f.startsWith("tools/decide/"));
  // The lab draws with shared/rng.ts, which imports nothing.
  expect(outside.sort()).toEqual(["shared/rng.ts"]);
  for (const f of outside) expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(/^import /m);
  expect(files).toContain("tools/decide/fit.ts");
});

test("the toy's loop trains a scorer that beats its poor rule on held-out layouts", () => {
  const root = join(ROOT, ".cache/decide/test", `toy-${process.pid}`);
  try {
    const r = toyLoop({ root, per: 80, seed: 2 });
    const p = r.board.points[0]!;
    expect([r.thrown, r.decisions > 250]).toEqual([0, true]);
    const rule = p.episodes.find((e) => e.name === "rule")!;
    const best = Math.max(...p.episodes.filter((e) => e.name.startsWith("toy.ring.")).map((e) => e.arrived));
    expect(best).toBeGreaterThan(rule.arrived + 0.5 * (rule.scenes - rule.arrived));
    const trained = p.scores.filter((s) => s.kind === "linear" || s.kind === "hidden");
    expect(trained.length).toBe(2);
    expect(Math.min(...trained.map((s) => s.regretRatio))).toBeLessThan(0.6);
    // Too few held-out decisions for the gate to be read at all.
    for (const s of trained) expect(s.gate.why[0]).toStartWith("not measurable");
    expect(readFileSync(join(root, "scoreboard.html"), "utf8")).toContain("toy.ring");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
