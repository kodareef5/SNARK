// Compare the visible finest skin with native damage contacts on a five-centimetre ray grid.
// The four rotations supplement the independent side, front and rear views with oblique projections.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeBones } from "../../client/core/render/characters.ts";
import { STEGO } from "../../content/creatures/stego.ts";
import { CreatureAnim, poseCreatureOn } from "../../shared/anim/creature.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { rayZones, zoneHit } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ACT_NONE, ACT_RELOAD, ACT_SWING, ACT_HOLD, ACT_COOL } from "../../shared/sim/weapon.ts";
import { TriangleGrid } from "../pack/error.ts";
import { encodePng } from "../snap/png.ts";
import { unpackMeshes } from "../pack/write.ts";

const out = process.argv[2] ?? "var/stego-review/surface-rays.json";
const motion = process.argv.includes("--tail-motion");
const imageDir = process.argv.find(v => v.startsWith("--images="))?.slice(9);
if (imageDir) mkdirSync(imageDir, { recursive: true });
const packPath = process.argv.find(v => v.startsWith("--pack="))?.slice(7);
const bytes = readFileSync(packPath ?? "assets/source/core/creatures/stego/stego.snpk");
const compare = process.argv.find(v => v.startsWith("--compare="))?.slice(10);
const reference = compare ? parsePack(readFileSync(compare)) : undefined;
const control = reference ? buildRig(reference.header.rigs[0]!, reference.clips)! : undefined;
const pack = parsePack(bytes), rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const mesh = unpackMeshes(pack).find(m => m.id === "core:stego")!.lods[0]!;
if (control && (control.bones !== rig.bones || control.names.some((name, i) => name !== rig.names[i])))
  throw new Error("Comparing contacts requires the same skeletal joints");
const species = STEGO.find(s => s.type === "species")!;
const anim = new CreatureAnim(rig, 2.5, species.swimSpeed!, species.combat);
const state = new AnimState();
state.grounded = true; state.seed = 0;

const poses: [string, number, number, number][] = [
  ["idle", ACT_NONE, 0, 0], ["sweep", ACT_SWING, 17, 0], ["impale", ACT_RELOAD, 26, 0],
  ["heavy", ACT_NONE, 20, 2], ["sharpened", ACT_NONE, 20, 4],
];
if (motion) {
  for (const frame of [0, 7, 13, 14, 17, 21, 28, 34]) {
    poses.push(["sweep-left", ACT_SWING, frame, 0], ["sweep-right", ACT_SWING, frame, 1]);
  }
  for (const frame of [6, 16, 23, 29, 30]) poses.push(["impale-in", ACT_RELOAD, frame, 0]);
  for (const frame of [0, 50, 130]) poses.push(["impale-hold", ACT_HOLD, frame, 0]);
  for (const frame of [5, 15, 24]) poses.push(["impale-out", ACT_COOL, frame, 0]);
}
const step = .05, left = -7, width = 281, height = 90;
const surface = new Float32Array(mesh.positions.length);
const matrices = new Float32Array(rig.bones * 12);
const rows = [];
let publishedWitness: unknown;

for (const heading of [0, 22.5, 45, 67.5]) {
  const yaw = heading * Math.PI / 180;
  const cs = Math.cos(yaw), sn = Math.sin(yaw), c = Math.cos(yaw / 2), s = Math.sin(yaw / 2);
  for (const [pose, action, tick, hold] of poses) {
    state.setAction(action, hold, 0);
    poseCreatureOn(anim, state, tick, null, 0, 0, 0, 0);
    const positions = rig.solved.pos, rotations = rig.solved.rot;
    for (let b = 0; b < rig.bones; b++) {
      const x = positions[b * 3]!, z = positions[b * 3 + 2]!;
      positions[b * 3] = cs * x + sn * z; positions[b * 3 + 2] = cs * z - sn * x;
      const u = rotations[b * 4]!, v = rotations[b * 4 + 1]!, w = rotations[b * 4 + 2]!, a = rotations[b * 4 + 3]!;
      rotations.set([c * u + s * w, c * v + s * a, c * w - s * u, c * a - s * v], b * 4);
    }
    writeBones(matrices, 0, rig.solved, rig.rest, null, 0, 0, 0, 0);
    surface.fill(0);
    for (let v = 0; v < surface.length / 3; v++) {
      const x = mesh.positions[v * 3]!, y = mesh.positions[v * 3 + 1]!, z = mesh.positions[v * 3 + 2]!;
      for (let axis = 0; axis < 3; axis++) {
        for (let k = 0; k < 4; k++) {
          const i = mesh.joints![v * 4 + k]! * 12 + axis * 4;
          surface[v * 3 + axis]! += mesh.weights![v * 4 + k]! * (matrices[i]! * x + matrices[i + 1]! * y + matrices[i + 2]! * z + matrices[i + 3]!);
        }
      }
    }
    const grid = motion ? new TriangleGrid({ ...mesh, positions: surface }) : undefined;
    for (const [view, axis, sign] of [["side", 0, 1], ["front", 2, 1], ["back", 2, -1]] as const) {
      const horizontal = axis === 0 ? 2 : 0;
      const depth = new Float64Array(width * height).fill(-Infinity);
      const faces = new Int32Array(width * height).fill(-1);
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]! * 3, b = mesh.indices[i + 1]! * 3, c = mesh.indices[i + 2]! * 3;
        const ax = surface[a + horizontal]!, ay = surface[a + 1]!, bx = surface[b + horizontal]!, by = surface[b + 1]!;
        const cx = surface[c + horizontal]!, cy = surface[c + 1]!;
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-10) continue;
        const x0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - left) / step));
        const x1 = Math.min(width - 1, Math.floor((Math.max(ax, bx, cx) - left) / step));
        const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) / step));
        const y1 = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) / step));
        for (let v = y0; v <= y1; v++) for (let u = x0; u <= x1; u++) {
          const x = left + u * step, y = v * step;
          const r = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
          const s = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
          const t = 1 - r - s;
          if (Math.min(r, s, t) < -1e-8) continue;
          const distance = (r * surface[a + axis]! + s * surface[b + axis]! + t * surface[c + axis]!) * sign;
          const at = v * width + u;
          if (distance > depth[at]!) { depth[at] = distance; faces[at] = i / 3; }
        }
      }
      let drawn = 0, missed = 0, emptyRaysHit = 0;
      let lost = 0, gained = 0, tailOnly = 0, maxTailDistance = 0, worst: unknown = null;
      const imageCase = (heading === 0 && pose === "idle" && view === "side")
        || (tick === 21 && heading === 45 && pose === "sweep-left" && view === "front")
        || (tick === 21 && heading === 0 && pose === "sweep-right" && view === "side");
      const pixels = imageDir && imageCase ? new Uint8Array(width * height * 4) : undefined;
      const witnesses = [];
      for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
        const at = v * width + u;
        const origin: [number, number, number] = [0, v * step, 0], dir: [number, number, number] = [0, 0, 0];
        origin[horizontal] = left + u * step; origin[axis] = sign * 10; dir[axis] = -sign;
        const hit = rayZones(rig, rig.solved, ...origin, ...dir, 100);
        if (pixels) {
          const color = faces[at]! < 0 ? (hit ? [210, 119, 39] : [246, 247, 245])
            : hit ? [46, 79, 82] : [194, 32, 65];
          pixels.set([...color, 255], ((height - 1 - v) * width + u) * 4);
        }
        if (heading === 0 && pose === "idle" && view === "side" && u === 104 && v === 17 && grid) {
          const point = origin.map((n, k) => n + zoneHit.t * dir[k]!);
          publishedWitness = { origin, dir, visible: faces[at]! >= 0, hit: Boolean(hit),
            ...(hit ? { bone: rig.names[zoneHit.bone], point, nearest: grid.nearest(point[0]!, point[1]!, point[2]!) } : {}) };
        }
        if (faces[at]! < 0) {
          if (hit) {
            emptyRaysHit++;
            const bone = rig.names[zoneHit.bone]!;
            if (grid && (bone.startsWith("tail_") || bone.startsWith("spike_"))) {
              tailOnly++;
              const point = origin.map((v, k) => v + zoneHit.t * dir[k]!);
              const distance = grid.nearest(point[0]!, point[1]!, point[2]!);
              if (distance > maxTailDistance) { maxTailDistance = distance; worst = { bone, origin, dir, point }; }
            }
          }
        } else {
          drawn++;
          if (control) {
            const before = rayZones(control, rig.solved, ...origin, ...dir, 100);
            if (before && !hit) lost++;
            if (!before && hit) gained++;
          }
          if (!hit) { missed++; witnesses.push({ origin, direction: dir, triangle: faces[at], surfaceCoordinate: depth[at]! * sign }); }
        }
      }
      if (pixels) writeFileSync(join(imageDir!, `${pose}-${tick}-${heading}-${view}.png`), encodePng(width, height, pixels));
      rows.push({ heading, pose, tick, view, drawn, missed, emptyRaysHit, ...(motion ? { tailOnly, maxTailDistance, worst } : {}), ...(control ? { lost, gained } : {}), witnesses });
    }
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), step, left, width, height, publishedWitness, rows }, null, 2) + "\n");
