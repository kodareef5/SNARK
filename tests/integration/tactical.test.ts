// The map's two feeds, between a real server and real clients on a map 2.3 km wide.

import { expect, test } from "bun:test";
import { ClientSession } from "../../client/core/session.ts";
import { contentFor } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld } from "../../server/world.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { chunkAt } from "../../shared/coords.ts";
import { CMD_MAP_ZOOM } from "../../shared/net/protocol.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const DIMS = { chunksX: 36, chunksZ: 8 };

/** A flat map 2,304 m by 512 m with nothing on it, and a way to join it. */
function wide(tactical: { tacticalRadius?: number } = {}) {
  const reg = contentFor(coreRegistry(), new Rules());
  const hf = new Heightfield(DIMS, TERRAIN_CELL, -32, 1 / 256);
  hf.heights.fill(32 * 256);
  const world = createWorld(reg, DIMS, hf, "test:wide", 7, { x: 100, z: 100, yaw: 0 }, 1024);
  const h = new Harness({}, 1, 60, { world, tactical }, reg);
  const join = (name: string): ClientSession => {
    const end = h.net.connect();
    const s = new ClientSession(end, { name, key: testKey(name), registry: reg, clipHash: world.anim.set.hash, look: defaultLook(), resolveMap: () => hf });
    h.sessions.push(s);
    h.ends.push(end);
    h.pilots.push({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 });
    return s;
  };
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  /** A hut two foundations square with a wall, its corner at (x, z). */
  const hut = (x: number, z: number, team: number): number[] => {
    const refs: number[] = [];
    for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) refs.push(world.structs.add(k("foundation_wood"), x + dx, 0.19, z + dz, 0, team, 100));
    refs.push(world.structs.add(k("wall_stone"), x + 1.5, 1.88, z + 3, 0, team, 100));
    return refs;
  };
  const teamOf = (s: ClientSession): number => h.host.records.byPid.get(h.client(s)!.pid)!.team;
  const put = (s: ClientSession, x: number, z: number): void => void world.ents.setPosition(h.ent(s), x, 0, z);
  return { h, world, join, hut, k, teamOf, put };
}

test("a tribe's base 600 m off is on its map within ten seconds with no chunk sent, and is never sent again unchanged", () => {
  const { h, world, join, hut, k, teamOf } = wide();
  const a = join("ada");
  h.run(500);
  const team = teamOf(a);
  const refs = hut(704, 96, team);
  // A stranger's hut one chunk further on.
  hut(770, 96, 999);
  h.run(10000);
  const t = a.tactical;
  expect(t.cellAt(706, 98)).not.toBe(0);
  expect(t.teamAt(706, 98)).toBe(team);
  expect(t.cellAt(690, 98)).toBe(0);
  expect(t.cellAt(772, 98)).toBe(0);
  // No piece of it came: the client has no table for that chunk, and one message carried all it knows.
  expect(a.world!.structs.chunks[chunkAt(DIMS, 706, 98)]).toBeNull();
  const stats = h.host.tactical.stats;
  expect(stats.cells).toBe(1);
  // At the far zoom, which is where a client starts, that is 32 m cells in a handful of bytes.
  expect(t.chunks.get(chunkAt(DIMS, 706, 98))!.level).toBe(3);
  expect(stats.cellBytes).toBeLessThanOrEqual(10);

  // Blows that change no cell bake the chunk again, at most once in five seconds, and send nothing.
  const bakes = stats.bakes;
  for (let s = 0; s < 12; s++) {
    world.structs.damage(refs[0]!, 1);
    h.run(1000);
  }
  expect(stats.bakes - bakes).toBeGreaterThanOrEqual(2);
  expect(stats.bakes - bakes).toBeLessThanOrEqual(3);
  expect(stats.cells).toBe(1);

  // A tower beside it changes a cell, and that is sent once.
  expect(t.cellAt(750, 70)).toBe(0);
  world.structs.add(k("pillar"), 750, 3, 70, 0, team, 100);
  h.run(8000);
  expect(t.cellAt(750, 70)).not.toBe(0);
  expect(stats.cells).toBe(2);
  // And when the hut is taken down its cell empties.
  for (const ref of refs) world.structs.remove(ref);
  h.run(8000);
  expect(t.cellAt(706, 98)).toBe(0);
  expect(t.cellAt(750, 70)).not.toBe(0);
});

test("another tribe's base shows once a survivor has been within the radius, stays as it was seen, and with a radius of 0 never shows", () => {
  const { h, world, join, hut, k, put } = wide();
  const a = join("ada");
  h.run(500);
  hut(770, 96, 999);
  hut(104, 104, 999);
  h.run(3000);
  const t = a.tactical;
  // The hut beside it shows at once: it is within 512 m. The one 670 m off does not.
  expect(t.teamAt(106, 106)).toBe(999);
  expect(t.cellAt(772, 98)).toBe(0);
  put(a, 400, 100);
  h.run(3000);
  expect(t.teamAt(772, 98)).toBe(999);
  // Back out of range it stays on the map, as it was when last near.
  put(a, 100, 100);
  h.run(1000);
  world.structs.add(k("pillar"), 810, 3, 70, 0, 999, 100);
  h.run(8000);
  expect(t.teamAt(772, 98)).toBe(999);
  expect(t.cellAt(810, 70)).toBe(0);
  put(a, 400, 100);
  h.run(3000);
  expect(t.cellAt(810, 70)).not.toBe(0);

  // A server with a radius of 0 shows a tribe only what is its own, even where another's stands in the same chunk.
  const own = wide({ tacticalRadius: 0 });
  const b = own.join("bo");
  own.h.run(500);
  b.command(CMD_MAP_ZOOM, (w) => w.bits(3, 2));
  own.hut(104, 104, 999);
  own.hut(112, 104, own.teamOf(b));
  own.h.run(3000);
  expect(b.tactical.teamAt(114, 106)).toBe(own.teamOf(b));
  expect(b.tactical.cellAt(106, 106)).toBe(0);
});

test("cells come at the size that suits the zoom a client shows, nearest first, and never more than a kilobyte a second", () => {
  const { h, join, hut, teamOf } = wide();
  const a = join("ada");
  h.run(500);
  const team = teamOf(a);
  // Sixty chunks of its own in two rows, from beside it to the far end of the map, each with three huts.
  for (let i = 0; i < 60; i++) {
    const x = (1 + (i % 30)) * 64;
    const z = Math.floor(i / 30) * 320;
    for (const [dx, dz] of [[10, 10], [20, 24], [50, 42]] as const) hut(x + dx, z + dz, team);
  }
  const stats = h.host.tactical.stats;
  h.run(4000);
  const far = chunkAt(DIMS, 30 * 64 + 10, 330);
  const near = chunkAt(DIMS, 74, 10);
  expect(a.tactical.chunks.get(far)!.level).toBe(3);
  // The whole map's bases at the far zoom: a few hundred bytes.
  const whole = stats.cellBytes;
  expect(whole).toBeLessThanOrEqual(600);
  expect(a.tactical.chunks.size).toBe(stats.cells);

  // Zoomed all the way in, the same chunks come again as 4 m cells, the nearest first, a kilobyte a second at most.
  a.command(CMD_MAP_ZOOM, (w) => w.bits(3, 2));
  let before = stats.cellBytes;
  let seconds = 0;
  let nearAt = -1;
  let farAt = -1;
  for (; seconds < 20 && farAt < 0; seconds++) {
    h.run(1000);
    expect(stats.cellBytes - before).toBeLessThanOrEqual(1024);
    before = stats.cellBytes;
    if (nearAt < 0 && a.tactical.chunks.get(near)!.level === 0) nearAt = seconds;
    if (a.tactical.chunks.get(far)!.level === 0) farAt = seconds;
  }
  expect(nearAt).toBeLessThanOrEqual(1);
  expect(farAt).toBeGreaterThan(nearAt);
  expect(stats.cellBytes - whole).toBeGreaterThan(1500);
  // Zooming out again asks for nothing: finer cells than it needs are kept.
  const sent = stats.cells;
  a.command(CMD_MAP_ZOOM, (w) => w.bits(0, 2));
  h.run(3000);
  expect(stats.cells).toBe(sent);
  expect(a.tactical.chunks.get(far)!.level).toBe(0);
});
