// The stations wave's resource nodes (content/items/nodes.ts): what a pick, a hatchet and a hand get from each, as the
// reference game's pages say at 1x, and where they grow.

import { expect, test } from "bun:test";
import type { NodeDef } from "../../shared/content/defs.ts";
import { nodeLayers } from "../../shared/world/mapfile.ts";
import { PROVING_DIMS, PROVING_RESOURCES, PROVING_SEA_LEVEL, PROVING_SPAWN, buildProvingHeightfield } from "../../shared/world/proving.ts";
import { nodesOf, takeInHand, type Found } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const KINDS = ["core:oil_rock", "core:crystal_rock", "core:obsidian_rock", "core:clam"];

test("the proving ground lists each resource node just off the plaza, the clams and oil rocks under the pool's water and the crystal and obsidian up the hill", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  for (const id of KINDS) {
    const listed = PROVING_RESOURCES.filter(([kind]) => kind === id).map(([, x, z, yaw]) => [x, z, yaw]);
    const found = nodesOf(h, id, PROVING_SPAWN.x, PROVING_SPAWN.z);
    // Each stands where it is listed and nowhere else, within 110 m of where a new survivor arrives.
    expect(found.map((n) => [n.x, n.z, n.yaw]).sort(), id).toEqual(listed.sort());
    for (const n of found) {
      expect(Math.hypot(n.x - PROVING_SPAWN.x, n.z - PROVING_SPAWN.z), id).toBeLessThan(110);
      expect(Math.max(Math.abs(n.x - 256), Math.abs(n.z - 256)), id).toBeGreaterThan(99);
      const above = n.y - PROVING_SEA_LEVEL;
      if (id === "core:clam") expect([above < -1.5, above > -3], id).toEqual([true, true]);
      else if (id === "core:oil_rock") expect([above < -0.5, above > -1.5], id).toEqual([true, true]);
      else expect(above, id).toBeGreaterThan(8.5);
    }
  }
  expect(nodesOf(h, "core:clam", 0, 0).length).toBe(5);
});

test("a scattered kind of the sea floor grows only under the sea, crystal on either, and every other only on dry ground, where it always has", () => {
  const hf = buildProvingHeightfield();
  const layer = (kinds: [string, number][]) => nodeLayers(PROVING_DIMS, hf, reg, [{ seed: 7, perChunk: 64, kinds, allowCell: 0, allow: null }])!;
  const mixed = layer([["core:clam", 1], ["core:tree", 1], ["core:crystal_rock", 1]]);
  const dry = layer([["core:tree", 1], ["core:tree", 1], ["core:tree", 1]]);
  const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const other = { ...spot };
  const [clam, tree, crystal] = [reg.index.get("core:clam")!, reg.index.get("core:tree")!, reg.index.get("core:crystal_rock")!];
  const count = { clam: 0, tree: 0, wet: 0, dry: 0 };
  for (let chunk = 0; chunk < 64; chunk++) {
    for (let i = 0; i < 64; i++) {
      mixed.at(chunk, i, spot);
      if (spot.kind === clam) {
        count.clam++;
        expect(spot.y).toBeLessThan(PROVING_SEA_LEVEL);
      } else if (spot.kind === crystal) {
        count[spot.y < PROVING_SEA_LEVEL ? "wet" : "dry"]++;
      } else if (spot.kind === tree) {
        count.tree++;
        expect(spot.y).toBeGreaterThanOrEqual(PROVING_SEA_LEVEL + 0.3);
        // A tree's slot is where a layer of trees alone puts one.
        dry.at(chunk, i, other);
        expect([other.kind, other.x, other.z, other.yaw]).toEqual([tree, spot.x, spot.z, spot.yaw]);
      }
    }
  }
  expect([count.clam > 10, count.tree > 300, count.wet > 10, count.dry > 300]).toEqual([true, true, true, true]);
});

/** To dry ground 50 m from the node toward the plaza's middle, so its chunk is filled. */
function goTo(h: Harness, s: ReturnType<Harness["join"]>, node: Found): void {
  h.say(s, `tp ${(node.x + (node.x < 256 ? 50 : -50)).toFixed(1)} ${node.z.toFixed(1)}`);
  h.run(500);
}

/** Each blow's gains, item by item, until the node is used up. */
function work(h: Harness, s: ReturnType<Harness["join"]>, node: Found, items: string[]): Record<string, number[]> {
  goTo(h, s, node);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const inv = h.host.items.inv(rec);
  const field = h.host.harvest!.field;
  const out: Record<string, number[]> = Object.fromEntries(items.map((i) => [i, []]));
  for (let blows = 0; field.standing(node.chunk, node.index) !== 0 && blows < 40; blows++) {
    const before = items.map((i) => inv.total(reg.index.get(i)!));
    expect(h.host.harvest!.strike(h.client(s)!, node.chunk, node.index)).toBe(true);
    items.forEach((i, k) => out[i]!.push(inv.total(reg.index.get(i)!) - before[k]!));
  }
  return out;
}

const within = (got: number[], lo: number, hi: number, step = 1): boolean => got.every((n) => n >= lo && n <= hi && n % step === 0);

test("a pick gets each rock's resource as the pages give it, a hatchet only stone; a clam is picked by hand for 2 to 4 pearls and a swing does nothing to it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  h.say(s, "give pick 1");
  h.say(s, "give hatchet 1");
  const hits = (id: string): number => (reg.defs[reg.index.get(id)!] as NodeDef).hits;
  const near = (id: string): Found[] => nodesOf(h, id, PROVING_SPAWN.x, PROVING_SPAWN.z);
  const [oil, crystal, obsidian, metal] = [near("core:oil_rock"), near("core:crystal_rock"), near("core:obsidian_rock"), near("core:metal_rock")];

  takeInHand(h, s, reg.index.get("core:hatchet")!);
  // The wrong tool: stone a blow, as a fist gets, and none of what the rock holds.
  const a = work(h, s, oil[0]!, ["core:stone", "core:oil"]);
  expect([a["core:stone"]!.length, within(a["core:stone"]!, 1, 1), within(a["core:oil"]!, 0, 0)]).toEqual([hits("core:oil_rock"), true, true]);
  const b = work(h, s, crystal[0]!, ["core:stone", "core:crystal"]);
  expect([b["core:stone"]!.length, within(b["core:stone"]!, 1, 1), within(b["core:crystal"]!, 0, 0)]).toEqual([hits("core:crystal_rock"), true, true]);
  const c = work(h, s, obsidian[0]!, ["core:stone", "core:obsidian"]);
  expect([c["core:stone"]!.length, within(c["core:stone"]!, 1, 2), within(c["core:obsidian"]!, 0, 0)]).toEqual([hits("core:obsidian_rock"), true, true]);

  takeInHand(h, s, reg.index.get("core:pick")!);
  // Oil: "The Stone Pick yields 0-1 oil", a blow, not multiplied by the pick's 3; stone is.
  const d = work(h, s, oil[1]!, ["core:stone", "core:oil"]);
  expect([d["core:stone"]!.length, within(d["core:stone"]!, 3, 3), within(d["core:oil"]!, 0, 1), d["core:oil"]!.includes(1), d["core:oil"]!.includes(0)]).toEqual([15, true, true, true, true]);
  // Crystal: a stone pick's "very low drop chance", none or one a blow.
  const e = work(h, s, crystal[1]!, ["core:stone", "core:crystal"]);
  expect([e["core:stone"]!.length, within(e["core:stone"]!, 3, 3), within(e["core:crystal"]!, 0, 1), e["core:crystal"]!.includes(1)]).toEqual([10, true, true, true]);
  // Obsidian rock: as a metal rock's ore, 1 to 3 a blow times the pick's 3.
  const f = work(h, s, obsidian[1]!, ["core:stone", "core:obsidian"]);
  expect([f["core:stone"]!.length, within(f["core:stone"]!, 3, 6, 3), within(f["core:obsidian"]!, 3, 9, 3)]).toEqual([15, true, true]);
  // A metal rock gives obsidian too, at a reduced rate: none or 3 a blow, where its ore is 3 to 9.
  const g = work(h, s, metal[0]!, ["core:ore", "core:obsidian"]);
  const sum = (v: number[]): number => v.reduce((x, y) => x + y, 0);
  expect([g["core:ore"]!.length, within(g["core:ore"]!, 3, 9, 3), within(g["core:obsidian"]!, 0, 3, 3), sum(g["core:obsidian"]!) > 0, sum(g["core:obsidian"]!) < sum(g["core:ore"]!) / 2]).toEqual([15, true, true, true, true]);

  // A clam: a swing does nothing to it; the use key picks it once, for 2 to 4.
  const clam = near("core:clam")[0]!;
  const harvest = h.host.harvest!;
  goTo(h, s, clam);
  expect([harvest.field.standing(clam.chunk, clam.index), harvest.struck(h.client(s)!, clam.chunk, clam.index)]).toEqual([clam.kind, false]);
  const pearls = work(h, s, clam, ["core:silica_pearls"])["core:silica_pearls"]!;
  expect([pearls.length, within(pearls, 2, 4)]).toEqual([1, true]);
  expect(h.host.items.audit()).toEqual([]);
});
