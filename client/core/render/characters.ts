// A body is one skeleton and several meshes, one per body slot, so a worn piece can replace the part under it.
// Its bones go into the packet once, and each of its meshes is one instance that names the body's first bone.

import type { SpeciesDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { Pose } from "../../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES, SLOT_COUNT, SLOT_HEAD, SLOT_NAMES } from "../../../shared/anim/human.ts";
import { BEARD_STYLES, HAIR_STYLES, LOOK_BEARD, LOOK_HAIR, LOOK_SEX, REGION_MAIN, REGION_SECOND, REGION_TRIM, SEX_IDS, defaultLook, lookColors, lookLift, lookScales } from "../../../shared/anim/look.ts";
import { HumanAnim, humanPose, type AnimState } from "../../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../../shared/anim/skeleton.ts";
import { creaturePose } from "../../../shared/anim/creature.ts";
import { buildRigs, type Rig } from "../../../shared/anim/rigs.ts";
import { BODY_REACH } from "../../../shared/anim/zones.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import type { Assets } from "../assets/assets.ts";
import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { GEAR_HELD, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { BONE_FLOATS, DRAW_NEAR, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_SKINNED, type FramePacket, type InstanceWriter } from "./packet.ts";

/** A body is culled when its origin is farther than this outside the view. No pose reaches farther from its origin. */
export const BODY_RADIUS = BODY_REACH;
/** Distances at which a body drops to its second and third level of detail, metres. */
/** The most levels of detail a mesh has. */
const LODS = 5;
/** The most meshes one body queues: its slots, hair, a beard, a piece worn on its head, and a held item. */
const PARTS = SLOT_COUNT + 4;
const PLAIN = defaultLook();

/** The meshes on one rig: one sex of a species, or the whole of a species modelled without sexes. */
interface Creature {
  rig: Rig;
  mesh: number;
  color: number;
  runAt: number;
  /** How far each level of its mesh lies from the finest, in metres. */
  error: readonly number[];
}

interface BodySet {
  /** Pack mesh per body slot, -1 where there is none. */
  slots: Int32Array;
  /** How far each level of the body lies from the finest, in metres. */
  error: readonly number[];
  /** Pack mesh per hair style and per beard style, -1 for none. */
  hair: Int32Array;
  beard: Int32Array;
  /** Rest positions of the joints of the body these meshes were made on. */
  rest: Float32Array;
  /** Per armor set, indexed as Worn.set. The pack mesh worn in each body slot, -1 where the set has none. */
  armor: Int32Array[];
}

interface Worn {
  slot: number;
  set: number;
  colors: readonly [number, number, number];
}

interface Held {
  mesh: number;
  bone: number;
}

interface BodyKind {
  /** Indexed by sex, or a single set. */
  sets: BodySet[];
  color: number;
}

export type DrawFn = (mesh: number, lod: number, first: number, count: number, flags: number) => void;

export class Characters {
  readonly anim: HumanAnim;
  /** Bodies posed this frame. */
  posed = 0;
  private readonly kinds: (BodyKind | null)[];
  /** Per content index. Set for a species with a non-human skeleton whose rig and mesh are in the pack. */
  private readonly creatures: (Creature | null)[];
  /** Per content index. */
  private readonly worn: (Worn | null)[];
  private readonly held: (Held | null)[];
  private readonly wornColor = new Uint8Array(6);
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly solved = new Solved(HUMAN_BONES);
  private readonly scales = new Float32Array(HUMAN_BONES * 3);
  private readonly lookColor = new Uint8Array(6);

  // Instances queued this frame, one per mesh of each body.
  private count = 0;
  /** Twice (pack mesh * LODS + level of detail), and one more for a body on one bone. */
  private readonly key = new Uint32Array(MAX_SKINNED);
  private readonly firstBone = new Uint16Array(MAX_SKINNED);
  private readonly region0 = new Uint8Array(MAX_SKINNED);
  private readonly colors = new Uint8Array(MAX_SKINNED * 6);
  private readonly id = new Uint32Array(MAX_SKINNED);
  private readonly near = new Uint8Array(MAX_SKINNED);
  /** Added to each vertex before its bone is applied. The rest position of the bone a held item hangs on, or zero for a body mesh. */
  private readonly offset = new Float32Array(MAX_SKINNED * 3);
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  private readonly assets: Assets;
  /** The level each body was last drawn at, by its id. */
  private readonly last = new Map<number, number>();

  constructor(reg: Registry, pack: Pack, assets: Assets) {
    const { table, bind } = assets;
    this.assets = assets;
    this.anim = new HumanAnim(pack.clips);
    this.counts = new Uint32Array(table.count * LODS * 2);
    this.cursor = new Uint32Array(table.count * LODS * 2);
    /** Only a mesh on the human skeleton is drawn as part of a body. */
    const human = (mesh: number): number => (mesh >= 0 && table.skeleton[mesh] === HUMAN.id ? mesh : -1);
    const sets: string[] = [];
    this.worn = reg.defs.map((d) => {
      if (d?.type !== "item" || !d.wear) return null;
      if (!sets.includes(d.wear.set)) sets.push(d.wear.set);
      return { slot: SLOT_NAMES.indexOf(d.wear.slot), set: sets.indexOf(d.wear.set), colors: d.wear.colors };
    });
    this.held = reg.defs.map((d) => {
      const mesh = d?.type === "item" && d.weapon ? human(bind.own(d.id, "held")) : -1;
      return mesh < 0 ? null : { mesh, bone: table.bone[mesh]! };
    });
    /** One piece of each armor set for each part. Its `worn` slot says where the set's mesh for a body is. */
    const piece = (set: string, part: string): string => reg.defs.find((d) => d?.type === "item" && d.wear?.set === set && d.wear.slot === part)?.id ?? "";
    const bodyOf = (d: SpeciesDef, sex: string): BodySet | null => {
      const slots = Int32Array.from(SLOT_NAMES, (part) => human(bind.mesh(d.id, "body", `${sex}/${part}`)));
      const first = slots.find((m) => m >= 0);
      if (first === undefined) return null;
      const rig = table.rig[first]!;
      // A body is drawn at one level, so that its parts meet. Its error at a level is the average of its parts'.
      const parts = [...slots].filter((m) => m >= 0).map((m) => table.error[m]!);
      const error = Array.from({ length: Math.min(LODS, ...parts.map((e) => e.length)) }, (_, level) => parts.reduce((sum, e) => sum + e[level]!, 0) / parts.length);
      // Armor is cut for a body, and keyed by the body's name without its pack.
      const body = `${d.mesh}_${sex}`.replace(/^[^:]*:/, "");
      return {
        slots,
        error,
        hair: Int32Array.from(HAIR_STYLES, (s) => human(bind.own(d.id, "hair", `${sex}/${s.id}`))),
        beard: Int32Array.from(BEARD_STYLES, (s) => human(bind.own(d.id, "beard", `${sex}/${s.id}`))),
        rest: rig < 0 ? HUMAN.rest : Float32Array.from(pack.header.rigs[rig]!.rest),
        // A missing piece is -1 here, and the body's own part is drawn in the piece's colours.
        armor: sets.map((set) => Int32Array.from(SLOT_NAMES, (part) => human(bind.own(piece(set, part), "worn", body)))),
      };
    };
    const rigs = buildRigs(pack.header.rigs, pack.clips);
    this.creatures = reg.defs.map((d, i) => {
      if (d?.type !== "species" || d.skeleton === undefined || d.skeleton === HUMAN.id) return null;
      const rig = rigs.get(bind.id(d.id, "rig"));
      const mesh = bind.own(d.id, "body");
      return rig && mesh >= 0 ? { rig, mesh, color: d.color, runAt: reg.runAt[i]!, error: table.error[mesh]!.slice(0, LODS) } : null;
    });
    this.kinds = reg.defs.map((d) => {
      if (d?.type !== "species" || d.skeleton !== HUMAN.id) return null;
      // A body for each sex. Where both are the same stand-in (a species with no art of its own) there is one body.
      const bodies: BodySet[] = [];
      for (const sex of SEX_IDS) {
        const body = bodyOf(d, sex);
        if (body && !bodies.some((b) => b.slots.every((m, k) => m === body.slots[k]))) bodies.push(body);
      }
      return bodies.length > 0 ? { sets: bodies, color: d.color } : null;
    });
  }

  /** Whether content of this kind is drawn here rather than as a rigid mesh. */
  has(kind: number): boolean {
    return this.kinds[kind] != null || this.creatures[kind] != null;
  }

  /** Whether this kind is on the humanoid skeleton. */
  human(kind: number): boolean {
    return this.kinds[kind] != null;
  }

  /** The farthest any part of a body of this kind gets from its origin, for culling. */
  reach(kind: number): number {
    return this.creatures[kind]?.rig.reach ?? BODY_RADIUS;
  }

  /** The bones a body of this kind takes when it is posed. */
  bones(kind: number): number {
    return this.creatures[kind]?.rig.bones ?? HUMAN_BONES;
  }

  /** Writes the seat socket's position to `out` for a creature at (x, y, z) facing `yaw` radians. False for a kind without a seat. */
  seat(kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, out: number[]): boolean {
    const c = this.creatures[kind];
    const socket = c?.rig.sockets.get("seat");
    if (!c || !socket) return false;
    creaturePose(c.rig, st, tick, c.runAt, c.rig.a);
    solve(c.rig, c.rig.a, c.rig.solved);
    boneToModel(c.rig.solved, socket.bone, socket.x, socket.y, socket.z, out);
    const s = Math.sin(yaw);
    const co = Math.cos(yaw);
    const [mx, my, mz] = [out[0]!, out[1]!, out[2]!];
    out[0] = x + co * mx + s * mz;
    out[1] = y + my;
    out[2] = z + co * mz - s * mx;
    return true;
  }

  private addCreature(p: FramePacket, c: Creature, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, colors: Uint8Array, colorAt: number, id: number, size: number, rigid: boolean): boolean {
    const rig = c.rig;
    const first = this.room(p, rigid ? 1 : rig.bones, 1);
    if (first < 0) return false;
    if (rigid) writeRigid(p.bones, first * BONE_FLOATS, x, y, z, yaw, size);
    else {
      creaturePose(rig, st, tick, c.runAt, rig.a);
      solve(rig, rig.a, rig.solved);
      writeBones(p.bones, first * BONE_FLOATS, rig.solved, rig.rest, null, x, y, z, yaw, size);
      this.posed++;
    }
    const n = this.count++;
    // A young one is the same mesh drawn smaller, and so are its errors.
    const far = Math.sqrt(x * x + y * y + z * z) / size;
    const lod = this.levelOf(id, c.error, far);
    this.assets.want(c.mesh, lod, far);
    this.key[n] = (c.mesh * LODS + lod) * 2 + (rigid ? 1 : 0);
    this.firstBone[n] = first;
    this.region0[n] = c.color;
    for (let q = 0; q < 6; q++) this.colors[n * 6 + q] = colors[colorAt + q]!;
    this.id[n] = id;
    this.near[n] = 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
    return true;
  }

  /** Takes `bones` bones for a body of `parts` meshes and returns the first, or counts the body as dropped and returns -1. */
  private room(p: FramePacket, bones: number, parts: number): number {
    const first = p.boneCount;
    if (first + bones > MAX_BONES || this.count + parts > MAX_SKINNED) {
      p.dropped++;
      return -1;
    }
    p.boneCount = first + bones;
    return first;
  }

  begin(): void {
    this.count = 0;
    this.posed = 0;
    // Ids of bodies long gone would otherwise be kept for good.
    if (this.last.size > 4096) this.last.clear();
  }

  private levelOf(id: number, errors: readonly number[], distance: number): number {
    const level = this.assets.choose(errors, distance, this.last.get(id) ?? -1);
    this.last.set(id, level);
    return level;
  }

  /**
   * `x, y, z` is the origin relative to the camera, `yaw` is in radians, and `tick` may fall between ticks. `look` holds a
   * 28-byte look at `lookAt`, or is null for a body drawn in the six colour regions of `colors` at `colorAt`. `gear` is
   * laid out as EntityStore.gear, at `gearAt`, or is null. `own` draws it in the near pass. `headless` leaves out the head
   * and what is on it. `size` scales a creature, below 1 for a young one. `rigid` leaves it in its rest pose on one bone, for
   * a frame without the bones to pose it. Returns false when the frame has no room left even for that, and counts it dropped.
   */
  add(p: FramePacket, kind: number, x: number, y: number, z: number, yaw: number, st: AnimState, tick: number, look: Uint8Array | null, lookAt: number, colors: Uint8Array, colorAt: number, gear: Uint16Array | null, gearAt: number, id: number, own: boolean, headless: boolean, size = 1, rigid = false): boolean {
    const creature = this.creatures[kind];
    if (creature) return this.addCreature(p, creature, x, y, z, yaw, st, tick, colors, colorAt, id, size, rigid);
    const k = this.kinds[kind];
    if (!k) return false;
    const first = this.room(p, rigid ? 1 : HUMAN_BONES, PARTS);
    if (first < 0) return false;
    // A modelled body without a look gets the plain one, so its regions have colours.
    const view = look ? look.subarray(lookAt) : k.sets.length > 1 ? PLAIN : null;
    const set = k.sets[view && view[LOOK_SEX]! < k.sets.length ? view[LOOK_SEX]! : 0]!;
    if (view) lookColors(view, this.lookColor);
    if (rigid) writeRigid(p.bones, first * BONE_FLOATS, x, y, z, yaw, 1);
    else {
      humanPose(this.anim, st, tick, this.pose);
      let scales: Float32Array | null = null;
      if (view) {
        scales = this.scales;
        lookScales(view, scales);
        // Longer legs lift the hips, so the feet stay on the ground.
        this.pose.root[1]! += lookLift(scales, set.rest);
      }
      solve(HUMAN, this.pose, this.solved, set.rest, scales);
      writeBones(p.bones, first * BONE_FLOATS, this.solved, set.rest, scales, x, y, z, yaw);
      this.posed++;
    }
    // The viewer's own body is as fine as the tier draws anything.
    const far = own ? 0 : Math.sqrt(x * x + y * y + z * z);
    const lod = own ? this.assets.choose(set.error, 0, -1) : this.levelOf(id, set.error, far);
    const queue = (m: number, tint: Uint8Array | null, tintAt: number, bone: number): void => {
      const n = this.count++;
      this.assets.want(m, lod, far);
      this.key[n] = (m * LODS + lod) * 2 + (rigid ? 1 : 0);
      this.firstBone[n] = first;
      this.region0[n] = k.color;
      for (let q = 0; q < 6; q++) this.colors[n * 6 + q] = tint ? tint[tintAt + q]! : 0;
      this.id[n] = id;
      this.near[n] = own ? 1 : 0;
      // A held item is modelled around its grip, so it is offset to where its bone rests on this body.
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
        // The piece uses its own three colours, and the body's colours for the other regions.
        const c = this.wornColor;
        c.set(view ? this.lookColor : colors.subarray(colorAt, colorAt + 6));
        c[REGION_MAIN - REGION_BASE] = worn!.colors[0];
        c[REGION_SECOND - REGION_BASE] = worn!.colors[1];
        c[REGION_TRIM - REGION_BASE] = worn!.colors[2];
        queue(piece, c, 0, -1);
        if (slot === SLOT_HEAD) covered = true;
      }
      // A worn piece replaces the body part under it, except on the head, where it goes over.
      const body = set.slots[slot]!;
      if (body >= 0 && !hidden && (piece < 0 || slot === SLOT_HEAD)) queue(body, tint, tintAt, -1);
    }
    if (view && !headless) {
      // A piece worn on the head hides hair but not a beard.
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
   * Queues a rigid mesh that has its own position and direction, such as an arrow in the air. Its origin goes to (x, y, z)
   * relative to the camera and its +Z along the unit direction (dx, dy, dz), stretched `length` times along it and `wide`
   * times across. It is drawn through the bone path with one bone, which gives it a tilt and a size as well as a facing.
   * False when the frame has no room left, and then it is counted dropped.
   */
  loose(p: FramePacket, mesh: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, wide = 1): boolean {
    const first = this.room(p, 1, 1);
    if (first < 0) return false;
    // Right is level and square to the direction. Up is square to both.
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
    const o = first * BONE_FLOATS;
    const b = p.bones;
    b[o] = rx * wide;
    b[o + 1] = ux * wide;
    b[o + 2] = dx * length;
    b[o + 3] = x;
    b[o + 4] = 0;
    b[o + 5] = uy * wide;
    b[o + 6] = dy * length;
    b[o + 7] = y;
    b[o + 8] = rz * wide;
    b[o + 9] = uz * wide;
    b[o + 10] = dz * length;
    b[o + 11] = z;
    const n = this.count++;
    this.key[n] = mesh * LODS * 2;
    this.firstBone[n] = first;
    this.region0[n] = 0;
    this.colors.fill(0, n * 6, n * 6 + 6);
    this.id[n] = 0;
    this.near[n] = 0;
    this.offset.fill(0, n * 3, n * 3 + 3);
    return true;
  }

  /** Writes the viewer's own body when `own`, and every other body otherwise. */
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
      // An odd key is the bodies on one bone, which are a draw of their own.
      if (counts[k]! > 0) draw(Math.floor(k / (LODS * 2)), (k >> 1) % LODS, total, counts[k]!, (k & 1) !== 0 ? flags | DRAW_ONE_BONE : flags);
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

/** Writes at `at` the one bone of a body left in its rest pose: it turns the body about +Y, sizes it and puts it in its place. */
function writeRigid(out: Float32Array, at: number, x: number, y: number, z: number, yaw: number, size: number): void {
  const s = Math.sin(yaw) * size;
  const c = Math.cos(yaw) * size;
  out.fill(0, at, at + BONE_FLOATS);
  out[at] = c;
  out[at + 2] = s;
  out[at + 3] = x;
  out[at + 5] = size;
  out[at + 7] = y;
  out[at + 8] = -s;
  out[at + 10] = c;
  out[at + 11] = z;
}

/**
 * Writes three rows per bone at `at`. They take a vertex of a mesh made on `rest` to its place on the posed, stretched,
 * turned and placed body. `scale` is each bone's stretch along its own axes, or null. `size` scales the whole body
 * about its origin.
 */
export function writeBones(out: Float32Array, at: number, solved: Solved, rest: Float32Array, scale: Float32Array | null, x: number, y: number, z: number, yaw: number, size = 1): void {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const rot = solved.rot;
  const pos = solved.pos;
  const bones = rot.length >> 2;
  for (let b = 0; b < bones; b++) {
    const qx = rot[b * 4]!, qy = rot[b * 4 + 1]!, qz = rot[b * 4 + 2]!, qw = rot[b * 4 + 3]!;
    const sx = (scale ? scale[b * 3]! : 1) * size, sy = (scale ? scale[b * 3 + 1]! : 1) * size, sz = (scale ? scale[b * 3 + 2]! : 1) * size;
    // The bone's rotation matrix with its stretch applied first, so its columns are scaled. Rows r0, r1, r2.
    const r00 = (1 - 2 * (qy * qy + qz * qz)) * sx, r01 = 2 * (qx * qy - qz * qw) * sy, r02 = 2 * (qx * qz + qy * qw) * sz;
    const r10 = 2 * (qx * qy + qz * qw) * sx, r11 = (1 - 2 * (qx * qx + qz * qz)) * sy, r12 = 2 * (qy * qz - qx * qw) * sz;
    const r20 = 2 * (qx * qz - qy * qw) * sx, r21 = 2 * (qy * qz + qx * qw) * sy, r22 = (1 - 2 * (qx * qx + qy * qy)) * sz;
    // A vertex v goes to size * pos + R S (v - rest), so the translation is t = size * pos - R S rest. S already includes size.
    const bx = rest[b * 3]!, by = rest[b * 3 + 1]!, bz = rest[b * 3 + 2]!;
    const tx = pos[b * 3]! * size - (r00 * bx + r01 * by + r02 * bz);
    const ty = pos[b * 3 + 1]! * size - (r10 * bx + r11 * by + r12 * bz);
    const tz = pos[b * 3 + 2]! * size - (r20 * bx + r21 * by + r22 * bz);
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
