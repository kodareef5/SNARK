import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureReport } from "../../tools/capture-report.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "snark-capture-read-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
}

function archive(report: object, overrides: Record<string, string> = {}): string {
  const path = join(dir, "player capture.zip");
  const files = {
    "report.json": JSON.stringify({ kind: "capture", ms: 12000, map: { id: "core:miami" }, shots: [{}], ...report }),
    "perf.json": JSON.stringify({ summary: { frames: 630, middle: 17, p95: 22, worst: 80 } }),
    "events.json": JSON.stringify({ events: [{ kind: "hitch", size: 80, at: 2000 }] }),
    "log.json": JSON.stringify({ lines: [{ level: "error", source: "page", text: "picture missing" }] }),
    "net.json": JSON.stringify({ seconds: 12, categories: [{ name: "world", bytes: [240] }] }),
    "shot-01.jpg": "a picture",
    ...overrides,
  };
  execFileSync("python3", ["-I", "-c", [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as archive:",
    " for name, text in json.load(sys.stdin).items(): archive.writestr(name, text)",
  ].join("\n"), path], { input: JSON.stringify(files) });
  return path;
}

test("a player capture names the source revision and summarizes the client records", () => {
  git("init", "-q");
  git("commit", "-qm", "first", "--allow-empty");
  const first = git("rev-parse", "HEAD");
  const zip = archive({ build: { commit: first, clean: true, wire: 42 } });
  const summary = captureReport(zip, dir).join("\n");
  for (const part of [first, "matches this checkout", "Wire 42", "core:miami", "630 timed frames", "22.0 ms", "1 hitch", '"picture missing"', "world 20", "shot-01.jpg"]) {
    expect(summary).toContain(part);
  }
  git("commit", "-qm", "second", "--allow-empty");
  const second = git("rev-parse", "HEAD");
  const compared = captureReport(zip, dir).join("\n");
  expect(compared).toContain(second);
  expect(compared).toContain(`git show ${first}:<path>`);
  expect(git("rev-parse", "HEAD")).toBe(second);
  const missing = captureReport(archive({ build: { commit: "f".repeat(40), clean: false } }), dir).join("\n");
  expect(missing).toContain("with local changes");
  expect(missing).toContain("missing from this clone");
});

test("a capture without a recorded commit still reports its frame times", () => {
  const summary = captureReport(archive({}), dir).join("\n");
  expect(summary).toContain("Client commit unknown");
  expect(summary).toContain("commits cannot be compared");
  expect(summary).toContain("Median 17.0 ms");
});

test("the capture reader reports damaged records and missing pictures", () => {
  expect(() => captureReport(archive({}, { "events.json": "broken" }), dir)).toThrow("not JSON");
  expect(() => captureReport(archive({ shots: [{}, {}] }), dir)).toThrow("pictures");
  const path = join(dir, "broken.zip");
  writeFileSync(path, "incomplete");
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../tools/reports.ts"), "capture", path]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Could not read capture");
});
