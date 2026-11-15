// A whole client hearing a dodo on a running server: the sounds come through the asset port beside the meshes, and
// what the dodo does is heard from what its snapshots already carry. A client with no sink does none of this.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { SoundPacket, SoundSink } from "../../client/core/sound/packet.ts";
import { START_FIELDS } from "../../client/core/sound/packet.ts";
import { LOOP } from "../../client/core/sound/mixer.ts";
import { CAUSE_KILLED } from "../../server/survival.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { builtSounds, manifestWithSounds } from "../fixtures/sounds.ts";

const bytes = corePackBytes();
const pack = parsePack(bytes);
const built = builtSounds();

/** Plays at once, and keeps the names of what it was told to start and how many takes it holds. */
class Ears implements SoundSink {
  running = true;
  held = 0;
  readonly heard: { name: string; x: number; z: number }[] = [];
  name: (buffer: number) => string = () => "";
  apply(p: SoundPacket): void {
    this.held += p.loads.length - p.unloads.length;
    for (let i = 0; i < p.starts.length; i += START_FIELDS) this.heard.push({ name: this.name(p.starts[i + 1]!), x: p.starts[i + 5]!, z: p.starts[i + 7]! });
  }
}

test("a client hears a dodo before it, startled and fleeing on soft feet when struck, and dying; a client with no sink does no sound work", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const manifest = manifestWithSounds(pack, bytes.length, built);
  const net = new FakeNet([bytes, built.file], { latencyMs: 30, bytesPerSecond: 2e6 });
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, pack, { manifest, port: net });
  const ears = new Ears();
  app.sound = ears;
  const deaf = new App(h.join("bea", { latencyMs: 20 }, { manual: true }), h.reg, pack, { manifest, port: new FakeNet([bytes, built.file]) });
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      net.advance(now);
      app.frame(now, 1280, 720);
      deaf.frame(now, 1280, 720);
    });
  run(600);
  expect(deaf.sounds).toBeNull();
  const sounds = app.sounds!;
  expect(sounds).not.toBeNull();
  ears.name = (buffer) => {
    const lib = sounds.library;
    const s = [...lib.first].findLastIndex((f) => f <= buffer);
    return lib.sounds[s]!.id.slice("core:dodo/sound/".length);
  };

  // A dodo standing four metres ahead, on the open ground north of the plaza.
  const ents = h.world.ents;
  const me = h.ent(app.session);
  const e = h.host.spawnCreature("core:dodo", ents.x[me]!, ents.z[me]! + 4, 1);
  h.host.creatures.mind.stay(e, h.world.tick + 1e6);
  run(1500);
  // Its sounds have come and are held, but for its steps on sand, since it is not on sand.
  expect(ears.held).toBe(built.sounds.reduce((n, s) => n + (s.id.endsWith("step/sand") ? 0 : s.takes.length), 0));
  ears.heard.length = 0;

  // Struck: startled, then fleeing, its feet heard as it goes.
  h.host.creatures.provoke(e, ents.x[me]!, ents.z[me]!, me);
  run(2000);
  const names = ears.heard.map((x) => x.name);
  expect(names[0]).toBe("startled");
  expect(names.filter((n) => n.startsWith("step/")).length).toBeGreaterThan(4);
  // Heard from ahead: the dodo is at +z of the ear, and the sound is placed there.
  expect(ears.heard[0]!.z).toBeGreaterThan(2);

  // Killed, it is heard dying where it was.
  ears.heard.length = 0;
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.survival.add(rec, V_HEALTH, -1e9, CAUSE_KILLED);
  run(1500);
  expect(ears.heard.map((x) => x.name)).toEqual(expect.arrayContaining(["hurt", "land"]));
  expect(deaf.sounds).toBeNull();
});

test("when the session closes, everything playing stops, the bed under it too", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const withBeds = builtSounds(1, true);
  const manifest = manifestWithSounds(pack, bytes.length, withBeds);
  const net = new FakeNet([bytes, withBeds.file], { latencyMs: 30, bytesPerSecond: 2e6 });
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, pack, { manifest, port: net });
  // The device as client/sound keeps it: the voices it plays, stopped before started.
  const playing = new Set<number>();
  let loops = 0;
  app.sound = {
    running: true,
    apply(p: SoundPacket): void {
      for (const s of p.stops) playing.delete(s);
      for (let i = 0; i < p.starts.length; i += START_FIELDS) {
        playing.add(p.starts[i]!);
        if ((p.starts[i + 10]! & LOOP) !== 0) loops++;
      }
    },
  };
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      net.advance(now);
      app.frame(now, 1280, 720);
    });
  run(3000);
  expect(loops).toBeGreaterThan(0);
  expect(playing.size).toBeGreaterThan(0);
  h.ends[0]!.close();
  run(500);
  expect(app.session.state).toBe("closed");
  expect(playing.size).toBe(0);
});
