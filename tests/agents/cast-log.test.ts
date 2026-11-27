// Cast's decision log on disk: lines wait in memory and go by one write at a time that the tick does not wait for, a
// slow or failing disk loses lines and never more, the folder keeps under its megabytes a day at a time, and each world
// writes a folder of its own.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionLog, PENDING_MOST, type DecisionRecord } from "../../server/cast/decide.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "cast-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 27, 12);
const record = (t: number, why = ""): DecisionRecord => ({ t, point: "story.plan", candidates: ["a", "b"], state: {}, choice: "a", why, policy: "rules" });
const lines = (file: string): number[] => readFileSync(file, "utf8").trimEnd().split("\n").map((l) => (JSON.parse(l) as DecisionRecord).t);

test("lines wait for a flush and are written together, and a stop writes what still waits", async () => {
  const folder = join(dir, "batch");
  const log = new DecisionLog(folder, { now: () => START });
  const file = join(folder, "decisions-2026-11-27.jsonl");
  for (let t = 0; t < 3; t++) log.write(record(t));
  expect([log.waiting, existsSync(file)]).toEqual([3, false]);
  await log.flush();
  expect([log.waiting, lines(file)]).toEqual([0, [0, 1, 2]]);
  log.write(record(3));
  log.close();
  expect([log.waiting, log.lost, lines(file)]).toEqual([0, 0, [0, 1, 2, 3]]);
  // A log with no folder keeps the last decisions in memory and writes nothing.
  const quiet = new DecisionLog(null);
  quiet.write(record(9));
  await quiet.flush();
  expect([quiet.kept.length, quiet.waiting]).toEqual([1, 0]);
});

test("one write at a time: a slow disk holds the next, loses what will not fit, and a failed write is counted, not thrown", async () => {
  const wrote: number[] = [];
  let release: () => void = () => {};
  let reached: () => void = () => {};
  /** Resolves when the next write has got as far as the disk. */
  const atDisk = (): Promise<void> => new Promise((r) => (reached = r));
  let fail = false;
  const log = new DecisionLog(join(dir, "slow"), {
    now: () => START,
    append: (_file, text) => new Promise<void>((done, refuse) => {
      release = () => {
        if (fail) return refuse(new Error("the disk is full"));
        wrote.push(text.split("\n").length - 1);
        done();
      };
      reached();
    }),
  });
  log.write(record(0));
  let disk = atDisk();
  const first = log.flush();
  // The write is under way. Everything said meanwhile waits, the oldest going when there are too many.
  for (let t = 1; t <= PENDING_MOST + 500; t++) log.write(record(t));
  expect(log.flush()).toBe(first);
  expect([log.waiting, log.lost, wrote]).toEqual([PENDING_MOST, 500, []]);
  await disk;
  release();
  await first;
  expect(wrote).toEqual([1]);
  // The next takes all that waited, and fails: its lines are lost and nothing throws.
  fail = true;
  disk = atDisk();
  const second = log.flush();
  expect(log.waiting).toBe(0);
  await disk;
  release();
  await second;
  expect([log.lost, wrote, log.kept.length]).toEqual([500 + PENDING_MOST, [1], 500]);
});

test("the folder keeps under its megabytes by dropping its oldest days, never today's, which is written no more once it alone is over", async () => {
  const folder = join(dir, "cap");
  let now = START;
  const log = new DecisionLog(folder, { now: () => now });
  const big = "x".repeat(1000);
  const day = async (n: number): Promise<void> => {
    for (let t = 0; t < n; t++) log.write(record(t, big));
    await log.flush();
  };
  log.cap = 25_000;
  // Three days of about ten kilobytes each: the first goes when the third is written.
  await day(9);
  now += DAY;
  await day(9);
  expect(readdirSync(folder).sort()).toEqual(["decisions-2026-11-27.jsonl", "decisions-2026-11-28.jsonl"]);
  now += DAY;
  await day(9);
  expect(readdirSync(folder).sort()).toEqual(["decisions-2026-11-28.jsonl", "decisions-2026-11-29.jsonl"]);
  // Today's file passes the cap by itself: the older day goes, and today takes no more.
  await day(20);
  expect(readdirSync(folder)).toEqual(["decisions-2026-11-29.jsonl"]);
  const size = statSync(join(folder, "decisions-2026-11-29.jsonl")).size;
  await day(5);
  expect([statSync(join(folder, "decisions-2026-11-29.jsonl")).size, log.lost]).toEqual([size, 5]);
  // The next day is written again, and the day that was too big goes for it.
  now += DAY;
  await day(2);
  expect(readdirSync(folder)).toEqual(["decisions-2026-11-30.jsonl"]);
  // No megabytes, no file.
  log.cap = 0;
  log.write(record(1));
  expect(log.waiting).toBe(0);
});

test("each world's log is a folder beside its own save, sized by CastLogMegabytes", async () => {
  const worlds = ["one", "two"].map((name) => {
    const db = join(dir, `${name}.db`);
    return { db, h: new Harness({}, 1, 60, { dbPath: db, startingCreatures: 0 }) };
  });
  for (const [i, w] of worlds.entries()) {
    w.h.run(6000);
    expect(w.h.host.cast.log.cap).toBe(256 * 2 ** 20);
    w.h.host.cast.log.write(record(i));
    // The host's own five-second look writes it.
    w.h.run(6000);
    await w.h.host.cast.log.flush();
  }
  for (const [i, w] of worlds.entries()) {
    const files = readdirSync(`${w.db}.cast`);
    expect(files.length).toBe(1);
    expect(lines(join(`${w.db}.cast`, files[0]!))).toEqual([i]);
  }
  expect(existsSync(join(dir, "cast"))).toBe(false);
  const { h } = worlds[0]!;
  expect(h.host.exec("setting CastLogMegabytes 2")).not.toContain("cannot");
  h.run(6000);
  expect(h.host.cast.log.cap).toBe(2 * 2 ** 20);
  // A stop writes what was said since the last look.
  h.host.cast.log.write(record(7));
  for (const w of worlds) w.h.host.shutdown();
  expect(lines(join(`${worlds[0]!.db}.cast`, readdirSync(`${worlds[0]!.db}.cast`)[0]!))).toEqual([0, 7]);
});
