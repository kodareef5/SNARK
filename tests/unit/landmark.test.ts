import { expect, test } from "bun:test";
import { KORU } from "../../content/landmarks/koru.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { landmarkGround, placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import { groundBytes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { koruMap } from "../fixtures/koru.ts";

test("a map carries its landmarks' names and definitions before its statics, so a client has them from its ground alone", () => {
  const bytes = writeMap(koruMap());
  const ground = parseMap(bytes.subarray(0, groundBytes(bytes)), false);
  expect(ground.content!.landmarks).toEqual(["koru"]);
  expect(ground.content!.defs).toEqual(JSON.parse(JSON.stringify(KORU.defs)));
  expect(ground.statics.x.length).toBe(0);
  expect(parseMap(bytes).statics.x.length).toBe(KORU.pieces.length);
});

test("a landmark is set down on the lattice and turned whole, its vehicles with it, and the ground it asks for laid round it", () => {
  const l: Landmark = {
    name: "test",
    defs: [],
    pieces: [{ kind: "test:a", at: [2, 1, 10], yaw: 0 }],
    vehicles: [{ kind: "core:boat", id: "test/boat", at: [0, 0, -20], yaw: 0 }],
    ground: [{ from: [-4, -30], to: [4, 30], y: -8, dig: true }, { from: [6, -2], to: [10, 2], y: 3 }],
  };
  const quarter = placeLandmark(l, 100, 0, 100, 16384);
  expect(quarter.statics).toEqual([{ kind: "test:a", x: 110, y: 1, z: 98, yaw: 16384 }]);
  expect([quarter.vehicles[0]!.x, quarter.vehicles[0]!.z, quarter.vehicles[0]!.yaw]).toEqual([80, 100, 16384]);
  // Turned a quarter, its x runs along the world's -z and its z along the world's x.
  expect(landmarkGround(l, 100, 0, 100, 16384, 120, 100, 2)).toBe(-8);
  expect(landmarkGround(l, 100, 0, 100, 16384, 120, 100, -20)).toBe(-20);
  expect(landmarkGround(l, 100, 0, 100, 16384, 100, 92, 1)).toBe(3);
  expect(landmarkGround(l, 100, 0, 100, 16384, 100, 60, 1)).toBe(1);
  const eased = landmarkGround(l, 100, 0, 100, 16384, 100, 82, 1);
  expect(eased > 1 && eased < 3).toBe(true);
});

test("a landmark's files join the core's after them: its meshes, materials and boot levels where the core's boot reads them", () => {
  const box = (id: string, half: number) => ({ id, lods: [boxMesh([half, half, half], 3)] });
  const core = splitPack(buildPack([box("core:a", 1), box("core:b", 2)], defaultPalette()), "core");
  const more = splitPack(buildPack([box("test:c", 3)], defaultPalette()), "test");
  const boots = [core, more].map((s) => parsePack(s.files[s.manifest.boot]!.bytes));
  const joined = joinLandmark({ manifest: core.manifest, boot: boots[0]! }, { manifest: more.manifest, boot: boots[1]! }, "landmarks");
  expect(joined.manifest.meshes.map((m) => m.id)).toEqual(["core:a", "core:b", "test:c"]);
  expect(joined.manifest.files.map((f) => f.name)).toEqual([...core.manifest.files.map((f) => f.name), ...more.manifest.files.filter((_, i) => i !== more.manifest.boot).map((f) => `landmarks/${f.name}`)]);
  // Its boot level is the core boot's, at the place in the joined blob where its bytes are.
  const level = joined.manifest.meshes[2]!.levels.at(-1)!, own = more.manifest.meshes[0]!.levels.at(-1)!;
  expect(level.file).toBe(core.manifest.boot);
  const at = level.at - joined.boot.blobAt, ownAt = own.at - boots[1]!.blobAt;
  expect(joined.boot.blob.subarray(at, at + own.parts[0]!.bytes)).toEqual(boots[1]!.blob.subarray(ownAt, ownAt + own.parts[0]!.bytes));
  expect(joined.boot.meshIndex.get("test:c")).toBe(2);
});
