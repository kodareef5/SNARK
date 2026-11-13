// Bodies with bones: poses them and queues their meshes for the frame.
//
// A body is one skeleton and several meshes, one per body slot (head, torso,
// hands, legs, feet), so that a worn piece can replace the part under it. Each
// body's bones are written once into the packet as rows that carry a vertex of
// the mesh all the way to the camera-relative world; every mesh of that body
// is then one instance that names the body's first bone.

import type { Registry } from "../../../shared/content/registry.ts";
import { Pose } from "../../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_HEAD, SLOT_NAMES } from "../../../shared/anim/human.ts";
import { HumanAnim, humanPose, type AnimState } from "../../../shared/anim/pose.ts";
import { Solved, solve } from "../../../shared/anim/skeleton.ts";
import { BODY_REACH } from "../../../shared/anim/zones.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { BONE_FLOATS, DRAW_NEAR, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_SKINNED, type FramePacket, type InstanceWriter } from "./packet.ts";

/** A body is not drawn when its origin is farther than this outside the view: no pose reaches farther from where it stands. */
export const BODY_RADIUS = BODY_REACH;

interface BodyKind {
  /** Pack mesh per body slot, -1 where there is none. */
  meshes: Int32Array;
  /** Where the joints of the body these meshes were made on rest. */
  rest: Float32Array;
  color: number;
}

export type DrawFn = (mesh: number, lod: number, first: number, count: number, flags: number) => void;

export class Characters {
  readonly anim: HumanAnim;
  /** Bodies posed this frame. */
  posed = 0;
  private readonly kinds: (BodyKind | null)[];
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);

  // Instances queued this frame, one per mesh of each body.
  private count = 0;
  private readonly mesh = new Uint16Array(MAX_SKINNED);
  private readonly firstBone = new Uint16Array(MAX_SKINNED);
  private readonly region0 = new Uint8Array(MAX_SKINNED);
  private readonly colors = new Uint8Array(MAX_SKINNED * 6);
  private readonly id = new Uint32Array(MAX_SKINNED);
  private readonly near = new Uint8Array(MAX_SKINNED);
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;

  constructor(reg: Registry, pack: Pack) {
    this.anim = new HumanAnim(pack.clips);
    this.counts = new Uint32Array(pack.header.meshes.length);
    this.cursor = new Uint32Array(pack.header.meshes.length);
    this.kinds = reg.defs.map((d) => {
      if (d?.type !== "species" || d.skeleton !== HUMAN.id) return null;
      const meshes = new Int32Array(SLOT_COUNT).fill(-1);
      let rest = HUMAN.rest;
      let any = false;
      for (let s = 0; s < SLOT_COUNT; s++) {
        const m = pack.meshIndex.get(`${d.mesh}/${SLOT_NAMES[s]}`);
        if (m === undefined) continue;
        const info = pack.header.meshes[m]!;
        if (info.skeleton !== HUMAN.id) continue;
        meshes[s] = m;
        any = true;
        if (info.rig !== undefined) rest = Float32Array.from(pack.header.rigs[info.rig]!.rest);
      }
      // Without its meshes a body is drawn as whatever the rigid path makes of it.
      return any ? { meshes, rest, color: d.color } : null;
    });
  }

  /** Whether content of this kind is drawn here rather than as a rigid mesh. */
  has(kind: number): boolean {
    return this.kinds[kind] != null;
  }

  begin(): void {
    this.count = 0;
    this.posed = 0;
  }

  /**
   * Pose one body and queue its meshes. `x, y, z` is its origin relative to the
   * camera, `yaw` its facing in radians, `tick` the moment (it may fall between
   * ticks). `colors` holds its six colour regions at `colorAt`. `own` draws it
   * in the near pass; `headless` leaves the head out, for looking out of it.
   * Returns false when the frame has no room left.
   */
  add(p: FramePacket, kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, colors: Uint8Array, colorAt: number, id: number, own: boolean, headless: boolean): boolean {
    const k = this.kinds[kind];
    if (!k || p.boneCount + HUMAN_BONES > MAX_BONES || this.count + SLOT_COUNT > MAX_SKINNED) return false;
    humanPose(this.anim, st, tick, this.pose);
    solve(HUMAN, this.pose, this.solved, k.rest);
    const first = p.boneCount;
    writeBones(p.bones, first * BONE_FLOATS, this.solved, k.rest, x, y, z, yaw);
    p.boneCount = first + HUMAN_BONES;
    this.posed++;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const m = k.meshes[s]!;
      if (m < 0 || (headless && s === SLOT_HEAD)) continue;
      const n = this.count++;
      this.mesh[n] = m;
      this.firstBone[n] = first;
      this.region0[n] = k.color;
      for (let q = 0; q < 6; q++) this.colors[n * 6 + q] = colors[colorAt + q]!;
      this.id[n] = id;
      this.near[n] = own ? 1 : 0;
    }
    return true;
  }

  /** Turn what was queued into instances and draws: the viewer's own body when `own`, everyone else otherwise. */
  flush(p: FramePacket, writer: InstanceWriter, own: boolean, draw: DrawFn): void {
    const want = own ? 1 : 0;
    const counts = this.counts.fill(0);
    let any = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      counts[this.mesh[i]!]!++;
      any++;
    }
    if (any === 0) return;
    let total = p.transientCount;
    const flags = DRAW_SKINNED | DRAW_PLAIN | (own ? DRAW_NEAR : 0);
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) draw(m, 0, total, counts[m]!, flags);
      total += counts[m]!;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      const at = this.cursor[this.mesh[i]!]!++;
      writer.setSkinned(at, this.firstBone[i]!, this.region0[i]!);
      writer.regions(at, this.colors, i * 6);
      p.transientIds[at] = this.id[i]!;
    }
    p.transientCount = total;
  }
}

/**
 * Write one body's bones at `at`: for each, three rows that take a vertex of a
 * mesh made on `rest` to where the posed, turned and placed body has it.
 */
export function writeBones(out: Float32Array, at: number, solved: Solved, rest: Float32Array, x: number, y: number, z: number, yaw: number): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rot = solved.rot;
  const pos = solved.pos;
  const bones = rot.length >> 2;
  for (let b = 0; b < bones; b++) {
    const qx = rot[b * 4]!, qy = rot[b * 4 + 1]!, qz = rot[b * 4 + 2]!, qw = rot[b * 4 + 3]!;
    // The bone's rotation as a matrix, rows r0 r1 r2.
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
    const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
    const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
    // A vertex v goes to pos + R (v - rest): translation t = pos - R rest.
    const bx = rest[b * 3]!, by = rest[b * 3 + 1]!, bz = rest[b * 3 + 2]!;
    const tx = pos[b * 3]! - (r00 * bx + r01 * by + r02 * bz);
    const ty = pos[b * 3 + 1]! - (r10 * bx + r11 * by + r12 * bz);
    const tz = pos[b * 3 + 2]! - (r20 * bx + r21 * by + r22 * bz);
    // Then the body's yaw about +Y and its place: x' = c x + s z, z' = c z - s x.
    const o = at + b * BONE_FLOATS;
    out[o] = c * r00 + s * r20;
    out[o + 1] = c * r01 + s * r21;
    out[o + 2] = c * r02 + s * r22;
    out[o + 3] = c * tx + s * tz + x;
    out[o + 4] = r10;
    out[o + 5] = r11;
    out[o + 6] = r12;
    out[o + 7] = ty + y;
    out[o + 8] = c * r20 - s * r00;
    out[o + 9] = c * r21 - s * r01;
    out[o + 10] = c * r22 - s * r02;
    out[o + 11] = c * tz - s * tx + z;
  }
}
