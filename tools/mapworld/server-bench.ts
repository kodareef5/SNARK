import { reportPaths } from "./report-path.ts";
const paths = reportPaths();
// A server host without a socket or a client. Measures map IO, content compilation and world initialization together,
// and then the tick with nobody on: SETTLE ticks for what the map sets down to come to rest, and TIMED ticks timed. It
// fails when the median idle tick passes half a tick's time, which a server must keep for its players.
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { createHost } from "../../server/host.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { corePack } from "../../tests/fixtures/pack.ts";

const start = performance.now();
const bytes = new Uint8Array(readFileSync(paths.mapFile));
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const pack = corePack();
const host = createHost(compiled.registry, { map: bytes, wild: true, clips: pack.clips, rigs: pack.header.rigs });
const ready = performance.now();
const memory = process.memoryUsage();
const [SETTLE, TIMED] = [300, 300];
for (let k = 0; k < SETTLE; k++) host.game.tick();
const ticks: number[] = [];
for (let k = 0; k < TIMED; k++) {
  const t0 = performance.now();
  host.game.tick();
  ticks.push(performance.now() - t0);
}
ticks.sort((a, b) => a - b);
const idleTick = { p50: Number(ticks[TIMED >> 1]!.toFixed(2)), p90: Number(ticks[Math.floor(TIMED * 0.9)]!.toFixed(2)), most: Number(ticks.at(-1)!.toFixed(2)), budget: Number((500 / TICK_RATE).toFixed(2)) };
const report = { milliseconds: Number((ready - start).toFixed(1)), idleTick, residentMiB: Number((memory.rss / 1048576).toFixed(1)), heapMiB: Number((memory.heapUsed / 1048576).toFixed(1)), peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)), mapBytes: bytes.length, spawnRegions: host.spawner?.regions.length, scope: "createHost, real pack clips, wild spawner; no HTTP listener, persistence or clients; idleTick in ms after the map's bodies settle" };
writeFileSync(`${paths.folder}/server.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); host.shutdown();
if (idleTick.p50 > idleTick.budget) {
  console.log(`the tick with nobody on takes ${idleTick.p50} ms at the median, past half a tick's ${idleTick.budget} ms`);
  process.exitCode = 1;
}
