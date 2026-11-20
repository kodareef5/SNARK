// Fits the Rex's hit capsules to its built skin and writes them to ref/zones.json, which asset.ts gives outright.
//   bun assets/source/core/creatures/rex2/ref/zones.ts
//
// The build's own fit (tools/pack/creature.ts fitCapsule) pulls each end in by 0.6 of the radius. On the Rex's short,
// wide trunk, neck and shoulder bones that leaves no length, so they became spheres up to 1.3 m across that stand well
// clear of the skin. Here each capsule runs along the line to the next joint (or, at the end of a chain, along the
// longest spread of its vertices), its radius holds RADIUS_SHARE of them, and its ends come in by only a third of the
// radius. Run it after the first build, and build again.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../../../../../shared/pack/pack.ts";
import type { ZoneName } from "../../../../../../tools/art/spec.ts";
import { unpackMeshes } from "../../../../../../tools/pack/write.ts";

const HERE = import.meta.dir;
const RADIUS_SHARE = 0.65;
const END_IN = 1 / 3;

// Each capsule: its zone, the bone that carries it, and the bones whose skin it covers.
// `share` is how much of the skin the radius holds, where it isn't RADIUS_SHARE: the head and feet are held fuller.
type Want = { zone: ZoneName; on: string; covers: string[]; to?: string; share?: number };
const wants: Want[] = [
  { zone: "torso", on: "pelvis", covers: ["pelvis"], to: "spine" },
  { zone: "torso", on: "spine", covers: ["spine"], to: "chest" },
  { zone: "torso", on: "chest", covers: ["chest"], to: "neck_1" },
  { zone: "torso", on: "neck_1", covers: ["neck_1"], to: "neck_2" },
  { zone: "torso", on: "neck_2", covers: ["neck_2"], to: "skull" },
  { zone: "head", on: "skull", covers: ["skull"], share: 0.85 },
  { zone: "head", on: "jaw", covers: ["jaw"], share: 0.85 },
  ...[1, 2, 3, 4].map((i): Want => ({ zone: "torso", on: `tail_${i}`, covers: [`tail_${i}`], to: `tail_${i + 1}` })),
  { zone: "torso", on: "tail_5", covers: ["tail_5", "tail_6"] },
  ...(["l", "r"] as const).flatMap((s): Want[] => {
    const side = s === "l" ? "L" : "R";
    return [
      { zone: `leg${side}`, on: `thigh_${s}`, covers: [`thigh_${s}`], to: `shank_${s}` },
      { zone: `leg${side}`, on: `shank_${s}`, covers: [`shank_${s}`], to: `metatarsus_${s}` },
      { zone: `leg${side}`, on: `metatarsus_${s}`, covers: [`metatarsus_${s}`], to: `toes_${s}` },
      { zone: `foot${side}`, on: `toes_${s}`, covers: [`toes_${s}`], share: 0.8 },
      { zone: `arm${side}`, on: `humerus_${s}`, covers: [`humerus_${s}`], to: `forearm_${s}` },
      { zone: `hand${side}`, on: `forearm_${s}`, covers: [`forearm_${s}`] },
    ];
  }),
];

const pack = parsePack(readFileSync(join(HERE, "../rex2.snpk")));
const rig = pack.header.rigs.find((r) => r.id === "core:rex2")!;
const lod = unpackMeshes(pack).find((m) => m.id === "core:rex2")!.lods[0]!;
const names = rig.names!;
const pos = lod.positions;
const count = pos.length / 3;
// Each vertex's strongest bone.
const owner = new Int32Array(count);
for (let v = 0; v < count; v++) {
  let best = 0;
  for (let k = 1; k < 4; k++) if (lod.weights![v * 4 + k]! > lod.weights![v * 4 + best]!) best = k;
  owner[v] = lod.joints![v * 4 + best]!;
}
const percentile = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

const out = wants.map((w) => {
  const bones = new Set(w.covers.map((n) => names.indexOf(n)));
  const verts: number[] = [];
  for (let v = 0; v < count; v++) if (bones.has(owner[v]!)) verts.push(v);
  const mid = [0, 1, 2].map((k) => verts.reduce((s, v) => s + pos[v * 3 + k]!, 0) / verts.length);
  // Along the line to the next joint where there is one, which keeps neighbouring zones apart; otherwise along the
  // longest axis of the skin's spread, found by repeated multiplication.
  const spread = [0, 1, 2].map((i) => [0, 1, 2].map((j) => verts.reduce((s, v) => s + (pos[v * 3 + i]! - mid[i]!) * (pos[v * 3 + j]! - mid[j]!), 0)));
  let d = [0.31, 0.47, 0.83];
  for (let k = 0; k < 64; k++) {
    const n = [0, 1, 2].map((i) => spread[i]![0]! * d[0]! + spread[i]![1]! * d[1]! + spread[i]![2]! * d[2]!);
    const l = Math.hypot(...n);
    d = n.map((c) => c / l);
  }
  if (w.to) {
    const a = names.indexOf(w.on), b = names.indexOf(w.to);
    const line = [0, 1, 2].map((k) => rig.rest[b * 3 + k]! - rig.rest[a * 3 + k]!);
    const l = Math.hypot(...line);
    d = line.map((c) => c / l);
  }
  const along: number[] = [];
  const away: number[] = [];
  for (const v of verts) {
    const r = [0, 1, 2].map((k) => pos[v * 3 + k]! - mid[k]!);
    const t = r[0]! * d[0]! + r[1]! * d[1]! + r[2]! * d[2]!;
    along.push(t);
    away.push(Math.hypot(r[0]! - t * d[0]!, r[1]! - t * d[1]!, r[2]! - t * d[2]!));
  }
  const radius = percentile(away, w.share ?? RADIUS_SHARE);
  let t0 = percentile(along, 0.03) + radius * END_IN;
  let t1 = percentile(along, 0.97) - radius * END_IN;
  if (t1 < t0) t0 = t1 = (t0 + t1) / 2;
  const joint = names.indexOf(w.on);
  const at = (t: number) => [0, 1, 2].map((k) => +(mid[k]! + d[k]! * t - rig.rest[joint * 3 + k]!).toFixed(3));
  console.log(`${w.on.padEnd(13)} length ${(t1 - t0).toFixed(2)} m  radius ${radius.toFixed(2)} m  (${verts.length} vertices)`);
  return { zone: w.zone, on: w.on, a: at(t0), b: at(t1), radius: +radius.toFixed(3), covers: w.covers };
});
writeFileSync(join(HERE, "zones.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${join(HERE, "zones.json")}`);
