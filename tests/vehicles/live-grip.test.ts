// The grip of each surface a wheel meets is a setting (SurfaceGripAsphalt and the rest), carried in the tuning: the
// ground's surfaces and the road pieces of each take it, a car driving takes it at once, and its driver's page with it.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { deriveRegistry, parseTuning, tuningText } from "../../shared/content/tuning.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { mapHeightfield, writeMap } from "../../shared/world/mapfile.ts";
import { HIT_STRUCTURE, HIT_TERRAIN } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { ASPHALT, GRAVEL, GROUND_CLASS, MUD, OFFROAD, PAVING, SAND, vehicleSurfaceAt } from "../../shared/world/vehicle-surface.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { Lists } from "../../server/settings/lists.ts";
import { SURFACE_GRIPS, tuningOf } from "../../server/settings/tune.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const base = coreRegistry();

test("each surface's grip setting defaults to the surface's own, and only one that is set enters the tuning", () => {
  const own = [["SurfaceGripAsphalt", ASPHALT], ["SurfaceGripPaving", PAVING], ["SurfaceGripGround", OFFROAD], ["SurfaceGripGravel", GRAVEL], ["SurfaceGripSand", SAND], ["SurfaceGripMud", MUD]] as const;
  expect(Object.entries(SURFACE_GRIPS)).toEqual(own.map(([name, surface]) => [surface.id, name]));
  for (const [name, surface] of own) {
    const row = rowOf(name)!;
    expect([name, row.status, row.live, row.at, row.def]).toEqual([name, "live", true, "snark", surface.grip]);
  }
  const plain = loadConfig({}).rules;
  expect(tuningText(tuningOf(plain, new Lists(plain, base), base).tuning)).toBe("");
  const { rules, report } = loadConfig({ gus: "[SnarkSettings]\nSurfaceGripAsphalt=3\nSurfaceGripMud=0.4\nSurfaceGripSand=99\n" });
  expect(report.refused.map((r) => r.key)).toEqual(["SurfaceGripSand"]);
  expect(tuningOf(rules, new Lists(rules, base), base).tuning.surfaces).toEqual({ asphalt: 3, mud: 0.4 });
});

test("tuned content gives the ground's surfaces and the road pieces their grip, and leaves the rest the very surfaces they were", () => {
  const tuned = deriveRegistry(base, { surfaces: { asphalt: 3, mud: 0.4 } });
  // The same from its text, as a session makes it, with another hash than content as written and than another grip.
  const again = deriveRegistry(base, parseTuning(tuned.tuning)!);
  expect([again.hash, tuned.hash === base.hash, deriveRegistry(base, { surfaces: { asphalt: 3, mud: 0.5 } }).hash === tuned.hash]).toEqual([tuned.hash, false, false]);
  // Sand names no road piece, so its grip changes no definition: it is in the hash all the same.
  expect(deriveRegistry(base, { surfaces: { sand: 1 } }).hash === base.hash).toBe(false);

  // A world whose ground is asphalt wherever a place is given.
  const dims = { chunksX: 1, chunksZ: 1 };
  const world = (reg: typeof base): CollisionWorld => ({ hf: { groundClassAt: () => GROUND_CLASS.ASPHALT }, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) }) as unknown as CollisionWorld;
  const [plain, theirs] = [world(base), world(tuned)];
  expect(vehicleSurfaceAt(plain, HIT_TERRAIN, 0, 1, 1)).toBe(ASPHALT);
  expect(vehicleSurfaceAt(theirs, HIT_TERRAIN, 0, 1, 1)).toEqual({ ...ASPHALT, grip: 3 });
  // Off the ground's classes it is plain ground, which this tuning left alone.
  expect(vehicleSurfaceAt(theirs, HIT_TERRAIN, 0)).toBe(OFFROAD);
  // A road piece of asphalt and one of mud take their surfaces' grips; one of gravel is as it was.
  const piece = (reg: typeof base, name: string) => reg.parts.vehicleSurface![reg.index.get(name)!]!;
  const roads = base.ids.filter((id, k) => id !== undefined && base.parts.vehicleSurface?.[k]);
  expect(roads.length).toBeGreaterThan(2);
  for (const name of roads) {
    const was = piece(base, name), is = piece(tuned, name);
    expect([name, is.id, is.grip, is.rolling, is.drag]).toEqual([name, was.id, was.id === "asphalt" ? 3 : was.id === "mud" ? 0.4 : was.grip, was.rolling, was.drag]);
  }
  // A structure hit that is no road piece is plain ground.
  expect(vehicleSurfaceAt(theirs, HIT_STRUCTURE, 0)).toBe(OFFROAD);
});

test("a car driving takes a surface's new grip at once, and its driver's page predicts on it without a correction", () => {
  const map = flatMap(4);
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(map) });
  try {
    const s = h.join("driver");
    h.run(400);
    const c = h.client(s)!, a = h.world.ents, actor = h.host.records.byPid.get(c.pid)!;
    const hf = mapHeightfield(map);
    // A car is set down facing +z: it starts near the low edge with the map's length ahead of it.
    const [x0, z0] = [hf.sizeX / 2, 24];
    const car = h.host.spawnVehicle("core:compact", x0, z0, actor.team);
    a.setPosition(c.ent, x0 + 1.8, h.world.hf.heightAt(x0 + 1.8, z0) + 0.05, z0 + 0.1);
    h.world.history.discontinuity(c.ent);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK);
    h.run(1500);
    expect(s.driving).toBe(car);
    const pilot = h.pilots[0]!;
    const speed = (): number => Math.hypot(a.vx[car]!, a.vz[car]!);
    /** Braked to a stand, then full throttle for three seconds: the speed reached, and the corrections the page took on the way. */
    const launch = (): { speed: number; corrections: number } => {
      pilot.moveZ = 0;
      pilot.buttons = BTN_JUMP;
      h.run(15000);
      pilot.buttons = 0;
      h.run(500);
      expect(speed()).toBeLessThan(0.5);
      const before = s.stats.corrections;
      pilot.moveZ = 127;
      h.run(3000);
      const reached = speed();
      pilot.moveZ = 0;
      return { speed: reached, corrections: s.stats.corrections - before };
    };
    const firm = launch();
    expect(firm.speed).toBeGreaterThan(8);

    // The flat map's ground is plain ground. Made slick while the car stands, the same launch reaches far less.
    expect(h.host.setSetting("SurfaceGripGround", "1.5")).toBe("");
    h.run(500);
    expect([s.state, s.registry.hash, s.world!.structs.parts.surfaceGrip]).toEqual(["active", h.world.reg.hash, { ground: 1.5 }]);
    const slick = launch();
    expect(slick.speed).toBeGreaterThan(1);
    expect(slick.speed).toBeLessThan(firm.speed * 0.5);
    // The page drove on the same grip the server did.
    expect([firm.corrections, slick.corrections]).toEqual([0, 0]);

    // Changed with the car at speed, the page is corrected at the change and then agrees again.
    pilot.moveZ = 127;
    h.run(2000);
    expect(h.host.setSetting("SurfaceGripGround", "5.5")).toBe("");
    h.run(1500);
    const settled = s.stats.corrections;
    h.run(3000);
    expect(s.stats.corrections).toBe(settled);
    expect(a.z[car]!).toBeLessThan(hf.sizeZ - 20);
    expect([h.world.reg === h.reg, s.registry === h.reg, speed() > slick.speed]).toEqual([true, true, true]);
  } finally {
    h.host.shutdown();
  }
});
