// The survivor log's routes under /admin/log/ (server/admin/log-routes.ts): behind the gate in any spelling, every
// parameter checked and bounded, each answer the log's own JSON passed on as it is, one read for the same question in a
// second, a world with no log saying so, and a death's time read from the log.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stats, Survivors } from "../../shared/admin.ts";
import { MARKER_DEATH } from "../../shared/net/protocol.ts";
import type { AdminGate } from "../../server/admin/gate.ts";
import { WINDOW_LEAST } from "../../client/core/admin/timeline.ts";
import { WINDOW_MOST } from "../../server/admin/log-routes.ts";
import { TickMeter } from "../../server/admin/meter.ts";
import { AdminPages } from "../../server/admin/routes.ts";
import { gaugesOf } from "../../server/admin/stats.ts";
import { Guesses } from "../../server/guesses.ts";
import { MIN_STEP } from "../../server/survivor-log/store.ts";
import { LOG_ALIVE, LOG_STATES } from "../../shared/survivor-log.ts";
import { STATE_ALIVE, STATE_AWAY, STATE_DEAD, STATE_NAMES, STATE_OUT, STATE_SPECTATING } from "../../server/survivor-log/format.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-admin-log-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const W0 = Date.UTC(2026, 10, 17, 21, 0, 0);
const dev: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };

/** A world with a save, whose log's clock and the pages' run with its virtual time from W0, and the pages over it. */
function world(db: string | null): { h: Harness; pages: AdminPages; now: () => number; ask: (path: string, gate?: AdminGate) => Promise<Response> } {
  let h: Harness | null = null;
  const now = (): number => W0 + Math.round(h?.now ?? 0);
  h = new Harness({ lingerTicks: 0 }, 1, 60, { dev: true, ...(db ? { dbPath: join(dir, db) } : {}), survivorLog: { wall: now } });
  const pages = new AdminPages({ host: h.host, meter: new TickMeter(() => gaugesOf(h!.host)), dir, start: { tick: 0, wall: W0 }, now });
  const ask = async (path: string, gate = dev): Promise<Response> => {
    const req = new Request(`http://localhost${path}`);
    return (await pages.answer(req, "1.2.3.4", gate, new URL(req.url).pathname))!;
  };
  return { h, pages, now, ask };
}

test("the log's routes answer only past the gate, each read's own JSON as it is, and every parameter is checked", async () => {
  const { h, now, ask } = world("play.db");
  try {
    const log = h.host.survivorLog;
    const ana = h.join("ana");
    h.run(1500);
    h.say(ana, "enablecheats");
    const from = now();
    h.say(ana, "give stone 5");
    h.say(ana, "give spear 1 apprentice", 7000);
    h.pilots[0]!.moveZ = 1;
    h.run(3000);
    h.pilots[0]!.moveZ = 0;
    log.flush();
    const to = now();
    const pid = h.client(ana)!.pid;
    const shut: AdminGate = { dev: false, password: null, guesses: new Guesses(), tick: () => 0 };
    const gated: AdminGate = { ...shut, password: "kiwi" };
    for (const path of ["/admin/log/span.json", "/admin/log/survivors.json", "/Admin/Log/Positions.json", "//admin/log/marks.json", "/admin/log/%68eld.json", "/admin/log/nothing"]) {
      expect([path, (await ask(path, shut)).status, (await ask(path, gated)).status]).toEqual([path, 404, 401]);
    }
    const span = (await (await ask("/admin/log/span.json")).json()) as Record<string, unknown>;
    expect([span.on, span.why, span.now, "folder" in span, typeof span.from, span.cap]).toEqual([true, "", now(), false, "number", 1024 * 1048576]);
    const window = `from=${from}&to=${to}`;
    // Each answer is the log's JSON, made on its thread, passed on as it is.
    const same: [string, Promise<string>][] = [
      [`/admin/log/survivors.json?${window}`, log.json("survivors", from, to)],
      [`/admin/log/positions.json?${window}&step=1000`, log.json("positions", from, to, 1000)],
      [`/admin/log/track.json?pid=${pid}&${window}&step=500`, log.json("track", pid, from, to, 500)],
      [`/admin/log/held.json?pid=${pid}&at=${to}`, log.json("heldAt", pid, to)],
      [`/admin/log/changes.json?pid=${pid}&${window}`, log.json("changes", pid, from, to)],
      [`/admin/log/holders.json?item=core:spear&${window}&quality=2&blueprint=0`, log.json("holders", "core:spear", from, to, 2, false)],
      [`/admin/log/holders.json?item=core:stone&${window}`, log.json("holders", "core:stone", from, to, undefined, undefined)],
      [`/admin/log/items.json?${window}`, log.json("items", from, to)],
      [`/admin/log/marks.json?${window}`, log.json("marks", from, to)],
      [`/admin/log/tick.json?wall=${to}`, log.json("tickAt", to)],
      [`/admin/log/wall.json?tick=${h.world.tick}`, log.json("wallAt", h.world.tick)],
    ];
    for (const [path, text] of same) {
      const res = await ask(path);
      expect([path, res.status, res.headers.get("content-type"), await res.text()]).toEqual([path, 200, "application/json", await text]);
    }
    expect((JSON.parse(await (await ask(`/admin/log/changes.json?pid=${pid}&${window}`)).text()) as { gained: { item: string }[] }).gained.map((g) => g.item)).toEqual(["core:spear", "core:stone"]);
    // Every parameter checked: missing, malformed, out of its bounds, an item the content does not have.
    const bad: [string, string][] = [
      ["/admin/log/survivors.json", "from is a whole number"],
      [`/admin/log/survivors.json?from=${to}&to=${from}`, "to is at or after from"],
      [`/admin/log/survivors.json?from=0&to=${WINDOW_MOST + 1}`, "to is at or after from"],
      [`/admin/log/survivors.json?from=1.5&to=9`, "from is a whole number"],
      [`/admin/log/survivors.json?from=-1&to=9`, "from is a whole number"],
      [`/admin/log/positions.json?${window}`, "step is a whole number"],
      [`/admin/log/positions.json?${window}&step=${MIN_STEP - 1}`, "step is a whole number"],
      [`/admin/log/track.json?pid=0&${window}&step=1000`, "pid is a whole number"],
      [`/admin/log/held.json?pid=${pid}`, "at is a whole number"],
      [`/admin/log/holders.json?item=core:nothing&${window}`, "item is the content id"],
      [`/admin/log/holders.json?item=core:spear&${window}&quality=9`, "quality is a whole number from 0 to 5"],
      [`/admin/log/holders.json?item=core:spear&${window}&blueprint=yes`, "blueprint is 0 or 1"],
      ["/admin/log/wall.json?tick=x", "tick is a whole number"],
    ];
    for (const [path, says] of bad) {
      const res = await ask(path);
      expect([path, res.status, (await res.text()).startsWith(says)]).toEqual([path, 400, true]);
    }
    expect((await ask("/admin/log/nothing.json")).status).toBe(404);
  } finally {
    h.host.shutdown();
  }
});

test("the same question within a second is one read, and a page polling the span costs no read at all", async () => {
  const { h, ask, now } = world("cache.db");
  try {
    const log = h.host.survivorLog;
    h.join("bo");
    h.run(1500);
    log.flush();
    let reads = 0;
    const json = log.json.bind(log);
    log.json = ((...a: Parameters<typeof json>) => (reads++, json(...a))) as typeof log.json;
    const path = `/admin/log/survivors.json?from=${W0}&to=${now()}`;
    const [a, b] = await Promise.all([ask(path), ask(path)]);
    expect([await a.text() === await b.text(), reads]).toEqual([true, 1]);
    await ask("/admin/log/span.json");
    expect(reads).toBe(1);
    h.run(1000);
    await ask(path);
    expect(reads).toBe(2);
  } finally {
    h.host.shutdown();
  }
});

test("a world with no save has no log, says why, and every read answers empty", async () => {
  const { h, ask } = world(null);
  try {
    h.join("cy");
    h.run(1000);
    const span = (await (await ask("/admin/log/span.json")).json()) as Record<string, unknown>;
    expect([span.on, span.why, span.from, span.to]).toEqual([false, "this world is not saved to disk, so it keeps no survivor log", null, null]);
    expect(await (await ask(`/admin/log/survivors.json?from=${W0}&to=${W0 + 1000}`)).text()).toBe("[]");
    expect(JSON.parse(await (await ask(`/admin/log/positions.json?from=${W0}&to=${W0 + 1000}&step=1000`)).text()).tracks).toEqual([]);
    const stats = (await (await ask("/admin/stats.json")).json()) as Stats;
    expect([stats.log.on, stats.log.why, "folder" in stats.log]).toEqual([false, "this world is not saved to disk, so it keeps no survivor log", false]);
  } finally {
    h.host.shutdown();
  }
});

test("a death's time in the list of survivors is the log's reading of its tick, and this run's reckoning where the log has none", async () => {
  const { h, ask } = world("deaths.db");
  try {
    const log = h.host.survivorLog;
    const ana = h.join("ana");
    h.run(3000);
    log.flush();
    const rec = h.host.records.byPid.get(h.client(ana)!.pid)!;
    const tick = h.world.tick - 30;
    // Tick 5 is before the log began, which this run's start places at five ticks after W0.
    rec.markers.push({ kind: MARKER_DEATH, x: 1, y: 0, z: 2, tick: 5 }, { kind: MARKER_DEATH, x: 3, y: 0, z: 4, tick });
    const got = (await (await ask("/admin/survivors.json")).json()) as Survivors;
    const deaths = got.survivors.find((s) => s.name === "ana")!.deaths;
    const wall = await log.wallAt(tick);
    expect(wall).not.toBeNull();
    expect(deaths.map((d) => [d.tick, d.at])).toEqual([[5, (await log.wallAt(5)) ?? Math.round(W0 + (5 / 30) * 1000)], [tick, wall]]);
  } finally {
    h.host.shutdown();
  }
});

test("the shapes the page reads agree with the log's own: its states by number, and the narrowest window is wider than a step", () => {
  expect([STATE_ALIVE, STATE_OUT, STATE_DEAD, STATE_SPECTATING, STATE_AWAY]).toEqual([0, 1, 2, 3, 4]);
  expect(LOG_STATES).toEqual(STATE_NAMES);
  expect(LOG_ALIVE).toBe(STATE_ALIVE);
  expect(WINDOW_LEAST).toBeGreaterThan(MIN_STEP * 10);
});
