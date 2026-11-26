// The city orchestrator (tools/maps/city.ts) run with stages that are tiny Bun scripts, in a folder of its own.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCity, type CityRun, type Stage } from "../../tools/maps/city.ts";

let dir = "";
const CITY = "testcity";
const source = (): string => join(dir, "source");
const maps = (): string => join(dir, "maps");

// A stage writes <work>/<name>.out and logs itself; one told to fail exits 3; the build writes the map as build.ts does.
const STEP = `import { appendFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
const [work, name, maps, city] = process.argv.slice(2);
appendFileSync(join(work, "runs.log"), name + "\\n");
if (process.env.FAIL === name) process.exit(3);
if (name === "fetch") {
  mkdirSync(join(work, "raw"), { recursive: true });
  writeFileSync(join(work, "raw/fetched"), "x");
  const osm = { bytes: 9, md5: "m", sha256: process.env.EXTRACT ?? "one" };
  writeFileSync(join(work, "downloads.json"), JSON.stringify({ "osm/extract": osm, "tl_2025_12086_roads.zip": { bytes: 3, sha256: "t" } }));
}
if (process.env.FAIL_AFTER === name) process.exit(4);
writeFileSync(join(work, name + ".out"), name);
if (name === "build") {
  mkdirSync(join(maps, city), { recursive: true });
  rmSync(join(maps, city, "stamp.json"), { force: true });
  const file = join(maps, city + ".snmap");
  writeFileSync(file, basename(dirname(work)));
  const stamp = JSON.parse(process.env.SNARK_MAP_STAMP ?? "null");
  if (stamp) { const s = statSync(file); writeFileSync(join(maps, city, "stamp.json"), JSON.stringify({ ...stamp, bytes: s.size, mtimeMs: s.mtimeMs })); }
}
`;

const NAMES = ["frame", "fetch", "prepare", "ways", "build"];

function stages(): Stage[] {
  return NAMES.map((name) => {
    const code = join(dir, "code", `${name}.ts`);
    if (!existsSync(code)) writeFileSync(code, `// ${name}\n${STEP}`);
    const reads = { prepare: ["tiger", "osm"], ways: ["osm"] }[name as "prepare" | "ways"];
    return { name, code: [code], run: (work: string, city: string) => ["bun", code, work, name, maps(), city], stamped: name === "build", ...(reads ? { reads } : {}) };
  });
}

function city(bounds: number[]): void {
  writeFileSync(join(source(), "city.json"), JSON.stringify({ v: 2, name: CITY, label: "Test", centre: [-80.19, 25.77], bounds, tiger: { counties: ["12086"] } }));
}

const A = [-1056, -1056, 1056, 1056];
const B = [-2080, -2080, 2080, 2080];
const run = (o: CityRun = {}): ReturnType<typeof runCity> =>
  runCity(CITY, { stages: stages(), source: source(), mapdata: join(dir, "mapdata"), maps: maps(), cwd: dir, ...o });
const map = (): string => readFileSync(join(maps(), `${CITY}.snmap`), "utf8");
const keys = (work: string): Record<string, string> => JSON.parse(readFileSync(join(work, "stages.json"), "utf8")) as Record<string, string>;
const current = (): string | null => (existsSync(join(dir, "mapdata", CITY, "current")) ? readlinkSync(join(dir, "mapdata", CITY, "current")) : null);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "map-stages-"));
  mkdirSync(source());
  mkdirSync(join(dir, "code"));
  city(A);
});
afterEach(() => {
  delete process.env.FAIL;
  delete process.env.EXTRACT;
  delete process.env.FAIL_AFTER;
  rmSync(dir, { recursive: true, force: true });
});

test("cut A, then B, then A again builds A again and serves it", () => {
  const a = run();
  expect([a.ran, map()]).toEqual([NAMES, a.cut]);
  city(B);
  const b = run();
  expect([b.ran, map()]).toEqual([NAMES, b.cut]);
  city(A);
  const again = run();
  expect([again.ran, map(), again.current, current()]).toEqual([["build"], a.cut, true, join(a.cut, CITY)]);
  expect(run().ran).toEqual([]);
});

test("a map written over by another tool is built again", () => {
  run();
  writeFileSync(join(maps(), `${CITY}.snmap`), "another map");
  expect(run().ran).toEqual(["build"]);
});

test("an authored file deleted from the city leaves no copy in the work folder", () => {
  writeFileSync(join(source(), "places.json"), "[]");
  writeFileSync(join(source(), "world.json"), "{}");
  mkdirSync(join(source(), "look/deep"), { recursive: true });
  for (const f of ["a.json", "b.json", "deep/c.json"]) writeFileSync(join(source(), "look", f), "{}");
  const { work } = run();
  expect(["ruins/places.authored.json", "world/authored.json", "look/b.json", "look/deep/c.json"].map((f) => existsSync(join(work, f)))).toEqual([true, true, true, true]);
  rmSync(join(source(), "places.json"));
  rmSync(join(source(), "look/b.json"));
  rmSync(join(source(), "look/deep"), { recursive: true });
  run();
  expect(["ruins/places.authored.json", "world/authored.json", "look/a.json", "look/b.json", "look/deep"].map((f) => existsSync(join(work, f)))).toEqual([false, true, true, false, false]);
  rmSync(join(source(), "look"), { recursive: true });
  run();
  expect(existsSync(join(work, "look"))).toBe(false);
});

test("a stage that dies leaves its key and every later key unset", () => {
  const { work } = run();
  appendFileSync(join(dir, "code/prepare.ts"), "// changed\n");
  process.env.FAIL = "prepare";
  expect(() => run()).toThrow("prepare failed with 3");
  expect(Object.keys(keys(work))).toEqual(["frame", "fetch"]);
  delete process.env.FAIL;
  expect(run().ran).toEqual(["prepare", "ways", "build"]);
});

test("current moves only when every stage of the cut stands done", () => {
  const part = run({ to: "prepare" });
  expect([part.current, current()]).toEqual([false, null]);
  const a = run();
  expect([a.ran, a.current, current()]).toEqual([["ways", "build"], true, join(a.cut, CITY)]);
  city(B);
  const b = run({ to: "ways" });
  expect([b.current, current()]).toEqual([false, join(a.cut, CITY)]);
  expect(run().current).toBe(true);
  // Cut A's keys still stand, but the map is B's, so A is not done.
  city(A);
  expect([run({ to: "ways" }).current, current()]).toEqual([false, join(b.cut, CITY)]);
});

// As tools/maps/kit.ts unpack leaves a built cut: no downloads, no map, every key but the build's.
function kitted(work: string): void {
  rmSync(join(work, "raw"), { recursive: true });
  mkdirSync(join(work, "raw"));
  writeFileSync(join(work, "raw/KIT"), "commit\n");
  const { build: _, ...made } = keys(work);
  writeFileSync(join(work, "stages.json"), JSON.stringify(made));
  rmSync(maps(), { recursive: true });
  writeFileSync(join(work, "runs.log"), "");
}
const log = (work: string): string[] => readFileSync(join(work, "runs.log"), "utf8").split("\n").filter(Boolean);

test("a build over a stage out of date leaves the city's map and stamp alone", () => {
  const { work } = run();
  const made = (): string[] => [map(), readFileSync(join(maps(), CITY, "stamp.json"), "utf8")];
  const before = made();
  appendFileSync(join(dir, "code/prepare.ts"), "// changed\n");
  writeFileSync(join(work, "runs.log"), "");
  for (const o of [{ only: "build" }, { from: "build" }, { from: "ways" }]) expect(() => run(o)).toThrow(/prepare(, ways)? out of date for this build.*--from prepare/);
  expect(made()).toEqual(before);
  expect(log(work)).toEqual(["ways"]);
  expect(run().ran).toEqual(["prepare", "ways", "build"]);
});

test("a kit's work folder builds the map alone, and fetches first for a stage on the downloads", () => {
  const { work } = run();
  kitted(work);
  expect(run().ran).toEqual(["build"]);
  expect(existsSync(join(work, "raw/KIT"))).toBe(true);
  appendFileSync(join(dir, "code/ways.ts"), "// changed\n");
  expect(run().ran).toEqual(["ways", "build"]);
  expect([existsSync(join(work, "raw/KIT")), existsSync(join(work, "raw/fetched"))]).toEqual([false, true]);
  expect(log(work)).toEqual(["build", "fetch", "ways", "build"]);
});

test("a kit's source fetched anew with other bytes runs again from its first reader", () => {
  const { work } = run();
  kitted(work);
  appendFileSync(join(dir, "code/ways.ts"), "// changed\n");
  process.env.EXTRACT = "newer";
  expect(run().ran).toEqual(["prepare", "ways", "build"]);
  expect(log(work)).toEqual(["fetch", "prepare", "ways", "build"]);
  expect(run().ran).toEqual([]);
});

test("a kit's fetch cut short still holds the next to the kit's own records", () => {
  const { work } = run();
  kitted(work);
  appendFileSync(join(dir, "code/ways.ts"), "// changed\n");
  process.env.EXTRACT = "newer";
  process.env.FAIL_AFTER = "fetch";
  expect(() => run()).toThrow("fetch failed with 4");
  delete process.env.FAIL_AFTER;
  expect(run().ran).toEqual(["prepare", "ways", "build"]);
  expect(existsSync(join(work, "raw/downloads.kit.json"))).toBe(false);
});

test("a changed kit source stops a run that cannot reach its first reader", () => {
  const { work } = run();
  kitted(work);
  process.env.EXTRACT = "newer";
  expect(() => run({ only: "ways" })).toThrow("osm fetched again differs from what the kit's layers were made from (downloads.json); run bun tools/maps/city.ts testcity --from prepare");
  expect(Object.keys(keys(work))).toEqual(["frame", "fetch"]);
  expect(run().ran).toEqual(["prepare", "ways", "build"]);
});

test("a download's job comes from its name, and an extract without SHA-256 holds to its MD5", async () => {
  const { changedJobs } = await import("../../tools/maps/city.ts");
  const settings = { nlcd: { file: "nlcd2021.tif" } };
  const kept = { "osm/extract": { bytes: 5, md5: "a" }, "nlcd2021.tif": { bytes: 1, sha256: "n" }, "dem/x.tif": { bytes: 2, sha256: "d" } };
  expect(changedJobs(kept, { ...kept, "osm/extract": { bytes: 5, md5: "a", sha256: "s" } }, settings)).toEqual([]);
  expect(changedJobs(kept, { ...kept, "osm/extract": { bytes: 5, md5: "b", sha256: "s" }, "nlcd2021.tif": { bytes: 1, sha256: "m" } }, settings)).toEqual(["nlcd", "osm"]);
  expect(changedJobs(kept, { ...kept, "dem/y.tif": { bytes: 2, sha256: "e" }, "tl_2025_1_roads.zip": { bytes: 1, sha256: "t" } }, settings)).toEqual(["dem", "tiger"]);
});

test("a kit reuses prepared layers after a retry change until a source changes", () => {
  const steps = stages();
  const osm = join(dir, "code/osm_local.py");
  steps.find((s) => s.name === "fetch")!.code.push(osm);
  const old = "args = ['curl', '-sSL', '--retry', '5', '-o', output, url]\n";
  const retry = old.replace("'-o'", "'--retry-all-errors', '-o'");
  writeFileSync(osm, old);
  const { work } = run({ stages: steps });
  rmSync(join(work, "raw"), { recursive: true });
  mkdirSync(join(work, "raw"));
  writeFileSync(join(work, "raw/KIT"), "commit\n");
  const held = keys(work);
  delete held.build;
  writeFileSync(join(work, "stages.json"), JSON.stringify(held));
  writeFileSync(join(work, "runs.log"), "");

  writeFileSync(osm, retry);
  expect(run({ stages: steps }).ran).toEqual(["build"]);
  expect(keys(work).fetch).toBe(held.fetch);
  expect(existsSync(join(work, "raw/fetched"))).toBe(false);

  writeFileSync(osm, retry.replace(", url]", ", another_url]"));
  expect(run({ stages: steps }).ran).toEqual(["fetch", "prepare", "ways", "build"]);
  expect(existsSync(join(work, "raw/KIT"))).toBe(false);
  expect(readFileSync(join(work, "runs.log"), "utf8").trim().split("\n")).toEqual(["build", "fetch", "prepare", "ways", "build"]);
});

test("another cut by --bounds runs up to the build in its own folder and moves nothing", () => {
  const a = run();
  const other = run({ bounds: B });
  expect([other.cut === a.cut, other.ran, other.current, map(), current()]).toEqual([false, NAMES.slice(0, -1), false, a.cut, join(a.cut, CITY)]);
  expect(() => run({ bounds: B, to: "build" })).toThrow("stop before the build");
});

test("a map built by its city's name is named for the city, not the current link", async () => {
  const { mapNameOf } = await import("../../tools/mapworld/build.ts");
  const cut = join(dir, "work", "abc", CITY);
  mkdirSync(cut, { recursive: true });
  symlinkSync(join("abc", CITY), join(dir, "work", "current"));
  expect([mapNameOf(CITY), mapNameOf(join(dir, "work", "current")), mapNameOf(cut)]).toEqual([CITY, CITY, CITY]);
});
