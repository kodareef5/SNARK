// The light an orb casts by night: its colour (client/core/render/orb.ts OrbCast), its halo and pool
// (client/core/render/passes/orb.ts), its disc in the street's picture (orb.ts orbInStreet) and the sphere light the lit
// programs add (client/core/render/orb-light.ts).
import { expect, test } from "bun:test";
import { TIERS, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { effectsOff, tierWithout } from "../../client/core/passes.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { ORB_CAST, ORB_MIRRORED, OrbCast, orbInStreet, orbMean, orbNight, orbPick, orbScene, writeOrb } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { ORB_COLOUR, ORB_OVER, ORB_REACH, ORB_SEES_GLSL, ORB_SHADE_GLSL, ORB_SHADE_LENGTH, ORB_SHADE_SOFT, orbCast, orbReach, orbSees, orbShade } from "../../client/core/render/orb-light.ts";
import { CAST_AT, DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DRAW_DETAILS, DRAW_ORB, FRAME, FRAME_FLOATS, FramePacket, ORB_AT, ORB_LANES } from "../../client/core/render/packet.ts";
import { POOL_REACH } from "../../client/core/render/passes/orb.ts";
import { postFrame } from "../../client/core/render/post.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { FINE_STREET_WIDTH, streetMirror } from "../../client/core/render/street-finish.ts";
import { StreetReflections } from "../../client/core/render/street-reflections.ts";
import { lit } from "../../client/core/render/surface.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { nodeForms } from "../../shared/world/nodes.ts";
import { ORB_SCENES, type OrbSite } from "../../shared/world/orb.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";
import { sceneRegistry } from "../fixtures/sceneworld.ts";

const RATE = 30;
const SITE: OrbSite = { name: "Sphere", x: 1000, y: 0, z: 1000, yaw: 9000, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 1000, y: 0, z: 1210, yaw: 0, color: "blue", radius: 28 };
const NIGHT = 23, NOON = 12;
/** Moments that take each scene through what it follows, as the screen's own tests have them. */
const MOMENTS: readonly (readonly [seconds: number, hour: number])[] = [[362, 12], [371.5, 23], [380, 23], [383.7, 6], [440, 18.2], [475.9, 0], [3.3, 9]];

/** A lit frame's block at `hour` with scene `which` held, the eye (x, y, z) from the ball's foot; `sites` none for a map with no orb. */
function block(which: number, hour: number, seconds = 380, gain = 1, x = 0, y = 2, z = -400, sites: readonly OrbSite[] = [SITE]): Float32Array {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, theSky(), frame);
  postFrame(frame, tierOf("high"), hour, 1080);
  writeOrb(frame, sites, [BLUE], seconds, hour, SITE.x + x, SITE.y + y, SITE.z + z, null, Math.round(seconds * RATE), RATE, which, gain);
  return frame;
}

/** The cast colour of a block as light after exposure, as a still clock takes it: the whole mean at once. */
function castOf(frame: Float32Array): number[] {
  new OrbCast().step(frame, 0);
  return [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!);
}

test("the cast colour is the screen's mean over the ball, by its level", () => {
  const seen = [0, 0, 0], mean = [0, 0, 0], dense = 12000;
  for (let which = 0; which < ORB_SCENES.length; which++) {
    for (const [seconds, hour] of MOMENTS) {
      const f = block(which, hour, seconds), sum = [0, 0, 0];
      // A dense reading at a pixel's footprint from across the street, at directions that are not the mean's.
      for (let i = 0; i < dense; i++) {
        const y = 1 - (2 * (i + 0.5)) / dense, r = Math.sqrt(1 - y * y), a = i * 2.39996323 + 0.7, x = r * Math.cos(a), z = r * Math.sin(a);
        const scene = orbPick(f, x, y, z);
        orbScene(seen, f, scene, x, y, z, scene === f[ORB_AT + 8] ? f[ORB_AT + 6]! : f[ORB_AT + 7]!, 0.004);
        for (let c = 0; c < 3; c++) sum[c]! += seen[c]! / dense;
      }
      orbMean(mean, f);
      // Core's light is in thin cracks, which a hundred-odd directions read to a tenth; a fifth is the bound.
      for (let c = 0; c < 3; c++) expect(Math.abs(mean[c]! - sum[c]!), `${ORB_SCENES[which]} at ${seconds} s, ${hour} h: ${mean} against ${sum}`).toBeLessThan(0.2 * Math.max(...sum));
    }
  }
  // In the lanes it is that mean by the level, the night and ORB_CAST, as light before exposure.
  const f = block(2, NIGHT);
  orbMean(mean, f);
  const cast = castOf(f);
  expect(orbNight(f[FRAME.exposure]!, 0)).toBe(1);
  for (let c = 0; c < 3; c++) expect(cast[c]!).toBeCloseTo(mean[c]! * f[ORB_AT + 11]! * ORB_CAST, 4);
  expect(Math.max(...cast)).toBeGreaterThan(0.2);
});

test("the colour follows a new scene smoothly, at any frame rate, and reaches it", () => {
  for (const ms of [1000 / 60, 1000 / 144, 50]) {
    const cast = new OrbCast(), from = block(2, NIGHT), to = block(4, NIGHT), frame = new Float32Array(FRAME_FLOATS);
    const a = castOf(block(2, NIGHT)), b = castOf(block(4, NIGHT)), gap = Math.max(...a.map((v, c) => Math.abs(v - b[c]!)));
    expect(gap).toBeGreaterThan(0.2);
    frame.set(from);
    cast.step(frame, 1000);
    let last = [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!), most = 0;
    for (let c = 0; c < 3; c++) expect(last[c]!).toBeCloseTo(a[c]!, 4);
    // The scene is another from one frame to the next, as an admin's setting makes it.
    for (let now = 1000 + ms; now < 3000; now += ms) {
      frame.set(to);
      cast.step(frame, now);
      const next = [0, 1, 2].map((c) => frame[ORB_COLOUR + c]! * frame[FRAME.exposure]!);
      for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(next[c]! - last[c]!));
      last = next;
    }
    // No frame moves it more than its ease allows of the whole way: a seventh at 60 a second, a third at 20.
    expect(most, `${ms} ms a frame`).toBeLessThan(gap * (1.05 - Math.exp(-ms / 150)) + 1e-4);
    for (let c = 0; c < 3; c++) expect(last[c]!).toBeCloseTo(b[c]!, 3);
  }
});

test("the colour is nothing with no orb or no gain, at once", () => {
  const cast = new OrbCast(), frame = new Float32Array(FRAME_FLOATS);
  frame.set(block(2, NIGHT));
  cast.step(frame, 0);
  expect(Math.max(...cast.shown)).toBeGreaterThan(0.05);
  // The gain at nothing: dark on the next frame, with no tail.
  frame.set(block(2, NIGHT, 380, 0));
  cast.step(frame, 16);
  expect([...frame.subarray(ORB_COLOUR, ORB_COLOUR + 3), ...cast.shown]).toEqual([0, 0, 0, 0, 0, 0]);
  // A map with no orb: its lanes stay empty.
  frame.set(block(2, NIGHT, 380, 1, 0, 2, -400, []));
  cast.step(frame, 32);
  expect(frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);
  expect([...cast.shown]).toEqual([0, 0, 0]);
});

test("by day the cast light is nothing beside its night's", () => {
  for (let which = 0; which < ORB_SCENES.length; which++) {
    const night = Math.max(...castOf(block(which, NIGHT)));
    expect(night, ORB_SCENES[which]).toBeGreaterThan(0.1);
    expect(Math.max(...castOf(block(which, NOON))), ORB_SCENES[which]).toBe(0);
    // An hour after sunrise and before sunset, a hundredth at the most.
    for (const hour of [7, 17]) expect(Math.max(...castOf(block(which, hour))), `${ORB_SCENES[which]} at ${hour}`).toBeLessThan(0.01 * night);
  }
  // Low poly has no exposure: its halo and pool go by the sun's height.
  expect([orbNight(0, 0.5), orbNight(0, -0.5)]).toEqual([0, 1]);
  expect(orbNight(1, -0.5)).toBe(0);
});

let made: Pack | null = null;
/** The core's grey boxes with a box each for the shell and the plinth, as large as the art's. */
const pack = (): Pack => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([78, 78, 78], 12)] }, { id: "core:orb/plinth", lods: [boxMesh([80, 3, 80], 5)] }], defaultPalette())));

/** A flat map, its ground at 0, with the ball on it or none, drawn on `tier`. */
function world(tier: Tier, orbs: readonly OrbSite[] | null = [SITE]) {
  const reg = sceneRegistry(), dims = { chunksX: 64, chunksZ: 64 };
  const hf = new Heightfield(dims, TERRAIN_CELL, 0, 1 / 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs, ...(orbs ? { orbs } : {}), tideEyes: [BLUE] }, reg, pack());
  scene.assets.tier = tier;
  scene.plainSky = true;
  scene.hour = NIGHT;
  scene.eyeSeconds = 380;
  scene.orbOnly = 2;
  const cam = new Camera();
  cam.aspect = 160 / 90;
  scene.viewHeight = 90;
  /** The camera `metres` south of the ball's axis and `up` over the ground, looking at it. */
  const from = (metres: number, up = 2, pitch = 0.05): Camera => {
    cam.x = SITE.x;
    cam.y = up;
    cam.z = SITE.z - metres;
    cam.pitch = pitch;
    return cam;
  };
  return { scene, from, hf };
}

/** The frame's draws of an orb's meshes, and of its cards: the details' draws that hold light with no surface. */
function orbDraws(scene: Scene, p: FramePacket): { meshes: number; cards: number; glows: number } {
  let meshes = 0, cards = 0, glows = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if ((p.drawFlags[d]! & DRAW_DETAILS) === 0) {
      if ((p.drawFlags[d]! & DRAW_ORB) !== 0 || scene.assets.manifest.meshes[p.drawMesh[d]!]!.id.startsWith("core:orb/")) meshes++;
      continue;
    }
    let holds = false;
    for (let n = p.drawFirst[d]!; n < p.drawFirst[d]! + p.drawInstances[d]!; n++) if (((p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW) holds = true;
    if (holds) cards++;
  }
  for (let n = 0; n < p.detailCount; n++) if (((p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW) glows++;
  return { meshes, cards, glows };
}

test("halo and pool add two draws at most, and none by day, switched off or orbless", () => {
  for (const name of ["lowpoly", "medium", "high"]) {
    const { scene, from } = world(tierOf(name));
    for (const metres of [100, 250, 330, 384, 420, 500, 700, 1500, 3000]) {
      const p = scene.build(from(metres), null), { meshes, cards, glows } = orbDraws(scene, p);
      // One draw holds both cards; it is drawn in each depth range where the pool lies across the split.
      expect(cards, `${name} from ${metres} m`).toBeGreaterThanOrEqual(1);
      expect(cards, `${name} from ${metres} m`).toBeLessThanOrEqual(2);
      // A tier that lights by the ball has no pool, and its halo lies at one depth.
      expect(glows, `${name} from ${metres} m`).toBe(scene.assets.tier.orb.light ? 1 : 2);
      if (scene.assets.tier.orb.light || scene.assets.tier.split === 0) expect(cards).toBe(1);
      // The gate is five draws. Medium passes it only where shell, plinth and pool all lie across its depth split, 330 to 460 m off.
      expect(meshes + cards, `${name} from ${metres} m`).toBeLessThanOrEqual(name === "medium" && metres > 300 && metres < 500 ? 6 : 5);
    }
    const lit = scene.build(from(250), null).drawCount;
    scene.orbGlow = false;
    const off = scene.build(from(250), null);
    expect(orbDraws(scene, off)).toEqual({ meshes: 2, cards: 0, glows: 0 });
    expect(lit - off.drawCount).toBeGreaterThanOrEqual(1);
    scene.orbGlow = true;
    scene.hour = NOON;
    expect(orbDraws(scene, scene.build(from(250), null)).glows).toBe(0);
    scene.hour = NIGHT;
    scene.orbGain = 0;
    expect(orbDraws(scene, scene.build(from(250), null)).glows).toBe(0);
    const none = world(tierOf(name), null);
    expect(orbDraws(none.scene, none.scene.build(none.from(250), null))).toEqual({ meshes: 0, cards: 0, glows: 0 });
  }
});

test("the halo grows through the haze and the pool lies on the ground to its reach", () => {
  const { scene, from } = world(tierOf("medium"));
  const cards = (metres: number): { x: number; y: number; z: number; half: number; shows: number; flat: boolean }[] => {
    const p = scene.build(from(metres, 30), null), out = [];
    for (let n = 0; n < p.detailCount; n++) {
      const o = n * DETAIL_FLOATS, misc = p.detailWords[o + DETAIL.misc]!;
      if (((misc >>> 8) & 255) !== DETAIL_GLOW) continue;
      const along = Math.hypot(p.details[o + DETAIL.along]!, p.details[o + DETAIL.along + 1]!, p.details[o + DETAIL.along + 2]!);
      out.push({ x: p.details[o]!, y: p.details[o + 1]!, z: p.details[o + 2]!, half: along, shows: (misc >>> 16) & 255, flat: p.details[o + DETAIL.along + 1] === 0 && p.details[o + DETAIL.across + 1] === 0 });
    }
    return out;
  };
  const near = cards(400), far = cards(4000);
  const halo = (list: typeof near) => list.find((c) => !c.flat)!, pool = (list: typeof near) => list.find((c) => c.flat)!;
  // The halo about the ball's middle, wider and stronger from across the map.
  expect([halo(near).x, halo(near).y, halo(near).z]).toEqual([0, SITE.centre - 30, 400]);
  expect(halo(near).half).toBeGreaterThan(2 * SITE.radius);
  expect(halo(far).half).toBeGreaterThan(1.3 * halo(near).half);
  expect(halo(far).shows).toBeGreaterThan(2 * halo(near).shows);
  expect(halo(near).shows).toBeGreaterThan(0);
  // The pool on the ground under the axis, out to its reach, and fainter through the haze.
  expect(pool(near).half).toBe(POOL_REACH);
  expect(pool(near).y).toBeCloseTo(0.3 - 30, 4);
  expect(pool(far).shows).toBeLessThan(pool(near).shows);
  expect(pool(near).shows).toBeGreaterThan(40);
});

const reg = compileContent(CORE_CONTENT).registry!;
/** A street with a car to hold the shared picture, 2 m from the camera, and the ball `away` metres north of it at night. */
function street(away: number, hour = NIGHT, up = 0) {
  const dims = { chunksX: 2, chunksZ: 2 }, forms = nodeForms(reg);
  const land = { nodes: new StructureStore(dims, forms.halfX, forms.halfY, forms.halfZ, null, forms.parts), dims, hf: new Heightfield(dims, 4, 0, 1), structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const cam = new Camera();
  cam.x = cam.z = 40;
  cam.y = 1.6 + up;
  cam.update();
  const capture = new StreetReflections(reg, defaultPalette(), forms), p = new FramePacket(), cars = new RemoteSample();
  p.tier = tierOf("high");
  p.lit = true;
  cars.count = 1;
  cars.id[0] = 900;
  cars.kind[0] = reg.index.get("core:compact")!;
  cars.x[0] = 40;
  cars.y[0] = up;
  cars.z[0] = 42;
  cars.colors[0] = 41;
  const site: OrbSite = { ...SITE, x: 40, z: 40 + away };
  const cast = new OrbCast();
  /** A frame at `now` ms: the block, the orb's lanes and colour, then the picture. */
  const tick = (now: number): FramePacket => {
    skyFrame(hour, theSky(), p.frame);
    postFrame(p.frame, p.tier, hour, 1080);
    writeOrb(p.frame, [site], [BLUE], 380, hour, cam.x, cam.y, cam.z, null, 380 * RATE, RATE, 2);
    cast.step(p.frame, now);
    capture.frame(p, cam, land, cars, new Set(), now);
    return p;
  };
  return { tick, capture, cam, site, p };
}

/** The pixel of a street picture that looks along a direction from its eye, as the lit programs look it up. */
function pixelToward(pixels: Uint8Array, x: number, y: number, z: number): number[] {
  const width = FINE_STREET_WIDTH, height = width / 2, l = Math.hypot(x, y, z);
  const i = Math.floor((Math.atan2(x, z) / (2 * Math.PI) + 0.5) * width) & (width - 1), j = Math.min(height - 1, Math.floor((Math.asin(y / l) / Math.PI + 0.5) * height));
  return [...pixels.subarray((j * width + i) * 4, (j * width + i) * 4 + 4)];
}

test("the street's picture holds the ball as a disc of its light where it stands", () => {
  const s = street(300), p = s.tick(0), pixels = p.street!.pixels;
  // Where the ball's middle is from the picture's eye, which is the car: covered, in the cast light's hue.
  const to = [s.site.x - 40, s.site.y + s.site.centre - 0.7, s.site.z - 42] as const, at = pixelToward(pixels, ...to);
  expect(at[3]).toBe(255);
  expect(at[0]!).toBeGreaterThan(250);
  // The picture holds many times the sky's light for it, most in the red of Core's light, and a mirror facing the ball
  // shows the screen's mean light.
  const over = [...p.frame.subarray(ORB_OVER, ORB_OVER + 3)];
  expect(over[0]!).toBeGreaterThan(3);
  expect(over[0]!).toBeGreaterThan(over[2]!);
  const mirrored = new Float64Array(3), l = Math.hypot(...to), e = p.frame[FRAME.exposure]!;
  streetMirror(mirrored, p, to.map((v) => v / l), p.frame[FRAME.reflection]!, p.frame[FRAME.reflection + 1]!, p.frame[FRAME.reflection + 2]!, 0.05, 1);
  const gain = 1 + p.frame[FRAME.streetLook]!, strength = p.frame[FRAME.reflection + 3]!;
  expect(strength).toBe(0);
  // Once the picture has faded in.
  const later = s.tick(250);
  streetMirror(mirrored, later, to.map((v) => v / l), later.frame[FRAME.reflection]!, later.frame[FRAME.reflection + 1]!, later.frame[FRAME.reflection + 2]!, 0.05, 1);
  for (let c = 0; c < 3; c++) expect(mirrored[c]! / gain / (later.frame[ORB_COLOUR + c]! / ORB_CAST), `channel ${c}: ${[...mirrored].map((m) => m * e)}`).toBeCloseTo(1, 1);
  // The disc is as wide as the ball is seen: none of it twice its half angle off, and the sky there is as it was.
  const half = Math.asin(SITE.radius / l), turn = 2.2 * half, aside = [to[0] * Math.cos(turn) + to[2] * Math.sin(turn), to[1], -to[0] * Math.sin(turn) + to[2] * Math.cos(turn)] as const;
  expect(pixelToward(pixels, ...aside)).toEqual([0, 0, 0, 0]);
  let covered = 0;
  for (let n = 3; n < pixels.length / 2; n += 4) covered += pixels[n + pixels.length / 2]! / 255;
  // Its pixels over the horizon, against its solid angle there in pixels of the picture (their rows are wider by the cosine of their height).
  const pixel = (2 * Math.PI) / FINE_STREET_WIDTH, lift = Math.asin(to[1] / l);
  expect(covered).toBeGreaterThan((0.3 * Math.PI * half * half) / (pixel * pixel * Math.cos(lift)));
  expect(covered).toBeLessThan((1.3 * Math.PI * half * half) / (pixel * pixel * Math.cos(lift + half)));
});

test("the picture holds no ball out of range, under its horizon, by day or when off", () => {
  const dark = (p: FramePacket): boolean => {
    const pixels = p.street!.pixels;
    for (let n = pixels.length / 2 + 3; n < pixels.length; n += 4) if (pixels[n] !== 0) return false;
    return p.frame.subarray(ORB_OVER, ORB_OVER + 3).every((v) => v === 0);
  };
  expect(dark(street(300).tick(0))).toBe(false);
  expect(dark(street(ORB_MIRRORED + 200).tick(0))).toBe(true);
  expect(dark(street(300, NOON).tick(0))).toBe(true);
  // From a roof over the ball's top, it is under the picture's horizon.
  expect(dark(street(300, NIGHT, 150).tick(0))).toBe(true);
  const off = street(300);
  off.capture.orb = false;
  expect(dark(off.tick(0))).toBe(true);
  // Without the late file's part, the same.
  const part = StreetReflections.orb;
  StreetReflections.orb = null;
  try {
    expect(dark(street(300).tick(0))).toBe(true);
  } finally {
    StreetReflections.orb = part;
  }
  // The part alone: nothing nearer than the ball is painted over, and it says no where the lanes hold no light.
  const f = block(2, NIGHT, 380, 1, 0, 2, -300), over = new Float32Array(3), pixels = new Uint8Array(FINE_STREET_WIDTH * FINE_STREET_WIDTH * 2), depth = new Float32Array(pixels.length / 4).fill(20);
  expect(orbInStreet.over(f, 0, 0, 0, over)).toBe(false);
  new OrbCast().step(f, 0);
  expect(orbInStreet.over(f, 0, 0, 0, over)).toBe(true);
  orbInStreet.paint(pixels, depth, FINE_STREET_WIDTH, f, 0, 0, 0, over);
  expect(pixels.every((v) => v === 0)).toBe(true);
  orbInStreet.paint(pixels, depth.fill(Infinity), FINE_STREET_WIDTH, f, 0, 0, 0, over);
  expect(pixels.some((v) => v !== 0)).toBe(true);
});

test("the sphere light is strongest at the skin and gone at its reach", () => {
  const f = block(2, NIGHT, 380, 1, 0, 2, -400), cx = f[ORB_AT]!, cy = f[ORB_AT + 1]!, cz = f[ORB_AT + 2]!;
  /** A point `metres` from the skin toward the eye's side, level with the middle, facing the ball. */
  const facing = (metres: number): number => orbReach(f, cx, cy, cz - SITE.radius - metres, 0, 0, 1);
  expect(facing(0)).toBeCloseTo(1, 6);
  let last = 1;
  for (const metres of [5, 20, 60, 150, 300, 390]) {
    const now = facing(metres);
    expect(now).toBeLessThan(last);
    expect(now).toBeGreaterThan(0);
    last = now;
  }
  // By the square of the distance from its middle near it, and nothing from its reach on.
  expect(facing(SITE.radius) / (1 - (SITE.radius / ORB_REACH) ** 2) ** 2).toBeCloseTo(0.25, 6);
  expect([facing(ORB_REACH), facing(ORB_REACH + 1), facing(5000)]).toEqual([0, 0, 0]);
  // By the cosine of the face to the ball: nothing on a face turned away or edge on, half at sixty degrees.
  const at = cz - SITE.radius - 40;
  expect(orbReach(f, cx, cy, at, 0, 0, -1)).toBe(0);
  expect(orbReach(f, cx, cy, at, 0, 1, 0)).toBeCloseTo(0, 9);
  expect(orbReach(f, cx, cy, at, 0, Math.sin(Math.PI / 3), 0.5) / orbReach(f, cx, cy, at, 0, 0, 1)).toBeCloseTo(0.5, 6);
  // The ground takes most at the foot, where the ball stands highest over it.
  const ground = (metres: number): number => orbReach(f, cx, cy - SITE.centre, cz - metres, 0, 1, 0);
  const foot = Math.sqrt(SITE.radius ** 2 - SITE.centre ** 2);
  expect(ground(foot + 1)).toBeGreaterThan(0.3);
  for (const metres of [100, 150, 250, 400]) expect(ground(metres)).toBeLessThan(ground(metres - 20));
  // A map with no orb gives none anywhere.
  expect(orbReach(block(2, NIGHT, 380, 1, 0, 2, -400, []), 0, 0, 0, 0, 0, 1)).toBe(0);
});

test("the software render adds the orb's light where the tier takes it, not to metal", () => {
  const f = block(2, NIGHT, 380, 1, 0, 2, -200);
  new OrbCast().step(f, 0);
  const n = [0, 0, 1], v = [0, 0, -1], grey = [0.5, 0.5, 0.5], sky = [0, 0, 0], plain = new Float64Array(3), lighted = new Float64Array(3), metal = new Float64Array(3), bare = new Float64Array(3);
  const x = f[ORB_AT]!, y = f[ORB_AT + 1]!, z = f[ORB_AT + 2]! - SITE.radius - 30;
  orbSees(f, false, x, y, z, 0, 0, 1);
  expect([...orbCast]).toEqual([0, 0, 0]);
  lit(plain, grey, [1, 1, 0], n, v, f, sky);
  orbSees(f, true, x, y, z, 0, 0, 1);
  const share = orbReach(f, x, y, z, 0, 0, 1);
  expect(share).toBeGreaterThan(0.4);
  lit(lighted, grey, [1, 1, 0], n, v, f, sky);
  // What it adds is the colour by the share and the surface's own colour, with no highlight.
  for (let c = 0; c < 3; c++) expect(lighted[c]! - plain[c]!).toBeCloseTo(f[ORB_COLOUR + c]! * share * 0.5, 9);
  expect((lighted[0]! - plain[0]!) * f[FRAME.exposure]!).toBeGreaterThan(0.1);
  // Metal takes none of it, as it takes none of any light but in its highlight.
  lit(bare, grey, [1, 1, 1], n, v, f, sky);
  orbSees(f, false, x, y, z, 0, 0, 1);
  lit(metal, grey, [1, 1, 1], n, v, f, sky);
  expect([...bare]).toEqual([...metal]);
  orbCast.fill(0);
});

test("the lit programs take the light on high and ultra alone, in one branch", () => {
  expect(TIERS.map((t) => t.orb.light)).toEqual([false, false, true, true]);
  expect(tierWithout(tierOf("high"), effectsOff("orblight")).orb.light).toBe(false);
  expect(tierWithout(tierOf("high"), effectsOff("orbglow,orbmirror")).orb.light).toBe(true);
  // The twin's reach and lanes are the text's, and a map with no orb leaves at its first line.
  expect(ORB_SEES_GLSL).toContain(`/ ${ORB_REACH.toFixed(1)}`);
  expect(ORB_SEES_GLSL).toContain("gOrb = fOrb[6].yzw * (s * s * w * w * max(dot(normal, d) / far, 0.0));");
  expect(ORB_SEES_GLSL.match(/\bif\b/g)).toEqual(["if"]);
  expect(ORB_SEES_GLSL).toContain("if (fOrb[0].w <= 0.0) return;");
  expect([ORB_COLOUR, ORB_OVER]).toEqual([ORB_AT + 6 * 4 + 1, ORB_AT + 7 * 4]);
  for (const tier of TIERS) {
    if (!tier.lit) continue;
    for (const name of ["flat", "terrain", "terrainWindow", "far", "pulled", "seeThrough", "surface", "surfaceLayer", "details", "water", "sky"]) {
      const text = PROGRAMS[name]!(tier, "rgba", false, tier.post !== null), takes = text.defines.includes("#define ORB_LIGHT\n");
      // The sea and the dome do not light by `lit`.
      expect(takes, `${tier.name} ${name}`).toBe(tier.orb.light && name !== "water" && name !== "sky");
      const fragment = withDefines(text.fragment, text.defines);
      if (takes) expect(fragment).toContain("light += gOrb * albedo * (1.0 - mro.b);");
      // The same texts and samplers with the light as without: no new program and no new sampler.
      const without = PROGRAMS[name]!(tierWithout(tier, effectsOff("orblight")), "rgba", false, tier.post !== null);
      expect([without.fragment, without.vertex, without.samplers]).toEqual([text.fragment, text.vertex, text.samplers]);
      expect(without.defines).toBe(text.defines.replace("#define ORB_LIGHT\n", ""));
      if (tier.name !== "high") continue;
      const vertex = withDefines(text.vertex, text.defines);
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)], name).toEqual([]);
    }
  }
});

test("high lights the ground and the plinth by the ball; with no orb nothing changes", () => {
  const picture = (tier: Tier, orbs: readonly OrbSite[] | null, hour = NIGHT, glow = true): { color: Uint8ClampedArray; p: FramePacket } => {
    const { scene, from, hf } = world(tier, orbs), raster = new Rasterizer(160, 90, pack(), hf);
    scene.hour = hour;
    scene.orbGlow = glow;
    const p = scene.build(from(200, 60, -0.3), null);
    raster.render(p);
    return { color: raster.color.slice(), p };
  };
  const high = tierOf("high"), plain = tierWithout(high, effectsOff("orblight"));
  // The ground before the ball and the plinth's top: lighter in the ball's light, the ground about as the pool makes it.
  const ground = (80 * 160 + 80) * 4, top = (60 * 160 + 80) * 4, on = picture(high, [SITE]), pool = picture(plain, [SITE]), off = picture(plain, [SITE], NIGHT, false);
  expect(on.color[ground]! - off.color[ground]!).toBeGreaterThan(15);
  expect(on.color[top]! - off.color[top]!).toBeGreaterThan(15);
  expect(pool.color[ground]! - off.color[ground]!).toBeGreaterThan(15);
  expect(Math.abs(pool.color[ground]! - on.color[ground]!)).toBeLessThan(30);
  // The pool is a sheet on the ground: it leaves the plinth's top as it was.
  expect(pool.color[top]).toBe(off.color[top]!);
  // By day the light adds nothing.
  expect([...picture(high, [SITE], NOON).color]).toEqual([...picture(plain, [SITE], NOON).color]);
  // With no orb the frame is the same with the light as without it, and its lanes are empty.
  const bare = picture(high, null), bareOff = picture(plain, null);
  expect([...bare.color]).toEqual([...bareOff.color]);
  expect(bare.p.drawCount).toBe(bareOff.p.drawCount);
  expect(bare.p.detailCount).toBe(bareOff.p.detailCount);
  expect(bare.p.frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);
});

/** A point `along` metres down the ball's shadow from its middle and `off` metres to the side of the shadow's axis, in a block's frame. */
function downLight(f: Float32Array, along: number, off: number): [number, number, number] {
  const lx = f[CAST_AT]!, ly = f[CAST_AT + 1]!, lz = f[CAST_AT + 2]!, flat = Math.hypot(lx, lz);
  // Across the light and level.
  const sx = lz / flat, sz = -lx / flat;
  return [f[ORB_AT]! - lx * along + sx * off, f[ORB_AT + 1]! - ly * along, f[ORB_AT + 2]! - lz * along + sz * off];
}

test("the ball's shadow is dark down the light from it, lit beside it, before it and past its length", () => {
  for (const hour of [9, 12, 16]) {
    const f = block(1, hour);
    expect(f[CAST_AT + 3]).toBe(1);
    // Down the light from the ball's middle, on the shadow's axis: dark from inside the ball to half the shadow's length.
    for (const along of [0, 40, 78, 150, 400, 0.5 * ORB_SHADE_LENGTH - 1]) expect(orbShade(f, ...downLight(f, along, 0)), `${hour} h, ${along} m`).toBe(0);
    // Toward the light from the ball, and well to the side of the shadow: all of the light.
    for (const along of [-79, -90, -400]) expect(orbShade(f, ...downLight(f, along, 0))).toBe(1);
    expect(orbShade(f, ...downLight(f, -79, 60))).toBe(1);
    for (const along of [100, 600]) expect(orbShade(f, ...downLight(f, along, 78 + 20))).toBe(1);
    // It fades over the second half of its length and is gone at its end.
    let last = 0;
    for (let along = 0.5 * ORB_SHADE_LENGTH; along <= ORB_SHADE_LENGTH; along += 25) {
      const now = orbShade(f, ...downLight(f, along, 0));
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBeCloseTo(1, 9);
    expect([orbShade(f, ...downLight(f, ORB_SHADE_LENGTH + 1, 0)), orbShade(f, ...downLight(f, 5000, 0))]).toEqual([1, 1]);
  }
  // On the ground at noon: dark under the ball's overhang, lit a few metres out from under it.
  const noon = block(1, 12), cx = noon[ORB_AT]!, gy = noon[ORB_AT + 1]! - SITE.centre, cz = noon[ORB_AT + 2]!;
  expect(orbShade(noon, cx, gy, cz - 72)).toBeLessThan(0.05);
  expect(orbShade(noon, cx, gy, cz - 120)).toBe(1);
  // A map with no orb: all of the light everywhere.
  const bare = block(1, 12, 380, 1, 0, 2, -400, []);
  expect([orbShade(bare, 0, 0, 0), orbShade(bare, 0, -34, 300)]).toEqual([1, 1]);
});

test("the shadow's edge is soft, never steps back, and widens down the light", () => {
  const f = block(1, 16);
  /** The metres across the edge over which the light goes from a tenth to nine tenths, walking out from the axis. */
  const edge = (along: number): number => {
    let last = -1, from = NaN, to = NaN;
    for (let off = 30; off <= 160; off += 0.05) {
      const now = orbShade(f, ...downLight(f, along, off));
      expect(now).toBeGreaterThanOrEqual(last);
      if (Number.isNaN(from) && now >= 0.1) from = off;
      if (Number.isNaN(to) && now >= 0.9) to = off;
      last = now;
    }
    expect(last).toBe(1);
    // The edge lies about the ball's outline.
    expect(from).toBeLessThan(SITE.radius);
    expect(to).toBeGreaterThan(SITE.radius);
    return to - from;
  };
  const near = edge(100), far = edge(600);
  expect(near).toBeGreaterThan(ORB_SHADE_SOFT);
  expect(near).toBeLessThan(8);
  expect(far).toBeGreaterThan(2 * near);
  // No step along the light either, from before the ball into its shadow.
  let last = 2, least = 1;
  for (let along = -90; along <= 60; along += 0.05) {
    const now = orbShade(f, ...downLight(f, along, 0));
    expect(now).toBeLessThanOrEqual(last);
    expect(last === 2 ? 0 : last - now).toBeLessThan(0.05);
    last = now;
    least = Math.min(least, now);
  }
  expect(least).toBe(0);
});

test("the shadow is the casting light's: the moon's by night, fainter at dusk, none when off", () => {
  // By night the moon owns the cascades, and the ball's shadow lies down its light.
  const night = block(1, NIGHT);
  expect(night[CAST_AT + 3]).toBeGreaterThan(0.9);
  expect(orbShade(night, ...downLight(night, 150, 0))).toBeCloseTo(1 - night[CAST_AT + 3]!, 6);
  // As much as the light casts: half a shadow where it casts by half.
  const dusk = block(1, 12);
  dusk[CAST_AT + 3] = 0.5;
  expect(orbShade(dusk, ...downLight(dusk, 150, 0))).toBe(0.5);
  dusk[CAST_AT + 3] = 0;
  expect(orbShade(dusk, ...downLight(dusk, 150, 0))).toBe(1);
  // Every tier with shadows takes it, the sea's program too, in one branch; `orbshade` takes it out and nothing else.
  expect(ORB_SHADE_GLSL.match(/\bif\b/g)).toEqual(["if"]);
  expect(ORB_SHADE_GLSL).toContain("if (fOrb[0].w <= 0.0) return 1.0;");
  expect(ORB_SHADE_GLSL).toContain(`${ORB_SHADE_LENGTH.toFixed(1)}, along)`);
  for (const tier of TIERS) {
    for (const name of ["flat", "terrain", "far", "surface", "details", "water", "sky"]) {
      const text = PROGRAMS[name]!(tier, "rgba", false, tier.post !== null), off = PROGRAMS[name]!(tierWithout(tier, effectsOff("orbshade")), "rgba", false, tier.post !== null);
      expect(text.defines.includes("#define ORB_SHADE\n"), `${tier.name} ${name}`).toBe(tier.lit && tier.shadows.size > 0 && name !== "sky");
      expect([off.fragment, off.vertex, off.samplers, off.defines]).toEqual([text.fragment, text.vertex, text.samplers, text.defines.replace("#define ORB_SHADE\n", "")]);
      if (tier.name !== "medium" || !text.defines.includes("ORB_SHADE")) continue;
      const vertex = withDefines(text.vertex, text.defines), fragment = withDefines(text.fragment, text.defines);
      expect(fragment).toContain("return mapShadow(rel, normal) * orbShade(rel);");
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)], name).toEqual([]);
    }
  }
});

test("the software render draws the ball's shadow on the ground; with no orb nothing changes", () => {
  const picture = (tier: Tier, orbs: readonly OrbSite[] | null, hour: number): Uint8ClampedArray => {
    const { scene, from, hf } = world(tier, orbs), raster = new Rasterizer(160, 90, pack(), hf);
    scene.hour = hour;
    scene.orbOnly = 1;
    const cam = from(420, 380, -0.62);
    cam.x -= 250;
    cam.yaw = 0.5;
    raster.render(scene.build(cam, null));
    return raster.color.slice();
  };
  for (const name of ["medium", "high"]) {
    const tier = tierOf(name), plain = tierWithout(tier, effectsOff("orbshade"));
    // Late in the day the shadow lies long to the east of the ball: many of the ground's pixels are darker by it, and none lighter.
    const on = picture(tier, [SITE], 17), off = picture(plain, [SITE], 17);
    let darker = 0, lighter = 0;
    for (let i = 0; i < on.length; i += 4) {
      const d = on[i]! + on[i + 1]! + on[i + 2]! - off[i]! - off[i + 1]! - off[i + 2]!;
      if (d < -30) darker++;
      if (d > 0) lighter++;
    }
    expect(darker, name).toBeGreaterThan(300);
    expect(lighter, name).toBe(0);
    expect([...picture(tier, null, 17)]).toEqual([...picture(plain, null, 17)]);
  }
});
