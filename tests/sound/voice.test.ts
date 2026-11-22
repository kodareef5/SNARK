import { expect, test } from "bun:test";
import { JitterBuffer, MAX_TARGET, MIN_TARGET, START_TARGET } from "../../client/core/voice/jitter.ts";
import { panLeft, panRight, voiceGain, voicePan } from "../../client/core/voice/place.ts";
import { Resampler } from "../../client/core/voice/resample.ts";
import { GATE_END, GATE_OPEN, GATE_SEND, GATE_SKIP, Gate, HANG_FRAMES, OPEN_LEVEL, PREROLL_FRAMES, TAIL_FRAMES, Uplink, frameLevel } from "../../client/core/voice/talk.ts";
import { Rng } from "../../shared/rng.ts";
import {
  AUDIO_HEADER,
  AUTH_BYTES,
  Batch,
  ENTRY_HEADER,
  FLAG_END,
  FLAG_LOOP,
  FRAME_SAMPLES,
  MAX_BATCH,
  MAX_OPUS,
  MODE_TALK,
  MODE_WHISPER,
  MODE_YELL,
  REACH_GLOBAL,
  REACH_LOCAL,
  REACH_TRIBE,
  VOICE_AUDIO,
  VOICE_AUTH,
  audio,
  flagsOf,
  flagsValid,
  modeOf,
  opusFrameValid,
  parseAudio,
  reachOf,
  readBatch,
  readIntro,
  seqNewer,
  writeAudio,
  writeAuth,
  writeIntro,
} from "../../shared/voice/packet.ts";

const F = FRAME_SAMPLES;
/** The first byte of a wideband, mono, single 20 ms frame, as a browser's encoder makes for speech. */
const TOC = 9 << 3;

/** Stand-in Opus: a valid first byte, then noise. */
function opus(rng: Rng, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 1; i < n; i++) out[i] = rng.int(256);
  if (n > 0) out[0] = TOC;
  return out;
}

/** Every sample encodes its frame number and its position in the frame, so played audio can be traced. */
function frame(f: number): Float32Array {
  const pcm = new Float32Array(F);
  for (let i = 0; i < F; i++) pcm[i] = f + i / F;
  return pcm;
}

test("an audio packet survives the wire, and only what a client may send is taken", () => {
  const rng = new Rng(2);
  const buf = new Uint8Array(AUDIO_HEADER + MAX_OPUS + 8);
  for (let i = 0; i < 400; i++) {
    const flags = flagsOf(rng.int(3), rng.int(3), rng.int(2) === 0, rng.int(2) === 0);
    const seq = rng.int(65536);
    const time = rng.int(2) === 0 ? rng.int(0x7fffffff) * 2 + 1 : rng.int(1000) * F;
    const body = opus(rng, i % (MAX_OPUS + 1));
    const n = writeAudio(buf, flags, seq, time, body);
    expect(n).toBe(AUDIO_HEADER + body.length);
    expect(parseAudio(buf.subarray(0, n))).toBe(true);
    expect([audio.flags, audio.seq, audio.time]).toEqual([flags, seq, time]);
    expect([...audio.opus]).toEqual([...body]);
  }
  const ok = buf.slice(0, writeAudio(buf, flagsOf(MODE_TALK, REACH_LOCAL, false, false), 1, F, opus(rng, 40)));
  const bad = (change: (p: Uint8Array) => Uint8Array): boolean => parseAudio(change(ok.slice()));
  expect(parseAudio(ok)).toBe(true);
  // Refused: another kind of packet, too short, too long, a reserved flag, and a mode or a reach that does not exist.
  expect(bad((p) => ((p[0] = VOICE_AUTH), p))).toBe(false);
  expect(bad((p) => p.subarray(0, AUDIO_HEADER - 1))).toBe(false);
  expect(parseAudio(new Uint8Array(AUDIO_HEADER + MAX_OPUS + 1).fill(VOICE_AUDIO, 0, 1))).toBe(false);
  expect(bad((p) => ((p[1]! |= 0x40), p))).toBe(false);
  expect(bad((p) => ((p[1]! |= 0x80), p))).toBe(false);
  expect(bad((p) => ((p[1] = 3 << 1), p))).toBe(false);
  expect(bad((p) => ((p[1] = 3 << 3), p))).toBe(false);
  // Opus that is not one mono 20 ms frame: stereo, two frames, 10 ms, 60 ms.
  for (const toc of [TOC | 4, TOC | 1, TOC | 3, 8 << 3, 11 << 3]) expect(bad((p) => ((p[AUDIO_HEADER] = toc), p))).toBe(false);
  // A bare header is a valid packet, because the end of an utterance needs no sound.
  expect(parseAudio(ok.subarray(0, AUDIO_HEADER))).toBe(true);
  expect(audio.opus.length).toBe(0);
});

test("flags say how loud, who for, the end, and whether to send it back; Opus's first byte says what kind of frame", () => {
  for (const mode of [MODE_WHISPER, MODE_TALK, MODE_YELL]) {
    for (const reach of [REACH_LOCAL, REACH_TRIBE, REACH_GLOBAL]) {
      for (const end of [false, true]) {
        for (const loop of [false, true]) {
          const flags = flagsOf(mode, reach, end, loop);
          expect(flagsValid(flags)).toBe(true);
          expect([modeOf(flags), reachOf(flags), (flags & FLAG_END) !== 0, (flags & FLAG_LOOP) !== 0]).toEqual([mode, reach, end, loop]);
        }
      }
    }
  }
  // The 20 ms configurations of RFC 6716's table, mono, one frame.
  const twenty = [1, 5, 9, 13, 15, 19, 23, 27, 31];
  for (let config = 0; config < 32; config++) {
    expect(opusFrameValid(config << 3)).toBe(twenty.includes(config));
    expect(opusFrameValid((config << 3) | 4)).toBe(false);
    for (const code of [1, 2, 3]) expect(opusFrameValid((config << 3) | code)).toBe(false);
  }
  // Sequence numbers wrap, so newer means the short way round.
  expect([seqNewer(1, 0), seqNewer(0, 1), seqNewer(5, 5), seqNewer(0, 65535), seqNewer(65535, 0), seqNewer(40000, 0), seqNewer(0, 40000)]).toEqual([true, false, false, true, false, false, true]);
});

test("a batch carries many speakers' frames in one packet, holds no more than a packet's worth, and a damaged one is refused", () => {
  const rng = new Rng(4);
  const batch = new Batch();
  const put: { speaker: number; flags: number; seq: number; time: number; body: number[] }[] = [];
  for (;;) {
    const body = opus(rng, 20 + rng.int(60));
    if (!batch.fits(body.length)) break;
    const e = { speaker: rng.int(65536), flags: flagsOf(rng.int(3), rng.int(3), rng.int(4) === 0, false), seq: rng.int(65536), time: rng.int(100000) * F, body: [...body] };
    batch.add(e.speaker, e.flags, e.seq, e.time, body);
    put.push(e);
  }
  expect(put.length).toBeGreaterThan(15);
  expect(batch.count).toBe(put.length);
  expect(batch.length).toBeLessThanOrEqual(MAX_BATCH);
  expect(batch.length).toBeGreaterThan(MAX_BATCH - ENTRY_HEADER - 80);
  const got: typeof put = [];
  const sent = batch.packet().slice();
  expect(readBatch(sent, (speaker, flags, seq, time, body) => got.push({ speaker, flags, seq, time, body: [...body] }))).toBe(true);
  expect(got).toEqual(put);
  for (const cut of [1, 2, 5, sent.length - 1]) expect(readBatch(sent.subarray(0, cut), () => {})).toBe(false);
  const lying = sent.slice();
  lying[2 + 9] = 0xff;
  lying[2 + 10] = 0xff;
  expect(readBatch(lying, () => {})).toBe(false);
  expect(readBatch(new Uint8Array([VOICE_AUDIO, 0]), () => {})).toBe(false);
  // After reset it is empty, and an empty batch still reads as a batch.
  batch.reset();
  expect([batch.count, batch.length]).toEqual([0, 2]);
  expect(readBatch(batch.packet(), () => expect(true).toBe(false))).toBe(true);

  const token = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const buf = new Uint8Array(128);
  expect(writeAuth(buf, 513, token)).toBe(AUTH_BYTES);
  expect([...buf.subarray(0, AUTH_BYTES)]).toEqual([VOICE_AUTH, 1, 2, 1, 2, 3, 4, 5, 6, 7, 8]);
  const name = new TextEncoder().encode("ada");
  const intro = readIntro(buf.slice(0, writeIntro(buf, 77, 0xfedcba98, name)))!;
  expect([intro.speaker, intro.handle, new TextDecoder().decode(intro.name)]).toEqual([77, 0xfedcba98, "ada"]);
  expect(readIntro(buf.subarray(0, 7))).toBeNull();
  expect(readIntro(buf.subarray(0, 12))).toBeNull();
});

test("the buffer plays what arrives on time in order, a set way behind the newest, and stops at the end it is told", () => {
  const jb = new JitterBuffer();
  const out = new Float32Array(128);
  expect(jb.read(out, 128)).toBe(false);
  // Frames 100 to 109 arrive one every 20 ms of the listener's clock, which reads 128 samples at a time.
  const heard: number[] = [];
  let clock = 0;
  let next = 100;
  const total = 10;
  for (let block = 0; block < 200; block++) {
    while (next < 100 + total && clock >= (next - 100) * F) {
      jb.push(next * F, frame(next), next === 100 + total - 1);
      next++;
    }
    out.fill(0);
    if (jb.read(out, 128)) for (let i = 0; i < 128; i++) heard.push(out[i]!);
    clock += 128;
  }
  // After the target's silence, the first five milliseconds fade in, so a voice does not begin with a click.
  const first = heard.findIndex((v) => v !== 0) - 1;
  expect(first).toBe(START_TARGET);
  const voiced = heard.slice(first, first + total * F);
  expect(voiced[120]).toBeCloseTo(100.125 * 0.5, 3);
  for (let i = 291; i < voiced.length; i += 97) expect(voiced[i]).toBeCloseTo(100 + i / F, 3);
  expect(heard.slice(first + total * F).every((v) => v === 0)).toBe(true);
  expect(jb.playing).toBe(false);
  expect(jb.stats).toEqual({ played: total, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 });
  // A later utterance starts again from its first frame.
  jb.push(500 * F, frame(500));
  expect(jb.playing).toBe(true);
  expect(jb.depth).toBe(START_TARGET + F);
});

test("the buffer: a frame that never comes is a gap, one that comes too late is dropped, and frames out of order are put right", () => {
  // Frames 1 to 3 arrive, 4 is lost, and 6 comes before 5.
  const jb = new JitterBuffer();
  for (const f of [1, 2, 3, 6, 5]) jb.push(f * F, frame(f));
  expect(jb.depth).toBe(START_TARGET + 6 * F);
  // Read the wait off first so that frames line up with reads. The gap where 4 was is covered by frame 3, played backwards and fading.
  jb.read(new Float32Array(START_TARGET), START_TARGET);
  const o = new Float32Array(F);
  const heard: number[] = [];
  for (let k = 0; k < 6; k++) {
    o.fill(0);
    jb.read(o, F);
    heard.push(Math.floor(o[F - 10]!));
    if (k === 3) {
      expect(o[0]).toBeCloseTo(4 - 1 / F, 2);
      expect(o[F - 1]).toBeCloseTo(3 * 0.5, 1);
    }
  }
  expect(heard).toEqual([1, 2, 3, 1, 5, 6]);
  expect(jb.stats).toEqual({ played: 5, missing: 1, late: 0, restarts: 0, jumps: 0, odd: 0 });
  // With the buffer empty, the next frame is a new start, even the lost frame turning up at last.
  jb.push(4 * F, frame(4));
  expect([jb.stats.late, jb.stats.restarts]).toEqual([0, 1]);
  // With frames still buffered, a straggler whose time has passed counts as late and changes nothing.
  const busy = new JitterBuffer();
  for (const f of [10, 11, 12, 13, 14, 15]) busy.push(f * F, frame(f));
  busy.read(new Float32Array(START_TARGET + 3 * F), START_TARGET + 3 * F);
  const depth = busy.depth;
  busy.push(11 * F, frame(11));
  busy.push(9 * F, frame(9));
  expect([busy.stats.late, busy.stats.restarts, busy.depth]).toEqual([2, 0, depth]);
  // A frame of the wrong size, or off the frame grid, cannot be placed.
  busy.push(16 * F, new Float32Array(100));
  busy.push(16 * F + 1, frame(16));
  expect(busy.stats.odd).toBe(2);
});

test("the buffer: after a stall the burst is skipped to the target, running dry starts again, and silence without an end is given up on", () => {
  // Frames 0 to 2 play out, then frames 3 to 52, a second of talk, arrive all at once.
  const jb = new JitterBuffer();
  const out = new Float32Array(F);
  for (const f of [0, 1, 2]) jb.push(f * F, frame(f));
  for (let k = 0; k < 6; k++) jb.read(out.fill(0), F);
  expect(jb.depth).toBe(0);
  for (let f = 3; f < 53; f++) jb.push(f * F, frame(f));
  expect(jb.depth).toBeLessThanOrEqual(START_TARGET + 0.12 * 48000 + F);
  expect(jb.depth).toBeGreaterThanOrEqual(START_TARGET);
  expect(jb.stats.jumps).toBeGreaterThan(0);
  // What plays next is from the last quarter second of the burst.
  out.fill(0);
  jb.read(out, F);
  expect(out[F - 1]).toBeGreaterThan(53 - 14);
  // On a steady link with jitter under the target, every frame is played.
  const rng = new Rng(9);
  const steady = new JitterBuffer();
  const arrivals: [number, number][] = [];
  for (let f = 0; f < 500; f++) arrivals.push([f * F + rng.int(START_TARGET - 200), f]);
  arrivals.sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (let clock = 0; clock < 510 * F; clock += 128) {
    while (at < arrivals.length && arrivals[at]![0] <= clock) {
      const f = arrivals[at++]![1];
      steady.push(f * F, frame(f), f === 499);
    }
    steady.read(new Float32Array(128), 128);
  }
  expect(steady.stats).toEqual({ played: 500, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 });
  expect(steady.playing).toBe(false);

  // A speaker that stops without an end flag is taken to have stopped after half a second of nothing.
  const gone = new JitterBuffer();
  gone.push(0, frame(0));
  let blocks = 0;
  while (gone.read(new Float32Array(128), 128)) blocks++;
  expect(blocks * 128).toBeGreaterThan(START_TARGET + F + 24000 - 128);
  expect(blocks * 128).toBeLessThan(START_TARGET + F + 24000 + 256);
  // A time that starts over, as when a long session's count wraps, is a new start and not a late frame.
  const wrap = new JitterBuffer();
  wrap.push(4_000_000 * F, frame(1));
  wrap.read(new Float32Array(128), 128);
  wrap.push(0, frame(0));
  expect(wrap.playing).toBe(true);
  expect(wrap.depth).toBe(START_TARGET + F);
  expect(wrap.stats.late).toBe(0);
});

test("changing rate keeps the pitch and the length of a tone, across blocks of any size", () => {
  for (const [from, to] of [[44100, 48000], [48000, 44100], [16000, 48000], [96000, 48000], [48000, 48000]] as const) {
    const rs = new Resampler(from, to);
    const seconds = 0.5;
    const tone = 440;
    const input = new Float32Array(from * seconds);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * tone * i) / from);
    const out = new Float32Array(to * seconds + 64);
    let n = 0;
    const rng = new Rng(from);
    for (let i = 0; i < input.length; ) {
      const size = Math.min(input.length - i, 1 + rng.int(300));
      const block = input.subarray(i, i + size);
      expect(rs.capacity(size)).toBeGreaterThanOrEqual(1);
      const wrote = rs.run(block, size, out, n);
      expect(wrote).toBeLessThanOrEqual(rs.capacity(size));
      n += wrote;
      i += size;
    }
    // The tolerance covers output samples that fall after the last input sample.
    expect(Math.abs(n - to * seconds)).toBeLessThanOrEqual(Math.ceil(to / from) + 1);
    let worst = 0;
    for (let k = 100; k < n - 100; k++) worst = Math.max(worst, Math.abs(out[k]! - Math.sin((2 * Math.PI * tone * k) / to)));
    expect(worst).toBeLessThan(from === 16000 ? 0.02 : 0.005);
  }
});

test("push to talk: every frame while the key is held and a short tail after, the last marked as the end, each packet numbered in order", () => {
  const gate = new Gate();
  const steps = (n: number): number[] => Array.from({ length: n }, () => gate.step());
  expect(steps(3)).toEqual([GATE_SKIP, GATE_SKIP, GATE_SKIP]);
  expect(gate.sending).toBe(false);
  gate.pressed = true;
  expect(steps(4)).toEqual([GATE_SEND, GATE_SEND, GATE_SEND, GATE_SEND]);
  gate.pressed = false;
  expect(gate.sending).toBe(true);
  const tail = steps(TAIL_FRAMES + 2);
  expect(tail).toEqual([...Array(TAIL_FRAMES - 1).fill(GATE_SEND), GATE_END, GATE_SKIP, GATE_SKIP]);
  expect(gate.sending).toBe(false);
  // Pressed again inside the tail, it goes on with no end sent.
  gate.pressed = true;
  gate.step();
  gate.pressed = false;
  steps(3);
  gate.pressed = true;
  expect(steps(2)).toEqual([GATE_SEND, GATE_SEND]);

  // In the uplink, a frame's time is its place among all the frames the microphone gave, sent or not.
  const up = new Uplink();
  const rng = new Rng(1);
  up.loop = true;
  up.mode = MODE_YELL;
  up.reach = REACH_TRIBE;
  expect(up.capture(GATE_SKIP)).toBe(-1);
  expect(up.capture(GATE_SKIP)).toBe(-1);
  expect(up.capture(GATE_SEND)).toBe(2 * 20000);
  expect(up.capture(GATE_SEND)).toBe(3 * 20000);
  expect(up.capture(GATE_END)).toBe(4 * 20000);
  // The encoder answers in order, some time later.
  const packets = [0, 1, 2].map(() => up.encoded(opus(rng, 50))!.slice());
  const fields = packets.map((p) => (parseAudio(p), [audio.seq, audio.time / F, (audio.flags & FLAG_END) !== 0, modeOf(audio.flags), reachOf(audio.flags), (audio.flags & FLAG_LOOP) !== 0]));
  expect(fields).toEqual([[0, 2, false, MODE_YELL, REACH_TRIBE, true], [1, 3, false, MODE_YELL, REACH_TRIBE, true], [2, 4, true, MODE_YELL, REACH_TRIBE, true]]);
  expect(up.sent).toBe(3);
  // With nothing waiting, or Opus too large to carry, there is no packet.
  expect(up.encoded(opus(rng, 10))).toBeNull();
  up.capture(GATE_SEND);
  expect(up.encoded(opus(rng, MAX_OPUS + 1))).toBeNull();
  // A reset encoder gives nothing back, so drop() forgets what was waiting. Numbering carries on.
  up.capture(GATE_SEND);
  up.drop();
  expect(up.encoded(opus(rng, 10))).toBeNull();
  up.capture(GATE_SEND);
  parseAudio(up.encoded(opus(rng, 10))!);
  expect([audio.seq, audio.time / F]).toEqual([3, 7]);
});

test("a lost frame is covered by the one before it and then by silence, with no step in the sound at either edge", () => {
  const tone = (f: number): Float32Array => {
    const pcm = new Float32Array(F);
    for (let i = 0; i < F; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * (f * F + i)) / 48000);
    return pcm;
  };
  /** Every frame but those in `lost` arrives as it is made. Returns what is heard, aligned so that frame f begins at f * F. */
  const play = (lost: number[], frames: number): Float32Array => {
    const jb = new JitterBuffer();
    const all = new Float32Array(START_TARGET + frames * F);
    for (let at = 0, f = 0; at < all.length; at += 120) {
      for (; f < frames && f * F <= at; f++) if (!lost.includes(f)) jb.push(f * F, tone(f), f === frames - 1);
      jb.read(all.subarray(at), 120);
    }
    return all.subarray(START_TARGET);
  };
  const energy = (x: Float32Array, from: number, to: number): number => {
    let e = 0;
    for (let i = from; i < to; i++) e += x[i]! * x[i]!;
    return Math.sqrt(e / (to - from));
  };
  const step = (x: Float32Array, from: number, to: number): number => {
    let worst = 0;
    for (let i = Math.max(1, from); i < to; i++) worst = Math.max(worst, Math.abs(x[i]! - x[i - 1]!));
    return worst;
  };
  const whole = play([], 20);
  const full = energy(whole, 5 * F, 6 * F);
  // The largest step a tone of this pitch and loudness takes from one sample to the next.
  const natural = step(whole, 2 * F, 18 * F);
  expect(full).toBeCloseTo(0.5 / Math.SQRT2, 2);

  const one = play([8], 20);
  const covered = energy(one, 8 * F, 9 * F);
  expect(covered).toBeGreaterThan(full * 0.45);
  expect(covered).toBeLessThan(full * 0.9);
  expect(step(one, 8 * F - 4, 9 * F + 200)).toBeLessThan(natural * 2.2);
  expect(energy(one, 9 * F + 200, 10 * F)).toBeCloseTo(full, 2);

  // With five lost, three frames are covered, each quieter than the last, then there is nothing, and the voice comes back in from silence.
  const five = play([8, 9, 10, 11, 12], 20);
  const levels = [8, 9, 10, 11, 12].map((f) => energy(five, f * F, (f + 1) * F));
  expect(levels[0]!).toBeGreaterThan(levels[1]! * 1.6);
  expect(levels[1]!).toBeGreaterThan(levels[2]! * 1.6);
  expect(levels[3]!).toBeLessThan(full * 0.02);
  expect(levels[4]!).toBe(0);
  expect(Math.abs(five[13 * F]!)).toBeLessThan(0.001);
  expect(step(five, 8 * F - 4, 14 * F)).toBeLessThan(natural * 2.2);
  expect(energy(five, 13 * F + 480, 14 * F)).toBeCloseTo(full, 1);
  // A speaker that stops without saying so is not echoed for long, and one that sent an end is not echoed at all.
  const said = play([], 6);
  expect(energy(said, 5 * F, 6 * F)).toBeCloseTo(full, 1);
  const jb = new JitterBuffer();
  for (let f = 0; f < 6; f++) {
    jb.push(f * F, tone(f));
    jb.read(new Float32Array(F), F);
  }
  jb.read(new Float32Array(START_TARGET), START_TARGET);
  const after = new Float32Array(8 * F);
  jb.read(after, after.length);
  expect(energy(after, 0, F)).toBeGreaterThan(full * 0.4);
  expect(energy(after, 4 * F, 8 * F)).toBe(0);
});

test("the wait before playing follows the link: short on a steady one, longer on an uneven one, and a frame longer each time it runs dry", () => {
  /** Utterances of 150 frames with pauses between. A frame is sent every 20 ms and arrives after the delay the link chooses. */
  const talk = (delayMs: (i: number, rng: Rng) => number, utterances = 6): JitterBuffer => {
    const jb = new JitterBuffer();
    const rng = new Rng(11);
    let f = 0;
    let clock = 0;
    for (let u = 0; u < utterances; u++) {
      const n = 150;
      const arrivals: [number, number][] = [];
      for (let i = 0; i < n; i++) arrivals.push([(f + i) * F + Math.round(delayMs(f + i, rng) * 48), f + i]);
      arrivals.sort((a, b) => a[0] - b[0]);
      let at = 0;
      const until = (f + n + 40) * F;
      for (; clock < until; clock += 128) {
        while (at < arrivals.length && arrivals[at]![0] <= clock) {
          const g = arrivals[at++]![1];
          jb.push(g * F, frame(g), g === f + n - 1, clock);
        }
        jb.read(new Float32Array(128), 128);
      }
      f += n + 60;
    }
    return jb;
  };
  const steady = talk(() => 30);
  expect(steady.target).toBe(MIN_TARGET);
  expect(steady.stats.missing + steady.stats.late + steady.stats.restarts).toBe(0);
  // With delay that wanders by up to 90 ms the wait grows to cover nearly all of it, and little is lost once it has.
  const uneven = talk((_i, rng) => 30 + rng.range(0, 90));
  expect(uneven.target).toBeGreaterThanOrEqual(100 * 48);
  expect(uneven.target).toBeLessThanOrEqual(140 * 48);
  const settled = talk((_i, rng) => 30 + rng.range(0, 90), 12);
  expect(settled.stats.late - uneven.stats.late).toBeLessThan(40);
  // Wild delay cannot push the wait past its most, and a link that settles lets it come back down.
  expect(talk((_i, rng) => rng.range(0, 900), 4).wanted).toBe(MAX_TARGET);
  const calmer = talk((i, rng) => (i < 400 ? 30 + rng.range(0, 90) : 30), 10);
  expect(calmer.target).toBe(MIN_TARGET);

  const jb = new JitterBuffer();
  let clock = 0;
  const feed = (from: number, to: number): void => {
    for (let f = from; f < to; f++) {
      jb.push(f * F, frame(f), false, clock);
      for (let k = 0; k < F; k += 120) jb.read(new Float32Array(120), 120);
      clock += F;
    }
  };
  feed(0, 50);
  const before = jb.target;
  // A quarter second with nothing arriving while the clock runs on.
  for (let k = 0; k < 12000; k += 120) jb.read(new Float32Array(120), 120);
  clock += 12000;
  feed(50, 60);
  expect(jb.stats.restarts).toBe(1);
  expect(jb.target).toBe(before + F);
  expect(jb.playing).toBe(true);
});

test("a voice is loudest near its speaker, falls away with distance, is faint at the edge of its range and gone a little past it", () => {
  for (const [mode, range] of [[MODE_WHISPER, 4], [MODE_TALK, 25], [MODE_YELL, 60]] as const) {
    expect(voiceGain(0, mode)).toBe(1);
    expect(voiceGain(range * 0.15, mode)).toBe(1);
    // Twice as far, half as loud.
    expect(voiceGain(range * 0.3, mode)).toBeCloseTo(0.5, 6);
    expect(voiceGain(range * 0.6, mode)).toBeCloseTo(0.25, 6);
    expect(voiceGain(range, mode)).toBeCloseTo(0.15, 6);
    // Past the edge, where the server still sends it for a step or two, it falls to nothing with no jump.
    expect(voiceGain(range * 1.05, mode)).toBeCloseTo(0.075, 6);
    expect(voiceGain(range * 1.1, mode)).toBe(0);
    expect(voiceGain(range * 3, mode)).toBe(0);
    let before = 1;
    for (let d = 0; d <= range * 1.2; d += range / 200) {
      const g = voiceGain(d, mode);
      expect(g).toBeLessThanOrEqual(before);
      expect(before - g).toBeLessThan(0.04);
      before = g;
    }
  }
  expect(voiceGain(40, MODE_YELL)).toBeGreaterThan(0);
  expect(voiceGain(40, MODE_TALK)).toBe(0);
  expect(voiceGain(20, MODE_YELL)).toBeGreaterThan(voiceGain(20, MODE_TALK));
  // A distance of -1 means this client has not been shown the speaker's body. It plays at half level.
  expect(voiceGain(-1, MODE_TALK)).toBe(0.5);
});

test("a microphone left open sends only what it hears: from a little before a sound to a little after the last", () => {
  const gate = new Gate();
  gate.open = true;
  const quiet = OPEN_LEVEL / 3;
  const loud = OPEN_LEVEL * 3;
  // Switched off, nothing is sent however loud it is.
  expect([gate.step(loud), gate.step(loud)]).toEqual([GATE_SKIP, GATE_SKIP]);
  gate.pressed = true;
  expect([gate.step(quiet), gate.step(quiet), gate.step(0)]).toEqual([GATE_SKIP, GATE_SKIP, GATE_SKIP]);
  expect(gate.sending).toBe(false);
  // The first frame loud enough opens it. A pause shorter than the hang does not close it.
  expect(gate.step(loud)).toBe(GATE_OPEN);
  expect([gate.step(loud), gate.step(quiet), gate.step(quiet), gate.step(loud)]).toEqual([GATE_SEND, GATE_SEND, GATE_SEND, GATE_SEND]);
  expect(gate.sending).toBe(true);
  // After the last sound it goes on for the hang, with the last frame marked as the end, then nothing until the next sound.
  const after = Array.from({ length: HANG_FRAMES + 2 }, () => gate.step(quiet));
  expect(after).toEqual([...Array(HANG_FRAMES - 1).fill(GATE_SEND), GATE_END, GATE_SKIP, GATE_SKIP]);
  expect(gate.sending).toBe(false);
  expect(gate.step(loud)).toBe(GATE_OPEN);
  // Switched off in the middle of a word, the word is finished and ended as any other.
  gate.pressed = false;
  const off = Array.from({ length: HANG_FRAMES + 1 }, () => gate.step(loud));
  expect(off.filter((g) => g === GATE_END).length).toBe(1);
  expect(off.at(-1)).toBe(GATE_SKIP);

  // frameLevel is 0 for silence, 1 for a full square wave and about 0.7 for a full sine.
  expect(frameLevel(new Float32Array(F))).toBe(0);
  expect(frameLevel(new Float32Array(F).fill(-1))).toBe(1);
  expect(frameLevel(Float32Array.from({ length: F }, (_, i) => Math.sin(i / 5)))).toBeCloseTo(Math.SQRT1_2, 2);
  expect(OPEN_LEVEL).toBeCloseTo(0.0056, 4);

  // The frames just before the sound are sent first, with their original times.
  const up = new Uplink();
  const rng = new Rng(2);
  for (let i = 0; i < 10; i++) up.capture(GATE_SKIP);
  const micros = [up.recall(PREROLL_FRAMES), up.recall(PREROLL_FRAMES - 1), up.capture(GATE_OPEN), up.capture(GATE_SEND)];
  expect(micros).toEqual([8, 9, 10, 11].map((f) => f * 20000));
  const times = micros.map(() => (parseAudio(up.encoded(opus(rng, 30))!), [audio.seq, audio.time / F, audio.flags & FLAG_END]));
  expect(times).toEqual([[0, 8, 0], [1, 9, 0], [2, 10, 0], [3, 11, 0]]);
  // At the very start there is nothing before to send.
  expect(new Uplink().recall(1)).toBe(-1);
});

test("a voice is heard on the side it is on, as loud in all wherever that is", () => {
  // Looking along +Z, the right is -X.
  expect(voicePan(-5, 0, 0)).toBeCloseTo(1, 6);
  expect(voicePan(5, 0, 0)).toBeCloseTo(-1, 6);
  expect(voicePan(0, 5, 0)).toBeCloseTo(0, 6);
  expect(voicePan(0, -5, 0)).toBeCloseTo(0, 6);
  expect(voicePan(-3, 3, 0)).toBeCloseTo(Math.SQRT1_2, 6);
  // Turned a quarter to the left (yaw grows that way), what was ahead is on the right.
  expect(voicePan(0, 5, Math.PI / 2)).toBeCloseTo(1, 6);
  expect(voicePan(-5, 0, Math.PI / 2)).toBeCloseTo(0, 6);
  // Distance does not matter until the speaker is within arm's reach, where the pan moves to the middle.
  expect(voicePan(-50, 0, 0)).toBeCloseTo(1, 6);
  expect(voicePan(-0.5, 0, 0)).toBeCloseTo(0.5, 6);
  expect(voicePan(0, 0, 1)).toBe(0);
  for (let pan = -1; pan <= 1; pan += 0.125) expect(panLeft(pan) ** 2 + panRight(pan) ** 2).toBeCloseTo(1, 9);
  expect([panLeft(-1), panRight(-1), panLeft(1), panRight(1)].map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0, 1]);
  expect(panLeft(0)).toBeCloseTo(Math.SQRT1_2, 9);
  expect(panLeft(0.5)).toBeLessThan(panRight(0.5));
});
