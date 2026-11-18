// bun tools/bench/collision-report.ts <one or more JSONL files written by collision-network.ts>
import { readFileSync } from "node:fs";
import type { collisionNetworkTrial } from "./collision-network.ts";

type Trial = ReturnType<typeof collisionNetworkTrial>;

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

function range(values: (number | null)[]) {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return sorted.length ? { p95: percentile(sorted, .95), worst: sorted.at(-1)! } : null;
}

function report(rows: Trial[]) {
  const predicted = rows.filter(r => r.predictedHit !== null), drawn = rows.filter(r => r.drawnHit !== null);
  const bytes = rows.map(r => r.driverDownlinkBytesPerSec).sort((a,b) => a-b);
  return {
    encounters: rows.length, serverHits: rows.filter(r => r.serverHit).length,
    predictedAgreement: [predicted.filter(r => r.predictedHit === r.serverHit).length, predicted.length],
    drawnAgreement: [drawn.filter(r => r.drawnHit === r.serverHit).length, drawn.length],
    rawMetres: range(rows.map(r => r.peakTranslationM)), rawDegrees: range(rows.map(r => r.peakYawDeg)),
    displayedStepMetres: range(rows.map(r => r.peakDisplayCorrectionM)), displayedStepDegrees: range(rows.map(r => r.peakDisplayCorrectionYawDeg)),
    drawnOverlapMetres: range(drawn.map(r => r.deepestDrawnOverlapM)),
    gapAtServerHitMetres: range(drawn.filter(r => r.serverHit && r.drawnGapAtImpactM !== null).map(r => Math.abs(r.drawnGapAtImpactM!))),
    fadeMs: range(rows.map(r => Math.max(0, r.lastVisibleFadeMs ?? 0))),
    downlinkMedianBytesPerSec: (bytes[(bytes.length - 1) >> 1]! + bytes[bytes.length >> 1]!) / 2,
  };
}

if (process.argv.length < 3) throw new Error("Pass at least one collision-network JSONL file.");
for (const path of process.argv.slice(2)) {
  const rows: Trial[] = readFileSync(path, "utf8").trim().split("\n").map(s => JSON.parse(s));
  const cases = [...new Set(rows.map(r => r.kind))];
  console.log(JSON.stringify({ path, all: report(rows), cases: Object.fromEntries(cases.map(k => [k, report(rows.filter(r => r.kind === k))])) }));
}
