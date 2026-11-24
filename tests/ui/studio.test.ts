// The wiki's studio (client/entry/studio.ts, client/core/studio/*): every clip a body has is offered once, in groups, and
// plays exactly as the game has it through the characters' pose override, which leaves the game's own posing alone while
// null; the clock loops, holds, scrubs and speeds; the view shows the whole subject and never goes under the ground; and
// each kind of definition is shown as the game draws it, or not at all.

import { expect, test } from "bun:test";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { EMOTES, LIBRARY_EMOTES } from "../../shared/anim/emotes.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { RIG_CLIPS } from "../../shared/anim/rigs.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { FISTS } from "../../shared/sim/weapon.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Playback } from "../../client/core/studio/clock.ts";
import { clipOf, creatureMoves, firstMove, humanMoves, labelOf } from "../../client/core/studio/moves.ts";
import { Orbit, pinchZoom } from "../../client/core/studio/orbit.ts";
import { boundsOf, subjectOf } from "../../client/core/studio/subject.ts";
import { corePack } from "../fixtures/pack.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { birdAnim } from "../fixtures/bird.ts";
import type { Clip } from "../../shared/anim/clip.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const pack = corePack();
const chars = (): Characters => new Characters(reg, pack, new Assets(reg, pack));
/** A creature of the core content drawn on its own rig. */
const creatureKind = (): number => {
  const c = chars();
  for (let k = 1; k < reg.defs.length; k++) {
    const d = reg.defs[k];
    if (c.creature(k) && !reg.vehicle[k] && d?.type === "species" && d.class === "creature") return k;
  }
  throw new Error("no creature on a rig of its own in the test pack");
};
/** A clip of `bones` bones that bends every bone a little more each frame. */
const bending = (bones: number, frames = 16): Clip => {
  const rot = new Float32Array(frames * bones * 4);
  for (let f = 0; f < frames; f++) for (let b = 0; b < bones; b++) {
    const a = (f + 1) * 0.02 * ((b % 3) + 1);
    rot.set([Math.sin(a), 0, 0, Math.cos(a)], (f * bones + b) * 4);
  }
  return { id: "t:bend", bones, frames, loop: true, rot, root: new Float32Array(frames * 3) };
};

test("a creature's moves are every clip it has, each once, in groups, idle first", () => {
  const anim = birdAnim();
  const groups = creatureMoves(anim);
  const keys = groups.flatMap((g) => g.moves.map((m) => m.key));
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(keys)).toEqual(new Set(anim.rig.clips.keys()));
  for (const m of groups.flatMap((g) => g.moves)) expect(clipOf(m.source, anim, null)).toBe(anim.rig.clips.get(m.key)!);
  expect(groups.every((g) => g.moves.length > 0)).toBe(true);
  if (anim.rig.clips.has("idle")) expect(firstMove(groups)!.key).toBe("idle");
  // Every name a rig may have has a group of its own, so nothing falls to "More" but an asset's own extras.
  const grouped = groups.filter((g) => g.name !== "More").flatMap((g) => g.moves.map((m) => m.key));
  for (const n of RIG_CLIPS) if (anim.rig.clips.has(n)) expect(grouped).toContain(n);
  expect(labelOf("take_off")).toBe("Take off");
  expect(labelOf("idle_look")).toBe("Idle: look");
});

test("the survivor's moves are its own clips, then all eighty emotes, each saying why it cannot play yet", () => {
  const c = chars();
  const before = humanMoves(c.anim, false);
  // Its own clips, those it has: the test pack has the authored ones (crouched, prone, bow and guns), not the art's.
  const own = before.filter((g) => !g.name.startsWith("Emotes"));
  expect(own.length).toBeGreaterThan(0);
  for (const m of own.flatMap((g) => g.moves)) expect(clipOf(m.source, null, c.anim)).not.toBeNull();
  const emotes = before.filter((g) => g.name.startsWith("Emotes")).flatMap((g) => g.moves);
  expect(emotes.length).toBe(EMOTES.length);
  expect(new Set(emotes.map((m) => m.key)).size).toBe(EMOTES.length);
  // Before the emotes have come, one with no clip is on its way; once they have, a library one waits for the art release.
  const wave = emotes.find((m) => m.key === "emote:wave")!;
  if (!clipOf(wave.source, null, c.anim)) expect(wave.missing).toBe("on its way");
  const after = humanMoves(c.anim, true).flatMap((g) => g.moves);
  for (const id of LIBRARY_EMOTES) {
    const m = after.find((x) => x.key === `emote:${id}`)!;
    if (!clipOf(m.source, null, c.anim)) expect(m.missing).toBe("needs the art release");
  }
  expect(firstMove(before)!.key).toBe(c.anim.idle ? "idle" : own[0]!.moves[0]!.key);
});

test("the studio shows each strike with its tool and its in-game timing", () => {
  const anim = chars().anim;
  const moves = humanMoves(anim, false).flatMap((g) => g.moves);
  const p = new Playback();
  for (const [key, item] of [
    ["jab", undefined], ["cross", undefined], ["chopA", "core:hatchet"],
    ["chopB", "core:hatchet"], ["pickA", "core:pick"], ["pickB", "core:pick"],
  ] as const) {
    const move = moves.find((m) => m.key === key)!;
    const clip = clipOf(move.source, null, anim)!;
    const weapon = item ? reg.weapon[reg.index.get(item)!]! : FISTS;
    expect(move.item).toBe(item);
    p.start(clip.frames, clip.loop, move.durationTicks);
    expect(p.length).toBe(weapon.swingTicks / TICK_RATE);
    p.step(weapon.strikeTick / TICK_RATE);
    expect(p.at).toBeCloseTo((clip.frames - 1) * weapon.strikeTick / weapon.swingTicks);
    expect(p.seconds).toBeCloseTo(weapon.strikeTick / TICK_RATE);
    p.step((weapon.swingTicks - weapon.strikeTick) / TICK_RATE);
    expect(p.playing).toBe(false);
    expect(p.at).toBe(clip.frames - 1);
  }
  expect(moves.find((m) => m.key === "toolCarry")!.item).toBe("core:hatchet");
});

test("a repeated strike meets the next on time and scrubs through its swing", () => {
  const p = new Playback();
  p.start(61, false, 15);
  p.loop = true;
  p.step(0.5);
  expect(p.at).toBe(0);
  expect(p.length).toBe(0.5);
  p.scrub(0.5);
  expect(p.seconds).toBe(0.25);
  expect(p.share).toBe(0.5);
  p.speed = 0.25;
  p.step(0.5);
  expect(p.share).toBe(0.75);
  p.start(30, true);
  expect(p.length).toBe(1);
});

test("the clock loops, holds a one-shot's last frame, scrubs and speeds", () => {
  const p = new Playback();
  p.start(30, true);
  p.step(1.5);
  expect(p.at).toBeCloseTo(15, 6);
  p.speed = 2;
  p.step(0.5);
  expect(p.at).toBeCloseTo(15 + 30 - 30, 6);
  p.start(31, false);
  p.step(5);
  expect([p.at, p.playing]).toEqual([30, false]);
  p.play();
  expect([p.at, p.playing]).toEqual([0, true]);
  p.scrub(0.5);
  expect(p.at).toBeCloseTo(15, 6);
  expect(p.share).toBeCloseTo(0.5, 6);
  p.playing = false;
  p.step(1);
  expect(p.at).toBeCloseTo(15, 6);
});

test("the view shows the whole subject, turns until dragged, zooms within reach and never goes under the ground", () => {
  const o = new Orbit(), cam = new Camera();
  const b = { x: 10, y: 1, z: 20, radius: 2 };
  o.frame(b, 0.7, 16 / 9, 0);
  o.place(cam);
  const d = Math.hypot(cam.x - b.x, cam.y - b.y, cam.z - b.z);
  expect(Math.asin(b.radius / d)).toBeLessThanOrEqual(0.35 + 1e-9);
  // It looks at the subject.
  const fx = Math.sin(cam.yaw) * Math.cos(cam.pitch), fy = Math.sin(cam.pitch), fz = Math.cos(cam.yaw) * Math.cos(cam.pitch);
  expect(fx * (b.x - cam.x) + fy * (b.y - cam.y) + fz * (b.z - cam.z)).toBeCloseTo(d, 6);
  const yaw = o.yaw;
  o.step(1);
  expect(o.yaw).not.toBe(yaw);
  o.drag(40, 0);
  const held = o.yaw;
  o.step(1);
  expect(o.yaw).toBe(held);
  // Dragged up as far as it goes, the camera stays over the ground.
  for (let i = 0; i < 50; i++) o.drag(0, -200);
  o.place(cam);
  expect(cam.y).toBeGreaterThan(0);
  for (let i = 0; i < 50; i++) o.zoom(2);
  expect(o.distance).toBeCloseTo(o.framed * 0.35, 6);
  for (let i = 0; i < 50; i++) o.zoom(0.5);
  expect(o.distance).toBeCloseTo(o.framed * 3, 6);
  expect(pinchZoom(100, 150)).toBe(1.5);
  expect(pinchZoom(0, 150)).toBe(1);
});

test("each kind is shown as the game draws it: a body, a vehicle, a structure for the item that places it, an item lying", () => {
  const kinds = new Map<string, string>();
  for (const d of reg.defs) {
    if (!d) continue;
    const s = subjectOf(reg, d.id);
    if (s) kinds.set(s.kind, d.id);
  }
  expect([...kinds.keys()].sort()).toEqual(["creature", "item", "structure", "survivor", "vehicle"]);
  expect(subjectOf(reg, "core:survivor")!.kind).toBe("survivor");
  // An item that places a structure shows the structure.
  const placer = reg.defs.find((d) => d?.type === "item" && (d.places?.length ?? 0) > 0)!;
  const s = subjectOf(reg, placer.id)!;
  expect(s.kind).toBe("structure");
  expect(reg.defs[s.index]!.type).toBe("structure");
  expect(subjectOf(reg, "core:nothing_at_all")).toBeNull();
  // Bounds hold the body, from its own size where no mesh is known.
  const b = boundsOf(reg, subjectOf(reg, "core:survivor")!, null);
  expect(b.y).toBeGreaterThan(0.5);
  expect(b.radius).toBeGreaterThan(0.8);
});

// A creature on its own rig needs the art's pack: the test pack's only rigs are the vehicles'.
artTest("the override plays a clip exactly as the game has it, and while null the game poses as it did", () => {
  const kind = creatureKind();
  const run = (frame: number | null): Float32Array => {
    const c = chars(), packet = new FramePacket(), st = new AnimState();
    if (frame !== null) c.override = { id: 7, clip: bending(c.creature(kind)!.rig.bones), frame };
    packet.beginFrame();
    c.begin();
    expect(c.add(packet, kind, 0, 0, 0, 0, st, 40, null, 0, new Uint8Array(6), 0, null, 0, 7, false, false)).toBe(true);
    return packet.bones.slice(0, packet.boneCount * 12);
  };
  const plain = run(null);
  expect(run(null)).toEqual(plain);
  const a = run(3), b = run(11);
  expect(a).not.toEqual(b);
  expect(a).not.toEqual(plain);
  expect(run(3)).toEqual(a);
  // The solved pose under the override is the clip's frame, solved.
  const c = chars(), rig = c.creature(kind)!.rig, clip = bending(rig.bones);
  c.override = { id: 9, clip, frame: 5 };
  expect(c.prepareCameraBody(kind, 9, 1, 0, 0, 0, 0, new AnimState(), 40)).not.toBeNull();
  const pose = new Pose(rig.bones), want = new Solved(rig.bones);
  sampleClip(clip, 5, pose);
  solve(rig, pose, want);
  const got = (c as unknown as { gaits: Map<number, { solved: Solved }> }).gaits.get(9)!.solved;
  expect(Array.from(got.pos)).toEqual(Array.from(want.pos));
  expect(Array.from(got.rot)).toEqual(Array.from(want.rot));
});

test("a survivor under the override is posed from the clip, and differently from its idle", () => {
  const kind = reg.index.get("core:survivor")!;
  const run = (frame: number | null): Float32Array => {
    const c = chars(), packet = new FramePacket(), st = new AnimState();
    if (frame !== null) c.override = { id: 3, clip: c.anim.proneCrawl ?? bending(c.anim.crouchIdle!.bones, 40), frame };
    packet.beginFrame();
    c.begin();
    expect(c.add(packet, kind, 0, 0, 0, 0, st, 40, null, 0, new Uint8Array(6), 0, null, 0, 3, false, false)).toBe(true);
    return packet.bones.slice(0, packet.boneCount * 12);
  };
  expect(run(null)).toEqual(run(null));
  expect(run(4)).not.toEqual(run(null));
  expect(run(4)).toEqual(run(4));
  expect(run(4)).not.toEqual(run(12));
});
