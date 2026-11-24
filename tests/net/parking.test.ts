// A client keeps a chunk it is told to drop, says so when it is near again, and is sent only what changed.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { CMD_HAVE, C_COMMAND, S_CHUNK, S_CHUNK_DROP, S_RESULT } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { toldHealth, type StructureStore } from "../../shared/world/structures.ts";
import { boxBase, layBase } from "../../tools/bench/base.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const MAP = writeMap(flatMap(12));
/** The base's chunk, in the row the survivor is moved along. */
const [BASE_CX, ROW] = [2, 6];
const BASE = ROW * 12 + BASE_CX;

/**
 * A survivor who has seen a 5,000-piece base whole and stands five chunks from it, the base dropped and kept. `go` sets
 * it down in the chunk so many from the base's; `bytes` are those of the base's rows, of drops and answers, and of
 * what the client said it kept, both ways, since `mark`.
 */
function away(link: LinkOptions = {}) {
  const h = new Harness({}, 1, 30, { map: MAP });
  const s = h.join("ada", link);
  h.run(1000);
  const structs = h.world.structs;
  layBase(structs, boxBase(h.reg, "wood", BASE_CX * CHUNK_SIZE + 0.5, 100, ROW * CHUNK_SIZE + 0.5, 21, 1, 5000), 7, (kind) => h.reg.maxHp[kind]!);
  const go = (chunks: number): void => void h.world.ents.setPosition(h.ent(s), (BASE_CX + chunks + 0.5) * CHUNK_SIZE, 0, (ROW + 0.5) * CHUNK_SIZE);
  let bytes = 0;
  let whole = 0;
  const end = h.ends[0]!;
  const on = end.onMessage!;
  end.onMessage = (ch, d) => {
    const rows = d[0] === S_CHUNK && (d[1]! | (d[2]! << 8)) === BASE;
    if (rows || d[0] === S_CHUNK_DROP || d[0] === S_RESULT) bytes += d.length;
    if (rows) whole += d.length;
    on(ch, d);
  };
  const send = end.send.bind(end);
  const r = new BitReader(new Uint8Array(0));
  end.send = (ch, d) => {
    r.reset(d);
    if (r.bits(4) === C_COMMAND && (r.u16(), r.u8()) === CMD_HAVE) bytes += d.length;
    send(ch, d);
  };
  go(0);
  h.run(2000);
  expect(s.world!.structs.chunks[BASE]!.live).toBe(5000);
  // The whole base as rows by their keys: about 8 KB.
  expect(whole).toBeGreaterThan(6000);
  go(5);
  h.run(2000);
  expect([s.world!.structs.chunks[BASE], h.client(s)!.known[BASE], h.client(s)!.parked.get(BASE)]).toEqual([null, 0, structs.chunks[BASE]!.version]);
  return { h, s, structs, go, bytes: () => bytes, mark: () => void (bytes = 0) };
}

/**
 * Slots of the base's chunk the client holds otherwise than the server, its frame, key and turn class among them, an
 * owned piece's health as a client is told it.
 */
function differ(structs: StructureStore, s: ClientSession): number {
  const [t, u] = [structs.chunks[BASE]!, s.world!.structs.chunks[BASE]];
  if (!u || u.version !== t.version || u.live !== t.live) return -1;
  let n = 0;
  for (let k = 0; k < Math.max(t.high, u.high); k++) {
    const kind = t.kind[k] ?? 0;
    const hp = kind !== 0 ? toldHealth(t.hp[k]!, structs.fullHp![kind]!) : 0;
    const cols = (of: typeof t): number[] => [of.x[k]!, of.y[k]!, of.z[k]!, of.yaw[k]!, of.owner[k]!, of.fr?.[k] ?? 0, of.k0?.[k] ?? 0, of.k1?.[k] ?? 0, of.tw?.[k] ?? 0];
    if (kind !== (u.kind[k] ?? 0) || (kind !== 0 && (cols(t).some((v, i) => v !== cols(u)[i]) || hp !== u.hp[k]))) n++;
  }
  return n;
}

test("coming back to an unchanged 5,000-piece base costs at most 64 bytes", () => {
  const { h, s, structs, go, bytes, mark } = away();
  mark();
  // A chunk nearer, the client says what it kept and has it again; nearer still, the server has nothing to add.
  go(4);
  h.run(1000);
  expect(differ(structs, s)).toBe(0);
  go(3);
  h.run(1000);
  go(0);
  h.run(1000);
  expect(differ(structs, s)).toBe(0);
  expect(h.client(s)!.known[BASE]).toBe(structs.chunks[BASE]!.version);
  // What it said, the answer, and a header that says nothing changed.
  expect(bytes()).toBeGreaterThan(0);
  expect(bytes()).toBeLessThanOrEqual(64);
  // Bullets through the wall it stands by land on it: the rows are in the grid again.
  expect(s.world!.structs.count).toBe(5000);
});

test("coming back after ten changes costs at most 200 bytes, and the client holds the base as it stands", () => {
  const { h, s, structs, go, bytes, mark } = away();
  const t = structs.chunks[BASE]!;
  const kept = t.version;
  const live = [...Array(t.high).keys()].filter((k) => t.kind[k] !== 0);
  for (const k of [10, 700, 2400, 4100]) structs.damage(BASE * 65536 + live[k]!, h.reg.maxHp[t.kind[live[k]!]!]! / 3);
  const wall = h.reg.index.get("core:wall_wood")!;
  for (let i = 0; i < 3; i++) structs.add(wall, BASE_CX * CHUNK_SIZE + 10 + i * 3, 160, ROW * CHUNK_SIZE + 30, 0, 7, h.reg.maxHp[wall]!);
  for (const k of [50, 1900, 4990]) structs.remove(BASE * 65536 + live[k]!);
  // Long enough that the removals are no longer news. Ten slots changed, or more if anything fell for them.
  h.run(3000);
  const changed = [...Array(t.high).keys()].filter((k) => t.mod[k]! > kept).length;
  expect(changed >= 10 && changed <= 16).toBe(true);
  let told = 0;
  s.onStructure = () => void told++;
  mark();
  go(4);
  h.run(1000);
  go(0);
  h.run(1000);
  expect([differ(structs, s), s.world!.structs.count]).toEqual([0, structs.count]);
  // More than the 26 bytes an unchanged base costs. Keyed rows brought ten changes under 64.
  expect(bytes()).toBeGreaterThan(26);
  expect(bytes()).toBeLessThanOrEqual(200);
  // What changed while it was away is not heard as it comes. The next change is.
  expect(told).toBe(0);
  structs.remove(BASE * 65536 + live[3000]!);
  h.run(300);
  expect([told, differ(structs, s)]).toEqual([1, 0]);
});

test("a kept chunk the server does not remember so comes whole", () => {
  const { h, s, structs, go, bytes, mark } = away();
  // As after a chunk is set back wholesale: the session's version of it is forgotten.
  h.client(s)!.parked.clear();
  mark();
  go(4);
  h.run(1000);
  // Refused, the client let go of what it kept, and nothing of the chunk is drawn from a stale copy.
  expect(s.world!.structs.chunks[BASE]).toBeNull();
  go(0);
  h.run(2000);
  expect(differ(structs, s)).toBe(0);
  expect(bytes()).toBeGreaterThan(6000);
});

test("a version other than the one it was dropped at is refused", () => {
  const { h, s, structs, go } = away();
  const c = h.client(s)!;
  c.parked.set(BASE, c.parked.get(BASE)! - 1);
  go(4);
  h.run(1000);
  expect([s.world!.structs.chunks[BASE], c.known[BASE], c.parked.has(BASE)]).toEqual([null, 0, false]);
  go(0);
  h.run(2000);
  expect(differ(structs, s)).toBe(0);
});

test("set down on the base at once, with no time to say what it kept, the client takes it whole", () => {
  const { h, s, structs, go, bytes, mark } = away();
  structs.remove(BASE * 65536 + 40);
  mark();
  go(0);
  h.run(2000);
  expect(differ(structs, s)).toBe(0);
  expect(bytes()).toBeGreaterThan(6000);
});

test("what it kept is said while the server is already sending the chunk whole: the rows win", () => {
  // 150 ms each way: the client says what it kept, and before that arrives the server has it on the base.
  const { h, s, structs, go } = away({ tcp: true, latencyMs: 150 });
  structs.remove(BASE * 65536 + 40);
  go(4);
  h.run(200);
  go(0);
  h.run(4000);
  const c = h.client(s)!;
  expect([differ(structs, s), c.claimed.length, c.known[BASE]]).toEqual([0, 0, structs.chunks[BASE]!.version]);
});

test("a touch device keeps two chunks, and the oldest goes first", () => {
  const h = new Harness({}, 1, 30, { map: MAP });
  const s = h.join("ada");
  s.parkMost = 2;
  h.run(1000);
  const wall = h.reg.index.get("core:wall_wood")!;
  const chunks = [1, 2, 3].map((cx) => ROW * 12 + cx);
  for (const cx of [1, 2, 3]) h.world.structs.add(wall, cx * CHUNK_SIZE + 5, 100, ROW * CHUNK_SIZE + 5, 0, 7, h.reg.maxHp[wall]!);
  const go = (cx: number): void => void h.world.ents.setPosition(h.ent(s), (cx + 0.5) * CHUNK_SIZE, 0, (ROW + 0.5) * CHUNK_SIZE);
  go(2);
  h.run(1500);
  expect(chunks.map((c) => s.world!.structs.chunks[c]?.live)).toEqual([1, 1, 1]);
  // East until each is dropped in turn, the westmost first.
  for (const cx of [6, 7, 8]) {
    go(cx);
    h.run(1500);
  }
  expect(chunks.map((c) => s.world!.structs.chunks[c])).toEqual([null, null, null]);
  // Back by a chunk: the two newest are had again from what was kept, the oldest from the server.
  let rows = 0;
  const end = h.ends[0]!;
  const on = end.onMessage!;
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK && d.length > 16) rows++;
    on(ch, d);
  };
  for (const cx of [7, 6, 5, 4]) {
    go(cx);
    h.run(1500);
  }
  expect(chunks.map((c) => s.world!.structs.chunks[c]?.live)).toEqual([1, 1, 1]);
  expect(rows).toBe(1);
});
