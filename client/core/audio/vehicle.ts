// Platform-independent sound decisions. The shell creates WebAudio nodes and applies these bounded targets.
import type { VehicleTelemetry } from "../hud.ts";

export interface VehicleSoundTargets { firing: number; engine: number; intake: number; filter: number; tire: number; tireHz: number }
const unit = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

export function vehicleSoundTargets(v: Readonly<VehicleTelemetry>): VehicleSoundTargets {
  const rpm = Number.isFinite(v.rpm) ? Math.max(0, Math.min(16000, v.rpm)) : 0;
  const running = v.active && !v.rotor && v.fuel > 0 && rpm > 0;
  const load = unit(v.load), tire = v.active && v.grounded ? unit(v.slip) : 0;
  return { firing: Math.max(20, rpm / 30), engine: running ? .22 + load * .2 : 0, intake: running ? .012 + load * .065 : 0, filter: 380 + rpm * .17 + load * 600, tire: tire * tire * .14, tireHz: 650 + tire * 430 };
}

export class VehicleSoundState {
  readonly report = { unlocked: false, running: false, audible: false, gear: 0, rpm: 0, rms: 0, peakRms: 0, errors: 0 };
  private previousGear = 0;

  /** Only the platform's user-gesture callback calls this; frames never grant playback permission. */
  unlock(): void { this.report.unlocked = true; }

  update(v: Readonly<VehicleTelemetry>, enabled: boolean, running: boolean): (VehicleSoundTargets & { shift: boolean }) | null {
    this.report.running = running;
    if (!this.report.unlocked || !enabled || !v.active || v.rotor || !running) { this.mute(); return null; }
    const shift = this.previousGear > 0 && v.gear > 0 && v.gear !== this.previousGear && v.load > 0;
    this.previousGear = v.gear;
    this.report.gear = v.gear; this.report.rpm = Math.round(v.rpm);
    return { ...vehicleSoundTargets(v), shift };
  }

  /** The platform supplies real output samples, so a running context alone does not count as sound. */
  measure(samples: Float32Array): void {
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    this.report.rms = samples.length > 0 ? Math.sqrt(energy / samples.length) : 0;
    this.report.peakRms = Math.max(this.report.peakRms, this.report.rms);
    this.report.audible = this.report.running && this.report.rms > .00001;
  }

  mute(): void { this.previousGear = 0; this.report.rms = 0; this.report.audible = false; }
  reset(): void { this.mute(); this.report.running = this.report.unlocked = false; }
}
