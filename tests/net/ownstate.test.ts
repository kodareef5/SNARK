// Owner state by table: a kind registered on the server (server/ownstate.ts), and the readers a session reads the server
// by (client/core/readers.ts).

import { expect, test } from "bun:test";
import { Readers } from "../../client/core/readers.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { newScreenState, writeScreens, SHOW_VIDEO, NO_CHANNEL } from "../../shared/video/screen.ts";
import { OWN_BUFFS, OWN_HELD, OWN_LOOK, OWN_MARKERS, OWN_PROGRESSION, OWN_RULES, OWN_SCREEN, OWN_SESSION, OWN_SLOTS, OWN_TRIBE, OWN_VITALS, OWN_VOICE, OWN_XP, S_OWN, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { Harness } from "../fixtures/net.ts";

/** A kind no part of the game has. */
const OWN_TEST = 200;

/** Every S_OWN message the server sends over the harness's connection `i` from now on, as its kind and the bytes after it. */
function ownSent(h: Harness, i: number): number[][] {
  const got: number[][] = [];
  const peer = h.ends[i]!.peer;
  const send = peer.send.bind(peer);
  peer.send = (channel, data) => {
    if (data[0] === S_OWN) got.push([...data.subarray(1)]);
    send(channel, data);
  };
  return got;
}

test("a registered kind of owner state is sent in its place, and when it changes", () => {
  const h = new Harness({}, 1, 30);
  let version = 7;
  h.server.own.add({ kind: OWN_TEST, version: () => version, write: (w) => void w.u8(version) });
  expect(() => h.server.own.add({ kind: OWN_TEST, version: () => 0, write: () => {} })).toThrow("registered twice");

  const ada = h.join("ada");
  const sent = ownSent(h, 0);
  h.run(400);
  // The kinds a survivor with nothing open is first sent, in the order they are written. A kind the order does not name is last.
  const first = sent.map((m) => m[0]!).filter((k) => k !== OWN_SESSION);
  expect(first.slice(0, 12)).toEqual([OWN_LOOK, OWN_VITALS, OWN_SLOTS, OWN_RULES, OWN_VOICE, OWN_TRIBE, OWN_BUFFS, OWN_HELD, OWN_MARKERS, OWN_XP, OWN_PROGRESSION, OWN_TEST]);
  const mine = (list: number[][]): number[][] => list.filter((m) => m[0] === OWN_TEST);
  expect(mine(sent)).toEqual([[OWN_TEST, 7]]);

  version = 8;
  h.run(100);
  expect(mine(sent)).toEqual([[OWN_TEST, 7], [OWN_TEST, 8]]);
  // The session has no reader for the kind, and reads the rest as ever.
  expect([ada.state, ada.hasVitals]).toEqual(["active", true]);

  // The same device over a new connection was sent nothing yet.
  const again = h.join("ada");
  const resent = ownSent(h, 1);
  h.run(400);
  expect(again.state).toBe("active");
  expect(mine(resent)).toEqual([[OWN_TEST, 8]]);
  expect(resent.map((m) => m[0])).toContain(OWN_SLOTS);
});

test("a session ignores a message and an owner kind that have no reader", () => {
  const h = new Harness({}, 1, 30);
  const ada = h.join("ada");
  h.run(400);
  const c = h.client(ada)!;
  const before = ada.stats.bytesIn;
  c.conn.send(CH_RELIABLE, new Uint8Array([250, 1, 2, 3]));
  c.conn.send(CH_RELIABLE, new Uint8Array([S_OWN, OWN_TEST, 1, 2, 3]));
  h.server.sendText(c, TEXT_NOTICE, "still here");
  h.run(100);
  expect(ada.stats.bytesIn).toBeGreaterThanOrEqual(before + 9);
  expect([ada.state, ada.log.at(-1)?.text]).toEqual(["active", "still here"]);

  // A table gives a kind one reader, and says whether a kind was read.
  const table = new Readers("test message");
  const read: number[] = [];
  table.add({ kind: 3, read: (_s, r) => void read.push(r.u8()) });
  expect(() => table.add({ kind: 3, read: () => {} })).toThrow("two readers");
  const r = new BitReader();
  r.reset(new Uint8Array([9]));
  expect([table.read(4, ada, r), table.read(3, ada, r), read]).toEqual([false, true, [9]]);
});

test("a gain of experience sends twelve bytes; a level sends the engrams and points too", () => {
  const h = new Harness({}, 1, 30, { dev: true });
  const ada = h.join("ada");
  h.run(400);
  h.say(ada, "enablecheats");
  const sent = ownSent(h, 0);
  h.say(ada, "addxp 2.5");
  expect(sent.filter((m) => m[0] === OWN_XP || m[0] === OWN_PROGRESSION).map((m) => [m[0], m.length - 1])).toEqual([[OWN_XP, 12]]);
  expect([ada.progress.xp, ada.progress.level]).toEqual([2.5, 1]);
  sent.length = 0;
  h.say(ada, "addxp 2.5");
  expect(sent.filter((m) => m[0] === OWN_XP || m[0] === OWN_PROGRESSION).map((m) => m[0])).toEqual([OWN_XP, OWN_PROGRESSION]);
  expect([ada.progress.xp, ada.progress.level, ada.progress.statPoints, ada.progress.engramPoints]).toEqual([5, 2, 1, 8]);
});

test("a session keeps what the server says its screens play", () => {
  const h = new Harness({}, 1, 30);
  const ada = h.join("ada");
  h.run(400);
  const w = new BitWriter(64);
  writeScreens(w, [{ ...newScreenState(), manifest: "0123456789abcdef", show: SHOW_VIDEO, flags: 3, clip: 2, start: -450, next: 0 }]);
  h.client(ada)!.conn.send(CH_RELIABLE, new Uint8Array([S_OWN, OWN_SCREEN, ...w.bytes()]));
  h.run(60);
  expect(ada.screens).toEqual([{ manifest: "0123456789abcdef", show: SHOW_VIDEO, flags: 3, clip: 2, start: -450, next: 0, scene: -1, channel: NO_CHANNEL, epoch: 0 }]);
});
