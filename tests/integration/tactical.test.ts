// The map's two feeds and what a client makes of them, between a real server and real clients on a map 8 km wide.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { HudModel, updateHud } from "../../client/core/hud.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { Chart, type MapPicture } from "../../client/core/tactical.ts";
import { IMAGE_MAP, IMAGE_MINIMAP, KEY_MARKER, KEY_MINIMAP, buildHud } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { KEY_MAP_IMAGE, KEY_MAP_LINE, KEY_MAP_PIN, KEY_MAP_TITLE, KEY_MAP_ZOOM, buildMap, mapPointer } from "../../client/core/ui/screens.ts";
import { chunkAt } from "../../shared/coords.ts";
import { CMD_MAP_ZOOM } from "../../shared/net/protocol.ts";
import { latLonText, lonOf, mapU, mapV, xOfU } from "../../shared/world/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { MARK_MATE, MARK_OTHER, MARK_TAME, PLAYERS_ALL, PLAYERS_OFF, PLAYERS_VIEW } from "../../shared/world/tactical.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const DIMS = { chunksX: 128, chunksZ: 4 };
const SAMPLES = ((DIMS.chunksX * 64) / TERRAIN_CELL + 1) * ((DIMS.chunksZ * 64) / TERRAIN_CELL + 1);
/** A flat map 8,192 m by 256 m with nothing on it. */
const WIDE = writeMap({ id: "test:wide", dims: DIMS, minY: -32, stepY: 1 / 256, seaLevel: -Infinity, heights: new Uint16Array(SAMPLES).fill(32 * 256), tint: new Uint8Array(SAMPLES).fill(1), statics: [], nodes: [], spawns: [{ name: "West", x: 100, z: 100, yaw: 0 }] });

/** A server on that map, and what the tests do to it. */
function wide() {
  const h = new Harness({}, 1, 60, { map: WIDE });
  const world = h.world;
  const hf = world.hf;
  const join = (name: string): ClientSession => h.join(name);
  const k = (id: string): number => h.reg.index.get(`core:${id}`)!;
  /** A hut two foundations square with a wall, its corner at (x, z). */
  const hut = (x: number, z: number, team: number): number[] => {
    const refs: number[] = [];
    for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) refs.push(world.structs.add(k("foundation_wood"), x + dx, 0.19, z + dz, 0, team, 100));
    refs.push(world.structs.add(k("wall_stone"), x + 1.5, 1.88, z + 3, 0, team, 100));
    return refs;
  };
  const teamOf = (s: ClientSession): number => h.host.records.byPid.get(h.client(s)!.pid)!.team;
  const put = (s: ClientSession, x: number, z: number): void => void world.ents.setPosition(h.ent(s), x, 0, z);
  return { h, world, hf, join, hut, k, teamOf, put };
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
  const { h, world, join, hut, k, teamOf, put } = wide();
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

  // The operator turns the radius to 0. A newcomer is then shown only what is its own tribe's, even where another's stands in the same chunk.
  expect(h.host.setSetting("TacticalRadius", "0")).toBe("");
  const b = join("bo");
  h.run(500);
  b.command(CMD_MAP_ZOOM, (w) => w.bits(3, 2));
  hut(112, 104, teamOf(b));
  h.run(3000);
  expect(b.tactical.teamAt(114, 106)).toBe(teamOf(b));
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
    const z = Math.floor(i / 30) * 192;
    for (const [dx, dz] of [[10, 10], [20, 24], [50, 42]] as const) hut(x + dx, z + dz, team);
  }
  const stats = h.host.tactical.stats;
  h.run(4000);
  const far = chunkAt(DIMS, 30 * 64 + 10, 202);
  const near = chunkAt(DIMS, 74, 10);
  expect(a.tactical.chunks.get(far)!.level).toBe(3);
  // The whole map's bases at the far zoom: a few hundred bytes. A team's number carries its world, so it is three bytes a chunk.
  const whole = stats.cellBytes;
  expect(whole).toBeLessThanOrEqual(720);
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

  // Nobody moves: each list is sent again only every five seconds, 18 bytes for three marks.
  const stats = h.host.tactical.stats;
  const [sent, bytes] = [stats.marks, stats.markBytes];
  h.run(10000);
  expect(stats.marks - sent).toBeLessThanOrEqual(6);
  expect(stats.markBytes - bytes).toBeLessThanOrEqual(2 * (18 + 18 + 9));

  // With the rule at "all" strangers are marked wherever they are, and the client is told which rule holds.
  expect(h.host.setSetting("MapPlayers", "all")).toBe("");
  h.run(1500);
  expect(marks.players).toBe(PLAYERS_ALL);
  expect(seen().filter((m) => m.kind === MARK_OTHER)).toEqual([{ kind: MARK_OTHER, x: 130, z: 130, self: false }]);
  expect(seen(c.tactical.marks).filter((m) => m.kind === MARK_OTHER).length).toBe(2);
  expect(h.host.setSetting("MapPlayers", "view")).toBe("");
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
  // And twenty wild ones by the first.
  for (let i = 0; i < 20; i++) h.host.spawnCreature("core:dummy", 60 + i * 3, 60, 1);
  h.run(1500);
  for (const s of [a, b]) {
    const m = s.tactical.marks;
    expect(m.count).toBe(255);
    expect(m.self).toBe(255);
    let near = 0;
    for (let i = 0; i < m.count; i++) if (Math.abs(m.x[i]! - s.own.x) < 100) near++;
    expect(near).toBe(200);
  }
  // Nothing is left out unsaid: the server counts the marks a message had no room for, and a map the markers past its 256.
  // Those are the least important, here the wild creatures.
  expect(h.host.tactical.stats.marksLeftOut).toBeGreaterThanOrEqual(2 * 146);
  const hud = new HudModel();
  const remote = new RemoteSample();
  a.sampleRemote(remote);
  updateHud(hud, a, remote, 60);
  expect([hud.markers.length, hud.unmarked, hud.markers.some((m) => m.kind === "creature")]).toEqual([256, 20, false]);
});

test("the minimap is a window on one zoom around its reader, and the map screen moves and zooms over all four with the same coordinates as the readout", () => {
  const { h, hf, join, hut, teamOf, put } = wide();
  const [a, b] = [join("ada"), join("bo")];
  h.run(500);
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.tribes.create(rec(a), "Night Shift");
  h.host.tribes.invite(rec(a), rec(b), true);
  h.host.tribes.accept(rec(b));
  put(b, 2150, 100);
  hut(120, 110, teamOf(a));
  const hud = new HudModel();
  const chart = (hud.chart = new Chart(hf, corePack().palette));
  const remote = new RemoteSample();
  const f = new UiFrame();
  let map = false;
  const frames = (ms: number): void =>
    h.run(ms, () => {
      a.sampleRemote(remote);
      updateHud(hud, a, remote, 60, 1.5);
      f.begin(16 / 9);
      buildHud(f, hud);
      if (map) buildMap(f, a, hud);
    });
  const markers = (): number => f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_MARKER && n.key < KEY_MARKER + 256).length;
  /** Whether a picture shows the tribe's green where the place (x, z) is, to within a pixel. */
  const green = (p: MapPicture, x: number, z: number): boolean => {
    const N = p.image.width;
    const px = Math.floor(((mapU(hf, x) - p.view.u0) / p.view.du) * N);
    const py = Math.floor(((mapV(hf, z) - p.view.v0) / p.view.dv) * N);
    for (let y = py - 1; y <= py + 1; y++) {
      for (let x = px - 1; x <= px + 1; x++) {
        const c = p.image.data.subarray((y * N + x) * 4, (y * N + x) * 4 + 3);
        if (c[1]! > c[0]! && c[1]! > c[2]!) return true;
      }
    }
    return false;
  };
  frames(3000);
  // On a map 8 km wide it starts at the nearest zoom, a kilometre across, and the server is told so and sends 4 m cells.
  const mini = chart.mini;
  expect([chart.miniZoom, mini.view.zoom, a.tactical.marks.zoom]).toEqual([3, 3, 3]);
  expect(mini.view.du).toBe(1 / 8);
  expect(mini.image.width).toBe(240);
  expect(a.tactical.chunks.get(chunkAt(DIMS, 122, 112))!.level).toBe(0);
  // Its own hut is on the picture in its tribe's green. The mate two kilometres off is outside the window.
  expect(green(mini, 124, 112)).toBe(true);
  expect(green(mini, 150, 112)).toBe(false);
  expect(markers()).toBe(1);
  // Three steps out is the whole map at the middle of the window, with the mate on it where its share of the picture puts it.
  for (let i = 0; i < 4; i++) expect(chart.key("Minus", true, false)).toBe(true);
  frames(3000);
  expect([mini.view.zoom, mini.view.u0, mini.view.du, a.tactical.marks.zoom]).toEqual([0, 0, 1, 0]);
  expect(markers()).toBe(2);
  const box = f.find(KEY_MINIMAP)!;
  const mate = f.find(KEY_MARKER)!;
  expect(mate.x + 2).toBeCloseTo(box.x + mapU(hf, 2150) * box.w, 1);
  expect(mate.y + 2).toBeCloseTo(box.y + ((mapV(hf, 100) - mini.view.v0) / mini.view.dv) * box.h, 1);

  // The map screen opens on its reader at the far zoom, and says the same latitude and longitude as the readout.
  map = true;
  frames(200);
  const here = latLonText(hud.lat, hud.lon);
  expect(hud.readout[0]!.startsWith(here)).toBe(true);
  expect(f.find(KEY_MAP_TITLE)!.text).toBe(`Map  ${here}`);
  const self = f.find(KEY_MAP_PIN + 16)!;
  expect(mapPointer(hud, 2, KEY_MAP_IMAGE, self.x + 4, self.y + 4)).toBe(true);
  frames(50);
  expect(f.find(KEY_MAP_LINE + 16)!.text).toBe(`zoom 1 of 4   ${here}`);
  // Its button zooms in, the server sends finer cells, and at every zoom the hut and the pin are where their coordinates put them.
  const full = chart.full;
  const image = f.find(KEY_MAP_IMAGE)!;
  expect(full.image.width).toBe(Math.round(image.w * 1.5));
  for (let zoom = 1; zoom < 4; zoom++) {
    expect(mapPointer(hud, 0, KEY_MAP_ZOOM + 1, 0, 0)).toBe(true);
    frames(2500);
    expect([full.view.zoom, full.view.du, a.tactical.marks.zoom]).toEqual([zoom, 1 / (1 << zoom), zoom]);
    expect(green(full, 124, 112)).toBe(true);
    expect(green(full, 124, 200)).toBe(false);
    const pin = f.find(KEY_MAP_PIN + 16)!;
    expect(lonOf(hf.dims, xOfU(hf, full.view.u0 + ((pin.x + 4 - image.x) / image.w) * full.view.du))).toBeCloseTo(hud.lon, 6);
  }
  // An arrow moves it a quarter of its window, and a click puts the place clicked at its middle.
  const u0 = full.view.u0;
  expect(chart.key("ArrowLeft", true, true)).toBe(true);
  frames(50);
  expect(full.view.u0).toBeCloseTo(u0 - full.view.du / 4, 3);
  mapPointer(hud, 0, KEY_MAP_IMAGE, image.x + image.w / 4, image.y + image.h / 4);
  frames(50);
  expect(full.view.u0).toBeCloseTo(u0 - full.view.du / 2, 3);
  expect(chart.key("ArrowLeft", true, false)).toBe(false);
  // With the screen shut the server is told the minimap's zoom again.
  map = false;
  frames(3000);
  expect(a.tactical.marks.zoom).toBe(0);
});

test("a whole client draws its minimap at the size of its window, and the map's keys and buttons reach it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const run = (ms: number, height = 720): void => h.run(ms, (now) => void app.frame(now, (height * 16) / 9, height));
  run(1000);
  const chart = app.hud.chart!;
  const images = app.ui.frame.images;
  // The proving ground is 512 m, so its minimap starts on the whole map.
  expect([chart.miniZoom, images[IMAGE_MINIMAP]!.width]).toEqual([0, 160]);
  run(100, 1080);
  expect(images[IMAGE_MINIMAP]!.width).toBe(240);
  expect(app.key("Equal", true)).toBe(true);
  run(200);
  expect(chart.mini.view.zoom).toBe(1);
  // One tile of the next zoom is made a frame, and all four the window touches are there soon after.
  const made = chart.tiles.version;
  run(1000 / 60);
  expect(chart.tiles.version - made).toBeLessThanOrEqual(1);
  // With the map open the same keys are the map's.
  app.key("KeyM", true);
  run(100);
  expect(app.ui.frame.find(KEY_MAP_IMAGE)!.interactive).toBe(true);
  expect(images[IMAGE_MAP]!.width).toBe(Math.round(app.ui.frame.find(KEY_MAP_IMAGE)!.w));
  app.key("Equal", true);
  run(100);
  expect([chart.fullZoom, chart.miniZoom]).toEqual([1, 1]);
  app.pointer(0, KEY_MAP_ZOOM, 0, 0, 0);
  run(100);
  expect(chart.full.view.zoom).toBe(0);
  // Walking is not the map's business: the arrows are not taken once it is shut.
  app.key("Escape", true);
  run(100);
  expect(app.key("ArrowLeft", true)).toBe(false);
});
