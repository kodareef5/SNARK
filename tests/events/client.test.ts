// A map event as a client draws it (client/core/mapevent/): a feed sent to a real client is read, and each part is drawn
// by its type's view at the tick the remote bodies are shown at, in its art where the pack has it, else by stand-ins.

import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import "../../client/core/mapevent-late.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { CraftLook } from "../../shared/mapevent/parts.ts";
import { MAPEVENT_ENDED, MAPEVENT_NOTICE, type MapEventFeed } from "../../shared/mapevent/wire.ts";
import { buildTrack, newCraftPose, trackPose, type PathPoint } from "../../shared/sim/craft.ts";
import type { Harness } from "../fixtures/net.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { LIGHT_COLUMN, SMOKE_COLUMN, STAND_IN_LOOK, UFO_LOOK, craftRow, eventRow, hover, siteRow, tell } from "../fixtures/mapevent.ts";
import { camp, drawn, look, screen, type Screen } from "../kit/kit.ts";
import type { ClientSession } from "../../client/core/session.ts";

const craftFeed = (craft: CraftLook, rows: MapEventFeed["rows"]): MapEventFeed => ({ looks: [{ type: "craft", craft }, { type: "column", column: SMOKE_COLUMN }], rows });
const pass = (view: Screen) => view.app.scene!.mapEventPass!;
const ground = (h: Harness, x: number, z: number): number => h.world.hf.heightAt(x, z);

/** Tells ada of `feed`, looks at (x, y, z) and lets a few frames be drawn. */
function show(h: Harness, ada: ClientSession, feed: MapEventFeed, x: number, y: number, z: number): void {
  tell(h, ada, feed);
  look(h, ada, { x, y, z });
  h.run(500);
}

/** The see-through fade of each draw of a mesh in the last frame. */
function fades(view: Screen, mesh: string): number[] {
  const p = view.packet!, k = corePack().meshIndex.get(mesh)!, out: number[] = [];
  for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === k) out.push(p.drawTint[d * 2 + 1]!);
  return out;
}

artTest("a craft flying in its art is a draw a piece and one for its beam, from near and far", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  for (const [far, up] of [[60, 30], [400, 120], [900, 800]] as const) {
    show(h, ada, craftFeed(UFO_LOOK, [eventRow(h.world.tick, [craftRow(hover(at.x, up, at.z + far, true))])]), at.x, up, at.z + far);
    expect(["core:ufo_craft", "core:ufo_rim", "core:ufo_ring", "core:event_disc"].map((m) => drawn(view, m)), `${far} m`).toEqual([1, 1, 1, 0]);
    expect([pass(view).craft, pass(view).beams, pass(view).draws]).toEqual([1, 1, 4]);
  }
});

test("a look whose meshes no pack has is the stand-in disc: two draws with its beam", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(h.world.tick, [craftRow(hover(at.x, 60, at.z + 150, true))])]), at.x, 60, at.z + 150);
  expect([drawn(view, "core:event_disc"), drawn(view, "core:event_cone"), pass(view).draws]).toEqual([1, 1, 2]);
  // Off its low pass its beam is off.
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(h.world.tick, [craftRow(hover(at.x, 60, at.z + 150, false))])]), at.x, 60, at.z + 150);
  expect([drawn(view, "core:event_disc"), drawn(view, "core:event_cone"), pass(view).beams]).toEqual([1, 0, 0]);
});

artTest("a missing first piece draws the look's fallback, else the stand-in; a missing later piece is left out", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const at150 = (craft: CraftLook): void => show(h, ada, craftFeed(craft, [eventRow(h.world.tick, [craftRow(hover(at.x, 60, at.z + 150))])]), at.x, 60, at.z + 150);
  at150({ ...UFO_LOOK, pieces: [{ mesh: "test:gone", spin: 0 }, ...UFO_LOOK.pieces.slice(1)], fallback: "core:ufo_craft" });
  expect(["core:ufo_craft", "core:ufo_rim", "core:ufo_ring", "core:event_disc"].map((m) => drawn(view, m))).toEqual([1, 0, 0, 0]);
  at150({ ...UFO_LOOK, pieces: [{ mesh: "test:gone", spin: 0 }], fallback: "" });
  expect(["core:ufo_craft", "core:event_disc"].map((m) => drawn(view, m))).toEqual([0, 1]);
  at150({ ...UFO_LOOK, pieces: [UFO_LOOK.pieces[0]!, { mesh: "test:gone", spin: 1 }, UFO_LOOK.pieces[2]!] });
  expect(["core:ufo_craft", "core:ufo_rim", "core:ufo_ring", "core:event_disc"].map((m) => drawn(view, m))).toEqual([1, 0, 1, 0]);
});

artTest("at rest a craft is its wreck and its smoke: two draws; a stand-in is its disc and smoke", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const x = at.x + 20, z = at.z + 50, y = ground(h, x, z) + 3.2, tick = h.world.tick;
  const rest = craftRow(hover(x, 400, z), { down: tick + 1, impact: tick + 2, rx: x, ry: y, rz: z, stage: 3 });
  show(h, ada, craftFeed(UFO_LOOK, [eventRow(tick, [rest])]), x, y, z);
  expect(["core:ufo_wreck", "core:ufo_craft", "core:event_cone"].map((m) => drawn(view, m))).toEqual([1, 0, 1]);
  expect([pass(view).craft, pass(view).smokes, pass(view).draws]).toEqual([1, 1, 2]);
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(tick, [rest])]), x, y, z);
  expect(["core:event_disc", "core:event_cone"].map((m) => drawn(view, m))).toEqual([1, 1]);
  expect(pass(view).draws).toBe(2);
});

test("a craft's art is wanted from its notice, before it comes, and nothing of it is drawn yet", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  h.run(300);
  const assets = view.app.scene!.assets, wanted = new Set<number>(), want = assets.want.bind(assets);
  assets.want = (mesh, level, distance) => (wanted.add(mesh), want(mesh, level, distance));
  const tick = h.world.tick;
  show(h, ada, craftFeed(UFO_LOOK, [eventRow(tick + 45 * TICK_RATE, [craftRow(hover(at.x, 300, at.z + 900, true))], { state: MAPEVENT_NOTICE, called: tick })]), at.x, 300, at.z + 900);
  expect([pass(view).craft, pass(view).draws]).toEqual([0, 0]);
  const names = ["core:event_disc", "core:event_cone", ...(assets.table.find("core:ufo_craft") >= 0 ? ["core:ufo_craft", "core:ufo_rim", "core:ufo_ring", "core:ufo_wreck"] : [])];
  for (const name of names) expect(wanted.has(assets.table.find(name)), name).toBe(true);
});

test("a craft is drawn where its path puts it at the tick the remote bodies are shown at", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const points: PathPoint[] = [{ x: at.x - 50, y: 300, z: at.z + 500, speed: 140, low: false }, { x: at.x + 6000, y: 320, z: at.z + 520, speed: 140, low: false }];
  const start = h.world.tick;
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(start, [craftRow(points)])]), at.x + 30, 300, at.z + 500);
  expect(pass(view).craft).toBe(1);
  const want = newCraftPose();
  trackPose(buildTrack(points), (ada.shown - start) / TICK_RATE, want);
  const got = pass(view).placed;
  expect([got[0]!, got[1]!, got[2]!].map((v, k) => v - [want.x, want.y, want.z][k]!).map((d) => Math.abs(d) < 1e-6)).toEqual([true, true, true]);
  // At 140 m/s, a frame drawn at the newest tick would put it metres away.
  trackPose(buildTrack(points), (ada.latestSnapshot - start) / TICK_RATE, want);
  expect(Math.abs(got[0]! - want.x)).toBeGreaterThan(1);
});

test("an ended event's wreck smoke thins over twelve seconds, then nothing of it is drawn", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const x = at.x, z = at.z + 80, y = ground(h, x, z) + 3.2, tick = h.world.tick;
  const rest = craftRow(hover(x, 400, z), { down: tick + 1, impact: tick + 2, rx: x, ry: y, rz: z });
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(tick, [rest], { state: MAPEVENT_ENDED, ended: tick + 3 })]), x, y + 40, z);
  const early = fades(view, "core:event_cone");
  h.run(6000);
  const later = fades(view, "core:event_cone");
  expect([early.length, later.length]).toEqual([1, 1]);
  expect(later[0]!).toBeGreaterThan(early[0]! + 0.3);
  h.run(7000);
  expect([drawn(view, "core:event_cone"), drawn(view, "core:event_disc"), pass(view).craft]).toEqual([0, 0, 0]);
});

test("a craft past the end of its path, never brought down, is not drawn", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const points: PathPoint[] = [{ x: at.x, y: 80, z: at.z + 100, speed: 50, low: false }, { x: at.x + 100, y: 80, z: at.z + 100, speed: 50, low: false }];
  show(h, ada, craftFeed(STAND_IN_LOOK, [eventRow(h.world.tick, [craftRow(points)])]), at.x, 80, at.z + 100);
  expect(pass(view).craft).toBe(1);
  h.run(3000);
  expect([pass(view).craft, drawn(view, "core:event_disc")]).toEqual([0, 0]);
});

test("a site's column stands from its first tick to its last", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  h.run(3000);
  const x = at.x + 30, z = at.z + 120, y = ground(h, x, z), tick = h.world.tick;
  const feed = (from: number, to: number): MapEventFeed => ({ looks: [{ type: "column", column: LIGHT_COLUMN }], rows: [eventRow(tick, [siteRow(x, y, z, { look: 0, from, to })], { kind: "beacon", sound: "" })] });
  show(h, ada, feed(tick + 60 * TICK_RATE, 0), x, y + 50, z);
  expect([pass(view).columns, drawn(view, "core:event_cone")]).toEqual([0, 0]);
  show(h, ada, feed(tick - 20, tick + 60 * TICK_RATE), x, y + 50, z);
  expect([pass(view).columns, pass(view).draws]).toEqual([1, 1]);
  show(h, ada, feed(tick - 60, tick), x, y + 50, z);
  expect(pass(view).columns).toBe(0);
});

test("a kind no client knows is drawn by its parts: a meteor's craft and its site", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const tick = h.world.tick, x = at.x + 10, z = at.z + 200;
  const meteor = eventRow(tick, [craftRow(hover(x, 90, z)), siteRow(x, ground(h, x, z), z + 30)], { id: 31, kind: "meteor", sound: "" });
  show(h, ada, { looks: [{ type: "craft", craft: STAND_IN_LOOK }, { type: "column", column: SMOKE_COLUMN }], rows: [meteor] }, x, 60, z);
  expect([pass(view).craft, pass(view).columns, drawn(view, "core:event_disc"), pass(view).draws]).toEqual([1, 1, 1, 2]);
  // Nothing that draws or hears an event reads its kind.
  const dir = join(import.meta.dir, "../../client/core");
  const files = [...readdirSync(join(dir, "mapevent")).map((f) => join(dir, "mapevent", f)), join(dir, "render/passes/map-events.ts"), join(dir, "sound/mapevent.ts"), join(dir, "mapevent-late.ts"), join(dir, "mapevent-load.ts")];
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\b(?:event|row|e)\.kind\b|["'`]ufo/i);
});

artTest("eight craft in view on their low passes take 32 of the packet's draws at most", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  const rows = Array.from({ length: 8 }, (_, i) => eventRow(h.world.tick, [craftRow(hover(at.x - 100 + i * 30, 150 + i * 30, at.z + 700 + i * 20, true))], { id: 100 + i }));
  show(h, ada, craftFeed(UFO_LOOK, rows), at.x, 220, at.z + 700);
  expect([pass(view).craft, pass(view).beams]).toEqual([8, 8]);
  expect(pass(view).draws).toBeLessThanOrEqual(32);
});
