// How far a body's skin comes through what it wears, posed as the game poses it. Each worn piece of the human bodies'
// pack is skinned with the body under it through a motion set (idle, walking, running, crouching, the strikes, held
// guns and seats) and measured two ways at the finest level, or any asked for:
//   - skin through cloth: a point of skin that a piece covers at rest (a ray out along its normal meets the piece) that
//     no longer has the piece over it and has it under it instead, by how far under;
//   - cloth in skin: a vertex of the piece that is under the skin, by how deep.
// Skin counts as drawn with a piece where it is of another slot than the piece's, or under an open head piece; the
// piece stands in for its own slot's skin otherwise, which is then counted as hidden.
//
//   bun tools/art/cloth-fit.ts [--level N] [--set cloth,hide,meridian] [--quick] [--pack FILE]

import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { joinClips, Pose } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, SLOT_HEAD, SLOT_NAMES } from "../../shared/anim/human.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { createOccupantSeat, occupantSeat, poseSeated, type OccupantSeat } from "../../shared/anim/occupant.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { SKIN_ZONE_NAMES } from "../../shared/anim/skin-zones.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { ACT_DRAW, ACT_HOLD, ACT_SWING, HOLD_BOW, HOLD_HANDS, HOLD_PICK, HOLD_PISTOL, HOLD_RIFLE, HOLD_TOOL, SWING_TICKS } from "../../shared/sim/weapon.ts";
import { smoothNormals, TriangleGrid, welded, type Nearest } from "../pack/refit.ts";
import { unpackMeshes, type SourceLod, type SourceMesh } from "../pack/write.ts";

const BODIES = new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url);
const CLIPS = new URL("../../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url);

/** How far out along its normal a point of skin looks for the piece over it, and in for one it has come through, in metres. */
const OVER = 0.05;
const UNDER = 0.03;
/**
 * Skin and cloth are compared only where they lay this near each other at rest, in metres: a hand on a thigh in a seat is
 * the pose's own contact, not a fit.
 */
const LOCAL = 0.08;

/** A pose of the motion set: its name and the solved bones. */
export interface MotionPose {
  name: string;
  solved: Solved;
}

/** The poses the game plays, solved on `rest`. `quick` takes fewer moments of each. */
export function motionSet(anim: HumanAnim, rest: Float32Array, quick = false): MotionPose[] {
  const out: MotionPose[] = [];
  const pose = new Pose(HUMAN_BONES);
  const add = (name: string): void => {
    const solved = new Solved(HUMAN_BONES);
    solve(HUMAN, pose, solved, rest, null);
    out.push({ name, solved });
  };
  const every = (from: number, to: number, step: number): number[] => {
    const list: number[] = [];
    for (let t = from; t < to; t += quick ? step * 3 : step) list.push(t);
    return list;
  };
  const standing = (name: string, set: (st: AnimState) => void, ticks: readonly number[]): void => {
    for (const tick of ticks) {
      const st = new AnimState();
      set(st);
      humanPose(anim, st, tick, pose);
      add(`${name} @${tick}`);
    }
  };
  const look = (pitch: number) => (st: AnimState): void => st.setMotion(0, 0, 0, pitch);
  standing("idle", look(0), every(0, 120, 20));
  for (const pitch of [-1.2, 1.2]) standing(`idle pitch ${pitch}`, look(pitch), [0]);
  for (const [name, speed] of [["walk", 1.8], ["run", 5.4], ["sprint", 8.4]] as const) {
    standing(name, (st) => st.setMotion(0, speed, 0, 0), every(0, 48, 4));
    if (name === "walk") standing(`${name} back`, (st) => st.setMotion(0, -speed, 0, 0), every(0, 48, 8));
  }
  standing("crouch", (st) => { st.stance = STANCE_CROUCH; st.setMotion(0, 0, 0, 0); }, every(0, 120, 30));
  standing("crouch walk", (st) => { st.stance = STANCE_CROUCH; st.setMotion(0, 1.2, 0, 0); }, every(0, 48, 6));
  standing("crouch look down", (st) => { st.stance = STANCE_CROUCH; st.setMotion(0, 0, 0, -1.2); }, [0]);
  // The strikes through their swing, and a crouched one.
  const START = 1000;
  for (const [name, hold] of [["fists", HOLD_HANDS], ["hatchet", HOLD_TOOL], ["pick", HOLD_TOOL | HOLD_PICK]] as const) {
    for (const pitch of [0, -0.7]) {
      const ticks = every(START, START + SWING_TICKS + 4, 1);
      standing(`${name} pitch ${pitch}`, (st) => { st.setMotion(0, 0, 0, pitch); st.setAction(ACT_SWING, hold, START & 0xff); }, ticks);
    }
    standing(`${name} crouched`, (st) => { st.stance = STANCE_CROUCH; st.setAction(ACT_SWING, hold, START & 0xff); }, every(START, START + SWING_TICKS, 3));
  }
  for (const [name, act, hold] of [["rifle", ACT_HOLD, HOLD_RIFLE], ["pistol", ACT_HOLD, HOLD_PISTOL], ["bow", ACT_DRAW, HOLD_BOW]] as const) {
    for (const pitch of [-1.2, 0, 1.2]) standing(`${name} pitch ${pitch}`, (st) => { st.setMotion(0, 0, 0, pitch); st.setAction(act, hold, START & 0xff); }, [START + 20]);
    standing(`${name} run`, (st) => { st.setMotion(0, 5.4, 0, 0); st.setAction(act, hold, START & 0xff); }, every(START, START + 48, 8));
  }
  // Every vehicle seat with a room, the driver's and a passenger's of each, and the boat's helm and cabin.
  const registry = compileContent(CORE_CONTENT).registry!;
  const frame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, steering: 0 };
  const seen = new Set<string>();
  for (const def of registry.vehicle) for (const seat of def?.seats ?? []) {
    const key = `${def!.id} ${seat.driver ? "driver" : "passenger"}`;
    if (seen.has(key) || (quick && seen.size >= 6)) continue;
    seen.add(key);
    const sp = { ...createOccupantSeat(), wheelAngle: 0, steer: 0 } as OccupantSeat;
    occupantSeat(def!, seat, frame, undefined, sp);
    for (const hold of [0, (HOLD_RIFLE << 3) | ACT_HOLD]) {
      const st = new AnimState();
      st.stance = STANCE_CROUCH;
      st.action = hold;
      const solved = new Solved(HUMAN_BONES);
      poseSeated(anim, st, 30, sp, rest, null, pose, solved);
      out.push({ name: `${key} ${seat.id}${hold ? " rifle" : ""}`, solved });
    }
  }
  for (const role of ["pilot", "cabin", "ride"] as const) {
    mountPose(createMountMotion(), { role, tick: 0, startTick: 0, durationTicks: 1 }, pose);
    add(`mount ${role}`);
  }
  return out;
}

/** The game's human clips: the human-clips pack's and the authored ones. */
export function humanAnim(): HumanAnim {
  const set = parsePack(new Uint8Array(readFileSync(CLIPS))).clips;
  const authored = authoredClips();
  return new HumanAnim(joinClips([set, { clips: authored, index: new Map(authored.map((c, i) => [c.id, i])), hash: 0 }]));
}

/** A level skinned by a frame's bones into `out`, three numbers a vertex. */
function skin(lod: SourceLod, m: Float32Array, out: Float64Array): void {
  const n = lod.positions.length / 3;
  for (let v = 0; v < n; v++) {
    const x = lod.positions[v * 3]!, y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
    let ox = 0, oy = 0, oz = 0;
    const four = lod.joints && lod.weights ? 4 : 1;
    for (let k = 0; k < four; k++) {
      const w = four === 4 ? lod.weights![v * 4 + k]! : 1;
      if (w === 0) continue;
      const b = (four === 4 ? lod.joints![v * 4 + k]! : lod.bones![v]!) * BONE_FLOATS;
      ox += w * (m[b]! * x + m[b + 1]! * y + m[b + 2]! * z + m[b + 3]!);
      oy += w * (m[b + 4]! * x + m[b + 5]! * y + m[b + 6]! * z + m[b + 7]!);
      oz += w * (m[b + 8]! * x + m[b + 9]! * y + m[b + 10]! * z + m[b + 11]!);
    }
    out[v * 3] = ox;
    out[v * 3 + 1] = oy;
    out[v * 3 + 2] = oz;
  }
}

/** The nearest hit of the ray from p along unit d within `reach` on the triangles of `grid` that `keep` keeps, into `hit`; tri -1 for none. `any` takes the first met. */
function ray(grid: TriangleGrid, p: readonly number[], d: readonly number[], reach: number, keep: (t: number) => boolean, hit: { t: number; tri: number }, any = false): void {
  hit.t = Infinity;
  hit.tri = -1;
  const q = grid.positions, idx = grid.indices;
  grid.along(p[0]!, p[1]!, p[2]!, d, reach, (tri) => {
    const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
    const e1x = q[b]! - q[a]!, e1y = q[b + 1]! - q[a + 1]!, e1z = q[b + 2]! - q[a + 2]!;
    const e2x = q[c]! - q[a]!, e2y = q[c + 1]! - q[a + 1]!, e2z = q[c + 2]! - q[a + 2]!;
    const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) return;
    const sx = p[0]! - q[a]!, sy = p[1]! - q[a + 1]!, sz = p[2]! - q[a + 2]!;
    const u = (sx * hx + sy * hy + sz * hz) / det;
    if (u < 0 || u > 1) return;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
    if (v < 0 || u + v > 1) return;
    const t = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (t >= 0 && t <= reach && t < hit.t && keep(tri)) {
      [hit.t, hit.tri] = [t, tri];
      return any;
    }
  });
}

/** One measure's worst: how far, in metres, in which pose, at which zone of skin, and where on the body at rest. */
export interface Worst {
  depth: number;
  pose: string;
  zone: string;
  at: number[];
}

export interface PieceFit {
  piece: string;
  level: number;
  /** Skin through the piece and the piece in the skin, where that skin is drawn with it and where it is hidden by it. */
  through: Worst;
  inSkin: Worst;
  throughHidden: Worst;
  inSkinHidden: Worst;
  /** Points of skin found covered at rest, and of those how many ever came through by more than 2 mm. */
  covered: number;
  over2mm: number;
}

const none = (): Worst => ({ depth: 0, pose: "", zone: "", at: [] });

/** The body's skin at a level: its slot meshes together, the triangles of its first material, each vertex's slot and zone. */
function bodyAt(meshes: readonly SourceMesh[], id: string, level: number): { lod: SourceLod; slot: Uint8Array; zone: Uint8Array; skinTris: Uint32Array } {
  const parts = SLOT_NAMES.map((name, slot) => ({ slot, mesh: meshes.find((m) => m.id === `${id}/${name}`) })).filter((p) => p.mesh);
  const positions: number[] = [], joints: number[] = [], weights: number[] = [], bones: number[] = [], indices: number[] = [], slot: number[] = [], zone: number[] = [];
  let skinned = true;
  for (const { slot: s, mesh } of parts) {
    const lod = mesh!.lods[Math.min(level, mesh!.lods.length - 1)]!;
    const base = positions.length / 3;
    positions.push(...lod.positions);
    bones.push(...lod.bones!);
    // A part wholly on its own bones a vertex carries no skin entries.
    if (lod.joints && lod.weights) {
      joints.push(...lod.joints);
      weights.push(...lod.weights);
    } else if (lod.normals) for (const b of lod.bones!) {
      joints.push(b, b, b, b);
      weights.push(1, 0, 0, 0);
    } else skinned = false;
    const vz = new Uint8Array(lod.positions.length / 3);
    for (let t = 0; t < lod.indices.length / 3; t++) {
      for (let k = 0; k < 3; k++) vz[lod.indices[t * 3 + k]!] = lod.zones?.[t] ?? 0;
      if ((lod.sections?.[t] ?? 0) === 0) indices.push(base + lod.indices[t * 3]!, base + lod.indices[t * 3 + 1]!, base + lod.indices[t * 3 + 2]!);
    }
    for (let v = 0; v < lod.positions.length / 3; v++) {
      slot.push(s);
      zone.push(vz[v]!);
    }
  }
  const lod: SourceLod = { positions: Float32Array.from(positions), colors: new Uint8Array(0), indices: Uint32Array.from(indices), bones: Uint8Array.from(bones) };
  if (skinned) {
    lod.joints = Uint8Array.from(joints);
    lod.weights = Float32Array.from(weights);
  }
  return { lod, slot: Uint8Array.from(slot), zone: Uint8Array.from(zone), skinTris: lod.indices };
}

export interface FitOptions {
  level?: number;
  /** The armor sets to measure; all where not given. */
  sets?: readonly string[];
  sexes?: readonly string[];
  quick?: boolean;
  pack?: Uint8Array;
}

/** Every worn piece's fit over its body through the motion set. */
export function auditClothFit(o: FitOptions = {}): PieceFit[] {
  const level = o.level ?? 0;
  const pack = parsePack(o.pack ?? new Uint8Array(readFileSync(BODIES)));
  const meshes = unpackMeshes(pack);
  const anim = humanAnim();
  const out: PieceFit[] = [];
  const m = new Float32Array(HUMAN_BONES * BONE_FLOATS);
  const hit: Nearest = { triangle: -1, x: 0, y: 0, z: 0, u: 0, v: 0, w: 0, d2: 0 };
  const rh = { t: 0, tri: -1 };
  for (const sex of o.sexes ?? ["m", "f"]) {
    const id = `core:human_${sex}`;
    const rig = pack.header.rigs.find((r) => r.id === `human_${sex}`)!;
    const rest = Float32Array.from(rig.rest);
    const poses = motionSet(anim, rest, o.quick);
    const body = bodyAt(meshes, id, level);
    const bw = welded({ positions: body.lod.positions, indices: body.skinTris });
    const nb = bw.positions.length / 3;
    // A welded point's slot and zone: its first vertex's.
    const bslot = new Uint8Array(nb), bzone = new Uint8Array(nb), first = new Int32Array(nb).fill(-1);
    for (let v = body.lod.positions.length / 3 - 1; v >= 0; v--) first[bw.of[v]!] = v;
    for (let i = 0; i < nb; i++) [bslot[i], bzone[i]] = [body.slot[first[i]!]!, body.zone[first[i]!]!];
    const posedBody = new Float64Array(body.lod.positions.length);
    const bp = new Float64Array(nb * 3), bn = new Float64Array(nb * 3);
    const pieces = meshes.filter((p) => {
      const [, set, slot] = /\/armor\/([^/]+)\/([^/]+)$/.exec(p.id) ?? [];
      return p.id.startsWith(`${id}/armor/`) && set !== undefined && SLOT_NAMES.includes(slot!) && (!o.sets || o.sets.includes(set));
    });
    // Each piece at rest: which points of skin it covers.
    const covers = new Map<string, Int32Array>();
    const restPose = (): void => {
      const solved = new Solved(HUMAN_BONES);
      solve(HUMAN, new Pose(HUMAN_BONES), solved, rest, null);
      writeBones(m, 0, solved, rest, null, 0, 0, 0, 0);
    };
    restPose();
    const centres = (p: ArrayLike<number>, idx: ArrayLike<number>): Float64Array => Float64Array.from({ length: idx.length }, (_, k) => {
      const t = Math.floor(k / 3), a = k % 3;
      return (p[idx[t * 3]! * 3 + a]! + p[idx[t * 3 + 1]! * 3 + a]! + p[idx[t * 3 + 2]! * 3 + a]!) / 3;
    });
    const bodyCentres = centres(bw.positions, bw.indices);
    const local = (c: Float64Array, t: number, p: ArrayLike<number>, i: number): boolean =>
      (c[t * 3]! - p[i * 3]!) ** 2 + (c[t * 3 + 1]! - p[i * 3 + 1]!) ** 2 + (c[t * 3 + 2]! - p[i * 3 + 2]!) ** 2 < LOCAL * LOCAL;
    const pieceCentres = new Map<string, Float64Array>();
    const posedPiece = (lod: SourceLod): { positions: Float64Array; grid: TriangleGrid; normals: Float64Array } => {
      const positions = new Float64Array(lod.positions.length);
      skin(lod, m, positions);
      const normals = new Float64Array(positions.length);
      smoothNormals(positions, lod.indices, normals);
      return { positions, grid: new TriangleGrid(positions, lod.indices, 0.02), normals };
    };
    const faceNormal = (p: ArrayLike<number>, idx: ArrayLike<number>, tri: number): number[] => {
      const a = idx[tri * 3]! * 3, b = idx[tri * 3 + 1]! * 3, c = idx[tri * 3 + 2]! * 3;
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!], w = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      return n.map((x) => x / l);
    };
    const poseBody = (): void => {
      skin(body.lod, m, posedBody);
      for (let v = 0; v < first.length; v++) for (let a = 0; a < 3; a++) bp[v * 3 + a] = posedBody[first[v]! * 3 + a]!;
      smoothNormals(bp, bw.indices, bn);
    };
    /** How far point i of skin is through the piece: 0 where the piece is over it, NaN where it is neither over nor under. */
    const through = (i: number, piece: { positions: Float64Array; grid: TriangleGrid }, idx: ArrayLike<number>, c: Float64Array): number => {
      const p = [bp[i * 3]!, bp[i * 3 + 1]!, bp[i * 3 + 2]!], n = [bn[i * 3]!, bn[i * 3 + 1]!, bn[i * 3 + 2]!];
      ray(piece.grid, p, n, OVER, (tri) => local(c, tri, bw.positions, i), rh, true);
      if (rh.tri >= 0) return 0;
      // Only a part of the piece that faces the way the skin does is one it came through.
      ray(piece.grid, p, n.map((x) => -x), UNDER, (tri) => {
        if (!local(c, tri, bw.positions, i)) return false;
        const f = faceNormal(piece.positions, idx, tri);
        return f[0]! * n[0]! + f[1]! * n[1]! + f[2]! * n[2]! > 0;
      }, rh);
      return rh.tri >= 0 ? rh.t : Number.NaN;
    };
    poseBody();
    for (const piece of pieces) {
      const lod = piece.lods[Math.min(level, piece.lods.length - 1)]!;
      const posed = posedPiece(lod);
      const c = centres(lod.positions, lod.indices);
      pieceCentres.set(piece.id, c);
      const list: number[] = [];
      for (let i = 0; i < nb; i++) if (!Number.isNaN(through(i, posed, lod.indices, c))) list.push(i);
      covers.set(piece.id, Int32Array.from(list));
    }
    const fits = new Map<string, PieceFit>();
    const ever = new Map<string, Uint8Array>();
    for (const piece of pieces) {
      fits.set(piece.id, { piece: piece.id, level, through: none(), inSkin: none(), throughHidden: none(), inSkinHidden: none(), covered: covers.get(piece.id)!.length, over2mm: 0 });
      ever.set(piece.id, new Uint8Array(nb));
    }
    for (const pose of poses) {
      writeBones(m, 0, pose.solved, rest, null, 0, 0, 0, 0);
      poseBody();
      const bodyGrid = new TriangleGrid(bp, bw.indices, 0.02);
      for (const piece of pieces) {
        const slot = SLOT_NAMES.indexOf(piece.id.split("/").at(-1)!);
        const sealed = piece.id.includes("/meridian/");
        const drawn = (s: number): boolean => s !== slot || (slot === SLOT_HEAD && !sealed);
        const lod = piece.lods[Math.min(level, piece.lods.length - 1)]!;
        const posed = posedPiece(lod);
        const fit = fits.get(piece.id)!;
        const note = (w: Worst, depth: number, i: number): void => {
          if (depth <= w.depth) return;
          w.depth = depth;
          w.pose = pose.name;
          w.zone = SKIN_ZONE_NAMES[bzone[i]!]!;
          w.at = [0, 1, 2].map((a) => Math.round(bw.positions[i * 3 + a]! * 1000) / 1000);
        };
        for (const i of covers.get(piece.id)!) {
          const d = through(i, posed, lod.indices, pieceCentres.get(piece.id)!);
          if (!(d > 0)) continue;
          note(drawn(bslot[i]!) ? fit.through : fit.throughHidden, d, i);
          if (d > 0.002) ever.get(piece.id)![i] = 1;
        }
        for (let v = 0; v < posed.positions.length / 3; v++) {
          const [x, y, z] = [posed.positions[v * 3]!, posed.positions[v * 3 + 1]!, posed.positions[v * 3 + 2]!];
          if (!bodyGrid.nearest(x, y, z, UNDER, hit, (t) => local(bodyCentres, t, lod.positions, v))) continue;
          const c = [bw.indices[hit.triangle * 3]!, bw.indices[hit.triangle * 3 + 1]!, bw.indices[hit.triangle * 3 + 2]!];
          const share = [hit.u, hit.v, hit.w];
          const nn = [0, 1, 2].map((a) => share.reduce((s, w, k) => s + w * bn[c[k]! * 3 + a]!, 0));
          const out = (x - hit.x) * nn[0]! + (y - hit.y) * nn[1]! + (z - hit.z) * nn[2]!;
          if (out >= 0) continue;
          // The skin point nearest the vertex names where.
          const i = c[share.indexOf(Math.max(...share))]!;
          note(drawn(bslot[i]!) ? fit.inSkin : fit.inSkinHidden, -out / (Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1), i);
        }
      }
    }
    for (const piece of pieces) {
      const fit = fits.get(piece.id)!;
      fit.over2mm = ever.get(piece.id)!.reduce((s, v) => s + v, 0);
      out.push(fit);
    }
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const t0 = performance.now();
  const fits = auditClothFit({ level: Number(arg("level") ?? 0), sets: arg("set")?.split(","), sexes: arg("sex")?.split(","), quick: args.includes("--quick"), pack: arg("pack") ? new Uint8Array(readFileSync(arg("pack")!)) : undefined });
  const mm = (w: Worst): string => (w.depth > 0 ? `${(w.depth * 1000).toFixed(1)} mm (${w.zone}, ${w.pose}, at ${w.at.join(",")})` : "0");
  for (const f of fits) {
    console.log(`${f.piece} level ${f.level}: covers ${f.covered} points of skin, ${f.over2mm} ever through by more than 2 mm`);
    console.log(`  drawn skin through it ${mm(f.through)}; it in drawn skin ${mm(f.inSkin)}`);
    console.log(`  hidden skin through it ${mm(f.throughHidden)}; it in hidden skin ${mm(f.inSkinHidden)}`);
  }
  console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
