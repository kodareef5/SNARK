import { expect, test } from "bun:test";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { Sky, type SkyPoint, type SkyTaken, type SkyTarget } from "../../server/sky.ts";
import { lockScan, scanLock, type LockPick, type LockWorld } from "../../server/vehicle-lock.ts";
import { flatWorld } from "../fixtures/world.ts";

const pick = (): LockPick => ({ entity: -1, gen: 0, sky: null, x: 0, y: 0, z: 0, angle: 0 });
function world(chunks = 8, cap = 64): LockWorld & { kind(id: string): number } {
  const w = flatWorld(chunks);
  const ents = new EntityStore(w.dims, cap, cap, w.reg.vehicle);
  return { ...w, ents };
}
/** A craft in the sky at a fixed place, which a missile may lock or not. */
function craft(x: number, y: number, z: number, lockable = true): SkyTarget {
  const NONE: SkyTaken = { taken: 0, blocked: false, killed: false };
  return {
    name: "Unidentified craft", lockable, radius: 11,
    at(_t: number, out: SkyPoint): boolean { out.x = x; out.y = y; out.z = z; out.vx = out.vy = out.vz = 0; return true; },
    ray: () => Infinity, gap: (px, py, pz) => Math.hypot(px - x, py - y, pz - z) - 11, take: () => NONE,
  };
}

// The seeker looks from (100, 50, 100) along +Z, as a jet's nose would.
const O = [100, 50, 100] as const;

test("the seeker takes vehicles and ridden or flying creatures within its cone and range, nearest the nose's line", () => {
  const w = world(), sky = new Sky(), out = pick();
  const heli = w.ents.create(w.kind("core:helicopter"), 100, 40, 400, 0);
  // A creature standing nobody rides is passed over; the same creature in flight is taken.
  const bird = w.ents.create(w.kind("core:survivor"), 130, 60, 300, 0);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(true);
  expect(out.entity).toBe(heli);
  w.ents.mode[bird] = MODE_FLYER;
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(true);
  // Both are in the cone; the helicopter is nearer the nose's line.
  expect(out.entity).toBe(heli);
  w.ents.driven[bird] = 1; w.ents.mode[bird] = 0; w.ents.setPosition(bird, 100, 49, 300);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(true);
  expect(out.entity).toBe(bird);
  // The shooter and what it rides are never its own targets.
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, bird, -1, out)).toBe(true);
  expect(out.entity).toBe(heli);
});

test("nothing outside the cone, past the range or behind the world is locked", () => {
  const w = world(), sky = new Sky(), out = pick();
  const heli = w.ents.create(w.kind("core:helicopter"), 100, 40, 400, 0);
  // Off to the side: 45 degrees off the nose.
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], Math.SQRT1_2, 0, Math.SQRT1_2, .26, 1800, -1, -1, out)).toBe(false);
  // Past the range.
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 250, -1, -1, out)).toBe(false);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 400, -1, -1, out)).toBe(true);
  // A wall between hides it.
  for (let x = 94.5; x <= 105.5; x += 3) for (let y = 37.5; y <= 52.5; y += 3) w.structs.add(w.kind("core:wall"), x, y, 250, 0, 0, 1);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(false);
  w.ents.y[heli] = 200;
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, .55, .83, .26, 1800, -1, -1, out)).toBe(true);
  expect(out.entity).toBe(heli);
});

test("a lockable craft in the sky is taken as a body is, and one that may not be locked is passed over", () => {
  const w = world(), sky = new Sky(), out = pick();
  const ufo = craft(100, 120, 480), shy = craft(100, 50, 450, false);
  sky.add(ufo); sky.add(shy);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(true);
  expect(out.sky).toBe(ufo); expect(out.entity).toBe(-1);
  expect([out.x, out.y, out.z]).toEqual([100, 120, 480]);
  sky.remove(ufo);
  expect(scanLock(w, sky, 1, O[0], O[1], O[2], 0, 0, 1, .26, 1800, -1, -1, out)).toBe(false);
});

test("a scan looks only in the chunks its cone reaches, whatever stands elsewhere", () => {
  const w = world(64, 1024), sky = new Sky(), out = pick(), kind = w.kind("core:helicopter");
  // A crowd of vehicles to the side of and behind the nose, and one ahead.
  for (let x = 120; x < 4000; x += 200) for (let z = 120; z < 4000; z += 200) if (Math.abs(x - 1000) > 600 || z < 1000) w.ents.create(kind, x, 40, z, 0);
  const ahead = w.ents.create(kind, 1000, 60, 2200, 0);
  expect(scanLock(w, sky, 1, 1000, 50, 1000, 0, 0, 1, .26, 1800, -1, -1, out)).toBe(true);
  expect(out.entity).toBe(ahead);
  // The cone's box is 15 chunks across and 29 along; of those, the ones off the cone are passed over unopened.
  expect(lockScan.chunks + lockScan.culled).toBeLessThanOrEqual(15 * 30);
  expect(lockScan.culled).toBeGreaterThan(lockScan.chunks / 3);
  expect(lockScan.weighed).toBe(1);
  expect(lockScan.casts).toBe(1);
});
