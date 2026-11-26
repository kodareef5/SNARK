// `bun run check`: the policy rules, the type checks and the tests. Whole, it is the gate a branch passes to land. Given
// folders or files, or the smoke set, it is a look while building.
//
//   bun run check                      policy, types and every fast test: the gate. One runs at a time on a machine
//   bun run check -- tests/vehicles    policy, types and the fast tests of those folders and files; not the gate
//   bun run check -- --smoke           policy, types and the twenty files of tests/smoke.txt; not the gate
//   bun run check -- --slow            the gate, then the slow tier (`*.slow.test.ts`); the integrator runs it on main
//   bun run slow                       the slow tier alone
//   --workers=N or SNARK_CHECK_WORKERS=N sets the test workers. Unset, the gate takes the least of 16, the cores less
//                                      two and free memory over 0.6 GB; a look takes four at most
//   --no-art                           lets the tests that need the art be skipped where it is not installed
//   --strict                           fails a gate that cost over this machine's baseline, instead of warning
//
// Art that is missing or stale is installed first, from what the machine already holds (tools/release/media.py). A run
// that still skipped tests for it is not a gate and fails. The tests' whole output is kept in .cache/check/last.log
// (last-slow.log for the slow tier) and the failing tests in .cache/check/last-failures.txt, one to a line.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SLOW_TEST, TEST_WATCH, TEST_WORKERS, hungAfter } from "../tests/fixtures/load.ts";
import { artInstalled, artState, unreleasedHere } from "./art/installed.ts";
import { footprint } from "./memory.ts";
import { dynamicLoads, IMPORT, madeArrays, stripComments } from "./policy.ts";
import { baselineFile, compare, history, machineKey, remember, RUNS_NEEDED } from "./check-baseline.ts";
import { failuresOf, verdict, writeWhole } from "./check-report.ts";
import { born, freeMemory, lockFile, release, take, workersFor } from "./check-lock.ts";
import { pick, smokeList } from "./check-pick.ts";

const ROOT = resolve(import.meta.dir, "..");

// The fast tier has no budget in CPU-seconds: each machine weighs it against its own last runs (D794,
// tools/check-baseline.ts). One number for every machine held a Ryzen to what a Mac spent, and sent agents after it.
/**
 * The memory, in bytes, a test worker's JavaScriptCore is told the machine has, as it sizes its heap. Told the machine's
 * own (24 GB here), it lets a file's garbage grow to what the file holds live before collecting it, and the heaviest
 * files held twice what they needed. Told this, it collects at a quarter to a half over: the 30 costliest files held
 * half as much at most and a third less on average, for 3% more CPU-seconds.
 */
const WORKER_HEAP_RAM = 500_000_000;
/** The client zones that hold no tests, and where each one's logic goes. Their line counts are printed and fail nothing. */
const UNTESTED: readonly (readonly [dir: string, logic: string])[] = [
  ["client/shell", "client/core"],
  ["client/voice", "client/core/voice"],
  ["client/assets", "client/core/assets"],
  ["client/sound", "client/core/sound"],
  ["client/wiki", "client/core/wiki"],
  ["client/admin", "client/core/admin"],
  ["client/drops", "client/core/drops"],
  ["client/debug", "client/core/debug"],
];
const ALLOWED_DEV_PACKAGES = new Set(["typescript", "@types/bun"]);

interface Zone {
  dir: string;
  /** Zones this zone may import from. "*" means any. */
  may: string[] | "*";
  /** May import `bun:*` / `node:*` built-ins. */
  builtins: boolean;
}

const ZONES: Zone[] = [
  { dir: "shared", may: ["shared"], builtins: false },
  { dir: "content", may: ["shared", "content"], builtins: false },
  { dir: "client/core", may: ["shared", "content", "client/core"], builtins: false },
  { dir: "client/voice", may: ["shared", "client/core", "client/voice"], builtins: false },
  { dir: "client/assets", may: ["shared", "client/core", "client/assets"], builtins: false },
  { dir: "client/sound", may: ["shared", "client/core", "client/sound"], builtins: false },
  { dir: "client/city", may: ["shared", "client/core", "client/city"], builtins: false },
  { dir: "client/shell", may: ["shared", "content", "client/core", "client/voice", "client/assets", "client/sound", "client/city", "client/debug", "client/shell"], builtins: false },
  { dir: "client/entry", may: ["shared", "client/core", "client/entry", "client/assets", "client/city", "client/shell"], builtins: false },
  { dir: "client/wiki", may: ["shared", "client/core", "client/wiki"], builtins: false },
  { dir: "client/admin", may: ["shared", "client/core", "client/admin"], builtins: false },
  { dir: "client/drops", may: ["shared", "client/core", "client/admin", "client/drops"], builtins: false },
  { dir: "client/debug", may: ["shared", "client/core", "client/debug"], builtins: false },
  { dir: "server", may: ["shared", "content", "server", "server/api"], builtins: true },
  // What a module is written against. It names nothing of the server's own.
  { dir: "server/api", may: ["shared", "server/api"], builtins: false },
  { dir: "modules", may: ["shared", "server/api", "modules"], builtins: false },
  // A player that is a program: headless core on a socket, with tools in place of keys. It names nothing of the server's.
  { dir: "agent", may: ["shared", "content", "client/core", "agent", "grunt"], builtins: true },
  // A Pi package that plays a game as a player, through the grunt protocol (D879). It names nothing of the game's: a game
  // speaks its protocol. Pi loads it under Node, so it uses Node's built-ins and none of Bun's.
  { dir: "grunt", may: ["grunt"], builtins: true },
  { dir: "tools", may: "*", builtins: true },
  { dir: "tools/wiki/stage", may: ["shared", "content", "client/core", "client/assets", "client/city", "client/shell", "tools", "tools/wiki/stage"], builtins: false },
  // Tests never touch the DOM zones. Logic that needs a test belongs in client/core.
  { dir: "tests", may: ["shared", "content", "client/core", "server", "server/api", "modules", "agent", "grunt", "tools", "tests"], builtins: true },
];

/** Directories where results must be bit-identical on JavaScriptCore and V8. */
const DETERMINISTIC_DIRS = ["shared/sim", "shared/world", "shared/math", "shared/anim"];
/** Files that make a pack's coarser levels, which are committed: a Mac and a Linux machine must make the same bytes. */
const DETERMINISTIC_FILES = ["tools/pack/simplify.ts", "tools/pack/error.ts", "tools/pack/surface.ts"];
const NONDETERMINISTIC = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*|\bDate\.now\b|\bperformance\.now\b/;
/** Seeded randomness only, wherever game state is produced. */
const SEEDED_ONLY_DIRS = ["shared", "server", "client/core", "content", "modules"];
/** The frame's build and the shell's work each frame, where an array made on every call is garbage every frame (madeArrays). */
const FRAME_DIRS = ["client/core/render", "client/core/details", "client/shell"];
const MADE_ARRAY = {
  destructured: "`[a, b] = [x, y]` makes an array each time it runs, even in Safari's top tier; write a plain assignment each (`a = x; b = y;`, `const a = x, b = y;`)",
  set: "`t.set([x, y], k)` makes an array each time it runs; write the elements (`t[k] = x; t[k + 1] = y;`)",
  for: "`for (const [k, v] of …)` makes an array for each entry of a Map; walk `map.keys()` or `map.values()` and look up the rest, or a list by index",
} as const;

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** A file's path from the repository's root, with / between its parts on every system, as the zones and the rules name them. */
function repoPath(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

function zoneOf(rel: string): Zone | undefined {
  let best: Zone | undefined;
  for (const z of ZONES) {
    if ((rel === z.dir || rel.startsWith(z.dir + "/")) && (!best || z.dir.length > best.dir.length)) best = z;
  }
  return best;
}

/** A test given a time limit of its own: a number or `{ timeout }` after its body, or a default set outside the preload. */
const OWN_TIMEOUT = /^\s*\}\s*,\s*(\d[\d_]*\s*\)|\{\s*timeout\b)|\b(setDefaultTimeout|jest\.setTimeout)\s*\(/m;

/** The one file that may load a file it is given the name of: an operator's modules. */
const MAY_LOAD_BY_NAME = new Set(["server/main.ts"]);


function checkPolicy(): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    fail(`package.json: runtime dependencies are not allowed (${Object.keys(pkg.dependencies).join(", ")})`);
  }
  for (const name of Object.keys(pkg.devDependencies ?? {})) {
    if (!ALLOWED_DEV_PACKAGES.has(name)) {
      fail(`package.json: development package "${name}" is not allow-listed in tools/check.ts`);
    }
    if (/playwright|puppeteer|selenium|webdriver|cypress|testcafe|nightwatch/i.test(name)) {
      fail(`package.json: "${name}" is browser automation; see planning/quality/testing.md`);
    }
  }
  const pinned = pkg.engines?.bun;
  if (pinned !== Bun.version) fail(`Bun ${Bun.version} is running but package.json pins ${pinned}`);

  if (existsSync(join(ROOT, "tests/browser"))) {
    fail("tests/browser exists: there is no browser test suite; see planning/quality/testing.md");
  }

  const files = ZONES.flatMap((z) => walk(join(ROOT, z.dir))).filter((f) => f.endsWith(".ts"));
  const lines = new Map(UNTESTED.map(([dir]) => [dir, 0]));

  for (const file of files) {
    const rel = repoPath(file);
    const zone = zoneOf(rel)!;
    const src = stripComments(readFileSync(file, "utf8"));

    if (/\.(spec|e2e)\.ts$/.test(rel)) fail(`${rel}: spec/e2e files are not used here`);
    if (/^tests\/(unit|integration)\//.test(rel)) fail(`${rel}: tests live by area (tests/README.md); move it with: bun tools/test-area.ts --move --paths`);
    if (zone.dir === "tests" && rel !== "tests/fixtures/preload.ts" && OWN_TIMEOUT.test(src)) {
      fail(`${rel}: a test sets its own time limit; every test has the one in tests/fixtures/load.ts`);
    }
    const logic = UNTESTED.find(([dir]) => dir === zone.dir)?.[1];
    if (logic !== undefined) {
      if (rel.endsWith(".test.ts")) fail(`${rel}: ${zone.dir} has no tests; move the logic into ${logic}`);
      lines.set(zone.dir, lines.get(zone.dir)! + src.split("\n").filter((l) => l.trim().length > 0).length);
    }
    if (zone.dir === "grunt" && (/\bBun\./.test(src) || /from\s*['"]bun(:[^'"]*)?['"]/.test(src))) {
      fail(`${rel}: grunt runs in Pi under Node, so it may not use Bun's own APIs`);
    }

    // An import the rules below cannot read the name of is an import they cannot judge.
    const named = (src.match(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g) ?? []).length;
    if (zone.may !== "*" && dynamicLoads(src) > named && !MAY_LOAD_BY_NAME.has(rel)) fail(`${rel}: import() must name its file as a plain string, and require() is not used here`);

    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]!;
      if (spec.startsWith(".")) {
        const target = repoPath(resolve(dirname(file), spec));
        const tz = zoneOf(target);
        if (!tz) fail(`${rel}: imports "${spec}" which is outside every zone`);
        else if (zone.may !== "*" && !zone.may.includes(tz.dir)) {
          fail(`${rel}: zone ${zone.dir} may not import from ${tz.dir} ("${spec}")`);
        }
        if (!spec.endsWith(".ts") && !spec.endsWith(".json")) fail(`${rel}: import "${spec}" needs an explicit .ts extension`);
      } else if (/^(bun|node):|^bun$/.test(spec)) {
        if (!zone.builtins) fail(`${rel}: zone ${zone.dir} may not import built-in "${spec}"`);
      } else {
        fail(`${rel}: bare package import "${spec}" (zero runtime packages)`);
      }
    }

    if (DETERMINISTIC_DIRS.some((d) => rel.startsWith(d + "/")) || DETERMINISTIC_FILES.includes(rel)) {
      const hit = src.match(NONDETERMINISTIC);
      if (hit) fail(`${rel}: "${hit[0]}" is not bit-reproducible across engines; use shared/math`);
    }
    if (SEEDED_ONLY_DIRS.some((d) => rel.startsWith(d + "/")) && /\bMath\.random\b/.test(src)) {
      fail(`${rel}: Math.random is not allowed; use the seeded Rng in shared/rng.ts`);
    }
    if (FRAME_DIRS.some((d) => rel === d || rel.startsWith(d + "/"))) for (const hit of madeArrays(src)) fail(`${rel}:${hit.line}: ${MADE_ARRAY[hit.what]}`);
  }

  for (const [dir, count] of lines) console.log(`  ${`${dir.slice("client/".length)} size`.padEnd(12)} ${count} lines`);
}

/** What this check has started and not yet seen end, stopped with it if it is stopped. */
const children = new Set<{ kill(): void }>();

/** `cpu` is the CPU-seconds of the process and of the processes it waited for. */
async function run(cmd: string[], quiet: boolean, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; out: string; cpu: number }> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, env, stdout: quiet ? "pipe" : "inherit", stderr: quiet ? "pipe" : "inherit" });
  children.add(proc);
  const out = quiet ? (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text()) : "";
  const ok = (await proc.exited) === 0;
  children.delete(proc);
  const used = proc.resourceUsage()?.cpuTime;
  return { ok, out, cpu: used ? Number(used.user + used.system) / 1e6 : 0 };
}

async function checkTypes(): Promise<void> {
  const tsc = join(ROOT, "node_modules/.bin/tsc");
  const zones = ZONES.filter((z) => walk(join(ROOT, z.dir)).some((f) => f.endsWith(".ts")));
  // Each zone keeps what it last found in .cache, and checks again only the files a change can reach.
  const kept = (z: Zone): string => join(ROOT, ".cache/tsc", `${z.dir.replaceAll("/", "-")}.tsbuildinfo`);
  const results = await Promise.all(zones.map((z) => run([tsc, "-p", join(z.dir, "tsconfig.json"), "--incremental", "--tsBuildInfoFile", kept(z)], true)));
  results.forEach((r, i) => {
    if (!r.ok) fail(`type check failed in ${zones[i]!.dir}:\n${r.out.trim()}`);
  });
}

/**
 * The page's script built as the build builds it, no art, and held to its shape (tools/page-script.ts): the first frame
 * waits for main.js and page.js alone, and every late file takes what it shares with them from page.js.
 */
async function checkScript(): Promise<void> {
  const r = await run([process.execPath, join(ROOT, "tools/page-script.ts"), "--check"], true);
  if (!r.ok) fail(`the page's script is not as the first frame's budget needs it:\n${r.out.trim()}`);
}

/** What the core pack is built from: the code that builds it and the art. */
const PACK_FROM = ["shared", "content", "client/core", "tools", "assets"];

/** Every file the core pack may be built from, by name, size and date, as one hash: a tenth of a second for 10,000 files. */
function packKey(): string {
  const hash = new Bun.CryptoHasher("sha1").update(Bun.version);
  for (const file of PACK_FROM.flatMap((d) => walk(join(ROOT, d)))) {
    const s = statSync(file);
    hash.update(`${file}\0${s.size}\0${s.mtimeMs}\n`);
  }
  return hash.digest("hex");
}

/**
 * The core pack, built here once for the test files instead of once in each of a hundred (tests/fixtures/pack.ts), and
 * kept in .cache/check. Building it takes five to ten seconds, so a look takes the kept one while no file it may be
 * built from has changed. The gate always builds its own.
 */
async function sharedPack(): Promise<Record<string, string>> {
  try {
    const { CORE_PACK_FILE } = await import("../tests/fixtures/pack.ts");
    const file = join(ROOT, ".cache/check/core.snpk");
    const key = packKey();
    if (!look || !existsSync(file) || !existsSync(`${file}.key`) || readFileSync(`${file}.key`, "utf8") !== key) {
      const { buildCorePack } = await import("./pack/build.ts");
      writeWhole(file, buildCorePack());
      writeWhole(`${file}.key`, key);
    }
    return { [CORE_PACK_FILE]: file };
  } catch {
    // Then each test file builds its own, and says what is wrong.
    return {};
  }
}

type Tier = "fast" | "slow";
/** Measured ordering for a clean checkout, before it has a passing fast tier of its own to learn from. */
const SEED_TIMES = join(ROOT, "tools/test-times.json");

const args = process.argv.slice(2);
const WORKERS_ARG = /^--workers=([1-9]\d*)$/;
const FLAGS = new Set(["--slow", "--slow-only", "--strict", "--no-art", "--smoke"]);
const usage = (why: string): never => {
  console.error(`${why}\nusage: bun run check -- [tests/<area> | tests/<area>/<file>.test.ts ...] [--smoke] [--slow | --slow-only] [--strict] [--no-art] [--workers=N]   (or SNARK_CHECK_WORKERS=N)`);
  process.exit(2);
};
/** Folders and files of tests to run in place of the whole fast tier. */
const asked = args.filter((a) => !a.startsWith("--")).map((a) => repoPath(resolve(ROOT, a)));
const smoke = args.includes("--smoke");
/** A look while building: some tests, at most four workers, no lock. Not the gate. */
const look = smoke || asked.length > 0;
const unknown = args.filter((a) => a.startsWith("--") && !FLAGS.has(a) && !WORKERS_ARG.test(a));
if (unknown.length > 0) usage(`${unknown.join(" ")}: not an option`);
if (!/^([1-9]\d*)?$/.test(process.env.SNARK_CHECK_WORKERS ?? "")) usage("SNARK_CHECK_WORKERS is not a count");
if (look && args.some((a) => a === "--slow" || a === "--slow-only" || a === "--strict")) usage("--slow, --slow-only and --strict go with the whole check: name a slow file to run it");
const slowOnly = args.includes("--slow-only");
/** A fast tier over this machine's baseline fails instead of only saying so: for a coordinator or CI that wants it. */
const strict = args.includes("--strict");
/** The test workers asked for by --workers=N or SNARK_CHECK_WORKERS, which the check then does not size itself. */
const askedWorkers = Number(args.map((a) => WORKERS_ARG.exec(a)?.[1]).find(Boolean) ?? (process.env.SNARK_CHECK_WORKERS || 0));
/** The most workers a look runs: it shares the machine with the others' looks. */
const LOOK_WORKERS = 4;

const noArt = args.includes("--no-art");
/** Installs art that is missing or stale from what this machine already holds, and says so. It downloads nothing. */
function installArt(): void {
  const stale = artState().missing.length;
  if (stale === 0) return;
  let said = "not installed: python3 was not found";
  try {
    const r = Bun.spawnSync(["python3", join(ROOT, "tools/release/media.py"), "art", "--offline"], { stdout: "pipe", stderr: "pipe" });
    said = r.exitCode === 0 ? `installed ${stale} archives from this machine's shared store` : `not installed. ${r.stderr.toString().trim().split("\n").pop()}`;
  } catch {
    // Then the art stays as it is.
  }
  console.log(`art          ${said}`);
}
if (!noArt) installArt();
// Asked here and not taken from tools/art/source.ts, which the tools loaded below read once as they load.
const ART = artInstalled();

/** Each test file's milliseconds in the tier's last passing run, as `bun test --timings` reads them. */
const timesOf = (tier: Tier): string => join(ROOT, `.cache/${tier === "fast" ? "test-times" : "slow-test-times"}.json`);

function keepTimes(file: string, junit: string): void {
  const files: Record<string, number> = {};
  for (const m of junit.matchAll(/<testsuite name="([^"]+)"[^>]*? time="([\d.]+)"/g)) files[m[1]!] = Math.round(Number(m[2]) * 1000);
  mkdirSync(dirname(file), { recursive: true });
  // Whole or not at all, for a check started beside this one.
  writeFileSync(`${file}.${process.pid}`, JSON.stringify({ version: 1, files }));
  renameSync(`${file}.${process.pid}`, file);
}

const testFiles = walk(join(ROOT, "tests")).filter((f) => f.endsWith(".test.ts"));
/** Tests passed, and those skipped in the files that mark tests as needing the art (tests/fixtures/needs-art.ts). */
const tally = { passed: 0, unart: 0, unpy: 0 };
/** The output each tier's tests left, and every failing test, for whoever reads the run afterwards. */
const logs: string[] = [];
const failures: string[] = [];
const needsArt = new Set(ART ? [] : testFiles.filter((f) => readFileSync(f, "utf8").includes("fixtures/needs-art.ts")).map(repoPath));
/** The files whose tests need the map data stages' venv, where it is not here (tests/fixtures/needs-python.ts). */
const needsPython = new Set(existsSync(join(ROOT, "tools/mapdata/.venv/bin/python")) ? [] : testFiles.filter((f) => readFileSync(f, "utf8").includes("fixtures/needs-python.ts")).map(repoPath));

/** `path`, and where it is now if it is a test's path from before the tests were sorted into areas (tools/test-area.ts). */
function movedTo(path: string): string {
  const map = join(ROOT, "tools/test-areas.json");
  const to = existsSync(map) ? (JSON.parse(readFileSync(map, "utf8")) as Record<string, string>)[path.replace(/^tests\//, "")] : undefined;
  return to ? `${path} (now tests/${to})` : path;
}

/** The test files a look runs; undefined for the whole tier. */
const picked = ((): string[] | undefined => {
  if (!look) return undefined;
  const all = testFiles.map(repoPath);
  let listed: string[] = [];
  if (smoke) {
    listed = smokeList(readFileSync(join(ROOT, "tests/smoke.txt"), "utf8"));
    const gone = listed.filter((f) => !all.includes(f));
    if (gone.length > 0) usage(`tests/smoke.txt names no test file at ${gone.join(", ")}`);
  }
  const found = pick([...listed, ...asked], all, SLOW_TEST);
  if (found.none.length > 0) usage(`no test file at ${found.none.map(movedTo).join(", ")}`);
  return found.files;
})();

/** The most the workers held together at one moment, and what each was running then, heaviest first. */
interface Held {
  most: number;
  files: [string, number][];
}

/** Adds the workers in `dir` up, each named there by the preload's files, and keeps the most in `held`. */
function weigh(dir: string, held: Held): void {
  const running = new Map<number, string>();
  for (const name of readdirSync(dir)) {
    const pid = parseInt(name);
    if (!running.has(pid)) running.set(pid, "");
    if (!name.endsWith(".now")) continue;
    try {
      running.set(pid, repoPath(readFileSync(join(dir, name), "utf8").split("\t")[0]!));
    } catch {
      // Removed as its file ended.
    }
  }
  const files: [string, number][] = [...running].map(([pid, file]) => [file, footprint(pid)]);
  const sum = files.reduce((n, [, bytes]) => n + bytes, 0);
  if (sum > held.most) Object.assign(held, { most: sum, files: files.sort((a, b) => b[1] - a[1]) });
}

/** Each test file's CPU-seconds, from what the preload wrote in `dir`. */
function fileCpu(dir: string): [string, number][] {
  const out: [string, number][] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".tsv"))) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      const [file, seconds] = line.split("\t");
      if (file && seconds) out.push([repoPath(file), Number(seconds)]);
    }
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/**
 * Stops each worker in `dir` whose test has run a quarter past its hang limit, and says which. Bun's own timeout ends a test
 * that waits, but not one that never yields, such as a loop with no end. The limit is the greatest the load has given it
 * while the test ran, kept in `most` by what the worker wrote.
 */
function stopHung(dir: string, workers: number, most: Map<string, number>, stopped: string[]): void {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".now"))) {
    let line = "";
    try {
      line = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const [file, n, since, limit] = line.split("\t");
    // Read while its worker was rewriting it.
    if (!since) continue;
    const ran = Date.now() - Number(since);
    const allowed = Math.max(most.get(line) ?? Number(limit), hungAfter(file!, workers));
    most.set(line, allowed);
    if (ran < 1.25 * allowed) continue;
    rmSync(join(dir, name), { force: true });
    const pid = Number(name.slice(0, -".now".length));
    // Only a test worker of this run: a worker that crashed leaves its file, and its number may since be another's.
    if (!Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString().includes("--test-worker")) continue;
    process.kill(pid, "SIGKILL");
    stopped.push(`${repoPath(file!)}: ${n === "0" ? "loading it" : `its test number ${n}`} ran ${(ran / 1000).toFixed(0)} s, past its hang limit of ${(allowed / 1000).toFixed(0)} s, without yielding; its worker was stopped`);
  }
}

/** Runs the tests of `tier`, with `env` from sharedPack, leaving its reports in `dir`. */
async function checkTests(tier: Tier, dir: string, env: Record<string, string>): Promise<void> {
  const some = picked;
  const files = some?.length ?? testFiles.filter((f) => SLOW_TEST.test(f) === (tier === "slow")).length;
  if (files === 0) return;
  // Each test file in a worker of its own: about half the time, and one file cannot lean on what another left behind.
  const free = freeMemory();
  const sized = some ? LOOK_WORKERS : workersFor(availableParallelism(), free);
  const workers = Math.min(askedWorkers ? (some ? Math.min(askedWorkers, LOOK_WORKERS) : askedWorkers) : sized, files);
  console.log(`  ${workers} workers for ${files} test files${askedWorkers || some ? "" : `: ${availableParallelism()} cores, ${(free / 1e9).toFixed(1)} GB free`}`);
  const report = join(dir, `${tier}.xml`);
  const watch = join(dir, `${tier}-watch`);
  mkdirSync(watch);
  const times = timesOf(tier);
  // The slowest files start first, by their times in the last run, or the last of them may start when the rest are done.
  const timed = existsSync(times) ? ["--timings", times] : tier === "fast" ? ["--timings", SEED_TIMES] : [];
  const only = some ? some.map((f) => `./${f}`) : tier === "slow" ? [".slow.test.ts"] : ["--path-ignore-patterns=**/*.slow.test.ts"];
  const stopped: string[] = [];
  const most = new Map<string, number>();
  const watching = setInterval(() => stopHung(watch, workers, most, stopped), 1000);
  const held: Held = { most: 0, files: [] };
  // A worker's memory can rise and fall within a second.
  const weighing = setInterval(() => weigh(watch, held), 250);
  const r = await run(["bun", "test", `--parallel=${workers}`, ...timed, "--reporter=junit", `--reporter-outfile=${report}`, ...only], true, { ...process.env, ...env, [TEST_WORKERS]: String(workers), [TEST_WATCH]: watch, BUN_JSC_forceRAMSize: String(WORKER_HEAP_RAM) });
  clearInterval(watching);
  clearInterval(weighing);
  stopped.forEach(fail);
  const junit = existsSync(report) ? readFileSync(report, "utf8") : "";
  const log = `.cache/check/last${tier === "slow" ? "-slow" : ""}.log`;
  writeWhole(join(ROOT, log), r.out);
  logs.push(log);
  failures.push(...failuresOf(junit, r.out), ...stopped.map((s) => s.replace(": ", "\t(stopped)\t")));
  for (const m of junit.matchAll(/<testsuite name="([^"]+)" file="\1"[^>]*? skipped="(\d+)"/g)) if (needsArt.has(m[1]!)) tally.unart += Number(m[2]);
  else if (needsPython.has(m[1]!)) tally.unpy += Number(m[2]);
  const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;
  const heaviest = held.files.filter(([file]) => file).slice(0, 3);
  const weighed = `${gb(held.most)} at most in the workers together${heaviest.length > 0 ? `\n  the heaviest workers then ran ${heaviest.map(([file, bytes]) => `${file} (${gb(bytes)})`).join(", ")}` : ""}`;
  if (!r.ok) {
    console.log(`  ${weighed}`);
    fail(`${tier} tests failed:\n${r.out.trim()}`);
    return;
  }
  // A run of some files says nothing of the rest: their times and CPU-seconds stay as the last whole run left them.
  if (!some) {
    keepTimes(times, junit);
    // Each file's CPU-seconds beside its time, costliest first, for whoever looks for what the tier spends.
    writeFileSync(join(ROOT, `.cache/${tier}-test-cpu.json`), JSON.stringify(Object.fromEntries(fileCpu(watch).map(([f, s]) => [f, Math.round(s * 10) / 10])), null, 1));
  }
  const counts = r.out.trim().split("\n").filter((l) => /^\s*\d+ (pass|fail|skip)/.test(l)).map((l) => l.trim());
  tally.passed += parseInt(counts.find((c) => c.endsWith(" pass")) ?? "0");
  console.log(`  ${counts.join(", ")}, ${r.cpu.toFixed(0)} CPU-seconds, ${weighed}`);
  if (tier === "fast" && !some) weighAgainstBaseline(r.cpu, fileCpu(watch), workers);
}

/**
 * Sets this run of the whole fast tier beside this machine's last ones (tools/check-baseline.ts) and keeps it among them.
 * Over the baseline it names the files that grew against their own runs, not the costliest, which are costly every day.
 * It warns and does not fail: a busy machine raises CPU-seconds too, and a check that fails on the neighbours sends its
 * author after tests that did not change. --strict fails it.
 */
function weighAgainstBaseline(cpu: number, files: [string, number][], workers: number): void {
  const key = machineKey(workers);
  const before = history(key);
  const now = { cpu: Math.round(cpu), files: Object.fromEntries(files.map(([f, s]) => [f, Math.round(s * 10) / 10])) };
  const c = compare(before, now);
  if (c.baseline === null) {
    console.log(`  baseline: learning this machine, run ${before.length + 1} of ${RUNS_NEEDED} (${baselineFile()})`);
  } else {
    const share = `${Math.round((cpu / c.baseline - 1) * 100)}%`;
    if (!c.over) console.log(`  baseline: ${c.baseline.toFixed(0)} CPU-seconds on this machine, this run ${share.startsWith("-") ? share : `+${share}`}`);
    else {
      const grew = c.grew.map((g) => `${g.file} ${g.was.toFixed(1)} -> ${g.now.toFixed(1)}`).join(", ");
      const says = `the fast tier took ${cpu.toFixed(0)} CPU-seconds, ${share} over this machine's baseline of ${c.baseline.toFixed(0)}, at load ${loadavg()[0]!.toFixed(0)}. Grew most against their own last runs: ${grew || "no one file"}`;
      if (strict) fail(says);
      else console.log(`  WARNING ${says}. A busy machine raises it too; this is not a failure (--strict makes it one)`);
    }
  }
  remember(key, now);
}

const step = async (name: string, fn: () => void | Promise<void>) => {
  const t = performance.now();
  await fn();
  console.log(`${name.padEnd(12)} ${((performance.now() - t) / 1000).toFixed(2)}s`);
};

const span = (ms: number): string => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/**
 * Waits until no other whole check runs on this machine and takes the lock (tools/check-lock.ts). Returns what lets it
 * go. Where the lock cannot be kept, the check says so and runs.
 */
async function oneAtATime(): Promise<() => void> {
  const file = lockFile();
  const me = { pid: process.pid, born: born(process.pid), checkout: ROOT, since: Date.now() };
  const from = Date.now();
  let told = 0;
  try {
    for (;;) {
      me.since = Date.now();
      const holder = take(file, me, born, (was) => console.log(`lock         taken over: ${was ? `process ${was.pid} of ${was.checkout}, which held it, is gone` : "what held it was not a check"}`));
      if (!holder) break;
      if (told !== holder.pid) console.log(`waiting      one whole check runs at a time on this machine. ${holder.checkout} holds the lock (process ${holder.pid}) and has run for ${span(Date.now() - holder.since)}. This one starts when it ends.`);
      told = holder.pid;
      await Bun.sleep(1000);
    }
  } catch (e) {
    console.log(`lock         not kept, so this check may run beside another: ${e instanceof Error ? e.message : e}`);
    return () => {};
  }
  if (told) console.log(`waited       ${span(Date.now() - from)}`);
  return () => release(file, process.pid);
}

const dir = mkdtempSync(join(tmpdir(), "snark-check-"));
let unlock = (): void => {};
// However it ends: the lock let go, what it started stopped, its folder gone.
process.on("exit", () => {
  unlock();
  for (const child of children) child.kill();
  rmSync(dir, { recursive: true, force: true });
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143));
if (!look) unlock = await oneAtATime();

const t0 = performance.now();
try {
  let env: Record<string, string> = {};
  if (testFiles.length > 0) await step("pack", async () => void (env = await sharedPack()));
  if (!slowOnly) {
    const types = step("types", checkTypes);
    // The page's script is built whole by the gate alone: a look leaves it out.
    const script = look ? undefined : step("script", checkScript);
    const tests = step("tests", () => checkTests("fast", dir, env));
    // The type check, the script's build and the tests have started in processes of their own; the policy runs here beside them.
    await step("policy", checkPolicy);
    await Promise.all([types, script, tests]);
  }
  if (slowOnly || args.includes("--slow")) await step("slow tests", () => checkTests("slow", dir, env));
} finally {
  rmSync(dir, { recursive: true, force: true });
  unlock();
}

const seconds = (performance.now() - t0) / 1000;
writeWhole(join(ROOT, ".cache/check/last-failures.txt"), failures.map((line) => line + "\n").join(""));
if (tally.unpy > 0) console.log(`${tally.unpy} tests of the map data stages skipped: no tools/mapdata/.venv (tools/maps/README.md)`);
const end = verdict({ problems, art: ART, noArt, ...tally, ok: `OK in ${seconds.toFixed(2)}s, at load ${loadavg()[0]!.toFixed(0)} on ${cpus().length} cores` });
const kept = `${logs.map((log) => `\ntests' output: ${log}`).join("")}\nfailing tests: .cache/check/last-failures.txt (${failures.length})`;
// Art built here and put in no release: this checkout's tests of it pass and nobody else's can.
const homemade = noArt ? [] : unreleasedHere();
const unpublished = homemade.length > 0 ? `\nWARNING ${homemade.length === 1 ? "one asset's art is" : `${homemade.length} assets' art is`} in no release, so its tests fail in any other checkout: ${homemade.join(", ")}. Publish its archive.` : "";
const notGate = picked ? `\nNot the gate: ${picked.length} of ${testFiles.filter((f) => !SLOW_TEST.test(f)).length} fast test files ran. To land, run the whole check once: bun run check` : "";
if (!end.pass) {
  console.error(end.text + kept + unpublished + notGate);
  process.exit(1);
}
console.log(end.text + kept + unpublished + notGate);
