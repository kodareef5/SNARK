// Fits the skeleton's hit capsules to the modelled bodies and prints rows for shared/anim/human.ts, then tabulates
// the zone drawn against the zone hit. With --check it only measures the capsules human.ts has now.

import { readFileSync } from "node:fs";
import { bodySeed } from "../client/core/render/scene.ts";
import { B_FOOT_L, B_HAND_L, B_HEAD, B_HIPS, B_LOWER_ARM_L, B_LOWER_LEG_L, B_NECK, B_SHOULDER_L, B_TOE_L, B_UPPER_ARM_L, B_UPPER_LEG_L, HUMAN, ZONE_COUNT, ZONE_NAMES } from "../shared/anim/human.ts";
import { LOOK_BYTES, LOOK_SEX, SEX_LABELS, defaultLook } from "../shared/anim/look.ts";
import { AnimState } from "../shared/anim/pose.ts";
import { rayBody, zoneOfBone } from "../shared/anim/zones.ts";
import { VERTEX_BYTES, lodVertices, parsePack } from "../shared/pack/pack.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../shared/sim/character.ts";
import { provingView } from "./snap.ts";
import { PICK_ENTITY, PICK_STRUCTURE } from "./snap/raster.ts";

/** Share of a bone's vertices its capsule's radius reaches, and the share cut from each end of its length. */
const RADIUS_SHARE = 0.88;
const END_SHARE = 0.03;

const major = (b: number): number => {
  while (b >= HUMAN.zoneBones) b = HUMAN.parent[b]!;
  return b;
};
const leftOf = (b: number): number => {
  const name = HUMAN.names[b]!;
  return name.endsWith(".R") ? HUMAN.names.indexOf(name.replace(".R", ".L")) : b;
};
const percentile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))]!;

/** The direction a bone's capsule runs: along the limb, up the neck and head, across the torso. */
function axisOf(b: number): [number, number, number] {
  if (b === B_NECK || b === B_HEAD) return [0, 1, 0];
  if (b === B_UPPER_LEG_L || b === B_LOWER_LEG_L) return [0, -1, 0];
  if (b === B_FOOT_L) {
    const d = [0, 1, 2].map((a) => HUMAN.rest[B_TOE_L * 3 + a]! - HUMAN.rest[B_FOOT_L * 3 + a]!);
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    return [0, d[1]! / l, d[2]! / l];
  }
  return [1, 0, 0];
}

function fit(): string[] {
  const pack = parsePack(new Uint8Array(readFileSync(new URL("../assets/source/core/human-bodies.snpk", import.meta.url))));
  const points: number[][] = Array.from({ length: HUMAN.zoneBones }, () => []);
  for (const m of pack.header.meshes) {
    if (m.id.includes("/hair/") || m.id.includes("/beard/")) continue;
    const verts = lodVertices(pack, m.lods[0]!);
    const view = new DataView(verts.buffer, verts.byteOffset, verts.byteLength);
    for (let v = 0; v < m.lods[0]!.vertexCount; v++) {
      const own = major(verts[v * VERTEX_BYTES + 7]!);
      const b = leftOf(own);
      const p = [0, 1, 2].map((a) => m.center[a]! + (view.getInt16(v * VERTEX_BYTES + a * 2, true) / 32767) * m.half[a]! - HUMAN.rest[own * 3 + a]!);
      if (own !== b) p[0] = -p[0]!;
      points[b]!.push(p[0]!, p[1]!, p[2]!);
      // A bone on the body's middle line is made symmetric.
      if (own === b && !HUMAN.names[b]!.endsWith(".L")) points[b]!.push(-p[0]!, p[1]!, p[2]!);
    }
  }
  const rows: string[] = [];
  for (let b = 0; b < HUMAN.zoneBones; b++) {
    if (HUMAN.names[b]!.endsWith(".R")) continue;
    const pts = points[b]!;
    const n = pts.length / 3;
    const u = axisOf(b);
    const along: number[] = [];
    const across: number[][] = [[], [], []];
    for (let i = 0; i < n; i++) {
      const t = pts[i * 3]! * u[0] + pts[i * 3 + 1]! * u[1] + pts[i * 3 + 2]! * u[2];
      along.push(t);
      for (let a = 0; a < 3; a++) across[a]!.push(pts[i * 3 + a]! - t * u[a]!);
    }
    // The axis passes through the middle of the vertices' spread, not their median. A face is modelled far more
    // finely than the back of a head and would pull the median forward.
    const mid = across.map((list) => {
      const sorted = [...list].sort((p, q) => p - q);
      return (percentile(sorted, 0.04) + percentile(sorted, 0.96)) / 2;
    });
    const radial = along.map((_, i) => Math.hypot(across[0]![i]! - mid[0]!, across[1]![i]! - mid[1]!, across[2]![i]! - mid[2]!)).sort((p, q) => p - q);
    const r = percentile(radial, RADIUS_SHARE);
    const sorted = [...along].sort((p, q) => p - q);
    let lo = percentile(sorted, END_SHARE) + r;
    let hi = percentile(sorted, 1 - END_SHARE) - r;
    if (hi < lo) lo = hi = (lo + hi) / 2;
    const a = [0, 1, 2].map((k) => +(mid[k]! + u[k]! * lo).toFixed(3) || 0);
    const e = [0, 1, 2].map((k) => +(mid[k]! + u[k]! * hi).toFixed(3) || 0);
    const cap = [...a, ...e, +r.toFixed(3)];
    for (const o of [b, ...HUMAN.names.map((name, i) => (name === HUMAN.names[b]!.replace(".L", ".R") && i !== b ? i : -1)).filter((i) => i >= 0)]) {
      const side = o === b ? 1 : -1;
      HUMAN.capA.set([cap[0]! * side || 0, cap[1]!, cap[2]!], o * 3);
      HUMAN.capB.set([cap[3]! * side || 0, cap[4]!, cap[5]!], o * 3);
      HUMAN.capR[o] = cap[6]!;
    }
    rows.push(`${HUMAN.names[b]!.replace(".L", "").padEnd(11)} [${cap.join(", ")}]`);
  }
  return rows;
}

/** Draws a body in nine motions from five sides, casts a ray through every pixel, and tabulates zone drawn against zone hit. */
function measure(sex: number): void {
  const SIZE = 128;
  const view = provingView(SIZE, SIZE);
  const { raster, remote, cam } = view;
  const anim = view.scene.characters.anim;
  remote.count = 1;
  remote.hasLook[0] = 1;
  const look = defaultLook();
  look[LOOK_SEX] = sex;
  remote.look.set(look.subarray(0, LOOK_BYTES), 0);
  const id = remote.id[0]!;
  const bx = remote.x[0]!, by = remote.y[0]!, bz = remote.z[0]!;
  const table = Array.from({ length: ZONE_COUNT }, () => new Uint32Array(ZONE_COUNT));
  let phantom = 0;
  let body = 0;
  const st = new AnimState();
  const dir = [0, 0, 0];
  const states = [[0, 0, 0, 1, 0, true], [7, 0, 0, 1, 0, true], [12, 0, 10, 1, 0, true], [7, 5, -12, 1, 0, true], [7, 8, 0, 1, 0, true], [0, 0, 0, 1, 0, false], [2, 0, 0, 1, STANCE_CROUCH, true], [1, 0, 8, 1, STANCE_PRONE, true], [4, 0, 14, 2, 0, false]] as const;
  let shot = 0;
  for (const [speed, dirTo, pitch, mode, stance, grounded] of states) {
    st.speed = speed;
    st.dir = dirTo;
    st.pitch = pitch;
    st.mode = mode;
    st.stance = stance;
    st.grounded = grounded;
    remote.anim[0] = st.pack();
    remote.flags[0] = grounded ? 1 : 0;
    st.seed = bodySeed(id);
    for (const [around, up] of [[0, 0.1], [1.4, 0.2], [3.3, 0.05], [4.6, 0.9], [0.7, -0.25]] as const) {
      const tick = shot * 7.3;
      const yawUnits = (shot * 9973) & 0xffc0;
      shot++;
      remote.tick = tick;
      remote.yaw[0] = (yawUnits / 65536) * Math.PI * 2;
      cam.x = bx + Math.sin(around) * Math.cos(up) * 4;
      cam.z = bz + Math.cos(around) * Math.cos(up) * 4;
      cam.y = by + 0.9 + Math.sin(up) * 4;
      cam.yaw = around + Math.PI;
      cam.pitch = -up;
      cam.fovY = 0.7;
      cam.aspect = 1;
      view.render();
      for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
          const at = py * SIZE + px;
          const isBody = raster.pickKind[at] === PICK_ENTITY && raster.pickId[at] === id;
          cam.ray((px + 0.5) / SIZE, (py + 0.5) / SIZE, dir);
          const hit = rayBody(anim, st, tick, bx, by, bz, yawUnits, cam.x, cam.y, cam.z, dir[0]!, dir[1]!, dir[2]!, 50);
          if (!isBody) {
            if (hit !== 0 && raster.pickKind[at] !== PICK_STRUCTURE) phantom++;
            continue;
          }
          body++;
          table[zoneOfBone(raster.pickBone[at]! - 1)]![hit]!++;
        }
      }
    }
  }
  console.log(`\n${SEX_LABELS[sex]} body: zone drawn (rows) against zone hit (columns)`);
  console.log("".padEnd(12), ZONE_NAMES.map((name) => name.replace("left ", "L ").replace("right ", "R ").padStart(7)).join(""), "   same");
  let same = 0;
  for (let z = 1; z < ZONE_COUNT; z++) {
    const row = table[z]!;
    const total = row.reduce((a, b) => a + b, 0);
    same += row[z]!;
    console.log(ZONE_NAMES[z]!.padEnd(12), [...row].map((v) => String(v).padStart(7)).join(""), "  ", ((row[z]! / total) * 100).toFixed(1) + "%");
  }
  console.log(`same zone ${((same / body) * 100).toFixed(1)}% of ${body} body pixels; hits where no body is drawn: ${phantom} (${((phantom / body) * 100).toFixed(1)}% of that)`);
}

if (import.meta.main) {
  if (!process.argv.includes("--check")) {
    console.log("Fitted capsules (left side and middle; paste into shared/anim/human.ts):");
    for (const row of fit()) console.log("  " + row);
  }
  void [B_HIPS, B_SHOULDER_L, B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L];
  measure(0);
  measure(1);
}
