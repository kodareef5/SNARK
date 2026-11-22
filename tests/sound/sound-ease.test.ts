// Sound never snaps on (D1107): the volumes the packet gives with the seconds each takes, and the schedule the device's
// `ease` lays on a gain, read back as the audio clock plays it.

import { expect, test } from "bun:test";
import { MUTE_SECONDS, SESSION_END_SECONDS, SLIDER_SECONDS, SoundPacket, UNMUTE_SECONDS, volumeSeconds } from "../../client/core/sound/packet.ts";
import { ease, type EasedParam } from "../../client/core/sound/ease.ts";

type Event = { kind: "hold" | "cancel"; time: number } | { kind: "set"; value: number; time: number } | { kind: "target"; value: number; time: number; constant: number };

/** An AudioParam's automation for held values, set values and targets, as the Web Audio spec plays it. */
class Param implements EasedParam {
  events: Event[] = [];
  constructor(holds: boolean) {
    if (!holds) this.cancelAndHoldAtTime = undefined;
  }
  cancelAndHoldAtTime?: (time: number) => void = (time) => {
    const v = this.value(time);
    this.events = this.events.filter((e) => e.time < time);
    this.events.push({ kind: "set", value: v, time });
  };
  cancelScheduledValues(time: number): void {
    this.events = this.events.filter((e) => e.time < time);
  }
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: "set", value, time });
  }
  setTargetAtTime(value: number, time: number, constant: number): void {
    this.events.push({ kind: "target", value, time, constant });
  }
  /** The value at `t`: the last set value, or the last target approached from where it began. */
  value(t: number): number {
    let v = 0;
    for (const e of this.events) {
      if (e.time > t) break;
      if (e.kind === "set") v = e.value;
      else if (e.kind === "target") v = e.value + (v - e.value) * Math.exp(-(t - e.time) / e.constant);
    }
    return v;
  }
}

test("a volume up from silence takes a second and a half, down to it 0.3 s, a slider's move 0.1 s, a session's end 1 s", () => {
  expect(volumeSeconds(0, 0.7)).toBe(UNMUTE_SECONDS);
  expect(volumeSeconds(0.7, 0)).toBe(MUTE_SECONDS);
  expect(volumeSeconds(0.7, 0.4)).toBe(SLIDER_SECONDS);
  expect([UNMUTE_SECONDS, MUTE_SECONDS, SLIDER_SECONDS, SESSION_END_SECONDS]).toEqual([1.5, 0.3, 0.1, 1]);
  const p = new SoundPacket();
  // A packet starts silent, as the device does, so its first volumes rise.
  p.mix(1, [1, 0.8, 0.5, 1]);
  expect([p.mixed, p.volume, p.volumeSeconds, ...p.busSeconds]).toEqual([true, 1, UNMUTE_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS]);
  // Nothing changed: nothing to do, and the seconds stay those of the last change, for a device that comes later.
  p.mix(1, [1, 0.8, 0.5, 1]);
  expect([p.mixed, p.volumeSeconds]).toEqual([false, UNMUTE_SECONDS]);
  p.mix(0, [1, 0.8, 0.5, 1]);
  expect([p.mixed, p.volumeSeconds]).toEqual([true, MUTE_SECONDS]);
  p.mix(0.6, [1, 0.8, 0, 1]);
  expect([p.volumeSeconds, p.busSeconds[2]]).toEqual([UNMUTE_SECONDS, MUTE_SECONDS]);
  p.mix(0.4, [1, 0.8, 0.5, 1]);
  expect([p.volumeSeconds, p.busSeconds[2], p.busSeconds[0]]).toEqual([SLIDER_SECONDS, UNMUTE_SECONDS, UNMUTE_SECONDS]);
  // The world gone, the volume falls silent over a session's end's time, and rises from silence when it comes back.
  p.fallSilent();
  expect([p.mixed, p.volume, p.volumeSeconds]).toEqual([true, 0, SESSION_END_SECONDS]);
  p.mix(0.4, [1, 0.8, 0.5, 1]);
  expect([p.mixed, p.volumeSeconds]).toEqual([true, UNMUTE_SECONDS]);
});

for (const holds of [true, false]) {
  test(`ease moves a gain on the audio clock from where it is, never in a step${holds ? "" : ", where the browser cannot hold a value (Firefox)"}`, () => {
    const g = new Param(holds);
    ease(g, 1, UNMUTE_SECONDS, 10);
    const target = g.events.at(-1)!;
    expect(target).toEqual({ kind: "target", value: 1, time: 10.005, constant: UNMUTE_SECONDS / 5 });
    expect(g.value(10.005)).toBe(0);
    // Every 10 ms it moves by less than a twentieth of the way, and it is there to within 1% by its time.
    let was = 0;
    for (let t = 10.015; t < 10 + UNMUTE_SECONDS; t += 0.01) {
      expect(g.value(t) - was).toBeLessThan(0.05);
      expect(g.value(t)).toBeGreaterThanOrEqual(was);
      was = g.value(t);
    }
    expect(g.value(10.005 + UNMUTE_SECONDS)).toBeGreaterThan(0.99);
    // Muted halfway up: it goes down from where it was, not from its target.
    const mid = g.value(10.5);
    ease(g, 0, MUTE_SECONDS, 10.495);
    expect(g.value(10.5)).toBeCloseTo(mid, 9);
    expect(g.events.at(-1)).toEqual({ kind: "target", value: 0, time: 10.5, constant: MUTE_SECONDS / 5 });
    expect(g.value(10.5 + MUTE_SECONDS)).toBeLessThan(0.01);
    // Asked again for where it is already heading, as when another volume changes, it lays nothing.
    const laid = g.events.length;
    ease(g, 0, SLIDER_SECONDS, 11);
    expect(g.events.length).toBe(laid);
  });
}
