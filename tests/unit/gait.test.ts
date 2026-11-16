// Gaits played by the ground covered (shared/anim/gait.ts): a planted foot holds at any speed and size on a rig made here,
// and on the creatures in the repository slides no more than their own clips make it. Gaits blend in step, a body backs
// up, turns on the spot and swims, survivors stride by their clips, and the client draws what the gait says.
import { expect, test } from "bun:test";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { CreatureAnim, advanceCreature, creatureStride, creaturePose } from "../../shared/anim/creature.ts";
import { Gait, gaitShares } from "../../shared/anim/gait.ts";
import { B_FOOT_L, B_FOOT_R, B_TOE_L, B_TOE_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, SPEED_STEP, advanceHuman, bodySeed } from "../../shared/anim/pose.ts";
import { buildRigs, type Rig } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { writeBones } from "../../client/core/render/characters.ts";
import { BONE_FLOATS } from "../../client/core/render/packet.ts";
import { provingView } from "../../tools/snap.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { coreAnim, corePack } from "../fixtures/pack.ts";
import { FOOT_L, FOOT_R, HIP_L, strider } from "../fixtures/strider.ts";

const FPS = 60;
const rigs = buildRigs(corePack().header.rigs, corePack().clips);
/** A species on `rig` that runs from `runAt` metres a second. */
const species = (rig: Rig, runAt: number): CreatureAnim => new CreatureAnim(rig, runAt, 0);

/** Each foot's world place (x, y, z) and its place along the body, a frame at a time. */
type Track = number[][][];

/**
 * Draws `rig` moving forward (backward with `back`) at `speedAt(frame)` metres a second, `size` times as large as made,
 * for `frames` frames at FPS, posed by its gait as the client poses it.
 */
function stride(rig: Rig, feet: readonly number[], runAt: number, size: number, frames: number, speedAt: (f: number) => number, back = false): Track {
  const a = species(rig, runAt);
  const st = new AnimState();
  const g = new Gait();
  const out: Track = [];
  let z = 0;
  for (let f = 0; f < frames; f++) {
    const v = speedAt(f);
    z += ((back ? -v : v) * 1) / FPS;
    st.speed = Math.min(15, Math.round(v / SPEED_STEP));
    st.dir = back ? 8 : 0;
    const tick = 1000 + (f * 30) / FPS;
    advanceCreature(a, g, st, tick, 0, z, 0, size);
    creaturePose(a, st, tick, rig.a, g);
    solve(rig, rig.a, rig.solved);
    const p = rig.solved.pos;
    out.push(feet.map((b) => [p[b * 3]! * size, p[b * 3 + 1]! * size, p[b * 3 + 2]! * size + z, p[b * 3 + 2]! * size]));
  }
  return out;
}

/**
 * How far a planted foot moves between two frames, the most and on average, in metres, and the most it slides over one
 * time down (the most its place on the ground spreads). Planted: within 12% of its rise above its lowest and not on its
 * way forward along the body, in the frame and in those either side, so that the frame it lifts in is not counted.
 */
function slip(track: Track, back = false, from = FPS): { most: number; mean: number; down: number } {
  let [most, sum, n, down] = [0, 0, 0, 0];
  for (let k = 0; k < track[0]!.length; k++) {
    const ys = track.map((f) => f[k]![1]!);
    const [low, high] = [Math.min(...ys), Math.max(...ys)];
    // Backing up, a planted foot goes forward along the body.
    const backward = (f: number): boolean => (back ? -1 : 1) * (track[f]![k]![3]! - track[f - 1]![k]![3]!) <= 1e-4;
    const planted = (f: number): boolean => track[f]![k]![1]! - low <= 0.12 * (high - low) && backward(f);
    let run: number[][] = [];
    for (let f = from; f + 1 < track.length; f++) {
      if (!planted(f - 1) || !planted(f) || !planted(f + 1)) {
        if (run.length > 1) down = Math.max(down, spread(run));
        run = [];
        continue;
      }
      const [a, b] = [track[f - 1]![k]!, track[f]![k]!];
      const d = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
      [most, sum, n] = [Math.max(most, d), sum + d, n + 1];
      if (run.length === 0) run.push(a);
      run.push(b);
    }
  }
  return { most, mean: sum / n, down };
}

/** How far apart the farthest two places on the ground are. */
function spread(run: number[][]): number {
  const xs = run.map((p) => p[0]!);
  const zs = run.map((p) => p[2]!);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
}

test("a planted foot of the rig made here moves a few millimetres at most between frames, walking, running and between, at two sizes", () => {
  const rig = strider();
  for (const size of [1, 0.5]) {
    // Below the walk's own speed, between the walk and the run, and past the run's.
    for (const speed of [1, 2.5, 4.5].map((v) => v * size)) {
      const s = slip(stride(rig, [FOOT_L, FOOT_R], 99, size, 4 * FPS, () => speed));
      // What is left is the clip's frames: a foot is carried straight back at its keys and nearly so between them.
      expect([size, speed, s.most < 0.004]).toEqual([size, speed, true]);
    }
  }
});

test("backing up plays the gait backward, and the planted foot holds", () => {
  const rig = strider();
  for (const speed of [0.6, 1.5]) expect(slip(stride(rig, [FOOT_L, FOOT_R], 99, 1, 4 * FPS, () => speed, true), true).most).toBeLessThan(0.004);
});

test("speeding up from a walk to a run blends the two in step: the feet hold and no joint jumps between frames", () => {
  const rig = strider();
  const a = species(rig, 99);
  const st = new AnimState();
  const g = new Gait();
  const before = new Float32Array(rig.bones * 4);
  let [z, jump] = [0, 0];
  const feet: Track = [];
  // From 1 to 4.5 metres a second over three seconds, the state's speed in its steps of 0.6.
  for (let f = 0; f < 3 * FPS; f++) {
    const v = 1 + (3.5 * f) / (3 * FPS);
    z += v / FPS;
    st.speed = Math.round(v / SPEED_STEP);
    const tick = (f * 30) / FPS;
    advanceCreature(a, g, st, tick, 0, z, 0, 1);
    creaturePose(a, st, tick, rig.a, g);
    if (f > 0) for (let b = 0; b < rig.bones; b++) {
      const dot = Math.abs(before[b * 4]! * rig.a.rot[b * 4]! + before[b * 4 + 1]! * rig.a.rot[b * 4 + 1]! + before[b * 4 + 2]! * rig.a.rot[b * 4 + 2]! + before[b * 4 + 3]! * rig.a.rot[b * 4 + 3]!);
      jump = Math.max(jump, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
    }
    before.set(rig.a.rot);
    solve(rig, rig.a, rig.solved);
    const p = rig.solved.pos;
    feet.push([FOOT_L, FOOT_R].map((b) => [p[b * 3]!, p[b * 3 + 1]!, p[b * 3 + 2]! + z, p[b * 3 + 2]!]));
  }
  // A leg swings about 6 degrees a frame at the end. Between gaits played out of step it would jump by tens.
  expect(jump).toBeLessThan(8);
  // In the blend the two strides mix and a planted foot gives a little.
  expect(slip(feet).most).toBeLessThan(0.01);
});

test("turning on the spot steps by the arc the feet turn through, and standing still stands", () => {
  const rig = strider();
  const a = species(rig, 99);
  const st = new AnimState();
  const g = new Gait();
  const idle = new Pose(rig.bones);
  creaturePose(a, st, 0, idle);
  // A quarter turn a second: the feet, 0.2 m from the middle, go 0.31 m a second.
  for (let f = 0; f <= FPS; f++) advanceCreature(a, g, st, (f * 30) / FPS, 5, 5, (f * Math.PI) / 2 / FPS, 1);
  expect(g.speed).toBeCloseTo((0.2 * Math.PI) / 2, 2);
  creaturePose(a, st, 30, rig.a, g);
  expect(rig.a.rot[HIP_L * 4]).not.toBeCloseTo(idle.rot[HIP_L * 4]!, 3);
  // Standing, it eases back to standing.
  for (let f = FPS + 1; f <= 2 * FPS; f++) advanceCreature(a, g, st, (f * 30) / FPS, 5, 5, Math.PI / 2, 1);
  expect(g.speed).toBeLessThan(0.01);
});

test("a body in water strokes by the water it covers, a creature and a survivor alike", () => {
  const a = species(strider(), 99);
  const st = new AnimState();
  st.mode = MODE_SWIM;
  st.grounded = false;
  st.speed = 2;
  const g = new Gait();
  advanceCreature(a, g, st, 0, 0, 0, 0, 1);
  const from = g.phase;
  // A metre in 20 ticks, the creature paddling with its walk, a stride's worth of turn for each stride of water.
  for (let f = 1; f <= 20; f++) advanceCreature(a, g, st, f, 0, f / 20, 0, 1);
  const turns = 1 / creatureStride(a, st, g.speed);
  expect((g.phase - from + 1) % 1).toBeCloseTo(turns - Math.floor(turns), 2);
  // A survivor's strokes go by its swim's stride: what it covers at its own rate, 2.4 m/s.
  const anim = coreAnim();
  const h = new Gait();
  advanceHuman(anim, h, st, 0, 0, 0, 0);
  const start = h.phase;
  for (let f = 1; f <= 20; f++) advanceHuman(anim, h, st, f, 0, f / 20, 0);
  const strokes = 1 / gaitShares(anim.swimming, h.speed, true, anim.w);
  expect((h.phase - start + 1) % 1).toBeCloseTo(strokes - Math.floor(strokes), 2);
});

test("the creatures in the repository slide a planted foot no farther over one time down than their own clips do, at three speeds and two sizes", () => {
  for (const { id, spec } of CREATURE_ASSETS) {
    const rig = rigs.get(id)!;
    const feet = spec.feet.map((n) => rig.names.indexOf(n));
    const plays = species(rig, 99);
    for (const gait of [plays.walkGait, plays.runGait]) {
      if (!gait) continue;
      // The stride's own slide: the clip played at its own rate as the body moves at its own speed, which time and
      // distance agree on.
      const own = slip(stride(rig, feet, gait === plays.runGait ? 0.01 : 99, 1, 6 * FPS, () => gait.speed)).down;
      for (const size of [1, 0.5]) {
        // Under its speed a gait shares the pose with the idle by each bone's turn, which moves the end of a long limb in
        // an arc: a centimetre, or 2% of a long stride (the pteranodon's hand, at the end of its folded wing, slides 2.5 cm
        // of its 1.5 m stride at 60% of its walk).
        const slack = Math.max(0.01, 0.02 * gait.stride * size);
        for (const share of [0.6, 1, 1.4]) {
          const s = slip(stride(rig, feet, gait === plays.runGait ? 0.01 : 99, size, 6 * FPS, () => gait.speed * share * size));
          expect([id, gait.clip.id, size, share, s.down < own * size * 1.25 + slack]).toEqual([id, gait.clip.id, size, share, true]);
        }
      }
    }
  }
});

test("a survivor's gaits stride as far as their clips carry a planted foot back", () => {
  const anim = coreAnim();
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  for (const g of anim.standing) {
    // The lower of foot and toe is on the ground while within 2 cm of its lowest. How fast it goes back is the stride.
    let [back, steps] = [0, 0];
    for (const [foot, toe] of [[B_FOOT_L, B_TOE_L], [B_FOOT_R, B_TOE_R]] as const) {
      const n = 240;
      const at: number[][] = [];
      for (let i = 0; i < n; i++) {
        sampleClip(g.clip, (i / n) * g.clip.frames, pose);
        solve(HUMAN, pose, solved);
        const b = solved.pos[foot * 3 + 1]! < solved.pos[toe * 3 + 1]! ? foot : toe;
        at.push([solved.pos[b * 3 + 1]!, solved.pos[b * 3 + 2]!]);
      }
      const low = Math.min(...at.map((p) => p[0]!));
      for (let i = 0; i < n; i++) {
        const [a, b] = [at[i]!, at[(i + 1) % n]!];
        if (a[0]! - low > 0.02 || b[0]! - low > 0.02) continue;
        back += a[1]! - b[1]!;
        steps++;
      }
    }
    const measured = (back / steps) * 240;
    expect([g.clip.id, Math.abs(measured / g.stride - 1) < 0.01]).toEqual([g.clip.id, true]);
  }
});

test("the client draws a creature with the gait it keeps for it", () => {
  const view = provingView(64, 36);
  const { scene, remote, reg, hf } = view;
  const cam = new Camera();
  const kind = reg.index.get("core:raptor")!;
  const rig = rigs.get("core:raptor")!;
  const a = species(rig, reg.runAt[kind]!);
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.flags[0], remote.yaw[0]] = [77, kind, 1, 0.3];
  const st = new AnimState();
  st.speed = 10;
  st.seed = bodySeed(77);
  remote.anim[0] = st.pack();
  const g = new Gait();
  const expected = new Float32Array(rig.bones * BONE_FLOATS);
  for (let f = 0; f < 90; f++) {
    remote.tick = 100 + f / 2;
    remote.x[0] = 250 + Math.sin(0.3) * (6 * f) / FPS;
    remote.z[0] = 250 + Math.cos(0.3) * (6 * f) / FPS;
    remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
    [cam.x, cam.y, cam.z] = [remote.x[0]! - 8, remote.y[0]! + 3, remote.z[0]! - 8];
    cam.yaw = Math.PI / 4;
    const p = scene.build(cam, remote);
    advanceCreature(a, g, st, remote.tick, remote.x[0]!, remote.z[0]!, 0.3, 1);
    creaturePose(a, st, remote.tick, rig.a, g);
    solve(rig, rig.a, rig.solved);
    writeBones(expected, 0, rig.solved, rig.rest, null, remote.x[0]! - cam.x, remote.y[0]! - cam.y, remote.z[0]! - cam.z, 0.3, 1);
    let off = 0;
    for (let k = 0; k < expected.length; k++) off = Math.max(off, Math.abs(p.bones[k]! - expected[k]!));
    expect(off).toBeLessThan(1e-4);
  }
});
