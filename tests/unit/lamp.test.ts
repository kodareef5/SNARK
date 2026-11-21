// The street lamp that lights as a light by night (render/lamp.ts): its cone and fall, its view from the lens, the hand
// over from one lamp to the next through their cards, and a frame of it: where it lights, what casts into its map, and
// where nothing does.
import { expect, test } from "bun:test";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { LAMP_BIT, LAMP_FADE, LAMP_NEAR, LAMP_RANGE, LAMP_REACH, LAMP_TAN, LampView, lampFrame, lampLight, lampReach, lampSees } from "../../client/core/render/lamp.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_POOL, FRAME, FRAME_FLOATS, FramePacket, LAMP_AT, MAX_CASCADES } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { shadowLayer, shadowLayers } from "../../client/core/render/shadowtext.ts";
import { hourOfSun } from "../../client/core/render/sky.ts";
import { StreetLamps } from "../../client/core/render/street-lamps.ts";
import { lit } from "../../client/core/render/surface.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { sceneRegistry } from "../fixtures/sceneworld.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh } from "../fixtures/textured.ts";

const LIT = "core:zzstreet_lamp_lit";
/** Where a lamp's lens stands in its own frame (street-lamps.ts LENS): over the road, +z. */
const LENS = [0, 8.85, 2.9] as const;

test("the lamp's light falls off as its card does, and none reaches above the lens, past its range or a face turned away", () => {
  const f = new Float32Array(FRAME_FLOATS);
  lampFrame(f, [0, 8.85, 0], 1, 4);
  const way = [0, 0, 0];
  const under = lampReach(f, 0, 0, 0, 0, 1, 0, way);
  expect(way).toEqual([0, 1, 0]);
  // The card (street-lamps.ts POOL) shows 71% of itself a quarter of its 13 m out, a quarter at half and nothing at its
  // edge; the light on the road, with the road's own turn from it, much as that.
  const onRoad = (r: number): number => (lampReach(f, r, 0, 0, 0, 1, 0, way) * way[1]!) / under;
  expect(onRoad(3.25)).toBeGreaterThan(0.7);
  expect(onRoad(6.5)).toBeGreaterThan(0.1);
  expect(onRoad(6.5)).toBeLessThan(0.3);
  expect(onRoad(9.75)).toBeLessThan(0.01);
  for (let r = 0; r < 14; r += 0.25) expect(onRoad(r + 0.25)).toBeLessThanOrEqual(onRoad(r) + 1e-9);
  expect(lampReach(f, 0, 9, 0, 0, -1, 0, way)).toBe(0);
  expect(lampReach(f, 0, 8.85 - LAMP_RANGE - 0.1, 0, 0, 1, 0, way)).toBe(0);
  expect(lampReach(f, 0, 0, 0, 0, -1, 0, way)).toBe(0);
  // Its light is light after exposure: as bright on the screen whatever the night's exposure.
  const g = new Float32Array(FRAME_FLOATS);
  g[FRAME.exposure] = 4;
  lampFrame(g, [0, 8.85, 0], 0.5, 4);
  for (let k = 0; k < 3; k++) expect(g[LAMP_AT + 4 + k]).toBeCloseTo((f[LAMP_AT + 4 + k]! * 0.5) / 4, 6);
  expect([g[LAMP_AT + 3], g[LAMP_AT + 7], f[LAMP_AT + 7]]).toEqual([LAMP_RANGE, 4, 4]);
  lampFrame(g, null, 1, 4);
  expect(Array.from(g.subarray(LAMP_AT, LAMP_AT + 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("the software render adds the lamp's light where lampSees finds it, and none where the frame has no lamp", () => {
  const f = new Float32Array(FRAME_FLOATS);
  f[FRAME.exposure] = 1;
  const grey = [0.2, 0.2, 0.2], rough = [1, 1, 0], up = [0, 1, 0], none = [0, 0, 0];
  const dark = [0, 0, 0], litUp = [0, 0, 0];
  lampFrame(f, [0, 8.85, 0], 1, -1);
  lampSees(f, 0, 0, 0, 0, 1, 0);
  lit(litUp, grey, rough, up, up, f, none);
  // Lambert on a grey card: its colour times the light a metre off over the square of the distance, cut a little by the
  // range's edge, and a fully rough highlight's few hundredths besides.
  for (let k = 0; k < 3; k++) {
    const lambert = (0.2 * f[LAMP_AT + 4 + k]!) / (8.85 * 8.85);
    expect(litUp[k]! / lambert).toBeGreaterThan(0.95);
    expect(litUp[k]! / lambert).toBeLessThan(1.05);
  }
  lampFrame(f, null, 0, -1);
  lit(dark, grey, rough, up, up, f, none);
  expect(dark).toEqual([0, 0, 0]);
  lampLight.fill(0);
});

test("the map's view from the lens: straight down, square to LAMP_TAN either way, from its near plane to its range, and what may stand in it", () => {
  const l = new LampView();
  expect(l.box(-1, -1, -1, 1, 1, 1)).toBe(0);
  l.set(3, 8, -2, 2048);
  const clip = (x: number, y: number, z: number): number[] => {
    const m = l.matrix, out = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) out[r] = m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!;
    return out.map((v) => v / out[3]!);
  };
  // Straight under the lens is the middle; the near plane and the range are the depth's ends; the edge of its square is LAMP_TAN out.
  for (const v of clip(3, 0, -2).slice(0, 2)) expect(v).toBeCloseTo(0, 6);
  expect(clip(3, 8 - LAMP_NEAR, -2)[2]).toBeCloseTo(-1, 5);
  expect(clip(3, 8 - LAMP_RANGE, -2)[2]).toBeCloseTo(1, 5);
  expect(clip(3 + LAMP_TAN * 5, 3, -2)[0]).toBeCloseTo(1, 5);
  expect(clip(3, 3, -2 - LAMP_TAN * 5)[1]).toBeCloseTo(1, 5);
  // The map's x and y and its depth make the hand a cascade's do, so the same faces are its back faces.
  const [a, b, c] = [clip(3, 0, -2), clip(4, 0, -2), clip(3, 0, -3)];
  const cross = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  expect(cross).toBeGreaterThan(0);
  expect(l.texel).toBeCloseTo((2 * LAMP_TAN * 9) / 2048, 9);
  // Under it, within reach: in. Over the lens, past its range, or wide of it: out.
  expect(l.box(2, 0, -3, 4, 1.5, -1)).toBe(LAMP_BIT);
  expect(l.box(2, 8.5, -3, 4, 9, -1)).toBe(0);
  expect(l.box(2, 8 - LAMP_RANGE - 3, -3, 4, 8 - LAMP_RANGE - 1, -1)).toBe(0);
  expect(l.box(3 + LAMP_TAN * 8 + 1, 0, -3, 3 + LAMP_TAN * 8 + 2, 1, -1)).toBe(0);
  expect(l.sphere(3, 1, -2, 1)).toBe(LAMP_BIT);
  l.off();
  expect(l.box(2, 0, -3, 4, 1.5, -1)).toBe(0);
});

/** Two working lamps 20 m apart along x, each lens over the road at +z, in a world of their own. */
function twoLamps(): { lamps: StreetLamps; structs: StructureStore; frame: (camX: number, now: number, lights?: boolean, hour?: number) => FramePacket } {
  const reg = sceneRegistry();
  const dims = { chunksX: 4, chunksZ: 4 };
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  for (const x of [100, 120]) structs.add(reg.index.get(LIT)!, x, 0, 128, 0, 0, 1);
  const lamps = new StreetLamps(reg);
  const cam = new Camera();
  const p = new FramePacket();
  const frame = (camX: number, now: number, lights = true, hour = 0): FramePacket => {
    [cam.x, cam.y, cam.z] = [camX, 1.7, 124];
    // The true sun under the horizon at night, over it by day: the moon's way turned round.
    p.frame[FRAME.moon + 1] = hour === 0 ? 1 : -1;
    p.detailCount = 0;
    lamps.build(p, cam, structs, dims.chunksX, dims.chunksZ, now, lights);
    lamps.write(p);
    return p;
  };
  return { lamps, structs, frame };
}

/** The pool cards of a frame, by the x of their middle in the world, camera at `camX`: how much of each shows, of 255. */
function pools(p: FramePacket, camX: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let d = 0; d < p.detailCount; d++) {
    const o = d * DETAIL_FLOATS, misc = p.detailWords[o + DETAIL.misc]!;
    if (((misc >>> 8) & 255) !== DETAIL_POOL || Math.abs(p.details[o + DETAIL.across + 2]!) < 1) continue;
    out.set(Math.round(p.details[o]! + camX), (misc >>> 16) & 255);
  }
  return out;
}

test("the nearest working lamp within LAMP_REACH lights, its pool card gone while it does; none by day or where the tier does not let it", () => {
  const { lamps, frame } = twoLamps();
  let now = 0;
  frame(103, now);
  expect(lamps.shows).toBe(0);
  for (let k = 0; k < 20; k++) frame(103, (now += 1000 / 60));
  expect(lamps.shows).toBe(1);
  expect([lamps.lens[0], lamps.lens[1], lamps.lens[2]]).toEqual([100 + LENS[0] - 103, LENS[1] - 1.7, 128 + LENS[2] - 124]);
  const p = frame(103, (now += 1000 / 60));
  expect(pools(p, 103)).toEqual(new Map([[120, 210]]));
  // Lights off (the tier, or `?ab=lamp`): every pool card shows, and what it held it still holds after.
  expect(pools(frame(103, (now += 1000 / 60), false), 103)).toEqual(new Map([[100, 210], [120, 210]]));
  expect(lamps.shows).toBe(0);
  frame(103, (now += 1000 / 60));
  expect(lamps.shows).toBe(1);
  // Nothing within reach: what it held fades out.
  for (let k = 0; k < 20; k++) frame(100 - LAMP_REACH - 5, (now += 1000 / 60));
  expect(lamps.shows).toBe(0);
  // By day nothing.
  for (let k = 0; k < 20; k++) frame(103, (now += 1000 / 60), true, 12);
  expect([lamps.shows, frame(103, now, true, 12).detailCount]).toEqual([0, 0]);
});

test("the light goes from one lamp to the next through their cards over twice LAMP_FADE, one lamp lighting at a time", () => {
  const { lamps, frame } = twoLamps();
  let now = 0;
  for (let k = 0; k < 20; k++) frame(103, (now += 1000 / 60));
  const seen: { shows: number; at: number; first: number; second: number }[] = [];
  for (let k = 0; k < 30; k++) {
    const p = frame(117, (now += 1000 / 60));
    const card = pools(p, 117);
    seen.push({ shows: lamps.shows, at: Math.round(lamps.lens[0]! + 117), first: card.get(100) ?? 0, second: card.get(120) ?? 0 });
  }
  // The first lamp's light falls as its card comes back, then the second's card goes as its light comes.
  const out = seen.findIndex((s) => s.shows === 0);
  expect(out).toBeGreaterThan(5);
  expect(seen.slice(0, out).every((s) => s.at === 100)).toBe(true);
  expect(seen.slice(out + 1).every((s) => s.at === 120)).toBe(true);
  for (let k = 1; k < seen.length; k++) expect(Math.abs(seen[k]!.shows - seen[k - 1]!.shows)).toBeLessThan(0.15);
  for (const s of seen) expect(s.at === 100 ? s.first : s.second).toBeCloseTo(210 * (1 - s.shows), -0.5);
  const whole = seen.findIndex((s, k) => k > out && s.shows === 1);
  expect(((whole + 1) * 1000) / 60 / 1000).toBeCloseTo(2 * LAMP_FADE, 1);
});

let made: ReturnType<typeof parsePack> | null = null;
const pack = () => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), tubeMesh()], defaultPalette(), tubeClips(), [TUBE_RIG])));

/** A flat map with one working lamp, its lens over (120, 130.9), a body under it, and the camera 10 m off looking at it. */
function lampWorld(tier: ReturnType<typeof tierOf>) {
  const reg = sceneRegistry();
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  structs.add(reg.index.get(LIT)!, 120, 0, 128, 0, 0, 1);
  const scene = new Scene({ dims, hf, structs }, reg, pack());
  scene.assets.tier = tier;
  scene.viewHeight = 90;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.aspect] = [110, 1.7, 130, Math.PI / 2, 16 / 9];
  const remote = new RemoteSample();
  [remote.id[0], remote.kind[0], remote.x[0], remote.y[0], remote.z[0], remote.yaw[0], remote.flags[0]] = [100, reg.index.get(TUBE)!, 121, 0, 131, 0, 1];
  remote.count = 1;
  const frames = (hour: number, n = 20): FramePacket => {
    scene.hour = hour;
    let p!: FramePacket;
    for (let k = 0; k < n; k++) {
      scene.now += 1000 / 60;
      p = scene.build(cam, remote);
    }
    return p;
  };
  return { scene, cam, frames, tube: scene.assets.table.find(TUBE) };
}

test("a frame at night on high: the lamp's lens and light in the frame block, its map drawn after the far map's, and what stands under it casting into it", () => {
  const { frames, tube } = lampWorld(tierOf("high"));
  const p = frames(0);
  const f = p.frame;
  [10, 8.85 - 1.7, 0.9].forEach((v, k) => expect(f[LAMP_AT + k]).toBeCloseTo(v, 4));
  expect([f[LAMP_AT + 3], f[LAMP_AT + 7]]).toEqual([LAMP_RANGE, shadowLayer(MAX_CASCADES, 3)]);
  expect(shadowLayer(MAX_CASCADES, 3)).toBe(shadowLayers(tierOf("high").shadows) - 1);
  expect(p.cascadesDrawn & LAMP_BIT).toBe(LAMP_BIT);
  expect(Array.from(p.maps.subarray(MAX_CASCADES * 16))).toEqual(Array.from(f.subarray(LAMP_AT + 8, LAMP_AT + 24)));
  expect(Array.from(p.maps.subarray(0, 16))).toEqual(Array.from(p.cascades.subarray(0, 16)));
  // The body under the lamp and the lamp's own piece cast into its map; the ground does not.
  const into = (mesh: number): boolean => Array.from({ length: p.casterCount }, (_, e) => e).some((e) => p.casterMesh[e] === mesh && (p.casterCascades[e]! & LAMP_BIT) !== 0);
  expect(into(tube)).toBe(true);
  for (let t = 0; t < p.tileCount; t++) expect(p.tilePass[t]! & (4 << MAX_CASCADES)).toBe(0);
});

test("a lamp none of whose light the camera can see draws no map, while its card stays out as it was", () => {
  const w = lampWorld(tierOf("high"));
  w.frames(0);
  // 28 m off along x, farther than its light reaches across, and looking away.
  w.cam.x = 92;
  w.cam.yaw = -Math.PI / 2;
  const p = w.frames(0, 3);
  expect([p.frame[LAMP_AT + 3], p.cascadesDrawn & LAMP_BIT, w.scene.streetLamps.shows]).toEqual([0, 0, 1]);
  w.cam.yaw = Math.PI / 2;
  expect(w.frames(0, 1).cascadesDrawn & LAMP_BIT).toBe(LAMP_BIT);
});

test("by day, at dusk before the lamps are on, on medium and on a phone, no lamp lights and no map of it is drawn", () => {
  for (const [tier, hour] of [[tierOf("high"), 12], [tierOf("ultra"), hourOfSun(10, true)], [tierOf("medium"), 0], [forTouch(tierOf("high"), true), 0]] as const) {
    const p = lampWorld(tier).frames(hour);
    expect([p.frame[LAMP_AT + 3], p.cascadesDrawn & LAMP_BIT]).toEqual([0, 0]);
    for (let e = 0; e < p.casterCount; e++) expect(p.casterCascades[e]! & LAMP_BIT).toBe(0);
  }
  // Only high and ultra off a phone hold its layer.
  expect([tierOf("medium"), tierOf("high"), tierOf("ultra"), forTouch(tierOf("high"), true)].map((t) => shadowLayers(t.shadows))).toEqual([3, 5, 6, 4]);
});
