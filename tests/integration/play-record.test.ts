// A development page's record of play (client/core/diagnostics.ts), written by the server beside its own view of the same
// ticks (server/playlog.ts) and sorted by cause (tools/play.ts): each cause that can be brought about over the loopback
// lands in its own row.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { CATCH_UP_MS } from "../../server/main.ts";
import { PlayLog } from "../../server/playlog.ts";
import { CAUSES, describe, judge, sessions, type Cause, type Line } from "../../tools/play.ts";
import { Harness } from "../fixtures/net.ts";

/**
 * A walker whose page keeps the record and posts it to a server that writes it. Until `loop.held` the server's loop runs
 * no tick; then, as server/main.ts tickLoop does, it gives up those owed past CATCH_UP_MS and catches up the rest.
 */
function recorded(link: LinkOptions, opts: { unheld?: boolean; manual?: boolean } = {}) {
  const h = new Harness({}, 1, 60);
  const lines: Line[] = [];
  const log = new PlayLog(h.server, (line) => void lines.push(JSON.parse(line) as Line), () => 0);
  // The loop's clock is the harness's: each tick due on its own time, begun when the harness runs it.
  const tick = h.server.tick.bind(h.server);
  const loop = { due: 0, held: 0, owed: 0 };
  const tickMs = 1000 / TICK_RATE;
  h.server.tick = () => {
    loop.due += tickMs;
    if (h.now < loop.held) return void loop.owed++;
    if (loop.owed * tickMs > CATCH_UP_MS) {
      const given = Math.ceil((loop.owed * tickMs - CATCH_UP_MS) / tickMs);
      loop.owed -= given;
      h.server.giveUp(given);
      log.drop(given);
    }
    for (; loop.owed >= 0; loop.owed--) {
      tick(loop.owed);
      log.ticked(loop.due - loop.owed * tickMs, h.now, h.now, loop.owed);
    }
    loop.owed = 0;
  };
  const ground = opts.unheld ? mapHeightfield(parseMap(h.host.mapFile!)) : undefined;
  ground?.holdNone();
  const s = h.join("ada", link, { ...(ground ? { ground } : {}), ...(opts.manual ? { manual: true } : {}) });
  const rejected: string[] = [];
  s.prediction.start((report) => {
    const why = log.report(report);
    if (why) rejected.push(why);
  });
  const pilot = h.pilots[0]!;
  /** Walks, turning every half second, for `ms`. */
  const walk = (ms: number, each?: (now: number) => void): void => {
    for (let t = 0; t < ms; t += 500) {
      pilot.moveZ = 1;
      pilot.yaw = (pilot.yaw + 1.3) % (2 * Math.PI);
      h.run(500, each);
    }
  };
  const end = (): { rows: Record<Cause, number>; text: string[]; judged: ReturnType<typeof judge> } => {
    s.close();
    h.run(200);
    expect(rejected).toEqual([]);
    const all = sessions(lines);
    expect(all.length).toBe(1);
    const judged = judge(all[0]!);
    const rows = Object.fromEntries(CAUSES.map((c) => [c, judged.corrections.filter((x) => x.cause === c).length])) as Record<Cause, number>;
    h.host.shutdown();
    return { rows, text: describe(all[0]!), judged };
  };
  return { h, s, pilot, walk, end, loop, ground };
}

test("a clean line and a page that keeps up: nothing corrected, and the record says so", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  r.walk(8000);
  const { rows, text } = r.end();
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, rewound: 0, disagree: 0 });
  expect(text.at(-1)).toContain("nothing went wrong");
});

test("beside the loop's ticks, the record names whose each long tick was, from the server's own record of its parts", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  // Every tick is kept as long, so every tick a report covers is named.
  r.h.server.parts.limit = -1;
  r.walk(6000);
  const { text } = r.end();
  const line = text.find((l) => l.startsWith("  the server's long ticks: "));
  expect(line).toBeDefined();
  const [own, core, page] = /: (\d+) its own work, (\d+) waiting for a core, (\d+) waiting for pages/.exec(line!)!.slice(1).map(Number);
  expect(own! + core! + page!).toBeGreaterThan(TICK_RATE);
});

test("a page that stalls while it walks: its clock keeps time, nothing is corrected, and the late snapshots are the page's", () => {
  const r = recorded({ tcp: true, latencyMs: 40 }, { manual: true });
  const pilot = r.pilot;
  // A stalled page reads nothing from its socket either: what comes waits for the frame after.
  const end = r.h.ends[0]!, read = end.onMessage!, waiting: [number, Uint8Array][] = [];
  let stalled = false;
  end.onMessage = (channel, data) => void (stalled ? waiting.push([channel, data]) : read(channel, data));
  r.h.run(500, (now) => r.s.update(now, 0, 0, 0, 0, 0));
  for (let k = 0; k < 12; k++) {
    pilot.moveZ = 1;
    pilot.yaw = (pilot.yaw + 1.3) % (2 * Math.PI);
    const from = r.h.now;
    // Every other second the page draws nothing for 400 ms, as a frame that lands a part of the map.
    r.h.run(1000, (now) => {
      stalled = k % 2 === 1 && now - from > 300 && now - from < 700;
      if (stalled) return;
      for (const [channel, data] of waiting.splice(0)) read(channel, data);
      r.s.update(now, pilot.moveX, pilot.moveZ, pilot.yaw, pilot.pitch, pilot.buttons);
    });
  }
  const { rows, judged, text } = r.end();
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, rewound: 0, disagree: 0 });
  expect(judged.frames.filter((f) => f.ms > 250).length).toBe(6);
  expect([judged.jumps.length, judged.gaps.length > 0, judged.gaps.every((g) => g.cause === "page")]).toEqual([0, true, true]);
  expect(text).toContain("  the page stalled 6 times past 250 ms, 0 of them costing a clock jump");
});

test("a line that holds inputs back while the page keeps up: its corrections are the line's", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  for (let k = 0; k < 8; k++) {
    // A spell in which every segment either way is lost, and sent again after it.
    r.walk(1000, (now) => void (now % 2000 < 1000 / 60 && r.h.net.outage(r.h.ends[0]!, 150)));
  }
  const { rows } = r.end();
  expect(rows.line).toBeGreaterThan(0);
  expect([rows.page, rows.server, rows.unheld, rows.rewound, rows.disagree]).toEqual([0, 0, 0, 0, 0]);
});

test("a server whose loop stalls and catches up while inputs are on their way: nothing is corrected, and the late snapshots are the server's", () => {
  const r = recorded({ tcp: true, latencyMs: 60 });
  for (let k = 0; k < 8; k++) {
    r.walk(1000, (now) => void (now % 2000 < 1000 / 60 && (r.loop.held = now + 400)));
  }
  const { rows, judged } = r.end();
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, rewound: 0, disagree: 0 });
  expect([judged.gaps.length > 0, judged.gaps.every((g) => g.cause === "server")]).toEqual([true, true]);
});

test("a server that falls behind and gives up the ticks due: the page's clock jumps for it, and the record says so first", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  r.walk(3000);
  r.loop.held = r.h.now + 2500;
  r.walk(6000);
  const { rows, text, judged } = r.end();
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, rewound: 0, disagree: 0 });
  expect(text[1]).toMatch(/^ {2}the server fell behind 1 time and gave up 1[0-9] ticks/);
  expect(judged.jumps.map((j) => [j.behind, j.cause])).toEqual([[false, "server"]]);
});

test("a page whose ground has not come: the stretch is not predicted, and what follows its coming is put down to that", () => {
  const r = recorded({ tcp: true, latencyMs: 40 }, { unheld: true });
  r.walk(4000);
  expect(r.s.predicting).toBe(false);
  r.ground!.hold(0, 0, r.ground!.dims.chunksX, r.ground!.dims.chunksZ);
  r.walk(4000);
  const { rows, text } = r.end();
  expect([rows.page, rows.line, rows.server, rows.rewound, rows.disagree]).toEqual([0, 0, 0, 0, 0]);
  expect(text.find((l) => l.includes("not predicted (the ground"))).toMatch(/: [34]\.\d s in 1 stretches/);
});

test("a disagreement planted on the server: one correction of the two ends, with the field that differed", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  r.walk(3000);
  const ents = r.h.world.ents, e = r.h.ent(r.s);
  ents.setPosition(e, ents.x[e]! + 0.5, ents.y[e]!, ents.z[e]!);
  r.walk(3000);
  const { rows, text, judged } = r.end();
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, rewound: 0, disagree: 1 });
  expect(judged.corrections[0]!.c.fields.map((f) => f[0])).toContain("x");
  expect(text.some((l) => /^ {4}x +1 /.test(l))).toBe(true);
});

test("a correction whose ticks the page forgot when its clock jumped back past those it sent is named for that, not left with the disagreements", () => {
  const view = { ticks: 90, snapshots: 90, skipped: 0, bytes: 0, waiting: 0, margin: [1, 2] as [number, number], lead: [1, 3] as [number, number], guessed: 0, longest: 0, guesses: [], late: 0, long: 0, given: 0, loop: [], whose: [] };
  const page = { v: 1, name: "ada", joined: 1, n: 0, from: 10, to: 200, ms: 5000, frames: 300, long: 0, over100: 0, over250: 0, worst: 0, ticks: 190, skipped: 0, unheld: 0, kinds: { "": 190 }, snapshots: 150, adopted: 0, moved: 2, state: 0, seats: 0, jumps: 1, margin: [1, 40] as [number, number], rtt: 2, x: 0, z: 0, frameList: [], gaps: [], unheldList: [], notes: [], t0: 0, dropped: 0, jumpList: [{ t: 120, by: -38, behind: false }], rewound: [[121, 160]] as [number, number][] };
  const correction = (t: number) => ({ t, since: t - 1, sim: t + 3, what: "moved", d: 0.05, kind: "", x: 1, y: 0, z: 1, m: 2, resumed: false, whole: true, rows: 0, statics: true, near: "", input: [0, 127, 0, 0, 0], fields: [["z", 1, 1.05]] as [string, number, number][] });
  const [s] = sessions([{ at: "", slot: 0, page: { ...page, corrections: [correction(125), correction(180)] }, server: view }]);
  expect(judge(s!).corrections.map((x) => [x.c.t, x.cause])).toEqual([[125, "rewound"], [180, "disagree"]]);
});
