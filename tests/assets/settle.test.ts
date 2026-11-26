// A build settled on the pack it replaces (tools/pack/settle.ts). The "build" here is a committed pack with bytes of
// its finest levels changed in place, which is what another processor, another layout or a real change does to one.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SURFACE_BYTES, VERTEX_BYTES, lodSurface, lodVertices, meshFaces, parsePack, type PackLod } from "../../shared/pack/pack.ts";
import { ART, SOURCE } from "../../tools/art/source.ts";
import { settlePack } from "../../tools/pack/settle.ts";
import { buildPack, unpackMeshes } from "../../tools/pack/write.ts";

describe.skipIf(!ART)("a build settled on the committed pack", () => {
  const committed = (): Uint8Array => new Uint8Array(readFileSync(join(SOURCE, "core/items/stone-tools/stone-tools.snpk")));

  /** A copy of the pack with `change` given the finest level's vertices and surface of the mesh `id`, to write in. */
  function built(id: string, change: (vertices: DataView, surface: DataView, lod: PackLod) => void): Uint8Array {
    const file = committed();
    const pack = parsePack(file);
    const lod = pack.header.meshes[pack.meshIndex.get(id)!]!.lods[0]!;
    const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    change(view(lodVertices(pack, lod)), view(lodSurface(pack, lod)!), lod);
    return file;
  }

  const levelBytes = (file: Uint8Array, id: string): string => {
    const pack = parsePack(file);
    return pack.header.meshes[pack.meshIndex.get(id)!]!.lods.map((l) => `${Buffer.from(lodVertices(pack, l)).toString("hex")}${Buffer.from(lodSurface(pack, l) ?? []).toString("hex")}`).join("|");
  };

  test("a kept mesh takes the new build's face table", () => {
    const was = committed();
    const pack = parsePack(was);
    const meshes = unpackMeshes(pack);
    meshes.find((m) => m.id === "core:hatchet")!.faces = Uint8Array.of(1, 2, 3, 4, 5);
    const fresh = buildPack(meshes, pack.palette, pack.clips.clips, pack.header.rigs);
    const settled = settlePack(fresh, was);
    expect(settled.file).not.toBe(was);
    const out = parsePack(settled.file);
    expect([...meshFaces(out, out.header.meshes[out.meshIndex.get("core:hatchet")!]!)!]).toEqual([1, 2, 3, 4, 5]);
    expect(settled.kept).toContain("core:hatchet");
    // Settled again on itself, the table is unchanged and the file is the one settled on.
    expect(settlePack(settled.file, settled.file).file).toBe(settled.file);
  });

  test("the same build is the committed file itself", () => {
    const was = committed();
    const settled = settlePack(committed(), was);
    expect(settled.file).toBe(was);
    expect(settled.made).toEqual([]);
    expect(settled.kept.length).toBe(parsePack(was).header.meshes.length);
  });

  test("a step of rounding, and tangents swung by it, are the committed mesh", () => {
    const was = committed();
    const fresh = built("core:hatchet", (v, s, lod) => {
      for (let i = 0; i < lod.vertexCount; i += 3) {
        const at = i * VERTEX_BYTES + 2 * (i % 3);
        v.setInt16(at, Math.max(-32767, Math.min(32767, v.getInt16(at, true) + (i % 2 ? 1 : -1))), true);
        s.setUint32(i * SURFACE_BYTES + 8, s.getUint32(i * SURFACE_BYTES + 8, true) ^ 0x000ffc00, true);
      }
    });
    expect(Buffer.from(fresh).equals(Buffer.from(was))).toBe(false);
    const settled = settlePack(fresh, was);
    expect(settled.file).toBe(was);
    expect(settled.layout).toEqual([]);
  });

  test("a shape that moved is made anew, and the others are kept to the byte", () => {
    const was = committed();
    const fresh = built("core:hatchet", (v, _s, lod) => {
      for (let i = 0; i < lod.vertexCount; i++) v.setInt16(i * VERTEX_BYTES, Math.round(v.getInt16(i * VERTEX_BYTES, true) * 0.9), true);
    });
    const settled = settlePack(fresh, was);
    expect(settled.made).toEqual(["core:hatchet"]);
    expect(settled.file).not.toBe(was);
    expect(levelBytes(settled.file, "core:hatchet")).toBe(levelBytes(fresh, "core:hatchet"));
    for (const id of settled.kept) expect(levelBytes(settled.file, id)).toBe(levelBytes(was, id));
    // And the pack that comes of it reads whole.
    expect(parsePack(settled.file).header.meshes.map((m) => m.id)).toEqual(parsePack(was).header.meshes.map((m) => m.id));
  });

  /** The layout laid somewhere else, and the colours read off the pictures there. */
  const relaid = (): Uint8Array => built("core:hatchet", (v, s, lod) => {
    for (let i = 0; i < lod.vertexCount; i++) {
      s.setUint16(i * SURFACE_BYTES, (s.getUint16(i * SURFACE_BYTES, true) + 900) % 65536, true);
      v.setUint8(i * VERTEX_BYTES + 6, (v.getUint8(i * VERTEX_BYTES + 6) + 1) % 64);
    }
  });

  test("the same shape on another texture layout keeps the layout its pictures are painted on", () => {
    const was = committed();
    const settled = settlePack(relaid(), was);
    expect(settled.layout).toEqual(["core:hatchet"]);
    expect(settled.made).toEqual([]);
    expect(settled.file).toBe(was);
  });

  test("unless the pictures are being painted again", () => {
    const fresh = relaid();
    const settled = settlePack(fresh, committed(), { relayout: true });
    expect(settled.made).toEqual(["core:hatchet"]);
    expect(levelBytes(settled.file, "core:hatchet")).toBe(levelBytes(fresh, "core:hatchet"));
  });

  test("another colour on a layout that stands is a change, and is not kept back", () => {
    const fresh = built("core:hatchet", (v, _s, lod) => {
      for (let i = 0; i < lod.vertexCount; i++) v.setUint8(i * VERTEX_BYTES + 6, (v.getUint8(i * VERTEX_BYTES + 6) + 1) % 64);
    });
    expect(settlePack(fresh, committed()).made).toEqual(["core:hatchet"]);
  });

  test("another normal is a change too, layout moved or not", () => {
    const fresh = built("core:hatchet", (_v, s, lod) => {
      for (let i = 0; i < lod.vertexCount; i++) {
        s.setUint32(i * SURFACE_BYTES + 4, s.getUint32(i * SURFACE_BYTES + 4, true) ^ 0x200, true);
        s.setUint16(i * SURFACE_BYTES, (s.getUint16(i * SURFACE_BYTES, true) + 900) % 65536, true);
      }
    });
    expect(settlePack(fresh, committed()).made).toEqual(["core:hatchet"]);
  });

  test("a mesh named to be kept is kept whatever was built", () => {
    const was = committed();
    const fresh = built("core:hatchet", (v, _s, lod) => {
      for (let i = 0; i < lod.vertexCount; i++) v.setInt16(i * VERTEX_BYTES, Math.round(v.getInt16(i * VERTEX_BYTES, true) * 0.9), true);
    });
    const settled = settlePack(fresh, was, { keep: ["core:hatchet"] });
    expect(settled.told).toEqual(["core:hatchet"]);
    expect(settled.file).toBe(was);
  });
});
