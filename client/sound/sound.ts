// The world's sounds in a browser: carries out each frame's sound packet (client/core/sound/packet.ts) with the
// browser's own audio, and decides nothing. Nothing here is tested. Each voice is a buffer source, a low-pass, a gain
// and a panner that places it by direction only, since distance is worked out in client/core; a voice at the ear has
// no panner. Each goes to its bus's gain: effects and ambience through a compressor that keeps many sounds at once
// from clipping, music and the interface around it, so a fight never squeezes a click. The page's voices share the
// same audio context. While the page is hidden the context is suspended, unless voice chat shares it: then only the
// world's sounds fall silent.

import type { MusicPlan } from "../core/sound/music.ts";
import { BUSES, MOVE_FIELDS, START_FIELDS, type SoundPacket, type SoundSink } from "../core/sound/packet.ts";

/** Flags of a start (client/core/sound/mixer.ts). */
const FLAT = 1;
const LOOP = 2;

/** Seconds over which a moved voice glides to its new gain, place and dullness. */
const GLIDE = 0.03;
const STOP_FADE = 0.012;

interface Voice {
  source: AudioBufferSourceNode;
  low: BiquadFilterNode;
  gain: GainNode;
  pan: PannerNode | null;
}

export class SoundIo implements SoundSink {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private readonly buses: GainNode[] = [];
  /** The music: the track streaming, and each of its layers as a media element through a gain into the music bus. */
  private track = "";
  private layers: { el: HTMLAudioElement; gain: GainNode; at: number }[] = [];
  private meter: AnalyserNode | null = null;
  /** The loudest sample `listen` has found leaving the volume, for the self-check: proof that a sound played. */
  peak = 0;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly voices = new Map<number, Voice>();
  /** HRTF places a sound above, below and behind as well; a phone gets the cheaper equal-power panning. */
  private readonly model: PanningModelType;

  constructor(touchFirst: boolean) {
    this.model = touchFirst ? "equalpower" : "HRTF";
  }

  static get supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  /** The page's one audio context, made the first time it is asked for. It plays nothing until `unlock`. */
  context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = (this.ctx = new AudioContext({ latencyHint: "interactive" }));
    const squeeze = ctx.createDynamicsCompressor();
    squeeze.threshold.value = -10;
    squeeze.knee.value = 6;
    squeeze.ratio.value = 8;
    squeeze.attack.value = 0.003;
    squeeze.release.value = 0.15;
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    for (let b = 0; b < BUSES; b++) this.buses.push(new GainNode(ctx));
    // Effects and ambience share the compressor; music and the interface pass round it.
    this.buses[0]!.connect(squeeze);
    this.buses[1]!.connect(squeeze);
    squeeze.connect(this.bus);
    this.buses[2]!.connect(this.bus);
    this.buses[3]!.connect(this.bus);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && !this.voiced) void ctx.suspend();
        // The next frame's packet brings the volume back.
        else if (document.hidden) this.bus!.gain.setTargetAtTime(0, ctx.currentTime, GLIDE);
        else if (this.resumed) void ctx.resume();
      });
    }
    return ctx;
  }

  /** The context for voice chat, which goes on while the page is hidden. */
  shared(): AudioContext {
    this.voiced = true;
    return this.context();
  }

  private voiced = false;

  /** Looks at what leaves the volume now, and keeps the loudest sample in `peak`. Only the self-check calls it. */
  listen(): void {
    if (!this.ctx || !this.bus) return;
    if (!this.meter) this.bus.connect((this.meter = this.ctx.createAnalyser()));
    const block = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(block);
    for (const v of block) this.peak = Math.max(this.peak, Math.abs(v));
  }

  /** Call when the viewer touches the page. A browser plays nothing before that. */
  unlock(): void {
    const ctx = this.context();
    this.resumed = true;
    if (ctx.state === "suspended") void ctx.resume();
  }

  /** Whether the viewer has touched the page, so the context may play when it is shown again. */
  private resumed = false;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  apply(p: SoundPacket): void {
    if (p.loads.length + p.unloads.length + p.starts.length + p.moves.length + p.stops.length === 0 && !this.ctx) return;
    const ctx = this.context();
    const now = ctx.currentTime;
    for (const l of p.loads) {
      const b = ctx.createBuffer(1, l.samples.length, l.rate);
      b.copyToChannel(l.samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(l.buffer, b);
    }
    for (const b of p.unloads) this.buffers.delete(b);
    this.bus!.gain.setTargetAtTime(p.volume, now, GLIDE);
    for (let b = 0; b < BUSES; b++) this.buses[b]!.gain.setTargetAtTime(p.buses[b]!, now, GLIDE);
    if (p.music) this.music(ctx, p.music, now);
    const ear = ctx.listener;
    const [fx, fy, fz, ux, uy, uz] = p.ear as [number, number, number, number, number, number];
    if (ear.forwardX) {
      ear.forwardX.setTargetAtTime(fx, now, GLIDE / 3);
      ear.forwardY.setTargetAtTime(fy, now, GLIDE / 3);
      ear.forwardZ.setTargetAtTime(fz, now, GLIDE / 3);
      ear.upX.setTargetAtTime(ux, now, GLIDE / 3);
      ear.upY.setTargetAtTime(uy, now, GLIDE / 3);
      ear.upZ.setTargetAtTime(uz, now, GLIDE / 3);
    } else ear.setOrientation(fx, fy, fz, ux, uy, uz);
    for (const serial of p.stops) {
      const v = this.voices.get(serial);
      if (!v) continue;
      v.gain.gain.setTargetAtTime(0, now, STOP_FADE);
      v.source.stop(now + STOP_FADE * 5);
      this.voices.delete(serial);
    }
    const s = p.starts;
    for (let i = 0; i + START_FIELDS <= s.length; i += START_FIELDS) {
      const buffer = this.buffers.get(s[i + 1]!);
      if (buffer) this.start(ctx, now, s[i]!, buffer, s[i + 2]!, s[i + 3]!, s[i + 4]!, s[i + 5]!, s[i + 6]!, s[i + 7]!, s[i + 8]!, s[i + 9]!, s[i + 10]!);
    }
    const m = p.moves;
    for (let i = 0; i + MOVE_FIELDS <= m.length; i += MOVE_FIELDS) {
      const v = this.voices.get(m[i]!);
      if (!v) continue;
      v.gain.gain.setTargetAtTime(m[i + 1]!, now, GLIDE);
      if (v.pan) {
        v.pan.positionX.setTargetAtTime(m[i + 2]!, now, GLIDE);
        v.pan.positionY.setTargetAtTime(m[i + 3]!, now, GLIDE);
        v.pan.positionZ.setTargetAtTime(m[i + 4]!, now, GLIDE);
      }
      v.low.frequency.setTargetAtTime(m[i + 5]!, now, GLIDE);
    }
  }

  /** Streams the plan's track, all its layers together, and fades each to its gain; a new track crosses the old. */
  private music(ctx: AudioContext, plan: MusicPlan, now: number): void {
    if (plan.track !== this.track) {
      for (const l of this.layers) {
        l.gain.gain.setTargetAtTime(0, now, plan.fade / 3);
        setTimeout(() => l.el.pause(), plan.fade * 1500);
      }
      this.track = plan.track;
      this.layers = plan.layers.map((name) => {
        const el = Object.assign(new Audio(`assets/music/${plan.track}/${name}.opus`), { loop: plan.loop, preload: "auto" });
        const gain = new GainNode(ctx, { gain: 0 });
        ctx.createMediaElementSource(el).connect(gain).connect(this.buses[2]!);
        return { el, gain, at: -1 };
      });
      for (const l of this.layers) void l.el.play().catch(() => {});
    }
    // The silent layers keep the heard one's clock, so a change lands in time; the heard one is never moved.
    const lead = this.layers[plan.gains.indexOf(1)]?.el;
    this.layers.forEach((l, k) => {
      const g = plan.gains[k] ?? 0;
      if (g !== l.at) l.gain.gain.setTargetAtTime((l.at = g), now, plan.fade / 3);
      if (lead && g === 0 && Math.abs(l.el.currentTime - lead.currentTime) > 0.05) l.el.currentTime = lead.currentTime;
    });
  }

  private start(ctx: AudioContext, now: number, serial: number, buffer: AudioBuffer, delay: number, rate: number, gain: number, x: number, y: number, z: number, low: number, bus: number, flags: number): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.loop = (flags & LOOP) !== 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = low;
    const g = ctx.createGain();
    g.gain.value = gain;
    const pan = (flags & FLAT) !== 0 ? null : new PannerNode(ctx, { panningModel: this.model, distanceModel: "linear", rolloffFactor: 0, positionX: x, positionY: y, positionZ: z });
    const out = this.buses[bus] ?? this.buses[0]!;
    if (pan) source.connect(lp).connect(g).connect(pan).connect(out);
    else source.connect(lp).connect(g).connect(out);
    const v: Voice = { source, low: lp, gain: g, pan };
    this.voices.set(serial, v);
    source.onended = () => {
      (pan ?? g).disconnect();
      if (this.voices.get(serial) === v) this.voices.delete(serial);
    };
    source.start(now + delay);
  }
}
