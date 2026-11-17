import { expect, test } from "bun:test";
import { Assets } from "../../client/core/assets/assets.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { CRUISE } from "../../content/landmarks/cruise.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { KORU } from "../../content/landmarks/koru.ts";
import type { Def } from "../../shared/content/defs.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import { farMeshId, landmarkFars } from "../../shared/pack/far.ts";
import { joinLandmark, joinPacks } from "../../shared/pack/join.ts";
import { describePack, type Manifest } from "../../shared/pack/manifest.ts";
import { lodVertices, parsePack, readIndices, VERTEX_BYTES, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { HALF_SIDE } from "../../shared/world/frame.ts";
import { landmarkPoint, placeLandmark, type Landmark } from "../../shared/world/landmark.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { landmarksOf, placeLandmarks } from "../../tools/mapworld/landmarks.ts";
import { hilbert, landmarkArt, landmarkPack, mergeFar } from "../../tools/pack/far.ts";
import { orderPack } from "../../tools/pack/order.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { boxMesh, buildPack, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";

/** `n` boxes of side 1 in a row along x, each of 12 triangles, in one colour. */
function boxes(n: number, color: number, error?: number): SourceLod {
  const parts = Array.from({ length: n }, () => boxMesh([0.5, 0.5, 0.5], color));
  const positions = new Float32Array(n * 72), indices = new Uint32Array(n * 36);
  parts.forEach((b, k) => {
    for (let v = 0; v < 24; v++) positions.set([b.positions[v * 3]! + k * 1.5, b.positions[v * 3 + 1]!, b.positions[v * 3 + 2]!], (k * 24 + v) * 3);
    indices.set(b.indices.map((i) => i + k * 24), k * 36);
  });
  return { positions, colors: new Uint8Array(n * 24).fill(color), indices, ...(error === undefined ? {} : { error }) };
}

const MESHES: SourceMesh[] = [
  // Its coarsest within 6 cm is its second level, within 13 cm its third.
  { id: "t:a", lods: [boxes(4, 5), boxes(3, REGION_BASE, 0.05), boxes(2, REGION_BASE + 1, 0.1), boxes(1, 5, 0.2)] },
  // None but its finest errs 13 cm or less.
  { id: "t:b", lods: [boxes(2, 6), boxes(1, 6, 0.3)] },
];
const structure = (id: string, mesh: string, more: object = {}): Def => ({ type: "structure", class: "static", id, mesh, color: 7, half: [1, 1, 1], hp: 10, ...more }) as unknown as Def;
const LANDMARK: Landmark = {
  name: "t",
  defs: [
    structure("t:a_kind", "t:a"),
    structure("t:b_kind", "t:b"),
    structure("t:door", "t:a", { opens: "t:door_open" }),
    structure("t:hidden", "none"),
    structure("t:moving", "t:b", { motion: { seconds: 1, parts: [], say: ["a", "b"] } }),
    structure("t:boxy", "box"),
  ],
  pieces: [
    { kind: "t:a_kind", at: [0, 0, 0], yaw: 0 },
    { kind: "t:b_kind", at: [20, 3, 0], yaw: 16384 },
    { kind: "t:door", at: [4, 0, 4], yaw: 0 },
    { kind: "t:a_kind", at: [0, 0, 40], yaw: 9000 },
    { kind: "t:hidden", at: [8, 0, 8], yaw: 0 },
    { kind: "t:moving", at: [12, 0, 8], yaw: 0 },
    { kind: "t:a_kind", at: [0, 4, 0], yaw: 0 },
    { kind: "t:boxy", at: [16, 0, 8], yaw: 0 },
    { kind: "core:thing", at: [16, 0, 16], yaw: 0 },
  ],
  vehicles: [],
  ground: [],
};

/** The landmark's files as a build makes them: its pack ordered and split, and its manifest. */
function built(l: Landmark = LANDMARK, meshes: SourceMesh[] = MESHES): { bytes: Uint8Array; ordered: Uint8Array; manifest: Manifest; boot: Pack; files: Uint8Array[] } {
  const far = mergeFar(l, meshes)!;
  const bytes = buildPack([...meshes, far.mesh], defaultPalette(), [], [], null, [far.row]);
  const ordered = orderPack(bytes);
  const split = splitPack(ordered, l.name);
  return { bytes, ordered, manifest: split.manifest, boot: parsePack(split.files[split.manifest.boot]!.bytes), files: split.files.map((f) => f.bytes) };
}

/** Each triangle of a level of a pack's mesh, its corners' places to the centimetre, by the piece whose run holds it. */
function trianglesByPiece(pack: Pack, mesh: string, level: number, first: Uint32Array, count: Uint32Array): string[][] {
  const m = pack.header.meshes[pack.meshIndex.get(mesh)!]!, lod = m.lods[level]!;
  const verts = lodVertices(pack, lod), view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength), indices = readIndices(pack, lod);
  const at = (v: number): string => [0, 1, 2].map((a) => Math.round((m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]!) * 100)).join(",");
  return Array.from(first, (f, p) => {
    const out: string[] = [];
    for (let i = f; i < f + count[p]!; i += 3) out.push(`${at(indices[i]!)} ${at(indices[i + 1]!)} ${at(indices[i + 2]!)}`);
    return out.sort();
  });
}

test("a landmark's far mesh holds each piece it draws at its coarsest level within 6 cm and within 13 cm, turned and set where it stands", () => {
  const far = mergeFar(LANDMARK, MESHES)!;
  // Not the door, which opens, nor what is drawn as nothing or moves; and it says which kinds are drawn some other way.
  expect(far.otherwise).toEqual(["core:thing", "t:boxy"]);
  const order = Array.from({ length: far.row.pieces.length / 4 }, (_, p) => LANDMARK.pieces.findIndex((x) => x.at.every((v, a) => v === far.row.pieces[p * 4 + a])));
  expect([...order].sort()).toEqual([0, 1, 3, 6]);
  // A piece and the one above it are next to each other, the lower first.
  expect(order.indexOf(6) - order.indexOf(0)).toBe(1);
  // The second and third levels of t:a, and t:b's finest at both.
  const chosen = { "t:a": [1, 2], "t:b": [0, 0] } as const;
  const meshOf = (k: number) => (LANDMARK.pieces[k]!.kind === "t:b_kind" ? "t:b" : "t:a");
  expect(far.row.counts as number[][]).toEqual([0, 1].map((l) => order.map((k) => MESHES.find((m) => m.id === meshOf(k))!.lods[chosen[meshOf(k)][l]!]!.indices.length)));
  far.mesh.lods.forEach((lod, l) => {
    let first = 0, base = 0;
    order.forEach((k, p) => {
      const piece = LANDMARK.pieces[k]!, src = MESHES.find((m) => m.id === meshOf(k))!.lods[chosen[meshOf(k)][l]!]!;
      const a = (piece.yaw / 65536) * TAU, c = detCos(a), s = detSin(a);
      for (let v = 0; v < src.positions.length / 3; v++) {
        const [x, y, z] = [src.positions[v * 3]!, src.positions[v * 3 + 1]!, src.positions[v * 3 + 2]!];
        expect([lod.positions[(base + v) * 3]!, lod.positions[(base + v) * 3 + 1]!, lod.positions[(base + v) * 3 + 2]!].map((n, i) => n - [piece.at[0] + c * x + s * z, piece.at[1] + y, piece.at[2] + c * z - s * x][i]!).every((d) => Math.abs(d) < 1e-4)).toBe(true);
        // The first region is drawn in its kind's colour and the rest in none, as a static's are.
        expect(lod.colors[base + v]).toBe(src.colors[v] === REGION_BASE ? 7 : src.colors[v] === REGION_BASE + 1 ? 0 : src.colors[v]);
      }
      expect(Array.from(lod.indices.subarray(first, first + far.row.counts[l]![p]!))).toEqual(Array.from(src.indices, (i) => i + base));
      first += far.row.counts[l]![p]!;
      base += src.positions.length / 3;
      // Its radius about where it stands holds it.
      expect(far.row.pieces[p * 4 + 3]!).toBeGreaterThanOrEqual(Math.max(...Array.from({ length: src.positions.length / 3 }, (_, v) => Math.hypot(src.positions[v * 3]!, src.positions[v * 3 + 1]!, src.positions[v * 3 + 2]!))));
    });
    expect(first).toBe(lod.indices.length);
  });
  // A landmark that draws none of its pack has none.
  expect(mergeFar({ ...LANDMARK, pieces: LANDMARK.pieces.filter((p) => p.kind !== "t:a_kind" && p.kind !== "t:b_kind") }, MESHES)).toBeNull();
});

test("its pieces are runs of each level that cover it once ordered for the cache and split, its levels streamed and none in the boot file, the same bytes each time", () => {
  const { bytes, ordered, manifest, boot } = built();
  expect(built().ordered).toEqual(ordered);
  const [far] = landmarkFars(manifest);
  const mesh = manifest.meshes[far!.mesh]!;
  expect([far!.name, mesh.id, far!.pieces, mesh.levels.map((l) => l.error)]).toEqual(["t", "t:far", 4, [0, 0.13]]);
  expect(mesh.levels.map((l) => manifest.files[l.file]!.role)).toEqual(["mesh", "mesh"]);
  expect(boot.meshIndex.has("t:far")).toBe(false);
  for (const l of [0, 1] as const) {
    // Every index is in exactly one piece's run, and the runs follow one another over the whole level.
    expect(far!.first[l][0]).toBe(0);
    for (let p = 1; p < far!.pieces; p++) expect(far!.first[l][p]).toBe(far!.first[l][p - 1]! + far!.count[l][p - 1]!);
    expect(far!.first[l][far!.pieces - 1]! + far!.count[l][far!.pieces - 1]!).toBe(mesh.levels[l]!.tris * 3);
    // Ordering moved triangles only within their own piece's run.
    expect(trianglesByPiece(parsePack(ordered), "t:far", l, far!.first[l], far!.count[l])).toEqual(trianglesByPiece(parsePack(bytes), "t:far", l, far!.first[l], far!.count[l]));
  }
  // So too where pieces share vertices, which the order for the cache would otherwise take from one to the next: four
  // rows of boxes from one place, turned a quarter apart, all through the box there.
  const star = built({ ...LANDMARK, pieces: [0, 16384, 32768, 49152].map((yaw) => ({ kind: "t:a_kind", at: [0, 0, 0], yaw })) });
  const [rows] = landmarkFars(star.manifest);
  for (const l of [0, 1] as const) expect(trianglesByPiece(parsePack(star.ordered), "t:far", l, rows!.first[l], rows!.count[l])).toEqual(trianglesByPiece(parsePack(star.bytes), "t:far", l, rows!.first[l], rows!.count[l]));
});

test("a landmark's far row joins with its pack and its manifest, and the draw side finds its mesh in what it joined", () => {
  const core = splitPack(buildPack([{ id: "core:a", lods: [boxMesh([1, 1, 1], 3)] }, { id: "core:b", lods: [boxMesh([2, 2, 2], 3)] }], defaultPalette()), "core");
  const u: Landmark = { ...LANDMARK, name: "u", defs: LANDMARK.defs.map((d) => ({ ...d, id: d.id.replace("t:", "u:"), ...("mesh" in d && d.mesh.startsWith("t:") ? { mesh: d.mesh.replace("t:", "u:") } : {}) }) as Def), pieces: LANDMARK.pieces.map((p) => ({ ...p, kind: p.kind.replace("t:", "u:") })) };
  const [t, uu] = [built(), built(u, MESHES.map((m) => ({ ...m, id: m.id.replace("t:", "u:") })))];
  let joined = { manifest: core.manifest, boot: parsePack(core.files[core.manifest.boot]!.bytes) };
  for (const more of [t, uu]) joined = joinLandmark(joined, { manifest: more.manifest, boot: more.boot }, "landmarks");
  const fars = landmarkFars(joined.manifest);
  expect(fars.map((f) => [f.name, joined.manifest.meshes[f.mesh]!.id, f.pieces])).toEqual([["t", "t:far", 4], ["u", "u:far", 4]]);
  expect(fars.map((f) => f.mesh)).toEqual(["t:far", "u:far"].map((id) => joined.manifest.meshes.findIndex((m) => m.id === id)));
  expect(Array.from(fars[1]!.count[0])).toEqual(Array.from(landmarkFars(uu.manifest)[0]!.count[0]));
  // A whole pack joined carries it too, and a manifest described from it.
  const whole = joinPacks(joinPacks(parsePack(buildPack([{ id: "core:a", lods: [boxMesh([1, 1, 1], 3)] }], defaultPalette())), parsePack(t.ordered)), parsePack(uu.ordered));
  expect(landmarkFars(describePack(whole, { name: "", bytes: 0 })).map((f) => [f.name, whole.header.meshes[f.mesh]!.id])).toEqual([["t", "t:far"], ["u", "u:far"]]);
  // A row that does not cover its mesh is refused.
  const wrong = structuredClone(t.manifest);
  wrong.landmarks![0]!.counts[1]![0]! += 3;
  expect(() => landmarkFars(wrong)).toThrow("do not cover");
  // A client that joined it has neither level until it asks, and then each comes from the landmark's mesh file.
  const files = [...core.files.map((f) => f.bytes), ...[t, uu].flatMap((more) => more.files.filter((_, i) => i !== more.manifest.boot))];
  const port = new FakeNet(files), assets = new Assets(compileContent([]).registry!, joined.boot, joined.manifest, port), packet = new FramePacket();
  const mesh = fars[0]!.mesh;
  expect([assets.level(mesh, 1), assets.level(mesh, 0)]).toEqual([-1, -1]);
  for (let frame = 0, now = 0; frame < 30; frame++) {
    now += 1000 / 60;
    port.advance(now);
    packet.beginFrame();
    assets.begin(now, 669, 1.2217);
    assets.want(mesh, 1, 1);
    assets.want(mesh, 0, 1);
    assets.end(packet, now);
  }
  expect([assets.level(mesh, 1), assets.level(mesh, 0)]).toEqual([1, 0]);
});

test("a map records each landmark's origin and yaw as it was placed, so a client sets its pieces where the statics stand", () => {
  const l: Landmark = { name: "t", defs: [], pieces: [{ kind: "core:foundation_wood", at: [3.3, 1, 70.7], yaw: 0 }, { kind: "core:foundation_wood", at: [-50.1, 0, -1.9], yaw: 123 }], vehicles: [], ground: [] };
  const one = placeLandmark(l, 120.123456789, 3.0625, 130.987654321, 40001), two = placeLandmark({ ...l, name: "v" }, 60.5, 0, 70.25, 5);
  expect(one.placed).toEqual({ name: "t", x: 120.123456789, y: 3.0625, z: 130.987654321, yaw: 40001 });
  const bytes = writeMap(flatMap(4, { statics: [...one.statics, ...two.statics], content: { landmarks: [one.placed, two.placed], defs: [] } }));
  const map = parseMap(bytes);
  expect(map.content!.landmarks).toEqual([one.placed, two.placed]);
  const p = [0, 0, 0], s = map.statics;
  const placed = map.content!.landmarks.flatMap((site) => l.pieces.map((piece) => {
    landmarkPoint(site.x, site.y, site.z, site.yaw, piece.at, p);
    return [...p.map((v) => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS), (site.yaw + piece.yaw) & 65535].join(",");
  }));
  expect(placed.sort()).toEqual(Array.from(s.x, (x, i) => [x, s.y[i], s.z[i], s.yaw[i]].join(",")).sort());
  for (const bad of [{ yaw: 65536 }, { yaw: 1.5 }, { x: NaN }]) expect(() => writeMap(flatMap(4, { content: { landmarks: [{ ...one.placed, ...bad }], defs: [] } }))).toThrow("set down");
  // A map build records each where its world.json sets it, as it placed it.
  const sited = landmarksOf([{ name: KORU.name, at: [10.25, 20.5], yaw: 30 }, { name: CRUISE.name, at: [100, 200], y: 1.5, yaw: 271.3 }], (lon, lat) => [lon, lat], 4096);
  const map2 = placeLandmarks(sited, compileContent([]).registry!, 0.25);
  expect(map2.content.landmarks).toEqual([placeLandmark(KORU, 4075.5, 0.25, 4055, 5461).placed, placeLandmark(CRUISE, 3896, 1.5, 3696, 49389).placed]);
});

test("a Hilbert curve visits each square once, each from one beside it", () => {
  const n = 16, seen = new Map<number, [number, number]>();
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) seen.set(hilbert(n, x, z), [x, z]);
  expect([...seen.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: n * n }, (_, d) => d));
  for (let d = 1; d < n * n; d++) expect(Math.abs(seen.get(d)![0] - seen.get(d - 1)![0]) + Math.abs(seen.get(d)![1] - seen.get(d - 1)![1])).toBe(1);
});

artTest("the cruise ship's far mesh is its 475 cells at 112,964 and 48,898 triangles, in few runs of the chunks a client does not hold, near its statics at any yaw", () => {
  const art = landmarkArt(CRUISE), pack = parsePack(landmarkPack(art));
  const [far] = landmarkFars(describePack(pack, { name: "", bytes: 0 }));
  expect([far!.name, far!.pieces, pack.header.meshes[far!.mesh]!.lods.map((l) => l.indexCount / 3), art.far!.otherwise]).toEqual(["cruise", 475, [112964, 48898], []]);
  // The pieces it draws are the cells, each once.
  const defs = new Map(CRUISE.defs.map((d) => [d.id, d]));
  const cells = CRUISE.pieces.filter((p) => /:cell_\d+$/.test((defs.get(p.kind) as { mesh: string }).mesh));
  expect(Array.from({ length: far!.pieces }, (_, p) => Array.from(far!.at.subarray(p * 3, p * 3 + 3)).join(",")).sort()).toEqual(cells.map((p) => p.at.join(",")).sort());
  const origin = [2048.3, 0.25, 2047.7] as const, p = [0, 0, 0];
  let most = 0, runs = 0, cases = 0, worst = 0;
  for (const yaw of [0, 1, 3000, 9123, 16384, 20000, 40000, 50000, 61000]) {
    // Where its plain turn sets each piece, against the static the lattice frame stands it on.
    const { statics } = placeLandmark(CRUISE, origin[0], origin[1], origin[2], yaw);
    const a = (yaw / 65536) * TAU, c = detCos(a), s = detSin(a);
    CRUISE.pieces.forEach((piece, i) => {
      const [x, y, z] = piece.at, d = Math.hypot(origin[0] + c * x + s * z - statics[i]!.x, origin[1] + y - statics[i]!.y, origin[2] + c * z - s * x - statics[i]!.z);
      expect(d).toBeLessThanOrEqual((Math.hypot(x, z) * Math.SQRT1_2) / HALF_SIDE + Math.sqrt(3) / (2 * STRUCT_UNITS));
      most = Math.max(most, d);
    });
    // The pieces outside the chunks within three of a camera round the ship are few runs of the mesh.
    const chunk = Array.from({ length: far!.pieces }, (_, k) => {
      landmarkPoint(origin[0], origin[1], origin[2], yaw, [far!.at[k * 3]!, far!.at[k * 3 + 1]!, far!.at[k * 3 + 2]!], p);
      return [Math.floor(p[0]! / 64), Math.floor(p[2]! / 64)] as const;
    });
    for (let metres = 60; metres <= 700; metres += 80) for (let k = 0; k < 16; k++) {
      const cx = Math.floor((origin[0] + metres * Math.sin((k / 16) * TAU)) / 64), cz = Math.floor((origin[2] + metres * Math.cos((k / 16) * TAU)) / 64);
      const out = chunk.map(([x, z]) => Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 3);
      if (out.every(Boolean) || !out.some(Boolean)) continue;
      const n = out.filter((o, q) => o && !out[q - 1]).length;
      [runs, cases, worst] = [runs + n, cases + 1, Math.max(worst, n)];
    }
  }
  expect(most).toBeLessThan(0.2);
  // 11 runs at most and 3.1 on average over 449 cameras; in the order its layout lists them, some 20 on average.
  expect(worst).toBeLessThanOrEqual(12);
  expect(runs / cases).toBeLessThan(4);
});

artTest("the yacht's far mesh comes by the same code: its eight cells, without its doors or its sails", () => {
  const art = landmarkArt(KORU);
  const [far] = landmarkFars(describePack(parsePack(landmarkPack(art)), { name: "", bytes: 0 }));
  expect([far!.name, far!.pieces, Array.from(far!.count, (c) => c.reduce((a, b) => a + b, 0) / 3), art.far!.otherwise]).toEqual(["koru", 8, [4328, 1224], []]);
  expect(farMeshId(KORU.name)).toBe("koru:far");
});
