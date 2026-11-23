// A dead body goes limp: a position-based ragdoll of rigid bodies (Müller and others, "Detailed Rigid Body Simulation
// with Extended Position Based Dynamics", 2020), stepped in short substeps with one pass of the constraints each. A body
// is a bone carrying a hit capsule. Every bone the asset does not list stays rigid with the nearest body above it, as it
// was when the body went limp. A joint keeps a body within the swing and twist its asset allows from the rest pose, then
// holds its joint to its parent body. Bodies meet the terrain and the boxes and convex parts of structures and nodes, with
// friction and rolling resistance.
// A living body uses the same solver. An anchor follows a target pose instead of moving, a drive turns a body toward its
// target turn against its parent like a damped spring, a strike knocks a limb and the chain above it, and listed capsule
// pairs keep limbs out of each other.
// The server lays it as every client does, to judge blows on a body as it is drawn (shared/anim/corpse.ts), so it uses
// only exactly rounded arithmetic and shared/math/scalar.ts's trigonometry: tools/simhash.ts's creature hash lays each
// rig's, and JavaScriptCore and V8 must agree on it (tests/server/determinism.test.ts).

import { chunkAt, mapSizeX, mapSizeZ } from "../coords.ts";
import { detAtan2, detCos, detSin, len3 } from "../math/scalar.ts";
import { quatRotate, quatUnrotate } from "../math/quat.ts";
import type { CollisionWorld } from "../world/collide.ts";
import { capsuleHull, hullPush } from "../world/convex.ts";
import { frame, frameOf } from "../world/frame.ts";
import type { Heightfield } from "../world/heightfield.ts";
import { Found, type StructureStore } from "../world/structures.ts";
import type { Skeleton, Solved } from "./skeleton.ts";

export interface RagdollDef {
  /** The frame of the death clip at which the body goes limp. */
  readonly limp: number;
  /** For each body: its bone, its share of the mass, and how far it may swing from its rest direction against its parent body and twist about it, in radians. */
  readonly bone: Int16Array;
  readonly mass: Float64Array;
  /** Explicit centres in the bone frame. An omitted entry uses the primary capsule midpoint. */
  readonly massCentres?: readonly (readonly [number, number, number] | undefined)[];
  readonly swing: Float64Array;
  readonly twist: Float64Array;
  /** Additional capsule bones rigidly attached to their nearest articulated ancestor. */
  readonly contacts?: Int16Array;
  /** Body index pairs, flat, whose capsules may not pass through each other. */
  readonly pairs?: Int16Array;
}

const GRAVITY = 9.81;
/** The longest substep, in seconds, and the most time one call steps. */
const SUBSTEP = 1 / 240;
const MOST_STEP = 0.1;
/** A contact holds where it would slide less than this share of how far it was pushed out. Sliding loses this share of the speed of the push. */
const STATIC = 1;
const DYNAMIC = 0.8;
/**
 * Flesh is not a wheel: a body resists turning about where it touches as if it pressed on the world this share of its
 * radius to either side of that point. A body whose weight lies farther out than that tips over.
 */
const ROLL = 0.6;
/** Damping a second: of motion, of spin, and of a body's spin against its parent. */
const DAMP = 1.5;
const SPIN_DAMP = 3;
const JOINT_DAMP = 10;
/** Radians a second, each second, that a joint's spin is slowed by besides, so that a limb comes to a stop. */
const JOINT_FRICTION = 10;
/** Metres a second at which a body found inside the world is pushed out, as one that went limp half into a slope is. */
const PUSH_OUT = 3;
/** Under water a body weighs this share of what it does in air, and its motion dies away this much faster. */
const SINKS = 0.25;
const WATER_DAMP = 3;
/** What a body under water is pulled down by, in metres a second each second, and the share of its speed it loses a second. */
export const WET_GRAVITY = GRAVITY * SINKS;
export const WET_DAMP = DAMP + WATER_DAMP;
/**
 * It sleeps once, for SLEEP_AFTER seconds, no body has moved more than SLEEP_MOVE of the widest capsule's radius or turned
 * more than SLEEP_TURN (the cosine of half that angle, 6 degrees). Measured by place and not by speed, so the shiver of a
 * limb held between its limit and the ground does not keep it awake.
 */
const SLEEP_MOVE = 0.1;
const SLEEP_TURN = 0.99863;
const SLEEP_AFTER = 0.5;
/** Metres a second below which every part of a supported body counts as creeping, not moving. */
const CREEP = 0.06;
/** Radians a second at which a limit the handover pose was past closes to the asset's. */
const RELAX = 2;
/** Metres between the points of a capsule tested against the terrain. */
const SPACING = 0.75;
/** Metres around its bodies within which structures are gathered for a call. */
const MARGIN = 0.4;
/** Metres two paired capsules may overlap beyond what they did at rest or at the start: hit capsules are fuller than the body. */
const PAIR_SLACK = 0.02;
/** A struck chain moves at most this fast, metres a second, however light it is. */
const STRIKE_MOST = 25;
const MOST_CONTACTS = 128;
const MOST_PAIRS = 16;
/** Numbers kept for each pair pushed apart in a substep. */
const PRESSED = 11;
/** Radians short of its limit at which a body counts as held there. */
const HELD = 0.02;
const MOST_REFS = 64;

const found = new Found();
/** Scratch for rotated vectors. */
const t3 = new Float64Array(3);
const u3 = new Float64Array(3);
const g4 = new Float64Array(4);

export class Ragdoll {
  readonly skel: Skeleton;
  readonly def: RagdollDef;
  /** Bodies, and the parent body of each, -1 for none. */
  readonly n: number;
  readonly parent: Int16Array;
  /** Per body in the world: centre of mass, velocity, spin, turn, and where it was at the start of the substep. */
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly w: Float64Array;
  readonly q: Float64Array;
  private readonly px: Float64Array;
  private readonly pq: Float64Array;
  private readonly invM: Float64Array;
  private readonly invI: Float64Array;
  private readonly rad: Float64Array;
  /** In the bone's frame: half the capsule's segment, the joint from the centre, the limits' axis and a line square to it. */
  private readonly seg: Float64Array;
  /** Primary capsule midpoint relative to the centre of mass, scaled to world metres. */
  private readonly primaryOffset: Float64Array | null;
  private readonly jc: Float64Array;
  private readonly dir: Float64Array;
  private readonly perp: Float64Array;
  /** Each child's joint in its parent body's frame, from that body's centre. */
  private readonly jp: Float64Array;
  /** The limits now: the asset's, or wider where the handover pose was past them. */
  readonly swingNow: Float64Array;
  readonly twistNow: Float64Array;
  /** Per bone: the body it follows, and its turn from that body as it went limp. */
  private readonly owner: Int16Array;
  /** Extra capsule centres and half segments, in the owning body's frame at handover. */
  private readonly contactBone: Int16Array;
  private readonly contactOwner: Int16Array;
  private readonly contactCentre: Float64Array;
  private readonly contactSegment: Float64Array;
  private readonly contactRadius: Float64Array;
  private readonly rel: Float64Array;
  /** Scratch for a pose, in full precision. */
  private readonly boneRot: Float64Array;
  private readonly bonePos: Float64Array;
  /** The root bone's joint in its body's frame. */
  private readonly root = new Float64Array(3);
  /** Where it was drawn from: a place, a yaw as a turn about +Y, and a size. */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private readonly yawQ = new Float64Array(4);
  private size = 1;
  awake = false;
  /** An upward face or opposed steep faces supported the last step. Water and map limits cannot support a body. */
  supported = false;
  /** An observer may request the world-space face that first supports the body. Consumed once, outside solver state. */
  firstSupport: Float64Array | null = null;
  /** Seconds no body has moved far from where stillX and stillQ hold, and how far is far. */
  private still = 0;
  private stillMove = 0;
  private readonly stillX: Float64Array;
  private readonly stillQ: Float64Array;
  /** The structures and nodes near it, gathered once a call: the ref, and 1 for a node, 2 for a structure with convex parts. */
  private readonly refs = new Uint32Array(MOST_REFS);
  private readonly refStore = new Uint8Array(MOST_REFS);
  private nRefs = 0;
  /** The chunks it lies in and their shapes when it fell asleep, so that it wakes when one changes. */
  private readonly sleptOn = new Int32Array(4);
  private readonly sleptShape = new Uint32Array(8);
  /** The contacts of one substep: body, normal, the point on the body from its centre, and how far it was pushed. */
  private nc = 0;
  private readonly cb = new Int16Array(MOST_CONTACTS);
  private readonly cn = new Float64Array(MOST_CONTACTS * 3);
  private readonly cr = new Float64Array(MOST_CONTACTS * 3);
  private readonly cd = new Float64Array(MOST_CONTACTS);
  /** The substep being taken, in seconds. While `probing`, contacts are measured into `worst` and not acted on. */
  private h = SUBSTEP;
  private probing = false;
  private worst = 0;
  /** Per body, 1 where it is an anchor: it follows its target and nothing moves it. */
  readonly anchored: Uint8Array;
  private nAnchored = 0;
  /** Each body's own inverse mass and inertia; invM and invI hold 0 for an anchor. */
  private readonly ownInvM: Float64Array;
  private readonly ownInvI: Float64Array;
  /** Each anchor's centre and turn at the start of the step and at its end. */
  private readonly ax0: Float64Array;
  private readonly aq0: Float64Array;
  private readonly ax1: Float64Array;
  private readonly aq1: Float64Array;
  /** Each drive's target turn against its parent body at the start and the end of the step. */
  private readonly dq0: Float64Array;
  private readonly dq1: Float64Array;
  /** Each drive's natural frequency in radians a second (0 for none) and its damping ratio. */
  readonly driveOmega: Float64Array;
  readonly driveZeta: Float64Array;
  /** The share of gravity a driven body does not feel: 1 holds a standing body up against its own weight. */
  lift = 0;
  /** Paired bodies, and how far each pair may overlap. */
  private readonly pairA: Int16Array;
  private readonly pairB: Int16Array;
  private readonly pairAllow: Float64Array;
  /** The pairs pushed apart this substep: the pair, its normal, each point in its own body's frame, and the push. */
  private readonly pressed = new Float64Array(MOST_PAIRS * PRESSED);
  private np = 0;

  constructor(skel: Skeleton, def: RagdollDef) {
    this.skel = skel;
    this.def = def;
    const n = (this.n = def.bone.length);
    this.parent = new Int16Array(n).fill(-1);
    this.x = new Float64Array(n * 3);
    this.v = new Float64Array(n * 3);
    this.w = new Float64Array(n * 3);
    this.q = new Float64Array(n * 4);
    this.px = new Float64Array(n * 3);
    this.pq = new Float64Array(n * 4);
    this.invM = new Float64Array(n);
    this.invI = new Float64Array(n);
    this.rad = new Float64Array(n);
    this.seg = new Float64Array(n * 3);
    this.primaryOffset = def.massCentres ? new Float64Array(n * 3) : null;
    this.jc = new Float64Array(n * 3);
    this.dir = new Float64Array(n * 3);
    this.perp = new Float64Array(n * 3);
    this.jp = new Float64Array(n * 3);
    this.swingNow = new Float64Array(n);
    this.twistNow = new Float64Array(n);
    this.stillX = new Float64Array(n * 3);
    this.stillQ = new Float64Array(n * 4);
    this.owner = new Int16Array(skel.bones);
    this.rel = new Float64Array(skel.bones * 4);
    this.boneRot = new Float64Array(skel.bones * 4);
    this.bonePos = new Float64Array(skel.bones * 3);
    const bodyOf = new Int16Array(skel.bones).fill(-1);
    for (let i = 0; i < n; i++) bodyOf[def.bone[i]!] = i;
    // A bone follows itself if it is a body, else the nearest body above it, else the first body.
    for (let b = 0; b < skel.bones; b++) {
      let o = -1;
      for (let a = b; a >= 0 && o < 0; a = skel.parent[a]!) o = bodyOf[a]!;
      this.owner[b] = o < 0 ? 0 : o;
      if (bodyOf[b]! < 0) continue;
      let up = -1;
      for (let a = skel.parent[b]!; a >= 0 && up < 0; a = skel.parent[a]!) up = bodyOf[a]!;
      this.parent[bodyOf[b]!] = up;
    }
    const contacts: number[] = [];
    for (const b of def.contacts ?? []) {
      if (!(b >= 0 && b < skel.bones && skel.capR[b]! > 0) || bodyOf[b]! >= 0 || contacts.includes(b)) continue;
      let parent = skel.parent[b]!;
      while (parent >= 0 && bodyOf[parent]! < 0) parent = skel.parent[parent]!;
      if (parent >= 0 && contacts.length < 16) contacts.push(b);
    }
    this.contactBone = Int16Array.from(contacts);
    this.contactOwner = Int16Array.from(contacts, b => this.owner[b]!);
    this.contactCentre = new Float64Array(contacts.length * 3);
    this.contactSegment = new Float64Array(contacts.length * 3);
    this.contactRadius = new Float64Array(contacts.length);
    this.anchored = new Uint8Array(n);
    this.ownInvM = new Float64Array(n);
    this.ownInvI = new Float64Array(n);
    this.ax0 = new Float64Array(n * 3);
    this.ax1 = new Float64Array(n * 3);
    this.aq0 = new Float64Array(n * 4);
    this.aq1 = new Float64Array(n * 4);
    this.dq0 = new Float64Array(n * 4);
    this.dq1 = new Float64Array(n * 4);
    this.driveOmega = new Float64Array(n);
    this.driveZeta = new Float64Array(n);
    const pairs: number[] = [];
    const listed = def.pairs ?? new Int16Array(0);
    for (let k = 0; k + 1 < listed.length; k += 2) {
      const a = listed[k]!, b = listed[k + 1]!;
      if (a >= 0 && b >= 0 && a < n && b < n && a !== b && this.parent[a] !== b && this.parent[b] !== a && pairs.length < MOST_PAIRS * 2) pairs.push(a, b);
    }
    this.pairA = Int16Array.from(pairs.filter((_, k) => (k & 1) === 0));
    this.pairB = Int16Array.from(pairs.filter((_, k) => (k & 1) === 1));
    this.pairAllow = new Float64Array(this.pairA.length);
  }

  /** Where the joint of bone `b` of a pose of the model is in the world, into t3. */
  private place(solved: Solved, b: number): void {
    const s = this.size;
    quatRotate(this.yawQ, 0, solved.pos[b * 3]! * s, solved.pos[b * 3 + 1]! * s, solved.pos[b * 3 + 2]! * s, t3, 0);
    t3[0]! += this.ox;
    t3[1]! += this.oy;
    t3[2]! += this.oz;
  }

  /**
   * Goes limp from `now`, a pose of the model solved at the size it was made, which was `before` a tick earlier. The body
   * stands at (x, y, z) facing `yaw` radians, `size` times as large as it was made. Drawn before a step, it is `now`.
   */
  start(now: Solved, before: Solved, x: number, y: number, z: number, yaw: number, size: number): void {
    const { skel, def, n } = this;
    // Joint bindings must not depend on the world origin a late observer happens to restore at.
    // Derive them near zero, then translate only dynamic positions into the world.
    this.ox = this.oy = this.oz = 0;
    this.size = size;
    this.yawQ[0] = 0;
    this.yawQ[1] = detSin(yaw / 2);
    this.yawQ[2] = 0;
    this.yawQ[3] = detCos(yaw / 2);
    let widest = 0;
    for (let i = 0; i < n; i++) {
      const b = def.bone[i]!;
      const ax = skel.capA[b * 3]!, ay = skel.capA[b * 3 + 1]!, az = skel.capA[b * 3 + 2]!;
      const bx = skel.capB[b * 3]!, by = skel.capB[b * 3 + 1]!, bz = skel.capB[b * 3 + 2]!;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const sx = ((bx - ax) / 2) * size, sy = ((by - ay) / 2) * size, sz = ((bz - az) / 2) * size;
      const r = skel.capR[b]! * size;
      if (r > widest) widest = r;
      this.rad[i] = r;
      set3(this.seg, i, sx, sy, sz);
      const centre = def.massCentres?.[i];
      const cx = centre?.[0] ?? mx, cy = centre?.[1] ?? my, cz = centre?.[2] ?? mz;
      const offsetX = (mx - cx) * size, offsetY = (my - cy) * size, offsetZ = (mz - cz) * size;
      if (this.primaryOffset) set3(this.primaryOffset, i, offsetX, offsetY, offsetZ);
      set3(this.jc, i, -cx * size, -cy * size, -cz * size);
      // The limits' axis runs from the joint through the capsule's middle, or along it where the middle is at the joint.
      let dx = mx, dy = my, dz = mz;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1e-3) [dx, dy, dz] = [sx, sy, sz];
      let l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-9) [dx, dy, dz, l] = [0, 1, 0, 1];
      dx /= l;
      dy /= l;
      dz /= l;
      set3(this.dir, i, dx, dy, dz);
      // Square to it: across it from +X, or from +Z where it runs along X.
      let ux = 0, uy = dz, uz = -dy;
      if (Math.abs(dx) >= 0.9) [ux, uy, uz] = [-dz, 0, dx];
      l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      set3(this.perp, i, ux / l, uy / l, uz / l);
      const half = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const mass = def.mass[i]! > 0 ? def.mass[i]! : 0.01;
      this.invM[i] = 1 / mass;
      const offset2 = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
      this.invI[i] = 1 / (mass * (0.4 * r * r + (half * half) / 3 + offset2));
      // Where it is now and a tick before, which says how it moves.
      for (let k = 0; k < 2; k++) {
        const pose = k === 0 ? before : now;
        const xs = k === 0 ? this.px : this.x;
        const qs = k === 0 ? this.pq : this.q;
        this.place(pose, b);
        const jx = t3[0]!, jy = t3[1]!, jz = t3[2]!;
        mulInto(qs, i * 4, this.yawQ, 0, pose.rot, b * 4);
        quatRotate(qs, i * 4, cx * size, cy * size, cz * size, t3, 0);
        set3(xs, i, jx + t3[0]!, jy + t3[1]!, jz + t3[2]!);
      }
    }
    this.stillMove = widest * SLEEP_MOVE;
    for (let c = 0; c < this.contactBone.length; c++) {
      const b = this.contactBone[c]!, i = this.contactOwner[c]!;
      const ax = skel.capA[b * 3]!, ay = skel.capA[b * 3 + 1]!, az = skel.capA[b * 3 + 2]!;
      const bx = skel.capB[b * 3]!, by = skel.capB[b * 3 + 1]!, bz = skel.capB[b * 3 + 2]!;
      this.place(now, b);
      const jx = t3[0]!, jy = t3[1]!, jz = t3[2]!;
      mulInto(g4, 0, this.yawQ, 0, now.rot, b * 4);
      quatRotate(g4, 0, (ax + bx) * size / 2, (ay + by) * size / 2, (az + bz) * size / 2, t3, 0);
      quatUnrotate(this.q, i * 4, jx + t3[0]! - this.x[i * 3]!, jy + t3[1]! - this.x[i * 3 + 1]!, jz + t3[2]! - this.x[i * 3 + 2]!, this.contactCentre, c * 3);
      quatRotate(g4, 0, (bx - ax) * size / 2, (by - ay) * size / 2, (bz - az) * size / 2, t3, 0);
      quatUnrotate(this.q, i * 4, t3[0]!, t3[1]!, t3[2]!, this.contactSegment, c * 3);
      this.contactRadius[c] = skel.capR[b]! * size;
    }
    if (this.contactBone.length) {
      // Retain each authored mass and centre, but estimate its scalar moment
      // from the full compound rather than only its narrow central capsule.
      // Capsule volume weights and the parallel-axis term make rigid horns or
      // spikes resist rotation at their real lever arms. The legacy estimate
      // remains bit-identical for owners with no additional contact geometry.
      const volume = new Float64Array(n), moment = new Float64Array(n), changed = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * 3, half2 = this.seg[o]! * this.seg[o]! + this.seg[o + 1]! * this.seg[o + 1]! + this.seg[o + 2]! * this.seg[o + 2]!, r = this.rad[i]!;
        volume[i] = r * r * (2 * Math.sqrt(half2) + 4 * r / 3);
        const centre = this.primaryOffset;
        const offset2 = centre ? centre[o]! * centre[o]! + centre[o + 1]! * centre[o + 1]! + centre[o + 2]! * centre[o + 2]! : 0;
        moment[i] = volume[i]! * (.4 * r * r + half2 / 3 + offset2);
      }
      for (let c = 0; c < this.contactBone.length; c++) {
        const i = this.contactOwner[c]!, o = c * 3, segment = this.contactSegment, centre = this.contactCentre, r = this.contactRadius[c]!;
        const half2 = segment[o]! * segment[o]! + segment[o + 1]! * segment[o + 1]! + segment[o + 2]! * segment[o + 2]!;
        const offset2 = centre[o]! * centre[o]! + centre[o + 1]! * centre[o + 1]! + centre[o + 2]! * centre[o + 2]!;
        const v = r * r * (2 * Math.sqrt(half2) + 4 * r / 3);
        volume[i]! += v; moment[i]! += v * (.4 * r * r + half2 / 3 + offset2); changed[i] = 1;
      }
      for (let i = 0; i < n; i++) if (changed[i] && moment[i]! > 0) this.invI[i] = this.invM[i]! * volume[i]! / moment[i]!;
    }
    this.ownInvM.set(this.invM);
    this.ownInvI.set(this.invI);
    this.anchored.fill(0);
    this.nAnchored = 0;
    this.driveOmega.fill(0);
    this.driveZeta.fill(0);
    this.lift = 0;
    this.velocities(1 / 30);
    // Each bone's turn from its body, the root's joint in its body, and each joint in its parent body.
    for (let b = 0; b < skel.bones; b++) conjMulInto(this.rel, b * 4, now.rot, def.bone[this.owner[b]!]! * 4, now.rot, b * 4);
    this.place(now, 0);
    const o = this.owner[0]!;
    quatUnrotate(this.q, o * 4, t3[0]! - this.x[o * 3]!, t3[1]! - this.x[o * 3 + 1]!, t3[2]! - this.x[o * 3 + 2]!, this.root, 0);
    for (let i = 0; i < n; i++) {
      this.swingNow[i] = def.swing[i]!;
      this.twistNow[i] = def.twist[i]!;
      const p = this.parent[i]!;
      if (p < 0) continue;
      this.place(now, def.bone[i]!);
      quatUnrotate(this.q, p * 4, t3[0]! - this.x[p * 3]!, t3[1]! - this.x[p * 3 + 1]!, t3[2]! - this.x[p * 3 + 2]!, u3, 0);
      set3(this.jp, i, u3[0]!, u3[1]!, u3[2]!);
      // A limit the pose is already past is widened to where the pose is, and closes in from there.
      this.limits(i, false);
      if (t3[0]! > this.swingNow[i]!) this.swingNow[i] = t3[0]!;
      if (t3[1]! > this.twistNow[i]!) this.twistNow[i] = t3[1]!;
    }
    for (let i = 0; i < n; i++) {
      this.x[i * 3]! += x; this.x[i * 3 + 1]! += y; this.x[i * 3 + 2]! += z;
      this.px[i * 3]! += x; this.px[i * 3 + 1]! += y; this.px[i * 3 + 2]! += z;
    }
    this.ox = x; this.oy = y; this.oz = z;
    this.supported = false;
    this.awake = true;
    this.hold();
    // Anchors and drives start where the body is, so turning one on changes nothing until it is given a target.
    this.ax0.set(this.x); this.ax1.set(this.x);
    this.aq0.set(this.q); this.aq1.set(this.q);
    for (let i = 0; i < n; i++) {
      const p = this.parent[i]!;
      if (p >= 0) conjMulInto(this.dq1, i * 4, this.q, p * 4, this.q, i * 4);
      else this.dq1.set(IDENTITY, i * 4);
    }
    this.dq0.set(this.dq1);
    this.allowPairs();
  }

  /** Each pair may overlap as much as its capsules do at rest or did at the start, and a little more. */
  private allowPairs(): void {
    const { skel, def, size } = this;
    const rest = skel.rest;
    for (let k = 0; k < this.pairA.length; k++) {
      let most = 0;
      for (let at = 0; at < 2; at++) {
        for (let side = 0; side < 2; side++) {
          const i = side === 0 ? this.pairA[k]! : this.pairB[k]!, b = def.bone[i]!, o = side * 7;
          if (at === 0) {
            // At rest no bone is turned, so a capsule lies at its joint plus its ends.
            for (let a = 0; a < 3; a++) {
              caps[o + a] = (rest[b * 3 + a]! + (skel.capA[b * 3 + a]! + skel.capB[b * 3 + a]!) / 2) * size;
              caps[o + 3 + a] = ((skel.capB[b * 3 + a]! - skel.capA[b * 3 + a]!) / 2) * size;
            }
            caps[o + 6] = skel.capR[b]! * size;
          } else {
            caps[o + 6] = this.shape(i, -1);
            for (let a = 0; a < 3; a++) { caps[o + a] = this.x[i * 3 + a]! + t3[a]!; caps[o + 3 + a] = u3[a]!; }
          }
        }
        const deep = caps[6]! + caps[13]! - closest(caps);
        if (deep > most) most = deep;
      }
      this.pairAllow[k] = most + PAIR_SLACK;
    }
  }

  /** Makes body `i` an anchor, which follows its target and is moved by nothing else, or frees it with the speed it has. */
  anchor(i: number, on: boolean): void {
    if ((this.anchored[i] === 1) === on) return;
    this.anchored[i] = on ? 1 : 0;
    this.nAnchored += on ? 1 : -1;
    this.invM[i] = on ? 0 : this.ownInvM[i]!;
    this.invI[i] = on ? 0 : this.ownInvI[i]!;
    if (!on) return;
    for (let a = 0; a < 3; a++) this.ax0[i * 3 + a] = this.ax1[i * 3 + a] = this.x[i * 3 + a]!;
    for (let a = 0; a < 4; a++) this.aq0[i * 4 + a] = this.aq1[i * 4 + a] = this.q[i * 4 + a]!;
  }

  /**
   * Sets what the next step follows from `target`, a pose of the model solved at the size it was made, standing at (x, y,
   * z) facing `yaw` radians: where each anchor ends the step, and each drive's target turn against its parent. With
   * `snap` the drives start the step at their targets instead of turning toward them across it.
   */
  follow(target: Solved, x: number, y: number, z: number, yaw: number, snap = false): void {
    const { def, n, size } = this;
    face[1] = detSin(yaw / 2);
    face[3] = detCos(yaw / 2);
    for (let i = 0; i < n; i++) {
      const b = def.bone[i]!, p = this.parent[i]!;
      if (p >= 0) conjMulInto(this.dq1, i * 4, target.rot, def.bone[p]! * 4, target.rot, b * 4);
      if (!this.anchored[i]) continue;
      mulInto(this.aq1, i * 4, face, 0, target.rot, b * 4);
      quatRotate(face, 0, target.pos[b * 3]! * size, target.pos[b * 3 + 1]! * size, target.pos[b * 3 + 2]! * size, t3, 0);
      const jx = t3[0]! + x, jy = t3[1]! + y, jz = t3[2]! + z;
      quatRotate(this.aq1, i * 4, this.jc[i * 3]!, this.jc[i * 3 + 1]!, this.jc[i * 3 + 2]!, t3, 0);
      set3(this.ax1, i, jx - t3[0]!, jy - t3[1]!, jz - t3[2]!);
    }
    if (snap) this.dq0.set(this.dq1);
  }

  /** Sets each drive's target turn against its parent body, four numbers a body, from where the step starts to its end. */
  driveTo(targets: Float64Array): void {
    this.dq1.set(targets);
    this.dq0.set(targets);
  }

  /**
   * Strikes body `i` with (dvx, dvy, dvz): the change of speed the whole body would take from the blow were it rigid. The
   * struck body and every free body above it take the blow together, as one piece, and the joints share it out.
   */
  strike(i: number, dvx: number, dvy: number, dvz: number): void {
    let share = 0;
    for (let k = i; k >= 0; k = this.parent[k]!) if (!this.anchored[k]) share += 1 / this.ownInvM[k]!;
    if (share <= 0) return;
    let sx = dvx / share, sy = dvy / share, sz = dvz / share;
    const fast = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (fast > STRIKE_MOST) {
      const k = STRIKE_MOST / fast;
      sx *= k; sy *= k; sz *= k;
    }
    for (let k = i; k >= 0; k = this.parent[k]!) {
      if (this.anchored[k]) continue;
      this.v[k * 3]! += sx; this.v[k * 3 + 1]! += sy; this.v[k * 3 + 2]! += sz;
    }
    this.awake = true;
    this.hold();
  }

  /** Turns the whole body by `yaw` radians about the upright line through (cx, cz): a walker's turn, which no limb feels. */
  turnAbout(cx: number, cz: number, yaw: number): void {
    if (yaw === 0) return;
    const s = detSin(yaw), c = detCos(yaw);
    face[1] = detSin(yaw / 2);
    face[3] = detCos(yaw / 2);
    for (const xs of [this.x, this.px, this.stillX, this.ax0, this.ax1]) {
      for (let i = 0; i < this.n; i++) {
        const dx = xs[i * 3]! - cx, dz = xs[i * 3 + 2]! - cz;
        xs[i * 3] = cx + c * dx + s * dz;
        xs[i * 3 + 2] = cz - s * dx + c * dz;
      }
    }
    for (const vs of [this.v, this.w]) {
      for (let i = 0; i < this.n; i++) {
        const dx = vs[i * 3]!, dz = vs[i * 3 + 2]!;
        vs[i * 3] = c * dx + s * dz;
        vs[i * 3 + 2] = -s * dx + c * dz;
      }
    }
    for (const qs of [this.q, this.pq, this.stillQ, this.aq0, this.aq1]) for (let i = 0; i < this.n; i++) mulInto(qs, i * 4, face, 0, qs, i * 4);
    const dx = this.ox - cx, dz = this.oz - cz;
    this.ox = cx + c * dx + s * dz;
    this.oz = cz - s * dx + c * dz;
    mulInto(this.yawQ, 0, face, 0, this.yawQ, 0);
  }

  /** Body `i`'s turn against its parent body, measured from its drive's target, into `out` at `o`. None for an anchor or a root. */
  offset(i: number, out: Float64Array | Float32Array, o: number): void {
    const p = this.parent[i]!;
    if (p < 0 || this.anchored[i]) {
      out[o] = out[o + 1] = out[o + 2] = 0;
      out[o + 3] = 1;
      return;
    }
    conjMulInto(g4, 0, this.q, p * 4, this.q, i * 4);
    conjMulInto(out, o, this.dq1, i * 4, g4, 0);
  }

  /** Adds one inherited root velocity/spin to the canonical limp pose, at its root joint. */
  launch(vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): void {
    this.rootPosition(t3);
    const ox = t3[0]!, oy = t3[1]!, oz = t3[2]!;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, x = this.x[k]! - ox, y = this.x[k + 1]! - oy, z = this.x[k + 2]! - oz;
      this.v[k]! += vx + wy * z - wz * y;
      this.v[k + 1]! += vy + wz * x - wx * z;
      this.v[k + 2]! += vz + wx * y - wy * x;
      this.w[k]! += wx; this.w[k + 1]! += wy; this.w[k + 2]! += wz;
    }
    this.awake = true;
    this.hold();
  }

  /** World root joint, used to keep a moving corpse in the correct spatial chunk. */
  rootPosition(out: Float64Array): void {
    const body = this.owner[0]!, at = body * 3;
    quatRotate(this.q, body * 4, this.root[0]!, this.root[1]!, this.root[2]!, out, 0);
    out[0]! += this.x[at]!; out[1]! += this.x[at + 1]!; out[2]! += this.x[at + 2]!;
  }

  /** Changes only the reference used by pose(); world bodies and momentum do not move. */
  rebase(x: number, y: number, z: number): void { this.ox = x; this.oy = y; this.oz = z; }

  /** Conservative radius from a supplied anchor to every collision capsule. */
  reach(x: number, y: number, z: number): number {
    let reach = 0;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, dx = this.x[k]! - x, dy = this.x[k + 1]! - y, dz = this.x[k + 2]! - z;
      const half = Math.sqrt(this.seg[k]! * this.seg[k]! + this.seg[k + 1]! * this.seg[k + 1]! + this.seg[k + 2]! * this.seg[k + 2]!);
      reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy + dz * dz) + half + this.rad[i]!);
    }
    return reach;
  }

  /** A small local geometry stamp, used to publish a fresh authoritative impact-corpse checkpoint. */
  worldRevision(world: CollisionWorld): number {
    this.bounds(0);
    const dims = world.hf.dims;
    const x0 = Math.max(0, Math.floor(box[0]! / 64)), z0 = Math.max(0, Math.floor(box[1]! / 64));
    const x1 = Math.min(dims.chunksX - 1, Math.floor(box[2]! / 64)), z1 = Math.min(dims.chunksZ - 1, Math.floor(box[3]! / 64));
    let hash = 2166136261;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const chunk = z * dims.chunksX + x;
      hash = Math.imul(hash ^ chunk, 16777619);
      hash = Math.imul(hash ^ (world.structs.chunks[chunk]?.shape ?? 0), 16777619);
      hash = Math.imul(hash ^ (world.nodes?.chunks[chunk]?.shape ?? 0), 16777619);
    }
    return hash >>> 0;
  }

  /** Exact future-controlling state after a whole tick. Bindings come from the canonical limp pose. */
  checkpoint(): Float64Array {
    const out = new Float64Array(22 * this.n + 13);
    let at = 0;
    for (const values of [this.x, this.v, this.w, this.q, this.swingNow, this.twistNow, this.stillX, this.stillQ]) { out.set(values, at); at += values.length; }
    out[at++] = this.still;
    for (const value of this.sleptOn) out[at++] = value;
    for (const value of this.sleptShape) out[at++] = value;
    return out;
  }

  /** Restores an already-validated checkpoint without restarting its sleep clock or adding launch twice. */
  restore(values: Float64Array, awake: boolean): boolean {
    if (values.length !== 22 * this.n + 13) return false;
    for (const value of values) if (!Number.isFinite(value)) return false;
    let at = 0;
    for (const target of [this.x, this.v, this.w, this.q, this.swingNow, this.twistNow, this.stillX, this.stillQ]) {
      for (let i = 0; i < target.length; i++) target[i] = values[at++]!;
    }
    this.still = values[at++]!;
    for (let i = 0; i < this.sleptOn.length; i++) this.sleptOn[i] = values[at++]!;
    for (let i = 0; i < this.sleptShape.length; i++) this.sleptShape[i] = values[at++]!;
    this.awake = awake;
    return true;
  }

  /**
   * The pose as the model's, solved at the size it was made, about where the body stood when it went limp: what
   * writeBones takes with that place, yaw and size.
   */
  pose(out: Solved): void {
    const { skel, q, rel } = this;
    const rest = skel.rest;
    const rot = this.boneRot;
    const pos = this.bonePos;
    // The yaw undone is a turn of -yaw about +Y: conj(yawQ) = (0, -sy, 0, cy).
    const sy = -this.yawQ[1]!, cy = this.yawQ[3]!;
    for (let b = 0; b < skel.bones; b++) {
      const o = this.owner[b]! * 4;
      // The body's turn, then the bone's within it, then the yaw undone.
      const ax = q[o]!, ay = q[o + 1]!, az = q[o + 2]!, aw = q[o + 3]!;
      const bx = rel[b * 4]!, by = rel[b * 4 + 1]!, bz = rel[b * 4 + 2]!, bw = rel[b * 4 + 3]!;
      const gx = aw * bx + ax * bw + ay * bz - az * by;
      const gy = aw * by - ax * bz + ay * bw + az * bx;
      const gz = aw * bz + ax * by - ay * bx + az * bw;
      const gw = aw * bw - ax * bx - ay * by - az * bz;
      const r = b * 4;
      rot[r] = cy * gx + sy * gz;
      rot[r + 1] = cy * gy + sy * gw;
      rot[r + 2] = cy * gz - sy * gx;
      rot[r + 3] = cy * gw - sy * gy;
      const p = skel.parent[b]!;
      if (p >= 0) {
        quatRotate(rot, p * 4, rest[b * 3]! - rest[p * 3]!, rest[b * 3 + 1]! - rest[p * 3 + 1]!, rest[b * 3 + 2]! - rest[p * 3 + 2]!, t3, 0);
        pos[b * 3] = pos[p * 3]! + t3[0]!;
        pos[b * 3 + 1] = pos[p * 3 + 1]! + t3[1]!;
        pos[b * 3 + 2] = pos[p * 3 + 2]! + t3[2]!;
        continue;
      }
      const c = this.owner[b]! * 3;
      quatRotate(q, o, this.root[0]!, this.root[1]!, this.root[2]!, t3, 0);
      quatUnrotate(this.yawQ, 0, this.x[c]! + t3[0]! - this.ox, this.x[c + 1]! + t3[1]! - this.oy, this.x[c + 2]! + t3[2]! - this.oz, t3, 0);
      pos[b * 3] = t3[0]! / this.size;
      pos[b * 3 + 1] = t3[1]! / this.size;
      pos[b * 3 + 2] = t3[2]! / this.size;
    }
    out.rot.set(rot);
    out.pos.set(pos);
  }

  /** How far body `i` is swung and twisted from its rest direction against its parent, in radians. */
  bend(i: number): [number, number] {
    this.limits(i, false);
    return [t3[0]!, t3[1]!];
  }

  /** Steps `seconds` and returns whether it is still moving. Asleep, it wakes when a structure where it lies changes. */
  step(world: CollisionWorld, seconds: number): boolean {
    if (!this.awake) {
      if (!this.shaken(world)) return false;
      this.awake = true;
      this.hold();
    }
    if (!(seconds > 0)) return true;
    if (seconds > MOST_STEP) seconds = MOST_STEP;
    this.gather(world, seconds);
    this.supported = false;
    const steps = Math.ceil(seconds / SUBSTEP);
    const h = seconds / steps;
    if (this.nAnchored > 0) {
      for (let i = 0; i < this.n; i++) {
        if (!this.anchored[i]) continue;
        for (let a = 0; a < 3; a++) this.ax0[i * 3 + a] = this.x[i * 3 + a]!;
        for (let a = 0; a < 4; a++) this.aq0[i * 4 + a] = this.q[i * 4 + a]!;
      }
    }
    for (let k = 0; k < steps; k++) this.substep(world, h, (k + 1) / steps, this.pairA.length > 0);
    // A body held by anchors is kept on the map by whatever walks it.
    if (this.nAnchored === 0) this.confine(world);
    this.dq0.set(this.dq1);
    const { def, n, x, q, stillX, stillQ } = this;
    let moved = false;
    let relaxing = false;
    for (let i = 0; i < n; i++) {
      if (this.swingNow[i]! > def.swing[i]!) this.swingNow[i] = Math.max(def.swing[i]!, this.swingNow[i]! - RELAX * seconds);
      if (this.twistNow[i]! > def.twist[i]!) this.twistNow[i] = Math.max(def.twist[i]!, this.twistNow[i]! - RELAX * seconds);
      if (this.swingNow[i]! > def.swing[i]! || this.twistNow[i]! > def.twist[i]!) relaxing = true;
      const dx = x[i * 3]! - stillX[i * 3]!, dy = x[i * 3 + 1]! - stillX[i * 3 + 1]!, dz = x[i * 3 + 2]! - stillX[i * 3 + 2]!;
      const dot = q[i * 4]! * stillQ[i * 4]! + q[i * 4 + 1]! * stillQ[i * 4 + 1]! + q[i * 4 + 2]! * stillQ[i * 4 + 2]! + q[i * 4 + 3]! * stillQ[i * 4 + 3]!;
      if (dx * dx + dy * dy + dz * dz > this.stillMove * this.stillMove || (dot < 0 ? -dot : dot) < SLEEP_TURN) moved = true;
    }
    // A supported body that only creeps keeps counting toward sleep: limbs pressed between their limits and the ground drift slowly forever.
    if (moved && !this.creeping()) this.hold();
    else this.still += seconds;
    // A body held by anchors lives as long as its owner keeps it, and never sleeps.
    if (this.nAnchored > 0 || !this.supported || this.still < SLEEP_AFTER || relaxing) return true;
    this.sleep(world);
    return false;
  }

  /** Whether it lies supported with every part moving slower than CREEP. */
  private creeping(): boolean {
    if (!this.supported) return false;
    const { n, v, w, rad } = this;
    for (let i = 0; i < n; i++) {
      const vx = v[i * 3]!, vy = v[i * 3 + 1]!, vz = v[i * 3 + 2]!;
      const wx = w[i * 3]!, wy = w[i * 3 + 1]!, wz = w[i * 3 + 2]!;
      const r = rad[i]!;
      if (vx * vx + vy * vy + vz * vz > CREEP * CREEP || (wx * wx + wy * wy + wz * wz) * r * r > CREEP * CREEP) return false;
    }
    return true;
  }

  /** Counts stillness from where the bodies are now. */
  private hold(): void {
    this.still = 0;
    this.stillX.set(this.x);
    this.stillQ.set(this.q);
  }

  /** The settling budget may stop a supported body, never an unsupported fall or sink. */
  settle(world: CollisionWorld): void {
    if (this.supported) this.sleep(world);
  }

  /** Map limits contain the whole articulated body; its spatial root and inventory cannot escape beyond them. */
  private confine(world: CollisionWorld): void {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      quatRotate(this.q, i * 4, this.seg[k]!, this.seg[k + 1]!, this.seg[k + 2]!, t3, 0);
      const rx = Math.abs(t3[0]!) + this.rad[i]!, rz = Math.abs(t3[2]!) + this.rad[i]!;
      x0 = Math.min(x0, this.x[k]! - rx); x1 = Math.max(x1, this.x[k]! + rx);
      z0 = Math.min(z0, this.x[k + 2]! - rz); z1 = Math.max(z1, this.x[k + 2]! + rz);
    }
    const width = mapSizeX(world.hf.dims), depth = mapSizeZ(world.hf.dims);
    const dx = x0 < 0 ? -x0 : x1 > width ? width - x1 : 0;
    const dz = z0 < 0 ? -z0 : z1 > depth ? depth - z1 : 0;
    if (dx === 0 && dz === 0) return;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      this.x[k]! += dx; this.x[k + 2]! += dz;
      this.px[k]! += dx; this.px[k + 2]! += dz;
      this.stillX[k]! += dx; this.stillX[k + 2]! += dz;
      if (this.v[k]! * dx < 0) this.v[k] = 0;
      if (this.v[k + 2]! * dz < 0) this.v[k + 2] = 0;
    }
  }

  private sleep(world: CollisionWorld): void {
    this.awake = false;
    this.v.fill(0);
    this.w.fill(0);
    // The chunks at the corners of where it lies, and their shapes now.
    this.bounds(0);
    const dims = world.hf.dims;
    this.sleptOn[0] = chunkAt(dims, box[0]!, box[1]!);
    this.sleptOn[1] = chunkAt(dims, box[2]!, box[1]!);
    this.sleptOn[2] = chunkAt(dims, box[0]!, box[3]!);
    this.sleptOn[3] = chunkAt(dims, box[2]!, box[3]!);
    for (let k = 0; k < 4; k++) {
      this.sleptShape[k] = world.structs.chunks[this.sleptOn[k]!]?.shape ?? 0;
      this.sleptShape[4 + k] = world.nodes?.chunks[this.sleptOn[k]!]?.shape ?? 0;
    }
  }

  /** Whether a structure or node was added, moved or taken where it sleeps. */
  private shaken(world: CollisionWorld): boolean {
    for (let k = 0; k < 4; k++) {
      if ((world.structs.chunks[this.sleptOn[k]!]?.shape ?? 0) !== this.sleptShape[k]) return true;
      if ((world.nodes?.chunks[this.sleptOn[k]!]?.shape ?? 0) !== this.sleptShape[4 + k]) return true;
    }
    return false;
  }

  /** The least x and z and the most x and z its capsules reach, widened by `pad`, into `box`. */
  private bounds(pad: number): void {
    box[0] = box[1] = Infinity;
    box[2] = box[3] = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const s = this.seg, offset = this.primaryOffset, o = i * 3;
      const extra = offset ? Math.sqrt(offset[o]! * offset[o]! + offset[o + 1]! * offset[o + 1]! + offset[o + 2]! * offset[o + 2]!) : 0;
      const r = extra + Math.sqrt(s[i * 3]! * s[i * 3]! + s[i * 3 + 1]! * s[i * 3 + 1]! + s[i * 3 + 2]! * s[i * 3 + 2]!) + this.rad[i]! + pad;
      box[0] = Math.min(box[0]!, this.x[i * 3]! - r);
      box[1] = Math.min(box[1]!, this.x[i * 3 + 2]! - r);
      box[2] = Math.max(box[2]!, this.x[i * 3]! + r);
      box[3] = Math.max(box[3]!, this.x[i * 3 + 2]! + r);
    }
    for (let c = 0; c < this.contactBone.length; c++) {
      const i = this.contactOwner[c]!, o = c * 3, centre = this.contactCentre, segment = this.contactSegment;
      const r = Math.sqrt(centre[o]! * centre[o]! + centre[o + 1]! * centre[o + 1]! + centre[o + 2]! * centre[o + 2]!) + Math.sqrt(segment[o]! * segment[o]! + segment[o + 1]! * segment[o + 1]! + segment[o + 2]! * segment[o + 2]!) + this.contactRadius[c]! + pad;
      box[0] = Math.min(box[0]!, this.x[i * 3]! - r);
      box[1] = Math.min(box[1]!, this.x[i * 3 + 2]! - r);
      box[2] = Math.max(box[2]!, this.x[i * 3]! + r);
      box[3] = Math.max(box[3]!, this.x[i * 3 + 2]! + r);
    }
  }

  /** Gathers the structures and nodes it may meet in the next `seconds`. */
  private gather(world: CollisionWorld, seconds: number): void {
    let fast = 0;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const v = this.v;
      fast = Math.max(fast, Math.abs(v[i * 3]!) + Math.abs(v[i * 3 + 1]!) + Math.abs(v[i * 3 + 2]!));
      y0 = Math.min(y0, this.x[i * 3 + 1]!);
      y1 = Math.max(y1, this.x[i * 3 + 1]!);
    }
    this.bounds(MARGIN + fast * seconds);
    const reach = box[2]! - box[0]!;
    this.nRefs = 0;
    for (let store = 0; store < 2; store++) {
      const structs = store === 0 ? world.structs : world.nodes;
      if (!structs) continue;
      const m = structs.query(box[0]!, box[1]!, box[2]!, box[3]!, found, y0 - reach, y1 + reach);
      for (let k = 0; k < m && this.nRefs < MOST_REFS; k++) {
        const ref = found.refs[k]!;
        const t = structs.chunks[Math.floor(ref / 65536)]!;
        const kind = t.kind[ref & 0xffff]!;
        if (structs.isSoft(kind)) continue;
        const hulls = structs.parts.hulls;
        this.refs[this.nRefs] = ref;
        this.refStore[this.nRefs++] = store === 0 && hulls !== undefined && hulls.start[kind + 1]! > hulls.start[kind]! ? 2 : store;
      }
    }
  }

  /** One substep of `h` seconds, ending `t` of the way through the step; `pairs` keeps limbs apart this time. */
  private substep(world: CollisionWorld, h: number, t: number, pairs: boolean): void {
    const { n, x, v, w, q, px, pq, anchored } = this;
    this.h = h;
    const hf = world.hf;
    for (let i = 0; i < n; i++) {
      if (anchored[i]) {
        for (let k = 0; k < 3; k++) {
          px[i * 3 + k] = x[i * 3 + k]!;
          x[i * 3 + k] = this.ax0[i * 3 + k]! + (this.ax1[i * 3 + k]! - this.ax0[i * 3 + k]!) * t;
        }
        for (let k = 0; k < 4; k++) pq[i * 4 + k] = q[i * 4 + k]!;
        nlerp(q, i * 4, this.aq0, this.aq1, i * 4, t);
        continue;
      }
      const wet = x[i * 3 + 1]! < hf.waterAt(x[i * 3]!, x[i * 3 + 2]!);
      // A body held up by its drives is carried by its anchors, so the air does not slow it against the ground.
      const held = this.driveOmega[i]! > 0 && this.lift > 0;
      const damp = 1 - ((held ? 0 : DAMP) + (wet ? WATER_DAMP : 0)) * h;
      const spinDamp = 1 - ((held ? 0 : SPIN_DAMP) + (wet ? WATER_DAMP : 0)) * h;
      const weight = held ? 1 - this.lift : 1;
      v[i * 3 + 1]! -= GRAVITY * (wet ? SINKS : 1) * weight * h;
      for (let k = 0; k < 3; k++) {
        v[i * 3 + k]! *= damp;
        w[i * 3 + k]! *= spinDamp;
        px[i * 3 + k] = x[i * 3 + k]!;
        x[i * 3 + k]! += v[i * 3 + k]! * h;
      }
      for (let k = 0; k < 4; k++) pq[i * 4 + k] = q[i * 4 + k]!;
      this.spin(i, w[i * 3]! * h, w[i * 3 + 1]! * h, w[i * 3 + 2]! * h);
    }
    for (let i = 0; i < n; i++) {
      if (this.parent[i]! < 0) continue;
      if (this.driveOmega[i]! > 0) this.drive(i, t);
      this.joint(i);
    }
    if (pairs) this.apart();
    this.nc = 0;
    for (let i = 0; i < n; i++) if (!anchored[i]) this.collide(world, i);
    for (let c = 0; c < this.contactBone.length; c++) if (!anchored[this.contactOwner[c]!]) this.collide(world, this.contactOwner[c]!, c);
    this.velocities(h);
    if (pairs) this.stopPairs();
    for (let c = 0; c < this.nc; c++) this.slide(c, h);
    // Each joint's spin against its parent damped, and stopped when slow. A drive damps its own joint besides.
    for (let i = 0; i < n; i++) {
      const p = this.parent[i]!;
      if (p < 0) continue;
      const weights = this.invI[i]! + this.invI[p]!;
      if (weights <= 0) continue;
      const damping = (JOINT_DAMP + 2 * this.driveZeta[i]! * this.driveOmega[i]!) * h;
      const k = damping < 1 ? damping : 1;
      const rx = w[p * 3]! - w[i * 3]!, ry = w[p * 3 + 1]! - w[i * 3 + 1]!, rz = w[p * 3 + 2]! - w[i * 3 + 2]!;
      const rel = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rel < 1e-12) continue;
      const less = rel * k + JOINT_FRICTION * h;
      const share = (less < rel ? less / rel : 1) / weights;
      const ci = share * this.invI[i]!;
      const cp = share * this.invI[p]!;
      w[i * 3]! += rx * ci;
      w[i * 3 + 1]! += ry * ci;
      w[i * 3 + 2]! += rz * ci;
      w[p * 3]! -= rx * cp;
      w[p * 3 + 1]! -= ry * cp;
      w[p * 3 + 2]! -= rz * cp;
    }
  }

  /** v and w from where each body was at the start of the substep and where it is now. */
  private velocities(h: number): void {
    const { n, x, v, w, q, px, pq } = this;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) v[i * 3 + k] = (x[i * 3 + k]! - px[i * 3 + k]!) / h;
      // The turn from then to now is q * conj(pq).
      const ax = q[i * 4]!, ay = q[i * 4 + 1]!, az = q[i * 4 + 2]!, aw = q[i * 4 + 3]!;
      const bx = -pq[i * 4]!, by = -pq[i * 4 + 1]!, bz = -pq[i * 4 + 2]!, bw = pq[i * 4 + 3]!;
      const s = (aw * bw - ax * bx - ay * by - az * bz < 0 ? -2 : 2) / h;
      w[i * 3] = (aw * bx + ax * bw + ay * bz - az * by) * s;
      w[i * 3 + 1] = (aw * by - ax * bz + ay * bw + az * bx) * s;
      w[i * 3 + 2] = (aw * bz + ax * by - ay * bx + az * bw) * s;
    }
  }

  /** Turns body `i` by the small rotation (ax, ay, az): q += (a, 0) q / 2, normalized. */
  private spin(i: number, ax: number, ay: number, az: number): void {
    const q = this.q;
    const o = i * 4;
    const qx = q[o]!, qy = q[o + 1]!, qz = q[o + 2]!, qw = q[o + 3]!;
    const nx = qx + 0.5 * (ax * qw + ay * qz - az * qy);
    const ny = qy + 0.5 * (-ax * qz + ay * qw + az * qx);
    const nz = qz + 0.5 * (ax * qy - ay * qx + az * qw);
    const nw = qw + 0.5 * (-ax * qx - ay * qy - az * qz);
    const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    q[o] = nx * l;
    q[o + 1] = ny * l;
    q[o + 2] = nz * l;
    q[o + 3] = nw * l;
  }

  /** Moves the point (rx, ry, rz) from body `i`'s centre by (dx, dy, dz), the world not giving. */
  private push(i: number, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): void {
    const c = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (c < 1e-12) return;
    const nx = dx / c, ny = dy / c, nz = dz / c;
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const l = c / (this.invM[i]! + this.invI[i]! * (cx * cx + cy * cy + cz * cz));
    const m = l * this.invM[i]!;
    this.x[i * 3]! += nx * m;
    this.x[i * 3 + 1]! += ny * m;
    this.x[i * 3 + 2]! += nz * m;
    const s = l * this.invI[i]!;
    this.spin(i, cx * s, cy * s, cz * s);
  }

  /** Keeps body `i` within its swing and twist against its parent, then holds its joint to the parent's. */
  private joint(i: number): void {
    const p = this.parent[i]!;
    const { x, q, invM, invI } = this;
    if (invM[i]! + invM[p]! <= 0) return;
    this.limits(i, true);
    quatRotate(q, i * 4, this.jc[i * 3]!, this.jc[i * 3 + 1]!, this.jc[i * 3 + 2]!, t3, 0);
    const rcx = t3[0]!, rcy = t3[1]!, rcz = t3[2]!;
    quatRotate(q, p * 4, this.jp[i * 3]!, this.jp[i * 3 + 1]!, this.jp[i * 3 + 2]!, t3, 0);
    const rpx = t3[0]!, rpy = t3[1]!, rpz = t3[2]!;
    const dx = x[p * 3]! + rpx - x[i * 3]! - rcx;
    const dy = x[p * 3 + 1]! + rpy - x[i * 3 + 1]! - rcy;
    const dz = x[p * 3 + 2]! + rpz - x[i * 3 + 2]! - rcz;
    const c = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (c < 1e-9) return;
    const nx = dx / c, ny = dy / c, nz = dz / c;
    const ax = rcy * nz - rcz * ny, ay = rcz * nx - rcx * nz, az = rcx * ny - rcy * nx;
    const bx = rpy * nz - rpz * ny, by = rpz * nx - rpx * nz, bz = rpx * ny - rpy * nx;
    const l = c / (invM[i]! + invI[i]! * (ax * ax + ay * ay + az * az) + invM[p]! + invI[p]! * (bx * bx + by * by + bz * bz));
    const mi = l * invM[i]!;
    const mp = l * invM[p]!;
    x[i * 3]! += nx * mi;
    x[i * 3 + 1]! += ny * mi;
    x[i * 3 + 2]! += nz * mi;
    x[p * 3]! -= nx * mp;
    x[p * 3 + 1]! -= ny * mp;
    x[p * 3 + 2]! -= nz * mp;
    this.spin(i, ax * l * invI[i]!, ay * l * invI[i]!, az * l * invI[i]!);
    this.spin(p, -bx * l * invI[p]!, -by * l * invI[p]!, -bz * l * invI[p]!);
  }

  /**
   * Turns body `i` and its parent toward the drive's target turn between them, `t` of the way from the step's first
   * target to its last. As a spring of the drive's frequency would, whatever the bodies weigh.
   */
  private drive(i: number, t: number): void {
    const p = this.parent[i]!;
    const { q, invI } = this;
    const weights = invI[i]! + invI[p]!;
    if (weights <= 0) return;
    nlerp(aim, 0, this.dq0, this.dq1, i * 4, t);
    // Where the child should be turned, then the turn from where it is to there.
    mulInto(aim, 0, q, p * 4, aim, 0);
    const bx = -q[i * 4]!, by = -q[i * 4 + 1]!, bz = -q[i * 4 + 2]!, bw = q[i * 4 + 3]!;
    const ax = aim[0]!, ay = aim[1]!, az = aim[2]!, aw = aim[3]!;
    let ex = aw * bx + ax * bw + ay * bz - az * by;
    let ey = aw * by - ax * bz + ay * bw + az * bx;
    let ez = aw * bz + ax * by - ay * bx + az * bw;
    let ew = aw * bw - ax * bx - ay * by - az * bz;
    if (ew < 0) { ex = -ex; ey = -ey; ez = -ez; ew = -ew; }
    const s = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (s < 1e-9) return;
    const wh = this.driveOmega[i]! * this.h;
    const turn = ((2 * detAtan2(s, ew)) / s) * ((wh * wh) / (wh * wh + 1)) / weights;
    this.spin(i, ex * turn * invI[i]!, ey * turn * invI[i]!, ez * turn * invI[i]!);
    this.spin(p, -ex * turn * invI[p]!, -ey * turn * invI[p]!, -ez * turn * invI[p]!);
  }

  /**
   * Pushes apart each pair of capsules overlapping more than it may, by their shares, and holds the two points together
   * where they would slide less than their share of the push, as a contact with the world is held.
   */
  private apart(): void {
    this.np = 0;
    const pairs = this.pairA.length;
    // Every pair's overlap first: a limb pressed into two bodies at once answers only the deeper.
    for (let k = 0; k < pairs; k++) {
      const a = this.pairA[k]!, b = this.pairB[k]!;
      overlap[k] = 0;
      if (this.invM[a]! + this.invM[b]! <= 0) continue;
      caps[6] = this.shape(a, -1);
      for (let c = 0; c < 3; c++) { caps[c] = this.x[a * 3 + c]! + t3[c]!; caps[3 + c] = u3[c]!; }
      caps[13] = this.shape(b, -1);
      for (let c = 0; c < 3; c++) { caps[7 + c] = this.x[b * 3 + c]! + t3[c]!; caps[10 + c] = u3[c]!; }
      const gap = closest(caps);
      const deep = caps[6]! + caps[13]! - gap - this.pairAllow[k]!;
      if (deep <= 0 || gap < 1e-9) continue;
      overlap[k] = deep;
      for (let c = 0; c < 6; c++) nearest[k * 6 + c] = near[c]!;
    }
    for (let k = 0; k < pairs; k++) {
      let deep = overlap[k]!;
      if (deep <= 0) continue;
      const a = this.pairA[k]!, b = this.pairB[k]!;
      let deepest = true;
      for (let m = 0; m < pairs && deepest; m++) if (m !== k && this.pairA[m] === a && (overlap[m]! > deep || (overlap[m] === deep && m < k))) deepest = false;
      // Two limbs both held at their limits cannot part, and pushing them would only make them creep.
      if (!deepest || (this.held(a) && this.held(b))) continue;
      if (deep > PUSH_OUT * this.h) deep = PUSH_OUT * this.h;
      const p = k * 6;
      let nx = nearest[p + 3]! - nearest[p]!, ny = nearest[p + 4]! - nearest[p + 1]!, nz = nearest[p + 5]! - nearest[p + 2]!;
      const gap = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= gap; ny /= gap; nz /= gap;
      // Each point in its own body's frame, then a's pushed from b's.
      const ps = this.pressed, o = this.np * PRESSED;
      quatUnrotate(this.q, a * 4, nearest[p]! - this.x[a * 3]!, nearest[p + 1]! - this.x[a * 3 + 1]!, nearest[p + 2]! - this.x[a * 3 + 2]!, ps, o + 4);
      quatUnrotate(this.q, b * 4, nearest[p + 3]! - this.x[b * 3]!, nearest[p + 4]! - this.x[b * 3 + 1]!, nearest[p + 5]! - this.x[b * 3 + 2]!, ps, o + 7);
      this.part(a, b, o, nx, ny, nz, deep);
      // Where each point went this substep; a slide smaller than the push is undone.
      this.travel(a, ps, o + 4, 0);
      this.travel(b, ps, o + 7, 3);
      let dx = near[3]! - near[0]!, dy = near[4]! - near[1]!, dz = near[5]! - near[2]!;
      const along = dx * nx + dy * ny + dz * nz;
      dx -= along * nx; dy -= along * ny; dz -= along * nz;
      const slid = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (slid > 1e-12 && slid < STATIC * deep) this.part(a, b, o, -dx / slid, -dy / slid, -dz / slid, slid);
      if (this.np >= MOST_PAIRS) continue;
      ps[o] = k;
      ps[o + 1] = nx; ps[o + 2] = ny; ps[o + 3] = nz;
      ps[o + 10] = deep;
      this.np++;
    }
  }

  /** Moves the two points of pressed pair `o` apart by `d` along the unit line (nx, ny, nz), each by its share. */
  private part(a: number, b: number, o: number, nx: number, ny: number, nz: number, d: number): void {
    const ps = this.pressed;
    quatRotate(this.q, a * 4, ps[o + 4]!, ps[o + 5]!, ps[o + 6]!, t3, 0);
    const rax = t3[0]!, ray = t3[1]!, raz = t3[2]!;
    quatRotate(this.q, b * 4, ps[o + 7]!, ps[o + 8]!, ps[o + 9]!, t3, 0);
    const rbx = t3[0]!, rby = t3[1]!, rbz = t3[2]!;
    const cax = ray * nz - raz * ny, cay = raz * nx - rax * nz, caz = rax * ny - ray * nx;
    const cbx = rby * nz - rbz * ny, cby = rbz * nx - rbx * nz, cbz = rbx * ny - rby * nx;
    const wa = this.invM[a]! + this.invI[a]! * (cax * cax + cay * cay + caz * caz);
    const wb = this.invM[b]! + this.invI[b]! * (cbx * cbx + cby * cby + cbz * cbz);
    const l = d / (wa + wb);
    if (wa > 0) this.push(a, rax, ray, raz, -nx * l * wa, -ny * l * wa, -nz * l * wa);
    if (wb > 0) this.push(b, rbx, rby, rbz, nx * l * wb, ny * l * wb, nz * l * wb);
  }

  /** How far body `i`'s point (in its frame at `at`) moved this substep, into near at `to`. */
  private travel(i: number, local: Float64Array, at: number, to: number): void {
    quatRotate(this.q, i * 4, local[at]!, local[at + 1]!, local[at + 2]!, t3, 0);
    quatRotate(this.pq, i * 4, local[at]!, local[at + 1]!, local[at + 2]!, u3, 0);
    for (let c = 0; c < 3; c++) near[to + c] = this.x[i * 3 + c]! + t3[c]! - this.px[i * 3 + c]! - u3[c]!;
  }

  /** Whether body `i` cannot turn further: an anchor, or one at its swing or twist limit against its parent. */
  private held(i: number): boolean {
    if (this.anchored[i]) return true;
    if (this.parent[i]! < 0) return false;
    this.limits(i, false);
    return t3[0]! >= this.swingNow[i]! - HELD || t3[1]! >= this.twistNow[i]! - HELD;
  }

  /**
   * Stops the two points of each pair pushed apart this substep moving across the pair, as a contact with the world is
   * stopped, and slows their sliding along it by friction as strong as the push.
   */
  private stopPairs(): void {
    const { q, pressed: ps } = this;
    for (let c = 0; c < this.np; c++) {
      const o = c * PRESSED, k = ps[o]!, a = this.pairA[k]!, b = this.pairB[k]!;
      quatRotate(q, a * 4, ps[o + 4]!, ps[o + 5]!, ps[o + 6]!, t3, 0);
      const rax = t3[0]!, ray = t3[1]!, raz = t3[2]!;
      quatRotate(q, b * 4, ps[o + 7]!, ps[o + 8]!, ps[o + 9]!, t3, 0);
      const rbx = t3[0]!, rby = t3[1]!, rbz = t3[2]!;
      this.stopAlong(a, b, rax, ray, raz, rbx, rby, rbz, ps[o + 1]!, ps[o + 2]!, ps[o + 3]!, 1);
      this.relative(a, b, rax, ray, raz, rbx, rby, rbz);
      const sx = u3[0]!, sy = u3[1]!, sz = u3[2]!, slide = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (slide < 1e-9) continue;
      const most = (DYNAMIC * ps[o + 10]!) / this.h;
      this.stopAlong(a, b, rax, ray, raz, rbx, rby, rbz, sx / slide, sy / slide, sz / slide, most < slide ? most / slide : 1);
    }
  }

  /** How fast b's point (rb from its centre) moves against a's point (ra from its centre), into u3. */
  private relative(a: number, b: number, rax: number, ray: number, raz: number, rbx: number, rby: number, rbz: number): void {
    const { v, w } = this;
    u3[0] = v[b * 3]! + w[b * 3 + 1]! * rbz - w[b * 3 + 2]! * rby - (v[a * 3]! + w[a * 3 + 1]! * raz - w[a * 3 + 2]! * ray);
    u3[1] = v[b * 3 + 1]! + w[b * 3 + 2]! * rbx - w[b * 3]! * rbz - (v[a * 3 + 1]! + w[a * 3 + 2]! * rax - w[a * 3]! * raz);
    u3[2] = v[b * 3 + 2]! + w[b * 3]! * rby - w[b * 3 + 1]! * rbx - (v[a * 3 + 2]! + w[a * 3]! * ray - w[a * 3 + 1]! * rax);
  }

  /** Takes `share` of the two points' speed against each other along the unit line (nx, ny, nz), by an impulse each takes its share of. */
  private stopAlong(a: number, b: number, rax: number, ray: number, raz: number, rbx: number, rby: number, rbz: number, nx: number, ny: number, nz: number, share: number): void {
    const { v, w, invM, invI } = this;
    this.relative(a, b, rax, ray, raz, rbx, rby, rbz);
    const vn = u3[0]! * nx + u3[1]! * ny + u3[2]! * nz;
    const cax = ray * nz - raz * ny, cay = raz * nx - rax * nz, caz = rax * ny - ray * nx;
    const cbx = rby * nz - rbz * ny, cby = rbz * nx - rbx * nz, cbz = rbx * ny - rby * nx;
    const weights = invM[a]! + invI[a]! * (cax * cax + cay * cay + caz * caz) + invM[b]! + invI[b]! * (cbx * cbx + cby * cby + cbz * cbz);
    if (weights <= 0) return;
    const j = (vn * share) / weights;
    v[a * 3]! += nx * j * invM[a]!; v[a * 3 + 1]! += ny * j * invM[a]!; v[a * 3 + 2]! += nz * j * invM[a]!;
    w[a * 3]! += cax * j * invI[a]!; w[a * 3 + 1]! += cay * j * invI[a]!; w[a * 3 + 2]! += caz * j * invI[a]!;
    v[b * 3]! -= nx * j * invM[b]!; v[b * 3 + 1]! -= ny * j * invM[b]!; v[b * 3 + 2]! -= nz * j * invM[b]!;
    w[b * 3]! -= cbx * j * invI[b]!; w[b * 3 + 1]! -= cby * j * invI[b]!; w[b * 3 + 2]! -= cbz * j * invI[b]!;
  }

  /**
   * Measures body `i`'s swing and twist against its parent into t3[0] and t3[1]. With `hold`, first turns the two bodies
   * back within the limits now, each by its share.
   */
  private limits(i: number, hold: boolean): void {
    const p = this.parent[i]!;
    t3[0] = 0;
    t3[1] = 0;
    if (p < 0) return;
    const { q, invI } = this;
    const dx = this.dir[i * 3]!, dy = this.dir[i * 3 + 1]!, dz = this.dir[i * 3 + 2]!;
    const wsum = invI[i]! + invI[p]!;
    quatRotate(q, p * 4, dx, dy, dz, u3, 0);
    let apx = u3[0]!, apy = u3[1]!, apz = u3[2]!;
    quatRotate(q, i * 4, dx, dy, dz, u3, 0);
    let acx = u3[0]!, acy = u3[1]!, acz = u3[2]!;
    const nx = apy * acz - apz * acy, ny = apz * acx - apx * acz, nz = apx * acy - apy * acx;
    const s = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const swing = detAtan2(s, apx * acx + apy * acy + apz * acz);
    if (hold && wsum <= 0) hold = false;
    if (hold && swing > this.swingNow[i]! && s > 1e-9) {
      // Turning the parent about a_p x a_c brings a_p toward a_c, and the child the other way brings a_c back.
      const turn = (swing - this.swingNow[i]!) / (s * wsum);
      this.spin(p, nx * turn * invI[p]!, ny * turn * invI[p]!, nz * turn * invI[p]!);
      this.spin(i, -nx * turn * invI[i]!, -ny * turn * invI[i]!, -nz * turn * invI[i]!);
      quatRotate(q, p * 4, dx, dy, dz, u3, 0);
      apx = u3[0]!;
      apy = u3[1]!;
      apz = u3[2]!;
      quatRotate(q, i * 4, dx, dy, dz, u3, 0);
      acx = u3[0]!;
      acy = u3[1]!;
      acz = u3[2]!;
    }
    // Twist about the axis halfway between the two, from the line square to it on each.
    let mx = apx + acx, my = apy + acy, mz = apz + acz;
    const ml = Math.sqrt(mx * mx + my * my + mz * mz);
    if (ml < 1e-9) {
      t3[0] = swing;
      return;
    }
    mx /= ml;
    my /= ml;
    mz /= ml;
    const ux = this.perp[i * 3]!, uy = this.perp[i * 3 + 1]!, uz = this.perp[i * 3 + 2]!;
    quatRotate(q, p * 4, ux, uy, uz, u3, 0);
    let along = u3[0]! * mx + u3[1]! * my + u3[2]! * mz;
    const bpx = u3[0]! - along * mx, bpy = u3[1]! - along * my, bpz = u3[2]! - along * mz;
    quatRotate(q, i * 4, ux, uy, uz, u3, 0);
    along = u3[0]! * mx + u3[1]! * my + u3[2]! * mz;
    const bcx = u3[0]! - along * mx, bcy = u3[1]! - along * my, bcz = u3[2]! - along * mz;
    const cx = bpy * bcz - bpz * bcy, cy = bpz * bcx - bpx * bcz, cz = bpx * bcy - bpy * bcx;
    const twist = detAtan2(cx * mx + cy * my + cz * mz, bpx * bcx + bpy * bcy + bpz * bcz);
    t3[0] = swing;
    t3[1] = twist < 0 ? -twist : twist;
    const lim = this.twistNow[i]!;
    if (!hold || (twist <= lim && twist >= -lim)) return;
    const turn = (twist > 0 ? twist - lim : twist + lim) / wsum;
    this.spin(p, mx * turn * invI[p]!, my * turn * invI[p]!, mz * turn * invI[p]!);
    this.spin(i, -mx * turn * invI[i]!, -my * turn * invI[i]!, -mz * turn * invI[i]!);
  }

  /** World-space centre offset in t3, half segment in u3, and radius. Legacy bodies keep the original arithmetic. */
  private shape(i: number, extra: number): number {
    if (extra < 0) {
      const centre = this.primaryOffset;
      if (this.def.massCentres?.[i] && centre) quatRotate(this.q, i * 4, centre[i * 3]!, centre[i * 3 + 1]!, centre[i * 3 + 2]!, t3, 0);
      else t3[0] = t3[1] = t3[2] = 0;
      quatRotate(this.q, i * 4, this.seg[i * 3]!, this.seg[i * 3 + 1]!, this.seg[i * 3 + 2]!, u3, 0);
      return this.rad[i]!;
    }
    const c = extra * 3, centre = this.contactCentre, segment = this.contactSegment;
    quatRotate(this.q, i * 4, centre[c]!, centre[c + 1]!, centre[c + 2]!, t3, 0);
    quatRotate(this.q, i * 4, segment[c]!, segment[c + 1]!, segment[c + 2]!, u3, 0);
    return this.contactRadius[extra]!;
  }

  private collide(world: CollisionWorld, i: number, extra = -1): void {
    this.terrain(world.hf, i, extra);
    for (let k = 0; k < this.nRefs; k++) {
      const store = this.refStore[k]!;
      this.boxes(store === 1 ? world.nodes! : world.structs, this.refs[k]!, i, extra);
      if (store === 2) this.parts(world.structs, this.refs[k]!, i, extra);
    }
  }

  /** Pushes body `i` out of the ground at points along its own or an attached capsule. */
  private terrain(hf: Heightfield, i: number, extra = -1): void {
    const x = this.x, r = this.shape(i, extra);
    const ox = t3[0]!, oy = t3[1]!, oz = t3[2]!;
    const sx = u3[0]!, sy = u3[1]!, sz = u3[2]!;
    const half = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const points = half < 0.25 * r ? 1 : 2 + Math.floor((2 * half) / SPACING);
    for (let k = 0; k < points; k++) {
      const t = points === 1 ? 0 : -1 + (2 * k) / (points - 1);
      const cx = x[i * 3]! + ox + sx * t;
      const cy = x[i * 3 + 1]! + oy + sy * t;
      const cz = x[i * 3 + 2]! + oz + sz * t;
      groundAt(hf, cx, cz, g4);
      const deep = r - (cy - g4[0]!) * g4[2]!;
      if (deep > 0) this.contact(i, ox + sx * t - g4[1]! * r, oy + sy * t - g4[2]! * r, oz + sz * t - g4[3]! * r, g4[1]!, g4[2]!, g4[3]!, deep);
    }
  }

  /** Pushes body `i` out of the boxes of one structure: at each end of its capsule, and at the point of it nearest a box. */
  private boxes(structs: StructureStore, ref: number, i: number, extra = -1): void {
    const t = structs.chunks[Math.floor(ref / 65536)];
    if (!t) return;
    const slot = ref & 0xffff;
    const kind = t.kind[slot]!;
    if (kind === 0) return;
    frameOf(t.yaw[slot]!);
    const s = frame.sin, c = frame.cos, wide = frame.stretch;
    const x = this.x;
    const r = this.shape(i, extra), ox = t3[0]!, oy = t3[1]!, oz = t3[2]!;
    const wx = u3[0]!, wy = u3[1]!, wz = u3[2]!;
    // The capsule's centre and half segment in the structure's frame: x' = c x - s z, z' = s x + c z.
    const ex = x[i * 3]! + ox - t.x[slot]!, ey = x[i * 3 + 1]! + oy - t.y[slot]!, ez = x[i * 3 + 2]! + oz - t.z[slot]!;
    const fx = c * ex - s * ez, fz = s * ex + c * ez;
    const gx = c * wx - s * wz, gy = wy, gz = s * wx + c * wz;
    const reach = Math.sqrt(gx * gx + gy * gy + gz * gz) + r;
    const len = gx * gx + gy * gy + gz * gz;
    const box6 = structs.parts.box;
    for (let b = structs.parts.start[kind]! * 6, end = structs.parts.start[kind + 1]! * 6; b < end; b += 6) {
      const hx = box6[b + 3]! * wide, hy = box6[b + 4]!, hz = box6[b + 5]! * wide;
      // From the box's centre.
      const lx = fx - box6[b]! * wide, ly = ey - box6[b + 1]!, lz = fz - box6[b + 2]! * wide;
      if (Math.abs(lx) > hx + reach || Math.abs(ly) > hy + reach || Math.abs(lz) > hz + reach) continue;
      // An attached sphere has one point, not three coincident constraints.
      // Keep the legacy body path unchanged when this contract is absent.
      for (let k = 0, points = extra >= 0 && len < 1e-12 ? 1 : 3; k < points; k++) {
        let tt = k === 0 ? -1 : 1;
        if (k === 2) {
          // The point of the segment nearest the box, by turns of nearest point on each.
          tt = 0;
          for (let it = 0; it < 3 && len > 1e-12; it++) {
            const qx = clamp(lx + gx * tt, hx), qy = clamp(ly + gy * tt, hy), qz = clamp(lz + gz * tt, hz);
            tt = ((qx - lx) * gx + (qy - ly) * gy + (qz - lz) * gz) / len;
            tt = tt < -1 ? -1 : tt > 1 ? 1 : tt;
          }
          if (tt <= -0.95 || tt >= 0.95) continue;
        }
        const ax = lx + gx * tt, ay = ly + gy * tt, az = lz + gz * tt;
        let nx = ax - clamp(ax, hx), ny = ay - clamp(ay, hy), nz = az - clamp(az, hz);
        const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
        let deep: number;
        if (d > 1e-9) {
          if (d >= r) continue;
          deep = r - d;
          nx /= d;
          ny /= d;
          nz /= d;
        } else {
          // Inside the box: out by the nearest face.
          const ox = hx - Math.abs(ax), oy = hy - Math.abs(ay), oz = hz - Math.abs(az);
          nx = ny = nz = 0;
          if (oy <= ox && oy <= oz) [ny, deep] = [ay < 0 ? -1 : 1, oy + r];
          else if (ox <= oz) [nx, deep] = [ax < 0 ? -1 : 1, ox + r];
          else [nz, deep] = [az < 0 ? -1 : 1, oz + r];
        }
        // The normal back in the world: x = c x' + s z', z = c z' - s x'.
        const mx = c * nx + s * nz, mz = c * nz - s * nx;
        this.contact(i, ox + wx * tt - mx * r, oy + wy * tt - ny * r, oz + wz * tt - mz * r, mx, ny, mz, deep);
      }
    }
  }

  /**
   * Pushes body `i` out of the convex parts of one structure as out of its boxes: as spheres at the ends of its capsule and at
   * the point of it nearest each part. A part is placed in the world's axes about the structure's middle, so the capsule is
   * measured from there unturned.
   */
  private parts(structs: StructureStore, ref: number, i: number, extra = -1): void {
    const t = structs.chunks[Math.floor(ref / 65536)];
    const hulls = structs.parts.hulls;
    if (!t || !hulls) return;
    const slot = ref & 0xffff;
    const kind = t.kind[slot]!;
    const yaw = t.yaw[slot]!;
    const r = this.shape(i, extra), ox = t3[0]!, oy = t3[1]!, oz = t3[2]!;
    const wx = u3[0]!, wy = u3[1]!, wz = u3[2]!;
    const ex = this.x[i * 3]! + ox - t.x[slot]!, ey = this.x[i * 3 + 1]! + oy - t.y[slot]!, ez = this.x[i * 3 + 2]! + oz - t.z[slot]!;
    const len = wx * wx + wy * wy + wz * wz;
    const reach = Math.sqrt(len) + r;
    for (let p = hulls.start[kind]!, end = hulls.start[kind + 1]!; p < end; p++) {
      if (!capsuleHull(hulls, p, yaw, ex, ez, ey, ey, reach, reach)) continue;
      // An attached sphere has one point, not three coincident constraints.
      // Keep the legacy body path unchanged when this contract is absent.
      for (let k = 0, points = extra >= 0 && len < 1e-12 ? 1 : 3; k < points; k++) {
        let tt = k === 0 ? -1 : 1;
        if (k === 2) {
          tt = 0;
          for (let it = 0; it < 3 && len > 1e-12; it++) {
            const ay = ey + wy * tt;
            // With no radius the push reaches from the point to the part's nearest point. A point inside stays where it is.
            capsuleHull(hulls, p, yaw, ex + wx * tt, ez + wz * tt, ay, ay, 0, Infinity);
            if (hullPush.depth > 0) break;
            tt += (hullPush.x * wx + hullPush.y * wy + hullPush.z * wz) / len;
            tt = tt < -1 ? -1 : tt > 1 ? 1 : tt;
          }
          if (tt <= -0.95 || tt >= 0.95) continue;
        }
        const ay = ey + wy * tt;
        if (!capsuleHull(hulls, p, yaw, ex + wx * tt, ez + wz * tt, ay, ay, r, r)) continue;
        const deep = hullPush.depth;
        const nx = hullPush.x / deep, ny = hullPush.y / deep, nz = hullPush.z / deep;
        this.contact(i, ox + wx * tt - nx * r, oy + wy * tt - ny * r, oz + wz * tt - nz * r, nx, ny, nz, deep);
      }
    }
  }

  /** Body `i`'s point (rx, ry, rz) from its centre is `deep` into the world along the normal (nx, ny, nz). */
  private contact(i: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number, deep: number): void {
    if (this.probing) {
      if (deep > this.worst) this.worst = deep;
      return;
    }
    if (ny > .35) this.supported = true;
    else if (!this.supported && ny > .01) {
      // A V-notch supports a body through both walls even when neither wall can hold it alone. Require
      // opposing horizontal normals with a genuinely upward resultant; a single cliff remains a fall.
      const horizontal = len3(nx, 0, nz);
      for (let c = 0; c < this.nc; c++) {
        const py = this.cn[c * 3 + 1]!;
        if (py <= .01) continue;
        const px = this.cn[c * 3]!, pz = this.cn[c * 3 + 2]!, other = len3(px, 0, pz);
        if (other < 1e-8 || nx * px + nz * pz > -.98 * horizontal * other) continue;
        const sx = nx / horizontal + px / other, sz = nz / horizontal + pz / other, sy = ny / horizontal + py / other;
        if (sx * sx + sz * sz < sy * sy) { this.supported = true; break; }
      }
    }
    if (this.firstSupport && this.supported) {
      const point = this.firstSupport, k = i * 3;
      point[0] = this.x[k]! + rx + nx * deep;
      point[1] = this.x[k + 1]! + ry + ny * deep;
      point[2] = this.x[k + 2]! + rz + nz * deep;
      this.firstSupport = null;
    }
    if (deep > PUSH_OUT * this.h) deep = PUSH_OUT * this.h;
    // The point in the body's frame, so that where it was at the start of the substep can be found after it is pushed out.
    quatUnrotate(this.q, i * 4, rx, ry, rz, g4, 0);
    const lx = g4[0]!, ly = g4[1]!, lz = g4[2]!;
    this.push(i, rx, ry, rz, nx * deep, ny * deep, nz * deep);
    quatRotate(this.q, i * 4, lx, ly, lz, u3, 0);
    const ax = u3[0]!, ay = u3[1]!, az = u3[2]!;
    quatRotate(this.pq, i * 4, lx, ly, lz, t3, 0);
    let dx = this.x[i * 3]! + ax - this.px[i * 3]! - t3[0]!;
    let dy = this.x[i * 3 + 1]! + ay - this.px[i * 3 + 1]! - t3[1]!;
    let dz = this.x[i * 3 + 2]! + az - this.px[i * 3 + 2]! - t3[2]!;
    const along = dx * nx + dy * ny + dz * nz;
    dx -= along * nx;
    dy -= along * ny;
    dz -= along * nz;
    // Static friction: a point that would slide less than its share of the push holds where it was.
    if (dx * dx + dy * dy + dz * dz < STATIC * STATIC * deep * deep) {
      this.push(i, ax, ay, az, -dx, -dy, -dz);
      this.roll(i, lx, ly, lz, deep);
    }
    const c = this.nc;
    if (c >= MOST_CONTACTS) return;
    this.nc++;
    this.cb[c] = i;
    set3(this.cn, c, nx, ny, nz);
    quatRotate(this.q, i * 4, lx, ly, lz, u3, 0);
    set3(this.cr, c, u3[0]!, u3[1]!, u3[2]!);
    this.cd[c] = deep;
  }

  /**
   * Rolling resistance holds a turn as static friction holds a point: where stopping body `i`'s turn this substep about
   * its held point (lx, ly, lz) in its frame takes no more than rolling resistance gives, it is turned back to how it
   * was. It presses with no more than its own weight: a deeper push is a joint pressing a limb into the world, and the
   * limb must give to its joint. Without this a body resting on a slope rolls on by what gravity pulls it each substep.
   */
  private roll(i: number, lx: number, ly: number, lz: number, deep: number): void {
    const { q, pq } = this;
    const o = i * 4;
    // The turn this substep, q * conj(pq), as a small rotation.
    const ax = q[o]!, ay = q[o + 1]!, az = q[o + 2]!, aw = q[o + 3]!;
    const bx = -pq[o]!, by = -pq[o + 1]!, bz = -pq[o + 2]!, bw = pq[o + 3]!;
    const s = aw * bw - ax * bx - ay * by - az * bz < 0 ? -2 : 2;
    const tx = (aw * bx + ax * bw + ay * bz - az * by) * s;
    const ty = (aw * by - ax * bz + ay * bw + az * bx) * s;
    const tz = (aw * bz + ax * by - ay * bx + az * bw) * s;
    const turn = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (turn < 1e-12) return;
    quatRotate(q, o, lx, ly, lz, u3, 0);
    const rx = u3[0]!, ry = u3[1]!, rz = u3[2]!;
    // Stopping it about the point, by the parallel axis, against pressing on the world that share of the radius off it.
    const cx = ty * rz - tz * ry, cy = tz * rx - tx * rz, cz = tx * ry - ty * rx;
    const press = Math.min(deep, GRAVITY * this.h * this.h);
    if ((turn * this.invM[i]!) / this.invI[i]! + (cx * cx + cy * cy + cz * cz) / turn > ROLL * this.rad[i]! * press) return;
    quatRotate(pq, o, lx, ly, lz, t3, 0);
    this.x[i * 3]! += rx - t3[0]!;
    this.x[i * 3 + 1]! += ry - t3[1]!;
    this.x[i * 3 + 2]! += rz - t3[2]!;
    for (let k = 0; k < 4; k++) q[o + k] = pq[o + k]!;
  }

  /**
   * At contact `c`: no motion into the surface or away from it, by an impulse at the point that may turn the body; its
   * turning about the point slowed by rolling resistance, the point moving on as it was; and the point's sliding slowed
   * by friction, taken from the body's motion as a whole.
   */
  private slide(c: number, h: number): void {
    const i = this.cb[c]!;
    const v = this.v;
    const w = this.w;
    const o = i * 3;
    const invM = this.invM[i]!, invI = this.invI[i]!;
    const load = this.cd[c]! / h;
    const nx = this.cn[c * 3]!, ny = this.cn[c * 3 + 1]!, nz = this.cn[c * 3 + 2]!;
    const rx = this.cr[c * 3]!, ry = this.cr[c * 3 + 1]!, rz = this.cr[c * 3 + 2]!;
    let vx = v[o]! + w[o + 1]! * rz - w[o + 2]! * ry;
    let vy = v[o + 1]! + w[o + 2]! * rx - w[o]! * rz;
    let vz = v[o + 2]! + w[o]! * ry - w[o + 1]! * rx;
    let vn = vx * nx + vy * ny + vz * nz;
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const j = -vn / (invM + invI * (cx * cx + cy * cy + cz * cz));
    v[o]! += nx * j * invM;
    v[o + 1]! += ny * j * invM;
    v[o + 2]! += nz * j * invM;
    w[o]! += cx * j * invI;
    w[o + 1]! += cy * j * invI;
    w[o + 2]! += cz * j * invI;
    vx = v[o]! + w[o + 1]! * rz - w[o + 2]! * ry;
    vy = v[o + 1]! + w[o + 2]! * rx - w[o]! * rz;
    vz = v[o + 2]! + w[o]! * ry - w[o + 1]! * rx;
    vn = vx * nx + vy * ny + vz * nz;
    const spin = Math.sqrt(w[o]! * w[o]! + w[o + 1]! * w[o + 1]! + w[o + 2]! * w[o + 2]!);
    if (spin > 1e-12) {
      // Its turning about the point, by the parallel axis, against what pressing that share of the radius off the point
      // takes away; what is taken leaves the point moving as it was.
      const ux = w[o + 1]! * rz - w[o + 2]! * ry, uy = w[o + 2]! * rx - w[o]! * rz, uz = w[o]! * ry - w[o + 1]! * rx;
      const about = (spin * invM) / invI + (ux * ux + uy * uy + uz * uz) / spin;
      const most = ROLL * this.rad[i]! * load;
      const less = most < about ? most / about : 1;
      v[o]! += ux * less;
      v[o + 1]! += uy * less;
      v[o + 2]! += uz * less;
      w[o]! -= w[o]! * less;
      w[o + 1]! -= w[o + 1]! * less;
      w[o + 2]! -= w[o + 2]! * less;
    }
    const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt < 1e-9) return;
    const slow = (DYNAMIC * load < vt ? DYNAMIC * load : vt) / vt;
    v[o]! -= tx * slow;
    v[o + 1]! -= ty * slow;
    v[o + 2]! -= tz * slow;
  }

  /** The deepest any of its capsules is under the ground or inside a box or part of the world, in metres. 0 when clear. */
  deepest(world: CollisionWorld): number {
    this.probing = true;
    this.worst = 0;
    this.gather(world, 0);
    for (let i = 0; i < this.n; i++) this.collide(world, i);
    for (let c = 0; c < this.contactBone.length; c++) this.collide(world, this.contactOwner[c]!, c);
    this.probing = false;
    return this.worst;
  }
}

/** least x, least z, most x, most z. */
const box = new Float64Array(4);
/** Two capsules: centre, half segment and radius of each. */
const caps = new Float64Array(14);
/** The nearest points of the last two segments measured, the first's then the second's. */
const near = new Float64Array(6);
/** Each pair's overlap past what it may, and its two nearest points, in one substep. */
const overlap = new Float64Array(MOST_PAIRS);
const nearest = new Float64Array(MOST_PAIRS * 6);
/** A turn about +Y, and a drive's aim. */
const face = new Float64Array([0, 0, 0, 1]);
const aim = new Float64Array(4);
const IDENTITY = [0, 0, 0, 1];

/** out at o = a and b at i blended `t` of the way, the shorter way round, made whole again. */
function nlerp(out: Float64Array, o: number, a: Float64Array, b: Float64Array, i: number, t: number): void {
  const sign = a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]! < 0 ? -1 : 1;
  let l = 0;
  for (let k = 0; k < 4; k++) {
    const v = a[i + k]! + (b[i + k]! * sign - a[i + k]!) * t;
    out[o + k] = v;
    l += v * v;
  }
  l = 1 / Math.sqrt(l);
  for (let k = 0; k < 4; k++) out[o + k]! *= l;
}

/** How far apart the two segments in `caps` come, with their nearest points into `near`. */
function closest(c: Float64Array): number {
  const d1x = 2 * c[3]!, d1y = 2 * c[4]!, d1z = 2 * c[5]!, d2x = 2 * c[10]!, d2y = 2 * c[11]!, d2z = 2 * c[12]!;
  const p1x = c[0]! - c[3]!, p1y = c[1]! - c[4]!, p1z = c[2]! - c[5]!;
  const p2x = c[7]! - c[10]!, p2y = c[8]! - c[11]!, p2z = c[9]! - c[12]!;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a > 1e-12 || e > 1e-12) {
    if (a <= 1e-12) t = unit(f / e);
    else {
      const cc = d1x * rx + d1y * ry + d1z * rz;
      if (e <= 1e-12) s = unit(-cc / a);
      else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z, denom = a * e - b * b;
        s = denom > 1e-12 ? unit((b * f - cc * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = unit(-cc / a); }
        else if (t > 1) { t = 1; s = unit((b - cc) / a); }
      }
    }
  }
  near[0] = p1x + d1x * s; near[1] = p1y + d1y * s; near[2] = p1z + d1z * s;
  near[3] = p2x + d2x * t; near[4] = p2y + d2y * t; near[5] = p2z + d2z * t;
  const dx = near[3]! - near[0]!, dy = near[4]! - near[1]!, dz = near[5]! - near[2]!;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function unit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function set3(a: Float64Array, i: number, x: number, y: number, z: number): void {
  a[i * 3] = x;
  a[i * 3 + 1] = y;
  a[i * 3 + 2] = z;
}

function clamp(v: number, h: number): number {
  return v < -h ? -h : v > h ? h : v;
}

/** o = a * b. */
function mulInto(o: Float64Array | Float32Array, oi: number, a: Float64Array | Float32Array, ai: number, b: Float64Array | Float32Array, bi: number): void {
  const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** o = conj(a) * b. */
function conjMulInto(o: Float64Array | Float32Array, oi: number, a: Float64Array | Float32Array, ai: number, b: Float64Array | Float32Array, bi: number): void {
  const ax = -a[ai]!, ay = -a[ai + 1]!, az = -a[ai + 2]!, aw = a[ai + 3]!;
  const bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!;
  o[oi] = aw * bx + ax * bw + ay * bz - az * by;
  o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/**
 * The height of the terrain at (x, z) into out[0], and the up normal of the triangle there into out[1..3]: the triangles
 * Heightfield.heightAt reads.
 */
export function groundAt(hf: Heightfield, x: number, z: number, out: Float64Array): void {
  const nx = hf.nx;
  let fx = x / hf.cell;
  let fz = z / hf.cell;
  if (fx < 0) fx = 0;
  else if (fx > nx - 1) fx = nx - 1;
  if (fz < 0) fz = 0;
  else if (fz > hf.nz - 1) fz = hf.nz - 1;
  let i = Math.floor(fx);
  let j = Math.floor(fz);
  if (i > nx - 2) i = nx - 2;
  if (j > hf.nz - 2) j = hf.nz - 2;
  const u = fx - i;
  const v = fz - j;
  const k = j * nx + i;
  const hts = hf.heights;
  const h00 = hts[k]!;
  const h11 = hts[k + nx + 1]!;
  let du: number;
  let dv: number;
  if (u >= v) {
    const h10 = hts[k + 1]!;
    du = h10 - h00;
    dv = h11 - h10;
  } else {
    const h01 = hts[k + nx]!;
    du = h11 - h01;
    dv = h01 - h00;
  }
  out[0] = hf.minY + (h00 + du * u + dv * v) * hf.stepY;
  const s = hf.stepY / hf.cell;
  const l = 1 / Math.sqrt(du * du * s * s + 1 + dv * dv * s * s);
  out[1] = -du * s * l;
  out[2] = l;
  out[3] = -dv * s * l;
}
