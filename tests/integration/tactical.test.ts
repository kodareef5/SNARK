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
import { MARK_MATE, MARK_OTHER, MARK_TAME, PLAYERS_ALL, PLAYERS_OFF, PLAYERS_VIEW } from "../../shared/world/tactical.ts";
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

test("a mate two kilometres off and its tame are marked, a stranger is not unless the rule says so, and a still tribe costs almost nothing", () => {
  const { h, world, join, put } = wide();
  const [a, b, c] = [join("ada"), join("bo"), join("cy")];
  h.run(500);
  const records = h.host.records;
  const rec = (s: ClientSession) => records.byPid.get(h.client(s)!.pid)!;
  expect(h.host.tribes.create(rec(a), "Night Shift")).toBe("");
  expect(h.host.tribes.invite(rec(a), rec(b), true)).toBe("");
  expect(h.host.tribes.accept(rec(b))).toBe("");
  put(b, 2150, 100);
  put(c, 130, 130);
  h.run(2000);
  const marks = a.tactical.marks;
  const seen = (m = marks) => Array.from({ length: m.count }, (_, i) => ({ kind: m.kind[i]!, x: Math.round(m.x[i]!), z: Math.round(m.z[i]!), self: i === m.self }));
  expect(seen()).toEqual([{ kind: MARK_MATE, x: Math.round(a.own.x), z: Math.round(a.own.z), self: true }, { kind: MARK_MATE, x: 2150, z: 100, self: false }]);
  expect(marks.players).toBe(PLAYERS_OFF);
  // The stranger is sent itself and nobody else.
  expect(seen(c.tactical.marks)).toEqual([{ kind: MARK_MATE, x: 130, z: 130, self: true }]);

  // A creature the far mate tames is on both their maps at the next listing, ten seconds apart at most.
  const e = h.host.spawnCreature("core:dummy", 2140, 110, 1);
  expect(h.host.taming.give(records.byPid.get(world.ents.pid[e]!)!, rec(b), 0, "forced")).toBe(true);
  h.run(11000);
  expect(seen()[2]).toEqual({ kind: MARK_TAME, x: 2140, z: 110, self: false });
  expect(seen().length).toBe(3);
  expect(seen(c.tactical.marks).length).toBe(1);

  // Nobody moves: each list is sent again only every five seconds, 17 bytes for three marks.
  const stats = h.host.tactical.stats;
  const [sent, bytes] = [stats.marks, stats.markBytes];
  h.run(10000);
  expect(stats.marks - sent).toBeLessThanOrEqual(6);
  expect(stats.markBytes - bytes).toBeLessThanOrEqual(2 * (17 + 17 + 8));

  // With the rule at "all" strangers are marked wherever they are, and the client is told which rule holds.
  h.host.tactical.opts.players = "all";
  h.run(1500);
  expect(marks.players).toBe(PLAYERS_ALL);
  expect(seen().filter((m) => m.kind === MARK_OTHER)).toEqual([{ kind: MARK_OTHER, x: 130, z: 130, self: false }]);
  expect(seen(c.tactical.marks).filter((m) => m.kind === MARK_OTHER).length).toBe(2);
  h.host.tactical.opts.players = "view";
  h.run(1500);
  expect(marks.players).toBe(PLAYERS_VIEW);
  expect(seen().some((m) => m.kind === MARK_OTHER)).toBe(false);
});

test("a tribe with more marks than a message holds sends each member the 255 nearest to it", () => {
  const { h, world, join, teamOf, put } = wide();
  const [a, b] = [join("ada"), join("bo")];
  h.run(500);
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.tribes.create(rec(a), "Herders");
  h.host.tribes.invite(rec(a), rec(b), true);
  h.host.tribes.accept(rec(b));
  put(b, 2150, 100);
  // 200 creatures stand around each of them.
  for (const s of [a, b]) {
    const at = world.ents.x[h.ent(s)]!;
    for (let i = 0; i < 200; i++) world.ents.setTeam(h.host.spawnCreature("core:dummy", at - 40 + (i % 20) * 4, 140 + Math.floor(i / 20) * 4, 1), teamOf(a));
  }
  h.run(1500);
  for (const s of [a, b]) {
    const m = s.tactical.marks;
    expect(m.count).toBe(255);
    expect(m.self).toBe(255);
    let near = 0;
    for (let i = 0; i < m.count; i++) if (Math.abs(m.x[i]! - s.own.x) < 100) near++;
    expect(near).toBe(200);
  }
});
