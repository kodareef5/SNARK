// A player's browser ZIP carries its own build and client records. Reading it leaves the checkout and archive alone.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { captureText, checkoutBuild, type CaptureFiles } from "../server/reports.ts";
import { EVENTS_SHAPE, LOG_SHAPE, NET_SHAPE, REPORT_BYTES_MOST, cleanPerf, cleanRecord, cleanReport, shotFile, type PerfSummary } from "../shared/report.ts";

function sourceState(clean: boolean | undefined): string {
  if (clean === true) return "clean";
  if (clean === false) return "with local changes";
  return "cleanliness unknown";
}

export function captureReport(path: string, root: string): string[] {
  const reader = spawnSync("python3", ["-I", join(import.meta.dir, "capture-records.py"), path, String(REPORT_BYTES_MOST)], {
    encoding: "utf8", maxBuffer: REPORT_BYTES_MOST * 6 + 65536, stdio: ["ignore", "pipe", "pipe"],
  });
  if (reader.error) throw reader.error;
  if (reader.status !== 0) throw new Error(reader.stderr.trim() || "the ZIP reader stopped");
  const zip = JSON.parse(reader.stdout) as Record<`${string}.json`, string> & { pictures: string[] };
  const read = cleanReport(zip["report.json"]);
  if ("fault" in read) throw new Error(read.fault);
  const report = read.report;
  if (report.kind !== "capture") throw new Error("report.json must describe a debug capture");
  const performance = cleanPerf(zip["perf.json"]);
  if ("fault" in performance) throw new Error(performance.fault);
  const files: CaptureFiles = { perf: performance.perf, records: {} };
  for (const [name, shape] of [["events.json", EVENTS_SHAPE], ["log.json", LOG_SHAPE], ["net.json", NET_SHAPE]] as const) {
    const value = cleanRecord(zip[name], shape, name);
    if ("fault" in value) throw new Error(value.fault);
    files.records[name] = value.record;
  }
  // Span parents are registered before their children. Invalid links cannot name timing paths.
  const spans = performance.perf.spans as { parents?: number[] } | undefined;
  if (spans?.parents?.some((p, i) => p < -1 || p >= i)) throw new Error("perf.json has an invalid span parent");
  const pictures = report.shots.map((_, i) => shotFile(i));
  if (pictures.length !== zip.pictures.length || !pictures.every((name) => zip.pictures.includes(name))) throw new Error("the pictures in the ZIP disagree with report.json");

  const stamp = JSON.parse(zip["report.json"]).build as { commit?: unknown; wire?: unknown } | undefined;
  const commit = typeof stamp?.commit === "string" && /^[0-9a-f]{40}$/.test(stamp.commit) ? stamp.commit : undefined;
  const wire = typeof stamp?.wire === "number" && Number.isSafeInteger(stamp.wire) ? stamp.wire : undefined;
  const checkout = checkoutBuild(root);
  const current = checkout.commit === "unknown" ? undefined : checkout.commit;
  let comparison = "The commits cannot be compared.";
  if (commit && current) {
    if (commit === current) comparison = "The commit matches this checkout.";
    else {
      const hasCommit = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" }).status === 0;
      comparison = hasCommit ? `The commits differ. Read the captured revision with git show ${commit}:<path>.` : "The commits differ. The captured commit is missing from this clone.";
    }
  }
  const summary = (performance.perf.summary ?? {}) as PerfSummary;
  const ms = (value?: number): string => value === undefined ? "unknown" : `${value.toFixed(1)} ms`;
  return [
    `Client commit ${commit ?? "unknown"} (${sourceState(report.build?.clean)}).${wire === undefined ? "" : ` Wire ${wire}.`}`,
    `Checkout ${current ?? "unknown"} (${sourceState(checkout.clean)}).`,
    comparison,
    `Map ${JSON.stringify(report.map?.id ?? "unknown")}. Capture ${(report.ms ?? 0) / 1000} s.`,
    `${summary.frames ?? 0} timed frames. Median ${ms(summary.middle)}, 95th percentile ${ms(summary.p95)}, worst ${ms(summary.worst)}.`,
    `Pictures (${pictures.length}): ${pictures.join(", ") || "none"}.`,
    ...captureText(".", files),
  ];
}
