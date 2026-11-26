// The UFO (modules/ufo.ts), the first kind of map event and a module like any other: its path drawn from a seed across
// the map; called, told and previewed; its shield open while its beam is on; brought down to its core; and its book.

import { expect, test } from "bun:test";
import type { EventMap } from "../../server/api/event.ts";
import type { MapEvent } from "../../server/mapevent/events.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { tunedOf } from "../../shared/mapevent/fields.ts";
import { MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE } from "../../shared/mapevent/wire.ts";
import { EVENT_HIT, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { buildTrack, newCraftPose, trackPose } from "../../shared/sim/craft.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import ufo, { UFO_TUNING } from "../../modules/ufo.ts";
import { EDGE_INSET, planCrossing } from "../../modules/ufo/plan.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { JET_ARMS, JET_VEHICLE } from "../../content/vehicles/jet.ts";

const TICK_MS = 1000 / TICK_RATE;
const STARTER = tunedOf(UFO_TUNING);
const flat = (size: number, top = 40): EventMap => ({ sizeX: size, sizeZ: size, top: () => top, ground: () => top, water: () => -Infinity });

test("a seed draws one path: from edge to edge, high, with low passes near survivors, and clear of what stands everywhere", () => {
  const map = flat(16000);
  const near = [{ x: 8000, z: 8000 }];
  const a = planCrossing(new Rng(77), STARTER, map, near);
  expect(planCrossing(new Rng(77), STARTER, map, near)).toEqual(a);
  expect(planCrossing(new Rng(78), STARTER, map, near)).not.toEqual(a);
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const points = planCrossing(new Rng(seed), STARTER, map, near);
    expect(points.length).toBeGreaterThanOrEqual(STARTER.points[0]);
    expect(points.length).toBeLessThanOrEqual(STARTER.points[1]);
    for (const p of points) {
      expect(Math.min(p.x, p.z)).toBeGreaterThanOrEqual(EDGE_INSET - 0.05);
      expect(Math.max(p.x, p.z)).toBeLessThanOrEqual(16000 - EDGE_INSET + 0.05);
      if (p.low) {
        expect(p.y - 40).toBeGreaterThanOrEqual(STARTER.scanHeight[0] - 0.05);
        expect(Math.hypot(p.x - 8000, p.z - 8000)).toBeLessThan(STARTER.scanNear + 600);
      } else expect(p.y - 40).toBeGreaterThanOrEqual(STARTER.cruiseHeight[0] - 0.05);
    }
    const onEdge = (p: { x: number; z: number }): boolean => [p.x, p.z].some((v) => Math.abs(v - EDGE_INSET) < 0.1 || Math.abs(v - (16000 - EDGE_INSET)) < 0.1);
    expect(onEdge(points[0]!) && onEdge(points.at(-1)!)).toBe(true);
    // Every pose along it is well over what stands there, and it takes minutes, not a moment or an hour.
    const track = buildTrack(points);
    const pose = newCraftPose();
    let low = Infinity;
    for (let s = 0; s <= track.seconds; s += 0.5) {
      trackPose(track, s, pose);
      low = Math.min(low, pose.y - 40);
    }
    expect(low).toBeGreaterThan(50);
    expect(track.seconds).toBeGreaterThan(90);
    expect(track.seconds).toBeLessThan(900);
  }
});

/** Ada with cheats in the middle of a level kilometre, the UFO module loaded, and its book saved with `tuning`. */
function world(tuning: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(16)), log: (l) => lines.push(l), modules: [ufo] });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "tp 512 512");
  h.run(300);
  const store = h.host.eventBook;
  const saved = store.save({ ...store.book, schedules: [], tuning: { ufo: tuning } }, store.book.revision, "test", "");
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  return { h, ada, lines, pilot: h.pilots[0]! };
}
/** A UFO that lingers: slow, low, one long low pass over whoever called it, its notice a second. */
const SLOW = { noticeSeconds: 1, cruiseSpeed: 10, scanSpeed: 5, cruiseHeight: [50, 55], scanHeight: [30, 32], points: [4, 4], scans: [1, 1], scanNear: 0, health: 3000 };
const latest = (h: Harness): MapEvent => h.host.mapEvents.events.at(-1)!;
const until = (h: Harness, tick: number): void => h.run(Math.max(0, tick - h.world.tick + 2) * TICK_MS);

test("a UFO called from the console is told to everyone, comes, and flies the path its preview drew", () => {
  const { h, ada } = world();
  const preview = h.host.mapEvents.preview("ufo", 4242, [{ x: 512, z: 512 }]);
  if (typeof preview === "string") throw new Error(preview);
  expect(h.say(ada, "event call ufo here 3 4242").find((l) => l.startsWith("called"))).toStartWith("called 1: ufo, notice, comes in 3 s");
  const ev = latest(h);
  expect(ev.state).toBe(MAPEVENT_NOTICE);
  expect(ev.crafts[0]!.points.map((p) => [p.x, p.z, p.low])).toEqual(preview.crafts[0]!.spec.points.map((p) => [p.x, p.z, p.low]));
  h.run(300);
  expect(ada.log.some((l) => l.channel === TEXT_NOTICE && l.text === "Radar contact: an unidentified craft is inbound.")).toBe(true);
  until(h, ev.start);
  expect([ev.state, h.host.combat.sky.targets.length, h.host.combat.sky.targets[0]!.name, h.host.combat.sky.targets[0]!.lockable]).toEqual([MAPEVENT_LIVE, 1, "Unidentified craft", true]);
  expect(h.say(ada, "event list")[0]).toContain("1: ufo, live; craft 1 flying at");
});

test("its shield stops nearly all of a pistol round, except while its beam is on over the one who called it", () => {
  const { h, ada, pilot } = world(SLOW);
  h.say(ada, "event call ufo here");
  const ev = latest(h);
  until(h, ev.start);
  const c = h.client(ada)!;
  const rec = h.host.records.byPid.get(c.pid)!;
  const pistol = h.reg.index.get("core:pistol")!;
  const round = h.reg.index.get("core:round_pistol")!;
  const craft = ev.crafts[0]!;
  const shoot = (): { taken: number; blocked: boolean } => {
    const p = h.host.mapEvents.views(ev)[0] as { x: number; y: number; z: number };
    const me = h.ent(ada);
    const eye = h.world.ents.y[me]! + stanceEye(h.reg.move[h.world.ents.kind[me]!]!, h.world.ents.stance[me]!);
    pilot.yaw = Math.atan2(p.x - h.world.ents.x[me]!, p.z - h.world.ents.z[me]!);
    pilot.pitch = Math.atan2(p.y - eye, Math.hypot(p.x - h.world.ents.x[me]!, p.z - h.world.ents.z[me]!));
    h.run(TICK_MS * 4);
    const was = craft.health;
    const hits = ada.events.filter((e) => e.kind === EVENT_HIT).length;
    h.host.projectiles.launch(c, rec, pistol, 0, round, 1);
    h.run(200);
    const told = ada.events.filter((e) => e.kind === EVENT_HIT);
    expect(told.length).toBe(hits + 1);
    return { taken: was - craft.health, blocked: told.at(-1)!.blocked };
  };
  const shield = (): string => (h.host.mapEvents.views(ev)[0] as { shield: string }).shield;
  // On its way in, high and shut.
  while (shield() !== "closed" && ev.state === MAPEVENT_LIVE) h.run(500);
  const shut = shoot();
  expect(shut.blocked).toBe(true);
  // Over her with its beam on, open.
  while (shield() !== "open" && ev.state === MAPEVENT_LIVE) h.run(500);
  const open = shoot();
  expect(open.blocked).toBe(false);
  expect(shut.taken / open.taken).toBeCloseTo(0.03, 1);
});

test("brought down, it is told whose it was, comes to rest in its blast, and leaves its core of the drop book's best", () => {
  const { h, ada } = world({ ...SLOW, health: 300 });
  h.say(ada, "event call ufo here");
  const ev = latest(h);
  until(h, ev.start);
  const craft = ev.crafts[0]!;
  // Over her, its beam on: its low pass is laid across where she stands.
  const near = (): number => {
    const v = h.host.mapEvents.views(ev)[0] as { x: number; z: number };
    return Math.hypot(v.x - 512, v.z - 512);
  };
  while (near() > 40 && ev.state === MAPEVENT_LIVE) h.run(500);
  expect((h.host.mapEvents.views(ev)[0] as { shield: string }).shield).toBe("open");
  const c = h.client(ada)!;
  const rec = h.host.records.byPid.get(c.pid)!;
  const p = h.host.mapEvents.views(ev)[0] as { x: number; y: number; z: number };
  const me = h.ent(ada);
  const eye = h.world.ents.y[me]! + stanceEye(h.reg.move[h.world.ents.kind[me]!]!, h.world.ents.stance[me]!);
  h.pilots[0]!.yaw = Math.atan2(p.x - h.world.ents.x[me]!, p.z - h.world.ents.z[me]!);
  h.pilots[0]!.pitch = Math.atan2(p.y - eye, Math.hypot(p.x - h.world.ents.x[me]!, p.z - h.world.ents.z[me]!));
  h.run(TICK_MS * 4);
  // A rocket's blast while its beam is on goes through whole: half as much again as a blast does a body.
  h.host.projectiles.launch(c, rec, h.reg.index.get("core:rocket_launcher")!, 0, h.reg.index.get("core:rocket")!, 1);
  for (let k = 0; k < 200 && craft.down === 0; k++) h.run(TICK_MS);
  expect(craft.down).toBeGreaterThan(0);
  h.run(300);
  expect(ada.log.some((l) => l.channel === TEXT_NOTICE && l.text === "The unidentified craft is going down! ada brought it down.")).toBe(true);
  until(h, craft.impact);
  h.run(300);
  expect(ev.crates.length).toBe(1);
  const core = h.host.records.byPid.get(ev.crates[0]!.pid)!;
  expect([h.reg.ids[core.kind], core.name]).toEqual(["core:ufo_core", "Crashed craft's core"]);
  // Thrown clear of the wreck, beyond its rim.
  expect(Math.hypot(core.x - craft.rx, core.z - craft.rz)).toBeCloseTo(15, 1);
  expect(h.host.items.inv(core).used()).toBeGreaterThan(0);
  h.say(ada, `event cancel ${ev.id}`);
  h.run(200);
  expect([ev.state, h.host.records.byPid.has(core.pid)]).toEqual([MAPEVENT_ENDED, false]);
});

test("its health is more with more survivors in the world, up to three times", () => {
  const { h, ada } = world({ health: 1000 });
  h.say(ada, "event call ufo here 1");
  expect(latest(h).crafts[0]!.most).toBe(1000);
  for (const name of ["bob", "cy", "di", "eve", "fay"]) h.join(name);
  h.run(800);
  h.say(ada, "event cancel all");
  h.say(ada, "event call ufo here 1");
  expect(latest(h).crafts[0]!.most).toBe(3000);
});

test("its book refuses more low passes than its path has points for, and the starter has its two schedules", () => {
  const { h } = world();
  const store = h.host.eventBook;
  const r = store.save({ ...store.book, tuning: { ufo: { points: [4, 6], scans: [2, 3] } } }, store.book.revision, "test", "");
  expect(r.ok ? [] : "faults" in r ? r.faults.map((f) => f.path) : []).toEqual(["tuning.ufo.scans"]);
  expect(h.host.mapEvents.starterBook().schedules.map((s) => [s.key, s.kind, s.hours])).toEqual([["ufo.night", "ufo", [20, 5]], ["ufo.day", "ufo", null]]);
});

test("one jet's full load is about a UFO's health where two survivors or fewer are in the world", () => {
  const w = JET_VEHICLE.weapons!, of = (id: string) => (JET_ARMS.find((d) => d.id === id) as { ammo: { damage: number } }).ammo.damage;
  const load = w.missiles!.count * of(w.missiles!.ammo) + w.cannon!.rounds * of(w.cannon!.ammo);
  const health = tunedOf(UFO_TUNING, {}).health;
  expect(load / health).toBeGreaterThan(0.85);
  expect(load / health).toBeLessThan(1.25);
});
