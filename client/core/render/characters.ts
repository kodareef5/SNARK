// Bodies with bones: poses them and queues their meshes for the frame.
//
// A body is one skeleton and several meshes, one per body slot (head, torso,
// hands, legs, feet), so that a worn piece can replace the part under it, plus
// hair and a beard on the head. Each body's bones are written once into the
// packet as rows that carry a vertex of the mesh all the way to the
// camera-relative world; every mesh of that body is then one instance that
// names the body's first bone.
//
// A survivor's look picks the meshes (sex, hair, beard), the colours, and how
// far each bone is stretched. A body without a look is drawn as its species'
// meshes in its own six colours.

import type { Registry } from "../../../shared/content/registry.ts";
import { Pose } from "../../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_HEAD, SLOT_NAMES } from "../../../shared/anim/human.ts";
import { BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_HAIR, LOOK_SEX, REGION_MAIN, REGION_SECOND, REGION_TRIM, SEX_IDS, defaultLook, lookColors, lookLift, lookScales } from "../../../shared/anim/look.ts";
import { HumanAnim, humanPose, type AnimState } from "../../../shared/anim/pose.ts";
import { Solved, solve } from "../../../shared/anim/skeleton.ts";
import { BODY_REACH } from "../../../shared/anim/zones.ts";
import { lodVertices, type Pack } from "../../../shared/pack/pack.ts";
import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { GEAR_HELD, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { BONE_FLOATS, DRAW_NEAR, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_SKINNED, type FramePacket, type InstanceWriter } from "./packet.ts";

/** A body is not drawn when its origin is farther than this outside the view: no pose reaches farther from where it stands. */
export const BODY_RADIUS = BODY_REACH;
/** Distances at which a body drops to its second and third level of detail, metres. */
export const BODY_LOD_NEAR = 14;
export const BODY_LOD_FAR = 45;
/** Levels of detail a body mesh may have. */
const LODS = 3;
/** Meshes one body can be: its slots, hair, a beard, something on its head, and something in its hand. */
const PARTS = SLOT_COUNT + 4;
const MANNEQUIN = "core:mannequin";
const PLAIN = defaultLook();

/** One set of meshes on one rig: a sex of a species, or the whole of a species that has none. */
interface BodySet {
  /** Pack mesh per body slot, -1 where there is none. */
  slots: Int32Array;
  /** Pack mesh per hair style and per beard style, -1 for none. */
  hair: Int32Array;
  beard: Int32Array;
  /** Where the joints of the body these meshes were made on rest. */
  rest: Float32Array;
  /** Per armor set (by its place in `Characters.sets`): the pack mesh worn in each body slot, -1 where the set has none. */
  armor: Int32Array[];
}

/** What a worn item draws: which body slot, which armor set, and its three colours. */
interface Worn {
  slot: number;
  set: number;
  colors: readonly [number, number, number];
}

/** What a held item draws: its mesh and the bone it hangs on. */
interface Held {
  mesh: number;
  bone: number;
}

interface BodyKind {
  /** By sex when the species has modelled bodies; otherwise one set. */
  sets: BodySet[];
  color: number;
}

export type DrawFn = (mesh: number, lod: number, first: number, count: number, flags: number) => void;

export class Characters {
  readonly anim: HumanAnim;
  /** Bodies posed this frame. */
  posed = 0;
  private readonly kinds: (BodyKind | null)[];
  /** Per content index: what wearing or holding that item draws, or null. */
  private readonly worn: (Worn | null)[];
  private readonly held: (Held | null)[];
  private readonly wornColor = new Uint8Array(6);
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);
  private readonly scales = new Float32Array(HUMAN_BONES * 3);
  private readonly lookColor = new Uint8Array(6);

  // Instances queued this frame, one per mesh of each body.
  private count = 0;
  /** Pack mesh * LODS + level of detail. */
  private readonly key = new Uint32Array(MAX_SKINNED);
  private readonly firstBone = new Uint16Array(MAX_SKINNED);
  private readonly region0 = new Uint8Array(MAX_SKINNED);
  private readonly colors = new Uint8Array(MAX_SKINNED * 6);
  private readonly id = new Uint32Array(MAX_SKINNED);
  private readonly near = new Uint8Array(MAX_SKINNED);
  /** Added to each vertex before its bone: where the bone a held thing hangs on rests. Zero for the body's own meshes. */
  private readonly offset = new Float32Array(MAX_SKINNED * 3);
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;

  constructor(reg: Registry, pack: Pack) {
    this.anim = new HumanAnim(pack.clips);
    this.counts = new Uint32Array(pack.header.meshes.length * LODS);
    this.cursor = new Uint32Array(pack.header.meshes.length * LODS);
    const find = (id: string): number => {
      const m = pack.meshIndex.get(id);
      return m !== undefined && pack.header.meshes[m]!.skeleton === HUMAN.id ? m : -1;
    };
    // Armor sets and held things, from the items that name them.
    const sets: string[] = [];
    this.worn = reg.defs.map((d) => {
      if (d?.type !== "item" || !d.wear) return null;
      if (!sets.includes(d.wear.set)) sets.push(d.wear.set);
      return { slot: SLOT_NAMES.indexOf(d.wear.slot), set: sets.indexOf(d.wear.set), colors: d.wear.colors };
    });
    this.held = reg.defs.map((d) => {
      const mesh = d?.type === "item" && d.weapon?.mesh ? find(d.weapon.mesh) : -1;
      if (mesh < 0) return null;
      // Every vertex of a held thing follows the same bone: the first vertex says which.
      const lod = pack.header.meshes[mesh]!.lods[0]!;
      return { mesh, bone: lodVertices(pack, lod)[7]! };
    });
    const setOf = (base: string): BodySet | null => {
      const slots = Int32Array.from(SLOT_NAMES, (name) => find(`${base}/${name}`));
      const first = slots.find((m) => m >= 0);
      if (first === undefined) return null;
      const rig = pack.header.meshes[first]!.rig;
      return {
        slots,
        hair: Int32Array.from(HAIR_STYLES, (s) => find(`${base}/hair/${s.id}`)),
        beard: Int32Array.from(BEARD_STYLES, (s) => find(`${base}/beard/${s.id}`)),
        rest: rig === undefined ? HUMAN.rest : Float32Array.from(pack.header.rigs[rig]!.rest),
        armor: sets.map((set) => Int32Array.from(SLOT_NAMES, (name) => find(`${base}/armor/${set}/${name}`))),
      };
    };
    this.kinds = reg.defs.map((d) => {
      if (d?.type !== "species" || d.skeleton !== HUMAN.id) return null;
      // A modelled body for each sex; or one body; or, when its meshes are not in the pack, the mannequin.
      const sexes = SEX_IDS.map((sex) => setOf(`${d.mesh}_${sex}`));
      const sets = sexes.every((s) => s !== null) ? (sexes as BodySet[]) : [setOf(d.mesh) ?? setOf(MANNEQUIN)].filter((s) => s !== null);
      return sets.length > 0 ? { sets, color: d.color } : null;
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
   * ticks). `look` is its 28-byte look at `lookAt`, or null for a body that has
   * none and is drawn in the six colour regions of `colors` at `colorAt`. `gear`
   * holds what it has in hand and what it wears at `gearAt` (see
   * `EntityStore.gear`), or is null. `own` draws it in the near pass; `headless`
   * leaves out the head and what is on it, for looking out of it. Returns false
   * when the frame has no room left.
   */
  add(p: FramePacket, kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, look: Uint8Array | null, lookAt: number, colors: Uint8Array, colorAt: number, gear: Uint16Array | null, gearAt: number, id: number, own: boolean, headless: boolean): boolean {
    const k = this.kinds[kind];
    if (!k || p.boneCount + HUMAN_BONES > MAX_BONES || this.count + PARTS > MAX_SKINNED) return false;
    // A modelled body that was given no look gets the plain one, so its regions have colours.
    const view = look ? look.subarray(lookAt) : k.sets.length > 1 ? PLAIN : null;
    const set = k.sets[view && view[LOOK_SEX]! < k.sets.length ? view[LOOK_SEX]! : 0]!;
    humanPose(this.anim, st, tick, this.pose);
    let scales: Float32Array | null = null;
    if (view) {
      scales = this.scales;
      lookScales(view, scales);
      // Longer legs lift the hips, so the feet stay where the ground is.
      this.pose.root[1]! += lookLift(scales, set.rest);
      lookColors(view, this.lookColor);
    }
    solve(HUMAN, this.pose, this.solved, set.rest, scales);
    const first = p.boneCount;
    writeBones(p.bones, first * BONE_FLOATS, this.solved, set.rest, scales, x, y, z, yaw);
    p.boneCount = first + HUMAN_BONES;
    this.posed++;
    const far2 = x * x + y * y + z * z;
    const lod = own || far2 < BODY_LOD_NEAR * BODY_LOD_NEAR ? 0 : far2 < BODY_LOD_FAR * BODY_LOD_FAR ? 1 : 2;
    const queue = (m: number, tint: Uint8Array | null, tintAt: number, bone: number): void => {
      const n = this.count++;
      this.key[n] = m * LODS + lod;
      this.firstBone[n] = first;
      this.region0[n] = k.color;
      for (let q = 0; q < 6; q++) this.colors[n * 6 + q] = tint ? tint[tintAt + q]! : 0;
      this.id[n] = id;
      this.near[n] = own ? 1 : 0;
      // A held thing is modelled around its grip: it hangs where its bone rests on this body.
      for (let a = 0; a < 3; a++) this.offset[n * 3 + a] = bone < 0 ? 0 : set.rest[bone * 3 + a]!;
    };
    const tint = view ? this.lookColor : colors;
    const tintAt = view ? 0 : colorAt;
    let covered = false;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const worn = gear ? this.worn[gear[gearAt + GEAR_WORN + slot]!] : null;
      const piece = worn && worn.slot === slot ? (set.armor[worn.set]?.[slot] ?? -1) : -1;
      const hidden = headless && slot === SLOT_HEAD;
      if (piece >= 0 && !hidden) {
        // The piece in its own three colours, on this body's skin.
        const c = this.wornColor;
        c.set(view ? this.lookColor : colors.subarray(colorAt, colorAt + 6));
        c[REGION_MAIN - REGION_BASE] = worn!.colors[0];
        c[REGION_SECOND - REGION_BASE] = worn!.colors[1];
        c[REGION_TRIM - REGION_BASE] = worn!.colors[2];
        queue(piece, c, 0, -1);
        if (slot === SLOT_HEAD) covered = true;
      }
      // What is worn takes the place of the body under it, except on the head, where it goes over.
      const body = set.slots[slot]!;
      if (body >= 0 && !hidden && (piece < 0 || slot === SLOT_HEAD)) queue(body, tint, tintAt, -1);
    }
    if (view && !headless) {
      // Hair is under anything worn on the head; a beard is not.
      const hair = covered ? -1 : (set.hair[view[LOOK_HAIR]!] ?? -1);
      if (hair >= 0) queue(hair, tint, tintAt, -1);
      const beard = set.beard[view[LOOK_BEARD]!] ?? -1;
      if (beard >= 0) queue(beard, tint, tintAt, -1);
    }
    const inHand = gear ? this.held[gear[gearAt + GEAR_HELD]!] : null;
    if (inHand) queue(inHand.mesh, tint, tintAt, inHand.bone);
    return true;
  }

  /**
   * Queue a rigid mesh that has a place and a direction of its own: an arrow
   * in the air, the line of a round. Its origin goes to (x, y, z) relative to
   * the camera and its +Z along the unit direction (dx, dy, dz), stretched
   * `length` times along that. It is drawn through the bone path with one bone
   * of its own, which is how a mesh gets a tilt as well as a facing. False
   * when the frame has no room left.
   */
  loose(p: FramePacket, mesh: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number): boolean {
    if (p.boneCount + 1 > MAX_BONES || this.count + 1 > MAX_SKINNED) return false;
    // Right is level and square to the direction; up is square to both.
    let rx = dz;
    let rz = -dx;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    const ux = -rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy;
    const first = p.boneCount++;
    const o = first * BONE_FLOATS;
    const b = p.bones;
    b[o] = rx;
    b[o + 1] = ux;
    b[o + 2] = dx * length;
    b[o + 3] = x;
    b[o + 4] = 0;
    b[o + 5] = uy;
    b[o + 6] = dy * length;
    b[o + 7] = y;
    b[o + 8] = rz;
    b[o + 9] = uz;
    b[o + 10] = dz * length;
    b[o + 11] = z;
    const n = this.count++;
    this.key[n] = mesh * LODS;
    this.firstBone[n] = first;
    this.region0[n] = 0;
    this.colors.fill(0, n * 6, n * 6 + 6);
    this.id[n] = 0;
    this.near[n] = 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
    return true;
  }

  /** Turn what was queued into instances and draws: the viewer's own body when `own`, everyone else otherwise. */
  flush(p: FramePacket, writer: InstanceWriter, own: boolean, draw: DrawFn): void {
    const want = own ? 1 : 0;
    const counts = this.counts.fill(0);
    let any = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      counts[this.key[i]!]!++;
      any++;
    }
    if (any === 0) return;
    let total = p.transientCount;
    const flags = DRAW_SKINNED | DRAW_PLAIN | (own ? DRAW_NEAR : 0);
    for (let k = 0; k < counts.length; k++) {
      this.cursor[k] = total;
      if (counts[k]! > 0) draw(Math.floor(k / LODS), k % LODS, total, counts[k]!, flags);
      total += counts[k]!;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.near[i] !== want) continue;
      const at = this.cursor[this.key[i]!]!++;
      writer.setSkinned(at, this.firstBone[i]!, this.region0[i]!, this.offset[i * 3]!, this.offset[i * 3 + 1]!, this.offset[i * 3 + 2]!);
      writer.regions(at, this.colors, i * 6);
      p.transientIds[at] = this.id[i]!;
    }
    p.transientCount = total;
  }
}

/**
 * Write one body's bones at `at`: for each, three rows that take a vertex of a
 * mesh made on `rest` to where the posed, stretched, turned and placed body has
 * it. `scale` is each bone's stretch along its own axes, or null for none.
 */
export function writeBones(out: Float32Array, at: number, solved: Solved, rest: Float32Array, scale: Float32Array | null, x: number, y: number, z: number, yaw: number): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rot = solved.rot;
  const pos = solved.pos;
  const bones = rot.length >> 2;
  for (let b = 0; b < bones; b++) {
    const qx = rot[b * 4]!, qy = rot[b * 4 + 1]!, qz = rot[b * 4 + 2]!, qw = rot[b * 4 + 3]!;
    const sx = scale ? scale[b * 3]! : 1, sy = scale ? scale[b * 3 + 1]! : 1, sz = scale ? scale[b * 3 + 2]! : 1;
    // The bone's rotation as a matrix with its stretch applied first: columns scaled. Rows r0 r1 r2.
    const r00 = (1 - 2 * (qy * qy + qz * qz)) * sx, r01 = 2 * (qx * qy - qz * qw) * sy, r02 = 2 * (qx * qz + qy * qw) * sz;
    const r10 = 2 * (qx * qy + qz * qw) * sx, r11 = (1 - 2 * (qx * qx + qz * qz)) * sy, r12 = 2 * (qy * qz - qx * qw) * sz;
    const r20 = 2 * (qx * qz - qy * qw) * sx, r21 = 2 * (qy * qz + qx * qw) * sy, r22 = (1 - 2 * (qx * qx + qy * qy)) * sz;
    // A vertex v goes to pos + R S (v - rest): translation t = pos - R S rest.
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
