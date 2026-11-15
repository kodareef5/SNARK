// The sea on the lit tiers (D270): how deep it is, read as the WATER program reads the ground's two pictures; what it
// mirrors, lets through and glints with, by the twin the lit probe holds a GPU to; and the draw the scene gives it.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_BLEND, DRAW_WATER, FRAME, FRAME_FLOATS, SOURCE_WINDOW } from "../../client/core/render/packet.ts";
import { domeLight, hourOfSun, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { COARSE, groundSize } from "../../client/core/render/terrain.ts";
import { BREEZE, WATER_MATERIAL, seaDepth, seaFrame, seaPixel, waveStrength } from "../../client/core/render/water.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { sceneSet, sceneWorld } from "../fixtures/sceneworld.ts";

const sky = theSky();

/** A frame block at an hour. */
function frameAt(hour: number): Float32Array {
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, f);
  return f;
}

/** A map wider than the terrain window, 2,176 m square: a rolling sea floor 2 to 10 m under a sea at 0. */
function seaFloor(): Heightfield {
  const hf = new Heightfield({ chunksX: 34, chunksZ: 34 }, TERRAIN_CELL, -64, 1 / 64);
  hf.seaLevel = 0;
  const [a, b] = [Array.from({ length: 74 }, (_, i) => Math.sin((i * 2 * Math.PI) / 74)), Array.from({ length: 106 }, (_, j) => Math.cos((j * 2 * Math.PI) / 106))];
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.heights[j * hf.nx + i] = Math.round((58 + 4 * a[i % 74]! * b[j % 106]!) * 64);
  return hf;
}

test("the sea's depth is the map's own where the window round the camera holds it, eased into the whole map's coarser pair at its edge without a step, and open sea past the map", () => {
  const hf = seaFloor();
  const size = groundSize(hf);
  // The window drawn from sample (32, 32), so it ends 64 m short of the map's far edges; the camera at (300, 300).
  const window = Int32Array.of(0, 32, 32, -1, 0, 0, 0, 0);
  const f = frameAt(12);
  seaFrame(f, hf, size, window, 300, 300, 0);
  const at = (x: number, z: number): number => seaDepth(f, hf, size, window, x - 300, z - 300);
  for (const [x, z] of [[300, 300], [321.3, 287.9], [612.7, 155.1], [100.5, 900.25]] as const) expect(at(x, z)).toBeCloseTo(-hf.heightAt(x, z), 2);
  // Along a line out of the window: no step, as steep as the ground and no more.
  const edge = (window[1]! + size.width[SOURCE_WINDOW]! - 1) * hf.cell;
  let last = at(edge - 40, 400);
  for (let x = edge - 40; x < edge + 40; x += 0.25) {
    const d = at(x, 400);
    expect(Math.abs(d - last)).toBeLessThan(0.05);
    last = d;
  }
  // Past the window, the whole map's every COARSE-th sample, cut on the same diagonal.
  const coarse = (x: number, z: number): number => {
    const step = hf.cell * COARSE;
    const [i, j] = [Math.floor(x / step), Math.floor(z / step)];
    const [u, v] = [x / step - i, z / step - j];
    const h = (a: number, b: number): number => hf.sample(a * COARSE, b * COARSE);
    return u >= v ? h(i, j) + (h(i + 1, j) - h(i, j)) * u + (h(i + 1, j + 1) - h(i + 1, j)) * v : h(i, j) + (h(i + 1, j + 1) - h(i, j + 1)) * u + (h(i, j + 1) - h(i, j)) * v;
  };
  expect(at(edge + 40.3, 610.9)).toBeCloseTo(-coarse(edge + 40.3, 610.9), 2);
  expect([at(-5, 400), at(400, hf.sizeZ + 20)]).toEqual([200, 200]);
  // With no window the whole map's pair alone.
  seaFrame(f, hf, size, Int32Array.of(-1, 0, 0, -1, 0, 0, 0, 0), 300, 300, 0);
  expect(seaDepth(f, hf, size, Int32Array.of(-1, 0, 0, -1, 0, 0, 0, 0), 312.7, 0)).toBeCloseTo(-coarse(612.7, 300), 2);
});

test("the frame block holds the waves' place in double precision, the ground's samples, sea level, and a breeze by day that is calm with the sun low", () => {
  const hf = seaFloor();
  const f = frameAt(12);
  seaFrame(f, hf, groundSize(hf), Int32Array.of(0, 32, 32, -1, 0, 0, 0, 0), 123456.789, 98765.4321, 86400 * 30);
  for (let k = 0; k < 4; k++) expect(f[FRAME.waves + k]! >= 0 && f[FRAME.waves + k]! < 1).toBe(true);
  expect([f[FRAME.ground], f[FRAME.ground + 2], f[FRAME.sea], f[FRAME.sea + 1], f[FRAME.sea + 2]]).toEqual([Math.fround(123456.789 / 2 - 32), Math.fround(123456.789 / 8), 64 * 64, 1 / 64, 0.5]);
  expect(f[FRAME.sea + 3]).toBeCloseTo(BREEZE.breeze, 5);
  expect([waveStrength(-20), waveStrength(BREEZE.calm), waveStrength(BREEZE.blown), waveStrength(66)]).toEqual([1, 1, BREEZE.breeze, BREEZE.breeze]);
  seaFrame(f, hf, groundSize(hf), Int32Array.of(-1, 0, 0, -1, 0, 0, 0, 0), 10, 10, 0);
  expect(f[FRAME.ground]).toBeLessThan(-1e5);
});

test("a calm sea mirrors the sky table, most of it at a grazing angle and SEA_F0 of it head on; it covers what is under it by its depth, and fades out over the shore", () => {
  const f = frameAt(12);
  const sun = [0, 0, 0];
  trueSun(f, sun);
  const up = [0, 1, 0];
  const mirrored = (v: number[]): number[] => {
    const out = [0, 0, 0];
    domeLight(sky.table, sun, [-v[0]!, v[1]!, -v[2]!], out);
    return out.map((c) => c * f[FRAME.skyScale]!);
  };
  // Half a degree under the horizon, away from the sun, over deep water: most of the sea's light is the sky's, a facet
  // being seen at least FACING from its edge; ten degrees under, Fresnel's edge has gone and much less of it is.
  const share = (down: number): number[] => {
    const v = [0, Math.sin(down), -Math.cos(down)];
    const px = seaPixel(f, sky.table, up, v, 50, 0);
    expect(px.cover).toBe(1);
    return mirrored(v).map((c, k) => px.light[k]! / c);
  };
  for (const s of share(0.0087)) expect(s > 0.65 && s < 1).toBe(true);
  for (const s of share(0.17)) expect(s).toBeLessThan(0.5);
  // Straight down over deep water: SEA_F0 of the sky and the deep water's own colour.
  const down = seaPixel(f, sky.table, up, [0, 1, 0], 50, 0);
  expect(down.cover).toBeCloseTo(1, 3);
  expect(down.light[2]! > down.light[0]! * 3).toBe(true);
  // Over sand 2 m down, seen 34 degrees down, the water covers most of it; 10 cm deep at the shore, little; on the shore, none.
  const view = [0, Math.sin(0.6), Math.cos(0.6)];
  const [two, shore, dry] = [2, 0.1, 0].map((d) => seaPixel(f, sky.table, up, view, d, 0).cover);
  expect([two! < 0.85, two! > 0.5, shore! < 0.15, dry]).toEqual([true, true, true, 0]);
});

test("the sun's glint is where the sun is and as strong as its disc is up: a bright path toward a low sun, none at dusk under the twilight's held light, and none away from it", () => {
  const glare = (hour: number, toward: boolean): number => {
    const f = frameAt(hour);
    const sun = [0, 0, 0];
    trueSun(f, sun);
    // The way to the eye from a calm sea where it mirrors the sun, or from where it is seen with the sun behind.
    const side = toward ? -1 : 1;
    const v = [side * sun[0]!, Math.max(Math.abs(sun[1]!), 0.05), side * sun[2]!];
    const lit = seaPixel(f, sky.table, [0, 1, 0], v.map((c) => c / Math.hypot(...v)), 50, 0.004);
    return Math.max(...lit.light) * f[FRAME.exposure]!;
  };
  const golden = hourOfSun(8, true);
  expect(glare(golden, true)).toBeGreaterThan(2);
  expect(glare(golden, false)).toBeLessThan(0.5);
  expect(glare(hourOfSun(-8, true), true)).toBeLessThan(0.5);
});

test("on a lit tier the sea seen from above is a WATER draw with the waves' material, past the map to the end of the view, and its pictures are asked for; under it, in a plain sky and on low poly it is the see-through draw it always was, over the map", () => {
  const set = sceneSet();
  const tube = set.manifest.materials!.findIndex((m) => m.id === "test:tube/hide");
  const asWater = { ...set, manifest: { ...set.manifest, materials: set.manifest.materials!.map((m, i) => (i === tube ? { ...m, id: WATER_MATERIAL } : m)) } };
  const w = sceneWorld({}, {}, asWater);
  w.hf.seaLevel = -0.5;
  w.scene.viewDistance = 3000;
  /** The sea's draw's flags, its material, and how far its tiles reach from the camera, in the next frame. */
  const look = (): [number, number, number] => {
    const p = w.frame(100, false);
    let d = 0;
    while (d < p.drawCount && p.drawMesh[d] !== w.mesh("core:water")) d++;
    const pos = new Float32Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 2);
    let reach = 0;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) reach = Math.max(reach, Math.abs(pos[i * 5]!) + 512, Math.abs(pos[i * 5 + 2]!) + 512);
    return [p.drawFlags[d]! & (DRAW_WATER | DRAW_BLEND), (p.drawFlags[d]! & DRAW_WATER) !== 0 ? p.drawMaterial[d]! : -1, reach];
  };
  let textures = 0;
  for (let k = 0; k < 8; k++) textures += w.frame(100, false).texUploads.length;
  const [flags, material, reach] = look();
  expect([flags, material, reach >= 3000, textures > 0]).toEqual([DRAW_WATER | DRAW_BLEND, tube, true, true]);
  const old = (): void => {
    const [f, m, r] = look();
    expect([f, m, r <= 1024 + 32]).toEqual([DRAW_BLEND, -1, true]);
  };
  w.scene.plainSky = true;
  old();
  w.scene.plainSky = false;
  w.cam.y = -2;
  old();
  w.cam.y = 1.2;
  w.scene.assets.tier = tierOf("lowpoly");
  old();
});

