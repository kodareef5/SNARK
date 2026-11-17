// `bun run ci`: does a commit pass on its own? It writes the commit out of git into a new folder outside the repository,
// installs from the lockfile, runs `bun run check` there, has each tool that writes a committed file write it again, and
// removes the folder. Git's objects are only read; the working copy and the other worktrees are not touched.
//
//   bun run ci                  HEAD
//   bun run ci -- main          any commit
//   --slow                      the check with its slow tier, as before a merge to main
//   --build                     also a client build in the copy, which starts with no texture cache
//   --probe                     also `bun run probe` in the copy; --probe-slow, --probe-lose, --probe-twice and
//                               --probe-stress run it with that flag. --all runs every option
//
// It exits with the check's own status, or 1 if the check passed and anything else did not. See planning/ci.md.

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PROBES = ["probe", "probe-slow", "probe-lose", "probe-twice", "probe-stress"];
const OPTIONS = ["slow", "build", ...PROBES, "all"];

/**
 * Tools that write committed files without Blender. In the copy each writes its files again, and they must come out as
 * committed. The packs Blender builds are not here: the check's art test measures them.
 */
const GENERATED: { cmd: string[]; needs?: string }[] = [
  { cmd: ["tools/settings.ts"], needs: "planning" },
  { cmd: ["tools/catalogue.ts"], needs: "planning" },
  { cmd: ["tools/events.ts"], needs: "planning" },
  { cmd: ["tools/art.ts", "core:human-clips"], needs: "assets" },
  { cmd: ["tools/blender/example/demo/pictures.ts"] },
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
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && v !== undefined) env[k] = v;
// In the copy this machine's git settings play no part, and CI is set, as a runner sets it.
const copyEnv = { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", CI: "true" };

function git(cwd: string, ...a: string[]): string {
  const r = Bun.spawnSync(["git", ...a], { cwd, env: cwd === ROOT ? env : copyEnv, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString().trimEnd();
}

let sha: string;
try {
  sha = git(ROOT, "rev-parse", "--verify", "--end-of-options", `${commits[0] ?? "HEAD"}^{commit}`);
} catch {
  console.error(`ci: no commit "${commits[0] ?? "HEAD"}"`);
  process.exit(2);
}
const subject = git(ROOT, "log", "-1", "--format=%s", sha);
const objects = git(ROOT, "rev-parse", "--path-format=absolute", "--git-path", "objects");

// Without Node 24 or newer the check skips its comparison of JavaScriptCore and V8, and a pass would say less than it seems.
const node = Bun.which("node");
const nodeVersion = node ? Bun.spawnSync([node, "--version"]).stdout.toString().trim() : "";
if (Number(nodeVersion.match(/^v(\d+)/)?.[1] ?? 0) < 24) {
  console.error(`ci: Node 24 or newer is needed on the path, and ${nodeVersion || "none"} was found`);
  process.exit(1);
}

const base = realpathSync(tmpdir());
const within = (dir: string): boolean => base === dir || base.startsWith(dir + sep);
if (within(realpathSync(ROOT)) || within(dirname(dirname(objects)))) {
  console.error(`ci: the temporary folder ${base} is inside the repository. Set TMPDIR to a folder outside it.`);
  process.exit(2);
}
const copy = mkdtempSync(join(base, "snark-ci-"));
let project = copy;
const removeCopy = (): void => rmSync(copy, { recursive: true, force: true });
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.on(signal, () => {
    removeCopy();
    process.exit(code);
  });
}

interface Result {
  status: number;
  note: string;
}
const steps: (Result & { name: string; seconds: number })[] = [];
const t0 = performance.now();

async function step(name: string, fn: () => Promise<Result>): Promise<number> {
  console.log(`\n--- ${name}`);
  const t = performance.now();
  let result: Result;
  try {
    result = await fn();
  } catch (err) {
    result = { status: 1, note: err instanceof Error ? err.message : String(err) };
  }
  steps.push({ name, seconds: (performance.now() - t) / 1000, ...result });
  if (result.status !== 0) console.log(result.note);
  return result.status;
}

/** Runs Bun in the copy: this Bun, whatever the path holds. */
async function bun(cmd: string[], quiet = false): Promise<{ status: number; out: string }> {
  console.log(`$ bun ${cmd.join(" ")}`);
  const proc = Bun.spawn([process.execPath, ...cmd], { cwd: project, env: copyEnv, stdout: quiet ? "pipe" : "inherit", stderr: quiet ? "pipe" : "inherit" });
  const [out, err] = quiet ? await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]) : ["", ""];
  return { status: await proc.exited, out: out + err };
}

const exited = (r: { status: number }): Result => ({ status: r.status, note: r.status === 0 ? "" : `exit ${r.status}` });

const seen = new Set<string>();
/** Files that differ from the commit or are new and not ignored, less those named before. */
function changed(): string[] {
  const now = git(copy, "status", "--porcelain", "--untracked-files=all").split("\n").filter((l) => l.length > 0);
  const fresh = now.filter((l) => !seen.has(l));
  for (const l of now) seen.add(l);
  return fresh;
}

let checkStatus: number | null = null;
try {
  console.log(`ci ${sha.slice(0, 12)} ${subject}\n   in ${copy}`);

  // The copy borrows the repository's object store to read from and writes nothing there. The commit need not be on a branch.
  const copied = await step("copy", async () => {
    git(copy, "init", "--quiet");
    writeFileSync(join(copy, ".git/objects/info/alternates"), objects + "\n");
    git(copy, "config", "core.excludesFile", "/dev/null");
    git(copy, "-c", "advice.detachedHead=false", "-c", "checkout.workers=0", "checkout", "--quiet", "--detach", sha);
    if (existsSync(join(copy, "game/tools/check.ts"))) project = join(copy, "game");
    const off = changed();
    if (git(copy, "rev-parse", "HEAD") !== sha || off.length > 0) return { status: 1, note: `the copy is not the commit:\n${off.join("\n")}` };
    return { status: 0, note: `${git(copy, "ls-files").split("\n").length} files` };
  });

  const installed =
    copied === 0 &&
    (await step("install", async () => {
      const pinned = JSON.parse(readFileSync(join(project, "package.json"), "utf8")).engines?.bun;
      if (pinned !== Bun.version) return { status: 1, note: `package.json pins Bun ${pinned}, and this is Bun ${Bun.version}` };
      const r = await bun(["install", "--frozen-lockfile"]);
      return r.status === 0 ? { status: 0, note: `Bun ${Bun.version} as pinned, Node ${nodeVersion.slice(1)}` } : { status: r.status, note: "the lockfile does not install" };
    })) === 0;

  if (installed) {
    checkStatus = await step("check", async () => exited(await bun(["run", "check", ...(wants("slow") ? ["--slow"] : [])])));
    await step("tree after check", async () => {
      const left = changed();
      return left.length === 0 ? { status: 0, note: "as committed" } : { status: 1, note: `the check changed or left files that are not ignored:\n${left.join("\n")}` };
    });

    await step("generated", async () => {
      const stale: string[] = [];
      let ran = 0;
      for (const { cmd, needs } of GENERATED) {
        if (!existsSync(join(project, cmd[0]!))) continue;
        if (project !== copy && needs && !existsSync(join(project, needs))) continue;
        const r = await bun(cmd, true);
        if (r.status !== 0) return { status: 1, note: `bun ${cmd.join(" ")}: exit ${r.status}\n${r.out.trim()}` };
        ran++;
        for (const line of changed()) stale.push(`${line.slice(3)}, from bun ${cmd.join(" ")}`);
      }
      if (stale.length > 0) return { status: 1, note: `committed files that are not what their tools write:\n${stale.join("\n")}` };
      return { status: 0, note: `${ran} tools, every file as committed` };
    });

    if (wants("build")) await step("build", async () => exited(await bun(["run", "build"])));
    for (const p of PROBES.filter(wants)) {
      const flag = p === "probe" ? [] : [`--${p.slice("probe-".length)}`];
      await step(p, async () => exited(await bun(["run", "probe", ...flag])));
    }
  }
} finally {
  const t = performance.now();
  removeCopy();
  steps.push({ name: "remove copy", seconds: (performance.now() - t) / 1000, status: 0, note: "" });
}

const status = checkStatus !== null && checkStatus !== 0 ? checkStatus : steps.some((s) => s.status !== 0) ? 1 : 0;
console.log(`\nci ${sha.slice(0, 12)} ${subject}`);
for (const s of steps) {
  console.log(`  ${s.name.padEnd(18)} ${s.seconds.toFixed(1).padStart(6)}s  ${s.status === 0 ? "ok  " : "FAIL"}  ${s.note.split("\n")[0]}`);
}
console.log(`  ${"total".padEnd(18)} ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  exit ${status}`);
process.exit(status);
