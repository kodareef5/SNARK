// A cell of trees changes level by a short dissolve on the lit tiers (Tier.nodes.levels, scene.ts swapOf, hand.ts
// swapKeeps): for a moment it is drawn at both levels, the new keeping a growing share of the pattern's pixels and the
// old the rest. These read the draws a frame makes of a real oak wood, every level taken as drawn with its materials.

import { expect } from "bun:test";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { HAND_NEAR, nearKeeps, swapKeeps } from "../../client/core/render/hand.ts";
import { DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { test } from "../fixtures/needs-art.ts";
import { nodeWorld, type NodeWorld } from "../fixtures/nodeworld.ts";
import { corePack } from "../fixtures/pack.ts";

/** One near draw of a node: its crown's level, its swap, and whether it takes part in the hand-over. */
interface Draw {
  level: number;
  swap: number;
  hand: number;
}

/** An oak wood on flat ground, 10 by 10 chunks, every level drawn textured, the budget off so levels are as distance asks. */
function oaks(tier: Tier): NodeWorld {
  const w = nodeWorld({ chunksX: 10, chunksZ: 10, kinds: ["core:oak"], perChunk: 24, pack: corePack(), tier, width: 960, height: 540 });
  const sections = w.scene.assets.table.sections;
  (w.scene.assets as unknown as { textured: (mesh: number, level: number) => boolean }).textured = (mesh, level) => (sections[mesh]![level]?.length ?? 0) > 0;
  w.scene.budget.on = false;
  w.stand(320, 320);
  return w;
}

/** Every near node a frame draws, by its place in its buffer, with how far its foot is: a draw for each level it is drawn at. */
function nearDraws(w: NodeWorld, p: FramePacket): Map<string, { at: number; draws: Draw[] }> {
  const out = new Map<string, { at: number; draws: Draw[] }>();
  // A level of several materials is several draws, its bark at the trunk's level and the rest at the crown's, and a draw
  // in both depth ranges is listed in each: one of each, at its crown's level.
  const seen = new Map<string, Draw[]>();
  for (let d = 0; d < p.drawCount; d++) {
    const buffer = p.drawBuffer[d]!;
    if (buffer < NODE_BUFFERS || buffer >= NODE_BUFFERS * 2 || (p.drawFlags[d]! & DRAW_TEXTURED) === 0) continue;
    const key = `${buffer}/${p.drawFirst[d]}/${p.drawInstances[d]}/${p.drawSwap[d]}`;
    const had = seen.get(key);
    if (had) {
      for (const g of had) g.level = Math.max(g.level, p.drawLod[d]!);
      continue;
    }
    const mine: Draw[] = [];
    seen.set(key, mine);
    const data = w.card.get(buffer)!.data, view = new DataView(data.buffer, data.byteOffset);
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const o = i * INSTANCE_BYTES;
      const at = Math.hypot(view.getFloat32(o, true) + p.drawOffset[d * 3]!, view.getFloat32(o + 4, true) + p.drawOffset[d * 3 + 1]!, view.getFloat32(o + 8, true) + p.drawOffset[d * 3 + 2]!);
      const node = out.get(`${buffer}/${i}`) ?? { at, draws: [] };
      const g = { level: p.drawLod[d]!, swap: p.drawSwap[d]!, hand: p.drawHand[d]! };
      node.draws.push(g);
      mine.push(g);
      out.set(`${buffer}/${i}`, node);
    }
  }
  return out;
}

/** Of the 16 pixels of the fades' pattern, how many draws of a node `at` metres off keep each. */
function keeps(w: NodeWorld, at: number, draws: readonly Draw[]): number[] {
  const [from, to] = w.scene.assets.tier.nodes.band;
  const out: number[] = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) out.push(draws.filter((g) => swapKeeps(g.swap, x, y) && (g.hand !== HAND_NEAR || nearKeeps(at, from, to, x, y))).length);
  return out;
}

/** Each frame's nodes short of the hand-over, checked drawn whole and once; how many were between two levels, and their swaps. */
function frames(w: NodeWorld, n: number): { swapping: number; swaps: number[] }[] {
  const from = w.scene.assets.tier.nodes.band[0];
  const out: { swapping: number; swaps: number[] }[] = [];
  for (let f = 0; f < n; f++) {
    let swapping = 0;
    const swaps = new Set<number>();
    for (const { at, draws } of nearDraws(w, w.frame()).values()) {
      if (at >= from) continue;
      // Drawn whole and once: each pixel of the pattern kept by one draw, never none or two.
      expect(keeps(w, at, draws), `an oak ${at.toFixed(1)} m off, drawn ${JSON.stringify(draws)}`).toEqual(Array(16).fill(1));
      if (draws.length === 1) continue;
      swapping++;
      // Its new levels and its old, one keeping what the other drops.
      const [a, b] = draws;
      expect([draws.length, a!.swap, a!.level !== b!.level]).toEqual([2, -b!.swap, true]);
      swaps.add(Math.abs(a!.swap));
    }
    out.push({ swapping, swaps: [...swaps] });
  }
  return out;
}

test("a cell of oaks that changes level dissolves from the old to the new over the tier's time, drawn whole and once every frame", () => {
  const w = oaks(tierOf("high"));
  w.look(320, 21.7, 300, 0.4);
  // Settled: nothing changing.
  frames(w, 40);
  expect(frames(w, 1)[0]!.swapping).toBe(0);
  // Twenty metres on toward the wood: cells come nearer and take finer levels, each by a dissolve.
  w.look(320, 21.7, 320, 0.4);
  const after = frames(w, 40);
  expect(after[0]!.swapping).toBeGreaterThan(5);
  // Each change goes from just over none toward all as the frames pass, and is done in the tier's time.
  const share = (f: number): number => Math.max(...after[f]!.swaps);
  expect(share(0)).toBeLessThan(0.1);
  expect(share(12)).toBeGreaterThan(0.4);
  expect(share(12)).toBeLessThan(0.6);
  const ms = w.scene.assets.tier.nodes.levels!;
  expect(after[Math.ceil(ms / (1000 / 60)) + 2]!.swapping).toBe(0);
});

test("a cell that comes into view takes its level at once, as nothing of it was on screen to change", () => {
  const w = oaks(tierOf("high"));
  w.look(320, 21.7, 300, 0.4);
  frames(w, 40);
  // Turned away while the camera moves, then back once the cells it left have been out of view a while.
  w.look(320, 21.7, 300, 0.4 + Math.PI);
  frames(w, 3);
  w.look(320, 21.7, 320, 0.4 + Math.PI);
  frames(w, 30);
  w.look(320, 21.7, 320, 0.4);
  expect(frames(w, 1)[0]!.swapping).toBe(0);
});

test("on a tier without a swap a cell of oaks changes level at once", () => {
  const high = tierOf("high");
  const w = oaks({ ...high, nodes: { chunks: high.nodes.chunks, band: high.nodes.band } });
  w.look(320, 21.7, 300, 0.4);
  frames(w, 10);
  w.look(320, 21.7, 320, 0.4);
  const p = w.frame();
  expect(p.drawSwap.subarray(0, p.drawCount).every((v) => v === 0)).toBe(true);
  for (const { draws } of nearDraws(w, p).values()) expect(draws.length).toBe(1);
});

test("a squeeze below none draws each level twice as far for each whole step", () => {
  const w = oaks(tierOf("high"));
  w.look(320, 21.7, 320, 0.4);
  const finest = (squeeze: number): number => {
    w.scene.budget.on = true;
    w.scene.budget.held = true;
    w.scene.budget.squeeze = squeeze;
    let most = 0;
    for (let f = 0; f < 40; f++) w.frame();
    for (const { at, draws } of nearDraws(w, w.frame()).values()) if (draws.some((g) => g.level <= 1)) most = Math.max(most, at);
    return most;
  };
  const [none, one] = [finest(0), finest(-1)];
  expect(none).toBeGreaterThan(5);
  // Twice as far, give or take a cell.
  expect(one / none).toBeGreaterThan(1.5);
  expect(one / none).toBeLessThan(2.6);
});
