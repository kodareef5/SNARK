/** Bounds certificate from actual packed vertices/weights and the production pose helper, including every authored LOD. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parsePack } from "../../../../../shared/pack/pack.ts";
import { unpackMeshes } from "../../../../../tools/pack/write.ts";
const root = resolve(import.meta.dir, "../../../../..");
const path = resolve(root, "content/landmarks/koru-sails.json");
const data = JSON.parse(readFileSync(path, "utf8"));
const { sailPose } = await import(pathToFileURL(process.env.KORU_SAIL_POSE_SOURCE ?? resolve(root, "client/core/render/sails.ts")).href);
const report: Record<string, unknown> = {};
for (const sail of data.sails) {
  const file = readFileSync(resolve(root, `assets/source/core/landmarks/koru_sail_${sail.id}/koru_sail_${sail.id}.snpk`));
  const pack = parsePack(file), mesh = unpackMeshes(pack)[0]!;
  const boxes = sail.bones.map(() => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (const lod of mesh.lods) for (let v = 0; v < lod.positions.length / 3; v++) {
    const owned = lod.weights ? [0, 1, 2, 3].filter(k => lod.weights![v * 4 + k]! > 0).map(k => lod.joints![v * 4 + k]!) : [lod.bones![v]!];
    for (const b of owned) for (let k = 0; k < 3; k++) {
      boxes[b]![k] = Math.min(boxes[b]![k], lod.positions[v * 3 + k]!);
      boxes[b]![k + 3] = Math.max(boxes[b]![k + 3], lod.positions[v * 3 + k]!);
    }
  }
  sail.boneBounds = boxes.map((box: number[]) => box[0] === Infinity ? [0, 0, 0, 0, 0, 0] : box.map((x, k) => k < 3 ? Math.floor((x - .0001) * 1e5) / 1e5 : Math.ceil((x + .0001) * 1e5) / 1e5));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const pose = new Float32Array(sail.bones.length * 12);
  for (let sample = 0; sample <= 1024; sample++) {
    sailPose(pose, sail, sample / 1024);
    for (let b = 0; b < boxes.length; b++) for (let c = 0; c < 8; c++) {
      const box = sail.boneBounds[b], point = [box[c & 1 ? 3 : 0], box[c & 2 ? 4 : 1], box[c & 4 ? 5 : 2]];
      const local = [0, 1, 2].map(k => pose[b * 12 + k * 4]! * point[0]! + pose[b * 12 + k * 4 + 1]! * point[1]! + pose[b * 12 + k * 4 + 2]! * point[2]! + pose[b * 12 + k * 4 + 3]!);
      for (let k = 0; k < 3; k++) {
        const value = sail.anchor[k] + sail.basis[0][k] * local[0]! + sail.basis[1][k] * local[1]! + sail.basis[2][k] * local[2]!;
        min[k] = Math.min(min[k]!, value); max[k] = Math.max(max[k]!, value);
      }
    }
  }
  // Two metres exceeds the derivative bound over half a1/1024 smoothstep interval for these≤80m folds/spars.
  const margin = 2;
  const center = min.map((v, k) => +(v / 2 + max[k]! / 2).toFixed(5));
  const radius = Math.ceil((Math.hypot(...max.map((v, k) => v - center[k]!)) + margin) * 1e5) / 1e5;
  sail.bounds = { center, radius };
  report[sail.id] = { sourceSha256: createHash("sha256").update(file).digest("hex"), boneBounds: sail.boneBounds, bounds: sail.bounds, sampledPoses: 1025, sphereMargin: margin, triangles: mesh.lods.map(l => l.indices.length / 3), errors: mesh.lods.map(l => l.error ?? 0), restBounds: { min, max } };
  console.log(sail.id, sail.bones.length, "bones; swept radius", radius);
}
writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "ref/bounds.json"), JSON.stringify(report, null, 2) + "\n");
