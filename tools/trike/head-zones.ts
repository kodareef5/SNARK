// Orthographic probes against the finest posed skin and the native hit zones.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeBones } from "../../client/core/render/characters.ts";
import { TRIKE } from "../../content/creatures/trike.ts";
import { CreatureAnim, poseCreatureOn } from "../../shared/anim/creature.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { AnimState, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { buildRig, type Rig } from "../../shared/anim/rigs.ts";
import { rayZones, zoneHit } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ACT_HOLD, ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import { toTriangle } from "../pack/error.ts";
import { unpackMeshes, type SourceLod } from "../pack/write.ts";
import { encodePng } from "../snap/png.ts";

const bytes = readFileSync(process.argv[2] ?? "assets/source/core/creatures/trike/trike.snpk");
const pack = parsePack(bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const mesh = unpackMeshes(pack).find(m => m.id === "core:trike")!.lods[0]!;
const species = TRIKE.find(d => d.type === "species")!;
const anim = new CreatureAnim(rig, 2.5, species.swimSpeed!, species.combat!);
const state = new AnimState();
state.grounded = true;
const head = rig.names.map(name => /skull|frill|horn|jaw/.test(name));
const spacing = .05;
// The front view preserves the reviewer's 61 x 71 camera grid. At other
// azimuths the width includes the rear silhouette and both sides of the head.
const views = [
  ...[0, 30, -45, 75, -90, 135, 180].map(yaw => ({ yaw, pitch: 0 })),
  { yaw: 22, pitch: 25 }, { yaw: -57, pitch: -18 }, { yaw: 145, pitch: 32 },
];
const poses = [
  { name: "idle", action: ACT_NONE, tick: 0 },
  { name: "primary4", action: ACT_SWING, tick: 4 },
  { name: "primary7", action: ACT_SWING, tick: 7 },
  { name: "primary10", action: ACT_SWING, tick: 10 },
  { name: "charge11", action: ACT_HOLD, tick: 11 },
  { name: "primary8", action: ACT_SWING, tick: 8 },
  { name: "torporIdle", action: ACT_NONE, tick: 95 },
];
const output = process.argv[3] ?? "var/trike-art/head-zones.json";
mkdirSync(dirname(output), { recursive: true });
const maps = process.argv[4];
if (maps) mkdirSync(maps, { recursive: true });
const palette = [[250, 250, 248], [166, 169, 164], [48, 107, 98], [232, 103, 36], [162, 37, 80], [86, 78, 162], [24, 126, 183]];

function dominantBones(lod: SourceLod): Int16Array {
  const result = new Int16Array(lod.indices.length / 3);
  const weights = new Float64Array(rig.bones);
  const order = new Set<number>();
  for (let t = 0; t < result.length; t++) {
    weights.fill(0);
    order.clear();
    for (let j = 0; j < 3; j++) {
      const at = lod.indices[t * 3 + j]! * 4;
      for (let k = 0; k < 4; k++) {
        const bone = lod.joints![at + k]!;
        weights[bone] += lod.weights![at + k]!;
        order.add(bone);
      }
    }
    let best = order.values().next().value!;
    for (const bone of order) if (weights[bone]! > weights[best]!) best = bone;
    result[t] = best;
  }
  return result;
}

function skin(lod: SourceLod, model: Rig) {
  const matrices = new Float32Array(model.bones * 12);
  writeBones(matrices, 0, model.solved, model.rest, null, 0, 0, 0, 0);
  const out = new Float32Array(lod.positions.length);
  for (let v = 0; v < out.length / 3; v++) {
    for (let a = 0; a < 3; a++) for (let k = 0; k < 4; k++) {
      const i = lod.joints![v * 4 + k]! * 12 + a * 4, p = lod.positions;
      out[v * 3 + a] += lod.weights![v * 4 + k]! * (matrices[i]! * p[v * 3]! + matrices[i + 1]! * p[v * 3 + 1]! + matrices[i + 2]! * p[v * 3 + 2]! + matrices[i + 3]!);
    }
  }
  return out;
}

/** Rasterize double-sided triangles at the ray origins using barycentric depth. */
function nearestSkin(points: Float32Array, indices: Uint32Array, angle: number, pitch: number) {
  const c = Math.cos(angle * Math.PI / 180), s = Math.sin(angle * Math.PI / 180);
  const e = Math.sin(pitch * Math.PI / 180), ce = Math.cos(pitch * Math.PI / 180);
  const xmin = angle === 0 ? -30 : -110, xmax = -xmin, ymin = angle === 0 ? 20 : pitch ? -60 : 0, ymax = pitch ? 110 : 90;
  const cols = xmax - xmin + 1, count = cols * (ymax - ymin + 1);
  const triangle = new Int32Array(count).fill(-1), depth = new Float64Array(count).fill(100);
  const screen = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    screen[i] = (c * points[i]! - s * points[i + 2]!) / spacing;
    screen[i + 1] = (ce * points[i + 1]! - e * (s * points[i]! + c * points[i + 2]!)) / spacing;
    screen[i + 2] = 10 - ce * (s * points[i]! + c * points[i + 2]!) - e * points[i + 1]!;
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, f = indices[t + 2]! * 3;
    const x1 = screen[a]!, y1 = screen[a + 1]!, x2 = screen[b]!, y2 = screen[b + 1]!, x3 = screen[f]!, y3 = screen[f + 1]!;
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(det) < 1e-9) continue;
    const left = Math.max(xmin, Math.ceil(Math.min(x1, x2, x3))), right = Math.min(xmax, Math.floor(Math.max(x1, x2, x3)));
    const bottom = Math.max(ymin, Math.ceil(Math.min(y1, y2, y3))), top = Math.min(ymax, Math.floor(Math.max(y1, y2, y3)));
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
      const u = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
      const v = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const d = u * screen[a + 2]! + v * screen[b + 2]! + (1 - u - v) * screen[f + 2]!;
      const i = (y - ymin) * cols + x - xmin;
      if (d < depth[i]!) { depth[i] = d; triangle[i] = t / 3; }
    }
  }
  return { c, s, e, ce, xmin, ymin, cols, triangle, depth };
}

const tris = dominantBones(mesh), rows = [];
const pooledDepthErrors: number[] = [];

for (const pose of poses) {
  state.out = pose.name === "torporIdle";
  state.cue = state.out ? CUE_TORPOR : 0;
  state.speed = pose.action === ACT_HOLD ? 15 : 0;
  state.setAction(pose.action, 0, 0);
  poseCreatureOn(anim, state, pose.tick, null, 0, 0, 0, 0, 1);
  const p = skin(mesh, rig);
  for (const { yaw: angle, pitch } of views) {
    const grid = nearestSkin(p, mesh.indices, angle, pitch);
    const sampledMap = maps && ((angle === 0 && (pose.name === "primary4" || pose.name === "primary10")) || (angle === 22 && pose.name === "charge11"))
      ? new Uint8Array(grid.triangle.length * 4) : null;
    let visibleHead = 0, missed = 0, wrong = 0, bodyAsHead = 0, emptyAsHead = 0;
    const depthErrors: number[] = [];
    const errors = { wrong: {} as Record<string, number>, empty: {} as Record<string, number>, body: {} as Record<string, number> };
    let deepEmpty = 0, emptyWitness: { origin: number[]; distance: number; bone: string; meshGap: number } | null = null;
    const direction = [-grid.ce * grid.s, -grid.e, -grid.ce * grid.c] as const;
    for (let i = 0; i < grid.depth.length; i++) {
      const xi = i % grid.cols + grid.xmin, yi = Math.floor(i / grid.cols) + grid.ymin, h = xi * spacing;
      const v = yi * spacing;
      const ox = h * grid.c - v * grid.e * grid.s - 10 * direction[0], oy = v * grid.ce - 10 * direction[1], oz = -h * grid.s - v * grid.e * grid.c - 10 * direction[2];
      const t = grid.triangle[i]!, bone = t < 0 ? -1 : tris[t]!, visible = bone >= 0 && head[bone];
      const zone = rayZones(rig, rig.solved, ox, oy, oz, ...direction, 100);
      if (sampledMap) {
        const color = t < 0 ? (zone === ZONE_HEAD ? 5 : 0) : visible ? (!zone ? 3 : zone === ZONE_HEAD ? 2 : 4) : zone === ZONE_HEAD ? 6 : 1;
        const pixel = (grid.triangle.length / grid.cols - 1 - Math.floor(i / grid.cols)) * grid.cols + i % grid.cols;
        sampledMap.set([...palette[color]!, 255], pixel * 4);
      }
      if (visible) {
        visibleHead++;
        if (!zone) missed++;
        else if (zone !== ZONE_HEAD) {
          wrong++;
          const key = rig.names[bone] + "/" + rig.names[zoneHit.bone];
          errors.wrong[key] = (errors.wrong[key] ?? 0) + 1;
        } else {
          const error = Math.abs(zoneHit.t - grid.depth[i]!);
          depthErrors.push(error); pooledDepthErrors.push(error);
        }
      } else if (zone === ZONE_HEAD) {
        if (t < 0) {
          emptyAsHead++;
          const key = rig.names[zoneHit.bone]!;
          errors.empty[key] = (errors.empty[key] ?? 0) + 1;
          // A two-cell ring separates deep silhouette errors from near-edge
          // misses. For those deeper samples also measure actual 3D skin gap.
          let adjacent = false;
          for (let dv = -2; dv <= 2; dv++) for (let du = -2; du <= 2; du++) {
            if (du * du + dv * dv > 4) continue;
            const col = i % grid.cols + du, at = i + dv * grid.cols + du;
            if (col >= 0 && col < grid.cols && at >= 0 && at < grid.triangle.length && grid.triangle[at]! >= 0) adjacent = true;
          }
          if (!adjacent) {
            deepEmpty++;
            const dist = zoneHit.t, x = ox + dist * direction[0], y = oy + dist * direction[1], z = oz + dist * direction[2];
            let gap = Infinity;
            for (let j = 0; j < mesh.indices.length; j += 3) gap = Math.min(gap, toTriangle(x, y, z, p, mesh.indices[j]! * 3, mesh.indices[j + 1]! * 3, mesh.indices[j + 2]! * 3));
            if (!emptyWitness || gap > emptyWitness.meshGap) emptyWitness = { origin: [ox, oy, oz], distance: dist, bone: key, meshGap: gap };
          }
        } else {
          bodyAsHead++;
          const key = rig.names[bone] + "/" + rig.names[zoneHit.bone];
          errors.body[key] = (errors.body[key] ?? 0) + 1;
        }
      }
    }
    if (sampledMap && maps) writeFileSync(join(maps, pose.name + "-" + angle + ".png"), encodePng(grid.cols, grid.triangle.length / grid.cols, sampledMap));
    depthErrors.sort((a, b) => a - b);
    rows.push({ pose: pose.name, angle, pitch, rays: grid.depth.length, visibleHead, missed, wrong, bodyAsHead, emptyAsHead, deepEmpty, emptyWitness, errors, p95HeadDepthError: depthErrors[Math.floor(depthErrors.length * .95)] });
  }
}
pooledDepthErrors.sort((a, b) => a - b);
writeFileSync(output, JSON.stringify({ pack_sha256: createHash("sha256").update(bytes).digest("hex"), spacing, p95HeadDepthError: pooledDepthErrors[Math.floor(pooledDepthErrors.length * .95)], rows }, null, 2) + "\n");
