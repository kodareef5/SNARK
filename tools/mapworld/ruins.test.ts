import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShapeDef, StructureDef } from "../../shared/content/defs.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { flatWorld } from "../../tests/fixtures/world.ts";
import { gridAt } from "./base.ts";
import { Mason, tilesOf, worldPoint, type Frame } from "./ruin-geometry.ts";
import { layout, stack, tower } from "./ruin-layouts.ts";
import { extendRules, vocabulary, type Rule } from "./ruin-vocabulary.ts";
import { readSurvey, surveyInventory } from "./survey.ts";
import { BREAK_AT, RUIN_BLOCKS, RUIN_BREAKS, RUIN_SHAPES } from "../../content/ruins.ts";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { WRECK_KINDS } from "../../content/vehicles/wrecks.ts";
import { extentOf, meets, type Box } from "./ruin-obstacles.ts";
import { carPicker } from "./street-cars.ts";
import { CityStatics, boxPart, cellPart } from "../../shared/world/city.ts";
import { chunkAt } from "../../shared/coords.ts";

// A city made on this machine (tools/maps/city.ts), the first by name: its work folder holds the vocabulary and survey.
const source = process.env.MAPWORLD_TEST_SOURCE ?? (existsSync("var/mapdata") ? readdirSync("var/mapdata").sort() : []).map((name) => `var/mapdata/${name}/current`).find((path) => existsSync(`${path}/ruins/vocabulary.json`))!;
const rule: Rule = { recipe: "tower", height: 24, finish: "concrete", feature: "frame", holes: .35, wall: .35, bay: 8, matched: [], provisional: true };
const frame = (degrees: number): Frame => ({ x: 128, z: 128, yaw: degrees, c: Math.cos(degrees * Math.PI / 180), s: Math.sin(degrees * Math.PI / 180), width: 40, depth: 40, rings: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]] });

test("a thin far fin takes the cell it mostly covers, not its last sliver", () => {
  const w = flatWorld(4);
  const city = new CityStatics(w.dims, [
    { kind: "core:zruin_zcore_concrete", x: 96, y: 20, z: 96, yaw: 0 },
    { kind: "core:zruin_fin4_concrete", x: 97.9, y: 20, z: 96, yaw: 0 },
  ], w.reg);
  expect(cellPart(city, 5, w.hf, null, 4, 4).faces).toBe(6);
});

test("every survey category has a recipe and the block library compiles", async () => {
  const v = vocabulary(source);
  for (const recipe of Object.values(v.categories)) expect(v.recipes[recipe]).toBeDefined();
  expect(flatWorld().reg.index.has("core:zruin_step_concrete")).toBe(true);
});

test("city rules inherit defaults, override ids in order and can disable one id", () => {
  const base = { forms: { house: { roof: "hip", front: "porch" } }, choices: [{ id: "a", when: { kind: ["house"] }, form: "house" }, { id: "b", form: "office" }] };
  expect(extendRules(base, { forms: { house: { front: "arcade" } }, choices: [{ id: "a", form: "shop" }, { id: "b", enabled: false }, { id: "c", form: "hall" }] })).toEqual({ forms: { house: { roof: "hip", front: "arcade" } }, choices: [{ id: "a", when: { kind: ["house"] }, form: "shop" }, { id: "c", form: "hall" }] });
  expect(base.forms.house.front).toBe("porch");
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

test("a sixteen-floor refuge's independent stair exit is walked in both directions", () => {
  const f = frame(17); const m = new Mason(f, 0); const tiles = tilesOf(f, 8);
  const core = tiles.find((t) => t.u === 0 && t.v === 0)!; const exit = tiles.find((t) => t.u === 8 && t.v === 0)!;
  m.stairs(core, 16); m.stairExit(exit, 16, core);
  m.floor([0, -8], 64, 8); m.floor([8, -8], 64, 8);
  const w = flatWorld(4);
  for (const p of m.pieces) w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1);
  const params = w.reg.move[w.kind("core:survivor")]!;
  for (const points of [m.escapes[0]!.points, [...m.escapes[0]!.points].reverse()]) {
    const b = new Body(); Object.assign(b, points[0]); b.y += .2;
    for (let tick = 0; tick < 60; tick++) stepBody(w, b, 0, 0, 0, 0, 0, params, TICK_DT);
    for (const p of points.slice(1)) {
      for (let tick = 0; tick < 220 && Math.hypot(b.x - p.x, b.z - p.z) > .15; tick++) {
        const yaw = Math.round(Math.atan2(p.x - b.x, p.z - b.z) * 65536 / (Math.PI * 2)) & 65535;
        stepBody(w, b, 0, 90, yaw, 0, 0, params, TICK_DT);
      }
      for (let tick = 0; tick < 16; tick++) stepBody(w, b, 0, 0, 0, 0, 0, params, TICK_DT);
      expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeLessThan(.25);
      expect(Math.abs(b.y - p.y)).toBeLessThan(.15);
    }
  }
  expect(m.pieces.filter((p) => p.kind.includes("_flight_")).length).toBe(32);
});

test("pitched roofs on a four-metre house grid fit their tile groups", () => {
  const f = frame(0); f.width = f.depth = 16; f.rings = [[[-8, -8], [8, -8], [8, 8], [-8, 8], [-8, -8]]];
  const m = new Mason(f, 0);
  stack(m, tilesOf(f, 4), 4, 4, { ...rule, form: vocabulary(source).forms.house! }, { seed: 11, playable: 1, detail: 0 });
  const roofs = m.pieces.filter((p) => p.kind.includes("_zpitch")); expect(roofs.length).toBeGreaterThan(0);
  for (const p of roofs) {
    const shape = RUIN_SHAPES[p.kind.split("_")[1] as keyof typeof RUIN_SHAPES];
    expect(Math.abs(p.x - f.x) + shape[0] / 2).toBeLessThanOrEqual(8);
    expect(Math.abs(p.z - f.z) + shape[2] / 2).toBeLessThanOrEqual(8);
  }
});

test("the dropped floor palette is climbable, and the steep fallen frame slides a survivor", () => {
  for (const [shape, degrees, halfRun] of [["plate15", 15, 4], ["plate30", 30, 4], ["plate4", 24, 2]] as const) {
    const f = frame(157); const m = new Mason(f, 0); const size = RUIN_SHAPES[shape];
    m.put(shape, 0, size[1] / 2, 0);
    const w = flatWorld(4); const p = m.pieces[0]!;
    w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1);
    const params = w.reg.move[w.kind("core:survivor")]!; const b = new Body();
    [b.x, b.z] = m.point(0, -size[2] / 2 - 1); b.y = 0; b.grounded = true;
    const go = (v: number): void => {
      const [x, z] = m.point(0, v);
      for (let tick = 0; tick < 300 && Math.hypot(b.x - x, b.z - z) > .15; tick++) {
        const yaw = Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (2 * Math.PI)) & 65535;
        stepBody(w, b, 0, 90, yaw, 0, 0, params, TICK_DT);
      }
      for (let tick = 0; tick < 30; tick++) stepBody(w, b, 0, 0, 0, 0, 0, params, TICK_DT);
      expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(.25);
    };
    go(size[2] / 2 - .6);
    expect(b.y).toBeGreaterThan(2 * halfRun * Math.sin(degrees * Math.PI / 180) - .6);
    go(-size[2] / 2 - 1);
    expect(b.y).toBeCloseTo(0, 1);
  }
  const w = flatWorld(4); const top = RUIN_SHAPES.front60[1] / 2;
  w.structs.add(w.kind("core:zruin_front60_concrete"), 128, top, 128, 0, 0, 1);
  const b = new Body(); b.x = 131.5; b.y = top + 1.5; b.z = 128;
  for (let tick = 0; tick < 120; tick++) stepBody(w, b, 0, 0, 0, 0, 0, w.reg.move[w.kind("core:survivor")]!, TICK_DT);
  expect(b.z).toBeLessThan(127);
  expect(b.y).toBeLessThan(1);
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
  const v = vocabulary(source);
  const label = { name: null, also: [], kind: "hotel", height_m: 12, height_from: "osm", levels: 50, address: null, use: "", primary_use: "", uses: {}, area_m2: 500, e: 0, n: 0 };
  const fake = (id: number) => ({ building: { id: id * 4, area: 500 }, district: { name: "Test Coast", style: "deco" } }) as import("./statics.ts").Footprint;
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
  const data = readLabels(source);
  for (const m of data.enrichment.filter((m) => m.status === "name matched")) {
    const l = data.labels[m.ids[0]!]!;
    const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    expect([l.name, ...l.also].filter((s) => s !== null).map(normalize)).toContain(normalize(m.name));
  }
  expect(Object.values(data.labels).some((l) => !!l.height_m && !!l.name)).toBe(true);
});

test("a Deco treatment cannot turn a labelled low hotel into a speculative tower", async () => {
  const { layout } = await import("./ruin-layouts.ts");
  const { RUIN_SHAPES } = await import("../../content/ruins.ts");
  for (const height of [4, 8, 12]) {
    const m = new Mason(frame(0), 0);
    layout(m, { ...rule, recipe: "hotel", feature: "deco", height }, { seed: 45, playable: 3, detail: 0 });
    const top = Math.max(...m.pieces.map((p) => p.y + RUIN_SHAPES[p.kind.split("_")[1] as keyof typeof RUIN_SHAPES][1] / 2));
    // What is left of a broken parapet, its bars, may stand over the roof; no storey does.
    expect(top).toBeLessThanOrEqual(height + 1.5);
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
  const grid = gridAt([-100, -100, 100, 100]);
  expect(cutBridgeWater([{ way, points: [[60, 100], [140, 100]], width: 12, outline: false }], height, water, grid)).toBeGreaterThan(100);
  expect(height[50 * n + 50]).toBe(-3);
  expect(water[50 * n + 50]).toBe(1);
  expect(height[50 * n + 10]).toBe(2);
});

test("a slanting bridge's cut channel leaves no spike of land standing in it", async () => {
  const { cutBridgeWater } = await import("./ways.ts");
  const n = 101; const height = new Float32Array(n * n).fill(2.5); const water = new Uint8Array(n * n);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (row < 30 || row > 70) water[row * n + col] = 1;
  const way: import("./ways.ts").Way = { id: 1, kind: "road_bridge", name: null, class: "primary", lanes: 2, layer: 1, width_m: null, closed: false, length_m: 110, points: [] };
  cutBridgeWater([{ way, points: [[55, 55], [145, 145]], width: 12, outline: false }], height, water, gridAt([-100, -100, 100, 100]));
  let spikes = 0;
  for (let row = 1; row < n - 1; row++) for (let col = 1; col < n - 1; col++) {
    const i = row * n + col;
    if (height[i]! <= 0) continue;
    const low = [i - 1, i + 1, i - n, i + n, i - n - 1, i - n + 1, i + n - 1, i + n + 1].filter((j) => height[j]! <= -3).length;
    if (low >= 6) spikes++;
  }
  expect(spikes).toBe(0);
});

test("every assembly refers to an available box and every choice resolves a form and damage rule", () => {
  const v = vocabulary(source); const reg = flatWorld().reg;
  // A car part names a family of street.cars.looks, and every look a family names has kinds the content has.
  const looks = v.street.cars.looks;
  for (const a of Object.values(v.assemblies)) for (const [shape, x, y, z, finish, yaw] of a.parts) {
    if (shape === "car") expect(looks[finish]?.length).toBeGreaterThan(0);
    else expect(reg.index.has(`core:zruin_${shape}_${finish === "finish" ? "concrete" : finish}`)).toBe(true);
    expect([x, y, z, yaw ?? 0].every(Number.isFinite)).toBe(true);
  }
  for (const rows of Object.values(looks)) for (const [look] of rows) expect(WRECK_KINDS[look]?.every((k) => reg.index.has(k))).toBe(true);
  for (const c of v.choices) {
    if (c.form) expect(v.forms[c.form]).toBeDefined();
    for (const mode of c.collapse ?? []) expect(v.damage[mode]).toBeDefined();
  }
});

test("a wreck stands on its origin, cars nose to tail meet only when closer than their length, and a place's car is the same every time", () => {
  for (const kinds of Object.values(WRECK_KINDS)) for (const kind of kinds) { const e = extentOf(kind); expect(e.at[1] - e.size[1] / 2).toBeCloseTo(0); }
  const car = (z: number, yaw: number): Box => ({ x: 0, y: .75, z, yaw, size: [1.84, 1.5, 4] });
  expect(meets(car(0, 0), car(4.1, 0))).toBe(false);
  expect(meets(car(0, 0), car(3.9, 0))).toBe(true);
  expect(meets(car(0, 30), { x: 1.5, y: .75, z: 1.2, yaw: 30, size: [1.84, 1.5, 4] })).toBe(true);
  const v = vocabulary(source); const pick = carPicker(v.street.cars, v.seed);
  const places = Array.from({ length: 400 }, (_, i) => [100 + i * 7.3, 200 + i * 3.1] as const);
  const kinds = places.map(([x, z]) => pick(x, z, "upright"));
  expect(places.map(([x, z]) => pick(x, z, "upright"))).toEqual(kinds);
  const allowed = new Set([...v.street.cars.looks.upright!, ...v.street.cars.looks.fire!].flatMap(([look]) => WRECK_KINDS[look]!));
  expect(kinds.every((k) => allowed.has(k))).toBe(true);
  expect(new Set(kinds).size).toBeGreaterThan(12);
});

test("a neighbouring facade yields to a room route while its floor and stair support survive", async () => {
  const { clearCirculation } = await import("./ruin-clearance.ts");
  const pieces = [
    { kind: "core:zruin_zpanel8_concrete", x: 128, y: 2, z: 128, yaw: 0 },
    { kind: "core:zruin_floor8_concrete", x: 128, y: -.2, z: 128, yaw: 0 },
    { kind: "core:zruin_step_concrete", x: 128, y: .2, z: 128, yaw: 0 },
  ];
  const records = [{ firstPiece: 0, blocks: 3, approaches: [], escapes: [], routes: [], rooms: [{ kind: "rooms", points: [{ x: 128, y: 0, z: 124 }, { x: 128, y: 0, z: 132 }] }] }] as unknown as import("./ruins.ts").RuinRecord[];
  expect(clearCirculation(pieces, records, 0)).toEqual({ "core:zruin_zpanel8_concrete": 1 });
  expect(pieces.map((p) => p.kind)).toEqual(["core:zruin_floor8_concrete", "core:zruin_step_concrete"]);
  expect(records[0]!.blocks).toBe(2);
});

test("wide school and ward plans leave courts, have several entrances, and reproduce exactly", async () => {
  const { layout } = await import("./ruin-layouts.ts"); const v = vocabulary(source);
  for (const form of ["school", "hospital"]) {
    const f = frame(23); f.width = 64; f.depth = 48; f.rings = [[[-32, -24], [32, -24], [32, 24], [-32, 24]]];
    const a = new Mason(f, 0); const b = new Mason(f, 0);
    const r = { ...rule, recipe: form, height: 12, form: v.forms[form], assemblies: v.assemblies };
    layout(a, r, { seed: 17, playable: 3, detail: 0 }); layout(b, r, { seed: 17, playable: 3, detail: 0 });
    expect(a.pieces).toEqual(b.pieces); expect(a.wings.length).toBe(3);
    expect(a.entries.length).toBeGreaterThanOrEqual(4);
    expect(a.wings.reduce((n, w) => n + w.tiles, 0)).toBeLessThan(48);
  }
});

test("large ward campuses keep their footprint fabric instead of selecting only bounding-box edges", async () => {
  const { layout } = await import("./ruin-layouts.ts"); const v = vocabulary(source);
  const f = frame(0); f.width = 200; f.depth = 200; f.rings = [[[-100, -100], [100, -100], [100, 100], [-100, 100]]];
  const m = new Mason(f, 0);
  layout(m, { ...rule, recipe: "hospital", height: 12, form: v.forms.hospital }, { seed: 51, playable: 3, detail: 0 });
  expect(m.wings.reduce((n, w) => n + w.tiles, 0)).toBeGreaterThan(tilesOf(f, 8).length * .75);
  expect(m.routes.length).toBeGreaterThan(4);
});

test("a crowded tower fallback keeps a reachable stump when its footprint centre is empty", () => {
  const f = frame(0); f.width = 160; f.depth = 48; f.rings = [[[-80, -24], [-24, -24], [-24, 24], [-80, 24]]];
  const m = new Mason(f, 0); const tiles = tilesOf(f, 8);
  tower(m, tiles, { ...rule, height: 8 }, { seed: 17, playable: 1, detail: 3 });
  expect(m.routes.length).toBe(2);
  expect(m.entries.length).toBe(2);
  expect(m.pieces.length).toBeLessThan(150);
  expect(m.routes[0]!.x).toBeLessThan(104);
});

test("a facade module is walked as its few boxes and drawn with its parts in their own colours", () => {
  const w = flatWorld(4);
  const kind = w.kind("core:zruin_zbalc_limestone");
  // Its balcony's slab, front and two end returns, and the wall behind.
  expect(w.reg.parts.start[kind + 1]! - w.reg.parts.start[kind]!).toBe(5);
  const city = new CityStatics(w.dims, [{ kind: "core:zruin_zbalc_limestone", x: 96, y: 4, z: 96, yaw: 0 }], w.reg);
  const colours = new Set(boxPart(city, chunkAt(w.dims, 96, 96), w.hf, () => null).color);
  // The building's limestone and its darker soffits, the coral wall behind the balconies, its dark openings and the
  // balconies' pale fronts.
  expect([...colours].sort((a, b) => a - b)).toEqual([10, 83, 101, 104, 113]);
});

test("a roof's shrub stands on what it grows from: its plant's foot at its origin, on the planter's top or the roof", () => {
  // The plant is the creeper's, whose foot is at its origin as a node's on the ground is, its roots a little below.
  const plants = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/nodes/plants/plants.snpk", import.meta.url))));
  const creeper = plants.header.meshes.find((m) => m.id === "core:creeper_3")!;
  const foot = creeper.center[1] - creeper.half[1];
  expect([foot > -0.3, foot <= 0.05]).toEqual([true, true]);
  // So the kind is drawn at its shape's origin with its box standing on it.
  const kind = RUIN_BLOCKS.find((d) => d.id === "core:zruin_zshrub_concrete") as StructureDef;
  const shape = RUIN_BLOCKS.find((d) => d.type === "shape" && d.id === kind.shape) as ShapeDef;
  expect([kind.mesh, shape.boxes.map((b) => b.at[1] - b.half[1])]).toEqual(["core:creeper_3", [0]]);
  // And a roof's garden sets it down at its foot, on its planter's top or on the roof beside it, as a broken roof's tuft
  // is on that roof: at a storey's height.
  const v = vocabulary(source);
  let shrubs = 0;
  for (let seed = 0; seed < 40; seed++) {
    const m = new Mason(frame(0), 0);
    layout(m, { ...rule, recipe: "shop", height: 8, finish: "limestone", form: v.forms.shop, formName: "shop", roofGrowth: 1 }, { seed, playable: 8, detail: 0 });
    const covers = m.pieces.filter((p) => p.kind.includes("_zcover_"));
    for (const p of m.pieces.filter((q) => q.kind.includes("_zshrub_"))) {
      shrubs++;
      expect([p.y, covers.some((c) => Math.abs(c.y + 0.55 - p.y) < 1e-6) || Math.abs(p.y / 4 - Math.round(p.y / 4)) < 1e-6]).toEqual([p.y, true]);
    }
  }
  expect(shrubs).toBeGreaterThan(0);
});

test("a hanging slab hangs from its bay's roof, which a tower's top may have brought lower", () => {
  const v = vocabulary(source);
  const f: Frame = { ...frame(0), width: 48, depth: 40, rings: [[[-24, -20], [24, -20], [24, 20], [-24, 20], [-24, -20]]] };
  let plates = 0;
  for (const [form, height] of [["apartment", 156], ["office", 64]] as const) {
    for (let seed = 0; seed < 12; seed++) {
      const m = new Mason(f, 0);
      layout(m, { ...rule, recipe: "tower", height, finish: "concrete", form: v.forms[form], formName: form, collapse: "hanging", damage: v.damage.hanging, assemblies: v.assemblies, interiors: v.interiors }, { seed, playable: 16, detail: 0 });
      const hung = m.pieces.filter((p) => p.kind.includes("_plate30_"));
      const walls = m.pieces.filter((p) => !p.kind.includes("_plate30_") && !p.kind.includes("_zcore_"));
      for (const p of hung) {
        plates++;
        const top = p.y + RUIN_SHAPES.plate30[1] / 2;
        // Its top at a storey's height, and its bay's roof there with it.
        expect([seed, Math.abs(top / 4 - Math.round(top / 4)) < 1e-6, walls.some((w) => Math.abs(w.x - p.x) < 12 && Math.abs(w.z - p.z) < 12 && w.y > top - 4 && w.y < top + 1)]).toEqual([seed, true, true]);
      }
    }
  }
  expect(plates).toBeGreaterThan(0);
});

test("moss lies only along a parapet's coping, never over a broken wall's slab ends or a party wall", () => {
  const v = vocabulary(source);
  const f: Frame = { ...frame(0), width: 48, depth: 24, rings: [[[-24, -12], [24, -12], [24, 12], [-24, 12], [-24, -12]]] };
  const shape = (p: { kind: string }): string => p.kind.split("_")[1]!;
  const coping = new Set(["zwintop", "zwin4top", "zplanttop", "zparapet8"]);
  let moss = 0;
  for (const [recipe, height, form] of [["apartment", 24, "apartment"], ["office", 12, "office"], ["shop", 4, "shop"]] as const) {
    for (const collapse of ["shear", "facade", "pancake"] as const) {
      for (const seed of [1, 7, 19, 33]) {
        const m = new Mason(f, 0);
        layout(m, { ...rule, recipe, height, finish: "limestone", form: v.forms[form], formName: form, collapse, damage: v.damage[collapse], assemblies: v.assemblies, interiors: v.interiors }, { seed, playable: 8, detail: 0 });
        for (const p of m.pieces.filter((q) => shape(q) === "zmoss")) {
          moss++;
          const under = m.pieces.filter((q) => coping.has(shape(q)) && Math.hypot(q.x - p.x, q.z - p.z) < 0.6 && q.y < p.y && p.y - q.y < 13);
          expect({ at: [p.x, p.y, p.z], under: under.length > 0 }).toEqual({ at: [p.x, p.y, p.z], under: true });
        }
      }
    }
  }
  expect(moss).toBeGreaterThan(0);
});

test("a block of flats repeats its balcony bay on every whole floor, with a different ground floor, blank ends and a capped top", () => {
  const v = vocabulary(source);
  const f: Frame = { ...frame(0), width: 48, depth: 24, rings: [[[-24, -12], [24, -12], [24, 12], [-24, 12], [-24, -12]]] };
  const shape = (p: { kind: string }): string => p.kind.split("_")[1]!;
  for (const seed of [3, 41]) {
    const m = new Mason(f, 0);
    layout(m, { ...rule, recipe: "apartment", height: 24, finish: "limestone", form: v.forms.apartment, formName: "apartment", collapse: "shear", damage: v.damage.shear, assemblies: v.assemblies, interiors: v.interiors }, { seed, playable: 8, detail: 0 });
    const on = (name: string): { y: number }[] => m.pieces.filter((p) => shape(p) === name);
    // Six storeys, the front and back six bays long, a corner failed: the same bay on the four floors between ground and
    // top, all but the bays beside the failure whole on each. There, the bay next to the gap is stripped to its columns
    // and the one beyond is bare of its balcony, each with its slab's end tipped into the gap.
    const floors = new Map<number, number>();
    // A sagging slab's end on the fronts, which hangs below its floor, so it is counted a metre up.
    const sags = m.pieces.filter((p) => shape(p) === "zendsag" && Math.abs(p.z - f.z) > 12).map((p) => ({ y: p.y + 1 }));
    for (const p of [...on("zbalc"), ...on("zbalcrail"), ...sags].filter((p) => p.y < 20)) floors.set(Math.floor(p.y / 4), (floors.get(Math.floor(p.y / 4)) ?? 0) + 1);
    expect([...floors.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect([...floors.values()].every((n) => n === 11)).toBe(true);
    expect(on("zbalcbare").length).toBeGreaterThan(0);
    expect(sags.length).toBeGreaterThan(on("zbalcbare").length);
    // Over the stripped bay a fallen balcony's slab hangs from the highest of its storeys, in one front of two.
    if (seed === 3) expect(on("zdrape").length).toBeGreaterThan(0);
    expect(on("zlobby").length).toBeGreaterThanOrEqual(8);
    // The top floor's balconies are roofed, but where a stretch of the parapet fell, which leaves its broken stub, as it
    // does beside the failure.
    const chipped = [...on("zbalc"), ...on("zbalcrail"), ...on("zbalcbare")].filter((p) => p.y > 20).length;
    const stripped = sags.filter((p) => p.y > 20).length - on("zbalcbare").filter((p) => p.y > 20).length;
    expect(on("zbalctop").length + chipped + stripped).toBe(11);
    expect(on("zbalctop").every((p) => p.y > 20)).toBe(true);
    expect(on("zcrown5").length + on("zcrown6").length).toBeGreaterThanOrEqual(chipped);
    // The short ends are blank, their top storey under a parapet; no loose balcony of the old kit is left.
    expect(on("zpaneltop").length + on("zcrown5").length + on("zcrown6").length).toBeGreaterThanOrEqual(4);
    expect(on("zbalcony")).toEqual([]);
  }
});

test("a failed corner is traced: slab ends at each floor beside it, and one column's broken head over the slab it held", () => {
  const v = vocabulary(source);
  const reg = flatWorld().reg;
  const f: Frame = { ...frame(0), width: 48, depth: 24, rings: [[[-24, -12], [24, -12], [24, 12], [-24, 12], [-24, -12]]] };
  for (const collapse of ["shear", "pancake", "facade"]) {
    const m = new Mason(f, 0);
    layout(m, { ...rule, recipe: "apartment", height: 24, finish: "limestone", form: v.forms.apartment, formName: "apartment", collapse, damage: v.damage[collapse], assemblies: v.assemblies, interiors: v.interiors }, { seed: 3, playable: 8, detail: 0 });
    const shapes = m.pieces.map((p) => p.kind.split("_")[1]!);
    expect(m.pieces.filter((p) => !reg.index.has(p.kind))).toEqual([]);
    expect(shapes.filter((s) => s.startsWith("zend")).length).toBeGreaterThan(2);
    expect(shapes.filter((s) => s === "zstub").length).toBe(1);
    expect(shapes.filter((s) => s === "zfallen").length).toBe(1);
  }
  // The head's teeth and the fallen slab's are one break: the same widths in the same order, the slab four times as wide.
  const across = (shape: { look?: { hulls?: readonly { corners: readonly (readonly number[])[] }[] } }, from: number): number[] => shape.look!.hulls!.slice(from).map((h) => Math.max(...h.corners.map((c) => c[0]!)) - Math.min(...h.corners.map((c) => c[0]!)));
  expect(across(RUIN_BREAKS.zfallen, 1).map((w) => Math.round(w * 100))).toEqual(across(RUIN_BREAKS.zstub, 0).map((w) => Math.round(w * 400)));
});

test("a survivor and the heaviest walkers go up and down a garage's ramp and a fallen slab, and back", () => {
  for (const [shape, finish, rise] of [["zdeckramp", "concrete", 2], ["zfallen", "concrete", 1.5]] as const) {
    for (const walker of ["core:survivor", "core:trike", "core:stego"]) {
      const f = frame(157); const m = new Mason(f, 0); const size = RUIN_SHAPES[shape];
      m.put(shape, 0, size[1] / 2, 0, finish);
      const w = flatWorld(4); const p = m.pieces[0]!;
      w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1);
      const params = w.reg.move[w.kind(walker)]!; const b = new Body();
      [b.x, b.z] = m.point(0, -size[2] / 2 - 2); b.y = 0; b.grounded = true;
      const go = (v: number): void => {
        const [x, z] = m.point(0, v);
        for (let tick = 0; tick < 400 && Math.hypot(b.x - x, b.z - z) > .3; tick++) stepBody(w, b, 0, 90, Math.round(Math.atan2(x - b.x, z - b.z) * 65536 / (2 * Math.PI)) & 65535, 0, 0, params, TICK_DT);
        for (let tick = 0; tick < 30; tick++) stepBody(w, b, 0, 0, 0, 0, 0, params, TICK_DT);
      };
      go(size[2] / 2 - 1.2);
      expect([walker, shape, b.y > rise - .6]).toEqual([walker, shape, true]);
      go(-size[2] / 2 - 2);
      expect([walker, shape, Math.abs(b.y) < .1]).toEqual([walker, shape, true]);
    }
  }
});

test("a street's walk is a step a body and a mount climb, and a car crosses its curb straight and slantwise", () => {
  // A walk with its gutter across the way at z = 100, its curb's face on the line and the walk beyond it.
  const lay = (): ReturnType<typeof flatWorld> => {
    const w = flatWorld(4); const at = BREAK_AT.zwalk8g!;
    for (const x of [96, 104, 112]) w.structs.add(w.kind("core:zruin_zwalk8g_concrete"), x, at[1]!, 100 + at[2]!, 0, 0, 1);
    return w;
  };
  for (const walker of ["core:survivor", "core:trike", "core:raptor"]) {
    const w = lay(); const params = w.reg.move[w.kind(walker)]!; const b = new Body();
    [b.x, b.z, b.y, b.grounded] = [104, 96, 0, true];
    for (let tick = 0; tick < 200 && b.z < 101.5; tick++) stepBody(w, b, 0, 90, 0, 0, 0, params, TICK_DT);
    expect([walker, b.z > 101.5, Math.abs(b.y - .15) < .02]).toEqual([walker, true, true]);
    for (let tick = 0; tick < 200 && b.z < 106; tick++) stepBody(w, b, 0, 90, 0, 0, 0, params, TICK_DT);
    expect([walker, b.z >= 106, Math.abs(b.y) < .02]).toEqual([walker, true, true]);
  }
  const coast = { throttle: .3, steer: 0, brake: 0, handbrake: false, neutral: false };
  for (const yaw of [0, Math.PI / 6]) {
    const w = lay(); const world = new StaticVehicleWorld({ hf: w.hf, structs: w.structs }, () => ASPHALT);
    const car = createVehicle(COMPACT, 104 - 12 * Math.sin(yaw), 0, 88, yaw); car.vx = 8 * Math.sin(yaw); car.vz = 8 * Math.cos(yaw);
    for (let tick = 0; tick < 120; tick++) stepVehicle(car, coast, COMPACT, world);
    expect(car.z).toBeGreaterThan(103);
  }
});

test("a tower's top reads from a kilometre: torn, set back, a plant floor or a notched screen by seed, ragged round a core where it was lost, never below the refuge's storey", () => {
  const v = vocabulary(source);
  const f: Frame = { ...frame(0), width: 48, depth: 48, rings: [[[-24, -24], [24, -24], [24, 24], [-24, 24], [-24, -24]]] };
  const shape = (p: { kind: string }): string => p.kind.split("_")[1]!;
  // A tile's roof: the highest floor plate over its middle.
  const roofs = (m: Mason): number[] => tilesOf(m.frame, 8).map((t) => {
    const [x, z] = m.point(t.u, t.v);
    return Math.max(0, ...m.pieces.filter((p) => ["floor8", "floor16"].includes(shape(p)) && [p.x - x, p.z - z].every((d) => Math.abs(d) < RUIN_SHAPES[shape(p) as "floor8"][0] / 2 - 1)).map((p) => p.y + 0.2));
  }).filter((y) => y > 0);
  const seen = new Set<string>();
  // A failure whose slabs hang keeps every tile's height, so the tops are the crown's alone.
  for (let seed = 0; seed < 16; seed++) {
    const m = new Mason(f, 0);
    layout(m, { ...rule, recipe: "tower", height: 128, finish: "concrete", form: v.forms.office, formName: "office", collapse: "hanging", damage: v.damage.hanging, assemblies: v.assemblies, interiors: v.interiors }, { seed, playable: 12, detail: 0 });
    const kinds = new Set(m.pieces.map(shape));
    const top = roofs(m);
    // Nothing is cut below the storey over the twelve playable ones, where the refuge is.
    expect(Math.min(...top)).toBeGreaterThanOrEqual(13 * 4);
    if (kinds.has("zgloom")) {
      seen.add("torn");
      // Its floors open over the gap, a slab hung from one in two, and three storeys gone or more.
      expect(kinds.has("pier4") && kinds.has("zendsnap") || kinds.has("zendspall")).toBe(true);
      expect(Math.max(...top) - Math.min(...top)).toBeGreaterThanOrEqual(12);
    } else if (kinds.has("zplanttop")) seen.add("plant");
    else if (kinds.has("zscreen")) seen.add("screen");
    else if (Math.max(...top) - Math.min(...top) >= 12) seen.add("third");
  }
  expect([...seen].sort()).toEqual(["plant", "screen", "third", "torn"]);
  // A lost top stands at many heights round its core, which by seed stands two storeys or more over all else, or with
  // the stair beside it, or broken off a storey over the rest.
  const over: number[] = [];
  for (let seed = 0; seed < 12; seed++) {
    const m = new Mason(f, 0);
    layout(m, { ...rule, recipe: "tower", height: 160, finish: "concrete", form: v.forms.apartment, formName: "apartment", collapse: "lost-top", damage: v.damage["lost-top"], assemblies: v.assemblies, interiors: v.interiors }, { seed, playable: 16, detail: 0 });
    const top = roofs(m).sort((a, b) => b - a);
    expect(new Set(top).size).toBeGreaterThanOrEqual(4);
    over.push(top[0]! - top[1]!);
  }
  expect([over.some((d) => d >= 8), over.some((d) => d === 4), over.some((d) => d === 0)]).toEqual([true, true, true]);
});
