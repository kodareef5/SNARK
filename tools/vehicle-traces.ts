// Compares every vehicle course (tests/fixtures/vehicle-traces.ts) as the working tree runs it with the same courses as
// another version runs them, bit for bit. A change that only moves code shows nothing; one that changes behaviour shows
// the first tick and field where each course parted, and nothing is kept between runs.
//
//   bun tools/vehicle-traces.ts                  against the last commit
//   bun tools/vehicle-traces.ts --against <ref>  against any commit, branch or tag

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURE = "tests/fixtures/vehicle-traces.ts";
/** What the courses import, all of which a version is unpacked with. */
const TREES = ["shared", "content", "tests/fixtures"];

type Line = [course: string, tick: number, fields: Record<string, string>];

function run(cmd: string[], cwd: string, input?: Uint8Array): Uint8Array {
  const p = Bun.spawnSync(cmd, { cwd, stdin: input ?? "ignore", stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed:\n${p.stderr.toString()}`);
  return p.stdout;
}

/** The courses as the code at `dir` runs them. */
function courses(dir: string): Line[] {
  if (!existsSync(join(dir, FIXTURE))) throw new Error(`${dir} has no ${FIXTURE}: that version has no vehicle courses to compare with`);
  const text = new TextDecoder().decode(run(["bun", FIXTURE], dir));
  return text.trim().split("\n").map((l) => JSON.parse(l) as Line);
}

/** The code of `ref` unpacked into a folder of its own under .cache, made again each run. */
function unpack(ref: string): string {
  const sha = new TextDecoder().decode(run(["git", "rev-parse", "--verify", `${ref}^{commit}`], ROOT)).trim();
  const dir = join(ROOT, ".cache", "vehicle-traces", sha);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = run(["git", "archive", "--format=tar", sha, ...TREES], ROOT);
  run(["tar", "-x", "-C", dir], ROOT, tar);
  return dir;
}

const dv = new DataView(new ArrayBuffer(8));
/** A field's value as a reader wants it: a number from its bytes, else as written. */
function shown(v: string | undefined): string {
  if (v === undefined) return "(none)";
  if (!/^[0-9a-f]{16}$/.test(v)) return v;
  dv.setBigUint64(0, BigInt(`0x${v}`));
  return String(dv.getFloat64(0));
}

/** Each course's first difference, and the fields one side has that the other lacks. Empty when they agree. */
export function compare(was: Line[], now: Line[]): string[] {
  const out: string[] = [];
  const byCourse = (lines: Line[]): Map<string, Line[]> => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      const list = m.get(l[0]);
      if (list) list.push(l);
      else m.set(l[0], [l]);
    }
    return m;
  };
  const a = byCourse(was), b = byCourse(now);
  for (const course of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(course), y = b.get(course);
    if (!x || !y) {
      out.push(`${course}: only ${x ? "before" : "now"}`);
      continue;
    }
    const names = new Set(Object.keys(x[0]![2])), others = new Set(Object.keys(y[0]![2]));
    const gone = [...names].filter((n) => !others.has(n)), added = [...others].filter((n) => !names.has(n));
    if (gone.length) out.push(`${course}: fields gone: ${gone.join(", ")}`);
    if (added.length) out.push(`${course}: fields new: ${added.join(", ")}`);
    if (x.length !== y.length) out.push(`${course}: ${x.length} ticks before, ${y.length} now`);
    find: for (let i = 0; i < Math.min(x.length, y.length); i++) {
      for (const name of names) {
        if (!others.has(name) || x[i]![2][name] === y[i]![2][name]) continue;
        out.push(`${course}: first differs at tick ${x[i]![1]}, ${name}: ${shown(x[i]![2][name])} before, ${shown(y[i]![2][name])} now`);
        break find;
      }
    }
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--against");
  const ref = at >= 0 ? args[at + 1] ?? "HEAD" : "HEAD";
  const was = courses(unpack(ref)), now = courses(ROOT);
  const found = compare(was, now);
  const ticks = now.length;
  if (found.length === 0) console.log(`the same as ${ref}: ${new Set(now.map((l) => l[0])).size} courses, ${ticks} ticks, bit for bit`);
  else {
    console.log(`differs from ${ref}:`);
    for (const line of found) console.log(`  ${line}`);
    process.exitCode = 1;
  }
}
