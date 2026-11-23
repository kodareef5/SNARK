// The debug bar's count of the socket against what crossed it: a client with a NetLog for its tap, on the harness.

import { expect, test } from "bun:test";
import { BODY_CLASSES, CATEGORIES, NetLog, SnapshotParts, bodyClass, type NetRow } from "../../client/core/debug/net.ts";
import { SNAP_REST } from "../../client/core/net-tap.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { codeNames } from "../../shared/debug.ts";
import * as P from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

/** A message's kind and sub-kind as a key: the byte after the kind for owner state, an event or text; a command's op. */
function keyOf(dir: number, data: Uint8Array): string {
  if (dir === 1) {
    const kind = data[0]! & 15;
    return `${dir} ${kind} ${kind === P.C_COMMAND ? ((data[2]! >>> 4) | (data[3]! << 4)) & 255 : -1}`;
  }
  const kind = data[0]!;
  return `${dir} ${kind} ${kind === P.S_OWN || kind === P.S_EVENT || kind === P.S_TEXT ? data[1]! : -1}`;
}

/** Adds `bytes` to `key` in `to`. */
function add(to: Map<string, number>, key: string, bytes: number): void {
  to.set(key, (to.get(key) ?? 0) + bytes);
}

test("the tap counts each byte that crossed the socket by kind, and splits each snapshot whole", () => {
  const h = new Harness({}, 1, 30);
  h.join("bo");
  const end = h.net.connect();
  h.gate(end.peer);
  // What reached the server from this client, by kind, whichever reader the server has put on its end.
  const reached = new Map<string, number>();
  const server = end.peer;
  const greets = server.onMessage;
  let reader: typeof greets = null;
  Object.defineProperty(server, "onMessage", {
    get: () => reader,
    set(read: typeof greets) {
      reader = read && ((channel, data) => {
        add(reached, keyOf(1, data), data.length);
        read(channel, data);
      });
    },
  });
  server.onMessage = greets;
  const ada = h.adopt("ada", end, end, end.peer);
  const hello = ada.stats.bytesOut;
  // What reached this client, by kind.
  const arrived = new Map<string, number>();
  const reads = end.onMessage!;
  end.onMessage = (channel, data) => {
    add(arrived, keyOf(0, data), data.length);
    reads(channel, data);
  };

  const log = new NetLog({ now: () => h.now }, bodyClass(h.reg));
  log.setNames(codeNames(P));
  // Each snapshot's bits, what its sections came to, and the bits no section took.
  const snapshots: { bits: number; sections: number; rest: number }[] = [];
  ada.tap = {
    received(kind, sub, bytes) {
      if (kind === P.S_SNAPSHOT) snapshots.push({ bits: bytes * 8, sections: 0, rest: 0 });
      log.received(kind, sub, bytes);
    },
    sent: (kind, sub, bytes) => log.sent(kind, sub, bytes),
    snapshot(section, op, kind, bits) {
      const s = snapshots.at(-1)!;
      s.sections += bits;
      if (section === SNAP_REST) s.rest += bits;
      log.snapshot(section, op, kind, bits);
    },
  };

  h.pilots[0]!.moveX = 1;
  h.pilots[1]!.moveZ = 1;
  h.run(3000);
  ada.chat(P.TEXT_GLOBAL, "hello");
  const c = h.client(ada)!;
  h.server.sendText(c, P.TEXT_NOTICE, "noticed");
  const w = h.server.begin(P.S_EVENT);
  w.u8(P.EVENT_KILL);
  w.string("rex");
  w.u16(3);
  w.u16(10);
  h.server.endOwn(c);
  h.run(1000);
  // What is still on its way arrives.
  h.net.advance(h.now);
  expect(ada.state).toBe("active");

  // In: every byte the server sent, as the session counted it, kind by kind.
  expect([log.bytesIn, log.bytesIn]).toEqual([end.peer.bytesSent, ada.stats.bytesIn]);
  const rows: NetRow[] = [];
  const n = log.rows(rows);
  const counted = new Map<string, number>();
  for (const row of rows.slice(0, n)) add(counted, `${row.dir} ${row.kind} ${row.section ? -1 : row.sub}`, row.bytesAll);
  expect(counted).toEqual(new Map([...arrived, ...reached].filter(([key]) => key !== `1 ${P.C_HELLO} -1`)));
  // Out: the hello went before the tap was set, and every byte reached the server.
  expect([[...reached.values()].reduce((a, b) => a + b), log.bytesOut]).toEqual([ada.stats.bytesOut, ada.stats.bytesOut - hello]);

  // Each snapshot's sections are all its bits; past its bodies is only the last byte's padding.
  expect(snapshots.length).toBeGreaterThan(100);
  expect(snapshots.filter((s) => s.sections !== s.bits || s.rest >= 8)).toEqual([]);
  // A snapshot each tick, and the other survivor walking among the bodies.
  const parts = new SnapshotParts();
  log.snapshots(parts, 3);
  expect([Math.round(parts.count), parts.classes[BODY_CLASSES.indexOf("survivor")]! > 0]).toEqual([TICK_RATE, true]);

  // Every kind seen has a category, and the text, the event, the chat and the snapshot's parts are among them.
  const seen = rows.slice(0, n).map((r) => `${r.kindName} ${r.subName} ${CATEGORIES[r.category]}`);
  expect(seen.filter((s) => s.endsWith(" other"))).toEqual([]);
  expect(seen).toEqual(expect.arrayContaining(["S_EVENT EVENT_KILL combat", "S_TEXT TEXT_NOTICE text", "S_TEXT TEXT_GLOBAL text", "C_COMMAND CMD_CHAT commands", "C_INPUT  input", "S_SNAPSHOT bodies bodies", "S_SNAPSHOT own body player"]));
});
