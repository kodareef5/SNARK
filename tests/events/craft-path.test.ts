// A craft's path, pose, fall and hull as every party works them out (shared/sim/craft.ts), and the pass that keeps a
// path clear of what stands below (shared/mapevent/plan.ts).

import { expect, test } from "bun:test";
import { clearPath, edgePoint } from "../../shared/mapevent/plan.ts";
import { buildTrack, fallPose, hullGap, lowAt, newCraftPose, rayHull, rayNearBox, trackPose, type PathPoint } from "../../shared/sim/craft.ts";

const point = (x: number, y: number, z: number, speed: number, low = false): PathPoint => ({ x, y, z, speed, low });

/** Edge to edge with a low pass in the middle: high and fast, then low and slow, then high again. */
const crossing = (): PathPoint[] => [point(100, 900, 100, 140), point(1500, 950, 400, 140), point(2500, 150, 1200, 45, true), point(3100, 140, 1700, 45, true), point(4200, 1000, 2400, 140), point(5900, 900, 3900, 140)];

test("a path is flown at the speeds of its points, the same on every run, and is still at its ends", () => {
  const track = buildTrack(crossing());
  const again = buildTrack(crossing());
  expect(again.seconds).toBe(track.seconds);
  const a = newCraftPose();
  const b = newCraftPose();
  for (let t = 0; t <= track.seconds; t += 7.31) {
    expect(trackPose(track, t, a)).toBe(true);
    trackPose(again, t, b);
    expect([b.x, b.y, b.z, b.vx, b.vy, b.vz]).toEqual([a.x, a.y, a.z, a.vx, a.vy, a.vz]);
  }
  // Its speed along the way is what its points ask: 140 at cruise, 45 between the low points.
  trackPose(track, 2, a);
  expect(Math.hypot(a.vx, a.vy, a.vz)).toBeCloseTo(140, 0);
  const lowFrom = track.times[2 * 16]!;
  const lowTo = track.times[3 * 16]!;
  trackPose(track, (lowFrom + lowTo) / 2, a);
  expect(Math.hypot(a.vx, a.vy, a.vz)).toBeCloseTo(45, 0);
  // Before it enters and after it leaves it is at its ends, not moving, and not in the sky.
  expect(trackPose(track, -5, a)).toBe(false);
  expect(Math.hypot(a.x - 100, a.y - 900, a.z - 100) + Math.abs(a.vx)).toBeLessThan(1e-9);
  expect(trackPose(track, track.seconds + 5, a)).toBe(false);
  expect(Math.hypot(a.x - 5900, a.y - 900, a.z - 3900) + Math.abs(a.vz)).toBeLessThan(1e-9);
});

test("a pose between ticks is between the poses at the ticks, so a fractional view tick is judged smoothly", () => {
  const track = buildTrack(crossing());
  const a = newCraftPose();
  const m = newCraftPose();
  const b = newCraftPose();
  for (const t of [10, 55.5, 120.25, 200]) {
    trackPose(track, t, a);
    trackPose(track, t + 1 / 60, m);
    trackPose(track, t + 1 / 30, b);
    // Within a sample a craft goes evenly: the half tick is halfway.
    expect(Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2, m.z - (a.z + b.z) / 2)).toBeLessThan(0.05);
  }
});

test("its beam is on along a low stretch and eases in and out either side of it", () => {
  const track = buildTrack(crossing());
  const from = track.times[2 * 16]!;
  const to = track.times[3 * 16]!;
  expect(lowAt(track, (from + to) / 2)).toBe(1);
  expect(lowAt(track, from - 1.25)).toBeCloseTo(0.5, 5);
  expect(lowAt(track, to + 1.25)).toBeCloseTo(0.5, 5);
  expect(lowAt(track, from - 10)).toBe(0);
  expect(lowAt(track, 1)).toBe(0);
});

test("a downed craft falls by its own pull and bleed, its speed along the ground gone by the time the bleed says", () => {
  const out = newCraftPose();
  fallPose(0, 500, 0, 100, 0, 0, 0, 7.5, 0.12, out);
  expect([out.x, out.y, out.vx]).toEqual([0, 500, 100]);
  fallPose(0, 500, 0, 100, 0, 0, 2, 7.5, 0.12, out);
  expect(out.y).toBeCloseTo(500 - 15, 6);
  expect(out.vx).toBeCloseTo(76, 6);
  // At 1 / bleed seconds it has stopped going along, and goes no further.
  fallPose(0, 500, 0, 100, 0, 0, 1 / 0.12, 7.5, 0.12, out);
  const stopped = out.x;
  expect(out.vx).toBeCloseTo(0, 9);
  fallPose(0, 500, 0, 100, 0, 0, 20, 7.5, 0.12, out);
  expect(out.x).toBe(stopped);
  // With no bleed it keeps its speed, and a harder pull brings it down sooner.
  fallPose(0, 500, 0, 100, 0, 0, 10, 7.5, 0, out);
  expect(out.x).toBe(1000);
  fallPose(0, 500, 0, 0, 0, 0, 5, 20, 0.12, out);
  expect(out.y).toBe(250);
});

test("a ray meets a hull flattened to its half height, and a point's gap to it is its distance to the hull", () => {
  // A disc 11 m round and 3.2 m from its middle to its top, at (0, 100, 0).
  expect(rayHull(0, 100, 0, 11, 3.2, -50, 100, 0, 1, 0, 0, 100)).toBeCloseTo(39, 6);
  expect(rayHull(0, 100, 0, 11, 3.2, 0, 0, 0, 0, 1, 0, 200)).toBeCloseTo(96.8, 6);
  // Past its rim, under its belly, beyond the ray's reach, and pointing away: no meeting.
  expect(rayHull(0, 100, 0, 11, 3.2, -50, 104, 0, 1, 0, 0, 100)).toBe(Infinity);
  expect(rayHull(0, 100, 0, 11, 3.2, -50, 100, 0, 1, 0, 0, 30)).toBe(Infinity);
  expect(rayHull(0, 100, 0, 11, 3.2, -50, 100, 0, -1, 0, 0, 100)).toBe(Infinity);
  expect(rayHull(0, 100, 0, 11, 3.2, 1, 100, 1, 1, 0, 0, 100)).toBe(0);
  expect(hullGap(0, 100, 0, 11, 3.2, 20, 100, 0)).toBeCloseTo(9, 6);
  expect(hullGap(0, 100, 0, 11, 3.2, 0, 110, 0)).toBeCloseTo(6.8, 6);
  expect(hullGap(0, 100, 0, 11, 3.2, 0, 100, 0)).toBe(-3.2);
  // Anywhere round it, the gap is the distance to the nearest point of the hull: outside, and less than 0 inside.
  for (const [radius, half] of [[11, 3.2], [2, 6]] as const) {
    for (const [x, y] of [[12, 104], [8, 106], [3, 103.5], [0.5, 100.2], [30, 140], [6, 99], [1, 107]] as const) {
      let nearest = Infinity;
      for (let k = 0; k <= 20000; k++) {
        const a = (k / 20000) * Math.PI;
        nearest = Math.min(nearest, Math.hypot(x - radius * Math.sin(a), y - (100 + half * Math.cos(a))));
      }
      const inside = (x / radius) ** 2 + ((y - 100) / half) ** 2 < 1;
      expect(hullGap(0, 100, 0, radius, half, x, y, 0)).toBeCloseTo(inside ? -nearest : nearest, 3);
      // The same about its up, whichever way round.
      expect(hullGap(0, 100, 0, radius, half, x * 0.6, y, -x * 0.8)).toBeCloseTo(inside ? -nearest : nearest, 3);
    }
  }
});

test("a ray far from the whole of a path is passed without the craft's pose being asked", () => {
  const track = buildTrack(crossing());
  const box = track.box;
  // Under every point of the path, straight up: it reaches it.
  expect(rayNearBox(box, 12, 2500, 0, 1200, 0, 1, 0, 2000)).toBe(true);
  // From the ground at the far corner, along the ground, and up but short of the lowest of it, which the spline takes below its lowest point where it dives in.
  expect(rayNearBox(box, 12, 8000, 0, 8000, 0, 1, 0, 2000)).toBe(false);
  expect(rayNearBox(box, 12, 3000, 2, 1500, 1, 0, 0, 600)).toBe(false);
  expect(rayNearBox(box, 12, 3000, 0, 1500, 0, 1, 0, 50)).toBe(false);
  // Every sample of the path is inside its box.
  const pose = newCraftPose();
  for (let t = 0; t <= track.seconds; t += 3) {
    trackPose(track, t, pose);
    expect(pose.x >= box[0]! - 1e-9 && pose.x <= box[3]! + 1e-9 && pose.y >= box[1]! - 1e-9 && pose.y <= box[4]! + 1e-9).toBe(true);
  }
});

test("a path that dips into a tower is raised clear of it, and one already clear is left as it was", () => {
  // A tower 300 m tall on a 60 m square in the middle of a low pass.
  const world = { sizeX: 6000, sizeZ: 6000, top: (x: number, z: number, r: number) => (Math.abs(x - 2800) < 30 + r && Math.abs(z - 1450) < 30 + r ? 300 : 0) };
  const points = crossing();
  const track = clearPath(points, world, 60);
  const pose = newCraftPose();
  let lowest = Infinity;
  for (let t = 0; t <= track.seconds; t += 0.25) {
    trackPose(track, t, pose);
    if (Math.abs(pose.x - 2800) < 60 && Math.abs(pose.z - 1450) < 60) lowest = Math.min(lowest, pose.y);
  }
  expect(lowest).toBeGreaterThanOrEqual(360 - 1e-6);
  // Heights stay as the wire carries them.
  for (const p of points) expect(Math.round(p.y * 32)).toBe(p.y * 32);
  const flat = crossing();
  clearPath(flat, { sizeX: 6000, sizeZ: 6000, top: () => 0 }, 60);
  expect(flat).toEqual(crossing());
});

test("an edge point goes round the map's square from its origin corner, inset from each side", () => {
  const map = { sizeX: 1000, sizeZ: 2000 };
  expect(edgePoint(map, 0, 100)).toEqual({ x: 100, z: 100 });
  expect(edgePoint(map, 0.125, 100)).toEqual({ x: 500, z: 100 });
  expect(edgePoint(map, 0.375, 100)).toEqual({ x: 900, z: 1000 });
  expect(edgePoint(map, 0.625, 100)).toEqual({ x: 500, z: 1900 });
  expect(edgePoint(map, 1.875, 100)).toEqual({ x: 100, z: 1000 });
  expect(edgePoint(map, -0.125, 100)).toEqual({ x: 100, z: 1000 });
});
