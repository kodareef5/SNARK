// `bun run check`, the one command every change must pass. It enforces the rules that keep this project fast to change.
// Raising a budget or widening an allow-list is a decision. Record it in planning/decisions.md in the same change.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { dynamicLoads, stripComments } from "./policy.ts";

const ROOT = resolve(import.meta.dir, "..");

/** Wall-clock budget for the whole check. */
const BUDGET_SECONDS = 20;
/** Non-blank, non-comment lines allowed in client/shell, which has no tests. D250 shares the last 250 among round 8's phases. */
const SHELL_MAX_LINES = 1150;
/** And in client/voice, which also has no tests. */
const VOICE_MAX_LINES = 600;
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
  { dir: "client/shell", may: ["shared", "content", "client/core", "client/voice", "client/assets", "client/shell"], builtins: false },
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
const NONDETERMINISTIC = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|random)\b|\*\*|\bDate\.now\b|\bperformance\.now\b/;
/** Seeded randomness only, wherever game state is produced. */
const SEEDED_ONLY_DIRS = ["shared", "server", "client/core", "content"];

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

  for (const file of files) {
    const rel = relative(ROOT, file);
    const zone = zoneOf(rel)!;
    const src = stripComments(readFileSync(file, "utf8"));

    if (/\.(spec|e2e)\.ts$/.test(rel)) fail(`${rel}: spec/e2e files are not used here`);
    if (zone.dir === "client/shell") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/shell has no tests; move the logic into client/core`);
      shellLines += src.split("\n").filter((l) => l.trim().length > 0).length;
    }
    if (zone.dir === "client/voice") {
      if (rel.endsWith(".test.ts")) fail(`${rel}: client/voice has no tests; move the logic into client/core/voice`);
      voiceLines += src.split("\n").filter((l) => l.trim().length > 0).length;
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

    if (DETERMINISTIC_DIRS.some((d) => rel.startsWith(d + "/"))) {
      const hit = src.match(NONDETERMINISTIC);
      if (hit) fail(`${rel}: "${hit[0]}" is not bit-reproducible across engines; use shared/math`);
    }
    if (SEEDED_ONLY_DIRS.some((d) => rel.startsWith(d + "/")) && /\bMath\.random\b/.test(src)) {
      fail(`${rel}: Math.random is not allowed; use the seeded Rng in shared/rng.ts`);
    }
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
}

async function run(cmd: string[], quiet: boolean, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; out: string }> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, env, stdout: quiet ? "pipe" : "inherit", stderr: quiet ? "pipe" : "inherit" });
  const out = quiet ? (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text()) : "";
  return { ok: (await proc.exited) === 0, out };
}

async function checkTypes(): Promise<void> {
  const tsc = join(ROOT, "node_modules/.bin/tsc");
  const zones = ZONES.filter((z) => walk(join(ROOT, z.dir)).some((f) => f.endsWith(".ts")));
  const results = await Promise.all(zones.map((z) => run([tsc, "-p", join(z.dir, "tsconfig.json")], true)));
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

async function checkTests(): Promise<void> {
  const hasTests = walk(join(ROOT, "tests")).some((f) => f.endsWith(".test.ts"));
  if (!hasTests) return;
  // Each test file in a worker of its own: about half the time, and one file cannot lean on what another left behind.
  // A busy machine can make a one-second test take five, so a test is called hung at 20 s, and later in step with the load
  // when more work waits than there are cores, up to two minutes.
  const hung = Math.round(20000 * Math.min(6, Math.max(1, loadavg()[0]! / cpus().length)));
  const dir = mkdtempSync(join(tmpdir(), "snark-check-"));
  let r: { ok: boolean; out: string };
  try {
    r = await run(["bun", "test", "--parallel", "--timeout", String(hung)], true, { ...process.env, ...(await sharedPack(dir)) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!r.ok) fail(`tests failed:\n${r.out.trim()}`);
  else console.log("  " + (r.out.trim().split("\n").filter((l) => /^\s*\d+ (pass|fail|skip)/.test(l)).map((l) => l.trim()).join(", ")));
}

const t0 = performance.now();
const step = async (name: string, fn: () => void | Promise<void>) => {
  const t = performance.now();
  await fn();
  console.log(`${name.padEnd(12)} ${((performance.now() - t) / 1000).toFixed(2)}s`);
};

await step("policy", checkPolicy);
await Promise.all([step("types", checkTypes), step("tests", checkTests)]);

const seconds = (performance.now() - t0) / 1000;
// With more work waiting than there are cores, the clock times the neighbours and not the tests, so the budget is not counted.
const busy = loadavg()[0]! > cpus().length;
if (seconds > BUDGET_SECONDS && busy) console.log(`\nover the ${BUDGET_SECONDS}s budget at ${seconds.toFixed(1)}s, not counted: load ${loadavg()[0]!.toFixed(0)} on ${cpus().length} cores`);
else if (seconds > BUDGET_SECONDS) fail(`check took ${seconds.toFixed(1)}s (budget ${BUDGET_SECONDS}s); make tests faster or remove them`);
if (problems.length > 0) {
  console.error(`\nFAILED (${problems.length})\n` + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log(`\nOK in ${seconds.toFixed(2)}s (budget ${BUDGET_SECONDS}s)`);
