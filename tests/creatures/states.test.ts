// What a creature does, drawn with the clip made for it: on the dodo, on a bird made in code with the dodo's clips
// (tests/fixtures/bird.ts), and the fallback on the stand-ins that lack them. A pose is a function of the state and the tick.
import { expect } from "bun:test";
import { Pose, blendPose, sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { CreatureAnim, FADE, advanceCreature, creaturePose, idleOf, layer, rayCreature } from "../../shared/anim/creature.ts";
import { Gait, tickPhase } from "../../shared/anim/gait.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { PI } from "../../shared/math/scalar.ts";
import { AnimState, CUE_LAND, CUE_NONE, CUE_STARTLE, CUE_TORPOR, LAYER_EAT, LAYER_FLINCH, LAYER_NONE } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { ACT_SWING, HOLD_HANDS } from "../../shared/sim/weapon.ts";
import { birdAnim } from "../fixtures/bird.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { strider } from "../fixtures/strider.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const rigs = buildRigs(corePack().header.rigs, corePack().clips);
const of = (id: string): CreatureAnim => {
  const kind = reg.index.get(id)!;
  return new CreatureAnim(rigs.get(id)!, reg.runAt[kind]!, reg.move[kind]!.swimSpeed);
};
const DODO = fromArt(() => of("core:dodo"));
const BIRD = birdAnim();
/** The stand-ins: a dinosaur from the pack, with idle, walk, run, attack, jump and death, and a rig with fewer. */
const RAPTOR = fromArt(() => of("core:raptor"));
const STRIDER = new CreatureAnim(strider(), 99, 0);
const START = 1000;

/** A creature standing on the ground, nothing under way. */
function standing(seed = 0): AnimState {
  const st = new AnimState();
  st.seed = seed;
  return st;
}

/** The pose `a` is drawn in, its rotations and root offset. */
function drawn(a: CreatureAnim, st: AnimState, tick: number): number[] {
  creaturePose(a, st, tick, a.rig.a);
  return [...a.rig.a.rot, ...a.rig.a.root];
}

function frame(a: CreatureAnim, clip: Clip, f: number): number[] {
  const p = new Pose(a.rig.bones);
  sampleClip(clip, f, p);
  return [...p.rot, ...p.root];
}

/** The model-space joints of a pose `a` is drawn in. */
function joints(a: CreatureAnim, st: AnimState, tick: number): Float32Array {
  creaturePose(a, st, tick, a.rig.a);
  const s = new Solved(a.rig.bones);
  solve(a.rig, a.rig.a, s);
  return s.pos;
}

/** A tick at which a body with `seed` stands in its idle (`which` -1) or one of its idles, past its fade in. */
function standingIn(a: CreatureAnim, seed: number, which: number): number {
  for (let t = Math.ceil(START / a.slot) * a.slot; ; t += a.slot) if (idleOf(a, seed, t) === which) return t - seed + FADE + 3;
}

test("each state draws its clip at its frame on a species that has it", () => {
  for (const a of [DODO, BIRD]) {
    const name = a.rig.id;
    const st = standing();
    const plain = standingIn(a, 0, -1);
    expect([name, "idle", drawn(a, st, plain)]).toEqual([name, "idle", frame(a, a.idle!, plain)]);
    // Each of its idles, in some turn of its idle: two variants and the call.
    expect([name, a.idles.map((c) => c.id.slice(c.id.indexOf("/") + 1))]).toEqual([name, ["idle_look", "idle_peck", "call"]]);
    for (let which = 0; which < a.idles.length; which++) {
      const at = standingIn(a, 0, which);
      expect([name, which, drawn(a, st, at)]).toEqual([name, which, frame(a, a.idles[which]!, FADE + 3)]);
    }
    // Afloat, still and at its swimming speed of 3 m/s, its swim's own rate.
    st.mode = MODE_SWIM;
    expect([name, "swim_idle", drawn(a, st, plain)]).toEqual([name, "swim_idle", frame(a, a.swimIdle!, plain)]);
    st.speed = 5;
    expect([name, "swim", drawn(a, st, plain)]).toEqual([name, "swim", frame(a, a.swim!, tickPhase(plain, 3, a.swimGait!.stride) * a.swim!.frames)]);
    // Falling, and landing after.
    const air = standing();
    air.grounded = false;
    expect([name, "fall", drawn(a, air, plain)]).toEqual([name, "fall", frame(a, a.fall!, plain)]);
    const land = standing();
    land.cue = CUE_LAND;
    land.cueStart = START & 255;
    expect([name, "land", drawn(a, land, START + FADE + 3)]).toEqual([name, "land", frame(a, a.land!, FADE + 3)]);
    const startle = standing();
    startle.cue = CUE_STARTLE;
    startle.cueStart = START & 255;
    expect([name, "startled", drawn(a, startle, START + 8.5)]).toEqual([name, "startled", frame(a, a.startled!, 8.5)]);
    // Knocked out: going down from the tick it went out, then lying; getting up from the tick it came round.
    const out = standing();
    out.out = true;
    out.cue = CUE_TORPOR;
    out.cueStart = START & 255;
    expect([name, "torpor_in", drawn(a, out, START + 20)]).toEqual([name, "torpor_in", frame(a, a.torporIn!, 20)]);
    out.cue = CUE_NONE;
    expect([name, "torpor_idle", drawn(a, out, plain)]).toEqual([name, "torpor_idle", frame(a, a.torporIdle!, plain)]);
    const up = standing();
    up.cue = CUE_TORPOR;
    up.cueStart = START & 255;
    expect([name, "torpor_out", drawn(a, up, START + 20)]).toEqual([name, "torpor_out", frame(a, a.torporOut!, 20)]);
    const peck = standing();
    peck.setAction(ACT_SWING, HOLD_HANDS, START);
    expect([name, "attack", drawn(a, peck, START + 6)]).toEqual([name, "attack", frame(a, a.attack!, 6)]);
    // A flinch, and a gulp while lying, each turn their bones further, in each bone's own frame.
    for (const [kind, clip, lying] of [[LAYER_FLINCH, a.flinch!, false], [LAYER_EAT, a.torporEat!, true]] as const) {
      const over = standing();
      over.out = lying;
      over.layer = kind;
      over.layerStart = START & 255;
      const base = new Pose(a.rig.bones);
      sampleClip(lying ? a.torporIdle! : a.idle!, plain, base);
      layer(base, clip, plain - START, kind === LAYER_FLINCH ? a.flinchBones : a.eatBones);
      expect([name, kind, drawn(a, over, plain)]).toEqual([name, kind, [...base.rot, ...base.root]]);
    }
  }
});

test("a species without a state's clip goes on with what it does, or falls as it dies when knocked out", () => {
  for (const a of [RAPTOR, STRIDER]) {
    const name = a.rig.id;
    expect([a.swim, a.fall, a.land, a.startled, a.flinch, a.torporIn, a.torporIdle, a.torporOut, a.torporEat, a.idles.length]).toEqual([null, null, null, null, null, null, null, null, null, 0]);
    const plain = standing();
    const tick = START + 30.5;
    const still = drawn(a, plain, tick);
    // Floating, falling, landing, startled and flinching are drawn as it stands.
    for (const set of [(s: AnimState) => (s.mode = MODE_SWIM), (s: AnimState) => (s.grounded = false), (s: AnimState) => ((s.cue = CUE_LAND), (s.cueStart = START & 255)), (s: AnimState) => ((s.cue = CUE_STARTLE), (s.cueStart = START & 255)), (s: AnimState) => ((s.layer = LAYER_FLINCH), (s.layerStart = START & 255))]) {
      const st = standing();
      set(st);
      expect([name, drawn(a, st, tick)]).toEqual([name, still]);
    }
    // Knocked out it falls as it dies and lies as its death leaves it, and it rises from that over a second.
    const out = standing();
    out.out = true;
    out.cue = CUE_TORPOR;
    out.cueStart = START & 255;
    expect([name, drawn(a, out, START + 20)]).toEqual([name, frame(a, a.death!, 20)]);
    out.cue = CUE_NONE;
    const lying = frame(a, a.death!, a.death!.frames - 1);
    expect([name, drawn(a, out, tick)]).toEqual([name, lying]);
    const up = standing();
    up.cue = CUE_TORPOR;
    up.cueStart = START & 255;
    const halfway = new Pose(a.rig.bones);
    const from = new Pose(a.rig.bones);
    sampleClip(a.death!, a.death!.frames - 1, from);
    creaturePose(a, standing(), START + 15, halfway);
    blendPose(halfway, from, halfway, 0.5);
    expect([name, drawn(a, up, START + 15)]).toEqual([name, [...halfway.rot, ...halfway.root]]);
    expect([name, drawn(a, up, START + 31)]).toEqual([name, drawn(a, standing(), START + 31)]);
  }
});

test("a flinch over a walk leaves the feet where the walk put them, and turns the body above them", () => {
  for (const a of [DODO, BIRD]) {
    const feet = a.rig.feet;
    let moved = 0;
    for (let tick = START; tick < START + a.flinch!.frames; tick += 0.5) {
      const walk = standing(7);
      walk.speed = 2;
      const plain = joints(a, walk, tick).slice();
      walk.layer = LAYER_FLINCH;
      walk.layerStart = START & 255;
      const struck = joints(a, walk, tick);
      for (const b of feet) for (let k = 0; k < 3; k++) expect([a.rig.id, tick, a.rig.names[b], struck[b * 3 + k]]).toEqual([a.rig.id, tick, a.rig.names[b], plain[b * 3 + k]!]);
      for (let b = 0; b < a.rig.bones; b++) moved = Math.max(moved, Math.hypot(struck[b * 3]! - plain[b * 3]!, struck[b * 3 + 1]! - plain[b * 3 + 1]!, struck[b * 3 + 2]! - plain[b * 3 + 2]!));
    }
    expect([a.rig.id, moved > 0.02]).toEqual([a.rig.id, true]);
  }
});

test("torpor's clips meet as the animators built them, and a whole knock-out, two meals and the waking never jump", () => {
  for (const a of [DODO, BIRD]) {
    const name = a.rig.id;
    const gap = (p: Clip, f: number, q: Clip, g: number): number => {
      const [one, two] = [new Pose(a.rig.bones), new Pose(a.rig.bones)];
      sampleClip(p, f, one);
      sampleClip(q, g, two);
      const [s1, s2] = [new Solved(a.rig.bones), new Solved(a.rig.bones)];
      solve(a.rig, one, s1);
      solve(a.rig, two, s2);
      let most = 0;
      for (let b = 0; b < a.rig.bones; b++) most = Math.max(most, Math.hypot(s1.pos[b * 3]! - s2.pos[b * 3]!, s1.pos[b * 3 + 1]! - s2.pos[b * 3 + 1]!, s1.pos[b * 3 + 2]! - s2.pos[b * 3 + 2]!));
      return most;
    };
    // Going down ends where lying begins, and getting up begins there: within half a millimetre.
    expect([name, gap(a.torporIn!, a.torporIn!.frames - 1, a.torporIdle!, 0) < 5e-4, gap(a.torporIdle!, 0, a.torporOut!, 0) < 5e-4]).toEqual([name, true, true]);
    // The fastest any joint of the clips in play moves in a tick.
    let fastest = 0;
    for (const clip of [a.idle!, a.walk!, a.torporIn!, a.torporIdle!, a.torporOut!]) for (let f = 1; f < clip.frames; f++) fastest = Math.max(fastest, gap(clip, f - 1, clip, f));
    // Out while walking at 400, its body stopping a few ticks after; fed at 520 and 760; awake at 1900. Every cue is cleared
    // 240 ticks after it began, as the server does.
    const st = standing(211);
    let worst = 0;
    let before: Float32Array | null = null;
    for (let tick = 380; tick < 2100; tick += 0.25) {
      const whole = Math.floor(tick);
      st.out = whole >= 400 && whole < 1900;
      st.speed = whole < 400 + FADE ? 1 : 0;
      const went = whole >= 1900 ? 1900 : 400;
      st.cue = whole >= 400 && whole < went + 240 ? CUE_TORPOR : CUE_NONE;
      st.cueStart = st.cue === CUE_NONE ? 0 : went & 255;
      const fed = whole >= 760 ? 760 : 520;
      st.layer = whole >= 520 && whole < fed + 240 ? LAYER_EAT : LAYER_NONE;
      st.layerStart = st.layer === LAYER_NONE ? 0 : fed & 255;
      const now = joints(a, st, tick).slice();
      if (before) for (let b = 0; b < a.rig.bones; b++) worst = Math.max(worst, Math.hypot(now[b * 3]! - before[b * 3]!, now[b * 3 + 1]! - before[b * 3 + 1]!, now[b * 3 + 2]! - before[b * 3 + 2]!));
      before = now;
      // On the frames the clips play alone, the pose is theirs.
      if (tick === 400 + 30) expect([name, drawn(a, st, tick)]).toEqual([name, frame(a, a.torporIn!, 30)]);
      if (tick === 1900 + 30) expect([name, drawn(a, st, tick)]).toEqual([name, frame(a, a.torporOut!, 30)]);
    }
    // No quarter tick moves a joint further than a quarter of the fastest tick of the clips, and a gulp's, allow.
    expect([name, worst < fastest * 0.25 + 0.004]).toEqual([name, true]);
  }
});

test("a peck is drawn from the tick it began, its bite landing on the frame its clip marks", () => {
  const kind = reg.index.get("core:dodo")!;
  const lands = reg.weapon[kind]!.strikeTick;
  const tip = DODO.rig.sockets.get("beak_tip")!;
  const ahead: number[] = [];
  const st = standing();
  st.setAction(ACT_SWING, HOLD_HANDS, START);
  for (let k = 0; k < DODO.attack!.frames - 1; k++) {
    const p = joints(DODO, st, START + k);
    // The beak's tip is the skull's joint carried by its socket's offset; how far ahead is enough to rank the frames.
    ahead.push(p[tip.bone * 3 + 2]! + tip.z);
  }
  expect([lands, reg.weapon[kind]!.swingTicks, DODO.attack!.frames]).toEqual([6, 15, 15]);
  expect(ahead.indexOf(Math.max(...ahead.slice(0, lands + 3)))).toBeGreaterThanOrEqual(lands - 1);
  expect(drawn(DODO, st, START + lands)).toEqual(frame(DODO, DODO.attack!, lands));
});

test("turning where it stands, it plays its turn by the angle turned, as made to its left and mirrored to its right, and does not walk on the spot", () => {
  for (const a of [DODO, BIRD]) {
    for (const side of [1, -1]) {
      const st = standing();
      const g = new Gait();
      // Its rate, 180 degrees a second, drawn at 60 frames a second: a quarter turn in a quarter second and a bit.
      let yaw = 0;
      for (let f = 0; f <= 14; f++) {
        yaw = (side * f * PI) / 60;
        advanceCreature(a, g, st, START + f / 2, 5, 5, yaw, 1);
      }
      expect([a.rig.id, side, g.speed < 0.01, Math.abs(g.spin) >= a.spinAt, g.turned]).toEqual([a.rig.id, side, true, true, yaw]);
      creaturePose(a, st, START + 7, a.rig.a, g);
      const clip = side > 0 ? a.turn! : a.turnRight!;
      // The frame at which the clip has turned its body as far, its body turning as a smooth step over the clip.
      const at = Math.abs(yaw) / (PI / 2);
      let best = Infinity;
      let frameAt = 0;
      for (let f = 0; f <= clip.frames - 1; f += 0.01) {
        const p = frame(a, clip, f);
        const off = Math.max(...p.map((v, k) => Math.abs(v - (k < a.rig.a.rot.length ? a.rig.a.rot[k]! : a.rig.a.root[k - a.rig.a.rot.length]!))));
        if (off < best) [best, frameAt] = [off, f];
      }
      const x = frameAt / (clip.frames - 1);
      expect([a.rig.id, side, best < 1e-3, Math.abs(x * x * (3 - 2 * x) - at) < 0.01]).toEqual([a.rig.id, side, true, true]);
    }
  }
});

test("knocked out, a dodo is hit where it lies: a ray at its head as drawn lying hits its head, and one where its head stood does not", () => {
  const out = standing();
  out.out = true;
  const lying = joints(DODO, out, START + 40).slice();
  const up = joints(DODO, standing(), START + 40).slice();
  const skull = DODO.rig.names.indexOf("skull");
  const ray = (p: Float32Array): number => rayCreature(DODO, out, START + 40, 0, 0, 0, 0, p[skull * 3]! - 5, p[skull * 3 + 1]! + 0.03, p[skull * 3 + 2]! + 0.03, 1, 0, 0, 10);
  expect([ray(lying), ray(up) === ZONE_HEAD]).toEqual([ZONE_HEAD, false]);
});
