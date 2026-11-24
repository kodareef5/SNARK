import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { GEAR_WORN } from "../../shared/sim/entities.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { ParkedContacts } from "../../client/core/render/contact.ts";
import { deflectTire, TireContacts, tireShadow } from "../../client/core/render/tire-contact.ts";
import { paneOptics } from "../../client/core/render/windscreens.ts";
import { BONE_FLOATS, FRAME, FramePacket, MAX_TIRE_CONTACTS } from "../../client/core/render/packet.ts";
import { streetSilhouette } from "../../client/core/render/street-silhouettes.ts";
import { StreetReflections } from "../../client/core/render/street-reflections.ts";
import {
  FINE_STREET_WIDTH, STREET_WIDTH, streetTextureBytes, streetWidth, wheelBoneMask, wheelFinish, tireMould, tireRelief, rubberShare, vehicleWeather, weatherVehicle, StreetMaterials,
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
  return { world, cam, cars, p, tick, car, hidden, capture };
}

test("a nearby worn visor can anchor the shared picture until it is removed or leaves close range", () => {
  const { cars, p, tick } = street();
  cars.count = 1;
  cars.kind[0] = reg.index.get("core:survivor")!;
  cars.id[0] = 7;
  cars.x[0] = 40;
  cars.z[0] = 42;
  tick(0);
  expect(p.street).toBeNull();
  cars.gear[GEAR_WORN] = reg.index.get("core:meridian_hat")!;
  tick(250);
  expect(p.street).not.toBeNull();
  cars.z[0] = 55;
  tick(500);
  expect(p.street).toBeNull();
  cars.z[0] = 42;
  cars.gear[GEAR_WORN] = 0;
  tick(750);
  expect(p.street).toBeNull();
});

test("a helmet is reflected for its visor, not its id", () => {
  // A head piece of another name with a visor, and the flak helmet, which has none.
  const made = compileContent([...CORE_CONTENT, { type: "item", class: "armor", id: "test:scout_helm", stack: 1, weight: 4, color: 2, wear: { slot: "head", set: "hide", armor: 100, uses: 120, colors: [2, 11, 6] }, optic: { min: 2, max: 8, window: [0.8, 0.3], shape: "visor" } }]);
  expect(made.errors).toEqual([]);
  const other = made.registry!;
  const capture = new StreetReflections(other, defaultPalette(), nodeForms(other));
  const { world, cam, cars, p, hidden } = street();
  cars.count = 1;
  cars.kind[0] = other.index.get("core:survivor")!;
  cars.id[0] = 7;
  cars.x[0] = 40;
  cars.z[0] = 42;
  const worn = (id: string, now: number): boolean => {
    cars.gear[GEAR_WORN] = other.index.get(id)!;
    capture.frame(p, cam, world, cars, hidden, now);
    return p.street !== null;
  };
  expect([worn("core:flak_hat", 0), worn("test:scout_helm", 250), worn("core:meridian_hat", 500), worn("core:flak_hat", 750)]).toEqual([false, true, true, false]);
});

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
  expect(receiver(streetMaterial("core:compact_wreck/body"), 1, 0.3, 0)).toBe(1);
  expect(receiver(streetMaterial("core:compact_wreck/body"), 0, 0.95, 0)).toBe(0);
});

test("wheel contact follows the nearest supported tires and vanishes when the car lifts or tips", () => {
  const { p, world } = street();
  const contacts = new TireContacts(), wheels = new Int16Array([0]), rest = [0, 0.3, 0];
  p.camX = p.camZ = 40;
  const place = (bone: number, x: number, lift = 0, tipped = false) => {
    p.bones.set(tipped ? [0,-1,0,x, 1,0,0,0.3, 0,0,1,0] : [1,0,0,x, 0,1,0,lift, 0,0,1,0], bone*BONE_FLOATS);
    contacts.consider(p, bone, wheels, rest, 0.3);
  };
  for (let bone = 0; bone < MAX_TIRE_CONTACTS + 2; bone++) place(bone, 12-bone);
  contacts.build(p, world);
  const ids = Array.from({ length: contacts.count }, (_, i) => p.frame[FRAME.tireContacts+i*4+3]!);
  expect(ids.sort((a,b) => a-b)).toEqual([3,4,5,6,7,8,9,10]);
  expect(tireShadow(0,0)).toBeCloseTo(0.9);
  expect(tireShadow(0.8,0)).toBeLessThan(tireShadow(0.5,0));
  expect(tireShadow(1,0)).toBe(0);
  contacts.begin();
  p.beginFrame();
  place(0, 2, 1);
  place(1, 2, 0, true);
  place(2, 20);
  contacts.build(p,world);
  expect(contacts.count).toBe(0);
  expect(p.frame[FRAME.tireContacts+3]).toBe(0);
});

test("a supported bottom sidewall widens slightly, clears the road and leaves the top and hub alone", () => {
  const { p } = street(), rest = [0,0.3,0], m = new Float32Array([1,0,0,0, 0,1,0,-0.01, 0,0,1,0]);
  const positions = new Float32Array([0.1,0,0, 0.1,0.6,0, 0.04,0.29,0]);
  p.frame.set([0,0,0,1],FRAME.tireContacts);
  const out = positions.slice();
  for (let i=0; i<3; i++) out[3*i+1]! -= 0.01;
  const original = out.slice();
  for (let i=0; i<3; i++) deflectTire(p.frame,0,0,rest,positions,i,0,0,0,m,out);
  expect(out[0]!-original[0]!).toBeCloseTo(0.0285,4);
  expect(out[1]).toBeCloseTo(0.0015,4);
  expect(out.slice(3)).toEqual(original.slice(3));
  // Half a spin exchanges these vertices. The part adjacent to the road still carries the load.
  const spun = new Float32Array([1,0,0,0, 0,-1,0,0.59, 0,0,-1,0]);
  const topNowAtBottom = new Float32Array([0,0,0, 0.1,-0.01,0]);
  deflectTire(p.frame,0,0,rest,positions,1,0,0,0,spun,topNowAtBottom);
  expect(topNowAtBottom[3]).toBeCloseTo(out[0]!,4);
  expect(topNowAtBottom[4]).toBeCloseTo(out[1]!,4);
});

test("only wheel joints carry the finish, clean and wiped plating shine differently, and rubber keeps its moulding", () => {
  expect(wheelBoneMask(["chassis","wheel_front_left","steering_wheel"])).toBe(2);
  const finish = (rough: number, metal: number, seed: number, y = 0.845, x = 0.1, z = 0, base = 0.1) => {
    const rgb = new Float64Array([base,base,base]), orm = new Float64Array([1,rough,metal]);
    const chrome = wheelFinish(rgb,orm,1,rubberShare(metal,rough,Math.hypot(y,z)),1,x,y,z,seed,0.001);
    return { tone: rgb[0]!, rough: orm[1]!, chrome };
  };
  const clean = finish(0.3,0.95,0.1), wiped = finish(0.3,0.95,0.86);
  expect(clean.chrome).toBe(1);
  expect(clean.tone).toBeGreaterThan(0.8);
  expect(clean.rough).toBeLessThan(wiped.rough);
  expect(finish(0.3,0.95,0.86)).toEqual(wiped);
  const plain = finish(0.8,0,0.5,0.81), ridge = finish(0.8,0,0.5);
  expect(plain.chrome).toBe(0);
  expect(ridge.tone).toBeGreaterThan(plain.tone);
  expect(tireMould(0.1,0.845,0,0.05)).toBe(0);
  // Rubber is two to four per cent whatever shade it was painted, rougher on its dressed wall than on its worn tread,
  // and never smooth enough to take the rim's reflection.
  for (const base of [0.01,0.017,0.03,0.1]) {
    const wall = finish(0.84,0.02,0.5,0.81,0.3,0,base), tread = finish(0.84,0.02,0.5,0.99,0.02,0.05,base);
    expect(wall.tone).toBeGreaterThan(0.018);
    expect(wall.tone).toBeLessThan(0.04);
    expect(tread.rough).toBeLessThan(wall.rough);
    expect(tread.rough).toBeGreaterThanOrEqual(0.5);
  }
  // The ribs stand out from the wall, and the shoulder's grooves sink in: the slope changes sign across each.
  const slope = new Float64Array(3);
  tireRelief(slope,0.3,0.845-0.006,0,0.001);
  expect(slope[1]).toBeGreaterThan(0);
  tireRelief(slope,0.3,0.845+0.006,0,0.001);
  expect(slope[1]).toBeLessThan(0);
  tireRelief(slope,0.3,0.845+0.006,0,0.05);
  expect(Math.abs(slope[1]!)).toBe(0);
});

test("unmasked truck rims, painted centres, and brake discs keep distinct finishes", () => {
  const sample = (rough: number, metal: number, x: number, radius: number) => wheelFinish(new Float64Array(3),Float64Array.of(1,rough,metal),0,0,1,x,radius,0,0.42,0.001,x);
  expect(sample(122/255,165/255,0.36,0.52)).toBeGreaterThan(0.6);
  expect(sample(122/255,165/255,0.03,0.52)).toBe(0);
  expect(sample(0.85,0.03,0.35,0.98)).toBe(0);
  const cache = new StreetMaterials(1,[{id:"future:truck"}]);
  expect(cache.code(0,"",0,true)).toBe(0);
  expect(cache.code(0,"future:truck/coach",0,true)).toBe(2);
  expect(cache.code(0,"future:truck/coach",0,false)).toBe(0);
});

test("salvage leaves some bare metal visible beside rough oxide, with the worst damage on a burnt shell", () => {
  const values: number[] = [];
  for(let i=0; i<120; i++) {
    const orm = Float64Array.of(1,0.47,0.85);
    weatherVehicle(Float64Array.of(0.22,0.24,0.23),orm,i*0.07,0.6,0.4,0.32,vehicleWeather("core:tanker_burnout"));
    values.push(orm[2]!);
  }
  expect(Math.min(...values)).toBeLessThan(0.1);
  expect(Math.max(...values)).toBeGreaterThan(0.8);
  expect(vehicleWeather("core:tanker_burnout")).toBeGreaterThan(vehicleWeather("core:tanker_abandoned"));
  expect(vehicleWeather("core:veloce")).toBe(0);
  const trailer = fixtureKind("core:box_trailer");
  expect([fixtureFace(trailer,82,0.8,-5.1),fixtureFace(trailer,102,0.6,-3.75),fixtureFace(trailer,102,2,0)]).toEqual([5,4,6]);
});

test("an upright parked vehicle darkens the road and leaves the contact list when removed", () => {
  const {world,cam,p} = street();
  const parked = new ParkedContacts(reg);
  const bounds = [{center:[0,2,0],half:[1.31,2,6.14]}] as const;
  const meshOf = new Uint16Array(reg.defs.length);
  const kind = reg.index.get("core:box_trailer")!;
  const ref = world.structs.add(kind,40,0,43,0,0,100);
  parked.add(p.frame,world.structs,bounds,meshOf,cam);
  expect(p.frame[FRAME.contact+6]).toBeCloseTo(-6.14);
  world.structs.remove(ref);
  p.frame.fill(0);
  parked.add(p.frame,world.structs,bounds,meshOf,cam);
  expect(p.frame[FRAME.contact+4]).toBe(0);
});

test("the windscreen transmits the road from the driver's seat and gains reflection at a grazing angle", () => {
  const out = new Float64Array(2);
  const sample = (angle: number, y: number) => { paneOptics(angle,y,0.5,0.35,out); return [...out]; };
  const [outside, share] = sample(1,0), [inside] = sample(-1,0), [edge, edgeShare] = sample(0.1,0);
  expect(inside!).toBeLessThan(outside!);
  expect(outside!).toBeLessThan(0.25);
  expect(edge!*edgeShare!).toBeGreaterThan(outside!*share!*4);
  expect(sample(1,0.95)[0]!).toBeGreaterThan(outside!);
});

test("capacity changes select a smaller shared panorama and discard incompatible history", () => {
  const {car,tick,p} = street();
  car(0,40,42);
  car(1,38,47);
  tick(0);
  expect(streetWidth(p.street!)).toBe(FINE_STREET_WIDTH);
  car(1,37,47);
  tick(250);
  expect(p.previousStreet).not.toBeNull();
  p.tier = tierOf("medium");
  tick(251);
  expect(streetWidth(p.street!)).toBe(STREET_WIDTH);
  expect(p.previousStreet).toBeNull();
  expect(p.frame[FRAME.previousReflection+3]).toBe(0);
  p.tier = tierOf("lowpoly");
  tick(252);
  expect(p.street).toBeNull();
  p.tier = tierOf("high");
  tick(253);
  expect(streetWidth(p.street!)).toBe(FINE_STREET_WIDTH);
  expect(p.previousStreet).toBeNull();
});

test("reflection silhouettes include the authored window bays and the compact's painted body, glass and rubber", () => {
  const windowKind = reg.index.get("core:zruin_zwin_concrete")!;
  const window = streetSilhouette(reg,windowKind)!;
  const lights = window.filter(part => part.color === 83);
  expect(lights.length).toBe(2);
  expect(lights[0]!.at[0]).toBeCloseTo(-lights[1]!.at[0],5);
  const car = streetSilhouette(reg,reg.index.get("core:compact")!)!;
  expect(car.some(part => part.color === undefined)).toBe(true);
  expect(car.some(part => part.color === 83)).toBe(true);
  expect(car.filter(part => part.color === 230).length).toBe(4);
  expect(streetSilhouette(reg,reg.index.get("core:survivor")!)).toBeNull();
});

test("walking between receivers six metres apart crossfades their world-space samples at full strength", () => {
  const {p,cam,tick,car} = street();
  car(0,40,44); car(1,47,44); tick(0); tick(200);
  const previous = p.street!;
  cam.x = 47; tick(250);
  expect(p.previousStreet).toBe(previous);
  expect(p.frame[FRAME.previousReflection]).toBe(-7);
  expect(p.frame[FRAME.reflection]).toBe(0);
  expect(p.frame[FRAME.reflection+3]).toBe(1);
  tick(340);
  expect(p.frame[FRAME.previousReflection+3]).toBeCloseTo(0.5);
  cam.x = 80; car(1,80,44); tick(500);
  expect(p.previousStreet).toBeNull();
  expect(p.frame[FRAME.reflection+3]).toBe(0);
});

test("touch uses at most one capture a second and budgets both complete texture layers", () => {
  expect(["lowpoly","medium","high","ultra"].map(name => forTouch(tierOf(name),true).reflectionHz)).toEqual([0,1,1,1]);
  expect([0,1,2,4].map(streetTextureBytes)).toEqual([0,21848,21848,87384]);
});

test("a close receiver between sampled rows in a dense chunk enters the next picture, and removal clears it", () => {
  const {world,tick,p,capture,cam} = street();
  const plain = reg.index.get("core:zruin_zpipe4_concrete")!, sign = reg.index.get("core:zruin_zsign_mint")!;
  for (let i=0; i<501; i++) world.structs.add(plain,3,2,3,0,0,100);
  const ref = world.structs.add(sign,40,1,44,0,0,100);
  for (let i=0; i<98; i++) world.structs.add(plain,3,2,3,0,0,100);
  expect(Array.from({length:192}, (_, i) => Math.floor(i*600/192))).not.toContain(ref);
  capture.indexChunk(world.structs.chunks[0]!,0,0,cam);
  tick(0); expect(p.street).not.toBeNull();
  world.structs.remove(ref);
  capture.indexChunk(world.structs.chunks[0]!,0,0,cam);
  tick(250); expect(p.street).toBeNull();
});
