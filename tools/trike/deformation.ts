// Native limb-skin edge lengths, sampled in the same model space as the renderer.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync(process.argv[2] ?? "assets/source/core/creatures/trike/trike.snpk");
const pack = parsePack(bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
const rest = mesh.positions, posed = new Float32Array(rest.length), matrices = new Float32Array(rig.bones * 12);
function distance(p: Float32Array, a: number, b: number) {
  return Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!);
}
const edges = [], seen = new Set<number>();
for (let t = 0; t < mesh.indices.length; t += 3) for (let k = 0; k < 3; k++) {
  const v = mesh.indices[t + k]!, w = mesh.indices[t + (k + 1) % 3]!;
  const key = Math.min(v, w) * rest.length + Math.max(v, w);
  if (seen.has(key)) continue;
  seen.add(key);
  const a = v * 3, b = w * 3;
  const x = (rest[a]! + rest[b]!) / 2, y = (rest[a + 1]! + rest[b + 1]!) / 2, z = (rest[a + 2]! + rest[b + 2]!) / 2;
  if (Math.abs(x) < .25 || Math.abs(x) > 1.3 || y < .65 || y > 1.95) continue;
  const region = z > -.1 && z < 1.2 ? "front" : z > -2.1 && z < -.8 ? "back" : null;
  const length = distance(rest, a, b);
  // Ignore Boolean sliver edges below the 5 mm cutoff of the original diagnosis.
  if (region && length >= .005) edges.push({ region, side: x > 0 ? "l" : "r", a, b, length, triangle: t / 3 });
}
const rows = [];
for (const name of ["idle", "walk", "run", "charge", "torpor_in", "torpor_idle", "torpor_out", "death"]) {
  const clip = rig.clips.get(name)!;
  const frames = new Set(Array.from({ length: clip.frames }, (_, i) => i));
  for (const row of rig.footfalls.get(name) ?? []) for (const phase of [row.lift, row.plant]) frames.add(phase * clip.frames);
  const worst = new Map<string, { ratio: number; frame: number; triangle: number; restLength: number; posedLength: number }>();
  for (const frame of frames) {
    sampleClip(clip, frame, rig.a);
    solve(rig, rig.a, rig.solved);
    writeBones(matrices, 0, rig.solved, rig.rest, null, 0, 0, 0, 0);
    for (let i = 0; i < rest.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      let p = 0;
      for (let k = 0; k < 4; k++) {
        const influence = i / 3 * 4 + k, at = mesh.joints![influence]! * 12 + axis * 4;
        p += mesh.weights![influence]! * (matrices[at]! * rest[i]! + matrices[at + 1]! * rest[i + 1]! + matrices[at + 2]! * rest[i + 2]! + matrices[at + 3]!);
      }
      posed[i + axis] = p;
    }
    for (const e of edges) {
      const key = e.region + "_" + e.side, length = distance(posed, e.a, e.b), ratio = length / e.length;
      if (ratio > (worst.get(key)?.ratio ?? 0)) worst.set(key, { ratio, frame, triangle: e.triangle, restLength: e.length, posedLength: length });
    }
  }
  rows.push({ name, samples: frames.size, worst: Object.fromEntries(worst) });
}
const out = process.argv[3] ?? "var/trike-art/deformation.json";
mkdirSync("var/trike-art", { recursive: true });
writeFileSync(out, JSON.stringify({ pack_sha256: createHash("sha256").update(bytes).digest("hex"), edgeCount: edges.length,
  scope: "Native finest skin edges of at least 5 mm, bilaterally in the axillary and hip review volumes. All authored integer frames plus fractional touchdown and lift. Length ratio is a diagnostic of skin stretching.", rows }, null, 2) + "\n");
