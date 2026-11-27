// Fire that stands (client/core/render/fires.ts): a wreck ablaze and a lit hearth burn where they stand, as flames on
// the fire program's cone and cards of smoke, embers and glow; more tongues the larger on the screen, a glow alone far
// off, the largest first up to the tier's count, nothing for what does not burn or is out of view, and nothing asked of
// a frame with none.

import { expect, test } from "bun:test";
import { tierOf, forTouch } from "../../client/core/assets/tiers.ts";
import { effectsOff, packetWithout } from "../../client/core/passes.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FIRE_BLAZE } from "../../client/core/render/fire-light.ts";
import { FIRE_REACH, Fires, GLOW_UNDER, TONGUE_AT } from "../../client/core/render/fires.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_SMOKE, DRAW_FIRE, FramePacket } from "../../client/core/render/packet.ts";
import { burningKind } from "../../content/docks.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { provingView } from "../../tools/snap.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), DIMS = { chunksX: 8, chunksZ: 8 };
const high = tierOf("high"), medium = tierOf("medium");
const store = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
const kindsOf = (p: FramePacket): number[] => Array.from({ length: p.detailCount }, (_, n) => (p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255);
const id = (name: string): number => reg.index.get(name)!;

/** A camera at (x, y, z) looking at (tx, ty, tz). */
function looking(x: number, y: number, z: number, tx: number, ty: number, tz: number): Camera {
  const cam = new Camera();
  [cam.x, cam.y, cam.z] = [x, y, z];
  cam.yaw = Math.atan2(tx - x, tz - z);
  cam.pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
  cam.update();
  return cam;
}

/** The fire's cards after one frame, written out. */
function cards(fires: Fires, s: StructureStore, cam: Camera, now: number, tier = high, viewHeight = 720): FramePacket {
  const p = new FramePacket();
  fires.build(p, cam, s, 8, 8, now, tier, viewHeight);
  fires.write(p);
  return p;
}

test("a burning wreck in view smokes, and one out of view, far off or not burning does not", () => {
  const fires = new Fires(reg), s = store();
  expect(fires.any).toBe(true);
  const burning = id(burningKind("core:needle")), plain = reg.ids.findIndex((n) => n.startsWith("core:zzzzhull_needle_") && !n.endsWith("_burning"));
  s.add(plain, 220, 1, 220, 0, 0, 1);
  const cam = looking(200, 3, 200, 220, 2, 220);
  expect(cards(fires, s, cam, 1000).detailCount).toBe(0);
  s.add(burning, 220, 1, 220, 0, 0, 1);
  const p = cards(fires, s, cam, 1000);
  const kinds = kindsOf(p);
  // Near, its smoke is black puffs; its flames are on the cone, held for the draw, not cards.
  expect(kinds.filter((k) => k === DETAIL_SMOKE).length).toBeGreaterThanOrEqual(5);
  expect(fires.fires).toBe(1);
  // Every card stands over the wreck, between its waterline and where its smoke ends.
  for (let n = 0; n < p.detailCount; n++) {
    const o = n * DETAIL_FLOATS, d = p.details;
    expect(Math.hypot(d[o]! - 20, d[o + 2]! - 20)).toBeLessThan(30);
    expect(d[o + 1]! + 3).toBeGreaterThan(0);
    expect(d[o + 1]! + 3).toBeLessThan(40);
  }
  // The smoke moves with the clock: another moment, other cards.
  const first = Array.from(p.details.subarray(0, p.detailCount * DETAIL_FLOATS));
  const later = cards(fires, s, cam, 1700);
  expect(Array.from(later.details.subarray(0, later.detailCount * DETAIL_FLOATS))).not.toEqual(first);
  // Turned away, it is not drawn; past its reach, neither.
  expect(cards(fires, s, looking(200, 3, 200, 180, 2, 180), 1000).detailCount).toBe(0);
  const far = store();
  far.add(burning, 20 + FIRE_REACH + 5, 1, 20, 0, 0, 1);
  expect(cards(fires, far, looking(20, 3, 20, 400, 2, 20), 1000).detailCount).toBe(0);
});

test("a lit campfire, torch, pot, hearth and forge burn; the same out, or a lit fabricator, do not", () => {
  for (const [name, lit] of [["campfire", true], ["standing_torch", true], ["cooking_pot", true], ["fireplace", true], ["forge", true], ["fabricator", false], ["preserving_bin", false]] as const) {
    for (const on of [false, true]) {
      const fires = new Fires(reg), s = store();
      s.add(id(on ? `core:${name}_lit` : `core:${name}`), 210, 1, 210, 0, 0, 1);
      cards(fires, s, looking(204, 2.5, 204, 210, 1.5, 210), 1000);
      expect([name, fires.fires]).toEqual([name, on && lit ? 1 : 0]);
    }
  }
});

test("a fire is a glow alone when it is a few pixels high, and only the largest on the screen burn, as many as the tier draws", () => {
  const fires = new Fires(reg), s = store();
  const campfire = id("core:campfire_lit");
  // A campfire's flame is under a metre: 200 m off on a screen 360 high it is a pixel or two.
  s.add(campfire, 300, 0, 100, 0, 0, 1);
  const cam = looking(100, 1, 100, 300, 0.5, 100);
  const p = cards(fires, s, cam, 500, high, 360);
  expect(kindsOf(p).filter((k) => k === DETAIL_GLOW).length).toBe(1);
  expect(((0.87 / 200) * 360) / (2 * Math.tan(cam.fovY / 2))).toBeLessThan(GLOW_UNDER);
  // Twenty hulls in a row ahead: the tier's most, the nearest of a kind being the largest.
  const many = store(), jon = id(burningKind("core:jon_boat"));
  for (let k = 0; k < 20; k++) many.add(jon, 110 + k * 8, 0, 100, 0, 0, 1);
  for (const tier of [medium, high, forTouch(high, true)]) {
    cards(fires, many, looking(100, 3, 100, 200, 1, 100), 500, tier);
    expect(fires.fires).toBe(tier.fires.most);
  }
});

test("a streamed replacement chunk shows its own fires", () => {
  const s = store(), f = new Fires(reg), cam = looking(4, 3, 4, 10, 1, 10);
  const burning = id(burningKind("core:jon_boat"));
  const plain = id("core:zzzzhull_jon_boat_229");
  const ref = s.add(burning, 10, 0, 10, 0, 0, 1);
  cards(f, s, cam, 100);
  expect(f.fires).toBe(1);
  s.detach(ref >>> 16);
  s.add(plain, 10, 0, 10, 0, 0, 1);
  cards(f, s, cam, 200);
  expect(f.fires).toBe(0);
});

const view = provingView(96, 64);

/** A frame of the proving ground with a lit campfire `far` metres ahead, on a tier, and the blazes its draws hold. */
function frame(tier: string, far: number, nowMs: number): { p: FramePacket; blazes: number[]; draws: number } {
  const { scene, cam, remote, hf, structs } = view;
  const [x, z] = [236, 372];
  if (!structs.chunks.some((t) => t && Array.from(t.kind.subarray(0, t.high)).includes(id("core:campfire_lit")))) structs.add(id("core:campfire_lit"), x, hf.heightAt(x, z) + 0.19, z, 0, 0, 1);
  remote.count = 0;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 720;
  [cam.x, cam.z] = [x, z - far];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.yaw = 0;
  cam.pitch = -0.15;
  scene.now = nowMs;
  const p = scene.build(cam, remote);
  const blazes: number[] = [];
  let draws = 0;
  for (let d = 0; d < p.drawCount; d++) {
    if ((p.drawFlags[d]! & DRAW_FIRE) === 0 || p.drawEffect[d * 4] !== FIRE_BLAZE) continue;
    draws++;
    for (let k = 0; k < p.drawInstances[d]!; k++) blazes.push((p.drawFirst[d]! + k) * INSTANCE_BYTES);
  }
  return { p, blazes, draws };
}

test("near, a flame is its bed and the tier's tongues in one draw of the cone; farther, fewer; and each comes in by degrees", () => {
  // At 3 m a campfire's flame is hundreds of pixels high: high and ultra draw four tongues, medium two, low poly one.
  for (const [tier, tongues] of [["lowpoly", 1], ["medium", 2], ["high", 4], ["ultra", 4]] as const) {
    const { blazes, draws } = frame(tier, 2.2, 1000);
    expect([tier, draws, blazes.length]).toEqual([tier, 1, 1 + tongues]);
  }
  // At 12 m it is some 37 pixels high, inside the band the first tongue comes in over: the bed whole, the tongue part shown.
  const px = ((0.87 / 12) * 720) / (2 * Math.tan(1.2217 / 2));
  expect([px > TONGUE_AT[0] * 0.75, px < TONGUE_AT[0] * 1.25]).toEqual([true, true]);
  const { p, blazes } = frame("high", 12, 1000);
  const powers = blazes.map((at) => p.transient[at + 18]!).sort((x, y) => y - x);
  expect([powers.length, powers[0], powers[1]! > 0 && powers[1]! < 255]).toEqual([2, 255, true]);
});

test("a page's fires switch takes out a standing fire's draws and leaves a blast's, and the bursts switch the reverse", () => {
  const { p } = frame("high", 3, 2000);
  const blazes = (q: FramePacket): number => [...Array(q.drawCount).keys()].filter((d) => (q.drawFlags[d]! & DRAW_FIRE) !== 0 && q.drawEffect[d * 4] === FIRE_BLAZE).reduce((n, d) => n + q.drawInstances[d]!, 0);
  const before = blazes(p);
  expect(before).toBeGreaterThan(0);
  packetWithout(p, effectsOff("bursts"));
  expect(blazes(p)).toBe(before);
  packetWithout(p, effectsOff("fires"));
  expect(blazes(p)).toBe(0);
});
