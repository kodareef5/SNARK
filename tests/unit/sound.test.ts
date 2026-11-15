// Sounds: the pack's format and its tool, the library that holds them within a budget, the voices they play on, and
// what a creature is heard doing, from the state its snapshots carry.

import { expect, test } from "bun:test";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, CUE_LAND, CUE_STARTLE, CUE_TORPOR, LAYER_FLINCH, bodySeed } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { decodeTake, encodeTake, takeBytes, type ManifestSound } from "../../shared/pack/sound.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { buildProvingHeightfield, PROVING_POOL } from "../../shared/world/proving.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { GROUND_GRASS, GROUND_SAND, GROUND_STONE, groundAt } from "../../client/core/sound/ground.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { KIND_STEP, KIND_VOCAL, Mixer, VOICES } from "../../client/core/sound/mixer.ts";
import { SoundPacket, type SoundSink } from "../../client/core/sound/packet.ts";
import { distanceGain, earAxes, lowpassAt } from "../../client/core/sound/place.ts";
import { Sounds } from "../../client/core/sound/sounds.ts";
import { SOUND_SLOT, SplitPort } from "../../client/core/sound/split.ts";
import { bodyDown, groundPecks, mouthOpens, strikeAt } from "../../client/core/sound/timing.ts";
import { codingSnr, loudness, prepareTake, readWav, toPcm16, writeWav } from "../../tools/pack/sound.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { corePack } from "../fixtures/pack.ts";
import { builtSounds, chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const DODO = reg.index.get("core:dodo")!;
const rig = buildRigs(corePack().header.rigs, corePack().clips).get("core:dodo")!;
const anim = new CreatureAnim(rig, reg.runAt[DODO]!, reg.move[DODO]?.swimSpeed ?? 0);

test("a take coded as IMA ADPCM comes back within 30 dB of what went in, and a short or broken one is refused", () => {
  const pcm = toPcm16(chirp(0.5, 32000));
  const coded = new Uint8Array(takeBytes(pcm.length));
  expect(encodeTake(pcm, coded)).toBe(coded.length);
  expect(coded.length).toBe(4 + Math.ceil((pcm.length - 1) / 2));
  expect(codingSnr(pcm, coded)).toBeGreaterThan(30);
  const out = new Float32Array(pcm.length);
  expect(decodeTake(coded.subarray(0, coded.length - 1), pcm.length, out)).toBe(false);
  const broken = coded.slice();
  broken[2] = 89;
  expect(decodeTake(broken, pcm.length, out)).toBe(false);
});

test("a WAV of 16, 24 or 32 bits, or of floats, reads back; a take is cut, levelled to its sheet and kept under -1 dB", () => {
  const x = chirp(0.3, 48000, 0.25);
  const wav = writeWav(x, 48000);
  const back = readWav(wav);
  expect(back.rate).toBe(48000);
  expect(back.channels[0]!.length).toBe(x.length);
  expect(Math.abs(back.channels[0]![1000]! - x[1000]!)).toBeLessThan(1e-4);
  // The same as 24-bit stereo and as floats, written by hand.
  const frames = 100;
  const f24 = new Uint8Array(44 + frames * 6);
  const v = new DataView(f24.buffer);
  f24.set(wav.subarray(0, 44));
  v.setUint16(22, 2, true);
  v.setUint16(34, 24, true);
  v.setUint32(40, frames * 6, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
    const s = Math.round((c === 0 ? 0.5 : -0.25) * 8388607);
    v.setUint8(44 + i * 6 + c * 3, s & 255);
    v.setUint8(44 + i * 6 + c * 3 + 1, (s >> 8) & 255);
    v.setUint8(44 + i * 6 + c * 3 + 2, (s >> 16) & 255);
  }
  const r24 = readWav(f24);
  expect(r24.channels.length).toBe(2);
  expect(r24.channels[1]![5]).toBeCloseTo(-0.25, 5);
  const flt = new Uint8Array(44 + 8);
  flt.set(wav.subarray(0, 44));
  const fv = new DataView(flt.buffer);
  fv.setUint16(20, 3, true);
  fv.setUint16(34, 32, true);
  fv.setUint32(40, 8, true);
  fv.setFloat32(44, 0.75, true);
  fv.setFloat32(48, -1, true);
  expect(Array.from(readWav(flt).channels[0]!)).toEqual([0.75, -1]);
  expect(() => readWav(new Uint8Array(12))).toThrow();

  const take = prepareTake(back, { file: "", start: 0.05, end: 0.25 }, { level: -20, rate: 32000 });
  expect(take.samples.length).toBe(Math.floor(0.2 * 48000 * (32000 / 48000)));
  expect(loudness(take.samples, 32000)).toBeCloseTo(-20, 0);
  // Faded at both ends.
  expect(Math.abs(take.samples[0]!)).toBeLessThan(0.01);
  expect(Math.abs(take.samples[take.samples.length - 1]!)).toBeLessThan(0.01);
  const loud = prepareTake(back, { file: "" }, { level: 0, rate: 32000 });
  expect(loud.limited).toBe(true);
  expect(Math.max(...loud.samples.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
});

const made = builtSounds();
const built = { file: made.file, manifest: parseManifest(JSON.stringify({ version: 3, files: [{ name: "boot", bytes: 0, role: "boot" }, { name: "sounds", bytes: made.file.length, role: "sound" }], boot: 0, clipHash: 0, meshes: [], sounds: made.sounds })) };

test("the build names each sound by its owner and occasion, and a manifest that says a wrong thing of one is refused", () => {
  const ids = built.manifest.sounds!.map((s) => s.id);
  expect(ids).toContain("core:dodo/sound/call");
  expect(ids).toContain("core:dodo/sound/step/grass");
  const call = built.manifest.sounds!.find((s) => s.id === "core:dodo/sound/call")!;
  expect(call.takes.map((t) => t.from)).toEqual(["moss", "stable"]);
  expect(call.rate).toBe(32000);
  const wrong = (change: (s: ManifestSound) => void): string => {
    const m = structuredClone(built.manifest);
    change(m.sounds![0]!);
    return JSON.stringify(m);
  };
  expect(() => parseManifest(wrong((s) => (s.file = 0)))).toThrow("holds no sounds");
  expect(() => parseManifest(wrong((s) => (s.takes[0]!.bytes += 1)))).toThrow("size");
  expect(() => parseManifest(wrong((s) => (s.at = built.file.length)))).toThrow("outside");
  expect(() => parseManifest(wrong((s) => (s.id = "dodo call")))).toThrow("named");
});

test("the library asks for what is wanted two at a time, nearest first, decodes it, and lets go of the least lately used to stay in budget", () => {
  const net = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 20, bytesPerSecond: 1e6 });
  const lib = new SoundLibrary(built.manifest, net);
  const p = new SoundPacket();
  const n = lib.sounds.length;
  let now = 0;
  const frame = (want: (s: number) => number): void => {
    now += 16;
    net.advance(now);
    p.clear();
    lib.begin(now, p);
    for (let s = 0; s < n; s++) if (want(s) > 0) lib.want(s, want(s));
    lib.end(p);
  };
  frame((s) => s + 1);
  expect(lib.flying).toBe(2);
  expect(net.mostAtOnce).toBeLessThanOrEqual(2);
  // The most urgent first: the two of highest number.
  expect(net.log.slice(0, 2).join(" ")).toContain(String(SOUND_SLOT + n - 1));
  let loads = 0;
  for (let k = 0; k < 60; k++) {
    frame((s) => s + 1);
    loads += p.loads.length;
  }
  expect([...Array(n).keys()].every((s) => lib.ready(s))).toBe(true);
  expect(loads).toBe(built.manifest.sounds!.reduce((sum, s) => sum + s.takes.length, 0));
  const one = p.loads;
  expect(one.length).toBe(0);
  // A smaller budget lets go of those not wanted for a while, the least lately used first, and keeps the one still wanted.
  lib.budget = lib.used / 3;
  for (let k = 0; k < 250; k++) frame((s) => (s === 0 ? 1 : 0));
  expect(lib.ready(0)).toBe(true);
  expect(lib.used).toBeLessThanOrEqual(lib.budget);
  expect(lib.stats.evicted).toBeGreaterThan(0);
});

test("a request that fails is asked again later, one whose bytes are wrong twice is given up, and one nobody wants is cancelled", () => {
  const net = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 10, bytesPerSecond: 1e6, loss: 1, seed: 3 });
  const lib = new SoundLibrary(built.manifest, net);
  const p = new SoundPacket();
  let now = 0;
  const frame = (wanted: boolean): void => {
    now += 16;
    net.advance(now);
    p.clear();
    lib.begin(now, p);
    if (wanted) lib.want(0, 1);
    lib.end(p);
  };
  for (let k = 0; k < 20; k++) frame(true);
  expect(lib.stats.failed).toBeGreaterThan(0);
  const asked = lib.stats.requests;
  // Waiting a second or so, not asking every frame.
  for (let k = 0; k < 20; k++) frame(true);
  expect(lib.stats.requests).toBeLessThanOrEqual(asked + 1);
  net.loss = 0;
  for (let k = 0; k < 200; k++) frame(true);
  expect(lib.ready(0)).toBe(true);

  // Bytes that never match their hash.
  const spoilt = built.file.slice();
  for (let i = 8; i < spoilt.length; i++) spoilt[i] ^= 0x55;
  const bad = new SoundLibrary(built.manifest, new FakeNet([new Uint8Array(0), spoilt], { latencyMs: 1, bytesPerSecond: 1e7 }));
  const badNet = (bad as unknown as { port: FakeNet }).port;
  for (let k = 0; k < 40; k++) {
    now += 16;
    badNet.advance(now);
    p.clear();
    bad.begin(now, p);
    bad.want(0, 1);
    bad.end(p);
  }
  expect(bad.stats.dead).toBe(1);
  expect(bad.ready(0)).toBe(false);

  const slow = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 60000 });
  const idle = new SoundLibrary(built.manifest, slow);
  now = 0;
  for (let k = 0; k < 300; k++) {
    now += 16;
    p.clear();
    idle.begin(now, p);
    if (k < 5) idle.want(0, 1);
    idle.end(p);
  }
  expect(idle.stats.cancelled).toBe(1);
  expect(slow.cancelled.has(SOUND_SLOT)).toBe(true);
});

test("a port shared by meshes and sounds gives each side only what it asked for", () => {
  const net = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 1, bytesPerSecond: 1e7 });
  const split = new SplitPort(net);
  const part = (s: ManifestSound) => ({ offset: s.at, length: s.takes[0]!.bytes, hash: s.takes[0]!.hash });
  split.assets.request({ slot: 3, file: 1, parts: [part(built.manifest.sounds![0]!)], priority: 1, fresh: false });
  split.sounds.request({ slot: SOUND_SLOT + 1, file: 1, parts: [part(built.manifest.sounds![1]!)], priority: 1, fresh: false });
  net.advance(100);
  const got: { slot: number }[] = [];
  expect(split.sounds.take(got as never)).toBe(1);
  expect(got[0]!.slot).toBe(SOUND_SLOT + 1);
  expect(split.assets.take(got as never)).toBe(1);
  expect(got[0]!.slot).toBe(3);
});

test("loudness is full near, halves with each doubling of distance, and is gone at the range; the far is duller; the ear's right is its facing cross up", () => {
  expect(distanceGain(0, 40)).toBe(1);
  expect(distanceGain(2.4, 40)).toBe(1);
  expect(distanceGain(9.6, 40)).toBeCloseTo(0.25, 5);
  expect(distanceGain(40, 40)).toBe(0);
  let last = 2;
  for (let d = 0; d <= 41; d += 0.5) {
    expect(distanceGain(d, 40)).toBeLessThanOrEqual(last);
    last = distanceGain(d, 40);
  }
  expect(lowpassAt(0, 40)).toBe(20000);
  expect(lowpassAt(40, 40)).toBeCloseTo(5000, 5);
  // Facing +Z, the right is -X, as the game has it.
  const e = [0, 0, 0, 0, 0, 0];
  earAxes(0, 0, e);
  const right = [e[1]! * e[5]! - e[2]! * e[4]!, e[2]! * e[3]! - e[0]! * e[5]!, e[0]! * e[4]! - e[1]! * e[3]!];
  expect(right.map((v) => Math.round(v))).toEqual([-1, 0, 0]);
  earAxes(1.1, 0.4, e);
  expect(e[0]! * e[3]! + e[1]! * e[4]! + e[2]! * e[5]!).toBeCloseTo(0, 9);
});

test("forty dodos startled at once are heard as the nearest five, the quietest steps give way first, and a creature cries with one mouth", () => {
  const m = new Mixer();
  const p = new SoundPacket();
  const ear = { x: 0, y: 0, z: 0 };
  // Forty squawks of one sound, from 2 to 41 metres.
  for (let k = 0; k < 40; k++) m.play(p, ear, 0, 1, 0, 1, 60, KIND_VOCAL, 0.9, 100 + k, 2 + ((k * 17) % 40), 0, 0, 0, 1, 1, 0);
  const near = [...Array(VOICES).keys()].filter((v) => m.serial[v] !== 0 && m.sound[v] === 1).map((v) => m.x[v]!);
  expect(near.length).toBe(5);
  expect(Math.max(...near)).toBeLessThanOrEqual(6);
  // Steps fill their share. A nearer step takes the place of the farthest, and a farther one is dropped.
  for (let k = 0; k < 12; k++) m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 3 + k, 0, 0, 0, 1, 1, 0);
  const steps = (): number[] => [...Array(VOICES).keys()].filter((v) => m.serial[v] !== 0 && m.kind[v] === KIND_STEP).map((v) => m.x[v]!);
  expect(steps().length).toBe(10);
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 19, 0, 0, 0, 1, 1, 0)).toBe(false);
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 1, 0, 0, 0, 1, 1, 0)).toBe(true);
  expect(steps()).toContain(1);
  expect(steps()).not.toContain(14);
  // Out of range is not started at all.
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 30, 0, 0, 0, 1, 1, 0)).toBe(false);
  // A call cut short by its creature's pain; a call is not let cut a cry.
  const before = p.stops.length;
  expect(m.play(p, ear, 0, 3, 2, 1, 40, KIND_VOCAL, 0.4, 500, 5, 0, 0, 0, 1, 1, 0)).toBe(true);
  expect(m.play(p, ear, 0, 4, 3, 1, 40, KIND_VOCAL, 0.9, 500, 5, 0, 0, 0, 1, 1, 0)).toBe(true);
  expect(p.stops.length).toBe(before + 1);
  expect(m.play(p, ear, 0, 3, 2, 1, 40, KIND_VOCAL, 0.4, 500, 5, 0, 0, 0, 1, 1, 0)).toBe(false);
  // Voices end with their sound.
  m.expire(5000);
  expect(m.playing).toBe(0);
});

test("the ground under a foot: the plaza is stone, the pool's low rim sand, the open land grass", () => {
  const hf = buildProvingHeightfield();
  expect(groundAt(hf, 256, 0, 256)).toBe(GROUND_STONE);
  expect(groundAt(hf, 380, hf.heightAt(380, 380), 380)).toBe(GROUND_GRASS);
  expect(groundAt(hf, PROVING_POOL.x - 22, hf.heightAt(PROVING_POOL.x - 22, PROVING_POOL.z), PROVING_POOL.z)).toBe(GROUND_SAND);
});

test("when a sound belongs in the dodo's clips is read from its motion: the peck lands early, the ground pecks two or three times, the call opens its beak", () => {
  const strike = strikeAt(rig, anim.attack);
  expect(strike).toBeGreaterThan(0);
  expect(strike).toBeLessThan((anim.attack!.frames - 1) / TICK_RATE / 1.5);
  const pecks = groundPecks(rig, rig.clips.get("idle_peck")!);
  expect(pecks.length).toBeGreaterThanOrEqual(2);
  expect(pecks.length).toBeLessThanOrEqual(3);
  const call = rig.clips.get("call")!;
  const opens = mouthOpens(rig, call);
  expect(opens).toBeGreaterThan(0);
  expect(opens).toBeLessThan(call.frames / TICK_RATE / 2);
  const down = bodyDown(rig, anim.torporIn);
  expect(down).toBeGreaterThan(0.2);
  expect(down).toBeLessThan(anim.torporIn!.frames / TICK_RATE);
});

/** A sink that plays at once and keeps what it was told. */
class Ears implements SoundSink {
  running = true;
  readonly starts: number[][] = [];
  apply(p: SoundPacket): void {
    for (let i = 0; i < p.starts.length; i += 9) this.starts.push(p.starts.slice(i, i + 9));
  }
}

test("a dodo is heard as its state changes: startled, landing, hurt, pecking, knocked down, calling now and then, stepping, and dying", () => {
  const net = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 1, bytesPerSecond: 1e8 });
  const sounds = new Sounds(built.manifest, net, reg, (k) => (k === DODO ? anim : null));
  const lib = sounds.library;
  const name = (buffer: number): string => {
    const s = [...lib.first].findLastIndex((f) => f <= buffer);
    return lib.sounds[s]!.id.slice("core:dodo/sound/".length);
  };
  const hf = buildProvingHeightfield();
  const remote = new RemoteSample();
  const ears = new Ears();
  const st = new AnimState();
  let tick = 1000;
  let now = 0;
  const id = 77;
  let x = 380;
  const z = 380;
  const y = hf.heightAt(x, z);
  const ear = { x: 377, y: y + 1.6, z: 380, yaw: 0, pitch: 0 };
  const heard: string[] = [];
  const frame = (alive = true): void => {
    now += 1000 / 30;
    tick += 1;
    net.advance(now);
    remote.count = alive ? 1 : 0;
    remote.id[0] = id;
    remote.kind[0] = DODO;
    remote.x[0] = x;
    remote.y[0] = y;
    remote.z[0] = z;
    remote.yaw[0] = Math.PI / 2;
    remote.anim[0] = st.pack();
    remote.cue[0] = st.packCue();
    remote.tick = tick;
    ears.starts.length = 0;
    sounds.frame(ears, now, remote, hf, ear, 1);
    for (const s of ears.starts) heard.push(name(s[1]!));
  };
  st.seed = bodySeed(id);
  // Standing within hearing, until every sound is held.
  for (let k = 0; k < 30; k++) frame();
  heard.length = 0;
  const cue = (c: number): void => {
    st.cue = c;
    st.cueStart = tick & 255;
    frame();
    frame();
  };
  cue(CUE_STARTLE);
  expect(heard).toEqual(["startled"]);
  cue(CUE_LAND);
  expect(heard.slice(1)).toEqual(["land"]);
  st.cue = 0;
  st.layer = LAYER_FLINCH;
  st.layerStart = tick & 255;
  frame();
  expect(heard.slice(2)).toEqual(["hurt"]);
  st.layer = 0;
  st.setAction(ACT_SWING, 0, tick);
  frame();
  frame();
  expect(heard.slice(3)).toEqual(["peck"]);
  st.setAction(0, 0, 0);
  // Once its pain has been cried: a cry that weighs less than one still sounding from the same mouth is not heard.
  for (let k = 0; k < 20; k++) frame();
  st.out = true;
  cue(CUE_TORPOR);
  // Knocked out: no sound of its own, so its pain stands in, then its body thumps.
  expect(heard.slice(4)).toEqual(["hurt", "land"]);
  st.out = false;
  st.cue = 0;

  // Standing for a minute, it calls now and then, at the start of a turn of its idle.
  heard.length = 0;
  for (let k = 0; k < 60 * TICK_RATE; k++) frame();
  const calls = heard.filter((h) => h === "call").length;
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(calls).toBeLessThanOrEqual(10);
  expect(heard.every((h) => h === "call" || h === "peck")).toBe(true);

  // Walking 7 metres at its walking speed, a step for every half stride.
  heard.length = 0;
  const speed = 0.65;
  st.setMotion(-speed, 0, Math.PI / 2, 0);
  const walked = 7;
  for (let k = 0; k < (walked / speed) * TICK_RATE; k++) {
    x -= speed / TICK_RATE;
    ear.x = x - 3;
    frame();
  }
  // Its feet go as they are drawn: a little under the walk's own speed, the walk shares with the idle and strides shorter.
  const steps = heard.filter((h) => h.startsWith("step")).length;
  const stride = rig.strides.get("walk")!;
  expect(steps).toBeGreaterThanOrEqual(Math.floor((walked / stride) * 2) - 2);
  expect(steps).toBeLessThanOrEqual(Math.ceil((walked / (stride * 0.85)) * 2) + 2);

  // Leaving the view as the server says it died: its pain stands in for its death cry, and its body thumps.
  heard.length = 0;
  st.setMotion(0, 0, 0, 0);
  frame();
  remote.died = new Map([[id, tick]]);
  frame(false);
  expect(heard).toEqual(["hurt", "land"]);
  frame(false);
  expect(heard.length).toBe(2);
});
