// The levels of a mesh that is drawn with materials: coarser ones that keep their surface, and under them flat ones in
// the colours its pictures give. On the tube, and on shapes that ask more of a simplifier.
import { expect, test } from "bun:test";
import { lodSkin, parsePack, type PackMaterial } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { surfaceError } from "../../tools/pack/error.ts";
import { unpack } from "../../tools/pack/image.ts";
import { readMasks } from "../../tools/pack/mask.ts";
import { simplifySurface, withSurfaceLevels } from "../../tools/pack/simplify.ts";
import type { MaterialMaps } from "../../tools/pack/texture.ts";
import { buildPack, type SourceLod } from "../../tools/pack/write.ts";
import { RING_ISLANDS, block, plainMaterial, plate, ring } from "../fixtures/shapes.ts";
import { TUBE_LENGTH, TUBE_REGIONS, TUBE_RIG, tubeClips, tubeMesh, tubePictures } from "../fixtures/textured.ts";

const palette = defaultPalette();
const tris = (lod: SourceLod): number => lod.indices.length / 3;
const toLinear = (s: number): number => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const toSrgb = (l: number): number => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

/** A triangle's corners: x, y, z of each, and u, v of each. */
function corners(lod: SourceLod, t: number): { p: number[]; uv: number[] } {
  const at = [lod.indices[t * 3]!, lod.indices[t * 3 + 1]!, lod.indices[t * 3 + 2]!];
  return { p: at.flatMap((v) => [...lod.positions.subarray(v * 3, v * 3 + 3)]), uv: at.flatMap((v) => [...(lod.uvs?.subarray(v * 2, v * 2 + 2) ?? [])]) };
}

/** Twice a triangle's area. */
function size(lod: SourceLod, t: number): number {
  const { p } = corners(lod, t);
  const [ux, uy, uz, vx, vy, vz] = [p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!, p[6]! - p[0]!, p[7]! - p[1]!, p[8]! - p[2]!];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Twice the area a triangle has in the picture. Its sign says which way up the picture lies on it. */
function spread(lod: SourceLod, t: number): number {
  const { uv } = corners(lod, t);
  return (uv[2]! - uv[0]!) * (uv[5]! - uv[1]!) - (uv[4]! - uv[0]!) * (uv[3]! - uv[1]!);
}

/** How many vertices of `lod` are not, in all they have, a vertex of `fine`: anything put together from two would be one. */
function strangers(fine: SourceLod, lod: SourceLod): number {
  const all = (l: SourceLod, v: number): string => [l.positions.subarray(v * 3, v * 3 + 3), l.uvs!.subarray(v * 2, v * 2 + 2), l.normals!.subarray(v * 3, v * 3 + 3), l.tangents?.subarray(v * 4, v * 4 + 4), l.bones?.[v], l.joints?.subarray(v * 4, v * 4 + 4), l.weights?.subarray(v * 4, v * 4 + 4)].join("|");
  const known = new Set(Array.from({ length: fine.positions.length / 3 }, (_, v) => all(fine, v)));
  return Array.from({ length: lod.positions.length / 3 }, (_, v) => all(lod, v)).filter((key) => !known.has(key)).length;
}

/** The edges of a level that do not have two triangles, as the two places each runs between. A crack shows here, as an open end does. */
function loose(lod: SourceLod): number[][] {
  const place = (v: number): string => [...lod.positions.subarray(v * 3, v * 3 + 3)].map((c) => c.toFixed(5)).join();
  const count = new Map<string, number>();
  for (let i = 0; i < lod.indices.length; i++) {
    const [a, b] = [place(lod.indices[i]!), place(lod.indices[i - (i % 3) + ((i + 1) % 3)]!)];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count].filter(([, n]) => n !== 2).map(([key]) => key.split(",").map(Number));
}

/**
 * How the picture lies on `coarse` against how it lies on `fine`. Each triangle of `coarse` is tried at six places
 * inside it. A place's texture coordinate is looked up in the triangles of `fine` of its material, and `slid` is how
 * far the furthest place lies from where `fine` has that bit of picture, in metres. `lost` counts the places `fine`
 * has nowhere, and `turned` the triangles that face the other way in the picture than `fine` does under their middle.
 */
function pictureOn(fine: SourceLod, coarse: SourceLod): { slid: number; lost: number; turned: number } {
  const all = Array.from({ length: tris(fine) }, (_, f) => ({ ...corners(fine, f), whole: spread(fine, f), section: fine.sections?.[f] ?? 0 }));
  const out = { slid: 0, lost: 0, turned: 0 };
  for (let t = 0; t < tris(coarse); t++) {
    const { p, uv } = corners(coarse, t);
    for (const [s, r] of [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1], [0.45, 0.45], [0.45, 0.1]] as const) {
      const [u, v] = [uv[0]! + s * (uv[2]! - uv[0]!) + r * (uv[4]! - uv[0]!), uv[1]! + s * (uv[3]! - uv[1]!) + r * (uv[5]! - uv[1]!)];
      let least = Infinity;
      let facing = 0;
      for (const g of all) {
        if (g.section !== (coarse.sections?.[t] ?? 0) || g.whole === 0) continue;
        const [x, y] = [u - g.uv[0]!, v - g.uv[1]!];
        const b = (x * (g.uv[5]! - g.uv[1]!) - (g.uv[4]! - g.uv[0]!) * y) / g.whole;
        const c = ((g.uv[2]! - g.uv[0]!) * y - x * (g.uv[3]! - g.uv[1]!)) / g.whole;
        if (b < -1e-6 || c < -1e-6 || b + c > 1 + 1e-6) continue;
        let d = 0;
        for (let k = 0; k < 3; k++) d += (p[k]! + s * (p[3 + k]! - p[k]!) + r * (p[6 + k]! - p[k]!) - (g.p[k]! + b * (g.p[3 + k]! - g.p[k]!) + c * (g.p[6 + k]! - g.p[k]!))) ** 2;
        if (d < least) [least, facing] = [d, g.whole];
      }
      if (least === Infinity) out.lost++;
      else out.slid = Math.max(out.slid, Math.sqrt(least));
      if (s === r && s < 0.4 && facing * spread(coarse, t) <= 0) out.turned++;
    }
  }
  return out;
}

/**
 * The mean colour of a level drawn with its materials, as light: base colour times tint, dyed where the masks say by
 * the palette colours `dyes`, each over the material's grey. Read at 36 places a triangle, in the pictures themselves.
 */
function texturedMean(lod: SourceLod, materials: readonly PackMaterial[], maps: readonly MaterialMaps[], dyes: readonly number[]): number[] {
  const read = maps.map((m) => ({ base: m.base && { ...m.base, data: unpack(m.base, toLinear) }, regions: m.mask && readMasks(m.mask, m.mask2) }));
  const sum = [0, 0, 0, 0];
  for (let t = 0; t < tris(lod); t++) {
    const { uv } = corners(lod, t);
    const material = materials[lod.sections?.[t] ?? 0]!;
    const { base, regions } = read[lod.sections?.[t] ?? 0]!;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; i + j < 8; j++) {
        const [s, r] = [(i + 1 / 3) / 8, (j + 1 / 3) / 8];
        const [u, v] = [uv[0]! + s * (uv[2]! - uv[0]!) + r * (uv[4]! - uv[0]!), uv[1]! + s * (uv[3]! - uv[1]!) + r * (uv[5]! - uv[1]!)];
        const at = (p: { width: number; height: number }): number => Math.min(p.height - 1, Math.floor(v * p.height)) * p.width + Math.min(p.width - 1, Math.floor(u * p.width));
        for (let k = 0; k < 3; k++) {
          let dye = 1;
          for (let region = 0; regions && region < 6; region++) dye += regions.weights[at(regions) * 6 + region]! * (toLinear(palette[dyes[region]! * 4 + k]! / 255) / material.grey - 1);
          sum[k]! += (size(lod, t) / 36) * (base ? base.data[at(base) * 4 + k]! : 1) * material.tint[k]! * dye;
        }
      }
    }
    sum[3]! += size(lod, t);
  }
  return sum.slice(0, 3).map((s) => Math.round(toSrgb(s / sum[3]!) * 255));
}

/** The mean colour of a level drawn flat, as light, on an instance dyed the same. */
function flatMean(lod: SourceLod, dyes: readonly number[]): number[] {
  const sum = [0, 0, 0, 0];
  for (let t = 0; t < tris(lod); t++) {
    const colour = lod.colors[lod.indices[t * 3 + 2]!]!;
    for (let k = 0; k < 3; k++) sum[k]! += size(lod, t) * toLinear(palette[(colour >= REGION_BASE ? dyes[colour - REGION_BASE]! : colour) * 4 + k]! / 255);
    sum[3]! += size(lod, t);
  }
  return sum.slice(0, 3).map((s) => Math.round(toSrgb(s / sum[3]!) * 255));
}

/** The tube with its upper bone turned a quarter about the joint, a metre up. */
function bent(lod: SourceLod): SourceLod {
  const positions = new Float32Array(lod.positions.length);
  for (let v = 0; v < positions.length / 3; v++) {
    const [x, y, z] = [lod.positions[v * 3]!, lod.positions[v * 3 + 1]!, lod.positions[v * 3 + 2]!];
    let upper = 0;
    for (let k = 0; k < 4; k++) if (lod.joints![v * 4 + k] === 1) upper += lod.weights![v * 4 + k]!;
    positions.set([x, y + upper * (1 - z - y), z + upper * (y - 1 - z)], v * 3);
  }
  return { ...lod, positions };
}

test("an authored far silhouette follows generated levels and retains its bone bindings", () => {
  const source = tubeMesh();
  const coarse = block(1);
  const authored: SourceLod = {
    positions: coarse.positions, indices: coarse.indices, colors: coarse.colors,
    bones: new Uint8Array(coarse.colors.length).fill(1),
  };
  const plan = { budgets: [256, 64, 12], flat: 2, maps: [], palette, distanceLods: [authored] };
  const made = withSurfaceLevels(source, plan);
  expect(made.lods).toHaveLength(4);
  expect(tris(made.lods[2]!)).toBeLessThanOrEqual(64);
  expect(tris(made.lods[3]!)).toBe(12);
  expect(made.lods[3]!.bones).toEqual(authored.bones);
  expect(made.lods[3]!.error).toBe(surfaceError(source.lods[0]!, authored));
  expect(() => withSurfaceLevels(source, { ...plan, budgets: [256, 64, 8] })).toThrow("budget");
});

test("the tube gets two more levels with its surface and two flat ones, with no seam crossed, no joint cracked and its dyes kept", () => {
  const source = tubeMesh();
  const fine = source.lods[0]!;
  const { base, mask, mask2 } = tubePictures();
  const maps: MaterialMaps[] = [{ base, mask, mask2 }, { base }];
  // What a converter calls: the finest level, a budget for each level after it, and which is the first flat one.
  const mesh = withSurfaceLevels({ ...source, lods: [fine] }, { budgets: [256, 128, 64, 32], flat: 3, maps, palette });
  expect([mesh.flat, mesh.lods.map(tris)]).toEqual([3, [512, 255, 127, 64, 32]]);
  expect(mesh.lods.map((lod) => lod.uvs !== undefined)).toEqual([true, true, true, false, false]);
  // Each level says how far it lies from the finest, as measured.
  expect(mesh.lods[4]!.error).toBe(surfaceError(fine, mesh.lods[4]!));
  for (let level = 2; level < 5; level++) expect(mesh.lods[level]!.error).toBeGreaterThanOrEqual(mesh.lods[level - 1]!.error!);

  const rings = (lod: SourceLod): number[] => [...new Set(Array.from({ length: lod.positions.length / 3 }, (_, v) => lod.positions[v * 3 + 1]!))].sort((a, b) => a - b);
  for (const lod of mesh.lods.slice(1, 3)) {
    // Every vertex is a vertex of the finest level with all it has there, the tangent it was given too: nothing is
    // put together from two.
    expect([lod.tangents!.length, strangers(mesh.lods[0]!, lod)]).toEqual([(lod.positions.length / 3) * 4, 0]);
    for (let t = 0; t < tris(lod); t++) {
      // A triangle that had crossed the seam would reach the long way round the picture, and lie in it turned over.
      const { uv } = corners(lod, t);
      expect(Math.max(uv[0]!, uv[2]!, uv[4]!) - Math.min(uv[0]!, uv[2]!, uv[4]!)).toBeLessThan(0.5);
      expect(spread(lod, t)).toBeLessThan(0);
      // And one that had crossed the border between the materials would reach into the other's part of the picture.
      for (const v of [uv[1]!, uv[3]!, uv[5]!]) expect(lod.sections![t] === 1 ? v <= 0.25 : v >= 0.25).toBe(true);
    }
    // The picture lies where it did, to within about what the surface itself has moved: nothing swims.
    const lies = pictureOn(fine, lod);
    expect([lies.lost, lies.turned]).toEqual([0, 0]);
    expect(lies.slid).toBeLessThan(2.5 * lod.error!);
    // The only edges without two triangles are around the tube's two open ends: the seam has not come apart.
    for (const [, y0, , , y1] of loose(lod)) expect([y0 === 0 || y0 === TUBE_LENGTH, y0 === y1]).toEqual([true, true]);
    // The loops across which the upper bone takes over are all still there. The six that went lay between them and the ends.
    expect(rings(lod)).toEqual([0, 0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.375, 1.5, 2]);
    // So bent a quarter turn, the level lies about as near the finest, bent, as it does straight.
    expect(surfaceError(bent(fine), bent(lod))).toBeLessThan(1.5 * lod.error!);
  }
  // In a pack, every vertex of a level with a surface still gives out exactly 255 among its bones.
  const pack = parsePack(buildPack([mesh], palette, tubeClips(), [TUBE_RIG]));
  const packed = pack.header.meshes[0]!;
  expect([packed.flat, packed.lods.map((lod) => lod.sections?.length)]).toEqual([3, [6, 6, 6, undefined, undefined]]);
  for (const lod of packed.lods.slice(0, 3)) {
    const skin = lodSkin(pack, lod)!;
    for (let v = 0; v < lod.vertexCount; v++) expect(skin[v * 8 + 4]! + skin[v * 8 + 5]! + skin[v * 8 + 6]! + skin[v * 8 + 7]!).toBe(255);
  }

  // Drawn flat, every level is the same creature: its four regions where the masks have them, and one palette colour
  // for the horn, which no region dyes.
  const horn = 177;
  expect([...palette.subarray(horn * 4, horn * 4 + 3)]).toEqual([226, 184, 129]);
  const right = mesh.lods.map((lod) => {
    let [good, all] = [0, 0];
    for (let t = 0; t < tris(lod); t++) {
      const { p } = corners(lod, t);
      const turn = Math.atan2(-(p[0]! + p[3]! + p[6]!), -(p[2]! + p[5]! + p[8]!)) / (Math.PI * 2);
      const want = p[1]! + p[4]! + p[7]! > TUBE_LENGTH * 0.75 * 3 ? horn : REGION_BASE + Math.floor((turn < 0 ? turn + 1 : turn) * TUBE_REGIONS);
      all += size(lod, t);
      if (lod.colors[lod.indices[t * 3 + 2]!] === want) good += size(lod, t);
    }
    return good / all;
  });
  // With its surface every triangle shows the right colour. Flat, the outline of a region is off by a triangle here and there.
  expect(right.slice(0, 3)).toEqual([1, 1, 1]);
  for (const share of right) expect(share).toBeGreaterThan(0.99);
  for (const lod of mesh.lods) expect([...new Set(lod.colors)].sort((a, b) => a - b)).toEqual([horn, 240, 241, 242, 243]);

  // Where the last level with a surface hands over to the first flat one, the mean colour holds to within 10 of 255
  // a channel for four dyes, and 18 for one dye all over. The horn is 12 off in red, there being no nearer palette
  // colour, and the lowest eighth is dyed at half strength in the pictures and wholly when flat.
  for (const [dyes, within] of [[[8, 7, 14, 6, 0, 0], 10], [[9, 9, 9, 9, 0, 0], 18]] as const) {
    const [textured, flat] = [texturedMean(mesh.lods[2]!, source.materials!, maps, dyes), flatMean(mesh.lods[3]!, dyes)];
    for (let k = 0; k < 3; k++) expect(Math.abs(textured[k]! - flat[k]!)).toBeLessThanOrEqual(within);
  }
});

test("a ring of six charts, one mirrored and one turned, halves and halves again inside its charts and its materials", () => {
  const fine = ring(24, 12);
  const made = simplifySurface(fine, [288, 144]);
  expect([tris(fine), ...made.map((m) => tris(m.lod))]).toEqual([576, 288, 144]);
  for (const { lod } of made) {
    // No vertex is new, and the ring is still closed: no seam and no joint has come apart.
    expect([strangers(fine, lod), loose(lod).length]).toEqual([0, 0]);
    for (let t = 0; t < tris(lod); t++) {
      const { p, uv } = corners(lod, t);
      const island = [0, 1, 2].map((k) => Math.floor(uv[k * 2]! * RING_ISLANDS[0]) + RING_ISLANDS[0] * Math.floor(uv[k * 2 + 1]! * RING_ISLANDS[1]));
      // All of a triangle is in one island, facing the way the island does.
      expect([island[1], island[2], spread(lod, t) > 0]).toEqual([island[0], island[0], island[0] === 1]);
      // And on one side of the border between the materials, which is where x is 0.
      for (const x of [p[0]!, p[3]!, p[6]!]) expect(lod.sections![t] === 1 ? x < 1e-9 : x > -1e-9).toBe(true);
    }
    const lies = pictureOn(fine, lod);
    expect([lies.lost, lies.turned]).toEqual([0, 0]);
    expect(lies.slid).toBeLessThan(2.5 * surfaceError(fine, lod));
  }
});

test("a box with a grid on every side comes down to its twelve triangles, every crease and island where it was", () => {
  const fine = block(6);
  const [half, least, less] = simplifySurface(fine, [216, 12, 4]);
  expect([tris(fine), tris(half!.lod), tris(least!.lod), least!.lod.positions.length / 3]).toEqual([432, 216, 12, 24]);
  // Nothing more can go: every point left is a corner, where three creases meet.
  expect(tris(less!.lod)).toBe(12);
  expect([strangers(fine, half!.lod), loose(half!.lod).length, strangers(fine, least!.lod), loose(least!.lod).length]).toEqual([0, 0, 0, 0]);
  // The box is the box it was, to a hair, with the picture where it was and its top still the second material.
  expect(Math.max(least!.moved, surfaceError(fine, least!.lod))).toBeLessThan(1e-4);
  const lies = pictureOn(fine, least!.lod);
  expect([lies.lost, lies.turned, lies.slid < 1e-4]).toEqual([0, 0, true]);
  for (const { lod } of [half!, least!]) {
    for (let t = 0; t < tris(lod); t++) {
      const { p } = corners(lod, t);
      expect(lod.sections![t] === 1).toBe(p[1]! + p[4]! + p[7]! === 3);
    }
  }

  // Asked for a level that cannot be made, a mesh comes back without it: the box with its surface stops at twelve
  // triangles, so the first flat level is the one after that. With no pictures its flat colour is its tint, white.
  const asked = withSurfaceLevels({ id: "t:box", lods: [fine], materials: [plainMaterial("sides"), plainMaterial("top")] }, { budgets: [12, 11, 6], flat: 3, maps: [], palette });
  expect([asked.flat, asked.lods.map(tris), [...new Set(asked.lods.flatMap((lod) => [...lod.colors]))]]).toEqual([2, [432, 12, 6], [10]]);
  expect(() => withSurfaceLevels({ id: "t:box", lods: [fine] }, { budgets: [12], flat: 0, maps: [], palette })).toThrow("the first flat level is 1 or later");

  // One side's picture is laid eight times as dense on its first third as on the rest. Nothing in the box's shape
  // stops that side going down to two triangles, but they would hold the picture at neither density, so the line
  // between the two stays: two triangles more on that side, and one on each side that shares an end of the line.
  const uneven = block(6, (s) => (s < 1 / 3 ? s * 2.4 : 0.8 + (s - 1 / 3) * 0.3));
  const [kept] = simplifySurface(uneven, [12]);
  expect(tris(kept!.lod)).toBe(16);
  expect(surfaceError(uneven, kept!.lod)).toBeLessThan(1e-4);
  const held = (lod: SourceLod, t: number): number => spread(lod, t) / size(lod, t);
  const began = [...new Set(Array.from({ length: tris(uneven) }, (_, t) => held(uneven, t).toFixed(4)))].map(Number);
  // Every triangle holds the picture as densely as some triangle did to begin with, to within twice, and the same way up.
  for (let t = 0; t < 16; t++) expect(began.some((density) => held(kept!.lod, t) / density > 0.5 && held(kept!.lod, t) / density < 2)).toBe(true);
});

test("a flat plate keeps a swirled picture where it was, though its shape asks for no vertex at all", () => {
  // The picture is turned about the middle of the plate, most at the middle and not at the edge. As far as the shape
  // goes every collapse is free, so it is how far each would slide the picture that puts them in order.
  const fine = plate(12, undefined, (x, z) => {
    const [dx, dz] = [x - 0.5, z - 0.5];
    const turn = 1.5 * Math.max(0, 0.25 - dx * dx - dz * dz);
    return [0.5 + dx * Math.cos(turn) - dz * Math.sin(turn), 0.5 + dx * Math.sin(turn) + dz * Math.cos(turn)];
  });
  const [quarter] = simplifySurface(fine, [72]);
  const lies = pictureOn(fine, quarter!.lod);
  expect([tris(fine), tris(quarter!.lod), lies.lost, lies.turned]).toEqual([288, 72, 0, 0]);
  // With a quarter of the triangles no bit of the picture is two centimetres from where it was. Taken in any order, some are five.
  expect(lies.slid).toBeLessThan(0.02);
});
