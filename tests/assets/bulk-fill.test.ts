// The bulk fill the asset worker runs for "Download all" (client/core/assets/bulk.ts): what it fetches next, what a
// failure costs, when it stops for the disk's limit, and that it waits for the game's own requests. The worker joins it
// to fetch and the disk, and has no test of its own.
import { expect, test } from "bun:test";
import { BulkFill, FILL_FEWEST, FILL_LANES, FILL_MOST, FILL_TRIES, KEEP_OFF, KEEP_ON, KEEP_PAUSED, QUIET_MS, type KeepPart } from "../../client/core/assets/bulk.ts";

const KB = 1024;

/** `n` parts of `bytes` each, one after another in `url`, hashed by their file and place. */
function file(url: string, n: number, bytes: number): KeepPart[] {
  return Array.from({ length: n }, (_, k) => ({ url, part: { offset: k * bytes, length: bytes, hash: `${url}:${k}` } }));
}

/** Runs the fill to its end against a disk that keeps what it is given, `fails` saying which fetches fail. Returns the runs fetched. */
function drain(b: BulkFill, disk: Set<string>, limit = Infinity, fails: (run: readonly KeepPart[], k: number) => boolean = () => false): KeepPart[][] {
  const runs: KeepPart[][] = [];
  for (let run = b.next((h) => disk.has(h), limit); run; run = b.next((h) => disk.has(h), limit)) {
    runs.push(run);
    const kept = run.map((_, k) => !fails(run, runs.length - 1 + k));
    run.forEach((p, k) => kept[k] && disk.add(p.part.hash));
    b.ended(run, kept, 1000, run.reduce((n, p) => n + p.part.length, 0));
  }
  return runs;
}

test("parts named twice are counted once, and the report says how much of what is named is not on disk", () => {
  const b = new BulkFill(), disk = new Set(["a:0", "b:1"]);
  b.name([...file("a", 3, 100), ...file("b", 2, 50)]);
  b.name(file("a", 3, 100));
  expect(b.report((h) => disk.has(h))).toEqual({ mode: KEEP_OFF, parts: 5, bytes: 400, missing: 3, missingBytes: 250, capped: false });
  // Nothing is fetched until the player asks; then everything missing is, in runs that follow one another in a file.
  expect(b.next((h) => disk.has(h), Infinity)).toBeNull();
  b.setMode(KEEP_ON);
  const runs = drain(b, disk);
  expect(runs.map((r) => r.map((p) => p.part.hash))).toEqual([["a:1", "a:2"], ["b:0"]]);
  expect(b.report((h) => disk.has(h)).missing).toBe(0);
});

test("a run is about a second of what the last one brought, within its bounds, and never crosses into another file", () => {
  const b = new BulkFill(), disk = new Set<string>();
  b.name([...file("a", 64, 128 * KB), ...file("b", 4, 128 * KB)]);
  b.setMode(KEEP_ON);
  expect(b.pace).toBe(1024 * KB);
  const first = b.next((h) => disk.has(h), Infinity)!;
  expect(first.length).toBe(8);
  // 3 MB in a second sets the pace there; 64 KB in a second, or 80 MB, are held to the bounds.
  b.ended(first, first.map(() => true), 1000, 3 * 1024 * KB);
  expect(b.pace).toBe(3 * 1024 * KB);
  b.ended([], [], 1000, 64 * KB);
  expect(b.pace).toBe(FILL_FEWEST);
  b.ended([], [], 1000, 80 * 1024 * KB);
  expect(b.pace).toBe(FILL_MOST);
  for (const p of first) disk.add(p.part.hash);
  const runs = drain(b, disk);
  for (const run of runs) expect(new Set(run.map((p) => p.url)).size).toBe(1);
  expect(runs.flat().length).toBe(64 + 4 - 8);
});

test("a part that fails goes to the back of the line, and is given up after its tries; a disk at fault costs it none", () => {
  const b = new BulkFill(), disk = new Set<string>();
  b.name(file("a", 4, 100));
  b.setMode(KEEP_ON);
  // a:2 always fails: the others are kept at once, and it is tried FILL_TRIES times in all.
  const tried: string[] = [];
  let lost = 0;
  for (let run = b.next((h) => disk.has(h), Infinity); run; run = b.next((h) => disk.has(h), Infinity)) {
    tried.push(...run.map((p) => p.part.hash));
    const kept = run.map((p) => p.part.hash !== "a:2");
    run.forEach((p, k) => kept[k] && disk.add(p.part.hash));
    lost += b.ended(run, kept, 10, 100);
  }
  expect([tried.filter((h) => h === "a:2").length, lost, disk.size]).toEqual([FILL_TRIES, 1, 3]);
  // Asked again, what was given up is tried again.
  b.setMode(KEEP_OFF);
  b.setMode(KEEP_ON);
  // The disk failed, not the part: it goes back in line with no try spent, however often.
  for (let k = 0; k < 10; k++) {
    const run = b.next((h) => disk.has(h), Infinity)!;
    expect(run.map((p) => p.part.hash)).toEqual(["a:2"]);
    expect(b.ended(run, [false], 10, 100, false)).toBe(0);
  }
  expect(b.next((h) => disk.has(h), Infinity)).not.toBeNull();
});

test("the fill stops short of the disk's limit and says so, and what the player asked for is kept over the rest", () => {
  const b = new BulkFill(), disk = new Set<string>();
  b.name(file("a", 10, 100));
  expect(b.pinned("a:0")).toBe(false);
  b.setMode(KEEP_ON);
  const runs = drain(b, disk, 450);
  expect([runs.flat().length, disk.size, b.capped]).toEqual([4, 4, true]);
  expect(b.report((h) => disk.has(h)).capped).toBe(true);
  // Pinned while asked for, paused too; not once the player lets them go, nor a part never named.
  expect([b.pinned("a:0"), b.pinned("other")]).toEqual([true, false]);
  b.setMode(KEEP_PAUSED);
  expect([b.pinned("a:0"), b.capped, b.next((h) => disk.has(h), Infinity)]).toEqual([true, false, null]);
  b.setMode(KEEP_OFF);
  expect(b.pinned("a:0")).toBe(false);
});

test("pausing empties the line and resuming fills it again with what is still missing; a reset forgets the set", () => {
  const b = new BulkFill(), disk = new Set<string>();
  b.setMode(KEEP_ON);
  b.name(file("a", 6, 100));
  const first = b.next((h) => disk.has(h), Infinity)!;
  first.forEach((p) => disk.add(p.part.hash));
  b.ended(first, first.map(() => true), 1, 1);
  b.setMode(KEEP_PAUSED);
  expect(b.next((h) => disk.has(h), Infinity)).toBeNull();
  b.name(file("c", 2, 10));
  b.setMode(KEEP_ON);
  expect(drain(b, disk).flat().length).toBe(2);
  b.reset();
  expect([b.report((h) => disk.has(h)).parts, b.bytes, b.next((h) => disk.has(h), Infinity)]).toEqual([0, 0, null]);
});

test("a run starts only once the game's requests have ended and it has been quiet for a while", () => {
  const b = new BulkFill();
  expect(b.wait(0, 0)).toBe(0);
  expect(b.wait(0, 3)).toBe(-1);
  b.quiet(1000);
  expect([b.wait(1000, 0), b.wait(1000 + QUIET_MS / 2, 0), b.wait(1000 + QUIET_MS, 0)]).toEqual([QUIET_MS, QUIET_MS / 2, 0]);
  // The lanes it counts are the runs it handed out and has not heard the end of.
  b.name(file("a", 2, 100));
  b.name(file("b", 2, 100));
  b.setMode(KEEP_ON);
  const runs = [b.next(() => false, Infinity)!, b.next(() => false, Infinity)!];
  expect(b.running).toBe(FILL_LANES);
  b.ended(runs[0]!, [true, true], 1, 200);
  expect(b.running).toBe(1);
});
