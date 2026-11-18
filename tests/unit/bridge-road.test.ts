import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { RUIN_SLOPES } from "../../content/ruins.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { flatWorld } from "../fixtures/world.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { makeBridges, roadDeckSlab, worldFrame, type DeckPoint } from "../../tools/mapworld/bridges.ts";
import { Mason } from "../../tools/mapworld/ruin-geometry.ts";
import type { Site } from "../../tools/mapworld/statics.ts";
import type { Way } from "../../tools/mapworld/ways.ts";

test("road slab definitions append without renumbering existing kinds and use the drawn convex surface", () => {
  const old = compileContent(CORE_CONTENT.filter(d => !d.id.startsWith("core:zzruin"))).registry!;
  const next = flatWorld().reg;
  for (const [id, index] of old.index) expect(next.index.get(id)).toBe(index);
  expect(next.ids.length - old.ids.length).toBe(8);
  for (const shape of [RUIN_SLOPES.floorroad1, RUIN_SLOPES.floorroad2, RUIN_SLOPES.floorroad3, RUIN_SLOPES.floorroad4]) {
    expect(shape.look).toBeUndefined(); expect(shape.boxes).toHaveLength(0); expect(shape.hulls).toHaveLength(1);
  }
});

function laid(deck: DeckPoint[]) {
  const w = flatWorld(4), mason = new Mason(worldFrame({ sizeX: 256, sizeZ: 256 }), 0);
  deck.forEach((d, i) => { if (!d.gap) {
    const slab = roadDeckSlab(deck, i), a = d.yaw * Math.PI / 180;
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
