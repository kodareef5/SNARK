// The end of `bun run check`: its verdict, and the failing tests it lists under .cache/check for whoever reads the run.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const plain = (xml: string): string => xml.replace(/&#10;/g, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * A line for each failing test: its file, its name and the first line of its error, with tabs between. `junit` is Bun's
 * report of the run and `out` what the run printed.
 */
export function failuresOf(junit: string, out: string): string[] {
  const lines: string[] = [];
  for (const m of junit.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*? file="([^"]*)"[^>]*>\s*<failure\b(?:[^>]*? message="([^"]*)")?/g)) {
    const name = [m[2]!, m[1]!].filter((part) => part !== "").map(plain).join(" > ");
    lines.push(`${m[3]}\t${name}\t${plain(m[4] ?? "").split("\n")[0]}`);
  }
  // A file that throws outside its tests, as it loads for one, has no test in the report to fail.
  let file = "";
  let thrown = false;
  for (const line of out.split("\n")) {
    const head = /^(\S+\.test\.ts):$/.exec(line);
    if (head) file = head[1]!;
    if (head || line.startsWith("# Unhandled error between tests")) thrown = !head;
    else if (thrown && line.startsWith("error: ")) {
      lines.push(`${file}\t(outside a test)\t${line.slice("error: ".length)}`);
      thrown = false;
    }
  }
  return lines;
}

/** The check's last lines. Tests skipped for missing art make the run no gate, unless `noArt` says they were meant to be. */
export function verdict(run: { problems: readonly string[]; art: boolean; noArt: boolean; passed: number; unart: number; ok: string }): { text: string; pass: boolean } {
  const count = (n: number): string => n.toLocaleString("en-US");
  // In the code as shown outside, the tests that need the art are skipped, and said to be.
  const skipped = run.art || !run.noArt ? "" : `\n${count(run.passed)} tests passed. ${count(run.unart)} were skipped: they need the art or the planning documents, which are not in this repository.`;
  const notGate = !run.art && !run.noArt && run.unart > 0 ? `\nNOT A GATE: ${count(run.unart)} tests skipped for missing art (run: bun run media art)` : "";
  if (run.problems.length > 0) return { text: `\nFAILED (${run.problems.length})\n` + run.problems.map((p) => " - " + p).join("\n") + skipped + notGate, pass: false };
  return notGate ? { text: notGate, pass: false } : { text: `\n${run.ok}${skipped}`, pass: true };
}

/** Writes a file whole or not at all, for a check running beside this one in the same checkout. */
export function writeWhole(file: string, text: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, text);
  renameSync(`${file}.${process.pid}`, file);
}
