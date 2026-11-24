// What burns (client/core/render/blasts.ts): a blast's fire, smoke, dust and debris from its seed, held to its tier's
// particles and lobes; a rocket's flame, glow and smoke along its path; the view's shake; and what a page leaves out to
// price it. The small details draw as they did, their colour now weighed by how much of it shows.

import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIERS, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { Details } from "../../client/core/details/details.ts";
import { effectsOff, packetWithout, sceneWithout } from "../../client/core/passes.ts";
import { BURST_REACH, Blasts, LOBES_MID, LOBES_NEAR, MAX_BURSTS, MAX_TRAILS, MAX_TRAIL_CARDS, TRAIL_CARDS, TRAIL_SECONDS } from "../../client/core/render/blasts.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT } from "../../client/core/render/detailtext.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_SMOKE, DRAW_BLEND, DRAW_DETAILS, DRAW_FIRE, FramePacket } from "../../client/core/render/packet.ts";
import { SETTING_ROWS, Settings } from "../../client/core/settings.ts";
import { SHAKE_LAUNCH, SHAKE_MOST, SHAKE_MS, Shake, blastShake } from "../../client/core/view/shake.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BURST_LOOKS } from "../../shared/content/kinds/weapons.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SURFACE_AIR, SURFACE_BODY, SURFACE_BUILT, SURFACE_GROUND, SURFACE_VEHICLE, SURFACE_WATER, blastSeed } from "../../shared/net/rockets.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { effectOf } from "../../shared/pack/details.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { provingView } from "../../tools/snap.ts";
import { corePack } from "../fixtures/pack.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const pack = corePack();
const hf = buildProvingHeightfield();
/** Open grass beyond the plaza, and a place 12 m from it to stand. */
const [X, Z] = [236, 372];
const ROCKET = BURST_LOOKS.indexOf("rocket");
const SURFACES = [SURFACE_AIR, SURFACE_GROUND, SURFACE_BUILT, SURFACE_WATER, SURFACE_BODY, SURFACE_VEHICLE];

/** The details and the blasts alone, with no scene: an eye `far` metres from (X, Z) on a tier, a frame in so both know it. */
function alone(tier: Tier, far = 12): { details: Details; blasts: Blasts; p: FramePacket; cam: Camera; y: number } {
  const details = new Details(reg, pack.header.details, pack.palette, () => null);
  const blasts = new Blasts(reg, null, null, details);
  const p = new FramePacket();
  p.tier = tier;
  const cam = new Camera();
  [cam.x, cam.y, cam.z] = [X, hf.heightAt(X, Z - far) + 1.7, Z - far];
  cam.update();
  p.beginFrame();
  details.frame(p, cam, null, [], [], null, hf, tier, 0);
  blasts.draw(p, cam, 0);
  return { details, blasts, p, cam, y: hf.heightAt(X, Z) };
}

/** What the details hold after a blast, as numbers: each particle's effect, place, way, size and colour. */
function held(details: Details): number[] {
  const pool = details.pool, out: number[] = [];
  for (let i = 0; i < pool.count; i++) out.push(pool.effect[i]!, pool.x[i]!, pool.y[i]!, pool.z[i]!, pool.vx[i]!, pool.vy[i]!, pool.vz[i]!, pool.size[i]!, pool.end[i]!, pool.colourA[i]!, pool.colourB[i]!);
  return out;
}

test("the same seed gives the same blast on every client, and another seed another", () => {
  const medium = tierOf("medium");
  const particles = (seed: number, surface = SURFACE_GROUND): number[] => {
    const a = alone(medium);
    a.blasts.burst(ROCKET, X, a.y, Z, 0, 1, 0, 7.5, surface, 0, seed, 0);
    return held(a.details);
  };
  const seed = blastSeed(7, X, hf.heightAt(X, Z), Z);
  const first = particles(seed);
  expect(first.length).toBeGreaterThan(20 * 11);
  expect(particles(seed)).toEqual(first);
  expect(particles(blastSeed(8, X, hf.heightAt(X, Z), Z))).not.toEqual(first);
  // What was hit changes it: no dust off the ground in the air, and none on water.
  const dust = pack.header.details!.effects.findIndex((e) => e.id === "core:details/blast_dust");
  const count = (list: number[], effect: number): number => list.filter((v, k) => k % 11 === 0 && v === effect).length;
  expect([count(first, dust) > 2, count(particles(seed, SURFACE_AIR), dust), count(particles(seed, SURFACE_WATER), dust)]).toEqual([true, 0, 0]);

  // And the fire: two blasts of one seed are drawn as the same lobes, a third of another seed as others.
  const view = provingView(96, 64);
  const { scene, cam, remote } = view;
  remote.count = 0;
  scene.assets.tier = medium;
  [cam.x, cam.z] = [X, Z - 14];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.pitch = 0.1;
  scene.now = 1000;
  scene.build(cam, remote);
  for (const s of [seed, seed, seed + 1]) scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, s, 1000);
  scene.now = 1200;
  const p = scene.build(cam, remote);
  const lobes: number[][] = [];
  for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_FIRE) !== 0) lobes.push([...p.transient.subarray(p.drawFirst[d]! * INSTANCE_BYTES, (p.drawFirst[d]! + p.drawInstances[d]!) * INSTANCE_BYTES)]);
  expect(lobes.length).toBe(3);
  expect(lobes[1]).toEqual(lobes[0]!);
  expect(lobes[2]).not.toEqual(lobes[0]!);
});

test("a blast never makes more particles than its tier gives one, whatever it hit and whatever blew", () => {
  for (const tier of TIERS) {
    let most = 0;
    for (const surface of SURFACES) for (let look = 0; look < BURST_LOOKS.length; look++) for (let k = 0; k < 6; k++) {
      // Close by, so nothing is thinned for distance, on a screen with room.
      const a = alone({ ...tier, details: { ...tier.details, share: 1, fill: 1e9 } }, 6);
      a.blasts.burst(look, X, a.y, Z, 0, 1, 0, 7.5, surface, k % 5, blastSeed(k + 1, X + look, surface, Z), 0);
      most = Math.max(most, a.details.pool.count);
      expect(a.details.pool.count).toBeLessThanOrEqual(tier.bursts.particles);
    }
    // And a rocket on the ground comes near it: the budget is spent, not left.
    expect(most).toBeGreaterThan(tier.bursts.particles * 0.6);
  }
  // The tier's own share and the screen's fill thin it further: low poly's half, and a full screen leaves a few of each part.
  const low = alone(tierOf("lowpoly"), 6);
  low.blasts.burst(ROCKET, X, low.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 5, 0);
  expect(low.details.pool.count).toBeLessThanOrEqual(20);
  const full = alone({ ...tierOf("medium"), details: { ...tierOf("medium").details, fill: 0 } }, 6);
  full.blasts.burst(ROCKET, X, full.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 5, 0);
  expect([full.details.pool.count > 0, full.details.pool.count < 30, full.details.thinned > 10]).toEqual([true, true, true]);
  // Smoke is never whole: no part of a blast that hides what is behind it shows more than four fifths.
  for (const e of pack.header.details!.effects) if (/\/(blast_|backblast|scorch)/.test(e.id) && e.pass === "blend" && e.glow === 0) expect(e.opacity).toBeLessThanOrEqual(0.8);
});

test("a blast's dust reaches its true radius, its scorch lies half a minute, and a far one is not made", () => {
  const a = alone(tierOf("medium"), 14);
  const { details, p, cam } = a;
  a.blasts.burst(ROCKET, X, a.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 11, 0);
  const effects = pack.header.details!.effects;
  const dust = effects.findIndex((e) => e.id === "core:details/blast_dust"), scorch = effects.findIndex((e) => e.id === "core:details/scorch");
  const pool = details.pool;
  const alive = (effect: number): number => {
    let n = 0;
    for (let i = 0; i < pool.count; i++) if (pool.effect[i] === effect) n++;
    return n;
  };
  expect([alive(dust) > 2, alive(scorch)]).toEqual([true, 1]);
  let far = 0;
  const step = (toSeconds: number, from: number): void => {
    for (let t = from; t < toSeconds; t += 1 / 20) {
      p.beginFrame();
      details.frame(p, cam, null, [], [], null, hf, p.tier, t * 1000);
      for (let i = 0; i < pool.count; i++) if (pool.effect[i] === dust) far = Math.max(far, Math.hypot(pool.x[i]! - X, pool.z[i]! - Z));
    }
  };
  step(1.2, 0);
  // The ring ends where the blast's reach does: its danger is seen.
  expect([far > 6.2, far < 8.8]).toEqual([true, true]);
  step(20, 1.2);
  expect([alive(scorch), alive(dust)]).toEqual([1, 0]);
  step(40, 20);
  expect(pool.count).toBe(0);
  // Past every part's reach nothing is made.
  const off = alone(tierOf("medium"), 450);
  off.blasts.burst(ROCKET, X, off.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 11, 0);
  expect(off.details.pool.count).toBe(0);
});

const view = provingView(96, 64);

/** A frame of the proving ground from `far` metres short of (X, Z) at `nowMs`, on a tier. */
function frame(tier: string, far: number, nowMs: number): FramePacket {
  const { scene, cam, remote } = view;
  remote.count = 0;
  remote.tick = (nowMs * TICK_RATE) / 1000;
  scene.assets.tier = tierOf(tier);
  [cam.x, cam.z] = [X, Z - far];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.yaw = 0;
  cam.pitch = 0.05;
  scene.now = nowMs;
  return scene.build(cam, remote);
}

const fires = (p: FramePacket): number[] => [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_FIRE) !== 0);
let clock = 100000;

test("a blast is three lobes near, two farther, one far off and one glow beyond, one lobe on low poly, in one draw", () => {
  const { scene } = view;
  const lobes = (tier: string, far: number): { draws: number; lobes: number; cards: number } => {
    clock += 60000;
    frame(tier, far, clock);
    // A seed whose blast has three lobes.
    let seed = 1;
    for (; seed < 50; seed++) {
      const a = alone(tierOf("medium"));
      a.blasts.burst(ROCKET, X, a.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, seed, 0);
      if ((a.blasts as unknown as { bLobes: Uint8Array }).bLobes[0] === 3) break;
    }
    scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, seed, clock);
    const p = frame(tier, far, clock + 250);
    const f = fires(p);
    expect(f.every((d) => (p.drawFlags[d]! & DRAW_BLEND) !== 0)).toBe(true);
    return { draws: f.length, lobes: f.reduce((n, d) => n + p.drawInstances[d]!, 0), cards: scene.blasts.count };
  };
  expect(lobes("medium", 20)).toEqual({ draws: 1, lobes: 3, cards: 0 });
  expect(lobes("medium", (LOBES_NEAR + LOBES_MID) / 2)).toEqual({ draws: 1, lobes: 2, cards: 0 });
  expect(lobes("medium", LOBES_MID + 30)).toEqual({ draws: 1, lobes: 1, cards: 0 });
  // Past its reach its fire is one card of light among the details, and no draw of its own.
  expect(lobes("medium", BURST_REACH + 30)).toEqual({ draws: 0, lobes: 0, cards: 1 });
  expect(lobes("lowpoly", 20)).toEqual({ draws: 1, lobes: 1, cards: 0 });
  expect(lobes("ultra", 20)).toEqual({ draws: 1, lobes: 3, cards: 0 });
});

test("nothing of a blast's fire is drawn past its life, and the eye inside a lobe is not shown a screen of it", () => {
  const { scene } = view;
  clock += 60000;
  frame("medium", 20, clock);
  scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 3, clock);
  expect(fires(frame("medium", 20, clock + 100)).length).toBe(1);
  expect(scene.blasts.alight).toBe(1);
  // In the middle of it the lobe the eye is in is not drawn, and what is left covers less of the screen than its share of it would.
  frame("medium", 20, clock + 200);
  const whole = scene.blasts.lobes;
  frame("medium", 0.5, clock + 200);
  expect([scene.blasts.lobes < whole, scene.blasts.fill < 1]).toEqual([true, true]);
  expect(fires(frame("medium", 20, clock + 1900)).length).toBe(0);
  expect(scene.blasts.alight).toBe(0);
  // The fire's fill is in the ledger the details thin by, while it burns.
  clock += 60000;
  frame("medium", 12, clock);
  const before = frame("medium", 12, clock + 16).detailFill;
  scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_AIR, 0, 3, clock + 16);
  const p = frame("medium", 12, clock + 300);
  expect([scene.blasts.fill > 0.05, p.detailFill > before + scene.blasts.fill * 0.99, scene.details.fill >= scene.blasts.fill]).toEqual([true, true, true]);
  // More blasts than there are rows take the oldest's.
  for (let k = 0; k < MAX_BURSTS + 5; k++) scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_AIR, 0, k, clock + 300);
  expect(scene.blasts.alight).toBe(MAX_BURSTS);
});

test("a rocket is a flame, a glow and smoke along its path: no more than its cards, fewer seen down the path, thinning away after it ends", () => {
  const { scene, cam } = view;
  clock += 60000;
  const y = hf.heightAt(X, Z) + 2;
  // Fired across the view, 20 m ahead; the eye is told where its tail is each frame, as the shots tell it.
  const fly = (key: number, dx: number, dz: number, from: number): void => scene.blasts.fly(key, X - 20 * dx, y, Z - 20 * dz, 60 * dx, 0, 60 * dz, 2, 0.9, from);
  const tail = (key: number, dx: number, dz: number, from: number, now: number): void => {
    const t = (now - from) / 1000;
    scene.blasts.at(key, X - 20 * dx + 60 * dx * t, y - t * t, Z - 20 * dz + 60 * dz * t, dx, 0, dz);
  };
  frame("medium", 30, clock);
  fly(1, 1, 0, clock);
  let most = 0;
  for (let ms = 16; ms <= 600; ms += 16) {
    tail(1, 1, 0, clock, clock + ms);
    const p = frame("medium", 30, clock + ms);
    most = Math.max(most, scene.blasts.count);
    // One flame, in one draw.
    if (ms < 400) expect([scene.blasts.flames, fires(p).length]).toEqual([1, 1]);
    expect(scene.blasts.count).toBeLessThanOrEqual(TRAIL_CARDS + 2);
  }
  expect(most).toBeGreaterThan(8);
  // Its cards are among the details: smoke lit as a puff, and light with no surface.
  const p = view.scene.packet;
  const flags = new Set<number>();
  for (let n = p.burstFirst; n < p.burstFirst + p.burstCount; n++) flags.add((p.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255);
  expect([p.burstCount, flags.has(DETAIL_SMOKE)]).toEqual([scene.blasts.count, true]);
  const side = scene.blasts.count;
  // It ends: no flame, and its smoke thins away within its seconds, and the row is free.
  scene.blasts.end(1, clock + 600);
  frame("medium", 30, clock + 700);
  expect([scene.blasts.flames, scene.blasts.count > 0, scene.blasts.count < side + 1, scene.blasts.trails]).toEqual([0, true, true, 1]);
  frame("medium", 30, clock + 600 + TRAIL_SECONDS * 1000 + 50);
  expect([scene.blasts.count, scene.blasts.trails]).toEqual([0, 0]);

  // The one who fired sees down the path: fewer puffs than from the side at the same age.
  clock += 60000;
  frame("medium", 21, clock);
  fly(2, 0, 1, clock);
  for (let ms = 16; ms <= 600; ms += 16) {
    tail(2, 0, 1, clock, clock + ms);
    frame("medium", 21, clock + ms);
  }
  expect([scene.blasts.count > 2, scene.blasts.count < side * 0.7]).toEqual([true, true]);
  // A glow of light with no surface keeps it seen far off.
  const q = view.scene.packet;
  let glows = 0;
  for (let n = q.burstFirst; n < q.burstFirst + q.burstCount; n++) if (((q.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW) glows++;
  expect(glows).toBeGreaterThan(0);
  scene.blasts.end(2, clock + 600);

  // Every row flying at once: the smoke of all of them is held to its cards, and one round too many takes a row.
  clock += 60000;
  frame("medium", 60, clock);
  for (let k = 0; k < MAX_TRAILS + 3; k++) scene.blasts.fly(100 + k, X - 40 + (k % 8), y + (k >> 3), Z - 30, 6, 0, 60, 2, 0.9, clock);
  expect(scene.blasts.trails).toBe(MAX_TRAILS);
  for (let ms = 100; ms <= 900; ms += 100) {
    frame("medium", 60, clock + ms);
    let smoke = 0;
    const r = view.scene.packet;
    for (let n = r.burstFirst; n < r.burstFirst + r.burstCount; n++) if (((r.detailWords[n * DETAIL_FLOATS + DETAIL.misc]! >>> 8) & 255) === DETAIL_SMOKE) smoke++;
    expect(smoke).toBeLessThanOrEqual(MAX_TRAIL_CARDS);
  }
  for (let k = 0; k < MAX_TRAILS + 3; k++) scene.blasts.end(100 + k, clock + 900);
  frame("medium", 60, clock + 900 + TRAIL_SECONDS * 1000 + 50);
  void cam;
});

test("what burns makes no objects in the steady state: twelve rockets and eight blasts a second, three hundred frames", () => {
  const { scene, cam } = view;
  clock += 60000;
  const p = frame("medium", 40, clock);
  const [draws, transient, details] = [p.drawCount, p.transientCount, p.detailCount];
  const y = hf.heightAt(X, Z) + 2;
  const born = new Float64Array(12);
  const turn = (f: number): void => {
    const now = clock + f * (1000 / 60);
    for (let k = 0; k < 12; k++) {
      // Each flies 2.5 s and ends, and another leaves in its place.
      if (f === 0 || now - born[k]! > 2500) {
        if (f > 0) scene.blasts.end(k, now);
        born[k] = now;
        scene.blasts.fly(k, X - 30 + k * 5, y, Z - 20, 3, 1, 60, 2, 0.9, now);
      }
      const t = (now - born[k]!) / 1000;
      scene.blasts.at(k, X - 30 + k * 5 + 3 * t, y + t - t * t, Z - 20 + 60 * t, 0.05, 0.016, 0.998);
    }
    if (f % 8 === 0) scene.blasts.burst(ROCKET, X + ((f * 7) % 40) - 20, hf.heightAt(X, Z), Z + ((f * 3) % 30), 0, 1, 0, 7.5, SURFACES[(f >> 3) % 6]!, f % 5, f * 2654435761, now);
    // The frame's own rows are kept, and the blasts' put after them again.
    p.drawCount = draws;
    p.transientCount = transient;
    p.detailCount = details;
    scene.blasts.cards(cam, now);
    scene.blasts.write(p);
    scene.blasts.draw(p, cam, now);
  };
  for (let f = 0; f < 600; f++) turn(f);
  Bun.gc(true);
  const before = heapStats().objectCount;
  let [flames, alight, cards] = [0, 0, 0];
  for (let f = 600; f < 900; f++) {
    turn(f);
    flames = Math.max(flames, scene.blasts.flames);
    alight = Math.max(alight, scene.blasts.alight);
    cards = Math.max(cards, scene.blasts.count);
  }
  Bun.gc(true);
  // A handful is the engine's own noise; a frame's worth of anything would be hundreds.
  expect(heapStats().objectCount - before).toBeLessThan(40);
  expect([flames > 6, alight > 4, cards > 50]).toEqual([true, true, true]);
  for (let k = 0; k < 12; k++) scene.blasts.end(k, clock + 20000);
});

test("a page prices what burns by leaving it out: no fire, no smoke of a rocket, and none of what a blast threw up", () => {
  const { scene } = view;
  expect(effectsOff("bursts,haze").has("bursts")).toBe(true);
  clock += 60000;
  frame("medium", 16, clock);
  scene.blasts.burst(ROCKET, X, hf.heightAt(X, Z), Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 9, clock);
  scene.blasts.fly(5, X - 5, hf.heightAt(X, Z) + 2, Z - 2, 60, 0, 0, 2, 0.9, clock);
  scene.blasts.at(5, X + 13, hf.heightAt(X, Z) + 2, Z - 2, 1, 0, 0);
  const p = frame("medium", 16, clock + 300);
  const sized = (): number => {
    let n = 0;
    for (let k = 0; k < p.detailOwn; k++) if (Math.hypot(p.details[k * DETAIL_FLOATS + DETAIL.along]!, p.details[k * DETAIL_FLOATS + DETAIL.along + 1]!, p.details[k * DETAIL_FLOATS + DETAIL.along + 2]!) > 0) n++;
    return n;
  };
  const drawn = (): number => [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & (DRAW_FIRE | DRAW_DETAILS)) !== 0).reduce((n, d) => n + p.drawInstances[d]!, 0);
  const [particles, instances] = [sized(), drawn()];
  // The blast's lobes and the rocket's flame are a draw each.
  expect([particles > 30, fires(p).length, p.burstCount > 3]).toEqual([true, 2, true]);
  packetWithout(p, effectsOff("haze"));
  expect([sized(), drawn()]).toEqual([particles, instances]);
  packetWithout(p, effectsOff("bursts"));
  expect([sized(), fires(p).every((d) => p.drawInstances[d] === 0), drawn() <= instances - p.burstCount - 2]).toEqual([0, true, true]);
  // Off for a whole run, the scene makes none of it; the blast still stands in its rows, to be drawn when it is on again.
  sceneWithout(scene, effectsOff("bursts"));
  const off = frame("medium", 16, clock + 400);
  expect([scene.bursts, fires(off).length, scene.blasts.count, off.detailOwn]).toEqual([false, 0, 0, 0]);
  sceneWithout(scene, effectsOff(""));
  expect([scene.bursts, fires(frame("medium", 16, clock + 500)).length > 0]).toEqual([true, true]);
  scene.blasts.end(5, clock + 500);
});

test("a blast shakes a view near it, harder the nearer and the larger; the viewer's own launch shakes a little; it rings down, and a setting holds it still", () => {
  expect([blastShake(0, 7.5), blastShake(7.5 * 6, 7.5), blastShake(100, 7.5), blastShake(NaN, 7.5)]).toEqual([1, 0, 0, 0]);
  expect(blastShake(10, 7.5)).toBeGreaterThan(blastShake(20, 7.5));
  expect(blastShake(10, 7.5)).toBeGreaterThan(blastShake(10, 4));
  const shake = new Shake();
  const out = new Float64Array(2);
  expect(shake.ringing(0)).toBe(false);
  shake.add(1, 1000);
  let most = 0;
  for (let ms = 1000; ms < 1000 + SHAKE_MS; ms += 5) {
    shake.turn(ms, SHAKE_MOST, out);
    most = Math.max(most, Math.abs(out[0]!), Math.abs(out[1]!));
    expect(Math.abs(out[0]!)).toBeLessThanOrEqual(SHAKE_MOST);
  }
  expect([most > 0.5 * SHAKE_MOST, shake.ringing(1000 + SHAKE_MS - 1), shake.ringing(1000 + SHAKE_MS)]).toEqual([true, true, false]);
  shake.turn(1000 + SHAKE_MS, SHAKE_MOST, out);
  expect([...out]).toEqual([0, 0]);
  // Several at once sum, and stay within the most.
  for (let k = 0; k < 9; k++) shake.add(1, 5000 + k);
  for (let ms = 5000; ms < 5600; ms += 7) {
    shake.turn(ms, SHAKE_MOST, out);
    expect(Math.max(Math.abs(out[0]!), Math.abs(out[1]!))).toBeLessThanOrEqual(SHAKE_MOST);
  }
  // The blasts tell it: a blast by the eye, and the viewer's own launch alone.
  const a = alone(tierOf("medium"), 10);
  a.blasts.burst(ROCKET, X, a.y, Z, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 1, 2000);
  expect(a.blasts.shake.ringing(2010)).toBe(true);
  const b = alone(tierOf("medium"), 10);
  b.blasts.launch(X, 2, Z, X, 2, Z - 1, 0, 0, 1, 1, false, 2000);
  expect(b.blasts.shake.ringing(2010)).toBe(false);
  b.blasts.launch(X, 2, Z, X, 2, Z - 1, 0, 0, 1, 1, true, 2000);
  expect([b.blasts.shake.ringing(2010), SHAKE_LAUNCH < 0.5]).toEqual([true, true]);
  // A launcher's own particles: a flash at the muzzle, gas from the vent, dust off the ground behind.
  const made = held(b.details).filter((_, k) => k % 11 === 0).map((e) => pack.header.details!.effects[e]!.id.split("/")[1]);
  expect([made.includes("launch_flash"), made.includes("backblast"), made.includes("backblast_dust")]).toEqual([true, true, true]);
  const settings = new Settings();
  const row = SETTING_ROWS.find((r) => r.label === "View shake")!;
  expect([settings.viewShake, row.value(settings)]).toEqual([true, "on"]);
  row.step(settings, 1);
  expect([settings.viewShake, row.value(settings), JSON.parse(settings.interfacePreferences()).viewShake]).toEqual([false, "off", false]);
});

test("an effect may glow, be thick, be a streak, and show less than whole; the details give colour weighed by how much shows, and blend it so", () => {
  const of = (raw: Record<string, unknown>) => effectOf("t/e", { pictures: ["p"], ...raw }, () => 0);
  expect([of({}).glow, of({}).opacity, of({}).thick, of({ glow: 3, face: "streak", opacity: 0.5 }).face]).toEqual([0, 1, false, "streak"]);
  for (const bad of [{ glow: -1 }, { glow: 16 }, { glow: 2, pass: "cutout" }, { opacity: 0 }, { opacity: 1.2 }, { thick: true, face: "flat" }, { thick: 1 }, { face: "sideways" }]) expect(() => of(bad)).toThrow();
  // Every colour a see-through draw gives goes through `weighed`, or is light alone (alpha 0), or black.
  for (const text of [DETAIL_FLAT_FRAGMENT, DETAIL_LIT_FRAGMENT]) {
    const gives = text.split("\n").filter((line) => /^\s*o = /.test(line));
    expect(gives.length).toBeGreaterThanOrEqual(3);
    for (const line of gives) expect(/o = weighed\(|, 0\.0\);$|o = vec4\(0\.0,0\.0,0\.0,/.test(line), line).toBe(true);
    expect(text.includes("return vec4(uBlend > 0.5 ? c * a : c, a);")).toBe(true);
  }
  // Blended so, a colour that was drawn straight comes out as it did: weighed and added is the same sum.
  for (const [dst, c, a] of [[0.2, 0.9, 0.35], [0.8, 0.1, 1], [0.5, 0.5, 0], [1, 0.3, 0.004]] as const) expect(c * a + dst * (1 - a)).toBeCloseTo(dst + (c - dst) * a, 12);
  // The shell asks for that blend for a see-through draw of details and for fire, and for no other draw.
  const shell = readFileSync(join(import.meta.dir, "../../client/shell/gl.ts"), "utf8");
  expect(shell.includes("this.set(blend, false, !blend, false, blend);")).toBe(true);
  expect(shell.includes("(this.weighed = weighed) ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE")).toBe(true);
  expect(shell.includes("(flags & DRAW_CUTOUT) !== 0, false, fire);")).toBe(true);
});
