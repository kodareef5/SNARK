// What a map event is heard by (client/core/sound/mapevent.ts, client/core/mapevent/hearing.ts), worked out from the
// feed alone: its notice, a craft's hum, beam, shield, fall and coming to rest, and an event's going.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOOP } from "../../client/core/sound/mixer.ts";
import { START_FIELDS, type SoundSink } from "../../client/core/sound/packet.ts";
import { Sounds, type SoundView } from "../../client/core/sound/sounds.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Vitals, V_COUNT } from "../../shared/sim/vitals.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { MapEventHearing } from "../../client/core/mapevent/hearing.ts";
import { readShown, type MapEventsShown } from "../../client/core/mapevent/shown.ts";
import { EVENT_OWNER, HUM_REACH, IMPACT_LATEST, SOUND_SPEED, loudness } from "../../client/core/sound/mapevent.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MAPEVENT_ENDED, MAPEVENT_NOTICE, type MapEventFeed } from "../../shared/mapevent/wire.ts";
import { KEYS, candidates, cueKey } from "../../shared/sound/cues.ts";
import { STAND_IN_LOOK, UFO_LOOK, craftRow, eventRow, feedBytes, hover } from "../fixtures/mapevent.ts";

const T0 = 100_000;
const owners: string[] = [];
const ownerOf = (id: string): number => (owners.includes(id) ? owners.indexOf(id) : owners.push(id) - 1);

/** One ear's hearing of a feed: what is heard once, and each loop as it was last asked for. */
function ears(at: { x: number; y: number; z: number }) {
  const heard: { key: string; owner: string; flat: boolean; delay: number; level: number }[] = [];
  const loops = new Map<number, { key: string; owner: string; x: number; y: number; z: number; level: number; on: boolean }>();
  const holder: { shown: MapEventsShown | null } = { shown: null };
  const hearing = new MapEventHearing(holder);
  const frame = (feed: MapEventFeed, tick: number): void => {
    holder.shown = readShown(feedBytes(feed), holder.shown);
    holder.shown!.tick = tick;
    hearing.update(at, ownerOf, (owner, key, _e, _x, _y, _z, _l, level, flat, delay = 0) => void heard.push({ key: KEYS[key]!.key, owner: owners[owner]!, flat, delay, level }), (id, owner, key, x, y, z, level, on) => void loops.set(id, { key: KEYS[key]!.key, owner: owners[owner]!, x, y, z, level, on }));
  };
  const loop = (key: string) => [...loops.values()].find((l) => l.key === key)!;
  return { heard, loop, frame, once: (key: string) => heard.filter((h) => h.key === key) };
}

const ufo = (rows: MapEventFeed["rows"]): MapEventFeed => ({ looks: [{ type: "craft", craft: UFO_LOOK }], rows });

test("an event's notice is heard map-wide when it is only now called, not by a client told of it later", () => {
  const e = ears({ x: 0, y: 0, z: 0 });
  const notice = ufo([eventRow(T0 + 45 * TICK_RATE, [craftRow(hover(5000, 900, 5000))], { state: MAPEVENT_NOTICE, called: T0 })]);
  e.frame(notice, T0 + 10);
  e.frame(notice, T0 + 20);
  expect(e.once("event/notice").map((h) => [h.owner, h.flat])).toEqual([["core:ufo", true]]);
  const late = ears({ x: 0, y: 0, z: 0 });
  late.frame(notice, T0 + 10 * TICK_RATE);
  expect(late.heard).toEqual([]);
});

test("a craft hums from its way however far, to five kilometres; its beam sounds along it on a low pass", () => {
  const e = ears({ x: 1000, y: 2, z: 1000 });
  e.frame(ufo([eventRow(T0, [craftRow(hover(1000, 150, 1400, true))])]), T0 + 30);
  const hum = e.loop("craft/hum");
  expect([hum.on, hum.owner]).toEqual([true, "core:ufo"]);
  // A metre from the ear, toward the craft about 427 m off.
  expect(Math.hypot(hum.x - 1000, hum.y - 2, hum.z - 1000)).toBeCloseTo(1, 6);
  expect(hum.z - 1000).toBeGreaterThan(0.9);
  expect(hum.level).toBeCloseTo(loudness(Math.hypot(0.1, 148, 400)), 1);
  const beam = e.loop("craft/beam");
  // Under the craft, which drifts a metre a second, at the ear's height.
  expect([beam.on, beam.y]).toEqual([true, 2]);
  expect(Math.hypot(beam.x - 1000, beam.z - 1400)).toBeLessThan(2);
  // Off its low pass the beam is quiet; past five kilometres the hum is.
  e.frame(ufo([eventRow(T0, [craftRow(hover(1000, 150, 1400, false))])]), T0 + 31);
  expect(e.loop("craft/beam").on).toBe(false);
  e.frame(ufo([eventRow(T0, [craftRow(hover(1000, 150, 1000 + HUM_REACH + 100))])]), T0 + 32);
  expect([e.loop("craft/hum").on, loudness(HUM_REACH)]).toEqual([false, 0]);
});

test("a heavy blow that breaks the shield is heard once, where the craft is", () => {
  const e = ears({ x: 500, y: 2, z: 500 });
  const at = (until: number) => ufo([eventRow(T0, [craftRow(hover(500, 120, 700), { shieldUntil: until })])]);
  e.frame(at(0), T0 + 10);
  e.frame(at(T0 + 130), T0 + 11);
  e.frame(at(T0 + 130), T0 + 12);
  e.frame(at(T0 + 130), T0 + 40);
  expect(e.once("craft/shield").map((h) => h.flat)).toEqual([false]);
  // Broken again once it rearms: heard again.
  e.frame(at(T0 + 700), T0 + 400);
  expect(e.once("craft/shield").length).toBe(2);
});

test("a craft brought down whines as it falls, and its coming to rest is heard once, late by its distance", () => {
  const e = ears({ x: 2000, y: 2, z: 1000 });
  const down = ufo([eventRow(T0, [craftRow(hover(1000, 400, 1000), { down: T0 + 300, impact: T0 + 400, rx: 1000, ry: 3, rz: 1000 })])]);
  e.frame(down, T0 + 350);
  expect([e.loop("craft/fall").on, e.loop("craft/hum").on]).toEqual([true, false]);
  e.frame(down, T0 + 401);
  e.frame(down, T0 + 402);
  const rest = e.once("craft/impact");
  expect(rest.length).toBe(1);
  expect([rest[0]!.flat, rest[0]!.owner]).toEqual([true, "core:ufo"]);
  expect(rest[0]!.delay).toBeCloseTo(Math.hypot(1000, 1) / SOUND_SPEED, 3);
  expect(e.loop("craft/fall").on).toBe(false);
  // From farther than 12 s of sound away it is held back 12 s; a client told of it long after hears nothing.
  const far = ears({ x: 9000, y: 2, z: 1000 });
  far.frame(down, T0 + 390);
  far.frame(down, T0 + 405);
  expect(far.once("craft/impact")[0]!.delay).toBe(IMPACT_LATEST);
  const late = ears({ x: 2000, y: 2, z: 1000 });
  late.frame(down, T0 + 400 + 10 * TICK_RATE);
  expect(late.heard).toEqual([]);
});

test("an event that ends with nothing of it brought down is heard going; one brought down is not", () => {
  const e = ears({ x: 0, y: 0, z: 0 });
  const flying = eventRow(T0, [craftRow(hover(3000, 900, 3000))], { sound: "" });
  e.frame({ looks: [{ type: "craft", craft: STAND_IN_LOOK }], rows: [flying] }, T0 + 30);
  e.frame({ looks: [{ type: "craft", craft: STAND_IN_LOOK }], rows: [{ ...flying, state: MAPEVENT_ENDED, ended: T0 + 600 }] }, T0 + 601);
  e.frame({ looks: [{ type: "craft", craft: STAND_IN_LOOK }], rows: [{ ...flying, state: MAPEVENT_ENDED, ended: T0 + 600 }] }, T0 + 602);
  // A look and an event with no owner of their own ask the cues' own fallbacks.
  expect(e.once("event/gone").map((h) => h.owner)).toEqual([EVENT_OWNER]);
  expect(e.loop("craft/hum").owner).toBe(EVENT_OWNER);
  const d = ears({ x: 0, y: 0, z: 0 });
  const downed = eventRow(T0, [craftRow(hover(3000, 900, 3000), { down: T0 + 100, impact: T0 + 200, rx: 3000, ry: 3, rz: 3000 })]);
  d.frame(ufo([downed]), T0 + 30);
  d.frame(ufo([{ ...downed, state: MAPEVENT_ENDED, ended: T0 + 900 }]), T0 + 901);
  expect(d.once("event/gone")).toEqual([]);
});

test("each cue is a look's owner's own take first, then a sound the build has", () => {
  const ids = (key: string, owner = "core:ufo"): string[] => candidates(owner, KEYS[cueKey(key)]!).map((c) => c.id);
  expect(ids("craft/hum")).toEqual(["core:ufo/sound/craft/hum", "core:tech/sound/obelisk"]);
  expect(ids("craft/beam")).toEqual(["core:ufo/sound/craft/beam", "core:supply/sound/shaft", "core:tech/sound/beam"]);
  expect(["event/notice", "event/gone", "craft/shield", "craft/fall", "craft/impact"].map((k) => ids(k)[1])).toEqual(["core:weather/sound/thunder/far", "core:tech/sound/pulse", "core:tech/sound/shimmer", "core:supply/sound/jet", "core:weapon/sound/blast/far"]);
  // Without its own takes the UFO is heard by the stand-ins; with one, by it.
  const r = new Resolver(new Map([["core:tech/sound/obelisk", 1], ["core:ufo/sound/craft/fall", 2], ["core:supply/sound/jet", 3]]));
  const ufoOwner = r.owner("core:ufo");
  expect([r.find(ufoOwner, cueKey("craft/hum")), r.find(ufoOwner, cueKey("craft/fall")), r.find(r.owner(EVENT_OWNER), cueKey("craft/fall"))]).toEqual([1, 2, 3]);
});

test("the sounds hear a craft each frame by what the late file gave them: its hum is the obelisk's until it has its own", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-event-sound-"));
  try {
    const dir = join(root, "core", "sfx", "tech", "sound");
    mkdirSync(join(dir, "takes"), { recursive: true });
    writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(1, 32000), 32000));
    writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds: { obelisk: { range: 60, level: -20, loop: true, takes: [{ file: "takes/a.wav" }] } } }));
    const built = buildSounds(1, root, null)!;
    const net = new FakeNet([new Uint8Array(0), built.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
    const sounds = new Sounds({ sounds: built.sounds }, net, coreRegistry(), () => null);
    const holder: { shown: MapEventsShown | null } = { shown: readShown(feedBytes(ufo([eventRow(T0, [craftRow(hover(380, 300, 900))])])), null) };
    holder.shown!.tick = T0 + 30;
    sounds.producers.push(new MapEventHearing(holder));
    const starts: number[][] = [];
    const sink: SoundSink = { running: true, apply: (p) => { for (let i = 0; i < p.starts.length; i += START_FIELDS) starts.push(p.starts.slice(i, i + START_FIELDS)); } };
    const hf = buildProvingHeightfield();
    const vitals = new Vitals();
    vitals.max.fill(100e6, 0, V_COUNT);
    vitals.value.fill(100e6, 0, V_COUNT);
    const at = { x: 380, y: hf.heightAt(380, 380), z: 380 };
    const view: SoundView = { ownId: -1, body: null, hour: 12, trees: () => 0, own: { alive: true, ...at, act: 0, actTicks: 0, held: 0, female: false, vitals, tick: 0, level: 1, engrams: 0 } };
    for (let now = 0; now < 5000 && !starts.some((s) => (s[10]! & LOOP) !== 0); now += 1000 / 30) {
      net.advance(now);
      sounds.frame(sink, now, new RemoteSample(), hf, { ...at, y: at.y + 1.6, yaw: 0, pitch: 0 }, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 }, view);
    }
    const hum = starts.find((s) => (s[10]! & LOOP) !== 0);
    expect(hum).toBeDefined();
    // The build's one sound, played a metre from the ear, up and ahead where the craft is: a start's place is the ear's.
    expect(sounds.library.sounds.map((x) => x.id)).toEqual(["core:tech/sound/obelisk"]);
    expect(Math.hypot(hum![5]!, hum![6]!, hum![7]!)).toBeCloseTo(1, 3);
    expect([hum![6]! > 0.4, hum![7]! > 0.8]).toEqual([true, true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
