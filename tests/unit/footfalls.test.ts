import { expect, test } from "bun:test";
import { Occasions } from "../../client/core/occasions.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { ClipSet, Clip } from "../../shared/anim/clip.ts";
import { CreatureAnim, creatureFootfalls, creatureFootfallDomain, creaturePose, FOOTFALL_NONE } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { AnimState, DIR_STEPS, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { parsePack, type PackFootfall, type PackRig } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { ACT_HOLD, ACT_DRAW, ACT_NONE, ACT_SWING } from "../../shared/sim/weapon.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { withMotion } from "../../tools/pack/creature.ts";
import { buildPack } from "../../tools/pack/write.ts";

function fixture() {
  const raw: PackRig = { id: "test:four-feet", skeleton: "four-feet", names: ["body", "front_l", "front_r", "rear_l", "rear_r", "head"], parent: [-1, 0, 0, 0, 0, 0], rest: [0, 1, 0, .5, 0, .7, -.5, 0, .7, .5, 0, -.7, -.5, 0, -.7, 0, 1.5, 1], feet: [1, 2, 3, 4] };
  const clips: Clip[] = ["walk", "run", "charge"].map(name => {
    const rot = new Float32Array(20 * 6 * 4);
    for (let frame = 0; frame < 20; frame++) {
      for (let bone = 0; bone < 6; bone++) rot[(frame * 6 + bone) * 4 + 3] = 1;
      quatAxis(rot, frame * 6 * 4, 0, 1, 0, .2 * Math.sin(frame / 20 * Math.PI * 2));
    }
    return { id: `${raw.id}/${name}`, frames: 20, bones: 6, loop: true, rot, root: new Float32Array(60) };
  });
  const rows = (late: number) => raw.names!.slice(1, 5).map((foot, i) => ({ foot, plant: (i * .25 + late) % 1, lift: (i * .25 + late + .6) % 1 }));
  const spec: CreatureAsset = { kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "four-feet", root: "body" }, regions: [], materials: {}, zones: [], sockets: [], clips: clips.map(c => ({ name: c.id.split("/")[1]!, source: "test", loop: true })), feet: raw.names!.slice(1, 5), gaits: { walk: { stride: 2, footfalls: rows(0) }, run: { stride: 4, footfalls: rows(.08) }, charge: { stride: 6, footfalls: rows(.12) } }, budgets: { triangles: [32] } };
  const faults: string[] = [], packed = withMotion(raw, spec, clips, faults);
  expect(faults).toEqual([]);
  const set: ClipSet = { clips, index: new Map(clips.map((c, i) => [c.id, i])), hash: 0 }, rig = buildRig(packed, set)!;
  const attack = { name: "test", clip: "run", type: "melee" as const, ticks: 10, lands: 2, through: 5, damage: 1, stamina: 0, socket: "front", reach: 1, radius: .1 };
  const anim = new CreatureAnim(rig, 4, 1, { primary: attack, charge: { windup: 10, minWindup: 1, duration: 20, recovery: 5, cooldown: 10, speed: 9, turn: 40, stamina: 1, staminaPerSecond: 1, attack } });
  return { raw, spec, clips, packed, set, anim };
}
const phase = (n: number): number => n - Math.floor(n);

test("authored contact phases survive packing and reject missing, duplicate or malformed feet", () => {
  const f = fixture(), roundtrip = parsePack(buildPack([], defaultPalette(), f.clips, [f.packed]));
  expect(roundtrip.header.rigs[0]!.footfalls).toEqual(f.packed.footfalls);
  expect(buildRig(roundtrip.header.rigs[0]!, roundtrip.clips)!.footfalls.size).toBe(3);
  const good = f.spec.gaits.run!.footfalls!;
  for (const rows of [good.slice(1), [...good, good[0]!], good.map((r, i) => i ? r : { ...r, plant: NaN }), good.map((r, i) => i ? r : { ...r, lift: r.plant }), good.map((r, i) => i ? r : { ...r, foot: "missing" })]) {
    const faults: string[] = [];
    const raw = withMotion(f.raw, { ...f.spec, gaits: { run: { stride: 4, footfalls: rows } } }, f.clips, faults);
    expect(faults.length).toBeGreaterThan(0); expect(buildRig(raw, f.set)!.footfalls.size).toBe(0);
  }
});

test("four-foot contact follows actual gait alignment, blended speed, reverse liftoff and charge cadence", () => {
  const { anim } = fixture(), st = new AnimState(), out = new Float64Array(16);
  expect(anim.runGait!.start).not.toBe(0);
  const verify = (speed: number, rows: readonly PackFootfall[], start: number, reverse = false) => {
    expect(creatureFootfalls(anim, creatureFootfallDomain(anim, st, 0), speed, out)).toBe(4);
    rows.forEach((row, i) => { expect(out[i * 2]).toBe(row.bone); expect(out[i * 2 + 1]).toBeCloseTo(phase(reverse ? start - row.lift : row.plant - start), 10); });
  };
  verify(6, anim.runGait!.footfalls!, anim.runGait!.start);
  expect(creatureFootfalls(anim, creatureFootfallDomain(anim, st, 0), 4.5, out)).toBe(4);
  for (let foot = 0; foot < 4; foot++) expect(out[foot * 2 + 1]).toBeCloseTo(phase(foot * .25 + .04 - anim.runGait!.start), 10);
  st.dir = DIR_STEPS / 2; verify(6, anim.runGait!.footfalls!, anim.runGait!.start, true);
  st.setAction(ACT_HOLD, 0, 0); verify(9, anim.chargeGait!.footfalls!, anim.chargeGait!.start);
});

test("a visible quadruped emits each real foot once per cycle and none from cached, sleeping or swimming poses", () => {
  const { anim } = fixture(), drawn = { phase: 0, speed: 0, domain: FOOTFALL_NONE }, st = new AnimState(), remote = new RemoteSample();
  const occasions = new Occasions([anim], new Uint16Array([1]), o => o === "step" ? 1 : 0, null, () => drawn);
  remote.count = 1; remote.id[0] = 1; remote.kind[0] = 0; remote.x[0] = remote.z[0] = 64;
  drawn.speed = 6;
  const frames = (silent = false) => {
    const counts = new Map<number, number>();
    for (let frame = 0; frame <= 80; frame++) {
      remote.tick++; remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
      // Two submitted frames reuse each posed phase; the second must not duplicate the event.
      drawn.phase = phase(Math.floor(frame / 2) / 40);
      drawn.domain = creatureFootfallDomain(anim, st, remote.tick);
      occasions.update(remote, [], [], null, 64, 2, 60, remote.tick * 1000 / 30);
      for (const h of occasions.happened) if (h.occasion === "step") counts.set(h.foot, (counts.get(h.foot) ?? 0) + 1);
    }
    if (silent) expect(counts.size).toBe(0);
    else expect([...counts].sort((a, b) => a[0] - b[0])).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]]);
  };
  frames(); st.out = true; frames(true); st.out = false; st.mode = MODE_SWIM; frames(true);
});

function reaction(f: ReturnType<typeof fixture>, name: string, turn = -1): Clip {
  const rot = new Float32Array(20 * f.raw.names!.length * 4);
  for (let at = 3; at < rot.length; at += 4) rot[at] = 1;
  if (turn >= 0) for (let frame = 0; frame < 20; frame++) quatAxis(rot, (frame * 6 + turn) * 4, 0, 1, 0, .4);
  return { ...f.clips[0]!, id: `${f.raw.id}/${name}`, loop: false, rot };
}
function observe(anim: CreatureAnim, drawn: { phase: number; speed: number; domain: number } | null) {
  const remote = new RemoteSample(), st = new AnimState();
  const occasions = new Occasions([anim], new Uint16Array([1]), o => o === "step" ? 1 : 0, null, drawn ? () => drawn : null);
  remote.count = 1; remote.id[0] = 1; remote.kind[0] = 0; remote.x[0] = remote.z[0] = 64;
  return { remote, st, tick(tick: number) {
    remote.tick = tick; remote.anim[0] = st.pack(); remote.cue[0] = st.packCue();
    occasions.update(remote, [], [], null, 64, 2, 60, tick * 1000 / 30);
    return occasions.happened.filter(h => h.occasion === "step").map(h => h.foot);
  } };
}

test("authored walking below runAt emits all feet, while absent metadata retains the legacy running gate", () => {
  const f = fixture(), legacy = new CreatureAnim(buildRig({ ...f.packed, footfalls: undefined }, f.set)!, 4, 1, f.anim.combat);
  for (const anim of [f.anim, legacy]) {
    const drawn = { phase: 0, speed: 1.5, domain: creatureFootfallDomain(anim, new AnimState(), 0) }, seen = observe(anim, drawn), counts = new Map<number, number>();
    expect(drawn.speed).toBeLessThan(anim.runAt);
    for (let frame = 0; frame <= 40; frame++) {
      drawn.phase = phase(frame / 40);
      for (const foot of seen.tick(100 + frame)) counts.set(foot, (counts.get(foot) ?? 0) + 1);
    }
    expect([...counts].sort()).toEqual(anim === legacy ? [] : [[1, 1], [2, 1], [3, 1], [4, 1]]);
  }
});

test("fixed-foot windup and get-up never emit gait or legacy fallback steps", () => {
  const f = fixture(), clips = [...f.clips, reaction(f, "charge_windup"), reaction(f, "torpor_out")];
  for (const authored of [true, false]) for (const recovery of [false, true]) {
    const anim = new CreatureAnim(buildRig({ ...f.packed, footfalls: authored ? f.packed.footfalls : undefined }, { ...f.set, clips })!, 4, 1, f.anim.combat);
    const drawn = { phase: .49, speed: 6, domain: FOOTFALL_NONE }, seen = observe(anim, drawn), gait = new Gait();
    seen.st.speed = 10;
    if (recovery) { seen.st.cue = CUE_TORPOR; seen.st.cueStart = 85; }
    else seen.st.setAction(ACT_DRAW, 0, 85);
    let previous: Float32Array | null = null;
    for (let frame = 0; frame < 2; frame++) {
      drawn.phase = .49 + frame * .02; drawn.domain = creatureFootfallDomain(anim, seen.st, 100 + frame);
      gait.phase = drawn.phase; gait.speed = drawn.speed;
      creaturePose(anim, seen.st, 100 + frame, anim.rig.a, gait); solve(anim.rig, anim.rig.a, anim.rig.solved);
      if (previous) expect(anim.rig.solved.pos).toEqual(previous);
      previous = anim.rig.solved.pos.slice();
      expect(drawn.domain).toBe(FOOTFALL_NONE); expect(seen.tick(100 + frame)).toEqual([]);
    }
    expect(creatureFootfallDomain(anim, seen.st, 110)).not.toBe(FOOTFALL_NONE);
    // An offscreen body has no drawn callback: the same eligibility must gate its fallback gait.
    const fallback = observe(anim, null); fallback.st.unpack(seen.st.pack(), seen.st.packCue());
    for (let tick = 95; tick <= 104; tick++) { fallback.remote.z[0]! += .2; expect(fallback.tick(tick)).toEqual([]); }
  }
});

test("upper-body attack layers keep footfalls but foot ancestors suppress them", () => {
  const f = fixture(), clips = [...f.clips, reaction(f, "head_strike", 5), reaction(f, "body_strike", 0)], st = new AnimState(), gait = new Gait();
  gait.speed = 6; gait.phase = .2; st.setAction(ACT_SWING, 0, 90);
  for (const [clip, bone, safe] of [["head_strike", "head", true], ["body_strike", "body", false]] as const) {
    const anim = new CreatureAnim(buildRig(f.packed, { ...f.set, clips })!, 4, 1, { primary: { ...f.anim.combat!.primary, clip, bones: [bone] } });
    creaturePose(anim, st, 100, anim.rig.a, gait); solve(anim.rig, anim.rig.a, anim.rig.solved);
    const attack = anim.rig.solved.pos.slice(); st.setAction(ACT_NONE, 0, 0);
    creaturePose(anim, st, 100, anim.rig.a, gait); solve(anim.rig, anim.rig.a, anim.rig.solved); st.setAction(ACT_SWING, 0, 90);
    expect(attack.slice(3, 15).every((v, at) => Math.abs(v - anim.rig.solved.pos[at + 3]!) < 1e-6)).toBe(safe);
    expect(creatureFootfallDomain(anim, st, 100) !== FOOTFALL_NONE).toBe(safe);
    const drawn = { phase: 0, speed: 6, domain: creatureFootfallDomain(anim, st, 100) }, seen = observe(anim, drawn);
    seen.st.unpack(st.pack(), st.packCue());
    const out = new Float64Array(16); creatureFootfalls(anim, creatureFootfallDomain(anim, new AnimState(), 100), 6, out);
    drawn.phase = phase(out[1]! - .01); seen.tick(100); drawn.phase = phase(out[1]! + .01);
    expect(seen.tick(101)).toEqual(safe ? [1] : []);
  }
});

test("cached action/direction uses its captured contact map and a newly posed domain resets crossing history", () => {
  const f = fixture(), drawn = { phase: 0, speed: 6, domain: creatureFootfallDomain(f.anim, new AnimState(), 100) }, seen = observe(f.anim, drawn), out = new Float64Array(16);
  creatureFootfalls(f.anim, drawn.domain, 6, out); const contact = out[1]!;
  drawn.phase = phase(contact - .01); expect(seen.tick(100)).toEqual([]);
  seen.st.dir = DIR_STEPS / 2; seen.st.setAction(ACT_HOLD, 0, 101);
  // The remote now says reverse/charge; the body still displays its forward walk.
  drawn.phase = phase(contact + .01); expect(seen.tick(101)).toEqual([1]);
  seen.st.setAction(ACT_NONE, 0, 0); drawn.domain = creatureFootfallDomain(f.anim, seen.st, 102);
  creatureFootfalls(f.anim, drawn.domain, 6, out); const reverse = out[1]!;
  drawn.phase = phase(reverse + .01); expect(seen.tick(102)).toEqual([]);
  drawn.phase = phase(reverse + .02); expect(seen.tick(103)).toEqual([]);
  drawn.domain = FOOTFALL_NONE; drawn.phase = .49; expect(seen.tick(104)).toEqual([]);
  drawn.domain = creatureFootfallDomain(f.anim, seen.st, 105); drawn.phase = .51; expect(seen.tick(105)).toEqual([]);
});
