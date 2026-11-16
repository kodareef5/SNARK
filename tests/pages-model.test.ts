import { expect, test } from "bun:test";
import { Pose } from "../shared/anim/clip.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import { modelDocument, type ModelDocument } from "../shared/pages/model.ts";
import { meshBounds, modelDistance, modelMesh, ModelPose } from "../client/core/pages/model.ts";
import { buildPack, type SourceMesh } from "../tools/pack/write.ts";
import { previewMesh } from "../tools/pages/models.ts";

const bounds = { center: [0, 1, 0] as [number, number, number], radius: 1, height: 2 };
const document = (): ModelDocument => ({ version: 1, id: "test:model", label: "Model", pack: "/media/models/abcd/model.snpk", packBytes: 100, bounds, colors: [1, 2, 3, 4, 5, 6], textures: [], clips: [] });

test("a public model graph rejects foreign files and excessive decoded textures before fetching", () => {
  expect(modelDocument(document()).id).toBe("test:model");
  for (const pack of ["https://example.org/model", "/media/models/../private", "//host/file", "/account/save.db", "/media/models/abcd/%2e%2e/model.snpk"]) expect(() => modelDocument({ ...document(), pack })).toThrow();
  expect(() => modelDocument({ ...document(), colors: [Infinity] })).toThrow();
  expect(() => modelDocument({ ...document(), textures: Array.from({ length: 8 }, (_, slot) => ({ slot, url: `/media/models/abcd/t${slot}.png`, role: "base", width: 2048, height: 2048, bytes: 100 })) })).toThrow();
});

test("native preview pose preserves root height and locks horizontal travel without changing clip samples", () => {
  const mesh: SourceMesh = { id: "test:model", skeleton: "test", rig: "test:model", lods: [{ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), colors: Uint8Array.from([1, 1, 1]), bones: new Uint8Array(3), indices: Uint32Array.from([0, 1, 2]) }] };
  const rot = new Pose(1).rot;
  const clip = { id: "test:model/jump", bones: 1, frames: 2, loop: false, rot: Float32Array.from([...rot, ...rot]), root: Float32Array.from([0, 0, 0, 8, 2, 10]) };
  const rig = { id: "test:model", skeleton: "test", names: ["root"], parent: [-1], rest: [0, 0, 0] };
  const pack = parsePack(buildPack([mesh], defaultPalette(), [clip], [rig]));
  const pose = new ModelPose(pack), decoded = modelMesh(pack, pack.header.meshes[0]!, [1, 2, 3, 4, 5, 6]);
  const before = meshBounds([decoded], pose);
  pose.sample(pack.clips.clips[0]!, 1);
  const after = meshBounds([decoded], pose);
  expect(after.center[0]).toBe(before.center[0]);
  expect(after.center[2]).toBe(before.center[2]);
  expect(after.center[1]).toBeCloseTo(before.center[1] + 2, 4);
  expect([...pack.clips.clips[0]!.root]).toEqual([0, 0, 0, 8, 2, 10]);
  expect(() => pose.sample({ ...clip, bones: 2 }, 0)).toThrow("does not match");
});

test("preview level selection retains a textured level and leaves the source unchanged", () => {
  const low = { positions: new Float32Array(9), colors: new Uint8Array(3), indices: new Uint32Array(3), error: 0.1 };
  const source: SourceMesh = { id: "test:model", flat: 1, lods: [{ ...low, indices: new Uint32Array(60000) }, low] };
  const preview = previewMesh(source);
  expect(preview.lods).toHaveLength(1);
  expect(preview.lods[0]!.indices.length).toBe(60000);
  expect(preview.flat).toBe(1);
  expect(preview.lods[0]!.error).toBe(0);
  expect(source.lods).toHaveLength(2);
  expect(source.lods[0]!.error).toBe(0.1);
});

test("camera framing fits wide wings and tall models at both desktop and phone aspect ratios", () => {
  for (const half of [[6, 0.5, 1], [0.5, 3, 0.5]] as [number, number, number][]) for (const aspect of [0.8, 2]) for (const yaw of [0, 0.6, 1.5]) {
    const pitch = 0.2, b = { center: [0, 0, 0] as [number, number, number], half, radius: Math.hypot(...half), height: half[1] * 2 };
    const d = modelDistance(b, yaw, pitch, aspect, 0.72), sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    for (let k = 0; k < 8; k++) {
      const x = half[0] * (k & 1 ? 1 : -1), y = half[1] * (k & 2 ? 1 : -1), z = half[2] * (k & 4 ? 1 : -1), depth = d - (x * sy * cp + y * sp + z * cy * cp);
      expect(Math.abs(x * cy - z * sy) / depth).toBeLessThan(Math.tan(0.36) * aspect);
      expect(Math.abs(-x * sy * sp + y * cp - z * cy * sp) / depth).toBeLessThan(Math.tan(0.36));
    }
  }
  const wide = { ...bounds, half: [6, 0.5, 1] as [number, number, number], radius: 6.2 };
  expect(modelDistance(wide, 0, 0, 2, 0.72)).toBeLessThan(modelDistance({ ...wide, half: undefined }, 0, 0, 2, 0.72) * 0.6);
});
