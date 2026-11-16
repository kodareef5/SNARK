// Sounds: the pack's format and its tool, the library that holds them within a budget, the voices they play on, and
// what a creature is heard doing, from the state its snapshots carry.

import { expect, test } from "bun:test";
import { CreatureAnim } from "../../shared/anim/creature.ts";
import { AnimState, CUE_DEAD, CUE_HELD, CUE_LAND, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, LAYER_FLINCH, bodySeed } from "../../shared/anim/pose.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { flyerAnim } from "../fixtures/flyer/flyer.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { CODE_LOSSLESS, decodeTake, encodeTake, takeFits, type ManifestSound } from "../../shared/pack/sound.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { buildProvingHeightfield, PROVING_POOL } from "../../shared/world/proving.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { GROUND_GRASS, GROUND_SAND, GROUND_STONE, groundAt } from "../../client/core/sound/ground.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { KIND_STEP, KIND_VOCAL, LOOP, Mixer, VOICES } from "../../client/core/sound/mixer.ts";
import { MOVE_FIELDS, START_FIELDS, SoundPacket, type SoundSink } from "../../client/core/sound/packet.ts";
import { distanceGain, earAxes, lowpassAt } from "../../client/core/sound/place.ts";
import { Sounds } from "../../client/core/sound/sounds.ts";
import { SOUND_SLOT, SplitPort } from "../../client/core/sound/split.ts";
import { bodyDown, groundPecks, mouthOpens, strikeAt } from "../../client/core/sound/timing.ts";
import { buildSounds, loudness, prepareTake, readWav, toPcm16, writeWav } from "../../tools/pack/sound.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeNet } from "../fixtures/assetnet.ts";
import { corePack } from "../fixtures/pack.ts";
import { builtSounds, chirp } from "../fixtures/sounds.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const DODO = reg.index.get("core:dodo")!;
const rig = buildRigs(corePack().header.rigs, corePack().clips).get("core:dodo")!;
const anim = new CreatureAnim(rig, reg.runAt[DODO]!, reg.move[DODO]?.swimSpeed ?? 0);

/** Takes hard and easy for a coder: a chirp, bursts of noise, silence, a full-scale square, and the shortest there are. */
function hardTakes(): Int16Array[] {
  let seed = 3;
  const noise = new Float32Array(9001);
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    noise[i] = 0.9 * (seed / 2 ** 31 - 1) * Math.exp(-((i % 4000) / 600));
  }
  const square = Int16Array.from({ length: 5000 }, (_, i) => ((i >> 5) & 1 ? 32767 : -32768));
  return [toPcm16(chirp(0.5, 32000)), toPcm16(noise), new Int16Array(4097), square, Int16Array.from([5]), Int16Array.from([-3, 7]), Int16Array.from([1, -1, 300, -32768, 32767])];
}

test("the lossless code gives back every sample of hard and easy takes alike, and refuses a stream cut short or of another code", () => {
  for (const pcm of hardTakes()) {
    const coded = encodeTake(pcm);
    expect(coded[0]).toBe(CODE_LOSSLESS);
    expect(takeFits(pcm.length, coded.length)).toBe(true);
    const out = new Float32Array(pcm.length);
    expect(decodeTake(coded, pcm.length, out)).toBe(true);
    expect(Array.from(out, (v) => Math.round(v * 32768))).toEqual(Array.from(pcm));
    if (pcm.length > 100) expect(decodeTake(coded.subarray(0, coded.length >> 1), pcm.length, out)).toBe(false);
    const other = coded.slice();
    other[0] = 1;
    expect(decodeTake(other, pcm.length, out)).toBe(false);
  }
  // A clean tone takes under a third of the bytes of its 16-bit samples, and silence next to none.
  const [chirped, , silence] = hardTakes() as [Int16Array, Int16Array, Int16Array];
  const hum = Int16Array.from({ length: 16000 }, (_, i) => Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / 32000)));
  expect(encodeTake(hum).length).toBeLessThan(hum.length * 2 * 0.33);
  expect(encodeTake(silence).length).toBeLessThan(silence.length / 6);
  // Low bits every sample leaves zero are not stored: the same take two bits coarser is smaller.
  const coarse = chirped.map((v) => v & ~3);
  expect(encodeTake(coarse).length).toBeLessThan(encodeTake(chirped).length - chirped.length / 5);
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
  expect(() => parseManifest(wrong((s) => (s.takes[0]!.bytes = 4)))).toThrow("size");
  expect(() => parseManifest(wrong((s) => (s.at = built.file.length)))).toThrow("outside");
  expect(() => parseManifest(wrong((s) => (s.id = "dodo call")))).toThrow("named");
});

test("the build refuses a sound every client would refuse: one named as no id may be, or two folders that are one owner", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-owners-"));
  try {
    const sheet = (folder: string, sounds: Record<string, unknown>): void => {
      const dir = join(root, "core", folder, "sound");
      mkdirSync(join(dir, "takes"), { recursive: true });
      writeFileSync(join(dir, "takes", "a.wav"), writeWav(chirp(0.2, 32000), 32000));
      writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds }));
    };
    const one = { range: 20, level: -20, takes: [{ file: "takes/a.wav" }] };
    sheet("structures/wood", { place: one });
    expect(() => buildSounds(1, root, null)).not.toThrow();
    sheet("nodes/wood", { felled: one });
    expect(() => buildSounds(1, root, null)).toThrow("core:wood");
    rmSync(join(root, "core", "nodes"), { recursive: true });
    sheet("structures/stone", { "Hit-Hard": one });
    expect(() => buildSounds(1, root, null)).toThrow("Hit-Hard");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("a sound is held two takes at first and one more for each start, and past two its takes give way to a sound not yet held", () => {
  const root = mkdtempSync(join(tmpdir(), "snark-takes-"));
  try {
    const dir = join(root, "core", "creatures", "dodo", "sound");
    mkdirSync(join(dir, "takes"), { recursive: true });
    const takes = [0, 1, 2, 3, 4, 5].map((k) => {
      writeFileSync(join(dir, "takes", `${k}.wav`), writeWav(chirp(0.5 + k * 0.05, 32000), 32000));
      return { file: `takes/${k}.wav` };
    });
    writeFileSync(join(dir, "sounds.json"), JSON.stringify({ sounds: { call: { range: 40, level: -20, takes }, hurt: { range: 40, level: -20, takes } } }));
    const six = buildSounds(1, root, null)!;
    const net = new FakeNet([new Uint8Array(0), six.bytes], { latencyMs: 1, bytesPerSecond: 1e8 });
    const lib = new SoundLibrary({ sounds: six.sounds }, net);
    const call = lib.index.get("core:dodo/sound/call")!;
    const hurt = lib.index.get("core:dodo/sound/hurt")!;
    const p = new SoundPacket();
    const unloads: number[] = [];
    let now = 0;
    const frames = (n: number, wanted: number[]): void => {
      for (let k = 0; k < n; k++) {
        now += 16;
        net.advance(now);
        p.clear();
        lib.begin(now, p);
        for (const s of wanted) lib.want(s, 1);
        lib.end(p);
        unloads.push(...p.unloads);
      }
    };
    frames(30, [call]);
    expect(lib.takes(call)).toBe(2);
    expect(net.log.filter((l) => l.includes(" ask ")).map((l) => l.split(" ").at(-1))).toEqual(["x2"]);
    for (let k = 0; k < 9; k++) lib.grow(call);
    frames(30, [call]);
    expect(lib.takes(call)).toBe(6);
    expect(net.log.filter((l) => l.includes(" ask ")).map((l) => l.split(" ").at(-1))).toEqual(["x2", "x4"]);
    // Two takes of the hurt do not fit beside the six of the call, so the call keeps two and the hurt is held.
    lib.budget = lib.used + 1000;
    frames(30, [call, hurt]);
    expect([lib.takes(call), lib.takes(hurt)]).toEqual([2, 2]);
    expect(unloads.sort((a, b) => a - b)).toEqual([2, 3, 4, 5].map((k) => lib.first[call]! + k));
    expect(lib.used).toBeLessThanOrEqual(lib.budget);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 19, 0, 0, 0, 1, 1, 0)).toBe(0);
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 1, 0, 0, 0, 1, 1, 0)).toBeGreaterThan(0);
  expect(steps()).toContain(1);
  expect(steps()).not.toContain(14);
  // Out of range is not started at all.
  expect(m.play(p, ear, 0, 2, 1, 0.2, 20, KIND_STEP, 0.25, -1, 30, 0, 0, 0, 1, 1, 0)).toBe(0);
  // A call cut short by its creature's pain; a call is not let cut a cry.
  expect(m.play(p, ear, 0, 3, 2, 1, 40, KIND_VOCAL, 0.4, 500, 5, 0, 0, 0, 1, 1, 0)).toBeGreaterThan(0);
  p.clear();
  expect(m.play(p, ear, 0, 4, 3, 1, 40, KIND_VOCAL, 0.9, 500, 5, 0, 0, 0, 1, 1, 0)).toBeGreaterThan(0);
  expect(p.stops.length).toBe(1);
  expect(m.play(p, ear, 0, 3, 2, 1, 40, KIND_VOCAL, 0.4, 500, 5, 0, 0, 0, 1, 1, 0)).toBe(0);
  // Voices end with their sound.
  m.expire(5000);
  expect(m.playing).toBe(0);
});

test("a voice is moved on the device only when the change is heard: past 2 degrees, 0.5 dB or 5% of its dullness, and where a fade comes to rest", () => {
  const m = new Mixer();
  const p = new SoundPacket();
  const ear = { x: 0, y: 0, z: 0 };
  const at = [10, 0, 0];
  const locate = (_e: number, out: number[]): boolean => ((out[0] = at[0]!), (out[1] = at[1]!), (out[2] = at[2]!), true);
  const follow = (): number[] => {
    p.clear();
    m.follow(p, ear, locate);
    return p.moves.slice();
  };
  const serial = m.play(p, ear, 0, 1, 0, 1, 40, KIND_VOCAL, 1, 7, 10, 0, 0, 0, 1, 1, 0, LOOP);
  expect(follow()).toEqual([]);
  // A tenth of a metre at ten metres is half a degree.
  at[2] = 0.1;
  expect(follow()).toEqual([]);
  at[2] = 1;
  expect(follow().length).toBe(MOVE_FIELDS);
  expect(follow()).toEqual([]);
  // A small step of a fade is not sent, and where the fade stops its gain is.
  m.gain(serial, 0.97);
  expect(follow()).toEqual([]);
  const rest = follow();
  expect(rest[1]).toBeCloseTo(0.97 * distanceGain(Math.hypot(10, 1), 40), 6);
  expect(follow()).toEqual([]);
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
    for (let i = 0; i < p.starts.length; i += START_FIELDS) this.starts.push(p.starts.slice(i, i + START_FIELDS));
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
    sounds.frame(ears, now, remote, hf, ear, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 });
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
  // Once its squawk is over: a cry that weighs less than one still sounding from the same mouth is not heard.
  for (let k = 0; k < 20; k++) frame();
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

/** A Sounds hearing one remote body, stepped a frame at a time, with the names of what it started. */
function hearOne(kind: number, setup: (remote: RemoteSample, i: number) => void): { frame: (move?: () => void) => void; heard: string[]; st: AnimState; remote: RemoteSample } {
  const net = new FakeNet([new Uint8Array(0), built.file], { latencyMs: 1, bytesPerSecond: 1e8 });
  const sounds = new Sounds(built.manifest, net, reg, (k) => (k === DODO ? anim : null));
  const lib = sounds.library;
  const hf = buildProvingHeightfield();
  const remote = new RemoteSample();
  const ears = new Ears();
  const st = new AnimState();
  const heard: string[] = [];
  let tick = 1000;
  let now = 0;
  remote.count = 1;
  remote.id[0] = 91;
  remote.kind[0] = kind;
  remote.x[0] = 380;
  remote.z[0] = 380;
  remote.y[0] = hf.heightAt(380, 380);
  st.seed = bodySeed(91);
  setup(remote, 0);
  const frame = (move?: () => void): void => {
    now += 1000 / 30;
    tick += 1;
    net.advance(now);
    move?.();
    remote.anim[0] = st.pack();
    remote.cue[0] = (remote.cue[0]! & (CUE_DEAD | CUE_HELD)) | st.packCue();
    remote.tick = tick;
    ears.starts.length = 0;
    sounds.frame(ears, now, remote, hf, { x: remote.x[0]! - 3, y: remote.y[0]! + 1.6, z: 380, yaw: 0, pitch: 0 }, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 });
    for (const s of ears.starts) heard.push(lib.sounds[[...lib.first].findLastIndex((f) => f <= s[1]!)]!.id.slice("core:dodo/sound/".length));
  };
  return { frame, heard, st, remote };
}

test("a dodo's body lying dead never calls or pecks, however long it lies in view", () => {
  const { frame, heard } = hearOne(DODO, (remote) => (remote.cue[0] = CUE_DEAD));
  for (let k = 0; k < 90 * TICK_RATE; k++) frame();
  expect(heard).toEqual([]);
});

test("a dodo carried in a survivor's arms takes no steps of its own as its carrier walks", () => {
  const { frame, heard, st, remote } = hearOne(DODO, (r) => (r.cue[0] = CUE_HELD));
  for (let k = 0; k < 30; k++) frame();
  heard.length = 0;
  // The server gives a held body its carrier's speed, and says it stands on something.
  st.setMotion(-1.2, 0, Math.PI / 2, 0);
  for (let k = 0; k < 8 * TICK_RATE; k++) frame(() => (remote.x[0]! -= 1.2 / TICK_RATE));
  expect(heard.filter((h) => h.startsWith("step"))).toEqual([]);
});

test("a voice taken over in the frame it was started never reaches the device, which stops before it starts", () => {
  const m = new Mixer();
  const p = new SoundPacket();
  const ear = { x: 0, y: 0, z: 0 };
  // client/sound carries out a packet's stops, then its starts.
  const device = new Set<number>();
  const apply = (): void => {
    for (const s of p.stops) device.delete(s);
    for (let i = 0; i < p.starts.length; i += START_FIELDS) device.add(p.starts[i]!);
    p.clear();
  };
  // Forty squawks in one frame, the nearest last, and two cries of one mouth.
  for (let k = 0; k < 40; k++) m.play(p, ear, 0, 1, 0, 1, 60, KIND_VOCAL, 0.9, 100 + k, 50 - k, 0, 0, 0, 1, 1, 0);
  m.play(p, ear, 0, 2, 1, 1, 60, KIND_VOCAL, 0.5, 7, 3, 0, 0, 0, 1, 1, 0);
  m.play(p, ear, 0, 3, 2, 1, 60, KIND_VOCAL, 0.9, 7, 3, 0, 0, 0, 1, 1, 0);
  apply();
  expect(device.size).toBe(m.playing);
  const live = new Set([...m.serial].filter((s) => s !== 0));
  expect([...device].sort()).toEqual([...live].sort());
  // Across frames a voice taken over is stopped as before.
  for (let k = 0; k < 5; k++) m.play(p, ear, 0, 1, 0, 1, 60, KIND_VOCAL, 0.9, 200 + k, 1, 0, 0, 0, 1, 1, 0);
  expect(p.stops.length).toBe(5);
  apply();
  expect(device.size).toBe(m.playing);
});

test("a pteranodon is heard flapping once a beat of its flight, twice flying fast, and as it takes off; never on still wings or standing", () => {
  const flaps = builtSounds(1, false, true);
  const manifest = parseManifest(JSON.stringify({ version: 3, files: [{ name: "boot", bytes: 0, role: "boot" }, { name: "sounds", bytes: flaps.file.length, role: "sound" }], boot: 0, clipHash: 0, meshes: [], sounds: flaps.sounds }));
  const net = new FakeNet([new Uint8Array(0), flaps.file], { latencyMs: 1, bytesPerSecond: 1e8 });
  const ptera = reg.index.get("core:pteranodon")!;
  const flyer = flyerAnim();
  const sounds = new Sounds(manifest, net, reg, (k) => (k === ptera ? flyer : null));
  const lib = sounds.library;
  const hf = buildProvingHeightfield();
  const remote = new RemoteSample();
  const ears = new Ears();
  const st = new AnimState();
  let tick = 1000;
  let now = 0;
  remote.count = 1;
  remote.id[0] = 91;
  remote.kind[0] = ptera;
  [remote.x[0], remote.y[0], remote.z[0]] = [380, hf.heightAt(380, 380) + 10, 380];
  st.seed = bodySeed(91);
  const run = (ticks: number): string[] => {
    const heard: string[] = [];
    for (let k = 0; k < ticks; k++) {
      now += 1000 / 30;
      tick += 1;
      net.advance(now);
      remote.anim[0] = st.pack();
      remote.cue[0] = st.packCue();
      remote.tick = tick;
      ears.starts.length = 0;
      sounds.frame(ears, now, remote, hf, { x: 377, y: remote.y[0]! + 1.6, z: 380, yaw: 0, pitch: 0 }, { master: 1, effects: 1, ambience: 1, music: 1, interface: 1 });
      for (const s of ears.starts) heard.push(lib.sounds[[...lib.first].findLastIndex((f) => f <= s[1]!)]!.id);
    }
    return heard;
  };
  // Standing until its sounds are held, then taking off.
  run(30);
  expect(run(30)).toEqual([]);
  st.mode = MODE_FLYER;
  st.grounded = false;
  st.cue = CUE_TAKEOFF;
  st.cueStart = tick & 255;
  expect(run(1)).toEqual(["core:pteranodon/sound/flap"]);
  st.cue = 0;
  // A beat is 30 ticks: hovering and flying, a flap a beat; flying fast, two; gliding, none.
  const flapped = (vz: number, pitch: number): number => {
    st.setMotion(0, vz, 0, pitch);
    run(2);
    return run(6 * TICK_RATE).length;
  };
  expect([flapped(0, 0), flapped(6, 0), flapped(16, 0), flapped(6, -0.4)]).toEqual([6, 6, 12, 0]);
});
