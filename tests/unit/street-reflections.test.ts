import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { StreetReflections } from "../../client/core/render/street-reflections.ts";
import {
  coatWear,
  finishSeed,
  fixtureFace,
  fixtureKind,
  receiver,
  streetMaterial,
  streetMirror,
} from "../../client/core/render/street-finish.ts";

const reg = compileContent(CORE_CONTENT).registry!;
function street() {
  const dims = { chunksX: 2, chunksZ: 2 };
  const forms = nodeForms(reg);
  const world = {
    nodes: new StructureStore(dims, forms.halfX, forms.halfY, forms.halfZ, null, forms.parts),
    dims,
    hf: new Heightfield(dims, 4, 0, 1),
    structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts),
  };
  const cam = new Camera();
  cam.x = cam.z = 40;
  cam.y = 1.6;
  cam.update();
  const capture = new StreetReflections(reg, defaultPalette(), nodeForms(reg)), p = new FramePacket();
  p.tier = tierOf("high");
  p.lit = true;
  const cars = new RemoteSample(), hidden = new Set<number>();
  const tick = (now: number) => {
    cam.update();
    capture.frame(p, cam, world, cars, hidden, now);
  };
  const car = (n: number, x: number, z: number) => {
    cars.count = Math.max(cars.count, n + 1);
    cars.id[n] = 900 + n;
    cars.kind[n] = reg.index.get("core:compact")!;
    cars.x[n] = x;
    cars.z[n] = z;
    cars.colors[n * 6] = 41 + n;
  };
  return { world, cam, cars, p, tick, car, hidden };
}

test("a car shares the street picture, movement updates at the tier rate, turning still changes the lookup between captures", () => {
  const { p, tick, car, cars } = street();
  car(0, 40, 44);
  car(1, 44, 48);
  tick(0);
  expect(p.street?.revision).toBe(1);
  expect(p.frame[FRAME.reflection + 3]).toBe(0);
  const before = p.street!.pixels.slice();
  tick(200);
  expect(p.frame[FRAME.reflection + 3]).toBe(1);
  expect(p.street!.revision).toBe(1);
  p.frame.fill(1, FRAME.skyAbove, FRAME.skyAbove + 3);
  const see = (ray: number[]) => {
    const light = new Float64Array([1, 1, 1]);
    streetMirror(light, p, ray, p.frame[FRAME.reflection]!, p.frame[FRAME.reflection + 1]!, p.frame[FRAME.reflection + 2]!, 0.1, 1);
    return [...light];
  };
  expect(see([0.7, 0, 0.7])).not.toEqual(see([-0.7, 0, -0.7]));
  const ray = [0.7, 0, 0.7], settled = see(ray);
  cars.z[1] = 40;
  tick(249);
  expect(p.street!.pixels).toEqual(before);
  tick(250);
  expect(p.street!.revision).toBe(2);
  expect(p.street!.pixels).not.toEqual(before);
  expect(see(ray)).toEqual(settled);
  const transition = [45, 90, 135, 180].map(ms => {
    tick(250 + ms);
    return see(ray);
  });
  const latest = transition[3]!;
  expect(latest).not.toEqual(settled);
  for (const [i, weight] of [0.15625, 0.5, 0.84375, 1].entries()) {
    for (let c = 0; c < 3; c++) expect(transition[i]![c]).toBeCloseTo(settled[c]! + weight * (latest[c]! - settled[c]!), 5);
  }
  expect(p.previousStreet).toBeNull();
  p.tier = { ...p.tier, reflectionHz: 1 };
  cars.z[1] = 48;
  tick(500);
  cars.z[1] = 40;
  tick(1000);
  expect(p.street!.revision).toBe(3);
  tick(1500);
  expect(p.street!.revision).toBe(4);
  tick(2500);
  expect(p.street!.revision).toBe(4);
});

test("the visible larger receiver can win, deleted geometry leaves the picture, and empty, disabled or teleported views use the sky", () => {
  const { world, cam, cars, p, tick, car } = street();
  tick(0);
  expect(p.street).toBeNull();
  car(0, 40, 50);
  const kind = reg.index.get("core:zruin_zstore_clay")!;
  world.structs.add(kind, 40, 2, 44, 0, 0, 100);
  tick(250);
  expect(p.frame[FRAME.reflection + 2]).toBe(4);
  const before = p.street!.pixels.slice();
  const box = reg.index.get("core:zruin_zutility_concrete")!;
  const ref = world.structs.add(box, 43, 1, 44, 0, 0, 100);
  tick(500);
  expect(p.street!.pixels).not.toEqual(before);
  world.structs.remove(ref);
  tick(750);
  expect(p.street!.pixels).toEqual(before);
  expect(p.previousStreet).not.toBeNull();
  cam.z = 110;
  tick(751);
  expect(p.street).toBeNull();
  cam.z = 40;
  tick(752);
  expect(p.previousStreet).toBeNull();
  expect(p.frame[FRAME.reflection + 3]).toBe(0);
  p.tier = { ...p.tier, reflectionHz: 0 };
  tick(753);
  expect(p.street).toBeNull();
  cars.count = 0;
  cam.yaw = Math.PI;
  p.tier = tierOf("high");
  tick(754);
  expect(p.street).toBeNull();
});

test("a harvested tree leaves the next picture even while its near-store slot is still resident", () => {
  const { world, car, tick, p, hidden } = street();
  car(0, 40, 44);
  const form = nodeForms(reg).first[reg.index.get("core:tree")!]!;
  tick(0);
  const clear = p.street!.pixels.slice();
  const ref = world.nodes.add(form, 44, 0, 47, 0, 0, 100);
  tick(250);
  expect(p.street!.pixels).not.toEqual(clear);
  hidden.add(ref);
  tick(500);
  expect(p.street!.pixels).toEqual(clear);
});

test("paint wear travels with an entity and fixed fixtures distinguish the plinth, grate and gutter", () => {
  const a = finishSeed(900), b = finishSeed(901);
  expect(coatWear(0.4, 0.7, a, 0.001)).toBe(coatWear(0.4, 0.7, finishSeed(900), 0.001));
  expect(coatWear(0.4, 0.7, a, 0.001)).not.toBe(coatWear(0.4, 0.7, b, 0.001));
  expect(finishSeed(0, 40, 2, 44)).not.toBe(finishSeed(0, 40, 6, 44));
  const box = fixtureKind("core:zruin_zutility_concrete"), iron = fixtureKind("core:zruin_zdrain_concrete");
  expect([fixtureFace(box, 140), fixtureFace(box, 102), fixtureFace(iron, 11), fixtureFace(iron, 84), fixtureFace(0, 11)]).toEqual([
    1,
    0,
    2,
    0,
    0,
  ]);
  expect(receiver(streetMaterial("core:compact/body"), 1, 0.24, 0)).toBe(1);
  expect(receiver(streetMaterial("core:compact/trim"), 0, 0.88, 0)).toBe(0);
  expect(receiver(streetMaterial("core:street/street"), 0, 0.41, 0.9)).toBe(1);
  expect(receiver(streetMaterial("core:compact_wreck/body"), 1, 0.3, 0)).toBe(0);
});
