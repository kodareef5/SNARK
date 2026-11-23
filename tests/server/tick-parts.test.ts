// Where a tick's time went (server/admin/parts.ts): every part of GameServer.tick and the host's step is marked in each
// tick; a tick, or the time before it, over the limit is kept whole with the loop's work between ticks; the ring keeps the
// newest; and the admin page reads it all.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LONG_KEPT, PART, PARTS, TickParts, measure, type TickReport } from "../../server/admin/parts.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { LANE_ROWS } from "../../server/lane.ts";
import { Harness } from "../fixtures/net.ts";
import { describe as describeTicks } from "../../tools/ticks.ts";

/** The parts a tick runs, as against those of the loop between ticks. */
const IN_TICK = PARTS.slice(0, PART.sockets);

test("with no limit every tick is kept, in order, with every part of the tick and the host's step given its time", () => {
  const h = new Harness();
  h.join("parts");
  const parts = h.server.parts;
  parts.limit = -1;
  h.run(2000);
  const report = parts.report();
  expect(report.ticks).toBe(h.world.tick);
  expect(report.long).toBe(h.world.tick);
  const recent = report.recent;
  expect(recent.length).toBe(Math.min(LONG_KEPT, h.world.tick));
  expect(recent.map((r) => r.tick)).toEqual(recent.map((_, i) => h.world.tick - recent.length + 1 + i));
  // Each part of a tick was reached in every tick: a part never marked would have been given none of any.
  for (const name of IN_TICK) expect([name, report.all[PART[name]]! > 0]).toEqual([name, true]);
  for (const r of recent) expect(r.parts.length).toBe(PARTS.length);
});

test("time between ticks keeps the tick after it however short that tick is, and a tick under the limit with none is not kept", () => {
  const parts = new TickParts();
  parts.limit = 1000;
  parts.begin();
  parts.end(1);
  parts.between(PART.sockets, 700);
  parts.between(PART.idle, 400);
  parts.begin();
  parts.mark(PART.bodies);
  parts.end(2);
  parts.begin();
  parts.end(3);
  const report = parts.report();
  expect(report.ticks).toBe(3);
  expect(report.long).toBe(1);
  const [kept] = report.recent;
  expect(kept!.tick).toBe(2);
  expect(kept!.parts[PART.sockets]).toBe(700);
  expect(kept!.parts[PART.idle]).toBe(400);
  expect(report.inLong[PART.sockets]).toBe(700);
  expect(report.all[PART.idle]).toBe(400);
});

test("the ring keeps the newest long ticks, oldest first", () => {
  const parts = new TickParts();
  parts.limit = -1;
  const n = LONG_KEPT + 40;
  for (let t = 1; t <= n; t++) {
    parts.begin();
    parts.end(t);
  }
  const ticks = parts.recent().map((r) => r.tick);
  expect(ticks.length).toBe(LONG_KEPT);
  expect(ticks[0]).toBe(n - LONG_KEPT + 1);
  expect(ticks.at(-1)).toBe(n);
});

test("the admin page reads the parts past its gate", async () => {
  const h = new Harness();
  const dir = mkdtempSync(join(tmpdir(), "snark-parts-"));
  try {
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>admin</title>");
    h.server.parts.limit = -1;
    h.run(500);
    const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h.host)), dir, start: { tick: 0, wall: Date.now() } });
    const shut = { dev: false, password: null, guesses: new Guesses(), tick: () => 0 };
    const req = new Request("http://localhost/admin/ticks.json");
    expect((await pages.answer(req, "1.2.3.4", shut, "/admin/ticks.json"))?.status).toBe(404);
    const open = { ...shut, dev: true };
    const res = await pages.answer(req, "127.0.0.1", open, "/admin/ticks.json");
    const report = (await res!.json()) as TickReport;
    expect(report.parts).toEqual([...PARTS]);
    expect(report.ticks).toBe(h.world.tick);
    expect(report.recent.length).toBe(h.world.tick);
    expect(report.physics?.rows).toEqual([...LANE_ROWS]);
    expect(describeTicks(report)).toContain(`physics by row, ms last tick / most lately / most since the start: ${LANE_ROWS.map((r) => `${r} 0.00/0.00/0.00`).join(", ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a long tick is the server's own when the process ran through it, else waiting for pages if it read any in, else waiting for a core", () => {
  const parts = new TickParts();
  const report = parts.report();
  const tick = (ms: number, counts: number[]) => ({ tick: 1, at: 0, ms, late: 0, parts: new Array<number>(PARTS.length).fill(0), counts, gap: [0, 0, 0, 0, 0] });
  expect(measure(report.limit, tick(100, [90, 0, 0, 0, 3])).whose).toBe("own");
  expect(measure(report.limit, tick(100, [10, 4, 0, 0, 3])).whose).toBe("page");
  expect(measure(report.limit, tick(100, [10, 0, 0, 0, 40])).whose).toBe("core");
  // One kept for the time before it is called by that time's counts.
  const before = { ...tick(5, [5, 0, 0, 0, 0]), gap: [2, 0, 0, 0, 9] };
  before.parts[PART.stray] = 80;
  expect(measure(report.limit, before)).toEqual({ ms: 80, cpu: 2, pageIns: 0, preempted: 9, whose: "core" });
  expect(describeTicks({ ...report, recent: [tick(100, [90, 0, 0, 0, 3]), before] })[1]).toBe("by kind: the server's own 1 ticks, 100 ms (56%); waiting for a core 1 ticks, 80 ms (44%)");
});
