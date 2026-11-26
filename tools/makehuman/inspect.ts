// Prints what the MakeHuman mirror holds: the base mesh's parts, the rest pose, targets by group, skeleton, weights,
// proxies and bound parts, and the skins' pictures. `bun tools/makehuman/inspect.ts [--bones]`

import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { BASE_OBJ, DEFAULT_SKELETON, MAKEHUMAN, TARGETS } from "./index.ts";
import { boundCount, readBinding } from "./bind.ts";
import { bodyVertexCount, faceCount, groupVertices, readObj, triangleCount, vertexCount, type ObjMesh } from "./obj.ts";
import { jointAt, readSkeleton } from "./skeleton.ts";
import { readTarget, targetFiles } from "./target.ts";
import { influences, readWeights } from "./weights.ts";

/** Width and height from a PNG's header, without decoding it. */
export function pngSize(path: string): [number, number] {
  const head = Buffer.alloc(24);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (head.readUInt32BE(12) !== 0x49484452) throw new Error(`${path}: not a PNG`);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
}

function filesUnder(dir: string, ending: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, ending, out);
    else if (name.endsWith(ending)) out.push(p);
  }
  return out;
}

/** Degrees below horizontal of the bone from joint `a` to joint `b`: about 0 in a T-pose, about 45 in an A-pose. */
export function droop(a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!;
  const dy = b[1]! - a[1]!;
  const dz = b[2]! - a[2]!;
  return (Math.atan2(-dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

function faceGroups(m: ObjMesh): { body: number; helpers: number; joints: number } {
  let helpers = 0;
  let joints = 0;
  for (const [name, faces] of m.groups) {
    if (name.startsWith("helper-")) helpers += faces.length;
    else if (name.startsWith("joint-")) joints += faces.length;
  }
  return { body: m.groups.get("body")?.length ?? 0, helpers, joints };
}

function main(): void {
  if (!existsSync(BASE_OBJ)) {
    console.error(`No MakeHuman mirror at ${MAKEHUMAN}. Install the art: bun run media art raw-makehuman`);
    process.exit(1);
  }
  const base = readObj(BASE_OBJ);
  const body = bodyVertexCount(base);
  const helperVerts = new Set<number>();
  const jointVerts = new Set<number>();
  for (const name of base.groups.keys()) {
    const into = name.startsWith("helper-") ? helperVerts : name.startsWith("joint-") ? jointVerts : null;
    if (into) for (const v of groupVertices(base, name)) into.add(v);
  }
  const f = faceGroups(base);
  let lo = Infinity;
  let hi = -Infinity;
  for (let v = 0; v < body; v++) {
    lo = Math.min(lo, base.positions[v * 3 + 1]!);
    hi = Math.max(hi, base.positions[v * 3 + 1]!);
  }
  console.log(`base mesh ${relative(MAKEHUMAN, BASE_OBJ)}`);
  console.log(`  vertices ${vertexCount(base)}: body 0-${body - 1} (${body}), helpers ${helperVerts.size}, joint cubes ${jointVerts.size}`);
  console.log(`  faces ${faceCount(base)}: body ${f.body}, helpers ${f.helpers}, joint cubes ${f.joints}; triangles ${triangleCount(base)}`);
  console.log(`  UVs ${base.uvs.length / 2}; groups ${base.groups.size}; body height ${(hi - lo).toFixed(3)} dm`);

  const skel = readSkeleton(DEFAULT_SKELETON);
  const at = (j: string) => jointAt(skel, j, base.positions);
  const upper = (side: string) => droop(at(`upperarm01.${side}____head`), at(`lowerarm01.${side}____head`));
  const lower = (side: string) => droop(at(`lowerarm01.${side}____head`), at(`wrist.${side}____head`));
  const legs = (side: string) => droop(at(`upperleg01.${side}____head`), at(`lowerleg01.${side}____head`));
  console.log(`  rest pose: upper arms ${upper("L").toFixed(1)} and ${upper("R").toFixed(1)} degrees below horizontal, forearms ${lower("L").toFixed(1)} and ${lower("R").toFixed(1)}; thighs ${legs("L").toFixed(1)}`);

  const weightsPath = join(dirname(DEFAULT_SKELETON), skel.weightsFile);
  const w = readWeights(weightsPath);
  const inf = influences(w, skel.bones.map((b) => b.name), vertexCount(base));
  let most = 0;
  let none = 0;
  for (let v = 0; v < vertexCount(base); v++) {
    const n = inf.start[v + 1]! - inf.start[v]!;
    most = Math.max(most, n);
    if (n === 0) none++;
  }
  const roots = skel.bones.filter((b) => b.parent < 0).map((b) => b.name);
  console.log(`skeleton ${skel.name} (${skel.license}): ${skel.bones.length} bones, ${skel.joints.size} joints, root ${roots.join(" ")}`);
  console.log(`  weights ${basename(weightsPath)} (${w.license}): ${w.bones.size} bones weigh, at most ${most} on a vertex, ${none} vertices unweighted`);
  if (process.argv.includes("--bones")) console.log(`  bones: ${skel.bones.map((b) => b.name).join(" ")}`);

  const groups = targetFiles(TARGETS);
  let total = 0;
  for (const list of groups.values()) total += list.length;
  console.log(`targets ${total}: ${[...groups].map(([g, l]) => `${g} ${l.length}`).join(", ")}`);
  const largest = [...groups.values()].flat().reduce((best, p) => (statSync(p).size > statSync(best).size ? p : best));
  console.log(`  largest ${relative(TARGETS, largest)}: ${readTarget(largest).vertices.length} vertices`);

  console.log("bound meshes (vertices, faces, triangles, hidden base vertices):");
  for (const path of [...filesUnder(MAKEHUMAN, ".proxy"), ...filesUnder(MAKEHUMAN, ".mhclo")]) {
    const b = readBinding(path);
    const mesh = readObj(join(dirname(path), b.objFile));
    console.log(`  ${relative(MAKEHUMAN, path).padEnd(72)} ${String(boundCount(b)).padStart(6)} ${String(faceCount(mesh)).padStart(6)} ${String(triangleCount(mesh)).padStart(6)} ${b.deleteVerts.length}`);
  }

  console.log("pictures (width x height):");
  const sizes = new Map<string, string[]>();
  for (const png of filesUnder(MAKEHUMAN, ".png")) {
    const [wd, ht] = pngSize(png);
    const kind = /_nrm|normal/i.test(png) ? "normal" : /_spec/i.test(png) ? "specular" : "colour";
    const key = `${relative(MAKEHUMAN, png).split("/").slice(0, 2).join("/")} ${kind} ${wd}x${ht}`;
    sizes.set(key, [...(sizes.get(key) ?? []), basename(png)]);
  }
  for (const [key, list] of sizes) console.log(`  ${key}: ${list.length}`);
}

if (import.meta.main) main();
