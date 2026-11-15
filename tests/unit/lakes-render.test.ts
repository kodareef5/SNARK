// Water on its own surfaces as the client draws and hears it (client/core/render/lakes.ts), on the lakes map: a pond on
// a terrace 20 m up, a pond 1.5 m up whose bed goes under the sea's level, a channel of two reaches, the sea in the south.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { GROUND_WATER as DUST_WATER, groundAt as dustGround } from "../../client/core/details/ground.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FAR_MESH } from "../../client/core/render/far.ts";
import { LAKE_SLOTS, Lakes } from "../../client/core/render/lakes.ts";
import { DRAW_BLEND, DRAW_WATER, FRAME, FramePacket, PASS_FAR, PASS_NEAR } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { UNDERWATER_VIEW, WATER_TILE } from "../../client/core/render/shading.ts";
import { groundSize } from "../../client/core/render/terrain.ts";
import { seaDepth } from "../../client/core/render/water.ts";
import { GROUND_WATER, groundAt } from "../../client/core/sound/ground.ts";
import { WORLD_LOOPS, WorldSounds } from "../../client/core/sound/world.ts";
import { paintRelief } from "../../client/core/tactical.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { PICK_SKY, Rasterizer } from "../../tools/snap/raster.ts";
import { farPack, farRegistry } from "../fixtures/farworld.ts";
import { LAKES, lakesGround, lakesMap } from "../fixtures/lakes.ts";

const [W, H] = [160, 90];

/** The lakes map, or it with no sea (`sea` -Infinity) or no water of its own, seen through a scene on `tier`. */
function lakes(o: { sea?: number; bodies?: boolean; tier?: string } = {}) {
  const hf = mapHeightfield(lakesMap());
  if (o.sea !== undefined) hf.seaLevel = o.sea;
  if (o.bodies === false) hf.water = null;
  const reg = farRegistry();
  const pack = farPack();
  const structs = new StructureStore(hf.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims: hf.dims, hf, structs }, reg, pack);
  scene.assets.tier = tierOf(o.tier ?? "lowpoly");
  scene.viewHeight = H;
  const cam = new Camera();
  cam.aspect = W / H;
  const raster = new Rasterizer(W, H, pack, hf);
  const far = pack.header.meshes.findIndex((m) => m.id === FAR_MESH);
  let now = 0;
  return {
    hf, scene, cam, raster, pack, far,
    /** A frame a tenth of a second after the last. */
    frame(): FramePacket {
      scene.now = now += 100;
      return scene.build(cam, null);
    },
    /** The draws of the lakes' tiles. */
    lakeDraws(p: FramePacket): number[] {
      return Array.from({ length: p.drawCount }, (_, d) => d).filter((d) => p.drawMesh[d] === far && p.drawSlot[d]! >= LAKE_SLOTS);
    },
    /** The rasterizer's picture of the next frame. */
    picture(): Uint8ClampedArray {
      raster.render(this.frame());
      return raster.color.slice();
    },
  };
}

/** Each face of a level made for FAR_MESH's bounds, its four corners in the world, from where a draw puts its corner. */
function faces(pack: ReturnType<typeof farPack>, mesh: number, data: Uint8Array, indexCount: number, indexBytes: number, at: readonly number[]): number[][][] {
  const m = pack.header.meshes[mesh]!;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const from = (indexCount * indexBytes + 3) & ~3;
  const corner = (v: number): number[] => [0, 1, 2].map((a) => m.center[a]! + (view.getInt16(from + v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]! + at[a]!);
  return Array.from({ length: (data.length - from) / VERTEX_BYTES / 4 }, (_, f) => [0, 1, 2, 3].map((k) => corner(f * 4 + k)));
}

/** Every face of the lakes' tiles of the lakes map, in the world. */
function lakeFaces(): number[][][] {
  const { hf, pack, far } = lakes();
  const made = new Lakes(hf, hf.water!, far, pack.header.meshes[far]!);
  const p = new FramePacket();
  made.update(p, { spend: () => {}, reserve: () => {} }, 128, 128, 1e5);
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.pitch, cam.fovY, cam.far] = [512, 3000, 512, -Math.PI / 2, 2.5, 10000];
  cam.update();
  const out: number[][][] = [];
  made.draw(cam, 1e5, (slot, _t, ox, oy, oz) => {
    const u = p.assetUploads.find((a) => a.slot === slot)!;
    out.push(...faces(pack, far, u.data, u.indexCount, u.indexBytes, [ox + cam.x, oy + cam.y, oz + cam.z]));
  });
  expect(out.length).toBeGreaterThan(0);
  return out;
}

/** The lowest ground under the square of LAKES.cell whose corner is (x, z). */
function lowest(hf: Heightfield, x: number, z: number): number {
  let low = Infinity;
  for (let j = Math.floor(z / hf.cell); j <= Math.ceil((z + LAKES.cell) / hf.cell); j++) for (let i = Math.floor(x / hf.cell); i <= Math.ceil((x + LAKES.cell) / hf.cell); i++) low = Math.min(low, hf.sample(i, j));
  return low;
}

test("a body is drawn at its surface over its squares that hold water and none other, with a sheet down the channel's step, and the sea on every square of its tile that is no body's", () => {
  const hf = lakes().hf;
  const water = hf.water!;
  const all = lakeFaces();
  const flat = all.filter((f) => f.every((c) => c[1] === f[0]![1]));
  const upright = all.filter((f) => !flat.includes(f));
  // Each flat face covers whole squares, every one of them a body's that holds water at the face's height, or the sea's.
  const covered = new Map<string, number>();
  for (const f of flat) {
    const y = f[0]![1]!;
    const [x0, x1] = [Math.min(...f.map((c) => c[0]!)), Math.max(...f.map((c) => c[0]!))].map((v) => Math.round(v / LAKES.cell) * LAKES.cell);
    const [z0, z1] = [Math.min(...f.map((c) => c[2]!)), Math.max(...f.map((c) => c[2]!))].map((v) => Math.round(v / LAKES.cell) * LAKES.cell);
    for (let z = z0!; z < z1!; z += LAKES.cell) {
      for (let x = x0!; x < x1!; x += LAKES.cell) {
        const key = `${x},${z}`;
        expect(covered.has(key)).toBe(false);
        covered.set(key, y);
        if (x >= hf.sizeX || z >= hf.sizeZ) continue;
        const b = water.bodyAt(x + 1, z + 1);
        if (b === 0) expect(y).toBeCloseTo(LAKES.sea, 2);
        else {
          expect(y).toBeCloseTo(water.surface[b]!, 1);
          expect(lowest(hf, x, z)).toBeLessThan(water.surface[b]!);
        }
      }
    }
  }
  // Every square of the map is covered but the body squares whose ground is all above their surface; the sea runs on
  // to the end of the sea's tile, past the map.
  let dry = 0;
  for (let z = 0; z < WATER_TILE; z += LAKES.cell) {
    for (let x = 0; x < WATER_TILE; x += LAKES.cell) {
      const b = x < hf.sizeX && z < hf.sizeZ ? water.bodyAt(x + 1, z + 1) : 0;
      const holds = b === 0 || lowest(hf, x, z) < water.surface[b]!;
      expect(covered.has(`${x},${z}`)).toBe(holds);
      if (!holds) dry++;
    }
  }
  expect(dry).toBeGreaterThan(50);
  // Upright faces: the step between the channel's reaches, 0.5 m tall across its water, and no other.
  const { river } = LAKES;
  expect(upright.length).toBeGreaterThan(0);
  for (const f of upright) {
    expect(f.every((c) => Math.abs(c[0]! - river.step) < 0.01)).toBe(true);
    const ys = f.map((c) => c[1]!);
    expect(Math.min(...ys)).toBeCloseTo(river.lower, 1);
    expect(Math.max(...ys)).toBeCloseTo(river.upper, 1);
  }
  const zs = upright.flatMap((f) => f.map((c) => c[2]!));
  expect(Math.min(...zs)).toBeLessThanOrEqual(river.z - river.width + 0.01);
  expect(Math.max(...zs)).toBeGreaterThanOrEqual(river.z + river.width - 0.01);
});

/**
 * The first thing on the map a ray from the camera through a pixel meets: the ground, or water (a body's number, or 0
 * for the sea's), where, and how deep it is there. Null for none, or for one past the map, where low poly draws no sea.
 */
function hit(hf: Heightfield, cam: Camera, px: number, py: number): { water: number; x: number; z: number; depth: number } | null {
  const r = [0, 0, 0];
  cam.ray((px + 0.5) / W, (py + 0.5) / H, r);
  for (let t = 0; t < 600; t += 0.25) {
    const [x, y, z] = [cam.x + r[0]! * t, cam.y + r[1]! * t, cam.z + r[2]! * t];
    if (x < 0 || z < 0 || x > hf.sizeX || z > hf.sizeZ) {
      if (y < 0) return null;
      continue;
    }
    const ground = hf.heightAt(x, z);
    const top = hf.waterAt(x, z);
    if (y < top && ground < top) return { water: hf.water?.bodyAt(x, z) ?? 0, x, z, depth: top - ground };
    if (y < ground) return { water: -1, x, z, depth: 0 };
  }
  return null;
}

test("low poly draws each body see-through over its water from above, the dry land as it was, and in the low pond and the channel, whose beds go under the sea, no sea", () => {
  const withWater = lakes();
  const dry = lakes({ bodies: false });
  const noSea = lakes({ sea: -Infinity });
  const none = lakes({ sea: -Infinity, bodies: false });
  for (const w of [withWater, dry, noSea, none]) [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [128, 150, -60, 0, -0.75];
  const [a, b, c, e] = [withWater.picture(), dry.picture(), noSea.picture(), none.picture()];
  // The lakes draw on low poly: see-through and flat.
  const p = withWater.frame();
  const draws = withWater.lakeDraws(p);
  expect(draws.length).toBeGreaterThan(0);
  for (const d of draws) expect(p.drawFlags[d]! & (DRAW_BLEND | DRAW_WATER)).toBe(DRAW_BLEND);
  // The sea's own mesh is not drawn over the sea's tile the map lies in, since a body's bed goes under the sea there.
  expect(Array.from({ length: p.drawCount }, (_, d) => p.drawMesh[d]).includes(withWater.pack.header.meshes.findIndex((m) => m.id === "core:water"))).toBe(false);
  const kinds = new Map<string, number>();
  const count = (k: string): void => void kinds.set(k, (kinds.get(k) ?? 0) + 1);
  const off = (x: Uint8ClampedArray, y: Uint8ClampedArray, i: number): number => Math.max(...[0, 1, 2].map((k) => Math.abs(x[i * 4 + k]! - y[i * 4 + k]!)));
  const hits = Array.from({ length: W * H }, (_, i) => hit(withWater.hf, withWater.cam, i % W, Math.floor(i / W)));
  /** The pixel's hit, if every pixel round it meets the same and it is not at a shore. */
  const clear = (i: number) => {
    const h = hits[i];
    if (!h || (h.water >= 0 && h.depth < 0.5)) return null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (hits[i + dy * W + dx]?.water !== h.water) return null;
    return h;
  };
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const h = clear(i);
      if (!h) continue;
      if (h.water > 0) {
        // A body's water: drawn over the bare ground once, as with no sea at all, the sea not drawn under it.
        count(`body ${h.water}`);
        expect(off(a, e, i)).toBeGreaterThan(4);
        expect(off(a, c, i)).toBeLessThanOrEqual(2);
      } else if (h.water === 0) {
        // The sea, drawn by the lakes' tile where the map's sea tile is theirs, as its own mesh draws it.
        count("sea");
        expect(off(a, b, i)).toBeLessThanOrEqual(2);
        expect(off(a, e, i)).toBeGreaterThan(4);
      } else {
        // Dry land as with no bodies. The rasterizer draws no skirts, so a crack between tiles may show the sea under it.
        count("land");
        expect(off(a, b, i)).toBe(0);
      }
    }
  }
  for (const k of ["body 1", "body 2", "body 3", "body 4", "sea", "land"]) expect(kinds.get(k) ?? 0).toBeGreaterThan(10);
});

test("lit, from above a body: its tiles are WATER draws, the frame block's sea part is filled, and the twin's depth is the pixel's own surface over the ground, with a sea, with none, and with the camera under 0 on a map with none", () => {
  const depthAt = (w: ReturnType<typeof lakes>, p: FramePacket, x: number, z: number, surface: number): number => seaDepth(p.frame, w.hf, groundSize(w.hf), p.groundWindow, x - w.cam.x, z - w.cam.z, surface - w.cam.y);
  // Each 30 m or more inside the map's edge, where the window's heights are read alone.
  const points: [number, number, number][] = [
    [LAKES.high.x, LAKES.high.z, LAKES.high.surface],
    [LAKES.high.x + 17.3, LAKES.high.z - 9.1, LAKES.high.surface],
    [LAKES.low.x - 6.6, LAKES.low.z + 3.2, LAKES.low.surface],
    [40.5, LAKES.river.z + 2.25, LAKES.river.upper],
    [100.25, LAKES.river.z - 3.5, LAKES.river.lower],
  ];
  for (const [sea, y, datum] of [[LAKES.sea, 40, LAKES.sea], [-Infinity, 40, 0], [-Infinity, -0.5, -0.5]] as const) {
    const w = lakes({ sea, tier: "medium" });
    [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [190, y, y > 0 ? 120 : 10, 0, y > 0 ? -0.4 : 0.02];
    const p = w.frame();
    expect(p.groundWindow[0]).toBe(0);
    const draws = w.lakeDraws(p);
    expect(draws.length).toBeGreaterThan(0);
    for (const d of draws) expect(p.drawFlags[d]! & (DRAW_BLEND | DRAW_WATER)).toBe(DRAW_BLEND | DRAW_WATER);
    expect(p.frame[FRAME.eyeHeight]).toBeCloseTo(Math.max(y - datum, 0), 4);
    expect(p.frame[FRAME.sea]).toBeCloseTo((datum - w.hf.minY) / w.hf.stepY, 2);
    for (const [x, z, surface] of points) {
      expect(depthAt(w, p, x, z, surface)).toBeCloseTo(surface - w.hf.heightAt(x, z), 2);
      expect(Math.abs(w.hf.heightAt(x, z) - lakesGround(x, z))).toBeLessThan(0.2);
    }
    // A point of the dry terrace round the high pond, on its surface, is under the ground.
    expect(depthAt(w, p, LAKES.high.x, LAKES.high.z + LAKES.high.r + 10, LAKES.high.surface)).toBeLessThan(0);
  }
  // With a sea, the sea's own tiles run on past the map with their waves, but for the sea's tile the map lies in.
  const w = lakes({ tier: "medium" });
  [w.cam.x, w.cam.y, w.cam.z, w.cam.pitch] = [190, 40, 120, -0.4];
  const p = w.frame();
  const seaMesh = w.pack.header.meshes.findIndex((m) => m.id === "core:water");
  const sea = Array.from({ length: p.drawCount }, (_, d) => d).filter((d) => p.drawMesh[d] === seaMesh);
  expect(sea.length).toBeGreaterThan(0);
  const pos = new Float32Array(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength >> 2);
  for (const d of sea) {
    expect(p.drawFlags[d]! & DRAW_WATER).toBe(DRAW_WATER);
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) expect([Math.round(pos[i * 5]! + w.cam.x), Math.round(pos[i * 5 + 2]! + w.cam.z)]).not.toEqual([WATER_TILE / 2, WATER_TILE / 2]);
  }
});

test("under a body the view is short and the fog the water's, on low poly and lit, every water drawn flat, and the rasterizer's dome is the fog", () => {
  for (const tier of ["lowpoly", "medium"]) {
    const under = lakes({ tier });
    const over = lakes({ tier });
    // 2 m under the high pond, its bed 4 m under it, looking up through it.
    [under.cam.x, under.cam.y, under.cam.z, under.cam.pitch] = [LAKES.high.x, LAKES.high.surface - 2, LAKES.high.z, 0.5];
    [over.cam.x, over.cam.y, over.cam.z, over.cam.pitch] = [LAKES.high.x, LAKES.high.surface + 2, LAKES.high.z, 0.5];
    const p = under.frame();
    expect([p.fogStart, p.fogEnd]).toEqual([0, UNDERWATER_VIEW]);
    expect(p.frame[FRAME.eyeHeight]).toBeCloseTo(-2, 4);
    const sky = Array.from(p.sky);
    const q = over.frame();
    expect(q.fogEnd).toBeGreaterThan(1000);
    expect(Array.from(q.sky)).not.toEqual(sky);
    const draws = under.lakeDraws(p);
    expect(draws.length).toBeGreaterThan(0);
    for (let d = 0; d < p.drawCount; d++) expect(p.drawFlags[d]! & DRAW_WATER).toBe(0);
    // Up past the surface, with nothing drawn but the ground: the dome is the fog's colour.
    p.drawCount = 0;
    under.raster.render(p);
    const top = W * 3 + W / 2;
    expect(under.raster.pickKind[top]).toBe(PICK_SKY);
    for (let k = 0; k < 3; k++) expect(Math.abs(under.raster.color[top * 4 + k]! - sky[k]! * 255)).toBeLessThanOrEqual(1);
  }
});

test("a body is drawn in the far range past the split, and to the end of the view", () => {
  const w = lakes({ tier: "medium" });
  const split = w.scene.assets.tier.split;
  /** The ranges the lakes' draws of the next frame are in, a bit each. The rasterizer draws it. */
  const ranges = (): number => {
    const p = w.frame();
    w.raster.render(p);
    let r = 0;
    for (const d of w.lakeDraws(p)) r |= 1 << p.drawPass[d]!;
    return r;
  };
  // From 400 m up and 500 m south of the map, looking at its middle through a narrow view: wholly past the split.
  const view = (c: Camera): void => void ([c.x, c.y, c.z, c.pitch, c.fovY] = [128, 400, -500, -Math.atan2(390, 628), 0.5]);
  view(w.cam);
  expect(ranges()).toBe(1 << PASS_FAR);
  expect(Math.hypot(390, 500)).toBeGreaterThan(split);
  w.raster.render(w.frame());
  const far = w.raster.color.slice();
  const dry = lakes({ tier: "medium", bodies: false });
  view(dry.cam);
  dry.raster.render(dry.frame());
  let changed = 0;
  for (let i = 0; i < W * H; i++) if ([0, 1, 2].some((k) => Math.abs(far[i * 4 + k]! - dry.raster.color[i * 4 + k]!) > 4)) changed++;
  expect(changed).toBeGreaterThan(60);
  // Standing on the plain the near ones are in the near range, from 3.5 km off still drawn, and past the view's end not.
  [w.cam.x, w.cam.y, w.cam.z, w.cam.pitch, w.cam.fovY] = [LAKES.spawn.x, 4, LAKES.spawn.z, -0.1, 1.2217];
  expect(ranges() & (1 << PASS_NEAR)).toBe(1 << PASS_NEAR);
  [w.cam.x, w.cam.y, w.cam.z, w.cam.pitch] = [128, 100, -3500, -0.02];
  expect(ranges()).toBe(1 << PASS_FAR);
  [w.cam.z] = [-w.scene.viewDistance - 100];
  expect(ranges()).toBe(0);
});

test("the map shows each body's water over its basin, and the terrace round it as it was", () => {
  const palette = defaultPalette();
  const shown = (hf: Heightfield): Uint32Array => {
    const out = new Uint32Array(256 * 256);
    paintRelief(hf, palette, 0, 0, 0, 256, out);
    return out;
  };
  const withWater = shown(lakes().hf);
  const dry = shown(lakes({ bodies: false }).hf);
  // The map is drawn with x and z both running from its far corner, a metre a pixel here.
  const at = (x: number, z: number): number => Math.floor(256 - z) * 256 + Math.floor(256 - x);
  const blue = (c: number): boolean => ((c >> 16) & 255) > (c & 255) + 30;
  for (const [x, z] of [[LAKES.high.x, LAKES.high.z], [LAKES.low.x, LAKES.low.z], [40, LAKES.river.z], [110, LAKES.river.z]] as const) {
    expect(blue(withWater[at(x, z)]!)).toBe(true);
    expect(withWater[at(x, z)]).not.toBe(dry[at(x, z)]);
  }
  expect(withWater[at(LAKES.high.x, LAKES.high.z + 45)]).toBe(dry[at(LAKES.high.x, LAKES.high.z + 45)]);
  expect(withWater[at(LAKES.spawn.x, LAKES.spawn.z)]).toBe(dry[at(LAKES.spawn.x, LAKES.spawn.z)]);
});

test("under a body the client hears and finds water: a foot is in it, the ear is under it, and the wind is measured from its surface", () => {
  const hf = lakes().hf;
  const [x, z] = [LAKES.high.x, LAKES.high.z];
  expect(groundAt(hf, x, LAKES.high.surface - 1, z)).toBe(GROUND_WATER);
  expect(dustGround(hf, x, LAKES.high.surface - 1, z)).toBe(DUST_WATER);
  expect(groundAt(hf, x, LAKES.high.surface + 1, z)).not.toBe(GROUND_WATER);
  const heard = (y: number): Map<number, boolean> => {
    const on = new Map<number, boolean>();
    new WorldSounds().update(0, hf, x, y, z, 12, () => 0, (id, _key, _level, state) => void on.set(id, state), () => {});
    return on;
  };
  expect(heard(LAKES.high.surface - 1).get(WORLD_LOOPS + 11)).toBe(true);
  expect(heard(LAKES.high.surface + 1).get(WORLD_LOOPS + 11)).toBe(false);
  // 34 m over the pond and 38 m over its bed: the light wind, not the strong.
  const high = heard(LAKES.high.surface + 34);
  expect([high.get(WORLD_LOOPS + 13), high.get(WORLD_LOOPS + 14)]).toEqual([true, false]);
  // The low pond's basin goes under the sea's level and is not the sea: no shore 30 m from its middle, where the ring
  // round the ear crosses it. Had it no squares, that would be the sea.
  const shore = (h: Heightfield): boolean | undefined => {
    const on = new Map<number, boolean>();
    new WorldSounds().update(0, h, LAKES.low.x + 30, 4, LAKES.low.z, 12, () => 0, (id, _k, _l, state) => void on.set(id, state), () => {});
    return on.get(WORLD_LOOPS + 12);
  };
  expect([shore(hf), shore(lakes({ bodies: false }).hf)]).toEqual([false, true]);
});
