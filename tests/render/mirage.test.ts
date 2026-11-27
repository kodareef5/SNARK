// The air's waver over what is hot (client/core/render/mirage.ts): cards over a fire near the eye and a blast's shock
// ring, drawn by no draw of the frame but named as a run for a shell with a light target, on the tiers whose finish
// reads them; and the texts that write a shift and read the scene by it.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { effectsOff, tierWithout } from "../../client/core/passes.ts";
import { MIRAGE_FRAGMENT, MIRAGE_GLSL, MIRAGE_MOST, MIRAGE_NONE, MIRAGE_PIXELS, MIRAGE_REACH, MIRAGE_TURN_MS, MIRAGE_VERTEX, Mirage } from "../../client/core/render/mirage.ts";
import { DETAIL, DETAIL_FLOATS, DRAW_DETAILS, FRAME_FLOATS, FramePacket, MAX_DETAILS, MIRAGE_AT } from "../../client/core/render/packet.ts";
import { FINISH } from "../../client/core/render/post.ts";
import { PROGRAM, PROGRAMS, UNIT, tierPrograms } from "../../client/core/render/programs.ts";
import { burningKind } from "../../content/docks.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SURFACE_GROUND } from "../../shared/net/rockets.ts";
import { provingView } from "../../tools/snap.ts";

const high = tierOf("high"), medium = tierOf("medium");

/** The cards of a packet's run of hot air: where each is, its half extents, its strength and its kind. */
function run(p: FramePacket): { at: number[]; tall: number; half: number; strength: number; kind: number }[] {
  return Array.from({ length: p.mirageCount }, (_, k) => {
    const o = (p.mirageFirst + k) * DETAIL_FLOATS, d = p.details, misc = p.detailWords[o + DETAIL.misc]!;
    return { at: [d[o]!, d[o + 1]!, d[o + 2]!], tall: Math.hypot(d[o + 3]!, d[o + 4]!, d[o + 5]!), half: Math.hypot(d[o + 6]!, d[o + 7]!, d[o + 8]!), strength: ((misc >>> 16) & 255) / 255, kind: misc >>> 24 };
  });
}

test("hot air is a card square to the eye, weaker far off and gone by its reach, and no more than the frame holds", () => {
  const m = new Mirage(), p = new FramePacket();
  m.begin();
  m.over(0, 2, 10, 1, 2, 1, 0.3);
  m.over(0, 2, (5 * MIRAGE_REACH) / 6, 1, 2, 1, 0.3);
  m.over(0, 2, MIRAGE_REACH + 1, 1, 2, 1, 0.3);
  m.ring(3, 1, 12, 4, 0.5);
  m.frame(p, high, 0, 1080);
  const cards = run(p).sort((a, b) => a.at[2]! - b.at[2]!);
  expect(cards.map((c) => [c.at[2], c.kind])).toEqual([[10, 0], [12, 255], [(5 * MIRAGE_REACH) / 6, 0]].map(([z, k]) => [Math.fround(z!), k]));
  expect([cards[0]!.strength, cards[2]!.strength > 0.4 && cards[2]!.strength < 0.6, cards[1]!.strength]).toEqual([1, true, Math.round(0.5 * 255) / 255]);
  // Its two half axes are square to each other and to the way to it, of the sizes asked: a ring's middle is at eight tenths of its card.
  const o = p.mirageFirst * DETAIL_FLOATS, d = p.details;
  for (let k = 0; k < p.mirageCount; k++) {
    const q = o + k * DETAIL_FLOATS, along = [d[q + 3]!, d[q + 4]!, d[q + 5]!], across = [d[q + 6]!, d[q + 7]!, d[q + 8]!], to = [d[q]!, d[q + 1]!, d[q + 2]!];
    const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect([Math.abs(dot(along, across)) < 1e-4, Math.abs(dot(along, to)) < 1e-3, Math.abs(dot(across, to)) < 1e-3]).toEqual([true, true, true]);
  }
  expect([cards[0]!.tall, cards[0]!.half, cards[1]!.half].map((v) => Math.round(v * 100) / 100)).toEqual([2, 1, 5]);
  // The frame's lane: drawn, the pixels a unit of shift is at this height, and a phase that comes round.
  expect([p.frame[MIRAGE_AT], p.frame[MIRAGE_AT + 1]]).toEqual([1, Math.fround(MIRAGE_PIXELS)]);
  m.frame(p, high, 1234, 2160);
  const phase = p.frame[MIRAGE_AT + 2]!;
  expect(p.frame[MIRAGE_AT + 1]).toBeCloseTo(2 * MIRAGE_PIXELS, 5);
  m.frame(p, high, 1234 + MIRAGE_TURN_MS, 2160);
  expect(p.frame[MIRAGE_AT + 2]).toBeCloseTo(phase, 5);
  // Past its most, the rest are left out.
  m.begin();
  for (let k = 0; k < MIRAGE_MOST + 9; k++) m.over(k, 2, 10, 1, 2, 1, 0.1);
  expect(m.count).toBe(MIRAGE_MOST);
});

test("with no room left in the packet the hot air is left out, and the packet names no card past its end", () => {
  const air = new Mirage(), p = new FramePacket();
  p.tier = high;
  air.begin();
  air.over(0, 1, 6, 1, 2, 1, 0.3);
  air.over(2, 1, 6, 1, 2, 1, 0.6);
  p.beginFrame();
  p.detailCount = MAX_DETAILS - 1;
  air.frame(p, high, 0, 1080);
  expect([p.detailCount, p.mirageCount, p.frame[MIRAGE_AT]]).toEqual([MAX_DETAILS - 1, 0, 0]);
  p.beginFrame();
  p.detailCount = MAX_DETAILS - 2;
  air.frame(p, high, 0, 1080);
  expect([p.detailCount, p.mirageFirst, p.mirageCount, p.frame[MIRAGE_AT]]).toEqual([MAX_DETAILS, MAX_DETAILS - 2, 2, 1]);
});

test("a tier whose finish does not read it holds none: no cards, no run, and its lane says so", () => {
  for (const tier of [medium, tierOf("lowpoly"), forTouch(high, true), tierWithout(high, effectsOff("mirage"))]) {
    const m = new Mirage(), p = new FramePacket();
    p.frame.fill(9, MIRAGE_AT, MIRAGE_AT + 4);
    m.begin();
    m.over(0, 2, 10, 1, 2, 1, 0.3);
    const before = p.detailCount;
    m.frame(p, tier, 0, 1080);
    expect([tier.name, p.mirageCount, p.detailCount - before, p.frame[MIRAGE_AT]]).toEqual([tier.name, 0, 0, 0]);
  }
  expect(TIERS.map((t) => [t.name, t.post?.mirage === true])).toEqual([["lowpoly", false], ["medium", false], ["high", true], ["ultra", true]]);
  // Switched off it adds none either.
  const m = new Mirage(), p = new FramePacket();
  m.on = false;
  m.begin();
  m.over(0, 2, 10, 1, 2, 1, 0.3);
  m.frame(p, high, 0, 1080);
  expect([m.count, p.mirageCount, p.frame[MIRAGE_AT]]).toEqual([0, 0, 0]);
});

test("the texts: a shift into the second attachment about a byte's half, the whole view for the body's clearing, and a finish that reads by it", () => {
  expect(MIRAGE_FRAGMENT).toContain("layout(location=1) out vec4 o;");
  expect(MIRAGE_FRAGMENT).toContain(`o = vec4(${MIRAGE_NONE}, ${MIRAGE_NONE}, 0.0, 0.0);`);
  expect(MIRAGE_VERTEX).toContain("gl_Position = uFrom < -0.5 ? vec4(c, 1.0, 1.0) :");
  // The finish reads the scene from where the hot air says, before its taps, and nothing from where there is none.
  expect(FINISH.indexOf("uv = wavered(uv, uExtent.xy - 0.5 * uPass.xy, uPass.xy);")).toBeGreaterThan(0);
  expect(FINISH.indexOf("uv = wavered(")).toBeLessThan(FINISH.indexOf("vec3 cn = scene("));
  expect(MIRAGE_GLSL).toContain("if (fMirage.x < 0.5) return uv;");
  expect(MIRAGE_GLSL).toContain("return mix(uv, to, smoothstep(0.0, 1.0e-4, dot(there, there)));");
  // Its program is a tier's where its finish reads it, with no sampler; the finish reads it on the shadows' unit.
  for (const tier of [...TIERS, forTouch(high, true)]) expect([tier.name, tierPrograms(tier).includes(PROGRAM.mirage!)]).toEqual([tier.name, tier.post?.mirage === true]);
  expect(PROGRAMS.mirage!(high, "rgba").samplers).toEqual({});
  expect(PROGRAMS.finish!(high, "rgba").samplers.uMirage).toBe(UNIT.shadow);
  expect(FRAME_FLOATS).toBe(MIRAGE_AT + 4);
});

const view = provingView(96, 64);

test("a fire near the eye wavers the air over it and a blast throws a ring, on high; neither on medium", () => {
  const { scene, cam, remote, hf, structs, reg } = view;
  const [x, z] = [236, 372];
  structs.add(reg.index.get(burningKind("core:jon_boat"))!, x, hf.heightAt(x, z) + 0.6, z, 0, 0, 1);
  remote.count = 0;
  scene.viewHeight = 720;
  [cam.x, cam.z] = [x, z - 7];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.yaw = 0;
  cam.pitch = 0.05;
  const frame = (tier: string, now: number): FramePacket => {
    scene.assets.tier = tierOf(tier);
    scene.now = now;
    remote.tick = (now * TICK_RATE) / 1000;
    return scene.build(cam, remote);
  };
  let p = frame("high", 1000);
  const hot = run(p);
  expect([hot.length >= 1, hot.every((c) => c.kind === 0 && c.strength > 0.2), p.frame[MIRAGE_AT]]).toEqual([true, true, 1]);
  // It stands over the hull, about 7 m ahead, and no draw of the frame names its cards.
  expect([Math.abs(hot[0]!.at[0]!) < 3, Math.abs(hot[0]!.at[2]! - 7) < 3, hot[0]!.at[1]! > 0]).toEqual([true, true, true]);
  expect(p.mirageFirst + p.mirageCount).toBeLessThanOrEqual(p.detailCount);
  for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_DETAILS) !== 0) expect(p.drawFirst[d]! + p.drawInstances[d]! <= p.mirageFirst || p.drawFirst[d]! >= p.mirageFirst + p.mirageCount).toBe(true);
  // A sky of clouds takes every card that is left: the hot air's are written before them, and the packet names none past its end.
  const clouds = (scene as unknown as { clouds: { write: (p: FramePacket, ...rest: unknown[]) => number } }).clouds, write = clouds.write;
  clouds.write = (to) => {
    to.detailCount = MAX_DETAILS;
    return 0;
  };
  p = frame("high", 1050);
  clouds.write = write;
  expect([p.detailCount, p.mirageCount > 0, p.mirageFirst + p.mirageCount <= MAX_DETAILS]).toEqual([MAX_DETAILS, true, true]);
  expect(frame("medium", 1100).mirageCount).toBe(0);
  // A blast: a ring that grows and weakens for a fifth of a second, and hot air over its fireball while it burns.
  scene.blasts.burst(2, x + 3, hf.heightAt(x + 3, z - 2), z - 2, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 99, 2000);
  const early = run(frame("high", 2030)).filter((c) => c.kind === 255), later = run(frame("high", 2120)).filter((c) => c.kind === 255);
  expect([early.length, later.length]).toEqual([1, 1]);
  expect([later[0]!.half > early[0]!.half, later[0]!.strength < early[0]!.strength]).toEqual([true, true]);
  p = frame("high", 2400);
  expect([run(p).filter((c) => c.kind === 255).length, run(p).length > hot.length]).toEqual([0, true]);
  p = frame("high", 9000);
  expect(run(p).length).toBe(hot.length);
});
