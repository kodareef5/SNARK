import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { FLAT_FRAGMENT, FLAT_MESH_VERTEX, FLAT_TERRAIN_VERTEX } from "../../client/core/render/glsl.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, FramePacket } from "../../client/core/render/packet.ts";
import { hashString } from "../../shared/hash.ts";
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
    ["is not supported", (m) => (m.version = 5)],
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
  // by the same rows as before.
  const sizing = "    if (uSkin < -0.5) l *= float(iRegB.y) / 64.0;\n";
  expect(FLAT_MESH_VERTEX).toContain(sizing);
  expect(hashString(FLAT_FRAGMENT + FLAT_MESH_VERTEX.replace(sizing, "") + FLAT_TERRAIN_VERTEX)).toBe(2880639374);
  expect(hashString(FLAT_FRAGMENT + FLAT_MESH_VERTEX + FLAT_TERRAIN_VERTEX)).toBe(3218886244);
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
