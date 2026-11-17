// The sky a place sees (client/core/render/skyopen.ts): the measure hides what rays cast over the solid heights find
// hidden, at the ground and up a street's walls, and next to nothing over open ground; a building's cells read their
// street's, so the ground beside a turned building shows no 4 m cells; the foot of what stands loses sky light over the
// last metre and a half, but not a deck, a bridge or a body; the ground under a point is the heights picture's; the
// scene's part makes it when the statics come, by night and with no shadows, and again after pieces go but not more
// often than it should, and puts it on the card within the allowance; and the rasterizer, the reference for light,
// takes sky light from a street and leaves open ground as it was.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FAR_SPAN, FarShadow, TOP_CELL, makeSolid } from "../../client/core/render/farshadow.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { BEND_MOST, CONTACT, CONTACT_BAND, OPEN_EVERY, OPEN_HEIGHTS, OPEN_STRENGTH, OPEN_WAYS, openMeasure, overGround, skyOpen } from "../../client/core/render/skyopen.ts";
import { COARSE } from "../../client/core/render/terrain.ts";
import { YAW_UNITS, chunkAt, chunkCount, type MapDims } from "../../shared/coords.ts";
import { CityStatics, cityTops, type Gone } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { PICK_TERRAIN } from "../../tools/snap/raster.ts";
import { asWritten, building, cityWorld } from "../fixtures/cityworld.ts";
import { farRegistry } from "../fixtures/farworld.ts";

const UNIT = FAR_SPAN / 65535;
/** Units of the solid heights over the floor at `m` metres over a floor 64 m under the ground. */
const at = (m: number): number => Math.round((64 + m) / UNIT);

/** A street 16 m wide along z between two blocks 40 m wide and 48 m tall, 272 m long, and a lone tower 60 m tall, on 128 cells a side. */
function street() {
  const n = 128;
  const solid = new Uint16Array(n * n).fill(at(0)), ground = new Uint16Array(n * n).fill(at(0));
  for (let j = 30; j < 98; j++) for (const [i0, i1] of [[40, 50], [54, 64]] as const) for (let i = i0; i < i1; i++) solid[j * n + i] = at(48);
  for (let j = 100; j < 104; j++) for (let i = 100; i < 104; i++) solid[j * n + i] = at(60);
  return { n, solid, ground, map: openMeasure(solid, ground, n, n, 1, TOP_CELL, UNIT) };
}

/** The share of the sky hidden at `y` metres over the ground in the middle of cell (ci, cj), by rays cast every half metre over the cells' tops. */
function castHidden(solid: Uint16Array, n: number, ci: number, cj: number, y: number): number {
  const [px, pz] = [(ci + 0.5) * TOP_CELL, (cj + 0.5) * TOP_CELL];
  let hidden = 0;
  const [ways, heights] = [72, 30];
  for (let a = 0; a < ways; a++) {
    const [dx, dz] = [Math.cos(((a + 0.5) / ways) * 2 * Math.PI), Math.sin(((a + 0.5) / ways) * 2 * Math.PI)];
    for (let e = 0; e < heights; e++) {
      const rise = Math.tan(Math.asin((e + 0.5) / heights));
      for (let d = 0.5; d < 1200; d += 0.5) {
        const [i, j] = [Math.floor((px + dx * d) / TOP_CELL), Math.floor((pz + dz * d) / TOP_CELL)];
        if (i < 0 || j < 0 || i >= n || j >= n) break;
        if ((i !== ci || j !== cj) && solid[j * n + i]! * UNIT - 64 > y + d * rise) {
          hidden++;
          break;
        }
      }
    }
  }
  return hidden / (ways * heights);
}

/** The measure's hidden share at `y` metres over the ground at cell (i, j), as its bytes hold it. */
function measured(map: { bytes: Uint8Array; w: number }, i: number, j: number, y: number): number {
  const share = map.bytes[(j * map.w + i) * 2]! / 255, root = map.bytes[(j * map.w + i) * 2 + 1]! / 255;
  return Math.max(0, share - root ** 4 * BEND_MOST * y * y);
}

test("the measure hides what rays cast over the solid heights find hidden, at the ground and up a street's walls, and next to nothing over open ground", () => {
  const { n, solid, map } = street();
  expect([map.w, map.h, map.bytes.length]).toEqual([n, n, n * n * 2]);
  // The street's middle, by each wall, near its end and past it; open ground 80 m off and far off; by the tower and 8 m
  // from it. Right by the tower, a building four cells wide, the softening takes up to 0.15 from its foot, and the fall
  // with the square of the height, fitted to a street, up to 0.2 up its walls, which come out lighter than they should.
  for (const [i, j, most] of [[52, 64, 0.1], [50, 64, 0.11], [53, 64, 0.11], [52, 32, 0.1], [52, 20, 0.1], [20, 64, 0.1], [5, 5, 0.1], [99, 101, 0.2], [97, 101, 0.1]] as const) {
    for (const y of [0, 8, 24, 40, 56]) expect(Math.abs(measured(map, i, j, y) - castHidden(solid, n, i, j, y))).toBeLessThan(y > 24 ? most : Math.min(most, 0.15));
  }
  // Down in the street most of the sky is hidden, and none of it 8 m over the blocks' tops; far off, almost none.
  expect(measured(map, 52, 64, 0)).toBeGreaterThan(0.85);
  expect(measured(map, 52, 64, 56)).toBe(0);
  expect(measured(map, 5, 5, 0)).toBeLessThan(0.05);
  // A roof's own cell: its sky as seen from its top, all of it.
  expect(measured(map, 45, 64, 48)).toBe(0);
  // Every share is a whole number of the equal shares the sweep takes, so the ground cells hold at most so many values.
  expect(OPEN_WAYS * OPEN_HEIGHTS).toBe(64);
});

/** A frame block with the camera at the origin of a grid of TOP_CELL cells, as the far shadow writes it with no map to look up. */
function gridFrame(): Float32Array {
  const f = new FramePacket().frame;
  f[FRAME.farScale] = -1 / TOP_CELL;
  return f;
}

test("the cells a building stands in read their street's share, so the ground beside a building turned and set mid-cell shows no 4 m cells", () => {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const frame = gridFrame();
  for (const [x, z, turn] of [[256, 256, 0], [258, 262, 0], [258, 262, 30], [251, 263, 55], [250, 250, 45]] as const) {
    const city = new CityStatics(dims, asWritten(building(x, z, 0, 10, 2, (turn / 360) * YAW_UNITS)), reg);
    const ground = new Uint16Array(128 * 128);
    const solid = makeSolid(city, hf, () => null, ground);
    const map = openMeasure(solid, ground, 128, 128, 1, TOP_CELL, UNIT);
    const a = (turn * Math.PI) / 180;
    // Each face's outward way and its way along, from the building's own frame turned as its pieces are.
    for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [ox, oz] = [Math.cos(a) * u + Math.sin(a) * v, Math.cos(a) * v - Math.sin(a) * u];
      for (const out of [0.5, 2, 4]) {
        const sky: number[] = [];
        for (let t = -6; t <= 6; t += 0.25) sky.push(skyOpen(map.bytes, map.w, map.h, frame, x + ox * (8 + out) - oz * t, z + oz * (8 + out) + ox * t, 0, 1, 0, 0, 0));
        // Along a face the ground's light changes smoothly, as the building's corners near: by little from one point to the
        // next, and with no bend over a metre either way that an outline stepping across the face would make (its cells
        // unsoftened make up to 0.055 and 0.013 of these, turned 55 degrees).
        for (let k = 1; k < sky.length; k++) expect(Math.abs(sky[k]! - sky[k - 1]!)).toBeLessThan(0.006);
        for (let k = 4; k + 4 < sky.length; k++) expect(Math.abs(sky[k - 4]! - 2 * sky[k]! + sky[k + 4]!)).toBeLessThan(0.025);
        // A building 40 m tall hides a good share of the sky from its foot.
        if (out === 0.5) expect(Math.min(...sky)).toBeLessThan(1 - OPEN_STRENGTH * 0.25);
      }
    }
  }
});

test("the foot of what stands loses sky light over the last metre and a half, smoothly, but not a deck, a bridge's underside or a body, and nothing does with no measure on the card", () => {
  const frame = gridFrame();
  // A measure of open ground, which hides no sky.
  let open = Uint8Array.of(0, 1);
  const wall = (over: number, ny = 0, contact = 1): number => skyOpen(open, 1, 1, frame, 10, 10, Math.sqrt(1 - ny * ny), ny, 0, over, contact);
  expect(wall(0)).toBeCloseTo(1 - CONTACT, 9);
  expect(wall(CONTACT_BAND)).toBe(1);
  expect(wall(10)).toBe(1);
  // Under the ground, as a wall's foot may stand where the picture's ground is a little higher, it is the foot's.
  expect(wall(-0.3)).toBeCloseTo(1 - CONTACT, 9);
  // No step anywhere up the band, and none where it ends.
  for (let y = 0; y < CONTACT_BAND; y += 0.01) expect(Math.abs(wall(y + 0.01) - wall(y))).toBeLessThan(0.01);
  // A deck's top 0.3 m up faces the sky; a bridge's underside 6 m up is past the band; a body takes none.
  expect([wall(0.3, 1), wall(6, -1), wall(0.3, 0, 0)]).toEqual([1, 1, 1]);
  // A face that leans up takes less, one that leans down more.
  expect(wall(0.3, 0.5)).toBeGreaterThan(wall(0.3));
  expect(wall(0.3, -0.5)).toBe(wall(0.3));
  // With no measure on the card nothing is taken, nor with no grid, as on a map with no city.
  open = new Uint8Array(2);
  expect(wall(0)).toBe(1);
  open = Uint8Array.of(0, 1);
  frame[FRAME.farScale] = 0;
  expect(wall(0)).toBe(1);
});

test("a point's height over the ground is from the whole map's heights picture, split as the ground's tiles split it", () => {
  const dims: MapDims = { chunksX: 4, chunksZ: 4 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  // A plane, which every split of a cell holds; then bumps between the picture's samples, which it does not see.
  const plane = (x: number, z: number): number => 3 + 0.05 * x - 0.02 * z;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, plane(i * hf.cell, j * hf.cell) + ((i % COARSE) + (j % COARSE) > 0 ? 0.7 : 0));
  const frame = gridFrame();
  const [camX, camY, camZ] = [37, 20, 81];
  frame[FRAME.farAt] = camX / TOP_CELL;
  frame[FRAME.farAt + 1] = camZ / TOP_CELL;
  for (const [x, z] of [[40, 80], [41.3, 77.9], [100, 12], [7.5, 200]] as const) {
    for (const y of [plane(x, z), plane(x, z) + 1.25]) expect(Math.abs(overGround(hf, COARSE, frame, camY, x - camX, y - camY, z - camZ) - (y - plane(x, z)))).toBeLessThanOrEqual(hf.stepY / 2);
  }
  // At the picture's samples the ground is the map's own.
  expect(overGround(hf, COARSE, frame, camY, 64 - camX, 10 - camY, 128 - camZ)).toBeCloseTo(10 - hf.heightAt(64, 128), 3);
  frame[FRAME.farScale] = 0;
  expect(overGround(hf, COARSE, frame, camY, 0, 0, 0)).toBeGreaterThan(1000);
});

/** Two buildings and a field's ground, as the far shadow's tests stand them. */
function twoTowers() {
  const reg = farRegistry();
  const dims: MapDims = { chunksX: 8, chunksZ: 8 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const city = new CityStatics(dims, asWritten([...building(160, 160, 0, 12), ...building(352, 352, 0, 12)]), reg);
  return { dims, hf, city, chunkA: chunkAt(dims, 160, 160) };
}

/** A frame's allowance, counting what it spends. */
function allowance(bytes: number) {
  return {
    left: bytes,
    spent: 0,
    spend(n: number): void {
      this.spent += n;
      this.left -= n;
    },
  };
}

test("the scene's part makes the measure when the statics come, by night and with no shadows, puts it on the card within the allowance, makes it again after pieces go no more often than it should, and sends it again where the card lost it", () => {
  const { dims, hf, city, chunkA } = twoTowers();
  const version = new Uint32Array(chunkCount(dims));
  const gone = new Map<number, Uint8Array>();
  const standing = { goneOf: (c: number): Gone => gone.get(c) ?? null, goneVersion: version, topsOf: (c: number) => (city.in(c) > 0 ? cityTops(city, c, hf, gone.get(c) ?? null) : null) };
  const shadow = new FarShadow(city, hf, standing, null, () => false);
  const p = new FramePacket();
  // High with the governor's shadows taken off, and the sun down.
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, cascades: 0 } };
  p.lit = true;
  const row = 128 * 2;
  // Frames 20 ms apart, the first at 20.
  let now = 0;
  const frame = (bytes = 50 * row) => {
    p.beginFrame();
    const budget = allowance(bytes);
    shadow.update(p, budget, 300, 20, 300, null, (now += 20));
    return { width: p.openWidth, from: p.openRow, rows: p.openRows, spent: budget.spent, scale: p.frame[FRAME.farScale]!, made: shadow.open.stats.made };
  };
  // Made at once, though nothing casts, and sent 50 rows a frame, the grid said all along.
  expect([frame(), frame(), frame()]).toEqual([
    { width: 128, from: 0, rows: 50, spent: 50 * row, scale: -1 / TOP_CELL, made: 1 },
    { width: 128, from: 50, rows: 50, spent: 50 * row, scale: -1 / TOP_CELL, made: 1 },
    { width: 128, from: 100, rows: 28, spent: 28 * row, scale: -1 / TOP_CELL, made: 1 },
  ]);
  expect([p.frame[FRAME.farAt], p.frame[FRAME.farAt + 1]]).toEqual([300 / TOP_CELL, 300 / TOP_CELL]);
  const first = Uint8Array.from(p.openMap);
  expect(frame().rows).toBe(0);
  // A piece gone: made again at the first frame OPEN_EVERY after the last was asked for, not before.
  gone.set(chunkA, new Uint8Array(city.in(chunkA)).fill(1));
  version[chunkA]!++;
  while (now + 20 < 20 + OPEN_EVERY) expect(frame().made).toBe(1);
  expect(frame().made).toBe(2);
  expect(p.openRows).toBe(50);
  expect(p.openMap).not.toEqual(first.subarray(0, p.openMap.length));
  while (frame().rows > 0);
  // A lost context, and a frame of low poly, which lets the texture go: all of it is sent again.
  shadow.reset();
  expect(frame(1e9).rows).toBe(128);
  p.tier = tierOf("lowpoly");
  p.lit = false;
  expect(frame(1e9)).toEqual({ width: 0, from: 0, rows: 0, spent: 0, scale: 0, made: 2 });
  p.tier = tierOf("high");
  p.lit = true;
  expect(frame(1e9).rows).toBe(128);
  // A layer whose cells are twice as wide: made again for them, and none on the card for the new grid until it is.
  p.tier = { ...tierOf("high"), shadows: { ...tierOf("high").shadows, size: 64 } };
  const wide = frame(1e9);
  expect([wide.made, wide.width, wide.rows, wide.scale]).toEqual([3, 64, 64, -1 / (2 * TOP_CELL)]);
});

test("the rasterizer, the reference for light, takes sky light from a street between towers and leaves open ground as it was", () => {
  // Two rows of buildings 40 m tall, a street 16 m wide between them, and the camera down in it looking along it; then
  // the camera far off over open ground.
  const statics = [];
  for (let z = 296; z <= 456; z += 16) statics.push(...building(360, z, 0, 10), ...building(392, z, 0, 10));
  const w = cityWorld({ chunks: 24, statics, tier: tierOf("high"), width: 320, height: 180 });
  w.scene.plainSky = true;
  w.scene.hour = 9;
  /** The frame from where the camera is, and the same with no grid, which takes no sky light from anything. */
  const view = (x: number, z: number, yaw: number): { opened: Uint8Array; plain: Uint8Array } => {
    [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [x, 4, z, yaw, -0.25];
    for (let k = 0; k < 40; k++) w.frame(true);
    const p = w.frame(true);
    const opened = Uint8Array.from(w.raster.color);
    p.frame[FRAME.farScale] = 0;
    w.raster.render(p);
    return { opened, plain: Uint8Array.from(w.raster.color) };
  };
  const sum = (c: Uint8Array, k: number): number => c[k * 4]! + c[k * 4 + 1]! + c[k * 4 + 2]!;
  const street = view(376, 300, 0);
  expect(w.scene.farShadow!.open.stats.made).toBe(1);
  let ground = 0, darker = 0, brighter = 0;
  const dir = [0, 0, 0];
  for (let k = 0; k < w.W * w.H; k++) {
    if (sum(street.opened, k) > sum(street.plain, k)) brighter++;
    if (w.raster.pickKind[k] !== PICK_TERRAIN) continue;
    w.cam.ray(((k % w.W) + 0.5) / w.W, (Math.floor(k / w.W) + 0.5) / w.H, dir);
    const t = -w.cam.y / dir[1]!;
    const [gx, gz] = [w.cam.x + dir[0]! * t, w.cam.z + dir[2]! * t];
    if (gx < 370 || gx > 382 || gz < 320 || gz > 440) continue;
    ground++;
    if (sum(street.plain, k) - sum(street.opened, k) >= 6) darker++;
  }
  expect(ground).toBeGreaterThan(500);
  expect([darker, brighter]).toEqual([ground, 0]);
  // Over 1 km from any building, looking away from them: not a pixel changes.
  const open = view(1200, 1200, Math.PI / 4);
  expect(open.opened).toEqual(open.plain);
  expect(w.raster.pickKind.filter((k) => k === PICK_TERRAIN).length).toBeGreaterThan(20000);
});
