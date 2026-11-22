// The server's own loop on a real port and a page over a real WebSocket, the server in a worker of its own so that the
// page goes on while a tick runs long, as across a network: after ticks of 100 to 700 ms, and a burst of them as the
// trip measured on Miami, no page's clock moves, no input it sent comes too late, and no margin is told late.

import { expect, test } from "bun:test";
import { ClientSession } from "../../client/core/session.ts";
import { connect } from "../../agent/socket.ts";
import { sourceWire } from "../../server/wire.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { stampWire } from "../../shared/net/protocol.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import type { StallRow } from "../fixtures/stall-server.ts";
import { noteInputs } from "../fixtures/stall.ts";
import { testKey } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Ticks of the server that take as long as said, in ms: single ones, then a burst three ticks apart. */
const STALLS: [number, number][] = [[150, 100], [200, 216], [250, 300], [300, 450], [350, 700], [400, 216], [403, 90], [406, 133], [409, 117], [412, 200]];
const AFTER = 15;

test("after ticks of 100 to 700 ms on a real socket, no page's clock jumps, no input it sent comes late and no margin is told late", async () => {
  const worker = new Worker(new URL("../fixtures/stall-server.ts", import.meta.url).href);
  const ask = (message: unknown): Promise<any> => new Promise((done) => ((worker.onmessage = (e) => done(e.data)), worker.postMessage(message)));
  const ready = await ask({ stalls: STALLS });
  const map = parseMap(ready.map);
  const hf = mapHeightfield(map);
  const conn = connect(`ws://127.0.0.1:${ready.port}/ws`);
  const sent = new Set<number>();
  const send = conn.send.bind(conn);
  conn.send = (channel, data) => (noteInputs(data, sent), send(channel, data));
  // The server in its worker speaks its source's version, so the page here says the same.
  stampWire(sourceWire()!);
  const s = new ClientSession(conn, {
    name: "walker", key: testKey("walker"), spectate: false, registry: coreRegistry(), clipHash: ready.clip, look: defaultLook(),
    resolveMap: (id, hash) => (id === map.id && hash === map.hash ? hf : null), nodes: (h, reg) => mapNodes(map, h, reg), statics: map.statics,
  });
  s.prediction.enabled = true;
  const last = STALLS[STALLS.length - 1]![0] + 2 * AFTER;
  // Frames at 60 Hz, walking a path that turns, until the server has stepped past the last stall.
  const t0 = performance.now();
  let at = { jumps: -1, corrections: 0 };
  await new Promise<void>((done) => {
    const frame = setInterval(() => {
      const now = performance.now();
      s.update(now, 0, 1, 1.2 * Math.sin((now - t0) / 1700), 0, 0);
      if (at.jumps < 0 && s.latestSnapshot >= STALLS[0]![0] - AFTER) at = { jumps: s.stats.clockJumps, corrections: s.stats.corrections };
      if (s.latestSnapshot >= last || s.state === "closed") (clearInterval(frame), done());
    }, 1000 / 60);
  });
  const { rows } = (await ask("report")) as { rows: StallRow[] };
  worker.terminate();
  s.close();
  expect(s.latestSnapshot).toBeGreaterThanOrEqual(last);
  let late = 0;
  let thrown = 0;
  for (const [stall] of STALLS) {
    const after = rows.filter(([T]) => T > stall && T <= stall + AFTER);
    expect(after.length).toBe(AFTER);
    late += after.filter(([, , , margin]) => margin < 0).length;
    thrown += after.filter(([T, , had]) => had === 0 && sent.has(T)).length;
  }
  expect(s.stats.clockJumps - at.jumps).toBe(0);
  expect(thrown).toBe(0);
  // A page that drew every frame on time sends every input on time; one the machine held back sends some late itself.
  if (s.prediction.framesOver100ms === 0) expect(late).toBe(0);
  expect(s.stats.corrections - at.corrections).toBe(0);
});
