// The code as it may be shown outside: the tracked text of the code's folders, with no art, no pictures, no planning
// documents and no history. `bun run source [dir]` writes it to `dir` (var/source/repo) and makes it the one commit of
// a repository there, to be pushed over the last one. A document that says a name on the local list
// (var/source/names.txt, a pattern a line, not in git) is held back and listed; code that says one stops the export.
// The licence and the top README are the owner's to sign, and are not looked through.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TEXT = new Set(["ts", "js", "json", "md", "py", "css", "html", "ini", "toml", "lock", "txt", "sh", "ps1", "psd1", "yml", "overpassql", "gitignore"]);
/** What the tests and the Blender example read, whatever its kind. */
const FIXTURES = /^(tests\/fixtures|tools\/blender\/example)\//;
const MOST = 2 * 1024 * 1024;

/** Whether a tracked file is part of the code as shown. */
export function shown(path: string): boolean {
  if (path.startsWith("assets/") || path.startsWith("planning/")) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "LICENSE" || name === "NOTICE" || FIXTURES.test(path)) return true;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return TEXT.has(ext);
}

const SIGNED = new Set(["LICENSE", "README.md"]);

function git(dir: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

/** The exported repository keeps the project under game/ and accepts its Bun commands from the root. */
export function writeSourceRoot(out: string): void {
  const game = join(out, "game");
  for (const file of [".gitignore", "LICENSE"]) copyFileSync(join(game, file), join(out, file));
  const pkg = JSON.parse(readFileSync(join(game, "package.json"), "utf8"));
  const scripts = Object.fromEntries(Object.keys(pkg.scripts).map((name) => [name, `bun run --cwd game ${name}`]));
  scripts.postinstall = "bun install --cwd game --frozen-lockfile";
  writeFileSync(join(out, "package.json"), JSON.stringify({ private: true, engines: pkg.engines, scripts }, null, 2) + "\n");

  const { test: tests } = Bun.TOML.parse(readFileSync(join(game, "bunfig.toml"), "utf8")) as { test: { root: string; preload: string[] } };
  const preloads = tests.preload.map((file) => "./" + posix.join("game", file));
  writeFileSync(join(out, "bunfig.toml"), `[test]\nroot = "game/${tests.root}"\npreload = ${JSON.stringify(preloads)}\n`);

  const readme = readFileSync(join(game, "README.md"), "utf8");
  const linked = readme.replace(/\]\((?![a-z][\w+.-]*:|[/#])([^\s)]+)\)/gi, "](game/$1)");
  writeFileSync(join(out, "README.md"), linked);
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? join(ROOT, "var/source/repo"));
  const changed = git(ROOT, "diff", "--relative", "--name-only", "HEAD", "--", ".").split("\n").filter((f) => f !== "" && shown(f));
  if (changed.length > 0) throw new Error(`the export is of what is committed, and these have changes that are not:\n  ${changed.join("\n  ")}`);
  const list = join(ROOT, "var/source/names.txt");
  const names = existsSync(list) ? readFileSync(list, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => new RegExp(l.trim(), "i")) : [];
  const files = git(ROOT, "ls-files", "-z").split("\0").filter((f) => f !== "" && shown(f));
  const kept: string[] = [];
  const held: string[] = [];
  const stops: string[] = [];
  const lines = new Map<string, number>();
  let bytes = 0;
  for (const file of files) {
    const size = statSync(join(ROOT, file)).size;
    // This layout is imported as code by the landmark tools, tests and wiki. Git compresses its repeated geometry.
    if (size > MOST && file !== "content/landmarks/cruise-layout.json") {
      held.push(`${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }
    const text = FIXTURES.test(file) ? "" : readFileSync(join(ROOT, file), "utf8");
    const said = SIGNED.has(file) ? [] : names.filter((n) => n.test(text) || n.test(file));
    if (said.length > 0) {
      (file.endsWith(".md") ? held : stops).push(`${file} (${said.map((n) => n.source).join(", ")})`);
      continue;
    }
    kept.push(file);
    bytes += size;
    const zone = file.includes("/") ? file.slice(0, file.indexOf("/")) : "(root)";
    lines.set(zone, (lines.get(zone) ?? 0) + (text === "" ? 0 : text.split("\n").length));
  }
  if (stops.length > 0) {
    console.error(`source: ${stops.length} files of code say a name on the list, and nothing was written:\n  ${stops.join("\n  ")}`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  for (const entry of readdirSync(out)) if (entry !== ".git") rmSync(join(out, entry), { recursive: true });
  for (const file of kept) {
    const dest = join(out, "game", file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(ROOT, file), dest);
  }
  writeSourceRoot(out);
  if (!existsSync(join(out, ".git"))) git(out, "init", "-q", "-b", "main");
  git(out, "add", "-A");
  const from = git(ROOT, "rev-parse", "--short", "HEAD").trim();
  const message = `Source as of ${new Date().toISOString().slice(0, 10)}, from ${from}\n\nThe code: no art, no pictures, no planning documents and no history.`;
  const commit = git(out, "commit-tree", git(out, "write-tree").trim(), "-m", message).trim();
  git(out, "update-ref", "refs/heads/main", commit);
  git(out, "reset", "-q", "--hard", "main");

  console.log(`source       ${kept.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, from ${from}, one commit ${commit.slice(0, 8)} at ${out}`);
  for (const [zone, n] of [...lines].sort((a, b) => b[1] - a[1])) console.log(`  ${zone.padEnd(10)} ${n.toLocaleString("en-US").padStart(8)} lines`);
  console.log(names.length === 0 ? `  no list of names at ${list}: none was looked for` : `  ${names.length} names looked for`);
  if (held.length > 0) console.log(`  held back, ${held.length}:\n    ${held.join("\n    ")}`);
}
