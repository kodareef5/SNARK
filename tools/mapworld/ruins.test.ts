import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";
import { Mason, tilesOf, worldPoint, type Frame } from "./ruin-geometry.ts";
import { stack, tower } from "./ruin-layouts.ts";
import { vocabulary, type Rule } from "./ruin-vocabulary.ts";
import { readSurvey, surveyInventory } from "./survey.ts";

const rule: Rule = { recipe: "tower", height: 24, finish: "concrete", feature: "frame", holes: .35, wall: .35, bay: 8, matched: [], provisional: true };
const frame = (degrees: number): Frame => ({ x: 128, z: 128, yaw: degrees, c: Math.cos(degrees * Math.PI / 180), s: Math.sin(degrees * Math.PI / 180), width: 40, depth: 40, rings: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]] });

test("every survey category has a recipe and the block library compiles", async () => {
  const v = vocabulary("assets/source/maps/miami");
  const schema = await Bun.file("assets/source/maps/miami/blocks/schema.json").json();
  for (const name of schema.properties.places.items.properties.category.enum as string[]) expect(v.recipes[v.categories[name]!]).toBeDefined();
  expect(flatWorld().reg.index.has("core:zruin_step_concrete")).toBe(true);
});

test("tiles leave even small courtyard holes empty", () => {
  const f = frame(0);
  f.rings.push([[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]);
  const tiles = tilesOf(f, 8);
  expect(tiles.some((t) => Math.abs(t.u) < 4 && Math.abs(t.v) < 4)).toBe(false);
  expect(tiles.length).toBe(24);
});

test("survivor climbs every flight, turns on landings and exits onto the deck at several yaws", () => {
  for (const yaw of [0, 17, 90, 157]) for (const seed of [19, 88]) {
    const f = frame(yaw); const m = new Mason(f, 0);
    stack(m, tilesOf(f, 8), 8, 24, rule, { seed, playable: 6, detail: 0 });
    const w = flatWorld(4);
    for (const p of m.pieces) w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1);
    const b = new Body(); const start = worldPoint(f, -1.5, -3.2);
    b.x = start[0]; b.z = start[1]; b.y = 0; b.grounded = true;
    const params = w.reg.move[w.kind("core:survivor")]!;
    const go = (u: number, v: number): void => {
      const [x, z] = worldPoint(f, u, v);
      for (let tick = 0; tick < 400 && Math.hypot(b.x - x, b.z - z) > .13; tick++) {
        const angle = Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (2 * Math.PI)) & 65535;
        stepBody(w, b, 0, 90, angle, 0, 0, params, TICK_DT);
      }
      expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(.2);
    };
    for (let level = 0; level < 6; level++) {
      const dir = level % 2 === 0 ? 1 : -1;
      const x = level % 2 === 0 ? -1.5 : 1.5;
      go(x, dir * 3.25);
      expect(b.y).toBeCloseTo((level + 1) * 4, 1);
      go(-x, dir * 3.25);
    }
    go(1.5, -5.5);
    expect(b.y).toBeCloseTo(24, 1);
  }
});

test("a tower podium does not cap the shaft stair, and identical seeds emit identical pieces", () => {
  const f = frame(12); f.width = 80; f.depth = 80; f.rings = [[[-40, -40], [40, -40], [40, 40], [-40, 40], [-40, -40]]];
  const a = new Mason(f, 0); const b = new Mason(f, 0);
  tower(a, tilesOf(f, 8), rule, { seed: 3, playable: 6, detail: 0 });
  tower(b, tilesOf(f, 8), rule, { seed: 3, playable: 6, detail: 0 });
  expect(a.pieces).toEqual(b.pieces);
  const core = a.routes[a.routes.length - 1]!;
  expect(a.pieces.some((p) => p.kind.includes("floor8") && p.y > core.y && Math.hypot(p.x - core.x, p.z - core.z) < 1)).toBe(false);
});

test("an absent or partly written survey is usable and diagnosed", () => {
  const folder = mkdtempSync(join(tmpdir(), "snark-ruins-survey-"));
  try {
    expect(readSurvey(folder).squares.size).toBe(0);
    writeFileSync(join(folder, "cells.json"), JSON.stringify([{ id: "r00c00", largest: [] }, { id: "r00c01", largest: [] }]));
    mkdirSync(join(folder, "out"));
    writeFileSync(join(folder, "out/r00c00.json"), '{"survey":');
    const data = readSurvey(folder);
    expect(data.warnings.length).toBe(1);
    expect(surveyInventory(data).pending).toEqual(["r00c00", "r00c01"]);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("direct measured height wins over levels and research, missing values use only original neighbours", async () => {
  const { resolveLabels } = await import("./labels.ts");
  const { ruleFor } = await import("./ruin-vocabulary.ts");
  const v = vocabulary("assets/source/maps/miami");
  const label = { name: null, also: [], kind: "hotel", height_m: 12, height_from: "osm", levels: 50, address: null, use: "", primary_use: "", uses: {}, area_m2: 500, e: 0, n: 0 };
  const fake = (id: number) => ({ building: { id: id * 4, area: 500 }, district: { name: "South Beach", style: "deco" } }) as import("./statics.ts").Footprint;
  const data: import("./labels.ts").LabelData = { labels: { 1: label, 2: { ...label, kind: null, height_m: null, height_from: null, levels: null, e: 50 } }, places: [], research: new Map(), researchFrom: new Map(), enrichment: [], fingerprint: "test" };
  const fs = resolveLabels(new Map([[1, fake(1)], [2, fake(2)]]), data, v);
  expect(fs.get(1)!.height).toBe(12);
  expect(fs.get(2)!.height).toBe(12);
  expect(fs.get(2)!.kindFrom).toBe("neighbours");
  expect(fs.get(2)!.heightFrom).toBe("neighbours");
  expect(ruleFor(fake(1), v, fs.get(1)!).height).toBeLessThanOrEqual(12);
  expect([...resolveLabels(new Map([[2, fake(2)], [1, fake(1)]]), data, v)]).toEqual([...fs]);
});

test("direct label names are the only legacy survey match key", async () => {
  const { readLabels } = await import("./labels.ts");
  const data = readLabels("assets/source/maps/miami");
  for (const m of data.enrichment.filter((m) => m.status === "name matched")) {
    const l = data.labels[m.ids[0]!]!;
    const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    expect([l.name, ...l.also].filter((s) => s !== null).map(normalize)).toContain(normalize(m.name));
  }
  expect(data.labels[26221546]!.height_m).toBe(265);
  expect(data.labels[27554969]!.name).toBe("SLS South Beach");
});

test("a Deco treatment cannot turn a labelled low hotel into a speculative tower", async () => {
  const { layout } = await import("./ruin-layouts.ts");
  const { RUIN_SHAPES } = await import("../../content/miami-ruins.ts");
  for (const height of [4, 8, 12]) {
    const m = new Mason(frame(0), 0);
    layout(m, { ...rule, recipe: "hotel", feature: "deco", height }, { seed: 45, playable: 3, detail: 0 });
    const top = Math.max(...m.pieces.map((p) => p.y + RUIN_SHAPES[p.kind.split("_")[1] as keyof typeof RUIN_SHAPES][1] / 2));
    expect(top).toBeLessThanOrEqual(height + .2);
  }
});

test("a low roof reserves body clearance under a viaduct", async () => {
  const { bridgeHoles } = await import("./bridges.ts");
  const f = frame(0);
  const clipped = bridgeHoles(f, [{ a: [100, 128], b: [156, 128], width: 4, low: 8, high: 11 }], 3.5, 4);
  expect(clipped.rings.length).toBe(2);
  expect(tilesOf(clipped, 8).every((t) => Math.abs(t.v) >= 8)).toBe(true);
});

test("a compound has separate heights, cores and exits while staying in its footprint", async () => {
  const { layout } = await import("./ruin-layouts.ts");
  const f = frame(17); f.width = 200; f.depth = 200; f.rings = [[[-100, -100], [100, -100], [100, 100], [-100, 100]]];
  const m = new Mason(f, .5);
  layout(m, { ...rule, recipe: "shop", bay: 4, height: 16 }, { seed: 31, playable: 4, detail: 0 });
  expect(m.wings.length).toBeGreaterThan(4);
  expect(new Set(m.wings.map((w) => w.height)).size).toBe(3);
  expect(m.routes.length).toBeGreaterThan(4);
  expect(m.entries.length).toBeGreaterThan(8);
  expect(m.escapes.length).toBeGreaterThan(4);
});

test("mapped water on both sides removes a wide earth bridge bank but keeps its approaches", async () => {
  const { cutBridgeWater } = await import("./ways.ts");
  const n = 101; const height = new Float32Array(n * n).fill(2); const water = new Uint8Array(n * n);
  for (let row = 5; row < 96; row++) for (let col = 0; col < n; col++) if (row < 35 || row > 65) water[row * n + col] = 1;
  const way: import("./ways.ts").Way = { id: 1, kind: "road_bridge", name: null, class: "primary", lanes: 2, layer: 1, width_m: null, closed: false, length_m: 80, points: [] };
  expect(cutBridgeWater([{ way, points: [[60, 100], [140, 100]], width: 12, outline: false }], height, water, n)).toBeGreaterThan(100);
  expect(height[50 * n + 50]).toBe(-3);
  expect(water[50 * n + 50]).toBe(1);
  expect(height[50 * n + 10]).toBe(2);
});
