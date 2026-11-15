// The dodo against the ARK wiki (ark.wiki.gg), read on 2026-11-14: its Dodo page, the page's taming table as the wiki
// draws it, and the data module behind both (Module:Dv/data).

import { expect, test } from "bun:test";
import { DODO_DYES } from "../../content/creatures/dodo.ts";
import { Pose, sampleClip } from "../../shared/anim/clip.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { torporDrain, torporMax } from "../../server/survival.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { STAMINA_UNITS } from "../../shared/sim/character.ts";
import { Genome, statValue } from "../../shared/sim/genome.ts";
import { narcoticsNeeded, piecesNeeded, proneHunger, tameSeconds } from "../../shared/sim/taming.ts";
import { findAssets } from "../../tools/art/assets.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const kind = reg.index.get("core:dodo")!;
const dodo = reg.defs[kind] as SpeciesDef;

/** A wild dodo of a level, its points all in health: torpor counts every wild level alike. */
function wild(level: number): Genome {
  const g = new Genome();
  g.wild[0] = level - 1;
  return g;
}

test("a dodo is ARK's at level 1: health 40, stamina 100, oxygen 150, food 450, weight 50, torpor 30, a peck of 5", () => {
  const stats = dodo.stats!;
  const names = ["health", "stamina", "oxygen", "food", "weight", "melee", "torpidity"] as const;
  expect(names.map((s) => stats[s]![0])).toEqual([40, 100, 150, 450, 50, 1, 30]);
  expect([reg.damage[kind], dodo.food!.max]).toEqual([5, 450]);
  // A wild level adds 8 health, 10 stamina, 15 oxygen, 45 food, 1 kilogram and 5% to its peck.
  const g = new Genome();
  g.wild.fill(1);
  const gain = (name: (typeof names)[number], stat: number): number => Math.round((statValue(stats[name]!, g, stat) - stats[name]![0]) * 1000) / 1000;
  expect([gain("health", 0), gain("stamina", 1), gain("oxygen", 2), gain("food", 3), gain("weight", 5), gain("melee", 6)]).toEqual([8, 10, 15, 45, 1, 0.05]);
  // Its head takes three times; fire three eighths and explosions three fifths, as every herbivore.
  expect([reg.zoneMul[kind]![1], reg.takes[kind]![3], reg.takes[kind]![4]]).toEqual([3, 0.375, Math.fround(0.6)]);
  expect(dodo.killXp).toBe(2);
});

test("it walks at 65 units a second, runs at 136.5 wild, and swims at 300", () => {
  const move = reg.move[kind]!;
  expect([move.walkSpeed, Math.round(move.walkSpeed * move.sprintMul * 1000) / 1000, move.swimSpeed]).toEqual([0.65, 1.365, 3]);
  // Its run is drawn as a run, and costs 4 stamina a second.
  expect(move.walkSpeed * move.sprintMul).toBeGreaterThan(reg.runAt[kind]!);
  expect(move.staminaSprint).toBe(Math.round((4 * STAMINA_UNITS) / TICK_RATE));
});

test("the wiki's taming table for a dodo on berries: pieces and time from level 1 to 150, and the narcoberries and narcotics it takes", () => {
  const p = dodo.taming!;
  const berry = dodo.eats!.find((f) => f.item === "core:berry")!;
  // Knocked out it loses two and a half food a second, so a berry goes down every eight seconds.
  expect(proneHunger(p)).toBeCloseTo(2.5, 6);
  const table = [1, 30, 60, 90, 120, 150].map((level) => {
    const pieces = piecesNeeded(p, level, berry.affinity, 1);
    const seconds = tameSeconds(p, pieces, berry.food);
    const g = wild(level);
    const most = torporMax(dodo, g);
    const drain = torporDrain(dodo, g);
    // A narcoberry is 7.5 over 3 seconds, a narcotic 40 over 8.
    return [level, pieces, seconds, narcoticsNeeded(most, drain, seconds, 7.5, 3), narcoticsNeeded(most, drain, seconds, 40, 8)];
  });
  expect(table).toEqual([
    [1, 6, 48, 0, 0],
    [30, 15, 120, 0, 0],
    [60, 23, 184, 0, 0],
    [90, 31, 248, 1, 1],
    [120, 40, 320, 5, 2],
    [150, 48, 384, 10, 3],
  ]);
});

test("its torpor and how fast it wears off: the wiki's rate a second, rounded up, and the time until all is gone", () => {
  const rows = [1, 30, 60, 90, 120, 150].map((level) => {
    const g = wild(level);
    const drain = torporDrain(dodo, g);
    return [Math.ceil(drain * 100 - 1e-9) / 100, Math.floor(torporMax(dodo, g) / drain)];
  });
  // 1:40, 2:44, 3:29, 4:01, 4:27 and 4:48.
  expect(rows).toEqual([
    [0.3, 100],
    [0.5, 164],
    [0.66, 209],
    [0.79, 241],
    [0.92, 267],
    [1.04, 288],
  ]);
  expect(torporMax(dodo, wild(150))).toBeCloseTo(298.2, 6);
});

test("an egg hatches in 2,999.76 seconds and the young grows up in 55,555.56, as ARK times it at 1x", () => {
  expect([reg.ids[reg.breedEgg[kind]!], reg.incubateTicks[kind], reg.matureTicks[kind]]).toEqual(["core:egg_dodo", Math.round(2999.76 * TICK_RATE), Math.round(55555.56 * TICK_RATE)]);
  expect(reg.matureTicks[kind]! / TICK_RATE / 3600).toBeCloseTo(15.43, 2);
});

test("its six colour regions go under ARK's names, each with colours of its own, and its asset draws the default bird", async () => {
  const set = reg.colorSet[kind]!;
  expect(dodo.regions!.map((r) => r?.name)).toEqual(["Body", "Face", "Beak", "Forehead, Neck and Feet", "Head", "Wings and Patterning"]);
  for (let r = 0; r < 6; r++) {
    const colours = Array.from(set.palette.subarray(set.start[r], set.start[r + 1]));
    expect(colours.length).toBeGreaterThan(5);
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours.every((c) => c > 0 && c < REGION_BASE)).toBe(true);
    expect(colours[0]).toBe(DODO_DYES[r]!);
  }
  const asset = (await findAssets()).find((a) => a.id === "core:dodo")!.spec as CreatureAsset;
  expect(asset.regions.map((r) => [r.name, r.sample])).toEqual(dodo.regions!.map((r, i) => [r!.name, DODO_DYES[i]!]));
});

test("the bird as modelled: its peck reaches as far as its beak does on the tick it lands, its head and the top of its neck are hit at three times, and it stands as tall as its body", () => {
  const pack = corePack();
  const rig = buildRigs(pack.header.rigs, pack.clips).get("core:dodo")!;
  const bite = dodo.bite!;
  // The attack is the peck, one peck long, and on the tick the bite lands the beak is at its furthest.
  const attack = rig.clips.get("attack");
  expect([attack?.frames, bite.ticks]).toEqual([15, 15]);
  const pose = new Pose(rig.bones);
  const tip = rig.sockets.get("beak_tip")!;
  const at = [0, 0, 0];
  const forward: number[] = [];
  for (let f = 0; f < attack!.frames; f++) {
    sampleClip(attack!, f, pose);
    solve(rig, pose, rig.solved);
    boneToModel(rig.solved, tip.bone, tip.x, tip.y, tip.z, at);
    forward.push(at[2]!);
    if (f === bite.lands) expect(Math.hypot(at[0]!, at[1]! - dodo.eyeHeight, at[2]!)).toBeCloseTo(bite.reach, 2);
  }
  expect(forward[bite.lands!]!).toBeGreaterThan(0.39);
  expect(forward[bite.lands!]!).toBeGreaterThanOrEqual(Math.max(...forward.slice(0, bite.lands! + 2)) - 1e-3);
  // The head's two capsules are the skull's and the top neck bone's, and content makes that zone three times.
  const head = [...rig.zone].flatMap((z, b) => (z === ZONE_HEAD ? [rig.names[b]] : []));
  expect([head, reg.zoneMul[kind]![ZONE_HEAD]]).toEqual([["neck_4", "skull"], 3]);
  // It is as tall as the model, and its body is no wider than its capsule.
  const mesh = pack.header.meshes[pack.meshIndex.get("core:dodo")!]!;
  expect(mesh.center[1] + mesh.half[1]).toBeCloseTo(dodo.height, 1);
  expect([dodo.mesh, dodo.skeleton, dodo.radius >= mesh.half[0]]).toEqual(["core:dodo", "dodo", true]);
});
