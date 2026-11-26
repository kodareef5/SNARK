// Sun shadow casters as a frame lists them (D267): what each cascade takes and at which level, bodies out of view posed
// for their shadows, the ground that casts, and a cascade's depth map drawn from the list by the software rasterizer.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_CUTOUT, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FRAME, MAX_CASTERS, SOURCE_MAP, SOURCE_WINDOW, TILE_CASTS, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { LAMP_BIT } from "../../client/core/render/lamp.ts";
import { DEPTH_STEPS } from "../../client/core/render/shadow.ts";
import { hourOfSun } from "../../client/core/render/sky.ts";
import { moonCasts } from "../../client/core/render/surface.ts";
import { COARSE } from "../../client/core/render/terrain.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { chunkAt } from "../../shared/coords.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { siegeScene } from "../../tools/bench/shadow.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { encodePng } from "../../tools/snap/png.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { corePack } from "../fixtures/pack.ts";
import { PANEL, sceneRegistry, sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh } from "../fixtures/textured.ts";

const [W, H] = [160, 90];
/** The sun 14 degrees up in the morning, in the east: shadows fall toward +x, about four times as long as what casts them. */
const MORNING = hourOfSun(14, false);
const PILLAR = "core:pillar";

let made: Pack | null = null;
const pack = (): Pack => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), tubeMesh()], defaultPalette(), tubeClips(), [TUBE_RIG])));

/**
 * A map 256 m square, flat at 0 but for a hill 15 m high whose middle is at (`hill`, 128), at noon on `tier`. The camera
 * stands at (100, 1.7, 128), looking along +x.
 */
function world(tier: Tier = tierOf("medium"), hill = 150) {
  const reg = sceneRegistry();
  const dims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 15 * Math.exp(-((i * hf.cell - hill) ** 2 + (j * hf.cell - 128) ** 2) / (2 * 12 ** 2)));
  // Grass, as the proving ground's open ground is.
  hf.tint.fill(12);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack());
  scene.assets.tier = tier;
  scene.viewHeight = H;
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.aspect] = [100, 1.7, 128, Math.PI / 2, W / H];
  const remote = new RemoteSample();
  const raster = new Rasterizer(W, H, pack(), hf);
  const kind = (id: string): number => reg.index.get(id)!;
  const pillar = (x: number, z: number): number => structs.add(kind(PILLAR), x, 3, z, 0, 0, 1);
  const body = (x: number, z: number): void => {
    const n = remote.count++;
    [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [100 + n, kind(TUBE), x, 0, z, 0, 1];
  };
  const frame = (): FramePacket => {
    const p = scene.build(cam, remote);
    raster.render(p);
    return p;
  };
  return { dims, hf, scene, cam, remote, raster, structs, kind, pillar, body, frame, tube: scene.assets.table.find(TUBE), pillarMesh: scene.assets.table.find(PILLAR) };
}

/** The cascades the casters of a mesh in buffer `buffer` are listed for, together. */
function castsOf(p: FramePacket, mesh: number, buffer?: number): number {
  let mask = 0;
  for (let e = 0; e < p.casterCount; e++) if (p.casterMesh[e] === mesh && (buffer === undefined || p.casterBuffer[e] === buffer)) mask |= p.casterCascades[e]!;
  return mask;
}

/** A world point through cascade k's matrix: its texel in a map `size` a side, and its depth from 0 to 1. */
function texelOf(p: FramePacket, k: number, size: number, x: number, y: number, z: number): [number, number, number] {
  const m = p.cascades;
  const [rx, ry, rz] = [x - p.camX, y - p.camY, z - p.camZ];
  const at = (row: number): number => m[k * 16 + row]! * rx + m[k * 16 + 4 + row]! * ry + m[k * 16 + 8 + row]! * rz + m[k * 16 + 12 + row]!;
  return [Math.floor(((at(0) + 1) / 2) * size), Math.floor(((at(1) + 1) / 2) * size), (at(2) + 1) / 2];
}

test("a pillar behind the camera whose shadow falls in view casts, and one whose shadow cannot reach it does not", () => {
  const w = world();
  w.scene.hour = MORNING;
  // 15 m behind, its shadow 24 m long reaches 9 m ahead; 60 m behind, it ends 36 m behind the camera; 100 m to the side,
  // across the view, it falls across nothing in view either. Each is in a chunk of its own.
  const [near, far, side] = [w.pillar(85, 128), w.pillar(40, 128), w.pillar(100, 230)];
  expect([near, far, side].every((ref) => ref >= 0)).toBe(true);
  const p = w.frame();
  const chunk = (x: number, z: number): number => chunkAt(w.dims, x, z);
  expect(w.cam.boxVisible(85 - 0.25 - w.cam.x, -w.cam.y, 128 - 0.25 - w.cam.z, 85.25 - w.cam.x, 6 - w.cam.y, 128.25 - w.cam.z)).toBe(false);
  expect(new Set([chunk(85, 128), chunk(40, 128), chunk(100, 230)]).size).toBe(3);
  expect(castsOf(p, w.pillarMesh, chunk(85, 128))).toBe(0b11);
  expect(castsOf(p, w.pillarMesh, chunk(40, 128))).toBe(0);
  expect(castsOf(p, w.pillarMesh, chunk(100, 230))).toBe(0);
  expect([p.cascadeCount, p.cascadesDrawn, p.casterDropped]).toEqual([2, 0b11, 0]);
  // Its chunk is not drawn, but its instances went to the card for its shadow.
  expect(p.uploads.some((u) => u.buffer === chunk(85, 128))).toBe(true);
  for (let d = 0; d < p.drawCount; d++) expect(p.drawBuffer[d]).not.toBe(chunk(85, 128));
});

test("a chunk's pieces cast by their 16 m cells: each into the cascades it reaches, and no other", () => {
  const w = world();
  w.scene.hour = MORNING;
  // Pillars in two cells of the chunk the camera stands in, too many to cast whole, from 1 m ahead and from 48 m: the near
  // cascade reaches the first cell alone.
  w.cam.x = 66;
  const near: number[] = [], far: number[] = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 15; j++) near.push(w.pillar(67 + i, 129 + j) % 65536);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 15; j++) far.push(w.pillar(114 + i, 129 + j) % 65536);
  const p = w.frame();
  const chunk = chunkAt(w.dims, 70, 136);
  const slots = p.uploads.find((u) => u.buffer === chunk)!.slots;
  const cast = [new Set<number>(), new Set<number>()];
  for (let e = 0; e < p.casterCount; e++) {
    if (p.casterBuffer[e] !== chunk) continue;
    for (let k = 0; k < 2; k++) if ((p.casterCascades[e]! & (1 << k)) !== 0) for (let i = p.casterFirst[e]!; i < p.casterFirst[e]! + p.casterInstances[e]!; i++) cast[k]!.add(slots[i]!);
  }
  const sorted = (slots: Iterable<number>): number[] => [...slots].sort((a, b) => a - b);
  expect(cast.map(sorted)).toEqual([sorted(near), sorted([...near, ...far])]);
});

test("a body out of view whose shadow falls in it is posed by the call that poses it in view, and only casts", () => {
  const w = world();
  w.scene.hour = MORNING;
  // 4 m behind the camera, its 8 m shadow reaches 4 m ahead.
  w.body(96, 128);
  const tick = (w.remote.tick = 37.5);
  const away = w.frame();
  expect(w.scene.characters.posed).toBe(1);
  expect(castsOf(away, w.tube, TRANSIENT_BUFFER)).not.toBe(0);
  for (let d = 0; d < away.drawCount; d++) expect(away.drawMesh[d]).not.toBe(w.tube);
  const bones = away.bones.slice(0, away.boneCount);
  // Turned round to it, at the same moment: the same bones, now drawn.
  w.cam.yaw = -Math.PI / 2;
  w.remote.tick = tick;
  const seen = w.frame();
  expect(seen.bones.slice(0, seen.boneCount)).toEqual(bones);
  expect([...Array(seen.drawCount).keys()].some((d) => seen.drawMesh[d] === w.tube && (seen.drawFlags[d]! & DRAW_SKINNED) !== 0)).toBe(true);
  // 30 m behind, its shadow ends 22 m behind the camera: it is not posed.
  w.cam.yaw = Math.PI / 2;
  w.remote.x[0] = 70;
  const gone = w.frame();
  expect([w.scene.characters.posed, gone.boneCount, castsOf(gone, w.tube)]).toEqual([0, 0, 0]);
});

test("the ground casts from the tiles the view draws and from tiles out of view chosen as the view chooses them", () => {
  // The camera looks away from the hill, whose shadow falls toward it.
  const w = world(tierOf("high"), 70);
  w.scene.hour = MORNING;
  const p = w.frame();
  let [drawn, only] = [0, 0];
  for (let t = 0; t < p.tileCount; t++) {
    const pass = p.tilePass[t]!;
    if (pass < TILE_CASTS) continue;
    if ((pass & 3) !== 0) drawn++;
    else only++;
    // A tile reads the pair the view would read it from: the whole map's from 8 m quads up, else the window's.
    const stride = p.tiles[t * 4 + 3]!;
    expect(p.tileSource[t * 4 + 3]).toBe(stride % COARSE === 0 ? SOURCE_MAP : SOURCE_WINDOW);
  }
  expect(drawn).toBeGreaterThan(0);
  expect(only).toBeGreaterThan(0);
  // The hill's west slope, out of view behind the camera and sunward of the farther cascade's square, is in its map,
  // flattened onto the square's near face.
  const map = w.raster.cascade(p, 1, 256);
  const [i, j, d] = texelOf(p, 1, 256, 76, w.hf.heightAt(76, 128), 128);
  expect([i >= 0 && i < 256, j >= 0 && j < 256, d < 0, map[j * 256 + i]]).toEqual([true, true, true, 0]);
});

test("a cascade's depth map drawn from the list holds a pillar, a body and a hill, and nothing where nothing casts", () => {
  const w = world(tierOf("medium"), 150);
  w.scene.hour = MORNING;
  w.pillar(118, 124);
  w.body(112, 134);
  const p = w.frame();
  // Half the tier's side, 18 cm a texel, so that the pillar's 50 cm cover texel middles.
  const size = 1024;
  const map = w.raster.cascade(p, 1, size);
  // Inside the pillar and the body, whose backs from the sun are a few centimetres on along the light; on the hill's far
  // slope, which the tile there draws with 4 m quads, half a metre off the map's heights or 2 m along a light this low;
  // and flat ground with nothing over it.
  const depth = (x: number, y: number, z: number): [number, number] => {
    const [i, j, d] = texelOf(p, 1, size, x, y, z);
    return [map[j * size + i]!, d];
  };
  const metre = 1 / (2 * w.scene.cascades.half[1]!);
  for (const [x, y, z, before, after] of [[118.1, 3, 124, 0.05, 0.5], [112.05, 1, 134, 0.05, 0.5], [154, w.hf.heightAt(154, 128), 128, 2.5, 2.5]] as const) {
    const [stored, at] = depth(x, y, z);
    expect(stored).toBeGreaterThan(at - before * metre);
    expect(stored).toBeLessThan(at + after * metre);
  }
  expect(depth(118, 0, 140)[0]).toBe(1);
  // What L5 draws at: the farther cascade's texel at the tier's side, and 16-bit depth steps.
  expect([w.scene.cascades.texel[1]! * 1000, DEPTH_STEPS]).toEqual([expect.closeTo(89, 0), 65535]);
  if (process.env.SHADOW_PICTURE) writeFileSync(process.env.SHADOW_PICTURE, picture(w.raster, map, size));
});

test("a built wall turned a quarter casts along its own line, as it is drawn", () => {
  const w = world();
  w.scene.hour = 12;
  // A wall 3 m long, its length along z once turned, 12 m ahead: its depth is drawn by its base's vectors, not its raw turn.
  expect(w.structs.add(w.kind("core:wall_wood"), 112, 1.5, 128, 16384, 0, 1)).toBeGreaterThanOrEqual(0);
  const p = w.frame();
  const size = 1024;
  const map = w.raster.cascade(p, 1, size);
  const casts = (x: number, z: number): boolean => {
    const [i, j] = texelOf(p, 1, size, x, 2.5, z);
    return map[j * size + i]! < 1;
  };
  expect([casts(112, 126.8), casts(112, 129.2)]).toEqual([true, true]);
  expect([casts(110.8, 128), casts(113.2, 128)]).toEqual([false, false]);
});

/**
 * The view four times its size beside a depth map's casters, a square round them 360 pixels a side, nearest the sun
 * darkest and white where nothing casts, the light space's +y up.
 */
function picture(raster: Rasterizer, map: Float32Array, size: number): Uint8Array {
  const side = H * 4;
  const [width, height] = [W * 4 + side, side];
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < H * 4; y++) for (let x = 0; x < W * 4; x++) rgba.set(raster.color.subarray(((y >> 2) * W + (x >> 2)) * 4, ((y >> 2) * W + (x >> 2)) * 4 + 4), (y * width + x) * 4);
  let [lo, hi, i0, j0, i1, j1] = [1, 0, size, size, 0, 0];
  map.forEach((d, at) => {
    if (d === 1) return;
    [lo, hi] = [Math.min(lo, d), Math.max(hi, d)];
    [i0, j0, i1, j1] = [Math.min(i0, at % size), Math.min(j0, Math.floor(at / size)), Math.max(i1, at % size), Math.max(j1, Math.floor(at / size))];
  });
  const span = Math.max(i1 - i0, j1 - j0) * 1.1 + 8;
  const [ci, cj] = [(i0 + i1) / 2, (j0 + j1) / 2];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const [i, j] = [Math.floor(ci + (x / side - 0.5) * span), Math.floor(cj - (y / side - 0.5) * span)];
      const d = i >= 0 && j >= 0 && i < size && j < size ? map[j * size + i]! : 1;
      const grey = d < 1 ? Math.round(((d - lo) / Math.max(hi - lo, 1e-6)) * 200) : 255;
      rgba.set([grey, grey, grey, 255], (y * width + W * 4 + x) * 4);
    }
  }
  return encodePng(width, height, rgba);
}

test("at midnight the moon casts through the cascades, its shadows fall away from it; a phone's tier, the moon turned off and low poly cast nothing", () => {
  for (const [tier, hour, moon] of [[tierOf("ultra"), 0, true], [forTouch(tierOf("high"), true), 0, true], [tierOf("ultra"), 0, false], [tierOf("lowpoly"), 12, true]] as const) {
    const w = world(tier);
    w.scene.hour = hour;
    w.scene.moonShadows = moon;
    w.pillar(110, 128);
    w.body(105, 128);
    const p = w.frame();
    if (tier === tierOf("ultra") && moon) {
      expect(moonCasts(p.frame)).toBe(true);
      expect([p.cascadeCount, p.cascadesDrawn]).toEqual([4, 15]);
      expect(p.casterCount).toBeGreaterThan(0);
      // The cascades' light space looks along the moon: its depth axis, the matrix's third row, is the way away from it.
      const m = p.cascades;
      const away = Math.hypot(m[2]!, m[6]!, m[10]!);
      for (let k = 0; k < 3; k++) expect(-m[2 + 4 * k]! / away).toBeCloseTo(p.frame[FRAME.moon + k]!, 4);
      continue;
    }
    expect([p.cascadeCount, p.cascadesDrawn, p.casterCount, p.casterDropped]).toEqual([0, 0, 0, 0]);
    for (let t = 0; t < p.tileCount; t++) expect(p.tilePass[t]! < TILE_CASTS && p.tilePass[t]! > 0).toBe(true);
  }
});

test("casters ask for nothing, name only what the card holds, and cut out a section once its picture is there", () => {
  const run = (tier: Partial<Tier>): { log: string[]; flagged: number[] } => {
    const w = sceneWorld({ latencyMs: 60, bytesPerSecond: 80e3, seed: 4 }, tier);
    w.scene.hour = hourOfSun(20, true);
    for (let i = 0; i < 3; i++) w.structs.add(w.kind(PANEL), 30 + i * 2, 1, 26, 32768, 0, 1);
    // Out of view behind the camera, two more, and a creature.
    w.structs.add(w.kind(PANEL), 34, 1, 14, 0, 0, 1);
    w.place(TUBE, 33, 17);
    const flagged: number[] = [];
    for (let f = 0; f < 40; f++) {
      const p = w.frame(100, false);
      for (let e = 0; e < p.casterCount; e++) {
        const slot = p.casterSlot[e]!;
        expect(w.card.held.has(slot)).toBe(true);
        if ((p.casterFlags[e]! & DRAW_CUTOUT) === 0) continue;
        expect(w.card.surfaces.has(slot)).toBe(true);
        expect(w.card.textures.has(w.manifest.materials![p.casterMaterial[e]!]!.base)).toBe(true);
      }
      if (p.casterCount === 0) continue;
      const panel = [...Array(p.casterCount).keys()].filter((e) => p.casterMesh[e] === w.mesh(PANEL));
      flagged.push(panel.reduce((all, e) => all | p.casterFlags[e]!, 0));
    }
    return { log: w.port.log, flagged };
  };
  const off = run({ shadows: { ...tierOf("medium").shadows, cascades: 0 } });
  const on = run({});
  expect(on.log).toEqual(off.log);
  expect(off.flagged).toEqual([]);
  // The panel's lattice is two-sided and cut out: a caster by itself, cut out from when its picture is on the card.
  const first = on.flagged[0]!;
  const last = on.flagged.at(-1)!;
  expect([first & (DRAW_TEXTURED | DRAW_TWO_SIDED), first & DRAW_CUTOUT]).toEqual([DRAW_TEXTURED | DRAW_TWO_SIDED, 0]);
  expect(last & DRAW_CUTOUT).toBe(DRAW_CUTOUT);
});

test("a mesh at five levels in four cascades and the lamp's map keeps all five pairs", () => {
  const casting = world(tierOf("ultra")).scene.casting;
  const c = casting.cascades;
  const cam = new Camera();
  [cam.x, cam.y, cam.z] = [500, 2, 500];
  c.fit(cam, 0.3, 0.8, 0.52, tierOf("ultra").shadows, 0);
  c.lampTexel = 0.0025;
  c.drawn |= LAMP_BIT;
  // Ultra's filters blur 2.4, 6.6, 19.8 and 80 cm, the lamp's 0.5 cm: a level each.
  const n = c.entries(0b11111, [0, 0.004, 0.02, 0.06, 0.15, 0.5], 0b111111, casting.pairs);
  const pairs = Array.from({ length: n }, (_, e) => [casting.pairs[e * 2], casting.pairs[e * 2 + 1]]);
  expect(pairs).toEqual([[2, 0b0001], [3, 0b0010], [4, 0b0100], [5, 0b1000], [1, LAMP_BIT]]);
});

test("the siege scene fits the caster list on every lit tier, with none dropped", () => {
  const s = siegeScene(compileContent(CORE_CONTENT).registry!, corePack(), tierOf("medium"));
  const counts: number[] = [];
  // Its structures are building pieces only (tools/bench/shadow.ts), so a new station does not move it: 565, 764 and 812
  // entries on medium, high and ultra, with or without the refining forge. With every structure kind it was 3,702, 3,920 and
  // 3,996 on main before the forge, and the forge's two kinds took ultra to the 4,096 cap with 22 dropped.
  // With the whole pack every level is held from the first frame.
  for (const name of ["medium", "high", "ultra"] as const) {
    s.scene.assets.tier = tierOf(name);
    const p = s.scene.build(s.cam, s.remote);
    expect(p.casterDropped).toBe(0);
    expect(p.casterCount).toBeLessThan(MAX_CASTERS);
    counts.push(p.casterCount);
  }
  if (process.env.SHADOW_REPORT) console.log(`siege caster entries, medium, high, ultra: ${counts.join(", ")}`);
});
