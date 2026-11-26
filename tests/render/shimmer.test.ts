// A body that shimmers is drawn apart from its mesh's others, with its shimmer on its own draw (render/characters.ts
// `glow`, packet.ts drawGlow), and a frame with none is the frame it was.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FLAT_BODY_FRAGMENT, FLAT_FRAGMENT } from "../../client/core/render/glsl.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { MESH_ROWS } from "../../client/core/render/uniforms.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { surfaceFragment } from "../../client/core/render/surface.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { flatWorld } from "../fixtures/world.ts";


function stage() {
  const world = flatWorld(4), reg = world.reg, scene = new Scene(world, reg, corePack()), cam = new Camera();
  scene.assets.tier = tierOf("high");
  [cam.x, cam.y, cam.z, cam.aspect] = [128, 2, 110, 16 / 9];
  cam.update();
  const remote = new RemoteSample(), car = reg.index.get("core:compact")!;
  for (let i = 0; i < 3; i++) [remote.id[i], remote.kind[i], remote.x[i], remote.y[i], remote.z[i], remote.flags[i]] = [100 + i, car, 122 + i * 6, 0.2, 128, 1];
  remote.count = 3;
  const draws = () => {
    // A mesh comes over a few frames; the last is the frame as it settles.
    let p = scene.build(cam, remote);
    for (let k = 0; k < 30; k++) { scene.now += 1000 / 60; p = scene.build(cam, remote); }
    // The cars are the frame's only bodies.
    const rows: { instances: number; glow: number[] }[] = [];
    for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_SKINNED) !== 0) rows.push({ instances: p.drawInstances[d]!, glow: Array.from(p.drawGlow.subarray(d * 4, d * 4 + 4)) });
    return { rows, glowing: Array.from({ length: p.drawCount }, (_, d) => p.drawGlow[d * 4]!).filter((g) => g !== 0).length };
  };
  return { scene, draws };
}

// The cars are drawn as bodies on their own art: as its grey box a vehicle is no body's draw.
artTest("three cars of one model are one draw, and the one that shimmers is a draw of its own carrying its shimmer", () => {
  const { scene, draws } = stage();
  const plain = draws();
  expect(plain.glowing).toBe(0);
  expect(plain.rows.map((r) => r.instances).reduce((a, b) => Math.max(a, b), 0)).toBe(3);
  scene.characters.glow = { count: 1, ids: Int32Array.of(101, 0, 0, 0), phase: Float32Array.of(0.5, 0, 0, 0) };
  const lit = draws();
  const own = lit.rows.filter((r) => r.glow[0] !== 0), rest = lit.rows.filter((r) => r.glow[0] === 0);
  expect(own.length).toBeGreaterThan(0);
  for (const r of own) {
    expect(r.instances).toBe(1);
    // Full at the middle of its moment, its band half way up, from its origin's height from the eye up its reach.
    expect(r.glow[0]).toBeCloseTo(1, 5);
    expect(r.glow[1]).toBeCloseTo(0.5, 5);
    expect(r.glow[2]).toBeCloseTo(0.2 - 2, 4);
    expect(r.glow[3]).toBeGreaterThan(0.5);
  }
  expect(Math.max(...rest.map((r) => r.instances))).toBe(2);
  expect(lit.glowing).toBe(own.length);
  // Its moment over, the frame is the one it was.
  scene.characters.glow = { count: 0, ids: new Int32Array(4), phase: new Float32Array(4) };
  expect(draws()).toEqual(plain);
});

test("the shimmer is in the textured and the mesh's flat programs, sent a draw, and not in the ground's", () => {
  expect(MESH_ROWS.some((r) => r.name === "uGlow")).toBe(true);
  expect([FLAT_BODY_FRAGMENT.includes("uniform vec4 uGlow;"), FLAT_BODY_FRAGMENT.includes("+ shimmer(n, -normalize(vRel), vRel)"), FLAT_FRAGMENT.includes("uGlow")]).toEqual([true, true, false]);
  const text = surfaceFragment("rgba", "");
  expect([text.includes("uniform vec4 uGlow;"), text.includes("+ shimmer(n, v, vRel)")]).toEqual([true, true]);
});
