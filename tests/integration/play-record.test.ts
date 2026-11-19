// A development page's record of play (client/core/diagnostics.ts), written by the server beside its own view of the same
// ticks (server/playlog.ts) and sorted by cause (tools/play.ts): each cause that can be brought about over the loopback
// lands in its own row.

import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { PlayLog } from "../../server/playlog.ts";
import { CAUSES, describe, judge, sessions, type Cause, type Line } from "../../tools/play.ts";
import { Harness } from "../fixtures/net.ts";

/**
 * A walker whose page keeps the record and posts it to a server that writes it. Until `loop.held` the server's loop runs
 * no tick, and then runs those due; with `loop.give`, as server/main.ts tickLoop does past 250 ms, it runs one and gives
 * up the rest.
 */
function recorded(link: LinkOptions, opts: { unheld?: boolean; manual?: boolean } = {}) {
  const h = new Harness({}, 1, 60);
  const lines: Line[] = [];
  const log = new PlayLog(h.server, (line) => void lines.push(JSON.parse(line) as Line), () => 0);
  // The loop's clock is the harness's: each tick due on its own time, begun when the harness runs it.
  const tick = h.server.tick.bind(h.server);
  const loop = { due: 0, held: 0, owed: 0, give: false };
  h.server.tick = () => {
    loop.due += 1000 / TICK_RATE;
    if (h.now < loop.held) return void loop.owed++;
    if (loop.give && loop.owed * (1000 / TICK_RATE) > 250) {
      tick();
      log.ticked(loop.due - loop.owed * (1000 / TICK_RATE), h.now, h.now);
      log.drop(loop.owed);
      loop.owed = 0;
      return;
    }
    for (; loop.owed >= 0; loop.owed--) {
      tick();
      log.ticked(loop.due - loop.owed * (1000 / TICK_RATE), h.now, h.now);
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
  r.walk(12000);
  const { rows, text } = r.end();
  console.log(text.join("\n"));
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, disagree: 0 });
  expect(text.at(-1)).toContain("nothing went wrong");
});

test("a page that stalls while it walks: its corrections are the page's", () => {
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
  const { rows, text, judged } = r.end();
  console.log(text.join("\n"));
  expect(rows.page).toBeGreaterThan(0);
  expect([rows.line, rows.server, rows.unheld, rows.disagree]).toEqual([0, 0, 0, 0]);
  expect(judged.frames.filter((f) => f.ms > 250).length).toBe(6);
});

test("a line that holds inputs back while the page keeps up: its corrections are the line's", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  for (let k = 0; k < 8; k++) {
    // A spell in which every segment either way is lost, and sent again after it.
    r.walk(1000, (now) => void (now % 2000 < 1000 / 60 && r.h.net.outage(r.h.ends[0]!, 150)));
  }
  const { rows, text } = r.end();
  console.log(text.join("\n"));
  expect(rows.line).toBeGreaterThan(0);
  expect([rows.page, rows.server, rows.unheld, rows.disagree]).toEqual([0, 0, 0, 0]);
});

test("a server whose loop stalls and catches up while inputs are on their way: its corrections are the server's", () => {
  const r = recorded({ tcp: true, latencyMs: 60 });
  for (let k = 0; k < 8; k++) {
    r.walk(1000, (now) => void (now % 2000 < 1000 / 60 && (r.loop.held = now + 240)));
  }
  const { rows, text } = r.end();
  console.log(text.join("\n"));
  expect(rows.server).toBeGreaterThan(0);
  expect([rows.page, rows.line, rows.unheld, rows.disagree]).toEqual([0, 0, 0, 0]);
});

test("a server that falls behind and gives up the ticks due: the page's clock jumps for it, and the record says so first", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  r.walk(3000);
  r.loop.held = r.h.now + 400;
  r.loop.give = true;
  r.walk(4000);
  const { rows, text, judged } = r.end();
  console.log(text.join("\n"));
  expect([rows.page, rows.line, rows.unheld, rows.disagree]).toEqual([0, 0, 0, 0]);
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
  console.log(text.join("\n"));
  expect([rows.page, rows.line, rows.server, rows.disagree]).toEqual([0, 0, 0, 0]);
  expect(text.find((l) => l.includes("not predicted (the ground"))).toMatch(/: [34]\.\d s in 1 stretches/);
});

test("a disagreement planted on the server: one correction of the two ends, with the field that differed", () => {
  const r = recorded({ tcp: true, latencyMs: 40 });
  r.walk(3000);
  const ents = r.h.world.ents, e = r.h.ent(r.s);
  ents.setPosition(e, ents.x[e]! + 0.5, ents.y[e]!, ents.z[e]!);
  r.walk(3000);
  const { rows, text, judged } = r.end();
  console.log(text.join("\n"));
  expect(rows).toEqual({ page: 0, line: 0, server: 0, unheld: 0, disagree: 1 });
  expect(judged.corrections[0]!.c.fields.map((f) => f[0])).toContain("x");
  expect(text.some((l) => /^ {4}x +1 /.test(l))).toBe(true);
});
