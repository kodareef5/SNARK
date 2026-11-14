// The in-memory network's tcp links: one stream for both channels, as a WebSocket is.

import { expect, test } from "bun:test";
import { LoopbackNet, LossChain, type LinkOptions, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { Rng } from "../../shared/rng.ts";

/** A client and a server end, and what each has received: the first byte of each message and when it came. */
function link(opts: LinkOptions, seed = 1) {
  const net = new LoopbackNet(seed);
  const atServer: [number, number, number][] = [];
  const atClient: [number, number, number][] = [];
  let server: LoopbackEnd | null = null;
  net.onConnection = (end) => {
    server = end as LoopbackEnd;
    end.onMessage = (ch, d) => atServer.push([ch, d[0]!, net.now]);
  };
  const client = net.connect({ tcp: true, ...opts });
  client.onMessage = (ch, d) => atClient.push([ch, d[0]!, net.now]);
  return { net, client, server: server!, atServer, atClient };
}

/** A message of `size` bytes whose first is `id`. */
function msg(id: number, size = 100): Uint8Array {
  const m = new Uint8Array(size);
  m[0] = id;
  return m;
}

test("a tcp link delivers every message of both channels, both ways, once and in the order sent, whatever it loses", () => {
  for (const opts of [{ loss: 0.05 }, { loss: 0.05, burstMs: 80, jitterMs: 30 }, { loss: 0.3 }]) {
    const { net, client, server, atServer, atClient } = link({ latencyMs: 40, ...opts }, 7);
    for (let t = 0; t < 3000; t++) {
      net.advance(t);
      if (t % 10 !== 0) continue;
      const k = (t / 10) & 0xff;
      client.send(k % 3 === 0 ? CH_RELIABLE : CH_UNRELIABLE, msg(k, 30));
      server.send(k % 2 === 0 ? CH_RELIABLE : CH_UNRELIABLE, msg(k, k % 7 === 0 ? 4000 : 600));
    }
    net.advance(60000);
    const sent = Array.from({ length: 300 }, (_, i) => i & 0xff);
    expect(atServer.map(([, id]) => id)).toEqual(sent);
    expect(atClient.map(([, id]) => id)).toEqual(sent);
    expect(atServer.map(([ch]) => ch)).toEqual(sent.map((k) => (k % 3 === 0 ? CH_RELIABLE : CH_UNRELIABLE)));
    expect(client.wire.resent).toBeGreaterThan(0);
    expect(server.wire.resent).toBeGreaterThan(0);
  }
});

test("a lost segment holds back itself and all behind it: a round trip and the gap to the next, or the timeout when none follows, backed off while the line is down", () => {
  // Ten messages a tick apart measure the round trip, 100 ms. Then the one sent at 1000 is lost.
  const run = (down: number, sends: number[]): string[] => {
    const { net, client, atServer } = link({ latencyMs: 50 });
    const at = [...Array.from({ length: 10 }, (_, k) => k * 33), ...sends];
    for (let t = 0; t <= 5000; t++) {
      net.advance(t);
      if (t === 1000) net.outage(client, down);
      for (let i = 0; i < at.length; i++) if (at[i] === t) client.send(CH_UNRELIABLE, msg(i));
    }
    return atServer.filter(([, id]) => id >= 10).map(([, id, t]) => `${id}@${t}`);
  };
  // The next segment's acknowledgement shows the loss at 1133. The two behind it arrived at 1083 and 1116 and wait for it.
  expect(run(1, [1000, 1033, 1066])).toEqual(["10@1183", "11@1183", "12@1183"]);
  // With nothing behind it, the timeout: the round trip plus 200 ms.
  expect(run(1, [1000])).toEqual(["10@1350"]);
  // Down for a second: resent at 1300 and 1900 into the outage, then not until 3100. After a timeout the window is one
  // segment, so 12 and 13 wait unsent and leave together once 10 is acknowledged.
  expect(run(1000, [1000, 1033, 1500, 2500])).toEqual(["10@3150", "11@3250", "12@3250", "13@3250"]);
});

test("what a slow line cannot carry fills the sender's kernel and then waits unsent in buffered, and a fast line keeps none", () => {
  // 1,100 bytes a tick is 33 KB a second.
  const fill = (opts: LinkOptions): number[] => {
    const { net, client } = link({ latencyMs: 50, ...opts });
    client.onMessage = null;
    const seen: number[] = [];
    for (let t = 0; t <= 4000; t++) {
      net.advance(t);
      if (t % 33 === 0) client.peer.send(CH_UNRELIABLE, msg(1, 1100));
      if (t % 1000 === 0) seen.push(client.peer.buffered);
    }
    return seen;
  };
  expect(fill({})).toEqual([0, 0, 0, 0, 0]);
  // 20 KB a second: the kernel's 32 KB take what the line cannot for a second and more; then what does not fit waits.
  const slow = fill({ bytesPerSecond: 20000 });
  expect(slow.slice(0, 2)).toEqual([0, 0]);
  expect(slow[2]).toBeGreaterThan(2000);
  expect(slow[4]).toBeGreaterThan(slow[2]! + 15000);
  // Unsent bytes in the kernel held to 4 KB (tcp_notsent_lowat): the rest waits where the server can see it.
  const held = fill({ bytesPerSecond: 20000, notSent: 4096 });
  expect(held[1]).toBeGreaterThan(2000);
  expect(held[4]).toBeGreaterThan(slow[4]! + 20000);
});

test("losses in spells come at the rate asked and last as long as asked; connections on one path lose together", () => {
  const rng = new Rng(3);
  for (const [loss, burst] of [[0.02, 0], [0.02, 50], [0.01, 120]] as const) {
    const chain = new LossChain(rng, loss, burst);
    let lost = 0;
    let spells = 0;
    let was = false;
    const n = 1000000;
    for (let i = 0; i < n; i++) {
      const now = chain.lost(i * 10);
      if (now) lost++;
      if (now && !was) spells++;
      was = now;
    }
    expect(Math.abs(lost / n - loss)).toBeLessThan(loss * 0.1);
    expect(Math.abs((lost / spells) * 10 - Math.max(10, burst))).toBeLessThan(Math.max(10, burst) * 0.15);
  }
  // Two connections over one path in spells: each loses what the other does at the same moment.
  const net = new LoopbackNet(2);
  const got = [0, 0];
  const ends: LoopbackEnd[] = [];
  net.onConnection = (end) => {
    const k = ends.length;
    ends.push(end as LoopbackEnd);
    end.onMessage = () => got[k]!++;
  };
  const a = net.connect({ loss: 0.2, burstMs: 100 });
  const b = net.connect({ loss: 0.2, burstMs: 100 }, a);
  const both: number[] = [];
  for (let t = 0; t < 20000; t += 10) {
    net.advance(t);
    const before = [...got];
    a.send(CH_UNRELIABLE, msg(1));
    b.send(CH_UNRELIABLE, msg(1));
    net.advance(t);
    both.push(got[0]! - before[0]! + got[1]! - before[1]!);
  }
  expect(both.includes(1)).toBe(false);
  expect(both.filter((n) => n === 0).length / both.length).toBeGreaterThan(0.15);
});

test("the same seed gives the same deliveries at the same moments", () => {
  const run = (): string => {
    const { net, client, server, atServer, atClient } = link({ latencyMs: 30, jitterMs: 20, loss: 0.04, burstMs: 40 }, 11);
    for (let t = 0; t < 2000; t++) {
      net.advance(t);
      if (t % 16 === 0) client.send(CH_UNRELIABLE, msg(t & 0xff, 40));
      if (t % 33 === 0) server.send(CH_UNRELIABLE, msg(t & 0xff, 1200));
    }
    net.advance(30000);
    return JSON.stringify([atServer, atClient]);
  };
  expect(run()).toBe(run());
});

test("a window cut by losses still carries many small messages, because what waits for it leaves in full segments", () => {
  const { net, client, atServer } = link({ latencyMs: 75, jitterMs: 30, loss: 0.05 }, 4);
  const sentAt: number[] = [];
  for (let t = 0; t < 20000; t++) {
    net.advance(t);
    if (t % 33 !== 0) continue;
    for (let k = 0; k < 3; k++) {
      client.send(CH_UNRELIABLE, msg(sentAt.length & 0xff, 40));
      sentAt.push(t);
    }
  }
  net.advance(30000);
  expect(atServer.length).toBe(sentAt.length);
  const late = atServer.map(([, , t], i) => t - sentAt[i]!).sort((a, b) => a - b);
  expect(late[late.length >> 1]).toBeLessThan(120);
  expect(late[Math.floor(late.length * 0.99)]).toBeLessThan(700);
});
