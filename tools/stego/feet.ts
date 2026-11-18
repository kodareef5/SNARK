// Source sockets must witness the packed plantar skin, not an ankle or toe joint.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { toTriangle } from "../pack/error.ts";
import { unpackMeshes } from "../pack/write.ts";

const bytes = readFileSync("assets/source/core/creatures/stego/stego.snpk");
const pack = parsePack(bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const fine = unpackMeshes(pack).find(m => m.id === "core:stego")!.lods[0]!;
const rows = [];
for (const name of ["hind_foot_l", "hind_foot_r", "fore_foot_l", "fore_foot_r"]) {
  const bone = rig.names.indexOf(name);
  const footVertices = new Set<number>();
  let vertex = -1, minimum = Infinity;
  for (let v = 0; v < fine.positions.length / 3; v++) {
    let footWeight = 0;
    for (let k = 0; k < 4; k++) if (fine.joints![v * 4 + k] === bone) footWeight += fine.weights![v * 4 + k]!;
    const y = fine.positions[v * 3 + 1]!;
    if (footWeight < .999 || y >= .3) continue;
    footVertices.add(v);
    if (y < minimum) { minimum = y; vertex = v; }
  }
  if (vertex < 0) throw new Error(`No fully foot-weighted plantar skin for ${name}`);
  const surfacePoint = Array.from(fine.positions.slice(vertex * 3, vertex * 3 + 3));
  const offset = surfacePoint.map((v, axis) => v - rig.rest[bone * 3 + axis]!);
  const socket = rig.sockets.get(name)!;
  const storedOffset = [socket.x, socket.y, socket.z];
  const point = storedOffset.map((value, axis) => value + rig.rest[bone * 3 + axis]!);
  let triangle = -1, distance = Infinity;
  for (let i = 0; i < fine.indices.length; i += 3) {
    const vertices = fine.indices.subarray(i, i + 3);
    if (!vertices.every(v => footVertices.has(v) && fine.positions[v * 3 + 1]! <= minimum + .000001)) continue;
    const d = toTriangle(point[0]!, point[1]!, point[2]!, fine.positions, vertices[0]! * 3, vertices[1]! * 3, vertices[2]! * 3);
    if (d < distance) { distance = d; triangle = i / 3; }
  }
  if (triangle < 0) throw new Error(`No finished plantar triangle for ${name}`);
  rows.push({ name, vertex, candidates: footVertices.size, surfacePoint, offset, storedOffset, heightError: socket.y - offset[1]!,
    storedPoint: point, soleTriangle: triangle, distanceToPlanarSole: distance });
}
const report = {
  packSha256: createHash("sha256").update(bytes).digest("hex"),
  scope: "Rest-space actual finest packed skin, stored socket distance to the closest fully foot-weighted planar triangle and minimum foot height.",
  rows,
};
writeFileSync("var/stego-review/feet.json", JSON.stringify(report, null, 2) + "\n");
console.log(rows);
