import { expect, test } from "bun:test";
import { COMPACT, ASPHALT } from "../../content/vehicles/compact.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_SLOPES } from "../../content/ruins.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { flatWorld } from "../fixtures/world.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { bridgeHoles, makeBridges, roadDeckSlab, worldFrame, type DeckPoint } from "../../tools/mapworld/bridges.ts";
import { inRing, Mason } from "../../tools/mapworld/ruin-geometry.ts";
import type { Site } from "../../tools/mapworld/statics.ts";
import type { Way } from "../../tools/mapworld/ways.ts";
import { gradeRoadEntrances, type RoadEntrance } from "../../tools/mapworld/bridge-earthwork.ts";

test("road slab definitions append without renumbering existing kinds and use the drawn convex surface", () => {
  const old = compileContent(CORE_CONTENT.filter(d => !d.id.startsWith("core:zzruin"))).registry!;
  const next = flatWorld().reg;
  for (const [id, index] of old.index) expect(next.index.get(id)).toBe(index);
  expect(next.ids.length - old.ids.length).toBe(8);
  for (const shape of [RUIN_SLOPES.floorroad1, RUIN_SLOPES.floorroad2, RUIN_SLOPES.floorroad3, RUIN_SLOPES.floorroad4]) {
    expect(shape.look).toBeUndefined(); expect(shape.boxes).toHaveLength(0); expect(shape.hulls).toHaveLength(1);
  }
});

function laid(deck: DeckPoint[], terminalGround?: number) {
  const w = flatWorld(4), mason = new Mason(worldFrame({ sizeX: 256, sizeZ: 256 }), 0);
  deck.forEach((d, i) => { if (!d.gap) {
    const slab = roadDeckSlab(deck, i, terminalGround), a = d.yaw * Math.PI / 180;
    for (const side of [-6, -2, 2, 6]) mason.put(slab.shape, d.x + Math.sin(a) * side, slab.y, d.z + Math.cos(a) * side, "concrete", slab.yaw);
  } });
  for (const p of mason.pieces) w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1e4);
  return w;
}
function top(w: ReturnType<typeof flatWorld>, x: number, z: number): number {
  return castWorld(w, x, 30, z, 0, -1, 0, 25) === HIT_NONE ? NaN : 30 - rayHit.t;
}

test("road plates follow both grades at every heading with small seams through level transitions and curves", () => {
  for (const angle of [0, 17, 90, 157, 270]) for (const sign of [-1, 1]) for (const curved of [false, true]) {
    const deck: DeckPoint[] = [];
    let x = 100, z = 100;
    for (let i = 0; i < 24; i++) {
      const yaw = angle + (curved ? i * 1.5 : 0), a = yaw * Math.PI / 180;
      if (i) { x += Math.cos(a) * 2.5; z -= Math.sin(a) * 2.5; }
      deck.push({ x, y: 12 + sign * Math.max(0, Math.min(14, i - 4)) * .25, z, yaw, gap: false });
    }
    const w = laid(deck); let largest = 0, missing = 0;
    const bad: { side: number; row: number; sample: number }[] = [];
    for (const side of [-6, -.75, .75, 6]) {
      let previous: number | undefined;
      for (let i = 1; i < deck.length; i++) for (let j = 0; j < 50; j++) {
        const a = deck[i - 1]!, b = deck[i]!, t = j / 50, turn = (a.yaw + (b.yaw - a.yaw) * t) * Math.PI / 180;
        const y = top(w, a.x + (b.x - a.x) * t + Math.sin(turn) * side, a.z + (b.z - a.z) * t + Math.cos(turn) * side);
        if (!Number.isFinite(y)) { missing++; if (bad.length < 5) bad.push({ side, row: i, sample: j }); continue; }
        if (previous !== undefined) largest = Math.max(largest, Math.abs(y - previous)); previous = y;
      }
    }
    expect({ angle, sign, curved, missing, bad }).toEqual({ angle, sign, curved, missing: 0, bad: [] });
    // Quantised slabs may retain centimetre seams; the former quarter-metre road risers are gone.
    expect(largest).toBeLessThan(.09);
    const middle = deck[12]!, turn = middle.yaw * Math.PI / 180;
    expect(top(w, middle.x + Math.sin(turn) * 2, middle.z + Math.cos(turn) * 2)).toBeCloseTo(middle.y, 1);
  }
});

test("a producer retains gaps, per-row slab counts, flat rails and piers, and support furniture", () => {
  const source = mkdtempSync(join(tmpdir(), "snark-road-deck-"));
  try {
    mkdirSync(join(source, "blocks")); writeFileSync(join(source, "blocks/places.json"), "[]");
    const ways: Way[] = (["road_bridge", "rail_bridge", "pier", "breakwater"] as const).map((kind, i) => ({ id: i + 1, kind, name: null, class: "primary", lanes: 2, layer: 1, width_m: 8, closed: false, length_m: 100,
      points: [[176, -192 + i * 96], [76, -192 + i * 96]] }));
    writeFileSync(join(source, "blocks/ways.json"), JSON.stringify(ways));
    const n = 257, gaps = new Uint8Array(n * n); gaps[Math.round((512 - 64) / 2) * n + Math.round((512 - 130) / 2)] = 1;
    const site = { source, ground: { grid: gridAt([-256, -256, 256, 256]), gaps, water: new Uint8Array(n * n), height: new Float32Array(n * n), heaps: { owner: new Int32Array(n * n).fill(-1) } },
      groundAt: (x: number) => 1 + x * .1, waterAt: () => 0, toLattice: (e: number, no: number) => [256 - e, 256 + no] } as unknown as Site;
    const built: Mason[] = [], result = makeBridges(site, m => { built.push(m); return true; });
    expect(result.records).toHaveLength(4);
    result.records.forEach((r, i) => {
      const floors = built[i]!.pieces.filter(p => p.kind.split("_")[1]!.startsWith("floor"));
      expect(floors).toHaveLength(r.deck.filter(d => !d.gap).length * 2);
      expect(built[i]!.pieces.some(p => p.kind.includes("_sill4_")) || r.kind === "breakwater").toBe(true);
      if (r.kind === "road_bridge") {
        expect(r.deck.some(d => d.gap)).toBe(true);
        expect(floors.some(p => p.kind.startsWith("core:zzruin_floorroad"))).toBe(true);
        for (const d of r.deck.filter(d => d.gap)) expect(floors.some(p => Math.abs(p.x - d.x) < .01)).toBe(false);
      } else expect(floors.every(p => p.kind === "core:zruin_floor4_concrete")).toBe(true);
    });
  } finally { rmSync(source, { recursive: true, force: true }); }
});


test("road bridge feet meet dry ground and clear at driving speed in both directions", () => {
  for (const ground of [0, 3]) for (const speed of [0, 5, 15, 25]) for (const direction of [1, -1]) {
    const deck: DeckPoint[] = Array.from({ length: 13 }, (_, i) => ({ x: 96 + i * 2.5,
      y: ground + .25 + Math.min(i, 12 - i) * .25, z: 128, yaw: 0, gap: false }));
    const w = laid(deck, ground);
    for (let z = 0; z < w.hf.nz; z++) for (let x = 0; x < w.hf.nx; x++) w.hf.setSample(x, z, ground);
    for (const x of [94.001, 127.999]) {
      expect(castWorld(w, x, ground + 10, 128, 0, -1, 0, 11)).not.toBe(HIT_NONE);
      expect(Math.abs(10 - rayHit.t)).toBeLessThan(.005);
    }
    const car = createVehicle(COMPACT, direction > 0 ? 86 : 136, ground, 128, direction * Math.PI / 2);
    car.vx = direction * speed;
    const environment = new StaticVehicleWorld(w, () => ASPHALT); let up = 1, crash = 0, landing = 0;
    const end = direction > 0 ? 132 : 90;
    for (let tick = 0; tick < 300 && direction * (end - car.x) > 0; tick++) {
      const result = stepVehicle(car, { throttle: 1, steer: 0, brake: 0, handbrake: false }, COMPACT, environment);
      up = Math.min(up, 1 - 2 * (car.qx! ** 2 + car.qz! ** 2));
      crash = Math.max(crash, result.impactSpeed); landing = Math.max(landing, result.landSpeed ?? 0);
    }
    expect(direction * (car.x - end)).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThan(.8); expect(crash).toBe(0); expect(landing).toBeLessThan(12);
    expect(Math.abs(car.z - 128)).toBeLessThan(.1);
  }
});

test("final dry earthwork removes cross-width entrance lips after excavation without filling water, gaps or underpasses", () => {
  for (const yaw of [0, 17, 90, 157]) {
    const w = flatWorld(4), grid = gridAt([-128, -128, 128, 128]), height = new Float32Array(grid.nx * grid.nz);
    const water = new Uint8Array(height.length), gaps = new Uint8Array(height.length);
    // The final building/bridge cuts have left a shallow depression over the driving width, not just its centre.
    height.fill(-.35);
    const angle = yaw * Math.PI / 180, dx = Math.cos(angle), dz = -Math.sin(angle);
    const deck: DeckPoint[] = Array.from({ length: 6 }, (_, i) => ({ x: 128 + dx * i * 3, z: 128 + dz * i * 3, y: .25 + i * .25, yaw, gap: false }));
    const mason = new Mason(worldFrame(grid), 0);
    deck.forEach((d, i) => {
      const slab = roadDeckSlab(deck, i, i === 0 ? 0 : undefined);
      for (const side of [-6, -2, 2, 6]) mason.put(slab.shape, d.x - dz * side, slab.y, d.z + dx * side, "concrete", slab.yaw);
    });
    const entrance: RoadEntrance = { ...deck[0]!, dx, dz, width: 16, slabs: mason.pieces };
    const at = (x: number, z: number) => Math.round((grid.z1 - z) / 2) * grid.nx + Math.round((grid.x1 - x) / 2);
    const wet = at(128 - dz * 5, 128 + dx * 5), gap = at(128 + dz * 5, 128 - dx * 5), below = at(128 + dx * 8, 128 + dz * 8);
    water[wet] = 1; gaps[gap] = 1; height[below] = -5;
    const site = { ground: { grid, height, water, gaps } } as unknown as Site;
    expect(gradeRoadEntrances(site, [entrance])).toBeGreaterThan(30);
    expect(height[wet]).toBeCloseTo(-.35); expect(height[gap]).toBeCloseTo(-.35); expect(height[below]).toBe(-5);
    // Excluded samples sit outside these wheel tracks or beyond the first seam.
    for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nx; i++) w.hf.setSample(i, j, height[(grid.nz - 1 - j) * grid.nx + grid.nx - 1 - i]!);
    for (const p of mason.pieces) w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1e4);
    for (const side of [-1.5, 0, 1.5]) {
      let previous = NaN, largest = 0;
      for (let step = 0; step <= 800; step++) {
        const along = -4 + step / 100, x = 128 + dx * along - dz * side, z = 128 + dz * along + dx * side;
        expect(castWorld(w, x, 5, z, 0, -1, 0, 10)).not.toBe(HIT_NONE);
        const top = 5 - rayHit.t;
        if (Number.isFinite(previous)) largest = Math.max(largest, Math.abs(top - previous));
        previous = top;
      }
      expect(largest).toBeLessThan(.05);
    }
  }
});

test("emitted driving lanes meet on native lattice geometry and share one terminal profile across a crossfall", () => {
  const source = mkdtempSync(join(tmpdir(), "snark-road-lanes-"));
  try {
    mkdirSync(join(source, "blocks")); writeFileSync(join(source, "blocks/places.json"), "[]");
    for (const yaw of [17, 35, 157]) {
      const a = yaw * Math.PI / 180, dx = Math.cos(a), dz = -Math.sin(a), grid = gridAt([-256, -256, 256, 256]);
      const points: [number, number][] = [0, 35, 70].map(d => [256 - (240 + dx * d), 240 + dz * d - 256]);
      const way: Way = { id: 1, kind: "road_bridge", name: "fixture", class: "primary", lanes: 4, layer: 1, width_m: 16, closed: false, length_m: 70, points };
      writeFileSync(join(source, "blocks/ways.json"), JSON.stringify([way]));
      const n = grid.nx * grid.nz;
      const site = { source, ground: { grid, gaps: new Uint8Array(n), water: new Uint8Array(n), height: new Float32Array(n), heaps: { owner: new Int32Array(n).fill(-1) } },
        groundAt: (x: number, z: number) => 5 + ((z - 240) * dx - (x - 240) * dz) * .08,
        waterAt: () => 0, toLattice: (e: number, no: number) => [256 - e, 256 + no] } as unknown as Site;
      const pieces: Mason[] = [], made = makeBridges(site, m => { pieces.push(m); return true; }), w = flatWorld(8);
      const road = made.records[0]!; expect(road.entrances).toHaveLength(2);
      for (const e of road.entrances) {
        expect(new Set(e.slabs.slice(0, 4).map(p => p.y)).size).toBe(1);
        // The same holes used by levelFloor must protect the actual dry wheel approach from later building cuts.
        const frame = { ...worldFrame(grid), x: e.x, z: e.z, width: 40, depth: 40, rings: [[[-20, -20], [20, -20], [20, 20], [-20, 20]]] as [number, number][][] };
        const protectedFrame = bridgeHoles(frame, made.corridors, 1, 12);
        for (const side of [-1.5, 0, 1.5]) expect(protectedFrame.rings.slice(1).some(r => inRing(-e.dx * 4 - e.dz * side, -e.dz * 4 + e.dx * side, r))).toBe(true);
      }
      for (const p of pieces[0]!.pieces) w.structs.add(w.kind(p.kind), p.x, p.y, p.z, Math.round(p.yaw * 65536 / 360) & 65535, 0, 1e4);
      for (const side of [-1.5, 0, 1.5]) for (let sample = 0; sample <= 350; sample++) {
        const d = sample / 5, x = 240 + dx * d - dz * side, z = 240 + dz * d + dx * side;
        expect(castWorld(w, x, 20, z, 0, -1, 0, 25)).not.toBe(HIT_NONE);
        expect(20 - rayHit.t).toBeGreaterThan(4.8);
      }
    }
  } finally { rmSync(source, { recursive: true, force: true }); }
});
