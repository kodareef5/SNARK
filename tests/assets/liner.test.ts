import { describe, expect, test } from "bun:test";
import { line, liningOf } from "../../tools/pack/liner.ts";
import type { PackMaterial } from "../../shared/pack/pack.ts";
import type { SourceLod, SourceMesh } from "../../tools/pack/write.ts";

/** A tube along y of radius `r` from y0 to y1, in rings and segments, wound outward, every vertex on `bone`. */
function tube(r: number, y0: number, y1: number, rings = 20, segments = 24, bone = 7): SourceLod {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j < segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    positions.push(r * Math.cos(a), y0 + ((y1 - y0) * i) / rings, r * Math.sin(a));
    normals.push(Math.cos(a), 0, Math.sin(a));
    uvs.push(j / segments, i / rings);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * segments + j, b = i * segments + ((j + 1) % segments), c = a + segments, d = b + segments;
    indices.push(a, c, b, b, c, d);
  }
  const n = positions.length / 3;
  return {
    positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), colors: new Uint8Array(n).fill(240), indices: Uint32Array.from(indices),
    bones: new Uint8Array(n).fill(bone), joints: Uint8Array.from({ length: n * 4 }, (_, k) => (k % 4 === 0 ? bone : 12)), weights: Float32Array.from({ length: n * 4 }, (_, k) => (k % 4 === 0 ? 0.75 : k % 4 === 1 ? 0.25 : 0)),
    sections: new Uint8Array(indices.length / 3),
  };
}

const material = (id: string): PackMaterial => ({ id, base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 0, emissive: 0, flags: 0, cutoff: 0, span: 1 });

describe("liner", () => {
  // An arm of 5 cm from y 0 to 0.4, and a sleeve 1 cm off it over its upper half.
  const arm = (): SourceMesh => ({ id: "core:human_m/torso", lods: [tube(0.05, 0, 0.4, 40)], materials: [material("core:human-bodies/skin_mh_m")], textures: [] });
  const sleeve = (): SourceMesh => {
    const lod = tube(0.06, 0.2, 0.45, 25, 24, 7);
    lod.colors.fill(241);
    return { id: "core:human_m/armor/cloth/torso", lods: [lod], materials: [material("core:human-bodies/cloth")], textures: [] };
  };

  test("a piece is lined with the skin it leaves showing and a margin under its edge", () => {
    const piece = sleeve(), body = arm();
    const cloth = piece.lods[0]!.indices.length / 3;
    const [added] = line(piece, body);
    const lod = piece.lods[0]!;
    expect(added).toBeGreaterThan(0);
    expect(lod.indices.length / 3).toBe(cloth + added!);
    // The lining is drawn with the body's skin, and only from below the sleeve to 2 cm under its hem.
    expect(piece.materials!.map((m) => m.id)).toEqual(["core:human-bodies/cloth", "core:human-bodies/skin_mh_m"]);
    let top = -Infinity;
    for (let t = cloth; t < lod.indices.length / 3; t++) {
      expect(lod.sections![t]).toBe(1);
      for (let k = 0; k < 3; k++) top = Math.max(top, lod.positions[lod.indices[t * 3 + k]! * 3 + 1]!);
    }
    expect(top).toBeGreaterThan(0.2);
    expect(top).toBeLessThan(0.2 + 0.035);
  });

  test("the lining keeps the skin's weights and sinks under the piece's edge", () => {
    const piece = sleeve(), body = arm();
    const cloth = piece.lods[0]!.positions.length / 3;
    line(piece, body);
    const lod = piece.lods[0]!;
    let deepest = 0, open = Infinity;
    for (let v = cloth; v < lod.positions.length / 3; v++) {
      expect([...lod.joints!.subarray(v * 4, v * 4 + 2)]).toEqual([7, 12]);
      expect(lod.weights![v * 4]).toBeCloseTo(0.75, 6);
      const r = Math.hypot(lod.positions[v * 3]!, lod.positions[v * 3 + 2]!), y = lod.positions[v * 3 + 1]!;
      if (y > 0.195) deepest = Math.max(deepest, 0.05 - r);
      if (y < 0.15) open = Math.min(open, 0.05 - r);
    }
    // Where the skin shows the lining is the skin; under the sleeve it lies millimetres inside it.
    expect(open).toBeCloseTo(0, 4);
    expect(deepest).toBeGreaterThan(0.003);
    expect(deepest).toBeLessThan(0.007);
  });

  test("lining reaches only skin near what shows, and says how far it sinks", () => {
    const at = liningOf(sleeve(), arm());
    expect(at(0.05, 0.1, 0)).toBeCloseTo(0, 9);
    expect(at(0.05, 0.198, 0)).toBeGreaterThan(0);
    expect(at(0.05, 0.35, 0)).toBe(-1);
  });
});
