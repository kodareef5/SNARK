// The far feed between a real server and real clients on a map 8 km wide: every tribe's bases within reach, as far cells
// with no owner, kept apart from the map.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { chunkAt } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { CMD_FAR, CMD_MAP_ZOOM, CMD_VIEW, S_FAR } from "../../shared/net/protocol.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { FarCells, farTopMetres, readFar } from "../../shared/world/tactical.ts";
import { farJoin } from "../../tools/bench/far.ts";
import { Harness } from "../fixtures/net.ts";

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
/** A flat map 8,192 m by 256 m with nothing on it, its ground at 0. */
const WIDE = writeMap({ id: "test:wide", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: [], nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

function wide() {
  const h = new Harness({}, 1, 60, { map: WIDE });
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
  /** Every S_FAR message `s` is sent from here on. */
  const tap = (s: ClientSession): Uint8Array[] => {
    const got: Uint8Array[] = [];
    const end = h.ends[h.sessions.indexOf(s)]!;
    const read = end.onMessage!;
    end.onMessage = (channel, data) => {
      if (data[0] === S_FAR) got.push(data.slice());
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
  expect([h.server.allows!(h.client(a)!, CMD_FAR), h.server.allows!(h.client(a)!, CMD_MAP_ZOOM)]).toEqual([true, false]);
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
