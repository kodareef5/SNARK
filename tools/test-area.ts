// Where a test file of the old folders lives now. The tests were sorted into areas on 2026-11-22 (tests/README.md); a
// branch cut before that still adds files to tests/unit and tests/integration, and names the old paths.
//
//   bun tools/test-area.ts                      lists the test files still in the old folders, and where each goes
//   bun tools/test-area.ts --move [file=area]   moves them with git mv, and adds them to the map
//   bun tools/test-area.ts --paths              rewrites the old paths named in tracked text to the new ones
//
// The map is tools/test-areas.json: old path to new, under tests/. A file it does not hold goes to the area that holds
// the most files with its first word (vehicle-jump.test.ts to vehicles); one with no such kin needs `file=area`, as in
// `--move ufo.test.ts=world`. Where the area already has a file of that name, the one from tests/integration is
// renamed `<name>-play`. Merge such a branch with `git -c merge.directoryRenames=false merge`, or git guesses an area
// for each new file and calls it a conflict. Delete this tool and its map once no such branch is left to merge.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const MAP = join(ROOT, "tools/test-areas.json");
const OLD = ["unit", "integration"];
const NOT_AREAS = new Set([...OLD, "fixtures", "performance", "kit"]);
/** Text the rewrite leaves as it is: a frozen archive, the reference pages, the map, and this tool's own test. */
const KEPT = (file: string): boolean => file === "planning/decisions.md" || file.startsWith("planning/reference/") || file === "tools/test-areas.json" || file === "tests/tools/test-area.test.ts";

/** Old path to new, both under tests/. */
export type Moved = Record<string, string>;

/** A test file's name before its first hyphen or dot: what its kin share. */
const firstWord = (name: string): string => /^[^-.]+/.exec(name)![0];

/** The area a new file named `name` belongs to: the one holding most of the files that share its first word. */
export function areaOf(name: string, moved: Moved): string | undefined {
  const votes = new Map<string, number>();
  for (const to of Object.values(moved)) {
    const [area, file] = to.split("/") as [string, string];
    if (firstWord(file) === firstWord(name)) votes.set(area, (votes.get(area) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

/** Where `name` goes in `area`: under its own name, or as `<name>-play` when `taken` says the area has one already. */
export function placed(name: string, area: string, taken: (path: string) => boolean): string {
  const to = `${area}/${name}`;
  if (!taken(to)) return to;
  const end = name.endsWith(".slow.test.ts") ? ".slow.test.ts" : ".test.ts";
  return `${area}/${name.slice(0, -end.length)}-play${end}`;
}

/** `text` with each old path the map holds written as its new one, with or without `tests/` before it. */
export function rewritten(text: string, moved: Moved): string {
  return text.replace(/\b(unit|integration)\/([\w.-]+?\.test\.ts)\b/g, (all, dir: string, name: string) => moved[`${dir}/${name}`] ?? all);
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const given = new Map(args.filter((a) => a.includes("=")).map((a) => a.split("=") as [string, string]));
  const flags = args.filter((a) => !a.includes("="));
  if (flags.some((f) => f !== "--move" && f !== "--paths")) {
    console.error("usage: bun tools/test-area.ts [--move [file.test.ts=area ...]] [--paths]");
    process.exit(2);
  }
  const moved = JSON.parse(readFileSync(MAP, "utf8")) as Moved;
  const areas = new Set(readdirSync(join(ROOT, "tests")).filter((n) => !NOT_AREAS.has(n) && statSync(join(ROOT, "tests", n)).isDirectory()));
  for (const to of Object.values(moved)) areas.add(to.split("/")[0]!);

  let unplaced = 0;
  const moves: [from: string, to: string][] = [];
  for (const dir of OLD) {
    if (!existsSync(join(ROOT, "tests", dir))) continue;
    for (const name of readdirSync(join(ROOT, "tests", dir)).filter((n) => n.endsWith(".test.ts")).sort()) {
      const from = `${dir}/${name}`;
      const asked = given.get(name) ?? given.get(from);
      const area = asked ?? areaOf(name, moved);
      const fresh = (p: string): boolean => existsSync(join(ROOT, "tests", p)) || moves.some((m) => m[1] === p);
      const to = !asked && moved[from] ? moved[from] : area && placed(name, area, fresh);
      if (!to || !areas.has(to.split("/")[0]!)) {
        console.log(`tests/${from}  ->  ? ${area ? `"${area}" is not an area` : "no file shares its first word"}: give ${name}=<area> (${[...areas].sort().join(", ")})`);
        unplaced++;
      } else if (fresh(to)) {
        console.log(`tests/${from}  ->  ? tests/${to} is there already: give this one another name first`);
        unplaced++;
      } else {
        console.log(`tests/${from}  ->  tests/${to}`);
        moves.push([from, to]);
      }
    }
  }
  if (moves.length + unplaced === 0) console.log("no test file is left in tests/unit or tests/integration");

  if (flags.includes("--move")) {
    if (unplaced > 0) {
      console.error(`${unplaced} not placed: nothing was moved`);
      process.exit(1);
    }
    for (const [from, to] of moves) {
      mkdirSync(join(ROOT, "tests", dirname(to)), { recursive: true });
      git("mv", "-k", `tests/${from}`, `tests/${to}`);
      // Not tracked yet, so git left it: an integrator's own new file, or one a merge brought unstaged.
      if (existsSync(join(ROOT, "tests", from))) throw new Error(`tests/${from} is not tracked by git: add it, then run this again`);
      moved[from] = to;
    }
    const sorted = Object.entries(moved).sort(([a], [b]) => (a < b ? -1 : 1));
    writeFileSync(MAP, `{\n${sorted.map(([from, to]) => `  ${JSON.stringify(from)}: ${JSON.stringify(to)}`).join(",\n")}\n}\n`);
    // Left empty, a folder is not in git and would only be in the way.
    for (const dir of OLD) if (existsSync(join(ROOT, "tests", dir)) && readdirSync(join(ROOT, "tests", dir)).length === 0) rmdirSync(join(ROOT, "tests", dir));
    console.log(`moved ${moves.length}`);
  }

  if (flags.includes("--paths")) {
    let files = 0;
    for (const file of git("ls-files", "-z").split("\0").filter((f) => f && !KEPT(f))) {
      const path = join(ROOT, file);
      if (!existsSync(path) || statSync(path).size > 4_000_000) continue;
      const text = readFileSync(path, "utf8");
      // Not text: an archive, a picture.
      if (text.includes("\0") || !/\b(unit|integration)\//.test(text)) continue;
      const next = rewritten(text, moved);
      if (next === text) continue;
      writeFileSync(path, next);
      files++;
    }
    console.log(`rewrote old paths in ${files} files`);
  }
  if (!flags.includes("--move") && unplaced + moves.length > 0) process.exit(1);
}
