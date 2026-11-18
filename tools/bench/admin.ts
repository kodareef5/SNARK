// What the /admin/ page's routes cost the tick thread (server/admin/routes.ts), with 50 and then 200 survivors and 2,000
// creatures in the world: each answer made afresh, as it is once a second, and asked again within the second, as a second
// page polling is answered; and what timing one tick adds to the loop (server/admin/meter.ts).
//
//   bun tools/bench/admin.ts

import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { AdminGate } from "../../server/admin/gate.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { createHost } from "../../server/host.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { MARKER_DEATH } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";

const ROUTES = ["/admin/stats.json", "/admin/survivors.json", "/admin/minutes.json", "/admin/bases.bin?level=3"];
const BUILDS = 60;

const { registry } = compileContent(CORE_CONTENT);
const reg = registry!;
const dir = mkdtempSync(join(tmpdir(), "snark-admin-bench-"));
const host = createHost(reg, { dbPath: join(dir, "world.db"), backups: false });
const rng = new Rng(5);
const { sizeX, sizeZ } = host.world.hf;
for (let n = 0, tries = 0; n < 2000 && tries < 20000; tries++) if (host.spawnCreature("core:grazer", rng.range(20, sizeX - 20), rng.range(20, sizeZ - 20), 1 + rng.int(150)) >= 0) n++;
// A day of minutes, so the minutes' first answer is the longest it can be.
let clock = 0;
const meter = new TickMeter(() => gaugesOf(host), (c) => c, 0);
for (let m = 0; m < 1441; m++) for (let t = 0; t < 30; t++, clock += 2000) meter.tick(clock, clock, clock + 2);
let now = Date.now();
const pages = new AdminPages({ host, meter, dir, start: { tick: host.world.tick, wall: now }, now: () => now });
const gate: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
const survivor = reg.index.get("core:survivor")!;
let made = 0;

/** Survivors up to `n`, offline with a play time, a level and five deaths each, as a busy world's records are. */
function survivors(n: number): void {
  for (; made < n; made++) {
    const rec = host.records.create(survivor, `survivor ${made}`);
    host.persistence!.bindSurvivor(rec.name, rec.pid);
    rec.x = rng.range(0, sizeX);
    rec.z = rng.range(0, sizeZ);
    rec.xp = rng.int(200000);
    for (let k = 0; k < 5; k++) rec.markers.push({ kind: MARKER_DEATH, x: rec.x, y: 0, z: rec.z, tick: host.world.tick - k });
    host.activity.login(rec.pid);
    host.activity.leave(rec.pid);
  }
}

const ms = (v: number): string => `${v.toFixed(3)} ms`;
console.log(`load ${loadavg().map((v) => v.toFixed(2)).join(" ")}, ${host.world.ents.count} bodies`);
for (const n of [50, 200]) {
  survivors(n);
  console.log(`\n${n} survivors`);
  for (const path of ROUTES) {
    const fresh: number[] = [];
    const again: number[] = [];
    let bytes = 0;
    for (let k = 0; k < BUILDS; k++) {
      now += 1000;
      const req = new Request(`http://localhost${path}`);
      let t0 = performance.now();
      const res = pages.answer(req, "127.0.0.1", gate, new URL(req.url).pathname)!;
      fresh.push(performance.now() - t0);
      bytes = (await res.arrayBuffer()).byteLength;
      t0 = performance.now();
      pages.answer(req, "127.0.0.1", gate, new URL(req.url).pathname);
      again.push(performance.now() - t0);
    }
    fresh.sort((a, b) => a - b);
    again.sort((a, b) => a - b);
    console.log(`  ${path.padEnd(26)} made ${ms(fresh[BUILDS >> 1]!)} median, ${ms(fresh.at(-1)!)} worst; asked again ${ms(again[BUILDS >> 1]!)}; ${bytes} bytes`);
  }
}
const N = 1_000_000;
const t0 = performance.now();
for (let i = 0; i < N; i++, clock += 33) meter.tick(clock, clock, clock + 2);
console.log(`\nthe meter: ${(((performance.now() - t0) / N) * 1e6).toFixed(0)} ns a tick, beside two calls of performance.now`);
host.shutdown();
rmSync(dir, { recursive: true, force: true });
