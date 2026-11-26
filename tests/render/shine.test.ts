// A map piece that shines is drawn apart from its chunk's others of its mesh, out of the same buffer, with its shimmer on
// its own draw (render/passes/near-store.ts `shine`), and a frame with none is the frame it was.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { flatWorld } from "../fixtures/world.ts";

function stage() {
  const world = flatWorld(4), reg = world.reg, bin = reg.index.get("core:zzstreet_bin")!;
  const refs = [116, 119, 122].map((x) => world.structs.add(bin, x, 0, 120, 0, 0, reg.maxHp[bin]!));
  const scene = new Scene(world, reg, corePack()), cam = new Camera();
  scene.assets.tier = tierOf("high");
  [cam.x, cam.y, cam.z, cam.aspect] = [128, 2, 110, 16 / 9];
  cam.update();
  const remote = new RemoteSample();
  const chunk = Math.floor(refs[0]! / 65536);
  const draws = () => {
    // A mesh comes over a few frames; the last is the frame as it settles.
    let p = scene.build(cam, remote);
    for (let k = 0; k < 30; k++) { scene.now += 1000 / 60; p = scene.build(cam, remote); }
    // The bins are their chunk's only pieces.
    const rows: { first: number; instances: number; glow: number[] }[] = [];
    for (let d = 0; d < p.drawCount; d++) if (p.drawBuffer[d] === chunk) rows.push({ first: p.drawFirst[d]!, instances: p.drawInstances[d]!, glow: Array.from(p.drawGlow.subarray(d * 4, d * 4 + 4)) });
    return { rows, glowing: Array.from({ length: p.drawCount }, (_, d) => p.drawGlow[d * 4]!).filter((g) => g !== 0).length };
  };
  return { scene, draws, refs, bin, structs: world.structs };
}

artTest("three bins of a chunk are one draw, and the one that shines is a draw of its own out of the same buffer", () => {
  const { scene, draws, refs, bin, structs } = stage();
  const plain = draws();
  expect(plain.glowing).toBe(0);
  expect(plain.rows.length).toBeGreaterThan(0);
  expect(plain.rows.every((r) => r.instances === 3)).toBe(true);
  scene.shine = { count: 1, refs: Float64Array.of(refs[1]!, 0, 0, 0), phase: Float32Array.of(0.5, 0, 0, 0) };
  const lit = draws();
  const own = lit.rows.filter((r) => r.glow[0] !== 0), rest = lit.rows.filter((r) => r.glow[0] === 0);
  expect(own.length).toBeGreaterThan(0);
  for (const r of own) {
    expect(r.instances).toBe(1);
    // Full at the middle of its moment, its band half way up, from its foot's height from the eye up its own height.
    expect(r.glow[0]).toBeCloseTo(1, 5);
    expect(r.glow[1]).toBeCloseTo(0.5, 5);
    expect(r.glow[2]).toBeCloseTo(structs.low[bin]! - 2, 3);
    expect(r.glow[3]).toBeCloseTo(structs.top[bin]! - structs.low[bin]!, 3);
    expect(r.glow[3]).toBeGreaterThan(0.9);
  }
  // The other two are still drawn, once each section, and none of them twice.
  expect(lit.glowing).toBe(own.length);
  const sections = own.length;
  expect(rest.reduce((n, r) => n + r.instances, 0)).toBe(2 * sections);
  for (const r of rest) expect(r.first === own[0]!.first).toBe(false);
  // Its moment over, the frame is the one it was.
  scene.shine = { count: 0, refs: new Float64Array(4), phase: new Float32Array(4) };
  expect(draws()).toEqual(plain);
});
