// What a blast that destroys 256 built pieces at once costs a client: the most of them shown in fragments, the
// triangles and draws they add in the worst frame, and the rubble pass's time a frame (falling.step, the pass's update
// and its draw, floors found by rays) over the 3 s they fly, against the same wave falling whole. The pieces are drawn from grey boxes
// and the tiers' real break meshes (tools/pack/pieces/breaks.ts), read from the installed packs.
//
//   bun tools/bench/piece-breaks.ts [--tier high]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { Falling } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { CLS_EDGE, CLS_SQUARE } from "../../shared/world/lattice/module.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import { GONE_BLAST, GONE_FELL } from "../../shared/world/structures.ts";
import { Base, turnedRegistry, turnedWorld } from "../../tests/fixtures/turned.ts";
import { SOURCE } from "../art/source.ts";
import { grayboxMeshes } from "../pack/build.ts";
import { buildPack, unpackMeshes } from "../pack/write.ts";

const TIERS = ["thatch", "wood", "stone", "metal"] as const;
const WALLS: Readonly<Record<string, readonly string[]>> = { thatch: ["wall", "doorframe", "half_wall", "wall"], wood: ["wall", "doorframe", "windowframe", "half_wall"], stone: ["wall", "doorframe", "windowframe", "half_wall"], metal: ["wall", "doorframe", "windowframe", "half_wall"] };
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
const most = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), 0);

export interface PieceBreakRows {
  /** Pieces shown in fragments at the worst frame, and kept with a set. */
  shown: number;
  kept: number;
  /** What the fragments add to the worst frame, and all the falling pieces, whole ones too. */
  triangles: number;
  draws: number;
  allTriangles: number;
  allDraws: number;
  /** The rubble pass a frame, milliseconds: median and worst, broken and falling whole; and taking the wave in. */
  median: number;
  worst: number;
  wholeMedian: number;
  wholeWorst: number;
  absorb: number;
}

/** 128 foundations and a wall on each, of every tier, in a base at 17 degrees, all gone at once by `cause`, seen from 12 m. */
export function pieceBreakRows(tierName = "high", cause = GONE_BLAST): PieceBreakRows {
  const w = turnedWorld(4), reg = turnedRegistry();
  const base = new Base(w, 100, 100, (65536 - 3095) & 65535);
  const refs: number[] = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) {
    const tier = TIERS[(i + j) % 4]!;
    refs.push(base.put(`core:foundation_${tier}`, { cls: CLS_SQUARE, a: [2 * i, 0, 0, 2 * j], d: 0 }));
    refs.push(base.put(`core:${WALLS[tier]![j % 4]}_${tier}`, { cls: CLS_EDGE, a: [2 * i, 0, 0, 2 * j], d: 0 }));
  }
  const meshes = grayboxMeshes(reg.defs.flatMap((d) => (d ? [d] : [])));
  for (const tier of TIERS) {
    const file = join(SOURCE, "core/structures", tier, `${tier}.snpk`);
    if (existsSync(file)) meshes.push(...unpackMeshes(parsePack(new Uint8Array(readFileSync(file)))).filter((m) => m.id.endsWith("/break")));
  }
  const pack = parsePack(buildPack(meshes, defaultPalette()));
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, pack);
  scene.assets.tier = { ...tierOf(tierName), split: 0 };
  const cam = new Camera();
  const [mx, mz] = base.at([16, 0, 0, 8]);
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [mx, 9, mz - 22, 0, -0.3];
  // Floors found by a ray down through what stands, as the app finds them.
  const world = { hf: w.hf, structs: w.structs };
  const falling = new Falling(reg.halfY, (x, z) => w.hf.heightAt(x, z), { reg, structs: w.structs, floorUnder: (x, y, z) => (castWorld(world, x, y, z, 0, -1, 0, 512, true) === HIT_NONE ? w.hf.heightAt(x, z) : y - rayHit.t) });
  const loose = (scene as unknown as { looseEntities: { rubble: { update(f: unknown): void; draw(f: unknown): void }; fragmentStats: { fine: number; coarse: number; draws: number; triangles: number } } }).looseEntities;
  // The pass timed in place.
  let passMs = 0;
  const { update, draw } = loose.rubble;
  loose.rubble.update = (f) => {
    const t = performance.now();
    update(f);
    passMs += performance.now() - t;
  };
  loose.rubble.draw = (f) => {
    const t = performance.now();
    draw(f);
    passMs += performance.now() - t;
  };
  const tick0 = 600, now0 = (tick0 / TICK_RATE) * 1000;
  const rubble: Rubble[] = refs.map((ref) => {
    const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff;
    const r: Rubble = { kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s), cause, ox: mx, oy: 1, oz: mz, tick: tick0, radius: 30, into: 0, map: 0 };
    return r;
  });
  for (const ref of refs) w.structs.remove(ref, cause);
  // The pass tells the falling pieces the tier's limits as it draws.
  scene.falling = falling;
  for (let f = 0; f < 5; f++) scene.build(cam, null);
  const before = scene.build(cam, null);
  const [triangles0, draws0] = [before.triangles, before.drawCount];
  const t0 = performance.now();
  falling.absorb(rubble, now0, cam.x, cam.y, cam.z, tick0);
  const absorb = performance.now() - t0;
  const kept = Array.from({ length: falling.count }, (_, i) => i).filter((i) => falling.sets[i]).length;
  const times: number[] = [];
  let shown = 0, triangles = 0, draws = 0, allTriangles = 0, allDraws = 0;
  for (let f = 0; f < 3 * 60; f++) {
    passMs = 0;
    const t = performance.now();
    falling.step(now0 + (f * 1000) / 60, tick0 + (f * TICK_RATE) / 60);
    passMs += performance.now() - t;
    const p = scene.build(cam, null);
    times.push(passMs);
    shown = Math.max(shown, loose.fragmentStats.fine + loose.fragmentStats.coarse);
    triangles = Math.max(triangles, loose.fragmentStats.triangles);
    draws = Math.max(draws, loose.fragmentStats.draws);
    allTriangles = Math.max(allTriangles, p.triangles - triangles0);
    allDraws = Math.max(allDraws, p.drawCount - draws0);
  }
  const whole = cause === GONE_FELL ? null : pieceBreakRows(tierName, GONE_FELL);
  return { shown, kept, triangles, draws, allTriangles, allDraws, median: median(times.slice(5)), worst: most(times.slice(5)), wholeMedian: whole?.median ?? median(times.slice(5)), wholeWorst: whole?.worst ?? most(times.slice(5)), absorb };
}

if (import.meta.main) {
  const args = process.argv.slice(2), tier = args.includes("--tier") ? args[args.indexOf("--tier") + 1]! : "high";
  // Once to warm the code, then the run told.
  pieceBreakRows(tier);
  const r = pieceBreakRows(tier);
  console.log(`256 built pieces blasted at once, ${tier}:`);
  console.log(`  kept in fragments ${r.kept}, most shown in a frame ${r.shown}`);
  console.log(`  the fragments add to the worst frame ${r.triangles} triangles and ${r.draws} draws; with the pieces falling whole, ${r.allTriangles} and ${r.allDraws}`);
  console.log(`  rubble pass a frame: ${r.median.toFixed(3)} ms median, ${r.worst.toFixed(3)} worst (the same wave falling whole: ${r.wholeMedian.toFixed(3)}, ${r.wholeWorst.toFixed(3)})`);
  console.log(`  taking the wave in: ${r.absorb.toFixed(3)} ms`);
}
