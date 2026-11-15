// The sound catalogue and what reads it: the cues and their fallbacks, the resolver, the mixer's pools, flat and looping
// voices, the producers of survivors, building and the world, the loops that fade, and the board's coverage.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VARIANTS, CUES, KEYS, candidates, cueFaults, cueKey } from "../../shared/sound/cues.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { GONE_DESTROYED } from "../../shared/world/structures.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { BodySounds, type Hear } from "../../client/core/sound/bodies.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import { coverage } from "../../client/core/sound/coverage.ts";
import { FLAT, KIND_UI, KIND_VOCAL, LOOP, Mixer, VOICES } from "../../client/core/sound/mixer.ts";
import { distanceGain } from "../../client/core/sound/place.ts";
import { START_FIELDS, SoundPacket, type SoundSink } from "../../client/core/sound/packet.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { Sounds, type SoundView } from "../../client/core/sound/sounds.ts";
import { WORLD_LOOPS, WorldSounds } from "../../client/core/sound/world.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const hf = buildProvingHeightfield();

test("the catalogue is sound: no name twice, every variable known, every fallback an owner and a name", () => {
  expect(cueFaults()).toEqual([]);
  expect(KEYS.length).toBeGreaterThan(200);
  expect(() => cueKey("step/lava")).toThrow();
  // The owner's own sound first, then the fallbacks with their variables filled and their rates.
  expect(candidates("core:rex", KEYS[cueKey("step/sand")]!).map((c) => c.id)).toEqual(["core:rex/sound/step/sand", "core:rex/sound/step", "core:rex/sound/step/grass", "core:surface/sound/step/sand"]);
  expect(candidates("core:rex", KEYS[cueKey("death")]!).at(-1)).toEqual({ id: "core:rex/sound/hurt", rate: 0.88 });
});

test("every occasion the client fires by a literal name is in the catalogue, and so is every screen the interface names", () => {
  const dir = join(import.meta.dir, "../../client/core/sound");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/cueKey\("([^"]+)"\)/g)) expect(() => cueKey(m[1]!)).not.toThrow();
  }
  const ui = readFileSync(join(import.meta.dir, "../../client/core/ui/ui.ts"), "utf8");
  for (const m of ui.matchAll(/this\.hear\?\.\("([^"]+)"\)/g)) expect(() => cueKey(m[1]!)).not.toThrow();
  for (const s of ["inventory", "map", "character", "options"]) expect(VARIANTS.screen).toContain(s);
  // Each status says what the game does now; a cue that waits names its feature.
  for (const c of CUES) expect(c.status).toMatch(/^(built|fire|hook|gap|waits:[A-Za-z0-9]+)$/);
});

test("an owner is heard by its own sound, else the first fallback the build has, at the stand-in's rate, and silence is counted", () => {
  const ids = ["core:dodo/sound/hurt", "core:dodo/sound/step/grass", "core:surface/sound/step/stone", "core:surface/sound/step/water"];
  const r = new Resolver(new Map(ids.map((id, i) => [id, i])));
  const dodo = r.owner("core:dodo");
  const rex = r.owner("core:rex");
  expect(r.find(dodo, cueKey("hurt"))).toBe(0);
  expect(r.find(dodo, cueKey("death"))).toBe(0);
  expect(r.rate(dodo, cueKey("death"))).toBe(0.88);
  // A creature's own grass step stands in on stone before a person's boots would.
  expect(r.find(dodo, cueKey("step/stone"))).toBe(1);
  expect(r.find(rex, cueKey("step/stone"))).toBe(2);
  expect(r.find(rex, cueKey("step/water"))).toBe(3);
  expect(r.find(rex, cueKey("call"))).toBe(-1);
  expect(r.missed[cueKey("call")]).toBe(1);
  expect(r.asked[cueKey("step/stone")]).toBe(2);
});

test("the world's voices never take the interface's: a full fight leaves room for a click, which plays flat on its own bus", () => {
  const m = new Mixer();
  const p = new SoundPacket();
  const ear = { x: 0, y: 0, z: 0 };
  let started = 0;
  for (let k = 0; k < VOICES; k++) if (m.play(p, ear, 0, k, k, 2, 60, KIND_VOCAL, 1, -1, 2 + k * 0.1, 0, 0, 0, 1, 1, 0) !== 0) started++;
  expect(started).toBeLessThanOrEqual(40);
  p.clear();
  const click = m.play(p, ear, 0, 999, 999, 0.1, 1, KIND_UI, 1, -1, 500, 0, 0, 0, 1, 1, 0, FLAT);
  expect(click).toBeGreaterThan(0);
  const s = p.starts.slice(-START_FIELDS);
  // Not placed: no position, no dulling, the interface's bus (3), the flat flag.
  expect([s[5], s[6], s[7], s[8], s[9], s[10]]).toEqual([0, 0, 0, 20000, 3, FLAT]);
});

test("a looping voice plays until it is ended, and a change of its gain reaches the device", () => {
  const m = new Mixer();
  const p = new SoundPacket();
  const ear = { x: 0, y: 0, z: 0 };
  const serial = m.play(p, ear, 0, 1, 1, 1, 30, KIND_VOCAL, 1, -1, 3, 0, 0, 0, 1, 1, 0, LOOP);
  m.expire(60_000);
  expect(m.playing).toBe(1);
  expect(m.gain(serial, 0.25)).toBe(true);
  p.clear();
  m.follow(p, ear, () => false);
  expect(p.moves[1]).toBeCloseTo(0.25 * distanceGain(3, 30), 5);
  m.end(serial, p);
  expect(m.playing).toBe(0);
  expect(p.stops).toContain(serial);
});

test("a survivor's steps come a stride apart and softer crouched, a jump is breathed and a hard landing grunted, and water splashes", () => {
  const heard: [number, string, boolean][] = [];
  const hear: Hear = (_o, key, _e, _x, _y, _z, _l, level, flat) => heard.push([level, KEYS[key]!.key, flat]);
  const b = new BodySounds();
  const remote = new RemoteSample();
  const x0 = 380;
  const z = 380;
  const self = { x: x0, y: hf.heightAt(x0, z), z, vy: 0, grounded: true, mode: 0, stance: 0, mflags: 0 };
  const step = (): void => b.update(1 / 30, remote, hf, self.x, self.y + 1.6, self.z, -1, self, false, 0, () => false, hear);
  step();
  for (let k = 0; k < 30; k++) {
    self.x += 0.2;
    step();
  }
  const steps = heard.filter((h) => h[1].startsWith("step/"));
  expect(steps.length).toBe(4);
  expect(steps.every((s) => s[1] === "step/grass" && s[2])).toBe(true);
  heard.length = 0;
  self.grounded = false;
  self.vy = 5;
  step();
  expect(heard.map((h) => h[1])).toEqual(["voice/male/jump"]);
  self.vy = -12;
  step();
  self.grounded = true;
  self.vy = 0;
  step();
  expect(heard.map((h) => h[1])).toEqual(["voice/male/jump", "land/grass", "voice/male/land"]);
  heard.length = 0;
  self.mode = MODE_SWIM;
  step();
  expect(heard.map((h) => h[1])).toEqual(["splash/in"]);
});

test("building is heard from its rows: placed by its material, a door opening and shutting, a fire lit and burning, and a piece destroyed", () => {
  const owners: string[] = [];
  const b = new BuildSounds(reg, (id) => owners.push(id) - 1);
  const heard: string[] = [];
  const burning: boolean[] = [];
  const hear: Hear = (o, key) => heard.push(`${KEYS[key]!.key} ${owners[o]}`);
  const run = (): void => b.update(0, 0, 0, hear, (_id, _o, _k, _x, _y, _z, on) => burning.push(on));
  const k = (id: string): number => reg.index.get(id)!;
  b.structure(0, k("core:wall_stone"), 1, 0, 1, 0, 100, -1);
  b.structure(k("core:door_wood"), k("core:door_open_wood"), 2, 0, 2, 100, 100, -1);
  b.structure(k("core:door_open_wood"), k("core:door_wood"), 2, 0, 2, 100, 100, -1);
  b.structure(k("core:campfire"), k("core:campfire_lit"), 3, 0, 3, 100, 100, -1);
  b.structure(k("core:wall_stone"), 0, 1, 0, 1, 100, 0, GONE_DESTROYED);
  b.node(k("core:oak"), 5, 0, 5);
  run();
  expect(heard).toEqual(["place/stone core:wall_stone", "door/open/wood core:door_open_wood", "door/close/wood core:door_wood", "fire/light core:campfire_lit", "destroy/stone core:wall_stone", "felled core:oak"]);
  expect(burning[0]).toBe(true);
});

test("the world's bed follows the place and the clock: a beach by the sea, grass inland, day and night, and under water only the deep", () => {
  const w = new WorldSounds();
  const on = (hour: number, x: number, y: number, z: number): string[] => {
    const out: string[] = [];
    w.update(1e9, hf, x, y, z, hour, () => 0, (id, key, _l, active) => void (active && out.push(KEYS[key]!.key)), () => {});
    (w as unknown as { recheckMs: number }).recheckMs = 0;
    return out;
  };
  const inland = [450, hf.heightAt(450, 60) + 1.6, 60] as const;
  expect(on(12, ...inland)).toEqual(["bed/grass/day"]);
  expect(on(23, ...inland)).toEqual(["bed/grass/night"]);
  expect(on(12, 150, hf.heightAt(150, 300) + 1.6, 300)).toEqual(["bed/beach/day", "shore"]);
  expect(on(12, inland[0], hf.seaLevel - 2, inland[2])).toEqual(["underwater"]);
  expect(WORLD_LOOPS).toBeGreaterThan(10);
});

test("a looping bed fades in when it is wanted and out when it is not, and the interface plays at the ear", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-catalogue-"));
  try {
    for (const [folder, sounds] of [
      ["world", { "bed/grass/day": { range: 1, level: -30, loop: true, takes: [{ file: "takes/a.wav" }] } }],
      ["sfx/ui", { click: { range: 1, level: -24, takes: [{ file: "takes/a.wav" }] } }],
    ] as const) {
      const dir = join(root, "core", folder, "sound");
      mkdirSync(join(dir, "takes"), { recursive: true });
      writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(1, 32000), 32000));
      writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds }));
    }
    const built = buildSounds(1, root, null)!;
    const net = new FakeNet([new Uint8Array(0), built.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
    const sounds = new Sounds({ sounds: built.sounds }, net, reg, () => null);
    const starts: number[][] = [];
    const gains: number[] = [];
    const sink: SoundSink = { running: true, apply: (p) => {
      for (let i = 0; i < p.starts.length; i += START_FIELDS) starts.push(p.starts.slice(i, i + START_FIELDS));
      for (let i = 0; i < p.moves.length; i += 6) gains.push(p.moves[i + 1]!);
    } };
    const vitals = new Vitals();
    vitals.max.fill(100e6, 0, V_COUNT);
    vitals.value.fill(100e6, 0, V_COUNT);
    const at = { x: 380, y: hf.heightAt(380, 380), z: 380 };
    const view: SoundView = { ownId: -1, body: null, hour: 12, trees: () => 0, own: { alive: true, ...at, act: 0, held: 0, female: false, vitals, tick: 0, level: 1, engrams: 0 } };
    let now = 0;
    const frame = (): void => {
      now += 1000 / 30;
      net.advance(now);
      sounds.frame(sink, now, new RemoteSample(), hf, { ...at, y: at.y + 1.6, yaw: 0, pitch: 0 }, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 }, view);
    };
    while (!starts.some((s) => (s[10]! & LOOP) !== 0) && now < 5000) frame();
    const bed = starts.find((s) => (s[10]! & LOOP) !== 0)!;
    expect(bed[9]).toBe(1);
    // It starts quiet and is all the way up its 1.5 s fade two seconds later.
    expect(bed[4]!).toBeLessThan(0.1);
    for (let k = 0; k < 60; k++) frame();
    expect(gains.at(-1)!).toBeCloseTo(1, 5);
    sounds.hearUi(cueKey("click"));
    frame();
    const click = starts.find((s) => s[9] === 3)!;
    expect(click[10]).toBe(FLAT);
    // The bed started once and played on.
    expect(starts.filter((s) => (s[10]! & LOOP) !== 0).length).toBe(1);
    // Under water the bed is no longer wanted: it fades and stops.
    at.y = hf.seaLevel - 3;
    for (let k = 0; k < 60; k++) frame();
    expect(sounds.mixer.playing).toBeLessThanOrEqual(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("coverage counts the occasions heard through shared sounds, by owners' own only, and not at all", () => {
  const c = coverage(["core:surface/sound/step/grass", "core:dodo/sound/call", "core:ui/sound/click"]);
  const row = (k: string) => c.rows.find((r) => r.key === k)!;
  expect(row("step/grass").shared).toBe("core:surface/sound/step/grass");
  expect(row("call").owners).toEqual(["core:dodo"]);
  expect(row("click").shared).toBe("core:ui/sound/click");
  expect(row("thunder").shared).toBeNull();
  expect(c.shared + c.ownOnly + c.silent).toBe(KEYS.length);
  expect(c.silentWaiting).toBeGreaterThan(0);
});
