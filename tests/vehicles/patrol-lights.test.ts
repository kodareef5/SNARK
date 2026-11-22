import { expect, test } from "bun:test";
import { lampOf } from "../../client/core/render/detailtext.ts";
import { BONE_FLOATS, DETAIL, DETAIL_FLOATS, DETAIL_LAMP, FramePacket } from "../../client/core/render/packet.ts";
import { MAX_PATROL_CARDS, PatrolLights, patrolLampStrength } from "../../client/core/render/patrol-lights.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { EmergencyLamp } from "../../shared/sim/vehicle.ts";

test("patrol rises and fades, response alternates single flashes, pursuit alternates separated double flashes", () => {
  const periods = [0, 2.6, .98, .92];
  const peak: number[] = [];
  for (const mode of [1, 2, 3]) {
    let starts = 0, previous = 0, maximum = 0, bothDark = 0, overlap = 0;
    for (let frame = 0; frame < 1000; frame++) {
      const t = (frame + .5) / 1000 * periods[mode]!;
      const red = patrolLampStrength(mode, "red", t), blue = patrolLampStrength(mode, "blue", t);
      if (red && !previous) starts++;
      if (!red && !blue) bothDark++;
      if (red && blue) overlap++;
      maximum = Math.max(maximum, red);
      previous = red;
    }
    expect(starts).toBe(mode === 3 ? 2 : 1);
    expect(overlap).toBe(0);
    expect(bothDark).toBeGreaterThan(100);
    peak.push(maximum);
  }
  expect(peak[0]!).toBeLessThan(peak[1]!);
  expect(peak[1]!).toBeLessThan(peak[2]!);
  expect(patrolLampStrength(1, "red", .24)).toBeLessThan(patrolLampStrength(1, "red", .49));
  expect(patrolLampStrength(1, "red", .24)).toBeCloseTo(patrolLampStrength(1, "red", .74));
  for (const seconds of [0, .25, .5, 1]) expect(patrolLampStrength(0, "red", seconds)).toBe(0);
});

test("emissive strips follow the scaled, banked chassis, face the eye, and only draw the visible active bank", () => {
  const p = new FramePacket(), lights = new PatrolLights(), size = 2, first = 3;
  // Model is rotated a quarter turn about Z, sits between the camera and +Z, and presents its rear to the camera.
  p.bones.set([0, -size, 0, 5, size, 0, 0, -1, 0, 0, size, 8], first * BONE_FLOATS);
  const lamps: EmergencyLamp[] = [
    { at: [.5, 2, -.2], color: "red", facing: "rear" },
    { at: [.5, 2, .2], color: "red", facing: "front" },
    { at: [-.5, 2, -.2], color: "blue", facing: "rear" },
  ];
  lights.add(p, first, lamps, 3, 0, 0, size);
  lights.write(p);
  expect(p.detailCount).toBe(1);
  const point = [1, 0, 7.6], f = p.details;
  for (let j = 0; j < 3; j++) expect(Math.abs(f[j]! - point[j]!)).toBeLessThan(.05);
  for (const offset of [DETAIL.across, DETAIL.along]) {
    expect(point[0]! * f[offset]! + point[1]! * f[offset + 1]! + point[2]! * f[offset + 2]!).toBeCloseTo(0);
  }
  expect(f[DETAIL.across + 1]!).toBeGreaterThan(0);
  expect((p.detailWords[DETAIL.misc]! >>> 8) & 255).toBe(DETAIL_LAMP);
  expect((p.detailWords[DETAIL.misc]! >>> 16) & 255).toBe(255);
  expect(p.detailWords[DETAIL.colourA]! & 255).toBe(255);
  p.beginFrame(); lights.begin();
  lights.add(p, first, lamps, 3, .51 * TICK_RATE, 0, size); lights.write(p);
  expect(p.detailCount).toBe(1);
  expect((p.detailWords[DETAIL.colourA]! >>> 16) & 255).toBe(255);
  p.beginFrame(); lights.begin();
  lights.add(p, first, lamps, 0, .51 * TICK_RATE, 0, size); lights.write(p);
  expect(p.detailCount).toBe(0);
});

test("a dense fleet respects a fixed budget; the analytic lamp has a hot strip, a fading halo, and a transparent boundary", () => {
  const p = new FramePacket(), lights = new PatrolLights();
  const lamp: EmergencyLamp[] = [{ at: [0, 0, 0], color: "red" }];
  // The end-on case, in which the long axis projects to a point.
  p.bones.set([1, 0, 0, -8, 0, 1, 0, 0, 0, 0, 1, 0]);
  for (let i = 0; i < MAX_PATROL_CARDS + 1; i++) lights.add(p, 0, lamp, 2, 0, 0, 1);
  lights.write(p);
  expect(p.detailCount).toBe(MAX_PATROL_CARDS);
  expect([...p.details.slice(0, DETAIL_FLOATS - 3)].every(Number.isFinite)).toBe(true);
  const s = [0, 0, 0];
  lampOf(0, 0, s); expect(s).toEqual([1, 1, 1]);
  lampOf(.28, 0, s); expect(s).toEqual([1, 1, 1]);
  lampOf(0, .48, s); expect(s[0]).toBeGreaterThan(0); expect(s[0]).toBeLessThan(.2); expect(s[1]).toBe(0);
  lampOf(0, 1, s); expect(s[0]).toBe(0);
});
