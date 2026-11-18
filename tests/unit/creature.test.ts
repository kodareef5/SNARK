// Every creature found under assets/source, held to what its asset.ts says of it. A new creature is tested without being named here.
import { expect } from "bun:test";
import { sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { CreatureAnim, FADE, advanceCreature, creaturePose, rayCreature } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { ZONE_HAND_L, ZONE_HEAD, ZONE_NONE } from "../../shared/anim/human.ts";
import { AnimState, CLIMB_DIVE, CUE_LAND, CUE_ROLL, CUE_TAKEOFF, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { boneToModel, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { quatAxis, quatRotate } from "../../shared/math/quat.ts";
import { lodVertices, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { MODE_FLYER } from "../../shared/sim/character.ts";
import { ACT_EQUIP, ACT_NONE, ACT_SWING, HOLD_CARRY, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import { ZONES } from "../../tools/art/spec.ts";
import { CREATURE_ASSETS } from "../fixtures/assets.ts";
import { clipTurns, flyerAnim, turnBetween } from "../fixtures/flyer/flyer.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const pack = corePack();
const rigs = buildRigs(pack.header.rigs, pack.clips);
const reg = coreRegistry();

test("the pack carries each creature as its asset describes it: a rig that is a whole skeleton, one mesh on it with every vertex on one bone, and its clips", () => {
  expect(CREATURE_ASSETS.length).toBeGreaterThan(0);
  expect([...rigs.keys()].sort()).toEqual(CREATURE_ASSETS.map((a) => a.id).sort());
  for (const { id, spec } of CREATURE_ASSETS) {
    const raw = pack.header.rigs.find((r) => r.id === id)!;
    const rig = rigs.get(id)!;
    expect([id, raw.skeleton, rig.names[0], rig.parent[0]]).toEqual([id, spec.skeleton.id, spec.skeleton.root, -1]);
    for (let b = 1; b < rig.bones; b++) {
      expect(rig.parent[b]!).toBeGreaterThanOrEqual(0);
      expect(rig.parent[b]!).toBeLessThan(b);
    }
    // What the asset drops is gone, and what it hangs elsewhere hangs there.
    expect(rig.names.filter((n) => spec.skeleton.drop?.test(n))).toEqual([]);
    for (const [bone, parent] of Object.entries(spec.skeleton.reparent ?? {})) expect([bone, rig.names[rig.parent[rig.names.indexOf(bone)]!]]).toEqual([bone, parent]);
    // It stands on its feet in its idle (a flyer rests in its glide), its left is at +X and it faces +Z.
    const at = (name: string): number[] => Array.from(rig.rest.subarray(rig.names.indexOf(name) * 3, rig.names.indexOf(name) * 3 + 3));
    const idle = rig.clips.get("idle");
    if (idle) sampleClip(idle, 0, rig.a);
    else rig.a.rest();
    solve(rig, rig.a, rig.solved);
    for (const foot of spec.feet) {
      expect([foot, Math.abs(rig.solved.pos[rig.names.indexOf(foot) * 3 + 1]!) < rig.mid * 0.2]).toEqual([foot, true]);
      if (/[._]L$/i.test(foot)) expect(at(foot)[0]!).toBeGreaterThan(0);
      if (/[._]R$/i.test(foot)) expect(at(foot)[0]!).toBeLessThan(0);
    }
    const head = spec.zones.find((z) => z.zone === "head");
    if (head) expect(at(head.on)[2]!).toBeGreaterThan(at(spec.skeleton.root)[2]!);
    // A capsule for each zone the asset lists, a socket for each it names, and each of its clips.
    expect(Array.from(rig.zone).filter((z) => z !== 0).sort()).toEqual(spec.zones.map((z) => ZONES[z.zone]).sort());
    for (const z of spec.zones) expect([z.on, rig.zone[rig.names.indexOf(z.on)], rig.capR[rig.names.indexOf(z.on)]! > 0]).toEqual([z.on, ZONES[z.zone], true]);
    expect([...rig.sockets.keys()].sort()).toEqual(spec.sockets.map((s) => s.name).sort());
    for (const c of spec.clips) {
      const clip = pack.clips.clips[pack.clips.index.get(`${id}/${c.name}`)!]!;
      expect([c.name, clip.bones, clip.loop, clip.frames > 1]).toEqual([c.name, rig.bones, c.loop, true]);
    }

    const mesh = pack.header.meshes[pack.meshIndex.get(id)!]!;
    expect([mesh.skeleton, pack.header.rigs[mesh.rig!]!.id]).toEqual([spec.skeleton.id, id]);
    for (const lod of mesh.lods) {
      const verts = lodVertices(pack, lod);
      for (let v = 0; v < lod.vertexCount; v++) expect(verts[v * VERTEX_BYTES + 7]!).toBeLessThan(rig.bones);
    }
    expect(mesh.lods.length).toBeLessThanOrEqual(spec.budgets.triangles.length);
    mesh.lods.forEach((lod, l) => expect([l, lod.indexCount / 3 <= spec.budgets.triangles[l]!]).toEqual([l, true]));
    // Each coarser level has fewer triangles and lies further from the finest.
    for (let l = 1; l < mesh.lods.length; l++) {
      expect(mesh.lods[l]!.indexCount).toBeLessThan(mesh.lods[l - 1]!.indexCount);
      expect(mesh.lods[l]!.error).toBeGreaterThan(mesh.lods[l - 1]!.error);
    }
  }
  // A species that is drawn on a skeleton of its own has that rig in the pack.
  for (const d of reg.defs) {
    if (d?.type !== "species" || d.class !== "creature" || d.skeleton === undefined) continue;
    expect([d.id, pack.header.rigs.find((r) => r.id === d.mesh)?.skeleton]).toEqual([d.id, d.skeleton]);
  }
});

test("a creature stands, walks, runs and strikes on its clips: its feet stay by the ground and its head stays ahead of it", () => {
  const st = new AnimState();
  for (const { id, spec } of CREATURE_ASSETS) {
    const rig = rigs.get(id)!;
    const a = new CreatureAnim(rig, 4, 0);
    const scale = rig.mid;
    const feet = spec.feet.map((name) => rig.names.indexOf(name));
    const headZone = spec.zones.find((z) => z.zone === "head");
    const head = headZone ? rig.names.indexOf(headZone.on) : -1;
    for (const [speed, strike] of [[0, false], [3, false], [13, false], [0, true]] as const) {
      let low = Infinity;
      let high = -Infinity;
      let apart = 0;
      for (let tick = 200; tick < 320; tick += 1.5) {
        st.speed = speed;
        st.seed = 11;
        st.setAction(strike ? ACT_SWING : ACT_NONE, HOLD_HANDS, 205);
        creaturePose(a, st, tick, rig.a);
        solve(rig, rig.a, rig.solved);
        const pos = rig.solved.pos;
        for (let k = 0; k < pos.length; k++) expect(Number.isFinite(pos[k]!)).toBe(true);
        // The lower of its feet.
        const lower = Math.min(...feet.map((b) => pos[b * 3 + 1]!));
        if (lower < low) low = lower;
        if (lower > high) high = lower;
        if (feet.length > 1) apart = Math.max(apart, Math.abs(pos[feet[0]! * 3 + 2]! - pos[feet[1]! * 3 + 2]!));
        if (head >= 0) {
          expect(pos[head * 3 + 2]!).toBeGreaterThan(pos[2]!);
          expect(pos[head * 3 + 1]!).toBeGreaterThan(scale * 0.5);
        }
      }
      const where = `${id} speed ${speed} strike ${strike}`;
      if (feet.length > 0) {
        expect(low, where).toBeGreaterThan(-0.25 * scale);
        expect(high, where).toBeLessThan(0.45 * scale);
      }
      if (speed > 0 && feet.length > 1 && a.walk) expect(apart, where).toBeGreaterThan(0.3 * scale);
    }
    // Below walking speed the pose is a blend of standing and walking.
    if (!a.idle || !a.walk) continue;
    st.setAction(ACT_NONE, HOLD_HANDS, 0);
    st.speed = 1;
    creaturePose(a, st, 50, rig.a);
    const blended = rig.a.rot.slice();
    st.speed = 0;
    creaturePose(a, st, 50, rig.a);
    const still = rig.a.rot.slice();
    st.speed = 3;
    creaturePose(a, st, 50, rig.a);
    let between = 0;
    for (let k = 0; k < blended.length; k++) if (Math.abs(blended[k]! - still[k]!) > 1e-4 && Math.abs(blended[k]! - rig.a.rot[k]!) > 1e-4) between++;
    expect(between, id).toBeGreaterThan(10);
  }
});

test("a creature is hit where it is: its head from in front, every zone from some side, and nothing where it is not", () => {
  const st = new AnimState();
  st.setAction(ACT_NONE, HOLD_HANDS, 0);
  for (const { id, spec } of CREATURE_ASSETS) {
    const rig = rigs.get(id)!;
    const a = new CreatureAnim(rig, 4, 0);
    creaturePose(a, st, 0, rig.a);
    solve(rig, rig.a, rig.solved);
    const out = [0, 0, 0];
    // The middle of a bone's capsule, in model space.
    const middle = (b: number): number[] => {
      boneToModel(rig.solved, b, (rig.capA[b * 3]! + rig.capB[b * 3]!) / 2, (rig.capA[b * 3 + 1]! + rig.capB[b * 3 + 1]!) / 2, (rig.capA[b * 3 + 2]! + rig.capB[b * 3 + 2]!) / 2, out);
      return [...out];
    };
    const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, yaw = 0, bx = 0, bz = 0): number => rayCreature(a, st, 0, bx, 0, bz, yaw, ox, oy, oz, dx, dy, dz, 80);
    // Every zone it has can be hit: a ray along some axis, at the middle of one of the zone's capsules, hits that zone first.
    const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    for (const zone of new Set(spec.zones.map((z) => z.zone))) {
      const first = spec.zones.filter((z) => z.zone === zone).flatMap((z) => {
        const m = middle(rig.names.indexOf(z.on));
        return sides.filter(([dx, dy, dz]) => ray(m[0]! - dx * 40, m[1]! - dy * 40, m[2]! - dz * 40, dx, dy, dz) === ZONES[zone]);
      });
      expect([id, zone, first.length > 0]).toEqual([id, zone, true]);
    }
    expect(ray(-30, rig.mid * 4, 0, 1, 0, 0)).toBe(ZONE_NONE);
    const headZone = spec.zones.find((z) => z.zone === "head");
    if (!headZone) continue;
    const h = middle(rig.names.indexOf(headZone.on));
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1)).toBe(ZONE_HEAD);
    expect(zoneHit.t).toBeLessThan(40 - h[2]!);
    expect(ray(-30, h[1]!, rig.reach + 1, 1, 0, 0)).toBe(ZONE_NONE);
    // Turned a quarter and moved, it is hit by the same ray turned and moved with it, and not by the old ray.
    expect(ray(100 + 40, h[1]!, 50 - h[0]!, -1, 0, 0, 16384, 100, 50)).toBe(ZONE_HEAD);
    expect(ray(h[0]!, h[1]!, 40, 0, 0, -1, 16384, 100, 50)).toBe(ZONE_NONE);
  }
});

// A flyer in its own flight, on the pteranodon's rig and clips. Clips that stand in for its own where a test needs a
// simpler one are made here.

const flyer = fromArt(flyerAnim);
const frig = fromArt(() => flyer.rig);
const named = (n: string): number => frig.names.indexOf(n);
const T = 1000;
const SEED = 11;
/** Degrees a bone may turn in a tick beyond the most any clip turns it in a frame: what a blend between two clips adds. */
const SLACK = 6;

/** A state set by `set`, flying unless it says otherwise, as the wire carries it. */
function state(set: (s: AnimState) => void, flying = true): AnimState {
  const s = new AnimState();
  if (flying) {
    s.mode = MODE_FLYER;
    s.grounded = false;
  }
  set(s);
  const back = new AnimState();
  back.unpack(s.pack(), s.packCue());
  back.seed = SEED;
  return back;
}

/** Its pose at `tick`: each bone's turn from its parent, each joint in its model space, and each bone's turn there. */
function posed(a: CreatureAnim, s: AnimState, tick: number, gait: Gait | null = null) {
  creaturePose(a, s, tick, a.rig.a, gait);
  solve(a.rig, a.rig.a, a.rig.solved);
  return { rot: Array.from(a.rig.a.rot), pos: Array.from(a.rig.solved.pos), turn: a.rig.solved.rot.slice() };
}

/** Each bone's turn in the clip `name` of `a` at `frame`. */
function frameOf(name: string, frame: number, a: CreatureAnim = flyer): number[] {
  sampleClip(a.rig.clips.get(name)!, frame, a.rig.b);
  return Array.from(a.rig.b.rot);
}

/** How far each joint of `p` is from the point its body turns about in flight. */
function fromPivot(p: number[]): number[] {
  return Array.from({ length: frig.bones }, (_, b) => Math.hypot(p[b * 3]! - flyer.pivot[0]!, p[b * 3 + 1]! - flyer.pivot[1]!, p[b * 3 + 2]! - flyer.pivot[2]!));
}

/** Poses `states` a tick apart from `from`, and returns the most any bone turned in a tick beyond what the clips turn it in a frame. */
function overClips(a: CreatureAnim, from: number, states: readonly AnimState[], gait: Gait | null = null): number {
  const own = clipTurns(a.rig);
  let was: Float32Array | null = null;
  let most = 0;
  states.forEach((s, k) => {
    if (gait) advanceCreature(a, gait, s, from + k, 0, 0, 0, 1);
    const now = posed(a, s, from + k, gait).turn;
    if (was) for (let b = 0; b < a.rig.bones; b++) most = Math.max(most, turnBetween(now, was, b) - own[b]!);
    was = now;
  });
  return most;
}

test("a flyer hovers at no speed, flaps at its flying speed and fast at its sprint, on one beat, and glides looking down and dives looking further down", () => {
  expect([flyer.flies, flyer.beat, flyer.flyAt, flyer.fastAt]).toEqual([true, 30, 6, 16]);
  const u = (T + SEED) / flyer.beat - Math.floor((T + SEED) / flyer.beat);
  const hover = frameOf("hover", u * flyer.rig.clips.get("hover")!.frames);
  const fly = frameOf("fly", u * 30);
  expect(posed(flyer, state((s) => (s.speed = 0)), T).rot).toEqual(hover);
  expect(posed(flyer, state((s) => (s.speed = 3)), T).rot).toEqual(fly);
  expect(posed(flyer, state((s) => (s.speed = 8)), T).rot).toEqual(frameOf("fly_fast", T + SEED));
  // Between them it is some of each.
  const slow = posed(flyer, state((s) => (s.speed = 1)), T).rot;
  expect([slow.some((x, k) => x !== hover[k]), slow.some((x, k) => x !== fly[k])]).toEqual([true, true]);
  // Looking 23 degrees down it glides, and 64 down it dives: every bone but the root, which its look pitches, as the clip has it.
  expect(posed(flyer, state((s) => ((s.speed = 3), (s.pitch = -8))), T).rot.slice(4)).toEqual(frameOf("glide", T + SEED).slice(4));
  expect(posed(flyer, state((s) => ((s.speed = 3), (s.pitch = -22))), T).rot.slice(4)).toEqual(frameOf("dive", T + SEED).slice(4));
  // Going straight down without looking down, as it does to set down, it sinks on its wings as it hovers.
  expect(posed(flyer, state((s) => ((s.speed = 6), (s.climb = CLIMB_DIVE))), T).rot).toEqual(hover);
});

test("in flight its body pitches with its look and rolls into its turns about its middle, nose up as it climbs and down toward the side it turns, and not while it hovers", () => {
  const level = posed(flyer, state((s) => (s.speed = 3)), T);
  const skull = named("skull") * 3 + 1;
  const up = posed(flyer, state((s) => ((s.speed = 3), (s.pitch = 10))), T);
  const down = posed(flyer, state((s) => ((s.speed = 3), (s.pitch = -10))), T);
  expect([up.pos[skull]! - level.pos[skull]! > 0.2, down.pos[skull]! - level.pos[skull]! < -0.2]).toEqual([true, true]);
  fromPivot(up.pos).forEach((d, b) => expect(d).toBeCloseTo(fromPivot(level.pos)[b]!, 4));
  // The left wingtip's height less the right's, banked each way by each step.
  const tips = (bank: number): number => {
    const p = posed(flyer, state((s) => ((s.speed = 3), (s.bank = bank))), T).pos;
    return p[named("wing_4_l") * 3 + 1]! - p[named("wing_4_r") * 3 + 1]!;
  };
  expect(Math.abs(tips(0))).toBeLessThan(0.01);
  const drops = [1, 2, 4, 7].map((bank) => [tips(bank), tips(-bank)] as const);
  for (const [left, right] of drops) expect([left < -1.5, right > 1.5]).toEqual([true, true]);
  for (let k = 1; k < drops.length; k++) expect(drops[k]![0]).toBeLessThan(drops[k - 1]![0]);
  const hovering = posed(flyer, state((s) => (s.speed = 0)), T).rot;
  expect(posed(flyer, state((s) => ((s.speed = 0), (s.pitch = 10), (s.bank = 4))), T).rot).toEqual(hovering);
});

/** How far up its chest's up points, in model space. */
function chestUp(turn: Float32Array): number {
  const o = [0, 0, 0];
  quatRotate(turn, named("chest") * 4, 0, 1, 0, o, 0);
  return o[1]!;
}

test("a barrel roll without a clip of its own turns it over once about its own length and back", () => {
  const a = new CreatureAnim({ ...frig, clips: new Map([...frig.clips].filter(([name]) => name !== "barrel_roll")) }, flyer.runAt, 3);
  const level = posed(a, state((s) => (s.speed = 3)), T);
  const rolled = (k: number) => posed(a, state((s) => ((s.speed = 3), (s.cue = CUE_ROLL), (s.cueStart = (T - k) & 255))), T);
  expect([chestUp(level.turn) > 0.9, chestUp(rolled(15).turn) < -0.9]).toEqual([true, true]);
  expect(rolled(0).pos).toEqual(level.pos);
  expect(rolled(30).pos).toEqual(level.pos);
  fromPivot(rolled(8).pos).forEach((d, b) => expect(d).toBeCloseTo(fromPivot(level.pos)[b]!, 4));
});

test("its own barrel roll turns it over about its own length, coming in from its flight and going back into it", () => {
  const roll = frig.clips.get("barrel_roll")!;
  const level = posed(flyer, state((s) => (s.speed = 3)), T);
  const rolled = (k: number) => posed(flyer, state((s) => ((s.speed = 3), (s.cue = CUE_ROLL), (s.cueStart = (T - k) & 255))), T);
  rolled(0).pos.forEach((p, i) => expect(p).toBeCloseTo(level.pos[i]!, 5));
  expect(chestUp(rolled(13).turn)).toBeLessThan(-0.9);
  expect(rolled(roll.frames - 1 + FADE).pos).toEqual(level.pos);
});

test("a take-off starts on the crouch it stood in and ends at the top of its hover's stroke, its beat coming to its clock with no bone turning faster than the clips turn it", () => {
  const start = T - 5;
  const standing = state(() => {}, false);
  const off = state((s) => ((s.cue = CUE_TAKEOFF), (s.cueStart = start & 255)));
  // On its first tick its body is the clip's first frame and its neck and head where its idle had them.
  const first = posed(flyer, off, start).rot;
  const stood = posed(flyer, standing, start).rot;
  const crouch = frameOf("take_off", 0);
  expect(Array.from(flyer.neck, (b) => frig.names[b]).sort()).toEqual(["jaw", "neck_1", "neck_2", "neck_3", "neck_4", "skull"]);
  first.forEach((x, k) => expect([k, x]).toEqual([k, (flyer.neck.includes(k >> 2) ? stood : crouch)[k]!]));
  const end = flyer.takeOff!.frames - 1;
  expect(posed(flyer, off, start + end).rot).toEqual(frameOf("take_off", end));
  // A beat later it hovers as any flyer at no speed does.
  const after = start + end + flyer.beat;
  expect(posed(flyer, off, after).rot).toEqual(posed(flyer, state((s) => (s.speed = 0)), after).rot);
  expect(overClips(flyer, start - 1, [standing, ...Array<AnimState>(end + flyer.beat + 10).fill(off)])).toBeLessThan(SLACK);
});

test("a landing comes in from its flight and settles into the crouch it stands in", () => {
  const start = T - 3;
  const hovering = state((s) => (s.speed = 0));
  const landing = state((s) => ((s.cue = CUE_LAND), (s.cueStart = start & 255)), false);
  const standing = state(() => {}, false);
  expect(posed(flyer, landing, start).rot).toEqual(posed(flyer, hovering, start).rot);
  const settled = start + flyer.land!.frames - 1 + FADE;
  expect(posed(flyer, landing, settled).rot).toEqual(posed(flyer, standing, settled).rot);
  expect(overClips(flyer, start - 1, [hovering, ...Array<AnimState>(settled - start + 5).fill(landing)])).toBeLessThan(SLACK);
});

test("its hit zones follow its wings: a shot from below at a wingtip banked hits that wing, and passes where the level wing is not", () => {
  const banked = state((s) => ((s.speed = 3), (s.bank = 7)));
  const level = state((s) => (s.speed = 3));
  const b = named("wing_3_l");
  creaturePose(flyer, banked, T, frig.a);
  solve(frig, frig.a, frig.solved);
  const mid = [0, 0, 0];
  boneToModel(frig.solved, b, (frig.capA[b * 3]! + frig.capB[b * 3]!) / 2, (frig.capA[b * 3 + 1]! + frig.capB[b * 3 + 1]!) / 2, (frig.capA[b * 3 + 2]! + frig.capB[b * 3 + 2]!) / 2, mid);
  const shot = (s: AnimState): number => rayCreature(flyer, s, T, 0, 0, 0, 0, mid[0]!, mid[1]! - 20, mid[2]!, 0, 1, 0, 40);
  expect([shot(banked), zoneHit.bone]).toEqual([ZONE_HAND_L, b]);
  expect(shot(level)).not.toBe(ZONE_HAND_L);
});

test("a client's gait eases a step of a flyer's speed or bank over a few ticks, and once settled poses it to the bit as the server does", () => {
  const g = new Gait();
  const cruise = state((s) => (s.speed = 3));
  for (let k = 0; k <= 30; k++) advanceCreature(flyer, g, cruise, T + k, 0, k * 0.2, 0, 1);
  expect(posed(flyer, cruise, T + 30, g).rot).toEqual(posed(flyer, cruise, T + 30).rot);
  // Slowed a step and banked a step: part way there a tick on, and there within two thirds of a second.
  const slower = state((s) => ((s.speed = 2), (s.bank = 1)));
  advanceCreature(flyer, g, slower, T + 31, 0, 6.2, 0, 1);
  expect([g.hover > 0 && g.hover < 1 / 3, g.roll < 0 && g.roll > -0.28]).toEqual([true, true]);
  for (let k = 32; k <= 50; k++) advanceCreature(flyer, g, slower, T + k, 0, k * 0.2, 0, 1);
  expect(posed(flyer, slower, T + 50, g).rot).toEqual(posed(flyer, slower, T + 50).rot);
  // Off from a hover to its flying speed in the steps it is sent: smooth with the gait, as the server's pose is not.
  const steps = [0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3].map((v) => state((s) => (s.speed = v)));
  expect(overClips(flyer, T, steps, new Gait())).toBeLessThan(SLACK);
  expect(overClips(flyer, T, steps)).toBeGreaterThan(SLACK);
});

/** A clip on the pteranodon's bones that turns `bones` about their own x axis by `angle(frame)` radians, and the rest not. */
function madeClip(name: string, frames: number, loop: boolean, bones: readonly string[], angle: (f: number) => number): Clip {
  const n = frig.bones;
  const rot = new Float32Array(frames * n * 4);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < n; b++) {
      if (bones.includes(frig.names[b]!)) quatAxis(rot, (f * n + b) * 4, 1, 0, 0, angle(f));
      else rot[(f * n + b) * 4 + 3] = 1;
    }
  }
  return { id: `core:pteranodon/${name}`, bones: n, frames, loop, rot, root: new Float32Array(frames * 3) };
}

const LEGS = ["shin_l", "foot_l", "toes_l", "shin_r", "foot_r", "toes_r"];

/** Its rig with plain clips, which a test can name the bones of, in place of its own bite in the air, grab, carry, release and limp fall. */
function withActs(): CreatureAnim {
  const bump = (n: number) => (f: number) => 0.5 * Math.sin((Math.PI * f) / (n - 1));
  const clips = new Map(frig.clips);
  clips.set("attack_air", madeClip("attack_air", 18, false, ["neck_3", "neck_4", "skull"], bump(18)));
  clips.set("grab", madeClip("grab", 12, false, LEGS, bump(12)));
  clips.set("carry", madeClip("carry", 30, true, LEGS, () => 0.6));
  clips.set("release", madeClip("release", 12, false, LEGS, bump(12)));
  clips.set("torpor_fall", madeClip("torpor_fall", 24, true, ["spine", "chest", "neck_1"], (f) => 0.3 + 0.1 * Math.sin((2 * Math.PI * f) / 24)));
  return new CreatureAnim({ ...frig, clips }, flyer.runAt, 3);
}

test("in the air it bites with its neck and head alone, and takes hold, carries and lets go with its legs alone", () => {
  const a = withActs();
  const legs = new Set(LEGS.map(named));
  const head = new Set(["neck_3", "neck_4", "skull", "jaw"].map(named));
  const pose = (act: number, hold: number, k: number) => posed(a, state((s) => ((s.speed = 3), s.setAction(act, hold, T - k))), T).rot;
  const plain = pose(ACT_NONE, HOLD_HANDS, 0);
  /** The bones whose turn differs from the plain flight's. */
  const moved = (r: number[]): number[] => Array.from({ length: frig.bones }, (_, b) => b).filter((b) => [0, 1, 2, 3].some((k) => r[b * 4 + k] !== plain[b * 4 + k]));
  const biting = moved(pose(ACT_SWING, HOLD_HANDS, 8));
  expect([biting.length > 0, biting.every((b) => head.has(b))]).toEqual([true, true]);
  const carried = pose(ACT_NONE, HOLD_CARRY, 0);
  expect([moved(carried).length > 0, moved(carried).every((b) => legs.has(b))]).toEqual([true, true]);
  // The grab brings the carry in as it plays, and the release takes it out.
  expect(pose(ACT_EQUIP, HOLD_CARRY, 0)).toEqual(plain);
  expect(pose(ACT_EQUIP, HOLD_CARRY, 11)).toEqual(carried);
  expect(moved(pose(ACT_EQUIP, HOLD_CARRY, 5)).every((b) => legs.has(b))).toBe(true);
  expect(pose(ACT_EQUIP, HOLD_HANDS, 0)).toEqual(carried);
  expect(pose(ACT_EQUIP, HOLD_HANDS, 11)).toEqual(plain);
});

test("knocked out in the air it goes limp from its flight and falls so", () => {
  const a = withActs();
  const start = T - 2;
  const hovering = state((s) => (s.speed = 0));
  const out = state((s) => ((s.out = true), (s.grounded = false), (s.cue = CUE_TORPOR), (s.cueStart = start & 255)), false);
  expect(posed(a, out, start).rot).toEqual(posed(a, hovering, start).rot);
  expect(posed(a, out, start + FADE + 4).rot).toEqual(frameOf("torpor_fall", start + FADE + 4 + SEED, a));
  // Come to the ground, it lies down from its fall over FADE ticks.
  const land = start + 40;
  const down = state((s) => ((s.out = true), (s.cue = CUE_LAND), (s.cueStart = land & 255)), false);
  expect(posed(a, down, land).rot).toEqual(frameOf("torpor_fall", land + SEED, a));
  const half = posed(a, down, land + FADE / 2).rot;
  const same = (p: number[], q: number[]): boolean => p.every((x, k) => x === q[k]);
  expect([same(half, frameOf("torpor_fall", land + FADE / 2 + SEED, a)), same(half, frameOf("torpor_idle", land + FADE / 2 + SEED, a))]).toEqual([false, false]);
  expect(posed(a, down, land + FADE).rot).toEqual(frameOf("torpor_idle", land + FADE + SEED, a));
});
