// `bun run ci`: does a commit pass on its own? It writes the commit out of git into a folder outside the repository,
// installs from the lockfile, runs `bun run check` there, has the tools that write committed files write them again,
// and removes the folder. The working copy and the other worktrees are never read or written.
//
//   bun run ci                      HEAD
//   bun run ci -- main              any commit
//   --build                         also a client build in the copy
//   --probe                         also `bun run probe` in the copy; --probe-slow, --probe-lose, --probe-twice and
//                                   --probe-stress run it with that flag, and --all runs every option
//
// It exits with the check's own status, or 1 if the check passed and anything else did not.

import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PROBES = ["probe", "probe-slow", "probe-lose", "probe-twice", "probe-stress"];
const OPTIONS = ["build", ...PROBES, "all"];

/**
 * Committed files that a tool writes, and the tool, run in the copy in this order. The copy must then be as committed.
 * The packs that only Blender can build are written again from themselves, which proves their format and not their source.
 */
const GENERATED: { what: string; cmd: string[] }[] = [
  { what: "settings page", cmd: ["tools/settings.ts"] },
  { what: "catalogue page", cmd: ["tools/catalogue.ts"] },
  { what: "events page", cmd: ["tools/events.ts"] },
  { what: "packs, from themselves", cmd: ["tools/art.ts", "--all", "--repack"] },
  { what: "human clips, from assets/raw", cmd: ["tools/art.ts", "core:human-clips", "--out", "artifacts/ci"] },
];

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--")).map((a) => a.slice(2));
const commits = args.filter((a) => !a.startsWith("--"));
if (commits.length > 1 || flags.some((f) => !OPTIONS.includes(f))) {
  console.error(`usage: bun run ci -- [commit] [${OPTIONS.map((o) => `--${o}`).join("] [")}]`);
  process.exit(2);
}
const wants = (option: string): boolean => flags.includes(option) || flags.includes("all");

// Git's own variables, which a hook runs with, would point every git command at the repository the hook came from.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function git(cwd: string, ...a: string[]): string {
  const r = Bun.spawnSync(["git", ...a], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trim();
}

const sha = git(ROOT, "rev-parse", "--verify", "--end-of-options", `${commits[0] ?? "HEAD"}^{commit}`);
const subject = git(ROOT, "log", "-1", "--format=%s", sha);
const objects = git(ROOT, "rev-parse", "--path-format=absolute", "--git-path", "objects");

const base = realpathSync(tmpdir());
const inside = (dir: string): boolean => base === dir || base.startsWith(dir + sep);
if (inside(realpathSync(ROOT)) || inside(dirname(dirname(objects)))) {
  console.error(`ci: the temporary folder ${base} is inside the repository. Set TMPDIR to a folder outside it.`);
  process.exit(2);
}
const copy = mkdtempSync(join(base, "snark-ci-"));
const removeCopy = (): void => rmSync(copy, { recursive: true, force: true });
process.on("SIGINT", () => {
  removeCopy();
  process.exit(130);
});

interface Step {
  name: string;
  seconds: number;
  status: number;
  note: string;
}
const steps: Step[] = [];
const t0 = performance.now();

async function step(name: string, fn: () => Promise<{ status: number; note: string }>): Promise<number> {
  console.log(`\n--- ${name}`);
  const t = performance.now();
  let result: { status: number; note: string };
  try {
    result = await fn();
  } catch (err) {
    result = { status: 1, note: String(err instanceof Error ? err.message : err) };
  }
  steps.push({ name, seconds: (performance.now() - t) / 1000, ...result });
  if (result.status !== 0) console.log(result.note);
  return result.status;
}

async function run(cmd: string[], quiet = false): Promise<{ status: number; out: string }> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd: copy, env, stdout: quiet ? "pipe" : "inherit", stderr: quiet ? "pipe" : "inherit" });
  const out = quiet ? (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text()) : "";
  return { status: await proc.exited, out };
}

const reported = new Set<string>();
/** What differs from the commit and is not ignored, less what was named before. */
function changed(): string[] {
  const now = git(copy, "status", "--porcelain", "--untracked-files=all").split("\n").filter((l) => l.length > 0);
  const fresh = now.filter((l) => !reported.has(l));
  for (const l of now) reported.add(l);
  return fresh;
}

let checkStatus = 1;
try {
  console.log(`ci ${sha.slice(0, 12)} ${subject}\n   in ${copy}`);

  // Objects are read from the repository's own store; nothing is written there. The commit need not be on a branch.
  const copied = await step("copy", async () => {
    git(copy, "init", "--quiet", "--initial-branch=ci");
    writeFileSync(join(copy, ".git/objects/info/alternates"), objects + "\n");
    git(copy, "-c", "core.autocrlf=false", "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", sha);
    git(copy, "config", "core.autocrlf", "false");
    const files = git(copy, "ls-files").split("\n").length;
    const off = changed();
    if (git(copy, "rev-parse", "HEAD") !== sha || off.length > 0) return { status: 1, note: `the copy is not the commit:\n${off.join("\n")}` };
    return { status: 0, note: `${files} files` };
  });
  if (copied !== 0) throw new Error("no copy");

  const node = Bun.which("node");
  const nodeVersion = node ? Bun.spawnSync([node, "--version"]).stdout.toString().trim() : "";
  if (Number(nodeVersion.match(/^v(\d+)/)?.[1] ?? 0) < 24) {
    // Without it the check skips its comparison of JavaScriptCore and V8, and a pass would say less than it seems to.
    await step("node", async () => ({ status: 1, note: `Node 24 or newer is needed, ${nodeVersion || "none"} found` }));
    throw new Error("no node");
  }

  const installed = await step("install", async () => {
    const r = await run(["bun", "install", "--frozen-lockfile"]);
    return { status: r.status, note: r.status === 0 ? `Bun ${Bun.version}, Node ${nodeVersion.slice(1)}` : "the lockfile does not install" };
  });
  if (installed !== 0) throw new Error("no install");

  checkStatus = await step("check", async () => {
    const r = await run(["bun", "run", "check"]);
    return { status: r.status, note: r.status === 0 ? "" : `exit ${r.status}` };
  });
  await step("tree after check", async () => {
    const left = changed();
    return left.length === 0 ? { status: 0, note: "as committed" } : { status: 1, note: `the check changed or left files that are not ignored:\n${left.join("\n")}` };
  });

  await step("generated", async () => {
    const ran: string[] = [];
    for (const g of GENERATED) {
      if (!existsSync(join(copy, g.cmd[0]!))) continue;
      const r = await run(["bun", ...g.cmd], true);
      if (r.status !== 0) return { status: r.status, note: `${g.what}: exit ${r.status}\n${r.out.trim()}` };
      ran.push(g.what);
    }
    const stale = changed();
    if (stale.length > 0) return { status: 1, note: `committed files differ from what their tools write:\n${stale.join("\n")}\n${git(copy, "diff", "--stat")}` };
    return { status: 0, note: ran.join("; ") };
  });

  if (wants("build")) {
    await step("build", async () => {
      const r = await run(["bun", "run", "build"]);
      return { status: r.status, note: r.status === 0 ? "" : `exit ${r.status}` };
    });
  }
  for (const p of PROBES.filter(wants)) {
    const flag = p === "probe" ? [] : ["--", `--${p.slice("probe-".length)}`];
    await step(p, async () => {
      const r = await run(["bun", "run", "probe", ...flag]);
      return { status: r.status, note: r.status === 0 ? "" : `exit ${r.status}` };
    });
  }
} catch (err) {
  if (!(err instanceof Error) || !["no copy", "no node", "no install"].includes(err.message)) {
    steps.push({ name: "ci", seconds: 0, status: 1, note: String(err) });
  }
} finally {
  const t = performance.now();
  removeCopy();
  steps.push({ name: "remove copy", seconds: (performance.now() - t) / 1000, status: 0, note: "" });
}

const failed = steps.find((s) => s.status !== 0);
const exit = steps.some((s) => s.name === "check") && checkStatus !== 0 ? checkStatus : failed ? 1 : 0;
console.log(`\nci ${sha.slice(0, 12)} ${subject}`);
for (const s of steps) {
  console.log(`  ${s.name.padEnd(18)} ${s.seconds.toFixed(1).padStart(6)}s  ${s.status === 0 ? "ok  " : "FAIL"}  ${s.note.split("\n")[0]}`);
}
console.log(`  ${"total".padEnd(18)} ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  exit ${exit}`);
process.exit(exit);
