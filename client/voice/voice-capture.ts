// Audio worklet: the microphone, cut into the frames the encoder takes.
//
// The browser hands over 128 samples at a time at the device's rate. They are
// brought to 48,000 a second and gathered into 20 ms frames, each sent to the
// voice worker as it fills. Nothing is decided here.

import { Resampler } from "../core/voice/resample.ts";
import { FRAME_SAMPLES, SAMPLE_RATE } from "../../shared/voice/packet.ts";

class Capture extends AudioWorkletProcessor {
  private out: MessagePort | null = null;
  private readonly rs = new Resampler(sampleRate, SAMPLE_RATE);
  private readonly scratch = new Float32Array(this.rs.capacity(4096));
  private frame = new Float32Array(FRAME_SAMPLES);
  private fill = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.port) this.out = e.data.port as MessagePort;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const mono = inputs[0]?.[0];
    if (!mono || !this.out) return true;
    const n = this.rs.run(mono, mono.length, this.scratch);
    for (let i = 0; i < n; i++) {
      this.frame[this.fill++] = this.scratch[i]!;
      if (this.fill < FRAME_SAMPLES) continue;
      // The frame goes to the worker whole; a new one takes its place.
      this.out.postMessage(this.frame, [this.frame.buffer]);
      this.frame = new Float32Array(FRAME_SAMPLES);
      this.fill = 0;
    }
    return true;
  }
}

registerProcessor("snark-capture", Capture);
