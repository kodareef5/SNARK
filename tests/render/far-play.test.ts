// The far feed between a real server and real clients on a map 8 km wide: every tribe's bases within reach, as far cells
// with no owner, kept apart from the map.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { Scene } from "../../client/core/render/scene.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { chunkAt } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { CMD_FAR, CMD_MAP_ZOOM, CMD_VIEW, EVENT_COLLAPSE, S_EVENT, S_FAR, S_GONE } from "../../shared/net/protocol.ts";
import { CityStatics, goneByRows } from "../../shared/world/city.ts";
import { GoneList, readGone } from "../../shared/world/gone.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { parseMap, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { GONE_DESTROYED } from "../../shared/world/structures.ts";
import { FarCells, farTopMetres, readFar } from "../../shared/world/tactical.ts";
import { farJoin } from "../../tools/bench/far.ts";
import { farPack } from "../fixtures/farworld.ts";
import { Harness } from "../fixtures/net.ts";

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
/** A flat map 8,192 m by 256 m with nothing on it, its ground at 0. */
const WIDE = writeMap({ id: "test:wide", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: [], nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

function wide(map = WIDE) {
  const h = new Harness({}, 1, 60, { map });
  const world = h.world;
  const k = (id: string): number => h.reg.index.get(`core:${id}`)!;
  /** A hut two foundations square with a wall and a tower of pillars to 30.3 m, its corner at (x, z). */
  const base = (x: number, z: number, team: number): number[] => {
    const refs: number[] = [];
    for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) refs.push(world.structs.add(k("foundation_wood"), x + dx, 0.19, z + dz, 0, team, 100));
    refs.push(world.structs.add(k("wall_stone"), x + 1.5, 1.88, z + 3, 0, team, 100));
    for (let i = 0; i < 5; i++) refs.push(world.structs.add(k("pillar"), x + 10, 3.3 + i * 6, z + 2, 0, team, 100));
    return refs;
  };
  /** Every S_FAR message `s` is sent from here on, or every message of another `kind`. */
  const tap = (s: ClientSession, kind = S_FAR): Uint8Array[] => {
    const got: Uint8Array[] = [];
    const end = h.ends[h.sessions.indexOf(s)]!;
    const read = end.onMessage!;
    end.onMessage = (channel, data) => {
      if (data[0] === kind) got.push(data.slice());
      read(channel, data);
    };
    return got;
  };
  /** Runs `ms`, asking for `reach` metres every frame as the app does. With `until`, it stops a step after that holds and returns when it did, or -1. */
  const run = (s: ClientSession, reach: number, ms: number, until = (): boolean => false): number => {
    const from = h.now;
    while (h.now - from < ms) {
      h.run(100, () => s.askFar(reach));
      if (until()) return h.now - from;
    }
    return -1;
  };
  return { h, world, k, base, tap, run };
}

test("a base 1.5 km off arrives within ten seconds of joining with its tower's top to half a metre and no owner, and never reaches a map at radius 0", () => {
  const { h, base, tap, run } = wide();
  // Two tribes' bases alike, one beside the other, 1.5 km from where a survivor joins.
  base(1600, 70, 999);
  base(1600, 134, 1000);
  expect(h.host.setSetting("TacticalRadius", "0")).toBe("");
  const a = h.join("ada");
  const sent = tap(a);
  const tower = chunkAt(DIMS, 1610, 72);
  const arrived = run(a, 2048, 10000, () => a.far.chunks.has(tower));
  expect(arrived).toBeGreaterThan(0);
  expect(arrived).toBeLessThanOrEqual(10000);
  expect(Math.abs(farTopMetres(a.far.cellAt(1610, 72) & 255) - 30.3)).toBeLessThanOrEqual(0.5);
  expect(a.far.cellAt(1602, 71) >> 8).toBe((h.reg.defs[h.reg.index.get("core:foundation_wood")!] as { color: number }).color);
  // The map has neither, though the far store has both.
  expect([a.tactical.cellAt(1610, 72), a.tactical.cellAt(1610, 136), a.tactical.chunks.size]).toEqual([0, 0, 0]);
  expect(a.far.cellAt(1610, 136)).not.toBe(0);
  // Each message is the chunk and its cells and nothing more, and the two tribes' differ only in the chunk.
  expect(sent.length).toBe(2);
  for (const m of sent) {
    const r = new BitReader(m);
    r.u8();
    expect(readFar(r, new FarCells())).toBeGreaterThanOrEqual(0);
    expect(r.remainingBits).toBeLessThan(8);
  }
  expect(sent[0]!.subarray(3)).toEqual(sent[1]!.subarray(3));
  expect(h.host.tactical.stats.farBytes).toBe(sent[0]!.length + sent[1]!.length);
});

test("far cells stop at the reach asked and at FarRadius, leave out boxes, beds and fires, send nothing for blows, and an emptied chunk once", () => {
  const { h, world, k, base, run } = wide();
  const a = h.join("ada");
  const near = base(1000, 70, 999);
  base(1600, 70, 999);
  // A yard beside the spawn: a box, a bed and a campfire, each alone in its cell.
  for (const [id, x] of [["storage_box", 130], ["bed", 138], ["campfire", 146]] as const) world.structs.add(k(id), x, world.reg.halfY[k(id)]!, 130, 0, 0, 100);
  const stats = h.host.tactical.stats;
  const [at900, at1500] = [chunkAt(DIMS, 1010, 72), chunkAt(DIMS, 1610, 72)];
  expect(run(a, 1024, 4000, () => a.far.chunks.has(at900))).toBeGreaterThan(0);
  run(a, 1024, 1100);
  expect(a.far.chunks.has(at1500)).toBe(false);
  expect([a.far.cellAt(130, 130), a.far.cellAt(138, 130), a.far.cellAt(146, 130)]).toEqual([0, 0, 0]);
  expect(a.far.chunks.has(chunkAt(DIMS, 130, 130))).toBe(false);
  expect(a.tactical.cellAt(130, 130)).not.toBe(0);
  expect(run(a, 2048, 2000, () => a.far.chunks.has(at1500))).toBeGreaterThan(0);

  // A blow changes no cell: the chunk is baked again and nothing is sent.
  const [sent, bakes] = [stats.far, stats.bakes];
  world.structs.damage(near[0]!, 1);
  expect(run(a, 2048, 7000, () => stats.bakes > bakes)).toBeGreaterThan(0);
  run(a, 2048, 1100);
  expect(stats.far).toBe(sent);
  // A raid takes the whole base: the chunk is sent once, empty, and dropped.
  for (const ref of near) world.structs.remove(ref);
  expect(run(a, 2048, 8000, () => !a.far.chunks.has(at900))).toBeGreaterThan(0);
  run(a, 2048, 1100);
  expect(stats.far).toBe(sent + 1);

  // A survivor out cold may still say how far it wants them, since its client asks only once.
  h.host.records.byPid.get(h.client(a)!.pid)!.out = true;
  expect([h.server.players.allows.ask(h.client(a)!, CMD_FAR), h.server.players.allows.ask(h.client(a)!, CMD_MAP_ZOOM)]).toEqual([true, false]);
  h.host.records.byPid.get(h.client(a)!.pid)!.out = false;

  // At FarRadius 0 a new base is sent to nobody, and a newcomer is sent nothing at all.
  expect(h.host.setSetting("FarRadius", "0")).toBe("");
  base(1300, 70, 7);
  const b = h.join("bo");
  run(b, 2048, 2500);
  expect(stats.far).toBe(sent + 1);
  expect([a.far.chunks.has(chunkAt(DIMS, 1310, 72)), b.far.chunks.size]).toEqual([false, 0]);
});

test("a view and a reach the server is too busy to take are asked for again a second later, until it takes them", () => {
  const { h, base } = wide();
  base(1600, 70, 999);
  const a = h.join("ada");
  h.run(1000);
  const sent = new Map<number, number>();
  const command = a.command.bind(a);
  a.command = (op, args) => {
    const seq = command(op, args);
    if (seq !== 0) sent.set(op, (sent.get(op) ?? 0) + 1);
    return seq;
  };
  const ask = (): void => {
    a.view(32, 1100);
    a.askFar(2048);
  };
  // For four seconds a burst of commands each frame keeps the server's queue full, so it refuses both every time.
  h.run(4000, () => {
    for (let i = 0; i < 20; i++) a.command(CMD_MAP_ZOOM, (w) => w.bits(0, 2));
    ask();
  });
  const c = h.client(a)!;
  expect([c.viewCap, a.far.chunks.size]).toEqual([0, 0]);
  expect([sent.get(CMD_VIEW)!, sent.get(CMD_FAR)!].every((n) => n >= 2 && n <= 5)).toBe(true);
  // Once the burst ends, both are taken with nobody asking for anything new.
  const tower = chunkAt(DIMS, 1610, 72);
  let arrived = -1;
  const from = h.now;
  h.run(6000, (now) => {
    ask();
    if (arrived < 0 && a.far.chunks.has(tower)) arrived = now - from;
  });
  expect(arrived).toBeGreaterThan(0);
  expect([c.viewCap, c.snapshotBytes]).toEqual([32, 1100]);
});

test("on one stream as Linux runs it, 400 base chunks in reach hold a join's near chunks back not at all, and freeze no one", () => {
  // A survivor joins beside a 3,000-piece base, 100 ms there and back, asking for 2 km of far cells and, on a twin server, for none.
  const r = farJoin({ rtt: 100, loss: 0, bases: 400, near: 3000, herd: 0, seconds: 7 });
  expect(r.nearMs[1]).toBeGreaterThan(300);
  expect(r.nearMs[0]).toBeLessThanOrEqual(r.nearMs[1] * 1.05);
  expect(r.frozen).toEqual([0, 0]);
  // The feed was busy meanwhile: most of the base chunks in reach came within the seven seconds, at 8 KB a second.
  expect(r.held).toBeGreaterThan(300);
  expect(r.farBytes).toBeLessThanOrEqual(7 * 8192);
});

test("a session that holds the map is sent lists of pieces gone and no cells; one that does not, cells", () => {
  // A tower of three pillars in each chunk of the map's second row from 64 m to 2.5 km east.
  const towers: MapStatic[] = [];
  for (let cx = 1; cx < 40; cx++) for (let i = 0; i < 3; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
  const city = writeMap({ ...parseMap(WIDE), id: "test:wide-city", statics: towers });
  const { h, world, tap } = wide(city);
  const a = h.join("ada");
  const b = h.join("bob", {}, { statics: false });
  const [sa, sb, ga, gb] = [tap(a), tap(b), tap(a, S_GONE), tap(b, S_GONE)];
  const run = (ms: number): void =>
    h.run(ms, () => {
      a.askFar(2048, 8192);
      b.askFar(2048, 8192);
    });
  const chunkOf = (cx: number): number => DIMS.chunksX + cx;
  const inReach = [...Array(39).keys()].map((i) => i + 1).filter((cx) => Math.hypot(cx * 64 + 32 - 100, 96 - 100) <= 2048);
  run(4000);
  const bytes = (m: Uint8Array[]): number => m.reduce((n, d) => n + d.length, 0);
  // The join costs Ada's far feed nothing. Bob is sent every tower in reach, 33 of them, 9 bytes each.
  expect([sa.length, ga.length, sb.length, inReach.length, bytes(sb)]).toEqual([0, 0, inReach.length, 33, 297]);
  // The top of the tower 1 km off is shot away: Ada is sent its list, six bytes, and no cells. Bob is sent its cells.
  const shot = chunkOf(16);
  world.structs.remove(shot * 65536 + 2);
  run(3000);
  const chunksOf = (m: Uint8Array[]): number[] => m.map((d) => readFar(new BitReader(d.subarray(1)), new FarCells()));
  const listsOf = (m: Uint8Array[]): [number, number[]][] =>
    m.map((d) => {
      const list = new GoneList();
      return [readGone(new BitReader(d.subarray(1)), list), [...list.slots]];
    });
  expect([listsOf(ga), bytes(ga), sa.length, chunksOf(sb.slice(inReach.length))]).toEqual([[[shot, [2]]], 6, 0, [shot]]);
  expect([...a.gone.lists.get(shot)!]).toEqual([2]);
  // The tower beside it is taken down whole: its list is one run. Bob, who holds its cells, is sent it empty.
  const razed = chunkOf(17);
  for (let s = 0; s < 3; s++) world.structs.remove(razed * 65536 + s);
  run(3000);
  expect([listsOf(ga), sa.length, bytes(ga)]).toEqual([[[shot, [2]], [razed, [0, 1, 2]]], 0, 12]);
  expect(chunksOf(sb.slice(inReach.length))).toEqual([shot, razed]);
  // A tower hurt and not felled sends nobody anything: no list, and no cells, since none changed.
  const hurt = chunkOf(18);
  expect(world.structs.damage(hurt * 65536 + 1, 10)).toBeGreaterThan(0);
  expect(world.structs.asPlaced(hurt)).toBe(false);
  run(8000);
  expect([ga.length, sa.length, sb.length - inReach.length]).toEqual([2, 0, 2]);
  // The top shot away is set back as the map has it. Ada, who holds it gone, is sent an empty list and holds it standing.
  const t = world.structs.chunks[shot]!;
  const pillar = world.structs.mapKind(shot, 2);
  world.structs.putMapped(shot, 2, pillar, 0, h.reg.maxHp[pillar]!, t.version + 1);
  world.structs.setVersion(shot, t.version + 1);
  expect(world.structs.asPlaced(shot)).toBe(true);
  run(8000);
  expect([listsOf(ga).slice(2), ga[2]!.length, sa.length, gb.length]).toEqual([[[shot, []]], 6, 0, 0]);
  expect(a.gone.lists.get(shot)!.length).toBe(0);
  expect(chunksOf(sb.slice(inReach.length))).toEqual([shot, razed, shot]);
});

test("the lists reach as far as GoneRadius and what the session asks, past the far cells' reach", () => {
  const towers: MapStatic[] = [];
  for (const cx of [20, 50, 100]) for (let i = 0; i < 3; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
  const { h, world, tap } = wide(writeMap({ ...parseMap(WIDE), id: "test:wide-three", statics: towers }));
  const a = h.join("ada");
  const got = tap(a, S_GONE);
  const chunkOf = (cx: number): number => DIMS.chunksX + cx;
  // Towers 1.2, 3.1 and 6.3 km off each lose their top. Asking for 4 km brings the first two.
  for (const cx of [20, 50, 100]) world.structs.remove(chunkOf(cx) * 65536 + 2);
  h.run(3000, () => a.askFar(2048, 4000));
  expect([...a.gone.lists.keys()].sort((p, q) => p - q)).toEqual([chunkOf(20), chunkOf(50)]);
  // Asking for all of it brings the third, and a server that sends none within 2 km stops there.
  h.run(3000, () => a.askFar(2048, 16000));
  expect(a.gone.lists.has(chunkOf(100))).toBe(true);
  expect(h.host.setSetting("GoneRadius", "2000")).toBe("");
  world.structs.remove(chunkOf(20) * 65536 + 1);
  world.structs.remove(chunkOf(50) * 65536 + 1);
  h.run(3000, () => a.askFar(2048, 16000));
  expect([[...a.gone.lists.get(chunkOf(20))!], [...a.gone.lists.get(chunkOf(50))!], got.length]).toEqual([[1, 2], [2], 4]);
  expect(h.host.tactical.stats.gone).toBe(4);
});

test("a base built among the map's pieces sends a map holder the cells of the base alone", () => {
  const towers: MapStatic[] = [];
  for (let i = 0; i < 5; i++) towers.push({ kind: "core:pillar", x: 16 * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
  const { h, world, k, tap } = wide(writeMap({ ...parseMap(WIDE), id: "test:wide-base", statics: towers }));
  const chunk = DIMS.chunksX + 16;
  const a = h.join("ada");
  const b = h.join("bob", {}, { statics: false });
  const [sa, sb, ga] = [tap(a), tap(b), tap(a, S_GONE)];
  const run = (ms: number): void =>
    h.run(ms, () => {
      a.askFar(2048, 8192);
      b.askFar(2048, 8192);
    });
  // A wall 8 m from the tower, in its chunk.
  world.structs.add(k("wall_stone"), 16 * 64 + 28, 1.88, 96, 0, 7, 100);
  run(7000);
  const top = (s: ClientSession, x: number): number => farTopMetres(s.far.cellAt(x, 96) & 255);
  // Bob's cells hold the tower and the wall. Ada's hold the wall alone, and say that they leave the map's pieces out.
  expect([sa.length, sb.length, a.far.full[chunk], b.far.full[chunk]]).toEqual([1, 2, 0, 1]);
  expect([top(a, 16 * 64 + 20), top(b, 16 * 64 + 20) > 25, top(a, 16 * 64 + 28) > 2, top(b, 16 * 64 + 28) > 2]).toEqual([0, true, true, true]);
  // The tower's top falls: Ada's cells do not change, so she is sent its list alone. Bob's cells do.
  world.structs.remove(chunk * 65536 + 4);
  run(7000);
  expect([sa.length, ga.length, sb.length]).toEqual([1, 1, 3]);
  // The wall is taken down: both are sent the chunk's cells again, Ada's empty.
  world.structs.remove(chunk * 65536 + 5);
  run(7000);
  expect([sa.length, ga.length, sb.length, a.far.chunks.has(chunk), b.far.chunks.has(chunk)]).toEqual([2, 1, 4, false, true]);
});

test("cells sent before the map's statics came are sent again without the map's pieces once they have", () => {
  const towers: MapStatic[] = [];
  for (const cx of [10, 16]) for (let i = 0; i < 5; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 });
  const map = writeMap({ ...parseMap(WIDE), id: "test:wide-late", statics: towers });
  const { h, world, k, tap } = wide(map);
  const [bare, based] = [DIMS.chunksX + 10, DIMS.chunksX + 16];
  world.structs.add(k("wall_stone"), 16 * 64 + 28, 1.88, 96, 0, 7, 100);
  world.structs.remove(bare * 65536 + 4);
  const a = h.join("ada", {}, { statics: false });
  const [sa, ga] = [tap(a), tap(a, S_GONE)];
  const run = (ms: number): void => h.run(ms, () => a.askFar(2048, 8192));
  run(4000);
  // Without the map she holds both chunks' cells whole, and no list.
  expect([sa.length, ga.length, a.far.full[bare], a.far.full[based]]).toEqual([2, 0, 1, 1]);
  a.staticsArrived(parseMap(map).statics);
  run(4000);
  // With it: the list of the tower that lost its top, then each chunk's cells again, one empty and one the wall alone.
  expect([sa.length, ga.length, a.far.full[bare], a.far.full[based], a.far.chunks.has(bare), a.far.chunks.has(based)]).toEqual([4, 1, 0, 0, false, true]);
  expect([...a.gone.lists.get(bare)!]).toEqual([4]);
  expect(farTopMetres(a.far.cellAt(16 * 64 + 20, 96) & 255)).toBe(0);
});

test("the list a far client holds is what a near client's rows give, and its far city leaves those pieces out", () => {
  const towers: MapStatic[] = [];
  for (let i = 0; i < 8; i++) towers.push({ kind: "core:pillar", x: 2 * 64 + 20, y: 3.3 + i * 6, z: 96, yaw: 0 }, { kind: "core:pillar", x: 2 * 64 + 26, y: 3.3 + i * 6, z: 96, yaw: 0 });
  const map = writeMap({ ...parseMap(WIDE), id: "test:wide-near", statics: towers });
  const { h, world } = wide(map);
  const chunk = DIMS.chunksX + 2;
  const a = h.join("ada");
  const b = h.join("bob");
  const run = (ms: number): void =>
    h.run(ms, () => {
      a.askFar(2048, 8192);
      b.askFar(2048, 8192);
    });
  run(500);
  h.client(b)!.admin = true;
  h.say(b, "tp 3100 100");
  run(1500);
  expect([a.world!.far.complete(chunk), b.world!.structs.chunks[chunk]]).toEqual([true, null]);
  // Pieces go low and high over a second, a few a tick.
  const doomed = [1, 4, 5, 6, 11, 14, 15];
  for (const s of doomed) {
    world.structs.remove(chunk * 65536 + s);
    run(150);
  }
  run(2500);
  // Near, the rows say which of the map's pieces are not as they were set down. Far, the list says the same.
  const city = new CityStatics(DIMS, parseMap(map).statics, h.reg);
  const g = new Uint8Array(city.in(chunk));
  expect(goneByRows(city, chunk, a.world!.structs.chunks[chunk]!, g)).toBe(doomed.length);
  const byRows = [...g.keys()].filter((i) => g[i] === 1);
  expect([byRows, [...b.gone.lists.get(chunk)!], [...a.gone.lists.get(chunk)!]]).toEqual([doomed, doomed, doomed]);
  expect([...h.host.tactical.goneOf(chunk).slots]).toEqual(doomed);
  // Bob's scene, 3 km off, draws the far city of the map without them.
  b.staticsArrived(parseMap(map).statics);
  const scene = new Scene(b.world!, h.reg, farPack());
  scene.city!.makeMs = Infinity;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw] = [b.own.x, 40, b.own.z, -Math.PI / 2];
  scene.build(cam, null);
  const far = scene.city!.goneOf(chunk)!;
  expect([...far.keys()].filter((i) => far[i] === 1)).toEqual(doomed);
});

test("a break of more than 16 map pieces in a chunk sends one collapse event, and a smaller one sends none", () => {
  // A block of 60 pillars, 10 to a storey, 1.2 km east, and others like it 1.9 km and 6 km east.
  const towers: MapStatic[] = [];
  for (const cx of [20, 30, 95]) for (let i = 0; i < 60; i++) towers.push({ kind: "core:pillar", x: cx * 64 + 10 + (i % 10) * 4, y: 3.3 + Math.floor(i / 10) * 6, z: 96, yaw: 0 });
  const { h, world, tap } = wide(writeMap({ ...parseMap(WIDE), id: "test:wide-falls", statics: towers }));
  const a = h.join("ada");
  const events = tap(a, S_EVENT);
  const told = (): Uint8Array[] => events.filter((m) => m[1] === EVENT_COLLAPSE);
  const run = (ms: number): void => h.run(ms, () => a.askFar(2048, 4000));
  run(500);
  const [near, mid, far] = [DIMS.chunksX + 20, DIMS.chunksX + 30, DIMS.chunksX + 95];
  const refs = (chunk: number, from: number, n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => chunk * 65536 + from + i);
  // Sixteen pieces at once: no event. Its list goes all the same.
  world.structs.removeMany(refs(near, 44, 16), 16, GONE_DESTROYED, 1300, 30, 96, world.tick);
  run(1500);
  expect([told().length, a.collapses.length, a.gone.lists.get(near)!.length]).toEqual([0, 0, 16]);
  // Thirty pieces under them in one blast, over four storeys: one event of 14 bytes, with where they stood and how large.
  world.structs.removeMany(refs(near, 14, 30), 30, GONE_DESTROYED, 1300, 12, 96, world.tick);
  run(200);
  expect([told().length, told()[0]!.length, a.collapses.length]).toEqual([1, 14, 1]);
  const fell = a.collapses[0]!;
  expect([fell.x, fell.z, fell.across, fell.tall]).toEqual([20 * 64 + 28, 96, 36, 24]);
  expect(Math.abs(fell.foot - 6.3)).toBeLessThanOrEqual(0.5);
  // Seventeen taken one after another in one tick by one blast are one break. The same number over two ticks are not.
  for (let s = 0; s < 17; s++) world.structs.damage(mid * 65536 + s, 1e9, world.tick);
  run(100);
  expect(told().length).toBe(2);
  for (let s = 20; s < 29; s++) world.structs.damage(mid * 65536 + s, 1e9, world.tick);
  run(100);
  for (let s = 30; s < 38; s++) world.structs.damage(mid * 65536 + s, 1e9, world.tick);
  run(100);
  expect(told().length).toBe(2);
  // A collapse past what she asked the lists for, 6 km off, is not told.
  world.structs.removeMany(refs(far, 20, 40), 40, GONE_DESTROYED, 6100, 20, 96, world.tick);
  run(300);
  expect([told().length, a.collapses.length, h.host.tactical.stats.collapses]).toEqual([2, 2, 2]);
});
