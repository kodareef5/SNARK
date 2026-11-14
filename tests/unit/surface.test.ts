// A mesh drawn with materials, from its source through the pack writer.
import { expect, test } from "bun:test";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, parsePack, type Pack, type PackLod, type PackMaterial } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { stressMeshes } from "../../tools/pack/stress.ts";
import { decodeSkin, decodeSurface, encodeSkin, encodeSurface, fourHeaviest, spanOf, tangentsOf } from "../../tools/pack/surface.ts";
import { boxMesh, buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { TUBE, TUBE_PIXELS, TUBE_REGIONS, TUBE_RIG, tubeClips, tubeMesh, tubePack, tubePictures } from "../fixtures/textured.ts";

/** The largest difference between two lists of numbers. */
function apart(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let most = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!));
  return most;
}

/** A square facing +z, a metre across, with the picture upright on it, or mirrored left to right. */
function square(mirrored = false): SourceLod & { uvs: Float32Array; normals: Float32Array } {
  const u = mirrored ? [1, 0, 0, 1] : [0, 1, 1, 0];
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), colors: new Uint8Array(4), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    uvs: Float32Array.from([u[0]!, 1, u[1]!, 1, u[2]!, 0, u[3]!, 0]), normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  };
}

test("a surface entry holds a texture coordinate, a normal and a tangent with the side its bitangent is on", () => {
  const bytes = encodeSurface(Float32Array.from([0, 1, 0.25, 0.5, -3, 7]), Float32Array.from([1, 0, 0, 0, 0, -1, 0, 2, 0]), Float32Array.from([0, 1, 0, 1, -1, 0, 0, -1, 3, 0, 4, 1]));
  const view = new DataView(bytes.buffer);
  expect(bytes.length).toBe(3 * SURFACE_BYTES);
  // x in the low ten bits, then y, then z, each from -511 to 511, and the sign in the top two: 01 for 1, 11 for -1.
  expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint32(4, true), view.getUint32(8, true)]).toEqual([0, 65535, 511, (511 << 10) | (1 << 30)]);
  expect([view.getUint32(16, true), view.getUint32(20, true)]).toEqual([513 << 20, (513 | (3 << 30)) >>> 0]);
  const back = decodeSurface(bytes);
  // A coordinate outside the picture is held at its edge, and a direction of any length is stored as one of length 1.
  expect(apart(back.uvs, [0, 1, 0.25, 0.5, 0, 1])).toBeLessThan(1 / 65535);
  expect([...back.normals]).toEqual([1, 0, 0, 0, 0, -1, 0, 1, 0]);
  expect(apart(back.tangents, [0, 1, 0, 1, -1, 0, 0, -1, 0.6, 0, 0.8, 1])).toBeLessThan(1 / 511);

  // Any direction comes back within a fifth of a degree.
  const rng = new Rng(4);
  const dirs = Float32Array.from({ length: 300 }, () => rng.range(-1, 1));
  const got = decodeSurface(encodeSurface(new Float32Array(200), dirs, new Float32Array(400))).normals;
  for (let v = 0; v < 100; v++) {
    const [a, b] = [dirs.subarray(v * 3, v * 3 + 3), got.subarray(v * 3, v * 3 + 3)];
    const cos = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(...a) * Math.hypot(...b));
    expect(cos).toBeGreaterThan(Math.cos((0.2 * Math.PI) / 180));
  }
});

test("a skin entry names the vertex's own bone first and gives out exactly 255", () => {
  const one = (joints: number[], weights: number[], own: number): number[] => [...encodeSkin(Uint8Array.from(joints), Float32Array.from(weights), Uint8Array.of(own), "t")];
  // The heavier bone is not the vertex's own, and the odd share goes to the place that lost most to rounding.
  expect(one([3, 7, 0, 0], [0.7, 0.3, 0, 0], 7)).toEqual([7, 3, 0, 0, 77, 178, 0, 0]);
  // A bone named twice counts once, weights need not sum to 1, and a place with no share names bone 0.
  expect(one([2, 2, 5, 9], [1, 1, 2, 0], 2)).toEqual([2, 5, 0, 0, 128, 127, 0, 0]);
  expect(one([4, 5, 6, 7], [0, 0, 0, 0], 9)).toEqual([9, 0, 0, 0, 255, 0, 0, 0]);
  expect(one([1, 2, 3, 4], [0.4, 0.3, 0.2, 0.1], 3)).toEqual([3, 1, 2, 4, 51, 102, 77, 25]);
  expect(() => one([1, 2, 0, 0], [0.5, 0.5, 0, 0], 3)).toThrow("not one of the bones");

  const rng = new Rng(9);
  const n = 400;
  const joints = Uint8Array.from({ length: n * 4 }, (_, i) => (i % 4) * 8 + rng.int(8));
  const weights = Float32Array.from({ length: n * 4 }, (_, i) => (rng.int(4) > i % 4 ? rng.float() : 0));
  const own = Uint8Array.from({ length: n }, (_, v) => fourHeaviest(joints.subarray(v * 4, v * 4 + 4), weights.subarray(v * 4, v * 4 + 4)).bones[0] ?? 0);
  const bytes = encodeSkin(joints, weights, own, "t");
  expect(bytes.length).toBe(n * SKIN_BYTES);
  const back = decodeSkin(bytes);
  for (let v = 0; v < n; v++) {
    const total = weights.subarray(v * 4, v * 4 + 4).reduce((t, w) => t + w, 0);
    expect(bytes[v * 8 + 4]! + bytes[v * 8 + 5]! + bytes[v * 8 + 6]! + bytes[v * 8 + 7]!).toBe(255);
    expect(back.joints[v * 4]).toBe(own[v]!);
    for (let k = 0; k < 4 && total > 0; k++) {
      const at = [0, 1, 2, 3].find((p) => back.weights[v * 4 + p]! > 0 && back.joints[v * 4 + p] === joints[v * 4 + k]);
      expect(Math.abs((at === undefined ? 0 : back.weights[v * 4 + at]!) - weights[v * 4 + k]! / total)).toBeLessThan(1 / 255);
    }
  }
  // Of five bones the lightest goes, and the four left share what it had.
  const five = fourHeaviest([0, 1, 2, 3, 4], [0.1, 0.3, 0.25, 0.2, 0.15]);
  expect([five.bones, five.dropped, +five.weights[0]!.toFixed(4)]).toEqual([[1, 2, 3, 4], true, 0.3333]);
});

test("a tangent runs the way u grows, and a mirrored picture puts the bitangent on the other side", () => {
  expect([...tangentsOf(square())]).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  expect([...tangentsOf(square(true))]).toEqual([-1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0, -1, -1, 0, 0, -1]);
  // With no picture to go by, a tangent is still square to the normal.
  expect([...tangentsOf({ ...square(), uvs: new Float32Array(8) }).subarray(0, 4)]).toEqual([0, 1, 0, 1]);
  // The picture covers a square metre here, and a quarter of one when the square shows only a quarter of it.
  expect([spanOf(square(), 0), spanOf({ ...square(), uvs: square().uvs.map((c) => c / 2) }, 0), spanOf(square(), 1)]).toEqual([1, 2, 1]);

  // Around the tube the tangent is the direction of travel, also at the seam and where the two materials meet.
  const fine = tubeMesh().lods[0]!;
  const tangents = tangentsOf({ positions: fine.positions, indices: fine.indices, uvs: fine.uvs!, normals: fine.normals! });
  for (let v = 0; v < fine.colors.length; v++) {
    const want = [fine.normals![v * 3 + 2]!, 0, -fine.normals![v * 3]!, 1];
    expect(apart(tangents.subarray(v * 4, v * 4 + 4), want)).toBeLessThan(1e-5);
  }
});

/** A level as version 3 wrote it: its indices, padded to four bytes, and then its vertices. */
function version3(lod: SourceLod, center: readonly number[], half: readonly number[]): Uint8Array {
  const n = lod.positions.length / 3;
  const wide = n > 65535;
  const out = new Uint8Array(((lod.indices.length * (wide ? 4 : 2) + 3) & ~3) + n * VERTEX_BYTES);
  const view = new DataView(out.buffer);
  lod.indices.forEach((i, k) => (wide ? view.setUint32(k * 4, i, true) : view.setUint16(k * 2, i, true)));
  for (let v = 0, at = out.length - n * VERTEX_BYTES; v < n; v++, at += VERTEX_BYTES) {
    for (let a = 0; a < 3; a++) view.setInt16(at + a * 2, Math.round(((lod.positions[v * 3 + a]! - center[a]!) / half[a]!) * 32767), true);
    out[at + 6] = lod.colors[v]!;
    out[at + 7] = lod.bones?.[v] ?? 0;
  }
  return out;
}

const firstPart = (pack: Pack, lod: PackLod): Uint8Array => pack.blob.subarray(lod.indexOffset, lod.vertexOffset + lod.vertexCount * VERTEX_BYTES);

test("the tube comes out of a pack as it went in, and what a flat client reads of it is what version 3 wrote", () => {
  const mesh = tubeMesh();
  const pack = parsePack(tubePack());
  const packed = pack.header.meshes[0]!;
  const [back] = unpackMeshes(pack);
  expect([back!.id, back!.skeleton, back!.rig, back!.flat, back!.materials, back!.textures]).toEqual([TUBE, TUBE, TUBE, 2, mesh.materials, mesh.textures]);
  expect([pack.header.materials!.length, pack.header.textures!.length, pack.header.rigs, pack.clips.clips[0]!.id]).toEqual([2, 5, [TUBE_RIG], tubeClips()[0]!.id]);
  mesh.lods.forEach((lod, level) => {
    const [got, at] = [back!.lods[level]!, packed.lods[level]!];
    const n = lod.colors.length;
    expect([got.indices, got.colors, got.bones]).toEqual([lod.indices, lod.colors, lod.bones!]);
    expect(apart(got.positions, lod.positions)).toBeLessThan(1 / 32767);
    expect(firstPart(pack, at)).toEqual(version3(lod, packed.center, packed.half));
    if (level >= 2) {
      // The flat level's source has a surface too. None of it is written.
      expect([got.uvs, got.normals, got.tangents, got.joints, got.sections, at.surfaceOffset, at.sections]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
      return;
    }
    // One run of bytes: indices, vertices, surface, skin.
    expect([at.surfaceOffset, at.skinOffset]).toEqual([at.vertexOffset + n * VERTEX_BYTES, at.vertexOffset + n * (VERTEX_BYTES + SURFACE_BYTES)]);
    expect(at.sections).toEqual([0, 0, lod.indices.length * 0.75, 1, lod.indices.length * 0.75, lod.indices.length * 0.25]);
    expect([got.sections, got.joints]).toEqual([lod.sections!, lod.joints!]);
    expect(apart(got.uvs!, lod.uvs!)).toBeLessThan(1 / 65535);
    expect(apart(got.normals!, lod.normals!)).toBeLessThan(1 / 511);
    expect(apart(got.weights!, lod.weights!)).toBeLessThan(1 / 255);
    // The source left its tangents to be worked out.
    expect(apart(got.tangents!, Array.from({ length: n * 4 }, (_, i) => [lod.normals![(i >> 2) * 3 + 2]!, 0, -lod.normals![(i >> 2) * 3]!, 1][i & 3]!))).toBeLessThan(1 / 511);
  });
  expect(apart(back!.lods.map((l) => l.error ?? 0), [0, mesh.lods[1]!.error!, mesh.lods[2]!.error!])).toBeLessThan(1e-5);
  // What came out goes in again to the same bytes.
  expect(buildPack(unpackMeshes(pack), defaultPalette(), pack.clips.clips, pack.header.rigs)).toEqual(tubePack());

  // Triangles given in any order are sorted into one run a material, so the flat part is version 3's of the sorted level.
  const turned = tubeMesh();
  const fine = turned.lods[0]!;
  const tris = fine.sections!.length;
  fine.indices = Uint32Array.from({ length: tris * 3 }, (_, i) => mesh.lods[0]!.indices[(tris - 1 - Math.floor(i / 3)) * 3 + (i % 3)]!);
  fine.sections!.reverse();
  const again = parsePack(buildPack([turned], defaultPalette(), [], [TUBE_RIG]));
  const sorted = unpackMeshes(again)[0]!.lods[0]!;
  expect([again.header.meshes[0]!.lods[0]!.sections, sorted.sections]).toEqual([packed.lods[0]!.sections, mesh.lods[0]!.sections!]);
  expect(firstPart(again, again.header.meshes[0]!.lods[0]!)).toEqual(version3({ ...fine, indices: sorted.indices }, packed.center, packed.half));
  const key = (indices: Uint32Array): string[] => Array.from({ length: tris }, (_, t) => indices.subarray(t * 3, t * 3 + 3).join()).sort();
  expect(key(sorted.indices)).toEqual(key(mesh.lods[0]!.indices));

  // There is a picture for each texture, of the size it says. The two masks give a pixel to one region at most, wholly
  // or by half. Each of the four regions has three sixteenths of the pixels, since the top quarter is never dyed.
  const pictures = tubePictures();
  expect(mesh.textures!.map((t) => [t.id, pictures[t.role].width, pictures[t.role].data.length])).toEqual(mesh.textures!.map((t) => [`${TUBE}/${t.role}`, t.top, t.top * t.top * 4]));
  const weights = Array.from({ length: TUBE_PIXELS * TUBE_PIXELS }, (_, p) => [...pictures.mask.data.subarray(p * 4, p * 4 + 3), ...pictures.mask2.data.subarray(p * 4, p * 4 + 3)]);
  expect([...new Set(weights.map((w) => w.filter((c) => c > 0).join()))].sort()).toEqual(["", "128", "255"]);
  expect([0, 1, 2, 3, 4, 5].map((k) => weights.filter((w) => w[k]! > 0).length)).toEqual([...new Array<number>(TUBE_REGIONS).fill((TUBE_PIXELS * TUBE_PIXELS * 3) / 16), 0, 0]);
});

test("flat meshes are written byte for byte as version 3 wrote them, with nothing new in the header", () => {
  const rocks = stressMeshes({ rocks: 1, detail: 2, plate: 0 });
  const sources: SourceMesh[] = [{ id: "t:box", lods: [boxMesh([1, 2, 3], 5)] }, rocks[0]!, { ...tubeMesh(), id: "t:flat", flat: 0 }];
  const file = buildPack(sources, defaultPalette(), [], [TUBE_RIG]);
  const pack = parsePack(file);
  sources.forEach((source) => {
    const packed = pack.header.meshes[pack.meshIndex.get(source.id)!]!;
    source.lods.forEach((lod, level) => {
      expect(firstPart(pack, packed.lods[level]!)).toEqual(version3(lod, packed.center, packed.half));
      expect(Object.keys(packed.lods[level]!)).toEqual(["vertexOffset", "vertexCount", "indexOffset", "indexCount", "indexBytes", "error"]);
    });
    expect("flat" in packed).toBe(false);
  });
  expect(Object.keys(pack.header)).toEqual(["paletteOffset", "meshes", "rigs", "clips"]);
  // A split of flat meshes says nothing of surfaces either.
  expect(JSON.stringify(splitPack(file, "t").manifest)).not.toMatch(/surface|sections|materials|textures|"flat"/);
});

test("a pack keeps one material and one texture of each id, and refuses a source it cannot write", () => {
  const horn = tubeMesh().materials![1]!;
  const skin: PackMaterial = { ...horn, id: "t:patch/skin", base: 1, normal: -1, mro: -1 };
  const [base, , , mro, normal] = tubeMesh().textures!;
  const patch = (over: Partial<SourceMesh> = {}, lod: Partial<SourceLod> = {}): SourceMesh => ({
    id: "t:patch", flat: 1, lods: [{ ...square(), sections: Uint8Array.of(1, 0), ...lod }],
    materials: [{ ...horn, base: 0, normal: 3, mro: 2 }, skin],
    textures: [base!, { id: "t:patch/base", role: "base", top: 256 }, mro!, normal!],
    ...over,
  });
  const pack = parsePack(buildPack([tubeMesh(), patch()], defaultPalette(), [], [TUBE_RIG]));
  expect(pack.header.materials!.map((m) => [m.id, m.base, m.normal, m.mro, m.mask, m.mask2])).toEqual([["t:patch/skin", 0, -1, -1, -1, -1], ["test:tube/hide", 1, 5, 4, 2, 3], ["test:tube/horn", 1, 5, 4, -1, -1]]);
  expect(pack.header.textures!.map((t) => [t.id, t.top])).toEqual([["t:patch/base", 256], ["test:tube/base", 64], ["test:tube/mask", 64], ["test:tube/mask2", 64], ["test:tube/mro", 64], ["test:tube/normal", 64]]);
  // The patch's triangles were given horn first. The pack's order of materials puts its own skin first.
  const packed = pack.header.meshes[0]!;
  expect([packed.id, packed.lods[0]!.sections, packed.lods[0]!.skinOffset]).toEqual(["t:patch", [0, 0, 3, 2, 3, 3], undefined]);
  // A mesh comes out with the materials and textures it uses, numbered for itself.
  const [back, tube] = unpackMeshes(pack);
  expect([back!.materials!.map((m) => [m.id, m.base, m.mro]), back!.textures!.map((t) => t.id), [...back!.lods[0]!.sections!]]).toEqual([[["t:patch/skin", 0, -1], ["test:tube/horn", 1, 2]], ["t:patch/base", "test:tube/base", "test:tube/mro", "test:tube/normal"], [0, 1]]);
  expect([tube!.materials, tube!.textures]).toEqual([tubeMesh().materials, tubeMesh().textures]);

  const refused: [string, SourceMesh][] = [
    ["described twice", patch({ materials: [{ ...horn, base: 0, normal: 3, mro: 2, grey: 0.5 }, skin] })],
    ["described twice", patch({ textures: [{ ...base!, top: 128 }, ...patch().textures!.slice(1)] })],
    ["which the mesh does not have", patch({}, { sections: Uint8Array.of(0, 2) })],
    ["no usable base texture", patch({ materials: [horn, { ...skin, base: 2 }] })],
    ["no usable base texture", patch({ textures: [base!, { id: "t:patch/base", role: "base", top: 100 }] })],
    ["no usable mask2 texture", patch({ materials: [horn, { ...skin, mask2: 0 }] })],
    ["a texture coordinate and a normal for every vertex", patch({}, { normals: new Float32Array(9) })],
    ["may be with 1 to 3", { ...patch({}, { indices: Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 1, 3, 1, 2, 3]), sections: Uint8Array.of(0, 1, 2, 3) }), materials: [0, 1, 2, 3].map((k) => ({ ...skin, base: -1, id: `t:m${k}` })) }],
  ];
  for (const [reason, mesh] of refused) expect(() => buildPack([tubeMesh(), mesh], defaultPalette(), [], [TUBE_RIG])).toThrow(reason);
});
