// A few authored cloth rigs use the existing native bone path at every distance. Static/far city meshes never own them.
import type { Registry } from "../../../shared/content/registry.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import type { SailVisual } from "../../../shared/sim/sail-rig.ts";
import { sailsProgress, type SailSource, type SailState } from "../../../shared/sim/sails.ts";
import { frameAxes, HALF_SIDE } from "../../../shared/world/frame.ts";
import type { AssetTable } from "../assets/table.ts";
import type { Camera } from "./camera.ts";
import { BONE_FLOATS } from "./packet.ts";
import type { CastTest } from "./terrain.ts";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;

/** Rest-space skin matrices: rigid connected folds, and a rigid head spar following their vertical extension. */
export function sailPose(out: Float32Array, sail: SailVisual, progress: number): void {
  const p = Math.max(0, Math.min(1, progress));
  for (let i = 0; i < sail.bones.length; i++) out.set(IDENTITY, i * BONE_FLOATS);
  if (p === 1) return;
  // Ease only the visual hinge angle: authority stays linear, and reversing at a progress value keeps the same pose.
  const phase = p * p * (3 - 2 * p);
  let across = 0, along = 0;
  for (let i = 0; i < sail.bands.length; i++) {
    const band = sail.bands[i]!, length = band.upper - band.lower;
    const angle = (i & 1 ? -1 : 1) * sail.foldSign * (1 - phase) * Math.acos(sail.stackStep / length);
    const c = Math.cos(angle), s = Math.sin(angle), at = band.index * BONE_FLOATS;
    // Both kinds fold first toward local -X. Their hinge is the untouched third dimension.
    if (sail.bandAxis === "y") out.set([c, -s, 0, across + s * band.lower, s, c, 0, along - c * band.lower, 0, 0, 1, 0], at);
    else out.set([c, 0, -s, across + s * band.lower, 0, 1, 0, 0, s, 0, c, along - c * band.lower], at);
    across -= s * length; along += c * length;
  }
  const gaff = sail.gaff;
  if (gaff) {
    const fraction = Math.max(0, Math.min(1, along / sail.bands.at(-1)!.upper));
    const angle = gaff.lowerAngle - Math.asin(fraction * Math.sin(gaff.lowerAngle)), c = Math.cos(angle), s = Math.sin(angle);
    const [, y, z] = gaff.throat, targetY = gaff.lowerThroatY + (y - gaff.lowerThroatY) * fraction;
    out.set([1, 0, 0, 0, 0, c, -s, targetY - c * y + s * z, 0, s, c, z - s * y - c * z], sail.bones.indexOf(gaff.bone) * BONE_FLOATS);
  }
}

const axes = new Int32Array(4);

/** Apply the native map yaw and authored right-handed sail basis, ending in camera-relative world metres. */
export function sailWorldPose(out: Float32Array, sail: SailVisual, state: Pick<SailState, "x" | "y" | "z" | "yaw">, camera: Pick<Camera, "x" | "y" | "z">): void {
  frameAxes(state.yaw, axes);
  const xx = axes[0]! / HALF_SIDE, xz = axes[1]! / HALF_SIDE, zx = axes[2]! / HALF_SIDE, zz = axes[3]! / HALF_SIDE;
  const b = sail.basis, a = sail.anchor;
  const m00 = xx * b[0][0] + zx * b[0][2], m01 = xx * b[1][0] + zx * b[1][2], m02 = xx * b[2][0] + zx * b[2][2];
  const m10 = b[0][1], m11 = b[1][1], m12 = b[2][1];
  const m20 = xz * b[0][0] + zz * b[0][2], m21 = xz * b[1][0] + zz * b[1][2], m22 = xz * b[2][0] + zz * b[2][2];
  const tx = state.x - camera.x + xx * a[0] + zx * a[2], ty = state.y - camera.y + a[1], tz = state.z - camera.z + xz * a[0] + zz * a[2];
  for (let at = 0; at < sail.bones.length * BONE_FLOATS; at += BONE_FLOATS) {
    for (let c = 0; c < 4; c++) {
      const x = out[at + c]!, y = out[at + 4 + c]!, z = out[at + 8 + c]!;
      out[at + c] = m00 * x + m01 * y + m02 * z + (c === 3 ? tx : 0);
      out[at + 4 + c] = m10 * x + m11 * y + m12 * z + (c === 3 ? ty : 0);
      out[at + 8 + c] = m20 * x + m21 * y + m22 * z + (c === 3 ? tz : 0);
    }
  }
}

/** Conservative dynamic bounds of weighted vertices: a weighted point stays inside its transformed bones' union. */
export function sailPoseBounds(out: Float64Array, sail: SailVisual, pose: Float32Array): boolean {
  const boxes = sail.boneBounds; if (!boxes) return false;
  out.fill(Infinity, 0, 3); out.fill(-Infinity, 3, 6);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!, at = i * BONE_FLOATS;
    for (let corner = 0; corner < 8; corner++) {
      const x = box[(corner & 1) ? 3 : 0], y = box[(corner & 2) ? 4 : 1], z = box[(corner & 4) ? 5 : 2];
      for (let a = 0; a < 3; a++) {
        const q = at + a * 4, value = pose[q]! * x + pose[q + 1]! * y + pose[q + 2]! * z + pose[q + 3]!;
        out[a] = Math.min(out[a]!, value); out[a + 3] = Math.max(out[a + 3]!, value);
      }
    }
  }
  return true;
}

export interface SailDraw {
  readonly visual: SailVisual;
  readonly mesh: number;
  readonly pose: Float32Array;
  readonly box: Float64Array;
  level: number;
  seen: boolean;
  casts: number;
  distance: number;
}

export interface SailGroupDraw {
  state: SailState;
  readonly sails: SailDraw[];
  progress: number;
  distance: number;
  bones: number;
}

/** Binding is strict when an authored mesh exists; incomplete graybox packs are reported missing by the Scene. */
export class SailVisuals {
  readonly stats = { groups: 0, sails: 0, bones: 0, missing: 0, limited: 0 };
  private readonly byKind: readonly (readonly { visual: SailVisual; mesh: number }[] | null)[];
  private states: readonly SailState[] | null = null;
  private groups: SailGroupDraw[] = [];
  readonly shown: SailGroupDraw[] = [];

  constructor(reg: Registry, table: AssetTable, pack: Pack) {
    this.byKind = reg.sails.map(control => control?.rig.sails.map(visual => {
      const mesh = table.find(visual.mesh);
      if (mesh >= 0) {
        const rig = pack.header.rigs[table.rig[mesh]!];
        if (table.skeleton[mesh] !== visual.skeleton || !rig || rig.skeleton !== visual.skeleton || rig.names?.length !== visual.bones.length || rig.names.some((name, i) => name !== visual.bones[i])) throw new Error(`${visual.mesh}: packed sail bone order does not match its authored rig`);
      }
      return { visual, mesh };
    }) ?? null);
  }

  prepare(source: SailSource, cam: Camera, reach: number, caster: CastTest | null): readonly SailGroupDraw[] {
    const states = source.states(), tick = source.tick(), stats = this.stats;
    [stats.groups, stats.sails, stats.bones, stats.missing, stats.limited] = [0, 0, 0, 0, 0];
    if (states !== this.states) {
      const old = new Map(this.groups.map(group => [group.state.ref, group]));
      this.groups = states.flatMap(state => {
        const visuals = this.byKind[state.kind]; if (!visuals) return [];
        const prior = old.get(state.ref);
        if (prior?.state.kind === state.kind) { prior.state = state; return [prior]; }
        return [{ state, progress: 0, distance: 0, bones: 0, sails: visuals.map(({ visual, mesh }) => ({ visual, mesh, pose: new Float32Array(visual.bones.length * BONE_FLOATS), box: new Float64Array(6), level: -1, seen: false, casts: 0, distance: 0 })) }];
      });
      this.states = states;
    }
    this.shown.length = 0;
    for (const group of this.groups) {
      const state = group.state; group.progress = sailsProgress(state, tick); group.distance = Infinity; group.bones = 0;
      frameAxes(state.yaw, axes);
      const xx = axes[0]! / HALF_SIDE, xz = axes[1]! / HALF_SIDE, zx = axes[2]! / HALF_SIDE, zz = axes[3]! / HALF_SIDE;
      for (const entry of group.sails) {
        const { visual, box, pose } = entry, { center, radius } = visual.bounds;
        const x = state.x - cam.x + xx * center[0] + zx * center[2], y = state.y - cam.y + center[1], z = state.z - cam.z + xz * center[0] + zz * center[2];
        entry.seen = false; entry.casts = 0;
        if (Math.hypot(x, y, z) - radius > reach) continue;
        box.set([x - radius, y - radius, z - radius, x + radius, y + radius, z + radius]);
        if (!cam.boxVisible(...box as unknown as [number, number, number, number, number, number]) && (!caster || !caster(...box as unknown as [number, number, number, number, number, number]))) continue;
        sailPose(pose, visual, group.progress); sailWorldPose(pose, visual, state, cam); sailPoseBounds(box, visual, pose);
        entry.distance = Math.hypot(Math.max(box[0]!, -box[3]!, 0), Math.max(box[1]!, -box[4]!, 0), Math.max(box[2]!, -box[5]!, 0));
        entry.seen = entry.distance <= reach && cam.boxVisible(...box as unknown as [number, number, number, number, number, number]);
        entry.casts = caster?.(...box as unknown as [number, number, number, number, number, number]) ?? 0;
        if (!entry.seen && !entry.casts) continue;
        if (entry.mesh < 0) { stats.missing++; continue; }
        group.distance = Math.min(group.distance, entry.distance); group.bones += group.progress === 1 ? 1 : visual.bones.length;
      }
      if (group.bones) this.shown.push(group);
    }
    this.shown.sort((a, b) => a.distance - b.distance || a.state.ref - b.state.ref);
    return this.shown;
  }
}
