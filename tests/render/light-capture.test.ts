import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { App } from "../../client/core/app.ts";
import { PLAY_VERSION } from "../../client/core/diagnostics.ts";
import { CAPTURE_MS, LIGHT_FIELDS, LightCapture, PART_BYTES, SAMPLE_H, SAMPLE_W, brightness } from "../../client/core/light-capture.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { captures, marked } from "../../tools/light.ts";

/** A copy of the canvas lit `top` over its upper half and `bottom` under it. */
function copy(top: number, bottom: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
  for (let k = 0; k < SAMPLE_W * SAMPLE_H; k++) rgba.fill(k < (SAMPLE_W * SAMPLE_H) / 2 ? top : bottom, k * 4, k * 4 + 3);
  return rgba;
}

test("a capture holds every frame of ten seconds with its brightness by parts, comes in parts the record of play takes, and its marks find a dip where it goes and comes back", () => {
  const out: number[] = [];
  brightness(copy(200, 100), SAMPLE_W, SAMPLE_H, out);
  expect(out.map((v) => Math.round(v * 100) / 100)).toEqual([150, 200, 200, 100, 100, 200, 100]);

  const session = { simTick: 1000, renderClock: 998, tickClock: 1003, stats: { clockJumps: 0, margin: 3 }, name: "owner", joined: 900 };
  const app = { session, governor: { level: 0 }, scene: { hour: 12, canvasWidth: 3456, canvasHeight: 2234 } } as unknown as App;
  const p = new FramePacket();
  p.tier = tierOf("ultra");
  const light = new LightCapture();
  expect(light.frame(0, p, app, copy(0, 0))).toBeNull();
  expect([light.start(0), light.start(5), light.on]).toEqual([true, false, true]);
  let parts: string[] | null = null, frames = 0, steps = 0;
  // A 120 Hz panel; the sun steps every 54 frames, and the lower half dips for two frames once a second.
  for (let k = 1; !parts; k++) {
    const now = (k * 1000) / 120;
    session.simTick = 1000 + Math.floor(now / 33.3);
    if (k % 54 === 0) (p.frame[FRAME.sun] += 0.001, steps++);
    parts = light.frame(now, p, app, k % 120 < 2 ? copy(200, 80) : copy(200, 100));
    frames++;
  }
  expect(light.on).toBe(false);
  expect(frames).toBe(Math.ceil((CAPTURE_MS * 120) / 1000));
  const reports = parts.map((t) => JSON.parse(t));
  expect(parts.every((t) => t.length <= PART_BYTES)).toBe(true);
  expect(reports.every((r) => r.v === PLAY_VERSION && r.name === "owner" && r.joined === 900 && r.to >= r.from && r.to - r.from <= 1024)).toBe(true);
  const [c] = captures(reports.map((page) => ({ page })));
  expect([c!.rows.length, c!.fields]).toEqual([frames, [...LIGHT_FIELDS]]);
  expect(c!.rows.filter((r) => r[LIGHT_FIELDS.indexOf("sunStepped")] === 1).length).toBe(steps);
  const marks = marked(c!, 1.5);
  // Ten dips, each marked where it goes and where it comes back, in the lower half, and nothing else.
  expect(marks.length).toBe(2 * Math.floor(frames / 120));
  expect(marks.every((m) => ["bottom", "bottomLeft", "bottomRight"].includes(m.part) && Math.abs(m.by) === 20)).toBe(true);
  expect(marks.filter((m) => m.by < 0).length).toBe(marks.length / 2);
});
