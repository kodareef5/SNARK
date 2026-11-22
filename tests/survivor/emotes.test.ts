// The emotes' clips (shared/anim/emote-clips.ts) and their table (shared/anim/emotes.ts): every emote has a clip that is
// sound on every frame, a loop closes on itself, no part of the body goes through the floor, and the two sides of a pair
// meet where the move says when they stand as the server stands them.

import { expect, test } from "bun:test";
import { Pose, sampleClip, type Clip } from "../../shared/anim/clip.ts";
import { AUTHORED_EMOTES, emoteClips } from "../../shared/anim/emote-clips.ts";
import { mirrorPose } from "../../shared/anim/emote.ts";
import { EMOTES, EMOTE_NUMBER, LIBRARY_EMOTES, emoteClipId, emoteOf } from "../../shared/anim/emotes.ts";
import { B_HAND_L, B_HAND_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, EMOTE_MIRROR, EMOTE_PARTNER, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { authoredClips } from "../../shared/anim/authored.ts";

const clips = new Map(emoteClips().map((c) => [c.id, c]));
const clipOf = (id: string): Clip => clips.get(emoteClipId(id))!;

/** Each joint's model-space position at a frame. */
function joints(c: Clip, frame: number): Float32Array {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  sampleClip(c, frame, pose);
  solve(HUMAN, pose, solved);
  return solved.pos;
}

test("the table: ids unique, every emote tagged, every pair's other side an emote, each written as a clip", () => {
  expect(new Set(EMOTES.map((e) => e.id)).size).toBe(EMOTES.length);
  for (const e of EMOTES) {
    expect(e.tags.length).toBeGreaterThan(0);
    if (e.pair) expect(EMOTE_NUMBER.get(e.pair.with)).toBeDefined();
    if (LIBRARY_EMOTES.has(e.id)) continue;
    expect(AUTHORED_EMOTES).toContain(e.id);
    expect(clips.get(emoteClipId(e.id))).toBeDefined();
  }
  // In the clips every pack and test carries, so the server and clients agree on them.
  expect(authoredClips().filter((c) => c.id.startsWith("human/emote/")).length).toBe(EMOTES.length - LIBRARY_EMOTES.size);
});

test("every frame of every clip is sound: unit rotations, nothing through the floor, the hips in reach of the ground", () => {
  for (const e of EMOTES.filter((x) => !LIBRARY_EMOTES.has(x.id))) {
    const c = clipOf(e.id);
    expect(c.bones).toBe(HUMAN_BONES);
    for (let i = 0; i < c.rot.length; i += 4) {
      const len = Math.hypot(c.rot[i]!, c.rot[i + 1]!, c.rot[i + 2]!, c.rot[i + 3]!);
      if (!(Math.abs(len - 1) < 1e-3)) throw new Error(`${e.id}: a rotation of length ${len}`);
    }
    for (let f = 0; f < c.frames; f++) {
      const p = joints(c, f);
      let low = Infinity;
      for (let b = 0; b < HUMAN_BONES; b++) low = Math.min(low, p[b * 3 + 1]!);
      if (low < -0.03) throw new Error(`${e.id} frame ${f}: a joint ${low.toFixed(3)} m below the floor`);
      // The hips no higher than a jump takes them.
      if (p[1]! > 1.45) throw new Error(`${e.id} frame ${f}: hips at ${p[1]!.toFixed(2)} m`);
    }
  }
});

test("a loop closes on itself: its last frame runs into its first without a jump", () => {
  for (const e of EMOTES.filter((x) => x.loop && !LIBRARY_EMOTES.has(x.id))) {
    const c = clipOf(e.id);
    // The step from the last frame to the first, beside the largest step within the clip.
    const step = (f: number, g: number) => {
      const p = joints(c, f), q = joints(c, g);
      let most = 0;
      for (let b = 0; b < HUMAN_BONES; b++) most = Math.max(most, Math.hypot(p[b * 3]! - q[b * 3]!, p[b * 3 + 1]! - q[b * 3 + 1]!, p[b * 3 + 2]! - q[b * 3 + 2]!));
      return most;
    };
    let within = 0;
    for (let f = 0; f + 1 < c.frames; f++) within = Math.max(within, step(f, f + 1));
    const seam = step(c.frames - 1, 0);
    if (seam > Math.max(within * 1.6, 0.03)) throw new Error(`${e.id}: the loop jumps ${seam.toFixed(3)} m at its seam (${within.toFixed(3)} within)`);
  }
});

test("a pair meets: stood face to face `apart` metres, the two hands come together where the move joins them", () => {
  // Each side alone, its partner facing it from `apart` ahead: the partner's model space turned half round.
  const meet = (id: string, at: number, left = false): number => {
    const def = emoteOf(EMOTE_NUMBER.get(id)!)!;
    const a = clipOf(id), b = clipOf(def.pair!.with);
    const f = Math.floor(at * (a.frames - 1));
    const pa = joints(a, f), pb = joints(b, Math.floor(at * (b.frames - 1)));
    const hand = left ? B_HAND_L : B_HAND_R;
    const [ax, ay, az] = [pa[hand * 3]!, pa[hand * 3 + 1]!, pa[hand * 3 + 2]!];
    const [bx, by, bz] = [-pb[hand * 3]!, pb[hand * 3 + 1]!, def.pair!.apart - pb[hand * 3 + 2]!];
    return Math.hypot(ax - bx, ay - by, az - bz);
  };
  expect(meet("handshake", 0.5)).toBeLessThan(0.1);
  expect(meet("high_five", 0.45)).toBeLessThan(0.12);
  expect(meet("fist_bump", 0.47)).toBeLessThan(0.14);
});

test("the emote word packs and unpacks; a pose with an emote is the same each time; a mirrored emote is its mirror", () => {
  const st = new AnimState();
  st.emote = EMOTE_NUMBER.get("hug")!;
  st.emoteStart = 54321;
  st.emoteRole = EMOTE_PARTNER;
  st.emoteMirror = true;
  const word = st.packEmote();
  expect(word & EMOTE_MIRROR).not.toBe(0);
  const back = new AnimState();
  back.unpackEmote(word);
  expect([back.emote, back.emoteStart, back.emoteRole, back.emoteMirror]).toEqual([st.emote, st.emoteStart, st.emoteRole, true]);
  const anim = new HumanAnim({ clips: [...authoredClips()], index: new Map(authoredClips().map((c, i) => [c.id, i])), hash: 0 });
  const dance = new AnimState();
  dance.emote = EMOTE_NUMBER.get("disco")!;
  dance.emoteStart = 100;
  const one = new Pose(HUMAN_BONES), two = new Pose(HUMAN_BONES);
  humanPose(anim, dance, 137.5, one);
  humanPose(anim, dance, 137.5, two);
  expect(Array.from(one.rot)).toEqual(Array.from(two.rot));
  // Played mirrored, the left hand goes where the right went, across the body.
  dance.emoteMirror = true;
  const mirrored = new Pose(HUMAN_BONES);
  humanPose(anim, dance, 137.5, mirrored);
  const flip = new Pose(HUMAN_BONES);
  mirrorPose(one, flip);
  const s1 = new Solved(HUMAN_BONES), s2 = new Solved(HUMAN_BONES);
  solve(HUMAN, mirrored, s1);
  solve(HUMAN, flip, s2);
  expect(s1.pos[B_HAND_L * 3]!).toBeCloseTo(s2.pos[B_HAND_L * 3]!, 3);
  const plain = new Solved(HUMAN_BONES);
  solve(HUMAN, one, plain);
  expect(s1.pos[B_HAND_L * 3]!).toBeCloseTo(-plain.pos[B_HAND_R * 3]!, 3);
});
