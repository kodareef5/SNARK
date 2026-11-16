// `bun tools/art/koru-fit.ts`: a dense offline audit; the small unit regression selects only the limiting states.
// Finest production body/armor/hair meshes, both sex rigs, full creator scales, all legal look/direction states,
// continuous phase at idle/walk(4.5m/s)/sprint(7.2m/s), and the direction quantizer's residual yaw.
// This certifies centred circulation, not a player pressing against walls, combat poses, jumps or every eased speed.
import { readFileSync } from "node:fs";
import { writeBones } from "../../client/core/render/characters.ts";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Gait, gaitShares } from "../../shared/anim/gait.ts";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, lookLift, lookScales, REGION_COUNT, setRegion } from "../../shared/anim/look.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { unpackMeshes } from "../pack/write.ts";
import { Solid, boxSolid, hullTable, partSolid } from "../../shared/world/convex.ts";
import { SKIN } from "../../shared/world/collide.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";

export interface KoruFitExtreme { value: number; mesh: string; sex: string; speed: number; phase: number; pitch: number; direction: number; }
export interface KoruFitReport {
  vertices: number; poses: number; intervals: number;
  phasePadding: number;
  phases: number; continuousPhase: boolean;
  minimum: KoruFitExtreme[]; maximum: KoruFitExtreme[];
  stairUp: KoruFitExtreme; stairDown: KoruFitExtreme;
}
export interface KoruFitOptions {
  phases?: number;
  /** Targeted regressions can inspect selected native states; the command-line audit covers all legal look/direction states. */
  motion?: readonly { speed: number; direction: number; pitch: number }[];
  continuousPhase?: boolean;
}
export interface KoruFitVertex { mesh: string; vertex: number; profile: number; at: readonly number[]; }

/** Feasible creator profiles through the renderer's exact matrices, used to distinguish a real strike from an interval overlap. */
export function actualKoruFit(sample: KoruFitExtreme, inspect?: (vertex: KoruFitVertex) => void, profiles = Array.from({ length: 3 + REGION_COUNT * 2 }, (_, i) => i)) {
  const bodies = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url))));
  const clips = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url))));
  const anim = new HumanAnim(clips.clips), selected = unpackMeshes(bodies).filter(m => m.id.startsWith(`core:human_${sample.sex}/`));
  const rest = Float32Array.from(bodies.header.rigs.find(r => r.id === `human_${sample.sex}`)!.rest);
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), scales = new Float32Array(HUMAN_BONES * 3), matrices = new Float32Array(HUMAN_BONES * 12);
  const result = { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity], witnesses: ["", "", "", "", "", ""] };
  for (const profile of profiles) {
    const look = defaultLook();
    if (profile > 0) for (let r = 0; r < REGION_COUNT; r++) {
      const base = profile === 1 || (profile >= 3 && profile < 3 + REGION_COUNT) ? -1 : 1;
      setRegion(look, r, profile >= 3 && r === (profile - 3) % REGION_COUNT ? -base : base);
    }
    const state = new AnimState(), gait = new Gait(); state.dir = sample.direction; state.pitch = sample.pitch; gait.speed = sample.speed; gait.phase = sample.phase;
    humanPose(anim, state, sample.phase * anim.idle!.frames, pose, gait); lookScales(look, scales); pose.root[1]! += lookLift(scales, rest);
    solve(HUMAN, pose, solved, rest, scales); writeBones(matrices, 0, solved, rest, scales, 0, 0, 0, -sample.direction * Math.PI / 8);
    for (const mesh of selected) { const lod = mesh.lods[0]!;
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const at = [0, 0, 0];
        for (let influence = 0; influence < (lod.joints && lod.weights ? 4 : 1); influence++) {
          const weight = lod.weights?.[v * 4 + influence] ?? 1, bone = lod.joints?.[v * 4 + influence] ?? lod.bones![v]!;
          for (let axis = 0; axis < 3; axis++) { const k = bone * 12 + axis * 4;
            at[axis]! += weight * (matrices[k]! * lod.positions[v * 3]! + matrices[k + 1]! * lod.positions[v * 3 + 1]! + matrices[k + 2]! * lod.positions[v * 3 + 2]! + matrices[k + 3]!);
          }
        }
        for (let axis = 0; axis < 3; axis++) {
          if (at[axis]! < result.minimum[axis]!) { result.minimum[axis] = at[axis]!; result.witnesses[axis] = `${mesh.id} vertex${v} profile${profile} at${at}`; }
          if (at[axis]! > result.maximum[axis]!) { result.maximum[axis] = at[axis]!; result.witnesses[axis + 3] = `${mesh.id} vertex${v} profile${profile} at${at}`; }
        }
        inspect?.({ mesh: mesh.id, vertex: v, profile, at });
      }
    }
  }
  return result;
}

let architecture: { id: string; support: boolean; min: number[]; max: number[]; planes: number[][] }[] | undefined;
/** Actual posed vertices against native authored solids at a bottleneck; cabin leaves are in their usable open state.
 * Floors and stair treads are support surfaces. The renderer has no stair foot IK; their ordinary sole contact is excluded,
 * while every guard, jamb, fitting and overhead solid remains in the check. */
export function auditKoruPoseAt(sample: KoruFitExtreme, profile: number, feet: readonly number[], yaw: number) {
  if (!architecture) {
    architecture = [];
    const modules = KORU_LAYOUT.modules, tuple = (p: readonly number[]): readonly [number, number, number] => [p[0]!, p[1]!, p[2]!];
    const table = hullTable(modules.length, i => modules[i]!.hulls.map(h => ({ corners: h.points.map(tuple) })));
    const add = (id: string, solid: Solid, support = false) => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], planes: number[][] = [];
      for (let v = 0; v < solid.corners; v++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, solid.at[v * 3 + a]!); max[a] = Math.max(max[a]!, solid.at[v * 3 + a]!); }
      for (let f = 0; f < solid.faces; f++) {
        const n = Array.from(solid.face.subarray(f * 3, f * 3 + 3)); let lo = Infinity, hi = -Infinity;
        for (let v = 0; v < solid.corners; v++) { const d = n.reduce((s, x, a) => s + x * solid.at[v * 3 + a]!, 0); lo = Math.min(lo, d); hi = Math.max(hi, d); }
        planes.push([...n, lo, hi]);
      }
      architecture!.push({ id, support, min, max, planes });
    };
    modules.forEach((m, i) => {
      if (m.category === "door" ? m.placed : !m.placed) return;
      frameOf(Math.round(m.yaw * 65536 / 360));
      const c = frame.cos, s = frame.sin, stretch = frame.stretch, origin = m.origin.map(v => Math.round(v * 512) / 512);
      m.boxes.forEach((b, part) => {
        const solid = new Solid(); boxSolid(origin[0]! + (c * b.at[0]! + s * b.at[2]!) * stretch, origin[1]! + b.at[1]!, origin[2]! + (-s * b.at[0]! + c * b.at[2]!) * stretch, c, s, b.half[0]! * stretch, b.half[1]!, b.half[2]! * stretch, solid);
        add(`${m.id}/box${part}`, solid, m.category === "floor" || (m.category === "stairs" && part === 0 && "landing" in m.art));
      });
      for (let part = table.start[i]!; part < table.start[i + 1]!; part++) {
        const solid = new Solid(); partSolid(table, part, Math.round(m.yaw * 65536 / 360), origin[0]!, origin[1]!, origin[2]!, solid);
        add(`${m.id}/hull${part - table.start[i]!}`, solid, m.category === "floor" || (m.category === "stairs" && part === table.start[i]!));
      }
    });
  }
  const near = architecture.filter(a => !(a.support && a.min[1]! <= feet[1]! + .5) && a.max[0]! > feet[0]! - 2 && a.min[0]! < feet[0]! + 2 && a.max[2]! > feet[2]! - 2 && a.min[2]! < feet[2]! + 2 && a.max[1]! > feet[1]! && a.min[1]! < feet[1]! + 3);
  const collisions = new Map<string, KoruFitVertex>(); let points = 0; const c = Math.cos(yaw), s = Math.sin(yaw);
  actualKoruFit(sample, vertex => {
    points++; const p = vertex.at, at = [feet[0]! + c * p[0]! + s * p[2]!, feet[1]! + p[1]!, feet[2]! - s * p[0]! + c * p[2]!];
    for (const a of near) {
      if (collisions.has(a.id) || at.some((v, axis) => v <= a.min[axis]! + SKIN || v >= a.max[axis]! - SKIN)) continue;
      if (a.planes.every(n => { const d = n[0]! * at[0]! + n[1]! * at[1]! + n[2]! * at[2]!; return d > n[3]! + SKIN && d < n[4]! - SKIN; })) collisions.set(a.id, { ...vertex, at });
    }
  }, [profile]);
  return { points, collisions: Array.from(collisions, ([solid, vertex]) => ({ solid, ...vertex })) };
}

/** Scale factors are positive products of monotone creator sliders, so their extrema enclose every mixed profile. */
export function auditKoruFit(options: number | KoruFitOptions = {}): KoruFitReport {
  const config = typeof options === "number" ? { phases: options } : options, phases = config.phases ?? 128;
  const bodies = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url))));
  const clips = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url))));
  const meshes = unpackMeshes(bodies), anim = new HumanAnim(clips.clips), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  const lowScale = new Float32Array(HUMAN_BONES * 3), highScale = new Float32Array(HUMAN_BONES * 3);
  for (const [out, value] of [[lowScale, -1], [highScale, 1]] as const) {
    const look = defaultLook(); for (let r = 0; r < REGION_COUNT; r++) setRegion(look, r, value); lookScales(look, out);
  }
  const blank = (value: number): KoruFitExtreme => ({ value, mesh: "", sex: "", speed: 0, phase: 0, pitch: 0, direction: 0 });
  const report: KoruFitReport = { vertices: meshes.reduce((n, m) => n + m.lods[0]!.positions.length / 3, 0), poses: 0, intervals: 0, phasePadding: 0, phases, continuousPhase: config.continuousPhase !== false,
    minimum: [blank(Infinity), blank(Infinity), blank(Infinity)], maximum: [blank(-Infinity), blank(-Infinity), blank(-Infinity)],
    stairUp: blank(-Infinity), stairDown: blank(-Infinity) };
  const axes = new Float64Array(HUMAN_BONES * 9), low = new Float64Array(HUMAN_BONES * 3), high = new Float64Array(HUMAN_BONES * 3), unit = [0, 0, 0];
  const sourceRates = new Map<typeof anim.idle, { angular: Float64Array; root: number }>();
  for (const clip of [anim.idle!, anim.walk!, anim.jog!, anim.sprint!]) {
    const angular = new Float64Array(HUMAN_BONES); let root = 0;
    for (let frame = 0; frame < clip.frames; frame++) {
      const next = (frame + 1) % clip.frames;
      root = Math.max(root, Math.hypot(...[0, 1, 2].map(axis => (clip.root[next * 3 + axis]! - clip.root[frame * 3 + axis]!) * clip.frames)));
      for (let bone = 0; bone < HUMAN_BONES; bone++) {
        let dot = 0; for (let k = 0; k < 4; k++) dot += clip.rot[(frame * HUMAN_BONES + bone) * 4 + k]! * clip.rot[(next * HUMAN_BONES + bone) * 4 + k]!;
        angular[bone] = Math.max(angular[bone]!, 4 * Math.tan(Math.acos(Math.min(1, Math.abs(dot))) / 2) * clip.frames);
      }
    }
    sourceRates.set(clip, { angular, root });
  }
  const rates = [0, 4.5, 7.2].map(speed => {
    const weights = new Float64Array(3); gaitShares(anim.standing, speed, true, weights);
    const active = speed ? anim.standing.flatMap((g, i) => weights[i]! > 0 ? [{ clip: g.clip, weight: weights[i]! }] : []) : [{ clip: anim.idle!, weight: 1 }];
    const angular = new Float64Array(HUMAN_BONES), root = active.reduce((v, a) => v + a.weight * sourceRates.get(a.clip)!.root, 0);
    for (let bone = 0; bone < HUMAN_BONES; bone++) {
      let norm = 1;
      if (active.length === 2) {
        const a = active[0]!, b = active[1]!;
        // Both curves lie in a quaternion spherical cap about a's first key. Normalized interpolation stays
        // in that cap; its diameter bounds the blend denominator even between keyframes.
        let dotMin = 1;
        for (const clip of [a.clip, b.clip]) for (let f = 0; f < clip.frames; f++) {
          let dot = 0; for (let k = 0; k < 4; k++) dot += a.clip.rot[bone * 4 + k]! * clip.rot[(f * HUMAN_BONES + bone) * 4 + k]!;
          dotMin = Math.min(dotMin, Math.abs(dot));
        }
        const between = Math.max(0, 2 * dotMin * dotMin - 1);
        norm = Math.sqrt(a.weight * a.weight + b.weight * b.weight + 2 * a.weight * b.weight * between);
      }
      angular[bone] = active.reduce((v, a) => v + a.weight * sourceRates.get(a.clip)!.angular[bone]!, 0) / norm;
    }
    return { speed, angular, root };
  });
  for (const sex of ["m", "f"]) {
    const rest = Float32Array.from(bodies.header.rigs.find(r => r.id === `human_${sex}`)!.rest);
    const selected = meshes.filter(m => m.id.startsWith(`core:human_${sex}/`));
    const vertices = Array.from({ length: HUMAN_BONES }, () => [] as number[][]);
    const bounds = Array.from({ length: HUMAN_BONES }, () => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
    for (const mesh of selected) { const lod = mesh.lods[0]!; for (let v = 0; v < lod.positions.length / 3; v++) {
      for (let influence = 0; influence < (lod.joints && lod.weights ? 4 : 1); influence++) {
        if ((lod.weights?.[v * 4 + influence] ?? 1) === 0) continue;
        const bone = lod.joints?.[v * 4 + influence] ?? lod.bones![v]!, b = bounds[bone]!;
        vertices[bone]!.push(Array.from(lod.positions.subarray(v * 3, v * 3 + 3)));
        for (let axis = 0; axis < 3; axis++) { b.lo[axis] = Math.min(b.lo[axis]!, lod.positions[v * 3 + axis]!); b.hi[axis] = Math.max(b.hi[axis]!, lod.positions[v * 3 + axis]!); }
      }
    } }
    // Several small boxes retain the curved head/hand silhouette without treating empty AABB corners as hair/fingers.
    // Every original vertex belongs to one box, so the union is still a conservative proof, not vertex subsampling.
    const points = bounds.flatMap((b, bone) => {
      if (!Number.isFinite(b.lo[0]!)) return [];
      const slices = bone === 5 ? 4 : [9, 13, 22, 24].includes(bone) ? 2 : 1, axis = bone === 5 ? 1 : 0;
      const boxes = Array.from({ length: slices }, () => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
      for (const p of vertices[bone]!) {
        const n = Math.min(slices - 1, Math.floor((p[axis]! - b.lo[axis]!) / Math.max(1e-9, b.hi[axis]! - b.lo[axis]!) * slices)), box = boxes[n]!;
        for (let a = 0; a < 3; a++) { box.lo[a] = Math.min(box.lo[a]!, p[a]!); box.hi[a] = Math.max(box.hi[a]!, p[a]!); }
      }
      return boxes.flatMap(box => Number.isFinite(box.lo[0]!) ? Array.from({ length: 8 }, (_, corner) => ({ bone, at: box.lo.map((v, a) => corner & (1 << a) ? box.hi[a]! : v) })) : []);
    });
    for (const rateOf of rates) {
    const speed = rateOf.speed, padding = new Float64Array(HUMAN_BONES);
    for (let bone = 0; bone < HUMAN_BONES; bone++) {
      const b = bounds[bone]!; if (!Number.isFinite(b.lo[0]!)) continue;
      let reach = Math.hypot(...[0, 1, 2].map(axis => Math.max(Math.abs(b.lo[axis]! - rest[bone * 3 + axis]!), Math.abs(b.hi[axis]! - rest[bone * 3 + axis]!)) * highScale[bone * 3 + axis]!));
      let rate = rateOf.root, joint = bone;
      while (joint >= 0) {
        rate += rateOf.angular[joint]! * reach;
        const parent = HUMAN.parent[joint]!;
        if (parent >= 0) reach += Math.hypot(...[0, 1, 2].map(axis => (rest[joint * 3 + axis]! - rest[parent * 3 + axis]!) * highScale[parent * 3 + axis]!));
        joint = parent;
      }
      // Every continuous phase is within half a sample spacing. The bound includes every proportion in the interval.
      padding[bone] = report.continuousPhase ? rate / (2 * phases) + 1e-5 : 0; report.phasePadding = Math.max(report.phasePadding, padding[bone]!);
    }
    for (const direction of Array.from({ length: 16 }, (_, i) => i)) for (const pitch of Array.from({ length: 63 }, (_, i) => i - 31)) for (let frame = 0; frame < phases; frame++) {
      if (config.motion && !config.motion.some(m => m.speed === speed && m.direction === direction && m.pitch === pitch)) continue;
      const phase = frame / phases, state = new AnimState(), gait = new Gait();
      state.dir = direction; state.pitch = pitch; gait.speed = speed; gait.phase = phase;
      humanPose(anim, state, phase * anim.idle!.frames, pose, gait); solve(HUMAN, pose, solved, rest); report.poses++;
      for (let bone = 0; bone < HUMAN_BONES; bone++) for (let source = 0; source < 3; source++) {
        quatRotate(solved.rot, bone * 4, +(source === 0), +(source === 1), +(source === 2), unit, 0);
        const yaw = -direction * Math.PI / 8, c = Math.cos(yaw), s = Math.sin(yaw);
        axes[bone * 9 + source * 3] = c * unit[0]! + s * unit[2]!;
        axes[bone * 9 + source * 3 + 1] = unit[1]!;
        axes[bone * 9 + source * 3 + 2] = -s * unit[0]! + c * unit[2]!;
      }
      const yaw = -direction * Math.PI / 8, c = Math.cos(yaw), s = Math.sin(yaw);
      const root = [rest[0]! + pose.root[0]!, rest[1]! + pose.root[1]!, rest[2]! + pose.root[2]!];
      low[0] = high[0] = c * root[0]! + s * root[2]!; low[1] = high[1] = root[1]!; low[2] = high[2] = -s * root[0]! + c * root[2]!;
      low[1]! += lookLift(lowScale, rest); high[1]! += lookLift(highScale, rest);
      for (let bone = 1; bone < HUMAN_BONES; bone++) {
        const parent = HUMAN.parent[bone]!;
        for (let axis = 0; axis < 3; axis++) {
          let a = low[parent * 3 + axis]!, b = high[parent * 3 + axis]!;
          for (let source = 0; source < 3; source++) {
            const coefficient = axes[parent * 9 + source * 3 + axis]! * (rest[bone * 3 + source]! - rest[parent * 3 + source]!);
            a += coefficient * (coefficient >= 0 ? lowScale : highScale)[parent * 3 + source]!;
            b += coefficient * (coefficient >= 0 ? highScale : lowScale)[parent * 3 + source]!;
          }
          low[bone * 3 + axis] = a; high[bone * 3 + axis] = b;
        }
      }
      const lo = [0, 0, 0], hi = [0, 0, 0];
      const accumulate = (point: { bone: number; at: number[] }, target: KoruFitReport) => {
          lo.fill(0); hi.fill(0);
          const bone = point.bone;
          for (let axis = 0; axis < 3; axis++) {
            let a = low[bone * 3 + axis]!, b = high[bone * 3 + axis]!;
            for (let source = 0; source < 3; source++) {
              const coefficient = axes[bone * 9 + source * 3 + axis]! * (point.at[source]! - rest[bone * 3 + source]!);
              a += coefficient * (coefficient >= 0 ? lowScale : highScale)[bone * 3 + source]!;
              b += coefficient * (coefficient >= 0 ? highScale : lowScale)[bone * 3 + source]!;
            }
            lo[axis] = a; hi[axis] = b;
          }
          // AnimState.dir is rounded to 1/16 turn: bound the residual continuous body yaw within half a step.
          const cosine = .9807852804032304, sine = .19509032201612825, tangent = .198912367379658;
          const support = (a: number, b: number) => a > 0 && b <= a * tangent ? Math.hypot(a, b) : a * cosine + b * sine;
          const ax = Math.max(Math.abs(lo[0]!), Math.abs(hi[0]!)), az = Math.max(Math.abs(lo[2]!), Math.abs(hi[2]!));
          const lx = -support(-lo[0]!, az), hx = support(hi[0]!, az), lz = -support(-lo[2]!, ax), hz = support(hi[2]!, ax);
          lo[0] = lx; hi[0] = hx; lo[2] = lz; hi[2] = hz;
          report.intervals++;
          const item = (value: number): KoruFitExtreme => ({ value, mesh: `human_${sex}/${HUMAN.names[bone]} interval`, sex, speed, phase, pitch, direction });
          for (let axis = 0; axis < 3; axis++) {
            if (lo[axis]! - padding[bone]! < target.minimum[axis]!.value) target.minimum[axis] = item(lo[axis]! - padding[bone]!);
            if (hi[axis]! + padding[bone]! > target.maximum[axis]!.value) target.maximum[axis] = item(hi[axis]! + padding[bone]!);
          }
          if (hi[1]! - .5 * lo[2]! + Math.sqrt(1.25) * padding[bone]! > target.stairUp.value) target.stairUp = item(hi[1]! - .5 * lo[2]! + Math.sqrt(1.25) * padding[bone]!);
          if (hi[1]! + .5 * hi[2]! + Math.sqrt(1.25) * padding[bone]! > target.stairDown.value) target.stairDown = item(hi[1]! + .5 * hi[2]! + Math.sqrt(1.25) * padding[bone]!);
      };
      const refined = [5, 9, 13, 22, 24].map(bone => ({ bone, value: { ...report, minimum: [blank(Infinity), blank(Infinity), blank(Infinity)], maximum: [blank(-Infinity), blank(-Infinity), blank(-Infinity)], stairUp: blank(-Infinity), stairDown: blank(-Infinity) } }));
      for (const point of points) accumulate(point, refined.find(r => r.bone === point.bone)?.value ?? report);
      for (const group of refined) {
        const value = group.value;
        if (value.minimum[0]!.value < -.77 || value.maximum[0]!.value > .77) {
          // Resolve ambiguous head/hand box corners against every original vertex. Keep a margin beyond pack/lattice
          // quantization, while retaining the complete creator interval and continuous gait-phase allowance.
          value.minimum = [blank(Infinity), blank(Infinity), blank(Infinity)]; value.maximum = [blank(-Infinity), blank(-Infinity), blank(-Infinity)]; value.stairUp = blank(-Infinity); value.stairDown = blank(-Infinity);
          for (const at of vertices[group.bone]!) accumulate({ bone: group.bone, at }, value);
        }
        for (let axis = 0; axis < 3; axis++) {
          if (value.minimum[axis]!.value < report.minimum[axis]!.value) report.minimum[axis] = value.minimum[axis]!;
          if (value.maximum[axis]!.value > report.maximum[axis]!.value) report.maximum[axis] = value.maximum[axis]!;
        }
        if (value.stairUp.value > report.stairUp.value) report.stairUp = value.stairUp;
        if (value.stairDown.value > report.stairDown.value) report.stairDown = value.stairDown;
      }
    }
    }
  }
  return report;
}

if (import.meta.main) { const interval = auditKoruFit(); console.log(JSON.stringify({ interval, actual: [interval.minimum[0]!, interval.maximum[0]!, interval.maximum[1]!].map(pose => ({ pose, ...actualKoruFit(pose) })) }, null, 2)); }
