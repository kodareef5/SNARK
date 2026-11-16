// Benchmark rows for what hearing a flock costs a client each frame: forty dodos within hearing walking about, then all
// startled at once and running, through the creature watcher, the library and the mixer as Sounds.frame runs them.
// Medians of many frames; a busy machine moves them.

import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, CUE_STARTLE, LAYER_FLINCH, bodySeed } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { MANIFEST_VERSION, parseManifest } from "../../shared/pack/manifest.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { SoundSink } from "../../client/core/sound/packet.ts";
import { Sounds } from "../../client/core/sound/sounds.ts";
import { FakeNet } from "../../tests/fixtures/assetnet.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { builtSounds } from "../../tests/fixtures/sounds.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";

const median = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
const DODOS = 40;

export function benchSound(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void): void {
  section("Sound");
  const reg = coreRegistry();
  const kind = reg.index.get("core:dodo")!;
  const rig = buildRigs(corePack().header.rigs, corePack().clips).get("core:dodo");
  if (!rig) return;
  const anim = new CreatureAnim(rig, reg.runAt[kind]!, reg.move[kind]?.swimSpeed ?? 0);
  const made = builtSounds();
  const manifest = parseManifest(JSON.stringify({ version: MANIFEST_VERSION, files: [{ name: "boot", bytes: 0, role: "boot" }, { name: "sounds", bytes: made.file.length, role: "sound" }], boot: 0, clipHash: 0, meshes: [], sounds: made.sounds }));
  const net = new FakeNet([new Uint8Array(0), made.file], { latencyMs: 5, bytesPerSecond: 1e8 });
  const sounds = new Sounds(manifest, net, reg, (k) => (k === kind ? anim : null));
  const hf = buildProvingHeightfield();
  const remote = new RemoteSample();
  let most = 0;
  const sink: SoundSink = { running: true, apply: () => void (most = Math.max(most, sounds.mixer.playing)) };
  const st = new AnimState();
  const ear = { x: 380, y: hf.heightAt(380, 380) + 1.6, z: 380, yaw: 0, pitch: 0 };
  let tick = 1000;
  let now = 0;
  remote.count = DODOS;
  // In rings from 3 to 24 metres out, a third standing and the rest walking; startled, every one runs.
  const frame = (startled: boolean): number => {
    tick += 0.5;
    now += 1000 / 60;
    net.advance(now);
    for (let i = 0; i < DODOS; i++) {
      const a = (i / DODOS) * Math.PI * 2;
      const speed = startled ? 1.36 : i % 3 === 0 ? 0 : 0.6;
      const x = ear.x + Math.sin(a) * (3 + (i % 8) * 3) + (speed * tick) / TICK_RATE / 20;
      const z = ear.z + Math.cos(a) * (3 + (i % 8) * 3);
      st.seed = bodySeed(i + 1);
      st.setMotion(speed, 0, Math.PI / 2, 0);
      st.cue = startled ? CUE_STARTLE : 0;
      st.cueStart = startled ? 3 : 0;
      st.layer = startled ? LAYER_FLINCH : 0;
      st.layerStart = startled ? 3 : 0;
      remote.id[i] = i + 1;
      remote.kind[i] = kind;
      remote.x[i] = x;
      remote.y[i] = hf.heightAt(x, z);
      remote.z[i] = z;
      remote.yaw[i] = Math.PI / 2;
      remote.anim[i] = st.pack();
      remote.cue[i] = st.packCue();
    }
    remote.tick = tick;
    const t0 = performance.now();
    sounds.frame(sink, now, remote, hf, ear, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 });
    return performance.now() - t0;
  };
  for (let k = 0; k < 120; k++) frame(false);
  const walking = Array.from({ length: 600 }, () => frame(false));
  const startled = Array.from({ length: 600 }, () => frame(true));
  record(`sound work a frame, ${DODOS} dodos about the ear`, median(walking), "ms", 0.5);
  record(`sound work a frame, ${DODOS} dodos startled and running`, median(startled), "ms", 0.5);
  record("most voices playing at once", most, "voices", 32);
  record("sounds started in 20 s", sounds.mixer.stats.started, "sounds");
  record("sounds dropped for want of a voice", sounds.mixer.stats.dropped, "sounds");
}
