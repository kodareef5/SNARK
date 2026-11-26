// What a client is told of the structures around it.

import { expect, test } from "bun:test";
import { WAITING_MS, type ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { HeldStatics } from "../../client/core/map-statics.ts";
import { readHead, readPart, writeMap, type MapStatic, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { GONE_FELL, toldHealth, type StructureStore } from "../../shared/world/structures.ts";
import { boxBase, layBase } from "../../tools/bench/base.ts";
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

/** Slots of the chunks `held` has whole that differ from `structs`, an owned piece's health being the stage a client is told. */
function differ(structs: StructureStore, held: StructureStore, chunks: number[]): number {
  let n = 0;
  for (const c of chunks) {
    const [t, u] = [structs.chunks[c]!, held.chunks[c]!];
    for (let s = 0; s < Math.max(t.high, u.high); s++) {
      const kind = t.kind[s] ?? 0;
      const hp = kind !== 0 && t.owner[s] !== 0 ? toldHealth(t.hp[s]!, structs.fullHp![kind]!) : t.hp[s];
      if (kind !== (u.kind[s] ?? 0) || (kind !== 0 && ([t.x, t.y, t.z, t.yaw, t.owner].some((col, i) => col[s] !== [u.x, u.y, u.z, u.yaw, u.owner][i]![s]) || hp !== u.hp[s]))) n++;
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
  // and a wall set down, in a slot past the map's.
  let chunk = 0;
  for (let c = 0; c < structs.chunks.length; c++) if (held(c) > held(chunk)) chunk = c;
  const t = structs.chunks[chunk]!;
  const hurt = [...Array(held(chunk)).keys()].find((s) => h.reg.maxHp[t.kind[s]!]! > 100)!;
  const gone = (hurt + 1) % held(chunk);
  const other = (hurt + 2) % held(chunk);
  expect(structs.damage(chunk * 65536 + hurt, 50)).toBeGreaterThan(0);
  structs.remove(chunk * 65536 + gone);
  structs.remove(chunk * 65536 + other);
  const wall = h.reg.index.get("core:wall")!;
  expect(structs.add(wall, chunkCx(h.world.dims, chunk) * CHUNK_SIZE + 9, 300, chunkCz(h.world.dims, chunk) * CHUNK_SIZE + 9, 0, 7, 100)).toBe(chunk * 65536 + held(chunk));
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
  // Bob is sent every static as a row; Ada the chunks' headers, about 15 bytes each, and the four slots that changed.
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

test("statics handed over a step at a time leave the session and its world as they were until the last step, and are then what staticsArrived makes of them", () => {
  // More crates than a step makes, so that the city is made in several.
  const crates: MapStatic[] = [];
  for (let k = 0; k < 40000; k++) crates.push({ kind: "core:crate", x: (1 + (k % 7)) * CHUNK_SIZE + 4 + (Math.floor(k / 7) % 8) * 7, y: 40 + Math.floor(k / 3136) * 3, z: (1 + (Math.floor(k / 56) % 7)) * CHUNK_SIZE + 4 + (Math.floor(k / 392) % 8) * 7, yaw: 0 });
  const h = new Harness({}, 1, 30, { map: writeMap(flatMap(9, { statics: crates })) });
  const cleo = h.join("cleo", {}, { statics: false });
  for (let n = 0; n < 100 && !cleo.world; n++) h.run(5);
  const c = h.client(cleo)!;
  const steps = cleo.staticsSteps(h.world.statics!, true);
  let taken = 0;
  for (let s = steps.next(); !s.done; s = steps.next(), taken++) {
    h.run(20);
    expect([cleo.world!.city, c.statics]).toEqual([undefined, false]);
  }
  expect(taken).toBeGreaterThan(1);
  expect(cleo.world!.city!.statics.count).toBe(40000);
  h.run(1000);
  expect(c.statics).toBe(true);
});

test("a near window of the map's statics is whole within a tick of the body's arrival for a client that holds them, rows still going at 1,024 slots a tick to one that does not", () => {
  // The 7 by 7 chunks round the middle of a map 9 chunks wide each hold 640 crates: 31,360 slots, 31 ticks at 1,024 a tick.
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
  expect(whole[1]).toBeGreaterThanOrEqual(30);
  // Once what was sent has landed, each holds the window as the server does.
  h.run(1000);
  expect([differ(structs, ada.world!.structs, window), differ(structs, bob.world!.structs, window)]).toEqual([0, 0]);
});

test("a changed chunk cut over several messages lands whole on a map-holding client", () => {
  // 600 crates in one chunk: every fifth gone, every seventh hurt, every eleventh another kind, and 40 pieces built over them.
  const crates: MapStatic[] = [];
  for (let k = 0; k < 600; k++) crates.push({ kind: "core:crate", x: 4 * CHUNK_SIZE + 4 + (k % 8) * 7, y: 40 + Math.floor(k / 64) * 3, z: 4 * CHUNK_SIZE + 4 + (Math.floor(k / 8) % 8) * 7, yaw: 0 });
  const h = new Harness({ chunkSlotsPerTick: 16 }, 1, 30, { map: writeMap(flatMap(9, { statics: crates })) });
  const structs = h.world.structs;
  const chunk = 4 * 9 + 4;
  const wall = h.reg.index.get("core:wall")!;
  for (let s = 0; s < 600; s++) {
    if (s % 5 === 0) structs.remove(chunk * 65536 + s);
    else if (s % 7 === 0) structs.damage(chunk * 65536 + s, 1 + (s % 3));
    else if (s % 11 === 0) structs.swap(chunk * 65536 + s, wall);
  }
  for (let i = 0; i < 40; i++) structs.add(wall, 4 * CHUNK_SIZE + 5 + i, 300, 4 * CHUNK_SIZE + 30, 0, 7, 100);
  for (let i = 0; i < 40; i += 4) structs.remove(chunk * 65536 + 600 + i);
  const t = structs.chunks[chunk]!;
  const ada = h.join("ada");
  let messages = 0;
  const end = h.ends[0]!;
  const on = end.onMessage!;
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK && (d[1]! | (d[2]! << 8)) === chunk) messages++;
    on(ch, d);
  };
  h.run(3000);
  // 226 changed map slots and 40 slots past them, 16 rows a message.
  expect([t.changed, structs.changedSlots(chunk).length, messages]).toEqual([226, 226, 17]);
  expect([h.client(ada)!.known[chunk], differ(structs, ada.world!.structs, [chunk]), ada.world!.structs.chunks[chunk]!.live]).toEqual([t.version, 0, t.live]);
});

test("a client holding the map is sent no full row for a damaged map slot", () => {
  const crates: MapStatic[] = [];
  for (let k = 0; k < 600; k++) crates.push({ kind: k % 2 === 0 ? "core:crate" : "core:wall", x: 4 * CHUNK_SIZE + 4 + (k % 8) * 7, y: 40 + Math.floor(k / 64) * 3, z: 4 * CHUNK_SIZE + 4 + (Math.floor(k / 8) % 8) * 7, yaw: (k * 4096) & 0xffff });
  const chunk = 4 * 9 + 4;
  /** The bytes of the chunk's messages to a client that joins after `change`, and what it then holds that the server does not. */
  const join = (change: (structs: StructureStore) => void): number[] => {
    const h = new Harness({}, 1, 30, { map: writeMap(flatMap(9, { statics: crates })) });
    change(h.world.structs);
    const ada = h.join("ada");
    let bytes = 0;
    const end = h.ends[0]!;
    const on = end.onMessage!;
    end.onMessage = (ch, d) => {
      if (d[0] === S_CHUNK && (d[1]! | (d[2]! << 8)) === chunk) bytes += d.length;
      on(ch, d);
    };
    h.run(2000);
    return [bytes, differ(h.world.structs, ada.world!.structs, [chunk]), h.client(ada)!.known[chunk]! - h.world.structs.chunks[chunk]!.version];
  };
  const [header] = join(() => {});
  // 100 pieces hurt, each to a health of its own: its slot, that it stands where the map has it, nobody's, and the health.
  const [hurt, wrong, behind] = join((structs) => [...Array(100).keys()].forEach((i) => structs.damage(chunk * 65536 + i * 5, 1 + (i % 7))));
  expect([wrong, behind]).toEqual([0, 0]);
  // That is 5.5 bytes a piece. A full row is its kind, place, height and turn besides, over 10.
  expect((hurt! - header!) / 100).toBeLessThanOrEqual(6);
  // A piece of another kind in the slot is still told whole, and a slot emptied as a row that says only that.
  const [mixed, off] = join((structs) => {
    const wall = structs.mapKind(chunk, 1);
    for (let i = 0; i < 100; i++) {
      if (i % 3 === 0) structs.swap(chunk * 65536 + i * 4, wall);
      else if (i % 3 === 1) structs.remove(chunk * 65536 + i * 4);
      else structs.damage(chunk * 65536 + i * 4, 2);
    }
  });
  expect([off, mixed! > header!]).toEqual([0, true]);
});

test("a page holding the map a sector at a time says so at once and keeps chunk messages until it comes", () => {
  // The 7 by 7 chunks round the middle of a map 9 chunks wide each hold 64 crates; one is gone and one hurt.
  const crates: MapStatic[] = [];
  for (let cz = 1; cz <= 7; cz++) for (let cx = 1; cx <= 7; cx++) for (let k = 0; k < 64; k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40, z: cz * CHUNK_SIZE + 4 + Math.floor(k / 8) * 8, yaw: 0 });
  const file = writeMap(flatMap(9, { statics: crates }));
  const h = new Harness({}, 1, 30, { map: file });
  const structs = h.world.structs;
  const middle = 4 * 9 + 4;
  structs.remove(middle * 65536 + 10);
  expect(structs.damage(middle * 65536 + 11, 5)).toBeGreaterThan(0);
  const head = readHead(file);
  const held = new HeldStatics(head);
  const dana = h.join("dana", {}, { statics: false, held });
  h.run(1000);
  const c = h.client(dana)!;
  const window = c.subscribed.filter((k) => structs.chunks[k] && c.known[k] === structs.chunks[k]!.version);
  // The server is told at the first frame. Chunks sent before its answer come as rows; from it on they wait for the sector.
  const waiting = window.filter((k) => (dana.world!.structs.chunks[k]?.live ?? 0) === 0 && structs.chunks[k]!.live > 0);
  expect([c.statics, waiting.length > 0, waiting.length < window.length, [...held.needed].map((p) => p.name)]).toEqual([true, true, true, head.parts.filter((p) => p.kind === "statics").map((p) => p.name)]);
  const part = held.parts[0]!;
  const steps = held.set(part, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece);
  while (!steps.next().done);
  expect([held.needed.size, differ(structs, dana.world!.structs, window)]).toEqual([0, 0]);
  // From then on what changes comes as before.
  structs.remove(middle * 65536 + 12);
  h.run(500);
  expect(differ(structs, dana.world!.structs, window)).toBe(0);
});

/** A map `chunks` wide whose 7 by 7 chunks round the first spawn hold 64 crates each, and a client holding its statics a sector at a time, none yet. */
function sectorPage(chunks = 9) {
  const crates: MapStatic[] = [];
  const mid = Math.floor(chunks / 2);
  for (let cz = mid - 3; cz <= mid + 3; cz++) for (let cx = mid - 3; cx <= mid + 3; cx++) for (let k = 0; k < 64; k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40, z: cz * CHUNK_SIZE + 4 + Math.floor(k / 8) * 8, yaw: 0 });
  const file = writeMap(flatMap(chunks, { statics: crates }));
  const h = new Harness({}, 1, 30, { map: file });
  const head = readHead(file);
  const held = new HeldStatics(head);
  const said: string[] = [];
  held.say = (line) => void said.push(line);
  const dana = h.join("dana", {}, { statics: false, held });
  const set = (n = 0): void => {
    const part = held.parts[n]!;
    const steps = held.set(part, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece);
    while (!steps.next().done);
  };
  const waiting = (): number => (dana as unknown as { waitingRows: unknown[] }).waitingRows.length;
  return { h, held, said, dana, set, waiting, structs: h.world.structs, middle: mid * chunks + mid, chunks };
}

test("a broken sector's chunk messages are read without its map slots, and sync goes on", () => {
  const { h, held, dana, waiting, structs, middle, chunks } = sectorPage();
  h.run(1000);
  expect([waiting() > 0, held.needed.size]).toEqual([true, 1]);
  held.broke(held.parts[0]!);
  expect([waiting(), held.needed.size]).toEqual([0, 0]);
  // A piece built after it comes as rows do.
  const ref = structs.add(h.reg.index.get("core:wall")!, (middle % chunks) * CHUNK_SIZE + 2, 1.88, Math.floor(middle / chunks) * CHUNK_SIZE + 60, 0, 1, 100);
  h.run(500);
  const t = dana.world!.structs.chunks[middle]!, slot = ref % 65536;
  expect([waiting(), t.kind[slot], t.x[slot]]).toEqual([0, structs.chunks[middle]!.kind[slot], structs.chunks[middle]!.x[slot]]);
});

test("past the most chunk messages kept waiting, the first is read without its map slots", () => {
  const { h, said, dana, waiting } = sectorPage();
  dana.waitingMost = 2;
  h.run(1000);
  expect([waiting() <= 2, said.length > 0, said[0]?.includes("waited for too long")]).toEqual([true, true, true]);
});

test("a chunk read without its map slots stays incomplete, and is sent again whole once they come", () => {
  const { h, said, dana, set, waiting, structs, middle } = sectorPage();
  dana.waitingMost = 2;
  h.run(1000);
  const read = said.map((line) => Number(/chunk (\d+) were waited/.exec(line)?.[1] ?? -1)).filter((c) => c >= 0);
  const complete = (c: number): boolean => (dana as unknown as { whole: Uint8Array }).whole[c] !== 0;
  expect([read.length > 0, read.some(complete)]).toEqual([true, false]);
  // A map piece of one of them is hurt meanwhile: its row in place has no row to land on.
  const hurt = read[0]!;
  expect(structs.damage(hurt * 65536 + 3, 5)).toBeGreaterThan(0);
  h.run(500);
  expect(read.some(complete)).toBe(false);
  set();
  h.run(1000);
  expect([waiting(), read.every(complete), differ(structs, dana.world!.structs, [...read, middle])]).toEqual([0, true, 0]);
});

test("a chunk message kept past its time is read without its map slots", () => {
  const { h, said, dana, set, waiting, structs, middle } = sectorPage();
  dana.waitingMs = 1500;
  h.run(1000);
  const complete = (c: number): boolean => (dana as unknown as { whole: Uint8Array }).whole[c] !== 0;
  // Three chunks east of the body's, which came as rows before the server heard the page holds the map.
  const east = middle + 3;
  expect([waiting() > 0, complete(middle), complete(east)]).toEqual([true, true, false]);
  // A wall built there meanwhile reaches the page once the wait is out, though the map's pieces round it have not.
  const ref = structs.add(h.reg.index.get("core:wall")!, (east % 9) * CHUNK_SIZE + 2, 1.88, Math.floor(east / 9) * CHUNK_SIZE + 60, 0, 1, 100);
  h.run(1500);
  expect([waiting(), complete(east), dana.world!.structs.chunks[east]?.kind[ref % 65536], said]).toEqual([0, false, structs.chunks[east]!.kind[ref % 65536], []]);
  set();
  h.run(1000);
  const c = h.client(dana)!;
  const window = c.subscribed.filter((k) => structs.chunks[k] && c.known[k] === structs.chunks[k]!.version);
  expect([window.every(complete), differ(structs, dana.world!.structs, window)]).toEqual([true, 0]);
});

/** Reads the chunk messages a session keeps as if `one` alone had waited its time. */
function overdue(s: ClientSession, one: { at: number }): void {
  const inner = s as unknown as { waitingRows: { at: number }[]; readWaiting(): void };
  for (const m of inner.waitingRows) m.at = m === one ? 0 : Infinity;
  s.waitingMs = 0;
  inner.readWaiting();
  s.waitingMs = WAITING_MS;
  for (const m of inner.waitingRows) m.at = -1;
}

for (const bare of [3, 4]) {
  test(`a frame's messages are read in the order they came while one waits for its sector (${bare})`, () => {
    // The 7 by 7 chunks round the middle hold crates but one, three rows north of the body; a wooden box 63 m long lies
    // across that one and the next on one frame.
    const crates: MapStatic[] = [];
    for (let cz = 1; cz <= 7; cz++) for (let cx = 1; cx <= 7; cx++) for (let k = 0; k < 64 && (cz !== 1 || cx !== bare); k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40, z: cz * CHUNK_SIZE + 4 + Math.floor(k / 8) * 8, yaw: 0 });
    const file = writeMap(flatMap(9, { statics: crates }));
    const h = new Harness({}, 1, 30, { map: file });
    const structs = h.world.structs, head = readHead(file), held = new HeldStatics(head);
    layBase(structs, boxBase(h.reg, "wood", 3 * CHUNK_SIZE + 32.5, 100, CHUNK_SIZE + 0.5, 21, 1, 3000), 7, (kind) => h.reg.maxHp[kind]!);
    const [waits, other] = [9 + (bare === 3 ? 4 : 3), 9 + bare];
    expect([structs.chunks[waits]!.live > 64, structs.chunks[other]!.live > 0, structs.frames.count]).toEqual([true, true, 1]);
    const dana = h.join("dana", {}, { statics: false, held });
    h.run(1500);
    // The chunk with none of the map's pieces waits for no sector. Sent first, it is read at once and holds the frame as
    // the server has it; sent after the one that waits, which names its frame, it is kept behind it.
    const mine = dana.world!.structs;
    const frames = (of: StructureStore): number[][] => [...of.frames.all()].map((f) => [f.gid, f.ox, f.oy, f.oz, f.yaw, f.team]);
    const first = bare === 4;
    expect([(dana as unknown as { waitingRows: unknown[] }).waitingRows.length > 0, mine.chunks[waits]?.live ?? 0, (mine.chunks[other]?.live ?? 0) > 0, frames(mine)]).toEqual([true, 0, first, first ? frames(structs) : []]);
    if (first) expect(differ(structs, mine, [other])).toBe(0);
    // No sector for four seconds: both are read, the one that waited without the map's pieces.
    h.run(3500);
    expect([differ(structs, mine, [other]), mine.chunks[waits]!.live, frames(mine)]).toEqual([0, structs.chunks[waits]!.live - 64, frames(structs)]);
    const part = held.parts[0]!;
    const steps = held.set(part, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece);
    while (!steps.next().done);
    h.run(1000);
    expect([differ(structs, mine, [waits, other]), frames(mine)]).toEqual([0, frames(structs)]);
  });
}

test("a chunk cut over several messages, its first read without its map slots, is whole only once sent again", () => {
  const crates: MapStatic[] = [];
  for (let cz = 1; cz <= 7; cz++) for (let cx = 1; cx <= 7; cx++) for (let k = 0; k < 64; k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40, z: cz * CHUNK_SIZE + 4 + Math.floor(k / 8) * 8, yaw: 0 });
  const file = writeMap(flatMap(9, { statics: crates }));
  // 16 rows a message, and 40 crates hurt three chunks east of the body: that chunk comes in three messages.
  const h = new Harness({ chunkSlotsPerTick: 16 }, 1, 30, { map: file });
  const structs = h.world.structs, head = readHead(file), held = new HeldStatics(head), east = 4 * 9 + 7;
  for (let s = 0; s < 40; s++) structs.damage(east * 65536 + s, 1 + (s % 3));
  const dana = h.join("dana", {}, { statics: false, held });
  const inner = dana as unknown as { waitingRows: { chunk: number; at: number }[]; whole: Uint8Array; unbased: Set<number> };
  const parts = (): { chunk: number; at: number }[] => inner.waitingRows.filter((m) => m.chunk === east);
  for (let k = 0; k < 200 && parts().length < 3; k++) h.run(33);
  expect(parts().length).toBe(3);
  // Its first message has waited its time and the rest have not, when the sector comes.
  overdue(dana, parts()[0]!);
  expect([parts().length, inner.unbased.has(east)]).toEqual([2, true]);
  const part = held.parts[0]!;
  const steps = held.set(part, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece);
  while (!steps.next().done);
  expect([parts().length, inner.whole[east]]).toEqual([0, 0]);
  h.run(2000);
  expect([inner.whole[east], inner.unbased.size, differ(structs, dana.world!.structs, [east])]).toEqual([1, 0, 0]);
});

test("a chunk asked for again while the server is still sending it is sent from its start", () => {
  const crates: MapStatic[] = [];
  for (let cz = 1; cz <= 7; cz++) for (let cx = 1; cx <= 7; cx++) for (let k = 0; k < 64; k++) crates.push({ kind: "core:crate", x: cx * CHUNK_SIZE + 4 + (k % 8) * 8, y: 40, z: cz * CHUNK_SIZE + 4 + Math.floor(k / 8) * 8, yaw: 0 });
  const file = writeMap(flatMap(9, { statics: crates }));
  const h = new Harness({ chunkSlotsPerTick: 16 }, 1, 30, { map: file });
  const structs = h.world.structs, head = readHead(file), held = new HeldStatics(head), east = 4 * 9 + 7;
  for (let s = 0; s < 40; s++) structs.damage(east * 65536 + s, 1 + (s % 3));
  const dana = h.join("dana", {}, { statics: false, held });
  const inner = dana as unknown as { waitingRows: { chunk: number; at: number }[]; whole: Uint8Array; unbased: Set<number> };
  const parts = (): { chunk: number; at: number }[] => inner.waitingRows.filter((m) => m.chunk === east);
  // Its first message alone has come, and has waited its time; then the sector comes, and the rest after it.
  for (let k = 0; k < 400 && parts().length < 1; k++) h.run(8);
  expect([parts().length, h.client(dana)!.syncChunk]).toEqual([1, east]);
  overdue(dana, parts()[0]!);
  const part = held.parts[0]!;
  const steps = held.set(part, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece);
  while (!steps.next().done);
  expect([inner.unbased.has(east), inner.whole[east]]).toEqual([true, 0]);
  h.run(2000);
  expect([inner.whole[east], inner.unbased.size, differ(structs, dana.world!.structs, [east])]).toEqual([1, 0, 0]);
});

test("a chunk dropped while messages wait is kept aside in order, and CMD_HAVE takes it back", () => {
  const { h, dana, set, waiting, structs, chunks } = sectorPage(13);
  h.run(1000);
  const c = h.client(dana)!;
  c.admin = true;
  expect(waiting()).toBeGreaterThan(0);
  // Off to the far corner: chunks round the start are dropped while the messages still wait.
  h.say(dana, `tp ${12 * CHUNK_SIZE + 32} ${12 * CHUNK_SIZE + 32}`);
  h.run(1500);
  expect(waiting()).toBeGreaterThan(0);
  set();
  const parked = (dana as unknown as { parked: Map<number, unknown> }).parked;
  expect([waiting(), parked.size > 0]).toEqual([0, true]);
  // Back: the server is told which it kept, and they are put back as the server has them.
  h.say(dana, `tp ${6 * CHUNK_SIZE + 32} ${6 * CHUNK_SIZE + 32}`);
  h.run(2000);
  const window = c.subscribed.filter((k) => structs.chunks[k] && c.known[k] === structs.chunks[k]!.version);
  expect([window.length > 0, differ(structs, dana.world!.structs, window), chunks]).toEqual([true, 0, 13]);
});

test("a sector the near store holds chunks of is kept, and its map kinds read", () => {
  const { h, held, dana, set, structs, middle } = sectorPage(20);
  h.run(1000);
  set(0);
  h.run(500);
  const near = held.partOf(middle)!, other = held.parts.find((p) => p !== near && p.row === near.row)!;
  expect([held.keep!(near), held.keep!(other), dana.mapKind(middle, 0)]).toEqual([true, false, structs.chunks[middle]!.kind[0]]);
});
