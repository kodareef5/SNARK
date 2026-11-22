// What a dodo goes through on a running server, drawn as its clients draw it: knocked out, fed and waking; startled,
// struck and pecking; dropped and landing; and standing about, where every client draws the idle the server poses.

import { expect } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { CUE_TICKS } from "../../server/creatures.ts";
import { MIND_FLEE } from "../../server/behavior.ts";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { FADE, advanceCreature, creaturePose, idleOf } from "../../shared/anim/creature.ts";
import { Gait } from "../../shared/anim/gait.ts";
import { AnimState, CUE_LAND, CUE_NONE, CUE_OUT, CUE_STARTLE, CUE_TORPOR, LAYER_EAT, LAYER_FLINCH, LAYER_NONE, bodySeed } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { test } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";

/** Ada, and any others named, on level ground with cheats on, where nothing harms her; a dodo of `level` before her. */
function camp(level = 1, others: string[] = []) {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const more = others.map((name) => h.join(name));
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 1.6, level);
  expect(e).toBeGreaterThanOrEqual(0);
  h.host.creatures.mind.stay(e, h.world.tick + 1e6);
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  const anim = h.world.anims[h.reg.index.get("core:dodo")!]!;
  return { h, ada, more, e, rec, anim, me };
}

/** From now on, the pose state and cues of `e` after each tick the server steps, by tick. `each` is told of each tick. */
function watch(h: Harness, e: number, each?: (tick: number) => void): Map<number, [number, number]> {
  const seen = new Map<number, [number, number]>();
  const step = h.server.tick.bind(h.server);
  h.server.tick = () => {
    step();
    seen.set(h.world.tick, [h.world.ents.anim[e]!, h.world.ents.cue[e]!]);
    each?.(h.world.tick);
  };
  return seen;
}

function cues(word: number): AnimState {
  const st = new AnimState();
  st.unpackCue(word);
  return st;
}

test("knocked out, fed twice and waking, the dodo's cues follow the server's torpor, and it is drawn going down, lying, gulping and getting up without a jump", () => {
  const { h, ada, e, rec, anim } = camp();
  const ents = h.world.ents;
  const berry = h.reg.index.get("core:berry")!;
  let woke = -1;
  const bites: number[] = [];
  let ate = h.host.taming.bites;
  const seen = watch(h, e, (tick) => {
    if (h.host.taming.bites > ate) {
      bites.push(tick);
      ate = h.host.taming.bites;
    }
    if (woke < 0 && seen.has(out) && !rec.out) woke = tick;
  });
  let out = -1;
  h.run(1500);
  // Out cold by torpor past its most, between two ticks.
  out = h.world.tick;
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  expect(rec.out).toBe(true);
  seen.set(out, [ents.anim[e]!, ents.cue[e]!]);
  h.run(2000);
  // Ada opens it and puts in two berries, which it eats eight and sixteen seconds after it went down.
  const me = h.ent(ada);
  const pilot = h.pilots[0]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  pilot.yaw = Math.atan2(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!);
  pilot.pitch = Math.atan2(ents.y[e]! + 0.3 - eye, Math.hypot(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!));
  h.run(150);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  h.say(ada, "give core:berry 2");
  const inv = ada.inventory!;
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(berry)), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(0), w.u16(berry)));
  // Torpor 30 wears off at 0.3 a second: it comes round 100 s after it went down.
  h.run(110000);
  expect([bites.map((t) => Math.round((t - out) / TICK_RATE)), Math.round((woke - out) / TICK_RATE)]).toEqual([[8, 16], 100]);
  // Each tick's cues are the server's torpor: out from the tick it went down to the tick it woke, going down and getting up
  // begun on those ticks, a gulp on each tick it ate, and each cleared CUE_TICKS after it began.
  for (const [tick, [, word]] of seen) {
    const st = cues(word);
    const went = tick >= woke ? woke : out;
    const fed = bites.filter((b) => b <= tick).at(-1) ?? -1;
    const want = [tick >= out && tick < woke, tick >= out && tick - went < CUE_TICKS ? CUE_TORPOR : CUE_NONE, fed >= 0 && tick - fed < CUE_TICKS ? LAYER_EAT : LAYER_NONE];
    expect([tick, st.out, st.cue, st.layer]).toEqual([tick, ...want] as [number, boolean, number, number]);
    if (st.cue !== CUE_NONE) expect(st.cueStart).toBe(went & 255);
    if (st.layer !== LAYER_NONE) expect(st.layerStart).toBe(fed & 255);
  }
  // Drawn as a client draws it, a quarter tick at a time with a gait kept: what plays alone on its frames is its own clip,
  // and no quarter tick moves a joint further than the fastest of the clips in play does in a quarter of a tick.
  const st = new AnimState();
  st.seed = bodySeed(e);
  const g = new Gait();
  const rig = anim.rig;
  const solved = new Solved(rig.bones);
  const [p, q] = [new Pose(rig.bones), new Pose(rig.bones)];
  const own = (clip: (typeof anim)["idle"], f: number): number[] => (sampleClip(clip!, f, p), [...p.rot, ...p.root]);
  let fastest = 0;
  for (const clip of [anim.idle!, anim.torporIn!, anim.torporIdle!, anim.torporOut!]) {
    for (let f = 1; f < clip.frames; f++) {
      sampleClip(clip, f - 1, p);
      solve(rig, p, solved);
      const before = solved.pos.slice();
      sampleClip(clip, f, q);
      solve(rig, q, solved);
      for (let b = 0; b < rig.bones; b++) fastest = Math.max(fastest, Math.hypot(solved.pos[b * 3]! - before[b * 3]!, solved.pos[b * 3 + 1]! - before[b * 3 + 1]!, solved.pos[b * 3 + 2]! - before[b * 3 + 2]!));
    }
  }
  let before: Float32Array | null = null;
  let worst = 0;
  for (let tick = out - 25; tick < woke + 120; tick += 0.25) {
    const [word, cue] = seen.get(Math.floor(tick))!;
    st.unpack(word, cue);
    advanceCreature(anim, g, st, tick, 0, 0, 0, 1);
    creaturePose(anim, st, tick, rig.a, g);
    if (tick === out + 30) expect([...rig.a.rot, ...rig.a.root]).toEqual(own(anim.torporIn, 30));
    if (tick === woke + 40) expect([...rig.a.rot, ...rig.a.root]).toEqual(own(anim.torporOut, 40));
    solve(rig, rig.a, solved);
    if (before) for (let b = 0; b < rig.bones; b++) worst = Math.max(worst, Math.hypot(solved.pos[b * 3]! - before[b * 3]!, solved.pos[b * 3 + 1]! - before[b * 3 + 1]!, solved.pos[b * 3 + 2]! - before[b * 3 + 2]!));
    before = solved.pos.slice();
  }
  expect(worst).toBeLessThan(fastest * 0.25 + 0.004);
});

test("a wild dodo struck flinches and is startled into its run; one that is somebody's flinches, and its peck lands on the frame its clip marks", () => {
  const { h, ada, e, me } = camp();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const hit = h.world.tick;
  h.host.creatures.provoke(e, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  let st = cues(ents.cue[e]!);
  expect([mind.mind[e], st.cue, st.cueStart, st.layer, st.layerStart]).toEqual([MIND_FLEE, CUE_STARTLE, hit & 255, LAYER_FLINCH, hit & 255]);
  // Struck again while still flinching, it goes on with the flinch it has; fleeing already, it is not startled again.
  h.run(100);
  h.host.creatures.provoke(e, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  st = cues(ents.cue[e]!);
  expect([st.cueStart, st.layerStart]).toEqual([hit & 255, hit & 255]);
  // Both are cleared CUE_TICKS after they began.
  h.run(((CUE_TICKS + 2) * 1000) / TICK_RATE);
  expect(ents.cue[e]).toBe(0);

  // Another, of a tribe not Ada's, bites back when she strikes it.
  const tame = h.host.spawnCreature("core:dodo", ents.x[h.ent(ada)]! + 1, ents.z[h.ent(ada)]!, 1);
  const rec = h.host.records.byPid.get(ents.pid[tame]!)!;
  rec.team = me.team + 1;
  ents.setTeam(tame, rec.team);
  h.host.creatures.claimed(tame);
  const anim = h.world.anims[ents.kind[tame]!]!;
  const strikes: [number, number][] = [];
  const onStrike = h.host.creatures.onStrike!;
  h.host.creatures.onStrike = (b) => {
    if (b === tame) strikes.push([h.world.tick, ents.anim[b]!]);
    onStrike(b);
  };
  h.host.creatures.provoke(tame, ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!, h.ent(ada));
  expect(cues(ents.cue[tame]!).layer).toBe(LAYER_FLINCH);
  h.run(4000);
  expect(strikes.length).toBeGreaterThan(2);
  const lands = h.reg.weapon[ents.kind[tame]!]!.strikeTick;
  const pose = new Pose(anim.rig.bones);
  sampleClip(anim.attack!, lands, pose);
  for (const [tick, word] of strikes) {
    const at = new AnimState();
    at.unpack(word);
    at.seed = bodySeed(tame);
    // The bite lands on the tick its clip is drawn at the frame it marks.
    expect([tick, ((tick & 255) - at.actionStart) & 255]).toEqual([tick, lands]);
    creaturePose(anim, at, tick, anim.rig.a);
    expect([...anim.rig.a.rot]).toEqual([...pose.rot]);
  }
});

test("a dodo dropped from two metres falls and lands, and one saved knocked out lies as it was", () => {
  const { h, e, rec } = camp();
  const ents = h.world.ents;
  ents.setPosition(e, ents.x[e]!, ents.y[e]! + 2, ents.z[e]!);
  ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
  let fell = false;
  let landed = -1;
  watch(h, e, (tick) => {
    const st = new AnimState();
    st.unpack(ents.anim[e]!, ents.cue[e]!);
    if (!st.grounded) fell = true;
    if (landed < 0 && st.cue === CUE_LAND) landed = tick;
  });
  h.run(2000);
  expect([fell, landed > 0, cues(ents.cue[e]!).cueStart]).toEqual([true, true, landed & 255]);
  // Gone from the world and back, knocked out, it is not knocked down again.
  rec.out = true;
  h.host.creatures.remove(e);
  const back = h.host.creatures.adopt(rec);
  expect(ents.cue[back]).toBe(CUE_OUT);
});

test("two clients and the server draw a dodo standing about in the same idle, its variants and its call at the same moments", () => {
  const { h, ada, more, e, anim } = camp(1, ["bea"]);
  const ents = h.world.ents;
  const sample = new RemoteSample();
  const server = new AnimState();
  const st = new AnimState();
  const played = new Set<number>();
  let compared = 0;
  let frames = 0;
  h.run(180000, () => {
    if (++frames % 30 !== 0) return;
    for (const s of [ada, ...more]) {
      s.sampleRemote(sample);
      const i = Array.from(sample.id.subarray(0, sample.count)).indexOf(e);
      if (i < 0) continue;
      st.unpack(sample.anim[i]!, sample.cue[i]!);
      st.seed = bodySeed(sample.id[i]!);
      server.unpack(ents.anim[e]!, ents.cue[e]!);
      server.seed = bodySeed(e);
      const tick = sample.tick;
      // Which plays is the same, and so is the pose, posed by the client from what it was sent and by the server from its own.
      expect(idleOf(anim, st.seed, tick + st.seed)).toBe(idleOf(anim, server.seed, tick + server.seed));
      creaturePose(anim, st, tick, anim.rig.a);
      const drawn = [...anim.rig.a.rot];
      creaturePose(anim, server, tick, anim.rig.a);
      expect(drawn).toEqual([...anim.rig.a.rot]);
      played.add(idleOf(anim, st.seed, tick + st.seed));
      compared++;
    }
  });
  expect(compared).toBeGreaterThan(300);
  // In three minutes it has stood in its idle and in each of its idles: the look, the peck at the ground and the call.
  expect([...played].sort()).toEqual([-1, 0, 1, 2]);
  expect(anim.idles.map((c) => c.id)).toEqual(["core:dodo/idle_look", "core:dodo/idle_peck", "core:dodo/call"]);
  expect(FADE).toBeLessThan(anim.slot - anim.idles.reduce((most, c) => Math.max(most, c.frames), 0));
});
