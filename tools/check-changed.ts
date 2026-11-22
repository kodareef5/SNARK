// `bun run check -- --changed`: the fast tests a change can reach, for a quick look while working (D794). The whole
// check before a commit stays the gate; this only spares running two thousand tests after every edit. It errs wide: a
// change it cannot follow runs the whole fast tier.

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { IMPORT, stripComments } from "./policy.ts";

/**
 * A change to any of these reaches tests that no import names, by the folders the code walks or the settings every test
 * runs under, so the whole fast tier runs.
 */
export const WHOLE = [/^content\//, /^config\//, /^tests\/fixtures\//, /^package\.json$/, /^bun\.lock$/, /^bunfig\.toml$/, /(^|\/)tsconfig[^/]*\.json$/, /^tools\/check[^/]*\.ts$/, /^tools\/policy\.ts$/];

/** The repository paths `file` imports by relative name. `src` is read without its comments unless `bare` says it is. */
export function importsOf(file: string, src: string, bare = false): string[] {
  const out: string[] = [];
  for (const m of (bare ? src : stripComments(src)).matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3]!;
    if (spec.startsWith(".")) out.push(posix.normalize(posix.join(posix.dirname(file), spec)));
  }
  return out;
}

/**
 * Of `tests`, those a change to `changed` can reach, or "all". A changed .ts file reaches what imports it, at any depth;
 * any other changed file reaches the code that names it (a document by its file name, say) and what imports that code.
 * `sources` holds every .ts file of the repository by its path there.
 */
export function affectedTests(changed: readonly string[], sources: ReadonlyMap<string, string>, tests: readonly string[]): string[] | "all" {
  if (changed.some((f) => WHOLE.some((r) => r.test(f)))) return "all";
  // Without comments: a file a comment names is read by nothing, and named every such file.
  const code = new Map([...sources].map(([file, src]) => [file, stripComments(src)]));
  const users = new Map<string, string[]>();
  for (const [file, src] of code) {
    for (const dep of importsOf(file, src, true)) {
      const list = users.get(dep);
      if (list) list.push(file);
      else users.set(dep, [file]);
    }
  }
  const reached = new Set<string>();
  for (const f of changed) {
    if (f.endsWith(".ts")) reached.add(f);
    else {
      const name = posix.basename(f);
      for (const [file, src] of code) if (src.includes(name)) reached.add(file);
    }
  }
  const queue = [...reached];
  while (queue.length > 0) {
    for (const user of users.get(queue.pop()!) ?? []) {
      if (!reached.has(user)) {
        reached.add(user);
        queue.push(user);
      }
    }
  }
  return tests.filter((t) => reached.has(t));
}

const git = (root: string, ...args: string[]): string[] => {
  const r = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().split("\n").filter(Boolean) : [];
};

/**
 * What differs from `base` (else where this branch left main), committed or not, untracked files counted, and every
 * .ts file to follow it through. Null if git cannot say.
 */
export function changedFiles(root: string, base?: string): { base: string; changed: string[]; sources: Map<string, string> } | null {
  const from = base ?? ["origin/main", "main"].map((ref) => git(root, "merge-base", "HEAD", ref)[0]).find(Boolean);
  if (!from || git(root, "rev-parse", "--verify", "--quiet", `${from}^{commit}`).length === 0) return null;
  const changed = [...new Set([...git(root, "diff", "--name-only", from), ...git(root, "ls-files", "--others", "--exclude-standard")])].sort();
  const sources = new Map<string, string>();
  for (const file of git(root, "ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts")) {
    try {
      sources.set(file, readFileSync(join(root, file), "utf8"));
    } catch {
      // Deleted in the working tree: nothing imports what is not there.
    }
  }
  return { base: from, changed, sources };
}
