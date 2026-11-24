// Rows for what burns (client/core/render/blasts.ts): twelve rockets in the air and eight blasts a second among 2,048
// survivors on medium, as a client sees a rocket fight. What is timed is the blasts' own work a frame (told of rounds
// and blasts, their cards, their draws) and what their particles add to the details' frame over the same crowd with
// nothing burning. `bun tools/bench/bursts.ts` runs these alone, on the proving ground.

import { heapStats } from "bun:jsc";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import { DRAW_FIRE } from "../../client/core/render/packet.ts";
import type { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { BURST_LOOKS } from "../../shared/content/kinds/weapons.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { blastSeed } from "../../shared/net/rockets.ts";
import { Rng } from "../../shared/rng.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const ROCKETS = 12;
const BLASTS_A_SECOND = 8;
const BODIES = 2048;
/** Frames warmed and then measured, sixty a second. */
const FRAMES = 600;
/** What the blasts and the details they add may take of a frame: the mean, and the worst frame. */
const MEAN_MS = 0.3;
const WORST_MS = 1;

const mean = (a: number[]): number => a.reduce((n, v) => n + v, 0) / Math.max(1, a.length);

/** Calls of `names` on `owner` add their time to `into.ms` until the returned function is called. */
function timed(owner: object, names: readonly string[], into: { ms: number }): () => void {
  const o = owner as Record<string, (...a: unknown[]) => unknown>;
  const real = names.map((name) => o[name]!);
  names.forEach((name, k) => {
    o[name] = function (this: unknown, ...a: unknown[]): unknown {
      const t = performance.now();
      const out = real[k]!.apply(this, a);
      into.ms += performance.now() - t;
      return out;
    };
  });
  return () => names.forEach((name, k) => void (o[name] = real[k]!));
}

export function benchBursts(section: Section, record: Row, scene: Scene, cam: Camera, hf: Heightfield): void {
  section(`What burns (headless, medium): ${ROCKETS} rockets flying and ${BLASTS_A_SECOND} blasts a second among ${BODIES} survivors`);
  const kept = scene.assets.tier;
  const tier = (scene.assets.tier = tierOf("medium"));
  const survivor = scene.blasts.reg.index.get("core:survivor")!;
  const crowd = new RemoteSample();
  const put = new Rng(606);
  for (let i = 0; i < BODIES; i++) {
    crowd.id[i] = i + 1;
    crowd.kind[i] = survivor;
    crowd.x[i] = cam.x + put.range(-150, 150);
    crowd.z[i] = cam.z + put.range(-150, 150);
    crowd.y[i] = hf.heightAt(crowd.x[i]!, crowd.z[i]!);
  }
  crowd.count = BODIES;
  const blasts = scene.blasts, details = scene.details;
  const rocket = BURST_LOOKS.indexOf("rocket");
  const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
  /** A place `ahead` metres along the view and `side` across it. */
  const place = (ahead: number, side: number): [number, number] => [cam.x + sin * ahead + cos * side, cam.z + cos * ahead - sin * side];
  const born = new Float64Array(ROCKETS).fill(-Infinity);
  const from = new Float64Array(ROCKETS * 3);
  const way = new Float64Array(ROCKETS * 3);
  const aim = new Rng(707);
  let started = 0;

  /** One frame at `now`: the rounds told of, a blast when one is due, and the frame built or, with `alone`, the blasts' part of it alone. */
  const turn = (f: number, now: number, burning: boolean, alone: boolean): void => {
    crowd.tick = (now * TICK_RATE) / 1000;
    for (let k = 0; burning && k < ROCKETS; k++) {
      // Each flies two seconds across the view and goes off, and another leaves at once: its launcher flashes and blows back.
      if (now - born[k]! > 2000) {
        const o = k * 3;
        if (born[k]! > -Infinity) {
          const t = (now - born[k]!) / 1000;
          blasts.end(k, now);
          const [x, z] = [from[o]! + way[o]! * t, from[o + 2]! + way[o + 2]! * t];
          blasts.burst(rocket, x, hf.heightAt(x, z), z, 0, 1, 0, 7.5, 1 + (started % 5), started % 5, blastSeed(k + 1, x, 0, z), now);
        }
        // From among the crowd ahead, each its own way.
        const [x, z] = place(aim.range(6, 60), aim.range(-30, 30));
        const yaw = aim.range(0, 2 * Math.PI);
        from[o] = x;
        from[o + 1] = hf.heightAt(x, z) + 1.6;
        from[o + 2] = z;
        way[o] = Math.sin(yaw) * 60;
        way[o + 1] = 1.5;
        way[o + 2] = Math.cos(yaw) * 60;
        // Staggered over their two seconds, so they do not all end in one frame.
        born[k] = started < ROCKETS ? now - (k * 2000) / ROCKETS : now;
        started++;
        blasts.launch(x, from[o + 1]!, z, x - way[o]! / 60, from[o + 1]!, z - way[o + 2]! / 60, way[o]! / 60, way[o + 1]! / 60, way[o + 2]! / 60, blastSeed(0, x, 0, z), k === 0, now);
        blasts.fly(k, x, from[o + 1]!, z, way[o]!, way[o + 1]!, way[o + 2]!, 2, 0.9, born[k]!);
      }
      const o = k * 3, t = (now - born[k]!) / 1000;
      blasts.at(k, from[o]! + way[o]! * t, from[o + 1]! + way[o + 1]! * t - t * t, from[o + 2]! + way[o + 2]! * t, way[o]! / 60, way[o + 1]! / 60, way[o + 2]! / 60);
    }
    // The rockets' own blasts are six a second; the rest are grenades among the crowd, to eight.
    if (burning && f % 60 === 0) {
      const [x, z] = place(aim.range(8, 60), aim.range(-25, 25));
      blasts.burst(BURST_LOOKS.indexOf("grenade"), x, hf.heightAt(x, z), z, 0, 1, 0, 5, 1, 0, blastSeed(0, x, 0, z), now);
      const [u, w] = place(aim.range(8, 60), aim.range(-25, 25));
      blasts.burst(rocket, u, hf.heightAt(u, w), w, 0, 1, 0, 7.5, 1, 0, blastSeed(0, u, 0, w), now);
    }
    if (!alone) {
      scene.now = now;
      scene.build(cam, crowd);
      return;
    }
    const p = scene.packet;
    p.drawCount = rows[0]!;
    p.transientCount = rows[1]!;
    p.detailCount = rows[2]!;
    blasts.cards(cam, now);
    blasts.write(p);
    blasts.draw(p, cam, now);
  };
  const rows = [0, 0, 0];

  // The crowd alone first, and then with everything burning: what the details' frame takes in each.
  const run = (burning: boolean): { own: number[]; details: number[]; alive: number; fill: number; fire: number; dust: number; draws: number; fires: number; cards: number; thinned: number } => {
    const own = { ms: 0 }, theirs = { ms: 0 };
    const undo = [timed(blasts, ["fly", "at", "end", "launch", "burst", "cards", "write", "draw"], own), timed(details, ["frame"], theirs)];
    const out = { own: [] as number[], details: [] as number[], alive: 0, fill: 0, fire: 0, dust: 0, draws: 0, fires: 0, cards: 0, thinned: 0 };
    const t0 = scene.now + 60000;
    const thinned = details.thinned;
    for (let f = 0; f < FRAMES * 2; f++) {
      own.ms = theirs.ms = 0;
      turn(f, t0 + f * (1000 / 60), burning, false);
      if (f < FRAMES) continue;
      out.own.push(own.ms);
      // The cards are written inside the details' frame's row of the scene, not inside its own frame: `theirs` is the details alone.
      out.details.push(theirs.ms);
      const p = scene.packet;
      out.alive = Math.max(out.alive, details.pool.count);
      out.fill = Math.max(out.fill, p.detailFill);
      out.fire = Math.max(out.fire, blasts.fill);
      out.dust = Math.max(out.dust, p.detailFill - blasts.fill);
      out.draws = Math.max(out.draws, blasts.draws);
      let fires = 0;
      for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_FIRE) !== 0) fires++;
      out.fires = Math.max(out.fires, fires);
      out.cards = Math.max(out.cards, blasts.count);
    }
    out.thinned = details.thinned - thinned;
    for (const u of undo) u();
    return out;
  };
  // Once unrecorded, so the rows are of code already compiled.
  run(true);
  // Let what that left burn out and settle.
  for (let f = 0; f < 60 * 34; f += 6) turn(f, scene.now + 100, false, false);
  const calm = run(false);
  born.fill(-Infinity);
  started = 0;
  const fight = run(true);
  const base = mean(calm.details);
  const added = fight.own.map((ms, i) => ms + fight.details[i]! - base);
  record("the blasts' own work a frame, mean", mean(fight.own), "ms");
  record("the details' frame with them less without, mean", mean(fight.details) - base, "ms");
  record("the blasts and the details they add, a frame, mean", mean(added), "ms", MEAN_MS);
  record(`the same, worst of ${FRAMES} frames`, Math.max(...added), "ms", WORST_MS);
  record(`particles alive at most (the tier's pool ${tier.details.pool})`, fight.alive, "", tier.details.pool);
  record(`see-through share of the screen at most, fire counted (the tier's ${tier.details.fill})`, fight.fill, "screens", tier.details.fill * 1.25);
  record("of that, fire, rockets' smoke and glows at most", fight.fire, "screens");
  record("and what the blasts threw up among the details at most", fight.dust, "screens");
  record("particles thinned for the screen's fill", fight.thinned, "");
  record("draws of fire in a frame at most: every flame in a range one, a blast's lobes one", fight.fires, "", ROCKETS + 2 * 3);
  record("cards of smoke and glow in a frame at most", fight.cards, "", 512);

  // The blasts' part of a frame alone, for what it leaves the collector: nothing, in the steady state.
  const p = scene.packet;
  rows[0] = p.drawCount;
  rows[1] = p.transientCount;
  rows[2] = p.detailCount;
  const t1 = scene.now + 1000;
  for (let f = 0; f < FRAMES; f++) turn(f, t1 + f * (1000 / 60), true, true);
  Bun.gc(true);
  const objects = heapStats().objectCount;
  for (let f = FRAMES; f < FRAMES + 300; f++) turn(f, t1 + f * (1000 / 60), true, true);
  Bun.gc(true);
  record("objects left by 300 frames of the blasts alone", Math.max(0, heapStats().objectCount - objects), "", 40);
  for (let k = 0; k < ROCKETS; k++) blasts.end(k, t1 + 20000);
  scene.assets.tier = kept;
}

if (import.meta.main) {
  const { provingView } = await import("../snap.ts");
  const view = provingView(64, 64);
  [view.cam.x, view.cam.z] = [236, 340];
  view.cam.y = view.hf.heightAt(236, 340) + 1.7;
  view.cam.aspect = 16 / 9;
  view.scene.viewHeight = 1080;
  let missed = false;
  benchBursts(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => {
      if (budget !== null && value > budget) missed = true;
      console.log(`  ${name.padEnd(84)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`);
    },
    view.scene,
    view.cam,
    view.hf,
  );
  process.exit(missed ? 1 : 0);
}
