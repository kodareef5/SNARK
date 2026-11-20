// Two depth ranges (D252): a tier with a split draws what is nearer than it with a projection that ends there, in the
// near half of the depth buffer, and what is farther with one that begins 2% short of it, in the far half.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { MAX_DRAWS, PASS_FAR, PASS_NEAR, STEP_FAR_SEE, TILE_CASTS, stepOf, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { chunkAt } from "../../shared/coords.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { PICK_SKY, PICK_TERRAIN, Rasterizer } from "../../tools/snap/raster.ts";
import { sceneRegistry } from "../fixtures/sceneworld.ts";
import { TUBE, TUBE_RIG, tubeClips, tubeMesh } from "../fixtures/textured.ts";

const SPLIT = tierOf("medium").split;
const [W, H] = [160, 90];
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;
const WALL = "core:wall";

let made: Pack | null = null;
/** The grey boxes of the core content, and the tube, a body on bones. */
const pack = (): Pack => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), tubeMesh()], defaultPalette(), tubeClips(), [TUBE_RIG])));

/** A map 1 km across and 2 km deep with its ground at `height`, drawn at medium with the view split at `split`. */
function world(height: (x: number, z: number) => number, split = SPLIT) {
  const reg = sceneRegistry();
  const dims = { chunksX: 16, chunksZ: 32 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, height(i * hf.cell, j * hf.cell));
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs }, reg, pack());
  scene.assets.tier = { ...tierOf("medium"), split };
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  const raster = new Rasterizer(W, H, pack(), hf);
  return { dims, hf, structs, scene, cam, raster, kind: (id: string) => reg.index.get(id)! };
}

/** A draw as what it draws, apart from the range it is drawn in. */
const drawn = (p: FramePacket, d: number): string => [p.drawMesh[d], p.drawLod[d], p.drawBuffer[d], p.drawFirst[d], p.drawInstances[d], p.drawFlags[d], p.drawMaterial[d], p.drawFirstIndex[d], ...p.drawOffset.subarray(d * 3, d * 3 + 3)].join(",");

/** The ranges each draw of a mesh is drawn in, a bit each, by its first instance. */
function rangesOf(p: FramePacket, mesh: number): number[] {
  const by = new Map<number, number>();
  for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === mesh) by.set(p.drawFirst[d]!, (by.get(p.drawFirst[d]!) ?? 0) | (1 << p.drawPass[d]!));
  return [...by.values()];
}

test("the sea 0.2 m deep, 1.5 km off and seen from 1 km up: at 24 bits one depth range loses it in many pixels, two in none", () => {
  const { scene, cam, raster, hf } = world(() => -0.2);
  // Looking 45 degrees down at ground 1.5 km off, along a view 10 degrees high: every pixel is ground 1.4 to 1.7 km off.
  [cam.x, cam.y, cam.z, cam.pitch, cam.fovY] = [512, 1500 * Math.SQRT1_2, 100, -Math.PI / 4, (10 * Math.PI) / 180];
  raster.depthBits = 24;
  const shot = (split: number, sea: number): Uint8ClampedArray => {
    scene.assets.tier = { ...tierOf("medium"), split };
    hf.seaLevel = sea;
    raster.render(scene.build(cam, null));
    expect(raster.pickKind.every((k) => k === PICK_TERRAIN)).toBe(true);
    return raster.color.slice();
  };
  const ground = shot(SPLIT, -Infinity);
  // A pixel where the water lost to the ground under it shows the ground alone.
  const lost = (split: number): number => {
    const c = shot(split, 0);
    let n = 0;
    for (let i = 0; i < W * H; i++) if ([0, 1, 2].every((k) => Math.abs(c[i * 4 + k]! - ground[i * 4 + k]!) <= 1)) n++;
    return n;
  };
  const [one, two] = [lost(0), lost(SPLIT)];
  expect(one).toBeGreaterThan(W * H * 0.2);
  expect(two).toBe(0);
});

test("across the split two ranges draw hills as one range does, pixel for pixel, so the seam leaves nothing undrawn", () => {
  // 250 m over hills, looking down the map's length either way, so the split crosses the lower third of the view.
  const { scene, cam, raster } = world((x, z) => 40 + 12 * Math.sin(x / 90) * Math.cos(z / 70) + 4 * Math.sin(x / 23 + z / 31));
  [cam.x, cam.y, cam.z, cam.pitch, cam.fovY] = [512, 290, 1024, -0.6, 0.5];
  let seam = 0;
  for (const yaw of [-0.3, 0, 0.3, Math.PI - 0.3, Math.PI, Math.PI + 0.3]) {
    cam.yaw = yaw;
    // The rasterizer draws no skirts, so a pixel or two of sky shows between tiles of different detail, in both.
    const pictures = [0, SPLIT].map((split) => {
      scene.assets.tier = { ...tierOf("medium"), split };
      raster.render(scene.build(cam, null));
      expect(raster.pickKind.filter((k) => k === PICK_SKY).length).toBeLessThan(5);
      return [raster.color.slice(), raster.pickKind.slice()] as const;
    });
    let differ = 0;
    for (let i = 0; i < W * H; i++) if (pictures[0]![1][i] !== pictures[1]![1][i] || [0, 1, 2].some((k) => pictures[0]![0][i * 4 + k] !== pictures[1]![0][i * 4 + k])) differ++;
    expect(differ).toBe(0);
    // A pixel drawn in the near range over one drawn in the far: depth under 0 is the near half's.
    const depth = raster.depth;
    for (let i = 0; i + W < W * H; i++) if (depth[i]! < 0 !== depth[i + W]! < 0) seam++;
  }
  // The split crossed every view.
  expect(seam).toBeGreaterThan(6 * W * 0.8);
});

test("a draw across the split is drawn in both ranges and every other in one, and the frame is in the order of its steps", () => {
  const { scene, cam, structs, kind, dims, hf } = world(() => 0);
  [cam.x, cam.y, cam.z] = [512, 2, 300];
  // Walls 100 m, 384 m and 600 m along the view, each in a chunk of its own, and the sea, which reaches past the split.
  const along = [100, SPLIT, 600];
  for (const a of along) structs.add(kind(WALL), 512, 1.5, 300 + a, 0, 0, 1);
  hf.seaLevel = -1;
  // The tube, a body on bones, 384 m off and then 50 m off.
  const remote = new RemoteSample();
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.x[0], remote.y[0], remote.flags[0]] = [100, kind(TUBE), 512, 0, 1];
  const tube = scene.assets.table.find(TUBE);
  const water = scene.assets.table.find("core:water");
  for (const [off, tubes] of [[SPLIT, [NEAR | FAR]], [50, [NEAR]]] as [number, number[]][]) {
    remote.z[0] = 300 + off;
    const p = scene.build(cam, remote);
    const walls = along.map((a) => {
      let r = 0;
      for (let d = 0; d < p.drawCount; d++) if (p.drawBuffer[d] === chunkAt(dims, 512, 300 + a)) r |= 1 << p.drawPass[d]!;
      return r;
    });
    expect(walls).toEqual([NEAR, NEAR | FAR, FAR]);
    expect(rangesOf(p, tube)).toEqual(tubes);
    expect(rangesOf(p, water)).toEqual([NEAR | FAR]);
    // Near opaque, far opaque, far see-through, near see-through. The dome goes before the far range's first see-through draw.
    const steps = Array.from({ length: p.drawCount }, (_, d) => stepOf(p, d));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(p.skyAt).toBe(steps.findIndex((s) => s >= STEP_FAR_SEE));
  }
});

test("along a walk two ranges keep the draws and tiles one range keeps, and a full frame counts a draw in both as two", () => {
  const height = (x: number, z: number): number => 20 + 15 * Math.sin(x / 120) * Math.sin(z / 150);
  const [one, two] = [0, SPLIT].map((split) => world(height, split)) as [ReturnType<typeof world>, ReturnType<typeof world>];
  for (const w of [one, two]) {
    const r = new Rng(3);
    for (let n = 0; n < 60; n++) {
      const [x, z] = [r.range(20, 1000), r.range(20, 2000)];
      w.structs.add(w.kind(n % 2 ? WALL : "core:foundation"), x, height(x, z) + 1.5, z, r.int(4) * 16384, 0, 1);
    }
  }
  const rng = new Rng(7);
  const tiles = (p: FramePacket): string[] => Array.from({ length: p.tileCount }, (_, t) => [...p.tiles.subarray(t * 4, t * 4 + 4), ...p.tileOrigin.subarray(t * 2, t * 2 + 2)].join(",")).sort();
  let doubled = 0;
  for (let f = 0; f < 40; f++) {
    const [x, z, yaw, pitch] = [rng.range(100, 900), rng.range(100, 1900), rng.range(-Math.PI, Math.PI), rng.range(-0.4, 0.1)];
    const [a, b] = [one, two].map((w) => {
      [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [x, height(x, z) + 30, z, yaw, pitch];
      return w.scene.build(w.cam, null);
    }) as [FramePacket, FramePacket];
    const listA = Array.from({ length: a.drawCount }, (_, d) => drawn(a, d)).sort();
    const listB = [...new Set(Array.from({ length: b.drawCount }, (_, d) => drawn(b, d)))].sort();
    expect(new Set(listA).size).toBe(listA.length);
    expect(listB).toEqual(listA);
    doubled += b.drawCount - listB.length;
    expect(tiles(b)).toEqual(tiles(a));
    // A tile in no range is one only shadows need (TILE_CASTS).
    expect([...b.tilePass.subarray(0, b.tileCount)].every((r) => (r & (NEAR | FAR)) !== 0 || r >= TILE_CASTS)).toBe(true);
    expect([a.dropped, b.dropped]).toEqual([0, 0]);
  }
  expect(doubled).toBeGreaterThan(0);

  // Walls standing across the split, each a loose thing and a draw of its own: half as many fit.
  const { scene, cam } = world(() => 0);
  [cam.x, cam.y, cam.z] = [512, 100, 100];
  const mesh = scene.assets.table.find(WALL);
  scene.things = Array.from({ length: MAX_DRAWS }, (_, k) => ({ mesh, x: 500 + (k % 32), y: 100, z: 100 + SPLIT + (k >> 5) * 0.01, level: -1 }));
  const full = scene.build(cam, null);
  expect([full.drawCount, full.dropped]).toEqual([MAX_DRAWS, MAX_DRAWS / 2]);
});
