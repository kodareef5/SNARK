import { expect, test } from "bun:test";
import { AssetTable } from "../../client/core/assets/table.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { describePack, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { CLIP_ROOT_STEPS, PACK_VERSION, VERTEX_BYTES, lodIndices, lodVertices, parsePack, readIndices } from "../../shared/pack/pack.ts";
import { HUMAN, SLOT_NAMES } from "../../shared/anim/human.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { MISSING_MESH, buildCorePack, coreClips } from "../../tools/pack/build.ts";
import { surfaceError } from "../../tools/pack/error.ts";
import { importGlb } from "../../tools/pack/glb.ts";
import { manifestOf, partHash } from "../../tools/pack/manifest.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";
import { sampleGlb } from "../fixtures/glb.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes } from "../fixtures/pack.ts";

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
  const file = corePackBytes();
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

artTest("the pack carries bodies cut into slots, each vertex on one bone, and the clips that move them", () => {
  const pack = parsePack(corePackBytes());
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
  expect(pack.header.rigs.filter((r) => !r.names).map((r) => r.id)).toEqual(["human_f", "human_m"]);
  for (const id of ["core:human_m/hair/buzzed", "core:human_f/hair/long", "core:human_m/beard/full"]) expect(pack.meshIndex.has(id)).toBe(true);

  const clips = pack.clips;
  expect(clips.clips.length).toBeGreaterThanOrEqual(30);
  const jog = clips.clips[clips.index.get("human/jog")!]!;
  expect(jog.bones).toBe(HUMAN.bones);
  expect([jog.frames, jog.loop]).toEqual([28, true]);
  for (let k = 0; k < jog.rot.length; k += 4) expect(Math.hypot(jog.rot[k]!, jog.rot[k + 1]!, jog.rot[k + 2]!, jog.rot[k + 3]!)).toBeCloseTo(1, 3);
  expect(clips.clips[clips.index.get("human/punch")!]!.loop).toBe(false);
  expect(clips.hash).not.toBe(0);
  expect(parsePack(buildCorePack()).clips.hash).toBe(clips.hash);
  // A clip pointing outside the file is refused.
  const header = JSON.stringify({ ...pack.header, clips: [{ ...pack.header.clips[0]!, frames: 1e6 }] });
  const broken = new Uint8Array(12 + header.length + pack.blob.length);
  const view = new DataView(broken.buffer);
  view.setUint32(0, 0x4b504e53, true);
  view.setUint16(4, PACK_VERSION, true);
  view.setUint32(8, header.length, true);
  broken.set(new TextEncoder().encode(header), 12);
  broken.set(pack.blob, 12 + header.length);
  expect(() => parsePack(broken)).toThrow(/clip/);
});

/** A square of `n` by `n` cells, two metres across, lying flat at height `y`. */
function plate(n: number, y: number): SourceLod {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push((i / n) * 2 - 1, y, (j / n) * 2 - 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  return { positions: Float32Array.from(positions), colors: new Uint8Array(positions.length / 3), indices: Uint32Array.from(indices) };
}

test("a level is one run of bytes, and says how wide its indices are and how far it lies from the finest", () => {
  expect(surfaceError(plate(4, 0), plate(1, 0.25))).toBeCloseTo(0.25, 6);
  expect(surfaceError(plate(4, 0), plate(1, 0))).toBeCloseTo(0, 6);
  // One stray triangle in a hundred does not speak for the mesh.
  const stray = plate(8, 0);
  stray.positions[1] = 3;
  expect(surfaceError(plate(8, 0), stray)).toBeLessThan(0.5);

  const wide = plate(256, 0);
  const pack = parsePack(buildPack([{ id: "t:plate", lods: [plate(4, 0), plate(2, 0.25), { ...plate(1, 0.25), error: 0.5 }] }, { id: "t:wide", lods: [wide] }], defaultPalette()));
  const [small, big] = [pack.header.meshes[pack.meshIndex.get("t:plate")!]!, pack.header.meshes[pack.meshIndex.get("t:wide")!]!];
  // Measured where it was not given, and kept where it was.
  expect(small.lods.map((l) => [l.indexBytes, l.error])).toEqual([[2, 0], [2, 0.25], [2, 0.5]]);
  for (const l of [...small.lods, ...big.lods]) expect(l.vertexOffset).toBe(l.indexOffset + ((l.indexCount * l.indexBytes + 3) & ~3));
  // 257 by 257 corners are more than sixteen bits count.
  expect([big.lods[0]!.vertexCount, big.lods[0]!.indexBytes, lodIndices(pack, big.lods[0]!).length]).toEqual([66049, 4, 256 * 256 * 6 * 4]);
  expect(readIndices(pack, big.lods[0]!)).toEqual(wide.indices);
  const back = unpackMeshes(pack);
  expect(back.map((m) => m.lods.map((l) => l.error))).toEqual([[undefined, 0.25, 0.5], [undefined]]);
  expect(back[1]!.lods[0]!.indices).toEqual(wide.indices);
});

test("a pack of another version is refused, clips come back within a step, and they hash the same with or without meshes", () => {
  const file = corePackBytes();
  const now = parsePack(file);
  const older = file.slice();
  new DataView(older.buffer).setUint16(4, PACK_VERSION - 1, true);
  expect(() => parsePack(older)).toThrow(/version/);
  // A bone turns at most 0.025 degrees from its clip, and the root moves at most half a step.
  const clips = coreClips();
  const back = parsePack(buildPack([], defaultPalette(), clips)).clips;
  let [turn, moved] = [0, 0];
  for (const c of clips) {
    const d = back.clips[back.index.get(c.id)!]!;
    for (let k = 0; k < c.rot.length; k += 4) {
      const [a, b] = [c.rot.subarray(k, k + 4), d.rot.subarray(k, k + 4)];
      const side = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]! < 0 ? -1 : 1;
      const [la, lb] = [Math.hypot(...a), Math.hypot(...b)];
      turn = Math.max(turn, 4 * Math.asin(Math.hypot(...[0, 1, 2, 3].map((i) => a[i]! / la - (side * b[i]!) / lb)) / 2));
    }
    for (let k = 0; k < c.root.length; k++) moved = Math.max(moved, Math.abs(c.root[k]! - d.root[k]!));
  }
  expect([(turn * 180) / Math.PI < 0.025, moved <= 0.5 / CLIP_ROOT_STEPS + 1e-6]).toEqual([true, true]);
  // The handshake hashes the clips alone, so a pack split into files answers as the whole one does.
  expect(parsePack(buildPack([], defaultPalette(), coreClips())).clips.hash).toBe(now.clips.hash);
  // Every body's levels lie further from the finest as they get coarser, and none by more than a hand's width. A shape
  // drawn otherwise than it is walked repeats its look at the second level, for low poly, and is drawn as walked at the third,
  // within a tread of its look.
  const looks = new Set(CORE_CONTENT.flatMap((d) => (d.type === "structure" && CORE_CONTENT.some((s) => s.type === "shape" && s.id === d.shape && s.look) ? [d.id] : [])));
  expect(looks.size).toBeGreaterThan(0);
  for (const m of now.header.meshes.filter((m) => m.lods.length === 3)) {
    const [fine, mid, far] = m.lods.map((l) => l.error) as [number, number, number];
    expect([m.id, looks.has(m.id) ? fine === 0 && mid === 0 && far > 0 && far < 1 : fine === 0 && mid > 0 && far > mid && far < 0.1]).toEqual([m.id, true]);
  }
});

artTest("the manifest lists every level with the bytes that hold it, and reads back as it was written", () => {
  const file = corePackBytes();
  const pack = parsePack(file);
  const manifest = manifestOf("core.snpk", file);
  const text = JSON.stringify(manifest);
  expect(parseManifest(text)).toEqual(manifest);
  expect([manifest.files, manifest.boot, manifest.clipHash, manifest.meshes.length]).toEqual([[{ name: "core.snpk", bytes: file.length, role: "boot" }], 0, pack.clips.hash, pack.header.meshes.length]);
  let levels = 0;
  for (const m of manifest.meshes) {
    for (const level of m.levels) {
      const part = level.parts[0]!;
      expect(part.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(part.hash).toBe(partHash(file.subarray(level.at, level.at + part.bytes)));
      // The run is the indices and then the vertices.
      expect(new DataView(file.buffer, file.byteOffset + level.at).getUint16(0, true)).toBeLessThan(level.verts);
      levels++;
    }
  }
  expect(levels).toBe(pack.header.meshes.reduce((n, m) => n + m.lods.length, 0));
  expect(levels).toBeGreaterThan(manifest.meshes.length);

  // What the client knows of the meshes comes out the same from the file as from the pack it describes.
  const [a, b] = [new AssetTable(parseManifest(text), pack), new AssetTable(describePack(pack, { name: "", bytes: file.length }), pack)];
  expect([a.count, a.tris, a.error, [...a.radius], a.skeleton, [...a.rig], [...a.bone]]).toEqual([b.count, b.tris, b.error, [...b.radius], b.skeleton, [...b.rig], [...b.bone]]);
  expect(a.tris[a.find("core:human_m/torso")]).toEqual([1150, 392, 108]);
  expect(a.has("clip", "human/walk") && a.has("rig", "human_f") && !a.has("mesh", "core:nothing")).toBe(true);

  const bad = (change: (m: Manifest) => void): (() => unknown) => {
    const m = JSON.parse(text) as Manifest;
    change(m);
    return () => parseManifest(JSON.stringify(m));
  };
  expect(bad((m) => (m.version = 9))).toThrow(/version/);
  expect(bad((m) => (m.boot = 3))).toThrow(/boot/);
  expect(bad((m) => (m.meshes[1]!.id = m.meshes[0]!.id))).toThrow(/twice/);
  expect(bad((m) => (m.meshes[0]!.levels[0]!.at = file.length))).toThrow(/outside/);
  expect(bad((m) => (m.meshes[0]!.levels[0]!.verts += 1))).toThrow(/size/);
  expect(bad((m) => (m.meshes[0]!.levels = []))).toThrow(/no level/);
});
