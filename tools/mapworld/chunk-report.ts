import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMap } from "../../shared/world/mapfile.ts";
import { reportPaths } from "./report-path.ts";
import { vocabulary } from "./ruin-vocabulary.ts";

const paths = reportPaths();
const map = parseMap(new Uint8Array(readFileSync(paths.mapFile)));
const rows = Array.from({ length: map.statics.first.length - 1 }, (_, chunk) => ({ chunk, pieces: map.statics.first[chunk + 1]! - map.statics.first[chunk]! })).sort((a, b) => b.pieces - a.pieces || a.chunk - b.chunk);
const peak = rows[0]!; const kinds: Record<string, number> = {};
for (let r = map.statics.first[peak.chunk]!; r < map.statics.first[peak.chunk + 1]!; r++) {
  const kind = map.statics.kinds[map.statics.kind[r]!]!; kinds[kind] = (kinds[kind] ?? 0) + 1;
}
const cap = vocabulary(paths.source).budgets.maxChunk;
const report = { mapHash: map.hash, total: map.statics.length, cap, passed: peak.pieces <= cap, maximum: peak.pieces, top: rows.slice(0, 30).map((r) => ({ x: r.chunk % map.dims.chunksX, z: Math.floor(r.chunk / map.dims.chunksX), pieces: r.pieces })), busiestKinds: kinds };
writeFileSync(join(paths.folder, "chunks.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ mapHash: map.hash, total: report.total, maximum: report.maximum, cap, passed: report.passed }));
if (!report.passed) process.exitCode = 1;
