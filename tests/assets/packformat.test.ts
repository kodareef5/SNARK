import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FramePacket } from "../../client/core/render/packet.ts";
import { PIECE_FIT_GLSL, PIECE_FIT_PLACE, PIECE_FIT_SHADE } from "../../client/core/render/piece-fit.ts";
import { PIECE_END, PIECE_GLSL, PIECE_PLACE, PIECE_SHADE } from "../../client/core/render/pieces.ts";
import { hashString } from "../../shared/hash.ts";
import { BEND_GLSL, BEND_PLACE } from "../../client/core/render/bend.ts";
import { describePack, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, lodSkin, lodSurface, parsePack, type PackHeader, type PackMaterial } from "../../shared/pack/pack.ts";
import { TEXTURE_HEADER_BYTES, blockOf, pictureBytes, stepBytes, stepOf, stepOffset, stepSize, textureBytes, topIn } from "../../shared/pack/texture.ts";
import { PackBlob } from "../../tools/pack/write.ts";

const material = (id: string, over: Partial<PackMaterial> = {}): PackMaterial => ({ id, base: 0, normal: 1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 0.5, emissive: 0, flags: 0, cutoff: 0, span: 1, ...over });

/** A quad with a textured level in two sections and a flat level under it. `change` may spoil the header before it is written. */
function quadPack(change: (h: PackHeader) => void = () => {}): Uint8Array {
  const blob = new PackBlob();
  const header: PackHeader = { paletteOffset: blob.append(new Uint8Array(1024)), meshes: [], rigs: [], clips: [] };
  const indexOffset = blob.append(new Uint8Array(new Uint16Array([0, 1, 2, 0, 2, 3]).buffer));
  const vertexOffset = blob.append(new Uint8Array(4 * VERTEX_BYTES));
  const surfaceOffset = blob.append(new Uint8Array(4 * SURFACE_BYTES).fill(7));
  const skinOffset = blob.append(new Uint8Array(4 * SKIN_BYTES).fill(9));
  const flatIndex = blob.append(new Uint8Array(new Uint16Array([0, 1, 2]).buffer));
  const flatVertex = blob.append(new Uint8Array(3 * VERTEX_BYTES));
  header.textures = [{ id: "t:base", role: "base", top: 2048 }, { id: "t:normal", role: "normal", top: 2048 }];
  header.materials = [material("t:skin"), material("t:beak")];
  header.meshes.push({
    id: "t:quad", center: [0, 0, 0], half: [1, 1, 1], skeleton: "t", flat: 1,
    lods: [
      { vertexOffset, vertexCount: 4, indexOffset, indexCount: 6, indexBytes: 2, error: 0, surfaceOffset, skinOffset, sections: [0, 0, 3, 1, 3, 3] },
      { vertexOffset: flatVertex, vertexCount: 3, indexOffset: flatIndex, indexCount: 3, indexBytes: 2, error: 0.1 },
    ],
  });
  change(header);
  return blob.file(header);
}

test("a texture's steps are a prefix of its bytes, and the sizes are the ones the budgets were worked out from", () => {
  expect([0, 2, 4, 6].map(stepSize)).toEqual([64, 256, 1024, 4096]);
  expect([64, 100, 4096, 8192].map(stepOf)).toEqual([0, -1, 6, -1]);
  // Step 0 is the pictures from 1 to 64 across. A picture smaller than a block still takes one.
  expect(stepBytes("bc", "base", 0, 4)).toBe(16 * 3 + 64 + 256 + 1024 + 4096);
  expect([64, 256, 1024, 2048, 4096].map((top) => textureBytes("bc", "base", top, 4))).toEqual([5488, 87408, 1398128, 5592432, 22369648]);
  expect(textureBytes("astc", "mask", 1024, 4)).toBe(textureBytes("bc", "normal", 1024, 4));
  expect(stepOffset("bc", "base", 3, 4) + stepBytes("bc", "base", 3, 4)).toBe(textureBytes("bc", "base", 512, 4));
  // A larger ASTC block holds more pixels in its 16 bytes; a picture's last row and column of blocks hang over its edge.
  expect([5, 6, 8].map((block) => pictureBytes("astc", "base", 1024, block))).toEqual([205 * 205 * 16, 171 * 171 * 16, 128 * 128 * 16]);
  expect([4, 5, 6, 8].map((block) => stepBytes("astc", "base", 0, block))).toEqual([16 * 3 + 64 + 256 + 1024 + 4096, 16 * 3 + 16 * 4 + 16 * 16 + 16 * 49 + 16 * 169, 16 * 3 + 16 * 4 + 16 * 9 + 16 * 36 + 16 * 121, 16 * 4 + 16 * 4 + 16 * 16 + 16 * 64]);
  expect([blockOf("astc", { block: 6 }), blockOf("astc", {}), blockOf("bc", {}), blockOf("rgba", { block: 6 })]).toEqual([6, 4, 4, 1]);
  // Uncompressed costs four times as much, half that for a normal's two channels, and stops at 1024.
  expect(textureBytes("rgba", "base", 1024, 1)).toBe(4 * (1024 * 1024 * 4 - 1) / 3);
  expect(textureBytes("rgba", "normal", 1024, 1) * 2).toBe(textureBytes("rgba", "base", 1024, 1));
  expect([topIn("rgba", 4096), topIn("bc", 4096), topIn("rgba", 512)]).toEqual([1024, 4096, 512]);
});

test("a pack carries a surface, a skin, sections and materials, and says where a mesh turns flat", () => {
  const pack = parsePack(quadPack());
  const [fine, coarse] = pack.header.meshes[0]!.lods;
  expect(lodSurface(pack, fine!)!.length).toBe(4 * SURFACE_BYTES);
  expect(lodSkin(pack, fine!)![0]).toBe(9);
  expect(lodSurface(pack, coarse!)).toBeNull();
  expect(pack.header.materials!.map((m) => m.id)).toEqual(["t:skin", "t:beak"]);

  const spoiled: [string, (h: PackHeader) => void][] = [
    ["do not cover it", (h) => (h.meshes[0]!.lods[0]!.sections = [0, 0, 3])],
    ["does not fit", (h) => (h.meshes[0]!.lods[0]!.sections = [0, 0, 3, 2, 3, 3])],
    ["does not fit", (h) => (h.meshes[0]!.lods[0]!.sections = [0, 0, 3, 1, 4, 2])],
    ["turn flat where it says", (h) => (h.meshes[0]!.flat = 2)],
    ["turn flat where it says", (h) => delete h.meshes[0]!.flat],
    ["a texture that is not there", (h) => (h.materials![1]!.mask2 = 2)],
    ["pixels across", (h) => (h.textures![0]!.top = 1000)],
    ["outside the file", (h) => (h.meshes[0]!.lods[0]!.skinOffset = 1 << 20)],
  ];
  for (const [reason, change] of spoiled) expect(() => parsePack(quadPack(change))).toThrow(reason);
});

test("the manifest lists a level's surface and skin as parts of their own, and where each texture's steps are", () => {
  const bytes = quadPack();
  const manifest = describePack(parsePack(bytes), { name: "t.snpk", bytes: bytes.length }, (part) => String(part.length));
  const [fine, coarse] = manifest.meshes[0]!.levels;
  expect(fine!.parts.map((p) => p.bytes)).toEqual([12 + 4 * VERTEX_BYTES, 4 * SURFACE_BYTES, 4 * SKIN_BYTES]);
  expect(coarse!.parts.length).toBe(1);
  expect([manifest.meshes[0]!.flat, fine!.sections]).toEqual([1, [0, 0, 3, 1, 3, 3]]);

  // The build adds a file for each variant and says where in it each texture is.
  const at = TEXTURE_HEADER_BYTES;
  const size = textureBytes("bc", "base", 2048, 4);
  manifest.files.push({ name: "t.tex.bc.sntx", bytes: at + 2 * size, role: "tex", format: "bc" }, { name: "t.tex.rgba.sntx", bytes: at + textureBytes("rgba", "base", 1024, 1), role: "tex", format: "rgba" });
  manifest.textures![0]!.in = { bc: { file: 1, at, hash: ["a", "b", "c", "d", "e", "f"] }, rgba: { file: 2, at, hash: ["a", "b", "c", "d", "e"] } };
  manifest.textures![1]!.in = { bc: { file: 1, at: at + size, hash: ["a", "b", "c", "d", "e", "f"] } };
  const text = JSON.stringify(manifest);
  expect(parseManifest(text)).toEqual(manifest);

  const spoiled: [string, (m: Manifest) => void][] = [
    ["not the size its counts give", (m) => (m.meshes[0]!.levels[0]!.parts[1]!.bytes -= 4)],
    ["does not turn flat where it says", (m) => (m.meshes[0]!.flat = 0)],
    ["do not cover it", (m) => (m.meshes[0]!.levels[0]!.sections = [0, 0, 3])],
    ["a hash for every step", (m) => m.textures![0]!.in.rgba!.hash.push("f")],
    ["lies outside its file", (m) => (m.textures![1]!.in.bc!.at += 4)],
    ["does not hold bc", (m) => (m.textures![0]!.in.bc!.file = 2)],
    ["a texture that is not there", (m) => (m.materials![0]!.normal = 5)],
    ["are not described", (m) => (m.clips = [{ rig: "t:rig", file: 0, at: 0, part: { bytes: 6 * 2 + 12, hash: "" }, clips: [{ id: "t:rig/idle", bones: 1, frames: 2, loop: true }] }])],
    ["is not supported", (m) => (m.version = 4)],
  ];
  for (const [reason, change] of spoiled) {
    const m = JSON.parse(text) as Manifest;
    change(m);
    expect(() => parseManifest(JSON.stringify(m))).toThrow(reason);
  }
});

test("the flat renderer's shader text is the text low poly was always drawn with", () => {
  // A change here changes how low poly is drawn on every device. Change the number only when that is meant. It was 4159497701
  // until a node was drawn at its size, which added one line and nothing else: a draw that is not sized never runs it.
  // They were 4159497701 and 3915806831 until a body on one bone stood in a pose (DRAW_ONE_BONE): the bones are read by a
  // function, and such a vertex follows its bone of that pose before the body's one bone. A body on its own bones is placed
  // by the same rows as before. The sizing line kept paint on the ground (uSkin below -1.5) out of it when crosswalk bars
  // became paint; nothing else changed, so the text without it is as it was.
  const sizing = "    if (uSkin < -0.5 && uSkin > -1.5) l *= float(iRegB.y) / 64.0;\n";
  expect(FLAT_MESH_VERTEX).toContain(sizing);
  // The bent street sections added the bend's function and one line that calls it (client/core/render/bend.ts), since low
  // poly draws a map's kerbs too. Without those two the text is as it was; with them it was 2539154211 until a walk was
  // let down to the ground at its end (the bend's sink, read with its flags from its walk's and panel's numbers), and
  // 231044186 until a vertex's station was left unwrapped for the fragment to wrap (a piece across the wrap drew its
  // stations run back over 600 m); the flat text reads no station, and is 3957629961.
  expect(FLAT_MESH_VERTEX).toContain(BEND_GLSL);
  expect(FLAT_MESH_VERTEX).toContain(BEND_PLACE);
  // A near chunk's mesh is drawn by its pieces' states on low poly too (client/core/render/pieces.ts): the rule's
  // function, the line that asks it and the line that drops a face not drawn. A vertex of any other mesh has no word and
  // reads no state. Without those three the text is as it was; with them it was 1090828137 until a city piece's wear
  // was shown: one more line darkens a piece of such a mesh by its stage from the state it already read (PIECE_SHADE),
  // which is all low poly and a phone show of wear. A vertex with no word never runs it, and a whole piece's is times 1.
  for (const part of [PIECE_GLSL, PIECE_PLACE, PIECE_SHADE, PIECE_END]) expect(FLAT_MESH_VERTEX).toContain(part);
  // A piece about to be built is drawn in one colour (uOneColor): one uniform and one line that swaps a vertex's colour
  // for it. A draw with no such colour never runs it. Without those two the text is as it was, 2435062563.
  const oneColor = ["uniform float uOneColor;\n", "  if (uOneColor > 0.5) i = uint(uOneColor) - 1u;\n"];
  for (const line of oneColor) expect(FLAT_MESH_VERTEX).toContain(line);
  // A built piece is turned by its base's own vectors, gives way at its ends and sides and is darker by its stage
  // (client/core/render/piece-fit.ts): the rule's function and table, the line that calls it and the line that darkens.
  // A draw that is not of pieces (uPiece 0) runs none of them. Without those three the text is as it was, 2887871706.
  // With them it was 4128407468 until the rule turned a trim's ends to their corners and left a point past a
  // triangle's standing side alone, and 509572875 until an end in a straight run was laid square: only the rule's
  // function changed.
  for (const part of [PIECE_FIT_GLSL, PIECE_FIT_PLACE, PIECE_FIT_SHADE]) expect(FLAT_MESH_VERTEX).toContain(part);
  const unfitted = FLAT_MESH_VERTEX.replace(PIECE_FIT_GLSL, "").replace(PIECE_FIT_PLACE, "").replace(PIECE_FIT_SHADE, "");
  const manyColoured = unfitted.replace(oneColor[0]!, "").replace(oneColor[1]!, "");
  const unshaded = manyColoured.replace(PIECE_SHADE, "");
  const unkeyed = unshaded.replace(PIECE_GLSL, "").replace(PIECE_PLACE, "").replace(PIECE_END, "");
  const unbent = unkeyed.replace(BEND_GLSL, "").replace(BEND_PLACE, "");
  // The moving terrain window offsets both height and tint reads. Restore the two old lines to check the historical shaders.
  const wrapUniform = "uniform vec2 uLast, uWrap;";
  const wrappedSample = "ivec2 at = (ivec2(ij) + ivec2(uWrap)) % textureSize(uHeight, 0);";
  expect(FLAT_TERRAIN_VERTEX).toContain(wrapUniform);
  expect(FLAT_TERRAIN_VERTEX).toContain(wrappedSample);
  const originalTerrain = FLAT_TERRAIN_VERTEX.replace(wrapUniform, "uniform vec2 uLast;").replace(wrappedSample, "ivec2 at = ivec2(ij);");
  expect(hashString(FLAT_FRAGMENT + unbent.replace(sizing, "") + originalTerrain)).toBe(2880639374);
  expect(hashString(FLAT_FRAGMENT + unbent + originalTerrain)).toBe(1010688119);
  expect(hashString(FLAT_FRAGMENT + unkeyed + originalTerrain)).toBe(3957629961);
  expect(hashString(FLAT_FRAGMENT + unshaded + originalTerrain)).toBe(1090828137);
  expect(hashString(FLAT_FRAGMENT + manyColoured + originalTerrain)).toBe(2435062563);
  expect(hashString(FLAT_FRAGMENT + unfitted + originalTerrain)).toBe(2887871706);
  expect(hashString(FLAT_FRAGMENT + FLAT_MESH_VERTEX + originalTerrain)).toBe(453623214);
});

test("draw flags are one bit each, a frame starts with no texture work, and the tiers ask for more as they go up", () => {
  const flags = [DRAW_BLEND, DRAW_SKINNED, DRAW_PLAIN, DRAW_NEAR, DRAW_ONE_BONE, DRAW_TEXTURED, DRAW_TWO_SIDED, DRAW_CUTOUT];
  expect(flags.reduce((all, f) => all | f, 0)).toBe(255);
  const packet = new FramePacket();
  packet.texDrops.push(1);
  packet.beginFrame();
  expect([packet.texUploads.length, packet.texDrops.length]).toEqual([0, 0]);
  expect(TIERS.map((t) => [t.view, t.bones, t.textureShare])).toEqual([[256, 8192, 0], [512, 16384, 0.6], [1024, 32768, 0.6], [2048, 65536, 0.6]]);
});
