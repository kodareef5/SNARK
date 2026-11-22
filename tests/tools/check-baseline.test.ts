import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, history, OVER, remember, RUNS_KEPT, RUNS_NEEDED, type Run } from "../../tools/check-baseline.ts";

const run = (cpu: number, files: Record<string, number> = {}): Run => ({ cpu, files });

test("a machine is not compared until it has run often enough, then against the median of its own runs", () => {
  const few = Array.from({ length: RUNS_NEEDED - 1 }, () => run(100));
  expect(compare(few, run(10_000))).toEqual({ baseline: null, over: false, grew: [] });

  // One run beside a busy neighbour does not move the baseline.
  const seen = [run(100), run(110), run(900)];
  expect(compare(seen, run(100)).baseline).toBe(110);
  expect(compare(seen, run(110 * (1 + OVER))).over).toBe(false);
  expect(compare(seen, run(110 * (1 + OVER) + 1)).over).toBe(true);
});

test("over the baseline it names what grew against its own runs, not what is costly every day", () => {
  const seen = [run(100, { "tests/a.test.ts": 50, "tests/b.test.ts": 2 }), run(100, { "tests/a.test.ts": 50, "tests/b.test.ts": 2 }), run(100, { "tests/a.test.ts": 50, "tests/b.test.ts": 2 })];
  const c = compare(seen, run(200, { "tests/a.test.ts": 50, "tests/b.test.ts": 30, "tests/new.test.ts": 20 }));
  expect(c.over).toBe(true);
  expect(c.grew).toEqual([
    { file: "tests/b.test.ts", was: 2, now: 30 },
    { file: "tests/new.test.ts", was: 0, now: 20 },
  ]);
});

test("each machine keeps its last runs by its key, outside the repository, and a broken file starts it again", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-baseline-"));
  try {
    const file = join(dir, "nested", "baseline.json");
    expect(history("box | 8 workers", file)).toEqual([]);
    for (let i = 0; i < RUNS_KEPT + 2; i++) remember("box | 8 workers", run(i), file);
    remember("box | 16 workers", run(999), file);
    expect(history("box | 8 workers", file).map((r) => r.cpu)).toEqual(Array.from({ length: RUNS_KEPT }, (_, i) => i + 2));
    expect(history("box | 16 workers", file)).toEqual([run(999)]);
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);

    writeFileSync(file, "{ not json");
    expect(history("box | 8 workers", file)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
