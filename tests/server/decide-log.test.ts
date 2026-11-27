// The line log (server/decide/log.ts) and Cast's decisions on it (server/cast/decide.ts).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionLog } from "../../server/cast/decide.ts";
import { LineLog } from "../../server/decide/log.ts";

function folder<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "line-log-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const read = (dir: string): string[] => readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").trim().split("\n"));

test("lines gather in memory and one flush writes them to this world's file for the day", () =>
  folder(async (dir) => {
    const log = new LineLog(join(dir, "deeper"), "decide-w3");
    log.add("one");
    log.add("two");
    expect(readdirSync(dir)).toEqual([]);
    await log.flush();
    log.add("three");
    // Two flushes asked for together still write in order, one at a time.
    await Promise.all([log.flush(), log.flush()]);
    expect(readdirSync(join(dir, "deeper"))).toEqual([`decide-w3-${new Date().toISOString().slice(0, 10)}.jsonl`]);
    expect(read(join(dir, "deeper"))).toEqual(["one", "two", "three"]);
    expect([log.written, log.dropped, log.bytes]).toEqual([3, 0, 14]);
  }));

test("a day holds only its cap, and what is over it is dropped and counted", () =>
  folder(async (dir) => {
    const log = new LineLog(dir, "small", 1);
    log.cap = 10;
    // Six bytes with its line end, then one that would pass the cap, then a short one that still fits.
    log.add("12345");
    log.add("12345");
    log.add("x");
    await log.flush();
    expect(read(dir)).toEqual(["12345", "x"]);
    expect([log.written, log.dropped, log.bytes]).toEqual([2, 1, 8]);
    // What is already written today counts against the next.
    log.add("abc");
    await log.flush();
    expect([log.written, log.dropped]).toEqual([2, 2]);
  }));

test("with no folder nothing is kept or written", async () => {
  const log = new LineLog(null, "none");
  log.add("one");
  await log.flush();
  expect([log.written, log.dropped, log.bytes]).toEqual([0, 0, 0]);
});

test("Cast's decisions keep the last five hundred in memory and go to a file named for the world", () =>
  folder(async (dir) => {
    const log = new DecisionLog(dir, "decisions-w7");
    for (let t = 0; t < 502; t++) log.write({ t, point: "story.plan", candidates: ["a", "b"], state: {}, choice: "a", policy: "rules" });
    expect([log.kept.length, log.kept[0]!.t]).toEqual([500, 2]);
    await log.lines.flush();
    const lines = read(dir);
    expect(readdirSync(dir)[0]).toStartWith("decisions-w7-");
    expect([lines.length, JSON.parse(lines[501]!).t]).toEqual([502, 501]);
  }));
