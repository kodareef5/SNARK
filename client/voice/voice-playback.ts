// Audio worklet: everyone this client can hear, mixed and played.
//
// The voice worker sends each speaker's decoded frames with the time their
// speaker gave them. Each speaker has a buffer (client/core/voice/jitter.ts)
// that plays them a little behind, on this worklet's clock. The page says
// where each speaker is; each is played as loud as its distance makes it and
// on the side it is on, and the lot is brought to the device's rate.

import { JitterBuffer } from "../core/voice/jitter.ts";
import { panLeft, panRight, voiceGain } from "../core/voice/place.ts";
import { HEAR_FIELDS } from "../core/voice/port.ts";
import { Resampler } from "../core/voice/resample.ts";
import { SAMPLE_RATE } from "../../shared/voice/packet.ts";

const BLOCK = 128;
/** Blocks between reports to the page: about a fifth of a second, so that who is talking is shown as they talk. */
const REPORT_BLOCKS = 72;

interface Frame {
  /** Speaker, its time in samples, how loud it is meant, whether it is for everyone wherever they are, whether it is the last of an utterance, and the samples (null for an end with no sound). */
  s: number;
  t: number;
  m: number;
  g: boolean;
  e: boolean;
  p: Float32Array | null;
}

interface Heard {
  jb: JitterBuffer;
  /** How loud its voice is meant, whether it is said to everyone, how far off it is (metres; 0 until the page says) and on which side. */
  mode: number;
  everywhere: boolean;
  distance: number;
  pan: number;
  /** How loud it is being played in each ear: these glide toward where they should be. */
  left: number;
  right: number;
}

class Playback extends AudioWorkletProcessor {
  private readonly speakers = new Map<number, Heard>();
  /** Samples played, at 48,000 a second: the clock frames are timed against as they arrive. */
  private clock = 0;
  private volume = 1;
  private readonly one = new Float32Array(BLOCK);
  private readonly mix = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  private readonly direct = sampleRate === SAMPLE_RATE;
  private readonly rs = [new Resampler(SAMPLE_RATE, sampleRate), new Resampler(SAMPLE_RATE, sampleRate)];
  /** Samples at the device's rate, made and not yet played, for each ear. */
  private readonly ready = [new Float32Array(this.rs[0]!.capacity(BLOCK) + 4096), new Float32Array(this.rs[0]!.capacity(BLOCK) + 4096)];
  private have = 0;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      const from = e.data.port as MessagePort | undefined;
      if (from) from.onmessage = (m) => this.take(m.data as Frame);
      // The page says where each speaker is, and how loud everything is to be.
      const d = e.data.d as Float32Array | undefined;
      if (d) {
        for (let i = 0; i + HEAR_FIELDS <= d.length; i += HEAR_FIELDS) {
          const h = this.heard(d[i]!);
          h.distance = d[i + 1]!;
          h.pan = d[i + 2]!;
        }
      }
      if (typeof e.data.v === "number") this.volume = e.data.v as number;
    };
  }

  private heard(speaker: number): Heard {
    let h = this.speakers.get(speaker);
    if (!h) this.speakers.set(speaker, (h = { jb: new JitterBuffer(), mode: 1, everywhere: false, distance: 0, pan: 0, left: 0.7, right: 0.7 }));
    return h;
  }

  private take(f: Frame): void {
    const h = this.heard(f.s);
    h.mode = f.m;
    h.everywhere = f.g;
    if (f.p) h.jb.push(f.t, f.p, f.e, this.clock);
    else if (f.e) h.jb.end();
  }

  /** The next block of everyone, at 48,000 samples a second, into the two ears' mixes. */
  private next(): void {
    const [left, right] = this.mix as [Float32Array, Float32Array];
    left.fill(0);
    right.fill(0);
    const one = this.one;
    for (const h of this.speakers.values()) {
      // A voice said to everyone has no place: as loud as it is, in the middle.
      const gain = (h.everywhere ? 1 : voiceGain(h.distance, h.mode)) * this.volume;
      const pan = h.everywhere ? 0 : h.pan;
      // Toward where it should be a part of the way each block, so that a change is a glide and not a step.
      h.left += (gain * panLeft(pan) - h.left) * 0.2;
      h.right += (gain * panRight(pan) - h.right) * 0.2;
      if (!h.jb.read(one.fill(0), BLOCK)) continue;
      for (let i = 0; i < BLOCK; i++) {
        left[i]! += one[i]! * h.left;
        right[i]! += one[i]! * h.right;
      }
    }
    this.clock += BLOCK;
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const n = out[0]!.length;
    if (this.direct && n === BLOCK) {
      this.next();
      for (let c = 0; c < out.length; c++) out[c]!.set(this.mix[c & 1]!);
    } else {
      while (this.have < n) {
        this.next();
        const made = this.rs[0]!.run(this.mix[0]!, BLOCK, this.ready[0]!, this.have);
        this.rs[1]!.run(this.mix[1]!, BLOCK, this.ready[1]!, this.have);
        this.have += made;
      }
      for (let c = 0; c < out.length; c++) out[c]!.set(this.ready[c & 1]!.subarray(0, n));
      for (const ear of this.ready) ear.copyWithin(0, n, this.have);
      this.have -= n;
    }
    if (++this.blocks % REPORT_BLOCKS === 0) this.report();
    return true;
  }

  /** Tell the page how playing is going, summed over speakers, and who is speaking. */
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
