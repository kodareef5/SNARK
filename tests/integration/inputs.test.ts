// What passes between a client and the server: inputs and the lack of them, commands, acknowledgements, and what tells one message from another.

import { expect, test } from "bun:test";
import { defaultLook } from "../../shared/anim/look.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { InputBuffer, OWN_HELD, PROTOCOL_VERSION, RESULT_BUSY, RESULT_OK, S_OWN, S_SNAPSHOT, writeHello, writeInputs } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { VIEW_RING } from "../../shared/net/view.ts";
import { BTN_PRIMARY, BTN_PRONE, BTN_SPRINT, BTN_USE, STANCE_PRONE } from "../../shared/sim/character.ts";
import { Harness, testKey } from "../fixtures/net.ts";

test("a survivor stops a quarter of a second after its inputs stop, and stays in its stance", () => {
  const h = new Harness();
  const s = h.join("ada", {}, { manual: true });
  h.run(500, (now) => s.update(now, 0, 0, 0, 0, 0));
  const c = h.client(s)!;
  const ents = h.world.ents;
  const e = h.ent(s);
  h.run(1500, (now) => s.update(now, 0, 1, 0, 0, BTN_SPRINT | BTN_PRIMARY));
  // The tab is hidden: the client runs no frames and sends nothing. The body runs on for the inputs in hand and eight ticks more.
  const z = ents.z[e]!;
  h.run(500);
  const rest = ents.z[e]!;
  expect(rest - z).toBeGreaterThan(1.9);
  expect(rest - z).toBeLessThan(3.3);
  h.run(2000);
  expect([ents.z[e], c.heldButtons]).toEqual([rest, 0]);

  // Lying down is a state, not an act, so a body that lay down stays down.
  h.run(1000, (now) => s.update(now, 0, 0, 0, 0, BTN_PRONE));
  h.run(1000);
  expect([ents.stance[e], c.heldButtons]).toEqual([STANCE_PRONE, BTN_PRONE]);
});

test("a press shorter than a tick reaches the server once, whatever the frame rate", () => {
  for (const fps of [60, 144, 240]) {
    const h = new Harness({}, 1, fps);
    const s = h.join("ada");
    h.run(500);
    const c = h.client(s)!;
    const p = h.pilots[0]!;
    let presses = 0;
    let tick = h.world.tick;
    const frames = (n: number): void => {
      for (let i = 0; i < n; i++) {
        h.run(500 / fps);
        if (h.world.tick !== tick && (c.pressed & BTN_USE) !== 0) presses++;
        tick = h.world.tick;
      }
    };
    // The use key's tap is down for three frames (client/core/app.ts). Each comes at another point of the tick.
    for (let tap = 0; tap < 60; tap++) {
      p.buttons = BTN_USE;
      frames(3);
      p.buttons = 0;
      frames(Math.round(fps / 8) + (tap % 7));
    }
    expect([fps, presses]).toEqual([fps, 60]);
  }
});

test("commands that come faster than the server takes them are answered busy, however many, and the session goes on", () => {
  const h = new Harness();
  const ada = h.join("ada");
  h.run(500);
  const results: number[] = [];
  ada.onResult = (_seq, code) => results.push(code);
  // A connection that stalled delivers everything sent during the stall in one tick.
  for (let i = 0; i < 80; i++) ada.text("pos");
  h.run(1000);
  expect([results.length, results.every((c) => c === RESULT_OK || c === RESULT_BUSY)]).toEqual([80, true]);
  expect([ada.state, h.client(ada)!.strikes, h.server.stats.malformed]).toEqual(["active", 0, 0]);
  expect(h.say(ada, "pos").length).toBe(1);
});

test("a client that acknowledges 0 is sent a whole snapshot next", () => {
  const h = new Harness();
  const end = h.net.connect();
  const w = new BitWriter(256);
  writeHello(w, PROTOCOL_VERSION, h.reg.hash, h.world.anim.set.hash, "raw", 0, testKey("raw"), defaultLook());
  end.send(CH_RELIABLE, w.bytes());
  // The newest snapshot's tick, and how many ticks back the view it was written against lies: 0 for a whole one.
  const r = new BitReader();
  let tick = 0;
  let age = -1;
  end.onMessage = (_channel, data) => {
    r.reset(data);
    if (r.u8() !== S_SNAPSHOT) return;
    tick = r.u32();
    age = r.u8();
  };
  const inputs = new InputBuffer(64);
  const send = (ack: number): void => {
    const t = h.world.tick + 2;
    inputs.set(t, 0, 0, 0, 0, 0);
    w.reset();
    writeInputs(w, inputs, ack, t, 1);
    end.send(CH_UNRELIABLE, w.bytes());
    h.run(1000 / 30);
  };
  h.run(100);
  for (let i = 0; i < 4; i++) send(tick);
  expect(age).toBeGreaterThan(0);
  // It can no longer read against what it acknowledged, and says so.
  send(0);
  send(0);
  expect(age).toBe(0);
  // An older input that arrives late does not ask again.
  send(tick);
  send(tick);
  expect(age).toBeGreaterThan(0);
  w.reset();
  writeInputs(w, inputs, 0, h.world.tick, 1);
  end.send(CH_UNRELIABLE, w.bytes());
  h.run(1000 / 30);
  expect(age).toBeGreaterThan(0);
});

test("each buffered input keeps its first packet's local snapshot acknowledgement", () => {
  const h = new Harness();
  try {
    const session = h.join("ada", {}, { manual: true });
    h.run(500, now => session.update(now, 0, 0, 0, 0, 0));
    const c = h.client(session)!, inputs = new InputBuffer(64), w = new BitWriter(256);
    const tick = h.world.tick + 10, firstAck = c.lastSnapshot;
    const send = (t: number, ack: number) => {
      inputs.set(t, 0, 0, 0, 0, BTN_USE);
      w.reset(); writeInputs(w, inputs, ack, t, 1, 4);
      h.ends[0]!.send(CH_UNRELIABLE, w.bytes()); h.net.advance(h.now);
    };
    send(tick, firstAck);
    h.run(100);
    expect(c.lastSnapshot).toBeGreaterThan(firstAck);
    send(tick, c.lastSnapshot);
    expect(c.inputAcks[tick & c.inputs.mask]).toBe(firstAck);
    expect(c.inputs.view[tick & c.inputs.mask]).toBe(firstAck - 4);
    // A new input cannot backdate its view after a newer ACK, even across a full-snapshot request.
    send(tick + 2, 0); send(tick + 3, firstAck);
    expect(c.inputAcks[(tick + 3) & c.inputs.mask]).toBe(0);
    send(tick + 1, c.lastSnapshot + 1);
    expect(c.inputAcks[(tick + 1) & c.inputs.mask]).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a page that draws no frames still acknowledges, so the server goes on writing its snapshots against a view it has", () => {
  const h = new Harness();
  const s = h.join("ada", { latencyMs: 20 }, { manual: true });
  h.run(1000, (now) => s.update(now, 0, 0, 0, 0, 0));
  const c = h.client(s)!;
  const sent = s.simTick;
  let oldest = 0;
  h.run(3000, () => (oldest = Math.max(oldest, h.world.tick - c.ackTick)));
  expect(oldest).toBeLessThan(VIEW_RING);
  // What it sent again were inputs the server had.
  expect([c.newestInput, s.state]).toEqual([sent, "active"]);
});

test("a server message's type has a byte to itself, so one past the fifteenth is not taken for another", () => {
  const h = new Harness();
  const ada = h.join("ada");
  h.run(300);
  // In four bits this type is S_OWN, and what follows it would be read as the item in hand.
  const w = h.server.begin(S_OWN + 16);
  w.u8(OWN_HELD);
  w.u8(3);
  h.server.endOwn(h.client(ada)!);
  h.run(100);
  expect([ada.held, ada.state]).toEqual([-1, "active"]);
});
