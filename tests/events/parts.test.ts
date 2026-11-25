// The parts the engine simulates for any kind (server/mapevent/craft.ts, events.ts): a craft shielded against real rounds
// until a blast breaks its shield; brought down, traced as it falls, at rest in a blast; a crate filled from the drop
// book, emptied by a player as a player does; the feed sent on a change and never per tick; a save in flight and in a
// fall; and modules scaling a blow on the bus.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { MAPEVENT_TAG, type MapEvent } from "../../server/mapevent/events.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MAPEVENT_BYTES, MAPEVENT_ENDED, MAPEVENT_LIVE, readMapEvents, type CraftRow, type MapEventFeed } from "../../shared/mapevent/wire.ts";
import { BitReader, type BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, EVENT_BLAST, EVENT_HIT, RESULT_OK, S_MAPEVENT } from "../../shared/net/protocol.ts";
import { MADE_METAL, SURFACE_GROUND } from "../../shared/net/rockets.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { newCraftPose, trackPose, fallPose } from "../../shared/sim/craft.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { target, type TargetOptions } from "../fixtures/event-kinds.ts";
import { flatMap } from "../fixtures/map.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-event-parts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let saves = 0;
const TICK_MS = 1000 / TICK_RATE;

/** Ada with cheats in the middle of a level kilometre, with `modules`, and a way to fire a round from her eye. */
function world(modules: ModuleDef[], dbPath?: string) {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(16)), log: () => {}, modules, ...(dbPath ? { dbPath } : {}) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, "tp 512 512");
  h.run(300);
  return rig(h, ada);
}

function rig(h: Harness, ada: ClientSession) {
  const c = h.client(ada)!;
  const pilot = h.pilots[h.sessions.indexOf(ada)]!;
  const ents = h.world.ents;
  const id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  const eye = (): { x: number; y: number; z: number } => {
    const me = h.ent(ada);
    return { x: ents.x[me]!, y: ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, ents.stance[me]!), z: ents.z[me]! };
  };
  const face = (x: number, y: number, z: number): void => {
    const e = eye();
    pilot.yaw = Math.atan2(x - e.x, z - e.z);
    pilot.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
  };
  /** Turns to the first craft of `ev` where the server has it now, and fires one round of `ammo` from `weapon`. */
  const fire = (ev: MapEvent, weapon: string, ammo: string): void => {
    const craft = h.host.mapEvents.views(ev).find((p) => p.type === "craft")!;
    face(craft.x, craft.y, craft.z);
    h.run(300);
    const now = h.host.mapEvents.views(ev).find((p) => p.type === "craft")!;
    face(now.x, now.y, now.z);
    h.run(TICK_MS * 2);
    h.host.projectiles.launch(c, h.host.records.byPid.get(c.pid)!, id(weapon), 0, id(ammo), 1);
    for (let k = 0; k < 200 && h.host.projectiles.flyingCount > 0; k++) h.run(TICK_MS);
    h.run(100);
  };
  return { h, ada, c, pilot, fire, face, events: h.host.mapEvents, ground: h.world.hf.heightAt(512, 512) };
}

/** Every feed the server sends each session from now on, by the session's name, read as a client reads it. */
function feeds(h: Harness): (name: string) => MapEventFeed[] {
  const game = h.host.game;
  const begin = game.begin.bind(game);
  const endOwn = game.endOwn.bind(game);
  const sent = new Map<string, MapEventFeed[]>();
  let writing: BitWriter | null = null;
  game.begin = (type: number): BitWriter => {
    const w = begin(type);
    writing = type === S_MAPEVENT ? w : null;
    return w;
  };
  game.endOwn = (c) => {
    if (writing) {
      const r = new BitReader(writing.bytes().slice());
      r.u8();
      const feed = readMapEvents(new BitReader(r.blob(MAPEVENT_BYTES)));
      expect(feed).not.toBeNull();
      if (!sent.has(c.name)) sent.set(c.name, []);
      sent.get(c.name)!.push(feed!);
      writing = null;
    }
    endOwn(c);
  };
  return (name) => {
    if (!sent.has(name)) sent.set(name, []);
    return sent.get(name)!;
  };
}

const call = (h: Harness, kind: string): MapEvent => {
  const ev = h.host.mapEvents.call(kind, { source: "test" });
  if (typeof ev === "string") throw new Error(ev);
  return ev;
};
const until = (h: Harness, tick: number): void => h.run(Math.max(0, tick - h.world.tick + 2) * TICK_MS);
const hover = (ground: number, more: Partial<TargetOptions> = {}): TargetOptions => ({ x: 512, z: 545, y: ground + 22, ...more });
const health = (ev: MapEvent): number => ev.crafts[0]!.health;

test("a craft's shield stops nearly all of a round until a blast breaks it, and the feed tells only the break", () => {
  const { h, ada, fire } = world([target(hover(0))]);
  const told = feeds(h)("ada");
  const ev = call(h, "target");
  until(h, ev.start);
  const sent = told.length;
  // Pistol rounds: each a hit with no zone, most of it stopped.
  const hits = (): number => ada.events.filter((e) => e.kind === EVENT_HIT).length;
  let was = health(ev);
  fire(ev, "pistol", "round_pistol");
  const soaked = was - health(ev);
  expect(soaked).toBeGreaterThan(0);
  fire(ev, "pistol", "round_pistol");
  expect([hits(), told.length]).toEqual([2, sent]);
  expect(ada.events.filter((e) => e.kind === EVENT_HIT).every((e) => e.blocked)).toBe(true);
  // A rocket's blast breaks it and goes through whole; every session is told until when it is broken.
  was = health(ev);
  fire(ev, "rocket_launcher", "rocket");
  expect(was - health(ev)).toBeGreaterThan(200);
  expect(told.length).toBe(sent + 1);
  const broke = told.at(-1)!.rows[0]!.parts[0] as CraftRow;
  expect(broke.shieldUntil).toBe(ev.crafts[0]!.shieldUntil);
  expect(broke.shieldUntil - h.world.tick).toBeGreaterThan(2 * TICK_RATE);
  // While it is broken a pistol round goes through whole: some thirty times what the shield let by.
  was = health(ev);
  fire(ev, "pistol", "round_pistol");
  const open = was - health(ev);
  expect(open / soaked).toBeGreaterThan(25);
  expect(ada.events.filter((e) => e.kind === EVENT_HIT).at(-1)!.blocked).toBe(false);
  // Shut again, and not to be broken again before its rearm: a second rocket is stopped too.
  until(h, ev.crafts[0]!.shieldUntil + 1);
  was = health(ev);
  fire(ev, "rocket_launcher", "rocket");
  expect(was - health(ev)).toBeLessThan(20);
  expect(ev.crafts[0]!.shieldUntil).toBe(broke.shieldUntil);
});

test("a craft brought down falls as every client works it out, comes to rest in a blast, and leaves a crate", () => {
  const { def, heard } = listener("watch", ["mapevent.craftDown", "mapevent.craftRest", "mapevent.crate", "mapevent.crateEmptied", "mapevent.ended"]);
  const { h, ada, pilot, face, events, ground: g } = world([def, target(hover(0, { health: 300, shield: false }))]);
  const told = feeds(h)("ada");
  const ev = call(h, "target");
  until(h, ev.start);
  expect(h.say(ada, `event down ${ev.id}`)[0]).toContain("1 craft going down");
  const craft = ev.crafts[0]!;
  expect(craft.down).toBeGreaterThan(0);
  expect(craft.impact).toBeGreaterThan(craft.down);
  h.run(200);
  // The feed says when it went down, when it comes to rest and where; the fall a client works out ends there.
  const row = told.at(-1)!.rows[0]!.parts[0] as CraftRow;
  expect([row.down, row.impact, row.rx, row.ry, row.rz]).toEqual([craft.down, craft.impact, craft.rx, craft.ry, craft.rz]);
  const pose = newCraftPose();
  trackPose(craft.track, (row.down - ev.start) / TICK_RATE, pose);
  fallPose(pose.x, pose.y, pose.z, pose.vx, pose.vy, pose.vz, (row.impact - row.down) / TICK_RATE, row.gravity, row.bleed, pose);
  expect(Math.hypot(pose.x - row.rx, pose.y - craft.half - row.ry, pose.z - row.rz)).toBeLessThan(3);
  expect(Math.abs(row.ry - g)).toBeLessThan(0.1);
  until(h, craft.impact);
  h.run(300);
  // A blast where it lies, told as metal on the ground.
  const blast = ada.events.filter((e) => e.kind === EVENT_BLAST).at(-1)!;
  expect([blast.surface, blast.made]).toEqual([SURFACE_GROUND, MADE_METAL]);
  expect(Math.hypot(blast.x - craft.rx, blast.z - craft.rz)).toBeLessThan(0.1);
  // Its kind's crate, thrown back along the way it came, holds what the drop book rolled; she takes it all.
  expect(ev.crates.length).toBe(1);
  const box = h.host.records.byPid.get(ev.crates[0]!.pid)!;
  expect(Math.hypot(box.x - (craft.rx - craft.hx * 8), box.z - (craft.rz - craft.hz * 8))).toBeLessThan(0.1);
  h.say(ada, `tp ${box.x.toFixed(2)} ${(box.z - 1.6).toFixed(2)}`);
  h.run(300);
  face(box.x, box.y + 0.4, box.z);
  h.run(300);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
  expect([h.client(ada)!.open, ada.open?.takeOnly]).toEqual([box.pid, true]);
  const inside = h.host.items.inv(box);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  let took = 0;
  for (let s = 0; s < inside.cap; s++) {
    if (inside.item[s] === 0) continue;
    let code = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
    const item = inside.item[s]!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(s), w.bits(BOX_SELF, 1), w.varint(h.host.items.inv(me).free()), w.u16(0), w.u16(item)));
    h.run(150);
    expect(code).toBe(RESULT_OK);
    took++;
  }
  expect(took).toBeGreaterThan(0);
  h.run(300);
  expect([ev.state, h.host.records.byPid.has(box.pid), events.live()]).toEqual([MAPEVENT_ENDED, false, 0]);
  const names = heard.lines.map((l) => l.split(":")[0]);
  expect(names).toEqual(["mapevent.craftDown", "mapevent.craftRest", "mapevent.crate", "mapevent.crateEmptied", "mapevent.ended"]);
  expect(heard.lines.at(-1)).toContain(`"why":"looted"`);
  expect(Number(/"stacks":(\d+)/.exec(heard.lines[2]!)![1])).toBe(took);
});

test("the feed is sent when an event is called, comes, changes and ends, and once to a session that joins", () => {
  const { h } = world([target(hover(0, { seconds: 20, speed: 2 }))]);
  const of = feeds(h);
  const told = of("ada");
  const ev = call(h, "target");
  h.run(200);
  expect(told.length).toBe(1);
  until(h, ev.start);
  expect(told.length).toBe(2);
  // Ten seconds of flight, and nothing more is sent.
  h.run(10_000);
  expect(told.length).toBe(2);
  h.join("bob");
  const bobs = of("bob");
  h.run(500);
  expect(bobs.map((f) => f.rows.map((r) => r.id))).toEqual([[ev.id]]);
  // It flies its path out and ends: the ended row is sent, and it is forgotten 15 s after.
  until(h, ev.start + ev.crafts[0]!.ticks + 2);
  expect(ev.state).toBe(MAPEVENT_ENDED);
  expect(told.at(-1)!.rows.map((r) => r.state)).toEqual([MAPEVENT_ENDED]);
  // A craft that flew out is no longer on the feed.
  expect(told.at(-1)!.rows[0]!.parts).toEqual([]);
  until(h, ev.ended + 15 * TICK_RATE);
  expect(told.at(-1)!.rows).toEqual([]);
});

test("a session that joins while an event is live is sent it whole, and one that joins to none is sent nothing", () => {
  const { h } = world([target(hover(0))]);
  const of = feeds(h);
  h.join("bob");
  h.run(500);
  expect(of("bob")).toEqual([]);
  const ev = call(h, "target");
  until(h, ev.start);
  const before = of("ada").length;
  h.join("eve");
  h.run(800);
  expect(of("eve").length).toBe(1);
  expect(of("eve")[0]!.rows.map((r) => [r.id, r.state, r.parts.length])).toEqual([[ev.id, MAPEVENT_LIVE, 1]]);
  // Nothing more for those told already.
  expect(of("ada").length).toBe(before);
});

test("a crate that goes by its time ends its event, as its kind says", () => {
  const { h, ada, events } = world([target(hover(0, { crateSeconds: 30, shield: false, crash: 0 }))]);
  const ev = call(h, "target");
  until(h, ev.start);
  h.say(ada, `event down ${ev.id}`);
  until(h, ev.crafts[0]!.impact);
  h.run(300);
  expect(ev.crates.length).toBe(1);
  h.run(31_000);
  expect([ev.state, events.log.at(-1)!.what]).toEqual([MAPEVENT_ENDED, `event ${ev.id} ended: expired`]);
});

test("a save keeps a craft in flight and in its fall, and puts right a crate with no event", () => {
  const db = join(dir, `${saves++}.db`);
  let { h, ada } = world([target(hover(0, { shield: false }))], db);
  const ev = call(h, "target");
  until(h, ev.start);
  h.run(3000);
  const pose = h.host.mapEvents.views(ev)[0]!;
  const posed = h.world.tick;
  // A stray crate of an event the save has no record of.
  const stray = h.host.records.create(h.reg.index.get("core:event_crate")!, "Stray");
  stray.extra.set(MAPEVENT_TAG, Uint8Array.of(200, 0, 1));
  stray.x = 500;
  stray.z = 500;
  h.host.items.mint(stray, h.reg.index.get("core:stone")!, 3);
  h.host.records.dirty.add(stray.pid);
  h.host.death.place(stray);
  h.run(2000);
  const tick = h.world.tick;
  h.host.shutdown();
  ({ h, ada } = world([target(hover(0, { shield: false }))], db));
  const back = h.host.mapEvents.get(ev.id)!;
  expect([back.state, h.host.combat.sky.targets.length, h.host.records.byPid.has(stray.pid), h.host.mapEvents.mended]).toEqual([MAPEVENT_LIVE, 1, false, 1]);
  // It flies on from where its ticks put it: it drifts a metre a second east.
  const again = h.host.mapEvents.views(back)[0]!;
  expect(h.world.tick).toBeGreaterThanOrEqual(tick);
  expect(Math.abs(again.x - (pose.x + (h.world.tick - posed) / TICK_RATE))).toBeLessThan(0.5);
  // Brought down and saved as it falls, it comes to rest at its tick after the restart.
  h.say(ada, `event down ${ev.id}`);
  const impact = back.crafts[0]!.impact;
  h.run(300);
  h.host.shutdown();
  ({ h, ada } = world([target(hover(0, { shield: false }))], db));
  const fell = h.host.mapEvents.get(ev.id)!;
  expect([fell.crafts[0]!.impact, fell.crafts[0]!.rested, h.host.combat.sky.targets.length]).toEqual([impact, false, 0]);
  until(h, impact);
  h.run(300);
  expect([fell.crafts[0]!.rested, fell.crates.length]).toEqual([true, 1]);
  h.host.shutdown();
});

test("a module may scale a blow on a craft, or refuse it", () => {
  const { def, heard } = listener("armour", [["mapevent.damage", { priority: 1 }]]);
  const { h, fire } = world([def, target(hover(0, { shield: false }))]);
  const ev = call(h, "target");
  until(h, ev.start);
  let was = health(ev);
  fire(ev, "pistol", "round_pistol");
  const plain = was - health(ev);
  expect(heard.lines[0]).toContain(`"type":"bullet"`);
  heard.each = (e) => void (e.data.scale = 3);
  was = health(ev);
  fire(ev, "pistol", "round_pistol");
  expect((was - health(ev)) / plain).toBeCloseTo(3, 1);
  heard.each = (e) => e.refuse("armoured");
  was = health(ev);
  fire(ev, "pistol", "round_pistol");
  expect(health(ev)).toBe(was);
});

test("three events of six sites, each its own colour, reach every session whole", () => {
  const beacons: ModuleDef = {
    name: "beacons",
    api: 1,
    setup: (m) =>
      m.mapEvent({
        id: "beacons",
        label: "Beacons",
        about: "",
        tuning: {},
        on: {
          start(run) {
            for (let k = 0; k < 6; k++) run.site({ x: 400 + k * 10, z: 400 + run.rng.range(0, 100), column: { kind: "light", rgb: (run.seed * 6 + k) * 40503 & 0xffffff, height: 40, wide: 2, sound: "" } });
          },
        },
      }),
  };
  const { h } = world([beacons]);
  const of = feeds(h);
  for (let k = 0; k < 3; k++) {
    const made = h.host.mapEvents.call("beacons", { source: "test", seed: k + 1 });
    if (typeof made === "string") throw new Error(made);
  }
  h.run(300);
  const last = of("ada").at(-1)!;
  expect([last.looks.length, last.rows.map((r) => r.parts.length)]).toEqual([18, [6, 6, 6]]);
});
