// What is held before it is heard, and what is not held at all: the start set and the music wait for the first view,
// what the hand may make is held before its first use, and a loop is held only within its own range.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V_COUNT, Vitals } from "../../shared/sim/vitals.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { SoundSink } from "../../client/core/sound/packet.ts";
import { Sounds, type SoundView } from "../../client/core/sound/sounds.ts";
import { buildSounds, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { chirp } from "../fixtures/sounds.ts";
import { flatWorld } from "../fixtures/world.ts";

const w = flatWorld();
const one = (range: number, loop = false) => ({ range, level: -20, ...(loop ? { loop } : {}), takes: [{ file: "takes/a.wav" }] });
const SHEETS: Record<string, Record<string, unknown>> = {
  "sfx/ui": { click: one(1) },
  "sfx/weapon": { "fire/pistol": one(180), "reload/pistol": one(20) },
  "sfx/surface": { "impact/flesh": one(40) },
  "sfx/helicopter": { "engine/idle": one(120, true), "engine/start": one(120) },
};

function world(): { sounds: Sounds; net: FakeNet; id: (name: string) => number; volumes: { master: number; music: number }; frame: (view?: SoundView | null, remote?: RemoteSample) => SoundSink & { music: boolean } } {
  const root = mkdtempSync(join(tmpdir(), "snark-ahead-"));
  try {
    for (const [folder, sounds] of Object.entries(SHEETS)) {
      const dir = join(root, "core", folder, "sound");
      mkdirSync(join(dir, "takes"), { recursive: true });
      writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(0.3, 32000), 32000));
      writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds }));
    }
    const built = buildSounds(1, root, null)!;
    const net = new FakeNet([new Uint8Array(0), built.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
    const sounds = new Sounds({ sounds: built.sounds }, net, w.reg, () => null);
    sounds.setMusic([{ id: "primeval", bpm: 90, seconds: 104, layers: ["calm"] }]);
    let now = 0;
    const volumes = { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 };
    const sink = { running: true, music: false, apply: (p: { music: unknown }) => void (sink.music = p.music !== null) };
    const frame = (view: SoundView | null = null, remote = new RemoteSample()): typeof sink => {
      now += 1000 / 30;
      net.advance(now);
      sounds.frame(sink, now, remote, w.hf, { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 }, volumes, view);
      return sink;
    };
    return { sounds, net, id: (name) => sounds.library.index.get(name)!, volumes, frame };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function view(held: number): SoundView {
  const vitals = new Vitals();
  vitals.max.fill(100e6, 0, V_COUNT);
  vitals.value.fill(100e6, 0, V_COUNT);
  return { ownId: -1, body: null, hour: 12, trees: () => 0, own: { alive: true, x: 0, y: 0, z: 0, act: 0, actTicks: 0, held, female: false, vitals, tick: 0, level: 1, engrams: 0 } };
}

test("the start set and the music wait while the first view streams in, and five seconds at most", () => {
  const a = world();
  a.sounds.assetsIdle = false;
  for (let k = 0; k < 90; k++) expect(a.frame(view(0)).music).toBe(false);
  expect(a.net.log).toEqual([]);
  a.sounds.assetsIdle = true;
  expect(a.frame(view(0)).music).toBe(true);
  for (let k = 0; k < 10; k++) a.frame(view(0));
  expect(a.sounds.library.ready(a.id("core:ui/sound/click"))).toBe(true);

  const b = world();
  b.sounds.assetsIdle = false;
  let waited = 0;
  while (!b.frame(view(0)).music) waited++;
  expect((waited * 1000) / 30).toBeCloseTo(5000, -2);
});

test("music that would not be heard is not asked of the device: muted, or its own volume at nothing", () => {
  const { sounds, volumes, frame } = world();
  sounds.assetsIdle = true;
  volumes.master = 0;
  for (let k = 0; k < 30; k++) expect(frame(view(0)).music).toBe(false);
  [volumes.master, volumes.music] = [1, 0];
  expect(frame(view(0)).music).toBe(false);
  volumes.music = 1;
  expect(frame(view(0)).music).toBe(true);
});

test("what the hand may make is held before the first shot: the pistol's report and reload, and a blow landing", () => {
  const { sounds, id, frame } = world();
  for (let k = 0; k < 20; k++) frame(view(w.kind("core:pistol")));
  for (const name of ["core:weapon/sound/fire/pistol", "core:weapon/sound/reload/pistol", "core:surface/sound/impact/flesh"]) expect(sounds.library.ready(id(name))).toBe(true);
});

test("a loop is held only within its own range: an idling helicopter's engine is not at 200 m and is at 100 m, its start within 40 m", () => {
  const { sounds, id, frame } = world();
  const r = new RemoteSample();
  r.count = 1;
  r.id[0] = 7;
  r.kind[0] = w.kind("core:helicopter_police");
  r.z[0] = 200;
  r.vehicleEngineOn[0] = 1;
  r.vehicleRotorRpm[0] = 20;
  const lib = sounds.library;
  for (let k = 0; k < 20; k++) frame(null, r);
  expect([lib.ready(id("core:helicopter/sound/engine/idle")), lib.ready(id("core:helicopter/sound/engine/start"))]).toEqual([false, false]);
  r.z[0] = 100;
  for (let k = 0; k < 20; k++) frame(null, r);
  expect([lib.ready(id("core:helicopter/sound/engine/idle")), lib.ready(id("core:helicopter/sound/engine/start"))]).toEqual([true, false]);
  r.z[0] = 30;
  for (let k = 0; k < 20; k++) frame(null, r);
  expect(lib.ready(id("core:helicopter/sound/engine/start"))).toBe(true);
});
