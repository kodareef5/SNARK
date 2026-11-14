// A pack split into the file fetched at start and the file fetched a level at a time, and the meshes made to load both.
import { expect, test } from "bun:test";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { lodIndices, lodVertices, parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { surfaceError } from "../../tools/pack/error.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { BOOT_LEVEL_BYTES, splitPack } from "../../tools/pack/split.ts";
import { LEVEL_COLOURS, stressMeshes, stressSet } from "../../tools/pack/stress.ts";

test("a split pack holds every level once, byte for byte, with the coarsest of each mesh in the boot file", () => {
  const whole = buildCorePack();
  const pack = parsePack(whole);
  const { files, manifest } = splitPack(whole, "core");
  expect(files.map((f) => [f.name, f.role])).toEqual([["core.boot.snpk", "boot"], ["core.mesh.snpk", "mesh"]]);
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  const [boot, rest] = files.map((f) => parsePack(f.bytes));
  // The boot file is a pack with the palette, every rig, every clip, and some level of every mesh.
  expect([boot!.header.meshes.length, boot!.header.rigs, boot!.clips.hash, [...boot!.palette]]).toEqual([pack.header.meshes.length, pack.header.rigs, pack.clips.hash, [...pack.palette]]);
  expect(rest!.header.clips.length + rest!.header.rigs.length).toBe(0);
  let streamed = 0;
  manifest.meshes.forEach((m, i) => {
    const from = pack.header.meshes[i]!;
    expect([m.id, m.levels.length]).toEqual([from.id, from.lods.length]);
    m.levels.forEach((level, l) => {
      const bytes = level.parts[0]!.bytes;
      const got = files[level.file]!.bytes.subarray(level.at, level.at + bytes);
      // The run is the level's indices and then its vertices, as the whole pack had them.
      expect(partHash(got)).toBe(level.parts[0]!.hash);
      expect(got.subarray(0, from.lods[l]!.indexCount * level.index)).toEqual(lodIndices(pack, from.lods[l]!));
      expect(got.subarray(bytes - level.verts * 8)).toEqual(lodVertices(pack, from.lods[l]!));
      const last = l === m.levels.length - 1;
      expect(level.file).toBe(last || bytes <= BOOT_LEVEL_BYTES ? 0 : 1);
      if (level.file === 1) streamed++;
    });
  });
  expect(streamed).toBeGreaterThan(40);
  // The two files together are little more than the one.
  expect(files[0]!.bytes.length + files[1]!.bytes.length).toBeLessThan(whole.length * 1.06);
  expect(files[0]!.bytes.length).toBeLessThan(whole.length * 0.6);
});

test("the stress meshes: rocks of four times fewer triangles a level, each level its own colour, and a plate past 16 bits", () => {
  const meshes = stressMeshes({ rocks: 3, detail: 5, plate: 512 });
  expect(meshes.map((m) => m.id)).toEqual(["stress:rock_00", "stress:rock_01", "stress:rock_02", "stress:bad_hash", "stress:bad_range", "stress:bad_short", "stress:plate"]);
  const rock = meshes[0]!;
  expect(rock.lods.map((l) => l.indices.length / 3)).toEqual([20480, 5120, 1280, 320, 80]);
  expect(rock.lods.map((l) => l.colors[0])).toEqual([...LEVEL_COLOURS]);
  for (let l = 2; l < 5; l++) expect(rock.lods[l]!.error!).toBeGreaterThan(rock.lods[l - 1]!.error! * 2);
  // What a level says of itself is what measuring finds, to within a half.
  const small = stressMeshes({ rocks: 1, detail: 3, plate: 0 })[0]!;
  for (const l of [1, 2]) {
    const measured = surfaceError(small.lods[0]!, small.lods[l]!);
    expect(small.lods[l]!.error! / measured).toBeGreaterThan(0.75);
    expect(small.lods[l]!.error! / measured).toBeLessThan(2);
  }
  const plate = meshes[6]!;
  expect(plate.lods.map((l) => l.positions.length / 3)).toEqual([263169, 66049, 16641, 4225, 1089]);
  expect(plate.lods.map((l) => l.error ?? 0).every((e, i, all) => i === 0 || e > all[i - 1]!)).toBe(true);
  // The same seed makes the same meshes.
  expect(stressMeshes({ rocks: 3, detail: 5, plate: 0 })[1]!.lods[4]!.positions).toEqual(meshes[1]!.lods[4]!.positions);
});

test("the stress set lists three parts that cannot be had, and the manifest still reads", () => {
  const { files, manifest } = stressSet({ rocks: 2, detail: 3, plate: 64 });
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  const finest = (id: string) => manifest.meshes.find((m) => m.id === id)!.levels[0]!;
  const real = files[1]!.bytes.length;
  expect(manifest.files[1]!.bytes).toBeGreaterThan(real);
  const [hash, range, short] = [finest("stress:bad_hash"), finest("stress:bad_range"), finest("stress:bad_short")];
  expect(partHash(files[1]!.bytes.subarray(hash.at, hash.at + hash.parts[0]!.bytes))).not.toBe(hash.parts[0]!.hash);
  expect(range.at).toBeGreaterThanOrEqual(real);
  expect([short.at < real, short.at + short.parts[0]!.bytes > real]).toEqual([true, true]);
  // Every other level is where the manifest says, with the hash it says.
  for (const m of manifest.meshes) {
    m.levels.forEach((level, l) => {
      if (l === 0 && m.id.startsWith("stress:bad_")) return;
      expect(partHash(files[level.file]!.bytes.subarray(level.at, level.at + level.parts[0]!.bytes))).toBe(level.parts[0]!.hash);
    });
  }
});
