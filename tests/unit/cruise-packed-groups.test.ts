import { expect, test } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { cruiseHash, matchTriangleOwners, verifyCruiseGroups, type CruisePackedGroups } from "../../tools/cruise/packed-groups.ts";
import { buildPack, type SourceLod } from "../../tools/pack/write.ts";

function fixture() {
  const positions = Float32Array.from([.1234,0,0, 4.4321,0,0, 0,0,3.7182, 0,2,0, 4,2,0, 0,2,3]);
  // The export reordered the two authored triangles and rotated their starting corners.
  const lod: SourceLod = { positions, indices: Uint32Array.from([4,5,3, 2,0,1]), colors: new Uint8Array(6) };
  const bytes = buildPack([{ id: "cruise:cell_0000", lods: [lod] }], defaultPalette());
  const pack = parsePack(bytes), raw = new Uint8Array(80), view = new DataView(raw.buffer);
  for (let triangle = 0; triangle < 2; triangle++) {
    view.setUint32(triangle * 40, triangle + 4, true);
    for (let k = 0; k < 9; k++) view.setFloat32(triangle * 40 + 4 + k * 4, positions[triangle * 9 + k]!, true);
  }
  return { bytes, pack, raw };
}

test("cruise cell ownership follows actual quantized faces through export reordering, and refuses a reversed or missing face", () => {
  const { pack, raw } = fixture(), mesh = pack.header.meshes[0]!;
  expect(matchTriangleOwners(pack, mesh, 0, raw, 6)).toEqual([[0,1,5],[1,1,4]]);
  const reversed = raw.slice(), view = new DataView(reversed.buffer);
  for (let axis = 0; axis < 3; axis++) {
    const a = view.getFloat32(4 + axis * 4, true), b = view.getFloat32(16 + axis * 4, true);
    view.setFloat32(4 + axis * 4, b, true); view.setFloat32(16 + axis * 4, a, true);
  }
  expect(() => matchTriangleOwners(pack, mesh, 0, reversed, 6)).toThrow("absent from outward authored geometry");
  expect(() => matchTriangleOwners(pack, mesh, 0, raw.slice(40), 6)).toThrow("triangle count differs");
  expect(() => matchTriangleOwners(pack, mesh, 0, raw, 5)).toThrow("unknown triangle owner");
});

test("cruise packed ownership rejects stale source and pack hashes or incomplete triangle coverage", () => {
  const { bytes, pack, raw } = fixture(), layout = new TextEncoder().encode("layout");
  const groups: CruisePackedGroups = { version: 1, layoutSHA256: cruiseHash(layout), packSHA256: cruiseHash(bytes), meshes: [{ id: pack.header.meshes[0]!.id, origin: [0,0,0], yaw: 0,
    levels: [{ level: 0, authoredLevel: 0, triangles: 2, ranges: matchTriangleOwners(pack, pack.header.meshes[0]!, 0, raw, 6) }] }] };
  expect(() => verifyCruiseGroups(groups, layout, bytes)).not.toThrow();
  expect(() => verifyCruiseGroups(groups, new Uint8Array(), bytes)).toThrow("does not match");
  expect(() => verifyCruiseGroups(groups, layout, bytes.slice(1))).toThrow("does not match");
  const incomplete: CruisePackedGroups = { ...groups, meshes: [{ ...groups.meshes[0]!, levels: [{ level: 0, authoredLevel: 0, triangles: 2, ranges: [[0,1,4]] }] }] };
  expect(() => verifyCruiseGroups(incomplete, layout, bytes)).toThrow("incomplete ownership coverage");
  const invalidStage: CruisePackedGroups = { ...groups, meshes: [{ ...groups.meshes[0]!, levels: [{ ...groups.meshes[0]!.levels[0]!, authoredLevel: 2 }] }] };
  expect(() => verifyCruiseGroups(invalidStage, layout, bytes)).toThrow("invalid authored level mapping");
});
