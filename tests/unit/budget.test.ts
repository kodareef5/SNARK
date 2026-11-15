import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FrameBudget, LEAVES_LEFT, ORDER, SQUEEZE_MOST, STEPS, coverScale, crownScale, leavesAt, thinning } from "../../client/core/render/budget.ts";
import { DRAW_CUTOUT, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { Rng } from "../../shared/rng.ts";
import { nodeWorld } from "../fixtures/nodeworld.ts";
import { corePack } from "../fixtures/pack.ts";

const medium = tierOf("medium");
const FRAME = 1000 / 60;

/** A budget and its clock, in ms. */
const made = (): { b: FrameBudget; t: number } => ({ b: new FrameBudget(), t: 0 });

/**
 * Frames of a scene whose crowns near cost `crowns(squeeze)` and everything else `above(t)`, `minutes` long, on from
 * where `at` left off: what the squeeze was each frame.
 */
function run(minutes: number, crowns: (squeeze: number) => number, above: (t: number) => number, at = made()): number[] {
  const out: number[] = [];
  for (const end = at.t + minutes * 60000; at.t < end; at.t += FRAME) {
    at.b.begin(medium);
    at.b.crowns = crowns(at.b.squeeze);
    at.b.end(at.t, at.b.crowns + above(at.t), 500);
    out.push(at.b.squeeze);
  }
  return out;
}

/** How many times a series turns from rising to falling or back. */
function turns(xs: readonly number[]): number {
  let [n, way] = [0, 0];
  for (let i = 1; i < xs.length; i++) {
    const d = Math.sign(xs[i]! - xs[i - 1]!);
    if (d !== 0 && way !== 0 && d !== way) n++;
    if (d !== 0) way = d;
  }
  return n;
}

test("the order puts bodies and what a fight shows above anything built, cover above crowns near, and ambient details last", () => {
  expect(ORDER).toEqual(["own", "bodies", "fight", "built", "ground", "cover", "crowns", "far", "ambient"]);
  // Every tier has a number; medium's is the young wood the iPhone held at 60 a second (D423).
  expect(medium.budget).toEqual({ triangles: 2e6, draws: 1024 });
});

test("the squeeze rises while crowns near take more than the frame leaves them, and falls only well under, slowly", () => {
  // Crowns cost 3 M at no squeeze and a third as much at the most; 1 M of the rest leaves them 1 M of medium's 2 M.
  const crowns = (s: number): number => 3e6 * (1 - (2 / 3) * (s / SQUEEZE_MOST));
  const at = made();
  const squeezes = run(0.15, crowns, () => 0.8e6, at);
  // It rose until they fit, and held there.
  const held = squeezes.at(-1)!;
  expect(crowns(held)).toBeLessThanOrEqual(1.2e6);
  expect(crowns(held)).toBeGreaterThan(1.2e6 * 0.85);
  expect(turns(squeezes)).toBe(0);
  // The rest leaves, and crowns may take all of the 2 M; not below where it was over in the last 20 s, it holds.
  const after = run(0.1, crowns, () => 0, at);
  expect(after.every((s) => s === held)).toBe(true);
  // Then, a second under, it falls a hundredth a frame, until crowns take what they may less a margin.
  const later = run(0.5, crowns, () => 0, at);
  expect(later.findIndex((s) => s < held) * FRAME).toBeLessThan(15000);
  expect(crowns(later.at(-1)!)).toBeGreaterThan(2e6 * 0.85);
  expect(crowns(later.at(-1)!)).toBeLessThanOrEqual(2e6);
  expect(turns([...squeezes, ...after, ...later])).toBe(1);
  // Off, the squeeze is none, whatever the frame.
  at.b.on = false;
  expect(run(0.05, crowns, () => 1e7, at).every((s) => s === 0)).toBe(true);
});

test("a count hovering at the limit does not move the squeeze back and forth", () => {
  // Crowns whose cost jumps by a sixth where a level changes for many at once, the rest hovering 3% about the limit
  // as the camera turns and bodies come and go, for ten minutes.
  const crowns = (s: number): number => (s < 1.5 ? 1.3e6 : 1.05e6) - 0.05e6 * s;
  const rng = new Rng(3);
  const squeezes = run(10, crowns, () => 0.95e6 * (1 + (rng.float() - 0.5) * 0.06));
  // At most a few turns in ten minutes, and the level change at 1.5 crossed back fewer times still.
  expect(turns(squeezes)).toBeLessThanOrEqual(4);
  let crossed = 0;
  for (let i = 1; i < squeezes.length; i++) if (squeezes[i - 1]! < 1.5 !== squeezes[i]! < 1.5) crossed++;
  expect(crossed).toBeLessThanOrEqual(2);
});

test("leaves thin from the band inward, the nearest last, and a crown keeps its thinning until it is a margin past a step", () => {
  const band = medium.nodes.band[1];
  expect([0, 30, 150].map((m) => thinning(0, m, band, 255))).toEqual([0, 0, 0]);
  // Half way: crowns past the sweep's edge thinned to the most, those short of it not at all.
  expect([20, 80, 92, 100, 150].map((m) => thinning(0.5, m, band, 255))).toEqual([0, 0, 0, 8, STEPS]);
  expect([2, 8, 30].map((m) => thinning(1, m, band, 255))).toEqual([2, 8, STEPS]);
  // Within a margin of the step it has, it stays; past it, it moves.
  expect(thinning(1, 8.7, band, 8)).toBe(8);
  expect(thinning(1, 9.4, band, 8)).toBe(9);
  expect(leavesAt(0)).toBe(1);
  expect(leavesAt(STEPS)).toBeCloseTo(LEAVES_LEFT, 9);
  // Crowns give their levels from the first whole step, cover from the second.
  expect([0.5, 1, 2, 3, 4].map(crownScale)).toEqual([1, 1, 2, 4, 8]);
  expect([1, 2, 3, 4].map(coverScale)).toEqual([1, 1, 2, 4]);
});

test("a squeezed elder oak draws its bark at the trunk's level, its crown coarser, and its leaves' best seen share; the count follows", () => {
  const w = nodeWorld({ chunksX: 5, chunksZ: 5, kinds: ["core:oak"], perChunk: 24, pack: corePack(), width: 390, height: 669 });
  const { scene } = w;
  const sections = scene.assets.table.sections;
  // Every level held whole and taken as drawn with its materials, as on a phone holding the stand's textures.
  (scene.assets as unknown as { textured: (mesh: number, level: number) => boolean }).textured = (mesh, level) => (sections[mesh]![level]?.length ?? 0) > 0;
  scene.viewHeight = 669;
  w.stand(160, 160);
  w.look(160, 21.7, 160, 0.3);
  const materials = scene.assets.table.materials;
  /** Per draw: mesh, level, material and indices, for the textured draws of trees. */
  const draws = (p: FramePacket): string[] => Array.from({ length: p.drawCount }, (_, d) => d).filter((d) => (p.drawFlags[d]! & DRAW_TEXTURED) !== 0).map((d) => `${p.drawMesh[d]} ${p.drawLod[d]} ${materials[p.drawMaterial[d]!]!.id} ${p.drawFirstIndex[d]} ${p.drawIndexCount[d]}`);
  scene.budget.on = false;
  w.frame();
  const whole = draws(w.frame());
  // On but under its number, the frame is the same.
  scene.budget.on = true;
  scene.budget.reset();
  w.frame();
  expect(draws(w.frame())).toEqual(whole);
  // A frame that leaves crowns nothing: the squeeze goes to its most.
  scene.assets.tier = { ...medium, budget: { triangles: 1, draws: 1024 } };
  for (let f = 0; f < 200; f++) w.frame();
  expect(scene.budget.squeeze).toBe(SQUEEZE_MOST);
  const p = w.frame();
  let [split, thinned, counted] = [0, 0, 0];
  for (let d = 0; d < p.drawCount; d++) {
    // A flat level draws the whole tree, and counts as its crown.
    const node = p.drawBuffer[d]! >= NODE_BUFFERS && p.drawBuffer[d]! < 2 * NODE_BUFFERS;
    if (node && (p.drawFlags[d]! & DRAW_TEXTURED) === 0) counted += scene.assets.table.tris[p.drawMesh[d]!]![p.drawLod[d]!]! * p.drawInstances[d]!;
    if ((p.drawFlags[d]! & DRAW_TEXTURED) === 0) continue;
    const id = materials[p.drawMaterial[d]!]!.id;
    const runs = sections[p.drawMesh[d]!]![p.drawLod[d]!]!;
    const k = runs.findIndex((x, i) => i % 3 === 0 && x === p.drawMaterial[d]);
    // Each draw begins where its material's run begins, and the leaves' draw is the first of their run.
    expect(p.drawFirstIndex[d]).toBe(runs[k + 1]!);
    if ((p.drawFlags[d]! & DRAW_CUTOUT) !== 0 && p.drawIndexCount[d]! < runs[k + 2]!) thinned++;
    if (!id.endsWith("bark")) counted += (p.drawIndexCount[d]! / 3) * p.drawInstances[d]!;
    // A run whose bark is finer than its crown: the next draws are its crown's, at their own level.
    if (id.endsWith("bark") && d + 1 < p.drawCount && p.drawMesh[d + 1] === p.drawMesh[d] && p.drawFirst[d + 1] === p.drawFirst[d] && p.drawLod[d + 1]! > p.drawLod[d]!) split++;
  }
  expect(split).toBeGreaterThan(0);
  expect(thinned).toBeGreaterThan(0);
  expect(scene.budget.last.crowns).toBe(counted);
  expect(p.triangles).toBeLessThan(whole.reduce((n, line) => n + Number(line.split(" ")[4]), 0));
});
