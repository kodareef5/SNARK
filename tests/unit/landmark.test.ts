import { expect, test } from "bun:test";
import { KORU } from "../../content/landmarks/koru.ts";
import { withLandmarks } from "../../client/core/fetched.ts";
import { compileContent, withContent } from "../../shared/content/registry.ts";
import { joinLandmark } from "../../shared/pack/join.ts";
import { meshKnown, parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { landmarkGround, placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import { groundBytes, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { bootManifest, splitPack } from "../../tools/pack/split.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { koruMap, koruPackBytes } from "../fixtures/koru.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

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

test("a client on a map with a landmark fetches its manifest and boot file, and compiles the core's content with the map's", async () => {
  const box = (id: string) => ({ id, lods: [boxMesh([1, 1, 1], 3)] });
  const core = splitPack(buildPack([box("core:a")], defaultPalette()), "core");
  const more = splitPack(buildPack([box("koru:cell_00")], defaultPalette()), "koru");
  const served: Record<string, Uint8Array | string> = { "assets/landmarks/koru.json": JSON.stringify(more.manifest) };
  for (const f of more.files) served[`assets/landmarks/${f.name}`] = f.bytes;
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    const body = served[url]!;
    return { ok: true, status: 200, body: null, text: async () => body as string, arrayBuffer: async () => (body as Uint8Array).slice().buffer };
  };
  const reg = compileContent([]).registry!;
  const shape = { type: "shape", id: "koru:a_shape", role: "thing", boxes: [{ at: [0, 0.5, 0], half: [0.5, 0.5, 0.5] }] } as const;
  const piece = { type: "structure", class: "static", id: "koru:a", mesh: "koru:cell_00", shape: shape.id, half: [0.5, 1, 0.5], color: 3, hp: 10 } as const;
  const got = await withLandmarks(get, { landmarks: ["koru"], defs: [shape, piece] }, reg, core.manifest, parsePack(core.files[core.manifest.boot]!.bytes));
  expect(asked).toEqual(["assets/landmarks/koru.json", `assets/landmarks/${more.files[more.manifest.boot]!.name}`]);
  expect([got.reg.index.has("koru:a"), got.manifest.meshes.map((m) => m.id), got.pack.meshIndex.get("koru:cell_00")]).toEqual([true, ["core:a", "koru:cell_00"], 1]);
  // A map with none asks for nothing and keeps the core's as they are.
  const bare = await withLandmarks(get, undefined, reg, core.manifest, parsePack(core.files[core.manifest.boot]!.bytes));
  expect([bare.reg, bare.manifest, asked.length]).toEqual([reg, core.manifest, 2]);
});

test("a cold core page learns beside a landmark without moving its boot geometry or warming another client", () => {
  const box = (id: string, half: number) => ({ id, lods: [boxMesh([half, half, half], 3)] });
  const core = splitPack(buildPack([box("core:page-test", 1)], defaultPalette()), "core", { boot: () => false });
  const more = splitPack(buildPack([box("test:cell", 3)], defaultPalette()), "test");
  const initial = joinLandmark({ manifest: parseManifest(JSON.stringify(bootManifest(core.manifest))), boot: parsePack(core.files[core.manifest.boot]!.bytes) },
    { manifest: more.manifest, boot: parsePack(more.files[more.manifest.boot]!.bytes) }, "landmarks");
  const files = [...core.files.map(file => file.bytes), ...more.files.filter((_, i) => i !== more.manifest.boot).map(file => file.bytes)];
  const reg = compileContent([]).registry!;
  for (let client = 0; client < 2; client++) {
    const manifest = structuredClone(initial.manifest), port = new FakeNet(files), assets = new Assets(reg, initial.boot, manifest, port);
    expect(manifest.meshes.map(meshKnown)).toEqual([false, true]);
    expect([assets.level(0, 0), assets.level(1, 0)]).toEqual([-1, 0]);
    const packet = new FramePacket();
    for (let frame = 0; frame < 12; frame++) {
      const now = frame * 1000 / 60; port.advance(now); packet.beginFrame(); assets.begin(now, 669, 1.2217);
      assets.want(0, 0, 1); assets.want(1, 0, 1); assets.end(packet, now);
    }
    expect([assets.level(0, 0), assets.level(1, 0)]).toEqual([0, 0]);
    expect(manifest.meshes.map(meshKnown)).toEqual([true, true]);
    expect(assets.table.tris.map(levels => levels[0])).toEqual([12, 12]);
    expect(assets.table.radius[1]).toBeCloseTo(Math.sqrt(27), 5);
    expect(initial.manifest.meshes.map(meshKnown)).toEqual([false, true]);
  }
});

test("Koru's levels stream from its own files joined after the core's: its coarsest drawn from the boot at once, its finest fetched", () => {
  const core = splitPack(corePackBytes(), "core");
  const more = splitPack(koruPackBytes(), "koru");
  const boots = [core, more].map((s) => parsePack(s.files[s.manifest.boot]!.bytes));
  const { manifest, boot } = joinLandmark({ manifest: core.manifest, boot: boots[0]! }, { manifest: more.manifest, boot: boots[1]! }, "landmarks");
  const files = [...core.files.map((f) => f.bytes), ...more.files.filter((_, i) => i !== more.manifest.boot).map((f) => f.bytes)];
  const port = new FakeNet(files);
  const assets = new Assets(withContent(coreRegistry(), KORU.defs), boot, manifest, port);
  const cells = manifest.meshes.flatMap((m, i) => (m.id.startsWith("koru:cell_") ? [i] : []));
  expect(cells.length).toBe(8);
  for (const mesh of cells) expect(manifest.meshes[mesh]!.levels[assets.level(mesh, 0)]!.file).toBe(manifest.boot);
  const packet = new FramePacket();
  for (let f = 0, now = 0; f < 120; f++) {
    now += 1000 / 60;
    port.advance(now);
    packet.beginFrame();
    assets.begin(now, 669, 1.2217);
    for (const mesh of cells) assets.want(mesh, 0, 5);
    assets.end(packet, now);
  }
  expect(cells.map((mesh) => assets.level(mesh, 0))).toEqual(cells.map(() => 0));
});
