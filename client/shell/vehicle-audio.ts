// A modest procedural four-cylinder engine, intake and tire scrub. No downloads or microphone access.
// All nodes are made once after a real user gesture; the core supplies presentation telemetry only.
import type { VehicleTelemetry } from "../core/hud.ts";
import { VehicleSoundState } from "../core/audio/vehicle.ts";

export class VehicleAudio {
  private readonly state = new VehicleSoundState();
  readonly report = this.state.report;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: GainNode | null = null;
  private intake: GainNode | null = null;
  private tire: GainNode | null = null;
  private shift: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private motor: OscillatorNode | null = null;
  private exhaust: OscillatorNode | null = null;
  private squeal: OscillatorNode | null = null;
  private meter: AnalyserNode | null = null;
  private readonly samples = new Float32Array(256);

  /** Called by the same pointer/key gesture that unlocks voice. Never resumes audio from a frame or network callback. */
  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    try {
      if (!this.context) this.create();
      this.state.unlock();
      if (this.context!.state === "suspended") void this.context!.resume().catch(() => { this.report.errors++; });
    } catch { this.report.errors++; this.mute(); }
  }

  private create(): void {
    const ctx = this.context = new AudioContext({ latencyHint: "interactive" });
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    // Leaves plenty of room for voice and game effects. A compressor catches coincident harmonics and shift pulses.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 10; limiter.ratio.value = 5;
    const meter = this.meter = ctx.createAnalyser(); meter.fftSize = this.samples.length;
    master.connect(meter); meter.connect(limiter); limiter.connect(ctx.destination);
    const engine = this.engine = ctx.createGain(), filter = this.filter = ctx.createBiquadFilter();
    engine.gain.value = 0; filter.type = "lowpass"; filter.Q.value = .6;
    engine.connect(filter); filter.connect(master);
    const motor = this.motor = ctx.createOscillator();
    const real = new Float32Array(9), imag = Float32Array.from([0, 1, .55, .24, .17, .09, .055, .035, .018]);
    motor.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    motor.frequency.value = 28; motor.connect(engine); motor.start();
    const exhaust = this.exhaust = ctx.createOscillator(), bass = ctx.createGain();
    exhaust.type = "sine"; exhaust.frequency.value = 14; bass.gain.value = .35;
    exhaust.connect(bass); bass.connect(engine); exhaust.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), samples = noise.getChannelData(0);
    let rng = 713;
    for (let i = 0; i < samples.length; i++) { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; samples[i] = (rng >>> 0) / 2147483648 - 1; }
    const air = ctx.createBufferSource(); air.buffer = noise; air.loop = true;
    const intakeFilter = ctx.createBiquadFilter(); intakeFilter.type = "bandpass"; intakeFilter.frequency.value = 900; intakeFilter.Q.value = .7;
    const intake = this.intake = ctx.createGain(); intake.gain.value = 0;
    air.connect(intakeFilter); intakeFilter.connect(intake); intake.connect(master);
    const shiftFilter = ctx.createBiquadFilter(); shiftFilter.type = "lowpass"; shiftFilter.frequency.value = 230;
    const shift = this.shift = ctx.createGain(); shift.gain.value = 0;
    air.connect(shiftFilter); shiftFilter.connect(shift); shift.connect(master);
    const tireFilter = ctx.createBiquadFilter(); tireFilter.type = "bandpass"; tireFilter.frequency.value = 1700; tireFilter.Q.value = .8;
    const tire = this.tire = ctx.createGain(); tire.gain.value = 0;
    air.connect(tireFilter); tireFilter.connect(tire); tire.connect(master); air.start();
    const squeal = this.squeal = ctx.createOscillator(), thin = ctx.createGain();
    squeal.type = "sine"; squeal.frequency.value = 700; thin.gain.value = .35;
    squeal.connect(thin); thin.connect(tire); squeal.start();
  }

  update(v: Readonly<VehicleTelemetry>, enabled = true): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const target = this.state.update(v, enabled, ctx.state === "running"), at = ctx.currentTime;
    if (!target) { this.mute(); return; }
    this.master.gain.setTargetAtTime(.09, at, .06);
    this.motor!.frequency.setTargetAtTime(target.firing, at, .045);
    this.exhaust!.frequency.setTargetAtTime(target.firing * .5, at, .045);
    this.engine!.gain.setTargetAtTime(target.engine, at, .045);
    this.filter!.frequency.setTargetAtTime(target.filter, at, .09);
    this.intake!.gain.setTargetAtTime(target.intake, at, .06);
    this.tire!.gain.setTargetAtTime(target.tire, at, .06);
    this.squeal!.frequency.setTargetAtTime(target.tireHz, at, .08);
    if (target.shift) {
      this.shift!.gain.cancelScheduledValues(at);
      this.shift!.gain.setValueAtTime(.22, at);
      this.shift!.gain.setTargetAtTime(0, at + .025, .035);
    }
    this.meter!.getFloatTimeDomainData(this.samples);
    this.state.measure(this.samples);
  }

  /** Synchronous, also called on visibility/page lifecycle events when animation frames may stop. */
  mute(): void {
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.state.mute();
  }

  dispose(): void {
    this.mute();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null; this.master = null;
    this.state.reset();
  }
}
