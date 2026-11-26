// Built pieces cross the wire by frame and key: what a row costs, and that a client holds the server's own frames and keys.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import type { LatticeKey } from "../../shared/world/lattice/frames.ts";
import { CLS_SQUARE, key0, key1 } from "../../shared/world/lattice/module.ts";
import { Cells, formCells } from "../../shared/world/lattice/occupancy.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FRAMES_TOLD, ROW_BITS_MOST, ROW_FREE, ROW_KEYED, RowCoder } from "../../shared/world/rows.ts";
import { tekWallKinds } from "../../shared/world/lattice/tek-walls.ts";
import { Found, StructureStore, toldHealth } from "../../shared/world/structures.ts";
import { boxBase, layBase, layPieces } from "../../tools/bench/base.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { start } from "../fixtures/slots.ts";
import { Base, dodecagon, mixedHouse, turnedRegistry } from "../fixtures/turned.ts";
import { coreRegistry, type TestWorld } from "../fixtures/world.ts";

/** A flat map with no statics, so a chunk message is its header and its rows. */
const MAP = writeMap(flatMap(12));
const cells = new Cells();
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };

/** The chunks a session holds whole. */
function wholeOf(h: Harness, s: ClientSession): number[] {
  const c = h.client(s)!;
  return c.subscribed.filter((k) => h.world.structs.chunks[k] && c.known[k] === h.world.structs.chunks[k]!.version);
}

/**
 * What a session's store holds otherwise than the server's, in words: a slot of a chunk it holds whole, its frame, key
 * and turn class among its columns; a frame that is not the server's of that number; a keyed row a cell does not name;
 * and cells or frames no row accounts for. An owned piece's health is the stage a client is told.
 */
function wrong(h: Harness, s: ClientSession): string[] {
  const [structs, held] = [h.world.structs, s.world!.structs];
  const out: string[] = [];
  for (const c of wholeOf(h, s)) {
    const [t, u] = [structs.chunks[c]!, held.chunks[c]];
    if (!u) {
      if (t.live > 0) out.push(`chunk ${c} is not held`);
      continue;
    }
    for (let k = 0; k < Math.max(t.high, u.high); k++) {
      const kind = t.kind[k] ?? 0;
      const cols = (of: typeof t): number[] => [of.kind[k] ?? 0, of.x[k]!, of.y[k]!, of.z[k]!, of.yaw[k]!, of.owner[k]!, of.fr?.[k] ?? 0, of.k0?.[k] ?? 0, of.k1?.[k] ?? 0, of.tw?.[k] ?? 0];
      const hp = kind !== 0 && t.owner[k] !== 0 ? toldHealth(t.hp[k]!, structs.fullHp![kind]!) : t.hp[k];
      if (kind === 0 ? (u.kind[k] ?? 0) !== 0 : cols(t).some((v, i) => v !== cols(u)[i]) || hp !== u.hp[k]) out.push(`chunk ${c} slot ${k}: ${cols(t)} is held as ${cols(u)}`);
    }
  }
  const rows = new Map<number, number>();
  let entries = 0;
  for (const c of held.held) {
    const u = held.chunks[c]!;
    for (let k = 0; k < u.high; k++) {
      if (!held.keyAt(c * 65536 + k, key)) continue;
      rows.set(key.fr, (rows.get(key.fr) ?? 0) + 1);
      formCells(held.forms!, u.kind[k]!, key.k0, key.k1, cells);
      entries += cells.n;
      for (let i = 0; i < cells.n; i++) if (held.refAt(key.fr, cells.k0[i]!, cells.k1[i]!) !== c * 65536 + k) out.push(`chunk ${c} slot ${k} is not in its cell`);
    }
  }
  if (held.occupied.size !== entries) out.push(`${held.occupied.size} cells are taken by rows that cover ${entries}`);
  if (held.frames.count !== rows.size) out.push(`${held.frames.count} frames for rows in ${rows.size}`);
  for (const f of held.frames.all()) {
    const g = structs.frames.get(f.gid);
    if (!g || [g.ox, g.oy, g.oz, g.yaw, g.team].some((v, i) => v !== [f.ox, f.oy, f.oz, f.yaw, f.team][i]) || f.live !== rows.get(f.gid)) out.push(`frame ${f.gid} is not the server's`);
  }
  return out;
}

/** Counts a session's chunk messages from now on: their bytes, how many, and the frames their rows defined, by gid. */
function tap(h: Harness, s: ClientSession, only = -1): { bytes: number; messages: number; rows: number; defined: number[] } {
  const seen = { bytes: 0, messages: 0, rows: 0, defined: [] as number[] };
  const end = h.ends[h.sessions.indexOf(s)]!;
  const on = end.onMessage!;
  const r = new BitReader();
  const coder = new RowCoder(h.reg.forms, h.reg.maxHp, { phaseKinds: tekWallKinds(h.reg.index) });
  end.onMessage = (ch, d) => {
    r.reset(d);
    if (r.u8() === S_CHUNK) {
      const chunk = r.u16();
      if (only < 0 || chunk === only) {
        seen.bytes += d.length;
        seen.messages++;
        r.u32();
        r.bool();
        coder.begin(chunkCx(h.world.dims, chunk) * CHUNK_SIZE, chunkCz(h.world.dims, chunk) * CHUNK_SIZE);
        for (let n = r.bits(16); n > 0; n--) {
          coder.read(r);
          seen.rows++;
          if (coder.def) seen.defined.push(coder.def.gid);
        }
      }
    }
    on(ch, d);
  };
  return seen;
}

const found = new Found();

/** The refs the grid lists in each 2 m square of the 40 m round (x, z): what a body or a ray there is tested against. */
function listed(structs: StructureStore, x: number, z: number): string[] {
  const out: string[] = [];
  for (let i = -10; i < 10; i++) {
    for (let j = -10; j < 10; j++) {
      const n = structs.query(x + 2 * i, z + 2 * j, x + 2 * i + 2, z + 2 * j + 2, found);
      out.push([...found.refs.subarray(0, n)].sort((a, b) => a - b).join());
    }
  }
  return out;
}

/** A survivor in the middle of the flat map, and its chunk's corner. */
function watcher(link: LinkOptions = {}, seed = 1, reg = coreRegistry()) {
  const h = new Harness({}, seed, 30, { map: MAP }, reg);
  const s = h.join("ada", link);
  h.run(1000);
  const chunk = h.world.ents.chunk[h.ent(s)]!;
  const go = (to: number): void => void h.world.ents.setPosition(h.ent(s), (chunkCx(h.world.dims, to) + 0.5) * CHUNK_SIZE, 0, (chunkCz(h.world.dims, to) + 0.5) * CHUNK_SIZE);
  return { h, s, chunk, structs: h.world.structs, x0: chunkCx(h.world.dims, chunk) * CHUNK_SIZE, z0: chunkCz(h.world.dims, chunk) * CHUNK_SIZE, go };
}

test("a 20,000-piece keyed chunk joins at 3.6 bytes a piece or less, and the client holds the server's frame and keys", () => {
  const { h, s, chunk, structs, x0, z0 } = watcher({ tcp: true, latencyMs: 25 });
  const seen = tap(h, s, chunk);
  layBase(structs, boxBase(h.reg, "wood", x0 + 0.5, 300, z0 + 0.5, 21, 1, 20000), 7, (kind) => h.reg.maxHp[kind]!);
  h.run(3000);
  const t = structs.chunks[chunk]!;
  expect([t.live, t.fr!.filter((gid) => gid !== 0).length, structs.frames.count]).toEqual([20000, 20000, 1]);
  expect(wrong(h, s)).toEqual([]);
  expect([s.world!.structs.chunks[chunk]!.live, seen.defined]).toEqual([20000, [structs.frameAt(chunk * 65536)]]);
  // 1.59 bytes a piece in the order the base was built: 31.8 KB where rows by their poses were 97 KB, 4.86 a piece.
  expect(seen.bytes / 20000).toBeLessThanOrEqual(3.6);
  expect(seen.bytes / 20000).toBeLessThanOrEqual(1.7);
});

test("a damaged piece's row in place is about 3.3 bytes with its message's header", () => {
  const { h, s, chunk, structs, x0, z0 } = watcher();
  const refs: number[] = [];
  refs.push(...layBase(structs, boxBase(h.reg, "wood", x0 + 0.5, 300, z0 + 0.5, 21, 1, 20000), 7, (kind) => h.reg.maxHp[kind]!));
  h.run(3000);
  const seen = tap(h, s, chunk);
  const t = structs.chunks[chunk]!;
  const rng = new Rng(79);
  // The siege of the bench: 50 pieces of the 20,000 a tick, each blow a stage of the piece's health.
  for (let tick = 0; tick < 200; tick++) {
    for (let k = 0; k < 50; k++) {
      const ref = refs[rng.int(refs.length)]!;
      structs.damage(ref, h.reg.maxHp[t.kind[ref & 0xffff]!]! / 200);
    }
    h.run(1000 / 30);
  }
  h.run(500);
  expect(wrong(h, s)).toEqual([]);
  expect(seen.rows).toBeGreaterThan(9900);
  // 3.34 bytes a row, 3.10 without the 12 bytes that head each tick's message of 50. By their poses' layout it was 3.49.
  expect(seen.bytes / seen.rows).toBeLessThanOrEqual(3.4);
  expect((seen.bytes - seen.messages * 12) / seen.rows).toBeLessThanOrEqual(3.3);
});

test("a lone foundation costs no more than a free row and its frame's number", () => {
  /** The bytes of 200 foundations each at a turn and a height of its own, owned by `owner`, and how many frames they are. */
  const field = (owner: number): number[] => {
    const { h, s, chunk, structs, x0, z0 } = watcher();
    const seen = tap(h, s, chunk);
    const kind = h.reg.index.get("core:foundation_wood")!;
    // Nobody's is set down by its pose. A tribe's begins a base.
    for (let i = 0; i < 200; i++) (owner === 0 ? structs.add(kind, x0 + 4 + (i % 14) * 4, 100 + i * 0.25, z0 + 4 + Math.floor(i / 14) * 4, 1 + i * 7, 0, h.reg.maxHp[kind]!) : start(h.world, kind, x0 + 4 + (i % 14) * 4, 100 + i * 0.25, z0 + 4 + Math.floor(i / 14) * 4, 1 + i * 7, owner, h.reg.maxHp[kind]!));
    h.run(1500);
    expect(wrong(h, s)).toEqual([]);
    expect(s.world!.structs.chunks[chunk]!.live).toBe(200);
    return [seen.bytes, structs.frames.count, seen.defined.length];
  };
  // Nobody's pieces have no frame and go by their poses.
  const [free, none] = field(0);
  const [keyed, frames, defined] = field(7);
  expect([none, frames, defined]).toEqual([0, 200, 200]);
  // 8.7 bytes each by its pose and 11.2 by its key: its frame's origin is its place, and its number and a dozen bits more.
  expect((keyed! - free!) / 200).toBeLessThanOrEqual(3);
});

test("a base over two chunks is one frame on the client, defined once", () => {
  const { h, s, chunk, structs, x0, z0 } = watcher({ latencyMs: 30, jitterMs: 20, loss: 0.03 });
  const seen = tap(h, s);
  // 63 m wide from the middle of the chunk: half its pieces are in the chunk to the east.
  layBase(structs, boxBase(h.reg, "wood", x0 + 32.5, 200, z0 + 0.5, 21, 1, 3000), 7, (kind) => h.reg.maxHp[kind]!);
  h.run(3000);
  const f = [...structs.frames.all()][0]!;
  expect([structs.frames.count, [...f.chunks].sort((a, b) => a - b), f.live]).toEqual([1, [chunk, chunk + 1], 3000]);
  expect(wrong(h, s)).toEqual([]);
  const mine = s.world!.structs.frames.get(f.gid)!;
  expect([s.world!.structs.frames.count, mine.live, [mine.ox, mine.oy, mine.oz, mine.yaw, mine.team], seen.defined]).toEqual([1, 3000, [f.ox, f.oy, f.oz, f.yaw, 7], [f.gid]]);
});

test("a frame gone with its last row here is made again when a row names it, with no second definition", () => {
  const { h, s, chunk, structs, x0, z0 } = watcher();
  const seen = tap(h, s);
  const kind = h.reg.index.get("core:foundation_wood")!;
  const layer = h.reg.forms.layer[kind]!;
  const near = start(h.world, kind, x0 + 10, 100, z0 + 10, 0, 7, 100);
  const gid = structs.frameAt(near);
  // The same base 300 m west, far past what the survivor is sent.
  const far = structs.place(kind, gid, key0(CLS_SQUARE, -200, 0, 0), key1(0, 0, 0, layer, 0, 0), 7, 100);
  expect(Math.floor(far / 65536)).toBe(chunk - 5);
  h.run(500);
  const held = s.world!.structs;
  expect([wrong(h, s), held.frames.count, seen.defined]).toEqual([[], 1, [gid]]);
  structs.remove(near);
  h.run(500);
  expect([wrong(h, s), held.frames.count, structs.frames.get(gid)!.live]).toEqual([[], 0, 1]);
  const again = structs.place(kind, gid, key0(CLS_SQUARE, 2, 0, 0), key1(0, 0, 0, layer, 0, 0), 7, 100);
  h.run(500);
  expect([wrong(h, s), held.frameAt(again), held.frames.get(gid)!.live, seen.defined]).toEqual([[], gid, 1, [gid]]);
});

test("past 1,024 definitions both ends forget them all, and a frame named again is defined again", () => {
  const { h, s, chunk, structs, x0, z0 } = watcher();
  const seen = tap(h, s);
  const kind = h.reg.index.get("core:foundation_wood")!;
  const layer = h.reg.forms.layer[kind]!;
  const refs: number[] = [];
  for (let i = 0; i < FRAMES_TOLD + 6; i++) refs.push(start(h.world, kind, x0 + 4 + (i % 14) * 4, 100 + i * 0.25, z0 + 4 + (Math.floor(i / 14) % 14) * 4, 1 + i * 7, 7, 100));
  h.run(2000);
  const told = h.client(s)!.framesTold;
  const kept = (s as unknown as { framesTold: { size: number } }).framesTold;
  expect([wrong(h, s), structs.frames.count, seen.defined.length, told.size, kept.size]).toEqual([[], FRAMES_TOLD + 6, FRAMES_TOLD + 6, 6, 6]);
  // The first frame's definition was among those forgotten: a second piece of it brings it again.
  const first = structs.frameAt(refs[0]!);
  expect(told.has(first)).toBe(false);
  const beside = structs.place(kind, first, key0(CLS_SQUARE, 2, 0, 0), key1(0, 0, 0, layer, 0, 0), 7, 100);
  h.run(500);
  expect([wrong(h, s), s.world!.structs.frameAt(beside), seen.defined.filter((gid) => gid === first).length, told.size, kept.size]).toEqual([[], first, 2, 7, 7]);
  expect(Math.floor(beside / 65536)).toBe(chunk);
});

test("a kept chunk comes back with its keys and its frame, though no row defines it", () => {
  const { h, s, chunk, structs, x0, z0, go } = watcher();
  layBase(structs, boxBase(h.reg, "wood", x0 + 0.5, 100, z0 + 0.5, 21, 1, 5000), 7, (kind) => h.reg.maxHp[kind]!);
  h.run(2000);
  const held = s.world!.structs;
  const gid = structs.frameAt(chunk * 65536);
  expect([wrong(h, s), held.frames.get(gid)!.live]).toEqual([[], 5000]);
  go(chunk - 5);
  h.run(2000);
  // Kept aside, its rows are in no frame and no cell, and the frame has gone with them.
  expect([held.chunks[chunk], held.frames.count, held.occupied.size]).toEqual([null, 0, 0]);
  // The server forgets it told the frame, as it does past 1,024 of them. Nothing of the base is sent on the way back.
  h.client(s)!.framesTold.clear();
  const seen = tap(h, s, chunk);
  go(chunk - 4);
  h.run(1000);
  go(chunk);
  h.run(1000);
  expect([wrong(h, s), held.frames.get(gid)!.live, seen.rows, seen.defined]).toEqual([[], 5000, 0, []]);
  // A piece set down in it then names the frame, and its definition, sent again, changes nothing.
  const kind = structs.chunks[chunk]!.kind[0]!;
  expect(structs.place(kind, gid, key0(CLS_SQUARE, 0, 0, 0), key1(0, 60, 0, h.reg.forms.layer[kind]!, 0, 0), 7, 100)).toBeGreaterThanOrEqual(0);
  h.run(500);
  expect([wrong(h, s), held.frames.get(gid)!.live, seen.rows, seen.defined]).toEqual([[], 5001, 1, [gid]]);
});

test("pieces 30 and 60 degrees round in their base reach a client turned so, in the grid cells they cover", () => {
  const { h, s, chunk, structs, x0, z0, go } = watcher({}, 1, turnedRegistry());
  const w = { dims: h.world.dims, hf: h.world.hf, structs, reg: h.reg, kind: (id: string) => h.reg.index.get(id)! } as TestWorld;
  // A triangle with a square on each side, walled and roofed, and a dodecagon of foundations, in bases at turns of their own.
  const house = mixedHouse(new Base(w, x0 + 20, z0 + 20, 5000));
  const round = dodecagon(new Base(w, x0 + 44, z0 + 40, 61234), 1);
  h.run(1000);
  const held = s.world!.structs;
  const classes = (of: StructureStore): number[] => [...house.refs, ...round.refs].map((ref) => of.chunks[Math.floor(ref / 65536)]!.twAt(ref & 0xffff));
  expect([0, 1, 2].map((tw) => classes(structs).filter((c) => c === tw).length > 4)).toEqual([true, true, true]);
  expect([wrong(h, s), classes(held)]).toEqual([[], classes(structs)]);
  for (const [x, z] of [[x0 + 20, z0 + 20], [x0 + 44, z0 + 40]] as const) expect(listed(held, x, z)).toEqual(listed(structs, x, z));
  // Kept aside and put back, each is turned as it was and listed in the same cells.
  go(chunk - 5);
  h.run(2000);
  expect(held.chunks[chunk]).toBeNull();
  go(chunk - 4);
  h.run(1000);
  go(chunk);
  h.run(1000);
  expect([wrong(h, s), classes(held)]).toEqual([[], classes(structs)]);
  for (const [x, z] of [[x0 + 20, z0 + 20], [x0 + 44, z0 + 40]] as const) expect(listed(held, x, z)).toEqual(listed(structs, x, z));
  // A turned wall taken up and a turned square harmed come as any row does.
  const wall = house.walls.find(([ref]) => structs.chunks[chunk]!.twAt(ref & 0xffff) !== 0)![0];
  structs.remove(wall);
  structs.damage(round.refs[1]!, 30);
  h.run(500);
  expect(wrong(h, s)).toEqual([]);
  expect(listed(held, x0 + 20, z0 + 20)).toEqual(listed(structs, x0 + 20, z0 + 20));
});

test("clients hold the server's rows, keys and frames through building, breaking and leaving, on bad lines", () => {
  const h = new Harness({}, 5, 30, { map: MAP });
  const links: LinkOptions[] = [{}, { tcp: true, latencyMs: 60, jitterMs: 30, loss: 0.03 }, { latencyMs: 40, jitterMs: 40, loss: 0.05, burstMs: 60 }];
  const sessions = links.map((link, i) => h.join(["ada", "bob", "cleo"][i]!, link));
  h.run(1500);
  const structs = h.world.structs;
  const reg = h.reg;
  const rng = new Rng(2026);
  const [cx, cz] = [3, 6];
  const home = cz * 12 + cx;
  const [x0, z0] = [cx * CHUNK_SIZE, cz * CHUNK_SIZE];
  // A base of team 7 across the border to the east, one of team 8 beside it, and things with no key.
  const plans = [boxBase(reg, "wood", x0 + 47.5, 120, z0 + 0.5, 10, 1, 1500), boxBase(reg, "stone", x0 + 2, 140, z0 + 40, 5, 2, 400)];
  const next = [0, 0];
  const owners = [7, 8];
  const live: number[] = [];
  const foundation = reg.index.get("core:foundation_wood")!;
  const [door, open] = [reg.index.get("core:door_wood")!, reg.index.get("core:door_open_wood")!];
  const crate = reg.index.get("core:crate")!;
  const pick = (): number => live[rng.int(live.length)] ?? -1;
  const drop = (ref: number): void => void live.splice(live.indexOf(ref), 1);
  const told = structs.onRemove;
  structs.onRemove = (ref, cause) => {
    drop(ref);
    told?.(ref, cause);
  };
  const laid = new Map<string, number>();
  const build = (b: number, n: number): void => {
    for (; n > 0 && next[b]! < plans[b]!.length; n--) {
      const piece = plans[b]![next[b]!++]!;
      // In its slot of its base, whose frame is made again if every piece of it has gone.
      const [ref] = layPieces(structs, reg, [piece], owners[b]!, reg.maxHp[piece[0]]!, laid) as [number];
      if (ref >= 0) live.push(ref);
    }
  };
  build(0, 300);
  build(1, 100);
  const kindOf = (ref: number): number => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  let [moved, checks, retaken, swapped, lone] = [0, 0, 0, 0, 0];
  for (let round = 0; round < 60; round++) {
    for (let op = rng.int(12); op > 0; op--) {
      const ref = pick();
      const what = rng.int(10);
      if (what < 3) build(rng.int(2), 1 + rng.int(40));
      else if (ref < 0) continue;
      else if (what === 3) structs.remove(ref);
      else if (what === 4) structs.damage(ref, reg.maxHp[kindOf(ref)]! * rng.range(0.05, 0.6));
      else if (what === 5) {
        // Taken up and set down again by its key, in whatever slot is free.
        const kind = kindOf(ref);
        if (!structs.keyAt(ref, key)) continue;
        const owner = structs.frames.get(key.fr)!.team;
        structs.remove(ref);
        const again = structs.frames.get(key.fr) ? structs.place(kind, key.fr, key.k0, key.k1, owner, reg.maxHp[kind]!) : -1;
        if (again >= 0) retaken += live.push(again) > 0 ? 1 : 0;
      } else if (what === 6) {
        const at = live.find((r) => kindOf(r) === door || kindOf(r) === open);
        if (at !== undefined && structs.swap(at, kindOf(at) === door ? open : door)) swapped++;
      } else if (what === 7) {
        // A foundation of nobody's base, at a turn of its own: a frame that comes and goes.
        const at = start(h.world, foundation, x0 + rng.range(2, 120), 100 + rng.range(0, 8), z0 + rng.range(2, 60), 1 + rng.int(65000), 7, reg.maxHp[foundation]!);
        if (at >= 0) lone += live.push(at) > 0 ? 1 : 0;
      } else if (what === 8) live.push(structs.add(crate, x0 + rng.range(2, 120), 100, z0 + rng.range(2, 60), rng.int(65536), rng.int(2) * 7, reg.maxHp[crate]!));
      else if (round === 30) structs.reown(8, 9);
    }
    // Each survivor is at the base, beside it, or far enough off that its chunks are dropped and kept.
    for (const s of sessions) {
      if (rng.int(3) !== 0) continue;
      const away = [0, 0, 1, 2, 5, 6][rng.int(6)]!;
      h.world.ents.setPosition(h.ent(s), (cx + away + 0.5) * CHUNK_SIZE, 0, (cz + 0.5) * CHUNK_SIZE);
      moved++;
    }
    h.run(100 + rng.int(900));
    if (round % 6 !== 5) continue;
    h.run(6000);
    for (const s of sessions) {
      expect(wrong(h, s)).toEqual([]);
      if (wholeOf(h, s).includes(home)) checks++;
    }
  }
  const spans = [...structs.frames.all()].some((f) => f.chunks.length > 1);
  expect([moved > 30, checks > 5, retaken > 3, swapped > 0, lone > 3, structs.frames.count > 2, spans]).toEqual([true, true, true, true, true, true, true]);
});

test("the worst row is within the bound the message's guard leaves for one", () => {
  const reg = coreRegistry();
  const structs = new StructureStore({ chunksX: 16, chunksZ: 16 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const kind = reg.index.get("core:foundation_wood")!;
  const owner = 0xfffffff0;
  // A row far along its frame's lattice, low and turned, in a frame of the highest number.
  const f = structs.frames.make(40 * STRUCT_UNITS, 300 * STRUCT_UNITS, 40 * STRUCT_UNITS, 0, owner, 0xfffffff0);
  const ref = structs.place(kind, f.gid, key0(CLS_SQUARE, 300, 0, 0), key1(300, -200, 0, reg.forms.layer[kind]!, 3, 0), owner, 1);
  expect(ref).toBeGreaterThanOrEqual(0);
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  // Its frame is then made the worst a definition can say: off the map, deep, turned, and another team's.
  [f.ox, f.oy, f.oz, f.yaw, f.team] = [5 - 2 ** 31, -(2 ** 30), 2 ** 31 - 5, 54321, 0xffffff00];
  // The row is told from the table's last slot, the widest gap there is.
  const last = 0xfffe;
  t.ensure(last);
  for (const col of [t.kind, t.x, t.y, t.z, t.yaw, t.owner, t.hp, t.fr!, t.k0!, t.k1!]) col[last] = col[ref & 0xffff]!;
  t.high = last + 1;
  const w = new BitWriter(256);
  const coder = new RowCoder(reg.forms, reg.maxHp, { exact: true });
  coder.begin(0, 0, -1, new Set());
  coder.write(w, t, last, false, false, structs.frames);
  expect([coder.defined, w.overflow, w.pos]).toEqual([[f.gid], false, ROW_BITS_MOST]);
  // It reads back as it was written.
  const r = new BitReader(w.bytes());
  const back = new RowCoder(reg.forms, reg.maxHp, { exact: true });
  back.begin(0, 0);
  back.read(r);
  expect([back.slot, back.form, back.kind, back.fr, back.k0, back.k1, back.owner, back.health(100), r.overflow]).toEqual([last, ROW_KEYED, kind, f.gid, t.k0![last]!, t.k1![last]!, owner, 1, false]);
  expect(back.def).toEqual({ gid: f.gid, ox: f.ox, oy: f.oy, oz: f.oz, yaw: 54321, team: 0xffffff00 });
  // A free row's worst is well inside it.
  const free = structs.add(reg.index.get("core:crate")!, 1000.5, 4000, 1000.25, 65535, 0xfffffff1, 0.5);
  const u = structs.chunks[Math.floor(free / 65536)]!;
  w.reset();
  coder.begin(960, 960, -1, new Set());
  coder.write(w, u, free & 0xffff, false, false, structs.frames);
  r.reset(w.bytes());
  back.begin(960, 960);
  back.read(r);
  expect([back.form, back.x, back.y, back.z, back.yaw, back.owner, back.health(100), w.pos <= 201]).toEqual([ROW_FREE, 1000.5, 4000, 1000.25, 65535, 0xfffffff1, 0.5, true]);
});
