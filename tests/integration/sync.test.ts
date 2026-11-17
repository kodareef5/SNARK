// What a client is told of the structures around it.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { GONE_FELL, type StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

test("a collapse too large for one message reaches the client whole", () => {
  // More rows a tick than a message holds, so the rows are cut to fit as well.
  const h = new Harness({ chunkSlotsPerTick: 4096 }, 1, 30);
  const s = h.join("ada");
  h.run(300);
  const structs = h.world.structs;
  const chunk = h.world.ents.chunk[h.ent(s)]!;
  const x0 = chunkCx(h.world.dims, chunk) * CHUNK_SIZE;
  const z0 = chunkCz(h.world.dims, chunk) * CHUNK_SIZE;
  // Every other piece of 17,000 falls at once: 8,500 runs of slots, which is more than a message holds.
  const wall = h.reg.index.get("core:wall")!;
  const fell = new Uint32Array(8500);
  for (let i = 0; i < 17000; i++) {
    const ref = structs.add(wall, x0 + 1 + (i % 130) * 0.47, 200, z0 + 1 + Math.floor(i / 130) * 0.47, 0, 0, 100);
    if (i % 2 === 1) fell[i >> 1] = ref;
  }
  const server = structs.chunks[chunk]!;
  const client = (): number => s.world!.structs.chunks[chunk]!.live;
  h.run(1500);
  expect(client()).toBe(server.live);
  expect(structs.removeMany(fell, fell.length, GONE_FELL, x0 + 32, 200, z0 + 32, h.world.tick)).toBe(8500);
  h.run(1000);
  expect([client(), s.world!.structs.chunks[chunk]!.version]).toEqual([server.live, server.version]);
  expect(h.server.stats.overflows).toBe(1);
});

/** Slots of the chunks `held` has whole that differ from `structs`. */
function differ(structs: StructureStore, held: StructureStore, chunks: number[]): number {
  let n = 0;
  for (const c of chunks) {
    const [t, u] = [structs.chunks[c]!, held.chunks[c]!];
    for (let s = 0; s < Math.max(t.high, u.high); s++) {
      const kind = t.kind[s] ?? 0;
      if (kind !== (u.kind[s] ?? 0) || (kind !== 0 && [t.x, t.y, t.z, t.yaw, t.owner, t.hp].some((col, i) => col[s] !== [u.x, u.y, u.z, u.yaw, u.owner, u.hp][i]![s]))) n++;
    }
  }
  return n;
}

test("a client with the map's statics is sent only the slots that differ from them, and damage as health alone", () => {
  const h = new Harness({}, 1, 30);
  const structs = h.world.structs;
  const statics = h.world.statics!;
  const held = (c: number): number => statics.first[c + 1]! - statics.first[c]!;
  // The proving ground's busiest chunk of statics, within sight of the spawn: one taken away, one hurt, another taken
  // and a wall set down in its slot.
  let chunk = 0;
  for (let c = 0; c < structs.chunks.length; c++) if (held(c) > held(chunk)) chunk = c;
  const t = structs.chunks[chunk]!;
  const hurt = [...Array(held(chunk)).keys()].find((s) => h.reg.maxHp[t.kind[s]!]! > 100)!;
  const gone = (hurt + 1) % held(chunk);
  const reused = (hurt + 2) % held(chunk);
  expect(structs.damage(chunk * 65536 + hurt, 50)).toBeGreaterThan(0);
  structs.remove(chunk * 65536 + gone);
  structs.remove(chunk * 65536 + reused);
  const wall = h.reg.index.get("core:wall")!;
  expect(structs.add(wall, chunkCx(h.world.dims, chunk) * CHUNK_SIZE + 9, 300, chunkCz(h.world.dims, chunk) * CHUNK_SIZE + 9, 0, 7, 100)).toBe(chunk * 65536 + reused);
  const ada = h.join("ada");
  const bob = h.join("bob", {}, { statics: false });
  const bytes = [0, 0];
  [0, 1].forEach((i) => {
    const end = h.ends[i]!;
    const on = end.onMessage!;
    end.onMessage = (ch, d) => {
      if (d[0] === S_CHUNK) bytes[i]! += d.length;
      on(ch, d);
    };
  });
  h.run(1000);
  const whole = (s: ClientSession): number[] => h.client(s)!.subscribed.filter((c) => structs.chunks[c] && h.client(s)!.known[c] === structs.chunks[c]!.version);
  const chunks = whole(ada);
  expect(chunks.includes(chunk) && chunks.filter((c) => held(c) > 0).length > 1).toBe(true);
  expect([differ(structs, ada.world!.structs, chunks), differ(structs, bob.world!.structs, whole(bob))]).toEqual([0, 0]);
  // Bob is sent every static as a row; Ada the chunks' headers, about 15 bytes each, and the three slots that changed.
  expect(bytes[0]! * 5).toBeLessThan(bytes[1]!);
  // A blow lands on the hurt one: its health alone, with the message's header, is a dozen bytes or so.
  const was = bytes[0]!;
  structs.damage(chunk * 65536 + hurt, 1);
  h.run(200);
  expect(bytes[0]! - was).toBeLessThanOrEqual(16);
  expect(ada.world!.structs.chunks[chunk]!.hp[hurt]).toBe(t.hp[hurt]!);
});

test("a client whose statics come after its hello is sent rows until it says it has them, and from the answer on only what differs", () => {
  const h = new Harness({}, 1, 30);
  const structs = h.world.structs;
  const cleo = h.join("cleo", {}, { statics: false });
  let bytes = 0;
  const end = h.ends[0]!;
  const on = end.onMessage!;
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) bytes += d.length;
    on(ch, d);
  };
  for (let n = 0; n < 100 && bytes === 0; n++) h.run(5);
  const c = h.client(cleo)!;
  expect([bytes > 0, c.statics]).toEqual([true, false]);
  cleo.staticsArrived(h.world.statics!);
  h.run(1000);
  const whole = c.subscribed.filter((k) => structs.chunks[k] && c.known[k] === structs.chunks[k]!.version);
  expect([c.statics, whole.length > 4, differ(structs, cleo.world!.structs, whole)]).toEqual([true, true, 0]);
  // The far city is made of them as well.
  expect(cleo.world!.city!.statics.count).toBeGreaterThan(100);
});

test("a near window of the map's statics is whole within a tick of the body's arrival for a client that holds them, rows still going at 256 slots a tick to one that does not", () => {
  // The 7 by 7 chunks round the middle of a map 9 chunks wide each hold 640 crates: 31,360 slots, 123 ticks at 256 a tick.
  const crates: MapStatic[] = [];
  for (let cz = 1; cz <= 7; cz++) for (let cx = 1; cx <= 7; cx++) for (let k = 0; k < 640; k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40 + Math.floor(k / 64) * 3, z: cz * CHUNK_SIZE + 4 + (Math.floor(k / 8) % 8) * 8, yaw: 0 });
  const h = new Harness({}, 1, 30, { map: writeMap(flatMap(9, { statics: crates })) });
  const structs = h.world.structs;
  // One crate of the middle chunk is gone, so that chunk is not as the map placed it.
  const middle = 4 * 9 + 4;
  structs.remove(middle * 65536 + 100);
  const window = [...Array(49).keys()].map((i) => (1 + Math.floor(i / 7)) * 9 + 1 + (i % 7));
  expect(window.filter((c) => structs.asPlaced(c)).length).toBe(48);
  const ada = h.join("ada");
  const bob = h.join("bob", {}, { statics: false });
  const sessions = [ada, bob];
  const [arrived, whole] = [[-1, -1], [-1, -1]];
  for (let t = 0; t < 300 && whole.includes(-1); t++) {
    h.run(1000 / 30);
    sessions.forEach((s, i) => {
      const c = h.client(s);
      if (arrived[i]! < 0 && c && c.ent >= 0) arrived[i] = h.world.tick;
      if (arrived[i]! >= 0 && whole[i]! < 0 && window.every((k) => c!.known[k] === structs.chunks[k]!.version)) whole[i] = h.world.tick - arrived[i]!;
    });
  }
  // Ticks from the body's arrival until the server has sent each chunk of the window whole.
  expect(whole[0]).toBeLessThanOrEqual(1);
  expect(whole[1]).toBeGreaterThanOrEqual(122);
  // Once what was sent has landed, each holds the window as the server does.
  h.run(1000);
  expect([differ(structs, ada.world!.structs, window), differ(structs, bob.world!.structs, window)]).toEqual([0, 0]);
});
