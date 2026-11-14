import { expect, test } from "bun:test";
import { VERTEX_BYTES, lodIndices, lodVertices, parsePack } from "../../shared/pack/pack.ts";
import { HUMAN, SLOT_NAMES } from "../../shared/anim/human.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { MISSING_MESH, buildCorePack } from "../../tools/pack/build.ts";
import { importGlb } from "../../tools/pack/glb.ts";
import { sampleGlb } from "../fixtures/glb.ts";

test("a glTF export becomes a pack mesh with levels of detail, colour regions and a collider", () => {
  const palette = defaultPalette();
  const report = importGlb(sampleGlb(palette, 3), "test:pyramid", palette);
  expect(report.warnings).toEqual([]);
  expect(report.worstColorError).toBeLessThan(1);

  const pack = parsePack(buildCorePack([report.mesh]));
  const mesh = pack.header.meshes[pack.meshIndex.get("test:pyramid")!]!;
  expect(mesh.lods.map((l) => [l.vertexCount, l.indexCount])).toEqual([[9, 18], [3, 3]]);
  expect(mesh.collider).toEqual([1, 2, 1]);
  // Node transforms are baked (scale 2, lifted 1). Both levels share the bounds x and z in [-1, 1], y in [0, 3].
  expect(mesh.center.map((v) => +v.toFixed(4))).toEqual([0, 1.5, 0]);
  expect(mesh.half.map((v) => +v.toFixed(4))).toEqual([1, 1.5, 1]);

  const verts = lodVertices(pack, mesh.lods[0]!);
  const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
  const position = (v: number) => [0, 1, 2].map((a) => mesh.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * mesh.half[a]!);
  expect(position(0).map((v) => +v.toFixed(3))).toEqual([0, 3, 0]); // apex
  expect(position(1).map((v) => +v.toFixed(3))).toEqual([-1, 1, -1]);
  const colors = Array.from({ length: 9 }, (_, v) => verts[v * VERTEX_BYTES + 6]);
  expect(colors).toEqual([3, 3, 3, 3, 3, REGION_BASE, REGION_BASE, REGION_BASE, REGION_BASE]);
  const idx = lodIndices(pack, mesh.lods[0]!);
  expect(idx.length).toBe(36);
  expect(Math.max(...new Uint16Array(idx.slice().buffer))).toBe(8);

  // The 90 degree turn on the low-detail node maps +X to -Z.
  const low = lodVertices(pack, mesh.lods[1]!);
  const lv = new DataView(low.buffer, low.byteOffset, low.byteLength);
  expect(lv.getInt16(VERTEX_BYTES + 4, true)).toBe(-32767);
});

test("the core pack has a mesh for every graybox definition and rejects damaged files", () => {
  const file = buildCorePack();
  const pack = parsePack(file);
  for (const id of [MISSING_MESH, "core:wall", "core:grazer", "core:slab"]) expect(pack.meshIndex.has(id)).toBe(true);
  const wall = pack.header.meshes[pack.meshIndex.get("core:wall")!]!;
  expect(wall.half.map((v) => +v.toFixed(4))).toEqual([1.5, 1.5, 0.1]);
  expect(wall.lods[0]!.indexCount).toBe(36);
  expect(wall.skeleton).toBeUndefined();
  const grazer = pack.header.meshes[pack.meshIndex.get("core:grazer")!]!;
  expect(grazer.center[1]).toBeCloseTo(0.8, 4); // stands on its origin
  expect(pack.palette.length).toBe(1024);

  expect(() => parsePack(file.subarray(0, 40))).toThrow();
  const bad = file.slice();
  bad[0] = 0;
  expect(() => parsePack(bad)).toThrow(/magic/);
  const future = file.slice();
  future[4] = 9;
  expect(() => parsePack(future)).toThrow(/version/);
});

test("the pack carries bodies cut into slots, each vertex on one bone, and the clips that move them", () => {
  const pack = parsePack(buildCorePack());
  // The mannequin is the skeleton's own capsules. Each modelled body is on its own rig, at three levels of detail.
  for (const [base, rig, levels] of [["core:mannequin", undefined, 1], ["core:human_m", "human_m", 3], ["core:human_f", "human_f", 3]] as const) {
    let triangles = 0;
    for (const slot of SLOT_NAMES) {
      const mesh = pack.header.meshes[pack.meshIndex.get(`${base}/${slot}`)!]!;
      expect(mesh.skeleton).toBe("human");
      expect(mesh.rig === undefined ? undefined : pack.header.rigs[mesh.rig]!.id).toBe(rig);
      expect(mesh.lods.length).toBe(levels);
      triangles += mesh.lods[0]!.indexCount / 3;
      for (let l = 1; l < levels; l++) expect(mesh.lods[l]!.indexCount).toBeLessThan(mesh.lods[l - 1]!.indexCount * 0.6);
      // On the mannequin every vertex follows a bone of this slot.
      const verts = lodVertices(pack, mesh.lods[0]!);
      for (let v = 0; v < mesh.lods[0]!.vertexCount; v++) {
        const bone = verts[v * VERTEX_BYTES + 7]!;
        expect(bone).toBeLessThan(HUMAN.bones);
        if (rig === undefined) expect(SLOT_NAMES[HUMAN.slot[bone]!]).toBe(slot);
      }
    }
    if (rig !== undefined) {
      expect(triangles).toBeGreaterThan(3500);
      expect(triangles).toBeLessThan(5000);
    }
  }
  // A rig is the skeleton's bones at that body's rest positions, close to the skeleton's own.
  for (const rig of pack.header.rigs) {
    // A creature's rig is a whole skeleton of its own. See tests/unit/creature.test.ts.
    if (rig.names) continue;
    expect(rig.skeleton).toBe("human");
    expect(rig.rest.length).toBe(HUMAN.bones * 3);
    let far = 0;
    for (let k = 0; k < rig.rest.length; k++) far = Math.max(far, Math.abs(rig.rest[k]! - HUMAN.rest[k]!));
    expect(far).toBeLessThan(0.1);
  }
  expect(pack.header.rigs.map((r) => r.id)).toEqual(["core:parasaur", "core:raptor", "human_f", "human_m"]);
  for (const id of ["core:human_m/hair/buzzed", "core:human_f/hair/long", "core:human_m/beard/full"]) expect(pack.meshIndex.has(id)).toBe(true);

  const clips = pack.clips;
  expect(clips.clips.length).toBeGreaterThanOrEqual(30);
  const jog = clips.clips[clips.index.get("human/jog")!]!;
  expect([jog.bones, jog.frames, jog.loop]).toEqual([HUMAN.bones, 28, true]);
  for (let k = 0; k < jog.rot.length; k += 4) expect(Math.hypot(jog.rot[k]!, jog.rot[k + 1]!, jog.rot[k + 2]!, jog.rot[k + 3]!)).toBeCloseTo(1, 3);
  expect(clips.clips[clips.index.get("human/death")!]!.loop).toBe(false);
  expect(clips.hash).not.toBe(0);
  expect(parsePack(buildCorePack()).clips.hash).toBe(clips.hash);
  // A clip pointing outside the file is refused.
  const header = JSON.stringify({ ...pack.header, clips: [{ ...pack.header.clips[0]!, frames: 1e6 }] });
  const broken = new Uint8Array(12 + header.length + pack.blob.length);
  const view = new DataView(broken.buffer);
  view.setUint32(0, 0x4b504e53, true);
  view.setUint16(4, 2, true);
  view.setUint32(8, header.length, true);
  broken.set(new TextEncoder().encode(header), 12);
  broken.set(pack.blob, 12 + header.length);
  expect(() => parsePack(broken)).toThrow(/clip/);
});
