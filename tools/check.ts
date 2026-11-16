// `bun run check`, the one command every change must pass. It enforces the rules that keep this project fast to change.
// Raising a budget or widening an allow-list is a decision. Record it in planning/decisions.md in the same change.
//
//   bun run check                policy, types and the tests of the fast tier
//   bun run check -- --slow      the same, then the slow tier (`*.slow.test.ts`): before a merge to main
//   bun run slow                 the slow tier alone

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { SLOW_TEST, TEST_WATCH, TEST_WORKERS, hungAfter } from "../tests/fixtures/load.ts";
import { dynamicLoads, madeArrays, stripComments } from "./policy.ts";

const ROOT = resolve(import.meta.dir, "..");

/**
 * CPU-seconds the fast tier's tests may take, theirs and their workers'. On the development machine they took about 220 on
 * a quiet day and up to 371 beside other teams' work, which competes for caches and memory. The clock is shown but not
 * held to a budget: on a busy machine it times the neighbours.
 */
const TEST_CPU_BUDGET = 440;
/**
 * Non-blank, non-comment lines allowed in client/shell, which has no tests. D250 shares the last 250 among round 8's
 * phases; the last 50 hold the executor's mirror of the card's state, which sends a frame's changes alone.
 */
const SHELL_MAX_LINES = 1200;
/** And in client/voice, which also has no tests. */
const VOICE_MAX_LINES = 600;
/** And in client/sound: the world's sounds and the listening page, carrying out what client/core/sound decides. */
const SOUND_MAX_LINES = 300;
/** The asset worker and its port: fetching, hashing and caching, with no decisions of their own. */
const ASSETS_MAX_LINES = 500;
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
  { dir: "client/shell", may: ["shared", "content", "client/core", "client/voice", "client/assets", "client/sound", "client/shell"], builtins: false },
  { dir: "server", may: ["shared", "content", "server", "server/api"], builtins: true },
  // What a module is written against. It names nothing of the server's own.
  { dir: "server/api", may: ["shared", "server/api"], builtins: false },
  { dir: "modules", may: ["shared", "server/api", "modules"], builtins: false },
  // A player that is a program: headless core on a socket, with tools in place of keys. It names nothing of the server's.
  { dir: "agent", may: ["shared", "content", "client/core", "agent"], builtins: true },
  { dir: "tools", may: "*", builtins: true },
  // Tests never touch the DOM zones. Logic that needs a test belongs in client/core.
  { dir: "tests", may: ["shared", "content", "client/core", "server", "server/api", "modules", "agent", "tools", "tests"], builtins: true },
];

/** Directories where results must be bit-identical on JavaScriptCore and V8. */
const DETERMINISTIC_DIRS = ["shared/sim", "shared/world", "shared/math", "shared/anim"];
/** Files that make a pack's coarser levels, which are committed: a Mac and a Linux machine must make the same bytes. */
const DETERMINISTIC_FILES = ["tools/pack/simplify.ts", "tools/pack/error.ts", "tools/pack/surface.ts"];
const NONDETERMINISTIC = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*|\bDate\.now\b|\bperformance\.now\b/;
/** Seeded randomness only, wherever game state is produced. */
const SEEDED_ONLY_DIRS = ["shared", "server", "client/core", "content"];
/** The frame's build, where an array made on every call is garbage every frame (madeArrays). */
const FRAME_DIRS = ["client/core/render", "client/core/details"];
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

const IMPORT = /^[ \t]*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^[ \t]*import\s*['"]([^'"]+)['"]/gm;

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
  let shellLines = 0;
  let voiceLines = 0;
  let assetLines = 0;
  let soundLines = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    const zone = zoneOf(rel)!;
    const src = stripComments(readFileSync(file, "utf8"));

    if (/\.(spec|e2e)\.ts$/.test(rel)) fail(`${rel}: spec/e2e files are not used here`);
    if (zone.dir === "tests" && rel !== "tests/fixtures/preload.ts" && OWN_TIMEOUT.test(src)) {
      fail(`${rel}: a test sets its own time limit; every test has the one in tests/fixtures/load.ts`);
    }
    if (zone.dir === "client/shell") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/shell has no tests; move the logic into client/core`);
      shellLines += src.split("\n").filter((l) => l.trim().length > 0).length;
    }
    if (zone.dir === "client/voice") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/voice has no tests; move the logic into client/core/voice`);
      voiceLines += src.split("\n").filter((l) => l.trim().length > 0).length;
    }
    if (zone.dir === "client/sound") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/sound has no tests; move the logic into client/core/sound`);
      soundLines += src.split("\n").filter((l) => l.trim().length > 0).length;
    }
    if (zone.dir === "client/assets") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/assets has no tests; move the logic into client/core/assets`);
      assetLines += src.split("\n").filter((l) => l.trim().length > 0).length;
    }

    // An import the rules below cannot read the name of is an import they cannot judge.
    const named = (src.match(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g) ?? []).length;
    if (zone.may !== "*" && dynamicLoads(src) > named && !MAY_LOAD_BY_NAME.has(rel)) fail(`${rel}: import() must name its file as a plain string, and require() is not used here`);

    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]!;
      if (spec.startsWith(".")) {
        const target = relative(ROOT, resolve(dirname(file), spec));
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
    if (FRAME_DIRS.some((d) => rel.startsWith(d + "/"))) for (const hit of madeArrays(src)) fail(`${rel}:${hit.line}: ${MADE_ARRAY[hit.what]}`);
  }

  if (shellLines > SHELL_MAX_LINES) {
    fail(`client/shell is ${shellLines} lines (budget ${SHELL_MAX_LINES}); move logic into client/core`);
  }
  if (voiceLines > VOICE_MAX_LINES) {
    fail(`client/voice is ${voiceLines} lines (budget ${VOICE_MAX_LINES}); move logic into client/core/voice`);
  }
  console.log(`  shell size   ${shellLines}/${SHELL_MAX_LINES} lines`);
  if (assetLines > ASSETS_MAX_LINES) fail(`client/assets is ${assetLines} lines (budget ${ASSETS_MAX_LINES}); move logic into client/core/assets`);
  console.log(`  voice size   ${voiceLines}/${VOICE_MAX_LINES} lines`);
  console.log(`  assets size  ${assetLines}/${ASSETS_MAX_LINES} lines`);
  if (soundLines > SOUND_MAX_LINES) fail(`client/sound is ${soundLines} lines (budget ${SOUND_MAX_LINES}); move logic into client/core/sound`);
  console.log(`  sound size   ${soundLines}/${SOUND_MAX_LINES} lines`);
}

/** `cpu` is the CPU-seconds of the process and of the processes it waited for. */
async function run(cmd: string[], quiet: boolean, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; out: string; cpu: number }> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, env, stdout: quiet ? "pipe" : "inherit", stderr: quiet ? "pipe" : "inherit" });
  const out = quiet ? (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text()) : "";
  const ok = (await proc.exited) === 0;
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

/** The core pack, built here once for the test files instead of once in each of a hundred (tests/fixtures/pack.ts). */
async function sharedPack(dir: string): Promise<Record<string, string>> {
  try {
    const { CORE_PACK_FILE } = await import("../tests/fixtures/pack.ts");
    const { buildCorePack } = await import("./pack/build.ts");
    const file = join(dir, "core.snpk");
    writeFileSync(file, buildCorePack());
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
if (args.some((a) => a !== "--slow" && a !== "--slow-only")) {
  console.error("usage: bun run check -- [--slow | --slow-only]");
  process.exit(2);
}
const slowOnly = args.includes("--slow-only");

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

/** Each test file's CPU-seconds, from what the preload wrote in `dir`. */
function fileCpu(dir: string): [string, number][] {
  const out: [string, number][] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".tsv"))) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      const [file, seconds] = line.split("\t");
      if (file && seconds) out.push([relative(ROOT, file), Number(seconds)]);
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
    stopped.push(`${relative(ROOT, file!)}: ${n === "0" ? "loading it" : `its test number ${n}`} ran ${(ran / 1000).toFixed(0)} s, past its hang limit of ${(allowed / 1000).toFixed(0)} s, without yielding; its worker was stopped`);
  }
}

/** Runs the tests of `tier`, with `env` from sharedPack, leaving its reports in `dir`. */
async function checkTests(tier: Tier, dir: string, env: Record<string, string>): Promise<void> {
  const files = testFiles.filter((f) => SLOW_TEST.test(f) === (tier === "slow")).length;
  if (files === 0) return;
  // Each test file in a worker of its own: about half the time, and one file cannot lean on what another left behind.
  // More JS heaps than sixteen contend for cache and memory on a machine of many threads, and time out files fast alone.
  const workers = Math.min(16, cpus().length, files);
  const report = join(dir, `${tier}.xml`);
  const watch = join(dir, `${tier}-watch`);
  mkdirSync(watch);
  const times = timesOf(tier);
  // The slowest files start first, by their times in the last run, or the last of them may start when the rest are done.
  const timed = existsSync(times) ? ["--timings", times] : tier === "fast" ? ["--timings", SEED_TIMES] : [];
  const only = tier === "slow" ? [".slow.test.ts"] : ["--path-ignore-patterns=**/*.slow.test.ts"];
  const stopped: string[] = [];
  const most = new Map<string, number>();
  const watching = setInterval(() => stopHung(watch, workers, most, stopped), 1000);
  const r = await run(["bun", "test", `--parallel=${workers}`, ...timed, "--reporter=junit", `--reporter-outfile=${report}`, ...only], true, { ...process.env, ...env, [TEST_WORKERS]: String(workers), [TEST_WATCH]: watch });
  clearInterval(watching);
  stopped.forEach(fail);
  if (!r.ok) {
    fail(`${tier} tests failed:\n${r.out.trim()}`);
    return;
  }
  keepTimes(times, readFileSync(report, "utf8"));
  const counts = r.out.trim().split("\n").filter((l) => /^\s*\d+ (pass|fail|skip)/.test(l)).map((l) => l.trim());
  console.log(`  ${counts.join(", ")}, ${r.cpu.toFixed(0)} CPU-seconds${tier === "fast" ? ` of ${TEST_CPU_BUDGET}` : ""}`);
  // CPU-seconds move far less with the machine's load than the clock does, so a slow change shows on a busy day too.
  if (tier === "fast" && r.cpu > TEST_CPU_BUDGET) {
    const costliest = fileCpu(watch).slice(0, 5).map(([f, s]) => `${f} ${s.toFixed(1)}`);
    fail(`the tests took ${r.cpu.toFixed(0)} CPU-seconds, over their budget of ${TEST_CPU_BUDGET}. The costliest files, in CPU-seconds: ${costliest.join(", ")}. Make them cheaper; a test that is slow by nature belongs in the slow tier (planning/quality/testing.md)`);
  }
}

const t0 = performance.now();
const step = async (name: string, fn: () => void | Promise<void>) => {
  const t = performance.now();
  await fn();
  console.log(`${name.padEnd(12)} ${((performance.now() - t) / 1000).toFixed(2)}s`);
};

const dir = mkdtempSync(join(tmpdir(), "snark-check-"));
try {
  let env: Record<string, string> = {};
  if (testFiles.length > 0) await step("pack", async () => void (env = await sharedPack(dir)));
  if (!slowOnly) {
    const types = step("types", checkTypes);
    const tests = step("tests", () => checkTests("fast", dir, env));
    // The type check and the tests have started in processes of their own; the policy runs here beside them.
    await step("policy", checkPolicy);
    await Promise.all([types, tests]);
  }
  if (slowOnly || args.includes("--slow")) await step("slow tests", () => checkTests("slow", dir, env));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const seconds = (performance.now() - t0) / 1000;
if (problems.length > 0) {
  console.error(`\nFAILED (${problems.length})\n` + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log(`\nOK in ${seconds.toFixed(2)}s, at load ${loadavg()[0]!.toFixed(0)} on ${cpus().length} cores`);
