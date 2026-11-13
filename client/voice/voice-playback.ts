// Audio worklet: everyone this client can hear, mixed and played.
//
// The voice worker sends each speaker's decoded frames with the time their
// speaker gave them. Each speaker has a buffer (client/core/voice/jitter.ts)
// that plays them a little behind, on this worklet's clock; the buffers are
// added together and brought to the device's rate.

import { JitterBuffer } from "../core/voice/jitter.ts";
import { voiceGain } from "../core/voice/place.ts";
import { Resampler } from "../core/voice/resample.ts";
import { SAMPLE_RATE } from "../../shared/voice/packet.ts";

const BLOCK = 128;
/** Blocks between reports to the page: about a fifth of a second, so that who is talking is shown as they talk. */
const REPORT_BLOCKS = 72;

interface Frame {
  /** Speaker, its time in samples, how loud it is meant, whether it is the last of an utterance, and the samples (null for an end with no sound). */
  s: number;
  t: number;
  m: number;
  e: boolean;
  p: Float32Array | null;
}

interface Heard {
  jb: JitterBuffer;
  /** How loud its voice is meant, how far off it is (metres; 0 until the page says), and how loud it is being played. */
  mode: number;
  distance: number;
  gain: number;
}

class Playback extends AudioWorkletProcessor {
  private readonly speakers = new Map<number, Heard>();
  /** Samples played, at 48,000 a second: the clock frames are timed against as they arrive. */
  private clock = 0;
  private readonly mix = new Float32Array(BLOCK);
  private readonly direct = sampleRate === SAMPLE_RATE;
  private readonly rs = new Resampler(SAMPLE_RATE, sampleRate);
  /** Samples at the device's rate, made and not yet played. */
  private readonly ready = new Float32Array(this.rs.capacity(BLOCK) + 4096);
  private have = 0;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      const from = e.data.port as MessagePort | undefined;
      if (from) from.onmessage = (m) => this.take(m.data as Frame);
      // The page says how far off each speaker is: pairs of speaker number and metres.
      const d = e.data.d as Float32Array | undefined;
      if (d) for (let i = 0; i + 1 < d.length; i += 2) this.heard(d[i]!).distance = d[i + 1]!;
    };
  }

  private heard(speaker: number): Heard {
    let h = this.speakers.get(speaker);
    if (!h) this.speakers.set(speaker, (h = { jb: new JitterBuffer(), mode: 1, distance: 0, gain: 1 }));
    return h;
  }

  private take(f: Frame): void {
    const h = this.heard(f.s);
    h.mode = f.m;
    if (f.p) h.jb.push(f.t, f.p, f.e, this.clock);
    else if (f.e) h.jb.end();
  }

  /** The next block of everyone, at 48,000 samples a second, each as loud as its distance makes it. */
  private next(): Float32Array {
    const mix = this.mix.fill(0);
    for (const h of this.speakers.values()) {
      // Toward where it should be a part of the way each block, so that a change is a glide and not a step.
      h.gain += (voiceGain(h.distance, h.mode) - h.gain) * 0.2;
      h.jb.read(mix, BLOCK, h.gain);
    }
    this.clock += BLOCK;
    return mix;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const left = out[0]!;
    const n = left.length;
    if (this.direct && n === BLOCK) left.set(this.next());
    else {
      while (this.have < n) this.have += this.rs.run(this.next(), BLOCK, this.ready, this.have);
      left.set(this.ready.subarray(0, n));
      this.ready.copyWithin(0, n, this.have);
      this.have -= n;
    }
    for (let c = 1; c < out.length; c++) out[c]!.set(left);
    if (++this.blocks % REPORT_BLOCKS === 0) this.report();
    return true;
  }

  /** Tell the page how playing is going, summed over speakers. */
  private report(): void {
    const sum = { played: 0, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0, targetMs: 0, speaking: [] as number[] };
    for (const [speaker, h] of this.speakers) {
      const jb = h.jb;
      sum.played += jb.stats.played;
      sum.missing += jb.stats.missing;
      sum.late += jb.stats.late;
      sum.restarts += jb.stats.restarts;
      sum.jumps += jb.stats.jumps;
      sum.odd += jb.stats.odd;
      if (!jb.playing) continue;
      sum.speaking.push(speaker);
      sum.targetMs = Math.max(sum.targetMs, (jb.target * 1000) / SAMPLE_RATE);
    }
    this.port.postMessage(sum);
  }
}

registerProcessor("snark-playback", Playback);
