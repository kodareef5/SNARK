// A chase camera behind a fast car: its distance does not grow with the car's speed, a long frame does not snap it, and
// a real jump still cuts.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";

/** A Zephyr's boom at rest: three times its half length (client/core/view/place.ts). */
const BOOM = 6.6;

/** A car driven along +z at `speed(seconds)` m/s, its camera placed each frame of `frameMs(n)`. */
class Run {
  readonly cam = new Camera();
  readonly view = new Viewpoint();
  readonly motion = { vx: 0, vy: 0, vz: 0, id: 7, boom: BOOM };
  z = 0;
  seconds = 0;
  /** The most the gap changed in one frame since `watch` was set. */
  worst = 0;
  watch = false;

  get gap(): number {
    return this.z - this.cam.z;
  }

  frame(speed: number, ms = 1000 / 60): void {
    const before = this.gap;
    this.z += (speed * ms) / 1000;
    this.seconds += ms / 1000;
    this.motion.vz = speed;
    this.view.placeVehicle(this.cam, null, 0, 0.8, this.z, 0, -0.2, 0, speed, ms, true, this.motion);
    if (this.watch) this.worst = Math.max(this.worst, Math.abs(this.gap - before));
  }

  drive(speed: number, seconds: number): this {
    for (const end = this.seconds + seconds; this.seconds < end; ) this.frame(speed);
    return this;
  }
}

test("a chase camera stands as far behind a car at 81 m/s as at 34", () => {
  const gaps = [34, 47, 81].map((speed) => new Run().drive(speed, 3).gap);
  // The boom is a third longer from 37 m/s on, and a little under that at 34.
  for (const gap of gaps) expect(Math.abs(gap - gaps[1]!)).toBeLessThan(0.3);
  expect(gaps[1]!).toBeGreaterThan(BOOM);
  expect(gaps[1]!).toBeLessThan(BOOM * 1.5);
});

test("a boost does not pull the car away from its chase camera", () => {
  const run = new Run().drive(47, 3);
  const steady = run.gap;
  run.watch = true;
  // 40 m/s² for 22 ticks, as the Zephyr's nozzles give.
  for (const from = run.seconds; run.seconds < from + 22 / 30; ) run.frame(47 + 40 * (run.seconds - from));
  expect(Math.abs(run.gap - steady)).toBeLessThan(0.3);
  expect(run.worst).toBeLessThan(0.1);
});

test("a long frame at 81 m/s leaves the chase camera where it stood behind the car", () => {
  for (const ms of [60, 140, 400]) {
    const run = new Run().drive(81, 3);
    const steady = run.gap;
    run.watch = true;
    run.frame(81, ms);
    run.drive(81, 0.5);
    expect(run.worst).toBeLessThan(0.5);
    expect(Math.abs(run.gap - steady)).toBeLessThan(0.05);
  }
});

test("a chase camera cuts to a car that was put somewhere else", () => {
  const run = new Run().drive(47, 3);
  const steady = run.gap;
  run.z += 30;
  run.frame(47);
  expect(Math.abs(run.gap - steady)).toBeLessThan(0.05);
});
