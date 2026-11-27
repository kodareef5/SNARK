// OWN_PINS on the wire: what a session reads is what the server keeps, how many bytes it is, and when it is sent.

import { expect, test } from "bun:test";
import { pinAt } from "../../client/core/pins.ts";
import { PINS_MOST } from "../../server/pins.ts";
import { OWN_PINS, PIN_LABEL_BYTES, S_OWN } from "../../shared/net/protocol.ts";
import { Harness } from "../fixtures/net.ts";

/** The OWN_PINS messages the server sends over connection `i` from now on, whole, with their type and kind. */
function pinsSent(h: Harness, i: number): Uint8Array[] {
  const got: Uint8Array[] = [];
  const peer = h.ends[i]!.peer;
  const send = peer.send.bind(peer);
  peer.send = (channel, data) => {
    if (data[0] === S_OWN && data[1] === OWN_PINS) got.push(data.slice());
    send(channel, data);
  };
  return got;
}

const FULL = "abcdefghijklmnopqrstuvwx";

test("a session reads its team's pins as the server keeps them, and is sent them only when they change", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const sent = pinsSent(h, 0);
  h.run(800);
  // A team that never had a pin is sent nothing.
  expect(sent.length).toBe(0);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const pins = h.host.pins;
  pinAt(ada, 123.456, 789.012, 2, true, FULL);
  pinAt(ada, 5, 6, 4, false, "é");
  h.run(300);
  const kept = pins.of(rec.team);
  expect(ada.pins.map((p) => ({ id: p.id, x: p.x, z: p.z, kind: p.kind, shared: p.shared, at: p.at, expires: p.expires, label: p.label, priority: p.priority })))
    .toEqual(kept.map((p) => ({ id: p.id, x: Math.fround(p.x), z: Math.fround(p.z), kind: p.kind, shared: p.shared, at: p.at, expires: p.expires, label: p.label, priority: p.priority })));
  expect(ada.pins.map((p) => [p.mine, p.author, p.radius, Math.round(p.pull * 127)])).toEqual(kept.map((p) => [true, "ada", p.radius, Math.round(p.pull * 127)]));
  const told = sent.length;
  expect(told).toBeGreaterThan(0);
  // Idle, nothing more goes.
  h.run(3000);
  expect(sent.length).toBe(told);
  pins.remove(rec.team, kept[0]!.id);
  h.run(100);
  expect([sent.length, ada.pins.length]).toEqual([told + 1, 1]);
});

test("OWN_PINS with full labels: 1, 8 and 32 pins", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(800);
  const sent = pinsSent(h, 0);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const sizes: number[] = [];
  let placed = 0;
  for (const n of [1, 8, PINS_MOST]) {
    while (placed < n) h.host.pins.place(rec.team, rec.pid, 1000 + placed, 2000 + placed, placed % 5, true, FULL), placed++;
    h.run(100);
    sizes.push(sent.at(-1)!.length);
  }
  expect(ada.pins.length).toBe(PINS_MOST);
  expect(ada.pins.every((p) => p.label.length === PIN_LABEL_BYTES)).toBe(true);
  // The whole message was 52, 369 and 1,440 bytes when written: each pin under fifty, its label's 25 among them.
  expect(sizes[2]! - sizes[1]!).toBeLessThan(50 * (PINS_MOST - 8));
  expect(sizes[2]!).toBeLessThan(1600);
});
