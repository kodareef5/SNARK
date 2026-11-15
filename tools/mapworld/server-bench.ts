// A server host without a socket or a client. Measures map IO, content compilation and world initialization together.
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { createHost } from "../../server/host.ts";
import { corePack } from "../../tests/fixtures/pack.ts";

const start = performance.now();
const bytes = new Uint8Array(readFileSync(process.argv[2] ?? "var/maps/miami.snmap"));
const compiled = compileContent(CORE_CONTENT);
if (!compiled.registry) throw new Error(compiled.errors.join("\n"));
const pack = corePack();
const host = createHost(compiled.registry, { map: bytes, wild: true, clips: pack.clips, rigs: pack.header.rigs });
const ready = performance.now();
const memory = process.memoryUsage();
const report = { milliseconds: Number((ready - start).toFixed(1)), residentMiB: Number((memory.rss / 1048576).toFixed(1)), heapMiB: Number((memory.heapUsed / 1048576).toFixed(1)), peakResidentMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)), mapBytes: bytes.length, spawnRegions: host.spawner?.regions.length, scope: "createHost, real pack clips, wild spawner; no HTTP listener, persistence or clients" };
writeFileSync("assets/source/maps/miami/reports/ruins1/server.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2)); host.shutdown();
