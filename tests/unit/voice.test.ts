// Voice: the packets, the buffer between the network and the ear, the rate changer, and the talk gate.

import { expect, test } from "bun:test";
import { JitterBuffer, START_TARGET } from "../../client/core/voice/jitter.ts";
import { Resampler } from "../../client/core/voice/resample.ts";
import { GATE_END, GATE_SEND, GATE_SKIP, Gate, TAIL_FRAMES, Uplink } from "../../client/core/voice/talk.ts";
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

/** A frame whose every sample says which frame it is and where in it, so that what is played can be traced. */
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
  // Another kind of packet; too short; too long; a reserved flag; a loudness or a reach that does not exist.
  expect(bad((p) => ((p[0] = VOICE_AUTH), p))).toBe(false);
  expect(bad((p) => p.subarray(0, AUDIO_HEADER - 1))).toBe(false);
  expect(parseAudio(new Uint8Array(AUDIO_HEADER + MAX_OPUS + 1).fill(VOICE_AUDIO, 0, 1))).toBe(false);
  expect(bad((p) => ((p[1]! |= 0x40), p))).toBe(false);
  expect(bad((p) => ((p[1]! |= 0x80), p))).toBe(false);
  expect(bad((p) => ((p[1] = 3 << 1), p))).toBe(false);
  expect(bad((p) => ((p[1] = 3 << 3), p))).toBe(false);
  // Opus that is not one mono 20 ms frame: stereo, two frames, 10 ms, 60 ms.
  for (const toc of [TOC | 4, TOC | 1, TOC | 3, 8 << 3, 11 << 3]) expect(bad((p) => ((p[AUDIO_HEADER] = toc), p))).toBe(false);
  // Nothing but a header is a packet: the end of an utterance needs no sound.
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
  // Sequence numbers wrap: newer is the short way round.
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
  // Cut short anywhere, or with a length that runs off its end, it is not a batch.
  for (const cut of [1, 2, 5, sent.length - 1]) expect(readBatch(sent.subarray(0, cut), () => {})).toBe(false);
  const lying = sent.slice();
  lying[2 + 9] = 0xff;
  lying[2 + 10] = 0xff;
  expect(readBatch(lying, () => {})).toBe(false);
  expect(readBatch(new Uint8Array([VOICE_AUDIO, 0]), () => {})).toBe(false);
  // Emptied, it is ready for the next turn; an empty batch reads as one.
  batch.reset();
  expect([batch.count, batch.length]).toEqual([0, 2]);
  expect(readBatch(batch.packet(), () => expect(true).toBe(false))).toBe(true);

  // The other two packets.
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
  // Silence for the target, then every sample of every frame, in order, once; then nothing.
  const first = heard.findIndex((v) => v !== 0);
  expect(first).toBe(START_TARGET);
  const voiced = heard.slice(first, first + total * F);
  for (let i = 0; i < voiced.length; i += 97) expect(voiced[i]).toBeCloseTo(100 + i / F, 3);
  expect(heard.slice(first + total * F).every((v) => v === 0)).toBe(true);
  expect(jb.playing).toBe(false);
  expect(jb.stats).toEqual({ played: total, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 });
  // Speaking again later starts again from the first frame of the new utterance.
  jb.push(500 * F, frame(500));
  expect(jb.playing).toBe(true);
  expect(jb.depth).toBe(START_TARGET + F);
});

test("the buffer: a frame that never comes is a gap, one that comes too late is dropped, and frames out of order are put right", () => {
  // Frames 1 to 3 arrive; 4 is lost; 6 comes before 5.
  const jb = new JitterBuffer();
  for (const f of [1, 2, 3, 6, 5]) jb.push(f * F, frame(f));
  expect(jb.depth).toBe(START_TARGET + 6 * F);
  // Step the wait off first so that frames line up with reads; each read adds to what was there (-1), and a gap leaves it alone.
  jb.read(new Float32Array(START_TARGET), START_TARGET);
  const o = new Float32Array(F);
  const heard: number[] = [];
  for (let k = 0; k < 6; k++) {
    o.fill(-1);
    jb.read(o, F);
    heard.push(o[10]! < 0 ? -1 : Math.floor(o[10]! + 1));
  }
  expect(heard).toEqual([1, 2, 3, -1, 5, 6]);
  expect(jb.stats).toEqual({ played: 5, missing: 1, late: 0, restarts: 0, jumps: 0, odd: 0 });
  // With nothing left in hand, whatever comes next is a new start, even the lost frame turning up at last.
  jb.push(4 * F, frame(4));
  expect([jb.stats.late, jb.stats.restarts]).toEqual([0, 1]);
  // With more in hand, a straggler whose time has gone is simply late, and changes nothing.
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
  // A stall: frames 0 to 2 play, then nothing for a second, then 3 to 52 all at once.
  const jb = new JitterBuffer();
  const out = new Float32Array(F);
  for (const f of [0, 1, 2]) jb.push(f * F, frame(f));
  for (let k = 0; k < 6; k++) jb.read(out.fill(0), F);
  expect(jb.depth).toBe(0);
  for (let f = 3; f < 53; f++) jb.push(f * F, frame(f));
  // Not a second of old talk: what is in hand is the target and a little more, and the rest was skipped.
  expect(jb.depth).toBeLessThanOrEqual(START_TARGET + 0.12 * 48000 + F);
  expect(jb.depth).toBeGreaterThanOrEqual(START_TARGET);
  expect(jb.stats.jumps).toBeGreaterThan(0);
  // What plays next is from the last quarter second of it, not the first.
  out.fill(0);
  jb.read(out, F);
  expect(out[F - 1]).toBeGreaterThan(53 - 14);
  // Over a steady link with jitter under the target, nothing is lost: every frame is played.
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

  // A speaker that just stops, with no end said: after half a second of nothing it is taken to have stopped.
  const gone = new JitterBuffer();
  gone.push(0, frame(0));
  let blocks = 0;
  while (gone.read(new Float32Array(128), 128)) blocks++;
  expect(blocks * 128).toBeGreaterThan(START_TARGET + F + 24000 - 128);
  expect(blocks * 128).toBeLessThan(START_TARGET + F + 24000 + 256);
  // Its time starting over (a long session's count wrapping) is a new start, not an age of lateness.
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
    // As many samples as the time is worth at the new rate, give or take what falls after the last sample it was given.
    expect(Math.abs(n - to * seconds)).toBeLessThanOrEqual(Math.ceil(to / from) + 1);
    // The same tone: each sample is where a sine of that pitch would be.
    let worst = 0;
    for (let k = 100; k < n - 100; k++) worst = Math.max(worst, Math.abs(out[k]! - Math.sin((2 * Math.PI * tone * k) / to)));
    expect(worst).toBeLessThan(from === 16000 ? 0.02 : 0.005);
  }
});

test("push to talk: every frame while the key is held and a short tail after, the last marked as the end, each packet numbered in order", () => {
  const gate = new Gate();
  const steps = (n: number): number[] => Array.from({ length: n }, () => gate.step());
  expect(steps(3)).toEqual([GATE_SKIP, GATE_SKIP, GATE_SKIP]);
  expect(gate.open).toBe(false);
  gate.pressed = true;
  expect(steps(4)).toEqual([GATE_SEND, GATE_SEND, GATE_SEND, GATE_SEND]);
  gate.pressed = false;
  expect(gate.open).toBe(true);
  const tail = steps(TAIL_FRAMES + 2);
  expect(tail).toEqual([...Array(TAIL_FRAMES - 1).fill(GATE_SEND), GATE_END, GATE_SKIP, GATE_SKIP]);
  expect(gate.open).toBe(false);
  // Pressed again inside the tail, it simply goes on: no end is said.
  gate.pressed = true;
  gate.step();
  gate.pressed = false;
  steps(3);
  gate.pressed = true;
  expect(steps(2)).toEqual([GATE_SEND, GATE_SEND]);

  // The uplink: a frame's time is its place in everything the microphone gave, sent or not.
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
  // Nothing waiting, or Opus too large to carry: no packet.
  expect(up.encoded(opus(rng, 10))).toBeNull();
  up.capture(GATE_SEND);
  expect(up.encoded(opus(rng, MAX_OPUS + 1))).toBeNull();
  // A reset encoder gives nothing back: what was waiting is forgotten, and numbering carries on.
  up.capture(GATE_SEND);
  up.drop();
  expect(up.encoded(opus(rng, 10))).toBeNull();
  up.capture(GATE_SEND);
  parseAudio(up.encoded(opus(rng, 10))!);
  expect([audio.seq, audio.time / F]).toEqual([3, 7]);
});
