// Who gets in, who is turned away, and what a connection costs before it has said who it is.

import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { loadConfig } from "../../server/settings/config.ts";
import type { VoiceSocket } from "../../server/voice.ts";
import { REJECT_DENIED, REJECT_FULL, REJECT_NAME, SESSION_DEAD, S_REJECT } from "../../shared/net/protocol.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { writeAuth } from "../../shared/voice/packet.ts";
import { Harness, testKey } from "../fixtures/net.ts";

/** A connection that says nothing, from a network address, which a loopback end has none of. `reason` is what it was turned away with. */
class Idle implements Connection {
  open = true;
  onMessage: ((channel: number, data: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  reason = 0;
  readonly address: string;

  constructor(h: Harness, address: string) {
    this.address = address;
    h.net.onConnection!(this);
  }

  send(_channel: number, data: Uint8Array): void {
    if (data[0] === S_REJECT) this.reason = data[1]!;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
  }
}

test("a survivor back on a new connection takes its body over, though the old connection never closed", () => {
  const h = new Harness();
  const ada = h.join("ada");
  h.pilots[0]!.moveZ = 1;
  h.run(1000);
  h.pilots[0]!.moveZ = 0;
  h.run(300);
  const handle = ada.ownHandle;
  const z = h.world.ents.z[h.ent(ada)]!;
  // Its device lost the network and the page was loaded again. Nothing has closed the old socket.
  const again = h.join("ada");
  h.run(500);
  expect([again.state, again.ownHandle, again.own.z, h.server.playerCount, h.world.ents.count]).toEqual(["active", handle, z, 1, 1]);
  expect([ada.state, ada.closeReason]).toEqual(["closed", REJECT_NAME]);
  h.pilots[1]!.moveZ = 1;
  h.run(500);
  expect(h.world.ents.z[h.ent(again)]!).toBeGreaterThan(z + 1);

  // Another device is refused as before, and the body stays with the one that has it.
  const thief = h.join("ada", {}, { key: testKey("thief") });
  h.run(300);
  expect([thief.state, thief.closeReason, again.state]).toEqual(["closed", REJECT_DENIED, "active"]);

  // A session with no body has nothing to take over: the old one ends and the new one joins as it would have.
  h.say(again, "suicide");
  const third = h.join("ada");
  h.run(500);
  expect([again.state, third.state, third.sessionState, h.server.playerCount]).toEqual(["closed", "active", SESSION_DEAD, 1]);
});

test("joining with the right password does not forgive wrong guesses at the admin password", () => {
  const h = new Harness({ password: "door" }, 1, 60, { adminPassword: "hunter2" });
  const guess = (word: string): string => {
    const eve = h.join("eve", {}, { password: "door" });
    h.run(300);
    const said = h.say(eve, `enablecheats ${word}`)[0]!;
    eve.close();
    h.run(100);
    return said;
  };
  // Each guess comes on a new connection. The third starts a wait that the right password must sit out too.
  expect([guess("a"), guess("b"), guess("c")]).toEqual(["wrong password", "wrong password", "wrong password"]);
  expect(guess("hunter2")).toBe("too many wrong passwords: wait 30 s");
});

test("connections that only wait keep nobody out, and cost no session's memory", () => {
  const made = loadConfig({ gus: "[SnarkSettings]\nPendingPerAddress=4\n", game: "" });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({ maxClients: 8 }, 1, 60, { config: made.rules });
  // One address may have four waiting, as the operator set. More are turned away as they come, so it cannot fill the room alone.
  const flood = [];
  for (let i = 0; i < 64; i++) flood.push(new Idle(h, "203.0.113.9"));
  expect([flood.filter((s) => s.open).length, flood[63]!.reason]).toEqual([4, REJECT_FULL]);
  const ada = h.join("ada");
  h.run(300);
  expect(ada.state).toBe("active");

  // Many addresses can fill it. None of them is given the memory of a session for that.
  const arrays = (): number => {
    Bun.gc(true);
    const n = heapStats().objectTypeCounts;
    return (n["Uint16Array"] ?? 0) + (n["Uint32Array"] ?? 0) + (n["Int32Array"] ?? 0);
  };
  const before = arrays();
  const many = [];
  for (let i = 0; i < 60; i++) many.push(new Idle(h, `198.51.100.${i}`));
  expect(arrays() - before).toBeLessThan(60);
  expect(many.every((s) => s.open)).toBe(true);
  // One that has waited half a second and said nothing is put out for whoever comes next.
  h.run(600);
  const bo = h.join("bo");
  h.run(300);
  expect([bo.state, flood[0]!.open, flood[0]!.reason, flood[1]!.open]).toEqual(["active", false, REJECT_FULL, true]);
});

test("voice sockets that never authenticate are put out as more come", () => {
  const h = new Harness({ maxClients: 8 });
  const ada = h.join("ada");
  h.run(600);
  const voice = h.host.voice;
  const open = (): { closed: boolean } & VoiceSocket => ({ closed: false, send: () => true, close() { this.closed = true; } });
  const own = open();
  const auth = new Uint8Array(32);
  voice.receive(voice.connect(own), auth.subarray(0, writeAuth(auth, ada.voice.slot, ada.voice.token)), 0);
  const idle = [];
  for (let i = 0; i < 64; i++) idle.push(open());
  for (const sock of idle) voice.connect(sock);
  // The room is full of sockets that came this instant, so the next is turned away.
  const late = open();
  voice.connect(late);
  expect([voice.peers.size, late.closed, idle[0]!.closed]).toEqual([65, true, false]);
  // Half a second on they have had their time, and each newcomer puts out the one that has waited longest.
  h.run(600);
  const more = [];
  for (let i = 0; i < 200; i++) more.push(open());
  for (const sock of more) voice.connect(sock);
  expect([voice.peers.size, idle.every((s) => s.closed), more[0]!.closed, own.closed]).toEqual([65, true, false, false]);
});
