// Audio worklet: everyone this client can hear, mixed and played.
//
// The voice worker sends each speaker's decoded frames with the time their
// speaker gave them. Each speaker has a buffer (client/core/voice/jitter.ts)
// that plays them a little behind, on this worklet's clock; the buffers are
// added together and brought to the device's rate.

import { JitterBuffer } from "../core/voice/jitter.ts";
import { Resampler } from "../core/voice/resample.ts";
import { SAMPLE_RATE } from "../../shared/voice/packet.ts";

const BLOCK = 128;
/** Blocks between reports to the page: about half a second. */
const REPORT_BLOCKS = 180;

interface Frame {
  /** Speaker, its time in samples, whether it is the last of an utterance, and the samples (null for an end with no sound). */
  s: number;
  t: number;
  e: boolean;
  p: Float32Array | null;
}

class Playback extends AudioWorkletProcessor {
  private readonly speakers = new Map<number, JitterBuffer>();
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
    };
  }

  private take(f: Frame): void {
    let jb = this.speakers.get(f.s);
    if (!jb) this.speakers.set(f.s, (jb = new JitterBuffer()));
    if (f.p) jb.push(f.t, f.p, f.e);
    else if (f.e) jb.end();
  }

  /** The next block of everyone, at 48,000 samples a second. */
  private next(): Float32Array {
    const mix = this.mix.fill(0);
    for (const jb of this.speakers.values()) jb.read(mix, BLOCK);
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
    const sum = { played: 0, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0, speaking: 0 };
    for (const jb of this.speakers.values()) {
      sum.played += jb.stats.played;
      sum.missing += jb.stats.missing;
      sum.late += jb.stats.late;
      sum.restarts += jb.stats.restarts;
      sum.jumps += jb.stats.jumps;
      sum.odd += jb.stats.odd;
      if (jb.playing) sum.speaking++;
    }
    this.port.postMessage(sum);
  }
}

registerProcessor("snark-playback", Playback);
