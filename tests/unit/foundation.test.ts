import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { chunkAt } from "../../shared/coords.ts";
import { handleIndex, makeHandle, makePid, pidSeq, pidWorld } from "../../shared/ids.ts";
import { detAtan2, detCos, detSin } from "../../shared/math/scalar.ts";
import { LoopbackNet } from "../../shared/net/loopback.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { EntityStore } from "../../shared/sim/entities.ts";

test("deterministic trig stays within its stated error", () => {
  let worstSin = 0;
  let worstAtan = 0;
  for (let i = -4000; i <= 4000; i++) {
    const a = i * 0.0137;
    worstSin = Math.max(worstSin, Math.abs(detSin(a) - Math.sin(a)), Math.abs(detCos(a) - Math.cos(a)));
    const x = Math.cos(a) * (1 + (i & 7));
    const y = Math.sin(a) * (1 + (i & 7));
    let d = Math.abs(detAtan2(y, x) - Math.atan2(y, x));
    if (d > Math.PI) d = 2 * Math.PI - d;
    worstAtan = Math.max(worstAtan, d);
  }
  expect(worstSin).toBeLessThan(1e-9);
  expect(worstAtan).toBeLessThan(2e-5);
});

test("handles and persistent ids keep their parts", () => {
  const h = makeHandle(0xabcde, 0xfff);
  expect(handleIndex(h)).toBe(0xabcde);
  expect(h >>> 20).toBe(0xfff);
  const pid = makePid(8191, 2 ** 40 - 1);
  expect(Number.isSafeInteger(pid)).toBe(true);
  expect(pidWorld(pid)).toBe(8191);
  expect(pidSeq(pid)).toBe(2 ** 40 - 1);
});

test("a stale handle does not resolve to the entity that reused its slot", () => {
  const dims = { chunksX: 2, chunksZ: 2 };
  const es = new EntityStore(dims, 2);
  const a = es.create(1, 10, 0, 10, 0);
  const ha = es.handleOf(a);
  es.destroy(a);
  es.create(1, 0, 0, 0, 0);
  const c = es.create(1, 70, 0, 10, 0); // reuses slot a
  expect(c).toBe(a);
  expect(es.resolve(ha)).toBe(-1);
  expect(es.resolve(es.handleOf(c))).toBe(c);
  expect(es.chunkHead[chunkAt(dims, 70, 10)]).toBe(c);
  es.setPosition(c, 10, 0, 100);
  expect(es.chunkHead[chunkAt(dims, 70, 10)]).toBe(-1);
  expect(es.chunkHead[chunkAt(dims, 10, 100)]).toBe(c);
});

test("content compiles to the same indices and hash regardless of order", () => {
  const a = compileContent(CORE_CONTENT).registry!;
  const b = compileContent([...CORE_CONTENT].reverse()).registry!;
  expect(a.hash).toBe(b.hash);
  expect(a.ids).toEqual(b.ids);
  expect(a.index.get("core:wall")).toBeGreaterThan(0);
  const changed = compileContent(CORE_CONTENT.map((d) => (d.id === "core:wall" ? { ...d, hp: 1 } : d))).registry!;
  expect(changed.hash).not.toBe(a.hash);
});

test("invalid content is rejected with a reason per problem", () => {
  const { registry, errors } = compileContent([
    { type: "item", id: "Bad Id", stack: 1 },
    { type: "item", id: "core:a", stack: 0 },
    { type: "item", id: "core:a", stack: 1 },
    { type: "structure", id: "core:huge", mesh: "box", color: 1, half: [99, 1, 1], hp: 1 },
  ]);
  expect(registry).toBeNull();
  expect(errors.length).toBe(4);
});

test("loopback keeps the reliable channel ordered and drops only unreliable traffic", () => {
  const net = new LoopbackNet(5);
  const got: number[][] = [[], []];
  net.onConnection = (server) => {
    server.onMessage = (ch, data) => got[ch]!.push(data[0]!);
  };
  const client = net.connect({ latencyMs: 40, jitterMs: 60, loss: 0.3 });
  for (let i = 0; i < 200; i++) {
    net.advance(i);
    client.send(CH_RELIABLE, new Uint8Array([i]));
    client.send(CH_UNRELIABLE, new Uint8Array([i]));
  }
  net.advance(1000);
  expect(got[CH_RELIABLE]).toEqual(Array.from({ length: 200 }, (_, i) => i));
  expect(got[CH_UNRELIABLE]!.length).toBeGreaterThan(110);
  expect(got[CH_UNRELIABLE]!.length).toBeLessThan(170);
  const sorted = [...got[CH_UNRELIABLE]!].sort((a, b) => a - b);
  expect(got[CH_UNRELIABLE]).not.toEqual(sorted); // jitter reorders
});
