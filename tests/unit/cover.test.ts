// How many crowns stand between the eye and a cell of trees (client/core/render/cover.ts), counted from the near node
// field, and the scene drawing a cell behind many of them at coarser levels. Real oaks, so their crowns are their size.

import { expect } from "bun:test";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { coverDistance } from "../../client/core/render/cover.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { formOf, type NodeSource } from "../../shared/world/nodes.ts";
import { test } from "../fixtures/needs-art.ts";
import { nodeWorld, type NodeWorld } from "../fixtures/nodeworld.ts";
import { corePack } from "../fixtures/pack.ts";

const RULE = { from: 5, per: 3, most: 4 };
/** Flat ground's height in the node world. */
const GROUND = 20;

/** Oaks at the given places on a 6 by 6 chunk world, a node source that holds them and nothing else. */
function oaks(at: readonly [number, number][], tier: Tier = { ...tierOf("high"), nodes: { ...tierOf("high").nodes, cover: RULE } }): NodeWorld {
  const w = nodeWorld({
    chunksX: 6, chunksZ: 6, kinds: ["core:oak"], pack: corePack(), tier, width: 320, height: 180,
    place: (dims, _hf, forms, kinds): NodeSource => {
      const by = new Map<number, [number, number][]>();
      for (const [x, z] of at) {
        const chunk = Math.floor(z / CHUNK_SIZE) * dims.chunksX + Math.floor(x / CHUNK_SIZE);
        by.set(chunk, [...(by.get(chunk) ?? []), [x, z]]);
      }
      const form = formOf(forms, kinds[0]!, 0);
      return {
        perChunk: 16,
        at(chunk, i, out) {
          const p = by.get(chunk)?.[i];
          [out.kind, out.form, out.x, out.y, out.z, out.yaw] = p ? [kinds[0]!, form, p[0], GROUND, p[1], 0] : [0, 0, 0, 0, 0, 0];
        },
      };
    },
  });
  const sections = w.scene.assets.table.sections;
  (w.scene.assets as unknown as { textured: (mesh: number, level: number) => boolean }).textured = (mesh, level) => (sections[mesh]![level]?.length ?? 0) > 0;
  w.scene.budget.on = false;
  // Levels as on a 1080-row canvas, as players see them.
  w.scene.viewHeight = 1080;
  w.stand(192, 192);
  w.look(40, GROUND + 9, 192, Math.PI / 2);
  w.frame();
  return w;
}

/** A wall of four oaks across the line along z = 192, from x = 100 to 250. */
const WALL: [number, number][] = [[100, 192], [150, 192], [200, 192], [250, 192]];

test("a line through a row of crowns counts about one a crown; beside them, or under them, none", () => {
  const w = oaks(WALL);
  const cover = w.scene.cover;
  expect(cover.crowns).toBe(4);
  // At crown height, end to end: each crown crossed through its middle adds 4 / pi.
  const through = cover.count(40, GROUND + 9, 192, 340, GROUND + 9, 192, 0);
  expect(through).toBeGreaterThan(4 * 0.9);
  expect(through).toBeLessThan(4 * 1.6);
  // Half way, only the first two.
  const half = cover.count(40, GROUND + 9, 192, 175, GROUND + 9, 192, 0);
  expect(half).toBeGreaterThan(through * 0.35);
  expect(half).toBeLessThan(through * 0.65);
  // Sixty metres to the side, and a metre over the ground under the crowns.
  expect(cover.count(40, GROUND + 9, 252, 340, GROUND + 9, 252, 0)).toBe(0);
  expect(cover.count(40, GROUND + 1, 192, 340, GROUND + 1, 192, 0)).toBe(0);
  // The last metres left out.
  expect(cover.count(40, GROUND + 9, 192, 340, GROUND + 9, 192, 150)).toBeCloseTo(half, 0);
});

test("a tree felled, or hidden by a prediction, no longer counts; one grown back counts again", () => {
  const w = oaks(WALL);
  const count = (): number => w.scene.cover.count(40, GROUND + 9, 192, 340, GROUND + 9, 192, 0);
  const all = count();
  // The third oak, at (200, 192): chunk (3, 3), its first slot.
  const chunk = 3 * 6 + 3;
  w.field.set(chunk, 0, false);
  w.frame();
  expect(w.scene.cover.crowns).toBe(3);
  expect(count()).toBeLessThan(all - 0.8);
  w.field.set(chunk, 0, true);
  w.frame();
  expect(count()).toBeCloseTo(all, 5);
  w.scene.hideNode(chunk * 65536, true);
  w.frame();
  expect(w.scene.cover.crowns).toBe(3);
  w.scene.hideNode(chunk * 65536, false);
  w.frame();
  expect(count()).toBeCloseTo(all, 5);
});

test("a cell behind the count's start is drawn as if twice as far, twice again for each `per` more, to the most", () => {
  expect([0, 4.9, 5, 8, 11, 30].map((n) => coverDistance(n, RULE))).toEqual([1, 1, 2, 4, 4, 4]);
  expect(coverDistance(6.5, RULE)).toBeCloseTo(2 * Math.SQRT2, 5);
});

/** Each oak's crown level as a frame draws it, by its place. */
function levels(w: NodeWorld): Map<string, number> {
  const p = w.frame(), out = new Map<string, number>();
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d]! < NODE_BUFFERS || p.drawBuffer[d]! >= NODE_BUFFERS * 2) continue;
    const card = w.card.get(p.drawBuffer[d]!);
    if (!card || p.drawInstances[d] === 0) continue;
    const view = new DataView(card.data.buffer, card.data.byteOffset);
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const at = i * INSTANCE_BYTES;
      const key = `${Math.round(view.getFloat32(at, true) + p.drawOffset[d * 3]! + w.cam.x)},${Math.round(view.getFloat32(at + 8, true) + p.drawOffset[d * 3 + 2]! + w.cam.z)}`;
      out.set(key, Math.max(out.get(key) ?? 0, p.drawLod[d]!));
    }
  }
  return out;
}

test("an oak behind a wall of crowns is drawn coarser than with nothing in the way, and one in front of it no coarser", () => {
  // A wall of eight oaks 12 m apart across the view, an oak in front of it and one behind, all seen from crown height.
  const wall: [number, number][] = Array.from({ length: 8 }, (_, i): [number, number] => [80 + i * 3, 150 + i * 12]);
  const lone: [number, number][] = [[60, 192], [150, 192]];
  const near = new Map<boolean, Map<string, number>>();
  for (const covered of [false, true]) {
    const high = tierOf("high");
    const w = oaks([...wall, ...lone], { ...high, nodes: covered ? { ...high.nodes, cover: { from: 1, per: 1, most: 4 } } : high.nodes });
    w.look(40, GROUND + 9, 192, Math.PI / 2);
    for (let f = 0; f < 3; f++) w.frame();
    near.set(covered, levels(w));
  }
  const [open, shut] = [near.get(false)!, near.get(true)!];
  expect(shut.get("60,192")).toBe(open.get("60,192"));
  expect(shut.get("150,192")!).toBeGreaterThan(open.get("150,192")!);
  // No oak is taken past its coarsest level drawn with materials, unless its distance takes it there.
  const sections = oaks([]).scene.assets.table.sections;
  const top = Math.max(...sections.map((levels) => levels.findLastIndex((runs) => runs.length > 0)));
  for (const [at, level] of shut) expect(level, at).toBeLessThanOrEqual(Math.max(top, open.get(at) ?? 0));
});
