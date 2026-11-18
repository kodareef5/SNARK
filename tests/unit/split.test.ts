// A pack split into the file fetched at start, the file fetched a level at a time and the file of creature clips, and the meshes made to load them.
import { expect, test } from "bun:test";
import { allClips } from "../../shared/pack/clips.ts";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { lodIndices, lodVertices, parsePack } from "../../shared/pack/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { surfaceError } from "../../tools/pack/error.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { HELD_LEVEL_BYTES, PAGE_BYTES, bootManifest, splitPack } from "../../tools/pack/split.ts";
import { meshKnown, readPage } from "../../shared/pack/manifest.ts";
import { LEVEL_COLOURS, stressMeshes, stressSet } from "../../tools/pack/stress.ts";
import { NAMED_MATERIALS, paging } from "../../tools/build-client.ts";
import { BEAM_MESH, MISSING_MESH, WATER_MESH } from "../../tools/pack/build.ts";
import { FAR_MESH } from "../../client/core/render/far.ts";
import { fillSlot, slotsOf } from "../../shared/content/slots.ts";
import type { Def } from "../../shared/content/defs.ts";
import { coreRegistry } from "../fixtures/world.ts";

artTest("a split pack holds every level once, byte for byte, with the coarsest of each mesh in the boot file", () => {
  const whole = corePackBytes();
  const pack = parsePack(whole);
  const { files, manifest } = splitPack(whole, "core");
  expect(files.map((f) => [f.name, f.role])).toEqual([["core.boot.snpk", "boot"], ["core.mesh.snpk", "mesh"], ["core.clip.snpt", "clip"]]);
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  const [boot, rest] = files.slice(0, 2).map((f) => parsePack(f.bytes));
  // The boot file is a pack with the palette, every rig, and some level of every mesh.
  expect([boot!.header.meshes.length, boot!.header.rigs, [...boot!.palette]]).toEqual([pack.header.meshes.length, pack.header.rigs, [...pack.palette]]);
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
      expect(level.file).toBe(last || bytes <= HELD_LEVEL_BYTES ? 0 : 1);
      if (level.file === 1) streamed++;
    });
  });
  expect(streamed).toBeGreaterThan(40);
  // The three files together are little more than the one.
  expect(files.reduce((sum, f) => sum + f.bytes.length, 0)).toBeLessThan(whole.length * 1.06);
  expect(files[0]!.bytes.length).toBeLessThan(whole.length * 0.6);
});

artTest("paged, the boot file holds only the meshes it is told to, and every other mesh's row and smallest levels are in its page", () => {
  const whole = corePackBytes();
  const pack = parsePack(whole);
  const boot = new Set(["core:missing", "core:far", "core:human_m/torso"]);
  const group = (id: string): number => (id.includes("ruin") ? 0 : 1);
  const { files, manifest, blobs } = splitPack(whole, "core", { boot: (id) => boot.has(id), place: (id) => [group(id), 0] });
  expect(files.map((f) => f.role)).toEqual(["boot", "mesh", "clip", "page"]);
  expect(parsePack(files[0]!.bytes).header.meshes.map((m) => m.id).sort()).toEqual([...boot].sort());
  // What a client reads first names every mesh, and holds the rows of the boot file's alone, and of a material it finds
  // by name though paged meshes alone are drawn with it.
  const shared = manifest.materials!.findIndex((_, k) => manifest.meshes.some((m) => m.page !== undefined && m.levels.some((l) => l.sections?.includes(k))));
  const wire = JSON.stringify(bootManifest(manifest, (id) => id === manifest.materials![shared]!.id));
  const read = parseManifest(wire);
  expect(read.meshes.map((m) => m.id)).toEqual(pack.header.meshes.map((m) => m.id));
  expect(read.meshes.filter(meshKnown).map((m) => m.id).sort()).toEqual([...boot].sort());
  expect([read.materials![shared]!.id, read.materials!.filter((x) => x.id === "").length > 10]).toEqual([manifest.materials![shared]!.id, true]);
  expect(wire.length).toBeLessThan(JSON.stringify(manifest).length / 4);
  // A page is of one group and no more than its bytes allow, but for a mesh larger than a page alone.
  for (const [p, blob] of blobs.entries()) {
    const groups = new Set(manifest.meshes.filter((m) => m.page === p).map((m) => group(m.id)));
    expect([groups.size, blob.length <= PAGE_BYTES || manifest.meshes.filter((m) => m.page === p).length === 1]).toEqual([1, true]);
  }
  // Each page gives back the rows the whole manifest has, and holds the first parts of the levels it says.
  const pages = files[3]!.bytes;
  for (const [p, e] of manifest.pages!.entries()) {
    const bytes = pages.subarray(e.at, e.at + e.part.bytes);
    expect(partHash(bytes)).toBe(e.part.hash);
    const got = readPage(read, p, bytes);
    expect(got.blob).toEqual(blobs[p]!);
    for (const i of got.meshes) {
      expect(read.meshes[i]).toEqual(manifest.meshes[i]!);
      manifest.meshes[i]!.levels.forEach((level, l) => {
        const held = l === manifest.meshes[i]!.levels.length - 1 || level.parts[0]!.bytes <= HELD_LEVEL_BYTES;
        expect(level.file).toBe(held ? 3 : 1);
        if (held) expect(partHash(got.blob.subarray(level.at, level.at + level.parts[0]!.bytes))).toBe(level.parts[0]!.hash);
      });
    }
  }
  expect(read.meshes.every(meshKnown)).toBe(true);
  expect(read.materials).toEqual(manifest.materials!);
});

artTest("what a page waits for before its first frame holds nothing of a vehicle's or a creature's own art: no level, row, material, texture or clip of it", () => {
  const whole = corePackBytes();
  const pack = parsePack(whole), reg = coreRegistry();
  const { files, manifest } = splitPack(whole, "core", paging(reg, pack));
  const boot = parsePack(files[manifest.boot]!.bytes);
  const first = parseManifest(JSON.stringify(bootManifest(manifest, (id) => NAMED_MATERIALS.has(id))));
  // The stand-ins any definition may fall back to, which the client finds by name.
  const standIns = new Set([MISSING_MESH, WATER_MESH, BEAM_MESH, FAR_MESH]);
  const held = new Set(boot.header.meshes.map((m) => m.id));
  const heldMaterials = new Set(manifest.meshes.flatMap((m) => (held.has(m.id) ? m.levels.flatMap((l) => (l.sections ?? []).filter((_, k) => k % 3 === 0)) : [])));
  const own = (d: Def): boolean => (d.type === "species" && (d.class === "vehicle" || d.class === "creature")) || (d.type === "item" && d.class === "vehicle");
  const defs = reg.defs.filter((d): d is Def => d !== null);
  const found: string[] = [];
  let meshes = 0;
  for (const u of slotsOf(defs)) {
    const d = reg.defs[reg.index.get(u.owner)!]!;
    if (!own(d)) continue;
    const id = fillSlot(u, (asset, x) => asset === "mesh" && pack.meshIndex.has(x)).id;
    if (u.asset !== "mesh" || id === "" || standIns.has(id)) continue;
    meshes++;
    const i = pack.meshIndex.get(id)!;
    if (held.has(id)) found.push(`${d.id} ${u.slot}: ${id} has levels in the boot file`);
    if (meshKnown(first.meshes[i]!)) found.push(`${d.id} ${u.slot}: ${id} has its row in what is read first`);
    for (const l of manifest.meshes[i]!.levels) {
      for (let k = 0; k < (l.sections?.length ?? 0); k += 3) {
        const mat = l.sections![k]!;
        if (first.materials![mat]!.id !== "" && !heldMaterials.has(mat) && !NAMED_MATERIALS.has(first.materials![mat]!.id)) found.push(`${d.id} ${u.slot}: ${id} is drawn with ${first.materials![mat]!.id}, whose row is read first`);
      }
    }
  }
  for (const d of defs) if (own(d) && "skeleton" in d && d.skeleton) for (const c of boot.header.clips) if (c.id.startsWith(`${d.skeleton}/`)) found.push(`${d.id}: its clip ${c.id} is in the boot file`);
  // Every texture read first is one a held mesh's or a named material names.
  const shown = new Set(first.materials!.filter((m) => m.id !== "").flatMap((m) => [m.base, m.normal, m.mro, m.mask, m.mask2, m.layer ?? -1]));
  first.textures!.forEach((t, k) => t.id !== "" && !shown.has(k) && found.push(`texture ${t.id} is read first and no material read first names it`));
  // The vessels' wrecks are their sunk forms, which the pack does not have yet (content/vehicles/harbour-wrecks.ts).
  expect(meshes).toBeGreaterThan(30);
  expect(found).toEqual([]);
});

artTest("the boot file holds the survivor's clips, and the clip file each creature skeleton's as the whole pack had them", () => {
  const whole = corePackBytes();
  const pack = parsePack(whole);
  const { files, manifest } = splitPack(whole, "core");
  const boot = parsePack(files[0]!.bytes);
  expect([...new Set(boot.header.clips.map((c) => c.id.slice(0, c.id.indexOf("/"))))]).toEqual(["human"]);
  expect(manifest.clips!.map((e) => [e.rig, e.file, e.clips.length])).toEqual([
    ["core:dodo", 2, 21], ["core:parasaur", 2, 6], ["core:pteranodon", 2, 32], ["core:raptor", 2, 6], ["core:stego", 2, 30], ["core:trike", 2, 22],
  ]);
  for (const e of manifest.clips!) expect(partHash(files[2]!.bytes.subarray(e.at, e.at + e.part.bytes))).toBe(e.part.hash);
  // Every clip comes back as it was, and so does the hash of them all, which the manifest gives the client to send.
  const all = allClips(manifest, boot, (f) => files[f]!.bytes, () => new Uint8Array(0));
  expect([all.clips.length, all.hash, manifest.clipHash]).toEqual([pack.clips.clips.length, pack.clips.hash, pack.clips.hash]);
  for (const c of pack.clips.clips) expect(all.clips[all.index.get(c.id)!]).toEqual(c);
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
